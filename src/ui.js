/* ui.js — оркестрация: экраны, обработчики, ход партии, отрисовка.
 * Правила и морфология — в rules.js/morph.js (чистые). Здесь только DOM и состояние. */
(function () {
  'use strict';
  var V = '34';                         // версия для ?v= (обход кеша Телеграма)
  var HINT_PENALTY_MS = 5000;          // штраф за подсказку (ТЗ 4.5)
  var SWAPS_PER_GAME = 3;              // «сменить букву» на игрока за партию
  var TASK_BONUS = 3;                  // (устар.) прежний фикс-бонус
  var TASK_BASE = 10;                  // базовый бонус задания (× сложность)
  // Типы заданий: сложность задаёт множитель бонуса. В детском — только лёгкие (без 'end'/'rare').
  var TASK_TYPES = { end: 1.0, letter: 1.0, theme: 1.2, long: 1.5, rare: 2.0 };
  var DAILY_SECONDS = 60;              // длительность дневного пазла (таймер-атака)
  var GARDEN_MIN_VALUE = 12;           // порог ценности слова для гербария
  var GARDEN_MIN_LEN = 9;              // либо длина слова
  var GARDEN_CAP = 800;               // предел размера гербария

  var $ = function (id) { return document.getElementById(id); };
  var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

  var COLORS = ['#e8663c', '#3b8ea5', '#7a5ea8', '#4a9d5f', '#d4a017', '#c2456e'];
  var LIMITS = [{ v: 0, t: 'без лимита' }, { v: 10, t: '10 сек' }, { v: 20, t: '20 сек' }, { v: 30, t: '30 сек' }];
  var HINTS = [{ v: 0, t: 'выкл' }, { v: 3, t: '3' }, { v: Infinity, t: 'без лимита' }];
  var LIVES = [{ v: 0, t: 'выкл' }, { v: 3, t: '3 ♥' }, { v: 5, t: '5 ♥' }];

  var CFG = { names: ['Игрок 1', 'Игрок 2'], limit: 0, memory: false, strictRoots: true,
    skipJ: true, hintLimit: 3, proper: false, anyPos: false, lives: 0, kids: false, tasks: false, speak: false, advOpen: false, botLevel: 'mid', gapWin: 0 };
  var BOTLV = [{ v: 'easy', t: '🙂 Лёгкий' }, { v: 'mid', t: '😎 Средний' }, { v: 'hard', t: '😈 Сложный' }];
  var GAPS = [{ v: 0, t: 'выкл' }, { v: 150, t: '150' }, { v: 300, t: '300' }];
  var MEM = new Set();                 // копилка (нормализованные ключи)
  var CUSTOM = new Set();              // свои слова (проходят проверку всегда)
  var HISTORY = [];                    // сыгранные партии (новые сверху)
  var DAILY = { last: null, streak: 0, bestScore: 0, bestDate: null };  // серия дней + рекорд дневного пазла
  var ASTATS = { games: 0, words: 0, traps: 0, bestWordLen: 0, bestScore: 0, dailyPlays: 0, botHardWins: 0 };  // счётчики для достижений
  var ACH_DONE = new Set();            // разблокированные достижения (ключи)
  var GARDEN = new Set();              // гербарий: собранные редкие/длинные слова (ключи)
  var G = null;
  var dictReady = false, dictDegraded = false;
  var timerId = null, turnStart = 0, warned = false, paused = false, lastTurn = -1;
  var REDUCE_MOTION = false;
  try { REDUCE_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

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
    var pending = 8;
    function done() { if (--pending === 0) cb(); }
    Storage.get('cfg', function (v) { if (v && typeof v === 'object') { for (var k in CFG) if (k in v) CFG[k] = v[k]; if (CFG.hintLimit === null) CFG.hintLimit = Infinity; } done(); });
    Storage.getList('memory', function (arr) { arr.forEach(function (w) { MEM.add(w); }); done(); });
    Storage.getList('custom', function (arr) { arr.forEach(function (w) { CUSTOM.add(w); }); done(); });
    Storage.getList('history', function (arr) { HISTORY = (arr || []).filter(function (g) { return g && g.t; }); done(); });
    Storage.get('daily', function (v) { if (v && typeof v === 'object') DAILY = { last: v.last || null, streak: v.streak || 0, bestScore: v.bestScore || 0, bestDate: v.bestDate || null }; done(); });
    Storage.get('astats', function (v) { if (v && typeof v === 'object') { for (var k in ASTATS) if (k in v) ASTATS[k] = v[k]; } done(); });
    Storage.getList('achUnlocked', function (arr) { (arr || []).forEach(function (k) { ACH_DONE.add(k); }); done(); });
    Storage.getList('garden', function (arr) { (arr || []).forEach(function (w) { GARDEN.add(w); }); done(); });
  }

  /* ---------- дневной крючок (буква дня + серия дней), офлайн, детерминированно ---------- */
  var DAY_POOL = 'абвгдзиклмнопрстч';
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dayStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayStr() { return dayStr(new Date()); }
  function letterOfDay() {
    var s = todayStr(), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return DAY_POOL[h % DAY_POOL.length];
  }
  function bumpStreak() {  // вызывать при завершении непустой партии
    var t = todayStr();
    if (DAILY.last === t) return;
    var y = new Date(); y.setDate(y.getDate() - 1);
    DAILY.streak = (DAILY.last === dayStr(y)) ? (DAILY.streak || 0) + 1 : 1;
    DAILY.last = t;
    Storage.set('daily', DAILY);
  }
  function renderDaily() {
    var L = letterOfDay().toUpperCase();
    var today = todayStr();
    var playedToday = DAILY.bestDate === today && DAILY.bestScore > 0;
    var streak = DAILY.streak || 0;
    $('dailyPlate').innerHTML =
      '<span class="dl">Буква дня<b>' + L + '</b></span>' +
      '<span class="dr">' + (playedToday ? ('рекорд ' + DAILY.bestScore + ' очк. ✓') : 'таймер-атака') +
      (streak > 1 ? '<br>🔥 ' + streak + ' ' + plural(streak, 'день', 'дня', 'дней') + ' подряд' : '') + '</span>';
  }
  /* ---------- достижения (Задача 8): офлайн, из счётчиков ASTATS + серии дней ---------- */
  var ACH = [
    { key: 'first', icon: '🎬', title: 'Первая партия', desc: 'Сыграть первую игру', done: function (a) { return a.games >= 1; } },
    { key: 'w10', icon: '📏', title: 'Длинное слово', desc: 'Слово из 10+ букв', done: function (a) { return a.bestWordLen >= 10; } },
    { key: 'w13', icon: '🦖', title: 'Слово-гигант', desc: 'Слово из 13+ букв', done: function (a) { return a.bestWordLen >= 13; } },
    { key: 'traps10', icon: '🎯', title: 'Мастер ловушек', desc: 'Закончить на трудную букву 10 раз', done: function (a) { return a.traps >= 10; } },
    { key: 'score80', icon: '💯', title: 'Крепкая партия', desc: 'Набрать 80 очков за игру', done: function (a) { return a.bestScore >= 80; } },
    { key: 'words100', icon: '📚', title: 'Сто слов', desc: 'Сказать 100 слов всего', done: function (a) { return a.words >= 100; } },
    { key: 'daily5', icon: '🗓️', title: 'Постоянство', desc: 'Сыграть дневной пазл 5 раз', done: function (a) { return a.dailyPlays >= 5; } },
    { key: 'streak3', icon: '🔥', title: 'Три дня подряд', desc: 'Серия 3 дня', done: function (a, d) { return (d.streak || 0) >= 3; } },
    { key: 'streak7', icon: '🔥', title: 'Неделя подряд', desc: 'Серия 7 дней', done: function (a, d) { return (d.streak || 0) >= 7; } },
    { key: 'beatHard', icon: '🤖', title: 'Победа над Сложным', desc: 'Обыграть Сложного робота', done: function (a) { return a.botHardWins >= 1; } }
  ];
  function evalAch() { return ACH.map(function (x) { return { key: x.key, icon: x.icon, title: x.title, desc: x.desc, done: !!x.done(ASTATS, DAILY) }; }); }
  function updateAstats(st, isDaily, beatHard) {
    if (st.totalWords > 0) ASTATS.games++;
    ASTATS.words += st.totalWords;
    ASTATS.traps += st.players.reduce(function (s, p) { return s + (p.traps || 0); }, 0);
    if (st.longestWord) ASTATS.bestWordLen = Math.max(ASTATS.bestWordLen, st.longestWord.word.replace(/-/g, '').length);
    ASTATS.bestScore = Math.max(ASTATS.bestScore, st.maxScore || 0);
    if (isDaily) ASTATS.dailyPlays++;
    if (beatHard) ASTATS.botHardWins++;
    Storage.set('astats', ASTATS);
  }
  function checkNewAch() {
    var newly = [];
    evalAch().forEach(function (s) { if (s.done && !ACH_DONE.has(s.key)) { ACH_DONE.add(s.key); newly.push(s); } });
    if (newly.length) Storage.setList('achUnlocked', Array.from(ACH_DONE));
    return newly;
  }
  function renderAch() {
    $('achList').innerHTML = evalAch().map(function (s) {
      return '<div class="achrow' + (s.done ? '' : ' lock') + '"><div class="ai">' + s.icon + '</div>' +
        '<div class="ac"><b>' + esc(s.title) + '</b><span>' + esc(s.desc) + '</span></div>' +
        (s.done ? '<div class="ax">✓</div>' : '') + '</div>';
    }).join('');
  }

  /* ---------- гербарий слов (Задача 9): коллекция редких/длинных сказанных слов ---------- */
  function gardenQualifies(key) {
    if (!key || typeof Score === 'undefined') return false;
    return Score.wordValue(key) >= GARDEN_MIN_VALUE || key.replace(/-/g, '').length >= GARDEN_MIN_LEN;
  }
  function saveGarden() { Storage.setList('garden', Array.from(GARDEN)); }
  function collectGarden(key) {
    if (GARDEN.size >= GARDEN_CAP || GARDEN.has(key) || !gardenQualifies(key)) return false;
    GARDEN.add(key); saveGarden(); return true;
  }
  function renderGarden() {
    var arr = Array.from(GARDEN).sort();
    $('gardenTitle').textContent = '🌿 Собрано ' + arr.length + ' ' + plural(arr.length, 'слово', 'слова', 'слов');
    $('gardenWords').innerHTML = arr.length
      ? arr.map(function (w) { return '<span class="rw">' + esc(cap(dictReady ? Dict.display(w) : w)) + '</span>'; }).join('')
      : '<div class="empty">Пока пусто. Говори редкие и длинные слова — они появятся здесь.</div>';
  }

  function saveCfg() { var c = {}; for (var k in CFG) c[k] = (CFG[k] === Infinity ? null : CFG[k]); Storage.set('cfg', c); }
  function saveMem() { Storage.setList('memory', Array.from(MEM)); }
  function saveCustom() { Storage.setList('custom', Array.from(CUSTOM)); }
  function saveHistory() { Storage.setList('history', HISTORY.slice(0, 50)); }
  function saveResume() {
    if (!G || G.daily) return;           // дневной пазл не продолжаем (таймер-атака)
    Storage.set('resume', {
      players: G.players, turn: G.turn, required: G.required, lastWord: G.lastWord, theme: G.theme,
      log: G.log.map(function (e) { return { type: e.type, player: e.player, ms: e.ms, word: e.word, key: e.key, root: e.root, letter: e.letter, manual: e.manual, hinted: e.hinted, score: e.score, bonus: e.bonus, trap: e.trap }; }),
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
  function enableStart() { $('startBtn').disabled = false; $('kidsBtn').disabled = false; $('botBtn').disabled = false; $('dailyBtn').disabled = false; $('themeBtn').disabled = false; }
  function renderThemePick() {
    if (!dictReady) { $('themeList').innerHTML = '<div class="empty">Словарь ещё грузится…</div>'; return; }
    $('themeList').innerHTML = Dict.themeNames().map(function (n) {
      return '<button class="rowbtn" data-theme="' + esc(n) + '"><b>' + (THEME_EMOJI[n] || '•') + ' ' + esc(n) + '</b>' +
        '<span class="mini" style="color:var(--muted);font-size:13px">' + Dict.browseTheme(n).total + '</span><span class="arr">›</span></button>';
    }).join('');
  }

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
    $('gapChips').innerHTML = GAPS.map(function (l) {
      return '<button class="chip' + (CFG.gapWin === l.v ? ' on' : '') + '" data-gap="' + l.v + '">' + l.t + '</button>';
    }).join('');

    $('kidsSw').classList.toggle('on', CFG.kids);
    $('properSw').classList.toggle('on', CFG.proper);
    $('posSw').classList.toggle('on', CFG.anyPos);
    $('rootSw').classList.toggle('on', CFG.strictRoots);
    $('jSw').classList.toggle('on', CFG.skipJ);
    $('tasksSw').classList.toggle('on', CFG.tasks);
    $('speakSw').classList.toggle('on', CFG.speak);
    $('memSw').classList.toggle('on', CFG.memory);
    $('advBody').classList.toggle('on', CFG.advOpen);
    $('advToggle').classList.toggle('open', CFG.advOpen);
    memInfo();
    $('customCount').textContent = CUSTOM.size ? ('  ' + CUSTOM.size) : '';
    $('historyCount').textContent = HISTORY.length ? ('  ' + HISTORY.length) : '';
    $('achCount').textContent = '  ' + ACH_DONE.size + '/' + ACH.length;
    $('gardenCount').textContent = GARDEN.size ? ('  ' + GARDEN.size) : '';
    $('botLevels').innerHTML = BOTLV.map(function (l) {
      return '<button class="chip' + (CFG.botLevel === l.v ? ' on' : '') + '" data-botlv="' + l.v + '">' + l.t + '</button>';
    }).join('');
    renderDaily();
  }

  // Детский режим — пресет прощающих настроек (ТЗ: чтобы ребёнок разобрался).
  function applyKids(on) {
    CFG.kids = on;
    if (on) { CFG.limit = 0; CFG.hintLimit = Infinity; CFG.lives = 0; CFG.strictRoots = false; CFG.skipJ = true; CFG.anyPos = false; CFG.tasks = false; CFG.speak = true; }
    $('tasksSw').classList.toggle('on', CFG.tasks);
    $('speakSw').classList.toggle('on', CFG.speak);
  }

  /* ---------- озвучка слова (TTS) — вывод, не путать с микрофоном (ввод) ---------- */
  var TTS = (typeof window !== 'undefined') ? window.speechSynthesis : null;
  function speak(text) {
    if (!CFG.speak || !TTS || paused || !text) return;
    try {
      TTS.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU'; u.rate = 0.95;
      var voices = TTS.getVoices() || [];
      var ru = voices.filter(function (v) { return /ru/i.test(v.lang); })[0];
      if (ru) u.voice = ru;
      TTS.speak(u);
    } catch (e) {}
  }
  /* ---------- онбординг (первый запуск) ---------- */
  function showOnboard() { $('onboard').classList.add('on'); try { $('obClose').focus(); } catch (e) {} }
  function closeOnboard() { $('onboard').classList.remove('on'); Storage.set('onboarded', 1); }

  function memInfo() {
    $('memInfo').textContent = MEM.size
      ? ('в копилке ' + MEM.size + ' сл.' + (Storage.persistent ? '' : ' — до закрытия'))
      : 'пока пусто';
  }

  /* ============ ПАРТИЯ ============ */
  function newGame(memBaseArr, opts) {
    opts = opts || {};
    var base = memBaseArr || (CFG.memory ? Array.from(MEM) : []);
    if (!CFG.memory) MEM.clear();
    var players;
    if (opts.vsBot) {                    // партия против Робота: игрок + бот
      var human = (CFG.names[0] || '').trim() || 'Ты';
      players = [
        { name: human, color: COLORS[0], hints: 0, swaps: SWAPS_PER_GAME, bot: false },
        { name: 'Робот', color: COLORS[1], hints: 0, swaps: SWAPS_PER_GAME, bot: true, level: opts.vsBot }
      ];
    } else {
      var names = CFG.names.map(function (n, i) { return (n || '').trim() || ('Игрок ' + (i + 1)); });
      players = names.map(function (n, i) { return { name: n, color: COLORS[i % 6], hints: 0, swaps: SWAPS_PER_GAME, bot: false }; });
    }
    G = {
      players: players,
      turn: 0, required: null, lastWord: null, deadEnd: false, theme: opts.theme || null,
      memBase: new Set(base),
      used: new Set(), usedRoots: {}, usedFirstCount: {},
      log: [], streak: 0, turnPenalty: 0, task: null, over: false,
      hint: null, hintUsedThisTurn: false, pending: null
    };
    syncDerived();
    nextTask();
    $('hist').innerHTML = '<div class="empty">Слова появятся здесь.<br>Повторяться нельзя — телефон помнит все.</div>';
    $('word').value = ''; setMsg(''); hideMask(); hidePause();
    show('game'); render(); startClock();
    if (G.players[G.turn] && G.players[G.turn].bot) botTurn(); else focusInput();
  }

  // Дневной пазл (Задача 6): соло таймер-атака на «букву дня». Seed от даты у всех
  // одинаков -> счёт сравним. Одна общая минута на всю цепочку.
  function startDaily(opts) {
    if (!dictReady) return;
    opts = opts || {};
    var letter = opts.letter || letterOfDay();
    var human = (CFG.names[0] || '').trim() || 'Ты';
    MEM.clear();
    G = {
      players: [{ name: human, color: COLORS[0], hints: 0, swaps: 0, bot: false }],
      turn: 0, required: letter, lastWord: null, deadEnd: false,
      memBase: new Set(), used: new Set(), usedRoots: {}, usedFirstCount: {},
      log: [], streak: 0, turnPenalty: 0, task: null, over: false,
      hint: null, hintUsedThisTurn: false, pending: null,
      daily: true, dailyLetter: letter, challenge: opts.challenge || null,
      dailyDeadline: Date.now() + DAILY_SECONDS * 1000
    };
    syncDerived();
    var head = opts.challenge
      ? ('🎯 Побей ' + opts.challenge.score + ' очк. у ' + esc(opts.challenge.name) + ' на «' + letter.toUpperCase() + '»')
      : ('Набирай цепочку на «' + letter.toUpperCase() + '». Успей за ' + DAILY_SECONDS + ' сек!');
    $('hist').innerHTML = '<div class="empty">' + head + '</div>';
    $('word').value = ''; setMsg(''); hideMask(); hidePause();
    show('game'); render(); startClock(); focusInput();
  }

  /* ---------- вызов другу по ссылке (Задача 7): без сервера, seed в ссылке ---------- */
  var BOT_APP_URL = '';   // после @BotFather /newapp вписать 'https://t.me/ИМЯ_БОТА/ИМЯ_АППА' — ссылка станет нативной TG
  var RU_ALL = 'абвгдежзийклмнопрстуфхцчшщъыьэюя';
  var pendingChallenge = null;
  function b64urlEnc(s) { try { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); } catch (e) { return ''; } }
  function b64urlDec(s) { try { return decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')))); } catch (e) { return ''; } }
  function encodeChallenge(letter, score, name) {
    var li = RU_ALL.indexOf(Rules.norm(letter)); if (li < 0) li = 0;
    return 'c1_' + li + '_' + Math.max(0, score | 0) + '_' + b64urlEnc(String(name || '').slice(0, 14));
  }
  function decodeChallenge(code) {
    if (!code) return null;
    var p = String(code).split('_');
    if (p[0] !== 'c1' || p.length < 4) return null;
    var li = parseInt(p[1], 10), score = parseInt(p[2], 10);
    if (isNaN(li) || isNaN(score) || li < 0 || li >= RU_ALL.length) return null;
    return { letter: RU_ALL[li], score: score, name: b64urlDec(p[3]) || 'друг' };
  }
  function readChallengeParam() {
    var code = null;
    try { if (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) code = tg.initDataUnsafe.start_param; } catch (e) {}
    if (!code) { var m = location.search.match(/[?&](?:startapp|tgWebAppStartParam|challenge)=([^&]+)/); if (m) code = decodeURIComponent(m[1]); }
    return decodeChallenge(code);
  }
  function buildChallengeLink(code) {
    if (BOT_APP_URL) return BOT_APP_URL + '?startapp=' + code;
    return location.origin + location.pathname + '?challenge=' + code;
  }
  function showChallengeBanner(ch) {
    pendingChallenge = ch;
    $('challengeText').innerHTML = '🎯 <b>' + esc(ch.name) + '</b> зовёт побить <b>' + ch.score +
      ' очк.</b> на «' + ch.letter.toUpperCase() + '»';
    $('challengeBanner').classList.add('on');
  }
  function shareChallenge() {
    if (!G || !G.dailyLetter) return;
    var score = Stats.compute(G.players, G.log).totalScore;
    var me = (G.players[0] && G.players[0].name) || 'Игрок';
    var link = buildChallengeLink(encodeChallenge(G.dailyLetter, score, me));
    var txt = '🎯 Я набрал ' + score + ' очк. на «' + G.dailyLetter.toUpperCase() + '» за минуту в «Слова». Побей: ' + link;
    try { if (tg && tg.switchInlineQuery) { tg.switchInlineQuery(txt, ['users', 'groups']); return; } } catch (e) {}
    if (navigator.share) { navigator.share({ title: 'Слова — вызов', text: txt }).catch(function () {}); return; }
    try { navigator.clipboard.writeText(txt); setMsgOver('Ссылка-вызов скопирована'); } catch (e) { setMsgOver('Не вышло скопировать'); }
  }

  // Пересчёт производных из memBase + log (устойчиво к отмене): used/roots + счётчики
  // игроков (слова, время, пасы, таймауты, бонусы, жизни, выбывание).
  function syncDerived() {
    G.used = new Set(G.memBase);
    G.usedRoots = {}; G.usedFirstCount = {};
    G.memBase.forEach(function (k) { G.usedFirstCount[k[0]] = (G.usedFirstCount[k[0]] || 0) + 1; });
    MEM = new Set(G.memBase);
    G.players.forEach(function (p) { p.words = 0; p.ms = 0; p.passes = 0; p.timeouts = 0; p.manual = 0; p.bonus = 0; p.score = 0; p.traps = 0; p.swapsUsed = 0; p.streak = 0; p.bestStreak = 0; });
    G.log.forEach(function (e) {
      var p = G.players[e.player]; if (!p) return;
      p.ms += e.ms || 0;
      if (e.type === 'word') {
        p.words++; if (e.manual) p.manual++; if (e.bonus) p.bonus += e.bonus;
        if (e.score) p.score += e.score; if (e.trap) p.traps++;
        // персональная серия: чистое слово наращивает, подсказка сбрасывает в 0
        if (e.hinted) p.streak = 0; else { p.streak++; if (p.streak > p.bestStreak) p.bestStreak = p.streak; }
        G.used.add(e.key); MEM.add(e.key);
        if (e.root) G.usedRoots[e.root] = e.key;
        G.usedFirstCount[e.key[0]] = (G.usedFirstCount[e.key[0]] || 0) + 1;
      } else if (e.type === 'pass') { p.passes++; p.streak = 0; }
      else if (e.type === 'timeout') { p.timeouts++; p.streak = 0; }
      else if (e.type === 'swap') { p.swapsUsed++; if (e.score) p.score += e.score; p.streak = 0; }  // смена буквы сбрасывает серию
    });
    // жизни: старт минус пасы/таймауты; 0 -> выбыл. Свапы деривятся из журнала (undo-безопасно).
    G.players.forEach(function (p) {
      if (CFG.lives) { p.lives = Math.max(0, CFG.lives - p.passes - p.timeouts); p.out = p.lives === 0; }
      else { p.lives = 0; p.out = false; }
      p.swaps = Math.max(0, (G.daily ? 0 : SWAPS_PER_GAME) - p.swapsUsed);
    });
  }

  function state() {
    return {
      required: G.required, used: G.used, usedRoots: G.usedRoots,
      has: function (nk) {
        if (G.theme) return dictReady && Dict.hasTheme(G.theme, nk);   // тематический раунд — только слова темы
        return (dictReady && Dict.has(nk)) || CUSTOM.has(nk) ||
          (CFG.proper && dictReady && Dict.hasProper(nk)) ||
          (CFG.anyPos && dictReady && Dict.hasOther(nk));
      },
      hasOther: function (nk) { return dictReady && Dict.hasOther(nk); },
      isProper: function (nk) { return dictReady && Dict.hasProper(nk); },
      suggest: function (nk) { return dictReady ? Morph.suggest(nk, function (c) { return Dict.has(c) || CUSTOM.has(c); }) : null; },
      correct: function (nk) { return dictReady ? Dict.correct(nk, G.used) : null; },
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
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  var TASK_LETTERS = 'бвгдклмнпрстч';   // для «слово с буквой X» — ходовые согласные
  function taskReward(type) { return Math.round(TASK_BASE * (TASK_TYPES[type] || 1)); }
  function makeTask(type, kids) {
    if (type === 'end') {
      var pool = 'абвгдежзиклмнопрстуфхцчшэюя'.split('');
      for (var t = 0; t < 20; t++) { var L = pool[Math.floor(Math.random() * pool.length)]; if (wordsOn(L)) return { type: 'end', letter: L, reward: taskReward('end') }; }
      return null;
    }
    if (type === 'letter') { var X = TASK_LETTERS[Math.floor(Math.random() * TASK_LETTERS.length)]; return { type: 'letter', letter: X, reward: taskReward('letter') }; }
    if (type === 'theme') {
      var names = shuffle(Dict.themeNames());
      for (var i = 0; i < names.length; i++) if (Dict.themeWordsOn(names[i], G.required, G.used)) return { type: 'theme', name: names[i], reward: taskReward('theme') };
      return null;
    }
    if (type === 'long') return { type: 'long', len: kids ? (5 + Math.floor(Math.random() * 2)) : (7 + Math.floor(Math.random() * 3)), reward: taskReward('long') };
    if (type === 'rare') return { type: 'rare', rare: 0.4 + Math.random() * 0.2, reward: taskReward('rare') };
    return null;
  }
  var TASK_WEIGHT = { end: 3, letter: 3, theme: 3, long: 2, rare: 1 };  // редкие/длинные — реже
  function weightedPick(types) {
    var pool = []; types.forEach(function (t) { for (var w = 0; w < (TASK_WEIGHT[t] || 1); w++) pool.push(t); });
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function nextTask() {
    if (!CFG.tasks || !dictReady || (G && (G.daily || G.theme))) { G.task = null; return; }
    if (Math.random() < 0.15) { G.task = null; G.lastTaskType = null; return; }   // иногда ход без задания — «случайно»
    var base = CFG.kids ? ['theme', 'letter', 'long'] : ['end', 'letter', 'theme', 'long', 'rare'];
    var types = base.filter(function (t) { return t !== G.lastTaskType; });        // не повторяем тип подряд
    if (!types.length) types = base;
    var first = weightedPick(types);
    var order = [first].concat(shuffle(types.filter(function (t) { return t !== first; })));
    for (var i = 0; i < order.length; i++) {
      var tk = makeTask(order[i], CFG.kids);
      if (tk) {
        if (Math.random() < 0.12) { tk.reward *= 2; tk.jackpot = true; }           // джекпот — двойной бонус
        G.task = tk; G.lastTaskType = tk.type; return;
      }
    }
    G.task = null;
  }
  // Выполнено ли задание принятым словом (res.key; nextL — рабочая финальная буква).
  function taskDone(task, res, nextL) {
    if (!task) return false;
    if (task.type === 'end') return nextL === task.letter;
    if (task.type === 'letter') return res.key.indexOf(task.letter) >= 0;
    if (task.type === 'theme') return dictReady && Dict.hasTheme(task.name, res.key);
    if (task.type === 'long') return res.key.replace(/-/g, '').length >= task.len;
    if (task.type === 'rare') return dictReady && Dict.rarity(res.key) >= task.rare;
    return false;
  }
  // Текст задания как ВТОРИЧНОГО бонуса (не конкурирует с главной буквой — снимает путаницу).
  function taskLabel(task) {
    if (!task) return '';
    var s;
    if (task.type === 'end') s = 'закончи на «' + task.letter.toUpperCase() + '»';
    else if (task.type === 'letter') s = 'слово с буквой «' + task.letter.toUpperCase() + '»';
    else if (task.type === 'theme') s = 'назови ' + (THEME_EMOJI[task.name] || '') + ' ' + task.name;
    else if (task.type === 'long') s = 'слово от ' + task.len + ' букв';
    else if (task.type === 'rare') s = 'редкое слово';
    else return '';
    return (task.jackpot ? '🎉 ДЖЕКПОТ · ' : '🎁 бонус: ') + s + ' +' + task.reward;
  }

  /* ---------- часы и пауза ---------- */
  function startClock() { turnStart = Date.now(); warned = false; if (timerId) clearInterval(timerId); timerId = setInterval(tick, 100); tick(); }
  function stopClock() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function elapsed() { return Date.now() - turnStart; }
  var pauseStart = 0;
  function pauseGame() {
    if (!G || paused || G.over) return;
    paused = true; pauseStart = Date.now(); stopClock(); stopMic();
    if (botTimer) { clearTimeout(botTimer); botTimer = null; }
    $('pauseSub').textContent = 'Ходит ' + G.players[G.turn].name + ' · время остановлено';
    $('pauseOv').classList.add('on');
  }
  function unpause() {
    if (!paused) return;
    paused = false; $('pauseOv').classList.remove('on');
    var gap = Date.now() - pauseStart;
    turnStart += gap;                    // «съеденное» паузой время не считаем
    if (G && G.daily) G.dailyDeadline += gap;  // дневной дедлайн тоже сдвигаем
    startClock();
    if (G && G.players[G.turn] && G.players[G.turn].bot) botTurn(); else focusInput();
  }
  function hidePause() { paused = false; $('pauseOv').classList.remove('on'); }
  function tick() {
    if (G && G.daily) {                  // дневной пазл: общий обратный отсчёт
      var rem = Math.max(0, G.dailyDeadline - Date.now());
      $('clock').textContent = fmtSec(rem) + ' с';
      var total = DAILY_SECONDS * 1000;
      $('bar').style.width = Math.min(100, (1 - rem / total) * 100) + '%';
      if (rem <= 5000 && rem > 0 && !warned) { warned = true; buzz('warn'); }
      if (rem <= 0) finish();
      return;
    }
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
  // Есть ли доступные слова на букву L (в тематическом раунде — внутри темы).
  function wordsOn(L) {
    return G.theme ? Dict.themeWordsOn(G.theme, L, G.used) : Dict.hasWordsOn(L, G.usedFirstCount);
  }
  function computeNext(word) {
    var nk = Rules.norm(word);
    var L = Rules.nextLetter(nk, CFG.skipJ);
    if (!L) return { letter: null, dead: false };
    if (!dictReady) return { letter: L, dead: false };
    if (wordsOn(L)) return { letter: L, dead: false };
    // тупик — идём к предпоследней рабочей букве
    var skip = CFG.skipJ ? Rules.SKIP + 'й' : Rules.SKIP;
    var passedFirst = false;
    for (var i = nk.length - 1; i >= 0; i--) {
      if (skip.indexOf(nk[i]) !== -1) continue;
      if (!passedFirst) { passedFirst = true; continue; } // пропустили саму последнюю
      if (wordsOn(nk[i])) return { letter: nk[i], dead: true };
    }
    return { letter: null, dead: true }; // совсем некуда — свободный ход
  }

  /* ---------- ход ---------- */
  function accept(res, manual) {
    speak(res.word);                       // озвучить принятое слово (если включено)
    var ms = elapsed() + G.turnPenalty;
    var nextL = Rules.nextLetter(res.key, CFG.skipJ);
    var bonus = taskDone(G.task, res, nextL) ? G.task.reward : 0;
    var jackpot = bonus && G.task && G.task.jackpot;
    // очки за ход: база + ловушка + серия(персональная) + скорость + задание (score.js).
    // Серия для множителя — текущая личная серия игрока; ход с подсказкой множителя не даёт.
    var pl = G.players[G.turn];
    var comboStreak = G.hintUsedThisTurn ? 0 : (pl.streak || 0);
    var sc = Score.moveScore({ key: res.key, finalLetter: nextL, streak: comboStreak,
      ms: ms, taskBonus: bonus, rarity: dictReady ? Dict.rarity(res.key) : 0, kids: CFG.kids });
    var ev = { type: 'word', player: G.turn, ms: ms, word: res.word, key: res.key, root: res.root,
      letter: G.required, manual: !!manual, hinted: G.hintUsedThisTurn, bonus: bonus,
      score: sc.total, trap: sc.trap > 0 ? 1 : 0 };
    G.log.push(ev);
    if (collectGarden(res.key)) G.gardenNew = (G.gardenNew || 0) + 1;  // редкое/длинное — в гербарий
    syncDerived();
    var nx = computeNext(res.word);
    G.required = nx.letter; G.deadEnd = nx.dead; G.lastWord = res.word;
    G.turn = nextTurn(G.turn);
    nextTask();
    var emo = CFG.kids ? wordEmoji(res.key) : '';         // детская эмодзи-ассоциация
    var msg = bonus ? ((jackpot ? '🎉 ДЖЕКПОТ! +' : '🎁 Задание выполнено, +') + bonus + ' очк.')
      : (nx.dead ? (CFG.kids ? KID.dead_end() : Rules.MSG.dead_end) : (emo ? emo + ' ' + cap(res.word) + '!' : ''));
    afterMove(msg, !!bonus || (!!emo && !nx.dead));
    if (emo) kidPop(emo);
    addHist(ev);
    checkOver();
  }
  function kidPop(emo) {                                    // короткая эмодзи-вспышка (детям)
    if (REDUCE_MOTION) return;
    var el = $('kidPop'); if (!el) return;
    el.textContent = emo; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  }

  // Детская вариация сообщений (мягче/короче), маппинг reason -> текст. Дефолтные
  // взрослые строки живут в Rules.MSG; DOM в rules.js не протекает (UX-ТЗ Задача 4).
  var KID = {
    unknown: function () { return 'Хм, не нашёл такого. Попробуй другое 🙂'; },
    wrong_letter: function () { return 'Нам нужна буква «' + String(G.required || '').toUpperCase() + '»'; },
    too_short: function () { return 'Нужно слово подлиннее'; },
    repeat: function () { return 'Такое уже говорили!'; },
    wrong_pos: function () { return 'Назови предмет — что это?'; },
    wrong_form: function (res) { return 'Скажи «' + (res.suggestion || '') + '»'; },
    same_root: function (res) { return 'Очень похоже на «' + (res.suggestion || '') + '»'; },
    dead_end: function () { return 'Слов не осталось — меняем букву'; }
  };
  function moveMsg(res) { return (CFG.kids && KID[res.reason]) ? KID[res.reason](res) : res.message; }

  // Диф двух нормализованных слов (расстояние 1): индексы изменённых/вставленных букв в b.
  function diffIndices(a, b) {
    var res = {};
    if (a.length === b.length) { for (var i = 0; i < b.length; i++) if (a[i] !== b[i]) res[i] = true; }
    else if (b.length === a.length + 1) { var j = 0; while (j < a.length && a[j] === b[j]) j++; res[j] = true; }
    return res; // при удалении (b короче) подсвечивать нечего
  }
  // Дефисное написание исправления с зелёной подсветкой изменённых букв (кроме первой).
  function fixHighlight(inputNorm, correctNorm, display) {
    var hl = diffIndices(inputNorm, correctNorm), out = '', ni = 0;
    for (var i = 0; i < display.length; i++) {
      var ch = display[i];
      if (ch === '-') { out += '-'; continue; }
      out += (hl[ni] && ni > 0) ? '<span class="cg">' + esc(ch) + '</span>' : esc(ch);
      ni++;
    }
    return out;
  }
  function applyFix() {
    if (!G || paused || !G.pending || G.pending.reason !== 'typo') return;
    $('word').value = G.pending.suggestion;
    $('fixBtn').classList.remove('on');
    submitWord();
  }

  function submitWord(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!G || paused || G.over) return;
    if (G.players[G.turn] && G.players[G.turn].bot) return;   // не наш ход — думает Робот
    var res = Rules.checkMove($('word').value, state());
    if (!res.ok) {
      $('fixBtn').classList.remove('on');
      if (res.reason === 'typo') {  // похоже на опечатку — предложить исправление
        $('msg').innerHTML = 'Может, «' + fixHighlight(res.key, res.correctKey, res.suggestion) + '»?';
        $('msg').className = 'msg';
        G.pending = res;
        $('fixBtn').classList.add('on');
        $('overrideBtn').classList.add('on');
        buzz('warn');
        return;
      }
      var m = moveMsg(res);
      if (G.theme && res.reason === 'unknown' && dictReady && Dict.has(res.key)) m = 'Слово есть, но не по теме «' + G.theme + '»';
      setMsg(m);
      G.pending = res.overridable ? res : null;
      $('overrideBtn').classList.toggle('on', !!res.overridable);
      buzz(res.overridable ? 'warn' : 'bad');  // мягкий намёк, не «приговор»
      return;
    }
    G.pending = null; $('overrideBtn').classList.remove('on'); $('fixBtn').classList.remove('on');
    buzz('ok');
    accept(res, false);
  }

  function override() {
    if (!G || paused || !G.pending) return;
    var res = G.pending;
    if (res.reason === 'unknown' || res.reason === 'typo' || res.reason === 'wrong_pos') { CUSTOM.add(res.key); saveCustom(); }
    // для «настоящего» хода нужен корректный root/letter
    res.root = Morph.rootKey(res.key);
    G.pending = null; $('overrideBtn').classList.remove('on'); $('fixBtn').classList.remove('on');
    buzz('ok');
    accept(res, true);
  }

  function afterMove(msg, good) {
    $('word').value = ''; setMsg(msg || '', !!good); hideMask(); updatePreview();
    G.hint = null; G.hintUsedThisTurn = false; G.turnPenalty = 0;
    enableForm(true);
    render(); startClock(); saveResume();
    if (CFG.memory) saveMem();
    if (!G.over && G.players[G.turn] && G.players[G.turn].bot) botTurn(); else focusInput();
  }

  /* ---------- бот-оппонент (Задача 5): ход через обычный accept ---------- */
  var botTimer = null;
  function enableForm(on) {
    $('word').disabled = !on; $('send').disabled = !on;
    $('passBtn').disabled = !on; $('mic').disabled = !on; $('undoBtn').disabled = !on;
    if (!on) $('hintBtn').disabled = true;
    var f = $('form'); if (f) f.classList.toggle('botwait', !on);
  }
  function botTurn() {
    if (!G || G.over) return;
    var p = G.players[G.turn]; if (!p || !p.bot) return;
    enableForm(false); setMsg('🤖 Робот думает…');
    var hardLetter = !!(G.required && typeof Score !== 'undefined' && Score.isHard(G.required));
    var delay = Bot.thinkMs(p.level, hardLetter);
    if (CFG.limit) delay = Math.min(delay, Math.max(400, CFG.limit * 1000 - 600));
    if (botTimer) clearTimeout(botTimer);
    botTimer = setTimeout(botAct, delay);
  }
  function botAct() {
    botTimer = null;
    if (!G || G.over || paused) return;  // сворачивание обрабатывается паузой (visibilitychange)
    var p = G.players[G.turn]; if (!p || !p.bot) return;
    var chosen = null;
    if (dictReady) {
      var b = Bot.band(p.level);
      var cands = Dict.botCandidates(G.required, G.used, { skipJ: CFG.skipJ,
        usedFirstCount: G.usedFirstCount, bandFrom: b.from, bandTo: b.to, limit: 60 });
      var hardLetter = !!(G.required && Score.isHard(G.required));
      // иногда пасует по-человечески — чаще когда вариантов мало или буква трудная
      if (!(cands.length && Bot.shouldPass(p.level, cands.length, hardLetter))) {
        var target = (CFG.tasks && G.task && G.task.type === 'end') ? G.task.letter : null;  // бот идёт только на «закончи на»
        var order = [], first = Bot.choose(cands, p.level, { skipJ: CFG.skipJ, target: target });
        if (first) order.push(first);
        for (var i = 0; i < cands.length && order.length < 12; i++) if (order.indexOf(cands[i]) < 0) order.push(cands[i]);
        var st = state();
        for (var j = 0; j < order.length; j++) { var r = Rules.checkMove(order[j], st); if (r.ok) { chosen = r; break; } }
      }
    }
    if (chosen) { buzz('ok'); accept(chosen, false); }
    else { pass(); }                     // не нашёл слова или решил спасовать
  }

  function outMsg(cur, fallback) {
    return (CFG.lives && G.players[cur].out) ? (G.players[cur].name + ' выбыл') : fallback;
  }
  function pass() {
    if (!G || paused) return;
    var cur = G.turn, ms = elapsed() + G.turnPenalty;
    var ev = { type: 'pass', player: cur, ms: ms, letter: G.required };
    G.log.push(ev); syncDerived(); addHist(ev);
    G.turn = nextTurn(cur);
    afterMove(outMsg(cur, ''), false);
    checkOver();
  }
  function timeUp() {
    if (!G || paused) return;
    var cur = G.turn, ms = CFG.limit * 1000 + G.turnPenalty;
    var ev = { type: 'timeout', player: cur, ms: ms, letter: G.required };
    G.log.push(ev); syncDerived(); addHist(ev);
    G.turn = nextTurn(cur); buzz('bad');
    afterMove(outMsg(cur, 'Время вышло — ход переходит'), false);
    checkOver();
  }

  // «Сменить букву»: ответить на предпоследнюю рабочую букву (3 раза за игру).
  function swap() {
    if (!G || paused) return;
    if (G.players[G.turn] && G.players[G.turn].bot) return;   // бот не свапает
    var p = G.players[G.turn];
    if (p.swaps <= 0) { setMsg('«Сменить букву» больше нельзя'); return; }
    if (!G.required || !G.lastWord) { setMsg('Сейчас любое слово — менять нечего'); return; }
    var nk = Rules.norm(G.lastWord);
    var skip = CFG.skipJ ? Rules.SKIP + 'й' : Rules.SKIP;
    var found = [];
    for (var i = nk.length - 1; i >= 0 && found.length < 2; i--) if (skip.indexOf(nk[i]) === -1) found.push(nk[i]);
    var prevL = found[1];
    if (!prevL) { setMsg('Не на что менять'); return; }
    var cost = (CFG.kids || typeof Score === 'undefined') ? 0 : Score.SWAP_COST;  // в детском бесплатно
    var ev = { type: 'swap', player: G.turn, ms: 0, letter: prevL, score: -cost };
    G.log.push(ev); syncDerived(); addHist(ev);
    G.required = prevL; G.deadEnd = false;
    setMsg('Буква сменена на «' + prevL.toUpperCase() + '»' + (cost ? ' · −' + cost + ' очк.' : ''), true);
    render(); saveResume(); focusInput();
  }

  function checkOver() {
    if (G.over || G.daily) return;
    // победа по разрыву очков (2+ игроков): кто оторвался на gapWin — победил
    if (CFG.gapWin && G.players.length > 1) {
      var sc = G.players.map(function (p) { return p.score || 0; }).sort(function (a, b) { return b - a; });
      if (sc[0] > 0 && sc[0] - sc[1] >= CFG.gapWin) { G.over = true; finish(); return; }
    }
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
      var h;
      if (G.theme) { var tw = Dict.pickThemeHint(G.theme, L, G.used); h = tw ? { word: tw, theme: G.theme } : null; }
      else h = Dict.pickRichHint(L, G.used, { skipJ: CFG.skipJ, usedFirstCount: G.usedFirstCount, tierMax: CFG.kids ? 3 : null });
      if (!h || !h.word) { setMsg('Не могу подсказать'); return; }
      G.hint = { word: h.word, theme: h.theme || null, stage: 1 };
      G.hintUsedThisTurn = true;
      p.hints++; p.streak = 0;  // подсказка сбрасывает личную серию (множитель обнуляется)
      if (!CFG.kids) G.turnPenalty += HINT_PENALTY_MS;  // в детском — без штрафа (Задача 8)
      showRichHint(G.hint, 1);
      updateHintBtn(); render(); saveResume();
    } else if (G.hint.stage < 3) {
      G.hint.stage++;
      showRichHint(G.hint, G.hint.stage);
    }
  }
  function hintCatLabel(theme) { return theme ? ((THEME_EMOJI[theme] || '•') + ' ' + theme) : '📝 слово'; }
  // Усиленная подсказка — 3 шага: категория+длина -> первая/последняя буквы -> слово.
  function showRichHint(h, stage) {
    var m = $('mask'), w = h.word, L = w.length, cat = hintCatLabel(h.theme);
    var lenTxt = L + ' ' + plural(L, 'буква', 'буквы', 'букв');
    if (stage === 1) {
      m.innerHTML = '<b>' + esc(cat) + '</b> · ' + lenTxt + '<small>нажми ещё раз — покажу буквы</small>';
    } else if (stage === 2) {
      var parts = [];
      for (var i = 0; i < L; i++) parts.push((i === 0 || i === L - 1) ? esc(w[i].toUpperCase()) : '_');
      m.innerHTML = '<b>' + esc(cat) + '</b> · ' + lenTxt +
        '<div style="font-size:22px;letter-spacing:3px;margin-top:6px;font-weight:800">' + parts.join(' ') + '</div>' +
        '<small>нажми ещё раз — покажу слово</small>';
    } else {
      m.innerHTML = esc(cap(dictReady ? Dict.display(w) : w)) + '<small>набери или скажи сам — ход твой</small>';
    }
    m.classList.add('on');
  }
  function hideMask() { $('mask').classList.remove('on'); $('mask').innerHTML = ''; }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; var d = n % 10; if (n > 10 && n < 20) return c; if (d > 1 && d < 5) return b; if (d === 1) return a; return c; }
  function updateHintBtn() {
    var p = G.players[G.turn], off = CFG.hintLimit === 0, over = p.hints >= CFG.hintLimit && !G.hintUsedThisTurn;
    $('hintBtn').disabled = off || over;
    $('hintBtn').textContent = over ? 'Подсказки кончились' : '💡 Подсказка';
  }

  /* ---------- отрисовка ---------- */
  function heartStr(p) {
    var s = '';
    for (var k = 0; k < CFG.lives; k++) s += (k < p.lives ? '❤️' : '🖤');
    return s;
  }
  // Множитель очков от личной серии (совпадает с формулой combo в score.js).
  function streakMult(streak) { return 1 + 0.1 * Math.min(Math.max(streak || 0, 0), 10); }
  // Индикатор лидера — «перетягивание» (только для ровно 2 игроков).
  function renderLead() {
    var m = $('leadMeter'); if (!m) return;
    if (!G || G.daily || G.players.length < 2) { m.classList.remove('on'); return; }
    m.classList.add('on');
    var duo = $('leadDuo'), race = $('leadRace');
    if (G.players.length === 2) {                 // 1-на-1 — перетягивание
      duo.style.display = ''; race.style.display = 'none';
      var p0 = G.players[0], p1 = G.players[1], s0 = p0.score || 0, s1 = p1.score || 0;
      var ref = CFG.gapWin || 200;               // при выкл. разрыве — мягкий масштаб
      var lead = Math.max(-1, Math.min(1, (s0 - s1) / ref));
      $('leadCapL').style.background = p0.color;
      $('leadCapR').style.background = p1.color;
      var knob = $('leadKnob');
      knob.style.left = (50 - lead * 50) + '%';   // p0 ведёт -> маркер к его стороне
      knob.style.background = s0 === s1 ? 'var(--muted)' : (s0 > s1 ? p0.color : p1.color);
    } else {                                      // 3+ игроков — забег (фишки по очкам)
      duo.style.display = 'none'; race.style.display = '';
      var maxS = Math.max.apply(null, G.players.map(function (p) { return p.score || 0; }).concat(1));
      race.innerHTML = G.players.map(function (p) {
        var x = 6 + 86 * ((p.score || 0) / maxS);
        var ini = /^Игрок \d/.test(p.name) ? p.name.replace(/\D/g, '').slice(-1) : (p.name.trim()[0] || '?').toUpperCase();
        return '<span class="lead-runner" style="left:' + x.toFixed(1) + '%;background:' + p.color + '"' + (p.out ? ' data-out="1"' : '') + '>' + esc(ini) + '</span>';
      }).join('') + (CFG.gapWin ? '<span class="lead-flag">🏁</span>' : '');
    }
  }
  function render() {
    $('scores').innerHTML = G.players.map(function (p, i) {
      var hearts = (CFG.lives && !G.daily) ? '<div class="hearts">' + heartStr(p) + '</div>' : '';
      var bonus = (CFG.tasks && p.bonus) ? '<div class="bonus">🎯 ' + p.bonus + '</div>' : '';
      // личная серия -> множитель очков. Показываем со 2-й, ×множитель — на следующее слово.
      var strk = ((p.streak || 0) >= 2) ? '<div class="strk">🔥' + p.streak + ' ×' + streakMult(p.streak).toFixed(1) + '</div>' : '';
      return '<div class="sc' + (i === G.turn ? ' active' : '') + (p.out ? ' out' : '') + '">' +
        '<div class="n"><span class="dot" style="background:' + p.color + '"></span>' + esc(p.name) + '</div>' +
        '<div class="v">' + (p.score || 0) + '<span class="pu"> очк.</span></div>' +
        '<div class="t">' + p.words + ' слов · ' + fmtTot(p.ms) + '</div>' + hearts + bonus + strk + '</div>';
    }).join('');
    renderLead();
    var cur = G.players[G.turn];
    $('turnName').textContent = cur.name;
    $('turnName').style.color = cur.color;
    var av = $('turnAvatar');
    av.textContent = cur.bot ? '🤖' : (cur.name.trim()[0] || '?').toUpperCase();
    av.style.background = cur.color;
    if (lastTurn !== G.turn && !REDUCE_MOTION) {  // «вспышка» при смене хода
      var tr = $('turnRow'); tr.classList.remove('pop'); void tr.offsetWidth; tr.classList.add('pop');
    }
    lastTurn = G.turn;

    var tEl = $('task');
    tEl.classList.toggle('jack', !!(CFG.tasks && G.task && G.task.jackpot));
    if (CFG.tasks && G.task) { tEl.textContent = taskLabel(G.task); tEl.classList.add('on'); }
    else if (G.theme) { tEl.textContent = '🎭 Тема: ' + (THEME_EMOJI[G.theme] || '') + ' ' + G.theme; tEl.classList.add('on'); }
    else { tEl.classList.remove('on'); tEl.textContent = ''; }

    var sp = G.players[G.turn];
    $('passBtn').style.display = G.daily ? 'none' : '';
    $('swapBtn').style.display = G.daily ? 'none' : '';
    $('swapBtn').disabled = sp.swaps <= 0 || !G.required;
    var swapCost = (CFG.kids || typeof Score === 'undefined') ? 0 : Score.SWAP_COST;
    $('swapBtn').textContent = 'Сменить букву' + (sp.swaps > 0 ? ' (' + sp.swaps + ')' : '') + (swapCost && sp.swaps > 0 ? ' · −' + swapCost : '');

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

    // счётчик раундов (полных кругов), без огня
    var np = G.players.length || 1, turns = 0;
    for (var ti = 0; ti < G.log.length; ti++) if (G.log[ti].type !== 'swap') turns++;
    var sEl = $('series');
    sEl.textContent = 'раунд ' + (Math.floor(turns / np) + 1);
    sEl.classList.add('on');

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
      var emo = CFG.kids ? wordEmoji(ev.key) : '';
      el.className = 'hitem';
      el.innerHTML = '<span class="who" style="color:' + p.color + '">' + esc(p.name) + '</span>' +
        '<span class="w">' + (emo ? emo + ' ' : '') + esc(w.slice(0, -1)) + '<span class="hl">' + esc(w.slice(-1)) + '</span></span>' +
        (ev.manual ? '<span class="badge" title="зачтено вручную">⌥</span>' : '') +
        (ev.hinted ? '<span class="badge" title="с подсказкой">💡</span>' : '') +
        '<span class="ms">' + fmtSec(ev.ms) + '</span>';
    } else if (ev.type === 'swap') {
      el.className = 'hitem pass';
      el.innerHTML = '<span class="who" style="color:' + p.color + '">' + esc(p.name) + '</span>' +
        '<span class="w">🔁 сменил на «' + esc((ev.letter || '').toUpperCase()) + '»</span>' +
        '<span class="ms">' + (ev.score ? ev.score + ' очк.' : '') + '</span>';
    } else {
      el.className = 'hitem pass';
      el.innerHTML = '<span class="who" style="color:' + p.color + '">' + esc(p.name) + '</span>' +
        '<span class="w">' + (ev.type === 'timeout' ? 'не успел' : 'пас') + '</span>' +
        '<span class="ms">' + fmtSec(ev.ms) + '</span>';
    }
    $('hist').insertBefore(el, $('hist').firstChild);
    ev.el = el;
  }

  function setMsg(t, good) { $('msg').textContent = t || ''; $('msg').className = 'msg' + (good ? ' good' : ''); if (!t) { $('overrideBtn').classList.remove('on'); $('fixBtn').classList.remove('on'); } }
  function focusInput() { try { $('word').focus(); } catch (e) {} }
  // Превью очков за набираемое слово (база + ловушка). Контекстные бонусы (серия,
  // скорость, задание) не показываем — они известны только на приёме.
  function updatePreview() {
    var el = $('scorePrev'); if (!el || typeof Score === 'undefined') return;
    var v = ($('word').value || '').trim();
    if (!v || !G || paused || G.over) { el.classList.remove('on'); return; }
    var pts = Score.previewScore(v, CFG.skipJ, dictReady ? Dict.rarity(Rules.norm(v)) : 0);
    if (pts > 0) { el.textContent = '+' + pts; el.classList.add('on'); }
    else el.classList.remove('on');
  }

  /* ============ ИТОГИ ============ */
  function finish() {
    stopClock(); stopMic(); hidePause();
    if (botTimer) { clearTimeout(botTimer); botTimer = null; }
    var isDaily = !!(G && G.daily);
    var totalWords = G.players.reduce(function (s, p) { return s + p.words; }, 0);
    clearResume();
    if (CFG.memory) saveMem(); saveCustom();
    if (!totalWords && !isDaily) { renderSetup(); show('setup'); return; } // пустой раунд — на старт (ТЗ 4.6)
    if (totalWords) bumpStreak();  // засчитать день в серию (Задача 6)

    var st = Stats.compute(G.players, G.log);
    var top = st.topScorer, maxS = st.maxScore;
    var solo = G.players.length === 1;
    // рекорд дневного пазла (сброс при смене даты)
    var dailyInfo = null;
    if (isDaily) {
      var td = todayStr();
      if (DAILY.bestDate !== td) { DAILY.bestScore = 0; DAILY.bestDate = td; }
      var dscore = st.totalScore, isRec = dscore > (DAILY.bestScore || 0);
      if (isRec) { DAILY.bestScore = dscore; DAILY.bestDate = td; }
      Storage.set('daily', DAILY);
      dailyInfo = { score: dscore, isRec: isRec, best: DAILY.bestScore };
    }
    // победа по выживанию (с жизнями) приоритетнее очков; иначе — по очкам
    var survivor = null;
    if (CFG.lives && !solo) { var alive = G.players.filter(function (p) { return !p.out; }); if (alive.length === 1) survivor = alive[0]; }
    var winnerI = survivor ? G.players.indexOf(survivor) : (top ? top.i : -1);
    var winScore = winnerI >= 0 ? (st.players[winnerI].score || 0) : 0;

    if (isDaily && G.challenge) {
      var beat = dailyInfo.score > G.challenge.score;
      $('overTitle').textContent = (beat ? '🎉 Победа — ' : 'Почти! ') + dailyInfo.score + ' очк.';
      $('overSub').textContent = beat
        ? (G.challenge.name + ': ' + G.challenge.score + ' очк. — теперь твой ход!')
        : ('нужно больше ' + G.challenge.score + ' очк. — ещё разок?');
    } else if (isDaily) {
      $('overTitle').textContent = '🗓️ Дневной пазл — ' + dailyInfo.score + ' очк.';
      $('overSub').textContent = dailyInfo.isRec ? '🏅 новый рекорд дня!' : ('рекорд дня ' + dailyInfo.best + ' очк.');
    } else if (solo) {
      $('overTitle').textContent = 'Твой результат';
      $('overSub').textContent = top ? (winScore + ' очк. · ' + top.words + ' слов') : '';
    } else if (survivor) {
      $('overTitle').textContent = survivor.name + ' — победа!';
      $('overSub').textContent = 'остался последним · ' + winScore + ' очк.';
    } else {
      $('overTitle').textContent = top.name + ' — победа!';
      $('overSub').textContent = winScore + ' очк.' + (st.fastestWord ? ' · быстрее всех «' + cap(st.fastestWord.word) + '»' : '');
    }
    if (!(isDaily && G.challenge) && DAILY.streak > 1) $('overSub').textContent += ' · 🔥 ' + DAILY.streak + ' дн. подряд';

    $('final').innerHTML = st.scoreRank.map(function (p) {
      var win = p.i === winnerI;
      var extra = (CFG.tasks && p.bonus) ? ' · 🎯' + p.bonus : '';
      var traps = p.traps ? ' · 🎯ловушек ' + p.traps : '';
      var lives = (CFG.lives) ? (G.players[p.i].out ? ' · выбыл' : '') : '';
      return '<div class="frow' + (win ? ' win' : '') + '">' +
        '<span class="dot" style="background:' + p.color + '"></span>' +
        '<span class="fn">' + esc(p.name) + (p.score === maxS && maxS > 0 && !solo ? ' 🏆' : '') + '</span>' +
        '<span class="fs"><b>' + (p.score || 0) + ' очк.</b>' +
        '<span>' + p.words + ' сл. · ' + (p.words ? fmtSec(p.avg) + ' с' : '—') + traps + lives + '</span></span></div>';
    }).join('');

    renderBreakdown(st);
    if (totalWords) recordHistory(st, winnerI, solo);
    // достижения (Задача 8): обновить счётчики, показать новые разблокировки
    var hardBot = G.players.some(function (p) { return p.bot && p.level === 'hard'; });
    var beatHard = hardBot && winnerI >= 0 && G.players[winnerI] && !G.players[winnerI].bot;
    updateAstats(st, isDaily, beatHard);
    var newAch = checkNewAch();
    $('achUnlocked').innerHTML = newAch.length
      ? ('<div class="achnew">🎉 ' + (newAch.length > 1 ? 'Новые достижения: ' : 'Новое достижение: ') +
        newAch.map(function (s) { return s.icon + ' <b>' + esc(s.title) + '</b>'; }).join(', ') + '</div>')
      : '';
    if (newAch.length) buzz('ok');
    var gnew = G.gardenNew || 0;       // гербарий: сколько новых слов собрано за партию
    $('gardenAdded').innerHTML = gnew ? ('<div class="achnew" style="border-color:var(--line)">🌿 +' + gnew + ' ' + plural(gnew, 'слово', 'слова', 'слов') + ' в гербарий</div>') : '';
    $('challengeBtn').style.display = isDaily ? '' : 'none';  // вызвать друга можно из дневного/челленджа
    $('againKeep').textContent = 'Ещё раз — помнить ' + MEM.size + ' сл.';
    show('over');
  }

  // Сохранить сыгранную партию в историю (ТЗ: история игр).
  function recordHistory(st, winnerI, solo) {
    var wp = st.players[winnerI];
    var rec = {
      t: Date.now(),
      solo: solo, daily: !!(G && G.daily), lives: CFG.lives, tasks: CFG.tasks, proper: CFG.proper, anyPos: CFG.anyPos,
      totalWords: st.totalWords, totalScore: st.totalScore, durationMs: st.durationMs,
      winner: wp ? wp.name : '', winnerAvg: (wp && wp.words) ? wp.avg : null,
      winnerScore: wp ? (wp.score || 0) : 0,
      players: st.players.map(function (p) {
        return { name: p.name, color: p.color, words: p.words, avg: p.words ? p.avg : null,
          score: p.score || 0, bonus: p.bonus || 0, out: CFG.lives ? !!(G.players[p.i] && G.players[p.i].out) : false };
      }),
      top: st.longestWord ? { word: st.longestWord.word, player: who(st.longestWord.player) } : null
    };
    HISTORY.unshift(rec);
    if (HISTORY.length > 50) HISTORY.length = 50;
    saveHistory();
  }

  function who(i) { return G.players[i] ? G.players[i].name : ''; }
  function renderBreakdown(st) {
    var cards = [];
    function card(k, val) { cards.push('<div class="stat"><div class="k">' + k + '</div><div class="val">' + val + '</div></div>'); }
    card('Всего очков', st.totalScore);
    card('Всего слов', st.totalWords);
    card('Длительность', fmtTot(st.durationMs));
    card('Средняя длина', st.avgWordLen.toFixed(1).replace('.', ',') + ' <small>букв</small>');
    if (st.longestWord) card('Самое длинное', cap(st.longestWord.word) + ' <small>' + who(st.longestWord.player) + '</small>');
    if (st.fastestWord) card('Самое быстрое', cap(st.fastestWord.word) + ' <small>' + fmtSec(st.fastestWord.ms) + ' с · ' + who(st.fastestWord.player) + '</small>');
    if (st.slowestWord) card('Дольше всех думали', cap(st.slowestWord.word) + ' <small>' + fmtSec(st.slowestWord.ms) + ' с · ' + who(st.slowestWord.player) + '</small>');
    card('Серия без пасов', st.bestStreak + ' <small>подряд</small>');
    if (st.manualCount) card('Зачтено вручную', st.manualCount);
    $('roundCards').innerHTML = cards.join('');

    // распределение по буквам (топ-10 + сводка по остальным)
    var top = st.dist.slice(0, 10);
    var rest = st.dist.slice(10);
    var restPct = rest.reduce(function (s, d) { return s + d.pct; }, 0);
    var maxPct = top.length ? top[0].pct : 1;
    var bars = top.map(function (d) {
      return '<div class="drow"><div class="dl">' + d.letter + '</div>' +
        '<div class="track"><div class="fill" style="width:' + Math.max(4, d.pct / maxPct * 100) + '%"></div></div>' +
        '<div class="dp">' + d.pct + '%</div></div>';
    });
    if (restPct > 0) bars.push('<div class="hint" style="margin-top:6px">…и ещё ' + rest.length + ' ' +
      plural(rest.length, 'буква', 'буквы', 'букв') + ' — ' + restPct + '%</div>');
    var extra = '';
    if (st.hardest) extra += '<div class="hint" style="margin-top:8px">😤 Злая буква: <b style="color:var(--text)">' + st.hardest.letter.toUpperCase() + '</b> — ' + Math.round(st.hardest.ratio * 100) + '% ходов в пас/таймаут</div>';
    if (st.fastestLetter) extra += '<div class="hint" style="margin-top:4px">⚡ Быстрая буква: <b style="color:var(--text)">' + st.fastestLetter.letter.toUpperCase() + '</b> — ' + fmtSec(st.fastestLetter.avg) + ' с в среднем</div>';
    $('letterDist').innerHTML = '<div class="k" style="font-size:11.5px;color:var(--muted);margin-bottom:4px">Отвечали на буквы</div>' + bars.join('') + extra;

    // по игрокам
    $('perPlayer').innerHTML = st.players.slice().sort(function (a, b) { return a.avg - b.avg; }).map(function (p) {
      var body = '';
      body += 'Очки: <b>' + (p.score || 0) + '</b>' + (p.traps ? ' · 🎯ловушек <b>' + p.traps + '</b>' : '') + '<br>';
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
    st.scoreRank.forEach(function (p, i) { lines.push((i === 0 ? '🏆 ' : '') + p.name + ' — ' + (p.words ? (p.score || 0) + ' очк., ' + p.words + ' сл.' : 'без слов')); });
    lines.push('Всего очков: ' + st.totalScore + ' · слов: ' + st.totalWords + (st.longestWord ? ' · длиннее всех «' + cap(st.longestWord.word) + '»' : ''));
    return lines.join('\n');
  }
  function share() {  // текстовый фолбэк
    var txt = shareText();
    try {
      if (tg && tg.switchInlineQuery) { tg.switchInlineQuery(txt, ['users', 'groups']); return; }
    } catch (e) {}
    try { navigator.clipboard.writeText(txt); setMsgOver('Скопировано в буфер'); }
    catch (e) { setMsgOver('Не вышло скопировать'); }
  }

  // Картинка-цепочка: Web Share с файлом -> скачивание -> текстовый фолбэк (Задача 3).
  function shareImage() {
    if (typeof ShareCard === 'undefined' || !G) return share();
    var st = Stats.compute(G.players, G.log);
    var words = G.log.filter(function (e) { return e.type === 'word'; }).map(function (e) { return e.word; });
    var opts = { winner: $('overTitle').textContent, sub: st.totalScore + ' очк. · ' + st.totalWords + ' сл. · ' + fmtTot(st.durationMs),
      words: words, hardest: st.hardest ? st.hardest.letter : null };
    var canvas;
    try { canvas = ShareCard.draw(opts); } catch (e) { return share(); }
    if (!canvas || !canvas.toBlob) return share();
    canvas.toBlob(function (blob) {
      if (!blob) return share();
      try {
        var file = new File([blob], 'slova.png', { type: 'image/png' });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: 'Слова — тебе на А' }).catch(function () { downloadBlob(blob); });
          return;
        }
      } catch (e) {}
      downloadBlob(blob);
    }, 'image/png');
  }
  function downloadBlob(blob) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = 'slova.png';
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { URL.revokeObjectURL(url); a.remove(); } catch (e) {} }, 1500);
      setMsgOver('Картинка сохранена');
    } catch (e) { share(); }
  }
  function setMsgOver(t) { var s = $('overSub'); var old = s.textContent; s.textContent = t; setTimeout(function () { s.textContent = old; }, 1500); }

  /* ============ СВОИ СЛОВА ============ */
  function renderCustom() {
    var arr = Array.from(CUSTOM);
    $('customList').innerHTML = arr.length ? arr.map(function (w) {
      return '<div class="citem"><span class="cw">' + esc(cap(w)) + '</span><button class="cd" data-cw="' + esc(w) + '">✕</button></div>';
    }).join('') : '<div class="empty">Пока пусто. Слова попадают сюда, когда ты жмёшь «Всё равно засчитать» на неизвестном слове.</div>';
  }

  /* ============ СПРАВОЧНИК СЛОВ ============ */
  var BASE_CATS = [{ v: 'freq', t: 'Частые' }, { v: 'full', t: 'Все слова' }, { v: 'proper', t: 'Имена, города' }];
  var THEME_EMOJI = {
    'Животные': '🐘', 'Птицы': '🐦', 'Рыбы и море': '🐟', 'Насекомые': '🐛', 'Растения': '🌳',
    'Еда': '🍲', 'Фрукты и овощи': '🍎', 'Транспорт': '🚗', 'Одежда': '👕', 'Дом и мебель': '🛋',
    'Посуда': '🍽', 'Тело': '🧍', 'Профессии': '👷', 'Природа': '🌦', 'Школа и вещи': '🎒',
    'Спорт': '⚽', 'Музыка': '🎵'
  };
  // Детская эмодзи-ассоциация (Задача 11): точные для частых слов + запас по теме слова.
  var EXACT_EMOJI_RAW = {
    'мяч': '⚽', 'кот': '🐱', 'кошка': '🐱', 'котёнок': '🐱', 'собака': '🐶', 'пёс': '🐶', 'щенок': '🐶',
    'слон': '🐘', 'лев': '🦁', 'тигр': '🐯', 'лиса': '🦊', 'волк': '🐺', 'медведь': '🐻', 'заяц': '🐰',
    'мышь': '🐭', 'лягушка': '🐸', 'обезьяна': '🐵', 'свинья': '🐷', 'корова': '🐮', 'лошадь': '🐴', 'конь': '🐴',
    'овца': '🐑', 'коза': '🐐', 'ёж': '🦔', 'ёжик': '🦔', 'курица': '🐔', 'петух': '🐓', 'утка': '🦆',
    'сова': '🦉', 'орёл': '🦅', 'пингвин': '🐧', 'рыба': '🐟', 'кит': '🐳', 'дельфин': '🐬', 'акула': '🦈',
    'краб': '🦀', 'осьминог': '🐙', 'пчела': '🐝', 'бабочка': '🦋', 'муравей': '🐜', 'паук': '🕷', 'улитка': '🐌',
    'яблоко': '🍎', 'банан': '🍌', 'виноград': '🍇', 'апельсин': '🍊', 'лимон': '🍋', 'арбуз': '🍉', 'груша': '🍐',
    'клубника': '🍓', 'вишня': '🍒', 'персик': '🍑', 'ананас': '🍍', 'морковь': '🥕', 'кукуруза': '🌽', 'помидор': '🍅',
    'хлеб': '🍞', 'сыр': '🧀', 'яйцо': '🥚', 'молоко': '🥛', 'торт': '🎂', 'конфета': '🍬', 'мороженое': '🍦',
    'машина': '🚗', 'автобус': '🚌', 'поезд': '🚂', 'самолёт': '✈️', 'ракета': '🚀', 'корабль': '🚢', 'велосипед': '🚲',
    'дом': '🏠', 'дерево': '🌳', 'цветок': '🌸', 'солнце': '☀️', 'луна': '🌙', 'звезда': '⭐', 'снег': '❄️',
    'книга': '📖', 'часы': '⏰', 'телефон': '📱', 'ключ': '🔑', 'сердце': '❤️', 'огонь': '🔥', 'гриб': '🍄', 'зонт': '☂️'
  };
  var EXACT_EMOJI = {};
  Object.keys(EXACT_EMOJI_RAW).forEach(function (k) { EXACT_EMOJI[k.replace(/ё/g, 'е').replace(/\s+/g, '')] = EXACT_EMOJI_RAW[k]; });
  function wordEmoji(key) {
    if (!key) return '';
    return EXACT_EMOJI[key] || (typeof Dict !== 'undefined' && Dict.wordTheme ? (THEME_EMOJI[Dict.wordTheme(key)] || '') : '');
  }
  var refCat = 'freq', refLetter = '', refCap = 300;
  // Фильтры по классификаторам (на базе Dict.query). gender: 0=любой,1=муж,2=жен,3=сред.
  var REF_FILTERS = [
    { k: 'simple', t: '🧒 Простые' }, { k: 'anim', t: '🐾 Живые' }, { k: 'dim', t: '🐣 Уменьш.' },
    { k: 'g1', t: 'муж.' }, { k: 'g2', t: 'жен.' }, { k: 'g3', t: 'сред.' }
  ];
  var refFilter = { simple: false, anim: false, dim: false, gender: 0 };
  function refIsTheme(c) { return dictReady && Dict.themeNames().indexOf(c) >= 0; }
  function refQueryFilter() {
    var f = {};
    if (refFilter.simple) f.tierMax = 2;
    if (refFilter.anim) f.anim = 2;
    if (refFilter.dim) f.dim = 1;
    if (refFilter.gender) f.gender = refFilter.gender;
    return f;
  }
  function refHasFilter() { return refFilter.simple || refFilter.anim || refFilter.dim || !!refFilter.gender; }
  function refFilterLabel() {
    var s = [];
    if (refFilter.simple) s.push('простые'); if (refFilter.anim) s.push('живые'); if (refFilter.dim) s.push('уменьш.');
    if (refFilter.gender) s.push(['', 'муж.', 'жен.', 'сред.'][refFilter.gender]);
    return s.length ? ' · ' + s.join(', ') : '';
  }

  function renderRef() {
    if (!dictReady) { $('refWords').innerHTML = '<div class="empty">Словарь ещё грузится…</div>'; return; }
    var cats = BASE_CATS.slice();
    Dict.themeNames().forEach(function (n) { cats.push({ v: n, t: (THEME_EMOJI[n] || '•') + ' ' + n }); });
    $('refCats').innerHTML = cats.map(function (c) {
      return '<button class="chip' + (refCat === c.v ? ' on' : '') + '" data-cat="' + esc(c.v) + '">' + esc(c.t) + '</button>';
    }).join('');

    var isProper = refCat === 'proper', theme = refIsTheme(refCat);
    // фильтры доступны везде, кроме имён/городов (у них нет разметки)
    $('refFilters').style.display = isProper ? 'none' : '';
    $('refFilters').innerHTML = isProper ? '' : REF_FILTERS.map(function (fl) {
      var on = fl.k === 'g1' ? refFilter.gender === 1 : fl.k === 'g2' ? refFilter.gender === 2 :
        fl.k === 'g3' ? refFilter.gender === 3 : refFilter[fl.k];
      return '<button class="' + (on ? 'on' : '') + '" data-filt="' + fl.k + '">' + fl.t + '</button>';
    }).join('');

    var res, disp = true, hasF = refHasFilter();
    if (theme) {
      $('refLetters').style.display = 'none';
      res = Dict.query(assign({ theme: refCat }, refQueryFilter()), refCap);
      $('refCount').textContent = refCat + refFilterLabel() + ' · ' + res.total + ' ' + plural(res.total, 'слово', 'слова', 'слов') +
        (res.shown < res.total ? ' · показаны ' + res.shown : '');
    } else {
      $('refLetters').style.display = '';
      var lets = Dict.letters(refCat);
      if (lets.indexOf(refLetter) === -1) refLetter = lets[0] || 'а';
      $('refLetters').innerHTML = lets.map(function (L) {
        return '<button class="' + (L === refLetter ? 'on' : '') + '" data-let="' + L + '">' + L + '</button>';
      }).join('');
      if (isProper || !hasF) {
        res = Dict.browse(refCat, refLetter, refCap); disp = false;   // без разметки — как раньше
      } else {
        res = Dict.query(assign({ letter: refLetter }, refQueryFilter()), refCap);   // с фильтрами — из полного словаря
      }
      $('refCount').textContent = 'Буква «' + refLetter.toUpperCase() + '»' + refFilterLabel() + ' · ' + res.total + ' ' +
        plural(res.total, 'слово', 'слова', 'слов') + (res.shown < res.total ? ' · показаны ' + res.shown : '');
    }

    var html = res.words.map(function (w) {
      var key = disp ? Rules.norm(w) : w;
      var text = disp ? w : Dict.display(w);
      return '<span class="rw' + (MEM.has(key) ? ' used' : '') + '">' + esc(cap(text)) + '</span>';
    }).join('');
    if (res.shown < res.total) html += '<button class="more" id="refMore">Показать все ' + res.total + ' →</button>';
    $('refWords').innerHTML = html || '<div class="empty">Ничего не нашлось по фильтрам.</div>';
    $('refWords').parentNode.scrollTop = 0;
  }
  function assign(a, b) { for (var k in b) a[k] = b[k]; return a; }

  /* ---------- карточка слова (мини-википедия по тапу) ---------- */
  function openWordCard(word) {
    if (!word || typeof Wiki === 'undefined') return;
    var key = Rules.norm(word);
    $('wcTitle').textContent = cap(word);
    $('wcLink').style.display = 'none';
    $('wcBody').innerHTML = '<div class="wc-load">Смотрю…</div>';
    $('wordCard').classList.add('on');
    Wiki.lookup(String(word).toLowerCase(), function (res) {
      if (!$('wordCard').classList.contains('on')) return;   // закрыли, пока грузилось
      var attr = (dictReady && Dict.attrText) ? Dict.attrText(key) : '';
      var html = '';
      if (res && res.ok) {
        if (res.thumb) html += '<img src="' + esc(res.thumb) + '" alt="" onerror="this.style.display=&quot;none&quot;">';
        html += '<div>' + esc(res.text) + '</div>';
        if (res.url) { $('wcLink').href = res.url; $('wcLink').style.display = ''; }
      } else {
        var emo = (typeof wordEmoji === 'function') ? wordEmoji(key) : '';
        if (emo) html += '<div class="wc-emoji">' + emo + '</div>';
        html += '<div>' + (res && res.offline
          ? 'Нужен интернет, чтобы показать описание. Попробуй дома 🙂'
          : 'Короткого описания не нашёл — но это точно настоящее слово 🙂') + '</div>';
      }
      if (attr) html += '<div class="wc-attr">📚 ' + esc(attr) + '</div>';
      $('wcBody').innerHTML = html;
    });
  }
  function closeWordCard() { $('wordCard').classList.remove('on'); }

  /* ============ ИСТОРИЯ ИГР ============ */
  var MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  function fmtDate(t) {
    var d = new Date(t), now = new Date();
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'сегодня ' + hm;
    if (d.toDateString() === y.toDateString()) return 'вчера ' + hm;
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + hm;
  }
  function renderHistory() {
    if (!HISTORY.length) {
      $('historyList').innerHTML = '<div class="empty">Пока пусто.<br>Сыграйте партию — она появится здесь.</div>';
      return;
    }
    $('historyList').innerHTML = HISTORY.map(function (g) {
      var names = g.players.map(function (p) { return p.name; }).join(', ');
      var head = g.winner ? ('🏆 ' + g.winner + (g.winnerScore ? ' · ' + g.winnerScore + ' очк.' : (g.winnerAvg != null ? ' · ' + fmtSec(g.winnerAvg) + ' с' : ''))) : names;
      var tags = [];
      if (g.daily) tags.push('🗓️ дневной'); else if (g.solo) tags.push('соло');
      if (g.lives) tags.push(g.lives + '♥'); if (g.tasks) tags.push('задания');
      if (g.proper) tags.push('имена'); if (g.anyPos) tags.push('любые слова');
      var rows = g.players.map(function (p) {
        return '<div><span class="pdot" style="background:' + p.color + '"></span><b>' + esc(p.name) + '</b> — ' +
          (p.score != null ? '<b>' + p.score + ' очк.</b> · ' : '') +
          (p.words ? p.words + ' сл. · ' + fmtSec(p.avg) + ' с' : 'без слов') +
          (p.bonus ? ' · 🎯' + p.bonus : '') + (p.out ? ' · выбыл' : '') + '</div>';
      }).join('');
      var top = g.top ? '<div style="margin-top:4px">Длиннее всех: <b>' + esc(cap(g.top.word)) + '</b> · ' + esc(g.top.player) + '</div>' : '';
      var tagHtml = tags.length ? '<div style="margin-bottom:4px">' + tags.map(function (t) { return '<span class="gtag">' + t + '</span>'; }).join('') + '</div>' : '';
      return '<div class="gitem"><div class="gh">' +
        '<span class="gd">' + fmtDate(g.t) + '</span>' +
        '<span class="gw">' + esc(head) + '</span>' +
        '<span class="gm">' + g.totalWords + ' сл.</span><span class="arr">›</span></div>' +
        '<div class="gb">' + tagHtml + rows + top + '</div></div>';
    }).join('');
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
      players: r.players, turn: r.turn, required: r.required, lastWord: r.lastWord, deadEnd: false, theme: r.theme || null,
      memBase: new Set(r.memBase || []), used: new Set(), usedRoots: {}, usedFirstCount: {},
      log: r.log, streak: 0, turnPenalty: 0, task: null, over: false, hint: null, hintUsedThisTurn: false, pending: null
    };
    syncDerived(); nextTask();
    var nx = G.lastWord ? computeNext(G.lastWord) : { letter: G.required, dead: false };
    G.required = nx.letter; G.deadEnd = nx.dead;
    $('hist').innerHTML = '';
    if (!G.log.length) $('hist').innerHTML = '<div class="empty">Слова появятся здесь.</div>';
    G.log.forEach(function (e) { addHist(e); });
    setMsg(''); hideMask();
    show('game'); render(); startClock();
    if (G.players[G.turn] && G.players[G.turn].bot) botTurn(); else focusInput();
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
    $('gapChips').addEventListener('click', function (e) { var v = e.target.getAttribute('data-gap'); if (v !== null) { CFG.gapWin = +v; renderSetup(); saveCfg(); } });
    $('kidsSw').addEventListener('click', function () { applyKids(!CFG.kids); renderSetup(); saveCfg(); });
    $('properSw').addEventListener('click', function () { CFG.proper = !CFG.proper; renderSetup(); saveCfg(); });
    $('posSw').addEventListener('click', function () { CFG.anyPos = !CFG.anyPos; renderSetup(); saveCfg(); });
    $('tasksSw').addEventListener('click', function () { CFG.tasks = !CFG.tasks; CFG.kids = false; renderSetup(); saveCfg(); });
    $('speakSw').addEventListener('click', function () { CFG.speak = !CFG.speak; renderSetup(); saveCfg(); });
    $('rootSw').addEventListener('click', function () { CFG.strictRoots = !CFG.strictRoots; renderSetup(); saveCfg(); });
    $('jSw').addEventListener('click', function () { CFG.skipJ = !CFG.skipJ; renderSetup(); saveCfg(); });
    $('memSw').addEventListener('click', function () { CFG.memory = !CFG.memory; renderSetup(); saveCfg(); });
    $('clearMem').addEventListener('click', function () { MEM.clear(); saveMem(); memInfo(); });
    $('customBtn').addEventListener('click', function () { renderCustom(); show('custom'); });
    $('customBack').addEventListener('click', function () { renderSetup(); show('setup'); });
    $('customList').addEventListener('click', function (e) { var w = e.target.getAttribute('data-cw'); if (w !== null) { CUSTOM.delete(w); saveCustom(); renderCustom(); } });
    $('historyBtn').addEventListener('click', function () { renderHistory(); show('history'); });
    $('historyBack').addEventListener('click', function () { renderSetup(); show('setup'); });
    $('achBtn').addEventListener('click', function () { renderAch(); show('ach'); });
    $('achBack').addEventListener('click', function () { renderSetup(); show('setup'); });
    $('gardenBtn').addEventListener('click', function () { renderGarden(); show('garden'); });
    $('gardenBack').addEventListener('click', function () { renderSetup(); show('setup'); });
    $('rulesBtn').addEventListener('click', function () { show('rules'); });
    $('rulesBack').addEventListener('click', function () { show('setup'); });
    $('pauseMenu').addEventListener('click', function () {   // в главное меню, партия сохраняется для продолжения
      saveResume(); paused = false; $('pauseOv').classList.remove('on'); stopClock();
      if (botTimer) { clearTimeout(botTimer); botTimer = null; }
      renderSetup(); show('setup'); checkResume();
    });
    $('refBtn').addEventListener('click', function () { renderRef(); show('ref'); });
    $('refBack').addEventListener('click', function () { renderSetup(); show('setup'); });
    $('refCats').addEventListener('click', function (e) { var c = e.target.getAttribute('data-cat'); if (c) { refCat = c; refCap = 300; refLetter = ''; renderRef(); } });
    $('refFilters').addEventListener('click', function (e) {
      var k = e.target.getAttribute('data-filt'); if (!k) return;
      if (k === 'g1' || k === 'g2' || k === 'g3') { var g = +k[1]; refFilter.gender = (refFilter.gender === g ? 0 : g); }
      else refFilter[k] = !refFilter[k];
      refCap = 300; renderRef();
    });
    $('refLetters').addEventListener('click', function (e) { var L = e.target.getAttribute('data-let'); if (L) { refLetter = L; refCap = 300; renderRef(); } });
    $('refWords').addEventListener('click', function (e) {
      if (e.target.id === 'refMore') { refCap = 1e9; renderRef(); return; }
      var rw = e.target.closest ? e.target.closest('.rw') : null;
      if (rw) openWordCard(rw.textContent);
    });
    $('wcClose').addEventListener('click', closeWordCard);
    $('wordCard').addEventListener('click', function (e) { if (e.target.id === 'wordCard') closeWordCard(); });
    $('hist').addEventListener('click', function (e) {   // тап по сыгранному слову в истории ходов
      var w = e.target.closest ? e.target.closest('.w') : null;
      if (w && !w.parentNode.classList.contains('pass')) openWordCard(w.textContent);
    });
    $('clearHistory').addEventListener('click', function () { HISTORY = []; saveHistory(); renderHistory(); });
    $('historyList').addEventListener('click', function (e) { var it = e.target.closest ? e.target.closest('.gitem') : null; if (it) it.classList.toggle('open'); });

    $('obClose').addEventListener('click', closeOnboard);
    $('howToBtn').addEventListener('click', showOnboard);
    $('advToggle').addEventListener('click', function () { CFG.advOpen = !CFG.advOpen; renderSetup(); saveCfg(); });
    $('startBtn').addEventListener('click', function () { newGame(); });
    $('kidsBtn').addEventListener('click', function () { applyKids(true); renderSetup(); saveCfg(); newGame(); });
    $('botBtn').addEventListener('click', function () { newGame(null, { vsBot: CFG.botLevel }); });
    $('dailyBtn').addEventListener('click', function () { startDaily(); });
    $('challengeYes').addEventListener('click', function () { if (pendingChallenge) { $('challengeBanner').classList.remove('on'); startDaily({ letter: pendingChallenge.letter, challenge: pendingChallenge }); } });
    $('challengeNo').addEventListener('click', function () { $('challengeBanner').classList.remove('on'); });
    $('challengeBtn').addEventListener('click', shareChallenge);
    $('botLevels').addEventListener('click', function (e) { var v = e.target.getAttribute('data-botlv'); if (v) { CFG.botLevel = v; renderSetup(); saveCfg(); } });
    $('themeBtn').addEventListener('click', function () { renderThemePick(); show('themePick'); });
    $('themeBack').addEventListener('click', function () { renderSetup(); show('setup'); });
    $('themeList').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-theme]') : null;
      var name = b && b.getAttribute('data-theme');
      if (name) newGame(null, { theme: name });
    });
    $('send').addEventListener('click', submitWord);
    $('word').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); submitWord(); } });
    $('word').addEventListener('input', function () { if ($('msg').textContent) { setMsg(''); if (G) G.pending = null; } updatePreview(); });
    $('overrideBtn').addEventListener('click', override);
    $('fixBtn').addEventListener('click', applyFix);
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
    $('shareBtn').addEventListener('click', shareImage);
    $('menuBtn').addEventListener('click', function () { renderSetup(); show('setup'); });

    // Сворачивание/гашение экрана: сохраняем и ставим на паузу, чтобы фоновое
    // время не «съедалось» (телефон в кармане на прогулке).
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { try { if (TTS) TTS.cancel(); } catch (e) {} }
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
    $('startBtn').disabled = true; $('kidsBtn').disabled = true; $('botBtn').disabled = true; $('dailyBtn').disabled = true; $('themeBtn').disabled = true;
    loadAll(function () {
      renderSetup(); checkResume();
      var ch = readChallengeParam();          // вызов по ссылке (Задача 7)
      if (ch) showChallengeBanner(ch);
      Storage.get('onboarded', function (v) { if (!v && !ch) showOnboard(); });  // первый запуск (Задача 1)
    });
    loadDict();
    // офлайн + мгновенное повторное открытие
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      try { navigator.serviceWorker.register('sw.js?v=' + V); } catch (e) {}
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
