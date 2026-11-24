// ALR Grading — Pre-grade (desktop app only; not part of the website).
// Measure centering on front/back photos, rate corners, edges and surface, and get sub-grades and
// an estimated grade for PSA, TAG, Beckett and CGC before sending a card off. Saved pre-grades get
// their own PRE-000001 numbers and show read-only on alrinitiative.com.
//
// All estimates are approximate and based on each company's published standards as we understand
// them; they are labelled as estimates everywhere.
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function G() { return window.ALRGraded; }

  // ── state ─────────────────────────────────────────────────────────────────
  function blankSide() { return { outer: { l: 0.03, r: 0.97, t: 0.025, b: 0.975 }, inner: { l: 0.075, r: 0.925, t: 0.06, b: 0.94 }, set: false }; }
  function blank() {
    return {
      id: null, cert: null, cert_no: null, dirty: false,
      card: { game: null, name: '', number: '', setName: '', printing: '', official: null },
      photos: { front: null, back: null },          // { data (data URL, new), blob, url (saved) }
      side: 'front', guides: { front: blankSide(), back: blankSide() },
      corners: { tl: 0, tr: 0, bl: 0, br: 0 },        // 0 sharp, 1 light wear, 2 worn
      edges: { t: 0, r: 0, b: 0, l: 0 },              // 0 clean, 1 minor, 2 chipped
      surface: { front: {}, back: {} },
      override: {},                                   // sub-grades typed in by hand
      notes: ''
    };
  }
  var S = blank(), lookup = { game: 'one-piece', items: [], busy: false };

  // ── centering maths ──────────────────────────────────────────────────────
  function shares(gd) {
    var o = gd.outer, i = gd.inner;
    var L = i.l - o.l, R = o.r - i.r, T = i.t - o.t, B = o.b - i.b;
    function pct(a, b) { return a + b <= 0 ? 50 : Math.round(a / (a + b) * 100); }
    return { lr: pct(L, R), tb: pct(T, B) };
  }
  function ratioText(p) { return p + '/' + (100 - p); }
  function worst(gd) { var s = shares(gd); return Math.max(s.lr, 100 - s.lr, s.tb, 100 - s.tb); }
  // [grade, worst front %, worst back %] — approximate published centering standards.
  var PSA_CENTER = [[10, 55, 75], [9, 60, 90], [8, 65, 90], [7, 70, 90], [6, 80, 90], [5, 85, 90], [4, 101, 101]];
  var BGS_CENTER = [[10, 50.5, 55], [9.5, 55, 60], [9, 60, 80], [8.5, 62.5, 85], [8, 65, 90], [7, 70, 95], [6, 101, 101]];
  function capFrom(table, f, b) { for (var k = 0; k < table.length; k++) if (f <= table[k][1] && b <= table[k][2]) return table[k][0]; return table[table.length - 1][0]; }
  function floorHalf(x) { return Math.floor(x * 2) / 2; }
  function fmt(x) { return x == null ? '—' : (Math.round(x * 2) / 2).toString(); }

  // ── sub-grades + estimates ───────────────────────────────────────────────
  var SURF = {
    front: [['scratches', 'Scratches', 8.5], ['printline', 'Print line', 9], ['dent', 'Dent', 7], ['holo', 'Holo wear', 8.5], ['stain', 'Stain', 7], ['fingerprint', 'Fingerprint', 9.5]],
    back: [['scratches', 'Scratches', 8.5], ['whitening', 'Whitening', 8.5], ['dent', 'Dent', 7], ['stain', 'Stain', 7]]
  };
  function wearGrade(counts) {               // counts: [light, heavy]
    var light = counts[0], heavy = counts[1];
    if (heavy > 0) return Math.max(5, floorHalf(8 - (heavy - 1) * 0.5 - light * 0.25));
    return [10, 9.5, 9, 8.5, 8.5][Math.min(light, 4)];
  }
  function count(obj) { var c = [0, 0]; Object.keys(obj).forEach(function (k) { if (obj[k] === 1) c[0]++; if (obj[k] === 2) c[1]++; }); return c; }
  function surfaceGrade() {
    var hits = [];
    ['front', 'back'].forEach(function (side) { SURF[side].forEach(function (f) { if (S.surface[side][f[0]]) hits.push(f[2]); }); });
    if (!hits.length) return 10;
    hits.sort(function (a, b) { return a - b; });
    return Math.max(5, hits[0] - (hits.length - 1) * 0.5);
  }
  function compute() {
    var gf = S.guides.front, gb = S.guides.back;
    // A side that hasn't been measured yet counts as perfect (50/50), so a new pre-grade starts at
    // 10 everywhere and only comes down as you measure and mark things.
    var F = gf.set ? worst(gf) : 50, B = gb.set ? worst(gb) : 50;
    var sub = {
      centering: capFrom(BGS_CENTER, F, B),
      corners: wearGrade(count(S.corners)),
      edges: wearGrade(count(S.edges)),
      surface: surfaceGrade()
    };
    Object.keys(S.override).forEach(function (k) { if (S.override[k] != null) sub[k] = S.override[k]; });
    var vals = [sub.centering, sub.corners, sub.edges, sub.surface], avg = (vals[0] + vals[1] + vals[2] + vals[3]) / 4;
    var minSub = Math.min.apply(null, vals), minO = Math.min(sub.corners, sub.edges, sub.surface);
    var psaCap = capFrom(PSA_CENTER, F, B);
    function est(g, hi) { return { g: g, hi: hi != null && hi > g ? hi : null }; }
    var psa = Math.min(psaCap, Math.floor(minO));
    var tag = Math.min(psaCap, floorHalf(0.6 * minO + 0.4 * avg));
    var bgs = Math.min(floorHalf(avg), floorHalf(minSub + 1), 10);
    var cgc = Math.min(psaCap, floorHalf(avg), floorHalf(minSub + 0.5));
    var e = {
      psa: est(psa, minO - Math.floor(minO) >= 0.5 && psa < psaCap ? psa + 1 : null),
      tag: est(tag, avg > tag + 0.25 && tag < psaCap ? tag + 0.5 : null),
      bgs: est(bgs, avg - bgs >= 0.25 && bgs + 0.5 <= Math.min(minSub + 1, 10) ? bgs + 0.5 : null),
      cgc: est(cgc, avg - cgc >= 0.25 && cgc < psaCap ? cgc + 0.5 : null)
    };
    // weakest areas, in words
    var weak = [], cn = { tl: 'top-left', tr: 'top-right', bl: 'bottom-left', br: 'bottom-right' }, en = { t: 'top', r: 'right', b: 'bottom', l: 'left' };
    Object.keys(S.corners).forEach(function (k) { if (S.corners[k]) weak.push((S.corners[k] === 2 ? 'worn ' : '') + cn[k] + ' corner'); });
    Object.keys(S.edges).forEach(function (k) { if (S.edges[k]) weak.push(en[k] + ' edge' + (S.edges[k] === 2 ? ' chipping' : '')); });
    ['front', 'back'].forEach(function (side) { SURF[side].forEach(function (f) { if (S.surface[side][f[0]]) weak.push(side + ' ' + f[1].toLowerCase()); }); });
    if (psaCap < 10) weak.unshift((F >= B ? 'front' : 'back') + ' centering');
    return {
      F: F, B: B, psaCap: psaCap, sub: sub, est: e, weak: weak.slice(0, 3).join(', '),
      centering: {
        front: S.guides.front.set ? { lr: ratioText(shares(gf).lr), tb: ratioText(shares(gf).tb) } : null,
        back: S.guides.back.set ? { lr: ratioText(shares(gb).lr), tb: ratioText(shares(gb).tb) } : null
      }
    };
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  function touched() { S.dirty = true; renderResult(); renderCertBar(); }
  function renderAll() { renderLookup(); renderPicked(); renderPhotos(); renderStage(); renderInspect(); renderResult(); renderCertBar(); }
  function renderCertBar() {
    var el = $('pg-cert');
    if (!el) return;
    el.textContent = S.cert ? (S.dirty ? S.cert + ' · unsaved changes' : S.cert + ' · saved') : 'New pre-grade · not saved';
  }

  // card lookup (same databases as the editor)
  function renderLookup(msg) {
    var box = $('pg-results');
    if (!box) return;
    Array.prototype.forEach.call(document.querySelectorAll('#pg-games [data-game]'), function (b) { b.classList.toggle('on', b.getAttribute('data-game') === lookup.game); });
    if (msg) { box.innerHTML = '<div class="pg-msg">' + esc(msg) + '</div>'; return; }
    box.innerHTML = lookup.items.length ? '<div class="alr-lc-tiles">' + lookup.items.map(function (it, i) {
      return '<button type="button" class="alr-lc-tile" data-pg-pick="' + i + '" title="' + esc(it.title + ' · ' + it.sub) + '">' +
        (it.img ? '<img src="' + esc(G().shown(it.game, it.img, 200)) + '" alt="" loading="lazy">' : '<span class="alr-lc-tile-ph"></span>') +
        '<span class="alr-lc-tile-t">' + esc(it.title) + '</span><span class="alr-lc-tile-s">' + esc(it.sub) + '</span></button>';
    }).join('') + '</div>' : '';
    Array.prototype.forEach.call(box.querySelectorAll('[data-pg-pick]'), function (b) {
      b.addEventListener('click', function () { pick(lookup.items[Number(b.getAttribute('data-pg-pick'))]); });
    });
  }
  function runSearch() {
    var q = ($('pg-q').value || '').trim();
    if (q.length < 2 || lookup.busy || !G()) return;
    lookup.busy = true; lookup.items = []; renderLookup('Searching…');
    G().search(lookup.game, q).then(function (items) { lookup.busy = false; lookup.items = items; renderLookup(items.length ? '' : 'No cards found.'); })
      .catch(function () { lookup.busy = false; renderLookup('Couldn’t reach the card database.'); });
  }
  function pick(it) {
    if (!it) return;
    var p = it.printings && it.printings[0];
    S.card = { game: it.game, name: it.label.name, number: p ? p.code : it.number, setName: p ? p.set : it.setName,
      printing: p ? p.rarity : it.printing, official: it.imgLarge || it.img || null, printings: it.printings || null };
    lookup.items = []; renderLookup(); renderPicked(); renderStage(); touched();
  }
  function renderPicked() {
    var box = $('pg-picked');
    if (!box) return;
    var c = S.card;
    var img = c.official && G() ? G().shown(c.game, c.official, 200) : null;
    var prints = c.printings && c.printings.length > 1 ? '<select class="alr-lc-input" id="pg-printing">' + c.printings.map(function (p, k) {
      return '<option value="' + k + '"' + (p.code === c.number ? ' selected' : '') + '>' + esc(p.code + ' · ' + p.rarity) + '</option>';
    }).join('') + '</select>' : '';
    box.innerHTML = '<div class="alr-lc-field"><div class="alr-lc-label">Card name</div><input class="alr-lc-input" id="pg-name" maxlength="120" value="' + esc(c.name) + '" placeholder="Search above, or type the name"></div>' +
      (c.game ? '<div class="alr-lc-picked">' + (img ? '<img src="' + esc(img) + '" alt="">' : '') + '<div><b>' + esc(G().games[c.game].label) + '</b><span>' + esc([c.number, c.printing].filter(Boolean).join(' · ')) + '</span><span>' + esc(c.setName || '') + '</span></div></div>' + prints : '');
    $('pg-name').addEventListener('input', function (e) { S.card.name = e.target.value; touched(); });
    var sel = $('pg-printing');
    if (sel) sel.addEventListener('change', function () { var p = c.printings[Number(sel.value)]; c.number = p.code; c.setName = p.set; c.printing = p.rarity; renderPicked(); touched(); });
  }

  // photos
  function photoSrc(side) { var p = S.photos[side]; return p ? (p.data || p.url) : null; }
  function renderPhotos() {
    ['front', 'back'].forEach(function (side) {
      var box = $('pg-ph-' + side), inner = $('pg-phin-' + side);
      if (!box || !inner) return;
      var src = photoSrc(side);
      inner.innerHTML = src
        ? '<img src="' + esc(src) + '" alt=""><button type="button" class="pg-ph-rm" data-rm="' + side + '">Remove</button>'
        : '<span class="pg-ph-plus">+</span><span>' + (side === 'front' ? 'Front' : 'Back') + ' photo</span>';
      box.classList.toggle('has', !!src);
      var rm = box.querySelector('[data-rm]');
      if (rm) rm.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); S.photos[side] = null; S.guides[side] = blankSide(); renderPhotos(); renderStage(); touched(); });
    });
  }
  function takePhoto(side, file) {
    var st = $('pg-ph-msg');
    if (st) st.textContent = 'Preparing photo…';
    G().shrinkPhoto(file).then(function (p) {
      S.photos[side] = { data: p.data, blob: p.blob };
      S.guides[side] = blankSide();
      if (st) st.textContent = '';
      renderPhotos(); S.side = side; renderStage();
      autoDetect(side);
      touched();
    }).catch(function (e) { if (st) st.textContent = (e && e.message) || 'Couldn’t read that photo.'; });
  }

  // centering stage: the photo with draggable guides
  var drag = null;
  function stageRect() {
    var img = $('pg-img'), stage = $('pg-stage');
    if (!img || !stage || !img.naturalWidth) return null;
    var sw = stage.clientWidth, sh = stage.clientHeight, ir = img.naturalWidth / img.naturalHeight;
    var w = Math.min(sw, sh * ir), h = w / ir;
    return { x: (sw - w) / 2, y: (sh - h) / 2, w: w, h: h };
  }
  function renderStage() {
    Array.prototype.forEach.call(document.querySelectorAll('#pg-sides [data-side]'), function (b) { b.classList.toggle('on', b.getAttribute('data-side') === S.side); });
    var stage = $('pg-stage');
    if (!stage) return;
    var src = photoSrc(S.side);
    if (!src) {
      stage.innerHTML = '<div class="pg-stage-empty">Add a ' + S.side + ' photo to measure centering.<br><small>Lay the card flat, light it evenly, and shoot straight on.</small></div>';
      renderRatios(); return;
    }
    if (!$('pg-img') || $('pg-img').getAttribute('data-src') !== src) {
      stage.innerHTML = '<img id="pg-img" alt="" data-src="' + esc(src) + '" src="' + esc(src) + '"><div id="pg-guides"></div><div id="pg-lens" hidden></div>';
      $('pg-img').addEventListener('load', function () { placeGuides(); });
    }
    placeGuides(); renderRatios();
  }
  function placeGuides() {
    var r = stageRect(), box = $('pg-guides');
    if (!r || !box) return;
    var img = $('pg-img');
    img.style.left = r.x + 'px'; img.style.top = r.y + 'px'; img.style.width = r.w + 'px'; img.style.height = r.h + 'px';
    var gd = S.guides[S.side], out = '', sh = shares(gd);
    [['outer', 'l', 'v'], ['outer', 'r', 'v'], ['outer', 't', 'h'], ['outer', 'b', 'h'], ['inner', 'l', 'v'], ['inner', 'r', 'v'], ['inner', 't', 'h'], ['inner', 'b', 'h']].forEach(function (k) {
      var v = gd[k[0]][k[1]], pos = k[2] === 'v' ? r.x + v * r.w : r.y + v * r.h;
      out += '<div class="pg-g ' + k[2] + ' ' + k[0] + '" data-g="' + k[0] + '.' + k[1] + '" style="' + (k[2] === 'v' ? 'left:' + pos + 'px' : 'top:' + pos + 'px') + '"></div>';
    });
    var o = gd.outer, i = gd.inner;
    out += '<span class="pg-dim" style="left:' + (r.x + (o.l + i.l) / 2 * r.w - 14) + 'px;top:' + (r.y + r.h * 0.5) + 'px">' + sh.lr + '</span>';
    out += '<span class="pg-dim" style="left:' + (r.x + (o.r + i.r) / 2 * r.w - 14) + 'px;top:' + (r.y + r.h * 0.5) + 'px">' + (100 - sh.lr) + '</span>';
    out += '<span class="pg-dim" style="left:' + (r.x + r.w * 0.5 - 14) + 'px;top:' + (r.y + (o.t + i.t) / 2 * r.h - 9) + 'px">' + sh.tb + '</span>';
    out += '<span class="pg-dim" style="left:' + (r.x + r.w * 0.5 - 14) + 'px;top:' + (r.y + (o.b + i.b) / 2 * r.h - 9) + 'px">' + (100 - sh.tb) + '</span>';
    box.innerHTML = out;
  }
  function renderRatios() {
    var c = compute(), box = $('pg-ratios');
    if (!box) return;
    function cell(label, side, key) {
      var v = c.centering[side];
      return '<div class="pg-rb' + (side === 'back' ? ' back' : '') + '"><span>' + label + '</span><b>' + (v ? v[key] : '—') + '</b></div>';
    }
    box.innerHTML = cell('FRONT · LEFT / RIGHT', 'front', 'lr') + cell('FRONT · TOP / BOTTOM', 'front', 'tb') + cell('BACK · LEFT / RIGHT', 'back', 'lr') + cell('BACK · TOP / BOTTOM', 'back', 'tb');
    var cap = $('pg-cap');
    if (cap) cap.innerHTML = S.guides.front.set
      ? 'Best grade this centering allows: <b>PSA ' + c.psaCap + '</b> · <b>TAG ' + c.psaCap + '</b> · <b>BGS ' + fmt(capFrom(BGS_CENTER, c.F, c.B)) + '</b> · <b>CGC ' + c.psaCap + '</b>' + (S.guides.back.set ? '' : ' <small>(back not measured yet)</small>')
      : 'Set the guides on the front photo to see what centering allows.';
  }
  function onDown(e) {
    var t = e.target.closest ? e.target.closest('.pg-g') : null, r = stageRect();
    if (!t || !r) return;
    e.preventDefault();
    var k = t.getAttribute('data-g').split('.');
    drag = { layer: k[0], side: k[1], r: r };
    t.setPointerCapture && t.setPointerCapture(e.pointerId);
  }
  function onMove(e) {
    var stage = $('pg-stage');
    if (!stage) return;
    var b = stage.getBoundingClientRect(), r = drag ? drag.r : stageRect();
    if (drag && r) {
      var gd = S.guides[S.side], v = /l|r/.test(drag.side) ? (e.clientX - b.left - r.x) / r.w : (e.clientY - b.top - r.y) / r.h;
      gd[drag.layer][drag.side] = Math.max(0, Math.min(1, v)); gd.set = true;
      placeGuides(); renderRatios(); renderResult();
    }
    lensAt(e, b, r);
  }
  function onUp() { if (drag) { drag = null; touched(); } }
  // loupe: 3x zoom that follows the pointer while "Loupe" is on
  var lensOn = false;
  function lensAt(e, b, r) {
    var lens = $('pg-lens'), img = $('pg-img');
    if (!lens || !img || !r) return;
    var x = e.clientX - b.left, y = e.clientY - b.top, inside = x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (!lensOn || !inside) { lens.hidden = true; return; }
    var z = 3, size = 130;
    lens.hidden = false;
    lens.style.left = (x - size / 2) + 'px'; lens.style.top = (y - size / 2) + 'px';
    lens.style.backgroundImage = 'url("' + img.src + '")';
    lens.style.backgroundSize = (r.w * z) + 'px ' + (r.h * z) + 'px';
    lens.style.backgroundPosition = (-(x - r.x) * z + size / 2) + 'px ' + (-(y - r.y) * z + size / 2) + 'px';
  }

  // auto-detect: strongest brightness change near each side = card edge; next one inward = border
  function autoDetect(side) {
    var src = photoSrc(side), st = $('pg-auto-msg');
    if (!src) return;
    if (st) st.textContent = 'Finding edges…';
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var W = 420, H = Math.round(W * img.naturalHeight / img.naturalWidth), c = document.createElement('canvas');
        c.width = W; c.height = H;
        var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, W, H);
        // colour difference between neighbouring pixels (a dark red frame on a dark table barely
        // changes brightness, but its colour changes a lot)
        var px = ctx.getImageData(0, 0, W, H).data;
        function diff(a, b) { a *= 4; b *= 4; return Math.abs(px[a] - px[b]) + Math.abs(px[a + 1] - px[b + 1]) + Math.abs(px[a + 2] - px[b + 2]); }
        function colScore(x) { var s = 0; for (var y = Math.round(H * 0.25); y < H * 0.75; y++) s += diff(y * W + x + 1, y * W + x); return s; }
        function rowScore(y) { var s = 0; for (var x = Math.round(W * 0.25); x < W * 0.75; x++) s += diff((y + 1) * W + x, y * W + x); return s; }
        // Walk in from the outside and take the FIRST strong line (at least 55% of the strongest in
        // the band), so busy card art further in doesn't win. Scores are smoothed over 3 pixels.
        function first(fn, from, to, share) {
          share = share || 0.55;
          var step = from <= to ? 1 : -1, n = Math.abs(to - from) + 1, sc = [], mx = 0, k, i;
          for (i = 0; i < n; i++) { k = from + i * step; sc.push(fn(k)); }
          var sm = sc.map(function (v, j) { return (sc[j - 1] || v) * 0.25 + v * 0.5 + (sc[j + 1] || v) * 0.25; });
          sm.forEach(function (v) { if (v > mx) mx = v; });
          for (i = 0; i < n; i++) {
            if (sm[i] >= mx * share && (i === n - 1 || sm[i] >= sm[i + 1])) return from + i * step;
          }
          return from;
        }
        // skip the photo's own outer 1.5% (its border pixels often read as an edge)
        var mx0 = Math.max(2, Math.round(W * 0.015)), my0 = Math.max(2, Math.round(H * 0.015));
        // the table around a card is usually plain, so the first real rise is the card's edge
        var oL = first(colScore, mx0, Math.round(W * 0.22), 0.3), oR = first(colScore, W - 1 - mx0, Math.round(W * 0.78), 0.3) + 1;
        var oT = first(rowScore, my0, Math.round(H * 0.22), 0.3), oB = first(rowScore, H - 1 - my0, Math.round(H * 0.78), 0.3) + 1;
        var cw = oR - oL, ch = oB - oT;
        // borders on One Piece, Pokémon and Yu-Gi-Oh! cards sit about 2–8% in from the edge
        var iL = first(colScore, oL + Math.max(3, Math.round(cw * 0.018)), oL + Math.round(cw * 0.085));
        var iR = first(colScore, oR - Math.max(4, Math.round(cw * 0.018)), oR - Math.round(cw * 0.085)) + 1;
        var iT = first(rowScore, oT + Math.max(3, Math.round(ch * 0.015)), oT + Math.round(ch * 0.075));
        var iB = first(rowScore, oB - Math.max(4, Math.round(ch * 0.015)), oB - Math.round(ch * 0.075)) + 1;
        S.guides[side] = { outer: { l: oL / W, r: oR / W, t: oT / H, b: oB / H }, inner: { l: iL / W, r: iR / W, t: iT / H, b: iB / H }, set: true };
        if (st) st.textContent = 'Guides placed. Drag any line to fine-tune.';
      } catch (e) { if (st) st.textContent = 'Couldn’t read this photo automatically. Drag the guides by hand.'; }
      if (S.side === side) renderStage(); renderResult(); touched();
    };
    img.onerror = function () { if (st) st.textContent = 'Couldn’t read this photo automatically. Drag the guides by hand.'; };
    img.src = src;
  }

  // inspection controls
  function seg(group, key, labels) {
    var v = S[group][key];
    return '<div class="seg">' + labels.map(function (l, k) {
      return '<button type="button" data-seg="' + group + '.' + key + '.' + k + '" class="' + (v === k ? 'on' : '') + '">' + l + '</button>';
    }).join('') + '</div>';
  }
  function renderInspect() {
    var box = $('pg-inspect');
    if (!box) return;
    var CN = [['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']], EN = [['t', 'Top'], ['r', 'Right'], ['b', 'Bottom'], ['l', 'Left']];
    function chips(side) {
      return '<div class="pg-chips">' + SURF[side].map(function (f) {
        return '<button type="button" data-surf="' + side + '.' + f[0] + '" class="' + (S.surface[side][f[0]] ? 'on' : '') + '">' + f[1] + '</button>';
      }).join('') + '</div>';
    }
    box.innerHTML =
      '<div class="pg-st">Corners</div>' + CN.map(function (c) { return '<div class="pg-rw"><span>' + c[1] + '</span>' + seg('corners', c[0], ['Sharp', 'Light', 'Worn']) + '</div>'; }).join('') +
      '<div class="pg-st">Edges</div>' + EN.map(function (c) { return '<div class="pg-rw"><span>' + c[1] + '</span>' + seg('edges', c[0], ['Clean', 'Minor', 'Chipped']) + '</div>'; }).join('') +
      '<div class="pg-st">Surface · front</div>' + chips('front') +
      '<div class="pg-st">Surface · back</div>' + chips('back') +
      '<div class="pg-st">Notes</div><textarea class="alr-lc-input pg-notes" id="pg-notes" maxlength="2000" placeholder="Anything else worth noting">' + esc(S.notes) + '</textarea>';
    Array.prototype.forEach.call(box.querySelectorAll('[data-seg]'), function (b) {
      b.addEventListener('click', function () { var k = b.getAttribute('data-seg').split('.'); S[k[0]][k[1]] = Number(k[2]); renderInspect(); touched(); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-surf]'), function (b) {
      b.addEventListener('click', function () { var k = b.getAttribute('data-surf').split('.'); S.surface[k[0]][k[1]] = !S.surface[k[0]][k[1]]; renderInspect(); touched(); });
    });
    $('pg-notes').addEventListener('input', function (e) { S.notes = e.target.value; S.dirty = true; renderCertBar(); });
  }

  // sub-grades + estimates
  function renderResult() {
    var box = $('pg-result');
    if (!box) return;
    var c = compute(), names = [['centering', 'Centering'], ['corners', 'Corners'], ['edges', 'Edges'], ['surface', 'Surface']];
    var lo = Math.min(c.sub.centering, c.sub.corners, c.sub.edges, c.sub.surface);
    box.innerHTML = '<div class="pg-subs">' + names.map(function (n) {
      return '<label class="pg-sg' + (c.sub[n[0]] === lo && lo < 10 ? ' low' : '') + (S.override[n[0]] != null ? ' set' : '') + '"><span>' + n[1] + '</span>' +
        '<input type="number" min="1" max="10" step="0.5" value="' + fmt(c.sub[n[0]]) + '" data-sub="' + n[0] + '" title="Type to override"></label>';
    }).join('') + '</div>' +
      (Object.keys(S.override).length ? '<button type="button" class="alr-lc-linkbtn" id="pg-unoverride">Reset sub-grades to the measured values</button>' : '') +
      '<div class="pg-est">' + [['psa', 'PSA', '1–10'], ['tag', 'TAG', '1–10, halves'], ['bgs', 'Beckett', 'with sub-grades'], ['cgc', 'CGC', '1–10']].map(function (k) {
        var e = c.est[k[0]];
        return '<div class="pg-er"><div class="pg-co">' + k[1] + '<small>' + k[2] + '</small></div><div class="pg-bar"><i style="left:' + Math.max(0, (e.g - 1) / 9 * 100 - 3) + '%;width:' + ((e.hi ? e.hi - e.g : 0) / 9 * 100 + 6) + '%"></i></div>' +
          '<div class="pg-gv">' + fmt(e.g) + '<small>' + (e.hi ? fmt(e.hi) + ' possible' : 'most likely') + '</small></div></div>';
      }).join('') + '</div>' +
      (c.weak ? '<div class="pg-weak"><b>Weakest areas:</b> ' + esc(c.weak) + '. These are most likely to cost a point; check them again under angled light before you submit.</div>' : '<div class="pg-weak">No weak areas marked. Check corners and surface again under angled light before you submit.</div>');
    Array.prototype.forEach.call(box.querySelectorAll('[data-sub]'), function (inp) {
      inp.addEventListener('change', function () {
        var v = Number(inp.value);
        if (!isNaN(v) && v >= 1 && v <= 10) S.override[inp.getAttribute('data-sub')] = Math.round(v * 2) / 2;
        touched();
      });
    });
    var un = $('pg-unoverride');
    if (un) un.addEventListener('click', function () { S.override = {}; touched(); });
  }

  // ── saving, report, labels ────────────────────────────────────────────────
  function snapshot() {
    var c = compute();
    return {
      v: 1, centering: { front: c.centering.front, back: c.centering.back }, guides: { front: S.guides.front, back: S.guides.back },
      corners: S.corners, edges: S.edges, surface: S.surface, sub: c.sub, est: c.est, weak: c.weak, override: S.override
    };
  }
  function labelFields(c) {
    var setLine = [S.card.number, 'EN'].filter(Boolean).join(' · ') || (S.card.setName || '').toUpperCase().slice(0, 32);
    var estTxt = 'EST. PSA ' + fmt(c.est.psa.g) + ' · TAG ' + fmt(c.est.tag.g);
    return { name: (S.card.name || 'CARD NAME').toUpperCase(), set: setLine, variant: estTxt, grade: String(Math.round(c.est.psa.g)), gl: 'PRE-GRADE' };
  }
  function colours() { return window.ALRLabel && window.ALRLabel.currentColours ? window.ALRLabel.currentColours() : { front: {}, back: {} }; }
  function rowLike() {
    var c = compute(), lf = labelFields(c), col = colours();
    return {
      kind: 'pregrade', cert: S.cert || 'PRE-UNSAVED', cert_no: S.cert_no, card_name: lf.name, grade: Number(lf.grade), grade_label: 'PRE-GRADE',
      label: { set: lf.set, variant: lf.variant, front: col.front, back: col.back }
    };
  }
  function status(msg) { var el = $('pg-status'); if (el) el.textContent = msg || ''; }
  function needCard() { if (!(S.card.name || '').trim()) { status('Add the card name first (search or type it).'); return true; } return false; }

  function save() {
    if (needCard()) return;
    window.ALR_supabase().then(function (sb) {
      return sb.auth.getSession().then(function (res) {
        if (!res.data || !res.data.session) { status('Sign in to save pre-grades to your account.'); if (window.ALR_signIn) window.ALR_signIn(); return; }
        var c = compute(), lf = labelFields(c), col = colours(), pg = snapshot();
        var payload = {
          kind: 'pregrade', card_name: lf.name.slice(0, 120), grade: Math.max(1, Math.min(10, Math.round(c.est.psa.g))), grade_label: 'PRE-GRADE',
          game: S.card.game || 'other', card_number: S.card.number || null, set_name: (S.card.setName || '').slice(0, 120) || null,
          printing: (S.card.printing || '').slice(0, 120) || null,
          official_image_url: S.card.official && /^https:\/\//.test(S.card.official) ? S.card.official : null,
          notes: S.notes ? S.notes.slice(0, 2000) : null,
          condition: {
            centering: pg.centering.front ? pg.centering.front.lr + ' · ' + pg.centering.front.tb : undefined,
            corners: 'Sub-grade ' + fmt(c.sub.corners), edges: 'Sub-grade ' + fmt(c.sub.edges), surface: 'Sub-grade ' + fmt(c.sub.surface)
          },
          label: { set: lf.set, variant: lf.variant, front: col.front, back: col.back },
          pregrade: pg, source: 'app'
        };
        status(S.id ? 'Updating…' : 'Saving…');
        var q = S.id
          ? sb.from('graded_cards').update(payload).eq('id', S.id).select('id, cert, cert_no').single()
          : sb.from('graded_cards').insert(payload).select('id, cert, cert_no').single();
        return q.then(function (r) {
          if (r.error) throw r.error;
          S.id = r.data.id; S.cert = r.data.cert; S.cert_no = r.data.cert_no;
          return uploadPhotos(sb);
        }).then(function () {
          S.dirty = false; renderCertBar(); renderPhotos();
          status('Saved as ' + S.cert + '. It’s on your Account page, and the report page is live.');
        });
      });
    }).catch(function (e) { status('Couldn’t save: ' + ((e && e.message) || 'check your connection and try again.')); });
  }
  function uploadPhotos(sb) {
    var jobs = ['front', 'back'].map(function (side) {
      var p = S.photos[side];
      if (!p || !p.blob) return Promise.resolve();
      var path = S.id + '/' + side + '.jpg';
      return sb.storage.from('card-photos').upload(path, p.blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '60' }).then(function (r) {
        if (r.error) throw r.error;
        var u = {}; u[side + '_photo_path'] = path;
        return sb.from('graded_cards').update(u).eq('id', S.id);
      }).then(function () { S.photos[side] = { url: G().photoUrl(path) + '?v=' + Date.now() }; });
    });
    return Promise.all(jobs);
  }
  function report() {
    if (needCard() || !G()) return;
    status('Making the report…');
    var c = compute(), lf = labelFields(c), col = colours(), row = rowLike();
    var v = {}; Object.keys(col.front || {}).forEach(function (k) { v[k] = col.front[k]; });
    v.name = lf.name; v.set = lf.set; v.variant = lf.variant; v.cert = row.cert; v.grade = lf.grade; v.gl = 'PRE-GRADE';
    var front = photoSrc('front'), official = !front && S.card.official;
    window.ALRLabel.frontPng(v).then(function (png) {
      return G().reportPdf({
        kind: 'pregrade', pregrade: snapshot(), cert: row.cert, certNo: S.cert_no,
        name: S.card.name || lf.name, set: S.card.setName, variant: S.card.printing, cardNumber: S.card.number,
        printing: S.card.printing, game: S.card.game ? G().gameName(S.card.game) : '', grade: lf.grade, gradeLabel: 'PRE-GRADE',
        date: new Date().toISOString().slice(0, 10), condition: {}, notes: S.notes, labelPng: png,
        photo: front || official || null, photoIsOfficial: !!official, photoSource: official ? G().games[S.card.game].source : null
      });
    }).then(function (blob) { return G().saveFile(blob, G().fileStem(S.card.name || 'CARD', 'PRE') + '_report.pdf'); })
      .then(function (msg) { status('Saved ' + msg); })
      .catch(function () { status('Couldn’t make the report.'); });
  }
  function labels() {
    if (needCard()) return;
    status('Saving labels…');
    (S.cert_no != null ? G().loadQR() : Promise.resolve()).then(function () { return window.ALRLabel.saveLabels(rowLike()); })
      .then(function (m) { status(m || 'Labels saved'); }).catch(function () { status('Couldn’t save the labels.'); });
  }
  function sendToEditor() {
    if (needCard()) return;
    function set(id, v) { var el = $(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }
    set('alr-lc-name', (S.card.name || '').toUpperCase());
    set('alr-lc-set', [S.card.number, 'EN'].filter(Boolean).join(' · '));
    set('alr-lc-variant', (S.card.printing || '').toUpperCase());
    if (window.ALR_showView) window.ALR_showView('editor');
  }

  // ── open a saved pre-grade (from My Cards) ────────────────────────────────
  function load(id) {
    status('Loading pre-grade…');
    window.ALR_supabase().then(function (sb) { return sb.from('graded_cards').select('*').eq('id', id).single(); }).then(function (r) {
      if (r.error || !r.data) throw r.error || new Error('missing');
      var row = r.data, pg = row.pregrade || {};
      S = blank();
      S.id = row.id; S.cert = row.cert; S.cert_no = row.cert_no; S.notes = row.notes || '';
      S.card = { game: row.game !== 'other' ? row.game : null, name: row.card_name, number: row.card_number || '', setName: row.set_name || '', printing: row.printing || '', official: row.official_image_url };
      if (pg.guides) { S.guides.front = pg.guides.front || blankSide(); S.guides.back = pg.guides.back || blankSide(); }
      ['corners', 'edges', 'surface', 'override'].forEach(function (k) { if (pg[k]) S[k] = pg[k]; });
      if (row.front_photo_path) S.photos.front = { url: G().photoUrl(row.front_photo_path) };
      if (row.back_photo_path) S.photos.back = { url: G().photoUrl(row.back_photo_path) };
      S.dirty = false; renderAll(); status('Editing ' + row.cert + '.');
    }).catch(function () { status('Couldn’t open that pre-grade.'); });
  }
  function reset() { S = blank(); lookup.items = []; var q = $('pg-q'); if (q) q.value = ''; renderAll(); status(''); }

  function init() {
    var root = $('app-pregrade');
    if (!root || root._pg) return;
    root._pg = true;
    Array.prototype.forEach.call(document.querySelectorAll('#pg-games [data-game]'), function (b) {
      b.addEventListener('click', function () { lookup.game = b.getAttribute('data-game'); lookup.items = []; renderLookup(); });
    });
    $('pg-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
    $('pg-qbtn').addEventListener('click', runSearch);
    ['front', 'back'].forEach(function (side) {
      var inp = $('pg-file-' + side), drop = $('pg-ph-' + side);
      inp.addEventListener('change', function () { if (inp.files && inp.files[0]) takePhoto(side, inp.files[0]); inp.value = ''; });
      ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('drag'); }); });
      ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('drag'); }); });
      drop.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) takePhoto(side, f); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#pg-sides [data-side]'), function (b) {
      b.addEventListener('click', function () { S.side = b.getAttribute('data-side'); renderStage(); });
    });
    $('pg-auto').addEventListener('click', function () { autoDetect(S.side); });
    $('pg-loupe').addEventListener('click', function () { lensOn = !lensOn; $('pg-loupe').classList.toggle('on', lensOn); });
    var stage = $('pg-stage');
    stage.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    stage.addEventListener('pointerleave', function () { var l = $('pg-lens'); if (l) l.hidden = true; });
    window.addEventListener('resize', placeGuides);
    $('pg-save').addEventListener('click', save);
    $('pg-report').addEventListener('click', report);
    $('pg-labels').addEventListener('click', labels);
    $('pg-editor').addEventListener('click', sendToEditor);
    $('pg-new').addEventListener('click', reset);
    renderAll();
  }

  window.ALRPregrade = { load: load, reset: reset, refresh: function () { renderStage(); } };
  document.addEventListener('DOMContentLoaded', init);
})();
