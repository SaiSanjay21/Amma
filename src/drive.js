/**
 * RemindMe AI — Google Drive Sync Module
 * Stores and retrieves app data in the user's Google Drive appDataFolder.
 *
 * The appDataFolder is a hidden, app-specific folder that only THIS app
 * can access. Storage counts against the user's Google Drive quota.
 *
 * Data is stored as individual JSON files:
 *   - reminders.json
 *   - notes.json
 *   - history.json
 *   - settings.json
 *   - sync_meta.json  (last sync timestamp, device info)
 */

import { getAccessToken, isSignedIn } from './auth.js';
import { getAllItems, addItem, deleteItem, clearStore } from './db.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

// Stores we sync to/from Drive
const SYNC_STORES = ['reminders', 'notes', 'history', 'settings'];

// Track sync state
let isSyncing = false;
let lastSyncTime = 0;
let syncTimer = null;
let onSyncStatusChange = null;

// Device ID for conflict resolution
const DEVICE_ID = getDeviceId();

function getDeviceId() {
    let id = localStorage.getItem('remindme_device_id');
    if (!id) {
        id = `dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('remindme_device_id', id);
    }
    return id;
}

/**
 * Initialize the sync module.
 * @param {Function} statusCallback - called with 'idle'|'syncing'|'success'|'error'|'offline'
 */
export function initSync(statusCallback) {
    onSyncStatusChange = statusCallback;

    // Load last sync time
    lastSyncTime = parseInt(localStorage.getItem('remindme_last_sync') || '0');

    // Start periodic sync (every 5 minutes)
    startPeriodicSync();

    // Sync on visibility change (when user returns to app)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isSignedIn()) {
            // Only sync if it's been at least 30 seconds since last sync
            if (Date.now() - lastSyncTime > 30000) {
                fullSync();
            }
        }
    });

    // Sync on online event
    window.addEventListener('online', () => {
        if (isSignedIn()) {
            fullSync();
        }
    });
}

/**
 * Start periodic background sync
 */
function startPeriodicSync() {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(() => {
        if (isSignedIn() && navigator.onLine) {
            fullSync();
        }
    }, 5 * 60 * 1000); // Every 5 minutes
}

/**
 * Stop periodic sync
 */
export function stopPeriodicSync() {
    if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
    }
}

// ==========================================
// Core Sync Logic
// ==========================================

/**
 * Full bi-directional sync between local IndexedDB and Google Drive.
 * Uses "last write wins" per item based on updatedAt timestamps.
 */
export async function fullSync() {
    if (isSyncing || !isSignedIn() || !navigator.onLine) {
        return;
    }

    isSyncing = true;
    onSyncStatusChange?.('syncing');
    console.log('🔄 Starting full sync...');

    try {
        const token = await getAccessToken();
        if (!token) {
            throw new Error('No access token available');
        }

        for (const storeName of SYNC_STORES) {
            await syncStore(storeName, token);
        }

        // Update sync metadata
        lastSyncTime = Date.now();
        localStorage.setItem('remindme_last_sync', lastSyncTime.toString());

        // Save sync meta to Drive
        await writeFileToDrive('sync_meta.json', {
            lastSyncTime,
            deviceId: DEVICE_ID,
            syncedAt: new Date().toISOString(),
        }, token);

        console.log('✅ Full sync complete');
        onSyncStatusChange?.('success');
    } catch (err) {
        console.error('❌ Sync failed:', err);
        onSyncStatusChange?.('error');
    } finally {
        isSyncing = false;
    }
}

/**
 * Sync a single store (e.g. 'reminders')
 */
async function syncStore(storeName, token) {
    const fileName = `${storeName}.json`;

    // 1. Get local data
    const localItems = await getAllItems(storeName);

    // 2. Get cloud data
    let cloudItems = [];
    try {
        const cloudData = await readFileFromDrive(fileName, token);
        if (cloudData && Array.isArray(cloudData.items)) {
            cloudItems = cloudData.items;
        }
    } catch (e) {
        // File doesn't exist on Drive yet — that's fine, we'll create it
        console.log(`📁 ${fileName} not found on Drive, will create`);
    }

    // 3. Merge using "last write wins" strategy
    const merged = mergeItems(localItems, cloudItems, storeName);

    // 4. Write merged data back to local IndexedDB
    // Clear and re-populate to handle deletions
    if (merged.localChanged) {
        await clearStore(storeName);
        for (const item of merged.items) {
            await addItem(storeName, item);
        }
    }

    // 5. Write merged data to Drive
    if (merged.cloudChanged) {
        await writeFileToDrive(fileName, {
            items: merged.items,
            updatedAt: new Date().toISOString(),
            deviceId: DEVICE_ID,
        }, token);
    }

    console.log(`  📦 ${storeName}: ${merged.items.length} items (local:${merged.localChanged ? '✏️' : '—'} cloud:${merged.cloudChanged ? '✏️' : '—'})`);
}

/**
 * Merge local and cloud items using "last write wins" per item.
 *
 * For the 'settings' store, items use 'key' as their ID.
 * For all other stores, items use 'id' as their ID.
 */
function mergeItems(localItems, cloudItems, storeName) {
    const idField = storeName === 'settings' ? 'key' : 'id';

    const localMap = new Map();
    const cloudMap = new Map();

    localItems.forEach(item => localMap.set(item[idField], item));
    cloudItems.forEach(item => cloudMap.set(item[idField], item));

    const allKeys = new Set([...localMap.keys(), ...cloudMap.keys()]);
    const merged = [];
    let localChanged = false;
    let cloudChanged = false;

    for (const key of allKeys) {
        const local = localMap.get(key);
        const cloud = cloudMap.get(key);

        if (local && !cloud) {
            // Only exists locally → push to cloud
            merged.push(local);
            cloudChanged = true;
        } else if (!local && cloud) {
            // Only exists on cloud → pull to local
            merged.push(cloud);
            localChanged = true;
        } else if (local && cloud) {
            // Exists on both → compare timestamps
            const localTime = getTimestamp(local, storeName);
            const cloudTime = getTimestamp(cloud, storeName);

            if (localTime >= cloudTime) {
                merged.push(local);
                if (localTime > cloudTime) cloudChanged = true;
            } else {
                merged.push(cloud);
                localChanged = true;
            }
        }
    }

    // If counts differ, something changed
    if (merged.length !== localItems.length) localChanged = true;
    if (merged.length !== cloudItems.length) cloudChanged = true;

    return { items: merged, localChanged, cloudChanged };
}

/**
 * Get the relevant timestamp for conflict resolution.
 */
function getTimestamp(item, storeName) {
    if (storeName === 'settings') {
        return 0; // Settings don't have timestamps, local always wins
    }
    const ts = item.updatedAt || item.createdAt || item.completedAt || '1970-01-01';
    return new Date(ts).getTime();
}

// ==========================================
// Push-only sync (for immediate saves)
// ==========================================

/**
 * Push a single store to Drive immediately after a local write.
 * Called by db.js after addItem/deleteItem.
 */
export async function pushStoreToDrive(storeName) {
    if (!isSignedIn() || !navigator.onLine) return;

    try {
        const token = await getAccessToken();
        if (!token) return;

        const localItems = await getAllItems(storeName);
        const fileName = `${storeName}.json`;

        await writeFileToDrive(fileName, {
            items: localItems,
            updatedAt: new Date().toISOString(),
            deviceId: DEVICE_ID,
        }, token);

        console.log(`☁️ Pushed ${storeName} to Drive (${localItems.length} items)`);
    } catch (err) {
        console.warn(`Push ${storeName} failed (will retry on next sync):`, err);
    }
}

// ==========================================
// Google Drive REST API Helpers
// ==========================================

/**
 * Find a file by name in appDataFolder
 * @returns {string|null} fileId
 */
async function findFile(fileName, token) {
    const params = new URLSearchParams({
        spaces: 'appDataFolder',
        q: `name='${fileName}'`,
        fields: 'files(id,name,modifiedTime)',
    });

    const res = await fetch(`${DRIVE_API}/files?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Drive findFile failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data.files && data.files.length > 0 ? data.files[0] : null;
}

/**
 * Read a JSON file from appDataFolder
 */
async function readFileFromDrive(fileName, token) {
    const file = await findFile(fileName, token);
    if (!file) return null;

    const res = await fetch(`${DRIVE_API}/files/${file.id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Drive read failed (${res.status}): ${text}`);
    }

    return await res.json();
}

/**
 * Write (create or update) a JSON file in appDataFolder
 */
async function writeFileToDrive(fileName, data, token) {
    const existing = await findFile(fileName, token);
    const body = JSON.stringify(data);

    if (existing) {
        // Update existing file
        const res = await fetch(`${DRIVE_UPLOAD_API}/files/${existing.id}?uploadType=media`, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body,
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Drive update failed (${res.status}): ${text}`);
        }
        return await res.json();
    } else {
        // Create new file
        const metadata = {
            name: fileName,
            parents: ['appDataFolder'],
            mimeType: 'application/json',
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([body], { type: 'application/json' }));

        const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            body: form,
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Drive create failed (${res.status}): ${text}`);
        }
        return await res.json();
    }
}

/**
 * Delete all app data from Drive (for "Delete All Data" action)
 */
export async function deleteCloudData() {
    if (!isSignedIn()) return;

    try {
        const token = await getAccessToken();
        if (!token) return;

        for (const storeName of SYNC_STORES) {
            const file = await findFile(`${storeName}.json`, token);
            if (file) {
                await fetch(`${DRIVE_API}/files/${file.id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                });
            }
        }

        // Also delete sync meta
        const metaFile = await findFile('sync_meta.json', token);
        if (metaFile) {
            await fetch(`${DRIVE_API}/files/${metaFile.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
        }

        console.log('🗑️ All cloud data deleted');
    } catch (err) {
        console.error('Failed to delete cloud data:', err);
    }
}

/**
 * Get last sync time (human readable)
 */
export function getLastSyncTime() {
    if (!lastSyncTime) return 'Never';
    const diff = Date.now() - lastSyncTime;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(lastSyncTime).toLocaleDateString();
}

/**
 * Check if sync is currently in progress
 */
export function isSyncInProgress() {
    return isSyncing;
}
