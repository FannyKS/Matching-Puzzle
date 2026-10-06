/* ============================================================
   stage.js — the canvas every photo is drawn through.

   Photos come from the "Photo library" folder the host chooses, so
   there is no catalogue here any more. What is left is the part the
   rest of the game depends on: the design space every photo is
   composed in, and the one function that puts a photo into a canvas.

   A "photo" here is anything with a draw(ctx) that paints into a
   1000x750 space. library.js builds those from the host's files, and
   puzzle.js slices the result into cards.
   ============================================================ */

(function (global) {
  'use strict';

  var DW = 1000;   // design width
  var DH = 750;    // design height  (4:3)

  // Renders a photo into `canvas` at the given CSS pixel size and returns
  // it. Pass `exact` to render at exactly w x h device pixels, for callers
  // that use the canvas as a fixed-resolution bitmap to slice from (the
  // puzzle does -- a source scaled by devicePixelRatio would make every
  // card sample the wrong region of the photo).
  function renderTo(canvas, photo, cssW, cssH, exact) {
    var dpr = exact ? 1 : Math.min(global.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fit the 1000x750 design space into the target, letterboxed.
    var scale = Math.max(canvas.width / DW, canvas.height / DH);
    ctx.setTransform(scale, 0, 0, scale, (canvas.width - DW * scale) / 2, (canvas.height - DH * scale) / 2);
    ctx.save();
    try { photo.draw(ctx); } catch (err) {
      if (global.console) console.error('photo failed to draw:', photo.id, err);
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Callers keep drawing from this canvas afterwards (Puzzle.source).
    return canvas;
  }

  global.PhotoStage = {
    DESIGN_W: DW,
    DESIGN_H: DH,
    renderTo: renderTo
  };

})(window);