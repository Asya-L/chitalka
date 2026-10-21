// Разбор книг: EPUB, FB2 (в т.ч. .fb2.zip) и TXT.
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
        const t = clean(el.textContent);
        if (t) out.push({ t, h: /^H[1-6]$/.test(el.tagName.toUpperCase()) });
        return;
      }
      // смешанное содержимое: текст прямо внутри div рядом с блоками
      let loose = '';
      const pushLoose = () => { const t = clean(loose); if (t) out.push({ t, h: false }); loose = ''; };
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === 1 && BLOCK.has(n.tagName.toUpperCase())) { pushLoose(); walk(n); }
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
      const blocks = blocksFrom(doc.body);
      const textLen = blocks.reduce((s, b) => s + b.t.length, 0);
      if (textLen < 2) continue;
      let title = toc[path] || '';
      const firstH = blocks.find(b => b.h);
      if (!title && firstH) title = firstH.t;
      let paras = blocks.map(b => b.t);
      if (title && paras[0] === title) paras = paras.slice(1);
      if (!paras.length) paras = [title];
      chapters.push({ t: title.slice(0, 120), p: paras });
    }
    return { title: meta('title'), author: meta('creator'), lang: normLang(meta('language')), chapters };
  }

  // ---------- FB2 ----------
  function fb2Paras(el) {
    const out = [];
    for (const c of Array.from(el.children)) {
      const n = (c.localName || '').toLowerCase();
      if (n === 'p' || n === 'subtitle' || n === 'v' || n === 'text-author') { const t = clean(c.textContent); if (t) out.push(t); }
      else if (n === 'poem' || n === 'stanza' || n === 'cite' || n === 'epigraph') out.push(...fb2Paras(c));
    }
    return out;
  }
  function fb2Sections(sec, out, depth) {
    const tEl = kids(sec, 'title')[0];
    const title = tEl ? clean(Array.from(tEl.children).map(x => x.textContent).join('. ') || tEl.textContent) : '';
    const sub = kids(sec, 'section');
    const own = fb2Paras(sec);
    if (sub.length) {
      if (own.join('').length > 40) out.push({ t: title, p: own });
      sub.forEach((s, i) => {
        const before = out.length;
        fb2Sections(s, out, depth + 1);
        // заголовок части переносим к первой её главе
        if (i === 0 && title && own.join('').length <= 40 && out[before]) out[before].t = out[before].t ? title + '. ' + out[before].t : title;
      });
    } else if (own.length) out.push({ t: title, p: own });
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
      if (!secs.length) { const p = fb2Paras(body); if (p.length) chapters.push({ t: '', p }); }
      secs.forEach(s => fb2Sections(s, chapters, 0));
    }
    return { title: bt ? clean(bt.textContent) : '', author, lang: normLang(lg && lg.textContent), chapters };
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
      const isZh = (str.slice(0, 5000).match(/[㐀-鿿]/g) || []).length > 500;
      const limit = isZh ? 5000 : 2500; let cur = [], n = 0;
      const size = p => isZh ? p.length : p.split(/\s+/).length;
      for (const p of paras) { cur.push(p); n += size(p); if (n >= limit) { chapters.push({ t: '', p: cur }); cur = []; n = 0; } }
      if (cur.length) chapters.push({ t: '', p: cur });
    }
    return { title: String(name || '').replace(/\.(txt)$/i, '').replace(/[_]+/g, ' '), author: '', lang: '', chapters };
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
    if (/\.epub$/i.test(name) || (isZip && !/\.fb2\.zip$/i.test(name) && !/\.zip$/i.test(name))) book = await parseEpub(buf);
    else if (isZip) {
      const zip = await JSZip.loadAsync(buf);
      const f = Object.values(zip.files).find(x => /\.fb2$/i.test(x.name));
      if (f) book = parseFb2Text(decodeXml(await f.async('uint8array')));
      else if (zip.file('META-INF/container.xml')) book = await parseEpub(buf);
      else throw new Error('В архиве нет книги FB2 или EPUB.');
    }
    else if (/\.fb2$/i.test(name) || /<FictionBook/i.test(new TextDecoder('latin1').decode(buf.subarray(0, 600)))) book = parseFb2Text(decodeXml(buf));
    else book = parseTxt(decodeText(buf), name);
    book.chapters = book.chapters.filter(c => c.p.length);
    if (!book.chapters.length) throw new Error('В файле не нашлось текста.');
    const detected = detectLang(book.chapters);
    book.lang = detected === 'zh' || !book.lang ? detected : (book.lang === detected ? book.lang : detected);
    book.chapters.forEach((c, i) => { if (!c.t) c.t = (book.chapters.length > 1 ? 'Часть ' + (i + 1) : ''); });
    if (!book.title) book.title = name.replace(/\.(epub|fb2|txt|zip)+$/i, '');
    book.words = countWords(book.chapters, book.lang);
    return book;
  }

  window.BookParse = { parseBook, detectLang, countWords };
})();
