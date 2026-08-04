/* rules.js — чистые правила игры «Слова». Никакого DOM.
 * Словарь и морфология инъектируются через объект state, поэтому модуль
 * тестируется с «фейковым» словарём (см. tests/rules.test.js). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SKIP = 'ьъы';               // всегда пропускаются с конца
  var VALID = /^[а-яё]+(-[а-яё]+)?$/i;

  // Ключ для сравнения слов и поиска в словаре.
  function norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[\s\-–—]+/g, '');
  }

  // Нормализованная первая буква (для проверки «на ту ли букву»).
  function firstLetter(s) {
    var n = norm(s);
    return n ? n[0] : null;
  }

  // Последняя «рабочая» буква: с конца, пропуская ь ъ ы (и й, если skipJ).
  function nextLetter(word, skipJ) {
    var n = norm(word);
    var skip = skipJ ? SKIP + 'й' : SKIP;
    for (var i = n.length - 1; i >= 0; i--) {
      if (skip.indexOf(n[i]) === -1) return n[i];
    }
    return null;
  }

  // Похоже ли на глагол/наречие по окончанию (запасной путь к «wrong_pos»).
  function looksLikeVerb(nk) {
    return /(ть|ться|тся|ешь|ишь|ует|ают|яют|уют|ють|ила|ыла|нул)$/.test(nk);
  }
  function looksLikeAdverb(nk) {
    return nk.length >= 5 && /(о|е)$/.test(nk) && /(ически|ально|ежно|ущно)/.test(nk);
  }

  // Сообщения игроку — дружелюбный тон, не судейский (ТЗ §7 / UX-ТЗ Задача 4).
  var MSG = {
    not_cyrillic: 'Только русские буквы',
    too_short: 'Слишком короткое слово',
    wrong_letter: function (L) { return 'Нужно слово на «' + L.toUpperCase() + '»'; },
    unknown: 'Не нашёл такого слова — проверим?',
    wrong_form: function (w) { return 'Это форма слова «' + w + '» — скажи «' + w + '»'; },
    wrong_pos: 'Пока берём только существительные и прилагательные',
    proper_off: 'Имена и города сейчас выключены',
    repeat: 'Это слово уже было',
    repeat_lemma: function (w) { return 'Уже было — «' + w + '»'; },
    same_root: function (w) { return 'Похоже на «' + w + '» — однокоренное'; },
    dead_end: 'На эту букву слов не осталось — меняем'
  };

  /* Главная проверка хода. state:
   *   required     — нужная первая буква (нормализованная) | null
   *   used         — Set нормализованных ключей (раунд + копилка)
   *   usedRoots    — { rootKey: 'слово-которое-заняло-корень' }
   *   has(nk)      — есть ли слово (словарь + свои слова)
   *   hasOther(nk) — известное слово другой части речи
   *   suggest(nk)  — каноническое слово, формой которого является nk | null
   *   rootKey(nk)  — корневой ключ
   *   cfg          — { strictRoots, skipJ }
   * Возврат: { ok, word, key, root, letter, reason, message, suggestion, overridable } */
  function checkMove(input, state) {
    var raw = String(input == null ? '' : input).trim().replace(/\s+/g, ' ');
    var cfg = state.cfg || {};

    // 1. Формальная валидность
    if (!raw) return fail('too_short', MSG.too_short, false);
    if (!VALID.test(raw)) return fail('not_cyrillic', MSG.not_cyrillic, false);
    var nk = norm(raw);
    if (nk.length < 2) return fail('too_short', MSG.too_short, false);

    // 2. Та ли первая буква (ё=е всюду, ТЗ 12.4)
    var req = state.required ? norm(state.required) : null;
    if (req && nk[0] !== req) {
      return fail('wrong_letter', MSG.wrong_letter(req), false);
    }

    // 3–4. Есть ли в словаре сущ./прил.; если нет — почему
    if (!state.has(nk)) {
      if (state.isProper && state.isProper(nk)) return fail('proper_off', MSG.proper_off, true);
      // Часть речи — ТОЛЬКО по словарю известных глаголов/наречий (state.hasOther).
      // Эвристику по окончаниям убрали: русские существительные сплошь на -ила/-ыла/-ла
      // (могила, кобыла, текила), она ложно метила их глаголами. wrong_pos теперь
      // продавливаемый — «Всё равно засчитать», чтобы никогда не застрять.
      if (state.hasOther(nk)) return fail('wrong_pos', MSG.wrong_pos, true);
      var canon = state.suggest ? state.suggest(nk) : null;
      if (canon && canon !== nk) {
        var r = fail('wrong_form', MSG.wrong_form(canon), false);
        r.suggestion = canon;
        return r;
      }
      // похоже на опечатку? предложить исправление (первая буква не меняется)
      var fix = state.correct ? state.correct(nk) : null;
      if (fix && fix.key !== nk) {
        var rf = fail('typo', '', true);
        rf.suggestion = fix.display; rf.correctKey = fix.key;
        return rf;
      }
      return fail('unknown', MSG.unknown, true); // единственный выход в ручной зачёт по «не знаю»
    }

    // 5. Повтор — точное совпадение
    if (state.used.has(nk)) return fail('repeat', MSG.repeat, false);

    // 6–7. Однокоренное (если включено)
    var root = state.rootKey ? state.rootKey(nk) : nk;
    if (cfg.strictRoots && state.usedRoots && state.usedRoots[root]) {
      var owner = state.usedRoots[root];
      if (owner !== nk) {
        var rr = fail('same_root', MSG.same_root(owner), true);
        rr.root = root; rr.suggestion = owner;
        return rr;
      }
    }

    // принято
    return {
      ok: true,
      word: raw.toLowerCase(),
      key: nk,
      root: root,
      letter: nextLetter(nk, cfg.skipJ),
      reason: 'ok',
      message: '',
      suggestion: null,
      overridable: false
    };

    function fail(reason, message, overridable) {
      return { ok: false, word: raw.toLowerCase(), key: nk, root: null,
        letter: null, reason: reason, message: message, suggestion: null,
        overridable: !!overridable };
    }
  }

  return {
    SKIP: SKIP,
    norm: norm,
    firstLetter: firstLetter,
    nextLetter: nextLetter,
    looksLikeVerb: looksLikeVerb,
    checkMove: checkMove,
    MSG: MSG
  };
});
