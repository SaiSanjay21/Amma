# RemindMe AI — Code Patterns & Architecture Guide

> Use this document as an in-plan annotation reference:
> _"Match the existing pattern in [Section Name]"_

---

## 🏗 Architecture Overview

```
RemindMe AI (Amma)
├── Frontend: Vanilla JS + HTML + CSS (Single Page App)
├── Native Shell: Capacitor 7 (Android)
├── Storage: IndexedDB (via db.js)
├── AI: On-device MediaPipe GenAI (LlmPlugin.java)
└── Build: Vite → dist/ → Capacitor sync → Gradle APK
```

**No frameworks** (React, Vue, etc.). Pure vanilla JS with ES module imports.

---

## 📁 File Structure & Responsibilities

| File | Role | Lines |
|------|------|-------|
| `index.html` | Single HTML page with all views (SPA via CSS class toggling) | ~600 |
| `src/main.js` | App controller — init, navigation, rendering, settings, AI | ~1721 |
| `src/db.js` | IndexedDB storage layer (CRUD, export/import) | ~147 |
| `src/voice.js` | Speech recognition + NLP date/time parser | ~663 |
| `src/audio.js` | Web Audio API alarm sounds + TTS engine | ~318 |
| `src/scheduler.js` | Alarm scheduler (1-second interval checker) | ~191 |
| `src/style.css` | All styles (dark theme, glassmorphism, animations) | ~1200 |
| `LlmPlugin.java` | Native Android plugin for on-device LLM | ~230 |
| `MainActivity.java` | Capacitor bridge + plugin registration | ~13 |

---

## 🔌 Pattern 1: Capacitor Native Plugin (Match `LlmPlugin.java`)

Custom native plugins follow this exact structure:

### Java Side
```java
package com.remindme.ai;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSObject;

@CapacitorPlugin(name = "PluginName")
public class PluginName extends Plugin {

    @PluginMethod
    public void methodName(PluginCall call) {
        // Get args
        String arg = call.getString("key", "default");

        // Do work (use thread for heavy tasks)
        new Thread(() -> {
            try {
                // ... heavy work ...
                JSObject result = new JSObject();
                result.put("status", "done");
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Error: " + e.getMessage());
            }
        }).start();
    }
}
```

### Registration (Match `MainActivity.java`)
```java
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PluginName.class);  // ⚠️ BEFORE super.onCreate()
        super.onCreate(savedInstanceState);
    }
}
```

### JS Side
```javascript
import { registerPlugin } from '@capacitor/core';
const PluginName = registerPlugin('PluginName');

// Usage (always async)
const result = await PluginName.methodName({ key: 'value' });
```

### Key Rules
- **`registerPlugin()` MUST be called BEFORE `super.onCreate()`** — otherwise plugin is invisible to JS
- **Use `getActivity()`** for launching intents (not `getContext()`)
- **Use `new Thread()`** for heavy work (file I/O, model loading)
- **`call.resolve(JSObject)`** for success, **`call.reject(message)`** for failure
- **File paths**: Use `context.getExternalFilesDir(null)` for ADB-accessible storage

---

## 💾 Pattern 2: IndexedDB Storage (Match `db.js`)

All data persistence uses IndexedDB wrapped in Promise-based functions:

```javascript
// CRUD pattern — every function wraps IDB request in Promise
export function addItem(storeName, item) {
    return new Promise((resolve, reject) => {
        const store = getStore(storeName, 'readwrite');
        const request = store.put(item);
        request.onsuccess = () => resolve(item);
        request.onerror = () => reject(request.error);
    });
}
```

### Data Stores
| Store | Key | Indexes | Purpose |
|-------|-----|---------|---------|
| `reminders` | `id` | `datetime`, `completed` | Active reminders |
| `notes` | `id` | `updatedAt` | User notes |
| `history` | `id` | `completedAt` | Completed reminders |
| `settings` | `key` | — | Key-value settings |

### Item ID Pattern
```javascript
const id = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
// Example: "reminder_1708123456789_abc123def"
```

### Settings Pattern
```javascript
// Read
const value = await getSetting('keyName', defaultValue);
// Write
await setSetting('keyName', value);
```

---

## 🎤 Pattern 3: Native vs Web Detection (Match `voice.js` & `audio.js`)

The app runs on both Android (Capacitor) and Web browser. Detection pattern:

```javascript
// Check if running inside Capacitor native app
function isCapacitorNative() {
    return window.Capacitor && Capacitor.isNativePlatform();
}

// Usage pattern — always branch native vs web
if (isCapacitorNative()) {
    // Use native Android API via Capacitor plugin
    const result = await NativePlugin.doThing();
} else {
    // Use Web API fallback
    const result = webApiFallback();
}
```

### Applies to:
- **Speech Recognition**: Native Android Google Speech UI vs Web Speech API
- **Text-to-Speech**: `@capacitor-community/text-to-speech` vs `window.speechSynthesis`
- **LLM**: `LlmPlugin` (Android only) vs error message on web
- **Notifications**: `@capacitor/local-notifications` vs `Notification API`

---

## 🗺 Pattern 4: SPA Navigation (Match `main.js` → `switchView`)

No router library. Views are CSS-toggled sections in a single HTML page:

```javascript
function switchView(view) {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    // Show target view
    document.getElementById(`${view}-view`).classList.add('active');
    // Update nav
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`[data-view="${view}"]`).classList.add('active');
    // Re-render content
    if (view === 'reminders') renderReminders();
    if (view === 'notes') renderNotes();
    // ...
}
```

### HTML Structure
```html
<div id="reminders-view" class="view active">...</div>
<div id="notes-view" class="view">...</div>
<div id="settings-view" class="view">...</div>
```

---

## 🔔 Pattern 5: Alarm Scheduler (Match `scheduler.js`)

Polling-based scheduler (1-second interval):

```javascript
export function startScheduler(callback) {
    schedulerInterval = setInterval(checkReminders, 1000);
}

async function checkReminders() {
    const reminders = await getAllItems('reminders');
    const now = new Date();
    for (const reminder of reminders) {
        if (shouldTrigger(reminder, now)) {
            triggeredIds.add(key);      // Prevent double-fire
            onAlarmCallback(reminder);   // Fire alarm
        }
    }
}
```

### Key Rules:
- Use `triggeredIds` Set to prevent double-triggers within same minute
- Recurrence handled by updating `reminder.datetime` to next occurrence
- Completed non-recurring reminders move to `history` store

---

## 🎨 Pattern 6: UI Rendering (Match `main.js` → `renderReminders`)

Dynamic HTML rendering via `innerHTML` (no virtual DOM):

```javascript
async function renderReminders() {
    const reminders = await getAllItems('reminders');
    const container = document.getElementById('reminders-list');

    if (reminders.length === 0) {
        container.innerHTML = `<div class="empty-state">
            <div class="empty-icon">📋</div>
            <h3>No reminders yet</h3>
            <p>Tap the mic and say something!</p>
        </div>`;
        return;
    }

    container.innerHTML = reminders.map(r => `
        <div class="card" data-id="${r.id}">
            <h3>${escapeHtml(r.title)}</h3>
            <span class="badge">${r.time}</span>
            <button class="btn-delete" onclick="deleteReminder('${r.id}')">🗑️</button>
        </div>
    `).join('');
}
```

### Key Rules:
- Always use `escapeHtml()` for user text
- Empty states use `.empty-state` class with emoji icon
- Cards use `.card` class with consistent structure
- Re-render after any data mutation (add/edit/delete)

---

## 🧠 Pattern 7: AI / LLM Integration (Match `main.js` → `askAI`)

On-device LLM with True RAG (keyword-based context retrieval):

```javascript
async function askAI(question) {
    // 1. Check model exists
    const check = await LlmPlugin.checkModel();
    if (!check.exists) { /* Show download UI */ return; }

    // 2. Load model (one-time)
    if (!isModelLoaded) {
        await LlmPlugin.loadModel();
        isModelLoaded = true;
    }

    // 3. RAG — Keyword extraction & relevance scoring
    const keywords = question.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

    const scoreItem = (text) => {
        return keywords.filter(k => text.toLowerCase().includes(k)).length;
    };

    // 4. Filter relevant context (max 5 reminders, 3 notes)
    const relevant = allItems
        .map(item => ({ ...item, score: scoreItem(item.title) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

    // 5. Construct prompt
    const prompt = `You are Amma, a helpful assistant.\n${contextString}\nUser: ${question}\nAmma:`;

    // 6. Generate
    const result = await LlmPlugin.generate({ prompt });
}
```

---

## 🔊 Pattern 8: Audio Generation (Match `audio.js`)

Web Audio API for alarm sounds (no audio files):

```javascript
function playGentleChime(ctx, gainNode) {
    const frequencies = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    frequencies.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gainNode);
        osc.start(ctx.currentTime + i * 0.3);
        osc.stop(ctx.currentTime + i * 0.3 + 0.5);
    });
}
```

---

## ⚙️ Pattern 9: Settings (Match `main.js` → `initSettings`)

Event-driven settings with immediate persistence:

```javascript
document.getElementById('settings-name').addEventListener('change', async (e) => {
    userName = e.target.value.trim();
    await setSetting('userName', userName);   // Persist immediately
    updateUserAvatar();                       // Update UI
    showToast('Name updated!', 'success');    // Feedback
});
```

### Settings HTML Pattern
```html
<div class="settings-section">
    <h3>🧠 Section Title</h3>
    <div class="setting-row">
        <div class="setting-info">
            <label>Setting Name</label>
            <p>Description text</p>
        </div>
        <button id="setting-action" class="btn btn-secondary">Action</button>
    </div>
</div>
```

---

## 📱 Pattern 10: Toast Notifications (Match `main.js` → `showToast`)

```javascript
showToast('Message here!', 'success');  // Types: 'success', 'error', 'info', 'warning'
```

Uses auto-dismissing toast with slide-in animation. Created dynamically in DOM.

---

## 🔧 Pattern 11: Build & Deploy (Match `package.json`)

```bash
# Development
npm run dev                    # Vite dev server

# Build APK
npx vite build                 # Build web assets → dist/
npx cap sync android           # Copy dist/ → android/app/src/main/assets/public/
cd android && ./gradlew assembleDebug   # Build APK

# Install on phone
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Push model file (no permissions needed)
adb push gemma-2b-it-gpu-int4.bin /sdcard/Android/data/com.remindme.ai/files/
```

---

## 🎯 Pattern 12: Voice Command NLP (Match `voice.js` → `parseVoiceCommand`)

Natural language parsing without any NLP library:

```javascript
function parseVoiceCommand(transcript) {
    const result = {
        type: 'note',         // or 'reminder'
        title: '',
        date: null,
        time: null,
        recurrence: 'none',
        priority: 'medium',
    };

    // 1. Extract structured data using regex
    const timeResult = extractTime(transcript);
    const dateResult = extractDate(transcript);
    const recurrence = extractRecurrence(transcript);

    // 2. Determine type
    if (isExplicitReminderKeyword(transcript)) {
        result.type = 'reminder';
    }

    // 3. Clean title (remove matched date/time patterns)
    result.title = cleanTranscript(transcript);

    return result;
}
```

### Key Rules:
- Date extraction supports: "tomorrow", "next Monday", "March 15th", "in 2 hours"
- Time extraction supports: "at 3 PM", "3:30", "noon", "in 30 minutes"
- Recurrence: "every day", "daily", "weekdays", "weekly", "monthly"
- Priority: "urgent", "important", "high priority"

---

## 📐 Pattern 13: CSS Design System (Match `style.css`)

```css
/* Theme colors */
--bg-primary: #0a0a1a;        /* Deep dark background */
--bg-card: #1a1a2e;            /* Card background */
--accent: #6C5CE7;             /* Purple accent */
--success: #00b894;            /* Green */
--danger: #ff7675;             /* Red */
--warning: #fdcb6e;            /* Yellow */
--text: #e2e2e2;               /* Main text */

/* Glassmorphism cards */
.card {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
}

/* Animations */
@keyframes slideIn { from { transform: translateY(20px); opacity: 0; } }
```

---

## 🔑 Key Conventions

1. **IDs**: `type_timestamp_randomString` (e.g., `reminder_1708123456789_abc123def`)
2. **Error Handling**: `try/catch` → `showToast(message, 'error')`
3. **Async**: All DB and plugin calls are `async/await`
4. **Section Comments**: `// ==========================================`
5. **File Headers**: JSDoc comment with module name and purpose
6. **Native Branching**: Always check `isCapacitorNative()` before using native APIs
7. **Thread Safety**: Heavy native work runs on `new Thread()` in Java
8. **Plugin Registration Order**: `registerPlugin()` → `super.onCreate()`
