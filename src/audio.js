/**
 * RemindMe AI — Audio & Alarm Engine
 * Generates alarm sounds and handles text-to-speech
 */

let audioCtx = null;
let currentAlarmOscillators = [];
let isAlarmPlaying = false;

function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

/**
 * Generate different alarm sounds using Web Audio API
 */
export function playAlarmSound(type = 'gentle', volume = 0.7) {
    stopAlarmSound();
    isAlarmPlaying = true;
    const ctx = getAudioContext();
    const gainNode = ctx.createGain();
    gainNode.gain.value = volume;
    gainNode.connect(ctx.destination);

    switch (type) {
        case 'gentle':
            playGentleChime(ctx, gainNode);
            break;
        case 'urgent':
            playUrgentBell(ctx, gainNode);
            break;
        case 'musical':
            playMusicalTone(ctx, gainNode);
            break;
        case 'retro':
            playRetroBeep(ctx, gainNode);
            break;
        default:
            playGentleChime(ctx, gainNode);
    }
}

function playGentleChime(ctx, gainNode) {
    const frequencies = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    let time = ctx.currentTime;

    function playSequence() {
        if (!isAlarmPlaying) return;
        frequencies.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            env.gain.setValueAtTime(0, time + i * 0.25);
            env.gain.linearRampToValueAtTime(0.3, time + i * 0.25 + 0.05);
            env.gain.exponentialRampToValueAtTime(0.001, time + i * 0.25 + 0.6);
            osc.connect(env);
            env.connect(gainNode);
            osc.start(time + i * 0.25);
            osc.stop(time + i * 0.25 + 0.7);
            currentAlarmOscillators.push(osc);
        });
        time += 2;
        if (isAlarmPlaying) {
            setTimeout(playSequence, 2000);
        }
    }
    playSequence();
}

function playUrgentBell(ctx, gainNode) {
    let time = ctx.currentTime;

    function playBell() {
        if (!isAlarmPlaying) return;
        for (let i = 0; i < 3; i++) {
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = 880;
            env.gain.setValueAtTime(0.3, time + i * 0.2);
            env.gain.exponentialRampToValueAtTime(0.001, time + i * 0.2 + 0.15);
            osc.connect(env);
            env.connect(gainNode);
            osc.start(time + i * 0.2);
            osc.stop(time + i * 0.2 + 0.2);
            currentAlarmOscillators.push(osc);
        }
        time += 1;
        if (isAlarmPlaying) {
            setTimeout(playBell, 1000);
        }
    }
    playBell();
}

function playMusicalTone(ctx, gainNode) {
    // Major scale melody
    const melody = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25];
    let time = ctx.currentTime;

    function playMelody() {
        if (!isAlarmPlaying) return;
        melody.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            env.gain.setValueAtTime(0, time + i * 0.2);
            env.gain.linearRampToValueAtTime(0.25, time + i * 0.2 + 0.05);
            env.gain.exponentialRampToValueAtTime(0.001, time + i * 0.2 + 0.35);
            osc.connect(env);
            env.connect(gainNode);
            osc.start(time + i * 0.2);
            osc.stop(time + i * 0.2 + 0.4);
            currentAlarmOscillators.push(osc);
        });
        time += 2.5;
        if (isAlarmPlaying) {
            setTimeout(playMelody, 2500);
        }
    }
    playMelody();
}

function playRetroBeep(ctx, gainNode) {
    let time = ctx.currentTime;

    function playBeep() {
        if (!isAlarmPlaying) return;
        for (let i = 0; i < 2; i++) {
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = 1000;
            env.gain.setValueAtTime(0.2, time + i * 0.3);
            env.gain.setValueAtTime(0, time + i * 0.3 + 0.15);
            osc.connect(env);
            env.connect(gainNode);
            osc.start(time + i * 0.3);
            osc.stop(time + i * 0.3 + 0.3);
            currentAlarmOscillators.push(osc);
        }
        time += 1.5;
        if (isAlarmPlaying) {
            setTimeout(playBeep, 1500);
        }
    }
    playBeep();
}

export function stopAlarmSound() {
    isAlarmPlaying = false;
    currentAlarmOscillators.forEach(osc => {
        try { osc.stop(); } catch (e) { /* already stopped */ }
    });
    currentAlarmOscillators = [];
}

/**
 * Text-to-Speech Engine
 * Uses native Android TTS in Capacitor, falls back to Web Speech API in browsers
 */

let nativeTtsPlugin = null;
let nativeTtsReady = false;

// Initialize native TTS if running in Capacitor
async function initNativeTts() {
    if (nativeTtsReady) return true;
    try {
        if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
            const module = await import('@capacitor-community/text-to-speech');
            nativeTtsPlugin = module.TextToSpeech;
            nativeTtsReady = true;
            console.log('📢 Native TTS ready');
            return true;
        }
    } catch (err) {
        console.warn('Native TTS not available:', err);
    }
    return false;
}

export async function speak(text, voiceName = null, rate = 1) {
    if (!text) return;

    // Try native TTS first (Android)
    try {
        await initNativeTts();
        if (nativeTtsReady && nativeTtsPlugin) {
            await nativeTtsPlugin.speak({
                text: text,
                lang: 'en-US',
                rate: rate,
                pitch: 1.0,
                volume: 1.0,
                category: 'ambient',
            });
            console.log('📢 Native TTS spoke:', text.substring(0, 50));
            return;
        }
    } catch (err) {
        console.warn('Native TTS speak failed:', err);
    }

    // Fallback to Web Speech API (browser)
    return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) {
            console.warn('Text-to-speech not supported');
            resolve();
            return;
        }

        // Cancel any ongoing speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = rate;
        utterance.pitch = 1;
        utterance.volume = 1;

        // Set voice if specified
        if (voiceName) {
            const voices = window.speechSynthesis.getVoices();
            const selectedVoice = voices.find(v => v.name === voiceName);
            if (selectedVoice) {
                utterance.voice = selectedVoice;
            }
        }

        utterance.onend = resolve;
        utterance.onerror = resolve;

        window.speechSynthesis.speak(utterance);
    });
}

/**
 * Stop any ongoing speech
 */
export async function stopSpeaking() {
    try {
        if (nativeTtsReady && nativeTtsPlugin) {
            await nativeTtsPlugin.stop();
            return;
        }
    } catch (e) { /* ignore */ }

    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
}

/**
 * Get available voices
 */
export async function getVoices() {
    // Try native voices first
    try {
        await initNativeTts();
        if (nativeTtsReady && nativeTtsPlugin) {
            const result = await nativeTtsPlugin.getSupportedVoices();
            if (result && result.voices && result.voices.length > 0) {
                console.log(`📢 Found ${result.voices.length} native voices`);
                return result.voices.map(v => ({
                    name: v.name || v.voiceURI || 'Default',
                    lang: v.lang || 'en-US',
                }));
            }
        }
    } catch (err) {
        console.warn('Native voices not available:', err);
    }

    // Fallback to Web Speech API voices
    return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) {
            resolve([]);
            return;
        }
        let voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            resolve(voices);
            return;
        }
        window.speechSynthesis.onvoiceschanged = () => {
            voices = window.speechSynthesis.getVoices();
            resolve(voices);
        };
        // Fallback timeout
        setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
    });
}

/**
 * Play a quick notification blip sound
 */
export function playNotificationSound() {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
}
