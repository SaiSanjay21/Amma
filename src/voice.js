/**
 * RemindMe AI — Voice Command Engine
 * Handles speech recognition and natural language parsing
 * with advanced date/time extraction for smart scheduling
 */

let recognition = null;
let isListening = false;

/**
 * Initialize Speech Recognition
 */
export function initVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        console.warn('Speech Recognition not supported in this browser');
        return null;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    return recognition;
}

/**
 * Start listening for voice commands
 */
export function startListening(onResult, onInterim, onEnd, onError) {
    if (!recognition) {
        const rec = initVoiceRecognition();
        if (!rec) {
            onError?.('Speech recognition not supported in this browser');
            return;
        }
    }

    if (isListening) {
        stopListening();
        return;
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
export function stopListening() {
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
 * Extract relative time ("in X minutes/hours") and return an absolute Date.
 */
function extractRelativeTime(text, referenceDate) {
    const patterns = [
        // "in 30 minutes", "in 2 hours"
        /\bin\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/i,
        // "in half an hour"
        /\bin\s+(?:half\s+an?\s+hour|30\s+min(?:ute)?s?)\b/i,
        // "in an hour"
        /\bin\s+an?\s+hour\b/i,
        // "in a couple hours"
        /\bin\s+a\s+couple\s+(?:of\s+)?hours?\b/i,
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
        .replace(/\b(at|by|around|for|on|in|the|every|each|to|and|then|also|please|can you|morning|afternoon|evening|night|this|next|due|before|until)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Capitalize first letter
    if (taskText) {
        result.title = taskText.charAt(0).toUpperCase() + taskText.slice(1);
    }

    return result;
}

function formatDate(date) {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}
