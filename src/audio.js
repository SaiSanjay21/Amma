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
 */
export function speak(text, voiceName = null, rate = 1) {
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
 * Get available voices
 */
export function getVoices() {
    return new Promise((resolve) => {
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
