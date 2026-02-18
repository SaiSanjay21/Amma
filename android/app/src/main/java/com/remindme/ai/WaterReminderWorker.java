package com.remindme.ai;

import android.app.NotificationManager;
import android.content.Context;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.Calendar;

public class WaterReminderWorker extends Worker {

    public WaterReminderWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        int wakeHour = getInputData().getInt("wakeHour", 7);
        int wakeMinute = getInputData().getInt("wakeMinute", 0);
        int sleepHour = getInputData().getInt("sleepHour", 23);
        int sleepMinute = getInputData().getInt("sleepMinute", 0);

        // Only fire during waking hours
        Calendar now = Calendar.getInstance();
        int currentMinutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
        int wakeMinutes = wakeHour * 60 + wakeMinute;
        int sleepMinutes = sleepHour * 60 + sleepMinute;

        if (currentMinutes < wakeMinutes || currentMinutes > sleepMinutes) {
            return Result.success();
        }

        // Fire notification
        NotificationCompat.Builder builder = new NotificationCompat.Builder(
                getApplicationContext(), "health_reminders")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Time to drink water! 💧")
                .setContentText("Stay hydrated — hit your daily goal!")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true);

        NotificationManager nm = (NotificationManager) getApplicationContext()
                .getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify((int) System.currentTimeMillis(), builder.build());
        }

        return Result.success();
    }
}
