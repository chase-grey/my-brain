package com.chasegrey.mybrain;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetPlugin.class);
        registerPlugin(HealthPlugin.class);
        registerPlugin(ReturnPlugin.class);
        registerPlugin(UpdatePlugin.class);
        registerPlugin(WifiPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
