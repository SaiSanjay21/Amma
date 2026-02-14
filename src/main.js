/**
 * RemindMe AI — Main Application
 * Smart Voice-Powered Reminder & Notes App
 */

import './style.css';
import { openDB, addItem, getAllItems, deleteItem, getSetting, setSetting, exportAllData, importAllData, deleteAllData } from './db.js';
import { playAlarmSound, stopAlarmSound, speak, getVoices, playNotificationSound } from './audio.js';
import { startListening, stopListening, parseVoiceCommand, initVoiceRecognition } from './voice.js';
import { startScheduler, snoozeReminder, completeReminder } from './scheduler.js';

// ==========================================
// App State
// ==========================================
let userName = '';
let currentView = 'reminders';
let currentFilter = 'all';
let settings = {
    voice: null,
    rate: 1,
    alarmSound: 'gentle',
    volume: 0.7,
    snoozeDuration: 5,
    notifications: true,
    speakReminders: true,
};
let currentAlarmReminder = null;

// ==========================================
// Custom Confirm Dialog (replaces native confirm)
// ==========================================
function showConfirm(title = 'Are you sure?', message = 'This action cannot be undone.', okLabel = 'Delete') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');

        titleEl.textContent = title;
        messageEl.textContent = message;
        okBtn.textContent = okLabel;
        modal.classList.remove('hidden');

        function cleanup() {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
        }

        function onOk() {
            cleanup();
            resolve(true);
        }

        function onCancel() {
            cleanup();
            resolve(false);
        }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}

// ==========================================
// Initialization
// ==========================================
async function init() {
    try {
        await openDB();

        // Load user settings
        userName = await getSetting('userName', '');
        settings.voice = await getSetting('voice', null);
        settings.rate = await getSetting('rate', 1);
        settings.alarmSound = await getSetting('alarmSound', 'gentle');
        settings.volume = await getSetting('volume', 0.7);
        settings.snoozeDuration = await getSetting('snoozeDuration', 5);
        settings.notifications = await getSetting('notifications', true);
        settings.speakReminders = await getSetting('speakReminders', true);

        // Show onboarding if no name set
        if (!userName) {
            showOnboarding();
        } else {
            document.getElementById('onboarding-modal').classList.add('hidden');
            updateUserAvatar();
        }

        // Initialize UI
        initNavigation();
        initVoice();
        initModals();
        initSettings();
        initSearch();

        // Render current view
        await renderReminders();
        await renderNotes();

        // Start alarm scheduler
        startScheduler(handleAlarm);

        // Request notification permission
        if (settings.notifications && 'Notification' in window) {
            Notification.requestPermission();
        }

        console.log('🚀 RemindMe AI initialized');
    } catch (error) {
        console.error('Init error:', error);
    }
}

// ==========================================
// Onboarding
// ==========================================
function showOnboarding() {
    const modal = document.getElementById('onboarding-modal');
    modal.classList.remove('hidden');

    const input = document.getElementById('user-name-input');
    const submitBtn = document.getElementById('onboarding-submit');

    submitBtn.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) {
            input.style.borderColor = 'var(--danger)';
            input.focus();
            return;
        }

        userName = name;
        await setSetting('userName', name);
        modal.classList.add('hidden');
        updateUserAvatar();

        // Welcome message
        playNotificationSound();
        speak(`Welcome to RemindMe AI, ${userName}! I'm your personal reminder assistant. You can talk to me anytime by clicking the microphone button.`, settings.voice, settings.rate);
    });

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitBtn.click();
    });
}

function updateUserAvatar() {
    const avatar = document.getElementById('user-avatar');
    avatar.textContent = userName.charAt(0).toUpperCase();
    avatar.title = userName;

    // Update settings name field
    const settingsName = document.getElementById('settings-name');
    if (settingsName) settingsName.value = userName;
}

// ==========================================
// Navigation
// ==========================================
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            switchView(view);

            // Close sidebar on mobile
            sidebar.classList.remove('open');
        });
    });

    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('open');
        }
    });
}

function switchView(view) {
    currentView = view;

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
    });

    // Update views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');

    // Update page title
    const titles = {
        reminders: 'Reminders',
        notes: 'Notes',
        history: 'History',
        settings: 'Settings',
    };
    document.getElementById('page-title').textContent = titles[view] || view;

    // Refresh data
    if (view === 'reminders') renderReminders();
    if (view === 'notes') renderNotes();
    if (view === 'history') renderHistory();
}

// ==========================================
// Voice Commands
// ==========================================
function initVoice() {
    const voiceBtn = document.getElementById('voice-btn');
    const voiceOverlay = document.getElementById('voice-overlay');
    const voiceCancel = document.getElementById('voice-cancel');
    const voiceTranscript = document.getElementById('voice-transcript');
    const voiceStatus = document.getElementById('voice-status');

    // Check if speech recognition is supported
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        voiceStatus.classList.add('error');
        voiceStatus.querySelector('span').textContent = 'Voice Not Supported';
        voiceBtn.title = 'Speech recognition requires Chrome or Edge browser';
        return;
    }

    initVoiceRecognition();

    voiceBtn.addEventListener('click', () => {
        voiceBtn.classList.add('active');
        voiceOverlay.classList.remove('hidden');
        voiceTranscript.textContent = 'Say something like "Remind me to prepare lunch at 10 AM every day"';

        startListening(
            // onResult (final)
            async (transcript) => {
                voiceTranscript.textContent = transcript;
                voiceBtn.classList.remove('active');

                // Small delay before closing overlay 
                setTimeout(() => {
                    voiceOverlay.classList.add('hidden');
                }, 500);

                // Parse the command
                const parsed = parseVoiceCommand(transcript);

                if (parsed.isReminder && parsed.title) {
                    // ---- Case 1 & 2: Contains date/time → Create a reminder ----
                    const message = parsed.message || generateReminderMessage(parsed.title);

                    const reminder = {
                        id: `rem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        title: parsed.title,
                        message: message,
                        date: parsed.date,
                        time: parsed.time,
                        datetime: `${parsed.date}T${parsed.time}`,
                        recurrence: parsed.recurrence,
                        priority: parsed.priority || 'medium',
                        completed: false,
                        createdAt: new Date().toISOString(),
                        source: 'voice',
                    };

                    await addItem('reminders', reminder);

                    // If it had date/time but no explicit "remind me" keyword,
                    // also save the original transcript as a note with the reminder attached
                    if (parsed.hasDateTime && !isExplicitReminderKeyword(transcript)) {
                        const note = {
                            id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            title: parsed.title || 'Voice Note',
                            content: transcript,
                            color: 'default',
                            hasReminder: true,
                            reminderDate: parsed.date,
                            reminderTime: parsed.time,
                            reminderRecurrence: parsed.recurrence,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        };
                        await addItem('notes', note);
                        await renderNotes();
                    }

                    await renderReminders();
                    switchView('reminders');

                    playNotificationSound();
                    const timeStr = formatTimeDisplay(parsed.time);
                    const dateStr = formatDateDisplay(parsed.date);
                    const recStr = parsed.recurrence !== 'none' ? `, ${parsed.recurrence}` : '';
                    const confirmMsg = `Got it, ${userName}! I'll remind you about ${parsed.title} on ${dateStr} at ${timeStr}${recStr}.`;
                    speak(confirmMsg, settings.voice, settings.rate);

                    showToast(`Reminder set for ${dateStr} at ${timeStr} 🎤`, 'success');
                } else {
                    // ---- Case 3: No date/time detected → Save as a plain note ----
                    const note = {
                        id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        title: parsed.title || 'Voice Note',
                        content: transcript,
                        color: 'default',
                        hasReminder: false,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    };

                    await addItem('notes', note);
                    await renderNotes();
                    switchView('notes');

                    playNotificationSound();
                    speak(`I saved that as a note for you, ${userName}.`, settings.voice, settings.rate);
                    showToast('Saved as a voice note! 📝', 'info');
                }
            },
            // onInterim
            (interim) => {
                voiceTranscript.textContent = interim;
            },
            // onEnd
            () => {
                voiceBtn.classList.remove('active');
            },
            // onError
            (error) => {
                voiceBtn.classList.remove('active');
                voiceOverlay.classList.add('hidden');
                console.error('Voice error:', error);
                if (error === 'not-allowed') {
                    showToast('Microphone access denied. Please allow microphone permissions.', 'error');
                } else {
                    showToast('Voice recognition error. Please try again.', 'error');
                }
            }
        );
    });

    voiceCancel.addEventListener('click', () => {
        stopListening();
        voiceBtn.classList.remove('active');
        voiceOverlay.classList.add('hidden');
    });
}

function generateReminderMessage(title) {
    const greetings = [
        `Hey ${userName}! It's time to ${title.toLowerCase()}.`,
        `Hey ${userName}, just a reminder: ${title.toLowerCase()}. Let's go!`,
        `${userName}, heads up! Time to ${title.toLowerCase()}.`,
        `Yo ${userName}! Don't forget, you need to ${title.toLowerCase()} now!`,
        `Hey ${userName}, this is your reminder to ${title.toLowerCase()}. You got this!`,
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
}

/**
 * Check if the transcript uses an explicit reminder keyword.
 * When true, only a reminder is created.
 * When false (but date/time detected), both a note AND reminder are created.
 */
function isExplicitReminderKeyword(transcript) {
    const text = transcript.toLowerCase();
    return /remind\s+me/i.test(text) ||
        /set\s+(an?\s+)?(?:alarm|reminder|timer)/i.test(text) ||
        /remember\s+to/i.test(text) ||
        /don'?t\s+forget/i.test(text) ||
        /wake\s+me\s+up/i.test(text) ||
        /alert\s+me/i.test(text) ||
        /notify\s+me/i.test(text);
}

// ==========================================
// Alarm Handler
// ==========================================
function handleAlarm(reminder) {
    currentAlarmReminder = reminder;

    // Play alarm sound
    playAlarmSound(settings.alarmSound, settings.volume);

    // Show alarm overlay
    const overlay = document.getElementById('alarm-overlay');
    const title = document.getElementById('alarm-title');
    const message = document.getElementById('alarm-message');

    title.textContent = reminder.title;
    message.textContent = reminder.message || `It's time for: ${reminder.title}`;
    overlay.classList.remove('hidden');

    // Speak the reminder
    if (settings.speakReminders) {
        setTimeout(() => {
            const spokenMessage = reminder.message || `Hey ${userName}, it's time to ${reminder.title.toLowerCase()}.`;
            speak(spokenMessage, settings.voice, settings.rate);
        }, 2000); // Delay to let alarm sound play first
    }

    // Browser notification
    if (settings.notifications && 'Notification' in window && Notification.permission === 'granted') {
        const notif = new Notification(`RemindMe AI — ${reminder.title}`, {
            body: reminder.message || `It's time for: ${reminder.title}`,
            icon: '🔔',
            tag: reminder.id,
            requireInteraction: true,
        });
        notif.onclick = () => {
            window.focus();
            notif.close();
        };
    }

    // Setup alarm actions
    const snoozeBtn = document.getElementById('alarm-snooze');
    const dismissBtn = document.getElementById('alarm-dismiss');

    // Remove previous listeners
    const newSnooze = snoozeBtn.cloneNode(true);
    const newDismiss = dismissBtn.cloneNode(true);
    snoozeBtn.parentNode.replaceChild(newSnooze, snoozeBtn);
    dismissBtn.parentNode.replaceChild(newDismiss, dismissBtn);

    newSnooze.addEventListener('click', async () => {
        stopAlarmSound();
        overlay.classList.add('hidden');
        await snoozeReminder(reminder, settings.snoozeDuration);
        await renderReminders();
        speak(`Snoozed for ${settings.snoozeDuration} minutes, ${userName}.`, settings.voice, settings.rate);
        showToast(`Snoozed for ${settings.snoozeDuration} minutes ⏰`, 'info');
    });

    newDismiss.addEventListener('click', async () => {
        stopAlarmSound();
        overlay.classList.add('hidden');
        await completeReminder(reminder);
        await renderReminders();
        await renderHistory();
        showToast('Reminder completed! ✅', 'success');
    });
}

// ==========================================
// Render Reminders
// ==========================================
async function renderReminders() {
    const list = document.getElementById('reminders-list');
    const empty = document.getElementById('reminders-empty');

    let reminders = await getAllItems('reminders');

    // Sort by datetime
    reminders.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    // Apply filter
    const now = new Date();
    const todayStr = formatDateLocal(now);

    if (currentFilter === 'today') {
        reminders = reminders.filter(r => r.date === todayStr);
    } else if (currentFilter === 'upcoming') {
        reminders = reminders.filter(r => new Date(r.datetime) > now);
    } else if (currentFilter === 'recurring') {
        reminders = reminders.filter(r => r.recurrence && r.recurrence !== 'none');
    }

    // Update badge
    const allReminders = await getAllItems('reminders');
    document.getElementById('reminder-count').textContent = allReminders.filter(r => !r.completed).length;

    if (reminders.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');

    list.innerHTML = reminders.map(r => {
        const isPast = new Date(r.datetime) < now && (!r.recurrence || r.recurrence === 'none');
        const timeDisplay = formatTimeDisplay(r.time);
        const dateDisplay = formatDateDisplay(r.date);
        const recurrenceLabel = getRecurrenceLabel(r.recurrence);

        return `
      <div class="reminder-card priority-${r.priority || 'low'} ${r.completed ? 'completed' : ''}" data-id="${r.id}">
        <button class="reminder-checkbox ${r.completed ? 'checked' : ''}" data-id="${r.id}" title="Complete"></button>
        <div class="reminder-info">
          <div class="reminder-title">${escapeHtml(r.title)}</div>
          ${r.message ? `<div class="reminder-message">${escapeHtml(r.message)}</div>` : ''}
          <div class="reminder-meta">
            <span class="reminder-meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${timeDisplay}
            </span>
            <span class="reminder-meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              ${dateDisplay}
            </span>
            ${recurrenceLabel ? `<span class="recurrence-badge">${recurrenceLabel}</span>` : ''}
            ${r.source === 'voice' ? '<span class="recurrence-badge">🎤 Voice</span>' : ''}
            ${isPast ? '<span class="recurrence-badge" style="background: rgba(255,71,87,0.15); color: var(--danger)">Overdue</span>' : ''}
          </div>
        </div>
        <div class="reminder-actions">
          <button class="btn-icon edit-reminder" data-id="${r.id}" title="Edit">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon delete-reminder" data-id="${r.id}" title="Delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
      </div>
    `;
    }).join('');

    // Attach event listeners
    list.querySelectorAll('.reminder-checkbox').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const reminders = await getAllItems('reminders');
            const reminder = reminders.find(r => r.id === id);
            if (reminder) {
                await completeReminder(reminder);
                await renderReminders();
                await renderHistory();
                showToast('Reminder completed! ✅', 'success');
            }
        });
    });

    list.querySelectorAll('.edit-reminder').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const reminders = await getAllItems('reminders');
            const reminder = reminders.find(r => r.id === id);
            if (reminder) openReminderModal(reminder);
        });
    });

    list.querySelectorAll('.delete-reminder').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (await showConfirm('Delete Reminder', 'This reminder will be permanently removed.')) {
                await deleteItem('reminders', id);
                await renderReminders();
                showToast('Reminder deleted', 'info');
            }
        });
    });
}

// ==========================================
// Render Notes
// ==========================================
async function renderNotes() {
    const grid = document.getElementById('notes-list');
    const empty = document.getElementById('notes-empty');

    let notes = await getAllItems('notes');
    notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    // Update badge
    document.getElementById('notes-count').textContent = notes.length;

    if (notes.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');

    grid.innerHTML = notes.map(note => {
        const dateDisplay = formatDateDisplay(note.updatedAt ? note.updatedAt.split('T')[0] : note.createdAt.split('T')[0]);

        return `
      <div class="note-card color-${note.color || 'default'}" data-id="${note.id}">
        <div class="note-actions">
          <button class="btn-icon delete-note" data-id="${note.id}" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/></svg>
          </button>
        </div>
        <div class="note-title">${escapeHtml(note.title)}</div>
        <div class="note-content-preview">${escapeHtml(note.content || '')}</div>
        <div class="note-footer">
          <span class="note-date">${dateDisplay}</span>
          ${note.hasReminder ? `
            <span class="note-reminder-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              Reminder
            </span>
          ` : ''}
        </div>
      </div>
    `;
    }).join('');

    // Click to edit note
    grid.querySelectorAll('.note-card').forEach(card => {
        card.addEventListener('click', async (e) => {
            if (e.target.closest('.delete-note')) return;
            const id = card.dataset.id;
            const notes = await getAllItems('notes');
            const note = notes.find(n => n.id === id);
            if (note) openNoteModal(note);
        });
    });

    // Delete note
    grid.querySelectorAll('.delete-note').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (await showConfirm('Delete Note', 'This note will be permanently removed.')) {
                await deleteItem('notes', id);
                await renderNotes();
                showToast('Note deleted', 'info');
            }
        });
    });
}

// ==========================================
// Render History
// ==========================================
async function renderHistory() {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');

    let history = await getAllItems('history');
    history.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    if (history.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');

    list.innerHTML = history.map(h => {
        const completedDate = new Date(h.completedAt);
        const dateStr = completedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = completedDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

        return `
      <div class="reminder-card completed priority-${h.priority || 'low'}">
        <div class="reminder-checkbox checked"></div>
        <div class="reminder-info">
          <div class="reminder-title">${escapeHtml(h.title)}</div>
          ${h.message ? `<div class="reminder-message">${escapeHtml(h.message)}</div>` : ''}
          <div class="reminder-meta">
            <span class="reminder-meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              Completed ${dateStr} at ${timeStr}
            </span>
          </div>
        </div>
      </div>
    `;
    }).join('');

    // Clear history button
    document.getElementById('clear-history-btn')?.addEventListener('click', async () => {
        if (await showConfirm('Clear History', 'All completed reminder history will be removed.', 'Clear All')) {
            const { clearStore } = await import('./db.js');
            await clearStore('history');
            await renderHistory();
            showToast('History cleared', 'info');
        }
    });
}

// ==========================================
// Modals
// ==========================================
function initModals() {
    // Close modal buttons
    document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
        if (btn.classList.contains('modal-close') || (btn.classList.contains('btn-ghost') && btn.dataset.modal)) {
            btn.addEventListener('click', () => {
                const modalId = btn.dataset.modal || btn.closest('.modal-overlay')?.id;
                if (modalId) {
                    document.getElementById(modalId).classList.add('hidden');
                }
            });
        }
    });

    // Close modal on backdrop click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.add('hidden');
            }
        });
    });

    // Add Reminder button
    document.getElementById('add-reminder-btn').addEventListener('click', () => {
        openReminderModal();
    });

    // Add Note button
    document.getElementById('add-note-btn').addEventListener('click', () => {
        openNoteModal();
    });

    // Reminder form submit
    document.getElementById('reminder-form').addEventListener('submit', handleReminderSubmit);

    // Note form submit
    document.getElementById('note-form').addEventListener('submit', handleNoteSubmit);

    // Priority buttons
    document.querySelectorAll('.priority-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Color buttons
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Note reminder checkbox toggle
    document.getElementById('note-has-reminder').addEventListener('change', (e) => {
        const fields = document.getElementById('note-reminder-fields');
        fields.classList.toggle('hidden', !e.target.checked);
    });

    // Filter chips
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentFilter = chip.dataset.filter;
            renderReminders();
        });
    });
}

function openReminderModal(reminder = null) {
    const modal = document.getElementById('reminder-modal');
    const title = document.getElementById('reminder-modal-title');
    const form = document.getElementById('reminder-form');

    if (reminder) {
        title.textContent = 'Edit Reminder';
        document.getElementById('reminder-id').value = reminder.id;
        document.getElementById('reminder-title-input').value = reminder.title;
        document.getElementById('reminder-message-input').value = reminder.message || '';
        document.getElementById('reminder-date-input').value = reminder.date;
        document.getElementById('reminder-time-input').value = reminder.time;
        document.getElementById('reminder-recurrence').value = reminder.recurrence || 'none';

        // Set priority
        document.querySelectorAll('.priority-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.priority === (reminder.priority || 'low'));
        });
    } else {
        title.textContent = 'New Reminder';
        form.reset();
        document.getElementById('reminder-id').value = '';

        // Set default date/time
        const now = new Date();
        now.setMinutes(now.getMinutes() + 30);
        document.getElementById('reminder-date-input').value = formatDateLocal(now);
        document.getElementById('reminder-time-input').value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        // Reset priority to low
        document.querySelectorAll('.priority-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.priority === 'low');
        });
    }

    modal.classList.remove('hidden');
    document.getElementById('reminder-title-input').focus();
}

async function handleReminderSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('reminder-id').value;
    const titleVal = document.getElementById('reminder-title-input').value.trim();
    const messageVal = document.getElementById('reminder-message-input').value.trim();
    const dateVal = document.getElementById('reminder-date-input').value;
    const timeVal = document.getElementById('reminder-time-input').value;
    const recurrence = document.getElementById('reminder-recurrence').value;
    const priority = document.querySelector('.priority-btn.active')?.dataset.priority || 'low';

    if (!titleVal || !dateVal || !timeVal) return;

    const message = messageVal || generateReminderMessage(titleVal);

    const reminder = {
        id: id || `rem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title: titleVal,
        message: message,
        date: dateVal,
        time: timeVal,
        datetime: `${dateVal}T${timeVal}`,
        recurrence: recurrence,
        priority: priority,
        completed: false,
        createdAt: id ? undefined : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: 'manual',
    };

    // Preserve createdAt if editing
    if (id) {
        const existing = await getAllItems('reminders');
        const old = existing.find(r => r.id === id);
        if (old) reminder.createdAt = old.createdAt;
    }

    await addItem('reminders', reminder);
    document.getElementById('reminder-modal').classList.add('hidden');
    await renderReminders();

    playNotificationSound();
    showToast(id ? 'Reminder updated! ✏️' : 'Reminder created! ⏰', 'success');
}

function openNoteModal(note = null) {
    const modal = document.getElementById('note-modal');
    const title = document.getElementById('note-modal-title');
    const form = document.getElementById('note-form');

    if (note) {
        title.textContent = 'Edit Note';
        document.getElementById('note-id').value = note.id;
        document.getElementById('note-title-input').value = note.title;
        document.getElementById('note-content-input').value = note.content || '';

        // Set color
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.color === (note.color || 'default'));
        });

        // Set reminder
        const hasReminder = note.hasReminder || false;
        document.getElementById('note-has-reminder').checked = hasReminder;
        document.getElementById('note-reminder-fields').classList.toggle('hidden', !hasReminder);

        if (hasReminder) {
            document.getElementById('note-reminder-date').value = note.reminderDate || '';
            document.getElementById('note-reminder-time').value = note.reminderTime || '';
            document.getElementById('note-reminder-recurrence').value = note.reminderRecurrence || 'none';
            document.getElementById('note-reminder-message').value = note.reminderMessage || '';
        }
    } else {
        title.textContent = 'New Note';
        form.reset();
        document.getElementById('note-id').value = '';
        document.getElementById('note-reminder-fields').classList.add('hidden');

        // Reset color to default
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.color === 'default');
        });
    }

    modal.classList.remove('hidden');
    document.getElementById('note-title-input').focus();
}

async function handleNoteSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('note-id').value;
    const titleVal = document.getElementById('note-title-input').value.trim();
    const contentVal = document.getElementById('note-content-input').value.trim();
    const color = document.querySelector('.color-btn.active')?.dataset.color || 'default';
    const hasReminder = document.getElementById('note-has-reminder').checked;

    if (!titleVal) return;

    const note = {
        id: id || `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title: titleVal,
        content: contentVal,
        color: color,
        hasReminder: hasReminder,
        createdAt: id ? undefined : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    if (hasReminder) {
        note.reminderDate = document.getElementById('note-reminder-date').value;
        note.reminderTime = document.getElementById('note-reminder-time').value;
        note.reminderRecurrence = document.getElementById('note-reminder-recurrence').value;
        note.reminderMessage = document.getElementById('note-reminder-message').value;

        // Also create a linked reminder
        if (note.reminderDate && note.reminderTime) {
            const reminder = {
                id: `rem_note_${note.id}`,
                title: titleVal,
                message: note.reminderMessage || generateReminderMessage(titleVal),
                date: note.reminderDate,
                time: note.reminderTime,
                datetime: `${note.reminderDate}T${note.reminderTime}`,
                recurrence: note.reminderRecurrence || 'none',
                priority: 'medium',
                completed: false,
                createdAt: new Date().toISOString(),
                source: 'note',
                linkedNoteId: note.id,
            };
            await addItem('reminders', reminder);
        }
    }

    // Preserve createdAt if editing
    if (id) {
        const existing = await getAllItems('notes');
        const old = existing.find(n => n.id === id);
        if (old) note.createdAt = old.createdAt;
    }

    await addItem('notes', note);
    document.getElementById('note-modal').classList.add('hidden');
    await renderNotes();
    await renderReminders();

    playNotificationSound();
    showToast(id ? 'Note updated! ✏️' : 'Note created! 📝', 'success');
}

// ==========================================
// Settings
// ==========================================
function initSettings() {
    // Load voices
    loadVoices();

    // Name change
    document.getElementById('settings-name').addEventListener('change', async (e) => {
        userName = e.target.value.trim();
        await setSetting('userName', userName);
        updateUserAvatar();
        showToast('Name updated!', 'success');
    });

    // Voice change
    document.getElementById('settings-voice').addEventListener('change', async (e) => {
        settings.voice = e.target.value;
        await setSetting('voice', settings.voice);
    });

    // Rate change
    document.getElementById('settings-rate').addEventListener('input', async (e) => {
        settings.rate = parseFloat(e.target.value);
        await setSetting('rate', settings.rate);
    });

    // Test voice
    document.getElementById('test-voice-btn').addEventListener('click', () => {
        speak(`Hey ${userName}! This is how I'll sound when reminding you about things. Pretty cool, right?`, settings.voice, settings.rate);
    });

    // Alarm sound
    document.getElementById('settings-alarm-sound').addEventListener('change', async (e) => {
        settings.alarmSound = e.target.value;
        await setSetting('alarmSound', settings.alarmSound);
        // Preview the sound briefly
        playAlarmSound(settings.alarmSound, settings.volume);
        setTimeout(stopAlarmSound, 2000);
    });

    // Volume
    document.getElementById('settings-volume').addEventListener('input', async (e) => {
        settings.volume = parseFloat(e.target.value);
        await setSetting('volume', settings.volume);
    });

    // Snooze duration
    document.getElementById('settings-snooze').addEventListener('change', async (e) => {
        settings.snoozeDuration = parseInt(e.target.value);
        await setSetting('snoozeDuration', settings.snoozeDuration);
    });

    // Notifications toggle
    document.getElementById('settings-notifications').addEventListener('change', async (e) => {
        settings.notifications = e.target.checked;
        await setSetting('notifications', settings.notifications);
        if (settings.notifications && 'Notification' in window) {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') {
                showToast('Notification permission denied by browser', 'error');
            }
        }
    });

    // Speak toggle
    document.getElementById('settings-speak').addEventListener('change', async (e) => {
        settings.speakReminders = e.target.checked;
        await setSetting('speakReminders', settings.speakReminders);
    });

    // Export
    document.getElementById('export-data-btn').addEventListener('click', async () => {
        const data = await exportAllData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `remindme-ai-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Data exported! 📦', 'success');
    });

    // Import
    document.getElementById('import-data-btn').addEventListener('click', () => {
        document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await importAllData(data);
            await renderReminders();
            await renderNotes();
            await renderHistory();
            showToast('Data imported successfully! 📥', 'success');
        } catch (err) {
            showToast('Invalid import file', 'error');
        }
    });

    // Delete all
    document.getElementById('delete-data-btn').addEventListener('click', async () => {
        if (await showConfirm('⚠️ Delete ALL Data', 'This will permanently delete all your reminders, notes, and history. This action cannot be undone!', 'Delete Everything')) {
            await deleteAllData();
            await renderReminders();
            await renderNotes();
            await renderHistory();
            showToast('All data deleted', 'info');
        }
    });

    // Apply loaded settings to form
    document.getElementById('settings-name').value = userName;
    document.getElementById('settings-rate').value = settings.rate;
    document.getElementById('settings-alarm-sound').value = settings.alarmSound;
    document.getElementById('settings-volume').value = settings.volume;
    document.getElementById('settings-snooze').value = settings.snoozeDuration;
    document.getElementById('settings-notifications').checked = settings.notifications;
    document.getElementById('settings-speak').checked = settings.speakReminders;
}

async function loadVoices() {
    const voiceSelect = document.getElementById('settings-voice');
    const voices = await getVoices();

    voiceSelect.innerHTML = voices.map(v =>
        `<option value="${v.name}" ${v.name === settings.voice ? 'selected' : ''}>${v.name} (${v.lang})</option>`
    ).join('');

    if (!settings.voice && voices.length > 0) {
        // Pick a good default English voice
        const englishVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Samantha')) ||
            voices.find(v => v.lang.startsWith('en')) ||
            voices[0];
        if (englishVoice) {
            settings.voice = englishVoice.name;
            voiceSelect.value = englishVoice.name;
            await setSetting('voice', settings.voice);
        }
    }
}

// ==========================================
// Search
// ==========================================
function initSearch() {
    const searchInput = document.getElementById('search-input');
    let searchTimeout;

    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            const query = searchInput.value.toLowerCase().trim();
            if (!query) {
                // Reset view
                await renderReminders();
                await renderNotes();
                return;
            }

            // Search reminders
            const allReminders = await getAllItems('reminders');
            const filteredReminders = allReminders.filter(r =>
                r.title.toLowerCase().includes(query) ||
                (r.message && r.message.toLowerCase().includes(query))
            );

            // Search notes
            const allNotes = await getAllItems('notes');
            const filteredNotes = allNotes.filter(n =>
                n.title.toLowerCase().includes(query) ||
                (n.content && n.content.toLowerCase().includes(query))
            );

            // Render filtered results based on current view
            if (currentView === 'reminders' || currentView === 'notes') {
                // Show both if searching
                renderFilteredResults(filteredReminders, filteredNotes, query);
            }
        }, 300);
    });
}

function renderFilteredResults(reminders, notes, query) {
    // For simplicity, just re-render current view filtered
    if (currentView === 'reminders') {
        const list = document.getElementById('reminders-list');
        const empty = document.getElementById('reminders-empty');

        if (reminders.length === 0) {
            list.innerHTML = `<div class="empty-state"><h3>No reminders matching "${escapeHtml(query)}"</h3></div>`;
            empty.classList.add('hidden');
        } else {
            empty.classList.add('hidden');
            // Re-use render with filtered data — trigger a re-render
            renderReminders();
        }
    }
}

// ==========================================
// Toast Notifications
// ==========================================
function showToast(message, type = 'info') {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close">&times;</button>
  `;

    // Style the toast
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        padding: '12px 20px',
        borderRadius: '12px',
        background: type === 'success' ? 'rgba(105, 219, 124, 0.9)' :
            type === 'error' ? 'rgba(255, 71, 87, 0.9)' :
                'rgba(108, 92, 231, 0.9)',
        color: 'white',
        fontFamily: 'var(--font-family)',
        fontSize: '14px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        zIndex: '5000',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        animation: 'slideIn 0.3s ease',
        maxWidth: '400px',
    });

    const closeBtn = toast.querySelector('.toast-close');
    Object.assign(closeBtn.style, {
        background: 'none',
        border: 'none',
        color: 'white',
        fontSize: '18px',
        cursor: 'pointer',
        opacity: '0.7',
    });

    closeBtn.addEventListener('click', () => toast.remove());

    document.body.appendChild(toast);

    // Auto dismiss
    setTimeout(() => {
        toast.style.animation = 'fadeIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ==========================================
// Utility Functions
// ==========================================
function formatTimeDisplay(time) {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hours = h % 12 || 12;
    return `${hours}:${m.toString().padStart(2, '0')} ${period}`;
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (formatDateLocal(date) === formatDateLocal(today)) return 'Today';
    if (formatDateLocal(date) === formatDateLocal(tomorrow)) return 'Tomorrow';

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateLocal(date) {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

function getRecurrenceLabel(recurrence) {
    const labels = {
        daily: '🔄 Daily',
        weekdays: '🔄 Weekdays',
        weekends: '🔄 Weekends',
        weekly: '🔄 Weekly',
        monthly: '🔄 Monthly',
    };
    return labels[recurrence] || null;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==========================================
// Start the app!
// ==========================================
init();
