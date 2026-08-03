/* storage.js — единая точка доступа к хранилищу с деградацией:
 * Telegram CloudStorage -> localStorage -> оперативная память. Любой сбой
 * хранилища не должен ронять игру (ТЗ §2). Списки (копилка, свои слова) режутся
 * на части по 3800 символов, чтобы влезать в лимит CloudStorage (4096/ключ). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Storage = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CHUNK = 3800, MAX_CHUNKS = 20; // ~20*350 слов запаса
  var mem = {};
  var tg = (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  // CloudStorage реально работает только с Bot API 6.9+. В старых клиентах это
  // заглушка, которая шумит в консоль и молча не сохраняет — тогда идём в localStorage.
  var cloudOK = tg && tg.CloudStorage && tg.CloudStorage.setItem &&
    (!tg.isVersionAtLeast || tg.isVersionAtLeast('6.9'));
  var cloud = cloudOK ? tg.CloudStorage : null;
  var ls = null;
  try { ls = (typeof window !== 'undefined') && window.localStorage; var t = '__t'; ls.setItem(t, '1'); ls.removeItem(t); } catch (e) { ls = null; }

  var backend = cloud ? 'cloud' : (ls ? 'local' : 'memory');

  function rawGet(key, cb) {
    try {
      if (backend === 'cloud') return cloud.getItem(key, function (err, val) { cb(err ? null : (val || null)); });
      if (backend === 'local') return cb(ls.getItem(key));
      cb(key in mem ? mem[key] : null);
    } catch (e) { cb(null); }
  }
  function rawSet(key, val, cb) {
    cb = cb || function () {};
    try {
      if (backend === 'cloud') return cloud.setItem(key, val, function () { cb(); });
      if (backend === 'local') { ls.setItem(key, val); return cb(); }
      mem[key] = val; cb();
    } catch (e) { cb(); }
  }
  function rawDel(key, cb) {
    cb = cb || function () {};
    try {
      if (backend === 'cloud') return cloud.removeItem(key, function () { cb(); });
      if (backend === 'local') { ls.removeItem(key); return cb(); }
      delete mem[key]; cb();
    } catch (e) { cb(); }
  }

  // --- скаляры (JSON) ---
  function get(key, cb) {
    rawGet(key, function (v) {
      if (v == null) return cb(null);
      try { cb(JSON.parse(v)); } catch (e) { cb(null); }
    });
  }
  function set(key, val, cb) { rawSet(key, JSON.stringify(val), cb); }
  function del(key, cb) { rawDel(key, cb); }

  // --- списки строк с чанкованием ---
  function setList(name, arr, cb) {
    cb = cb || function () {};
    arr = (arr || []).slice();
    // режем на чанки по длине JSON
    var chunks = [], cur = [];
    function fits(a) { return JSON.stringify(a).length <= CHUNK; }
    for (var i = 0; i < arr.length; i++) {
      cur.push(arr[i]);
      if (!fits(cur)) { cur.pop(); chunks.push(cur); cur = [arr[i]]; }
      if (chunks.length >= MAX_CHUNKS) break; // вытесняем самое старое: оставляем хвост
    }
    if (cur.length) chunks.push(cur);
    if (chunks.length > MAX_CHUNKS) chunks = chunks.slice(chunks.length - MAX_CHUNKS);

    var n = chunks.length, pending = n + 1 + MAX_CHUNKS;
    function done() { if (--pending <= 0) cb(); }
    rawSet(name + '_n', String(n), done);
    for (var c = 0; c < n; c++) rawSet(name + '_' + c, JSON.stringify(chunks[c]), done);
    // подчищаем возможные старые лишние чанки
    for (var d = n; d < MAX_CHUNKS; d++) rawDel(name + '_' + d, done);
  }

  function getList(name, cb) {
    rawGet(name + '_n', function (nv) {
      var n = parseInt(nv, 10);
      if (!(n > 0)) {
        // legacy: одиночный ключ
        rawGet(name, function (v) {
          if (!v) return cb([]);
          try { cb(JSON.parse(v) || []); } catch (e) { cb([]); }
        });
        return;
      }
      var out = [], got = 0;
      for (var c = 0; c < n; c++) {
        (function (idx) {
          rawGet(name + '_' + idx, function (v) {
            if (v) { try { Array.prototype.push.apply(out, JSON.parse(v) || []); } catch (e) {} }
            if (++got >= n) cb(out);
          });
        })(c);
      }
    });
  }

  return {
    backend: backend,
    persistent: backend !== 'memory',
    get: get, set: set, del: del,
    getList: getList, setList: setList
  };
});
