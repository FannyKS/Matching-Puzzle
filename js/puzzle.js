/* ============================================================
   puzzle.js — slicing one photo into 30 shuffled pieces.

   The whole photo is rendered once into an offscreen canvas at
   high resolution. Each piece is then a simple drawImage of its
   slice of that source, so every piece stays crisp no matter how
   large it is displayed.
   ============================================================ */

(function (global) {
  'use strict';

  // Width of the offscreen source the pieces are cut from.
  //
  // A card is one sixth of this, so a sixth has to cover the card's own pixels
  // or every card is an enlargement and the photo looks soft. The board is at
  // most 1560 CSS px wide, making a card ~180 CSS px -- 360 device px on a 2x
  // screen, 540 on a 3x one. 2700 gives 450 per card, which covers 2x outright
  // and all but 20% on 3x. Must stay in step with library.js LONG_EDGE: there
  // is no point rendering more than the cached photo holds.
  //
  // It must also divide by both 6 and 5. At 4:3 that means a multiple of 20,
  // or the piece edges land on half-pixels and the seams show.
  var SRC_W = 2700;
  var MAX_DPR = 3;          // piece canvases: match the screen, not just 2x

  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * @param {object} photo      anything with a draw(ctx) -- a library photo
   *                             or a one-off upload
   * @param {object} [opts]
   * @param {number} [opts.cols=6]
   * @param {number} [opts.rows=5]
   * @param {number} [opts.seed]
   * @param {boolean} [opts.shuffle=true] false keeps every piece in its true
   *                                        position, so the board shows the
   *                                        whole photo assembled. The Easy
   *                                        game mode plays like that.
   */
  function Puzzle(photo, opts) {
    opts = opts || {};
    this.photo = photo;
    this.cols = opts.cols || 6;
    this.rows = opts.rows || 5;
    this.count = this.cols * this.rows;

    // Source resolution has to divide evenly so piece borders are integral.
    // srcH follows the design space's aspect, which is 4:3, so SRC_W being a
    // multiple of 20 is what keeps both halves whole.
    this.srcW = SRC_W;
    this.srcH = Math.round(SRC_W * (global.PhotoStage.DESIGN_H / global.PhotoStage.DESIGN_W));
    this.pieceSrcW = this.srcW / this.cols;
    this.pieceSrcH = this.srcH / this.rows;

    // Rendered at exactly srcW x srcH device pixels. It must NOT be scaled by
    // devicePixelRatio: every piece rectangle below is in these units, so on a
    // Retina screen a scaled source would make every piece sample the wrong
    // region of the photo.
    this.source = global.PhotoStage.renderTo(
      global.document.createElement('canvas'), photo, this.srcW, this.srcH, true
    );

    this.build(opts.shuffle === false ? false : opts.seed);
  }

  /**
   * Create the 30 pieces and place them across the board slots.
   * `seed === false` (the Easy mode) keeps pieces in their true positions, so
   * the board reads as the whole photo; any number shuffles them.
   */
  Puzzle.prototype.build = function (seed) {
    var noShuffle = seed === false;
    var rand = noShuffle ? null : rng(seed == null ? (Date.now() ^ (Math.random() * 1e9)) : seed);
    var pieces = [];
    var i;

    for (i = 0; i < this.count; i++) {
      var col = i % this.cols;
      var row = (i / this.cols) | 0;
      pieces.push({
        id: i,
        col: col,
        row: row,
        slot: -1,
        // true source rectangle, in source-canvas pixels
        sx: col * this.pieceSrcW,
        sy: row * this.pieceSrcH,
        sw: this.pieceSrcW,
        sh: this.pieceSrcH,
        // true neighbours in the assembled photo, by piece id (-1 = outside)
        nUp: row > 0 ? i - this.cols : -1,
        nDown: row < this.rows - 1 ? i + this.cols : -1,
        nLeft: col > 0 ? i - 1 : -1,
        nRight: col < this.cols - 1 ? i + 1 : -1
      });
    }

    // Fisher-Yates, then make sure nothing sits in its own correct place —
    // otherwise a piece occasionally gives the whole layout away for free.
    // Easy mode skips all of this: the pieces belong where they are.
    if (!noShuffle) {
      for (i = pieces.length - 1; i > 0; i--) {
        var j = (rand() * (i + 1)) | 0;
        var tmp = pieces[i]; pieces[i] = pieces[j]; pieces[j] = tmp;
      }
      for (i = 0; i < pieces.length; i++) {
        if (pieces[i].id !== i) continue;
        var partner = -1;
        for (var k = 0; k < pieces.length; k++) {
          if (k !== i && pieces[k].id === k) { partner = k; break; }
        }
        if (partner === -1) partner = (i + 1) % pieces.length;
        var t2 = pieces[i]; pieces[i] = pieces[partner]; pieces[partner] = t2;
      }
    }

    for (i = 0; i < pieces.length; i++) pieces[i].slot = i;

    this.pieces = pieces;                       // ordered by board slot
    this.byId = {};
    for (i = 0; i < pieces.length; i++) this.byId[pieces[i].id] = pieces[i];

    this.aspect = this.pieceSrcW / this.pieceSrcH;   // one piece's shape
    this.photoAspect = this.srcW / this.srcH;        // the whole photo's shape

    return this;
  };

  Puzzle.prototype.get = function (id) {
    return this.byId[id] || null;
  };

  /** Human label for a piece's true home, e.g. "R2 · C4". */
  Puzzle.prototype.label = function (piece) {
    return 'R' + (piece.row + 1) + ' · C' + (piece.col + 1);
  };

  /**
   * Paint one piece into a canvas sized cssW x cssH.
   * `fit` is 'cover' (fill the box, crop the overflow — used on the board)
   * or 'contain' (show the whole piece — used in the inspector).
   */
  Puzzle.prototype.paint = function (canvas, piece, cssW, cssH, fit) {
    var dpr = Math.min(global.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));

    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    var srcAspect = piece.sw / piece.sh;
    var dstAspect = canvas.width / canvas.height;
    var dx = 0, dy = 0, dw = canvas.width, dh = canvas.height;

    if (Math.abs(srcAspect - dstAspect) > 0.001) {
      if (fit === 'contain') {
        // scale down so the whole piece fits, letterboxing the short axis
        if (srcAspect > dstAspect) { dh = canvas.width / srcAspect; dy = (canvas.height - dh) / 2; }
        else                       { dw = canvas.height * srcAspect; dx = (canvas.width - dw) / 2; }
      } else {
        // scale up so the box is covered, overflowing (and hiding) the long axis
        if (srcAspect > dstAspect) { dw = canvas.height * srcAspect; dx = (canvas.width - dw) / 2; }
        else                       { dh = canvas.width / srcAspect; dy = (canvas.height - dh) / 2; }
      }
    }

    ctx.drawImage(this.source, piece.sx, piece.sy, piece.sw, piece.sh, dx, dy, dw, dh);
  };

  /** Convenience: build a canvas element for a piece. */
  Puzzle.prototype.canvasFor = function (piece, cssW, cssH, fit) {
    var c = global.document.createElement('canvas');
    this.paint(c, piece, cssW, cssH, fit || 'contain');
    return c;
  };

  /**
   * Build a full-photo canvas (used for the reveal card + thumbnails).
   */
  Puzzle.prototype.fullCanvas = function (cssW, cssH) {
    var dpr = Math.min(global.devicePixelRatio || 1, MAX_DPR);
    var c = global.document.createElement('canvas');
    c.width = Math.max(1, Math.round(cssW * dpr));
    c.height = Math.max(1, Math.round(cssH * dpr));
    var ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.source, 0, 0, c.width, c.height);
    return c;
  };

  global.Puzzle = Puzzle;

})(window);