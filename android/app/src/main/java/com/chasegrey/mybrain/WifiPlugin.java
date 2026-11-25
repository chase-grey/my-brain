package com.chasegrey.mybrain;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Tells the app whether the phone is on wifi and the name of the network, so it can tell home from work.
 *
 * Android hands out a network's name only to an app that holds the location permission, so that is asked for,
 * but nothing here ever asks where the phone is: the name of the connected network is the only thing read.
 */
@CapacitorPlugin(
    name = "Wifi",
    permissions = {
        @Permission(
            alias = WifiPlugin.NAME,
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        )
    }
)
public class WifiPlugin extends Plugin {
    static final String NAME = "wifiName";

    /** The name is given only with the precise permission; the approximate one alone is not enough. */
    private boolean allowed() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    private boolean onWifi() {
        ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return false;
        Network network = manager.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
    }

    @SuppressWarnings("deprecation")
    private String networkName() {
        WifiManager manager = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (manager == null) return null;
        WifiInfo info = manager.getConnectionInfo();
        if (info == null) return null;
        String name = info.getSSID();
        if (name == null || name.isEmpty() || name.equals(WifiManager.UNKNOWN_SSID)) return null;
        if (name.length() >= 2 && name.startsWith("\"") && name.endsWith("\"")) name = name.substring(1, name.length() - 1);
        return name.isEmpty() ? null : name;
    }

    @PluginMethod
    public void current(PluginCall call) {
        answer(call);
    }

    /** Shows android's prompt when the name is not allowed yet. Resolves once it has been answered. */
    @PluginMethod
    public void allow(PluginCall call) {
        if (allowed()) {
            answer(call);
            return;
        }
        requestPermissionForAlias(NAME, call, "answer");
    }

    @PermissionCallback
    private void answer(PluginCall call) {
        JSObject result = new JSObject();
        boolean wifi = onWifi();
        boolean allowed = allowed();
        result.put("wifi", wifi);
        result.put("allowed", allowed);
        if (wifi && allowed) {
            try {
                String name = networkName();
                if (name != null) result.put("name", name);
            } catch (RuntimeException e) {
                // No name to give; the app falls back to the clock.
            }
        }
        call.resolve(result);
    }
}
