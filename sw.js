/* Service Worker — офлайн и мгновенное повторное открытие (ТЗ 4.1.3, §9).
 * При обновлении версии игры поднять CACHE — старый кеш удалится сам. */
var CACHE = 'slova-v4';
var CORE = [
  './', './index.html',
  './src/rules.js?v=4', './src/morph.js?v=4', './src/dict.js?v=4',
  './src/stats.js?v=4', './src/storage.js?v=4', './src/ui.js?v=4',
  './data/dict-data.js?v=4'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // не валим установку, если что-то одно не докачалось
    return Promise.all(CORE.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // чужое (telegram CDN) — как есть
  // cache-first, игнорируя ?v= — обновляем кеш в фоне
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (resp) {
        if (resp && resp.status === 200) {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return resp;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
