/**
 * RemindMe AI — Google Authentication Module
 * Handles Google Sign-In via Google Identity Services (GIS) for Web
 * and Capacitor Google Auth plugin for Android.
 *
 * Uses OAuth 2.0 with the `drive.appdata` scope so each user's data
 * is stored in their own Google Drive (they pay for their own storage).
 */

// =============================================
// ⚠️  REPLACE THIS with your own Client ID
//     from Google Cloud Console → Credentials
// =============================================
const WEB_CLIENT_ID = '116566423441-pt8a8t3r3c9dmde5q6id0ajgr73e77lm.apps.googleusercontent.com';

const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient = null;
let currentUser = null;
let accessToken = null;
let tokenExpiresAt = 0;

// Callbacks set by main.js
let onSignInChange = null;

/**
 * Detect if running inside Capacitor native shell
 */
function isCapacitorNative() {
    try {
        return window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    } catch (e) {
        return false;
    }
}

/**
 * Initialize auth — call once at app startup.
 * @param {Function} callback - called with (user|null) on sign-in state changes
 */
export async function initAuth(callback) {
    onSignInChange = callback;

    // Restore persisted session
    const saved = localStorage.getItem('remindme_auth');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            currentUser = parsed.user;
            accessToken = parsed.token;
            tokenExpiresAt = parsed.expiresAt || 0;
        } catch (e) {
            localStorage.removeItem('remindme_auth');
        }
    }

    if (isCapacitorNative()) {
        await initNativeAuth();
    } else {
        await initWebAuth();
    }

    // If we had a saved session, notify
    if (currentUser && accessToken && Date.now() < tokenExpiresAt) {
        onSignInChange?.(currentUser);
    } else if (currentUser) {
        // Token expired — clear and require re-sign-in
        currentUser = null;
        accessToken = null;
        localStorage.removeItem('remindme_auth');
        onSignInChange?.(null);
    }
}

/**
 * Web: Initialize Google Identity Services (GIS)
 */
async function initWebAuth() {
    // Wait for the GIS library to load
    if (!window.google?.accounts?.oauth2) {
        console.warn('Google Identity Services not loaded yet. Waiting...');
        await new Promise((resolve) => {
            const check = setInterval(() => {
                if (window.google?.accounts?.oauth2) {
                    clearInterval(check);
                    resolve();
                }
            }, 200);
            // Timeout after 10s
            setTimeout(() => { clearInterval(check); resolve(); }, 10000);
        });
    }

    if (!window.google?.accounts?.oauth2) {
        console.error('Google Identity Services failed to load');
        return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: WEB_CLIENT_ID,
        scope: SCOPES,
        callback: handleTokenResponse,
    });
}

/**
 * Android: Initialize Capacitor Google Auth
 */
async function initNativeAuth() {
    try {
        // Dynamic import with string variable to prevent Vite/Rollup from resolving at build time.
        // This package only exists in the Android Capacitor build.
        const pkgName = '@nickvdl/capacitor-google-auth';
        const { GoogleAuth } = await import(/* @vite-ignore */ pkgName);
        window._googleAuth = GoogleAuth;

        await GoogleAuth.initialize({
            clientId: WEB_CLIENT_ID,
            scopes: [SCOPES],
            grantOfflineAccess: true,
        });
        console.log('📱 Native Google Auth initialized');
    } catch (e) {
        console.error('Native Google Auth init failed:', e);
    }
}

/**
 * Handle the token response from GIS (web)
 */
function handleTokenResponse(response) {
    if (response.error) {
        console.error('Token error:', response.error);
        onSignInChange?.(null);
        return;
    }

    accessToken = response.access_token;
    // GIS tokens typically live for 1 hour
    tokenExpiresAt = Date.now() + (response.expires_in || 3600) * 1000;

    // Fetch user info
    fetchUserInfo().then(user => {
        currentUser = user;
        persistSession();
        onSignInChange?.(user);
    });
}

/**
 * Fetch basic user profile from Google
 */
async function fetchUserInfo() {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error('Failed to fetch user info');
        const data = await res.json();
        return {
            name: data.name,
            email: data.email,
            picture: data.picture,
        };
    } catch (e) {
        console.error('Failed to fetch user info:', e);
        return null;
    }
}

/**
 * Persist session to localStorage
 */
function persistSession() {
    localStorage.setItem('remindme_auth', JSON.stringify({
        user: currentUser,
        token: accessToken,
        expiresAt: tokenExpiresAt,
    }));
}

/**
 * Sign in — triggers the Google OAuth flow
 */
export async function signIn() {
    if (isCapacitorNative()) {
        return signInNative();
    }
    return signInWeb();
}

async function signInWeb() {
    if (!tokenClient) {
        console.error('Token client not initialized. Is the GIS script loaded?');
        throw new Error('Google Sign-In not ready. Please refresh the page.');
    }

    // This opens the Google consent popup
    tokenClient.requestAccessToken();
    // The result is handled in handleTokenResponse callback
}

async function signInNative() {
    try {
        const GoogleAuth = window._googleAuth;
        if (!GoogleAuth) throw new Error('Google Auth plugin not loaded');

        const result = await GoogleAuth.signIn();
        console.log('Native sign-in result:', result);

        accessToken = result.authentication?.accessToken;
        tokenExpiresAt = Date.now() + 3600 * 1000;

        currentUser = {
            name: result.name || result.displayName || result.givenName || 'User',
            email: result.email,
            picture: result.imageUrl,
        };

        persistSession();
        onSignInChange?.(currentUser);
        return currentUser;
    } catch (e) {
        console.error('Native sign-in failed:', e);
        throw e;
    }
}

/**
 * Sign out
 */
export async function signOut() {
    if (isCapacitorNative() && window._googleAuth) {
        try {
            await window._googleAuth.signOut();
        } catch (e) { /* ignore */ }
    } else if (accessToken && window.google?.accounts?.oauth2) {
        google.accounts.oauth2.revoke(accessToken);
    }

    currentUser = null;
    accessToken = null;
    tokenExpiresAt = 0;
    localStorage.removeItem('remindme_auth');
    onSignInChange?.(null);
}

/**
 * Get a valid access token. Auto-refreshes if expired.
 * @returns {Promise<string|null>}
 */
export async function getAccessToken() {
    if (!accessToken || Date.now() >= tokenExpiresAt) {
        // Token expired or missing — need to re-authenticate
        if (isCapacitorNative() && window._googleAuth) {
            try {
                const result = await window._googleAuth.refresh();
                accessToken = result.accessToken;
                tokenExpiresAt = Date.now() + 3600 * 1000;
                persistSession();
            } catch (e) {
                console.warn('Token refresh failed, clearing session');
                await signOut();
                return null;
            }
        } else {
            // On web, we can't silently refresh — the user must re-sign-in
            console.warn('Web token expired. User must re-sign-in.');
            return null;
        }
    }
    return accessToken;
}

/**
 * Check if user is currently signed in
 */
export function isSignedIn() {
    return !!(currentUser && accessToken && Date.now() < tokenExpiresAt);
}

/**
 * Get the current user info
 * @returns {{ name: string, email: string, picture: string } | null}
 */
export function getUserInfo() {
    return currentUser;
}
