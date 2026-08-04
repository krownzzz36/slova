/* wiki.js — «мини-википедия» по тапу: короткое описание + картинка из русской
 * Википедии. Без своей базы и без бэкенда: один fetch к REST summary (CORS открыт),
 * с чисткой под детский вид и кэшем (мгновенно и офлайн при повторе). Игра сама
 * остаётся офлайн — это отдельная «посмотреть, что значит слово» функция. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Wiki = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CACHE_KEY = 'wikicache', CACHE_MAX = 200;
  var mem = {};
  try { mem = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) { mem = {}; }

  function saveCache() {
    try {
      var keys = Object.keys(mem);
      if (keys.length > CACHE_MAX) { for (var i = 0; i < keys.length - CACHE_MAX; i++) delete mem[keys[i]]; }
      localStorage.setItem(CACHE_KEY, JSON.stringify(mem));
    } catch (e) {}
  }

  // Чистим под ребёнка: убрать ударения, латинские скобки, лишние пробелы.
  function clean(s) {
    return String(s || '')
      .replace(/́/g, '')
      .replace(/\s*\([^)]*[A-Za-z][^)]*\)/g, '')
      .replace(/\s*\[[^\]]*\]/g, '')
      .replace(/\s+([,.;:!?»])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  // 1–2 первых предложения, коротко.
  function shorten(s) {
    s = clean(s);
    if (!s) return '';
    var m = s.match(/^[\s\S]*?[.!?](\s|$)/);
    var out = m ? m[0].trim() : s.slice(0, 180);
    if (out.length < 90) {
      var rest = s.slice(out.length).match(/^[\s\S]*?[.!?](\s|$)/);
      if (rest) out = (out + ' ' + rest[0].trim()).trim();
    }
    return out.length > 260 ? out.slice(0, 257).trim() + '…' : out;
  }

  // Возврат в cb: { ok, title, text, thumb, url } | { ok:false }
  function lookup(word, cb) {
    var key = String(word || '').toLowerCase().trim();
    if (!key) return cb({ ok: false });
    if (mem[key]) return cb(mem[key]);
    var url = 'https://ru.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(key);
    var done = false, timer = setTimeout(function () { if (!done) { done = true; cb({ ok: false, offline: true }); } }, 7000);
    fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (done) return; done = true; clearTimeout(timer);
      var res;
      if (d && d.extract && d.type !== 'disambiguation') {
        res = { ok: true, title: d.title || word, text: shorten(d.extract),
          thumb: d.thumbnail ? d.thumbnail.source : null,
          url: (d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page) || null };
        mem[key] = res; saveCache();
      } else {
        res = { ok: false };
        mem[key] = res; saveCache();
      }
      cb(res);
    }).catch(function () {
      if (done) return; done = true; clearTimeout(timer);
      cb({ ok: false, offline: true });   // нет сети — не кэшируем
    });
  }

  return { lookup: lookup };
});
