/* Юнит-тесты очковой экономики (мультипликативная модель). Запуск: node --test */
const test = require('node:test');
const assert = require('node:assert');
const Score = require('../src/score.js');

test('ценность буквы по шкале Эрудита', () => {
  assert.strictEqual(Score.letterValue('а'), 1);
  assert.strictEqual(Score.letterValue('к'), 2);
  assert.strictEqual(Score.letterValue('ф'), 10);
  assert.strictEqual(Score.letterValue('-'), 0);
});

test('ё считается как е; ценность слова = сумма букв', () => {
  assert.strictEqual(Score.wordValue('ёж'), Score.wordValue('еж'));
  assert.strictEqual(Score.wordValue('съешь'), 1 + 10 + 1 + 8 + 3);
  assert.ok(Score.wordValue('съешь') > Score.wordValue('оса'));
});

test('трудные буквы и ловушка', () => {
  assert.strictEqual(Score.isHard('ф'), true);
  assert.strictEqual(Score.isHard('а'), false);
  assert.strictEqual(Score.trapBonus('ф'), 10);
  assert.strictEqual(Score.trapBonus('а'), 0);
});

test('множитель скорости: быстро дороже, медленно дешевле, в детском =1', () => {
  assert.strictEqual(Score.speedMult(0, false), 1.5);
  assert.strictEqual(Score.speedMult(999999, false), 0.9);
  assert.ok(Score.speedMult(8000, false) > 0.9 && Score.speedMult(8000, false) < 1.5);
  assert.strictEqual(Score.speedMult(999999, true), 1);   // детский — без давления
});

test('множитель серии: 1.0 .. 2.0', () => {
  assert.strictEqual(Score.streakMult(0), 1);
  assert.ok(Math.abs(Score.streakMult(5) - 1.5) < 1e-9);
  assert.strictEqual(Score.streakMult(100), 2);           // потолок ×2
});

test('редкость доплачивает к базе', () => {
  assert.strictEqual(Score.rarityBonus(0), 0);
  assert.strictEqual(Score.rarityBonus(1), 12);
  assert.ok(Score.rarityBonus(0.5) > 0);
});

test('moveScore: округл(база × скорость × серия) + задание', () => {
  // детский (скорость=1), серия 0 -> множитель 1 -> total = база
  var base = Score.wordValue('шкаф') + Score.trapBonus('ф'); // 21 + 10 = 31
  var r = Score.moveScore({ key: 'шкаф', finalLetter: 'ф', streak: 0, ms: 0, kids: true });
  assert.strictEqual(r.base, 31);
  assert.strictEqual(r.total, 31);

  // редкость 1 добавляет +12 к базе
  r = Score.moveScore({ key: 'шкаф', finalLetter: 'ф', rarity: 1, kids: true });
  assert.strictEqual(r.base, 31 + 12);

  // серия 10 -> ×2 (детский, скорость 1)
  r = Score.moveScore({ key: 'шкаф', finalLetter: 'ф', streak: 10, kids: true });
  assert.strictEqual(r.total, Math.round(31 * 2));

  // задание +5 сверху, не умножается
  r = Score.moveScore({ key: 'оса', finalLetter: 'а', taskDone: true, kids: true });
  assert.strictEqual(r.total, Score.wordValue('оса') + Score.TASK_PTS);

  // общий множитель ограничен MULT_CAP
  r = Score.moveScore({ key: 'шкаф', finalLetter: 'ф', streak: 100, ms: 0, kids: false });
  assert.ok(r.mult <= Score.MULT_CAP + 1e-9);
});

test('previewScore = база + редкость + ловушка', () => {
  assert.strictEqual(Score.previewScore('съешь', false, 0), Score.wordValue('съешь') + 8);
  assert.strictEqual(Score.previewScore('съешь', false, 1), Score.wordValue('съешь') + 8 + 12);
});
