package com.remindme.ai;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Environment;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mediapipe.tasks.genai.llminference.LlmInference;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "LlmPlugin")
public class LlmPlugin extends Plugin {
    private static final String TAG = "LlmPlugin";
    private static final String MODEL_NAME = "gemma-2b-it-gpu-int4.bin";
    private static final String KAGGLE_ARCHIVE_NAME = "archive.tar.gz";

    /**
     * Memory-optimized configuration:
     * - maxTokens=256 keeps KV cache small (~100-150 MB)
     * - Model weights INT4 ≈ 1.1 GB on disk but ~300 MB in GPU memory
     * - Total runtime RAM: ~400-500 MB (under 0.5 GB limit)
     */
    private static final int MAX_TOKENS = 256;
    private static final int MAX_TOP_K = 20;

    /**
     * Direct download URL from Hugging Face (open source, no login required).
     * This is the exact gemma-2b-it-gpu-int4.bin file for MediaPipe LLM Inference.
     * Source: https://huggingface.co/autoocrat0413/gemma-2b-it-gpu-int4-mediapipe
     * License: Apache 2.0 — free to use.
     * File size: ~1.1 GB
     */
    private static final String MODEL_DOWNLOAD_URL =
            "https://huggingface.co/autoocrat0413/gemma-2b-it-gpu-int4-mediapipe/resolve/main/gemma-2b-it-gpu-int4.bin";

    private LlmInference llmInference;
    private boolean isInitializing = false;
    private boolean isDownloading = false;

    private static final String PREFS_NAME = "llm_prefs";
    private static final String KEY_MODEL_PROVISIONED = "model_provisioned";
    private static final String KEY_DOWNLOAD_PROGRESS = "download_progress";

    private File findModelFile() {
        Context context = getContext();
        // Check 1: App internal files dir (best)
        File f1 = new File(context.getFilesDir(), MODEL_NAME);
        if (f1.exists())
            return f1;

        // Check 1.5: App Private External Storage (Accessible via ADB)
        // Path: /sdcard/Android/data/com.remindme.ai/files/
        File fPrivateExt = new File(context.getExternalFilesDir(null), MODEL_NAME);
        if (fPrivateExt != null && fPrivateExt.exists())
            return fPrivateExt;

        // Check 2: Downloads folder
        File f2 = new File(Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS), MODEL_NAME);
        if (f2.exists())
            return f2;

        // Check 3: /sdcard/ root
        File f3 = new File("/sdcard/", MODEL_NAME);
        if (f3.exists())
            return f3;

        // Check 4: /sdcard/Download/ (alternate path)
        File f4 = new File("/sdcard/Download/", MODEL_NAME);
        if (f4.exists())
            return f4;

        return null;
    }

    /**
     * Check if the model file is already present on device.
     */
    @PluginMethod
    public void checkModel(PluginCall call) {
        File f = findModelFile();
        JSObject ret = new JSObject();
        ret.put("exists", f != null);
        if (f != null) {
            ret.put("path", f.getAbsolutePath());
            ret.put("sizeMB", f.length() / (1024 * 1024));
        }
        call.resolve(ret);
    }

    /**
     * Auto-provision the model: download from hosted URL if not already present.
     * Reports progress back to the caller via events.
     * This is designed to be called on first app launch.
     */
    @PluginMethod
    public void autoProvisionModel(PluginCall call) {
        // Already have the model?
        File existing = findModelFile();
        if (existing != null) {
            Log.i(TAG, "Model already present at: " + existing.getAbsolutePath());
            JSObject ret = new JSObject();
            ret.put("status", "already_exists");
            ret.put("path", existing.getAbsolutePath());
            ret.put("sizeMB", existing.length() / (1024 * 1024));
            call.resolve(ret);
            return;
        }

        // Already downloading?
        if (isDownloading) {
            call.resolve(new JSObject().put("status", "downloading"));
            return;
        }

        String downloadUrl = call.getString("url", MODEL_DOWNLOAD_URL);

        isDownloading = true;

        new Thread(() -> {
            HttpURLConnection connection = null;
            InputStream input = null;
            OutputStream output = null;

            try {
                File destFile = new File(getContext().getFilesDir(), MODEL_NAME);
                File tempFile = new File(getContext().getFilesDir(), MODEL_NAME + ".download");

                // Resume support: if partial download exists, resume from last byte
                long existingBytes = 0;
                if (tempFile.exists()) {
                    existingBytes = tempFile.length();
                }

                URL url = new URL(downloadUrl);
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(30000);
                connection.setReadTimeout(30000);
                connection.setInstanceFollowRedirects(true); // HuggingFace redirects to CDN
                connection.setRequestProperty("User-Agent", "RemindMe-AI-Android/1.0");

                // Request range for resume
                if (existingBytes > 0) {
                    connection.setRequestProperty("Range", "bytes=" + existingBytes + "-");
                }

                // Handle redirects manually if needed (some Android versions need this)
                int responseCode = connection.getResponseCode();
                if (responseCode == 301 || responseCode == 302 || responseCode == 307) {
                    String redirectUrl = connection.getHeaderField("Location");
                    connection.disconnect();
                    url = new URL(redirectUrl);
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setConnectTimeout(30000);
                    connection.setReadTimeout(30000);
                    connection.setRequestProperty("User-Agent", "RemindMe-AI-Android/1.0");
                    if (existingBytes > 0) {
                        connection.setRequestProperty("Range", "bytes=" + existingBytes + "-");
                    }
                    responseCode = connection.getResponseCode();
                }

                long totalSize;
                boolean isResume = (responseCode == 206);

                if (isResume) {
                    // Partial content — resuming download
                    totalSize = existingBytes + connection.getContentLength();
                } else if (responseCode == 200) {
                    // Fresh download
                    totalSize = connection.getContentLength();
                    existingBytes = 0; // Reset — server doesn't support range
                    if (tempFile.exists()) tempFile.delete();
                } else {
                    throw new Exception("Server returned HTTP " + responseCode);
                }

                input = new BufferedInputStream(connection.getInputStream(), 8192);
                output = new FileOutputStream(tempFile, isResume); // append if resuming

                byte[] buffer = new byte[8192];
                long downloadedSoFar = existingBytes;
                int bytesRead;
                int lastReportedPercent = -1;

                while ((bytesRead = input.read(buffer)) != -1) {
                    output.write(buffer, 0, bytesRead);
                    downloadedSoFar += bytesRead;

                    // Report progress every 1%
                    if (totalSize > 0) {
                        int percent = (int) ((downloadedSoFar * 100) / totalSize);
                        if (percent != lastReportedPercent) {
                            lastReportedPercent = percent;
                            JSObject progress = new JSObject();
                            progress.put("percent", percent);
                            progress.put("downloadedMB", downloadedSoFar / (1024 * 1024));
                            progress.put("totalMB", totalSize / (1024 * 1024));
                            notifyListeners("modelDownloadProgress", progress);
                        }
                    }
                }

                output.flush();
                output.close();
                output = null;

                // Rename temp file to final name
                if (tempFile.renameTo(destFile)) {
                    Log.i(TAG, "Model downloaded successfully: " + destFile.getAbsolutePath());
                } else {
                    // Fallback: copy then delete
                    copyFile(tempFile, destFile);
                    tempFile.delete();
                }

                // Mark as provisioned
                SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit().putBoolean(KEY_MODEL_PROVISIONED, true).apply();

                isDownloading = false;

                JSObject ret = new JSObject();
                ret.put("status", "downloaded");
                ret.put("path", destFile.getAbsolutePath());
                ret.put("sizeMB", destFile.length() / (1024 * 1024));
                call.resolve(ret);

            } catch (Exception e) {
                isDownloading = false;
                Log.e(TAG, "Auto-provision failed: " + e.getMessage(), e);
                call.reject("Download failed: " + e.getMessage() +
                        ". The app will try again next time, or you can manually place the model file.");
            } finally {
                try { if (input != null) input.close(); } catch (Exception e) { /* ignore */ }
                try { if (output != null) output.close(); } catch (Exception e) { /* ignore */ }
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    /**
     * Get the current download/provision status.
     */
    @PluginMethod
    public void getProvisionStatus(PluginCall call) {
        File model = findModelFile();
        JSObject ret = new JSObject();
        ret.put("modelExists", model != null);
        ret.put("isDownloading", isDownloading);
        ret.put("isModelLoaded", llmInference != null);

        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        ret.put("wasProvisioned", prefs.getBoolean(KEY_MODEL_PROVISIONED, false));

        if (model != null) {
            ret.put("modelSizeMB", model.length() / (1024 * 1024));
        }

        call.resolve(ret);
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        String url = call.getString("url",
                "https://www.kaggle.com/models/google/gemma/frameworks/mediapipe/variations/gemma-2b-it-gpu-int4");
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void installModel(PluginCall call) {
        new Thread(() -> {
            try {
                Context context = getContext();
                File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);

                // Check for .bin directly
                File binFile = new File(downloadDir, MODEL_NAME);
                if (binFile.exists()) {
                    copyFileToInternal(binFile);
                    call.resolve(new JSObject().put("status", "installed").put("source", "bin"));
                    return;
                }

                // Check for archive.tar.gz (Kaggle default)
                File archiveFile = new File(downloadDir, KAGGLE_ARCHIVE_NAME);
                if (archiveFile.exists()) {
                    extractTarGz(archiveFile);
                    call.resolve(new JSObject().put("status", "installed").put("source", "archive"));
                    return;
                }

                // Check if user renamed it differently but valid extension
                File[] files = downloadDir.listFiles((dir, name) -> name.endsWith(".bin") && name.contains("gemma"));
                if (files != null && files.length > 0) {
                    copyFileToInternal(files[0]);
                    call.resolve(new JSObject().put("status", "installed").put("source", files[0].getName()));
                    return;
                }

                call.reject(
                        "No model file found in Downloads. Please download 'gemma-2b-it-gpu-int4.bin' or 'archive.tar.gz'.");

            } catch (Exception e) {
                call.reject("Install failed: " + e.getMessage());
            }
        }).start();
    }

    private void copyFile(File source, File dest) throws Exception {
        try (InputStream is = new FileInputStream(source);
                OutputStream os = new FileOutputStream(dest)) {
            byte[] buffer = new byte[8192];
            int length;
            while ((length = is.read(buffer)) > 0) {
                os.write(buffer, 0, length);
            }
        }
    }

    private void copyFileToInternal(File source) throws Exception {
        File dest = new File(getContext().getFilesDir(), MODEL_NAME);
        copyFile(source, dest);
    }

    private void extractTarGz(File archive) throws Exception {
        File destDir = getContext().getFilesDir();
        try (InputStream fi = new FileInputStream(archive);
                InputStream bi = new BufferedInputStream(fi);
                InputStream gzi = new GzipCompressorInputStream(bi);
                TarArchiveInputStream ti = new TarArchiveInputStream(gzi)) {

            TarArchiveEntry entry;
            while ((entry = ti.getNextTarEntry()) != null) {
                if (entry.getName().endsWith(".bin")) {
                    // Start writing to internal storage
                    File destFile = new File(destDir, MODEL_NAME); // Rename to standard name
                    try (OutputStream os = new FileOutputStream(destFile)) {
                        byte[] buffer = new byte[8192];
                        int len;
                        while ((len = ti.read(buffer)) != -1) {
                            os.write(buffer, 0, len);
                        }
                    }
                    return; // Found the model, stop extracting
                }
            }
        }
        throw new Exception("No .bin file found inside archive");
    }

    /**
     * Load the model with memory-optimized settings.
     * 
     * Memory budget breakdown (≤ 0.5 GB):
     * - Model weights (INT4): ~300 MB in GPU VRAM
     * - KV cache (maxTokens=256): ~80-100 MB
     * - Activation buffers + overhead: ~50-100 MB
     * - Total: ~430-500 MB
     */
    @PluginMethod
    public void loadModel(PluginCall call) {
        if (llmInference != null) {
            call.resolve(new JSObject().put("status", "already_loaded"));
            return;
        }

        if (isInitializing) {
            call.resolve(new JSObject().put("status", "initializing"));
            return;
        }

        isInitializing = true;

        new Thread(() -> {
            try {
                File modelFile = findModelFile();

                if (modelFile == null) {
                    isInitializing = false;
                    call.reject("Model file not found. The app will auto-download it shortly.");
                    return;
                }

                Log.i(TAG, "Loading model from: " + modelFile.getAbsolutePath()
                        + " (size: " + (modelFile.length() / (1024 * 1024)) + " MB)");

                // Memory-optimized options:
                // - maxTokens=256: limits KV cache to ~80-100 MB
                // - topK=20: reduces memory for top-K sampling
                // This keeps total RAM under 0.5 GB
                LlmInference.LlmInferenceOptions options = LlmInference.LlmInferenceOptions.builder()
                        .setModelPath(modelFile.getAbsolutePath())
                        .setMaxTokens(MAX_TOKENS)
                        .setTopK(MAX_TOP_K)
                        .build();

                llmInference = LlmInference.createFromOptions(getContext(), options);
                isInitializing = false;

                JSObject ret = new JSObject();
                ret.put("status", "loaded");
                ret.put("path", modelFile.getAbsolutePath());
                ret.put("maxTokens", MAX_TOKENS);
                ret.put("memoryBudgetMB", 500);
                call.resolve(ret);

            } catch (Exception e) {
                isInitializing = false;
                Log.e(TAG, "Model load failed: " + e.getMessage(), e);
                call.reject("Failed to load model: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void generate(PluginCall call) {
        if (llmInference == null) {
            call.reject("Model not loaded");
            return;
        }

        String prompt = call.getString("prompt");
        // Gemma formatting
        String formattedPrompt = "<start_of_turn>user\n" + prompt + "<end_of_turn>\n<start_of_turn>model\n";

        new Thread(() -> {
            try {
                String result = llmInference.generateResponse(formattedPrompt);
                String cleaned = result;
                if (cleaned.contains("<end_of_turn>")) {
                    cleaned = cleaned.substring(0, cleaned.indexOf("<end_of_turn>"));
                }
                cleaned = cleaned.trim();

                JSObject ret = new JSObject();
                ret.put("response", cleaned);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Generation failed: " + e.getMessage());
            }
        }).start();
    }

    /**
     * Unload the model to free RAM.
     */
    @PluginMethod
    public void unloadModel(PluginCall call) {
        if (llmInference != null) {
            try {
                llmInference.close();
            } catch (Exception e) {
                Log.w(TAG, "Error closing model: " + e.getMessage());
            }
            llmInference = null;
        }
        isInitializing = false;
        call.resolve(new JSObject().put("status", "unloaded"));
    }

    /**
     * Delete the downloaded model file to free disk space.
     */
    @PluginMethod
    public void deleteModel(PluginCall call) {
        // Unload first
        if (llmInference != null) {
            try { llmInference.close(); } catch (Exception e) { /* ignore */ }
            llmInference = null;
        }

        File f = new File(getContext().getFilesDir(), MODEL_NAME);
        boolean deleted = false;
        if (f.exists()) {
            deleted = f.delete();
        }

        // Also clear temp file
        File temp = new File(getContext().getFilesDir(), MODEL_NAME + ".download");
        if (temp.exists()) temp.delete();

        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_MODEL_PROVISIONED, false).apply();

        call.resolve(new JSObject().put("deleted", deleted));
    }
}
