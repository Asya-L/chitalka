'use strict';
/* «Между строк» — раздел «Упражнения»: всё на своих словах и своих книгах, без ключей.
   Подключается после extras.js. Экран упражнения — отдельный слой «drill» поверх приложения или читалки. */

let D = null;                         // идущее упражнение
const EXUI = { lang: null };          // выбранный язык в разделе
const rnd = n => Math.floor(Math.random() * n);
const rshuf = a => shuffle(a, rnd(1e9) + 1);
const uniqBy = (a, f) => { const s = new Set(); return a.filter(x => { const k = f(x); if (s.has(k)) return false; s.add(k); return true; }); };

/* ---------------- материал ---------------- */
const BOOKTXT = {};
async function bookContent(id) {
  if (R && R.id === id) return R.c;
  if (BOOKTXT[id]) return BOOKTXT[id];
  let c = await idb.get('books', id).catch(() => null);
  if (!c && S.books[id] && S.books[id].cloud && session) c = await downloadBook(id);
  return c ? (BOOKTXT[id] = c) : null;
}
async function langParas(L, opt) {
  opt = opt || {}; const out = [];
  for (const b of liveBooks().filter(b => b.lang === L && (!opt.book || b.id === opt.book))) {
    const c = await bookContent(b.id); if (!c) continue;
    c.chapters.forEach((ch, ci) => { if (opt.ch != null && ci !== opt.ch) return; ch.p.forEach((t, pi) => { if (t && t.length > 20) out.push({ t, b: b.title, ci, pi }); }); });
  }
  return out;
}
const wordsTr = L => liveWords(L).filter(w => w.tr && w.tr.trim() && w.st !== undefined);
const learnFirst = ws => [...rshuf(ws.filter(w => w.st === 'learn')), ...rshuf(ws.filter(w => w.st !== 'learn'))];
function wordSentences(L) { const out = []; for (const w of liveWords(L)) for (const c of (w.ctxs || [])) out.push({ s: c.s.replace(/^…|…$/g, '').trim(), f: c.f, tr: c.tr, w }); return uniqBy(out, x => x.s); }
async function anySentences(L, min, max, opt) {
  let out = wordSentences(L).filter(x => { const n = tokenize(x.s, L).filter(t => t.w).length; return n >= min && n <= max; });
  if (out.length < 8) {
    const paras = rshuf(await langParas(L, opt)).slice(0, 60);
    for (const p of paras) for (const st of sentencesOf(p.t, L)) { const s = st.t.trim(); const n = tokenize(s, L).filter(t => t.w).length; if (n >= min && n <= max) out.push({ s, f: '', tr: '' }); }
    out = uniqBy(out, x => x.s);
  }
  return rshuf(out);
}
/** Ошибся в упражнении — слово пораньше попадёт в повторение. */
function touchWord(w) { if (!w || w.st !== 'learn' || !(w.srs.reps > 0)) return; w.srs = Object.assign({}, w.srs, { due: Math.min(w.srs.due || now(), now()) }); w.u = now(); save(4000); }
const isCap = (t, L) => L !== 'zh' && /^\p{Lu}/u.test(t);

/* ---------------- список упражнений ---------------- */
const NEED = {
  words: (L, n) => wordsTr(L).length >= n || `Нужно хотя бы ${n} слов с переводом — сохрани их при чтении.`,
  book: L => liveBooks().some(b => b.lang === L) || 'Нужна книга на этом языке.',
  speak: () => canSpeak || 'Браузер не умеет озвучивать текст.',
  any: (...xs) => { for (const x of xs) if (x !== true) return x; return true; }
};
const EXS = [
  { id: 'pairs', title: 'Пары', desc: '5 слов и 5 переводов — соединить на время', need: L => NEED.words(L, 5) },
  { id: 'gaps', title: 'Пропуски в абзаце', desc: 'Настоящий абзац из книги — расставь пропущенные слова', need: L => NEED.book(L) },
  { id: 'find', title: 'Найди в тексте', desc: 'Дан перевод — нажми это слово в абзаце', need: L => NEED.any(NEED.book(L), NEED.words(L, 1)) },
  { id: 'listen', title: 'На слух', desc: 'Звучит предложение из книги — выбери перевод', need: L => NEED.any(NEED.speak(), NEED.book(L) === true || wordSentences(L).length >= 4 || 'Нужна книга на этом языке.') },
  { id: 'sprint', title: 'Спринт 60 секунд', desc: 'Слово и перевод: верно или нет — как можно быстрее', need: L => NEED.words(L, 4) },
  { id: 'order', title: 'Собери предложение', desc: 'Предложение из книги рассыпалось — собери по порядку', need: L => NEED.book(L) === true || wordSentences(L).length >= 3 || 'Нужна книга на этом языке.' },
  { id: 'dictation', title: 'Диктант', desc: 'Послушай предложение и напиши его', langs: ['en', 'pl'], need: L => NEED.any(NEED.speak(), NEED.book(L) === true || wordSentences(L).length >= 3 || 'Нужна книга на этом языке.') },
  { id: 'cases', title: 'Падежи', desc: 'nad (ścieżka) → ścieżką: выбери нужную форму', langs: ['pl'], need: L => liveWords(L).some(w => (w.ctxs || []).some(c => c.f && keyOf(c.f, L) !== keyOf(w.lemma, L))) || 'Нужны сохранённые слова, встреченные не в начальной форме.' },
  { id: 'preps', title: 'Предлоги и падежи', desc: 'Какой падеж после do, przez, przy… — на примерах из книг', langs: ['pl'], need: () => true },
  { id: 'irregular', title: 'Неправильные глаголы', desc: 'go → went → gone: глаголы из твоих книг', langs: ['en'], need: () => true },
  { id: 'pinyin', title: 'Пиньинь ↔ иероглиф', desc: 'Узнай чтение по иероглифу и наоборот', langs: ['zh'], need: () => true },
  { id: 'compose', title: 'Собери слово', desc: '书 + 店 = 书店: собери слово из иероглифов', langs: ['zh'], need: () => true },
  { id: 'measure', title: 'Счётные слова', desc: '一 _ 书 → 本', langs: ['zh'], need: () => true },
  { id: 'tones', title: 'Тоны на слух', desc: 'Послушай слог и выбери тон', langs: ['zh'], need: () => NEED.speak() },
  { id: 'strokes', title: 'Порядок черт', desc: 'Анимация и прописывание иероглифов', langs: ['zh'], need: () => true }
];
const DAILY = { en: ['pairs', 'gaps', 'listen', 'irregular'], pl: ['pairs', 'gaps', 'preps', 'cases'], zh: ['pairs', 'pinyin', 'measure', 'compose'] };
const exFor = L => EXS.filter(x => !x.langs || x.langs.includes(L));
function exLangs() { return Object.keys(LANGS).filter(l => liveBooks().some(b => b.lang === l) || liveWords(l).length); }
const dailyDone = () => dayTotals(today()).drill > 0;

function renderExercises() {
  const langs = exLangs();
  if (!langs.length) return `<div class="empty"><h1>Упражнения</h1><p>Упражнения строятся на твоих книгах и словах. Добавь книгу и сохрани несколько слов при чтении — здесь появятся пары, пропуски, задания на слух и на грамматику.</p><div class="row" style="justify-content:center;margin-top:18px"><button class="btn primary" data-a="tab" data-id="shelf">На полку</button></div></div>`;
  const L = EXUI.lang && langs.includes(EXUI.lang) ? EXUI.lang : (liveBooks()[0] && langs.includes(liveBooks()[0].lang) ? liveBooks()[0].lang : langs[0]);
  EXUI.lang = L;
  const done = dailyDone();
  return `<h1>Упражнения</h1>
    ${langs.length > 1 ? `<div class="chips sec" role="group" aria-label="Язык" style="margin-top:14px">${langs.map(l => `<button class="chip" data-a="ex-lang" data-id="${l}" aria-pressed="${l === L}"><span class="lang-dot" style="--c:var(--${l})"></span>${LANGS[l].ru}</button>`).join('')}</div>` : ''}
    <section class="sec panel daily${done ? ' done' : ''}" style="--c:var(--${L})"><div><h2>Тренировка дня</h2><p class="hint" style="margin:6px 0 0">${done ? 'Сегодня уже сделана. Можно пройти ещё раз.' : '5–10 минут: четыре коротких упражнения подряд на твоих словах.'}</p></div>
      <button class="btn${done ? '' : ' primary'}" data-a="dr-daily" data-id="${L}">${done ? '✓ Ещё раз' : 'Начать'}</button></section>
    <div class="ex-grid sec">${exFor(L).map(x => { const ok = x.need(L); return `<button class="ex-card" data-a="dr-start" data-id="${x.id}"${ok === true ? '' : ' aria-disabled="true"'}>
      <b>${esc(x.title)}</b><span>${esc(x.desc)}</span>${ok === true ? '' : `<span class="ex-need">${esc(ok)}</span>`}</button>`; }).join('')}</div>`;
}

/* ---------------- запуск и экран ---------------- */
const DRILL_N = { pairs: 1, gaps: 3, find: 6, listen: 6, order: 5, dictation: 5, cases: 6, preps: 8, irregular: 8, pinyin: 8, compose: 6, measure: 8 };
async function startDrill(id, L, opt) {
  opt = opt || {};
  if (id === 'tones') { await startTones(); return; }
  if (id === 'strokes') { const ws = liveWords('zh').filter(w => hasHan(w.lemma)); await ensureHsk(); const pool = ws.length ? ws.map(w => w.lemma) : [...(DATA.hsk || new Map()).keys()].filter(w => w.length <= 2).slice(0, 150); if (pool.length) openStrokes(pool[rnd(pool.length)]); return; }
  const wasOpen = !!D; if (D && D.timer) clearInterval(D.timer);
  D = { id, lang: L, opt, title: (EXS.find(x => x.id === id) || {}).title || '', items: null, i: 0, ok: 0, n: 0, miss: [], busy: true, t0: now(), queue: opt.queue || null, step: opt.step || 0 };
  if (!wasOpen) openLayer('drill');
  paintDrill(); startActivity();
  const d0 = D;
  try {
    if (id === 'sprint') { buildSprint(L); }
    else {
      const items = await BUILD[id](L, opt.short ? Math.min(4, DRILL_N[id] || 4) : (DRILL_N[id] || 6), opt);
      if (D !== d0) return;
      if (!items || !items.length) throw new Error('Для этого упражнения пока мало материала.');
      D.items = items;
    }
  } catch (e) { if (D !== d0) return; D.err = e.message || 'Не получилось подготовить упражнение.'; }
  if (D !== d0) return;
  D.busy = false; D.t0 = now(); paintDrill(); afterPaint();
}
function exitDrill() { if (D && D.timer) clearInterval(D.timer); D = null; stopSpeech(); $('#drill-root').innerHTML = ''; stopActivity(); save(300); if (R) { startActivity(); refreshHighlights(); } else render(); }
function drillProgress() { if (!D.items) return 0; return Math.round(D.i / D.items.length * 100); }
function paintDrill() {
  const root = $('#drill-root'); if (!root || !D) return;
  let body = '', foot = '';
  const it = D.items && D.items[D.i];
  if (D.busy) body = `<div class="card drill-card"><p class="card-kind">${esc(D.title)}</p><div class="skeleton" style="width:70%;margin:18px auto"></div><div class="skeleton" style="width:50%;margin:0 auto"></div><p class="hint">Готовлю задание…</p></div>`;
  else if (D.err) { body = `<div class="card drill-card"><p class="card-kind">${esc(D.title)}</p><p class="formmsg" role="alert">${esc(D.err)}</p></div>`; foot = nextStepBtn() || `<button class="btn primary wide" data-a="dr-close">К упражнениям</button>`; }
  else if (D.id === 'sprint') { const x = sprintHTML(); body = x.body; foot = x.foot; }
  else if (!it) { body = summaryHTML(); foot = nextStepBtn() || `<div class="grades" style="grid-template-columns:1fr 1fr"><button class="btn" data-a="dr-again">Ещё раз</button><button class="btn primary" data-a="dr-close">К упражнениям</button></div>`; }
  else { const x = KIND[it.k](it); body = `<div class="card drill-card">${it.label ? `<p class="card-kind">${esc(it.label)}</p>` : ''}${x.body}${D.shown && it.ex ? `<div class="drill-ex">${it.ex}</div>` : ''}</div>`; foot = D.shown ? `<button class="btn primary wide" data-a="dr-next">${D.i + 1 < D.items.length ? 'Дальше' : 'Итог'}</button>` : (x.foot || ''); }
  const top = D.queue ? `Тренировка дня · ${D.step + 1} из ${D.queue.length}` : esc(D.title);
  root.innerHTML = `<div class="review drill" role="dialog" aria-label="${esc(D.title)}">
    <div class="rv-top"><button class="iconbtn" data-a="dr-close" aria-label="Закончить">${I.close}</button><div class="prog" aria-hidden="true"><i style="width:${D.id === 'sprint' ? Math.min(100, (now() - D.t0) / 600) : drillProgress()}%"></i></div><span class="hint drill-top">${top}</span></div>
    <div class="rv-body">${body}</div><div class="rv-foot">${foot}</div></div>`;
}
function nextStepBtn() {
  if (!D.queue || (D.items && D.i < D.items.length && !D.err) || D.busy) return '';
  return D.step + 1 < D.queue.length ? `<button class="btn primary wide" data-a="dr-step">Дальше: ${esc((EXS.find(x => x.id === D.queue[D.step + 1]) || {}).title || '')}</button>` : `<button class="btn primary wide" data-a="dr-close">Готово</button>`;
}
function summaryHTML() {
  const sec = Math.round((now() - D.t0) / 1000);
  if (!D.counted) { D.counted = true; bump('ex', 1); if (D.queue && D.step + 1 >= D.queue.length) bump('drill', 1); save(2000); }
  const pct = D.n ? D.ok / D.n : 1;
  const miss = uniqBy(D.miss.filter(Boolean), x => x.id || x.lemma);
  return `<div class="card drill-card"><p class="card-kind">${esc(D.title)}</p><h1 class="drill-score">${D.ok} из ${D.n}</h1>
    <p class="hint">${pct >= 0.9 ? 'Отлично!' : pct >= 0.6 ? 'Хорошо — ошибки ниже.' : 'Есть над чем поработать — ошибки ниже.'} · ${sec >= 60 ? Math.floor(sec / 60) + ' мин ' : ''}${sec % 60} с</p>
    ${miss.length ? `<div class="drill-miss"><b>Повторить:</b><ul>${miss.slice(0, 12).map(m => `<li><span lang="${D.lang}">${esc(m.lemma || m.q || '')}</span>${m.tr ? ` — ${esc(m.tr)}` : ''}</li>`).join('')}</ul>${miss.some(m => m.id) ? '<p class="hint" style="margin:6px 0 0">Сохранённые слова из этого списка придут в повторение сегодня.</p>' : ''}</div>` : ''}
    ${D.queue && D.step + 1 >= D.queue.length ? '<p class="notice" style="margin-top:14px">Тренировка дня выполнена ✓</p>' : ''}</div>`;
}
function answer(ok, missWord) {
  D.n++; if (ok) D.ok++; else { D.miss.push(missWord || { q: (D.items[D.i] || {}).missLabel }); if (missWord && missWord.id) touchWord(missWord); }
  D.shown = true; D.lastOk = ok; paintDrill();
  const it = D.items[D.i]; if (it && it.sayAfter) speakAsync(it.sayAfter, D.lang, S.settings.rate);
}
function nextItem() { D.i++; D.shown = false; D.st = null; paintDrill(); afterPaint(); }
function afterPaint() { const it = D && D.items && D.items[D.i]; if (it && it.say && !D.shown) setTimeout(() => speakAsync(it.say, D.lang, S.settings.rate), 120); const f = document.querySelector('#drill-root input'); if (f && !('ontouchstart' in window)) f.focus(); if (D && D.id === 'pairs' && !D.timer) { D.timer = setInterval(() => { const el = $('#pairs-t'); if (el && D && !D.shown) el.textContent = Math.round((now() - D.t0) / 1000) + ' с'; }, 1000); } }

/* ---------------- виды заданий ---------------- */
const KIND = {
  choice(it) {
    const st = D.st || (D.st = {});
    return { body: `${it.q}<div class="choices${it.opts.length > 4 ? ' many' : ''}">${it.opts.map((o, i) => `<button class="btn choice${D.shown ? (i === it.a ? ' right' : st.pick === i ? ' wrong' : '') : ''}" data-a="dr-pick" data-id="${i}"${D.shown ? ' disabled' : ''}${it.optLang ? ` lang="${it.optLang}"` : ''}>${esc(o)}</button>`).join('')}</div>${it.replay ? `<button class="btn ghost sm" data-a="dr-say" style="margin-top:10px">${I.speak}Ещё раз</button>` : ''}`,
      foot: `<button class="btn ghost wide" data-a="dr-skip">Не знаю</button>` };
  },
  input(it) {
    const st = D.st || (D.st = { vals: [] });
    return { body: `${it.q}${D.shown ? `<div class="drill-ans">${it.fields.map((f, i) => `<p><span class="hint">${esc(f.label)}:</span> <b lang="${D.lang}">${esc(f.ans[0])}</b>${st.res && st.res[i] ? ' ✓' : st.vals[i] ? ` <s lang="${D.lang}">${esc(st.vals[i])}</s>` : ''}</p>`).join('')}</div>`
      : `<form data-form="dr-input" class="drill-form">${it.fields.map((f, i) => `<label class="f">${esc(f.label)}<input class="in" name="a${i}" autocomplete="off" autocapitalize="off" spellcheck="false" lang="${D.lang}"></label>`).join('')}<button class="btn primary" type="submit">Проверить</button></form>`}`,
      foot: D.shown ? '' : `<button class="btn ghost wide" data-a="dr-skip">Не знаю</button>` };
  },
  dict(it) {
    const st = D.st || (D.st = {});
    return { body: `<button class="btn primary" data-a="dr-say">${I.speak}Слушать</button>${D.shown ? `<div class="dict-diff" lang="${D.lang}">${st.diff || ''}</div><p class="drill-ans" lang="${D.lang}">${esc(it.text)}</p>` : `<form data-form="dr-dict" class="rv-answer"><label class="sr" for="dr-dict">Предложение</label><input class="in" id="dr-dict" name="a" autocomplete="off" autocapitalize="off" spellcheck="false" lang="${D.lang}" placeholder="Напиши, что услышала"><button class="btn" type="submit">Проверить</button></form>`}`,
      foot: D.shown ? '' : `<button class="btn ghost wide" data-a="dr-skip">Не знаю</button>` };
  },
  build(it) {
    const st = D.st || (D.st = { built: [] });
    const sep = D.lang === 'zh' ? '' : ' ';
    return { body: `${it.q}<div class="ord-built${D.lang === 'zh' ? ' zh' : ''}" lang="${D.lang}">${st.built.length ? st.built.map((i, k) => `<button class="ord-w on" data-a="dr-unbuild" data-id="${k}"${D.shown ? ' disabled' : ''}>${esc(it.pieces[i])}</button>`).join(sep) : '<span class="hint">Нажимай по порядку</span>'}</div>
      ${D.shown ? `<p class="drill-ans${D.lastOk ? ' ok' : ''}" lang="${D.lang}">${esc(it.answer)}</p>` : `<div class="ord-pool" lang="${D.lang}">${it.order.map(i => st.built.includes(i) ? '' : `<button class="ord-w" data-a="dr-build" data-id="${i}">${esc(it.pieces[i])}</button>`).join('')}</div>`}`,
      foot: D.shown ? '' : st.built.length === it.need ? `<button class="btn primary wide" data-a="dr-check">Проверить</button>` : `<button class="btn ghost wide" data-a="dr-skip">Не знаю</button>` };
  },
  gaps(it) {
    const st = D.st || (D.st = { fill: it.answers.map(() => null), sel: 0 });
    let h = ''; let g = 0;
    for (const tk of it.toks) {
      if (tk.gap == null) { h += esc(tk.t); continue; }
      const gi = tk.gap; const v = st.fill[gi];
      const cls = D.shown ? (v != null && keyOf(it.bank[v], D.lang) === keyOf(it.answers[gi], D.lang) ? ' right' : ' wrong') : st.sel === gi ? ' sel' : '';
      h += `<button class="gap-slot${cls}" data-a="dr-gap" data-id="${gi}"${D.shown ? ' disabled' : ''}>${v != null ? esc(it.bank[v]) : '&nbsp;'.repeat(6)}</button>${D.shown && !(v != null && keyOf(it.bank[v], D.lang) === keyOf(it.answers[gi], D.lang)) ? `<sup class="gap-fix">${esc(it.answers[gi])}</sup>` : ''}`;
      g++;
    }
    return { body: `<div class="gap-text${D.lang === 'zh' ? ' zh' : ''}" lang="${D.lang}">${h}</div><p class="src">${esc(it.src)}</p>
      ${D.shown ? '' : `<div class="ord-pool">${it.bank.map((w, i) => st.fill.includes(i) ? '' : `<button class="ord-w" data-a="dr-bank" data-id="${i}" lang="${D.lang}">${esc(w)}</button>`).join('')}</div>`}`,
      foot: D.shown ? '' : st.fill.every(v => v != null) ? `<button class="btn primary wide" data-a="dr-check">Проверить</button>` : `<button class="btn ghost wide" data-a="dr-skip">Показать ответ</button>` };
  },
  find(it) {
    const st = D.st || (D.st = {});
    const h = tokenize(it.text, D.lang).map(tk => tk.w ? `<w class="${D.shown && it.keys.has(keyOf(tk.t, D.lang)) ? 'right' : st.pick === tk.o ? 'wrong' : ''}" data-a="dr-tap" data-id="${tk.o}" data-k="${esc(keyOf(tk.t, D.lang))}">${esc(tk.t)}</w>` : esc(tk.t)).join('');
    return { body: `<div class="term" style="font-size:28px">${esc(it.tr)}</div><div class="gap-text find${D.lang === 'zh' ? ' zh' : ''}" lang="${D.lang}">${h}</div><p class="src">${esc(it.src)}</p>`, foot: D.shown ? '' : `<button class="btn ghost wide" data-a="dr-skip">Не нашла</button>` };
  },
  pairs(it) {
    const st = D.st || (D.st = { left: null, done: new Set(), bad: null, err: 0 });
    const L = it.words, Rr = it.right;
    return { body: `<p class="hint" style="margin:0 0 10px">Нажми слово, потом его перевод · <span id="pairs-t">${Math.round((now() - D.t0) / 1000)} с</span>${st.err ? ` · ошибок: ${st.err}` : ''}</p>
      <div class="pairs"><div>${L.map((w, i) => `<button class="pair${st.done.has(i) ? ' done' : st.left === i ? ' sel' : ''}${st.bad && st.bad[0] === i ? ' bad' : ''}" data-a="dr-pl" data-id="${i}"${st.done.has(i) ? ' disabled' : ''} lang="${D.lang}">${esc(w.lemma)}</button>`).join('')}</div>
      <div>${Rr.map(i => `<button class="pair${st.done.has(i) ? ' done' : ''}${st.bad && st.bad[1] === i ? ' bad' : ''}" data-a="dr-pr" data-id="${i}"${st.done.has(i) ? ' disabled' : ''}>${esc(L[i].tr)}</button>`).join('')}</div></div>`, foot: '' };
  }
};

/* ---------------- построение заданий ---------------- */
const BUILD = {
  async pairs(L) {
    const ws = learnFirst(uniqBy(wordsTr(L), w => w.tr.toLowerCase())).slice(0, 5);
    if (ws.length < 5) throw new Error('Нужно хотя бы 5 слов с разными переводами.');
    return [{ k: 'pairs', label: 'Пары', words: ws, right: rshuf([0, 1, 2, 3, 4]) }];
  },
  async gaps(L, n, opt) {
    // короткие абзацы (диалоги) склеиваем с соседними в отрывок
    const passages = []; let cur = null;
    for (const p of await langParas(L, opt)) { if (cur && cur.b === p.b && cur.ci === p.ci && cur.t.length < 160 && cur.t.length + p.t.length <= 900) cur.t += ' ' + p.t; else { if (cur) passages.push(cur); cur = Object.assign({}, p); } }
    if (cur) passages.push(cur);
    const paras = rshuf(passages.filter(p => p.t.length >= 80 && p.t.length <= 900));
    if (!paras.length) throw new Error('В книгах не нашлось подходящих абзацев.');
    await ensureFreq(L);
    const saved = savedKeys(L); const out = [];
    // абзацы с сохранёнными словами — первыми
    const score = p => tokenize(p.t, L).filter(t => t.w && saved.has(keyOf(t.t, L))).length;
    paras.sort((a, b) => score(b) - score(a));
    for (const p of paras.slice(0, 40)) {
      if (out.length >= n) break;
      const toks = tokenize(p.t, L);
      const words = toks.map((t, i) => ({ t, i })).filter(x => x.t.w && isWordTok(x.t.t, L) && !isCap(x.t.t, L) && (L === 'zh' ? x.t.t.length >= 2 : x.t.t.length >= 3));
      const pick = []; const used = new Set();
      const add = x => { const k = keyOf(x.t.t, L); if (used.has(k) || pick.some(y => Math.abs(y.i - x.i) < 3)) return; used.add(k); pick.push(x); };
      words.filter(x => saved.has(keyOf(x.t.t, L))).forEach(add);
      const fr = DATA.freq[L];
      const mid = rshuf(words.filter(x => { if (L === 'zh') { const h = DATA.hsk && DATA.hsk.get(x.t.t); return h && h.lv <= 4; } const r = fr && fr.get(x.t.t.toLowerCase()); return r ? r > 120 && r < 12000 : !fr; }));
      for (const x of mid) { if (pick.length >= (L === 'zh' ? 3 : 4)) break; add(x); }
      if (pick.length < 3) continue;
      const take = pick.sort((a, b) => a.i - b.i).slice(0, L === 'zh' ? 4 : 5);
      const gapAt = new Map(take.map((x, gi) => [x.i, gi]));
      const answers = take.map(x => x.t.t);
      const extra = rshuf(liveWords(L).map(w => w.lemma).filter(w => !answers.some(a => keyOf(a, L) === keyOf(w, L)) && !/\s/.test(w))).slice(0, 2);
      out.push({ k: 'gaps', label: 'Расставь пропущенные слова', toks: toks.map((t, i) => gapAt.has(i) ? { t: t.t, gap: gapAt.get(i) } : { t: t.t }), answers, bank: rshuf([...answers, ...extra]), src: p.b, words: take.map(x => findWord(L, x.t.t)) });
    }
    return out;
  },
  async find(L, n, opt) {
    const ws = wordsTr(L).filter(w => w.st === 'learn' || w.st === 'known');
    const map = new Map(); for (const w of ws) { for (const f of (w.forms || [])) map.set(f, w); map.set(keyOf(w.lemma, L), w); }
    const paras = rshuf((await langParas(L, opt)).filter(p => p.t.length >= 60 && p.t.length <= 700));
    const out = []; const usedW = new Set();
    for (const p of paras) {
      if (out.length >= n) break;
      const hits = tokenize(p.t, L).filter(t => t.w && map.has(keyOf(t.t, L)) && !usedW.has(map.get(keyOf(t.t, L)).id));
      if (!hits.length) continue;
      const w = map.get(keyOf(hits[rnd(hits.length)].t, L)); usedW.add(w.id);
      const keys = new Set([...(w.forms || []), keyOf(w.lemma, L)]);
      out.push({ k: 'find', label: 'Найди это слово в абзаце', tr: w.tr, text: p.t, keys, w, src: p.b, ex: `<p><b lang="${L}">${esc(w.lemma)}</b> — ${esc(w.tr)}</p>` });
    }
    if (!out.length) throw new Error('В абзацах книг не нашлось сохранённых слов — сохрани несколько слов при чтении.');
    return out;
  },
  async listen(L, n, opt) {
    const ss = (await anySentences(L, 4, 18, opt)).slice(0, n + 2);
    if (ss.length < 3) throw new Error('Мало предложений для задания на слух.');
    const trs = await Promise.all(ss.map(x => x.tr ? Promise.resolve(x.tr) : translateSentence(x.s, L).catch(() => '')));
    const ok = ss.map((x, i) => ({ s: x.s, tr: trs[i], w: x.w })).filter(x => x.tr);
    if (ok.length < 3) throw new Error(navigator.onLine === false ? 'Нет интернета — переводы для этого задания недоступны.' : 'Не получилось перевести предложения: сервис перевода не ответил.');
    return ok.slice(0, n).map((x, i) => {
      const others = rshuf(ok.filter((_, j) => j !== i)).slice(0, 2).map(y => y.tr);
      const opts = rshuf([x.tr, ...others]);
      return { k: 'choice', label: 'Послушай и выбери перевод', q: `<button class="btn primary" data-a="dr-say">${I.speak}Слушать</button>`, say: x.s, opts, a: opts.indexOf(x.tr), ex: `<p lang="${L}" class="drill-src">${esc(x.s)}</p>`, missWord: x.w ? x.w : { q: x.s, lemma: x.s } };
    });
  },
  async order(L, n, opt) {
    const ss = (await anySentences(L, 4, 9, opt)).slice(0, n);
    if (!ss.length) throw new Error('Мало предложений подходящей длины.');
    return ss.map(x => {
      const pieces = tokenize(x.s, L).filter(t => t.w).map(t => t.t);
      let order = rshuf(pieces.map((_, i) => i)); if (order.every((v, i) => v === i)) order = order.reverse();
      return { k: 'build', label: 'Собери предложение из книги', q: x.tr ? `<p class="hint">${esc(x.tr)}</p>` : '', pieces, order, need: pieces.length, target: pieces.map((_, i) => i), answer: x.s, w: x.w };
    });
  },
  async dictation(L, n, opt) {
    const ss = (await anySentences(L, 4, 12, opt)).slice(0, n);
    if (!ss.length) throw new Error('Мало предложений подходящей длины.');
    return ss.map(x => ({ k: 'dict', label: 'Диктант: послушай и напиши', text: x.s, say: x.s, w: x.w }));
  },
  async cases(L, n) {
    const cand = rshuf(liveWords('pl').flatMap(w => (w.ctxs || []).filter(c => c.f && keyOf(c.f, 'pl') !== keyOf(w.lemma, 'pl') && !/\s/.test(w.lemma)).map(c => ({ w, c }))));
    const out = []; const seen = new Set(); let fails = 0, tried = 0;
    for (const { w, c } of cand) {
      if (out.length >= n || tried >= 14) break;
      if (seen.has(w.id)) continue; seen.add(w.id); tried++;
      let t; try { t = await plTable(w.lemma); } catch (e) { fails++; continue; }
      const forms = tableForms(t.html);
      const right = forms.find(f => f.form.toLowerCase() === c.f.toLowerCase());
      const others = uniqBy(forms.filter(f => f.form.toLowerCase() !== c.f.toLowerCase()), f => f.form.toLowerCase());
      if (!right || others.length < 3) continue;
      const opts = rshuf([c.f, ...rshuf(others).slice(0, 3).map(f => f.form)]);
      out.push({ k: 'choice', label: 'Выбери нужную форму', q: `<div class="ctx drill-ctx" lang="pl">${blankOut(c.s, c.f, 'pl')}</div><p class="hint">(${esc(w.lemma)}) — ${esc(w.tr || '')}</p>`, opts, a: opts.indexOf(c.f), optLang: 'pl', ex: `<p><b lang="pl">${esc(c.f)}</b> — ${esc(right.label)}</p>`, missWord: w });
    }
    if (!out.length) throw new Error(fails && fails >= tried ? (navigator.onLine === false ? 'Нет интернета — формы слов берутся из Викисловаря.' : 'Викисловарь не ответил. Попробуй позже.') : 'Для твоих слов не нашлось таблиц форм. Сохрани ещё существительных из книг.');
    return out;
  },
  async preps(L, n) {
    const paras = rshuf(await langParas('pl')).slice(0, 300);
    const found = [];
    for (const p of paras) for (const st of sentencesOf(p.t, 'pl')) {
      const toks = tokenize(st.t, 'pl').filter(t => t.w);
      for (let i = 0; i < toks.length - 1; i++) { const pr = toks[i].t.toLowerCase(); if (PREP[pr] && !isCap(toks[i + 1].t, 'pl')) { found.push({ s: st.t.trim(), prep: toks[i].t, next: toks[i + 1].t, c: PREP[pr] }); break; } }
      if (found.length > 60) break;
    }
    let items = uniqBy(rshuf(found), x => x.prep.toLowerCase()).slice(0, n);
    if (items.length < n) items = items.concat(rshuf(PREP_EX).filter(e => !items.some(x => x.prep.toLowerCase() === e.prep)).slice(0, n - items.length));
    return items.map(x => {
      const opts = rshuf([x.c, ...rshuf(CASES.filter(c => c !== x.c)).slice(0, 3)]);
      return { k: 'choice', label: 'Какой падеж после предлога?', q: `<div class="ctx drill-ctx" lang="pl">${highlight(x.s, x.prep + ' ' + x.next, 'pl')}</div>`, opts: opts.map(c => CASE_RU[c]), a: opts.indexOf(x.c), ex: `<p>После <b lang="pl">${esc(x.prep.toLowerCase())}</b> — ${esc(CASE_RU[x.c])}: <span lang="pl">${esc(x.prep + ' ' + x.next)}</span></p>`, missWord: { q: x.prep, lemma: x.prep.toLowerCase(), tr: CASE_RU[x.c] } };
    });
  },
  async irregular(L, n) {
    const seen = new Set();
    for (const p of (await langParas('en')).slice(0, 3000)) for (const t of tokenize(p.t, 'en')) if (t.w) seen.add(t.t.toLowerCase());
    const inBooks = IRREG.filter(v => v.slice(0, 3).some(f => f.split('/').some(x => seen.has(x))));
    const pool = rshuf(inBooks).slice(0, n);
    if (pool.length < n) pool.push(...IRREG.slice(0, 40).filter(v => !pool.includes(v)).sort(() => Math.random() - 0.5).slice(0, n - pool.length));
    return pool.map(v => ({ k: 'input', label: 'Неправильный глагол', q: `<div class="term" lang="en">${esc(v[0])}</div><p class="hint">${esc(v[3])}</p>`, fields: [{ label: 'Past Simple', ans: v[1].split('/') }, { label: 'Past Participle', ans: v[2].split('/') }], sayAfter: v.slice(0, 3).map(x => x.split('/')[0]).join(', '), missWord: { lemma: v.join(' — ').replace(/ — [^—]+$/, ''), tr: v[3] }, ex: inBooks.includes(v) ? '<p class="hint">Встречается в твоих книгах.</p>' : '' }));
  },
  async pinyin(L, n) {
    const pool = await zhPool(2);
    if (pool.length < 4) throw new Error('Мало китайских слов.');
    const items = rshuf(pool).slice(0, n);
    return items.map((x, i) => {
      if (i % 2 === 0) {
        const opts = uniqBy(rshuf([x.py, ...toneVariants(x.py), ...rshuf(pool.filter(y => y.w !== x.w && y.w.length === x.w.length)).map(y => y.py)]), s => s).filter(s => s !== x.py).slice(0, 3);
        const all = rshuf([x.py, ...opts]);
        return { k: 'choice', label: 'Как читается?', q: `<div class="term zh" lang="zh">${esc(x.w)}</div>`, opts: all, a: all.indexOf(x.py), ex: x.tr ? `<p>${esc(x.tr)}</p>` : '', sayAfter: x.w, missWord: x.word || { lemma: x.w, tr: x.py } };
      }
      const others = rshuf(pool.filter(y => y.w !== x.w && y.py !== x.py)).slice(0, 3).map(y => y.w);
      const all = rshuf([x.w, ...others]);
      return { k: 'choice', label: 'Какой иероглиф?', q: `<div class="term" style="font-size:30px">${esc(x.py)}</div>${x.tr ? `<p class="hint">${esc(x.tr)}</p>` : ''}`, opts: all, a: all.indexOf(x.w), optLang: 'zh', sayAfter: x.w, missWord: x.word || { lemma: x.w, tr: x.py } };
    });
  },
  async compose(L, n) {
    const pool = (await zhPool(3)).filter(x => x.w.length === 2 && isHan(x.w));
    if (pool.length < 4) throw new Error('Мало двусложных китайских слов.');
    const chars = [...new Set(pool.flatMap(x => Array.from(x.w)))];
    return rshuf(pool).slice(0, n).map(x => {
      const target = Array.from(x.w);
      const pieces = [...target, ...rshuf(chars.filter(c => !target.includes(c))).slice(0, 4)];
      return { k: 'build', label: 'Собери слово', q: `<div class="term" style="font-size:26px">${esc(x.tr || '')}</div><p class="hint">${pyHTML(x.w, x.py)}</p>`, pieces, order: rshuf(pieces.map((_, i) => i)), need: 2, target: [0, 1], answer: x.w + ' — ' + x.py, sayAfter: x.w, w: x.word, missWord: x.word || { lemma: x.w, tr: x.tr } };
    });
  },
  async measure(L, n) {
    await ensureCedict();
    if (!DATA.ced) throw new Error('Словарь CC-CEDICT не загрузился — нужен интернет при первом запуске.');
    const pool = (await zhPool(3)).map(x => ({ ...x, cl: measureOf(x.w) })).filter(x => x.cl);
    if (pool.length < 3) throw new Error('Мало существительных со счётными словами.');
    return rshuf(pool).slice(0, n).map(x => {
      const opts = rshuf([x.cl, ...rshuf(MEASURES.filter(m => m !== x.cl && !(x.allCl || []).includes(m))).slice(0, 3)]);
      return { k: 'choice', label: 'Счётное слово', q: `<div class="term zh measure-q" lang="zh">一<span class="m-gap">＿</span>${esc(x.w)}</div><p class="hint">${pyHTML(x.w, x.py)}${x.tr ? ' — ' + esc(x.tr) : ''}</p>`, opts, a: opts.indexOf(x.cl), optLang: 'zh', ex: `<p lang="zh"><b>一${esc(x.cl)}${esc(x.w)}</b> ${pyHTML(x.cl, pinyinOf(x.cl))}</p>`, sayAfter: '一' + x.cl + x.w, missWord: x.word || { lemma: '一' + x.cl + x.w, tr: x.tr } };
    });
  }
};
function tableForms(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html'); const out = [];
  const rows = [...doc.querySelectorAll('tr')]; const head = rows[0] ? [...rows[0].children].map(c => c.textContent.trim()) : [];
  for (const r of rows.slice(1)) {
    const cells = [...r.children]; const lab = cells[0] && cells[0].tagName === 'TH' ? cells[0].textContent.trim() : '';
    cells.forEach((c, i) => { if (c.tagName !== 'TD') return; for (const f of c.textContent.split(/[\/,\n]/).map(x => x.trim()).filter(x => x && /^\p{L}+$/u.test(x))) out.push({ form: f, label: [lab, head[i]].filter(Boolean).join(', ') }); });
  }
  return out;
}
const CASES = ['gen', 'dat', 'acc', 'ins', 'loc'];
const CASE_RU = { gen: 'родительный (dopełniacz)', dat: 'дательный (celownik)', acc: 'винительный (biernik)', ins: 'творительный (narzędnik)', loc: 'предложный (miejscownik)' };
const PREP = { do: 'gen', dla: 'gen', bez: 'gen', u: 'gen', od: 'gen', obok: 'gen', koło: 'gen', wśród: 'gen', podczas: 'gen', według: 'gen', zamiast: 'gen', oprócz: 'gen', spod: 'gen', zza: 'gen', znad: 'gen', naprzeciwko: 'gen', przez: 'acc', ku: 'dat', dzięki: 'dat', przeciw: 'dat', przeciwko: 'dat', wbrew: 'dat', przy: 'loc' };
const PREP_EX = [
  { s: 'Idę do sklepu.', prep: 'do', next: 'sklepu', c: 'gen' }, { s: 'To prezent dla mamy.', prep: 'dla', next: 'mamy', c: 'gen' }, { s: 'Piję kawę bez cukru.', prep: 'bez', next: 'cukru', c: 'gen' },
  { s: 'Jestem u babci.', prep: 'u', next: 'babci', c: 'gen' }, { s: 'Mam list od brata.', prep: 'od', next: 'brata', c: 'gen' }, { s: 'Szedł przez las.', prep: 'przez', next: 'las', c: 'acc' },
  { s: 'Dzięki tobie wszystko się udało.', prep: 'dzięki', next: 'tobie', c: 'dat' }, { s: 'Siedzę przy oknie.', prep: 'przy', next: 'oknie', c: 'loc' }, { s: 'Mieszkam obok parku.', prep: 'obok', next: 'parku', c: 'gen' },
  { s: 'Rozmawialiśmy podczas lekcji.', prep: 'podczas', next: 'lekcji', c: 'gen' }, { s: 'Szli ku rzece.', prep: 'ku', next: 'rzece', c: 'dat' }, { s: 'Zamiast herbaty wypiła sok.', prep: 'zamiast', next: 'herbaty', c: 'gen' }
];
const MEASURES = ['个', '本', '张', '只', '条', '件', '辆', '家', '杯', '位', '把', '双', '支', '台', '块', '朵', '棵', '座', '部', '封'];
function measureOf(w) {
  const raw = DATA.ced && DATA.ced.get(w); if (!raw) return '';
  const m = raw.match(/CL:([^;¦]+)/); if (!m) return '';
  const all = m[1].split(',').map(x => x.trim().replace(/\[.*$/, '')).map(x => x.includes('|') ? x.split('|')[1] : x).filter(Boolean);
  return all[0] || '';
}
function toneVariants(py) {
  const syl = String(py).split(/\s+/); if (!syl.length) return [];
  const k = rnd(syl.length); const base = syl[k].normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/v/g, 'ü');
  return toneMarks(base).filter(x => x !== syl[k]).map(x => syl.map((s, i) => i === k ? x : s).join(' '));
}
/** Китайские слова для упражнений: сохранённые + из HSK до нужного уровня. */
async function zhPool(minLv) {
  await ensureHsk(); await ensureCedict();
  const lv = Math.max(minLv || 1, +(String(S.settings.levels.zh).match(/\d/) || [1])[0] + 1);
  const out = [];
  for (const w of liveWords('zh')) if (isHan(w.lemma)) out.push({ w: w.lemma, py: pyStr(w.lemma, w.py), tr: w.tr, word: w });
  if (DATA.hsk) for (const [w, h] of DATA.hsk) if (h.lv <= lv && isHan(w) && w.length <= 3) out.push({ w, py: pyStr(w), tr: (cedictEntries(w)[0] || {}).defs ? cedictEntries(w)[0].defs.replace(/;?\s*CL:[^;]+/, '').split(';').slice(0, 2).join('; ').replace(/\s*\([^)]*$/, '').trim() : '' });
  return uniqBy(out, x => x.w);
}
function pyStr(w, given) { try { return window.pinyinPro ? pinyinPro.pinyin(w) : (given || ''); } catch (e) { return given || ''; } }

/* ---------------- спринт ---------------- */
function buildSprint(L) {
  const ws = wordsTr(L); if (ws.length < 4) throw new Error('Нужно хотя бы 4 слова с переводом.');
  D.sp = { ws, cur: null, end: now() + 60000, flash: '' };
  nextSprint();
  D.timer = setInterval(() => { if (!D || D.id !== 'sprint') return; if (now() >= D.sp.end) { clearInterval(D.timer); D.timer = null; D.items = []; D.i = 0; D.id = 'sprint-done'; paintDrill(); } else { const el = $('#sp-t'); if (el) el.textContent = Math.ceil((D.sp.end - now()) / 1000); const pr = document.querySelector('.drill .prog i'); if (pr) pr.style.width = Math.min(100, (now() - D.t0) / 600) + '%'; } }, 250);
}
function nextSprint() {
  const ws = D.sp.ws; const w = ws[rnd(ws.length)]; const truth = Math.random() < 0.5;
  let tr = w.tr; if (!truth) { const o = ws.filter(x => x.tr !== w.tr); tr = o.length ? o[rnd(o.length)].tr : w.tr; }
  D.sp.cur = { w, tr, truth: truth || tr === w.tr };
}
function sprintHTML() {
  const c = D.sp.cur;
  return { body: `<div class="card drill-card sprint${D.sp.flash ? ' ' + D.sp.flash : ''}"><p class="card-kind">Верно ли перевод? <b id="sp-t">${Math.max(0, Math.ceil((D.sp.end - now()) / 1000))}</b> с · счёт ${D.ok}</p>
      <div class="term${D.lang === 'zh' ? ' zh' : ''}" lang="${D.lang}">${esc(c.w.lemma)}</div><div class="w-tr" style="font-size:22px;margin-top:12px">${esc(c.tr)}</div></div>`,
    foot: `<div class="grades" style="grid-template-columns:1fr 1fr"><button class="btn" data-a="dr-sp" data-id="0">✕ Неверно</button><button class="btn primary" data-a="dr-sp" data-id="1">✓ Верно</button></div>` };
}
function sprintAnswer(yes) {
  const c = D.sp.cur; const ok = yes === c.truth; D.n++;
  if (ok) D.ok++; else { D.miss.push(c.w); touchWord(c.w); }
  D.sp.flash = ok ? 'flash-ok' : 'flash-bad'; nextSprint(); paintDrill();
}

/* ---------------- проверка ответов ---------------- */
function checkBuild() {
  const it = D.items[D.i]; const st = D.st;
  const got = st.built.map(i => it.pieces[i]); const want = it.target.map(i => it.pieces[i]);
  const ok = got.join('|') === want.join('|') || (D.lang !== 'zh' && fold(got.join(' ')) === fold(want.join(' ')));
  answer(ok, it.missWord || it.w || { q: it.answer, lemma: it.answer });
}
function checkGaps() {
  const it = D.items[D.i]; const st = D.st; let good = 0;
  it.answers.forEach((a, gi) => { const v = st.fill[gi]; const ok = v != null && keyOf(it.bank[v], D.lang) === keyOf(a, D.lang); if (ok) good++; else { const w = it.words[gi]; D.miss.push(w || { lemma: a }); if (w) touchWord(w); } });
  D.n += it.answers.length; D.ok += good; D.shown = true; D.lastOk = good === it.answers.length; paintDrill();
}
function checkInput(form) {
  const it = D.items[D.i]; const vals = it.fields.map((f, i) => form.elements.namedItem('a' + i).value.trim());
  const res = it.fields.map((f, i) => f.ans.some(a => a.toLowerCase() === vals[i].toLowerCase()));
  D.st = { vals, res }; answer(res.every(Boolean), it.missWord);
}

/* ---------------- обработчики ---------------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]'); if (!t) return;
  const a = t.dataset.a, id = t.dataset.id;
  if (!a.startsWith('dr-') && a !== 'ex-lang') return;
  if (a === 'ex-lang') { EXUI.lang = id; render(); return; }
  if (a === 'dr-start') { if (t.getAttribute('aria-disabled') === 'true') { const x = EXS.find(x => x.id === id); toast(String(x.need(EXUI.lang))); return; } startDrill(id, EXUI.lang); return; }
  if (a === 'dr-daily') { const q = DAILY[id].filter(x => { const ex = EXS.find(y => y.id === x); return ex && ex.need(id) === true; }); if (!q.length) { toast('Пока мало материала: сохрани несколько слов при чтении.'); return; } startDrill(q[0], id, { queue: q, step: 0, short: true }); return; }
  if (a === 'dr-chapter') { if (R) startDrill('gaps', R.lang, { book: R.id, ch: R.ch }); return; }
  if (!D) return;
  const it = D.items && D.items[D.i];
  switch (a) {
    case 'dr-close': closeLayer('drill'); break;
    case 'dr-again': { const { id: i0, lang, opt } = D; if (D.timer) clearInterval(D.timer); D = null; startDrill(i0 === 'sprint-done' ? 'sprint' : i0, lang, Object.assign({}, opt, { queue: null })); break; }
    case 'dr-step': { const q = D.queue, s = D.step + 1, L = D.lang; startDrill(q[s], L, { queue: q, step: s, short: true }); break; }
    case 'dr-next': nextItem(); break;
    case 'dr-say': speakAsync(it && (it.say || it.text), D.lang, S.settings.rate); break;
    case 'dr-skip':
      if (it.k === 'gaps') { checkGaps(); break; }
      if (it.k === 'input') { D.st = { vals: [], res: [] }; }
      if (it.k === 'dict') { D.st = { diff: wordDiff(it.text, '', D.lang).html }; }
      if (it.k === 'find') { D.st = {}; }
      answer(false, it.missWord || it.w || (it.k === 'find' ? it.w : null)); break;
    case 'dr-pick': { D.st = { pick: +id }; answer(+id === it.a, it.missWord); break; }
    case 'dr-build': D.st.built.push(+id); paintDrill(); break;
    case 'dr-unbuild': D.st.built.splice(+id, 1); paintDrill(); break;
    case 'dr-check': if (it.k === 'gaps') checkGaps(); else checkBuild(); break;
    case 'dr-bank': { const st = D.st; let g = st.fill[st.sel] == null ? st.sel : st.fill.findIndex(v => v == null); if (g < 0) break; st.fill[g] = +id; const nx = st.fill.findIndex(v => v == null); st.sel = nx < 0 ? g : nx; paintDrill(); break; }
    case 'dr-gap': { const st = D.st; const gi = +id; if (st.fill[gi] != null) st.fill[gi] = null; st.sel = gi; paintDrill(); break; }
    case 'dr-tap': { if (D.shown) break; D.st = { pick: +id }; answer(it.keys.has(t.dataset.k), it.w); break; }
    case 'dr-pl': { const st = D.st; st.left = +id; st.bad = null; paintDrill(); break; }
    case 'dr-pr': {
      const st = D.st; if (st.left == null) { toast('Сначала нажми слово слева'); break; }
      const r = +id;
      if (r === st.left) { st.done.add(r); st.left = null; st.bad = null; }
      else { st.err++; st.bad = [st.left, r]; const w = it.words[st.left]; D.miss.push(w); touchWord(w); st.left = null; }
      if (st.done.size === it.words.length) { D.n += it.words.length; D.ok += Math.max(0, it.words.length - st.err); D.shown = true; clearInterval(D.timer); D.timer = null; it.ex = `<p>Время: ${Math.round((now() - D.t0) / 1000)} с · ошибок: ${st.err}</p>`; }
      paintDrill(); break;
    }
    case 'dr-sp': sprintAnswer(id === '1'); break;
  }
});
document.addEventListener('submit', e => {
  const f = e.target; if (!D) return;
  if (f.dataset.form === 'dr-input') { e.preventDefault(); checkInput(f); }
  if (f.dataset.form === 'dr-dict') { e.preventDefault(); const it = D.items[D.i]; const d = wordDiff(it.text, f.a.value, D.lang); D.st = { diff: d.html }; answer(d.score >= 0.85, it.w || { q: it.text, lemma: it.text }); }
});
document.addEventListener('keydown', e => {
  if (!D || sheetOpen || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (D.id === 'sprint' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); sprintAnswer(e.key === 'ArrowRight'); return; }
  const it = D.items && D.items[D.i];
  if (D.shown && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); nextItem(); return; }
  if (it && it.k === 'choice' && !D.shown && /^[1-9]$/.test(e.key) && +e.key <= it.opts.length) { D.st = { pick: +e.key - 1 }; answer(+e.key - 1 === it.a, it.missWord); }
});

/* Неправильные глаголы: форма, прошедшее, причастие, перевод. Варианты через «/». */
const IRREG = [
  ['be', 'was/were', 'been', 'быть'], ['have', 'had', 'had', 'иметь'], ['do', 'did', 'done', 'делать'], ['say', 'said', 'said', 'сказать'], ['go', 'went', 'gone', 'идти'], ['get', 'got', 'got/gotten', 'получать'],
  ['make', 'made', 'made', 'делать'], ['know', 'knew', 'known', 'знать'], ['think', 'thought', 'thought', 'думать'], ['take', 'took', 'taken', 'брать'], ['see', 'saw', 'seen', 'видеть'], ['come', 'came', 'come', 'приходить'],
  ['give', 'gave', 'given', 'давать'], ['find', 'found', 'found', 'находить'], ['tell', 'told', 'told', 'рассказывать'], ['become', 'became', 'become', 'становиться'], ['leave', 'left', 'left', 'уходить, оставлять'], ['feel', 'felt', 'felt', 'чувствовать'],
  ['bring', 'brought', 'brought', 'приносить'], ['begin', 'began', 'begun', 'начинать'], ['keep', 'kept', 'kept', 'держать'], ['hold', 'held', 'held', 'держать'], ['write', 'wrote', 'written', 'писать'], ['stand', 'stood', 'stood', 'стоять'],
  ['hear', 'heard', 'heard', 'слышать'], ['let', 'let', 'let', 'позволять'], ['mean', 'meant', 'meant', 'значить'], ['set', 'set', 'set', 'ставить'], ['meet', 'met', 'met', 'встречать'], ['run', 'ran', 'run', 'бежать'],
  ['pay', 'paid', 'paid', 'платить'], ['sit', 'sat', 'sat', 'сидеть'], ['speak', 'spoke', 'spoken', 'говорить'], ['lie', 'lay', 'lain', 'лежать'], ['lead', 'led', 'led', 'вести'], ['read', 'read', 'read', 'читать'],
  ['grow', 'grew', 'grown', 'расти'], ['lose', 'lost', 'lost', 'терять'], ['fall', 'fell', 'fallen', 'падать'], ['send', 'sent', 'sent', 'посылать'], ['build', 'built', 'built', 'строить'], ['understand', 'understood', 'understood', 'понимать'],
  ['draw', 'drew', 'drawn', 'рисовать'], ['break', 'broke', 'broken', 'ломать'], ['spend', 'spent', 'spent', 'тратить'], ['cut', 'cut', 'cut', 'резать'], ['rise', 'rose', 'risen', 'подниматься'], ['drive', 'drove', 'driven', 'вести машину'],
  ['buy', 'bought', 'bought', 'покупать'], ['wear', 'wore', 'worn', 'носить'], ['choose', 'chose', 'chosen', 'выбирать'], ['seek', 'sought', 'sought', 'искать'], ['throw', 'threw', 'thrown', 'бросать'], ['catch', 'caught', 'caught', 'ловить'],
  ['deal', 'dealt', 'dealt', 'иметь дело'], ['win', 'won', 'won', 'побеждать'], ['forget', 'forgot', 'forgotten', 'забывать'], ['sell', 'sold', 'sold', 'продавать'], ['fight', 'fought', 'fought', 'сражаться'], ['teach', 'taught', 'taught', 'учить'],
  ['eat', 'ate', 'eaten', 'есть'], ['drink', 'drank', 'drunk', 'пить'], ['sleep', 'slept', 'slept', 'спать'], ['fly', 'flew', 'flown', 'летать'], ['sing', 'sang', 'sung', 'петь'], ['swim', 'swam', 'swum', 'плавать'],
  ['wake', 'woke', 'woken', 'просыпаться'], ['hide', 'hid', 'hidden', 'прятать'], ['shake', 'shook', 'shaken', 'трясти'], ['steal', 'stole', 'stolen', 'красть'], ['ride', 'rode', 'ridden', 'ехать верхом'], ['bite', 'bit', 'bitten', 'кусать'],
  ['blow', 'blew', 'blown', 'дуть'], ['freeze', 'froze', 'frozen', 'замерзать'], ['forgive', 'forgave', 'forgiven', 'прощать'], ['hang', 'hung', 'hung', 'висеть'], ['shine', 'shone', 'shone', 'сиять'], ['shoot', 'shot', 'shot', 'стрелять'],
  ['shut', 'shut', 'shut', 'закрывать'], ['sink', 'sank', 'sunk', 'тонуть'], ['slide', 'slid', 'slid', 'скользить'], ['spin', 'spun', 'spun', 'кружиться'], ['spread', 'spread', 'spread', 'распространять'], ['strike', 'struck', 'struck', 'ударять'],
  ['swear', 'swore', 'sworn', 'клясться'], ['sweep', 'swept', 'swept', 'мести'], ['tear', 'tore', 'torn', 'рвать'], ['weep', 'wept', 'wept', 'плакать'], ['wind', 'wound', 'wound', 'заводить, наматывать'], ['bend', 'bent', 'bent', 'гнуть'],
  ['bleed', 'bled', 'bled', 'кровоточить'], ['burn', 'burnt/burned', 'burnt/burned', 'гореть'], ['dream', 'dreamt/dreamed', 'dreamt/dreamed', 'мечтать'], ['learn', 'learnt/learned', 'learnt/learned', 'учить'], ['smell', 'smelt/smelled', 'smelt/smelled', 'пахнуть'], ['light', 'lit', 'lit', 'зажигать'],
  ['feed', 'fed', 'fed', 'кормить'], ['flee', 'fled', 'fled', 'бежать, спасаться'], ['kneel', 'knelt', 'knelt', 'стоять на коленях'], ['lend', 'lent', 'lent', 'одалживать'], ['ring', 'rang', 'rung', 'звонить'], ['stick', 'stuck', 'stuck', 'приклеивать'],
  ['sting', 'stung', 'stung', 'жалить'], ['swing', 'swung', 'swung', 'качаться'], ['tread', 'trod', 'trodden', 'ступать'], ['undo', 'undid', 'undone', 'отменять'], ['withdraw', 'withdrew', 'withdrawn', 'отзывать'], ['arise', 'arose', 'arisen', 'возникать']
];
