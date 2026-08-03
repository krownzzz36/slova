/* morph.js — лёгкий разбор формы слова и корневой ключ. Без DOM и без
 * морфологических библиотек: генерируем кандидатов на каноническую форму по
 * правилам и проверяем каждого в словаре. Точность нужна только для текста
 * подсказки — если не угадали, ход уходит в «не знаю слова». (ТЗ 4.3, 4.4) */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Morph = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Прилагательные: любое из этих окончаний -> мужской род (ый/ий/ой).
  var ADJ = ['ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ая', 'яя', 'ое', 'ее',
    'ые', 'ие', 'ый', 'ий', 'ой', 'ым', 'им', 'ых', 'их', 'ую', 'юю', 'ом', 'ем'];
  var ADJ_TAILS = ['ый', 'ий', 'ой'];

  // Существительные: окончание -> список замен ('' = отсечение).
  // Порядок важен: длинные окончания раньше коротких, замена раньше отсечения.
  var NOUN = [
    ['ами', ['а', 'я', '']], ['ями', ['я', 'а', '']],
    ['ах', ['а', 'я', '']], ['ях', ['я', 'а', '']],
    ['ам', ['а', 'я', '']], ['ям', ['я', 'а', '']],
    ['ов', ['']], ['ев', ['', 'ь']], ['ей', ['ь', 'я', '']],
    ['ом', ['']], ['ем', ['ь', '', 'й']], ['ою', ['а']], ['ой', ['а', '']],
    ['ые', ['']], ['ие', ['ь', 'й']],
    ['и', ['а', 'я', 'ь', 'о', 'й', '']], ['ы', ['а', 'о', '', 'ь']],
    ['а', ['', 'о']], ['я', ['ь', 'й', '']],
    ['у', ['', 'а', 'о']], ['ю', ['й', 'ь', 'я', '']],
    ['е', ['а', 'я', 'о', '']],
    ['о', ['']]
  ];

  // Каноническое слово, формой которого может быть nk. has(nk)->bool.
  function suggest(nk, has) {
    if (!nk || typeof has !== 'function') return null;
    var seen = {};
    function tryList(list, tailMode) {
      for (var i = 0; i < list.length; i++) {
        var suf = tailMode ? list[i] : list[i][0];
        if (nk.length > suf.length && nk.slice(-suf.length) === suf) {
          var base = nk.slice(0, nk.length - suf.length);
          var reps = tailMode ? ADJ_TAILS : list[i][1];
          for (var j = 0; j < reps.length; j++) {
            var cand = base + reps[j];
            if (cand !== nk && cand.length >= 2 && !seen[cand]) {
              seen[cand] = 1;
              if (has(cand)) return cand;
            }
          }
        }
      }
      return null;
    }
    return tryList(ADJ, true) || tryList(NOUN, false);
  }

  // Корневой ключ для отсечения однокоренных (трава/травка). Ложные срабатывания
  // неизбежны (нос/носок) — потому правило спорное и всегда overridable.
  var GRAM = ['ами', 'ями', 'ах', 'ях', 'ам', 'ям', 'ов', 'ев', 'ей', 'ом', 'ем',
    'ою', 'ой', 'ый', 'ий', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ым', 'им',
    'ых', 'их', 'ую', 'юю', 'а', 'я', 'о', 'е', 'у', 'ю', 'ы', 'и', 'ь', 'й'];
  var DIM = ['ёнок', 'енок', 'онок', 'ушк', 'юшк', 'ышк', 'очк', 'ечк', 'оньк',
    'еньк', 'чик', 'щик', 'ищ', 'ок', 'ек', 'ик', 'к'];

  function rootKey(nk) {
    if (!nk) return nk;
    var w = nk.replace(/ё/g, 'е');
    var orig = w;
    // 1. одно грамматическое окончание (самое длинное подходящее)
    for (var i = 0; i < GRAM.length; i++) {
      var g = GRAM[i];
      if (w.length - g.length >= 3 && w.slice(-g.length) === g) { w = w.slice(0, -g.length); break; }
    }
    // 2. уменьшительно-ласкательные/увеличительные суффиксы — по одному, пока режется
    var changed = true;
    while (changed) {
      changed = false;
      for (var k = 0; k < DIM.length; k++) {
        var d = DIM[k];
        if (w.length - d.length >= 3 && w.slice(-d.length) === d) {
          w = w.slice(0, -d.length);
          // возможная беглая гласная после суффикса
          if (/[аеиоуыюяё]$/.test(w) && w.length > 3) w = w.slice(0, -1);
          changed = true;
          break;
        }
      }
    }
    return w.length >= 3 ? w : orig;
  }

  return { suggest: suggest, rootKey: rootKey };
});
