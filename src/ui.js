/* ui.js — оркестрация: экраны, обработчики, ход партии, отрисовка.
 * Правила и морфология — в rules.js/morph.js (чистые). Здесь только DOM и состояние. */
(function () {
  'use strict';
  var V = '4';                         // версия для ?v= (обход кеша Телеграма)
  var HINT_PENALTY_MS = 5000;          // штраф за подсказку (ТЗ 4.5)
  var SWAPS_PER_GAME = 3;              // «сменить букву» на игрока за партию
  var TASK_BONUS = 3;                  // очки за выполненное задание

  var $ = function (id) { return document.getElementById(id); };
  var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

  var COLORS = ['#e8663c', '#3b8ea5', '#7a5ea8', '#4a9d5f', '#d4a017', '#c2456e'];
  var LIMITS = [{ v: 0, t: 'без лимита' }, { v: 10, t: '10 сек' }, { v: 20, t: '20 сек' }, { v: 30, t: '30 сек' }];
  var HINTS = [{ v: 0, t: 'выкл' }, { v: 3, t: '3' }, { v: Infinity, t: 'без лимита' }];
  var LIVES = [{ v: 0, t: 'выкл' }, { v: 3, t: '3 ♥' }, { v: 5, t: '5 ♥' }];

  var CFG = { names: ['Игрок 1', 'Игрок 2'], limit: 0, memory: false, strictRoots: true,
    skipJ: true, hintLimit: 3, proper: false, anyPos: false, lives: 0, kids: false, tasks: false };
  var MEM = new Set();                 // копилка (нормализованные ключи)
  var CUSTOM = new Set();              // свои слова (проходят проверку всегда)
  var G = null;
  var dictReady = false, dictDegraded = false;
  var timerId = null, turnStart = 0, warned = false, paused = false;

  /* ---------- утилиты ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function cap(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : ''; }
  function fmtSec(ms) { return (ms / 1000).toFixed(1).replace('.', ','); }
  function fmtTot(ms) { var s = Math.round(ms / 1000), m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
  function fmtNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function show(id) { var l = document.querySelectorAll('.screen'); for (var i = 0; i < l.length; i++) l[i].classList.remove('on'); $(id).classList.add('on'); }
  function buzz(kind) {
    try {
      if (tg && tg.HapticFeedback) {
        if (kind === 'ok') tg.HapticFeedback.impactOccurred('light');
        else if (kind === 'warn') tg.HapticFeedback.impactOccurred('heavy');
        else tg.HapticFeedback.notificationOccurred('error');
      } else if (navigator.vibrate) {
        navigator.vibrate(kind === 'ok' ? 12 : (kind === 'warn' ? [40] : [25, 40, 25]));
      }
    } catch (e) {}
  }

  /* ---------- тема Telegram ---------- */
  function applyTheme() {
    if (!tg || !tg.themeParams) return;
    var p = tg.themeParams, r = document.documentElement.style;
    if (p.bg_color) r.setProperty('--bg', p.bg_color);
    if (p.secondary_bg_color) r.setProperty('--card', p.secondary_bg_color);
    if (p.text_color) r.setProperty('--text', p.text_color);
    if (p.hint_color) r.setProperty('--muted', p.hint_color);
  }

  /* ============ ХРАНИЛИЩЕ ============ */
  function loadAll(cb) {
    var pending = 3;
    function done() { if (--pending === 0) cb(); }
    Storage.get('cfg', function (v) { if (v && typeof v === 'object') { for (var k in CFG) if (k in v) CFG[k] = v[k]; if (CFG.hintLimit === null) CFG.hintLimit = Infinity; } done(); });
    Storage.getList('memory', function (arr) { arr.forEach(function (w) { MEM.add(w); }); done(); });
    Storage.getList('custom', function (arr) { arr.forEach(function (w) { CUSTOM.add(w); }); done(); });
  }
  function saveCfg() { var c = {}; for (var k in CFG) c[k] = (CFG[k] === Infinity ? null : CFG[k]); Storage.set('cfg', c); }
  function saveMem() { Storage.setList('memory', Array.from(MEM)); }
  function saveCustom() { Storage.setList('custom', Array.from(CUSTOM)); }
  function saveResume() {
    if (!G) return;
    Storage.set('resume', {
      players: G.players, turn: G.turn, required: G.required, lastWord: G.lastWord,
      log: G.log.map(function (e) { return { type: e.type, player: e.player, ms: e.ms, word: e.word, key: e.key, root: e.root, letter: e.letter, manual: e.manual, hinted: e.hinted }; }),
      memBase: Array.from(G.memBase), cfg: { limit: CFG.limit, memory: CFG.memory, strictRoots: CFG.strictRoots, skipJ: CFG.skipJ, hintLimit: CFG.hintLimit === Infinity ? null : CFG.hintLimit, proper: CFG.proper, anyPos: CFG.anyPos, lives: CFG.lives, tasks: CFG.tasks, kids: CFG.kids },
      words: G.players.reduce(function (s, p) { return s + p.words; }, 0)
    });
  }
  function clearResume() { Storage.del('resume'); }

  /* ============ СЛОВАРЬ (асинхронно) ============ */
  function loadDict() {
    status('словарь загружается…');
    var s = document.createElement('script');
    s.src = 'data/dict-data.js?v=' + V;
    s.onload = function () {
      try { Dict.build(window); dictReady = true; status('словарь <b>' + fmtNum(Dict.size) + '</b> слов'); }
      catch (e) { degrade(); }
      enableStart();
    };
    s.onerror = function () { degrade(); enableStart(); };
    document.head.appendChild(s);
  }
  function degrade() { dictDegraded = true; dictReady = false; status('офлайн — мягкая проверка слов'); }
  function status(html) { $('dictStatus').innerHTML = html; }
  function enableStart() { $('startBtn').disabled = false; }

  /* ============ ЭКРАН СТАРТА ============ */
  function renderSetup() {
    var h = '';
    CFG.names.forEach(function (n, i) {
      h += '<div class="prow"><span class="dot" style="background:' + COLORS[i % 6] + '"></span>' +
        '<input data-i="' + i + '" value="' + esc(n) + '" maxlength="14" autocomplete="off" placeholder="Имя">' +
        (CFG.names.length > 1 ? '<button class="del" data-del="' + i + '">✕</button>' : '') + '</div>';
    });
    $('plist').innerHTML = h;
    $('addP').style.display = CFG.names.length >= 6 ? 'none' : '';

    $('limits').innerHTML = LIMITS.map(function (l) {
      return '<button class="chip' + (CFG.limit === l.v ? ' on' : '') + '" data-lim="' + l.v + '">' + l.t + '</button>';
    }).join('');
    $('hintLimits').innerHTML = HINTS.map(function (l) {
      return '<button class="chip' + (CFG.hintLimit === l.v ? ' on' : '') + '" data-hint="' + l.v + '">' + l.t + '</button>';
    }).join('');
    $('livesChips').innerHTML = LIVES.map(function (l) {
      return '<button class="chip' + (CFG.lives === l.v ? ' on' : '') + '" data-lives="' + l.v + '">' + l.t + '</button>';
    }).join('');

    $('kidsSw').classList.toggle('on', CFG.kids);
    $('properSw').classList.toggle('on', CFG.proper);
    $('posSw').classList.toggle('on', CFG.anyPos);
    $('rootSw').classList.toggle('on', CFG.strictRoots);
    $('jSw').classList.toggle('on', CFG.skipJ);
    $('tasksSw').classList.toggle('on', CFG.tasks);
    $('memSw').classList.toggle('on', CFG.memory);
    memInfo();
    $('customCount').textContent = CUSTOM.size ? ('  ' + CUSTOM.size) : '';
  }

  // Детский режим — пресет прощающих настроек (ТЗ: чтобы ребёнок разобрался).
  function applyKids(on) {
    CFG.kids = on;
    if (on) { CFG.limit = 0; CFG.hintLimit = Infinity; CFG.lives = 0; CFG.strictRoots = false; CFG.skipJ = true; CFG.anyPos = false; CFG.tasks = false; }
    $('tasksSw').classList.toggle('on', CFG.tasks);
  }
  function memInfo() {
    $('memInfo').textContent = MEM.size
      ? ('в копилке ' + MEM.size + ' сл.' + (Storage.persistent ? '' : ' — до закрытия'))
      : 'пока пусто';
  }

  /* ============ ПАРТИЯ ============ */
  function newGame(memBaseArr) {
    var names = CFG.names.map(function (n, i) { return (n || '').trim() || ('Игрок ' + (i + 1)); });
    var base = memBaseArr || (CFG.memory ? Array.from(MEM) : []);
    if (!CFG.memory) MEM.clear();
    G = {
      players: names.map(function (n, i) { return { name: n, color: COLORS[i % 6], hints: 0, swaps: SWAPS_PER_GAME }; }),
      turn: 0, required: null, lastWord: null, deadEnd: false,
      memBase: new Set(base),
      used: new Set(), usedRoots: {}, usedFirstCount: {},
      log: [], streak: 0, turnPenalty: 0, task: null, over: false,
      hint: null, hintUsedThisTurn: false, pending: null
    };
    syncDerived();
    nextTask();
    $('hist').innerHTML = '<div class="empty">Слова появятся здесь.<br>Повторяться нельзя — телефон помнит все.</div>';
    $('word').value = ''; setMsg(''); hideMask(); hidePause();
    show('game'); render(); startClock(); focusInput();
  }

  // Пересчёт производных из memBase + log (устойчиво к отмене): used/roots + счётчики
  // игроков (слова, время, пасы, таймауты, бонусы, жизни, выбывание).
  function syncDerived() {
    G.used = new Set(G.memBase);
    G.usedRoots = {}; G.usedFirstCount = {};
    G.memBase.forEach(function (k) { G.usedFirstCount[k[0]] = (G.usedFirstCount[k[0]] || 0) + 1; });
    MEM = new Set(G.memBase);
    G.players.forEach(function (p) { p.words = 0; p.ms = 0; p.passes = 0; p.timeouts = 0; p.manual = 0; p.bonus = 0; });
    G.log.forEach(function (e) {
      var p = G.players[e.player]; if (!p) return;
      p.ms += e.ms || 0;
      if (e.type === 'word') {
        p.words++; if (e.manual) p.manual++; if (e.bonus) p.bonus += e.bonus;
        G.used.add(e.key); MEM.add(e.key);
        if (e.root) G.usedRoots[e.root] = e.key;
        G.usedFirstCount[e.key[0]] = (G.usedFirstCount[e.key[0]] || 0) + 1;
      } else if (e.type === 'pass') p.passes++;
      else if (e.type === 'timeout') p.timeouts++;
    });
    // жизни: старт минус пасы/таймауты; 0 -> выбыл
    G.players.forEach(function (p) {
      if (CFG.lives) { p.lives = Math.max(0, CFG.lives - p.passes - p.timeouts); p.out = p.lives === 0; }
      else { p.lives = 0; p.out = false; }
    });
  }

  function state() {
    return {
      required: G.required, used: G.used, usedRoots: G.usedRoots,
      has: function (nk) {
        return (dictReady && Dict.has(nk)) || CUSTOM.has(nk) ||
          (CFG.proper && dictReady && Dict.hasProper(nk)) ||
          (CFG.anyPos && dictReady && Dict.hasOther(nk));
      },
      hasOther: function (nk) { return dictReady && Dict.hasOther(nk); },
      isProper: function (nk) { return dictReady && Dict.hasProper(nk); },
      suggest: function (nk) { return dictReady ? Morph.suggest(nk, function (c) { return Dict.has(c) || CUSTOM.has(c); }) : null; },
      rootKey: Morph.rootKey,
      cfg: { strictRoots: CFG.strictRoots, skipJ: CFG.skipJ }
    };
  }

  function aliveCount() { return G.players.filter(function (p) { return !p.out; }).length; }
  function nextTurn(from) {
    var n = G.players.length, t = from;
    for (var i = 0; i < n; i++) { t = (t + 1) % n; if (!G.players[t].out) return t; }
    return from; // все выбыли — оставляем как есть (игра закончится)
  }
  // случайная достижимая буква для задания «закончи на …»
  function nextTask() {
    if (!CFG.tasks || !dictReady) { G.task = null; return; }
    var pool = 'абвгдежзиклмнопрстуфхцчшэюя'.split('');
    for (var tries = 0; tries < 20; tries++) {
      var L = pool[Math.floor(Math.random() * pool.length)];
      if (Dict.hasWordsOn(L, G.usedFirstCount)) { G.task = { end: L }; return; }
    }
    G.task = null;
  }

  /* ---------- часы и пауза ---------- */
  function startClock() { turnStart = Date.now(); warned = false; if (timerId) clearInterval(timerId); timerId = setInterval(tick, 100); tick(); }
  function stopClock() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function elapsed() { return Date.now() - turnStart; }
  var pauseStart = 0;
  function pauseGame() {
    if (!G || paused || G.over) return;
    paused = true; pauseStart = Date.now(); stopClock(); stopMic();
    $('pauseSub').textContent = 'Ходит ' + G.players[G.turn].name + ' · время остановлено';
    $('pauseOv').classList.add('on');
  }
  function unpause() {
    if (!paused) return;
    paused = false; $('pauseOv').classList.remove('on');
    turnStart += (Date.now() - pauseStart); // «съеденное» паузой время не считаем
    startClock(); focusInput();
  }
  function hidePause() { paused = false; $('pauseOv').classList.remove('on'); }
  function tick() {
    var ms = elapsed();
    $('clock').textContent = fmtSec(ms) + ' с';
    if (CFG.limit) {
      var pct = Math.min(100, ms / (CFG.limit * 1000) * 100);
      $('bar').style.width = pct + '%';
      if (pct > 75 && !warned) { warned = true; buzz('warn'); }
      if (ms >= CFG.limit * 1000) timeUp();
    } else { $('bar').style.width = '0%'; }
  }

  /* ---------- определение следующей буквы + тупик ---------- */
  function computeNext(word) {
    var nk = Rules.norm(word);
    var L = Rules.nextLetter(nk, CFG.skipJ);
    if (!L) return { letter: null, dead: false };
    if (!dictReady) return { letter: L, dead: false };
    if (Dict.hasWordsOn(L, G.usedFirstCount)) return { letter: L, dead: false };
    // тупик — идём к предпоследней рабочей букве
    var skip = CFG.skipJ ? Rules.SKIP + 'й' : Rules.SKIP;
    var passedFirst = false;
    for (var i = nk.length - 1; i >= 0; i--) {
      if (skip.indexOf(nk[i]) !== -1) continue;
      if (!passedFirst) { passedFirst = true; continue; } // пропустили саму последнюю
      if (Dict.hasWordsOn(nk[i], G.usedFirstCount)) return { letter: nk[i], dead: true };
    }
    return { letter: null, dead: true }; // совсем некуда — свободный ход
  }

  /* ---------- ход ---------- */
  function accept(res, manual) {
    var ms = elapsed() + G.turnPenalty;
    var nextL = Rules.nextLetter(res.key, CFG.skipJ);
    var bonus = (G.task && nextL === G.task.end) ? TASK_BONUS : 0;
    var ev = { type: 'word', player: G.turn, ms: ms, word: res.word, key: res.key, root: res.root,
      letter: G.required, manual: !!manual, hinted: G.hintUsedThisTurn, bonus: bonus };
    G.log.push(ev);
    syncDerived();
    var nx = computeNext(res.word);
    G.required = nx.letter; G.deadEnd = nx.dead; G.lastWord = res.word;
    G.turn = nextTurn(G.turn);
    G.streak++;
    nextTask();
    var msg = bonus ? ('🎯 Задание выполнено, +' + bonus) : (nx.dead ? Rules.MSG.dead_end : '');
    afterMove(msg, !!bonus);
    addHist(ev);
    checkOver();
  }

  function submitWord(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!G || paused) return;
    var res = Rules.checkMove($('word').value, state());
    if (!res.ok) {
      setMsg(res.message);
      G.pending = res.overridable ? res : null;
      $('overrideBtn').classList.toggle('on', !!res.overridable);
      buzz('bad');
      return;
    }
    G.pending = null; $('overrideBtn').classList.remove('on');
    buzz('ok');
    accept(res, false);
  }

  function override() {
    if (!G || paused || !G.pending) return;
    var res = G.pending;
    if (res.reason === 'unknown') { CUSTOM.add(res.key); saveCustom(); }
    // для «настоящего» хода нужен корректный root/letter
    res.root = Morph.rootKey(res.key);
    G.pending = null; $('overrideBtn').classList.remove('on');
    buzz('ok');
    accept(res, true);
  }

  function afterMove(msg, good) {
    $('word').value = ''; setMsg(msg || '', !!good); hideMask();
    G.hint = null; G.hintUsedThisTurn = false; G.turnPenalty = 0;
    render(); startClock(); saveResume(); focusInput();
    if (CFG.memory) saveMem();
  }

  function outMsg(cur, fallback) {
    return (CFG.lives && G.players[cur].out) ? (G.players[cur].name + ' выбыл') : fallback;
  }
  function pass() {
    if (!G || paused) return;
    var cur = G.turn, ms = elapsed() + G.turnPenalty;
    var ev = { type: 'pass', player: cur, ms: ms, letter: G.required };
    G.log.push(ev); syncDerived(); addHist(ev);
    G.turn = nextTurn(cur); G.streak = 0;
    afterMove(outMsg(cur, ''), false);
    checkOver();
  }
  function timeUp() {
    if (!G || paused) return;
    var cur = G.turn, ms = CFG.limit * 1000 + G.turnPenalty;
    var ev = { type: 'timeout', player: cur, ms: ms, letter: G.required };
    G.log.push(ev); syncDerived(); addHist(ev);
    G.turn = nextTurn(cur); G.streak = 0; buzz('bad');
    afterMove(outMsg(cur, 'Время вышло — ход переходит'), false);
    checkOver();
  }

  // «Сменить букву»: ответить на предпоследнюю рабочую букву (3 раза за игру).
  function swap() {
    if (!G || paused) return;
    var p = G.players[G.turn];
    if (p.swaps <= 0) { setMsg('«Сменить букву» больше нельзя'); return; }
    if (!G.required || !G.lastWord) { setMsg('Сейчас любое слово — менять нечего'); return; }
    var nk = Rules.norm(G.lastWord);
    var skip = CFG.skipJ ? Rules.SKIP + 'й' : Rules.SKIP;
    var found = [];
    for (var i = nk.length - 1; i >= 0 && found.length < 2; i--) if (skip.indexOf(nk[i]) === -1) found.push(nk[i]);
    var prevL = found[1];
    if (!prevL) { setMsg('Не на что менять'); return; }
    p.swaps--; G.required = prevL; G.deadEnd = false;
    setMsg('Буква сменена на «' + prevL.toUpperCase() + '»', true);
    render(); saveResume(); focusInput();
  }

  function checkOver() {
    if (!CFG.lives) return;
    if (G.players.length > 1 && aliveCount() <= 1) { G.over = true; finish(); }
    else if (G.players.length === 1 && G.players[0].out) { G.over = true; finish(); }
  }

  function undo() {
    if (paused) return;
    var ev = G.log.pop();
    if (!ev) return;
    // откат дообучения: слово, зачтённое вручную по «не знаю», убираем из своих
    if (ev.type === 'word' && ev.manual && CUSTOM.has(ev.key) && !(dictReady && Dict.has(ev.key))) { CUSTOM.delete(ev.key); saveCustom(); }
    if (ev.el && ev.el.parentNode) ev.el.parentNode.removeChild(ev.el);
    syncDerived();
    // восстановить букву/очередь по предыдущему слову
    var prev = null;
    for (var i = G.log.length - 1; i >= 0; i--) if (G.log[i].type === 'word') { prev = G.log[i]; break; }
    if (prev) { var nx = computeNext(prev.word); G.required = nx.letter; G.deadEnd = nx.dead; G.lastWord = prev.word; }
    else { G.required = null; G.deadEnd = false; G.lastWord = null; }
    G.streak = 0; for (var j = G.log.length - 1; j >= 0; j--) { if (G.log[j].type === 'word') G.streak++; else break; }
    G.turn = ev.player;
    nextTask();
    afterMove('', false);
  }

  /* ---------- подсказка ---------- */
  function hint() {
    if (!G || paused) return;
    if (CFG.hintLimit === 0) { setMsg('Подсказки выключены'); return; }
    var p = G.players[G.turn];
    if (p.hints >= CFG.hintLimit && !G.hintUsedThisTurn) { setMsg('Подсказки кончились'); updateHintBtn(); return; }
    if (!dictReady) { setMsg('Словарь ещё грузится'); return; }

    if (!G.hint) {
      var L = G.required;
      var w = L ? Dict.pickHint(L, G.used, { skipJ: CFG.skipJ, usedFirstCount: G.usedFirstCount }) : firstEasy();
      if (!w) { setMsg('Не могу подсказать'); return; }
      G.hint = { word: w, stage: 1 };
      G.hintUsedThisTurn = true;
      p.hints++; G.turnPenalty += HINT_PENALTY_MS;  // штраф +5 с попадёт в ms хода
      showMask(w, 1);
      updateHintBtn(); render(); saveResume();
    } else if (G.hint.stage === 1) {
      G.hint.stage = 2;
      showMask(G.hint.word, 2);
    }
  }
  function firstEasy() {
    // для свободного старта — любое несказанное частотное слово
    var half = null;
    // pickHint без буквы: пройдём тир вручную
    return Dict.pickHint('', G.used, { skipJ: CFG.skipJ, usedFirstCount: G.usedFirstCount }) || null;
  }
  function showMask(w, stage) {
    var m = $('mask');
    if (stage === 1) {
      m.innerHTML = esc(w[0].toUpperCase()) + ' ' + Array(w.length).join('_ ') +
        '<small>' + w.length + ' ' + plural(w.length, 'буква', 'буквы', 'букв') + ' · нажми ещё раз, чтобы увидеть</small>';
    } else {
      m.innerHTML = esc(cap(w)) + '<small>набери или скажи сам — ход твой</small>';
    }
    m.classList.add('on');
  }
  function hideMask() { $('mask').classList.remove('on'); $('mask').innerHTML = ''; }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; var d = n % 10; if (n > 10 && n < 20) return c; if (d > 1 && d < 5) return b; if (d === 1) return a; return c; }
  function updateHintBtn() {
    var p = G.players[G.turn], off = CFG.hintLimit === 0, over = p.hints >= CFG.hintLimit && !G.hintUsedThisTurn;
    $('hintBtn').disabled = off || over;
    $('hintBtn').textContent = over ? 'Подсказки кончились' : 'Подсказка';
  }

  /* ---------- отрисовка ---------- */
  function heartStr(p) {
    var s = '';
    for (var k = 0; k < CFG.lives; k++) s += (k < p.lives ? '❤️' : '🖤');
    return s;
  }
  function render() {
    $('scores').innerHTML = G.players.map(function (p, i) {
      var hearts = CFG.lives ? '<div class="hearts">' + heartStr(p) + '</div>' : '';
      var bonus = (CFG.tasks && p.bonus) ? '<div class="bonus">🎯 ' + p.bonus + '</div>' : '';
      return '<div class="sc' + (i === G.turn ? ' active' : '') + (p.out ? ' out' : '') + '">' +
        '<div class="n"><span class="dot" style="background:' + p.color + '"></span>' + esc(p.name) + '</div>' +
        '<div class="v">' + p.words + '</div><div class="t">' + fmtTot(p.ms) + '</div>' + hearts + bonus + '</div>';
    }).join('');
    $('turnName').textContent = G.players[G.turn].name;

    var tEl = $('task');
    if (CFG.tasks && G.task) { tEl.textContent = '🎯 Закончи на «' + G.task.end.toUpperCase() + '» — +' + TASK_BONUS; tEl.classList.add('on'); }
    else tEl.classList.remove('on');

    var sp = G.players[G.turn];
    $('swapBtn').disabled = sp.swaps <= 0 || !G.required;
    $('swapBtn').textContent = 'Сменить букву' + (sp.swaps > 0 ? ' (' + sp.swaps + ')' : '');

    var L = $('letter');
    L.classList.toggle('dead', G.deadEnd);
    if (G.required) {
      L.textContent = G.required.toUpperCase(); L.classList.remove('small');
      $('prev').textContent = G.deadEnd ? 'тупик — сменили букву' : (G.lastWord ? 'после слова «' + cap(G.lastWord) + '»' : '');
      $('word').placeholder = 'слово на ' + G.required.toUpperCase();
    } else {
      L.textContent = 'любое слово'; L.classList.add('small');
      $('prev').textContent = ''; $('word').placeholder = 'слово';
    }

    var sEl = $('series');
    if (G.streak >= 3) { sEl.textContent = '🔥 серия ' + G.streak; sEl.classList.add('on'); } else sEl.classList.remove('on');

    $('undoBtn').style.display = G.log.length ? '' : 'none';
    updateHintBtn();
    warned = false;
    var act = document.querySelector('.sc.active');
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function addHist(ev) {
    var e0 = $('hist').querySelector('.empty'); if (e0) e0.remove();
    var p = G.players[ev.player];
    var el = document.createElement('div');
    if (ev.type === 'word') {
      var w = cap(ev.word);
      el.className = 'hitem';
      el.innerHTML = '<span class="who" style="color:' + p.color + '">' + esc(p.name) + '</span>' +
        '<span class="w">' + esc(w.slice(0, -1)) + '<span class="hl">' + esc(w.slice(-1)) + '</span></span>' +
        (ev.manual ? '<span class="badge" title="зачтено вручную">⌥</span>' : '') +
        (ev.hinted ? '<span class="badge" title="с подсказкой">💡</span>' : '') +
        '<span class="ms">' + fmtSec(ev.ms) + '</span>';
    } else {
      el.className = 'hitem pass';
      el.innerHTML = '<span class="who" style="color:' + p.color + '">' + esc(p.name) + '</span>' +
        '<span class="w">' + (ev.type === 'timeout' ? 'не успел' : 'пас') + '</span>' +
        '<span class="ms">' + fmtSec(ev.ms) + '</span>';
    }
    $('hist').insertBefore(el, $('hist').firstChild);
    ev.el = el;
  }

  function setMsg(t, good) { $('msg').textContent = t || ''; $('msg').className = 'msg' + (good ? ' good' : ''); if (!t) $('overrideBtn').classList.remove('on'); }
  function focusInput() { try { $('word').focus(); } catch (e) {} }

  /* ============ ИТОГИ ============ */
  function finish() {
    stopClock(); stopMic(); hidePause();
    var totalWords = G.players.reduce(function (s, p) { return s + p.words; }, 0);
    clearResume();
    if (CFG.memory) saveMem(); saveCustom();
    if (!totalWords) { renderSetup(); show('setup'); return; } // пустой раунд — на старт (ТЗ 4.6)

    var st = Stats.compute(G.players, G.log);
    var best = st.best, maxW = st.maxWords;
    var solo = G.players.length === 1;
    // победа по выживанию: если с жизнями остался один
    var survivor = null;
    if (CFG.lives && !solo) { var alive = G.players.filter(function (p) { return !p.out; }); if (alive.length === 1) survivor = alive[0]; }
    var winnerI = survivor ? G.players.indexOf(survivor) : (best ? best.i : -1);

    if (solo) {
      $('overTitle').textContent = 'Твой результат';
      $('overSub').textContent = best ? (best.words + ' сл., в среднем ' + fmtSec(best.avg) + ' с') : '';
    } else if (survivor) {
      $('overTitle').textContent = survivor.name + ' — победа!';
      $('overSub').textContent = 'остался последним в игре';
    } else {
      $('overTitle').textContent = best.name + ' — быстрее всех!';
      $('overSub').textContent = 'в среднем ' + fmtSec(best.avg) + ' с на слово';
    }

    $('final').innerHTML = st.rank.map(function (p) {
      var win = p.i === winnerI;
      var extra = (CFG.tasks && p.bonus) ? ' · 🎯' + p.bonus : '';
      var lives = (CFG.lives) ? (G.players[p.i].out ? ' · выбыл' : '') : '';
      return '<div class="frow' + (win ? ' win' : '') + '">' +
        '<span class="dot" style="background:' + p.color + '"></span>' +
        '<span class="fn">' + esc(p.name) + (p.words === maxW && maxW > 0 && !solo ? ' 🏆' : '') + '</span>' +
        '<span class="fs"><b>' + (p.words ? fmtSec(p.avg) + ' с' : '—') + '</b>' +
        '<span>' + p.words + ' сл. · ' + fmtTot(p.ms) + extra + lives + '</span></span></div>';
    }).join('');

    renderBreakdown(st);
    $('againKeep').textContent = 'Ещё раз — помнить ' + MEM.size + ' сл.';
    show('over');
  }

  function who(i) { return G.players[i] ? G.players[i].name : ''; }
  function renderBreakdown(st) {
    var cards = [];
    function card(k, val) { cards.push('<div class="stat"><div class="k">' + k + '</div><div class="val">' + val + '</div></div>'); }
    card('Всего слов', st.totalWords);
    card('Длительность', fmtTot(st.durationMs));
    card('Средняя длина', st.avgWordLen.toFixed(1).replace('.', ',') + ' <small>букв</small>');
    if (st.longestWord) card('Самое длинное', cap(st.longestWord.word) + ' <small>' + who(st.longestWord.player) + '</small>');
    if (st.fastestWord) card('Самое быстрое', cap(st.fastestWord.word) + ' <small>' + fmtSec(st.fastestWord.ms) + ' с · ' + who(st.fastestWord.player) + '</small>');
    if (st.slowestWord) card('Дольше всех думали', cap(st.slowestWord.word) + ' <small>' + fmtSec(st.slowestWord.ms) + ' с · ' + who(st.slowestWord.player) + '</small>');
    card('Серия без пасов', st.bestStreak + ' <small>подряд</small>');
    if (st.manualCount) card('Зачтено вручную', st.manualCount);
    $('roundCards').innerHTML = cards.join('');

    // распределение по буквам
    var top = st.dist.slice(0, 8);
    var restPct = st.dist.slice(8).reduce(function (s, d) { return s + d.pct; }, 0);
    var maxPct = top.length ? top[0].pct : 1;
    var bars = top.map(function (d) {
      return '<div class="drow"><div class="dl">' + d.letter + '</div>' +
        '<div class="track"><div class="fill" style="width:' + Math.max(4, d.pct / maxPct * 100) + '%"></div></div>' +
        '<div class="dp">' + d.pct + '%</div></div>';
    });
    if (restPct > 0) bars.push('<div class="drow"><div class="dl" style="font-size:12px">·</div>' +
      '<div class="track"><div class="fill" style="width:' + Math.max(4, restPct / maxPct * 100) + '%;opacity:.5"></div></div>' +
      '<div class="dp">' + restPct + '%</div></div>');
    var extra = '';
    if (st.hardest) extra += '<div class="hint" style="margin-top:8px">😤 Злая буква: <b style="color:var(--text)">' + st.hardest.letter.toUpperCase() + '</b> — ' + Math.round(st.hardest.ratio * 100) + '% ходов в пас/таймаут</div>';
    if (st.fastestLetter) extra += '<div class="hint" style="margin-top:4px">⚡ Быстрая буква: <b style="color:var(--text)">' + st.fastestLetter.letter.toUpperCase() + '</b> — ' + fmtSec(st.fastestLetter.avg) + ' с в среднем</div>';
    $('letterDist').innerHTML = '<div class="k" style="font-size:11.5px;color:var(--muted);margin-bottom:4px">Отвечали на буквы</div>' + bars.join('') + extra;

    // по игрокам
    $('perPlayer').innerHTML = st.players.slice().sort(function (a, b) { return a.avg - b.avg; }).map(function (p) {
      var body = '';
      body += 'Слов: <b>' + p.words + '</b>, среднее <b>' + (p.words ? fmtSec(p.avg) + ' с' : '—') + '</b><br>';
      if (p.fastest) body += 'Быстрее всего: <b>' + cap(p.fastest.word) + '</b> (' + fmtSec(p.fastest.ms) + ' с)<br>';
      if (p.slowest) body += 'Дольше всего: <b>' + cap(p.slowest.word) + '</b> (' + fmtSec(p.slowest.ms) + ' с)<br>';
      if (p.longest) body += 'Самое длинное: <b>' + cap(p.longest.word) + '</b><br>';
      body += 'Пасов: <b>' + p.passes + '</b>, таймаутов: <b>' + p.timeouts + '</b>, подсказок: <b>' + p.hints + '</b>' + (p.manual ? ', вручную: <b>' + p.manual + '</b>' : '') + (p.bonus ? ', 🎯 очки: <b>' + p.bonus + '</b>' : '');
      return '<div class="pp"><div class="head"><span class="dot" style="background:' + p.color + '"></span>' +
        '<span class="fn">' + esc(p.name) + '</span><span class="mini">' + (p.words ? fmtSec(p.avg) + ' с · ' + p.words + ' сл.' : '—') + '</span><span class="arr">›</span></div>' +
        '<div class="body">' + body + '</div></div>';
    }).join('');
  }

  function shareText() {
    var st = Stats.compute(G.players, G.log);
    var lines = ['Игра в слова 🎯'];
    st.rank.forEach(function (p, i) { lines.push((i === 0 ? '🏆 ' : '') + p.name + ' — ' + (p.words ? fmtSec(p.avg) + ' с/слово, ' + p.words + ' сл.' : 'без слов')); });
    lines.push('Всего слов: ' + st.totalWords + (st.longestWord ? ', длиннее всех «' + cap(st.longestWord.word) + '»' : ''));
    return lines.join('\n');
  }
  function share() {
    var txt = shareText();
    try {
      if (tg && tg.switchInlineQuery) { tg.switchInlineQuery(txt, ['users', 'groups']); return; }
    } catch (e) {}
    try { navigator.clipboard.writeText(txt); setMsgOver('Скопировано в буфер'); }
    catch (e) { setMsgOver('Не вышло скопировать'); }
  }
  function setMsgOver(t) { var s = $('overSub'); var old = s.textContent; s.textContent = t; setTimeout(function () { s.textContent = old; }, 1500); }

  /* ============ СВОИ СЛОВА ============ */
  function renderCustom() {
    var arr = Array.from(CUSTOM);
    $('customList').innerHTML = arr.length ? arr.map(function (w) {
      return '<div class="citem"><span class="cw">' + esc(cap(w)) + '</span><button class="cd" data-cw="' + esc(w) + '">✕</button></div>';
    }).join('') : '<div class="empty">Пока пусто. Слова попадают сюда, когда ты жмёшь «Всё равно засчитать» на неизвестном слове.</div>';
  }

  /* ============ ПРОДОЛЖЕНИЕ РАУНДА ============ */
  function checkResume() {
    Storage.get('resume', function (r) {
      if (!r || !r.log || !r.words) return;
      $('resumeText').textContent = 'Продолжить прерванный раунд? ' + r.words + ' сл., ' + r.players.length + ' игр.';
      $('resumeBanner').classList.add('on');
      $('resumeYes').onclick = function () { resumeGame(r); };
      $('resumeNo').onclick = function () { clearResume(); $('resumeBanner').classList.remove('on'); };
    });
  }
  function resumeGame(r) {
    $('resumeBanner').classList.remove('on');
    if (r.cfg) {
      var c = r.cfg;
      CFG.limit = c.limit; CFG.memory = c.memory; CFG.strictRoots = c.strictRoots; CFG.skipJ = c.skipJ;
      CFG.hintLimit = c.hintLimit === null ? Infinity : c.hintLimit;
      CFG.proper = !!c.proper; CFG.anyPos = !!c.anyPos; CFG.lives = c.lives || 0; CFG.tasks = !!c.tasks; CFG.kids = !!c.kids;
    }
    (r.players || []).forEach(function (p) { if (p.hints == null) p.hints = 0; if (p.swaps == null) p.swaps = SWAPS_PER_GAME; });
    G = {
      players: r.players, turn: r.turn, required: r.required, lastWord: r.lastWord, deadEnd: false,
      memBase: new Set(r.memBase || []), used: new Set(), usedRoots: {}, usedFirstCount: {},
      log: r.log, streak: 0, turnPenalty: 0, task: null, over: false, hint: null, hintUsedThisTurn: false, pending: null
    };
    syncDerived(); nextTask();
    var nx = G.lastWord ? computeNext(G.lastWord) : { letter: G.required, dead: false };
    G.required = nx.letter; G.deadEnd = nx.dead;
    G.streak = 0; for (var j = G.log.length - 1; j >= 0; j--) { if (G.log[j].type === 'word') G.streak++; else break; }
    $('hist').innerHTML = '';
    if (!G.log.length) $('hist').innerHTML = '<div class="empty">Слова появятся здесь.</div>';
    G.log.forEach(function (e) { addHist(e); });
    setMsg(''); hideMask();
    show('game'); render(); startClock(); focusInput();
  }

  /* ============ МИКРОФОН ============ */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = null, recOn = false;
  if (!SR) { $('mic').classList.add('off'); $('mic').title = 'Голосовой ввод не поддерживается'; }
  function startMic() {
    if (!SR || recOn) return;
    try {
      rec = new SR(); rec.lang = 'ru-RU'; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
      rec.onstart = function () { recOn = true; $('mic').classList.add('rec'); setMsg('Слушаю…', true); };
      rec.onresult = function (e) {
        var t = ''; for (var i = 0; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript;
        t = (t || '').trim().replace(/[.,!?;:«»"']/g, '');
        var first = t.split(/\s+/)[0] || '';
        if (first) { $('word').value = first; submitWord(); } else setMsg('Не расслышал, повтори');
      };
      rec.onerror = function (e) {
        var m = 'Микрофон не сработал';
        if (e && e.error === 'not-allowed') m = 'Нет доступа к микрофону';
        else if (e && e.error === 'no-speech') m = 'Не расслышал, повтори';
        else if (e && e.error === 'network') m = 'Нужен доступ в интернет';
        setMsg(m);
      };
      rec.onend = function () { recOn = false; $('mic').classList.remove('rec'); };
      rec.start();
    } catch (err) { recOn = false; $('mic').classList.remove('rec'); setMsg('Микрофон недоступен'); }
  }
  function stopMic() { try { if (rec && recOn) rec.stop(); } catch (e) {} recOn = false; $('mic').classList.remove('rec'); }

  /* ============ СВЯЗЫВАНИЕ ============ */
  function bind() {
    $('plist').addEventListener('input', function (e) { var i = e.target.getAttribute('data-i'); if (i !== null) { CFG.names[+i] = e.target.value; saveCfg(); } });
    $('plist').addEventListener('click', function (e) { var d = e.target.getAttribute('data-del'); if (d !== null) { CFG.names.splice(+d, 1); renderSetup(); saveCfg(); } });
    $('addP').addEventListener('click', function () { if (CFG.names.length < 6) { CFG.names.push('Игрок ' + (CFG.names.length + 1)); renderSetup(); saveCfg(); } });
    $('limits').addEventListener('click', function (e) { var v = e.target.getAttribute('data-lim'); if (v !== null) { CFG.limit = +v; CFG.kids = false; renderSetup(); saveCfg(); } });
    $('hintLimits').addEventListener('click', function (e) { var v = e.target.getAttribute('data-hint'); if (v !== null) { CFG.hintLimit = (v === 'Infinity') ? Infinity : +v; renderSetup(); saveCfg(); } });
    $('livesChips').addEventListener('click', function (e) { var v = e.target.getAttribute('data-lives'); if (v !== null) { CFG.lives = +v; CFG.kids = false; renderSetup(); saveCfg(); } });
    $('kidsSw').addEventListener('click', function () { applyKids(!CFG.kids); renderSetup(); saveCfg(); });
    $('properSw').addEventListener('click', function () { CFG.proper = !CFG.proper; renderSetup(); saveCfg(); });
    $('posSw').addEventListener('click', function () { CFG.anyPos = !CFG.anyPos; renderSetup(); saveCfg(); });
    $('tasksSw').addEventListener('click', function () { CFG.tasks = !CFG.tasks; CFG.kids = false; renderSetup(); saveCfg(); });
    $('rootSw').addEventListener('click', function () { CFG.strictRoots = !CFG.strictRoots; renderSetup(); saveCfg(); });
    $('jSw').addEventListener('click', function () { CFG.skipJ = !CFG.skipJ; renderSetup(); saveCfg(); });
    $('memSw').addEventListener('click', function () { CFG.memory = !CFG.memory; renderSetup(); saveCfg(); });
    $('clearMem').addEventListener('click', function () { MEM.clear(); saveMem(); memInfo(); });
    $('customBtn').addEventListener('click', function () { renderCustom(); show('custom'); });
    $('customBack').addEventListener('click', function () { renderSetup(); show('setup'); });
    $('customList').addEventListener('click', function (e) { var w = e.target.getAttribute('data-cw'); if (w !== null) { CUSTOM.delete(w); saveCustom(); renderCustom(); } });

    $('startBtn').addEventListener('click', function () { newGame(); });
    $('send').addEventListener('click', submitWord);
    $('word').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); submitWord(); } });
    $('word').addEventListener('input', function () { if ($('msg').textContent && !G.pending) setMsg(''); });
    $('overrideBtn').addEventListener('click', override);
    $('passBtn').addEventListener('click', pass);
    $('hintBtn').addEventListener('click', hint);
    $('swapBtn').addEventListener('click', swap);
    $('undoBtn').addEventListener('click', undo);
    $('finishBtn').addEventListener('click', finish);
    $('pauseBtn').addEventListener('click', pauseGame);
    $('resumeBtn').addEventListener('click', unpause);
    $('pauseFinish').addEventListener('click', finish);
    $('mic').addEventListener('click', function () { if (!SR) { setMsg('Нажми 🎤 на клавиатуре телефона'); return; } if (recOn) stopMic(); else startMic(); });

    $('againKeep').addEventListener('click', function () { CFG.memory = true; saveCfg(); renderSetup(); newGame(); });
    $('againFresh').addEventListener('click', function () { CFG.memory = false; MEM.clear(); saveMem(); renderSetup(); newGame([]); });
    $('shareBtn').addEventListener('click', share);
    $('menuBtn').addEventListener('click', function () { renderSetup(); show('setup'); });

    // Сворачивание/гашение экрана: сохраняем и ставим на паузу, чтобы фоновое
    // время не «съедалось» (телефон в кармане на прогулке).
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && G && $('game').classList.contains('on')) { saveResume(); pauseGame(); }
    });
    window.addEventListener('resize', function () { if (document.querySelector('#game.on')) { var a = document.querySelector('.sc.active'); if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' }); } });
  }

  /* ============ СТАРТ ============ */
  function boot() {
    if (/[?&]debug=1/.test(location.search)) { // отладочная консоль в WebView (ТЗ §13)
      var d = document.createElement('script'); d.src = 'https://cdn.jsdelivr.net/npm/eruda';
      d.onload = function () { try { window.eruda && window.eruda.init(); } catch (e) {} };
      document.head.appendChild(d);
    }
    if (tg) { try { tg.ready(); tg.expand(); applyTheme(); tg.onEvent && tg.onEvent('themeChanged', applyTheme); } catch (e) {} }
    bind();
    $('startBtn').disabled = true;
    loadAll(function () { renderSetup(); checkResume(); });
    loadDict();
    // офлайн + мгновенное повторное открытие
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      try { navigator.serviceWorker.register('sw.js?v=' + V); } catch (e) {}
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
