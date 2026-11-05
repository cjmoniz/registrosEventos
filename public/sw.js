// Service worker: la app abre sin conexión. Nunca cachea /api (datos y sesión).
const VERSION = 'rc-v6';
const SHELL = ['/', '/app.css', '/app.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/logo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Páginas: red primero (para recibir versiones nuevas), caché si no hay red.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((r) => { const c = r.clone(); caches.open(VERSION).then((x) => x.put('/', c)); return r; })
        .catch(() => caches.match('/')),
    );
    return;
  }
  // Estáticos: caché inmediata y se refresca en segundo plano.
  e.respondWith(
    caches.match(req).then((hit) => {
      const red = fetch(req).then((r) => {
        if (r.ok) { const c = r.clone(); caches.open(VERSION).then((x) => x.put(req, c)); }
        return r;
      }).catch(() => hit);
      return hit || red;
    }),
  );
});
