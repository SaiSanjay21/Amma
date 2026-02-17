/**
 * RemindMe AI — Main Application
 * Smart Voice-Powered Reminder & Notes App
 */

import './style.css';
import { openDB, addItem, getAllItems, deleteItem, getSetting, setSetting, exportAllData, importAllData, deleteAllData } from './db.js';
import { playAlarmSound, stopAlarmSound, speak, stopSpeaking, getVoices, playNotificationSound } from './audio.js';
import { startListening, stopListening, parseVoiceCommand, initVoiceRecognition } from './voice.js';
import { startScheduler, snoozeReminder, completeReminder } from './scheduler.js';
import { registerPlugin } from '@capacitor/core';

const LlmPlugin = registerPlugin('LlmPlugin');

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
    notifications: true,
    speakReminders: true,
    aiServerUrl: '',
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
        settings.notifications = await getSetting('notifications', true);
        settings.speakReminders = await getSetting('speakReminders', true);
        settings.aiServerUrl = await getSetting('aiServerUrl', '');

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

        // Register Service Worker for PWA / offline support
        registerServiceWorker();

        // Handle PWA install prompt
        initPWAInstall();

        console.log('🚀 RemindMe AI initialized');
    } catch (error) {
        console.error('Init error:', error);
    }
}

// ==========================================
// PWA — Service Worker Registration
// ==========================================
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                console.log('📱 Service Worker registered:', registration.scope);

                // Check for updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'activated') {
                            showToast('App updated! Refresh for the latest version.', 'info');
                        }
                    });
                });
            })
            .catch((err) => {
                console.warn('SW registration failed:', err);
            });
    }
}

let deferredInstallPrompt = null;

function initPWAInstall() {
    // Capture the beforeinstallprompt event
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;

        // Show a custom install banner (only on mobile)
        if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
            showInstallBanner();
        }
    });

    // Track successful installation
    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        hideInstallBanner();
        showToast('RemindMe AI installed! 🎉', 'success');
    });
}

function showInstallBanner() {
    // Don't show if already dismissed
    if (localStorage.getItem('pwa-install-dismissed')) return;

    let banner = document.getElementById('pwa-install-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.innerHTML = `
            <div class="pwa-install-content">
                <img src="/icon-192.svg" alt="RemindMe AI" class="pwa-install-icon" />
                <div class="pwa-install-text">
                    <strong>Install RemindMe AI</strong>
                    <span>Add to your home screen for the best experience</span>
                </div>
                <button id="pwa-install-btn" class="btn btn-primary btn-sm">Install</button>
                <button id="pwa-install-close" class="btn-icon" title="Dismiss">✕</button>
            </div>
        `;
        document.body.appendChild(banner);

        document.getElementById('pwa-install-btn').addEventListener('click', async () => {
            if (deferredInstallPrompt) {
                deferredInstallPrompt.prompt();
                const result = await deferredInstallPrompt.userChoice;
                if (result.outcome === 'accepted') {
                    showToast('Installing RemindMe AI...', 'success');
                }
                deferredInstallPrompt = null;
            }
            hideInstallBanner();
        });

        document.getElementById('pwa-install-close').addEventListener('click', () => {
            hideInstallBanner();
            localStorage.setItem('pwa-install-dismissed', '1');
        });
    }

    setTimeout(() => banner.classList.add('visible'), 2000);
}

function hideInstallBanner() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) {
        banner.classList.remove('visible');
        setTimeout(() => banner.remove(), 400);
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

    // Initialize speech recognition (native Android or Web Speech API)
    initVoiceRecognition().then((result) => {
        if (!result) {
            voiceStatus.classList.add('error');
            voiceStatus.querySelector('span').textContent = 'Voice Not Supported';
            voiceBtn.title = 'Speech recognition not available on this device';
            console.warn('No speech recognition available');
        } else {
            console.log('✅ Speech recognition ready');
        }
    }).catch((err) => {
        console.warn('Speech recognition init error:', err);
    });

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

                if (parsed.isReminder) {
                    // ---- Case 1 & 2: Contains date/time → Create a reminder ----
                    const title = parsed.title || 'Reminder';
                    const message = parsed.message || generateReminderMessage(title);

                    const reminder = {
                        id: `rem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        title: title,
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
                            title: title,
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
                    const confirmMsg = `Got it, ${userName}! I'll remind you about ${title} on ${dateStr} at ${timeStr}${recStr}.`;
                    speak(confirmMsg, settings.voice, settings.rate);

                    showToast(`Reminder set for ${dateStr} at ${timeStr} 🎤`, 'success');
                } else {
                    // ---- Case 3: Check for AI Question ----
                    const lowerTranscript = transcript.toLowerCase();
                    const isQuestion = /^(ask|question|what|who|when|where|why|how|explain|tell me|can you)/i.test(lowerTranscript);

                    if (isQuestion && settings.aiServerUrl) {
                        // It's likely a question for the AI
                        let query = transcript;
                        // Remove "Ask AI" prefix if present
                        query = query.replace(/^(ask ai|ask assistant|question)\s+/i, '');
                        askAI(query);
                    } else {
                        // ---- Case 4: Save as a plain note ----
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

    // Build the spoken message based on the reminder content
    const reminderTitle = reminder.title || '';
    const reminderMessage = reminder.message || '';

    // Determine what to say
    let spokenText = '';
    if (reminderMessage && reminderMessage !== `It's time for: ${reminderTitle}`) {
        // User provided a custom message — read it out
        spokenText = `Hey ${userName}! ${reminderMessage}`;
    } else if (reminderTitle && reminderTitle !== 'Reminder' && !reminderTitle.startsWith('Reminder at ')) {
        // Has a meaningful title like "Doctor appointment"
        spokenText = `Hey ${userName}, it's time for ${reminderTitle.toLowerCase()}.`;
    } else {
        // Generic reminder with no specific title
        spokenText = `Hey ${userName}, you have a reminder right now.`;
    }

    // Play a short alarm chime first
    playAlarmSound(settings.alarmSound, settings.volume);

    // Show alarm overlay
    const overlay = document.getElementById('alarm-overlay');
    const title = document.getElementById('alarm-title');
    const message = document.getElementById('alarm-message');

    title.textContent = reminderTitle || 'Reminder';
    message.textContent = reminderMessage || `It's time for: ${reminderTitle || 'your reminder'}`;
    overlay.classList.remove('hidden');

    // After a short chime, stop alarm and speak the reminder
    setTimeout(() => {
        stopAlarmSound();

        // Always speak the reminder out loud
        speak(spokenText, settings.voice, settings.rate).then(() => {
            // After speaking, play a soft chime again as ongoing alert
            if (overlay && !overlay.classList.contains('hidden')) {
                playAlarmSound(settings.alarmSound, Math.max(settings.volume * 0.3, 0.1));
            }
        });
    }, 1500); // Let alarm chime play for 1.5s, then speak

    // Browser notification
    if (settings.notifications && 'Notification' in window && Notification.permission === 'granted') {
        const notif = new Notification(`RemindMe AI — ${reminderTitle || 'Reminder'}`, {
            body: reminderMessage || `It's time for: ${reminderTitle || 'your reminder'}`,
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
        stopSpeaking(); // Stop any ongoing speech
        overlay.classList.add('hidden');
        await snoozeReminder(reminder, settings.snoozeDuration);
        await renderReminders();
        speak(`Snoozed for ${settings.snoozeDuration} minutes, ${userName}.`, settings.voice, settings.rate);
        showToast(`Snoozed for ${settings.snoozeDuration} minutes ⏰`, 'info');
    });

    newDismiss.addEventListener('click', async () => {
        stopAlarmSound();
        stopSpeaking(); // Stop any ongoing speech
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

    // Local AI Model Setup
    const modelStatusEl = document.getElementById('ai-model-status');
    const downloadBtn = document.getElementById('btn-settings-download');
    const installBtn = document.getElementById('btn-settings-install');

    // Check model status on settings load
    if (modelStatusEl && window.Capacitor && Capacitor.isNativePlatform()) {
        try {
            LlmPlugin.checkModel().then(res => {
                if (res.exists) {
                    modelStatusEl.textContent = '✅ Model installed and ready!';
                    modelStatusEl.style.color = '#00b894';
                } else {
                    modelStatusEl.textContent = '❌ Model not found. Follow steps below.';
                    modelStatusEl.style.color = '#ff7675';
                }
            }).catch(() => {
                modelStatusEl.textContent = '⚠️ Could not check (plugin error)';
                modelStatusEl.style.color = '#fdcb6e';
            });
        } catch (e) {
            modelStatusEl.textContent = '⚠️ Native plugin not available';
            modelStatusEl.style.color = '#fdcb6e';
        }
    } else if (modelStatusEl) {
        modelStatusEl.textContent = '⚠️ Only available on Android device';
        modelStatusEl.style.color = '#fdcb6e';
    }

    // Download button
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            if (window.Capacitor && Capacitor.isNativePlatform()) {
                LlmPlugin.downloadModel({
                    url: 'https://www.kaggle.com/models/google/gemma/frameworks/mediapipe/variations/gemma-2b-it-gpu-int4'
                });
                showToast('Opening Kaggle in browser...', 'info');
            } else {
                window.open('https://www.kaggle.com/models/google/gemma/frameworks/mediapipe/variations/gemma-2b-it-gpu-int4', '_blank');
            }
        });
    }

    // Install button
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!window.Capacitor || !Capacitor.isNativePlatform()) {
                showToast('Install only works on Android device', 'error');
                return;
            }

            installBtn.textContent = 'Installing...';
            installBtn.disabled = true;

            try {
                const res = await LlmPlugin.installModel();
                if (res.status === 'installed') {
                    showToast('✅ Model installed successfully! Source: ' + res.source, 'success');
                    if (modelStatusEl) {
                        modelStatusEl.textContent = '✅ Model installed and ready!';
                        modelStatusEl.style.color = '#00b894';
                    }
                    isModelLoaded = false; // Reset so next askAI reloads
                }
            } catch (e) {
                console.error('Install error:', e);
                const msg = e.message || 'Install failed';
                let suggestion = '';

                if (msg.includes('Permission') || msg.includes('EACCES')) {
                    suggestion = '<br><br><b>Permisson Error?</b> Try ADB:<br><code>adb push gemma-2b-it-gpu-int4.bin /sdcard/Android/data/com.remindme.ai/files/</code>';
                }

                showToast('❌ ' + msg, 'error');
                if (modelStatusEl) {
                    modelStatusEl.innerHTML = `❌ ${msg}${suggestion}`;
                    modelStatusEl.style.color = '#ff7675';
                }
            } finally {
                installBtn.textContent = 'Install';
                installBtn.disabled = false;
            }
        });
    }

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
    if (document.getElementById('settings-ai-server')) {
        document.getElementById('settings-ai-server').value = settings.aiServerUrl;
    }
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
// AI Assistant Logic (Local LLM)
// ==========================================
let isModelLoaded = false;

async function askAI(question) {
    // Show Overlay
    const overlay = document.getElementById('ai-overlay');
    const questionEl = document.getElementById('ai-question');
    const answerEl = document.getElementById('ai-answer');
    const closeBtn = document.getElementById('ai-close');
    const closeBtnBottom = document.getElementById('ai-close-btn');
    const speakBtn = document.getElementById('ai-speak-btn');

    overlay.classList.remove('hidden');
    questionEl.textContent = `"${question}"`;

    // Initial loading state
    answerEl.innerHTML = `
        <div class="ai-loading">
            <div class="ai-dot"></div>
            <div class="ai-dot"></div>
            <div class="ai-dot"></div>
        </div>
        <span>${isModelLoaded ? 'Thinking...' : 'Initializing Local AI (One-time)...'}</span>
    `;

    // Setup Close Handlers
    const closeOverlay = () => {
        overlay.classList.add('hidden');
        stopSpeaking();
    };

    const newCloseBtn = closeBtn.cloneNode(true);
    const newCloseBtnBottom = closeBtnBottom.cloneNode(true);
    const newSpeakBtn = speakBtn.cloneNode(true);

    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
    closeBtnBottom.parentNode.replaceChild(newCloseBtnBottom, closeBtnBottom);
    speakBtn.parentNode.replaceChild(newSpeakBtn, speakBtn);

    newCloseBtn.addEventListener('click', closeOverlay);
    newCloseBtnBottom.addEventListener('click', closeOverlay);

    try {
        // Step 0: Check if Model Exists
        if (!isModelLoaded) {
            const check = await LlmPlugin.checkModel();
            if (!check.exists) {
                answerEl.innerHTML = `
                    <div style="text-align: center; padding: 20px;">
                        <h3>⚠️ AI Model Missing</h3>
                        <p>To use offline AI, you need to download the <b>Gemma 2B</b> model once (1.3 GB).</p>
                        
                        <button id="btn-download" style="background: #6C5CE7; color: white; padding: 12px; border-radius: 8px; border: none; width: 100%; margin: 10px 0;">
                            1. Download from Kaggle
                        </button>
                        
                        <p style="font-size: 12px; opacity: 0.7;">(Login to Kaggle, tap 'Download', save to Downloads folder)</p>

                        <button id="btn-install" style="background: #00b894; color: white; padding: 12px; border-radius: 8px; border: none; width: 100%; margin: 10px 0;">
                            2. Install from Downloads
                        </button>
                        
                        <div id="install-status" style="font-size: 12px; margin-top: 10px;"></div>
                    </div>
                `;

                document.getElementById('btn-download').onclick = () => {
                    LlmPlugin.downloadModel({
                        url: 'https://www.kaggle.com/models/google/gemma/frameworks/mediapipe/variations/gemma-2b-it-gpu-int4'
                    });
                };

                document.getElementById('btn-install').onclick = async () => {
                    const statusEl = document.getElementById('install-status');
                    statusEl.textContent = 'Scanning Downloads folder...';
                    statusEl.style.color = '#fdcb6e';

                    try {
                        const res = await LlmPlugin.installModel();
                        if (res.status === 'installed') {
                            statusEl.textContent = '✅ Model Installed! Initializing...';
                            statusEl.style.color = '#00b894';
                            setTimeout(() => askAI(question), 1000); // Retry
                        }
                    } catch (e) {
                        statusEl.textContent = '❌ Error: ' + e.message;
                        statusEl.style.color = '#ff7675';
                    }
                };
                return; // Stop here
            }

            // If exists, load it
            console.log('Loading local model...');
            answerEl.innerHTML = `
                <div class="ai-loading">
                    <div class="ai-dot"></div>
                    <div class="ai-dot"></div>
                    <div class="ai-dot"></div>
                </div>
                <span>Initializing AI Engine... (One-time)</span>
            `;

            const loadRes = await LlmPlugin.loadModel();
            if (loadRes.status === 'loaded' || loadRes.status === 'already_loaded') {
                isModelLoaded = true;
            } else {
                throw new Error('Failed to load model: ' + JSON.stringify(loadRes));
            }
        }

        // Step 2: Retrieve Relevant Context (True RAG)
        // We only fetch data that matches keywords in the question to keep context tiny.
        console.log('Retrieving relevant context...');
        const allReminders = await getAllItems('reminders');
        const allNotes = await getAllItems('notes');

        // simple keyword extraction (remove common stop words)
        const stopWords = new Set(['the', 'is', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'what', 'where', 'when', 'who', 'how', 'tell', 'me', 'about', 'question', 'ask', 'ai', 'amma']);
        const keywords = question.toLowerCase()
            .replace(/[^\w\s]/g, '') // remove punctuation
            .split(/\s+/)
            .filter(w => w.length > 2 && !stopWords.has(w));

        console.log('Query Keywords:', keywords);

        // Helper to score relevance
        const scoreItem = (text) => {
            if (!text) return 0;
            const lower = text.toLowerCase();
            let score = 0;
            keywords.forEach(k => {
                if (lower.includes(k)) score += 1;
            });
            return score;
        };

        // Filter Reminders (Active + Relevant)
        const relevantReminders = allReminders
            .filter(r => !r.completed) // Always include active reminders? No, only relevant ones unless user asks "what are my reminders"
            .map(r => ({ ...r, score: scoreItem(r.title + ' ' + r.message) }))
            .filter(r => r.score > 0 || question.toLowerCase().includes('reminder') || question.toLowerCase().includes('schedule'))
            .sort((a, b) => b.score - a.score)
            .slice(0, 5); // Max 5 relevant reminders

        // Filter Notes (Relevant Only)
        const relevantNotes = allNotes
            .map(n => ({ ...n, score: scoreItem(n.title + ' ' + n.content) }))
            .filter(n => n.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3); // Max 3 relevant notes

        // Construct Miniature Context
        let contextString = "Context Data:\n";

        if (relevantReminders.length > 0) {
            contextString += "Relevant Reminders:\n" + relevantReminders.map(r =>
                `- ${r.title} at ${new Date(r.datetime).toLocaleString()}`
            ).join("\n") + "\n";
        } else if (allReminders.filter(r => !r.completed).length > 0 && (question.toLowerCase().includes('reminder') || question.toLowerCase().includes('schedule'))) {
            // Fallback: If asking about reminders but no keywords matched specific ones, show upcoming
            const upcoming = allReminders.filter(r => !r.completed).slice(0, 5);
            contextString += "Upcoming Reminders:\n" + upcoming.map(r => `- ${r.title} at ${new Date(r.datetime).toLocaleString()}`).join("\n") + "\n";
        } else {
            contextString += "(No relevant reminders found)\n";
        }

        if (relevantNotes.length > 0) {
            contextString += "\nRelevant Notes:\n" + relevantNotes.map(n =>
                `- Title: ${n.title}\n  Content: ${n.content}`
            ).join("\n") + "\n";
        } else {
            contextString += "(No relevant notes found matching keywords)\n";
        }

        // Final Prompt: Tight and Focused
        const fullPrompt = `You are Amma, a helpful assistant. Use the Context below to answer the User.\n${contextString}\nUser: ${question}\nAmma:`;

        // Step 3: Generate Response
        console.log('Generating response for:', fullPrompt);
        const genRes = await LlmPlugin.generate({ prompt: fullPrompt });
        const answer = genRes.response;

        if (answer) {
            // Display Answer
            answerEl.textContent = answer;

            // Speak Answer
            speak(answer, settings.voice, settings.rate);

            // Re-enable Speak Button
            newSpeakBtn.addEventListener('click', () => {
                stopSpeaking();
                speak(answer, settings.voice, settings.rate);
            });
            // (No background consolidation, just pure RAG)

        } else {
            throw new Error('Empty response from AI');
        }

    } catch (err) {
        console.error('AI Error:', err);
        answerEl.innerHTML = `
            <div style="color: #ff6b6b">
                <strong>Error:</strong> ${err.message || 'Unknown error'}
                <br><br>
                <small>Did you copy <code>gemma-2b-it-gpu-int4.bin</code> to assets?</small>
            </div>
        `;
        speak('Sorry, I had trouble with the local AI model.', settings.voice, settings.rate);
    }
}

// ==========================================
// Start the app!
// ==========================================
init();
