/* score.js — очковая экономика игры. Чистый модуль без DOM: ценность букв
 * (шкала русского «Эрудита»/Скрэббла), ценность слова, «трудные» буквы и расчёт
 * очков за ход. Инъектируется/переиспользуется как rules.js (UMD). Ключи всюду
 * нормализованные (нижний регистр, ё->е, без дефисов) — как в остальном ядре.
 * Все константы формулы собраны здесь и тюнятся в одном месте. */
(function (root, factory) {
  var api = factory(root.Rules || (typeof require !== 'undefined' && require('./rules.js')));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Score = api;
})(typeof self !== 'undefined' ? self : this, function (Rules) {
  'use strict';

  // Шкала ценности букв (русский «Эрудит»). ё считаем как е (ключи уже норм.).
  var TIERS = [
    [1, 'оаеинтрсвл'], [2, 'кмдпу'], [3, 'бгья'],
    [4, 'йы'], [5, 'жзхцч'], [8, 'шэю'], [10, 'фщъ']
  ];
  var VAL = {};
  TIERS.forEach(function (t) { for (var i = 0; i < t[1].length; i++) VAL[t[1][i]] = t[0]; });
  VAL['ё'] = VAL['е'];                  // на случай ненормализованного ввода (ключи обычно уже ё->е)
  var HARD_MIN = 5;                    // «трудная» буква — ценность >= 5 (ж з х ц ч ш э ю ф щ)

  // Константы формулы (черновик, тюнятся).
  var COMBO_STEP = 0.1;                // +10% от базы за каждое слово серии
  var COMBO_CAP = 10;                  // потолок множителя серии
  var SPEED_K = 5;                     // максимум бонуса скорости (если включён таймер)
  var TASK_PTS = 5;                    // очки за выполненное задание
  var SWAP_COST = 8;                   // цена «сменить букву» в очках

  function letterValue(ch) { return VAL[ch] || 0; }
  function isHard(ch) { return (VAL[ch] || 0) >= HARD_MIN; }

  // Ценность слова = сумма ценностей букв нормализованного ключа.
  function wordValue(nk) {
    var s = 0, w = String(nk || '');
    for (var i = 0; i < w.length; i++) s += VAL[w[i]] || 0;
    return s;
  }

  // Бонус за «ловушку»: закончил на трудную букву -> её ценность (иначе 0).
  function trapBonus(finalLetter) {
    return finalLetter && isHard(finalLetter) ? letterValue(finalLetter) : 0;
  }

  /* Полный расчёт очков за принятый ход.
   * opts: { key, finalLetter, streak, ms, limit, taskDone }
   *   key         — нормализованный ключ слова
   *   finalLetter — буква, которую игрок передаёт сопернику (Rules.nextLetter)
   *   streak      — сколько слов подряд уже было ДО этого (для множителя серии)
   *   ms          — время хода в мс (для бонуса скорости)
   *   limit       — лимит хода в секундах (0 — таймера нет, бонуса скорости нет)
   *   taskDone    — выполнено ли задание «закончи на X»
   * Возврат: { base, trap, combo, speed, task, total } */
  function moveScore(opts) {
    opts = opts || {};
    var base = wordValue(opts.key);
    var trap = trapBonus(opts.finalLetter);
    var combo = Math.round(base * COMBO_STEP * Math.min(Math.max(opts.streak || 0, 0), COMBO_CAP));
    var speed = 0;
    if (opts.limit) {
      var lim = opts.limit * 1000;
      var rem = Math.max(0, lim - (opts.ms || 0));
      speed = Math.round(SPEED_K * rem / lim);
    }
    var task = opts.taskDone ? TASK_PTS : 0;
    var total = base + trap + combo + speed + task;
    return { base: base, trap: trap, combo: combo, speed: speed, task: task, total: total };
  }

  // Превью при наборе: база + возможная ловушка (серия/скорость/задание — контекст, не показываем).
  function previewScore(word, skipJ) {
    var nk = Rules ? Rules.norm(word) : String(word || '').toLowerCase().replace(/ё/g, 'е');
    if (!nk) return 0;
    var fin = Rules ? Rules.nextLetter(nk, skipJ) : null;
    return wordValue(nk) + trapBonus(fin);
  }

  return {
    letterValue: letterValue,
    wordValue: wordValue,
    isHard: isHard,
    trapBonus: trapBonus,
    moveScore: moveScore,
    previewScore: previewScore,
    TASK_PTS: TASK_PTS,
    SWAP_COST: SWAP_COST,
    HARD_MIN: HARD_MIN
  };
});
