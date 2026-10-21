// Проверка шифрования Web Push (RFC 8291), подписи VAPID и логики расписания функции remind.
// Запуск: node --experimental-strip-types tests/push_test.mjs   (нужен http_ece в ../vendor)
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { encryptPayload, vapidHeader, dueReminders, localParts, weekly } from '../supabase/functions/remind/index.ts';
const require = createRequire(new URL('../../vendor/node_modules/', import.meta.url));
const ece = require('http_ece');
const b64u = b => Buffer.from(b).toString('base64url');

// 1) шифрование: расшифровываем независимой библиотекой http_ece
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) };
const msg = JSON.stringify({ title: 'Польский — 20 мин', body: 'Продолжить «Droga przez mgłę» (6%).' });
const body = await encryptPayload(sub, msg);
const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth });
assert.equal(plain.toString('utf8'), msg);
console.log('PASS encrypt/decrypt aes128gcm');

// 2) VAPID: подпись проверяется публичным ключом
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = privateKey.export({ format: 'jwk' });
const pubRaw = b64u(publicKey.export({ format: 'der', type: 'spki' }).subarray(-65));
const hdr = await vapidHeader(sub.endpoint, pubRaw, jwk, 'https://asya-l.github.io/chitalka/');
const m = hdr.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
assert.ok(m, hdr);
assert.equal(m[4], pubRaw);
const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
assert.equal(claims.aud, 'https://fcm.googleapis.com');
assert.ok(crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')));
console.log('PASS vapid jwt');

// 3) расписание
const wed1905 = new Date('2026-10-21T17:05:00Z');   // среда 19:05 в Калининграде (UTC+2)
assert.deepEqual(localParts(wed1905, 'Europe/Kaliningrad'), { day: '2026-10-21', wd: 3, min: 19 * 60 + 5 });
const state = {
  settings: { tz: 'Europe/Kaliningrad', schedule: [
    { id: 'a', lang: 'pl', days: [3, 5], time: '19:00', min: 20 },
    { id: 'b', lang: 'en', days: [2, 4], time: '19:00', min: 30 },
  ] },
  books: { x: { title: 'Droga przez mgłę', lang: 'pl', last: 2, pct: 0.06 }, y: { title: 'Old', lang: 'pl', last: 1 } },
  words: { w1: { lang: 'pl', st: 'learn', srs: { due: 0 } }, w2: { lang: 'pl', st: 'learn', srs: { due: 0 } }, w3: { lang: 'pl', st: 'known', srs: { due: 0 } } },
  log: {},
};
let due = dueReminders(state, wed1905);
assert.equal(due.length, 1); assert.equal(due[0].item, 'a');
assert.equal(due[0].title, 'Польский — 20 мин');
assert.equal(due[0].body, 'Продолжить «Droga przez mgłę» (6%). Ждут повторения: 2 слова.');
assert.equal(due[0].url, './?open=pl');
assert.equal(dueReminders(state, new Date('2026-10-21T16:55:00Z')).length, 0, 'до времени — рано');
assert.equal(dueReminders(state, new Date('2026-10-21T18:00:00Z')).length, 0, 'через час — окно прошло');
assert.equal(dueReminders(state, new Date('2026-10-20T17:05:00Z'))[0].item, 'b', 'вторник — английский');
state.log['2026-10-21'] = { d1: { m_pl: 8 }, d2: { m_pl: 4 } };
assert.equal(dueReminders(state, wed1905)[0].title, 'Польский — ещё 8 мин');
state.log['2026-10-21'].d1.m_pl = 16;
assert.equal(dueReminders(state, wed1905).length, 0, 'план выполнен — не напоминаем');
console.log('PASS schedule');

// 4) итоги недели: воскресенье 18:05 по Калининграду
const sun1805 = new Date('2026-10-25T16:05:00Z');
const dn = (iso) => Date.UTC(...iso.split('-').map((x, i) => i === 1 ? x - 1 : +x)) / 86400000;
const st2 = { settings: { tz: 'Europe/Kaliningrad', schedule: [] }, known: { pl: { a: dn('2026-10-20'), b: dn('2026-10-25'), c: dn('2026-10-10') } },
  log: { '2026-10-19': { d: { min: 50, m_pl: 30, m_en: 20, saved: 4, chd: 1 } }, '2026-10-25': { d: { min: 85, m_pl: 85, saved: 8 } }, '2026-10-18': { d: { min: 999 } } } };
let wk = dueReminders(st2, sun1805);
assert.equal(wk.length, 1); assert.equal(wk[0].item, 'weekly');
assert.equal(wk[0].body, '2 ч 15 мин занятий, +2 знакомых слов, 12 в повторение, 1 глава. Польский 1 ч 55 мин, Английский 20 мин.');
assert.equal(dueReminders(st2, new Date('2026-10-25T15:05:00Z')).length, 0, 'не в 18:00');
assert.equal(dueReminders(st2, new Date('2026-10-24T16:05:00Z')).length, 0, 'не воскресенье');
st2.settings.weekly = false; assert.equal(dueReminders(st2, sun1805).length, 0, 'выключено');
assert.equal(weekly({ log: {}, known: {} }, sun1805, 'Europe/Kaliningrad'), null, 'пустая неделя — молчим');
console.log('PASS weekly');
