// ATPL Service Worker - Cache Busting Auto-Update
const CACHE_NAME = 'atpl-cache-v20261017-authority-v100';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Always fetch fresh from network for JS, HTML and API calls
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
