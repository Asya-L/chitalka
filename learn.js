'use strict';
/* «Между строк» — обучение поверх чтения:
   знакомые слова и понятность текста, слова перед главой, итог главы, FSRS и типы карточек,
   тоны, озвучка, итоги недели, упражнения с проверкой Claude, разговор о книге, грамматика.
   Подключается после app.js и пользуется его функциями и состоянием S. */

const MIN_KNOWN = 300;            // столько знакомых слов нужно, чтобы считать понятность по словарю
const dnum = (t) => Math.floor(((t || Date.now()) - new Date().getTimezoneOffset() * 60000) / DAY);
const isWordTok = (t, lang) => lang === 'zh' ? hasHan(t) : /\p{L}/u.test(t) && !/^\p{Lu}{2,}$/u.test(t);

/* ================= 1. Знакомые слова ================= */
function knownMap(lang) { return (S.known[lang] = S.known[lang] || {}); }
function knownSet(lang) {
  const s = new Set(Object.keys(S.known[lang] || {}));
  for (const w of liveWords(lang)) {
    const keys = [...(w.forms || []), keyOf(w.lemma, lang)];
    if (w.st === 'known') keys.forEach(k => s.add(k)); else keys.forEach(k => s.delete(k));
  }
  return s;
}
function knownCount(lang) { return knownSet(lang).size; }
function knownSince(lang, days) { const from = dnum() - days; return Object.values(S.known[lang] || {}).filter(d => d > from).length; }

/** Абзацы пройдены при чтении: слова, на которые не нажимали, становятся знакомыми; сохранённые слова получают новые примеры. */
function markPassed(paras, lang, bookTitle) {
  const kn = knownMap(lang), learn = savedKeys(lang), tapped = (R && R.tapped) || new Set(), d = dnum();
  const byForm = new Map();
  for (const w of liveWords(lang)) if (w.st === 'learn') { (w.forms || []).forEach(f => byForm.set(f, w)); byForm.set(keyOf(w.lemma, lang), w); }
  let added = 0, ctxAdded = false;
  for (const text of paras) {
    for (const tk of tokenize(text, lang)) {
      if (!tk.w || !isWordTok(tk.t, lang)) continue;
      const k = keyOf(tk.t, lang);
      const w = byForm.get(k);
      if (w) {
        if ((w.ctxs || []).length < 5) {
          const sent = sentenceAt(text, tk.o, lang);
          if (sent.length > 12 && !(w.ctxs || []).some(c => c.s === sent)) { (w.ctxs = w.ctxs || []).push({ s: sent, f: tk.t, tr: '', b: bookTitle || '' }); w.u = now(); ctxAdded = true; }
        }
        continue;
      }
      if (learn.has(k) || tapped.has(k) || kn[k]) continue;
      kn[k] = d; added++;
    }
  }
  if (added || ctxAdded) save(8000);
  return added;
}

/** Понятность набора абзацев: доля знакомых слов среди всех слов текста и незнакомые слова с частотой. */
function coverage(paras, lang, ks) {
  ks = ks || knownSet(lang);
  let total = 0, known = 0; const unk = new Map();
  paras.forEach((text, pi) => {
    for (const tk of tokenize(text, lang)) {
      if (!tk.w || !isWordTok(tk.t, lang)) continue;
      total++;
      const k = keyOf(tk.t, lang);
      if (ks.has(k)) { known++; continue; }
      const u = unk.get(k); if (u) u.n++; else unk.set(k, { n: 1, form: tk.t, pi, o: tk.o });
    }
  });
  return { total, known, pct: total ? known / total : 0, unk };
}
const covLabel = p => p >= 0.95 ? 'читается легко' : p >= 0.9 ? 'с небольшим усилием' : p >= 0.8 ? 'трудно, много словаря' : 'пока очень трудно';
const COV = {};   // id книги → {pct, at}
async function bookCoverage(id) {
  const b = S.books[id]; if (!b) return null;
  const kc = knownCount(b.lang); if (kc < MIN_KNOWN) return null;
  const hit = COV[id]; if (hit && Math.abs(hit.at - kc) < 40) return hit;
  const c = R && R.id === id ? R.c : await idb.get('books', id).catch(() => null); if (!c) return null;
  const paras = []; for (const ch of c.chapters) for (const p of ch.p) { paras.push(p); if (paras.length > 400) break; }
  const r = coverage(paras, b.lang);
  return (COV[id] = { pct: r.pct, at: kc });
}
let covBusy = false;
async function refreshShelfCoverage() {
  if (covBusy) return; covBusy = true;
  try {
    let changed = false;
    for (const b of liveBooks()) { const before = COV[b.id] && COV[b.id].pct; const r = await bookCoverage(b.id); if (r && r.pct !== before) changed = true; }
    if (changed && ui.tab === 'shelf' && !R && !RV && !sheetOpen) render();
  } finally { covBusy = false; }
}
function covBadge(id) { const c = COV[id]; return c ? `понятно ${Math.round(c.pct * 100)}%` : ''; }
function importHint(book) {
  const kc = knownCount(book.lang);
  if (kc < MIN_KNOWN) return '';
  const paras = []; for (const ch of book.chapters) for (const p of ch.p) { paras.push(p); if (paras.length > 300) break; }
  const r = coverage(paras, book.lang);
  const pct = Math.round(r.pct * 100);
  return `<p class="notice cov-hint">Знакомых слов ≈ ${pct}% — ${covLabel(r.pct)}.${r.pct < 0.9 ? ' Начать можно: перед каждой главой будут ключевые слова.' : ''}</p>`;
}

/* ================= 2 и 14. Перед главой: ключевые слова и «что было раньше» ================= */
function prepHTML() {
  const ch = R.c.chapters[R.ch]; const L = R.lang;
  const kc = knownCount(L);
  const cov = kc >= MIN_KNOWN ? coverage(ch.p, L) : null;
  R.chCov = cov;
  const open = R.p === 0 && !EINK;
  return `<details class="prep" id="prep"${open ? ' open' : ''}>
    <summary><span>Перед чтением</span>${cov ? `<span class="hint">понятно ${Math.round(cov.pct * 100)}% · ${cov.unk.size} ${plural(cov.unk.size, 'незнакомое слово', 'незнакомых слова', 'незнакомых слов')}</span>` : ''}</summary>
    <div class="prep-body">
      <div id="prep-words">${R.prep ? prepWordsHTML(R.prep) : '<button class="btn sm" data-a="prep-load">Показать ключевые слова главы</button>'}</div>
      ${R.ch > 0 ? `<div class="prev" id="prep-prev">${R.prevSum ? prevHTML(R.prevSum) : getKey() ? '<button class="btn ghost sm" data-a="prev-load">Что было в прошлой главе</button>' : ''}</div>` : ''}
    </div>
  </details>`;
}
function prepWordsHTML(p) {
  if (p.busy) return '<div class="skeleton" style="width:60%"></div><div class="skeleton" style="width:40%"></div>';
  if (p.info) return `<p class="hint" style="margin:0">${esc(p.info)}</p>`;
  if (p.err) return `<p class="formmsg">${esc(p.err)}</p><button class="btn sm" data-a="prep-load">Ещё раз</button>`;
  if (!p.items.length) return '<p class="hint" style="margin:0">В этой главе почти нет незнакомых слов.</p>';
  const L = R.lang;
  return `<p class="hint" style="margin:0 0 8px">${p.via === 'claude' ? 'Слова, которые стоит знать до чтения' : 'Самые частые незнакомые слова главы'}:</p>
    <ul class="kw">${p.items.map((it, i) => `<li><button data-a="kw-open" data-id="${i}"><b lang="${L}">${esc(it.w)}</b>${it.py ? `<span class="kw-py">${esc(it.py)}</span>` : ''}<span>${esc(it.tr || '')}</span></button></li>`).join('')}</ul>
    <button class="btn sm" data-a="kw-all">Учить все ${p.items.length}</button>`;
}
async function loadPrep() {
  const ch = R.c.chapters[R.ch]; const L = R.lang; const r0 = R;
  R.prep = { busy: true, items: [] }; paintPrep();
  const ck = ['K', R.id, R.ch, S.settings.target, knownCount(L) >= MIN_KNOWN ? 'f' : 'c'].join('|');
  try {
    let p = await idb.get('tr', ck).catch(() => null);
    if (!p) {
      const cov = knownCount(L) >= MIN_KNOWN ? coverage(ch.p, L) : null;
      if (cov) {
        // по словарю: частые незнакомые слова главы
        let cand = [...cov.unk.entries()].filter(([k, u]) => u.n >= 2 && (L === 'zh' || k.length > 2)).sort((a, b) => b[1].n - a[1].n || b[0].length - a[0].length).slice(0, 8);
        if (cand.length < 4) cand = [...cov.unk.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
        const items = cand.map(([k, u]) => ({ w: u.form, k, pi: u.pi, o: u.o }));
        await translateItems(items, L, ch);
        p = { items, via: getKey() ? 'claude' : 'basic' };
      } else if (getKey()) {
        // словаря ещё нет — слова выбирает Claude по уровню
        const text = ch.p.join('\n').slice(0, 7000);
        const j = await askJSON(`A ${S.settings.levels[L]} learner of ${LANG_EN[L]} is about to read this book chapter. Pick the 8 words or short phrases from it that such a learner most likely does not know and that matter most for understanding the chapter. Skip names.

Chapter:
${text}

Reply with JSON only: {"words":[{"w":"word exactly as it appears in the text","tr":"translation into ${TARGETS[S.settings.target].en}, 1-4 words"${L === 'zh' ? ',"py":"pinyin with tone marks"' : ''}}]}`, 700);
        const items = (j.words || []).slice(0, 8).map(x => ({ w: String(x.w || '').trim(), tr: String(x.tr || ''), py: String(x.py || '') })).filter(x => x.w);
        items.forEach(it => { it.k = keyOf(it.w, L); const pi = ch.p.findIndex(t => t.includes(it.w)); it.pi = Math.max(0, pi); it.o = pi >= 0 ? ch.p[pi].indexOf(it.w) : 0; });
        p = { items, via: 'claude' };
      } else {
        p = { items: [], err: '' , needKnown: true };
      }
      if (p.items.length) idb.put('tr', ck, p).catch(() => { });
    }
    if (R !== r0) return;
    R.prep = p.needKnown ? { items: [], info: 'Ключевые слова появятся, когда приложение узнает твой словарь: дочитай пару глав или добавь ключ Claude.' } : p;
  } catch (e) { if (R === r0) R.prep = { items: [], err: e.message || 'Не получилось подобрать слова.' }; }
  paintPrep();
}
async function translateItems(items, L, ch) {
  if (getKey()) {
    try {
      const j = await askJSON(`Translate these ${LANG_EN[L]} words as they are used in a book into ${TARGETS[S.settings.target].en}. Context sentences are given.
${items.map((it, i) => `${i + 1}. «${it.w}» — ${sentenceAt(ch.p[it.pi], it.o, L)}`).join('\n')}

Reply with JSON only: {"tr":["translation 1-4 words", ...]${L === 'zh' ? ',"py":["pinyin with tone marks", ...]' : ''}} in the same order.`, 600);
      items.forEach((it, i) => { it.tr = String((j.tr || [])[i] || ''); if (L === 'zh') it.py = String((j.py || [])[i] || pinyinOf(it.w)); });
      if (items.every(it => it.tr)) return;
    } catch (e) { }
  }
  await Promise.all(items.map(async it => { try { it.tr = (await basicTr(it.w, L)).tr; } catch (e) { it.tr = ''; } if (L === 'zh') it.py = pinyinOf(it.w); }));
}
function paintPrep() { const el = $('#prep-words'); if (el && R && R.prep) el.innerHTML = prepWordsHTML(R.prep); }
function prevHTML(p) {
  if (p.busy) return '<div class="skeleton" style="width:80%"></div>';
  if (p.err) return `<p class="formmsg">${esc(p.err)}</p>`;
  return `<p class="hint" style="margin:0 0 4px">Что было в прошлой главе</p><p class="prev-text" lang="${R.lang}">${esc(p.text)}</p>${p.tr ? `<p class="w-ctxtr">${esc(p.tr)}</p>` : `<button class="btn ghost sm" data-a="prev-tr" style="padding-left:0">Перевести</button>`}`;
}
async function loadPrev() {
  const L = R.lang, r0 = R, prev = R.c.chapters[R.ch - 1];
  const ck = ['P', R.id, R.ch, S.settings.levels[L]].join('|');
  R.prevSum = { busy: true }; paintPrev();
  try {
    let p = await idb.get('tr', ck).catch(() => null);
    if (!p) {
      const text = await askClaude(`Summarize this book chapter in 2-3 short, simple sentences in ${LANG_EN[L]} for a ${S.settings.levels[L]} learner who will read the next chapter. No spoilers beyond this chapter. Reply with the summary only.\n\n${prev.p.join('\n').slice(0, 9000)}`, 300);
      p = { text }; idb.put('tr', ck, p).catch(() => { });
    }
    if (R === r0) R.prevSum = p;
  } catch (e) { if (R === r0) R.prevSum = { err: e.message }; }
  paintPrev();
}
function paintPrev() { const el = $('#prep-prev'); if (el && R && R.prevSum) el.innerHTML = prevHTML(R.prevSum); }

/* ================= 3. Итог главы ================= */
function chapterEndHTML() {
  return `<section class="ch-end" id="chsum" aria-label="Итог главы">${chapterSummaryInner()}</section>`;
}
function chapterSummaryInner() {
  const ch = R.c.chapters[R.ch]; const L = R.lang;
  const words = ch.p.reduce((s, p) => s + wordCount(p, L), 0);
  const text = ch.p.join('\n');
  const savedHere = liveWords(L).filter(w => w.st === 'learn' && (w.ctxs || []).some(c => text.includes(c.s.replace(/^…|…$/g, '').slice(0, 40)))).length;
  const start = R.chStart || { unk: null };
  const kNow = knownSet(L);
  const newKnown = start.unkKeys ? start.unkKeys.filter(k => kNow.has(k)).length : 0;
  const met = start.unkKeys ? start.unkKeys.length : 0;
  return `<h3>Итог главы</h3>
    <ul class="ch-stats">
      <li><b>${fmtNum(words)}</b><span>${L === 'zh' ? 'иероглифов' : 'слов'} в главе</span></li>
      ${met ? `<li><b>${met}</b><span>незнакомых встретилось</span></li><li><b>${newKnown}</b><span>теперь знакомы</span></li>` : ''}
      <li><b>${savedHere}</b><span>сохранено в повторение</span></li>
    </ul>
    <div class="row">${getKey() ? `<button class="btn primary sm" data-a="ex-questions">Вопросы по главе</button><button class="btn sm" data-a="ex-retell">Пересказать главу</button>` : '<p class="hint" style="margin:0">С ключом Claude здесь появятся вопросы на понимание и пересказ с проверкой.</p>'}</div>`;
}
function snapshotChapter() {
  if (!R) return;
  const ch = R.c.chapters[R.ch]; const ks = knownSet(R.lang);
  const cov = coverage(ch.p, R.lang, ks);
  R.chStart = { unkKeys: [...cov.unk.keys()] };
}
function refreshChapterSummary() { const el = $('#chsum'); if (el && R) el.innerHTML = chapterSummaryInner(); }

/* ================= 5 и 6. Примеры в карточке, трудные слова ================= */
function addCtx(w, o) {
  if (!o.ctx || (w.ctxs || []).some(c => c.s === o.ctx)) return false;
  const b = S.books[o.book];
  (w.ctxs = w.ctxs || []).unshift({ s: o.ctx, f: o.term, tr: o.sentTr || '', b: b ? b.title : '' });
  w.ctxs = w.ctxs.slice(0, 5); w.u = now(); save();
  return true;
}
async function leechHelp(id) {
  const w = S.words[id]; if (!w) return;
  w.hintBusy = true; renderReview();
  try {
    const L = w.lang;
    const t = await askClaude(`A learner of ${LANG_EN[L]} (level ${S.settings.levels[L]}) keeps forgetting the word «${w.lemma}» (${w.tr}). Example from their book: «${(w.ctxs[0] || {}).s || ''}».
Help them remember it, in ${TARGETS[S.settings.target].en}, in at most 4 short lines: a memorable hook or association, one more simple example sentence in ${LANG_EN[L]} with translation${L === 'zh' ? ', and what the characters are made of' : ', and a related word they may know'}. Plain text, no markdown.`, 350);
    w.hint = t; w.u = now(); save();
  } catch (e) { w.hint = e.message; }
  delete w.hintBusy; if (RV) renderReview();
}

/* ================= 7. FSRS-4.5 ================= */
const FW = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const F_DECAY = -0.5, F_FACTOR = 19 / 81;
const clampD = d => Math.min(10, Math.max(1, d));
const d0 = G => clampD(FW[4] - (G - 3) * FW[5]);
function fsrsMigrate(srs) {
  srs = Object.assign({ reps: 0, lapses: 0 }, srs);
  if (srs.s || (!srs.reps && !srs.lapses)) return srs;
  const ivl = Math.max(0.5, srs.ivl || 1);
  return Object.assign(srs, { s: ivl, d: 5, last: (srs.due || now()) - ivl * DAY });
}
/** g: 0 — не помню, 1 — с трудом, 2 — помню, 3 — легко */
function fsrs(srs, g, t) {
  t = t || now();
  const G = g + 1; const s0 = fsrsMigrate(srs); const out = Object.assign({}, s0);
  if (!s0.s) { out.s = FW[G - 1]; out.d = d0(G); }
  else {
    const el = Math.max(0, (t - (s0.last || t)) / DAY);
    const Rr = Math.pow(1 + F_FACTOR * el / s0.s, F_DECAY);
    out.d = clampD(FW[7] * d0(3) + (1 - FW[7]) * (s0.d - FW[6] * (G - 3)));
    if (G === 1) out.s = Math.min(s0.s, FW[11] * Math.pow(s0.d, -FW[12]) * (Math.pow(s0.s + 1, FW[13]) - 1) * Math.exp(FW[14] * (1 - Rr)));
    else out.s = s0.s * (1 + Math.exp(FW[8]) * (11 - s0.d) * Math.pow(s0.s, -FW[9]) * (Math.exp(FW[10] * (1 - Rr)) - 1) * (G === 2 ? FW[15] : 1) * (G === 4 ? FW[16] : 1));
    if (G === 1) out.lapses = (s0.lapses || 0) + 1;
  }
  out.reps = (s0.reps || 0) + 1; out.last = t;
  out.ivl = G === 1 ? 0 : Math.max(1, Math.round(out.s));
  out.due = G === 1 ? t + 10 * 60000 : t + out.ivl * DAY - 4 * 3600000;
  out.s = Math.round(out.s * 1000) / 1000; out.d = Math.round(out.d * 1000) / 1000;
  return out;
}

/* ================= 4. Типы карточек ================= */
function hashStr(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function pickCtx(w) { const cs = w.ctxs || []; return cs.length ? cs[(w.srs.reps || 0) % cs.length] : null; }
function cardType(w) {
  if (S.settings.cards === 'recog') return 'recog';
  const reps = w.srs.reps || 0; if (reps < 2) return 'recog';
  const c = pickCtx(w);
  const opts = [];
  if (c && clozeOk(c, w)) opts.push('cloze');
  if (reps >= 4) opts.push('produce');
  if (canSpeak) opts.push('listen');
  if (reps < 4) opts.push('recog');
  return opts.length ? opts[hashStr(w.id + ':' + reps) % opts.length] : 'recog';
}
function clozeOk(c, w) { return !!c.f && c.s.toLowerCase().includes(String(c.f).toLowerCase()); }
function blankOut(sentence, form, lang) {
  const s = esc(sentence), f = esc(form).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = lang === 'zh' ? new RegExp(f) : new RegExp('(^|[^\\p{L}])(' + f + ')(?![\\p{L}])', 'iu');
  return lang === 'zh' ? s.replace(re, '<span class="gap">＿＿</span>') : s.replace(re, (m, a) => a + '<span class="gap">＿＿＿</span>');
}
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function checkAnswer(w, input, c) {
  const a = String(input || '').trim(); if (!a) return null;
  const targets = [w.lemma, ...(w.forms || []), c && c.f].filter(Boolean).map(x => String(x).toLowerCase());
  if (targets.includes(a.toLowerCase())) return 'ok';
  if (targets.map(fold).includes(fold(a))) return 'almost';
  if (w.lang === 'zh' && w.py && fold(w.py).replace(/\s/g, '') === fold(a).replace(/\s/g, '')) return 'ok';
  return 'no';
}
function reviewCardHTML(w) {
  const L = w.lang; const c = pickCtx(w); const T = RV.type || (RV.type = cardType(w));
  const ctxHTML = (blank) => c ? `<div class="ctx${L === 'zh' ? ' zh' : ''}" lang="${L}">${blank ? blankOut(c.s, c.f, L) : highlight(c.s, c.f, L)}</div><div class="src">${esc(c.b || '')}</div>` : '';
  const speakBtn = canSpeak ? `<button class="btn ghost sm" data-a="rv-speak" style="margin-top:8px">${I.speak}Послушать</button>` : '';
  const answer = RV.show ? `<div class="ans" aria-live="polite">
      ${T !== 'recog' ? `<div class="term${L === 'zh' ? ' zh' : ''}" lang="${L}" style="font-size:30px">${esc(w.lemma)}</div>` : ''}
      ${w.py ? `<div class="w-py" style="margin-top:4px">${pyHTML(w.lemma, w.py)}</div>` : ''}
      ${RV.check ? `<p class="check ${RV.check}">${RV.check === 'ok' ? 'Верно' : RV.check === 'almost' ? 'Почти: проверь буквы с диакритикой' : 'Не совсем — правильный ответ выше'}</p>` : ''}
      <div class="w-tr">${esc(w.tr || '—')}</div>${w.alt ? `<div class="w-alt">Ещё: ${esc(w.alt)}</div>` : ''}
      ${extraHTML(w)}
      ${T !== 'recog' && T !== 'listen' ? ctxHTML(false) : ''}
      ${c && c.tr ? `<div class="w-ctxtr" style="text-align:left;margin-top:12px">${esc(c.tr)}</div>` : ''}
      ${w.leech ? `<div class="leech"><b>Трудное слово</b> — забывается уже ${w.srs.lapses} раз.${w.hint ? `<p>${esc(w.hint)}</p>` : w.hintBusy ? '<div class="skeleton"></div>' : getKey() ? ' <button class="btn ghost sm" data-a="rv-leech">Разобрать иначе</button>' : ''}</div>` : ''}
    </div>` : '';
  const needsInput = (T === 'cloze' || T === 'produce') && L !== 'zh';
  let front;
  if (T === 'cloze') front = `<p class="card-kind">Вставь слово</p>${ctxHTML(true)}${c && c.tr ? `<p class="hint">${esc(c.tr)}</p>` : `<p class="hint">Подсказка: ${esc(w.tr || '')}</p>`}`;
  else if (T === 'produce') front = `<p class="card-kind">Как сказать на языке книги?</p><div class="term" style="font-size:30px">${esc(w.tr || '')}</div>${w.pos ? `<p class="hint">${esc(w.pos)}</p>` : ''}`;
  else if (T === 'listen') front = `<p class="card-kind">Послушай и вспомни</p><button class="btn primary" data-a="rv-speak">${I.speak}Слушать ещё раз</button>${RV.show ? ctxHTML(false) : ''}`;
  else front = `<div class="term${L === 'zh' ? ' zh' : ''}" lang="${L}">${esc(w.lemma)}</div>${speakBtn}${ctxHTML(false)}`;
  const input = needsInput && !RV.show ? `<form data-form="rv-answer" class="rv-answer"><label class="sr" for="rv-in">Ответ</label><input class="in" id="rv-in" name="a" autocomplete="off" autocapitalize="off" spellcheck="false" lang="${L}" placeholder="Напиши слово"><button class="btn" type="submit">Проверить</button></form>` : '';
  return `<div class="card">${w.leech && !RV.show ? '<p class="card-kind leech-tag">Трудное слово</p>' : ''}${front}${input}${answer}</div>`;
}
function suggestedGrade() { return RV.check === 'ok' ? 2 : RV.check === 'almost' ? 1 : RV.check === 'no' ? 0 : 2; }

/* ================= 8. Тоны ================= */
function toneNums(s) { try { return pinyinPro.pinyin(s, { type: 'array', toneType: 'num' }).map(x => (String(x).match(/(\d)$/) || [, '0'])[1]); } catch (e) { return []; } }
function pyHTML(hanzi, py) {
  if (!S.settings.tones || !window.pinyinPro || !isHan(hanzi || '')) return esc(py || pinyinOf(hanzi));
  let syl = []; try { syl = pinyinPro.pinyin(hanzi, { type: 'array' }); } catch (e) { return esc(py); }
  const tn = toneNums(hanzi);
  return syl.map((x, i) => `<span class="t${tn[i] || 0}">${esc(x)}</span>`).join(' ');
}

/* ================= 9. Озвучка ================= */
const ttsWait = {};
window.__ttsDone = id => { const f = ttsWait[id]; if (f) { delete ttsWait[id]; f(); } };
function speakAsync(text, lang, rate, onWord) {
  return new Promise(resolve => {
    if (!text) return resolve();
    if (NATIVE && NATIVE.canSpeak && NATIVE.canSpeak()) {
      const id = 'u' + Math.random().toString(36).slice(2, 8);
      if (typeof NATIVE.speakId === 'function') { ttsWait[id] = resolve; try { NATIVE.speakId(text, LANGS[lang].tts, rate || 1, id); } catch (e) { resolve(); } }
      else { try { NATIVE.speak(text, LANGS[lang].tts); } catch (e) { } setTimeout(resolve, 400 + text.length * (lang === 'zh' ? 250 : 70) / (rate || 1)); }
      return;
    }
    if (!('speechSynthesis' in window)) return resolve();
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = LANGS[lang].tts; u.rate = (rate || 1) * (lang === 'zh' ? 0.85 : 1);
      const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.toLowerCase().startsWith(LANGS[lang].tts.slice(0, 2)));
      if (v) u.voice = v;
      if (onWord) u.onboundary = e => { if (e.name === 'word' || e.charIndex != null) onWord(e.charIndex); };
      u.onend = u.onerror = () => resolve();
      speechSynthesis.speak(u);
    } catch (e) { resolve(); }
  });
}
function stopSpeech() { try { if ('speechSynthesis' in window) speechSynthesis.cancel(); if (NATIVE && NATIVE.stopSpeaking) NATIVE.stopSpeaking(); } catch (e) { } Object.keys(ttsWait).forEach(k => window.__ttsDone(k)); }
const PL = { on: false, paused: false, p: 0, s: 0, run: 0 };
function sentencesOf(text, lang) {
  const sg = segmenter(lang, 'sentence');
  if (sg) return Array.from(sg.segment(text), x => ({ t: x.segment, o: x.index })).filter(x => x.t.trim());
  const out = []; let i = 0; for (const part of text.split(/(?<=[.!?。！？…])\s+/)) { out.push({ t: part, o: text.indexOf(part, i) }); i += part.length; } return out;
}
function playerHTML() {
  if (!PL.on) return '';
  return `<div class="player" id="player" role="region" aria-label="Озвучка главы">
    <button class="iconbtn" data-a="pl-prev" aria-label="Предыдущее предложение">‹‹</button>
    <button class="btn primary sm" data-a="pl-toggle">${PL.paused ? 'Продолжить' : 'Пауза'}</button>
    <button class="iconbtn" data-a="pl-next" aria-label="Следующее предложение">››</button>
    <div class="seg" role="group" aria-label="Скорость">${[0.7, 0.9, 1.1].map(r => `<button data-a="pl-rate" data-id="${r}" aria-pressed="${S.settings.rate === r}">${String(r).replace('.', ',')}×</button>`).join('')}</div>
    <button class="iconbtn" data-a="pl-stop" aria-label="Остановить озвучку">${I.close}</button>
  </div>`;
}
function paintPlayer() { const r = $('.reader'); if (!r) return; const old = $('#player'); if (old) old.remove(); if (PL.on) $('#rf').insertAdjacentHTML('beforebegin', playerHTML()); }
function playerStart(fromP) { PL.on = true; PL.paused = false; PL.p = fromP != null ? fromP : (R ? R.p : 0); PL.s = 0; paintPlayer(); playLoop(); }
function playerStop() { PL.on = false; PL.run++; stopSpeech(); clearReadHL(); paintPlayer(); }
function clearReadHL() { document.querySelectorAll('#rt w.rd, #rt w.rdw').forEach(e => e.classList.remove('rd', 'rdw')); }
async function playLoop() {
  const run = ++PL.run;
  while (PL.on && !PL.paused && run === PL.run && R) {
    const paras = R.c.chapters[R.ch].p;
    if (PL.p >= paras.length) { playerStop(); toast('Глава прочитана вслух'); return; }
    const sents = sentencesOf(paras[PL.p], R.lang);
    if (PL.s >= sents.length) { PL.p++; PL.s = 0; continue; }
    const st = sents[PL.s]; const pEl = document.querySelector(`#rt p[data-i="${PL.p}"]`);
    clearReadHL();
    const ws = pEl ? [...pEl.querySelectorAll('w')].filter(w => +w.dataset.o >= st.o && +w.dataset.o < st.o + st.t.length) : [];
    ws.forEach(w => w.classList.add('rd'));
    if (ws[0]) { const rs = $('#rs'); const top = ws[0].getBoundingClientRect().top - rs.getBoundingClientRect().top; if (top < 40 || top > rs.clientHeight - 80) rs.scrollTop += top - rs.clientHeight / 3; }
    act.last = now();
    await speakAsync(st.t, R.lang, S.settings.rate, ci => { ws.forEach(w => w.classList.remove('rdw')); const hit = ws.filter(w => +w.dataset.o - st.o <= ci).pop(); if (hit) hit.classList.add('rdw'); });
    if (run !== PL.run) return;
    PL.s++;
  }
}
function playerJump(d) {
  if (!R) return; const paras = R.c.chapters[R.ch].p;
  PL.s += d;
  if (PL.s < 0) { PL.p = Math.max(0, PL.p - 1); PL.s = Math.max(0, sentencesOf(paras[PL.p], R.lang).length - 1); }
  stopSpeech(); PL.paused = false; paintPlayer(); playLoop();
}

/* ================= 10. Итоги недели ================= */
function weekBounds(offset) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd - 7 * (offset || 0));
  const days = []; for (let i = 0; i < 7; i++) { const x = new Date(d); x.setDate(d.getDate() + i); days.push(dayKey(x)); }
  return { days, from: dnum(d.getTime()), to: dnum(d.getTime()) + 6 };
}
function weekStats(offset) {
  const wb = weekBounds(offset); const t = { min: 0, saved: 0, rev: 0, words: 0, chd: 0, lang: {}, known: 0 };
  for (const d of wb.days) { const x = dayTotals(d); t.min += x.min; t.saved += x.saved; t.rev += x.rev; t.words += x.words; for (const e of Object.values(S.log[d] || {})) t.chd += e.chd || 0; for (const l of Object.keys(LANGS)) t.lang[l] = (t.lang[l] || 0) + langMinutes(d, l); }
  for (const l of Object.keys(LANGS)) for (const v of Object.values(S.known[l] || {})) if (v >= wb.from && v <= wb.to) t.known++;
  return t;
}
const fmtMin = m => { m = Math.round(m); return m >= 60 ? Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин' : m + ' мин'; };
function weekHTML() {
  const a = weekStats(0), b = weekStats(1);
  const delta = (x, y) => y ? (x >= y ? '+' : '−') + Math.abs(Math.round(x - y)) : '';
  const hard = liveWords().filter(w => w.st === 'learn' && (w.srs.lapses || 0) >= 2).sort((x, y) => y.srs.lapses - x.srs.lapses).slice(0, 5);
  return `<section class="sec"><div class="sec-h"><h2>Эта неделя</h2><span class="hint">прошлая: ${fmtMin(b.min)}</span></div>
    <div class="stats">
      <div class="stat"><div class="v">${fmtMin(a.min)}</div><div class="l">занятий ${b.min ? `<span class="delta">${delta(a.min, b.min)} мин</span>` : ''}</div></div>
      <div class="stat"><div class="v">${fmtNum(a.known)}</div><div class="l">новых знакомых слов</div></div>
      <div class="stat"><div class="v">${a.saved}</div><div class="l">в повторение</div></div>
      <div class="stat"><div class="v">${a.chd}</div><div class="l">${plural(a.chd, 'глава прочитана', 'главы прочитаны', 'глав прочитано')}</div></div>
    </div>
    <p class="hint" style="margin-top:10px">${Object.keys(LANGS).filter(l => a.lang[l] >= 0.5).map(l => LANGS[l].ru + ' — ' + fmtMin(a.lang[l])).join(' · ') || 'На этой неделе занятий ещё не было.'}</p>
    ${hard.length ? `<p class="hint" style="margin:6px 0 0">Трудные слова: ${hard.map(w => `<span lang="${w.lang}">${esc(w.lemma)}</span>`).join(', ')}</p>` : ''}
  </section>`;
}
function vocabHTML() {
  const langs = Object.keys(LANGS).filter(l => knownCount(l) > 0 || liveWords(l).length);
  if (!langs.length) return '';
  return `<section class="sec"><h2 style="margin-bottom:12px">Словарь</h2><div class="stats">${langs.map(l => {
    const n = knownCount(l), m = knownSince(l, 30), learn = liveWords(l).filter(w => w.st === 'learn').length;
    return `<div class="stat" style="border-top:4px solid var(--${l})"><div class="v">≈ ${fmtNum(n)}</div><div class="l">${LANGS[l].ru}: знакомых слов${m ? ` · +${fmtNum(m)} за 30 дней` : ''} · учу ${learn}</div></div>`;
  }).join('')}</div>${langs.some(l => knownCount(l) < MIN_KNOWN) ? `<p class="hint" style="margin-top:8px">Знакомыми становятся слова, мимо которых ты прошла при чтении, не нажав на них. Понятность книг появится примерно после ${MIN_KNOWN} знакомых слов в языке.</p>` : ''}</section>`;
}

/* ================= Claude: общие помощники ================= */
async function askJSON(prompt, maxTokens) {
  const txt = await askClaude(prompt, maxTokens || 800);
  const m = txt.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : txt); } catch (e) { throw new AIError('parse', 'Claude ответил непонятно. Попробуй ещё раз.'); }
}
async function askClaudeMsgs(system, messages, maxTokens) {
  const key = getKey(); if (!key) throw new AIError('nokey', 'Нужен ключ Claude API — его можно вписать в настройках.');
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: S.settings.model, max_tokens: maxTokens || 600, system, messages }) });
  } catch (e) { throw new AIError('net', 'Нет связи с Claude.'); }
  if (!res.ok) { if (res.status === 401) throw new AIError('auth', 'Ключ Claude API не подходит.'); if (res.status === 429) throw new AIError('rate', 'Слишком много запросов, подожди минуту.'); throw new AIError('other', 'Claude не ответил (' + res.status + ').'); }
  const j = await res.json(); return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
}
const chapterText = (max) => R.c.chapters[R.ch].p.join('\n').slice(0, max || 8000);
const tgt = () => TARGETS[S.settings.target].en;

/* ================= 11 и 12. Упражнения с проверкой и список ошибок ================= */
let EX = null;
function addMistakes(list, lang, source) {
  for (const m of (list || []).slice(0, 6)) {
    if (!m || !m.wrong || !m.right) continue;
    const id = 'm' + now().toString(36) + Math.random().toString(36).slice(2, 5);
    S.mistakes[id] = { id, lang, wrong: String(m.wrong).slice(0, 200), right: String(m.right).slice(0, 200), rule: String(m.rule || '').slice(0, 300), src: source, at: now(), u: now() };
  }
  save();
}
function exHTML() {
  const e = EX; const L = e.lang;
  let body = '';
  if (e.busy && !e.items) body = '<div class="skeleton" style="width:70%"></div><div class="skeleton" style="width:50%"></div><div class="skeleton" style="width:60%"></div>';
  else if (e.err && !e.items) body = `<p class="formmsg">${esc(e.err)}</p><button class="btn" data-a="ex-reload">Ещё раз</button>`;
  else {
    body = `<form data-form="ex">${e.items.map((it, i) => {
      const r = e.results && e.results[i];
      return `<div class="ex-item"><p class="ex-q"${it.lang ? ` lang="${it.lang}"` : ''}>${e.items.length > 1 ? `<b>${i + 1}.</b> ` : ''}${esc(it.q)}</p>
        <label class="sr" for="ex-a${i}">Ответ ${i + 1}</label><textarea class="in" id="ex-a${i}" name="a${i}" rows="${e.kind === 'retell' || e.kind === 'note' ? 5 : 2}" lang="${e.answerLang || L}" ${e.results ? 'readonly' : ''}>${esc((e.answers || [])[i] || '')}</textarea>
        ${r ? `<div class="ex-res ${r.ok === true ? 'ok' : r.ok === 'partial' ? 'part' : 'no'}"><b>${r.ok === true ? 'Хорошо' : r.ok === 'partial' ? 'Почти' : 'Есть ошибки'}</b>${r.feedback ? ` — ${esc(r.feedback)}` : ''}${r.corrected ? `<p lang="${L}">${esc(r.corrected)}</p>` : ''}</div>` : ''}
      </div>`;
    }).join('')}
    ${e.summary ? `<div class="w-note">${esc(e.summary)}</div>` : ''}
    ${e.mistakes && e.mistakes.length ? `<div class="ex-mist"><b>Ошибки — сохранены в «Мои ошибки»:</b><ul>${e.mistakes.map(m => `<li><s lang="${L}">${esc(m.wrong)}</s> → <span lang="${L}">${esc(m.right)}</span>${m.rule ? `<span class="hint"> — ${esc(m.rule)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
    ${e.err ? `<p class="formmsg">${esc(e.err)}</p>` : ''}
    <div class="row" style="margin-top:12px">${e.results ? `<button class="btn primary" type="button" data-a="sheet-close">Готово</button>` : `<button class="btn primary" type="submit"${e.busy ? ' disabled' : ''}>${e.busy ? 'Проверяю…' : 'Проверить'}</button><button class="btn ghost" type="button" data-a="sheet-close">Отмена</button>`}</div></form>`;
  }
  return `<div class="w-head"><h2 style="flex:1">${esc(e.title)}</h2><button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div>${e.intro ? `<p class="hint" style="margin:4px 0 12px">${esc(e.intro)}</p>` : ''}${body}`;
}
function openEx(cfg) { EX = Object.assign({ busy: !!cfg.gen && !cfg.items, answers: [], results: null, mistakes: [] }, cfg); showSheet(exHTML(), { label: cfg.title, onClose: () => { EX = null; if (!R && !RV) setTimeout(render, 0); else if (R) refreshChapterSummary(); } }); if (cfg.gen) genEx(); }
function paintEx() { if (EX && sheetOpen) updateSheet(exHTML()); }
async function genEx() {
  const e = EX; e.busy = true; e.err = ''; paintEx();
  try { e.items = await e.gen(); } catch (x) { e.err = x.message || 'Не получилось.'; }
  e.busy = false; paintEx();
}
async function submitEx(form) {
  const e = EX; if (!e || e.busy) return;
  e.answers = e.items.map((_, i) => form.elements.namedItem('a' + i).value.trim());
  if (e.answers.every(a => !a)) { e.err = 'Напиши хотя бы один ответ.'; paintEx(); return; }
  e.busy = true; e.err = ''; paintEx();
  try {
    const j = await e.check(e.items, e.answers);
    e.results = j.results || []; e.summary = j.summary || ''; e.mistakes = (j.mistakes || []).filter(m => m && m.wrong && m.right);
    addMistakes(e.mistakes, e.lang, e.kind);
    if (e.kind === 'questions' && R) { const b = curBook(); if (b) { (b.quiz = b.quiz || {})[R.ch] = e.results.filter(r => r.ok === true).length + '/' + e.items.length; b.u = now(); save(); } }
  } catch (x) { e.err = x.message || 'Не получилось проверить.'; }
  e.busy = false; paintEx();
}
const CHECK_FMT = (L) => `"results":[{"ok":true|false|"partial","feedback":"one short sentence in ${tgt()}","corrected":"the learner's answer rewritten correctly and naturally in ${LANG_EN[L]}"}],"mistakes":[{"wrong":"exact wrong fragment","right":"corrected fragment","rule":"very short rule in ${tgt()}"}]`;
function exQuestions() {
  const L = R.lang, lvl = S.settings.levels[L], ch = chapterText(8000), title = curBook().title;
  openEx({
    kind: 'questions', lang: L, title: 'Вопросы по главе', intro: 'Ответь коротко на языке книги — как получается. Claude проверит понимание и язык.',
    gen: async () => {
      const j = await askJSON(`Write 3 short comprehension questions in ${LANG_EN[L]} about this chapter of «${title}», for a ${lvl} learner. Ask about plot, characters and motives, not trivia. Use simple ${LANG_EN[L]}.\n\nChapter:\n${ch}\n\nReply with JSON only: {"questions":["...","...","..."]}`, 400);
      return (j.questions || []).slice(0, 3).map(q => ({ q: String(q), lang: L }));
    },
    check: (items, answers) => askJSON(`You check a ${lvl} learner's answers to comprehension questions about a chapter they read in ${LANG_EN[L]}.\n\nChapter:\n${ch}\n\n${items.map((it, i) => `Q${i + 1}: ${it.q}\nA${i + 1}: ${answers[i] || '(no answer)'}`).join('\n')}\n\nFor each answer judge whether it shows understanding of the chapter (ok true / "partial" / false), give feedback, and the corrected answer. Then list up to 4 language mistakes from the answers. Reply with JSON only: {${CHECK_FMT(L)}}`, 1200)
  });
}
function exRetell() {
  const L = R.lang, lvl = S.settings.levels[L], ch = chapterText(8000);
  openEx({
    kind: 'retell', lang: L, title: 'Пересказ главы', items: [{ q: `Перескажи главу в 2–3 фразах на языке книги (${LANGS[L].ru.toLowerCase()}).` }],
    check: (items, answers) => askJSON(`A ${lvl} learner retold this chapter in ${LANG_EN[L]}.\n\nChapter:\n${ch}\n\nRetelling:\n${answers[0]}\n\nJudge whether the retelling matches the chapter, rewrite it correctly and naturally (keep their ideas and level), explain the single most important mistake in "summary", and list up to 5 language mistakes. Reply with JSON only: {${CHECK_FMT(L)},"summary":"one or two sentences in ${tgt()}"}`, 1000)
  });
}
function exNote(L) {
  const lvl = S.settings.levels[L];
  const learn = liveWords(L).filter(w => w.st === 'learn').slice(-8).map(w => w.lemma);
  openEx({
    kind: 'note', lang: L, title: 'Запись дня', intro: learn.length ? 'Попробуй использовать слова, которые сейчас учишь: ' + learn.join(', ') : 'Две-три фразы о своём дне или о книге.',
    items: [{ q: `Напиши 2–3 фразы на ${({ en: 'английском', pl: 'польском', zh: 'китайском' })[L]}.` }],
    check: (items, answers) => askJSON(`A ${lvl} learner wrote this short text in ${LANG_EN[L]}:\n\n${answers[0]}\n\nRewrite it correctly and naturally (keep their meaning and level), say in "summary" what was good and the single most useful thing to fix, and list up to 5 mistakes. Reply with JSON only: {${CHECK_FMT(L)},"summary":"one or two sentences in ${tgt()}"}`, 900)
  });
}
function exTranslate(L) {
  const lvl = S.settings.levels[L];
  const learn = liveWords(L).filter(w => w.st === 'learn').slice(-15).map(w => w.lemma + ' — ' + (w.tr || ''));
  const mist = Object.values(S.mistakes).filter(m => !m.del && m.lang === L).slice(-6).map(m => m.wrong + ' → ' + m.right + (m.rule ? ' (' + m.rule + ')' : ''));
  openEx({
    kind: 'translate', lang: L, title: 'Перевод с русского', intro: 'Фразы построены на словах, которые ты учишь, и на твоих частых ошибках.',
    gen: async () => {
      const j = await askJSON(`Create 5 short sentences in ${tgt()} for a ${lvl} learner to translate into ${LANG_EN[L]}. Each sentence should use one of these words they are learning:\n${learn.join('\n') || '(none yet — use common everyday words)'}\n${mist.length ? `and practise these past mistakes:\n${mist.join('\n')}` : ''}\nReply with JSON only: {"sentences":["...", "...", "...", "...", "..."]}`, 500);
      return (j.sentences || []).slice(0, 5).map(q => ({ q: String(q) }));
    },
    check: (items, answers) => askJSON(`A ${lvl} learner translated sentences from ${tgt()} into ${LANG_EN[L]}.\n${items.map((it, i) => `${i + 1}. ${it.q}\n   → ${answers[i] || '(no answer)'}`).join('\n')}\nFor each: ok true if correct and natural, "partial" if understandable with small errors, false otherwise; give the correct translation in "corrected". List up to 6 mistakes. Reply with JSON only: {${CHECK_FMT(L)}}`, 1200)
  });
}
function exMistakes(L) {
  const lvl = S.settings.levels[L];
  const mist = Object.values(S.mistakes).filter(m => !m.del && m.lang === L).slice(-10).map(m => m.wrong + ' → ' + m.right + (m.rule ? ' (' + m.rule + ')' : ''));
  openEx({
    kind: 'mistakes', lang: L, title: 'Тренировка ошибок', intro: 'Пять фраз именно на твои ошибки.',
    gen: async () => {
      const j = await askJSON(`A ${lvl} learner of ${LANG_EN[L]} often makes these mistakes:\n${mist.join('\n')}\nCreate 5 short ${tgt()} sentences to translate into ${LANG_EN[L]} that force them to use exactly these patterns correctly. Reply with JSON only: {"sentences":["..."]}`, 500);
      return (j.sentences || []).slice(0, 5).map(q => ({ q: String(q) }));
    },
    check: (items, answers) => askJSON(`A ${lvl} learner translated into ${LANG_EN[L]}, practising their typical mistakes (${mist.slice(0, 5).join('; ')}).\n${items.map((it, i) => `${i + 1}. ${it.q}\n   → ${answers[i] || '(no answer)'}`).join('\n')}\nCheck each. Reply with JSON only: {${CHECK_FMT(L)}}`, 1200)
  });
}
function mistakesHTML() {
  const all = Object.values(S.mistakes).filter(m => !m.del);
  const langs = Object.keys(LANGS).filter(l => liveWords(l).length || all.some(m => m.lang === l) || liveBooks().some(b => b.lang === l));
  if (!langs.length) return '';
  return `<section class="sec" id="practice"><h2 style="margin-bottom:6px">Говорить и писать</h2>
    <p class="hint" style="margin:0 0 12px">${getKey() ? 'Короткие упражнения на своём материале. Claude поправит и запомнит ошибки.' : 'Для этих упражнений нужен ключ Claude API в настройках.'}</p>
    ${langs.map(l => { const ms = all.filter(m => m.lang === l).sort((a, b) => b.at - a.at);
      return `<div class="panel practice" style="--c:var(--${l})"><div class="row" style="justify-content:space-between"><b><span class="lang-dot" style="--c:var(--${l})"></span>${LANGS[l].ru}</b>
        <div class="row">${getKey() ? `<button class="btn sm" data-a="ex-note" data-id="${l}">Запись дня</button><button class="btn sm" data-a="ex-translate" data-id="${l}">Перевод с русского</button>${ms.length >= 2 ? `<button class="btn sm primary" data-a="ex-mistakes" data-id="${l}">Тренировать ошибки</button>` : ''}` : ''}</div></div>
        ${ms.length ? `<details class="mist"><summary>Мои ошибки: ${ms.length}</summary><ul>${ms.slice(0, 30).map(m => `<li><s lang="${l}">${esc(m.wrong)}</s> → <span lang="${l}">${esc(m.right)}</span>${m.rule ? `<span class="hint"> — ${esc(m.rule)}</span>` : ''} <button class="btn ghost sm" data-a="mist-del" data-id="${esc(m.id)}" aria-label="Убрать ошибку">✕</button></li>`).join('')}</ul></details>` : ''}
      </div>`; }).join('')}
  </section>`;
}

/* ================= 13. Богатая карточка слова ================= */
const EXTRA_FIELDS = L => L === 'pl' ? `,
 "aspect": "if the word is a verb: its aspect pair like 'robić (несов.) / zrobić (сов.)' with aspect labels in ${tgt()}, else empty string",
 "forms": "if a noun or adjective: 3-4 key forms in a short line (e.g. genitive singular, nominative plural) with case names in ${tgt()}, else empty string",
 "false_friend": "if a Russian speaker could confuse it with a similar-looking Russian word of different meaning, explain in one short ${tgt()} sentence, else empty string",
 "phrase": "if the tapped word is part of a fixed expression in this sentence, the whole expression and its translation as 'expression — translation', else empty string"`
  : L === 'en' ? `,
 "forms": "if an irregular verb: its three forms like 'go — went — gone', else empty string",
 "phrase": "if the tapped word is part of a phrasal verb or fixed expression in this sentence, the whole expression and its translation as 'expression — translation', else empty string"`
  : `,
 "parts": "for each character: what components it is made of and their meanings, like '好 = 女 (woman) + 子 (child)', meanings in ${tgt()}, one line per character",
 "measure": "if a noun: its usual measure word with pinyin, like '本 (běn)', else empty string",
 "phrase": "if the tapped word is part of a set phrase in this sentence, the phrase and its translation, else empty string"`;
function extraOf(d) { const x = {}; for (const k of ['aspect', 'forms', 'false_friend', 'phrase', 'parts', 'measure']) if (d[k]) x[k] = String(d[k]).trim(); return x; }
function extraHTML(d) {
  const x = d && d.extra; if (!x || typeof x !== 'object') return '';
  const rows = [];
  if (x.aspect) rows.push(['Вид', x.aspect]);
  if (x.forms) rows.push(['Формы', x.forms]);
  if (x.measure) rows.push(['Счётное слово', x.measure]);
  if (x.parts) rows.push(['Из чего состоит', x.parts]);
  if (x.phrase) rows.push(['Выражение', x.phrase]);
  let h = rows.length ? `<dl class="xtra">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v).replace(/\n/g, '<br>')}</dd>`).join('')}</dl>` : '';
  if (x.false_friend) h += `<div class="ff"><b>Ложный друг.</b> ${esc(x.false_friend)}</div>`;
  return h;
}

/* ================= 15. Разговор о книге ================= */
const CHAT = {};
function chatState() { const k = R.id; return (CHAT[k] = CHAT[k] || { msgs: [], busy: false, err: '' }); }
function chatHTML() {
  const c = chatState(); const L = R.lang;
  return `<div class="w-head"><h2 style="flex:1">Разговор о книге</h2><button class="iconbtn" data-a="sheet-close" aria-label="Закрыть">${I.close}</button></div>
    <p class="hint" style="margin:4px 0 10px">Пиши на языке книги — Claude отвечает на твоём уровне и поправляет ошибки.</p>
    <div class="chat" id="chat" aria-live="polite">${c.msgs.length ? c.msgs.map(m => m.role === 'user' ? `<div class="msg me" lang="${L}">${esc(m.content)}</div>` : `<div class="msg ai" lang="${L}">${esc(m.text)}${m.fix ? `<div class="fix">✎ ${esc(m.fix)}</div>` : ''}</div>`).join('') : `<div class="msg ai">${esc(({ en: 'Hi! What do you think of the story so far?', pl: 'Cześć! Co myślisz o tej historii?', zh: '你好！你喜欢这本书吗？' })[L])}</div>`}
      ${c.busy ? '<div class="msg ai"><span class="skeleton" style="display:block;width:120px"></span></div>' : ''}</div>
    ${c.err ? `<p class="formmsg">${esc(c.err)}</p>` : ''}
    <form data-form="chat" class="chat-in"><label class="sr" for="chat-in">Сообщение</label><textarea class="in" id="chat-in" name="m" rows="2" lang="${L}" placeholder="Напиши сообщение"></textarea><button class="btn primary" type="submit"${c.busy ? ' disabled' : ''}>Отправить</button></form>`;
}
function openChat() { showSheet(chatHTML(), { label: 'Разговор о книге' }); scrollChat(); }
function scrollChat() { const el = $('#chat'); if (el) el.scrollTop = el.scrollHeight; }
async function sendChat(text) {
  const c = chatState(); if (!text.trim() || c.busy) return;
  const L = R.lang, b = curBook(), ch = R.c.chapters[R.ch];
  c.msgs.push({ role: 'user', content: text.trim() }); c.busy = true; c.err = ''; updateSheet(chatHTML()); scrollChat();
  const system = `You are a friendly conversation partner for a ${S.settings.levels[L]} learner of ${LANG_EN[L]}. You talk ONLY in simple ${LANG_EN[L]} suited to that level, about the book «${b.title}» they are reading (now at chapter «${ch.t || R.ch + 1}»). Do not spoil later chapters. Keep replies to 2-4 sentences and end with a question.
If the learner's last message has language mistakes, add one final line starting with "✎ " containing the corrected version of their message and a very short explanation in ${tgt()}. If there are no mistakes, do not add that line.
Current chapter excerpt:\n${ch.p.join('\n').slice(0, 5000)}`;
  const messages = c.msgs.map(m => ({ role: m.role, content: m.role === 'user' ? m.content : m.text + (m.fix ? '\n✎ ' + m.fix : '') }));
  try {
    const t = await askClaudeMsgs(system, messages, 500);
    const parts = t.split(/\n?✎\s*/);
    c.msgs.push({ role: 'assistant', text: parts[0].trim(), fix: (parts[1] || '').trim() });
    if (parts[1]) addMistakes([{ wrong: text.trim().slice(0, 120), right: parts[1].split('\n')[0].slice(0, 160), rule: '' }], L, 'chat');
  } catch (e) { c.msgs.pop(); c.err = e.message; }
  c.busy = false; if (sheetOpen) { updateSheet(chatHTML()); scrollChat(); const ta = $('#chat-in'); if (ta && c.err) ta.value = text; }
}

/* ================= 16. Грамматика из своих книг ================= */
const NEXT_LEVEL = { A1: 'A2', A2: 'B1', B1: 'B2', B2: 'C1', C1: 'C2', C2: 'C2', HSK1: 'HSK2', HSK2: 'HSK3', HSK3: 'HSK4', HSK4: 'HSK5', HSK5: 'HSK6', HSK6: 'HSK6' };
const GR_BUSY = {};
function grammarHTML() {
  const langs = Object.keys(LANGS).filter(l => liveWords(l).length >= 5 || S.grammar[l]);
  if (!langs.length) return '';
  return `<section class="sec" id="grammar"><h2 style="margin-bottom:6px">Грамматика из твоих книг</h2>
    <p class="hint" style="margin:0 0 12px">Темы, которые чаще всего встречаются в предложениях с твоими словами, и что нужно для следующего уровня.</p>
    ${langs.map(l => { const g = S.grammar[l]; const lvl = S.settings.levels[l];
      return `<div class="panel grammar" style="--c:var(--${l});margin-bottom:12px"><div class="row" style="justify-content:space-between"><b><span class="lang-dot" style="--c:var(--${l})"></span>${LANGS[l].ru} <span class="hint">${lvl} → ${NEXT_LEVEL[lvl]}</span></b>
        ${getKey() ? `<button class="btn sm" data-a="gr-load" data-id="${l}"${GR_BUSY[l] ? ' disabled' : ''}>${GR_BUSY[l] ? 'Ищу темы…' : g ? 'Обновить' : 'Найти темы'}</button>` : '<span class="hint">нужен ключ Claude</span>'}</div>
        ${GR_BUSY[l] && !g ? '<div class="skeleton" style="width:60%;margin-top:12px"></div>' : ''}
        ${g && g.err ? `<p class="formmsg">${esc(g.err)}</p>` : ''}
        ${g && g.topics ? `<div class="gr-topics">${g.topics.map((t, i) => `<details class="gr-t${t.done ? ' done' : ''}"><summary><span>${esc(t.title)}</span>${t.done ? '<span class="pill-on">разобрала</span>' : ''}</summary>
            <p>${esc(t.explain)}</p>${(t.examples || []).map(x => `<p class="gr-ex" lang="${l}">${esc(x.s)}${x.tr ? `<span class="hint"> — ${esc(x.tr)}</span>` : ''}</p>`).join('')}
            <button class="btn ghost sm" data-a="gr-done" data-id="${l}:${i}">${t.done ? 'Вернуть в список' : 'Отметить «разобрала»'}</button></details>`).join('')}</div>` : ''}
        ${g && g.roadmap ? `<h3 style="margin:14px 0 6px;font-size:15px">Для уровня ${esc(NEXT_LEVEL[lvl])}</h3><ul class="roadmap">${g.roadmap.map(r => `<li class="${r.seen ? 'seen' : ''}"><span aria-hidden="true">${r.seen ? '●' : '○'}</span> ${esc(r.title)}${r.seen ? '<span class="hint"> — встречала в книгах</span>' : ''}</li>`).join('')}</ul>` : ''}
      </div>`; }).join('')}
  </section>`;
}
async function loadGrammar(L) {
  if (GR_BUSY[L]) return; GR_BUSY[L] = true; render();
  const lvl = S.settings.levels[L];
  const sents = []; for (const w of liveWords(L)) for (const c of (w.ctxs || [])) { if (!sents.includes(c.s)) sents.push(c.s); if (sents.length >= 40) break; }
  try {
    const j = await askJSON(`Here are sentences from books a ${lvl} learner of ${LANG_EN[L]} is reading:\n${sents.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n1) Find the 3-5 grammar topics that appear most in these sentences and matter most for this learner. For each: a short title in ${tgt()}, an explanation in ${tgt()} (3-5 sentences, simple), and 2 examples taken from the sentences above with translation.\n2) List 8 key grammar topics needed to move from ${lvl} to ${NEXT_LEVEL[lvl]} (titles in ${tgt()}) and mark seen=true if the topic appears in the sentences above.\nReply with JSON only: {"topics":[{"title":"","explain":"","examples":[{"s":"","tr":""}]}],"roadmap":[{"title":"","seen":true}]}`, 1800);
    const old = S.grammar[L] && S.grammar[L].topics || [];
    const topics = (j.topics || []).slice(0, 5).map(t => ({ title: String(t.title || ''), explain: String(t.explain || ''), examples: (t.examples || []).slice(0, 3).map(x => ({ s: String(x.s || ''), tr: String(x.tr || '') })), done: old.some(o => o.title === t.title && o.done) }));
    S.grammar[L] = { topics, roadmap: (j.roadmap || []).slice(0, 10).map(r => ({ title: String(r.title || ''), seen: !!r.seen })), at: now(), u: now() };
  } catch (e) { S.grammar[L] = Object.assign({}, S.grammar[L] || {}, { err: e.message, u: now() }); }
  GR_BUSY[L] = false; save(); render();
}

/* ================= обработчики ================= */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]'); if (!t) return;
  const a = t.dataset.a, id = t.dataset.id;
  switch (a) {
    case 'prep-load': loadPrep(); break;
    case 'prev-load': loadPrev(); break;
    case 'prev-tr': if (R && R.prevSum && R.prevSum.text) translateSentence(R.prevSum.text, R.lang).then(tr => { R.prevSum.tr = tr; paintPrev(); }).catch(() => { }); break;
    case 'kw-open': { const it = R.prep.items[+id]; const ch = R.c.chapters[R.ch]; openWord({ term: it.w, lang: R.lang, ctx: sentenceAt(ch.p[it.pi] || '', it.o || 0, R.lang), book: R.id }); break; }
    case 'kw-all': { const ch = R.c.chapters[R.ch]; let n = 0; for (const it of R.prep.items) { if (findWord(R.lang, it.w)) continue; saveWord({ term: it.w, lang: R.lang, ctx: sentenceAt(ch.p[it.pi] || '', it.o || 0, R.lang), book: R.id, data: { lemma: it.w, tr: it.tr, py: it.py || '', src: 'prep' } }, 'learn'); n++; } refreshHighlights(); toast(n ? 'Добавлено в повторение: ' + n : 'Эти слова уже в повторении'); break; }
    case 'ex-questions': exQuestions(); break;
    case 'ex-retell': exRetell(); break;
    case 'ex-note': exNote(id); break;
    case 'ex-translate': exTranslate(id); break;
    case 'ex-mistakes': exMistakes(id); break;
    case 'ex-reload': genEx(); break;
    case 'mist-del': { const m = S.mistakes[id]; if (m) { m.del = true; m.u = now(); save(); render(); } break; }
    case 'r-listen': closeLayer('sheet'); setTimeout(() => playerStart(R ? R.p : 0), 60); break;
    case 'r-chat': closeLayer('sheet'); setTimeout(openChat, 60); break;
    case 'pl-toggle': PL.paused = !PL.paused; if (PL.paused) { PL.run++; stopSpeech(); } paintPlayer(); if (!PL.paused) playLoop(); break;
    case 'pl-stop': playerStop(); break;
    case 'pl-next': playerJump(1); break;
    case 'pl-prev': playerJump(-1); break;
    case 'pl-rate': S.settings.rate = +id; S.settings.u = now(); save(); paintPlayer(); break;
    case 'w-sent-speak': if (CUR && CUR.ctx) speakAsync(CUR.ctx, CUR.lang, S.settings.rate); break;
    case 'w-phrase': { const o = CUR; if (!o || !o.data || !o.data.extra || !o.data.extra.phrase) break; const ph = o.data.extra.phrase.split(/\s+[—–-]\s+/); saveWord({ term: ph[0], lang: o.lang, ctx: o.ctx, book: o.book, data: { lemma: ph[0], tr: ph.slice(1).join(' — '), src: 'phrase' } }, 'learn'); toast('Выражение добавлено в повторение'); break; }
    case 'rv-leech': leechHelp(RV.q[0]); break;
    case 'gr-load': loadGrammar(id); break;
    case 'gr-done': { const [l, i] = id.split(':'); const g = S.grammar[l]; if (g && g.topics[+i]) { g.topics[+i].done = !g.topics[+i].done; g.u = now(); save(); render(); } break; }
  }
});
document.addEventListener('submit', e => {
  const f = e.target; const k = f.dataset.form;
  if (k === 'ex') { e.preventDefault(); submitEx(f); }
  if (k === 'chat') { e.preventDefault(); const v = f.m.value; f.m.value = ''; sendChat(v); }
  if (k === 'rv-answer') { e.preventDefault(); const w = S.words[RV.q[0]]; RV.check = checkAnswer(w, f.a.value, pickCtx(w)); RV.answer = f.a.value; RV.show = true; renderReview(); }
});
document.addEventListener('toggle', e => { if (e.target.id === 'prep' && e.target.open && R && !R.prep) loadPrep(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'chat-in') { e.preventDefault(); e.target.form.requestSubmit(); } });
