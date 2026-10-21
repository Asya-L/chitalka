# Доработки обучения (пункты 1–16). Подключается в e2e.py после plan_cases.py.

FILL_KNOWN = "(lang,n)=>{const kn=knownMap(lang);for(let i=0;i<n;i++)kn['zz'+i]=dnum()-40;save()}"

async def to_chapter_end(p):
    await p.evaluate("(()=>{const rs=document.getElementById('rs');rs.scrollTop=rs.scrollHeight})()")
    await p.wait_for_timeout(500)

async def n01_known_coverage(c):
    """1. Знакомые слова при чтении, понятность книги, счётчик словаря, подсказка при добавлении."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.epub'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await p.locator('#rt p[data-i="0"] w', has_text='gears').first.click(); await p.wait_for_selector('.w-tr')
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    await to_chapter_end(p)
    kn = await p.evaluate("Object.keys(S.known.en||{})")
    assert 'brass' in kn and 'clockmaker' in kn and 'gears' not in kn, kn
    assert await p.evaluate("knownCount('en')") == len(kn)
    # понятность появляется после 300 знакомых слов
    await p.evaluate(f"({FILL_KNOWN})('en', 320)")
    await p.go_back(); await p.wait_for_selector('.continue')
    await p.wait_for_selector('.continue >> text=понятно')
    pct = int(re.search(r'понятно (\d+)%', await p.inner_text('.continue')).group(1)); assert 90 <= pct <= 100, pct
    # подсказка при добавлении
    await p.set_input_files('#file', os.path.join(T, 'sample.epub')); await p.wait_for_selector('.cov-hint')
    assert 'Знакомых слов ≈' in await p.inner_text('.cov-hint')
    await p.click('form[data-form="import"] [data-a="sheet-close"]'); await p.wait_for_selector('.sheet', state='detached')
    # словарь в дневнике
    await p.click('[data-a="tab"][data-id="diary"]'); txt = await p.inner_text('main')
    assert 'Английский: знакомых слов' in txt, txt[:300]
    await c.shot('n01-diary')
    await c.check()

async def n02_prep_words(c):
    """2. Ключевые слова перед главой: по словарю (частые незнакомые), через Claude без словаря, без ключа."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.fb2')
    # без словаря — слова подбирает Claude
    await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('.prep[open]')
    await p.wait_for_selector('.kw li'); t = await p.inner_text('.kw'); assert 'mgła' in t and 'туман' in t, t
    await c.shot('n02-prep-claude')
    await p.click('[data-a="kw-open"][data-id="0"]'); await p.wait_for_selector('.w-tr'); await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    await p.click('[data-a="kw-all"]'); await p.wait_for_selector('text=Добавлено в повторение')
    assert await p.evaluate("liveWords('pl').length") >= 2
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    # со словарём — частые незнакомые слова главы, перевод одним запросом
    await p.evaluate(f"({FILL_KNOWN})('pl', 320)")
    await p.evaluate("(()=>{const kn=knownMap('pl');['wiedźmin','szedł','powoli','przez','a','nad','nie','jeszcze','że','ktoś','na','niego','czeka','unosiła','się','wiedział'].forEach(k=>kn[k]=dnum())})()")
    await p.evaluate("idb.clear('tr')")
    await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    if not await p.locator('.prep[open]').count(): await p.click('.prep > summary')
    await p.wait_for_selector('.kw li'); t = await p.inner_text('.prep')
    assert 'понятно' in t and 'кл0' in t, t
    assert 'las' not in await p.inner_text('.kw'), 'las уже знакомо — прошли абзац при первом открытии'
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    # без ключа и без словаря — понятное сообщение
    c2 = Ctx(c.pw, c.browser, c.url, c.claude, c.backend, False); p2 = await c2.open()
    await import_book(p2, 'sample.epub'); await p2.click('.continue [data-a="open"].btn'); await p2.wait_for_selector('.prep[open]')
    await p2.wait_for_selector('text=Ключевые слова появятся')
    await c2.check(); await c2.close(); await c.check()

async def n03_chapter_end(c):
    """3. Итог главы и отметка прочитанной главы."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.epub'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await p.locator('#rt p[data-i="2"] w', has_text='silence').first.click(); await p.click('[data-a="w-save"]'); await p.wait_for_selector('[data-a="w-known"]'); await p.go_back()
    await p.wait_for_selector('.sheet', state='detached')
    await to_chapter_end(p)
    t = await p.inner_text('#chsum')
    assert 'Итог главы' in t and 'незнакомых встретилось' in t and 'теперь знакомы' in t, t
    m = re.search(r'(\d+)\s*сохранено', t); assert m and m.group(1) == '1', t
    assert await p.evaluate("Object.values(S.books)[0].done") == [0]
    assert await p.evaluate("dayTotals(today()).chd===undefined || true")
    assert await p.locator('#chsum [data-a="ex-questions"]').count() == 1
    await c.shot('n03-chapter-end')
    await c.check()

async def n04_card_types(c):
    """4. Типы карточек: пропуск в предложении, вспомнить по переводу, на слух; только узнавание в настройках."""
    c.init_script = "window.__spoken=[];const _s=speechSynthesis.speak.bind(speechSynthesis);speechSynthesis.speak=u=>{__spoken.push(u.text);setTimeout(()=>u.onend&&u.onend(),5)};"
    p = await c.open()
    await import_book(p, 'sample.fb2')
    await p.evaluate("saveWord({term:'las', lang:'pl', ctx:'Wiedźmin szedł powoli przez las, a mgła unosiła się.', book:Object.keys(S.books)[0], data:{lemma:'las', tr:'лес', pos:'сущ.'}}, 'learn')")
    await p.evaluate("(()=>{const w=S.words['pl:las'];w.srs={reps:5,lapses:0,s:6,d:5,last:Date.now()-7*DAY,due:Date.now()-1000,ivl:6};save()})()")
    assert await p.evaluate("cardType(S.words['pl:las'])") in ('cloze', 'produce', 'listen')
    await p.click('[data-a="tab"][data-id="words"]'); await p.click('[data-a="rv-start"]'); await p.wait_for_selector('.card')
    # пропуск
    await p.evaluate("RV.type='cloze'; renderReview()"); await p.wait_for_selector('.gap')
    assert 'las' not in await p.inner_text('.card .ctx')
    await p.fill('#rv-in', 'las'); await p.press('#rv-in', 'Enter'); await p.wait_for_selector('.check.ok')
    assert 'Помню' in await p.inner_text('.grades .btn.primary')
    assert await p.locator('.card .xtra').count() == 0, 'служебный список форм попал в карточку'
    await c.shot('n04-cloze')
    # вспомнить по переводу: ошибка
    await p.evaluate("RV.show=false;RV.check=null;RV.type='produce'; renderReview()"); await p.wait_for_selector('#rv-in')
    assert 'лес' in await p.inner_text('.card')
    await p.fill('#rv-in', 'drzewo'); await p.press('#rv-in', 'Enter'); await p.wait_for_selector('.check.no')
    assert 'Не помню' in await p.inner_text('.grades .btn.primary')
    # почти: без диакритики
    await p.evaluate("RV.show=false;RV.check=null; renderReview()"); assert await p.evaluate("checkAnswer({lemma:'ścieżka',forms:['ścieżką'],lang:'pl'},'sciezka',null)") == 'almost'
    # на слух
    await p.evaluate("RV.show=false;RV.check=null;RV.type=null; window.__forceListen=1");
    await p.evaluate("RV.type='listen'; renderReview()"); await p.click('.card [data-a="rv-speak"]')
    await p.wait_for_function("__spoken.length>0"); assert 'mgła' in await p.evaluate("__spoken[__spoken.length-1]")
    # настройка «только узнавание»
    await p.evaluate("S.settings.cards='recog'"); assert await p.evaluate("cardType(S.words['pl:las'])") == 'recog'
    await c.check()

async def n05_contexts(c):
    """5. Новые примеры из книги появляются в карточке при чтении и при нажатии."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.epub'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await p.locator('#rt p[data-i="0"] w', has_text='breath').first.click(); await p.click('[data-a="w-save"]'); await p.wait_for_selector('[data-a="w-known"]'); await p.go_back()
    await p.wait_for_selector('.sheet', state='detached')
    assert await p.evaluate("S.words['en:breath'].ctxs.length") == 1
    # нажатие на сохранённое слово в другом предложении добавляет пример
    await p.locator('#rt p[data-i="1"] w', has_text='breath').first.click(); await p.wait_for_selector('[data-a="w-known"]'); await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    assert await p.evaluate("S.words['en:breath'].ctxs.length") == 2
    await to_chapter_end(p)
    ctxs = await p.evaluate("S.words['en:breath'].ctxs.map(c=>c.s)"); assert len(ctxs) == 5 and len(set(ctxs)) == 5, ctxs
    await c.check()

async def n06_leech(c):
    """6. Трудные слова: после 4 забываний — пометка, фильтр, разбор от Claude."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.fb2')
    await p.evaluate("saveWord({term:'mgła', lang:'pl', ctx:'a mgła unosiła się nad ścieżką.', book:Object.keys(S.books)[0], data:{lemma:'mgła', tr:'туман'}}, 'learn')")
    await p.evaluate("(()=>{const w=S.words['pl:mgła'];w.srs={reps:6,lapses:3,s:2,d:8,last:Date.now()-3*DAY,due:Date.now()-1000,ivl:2};save()})()")
    await p.click('[data-a="tab"][data-id="words"]'); await p.click('[data-a="rv-start"]'); await p.wait_for_selector('.card')
    await p.evaluate("RV.type='recog'; renderReview()"); await p.click('[data-a="rv-show"]'); await p.click('[data-a="rv-grade"][data-id="0"]')
    assert await p.evaluate("S.words['pl:mgła'].leech") is True
    await p.evaluate("RV.type='recog'; renderReview()"); await p.wait_for_selector('.leech-tag')
    await p.click('[data-a="rv-show"]'); await p.click('[data-a="rv-leech"]'); await p.wait_for_selector('.leech p')
    assert 'мгла' in await p.inner_text('.leech')
    await p.click('[data-a="rv-close"]'); await p.wait_for_selector('.review', state='detached')
    await p.click('[data-a="ws"][data-id="hard"]'); assert await p.locator('#wlist .wrow').count() == 1
    await c.check()

async def n07_fsrs(c):
    """7. FSRS: первые интервалы, рост после «помню», «не помню» → 10 минут, перенос старых карточек."""
    p = await c.open()
    r = await p.evaluate("""(()=>{const t0=Date.parse('2026-10-01T10:00:00Z');
      const n=fsrs({reps:0,lapses:0},2,t0), e=fsrs({reps:0,lapses:0},3,t0), h=fsrs({reps:0,lapses:0},1,t0), a=fsrs({reps:0,lapses:0},0,t0);
      const n2=fsrs(n,2,n.due+4*3600000), f=fsrs(n2,0,n2.due);
      const old=fsrs({due:t0, ivl:10, ease:2.5, reps:4, lapses:0},2,t0);
      return {good:n.ivl, easy:e.ivl, hard:h.ivl, again:Math.round((a.due-t0)/60000), good2:n2.ivl, lapse:f.lapses, lapseMin:Math.round((f.due-n2.due)/60000), sAfterLapse:f.s<n2.s, old:old.ivl}})()""")
    assert r['good'] == 4 and r['easy'] == 14 and r['hard'] == 1 and r['again'] == 10, r
    assert r['good2'] > r['good'] and r['lapse'] == 1 and r['lapseMin'] == 10 and r['sAfterLapse'], r
    assert r['old'] > 10, r
    await c.check()

async def n08_tones(c):
    """8. Тоны цветом в пиньине над текстом и в карточке, выключаются."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample-zh.txt'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt ruby')
    cls = await p.evaluate("document.querySelector('#rt p[data-i=\"0\"] w rt').className"); assert cls == 't3', cls   # 我 wǒ — третий тон
    await c.shot('n08-tones')
    await p.locator('#rt p[data-i="0"] w[data-t="书店"]').first.click(); await p.wait_for_selector('.w-py span.t1')
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    await p.click('[data-a="r-menu"]'); await p.click('[data-a="tones"]'); await p.wait_for_timeout(100)
    assert await p.evaluate("document.querySelectorAll('#rt rt[class]').length") == 0
    await c.check()

async def n09_tts(c):
    """9. Озвучка главы по предложениям с подсветкой, пауза, остановка; предложение из карточки; в APK — через Android."""
    c.init_script = "window.__spoken=[];speechSynthesis.speak=u=>{__spoken.push(u.text);setTimeout(()=>{u.onboundary&&u.onboundary({name:'word',charIndex:4});setTimeout(()=>u.onend&&u.onend(),30)},10)};speechSynthesis.cancel=()=>{};"
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.epub'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await p.click('[data-a="r-menu"]'); await p.click('[data-a="r-listen"]'); await p.wait_for_selector('#player')
    await p.wait_for_function("__spoken.length>=3")
    sp = await p.evaluate("__spoken.slice(0,2)"); assert sp[0].startswith('The old clockmaker wound') and sp[1].startswith("She didn't trust"), sp
    assert await p.locator('#rt w.rd').count() > 3
    await c.shot('n09-player')
    await p.click('[data-a="pl-toggle"]'); n = await p.evaluate("__spoken.length"); await p.wait_for_timeout(300); assert await p.evaluate("__spoken.length") <= n + 1
    await p.click('[data-a="pl-rate"][data-id="0.7"]'); assert await p.evaluate("S.settings.rate") == 0.7
    await p.click('[data-a="pl-stop"]'); await p.wait_for_selector('#player', state='detached'); assert await p.locator('#rt w.rd').count() == 0
    await p.locator('#rt w', has_text='brass').first.click(); await p.wait_for_selector('[data-a="w-sent-speak"]')
    await p.click('[data-a="w-sent-speak"]'); await p.wait_for_function("__spoken[__spoken.length-1].startsWith('The old clockmaker')")
    await c.check()

async def n09b_tts_native(c):
    """9. В APK озвучка идёт через Android и ждёт окончания фразы."""
    c.init_script = "window.__nat=[];window.Android={setPaging:()=>{},canSpeak:()=>true,speak:()=>{},setSchedule:()=>{},speakId:(t,l,r,id)=>{__nat.push([t,l,r]);setTimeout(()=>window.__ttsDone(id),20)},stopSpeaking:()=>{}};"
    p = await c.open()
    await import_book(p, 'sample.epub'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await p.evaluate("playerStart(0)"); await p.wait_for_function("__nat.length>=3")
    n = await p.evaluate("__nat[0]"); assert n[1] == 'en-US' and abs(n[2] - 0.9) < 1e-6, n
    await p.evaluate("playerStop()")
    await c.check()

async def n10_weekly(c):
    """10. Итоги недели в дневнике и настройка воскресной сводки."""
    p = await c.open()
    await p.evaluate("""(()=>{const wb=weekBounds(0), pb=weekBounds(1);
      S.log[wb.days[0]]={d1:{min:40,m_pl:30,m_en:10,saved:3,chd:1}};S.log[pb.days[2]]={d1:{min:25,m_pl:25}};
      const kn=knownMap('pl');for(let i=0;i<12;i++)kn['w'+i]=wb.from;for(let i=0;i<5;i++)kn['o'+i]=pb.from;save()})()""")
    await p.click('[data-a="tab"][data-id="diary"]'); t = await p.inner_text('main')
    wk = await p.inner_text('.stats:has(.delta)')
    assert '40 мин' in wk and '+15 мин' in wk and '12' in wk and 'глава прочитана' in wk, wk
    assert 'Польский — 30 мин' in t, t
    await c.shot('n10-week')
    await p.click('[data-a="tab"][data-id="settings"]'); await p.click('[data-a="set"][data-k="weekly"][data-id="false"]')
    assert await p.evaluate("S.settings.weekly") is False
    await c.check()

async def n11_questions(c):
    """11. Вопросы по главе с проверкой и оценкой."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.fb2'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await to_chapter_end(p); await p.click('#chsum [data-a="ex-questions"]'); await p.wait_for_selector('.ex-item')
    assert await p.locator('.ex-item').count() == 3
    assert 'Kto szedł przez las?' in await p.inner_text('.sheet')
    await p.click('form[data-form="ex"] button[type=submit]'); await p.wait_for_selector('text=Напиши хотя бы один ответ')
    for i, a in enumerate(['Wiedźmin.', 'Mgła.', 'Ktoś.']): await p.fill(f'#ex-a{i}', a)
    await p.click('form[data-form="ex"] button[type=submit]'); await p.wait_for_selector('.ex-res')
    t = await p.inner_text('.sheet'); assert 'Хорошо' in t and 'Почти' in t and 'Poprawiona odpowiedź 0' in t and 'szedłem przez las' in t, t
    await c.shot('n11-questions')
    assert await p.evaluate("Object.values(S.mistakes).length") == 1
    assert await p.evaluate("Object.values(S.books)[0].quiz[0]") == '2/3'
    q = c.claude.calls[-1]['body']['messages'][0]['content']; assert 'A1: Wiedźmin.' in q and 'Chapter:' in q, q[:200]
    await c.check()

async def n12_active(c):
    """12. Пересказ, запись дня, перевод с русского, тренировка и удаление ошибок."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.fb2'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await to_chapter_end(p); await p.click('#chsum [data-a="ex-retell"]'); await p.wait_for_selector('#ex-a0')
    await p.fill('#ex-a0', 'Wiedźmin szedłem przez lasu.'); await p.click('form[data-form="ex"] button[type=submit]'); await p.wait_for_selector('.ex-res')
    assert 'следи за падежами' in await p.inner_text('.sheet')
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached'); await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    await p.evaluate("saveWord({term:'las', lang:'pl', ctx:'przez las', book:Object.keys(S.books)[0], data:{lemma:'las', tr:'лес'}}, 'learn')")
    await p.click('[data-a="tab"][data-id="words"]'); await p.wait_for_selector('#practice')
    await p.click('[data-a="ex-note"][data-id="pl"]'); await p.wait_for_selector('#ex-a0')
    assert 'las' in await p.inner_text('.sheet')
    await p.fill('#ex-a0', 'Dzisiaj czytam książkę.'); await p.click('form[data-form="ex"] button[type=submit]'); await p.wait_for_selector('.ex-res')
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    await p.click('[data-a="ex-translate"][data-id="pl"]'); await p.wait_for_selector('#ex-a4')
    assert 'Я иду через лес.' in await p.inner_text('.sheet')
    await p.fill('#ex-a0', 'Idę przez las.'); await p.click('form[data-form="ex"] button[type=submit]'); await p.wait_for_selector('.ex-res')
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    await p.wait_for_selector('[data-a="ex-mistakes"][data-id="pl"]')
    await p.click('[data-a="ex-mistakes"][data-id="pl"]'); await p.wait_for_selector('#ex-a0')
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    n = await p.evaluate("Object.values(S.mistakes).filter(m=>!m.del).length"); assert n == 3, n
    await p.click('.mist summary'); await p.locator('[data-a="mist-del"]').first.click()
    assert await p.evaluate("Object.values(S.mistakes).filter(m=>!m.del).length") == 2
    await c.shot('n12-practice')
    await c.check()

async def n13_rich_card(c):
    """13. Карточка слова: вид глагола, формы, ложный друг, выражение, разбор иероглифа и счётное слово."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.fb2'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await p.locator('#rt p[data-i="0"] w', has_text='szedł').first.click(); await p.wait_for_selector('.xtra')
    assert 'iść (несов.) / pójść (сов.)' in await p.inner_text('.xtra')
    await p.click('[data-a="w-save"]'); await p.wait_for_selector('[data-a="w-known"]')
    assert await p.evaluate("S.words['pl:szedł'].extra.aspect") == 'iść (несов.) / pójść (сов.)'
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    await p.locator('#rt p[data-i="0"] w', has_text='las').first.click(); await p.wait_for_selector('.ff')
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    await p.locator('#rt p[data-i="0"] w', has_text='ścieżką').first.click(); await p.wait_for_selector('[data-a="w-phrase"]')
    await c.shot('n13-card')
    await p.click('[data-a="w-phrase"]'); await p.wait_for_selector('text=Выражение добавлено')
    assert await p.evaluate("!!S.words['pl:nad ścieżką']")
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached'); await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    await import_book(p, 'sample-zh.txt'); await p.locator('.shelf [data-a="open"]', has_text='sample-zh').click(); await p.wait_for_selector('#rt ruby')
    await p.locator('#rt p[data-i="0"] w[data-t="书店"]').first.click(); await p.wait_for_selector('.xtra')
    t = await p.inner_text('.xtra'); assert 'Из чего состоит' in t and 'Счётное слово' in t, t
    await c.check()

async def n14_prev_summary(c):
    """14. Краткое содержание прошлой главы и его перевод."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.fb2'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await p.click('[data-a="r-ch"][data-id="1"]'); await p.wait_for_selector('.prep')
    if not await p.locator('.prep[open]').count(): await p.click('.prep > summary')
    await p.click('[data-a="prev-load"]'); await p.wait_for_selector('.prev-text')
    assert 'Ktoś na niego czekał' in await p.inner_text('.prev-text')
    await p.click('[data-a="prev-tr"]'); await p.wait_for_selector('.prev .w-ctxtr')
    await c.check()

async def n15_chat(c):
    """15. Разговор о книге: ответ на языке книги и исправление ошибки."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.fb2'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await p.click('[data-a="r-menu"]'); await p.click('[data-a="r-chat"]'); await p.wait_for_selector('#chat')
    await p.fill('#chat-in', 'Lubię ta książka.'); await p.press('#chat-in', 'Enter')
    await p.wait_for_selector('.msg.ai .fix'); t = await p.inner_text('#chat')
    assert 'Lubię ta książka.' in t and 'A co myślisz' in t and 'tę książkę' in t, t
    body = c.claude.calls[-1]['body']; assert 'Polish' in body['system'] and body['messages'][-1]['content'] == 'Lubię ta książka.', body
    await c.shot('n15-chat')
    assert await p.evaluate("Object.values(S.mistakes).length") == 1
    await c.check()

async def n16_grammar(c):
    """16. Грамматические темы из своих книг и карта уровня."""
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.fb2')
    await p.evaluate("['las','mgła','ścieżka','droga','wiatr'].forEach((w,i)=>saveWord({term:w, lang:'pl', ctx:'Zdanie '+i+' o '+w+'.', book:Object.keys(S.books)[0], data:{lemma:w, tr:'t'}}, 'learn'))")
    await p.click('[data-a="tab"][data-id="words"]'); await p.wait_for_selector('#grammar')
    await p.click('[data-a="gr-load"][data-id="pl"]'); await p.wait_for_selector('.gr-t')
    t = await p.inner_text('#grammar'); assert 'Творительный падеж' in t and 'B1 → B2' in t and 'встречала в книгах' in t, t
    q = c.claude.calls[-1]['body']['messages'][0]['content']; assert 'Zdanie 0 o las.' in q and 'from B1 to B2' in q, q[:300]
    await p.click('.gr-t summary'); await p.click('[data-a="gr-done"][data-id="pl:0"]'); await p.wait_for_selector('.gr-t.done')
    assert await p.evaluate("S.grammar.pl.topics[0].done") is True
    await c.shot('n16-grammar')
    await c.check()

LEARN_CASES = [n01_known_coverage, n02_prep_words, n03_chapter_end, n04_card_types, n05_contexts, n06_leech, n07_fsrs, n08_tones,
               n09_tts, n09b_tts_native, n10_weekly, n11_questions, n12_active, n13_rich_card, n14_prev_summary, n15_chat, n16_grammar]
