package ru.mezhdustrok.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Напоминания по расписанию без интернета: веб-приложение передаёт расписание через мост,
 * здесь ставятся будильники Android на ближайшее время каждого занятия.
 */
final class Reminders {
    static final String PREFS = "reminders";
    static final String CHANNEL = "reminders";
    private static final String[][] LANG = {{"en", "Английский"}, {"pl", "Польский"}, {"zh", "Китайский"}};

    private Reminders() { }

    static String langName(String code) {
        for (String[] l : LANG) if (l[0].equals(code)) return l[1];
        return code;
    }

    static void save(Context ctx, String json) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("data", json).apply();
        scheduleAll(ctx);
    }

    static JSONObject load(Context ctx) {
        try { return new JSONObject(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("data", "{}")); }
        catch (Exception e) { return new JSONObject(); }
    }

    /** Ставит будильник на ближайшее срабатывание каждого занятия, снимает удалённые. */
    static void scheduleAll(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        Set<String> old = p.getStringSet("ids", new HashSet<>());
        Set<String> now = new HashSet<>();
        JSONArray items = load(ctx).optJSONArray("items");
        if (items != null) {
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null || it.optBoolean("off")) continue;
                String id = it.optString("id");
                long at = nextTime(it, System.currentTimeMillis());
                if (at <= 0) continue;
                now.add(id);
                am.setWindow(AlarmManager.RTC_WAKEUP, at, 5 * 60 * 1000L, pending(ctx, id));
            }
        }
        for (String id : old) if (!now.contains(id)) am.cancel(pending(ctx, id));
        p.edit().putStringSet("ids", now).apply();
    }

    private static PendingIntent pending(Context ctx, String id) {
        Intent i = new Intent(ctx, ReminderReceiver.class).setAction("ru.mezhdustrok.REMIND").putExtra("id", id);
        return PendingIntent.getBroadcast(ctx, id.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Ближайшее время занятия после from (дни — ISO: 1 = понедельник). */
    static long nextTime(JSONObject it, long from) {
        JSONArray days = it.optJSONArray("days");
        if (days == null || days.length() == 0) return -1;
        List<Integer> d = new ArrayList<>();
        for (int i = 0; i < days.length(); i++) d.add(days.optInt(i));
        String[] hm = it.optString("time", "19:00").split(":");
        int h = Integer.parseInt(hm[0]), m = hm.length > 1 ? Integer.parseInt(hm[1]) : 0;
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(from);
        c.set(Calendar.HOUR_OF_DAY, h); c.set(Calendar.MINUTE, m); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        for (int k = 0; k < 8; k++) {
            int iso = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7 + 1;
            if (d.contains(iso) && c.getTimeInMillis() > from + 30_000) return c.getTimeInMillis();
            c.add(Calendar.DAY_OF_MONTH, 1);
        }
        return -1;
    }

    /** Срабатывание будильника: показать напоминание, если план на сегодня ещё не выполнен. */
    static void fire(Context ctx, String id) {
        JSONObject data = load(ctx);
        JSONArray items = data.optJSONArray("items");
        JSONObject it = null;
        if (items != null) for (int i = 0; i < items.length(); i++) {
            JSONObject x = items.optJSONObject(i);
            if (x != null && id.equals(x.optString("id"))) { it = x; break; }
        }
        if (it != null) {
            String lang = it.optString("lang");
            int plan = it.optInt("min", 20);
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Calendar.getInstance().getTime());
            JSONObject info = data.optJSONObject("info") != null ? data.optJSONObject("info").optJSONObject(lang) : null;
            double done = info != null && today.equals(data.optString("day")) ? info.optDouble("done", 0) : 0;
            if (done < plan) show(ctx, lang, plan, done, info);
        }
        scheduleAll(ctx);
    }

    private static void show(Context ctx, String lang, int plan, double done, JSONObject info) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Напоминания о занятиях", NotificationManager.IMPORTANCE_DEFAULT));
        }
        int left = (int) Math.max(1, Math.round(plan - done));
        String title = langName(lang) + " — " + (done > 0 ? "ещё " : "") + left + " мин";
        StringBuilder body = new StringBuilder();
        if (info != null && !info.optString("book").isEmpty()) {
            body.append("Продолжить «").append(info.optString("book")).append("»");
            if (info.optInt("pct") > 0) body.append(" (").append(info.optInt("pct")).append("%)");
            body.append(".");
        }
        if (info != null && info.optInt("due") > 0) body.append(body.length() > 0 ? " " : "").append("Ждут повторения: ").append(info.optInt("due")).append(".");
        if (body.length() == 0) body.append("Время позаниматься.");

        Intent open = new Intent(ctx, MainActivity.class).putExtra("open", lang).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, lang.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_notify).setContentTitle(title).setContentText(body.toString())
                .setStyle(new Notification.BigTextStyle().bigText(body.toString()))
                .setContentIntent(pi).setAutoCancel(true);
        try { nm.notify(lang.hashCode(), b.build()); } catch (SecurityException ignored) { }
    }
}
