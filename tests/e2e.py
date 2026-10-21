"""Сквозные тесты «Между строк».

Запуск:  python3 tests/e2e.py [префиксы кейсов]

Приложение раздаётся локальным сервером из корня репозитория. Библиотеки с CDN подменяются
локальными копиями (папка ../vendor/node_modules рядом с репозиторием, путь в VENDOR),
Claude API и Supabase — мок-серверами в этом же процессе, шрифты Google отключены.
"""
import asyncio, json, os, re, sys, threading, traceback, uuid, functools, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.path.join(ROOT, 'tests')
OUT = os.path.join(T, 'out')
VENDOR = os.environ.get('VENDOR', os.path.join(os.path.dirname(ROOT), 'vendor', 'node_modules'))
SB = 'https://lvdjvywgqzkovbmwytbe.supabase.co'
os.makedirs(OUT, exist_ok=True)

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def start_server():
    srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{srv.server_address[1]}/index.html'

CDN = {
    'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
    'jszip': 'jszip/dist/jszip.min.js',
    'pinyin-pro': 'pinyin-pro/dist/index.js',
    'hanzi-writer@': 'hanzi-writer/dist/hanzi-writer.min.js',
    'pdfjs-dist@3.11.174/build/pdf.min.js': 'pdfjs-dist/build/pdf.min.js',
    'pdfjs-dist@3.11.174/build/pdf.worker.min.js': 'pdfjs-dist/build/pdf.worker.min.js',
}

# ---------------------------------------------------------------- mock Claude
class Claude:
    def __init__(self): self.calls = []; self.fail = None; self.garbage = False
    async def handle(self, route):
        req = route.request
        h = req.headers
        body = json.loads(req.post_data or '{}')
        self.calls.append({'headers': h, 'body': body})
        if self.fail:
            return await route.fulfill(status=self.fail, content_type='application/json', body=json.dumps({'error': {'message': 'invalid x-api-key'}}))
        assert h.get('x-api-key') and h.get('anthropic-dangerous-direct-browser-access') == 'true', 'headers'
        prompt = body['messages'][-1]['content'] if not body.get('system') else ''
        J = lambda o: json.dumps(o, ensure_ascii=False)
        if body.get('system'):
            self.chat = getattr(self, 'chat', 0) + 1
            txt = 'To ciekawe! A co myślisz o głównym bohaterze?\n✎ Lubię tę książkę — «książka» в винительном падеже: «tę książkę».'
        elif self.garbage and not prompt.startswith('Reply with'): txt = 'Извините, я не могу.'
        elif prompt.startswith('Reply with: ok'): txt = 'ok'
        elif prompt.startswith('Translate this sentence'): txt = 'Старый часовщик каждое утро заводил латунные шестерёнки.'
        elif prompt.startswith('Translate these'):
            n = len(re.findall(r'^\d+\. «', prompt, re.M)); txt = J({'tr': ['кл%d' % i for i in range(n)], 'py': ['py%d' % i for i in range(n)]})
        elif 'is about to read this book chapter' in prompt:
            txt = J({'words': [{'w': 'mgła', 'tr': 'туман'}, {'w': 'ścieżką', 'tr': 'тропой'}, {'w': 'brass', 'tr': 'латунь'}, {'w': 'gears', 'tr': 'шестерни'}]})
        elif prompt.startswith('Summarize this book chapter'): txt = 'Wiedźmin szedł przez las. Ktoś na niego czekał.'
        elif prompt.startswith('Write 3 short comprehension questions'): txt = J({'questions': ['Kto szedł przez las?', 'Co unosiło się nad ścieżką?', 'Kto czekał?']})
        elif 'Create 5 short' in prompt: txt = J({'sentences': ['Я иду через лес.', 'Туман над тропой.', 'Кто-то ждёт.', 'Он не знал.', 'Ведьмак шёл медленно.']})
        elif 'keeps forgetting' in prompt: txt = 'Запомни: «mgła» похоже на «мгла».'
        elif prompt.startswith('Here are sentences from books'):
            txt = J({'topics': [{'title': 'Творительный падеж', 'explain': 'Отвечает на вопрос «чем?».', 'examples': [{'s': 'nad ścieżką', 'tr': 'над тропой'}]}, {'title': 'Прошедшее время', 'explain': 'Форма -ł/-ła.', 'examples': []}], 'roadmap': [{'title': 'Творительный падеж', 'seen': True}, {'title': 'Условное наклонение', 'seen': False}]})
        elif ('learner' in prompt and ('answers' in prompt or 'retold' in prompt or 'wrote this short text' in prompt or 'translated' in prompt)):
            n = max(1, len(re.findall(r'^(?:A\d+:|\s+→)', prompt, re.M)))
            txt = J({'results': [{'ok': True if i % 2 == 0 else 'partial', 'feedback': 'отзыв %d' % i, 'corrected': 'Poprawiona odpowiedź %d.' % i} for i in range(n)],
                     'mistakes': [{'wrong': 'szedłem przez lasu', 'right': 'szedłem przez las', 'rule': 'после przez — винительный'}], 'summary': 'Хорошо, но следи за падежами.'})
        else:
            term = re.search(r'tapped this (?:word|phrase): «(.+?)»', prompt).group(1)
            zh = 'Chinese' in prompt; pl = 'Polish' in prompt
            LEM = {'mgłę': 'mgła', 'mgle': 'mgła'}
            d = {'lemma': LEM.get(term, term.lower()) if not zh else term, 'pos': 'сущ.', 'tr': 'перевод:' + term, 'alt': 'ещё значение', 'note': 'пояснение формы', 'pinyin': 'shū' if zh else '', 'hsk': '1' if zh else ''}
            if pl: d.update({'aspect': 'iść (несов.) / pójść (сов.)' if term == 'szedł' else '', 'forms': 'род. п. mgły; мн. ч. mgły' if term.startswith('mgł') else '', 'false_friend': 'не путать с русским «лес» — тут всё верно' if term == 'las' else '', 'phrase': 'nad ścieżką — над тропой' if term == 'ścieżką' else ''})
            if zh: d.update({'parts': '书 — книга; 店 = 广 (навес) + 占', 'measure': '家 (jiā)'})
            txt = 'Вот ответ:\n' + J(d)
        await route.fulfill(status=200, content_type='application/json', body=json.dumps({'content': [{'type': 'text', 'text': txt}]}))

# ---------------------------------------------------------------- mock free translators
class Free:
    def __init__(self): self.google_down = False; self.mm_down = False; self.calls = []
    async def google(self, route):
        q = parse_qs(urlparse(route.request.url).query); self.calls.append(('g', q['q'][0]))
        if self.google_down: return await route.fulfill(status=429, body='')
        text = q['q'][0]
        body = [[['гугл:' + text, text, None, None, 10]], [['существительное', ['вариант1', 'вариант2']]] if ' ' not in text else None, q['sl'][0]]
        await route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps(body, ensure_ascii=False))
    async def mymemory(self, route):
        q = parse_qs(urlparse(route.request.url).query); self.calls.append(('m', q['q'][0]))
        if self.mm_down: return await route.fulfill(status=503, body='')
        await route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps({'responseData': {'translatedText': 'мм:' + q['q'][0]}, 'quotaFinished': False}, ensure_ascii=False))
    async def wikt(self, route):
        w = urlparse(route.request.url).path.rsplit('/', 1)[1]
        from urllib.parse import unquote
        w = unquote(w); self.calls.append(('w', w))
        if w == 'ścieżką':
            body = {'pl': [{'partOfSpeech': 'Noun', 'language': 'Polish', 'definitions': [{'definition': '<span class="form-of-definition">instrumental singular of <a href="/wiki/ścieżka">ścieżka</a></span>'}]}]}
            return await route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps(body))
        await route.fulfill(status=404, body='{}', headers={'access-control-allow-origin': '*'})

# ---------------------------------------------------------------- mock Supabase
class Backend:
    def __init__(self):
        self.users = {}; self.rows = {}; self.files = {}; self.offline = False
    def add_user(self, email, pw):
        self.users[email] = {'id': str(uuid.uuid4()), 'password': pw}
    def tok(self, uid): return 'tok.' + uid
    def uid_from(self, h):
        a = h.get('authorization', '')
        return a.split('tok.', 1)[1] if 'tok.' in a else None
    async def handle(self, route):
        try: return await self._handle(route)
        except Exception as e:
            print('   MOCK ERROR', route.request.method, route.request.url, repr(e)); await route.abort()
    async def _handle(self, route):
        req = route.request; u = urlparse(req.url); path = u.path; h = req.headers
        if os.environ.get('TRACE'): print('   >>', req.method, path, (req.post_data or '')[:60] if req.method != 'GET' else '')
        if self.offline: return await route.abort('internetdisconnected')
        cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}
        if req.method == 'OPTIONS': return await route.fulfill(status=200, headers=cors)
        def js(obj, status=200): return route.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
        if path == '/auth/v1/token':
            b = json.loads(req.post_data or '{}'); usr = self.users.get(b.get('email'))
            if not usr or usr['password'] != b.get('password'): return await js({'error': 'invalid_grant', 'error_description': 'Invalid login credentials', 'msg': 'Invalid login credentials', 'code': 'invalid_credentials'}, 400)
            user = {'id': usr['id'], 'email': b['email'], 'aud': 'authenticated', 'role': 'authenticated', 'app_metadata': {}, 'user_metadata': {}, 'identities': [{}], 'created_at': '2026-01-01T00:00:00Z'}
            return await js({'access_token': self.tok(usr['id']), 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600, 'refresh_token': 'r', 'user': user})
        if path == '/auth/v1/user':
            uid = self.uid_from(h); email = next((e for e, x in self.users.items() if x['id'] == uid), None)
            return await js({'id': uid, 'email': email, 'aud': 'authenticated', 'role': 'authenticated'})
        if path == '/auth/v1/logout': return await route.fulfill(status=204, headers=cors)
        uid = self.uid_from(h)
        if path == '/rest/v1/mezhdu_state':
            if not uid: return await js({'message': 'no auth'}, 401)
            if req.method == 'GET':
                r = self.rows.get(uid); return await js([{'state': r['state']}] if r else [])
            if req.method == 'POST':
                b = json.loads(req.post_data); b = b[0] if isinstance(b, list) else b
                assert b['user_id'] == uid
                self.rows[uid] = {'state': json.loads(json.dumps(b['state']))}
                return await route.fulfill(status=201, headers={**cors, 'content-type': 'application/json'}, body='')
        if path == '/rest/v1/mezhdu_push_subs':
            if not uid: return await js({'message': 'no auth'}, 401)
            if req.method == 'POST':
                b = json.loads(req.post_data); b = b[0] if isinstance(b, list) else b
                assert b['user_id'] == uid; self.subs = getattr(self, 'subs', {}); self.subs[b['endpoint']] = b
                return await route.fulfill(status=201, headers={**cors, 'content-type': 'application/json'}, body='')
            if req.method == 'DELETE':
                ep = parse_qs(u.query)['endpoint'][0].split('eq.', 1)[1]; getattr(self, 'subs', {}).pop(ep, None)
                return await route.fulfill(status=204, headers=cors)
        m = re.match(r'/storage/v1/object/(?:authenticated/)?books/(.+)', path)
        if m:
            key = m.group(1)
            if not key.startswith(uid + '/'): return await js({'message': 'denied'}, 403)
            if req.method in ('POST', 'PUT'):
                buf = req.post_data_buffer
                ct = h.get('content-type', '')
                if 'multipart' in ct:
                    m2 = re.search(rb'\r\n\r\n(\{.*\})\r\n--', buf, re.S); buf = m2.group(1)
                self.files[key] = buf; return await js({'Key': 'books/' + key})
            if req.method == 'GET':
                if key not in self.files: return await js({'message': 'not found'}, 404)
                return await route.fulfill(status=200, headers={**cors, 'content-type': 'application/json'}, body=self.files[key])
        if path == '/storage/v1/object/books' and req.method == 'DELETE':
            for k in json.loads(req.post_data)['prefixes']: self.files.pop(k, None)
            return await js([])
        await js({'message': 'unmocked ' + req.method + ' ' + path}, 500)

# ---------------------------------------------------------------- harness
class Ctx:
    def __init__(self, pw, browser, url, claude, backend, sync, mobile=True):
        self.pw, self.browser, self.url, self.claude, self.backend, self.sync, self.mobile = pw, browser, url, claude, backend, sync, mobile
        self.errors = []
    async def open(self):
        vp = {'width': 390, 'height': 844} if self.mobile else {'width': 1280, 'height': 860}
        self.ctx = await self.browser.new_context(viewport=vp, has_touch=self.mobile, locale='ru-RU', timezone_id='Europe/Kaliningrad')
        async def cdn(route):
            from urllib.parse import unquote
            m = re.search(r'hanzi-writer-data@[^/]+/(.+)\.json', unquote(route.request.url))
            if m:
                f = os.path.join(VENDOR, 'hanzi-writer-data', m.group(1) + '.json')
                if os.path.exists(f): return await route.fulfill(path=f, content_type='application/json', headers={'access-control-allow-origin': '*'})
                return await route.fulfill(status=404, body='', headers={'access-control-allow-origin': '*'})
            for k, p in CDN.items():
                if k in route.request.url: return await route.fulfill(path=os.path.join(VENDOR, p), content_type='application/javascript')
            await route.abort()
        await self.ctx.route('https://cdn.jsdelivr.net/**', cdn)
        await self.ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.abort())
        await self.ctx.route('https://api.anthropic.com/**', self.claude.handle)
        await self.ctx.route(SB + '/**', self.backend.handle)
        self.free = getattr(self, 'free', None) or Free()
        await self.ctx.route('https://translate.googleapis.com/**', self.free.google)
        await self.ctx.route('https://api.mymemory.translated.net/**', self.free.mymemory)
        await self.ctx.route('https://en.wiktionary.org/**', self.free.wikt)
        if not getattr(self, 'data', False):
            # по умолчанию словари недоступны — так проверяется работа без них; кейсы x* включают их
            await self.ctx.route(re.compile(r'.*/data/[^/]+$'), lambda r: r.fulfill(status=404, body=''))
        if not self.sync:
            await self.ctx.route('**/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body='window.APP_CONFIG={};'))
        if getattr(self, 'init_script', None): await self.ctx.add_init_script(self.init_script)
        self.page = await self.ctx.new_page()
        self.page.on('console', lambda m: self.errors.append(m.text) if m.type == 'error' and 'net::ERR' not in m.text and 'Failed to load resource' not in m.text else None)
        if os.environ.get('TRACE2'):
            self.page.on('request', lambda r: print('   REQ', r.method, r.url[-60:]) if 'supabase' in r.url else None)
            self.page.on('requestfailed', lambda r: print('   FAILED', r.method, r.url[-60:], r.failure) if 'supabase' in r.url else None)
            self.page.on('requestfinished', lambda r: print('   DONE', r.method, r.url[-60:]) if 'supabase' in r.url else None)
        self.page.on('pageerror', lambda e: self.errors.append('pageerror: ' + str(e)))
        await self.page.goto(self.url); await self.page.wait_for_selector('.brand')
        return self.page
    async def shot(self, name): await self.page.screenshot(path=os.path.join(OUT, name + '.png'))
    async def check(self):
        sw = await self.page.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')
        assert not sw, 'горизонтальная прокрутка'
        assert not self.errors, 'ошибки в консоли: ' + '; '.join(self.errors[:5])
    async def close(self): await self.ctx.close()

async def login(p, email, pw):
    await p.wait_for_selector('form[data-form="signin"]')
    await p.fill('#au-email', email); await p.fill('#au-pass', pw); await p.click('form[data-form="signin"] button[type=submit]')
    await p.wait_for_selector('nav.tabs')

async def set_key(p):
    # Claude в приложении выключен; для проверки кода на Claude включаем его флагом разработки
    await p.evaluate("localStorage.setItem('mezhdu-ai','1');localStorage.setItem('mezhdu-claude-key','sk-ant-test')")

async def import_book(p, fname, lang=None):
    await p.set_input_files('#file', os.path.join(T, fname))
    await p.wait_for_selector('form[data-form="import"]')
    if lang: await p.click(f'[data-a="imp-lang"][data-id="{lang}"]')
    await p.click('form[data-form="import"] button[type=submit]')
    await p.wait_for_selector('form[data-form="import"]', state='detached')

# ---------------------------------------------------------------- cases
async def c01_empty_and_import(c):
    p = await c.open()
    await c.shot('01-empty')
    assert 'Учить язык, читая свои книги' in await p.inner_text('main')
    await set_key(p)
    await p.set_input_files('#file', os.path.join(T, 'sample.epub'))
    await p.wait_for_selector('form[data-form="import"]')
    v = await p.input_value('input[name=title]'); assert v == "The Clockmaker's Daughter", v
    assert 'aria-pressed="true">Английский' in await p.inner_html('.sheet'), 'язык en'
    assert '2 главы' in await p.inner_text('.sheet'), await p.inner_text('.sheet')
    await c.shot('01-import-dialog')
    await p.click('form[data-form="import"] button[type=submit]')
    await p.wait_for_selector('.continue')
    await import_book(p, 'sample.fb2')
    await import_book(p, 'sample-zh.txt')
    await import_book(p, 'plain.txt')
    books = await p.evaluate('Object.values(S.books).map(b=>[b.title,b.lang,b.chs.length])')
    print('   books:', books)
    langs = sorted(b[1] for b in books)
    assert langs == ['en', 'pl', 'pl', 'zh'], langs
    fb = next(b for b in books if b[1] == 'pl' and 'mgł' in b[0]); assert fb[2] == 2, fb
    zh = next(b for b in books if b[1] == 'zh'); assert zh[2] == 2, zh
    await c.shot('01-shelf')
    await c.check()

async def c02_read_tap_save(c):
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.epub')
    await p.click('.continue [data-a="open"].btn')
    await p.wait_for_selector('#rt w')
    await c.shot('02-reader')
    w = p.locator('#rt p[data-i="0"] w', has_text='clockmaker').first
    await w.click()
    await p.wait_for_selector('.w-tr')
    assert 'перевод:clockmaker' in await p.inner_text('.sheet')
    call = c.claude.calls[-1]['body']['messages'][0]['content']
    assert 'The old clockmaker wound the brass gears every morning' in call and 'B1' in call and 'Russian' in call, call[:300]
    assert '<b>clockmaker</b>' in await p.inner_html('.w-ctx')
    await p.click('[data-a="w-sent"]'); await p.wait_for_selector('.w-ctxtr')
    await c.shot('02-word-sheet')
    await p.click('[data-a="w-save"]')
    await p.wait_for_selector('[data-a="w-known"]')
    await p.click('.sheet [data-a="sheet-close"]')
    await p.wait_for_selector('.sheet', state='detached')
    n = await p.locator('#rt w.s').count(); assert n >= 30, n   # слово подсвечено во всех абзацах
    # повторный тап по сохранённому слову не тратит запрос
    before = len(c.claude.calls)
    await p.locator('#rt p[data-i="3"] w', has_text='clockmaker').first.click(); await p.wait_for_selector('.w-tr')
    assert len(c.claude.calls) == before
    assert 'Слово уже в повторении' in await p.inner_text('.sheet')
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    # фраза выделением
    await p.evaluate("""()=>{const ps=document.querySelectorAll('#rt p[data-i="1"] w');const r=document.createRange();r.setStartBefore(ps[1]);r.setEndAfter(ps[3]);const s=getSelection();s.removeAllRanges();s.addRange(r)}""")
    await p.wait_for_selector('#selchip'); await p.click('#selchip'); await p.wait_for_selector('.w-tr')
    assert 'old clockmaker wound' in await p.inner_text('.w-term'), await p.inner_text('.w-term')
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    # прокрутка и прогресс
    await p.evaluate("document.getElementById('rs').scrollTop = document.querySelector('#rt p[data-i=\"20\"]').offsetTop")
    await p.wait_for_timeout(500)
    pos = await p.evaluate('Object.values(S.books)[0].pos'); assert pos['p'] >= 19, pos
    await p.click('[data-a="r-ch"]'); await p.wait_for_selector('#rt')
    assert 'Loose text inside a div' in await p.inner_text('#rt')
    # закрыть кнопкой «назад» браузера
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    pct = await p.evaluate('Object.values(S.books)[0].pct'); assert pct > 0.9, pct
    read = await p.evaluate('dayTotals(today()).words'); assert read > 500, read
    await c.shot('02-shelf-after')
    # перезагрузка: всё сохранилось
    await p.wait_for_timeout(400); await p.reload(); await p.wait_for_selector('.continue')
    assert await p.evaluate('Object.keys(S.words).length') == 1
    await c.check()

async def c03_chinese(c):
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample-zh.txt')
    await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt ruby')
    rt = await p.inner_text('#rt p[data-i="0"] w:first-child rt'); assert rt == 'wǒ', rt
    await c.shot('03-zh-reader')
    w = p.locator('#rt p[data-i="0"] w[data-t="书店"]').first
    await w.click(); await p.wait_for_selector('.w-tr')
    t = await p.inner_text('.w-term'); assert t == '书店', t
    assert 'shū' in await p.inner_text('.sheet') or 'diàn' in await p.inner_text('.sheet')
    await c.shot('03-zh-word')
    await p.click('[data-a="w-save"]'); await p.wait_for_selector('[data-a="w-known"]')
    await p.go_back()
    # пиньинь можно скрыть
    await p.click('[data-a="r-menu"]'); await p.click('[data-a="pinyin"]')
    await p.wait_for_function('!document.querySelector("#rt ruby")')
    await c.check()

async def c04_review(c):
    p = await c.open(); await set_key(p)
    await import_book(p, 'sample.fb2')
    await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    for word in ['Wiedźmin', 'mgła', 'ścieżką']:
        await p.locator('#rt p[data-i="0"] w', has_text=word).first.click(); await p.wait_for_selector('[data-a="w-save"]')
        await p.click('[data-a="w-save"]'); await p.wait_for_selector('[data-a="w-known"]'); await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    await p.click('[data-a="tab"][data-id="words"]'); await p.wait_for_selector('.deck')
    assert '3' in await p.inner_text('.deck .big')
    await c.shot('04-words')
    await p.click('[data-a="rv-start"]'); await p.wait_for_selector('.card')
    await c.shot('04-card-front')
    await p.click('[data-a="rv-show"]'); await p.wait_for_selector('.grades')
    await c.shot('04-card-back')
    await p.click('[data-a="rv-grade"][data-id="0"]')   # не помню — вернётся в конец
    await p.keyboard.press(' '); await p.keyboard.press('3')
    await p.click('[data-a="rv-show"]'); await p.click('[data-a="rv-grade"][data-id="3"]')
    await p.click('[data-a="rv-show"]'); await p.click('[data-a="rv-grade"][data-id="2"]')
    await p.wait_for_selector('text=Готово')
    t = await p.evaluate('dayTotals(today())'); assert t['rev'] == 4 and t['nw'] == 3, t
    await p.click('[data-a="rv-close"]'); await p.wait_for_selector('.review', state='detached')
    assert 'на сегодня всё повторено' in await p.inner_text('.deck')
    # деталь слова, правка перевода, удаление
    await p.click('[data-a="wopen"]'); await p.wait_for_selector('form[data-form="edit-tr"]')
    await p.fill('input[name=tr]', 'ведьмак'); await p.press('input[name=tr]', 'Enter')
    await p.click('[data-a="d-known"]'); await p.wait_for_selector('.sheet', state='detached')
    await p.click('[data-a="ws"][data-id="known"]'); assert 'ведьмак' in await p.inner_text('#wlist')
    await p.click('[data-a="tab"][data-id="diary"]'); await p.wait_for_selector('.goal')
    await c.shot('04-diary')
    await c.check()

async def c05_errors_and_settings(c):
    p = await c.open()
    await import_book(p, 'sample.epub')
    await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await p.locator('#rt w').first.click(); await p.wait_for_selector('.w-tr')
    assert 'гугл:' in await p.inner_text('.w-tr')     # без ключа — простой перевод
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached'); await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    await p.evaluate("localStorage.setItem('mezhdu-ai','1')")
    await p.click('[data-a="tab"][data-id="settings"]'); await p.wait_for_selector('input[name="key"]')
    c.claude.fail = 401
    await p.fill('input[name=key]', 'sk-bad'); await p.click('form[data-form="key"] button[type=submit]')
    await p.wait_for_selector('text=Ключ Claude API не подходит')
    c.claude.fail = None
    await p.click('[data-a="key-test"]'); await p.wait_for_selector('text=Ключ работает')
    await p.click('[data-a="set"][data-k="theme"][data-id="night"]')
    assert await p.evaluate('document.documentElement.dataset.theme') == 'night'
    await c.shot('05-settings-night')
    await p.click('[data-a="set"][data-k="target"][data-id="en"]')
    await p.click('[data-a="tab"][data-id="shelf"]'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await c.shot('05-reader-night')
    await p.locator('#rt w', has_text='brass').first.click(); await p.wait_for_selector('.w-tr')
    assert 'Explain everything in English' in c.claude.calls[-1]['body']['messages'][0]['content']
    await c.check()

async def c06_desktop(c):
    c.mobile = False
    p = await c.open(); await set_key(p)
    for f in ['sample.epub', 'sample.fb2', 'sample-zh.txt']: await import_book(p, f)
    await c.shot('06-desktop-shelf')
    await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await c.shot('06-desktop-reader')
    await c.check()

async def c07_sync_two_devices(c):
    c.backend.add_user('a@x.ru', 'secret1')
    p = await c.open(); await set_key(p)
    await login(p, 'a@x.ru', 'secret1')         # сначала вход, потом приложение
    await import_book(p, 'sample.fb2')
    await p.wait_for_function('document.getElementById("status").textContent==="Синхронизировано"', timeout=8000)
    uid = c.backend.users['a@x.ru']['id']
    assert uid in c.backend.rows and len(c.backend.files) == 1, (list(c.backend.rows), list(c.backend.files))
    # слово на первом устройстве
    await p.click('[data-a="tab"][data-id="shelf"]'); await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    await p.locator('#rt w', has_text='las').first.click(); await p.click('[data-a="w-save"]'); await p.wait_for_selector('[data-a="w-known"]')
    await p.go_back(); await p.go_back(); await p.wait_for_selector('.continue')
    await p.wait_for_function('document.getElementById("status").textContent==="Синхронизировано"', timeout=8000)
    # второе устройство
    c2 = Ctx(c.pw, c.browser, c.url, c.claude, c.backend, True, mobile=False)
    p2 = await c2.open()
    await login(p2, 'a@x.ru', 'secret1')
    await p2.wait_for_function('Object.keys(S.words).length===1', timeout=8000)
    await p2.click('[data-a="tab"][data-id="shelf"]'); await p2.wait_for_selector('.continue')
    await p2.click('.continue [data-a="open"].btn'); await p2.wait_for_selector('#rt w.s')   # текст скачан, слово подсвечено
    # одновременные изменения на двух устройствах сливаются
    await p2.go_back(); await p2.wait_for_selector('.continue')
    await p2.evaluate("S.words[Object.keys(S.words)[0]].tr='из ноутбука'; S.words[Object.keys(S.words)[0]].u=Date.now(); save(10)")
    await p.evaluate("S.settings.goal=45; S.settings.u=Date.now(); save(10)")
    await p2.wait_for_timeout(800); await p.evaluate('sync()'); await p.wait_for_timeout(800); await p2.evaluate('sync()'); await p2.wait_for_timeout(800); await p.evaluate('sync()'); await p.wait_for_timeout(800)
    for pg in (p, p2):
        g = await pg.evaluate('[S.settings.goal, Object.values(S.words)[0].tr]'); assert g == [45, 'из ноутбука'], g
    # выход очищает устройство
    await p2.click('[data-a="tab"][data-id="settings"]'); await p2.click('[data-a="signout"]'); await p2.wait_for_selector('text=Ты вышла')
    assert await p2.evaluate('Object.keys(S.books).length') == 0
    await c2.check(); await c2.close()
    await c.check()

async def c08_fallback(c):
    p = await c.open()
    await import_book(p, 'sample.fb2')
    await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('#rt w')
    # 1) без ключа: Google + Викисловарь
    await p.locator('#rt p[data-i="0"] w', has_text='ścieżką').first.click(); await p.wait_for_selector('.w-tr')
    txt = await p.inner_text('.sheet')
    assert 'гугл:ścieżką' in txt and 'ścieżka' in txt and 'творительный падеж ед. ч.' in txt and 'Google Переводчик' in txt, txt
    assert 'гугл:ścieżka (нач. форма)' in txt, txt
    await c.shot('08-fallback-word')
    await p.click('[data-a="w-sent"]'); await p.wait_for_selector('.w-ctxtr')
    assert 'гугл:Wiedźmin szedł' in await p.inner_text('.w-ctxtr')
    await p.click('[data-a="w-save"]'); await p.wait_for_selector('[data-a="w-known"]')
    w = await p.evaluate('Object.values(S.words)[0]'); assert w['lemma'] == 'ścieżka' and w['src'] == 'basic', w
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    # 2) ключ есть, но Claude перегружен — всё равно перевод + причина
    await set_key(p); c.claude.fail = 529
    await p.locator('#rt p[data-i="0"] w', has_text='mgła').first.click(); await p.wait_for_selector('.w-tr')
    txt = await p.inner_text('.sheet'); assert 'гугл:mgła' in txt and 'Claude недоступен' in txt and 'перегружен' in txt, txt
    # «Спросить Claude ещё раз», когда он ожил
    c.claude.fail = None
    await p.click('[data-a="w-retry"]'); await p.wait_for_selector('text=перевод:mgła')
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached')
    # 3) Google недоступен — MyMemory
    await p.evaluate("localStorage.removeItem('mezhdu-claude-key')"); c.free.google_down = True
    await p.locator('#rt p[data-i="0"] w', has_text='powoli').first.click(); await p.wait_for_selector('.w-tr')
    assert 'мм:powoli' in await p.inner_text('.w-tr')
    assert 'MyMemory' in await p.inner_text('.sheet')
    await c.check()

async def c09_eink_android(c):
    # страница внутри APK: есть мост window.Android
    c.init_script = "window.__native={paging:[],spoken:[]};window.Android={setPaging:b=>__native.paging.push(b),canSpeak:()=>true,speak:(t,l)=>__native.spoken.push([t,l])};"
    p = await c.open(); await set_key(p)
    assert await p.evaluate('document.documentElement.dataset.theme') == 'eink'
    await import_book(p, 'sample.epub')
    await c.shot('09-eink-shelf')
    await p.click('.continue [data-a="open"].btn'); await p.wait_for_selector('.reader.paged #rt w')
    assert await p.evaluate('__native.paging') == [True]
    await c.shot('09-eink-reader')
    top0 = await p.evaluate("document.getElementById('rs').scrollTop")
    await p.click('[data-a="pg"][data-id="1"]'); top1 = await p.evaluate("document.getElementById('rs').scrollTop"); assert top1 > top0 + 300, (top0, top1)
    await p.evaluate('einkPage(1)'); await p.keyboard.press('PageDown')    # кнопка громкости вызывает einkPage
    for _ in range(40):
        if await p.evaluate('R.ch') == 1: break
        await p.evaluate('einkPage(1)')
    assert await p.evaluate('R.ch') == 1, 'не перешли на следующую главу'
    await p.evaluate('einkPage(-1)'); assert await p.evaluate('R.ch') == 0
    # слово по-прежнему переводится касанием, озвучка идёт через Android
    await p.locator('#rt w', has_text='brass').first.click(); await p.wait_for_selector('.w-tr')
    await p.click('[data-a="w-speak"]'); assert await p.evaluate('__native.spoken') == [['brass', 'en-US']]
    await c.shot('09-eink-word')
    await p.go_back(); await p.wait_for_selector('.sheet', state='detached'); await p.go_back(); await p.wait_for_selector('.reader', state='detached')
    assert await p.evaluate('__native.paging') == [True, False]
    # выключить E-ink в настройках
    await p.click('[data-a="tab"][data-id="settings"]'); await p.click('[data-a="eink"]')
    assert await p.evaluate('document.documentElement.dataset.theme') != 'eink'
    await c.check()

PUSH_MOCK = '''
window.__push = {sub: null, shown: []};
const fakeSub = () => ({endpoint: 'https://fcm.googleapis.com/fcm/send/XYZ', toJSON(){return {endpoint: this.endpoint, keys: {p256dh: 'BPUB', auth: 'AUTH'}}}, unsubscribe: async () => { __push.sub = null; return true; }});
const reg = {pushManager: {getSubscription: async () => __push.sub, subscribe: async (o) => { __push.key = o.applicationServerKey.length; __push.sub = fakeSub(); return __push.sub; }}, showNotification: async (t, o) => __push.shown.push(t)};
Object.defineProperty(navigator, 'serviceWorker', {value: {getRegistration: async () => reg, ready: Promise.resolve(reg), register: async () => reg}});
window.PushManager = function(){};
window.Notification = {permission: 'default', requestPermission: async () => (Notification.permission = 'granted')};
'''

async def c10_schedule_push(c):
    c.sync = True; c.init_script = PUSH_MOCK
    c.backend.add_user('a@x.ru', 'secret1')
    p = await c.open(); await set_key(p)
    await login(p, 'a@x.ru', 'secret1')
    await import_book(p, 'sample.fb2')
    await p.click('[data-a="tab"][data-id="settings"]'); await p.wait_for_selector('#reminders')
    # польский: ср, пт 19:00, 20 мин
    await p.click('[data-a="sc-add"]'); await p.wait_for_selector('form[data-form="sched"]')
    await p.click('form[data-form="sched"] button[type=submit]'); await p.wait_for_selector('text=Выбери хотя бы один день')
    await p.click('[data-a="sc-day"][data-id="3"]'); await p.click('[data-a="sc-day"][data-id="5"]')
    await p.fill('input[name=time]', '19:00')
    await c.shot('10-sched-editor')
    await p.click('form[data-form="sched"] button[type=submit]'); await p.wait_for_selector('.sched')
    # английский: вт, чт 18:30, 30 мин
    await p.click('[data-a="sc-add"]'); await p.click('[data-a="sc-lang"][data-id="en"]')
    await p.click('[data-a="sc-day"][data-id="2"]'); await p.click('[data-a="sc-day"][data-id="4"]')
    await p.fill('input[name=time]', '18:30'); await p.click('[data-a="sc-min"][data-id="30"]')
    await p.click('form[data-form="sched"] button[type=submit]'); await p.wait_for_selector('.sched li:nth-child(2)')
    txt = await p.inner_text('.sched')
    assert 'Английский' in txt and 'вт, чт · 30 мин' in txt and '18:30' in txt, txt
    assert 'Польский' in txt and 'ср, пт · 20 мин' in txt and '19:00' in txt, txt
    sch = await p.evaluate('S.settings.schedule'); assert [x['lang'] for x in sch] == ['en', 'pl'], sch
    assert await p.evaluate('S.settings.tz') == 'Europe/Kaliningrad'
    await p.click('[data-a="push-on"]'); await p.wait_for_selector('text=Уведомления включены')
    assert await p.evaluate('__push.key') == 65
    subs = getattr(c.backend, 'subs', {}); assert list(subs) == ['https://fcm.googleapis.com/fcm/send/XYZ'], subs
    await p.click('[data-a="push-test"]'); assert await p.evaluate('__push.shown') == ['Английский — 30 мин']
    await c.shot('10-settings-reminders')
    await p.click('[data-a="push-off"]'); await p.wait_for_selector('[data-a="push-on"]'); assert not getattr(c.backend, 'subs', {})
    # план на сегодня (среда — польский) на полке, переход по ?open=pl
    await p.evaluate("S.settings.schedule.forEach(x=>x.days=[1,2,3,4,5,6,7]); save()")
    await p.click('[data-a="tab"][data-id="shelf"]'); await p.wait_for_selector('.plan-item')
    assert 'Польский' in await p.inner_text('.plan'), await p.inner_text('.plan')
    await c.shot('10-plan-today')
    await p.wait_for_timeout(500)
    await p.goto(c.url + '?open=pl'); await p.wait_for_selector('.reader #rt w')
    await c.check()

async def c11_native_schedule(c):
    c.init_script = "window.__native={sched:[]};window.Android={setPaging:()=>{},canSpeak:()=>false,speak:()=>{},setSchedule:j=>__native.sched.push(JSON.parse(j)),requestNotifications:()=>{__native.asked=1}};"
    p = await c.open()
    await import_book(p, 'sample.fb2')
    await p.click('[data-a="tab"][data-id="settings"]')
    assert 'ставит само приложение' in await p.inner_text('#reminders')
    await p.click('[data-a="native-notif"]'); assert await p.evaluate('__native.asked') == 1
    await p.click('[data-a="sc-add"]'); await p.click('[data-a="sc-day"][data-id="3"]'); await p.click('form[data-form="sched"] button[type=submit]')
    await p.wait_for_timeout(500)
    last = await p.evaluate('__native.sched[__native.sched.length-1]')
    assert last['items'][0]['lang'] == 'pl' and last['items'][0]['days'] == [3], last
    assert last['info']['pl']['book'] == 'Droga przez mgłę', last['info']
    await c.check()

exec(open(os.path.join(T, 'plan_cases.py'), encoding='utf-8').read())
exec(open(os.path.join(T, 'learn_cases.py'), encoding='utf-8').read())
exec(open(os.path.join(T, 'extras_cases.py'), encoding='utf-8').read())

CASES = [c01_empty_and_import, c02_read_tap_save, c03_chinese, c04_review, c05_errors_and_settings, c06_desktop, c07_sync_two_devices, c08_fallback, c09_eink_android, c10_schedule_push, c11_native_schedule] + PLAN_CASES + LEARN_CASES + EXTRAS_CASES

async def main():
    sel = sys.argv[1:]
    url = start_server()
    ok = fail = 0
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        for case in CASES:
            name = case.__name__
            if sel and not any(name.startswith(s) for s in sel): continue
            c = Ctx(pw, browser, url, Claude(), Backend(), sync=name.startswith(('c07', 'c10', 'f11')))
            try:
                await asyncio.wait_for(case(c), 90); ok += 1; print('PASS', name)
            except Exception as e:
                fail += 1; print('FAIL', name, '—', repr(e)[:600]); traceback.print_exc(limit=3)
                try: await c.shot('FAIL-' + name)
                except Exception: pass
                if c.errors: print('   console:', c.errors[:5])
            finally:
                try: await c.close()
                except Exception: pass
        await browser.close()
    print(f'\n{ok} passed, {fail} failed'); sys.exit(1 if fail else 0)

asyncio.run(main())
