/* score.js — очковая экономика. Чистый модуль без DOM (UMD как rules.js).
 * Модель: очки = округл( база × скорость × серия ) + бонус_задания.
 *   база    = ценность букв (Эрудит) + редкость слова + ловушка (трудная финальная)
 *   скорость= множитель за время хода (быстро дороже), в детском выключен
 *   серия   = множитель за личную серию без осечек
 * Все константы формулы собраны здесь. Подробности — docs/Баланс-и-правила.md. */
(function (root, factory) {
  var api = factory(root.Rules || (typeof require !== 'undefined' && require('./rules.js')));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Score = api;
})(typeof self !== 'undefined' ? self : this, function (Rules) {
  'use strict';

  // Шкала ценности букв (русский «Эрудит»). ё считаем как е.
  var TIERS = [
    [1, 'оаеинтрсвл'], [2, 'кмдпу'], [3, 'бгья'],
    [4, 'йы'], [5, 'жзхцч'], [8, 'шэю'], [10, 'фщъ']
  ];
  var VAL = {};
  TIERS.forEach(function (t) { for (var i = 0; i < t[1].length; i++) VAL[t[1][i]] = t[0]; });
  VAL['ё'] = VAL['е'];
  var HARD_MIN = 5;                    // «трудная» буква — ценность >= 5

  // Константы баланса (тюнятся; таблица — в docs/Баланс-и-правила.md).
  var RARITY_MAX = 12;                 // макс. доплата за редкость слова
  var SPEED_FAST_MS = 3000;            // <= — максимальный множитель скорости
  var SPEED_SLOW_MS = 20000;           // >= — минимальный множитель скорости
  var SPEED_MAX = 1.5, SPEED_MIN = 0.9;
  var COMBO_STEP = 0.1;                // +10% множителя серии за слово
  var COMBO_CAP = 10;                  // потолок серии (×2.0)
  var MULT_CAP = 3.0;                  // потолок общего множителя
  var TASK_PTS = 5;                    // бонус за выполненное задание (не умножается)
  var SWAP_COST = 8;                   // цена «сменить букву» в очках

  function letterValue(ch) { return VAL[ch] || 0; }
  function isHard(ch) { return (VAL[ch] || 0) >= HARD_MIN; }
  function wordValue(nk) {
    var s = 0, w = String(nk || '');
    for (var i = 0; i < w.length; i++) s += VAL[w[i]] || 0;
    return s;
  }
  function trapBonus(finalLetter) { return finalLetter && isHard(finalLetter) ? letterValue(finalLetter) : 0; }
  function clamp01(x) { return Math.min(Math.max(x || 0, 0), 1); }
  function rarityBonus(rarity) { return Math.round(RARITY_MAX * clamp01(rarity)); }

  // Множитель за скорость хода. kids -> 1 (без давления). Линейно между fast и slow.
  function speedMult(ms, kids) {
    if (kids) return 1;
    ms = ms || 0;
    if (ms <= SPEED_FAST_MS) return SPEED_MAX;
    if (ms >= SPEED_SLOW_MS) return SPEED_MIN;
    var t = (ms - SPEED_FAST_MS) / (SPEED_SLOW_MS - SPEED_FAST_MS);
    return SPEED_MAX - t * (SPEED_MAX - SPEED_MIN);
  }
  // Множитель за личную серию (совпадает с показом «×N» в UI).
  function streakMult(streak) { return 1 + COMBO_STEP * Math.min(Math.max(streak || 0, 0), COMBO_CAP); }

  /* Полный расчёт очков за ход.
   * opts: { key, finalLetter, streak, ms, taskDone, rarity(0..1), kids }
   * Возврат: { letters, rarity, trap, base, speedMult, streakMult, mult, task, total } */
  function moveScore(opts) {
    opts = opts || {};
    var letters = wordValue(opts.key);
    var rare = rarityBonus(opts.rarity);
    var trap = trapBonus(opts.finalLetter);
    var base = letters + rare + trap;
    var sm = speedMult(opts.ms, opts.kids);
    var km = streakMult(opts.streak);
    var mult = Math.min(sm * km, MULT_CAP);
    var task = opts.taskDone ? TASK_PTS : 0;
    var total = Math.round(base * mult) + task;
    return { letters: letters, rarity: rare, trap: trap, base: base, speedMult: sm, streakMult: km, mult: mult, task: task, total: total };
  }

  // Превью при наборе: «сырая» база (буквы + редкость + ловушка), без множителей.
  function previewScore(word, skipJ, rarity) {
    var nk = Rules ? Rules.norm(word) : String(word || '').toLowerCase().replace(/ё/g, 'е');
    if (!nk) return 0;
    var fin = Rules ? Rules.nextLetter(nk, skipJ) : null;
    return wordValue(nk) + rarityBonus(rarity) + trapBonus(fin);
  }

  return {
    letterValue: letterValue, wordValue: wordValue, isHard: isHard, trapBonus: trapBonus,
    rarityBonus: rarityBonus, speedMult: speedMult, streakMult: streakMult,
    moveScore: moveScore, previewScore: previewScore,
    TASK_PTS: TASK_PTS, SWAP_COST: SWAP_COST, HARD_MIN: HARD_MIN, MULT_CAP: MULT_CAP
  };
});
