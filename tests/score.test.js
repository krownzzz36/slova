/* Юнит-тесты очковой экономики. Запуск: node --test */
const test = require('node:test');
const assert = require('node:assert');
const Score = require('../src/score.js');

test('ценность буквы по шкале Эрудита', () => {
  assert.strictEqual(Score.letterValue('а'), 1);
  assert.strictEqual(Score.letterValue('к'), 2);
  assert.strictEqual(Score.letterValue('ф'), 10);
  assert.strictEqual(Score.letterValue('щ'), 10);
  assert.strictEqual(Score.letterValue('-'), 0); // не буква
});

test('ё считается как е', () => {
  assert.strictEqual(Score.wordValue('ёж'), Score.wordValue('еж'));
});

test('ценность слова = сумма букв', () => {
  // с=1, ъ=10, е=1, ш=8, ь=3 -> «съешь»
  assert.strictEqual(Score.wordValue('съешь'), 1 + 10 + 1 + 8 + 3);
  assert.ok(Score.wordValue('съешь') > Score.wordValue('оса')); // дорогое > дешёвого
});

test('трудные буквы', () => {
  assert.strictEqual(Score.isHard('ф'), true);
  assert.strictEqual(Score.isHard('щ'), true);
  assert.strictEqual(Score.isHard('а'), false);
  assert.strictEqual(Score.trapBonus('ф'), 10);
  assert.strictEqual(Score.trapBonus('а'), 0);
});

test('moveScore: база + ловушка + серия + скорость + задание', () => {
  const base = Score.wordValue('шкаф'); // ш8 к2 а1 ф10 = 21
  // без контекста
  let r = Score.moveScore({ key: 'шкаф', finalLetter: 'ф', streak: 0, ms: 0, limit: 0, taskDone: false });
  assert.strictEqual(r.base, base);
  assert.strictEqual(r.trap, 10);      // закончил на ф
  assert.strictEqual(r.combo, 0);
  assert.strictEqual(r.speed, 0);
  assert.strictEqual(r.task, 0);
  assert.strictEqual(r.total, base + 10);

  // серия 5 -> combo = round(base*0.1*5)
  r = Score.moveScore({ key: 'шкаф', finalLetter: 'ф', streak: 5, ms: 0, limit: 0 });
  assert.strictEqual(r.combo, Math.round(base * 0.1 * 5));

  // задание выполнено
  r = Score.moveScore({ key: 'оса', finalLetter: 'а', taskDone: true });
  assert.strictEqual(r.task, Score.TASK_PTS);

  // бонус скорости только при limit>0; мгновенный ход -> максимум
  r = Score.moveScore({ key: 'оса', finalLetter: 'а', ms: 0, limit: 20 });
  assert.ok(r.speed > 0);
  r = Score.moveScore({ key: 'оса', finalLetter: 'а', ms: 999999, limit: 20 });
  assert.strictEqual(r.speed, 0); // время вышло — бонуса нет
});

test('previewScore = база + ловушка, ь/ъ/ы пропускаются как финал', () => {
  // «съешь» -> рабочая финальная буква ш (ь пропущен) -> ловушка 8
  assert.strictEqual(Score.previewScore('съешь', false), Score.wordValue('съешь') + 8);
});
