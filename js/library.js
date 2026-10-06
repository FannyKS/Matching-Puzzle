/* ============================================================
   library.js — the "Photo library" folder.

   The player points at a folder once. Every image inside is
   downscaled on import and cached in IndexedDB, so later runs need
   no folder access at all and work offline.

   Rescanning reconciles the cache against the folder. That is what
   makes the library dynamic: drop a new photo in and it appears,
   move one out and it is marked missing rather than deleted, move
   it back and it returns. Titles and aliases live in the cache
   rather than being read off the file, so files can be renamed,
   moved between subfolders, or shot straight off a camera without
   breaking the answer.

   The folder is the whole point: every photo the game plays comes
   from it. With nothing chosen yet there is simply no game, and the
   start button goes looking for the folder instead.
   ============================================================ */

(function (global) {
  'use strict';

  var DB_NAME = 'photo-detective';
  var DB_VERSION = 1;
  var STORE = 'photos';
  var META = 'meta';

  // Stored long edge, and the number the cards are judged against.
  //
  // A card is one sixth of the board, so one sixth of this has to cover the
  // card's own pixels or the photo is being enlarged and looks soft. The board
  // is at most 1560px wide, which makes a card about 180 CSS px -- 360 device
  // px on a 2x screen and 540 on a 3x one. Six of those is 2160 and 3240, so
  // 2700 is sharp on 2x screens with room to spare on 3x, and keeps a photo
  // small enough to cache cheaply. Puzzle.SRC_W must match this.
  var LONG_EDGE = 2700;
  var THUMB_W = 320;
  var THUMB_H = 240;
  var IMAGE_RE = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;

  var dbp = null;           // Promise<IDBDatabase>, may never settle
  var store = null;         // the storage in use, once chosen
  var storeReady = null;    // Promise<store>
  var records = {};         // id -> metadata record (blobs live in the store)
  var bitmaps = {};         // id -> decoded bitmap, kept only for the live round
  var folderName = '';
  var input = null;
  var busy = false;

  var listeners = [];
  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](snapshot()); } catch (e) { /* a listener must not break a scan */ }
    }
  }

  function snapshot() {
    var all = allRecords();
    var missing = all.filter(function (r) { return r.missing; });
    return {
      ready: all.length > 0,
      folder: folderName,
      // 'memory' means the photos play fine but will be forgotten on reload.
      storage: store ? store.kind : 'pending',
      cached: !!store && store.kind === 'indexeddb',
      total: all.length,
      present: all.length - missing.length,
      missing: missing.length,
      photos: all.filter(function (r) { return !r.missing; }),
      missingPhotos: missing
    };
  }

  function allRecords() {
    var out = [];
    for (var k in records) if (Object.prototype.hasOwnProperty.call(records, k)) out.push(records[k]);
    return out;
  }

  /* ============================================================
     Storage

     IndexedDB is the cache that lets the library survive a reload, but it is
     not something the game can afford to depend on: private windows refuse it
     outright, and some embedded and headless browsers accept open() and then
     never call back. Either way the library has to stay playable, so storage
     is raced against a short deadline and falls back to memory for the
     session. Nothing in here is allowed to block the game.
     ============================================================ */

  var STORE_TIMEOUT = 2500;

  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('This browser has no IndexedDB.')); return; }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'k' });
      };
      req.onsuccess = function () {
        var db = req.result;
        // Let a future schema change upgrade us instead of blocking on it.
        db.onversionchange = function () { try { db.close(); } catch (e) { /* closing anyway */ } };
        resolve(db);
      };
      req.onerror = function () { reject(req.error || new Error('Could not open the photo library store.')); };
      req.onblocked = function () { reject(new Error('Another tab is holding the photo library open.')); };
    });
    return dbp;
  }

  /** The same two operations as the IndexedDB store, held in memory for one session. */
  function memoryStore() {
    var data = {};
    function table(name) { return data[name] || (data[name] = {}); }
    function keyOf(name, value) { return name === META ? value.k : value.id; }
    return {
      kind: 'memory',
      getAll: function (name) {
        var t = table(name);
        return Promise.resolve(Object.keys(t).map(function (k) { return t[k]; }));
      },
      get: function (name, key) { return Promise.resolve(table(name)[key]); },
      put: function (name, value) { table(name)[keyOf(name, value)] = value; return Promise.resolve(); }
    };
  }

  function idbStore(db) {
    /** Reads settle when the request does; a read needs no waiting on the transaction. */
    function read(name, method, arg) {
      return new Promise(function (resolve, reject) {
        var req;
        try {
          var os = db.transaction(name, 'readonly').objectStore(name);
          req = arg === undefined ? os[method]() : os[method](arg);
        } catch (e) { reject(e); return; }
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('Could not read the photo library.')); };
      });
    }

    /** Writes settle when the whole transaction has landed, or has not landed at all. */
    function write(name, method, arg) {
      return new Promise(function (resolve, reject) {
        var t;
        try {
          t = db.transaction(name, 'readwrite');
          var os = t.objectStore(name);
          if (arg === undefined) os[method](); else os[method](arg);
        } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error || new Error('Could not save to the photo library.')); };
        t.onabort = function () { reject(t.error || new Error('Saving was aborted.')); };
      });
    }

    return {
      kind: 'indexeddb',
      getAll: function (name) { return read(name, 'getAll'); },
      get: function (name, key) { return read(name, 'get', key); },
      put: function (name, value) { return write(name, 'put', value); }
    };
  }

  /** Resolve to whichever store answers first. Never rejects. */
  function storage() {
    if (storeReady) return storeReady;
    storeReady = new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve(memoryStore());
      }, STORE_TIMEOUT);

      openDb().then(function (db) {
        if (settled) { try { db.close(); } catch (e) { /* going with memory */ } return; }
        settled = true;
        clearTimeout(timer);
        resolve(idbStore(db));
      }, function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(memoryStore());
      });
    }).then(function (s) { store = s; return s; });
    return storeReady;
  }

  function put(name, value) { return storage().then(function (s) { return s.put(name, value); }); }
  function getAll(name) { return storage().then(function (s) { return s.getAll(name); }); }
  function get(name, key) { return storage().then(function (s) { return s.get(name, key); }); }

  function loadMeta() {
    return getAll(META).then(function (rows) {
      rows.forEach(function (r) {
        if (r.k === 'folder') folderName = r.v || '';
      });
    }).catch(function () { /* a missing meta row just means no folder chosen yet */ });
  }

  /* ============================================================
     Decoding and downscaling
     ============================================================ */

  function decode(blobOrFile) {
    if (global.createImageBitmap) {
      return createImageBitmap(blobOrFile).catch(function () { return decodeViaImg(blobOrFile); });
    }
    return decodeViaImg(blobOrFile);
  }

  function decodeViaImg(blobOrFile) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blobOrFile);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That image could not be decoded.')); };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    if (canvas.toBlob) {
      return new Promise(function (resolve) { canvas.toBlob(resolve, type, quality); });
    }
    // Very old Safari: fall back to a data URL, wrapped so callers see a Blob.
    return dataUrlToBlob(canvas.toDataURL(type, quality));
  }

  function dataUrlToBlob(dataUrl) {
    var comma = dataUrl.indexOf(',');
    var head = dataUrl.slice(0, comma);
    var body = atob(dataUrl.slice(comma + 1));
    var mime = /:(.*?);/.exec(head)[1];
    var bytes = new Uint8Array(body.length);
    for (var i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  /**
   * Shrink to LONG_EDGE and re-encode, so a 12 MP original costs a few hundred
   * KB instead of four. `edge` is stamped on the result so a cache written by
   * an older, smaller setting can be spotted and re-baked rather than being
   * kept forever at the size it happened to be saved at.
   */
  function bake(source) {
    var iw = source.width, ih = source.height;
    var scale = Math.min(1, LONG_EDGE / Math.max(iw, ih));
    var w = Math.max(1, Math.round(iw * scale));
    var h = Math.max(1, Math.round(ih * scale));

    var full = document.createElement('canvas');
    full.width = w; full.height = h;
    var fctx = full.getContext('2d');
    // The whole point of this canvas is detail, and the default filter is
    // bilinear: on a 3x downscale that throws away fine texture.
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(source, 0, 0, w, h);

    var thumb = document.createElement('canvas');
    thumb.width = THUMB_W; thumb.height = THUMB_H;
    var tctx = thumb.getContext('2d');
    var tscale = Math.max(THUMB_W / w, THUMB_H / h);
    var tw = w * tscale, th = h * tscale;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(full, (THUMB_W - tw) / 2, (THUMB_H - th) / 2, tw, th);

    return canvasToBlob(full, 'image/jpeg', 0.88).then(function (blob) {
      return {
        blob: blob,
        w: w, h: h,
        edge: LONG_EDGE,
        thumb: thumb.toDataURL('image/jpeg', 0.72)
      };
    });
  }

  /* ============================================================
     Names
     ============================================================ */

  function stemOf(fileName) {
    return String(fileName || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function folderOf(path) {
    var parts = String(path || '').split('/');
    parts.pop();
    return parts.join(' › ');
  }

  /** Stable id from the path inside the library, so a rename reads as a change. */
  function idFor(path) {
    var s = String(path || '').toLowerCase();
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return 'p' + h.toString(36) + '-' + s.length.toString(36);
  }

  function answersFor(rec) {
    var out = [];
    var custom = (rec.aliases || []).filter(function (a) { return !!String(a).trim(); });

    // The title is always a legal way in. Aliases only ever add to it, so
    // filling in an alternate spelling can never lock out the real answer.
    if (rec.title) out.push(rec.title);
    custom.forEach(function (a) {
      var t = String(a).trim();
      if (out.every(function (x) { return x.toLowerCase() !== t.toLowerCase(); })) out.push(t);
    });

    // Likewise the raw file stem, so a photo whose name was never filled in is
    // still winnable.
    var stem = stemOf(rec.name);
    if (stem && out.every(function (a) { return a.toLowerCase() !== stem.toLowerCase(); })) out.push(stem);

    return out.length ? out : ['unknown photo'];
  }

  /* ============================================================
     Import and reconcile
     ============================================================ */

  /**
   * Reconcile the cache against a set of files from the library folder.
   * New files are baked and added; files that have been renamed or moved
   * away are marked missing, never deleted, so moving a photo out and back
   * restores it intact.
   *
   * `items` may be File objects or `{ file, path }` pairs — dropped folders
   * only carry their structure on the entry walker, not on the File.
   */
  function importFiles(items, onProgress) {
    if (busy) return Promise.resolve(snapshot());
    busy = true;

    var incoming = [];
    items.forEach(function (item) {
      var f = item && item.file ? item.file : item;
      if (!f || !IMAGE_RE.test(f.name)) return;
      var path = item && item.file ? item.path : (f.webkitRelativePath || f.name);
      var parts = String(path || f.name).split('/');
      // Drop the chosen folder's own name so records are folder-independent.
      if (parts.length > 1 && !item.file) parts.shift();
      path = parts.join('/');
      incoming.push({ file: f, path: path, name: f.name });
    });

    var added = 0, updated = 0, sharpened = 0, replaced = 0;

    var chain = incoming.reduce(function (p, item) {
      return p.then(function () {
        return importOne(item).then(function (what) {
          if (what === 'added') added++;
          else if (what === 'updated') updated++;
          else if (what === 'sharpened') sharpened++;
          else if (what === 'replaced') replaced++;
          if (onProgress) {
            onProgress({ done: added + updated + sharpened + replaced, total: incoming.length });
          }
        });
      });
    }, Promise.resolve());

    var folder = folderNameFrom(items);

    return chain
      .then(function () {
        if (folder && folder !== folderName) {
          folderName = folder;
          return put(META, { k: 'folder', v: folder });
        }
      })
      .then(function () {
        var seen = {};
        incoming.forEach(function (i) { seen[idFor(i.path)] = true; });
        allRecords().forEach(function (r) {
          var gone = !seen[r.id];
          if (gone !== !!r.missing) { r.missing = gone; put(STORE, r); }
        });
      })
      .then(disambiguate)
      .then(function () {
        busy = false;
        emit();
        return {
          added: added,
          updated: updated,
          sharpened: sharpened,
          replaced: replaced,
          skipped: incoming.length - added - updated - sharpened - replaced,
          total: incoming.length
        };
      })
      .catch(function (err) {
        busy = false;
        emit();
        throw err;
      });
  }

  function folderNameFrom(items) {
    for (var i = 0; i < items.length; i++) {
      var rel = items[i] && items[i].webkitRelativePath;
      if (rel && rel.indexOf('/') !== -1) return rel.split('/')[0];
    }
    return '';
  }

  /**
   * Two photos called "Beach.jpg" in different subfolders would both answer to
   * "beach", which makes the game unwinnable. The first keeps the plain name
   * and the others gain the folder they live in: "2023 › Beach".
   *
   * A name the host typed by hand is never touched — if they want two photos
   * to share an answer, that is their call.
   */
  function disambiguate() {
    var rows = allRecords().filter(function (r) { return !r.missing; });
    var counts = {};
    rows.forEach(function (r) {
      var k = r.title.toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
    });

    var claimed = {};
    rows.forEach(function (r) {
      var k = r.title.toLowerCase();
      if (counts[k] < 2 || r.custom) return;
      if (!claimed.hasOwnProperty(k)) { claimed[k] = r.title; return; }

      var base = (r.folder ? r.folder + ' › ' : '') + r.title;
      var next = base;
      var n = 2;
      while (Object.keys(claimed).some(function (c) { return claimed[c].toLowerCase() === next.toLowerCase(); })) {
        next = base + ' ' + n++;
      }
      claimed[k.toLowerCase()] = next;
      r.title = next;
      put(STORE, r);
    });
  }

  function importOne(item) {
    var id = idFor(item.path);
    var existing = records[id];

    // A photo cached before the game wanted bigger cards is not "already at
    // the right size" -- it is the reason the cards look soft. The file is in
    // hand during a scan, so re-baking is how an old library gets sharp.
    var stale = !!existing && (existing.edge || 0) < LONG_EDGE;

    // The same path can hold a different photo. Swapping in a larger version of
    // a soft one is the obvious way to fix softness, so a scan has to notice
    // that the file itself changed. Size is the tell: it is read straight off
    // the File the picker hands over, and a re-export of the same picture at a
    // higher resolution is a different number of bytes. (Not the timestamp --
    // a File built from a Blob has no modification time of its own, so that
    // would make every scan think every file had changed.)
    //
    // A record with no recorded size is one written before this was tracked, so
    // it is treated as changed: re-baking it once is how the size gets recorded.
    var replaced = !!existing && existing.size !== item.file.size;

    // Already cached, and the file is the same one: only the "missing" flag can
    // change.
    if (existing && !stale && !replaced) {
      if (existing.missing || existing.name !== item.name) {
        existing.missing = false;
        existing.name = item.name;
        existing.path = item.path;
        return put(STORE, existing).then(function () {
          records[id] = existing;
          return 'updated';
        });
      }
      return Promise.resolve('skipped');
    }

    return decode(item.file)
      .then(bake)
      .then(function (baked) {
        // Renames belong to the host, not to the file, so they survive a
        // re-bake; only the pixels are being replaced.
        var rec = existing || {
          id: id,
          title: stemOf(item.name) || 'Untitled',
          aliases: [],
          custom: false,
          added: Date.now()
        };
        rec.path = item.path;
        rec.name = item.name;
        rec.folder = folderOf(item.path);
        rec.w = baked.w;
        rec.h = baked.h;
        rec.edge = baked.edge;
        rec.blob = baked.blob;
        rec.thumb = baked.thumb;
        rec.missing = false;
        // How big the file on disk is, so the next scan can tell whether the
        // host has put a different photo in this one's place.
        rec.size = item.file.size;
        return put(STORE, rec).then(function () {
          records[id] = rec;
          if (stale) return 'sharpened';
          if (existing) return 'replaced';
          return 'added';
        });
      })
      .catch(function () {
        // One unreadable file must not abort the whole folder scan.
        return 'skipped';
      });
  }

  /* ============================================================
     Choosing a folder, and drag and drop
     ============================================================ */

  // Exactly one picker question can be outstanding at a time.
  var waiting = null;

  function ensureInput() {
    if (input) return input;
    input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.className = 'sr-only';
    document.body.appendChild(input);

    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      var ask = waiting;
      waiting = null;
      if (ask) ask.settle(files);
      else if (files.length) importFiles(files, null);
    });
    return input;
  }

  /**
   * Open the folder picker. It can only be opened from a user gesture, so
   * "rescan" means the host re-picks the same folder — which is what a browser
   * will allow, and is all the game needs to notice added or moved files.
   *
   * Dismissing the dialog fires no event at all, so the window regaining focus
   * is used to notice that nothing came back.
   */
  function askForFolder() {
    ensureInput();
    return new Promise(function (resolve, reject) {
      var ask = {
        settle: function (files) {
          if (!files.length) { reject(new Error('No folder was chosen.')); return; }
          importFiles(files, null).then(resolve, reject);
        }
      };
      waiting = ask;

      global.addEventListener('focus', function () {
        setTimeout(function () {
          if (waiting !== ask) return;      // a selection arrived instead
          waiting = null;
          reject(new Error('No folder was chosen.'));
        }, 350);
      }, { once: true });

      try { input.click(); }
      catch (e) { waiting = null; reject(e); }
    });
  }

  /** Accept a drop of either loose images or whole folders. */
  function readDrop(dataTransfer) {
    var items = (dataTransfer && dataTransfer.items) || [];
    var jobs = [];

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind !== 'file') continue;
      var entry = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      if (entry) {
        jobs.push(walkEntry(entry));
      } else if (it.getAsFile) {
        jobs.push(Promise.resolve([{ file: it.getAsFile(), path: it.getAsFile() ? it.getAsFile().name : '' }]));
      }
    }

    if (!jobs.length && dataTransfer && dataTransfer.files && dataTransfer.files.length) {
      jobs.push(Promise.resolve(Array.prototype.map.call(dataTransfer.files, function (f) {
        return { file: f, path: f.webkitRelativePath || f.name };
      })));
    }

    return Promise.all(jobs).then(function (parts) {
      var flat = [];
      parts.forEach(function (list) { list.forEach(function (x) { flat.push(x); }); });
      return importFiles(flat, null);
    });
  }

  function walkEntry(entry, prefix) {
    prefix = prefix || '';
    if (entry.isFile) {
      if (!IMAGE_RE.test(entry.name)) return Promise.resolve([]);
      return new Promise(function (resolve) {
        entry.file(function (f) {
          resolve([{ file: f, path: prefix + entry.name }]);
        }, function () { resolve([]); });
      });
    }
    if (entry.isDirectory) {
      return readDir(entry).then(function (kids) {
        return kids.map(function (k) {
          return { file: k.file, path: prefix + entry.name + '/' + k.path };
        });
      });
    }
    return Promise.resolve([]);
  }

  // Chrome hands back at most 100 entries per read, so keep reading until empty.
  function readDir(dir) {
    return new Promise(function (resolve) {
      var out = [];
      (function again() {
        var reader = dir.createReader();
        reader.readEntries(function (entries) {
          if (!entries.length) { resolve(out); return; }
          var i = 0;
          (function step() {
            if (i >= entries.length) { again(); return; }
            var e = entries[i++];
            walkEntry(e).then(function (found) {
              found.forEach(function (f) { out.push(f); });
              step();
            }, step);
          })();
        }, function () { resolve(out); });
      })();
    });
  }

  /* ============================================================
     Loading photos for play
     ============================================================ */

  /** Decode the bitmap for a record, reusing the live one. */
  function bitmapFor(id) {
    if (bitmaps[id]) return Promise.resolve(bitmaps[id]);
    if (!records[id]) return Promise.reject(new Error('That photo is no longer in the library.'));
    return get(STORE, id).then(function (row) {
      if (!row || !row.blob) throw new Error('That photo has no cached image.');
      return decode(row.blob);
    }).then(function (bmp) {
      bitmaps[id] = bmp;
      return bmp;
    });
  }

  /** Release every bitmap except the ids still in play. */
  function releaseOthers(keepIds) {
    Object.keys(bitmaps).forEach(function (id) {
      if (keepIds.indexOf(id) !== -1) return;
      var bmp = bitmaps[id];
      if (bmp && typeof bmp.close === 'function') { try { bmp.close(); } catch (e) { /* already gone */ } }
      delete bitmaps[id];
    });
  }

  function closeAll() {
    releaseOthers([]);
  }

  /** Wrap a record in the draw contract puzzle.js expects. */
  function defFor(rec, bmp) {
    var DW = global.PhotoStage.DESIGN_W;
    var DH = global.PhotoStage.DESIGN_H;
    return {
      id: rec.id,
      title: rec.title,
      category: rec.folder || 'Photo library',
      answers: answersFor(rec),
      // The photo's own size. A card is a sixth of this, so it is what says
      // whether the cards can be sharp at all.
      pixelWidth: bmp ? bmp.width : 0,
      pixelHeight: bmp ? bmp.height : 0,
      draw: function (ctx) {
        if (!bmp) { ctx.fillStyle = '#0d1119'; ctx.fillRect(0, 0, DW, DH); return; }
        // Cover-fit into the design space, so the photo fills the 4:3 frame
        // instead of arriving with its own letterbox baked in.
        var scale = Math.max(DW / bmp.width, DH / bmp.height);
        var w = bmp.width * scale, h = bmp.height * scale;
        ctx.drawImage(bmp, (DW - w) / 2, (DH - h) / 2, w, h);
      }
    };
  }

  /** A deck entry: cheap to hold, decodes only when the round starts. */
  function entryFor(rec) {
    return {
      kind: 'library',
      id: rec.id,
      title: rec.title,
      category: rec.folder || 'Photo library',
      thumb: rec.thumb,
      answers: answersFor(rec),
      load: function () {
        return bitmapFor(rec.id).then(function (bmp) { return defFor(rec, bmp); });
      }
    };
  }

  /* ============================================================
     Editing titles
     ============================================================ */

  /** Everything the rename dialog needs, without the image blob. */
  function details(id) {
    var rec = records[id];
    if (!rec) return null;
    return {
      id: rec.id,
      title: rec.title,
      aliases: (rec.aliases || []).slice(),
      folder: rec.folder || '',
      path: rec.path,
      thumb: rec.thumb,
      custom: !!rec.custom,
      missing: !!rec.missing
    };
  }

  function saveEdit(id, title, aliasesCsv) {
    var rec = records[id];
    if (!rec) return Promise.reject(new Error('That photo is not in the library.'));
    var t = String(title || '').trim();
    if (!t) return Promise.reject(new Error('Give the photo a name.'));
    var aliases = String(aliasesCsv || '')
      .split(',')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    rec.title = t;
    rec.aliases = aliases;
    rec.custom = true;
    return put(STORE, rec).then(function () { emit(); return rec; });
  }

  /* ============================================================
     Public API
     ============================================================ */

  var api = {
    FOLDER_LABEL: 'Photo library',

    init: function () {
      return storage()
        .then(loadMeta)
        .then(function () { return getAll(STORE); })
        .then(function (rows) {
          records = {};
          rows.forEach(function (r) { records[r.id] = r; });
          emit();
          return snapshot();
        })
        .catch(function () {
          // Nothing readable. The host still needs to choose a folder, so the
          // empty state is what the game carries on with.
          emit();
          return snapshot();
        });
    },

    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    state: snapshot,

    /* Both open the picker; browsers only allow that from a user gesture, so a
       rescan means choosing the same folder again. */
    pickFolder: askForFolder,
    rescan: askForFolder,
    readDrop: readDrop,
    importFiles: importFiles,

    /** All present photos, in a stable play order. */
    present: function () {
      return allRecords()
        .filter(function (r) { return !r.missing; })
        .sort(function (a, b) {
          return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
        })
        .map(entryFor);
    },

    find: function (id) {
      var rec = records[id];
      return rec ? entryFor(rec) : null;
    },

    details: details,
    rename: saveEdit,
    releaseOthers: releaseOthers,
    closeAll: closeAll,
    isBusy: function () { return busy; }
  };

  global.PhotoLibrary = api;

})(window);
