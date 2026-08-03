/* Юнит-тесты правил (ТЗ §10). Запуск:  node --test
 * Используют РЕАЛЬНЫЙ словарь из data/full.txt и data/other.txt. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const Rules = require('../src/rules.js');
const Morph = require('../src/morph.js');

const DATA = path.join(__dirname, '..', 'data');
const FULL = new Set(fs.readFileSync(path.join(DATA, 'full.txt'), 'utf8').split('\n').filter(Boolean));
const OTHER = new Set(fs.readFileSync(path.join(DATA, 'other.txt'), 'utf8').split('\n').filter(Boolean));

// Собираем state как в приложении.
function makeState(opts = {}) {
  const used = new Set((opts.used || []).map(Rules.norm));
  const usedRoots = {};
  (opts.used || []).forEach((w) => { usedRoots[Morph.rootKey(Rules.norm(w))] = Rules.norm(w); });
  const has = (nk) => FULL.has(nk) || (opts.custom || []).map(Rules.norm).includes(nk);
  return {
    required: opts.required || null,
    used,
    usedRoots,
    has,
    hasOther: (nk) => OTHER.has(nk),
    suggest: (nk) => Morph.suggest(nk, has),
    rootKey: Morph.rootKey,
    cfg: { strictRoots: opts.strictRoots !== false, skipJ: !!opts.skipJ }
  };
}
const check = (w, opts) => Rules.checkMove(w, makeState(opts));

// ---------------- Последняя буква ----------------
test('последняя буква', () => {
  const cases = [
    ['арбуз', 'з'], ['зонт', 'т'], ['соль', 'л'], ['конь', 'н'], ['мышь', 'ш'],
    ['подъезд', 'д'], ['силы', 'л'], ['стиль', 'л'], ['лошадь', 'д'], ['ёж', 'ж'],
    ['трамвай', 'й'], ['съёмка', 'а']
  ];
  for (const [w, L] of cases) assert.equal(Rules.nextLetter(w), L, w);
  assert.equal(Rules.nextLetter('трамвай', true), 'а', 'трамвай при skipJ');
});

// ---------------- Приём слова ----------------
test('приём слова: базовое', () => {
  assert.equal(check('рррр').reason, 'unknown');
  assert.equal(check('рррр').overridable, true);
  assert.equal(check('ыоан').reason, 'unknown');
  assert.equal(check('арбуз').ok, true);
  assert.equal(check('Арбуз').ok, true);
  assert.equal(check('Арбуз').word, 'арбуз');       // в историю — нижним регистром
  assert.equal(check('  арбуз  ').ok, true);         // пробелы срезаны
  assert.equal(check('cat').reason, 'not_cyrillic');
  assert.equal(check('я').reason, 'too_short');
});

test('приём слова: буква и часть речи', () => {
  assert.equal(check('зонт', { required: 'а' }).reason, 'wrong_letter');
  assert.equal(check('бежать', { required: 'б' }).reason, 'wrong_pos');
  assert.equal(check('быстро', { required: 'б' }).reason, 'wrong_pos');
});

test('приём слова: формы и подсказки', () => {
  const noga = check('ноги', { required: 'н' });
  assert.equal(noga.reason, 'wrong_form');
  assert.equal(noga.suggestion, 'нога');
  const kras = check('красивая', { required: 'к' });
  assert.equal(kras.reason, 'wrong_form');
  assert.equal(kras.suggestion, 'красивый');
  assert.equal(check('красивый', { required: 'к' }).ok, true);
});

test('приём слова: спец-случаи', () => {
  assert.equal(check('ножницы', { required: 'н' }).ok, true);     // нет ед. числа
  assert.equal(check('ёлка', { required: 'е' }).ok, true);        // ё=е на старте
  assert.equal(check('елка', { required: 'ё' }).ok, true);        // ё=е и в требуемой букве
  assert.equal(check('иван-чай', { required: 'и' }).ok, true);    // дефис допустим
});

// ---------------- Повторы ----------------
test('повторы', () => {
  assert.equal(check('зима', { used: ['зима'] }).reason, 'repeat');
  assert.equal(check('ЗИМА', { used: ['зима'] }).reason, 'repeat');
  assert.equal(check('зimа', { used: ['зима'] }).reason, 'not_cyrillic');

  const rootOn = check('травка', { used: ['трава'], strictRoots: true });
  assert.equal(rootOn.reason, 'same_root');
  assert.equal(rootOn.overridable, true);

  const rootOff = check('травка', { used: ['трава'], strictRoots: false });
  assert.equal(rootOff.ok, true);

  // известное ложное срабатывание нос/носок — принимается по overridable
  const falsePos = check('носок', { used: ['нос'], strictRoots: true });
  assert.equal(falsePos.reason, 'same_root');
  assert.equal(falsePos.overridable, true);

  // копилка прошлой игры
  assert.equal(check('арбуз', { used: ['арбуз'] }).reason, 'repeat');
  assert.equal(check('арбуз', { used: [] }).ok, true);
});

// ---------------- Ручной зачёт (custom) ----------------
test('свои слова проходят проверку', () => {
  assert.equal(check('кибердрон').reason, 'unknown');            // нет в словаре
  assert.equal(check('кибердрон', { custom: ['кибердрон'] }).ok, true);
});

// ---------------- Исправление опечаток ----------------
test('опечатка → typo с предложением исправления', () => {
  const st = makeState({});
  st.correct = (nk) => (nk === 'малоко' ? { key: 'молоко', display: 'молоко' } : null);
  const r = Rules.checkMove('малоко', st);
  assert.equal(r.reason, 'typo');
  assert.equal(r.suggestion, 'молоко');
  assert.equal(r.correctKey, 'молоко');
  assert.equal(r.overridable, true);
});

// ---------------- rootKey ----------------
test('корневой ключ', () => {
  assert.equal(Morph.rootKey('трава'), Morph.rootKey('травка'));
  assert.equal(Morph.rootKey('кот'), Morph.rootKey('котёнок'));
});
