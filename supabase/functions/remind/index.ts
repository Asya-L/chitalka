// «Между строк»: рассылка напоминаний о занятиях по расписанию.
// Запускается задачей pg_cron раз в 5 минут. Для каждого пользователя смотрит расписание
// (state.settings.schedule) и, если наступило время занятия, а минут по этому языку
// сегодня ещё меньше плана, шлёт Web Push на все его устройства. Повторно в тот же день
// одно и то же напоминание не отправляется (таблица mezhdu_reminder_log).
//
// Секреты функции: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_JWK (JSON), VAPID_SUBJECT (необязательно).
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (или SUPABASE_SECRET_KEYS) подставляет сама платформа.
// Код написан без аннотаций типов, чтобы его можно было проверить и в Node.

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const concat = (...arrs) => { const n = arrs.reduce((a, b) => a + b.length, 0); const out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

/** RFC 8291 (aes128gcm): шифрует payload для подписки {endpoint, p256dh, auth}. */
export async function encryptPayload(sub, payload, salt, asKeys) {
  const uaPublic = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  const as = asKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const plain = concat(enc.encode(payload), new Uint8Array([2]));
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** VAPID (RFC 8292): заголовок Authorization. */
export async function vapidHeader(endpoint, publicKey, privateJwk, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + body));
  return 'vapid t=' + header + '.' + body + '.' + b64u(sig) + ', k=' + publicKey;
}

export async function sendPush(sub, payload, vapid) {
  const body = await encryptPayload(sub, payload);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'normal',
      Authorization: await vapidHeader(sub.endpoint, vapid.publicKey, vapid.privateJwk, vapid.subject),
    },
    body,
  });
  return res.status;
}

/* ---------------- расписание ---------------- */
const LANG_RU = { en: 'английский', pl: 'польский', zh: 'китайский' };
const LANG_TITLE = { en: 'Английский', pl: 'Польский', zh: 'Китайский' };

export function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
  const hour = p.hour === '24' ? 0 : +p.hour;
  return { day: p.year + '-' + p.month + '-' + p.day, wd, min: hour * 60 + +p.minute };
}
const langMinutes = (state, day, lang) => Object.values((state.log || {})[day] || {}).reduce((s, e) => s + (+(e['m_' + lang] || 0)), 0);

/** Какие напоминания пора отправить для одного пользователя. */
export function dueReminders(state, now) {
  const st = state && state.settings || {};
  const tz = st.tz || 'Europe/Kaliningrad';
  const t = localParts(now, tz);
  const out = [];
  for (const it of (st.schedule || [])) {
    if (!it || it.off || !LANG_RU[it.lang] || !(it.days || []).includes(t.wd)) continue;
    const [h, m] = String(it.time || '19:00').split(':').map(Number);
    const at = h * 60 + (m || 0);
    if (t.min < at || t.min >= at + 45) continue;
    const plan = +it.min || 20;
    const done = langMinutes(state, t.day, it.lang);
    if (done >= plan) continue;
    out.push({ item: it.id || it.lang + it.time, day: t.day, ...message(state, it, plan, done, now) });
  }
  if (st.weekly !== false && t.wd === 7 && t.min >= 18 * 60 && t.min < 18 * 60 + 45) {
    const w = weekly(state, now, tz);
    if (w) out.push({ item: 'weekly', day: t.day, ...w });
  }
  return out;
}

/** Итоги недели (понедельник — воскресенье по местному времени). */
export function weekly(state, now, tz) {
  const t = localParts(now, tz);
  const [y, m, d] = t.day.split('-').map(Number);
  const sun = Date.UTC(y, m - 1, d) / 86400000;            // номер дня (как dnum в приложении)
  const days = []; for (let i = 6; i >= 0; i--) { const x = new Date((sun - i) * 86400000); days.push(x.toISOString().slice(0, 10)); }
  let min = 0, saved = 0, chd = 0; const byLang = {};
  for (const day of days) for (const e of Object.values((state.log || {})[day] || {})) {
    min += +e.min || 0; saved += +e.saved || 0; chd += +e.chd || 0;
    for (const l of Object.keys(LANG_RU)) byLang[l] = (byLang[l] || 0) + (+e['m_' + l] || 0);
  }
  let known = 0; for (const l of Object.keys(state.known || {})) for (const v of Object.values(state.known[l])) if (v > sun - 7 && v <= sun) known++;
  if (min < 1 && !known && !saved) return null;
  const fm = (x) => { x = Math.round(x); return x >= 60 ? Math.floor(x / 60) + ' ч ' + (x % 60) + ' мин' : x + ' мин'; };
  const parts = [fm(min) + ' занятий'];
  if (known) parts.push('+' + known + ' знакомых слов');
  if (saved) parts.push(saved + ' в повторение');
  if (chd) parts.push(chd + ' ' + (chd % 10 === 1 && chd % 100 !== 11 ? 'глава' : chd % 10 >= 2 && chd % 10 <= 4 && (chd % 100 < 10 || chd % 100 >= 20) ? 'главы' : 'глав'));
  const langs = Object.keys(byLang).filter((l) => byLang[l] >= 1).sort((a, b) => byLang[b] - byLang[a]).map((l) => LANG_TITLE[l] + ' ' + fm(byLang[l]));
  return { title: 'Итоги недели', body: parts.join(', ') + '.' + (langs.length ? ' ' + langs.join(', ') + '.' : ''), url: './?tab=diary', tag: 'mezhdu-weekly' };
}
function message(state, it, plan, done, now) {
  const books = Object.values(state.books || {}).filter((b) => !b.del && b.lang === it.lang).sort((a, b) => (b.last || b.added || 0) - (a.last || a.added || 0));
  const words = Object.values(state.words || {}).filter((w) => !w.del && w.lang === it.lang && w.st === 'learn' && w.srs && w.srs.due <= now.getTime()).length;
  const left = Math.max(1, Math.round(plan - done));
  const parts = [];
  if (books[0]) parts.push('Продолжить «' + books[0].title + '»' + (books[0].pct ? ' (' + Math.floor(books[0].pct * 100) + '%)' : '') + '.');
  if (words) parts.push('Ждут повторения: ' + words + ' ' + (words % 10 === 1 && words % 100 !== 11 ? 'слово' : words % 10 >= 2 && words % 10 <= 4 && (words % 100 < 10 || words % 100 >= 20) ? 'слова' : 'слов') + '.');
  return {
    title: LANG_TITLE[it.lang] + ' — ' + (done > 0 ? 'ещё ' + left : left) + ' мин',
    body: parts.join(' ') || 'Время позаниматься ' + LANG_RU[it.lang] + 'м.',
    url: './?open=' + it.lang,
    tag: 'mezhdu-' + it.lang,
  };
}

/* ---------------- обработчик ---------------- */
async function handler(req) {
  const env = (k) => Deno.env.get(k);
  if (req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return new Response('forbidden', { status: 403 });
  const base = env('SUPABASE_URL') + '/rest/v1/';
  let key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) { try { const ks = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}'); key = ks.default || Object.values(ks)[0]; } catch (e) { } }
  const h = { apikey: key, 'Content-Type': 'application/json' };
  if (String(key).startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
  const vapid = { publicKey: env('VAPID_PUBLIC_KEY'), privateJwk: JSON.parse(env('VAPID_PRIVATE_JWK')), subject: env('VAPID_SUBJECT') || 'https://asya-l.github.io/chitalka/' };
  const subsRes = await fetch(base + 'mezhdu_push_subs?select=user_id,endpoint,p256dh,auth', { headers: h });
  const subs = await subsRes.json();
  if (!Array.isArray(subs) || !subs.length) return Response.json({ sent: 0 });
  const users = [...new Set(subs.map((s) => s.user_id))];
  const rows = await (await fetch(base + 'mezhdu_state?select=user_id,state&user_id=in.(' + users.join(',') + ')', { headers: h })).json();
  const now = new Date();
  let sent = 0; const gone = [];
  for (const row of rows) {
    for (const r of dueReminders(row.state, now)) {
      // отмечаем заранее: если строка уже была, это напоминание сегодня уже ушло
      const ins = await fetch(base + 'mezhdu_reminder_log?on_conflict=user_id,item,day', { method: 'POST', headers: { ...h, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ user_id: row.user_id, item: r.item, day: r.day }) });
      const insRows = await ins.json().catch(() => []);
      if (!Array.isArray(insRows) || !insRows.length) continue;
      const payload = JSON.stringify({ title: r.title, body: r.body, url: r.url, tag: r.tag });
      for (const s of subs.filter((x) => x.user_id === row.user_id)) {
        try {
          const st = await sendPush(s, payload, vapid);
          if (st === 404 || st === 410) gone.push(s.endpoint); else if (st < 300) sent++;
        } catch (e) { console.error('push failed', e); }
      }
    }
  }
  for (const ep of gone) await fetch(base + 'mezhdu_push_subs?endpoint=eq.' + encodeURIComponent(ep), { method: 'DELETE', headers: h });
  return Response.json({ sent, removed: gone.length });
}

if (globalThis.Deno && Deno.serve) Deno.serve(handler);
