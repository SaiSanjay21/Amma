/**
 * RemindMe AI — IndexedDB Storage Layer
 * Persistent storage for reminders, notes, and settings.
 *
 * Now includes sync hooks: after every write operation, the changed store
 * is pushed to Google Drive in the background (if the user is signed in).
 */

const DB_NAME = 'RemindMeAI';
const DB_VERSION = 1;

let db = null;

// Sync callback — set by drive.js via setSyncCallback()
let syncCallback = null;

/**
 * Register a callback that is invoked after every write.
 * drive.js calls this to wire up pushStoreToDrive().
 * @param {Function} cb - called with (storeName: string)
 */
export function setSyncCallback(cb) {
  syncCallback = cb;
}

/**
 * Debounce sync pushes per store so rapid writes don't spam the API.
 */
const syncTimers = {};
function triggerSync(storeName) {
  if (!syncCallback) return;
  clearTimeout(syncTimers[storeName]);
  syncTimers[storeName] = setTimeout(() => {
    syncCallback(storeName);
  }, 2000); // Wait 2s of idle before pushing
}

export function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Reminders store
      if (!database.objectStoreNames.contains('reminders')) {
        const remindersStore = database.createObjectStore('reminders', { keyPath: 'id' });
        remindersStore.createIndex('datetime', 'datetime', { unique: false });
        remindersStore.createIndex('completed', 'completed', { unique: false });
      }

      // Notes store
      if (!database.objectStoreNames.contains('notes')) {
        const notesStore = database.createObjectStore('notes', { keyPath: 'id' });
        notesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // History store
      if (!database.objectStoreNames.contains('history')) {
        const historyStore = database.createObjectStore('history', { keyPath: 'id' });
        historyStore.createIndex('completedAt', 'completedAt', { unique: false });
      }

      // Settings store
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
  });
}

function getStore(storeName, mode = 'readonly') {
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

// Generic CRUD operations
export function addItem(storeName, item) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName, 'readwrite');
    const request = store.put(item);
    request.onsuccess = () => {
      triggerSync(storeName);
      resolve(item);
    };
    request.onerror = () => reject(request.error);
  });
}

export function getItem(storeName, id) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName, 'readonly');
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getAllItems(storeName) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName, 'readonly');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export function deleteItem(storeName, id) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName, 'readwrite');
    const request = store.delete(id);
    request.onsuccess = () => {
      triggerSync(storeName);
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

export function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName, 'readwrite');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Settings helpers
export async function getSetting(key, defaultValue = null) {
  const item = await getItem('settings', key);
  return item ? item.value : defaultValue;
}

export async function setSetting(key, value) {
  return addItem('settings', { key, value });
}

// Export all data
export async function exportAllData() {
  const reminders = await getAllItems('reminders');
  const notes = await getAllItems('notes');
  const history = await getAllItems('history');
  const settings = await getAllItems('settings');
  return { reminders, notes, history, settings, exportedAt: new Date().toISOString() };
}

// Import all data
export async function importAllData(data) {
  if (data.reminders) {
    for (const item of data.reminders) await addItem('reminders', item);
  }
  if (data.notes) {
    for (const item of data.notes) await addItem('notes', item);
  }
  if (data.history) {
    for (const item of data.history) await addItem('history', item);
  }
  if (data.settings) {
    for (const item of data.settings) await addItem('settings', item);
  }
}

// Delete everything
export async function deleteAllData() {
  await clearStore('reminders');
  await clearStore('notes');
  await clearStore('history');
  await clearStore('settings');
  // Sync triggers will fire for each store
  triggerSync('reminders');
  triggerSync('notes');
  triggerSync('history');
  triggerSync('settings');
}
