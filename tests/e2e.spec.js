/* Сквозные тесты (ТЗ §10). Запуск:
 *   npm i -D @playwright/test && npx playwright install chromium
 *   python3 -m http.server 8777    # в отдельном терминале
 *   npx playwright test
 * BASE можно переопределить: BASE=http://localhost:8777 npx playwright test */
const { test, expect } = require('@playwright/test');
const BASE = process.env.BASE || 'http://localhost:8777';

async function boot(page) {
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => window.Dict && window.Dict.ready, null, { timeout: 15000 });
}
const type = async (page, w) => {
  await page.fill('#word', w);
  await page.click('#send');
};
const letter = (page) => page.locator('#letter').innerText();

test('раунд на 3 игрока, завершение кнопкой, числа на итогах', async ({ page }) => {
  await boot(page);
  await page.click('#addP');                       // 3-й игрок
  await page.click('#startBtn');
  for (const w of ['арбуз', 'зебра', 'автобус', 'слон', 'нос', 'санки', 'иголка', 'апельсин']) {
    await type(page, w);
  }
  await page.click('#finishBtn');
  await expect(page.locator('#over')).toHaveClass(/on/);
  await expect(page.locator('#roundCards')).toContainText('Всего слов');
  await expect(page.locator('#letterDist')).toContainText('%');
});

test('РРРР не проходит без ручного зачёта, потом дообучается', async ({ page }) => {
  await boot(page);
  await page.click('#startBtn');
  await type(page, 'рррр');
  await expect(page.locator('#msg')).toHaveText('Не нашёл такого слова — проверим?');
  await expect(page.locator('#overrideBtn')).toHaveClass(/on/);
  await page.click('#overrideBtn');
  await expect(letter(page)).resolves.toBe('Р');    // принято вручную
});

test('глагол — внятная причина', async ({ page }) => {
  await boot(page);
  await page.click('#startBtn');
  await type(page, 'бежать');
  await expect(page.locator('#msg')).toHaveText('Пока берём только существительные и прилагательные');
});

test('форма слова — подсказка правильной формы', async ({ page }) => {
  await boot(page);
  await page.click('#startBtn');
  await type(page, 'ноги');
  await expect(page.locator('#msg')).toContainText('нога');
});

test('память: повтор из прошлого раунда', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => localStorage.clear());
  await page.click('#memSw');                       // помнить прошлые игры
  await page.click('#startBtn');
  await type(page, 'арбуз');
  await page.click('#finishBtn');
  await page.click('#againKeep');
  await type(page, 'арбуз');
  await expect(page.locator('#msg')).toHaveText('Это слово уже было');
});

test('320px: кнопки на месте, ничего не обрезано', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await boot(page);
  await page.click('#startBtn');
  await expect(page.locator('#finishBtn')).toBeVisible();
  await expect(page.locator('#passBtn')).toBeVisible();
});

test('пустой раунд возвращает на старт', async ({ page }) => {
  await boot(page);
  await page.click('#startBtn');
  await page.click('#finishBtn');
  await expect(page.locator('#setup')).toHaveClass(/on/);
});
