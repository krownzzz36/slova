/* bot.js — офлайн-оппонент «Робот». Чистая логика без DOM: выбор уровня, время
 * «размышления», выбор слова из пула кандидатов (сложный уровень предпочитает
 * закончить на трудную букву — ловушка, см. score.js). Кандидатов на нужную букву
 * поставляет Dict.botCandidates; здесь только стратегия выбора. UMD как rules.js. */
(function (root, factory) {
  var api = factory(
    root.Rules || (typeof require !== 'undefined' && require('./rules.js')),
    root.Score || (typeof require !== 'undefined' && (function () { try { return require('./score.js'); } catch (e) { return null; } })())
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Bot = api;
})(typeof self !== 'undefined' ? self : this, function (Rules, Score) {
  'use strict';

  // Профили уровней. band[] — доля частотного тира (0..1): лёгкий берёт частые слова,
  // сложный — из глубины (реже, «умнее»). pass — шанс спасовать. think — задержка мс.
  var LEVELS = {
    easy: { band: [0.00, 0.25], pass: 0.12, thinkMin: 1400, thinkMax: 2800, trap: false },
    mid:  { band: [0.10, 0.55], pass: 0.04, thinkMin: 900,  thinkMax: 1800, trap: false },
    hard: { band: [0.35, 1.00], pass: 0.00, thinkMin: 500,  thinkMax: 1100, trap: true }
  };
  function cfg(level) { return LEVELS[level] || LEVELS.mid; }

  function thinkMs(level) {
    var c = cfg(level);
    return c.thinkMin + Math.floor(Math.random() * (c.thinkMax - c.thinkMin));
  }
  function band(level) { var c = cfg(level); return { from: c.band[0], to: c.band[1] }; }
  function willPass(level) { return Math.random() < cfg(level).pass; }

  // Выбрать слово из пула. Сложный уровень предпочитает «ловушку» — слово,
  // отдающее сопернику трудную букву. Возврат: слово | null.
  function choose(cands, level, skipJ) {
    if (!cands || !cands.length) return null;
    var c = cfg(level);
    if (c.trap && Score && Rules) {
      var traps = cands.filter(function (w) {
        var f = Rules.nextLetter(w, skipJ);
        return f && Score.isHard(f);
      });
      if (traps.length) return traps[Math.floor(Math.random() * Math.min(traps.length, 8))];
    }
    return cands[Math.floor(Math.random() * cands.length)];
  }

  return { thinkMs: thinkMs, band: band, willPass: willPass, choose: choose, cfg: cfg };
});
