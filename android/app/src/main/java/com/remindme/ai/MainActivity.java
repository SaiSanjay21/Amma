package com.remindme.ai;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HealthPlugin.class);
        registerPlugin(LlmPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
