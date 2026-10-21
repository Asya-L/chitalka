package ru.mezhdustrok.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Будильник занятия и перезапуск будильников после перезагрузки или обновления. */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if ("ru.mezhdustrok.REMIND".equals(a)) {
            String id = intent.getStringExtra("id");
            if (id != null) Reminders.fire(ctx, id);
        } else {
            Reminders.scheduleAll(ctx);
        }
    }
}
