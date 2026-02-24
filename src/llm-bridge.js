/**
 * RemindMe AI — Unified LLM Bridge
 * 
 * Provides a single interface for AI generation that works on both:
 *   - Mobile (Capacitor): Uses on-device Gemma 2B via LlmPlugin
 *   - Web (Browser):      Uses Gemini API (free tier, gemini-2.0-flash)
 * 
 * The architecture keeps mobile constraints in mind:
 *   - Same prompt format used everywhere
 *   - Token budget stays under 2048 (Gemma 2B context window)
 *   - Responses are kept concise by system prompt instructions
 * 
 * Usage:
 *   import { initLLM, generateResponse, isModelReady } from './llm-bridge.js';
 *   await initLLM();
 *   const answer = await generateResponse(prompt);
 */

import { registerPlugin } from '@capacitor/core';

// ====================================================
// Platform Detection
// ====================================================

function isNativePlatform() {
    return window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform();
}

// ====================================================
// State
// ====================================================

let platform = 'web'; // 'native' or 'web'
let modelLoaded = false;
let LlmPlugin = null;
let apiKey = null;

// API key storage key in localStorage
const API_KEY_STORAGE = 'remindme_gemini_api_key';

// ====================================================
// Initialization
// ====================================================

/**
 * Initialize the LLM bridge.
 * On native: registers the LlmPlugin.
 * On web: loads the API key from localStorage.
 */
export async function initLLM() {
    if (isNativePlatform()) {
        platform = 'native';
        LlmPlugin = registerPlugin('LlmPlugin');
        console.log('🤖 LLM Bridge: Native mode (Gemma 2B)');
    } else {
        platform = 'web';
        apiKey = localStorage.getItem(API_KEY_STORAGE) || '';
        console.log('🌐 LLM Bridge: Web mode (Gemini API)');

        if (!apiKey) {
            console.warn('⚠️ No Gemini API key set. Use setApiKey() or the settings UI.');
        }
    }
}

// ====================================================
// API Key Management (Web only)
// ====================================================

export function setApiKey(key) {
    apiKey = key;
    localStorage.setItem(API_KEY_STORAGE, key);
    console.log('🔑 Gemini API key saved');
}

export function getApiKey() {
    return apiKey || localStorage.getItem(API_KEY_STORAGE) || '';
}

export function hasApiKey() {
    const key = getApiKey();
    return !!(key && key.length > 10);
}

// ====================================================
// Model Status
// ====================================================

/**
 * Check if the model is ready to generate responses.
 */
export function isModelReady() {
    if (platform === 'native') return modelLoaded;
    return hasApiKey();
}

/**
 * Get platform info for UI.
 */
export function getPlatformInfo() {
    return {
        platform,
        isNative: platform === 'native',
        isWeb: platform === 'web',
        modelName: platform === 'native' ? 'Gemma 2B (on-device)' : 'Gemini 2.0 Flash (API)',
        ready: isModelReady(),
    };
}

// ====================================================
// Native Bridge (Gemma 2B via Capacitor)
// ====================================================

async function nativeCheckModel() {
    return LlmPlugin.checkModel();
}

async function nativeLoadModel() {
    const res = await LlmPlugin.loadModel();
    if (res.status === 'loaded' || res.status === 'already_loaded') {
        modelLoaded = true;
    }
    return res;
}

async function nativeGenerate(prompt) {
    const res = await LlmPlugin.generate({ prompt });
    return res.response;
}

async function nativeDownloadModel(url) {
    return LlmPlugin.downloadModel({ url });
}

async function nativeInstallModel() {
    return LlmPlugin.installModel();
}

// ====================================================
// Web Bridge (Gemini API)
// ====================================================

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

async function webGenerate(prompt) {
    if (!apiKey) {
        throw new Error('No Gemini API key configured. Go to Settings to add your key.');
    }

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 512, // Keep responses mobile-sized
            },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ]
        })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const errMsg = err?.error?.message || `API Error: ${response.status}`;
        throw new Error(errMsg);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        throw new Error('Empty response from Gemini API');
    }

    return text;
}

// ====================================================
// Unified Public API
// ====================================================

/**
 * Generate a response from the LLM.
 * Works on both native (Gemma 2B) and web (Gemini API).
 * 
 * @param {string} prompt - The full prompt including context
 * @returns {Promise<string>} The generated response text
 */
export async function generateResponse(prompt) {
    if (platform === 'native') {
        return nativeGenerate(prompt);
    }
    return webGenerate(prompt);
}

/**
 * Check if the model file exists (native only).
 * On web, always returns { exists: true } since we use API.
 */
export async function checkModel() {
    if (platform === 'native') return nativeCheckModel();
    return { exists: true, platform: 'web' };
}

/**
 * Load the model into memory (native only).
 * On web, this is a no-op.
 */
export async function loadModel() {
    if (platform === 'native') return nativeLoadModel();
    modelLoaded = true;
    return { status: 'loaded', platform: 'web' };
}

/**
 * Download model (native only). No-op on web.
 */
export async function downloadModel(url) {
    if (platform === 'native') return nativeDownloadModel(url);
    console.log('Web mode — no model download needed');
}

/**
 * Install model from downloads (native only). No-op on web.
 */
export async function installModel() {
    if (platform === 'native') return nativeInstallModel();
    return { status: 'installed', platform: 'web' };
}
