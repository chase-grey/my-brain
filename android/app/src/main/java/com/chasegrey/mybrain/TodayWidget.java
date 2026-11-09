package com.chasegrey.mybrain;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget: today's first few tasks and a talk button. Every tap is a mybrain:// link into the app,
 * which the web side turns into its own hash route.
 */
public class TodayWidget extends AppWidgetProvider {
    private static final int[] LINE_IDS = { R.id.line1, R.id.line2, R.id.line3, R.id.line4, R.id.line5 };
    private static final int[] HINT_IDS = { R.id.hint1, R.id.hint2, R.id.hint3, R.id.hint4, R.id.hint5 };
    private static final int[] ROW_IDS = { R.id.row1, R.id.row2, R.id.row3, R.id.row4, R.id.row5 };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int id : widgetIds) manager.updateAppWidget(id, build(context));
    }

    /** Called by {@link WidgetPlugin} whenever the app sends fresh lines. */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidget.class));
        if (ids.length == 0) return;
        RemoteViews views = build(context);
        for (int id : ids) manager.updateAppWidget(id, views);
    }

    private static RemoteViews build(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.today_widget);
        views.setTextViewText(R.id.title, WidgetPlugin.storedTitle(context));
        views.setOnClickPendingIntent(R.id.title, open(context, "mybrain://today", 0));
        views.setOnClickPendingIntent(R.id.talk, open(context, "mybrain://chat/talk", 1));

        JSONArray lines = WidgetPlugin.storedLines(context);
        views.setViewVisibility(R.id.empty, lines.length() == 0 ? View.VISIBLE : View.GONE);
        for (int i = 0; i < ROW_IDS.length; i++) {
            JSONObject line = lines.optJSONObject(i);
            if (line == null) {
                views.setViewVisibility(ROW_IDS[i], View.GONE);
                continue;
            }
            views.setViewVisibility(ROW_IDS[i], View.VISIBLE);
            views.setTextViewText(LINE_IDS[i], line.optString("text", ""));
            String hint = line.optString("hint", "");
            views.setTextViewText(HINT_IDS[i], hint);
            views.setViewVisibility(HINT_IDS[i], hint.isEmpty() ? View.GONE : View.VISIBLE);
            String taskId = line.optString("id", "");
            String target = taskId.isEmpty() ? "mybrain://today" : "mybrain://task/" + Uri.encode(taskId);
            views.setOnClickPendingIntent(ROW_IDS[i], open(context, target, 10 + i));
        }
        return views;
    }

    private static PendingIntent open(Context context, String url, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
