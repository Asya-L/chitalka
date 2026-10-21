'use strict';
/* «Между строк» — изучение языков через свои книги.
   Данные: состояние (книги-метаданные, слова, журнал, настройки) в IndexedDB и в Supabase;
   тексты книг — в IndexedDB и в Supabase Storage; ключ Claude — только в localStorage устройства. */

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const now = () => Date.now();
const DAY = 86400000;

const LANGS = {
  en: { name: 'English', ru: 'Английский', tts: 'en-US', short: 'EN', levels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
  pl: { name: 'Polski', ru: 'Польский', tts: 'pl-PL', short: 'PL', levels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
  zh: { name: '中文', ru: 'Китайский', tts: 'zh-CN', short: '中文', levels: ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'] }
};
const LANG_EN = { en: 'English', pl: 'Polish', zh: 'Chinese (Mandarin)' };
const TARGETS = { ru: { name: 'Русский', en: 'Russian' }, en: { name: 'English', en: 'English' } };
const MODELS = [
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 — быстро и дёшево' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 — точнее, дороже' }
];
const KEY_LS = 'mezhdu-claude-key';

const I = {
  shelf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h4v16H4zM10 4h4v16h-4zM15.5 5.2l3.8-1 3.9 15.5-3.8 1z"/></svg>',
  words: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/><path d="M7 13h6"/></svg>',
  diary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  speak: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5c3-1 6-.8 10 1.5 4-2.3 7-2.5 10-1.5V19c-3-1-6-.8-10 1.5C8 18.2 5 18 2 19z"/><path d="M12 7v13.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  logo: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)"/><path d="M6 9.5c3.2-1 6.4-.8 10 1.3 3.6-2.1 6.8-2.3 10-1.3V23c-3.2-1-6.4-.8-10 1.3C12.4 22.2 9.2 22 6 23z" fill="var(--paper)"/><path d="M16 10.8v13.5" stroke="var(--accent)" stroke-width="1.2"/><path d="M8.5 15.2h5" stroke="var(--mark)" stroke-width="2.6" stroke-linecap="round"/><path d="M18.5 13.6h5M18.5 17h4" stroke="var(--accent)" stroke-width="1" stroke-linecap="round" opacity=".55"/></svg>'
};

/* ---------------- storage ---------------- */
const idb = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('mezhdu-strok', 1);
    r.onupgradeneeded = () => { const d = r.result; ['kv', 'books', 'tr'].forEach(s => d.objectStoreNames.contains(s) || d.createObjectStore(s)); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const r = fn(t.objectStore(store)); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return {
    get: (s, k) => tx(s, 'readonly', st => st.get(k)),
    put: (s, k, v) => tx(s, 'readwrite', st => st.put(v, k)),
    del: (s, k) => tx(s, 'readwrite', st => st.delete(k)),
    clear: s => tx(s, 'readwrite', st => st.clear())
  };
})();
const DEV = (() => { let d = null; try { d = localStorage.getItem('mezhdu-dev'); if (!d) { d = Math.random().toString(36).slice(2, 10); localStorage.setItem('mezhdu-dev', d); } } catch (e) { d = 'x' + Math.random().toString(36).slice(2, 8); } return d; })();
const getKey = () => { try { return localStorage.getItem(KEY_LS) || ''; } catch (e) { return ''; } };

function fresh() {
  return { v: 1, settings: { u: 0, target: 'ru', model: MODELS[0].id, font: 19, lh: 1.65, theme: 'auto', pinyin: true, goal: 20, newPerDay: 15, levels: { en: 'B1', pl: 'B1', zh: 'HSK1' }, schedule: [], tz: '' }, books: {}, words: {}, log: {} };
}
function normalize(x) {
  const f = fresh();
  x = x && typeof x === 'object' ? x : {};
  const lv = Object.assign({}, f.settings.levels, (x.settings && x.settings.levels) || {});
  x.settings = Object.assign(f.settings, x.settings || {}); x.settings.levels = lv;
  x.books = x.books || {}; x.words = x.words || {}; x.log = x.log || {}; x.v = 1;
  return x;
}
function merge(a, b) {
  a = normalize(clone(a)); b = normalize(clone(b));
  const out = fresh();
  out.settings = (b.settings.u || 0) > (a.settings.u || 0) ? b.settings : a.settings;
  for (const k of ['books', 'words']) {
    const o = {};
    for (const id of new Set([...Object.keys(a[k]), ...Object.keys(b[k])])) {
      const x = a[k][id], y = b[k][id];
      o[id] = !x ? y : !y ? x : ((y.u || 0) > (x.u || 0) ? y : x);
    }
    out[k] = o;
  }
  for (const L of [a.log, b.log]) for (const d in L) for (const dev in L[d]) {
    const t = (out.log[d] = out.log[d] || {}); const e = (t[dev] = t[dev] || {});
    for (const f in L[d][dev]) e[f] = Math.max(e[f] || 0, L[d][dev][f] || 0);
  }
  return out;
}
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}

let S = fresh();
let persistTimer = null, syncTimer = null;
function persist() { syncNative(); return idb.put('kv', 'state', S).catch(() => { }); }
function save(delay) {
  clearTimeout(persistTimer); persistTimer = setTimeout(persist, 250);
  if (session) { dirty = true; clearTimeout(syncTimer); syncTimer = setTimeout(sync, delay == null ? 1500 : delay); }
  setStatus();
}

const pad = n => String(n).padStart(2, '0');
const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => dayKey(new Date());
function bump(field, n) {
  const L = S.log[today()] || (S.log[today()] = {});
  const e = L[DEV] || (L[DEV] = {});
  e[field] = Math.round(((e[field] || 0) + n) * 100) / 100;
}
function langMinutes(d, lang) { let m = 0; for (const e of Object.values(S.log[d] || {})) m += e['m_' + lang] || 0; return m; }
function dayTotals(d) {
  const t = { min: 0, saved: 0, rev: 0, words: 0, nw: 0 };
  for (const e of Object.values(S.log[d] || {})) for (const k in t) t[k] += e[k] || 0;
  return t;
}

/* ---------------- text helpers ---------------- */
const segCache = {};
function segmenter(lang, gran) {
  const k = lang + gran;
  if (!(k in segCache)) segCache[k] = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(lang === 'zh' ? 'zh' : lang, { granularity: gran }) : null;
  return segCache[k];
}
function tokenize(text, lang) {
  const sg = segmenter(lang, 'word');
  if (sg) return Array.from(sg.segment(text), s => ({ t: s.segment, w: !!s.isWordLike, o: s.index }));
  const out = []; const re = lang === 'zh' ? /[㐀-鿿]|[\p{L}\p{N}]+(?:['’-][\p{L}]+)*/gu : /[\p{L}\p{N}]+(?:['’-][\p{L}]+)*/gu;
  let last = 0, m;
  while ((m = re.exec(text))) { if (m.index > last) out.push({ t: text.slice(last, m.index), w: false, o: last }); out.push({ t: m[0], w: true, o: m.index }); last = m.index + m[0].length; }
  if (last < text.length) out.push({ t: text.slice(last), w: false, o: last });
  return out;
}
function sentenceAt(text, off, lang) {
  const sg = segmenter(lang, 'sentence');
  let s = text;
  if (sg) { for (const x of sg.segment(text)) if (off >= x.index && off < x.index + x.segment.length) { s = x.segment; break; } }
  else { const parts = text.split(/(?<=[.!?。！？…])\s*/); let i = 0; for (const p of parts) { if (off < i + p.length + 1) { s = p; break; } i += p.length + 1; } }
  s = s.trim();
  if (s.length > 420) { const st = Math.max(0, off - (text.length - s.length) - 200); s = '…' + s.slice(st, st + 400) + '…'; }
  return s;
}
const keyOf = (t, lang) => lang === 'zh' ? String(t).trim() : String(t).trim().toLowerCase().replace(/[’`]/g, "'");
const hasHan = s => /[㐀-鿿]/.test(s);
const isHan = s => /^[㐀-鿿]+$/.test(s);
function pinyinOf(s) { try { return window.pinyinPro ? window.pinyinPro.pinyin(s) : ''; } catch (e) { return ''; } }
function wordCount(p, lang) { return lang === 'zh' ? (p.match(/[㐀-鿿]/g) || []).length : p.split(/\s+/).filter(w => /\p{L}/u.test(w)).length; }
function highlight(sentence, form, lang) {
  const s = esc(sentence); if (!form) return s;
  const f = esc(form);
  const re = lang === 'zh' ? new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : new RegExp('(^|[^\\p{L}])(' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![\\p{L}])', 'iu');
  return lang === 'zh' ? s.replace(re, m => '<b>' + m + '</b>') : s.replace(re, (m, a, b) => a + '<b>' + b + '</b>');
}
const NATIVE = window.Android && typeof window.Android.setPaging === 'function' ? window.Android : null;
function speak(text, lang) {
  if (!text) return;
  if (NATIVE && NATIVE.canSpeak && NATIVE.canSpeak()) { try { NATIVE.speak(text, LANGS[lang].tts); } catch (e) { } return; }
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = LANGS[lang].tts; u.rate = lang === 'zh' ? 0.8 : 0.92;
    const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.toLowerCase().startsWith(LANGS[lang].tts.slice(0, 2).toLowerCase()));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) { }
}
const canSpeak = 'speechSynthesis' in window || !!NATIVE;

/* E-ink: настройка этого устройства, не синхронизируется. В приложении для Boox включена по умолчанию. */
const EINK_LS = 'mezhdu-eink';
let EINK = (() => { try { const v = localStorage.getItem(EINK_LS); if (v != null) return v === '1'; } catch (e) { } return /[?&]eink=1/.test(location.search) || !!NATIVE; })();
function setEink(on) { EINK = on; try { localStorage.setItem(EINK_LS, on ? '1' : '0'); } catch (e) { } applyTheme(); if (R) { trackPosition(); renderReader(R.p); } render(); }

/* ---------------- Claude ---------------- */
class AIError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
async function askClaude(prompt, maxTokens, modelOverride, keyOverride) {
  const key = keyOverride || getKey();
  if (!key) throw new AIError('nokey', 'Нет ключа Claude API.');
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: modelOverride || S.settings.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
    });
  } catch (e) { throw new AIError('net', 'Нет связи с Claude. Проверь интернет и попробуй ещё раз.'); }
  if (!res.ok) {
    let m = ''; try { const j = await res.json(); m = (j.error && j.error.message) || ''; } catch (e) { }
    if (res.status === 401 || res.status === 403) throw new AIError('auth', 'Ключ Claude API не подходит. Проверь его в настройках.');
    if (res.status === 429) throw new AIError('rate', 'Слишком много запросов подряд. Подожди минуту и попробуй снова.');
    if (res.status === 529 || res.status >= 500) throw new AIError('busy', 'Claude сейчас перегружен. Попробуй через несколько секунд.');
    if (/model/i.test(m)) throw new AIError('model', 'Эта модель недоступна для твоего ключа. Выбери другую в настройках.');
    if (/credit|billing|balance/i.test(m)) throw new AIError('billing', 'На аккаунте Claude API закончились средства. Пополни баланс в консоли Anthropic.');
    throw new AIError('other', 'Claude ответил ошибкой: ' + (m || res.status));
  }
  const j = await res.json();
  return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
}
function lookupPrompt(o) {
  const L = LANG_EN[o.lang], T = TARGETS[S.settings.target].en, lvl = S.settings.levels[o.lang];
  const phrase = o.term.trim().split(/\s+/).length > 1 || (o.lang === 'zh' && o.term.length > 4);
  return `You help a language learner who is reading a book in ${L}. Their level: ${lvl}. Explain everything in ${T}.

Sentence from the book:
«${o.ctx}»

The learner tapped this ${phrase ? 'phrase' : 'word'}: «${o.term}»

Reply with JSON only, no other text:
{"lemma": "dictionary form in ${L}${o.lang === 'zh' ? ' (the whole word in Chinese characters; if the tapped characters are part of a longer word in this sentence, give that longer word)' : ''}",
 "pos": "part of speech in ${T}, 1–2 words",
 "tr": "translation of the ${phrase ? 'phrase' : 'word'} exactly as it is used in this sentence, 1–5 words, in ${T}",
 "alt": "up to 3 other common meanings in ${T}, comma-separated, or empty string",
 "note": "one short sentence in ${T} explaining the form or usage here (${o.lang === 'pl' ? 'case, gender, aspect, tense' : o.lang === 'en' ? 'tense, phrasal verb, idiom, register' : 'measure word, particle, set phrase'}), only if useful for a ${lvl} learner, otherwise empty string",
 "pinyin": "${o.lang === 'zh' ? 'pinyin with tone marks for the lemma' : ''}",
 "hsk": "${o.lang === 'zh' ? 'HSK level 1–6 of the lemma if it is in the HSK lists, otherwise empty string' : ''}"}`;
}
/* ---------------- перевод без Claude ---------------- */
// Цепочка: Google Translate (без ключа) → MyMemory; начальная форма и падеж — из английского Викисловаря.
const GT_LANG = { en: 'en', pl: 'pl', zh: 'zh-CN' };
async function fetchJSON(url, ms) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms || 7000);
  try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
const looksTarget = s => S.settings.target === 'ru' ? /[а-яё]/i.test(s) : /[a-z]/i.test(s) && !/[а-яё\u3400-\u9fff]/i.test(s);
async function googleTr(text, lang) {
  const j = await fetchJSON('https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + GT_LANG[lang] + '&tl=' + S.settings.target + '&dt=t&dt=bd&dt=rm&q=' + encodeURIComponent(text));
  const parts = j[0] || [];
  const tr = parts.filter(x => x && typeof x[0] === 'string').map(x => x[0]).join('').trim();
  const rm = parts.find(x => x && x[0] == null && x[3]);
  const alt = [], pos = [];
  for (const b of (j[1] || [])) { if (b[0]) pos.push(b[0]); for (const w of (b[1] || [])) if (w && w.toLowerCase() !== tr.toLowerCase() && !alt.includes(w)) alt.push(w); }
  if (!tr) throw new Error('empty');
  return { tr, alt: alt.slice(0, 4).join(', '), pos: pos[0] || '', py: rm ? rm[3] : '' };
}
async function myMemoryTr(text, lang) {
  const j = await fetchJSON('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + GT_LANG[lang] + '|' + S.settings.target);
  const tr = j && j.responseData && String(j.responseData.translatedText || '').trim();
  if (!tr || j.quotaFinished || !looksTarget(tr) || /MYMEMORY WARNING/i.test(tr)) throw new Error('mymemory');
  return { tr, alt: '', pos: '', py: '' };
}
async function basicTr(text, lang) {
  try { return Object.assign(await googleTr(text, lang), { via: 'Google Переводчик' }); }
  catch (e) { return Object.assign(await myMemoryTr(text, lang), { via: 'MyMemory' }); }
}
const GRAM_RU = { nominative: 'именительный', genitive: 'родительный', dative: 'дательный', accusative: 'винительный', instrumental: 'творительный', locative: 'предложный', vocative: 'звательный', singular: 'ед. ч.', plural: 'мн. ч.', masculine: 'муж. р.', feminine: 'жен. р.', neuter: 'ср. р.', virile: 'муж.-личн.', nonvirile: 'не муж.-личн.', 'first-person': '1-е лицо', 'second-person': '2-е лицо', 'third-person': '3-е лицо', present: 'настоящее', past: 'прошедшее', future: 'будущее', tense: 'время', imperative: 'повелительное', conditional: 'условное', infinitive: 'инфинитив', participle: 'причастие', gerund: 'деепричастие', perfective: 'сов. вид', imperfective: 'несов. вид', comparative: 'сравнительная степень', superlative: 'превосходная степень', plural_of: 'мн. ч.', inflection: 'форма', 'simple past': 'простое прошедшее', 'past participle': 'причастие прошедшего времени', 'present participle': 'причастие настоящего времени', and: 'и', of: '', 'form': 'форма', case: 'падеж' };
const POS_RU = { noun: 'сущ.', verb: 'гл.', adjective: 'прил.', adverb: 'нареч.', pronoun: 'мест.', preposition: 'предл.', conjunction: 'союз', particle: 'частица', numeral: 'числ.', classifier: 'счётное слово', interjection: 'межд.', determiner: 'определитель', 'proper noun': 'имя собств.', phrase: 'фраза', 'существительное': 'сущ.', 'глагол': 'гл.', 'прилагательное': 'прил.', 'наречие': 'нареч.', 'местоимение': 'мест.', 'предлог': 'предл.' };
const posRu = p => S.settings.target === 'ru' ? (POS_RU[String(p).toLowerCase()] || p) : p;
async function wiktForm(term, lang) {
  const key = { en: 'en', pl: 'pl', zh: 'zh' }[lang];
  const w = lang === 'zh' ? term : term.toLowerCase();
  const j = await fetchJSON('https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(w), 5000);
  const entries = j[key] || [];
  for (const e of entries) for (const d of (e.definitions || [])) {
    const html = d.definition || '';
    if (/form-of-definition/.test(html)) {
      const div = document.createElement('div'); div.innerHTML = html;
      const text = div.textContent.replace(/\s+/g, ' ').trim();
      const m = text.match(/^(.*?)\s+of\s+([^\s:;,(]+)/i);
      if (m) {
        let g = m[1].toLowerCase().replace(/\(.*?\)/g, '');
        if (S.settings.target === 'ru') { g = g.split(/[\s/]+/).map(x => GRAM_RU[x] != null ? GRAM_RU[x] : x).filter(Boolean).join(' '); if (/творит|родит|дател|винит|именит|предлож|звател/.test(g) && !/падеж/.test(g)) g = g.replace(/(именительный|родительный|дательный|винительный|творительный|предложный|звательный)/, '$1 падеж'); }
        return { lemma: m[2], gram: g.trim(), pos: e.partOfSpeech || '' };
      }
    }
  }
  return entries[0] ? { lemma: '', gram: '', pos: entries[0].partOfSpeech || '' } : null;
}
async function basicLookup(o) {
  const ck = ['B', o.lang, S.settings.target, o.term].join('|');
  const hit = await idb.get('tr', ck).catch(() => null); if (hit) return hit;
  const single = !/\s/.test(o.term.trim()) && (o.lang !== 'zh' || o.term.length <= 4);
  const [t, wf] = await Promise.all([basicTr(o.term, o.lang), single ? wiktForm(o.term, o.lang).catch(() => null) : Promise.resolve(null)]);
  const r = { lemma: (wf && wf.lemma) || o.term, pos: posRu((wf && wf.pos) || t.pos || ''), tr: t.tr, alt: t.alt, note: '', py: '', hsk: '', src: 'basic', via: t.via };
  if (wf && wf.lemma && wf.lemma.toLowerCase() !== o.term.toLowerCase()) {
    r.note = (S.settings.target === 'ru' ? 'Форма слова «' + wf.lemma + '»' : 'Form of “' + wf.lemma + '”') + (wf.gram ? ': ' + wf.gram : ''); if (!/\.$/.test(r.note)) r.note += '.';
    try { const lt = await basicTr(wf.lemma, o.lang); if (lt.tr && lt.tr.toLowerCase() !== r.tr.toLowerCase()) r.alt = [lt.tr + (S.settings.target === 'ru' ? ' (нач. форма)' : ' (base form)'), r.alt].filter(Boolean).join(', '); } catch (e) { }
  }
  if (o.lang === 'zh') r.py = pinyinOf(r.lemma) || t.py;
  idb.put('tr', ck, r).catch(() => { });
  return r;
}

async function lookup(o, force) {
  if (!getKey()) { o.aiErr = ''; return basicLookup(o); }
  try { const r = await aiLookup(o, force); o.aiErr = ''; return r; }
  catch (e) { o.aiErr = e.message; return basicLookup(o); }
}
async function aiLookup(o, force) {
  const ck = [o.lang, S.settings.target, S.settings.levels[o.lang], o.term, o.ctx].join('|');
  if (!force) { const hit = await idb.get('tr', ck).catch(() => null); if (hit) return hit; }
  const txt = await askClaude(lookupPrompt(o), 400);
  const m = txt.match(/\{[\s\S]*\}/);
  let d;
  try { d = JSON.parse(m ? m[0] : txt); } catch (e) { throw new AIError('parse', 'Claude ответил непонятно. Нажми «Ещё раз».'); }
  const r = { lemma: String(d.lemma || o.term).trim(), pos: String(d.pos || ''), tr: String(d.tr || '').trim(), alt: String(d.alt || ''), note: String(d.note || ''), py: String(d.pinyin || ''), hsk: String(d.hsk || '').replace(/\D/g, '') };
  if (o.lang === 'zh' && !r.py) r.py = pinyinOf(r.lemma);
  idb.put('tr', ck, r).catch(() => { });
  return r;
}
async function translateSentence(text, lang) {
  const ck = ['S', lang, S.settings.target, text].join('|');
  const hit = await idb.get('tr', ck).catch(() => null); if (hit) return hit;
  let r;
  if (getKey()) { try { r = await askClaude(`Translate this sentence from a ${LANG_EN[lang]} book into natural ${TARGETS[S.settings.target].en}. Reply with the translation only.\n\n${text}`, 500); } catch (e) { r = null; } }
  if (!r) { try { r = (await basicTr(text, lang)).tr; } catch (e) { throw new Error(navigator.onLine === false ? 'Нет интернета — перевод предложения недоступен.' : 'Не получилось перевести предложение: сервисы перевода не отвечают.'); } return r; }
  idb.put('tr', ck, r).catch(() => { });
  return r;
}

/* ---------------- words & SRS ---------------- */
function liveWords(lang) { return Object.values(S.words).filter(w => !w.del && (!lang || w.lang === lang)); }
function savedKeys(lang) {
  const s = new Set();
  for (const w of liveWords(lang)) if (w.st === 'learn') { (w.forms || []).forEach(f => s.add(f)); s.add(keyOf(w.lemma, lang)); }
  return s;
}
function findWord(lang, term, lemma) {
  const k = keyOf(term, lang), lk = lemma ? keyOf(lemma, lang) : null;
  return Object.values(S.words).find(w => w.lang === lang && ((w.forms || []).includes(k) || keyOf(w.lemma, lang) === k || (lk && keyOf(w.lemma, lang) === lk)));
}
function saveWord(o, st) {
  const d = o.data || {};
  const lemma = d.lemma || o.term;
  const id = o.lang + ':' + keyOf(lemma, o.lang);
  let w = S.words[id] || findWord(o.lang, o.term, lemma);
  const book = S.books[o.book];
  const ctx = o.ctx ? { s: o.ctx, f: o.term, tr: o.sentTr || '', b: book ? book.title : '' } : null;
  const isNew = !w || w.del;
  if (!w) w = S.words[id] = { id, lang: o.lang, lemma, forms: [], ctxs: [], created: now(), srs: { due: now(), ivl: 0, ease: 2.5, reps: 0, lapses: 0 } };
  if (w.del) { w.del = false; w.created = now(); w.srs = { due: now(), ivl: 0, ease: 2.5, reps: 0, lapses: 0 }; w.ctxs = []; }
  const k = keyOf(o.term, o.lang);
  if (!w.forms.includes(k)) w.forms.push(k);
  if (d.tr && !(d.src === 'basic' && w.tr && w.src !== 'basic')) { w.tr = d.tr; w.alt = d.alt; w.pos = d.pos; w.note = d.note; w.py = d.py; w.hsk = d.hsk; w.src = d.src || 'claude'; }
  if (ctx && !w.ctxs.some(c => c.s === ctx.s)) { w.ctxs.unshift(ctx); w.ctxs = w.ctxs.slice(0, 5); }
  w.st = st || 'learn'; w.u = now();
  if (isNew && w.st === 'learn') bump('saved', 1);
  save();
  return w;
}
function sm2(srs, g) {
  const s = Object.assign({ ivl: 0, ease: 2.5, reps: 0, lapses: 0 }, srs);
  if (g === 0) { s.lapses++; s.reps = 0; s.ivl = 0; s.ease = Math.max(1.3, s.ease - 0.2); s.due = now() + 10 * 60000; return s; }
  if (g === 1) { s.ivl = s.reps === 0 ? 1 : Math.max(1, Math.round(s.ivl * 1.2)); s.ease = Math.max(1.3, s.ease - 0.15); }
  if (g === 2) s.ivl = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.round(Math.max(s.ivl, 1) * s.ease);
  if (g === 3) { s.ivl = s.reps === 0 ? 4 : Math.round(Math.max(s.ivl, 1) * s.ease * 1.3); s.ease += 0.15; }
  s.reps++; s.due = now() + s.ivl * DAY - 4 * 3600000;
  return s;
}
function ivlLabel(srs) {
  const ms = srs.due - now();
  if (ms < 3600000) return 'через 10 мин';
  const d = Math.round(ms / DAY + 4 / 24);
  if (d <= 1) return 'завтра';
  if (d < 14) return d + ' дн';
  if (d < 60) return Math.round(d / 7) + ' нед';
  return Math.round(d / 30) + ' мес';
}
function reviewQueue(lang) {
  const t = now();
  const ws = liveWords(lang).filter(w => w.st === 'learn');
  const due = ws.filter(w => w.srs.reps > 0 || w.srs.lapses > 0).filter(w => w.srs.due <= t).sort((a, b) => a.srs.due - b.srs.due);
  const left = Math.max(0, S.settings.newPerDay - dayTotals(today()).nw);
  const fresh_ = ws.filter(w => w.srs.reps === 0 && w.srs.lapses === 0).sort((a, b) => a.created - b.created).slice(0, left);
  return due.map(w => w.id).concat(fresh_.map(w => w.id));
}

/* ---------------- UI state ---------------- */
const ui = { tab: 'shelf', filter: 'all', wl: 'all', ws: 'learn', q: '' };
let R = null;      // открытая книга
let RV = null;     // сессия повторения
let CUR = null;    // открытое слово
let sheetOpen = false;
const layers = [];
function openLayer(name) { layers.push(name); try { history.pushState({ l: layers.length }, ''); } catch (e) { } }
function closeLayer(name) { if (layers[layers.length - 1] === name) history.back(); else doClose(name); }
window.addEventListener('popstate', () => { const top = layers.pop(); if (top) doClose(top); });
function doClose(name) {
  if (name === 'sheet') hideSheet();
  if (name === 'reader') exitReader();
  if (name === 'review') exitReview();
}

let toastT;
function toast(msg) {
  let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2800);
}

/* ---------------- theme ---------------- */
const darkMQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const t = S.settings.theme;
  const act = EINK ? 'eink' : t === 'auto' ? (darkMQ && darkMQ.matches ? 'night' : 'paper') : t;
  if (act === 'paper') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = act;
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = act === 'eink' ? '#FFFFFF' : act === 'night' ? '#1C1814' : act === 'sepia' ? '#EADBC2' : '#F1EADF';
}
if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener('change', applyTheme);

/* ---------------- render: shell ---------------- */
const TABS = [['shelf', 'Полка'], ['words', 'Слова'], ['diary', 'Дневник'], ['settings', 'Настройки']];
function render() {
  const app = $('#app');
  const due = reviewQueue().length;
  app.innerHTML = `<header class="top"><div class="top-in">
    <div class="brand">${I.logo}<span>Между строк</span></div>
    <span id="status" class="status"></span>
    <nav class="tabs" aria-label="Разделы">${TABS.map(([id, n]) => `<button class="tab" data-a="tab" data-id="${id}"${ui.tab === id ? ' aria-current="page"' : ''}>${I[id === 'settings' ? 'set' : id]}<span>${n}${id === 'words' && due ? ` <span class="sr">, к повторению</span>(${due})` : ''}</span></button>`).join('')}</nav>
  </div></header><main id="main">${ui.tab === 'shelf' ? renderShelf() : ui.tab === 'words' ? renderWords() : ui.tab === 'diary' ? renderDiary() : renderSettings()}</main>`;
  setStatus();
}

/* ---------------- shelf ---------------- */
function liveBooks() { return Object.values(S.books).filter(b => !b.del).sort((a, b) => (b.last || b.added) - (a.last || a.added)); }
function cover(b) {
  const pct = b.pct || 0;
  return `<div class="cover" style="--c:var(--${b.lang})" aria-hidden="true"><span class="frame"></span><span class="ct" lang="${b.lang}">${esc(b.title)}</span><span class="orn">✦</span><span class="ca">${esc(b.author || '')}</span><span class="lg">${LANGS[b.lang].short}</span>${pct > 0 ? `<span class="ribbon" style="--h:${Math.round(8 + pct * 80)}%"></span>` : ''}</div>`;
}
const pctLabel = b => Math.floor((b.pct || 0) * 100) + '%';
function renderShelf() {
  const books = liveBooks();
  const fileInput = `<input type="file" id="file" class="sr" accept=".epub,.fb2,.txt,.zip,application/epub+zip,text/plain" multiple>`;
  if (!books.length) return `${fileInput}<div class="empty">
      <div class="ill" aria-hidden="true">${I.book}</div>
      <h1>Учить язык, читая свои книги</h1>
      <p>Добавь книгу на английском, польском или китайском. Нажимаешь на незнакомое слово — видишь перевод именно в этом предложении и сохраняешь его. Потом слова повторяются карточками с тем же предложением из книги.</p>
      <p class="hint">Подходят файлы EPUB, FB2 и TXT.</p>
      <div class="row" style="justify-content:center;margin-top:18px"><button class="btn primary" data-a="add">${I.plus}Добавить книгу</button></div>
      ${!getKey() ? `<p class="hint" style="margin-top:22px">Перевод работает сразу. С ключом Claude API он будет точнее — с учётом предложения и с пояснениями. Ключ вписывается в <a href="#" data-a="tab" data-id="settings">настройках</a>.</p>` : ''}
    </div>`;
  const cur = books.find(b => b.last) || books[0];
  const langs = [...new Set(books.map(b => b.lang))];
  const list = books.filter(b => ui.filter === 'all' || b.lang === ui.filter);
  const ch = cur.chs && cur.chs[(cur.pos && cur.pos.c) || 0];
  const t = dayTotals(today());
  return `${fileInput}
  <section class="continue" aria-label="Продолжить чтение">
    <button class="book cover-w" data-a="open" data-id="${cur.id}" aria-label="Открыть «${esc(cur.title)}»">${cover(cur)}</button>
    <div class="meta">
      <div class="eyebrow">${cur.last ? 'Читаю сейчас' : 'Новая книга'}</div>
      <h1 lang="${cur.lang}">${esc(cur.title)}</h1>
      <div class="ch">${cur.last ? esc(ch && ch.t ? ch.t : '') : 'Ещё не открыта'}${cur.last ? ` <span aria-hidden="true">·</span> прочитано ${pctLabel(cur)}` : ''}</div>
      <div class="bar" aria-hidden="true"><i style="width:${Math.round((cur.pct || 0) * 100)}%"></i></div>
      <div class="row"><button class="btn primary" data-a="open" data-id="${cur.id}">${cur.last ? 'Читать дальше' : 'Начать читать'}</button>
      <span class="hint">Сегодня ${Math.round(t.min)} из ${S.settings.goal} мин</span></div>
    </div>
  </section>
  ${renderPlanToday()}
  <section class="sec">
    <div class="sec-h"><h2>Полка</h2>${langs.length > 1 ? `<div class="chips" role="group" aria-label="Язык">${['all', ...langs].map(l => `<button class="chip" data-a="filter" data-id="${l}" aria-pressed="${ui.filter === l}">${l === 'all' ? 'Все' : `<span class="lang-dot" style="--c:var(--${l})"></span>${LANGS[l].name}`}</button>`).join('')}</div>` : ''}</div>
    <div class="shelf">
      ${list.map(b => `<button class="book" data-a="open" data-id="${b.id}">${cover(b)}<div class="t" lang="${b.lang}">${esc(b.title)}</div><div class="a">${b.last ? pctLabel(b) : 'новая'}${b.author ? ' · ' + esc(b.author) : ''}</div></button>`).join('')}
      <div><button class="addbook" data-a="add">${I.plus}<span>Добавить книгу<br><span class="hint">EPUB, FB2, TXT</span></span></button></div>
    </div>
  </section>`;
}
async function importFiles(files) {
  for (const file of files) {
    toast('Читаю «' + file.name + '»…');
    let book;
    try { book = await BookParse.parseBook(file); }
    catch (e) { console.warn(e); toast(e && e.message && /[а-я]/i.test(e.message) ? e.message : 'Не получилось открыть «' + file.name + '». Проверь, что это EPUB, FB2 или TXT.'); continue; }
    await new Promise(res => importDialog(book, res));
  }
}
function importDialog(book, done) {
  const d = { title: book.title, author: book.author, lang: book.lang };
  const paint = () => showSheet(`<h2 style="margin-bottom:14px">Новая книга</h2>
    <form data-form="import">
      <label class="f">Название<input class="in" name="title" value="${esc(d.title)}" required></label>
      <label class="f">Автор<input class="in" name="author" value="${esc(d.author)}"></label>
      <div class="f">Язык книги<div class="seg" role="group" aria-label="Язык книги" style="margin-top:5px;display:flex">${Object.keys(LANGS).map(l => `<button type="button" data-a="imp-lang" data-id="${l}" aria-pressed="${d.lang === l}">${LANGS[l].ru}</button>`).join('')}</div></div>
      <p class="hint">${book.chapters.length} ${plural(book.chapters.length, 'глава', 'главы', 'глав')}, около ${fmtNum(BookParse.countWords(book.chapters, d.lang))} ${d.lang === 'zh' ? 'иероглифов' : 'слов'}.</p>
      <div class="row" style="margin-top:8px"><button class="btn primary" type="submit">Поставить на полку</button><button class="btn ghost" type="button" data-a="sheet-close">Отмена</button></div>
    </form>`, { center: true, onClose: () => { if (!d.done) done(); } });
  importDialog.cur = { d, book, done, paint };
  paint();
}
async function finishImport() {
  const { d, book, done } = importDialog.cur;
  const f = document.querySelector('form[data-form="import"]');
  d.title = f.title.value.trim() || book.title; d.author = f.author.value.trim();
  const id = 'b' + now().toString(36) + Math.random().toString(36).slice(2, 6);
  const content = { chapters: book.chapters };
  try { await idb.put('books', id, content); } catch (e) { toast('Не хватило места в браузере, чтобы сохранить книгу.'); return; }
  S.books[id] = { id, title: d.title, author: d.author, lang: d.lang, chs: book.chapters.map(c => ({ t: c.t, n: c.p.length })), words: BookParse.countWords(book.chapters, d.lang), added: now(), last: 0, pos: { c: 0, p: 0 }, pct: 0, maxG: -1, read: 0, mins: 0, cloud: false, u: now() };
  save(300);
  d.done = true; closeLayer('sheet'); render(); toast('«' + d.title + '» на полке');
  done();
}
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
const fmtNum = n => Math.round(n).toLocaleString('ru-RU');

/* ---------------- sheet ---------------- */
let sheetOnClose = null;
function showSheet(html, opt) {
  opt = opt || {};
  const root = $('#sheet-root');
  const wasOpen = sheetOpen;
  root.innerHTML = `<div class="scrim" data-a="sheet-close"></div><div class="sheet${opt.center ? ' center' : ''}" role="dialog" aria-modal="true" aria-label="${esc(opt.label || 'Окно')}">${opt.center ? '' : '<div class="grab" aria-hidden="true"></div>'}${html}</div>`;
  if (!wasOpen) { sheetOpen = true; sheetOnClose = opt.onClose || null; openLayer('sheet'); setTimeout(() => { const f = root.querySelector('.sheet input,.sheet button:not([data-a="sheet-close"])'); if (f && opt.center) f.focus(); }, 30); }
  else if (opt.onClose) sheetOnClose = opt.onClose;
}
function updateSheet(html) { const s = $('#sheet-root .sheet'); if (!s) return; const keep = s.querySelector('.grab') ? '<div class="grab" aria-hidden="true"></div>' : ''; s.innerHTML = keep + html; }
function hideSheet() {
  if (!sheetOpen) return;
  sheetOpen = false; $('#sheet-root').innerHTML = '';
  document.querySelectorAll('#rt w.on').forEach(e => e.classList.remove('on'));
  const cb = sheetOnClose; sheetOnClose = null; CUR = null;
  if (cb) cb();
}

/* ---------------- reader ---------------- */
async function openBook(id) {
  const b = S.books[id]; if (!b) return;
  let c = await idb.get('books', id).catch(() => null);
  if (!c) {
    if (b.cloud && session) { toast('Загружаю книгу из облака…'); c = await downloadBook(id); }
    if (!c) { toast(session || !SYNC_READY ? 'Текст этой книги ещё не загружен в облако с другого устройства. Открой её там, когда будет связь.' : 'Войди в аккаунт в настройках, чтобы скачать эту книгу.'); return; }
  }
  const pos = b.pos || { c: 0, p: 0 };
  R = { id, c, ch: Math.min(pos.c || 0, c.chapters.length - 1), p: pos.p || 0, lang: b.lang };
  b.last = now(); b.u = now(); save(5000);
  openLayer('reader'); renderReader(R.p); startActivity();
  if (NATIVE) try { NATIVE.setPaging(true); } catch (e) { }
}
function curBook() { return R && S.books[R.id]; }
function renderPara(text, i, lang, saved, py) {
  let h = '';
  for (const tk of tokenize(text, lang)) {
    if (!tk.w) { h += esc(tk.t); continue; }
    const k = keyOf(tk.t, lang);
    const cls = saved.has(k) ? ' class="s"' : '';
    if (py && isHan(tk.t)) {
      let arr = []; try { arr = pinyinPro.pinyin(tk.t, { type: 'array' }); } catch (e) { }
      h += `<w data-k="${esc(k)}" data-o="${tk.o}" data-t="${esc(tk.t)}"${cls}><ruby>${Array.from(tk.t).map((c, j) => esc(c) + '<rt>' + esc(arr[j] || '') + '</rt>').join('')}</ruby></w>`;
    } else h += `<w data-k="${esc(k)}" data-o="${tk.o}"${cls}>${esc(tk.t)}</w>`;
  }
  return `<p data-i="${i}">${h}</p>`;
}
function renderReader(scrollToP) {
  const b = curBook(); const ch = R.c.chapters[R.ch]; const L = R.lang;
  const py = L === 'zh' && S.settings.pinyin && !!window.pinyinPro;
  const saved = savedKeys(L);
  const n = R.c.chapters.length;
  $('#reader-root').innerHTML = `<div class="reader${EINK ? ' paged' : ''}" role="dialog" aria-label="${esc(b.title)}">
    <div class="r-top"><button class="iconbtn" data-a="r-close" aria-label="На полку">${I.back}</button>
      <div class="tt">${esc(b.title)}</div>
      <button class="iconbtn" data-a="r-menu" aria-label="Оглавление и вид текста">${I.menu}</button></div>
    <div class="r-scroll" id="rs"><div class="r-col">
      ${ch.t ? `<h2 lang="${L}">${esc(ch.t)}</h2><div class="orn" aria-hidden="true">✦ ✦ ✦</div>` : ''}
      <div class="text${L === 'zh' ? ' zh' : ''}${py ? ' py' : ''}" id="rt" lang="${L === 'zh' ? 'zh-CN' : L}" style="--fs:${S.settings.font}px;--lh:${S.settings.lh}">${ch.p.map((p, i) => renderPara(p, i, L, saved, py)).join('')}</div>
      <nav class="r-nav" aria-label="Главы">
        ${R.ch > 0 ? `<button class="btn" data-a="r-ch" data-id="${R.ch - 1}">Предыдущая глава</button>` : '<span></span>'}
        ${R.ch < n - 1 ? `<button class="btn primary" data-a="r-ch" data-id="${R.ch + 1}">Следующая глава</button>` : `<span class="hint">Конец книги</span>`}
      </nav>
    </div></div>
    <div class="r-foot" id="rf"></div>
  </div>`;
  const rs = $('#rs');
  if (scrollToP) { const el = rs.querySelector(`p[data-i="${scrollToP}"]`); if (el) rs.scrollTop = el.offsetTop - 12; }
  rs.addEventListener('scroll', onReaderScroll, { passive: true });
  if (EINK) bindPaging(rs);
  updateFoot();
}
function updateFoot() {
  const b = curBook(); const el = $('#rf'); if (!el || !b) return;
  const pg = EINK ? ['<button class="btn pg" data-a="pg" data-id="-1" aria-label="Предыдущая страница">‹</button>', '<button class="btn pg" data-a="pg" data-id="1" aria-label="Следующая страница">›</button>'] : ['', ''];
  el.innerHTML = pg[0] + `<span>${R.c.chapters.length > 1 ? `Глава ${R.ch + 1} из ${R.c.chapters.length}` : esc(b.title)}</span><div class="bar" aria-hidden="true"><i style="width:${Math.round((b.pct || 0) * 100)}%"></i></div><span>${pctLabel(b)}</span>` + pg[1];
}
let scrollT;
function onReaderScroll() { act.last = now(); clearTimeout(scrollT); scrollT = setTimeout(trackPosition, 250); }
function trackPosition() {
  if (!R) return;
  const rs = $('#rs'); if (!rs) return;
  const top = rs.getBoundingClientRect().top + 8;
  let p = 0;
  for (const el of rs.querySelectorAll('#rt p')) { if (el.getBoundingClientRect().bottom > top) { p = +el.dataset.i; break; } p = +el.dataset.i; }
  const atEnd = rs.scrollTop + rs.clientHeight >= rs.scrollHeight - 4;
  setPos(R.ch, p, atEnd);
}
function setPos(c, p, atEnd) {
  const b = curBook(); if (!b) return;
  R.p = p;
  const before = b.chs.slice(0, c).reduce((s, x) => s + x.n, 0);
  const total = b.chs.reduce((s, x) => s + x.n, 0) || 1;
  // если дочитали главу до конца — считаем прочитанной всю главу
  const g = atEnd ? before + b.chs[c].n - 1 : before + p;
  const pct = Math.min(1, (g + 1) / total);
  if ((b.maxG == null ? -1 : b.maxG) < g) {
    let n = 0, gi = 0;
    R.c.chapters.forEach((ch, ci) => ch.p.forEach(par => { if (gi > (b.maxG == null ? -1 : b.maxG) && gi <= g) n += wordCount(par, b.lang); gi++; }));
    b.maxG = g; b.read = (b.read || 0) + n; bump('words', n);
  }
  b.pos = { c, p }; b.pct = Math.max(pct, b.pct && b.pos && b.pos.c === c ? 0 : 0) || pct; b.u = now();
  save(8000); updateFoot();
}
function exitReader() {
  if (!R) return;
  trackPosition(); stopActivity();
  if (NATIVE) try { NATIVE.setPaging(false); } catch (e) { }
  R = null; $('#reader-root').innerHTML = ''; save(300); render();
}
/* постраничное листание для E-ink: касание по краям, свайп, кнопки громкости (в приложении), стрелки */
function pageTurn(d) {
  if (!R || sheetOpen) return false;
  const rs = $('#rs'); if (!rs) return false;
  const lh = parseFloat(getComputedStyle($('#rt')).lineHeight) || 30;
  const step = Math.max(80, rs.clientHeight - lh * 1.4);
  act.last = now();
  if (d > 0) {
    if (rs.scrollTop + rs.clientHeight >= rs.scrollHeight - 4) { if (R.ch < R.c.chapters.length - 1) goChapter(R.ch + 1); else toast('Это конец книги'); return true; }
    rs.scrollTop = Math.min(rs.scrollHeight, rs.scrollTop + step);
  } else {
    if (rs.scrollTop <= 2) { if (R.ch > 0) { goChapter(R.ch - 1); const r2 = $('#rs'); r2.scrollTop = r2.scrollHeight; } return true; }
    rs.scrollTop = Math.max(0, rs.scrollTop - step);
  }
  return true;
}
window.einkPage = pageTurn;
function bindPaging(rs) {
  let sx = 0, sy = 0, st = 0;
  rs.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; st = now(); });
  rs.addEventListener('pointerup', e => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { pageTurn(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)) { pageTurn(dy < 0 ? 1 : -1); return; }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && now() - st < 600 && !e.target.closest('w,button,a')) {
      const w = rs.clientWidth; if (e.clientX < w * 0.3) pageTurn(-1); else if (e.clientX > w * 0.7) pageTurn(1);
    }
  });
}
function goChapter(c) {
  R.ch = c; R.p = 0; setPos(c, 0, false); renderReader(0); $('#rs').scrollTop = 0;
}
function readerMenu() {
  const b = curBook(); const L = R.lang;
  showSheet(`<h2 style="margin-bottom:10px">${esc(b.title)}</h2>
    <div class="row" style="margin-bottom:14px">
      <div class="seg" role="group" aria-label="Размер текста"><button data-a="fs" data-id="-1" aria-label="Мельче">A−</button><button data-a="fs" data-id="1" aria-label="Крупнее">A+</button></div>
      <div class="seg" role="group" aria-label="Тема">${[['paper', 'Бумага'], ['sepia', 'Сепия'], ['night', 'Ночь']].map(([k, n]) => `<button data-a="theme" data-id="${k}" aria-pressed="${S.settings.theme === k}">${n}</button>`).join('')}</div>
      ${L === 'zh' ? `<div class="seg" role="group" aria-label="Пиньинь"><button data-a="pinyin" aria-pressed="${S.settings.pinyin}">Пиньинь над текстом</button></div>` : ''}
    </div>
    ${R.c.chapters.length > 1 ? `<h3 style="margin:6px 0 4px">Оглавление</h3><ol class="toc">${R.c.chapters.map((c, i) => `<li><button data-a="r-goto" data-id="${i}"${i === R.ch ? ' aria-current="true"' : ''}><span class="n">${i + 1}</span><span lang="${L}">${esc(c.t || 'Глава ' + (i + 1))}</span></button></li>`).join('')}</ol>` : ''}
    <div class="row" style="margin-top:18px"><button class="btn danger sm" data-a="book-del">Убрать книгу с полки</button></div>`, { label: 'Оглавление' });
}
function refreshHighlights() {
  if (!R) return; const saved = savedKeys(R.lang);
  document.querySelectorAll('#rt w').forEach(w => w.classList.toggle('s', saved.has(w.dataset.k)));
}

/* activity timer: считаем время, пока открыта книга или повторение и человек что-то делает */
const act = { last: 0, iv: null };
function startActivity() { act.last = now(); clearInterval(act.iv); act.iv = setInterval(tickActivity, 15000); }
function stopActivity() { clearInterval(act.iv); act.iv = null; }
function tickActivity() {
  if (document.visibilityState !== 'visible' || now() - act.last > 120000) return;
  bump('min', 0.25);
  const lang = R ? R.lang : RV ? RV.lang : null; if (lang) bump('m_' + lang, 0.25);
  if (R) { const b = curBook(); if (b) { b.mins = Math.round(((b.mins || 0) + 0.25) * 100) / 100; b.u = now(); } }
  save(20000);
}
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { act.last = now(); }, { passive: true }));

/* ---------------- word sheet ---------------- */
function openWord(o) {
  CUR = o;
  const w = findWord(o.lang, o.term);
  if (w && w.tr) { o.data = { lemma: w.lemma, pos: w.pos, tr: w.tr, alt: w.alt, note: w.note, py: w.py, hsk: w.hsk }; o.state = 'ok'; o.fromSaved = true; }
  else { o.state = 'loading'; }
  showSheet(wordHTML(o), { label: 'Слово «' + o.term + '»' });
  if (o.state === 'loading') runLookup(o, false);
}
async function runLookup(o, force) {
  o.state = 'loading'; o.err = ''; if (CUR === o) updateSheet(wordHTML(o));
  try { o.data = await lookup(o, force); o.state = 'ok'; o.fromSaved = false; }
  catch (e) { o.state = 'err'; o.err = navigator.onLine === false ? 'Нет интернета. Перевод появится, когда вернётся связь; сохранённые слова доступны и без неё.' : 'Не получилось перевести: ни Claude, ни запасные сервисы перевода не ответили. Попробуй ещё раз чуть позже.'; }
  if (CUR === o) updateSheet(wordHTML(o));
}
function wordHTML(o) {
  const L = o.lang; const d = o.data || {};
  const w = findWord(L, o.term, d.lemma);
  const saved = w && !w.del && w.st === 'learn', known = w && !w.del && w.st === 'known';
  const py = L === 'zh' ? (d.py || pinyinOf(o.term)) : '';
  let body = '';
  if (o.state === 'loading') body = '<div aria-live="polite"><span class="sr">Перевожу…</span><div class="skeleton" style="width:55%;height:20px;margin-top:16px"></div><div class="skeleton" style="width:80%"></div><div class="skeleton" style="width:40%"></div></div>';
  else if (o.state === 'nokey') body = `<p class="notice" style="margin-top:14px">Чтобы видеть перевод, добавь ключ Claude API в настройках. Ключ хранится только на этом устройстве.</p><div class="w-act"><button class="btn primary" data-a="goto-key">Открыть настройки</button></div>`;
  else if (o.state === 'err') body = `<p class="formmsg" role="alert" style="margin-top:14px">${esc(o.err)}</p><div class="w-act"><button class="btn" data-a="w-retry">Ещё раз</button></div>`;
  else {
    const meta = [d.lemma && keyOf(d.lemma, L) !== keyOf(o.term, L) ? esc(d.lemma) + (L === 'zh' && d.py ? ' ' + esc(d.py) : '') : '', esc(d.pos), d.hsk ? 'HSK ' + esc(d.hsk) : ''].filter(Boolean).join(' · ');
    body = `${meta ? `<div class="w-meta" lang="${L}">${meta}</div>` : ''}
      <div class="w-tr">${esc(d.tr || '—')}</div>
      ${d.alt ? `<div class="w-alt">Ещё: ${esc(d.alt)}</div>` : ''}
      ${d.note ? `<div class="w-note">${esc(d.note)}</div>` : ''}
      ${d.src === 'basic' ? `<p class="hint" style="margin:10px 0 0">Простой перевод через ${esc(d.via || 'переводчик')}, без учёта предложения.${o.aiErr ? ' Claude недоступен: ' + esc(o.aiErr) : getKey() ? '' : ' С ключом Claude будет перевод в контексте и пояснения.'}</p>${getKey() ? '<button class="btn ghost sm" data-a="w-retry" style="padding-left:0">Спросить Claude ещё раз</button>' : ''}` : ''}
      ${o.fromSaved ? `<button class="btn ghost sm" data-a="w-retr" style="margin-top:6px;padding-left:0">Перевести в этом предложении</button>` : ''}`;
  }
  const ctx = o.ctx ? `<div class="w-ctx${L === 'zh' ? ' zh' : ''}" lang="${L}">${highlight(o.ctx, o.term, L)}</div>
    ${o.sentTr ? `<div class="w-ctxtr">${esc(o.sentTr)}</div>` : o.sentBusy ? '<div class="skeleton" style="width:70%"></div>' : o.sentErr ? `<div class="formmsg">${esc(o.sentErr)}</div>` : `<button class="btn ghost sm" data-a="w-sent" style="padding-left:0">Перевести предложение</button>`}` : '';
  const acts = o.state === 'ok' ? `<div class="w-act">
      ${saved ? `<button class="btn" data-a="w-known">Уже знаю</button><button class="btn ghost danger" data-a="w-del">Убрать из слов</button>`
      : `<button class="btn primary" data-a="w-save">${known ? 'Снова учить' : 'Учить это слово'}</button>${known ? '' : '<button class="btn" data-a="w-knownnew">Знаю</button>'}`}
    </div>${saved ? '<p class="hint" style="margin-top:8px">Слово уже в повторении.</p>' : ''}` : '';
  return `<div class="w-head"><div style="flex:1;min-width:0"><div class="w-term${L === 'zh' ? ' zh' : ''}" lang="${L}">${esc(o.term)}</div>${py ? `<div class="w-py">${esc(py)}</div>` : ''}</div>
    ${canSpeak ? `<button class="iconbtn" data-a="w-speak" aria-label="Произнести">${I.speak}</button>` : ''}
    <button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div>
    ${body}${ctx}${acts}`;
}
function wordAction(a) {
  const o = CUR; if (!o) return;
  if (a === 'w-speak') return speak(o.term, o.lang);
  if (a === 'w-retry') return runLookup(o, true);
  if (a === 'w-retr') return runLookup(o, false);
  if (a === 'w-sent') {
    o.sentBusy = true; o.sentErr = ''; updateSheet(wordHTML(o));
    translateSentence(o.ctx, o.lang).then(t => { o.sentTr = t; const w = findWord(o.lang, o.term); if (w) { const c = w.ctxs.find(c => c.s === o.ctx); if (c) { c.tr = t; w.u = now(); save(); } } })
      .catch(e => { o.sentErr = e.message; }).finally(() => { o.sentBusy = false; if (CUR === o) updateSheet(wordHTML(o)); });
    return;
  }
  if (a === 'w-save') { saveWord(o, 'learn'); toast('Добавлено в повторение'); }
  if (a === 'w-knownnew') { saveWord(o, 'known'); toast('Отмечено как знакомое'); closeLayer('sheet'); refreshHighlights(); return; }
  if (a === 'w-known') { const w = findWord(o.lang, o.term, o.data && o.data.lemma); if (w) { w.st = 'known'; w.u = now(); save(); } toast('Отмечено как знакомое'); }
  if (a === 'w-del') { const w = findWord(o.lang, o.term, o.data && o.data.lemma); if (w) { w.del = true; w.u = now(); save(); } toast('Слово убрано'); }
  refreshHighlights(); updateSheet(wordHTML(o));
}

/* selection → перевод фразы */
let selT;
document.addEventListener('selectionchange', () => { clearTimeout(selT); selT = setTimeout(checkSelection, 280); });
function checkSelection() {
  const old = $('#selchip'); if (old) old.remove();
  if (!R || sheetOpen) return;
  const sel = window.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const rt = $('#rt'); if (!rt) return;
  const range = sel.getRangeAt(0);
  if (!rt.contains(range.commonAncestorContainer)) return;
  const frag = range.cloneContents(); frag.querySelectorAll('rt').forEach(x => x.remove());
  const phrase = frag.textContent.replace(/\s+/g, ' ').trim();
  if (!phrase || phrase.length > 240 || (R.lang !== 'zh' && !/\s/.test(phrase) && phrase.length < 2)) return;
  const r = range.getBoundingClientRect();
  const b = document.createElement('button');
  b.id = 'selchip'; b.className = 'btn primary sm selchip'; b.textContent = 'Перевести';
  b.style.left = Math.min(window.innerWidth - 60, Math.max(60, r.left + r.width / 2)) + 'px'; b.style.top = Math.max(60, r.top) + 'px';
  b.addEventListener('pointerdown', e => e.preventDefault());
  b.addEventListener('click', () => {
    const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const p = startEl.closest('p[data-i]'); const text = p ? R.c.chapters[R.ch].p[+p.dataset.i] : phrase;
    const idx = text.indexOf(phrase.split(' ')[0]);
    b.remove(); sel.removeAllRanges();
    openWord({ term: phrase, lang: R.lang, ctx: sentenceAt(text, Math.max(0, idx), R.lang), book: R.id });
  });
  document.body.appendChild(b);
}

/* ---------------- words tab ---------------- */
function renderWords() {
  const all = liveWords();
  if (!all.length) return `<div class="empty"><h1>Здесь будут твои слова</h1><p>Открой книгу и нажми на незнакомое слово, затем «Учить это слово». Оно попадёт сюда вместе с предложением, в котором встретилось, и будет повторяться в нужные дни.</p><p class="hint">Чтобы перевести целую фразу, выдели её пальцем или мышью.</p></div>`;
  const langs = Object.keys(LANGS).filter(l => all.some(w => w.lang === l));
  const decks = langs.map(l => {
    const q = reviewQueue(l); const learn = liveWords(l).filter(w => w.st === 'learn').length;
    return `<div class="deck" style="--c:var(--${l})"><div><span class="lang-dot" style="--c:var(--${l})"></span>${LANGS[l].ru}</div>
      <div class="big">${q.length}</div><div class="sub">${q.length ? plural(q.length, 'слово ждёт', 'слова ждут', 'слов ждут') + ' повторения' : 'на сегодня всё повторено'} · в изучении ${learn}</div>
      <button class="btn ${q.length ? 'primary' : ''}" data-a="rv-start" data-id="${l}"${q.length ? '' : ' disabled'}>Повторить</button></div>`;
  }).join('');
  const qn = ui.q.trim().toLowerCase();
  const list = all.filter(w => (ui.wl === 'all' || w.lang === ui.wl) && w.st === ui.ws && (!qn || w.lemma.toLowerCase().includes(qn) || (w.tr || '').toLowerCase().includes(qn) || (w.forms || []).some(f => f.includes(qn))))
    .sort((a, b) => b.created - a.created);
  return `<h1>Слова</h1><div class="decks sec" style="margin-top:16px">${decks}</div>
  <section class="sec">
    <div class="row" style="justify-content:space-between;margin-bottom:12px">
      <div class="chips" role="group" aria-label="Язык">${['all', ...langs].map(l => `<button class="chip" data-a="wl" data-id="${l}" aria-pressed="${ui.wl === l}">${l === 'all' ? 'Все языки' : LANGS[l].ru}</button>`).join('')}</div>
      <div class="seg" role="group" aria-label="Статус"><button data-a="ws" data-id="learn" aria-pressed="${ui.ws === 'learn'}">Учу</button><button data-a="ws" data-id="known" aria-pressed="${ui.ws === 'known'}">Знаю</button></div>
    </div>
    <label class="sr" for="wq">Поиск слова</label><input class="in" id="wq" type="search" placeholder="Найти слово или перевод" value="${esc(ui.q)}" style="margin-bottom:8px">
    <ul class="wlist" id="wlist">${list.map(w => `<li class="wrow"><button data-a="wopen" data-id="${esc(w.id)}"><span class="term${w.lang === 'zh' ? ' zh' : ''}" lang="${w.lang}">${esc(w.lemma)}</span><span class="tr">${esc(w.tr || '')}</span><span class="due">${w.st === 'learn' ? (w.srs.reps || w.srs.lapses ? (w.srs.due <= now() ? 'сегодня' : ivlLabel(w.srs)) : 'новое') : ''}</span></button></li>`).join('') || '<li class="hint" style="padding:14px 0">Ничего не нашлось.</li>'}</ul>
  </section>`;
}
function wordDetail(id) {
  const w = S.words[id]; if (!w) return;
  const L = w.lang;
  showSheet(`<div class="w-head"><div style="flex:1;min-width:0"><div class="w-term${L === 'zh' ? ' zh' : ''}" lang="${L}">${esc(w.lemma)}</div>${w.py ? `<div class="w-py">${esc(w.py)}</div>` : ''}</div>
      ${canSpeak ? `<button class="iconbtn" data-a="d-speak" data-id="${esc(id)}" aria-label="Произнести">${I.speak}</button>` : ''}<button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div>
    <div class="w-meta">${[esc(w.pos), w.hsk ? 'HSK ' + esc(w.hsk) : '', (w.forms || []).filter(f => f !== keyOf(w.lemma, L)).length ? 'формы: ' + esc(w.forms.filter(f => f !== keyOf(w.lemma, L)).join(', ')) : ''].filter(Boolean).join(' · ')}</div>
    <form data-form="edit-tr" data-id="${esc(id)}" style="margin-top:12px"><label class="f">Перевод<input class="in" name="tr" value="${esc(w.tr || '')}"></label></form>
    ${w.alt ? `<div class="w-alt">Ещё: ${esc(w.alt)}</div>` : ''}${w.note ? `<div class="w-note">${esc(w.note)}</div>` : ''}
    ${(w.ctxs || []).map(c => `<div class="w-ctx${L === 'zh' ? ' zh' : ''}" lang="${L}">${highlight(c.s, c.f, L)}</div>${c.tr ? `<div class="w-ctxtr">${esc(c.tr)}</div>` : ''}<div class="hint">${esc(c.b || '')}</div>`).join('')}
    <div class="w-act">${w.st === 'learn' ? `<button class="btn" data-a="d-known" data-id="${esc(id)}">Уже знаю</button>` : `<button class="btn" data-a="d-learn" data-id="${esc(id)}">Снова учить</button>`}<button class="btn ghost danger" data-a="d-del" data-id="${esc(id)}">Удалить</button></div>`, { label: w.lemma });
}

/* ---------------- review ---------------- */
function startReview(lang) {
  const q = reviewQueue(lang);
  if (!q.length) { toast('На сегодня повторять нечего'); return; }
  RV = { lang, q, total: q.length, done: 0, show: false, again: {} };
  openLayer('review'); renderReview(); startActivity();
}
function renderReview() {
  const root = $('#review-root'); if (!RV) { root.innerHTML = ''; return; }
  const id = RV.q[0]; const w = id && S.words[id];
  const prog = Math.round(RV.done / Math.max(1, RV.total + Object.keys(RV.again).length) * 100);
  let body, foot;
  if (!w) {
    const t = dayTotals(today());
    body = `<div class="card"><h1>Готово</h1><p class="hint" style="margin-top:10px">Повторено сегодня: ${t.rev}. Следующие слова появятся, когда придёт их время.</p></div>`;
    foot = `<button class="btn primary wide" data-a="rv-close">К словам</button>`;
  } else {
    const L = w.lang; const c = (w.ctxs || [])[0];
    body = `<div class="card">
      <div class="term${L === 'zh' ? ' zh' : ''}" lang="${L}">${esc(w.lemma)}</div>
      ${RV.show && w.py ? `<div class="w-py" style="margin-top:6px">${esc(w.py)}</div>` : ''}
      ${canSpeak ? `<button class="btn ghost sm" data-a="rv-speak" style="margin-top:8px">${I.speak}Послушать</button>` : ''}
      ${c ? `<div class="ctx${L === 'zh' ? ' zh' : ''}" lang="${L}">${highlight(c.s, c.f, L)}</div><div class="src">${esc(c.b || '')}</div>` : ''}
      ${RV.show ? `<div class="ans" aria-live="polite"><div class="w-tr">${esc(w.tr || '—')}</div>${w.alt ? `<div class="w-alt">Ещё: ${esc(w.alt)}</div>` : ''}${w.note ? `<div class="w-note" style="text-align:left">${esc(w.note)}</div>` : ''}${c && c.tr ? `<div class="w-ctxtr" style="text-align:left;margin-top:12px">${esc(c.tr)}</div>` : ''}</div>` : ''}
    </div>`;
    if (!RV.show) foot = `<button class="btn primary wide" data-a="rv-show">Показать перевод</button>`;
    else {
      const labels = ['Не помню', 'С трудом', 'Помню', 'Легко'];
      foot = `<div class="grades">${labels.map((l, g) => `<button class="btn${g === 2 ? ' primary' : ''}" data-a="rv-grade" data-id="${g}">${l}<small>${ivlLabel(sm2(w.srs, g))}</small></button>`).join('')}</div>`;
    }
  }
  root.innerHTML = `<div class="review" role="dialog" aria-label="Повторение слов">
    <div class="rv-top"><button class="iconbtn" data-a="rv-close" aria-label="Закончить">${I.close}</button><div class="prog" aria-hidden="true"><i style="width:${prog}%"></i></div><span class="hint">${RV.q.length}</span></div>
    <div class="rv-body">${body}</div><div class="rv-foot">${foot}</div></div>`;
}
function gradeReview(g) {
  const id = RV.q.shift(); const w = S.words[id]; if (!w) return renderReview();
  const wasNew = w.srs.reps === 0 && w.srs.lapses === 0;
  w.srs = sm2(w.srs, g); w.u = now();
  if (wasNew && !RV.again[id]) bump('nw', 1);
  bump('rev', 1);
  if (g === 0) { RV.again[id] = 1; RV.q.push(id); } else RV.done++;
  RV.show = false; save(4000); renderReview();
}
function exitReview() { RV = null; stopActivity(); $('#review-root').innerHTML = ''; save(300); render(); }

/* ---------------- diary ---------------- */
function streak() {
  let n = 0; const d = new Date();
  const active = k => { const t = dayTotals(k); return t.min >= 1 || t.rev > 0; };
  if (!active(dayKey(d))) d.setDate(d.getDate() - 1);
  while (active(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderDiary() {
  const t = dayTotals(today()); const goal = S.settings.goal;
  const frac = Math.min(1, t.min / goal);
  const C = 2 * Math.PI * 40;
  const days = []; const d = new Date(); d.setDate(d.getDate() - 13);
  let week = 0;
  for (let i = 0; i < 14; i++) { const k = dayKey(d); const x = dayTotals(k); days.push({ k, min: x.min, wd: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()], dd: d.getDate() }); if (i >= 7) week += x.min; d.setDate(d.getDate() + 1); }
  const mx = Math.max(goal, ...days.map(x => x.min));
  const books = liveBooks();
  const langs = Object.keys(LANGS).filter(l => books.some(b => b.lang === l) || liveWords(l).length);
  return `<h1>Дневник</h1>
  <section class="sec panel goal">
    <svg viewBox="0 0 100 100" role="img" aria-label="Сегодня ${Math.round(t.min)} из ${goal} минут"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" stroke-width="9"/><circle cx="50" cy="50" r="40" fill="none" stroke="var(--accent)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/><text x="50" y="56" text-anchor="middle" font-size="22" font-weight="600" fill="var(--ink)" font-family="Playfair Display,Literata,serif">${Math.round(t.min)}</text></svg>
    <div><h2>${frac >= 1 ? 'Цель на сегодня выполнена' : `Сегодня ${Math.round(t.min)} из ${goal} минут`}</h2>
    <p class="hint" style="margin:6px 0 0">Серия: ${streak()} ${plural(streak(), 'день', 'дня', 'дней')} подряд · сегодня прочитано ${fmtNum(t.words)} слов, повторено ${t.rev}, новых слов ${t.saved}</p></div>
  </section>
  <section class="sec"><div class="sec-h"><h2>Две недели</h2><span class="hint">за 7 дней ${Math.round(week)} мин</span></div>
    <div class="panel"><div class="days" role="img" aria-label="Минуты занятий по дням">${days.map(x => `<div class="d" title="${x.k}: ${Math.round(x.min)} мин"><div class="b${x.min < 0.5 ? ' z' : ''}" style="height:${Math.max(2, x.min / mx * 100)}%;${x.min > 0 && x.min < goal ? 'opacity:.45' : ''}"></div><span class="dl">${x.dd}</span></div>`).join('')}</div></div>
  </section>
  ${langs.length ? `<section class="sec"><h2 style="margin-bottom:12px">По языкам</h2><div class="panel tablewrap"><table class="tl"><thead><tr><th>Язык</th><th class="n">Книг</th><th class="n">Учу слов</th><th class="n">Знаю</th><th class="n">Минут в книгах</th></tr></thead><tbody>
    ${langs.map(l => { const bs = books.filter(b => b.lang === l); const ws = liveWords(l); return `<tr><td><span class="lang-dot" style="--c:var(--${l})"></span>${LANGS[l].ru} <span class="hint">${esc(S.settings.levels[l])}</span></td><td class="n">${bs.length}</td><td class="n">${ws.filter(w => w.st === 'learn').length}</td><td class="n">${ws.filter(w => w.st === 'known').length}</td><td class="n">${Math.round(bs.reduce((s, b) => s + (b.mins || 0), 0))}</td></tr>`; }).join('')}
  </tbody></table></div></section>` : ''}
  ${books.length ? `<section class="sec"><h2 style="margin-bottom:12px">Книги</h2><div class="panel tablewrap"><table class="tl"><thead><tr><th>Книга</th><th class="n">Прочитано</th><th class="n">Минут</th></tr></thead><tbody>
    ${books.map(b => `<tr><td lang="${b.lang}"><span class="lang-dot" style="--c:var(--${b.lang})"></span>${esc(b.title)}</td><td class="n">${pctLabel(b)}</td><td class="n">${Math.round(b.mins || 0)}</td></tr>`).join('')}
  </tbody></table></div></section>` : ''}`;
}

/* ---------------- расписание и напоминания ---------------- */
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const isoWd = d => (d.getDay() + 6) % 7 + 1;
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } };
function schedule() { return (S.settings.schedule || []).filter(it => it && LANGS[it.lang]); }
function todayPlan() { const wd = isoWd(new Date()); return schedule().filter(it => !it.off && it.days.includes(wd)).sort((a, b) => a.time.localeCompare(b.time)); }
function daysLabel(days) {
  const d = [...days].sort();
  if (d.length === 7) return 'каждый день';
  if (d.join() === '1,2,3,4,5') return 'по будням';
  if (d.join() === '6,7') return 'по выходным';
  return d.map(x => WD[x - 1]).join(', ');
}
function renderPlanToday() {
  const plan = todayPlan(); if (!plan.length) return '';
  return `<section class="sec plan" aria-label="План на сегодня"><div class="sec-h"><h2>Сегодня по плану</h2><span class="hint">${esc(WD[isoWd(new Date()) - 1])}</span></div><div class="plan-list">
    ${plan.map(it => { const done = langMinutes(today(), it.lang); const f = Math.min(1, done / it.min); const book = liveBooks().find(b => b.lang === it.lang);
      return `<div class="plan-item" style="--c:var(--${it.lang})"><div class="pi-main"><div class="pi-h"><span class="lang-dot" style="--c:var(--${it.lang})"></span>${LANGS[it.lang].ru} <span class="hint">в ${esc(it.time)}</span></div>
        <div class="bar" aria-hidden="true"><i style="width:${Math.round(f * 100)}%"></i></div><div class="hint">${f >= 1 ? 'Готово: ' + Math.round(done) + ' мин' : Math.round(done) + ' из ' + it.min + ' мин'}</div></div>
        ${book && f < 1 ? `<button class="btn sm${f < 1 ? ' primary' : ''}" data-a="open" data-id="${book.id}">Читать</button>` : f >= 1 ? '<span class="pi-ok" aria-label="Выполнено">✓</span>' : ''}</div>`; }).join('')}
  </div></section>`;
}
function scheduleEditor(id) {
  const ex = schedule().find(it => it.id === id);
  const d = ex ? JSON.parse(JSON.stringify(ex)) : { id: 's' + now().toString(36), lang: 'pl', days: [], time: '19:00', min: 20 };
  const paint = () => showSheet(`<h2 style="margin-bottom:14px">${ex ? 'Занятие' : 'Новое занятие'}</h2>
    <form data-form="sched">
      <div class="f">Язык<div style="margin-top:6px" class="seg" role="group" aria-label="Язык">${Object.keys(LANGS).map(l => `<button type="button" data-a="sc-lang" data-id="${l}" aria-pressed="${d.lang === l}">${LANGS[l].ru}</button>`).join('')}</div></div>
      <div class="f">Дни<div style="margin-top:6px" class="days-pick" role="group" aria-label="Дни недели">${WD.map((n, i) => `<button type="button" class="chip" data-a="sc-day" data-id="${i + 1}" aria-pressed="${d.days.includes(i + 1)}">${n}</button>`).join('')}</div></div>
      <div class="row" style="align-items:flex-start;gap:16px">
        <label class="f" style="width:150px">Время<input class="in" type="time" name="time" value="${esc(d.time)}" required></label>
        <div class="f">Минут<div style="margin-top:6px" class="seg" role="group" aria-label="Минут">${[10, 15, 20, 30, 45, 60].map(m => `<button type="button" data-a="sc-min" data-id="${m}" aria-pressed="${d.min === m}">${m}</button>`).join('')}</div></div>
      </div>
      ${scheduleEditor.err ? `<p class="formmsg" role="alert">${esc(scheduleEditor.err)}</p>` : ''}
      <div class="row" style="margin-top:6px"><button class="btn primary" type="submit">Сохранить</button><button class="btn ghost" type="button" data-a="sheet-close">Отмена</button>${ex ? '<button class="btn ghost danger" type="button" data-a="sc-del">Удалить</button>' : ''}</div>
    </form>`, { center: true, label: 'Занятие по расписанию' });
  scheduleEditor.cur = { d, paint, isNew: !ex }; scheduleEditor.err = '';
  paint();
}
function scheduleSave() {
  const { d } = scheduleEditor.cur; const f = document.querySelector('form[data-form="sched"]');
  d.time = f.time.value || '19:00';
  if (!d.days.length) { scheduleEditor.err = 'Выбери хотя бы один день.'; scheduleEditor.cur.paint(); return; }
  d.days.sort();
  const list = schedule().filter(it => it.id !== d.id); list.push(d);
  list.sort((a, b) => Math.min(...a.days) - Math.min(...b.days) || a.time.localeCompare(b.time));
  S.settings.schedule = list; S.settings.tz = deviceTz(); S.settings.u = now(); save();
  closeLayer('sheet'); setTimeout(render, 30); toast('Расписание сохранено');
}
function scheduleDelete() {
  const { d } = scheduleEditor.cur;
  S.settings.schedule = schedule().filter(it => it.id !== d.id); S.settings.u = now(); save();
  closeLayer('sheet'); setTimeout(render, 30);
}

/* уведомления: в APK — будильники Android, в браузере — Web Push через Supabase */
const pushState = { status: 'unknown', busy: false, msg: '' };
const PUSH_OK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
function b64uToBytes(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
async function swReg() { if (!('serviceWorker' in navigator)) return null; return (await navigator.serviceWorker.getRegistration()) || navigator.serviceWorker.ready; }
async function refreshPushState() {
  if (NATIVE || !PUSH_OK) return;
  try { const reg = await swReg(); const sub = reg && await reg.pushManager.getSubscription(); pushState.status = sub && Notification.permission === 'granted' ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off'; }
  catch (e) { pushState.status = 'off'; }
  if (ui.tab === 'settings' && !sheetOpen) render();
}
async function pushOn() {
  if (!session) { pushState.msg = 'Сначала войди в аккаунт — уведомления привязаны к нему.'; render(); return; }
  pushState.busy = true; pushState.msg = ''; render();
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Уведомления запрещены для этого сайта. Разреши их в настройках браузера и нажми ещё раз.' : 'Разрешение на уведомления не дано.');
    const reg = await swReg(); if (!reg) throw new Error('Браузер не поддерживает фоновые уведомления.');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(CFG.vapidPublicKey) });
    const j = sub.toJSON();
    const { error } = await sb.from('mezhdu_push_subs').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: session.user.id, ua: navigator.userAgent.slice(0, 200) });
    if (error) throw new Error('Не получилось сохранить подписку: ' + error.message);
    if (!S.settings.tz) { S.settings.tz = deviceTz(); S.settings.u = now(); save(); }
    pushState.status = 'on'; toast('Уведомления включены');
  } catch (e) { pushState.msg = e.message || 'Не получилось включить уведомления.'; }
  pushState.busy = false; render();
}
async function pushOff() {
  pushState.busy = true; render();
  try {
    const reg = await swReg(); const sub = reg && await reg.pushManager.getSubscription();
    if (sub) { if (sb && session) await sb.from('mezhdu_push_subs').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
    pushState.status = 'off';
  } catch (e) { pushState.msg = 'Не получилось выключить: ' + e.message; }
  pushState.busy = false; render();
}
async function pushTest() {
  try { const reg = await swReg(); const it = schedule()[0] || { lang: 'pl', min: 20 }; await reg.showNotification(LANGS[it.lang].ru + ' — ' + it.min + ' мин', { body: 'Так будет выглядеть напоминание.', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'mezhdu-test' }); }
  catch (e) { pushState.msg = 'Не получилось показать уведомление: ' + e.message; render(); }
}
function renderReminders() {
  const items = schedule();
  let notif;
  if (NATIVE) notif = `<p class="hint" style="margin:0 0 10px">На этом устройстве напоминания ставит само приложение — интернет для них не нужен.</p><button class="btn" data-a="native-notif">Разрешить уведомления</button>`;
  else if (!PUSH_OK) notif = `<p class="hint" style="margin:0">${isIOS && !standalone() ? 'На iPhone уведомления работают, только если добавить приложение на экран «Домой»: «Поделиться» → «На экран „Домой“», затем открыть его оттуда.' : 'Этот браузер не умеет показывать уведомления от сайтов.'}</p>`;
  else if (!SYNC_READY) notif = '<p class="hint" style="margin:0">Для уведомлений нужна синхронизация.</p>';
  else notif = `<div class="row">${pushState.status === 'on' ? `<span class="pill-on">Уведомления включены</span><button class="btn sm" data-a="push-test">Показать пример</button><button class="btn ghost sm" data-a="push-off"${pushState.busy ? ' disabled' : ''}>Выключить</button>` : `<button class="btn primary" data-a="push-on"${pushState.busy ? ' disabled' : ''}>${pushState.busy ? 'Включаю…' : 'Включить уведомления на этом устройстве'}</button>`}</div>
    ${pushState.msg ? `<p class="formmsg" role="alert" style="margin-top:10px">${esc(pushState.msg)}</p>` : ''}
    ${!session ? '<p class="hint" style="margin:10px 0 0">Уведомления привязаны к аккаунту — войди в разделе «Синхронизация».</p>' : ''}`;
  return `<section class="panel" id="reminders"><h2 style="margin-bottom:6px">Расписание</h2>
    <p class="hint" style="margin:0 0 14px">В выбранные дни придёт напоминание, если ты ещё не позанималась этим языком нужное время.</p>
    ${items.length ? `<ul class="sched">${items.map(it => `<li><button data-a="sc-edit" data-id="${esc(it.id)}" aria-label="Изменить: ${LANGS[it.lang].ru}, ${esc(daysLabel(it.days))}, ${esc(it.time)}"><span class="lang-dot" style="--c:var(--${it.lang})"></span><b>${LANGS[it.lang].ru}</b><span class="t">${esc(it.time)}</span><span class="d">${esc(daysLabel(it.days))} · ${it.min} мин</span></button></li>`).join('')}</ul>` : ''}
    <button class="btn" data-a="sc-add">${I.plus}Добавить занятие</button>
    <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line)">${notif}</div>
  </section>`;
}
function syncNative() {
  if (!NATIVE || !NATIVE.setSchedule) return;
  try {
    const t = today(); const info = {};
    for (const l of Object.keys(LANGS)) {
      const b = liveBooks().find(x => x.lang === l);
      const due = liveWords(l).filter(w => w.st === 'learn' && w.srs.due <= now()).length;
      info[l] = { done: langMinutes(t, l), book: b ? b.title : '', pct: b ? Math.floor((b.pct || 0) * 100) : 0, due };
    }
    NATIVE.setSchedule(JSON.stringify({ items: schedule(), day: t, info }));
  } catch (e) { }
}
async function openLangFromUrl() {
  const m = location.search.match(/[?&]open=(en|pl|zh)/); if (!m) return;
  try { history.replaceState(null, '', location.pathname + location.search.replace(/[?&]open=(en|pl|zh)/, '').replace(/^&/, '?')); } catch (e) { }
  const b = liveBooks().find(x => x.lang === m[1]); if (b) openBook(b.id);
}

/* ---------------- settings ---------------- */
let keyMsg = '', installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (ui.tab === 'settings') render(); });
function seg(name, opts, cur, label) { return `<div class="seg" role="group" aria-label="${esc(label)}">${opts.map(([v, n]) => `<button data-a="set" data-k="${name}" data-id="${v}" aria-pressed="${String(cur) === String(v)}">${n}</button>`).join('')}</div>`; }
function renderSettings() {
  const st = S.settings; const key = getKey();
  return `<h1>Настройки</h1><div class="set sec">
  <section class="panel"><h2 style="margin-bottom:12px">Перевод</h2>
    <div class="f">Объяснять на языке<div style="margin-top:5px">${seg('target', Object.entries(TARGETS).map(([k, v]) => [k, v.name]), st.target, 'Язык объяснений')}</div></div>
    <form data-form="key"><label class="f">Ключ Claude API<input class="in" name="key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(key)}"></label>
      <div class="row"><button class="btn primary" type="submit">Сохранить ключ</button>${key ? '<button class="btn" type="button" data-a="key-test">Проверить</button><button class="btn ghost danger" type="button" data-a="key-del">Удалить ключ</button>' : ''}</div>
      ${keyMsg ? `<p class="${/не|ошиб/i.test(keyMsg) ? 'formmsg' : 'notice'}" role="status" style="margin-top:10px">${esc(keyMsg)}</p>` : ''}
      <p class="hint" style="margin-top:10px">Ключ хранится только в этом браузере и не синхронизируется — на телефоне его нужно вписать отдельно. Создать ключ: console.anthropic.com → API Keys. Без ключа или если Claude не отвечает, слова переводятся через Google Переводчик или MyMemory — проще и без учёта предложения.</p></form>
    <label class="f" style="margin-top:6px">Модель<select class="in" data-a="set-model">${MODELS.map(m => `<option value="${m.id}"${st.model === m.id ? ' selected' : ''}>${m.name}</option>`).join('')}</select></label>
    <div class="f">Мой уровень — от него зависят пояснения<div class="row" style="margin-top:6px">${Object.keys(LANGS).map(l => `<label style="display:flex;align-items:center;gap:8px;color:var(--ink)">${LANGS[l].ru}<select class="in" style="width:auto;min-height:38px;padding:6px 10px" data-a="set-level" data-id="${l}">${LANGS[l].levels.map(v => `<option${st.levels[l] === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`).join('')}</div></div>
  </section>
  <section class="panel"><h2 style="margin-bottom:12px">Чтение</h2>
    <div class="f">Экран электронной книги (E-ink)<div style="margin-top:5px" class="seg" role="group" aria-label="E-ink"><button data-a="eink" aria-pressed="${EINK}">${EINK ? 'Включён' : 'Выключен'}</button></div>
      <p class="hint" style="margin:6px 0 0">Чёрное на белом без теней и анимаций, страницы листаются касанием по краю, свайпом, стрелками или кнопками громкости в приложении для Boox. Настройка этого устройства.</p></div>
    <div class="f">Тема<div style="margin-top:5px">${seg('theme', [['auto', 'Как в системе'], ['paper', 'Бумага'], ['sepia', 'Сепия'], ['night', 'Ночь']], st.theme, 'Тема')}</div></div>
    <div class="f">Размер текста: ${st.font}px<div style="margin-top:5px" class="seg" role="group" aria-label="Размер текста"><button data-a="fs" data-id="-1">A−</button><button data-a="fs" data-id="1">A+</button></div></div>
    <div class="f">Межстрочный интервал<div style="margin-top:5px">${seg('lh', [[1.45, 'Плотно'], [1.65, 'Обычно'], [1.9, 'Свободно']], st.lh, 'Интервал')}</div></div>
    <div class="f">Пиньинь над китайским текстом<div style="margin-top:5px">${seg('pinyin', [[true, 'Показывать'], [false, 'Скрыть']], st.pinyin, 'Пиньинь')}</div></div>
  </section>
  <section class="panel"><h2 style="margin-bottom:12px">Занятия</h2>
    <div class="f">Цель в день<div style="margin-top:5px">${seg('goal', [[10, '10 мин'], [20, '20 мин'], [30, '30 мин'], [45, '45 мин'], [60, 'час']], st.goal, 'Цель в день')}</div></div>
    <div class="f">Новых слов в повторении за день<div style="margin-top:5px">${seg('newPerDay', [[5, '5'], [10, '10'], [15, '15'], [25, '25'], [40, '40']], st.newPerDay, 'Новых слов в день')}</div></div>
  </section>
  ${renderReminders()}
  ${renderAccount()}
  <section class="panel"><h2 style="margin-bottom:12px">Данные</h2>
    <p class="hint" style="margin-top:0">Копия слов, прогресса и настроек одним файлом. Тексты книг в копию не входят.</p>
    <div class="row"><button class="btn" data-a="export">Скачать копию</button><button class="btn" data-a="import-backup">Загрузить копию</button><input type="file" id="backup" class="sr" accept="application/json,.json"></div>
    ${installPrompt ? '<div class="row" style="margin-top:12px"><button class="btn" data-a="install">Установить как приложение</button></div>' : ''}
  </section></div>`;
}
function setSetting(k, v) {
  const st = S.settings;
  if (k === 'goal' || k === 'newPerDay' || k === 'lh') v = +v;
  if (k === 'pinyin') v = v === true || v === 'true';
  st[k] = v; st.u = now(); save(); applyTheme();
  if (R) { trackPosition(); renderReader(R.p); }
  if (sheetOpen && R) readerMenu();
  render();
}

/* ---------------- sync (Supabase) ---------------- */
const CFG = window.APP_CONFIG || {};
const SYNC_READY = !!(CFG.supabaseUrl && CFG.supabaseKey && !/YOUR_|ВАШ/.test(CFG.supabaseUrl + CFG.supabaseKey) && window.supabase);
let sb = null, session = null, syncing = false, syncAgain = false, dirty = false, syncErr = '', retryT = null;
const auth = { mode: 'in', email: '', busy: false, msg: '', info: '' };
function setStatus() {
  const el = $('#status'); if (!el) return;
  let t = '', c = 'status';
  if (!SYNC_READY) t = 'Только на этом устройстве';
  else if (!session) t = 'Не выполнен вход';
  else if (syncErr) { t = 'Нет связи, всё сохранено здесь'; c += ' busy'; }
  else if (dirty || syncing) t = 'Синхронизирую…';
  else t = 'Синхронизировано';
  el.className = c; el.textContent = t;
}
const bookPath = id => session.user.id + '/' + id + '.json';
async function uploadBook(id, c) {
  const { error } = await sb.storage.from('books').upload(bookPath(id), new Blob([JSON.stringify(c)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' });
  if (error) throw error;
}
async function downloadBook(id) {
  try {
    const { data, error } = await sb.storage.from('books').download(bookPath(id));
    if (error || !data) return null;
    const c = JSON.parse(await data.text());
    await idb.put('books', id, c);
    return c;
  } catch (e) { return null; }
}
async function sync() {
  if (!sb || !session) { setStatus(); return; }
  if (syncing) { syncAgain = true; return; }
  syncing = true; dirty = false; clearTimeout(retryT); setStatus();
  let more = false;
  try {
    const uid = session.user.id;
    const { data, error } = await sb.from('mezhdu_state').select('state').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    const remote = data && data.state ? normalize(data.state) : null;
    if (remote) {
      const merged = merge(S, remote);
      if (stable(merged) !== stable(S)) { S = merged; await persist(); onRemoteChange(); }
    }
    if (!remote || stable(S) !== stable(remote)) {
      const { error: e2 } = await sb.from('mezhdu_state').upsert({ user_id: uid, state: S, updated_at: new Date().toISOString() });
      if (e2) throw e2;
    }
    for (const b of Object.values(S.books)) {
      if (!b.del && !b.cloud) { const c = await idb.get('books', b.id).catch(() => null); if (c) { await uploadBook(b.id, c); b.cloud = true; b.u = now(); more = true; } }
      else if (b.del && b.cloud) { await sb.storage.from('books').remove([bookPath(b.id)]); b.cloud = false; b.u = now(); more = true; }
    }
    if (more) await persist();
    syncErr = '';
  } catch (e) {
    syncErr = (e && e.message) || 'нет связи'; dirty = true;
    retryT = setTimeout(sync, 15000 + Math.random() * 5000);
  }
  syncing = false; setStatus();
  if (syncAgain || more) { syncAgain = false; setTimeout(sync, 50); }
}
function onRemoteChange() {
  applyTheme();
  if (RV) return;
  if (R) { if (!S.books[R.id] || S.books[R.id].del) { exitReaderHard(); return; } refreshHighlights(); updateFoot(); return; }
  if (!sheetOpen && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) render();
}
function exitReaderHard() { stopActivity(); if (NATIVE) try { NATIVE.setPaging(false); } catch (e) { } R = null; $('#reader-root').innerHTML = ''; while (layers.length) layers.pop(); render(); }
function renderAccount() {
  let h = '<section class="panel" id="account"><h2 style="margin-bottom:12px">Синхронизация</h2>';
  if (!SYNC_READY) return h + '<p class="hint" style="margin:0">Синхронизация пока не настроена: в файле config.js нет адреса Supabase. Всё хранится в этом браузере.</p></section>';
  if (session && auth.mode === 'newpass') {
    return h + `<form data-form="newpass"><label class="f">Новый пароль<input class="in" id="au-pass" type="password" autocomplete="new-password" minlength="6" required></label><button class="btn primary" type="submit"${auth.busy ? ' disabled' : ''}>Сохранить пароль</button></form>${auth.msg ? `<p class="formmsg">${esc(auth.msg)}</p>` : ''}</section>`;
  }
  if (session) return h + `<p style="margin-top:0">Вход выполнен: <b>${esc(session.user.email)}</b>. Слова, прогресс и книги одинаковые на телефоне и компьютере.</p>${syncErr ? `<p class="formmsg">Последняя попытка не удалась: ${esc(syncErr)}. Повторю сама, как появится связь.</p>` : ''}<div class="row"><button class="btn" data-a="sync-now">Синхронизировать сейчас</button><button class="btn ghost" data-a="signout">Выйти</button></div></section>`;
  if (auth.mode === 'forgot') return h + `${auth.info ? `<p class="notice">${esc(auth.info)}</p>` : ''}<form data-form="forgot"><label class="f">Электронная почта<input class="in" id="au-email" type="email" autocomplete="email" value="${esc(auth.email)}" required></label><div class="row"><button class="btn primary" type="submit"${auth.busy ? ' disabled' : ''}>Прислать ссылку</button><button class="btn ghost" type="button" data-a="auth-mode" data-id="in">Назад</button></div></form>${auth.msg ? `<p class="formmsg" role="alert">${esc(auth.msg)}</p>` : ''}</section>`;
  const up = auth.mode === 'up';
  return h + `<p class="hint" style="margin-top:0">Войди, чтобы книги, слова и прогресс были на всех устройствах.</p>${auth.info ? `<p class="notice">${esc(auth.info)}</p>` : ''}
    <form data-form="${up ? 'signup' : 'signin'}"><label class="f">Электронная почта<input class="in" id="au-email" type="email" autocomplete="email" value="${esc(auth.email)}" required></label>
    <label class="f">Пароль<input class="in" id="au-pass" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="6" required></label>
    <div class="row"><button class="btn primary" type="submit"${auth.busy ? ' disabled' : ''}>${auth.busy ? 'Подожди…' : up ? 'Создать аккаунт' : 'Войти'}</button>
    <button class="btn ghost" type="button" data-a="auth-mode" data-id="${up ? 'in' : 'up'}">${up ? 'У меня уже есть аккаунт' : 'Создать аккаунт'}</button>
    ${up ? '' : '<button class="btn ghost" type="button" data-a="auth-mode" data-id="forgot">Забыла пароль</button>'}</div></form>
    ${auth.msg ? `<p class="formmsg" role="alert">${esc(auth.msg)}</p>` : ''}</section>`;
}
async function authSubmit(kind) {
  if (!sb || auth.busy) return;
  const em = $('#au-email'), pw = $('#au-pass');
  if (kind === 'newpass') {
    const password = pw.value; auth.busy = true; render();
    const { error } = await sb.auth.updateUser({ password }); auth.busy = false;
    if (error) auth.msg = 'Не получилось сохранить пароль: ' + error.message; else { auth.mode = 'in'; toast('Новый пароль сохранён'); try { history.replaceState(null, '', location.pathname); } catch (e) { } }
    render(); return;
  }
  const email = em.value.trim(); auth.email = email; auth.msg = ''; auth.busy = true; render();
  if (kind === 'forgot') {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); auth.busy = false;
    if (error) auth.msg = /rate|seconds/i.test(error.message) ? 'Письма можно отправлять не чаще пары раз в час. Подожди и попробуй снова.' : 'Не получилось отправить письмо: ' + error.message;
    else auth.info = 'Если такой аккаунт есть, на ' + email + ' придёт ссылка. Открой её в этом же браузере и задай новый пароль. Проверь «Спам».';
    render(); return;
  }
  const password = pw.value;
  if (kind === 'signup') {
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }); auth.busy = false;
    if (error) auth.msg = /registered|exists/i.test(error.message) ? 'Аккаунт с этой почтой уже есть. Войди с паролем.' : /password/i.test(error.message) ? 'Пароль слишком простой: нужно не меньше 6 символов.' : 'Не получилось создать аккаунт: ' + error.message;
    else if (data && data.user && Array.isArray(data.user.identities) && !data.user.identities.length) { auth.mode = 'in'; auth.msg = 'Аккаунт с этой почтой уже есть. Войди с паролем.'; }
    else if (data && data.session) auth.info = '';
    else { auth.mode = 'in'; auth.info = 'Отправили письмо на ' + email + '. Нажми ссылку в нём, потом вернись сюда и войди с паролем.'; }
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password }); auth.busy = false;
    if (error) auth.msg = /confirm/i.test(error.message) ? 'Почта ещё не подтверждена. Нажми ссылку в письме от Supabase и попробуй снова.' : /invalid/i.test(error.message) ? 'Неверная почта или пароль.' : 'Не получилось войти: ' + error.message;
    else { auth.info = ''; toast('Вход выполнен. Синхронизирую…'); }
  }
  render();
}
async function signOut() {
  if (dirty) await sync();
  if (dirty && !confirm('Последние изменения не дошли до сервера: нет связи. Выйти всё равно? Они пропадут с этого устройства.')) return;
  try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { }
  session = null; S = fresh();
  await Promise.all(['kv', 'books'].map(s => idb.clear(s).catch(() => { })));
  auth.info = 'Ты вышла. Данные остались в аккаунте, с этого устройства они удалены.';
  applyTheme(); render();
}
async function initSync() {
  if (!SYNC_READY) { setStatus(); return; }
  try {
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    sb.auth.onAuthStateChange((ev, s) => {
      const had = session && session.user.id; session = s;
      if (ev === 'PASSWORD_RECOVERY') { auth.mode = 'newpass'; ui.tab = 'settings'; }
      if (s && s.user.id !== had) setTimeout(sync, 0);
      setStatus(); if (!R && !RV && !sheetOpen && (ui.tab === 'settings' || had !== (s && s.user.id))) render();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); else if (dirty) sync(); });
    window.addEventListener('online', sync);
    setInterval(() => { if (document.visibilityState === 'visible' && session && !syncing) sync(); }, 90000);
  } catch (e) { sb = null; }
  setStatus();
}

/* ---------------- backup ---------------- */
function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'mezhdu-strok', at: new Date().toISOString(), state: S }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mezhdu-strok-' + today() + '.json'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importBackup(file) {
  try {
    const j = JSON.parse(await file.text());
    if (!j || !j.state || !j.state.words) throw 0;
    S = merge(S, j.state); await persist(); save(); applyTheme(); render(); toast('Копия загружена и объединена с текущими данными');
  } catch (e) { toast('Это не похоже на копию «Между строк».'); }
}

/* ---------------- events ---------------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]'); if (!t) {
    const w = e.target.closest('#rt w');
    if (w && R) {
      const sel = window.getSelection(); if (sel && !sel.isCollapsed && sel.toString().trim().length > 1) return;
      document.querySelectorAll('#rt w.on').forEach(x => x.classList.remove('on')); w.classList.add('on');
      const p = w.closest('p'); const text = R.c.chapters[R.ch].p[+p.dataset.i];
      const term = w.dataset.t || w.textContent;
      openWord({ term, lang: R.lang, ctx: sentenceAt(text, +w.dataset.o, R.lang), book: R.id });
    }
    return;
  }
  const a = t.dataset.a, id = t.dataset.id;
  if (t.tagName === 'A') e.preventDefault();
  switch (a) {
    case 'tab': if (sheetOpen) closeLayer('sheet'); ui.tab = id; render(); window.scrollTo(0, 0); if (id === 'settings') refreshPushState(); break;
    case 'filter': ui.filter = id; render(); break;
    case 'add': $('#file').click(); break;
    case 'open': openBook(id); break;
    case 'imp-lang': importDialog.cur.d.lang = id; { const f = document.querySelector('form[data-form="import"]'); importDialog.cur.d.title = f.title.value; importDialog.cur.d.author = f.author.value; } importDialog.cur.paint(); break;
    case 'sheet-close': closeLayer('sheet'); break;
    case 'r-close': closeLayer('reader'); break;
    case 'r-menu': readerMenu(); break;
    case 'r-ch': goChapter(+id); break;
    case 'pg': pageTurn(+id); break;
    case 'eink': setEink(!EINK); break;
    case 'sc-add': scheduleEditor(null); break;
    case 'sc-edit': scheduleEditor(id); break;
    case 'sc-lang': scheduleEditor.cur.d.lang = id; { const f = document.querySelector('form[data-form="sched"]'); if (f) scheduleEditor.cur.d.time = f.time.value; } scheduleEditor.cur.paint(); break;
    case 'sc-day': { const c = scheduleEditor.cur.d; const n = +id; c.days = c.days.includes(n) ? c.days.filter(x => x !== n) : [...c.days, n]; const f = document.querySelector('form[data-form="sched"]'); if (f) c.time = f.time.value; scheduleEditor.err = ''; scheduleEditor.cur.paint(); break; }
    case 'sc-min': { const f = document.querySelector('form[data-form="sched"]'); if (f) scheduleEditor.cur.d.time = f.time.value; scheduleEditor.cur.d.min = +id; scheduleEditor.cur.paint(); break; }
    case 'sc-del': scheduleDelete(); break;
    case 'push-on': pushOn(); break;
    case 'push-off': pushOff(); break;
    case 'push-test': pushTest(); break;
    case 'native-notif': try { NATIVE.requestNotifications(); } catch (x) { } break;
    case 'r-goto': closeLayer('sheet'); setTimeout(() => goChapter(+id), 0); break;
    case 'fs': S.settings.font = Math.max(14, Math.min(30, S.settings.font + (+id))); setSetting('font', S.settings.font); break;
    case 'theme': setSetting('theme', id); break;
    case 'pinyin': setSetting('pinyin', !S.settings.pinyin); break;
    case 'book-del': {
      const b = curBook(); if (!b || !confirm('Убрать «' + b.title + '» с полки? Сохранённые слова останутся.')) break;
      b.del = true; b.u = now(); idb.del('books', b.id).catch(() => { }); save(300);
      closeLayer('sheet'); setTimeout(() => closeLayer('reader'), 30); break;
    }
    case 'goto-key': ui.tab = 'settings'; closeLayer('sheet'); if (R) setTimeout(() => closeLayer('reader'), 30); else render(); setTimeout(() => { const k = document.querySelector('input[name="key"]'); if (k) k.focus(); }, 120); break;
    case 'w-speak': case 'w-retry': case 'w-retr': case 'w-sent': case 'w-save': case 'w-known': case 'w-knownnew': case 'w-del': wordAction(a); break;
    case 'wl': ui.wl = id; render(); break;
    case 'ws': ui.ws = id; render(); break;
    case 'wopen': wordDetail(id); break;
    case 'd-speak': { const w = S.words[id]; if (w) speak(w.lemma, w.lang); break; }
    case 'd-known': case 'd-learn': case 'd-del': {
      const w = S.words[id]; if (!w) break;
      if (a === 'd-del') w.del = true; else { w.st = a === 'd-known' ? 'known' : 'learn'; if (a === 'd-learn') w.srs = { due: now(), ivl: 0, ease: 2.5, reps: 0, lapses: 0 }; }
      w.u = now(); save(); closeLayer('sheet'); setTimeout(render, 30); break;
    }
    case 'rv-start': startReview(id); break;
    case 'rv-show': RV.show = true; renderReview(); break;
    case 'rv-grade': gradeReview(+id); break;
    case 'rv-speak': { const w = RV && S.words[RV.q[0]]; if (w) speak(w.lemma, w.lang); break; }
    case 'rv-close': closeLayer('review'); break;
    case 'set': setSetting(t.dataset.k, id); break;
    case 'key-test': testKey(); break;
    case 'key-del': try { localStorage.removeItem(KEY_LS); } catch (x) { } keyMsg = 'Ключ удалён с этого устройства.'; render(); break;
    case 'auth-mode': auth.mode = id; auth.msg = ''; auth.info = ''; render(); break;
    case 'signout': signOut(); break;
    case 'sync-now': sync(); break;
    case 'export': exportBackup(); break;
    case 'import-backup': $('#backup').click(); break;
    case 'install': if (installPrompt) { installPrompt.prompt(); installPrompt = null; render(); } break;
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'file' && t.files.length) { const fs = Array.from(t.files); t.value = ''; importFiles(fs); }
  if (t.id === 'backup' && t.files.length) { importBackup(t.files[0]); t.value = ''; }
  if (t.dataset.a === 'set-model') setSetting('model', t.value);
  if (t.dataset.a === 'set-level') { S.settings.levels[t.dataset.id] = t.value; setSetting('levels', S.settings.levels); }
  if (t.name === 'tr' && t.form && t.form.dataset.form === 'edit-tr') { const w = S.words[t.form.dataset.id]; if (w) { w.tr = t.value.trim(); w.u = now(); save(); toast('Перевод сохранён'); } }
});
document.addEventListener('input', e => {
  if (e.target.id === 'wq') { ui.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $('#wq'); q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) { } }
});
document.addEventListener('submit', e => {
  const f = e.target; const k = f.dataset.form; if (!k) return; e.preventDefault();
  if (k === 'import') finishImport();
  if (k === 'sched') scheduleSave();
  if (k === 'key') { const v = f.elements.namedItem('key').value.trim(); try { if (v) localStorage.setItem(KEY_LS, v); else localStorage.removeItem(KEY_LS); } catch (x) { } keyMsg = v ? 'Ключ сохранён на этом устройстве.' : 'Ключ удалён.'; render(); if (v) testKey(); }
  if (k === 'edit-tr') { const w = S.words[f.dataset.id]; if (w) { w.tr = f.tr.value.trim(); w.u = now(); save(); toast('Перевод сохранён'); } }
  if (['signin', 'signup', 'forgot', 'newpass'].includes(k)) authSubmit(k);
});
document.addEventListener('keydown', e => {
  if (R && EINK && !sheetOpen && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); pageTurn(1); return; }
    if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); pageTurn(-1); return; }
  }
  if (e.key === 'Escape') { if (sheetOpen) closeLayer('sheet'); else if (RV) closeLayer('review'); else if (R) closeLayer('reader'); return; }
  if (RV && !sheetOpen && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    if (!RV.show && (e.key === ' ' || e.key === 'Enter') && RV.q.length) { e.preventDefault(); RV.show = true; renderReview(); }
    else if (RV.show && /^[1-4]$/.test(e.key)) gradeReview(+e.key - 1);
  }
});
async function testKey() {
  keyMsg = 'Проверяю ключ…'; render();
  try { await askClaude('Reply with: ok', 5); keyMsg = 'Ключ работает. Можно переводить.'; }
  catch (e) { keyMsg = e.message; }
  render();
}

/* ---------------- start ---------------- */
(async function start() {
  try { const st = await idb.get('kv', 'state'); if (st) S = normalize(st); } catch (e) { }
  applyTheme(); render();
  initSync();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
  syncNative(); openLangFromUrl();
})();
