/* Service Worker — офлайн и мгновенное повторное открытие (ТЗ 4.1.3, §9).
 * При обновлении версии игры поднять CACHE — старый кеш удалится сам. */
var CACHE = 'slova-v30';
var CORE = [
  './', './index.html',
  './src/rules.js?v=30', './src/morph.js?v=30', './src/dict.js?v=30',
  './src/stats.js?v=30', './src/storage.js?v=30', './src/sharecard.js?v=30',
  './src/score.js?v=30', './src/bot.js?v=30', './src/ui.js?v=30',
  './data/dict-data.js?v=30', './data/themes.js?v=30', './data/attrs.js?v=30'
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

  var isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1;
  if (isNav) {
    // HTML — network-first: свежая версия сразу, когда онлайн; кеш — только офлайн.
    // Так каждая правка доходит с первого захода, а игра работает без сети.
    e.respondWith(
      fetch(req).then(function (resp) {
        var copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return resp;
      }).catch(function () {
        return caches.match('./index.html', { ignoreSearch: true }).then(function (h) { return h || caches.match(req, { ignoreSearch: true }); });
      })
    );
    return;
  }

  // Остальное (скрипты, словарь) — cache-first по ТОЧНОМУ url: ?v= различает версии,
  // поэтому новая версия всегда промахивается мимо кеша и качается заново.
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (resp) {
        if (resp && resp.status === 200) {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return resp;
      });
    })
  );
});
