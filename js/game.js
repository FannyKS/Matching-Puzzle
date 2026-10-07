/* ============================================================
   game.js — Photo Detective

   Flow: a photo is sliced into 30 cards, all face down. Every new
   card the player turns over costs points. Players call the photo
   out loud; the host presses "Game complete". From there the run
   moves on to the next photo in the deck by default, and the host
   can replay the same photo or pick another one instead.

   Every photo comes from the "Photo library" folder the host points
   the game at -- there are no built-in scenes to fall back on. The
   library is rescannable, so adding, renaming and moving files works
   mid-session.
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     Config
     ============================================================ */

  var COLS = 6, ROWS = 5;          // 6 x 5 = 30 cards

  var DIFFICULTIES = {
    casual:   { key: 'casual',   label: 'Casual',   time: 0,   guesses: 5, mult: 1 },
    standard: { key: 'standard', label: 'Standard', time: 240, guesses: 3, mult: 1 },
    hard:     { key: 'hard',     label: 'Hard',     time: 150, guesses: 2, mult: 2 }
  };

  var SCORE = {
    base:     1000,   // identification bonus
    perPiece:   12,   // cost of turning one new card
    perSecond:   3,   // cost per second spent on a photo
    perWrong:  100,   // cost per wrong guess
    reveal:    150,   // intel: turn one card over for them
    choices:   200,   // intel: narrow to 3 options
    streak:    250,   // bonus per consecutive correct round
    floor:      50    // a round never banks less than this
  };

  var NEIGHBOUR_LABELS = { up: 'above', down: 'below', left: 'left', right: 'right' };

  // Easy mode plays the same photo but keeps it assembled: every piece sits in
  // its true place, and the players reveal pieces instead of flipping cards.
  // Revealing more than EASY_REVEAL_LIMIT would make the round trivially free,
  // so after that the board just asks them to name it.
  var EASY_REVEAL_LIMIT = 12;

  /* ============================================================
     State
     ============================================================ */

  var state = {
    phase: 'menu',            // menu | playing | reveal | over
    diff: DIFFICULTIES.standard,
    mode: 'advance',          // advance (scrambled cards) | easy (photo whole)

    deck: [],                 // photo entries, see defaultDeck()
    index: 0,
    current: null,            // drawn photo def for the live round
    entry: null,              // deck entry for the live round
    puzzle: null,
    portrait: '',             // small dataURL of the current photo

    score: 0,                 // banked points from completed rounds
    pending: 0,               // costs incurred in the current round
    found: 0,
    inspected: 0,
    streak: 0,
    bestStreak: 0,

    wrong: 0,                 // wrong guesses on this photo
    seen: {},                 // pieceId -> true once turned over
    freeSeen: {},             // pieceId -> true if exposed by intel
    selected: null,

    usedCategory: false,
    usedChoices: false,
    intelCost: 0,
    choiceMode: false,

    roundStart: 0,
    roundRecorded: false,
    loadToken: 0,
    note: '',                 // a transient message for the library hint line
    noteBad: false,

    timeLeft: 0,
    deadline: 0,
    timerId: null,
    pausedLeft: 0,

    sound: true,
    reason: null,
    result: null,
    history: [],              // completed rounds, in the order they finished
    revealTerminal: false,

    editingId: null
  };

  /* ============================================================
     DOM
     ============================================================ */

  function $(id) { return document.getElementById(id); }

  var el = {
    layout: $('layout'),
    board: $('board'),
    panelSub: $('panelSub'),
    panelTitle: $('panelTitle'),
    legendSeen: $('legendSeen'),
    legendSelectedWrap: $('legendSelectedWrap'),
    boardHint: $('boardHint'),
    inspectorCard: $('inspectorCard'),
    intelCard: $('intelCard'),

    statScore: $('statScore'),
    statFound: $('statFound'),
    statPieces: $('statPieces'),
    statPiecesLabel: $('statPiecesLabel'),
    statTime: $('statTime'),
    statTimerBox: $('statTimerBox'),
    statStrikes: $('statStrikes'),

    btnLibrary: $('btnLibrary'),
    libBadge: $('libBadge'),
    btnSound: $('btnSound'),
    soundIcon: $('soundIcon'),
    btnHelp: $('btnHelp'),

    pieceCostLabel: $('pieceCostLabel'),
    pieceCostUnit: $('pieceCostUnit'),

    stageEmpty: $('stageEmpty'),
    cross: $('cross'),
    tagPos: $('tagPos'),
    tagCost: $('tagCost'),
    chkContext: $('chkContext'),

    answerInput: $('answerInput'),
    btnMic: $('btnMic'),
    micNote: $('micNote'),
    btnComplete: $('btnComplete'),
    btnWrong: $('btnWrong'),
    choices: $('choices'),
    feedback: $('feedback'),

    toolCategory: $('toolCategory'),
    toolReveal: $('toolReveal'),
    toolChoices: $('toolChoices'),
    toolSurrender: $('toolSurrender'),
    costReveal: $('costReveal'),
    costChoices: $('costChoices'),

    overlayStart: $('overlayStart'),
    overlayReveal: $('overlayReveal'),
    overlayHelp: $('overlayHelp'),
    overlayOver: $('overlayOver'),
    overlayUpload: $('overlayUpload'),
    overlayLibrary: $('overlayLibrary'),
    overlayEdit: $('overlayEdit'),

    diffPicker: $('diffPicker'),
    modePicker: $('modePicker'),
    revealModePicker: $('revealModePicker'),
    revealModeField: $('revealModeField'),
    btnStart: $('btnStart'),
    btnStartRescan: $('btnStartRescan'),
    btnStartUpload: $('btnStartUpload'),

    libCount: $('libCount'),
    btnLibRescan: $('btnLibRescan'),
    btnLibFolder: $('btnLibFolder'),
    libSearch: $('libSearch'),
    libDrop: $('libDrop'),
    libGrid: $('libGrid'),
    libEmpty: $('libEmpty'),
    libHint: $('libHint'),
    btnLibClose: $('btnLibClose'),
    btnLibFinish: $('btnLibFinish'),

    editHeading: $('editHeading'),
    editPreview: $('editPreview'),
    editPath: $('editPath'),
    editName: $('editName'),
    editAliases: $('editAliases'),
    btnEditCancel: $('btnEditCancel'),
    btnEditSave: $('btnEditSave'),

    revealEyebrow: $('revealEyebrow'),
    revealTitle: $('revealTitle'),
    revealImg: $('revealImg'),
    scorecard: $('scorecard'),
    btnNext: $('btnNext'),
    btnReplay: $('btnReplay'),
    btnPick: $('btnPick'),

    btnCloseHelp: $('btnCloseHelp'),

    overEyebrow: $('overEyebrow'),
    overTitle: $('overTitle'),
    overBlurb: $('overBlurb'),
    finalScore: $('finalScore'),
    overTally: $('overTally'),
    overPhotos: $('overPhotos'),
    btnAgain: $('btnAgain'),
    btnMenu: $('btnMenu'),

    drop: $('drop'),
    fileInput: $('fileInput'),
    dropText: $('dropText'),
    answerField: $('answerField'),
    titleInput: $('titleInput'),
    btnUploadGo: $('btnUploadGo'),
    btnUploadCancel: $('btnUploadCancel'),

    live: $('live')
  };

  /* ============================================================
     Small utilities
     ============================================================ */

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function show(node, on) {
    if (!node) return;
    if (on) node.removeAttribute('hidden'); else node.setAttribute('hidden', '');
  }

  function say(msg) { if (el.live) el.live.textContent = msg; }

  function money(n) {
    var v = Math.round(Math.abs(n)).toLocaleString();
    return (n >= 0 ? '+' : '−') + v;
  }

  function clock(seconds) {
    var s = Math.max(0, Math.ceil(seconds));
    return ((s / 60) | 0) + ':' + String(s % 60).padStart(2, '0');
  }

  /** Intel and card prices scale with difficulty. */
  function cost(kind) {
    return Math.round(SCORE[kind] * state.diff.mult);
  }

  function setFeedback(msg, kind) {
    el.feedback.textContent = msg;
    el.feedback.className = 'feedback' + (kind ? ' is-' + kind : '');
  }

  function lib() {
    return window.PhotoLibrary || null;
  }

  /* Scoring model: state.score is banked points from finished rounds only.
     Costs incurred during the current round accumulate in state.pending and
     are shown as deducted live. At the end of a round everything is folded
     into one ledger exactly once, so nothing is charged twice. */
  function charge(amount) {
    state.pending += amount;
  }

  /**
   * Banked points minus what this round has spent. Deliberately allowed to go
   * negative: on round one the player has no banked points yet, and hiding the
   * cost there would make the opening moves look free.
   */
  function liveScore() {
    return state.score - state.pending;
  }

  /* ============================================================
     Sound — tiny WebAudio blips, no asset files
     ============================================================ */

  var audio = { ctx: null };

  function tone(freqs, dur, type, gainPeak) {
    if (!state.sound) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio.ctx) audio.ctx = new AC();
      if (audio.ctx.state === 'suspended') audio.ctx.resume();

      var ctx = audio.ctx;
      var now = ctx.currentTime;
      var gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(gainPeak || 0.06, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      gain.connect(ctx.destination);

      freqs.forEach(function (f, i) {
        var osc = ctx.createOscillator();
        osc.type = type || 'sine';
        osc.frequency.value = f;
        osc.connect(gain);
        osc.start(now + i * dur * 0.14);
        osc.stop(now + dur);
      });
    } catch (e) { /* audio is a nicety, never fatal */ }
  }

  var sfx = {
    click:   function () { tone([520], 0.045, 'sine', 0.025); },
    flip:    function () { tone([300, 480], 0.07, 'triangle', 0.03); },
    reuse:   function () { tone([380], 0.05, 'sine', 0.02); },
    cost:    function () { tone([300, 210], 0.09, 'sawtooth', 0.02); },
    wrong:   function () { tone([196, 165], 0.24, 'square', 0.04); },
    right:   function () { tone([523.25, 659.25, 783.99, 1046.5], 0.5, 'sine', 0.07); },
    hint:    function () { tone([880, 1174.7], 0.16, 'sine', 0.04); },
    over:    function () { tone([392, 329.6, 261.6], 0.7, 'sine', 0.055); }
  };

  /* ============================================================
     Answer matching
     ============================================================ */

  function normalise(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function words(s) { return normalise(s).split(' ').filter(Boolean); }

  /** Whole-word containment, so "a sunset" contains "sunset". */
  function containsWordSeq(haystack, needle) {
    var i = haystack.indexOf(needle);
    if (i === -1) return false;
    var startOk = i === 0 || haystack.charAt(i - 1) === ' ';
    var end = i + needle.length;
    var endOk = end === haystack.length || haystack.charAt(end) === ' ';
    return startOk && endOk;
  }

  /**
   * Deliberately forgiving: filler words are ignored, and a partial answer
   * ("sunset") counts as long as it is a real word of the intended answer.
   * The host has the final say via "Game complete" regardless.
   */
  function isCorrect(input, aliases) {
    var got = normalise(input);
    if (got.length < 2) return false;

    for (var i = 0; i < aliases.length; i++) {
      var want = normalise(aliases[i]);
      if (!want) continue;
      if (got === want) return true;
      if (containsWordSeq(got, want)) return true;              // "a sunset over the sea"
      if (got.length >= 4 && containsWordSeq(want, got)) return true;  // "sunset"
    }
    return false;
  }

  /** Did the player land in the right neighbourhood? Drives the nudge. */
  function nearMiss(value) {
    var got = words(value).filter(function (w) { return w.length >= 4; });
    if (!got.length) return false;
    var aliases = state.current.answers;
    for (var i = 0; i < got.length; i++) {
      for (var a = 0; a < aliases.length; a++) {
        if (words(aliases[a]).indexOf(got[i]) !== -1) return true;
      }
    }
    return false;
  }

  /**
   * Decoy titles for the "narrow it down" intel, drawn from the live
   * deck. A library of one or two photos simply offers fewer wrong
   * answers; inventing titles the host never put in the folder would
   * give the game away.
   */
  function decoysFor(photo, n) {
    var pool = [];
    state.deck.forEach(function (entry) {
      if (entry.id !== photo.id && pool.indexOf(entry.title) === -1) pool.push(entry.title);
    });
    return shuffle(pool).slice(0, n);
  }

  /* ============================================================
     Decks

     A deck entry is deliberately cheap to hold — it carries enough to
     show in the picker, and a load() that decodes the photo only when
     its round actually starts. That keeps a library of hundreds of
     photos from decoding hundreds of images up front.
     ============================================================ */

  function libraryEntries() {
    var l = lib();
    return l ? l.present() : [];
  }

  /** The library folder is the only source of photos there is. */
  function defaultDeck() {
    return libraryEntries();
  }

  /** Index of an entry in the deck by id, or -1. */
  function indexOfId(id) {
    for (var i = 0; i < state.deck.length; i++) if (state.deck[i].id === id) return i;
    return -1;
  }

  /* ============================================================
     Board

     Each card is a <button> holding a 3D flipper: a back face that is
     drawn for every card identically, and a front face holding that
     card's slice of the photo. The slice is only painted once the card
     has been turned, so nothing of the photo leaks onto a face-down card.
     ============================================================ */

  function buildCard(piece, slot) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'piece';
    btn.dataset.piece = String(piece.id);
    btn.dataset.slot = String(slot);
    btn.style.animationDelay = Math.min(slot * 12, 300) + 'ms';
    btn.setAttribute('aria-pressed', 'false');
    if (state.mode === 'easy') {
      btn.setAttribute('aria-label',
        'Piece ' + (slot + 1) + ' in row ' + (piece.row + 1) + ', column ' + (piece.col + 1) + ', face down. Click to reveal it.');
    } else {
      btn.setAttribute('aria-label',
        'Card ' + (slot + 1) + ', face down. Its true position is row ' + (piece.row + 1) + ', column ' + (piece.col + 1));
    }

    // A number every player can see and name, so "turn number 14" always means
    // the same card. It sits above the flip, visible on both faces.
    var num = document.createElement('span');
    num.className = 'piece-num';
    num.textContent = String(slot + 1);
    num.setAttribute('aria-hidden', 'true');
    btn.appendChild(num);

    var inner = document.createElement('span');
    inner.className = 'piece-inner';

    var back = document.createElement('span');
    back.className = 'piece-face piece-back';
    back.setAttribute('aria-hidden', 'true');

    var front = document.createElement('span');
    front.className = 'piece-face piece-front';
    front.appendChild(document.createElement('canvas'));

    inner.appendChild(back);
    inner.appendChild(front);
    btn.appendChild(inner);

    btn.addEventListener('click', onPieceClick);
    return btn;
  }

  function renderBoard() {
    var puzzle = state.puzzle;
    el.board.textContent = '';
    // Cells then take the photo's own shape, so cards never look squashed.
    el.board.style.setProperty('--board-ar', String(puzzle.photoAspect));

    var frag = document.createDocumentFragment();
    puzzle.pieces.forEach(function (piece, slot) { frag.appendChild(buildCard(piece, slot)); });
    el.board.appendChild(frag);
  }

  function pieceButton(id) {
    return el.board.querySelector('.piece[data-piece="' + id + '"]');
  }

  function pieceCanvas(btn) {
    return btn.querySelector('.piece-front canvas');
  }

  function paintCard(btn, piece) {
    var cv = pieceCanvas(btn);
    if (!cv || !piece || !state.puzzle) return;
    // offsetWidth/Height are the untransformed layout box. getBoundingClientRect
    // would include the hover/select scale, backing the canvas at the wrong
    // size and leaving it blurry.
    var w = btn.offsetWidth, h = btn.offsetHeight;
    if (!w || !h) return;
    state.puzzle.paint(cv, piece, w, h, 'cover');
  }

  /** Resize the face-up card canvases to their real cells. */
  function repaintCards() {
    if (!state.puzzle) return;
    var cells = el.board.querySelectorAll('.piece');
    for (var i = 0; i < cells.length; i++) {
      var btn = cells[i];
      if (!btn.classList.contains('is-flipped')) continue;   // face-down cards stay blank
      paintCard(btn, state.puzzle.get(parseInt(btn.dataset.piece, 10)));
    }
    if (state.selected) renderInspector(state.selected);
  }

  var resizeRaf = null;
  window.addEventListener('resize', function () {
    if (state.phase === 'menu') return;
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = null;
      repaintCards();
    });
  });

  var veil = null;

  function showBoardLoading(on) {
    if (on) {
      if (veil) return;
      veil = document.createElement('div');
      veil.className = 'board-veil';
      var inner = document.createElement('div');
      inner.className = 'veil-inner';
      var spin = document.createElement('div');
      spin.className = 'spinner';
      var p = document.createElement('p');
      p.textContent = 'Cutting up the photo…';
      inner.appendChild(spin);
      inner.appendChild(p);
      veil.appendChild(inner);
      el.board.parentNode.appendChild(veil);
    } else if (veil) {
      veil.remove();
      veil = null;
    }
  }

  /* ============================================================
     Turning a card
     ============================================================ */

  function onPieceClick(ev) {
    var id = parseInt(ev.currentTarget.dataset.piece, 10);
    var piece = state.puzzle && state.puzzle.get(id);
    if (!piece) return;
    if (state.mode === 'easy') { revealEasyPiece(piece); return; }
    selectPiece(piece);
  }

  /** Easy mode: flip the piece where it already sits. No inspector, no board navigation. */
  function revealEasyPiece(piece) {
    var btn = pieceButton(piece.id);
    if (!btn) return;

    if (btn.classList.contains('is-flipped')) {
      // Already revealed — looking again is free.
      sfx.reuse();
      setFeedback('That piece is already revealed.');
      return;
    }

    // `state.seen` is cleared at the start of every round, so this is the
    // per-round reveal count (state.inspected is a whole-run tally).
    var revealedCount = Object.keys(state.seen).length;
    if (revealedCount >= EASY_REVEAL_LIMIT) {
      sfx.wrong();
      setFeedback('All ' + EASY_REVEAL_LIMIT + ' pieces are revealed — name the photo!', 'bad');
      return;
    }

    btn.classList.add('is-flipped');
    btn.setAttribute('aria-label',
      'Piece ' + (parseInt(btn.dataset.slot || '0', 10) + 1) + ', revealed. It is row ' +
      (piece.row + 1) + ', column ' + (piece.col + 1));
    paintCard(btn, piece);
    sfx.flip();

    // First look at this piece: it costs you.
    state.seen[piece.id] = true;
    state.inspected++;
    charge(cost('perPiece'));
    sfx.cost();
    updateStats();

    revealedCount++;
    if (revealedCount >= EASY_REVEAL_LIMIT) setFeedback('All ' + EASY_REVEAL_LIMIT + ' pieces are revealed — name the photo!');
    else setFeedback('Revealed ' + revealedCount + ' of ' + EASY_REVEAL_LIMIT + ' pieces.');
  }

  function selectPiece(piece) {
    state.selected = piece;

    var cells = el.board.querySelectorAll('.piece');
    for (var i = 0; i < cells.length; i++) {
      var isCur = parseInt(cells[i].dataset.piece, 10) === piece.id;
      cells[i].classList.toggle('is-cur', isCur);
      if (isCur) cells[i].setAttribute('aria-pressed', 'true');
    }

    var btn = pieceButton(piece.id);
    var wasDown = btn && !btn.classList.contains('is-flipped');

    if (wasDown) {
      btn.classList.add('is-flipped');
      btn.setAttribute('aria-label',
        'Card ' + (parseInt(btn.dataset.slot || '0', 10) + 1) + ', face up. True position row ' +
        (piece.row + 1) + ', column ' + (piece.col + 1));
      paintCard(btn, piece);
      sfx.flip();
    } else {
      sfx.reuse();
    }

    if (state.seen[piece.id]) {
      renderInspector(piece);
      setFeedback('Already turned — looking again is free.');
      return;
    }

    // First look at this card: it costs you.
    state.seen[piece.id] = true;
    state.inspected++;
    charge(cost('perPiece'));
    sfx.cost();
    updateStats();
    renderInspector(piece);
  }

  /* ============================================================
     Inspector
     ============================================================ */

  function renderInspector(piece) {
    if (!piece || !state.puzzle) {
      show(el.cross, false);
      show(el.stageEmpty, true);
      el.tagPos.textContent = '—';
      el.tagCost.textContent = '';
      el.tagCost.className = 'tag tag--muted';
      return;
    }

    show(el.stageEmpty, false);
    show(el.cross, true);

    var puzzle = state.puzzle;
    var withContext = el.chkContext.checked;

    // A square 3x3 grid (1 / 1.75 / 1) means the centre cell's aspect
    // equals the cross's, so one number makes every slot card-shaped.
    el.cross.style.setProperty('--stage-ar', String(puzzle.aspect));

    var slotOf = function (pos) { return el.cross.querySelector('[data-pos="' + pos + '"]'); };
    var mainRect = slotOf('main').getBoundingClientRect();

    paintSlot('main', piece, mainRect.width, mainRect.height);

    if (withContext) {
      var sideRect = slotOf('up').getBoundingClientRect();
      var sw = sideRect.width, sh = sideRect.height;
      paintSlot('up',    piece.nUp    > -1 ? puzzle.get(piece.nUp)    : null, sw, sh);
      paintSlot('down',  piece.nDown  > -1 ? puzzle.get(piece.nDown)  : null, sw, sh);
      paintSlot('left',  piece.nLeft  > -1 ? puzzle.get(piece.nLeft)  : null, sw, sh);
      paintSlot('right', piece.nRight > -1 ? puzzle.get(piece.nRight) : null, sw, sh);
    } else {
      ['up', 'down', 'left', 'right'].forEach(function (pos) {
        var slot = slotOf(pos);
        slot.textContent = '';
        slot.classList.add('is-empty');
        slot.dataset.label = '—';
      });
    }

    el.tagPos.textContent = puzzle.label(piece);
    el.tagPos.title = 'Its true home in the photo';
    if (state.seen[piece.id]) {
      el.tagCost.textContent = state.freeSeen[piece.id] ? 'turned · free' : 'inspected';
      el.tagCost.className = 'tag tag--muted';
    } else {
      el.tagCost.textContent = 'turning costs ' + money(-cost('perPiece'));
      el.tagCost.className = 'tag tag--warn';
    }
  }

  function paintSlot(pos, piece, w, h) {
    var slot = el.cross.querySelector('[data-pos="' + pos + '"]');
    slot.textContent = '';
    slot.classList.toggle('is-empty', !piece);
    if (pos !== 'main') slot.dataset.label = piece ? NEIGHBOUR_LABELS[pos] : '—';
    if (piece && w > 0 && h > 0) slot.appendChild(state.puzzle.canvasFor(piece, w, h, 'contain'));
  }

  /* ============================================================
     Stats
     ============================================================ */

  function updateStats() {
    el.statScore.textContent = Math.round(liveScore()).toLocaleString();
    el.statFound.textContent = state.found + ' / ' + state.deck.length;
    el.statPieces.textContent = state.mode === 'easy'
      ? Object.keys(state.seen).length + ' / ' + EASY_REVEAL_LIMIT
      : String(state.inspected);
    el.statPiecesLabel.textContent = state.mode === 'easy' ? 'Revealed' : 'Flipped';

    if (state.diff.time) {
      el.statTime.textContent = clock(state.timeLeft);
      el.statTimerBox.classList.toggle('is-low', state.timeLeft <= 30);
    } else {
      el.statTime.textContent = '∞';
      el.statTimerBox.classList.remove('is-low');
    }

    var pips = el.statStrikes.children;
    for (var i = 0; i < pips.length; i++) {
      pips[i].classList.toggle('is-used', i < state.wrong);
    }
  }

  /* ============================================================
     Clock — one countdown for the whole run, not per round
     ============================================================ */

  function startClock() {
    stopClock();
    if (!state.diff.time) { state.timeLeft = 0; return; }
    state.timeLeft = state.diff.time;
    state.deadline = Date.now() + state.diff.time * 1000;
    state.timerId = setInterval(tick, 200);
    tick();
  }

  function tick() {
    if (state.phase !== 'playing') return;
    state.timeLeft = Math.max(0, (state.deadline - Date.now()) / 1000);
    updateStats();
    if (state.timeLeft <= 0) loseRound('time');
  }

  function stopClock() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  }

  function pauseClock() {
    if (!state.diff.time || !state.timerId) return;
    stopClock();
    state.pausedLeft = state.timeLeft;
  }

  function resumeClock() {
    if (!state.diff.time) return;
    state.deadline = Date.now() + state.pausedLeft * 1000;
    state.timerId = setInterval(tick, 200);
    tick();   // refresh the readout now rather than up to 200ms later
  }

  /* ============================================================
     Round lifecycle
     ============================================================ */

  function resetRoundState() {
    state.seen = {};
    state.freeSeen = {};
    state.selected = null;
    state.wrong = 0;
    state.intelCost = 0;
    state.pending = 0;
    state.usedCategory = false;
    state.usedChoices = false;
    state.choiceMode = false;
    state.result = null;
    state.roundRecorded = false;
    state.roundStart = Date.now();

    el.answerInput.value = '';
    el.answerInput.disabled = false;
    el.btnMic.disabled = !SR;
    el.btnComplete.disabled = false;
    el.btnWrong.disabled = false;
    el.btnComplete.textContent = 'Game complete';
    el.choices.textContent = '';
    show(el.choices, false);

    el.pieceCostLabel.textContent = money(-cost('perPiece'));
    el.pieceCostUnit.textContent = state.mode === 'easy' ? '/ piece' : '/ card';
    el.toolCategory.disabled = false;
    el.toolReveal.disabled = false;
    el.toolChoices.disabled = false;
    el.toolSurrender.disabled = false;
    el.costReveal.textContent = cost('reveal');
    el.costChoices.textContent = cost('choices');

    stopMic();
    setFeedback(state.mode === 'easy'
      ? 'Everyone ready? Reveal a piece.'
      : 'Everyone ready? Turn a card.');
    updateStats();
  }

  function beginRound() {
    resetRoundState();

    var entry = state.deck[state.index];
    if (!entry) {
      showBoardLoading(false);
      setFeedback('No photos loaded. Open the photo library to choose one.', 'bad');
      return;
    }
    state.entry = entry;

    var token = ++state.loadToken;
    showBoardLoading(true);

    // Deferred by a microtask so the veil gets a frame to paint before a slow
    // decode, while already-cached photos never flash it at all.
    Promise.resolve().then(function () { return entry.load(); }).then(function (def) {
      if (token !== state.loadToken) return;    // superseded, e.g. the host picked another photo
      showBoardLoading(false);
      mountRound(def);
    }, function (err) {
      if (token !== state.loadToken) return;
      showBoardLoading(false);
      setFeedback('That photo could not be loaded: ' + (err && err.message ? err.message : 'unknown error'), 'bad');
    });
  }

  function mountRound(def) {
    state.current = def;
    state.puzzle = new Puzzle(def, { cols: COLS, rows: ROWS, shuffle: state.mode !== 'easy' });
    state.portrait = state.puzzle.fullCanvas(240, 180).toDataURL('image/jpeg', 0.82);

    applyModeChrome();

    // The photo is now baked into the puzzle's own canvas, so the decoded
    // bitmap is finished with — releasing it keeps a long library from
    // piling up hundreds of megabytes.
    if (lib()) lib().releaseOthers(state.entry ? [state.entry.id] : []);

    renderBoard();
    renderInspector(null);
    updateStats();
    el.answerInput.focus({ preventScroll: true });
  }

  /** Dress the board and sidebar for the selected mode. */
  function applyModeChrome() {
    var easy = state.mode === 'easy';
    var titleEl = el.panelTitle;

    el.inspectorCard.hidden = easy;
    el.intelCard.hidden = easy;
    el.legendSelectedWrap.hidden = easy;
    el.legendSeen.textContent = easy ? 'revealed' : 'flipped';
    el.boardHint.textContent = easy
      ? 'Reveal up to 12 pieces — the photo stays where it is.'
      : 'Tip: read the edges and corners first — the middle is always the same idea.';

    if (easy) {
      titleEl.innerHTML = 'The photo, whole — reveal <b>12</b> pieces';
      el.panelSub.textContent = 'Every piece is already in its true place. Reveal up to 12 of them, then name the photo.';
    } else {
      titleEl.innerHTML = 'The photo, cut into <b>30</b> cards';
      el.panelSub.textContent = state.current && state.current.category
        ? 'All 30 cards are face down · ' + state.current.category
        : 'All 30 cards are face down.';
    }
  }

  function elapsedSeconds() {
    return (Date.now() - state.roundStart) / 1000;
  }

  function startRun(entries, difficulty, mode) {
    stopClock();
    stopMic();
    state.diff = difficulty;
    state.mode = mode || chosenMode();
    syncModePickers();
    state.deck = entries && entries.length ? entries : defaultDeck();
    state.index = 0;
    state.score = 0;
    state.found = 0;
    state.inspected = 0;
    state.streak = 0;
    state.bestStreak = 0;
    state.history = [];
    state.reason = null;
    state.pausedLeft = 0;
    state.revealTerminal = false;
    state.phase = 'playing';

    show(el.overlayStart, false);
    show(el.overlayUpload, false);
    show(el.overlayOver, false);
    show(el.overlayReveal, false);
    show(el.overlayLibrary, false);
    show(el.overlayEdit, false);
    show(el.layout, true);

    beginRound();
    startClock();
  }

  /**
   * Leave the reveal card. The host decides what happens next: run the same
   * photo again, or go and pick another one.
   */
  function afterReveal(mode) {
    show(el.overlayReveal, false);
    state.phase = 'playing';

    if (state.revealTerminal) {
      var reason = state.reason;
      state.revealTerminal = false;
      endRun(reason || 'guesses');
      return;
    }

    if (mode === 'pick') { openLibrary(); return; }

    if (mode === 'next') {
      var next = nextEntry();
      // Nothing else in the deck, so another go at this one is the only option.
      if (!next) { resumeClock(); beginRound(); return; }
      state.index = (state.index + 1) % state.deck.length;
      resumeClock();
      beginRound();
      return;
    }

    resumeClock();
    beginRound();          // same photo, freshly shuffled
  }

  /** The entry this run would move on to, or null if the deck holds only one. */
  function nextEntry() {
    if (!state.deck || state.deck.length < 2) return null;
    return state.deck[(state.index + 1) % state.deck.length];
  }

  /* ============================================================
     Rounds as the host runs them
     ============================================================ */

  /** The host says they got it. Nothing can be typed here that stops this. */
  function completeRound() {
    if (state.phase !== 'playing') return;
    winRound(el.answerInput.value);
  }

  function takeStrike() {
    if (state.phase !== 'playing') return;
    var said = String(el.answerInput.value || '').trim();
    loseGuess(said || 'that');
    el.answerInput.value = '';
  }

  function loseGuess(value) {
    state.wrong++;
    sfx.wrong();
    updateStats();

    var left = state.diff.guesses - state.wrong;
    if (left <= 0) {
      setFeedback('“' + value + '” — wrong. That was the last one.', 'bad');
      say('Out of guesses.');
      recordRound(false);
      loseRound('guesses');
      return;
    }

    setFeedback(
      '“' + value + '” — not quite.' +
      (nearMiss(value) ? ' You were in the right area.' : '') +
      ' ' + left + ' ' + (left === 1 ? 'try' : 'tries') + ' left.',
      'bad'
    );
  }

  function winRound(value) {
    sfx.right();

    var said = String(value == null ? '' : value).trim();
    var secs = Math.min(elapsedSeconds(), state.diff.time ? state.diff.time : 9999);
    var opened = Object.keys(state.seen).length;
    // Cards turned by the "turn one over" intel were never charged the per-card
    // price — that purchase is billed on its own line below. Counting them here
    // too would bill the same card twice, and the scorecard would not add up to
    // the score the player watched drain.
    var freeOpened = Object.keys(state.freeSeen).length;
    var paidCards = opened - freeOpened;

    var roundLines = [
      { label: 'Identification bonus', amount: SCORE.base }
    ];
    if (said) roundLines.push({ label: 'They said', amount: null, text: said });
    var pieceWord = state.mode === 'easy' ? 'piece' : 'card';
    var actionWord = state.mode === 'easy' ? 'revealed' : 'turned';
    if (paidCards > 0) {
      roundLines.push({
        label: paidCards + ' ' + pieceWord + (paidCards === 1 ? '' : 's') + ' ' + actionWord + ' × ' + cost('perPiece'),
        amount: -paidCards * cost('perPiece')
      });
    }
    if (freeOpened > 0) {
      roundLines.push({
        label: freeOpened + ' ' + pieceWord + (freeOpened === 1 ? '' : 's') + ' turned for them',
        amount: 0
      });
    }
    roundLines.push({
      label: Math.round(secs) + 's spent × ' + cost('perSecond'),
      amount: -Math.round(secs) * cost('perSecond')
    });
    if (state.wrong) {
      roundLines.push({
        label: state.wrong + ' wrong guess' + (state.wrong === 1 ? '' : 'es'),
        amount: -state.wrong * cost('perWrong')
      });
    }
    if (state.intelCost) roundLines.push({ label: 'Intel purchased', amount: -state.intelCost });
    if (state.streak >= 1) {
      roundLines.push({ label: 'Streak bonus ×' + state.streak, amount: SCORE.streak * state.streak });
    }

    var raw = roundLines.reduce(function (s, l) { return s + (l.amount || 0); }, 0);
    var banked = Math.max(SCORE.floor, Math.round(raw));
    if (banked > raw) roundLines.push({ label: 'Round floor applied', amount: banked - Math.round(raw) });

    // Bank only what this round earned; the pending costs are wiped because
    // they are already itemised in the lines above.
    state.score += banked;
    state.pending = 0;
    state.found++;
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.result = { ok: true, value: said, total: banked, lines: roundLines, pieces: opened };
    recordRound(true);
    updateStats();

    say('Identified: ' + state.current.title);
    pauseClock();
    showReveal(true);
  }

  /** Round is lost (guesses, time, or surrender): show the photo, then the results. */
  function loseRound(reason) {
    stopClock();
    state.reason = reason;
    state.result = { ok: false, reason: reason, value: null };
    showReveal(false);
  }

  /* ============================================================
     Reveal card
     ============================================================ */

  function showReveal(ok) {
    state.phase = 'reveal';
    if (!ok) state.revealTerminal = true;

    el.revealImg.src = state.puzzle.fullCanvas(1600, 1200).toDataURL('image/jpeg', 0.9);

    if (ok) {
      var said = state.result.value;
      el.revealEyebrow.textContent = said
        ? (isCorrect(said, state.current.answers) ? 'Identified' : 'Identified — the host accepted it')
        : 'Identified';
      el.revealEyebrow.className = 'eyebrow';
      el.revealTitle.textContent = state.current.title;

      var rows = '';
      state.result.lines.forEach(function (l) {
        if (l.amount === null) {
          rows += '<tr><td>' + l.label + '</td><td>' + escapeHtml(l.text || '') + '</td></tr>';
          return;
        }
        rows += '<tr class="' + (l.amount >= 0 ? 'is-plus' : 'is-minus') + '"><td>' +
                l.label + '</td><td>' + money(l.amount) + '</td></tr>';
      });
      rows += '<tr class="is-total"><td>Banked</td><td>' + money(state.result.total) + '</td></tr>';
      el.scorecard.innerHTML = rows;
    } else {
      var why = { time: 'Time expired', guesses: 'Out of guesses', surrender: 'Surrendered' }[state.reason] || 'Case lost';
      el.revealEyebrow.textContent = why;
      el.revealEyebrow.className = 'eyebrow is-bad';
      el.revealTitle.textContent = state.current.title;
      el.scorecard.innerHTML =
        '<tr class="is-minus"><td>The answer</td><td>' + escapeHtml(state.current.title) + '</td></tr>' +
        '<tr class="is-minus"><td>Guesses used</td><td>' + state.wrong + ' of ' + state.diff.guesses + '</td></tr>' +
        '<tr class="is-minus"><td>' + (state.mode === 'easy' ? 'Pieces revealed' : 'Cards turned') +
        '</td><td>' + Object.keys(state.seen).length + '</td></tr>';
    }

    show(el.scorecard, true);

    el.answerInput.disabled = true;
    el.btnComplete.disabled = true;
    el.btnWrong.disabled = true;
    el.btnMic.disabled = true;
    el.toolCategory.disabled = true;
    el.toolReveal.disabled = true;
    el.toolChoices.disabled = true;
    el.toolSurrender.disabled = true;
    stopMic();

    show(el.overlayReveal, true);
    syncModePickers();
    setRevealActions();
  }

  /**
   * What the host can do next, in the order they will reach for it. Moving on
   * to another photo is the default; the same photo is one click away when they
   * want another go at this one.
   *
   * The button deliberately does not name the photo it will deal. Everyone is
   * looking at this card, and a title here would tell the players what is about
   * to be on the table.
   */
  function setRevealActions() {
    var next = nextEntry();
    var terminal = state.revealTerminal;

    el.btnNext.hidden = !next || terminal;
    el.btnReplay.hidden = terminal;
    el.btnReplay.textContent = 'Play again — same photo';

    // Exactly one button wears the primary styling, so Enter and a quick glance
    // both land on the same place.
    var lead = terminal ? el.btnPick : (next ? el.btnNext : el.btnReplay);
    [el.btnNext, el.btnReplay, el.btnPick].forEach(function (b) {
      b.className = 'btn' + (b === lead ? ' btn--primary btn--big' : ' btn--ghost');
    });

    if (terminal) el.btnPick.textContent = 'See the results';
    if (next) el.btnNext.textContent = 'Next game';

    // Choosing a mode only matters when the run continues. A terminal reveal
    // (out of guesses/time) is going to the results screen, so hide the picker
    // rather than offer a choice that would never apply.
    if (el.revealModeField) el.revealModeField.hidden = terminal;

    lead.focus();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ============================================================
     Speech — optional convenience for the host
     ============================================================ */

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recog = null;
  var listening = false;

  function micNote(msg, kind) {
    el.micNote.hidden = !msg;
    el.micNote.textContent = msg || '';
    el.micNote.className = 'mic-note' + (kind ? ' is-' + kind : '');
  }

  function initMic() {
    if (!SR) {
      el.btnMic.disabled = true;
      el.btnMic.title = 'Speech recognition is not available in this browser';
      micNote('This browser has no speech recognition. The host can type the answer instead.');
      return;
    }
    try {
      recog = new SR();
      recog.lang = navigator.language || 'en-US';
      recog.interimResults = true;
      recog.continuous = false;
      recog.maxAlternatives = 1;

      recog.onstart = function () {
        listening = true;
        el.btnMic.classList.add('is-live');
        micNote('Listening — players should say the name now.', 'live');
      };

      recog.onresult = function (ev) {
        var said = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) said += ev.results[i][0].transcript;
        said = said.trim();
        if (said) el.answerInput.value = said;
        micNote('Heard: “' + said + '”');
      };

      recog.onerror = function (ev) {
        var why = {
          'not-allowed': 'Microphone permission was refused. Type the answer instead.',
          'service-not-allowed': 'Speech recognition is blocked here. Type the answer instead.',
          'no-speech': 'Nothing heard. Try again.',
          'network': 'Speech recognition needs a network connection. Type the answer instead.',
          'audio-capture': 'No microphone found. Type the answer instead.'
        }[ev.error] || ('Speech recognition stopped: ' + ev.error);
        micNote(why, 'bad');
      };

      recog.onend = function () {
        listening = false;
        el.btnMic.classList.remove('is-live');
        if (el.micNote.classList.contains('is-live')) micNote('');
      };
    } catch (e) {
      el.btnMic.disabled = true;
      micNote('Speech recognition could not start here. Type the answer instead.', 'bad');
    }
  }

  function toggleMic() {
    if (!recog || state.phase !== 'playing') return;
    if (listening) { recog.stop(); return; }
    try { recog.start(); }
    catch (e) { micNote('Could not start listening. Try again in a moment.', 'bad'); }
  }

  function stopMic() {
    if (recog && listening) { try { recog.stop(); } catch (e) { /* already stopped */ } }
    listening = false;
    if (el.btnMic) el.btnMic.classList.remove('is-live');
  }

  /* ============================================================
     Intel
     ============================================================ */

  function useCategory() {
    if (state.usedCategory) return;
    state.usedCategory = true;
    el.toolCategory.disabled = true;
    sfx.hint();
    setFeedback('Category: ' + state.current.category + '.', 'info');
    say('Category: ' + state.current.category);
  }

  function useReveal() {
    var unseen = state.puzzle.pieces.filter(function (p) { return !state.seen[p.id]; });
    if (!unseen.length) {
      setFeedback('Every card has already been turned.');
      el.toolReveal.disabled = true;
      return;
    }

    var piece = unseen[(Math.random() * unseen.length) | 0];
    var price = cost('reveal');

    state.seen[piece.id] = true;
    state.freeSeen[piece.id] = true;
    state.intelCost += price;
    charge(price);
    updateStats();
    markFree(piece.id);

    selectPiece(piece);   // already marked seen, so this won't charge twice
    sfx.hint();
    setFeedback('Turned one over for ' + money(-price) + '. ' + (unseen.length - 1) + ' still face down.', 'info');
  }

  function markFree(id) {
    var btn = pieceButton(id);
    if (btn) btn.classList.add('is-free');
  }

  function useChoices() {
    if (state.choiceMode) return;
    state.choiceMode = true;
    state.usedChoices = true;

    var price = cost('choices');
    state.intelCost += price;
    charge(price);
    updateStats();
    sfx.hint();

    var correct = state.current.title;
    var options = shuffle(decoysFor(state.current, 2).concat([correct]));

    el.choices.textContent = '';

    var head = document.createElement('p');
    head.className = 'feedback is-info';
    head.style.margin = '0 0 3px';
    var count = options.length;
    head.textContent = (count === 1 ? 'One option' : count + ' options') +
      ' (' + money(-price) + ') — pick one.';
    el.choices.appendChild(head);

    options.forEach(function (opt) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'choice';
      b.textContent = opt;
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(el.choices.querySelectorAll('.choice'), function (x) {
          x.disabled = true;
        });
        if (opt === correct) {
          b.classList.add('is-good');
          winRound(opt);
        } else {
          b.classList.add('is-bad');
          state.wrong++;
          updateStats();
          sfx.wrong();
          var left = state.diff.guesses - state.wrong;
          if (left <= 0) {
            setFeedback('Out of guesses.', 'bad');
            recordRound(false);
            loseRound('guesses');
          } else {
            setFeedback('Not that one. ' + left + ' ' + (left === 1 ? 'try' : 'tries') + ' left.', 'bad');
          }
        }
      });
      el.choices.appendChild(b);
    });

    el.toolChoices.disabled = true;
    show(el.choices, true);
  }

  function surrender() {
    if (state.phase !== 'playing') return;
    recordRound(false);
    loseRound('surrender');
  }

  /* ============================================================
     End of run
     ============================================================ */

  function recordRound(found) {
    if (state.roundRecorded) return;
    state.roundRecorded = true;
    state.history.push({
      title: state.current ? state.current.title : '—',
      found: !!found,
      pieces: Object.keys(state.seen).length,
      thumb: state.portrait
    });
  }

  function endRun(reason) {
    if (state.phase === 'over') return;
    stopClock();
    stopMic();
    state.phase = 'over';
    state.reason = reason;

    if (!state.roundRecorded) recordRound(false);

    sfx.over();
    renderGameOver(reason);
    show(el.overlayReveal, false);
    show(el.overlayLibrary, false);
    show(el.overlayEdit, false);
    show(el.overlayOver, true);
  }

  function renderGameOver(reason) {
    var identified = state.history.filter(function (h) { return h.found; }).length;
    var timeUp = reason === 'time';
    var left = state.deck.length - identified;

    if (reason === 'complete') {
      el.overEyebrow.textContent = 'Case closed';
      el.overEyebrow.className = 'eyebrow';
      el.overTitle.textContent = 'Every last one';
      el.overBlurb.textContent = 'You named all ' + state.deck.length + ' photo' +
        (state.deck.length === 1 ? '' : 's') + '. That is not luck, that is an eye.';
    } else if (reason === 'quit') {
      el.overEyebrow.textContent = 'Case closed';
      el.overEyebrow.className = 'eyebrow';
      el.overTitle.textContent = 'Called it a day';
      el.overBlurb.textContent = 'You identified ' + identified + ' photo' + (identified === 1 ? '' : 's') +
        ' on ' + state.diff.label.toLowerCase() + '.';
    } else if (timeUp) {
      el.overEyebrow.textContent = 'Time expired';
      el.overEyebrow.className = 'eyebrow is-bad';
      el.overTitle.textContent = 'Out of time';
      el.overBlurb.textContent = 'The clock beat you with ' + left + ' photo' +
        (left === 1 ? '' : 's') + ' still unidentified.';
    } else if (reason === 'surrender') {
      el.overEyebrow.textContent = 'Case closed';
      el.overEyebrow.className = 'eyebrow';
      el.overTitle.textContent = 'You walked away';
      el.overBlurb.textContent = 'You identified ' + identified + ' of ' + state.deck.length +
        ' photo' + (state.deck.length === 1 ? '' : 's') + ' on ' + state.diff.label.toLowerCase() + '.';
    } else {
      el.overEyebrow.textContent = 'Case closed';
      el.overEyebrow.className = 'eyebrow';
      el.overTitle.textContent = 'Out of guesses';
      el.overBlurb.textContent = 'You identified ' + identified + ' of ' + state.deck.length +
        ' photo' + (state.deck.length === 1 ? '' : 's') + ' on ' + state.diff.label.toLowerCase() + '.';
    }

    el.finalScore.textContent = Math.max(0, Math.round(liveScore())).toLocaleString();

    var avg = identified ? state.inspected / identified : 0;
    var rows = [
      { k: 'Photos identified', v: identified + ' / ' + state.deck.length, bad: false },
      { k: 'Cards turned', v: String(state.inspected), bad: false },
      { k: 'Cards per solve', v: avg ? avg.toFixed(1) : '—', bad: avg > 12 },
      { k: 'Longest streak', v: String(state.bestStreak), bad: false },
      { k: 'Difficulty', v: state.diff.label, bad: false }
    ];
    el.overTally.innerHTML = rows.map(function (r) {
      return '<li' + (r.bad ? ' class="is-bad"' : '') + '><span>' + r.k + '</span><b>' + r.v + '</b></li>';
    }).join('');

    el.overPhotos.innerHTML = '';
    state.history.forEach(function (h) {
      var row = document.createElement('li');
      row.className = 'op-row ' + (h.found ? 'is-found' : 'is-missed');

      var thumb = document.createElement('div');
      thumb.className = 'op-thumb';
      var im = document.createElement('img');
      im.src = h.thumb;
      im.alt = '';
      thumb.appendChild(im);

      var name = document.createElement('span');
      name.className = 'op-name';
      name.textContent = h.found ? h.title : 'Unidentified';

      var note = document.createElement('span');
      note.className = 'op-note';
      note.textContent = h.pieces + ' pc';

      row.appendChild(thumb);
      row.appendChild(name);
      row.appendChild(note);
      el.overPhotos.appendChild(row);
    });
  }

  /* ============================================================
     Photo library
     ============================================================ */

  function refreshLibrary() {
    var l = lib();
    var snap = l ? l.state() : null;

    el.libBadge.textContent = snap && snap.present ? (snap.present + ' photos') : 'Library';
    el.btnLibRescan.hidden = !snap || !snap.total;
    el.btnStartRescan.hidden = !snap || !snap.total;
    el.btnStart.textContent = snap && snap.present
      ? 'Start with your photo library'
      : 'Choose your Photo library folder';
    el.btnStartUpload.textContent = 'Just one photo this time →';

    // One place decides what the hint says, so a message can never outlive
    // the condition that produced it.
    setHint(hintFor(snap));
  }

  /** Whatever the host most needs to be told right now, or null for nothing. */
  function hintFor(snap) {
    if (state.note) return { text: state.note, bad: state.noteBad };
    if (!snap) return null;
    if (snap.missing) {
      return {
        bad: false,
        text: snap.missing + ' photo' + (snap.missing === 1 ? '' : 's') +
          ' moved out of the folder. They are kept, not deleted — move them back and rescan.'
      };
    }
    if ((snap.total || snap.folder) && snap.storage === 'memory') {
      // The photos play fine, they just will not survive a reload.
      return {
        bad: false,
        text: 'This browser will not let the game keep a photo library between visits, so these ' +
          'photos are held for this session only — closing the tab forgets them, and you will ' +
          'need to choose the folder again next time.'
      };
    }
    return null;
  }

  function setHint(note) {
    if (!note || !note.text) {
      el.libHint.hidden = true;
      el.libHint.textContent = '';
      return;
    }
    el.libHint.hidden = false;
    el.libHint.className = 'lib-hint' + (note.bad ? ' is-bad' : '');
    el.libHint.textContent = note.text;
  }

  /**
   * A transient message for the hint line: the progress and result of a folder
   * scan, or a failed rename. Held in state so hintFor() stays the only writer,
   * and cleared when the host next opens a dialog, so it cannot outlive the
   * interaction that caused it.
   */
  function setNote(text, bad) {
    state.note = text || '';
    state.noteBad = !!bad;
    refreshLibrary();
  }

  function renderLibrary() {
    var l = lib();
    var snap = l ? l.state() : { present: 0, total: 0, missing: 0, folder: '', photos: [], missingPhotos: [] };

    el.libCount.innerHTML = snap.total
      ? '<b>' + snap.present + '</b> ready' +
        (snap.missing ? ' · <b>' + snap.missing + '</b> moved away' : '') +
        (snap.folder ? ' · ' + escapeHtml(snap.folder) : '') +
        (snap.storage === 'memory' ? ' · not saved between visits' : '')
      : 'No folder chosen yet.';

    var q = el.libSearch.value.trim().toLowerCase();
    var entries = libraryEntries();

    if (q) {
      entries = entries.filter(function (e) {
        return (e.title || '').toLowerCase().indexOf(q) !== -1 ||
               (e.category || '').toLowerCase().indexOf(q) !== -1;
      });
    }

    el.libGrid.textContent = '';

    if (!entries.length) {
      show(el.libEmpty, true);
      el.libEmpty.querySelector('p').innerHTML = q
        ? 'No photo matches <b>' + escapeHtml(q) + '</b>.'
        : '<b>Point the game at a folder of photos.</b><br />Pick it below, or drag the whole folder onto this box.';
      return;
    }

    show(el.libEmpty, false);

    var currentId = state.entry ? state.entry.id : null;

    var section = document.createElement('p');
    section.className = 'lib-section';
    section.textContent = snap.folder || 'Photo library';
    el.libGrid.appendChild(section);

    entries.forEach(function (entry) {
      el.libGrid.appendChild(libraryCard(entry, currentId));
    });
  }

  function libraryCard(entry, currentId) {
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'lib-card' + (entry.id === currentId ? ' is-current' : '');
    card.title = entry.title;

    var thumb = document.createElement('span');
    thumb.className = 'lib-thumb';
    if (entry.thumb) thumb.style.backgroundImage = 'url("' + entry.thumb + '")';

    var meta = document.createElement('span');
    meta.className = 'lib-meta';
    var name = document.createElement('span');
    name.className = 'lib-name';
    name.textContent = entry.title;
    var sub = document.createElement('span');
    sub.className = 'lib-sub';
    sub.textContent = entry.id === currentId ? 'playing now' : (entry.category || '—');
    meta.appendChild(name);
    meta.appendChild(sub);

    card.appendChild(thumb);
    card.appendChild(meta);

    if (entry.kind === 'library') {
      var edit = document.createElement('span');
      edit.className = 'lib-edit';
      edit.setAttribute('role', 'button');
      edit.setAttribute('aria-label', 'Rename ' + entry.title);
      edit.textContent = '✎';
      edit.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openEdit(entry.id);
      });
      card.appendChild(edit);
    }

    card.addEventListener('click', function () { playEntry(entry); });
    return card;
  }

  function openLibrary() {
    pauseClock();
    show(el.overlayLibrary, true);
    el.libSearch.value = '';
    var idle = state.phase === 'menu' || state.phase === 'over';
    el.btnLibFinish.textContent = idle ? 'Close' : 'End the run';
    // Each visit to the picker starts with a clean slate for transient notes.
    setNote('');
    renderLibrary();
    el.libSearch.focus();
  }

  function closeLibrary() {
    show(el.overlayLibrary, false);
    // A closed picker means the host is heading back into the round.
    if (state.phase === 'playing') {
      if (!state.timerId) resumeClock();
      // Focus cannot stay on a button inside an overlay that just closed.
      el.answerInput.focus({ preventScroll: true });
    } else if (state.phase === 'menu') {
      el.btnStart.focus({ preventScroll: true });
    }
  }

  /** The host picked a photo: make it the one being played. */
  function playEntry(entry) {
    closeLibrary();

    if (state.phase === 'menu' || state.phase === 'over') {
      startRun([entry], chosenDifficulty());
      return;
    }

    var idx = indexOfId(entry.id);
    if (idx === -1) { state.deck.push(entry); idx = state.deck.length - 1; }
    state.deck[idx] = entry;
    state.index = idx;

    // Switching photos mid-run abandons the current round rather than banking it.
    state.phase = 'playing';
    if (!state.timerId) resumeClock();
    beginRound();
  }

  /**
   * Both "Choose folder…" and "Rescan folder" open the same picker: a browser
   * will not hand back a folder handle without one, so re-picking the folder is
   * how a rescan is expressed. Dropping the folder on the box works too.
   */
  function askLibraryForFolder(rescan) {
    var l = lib();
    if (!l) return;

    setNote(rescan ? 'Choose the same folder again to rescan…' : 'Reading the folder…');

    var job = rescan ? l.rescan() : l.pickFolder();

    job.then(function (r) {
      setNote(scanNote(r));
      renderLibrary();
    }, function (err) {
      setNote((err && err.message) || 'No folder was chosen.', true);
    });
  }

  /** One sentence saying what a folder scan actually did. */
  function scanNote(r) {
    if (!r.total) return 'That folder has no images in it.';

    var bits = [];
    if (r.added) bits.push('Added ' + r.added + ' photo' + (r.added === 1 ? '' : 's'));
    if (r.replaced) {
      bits.push('Re-read ' + r.replaced + ' photo' + (r.replaced === 1 ? '' : 's') +
        ' that had been replaced in the folder');
    }
    if (r.sharpened) {
      bits.push('Re-saved ' + r.sharpened + ' photo' + (r.sharpened === 1 ? '' : 's') +
        ' at a higher resolution, so the cards come out sharper');
    }
    if (!bits.length) {
      return 'Nothing new — all ' + r.total + ' photo' + (r.total === 1 ? '' : 's') +
        ' were already cached.';
    }
    return bits.join('. ') + '. ' +
      (r.total - r.added - r.sharpened - r.replaced) + ' already cached.';
  }

  function onLibraryChanged() {
    refreshLibrary();
    if (!el.overlayLibrary.hasAttribute('hidden')) renderLibrary();
  }

  /* ---------- naming one photo ---------- */

  function openEdit(id) {
    var l = lib();
    if (!l) return;
    var info = l.details(id);
    if (!info) return;

    setNote('');              // any leftover scan message has served its turn
    state.editingId = id;
    el.editPreview.src = info.thumb || '';
    el.editPath.textContent = (info.folder ? info.folder + ' › ' : '') + info.path;
    el.editHeading.textContent = 'Name this photo';
    el.editName.value = info.title;
    el.editAliases.value = info.aliases.join(', ');
    show(el.overlayEdit, true);
    el.editName.focus();
    el.editName.select();
  }

  function closeEdit() {
    show(el.overlayEdit, false);
    state.editingId = null;
  }

  function saveEdit() {
    var l = lib();
    if (!l || !state.editingId) { closeEdit(); return; }
    var id = state.editingId;
    l.rename(id, el.editName.value, el.editAliases.value).then(function () {
      closeEdit();
      setNote('');
      renderLibrary();
      // The deck holds entries built before the rename; swap the one we just
      // named so the next round announces the new title.
      var fresh = l.find(id);
      if (fresh) state.deck = state.deck.map(function (entry) { return entry.id === id ? fresh : entry; });
    }, function (err) {
      setNote(err && err.message ? err.message : 'Could not save that name.', true);
    });
  }

  /* ============================================================
     One-off upload (a single photo, no folder)
     ============================================================ */

  var customPhoto = null;   // { src, name }

  function resetUpload() {
    customPhoto = null;
    el.fileInput.value = '';
    el.dropText.textContent = 'Choose an image, or drop one here';
    el.drop.classList.remove('has-file');
    show(el.answerField, false);
    el.titleInput.value = '';
    el.btnUploadGo.disabled = true;
  }

  function loadFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      el.dropText.textContent = 'That is not an image — try a JPG or PNG.';
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      var probe = new Image();
      probe.onload = function () {
        customPhoto = { src: reader.result, name: file.name };
        el.drop.classList.add('has-file');
        el.dropText.textContent = file.name + ' · ' + probe.naturalWidth + '×' + probe.naturalHeight;
        show(el.answerField, true);
        el.btnUploadGo.disabled = !el.titleInput.value.trim();
        el.titleInput.focus();
      };
      probe.onerror = function () { el.dropText.textContent = 'Could not read that image.'; };
      probe.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function startCustom(difficulty, mode) {
    var csv = el.titleInput.value;
    if (!customPhoto) return;
    playCustom(customPhoto.src, csv, difficulty, mode);
  }

  function playCustom(src, csv, difficulty, mode) {
    var parts = String(csv || '').split(',')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    if (!parts.length) return false;

    // Wait for the bitmap before the first paint, or round one opens blank.
    // A data URL can finish loading synchronously, so `go` is guarded rather
    // than trusted to fire exactly once.
    var img = new Image();
    var started = false;
    var go = function () {
      if (started) return;
      started = true;
      var def = {
        id: 'custom',
        title: parts[0],
        category: 'Your photo',
        answers: parts,
        draw: function (ctx) {
          var iw = img.naturalWidth || 1000;
          var ih = img.naturalHeight || 750;
          var scale = Math.max(1000 / iw, 750 / ih);
          var w = iw * scale, h = ih * scale;
          ctx.drawImage(img, (1000 - w) / 2, (750 - h) / 2, w, h);
        }
      };
      startRun([{ kind: 'custom', id: 'custom', title: parts[0], category: 'Your photo',
                   answers: parts, thumb: '', load: function () { return Promise.resolve(def); } }],
               difficulty || chosenDifficulty(), mode || chosenMode());
    };

    img.onload = go;
    img.onerror = go;
    img.src = src;
    if (img.complete) go();
    return true;
  }

  /* ============================================================
     Wiring
     ============================================================ */

  function chosenDifficulty() {
    var checked = el.diffPicker.querySelector('[aria-checked="true"]');
    return DIFFICULTIES[(checked && checked.dataset.diff) || 'standard'];
  }

  function chosenMode() {
    var checked = el.modePicker && el.modePicker.querySelector('[aria-checked="true"]');
    return (checked && checked.dataset.mode) || 'advance';
  }

  /**
   * One mode toggle, both pickers: the start screen and the reveal card must
   * always show the same choice, and state.mode is the single source of truth.
   */
  function syncModePickers() {
    var mode = state.mode || chosenMode();
    var pickers = [el.modePicker, el.revealModePicker];
    for (var i = 0; i < pickers.length; i++) {
      var picker = pickers[i];
      if (!picker) continue;
      Array.prototype.forEach.call(picker.querySelectorAll('button'), function (x) {
        x.setAttribute('aria-checked', String(x.dataset.mode === mode));
      });
    }
  }

  /** Pick a mode anywhere — the reveal card or the start screen — and sync. */
  function setMode(modeKey) {
    state.mode = modeKey === 'easy' ? 'easy' : 'advance';
    syncModePickers();
    syncModeCopy();
  }

  /** Keep the start-screen lede and rules in step with the chosen mode. */
  function syncModeCopy() {
    var easy = chosenMode() === 'easy';
    var lede = $('startLede');
    if (!lede) return;
    lede.textContent = easy
      ? 'The photo sits whole on the board, every piece in its true place. Reveal up to 12 pieces, then say what you are looking at before your guesses or your time run out.'
      : 'Thirty cards, all face down. Flip as few as you dare, work out what you are looking at, and say the name before your guesses or your time run out.';
    var r1 = $('rule1');
    if (r1) r1.innerHTML = easy
      ? 'Reveal a piece where it sits. <b>Each piece you reveal costs points.</b> Up to 12 of them.'
      : 'Flip a card to see it. <b>Every new card you turn costs points.</b> Flipping one you have already seen is free.';
  }

  el.diffPicker.addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-diff]');
    if (!b) return;
    Array.prototype.forEach.call(el.diffPicker.querySelectorAll('button'), function (x) {
      x.setAttribute('aria-checked', String(x === b));
    });
    sfx.click();
  });

  function wireModePicker(picker) {
    if (!picker) return;
    picker.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-mode]');
      if (!b) return;
      setMode(b.dataset.mode);
      sfx.click();
    });
  }
  wireModePicker(el.modePicker);
  wireModePicker(el.revealModePicker);

  /** A fresh run: the whole library, in a random order. */
  function newRun() {
    resetUpload();
    var photos = defaultDeck();

    // Nothing to play means nothing chosen yet, so the start button's job is
    // to go and get some photos rather than to fail.
    if (!photos.length) {
      sfx.click();
      openLibrary();
      return;
    }

    sfx.click();
    startRun(shuffle(photos), chosenDifficulty(), chosenMode());
  }

  el.btnStart.addEventListener('click', newRun);

  el.btnLibrary.addEventListener('click', openLibrary);

  el.btnStartUpload.addEventListener('click', function () {
    show(el.overlayStart, false);
    show(el.overlayUpload, true);
  });

  el.btnUploadCancel.addEventListener('click', function () {
    show(el.overlayUpload, false);
    show(el.overlayStart, true);
  });

  el.btnUploadGo.addEventListener('click', function () {
    show(el.overlayUpload, false);
    startCustom(chosenDifficulty(), chosenMode());
  });

  el.drop.addEventListener('click', function () { el.fileInput.click(); });
  el.drop.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.fileInput.click(); }
  });
  el.fileInput.addEventListener('change', function () { loadFile(el.fileInput.files[0]); });

  ['dragenter', 'dragover'].forEach(function (evt) {
    el.drop.addEventListener(evt, function (e) { e.preventDefault(); el.drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    el.drop.addEventListener(evt, function (e) { e.preventDefault(); el.drop.classList.remove('is-over'); });
  });
  el.drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
  });

  el.titleInput.addEventListener('input', function () {
    el.btnUploadGo.disabled = !el.titleInput.value.trim();
  });

  el.btnComplete.addEventListener('click', completeRound);
  el.btnWrong.addEventListener('click', takeStrike);
  el.btnMic.addEventListener('click', toggleMic);

  el.toolCategory.addEventListener('click', useCategory);
  el.toolReveal.addEventListener('click', useReveal);
  el.toolChoices.addEventListener('click', useChoices);
  el.toolSurrender.addEventListener('click', surrender);

  el.chkContext.addEventListener('change', function () {
    renderInspector(state.selected);
  });

  el.btnNext.addEventListener('click', function () { afterReveal('next'); });
  el.btnReplay.addEventListener('click', function () { afterReveal('same'); });
  el.btnPick.addEventListener('click', function () { afterReveal('pick'); });

  /* ---------- library overlay ---------- */

  el.btnLibFolder.addEventListener('click', function () { askLibraryForFolder(false); });
  el.btnLibRescan.addEventListener('click', function () { askLibraryForFolder(true); });

  /* The start screen's Rescan folder buttons straight to the same re-pick. */
  el.btnStartRescan.addEventListener('click', function () { askLibraryForFolder(true); });

  el.libSearch.addEventListener('input', renderLibrary);

  el.btnLibClose.addEventListener('click', closeLibrary);

  el.btnLibFinish.addEventListener('click', function () {
    var idle = state.phase === 'menu' || state.phase === 'over';
    closeLibrary();
    if (!idle) endRun('quit');
  });

  ['dragenter', 'dragover'].forEach(function (evt) {
    el.libDrop.addEventListener(evt, function (e) {
      e.preventDefault();
      el.libDrop.classList.add('is-over');
    });
  });
  ['dragleave', 'dragend'].forEach(function (evt) {
    el.libDrop.addEventListener(evt, function (e) {
      e.preventDefault();
      el.libDrop.classList.remove('is-over');
    });
  });
  el.libDrop.addEventListener('drop', function (e) {
    e.preventDefault();
    el.libDrop.classList.remove('is-over');
    var l = lib();
    if (!l) return;
    setNote('Reading the folder…');
    l.readDrop(e.dataTransfer).then(function (r) {
      setNote(r.added ? ('Added ' + r.added + ' photo' + (r.added === 1 ? '' : 's') + '.')
                      : 'Those photos are already in the library.');
      renderLibrary();
    }, function (err) {
      setNote(err && err.message ? err.message : 'Could not read that folder.', true);
    });
  });

  el.overlayLibrary.addEventListener('click', function (e) {
    if (e.target === el.overlayLibrary) closeLibrary();
  });

  el.btnEditCancel.addEventListener('click', closeEdit);
  el.btnEditSave.addEventListener('click', saveEdit);
  el.editAliases.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); saveEdit(); }
  });
  el.editName.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); saveEdit(); }
  });
  el.overlayEdit.addEventListener('click', function (e) {
    if (e.target === el.overlayEdit) closeEdit();
  });

  function backToMenu() {
    stopClock();
    stopMic();
    show(el.overlayOver, false);
    show(el.overlayReveal, false);
    show(el.overlayLibrary, false);
    show(el.overlayEdit, false);
    show(el.overlayStart, true);
    show(el.layout, false);   // don't leave a stale board behind the menu
    state.phase = 'menu';
    syncModePickers();
  }
  el.btnAgain.addEventListener('click', function () {
    show(el.overlayOver, false);
    newRun();
  });
  el.btnMenu.addEventListener('click', backToMenu);

  el.btnSound.addEventListener('click', function () {
    state.sound = !state.sound;
    el.btnSound.setAttribute('aria-pressed', String(state.sound));
    el.soundIcon.textContent = state.sound ? '🔊' : '🔇';
    if (state.sound) sfx.click();
  });

  function openHelp()  { show(el.overlayHelp, true);  el.btnCloseHelp.focus(); }
  function closeHelp() { show(el.overlayHelp, false); }
  el.btnHelp.addEventListener('click', openHelp);
  el.btnCloseHelp.addEventListener('click', closeHelp);
  el.overlayHelp.addEventListener('click', function (e) {
    if (e.target === el.overlayHelp) closeHelp();
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      if (!el.overlayEdit.hasAttribute('hidden')) { closeEdit(); return; }
      if (!el.overlayHelp.hasAttribute('hidden')) { closeHelp(); return; }
      if (!el.overlayLibrary.hasAttribute('hidden')) { closeLibrary(); return; }
    }
    if (state.phase !== 'playing' || ev.metaKey || ev.ctrlKey || ev.altKey) return;

    var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS }[ev.key];
    if (step != null) {
      var btns = el.board.querySelectorAll('.piece');
      var i = -1;
      for (var k = 0; k < btns.length; k++) if (btns[k] === document.activeElement) { i = k; break; }
      var next = (i === -1 ? 0 : i) + step;
      if (next >= 0 && next < btns.length) {
        ev.preventDefault();
        btns[next].focus();
      }
      return;
    }

    // Enter confirms the round for the host, wherever they are typing.
    if (ev.key === 'Enter' && document.activeElement === el.answerInput) {
      ev.preventDefault();
      completeRound();
    }
  });

  window.addEventListener('beforeunload', function () { stopClock(); stopMic(); });

  /* ============================================================
     Bootstrap
     ============================================================ */

  updateStats();
  initMic();
  syncModeCopy();
  syncModePickers();

  var l = lib();
  if (l) {
    l.onChange(onLibraryChanged);
    // init() never rejects: storage falls back to memory rather than failing,
    // and hintFor() is what tells the host when that has happened.
    l.init().then(refreshLibrary);
  }

  // A couple of hooks for debugging / embedding.
  window.PhotoDetective = {
    start: function (diffKey, modeKey) {
      resetUpload();
      startRun(defaultDeck(), DIFFICULTIES[diffKey] || DIFFICULTIES.standard, modeKey || chosenMode());
    },
    isCorrect: isCorrect,
    library: lib,
    // play a one-photo game from an image URL + "answer, alias, alias"
    playCustom: function (src, answersCsv, diffKey, modeKey) {
      return playCustom(src, answersCsv, DIFFICULTIES[diffKey] || chosenDifficulty(), modeKey || chosenMode());
    },
    // read-only peek, used by the test harness
    puzzle: function () { return state.puzzle; },
    deckTitles: function () {
      return state.deck.map(function (e) { return e.title; });
    },
    debug: function () {
      return {
        phase: state.phase,
        mode: state.mode,
        banked: state.score,
        pending: state.pending,
        live: liveScore(),
        index: state.index,
        current: state.current && state.current.title,
        currentId: state.current && state.current.id,
        flipped: Object.keys(state.seen).length,
        inspected: state.inspected,
        found: state.found,
        wrong: state.wrong,
        guesses: state.diff.guesses,
        deck: state.deck.length,
        history: state.history.length
      };
    }
  };

})();
