'use strict';
/* «Между строк» — доработки без Claude и без ключей:
   частотность и HSK, офлайн-словарь CC-CEDICT, «где ещё в книге», перевод абзаца, цитаты и закладки,
   поиск, разворот на компьютере, новые карточки (выбор, сборка, диктант), повтор за диктором,
   порядок черт (Hanzi Writer), тоны на слух, польские таблицы форм из Викисловаря, цели, прогноз, календарь года.
   Подключается после learn.js. */

/* ================= 1. Частотность и HSK ================= */
const DATA = { freq: {}, hsk: null, ced: null, loading: {}, fail: {} };
// после неудачной загрузки (нет сети, файл недоступен) не повторяем запрос минуту
const failedRecently = k => DATA.fail[k] && now() - DATA.fail[k] < 60000;
const markFail = k => { DATA.fail[k] = now(); delete DATA.loading[k]; return null; };
const LEVEL_TOP = { A1: 600, A2: 1200, B1: 2500, B2: 5000, C1: 9000, C2: 15000 };
async function loadText(path) { const r = await fetch(path); if (!r.ok) throw new Error(path + ' ' + r.status); return r.text(); }
function ensureFreq(lang) {
  if (lang === 'zh') return ensureHsk();
  if (DATA.freq[lang]) return Promise.resolve(DATA.freq[lang]);
  if (failedRecently(lang)) return Promise.resolve(null);
  return DATA.loading[lang] || (DATA.loading[lang] = loadText('data/freq-' + lang + '.txt').then(t => {
    const m = new Map(); t.split('\n').forEach((w, i) => { if (w && !m.has(w)) m.set(w, i + 1); });
    DATA.freq[lang] = m; return m;
  }).catch(() => markFail(lang)));
}
function ensureHsk() {
  if (DATA.hsk) return Promise.resolve(DATA.hsk);
  if (failedRecently('hsk')) return Promise.resolve(null);
  return DATA.loading.hsk || (DATA.loading.hsk = loadText('data/hsk.tsv').then(t => {
    const m = new Map(); for (const line of t.split('\n')) { const [w, lv, py] = line.split('\t'); if (w) m.set(w, { lv: +lv, py }); }
    DATA.hsk = m; return m;
  }).catch(() => markFail('hsk')));
}
const freqReady = lang => lang === 'zh' ? !!DATA.hsk : !!DATA.freq[lang];
/** Метка частотности слова: { rank|lv, label, rare } */
function freqInfo(lang, ...keys) {
  if (lang === 'zh') {
    if (!DATA.hsk) return null;
    for (const k of keys) { const h = k && DATA.hsk.get(k); if (h) return { lv: h.lv, label: h.lv >= 7 ? 'HSK 7–9' : 'HSK ' + h.lv, rare: false }; }
    return { label: 'вне списков HSK', rare: true };
  }
  const m = DATA.freq[lang]; if (!m) return null;
  let r = Infinity; for (const k of keys) { if (!k) continue; const x = m.get(String(k).toLowerCase()); if (x && x < r) r = x; }
  if (r <= 1000) return { rank: r, label: 'одно из 1 000 самых частых', rare: false };
  if (r <= 3000) return { rank: r, label: 'частое — топ-3 000', rare: false };
  if (r <= 10000) return { rank: r, label: 'встречается нередко', rare: false };
  if (r <= 30000) return { rank: r, label: 'редкое — можно не учить, достаточно понимать', rare: true };
  return { label: 'очень редкое — можно не учить', rare: true };
}
/** Слова, которые на уровне пользователя скорее всего уже знакомы. */
const ASSUMED = {};
function assumedKnown(lang) {
  const lvl = S.settings.levels[lang];
  const key = lang + ':' + lvl;
  if (ASSUMED[key]) return ASSUMED[key];
  const s = new Set();
  if (lang === 'zh') { if (!DATA.hsk) return s; const n = +(String(lvl).match(/\d/) || [1])[0]; for (const [w, h] of DATA.hsk) if (h.lv <= n) s.add(w); }
  else { const m = DATA.freq[lang]; if (!m) return s; const top = LEVEL_TOP[lvl] || 2500; for (const [w, r] of m) if (r <= top) s.add(w); }
  return (ASSUMED[key] = s);
}
function effKnown(lang) {
  const s = knownSet(lang);
  if (freqReady(lang)) { const learn = savedKeys(lang); for (const w of assumedKnown(lang)) if (!learn.has(w)) s.add(w); }
  return s;
}
const covReady = lang => freqReady(lang) || knownCount(lang) >= MIN_KNOWN;

/* ================= 2. Офлайн-словарь китайского CC-CEDICT ================= */
function ensureCedict() {
  if (DATA.ced) return Promise.resolve(DATA.ced);
  if (failedRecently('ced')) return Promise.resolve(null);
  return DATA.loading.ced || (DATA.loading.ced = loadText('data/cedict.tsv').then(t => {
    const m = new Map(); for (const line of t.split('\n')) { const i = line.indexOf('\t'); if (i > 0) m.set(line.slice(0, i), line.slice(i + 1)); }
    DATA.ced = m; return m;
  }).catch(() => markFail('ced')));
}
function cedictEntries(w) {
  const raw = DATA.ced && DATA.ced.get(w); if (!raw) return [];
  return raw.split(' ¦ ').map(x => { const i = x.indexOf('|'); return { py: x.slice(0, i), defs: x.slice(i + 1) }; });
}
/** Разбор длинной строки на известные слова словаря (жадно по самому длинному). */
function cedictSegment(s) {
  const out = []; let i = 0;
  while (i < s.length) { let hit = ''; for (let L = Math.min(6, s.length - i); L >= 1; L--) { const w = s.slice(i, i + L); if (DATA.ced.has(w)) { hit = w; break; } } if (!hit) hit = s[i]; out.push(hit); i += hit.length; }
  return out;
}
async function cedictLookup(term) {
  await ensureCedict(); if (!DATA.ced) return null;
  let es = cedictEntries(term);
  if (!es.length && term.length > 1) { const parts = cedictSegment(term); es = parts.length > 1 ? [{ py: parts.map(p => (cedictEntries(p)[0] || {}).py || pinyinOf(p)).join(' '), defs: parts.map(p => p + ': ' + ((cedictEntries(p)[0] || {}).defs || '?').split(';')[0]).join(' · ') }] : []; }
  if (!es.length) return null;
  const cl = (es[0].defs.match(/CL:([^;]+)/) || [])[1];
  return { lemma: term, pos: '', tr: es[0].defs.replace(/;?\s*CL:[^;]+/, '').split(';').slice(0, 3).join(';').trim(), alt: es.slice(1).map(e => e.py + ': ' + e.defs.split(';')[0]).join(', '), note: '', py: es[0].py, hsk: '', src: 'basic', via: 'CC-CEDICT (англ.)', extra: cl ? { measure: cl.replace(/\[[^\]]*\]/g, m => ' (' + m.slice(1, -1) + ')').trim() } : {} };
}
function cedictHTML(term) {
  const es = cedictEntries(term);
  if (!es.length) return '';
  return `<details class="ced"><summary>Словарь CC-CEDICT</summary>${es.map(e => `<p><span class="w-py">${esc(e.py)}</span> ${esc(e.defs)}</p>`).join('')}</details>`;
}

/* ================= 3. Где ещё в книге ================= */
function bookIndex() {
  if (R.index) return R.index;
  const idx = new Map();
  R.c.chapters.forEach((ch, ci) => ch.p.forEach((text, pi) => {
    for (const tk of tokenize(text, R.lang)) { if (!tk.w) continue; const k = keyOf(tk.t, R.lang); let a = idx.get(k); if (!a) idx.set(k, a = []); a.push([ci, pi, tk.o, tk.t]); }
  }));
  return (R.index = idx);
}
function occurrences(o) {
  if (!R) return [];
  const idx = bookIndex(); const keys = new Set([keyOf(o.term, o.lang)]);
  const w = findWord(o.lang, o.term, o.data && o.data.lemma); if (w) { (w.forms || []).forEach(f => keys.add(f)); keys.add(keyOf(w.lemma, o.lang)); }
  if (o.data && o.data.lemma) keys.add(keyOf(o.data.lemma, o.lang));
  const out = []; for (const k of keys) for (const x of (idx.get(k) || [])) out.push(x);
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}
function moreInBookBtn(o) {
  if (!R || /\s/.test(o.term.trim())) return '';
  const n = occurrences(o).length;
  return n > 1 ? `<button class="btn ghost sm" data-a="w-more">Ещё в книге: ${n}</button>` : '';
}
function moreInBookHTML(o) {
  const occ = occurrences(o); const L = o.lang; const seen = new Set();
  const rows = [];
  for (const [ci, pi, off, form] of occ) {
    const s = sentenceAt(R.c.chapters[ci].p[pi], off, L); const key = ci + ':' + s; if (seen.has(key)) continue; seen.add(key);
    rows.push(`<li><button data-a="goto-occ" data-id="${ci}:${pi}"><span class="hint">${esc(R.c.chapters[ci].t || 'Глава ' + (ci + 1))}</span><span class="occ-s" lang="${L}">${highlight(s, form, L)}</span></button></li>`);
    if (rows.length >= 40) break;
  }
  return `<div class="w-head"><h2 style="flex:1"><span lang="${L}">${esc(o.term)}</span> в книге</h2><button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div>
    <p class="hint" style="margin:4px 0 10px">${occ.length} ${plural(occ.length, 'раз', 'раза', 'раз')} во всех формах. Нажми на предложение, чтобы перейти к нему.</p>
    <ul class="occ">${rows.join('')}</ul>`;
}
function gotoPara(ci, pi) {
  if (!R) return;
  if (R.ch !== ci) { goChapter(ci); }
  const rs = $('#rs'); const el = rs && rs.querySelector(`p[data-i="${pi}"]`);
  if (el) { if (R.spread) spreadScrollTo(el); else rs.scrollTop = el.offsetTop - 60; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }
  setTimeout(trackPosition, 50);
}

/* ================= 4. Перевод абзаца ================= */
let PARA = null;
async function openParagraph(pi) {
  if (!R) return; const text = R.c.chapters[R.ch].p[pi]; if (!text || !text.trim()) return;
  PARA = { pi, text, tr: '', busy: true, err: '' };
  showSheet(paraHTML(), { label: 'Абзац', onClose: () => { PARA = null; } });
  const ck = ['A', R.lang, S.settings.target, text].join('|');
  try {
    let tr = await idb.get('tr', ck).catch(() => null);
    if (!tr) { tr = (await basicTr(text, R.lang)).tr; idb.put('tr', ck, tr).catch(() => { }); }
    if (PARA && PARA.text === text) PARA.tr = tr;
  } catch (e) { if (PARA) PARA.err = navigator.onLine === false ? 'Нет интернета — перевод абзаца недоступен.' : 'Не получилось перевести абзац: сервис перевода не ответил.'; }
  if (PARA) { PARA.busy = false; updateSheet(paraHTML()); }
}
function paraHTML() {
  const L = R.lang;
  return `<div class="w-head"><h2 style="flex:1">Абзац</h2>${canSpeak ? `<button class="iconbtn" data-a="para-speak" aria-label="Послушать абзац">${I.speak}</button>` : ''}<button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div>
    <p class="para-orig${L === 'zh' ? ' zh' : ''}" lang="${L}">${esc(PARA.text)}</p>
    ${PARA.busy ? '<div class="skeleton"></div><div class="skeleton" style="width:70%"></div>' : PARA.err ? `<p class="formmsg">${esc(PARA.err)}</p>` : `<p class="para-tr">${esc(PARA.tr)}</p><p class="hint">Перевод через Google Переводчик, без Claude.</p>`}
    ${speechBlock(PARA.text, L, 'para')}`;
}
/* долгое нажатие на абзац (или правая кнопка мыши) */
let lpT = null;
document.addEventListener('pointerdown', e => {
  const p = e.target.closest && e.target.closest('#rt p[data-i]'); if (!p || !R || e.button > 0) return;
  const x = e.clientX, y = e.clientY;
  clearTimeout(lpT);
  lpT = setTimeout(() => { const sel = window.getSelection(); if (sel && !sel.isCollapsed) return; lpT = 'fired'; openParagraph(+p.dataset.i); }, 650);
  const cancel = ev => { if (Math.abs(ev.clientX - x) > 8 || Math.abs(ev.clientY - y) > 8 || ev.type !== 'pointermove') { if (lpT !== 'fired') clearTimeout(lpT); document.removeEventListener('pointermove', cancel); document.removeEventListener('pointerup', cancel); } };
  document.addEventListener('pointermove', cancel); document.addEventListener('pointerup', cancel);
});
document.addEventListener('click', e => { if (lpT === 'fired') { lpT = null; e.stopPropagation(); e.preventDefault(); } }, true);
document.addEventListener('contextmenu', e => { const p = e.target.closest && e.target.closest('#rt p[data-i]'); if (p && R && !(window.getSelection() || {}).toString()) { e.preventDefault(); clearTimeout(lpT); lpT = null; openParagraph(+p.dataset.i); } });

/* ================= 5. Цитаты и закладки ================= */
function addQuote(text, pi) {
  const b = curBook(); if (!b) return;
  const id = 'q' + now().toString(36) + Math.random().toString(36).slice(2, 5);
  const q = S.quotes[id] = { id, book: b.id, title: b.title, lang: b.lang, c: R.ch, p: pi, text: text.slice(0, 600), tr: '', at: now(), u: now() };
  save(); toast('Цитата сохранена');
  basicTr(q.text, b.lang).then(t => { const x = S.quotes[id]; if (x) { x.tr = t.tr; x.u = now(); save(); } }).catch(() => { });
}
function liveQuotes() { return Object.values(S.quotes || {}).filter(q => !q.del).sort((a, b) => b.at - a.at); }
function quotesShelfHTML() {
  const qs = liveQuotes(); if (!qs.length) return '';
  return `<section class="sec"><div class="sec-h"><h2>Цитаты</h2><button class="btn ghost sm" data-a="quotes-all">Все ${qs.length}</button></div>
    <div class="quotes">${qs.slice(0, 3).map(quoteCard).join('')}</div></section>`;
}
function quoteCard(q) {
  return `<figure class="quote"><blockquote lang="${q.lang}">${esc(q.text)}</blockquote>${q.tr ? `<p class="hint">${esc(q.tr)}</p>` : ''}
    <figcaption><button class="btn ghost sm" data-a="quote-open" data-id="${esc(q.id)}">${esc(q.title)}</button><button class="btn ghost sm danger" data-a="quote-del" data-id="${esc(q.id)}" aria-label="Удалить цитату">✕</button></figcaption></figure>`;
}
function quotesSheet() { showSheet(`<div class="w-head"><h2 style="flex:1">Цитаты</h2><button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div><div class="quotes">${liveQuotes().map(quoteCard).join('')}</div>`, { label: 'Цитаты' }); }
function bookmarksHTML() {
  const b = curBook(); const ms = (b.marks || []);
  return `<h3 style="margin:14px 0 6px">Закладки</h3>
    ${ms.length ? `<ul class="toc">${ms.map((m, i) => `<li><button data-a="mark-go" data-id="${i}"><span class="n">${m.c + 1}</span><span lang="${b.lang}">${esc(m.label)}</span></button></li>`).join('')}</ul>` : '<p class="hint" style="margin:0 0 6px">Закладок пока нет.</p>'}
    <button class="btn sm" data-a="mark-add">Закладка на этом месте</button>`;
}
function addBookmark() {
  const b = curBook(); trackPosition();
  const text = R.c.chapters[R.ch].p[R.p] || '';
  (b.marks = b.marks || []).push({ c: R.ch, p: R.p, label: text.slice(0, 70) + (text.length > 70 ? '…' : ''), at: now() });
  b.u = now(); save(); toast('Закладка добавлена');
}

/* ================= 6. Поиск по книге ================= */
function searchHTML(q) {
  if (!R) return '';
  const res = [];
  if (q && q.trim().length >= 2) {
    const nq = fold(q);
    R.c.chapters.forEach((ch, ci) => ch.p.forEach((text, pi) => { if (res.length < 60 && fold(text).includes(nq)) res.push([ci, pi, text]); }));
  }
  return `<ul class="occ">${res.map(([ci, pi, text]) => { const i = fold(text).indexOf(fold(q)); const st = Math.max(0, i - 50); return `<li><button data-a="goto-occ" data-id="${ci}:${pi}"><span class="hint">${esc(R.c.chapters[ci].t || 'Глава ' + (ci + 1))}</span><span class="occ-s" lang="${R.lang}">${st ? '…' : ''}${esc(text.slice(st, st + 160))}${text.length > st + 160 ? '…' : ''}</span></button></li>`; }).join('')}</ul>
    ${q && q.trim().length >= 2 && !res.length ? '<p class="hint">Ничего не нашлось.</p>' : ''}`;
}

/* ================= 7. Разворот на компьютере ================= */
const SPREAD_LS = 'mezhdu-spread';
let SPREAD = (() => { try { return localStorage.getItem(SPREAD_LS) === '1'; } catch (e) { return false; } })();
const spreadOn = () => SPREAD && window.innerWidth >= 1000;
const SPREAD_GAP = 72;
function spreadStep() { const rs = $('#rs'); return rs ? rs.clientWidth + SPREAD_GAP : 0; }
function spreadScrollTo(el) { const rs = $('#rs'); const st = spreadStep(); if (!rs || !st) return; rs.scrollLeft = Math.floor((el.offsetLeft + 4) / st) * st; }
function spreadTurn(d) {
  const rs = $('#rs'); const st = spreadStep();
  if (d > 0) { if (rs.scrollLeft + rs.clientWidth >= rs.scrollWidth - 8) { if (R.ch < R.c.chapters.length - 1) goChapter(R.ch + 1); else toast('Это конец книги'); return true; } rs.scrollLeft += st; }
  else { if (rs.scrollLeft <= 4) { if (R.ch > 0) { goChapter(R.ch - 1); const r2 = $('#rs'); r2.scrollLeft = Math.floor(r2.scrollWidth / spreadStep()) * spreadStep(); } return true; } rs.scrollLeft = Math.max(0, rs.scrollLeft - st); }
  setTimeout(trackPosition, 30); act.last = now(); return true;
}
function spreadTrack() {
  const rs = $('#rs'); const left = rs.getBoundingClientRect().left;
  let p = 0; for (const el of rs.querySelectorAll('#rt p')) { const r = el.getBoundingClientRect(); if (r.right > left + 10 && r.height > 0) { p = +el.dataset.i; break; } }
  return { p, atEnd: rs.scrollLeft + rs.clientWidth >= rs.scrollWidth - 8 };
}
function setSpread(on) { SPREAD = on; try { localStorage.setItem(SPREAD_LS, on ? '1' : '0'); } catch (e) { } if (R) { trackPosition(); renderReader(R.p); } }
let wheelT = 0;
document.addEventListener('wheel', e => { if (!R || !R.spread || !e.target.closest('#rs')) return; e.preventDefault(); if (now() - wheelT < 350) return; wheelT = now(); spreadTurn(e.deltaY > 0 || e.deltaX > 0 ? 1 : -1); }, { passive: false });
window.addEventListener('resize', () => { if (R && R.spread !== spreadOn()) { trackPosition(); renderReader(R.p); } });

/* ================= 8. Новые карточки: выбор, сборка предложения, диктант ================= */
const EXTRA_CARDS = ['choice', 'order', 'dictation'];
function shuffle(a, seed) { a = a.slice(); let h = seed || 1; for (let i = a.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) & 0x7fffffff; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function choiceOptions(w) {
  const others = liveWords(w.lang).filter(x => x.id !== w.id && x.tr && x.tr !== w.tr).map(x => x.tr);
  const uniq = [...new Set(others)]; if (uniq.length < 3) return null;
  const pick = shuffle(uniq, hashStr(w.id + (w.srs.reps || 0))).slice(0, 3);
  return shuffle([w.tr, ...pick], hashStr(w.id) + 7);
}
function orderPieces(w, c) {
  if (!c) return null;
  const toks = tokenize(c.s, w.lang).filter(t => t.w || /[,.!?;:。，！？]/.test(t.t.trim()) && t.t.trim());
  let words = toks.filter(t => t.w).map(t => t.t);
  if (words.length < 3) return null;
  if (words.length > 9) { const i = Math.max(0, words.findIndex(x => keyOf(x, w.lang) === keyOf(c.f || '', w.lang))); const st = Math.max(0, Math.min(words.length - 8, i - 3)); words = words.slice(st, st + 8); }
  return words;
}
function extraCardTypes(w, reps, c) {
  const t = [];
  if (reps >= 1 && w.tr && choiceOptions(w)) t.push('choice');
  if (reps >= 2 && orderPieces(w, c)) t.push('order');
  if (reps >= 4 && canSpeak && c && w.lang !== 'zh') t.push('dictation');
  return t;
}
function orderCardHTML(w, c) {
  const L = w.lang;
  if (!RV.order) { const pcs = orderPieces(w, c); RV.order = { target: pcs, pool: shuffle(pcs.map((x, i) => i), hashStr(w.id) + 3), built: [] }; if (RV.order.pool.every((x, i) => x === i)) RV.order.pool.reverse(); }
  const o = RV.order; const sep = L === 'zh' ? '' : ' ';
  return `<p class="card-kind">Собери предложение из книги</p>${c.tr ? `<p class="hint">${esc(c.tr)}</p>` : `<p class="hint">Слово: ${esc(w.lemma)} — ${esc(w.tr || '')}</p>`}
    <div class="ord-built${L === 'zh' ? ' zh' : ''}" lang="${L}">${o.built.length ? o.built.map((i, k) => `<button class="ord-w on" data-a="ord-undo" data-id="${k}">${esc(o.target[i])}</button>`).join(sep) : '<span class="hint">Нажимай на слова по порядку</span>'}</div>
    ${RV.show ? '' : `<div class="ord-pool" lang="${L}">${o.pool.map(i => o.built.includes(i) ? '' : `<button class="ord-w" data-a="ord-pick" data-id="${i}">${esc(o.target[i])}</button>`).join('')}</div>`}
    ${!RV.show && o.built.length === o.target.length ? '<button class="btn" data-a="ord-check">Проверить</button>' : ''}`;
}
function checkOrder() {
  const o = RV.order; const got = o.built.map(i => o.target[i]).join(' '), want = o.target.join(' ');
  RV.check = got === want ? 'ok' : fold(got) === fold(want) ? 'almost' : 'no'; RV.show = true; renderReview();
}
function dictationHTML(w, c) {
  return `<p class="card-kind">Диктант: послушай и напиши предложение</p><button class="btn primary" data-a="rv-speak">${I.speak}Слушать</button>
    ${RV.show ? `<div class="dict-diff" lang="${w.lang}">${RV.diff || ''}</div>` : `<form data-form="rv-dict" class="rv-answer"><label class="sr" for="rv-dict">Предложение</label><input class="in" id="rv-dict" name="a" autocomplete="off" autocapitalize="off" spellcheck="false" lang="${w.lang}" placeholder="Напиши, что услышала"><button class="btn" type="submit">Проверить</button></form>`}`;
}
/** Сравнение по словам: что совпало, что пропущено. Возвращает {html, score} */
function wordDiff(target, heard, lang) {
  const tw = tokenize(target, lang).filter(t => t.w).map(t => t.t);
  const hw = new Set(tokenize(heard || '', lang).filter(t => t.w).map(t => fold(t.t)));
  const hwStrict = new Set(tokenize(heard || '', lang).filter(t => t.w).map(t => t.t.toLowerCase()));
  let ok = 0, near = 0;
  const html = tw.map(t => { if (hwStrict.has(t.toLowerCase())) { ok++; return `<span class="d-ok">${esc(t)}</span>`; } if (hw.has(fold(t))) { near++; return `<span class="d-near">${esc(t)}</span>`; } return `<span class="d-miss">${esc(t)}</span>`; }).join(lang === 'zh' ? '' : ' ');
  return { html, score: tw.length ? (ok + near * 0.7) / tw.length : 0, ok, near, total: tw.length };
}
function extraCardFront(T, w, c) {
  if (T === 'choice') {
    const opts = RV.opts || (RV.opts = choiceOptions(w));
    return `<p class="card-kind">Выбери перевод</p><div class="term${w.lang === 'zh' ? ' zh' : ''}" lang="${w.lang}">${esc(w.lemma)}</div>${c ? `<div class="ctx${w.lang === 'zh' ? ' zh' : ''}" lang="${w.lang}">${highlight(c.s, c.f, w.lang)}</div>` : ''}
      <div class="choices">${opts.map((o, i) => `<button class="btn choice${RV.show ? (o === w.tr ? ' right' : RV.picked === i ? ' wrong' : '') : ''}" data-a="rv-choice" data-id="${i}"${RV.show ? ' disabled' : ''}>${esc(o)}</button>`).join('')}</div>`;
  }
  if (T === 'order') return orderCardHTML(w, c);
  if (T === 'dictation') return dictationHTML(w, c);
  return '';
}

/* ================= 9. Повторить за диктором ================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const canListen = !!SR && !NATIVE;
const SPEECH = {};
function speechBlock(text, lang, key) {
  if (!canListen || !text) return '';
  const s = SPEECH[key];
  return `<div class="speech" id="speech-${key}">${s && s.busy ? '<p class="hint">Слушаю… скажи предложение вслух</p>' : `<button class="btn ghost sm" data-a="say" data-id="${key}">🎙 Повторить за диктором</button>`}
    ${s && s.res ? `<div class="dict-diff" lang="${lang}">${s.res.html}</div><p class="hint">${s.res.total ? Math.round(s.res.score * 100) + '% слов распознано' : ''}${s.heard ? ' · услышано: «' + esc(s.heard) + '»' : ''}</p>` : ''}${s && s.err ? `<p class="formmsg">${esc(s.err)}</p>` : ''}</div>`;
}
function listenOnce(lang) {
  return new Promise((resolve, reject) => {
    const r = new SR(); r.lang = LANGS[lang].tts; r.interimResults = false; r.maxAlternatives = 1;
    let done = false;
    r.onresult = e => { done = true; resolve(e.results[0][0].transcript); };
    r.onerror = e => { done = true; reject(new Error(e.error === 'not-allowed' ? 'Нет доступа к микрофону — разреши его в настройках браузера.' : e.error === 'no-speech' ? 'Ничего не услышала, попробуй ещё раз.' : 'Распознавание не сработало: ' + e.error)); };
    r.onend = () => { if (!done) reject(new Error('Ничего не услышала, попробуй ещё раз.')); };
    try { r.start(); } catch (e) { reject(e); }
  });
}
async function sayAndCheck(key, text, lang, repaint) {
  SPEECH[key] = { busy: true }; repaint();
  try { const heard = await listenOnce(lang); SPEECH[key] = { heard, res: wordDiff(text, heard, lang) }; }
  catch (e) { SPEECH[key] = { err: e.message }; }
  repaint();
}

/* ================= 10. Мини-повторение перед главой ================= */
function miniReviewBtn() {
  const n = reviewQueue(R.lang).length;
  return n ? `<button class="btn sm primary" data-a="mini-review">Повторить ${Math.min(5, n)} ${plural(Math.min(5, n), 'слово', 'слова', 'слов')} перед чтением</button>` : '';
}

/* ================= 11. Порядок черт (Hanzi Writer) ================= */
let HW_LOADING = null;
function ensureHanziWriter() {
  if (window.HanziWriter) return Promise.resolve(window.HanziWriter);
  return HW_LOADING || (HW_LOADING = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/hanzi-writer@3.7.3/dist/hanzi-writer.min.js'; s.onload = () => res(window.HanziWriter); s.onerror = () => { HW_LOADING = null; rej(new Error('Не загрузилась библиотека порядка черт — нужен интернет.')); }; document.head.appendChild(s); }));
}
let STROKES = null;
async function openStrokes(word) {
  const chars = Array.from(word).filter(ch => isHan(ch)).slice(0, 4);
  if (!chars.length) return;
  STROKES = { chars, i: 0, mode: 'anim' };
  showSheet(strokesHTML(), { label: 'Порядок черт', onClose: () => { STROKES = null; } });
  try { await ensureHanziWriter(); drawStroke(); } catch (e) { const el = $('#hw-box'); if (el) el.innerHTML = `<p class="formmsg">${esc(e.message)}</p>`; }
}
function strokesHTML() {
  const s = STROKES;
  return `<div class="w-head"><h2 style="flex:1">Порядок черт</h2><button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div>
    ${s.chars.length > 1 ? `<div class="chips" role="group" aria-label="Иероглиф">${s.chars.map((ch, i) => `<button class="chip" data-a="hw-char" data-id="${i}" aria-pressed="${i === s.i}" lang="zh">${esc(ch)}</button>`).join('')}</div>` : ''}
    <div class="hw-wrap"><div id="hw-box" class="hw-box" aria-label="Иероглиф ${esc(s.chars[s.i])}"></div><p class="w-py" style="text-align:center">${pyHTML(s.chars[s.i], pinyinOf(s.chars[s.i]))}</p></div>
    <div class="row" style="justify-content:center"><button class="btn" data-a="hw-anim">Показать ещё раз</button><button class="btn primary" data-a="hw-quiz">Прописать самой</button></div>
    <p class="hint" id="hw-msg" style="text-align:center">${s.mode === 'quiz' ? 'Веди черты пальцем или мышью по порядку.' : ''}</p>`;
}
function drawStroke() {
  const s = STROKES; const box = $('#hw-box'); if (!s || !box) return;
  box.innerHTML = '';
  const dark = document.documentElement.dataset.theme === 'night';
  s.writer = HanziWriter.create(box, s.chars[s.i], { width: 220, height: 220, padding: 10, showOutline: true, strokeColor: dark ? '#ECE2D3' : '#3A2D20', outlineColor: dark ? '#433829' : '#E0D5C3', highlightColor: '#0F4C55', drawingColor: '#0F4C55', strokeAnimationSpeed: 1.2, delayBetweenStrokes: 250 });
  if (s.mode === 'quiz') s.writer.quiz({ onComplete: d => { const m = $('#hw-msg'); if (m) m.textContent = d.totalMistakes ? 'Готово, ошибок: ' + d.totalMistakes : 'Отлично, без ошибок!'; } });
  else s.writer.animateCharacter();
}

/* ================= 12. Тоны на слух ================= */
let TONE = null;
function toneSource() {
  const pool = [];
  for (const w of liveWords('zh')) for (const ch of Array.from(w.lemma)) if (isHan(ch)) pool.push(ch);
  if (DATA.hsk) for (const [w, h] of DATA.hsk) if (h.lv === 1) for (const ch of Array.from(w)) if (isHan(ch)) pool.push(ch);
  return [...new Set(pool)].filter(ch => { const t = toneNums(ch)[0]; return t >= 1 && t <= 4; });
}
async function startTones() {
  await ensureHsk();
  const pool = shuffle(toneSource(), now() % 997).slice(0, 10);
  if (!pool.length) { toast('Для тренировки нужны китайские слова'); return; }
  TONE = { pool, i: 0, score: 0, ans: null };
  showSheet(toneHTML(), { label: 'Тоны на слух', onClose: () => { TONE = null; } });
  setTimeout(toneSpeak, 200);
}
function toneSpeak() { if (TONE && TONE.pool[TONE.i]) speakAsync(TONE.pool[TONE.i], 'zh', 0.8); }
function toneBase(ch) { try { return pinyinPro.pinyin(ch, { toneType: 'none' }); } catch (e) { return ''; } }
function toneMarks(base) {
  const v = (base.match(/[aeiouü]/g) || []); if (!v.length) return [1, 2, 3, 4].map(() => base);
  const order = ['a', 'e', 'o']; let tgt = order.find(x => base.includes(x)); if (!tgt) tgt = base.includes('iu') ? 'u' : v[v.length - 1];
  const M = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', ü: 'ǖǘǚǜ' };
  const i = tgt === 'u' && base.includes('iu') ? base.lastIndexOf('u') : base.indexOf(tgt);
  return [0, 1, 2, 3].map(t => base.slice(0, i) + M[tgt][t] + base.slice(i + 1));
}
function toneHTML() {
  const t = TONE;
  if (t.i >= t.pool.length) return `<div class="w-head"><h2 style="flex:1">Тоны на слух</h2><button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div><p class="tone-score">${t.score} из ${t.pool.length}</p><p class="hint" style="text-align:center">${t.score >= 8 ? 'Отличный слух на тоны!' : 'Тоны тренируются — повторяй по 10 слогов в день.'}</p><div class="row" style="justify-content:center"><button class="btn primary" data-a="tone-again">Ещё 10</button></div>`;
  const ch = t.pool[t.i]; const base = toneBase(ch); const marks = toneMarks(base); const right = toneNums(ch)[0];
  return `<div class="w-head"><h2 style="flex:1">Тоны на слух</h2><span class="hint">${t.i + 1} / ${t.pool.length}</span><button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div>
    <div class="tone-q"><button class="btn primary" data-a="tone-play">${I.speak}Послушать</button></div>
    <div class="choices tones">${marks.map((m, k) => `<button class="btn choice t${k + 1}${t.ans != null ? (String(k + 1) === right ? ' right' : t.ans === k ? ' wrong' : '') : ''}" data-a="tone-pick" data-id="${k}"${t.ans != null ? ' disabled' : ''}>${esc(m)}<small>${k + 1}-й тон</small></button>`).join('')}</div>
    ${t.ans != null ? `<p class="tone-res"><span class="tone-ch" lang="zh">${esc(ch)}</span> ${pyHTML(ch, pinyinOf(ch))}</p><div class="row" style="justify-content:center"><button class="btn primary" data-a="tone-next">Дальше</button></div>` : ''}`;
}

/* ================= 13. Польские таблицы форм из Викисловаря ================= */
const TBL_RU = { nominative: 'именительный', genitive: 'родительный', dative: 'дательный', accusative: 'винительный', instrumental: 'творительный', locative: 'предложный', vocative: 'звательный', singular: 'ед. ч.', plural: 'мн. ч.', masculine: 'муж.', feminine: 'жен.', neuter: 'ср.', infinitive: 'инфинитив', present: 'настоящее', past: 'прошедшее', future: 'будущее', imperative: 'повелительное', conditional: 'условное', 'virile': 'муж.-личн.', 'nonvirile': 'не муж.-личн.', person: 'лицо', tense: 'время', 'active adjectival participle': 'действ. причастие', 'passive adjectival participle': 'страд. причастие', 'contemporary adverbial participle': 'деепричастие наст.', 'anterior adverbial participle': 'деепричастие прош.', 'verbal noun': 'отглаг. сущ.', impersonal: 'безличная форма', case: 'падеж', 'animate': 'одуш.', 'inanimate': 'неодуш.' };
function ruLabel(s) { const k = s.trim().toLowerCase(); if (TBL_RU[k]) return TBL_RU[k]; return s.replace(/\b(nominative|genitive|dative|accusative|instrumental|locative|vocative|singular|plural|masculine|feminine|neuter|infinitive|present|past|future|imperative|conditional|person|tense|virile|nonvirile)\b/gi, m => TBL_RU[m.toLowerCase()] || m).replace(/\b(1st|2nd|3rd)\b/g, m => m[0] + '-е'); }
async function plTable(lemma) {
  const ck = 'TBL|pl|' + lemma;
  const hit = await idb.get('tr', ck).catch(() => null); if (hit) return hit;
  const r = await fetch('https://en.wiktionary.org/api/rest_v1/page/html/' + encodeURIComponent(lemma));
  if (!r.ok) throw new Error(r.status === 404 ? 'В Викисловаре нет статьи «' + lemma + '».' : 'Викисловарь не ответил.');
  const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
  const h2 = [...doc.querySelectorAll('h2')].find(h => (h.id || h.textContent).trim().toLowerCase() === 'polish');
  if (!h2) throw new Error('В Викисловаре нет польского «' + lemma + '».');
  let section = h2.closest('section');
  if (!section || section.querySelectorAll('h2').length > 1) { section = doc.createElement('div'); for (let n = h2.nextElementSibling; n && n.tagName !== 'H2' && !n.querySelector('h2'); n = n.nextElementSibling) section.appendChild(n.cloneNode(true)); }
  const tables = [...section.querySelectorAll('table')].filter(t => /nominative|infinitive|genitive/i.test(t.textContent) && t.querySelectorAll('td').length >= 6);
  if (!tables.length) throw new Error('Для «' + lemma + '» в Викисловаре нет таблицы форм.');
  const t = tables[0].cloneNode(true);
  t.querySelectorAll('a').forEach(a => a.replaceWith(doc.createTextNode(a.textContent)));
  [t, ...t.querySelectorAll('*')].forEach(el => { for (const at of [...el.attributes]) if (!['rowspan', 'colspan'].includes(at.name)) el.removeAttribute(at.name); });
  t.querySelectorAll('th').forEach(th => { th.textContent = ruLabel(th.textContent); });
  t.querySelectorAll('sup, style, script, link').forEach(x => x.remove());
  const kind = /conjugat|infinitive/i.test(tables[0].textContent) ? 'Спряжение' : 'Склонение';
  const out = { kind, html: t.outerHTML.replace(/<table>/, '<table class="infl">') };
  idb.put('tr', ck, out).catch(() => { });
  return out;
}
async function openPlTable(lemma) {
  showSheet(`<div class="w-head"><h2 style="flex:1" lang="pl">${esc(lemma)}</h2><button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div><div class="skeleton"></div><div class="skeleton" style="width:60%"></div>`, { label: 'Таблица форм' });
  try { const t = await plTable(lemma); updateSheet(`<div class="w-head"><h2 style="flex:1">${t.kind}: <span lang="pl">${esc(lemma)}</span></h2><button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div><div class="infl-wrap" lang="pl">${t.html}</div><p class="hint">Источник: Викисловарь (CC BY-SA).</p>`); }
  catch (e) { updateSheet(`<div class="w-head"><h2 style="flex:1" lang="pl">${esc(lemma)}</h2><button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div><p class="formmsg">${esc(navigator.onLine === false ? 'Нет интернета.' : e.message)}</p>`); }
}

/* ================= 14–15. Цели, прогноз, календарь года ================= */
function langPace(lang, days) {
  days = days || 14; let sum = 0; const d = new Date();
  for (let i = 0; i < days; i++) { const k = dayKey(d); for (const e of Object.values(S.log[k] || {})) sum += e['w_' + lang] || 0; d.setDate(d.getDate() - 1); }
  return sum / days;
}
function bookEta(b) {
  const left = Math.max(0, (b.words || 0) - (b.read || 0)); if (!left || !b.last) return null;
  const pace = langPace(b.lang); if (pace < 20) return null;
  const days = Math.ceil(left / pace); const d = new Date(); d.setDate(d.getDate() + days);
  return { days, date: d };
}
const fmtDate = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
function etaLabel(b) { const e = bookEta(b); return e ? 'дочитаешь ≈ ' + fmtDate(e.date) : ''; }
function liveGoals() { return Object.values(S.goals || {}).filter(g => !g.del).sort((a, b) => a.at - b.at); }
function goalProgress(g) {
  if (g.type === 'words') { const now_ = knownCount(g.lang); const done = Math.max(0, now_ - g.start); return { done, total: g.n, frac: Math.min(1, done / g.n), text: `+${fmtNum(done)} из ${fmtNum(g.n)} знакомых слов` }; }
  const b = S.books[g.book]; if (!b || b.del) return { done: 0, total: 1, frac: 0, text: 'книга убрана с полки' };
  return { done: b.pct || 0, total: 1, frac: b.pct || 0, text: 'прочитано ' + pctLabel(b) + (etaLabel(b) ? ' · ' + etaLabel(b) : '') };
}
function goalsHTML() {
  const gs = liveGoals();
  return `<section class="sec" id="goals"><div class="sec-h"><h2>Цели</h2><button class="btn ghost sm" data-a="goal-add">${I.plus}Новая цель</button></div>
    ${gs.length ? `<div class="goals">${gs.map(g => { const p = goalProgress(g); const due = g.due ? new Date(g.due) : null; const late = due && p.frac < 1 && due < new Date();
      return `<div class="goal-c${p.frac >= 1 ? ' done' : ''}"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><b>${esc(goalTitle(g))}</b><button class="btn ghost sm" data-a="goal-del" data-id="${esc(g.id)}" aria-label="Удалить цель">✕</button></div>
        <div class="bar" aria-hidden="true"><i style="width:${Math.round(p.frac * 100)}%"></i></div><p class="hint" style="margin:0">${p.frac >= 1 ? 'Цель достигнута! ' : ''}${esc(p.text)}${due ? ` · до ${fmtDate(due)}${late ? ' — срок прошёл' : ''}` : ''}</p></div>`; }).join('')}</div>`
    : '<p class="hint" style="margin:0">Например: «+500 знакомых польских слов к концу цикла» или «дочитать книгу до декабря».</p>'}
  </section>`;
}
function goalTitle(g) { return g.type === 'words' ? `${LANGS[g.lang].ru}: +${fmtNum(g.n)} слов` : `Дочитать «${(S.books[g.book] || {}).title || 'книгу'}»`; }
function goalEditor() {
  const books = liveBooks();
  const d = goalEditor.d = goalEditor.d || { type: 'words', lang: (books[0] || {}).lang || 'pl', n: 500, book: (books[0] || {}).id || '', due: '' };
  showSheet(`<h2 style="margin-bottom:12px">Новая цель</h2><form data-form="goal">
    <div class="f">Что<div class="seg" style="margin-top:6px" role="group" aria-label="Тип цели"><button type="button" data-a="goal-type" data-id="words" aria-pressed="${d.type === 'words'}">Знакомые слова</button><button type="button" data-a="goal-type" data-id="book" aria-pressed="${d.type === 'book'}"${books.length ? '' : ' disabled'}>Дочитать книгу</button></div></div>
    ${d.type === 'words' ? `<div class="f">Язык<div class="seg" style="margin-top:6px" role="group" aria-label="Язык">${Object.keys(LANGS).map(l => `<button type="button" data-a="goal-lang" data-id="${l}" aria-pressed="${d.lang === l}">${LANGS[l].ru}</button>`).join('')}</div></div>
      <label class="f">Сколько новых знакомых слов<input class="in" type="number" name="n" min="10" step="10" value="${d.n}"></label>`
    : `<label class="f">Книга<select class="in" name="book">${books.map(b => `<option value="${b.id}"${b.id === d.book ? ' selected' : ''}>${esc(b.title)}</option>`).join('')}</select></label>`}
    <label class="f">Срок (необязательно)<input class="in" type="date" name="due" value="${esc(d.due)}"></label>
    <div class="row"><button class="btn primary" type="submit">Поставить цель</button><button class="btn ghost" type="button" data-a="sheet-close">Отмена</button></div></form>`, { center: true, label: 'Новая цель', onClose: () => { goalEditor.d = null; } });
}
function goalSave(f) {
  const d = goalEditor.d; const id = 'g' + now().toString(36);
  const g = { id, type: d.type, at: now(), u: now(), due: f.due.value || '' };
  if (d.type === 'words') { g.lang = d.lang; g.n = Math.max(10, +f.n.value || 500); g.start = knownCount(d.lang); } else g.book = f.book.value;
  S.goals[id] = g; save(); goalEditor.d = null; closeLayer('sheet'); setTimeout(render, 30); toast('Цель поставлена');
}
function yearHTML() {
  const goal = S.settings.goal; const end = new Date(); end.setHours(0, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - 364 - ((start.getDay() + 6) % 7));
  const cells = []; let active = 0, total = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) { const t = dayTotals(dayKey(d)); const m = t.min; total += m; if (m >= 1 || t.rev) active++; const lv = m <= 0 && !t.rev ? 0 : m < goal / 2 ? 1 : m < goal ? 2 : 3; cells.push(`<i class="y${lv}" title="${dayKey(d)}: ${Math.round(m)} мин"></i>`); }
  return `<section class="sec"><div class="sec-h"><h2>Год</h2><span class="hint">${active} ${plural(active, 'день', 'дня', 'дней')} с занятиями · ${fmtMin(total)}</span></div>
    <div class="panel year-wrap"><div class="year" role="img" aria-label="Календарь занятий за год: ${active} дней с занятиями">${cells.join('')}</div>
    <div class="year-leg hint"><span>меньше</span><i class="y0"></i><i class="y1"></i><i class="y2"></i><i class="y3"></i><span>цель дня</span></div></div></section>`;
}

/* ================= обработчики ================= */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]'); if (!t) return;
  const a = t.dataset.a, id = t.dataset.id;
  switch (a) {
    case 'w-more': if (CUR) updateSheet(moreInBookHTML(CUR)); break;
    case 'goto-occ': { const [ci, pi] = id.split(':').map(Number); closeLayer('sheet'); setTimeout(() => gotoPara(ci, pi), 60); break; }
    case 'w-para': if (CUR && R && CUR.pi != null) { const pi = CUR.pi; closeLayer('sheet'); setTimeout(() => openParagraph(pi), 60); } break;
    case 'para-speak': if (PARA) speakAsync(PARA.text, R.lang, S.settings.rate); break;
    case 'say': {
      if (id === 'para' && PARA) sayAndCheck('para', PARA.text, R.lang, () => PARA && updateSheet(paraHTML()));
      else if (id === 'word' && CUR) sayAndCheck('word', CUR.ctx, CUR.lang, () => { const el = $('#speech-word'); if (el && CUR) el.outerHTML = speechBlock(CUR.ctx, CUR.lang, 'word'); });
      else if (id === 'rv' && RV) { const w = S.words[RV.q[0]]; const c = pickCtx(w); sayAndCheck('rv', c ? c.s : w.lemma, w.lang, renderReview); }
      break;
    }
    case 'quote-open': { const q = S.quotes[id]; if (!q) break; const b = S.books[q.book]; if (!b || b.del) { toast('Книги уже нет на полке'); break; } if (sheetOpen) closeLayer('sheet'); b.pos = { c: q.c, p: q.p }; setTimeout(() => openBook(q.book), 60); break; }
    case 'quote-del': { const q = S.quotes[id]; if (q) { q.del = true; q.u = now(); save(); if (sheetOpen) quotesSheet(); else render(); } break; }
    case 'quotes-all': quotesSheet(); break;
    case 'mark-add': addBookmark(); readerMenu(); break;
    case 'mark-go': { const m = curBook().marks[+id]; closeLayer('sheet'); setTimeout(() => gotoPara(m.c, m.p), 60); break; }
    case 'spread': setSpread(!SPREAD); if (sheetOpen && R) readerMenu(); else render(); break;
    case 'rv-choice': { const w = S.words[RV.q[0]]; RV.picked = +id; RV.check = RV.opts[+id] === w.tr ? 'ok' : 'no'; RV.show = true; renderReview(); break; }
    case 'ord-pick': RV.order.built.push(+id); renderReview(); break;
    case 'ord-undo': RV.order.built.splice(+id, 1); renderReview(); break;
    case 'ord-check': checkOrder(); break;
    case 'mini-review': startReview(R.lang, 5); break;
    case 'w-strokes': if (CUR) { const term = CUR.data && CUR.data.lemma || CUR.term; closeLayer('sheet'); setTimeout(() => openStrokes(term), 60); } break;
    case 'd-strokes': { const w = S.words[id]; if (w) { closeLayer('sheet'); setTimeout(() => openStrokes(w.lemma), 60); } break; }
    case 'hw-char': STROKES.i = +id; STROKES.mode = 'anim'; updateSheet(strokesHTML()); drawStroke(); break;
    case 'hw-anim': STROKES.mode = 'anim'; updateSheet(strokesHTML()); drawStroke(); break;
    case 'hw-quiz': STROKES.mode = 'quiz'; updateSheet(strokesHTML()); drawStroke(); break;
    case 'tones-start': startTones(); break;
    case 'tone-play': toneSpeak(); break;
    case 'tone-pick': { TONE.ans = +id; if (String(+id + 1) === toneNums(TONE.pool[TONE.i])[0]) TONE.score++; updateSheet(toneHTML()); break; }
    case 'tone-next': TONE.i++; TONE.ans = null; updateSheet(toneHTML()); if (TONE.i < TONE.pool.length) setTimeout(toneSpeak, 150); break;
    case 'tone-again': closeLayer('sheet'); setTimeout(startTones, 80); break;
    case 'w-table': if (CUR) { const lemma = CUR.data && CUR.data.lemma || CUR.term; closeLayer('sheet'); setTimeout(() => openPlTable(lemma), 60); } break;
    case 'd-table': { const w = S.words[id]; if (w) { closeLayer('sheet'); setTimeout(() => openPlTable(w.lemma), 60); } break; }
    case 'goal-add': goalEditor(); break;
    case 'goal-type': { const f = document.querySelector('form[data-form="goal"]'); goalEditor.d.type = id; if (f && f.due) goalEditor.d.due = f.due.value; goalEditor(); break; }
    case 'goal-lang': { const f = document.querySelector('form[data-form="goal"]'); goalEditor.d.lang = id; if (f) { if (f.n) goalEditor.d.n = +f.n.value; goalEditor.d.due = f.due.value; } goalEditor(); break; }
    case 'goal-del': { const g = S.goals[id]; if (g) { g.del = true; g.u = now(); save(); render(); } break; }
    case 'r-search': { closeLayer('sheet'); setTimeout(() => showSheet(`<div class="w-head"><h2 style="flex:1">Поиск по книге</h2><button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div><label class="sr" for="bsearch">Что найти</label><input class="in" id="bsearch" type="search" placeholder="Слово или фраза" lang="${R.lang}"><div id="bsearch-res"></div>`, { label: 'Поиск по книге' }) || setTimeout(() => { const i = $('#bsearch'); if (i) i.focus(); }, 50), 60); break; }
  }
});
document.addEventListener('input', e => { if (e.target.id === 'bsearch') { const el = $('#bsearch-res'); if (el) el.innerHTML = searchHTML(e.target.value); } });
document.addEventListener('submit', e => {
  const f = e.target; const k = f.dataset.form;
  if (k === 'rv-dict') { e.preventDefault(); const w = S.words[RV.q[0]]; const c = pickCtx(w); const d = wordDiff(c.s, f.a.value, w.lang); RV.diff = d.html; RV.check = d.score >= 0.99 ? 'ok' : d.score >= 0.75 ? 'almost' : 'no'; RV.show = true; renderReview(); }
  if (k === 'goal') { e.preventDefault(); goalSave(f); }
});
document.addEventListener('keydown', e => {
  if (!R || !R.spread || sheetOpen || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); spreadTurn(1); }
  if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); spreadTurn(-1); }
}, true);
