/**
 * RemindMe AI — Voice Command Engine
 * Handles speech recognition and natural language parsing
 * with advanced date/time extraction for smart scheduling
 *
 * Supports TWO modes:
 *   1. Native Android (Capacitor) — uses Android's Google Speech UI popup
 *   2. Web Browser — uses Web Speech API via Chrome (requires HTTPS)
 */

let recognition = null;
let isListening = false;
let useNativeRecognition = false;
let nativeSpeechPlugin = null;

// Passive listening state
let passiveRecognition = null;
let isPassiveListening = false;
let passiveOnReminder = null;  // callback when "remind me" wake phrase detected

/**
 * Detect if we're running inside a Capacitor native app
 */
function isCapacitorNative() {
    try {
        return window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    } catch (e) {
        return false;
    }
}

/**
 * Initialize Speech Recognition — auto-detects native vs browser
 */
export async function initVoiceRecognition() {
    // --- Native Android (Capacitor) ---
    if (isCapacitorNative()) {
        console.log('📱 Detected Capacitor native platform');
        try {
            const module = await import('@capacitor-community/speech-recognition');
            nativeSpeechPlugin = module.SpeechRecognition;
            console.log('📱 Speech plugin loaded:', !!nativeSpeechPlugin);

            // Request permissions
            try {
                const permResult = await nativeSpeechPlugin.requestPermissions();
                console.log('🎤 Permission result:', JSON.stringify(permResult));
            } catch (permErr) {
                console.warn('Permission request failed (may already be granted):', permErr);
            }

            // Check availability
            try {
                const available = await nativeSpeechPlugin.available();
                console.log('🔍 Speech available:', JSON.stringify(available));
                if (available.available) {
                    useNativeRecognition = true;
                    console.log('✅ Native Android speech recognition READY');
                    return true;
                }
            } catch (availErr) {
                // Some versions may not have .available() — still try to use it
                console.warn('Availability check failed, will try anyway:', availErr);
                useNativeRecognition = true;
                return true;
            }
        } catch (err) {
            console.error('❌ Native speech plugin failed to load:', err);
        }
    }

    // --- Web Browser fallback ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        console.warn('❌ No speech recognition available');
        return null;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    console.log('🌐 Using Web Speech API');
    return recognition;
}

/**
 * Start listening for voice commands
 */
export async function startListening(onResult, onInterim, onEnd, onError) {
    if (isListening) {
        stopListening();
        return;
    }

    // --- Native Android path ---
    if (useNativeRecognition && nativeSpeechPlugin) {
        isListening = true;

        try {
            // Use popup: true for maximum compatibility
            // This launches Android's built-in Google Speech dialog
            const result = await nativeSpeechPlugin.start({
                language: 'en-US',
                maxResults: 1,
                prompt: 'Say a reminder or note...',
                partialResults: false,
                popup: true,  // Shows Google's familiar speech UI
            });

            isListening = false;
            console.log('🎤 Speech result:', JSON.stringify(result));

            // Process the result
            if (result && result.matches && result.matches.length > 0) {
                const transcript = result.matches[0];
                onResult?.(transcript);
            } else {
                onError?.('No speech detected. Please try again.');
            }

            onEnd?.();
        } catch (err) {
            isListening = false;
            console.error('Native speech error:', err);

            // If popup mode fails, try without popup
            try {
                console.log('Retrying without popup...');
                const result = await nativeSpeechPlugin.start({
                    language: 'en-US',
                    maxResults: 1,
                    partialResults: false,
                    popup: false,
                });

                if (result && result.matches && result.matches.length > 0) {
                    onResult?.(result.matches[0]);
                } else {
                    onError?.('No speech detected. Please try again.');
                }
                onEnd?.();
            } catch (retryErr) {
                console.error('Speech retry also failed:', retryErr);
                onError?.('Voice recognition failed. Please check that Google app is installed and microphone permission is granted.');
                onEnd?.();
            }
        }

        return;
    }

    // --- Web browser path ---
    if (!recognition) {
        const rec = await initVoiceRecognition();
        if (!rec) {
            onError?.('Speech recognition not supported. Use Chrome or install the Android app.');
            return;
        }
    }

    isListening = true;

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        if (interimTranscript) {
            onInterim?.(interimTranscript);
        }

        if (finalTranscript) {
            onResult?.(finalTranscript);
        }
    };

    recognition.onend = () => {
        isListening = false;
        onEnd?.();
    };

    recognition.onerror = (event) => {
        isListening = false;
        onError?.(event.error);
    };

    try {
        recognition.start();
    } catch (e) {
        isListening = false;
        onError?.(e.message);
    }
}

/**
 * Stop listening
 */
export async function stopListening() {
    if (useNativeRecognition && nativeSpeechPlugin) {
        try {
            await nativeSpeechPlugin.stop();
        } catch (e) { /* ignore */ }
        isListening = false;
        return;
    }

    if (recognition && isListening) {
        recognition.stop();
        isListening = false;
    }
}

/**
 * Check if currently listening
 */
export function getIsListening() {
    return isListening;
}

// ==========================================
// Advanced Natural Language Date/Time Parser
// ==========================================

/**
 * Extract time from text. Returns { time: "HH:MM", matched: "string matched" } or null.
 */
function extractTime(text) {
    const timePatterns = [
        // "at 10:30 AM", "by 3:30 PM"
        { regex: /(?:at|by|around|for)\s+(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)/i, hourIdx: 1, minIdx: 2, periodIdx: 3 },
        // "at 10 AM"
        { regex: /(?:at|by|around|for)\s+(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/i, hourIdx: 1, minIdx: null, periodIdx: 2 },
        // "10:30 AM" standalone
        { regex: /(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)/i, hourIdx: 1, minIdx: 2, periodIdx: 3 },
        // "10 AM" standalone
        { regex: /(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/i, hourIdx: 1, minIdx: null, periodIdx: 2 },
        // "at 10:30" (24h or contextual)
        { regex: /(?:at|by|around|for)\s+(\d{1,2}):(\d{2})(?!\s*(?:am|pm))/i, hourIdx: 1, minIdx: 2, periodIdx: null },
        // "at noon"
        { regex: /\b(?:at\s+)?noon\b/i, fixed: '12:00' },
        // "at midnight"
        { regex: /\b(?:at\s+)?midnight\b/i, fixed: '00:00' },
        // "in the morning" or standalone "morning" — 9 AM default
        { regex: /\b(?:in\s+the\s+)?morning\b/i, fixed: '09:00' },
        // "in the afternoon" or standalone "afternoon" — 2 PM default
        { regex: /\b(?:in\s+the\s+)?afternoon\b/i, fixed: '14:00' },
        // "in the evening" or standalone "evening" — 6 PM default
        { regex: /\b(?:in\s+the\s+)?evening\b/i, fixed: '18:00' },
        // "at night" or standalone "night" — 9 PM default
        { regex: /\b(?:at\s+)?night\b/i, fixed: '21:00' },
    ];

    for (const tp of timePatterns) {
        const match = text.match(tp.regex);
        if (match) {
            let time;
            if (tp.fixed) {
                time = tp.fixed;
            } else {
                let hours = parseInt(match[tp.hourIdx]);
                const minutes = tp.minIdx ? parseInt(match[tp.minIdx]) : 0;
                if (tp.periodIdx) {
                    const period = match[tp.periodIdx].replace(/\./g, '').toLowerCase();
                    if (period === 'pm' && hours !== 12) hours += 12;
                    if (period === 'am' && hours === 12) hours = 0;
                }
                time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            }
            return { time, matched: match[0] };
        }
    }

    return null;
}

/**
 * Extract relative time ("in X minutes/hours" or "after X minutes/hours") and return an absolute Date.
 * Supports: "in 30 minutes", "after 30 minutes", "in 2 hours", "after 2 hours", etc.
 */
function extractRelativeTime(text, referenceDate) {
    const patterns = [
        // "in 30 minutes", "in 2 hours", "after 30 minutes", "after 2 hours"
        /\b(?:in|after)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/i,
        // "in half an hour", "after half an hour"
        /\b(?:in|after)\s+(?:half\s+an?\s+hour|30\s+min(?:ute)?s?)\b/i,
        // "in an hour", "after an hour"
        /\b(?:in|after)\s+an?\s+hour\b/i,
        // "in a couple hours", "after a couple hours"
        /\b(?:in|after)\s+a\s+couple\s+(?:of\s+)?hours?\b/i,
    ];

    let match = text.match(patterns[0]);
    if (match) {
        const amount = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        const result = new Date(referenceDate);
        if (unit.startsWith('hour') || unit.startsWith('hr')) {
            result.setHours(result.getHours() + amount);
        } else {
            result.setMinutes(result.getMinutes() + amount);
        }
        return { date: result, matched: match[0] };
    }

    match = text.match(patterns[1]);
    if (match) {
        const result = new Date(referenceDate);
        result.setMinutes(result.getMinutes() + 30);
        return { date: result, matched: match[0] };
    }

    match = text.match(patterns[2]);
    if (match) {
        const result = new Date(referenceDate);
        result.setHours(result.getHours() + 1);
        return { date: result, matched: match[0] };
    }

    match = text.match(patterns[3]);
    if (match) {
        const result = new Date(referenceDate);
        result.setHours(result.getHours() + 2);
        return { date: result, matched: match[0] };
    }

    return null;
}

/**
 * Extract date from text. Returns { date: "YYYY-MM-DD", matched: "string matched" } or null.
 */
function extractDate(text, referenceDate) {
    const today = new Date(referenceDate);

    // Named relative dates (order matters — longer patterns first)
    const relativeDates = [
        { regex: /\bday\s+after\s+tomorrow\b/i, offset: 2 },
        { regex: /\btomorrow\b/i, offset: 1 },
        // "today" only matches when in scheduling context (by today, for today, due today, before today)
        // NOT casual speech like "the weather is nice today"
        { regex: /\b(?:by|for|on|due|before|until)\s+today\b/i, offset: 0 },
        { regex: /\btonight\b/i, offset: 0 },
        { regex: /\bthis\s+weekend\b/i, getDate: () => getNextWeekday(today, 6) }, // Saturday
        { regex: /\bnext\s+week\b/i, getDate: () => getNextWeekday(today, 1, true) }, // Next Monday
    ];

    for (const rd of relativeDates) {
        const match = text.match(rd.regex);
        if (match) {
            let date;
            if (rd.getDate) {
                date = rd.getDate();
            } else {
                date = new Date(today);
                date.setDate(date.getDate() + rd.offset);
            }
            return { date: formatDate(date), matched: match[0] };
        }
    }

    // "in X days/weeks"
    const inDaysMatch = text.match(/\bin\s+(\d+)\s*(days?|weeks?)\b/i);
    if (inDaysMatch) {
        const amount = parseInt(inDaysMatch[1]);
        const unit = inDaysMatch[2].toLowerCase();
        const date = new Date(today);
        if (unit.startsWith('week')) {
            date.setDate(date.getDate() + amount * 7);
        } else {
            date.setDate(date.getDate() + amount);
        }
        return { date: formatDate(date), matched: inDaysMatch[0] };
    }

    // Weekday references: "on Monday", "next Friday", "this Tuesday"
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const weekdayPattern = /\b(?:on\s+|next\s+|this\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
    const weekdayMatch = text.match(weekdayPattern);
    if (weekdayMatch) {
        const isNext = /next/i.test(weekdayMatch[0]);
        const targetDay = weekdays.indexOf(weekdayMatch[1].toLowerCase());
        const date = getNextWeekday(today, targetDay, isNext);
        return { date: formatDate(date), matched: weekdayMatch[0] };
    }

    // Specific dates: "March 15", "March 15th", "15th March", "15 March"
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const monthNames = months.join('|');
    const shortMonths = months.map(m => m.slice(0, 3)).join('|');

    // "March 15th" or "March 15"
    const mdy1 = new RegExp(`\\b(${monthNames}|${shortMonths})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`, 'i');
    let specificMatch = text.match(mdy1);
    if (specificMatch) {
        const monthStr = specificMatch[1].toLowerCase();
        const month = months.findIndex(m => m === monthStr || m.startsWith(monthStr));
        const day = parseInt(specificMatch[2]);
        const year = specificMatch[3] ? parseInt(specificMatch[3]) : today.getFullYear();
        if (month >= 0 && day >= 1 && day <= 31) {
            let date = new Date(year, month, day);
            // If the date is in the past and no year was specified, assume next year
            if (!specificMatch[3] && date < today) {
                date = new Date(year + 1, month, day);
            }
            return { date: formatDate(date), matched: specificMatch[0] };
        }
    }

    // "15th March" or "15 March"
    const dmy1 = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames}|${shortMonths})(?:\\s*,?\\s*(\\d{4}))?\\b`, 'i');
    specificMatch = text.match(dmy1);
    if (specificMatch) {
        const day = parseInt(specificMatch[1]);
        const monthStr = specificMatch[2].toLowerCase();
        const month = months.findIndex(m => m === monthStr || m.startsWith(monthStr));
        const year = specificMatch[3] ? parseInt(specificMatch[3]) : today.getFullYear();
        if (month >= 0 && day >= 1 && day <= 31) {
            let date = new Date(year, month, day);
            if (!specificMatch[3] && date < today) {
                date = new Date(year + 1, month, day);
            }
            return { date: formatDate(date), matched: specificMatch[0] };
        }
    }

    // "2/15" or "02/15" or "2-15" — MM/DD format
    const numericDate = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (numericDate) {
        const month = parseInt(numericDate[1]) - 1;
        const day = parseInt(numericDate[2]);
        let year = numericDate[3] ? parseInt(numericDate[3]) : today.getFullYear();
        if (year < 100) year += 2000;
        if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
            let date = new Date(year, month, day);
            if (!numericDate[3] && date < today) {
                date = new Date(year + 1, month, day);
            }
            return { date: formatDate(date), matched: numericDate[0] };
        }
    }

    return null;
}

/**
 * Get the next occurrence of a specific weekday.
 */
function getNextWeekday(from, targetDay, forceNextWeek = false) {
    const date = new Date(from);
    const currentDay = date.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0 || forceNextWeek) daysUntil += 7;
    date.setDate(date.getDate() + daysUntil);
    return date;
}

/**
 * Extract recurrence from text.
 */
function extractRecurrence(text) {
    const recurrencePatterns = [
        { regex: /\bevery\s*day\b|\bdaily\b/i, value: 'daily' },
        { regex: /\bevery\s*weekday\b|\bweekdays\b/i, value: 'weekdays' },
        { regex: /\bevery\s*weekend\b|\bweekends\b/i, value: 'weekends' },
        { regex: /\bevery\s*week\b|\bweekly\b/i, value: 'weekly' },
        { regex: /\bevery\s*month\b|\bmonthly\b/i, value: 'monthly' },
        { regex: /\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, value: 'weekly' },
    ];

    for (const { regex, value } of recurrencePatterns) {
        const match = text.match(regex);
        if (match) {
            return { recurrence: value, matched: match[0] };
        }
    }

    return null;
}

/**
 * Extract priority from text.
 */
function extractPriority(text) {
    const priorityPatterns = [
        { regex: /\b(?:urgent|critical|asap|immediately|important)\b/i, value: 'high' },
        { regex: /\bhigh\s+priority\b/i, value: 'high' },
        { regex: /\blow\s+priority\b/i, value: 'low' },
    ];

    for (const { regex, value } of priorityPatterns) {
        const match = text.match(regex);
        if (match) {
            return { priority: value, matched: match[0] };
        }
    }

    return null;
}

/**
 * Parse a natural language voice command into a structured result.
 *
 * Handles phrases like:
 *   - "Remind me to prepare lunch at 10 AM"
 *   - "Set an alarm for 3:30 PM to pick up groceries"
 *   - "Remember to call mom every day at 5 PM"
 *   - "Remind me about the meeting tomorrow at 9 AM"
 *   - "Buy groceries on March 15th at 4 PM" → note with reminder
 *   - "Doctor appointment next Monday at 2 PM" → note with reminder
 *   - "Call the plumber in 2 hours" → note with reminder
 *   - "I need to submit the report by Friday 5 PM" → note with reminder
 *   - "Just a random thought about my project" → plain note
 */
export function parseVoiceCommand(transcript) {
    const text = transcript.toLowerCase().trim();
    const now = new Date();

    const result = {
        title: '',
        message: '',
        time: null,
        date: null,
        recurrence: 'none',
        priority: 'medium',
        isReminder: false,
        hasDateTime: false, // true if the text mentions any date/time
    };

    // ---- Step 1: Check for explicit reminder keywords ----
    const reminderPatterns = [
        /remind\s+me\s+(to|about|that)\s+/i,
        /set\s+(an?\s+)?(?:alarm|reminder|timer)\s+(for\s+)?/i,
        /remember\s+(to\s+)?/i,
        /don'?t\s+forget\s+(to\s+)?/i,
        /wake\s+me\s+up\s+/i,
        /alert\s+me\s+(to|about|for)\s+/i,
        /notify\s+me\s+(to|about|for)\s+/i,
    ];

    let taskText = text;
    for (const pattern of reminderPatterns) {
        if (pattern.test(text)) {
            result.isReminder = true;
            taskText = text.replace(pattern, '').trim();
            break;
        }
    }

    // ---- Step 2: Extract relative time ("in 30 minutes") ----
    const relativeResult = extractRelativeTime(taskText, now);
    if (relativeResult) {
        result.time = `${relativeResult.date.getHours().toString().padStart(2, '0')}:${relativeResult.date.getMinutes().toString().padStart(2, '0')}`;
        result.date = formatDate(relativeResult.date);
        result.hasDateTime = true;
        taskText = taskText.replace(relativeResult.matched, '').trim();
    }

    // ---- Step 3: Extract explicit time ----
    if (!result.time) {
        const timeResult = extractTime(taskText);
        if (timeResult) {
            result.time = timeResult.time;
            result.hasDateTime = true;
            taskText = taskText.replace(timeResult.matched, '').trim();
        }
    }

    // ---- Step 4: Extract date ----
    if (!result.date) {
        const dateResult = extractDate(taskText, now);
        if (dateResult) {
            result.date = dateResult.date;
            result.hasDateTime = true;
            taskText = taskText.replace(dateResult.matched, '').trim();
        }
    }

    // ---- Step 5: Extract recurrence ----
    const recurrenceResult = extractRecurrence(taskText);
    if (recurrenceResult) {
        result.recurrence = recurrenceResult.recurrence;
        result.hasDateTime = true;
        taskText = taskText.replace(recurrenceResult.matched, '').trim();
    }

    // ---- Step 6: Extract priority ----
    const priorityResult = extractPriority(taskText);
    if (priorityResult) {
        result.priority = priorityResult.priority;
        taskText = taskText.replace(priorityResult.matched, '').trim();
    }

    // ---- Step 7: If text has date/time but no explicit reminder keyword, still mark as reminder ----
    if (!result.isReminder && result.hasDateTime) {
        result.isReminder = true;
    }

    // ---- Step 8: Default date/time ----
    if (!result.date) {
        if (result.time) {
            // If time is given but no date, set to today or tomorrow
            const [h, m] = result.time.split(':').map(Number);
            const reminderTime = new Date(now);
            reminderTime.setHours(h, m, 0, 0);
            if (reminderTime <= now) {
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                result.date = formatDate(tomorrow);
            } else {
                result.date = formatDate(now);
            }
        } else {
            result.date = formatDate(now);
        }
    }

    if (!result.time) {
        // Default: 30 minutes from now
        const futureTime = new Date(now);
        futureTime.setMinutes(futureTime.getMinutes() + 30);
        result.time = `${futureTime.getHours().toString().padStart(2, '0')}:${futureTime.getMinutes().toString().padStart(2, '0')}`;
    }

    // ---- Step 9: Clean up title ----
    taskText = taskText
        .replace(/\b(at|by|around|for|on|in|after|the|every|each|to|and|then|also|please|can you|morning|afternoon|evening|night|this|next|due|before|until|set|remind|me|reminder|alarm|timer|remember|don't|forget|wake|up|alert|notify|an?|about|that)\b/gi, ' ')
        .replace(/\d{1,2}:\d{2}/g, '')          // remove leftover time digits like "5:05"
        .replace(/\d{1,2}\s*(am|pm)/gi, '')     // remove leftover "5 am"
        .replace(/\s+/g, ' ')
        .trim();

    // Capitalize first letter
    if (taskText) {
        result.title = taskText.charAt(0).toUpperCase() + taskText.slice(1);
    }

    // ---- Step 10: Generate default title if empty ----
    if (!result.title && result.isReminder) {
        // Build a contextual title from the time/date
        if (result.time) {
            const [h, m] = result.time.split(':').map(Number);
            const period = h >= 12 ? 'PM' : 'AM';
            const displayHour = h > 12 ? h - 12 : (h === 0 ? 12 : h);
            const displayMin = m > 0 ? `:${m.toString().padStart(2, '0')}` : '';
            result.title = `Reminder at ${displayHour}${displayMin} ${period}`;
        } else {
            result.title = 'Reminder';
        }
    }

    return result;
}

function formatDate(date) {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

// ==========================================
// Passive Continuous Listening Mode
// ==========================================
// Listens in the background using Web Speech API.
// When the user says something starting with "Remind me about...",
// the full transcript is captured and forwarded to the app.
// On native Android, we re-invoke the speech recognizer in a loop.

/**
 * Start passive (always-on) listening.
 * @param {Function} onReminder - callback(transcript) when a "remind me" phrase is detected
 * @param {Function} onStatusChange - callback(status) for UI updates: 'listening', 'processing', 'paused', 'error'
 */
export function initPassiveListening(onReminder, onStatusChange) {
    passiveOnReminder = onReminder;

    // --- Native Android: loop-start speech recognition ---
    if (useNativeRecognition && nativeSpeechPlugin) {
        startNativePassiveLoop(onStatusChange);
        return;
    }

    // --- Web browser: continuous Web Speech API ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn('❌ Passive listening not available (no Web Speech API)');
        onStatusChange?.('error');
        return;
    }

    passiveRecognition = new SpeechRecognition();
    passiveRecognition.continuous = true;
    passiveRecognition.interimResults = true;
    passiveRecognition.lang = 'en-US';
    passiveRecognition.maxAlternatives = 1;

    let accumulatedTranscript = '';
    let wakeDetected = false;

    passiveRecognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        // Check interim + final for wake phrase
        const fullText = (accumulatedTranscript + ' ' + finalTranscript + ' ' + interimTranscript).toLowerCase();

        if (!wakeDetected && isWakePhrase(fullText)) {
            wakeDetected = true;
            onStatusChange?.('processing');
        }

        if (finalTranscript) {
            accumulatedTranscript += ' ' + finalTranscript;
        }

        // If wake phrase was detected and we got a final transcript,
        // wait a bit for the user to finish speaking, then fire callback
        if (wakeDetected && finalTranscript) {
            // The user has finished a sentence chunk. We'll capture everything.
            const cleaned = accumulatedTranscript.trim();
            if (cleaned.length > 5) {
                // Small delay to see if user keeps speaking
                setTimeout(() => {
                    if (accumulatedTranscript.trim() === cleaned) {
                        // User stopped — fire callback with full transcript
                        passiveOnReminder?.(cleaned);
                        // Reset state
                        accumulatedTranscript = '';
                        wakeDetected = false;
                        onStatusChange?.('listening');
                    }
                }, 1500);
            }
        }
    };

    passiveRecognition.onend = () => {
        // Auto-restart if passive mode is still active
        if (isPassiveListening) {
            try {
                setTimeout(() => {
                    if (isPassiveListening && passiveRecognition) {
                        passiveRecognition.start();
                    }
                }, 300);
            } catch (e) {
                console.warn('Passive restart failed:', e);
            }
        }
    };

    passiveRecognition.onerror = (event) => {
        console.warn('Passive listening error:', event.error);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            isPassiveListening = false;
            onStatusChange?.('error');
            return;
        }
        // For transient errors (no-speech, network, etc.), auto-restart
        if (isPassiveListening) {
            setTimeout(() => {
                if (isPassiveListening && passiveRecognition) {
                    try { passiveRecognition.start(); } catch (e) { /* ignore */ }
                }
            }, 1000);
        }
    };

    try {
        isPassiveListening = true;
        passiveRecognition.start();
        onStatusChange?.('listening');
        console.log('🎧 Passive listening started (Web Speech API)');
    } catch (e) {
        console.error('Failed to start passive listening:', e);
        isPassiveListening = false;
        onStatusChange?.('error');
    }
}

/**
 * Native Android passive loop — re-invokes speech recognition repeatedly
 */
async function startNativePassiveLoop(onStatusChange) {
    isPassiveListening = true;
    onStatusChange?.('listening');
    console.log('🎧 Passive listening started (Native Android loop)');

    while (isPassiveListening) {
        try {
            const result = await nativeSpeechPlugin.start({
                language: 'en-US',
                maxResults: 1,
                prompt: '',
                partialResults: false,
                popup: false,  // No UI popup — silent background listening
            });

            if (result && result.matches && result.matches.length > 0) {
                const transcript = result.matches[0];
                if (isWakePhrase(transcript.toLowerCase())) {
                    onStatusChange?.('processing');
                    passiveOnReminder?.(transcript);
                    onStatusChange?.('listening');
                }
                // If not a wake phrase, just ignore and loop again
            }
        } catch (err) {
            // Speech recognition cancelled or timed out — just restart
            console.warn('Native passive loop error (restarting):', err.message || err);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    onStatusChange?.('paused');
}

/**
 * Stop passive listening
 */
export function stopPassiveListening() {
    isPassiveListening = false;

    if (passiveRecognition) {
        try { passiveRecognition.stop(); } catch (e) { /* ignore */ }
        passiveRecognition = null;
    }

    if (useNativeRecognition && nativeSpeechPlugin) {
        try { nativeSpeechPlugin.stop(); } catch (e) { /* ignore */ }
    }

    console.log('🔇 Passive listening stopped');
}

/**
 * Check if the text contains a "remind me" wake phrase
 */
function isWakePhrase(text) {
    const wakePatterns = [
        /remind\s+me\s+(about|to|that)/i,
        /remind\s+me/i,
        /set\s+(an?\s+)?(?:alarm|reminder|timer)/i,
        /remember\s+to/i,
        /don'?t\s+forget/i,
        /i\s+have\s+to/i,
        /i\s+need\s+to/i,
        /note\s+(that|this|down)/i,
        /save\s+(this|a)\s+note/i,
    ];
    return wakePatterns.some(p => p.test(text));
}

/**
 * Get passive listening status
 */
export function getIsPassiveListening() {
    return isPassiveListening;
}
