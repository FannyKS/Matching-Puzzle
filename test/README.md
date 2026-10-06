# Tests

A browser suite for Photo Detective. No build step, no test framework — the
game is vanilla JS, so the tests drive the real page in real Chrome and read
the real DOM back.

```sh
./test/run-all.sh          # everything
./test/run.sh probe.html   # one page; prints what it reported
```

Needs `python3` and Chrome. Nothing else, and nothing installed.

## Why a browser

Most of what could break here is only visible in a browser: whether a card
really shows its own slice of the photo, whether an overlay is genuinely
closed, whether focus landed somewhere the host can type into, whether the
layout gives a canvas a real size to paint into. None of that survives being
tested through a stand-in.

So `probe.html` fetches `../index.html`, drops its markup into the page and
runs its four scripts in order. Every assertion is made against the shipped
DOM, the shipped CSS and the shipped module code. There is no second copy of
the markup to drift.

The one thing stubbed is the folder picker: a browser only opens it from a
user gesture and will not return a handle to automation. The suite feeds the
library the same `File` objects a real directory selection would hand over —
real image bytes with `webkitRelativePath` set — so everything downstream of
the picker is the real code path.

## The pages

| Page | What it covers |
| --- | --- |
| `parsecheck.html` | Each script compiles, and so does each harness page. Catches the failure that makes every other page report nothing. |
| `probe.html` | The game: library folder, naming, face-down cards, slice accuracy, sharpness, a cache written by an older build, a photo swapped on disk, scoring, the reveal card, moving between photos, intel, strikes, ending a run, and the **Easy** mode (whole photo, reveal 12 pieces). |
| `play-through.html` | The host's loop, pressed the way a host presses it: photos from the folder, then **Game complete** twice round the library. |
| `memphobe.html` | A browser that refuses IndexedDB. Deletes `indexedDB` before `library.js` runs, then checks the photos still play and that the host is told they will be forgotten. |
| `real-photos.html` | The real `Photo Library/` folder in this project, not the fixtures. Diagnostic, not part of `run-all.sh`. |

`memphobe.html` deletes the global rather than mocking `storage()`. The point
is that `storage()` has to discover the problem by itself; a mock would only
prove the answer, not the detection.

`parsecheck.html` compiles the harness pages as well as the game's four
scripts. A missing brace in a test page makes every page look like it hangs,
and that costs a lot of time to diagnose by hand.

## What the deck is

The deck is the library folder, **shuffled** — `newRun()` runs the deck
through `shuffle()` rather than dealing photos in filename order, which would
give the game away. So `play-through.html` compares the deck as a *set* against
the folder, and then asserts the two-pass invariant: eight rounds of **Game
complete** deal each photo in the folder once per pass, in the same order both
times.

## Fixtures

`make-fixtures.py` writes four PNGs into `fixtures/Photo library/`, and
`run.sh` calls it before every run. They are generated, not committed.

Each one is a 6×5 grid of flat colour bands, matching the 30-card board, so
band *(col, row)* sits exactly where card *(col, row)* of the assembled photo
does. That is what lets `probe.html` prove a card shows the right slice:
sample one pixel, compare it to the band that piece belongs to. The palette
keeps every colour far enough apart to survive JPEG at q0.88 and the browser's
own scaling.

The folder is deliberately awkward — a top-level file, and two subfolders
holding two files with the same name — because that is the shape of a real
photo library and it is what the folder-derived naming has to cope with.

## How sharp are the cards

A card is one sixth of the photo, so a sixth of the stored photo has to cover
the card's own pixels. The board is at most 1560 CSS px wide, making a card
about 180 CSS px — 360 device px on a 2x screen. So the source the pieces are
cut from is 2700 across, which is 450 per card: sharp outright at 2x. It has
to be a multiple of 20, or `srcW / 6` and `srcH / 5` stop being whole and the
seams show.

`probe.html` asserts that as a budget, in numbers rather than by eye:

- `srcW % cols == 0` and `srcH % rows == 0` — the pieces are whole.
- `srcW >= 6 * 360` — one card's worth of pixels at 2x, with room to spare.
- each card's canvas is backed at `min(devicePixelRatio, 3)`, so the browser is
  not scaling a small bitmap up to the card.
- the cached record's `edge` equals `Puzzle.srcW`, and the record never stores
  more pixels than the puzzle renders.

Two sections cover what happens to a library that predates that budget:

- **a library cached too small** writes an old-style record (`edge` below the
  current budget, small pixel counts) straight into IndexedDB, rescans, and
  checks the photo is re-baked at the current size — with the host's rename and
  alias surviving, since a name belongs to the host and not to the pixels.
- **a photo replaced on disk** puts different bytes at the same path, which is
  what dropping a larger version of a soft photo into the folder looks like.
  The scan has to notice (it compares the file's size) and re-read it, and a
  second scan of the untouched folder has to be a no-op.

The fixtures stay 480×400. They exist to prove slice identity — which band
lands on which card — not resolution, and making them big enough would not test
anything more.

## Your own photos

`real-photos.html` imports the real `Photo Library/` folder rather than the
fixtures, and checks that every photo comes through playable and cuts into
cards. There is no directory listing over HTTP, so the filenames come from a
generated file:

```sh
python3 test/list-photos.py      # rewrites real-photos.names.js
./test/run.sh real-photos.html 180
```

It asserts nothing about which photos exist or what they are called — the
folder is the user's — only that all of them work. Run it after adding photos.

A small photo cannot be made sharp by any of this. If a photo is 400 px across,
a sixth of it is 66 px, and a 180 CSS px card shows those 66 px whatever the
pipeline does. Bigger source files are the only fix.

## Easy mode

There are two game modes, chosen from the start screen:

- **Advanced** — the original game. The 30 cards are scrambled; players flip
  cards and use the inspector to piece the photo together.
- **Easy** — the same photo cut into the same 30 pieces, but every piece sits
  where it belongs, so the board reads as the whole photo. Clicking a piece
  reveals it in place (no inspector window). At most **12** pieces may be
  revealed; after that the board asks the players to name the photo. Everything
  from **Game complete** onward — the reveal card, the scorecard, next game,
  same photo, choosing another — is identical to Advanced mode.

In Easy mode the puzzle is built with `shuffle: false`, so
`puzzle.pieces[i].id === i` — that is what `probe.html` asserts the board is
whole. The reveal budget is per round (`state.seen`, cleared each round), not
the whole-run `state.inspected` tally.

## Adding a check

Assertions are one line each and say what is true, not what code ran:

```js
ok(q('.overlay:not([hidden])').length === 0, 'no overlay left open');
```

Two traps, both of which have bitten this suite:

- **Do not wait on a counter to mean the board has re-rendered.** `seen`
  clears before the cards are rebuilt, so a counter-based wait resolves while
  the *previous* round is still on screen and the next assertion reads the
  old DOM. `waitForRound()` waits on card node identity instead.
- **A button that does not name the next photo cannot be checked by its label.**
  The reveal card says only "Next game" — the players are reading it too — so
  `waitForNewRound(previousTitle)` waits for any *other* photo to be dealt.
  Read `previousTitle` before the click; the deal can land immediately.
- **`var` does not cross `.then` callbacks.** Each step is its own function
  scope. Shared values are declared at the top of the file.
- **A throw inside a `toBlob`/`File` callback leaves the promise pending.** The
  exception is swallowed and the suite just times out with nothing to go on.
  Check for the null and `reject()` instead.