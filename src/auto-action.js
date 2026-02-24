/**
 * RemindMe AI — Autonomous Action Engine
 * 
 * After a voice conversation ends, this module:
 *   1. Sends the transcript to the AI with a special action-oriented prompt
 *   2. Parses the AI's response for structured actions (create reminder, note, ask question)
 *   3. Executes those actions automatically (saves to DB, speaks confirmations)
 *   4. If clarification is needed, speaks the question and re-enters conversation mode
 * 
 * The AI is prompted to return JSON action blocks that this code can parse and execute.
 */

import { addItem, getAllItems, getAllHealthProfile } from './db.js';
import { speak, stopSpeaking } from './audio.js';
import { parseVoiceCommand } from './voice.js';
import { generateResponse, isModelReady, getPlatformInfo } from './llm-bridge.js';
import { getPersonalisedHealthContext } from './health-rag.js';
import { handleHealthToolCall } from './health-chat.js';

// ====================================================
// Action Prompt Builder
// ====================================================

/**
 * Build a prompt that instructs the AI to return structured actions.
 */
function buildActionPrompt(transcript, userName, existingReminders, existingNotes) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // Build brief context about existing items
    const reminderSummary = existingReminders.slice(0, 5)
        .filter(r => !r.completed)
        .map(r => `- ${r.title} (${r.date} ${r.time})`)
        .join('\n') || 'No upcoming reminders.';

    const noteSummary = existingNotes.slice(0, 5)
        .map(n => `- ${n.title}`)
        .join('\n') || 'No recent notes.';

    return `You are Amma, a voice assistant for health, reminders, and notes. The user just spoke to you.
Current Date: ${dateStr}
Current Time: ${timeStr}
User Name: ${userName || 'Friend'}

USER'S EXISTING REMINDERS:
${reminderSummary}

USER'S RECENT NOTES:
${noteSummary}

INSTRUCTIONS:
Analyze the user's speech and respond with ACTIONS to take. You MUST respond with a JSON object followed by a spoken reply.

ACTION FORMAT (output this JSON first, then your spoken reply):
{"actions": [
  {"type": "REMINDER", "title": "string", "date": "YYYY-MM-DD", "time": "HH:MM", "priority": "low|medium|high", "recurrence": "none|daily|weekly|weekdays|monthly"},
  {"type": "NOTE", "title": "string", "content": "string"},
  {"type": "HEALTH_LOG", "tool": "LOG_WATER|LOG_MEAL|LOG_SLEEP|LOG_SUNLIGHT", "params": {}},
  {"type": "CLARIFY", "question": "string", "options": ["option1", "option2"]}
]}

RULES:
- If the user mentions a time/date, create a REMINDER action.
- If the user shares info worth saving, create a NOTE action.
- If the user mentions drinking water, eating, sleeping, or sunlight, create a HEALTH_LOG action.
- If you're unsure about any detail (time, date, quantity), use a CLARIFY action to ask.
- You can output multiple actions at once.
- If no action is needed, use an empty actions array.
- After the JSON, write a short conversational reply that Amma would speak.
- Keep replies under 2 sentences. Be warm and concise.
- Always add "ⓘ Not medical advice." for health responses.

USER SAID: "${transcript}"

RESPONSE:`;
}

// ====================================================
// Action Executor
// ====================================================

/**
 * Process a conversation transcript through the AI and execute resulting actions.
 * 
 * @param {string} transcript - The full conversation text
 * @param {string} userName - User's name for personalization
 * @param {object} callbacks - { onAction, onSpeak, onClarify, onComplete, onError }
 */
export async function processConversation(transcript, userName, callbacks = {}) {
    if (!transcript || transcript.trim().length === 0) {
        callbacks.onComplete?.();
        return;
    }

    // First, try quick local parsing for simple commands (faster, no API needed)
    const quickResult = tryLocalParsing(transcript, userName);
    if (quickResult.handled) {
        for (const action of quickResult.actions) {
            await executeAction(action, userName, callbacks);
        }
        if (quickResult.spokenReply) {
            callbacks.onSpeak?.(quickResult.spokenReply);
        }
        callbacks.onComplete?.();
        return;
    }

    // For complex requests, use the AI
    if (!isModelReady()) {
        const info = getPlatformInfo();
        const msg = info.isWeb
            ? 'I need a Gemini API key to process that. Please add one in Settings.'
            : 'The AI model needs to be downloaded first. Check Settings.';
        callbacks.onSpeak?.(msg);
        callbacks.onError?.(msg);
        callbacks.onComplete?.();
        return;
    }

    try {
        const [reminders, notes] = await Promise.all([
            getAllItems('reminders'),
            getAllItems('notes'),
        ]);

        const prompt = buildActionPrompt(transcript, userName, reminders, notes);

        // Add health context if relevant
        let fullPrompt = prompt;
        try {
            const profile = await getAllHealthProfile();
            const healthCtx = getPersonalisedHealthContext(profile, transcript);
            if (healthCtx) {
                fullPrompt = healthCtx + '\n\n' + prompt;
            }
        } catch (e) {
            // Health context is optional
        }

        const response = await generateResponse(fullPrompt);

        // Parse the response for actions and spoken text
        const parsed = parseAIResponse(response);

        // Execute each action
        for (const action of parsed.actions) {
            await executeAction(action, userName, callbacks);
        }

        // Handle health tool calls in the spoken text
        if (parsed.spokenReply) {
            const healthResult = await handleHealthToolCall(parsed.spokenReply);
            const fullReply = healthResult
                ? parsed.spokenReply + ' ' + healthResult
                : parsed.spokenReply;

            callbacks.onSpeak?.(fullReply);
        }

        // Handle clarification (returns the question so the caller can re-listen)
        if (parsed.clarification) {
            callbacks.onClarify?.(parsed.clarification);
        }

        callbacks.onComplete?.();

    } catch (err) {
        console.error('Action processing error:', err);
        callbacks.onError?.(err.message);
        callbacks.onSpeak?.("Sorry, I had trouble processing that. Could you try again?");
        callbacks.onComplete?.();
    }
}

// ====================================================
// Response Parser
// ====================================================

/**
 * Parse the AI's response to extract JSON actions and the spoken reply.
 */
function parseAIResponse(response) {
    const result = {
        actions: [],
        spokenReply: '',
        clarification: null,
    };

    try {
        // Try to find JSON in the response
        const jsonMatch = response.match(/\{[\s\S]*?"actions"\s*:\s*\[[\s\S]*?\]\s*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed.actions)) {
                result.actions = parsed.actions;

                // Check for clarification actions
                const clarifyAction = result.actions.find(a => a.type === 'CLARIFY');
                if (clarifyAction) {
                    result.clarification = {
                        question: clarifyAction.question,
                        options: clarifyAction.options || [],
                    };
                }
            }

            // The spoken reply is everything after the JSON
            result.spokenReply = response.substring(jsonMatch.index + jsonMatch[0].length).trim();
        } else {
            // No JSON found — treat the whole response as spoken text
            result.spokenReply = response.trim();
        }
    } catch (e) {
        console.warn('Failed to parse AI action response:', e);
        result.spokenReply = response.trim();
    }

    return result;
}

// ====================================================
// Local Fast-Parser (for simple commands without AI)
// ====================================================

function tryLocalParsing(transcript, userName) {
    const result = { handled: false, actions: [], spokenReply: '' };
    const parsed = parseVoiceCommand(transcript);

    if (parsed.isReminder && parsed.title) {
        // Simple reminder creation
        result.handled = true;
        result.actions.push({
            type: 'REMINDER',
            title: parsed.title,
            date: parsed.date,
            time: parsed.time,
            priority: parsed.priority || 'medium',
            recurrence: parsed.recurrence || 'none',
        });

        const timeStr = formatTime(parsed.time);
        result.spokenReply = `Got it, ${userName || 'friend'}! I set a reminder for "${parsed.title}" at ${timeStr}.`;
        return result;
    }

    // Check for health logging keywords (quick match)
    const lower = transcript.toLowerCase();
    if (/\b(drank|drink|had)\s+\d*\s*(?:glass|cup|bottle|ml|water)\b/.test(lower) ||
        /\b(?:i\s+)?drank\s+water\b/.test(lower)) {
        // Let AI handle health logs for more accuracy
        return result;
    }

    return result;
}

// ====================================================
// Action Executor
// ====================================================

async function executeAction(action, userName, callbacks) {
    const now = new Date();

    switch (action.type) {
        case 'REMINDER': {
            const reminder = {
                id: `rem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                title: action.title || 'Reminder',
                message: `Hey ${userName || 'friend'}! Time: ${action.title}`,
                date: action.date || formatDate(now),
                time: action.time || '09:00',
                datetime: `${action.date || formatDate(now)}T${action.time || '09:00'}`,
                recurrence: action.recurrence || 'none',
                priority: action.priority || 'medium',
                completed: false,
                createdAt: now.toISOString(),
                source: 'voice-auto',
            };
            await addItem('reminders', reminder);
            callbacks.onAction?.('reminder', reminder);
            console.log('📌 Auto-created reminder:', reminder.title);
            break;
        }

        case 'NOTE': {
            const note = {
                id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                title: action.title || 'Voice Note',
                content: action.content || action.title || '',
                color: 'default',
                hasReminder: false,
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            };
            await addItem('notes', note);
            callbacks.onAction?.('note', note);
            console.log('📝 Auto-created note:', note.title);
            break;
        }

        case 'HEALTH_LOG': {
            // Health logs are handled via the health-chat tool call system
            const toolCall = JSON.stringify({
                tool: action.tool,
                params: action.params || {},
            });
            const healthResult = await handleHealthToolCall(toolCall);
            if (healthResult) {
                callbacks.onAction?.('health', { tool: action.tool, result: healthResult });
            }
            console.log('❤️ Auto-logged health:', action.tool);
            break;
        }

        case 'CLARIFY': {
            // Handled by the caller — speak the question and re-listen
            callbacks.onAction?.('clarify', action);
            console.log('❓ Clarification needed:', action.question);
            break;
        }

        default:
            console.warn('Unknown action type:', action.type);
    }
}

// ====================================================
// Helpers
// ====================================================

function formatDate(date) {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

function formatTime(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    return `${hour}:${m.toString().padStart(2, '0')} ${period}`;
}
