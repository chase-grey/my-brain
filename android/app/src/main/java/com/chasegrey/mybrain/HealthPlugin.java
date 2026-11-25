package com.chasegrey.mybrain;

import android.app.AppOpsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.ReadRecordsRequestUsingFilters;
import android.health.connect.ReadRecordsResponse;
import android.health.connect.TimeInstantRangeFilter;
import android.health.connect.datatypes.SleepSessionRecord;
import android.os.Build;
import android.os.OutcomeReceiver;
import android.os.Process;
import android.provider.Settings;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.text.SimpleDateFormat;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * What the rest slice reads from the phone: sleep from Health Connect and screen time from the usage record.
 * It only reads. Each day comes back as {day, sleepMin?, screenMin?, bedMin?} and the web app keeps them, because the
 * phone itself holds daily screen time for about a week.
 *
 * Sleep needs Android 14, where Health Connect is part of the system; on older phones it answers "unavailable".
 */
@CapacitorPlugin(
    name = "Health",
    permissions = { @Permission(alias = HealthPlugin.SLEEP, strings = { "android.permission.health.READ_SLEEP" }) }
)
public class HealthPlugin extends Plugin {
    static final String SLEEP = "sleep";
    private static final String GRANTED = "granted";
    private static final String DENIED = "denied";
    private static final String UNAVAILABLE = "unavailable";
    private static final long DAY_MS = 86_400_000L;

    private boolean sleepSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE;
    }

    private String sleepAccess() {
        if (!sleepSupported()) return UNAVAILABLE;
        return getPermissionState(SLEEP) == PermissionState.GRANTED ? GRANTED : DENIED;
    }

    private String screenAccess() {
        Context context = getContext();
        AppOpsManager ops = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        if (ops == null) return UNAVAILABLE;
        int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.getPackageName())
            : ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED ? GRANTED : DENIED;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("sleep", sleepAccess());
        result.put("screen", screenAccess());
        call.resolve(result);
    }

    @PluginMethod
    public void requestSleep(PluginCall call) {
        if (!sleepSupported() || getPermissionState(SLEEP) == PermissionState.GRANTED) {
            sleepAnswered(call);
            return;
        }
        requestPermissionForAlias(SLEEP, call, "sleepAnswered");
    }

    @PermissionCallback
    private void sleepAnswered(PluginCall call) {
        JSObject result = new JSObject();
        result.put("sleep", sleepAccess());
        call.resolve(result);
    }

    /** Usage access is a switch on a system screen, not a prompt; this opens that screen. */
    @PluginMethod
    public void openUsageAccess(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void read(PluginCall call) {
        int days = Math.max(1, Math.min(60, call.getInt("days", 28)));
        Map<String, JSObject> byDay = new TreeMap<>();
        if (GRANTED.equals(screenAccess())) readScreenTime(days, byDay);
        if (GRANTED.equals(sleepAccess()) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            readSleep(days, byDay, call);
            return;
        }
        finish(call, byDay);
    }

    private static void finish(PluginCall call, Map<String, JSObject> byDay) {
        JSArray list = new JSArray();
        for (JSObject day : byDay.values()) list.put(day);
        JSObject result = new JSObject();
        result.put("days", list);
        call.resolve(result);
    }

    private static JSObject dayOf(Map<String, JSObject> byDay, String day) {
        JSObject entry = byDay.get(day);
        if (entry == null) {
            entry = new JSObject();
            entry.put("day", day);
            byDay.put(day, entry);
        }
        return entry;
    }

    /** Time with any app in front, by local day. The home screen is left out, the way the phone's own count leaves it out. */
    private void readScreenTime(int days, Map<String, JSObject> byDay) {
        Context context = getContext();
        UsageStatsManager manager = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
        if (manager == null) return;
        Calendar start = Calendar.getInstance();
        start.set(Calendar.HOUR_OF_DAY, 0);
        start.set(Calendar.MINUTE, 0);
        start.set(Calendar.SECOND, 0);
        start.set(Calendar.MILLISECOND, 0);
        start.add(Calendar.DAY_OF_YEAR, -days);
        List<UsageStats> stats = manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start.getTimeInMillis(), System.currentTimeMillis());
        if (stats == null) return;

        Set<String> launchers = new HashSet<>();
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        for (ResolveInfo info : context.getPackageManager().queryIntentActivities(home, 0)) {
            if (info.activityInfo != null) launchers.add(info.activityInfo.packageName);
        }

        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        Map<String, Long> totals = new TreeMap<>();
        for (UsageStats item : stats) {
            long millis = item.getTotalTimeInForeground();
            if (millis <= 0 || launchers.contains(item.getPackageName())) continue;
            String day = format.format(new Date(item.getFirstTimeStamp()));
            Long sum = totals.get(day);
            totals.put(day, (sum == null ? 0L : sum) + millis);
        }
        for (Map.Entry<String, Long> entry : totals.entrySet()) {
            // A day cannot hold more than a day; a bucket that says so is one the system has merged, and is skipped.
            if (entry.getValue() > DAY_MS) continue;
            dayOf(byDay, entry.getKey()).put("screenMin", Math.round(entry.getValue() / 60_000.0));
        }
    }

    /**
     * Sleep sessions from every source, overlaps counted once, each put on the local day it ended.
     * bedMin is when the day's longest stretch began, in minutes after noon the evening before.
     */
    @RequiresApi(api = Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private void readSleep(int days, Map<String, JSObject> byDay, PluginCall call) {
        Context context = getContext();
        HealthConnectManager manager = context.getSystemService(HealthConnectManager.class);
        if (manager == null) {
            finish(call, byDay);
            return;
        }
        Instant end = Instant.now();
        Instant start = end.minusMillis((days + 1) * DAY_MS);
        ReadRecordsRequestUsingFilters<SleepSessionRecord> request = new ReadRecordsRequestUsingFilters.Builder<>(SleepSessionRecord.class)
            .setTimeRangeFilter(new TimeInstantRangeFilter.Builder().setStartTime(start).setEndTime(end).build())
            .build();
        manager.readRecords(request, context.getMainExecutor(), new OutcomeReceiver<ReadRecordsResponse<SleepSessionRecord>, HealthConnectException>() {
            @Override
            public void onResult(@NonNull ReadRecordsResponse<SleepSessionRecord> response) {
                List<long[]> spans = new ArrayList<>();
                for (SleepSessionRecord record : response.getRecords()) {
                    spans.add(new long[] { record.getStartTime().toEpochMilli(), record.getEndTime().toEpochMilli() });
                }
                spans.sort((a, b) -> Long.compare(a[0], b[0]));
                List<long[]> merged = new ArrayList<>();
                for (long[] span : spans) {
                    long[] last = merged.isEmpty() ? null : merged.get(merged.size() - 1);
                    if (last != null && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
                    else merged.add(new long[] { span[0], span[1] });
                }
                Map<String, Long> totals = new TreeMap<>();
                Map<String, long[]> longest = new TreeMap<>();
                ZoneId zone = ZoneId.systemDefault();
                for (long[] span : merged) {
                    String day = Instant.ofEpochMilli(span[1]).atZone(zone).toLocalDate().toString();
                    Long sum = totals.get(day);
                    totals.put(day, (sum == null ? 0L : sum) + (span[1] - span[0]));
                    long[] main = longest.get(day);
                    if (main == null || span[1] - span[0] > main[1] - main[0]) longest.put(day, span);
                }
                for (Map.Entry<String, long[]> entry : longest.entrySet()) {
                    java.time.LocalTime began = Instant.ofEpochMilli(entry.getValue()[0]).atZone(zone).toLocalTime();
                    dayOf(byDay, entry.getKey()).put("bedMin", (began.getHour() * 60 + began.getMinute() + 720) % 1440);
                }
                for (Map.Entry<String, Long> entry : totals.entrySet()) {
                    dayOf(byDay, entry.getKey()).put("sleepMin", Math.round(entry.getValue() / 60_000.0));
                }
                finish(call, byDay);
            }

            @Override
            public void onError(@NonNull HealthConnectException error) {
                // Screen time still goes back; sleep is simply missing this time.
                finish(call, byDay);
            }
        });
    }
}
