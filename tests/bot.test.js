/* Юнит-тесты бота-оппонента. Запуск: node --test */
const test = require('node:test');
const assert = require('node:assert');
const Bot = require('../src/bot.js');

test('choose: пустой пул -> null', () => {
  assert.strictEqual(Bot.choose([], 'mid', { skipJ: false }), null);
  assert.strictEqual(Bot.choose(null, 'mid', { skipJ: false }), null);
});

test('choose: возвращает слово из пула', () => {
  const cands = ['коса', 'рука', 'вода'];
  for (let i = 0; i < 20; i++) assert.ok(cands.includes(Bot.choose(cands, 'easy', { skipJ: false })));
});

test('сложный уровень без задания предпочитает ловушку (трудную финальную)', () => {
  // «шкаф» кончается на ф (трудная), «коса»/«рука» — нет
  const cands = ['коса', 'шкаф', 'рука'];
  for (let i = 0; i < 30; i++) assert.strictEqual(Bot.choose(cands, 'hard', { skipJ: false }), 'шкаф');
});

test('собирает задание: чаще заканчивает на нужную букву', () => {
  // цель — закончить на «т»; «кот» подходит, «шкаф» (ловушка) — нет
  const cands = ['кот', 'шкаф', 'рука'];
  let goalHits = 0;
  for (let i = 0; i < 200; i++) if (Bot.choose(cands, 'hard', { skipJ: false, target: 'т' }) === 'кот') goalHits++;
  assert.ok(goalHits > 120, 'ожидали частый выбор цели, получили ' + goalHits + '/200');
});

test('thinkMs: в окне уровня; трудная буква добавляет время', () => {
  const c = Bot.cfg('mid');
  for (let i = 0; i < 30; i++) {
    const t = Bot.thinkMs('mid', false);
    assert.ok(t >= c.thinkMin && t <= c.thinkMax);
  }
  for (let i = 0; i < 30; i++) assert.ok(Bot.thinkMs('mid', true) >= c.thinkMin);
});

test('shouldPass: булево; в тесной позиции пасует чаще', () => {
  assert.strictEqual(typeof Bot.shouldPass('mid', 10, false), 'boolean');
  let tight = 0, wide = 0;
  for (let i = 0; i < 400; i++) { if (Bot.shouldPass('mid', 1, false)) tight++; if (Bot.shouldPass('mid', 20, false)) wide++; }
  assert.ok(tight > wide, 'в тесной позиции должно пасовать чаще: ' + tight + ' vs ' + wide);
});

test('band возвращает доли полосы тира', () => {
  const b = Bot.band('hard');
  assert.ok(b.from >= 0 && b.to <= 1 && b.from < b.to);
});
