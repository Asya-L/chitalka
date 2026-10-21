// Офлайн: оболочка приложения кэшируется при установке, библиотеки и шрифты — при первой загрузке.
// Запросы к Supabase и Claude всегда идут в сеть.
const VERSION = 'v1';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'parse.js', 'config.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open('shell-' + VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open('shell-' + VERSION).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open('cdn-' + VERSION).then(c => c.put(req, copy)); return res; })));
  }
});
