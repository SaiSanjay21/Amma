package com.remindme.ai;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
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

@CapacitorPlugin(name = "LlmPlugin")
public class LlmPlugin extends Plugin {
    private static final String MODEL_NAME = "gemma-2b-it-gpu-int4.bin";
    private static final String KAGGLE_ARCHIVE_NAME = "archive.tar.gz";
    private LlmInference llmInference;
    private boolean isInitializing = false;

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

    private void copyFileToInternal(File source) throws Exception {
        File dest = new File(getContext().getFilesDir(), MODEL_NAME);
        try (InputStream is = new FileInputStream(source);
                OutputStream os = new FileOutputStream(dest)) {
            byte[] buffer = new byte[8192];
            int length;
            while ((length = is.read(buffer)) > 0) {
                os.write(buffer, 0, length);
            }
        }
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
                    call.reject("Model file not found. Please tap 'Download Model'.");
                    return;
                }

                LlmInference.LlmInferenceOptions options = LlmInference.LlmInferenceOptions.builder()
                        .setModelPath(modelFile.getAbsolutePath())
                        .setMaxTokens(512)
                        .build();

                llmInference = LlmInference.createFromOptions(getContext(), options);
                isInitializing = false;

                JSObject ret = new JSObject();
                ret.put("status", "loaded");
                ret.put("path", modelFile.getAbsolutePath());
                call.resolve(ret);

            } catch (Exception e) {
                isInitializing = false;
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

    @PluginMethod
    public void checkModel(PluginCall call) {
        File f = findModelFile();
        call.resolve(new JSObject().put("exists", f != null));
    }
}
