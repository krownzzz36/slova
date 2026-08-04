/* bot.js — офлайн-оппонент «Робот», имитирующий живого игрока. Без DOM.
 * Умеет: думать по-человечески (снаппи, с разбросом, дольше на трудной букве),
 * иногда пасовать (чаще в тесных позициях), собирать задания (заканчивать слово
 * на нужную букву) и на сложном уровне ставить ловушки (трудная финальная буква).
 * Кандидатов на букву даёт Dict.botCandidates; здесь — стратегия и тайминг. UMD. */
(function (root, factory) {
  var api = factory(
    root.Rules || (typeof require !== 'undefined' && require('./rules.js')),
    root.Score || (typeof require !== 'undefined' && (function () { try { return require('./score.js'); } catch (e) { return null; } })())
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Bot = api;
})(typeof self !== 'undefined' ? self : this, function (Rules, Score) {
  'use strict';

  // Профили уровней:
  //   band     — доля частотного тира (0..1): лёгкий берёт частые слова, сложный из глубины
  //   passBase — базовый шанс «спасовать» даже при наличии слов (по-человечески)
  //   think*   — окно «размышления», мс (снаппи, не заторможенно)
  //   trap     — предпочитать ловушку (закончить на трудную букву)
  //   targetP  — шанс пойти на задание (закончить на нужную букву), если оно есть
  var LEVELS = {
    easy: { band: [0.00, 0.30], passBase: 0.13, thinkMin: 800,  thinkMax: 1800, trap: false, targetP: 0.45 },
    mid:  { band: [0.08, 0.60], passBase: 0.06, thinkMin: 600,  thinkMax: 1300, trap: false, targetP: 0.65 },
    hard: { band: [0.30, 1.00], passBase: 0.03, thinkMin: 450,  thinkMax: 950,  trap: true,  targetP: 0.85 }
  };
  function cfg(level) { return LEVELS[level] || LEVELS.mid; }

  // Время «размышления». На трудную букву думает заметно дольше — как человек.
  function thinkMs(level, hardLetter) {
    var c = cfg(level);
    var t = c.thinkMin + Math.floor(Math.random() * (c.thinkMax - c.thinkMin));
    if (hardLetter) t += 300 + Math.floor(Math.random() * 500);
    return t;
  }
  function band(level) { var c = cfg(level); return { from: c.band[0], to: c.band[1] }; }

  // Спасовать ли (при наличии кандидатов). Чаще пасует, когда вариантов мало
  // и когда буква трудная — так ведёт себя живой игрок, загнанный в угол.
  function shouldPass(level, poolSize, hardLetter) {
    var p = cfg(level).passBase;
    if (poolSize <= 2) p += 0.25;
    else if (poolSize <= 5) p += 0.10;
    if (hardLetter) p += 0.08;
    return Math.random() < Math.min(p, 0.6);
  }

  // Выбрать слово из пула. Приоритет:
  //   1) задание: закончить на opts.target (с вероятностью targetP) — «собрать цель»
  //   2) сложный уровень: ловушка — закончить на трудную букву
  //   3) иначе случайное из пула
  function choose(cands, level, opts) {
    if (!cands || !cands.length) return null;
    opts = opts || {};
    var c = cfg(level), skipJ = opts.skipJ;
    if (opts.target && Rules && Math.random() < c.targetP) {
      var goal = cands.filter(function (w) { return Rules.nextLetter(w, skipJ) === opts.target; });
      if (goal.length) return goal[Math.floor(Math.random() * Math.min(goal.length, 8))];
    }
    if (c.trap && Score && Rules) {
      var traps = cands.filter(function (w) { var f = Rules.nextLetter(w, skipJ); return f && Score.isHard(f); });
      if (traps.length) return traps[Math.floor(Math.random() * Math.min(traps.length, 8))];
    }
    return cands[Math.floor(Math.random() * cands.length)];
  }

  return { thinkMs: thinkMs, band: band, shouldPass: shouldPass, choose: choose, cfg: cfg };
});
