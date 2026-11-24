// ALR Grading — recognise a card from a photo (desktop app only).
// 1. Crop the card using the centering guides' card-edge lines.
// 2. Read printed text with Tesseract (bundled, runs offline): the name band at the top, the
//    middle band (Yu-Gi-Oh! set code) and the bottom band (One Piece and Pokémon numbers).
// 3. Look the card up: One Piece by number, Yu-Gi-Oh! by set code, Pokémon by name + number.
// 4. Rank the matches by how closely their official artwork resembles the photo (a small
//    picture fingerprint), which tells regular and alternate-art printings apart.
// The user always confirms the match; nothing is applied silently.
(function () {
  var worker = null, ready = null;
  function base(path) { return new URL(path, location.href).href; }
  function getWorker() {
    if (ready) return ready;
    ready = window.Tesseract.createWorker('eng', 1, {
      workerPath: base('vendor/tesseract/worker.min.js'),
      corePath: base('vendor/tesseract/'),
      langPath: base('vendor/tesseract/'),
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'none'
    }).then(function (w) { worker = w; return w; });
    ready.catch(function () { ready = null; });
    return ready;
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image')); };
      img.src = src;
    });
  }
  // The card itself (inside the card-edge guides), at a fixed size.
  function cropCard(img, outer) {
    var o = outer || { l: 0, r: 1, t: 0, b: 1 };
    var sx = o.l * img.naturalWidth, sy = o.t * img.naturalHeight;
    var sw = (o.r - o.l) * img.naturalWidth, sh = (o.b - o.t) * img.naturalHeight;
    // keep the photo's own detail (up to 1600 px across); small print needs every pixel
    var w = Math.round(Math.min(1600, Math.max(900, sw))), c = document.createElement('canvas');
    c.width = w; c.height = Math.round(w * sh / sw);
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  // A region of the card (fractions of its width/height), enlarged and greyscaled for reading.
  function region(card, x0, y0, x1, y1, scale) {
    var sx = Math.round(card.width * x0), sy = Math.round(card.height * y0);
    var sw = Math.round(card.width * (x1 - x0)), sh = Math.round(card.height * (y1 - y0)), c = document.createElement('canvas');
    c.width = sw * scale; c.height = sh * scale;
    var ctx = c.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.5)';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(card, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  // Where each game prints its name and number (fractions of the card).
  var REGIONS = [
    { key: 'top', box: [0.04, 0.025, 0.96, 0.12], scale: 2, psm: '6' },               // name (Pokémon, Yu-Gi-Oh!)
    { key: 'bottom', box: [0.04, 0.82, 0.96, 0.97], scale: 2, psm: '6' },             // name bar (One Piece)
    { key: 'code', box: [0.5, 0.88, 0.99, 0.99], scale: 4, psm: '11', codes: true },  // One Piece number, Pokémon number
    { key: 'codeL', box: [0.01, 0.88, 0.5, 0.99], scale: 4, psm: '11', codes: true }, // Pokémon number (older cards)
    { key: 'set', box: [0.5, 0.69, 0.99, 0.79], scale: 4, psm: '11', codes: true }    // Yu-Gi-Oh! set code
  ];

  // ── what the text says ────────────────────────────────────────────────────
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  // 0..1: how alike two names are (1 = identical), allowing for misread letters.
  function similar(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) { d[i] = [i]; }
    for (j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return 1 - d[m][n] / Math.max(m, n);
  }
  function fixDigits(s) { return s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8'); }
  // Readable lines that look like a card name: mostly letters, 3–40 characters.
  function nameCandidates(text) {
    return text.split('\n').map(function (l) {
      return l.replace(/[^A-Za-z .'&:-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
        .filter(function (w) { return w.length > 1 || /^[A-Z]$/.test(w); }).join(' ');
    }).filter(function (l) {
      var letters = l.replace(/[^A-Za-z]/g, '').length;
      return letters >= 3 && l.length <= 40 && !/^(ATK|DEF|HP|LV)\b/i.test(l);
    }).slice(0, 4);
  }
  function parse(top, mid, bottom) {
    var all = (top + '\n' + mid + '\n' + bottom).replace(/[‐-―]/g, '-');
    var out = { game: null, code: null, number: null, total: null, name: null };
    function vote(re, make) {
      var count = {}, m, bestK = null, bestN = 0;
      re.lastIndex = 0;
      while ((m = re.exec(all))) { var k = make(m); if (k) { count[k] = (count[k] || 0) + 1; if (count[k] > bestN) { bestN = count[k]; bestK = k; } } }
      return bestK;
    }
    var opCode = vote(/\b(OP|0P|ST|EB|PRB)\s*-?\s*([0-9OoIl]{2})\s*-\s*([0-9OoIlSB]{3})\b/gi, function (m) {
      return m[1].toUpperCase().replace('0P', 'OP') + fixDigits(m[2]) + '-' + fixDigits(m[3]);
    }) || vote(/\bP\s*-\s*([0-9OoIl]{3})\b/g, function (m) { return 'P-' + fixDigits(m[1]); });
    if (opCode) { out.game = 'one-piece'; out.code = opCode; }
    var yg = !out.game && /\b([A-Z0-9]{3,4})-(EN|DE|FR|IT|SP|PT|E)?([0-9OoIl]{3})\b/.exec(mid + '\n' + bottom);
    if (yg && /[A-Z]/.test(yg[1])) { out.game = 'yugioh'; out.code = yg[1] + '-' + (yg[2] || 'EN') + fixDigits(yg[3]); }
    var pkv = !out.game && vote(/\b([0-9OoIl]{1,3})\s*\/\s*([0-9OoIl]{2,3})\b/g, function (m) {
      var a = Number(fixDigits(m[1])), b = Number(fixDigits(m[2]));
      return a > 0 && b >= 10 && a <= b + 60 ? a + '/' + b : null;      // secret rares go a bit past the set size
    });
    if (pkv) { out.game = 'pokemon'; out.number = pkv.split('/')[0]; out.total = pkv.split('/')[1]; }
    out.names = nameCandidates(top);
    out.name = out.names[0] || null;
    return out;
  }

  // ── looking it up ─────────────────────────────────────────────────────────
  function G() { return window.ALRGraded; }
  function lookup(read, hint) {
    var game = read.game || hint;
    if (read.game === 'one-piece' && read.code) return G().search('one-piece', read.code).then(function (items) { return { game: game, items: items }; });
    if (read.game === 'yugioh' && read.code) {
      return fetch('https://db.ygoprodeck.com/api/v7/cardsetsinfo.php?setcode=' + encodeURIComponent(read.code)).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (info) {
          var name = info && info.name;
          if (!name) return name ? [] : (read.name ? G().search('yugioh', read.name) : []);
          return G().search('yugioh', name).then(function (items) {
            var exact = items.filter(function (it) { return it.name.toLowerCase() === name.toLowerCase(); });
            (exact.length ? exact : items).forEach(function (it) { it.preferCode = read.code; });
            return exact.length ? exact : items;
          });
        }).then(function (items) { return { game: 'yugioh', items: items }; });
    }
    if (read.game === 'pokemon' && read.number) {
      // number + set size ("4/102") is printed clearly and narrows it to a handful; names
      // that match the text read from the top come first
      var q = 'number:' + read.number + (read.total ? ' set.printedTotal:' + read.total : '');
      return G().getJSON('https://api.pokemontcg.io/v2/cards?q=' + encodeURIComponent(q) + '&pageSize=40&select=id,name', 5).then(function (j) {
        var names = ((j && j.data) || []).map(function (c) { return c.name; }).filter(function (n, i, a) { return a.indexOf(n) === i; });
        var said = norm((read.names || []).join(' '));
        names.sort(function (a, b) { return (said.indexOf(norm(b)) >= 0) - (said.indexOf(norm(a)) >= 0); });
        return names.slice(0, 3).reduce(function (p, n) {
          return p.then(function (acc) { return G().search('pokemon', n + ' ' + read.number).catch(function () { return []; }).then(function (l) { return acc.concat(l); }); });
        }, Promise.resolve([]));
      }).then(function (items) { return { game: 'pokemon', items: items }; });
    }
    return byName(read, game, hint);
  }
  // No number recognised (tiny print, foil, glare): use the name. The reader often gets a
    // letter or two wrong ("Trefelgar Law"), so each word is searched on its own and results are
    // kept when their name is close to what was read; the artwork comparison then picks the
    // exact printing from them.
  // The whole One Piece list (about 4,400 printings, 3 MB), fetched once when it's needed.
  var opIndex = null;
  function loadOnePiece() {
    if (opIndex) return opIndex;
    opIndex = Promise.all(['allSetCards', 'allSTCards'].map(function (e) {
      return G().getJSON('https://optcgapi.com/api/' + e + '/', 3).catch(function () { return []; });
    })).then(function (lists) {
      var items = [].concat.apply([], lists.map(function (l) { return Array.isArray(l) ? l : []; })).map(G().opItem);
      var byName = {};
      items.forEach(function (it) { (byName[it.name] = byName[it.name] || []).push(it); });
      return { items: items, names: Object.keys(byName), byName: byName };
    });
    opIndex.catch(function () { opIndex = null; });
    return opIndex;
  }
  function onePieceByName(names) {
    return loadOnePiece().then(function (idx) {
      var scored = idx.names.map(function (n) {
        var best = 0;
        names.forEach(function (c) { best = Math.max(best, similar(n, c)); });
        return [n, best];
      }).filter(function (x) { return x[1] >= 0.55; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3);
      var items = [];
      scored.forEach(function (x) { items = items.concat(idx.byName[x[0]]); });
      return items;
    });
  }
  function byName(read, game, hint) {
    var names = (read.names || []).filter(function (n) { return norm(n).length >= 4; }).slice(0, 8);
    if (!names.length) return Promise.resolve({ game: game, items: [] });
    var order = ['one-piece', 'pokemon', 'yugioh'].sort(function (a, b) { return (b === (read.game || hint)) - (a === (read.game || hint)); });
    // try every game and keep the one whose card name is closest to what was read
    return order.reduce(function (p, gm) {
      return p.then(function (acc) {
        return oneGame(gm).then(function (r) { if (r) acc.push(r); return acc; });
      });
    }, Promise.resolve([])).then(function (results) {
      results.sort(function (a, b) { return b.score - a.score; });
      return results[0] || { game: game, items: [] };
    });
    function oneGame(gm) {
      return Promise.resolve(null).then(function () {
        if (gm === 'one-piece') {
          return onePieceByName(names).then(function (items) {
            if (!items.length) return null;
            var sc = 0; items.forEach(function (it) { names.forEach(function (n) { sc = Math.max(sc, similar(it.name, n)); }); });
            return { game: gm, items: items, score: sc };
          });
        }
        // Pokémon: if a set size was read ("/102"), search the name within sets of that size too,
        // so older printings aren't crowded out by newer ones even when the number was misread.
        var extra = gm === 'pokemon' && read.total && G().pokemonQuery
          ? Promise.all(names.slice(0, 3).map(function (n) {
              var w = n.split(' ').sort(function (a, b) { return b.length - a.length; })[0].replace(/["\\]/g, '');
              return w.length >= 4 ? G().pokemonQuery('name:"' + w + '*" set.printedTotal:' + read.total).catch(function () { return []; }) : [];
            })).then(function (l) { return [].concat.apply([], l); })
          : Promise.resolve([]);
        var queries = [];
        names.forEach(function (n) {
          queries.push(n);
          n.split(' ').filter(function (w) { return w.replace(/[^A-Za-z]/g, '').length >= 3; })
            .sort(function (a, b) { return b.length - a.length; }).forEach(function (w) { if (queries.indexOf(w) < 0) queries.push(w); });
        });
        return queries.slice(0, 6).reduce(function (q, term) {
          return q.then(function (acc) {
            return G().search(gm, term).catch(function () { return []; }).then(function (items) { return acc.concat(items); });
          });
        }, extra).then(function (items) {
          var seen = {}, close = [];
          items.forEach(function (it) {
            var key = (it.img || '') + '|' + it.title + '|' + it.sub;
            if (seen[key]) return; seen[key] = 1;
            var best = 0;
            names.forEach(function (n) { best = Math.max(best, similar(it.name, n)); });
            if (best >= 0.72) { it.nameScore = best; close.push(it); }
          });
          if (!close.length) return null;
          var sc = 0; close.forEach(function (it) { sc = Math.max(sc, it.nameScore || 0); });
          return { game: gm, items: close, score: sc };
        });
      });
    }
  }

  // ── which printing: compare artwork fingerprints ──────────────────────────
  // Fingerprint of the middle of the card (where the artwork is; frames and layouts are shared
  // within a game): brightness pattern + a coarse colour grid.
  function fingerprint(source) {
    var w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
    var sx = w * 0.12, sy = h * 0.14, sw = w * 0.76, sh = h * 0.42;
    var c = document.createElement('canvas'); c.width = 17; c.height = 16;
    var ctx = c.getContext('2d'); ctx.filter = 'grayscale(1)';
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, 17, 16);
    var d = ctx.getImageData(0, 0, 17, 16).data, bits = [];
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) bits.push(d[(y * 17 + x) * 4] > d[(y * 17 + x + 1) * 4] ? 1 : 0);
    var k = document.createElement('canvas'); k.width = 4; k.height = 4;
    var kx = k.getContext('2d'); kx.drawImage(source, sx, sy, sw, sh, 0, 0, 4, 4);
    var col = Array.prototype.slice.call(kx.getImageData(0, 0, 4, 4).data).filter(function (_, i) { return i % 4 !== 3; });
    return { bits: bits, col: col };
  }
  function distance(a, b) {
    var n = 0, i;
    for (i = 0; i < a.bits.length; i++) if (a.bits[i] !== b.bits[i]) n++;
    var cd = 0;
    for (i = 0; i < a.col.length; i++) cd += Math.abs(a.col[i] - b.col[i]);
    return n + cd / 24;                       // colour adds up to ~100 for completely different art
  }
  // A small copy of a card image that the page is allowed to read (for the comparison).
  function thumb(src) {
    if (!src) return null;
    if (/^https:\/\/images\.pokemontcg\.io\//.test(src)) return src.replace('_hires.png', '.png');
    return 'https://images.weserv.nl/?url=' + encodeURIComponent(src.replace(/^https?:\/\//, '')) + '&w=120&output=jpg';
  }
  function rank(card, items) {
    var mine = fingerprint(card), pool = items.slice(0, 120), k = 0, d = new Array(pool.length);
    // a few at a time, so dozens of printings compare in a few seconds
    function next() {
      if (k >= pool.length) return Promise.resolve();
      var i = k++, it = pool[i], src = thumb(it.img || it.imgLarge);
      return (src ? loadImage(src).then(function (img) { d[i] = distance(mine, fingerprint(img)); }).catch(function () { d[i] = 999; }) : Promise.resolve(d[i] = 999)).then(next);
    }
    return Promise.all([next(), next(), next(), next(), next(), next()]).then(function () {
      pool.forEach(function (it, i) { it.match = d[i]; });
      pool.sort(function (a, b) { return a.match - b.match; });
      return pool.concat(items.slice(120));
    });
  }

  // identify(photo src, card-edge guides, game picked in the UI) -> { read, game, items }
  function identify(src, outer, hint) {
    if (!window.Tesseract) return Promise.reject(new Error('The text reader isn’t available.'));
    var card;
    return loadImage(src).then(function (img) {
      card = cropCard(img, outer);
      return getWorker();
    }).then(function (w) {
      // Tiny printed numbers read differently from pass to pass, so number areas are read three
      // ways (two sizes, two layout modes) and the answers are pooled for a vote.
      var texts = {}, passes = [];
      REGIONS.forEach(function (rg) {
        if (!rg.codes) { passes.push({ rg: rg, psm: rg.psm, scale: rg.scale }); return; }
        passes.push({ rg: rg, psm: '11', scale: rg.scale }, { rg: rg, psm: '11', scale: rg.scale + 2 }, { rg: rg, psm: '6', scale: rg.scale + 1 });
      });
      return passes.reduce(function (p, ps) {
        return p.then(function () {
          return w.setParameters({
            tessedit_pageseg_mode: ps.psm,
            tessedit_char_whitelist: ps.rg.codes ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/ ' : ''
          }).then(function () {
            var b = ps.rg.box;
            return w.recognize(region(card, b[0], b[1], b[2], b[3], ps.scale));
          }).then(function (r) { texts[ps.rg.key] = (texts[ps.rg.key] ? texts[ps.rg.key] + '\n' : '') + (r.data.text || ''); });
        });
      }, Promise.resolve()).then(function () { return texts; });
    }).then(function (t) {
      var read = parse(t.top, t.set, t.code + '\n' + t.codeL + '\n' + t.bottom);
      read.names = read.names.concat(nameCandidates(t.bottom)).slice(0, 6);
      read.raw = t;
      return lookup(read, hint).then(function (res) {
        return rank(card, res.items).then(function (items) {
          // A misread digit can point at the wrong card. If nothing found by number looks like
          // the photo, try the name too and let the artwork comparison decide.
          var best = items.length ? items[0].match : 999;
          if ((read.code || read.number) && best > 90) {
            return byName(read, res.game || hint, hint).then(function (more) {
              return rank(card, more.items).then(function (m2) {
                var all = items.concat(m2).sort(function (a, b) { return a.match - b.match; });
                return { read: read, game: (m2[0] && m2[0].match < best ? more.game : res.game), items: all };
              });
            });
          }
          return { read: read, game: res.game, items: items };
        });
      });
    });
  }

  window.ALRRecognize = { identify: identify, parse: parse };
})();
