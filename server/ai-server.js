/**
 * RemindMe AI — Perplexity AI Server
 * 
 * Runs on your laptop and provides an API for the phone app to
 * send questions to Perplexity AI via browser automation.
 * 
 * Usage: node server/ai-server.js
 */

import http from 'http';
import puppeteer from 'puppeteer';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ===== CONFIGURATION =====
const PORT = 3456;
const PERPLEXITY_URL = 'https://www.perplexity.ai/';
const COMET_PATH = '/Applications/Comet.app/Contents/MacOS/Comet';
const COOKIES_PATH = '/Users/saisanjaybandarupalli/Documents/puppeteer-test/perplexity-cookies.json';

let browser = null;
let page = null;
let isReady = false;
let isBusy = false;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== PUPPETEER HELPERS =====

async function loadCookies(pg) {
    try {
        const cookiesString = fs.readFileSync(COOKIES_PATH, 'utf8');
        const cookies = JSON.parse(cookiesString);
        await pg.setCookie(...cookies);
        console.log('✅ Cookies loaded');
        return true;
    } catch (error) {
        console.log('⚠️ No saved cookies found');
        return false;
    }
}

async function saveCookies(pg) {
    const cookies = await pg.cookies();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    console.log('✅ Cookies saved');
}

async function dismissOverlays(pg) {
    try {
        await pg.keyboard.press('Escape');
        await delay(300);
    } catch (e) { /* ignore */ }
}

async function sendMessage(pg, message) {
    await dismissOverlays(pg);

    // Try contenteditable first, then textarea
    const inputSelector = await pg.evaluate(() => {
        const ce = document.querySelector('[contenteditable="true"]');
        if (ce) return 'contenteditable';
        const ta = document.querySelector('textarea');
        if (ta) return 'textarea';
        return null;
    });

    if (inputSelector === 'contenteditable') {
        await pg.click('[contenteditable="true"]');
    } else if (inputSelector === 'textarea') {
        await pg.click('textarea');
    } else {
        throw new Error('Could not find input field on Perplexity');
    }

    await delay(300);
    await pg.keyboard.type(message, { delay: 10 });
    await delay(300);
    await pg.keyboard.press('Enter');
    console.log('📤 Message sent to Perplexity');
}

async function waitForResponse(pg, timeoutMs = 120000) {
    console.log('⏳ Waiting for Perplexity response...');
    await delay(5000);

    try {
        await pg.waitForFunction(
            () => !document.querySelector('button[aria-label*="Stop"]'),
            { timeout: timeoutMs }
        );
    } catch (e) {
        console.log('⚠️ Response timeout, reading partial response...');
    }

    await delay(2000);
}

async function getLastResponse(pg) {
    return await pg.evaluate(() => {
        const selectors = [
            '[class*="answer"]',
            '[role="article"]',
            '.prose',
            '.markdown'
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                for (let i = elements.length - 1; i >= 0; i--) {
                    const text = elements[i].innerText;
                    if (text && text.length > 50) {
                        return text;
                    }
                }
            }
        }

        // Fallback: get all text from main content area
        const main = document.querySelector('main') || document.body;
        const divs = main.querySelectorAll('div');
        let longestText = '';
        divs.forEach(div => {
            const text = div.innerText || '';
            if (text.length > longestText.length && text.length > 50) {
                longestText = text;
            }
        });

        return longestText || 'No response found';
    });
}

// ===== BROWSER INITIALIZATION =====

async function initBrowser() {
    console.log('🚀 Launching Comet browser...');

    browser = await puppeteer.launch({
        headless: false,
        executablePath: COMET_PATH,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ],
        defaultViewport: { width: 1200, height: 800 }
    });

    page = await browser.newPage();
    await loadCookies(page);

    console.log('📡 Navigating to Perplexity...');
    await page.goto(PERPLEXITY_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(3000);

    // Check if logged in
    const loggedIn = await page.evaluate(() => {
        return !document.querySelector('button[aria-label*="Log in"]') &&
            !document.querySelector('button[aria-label*="Sign in"]');
    });

    if (!loggedIn) {
        console.log('\n⚠️  Please log in to Perplexity in the browser window!');
        console.log('    Waiting 60 seconds...\n');
        await delay(60000);
        await saveCookies(page);
    } else {
        console.log('✅ Already logged in to Perplexity');
    }

    isReady = true;
    console.log('\n🟢 AI Server READY — Phone can now send queries!\n');
}

// ===== ASK PERPLEXITY =====

async function askPerplexity(question) {
    if (!isReady || !page) {
        throw new Error('Browser not ready. Please wait for initialization.');
    }
    if (isBusy) {
        throw new Error('Currently processing another question. Please wait.');
    }

    isBusy = true;

    try {
        // Navigate to new chat for clean context
        await page.goto(PERPLEXITY_URL, { waitUntil: 'networkidle2', timeout: 20000 });
        await delay(2000);

        // Send the question
        await sendMessage(page, question);
        await waitForResponse(page);

        // Get the response
        const response = await getLastResponse(page);

        // Clean up the response — remove citations and extra whitespace
        const cleanResponse = response
            .replace(/\[\d+\]/g, '')       // Remove [1], [2] citations
            .replace(/\n{3,}/g, '\n\n')    // Reduce excessive newlines
            .trim();

        return cleanResponse;
    } finally {
        isBusy = false;
    }
}

// ===== HTTP SERVER =====

const server = http.createServer(async (req, res) => {
    console.log(`📥 ${req.method} ${req.url}`);

    // CORS headers — allow requests from any origin (phone app)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', ready: isReady, busy: isBusy }));
        return;
    }

    // Ask AI endpoint
    if (req.method === 'POST' && req.url === '/ask') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { question } = JSON.parse(body);

                if (!question) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing "question" field' }));
                    return;
                }

                console.log(`\n📱 Phone asked: "${question}"`);
                const answer = await askPerplexity(question);
                console.log(`✅ Response: ${answer.substring(0, 100)}...`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ answer, success: true }));

            } catch (err) {
                console.error('❌ Error:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message, success: false }));
            }
        });
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

// ===== START =====

server.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log('  RemindMe AI — Perplexity AI Server');
    console.log('========================================');
    console.log(`  API:   http://0.0.0.0:${PORT}`);
    console.log(`  Ask:   POST http://localhost:${PORT}/ask`);
    console.log(`  Body:  { "question": "your question" }`);
    console.log('========================================\n');

    // Initialize browser
    initBrowser().catch(err => {
        console.error('❌ Failed to initialize browser:', err.message);
    });
});

// Cleanup on exit
process.on('SIGINT', async () => {
    console.log('\n🔴 Shutting down...');
    if (browser) await browser.close();
    process.exit(0);
});
