/**
 * RemindMe AI — IndexedDB Storage Layer
 * Persistent storage for reminders, notes, settings, and health data
 */

const DB_NAME = 'RemindMeAI';
const DB_VERSION = 2;

let db = null;

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

      // Health metrics store (v2)
      if (!database.objectStoreNames.contains('health_metrics')) {
        const healthStore = database.createObjectStore('health_metrics', { keyPath: 'id' });
        healthStore.createIndex('metricType', 'metricType', { unique: false });
        healthStore.createIndex('loggedAt', 'loggedAt', { unique: false });
      }

      // User health profile store (v2, key-value like settings)
      if (!database.objectStoreNames.contains('user_health_profile')) {
        database.createObjectStore('user_health_profile', { keyPath: 'key' });
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
    request.onsuccess = () => resolve(item);
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
    request.onsuccess = () => resolve();
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
}

// ==========================================
// Health Profile Helpers
// (Match existing getSetting/setSetting pattern)
// ==========================================

export async function getHealthProfile(key, defaultValue = null) {
  const item = await getItem('user_health_profile', key);
  return item ? item.value : defaultValue;
}

export async function setHealthProfile(key, value) {
  return addItem('user_health_profile', { key, value });
}

export async function getAllHealthProfile() {
  const all = await getAllItems('user_health_profile');
  const profile = {};
  for (const item of all) {
    profile[item.key] = item.value;
  }
  return profile;
}

// ==========================================
// Health Metrics Helpers
// ID format: health_{Date.now()}_{random}
// ==========================================

export async function addHealthMetric(metricType, value, notes = '') {
  const item = {
    id: `health_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    metricType,
    value,
    loggedAt: Date.now(),
    notes,
  };
  return addItem('health_metrics', item);
}

export async function getHealthMetricsByType(metricType, fromEpoch, toEpoch) {
  const all = await getAllItems('health_metrics');
  return all
    .filter(m => m.metricType === metricType && m.loggedAt >= fromEpoch && m.loggedAt <= toEpoch)
    .sort((a, b) => a.loggedAt - b.loggedAt);
}

export async function getTodayMetrics(metricType) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  return getHealthMetricsByType(metricType, startOfDay, endOfDay);
}

export async function sumTodayMetric(metricType) {
  const metrics = await getTodayMetrics(metricType);
  return metrics.reduce((sum, m) => sum + m.value, 0);
}
