package com.chasegrey.mybrain;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;

/**
 * The web app hands the widget what to show. Nothing is computed here: the app already knows today's list,
 * so it sends the finished lines and this stores them for {@link TodayWidget} to draw.
 */
@CapacitorPlugin(name = "Widget")
public class WidgetPlugin extends Plugin {
    static final String PREFS = "today_widget";
    static final String KEY_TITLE = "title";
    static final String KEY_LINES = "lines";
    static final String KEY_UPDATED = "updatedAt";

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "today");
        JSArray lines = call.getArray("lines", new JSArray());
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(KEY_TITLE, title)
            .putString(KEY_LINES, lines.toString())
            .putLong(KEY_UPDATED, System.currentTimeMillis())
            .apply();
        TodayWidget.refreshAll(context);
        call.resolve();
    }

    /** What the widget reads back. Each line has an id, text, and an optional hint. */
    static JSONArray storedLines(Context context) {
        String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_LINES, "[]");
        try {
            return new JSONArray(raw);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static String storedTitle(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_TITLE, "today");
    }
}
