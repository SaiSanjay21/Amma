#!/bin/bash
# RemindMe AI — Fast Build + Deploy via ADB
# Usage: ./deploy.sh
# No root needed. Builds, installs, launches, and tails logs.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export PATH="/opt/homebrew/bin:$PATH"
export JAVA_HOME=/opt/homebrew/Cellar/openjdk/23.0.2/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"

echo "🔨 Building web assets..."
npm run build --silent

echo "📱 Syncing to Android..."
npx cap sync android --inline 2>/dev/null

echo "🏗️  Building APK..."
cd android
./gradlew assembleDebug -q 2>/dev/null
cd ..

APK="android/app/build/outputs/apk/debug/app-debug.apk"

echo "📲 Installing via ADB..."
adb install -r "$APK"

echo "🚀 Launching app..."
adb shell am force-stop com.remindme.ai
adb shell am start -n com.remindme.ai/.MainActivity

echo ""
echo "✅ Done! App is running on your device."
echo ""
echo "📋 Watching logs (Ctrl+C to stop)..."
echo "==========================================="
adb logcat -s "LlmPlugin:*" "Capacitor:*" "Capacitor/Console:*" "RemindMe:*" "chromium:*" --format=brief
