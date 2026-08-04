/* Юнит-тесты бота-оппонента. Запуск: node --test */
const test = require('node:test');
const assert = require('node:assert');
const Bot = require('../src/bot.js');

test('choose: пустой пул -> null', () => {
  assert.strictEqual(Bot.choose([], 'mid', false), null);
  assert.strictEqual(Bot.choose(null, 'mid', false), null);
});

test('choose: возвращает слово из пула', () => {
  const cands = ['коса', 'рука', 'вода'];
  for (let i = 0; i < 20; i++) assert.ok(cands.includes(Bot.choose(cands, 'easy', false)));
});

test('сложный уровень предпочитает ловушку (трудную финальную букву)', () => {
  // «шкаф» кончается на ф (трудная) -> ловушка; «коса» на а -> нет
  const cands = ['коса', 'шкаф', 'рука'];
  let trapHits = 0;
  for (let i = 0; i < 30; i++) if (Bot.choose(cands, 'hard', false) === 'шкаф') trapHits++;
  assert.strictEqual(trapHits, 30); // всегда выбирает ловушку, когда она есть
});

test('thinkMs в диапазоне уровня; willPass(hard) всегда false', () => {
  const c = Bot.cfg('easy');
  for (let i = 0; i < 20; i++) {
    const t = Bot.thinkMs('easy');
    assert.ok(t >= c.thinkMin && t <= c.thinkMax);
  }
  for (let i = 0; i < 20; i++) assert.strictEqual(Bot.willPass('hard'), false);
});

test('band возвращает доли полосы тира', () => {
  const b = Bot.band('hard');
  assert.ok(b.from >= 0 && b.to <= 1 && b.from < b.to);
});
