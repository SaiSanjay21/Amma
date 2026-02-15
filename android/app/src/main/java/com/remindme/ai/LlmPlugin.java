package com.remindme.ai;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mediapipe.tasks.genai.llminference.LlmInference;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "LlmPlugin")
public class LlmPlugin extends Plugin {
    private static final String MODEL_NAME = "gemma-2b-it-gpu-int4.bin";
    private LlmInference llmInference;
    private boolean isInitializing = false;

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
        Context context = getContext();

        new Thread(() -> {
            try {
                File modelFile = new File(context.getFilesDir(), MODEL_NAME);
                if (!modelFile.exists()) {
                    // Copy from assets
                    try (InputStream is = context.getAssets().open(MODEL_NAME);
                            OutputStream os = new FileOutputStream(modelFile)) {
                        byte[] buffer = new byte[1024];
                        int read;
                        while ((read = is.read(buffer)) != -1) {
                            os.write(buffer, 0, read);
                        }
                    }
                }

                // Initialize Inference engine
                LlmInference.LlmInferenceOptions options = LlmInference.LlmInferenceOptions.builder()
                        .setModelPath(modelFile.getAbsolutePath())
                        .setMaxTokens(512)
                        .setResultListener((partialResult, done) -> {
                            // We handle sync or async in generate()
                        })
                        .build();

                llmInference = LlmInference.createFromOptions(context, options);
                isInitializing = false;

                JSObject ret = new JSObject();
                ret.put("status", "loaded");
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
            call.reject("Model not loaded call loadModel() first");
            return;
        }

        String prompt = call.getString("prompt");
        if (prompt == null) {
            call.reject("Missing prompt");
            return;
        }

        // Run generation in background thread to avoid blocking UI
        new Thread(() -> {
            try {
                // Synchronous generation for simplicity in this MVP
                String result = llmInference.generateResponse(prompt);
                JSObject ret = new JSObject();
                ret.put("response", result);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Generation failed: " + e.getMessage());
            }
        }).start();
    }
}
