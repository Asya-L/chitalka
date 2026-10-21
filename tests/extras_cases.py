# Доработки без ключей (пункты 1–15 третьего списка). Подключается в e2e.py после learn_cases.py.
# Во всех кейсах x* словари из data/ доступны (c.data = True).

WIKT_HTML = '''<html><body><section data-mw-section-id="1"><h2 id="Polish">Polish</h2>
<section><h3 id="Noun">Noun</h3><p><b>mgła</b> f</p>
<section><h4 id="Declension">Declension</h4>
<table class="inflection-table"><tbody><tr><th>case</th><th>singular</th><th>plural</th></tr>
<tr><th>nominative</th><td><a href="/wiki/mgła">mgła</a></td><td>mgły</td></tr>
<tr><th>genitive</th><td>mgły</td><td>mgieł</td></tr>
<tr><th>dative</th><td>mgle</td><td>mgłom</td></tr>
<tr><th>accusative</th><td>mgłę</td><td>mgły</td></tr>
<tr><th>instrumental</th><td>mgłą</td><td>mgłami</td></tr>
<tr><th>locative</th><td>mgle</td><td>mgłach</td></tr></tbody></table></section></section></section>
<section><h2 id="Czech">Czech</h2><table><tr><th>nominative</th><td>x</td><td>y</td><td>z</td><td>q</td><td>w</td><td>e</td></tr></table></section></body></html>'''

SPEECH_MOCK = """window.__heard='Wiedźmin szedł powoli przez las';
class FakeSR{constructor(){this.lang='';}start(){window.__srLang=this.lang;setTimeout(()=>{this.onresult&&this.onresult({results:[[{transcript:window.__heard}]]});this.onend&&this.onend();},30)}stop(){}abort(){}}
window.SpeechRecognition=FakeSR;
window.__spoken=[];const _s=speechSynthesis.speak.bind(speechSynthesis);speechSynthesis.speak=u=>{__spoken.push(u.text);setTimeout(()=>u.onend&&u.onend(),5)};"""

async def wikt_html(route):
    if '/page/html/' in route.request.url:
        from urllib.parse import unquote
        w = unquote(route.request.url.rsplit('/', 1)[1])
        if w == 'mgła': return await route.fulfill(status=200, content_type='text/html', headers={'access-control-allow-origin': '*'}, body=WIKT_HTML)
        return await route.fulfill(status=404, body='', headers={'access-control-allow-origin': '*'})
    await route.fallback()

async def xopen(p, fname, lang=None):
    await import_book(p, fname, lang)
    await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')

async def close_sheet(p):
    await p.click('.sheet [data-a="sheet-close"]'); await p.wait_for_selector('.sheet', state='detached')

async def x01_freq_levels(c):
    """1. Частотность в карточке слова, понятность и ключевые слова сразу по уровню."""
    c.data = True; p = await c.open()
    await import_book(p, 'sample.epub')
    await p.wait_for_selector('.continue >> text=понятно')
    b1 = int(re.search(r'понятно (\d+)%', await p.inner_text('.continue')).group(1))
    # уровень A1 — меньше слов считаются знакомыми, понятность ниже
    await p.click('[data-a="tab"][data-id="settings"]')
    await p.select_option('select[data-a="set-level"][data-id="en"]', 'A1')
    await p.click('[data-a="tab"][data-id="shelf"]'); await p.wait_for_timeout(600); await p.click('[data-a="tab"][data-id="shelf"]')
    a1 = int(re.search(r'понятно (\d+)%', await p.inner_text('.continue')).group(1))
    assert 30 < a1 < b1 < 100, (a1, b1)
    await p.click('[data-a="tab"][data-id="settings"]'); await p.select_option('select[data-a="set-level"][data-id="en"]', 'B1')
    await p.click('[data-a="tab"][data-id="shelf"]')
    await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    s = await p.inner_text('.prep summary'); assert 'понятно' in s, s           # без 300 знакомых слов
    await p.wait_for_selector('.kw li')                                          # ключевые слова без ключа Claude
    kw = await p.inner_text('.kw'); assert 'гугл:' in kw, kw
    await p.locator('#rt p[data-i="0"] w', has_text='morning').first.click(); await p.wait_for_selector('.w-freq')
    assert 'одно из 1 000' in await p.inner_text('.w-freq')
    await close_sheet(p)
    await p.locator('#rt p[data-i="0"] w', has_text='clockmaker').first.click(); await p.wait_for_selector('.w-freq.rare')
    assert 'можно не учить' in await p.inner_text('.w-freq')
    await c.shot('x01-freq'); await close_sheet(p)
    await c.check()

async def x02_cedict(c):
    """2. Китайский: HSK из списка, словарь CC-CEDICT в карточке и как перевод без сети."""
    c.data = True; p = await c.open()
    await xopen(p, 'sample-zh.txt')
    await p.locator('#rt p[data-i="0"] w[data-t="书店"]').first.click(); await p.wait_for_selector('.w-tr')
    await p.wait_for_selector('.ced'); t = await p.inner_text('.sheet')
    assert 'HSK 1' in t, t
    await p.click('.ced summary'); assert 'bookstore' in await p.inner_text('.ced')
    await close_sheet(p)
    c.free.google_down = True; c.free.mm_down = True
    await p.locator('#rt p[data-i="0"] w[data-t="朋友"]').first.click(); await p.wait_for_selector('.w-tr')
    t = await p.inner_text('.sheet'); assert 'friend' in t and 'CC-CEDICT' in t, t
    await c.shot('x02-cedict')
    await p.click('[data-a="w-save"]'); await p.wait_for_selector('[data-a="w-known"]')
    assert 'friend' in await p.evaluate("liveWords('zh')[0].tr")
    await c.check()

async def x03_more_in_book(c):
    """3. «Где ещё в книге»: все места со словом и переход к нужному."""
    c.data = True; p = await c.open()
    await xopen(p, 'sample.epub')
    await p.locator('#rt p[data-i="0"] w', has_text='clockmaker').first.click(); await p.wait_for_selector('[data-a="w-more"]')
    n = int(re.search(r'(\d+)', await p.inner_text('[data-a="w-more"]')).group(1)); assert n > 10, n
    await p.click('[data-a="w-more"]'); await p.wait_for_selector('.occ li')
    last = p.locator('[data-a="goto-occ"]').last; target = await last.get_attribute('data-id')
    await c.shot('x03-occ')
    await last.click(); await p.wait_for_selector('.sheet', state='detached'); await p.wait_for_timeout(400)
    ci, pi = map(int, target.split(':'))
    assert await p.evaluate('R.ch') == ci
    vis = await p.evaluate(f"(()=>{{const el=document.querySelector('#rt p[data-i=\"{pi}\"]');const r=el.getBoundingClientRect();return r.top>=0&&r.top<innerHeight}})()")
    assert vis, 'абзац виден'
    await c.check()

async def x04_paragraph(c):
    """4. Перевод абзаца: правая кнопка мыши, долгое нажатие и кнопка в карточке слова."""
    c.data = True; c.mobile = False; p = await c.open()
    await xopen(p, 'sample.epub')
    await p.locator('#rt p[data-i="1"]').click(button='right'); await p.wait_for_selector('.para-tr')
    t = await p.inner_text('.para-tr'); assert t.startswith('гугл:') and 'clockmaker' in t, t
    await c.shot('x04-paragraph'); await close_sheet(p)
    await p.locator('#rt p[data-i="2"] w').nth(2).click(); await p.wait_for_selector('[data-a="w-para"]')
    await p.click('[data-a="w-para"]'); await p.wait_for_selector('.para-tr')
    orig = await p.inner_text('.para-orig'); assert orig == await p.evaluate("R.c.chapters[R.ch].p[2]"), orig[:80]
    await close_sheet(p)
    # долгое нажатие (мышью удерживаем)
    await p.locator('#rt p[data-i="3"]').scroll_into_view_if_needed(); box = await p.locator('#rt p[data-i="3"]').bounding_box()
    await p.mouse.move(box['x'] + 40, box['y'] + 10); await p.mouse.down(); await p.wait_for_timeout(800); await p.mouse.up()
    await p.wait_for_selector('.para-tr'); assert await p.locator('.w-tr').count() == 0
    await c.check()

async def x05_quotes_bookmarks(c):
    """5. Цитаты из выделения (с переводом, на полке, переход к месту) и закладки."""
    c.data = True; p = await c.open()
    await xopen(p, 'sample.fb2')
    await p.evaluate("""()=>{const ps=document.querySelectorAll('#rt p[data-i="2"] w');const r=document.createRange();r.setStartBefore(ps[0]);r.setEndAfter(ps[6]);const s=getSelection();s.removeAllRanges();s.addRange(r)}""")
    await p.wait_for_selector('#selchip'); await c.shot('x05-selchip')
    await p.click('#selchip >> text=В цитаты'); await p.wait_for_selector('text=Цитата сохранена')
    await p.wait_for_function("Object.values(S.quotes).length===1 && Object.values(S.quotes)[0].tr")
    q = await p.evaluate("Object.values(S.quotes)[0]")
    assert q['text'].startswith('Wiedźmin szedł powoli') and q['p'] == 2 and q['tr'].startswith('гугл:'), q
    # закладка
    await p.evaluate("(()=>{const ps=document.querySelectorAll('#rt p');document.getElementById('rs').scrollTop = ps[ps.length-3].offsetTop})()")
    await p.wait_for_timeout(400); last = await p.evaluate("R.c.chapters[R.ch].p.length")
    await p.click('[data-a="r-menu"]'); await p.click('[data-a="mark-add"]'); await p.wait_for_selector('[data-a="mark-go"]')
    m = await p.evaluate("curBook().marks[0]"); assert m['p'] >= last - 5 and m['p'] > 3, (m, last)
    await c.shot('x05-marks'); await p.keyboard.press('Escape'); await p.wait_for_selector('.sheet', state='detached')
    await p.evaluate("document.getElementById('rs').scrollTop = 0"); await p.wait_for_timeout(300)
    await p.click('[data-a="r-menu"]'); await p.click('[data-a="mark-go"]'); await p.wait_for_selector('.sheet', state='detached'); await p.wait_for_timeout(400)
    assert await p.evaluate('R.p') >= m['p'] - 1
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    await p.wait_for_selector('.quote'); t = await p.inner_text('main'); assert 'Цитаты' in t and 'Wiedźmin szedł powoli' in t
    await c.shot('x05-shelf-quotes')
    await p.click('[data-a="quote-open"]'); await p.wait_for_selector('#rt w'); await p.wait_for_timeout(300)
    assert await p.evaluate('R.p') in (1, 2, 3), await p.evaluate('R.p')
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    await p.click('[data-a="quote-del"]'); await p.wait_for_selector('.quote', state='detached')
    await c.check()

async def x06_rich_text(c):
    """6. Курсив, жирный и иллюстрации из EPUB и FB2."""
    c.data = True; c.mobile = False; p = await c.open()
    await xopen(p, 'rich.epub')
    fm = await p.evaluate("(()=>{const t=s=>[...document.querySelectorAll('#rt '+s)].map(e=>e.textContent.trim()).filter(Boolean);return {i:t('i'),b:t('b'),bi:t('b > i')}})()")
    assert 'very' in fm['i'] and 'slowly' in fm['i'] and 'once' in fm['b'] and 'bold' in fm['bi'] and 'italic' in fm['i'], fm
    imgs = await p.evaluate("[...document.querySelectorAll('#rt img')].map(i=>[i.src.slice(0,22), i.naturalWidth])")
    assert len(imgs) == 1 and imgs[0][0] == 'data:image/jpeg;base64' and imgs[0][1] == 900, imgs   # иконка 20px отброшена
    txt = await p.evaluate("R.c.chapters[0].p.slice(0,4)")
    assert txt[0].startswith('She read the letter very slowly'), txt
    await p.locator('#rt w', has_text='slowly').first.click(); await p.wait_for_selector('.w-tr'); await close_sheet(p)
    await c.shot('x06-rich-epub')
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    await import_book(p, 'rich.fb2'); await p.evaluate("openBook(Object.values(S.books).find(b=>b.title==='Zegar').id)"); await p.wait_for_selector('#rt w')
    fm = await p.evaluate("(()=>{const t=s=>[...document.querySelectorAll('#rt '+s)].map(e=>e.textContent.trim()).filter(Boolean);return {i:t('i'),b:t('b')}})()")
    assert 'bardzo' in fm['i'] and 'powoli' in fm['i'] and 'jeszcze' in fm['b'], fm
    assert await p.locator('#rt img').count() == 1
    await c.check()

async def x07_search_spread(c):
    """7. Поиск по книге и разворот в две колонки на широком экране."""
    c.data = True; c.mobile = False; p = await c.open()
    await xopen(p, 'sample.epub')
    await p.click('[data-a="r-menu"]'); await p.click('[data-a="r-search"]'); await p.wait_for_selector('#bsearch')
    await p.fill('#bsearch', 'loose text'); await p.wait_for_selector('#bsearch-res [data-a="goto-occ"]')
    await c.shot('x07-search')
    await p.click('#bsearch-res [data-a="goto-occ"]'); await p.wait_for_selector('.sheet', state='detached'); await p.wait_for_timeout(300)
    assert await p.evaluate('R.ch') == 1
    # разворот
    await p.evaluate("goChapter(0)")
    await p.click('[data-a="r-menu"]'); await p.click('[data-a="spread"]:not([disabled])'); await p.wait_for_selector('.reader.spread')
    await p.keyboard.press('Escape'); await p.wait_for_selector('.sheet', state='detached')
    cols = await p.evaluate("getComputedStyle(document.querySelector('.r-col')).columnCount"); assert cols == '2', cols
    sw = await p.evaluate("(()=>{const rs=document.getElementById('rs');return [rs.scrollWidth, rs.clientWidth]})()")
    assert sw[0] > sw[1] * 1.5, sw
    await c.shot('x07-spread')
    await p.keyboard.press('ArrowRight'); await p.wait_for_timeout(300)
    sl = await p.evaluate("document.getElementById('rs').scrollLeft"); assert sl > 500, sl
    pos1 = await p.evaluate('R.p'); assert pos1 > 0, pos1
    await p.keyboard.press('ArrowLeft'); await p.wait_for_timeout(300)
    assert await p.evaluate("document.getElementById('rs').scrollLeft") == 0
    for _ in range(40):
        await p.keyboard.press('ArrowRight'); await p.wait_for_timeout(60)
        if await p.evaluate('R.ch') == 1: break
    assert await p.evaluate('R.ch') == 1, 'дошли до следующей главы'
    assert await p.evaluate("Object.values(S.books)[0].done") == [0]
    # на узком экране разворот выключается сам
    await p.set_viewport_size({'width': 800, 'height': 800}); await p.wait_for_timeout(300)
    assert await p.locator('.reader.spread').count() == 0
    await c.check()

async def x08_new_cards(c):
    """8. Новые карточки: выбор перевода, сборка предложения, диктант."""
    c.data = True; c.init_script = SPEECH_MOCK; p = await c.open(); await set_key(p)
    await xopen(p, 'sample.fb2')
    for word in ['Wiedźmin', 'mgła', 'ścieżką', 'powoli', 'las']:
        await p.locator('#rt p[data-i="0"] w', has_text=word).first.click(); await p.wait_for_selector('[data-a="w-save"]')
        await p.click('[data-a="w-save"]'); await p.wait_for_selector('[data-a="w-known"]'); await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    await p.evaluate("liveWords('pl').forEach(w=>{w.srs={due:now()-1000,reps:5,lapses:0,s:10,d:5,last:now()-10*DAY,ivl:10}})")
    types = await p.evaluate("liveWords('pl').map(w=>cardType(w))")
    print('   types:', types)
    await p.click('[data-a="tab"][data-id="words"]'); await p.click('[data-a="rv-start"]'); await p.wait_for_selector('.card')
    # выбор
    await p.evaluate("RV.type='choice';RV.opts=null;renderReview()")
    await p.wait_for_selector('.choices .choice'); assert await p.locator('.choices .choice').count() == 4
    right = await p.evaluate("S.words[RV.q[0]].tr")
    await c.shot('x08-choice')
    await p.click(f'.choices .choice >> text="{right}"'); await p.wait_for_selector('.check.ok')
    assert 'primary' in await p.get_attribute('[data-a="rv-grade"][data-id="2"]', 'class')
    await p.click('[data-a="rv-grade"][data-id="2"]')
    # сборка предложения
    await p.evaluate("RV.type='order';RV.order=null;renderReview()"); await p.wait_for_selector('.ord-pool')
    target = await p.evaluate("RV.order.target")
    await c.shot('x08-order')
    for i in range(len(target)): await p.click(f'.ord-pool [data-a="ord-pick"][data-id="{i}"]')
    await p.click('[data-a="ord-check"]'); await p.wait_for_selector('.check.ok')
    await p.click('[data-a="rv-grade"][data-id="2"]')
    # диктант: озвучивается предложение, ответ сравнивается по словам
    await p.evaluate("RV.type='dictation';renderReview()")
    await p.wait_for_selector('#rv-dict')
    sent = await p.evaluate("pickCtx(S.words[RV.q[0]]).s")
    await p.fill('#rv-dict', sent.replace('ś', 's')); await p.press('#rv-dict', 'Enter'); await p.wait_for_selector('.dict-diff')
    assert await p.locator('.dict-diff .d-near').count() >= 1 and await p.locator('.check.almost, .check.ok').count() == 1
    await c.shot('x08-dictation')
    await p.click('[data-a="rv-grade"][data-id="1"]')
    await c.check()

async def x09_say_after(c):
    """9. Повторить за диктором: распознавание речи и сравнение по словам."""
    c.data = True; c.init_script = SPEECH_MOCK; p = await c.open(); await set_key(p)
    await xopen(p, 'sample.fb2')
    await p.locator('#rt p[data-i="0"] w', has_text='mgła').first.click(); await p.wait_for_selector('[data-a="say"]')
    await p.click('[data-a="say"]'); await p.wait_for_selector('.speech .dict-diff')
    assert await p.evaluate('window.__srLang') == 'pl-PL'
    ok = await p.locator('.speech .d-ok').count(); miss = await p.locator('.speech .d-miss').count()
    assert ok == 5 and miss >= 5, (ok, miss)
    assert 'услышано' in await p.inner_text('.speech')
    await c.shot('x09-say'); await close_sheet(p)
    # абзац
    await p.locator('#rt p[data-i="1"]').click(button='right'); await p.wait_for_selector('.para-tr')
    await p.click('[data-a="say"][data-id="para"]'); await p.wait_for_selector('.speech .dict-diff')
    # без поддержки распознавания кнопки нет
    c2 = Ctx(c.pw, c.browser, c.url, c.claude, c.backend, False); c2.data = True
    c2.init_script = 'delete window.SpeechRecognition; delete window.webkitSpeechRecognition; window.webkitSpeechRecognition=undefined;'
    p2 = await c2.open(); await xopen(p2, 'sample.fb2')
    await p2.locator('#rt p[data-i="0"] w', has_text='mgła').first.click(); await p2.wait_for_selector('.w-tr')
    assert await p2.locator('[data-a="say"]').count() == 0
    await c2.check(); await c2.close(); await c.check()

async def x10_mini_review(c):
    """10. Мини-повторение до 5 слов перед главой и возврат к чтению."""
    c.data = True; p = await c.open(); await set_key(p)
    await xopen(p, 'sample.fb2')
    for word in ['Wiedźmin', 'mgła', 'ścieżką', 'powoli', 'las', 'unosiła', 'wiedział']:
        await p.locator('#rt p[data-i="0"] w', has_text=word).first.click(); await p.wait_for_selector('[data-a="w-save"]')
        await p.click('[data-a="w-save"]'); await p.wait_for_selector('[data-a="w-known"]'); await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    await p.evaluate("goChapter(1)"); await p.wait_for_timeout(200)
    if not await p.locator('.prep[open]').count(): await p.click('.prep > summary')
    await p.wait_for_selector('[data-a="mini-review"]'); assert 'Повторить 5 слов' in await p.inner_text('[data-a="mini-review"]')
    await c.shot('x10-prep')
    await p.click('[data-a="mini-review"]'); await p.wait_for_selector('.card')
    assert await p.evaluate('RV.total') == 5
    for _ in range(5):
        await p.click('[data-a="rv-show"]'); await p.click('[data-a="rv-grade"][data-id="2"]')
    await p.wait_for_selector('text=Готово'); await p.click('[data-a="rv-close"]'); await p.wait_for_selector('.review', state='detached')
    assert await p.locator('.reader').count() == 1 and await p.evaluate('R.ch') == 1
    if not await p.locator('.prep[open]').count(): await p.click('.prep > summary')
    assert 'Повторить 2 слова' in await p.inner_text('.prep')
    await c.check()

async def x11_hanzi(c):
    """11. Порядок черт: анимация и прописывание."""
    c.data = True; p = await c.open()
    await xopen(p, 'sample-zh.txt')
    await p.locator('#rt p[data-i="0"] w[data-t="书店"]').first.click(); await p.wait_for_selector('[data-a="w-strokes"]')
    await p.click('[data-a="w-strokes"]'); await p.wait_for_selector('#hw-box svg path', state='attached')
    assert await p.locator('[data-a="hw-char"]').count() == 2
    await p.wait_for_timeout(800); await c.shot('x11-strokes')
    await p.click('[data-a="hw-char"][data-id="1"]'); await p.wait_for_selector('#hw-box svg path', state='attached')
    await p.click('[data-a="hw-quiz"]'); await p.wait_for_selector('#hw-msg >> text=Веди черты')
    await c.check()

async def x12_tones(c):
    """12. Тоны на слух: 10 слогов, выбор тона, итог."""
    c.data = True; c.init_script = SPEECH_MOCK; p = await c.open()
    await xopen(p, 'sample-zh.txt')
    await p.click('[data-a="r-menu"]'); await p.click('[data-a="tones-start"]'); await p.wait_for_selector('[data-a="tone-pick"]')
    await p.wait_for_timeout(300); assert len(await p.evaluate('__spoken')) >= 1
    await c.shot('x12-tones')
    for i in range(10):
        right = int(await p.evaluate("toneNums(TONE.pool[TONE.i])[0]"))
        await p.click(f'[data-a="tone-pick"][data-id="{(right - 1) if i % 2 == 0 else (right % 4)}"]'); await p.wait_for_selector('.tone-res')
        await p.click('[data-a="tone-next"]')
    await p.wait_for_selector('.tone-score'); assert '5 из 10' in await p.inner_text('.tone-score')
    await c.check()

async def x13_pl_table(c):
    """13. Таблица склонения из Викисловаря с русскими подписями, кэш."""
    c.data = True
    p = await c.open(); await p.route('https://en.wiktionary.org/**', wikt_html)
    await xopen(p, 'sample.fb2')
    await p.locator('#rt p[data-i="0"] w', has_text='mgła').first.click(); await p.wait_for_selector('[data-a="w-table"]')
    await p.click('[data-a="w-table"]'); await p.wait_for_selector('table.infl')
    t = await p.inner_text('table.infl'); assert 'именительный' in t and 'mgłą' in t and 'мн. ч.' in t, t
    assert await p.locator('table.infl a').count() == 0
    await c.shot('x13-table'); await close_sheet(p)
    # неизвестное слово — понятное сообщение
    await p.evaluate("openPlTable('xyzzy')"); await p.wait_for_selector('.sheet .formmsg')
    assert 'нет статьи' in await p.inner_text('.sheet .formmsg')
    await c.check()

async def x14_goals_year(c):
    """14–15. Цели, прогноз окончания книги и календарь года."""
    c.data = True; p = await c.open()
    await xopen(p, 'sample.fb2')
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    await p.click('[data-a="goal-add"]'); await p.wait_for_selector('form[data-form="goal"]')
    await p.click('[data-a="goal-lang"][data-id="pl"]'); await p.fill('input[name=n]', '20')
    await p.click('form[data-form="goal"] button[type=submit]'); await p.wait_for_selector('.goal-c')
    await p.click('[data-a="goal-add"]'); await p.click('[data-a="goal-type"][data-id="book"]'); await p.wait_for_selector('select[name=book]')
    await p.fill('input[name=due]', '2026-12-31'); await p.click('form[data-form="goal"] button[type=submit]')
    await p.wait_for_function("document.querySelectorAll('.goal-c').length===2")
    # знакомые при чтении слова не считаются — только добавленные в повторение и отработанные
    await p.evaluate("(()=>{const kn=knownMap('pl');for(let i=0;i<25;i++)kn['qq'+i]=dnum();render()})()")
    assert 'Цель достигнута' not in await p.inner_text('#goals')
    await p.evaluate("(()=>{for(let i=0;i<22;i++){const id='pl:w'+i;S.words[id]={id,lang:'pl',lemma:'w'+i,forms:['w'+i],ctxs:[],created:now(),st:'learn',u:now(),srs:{due:now()+9*DAY,reps:i<20?3:1,lapses:0,ivl:i<19?9:2}}};S.words['pl:w0'].st='known';save();render()})()")
    t = await p.inner_text('#goals'); assert '19 из 20 слов отработано' in t and 'ещё 3 в повторении' in t, t
    await p.evaluate("S.words['pl:w19'].srs.ivl=8;render()")
    await p.click('[data-a="tab"][data-id="shelf"]'); await p.wait_for_selector('.goal-c.done')
    # прогноз: темп чтения по языку за 2 недели
    await p.evaluate("(()=>{const d=new Date();for(let i=1;i<=7;i++){const x=new Date(d);x.setDate(d.getDate()-i);(S.log[dayKey(x)]=S.log[dayKey(x)]||{})[DEV]={min:10,w_pl:400}};const b=Object.values(S.books)[0];b.last=now();b.read=100;b.words=10000;save();render()})()")
    t = await p.inner_text('.continue'); assert 'дочитаешь ≈' in t, t
    await c.shot('x14-goals')
    await p.click('[data-a="tab"][data-id="diary"]'); await p.wait_for_selector('.year')
    n = await p.locator('.year i').count(); assert 365 <= n <= 371, n
    assert await p.locator('.year i.y2, .year i.y1').count() >= 7
    assert 'дочитаешь' in await p.inner_text('main')
    await c.shot('x14-year')
    await c.check()

async def x15_merge(c):
    """5 и 14. Цитаты и цели синхронизируются: слияние по записям, удаление побеждает по времени."""
    c.data = True; p = await c.open()
    r = await p.evaluate("""(()=>{const a=fresh(),b=fresh();a.quotes.q1={id:'q1',text:'A',u:1};b.quotes.q2={id:'q2',text:'B',u:1};
      a.goals.g1={id:'g1',type:'words',lang:'pl',n:10,start:0,u:5};b.goals.g1={id:'g1',type:'words',lang:'pl',n:10,start:0,del:true,u:9};
      const m=merge(a,b);return [Object.keys(m.quotes).sort(),!!m.goals.g1.del]})()""")
    assert r == [['q1', 'q2'], True], r
    await c.check()

async def x16_offline_data(c):
    """Словари кэшируются отдельно и переживают обновление приложения (проверка sw.js)."""
    src = open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
    assert "DATA_CACHE" in src and "k !== DATA_CACHE" in src and "'extras.js'" in src

async def g01_auth_first(c):
    """Правило: сначала авторизация. Без входа — только экран входа; после входа — приложение; выход возвращает на вход."""
    c.sync = True; c.backend.add_user('g@x.ru', 'secret9')
    p = await c.open()
    await p.wait_for_selector('.gate form[data-form="signin"]')
    assert await p.locator('nav.tabs').count() == 0 and await p.locator('#file').count() == 0
    await c.shot('g01-gate')
    # регистрация и восстановление доступны с экрана входа
    await p.click('[data-a="auth-mode"][data-id="up"]'); await p.wait_for_selector('.gate form[data-form="signup"]')
    await p.click('[data-a="auth-mode"][data-id="in"]'); await p.click('[data-a="auth-mode"][data-id="forgot"]'); await p.wait_for_selector('.gate form[data-form="forgot"]')
    await p.click('[data-a="auth-mode"][data-id="in"]')
    # ссылка из уведомления ждёт входа
    await p.goto(c.url + '?open=pl'); await p.wait_for_selector('.gate form[data-form="signin"]')
    await p.fill('#au-email', 'g@x.ru'); await p.fill('#au-pass', 'nope123'); await p.click('form[data-form="signin"] button[type=submit]')
    await p.wait_for_selector('text=Неверная почта или пароль'); assert await p.locator('nav.tabs').count() == 0
    await login(p, 'g@x.ru', 'secret9')
    await p.wait_for_selector('text=Учить язык, читая свои книги')
    await import_book(p, 'sample.fb2'); await p.wait_for_timeout(500)
    # после перезагрузки вход сохраняется, экран входа не мелькает дольше проверки
    await p.goto(c.url + '?open=pl'); await p.wait_for_selector('#rt w')
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    await p.click('[data-a="tab"][data-id="settings"]'); await p.click('[data-a="signout"]')
    await p.wait_for_selector('.gate form[data-form="signin"]'); assert 'Ты вышла' in await p.inner_text('.gate')
    await c.check()

async def p01_pdf(c):
    """PDF: текст по абзацам, главы по оглавлению, без колонтитулов и номеров страниц, перенос склеен; скан — понятная ошибка."""
    c.data = True; p = await c.open()
    await p.set_input_files('#file', os.path.join(T, 'sample.pdf')); await p.wait_for_selector('form[data-form="import"]')
    assert await p.input_value('input[name=title]') == 'Zegar w mgle' and await p.input_value('input[name=author]') == 'Anna Nowak'
    assert 'aria-pressed="true">Польский' in await p.inner_html('.sheet') and '2 главы' in await p.inner_text('.sheet')
    await c.shot('p01-import')
    await p.click('form[data-form="import"] button[type=submit]'); await p.wait_for_selector('form[data-form="import"]', state='detached')
    book = await p.evaluate("idb.get('books', Object.keys(S.books)[0])")
    chs = book['chapters']
    assert [ch['t'] for ch in chs] == ['Rozdział 1', 'Rozdział 2'], [ch['t'] for ch in chs]
    for ch in chs:
        assert len(ch['p']) == 14, [x[:40] for x in ch['p']]
        for x in ch['p']:
            assert 'Zegar w mgle' not in x and not re.search(r'(?<!\()\b\d+\b(?!\))', x), x
            assert x.startswith(('Wiedźmin szedł', 'To była')), x
    assert chs[0]['p'][0] == 'To była długa i bardzo spokojna noc w małej wiosce nad rzeką.', chs[0]['p'][0]
    assert all(re.search(r'na skraju wsi \(\d+\)\.$', x) for x in chs[0]['p'][1:]), chs[0]['p'][1:]
    await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await p.locator('#rt w', has_text='spokojna').first.click(); await p.wait_for_selector('.w-tr'); await close_sheet(p)
    await c.shot('p01-reader')
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    # скан без текста
    await p.set_input_files('#file', os.path.join(T, 'scan.pdf')); await p.wait_for_selector('text=похоже, это скан')
    assert await p.evaluate('Object.keys(S.books).length') == 1
    await c.check()


SEED_PL = """(()=>{const L='pl';const W=[['las','лес','Wiedźmin szedł powoli przez las.'],['mgła','туман','Nie widzę nic przez mgłę.','mgłę'],['ścieżka','тропа','Mgła unosiła się nad ścieżką.','ścieżką'],['powoli','медленно','Wiedźmin szedł powoli przez las.'],['wiedzieć','знать','Nie wiedział jeszcze, że ktoś czeka.','wiedział'],['czekać','ждать','Ktoś na niego czeka przy zegarze.','czeka'],['noc','ночь','To była długa noc.']];
 W.forEach(([lem,tr,sent,f],i)=>{const id=L+':'+lem;S.words[id]={id,lang:L,lemma:lem,tr,forms:[(f||lem).toLowerCase(),lem],ctxs:[{s:sent,f:f||lem,tr:'',b:'Droga przez mgłę'}],created:now()-i,st:'learn',u:now(),srs:{due:now()+5*DAY,reps:3,lapses:0,s:5,d:5,last:now()-DAY,ivl:5}}});save();render()})()"""

async def solve_item(p):
    """Решает текущее задание упражнения правильно (по данным D), затем жмёт «Дальше»."""
    k = await p.evaluate("D.items[D.i].k")
    if k == 'choice':
        a = await p.evaluate("D.items[D.i].a"); await p.click(f'[data-a="dr-pick"][data-id="{a}"]')
    elif k == 'build':
        for i in await p.evaluate("D.items[D.i].target"): await p.click(f'.ord-pool [data-a="dr-build"][data-id="{i}"]')
        await p.click('[data-a="dr-check"]')
    elif k == 'gaps':
        bank = await p.evaluate("(()=>{const it=D.items[D.i];const used=new Set();return it.answers.map(a=>{const i=it.bank.findIndex((b,j)=>!used.has(j)&&keyOf(b,D.lang)===keyOf(a,D.lang));used.add(i);return i})})()")
        for i in bank: await p.click(f'.ord-pool [data-a="dr-bank"][data-id="{i}"]')
        await p.click('[data-a="dr-check"]')
    elif k == 'input':
        n = await p.evaluate("D.items[D.i].fields.length")
        for i in range(n): await p.fill(f'input[name="a{i}"]', await p.evaluate(f"D.items[D.i].fields[{i}].ans[0]"))
        await p.click('form[data-form="dr-input"] button[type=submit]')
    elif k == 'dict':
        await p.fill('#dr-dict', await p.evaluate("D.items[D.i].text")); await p.press('#dr-dict', 'Enter')
    elif k == 'find':
        o = await p.evaluate("(()=>{const it=D.items[D.i];return [...document.querySelectorAll('[data-a=\"dr-tap\"]')].find(w=>it.keys.has(w.dataset.k)).dataset.id})()")
        await p.click(f'[data-a="dr-tap"][data-id="{o}"]')
    elif k == 'pairs':
        for i in range(5):
            await p.click(f'[data-a="dr-pl"][data-id="{i}"]'); await p.click(f'[data-a="dr-pr"][data-id="{i}"]')
    await p.wait_for_selector('[data-a="dr-next"]'); await p.click('[data-a="dr-next"]')

async def run_drill(p, id, expect_all=True):
    await p.click(f'[data-a="dr-start"][data-id="{id}"]'); await p.wait_for_function("D && !D.busy")
    err = await p.evaluate("D.err||''"); assert not err, (id, err)
    n = await p.evaluate("D.items.length")
    for _ in range(n): await solve_item(p)
    await p.wait_for_selector('.drill-score'); sc = await p.inner_text('.drill-score')
    if expect_all: a, b = re.findall(r'\d+', sc); assert a == b and int(a) > 0, (id, sc)
    return sc

async def e01_hub_no_claude(c):
    """Claude убран: нет ключа и упоминаний; раздел «Упражнения»: пусто без книг, условия у недоступных упражнений."""
    c.data = True; p = await c.open()
    await p.click('[data-a="tab"][data-id="settings"]'); assert await p.locator('input[name="key"]').count() == 0
    await p.click('[data-a="tab"][data-id="ex"]'); await p.wait_for_selector('text=Упражнения строятся на твоих книгах')
    await p.click('[data-a="tab"][data-id="shelf"]'); await xopen(p, 'sample.fb2'); await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    await p.click('[data-a="tab"][data-id="ex"]'); await p.wait_for_selector('.ex-grid')
    t = await p.inner_text('.ex-grid')
    for x in ['Пары', 'Пропуски в абзаце', 'Найди в тексте', 'На слух', 'Спринт', 'Собери предложение', 'Диктант', 'Падежи', 'Предлоги и падежи']: assert x in t, x
    assert 'Неправильные глаголы' not in t and 'Пиньинь' not in t
    assert await p.get_attribute('[data-a="dr-start"][data-id="pairs"]', 'aria-disabled') == 'true'
    await p.click('[data-a="dr-start"][data-id="pairs"]', force=True); await p.wait_for_selector('text=Нужно хотя бы 5 слов')
    await c.shot('e01-hub')
    for tab in ['shelf', 'words', 'ex', 'diary', 'settings']:
        await p.click(f'[data-a="tab"][data-id="{tab}"]'); assert 'Claude' not in await p.inner_text('main'), tab
    await c.check()

async def e02_pairs_sprint(c):
    """Пары с ошибкой (слово уходит в повторение), спринт на время."""
    c.data = True; p = await c.open()
    await import_book(p, 'sample.fb2'); await p.evaluate(SEED_PL)
    await p.click('[data-a="tab"][data-id="ex"]'); await p.click('[data-a="dr-start"][data-id="pairs"]'); await p.wait_for_selector('.pairs')
    await c.shot('e02-pairs')
    await p.click('[data-a="dr-pl"][data-id="0"]'); await p.click('[data-a="dr-pr"][data-id="1"]'); await p.wait_for_selector('.pair.bad')
    wid = await p.evaluate("D.items[0].words[0].id")
    for i in range(5): await p.click(f'[data-a="dr-pl"][data-id="{i}"]'); await p.click(f'[data-a="dr-pr"][data-id="{i}"]')
    await p.click('[data-a="dr-next"]'); sc = await p.inner_text('.drill-score'); assert sc == '4 из 5', sc
    assert await p.evaluate(f"S.words['{wid}'].srs.due <= now()"), 'ошибка — слово к повторению'
    await c.shot('e02-summary')
    await p.click('[data-a="dr-close"]'); await p.wait_for_selector('.drill', state='detached')
    await p.click('[data-a="dr-start"][data-id="sprint"]'); await p.wait_for_selector('[data-a="dr-sp"]')
    for _ in range(6):
        truth = await p.evaluate("D.sp.cur.truth"); await p.click(f'[data-a="dr-sp"][data-id="{1 if truth else 0}"]')
    await p.keyboard.press('ArrowRight')
    await c.shot('e02-sprint')
    await p.evaluate("D.sp.end = now()"); await p.wait_for_selector('.drill-score')
    assert re.match(r'\d+ из 7', await p.inner_text('.drill-score'))
    assert await p.evaluate("dayTotals(today()).ex") == 2
    await c.check()

async def e03_text_drills(c):
    """Пропуски в абзаце, найди в тексте, собери предложение, на слух, диктант."""
    c.data = True; c.init_script = SPEECH_MOCK; p = await c.open()
    await import_book(p, 'sample.fb2'); await p.evaluate(SEED_PL)
    await p.click('[data-a="tab"][data-id="ex"]')
    await p.click('[data-a="dr-start"][data-id="gaps"]'); await p.wait_for_selector('.gap-slot')
    await c.shot('e03-gaps')
    # неверное заполнение: слова в обратном порядке
    await p.evaluate("(()=>{const it=D.items[0];D.st.fill=it.answers.map((a,i)=>it.bank.indexOf(it.answers[it.answers.length-1-i]));paintDrill()})()")
    await p.click('[data-a="dr-check"]'); await p.wait_for_selector('.gap-slot.wrong'); await c.shot('e03-gaps-checked')
    await p.click('[data-a="dr-next"]')
    for _ in range(await p.evaluate("D.items.length") - 1): await solve_item(p)
    await p.wait_for_selector('.drill-score'); await p.click('[data-a="dr-close"]'); await p.wait_for_selector('.drill', state='detached')
    await run_drill(p, 'find'); await p.click('[data-a="dr-close"]')
    await run_drill(p, 'order'); await p.click('[data-a="dr-close"]')
    sc = await run_drill(p, 'listen'); assert len(await p.evaluate('__spoken')) >= 3
    await p.click('[data-a="dr-close"]')
    await run_drill(p, 'dictation'); await c.shot('e03-dictation-summary'); await p.click('[data-a="dr-close"]')
    await c.check()

async def e04_polish_grammar(c):
    """Падежи (формы из Викисловаря) и предлоги с падежами."""
    c.data = True; p = await c.open(); await p.route('https://en.wiktionary.org/**', wikt_html)
    await import_book(p, 'sample.fb2'); await p.evaluate(SEED_PL)
    await p.click('[data-a="tab"][data-id="ex"]')
    await p.click('[data-a="dr-start"][data-id="cases"]'); await p.wait_for_function("D && !D.busy")
    assert not await p.evaluate("D.err||''"), await p.evaluate("D.err")
    assert 'mgł' in await p.inner_text('.drill-card'); await c.shot('e04-cases')
    a = await p.evaluate("D.items[0].a"); await p.click(f'[data-a="dr-pick"][data-id="{a}"]')
    ex = await p.inner_text('.drill-ex'); assert 'винительный' in ex, ex
    await p.click('[data-a="dr-next"]'); await p.wait_for_selector('.drill-score'); await p.click('[data-a="dr-close"]')
    await p.click('[data-a="dr-start"][data-id="preps"]'); await p.wait_for_function("D && !D.busy")
    items = await p.evaluate("D.items.map(x=>x.ex)"); assert any('przez' in x for x in items), items
    await c.shot('e04-preps')
    wrong = await p.evaluate("(D.items[0].a+1)%4"); await p.click(f'[data-a="dr-pick"][data-id="{wrong}"]'); await p.wait_for_selector('.choice.wrong')
    await p.click('[data-a="dr-next"]')
    for _ in range(await p.evaluate("D.items.length") - 1): await solve_item(p)
    sc = await p.inner_text('.drill-score'); assert sc.startswith('7 из 8'), sc
    await c.check()

async def e05_english_irregular(c):
    """Неправильные глаголы из книг: ввод двух форм, «Не знаю»."""
    c.data = True; p = await c.open()
    await import_book(p, 'sample.epub')
    await p.click('[data-a="tab"][data-id="ex"]'); await p.click('[data-a="dr-start"][data-id="irregular"]'); await p.wait_for_function("D && !D.busy")
    bases = await p.evaluate("D.items.map(x=>x.q)"); assert any('>wind<' in b for b in bases) and any('>feel<' in b for b in bases), bases
    await p.fill('input[name="a0"]', await p.evaluate("D.items[0].fields[0].ans[0]")); await p.fill('input[name="a1"]', 'wrong')
    await c.shot('e05-irregular'); await p.click('form[data-form="dr-input"] button[type=submit]'); await p.wait_for_selector('.drill-ans s')
    await p.click('[data-a="dr-next"]'); await p.click('[data-a="dr-skip"]'); await p.click('[data-a="dr-next"]')
    for _ in range(6): await solve_item(p)
    assert (await p.inner_text('.drill-score')).startswith('6 из 8')
    await c.check()

async def e06_chinese(c):
    """Пиньинь ↔ иероглиф, собери слово, счётные слова; тоны и порядок черт из раздела."""
    c.data = True; c.init_script = SPEECH_MOCK; p = await c.open()
    await import_book(p, 'sample-zh.txt')
    await p.click('[data-a="tab"][data-id="ex"]'); t = await p.inner_text('.ex-grid')
    assert all(x in t for x in ['Пиньинь', 'Собери слово', 'Счётные слова', 'Тоны на слух', 'Порядок черт']), t
    await run_drill(p, 'pinyin'); await c.shot('e06-pinyin-summary'); await p.click('[data-a="dr-close"]')
    await p.click('[data-a="dr-start"][data-id="compose"]'); await p.wait_for_function("D && !D.busy"); await c.shot('e06-compose')
    for _ in range(await p.evaluate("D.items.length")): await solve_item(p)
    await p.click('[data-a="dr-close"]')
    await p.click('[data-a="dr-start"][data-id="measure"]'); await p.wait_for_function("D && !D.busy")
    assert not await p.evaluate("D.err||''"), await p.evaluate("D.err")
    await c.shot('e06-measure')
    for _ in range(await p.evaluate("D.items.length")): await solve_item(p)
    await p.click('[data-a="dr-close"]'); await p.wait_for_selector('.drill', state='detached')
    await p.click('[data-a="dr-start"][data-id="tones"]'); await p.wait_for_selector('[data-a="tone-pick"]'); await close_sheet(p)
    await p.click('[data-a="dr-start"][data-id="strokes"]'); await p.wait_for_selector('#hw-box svg path', state='attached')
    await c.check()

async def e07_daily(c):
    """Тренировка дня: четыре упражнения подряд, отметка в разделе и дневнике."""
    c.data = True; c.init_script = SPEECH_MOCK; p = await c.open(); await p.route('https://en.wiktionary.org/**', wikt_html)
    await import_book(p, 'sample.fb2'); await p.evaluate(SEED_PL)
    await p.click('[data-a="tab"][data-id="ex"]'); await p.click('[data-a="dr-daily"]'); await p.wait_for_function("D && !D.busy")
    assert await p.evaluate("D.queue") == ['pairs', 'gaps', 'preps', 'cases'], await p.evaluate("D.queue")
    await c.shot('e07-daily-1')
    for step in range(4):
        await p.wait_for_function("D && !D.busy")
        if not await p.evaluate("D.err||''"):
            for _ in range(await p.evaluate("D.items.length")): await solve_item(p)
        if step < 3: await p.click('[data-a="dr-step"]')
    await p.wait_for_selector('text=Тренировка дня выполнена'); await c.shot('e07-daily-done')
    await p.click('[data-a="dr-close"]'); await p.wait_for_selector('.drill', state='detached')
    assert await p.evaluate("dayTotals(today()).drill") == 1
    assert '✓ Ещё раз' in await p.inner_text('.daily')
    await p.click('[data-a="tab"][data-id="diary"]'); assert 'тренировка дня ✓' in await p.inner_text('main')
    await c.check()

async def e08_chapter_gaps(c):
    """Из итога главы: пропуски в абзацах этой главы поверх читалки, возврат к чтению."""
    c.data = True; p = await c.open()
    await xopen(p, 'sample.epub'); await to_chapter_end(p)
    await p.click('[data-a="dr-chapter"]'); await p.wait_for_function("D && !D.busy")
    assert await p.evaluate("D.opt.ch") == 0 and await p.evaluate("D.items.length") >= 1
    srcs = await p.evaluate("D.items.map(x=>x.toks.map(t=>t.t).join(''))"); ch0 = await p.evaluate("R.c.chapters[0].p")
    assert all(s in ch0 for s in srcs)
    await p.keyboard.press('Escape'); await p.wait_for_selector('.drill', state='detached')
    assert await p.locator('.reader').count() == 1
    await c.check()

EXTRAS_CASES = [e01_hub_no_claude, e02_pairs_sprint, e03_text_drills, e04_polish_grammar, e05_english_irregular, e06_chinese, e07_daily, e08_chapter_gaps, p01_pdf, g01_auth_first, x01_freq_levels, x02_cedict, x03_more_in_book, x04_paragraph, x05_quotes_bookmarks, x06_rich_text, x07_search_spread,
                x08_new_cards, x09_say_after, x10_mini_review, x11_hanzi, x12_tones, x13_pl_table, x14_goals_year, x15_merge, x16_offline_data]
