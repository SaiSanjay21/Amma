---
description: How to build and deploy the RemindMe AI Android app
---

# Build & Deploy RemindMe AI Android App

## Prerequisites

1. **Android Studio** — Download from https://developer.android.com/studio
2. **Java 17+** — Required by Gradle (comes with Android Studio)
3. **Node.js** — Already installed

## Quick Commands

### Development (Web)
```bash
npm run dev
```

### Build for Android

// turbo
1. Build the web app and sync to Android:
```bash
npm run android:build
```

2. Open in Android Studio:
```bash
npm run android:open
```

3. In Android Studio:
   - Wait for Gradle sync to complete
   - Select a device/emulator from the toolbar
   - Click the **Run** ▶️ button

### One-Step Build & Run (requires connected device/emulator)
```bash
npm run android:run
```

## Generating a Signed APK

1. Open the project in Android Studio: `npm run android:open`
2. Go to **Build → Generate Signed Bundle / APK**
3. Choose **APK**
4. Create or select a keystore
5. Select **release** build type
6. Click **Finish**
7. The signed APK will be in `android/app/build/outputs/apk/release/`

## PWA Installation (No Android Studio needed)

The app is also a Progressive Web App. To install on Android without compiling:

1. Host the website (or use `npx vite preview`)
2. Open the URL in **Chrome on Android**
3. Tap the **"Add to Home Screen"** banner or go to **⋮ Menu → Install app**
4. The app appears on the home screen with its icon and works offline!

## Project Structure

```
Amma/
├── android/              # Native Android project (Capacitor)
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── assets/public/   # Built web app
│   │   │   ├── java/            # Native Java code
│   │   │   └── res/             # Android resources, icons
│   │   └── build.gradle
│   └── build.gradle
├── public/
│   ├── manifest.json     # PWA manifest
│   ├── sw.js             # Service worker (offline support)
│   ├── icon-192.svg      # App icon (192px)
│   └── icon-512.svg      # App icon (512px)
├── src/
│   ├── main.js           # App logic + PWA registration
│   ├── voice.js          # Voice NLP engine
│   ├── db.js             # IndexedDB persistence
│   ├── scheduler.js      # Alarm scheduler
│   ├── audio.js          # Notification sounds
│   └── style.css         # Styles + mobile optimizations
├── capacitor.config.ts   # Capacitor configuration
├── index.html            # Main HTML (with PWA meta tags)
└── package.json          # Scripts and dependencies
```

## Updating the App

After making changes to the web code:

// turbo
```bash
npm run android:build
```

Then rebuild in Android Studio or run:
```bash
npx cap run android
```
