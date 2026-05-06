package com.remindme.ai;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * LlmPlugin — AICore-Only Architecture
 * 
 * Uses Google's built-in Gemini Nano via Android AICore.
 * ZERO model download. ZERO extra RAM. Hardware-accelerated on Tensor G3.
 * 
 * Supported devices: Pixel 8, 8a, 8 Pro, 9, 9 Pro, 9 Pro XL
 * Requires: Android 14+, AICore enabled in Developer Options
 * 
 * No MediaPipe, no Gemma model file, no 1.1 GB download.
 */
@CapacitorPlugin(name = "LlmPlugin")
public class LlmPlugin extends Plugin {
    private static final String TAG = "LlmPlugin";
    private static final int MAX_TOKENS = 256;

    private static final String PREFS_NAME = "llm_prefs";
    private static final String AICORE_PACKAGE = "com.google.android.aicore";

    /**
     * Check if Android AICore (Gemini Nano) is available on this device.
     * AICore comes pre-installed on Pixel 8+ with Android 14+.
     */
    @PluginMethod
    public void checkAICore(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            android.content.pm.PackageManager pm = getContext().getPackageManager();
            android.content.pm.PackageInfo info = pm.getPackageInfo(AICORE_PACKAGE, 0);
            ret.put("available", true);
            ret.put("engine", "gemini-nano");
            ret.put("downloadRequired", false);
            ret.put("version", info.versionName);
            ret.put("estimatedRAM", "200-300 MB (shared with system)");
            Log.i(TAG, "AICore available! Version: " + info.versionName);
        } catch (android.content.pm.PackageManager.NameNotFoundException e) {
            ret.put("available", false);
            ret.put("engine", "none");
            ret.put("reason", "AICore not installed. Enable it in Settings → System → Developer Options → AICore Settings.");
        } catch (Exception e) {
            ret.put("available", false);
            ret.put("engine", "none");
            ret.put("reason", e.getMessage());
        }
        call.resolve(ret);
    }

    /**
     * Generate text using Android AICore (Gemini Nano).
     * 
     * ZERO model download — uses the model already built into the OS.
     * Hardware-accelerated via Tensor G3 NPU on Pixel 8a.
     * RAM: ~200-300 MB shared with the OS (not charged to our app).
     * 
     * Uses Java reflection so we don't need a compile-time dependency
     * on com.google.ai.edge.aicore (which requires minSdk 31).
     */
    @PluginMethod
    public void generateWithAICore(PluginCall call) {
        String prompt = call.getString("prompt");
        if (prompt == null || prompt.isEmpty()) {
            call.reject("Prompt is required");
            return;
        }

        new Thread(() -> {
            try {
                // Step 1: Build GenerationConfig
                Class<?> gcClass = Class.forName("com.google.ai.edge.aicore.GenerationConfig");
                Class<?> gcBuilderClass = Class.forName("com.google.ai.edge.aicore.GenerationConfig$Builder");

                Object gcBuilder = gcBuilderClass.getDeclaredConstructor().newInstance();
                gcBuilderClass.getMethod("setTemperature", float.class).invoke(gcBuilder, 0.7f);
                gcBuilderClass.getMethod("setMaxOutputTokens", int.class).invoke(gcBuilder, MAX_TOKENS);
                Object generationConfig = gcBuilderClass.getMethod("build").invoke(gcBuilder);

                // Step 2: Create GenerativeModel("gemini-nano", config)
                Class<?> gmClass = Class.forName("com.google.ai.edge.aicore.GenerativeModel");
                Object generativeModel = gmClass.getDeclaredConstructor(
                        String.class, gcClass
                ).newInstance("gemini-nano", generationConfig);

                // Step 3: Get the Java Futures wrapper
                Class<?> futuresClass = Class.forName("com.google.ai.edge.aicore.java.GenerativeModelFutures");
                Object futuresModel = futuresClass.getMethod("from", gmClass).invoke(null, generativeModel);

                // Step 4: Create Content with the prompt text
                Class<?> contentClass = Class.forName("com.google.ai.edge.aicore.Content");
                Class<?> contentBuilderClass = Class.forName("com.google.ai.edge.aicore.Content$Builder");
                Object contentBuilder = contentBuilderClass.getDeclaredConstructor().newInstance();
                contentBuilderClass.getMethod("addText", String.class).invoke(contentBuilder, prompt);
                Object content = contentBuilderClass.getMethod("build").invoke(contentBuilder);

                // Step 5: Call generateContent and wait for result
                java.lang.reflect.Method generateMethod = futuresModel.getClass().getMethod("generateContent", contentClass);
                com.google.common.util.concurrent.ListenableFuture<?> future =
                        (com.google.common.util.concurrent.ListenableFuture<?>) generateMethod.invoke(futuresModel, content);

                // Block and get result (60s timeout)
                Object result = future.get(60, java.util.concurrent.TimeUnit.SECONDS);
                String text = (String) result.getClass().getMethod("getText").invoke(result);

                if (text != null) {
                    text = text.trim();
                }

                JSObject ret = new JSObject();
                ret.put("response", text != null ? text : "");
                ret.put("engine", "aicore-gemini-nano");
                call.resolve(ret);

                Log.i(TAG, "AICore generation successful");

            } catch (ClassNotFoundException e) {
                Log.w(TAG, "AICore SDK classes not found on device: " + e.getMessage());
                call.reject("AICore is not available on this device. " +
                        "Please enable it: Settings → System → Developer Options → AICore Settings → ON. " +
                        "Then wait a few minutes for Gemini Nano to download in the background.");
            } catch (java.util.concurrent.TimeoutException e) {
                call.reject("AICore generation timed out. The model may still be downloading. " +
                        "Please wait a few minutes and try again.");
            } catch (Exception e) {
                String msg = e.getMessage();
                if (e.getCause() != null) msg = e.getCause().getMessage();
                Log.e(TAG, "AICore generation failed: " + msg, e);
                call.reject("AICore error: " + msg + 
                        ". Make sure AICore is enabled in Developer Options and Gemini Nano has finished downloading.");
            }
        }).start();
    }

    /**
     * Delete ANY leftover model files from previous app versions.
     * Cleans up old MediaPipe/Gemma model files that were downloaded before.
     */
    @PluginMethod
    public void deleteModel(PluginCall call) {
        long freedBytes = 0;
        StringBuilder log = new StringBuilder();

        // Clean internal storage
        freedBytes += deleteModelFiles(getContext().getFilesDir(), log);

        // Clean external app storage
        File extFiles = getContext().getExternalFilesDir(null);
        if (extFiles != null) {
            freedBytes += deleteModelFiles(extFiles, log);
        }

        // Clear ALL caches
        freedBytes += clearDirectory(getContext().getCacheDir());
        File extCache = getContext().getExternalCacheDir();
        if (extCache != null) {
            freedBytes += clearDirectory(extCache);
        }

        // Reset prefs
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().clear().apply();

        JSObject ret = new JSObject();
        ret.put("deleted", freedBytes > 0);
        ret.put("freedMB", freedBytes / (1024 * 1024));
        ret.put("details", log.toString());
        call.resolve(ret);

        Log.i(TAG, "Cleanup complete. Freed " + (freedBytes / (1024 * 1024)) + " MB");
    }

    /**
     * Clear cache (partial downloads, temp files, WebView cache).
     */
    @PluginMethod
    public void clearCache(PluginCall call) {
        long freedBytes = 0;

        freedBytes += clearDirectory(getContext().getCacheDir());
        File extCache = getContext().getExternalCacheDir();
        if (extCache != null) {
            freedBytes += clearDirectory(extCache);
        }

        JSObject ret = new JSObject();
        ret.put("cleared", true);
        ret.put("freedMB", freedBytes / (1024 * 1024));
        call.resolve(ret);
    }

    /**
     * Get storage stats — how much space old model files + cache are using.
     */
    @PluginMethod
    public void getStorageStats(PluginCall call) {
        long modelSize = getModelFilesSize(getContext().getFilesDir());
        File extFiles = getContext().getExternalFilesDir(null);
        if (extFiles != null) {
            modelSize += getModelFilesSize(extFiles);
        }

        long cacheSize = getDirSize(getContext().getCacheDir());
        File extCache = getContext().getExternalCacheDir();
        if (extCache != null) {
            cacheSize += getDirSize(extCache);
        }

        JSObject ret = new JSObject();
        ret.put("oldModelSizeMB", modelSize / (1024 * 1024));
        ret.put("cacheSizeMB", cacheSize / (1024 * 1024));
        ret.put("totalSizeMB", (modelSize + cacheSize) / (1024 * 1024));
        ret.put("hasOldModelFiles", modelSize > 0);
        call.resolve(ret);
    }

    // =====================
    // Helper Methods
    // =====================

    private long deleteModelFiles(File dir, StringBuilder log) {
        if (dir == null || !dir.isDirectory()) return 0;
        long freed = 0;
        File[] files = dir.listFiles();
        if (files == null) return 0;
        for (File f : files) {
            String name = f.getName().toLowerCase();
            if (name.endsWith(".bin") || name.endsWith(".task") || name.endsWith(".litertlm")
                    || name.contains("gemma") || name.contains("model") || name.endsWith(".download")) {
                freed += f.length();
                log.append("Deleted: ").append(f.getAbsolutePath())
                   .append(" (").append(f.length() / (1024 * 1024)).append(" MB)\n");
                f.delete();
            }
        }
        return freed;
    }

    private long getModelFilesSize(File dir) {
        if (dir == null || !dir.isDirectory()) return 0;
        long size = 0;
        File[] files = dir.listFiles();
        if (files == null) return 0;
        for (File f : files) {
            String name = f.getName().toLowerCase();
            if (name.endsWith(".bin") || name.endsWith(".task") || name.endsWith(".litertlm")
                    || name.contains("gemma") || name.endsWith(".download")) {
                size += f.length();
            }
        }
        return size;
    }

    private long clearDirectory(File dir) {
        if (dir == null || !dir.isDirectory()) return 0;
        long freed = 0;
        File[] files = dir.listFiles();
        if (files == null) return 0;
        for (File f : files) {
            if (f.isDirectory()) {
                freed += clearDirectory(f);
                f.delete();
            } else {
                freed += f.length();
                f.delete();
            }
        }
        return freed;
    }

    private long getDirSize(File dir) {
        if (dir == null || !dir.isDirectory()) return 0;
        long size = 0;
        File[] files = dir.listFiles();
        if (files == null) return 0;
        for (File f : files) {
            if (f.isDirectory()) {
                size += getDirSize(f);
            } else {
                size += f.length();
            }
        }
        return size;
    }
}
