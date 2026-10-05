const CACHE_NAME = 'atpl-cache-v6-static-only';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((k) => k !== CACHE_NAME ? caches.delete(k) : null)
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // API responses and cross-origin cloud data must never use an offline snapshot.
  if (url.origin !== self.location.origin || url.pathname.includes('/api/') ||
      url.pathname.includes('/functions/')) return;
  e.respondWith(
    fetch(e.request).then((resp) => {
      const copy = resp.clone();
      if (resp.ok && !resp.redirected) {
        caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
      }
      return resp;
    }).catch(() => caches.match(e.request))
  );
});
