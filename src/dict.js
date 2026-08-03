/* dict.js — распаковка словаря и работа с ним в рантайме.
 * Данные приходят из data/dict-data.js: window.DFULL (front-coding, ключи
 * нормализованы), DFREQ (частотный тир, порядок = частота), DOTHER (другие
 * части речи). Всё — нормализованные ключи (нижний регистр, ё->е, без дефисов). */
(function (root, factory) {
  var api = factory(root.Rules || (typeof require !== 'undefined' && require('./rules.js')));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Dict = api;
})(typeof self !== 'undefined' ? self : this, function (Rules) {
  'use strict';
  var B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

  // Распаковка front-coding: '0автобус\n7ный' -> ['автобус','автобусный'].
  function expand(fc) {
    if (!fc) return [];
    var lines = fc.split('\n'), out = new Array(lines.length), prev = '';
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!ln) { continue; }
      var p = B36.indexOf(ln[0]);
      var w = prev.slice(0, p) + ln.slice(1);
      out[i] = w; prev = w;
    }
    return out;
  }

  var full = null, other = null, names = null, geo = null, freq = [], firstCount = {}, meta = {};
  var hyphMap = {}, freqPos = {}, ready = false;
  var ALPHA = 'абвгдежзийклмнопрстуфхцчшщъыьэюя';

  function build(g) {
    g = g || (typeof window !== 'undefined' ? window : {});
    full = new Set(expand(g.DFULL || ''));
    other = new Set(expand(g.DOTHER || ''));
    names = new Set(expand(g.DNAMES || ''));
    geo = new Set(expand(g.DGEO || ''));
    freq = (g.DFREQ || '').split('\n').filter(Boolean);
    meta = g.DICT_META || {};
    firstCount = {}; freqPos = {}; hyphMap = {};
    full.forEach(function (w) { firstCount[w[0]] = (firstCount[w[0]] || 0) + 1; });
    for (var i = 0; i < freq.length; i++) freqPos[freq[i]] = i;
    expand(g.DHYPH || '').forEach(function (disp) { if (disp && Rules) hyphMap[Rules.norm(disp)] = disp; });
    ready = true;
    return api;
  }

  function has(nk) { return !!full && full.has(nk); }
  function hasOther(nk) { return !!other && other.has(nk); }
  function hasName(nk) { return !!names && names.has(nk); }
  function hasGeo(nk) { return !!geo && geo.has(nk); }
  function hasProper(nk) { return hasName(nk) || hasGeo(nk); }
  // Дефисное написание для нормализованного ключа (иначе — сам ключ).
  function display(nk) { return (hyphMap[nk]) || nk; }

  // Исправление опечатки: ближайшее реальное слово на расстоянии 1 правки, первая
  // буква не меняется. Возвращает {key, display} или null. Быстро (генерация правок).
  function correct(nk, used) {
    if (!full || !nk || nk.length < 5) return null;
    var cand = {}, w = nk, L = w.length, i, a, ch;
    for (i = 1; i <= L; i++) {
      if (i < L) cand[w.slice(0, i) + w.slice(i + 1)] = 1;                         // удаление
      if (i + 1 < L) cand[w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2)] = 1;   // перестановка
      for (a = 0; a < ALPHA.length; a++) {
        ch = ALPHA[a];
        if (i < L) cand[w.slice(0, i) + ch + w.slice(i + 1)] = 1;                  // замена
        cand[w.slice(0, i) + ch + w.slice(i)] = 1;                                 // вставка
      }
    }
    var best = null, bestRank = Infinity;
    for (var k in cand) {
      if (k === nk || k.length < 3 || !full.has(k)) continue;
      if (used && used.has(k)) continue;
      var rank = (k in freqPos) ? freqPos[k] : (1e6 + Math.abs(k.length - L));
      if (rank < bestRank) { bestRank = rank; best = k; }
    }
    return best ? { key: best, display: hyphMap[best] || best } : null;
  }

  // Есть ли ещё неиспользованные слова на букву L (для детекта тупика).
  function hasWordsOn(L, usedFirstCount) {
    var total = firstCount[L] || 0;
    var used = (usedFirstCount && usedFirstCount[L]) || 0;
    return total - used > 0;
  }

  // Подсказка: из первой половины частотного тира, на нужную букву, не в used,
  // сама не ведёт в тупик. skipJ учитывается при проверке тупиковости.
  function pickHint(letter, used, opts) {
    opts = opts || {};
    var half = Math.max(1, Math.floor(freq.length / 2));
    var usedFirst = opts.usedFirstCount || {};
    for (var i = 0; i < half; i++) {
      var w = freq[i];
      if (letter && w[0] !== letter) continue;    // пустая буква = свободный старт
      if (used && used.has(w)) continue;
      var nxt = Rules ? Rules.nextLetter(w, opts.skipJ) : null;
      if (nxt && !hasWordsOn(nxt, usedFirst)) continue; // не подсказываем тупик
      return w;
    }
    // запасной путь — по всему тиру
    for (var j = 0; j < freq.length; j++) {
      var v = freq[j];
      if ((!letter || v[0] === letter) && !(used && used.has(v))) return v;
    }
    return null;
  }

  var api = {
    expand: expand,
    build: build,
    has: has,
    hasOther: hasOther,
    hasName: hasName,
    hasGeo: hasGeo,
    hasProper: hasProper,
    display: display,
    correct: correct,
    hasWordsOn: hasWordsOn,
    pickHint: pickHint,
    get ready() { return ready; },
    get meta() { return meta; },
    get size() { return full ? full.size : 0; }
  };
  return api;
});
