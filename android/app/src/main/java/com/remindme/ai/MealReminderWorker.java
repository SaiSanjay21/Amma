package com.remindme.ai;

import android.app.NotificationManager;
import android.content.Context;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public class MealReminderWorker extends Worker {

    public MealReminderWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        String mealName = getInputData().getString("mealName");
        if (mealName == null)
            mealName = "Meal";

        // Capitalize meal name
        String displayName = mealName.substring(0, 1).toUpperCase() + mealName.substring(1);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(
                getApplicationContext(), "health_reminders")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Time to eat! 🍽️")
                .setContentText(displayName + " time. Log your meal in Amma.")
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
