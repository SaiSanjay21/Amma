package com.remindme.ai;

import android.content.Context;
import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mediapipe.tasks.genai.llminference.LlmInference;
import java.io.File;

@CapacitorPlugin(name = "LlmPlugin")
public class LlmPlugin extends Plugin {
    private static final String MODEL_NAME = "gemma-2b-it-gpu-int4.bin";
    private LlmInference llmInference;
    private boolean isInitializing = false;

    /**
     * Find the model file. We check multiple locations:
     * 1. App's internal files dir (best)
     * 2. Downloads folder (user-friendly)
     * 3. /sdcard/ root (adb push friendly)
     */
    private File findModelFile() {
        Context context = getContext();

        // Check 1: App internal files dir
        File f1 = new File(context.getFilesDir(), MODEL_NAME);
        if (f1.exists())
            return f1;

        // Check 2: Downloads folder
        File f2 = new File(Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS), MODEL_NAME);
        if (f2.exists())
            return f2;

        // Check 3: /sdcard/ root
        File f3 = new File(Environment.getExternalStorageDirectory(), MODEL_NAME);
        if (f3.exists())
            return f3;

        // Check 4: App-specific external files dir
        File[] externalDirs = context.getExternalFilesDirs(null);
        if (externalDirs != null) {
            for (File dir : externalDirs) {
                if (dir != null) {
                    File f = new File(dir, MODEL_NAME);
                    if (f.exists())
                        return f;
                }
            }
        }

        return null;
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
                    call.reject("Model file not found. Please transfer '" + MODEL_NAME +
                            "' to your phone's Downloads folder or push via: " +
                            "adb push model.bin /sdcard/" + MODEL_NAME);
                    return;
                }

                // Initialize MediaPipe LLM Inference
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
            call.reject("Model not loaded. Call loadModel() first.");
            return;
        }

        String prompt = call.getString("prompt");
        if (prompt == null || prompt.trim().isEmpty()) {
            call.reject("Missing prompt");
            return;
        }

        // Format prompt for Gemma instruction-tuned model
        String formattedPrompt = "<start_of_turn>user\n" + prompt + "<end_of_turn>\n<start_of_turn>model\n";

        new Thread(() -> {
            try {
                String result = llmInference.generateResponse(formattedPrompt);

                // Clean up response
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
        File modelFile = findModelFile();
        JSObject ret = new JSObject();
        ret.put("found", modelFile != null);
        ret.put("path", modelFile != null ? modelFile.getAbsolutePath() : "not found");
        ret.put("loaded", llmInference != null);
        call.resolve(ret);
    }
}
