/* stats.js — расчёт статистики раунда из журнала событий. Чистая функция,
 * пересчитывает всё из log (устойчиво к отмене хода). Без DOM. (ТЗ 4.7) */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function wlen(w) { return (w || '').replace(/-/g, '').length; }

  // players: [{name,color}], log: массив событий (см. ui.js)
  function compute(players, log) {
    var n = players.length;
    var P = players.map(function (p, i) {
      return { i: i, name: p.name, color: p.color, words: 0, ms: 0, passes: 0,
        timeouts: 0, hints: 0, manual: 0, bonus: 0, wordEvents: [] };
    });

    var totalWordLen = 0, totalWords = 0, durationMs = 0;
    var longestWord = null, fastestWord = null, slowestWord = null;
    var streak = 0, bestStreak = 0;
    var letter = {}; // L -> {words, fails, ms}

    function bump(L, key, val) {
      if (!L) return;
      if (!letter[L]) letter[L] = { words: 0, fails: 0, ms: 0 };
      letter[L][key] += (val == null ? 1 : val);
    }

    log.forEach(function (ev) {
      var p = P[ev.player];
      if (!p) return;
      durationMs += ev.ms || 0;
      if (ev.type === 'word') {
        p.words++; p.ms += ev.ms || 0;
        if (ev.hinted) p.hints++;
        if (ev.manual) p.manual++;
        if (ev.bonus) p.bonus += ev.bonus;
        p.wordEvents.push(ev);
        totalWords++; totalWordLen += wlen(ev.word);
        bump(ev.letter, 'words'); bump(ev.letter, 'ms', ev.ms || 0);
        var rec = { word: ev.word, player: ev.player, ms: ev.ms || 0 };
        if (!longestWord || wlen(ev.word) > wlen(longestWord.word)) longestWord = rec;
        if (!fastestWord || rec.ms < fastestWord.ms) fastestWord = rec;
        if (!slowestWord || rec.ms > slowestWord.ms) slowestWord = rec;
        streak++; if (streak > bestStreak) bestStreak = streak;
      } else {
        if (ev.type === 'pass') p.passes++;
        if (ev.type === 'timeout') p.timeouts++;
        p.ms += ev.ms || 0;
        bump(ev.letter, 'words'); bump(ev.letter, 'fails');
        streak = 0;
      }
    });

    P.forEach(function (p) {
      p.avg = p.words ? p.ms / p.words : Infinity;
      var evs = p.wordEvents;
      p.fastest = evs.length ? evs.reduce(function (a, b) { return b.ms < a.ms ? b : a; }) : null;
      p.slowest = evs.length ? evs.reduce(function (a, b) { return b.ms > a.ms ? b : a; }) : null;
      p.longest = evs.length ? evs.reduce(function (a, b) { return wlen(b.word) > wlen(a.word) ? b : a; }) : null;
    });

    var rank = P.slice().sort(function (a, b) {
      if (a.avg !== b.avg) return a.avg - b.avg;
      return b.words - a.words;
    });
    var best = totalWords ? rank[0] : null;
    var maxWords = Math.max.apply(null, P.map(function (p) { return p.words; }).concat(0));

    // распределение по буквам, на которые отвечали (только реальные слова, без пасов)
    var dist = Object.keys(letter).map(function (L) {
      return { letter: L, count: letter[L].words - letter[L].fails };
    }).filter(function (d) { return d.count > 0; })
      .sort(function (a, b) { return b.count - a.count; });
    var distTotal = dist.reduce(function (s, d) { return s + d.count; }, 0) || 1;
    dist.forEach(function (d) { d.pct = Math.round(d.count / distTotal * 100); });

    // самая злая буква: (пасы+таймауты)/ходы, минимум 3 хода
    var hardest = null;
    Object.keys(letter).forEach(function (L) {
      var l = letter[L], moves = l.words; // words здесь = все ходы на букве
      if (moves >= 3 && l.fails > 0) {
        var ratio = l.fails / moves;
        if (!hardest || ratio > hardest.ratio) hardest = { letter: L, ratio: ratio, fails: l.fails, moves: moves };
      }
    });
    // самая быстрая буква: минимальное среднее время слова (нужны реальные слова)
    var fastestLetter = null;
    Object.keys(letter).forEach(function (L) {
      var l = letter[L];
      var wordsOnly = l.words - l.fails;
      if (wordsOnly >= 2 && l.ms > 0) {
        var avg = l.ms / wordsOnly;
        if (!fastestLetter || avg < fastestLetter.avg) fastestLetter = { letter: L, avg: avg };
      }
    });

    var manualCount = P.reduce(function (s, p) { return s + p.manual; }, 0);

    return {
      players: P, rank: rank, best: best, maxWords: maxWords,
      totalWords: totalWords, durationMs: durationMs,
      avgWordLen: totalWords ? totalWordLen / totalWords : 0,
      longestWord: longestWord, fastestWord: fastestWord, slowestWord: slowestWord,
      bestStreak: bestStreak, manualCount: manualCount,
      dist: dist, hardest: hardest, fastestLetter: fastestLetter
    };
  }

  return { compute: compute };
});
