/* sharecard.js — рендер итоговой картинки-цепочки на canvas (UX-ТЗ Задача 3).
 * Локально, синхронно, без сети. Фиксированные цвета (не зависят от темы), чтобы
 * картинка одинаково читалась в тёмном и светлом чате. Возвращает <canvas>. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShareCard = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var C = { bg: '#f6f3ee', card: '#ffffff', text: '#1c1a17', muted: '#8a8378', line: '#e6e0d6', accent: '#e8663c' };
  var FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif';

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function cap(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : ''; }

  // opts: { winner, sub, words:[string], hardest:'С'|null }
  function draw(opts) {
    opts = opts || {};
    var words = (opts.words || []).slice();
    var MAX = 12, extra = 0;
    if (words.length > MAX) { extra = words.length - (MAX - 1); words = words.slice(0, MAX - 1); }

    var W = 1080, pad = 60, tileH = 92, gap = 18;
    var headerH = 250, footerH = 110;
    var rows = words.length + (extra ? 1 : 0);
    var chainH = rows * (tileH + gap);
    var H = Math.round(headerH + chainH + footerH);

    var dpr = 2;
    try { dpr = Math.min(3, Math.max(1, Math.round(self.devicePixelRatio || 2))); } catch (e) {}
    var c = document.createElement('canvas');
    c.width = W * dpr; c.height = H * dpr;
    var ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    var cx = W / 2;

    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

    // заголовок «Слова — тебе на А» (двухцветный, по центру)
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = '800 62px ' + FONT;
    var t1 = 'Слова', t2 = ' — тебе на А';
    var w1 = ctx.measureText(t1).width, w2 = ctx.measureText(t2).width;
    var tx = cx - (w1 + w2) / 2;
    ctx.fillStyle = C.text; ctx.fillText(t1, tx, 84);
    ctx.fillStyle = C.accent; ctx.fillText(t2, tx + w1, 84);

    // победитель + подпись
    ctx.textAlign = 'center';
    ctx.fillStyle = C.text; ctx.font = '800 46px ' + FONT;
    ctx.fillText(opts.winner || '', cx, 168);
    ctx.fillStyle = C.muted; ctx.font = '600 32px ' + FONT;
    ctx.fillText(opts.sub || '', cx, 216);

    // цепочка слов
    var tileW = W - pad * 2, x = pad, y = headerH;
    for (var i = 0; i < words.length; i++) {
      ctx.fillStyle = C.card; ctx.strokeStyle = C.line; ctx.lineWidth = 2;
      rr(ctx, x, y, tileW, tileH, 20); ctx.fill(); ctx.stroke();
      var disp = cap(words[i]);
      ctx.font = '700 44px ' + FONT;
      var full = ctx.measureText(disp).width;
      var head = disp.slice(0, -1), tail = disp.slice(-1);
      var hw = ctx.measureText(head).width;
      var sx = cx - full / 2, ty = y + tileH / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = C.text; ctx.fillText(head, sx, ty);
      ctx.fillStyle = C.accent; ctx.fillText(tail, sx + hw, ty);
      ctx.textAlign = 'center';
      y += tileH + gap;
    }
    if (extra) {
      ctx.fillStyle = C.muted; ctx.font = '600 32px ' + FONT;
      ctx.fillText('… и ещё ' + extra + ' сл.', cx, y + tileH / 2);
      y += tileH + gap;
    }

    // футер: злая буква + адрес
    var fy = H - footerH / 2 - 6;
    if (opts.hardest) {
      ctx.fillStyle = C.text; ctx.font = '700 30px ' + FONT;
      ctx.fillText('😤 злая буква «' + String(opts.hardest).toUpperCase() + '»', cx, fy - 18);
    }
    ctx.fillStyle = C.muted; ctx.font = '600 26px ' + FONT;
    ctx.fillText('krownzzz36.github.io/slova', cx, fy + (opts.hardest ? 22 : 0));

    return c;
  }

  return { draw: draw };
});
