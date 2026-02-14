/**
 * RemindMe AI — Alarm Scheduler
 * Checks reminders every second and triggers alarms
 */

import { getAllItems, addItem, deleteItem } from './db.js';

let schedulerInterval = null;
let onAlarmCallback = null;
const triggeredIds = new Set(); // Prevent double-trigger within same minute

/**
 * Start the alarm scheduler
 * Checks every second for due reminders
 */
export function startScheduler(callback) {
    onAlarmCallback = callback;

    if (schedulerInterval) {
        clearInterval(schedulerInterval);
    }

    schedulerInterval = setInterval(checkReminders, 1000);
    console.log('⏰ Alarm scheduler started');
}

/**
 * Stop the scheduler
 */
export function stopScheduler() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
    }
}

/**
 * Check all reminders against current time
 */
async function checkReminders() {
    try {
        const reminders = await getAllItems('reminders');
        const now = new Date();
        const currentDate = formatDateStr(now);
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        for (const reminder of reminders) {
            if (reminder.completed) continue;

            const minuteKey = `${reminder.id}_${currentDate}_${currentTime}`;
            if (triggeredIds.has(minuteKey)) continue;

            if (shouldTrigger(reminder, currentDate, currentTime, now)) {
                triggeredIds.add(minuteKey);

                // Clean old triggered IDs (keep last 100)
                if (triggeredIds.size > 100) {
                    const arr = Array.from(triggeredIds);
                    arr.slice(0, arr.length - 50).forEach(id => triggeredIds.delete(id));
                }

                // Fire the alarm callback
                if (onAlarmCallback) {
                    onAlarmCallback(reminder);
                }

                // Handle recurrence: update next date
                if (reminder.recurrence && reminder.recurrence !== 'none') {
                    const nextDate = getNextRecurrenceDate(reminder.recurrence, now);
                    if (nextDate) {
                        reminder.datetime = `${nextDate}T${reminder.time}`;
                        reminder.date = nextDate;
                        await addItem('reminders', reminder);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Scheduler error:', e);
    }
}

/**
 * Check if a reminder should trigger now
 */
function shouldTrigger(reminder, currentDate, currentTime, now) {
    const reminderTime = reminder.time;

    if (!reminderTime) return false;

    // For non-recurring, check exact date and time
    if (!reminder.recurrence || reminder.recurrence === 'none') {
        return reminder.date === currentDate && reminderTime === currentTime;
    }

    // For recurring, check if time matches and recurrence pattern fits today
    if (reminderTime !== currentTime) return false;

    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

    switch (reminder.recurrence) {
        case 'daily':
            return true;
        case 'weekdays':
            return dayOfWeek >= 1 && dayOfWeek <= 5;
        case 'weekends':
            return dayOfWeek === 0 || dayOfWeek === 6;
        case 'weekly':
            // Trigger on the same day of the week as originally set
            const originalDate = new Date(reminder.date);
            return originalDate.getDay() === dayOfWeek;
        case 'monthly':
            // Trigger on the same day of the month
            const origDate = new Date(reminder.date);
            return origDate.getDate() === now.getDate();
        default:
            return reminder.date === currentDate && reminderTime === currentTime;
    }
}

/**
 * Calculate next recurrence date
 */
function getNextRecurrenceDate(recurrence, fromDate) {
    const next = new Date(fromDate);

    switch (recurrence) {
        case 'daily':
            next.setDate(next.getDate() + 1);
            break;
        case 'weekdays':
            do {
                next.setDate(next.getDate() + 1);
            } while (next.getDay() === 0 || next.getDay() === 6);
            break;
        case 'weekends':
            do {
                next.setDate(next.getDate() + 1);
            } while (next.getDay() !== 0 && next.getDay() !== 6);
            break;
        case 'weekly':
            next.setDate(next.getDate() + 7);
            break;
        case 'monthly':
            next.setMonth(next.getMonth() + 1);
            break;
        default:
            return null;
    }

    return formatDateStr(next);
}

function formatDateStr(date) {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

/**
 * Snooze a reminder by N minutes
 */
export async function snoozeReminder(reminder, minutes = 5) {
    const now = new Date();
    now.setMinutes(now.getMinutes() + minutes);

    reminder.date = formatDateStr(now);
    reminder.time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    reminder.datetime = `${reminder.date}T${reminder.time}`;
    reminder.snoozed = true;

    await addItem('reminders', reminder);
    return reminder;
}

/**
 * Complete a reminder (move to history)
 */
export async function completeReminder(reminder) {
    // If non-recurring, mark as completed
    if (!reminder.recurrence || reminder.recurrence === 'none') {
        const historyItem = {
            ...reminder,
            id: `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            originalId: reminder.id,
            completedAt: new Date().toISOString(),
        };
        await addItem('history', historyItem);
        await deleteItem('reminders', reminder.id);
    }
    // Recurring reminders just get their date updated (handled in checkReminders)
}
