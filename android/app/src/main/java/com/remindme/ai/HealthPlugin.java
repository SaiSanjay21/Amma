package com.remindme.ai;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Calendar;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "HealthPlugin")
public class HealthPlugin extends Plugin {

    private static final String CHANNEL_ID = "health_reminders";
    private static final String WATER_TAG = "water_reminder";
    private static final String MEAL_TAG = "meal_reminder";

    @PluginMethod
    public void createNotificationChannel(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Health Reminders",
                    NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Water and meal reminders from Amma");
            NotificationManager nm = getContext().getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
        JSObject result = new JSObject();
        result.put("status", "done");
        call.resolve(result);
    }

    @PluginMethod
    public void scheduleWaterReminders(PluginCall call) {
        int intervalMinutes = call.getInt("intervalMinutes", 90);
        int wakeHour = call.getInt("wakeHour", 7);
        int wakeMinute = call.getInt("wakeMinute", 0);
        int sleepHour = call.getInt("sleepHour", 23);
        int sleepMinute = call.getInt("sleepMinute", 0);
        int targetMl = call.getInt("targetMl", 2000);

        WorkManager wm = WorkManager.getInstance(getContext());

        // Cancel existing
        wm.cancelAllWorkByTag(WATER_TAG);

        // Build input data
        Data inputData = new Data.Builder()
                .putInt("wakeHour", wakeHour)
                .putInt("wakeMinute", wakeMinute)
                .putInt("sleepHour", sleepHour)
                .putInt("sleepMinute", sleepMinute)
                .putInt("targetMl", targetMl)
                .build();

        // WorkManager minimum periodic interval is 15 minutes
        int safeInterval = Math.max(intervalMinutes, 15);

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                WaterReminderWorker.class,
                safeInterval,
                TimeUnit.MINUTES)
                .setInputData(inputData)
                .addTag(WATER_TAG)
                .build();

        wm.enqueueUniquePeriodicWork(
                "water_periodic",
                ExistingPeriodicWorkPolicy.UPDATE,
                request);

        JSObject result = new JSObject();
        result.put("status", "scheduled");
        result.put("intervalMinutes", safeInterval);
        call.resolve(result);
    }

    @PluginMethod
    public void scheduleMealReminders(PluginCall call) {
        int breakfastHour = call.getInt("breakfastHour", 8);
        int breakfastMinute = call.getInt("breakfastMinute", 0);
        int lunchHour = call.getInt("lunchHour", 12);
        int lunchMinute = call.getInt("lunchMinute", 0);
        int dinnerHour = call.getInt("dinnerHour", 18);
        int dinnerMinute = call.getInt("dinnerMinute", 0);

        WorkManager wm = WorkManager.getInstance(getContext());
        wm.cancelAllWorkByTag(MEAL_TAG);

        scheduleMealWork(wm, "breakfast", breakfastHour, breakfastMinute);
        scheduleMealWork(wm, "lunch", lunchHour, lunchMinute);
        scheduleMealWork(wm, "dinner", dinnerHour, dinnerMinute);

        JSObject result = new JSObject();
        result.put("status", "scheduled");
        call.resolve(result);
    }

    private void scheduleMealWork(WorkManager wm, String mealName, int hour, int minute) {
        long delayMs = getDelayUntilNextOccurrence(hour, minute);

        Data inputData = new Data.Builder()
                .putString("mealName", mealName)
                .build();

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                MealReminderWorker.class,
                24,
                TimeUnit.HOURS)
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .setInputData(inputData)
                .addTag(MEAL_TAG)
                .build();

        wm.enqueueUniquePeriodicWork(
                "meal_" + mealName,
                ExistingPeriodicWorkPolicy.UPDATE,
                request);
    }

    private long getDelayUntilNextOccurrence(int hour, int minute) {
        Calendar now = Calendar.getInstance();
        Calendar target = Calendar.getInstance();
        target.set(Calendar.HOUR_OF_DAY, hour);
        target.set(Calendar.MINUTE, minute);
        target.set(Calendar.SECOND, 0);
        target.set(Calendar.MILLISECOND, 0);

        if (target.before(now)) {
            target.add(Calendar.DAY_OF_YEAR, 1);
        }

        return target.getTimeInMillis() - now.getTimeInMillis();
    }

    @PluginMethod
    public void cancelHealthReminders(PluginCall call) {
        WorkManager wm = WorkManager.getInstance(getContext());
        wm.cancelAllWorkByTag(WATER_TAG);
        wm.cancelAllWorkByTag(MEAL_TAG);

        JSObject result = new JSObject();
        result.put("status", "cancelled");
        call.resolve(result);
    }
}
