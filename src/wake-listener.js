/**
 * RemindMe AI — Wake Word Listener & Continuous Conversation Engine
 * 
 * This module provides an always-on listening mode that:
 *   1. Continuously listens for wake words: "Amma", "Hi Amma", "Hello Amma", "Hey Amma"
 *   2. When triggered, opens a conversation window and records continuously
 *   3. Keeps listening until 5 seconds of silence (no speech detected)
 *   4. Returns the full conversation transcript for AI processing
 *   5. Loops back to wake word detection after conversation ends
 * 
 * Architecture:
 *   - Uses Web Speech API (continuous mode) for browser
 *   - On native Capacitor, uses repeated short recognition sessions
 *   - Designed for low memory — no audio buffers stored, just text
 */

// ====================================================
// State
// ====================================================

let isWakeListening = false;      // Are we listening for wake words?
let isConversationActive = false; // Are we in an active conversation?
let recognition = null;           // SpeechRecognition instance
let silenceTimer = null;          // Timer for 5s silence detection
let conversationTranscript = '';  // Accumulated transcript
let lastSpeechTime = 0;           // Timestamp of last speech

// Callbacks set by the integrator
let onWakeDetected = null;        // Called when wake word is heard
let onConversationUpdate = null;  // Called with interim text during conversation
let onConversationEnd = null;     // Called with full transcript when conversation ends
let onStatusChange = null;        // Called with status updates for UI
let onError = null;               // Called on errors

// Configuration
const WAKE_WORDS = ['amma', 'hi amma', 'hello amma', 'hey amma', 'a mama', 'ama'];
const SILENCE_TIMEOUT_MS = 5000;  // 5 seconds of silence closes conversation
const RESTART_DELAY_MS = 500;     // Small delay before restarting wake listening

// ====================================================
// Platform Detection
// ====================================================

function isCapacitorNative() {
    try {
        return window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    } catch (e) {
        return false;
    }
}

function getSpeechRecognition() {
    return window.SpeechRecognition || window.webkitSpeechRecognition;
}

// ====================================================
// Wake Word Detection
// ====================================================

/**
 * Check if text contains a wake word.
 * Returns the remaining text after the wake word, or null if no match.
 */
function detectWakeWord(text) {
    const lower = text.toLowerCase().trim();

    for (const wake of WAKE_WORDS) {
        // Check if the text starts with or equals the wake word
        if (lower === wake) {
            return ''; // Just the wake word, no additional text
        }
        if (lower.startsWith(wake + ' ')) {
            return text.substring(wake.length).trim(); // Text after wake word
        }
        if (lower.startsWith(wake + ',')) {
            return text.substring(wake.length + 1).trim();
        }
    }

    // Also check if the text contains "amma" anywhere (for "hi amma remind me...")
    const ammaIdx = lower.indexOf('amma');
    if (ammaIdx !== -1) {
        // Check the word boundary before "amma"
        if (ammaIdx === 0 || lower[ammaIdx - 1] === ' ') {
            return text.substring(ammaIdx + 4).trim();
        }
    }

    return null;
}

// ====================================================
// Web Speech API Recognition Engine
// ====================================================

function createRecognition() {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.continuous = true;          // Keep listening (don't stop after one sentence)
    rec.interimResults = true;      // Get partial results for live feedback
    rec.lang = 'en-US';
    rec.maxAlternatives = 1;
    return rec;
}

// ====================================================
// Wake Word Listening Loop
// ====================================================

/**
 * Start the always-on wake word listener.
 * This runs in the background, consuming very little resources.
 */
export function startWakeListener(callbacks) {
    if (isWakeListening) return;

    onWakeDetected = callbacks.onWakeDetected || (() => { });
    onConversationUpdate = callbacks.onConversationUpdate || (() => { });
    onConversationEnd = callbacks.onConversationEnd || (() => { });
    onStatusChange = callbacks.onStatusChange || (() => { });
    onError = callbacks.onError || (() => { });

    if (isCapacitorNative()) {
        startNativeWakeLoop();
        return;
    }

    startWebWakeLoop();
}

/**
 * Stop the wake listener entirely.
 */
export function stopWakeListener() {
    isWakeListening = false;
    isConversationActive = false;
    clearTimeout(silenceTimer);

    if (recognition) {
        try { recognition.stop(); } catch (e) { /* ignore */ }
        recognition = null;
    }

    onStatusChange?.('idle');
    console.log('🔇 Wake listener stopped');
}

/**
 * Check if currently in a conversation.
 */
export function isInConversation() {
    return isConversationActive;
}

/**
 * Check if wake listener is active.
 */
export function isWakeListenerActive() {
    return isWakeListening;
}

// ====================================================
// Web Implementation
// ====================================================

function startWebWakeLoop() {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
        onError?.('Speech recognition not supported. Please use Chrome.');
        return;
    }

    isWakeListening = true;
    onStatusChange?.('listening');
    console.log('👂 Wake listener active — say "Amma" to start!');

    beginWakeRecognition();
}

function beginWakeRecognition() {
    if (!isWakeListening) return;

    recognition = createRecognition();
    if (!recognition) return;

    recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            const isFinal = event.results[i].isFinal;

            if (isConversationActive) {
                // In conversation mode - accumulate transcript
                handleConversationSpeech(transcript, isFinal);
            } else {
                // Wake word detection mode
                const afterWake = detectWakeWord(transcript);
                if (afterWake !== null) {
                    console.log('🎯 Wake word detected!', transcript);
                    startConversation(afterWake);
                }
            }
        }
    };

    recognition.onend = () => {
        // Speech recognition ended — restart if still in wake mode
        if (isWakeListening && !isConversationActive) {
            // Brief pause before restarting to avoid rapid cycling
            setTimeout(() => {
                if (isWakeListening && !isConversationActive) {
                    beginWakeRecognition();
                }
            }, RESTART_DELAY_MS);
        } else if (isConversationActive) {
            // Recognition ended during conversation (browser may stop after silence)
            // Restart it to keep listening
            setTimeout(() => {
                if (isConversationActive && isWakeListening) {
                    try {
                        recognition = createRecognition();
                        if (recognition) {
                            recognition.onresult = (event) => {
                                for (let i = event.resultIndex; i < event.results.length; i++) {
                                    handleConversationSpeech(
                                        event.results[i][0].transcript,
                                        event.results[i].isFinal
                                    );
                                }
                            };
                            recognition.onend = () => {
                                if (isConversationActive && isWakeListening) {
                                    setTimeout(() => beginConversationRecognition(), 300);
                                }
                            };
                            recognition.onerror = handleRecognitionError;
                            recognition.start();
                        }
                    } catch (e) {
                        console.warn('Conversation recognition restart failed:', e);
                    }
                }
            }, 300);
        }
    };

    recognition.onerror = handleRecognitionError;

    try {
        recognition.start();
    } catch (e) {
        console.warn('Wake recognition start error:', e);
        // Retry after delay
        setTimeout(() => {
            if (isWakeListening) beginWakeRecognition();
        }, 1000);
    }
}

function beginConversationRecognition() {
    if (!isConversationActive || !isWakeListening) return;
    try {
        recognition = createRecognition();
        if (recognition) {
            recognition.onresult = (event) => {
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    handleConversationSpeech(
                        event.results[i][0].transcript,
                        event.results[i].isFinal
                    );
                }
            };
            recognition.onend = () => {
                if (isConversationActive && isWakeListening) {
                    setTimeout(() => beginConversationRecognition(), 300);
                }
            };
            recognition.onerror = handleRecognitionError;
            recognition.start();
        }
    } catch (e) {
        console.warn('Conversation recognition restart failed:', e);
    }
}

function handleRecognitionError(event) {
    const ignoreErrors = ['no-speech', 'aborted'];
    if (ignoreErrors.includes(event.error)) {
        // No speech heard — this is normal during wake word listening
        return;
    }

    console.warn('Speech recognition error:', event.error);

    if (event.error === 'not-allowed') {
        onError?.('Microphone access denied. Please allow microphone permissions.');
        stopWakeListener();
        return;
    }

    // For other errors, try to restart
    if (isWakeListening) {
        setTimeout(() => {
            if (isWakeListening) beginWakeRecognition();
        }, 2000);
    }
}

// ====================================================
// Conversation Mode
// ====================================================

function startConversation(initialText) {
    isConversationActive = true;
    conversationTranscript = initialText || '';
    lastSpeechTime = Date.now();

    onWakeDetected?.();
    onStatusChange?.('conversation');

    if (initialText) {
        onConversationUpdate?.(initialText);
    }

    // Start silence detection timer
    resetSilenceTimer();

    console.log('💬 Conversation started');
}

function handleConversationSpeech(transcript, isFinal) {
    lastSpeechTime = Date.now();

    if (isFinal) {
        // Append final transcript
        if (conversationTranscript) {
            conversationTranscript += ' ' + transcript.trim();
        } else {
            conversationTranscript = transcript.trim();
        }
    }

    // Show interim + accumulated to the user
    const displayText = conversationTranscript + (isFinal ? '' : ' ' + transcript);
    onConversationUpdate?.(displayText);

    // Reset silence timer on any speech
    resetSilenceTimer();
}

function resetSilenceTimer() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
        endConversation();
    }, SILENCE_TIMEOUT_MS);
}

function endConversation() {
    clearTimeout(silenceTimer);
    isConversationActive = false;

    const transcript = conversationTranscript.trim();
    conversationTranscript = '';

    console.log('🏁 Conversation ended. Transcript:', transcript);

    onStatusChange?.('processing');
    onConversationEnd?.(transcript);

    // After processing, restart wake word listening
    setTimeout(() => {
        if (isWakeListening) {
            onStatusChange?.('listening');
            // Recognition will restart via onend handler
            try {
                if (recognition) recognition.stop();
            } catch (e) { /* ignore */ }
            setTimeout(() => beginWakeRecognition(), 500);
        }
    }, 1000);
}

// ====================================================
// Native (Capacitor) Implementation
// Uses polling with short recognition sessions
// ====================================================

let nativeSpeechPlugin = null;

async function startNativeWakeLoop() {
    try {
        const module = await import('@capacitor-community/speech-recognition');
        nativeSpeechPlugin = module.SpeechRecognition;

        await nativeSpeechPlugin.requestPermissions();

        isWakeListening = true;
        onStatusChange?.('listening');
        console.log('📱👂 Native wake listener active');

        nativeListenCycle();
    } catch (e) {
        console.error('Native wake listener failed:', e);
        onError?.('Could not start voice listening: ' + e.message);
    }
}

async function nativeListenCycle() {
    if (!isWakeListening) return;

    try {
        const result = await nativeSpeechPlugin.start({
            language: 'en-US',
            maxResults: 1,
            partialResults: false,
            popup: false,
        });

        if (result && result.matches && result.matches.length > 0) {
            const text = result.matches[0];

            if (isConversationActive) {
                // In conversation — accumulate
                handleConversationSpeech(text, true);
                nativeListenCycle(); // Keep listening
            } else {
                // Check for wake word
                const afterWake = detectWakeWord(text);
                if (afterWake !== null) {
                    startConversation(afterWake);
                    nativeListenCycle(); // Continue listening for conversation
                } else {
                    nativeListenCycle(); // Keep listening for wake word
                }
            }
        } else {
            // No speech — retry
            setTimeout(() => nativeListenCycle(), 500);
        }
    } catch (e) {
        if (isWakeListening) {
            setTimeout(() => nativeListenCycle(), 1000);
        }
    }
}
