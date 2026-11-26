package com.chasegrey.mybrain;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Brings the webview back to the app after it has been away at another site, as it is while signing in to microsoft.
 * The shell serves the app by answering requests for its own address, but the webview does not ask it about an
 * address it was redirected to: it goes to the network, where nothing is listening, and shows "webpage not available".
 * Loading the same address again from here does go through the shell.
 *
 * Only a page that is away is brought back. The app moving within itself (reloading onto an update) is left to the
 * webview: loading the address it is already on, from here, would not reload anything.
 *
 * It also keeps the webview's side of a sign-in for the sign-in log (src/signInLog.ts): where the page went, by
 * address without anything after ? or #, and what failed to load. The app cannot be inspected from a computer.
 */
@CapacitorPlugin(name = "Return")
public class ReturnPlugin extends Plugin {
    private static final String PREFS = "signInLog";
    private static final String LINES = "lines";
    private static final int MAX_LINES = 80;

    private final ArrayDeque<String> lines = new ArrayDeque<>();

    @Override
    public void load() {
        String kept = prefs().getString(LINES, "");
        if (kept != null && !kept.isEmpty()) for (String line : kept.split("\n")) lines.add(line);
        bridge.setWebViewClient(new Watching(bridge));
    }

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        WebView webView = bridge.getWebView();
        String from = webView.getUrl();
        boolean toApp = isApp(url);
        boolean away = from != null && !isApp(Uri.parse(from));
        if (toApp || away) note("going to " + place(url) + " from " + (from == null ? "nothing" : place(Uri.parse(from))) + (toApp && away ? ", loaded by the shell" : ""));
        if (!toApp || !away) return null;
        String address = url.toString();
        webView.post(() -> webView.loadUrl(address));
        return true;
    }

    /** The webview's lines for the sign-in log, oldest first. */
    @PluginMethod
    public void log(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (lines) {
            result.put("lines", String.join("\n", lines));
        }
        call.resolve(result);
    }

    private boolean isApp(Uri url) {
        Uri app = Uri.parse(bridge.getAppUrl());
        return app.getScheme() != null && app.getScheme().equals(url.getScheme())
            && app.getHost() != null && app.getHost().equals(url.getHost());
    }

    /** An address as the log keeps it: where, and whether it carried an answer, never the answer itself. */
    private static String place(Uri url) {
        String fragment = url.getEncodedFragment();
        String query = url.getEncodedQuery();
        String carried = (fragment == null ? "" : fragment) + "&" + (query == null ? "" : query);
        String answer = carried.contains("code=") ? " (with a code)" : carried.contains("error=") ? " (with an error)" : "";
        return url.getScheme() + "://" + url.getHost() + (url.getPath() == null ? "" : url.getPath()) + answer;
    }

    private void note(String line) {
        SimpleDateFormat clock = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        clock.setTimeZone(TimeZone.getTimeZone("UTC"));
        synchronized (lines) {
            lines.add(clock.format(new Date()) + " webview " + line);
            while (lines.size() > MAX_LINES) lines.remove();
            prefs().edit().putString(LINES, String.join("\n", lines)).apply();
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The shell's own client, which also writes down pages that are not the app and anything that fails to load. */
    private class Watching extends BridgeWebViewClient {
        Watching(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            Uri page = Uri.parse(url);
            if (!isApp(page) || place(page).contains("(with")) note("page started " + place(page));
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() || !isApp(request.getUrl())) {
                note((request.isForMainFrame() ? "page" : "part of the page") + " failed " + place(request.getUrl()) + " " + error.getErrorCode() + " " + error.getDescription());
            }
            super.onReceivedError(view, request, error);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            if (request.isForMainFrame()) note("page answered " + errorResponse.getStatusCode() + " " + place(request.getUrl()));
            super.onReceivedHttpError(view, request, errorResponse);
        }
    }
}
