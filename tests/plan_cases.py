# Расширенный набор по тест-плану (tests/test-plan.md). Подключается в e2e.py.

async def until(cond, msg, t=8):
    for _ in range(int(t / 0.2)):
        if cond(): return
        await asyncio.sleep(0.2)
    raise AssertionError(msg)

async def open_book(p, i=0):
    await p.locator('.shelf [data-a="open"]').nth(i).click(); await p.wait_for_selector('.reader #rt w')

async def f01_shell(c):
    """F01-H2, F01-E1: 360 и 390 px, все вкладки, вкладки внизу."""
    p = await c.open()
    for w in (360, 390):
        await p.set_viewport_size({'width': w, 'height': 780})
        for t in ('shelf', 'words', 'diary', 'settings'):
            await p.click(f'[data-a="tab"][data-id="{t}"]'); await p.wait_for_timeout(50); await c.check()
        boxes = await p.evaluate("[...document.querySelectorAll('.tab')].map(b=>{const r=b.getBoundingClientRect();return [r.left,r.right,r.bottom]})")
        assert all(l >= 0 and r <= w + 0.5 for l, r, _ in boxes), boxes
        assert all(b > 700 for _, _, b in boxes), 'вкладки не внизу'

async def f01_storage_blocked(c):
    """F01-E2: localStorage бросает исключение, IndexedDB нет."""
    c.init_script = "Object.defineProperty(window,'localStorage',{get(){throw new Error('denied')}});Object.defineProperty(window,'indexedDB',{value:undefined});"
    p = await c.open()
    await import_book(p, 'sample.fb2')
    assert 'Droga przez mgłę' in await p.inner_text('.continue')
    await c.check()

async def f01_dark(c):
    """F01-E3: системная тёмная тема."""
    p = await c.open(); await p.emulate_media(color_scheme='dark'); await p.reload(); await p.wait_for_selector('.brand')
    assert await p.evaluate('document.documentElement.dataset.theme') == 'night'
    await c.check()

async def f02_import_edge(c):
    """F02-H5, E1–E6, N1–N3."""
    p = await c.open()
    async def add(fname, lang=None, title=None, cancel=False):
        await p.set_input_files('#file', os.path.join(T, fname)); await p.wait_for_selector('form[data-form="import"]')
        if title is not None: await p.fill('input[name=title]', title)
        if lang: await p.click(f'[data-a="imp-lang"][data-id="{lang}"]')
        if cancel: await p.click('form[data-form="import"] [data-a="sheet-close"]')
        else: await p.click('form[data-form="import"] button[type=submit]')
        await p.wait_for_selector('form[data-form="import"]', state='detached')
    async def text_of(title):
        return await p.evaluate("t=>idb.get('books',Object.values(S.books).find(b=>b.title===t).id).then(c=>c.chapters.map(x=>x.t+' '+x.p.join(' ')).join(' '))", title)
    # N1 отмена
    await add('sample.fb2', cancel=True); assert await p.evaluate('Object.keys(S.books).length') == 0
    # E1 Windows-1250
    await add('pl-1250.txt'); t = await text_of('pl-1250'); assert 'Zażółć gęślą jaźń' in t, t[:80]
    assert await p.evaluate("Object.values(S.books).find(b=>b.title==='pl-1250').lang") == 'pl'
    # E2 GBK
    await add('zh-gbk.txt'); t = await text_of('zh-gbk'); assert '我想去书店买一本书' in t, t[:60]
    # E3 FB2 в Windows-1250
    await add('pl-1250.fb2'); t = await text_of('Zażółć gęślą jaźń'); assert 'gęś żółta' in t, t[:80]
    # E4 .fb2.zip
    await add('book.fb2.zip'); assert await p.evaluate("Object.values(S.books).some(b=>b.title==='Droga przez mgłę')")
    # E5 поменять название и язык
    await add('plain.txt', lang='en', title='Мой текст'); b = await p.evaluate("Object.values(S.books).find(b=>b.title==='Мой текст')"); assert b['lang'] == 'en', b
    # E6 XSS в названии
    await add('sample.epub', title='<img src=x onerror="window.__x=1">')
    assert await p.evaluate('typeof window.__x') == 'undefined' and await p.locator('main img').count() == 0
    assert '<img src=x' in await p.inner_text('.continue h1')
    # N2 повреждённый EPUB, N3 пустой TXT
    await p.set_input_files('#file', os.path.join(T, 'broken.epub')); await p.wait_for_selector('text=Не получилось открыть «broken.epub»')
    await p.set_input_files('#file', os.path.join(T, 'empty.txt')); await p.wait_for_selector('text=В файле не нашлось текста')
    # H5 несколько файлов
    n = await p.evaluate('Object.keys(S.books).length')
    await p.set_input_files('#file', [os.path.join(T, 'sample.fb2'), os.path.join(T, 'sample-zh.txt')])
    for k in (1, 2):
        await p.wait_for_selector('form[data-form="import"]'); await p.click('form[data-form="import"] button[type=submit]')
        await p.wait_for_function(f'Object.keys(S.books).length === {n + k}')
    await p.wait_for_timeout(400)
    assert await p.locator('form[data-form="import"]').count() == 0 and await p.locator('.sheet').count() == 0
    await c.check()

async def f03_reader_more(c):
    """F03-H2, H3, H4, E1, N1."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.epub'); await open_book(p)
    await p.evaluate("document.getElementById('rs').scrollTop = document.querySelector('#rt p[data-i=\"15\"]').offsetTop")
    await p.wait_for_timeout(500); await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    await p.wait_for_timeout(500); await p.reload(); await p.wait_for_selector('.continue'); await open_book(p)
    vis = await p.evaluate("(()=>{const rs=document.getElementById('rs');const t=rs.getBoundingClientRect().top;return [...document.querySelectorAll('#rt p')].find(e=>e.getBoundingClientRect().bottom>t+8).dataset.i})()")
    assert abs(int(vis) - 15) <= 1, vis
    # H4 A+ меняет размер
    fs0 = await p.evaluate("getComputedStyle(document.getElementById('rt')).fontSize")
    await p.click('[data-a="r-menu"]'); await p.click('.sheet [data-a="fs"][data-id="1"]'); await p.click('.sheet [data-a="fs"][data-id="1"]')
    fs1 = await p.evaluate("getComputedStyle(document.getElementById('rt')).fontSize"); assert float(fs1[:-2]) == float(fs0[:-2]) + 2, (fs0, fs1)
    vis2 = await p.evaluate("(()=>{const rs=document.getElementById('rs');const t=rs.getBoundingClientRect().top;return [...document.querySelectorAll('#rt p')].find(e=>e.getBoundingClientRect().bottom>t+8).dataset.i})()")
    assert abs(int(vis2) - 15) <= 1, ('позиция после A+', vis2)
    # H3 оглавление
    await p.click('[data-a="r-goto"][data-id="1"]'); await p.wait_for_selector('text=Loose text inside a div')
    # E1 Escape: сначала слово, потом книга
    await p.locator('#rt w').first.click(); await p.wait_for_selector('.sheet')
    await p.keyboard.press('Escape'); await p.wait_for_selector('.sheet', state='detached'); assert await p.locator('.reader').count() == 1
    await p.locator('#rt w').first.click(); await p.click('[data-a="w-save"]'); await p.wait_for_selector('[data-a="w-known"]')
    await p.keyboard.press('Escape'); await p.wait_for_selector('.sheet', state='detached'); await p.keyboard.press('Escape'); await p.wait_for_selector('.reader', state='detached')
    # N1 убрать книгу — слова остаются
    await open_book(p); p.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
    await p.click('[data-a="r-menu"]'); await p.click('[data-a="book-del"]'); await p.wait_for_selector('.reader', state='detached')
    assert await p.locator('.continue').count() == 0
    assert await p.evaluate('Object.values(S.words).filter(w=>!w.del).length') == 1
    await c.check()

async def f04_claude_more(c):
    """F04-E1, N1, N2."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.fb2')
    await p.click('[data-a="tab"][data-id="settings"]'); await p.select_option('select[data-a="set-level"][data-id="pl"]', 'C1')
    await p.click('[data-a="tab"][data-id="shelf"]'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await p.locator('#rt w', has_text='las').first.click(); await p.wait_for_selector('.w-tr')
    assert 'Their level: C1' in c.claude.calls[-1]['body']['messages'][0]['content']
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    c.claude.fail = 401
    await p.locator('#rt w', has_text='powoli').first.click(); await p.wait_for_selector('.w-tr')
    t = await p.inner_text('.sheet'); assert 'гугл:powoli' in t and 'Ключ Claude API не подходит' in t, t
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    c.claude.fail = None; c.claude.garbage = True
    await p.locator('#rt w', has_text='szedł').first.click(); await p.wait_for_selector('.w-tr')
    t = await p.inner_text('.sheet'); assert 'гугл:szedł' in t and 'непонятно' in t, t
    await c.check()

async def f05_fallback_more(c):
    """F05-N1, N2."""
    p = await c.open()
    await import_book(p, 'sample.fb2'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    c.free.google_down = True; c.free.mm_down = True
    await p.locator('#rt w', has_text='las').first.click(); await p.wait_for_selector('.formmsg')
    assert 'ни Claude, ни запасные' in await p.inner_text('.sheet')
    c.free.google_down = False; c.free.mm_down = False
    await p.click('[data-a="w-retry"]'); await p.wait_for_selector('.w-tr')
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    await c.ctx.set_offline(True); c.free.google_down = True; c.free.mm_down = True
    await p.locator('#rt w', has_text='powoli').first.click(); await p.wait_for_selector('.formmsg')
    assert 'Нет интернета' in await p.inner_text('.sheet')
    await c.ctx.set_offline(False)
    c.errors.clear(); await c.check()

async def f06_zh_selection(c):
    """F06-E1: выделение иероглифов без пиньиня."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample-zh.txt'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt ruby')
    await p.evaluate("()=>{const ws=document.querySelectorAll('#rt p[data-i=\"0\"] w');const r=document.createRange();r.setStartBefore(ws[5]);r.setEndAfter(ws[6]);const s=getSelection();s.removeAllRanges();s.addRange(r)}")
    await p.wait_for_selector('#selchip'); await p.click('#selchip'); await p.wait_for_selector('.w-tr')
    term = await p.inner_text('.w-term'); assert not any(ch.isascii() and ch.isalpha() for ch in term), term
    await c.check()

async def f07_words_more(c):
    """F07-H2, H3, H5, E1."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.fb2'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    for w in ['mgła', 'las']:
        await p.locator('#rt p[data-i="0"] w', has_text=w).first.click(); await p.click('[data-a="w-save"]'); await p.wait_for_selector('[data-a="w-known"]')
        await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    # другая форма того же слова → та же карточка
    await p.evaluate("openWord({term:'mgłę', lang:'pl', ctx:'Widział mgłę.', book:R.id})"); await p.wait_for_selector('[data-a="w-save"], [data-a="w-known"]')
    if await p.locator('[data-a="w-save"]').count(): await p.click('[data-a="w-save"]')
    await p.wait_for_selector('[data-a="w-known"]'); await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    ws = await p.evaluate("Object.values(S.words).filter(w=>!w.del).map(w=>[w.lemma,w.forms])")
    assert sorted(ws) == [['las', ['las']], ['mgła', ['mgła', 'mgłę']]], ws
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    # E1 слово подсвечено в другой книге на этом языке
    await import_book(p, 'pl-1250.txt'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    hl = await p.evaluate("[...new Set([...document.querySelectorAll('#rt w.s')].map(w=>w.textContent))]"); assert set(hl) == {'mgła', 'las'}, hl
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    # H3 поиск
    await p.click('[data-a="tab"][data-id="words"]'); await p.fill('#wq', 'mgł')
    assert await p.locator('#wlist .wrow').count() == 1
    await p.fill('#wq', '')
    # H5 удалить и «знаю»
    await p.locator('[data-a="wopen"]').first.click(); await p.click('[data-a="d-del"]'); await p.wait_for_selector('.sheet', state='detached')
    await p.locator('[data-a="wopen"]').first.click(); await p.click('[data-a="d-known"]'); await p.wait_for_selector('.sheet', state='detached')
    await p.wait_for_timeout(200)
    st = await p.evaluate("Object.values(S.words).map(w=>[w.lemma,w.st,!!w.del])")
    assert await p.locator('#wlist .wrow').count() == 0, (st, await p.inner_text('#wlist'))
    await p.click('[data-a="ws"][data-id="known"]'); assert await p.locator('#wlist .wrow').count() == 1
    await c.check()

async def f08_review_limit(c):
    """F08-E1, E2."""
    p = await c.open()
    await import_book(p, 'sample.fb2')
    await p.evaluate("S.settings.newPerDay=5; for(let i=0;i<7;i++) saveWord({term:'słowo'+i, lang:'pl', ctx:'Zdanie '+i+'.', book:Object.keys(S.books)[0], data:{lemma:'słowo'+i, tr:'t'+i}}, 'learn')")
    assert await p.evaluate("reviewQueue('pl').length") == 5
    await p.click('[data-a="tab"][data-id="words"]'); await p.click('[data-a="rv-start"]')
    for _ in range(5):
        await p.click('[data-a="rv-show"]'); await p.click('[data-a="rv-grade"][data-id="2"]')
    await p.wait_for_selector('text=Готово'); await p.click('[data-a="rv-close"]'); await p.wait_for_selector('.review', state='detached')
    assert await p.is_disabled('[data-a="rv-start"]')
    assert 'на сегодня всё повторено' in await p.inner_text('.deck')
    await c.check()

async def f09_diary(c):
    """F09-H1, H2, E1."""
    p = await c.open()
    await import_book(p, 'sample.fb2'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    for _ in range(8): await p.evaluate('act.last = Date.now(); tickActivity()')
    t = await p.evaluate("[dayTotals(today()).min, langMinutes(today(),'pl'), Object.values(S.books)[0].mins]"); assert t == [2, 2, 2], t
    await p.evaluate('act.last = Date.now() - 180000; tickActivity()')
    assert await p.evaluate('dayTotals(today()).min') == 2, 'время шло без действий'
    await p.evaluate("(()=>{const d=new Date();for(let i=1;i<=2;i++){const x=new Date(d);x.setDate(d.getDate()-i);S.log[dayKey(x)]={z:{min:5}}}})()")
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    await p.click('[data-a="tab"][data-id="diary"]'); assert 'Серия: 3 дня' in await p.inner_text('main')
    await c.check()

async def f10_backup_themes(c):
    """F10-H1, H2, N1."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.fb2'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await p.locator('#rt w', has_text='las').first.click(); await p.click('[data-a="w-save"]'); await p.wait_for_selector('[data-a="w-known"]')
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached'); await p.go_back(); await p.wait_for_selector('.continue')
    await p.click('[data-a="tab"][data-id="settings"]')
    for th in ('sepia', 'night', 'paper'):
        await p.click(f'[data-a="set"][data-k="theme"][data-id="{th}"]')
        assert (await p.evaluate('document.documentElement.dataset.theme || "paper"')) == th
    async with p.expect_download() as dl: await p.click('[data-a="export"]')
    path = os.path.join(OUT, 'backup.json'); await (await dl.value).save_as(path)
    c2 = Ctx(c.pw, c.browser, c.url, c.claude, c.backend, False); p2 = await c2.open()
    await p2.click('[data-a="tab"][data-id="settings"]')
    await p2.set_input_files('#backup', os.path.join(T, 'plain.txt')); await p2.wait_for_selector('text=Это не похоже на копию')
    await p2.set_input_files('#backup', path); await p2.wait_for_selector('text=Копия загружена')
    assert await p2.evaluate("Object.values(S.words).map(w=>w.lemma)") == ['las']
    await c2.check(); await c2.close(); await c.check()

async def f11_sync_more(c):
    """F11-E1, N1, N2."""
    c.backend.add_user('b@x.ru', 'secret2')
    p = await c.open()
    await import_book(p, 'sample.fb2')
    await p.click('[data-a="tab"][data-id="settings"]')
    await p.fill('#au-email', 'b@x.ru'); await p.fill('#au-pass', 'wrongpass'); await p.click('form[data-form="signin"] button[type=submit]')
    await p.wait_for_selector('text=Неверная почта или пароль')
    await p.fill('#au-pass', 'secret2'); await p.click('form[data-form="signin"] button[type=submit]')
    await p.wait_for_function('document.getElementById("status").textContent==="Синхронизировано"', timeout=8000)
    await until(lambda: len(c.backend.files) == 1, 'книга не загрузилась в хранилище')
    c2 = Ctx(c.pw, c.browser, c.url, c.claude, c.backend, True, mobile=False); p2 = await c2.open()
    await p2.click('[data-a="tab"][data-id="settings"]'); await p2.fill('#au-email', 'b@x.ru'); await p2.fill('#au-pass', 'secret2'); await p2.click('form[data-form="signin"] button[type=submit]')
    await p2.wait_for_function('Object.values(S.books).filter(b=>!b.del).length===1', timeout=8000)
    # N2 нет связи
    c.backend.offline = True
    await p.evaluate("S.settings.goal=30; S.settings.u=Date.now(); save(10)")
    await p.wait_for_function('document.getElementById("status").textContent.includes("Нет связи")', timeout=8000)
    c.backend.offline = False; await p.evaluate('sync()')
    await p.wait_for_function('document.getElementById("status").textContent==="Синхронизировано"', timeout=8000)
    # E1 убрать книгу на первом — пропадает на втором и в хранилище
    await p.click('[data-a="tab"][data-id="shelf"]'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    p.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
    await p.click('[data-a="r-menu"]'); await p.click('[data-a="book-del"]'); await p.wait_for_selector('.reader', state='detached')
    await p.wait_for_timeout(1000)
    await until(lambda: not c.backend.files, 'текст книги не удалён из хранилища')
    await p2.evaluate('sync()'); await p2.wait_for_function('Object.values(S.books).filter(b=>!b.del).length===0', timeout=8000)
    await p2.click('[data-a="tab"][data-id="shelf"]'); assert await p2.locator('.continue').count() == 0
    c.errors.clear(); c2.errors.clear()
    await c2.check(); await c2.close(); await c.check()

async def f12_schedule_edit(c):
    """F12-H2."""
    p = await c.open()
    await p.click('[data-a="tab"][data-id="settings"]')
    await p.click('[data-a="sc-add"]'); await p.click('[data-a="sc-day"][data-id="3"]'); await p.click('form[data-form="sched"] button[type=submit]')
    await p.wait_for_selector('.sched li')
    await p.click('[data-a="sc-edit"]'); await p.click('[data-a="sc-day"][data-id="5"]'); await p.fill('input[name=time]', '07:45'); await p.click('form[data-form="sched"] button[type=submit]')
    await p.wait_for_selector('.sched >> text=07:45'); assert 'ср, пт' in await p.inner_text('.sched')
    assert await p.evaluate('S.settings.schedule.length') == 1
    await p.click('[data-a="sc-edit"]'); await p.click('[data-a="sc-del"]'); await p.wait_for_selector('.sched', state='detached')
    assert await p.evaluate('S.settings.schedule.length') == 0
    await c.check()

async def f13_eink_more(c):
    """F13-H2, E1."""
    p = await c.open(); await import_book(p, 'sample.epub')
    await p.click('[data-a="tab"][data-id="settings"]'); await p.click('[data-a="eink"]')
    assert await p.evaluate('document.documentElement.dataset.theme') == 'eink'
    assert 'eink' not in await p.evaluate('JSON.stringify(S.settings)')
    await p.click('[data-a="tab"][data-id="shelf"]'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('.reader.paged')
    swipe = "(dx,dy)=>{const rs=document.getElementById('rs');const o={bubbles:true,clientX:200,clientY:400,pointerId:1};rs.dispatchEvent(new PointerEvent('pointerdown',o));rs.dispatchEvent(new PointerEvent('pointerup',{...o,clientX:200+dx,clientY:400+dy}))}"
    get = "document.getElementById('rs').scrollTop"
    t0 = await p.evaluate(get)
    await p.evaluate(f'({swipe})(0,-200)'); t1 = await p.evaluate(get); assert t1 > t0 + 300, (t0, t1)
    await p.evaluate(f'({swipe})(-200,0)'); t2 = await p.evaluate(get); assert t2 > t1 + 300, (t1, t2)
    await p.evaluate(f'({swipe})(200,0)'); t3 = await p.evaluate(get); assert abs(t3 - t1) < 2, (t1, t3)
    await c.check()

PLAN_CASES = [f01_shell, f01_storage_blocked, f01_dark, f02_import_edge, f03_reader_more, f04_claude_more, f05_fallback_more,
              f06_zh_selection, f07_words_more, f08_review_limit, f09_diary, f10_backup_themes, f11_sync_more, f12_schedule_edit, f13_eink_more]
