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
  var hyphMap = {}, freqPos = {}, themes = {}, themeSets = {}, wordThemeMap = {}, ready = false;
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
    themes = g.DTHEMES || {};
    themeSets = {}; wordThemeMap = {};  // нормализованные ключи темы + обратная карта слово->тема
    if (Rules) Object.keys(themes).forEach(function (n) {
      var s = new Set(); themes[n].forEach(function (w) { var k = Rules.norm(w); s.add(k); if (!wordThemeMap[k]) wordThemeMap[k] = n; }); themeSets[n] = s;
    });
    ready = true;
    return api;
  }
  function themeNames() { return Object.keys(themes); }
  function browseTheme(name) {
    var arr = (themes[name] || []).slice();
    return { words: arr, total: arr.length, shown: arr.length };
  }
  // Игровой режим по теме: принадлежность, детект тупика и подсказка внутри темы.
  function hasTheme(name, nk) { var s = themeSets[name]; return !!s && s.has(nk); }
  function wordTheme(nk) { return wordThemeMap[nk] || null; }   // тема слова (для эмодзи-ассоциации)
  function themeWordsOn(name, letter, used) {
    var arr = themes[name] || [];
    for (var i = 0; i < arr.length; i++) {
      var w = Rules ? Rules.norm(arr[i]) : arr[i];
      if ((!letter || w[0] === letter) && !(used && used.has(w))) return true;
    }
    return false;
  }
  function pickThemeHint(name, letter, used) {
    var arr = themes[name] || [];
    for (var i = 0; i < arr.length; i++) {
      var w = Rules ? Rules.norm(arr[i]) : arr[i];
      if ((!letter || w[0] === letter) && !(used && used.has(w))) return w;
    }
    return null;
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

  // Усиленная подсказка: частое слово + его категория (тема). Приоритет —
  // частое ТЕМАТИЧЕСКОЕ слово (знакомое, есть категория); фолбэк — частое слово
  // из верхней части тира (без категории). Возврат: { word, theme } | null.
  function pickRichHint(letter, used, opts) {
    opts = opts || {};
    var usedFirst = opts.usedFirstCount || {};
    function ok(w) {
      if (letter && w[0] !== letter) return false;
      if (used && used.has(w)) return false;
      var nxt = Rules ? Rules.nextLetter(w, opts.skipJ) : null;
      return !(nxt && !hasWordsOn(nxt, usedFirst));
    }
    for (var i = 0; i < freq.length; i++) {           // 1. частое слово с категорией
      var w = freq[i];
      if (wordThemeMap[w] && ok(w)) return { word: w, theme: wordThemeMap[w] };
    }
    var top = Math.max(1, Math.floor(freq.length * 0.35));
    for (var j = 0; j < top; j++) {                   // 2. частое слово из верха тира
      if (ok(freq[j])) return { word: freq[j], theme: null };
    }
    var last = pickHint(letter, used, opts);          // 3. общий фолбэк
    return last ? { word: last, theme: wordThemeMap[last] || null } : null;
  }

  // Пул кандидатов для бота: слова на букву letter из полосы частотного тира
  // [bandFrom..bandTo] (доли 0..1), не в used, не ведущие в тупик. Порядок — по частоте.
  function botCandidates(letter, used, opts) {
    opts = opts || {};
    var n = freq.length;
    var from = Math.max(0, Math.floor(n * (opts.bandFrom || 0)));
    var to = Math.min(n, Math.ceil(n * (opts.bandTo == null ? 1 : opts.bandTo)));
    var limit = opts.limit || 60;
    var usedFirst = opts.usedFirstCount || {};
    var out = [];
    for (var i = from; i < to && out.length < limit; i++) {
      var w = freq[i];
      if (letter && w[0] !== letter) continue;
      if (used && used.has(w)) continue;
      var nxt = Rules ? Rules.nextLetter(w, opts.skipJ) : null;
      if (nxt && !hasWordsOn(nxt, usedFirst)) continue; // не отдаём себе/сопернику тупик
      out.push(w);
    }
    return out;
  }

  // ---- Справочник: обзор словаря по буквам и категориям ----
  var RU = 'абвгдежзийклмнопрстуфхцчшщэюяё';
  function catSource(cat) {
    if (cat === 'proper') return [names, geo];
    if (cat === 'full') return [full];
    return null; // 'freq' обрабатываем отдельно (это массив)
  }
  function letters(cat) {
    var present = {};
    if (cat === 'freq') { for (var i = 0; i < freq.length; i++) present[freq[i][0]] = 1; }
    else { catSource(cat).forEach(function (s) { if (s) s.forEach(function (w) { present[w[0]] = 1; }); }); }
    var out = [];
    for (var j = 0; j < RU.length; j++) if (present[RU[j]]) out.push(RU[j]);
    return out;
  }
  function browse(cat, letter, cap) {
    cap = cap || 400;
    var out = [], total = 0;
    if (cat === 'freq') {
      var arr = freq.filter(function (w) { return w[0] === letter; }).sort();
      total = arr.length; out = arr.slice(0, cap);
    } else {
      catSource(cat).forEach(function (s) {
        if (s) s.forEach(function (w) { if (w[0] === letter) { total++; if (out.length < cap) out.push(w); } });
      });
      out.sort();
    }
    return { words: out, total: total, shown: out.length };
  }

  var api = {
    expand: expand,
    build: build,
    letters: letters,
    browse: browse,
    themeNames: themeNames,
    browseTheme: browseTheme,
    hasTheme: hasTheme,
    wordTheme: wordTheme,
    themeWordsOn: themeWordsOn,
    pickThemeHint: pickThemeHint,
    has: has,
    hasOther: hasOther,
    hasName: hasName,
    hasGeo: hasGeo,
    hasProper: hasProper,
    display: display,
    correct: correct,
    hasWordsOn: hasWordsOn,
    pickHint: pickHint,
    pickRichHint: pickRichHint,
    botCandidates: botCandidates,
    get ready() { return ready; },
    get meta() { return meta; },
    get size() { return full ? full.size : 0; }
  };
  return api;
});
