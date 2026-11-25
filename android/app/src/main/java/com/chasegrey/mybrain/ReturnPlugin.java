package com.chasegrey.mybrain;

import android.net.Uri;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Brings the webview back to the app after it has been away at another site, as it is while signing in to microsoft.
 * The shell serves the app by answering requests for its own address, but the webview does not ask it about an
 * address it was redirected to: it goes to the network, where nothing is listening, and shows "webpage not available".
 * Loading the same address again from here does go through the shell.
 */
@CapacitorPlugin(name = "Return")
public class ReturnPlugin extends Plugin {
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        Uri app = Uri.parse(bridge.getAppUrl());
        boolean toApp = app.getScheme() != null && app.getScheme().equals(url.getScheme())
            && app.getHost() != null && app.getHost().equals(url.getHost());
        if (!toApp) return null;
        WebView webView = bridge.getWebView();
        String address = url.toString();
        webView.post(() -> webView.loadUrl(address));
        return true;
    }
}
