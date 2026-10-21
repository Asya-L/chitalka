// Разбор книг: EPUB, FB2 (в т.ч. .fb2.zip), TXT и PDF.
// Результат: {title, author, lang, chapters:[{t:'Название', p:['абзац', ...]}]}
(function () {
  const BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'DIV', 'SECTION', 'ARTICLE', 'PRE', 'TD', 'DD', 'DT', 'FIGCAPTION', 'ASIDE', 'HEADER', 'FOOTER', 'TABLE', 'UL', 'OL', 'DL', 'TR', 'FIGURE', 'MAIN', 'NAV']);
  const clean = s => String(s || '').replace(/[­​﻿]/g, '').replace(/\s+/g, ' ').trim();

  // Кодировка файла без пометки: UTF-8, иначе китайские GB18030/Big5 (только если текст в основном иероглифы),
  // иначе выбор между польской Windows-1250 и кириллической Windows-1251 по тому, какие буквы получаются.
  function decodeText(u8) {
    if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder('utf-8').decode(u8.subarray(3));
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { }
    const sample = u8.subarray(0, 200000);
    for (const enc of ['gb18030', 'big5']) {
      try {
        const t = new TextDecoder(enc, { fatal: true }).decode(sample);
        const nonAscii = (t.match(/[^\x00-\x7f]/g) || []).length;
        const han = (t.match(/[\u3400-\u9fff]/g) || []).length;
        if (nonAscii && han / nonAscii > 0.8) return new TextDecoder(enc).decode(u8);
      } catch (e) { }
    }
    const pl = new TextDecoder('windows-1250').decode(sample), ru = new TextDecoder('windows-1251').decode(sample);
    const plScore = (pl.match(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g) || []).length;
    const ruScore = (ru.match(/[а-яё]{3,}/gi) || []).length * 3;
    return new TextDecoder(ruScore > plScore ? 'windows-1251' : 'windows-1250').decode(u8);
  }
  function decodeXml(u8) {
    const head = new TextDecoder('latin1').decode(u8.subarray(0, 300));
    const m = head.match(/encoding\s*=\s*["']([\w.-]+)["']/i);
    if (m && !/utf-?8/i.test(m[1])) { try { return new TextDecoder(m[1]).decode(u8); } catch (e) { } }
    return decodeText(u8);
  }
  function parseXml(str, type) {
    const doc = new DOMParser().parseFromString(str, type || 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return null;
    return doc;
  }
  const byLocal = (root, name) => Array.from(root.getElementsByTagName('*')).filter(e => (e.localName || e.nodeName).toLowerCase() === name);
  const firstLocal = (root, name) => byLocal(root, name)[0] || null;
  const kids = (el, name) => Array.from(el.children || []).filter(e => (e.localName || '').toLowerCase() === name);

  // Текст абзаца с курсивом и жирным: {t, fmt:[[начало, конец, 'i'|'b'|'bi']]}. Пробелы схлопываются так же, как в clean().
  const ITAL = /^(i|em|cite|emphasis|dfn|var)$/, BOLD = /^(b|strong)$/;
  function rich(el) {
    const segs = [];
    const walk = (n, f) => {
      for (const c of Array.from(n.childNodes)) {
        if (c.nodeType === 3 || c.nodeType === 4) segs.push([c.nodeValue, f]);
        else if (c.nodeType === 1) {
          const tg = (c.localName || '').toLowerCase(); let g = f;
          if (ITAL.test(tg) && !g.includes('i')) g += 'i';
          if (BOLD.test(tg) && !g.includes('b')) g = 'b' + g;
          walk(c, g);
        }
      }
    };
    walk(el, '');
    let out = '', space = false; const fmt = [];
    for (const [str, f] of segs) {
      for (const ch of String(str || '').replace(/[­​﻿]/g, '')) {
        if (/\s/.test(ch)) { space = true; continue; }
        if (space && out) out += ' ';
        space = false;
        const st = out.length; out += ch;
        if (f) { const last = fmt[fmt.length - 1]; if (last && last[2] === f && last[1] >= st - 1) last[1] = out.length; else fmt.push([st, out.length, f]); }
      }
    }
    return { t: out, fmt: fmt.length ? fmt : null };
  }
  const imgOf = el => { const tg = (el.localName || '').toLowerCase(); if (tg === 'img') return el; if (tg === 'image') return el; return el.querySelector ? el.querySelector('img, image') : null; };
  const imgSrc = el => el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || el.getAttribute('l:href') || '';
  // Глава из списка блоков {t, fmt} или {img}
  function mkChapter(t, items) {
    const ch = { t, p: [] };
    items.forEach((it, i) => {
      if (it.img) { ch.p.push(''); (ch.img = ch.img || {})[i] = it.img; }
      else { ch.p.push(it.t); if (it.fmt) (ch.fmt = ch.fmt || {})[i] = it.fmt; }
    });
    return ch;
  }
  // Уменьшаем картинку до 900 px и сохраняем как JPEG прямо в книге
  async function shrink(bytes, type) {
    try {
      if (typeof createImageBitmap !== 'function' || /svg/.test(type || '')) return null;
      const bmp = await createImageBitmap(new Blob([bytes], { type: type || 'image/jpeg' }));
      if (bmp.width < 60 || bmp.height < 60) return null;
      const k = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.72);
    } catch (e) { return null; }
  }
  const MAX_IMG = 60, MAX_IMG_BYTES = 6e6;
  async function resolveImages(chapters, load) {
    let n = 0, bytes = 0;
    for (const ch of chapters) {
      if (!ch.img) continue;
      for (const i of Object.keys(ch.img)) {
        let url = null;
        if (n < MAX_IMG && bytes < MAX_IMG_BYTES) { const r = await load(ch.img[i]).catch(() => null); if (r) url = await shrink(r.bytes, r.type); }
        if (url) { ch.img[i] = url; n++; bytes += url.length; } else delete ch.img[i];
      }
      if (!Object.keys(ch.img).length) delete ch.img;
    }
    // абзацы-пустышки от картинок, которые не удалось загрузить, убираем
    for (const ch of chapters) {
      if (!ch.p.some((p, i) => p === '' && !(ch.img && ch.img[i]))) continue;
      const keep = ch.p.map((p, i) => p !== '' || (ch.img && ch.img[i]));
      const remap = {}; let j = 0; keep.forEach((k, i) => { if (k) remap[i] = j++; });
      const nf = {}, ni = {};
      for (const i in (ch.fmt || {})) if (i in remap) nf[remap[i]] = ch.fmt[i];
      for (const i in (ch.img || {})) if (i in remap) ni[remap[i]] = ch.img[i];
      ch.p = ch.p.filter((p, i) => keep[i]);
      if (ch.fmt) ch.fmt = nf; if (ch.img) ch.img = ni;
    }
  }

  function normLang(code) {
    const c = String(code || '').toLowerCase();
    if (/^zh|^cmn|^chi|^chinese/.test(c)) return 'zh';
    if (/^pl|^pol/.test(c)) return 'pl';
    if (/^en|^eng/.test(c)) return 'en';
    return '';
  }
  function detectLang(chapters) {
    let sample = '';
    for (const ch of chapters) { for (const p of ch.p) { sample += p + ' '; if (sample.length > 20000) break; } if (sample.length > 20000) break; }
    const letters = (sample.match(/\p{L}/gu) || []).length || 1;
    const cjk = (sample.match(/[㐀-鿿]/g) || []).length;
    if (cjk / letters > 0.2) return 'zh';
    const plChars = (sample.match(/[ąćęłńśźżĄĆĘŁŃŚŹŻ]/g) || []).length;
    const plWords = (sample.match(/(^|\s)(się|nie|jest|że|był|była|jak|już|tylko)(?=[\s,.!?])/gi) || []).length;
    const enWords = (sample.match(/(^|\s)(the|and|was|that|with|his|her|you)(?=[\s,.!?])/gi) || []).length;
    if (plChars / letters > 0.004 || plWords > enWords) return 'pl';
    return 'en';
  }

  // ---------- EPUB ----------
  function resolve(base, href) {
    const parts = (base + href).split('/');
    const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
    return out.join('/');
  }
  function blocksFrom(body) {
    const out = [];
    const walk = el => {
      const hasBlockChild = Array.from(el.children).some(c => BLOCK.has(c.tagName.toUpperCase()));
      if (!hasBlockChild) {
        const im = imgOf(el); if (im && imgSrc(im)) out.push({ img: imgSrc(im) });
        const r = rich(el);
        if (r.t) out.push({ t: r.t, fmt: r.fmt, h: /^H[1-6]$/.test(el.tagName.toUpperCase()) });
        return;
      }
      // смешанное содержимое: текст прямо внутри div рядом с блоками
      let loose = '';
      const pushLoose = () => { const t = clean(loose); if (t) out.push({ t, h: false }); loose = ''; };
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === 1 && BLOCK.has(n.tagName.toUpperCase())) { pushLoose(); walk(n); }
        else if (n.nodeType === 1 && imgOf(n) && !clean(n.textContent)) { pushLoose(); const im = imgOf(n); if (imgSrc(im)) out.push({ img: imgSrc(im) }); }
        else if (n.nodeType === 1 || n.nodeType === 3) loose += ' ' + n.textContent;
      }
      pushLoose();
    };
    if (body) walk(body);
    return out;
  }
  async function parseEpub(buf) {
    const zip = await JSZip.loadAsync(buf);
    const read = async p => { const f = zip.file(p) || zip.file(decodeURIComponent(p)); return f ? f.async('uint8array') : null; };
    const contB = await read('META-INF/container.xml');
    if (!contB) throw new Error('Это не похоже на EPUB: нет файла container.xml.');
    const cont = parseXml(decodeText(contB));
    const opfPath = firstLocal(cont, 'rootfile').getAttribute('full-path');
    const base = opfPath.includes('/') ? opfPath.replace(/[^/]+$/, '') : '';
    const opf = parseXml(decodeText(await read(opfPath)));
    const meta = n => { const e = firstLocal(opf, n); return e ? clean(e.textContent) : ''; };
    const manifest = {};
    for (const it of byLocal(opf, 'item')) manifest[it.getAttribute('id')] = { href: it.getAttribute('href'), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' };

    // оглавление: файл -> название
    const toc = {};
    try {
      const navItem = Object.values(manifest).find(m => /\bnav\b/.test(m.props));
      if (navItem) {
        const navPath = resolve(base, navItem.href); const navBase = navPath.includes('/') ? navPath.replace(/[^/]+$/, '') : '';
        const nav = new DOMParser().parseFromString(decodeText(await read(navPath)), 'text/html');
        for (const a of nav.querySelectorAll('nav a[href]')) {
          const f = resolve(navBase, decodeURIComponent(a.getAttribute('href').split('#')[0]));
          if (f && !toc[f]) toc[f] = clean(a.textContent);
        }
      }
      const spineEl = firstLocal(opf, 'spine');
      const ncxId = spineEl && spineEl.getAttribute('toc');
      const ncxItem = (ncxId && manifest[ncxId]) || Object.values(manifest).find(m => /ncx/.test(m.type));
      if (ncxItem) {
        const ncxPath = resolve(base, ncxItem.href); const ncxBase = ncxPath.includes('/') ? ncxPath.replace(/[^/]+$/, '') : '';
        const ncx = parseXml(decodeText(await read(ncxPath)));
        if (ncx) for (const np of byLocal(ncx, 'navpoint')) {
          const c = firstLocal(np, 'content'), l = firstLocal(np, 'text');
          if (!c || !l) continue;
          const f = resolve(ncxBase, decodeURIComponent(c.getAttribute('src').split('#')[0]));
          if (f && !toc[f]) toc[f] = clean(l.textContent);
        }
      }
    } catch (e) { }

    const chapters = [];
    for (const ref of byLocal(opf, 'itemref')) {
      if (ref.getAttribute('linear') === 'no') continue;
      const m = manifest[ref.getAttribute('idref')];
      if (!m || !/html|xml/.test(m.type)) continue;
      const path = resolve(base, decodeURIComponent(m.href));
      const bytes = await read(path); if (!bytes) continue;
      const src = decodeText(bytes);
      let doc = parseXml(src, 'application/xhtml+xml');
      if (!doc || !doc.body) doc = new DOMParser().parseFromString(src, 'text/html');
      doc.querySelectorAll('script,style,rt,rp,sup.noteref,a.noteref').forEach(e => e.remove());
      let blocks = blocksFrom(doc.body);
      const textLen = blocks.reduce((s, b) => s + (b.t || '').length, 0);
      if (textLen < 2) continue;
      const dir = path.includes('/') ? path.replace(/[^/]+$/, '') : '';
      blocks.forEach(b => { if (b.img) b.img = resolve(dir, decodeURIComponent(b.img.split('#')[0])); });
      let title = toc[path] || '';
      const firstH = blocks.find(b => b.h);
      if (!title && firstH) title = firstH.t;
      const fi = blocks.findIndex(b => !b.img);
      if (title && fi >= 0 && blocks[fi].t === title) blocks.splice(fi, 1);
      if (!blocks.some(b => b.t)) blocks.push({ t: title });
      chapters.push(mkChapter(title.slice(0, 120), blocks));
    }
    const types = {}; for (const m of Object.values(manifest)) types[resolve(base, decodeURIComponent(m.href))] = m.type;
    await resolveImages(chapters, async p => { const b = await read(p); return b && b.length < 8e6 ? { bytes: b, type: types[p] || '' } : null; });
    return { title: meta('title'), author: meta('creator'), lang: normLang(meta('language')), chapters };
  }

  // ---------- FB2 ----------
  function fb2Paras(el) {
    const out = [];
    for (const c of Array.from(el.children)) {
      const n = (c.localName || '').toLowerCase();
      if (n === 'p' || n === 'subtitle' || n === 'v' || n === 'text-author') { const r = rich(c); if (r.t) out.push(r); }
      else if (n === 'image') { const h = imgSrc(c); if (h) out.push({ img: h.replace(/^#/, '') }); }
      else if (n === 'poem' || n === 'stanza' || n === 'cite' || n === 'epigraph') out.push(...fb2Paras(c));
    }
    return out;
  }
  const textOf = items => items.map(x => x.t || '').join('');
  function fb2Sections(sec, out, depth) {
    const tEl = kids(sec, 'title')[0];
    const title = tEl ? clean(Array.from(tEl.children).map(x => x.textContent).join('. ') || tEl.textContent) : '';
    const sub = kids(sec, 'section');
    const own = fb2Paras(sec);
    if (sub.length) {
      if (textOf(own).length > 40) out.push(mkChapter(title, own));
      sub.forEach((s, i) => {
        const before = out.length;
        fb2Sections(s, out, depth + 1);
        // заголовок части переносим к первой её главе
        if (i === 0 && title && textOf(own).length <= 40 && out[before]) out[before].t = out[before].t ? title + '. ' + out[before].t : title;
      });
    } else if (textOf(own)) out.push(mkChapter(title, own));
  }
  async function parseFb2(str) {
    const book = parseFb2Text(str);
    const bins = {}; for (const b of byLocal(book._doc, 'binary')) bins[b.getAttribute('id')] = b;
    await resolveImages(book.chapters, async id => {
      const b = bins[id]; if (!b) return null;
      const s = (b.textContent || '').replace(/\s+/g, ''); if (s.length > 1e7) return null;
      const bin = atob(s); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return { bytes: u8, type: b.getAttribute('content-type') || '' };
    });
    delete book._doc;
    return book;
  }
  function parseFb2Text(str) {
    const doc = parseXml(str);
    if (!doc) throw new Error('Не получилось прочитать FB2: файл повреждён.');
    const ti = firstLocal(doc, 'title-info');
    const bt = ti && firstLocal(ti, 'book-title');
    let author = '';
    const a = ti && firstLocal(ti, 'author');
    if (a) author = ['first-name', 'middle-name', 'last-name'].map(n => { const e = firstLocal(a, n); return e ? clean(e.textContent) : ''; }).filter(Boolean).join(' ') || clean((firstLocal(a, 'nickname') || {}).textContent);
    const lg = ti && firstLocal(ti, 'lang');
    const chapters = [];
    const bodies = byLocal(doc, 'body').filter(b => !/notes|comments|footnotes/i.test(b.getAttribute('name') || ''));
    for (const body of bodies) {
      const secs = kids(body, 'section');
      if (!secs.length) { const p = fb2Paras(body); if (textOf(p)) chapters.push(mkChapter('', p)); }
      secs.forEach(s => fb2Sections(s, chapters, 0));
    }
    return { title: bt ? clean(bt.textContent) : '', author, lang: normLang(lg && lg.textContent), chapters, _doc: doc };
  }

  // ---------- TXT ----------
  const HEAD_RE = /^\s*(chapter|rozdział|rozdzial|część|czesc|part|prologue|epilogue|prolog|epilog|глава|часть|第\s*[\d一二三四五六七八九十百千零〇两]+\s*[章回节卷])/i;
  function parseTxt(str, name) {
    str = str.replace(/\r\n?/g, '\n');
    const lines = str.split('\n');
    const blank = lines.filter(l => !l.trim()).length;
    let paras;
    if (blank > lines.length / 8) paras = str.split(/\n\s*\n+/).map(b => clean(b.replace(/\n/g, ' '))).filter(Boolean);
    else paras = lines.map(clean).filter(Boolean);
    return { title: String(name || '').replace(/\.(txt)$/i, '').replace(/[_]+/g, ' '), author: '', lang: '', chapters: chapterize(paras) };
  }
  // Деление сплошного текста на главы: по заголовкам «Глава…/Chapter…/第…章», иначе кусками по ~2500 слов
  function chapterize(paras) {
    const heads = paras.map((p, i) => (p.length < 90 && HEAD_RE.test(p)) ? i : -1).filter(i => i >= 0);
    const chapters = [];
    if (heads.length >= 2) {
      if (heads[0] > 0) chapters.push({ t: '', p: paras.slice(0, heads[0]) });
      heads.forEach((h, k) => {
        const end = k + 1 < heads.length ? heads[k + 1] : paras.length;
        const p = paras.slice(h + 1, end);
        chapters.push({ t: paras[h], p: p.length ? p : [paras[h]] });
      });
    } else {
      const isZh = (paras.slice(0, 100).join('').match(/[㐀-鿿]/g) || []).length > 500;
      const limit = isZh ? 5000 : 2500; let cur = [], n = 0;
      const size = p => isZh ? p.length : p.split(/\s+/).length;
      for (const p of paras) { cur.push(p); n += size(p); if (n >= limit) { chapters.push({ t: '', p: cur }); cur = []; n = 0; } }
      if (cur.length) chapters.push({ t: '', p: cur });
    }
    return chapters;
  }

  // ---------- PDF ----------
  // pdf.js подгружается при первом PDF. Текст собирается в строки по координатам, строки — в абзацы;
  // колонтитулы и номера страниц убираются, переносы со знаком «-» склеиваются, главы — по оглавлению PDF.
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
  let pdfLoading = null;
  function loadPdfJs() {
    if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions.workerSrc) return Promise.resolve(window.pdfjsLib);
    return pdfLoading || (pdfLoading = new Promise((res, rej) => {
      const fail = () => { pdfLoading = null; rej(new Error('Не загрузился модуль чтения PDF — при первом открытии PDF нужен интернет.')); };
      const sc = document.createElement('script'); sc.src = PDFJS + 'pdf.min.js';
      sc.onload = async () => {
        try {
          // воркер с другого домена запускаем через blob — так он работает и из офлайн-кэша
          const r = await fetch(PDFJS + 'pdf.worker.min.js'); if (!r.ok) throw new Error();
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([await r.text()], { type: 'application/javascript' }));
          res(window.pdfjsLib);
        } catch (e) { fail(); }
      };
      sc.onerror = fail;
      document.head.appendChild(sc);
    }));
  }
  const SENT_END = /[.!?…»"”')\]。！？」』]$/;
  const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  async function parsePdf(buf, name) {
    const lib = await loadPdfJs();
    let pdf;
    try { pdf = await lib.getDocument({ data: buf, isEvalSupported: false }).promise; }
    catch (e) { throw new Error(/password/i.test(String(e && (e.name + ' ' + e.message))) ? 'PDF защищён паролем — сними защиту и добавь снова.' : 'Не получилось открыть PDF: файл повреждён.'); }
    const lines = [];   // {t, x, y, h, right, pg}
    for (let pg = 1; pg <= pdf.numPages; pg++) {
      if (pg % 25 === 0 && typeof window.toast === 'function') window.toast('Читаю PDF: страница ' + pg + ' из ' + pdf.numPages);
      const page = await pdf.getPage(pg);
      const tc = await page.getTextContent();
      const rows = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
        let r = rows.find(r => Math.abs(r.y - y) < Math.min(r.h, h) * 0.5);
        if (!r) rows.push(r = { y, h, items: [] });
        r.items.push({ x, w: it.width, s: it.str, h }); r.h = Math.max(r.h, h);
      }
      rows.sort((a, b) => b.y - a.y);
      const pl = [];
      for (const r of rows) {
        r.items.sort((a, b) => a.x - b.x);
        let t = '', end = null;
        for (const it of r.items) {
          if (end != null && it.x - end > it.h * 0.15 && !/\s$/.test(t) && !/^\s/.test(it.s)) t += ' ';
          t += it.s; end = it.x + it.w;
        }
        t = t.replace(/\s+/g, ' ').trim();
        if (t) pl.push({ t, x: r.items[0].x, y: r.y, h: r.h, right: end, pg });
      }
      lines.push(...pl);
      page.cleanup();
    }
    if (lines.reduce((n, l) => n + l.t.length, 0) < 40) { pdf.destroy(); throw new Error('В этом PDF нет текста — похоже, это скан. Нужен PDF с текстовым слоем.'); }
    // колонтитулы: первые и последние строки страниц, повторяющиеся на многих страницах (цифры не учитываем), и номера страниц
    const norm = t => t.replace(/\d+/g, '#').toLowerCase();
    const byPg = new Map(); for (const l of lines) { if (!byPg.has(l.pg)) byPg.set(l.pg, []); byPg.get(l.pg).push(l); }
    const edgeCount = new Map();
    for (const ls of byPg.values()) for (const l of new Set([ls[0], ls[ls.length - 1]])) edgeCount.set(norm(l.t), (edgeCount.get(norm(l.t)) || 0) + 1);
    const nPg = byPg.size;
    const deco = new Set();
    for (const ls of byPg.values()) for (const l of new Set([ls[0], ls[1], ls[ls.length - 2], ls[ls.length - 1]])) {
      if (!l) continue;
      const edge = l === ls[0] || l === ls[ls.length - 1];
      if (/^[\s\d\-–—|.]+$/.test(l.t) || /^[ivxlc]+$/i.test(l.t) || (edge && nPg >= 2 && (edgeCount.get(norm(l.t)) || 0) >= Math.max(2, nPg * 0.4))) deco.add(l);
    }
    const body = lines.filter(l => !deco.has(l));
    const left = median(body.map(l => l.x)), right = median(body.map(l => l.right)), hh = median(body.map(l => l.h)) || 10;
    const gaps = []; for (let i = 1; i < body.length; i++) if (body[i].pg === body[i - 1].pg) gaps.push(body[i - 1].y - body[i].y);
    const lh = median(gaps.filter(g => g > 0)) || hh * 1.3;
    const zh = (body.slice(0, 300).map(l => l.t).join('').match(/[㐀-鿿]/g) || []).length > 200;
    const paras = [], paraPg = []; let cur = null;
    for (let i = 0; i < body.length; i++) {
      const l = body[i], prev = body[i - 1];
      let brk = !prev;
      if (prev) {
        const samePg = prev.pg === l.pg;
        const gap = samePg ? prev.y - l.y : lh;
        const indent = l.x - left > hh * 0.9 && l.x - prev.x > hh * 0.9;
        const short = prev.right < right - hh * 3;
        const big = l.h > hh * 1.25 || prev.h > hh * 1.25;
        brk = big || (samePg && gap > lh * 1.6) || indent || (short && SENT_END.test(prev.t));
      }
      if (brk) { if (cur) paras.push(cur); cur = l.t; paraPg.push(l.pg); continue; }
      if (/\p{L}-$/u.test(cur) && /^\p{Ll}/u.test(l.t)) cur = cur.slice(0, -1) + l.t;   // перенос слова
      else cur += (zh ? '' : ' ') + l.t;
    }
    if (cur) paras.push(cur);
    // главы: по оглавлению PDF (верхний уровень), иначе по заголовкам в тексте
    let chapters = null;
    try {
      const outline = await pdf.getOutline();
      if (outline && outline.length >= 2) {
        const marks = [];
        for (const o of outline) {
          let dest = o.dest; if (typeof dest === 'string') dest = await pdf.getDestination(dest);
          if (!Array.isArray(dest)) continue;
          marks.push({ t: clean(o.title), pg: (await pdf.getPageIndex(dest[0])) + 1 });
        }
        marks.sort((a, b) => a.pg - b.pg);
        if (marks.length >= 2) {
          chapters = [];
          const pre = paras.filter((p, i) => paraPg[i] < marks[0].pg); if (pre.join('').length > 200) chapters.push({ t: '', p: pre });
          marks.forEach((m, k) => {
            const to = k + 1 < marks.length ? marks[k + 1].pg : Infinity;
            let ps = paras.filter((p, i) => paraPg[i] >= m.pg && paraPg[i] < to);
            if (ps.length > 1 && ps[0].toLowerCase() === m.t.toLowerCase()) ps = ps.slice(1);
            if (ps.length) chapters.push({ t: m.t.slice(0, 120), p: ps });
          });
        }
      }
    } catch (e) { chapters = null; }
    if (!chapters || !chapters.length) chapters = chapterize(paras);
    let meta = {}; try { meta = (await pdf.getMetadata()).info || {}; } catch (e) { }
    pdf.destroy();
    return { title: clean(meta.Title) || String(name || '').replace(/\.pdf$/i, ''), author: clean(meta.Author), lang: '', chapters };
  }

  function countWords(chapters, lang) {
    let n = 0;
    for (const ch of chapters) for (const p of ch.p) n += lang === 'zh' ? (p.match(/[㐀-鿿]/g) || []).length : p.split(/\s+/).filter(w => /\p{L}/u.test(w)).length;
    return n;
  }

  async function parseBook(file) {
    const name = file.name || 'Книга';
    const buf = new Uint8Array(await file.arrayBuffer());
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
    let book;
    const isPdf = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
    if (isPdf || /\.pdf$/i.test(name)) book = await parsePdf(buf, name);
    else if (/\.epub$/i.test(name) || (isZip && !/\.fb2\.zip$/i.test(name) && !/\.zip$/i.test(name))) book = await parseEpub(buf);
    else if (isZip) {
      const zip = await JSZip.loadAsync(buf);
      const f = Object.values(zip.files).find(x => /\.fb2$/i.test(x.name));
      if (f) book = await parseFb2(decodeXml(await f.async('uint8array')));
      else if (zip.file('META-INF/container.xml')) book = await parseEpub(buf);
      else throw new Error('В архиве нет книги FB2 или EPUB.');
    }
    else if (/\.fb2$/i.test(name) || /<FictionBook/i.test(new TextDecoder('latin1').decode(buf.subarray(0, 600)))) book = await parseFb2(decodeXml(buf));
    else book = parseTxt(decodeText(buf), name);
    book.chapters = book.chapters.filter(c => c.p.length);
    if (!book.chapters.length) throw new Error('В файле не нашлось текста.');
    const detected = detectLang(book.chapters);
    book.lang = detected === 'zh' || !book.lang ? detected : (book.lang === detected ? book.lang : detected);
    book.chapters.forEach((c, i) => { if (!c.t) c.t = (book.chapters.length > 1 ? 'Часть ' + (i + 1) : ''); });
    if (!book.title) book.title = name.replace(/\.(epub|fb2|txt|zip|pdf)+$/i, '');
    book.words = countWords(book.chapters, book.lang);
    return book;
  }

  window.BookParse = { parseBook, detectLang, countWords };
})();
