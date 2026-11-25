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
      ignored: {},                                    // finder suggestions waved off, 'front.tl'
      value: { raw: null, rawSrc: null, co: 'psa', prices: { psa: {}, tag: {}, bgs: {}, cgc: {} } },
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
  function surfaceGrade(st) {
    var hits = [];
    ['front', 'back'].forEach(function (side) { SURF[side].forEach(function (f) { if (st.surface[side][f[0]]) hits.push(f[2]); }); });
    if (!hits.length) return 10;
    hits.sort(function (a, b) { return a - b; });
    return Math.max(5, hits[0] - (hits.length - 1) * 0.5);
  }
  // Each company's grade for one set of sub-grades and worst centering (front %, back %).
  function gradesFor(F, B, sub) {
    var vals = [sub.centering, sub.corners, sub.edges, sub.surface], avg = (vals[0] + vals[1] + vals[2] + vals[3]) / 4;
    var minSub = Math.min.apply(null, vals), minO = Math.min(sub.corners, sub.edges, sub.surface), psaCap = capFrom(PSA_CENTER, F, B);
    return {
      psa: Math.min(psaCap, Math.floor(minO)),
      tag: Math.min(psaCap, floorHalf(0.6 * minO + 0.4 * avg)),
      bgs: Math.min(floorHalf(avg), floorHalf(minSub + 1), 10),
      cgc: Math.min(psaCap, floorHalf(avg), floorHalf(minSub + 0.5))
    };
  }
  // Grade odds. A photo can't show everything, so each sub-grade could really sit a little
  // either side of what was measured: more often lower than higher, since graders find things
  // photos miss. Every combination is run through each company's rules. These spreads are a
  // starting point; logged real grades (step 4) will tune them.
  var NOISE = [[0.5, 0.05], [0, 0.70], [-0.5, 0.20], [-1, 0.05]];
  var CNOISE = [[-2, 0.25], [0, 0.5], [2, 0.25]];
  function odds(F, B, sub, over) {
    var dist = { psa: {}, tag: {}, bgs: {}, cgc: {} };
    function clamp(v) { return Math.max(1, Math.min(10, v)); }
    CNOISE.forEach(function (fn) { CNOISE.forEach(function (bn) {
      var f = Math.max(50, Math.min(100, F + fn[0])), b = Math.max(50, Math.min(100, B + bn[0] * 1.5));
      var cen = over.centering != null ? over.centering : capFrom(BGS_CENTER, f, b);
      NOISE.forEach(function (a) { NOISE.forEach(function (e) { NOISE.forEach(function (u) {
        var p = fn[1] * bn[1] * a[1] * e[1] * u[1];
        var g = gradesFor(f, b, { centering: cen, corners: clamp(sub.corners + a[0]), edges: clamp(sub.edges + e[0]), surface: clamp(sub.surface + u[0]) });
        Object.keys(dist).forEach(function (k) { dist[k][g[k]] = (dist[k][g[k]] || 0) + p; });
      }); }); });
    }); });
    var out = {};
    Object.keys(dist).forEach(function (k) {
      var list = Object.keys(dist[k]).map(function (g) { return [Number(g), Math.round(dist[k][g] * 1000) / 1000]; }).sort(function (x, y) { return y[0] - x[0]; });
      var mode = list.reduce(function (m, x) { return !m || x[1] > m[1] + 1e-9 ? x : m; }, null);
      // the next grade up, if it's a real chance
      var up = list.filter(function (x) { return x[0] > mode[0]; }).reduce(function (m, x) { return !m || x[1] > m[1] ? x : m; }, null);
      out[k] = { g: mode[0], hi: up && up[1] >= 0.2 ? up[0] : null, odds: list };
    });
    return out;
  }
  function chance(e, g) { var x = e.odds.filter(function (o) { return o[0] === g; })[0]; return x ? x[1] : 0; }
  function pct(p) { return Math.round(p * 100) + '%'; }
  function compute(st) {
    st = st || S;
    var gf = st.guides.front, gb = st.guides.back;
    // A side that hasn't been measured yet counts as perfect (50/50), so a new pre-grade starts at
    // 10 everywhere and only comes down as you measure and mark things.
    var F = gf.set ? worst(gf) : 50, B = gb.set ? worst(gb) : 50;
    var sub = {
      centering: capFrom(BGS_CENTER, F, B),
      corners: wearGrade(count(st.corners)),
      edges: wearGrade(count(st.edges)),
      surface: surfaceGrade(st)
    };
    Object.keys(st.override).forEach(function (k) { if (st.override[k] != null) sub[k] = st.override[k]; });
    var psaCap = capFrom(PSA_CENTER, F, B), e = odds(F, B, sub, st.override);
    // weakest areas, in words
    var weak = [], cn = { tl: 'top-left', tr: 'top-right', bl: 'bottom-left', br: 'bottom-right' }, en = { t: 'top', r: 'right', b: 'bottom', l: 'left' };
    Object.keys(st.corners).forEach(function (k) { if (st.corners[k]) weak.push((st.corners[k] === 2 ? 'worn ' : '') + cn[k] + ' corner'); });
    Object.keys(st.edges).forEach(function (k) { if (st.edges[k]) weak.push(en[k] + ' edge' + (st.edges[k] === 2 ? ' chipping' : '')); });
    ['front', 'back'].forEach(function (side) { SURF[side].forEach(function (f) { if (st.surface[side][f[0]]) weak.push(side + ' ' + f[1].toLowerCase()); }); });
    if (psaCap < 10) weak.unshift((F >= B ? 'front' : 'back') + ' centering');
    return {
      F: F, B: B, psaCap: psaCap, sub: sub, est: e, weak: weak.slice(0, 3).join(', '),
      centering: {
        front: st.guides.front.set ? { lr: ratioText(shares(gf).lr), tb: ratioText(shares(gf).tb) } : null,
        back: st.guides.back.set ? { lr: ratioText(shares(gb).lr), tb: ratioText(shares(gb).tb) } : null
      }
    };
  }
  // The single fix that would most raise the PSA 10 odds, as a sentence (or '').
  function holdingBack(c) {
    var base = chance(c.est.psa, 10), best = null, cn = { tl: 'top left corner', tr: 'top right corner', bl: 'bottom left corner', br: 'bottom right corner' }, en = { t: 'top edge', r: 'right edge', b: 'bottom edge', l: 'left edge' };
    function clone() { return { guides: S.guides, corners: Object.assign({}, S.corners), edges: Object.assign({}, S.edges), surface: { front: Object.assign({}, S.surface.front), back: Object.assign({}, S.surface.back) }, override: Object.assign({}, S.override) }; }
    function tryFix(label, change) {
      var st = clone(); change(st);
      var p = chance(compute(st).est.psa, 10);
      if (!best || p > best.p) best = { label: label, p: p };
    }
    Object.keys(cn).forEach(function (k) { if (S.corners[k]) tryFix('the ' + cn[k] + ' sharp', function (st) { st.corners[k] = 0; delete st.override.corners; }); });
    Object.keys(en).forEach(function (k) { if (S.edges[k]) tryFix('the ' + en[k] + ' clean', function (st) { st.edges[k] = 0; delete st.override.edges; }); });
    ['front', 'back'].forEach(function (side) { SURF[side].forEach(function (f) { if (S.surface[side][f[0]]) tryFix('no ' + side + ' ' + f[1].toLowerCase(), function (st) { st.surface[side][f[0]] = false; delete st.override.surface; }); }); });
    if (c.psaCap < 10) tryFix('perfect centering', function (st) { st.guides = { front: blankSide(), back: blankSide() }; delete st.override.centering; });
    if (best && best.p - base >= 0.05) return 'With ' + best.label + ', PSA 10 odds would go from ' + pct(base) + ' to about ' + pct(best.p) + '.';
    // no single fix is enough: everything marked, fixed
    var all = { guides: c.psaCap < 10 ? { front: blankSide(), back: blankSide() } : S.guides, corners: { tl: 0, tr: 0, bl: 0, br: 0 }, edges: { t: 0, r: 0, b: 0, l: 0 }, surface: { front: {}, back: {} }, override: {} };
    var pAll = chance(compute(all).est.psa, 10);
    return pAll - base >= 0.05 ? 'PSA 10 needs all of these fixed: odds would go from ' + pct(base) + ' to about ' + pct(pAll) + '.' : '';
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  function touched() { S.dirty = true; renderResult(); renderCertBar(); renderCloseups(); renderValue(); }
  function renderAll() { renderLookup(); renderPicked(); renderPhotos(); renderStage(); renderInspect(); renderResult(); renderCertBar(); renderCloseups(); renderValue(); }
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
    box.innerHTML = (lookup.items.length && lookup.heading ? '<div class="pg-msg pg-found">' + esc(lookup.heading) + '</div>' : '') +
      (lookup.items.length ? '<div class="alr-lc-tiles">' + lookup.items.map(function (it, i) {
      return '<button type="button" class="alr-lc-tile" data-pg-pick="' + i + '" title="' + esc(it.title + ' · ' + it.sub) + '">' +
        (it.img ? '<img src="' + esc(G().shown(it.game, it.img, 200)) + '" alt="" loading="lazy">' : '<span class="alr-lc-tile-ph"></span>') +
        '<span class="alr-lc-tile-t">' + esc(it.title) + '</span><span class="alr-lc-tile-s">' + esc(it.sub) + '</span></button>';
    }).join('') + '</div>' : '');
    Array.prototype.forEach.call(box.querySelectorAll('[data-pg-pick]'), function (b) {
      b.addEventListener('click', function () { pick(lookup.items[Number(b.getAttribute('data-pg-pick'))]); });
    });
  }
  function runSearch() {
    var q = ($('pg-q').value || '').trim();
    if (q.length < 2 || lookup.busy || !G()) return;
    lookup.busy = true; lookup.items = []; lookup.heading = ''; renderLookup('Searching…');
    G().search(lookup.game, q).then(function (items) { lookup.busy = false; lookup.items = items; renderLookup(items.length ? '' : 'No cards found.'); })
      .catch(function () { lookup.busy = false; renderLookup('Couldn’t reach the card database.'); });
  }
  function pick(it) {
    if (!it) return;
    var p = it.printings && ((it.preferCode && it.printings.filter(function (x) { return x.code === it.preferCode; })[0]) || it.printings[0]);
    S.card = { game: it.game, name: it.label.name, number: p ? p.code : it.number, setName: p ? p.set : it.setName,
      printing: p ? p.rarity : it.printing, official: it.imgLarge || it.img || null, printings: it.printings || null,
      // the label lines the Editor's own card search would write
      labelSet: p ? (p.code + ' · EN').toUpperCase() : it.label.set, labelVariant: p ? String(p.rarity || '').toUpperCase() : it.label.variant };
    if (S.value.rawSrc !== 'you') { S.value.raw = p && p.price != null ? p.price : it.price != null ? it.price : null; S.value.rawSrc = S.value.raw != null ? G().games[it.game].source : null; }
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
    if (sel) sel.addEventListener('change', function () { var p = c.printings[Number(sel.value)]; c.number = p.code; c.setName = p.set; c.printing = p.rarity; c.labelSet = (p.code + ' · EN').toUpperCase(); c.labelVariant = String(p.rarity || '').toUpperCase(); if (S.value.rawSrc !== 'you' && p.price != null) { S.value.raw = p.price; S.value.rawSrc = G().games[c.game].source; } renderPicked(); touched(); });
  }

  // ── recognise the card from the front photo ──────────────────────────────
  function identify() {
    var src = S.photos.front && (S.photos.front.orig || photoSrc('front'));
    if (!src) { renderLookup('Add a front photo first.'); return; }
    if (!window.ALRRecognize) { renderLookup('Card recognition isn’t available.'); return; }
    lookup.busy = true; lookup.items = []; lookup.heading = '';
    renderLookup('Reading the card in your photo… this takes about 10–20 seconds.');
    window.ALRRecognize.identify(src, S.guides.front.set ? S.guides.front.outer : null, lookup.game).then(function (res) {
      lookup.busy = false;
      var r = res.read, said = r.code || (r.number ? r.number + (r.total ? '/' + r.total : '') : '') || '';
      if (res.game) lookup.game = res.game;
      lookup.items = res.items;
      if (!res.items.length) {
        renderLookup('Couldn’t recognise this card' + (said ? ' (read “' + said + '”)' : '') + '. Search by name or number above.');
        return;
      }
      lookup.heading = 'From your photo' + (said ? ' (read ' + said + ')' : '') + '. Best match first. Pick your card:';
      renderLookup();
    }).catch(function () {
      lookup.busy = false;
      renderLookup('Couldn’t read the photo. Search by name or number above.');
    });
  }

  // photos
  function photoSrc(side) { var p = S.photos[side]; return p ? (p.data || p.url) : null; }
  function renderPhotos() {
    ['front', 'back'].forEach(function (side) {
      var box = $('pg-ph-' + side), inner = $('pg-phin-' + side);
      if (!box || !inner) return;
      var src = photoSrc(side);
      inner.innerHTML = src
        ? '<img src="' + esc(src) + '" alt="">' + (S.photos[side].check && S.photos[side].check.checks && S.photos[side].check.checks.length ? '<span class="pg-ph-badge' + (issues(S.photos[side]) ? ' bad' : '') + '">' + (issues(S.photos[side]) ? issues(S.photos[side]) + ' to check' : 'Checked') + '</span>' : '') + '<button type="button" class="pg-ph-rm" data-rm="' + side + '">Remove</button>'
        : '<span class="pg-ph-plus">+</span><span>' + (side === 'front' ? 'Front' : 'Back') + ' photo</span>';
      box.classList.toggle('has', !!src);
      var rm = box.querySelector('[data-rm]');
      if (rm) rm.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); S.photos[side] = null; S.guides[side] = blankSide(); clearIgnored(side); renderPhotos(); renderStage(); touched(); });
    });
  }
  // New photo: check it and straighten it (photocheck.js), then measure. If the card can't be found
  // the photo is used as it is and the guides are placed by hand.
  function takePhoto(side, file) {
    var st = $('pg-ph-msg');
    if (st) st.textContent = 'Checking photo…';
    var run = window.ALRPhoto
      ? window.ALRPhoto.process(file, { game: S.card.game || null }).catch(function () { return { ok: false, checks: [] }; })
      : Promise.resolve({ ok: false, checks: [] });
    run.then(function (chk) { usePhoto(side, file, chk, !chk.ok); });
  }
  // raw = use the photo as taken instead of the straightened copy
  function usePhoto(side, file, chk, raw) {
    var st = $('pg-ph-msg');
    if (st) st.textContent = 'Preparing photo…';
    G().shrinkPhoto(raw ? file : chk.blob).then(function (p) {
      // full-quality copy stays in memory for reading the card (never uploaded)
      S.photos[side] = { data: p.data, blob: p.blob, orig: raw ? URL.createObjectURL(file) : chk.url, file: file, check: chk, raw: raw, outer: raw ? null : chk.outer };
      S.guides[side] = blankSide();
      clearIgnored(side);
      if (side === 'front' && !S.card.game) S.wantIdentify = true;
      if (st) st.textContent = '';
      S.side = side;
      renderPhotos(); renderStage();
      autoDetect(side);
      touched();
    }).catch(function (e) { if (st) st.textContent = (e && e.message) || 'Couldn’t read that photo.'; });
  }
  var ICON_OK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  var ICON_BAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.5"/></svg>';
  function issues(p) { return p && p.check && p.check.checks ? p.check.checks.filter(function (c) { return !c.ok; }).length : 0; }
  // the photo check for the side shown in the centering stage
  function renderChecks() {
    var box = $('pg-check');
    if (!box) return;
    var side = S.side, p = S.photos[side], chk = p && p.check;
    if (!chk || !chk.checks || !chk.checks.length) { box.innerHTML = ''; return; }
    var name = side === 'front' ? 'Front' : 'Back', n = issues(p);
    var rows = chk.checks.map(function (c) {
      return '<div class="pg-ck' + (c.ok ? '' : ' bad') + '">' + (c.ok ? ICON_OK : ICON_BAD) + '<b>' + esc(c.label) + '</b><small>' + esc(c.detail || '') + '</small></div>';
    }).join('');
    var foot = '';
    if (chk.ok && !p.raw) foot = '<span>Straightened' + (Math.abs(chk.tilt) >= 0.3 ? ' · tilt ' + Math.abs(chk.tilt) + '° fixed' : '') + (chk.keystone >= 1 ? ' · angle ' + chk.keystone + '% fixed' : '') + '</span><button type="button" class="pg-linkbtn" data-pg-raw="1">Use original</button>';
    else if (chk.ok && p.raw) foot = '<span>Using the photo as taken</span><button type="button" class="pg-linkbtn" data-pg-raw="0">Straighten</button>';
    else foot = '<span>Place the guides by hand, or retake.</span>';
    box.innerHTML = '<div class="pg-check-h"><span>' + name + ' photo check</span>' + (n ? '<button type="button" class="alr-lc-btn-ghost pg-tool" data-pg-retake="' + side + '">Retake</button>' : '') + '</div>' +
      '<div class="pg-check">' + rows + '<div class="pg-ck-foot">' + foot + '</div></div>';
    var rt = box.querySelector('[data-pg-retake]');
    if (rt) rt.addEventListener('click', function () { var inp = $('pg-file-' + side); if (inp) inp.click(); });
    var sw = box.querySelector('[data-pg-raw]');
    if (sw) sw.addEventListener('click', function () { usePhoto(side, p.file, chk, sw.getAttribute('data-pg-raw') === '1'); });
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
    renderChecks();
    var stage = $('pg-stage');
    if (!stage) return;
    var src = photoSrc(S.side);
    if (!src) {
      stage.innerHTML = '<div class="pg-stage-empty">Add a ' + S.side + ' photo to measure centering.<br><small>Take the card out of its sleeve, lay it flat on a plain surface, light it evenly and shoot straight down.<br>Full-art card? Put the orange lines on its printed frame.</small></div>';
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
        // a straightened photo already knows exactly where the card's edge is
        var known = S.photos[side] && S.photos[side].outer, oL, oR, oT, oB;
        if (known) { oL = Math.round(known.l * W); oR = Math.round(known.r * W); oT = Math.round(known.t * H); oB = Math.round(known.b * H); }
        else {
          oL = first(colScore, mx0, Math.round(W * 0.22), 0.3); oR = first(colScore, W - 1 - mx0, Math.round(W * 0.78), 0.3) + 1;
          oT = first(rowScore, my0, Math.round(H * 0.22), 0.3); oB = first(rowScore, H - 1 - my0, Math.round(H * 0.78), 0.3) + 1;
        }
        var cw = oR - oL, ch = oB - oT;
        // borders on One Piece, Pokémon and Yu-Gi-Oh! cards sit about 2–8% in from the edge
        var iL = first(colScore, oL + Math.max(3, Math.round(cw * 0.018)), oL + Math.round(cw * 0.085));
        var iR = first(colScore, oR - Math.max(4, Math.round(cw * 0.018)), oR - Math.round(cw * 0.085)) + 1;
        var iT = first(rowScore, oT + Math.max(3, Math.round(ch * 0.015)), oT + Math.round(ch * 0.075));
        var iB = first(rowScore, oB - Math.max(4, Math.round(ch * 0.015)), oB - Math.round(ch * 0.075)) + 1;
        S.guides[side] = { outer: known ? { l: known.l, r: known.r, t: known.t, b: known.b } : { l: oL / W, r: oR / W, t: oT / H, b: oB / H }, inner: { l: iL / W, r: iR / W, t: iT / H, b: iB / H }, set: true };
        if (st) st.textContent = 'Guides placed. Drag any line to fine-tune.';
        if (side === 'front' && S.wantIdentify) { S.wantIdentify = false; setTimeout(identify, 0); }
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

  // ── close-ups + whitening finder (defects.js) ──────────────────────────────
  var view = 'measure', finder = { front: null, back: null };
  var LEVEL = { corner: ['Sharp', 'Light', 'Worn'], edge: ['Clean', 'Minor', 'Chipped'] };
  var SHORT = { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right', t: 'Top edge', r: 'Right edge', b: 'Bottom edge', l: 'Left edge' };
  function clearIgnored(side) { Object.keys(S.ignored).forEach(function (k) { if (k.indexOf(side + '.') === 0) delete S.ignored[k]; }); }
  function cardMm() { return S.card.game === 'yugioh' ? 59 : 63; }
  // the full-quality copy when there is one (new photos), else the saved photo
  function scanSrc(side) { var p = S.photos[side]; return p ? (p.orig || photoSrc(side)) : null; }
  function scanKey(side) {
    var g = S.guides[side], src = scanSrc(side);
    return src && g.set ? src + '|' + [g.outer.l, g.outer.r, g.outer.t, g.outer.b].map(function (v) { return v.toFixed(4); }).join(',') + '|' + cardMm() : null;
  }
  // scans once per photo + card-edge position; moving the grey guides rescans
  function scanSide(side) {
    var key = scanKey(side), f = finder[side];
    if (!key || !window.ALRDefects) return Promise.resolve(null);
    if (f && f.key === key) return f.job;
    var job = window.ALRDefects.scan(scanSrc(side), S.guides[side].outer, { cardMm: cardMm() })
      .catch(function () { return { ok: false, warn: [] }; })
      .then(function (res) { if (finder[side] && finder[side].key === key) finder[side].res = res; return res; });
    finder[side] = { key: key, job: job, res: null, tiles: null };
    return job;
  }
  function rating(k) { return k.length === 2 ? S.corners[k] : S.edges[k]; }
  // a sleeve's shiny rim reads as whitening everywhere, so sleeved photos get no suggestions
  function flagged(side, res, k) { return res.areas[k].suggest > 0 && !S.ignored[side + '.' + k] && !sleeved(side); }
  function rings(list) {
    return list.map(function (c) {
      var a = 'cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" rx="' + (c.rx || c.r).toFixed(1) + '" ry="' + (c.ry || c.r).toFixed(1) + '"';
      return '<ellipse class="pg-ring-sh" ' + a + '/><ellipse class="pg-ring" ' + a + '/>';
    }).join('');
  }
  function sleeved(side) { var p = S.photos[side]; return !!(p && p.check && p.check.checks && p.check.checks.some(function (c) { return c.id === 'sleeve' && !c.ok; })); }
  function renderCloseups() {
    if (view !== 'closeups') return;
    var map = $('pg-map'), tiles = $('pg-tiles'), found = $('pg-found');
    if (!map || !tiles || !found) return;
    Array.prototype.forEach.call(document.querySelectorAll('#pg-cu-sides [data-side]'), function (b) { b.classList.toggle('on', b.getAttribute('data-side') === S.side); });
    var side = S.side, name = side === 'front' ? 'front' : 'back', D = window.ALRDefects;
    function only(msg) { map.innerHTML = '<div class="pg-empty">' + msg + '</div>'; tiles.innerHTML = ''; found.innerHTML = ''; }
    if (!D) return only('The finder isn’t available.');
    if (!scanSrc(side)) return only('Add a ' + name + ' photo to see its corners and edges up close.');
    if (!S.guides[side].set) return only('Set the card edge on the ' + name + ' photo first: Measure, then Auto-detect.');
    var f = finder[side];
    if (!f || f.key !== scanKey(side) || !f.res) {
      only('Scanning the corners and edges…');
      scanSide(side).then(function () { if (view === 'closeups' && S.side === side) renderCloseups(); });
      return;
    }
    var res = f.res;
    if (!res.ok) return only('Couldn’t scan this photo. Check the grey guides sit on the card’s edge.');
    if (!f.tiles) {
      f.tiles = {};
      D.AREAS.forEach(function (k) { f.tiles[k] = D.tile(res, k, k.length === 2 ? 360 : 1400, false, res.areas[k].spots); });
    }
    var list = D.AREAS.filter(function (k) { return flagged(side, res, k); });

    // defect map: the whole card, one numbered ring per area with findings
    var marks = '', nums = '';
    list.forEach(function (k, n) {
      var sp = res.areas[k].spots, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      sp.forEach(function (s) { x0 = Math.min(x0, s.x - s.r); x1 = Math.max(x1, s.x + s.r); y0 = Math.min(y0, s.y - s.r); y1 = Math.max(y1, s.y + s.r); });
      var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.max((x1 - x0) / 2, (y1 - y0) / 2, res.cw * 0.035) + res.cw * 0.01;
      marks += rings([{ x: cx, y: cy, r: r }]);
      var lx = Math.max(3, Math.min(97, (cx + r * 0.8) / res.W * 100)), ly = Math.max(3, Math.min(97, (cy - r * 0.8) / res.H * 100));
      nums += '<span class="pg-num" style="left:' + lx + '%;top:' + ly + '%">' + (n + 1) + '</span>';
    });
    map.innerHTML = '<div class="pg-map"><img src="' + esc(scanSrc(side)) + '" alt="' + name + ' photo with marks"><svg viewBox="0 0 ' + res.W + ' ' + res.H + '" aria-hidden="true">' + marks + '</svg>' + nums + '</div>' +
      '<div class="pg-sub" style="margin-top:12px">' + (list.length ? 'Found automatically: <b>' + list.length + (list.length === 1 ? ' area' : ' areas') + '</b>. You decide what counts.' : sleeved(side) ? 'Finder off: this photo looks sleeved.' : 'Nothing found on the ' + name + '’s corners or edges.') + '</div>';

    // close-ups
    function tileHtml(k) {
      var t = f.tiles[k], A = res.areas[k], ig = S.ignored[side + '.' + k], fl = flagged(side, res, k), lv = LEVEL[A.kind];
      var pill = '<span class="pg-pill' + (fl ? ' on' : '') + '">' + (ig ? 'Ignored' : fl ? lv[A.suggest] + '?' : sleeved(side) ? 'Not checked' : lv[0]) + '</span>';
      return '<div><button type="button" class="pg-tile' + (fl ? ' flag' : '') + '" data-pg-zoom="' + k + '" aria-label="Open the ' + D.NAMES[k].toLowerCase() + ' larger"><img src="' + t.url + '" alt="">' +
        (fl && t.rings.length ? '<svg viewBox="0 0 ' + t.w + ' ' + t.h + '" aria-hidden="true">' + rings(t.rings) + '</svg>' : '') +
        '</button><div class="pg-tcap"><b>' + SHORT[k] + '</b>' + pill + '</div></div>';
    }
    tiles.innerHTML = '<div class="pg-cu-lab">CORNERS</div><div class="pg-corners">' + ['tl', 'tr', 'bl', 'br'].map(tileHtml).join('') + '</div>' +
      '<div class="pg-cu-lab" style="margin-top:8px">EDGES <span style="letter-spacing:0;font-family:var(--bodyFont);font-weight:400">· laid flat, outer edge at the top</span></div><div class="pg-edges">' + ['t', 'r', 'b', 'l'].map(tileHtml).join('') + '</div>';
    Array.prototype.forEach.call(tiles.querySelectorAll('[data-pg-zoom]'), function (b) { b.addEventListener('click', function () { zoom(b.getAttribute('data-pg-zoom')); }); });

    // what it found
    var c = compute(), warn = sleeved(side) ? ['This photo looks sleeved, so the finder is off: a sleeve’s shiny rim looks like whitening. Take the card out and retake the photo.'] : (res.warn || []);
    var items = list.map(function (k, n) {
      var A = res.areas[k], lv = LEVEL[A.kind], cur = rating(k);
      var what = A.kind === 'corner'
        ? (A.count === 1 ? 'A white spot' : A.count + ' white spots') + ', about ' + A.mm2 + ' mm².'
        : 'Light marks along about ' + A.lenMm + ' mm of the edge.';
      var btns = cur >= A.suggest
        ? '<span class="pg-fd-ok">Marked ' + lv[cur] + ' in Inspection</span>'
        : '<button type="button" class="alr-lc-btn-primary" data-pg-set="' + k + '">Set ' + lv[A.suggest] + '</button>';
      return '<div class="pg-fd"><span class="pg-num">' + (n + 1) + '</span><div><b>' + D.NAMES[k] + '</b><br>' + what + ' Suggests <b>' + lv[A.suggest] + '</b>.' +
        '<div class="pg-fd-btns">' + btns + '<button type="button" class="alr-lc-btn-ghost" data-pg-ign="' + k + '">Ignore</button></div></div></div>';
    }).join('');
    var nIgn = D.AREAS.filter(function (k) { return S.ignored[side + '.' + k]; }).length;
    found.innerHTML = warn.map(function (w) { return '<div class="pg-warn">' + esc(w) + '</div>'; }).join('') +
      '<div class="pg-box">' + (items || '<div class="pg-empty">' + (sleeved(side) ? 'No suggestions for a sleeved photo. You can still look the corners and edges over in the close-ups.' : 'No whitening found on the ' + name + '’s corners or edges. Still look them over in the close-ups.') + '</div>') + '</div>' +
      (nIgn ? '<button type="button" class="pg-linkbtn" id="pg-unignore" style="align-self:flex-start">Show ' + nIgn + ' ignored</button>' : '') +
      '<div class="pg-now">In Inspection now: corners <b>' + fmt(c.sub.corners) + '</b> · edges <b>' + fmt(c.sub.edges) + '</b></div>';
    Array.prototype.forEach.call(found.querySelectorAll('[data-pg-set]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-pg-set');
        S[k.length === 2 ? 'corners' : 'edges'][k] = res.areas[k].suggest;
        renderInspect(); touched();
      });
    });
    Array.prototype.forEach.call(found.querySelectorAll('[data-pg-ign]'), function (b) {
      b.addEventListener('click', function () { S.ignored[side + '.' + b.getAttribute('data-pg-ign')] = true; S.dirty = true; renderCertBar(); renderCloseups(); });
    });
    var un = $('pg-unignore');
    if (un) un.addEventListener('click', function () { clearIgnored(side); renderCloseups(); });
  }
  // a close-up, larger, in a pop-up
  function zoom(k) {
    var f = finder[S.side], res = f && f.res, lb = $('pg-lb');
    if (!res || !res.ok || !lb) return;
    var fl = flagged(S.side, res, k), t = window.ALRDefects.tile(res, k, k.length === 2 ? 640 : 2400, false, res.areas[k].spots);
    $('pg-lb-t').textContent = window.ALRDefects.NAMES[k] + ' · ' + (S.side === 'front' ? 'front' : 'back');
    $('pg-lb-img').innerHTML = '<div class="pg-lb-in"><img src="' + t.url + '" width="' + t.w + '" height="' + t.h + '" alt="">' +
      (fl && t.rings.length ? '<svg viewBox="0 0 ' + t.w + ' ' + t.h + '" aria-hidden="true">' + rings(t.rings) + '</svg>' : '') + '</div>';
    lb.hidden = false;
    $('pg-lb-x').focus();
  }
  function unzoom() { var lb = $('pg-lb'); if (lb) { lb.hidden = true; $('pg-lb-img').innerHTML = ''; } }
  function setView(v) {
    view = v;
    $('pg-measure').hidden = v !== 'measure';
    $('pg-closeups').hidden = v !== 'closeups';
    $('pg-value').hidden = v !== 'value';
    Array.prototype.forEach.call(document.querySelectorAll('#pg-views [data-pgview]'), function (b) { b.classList.toggle('on', b.getAttribute('data-pgview') === v); });
    if (v === 'closeups') renderCloseups(); else if (v === 'value') renderValue(); else renderStage();
  }
  // close-ups for the report PDF, marks drawn in
  function closeupsForReport() {
    if (!window.ALRDefects) return Promise.resolve(null);
    var sides = ['front', 'back'].filter(function (sd) { return scanKey(sd); }), D = window.ALRDefects;
    return Promise.all(sides.map(scanSide)).then(function (rs) {
      var out = [];
      rs.forEach(function (res, i) {
        if (!res || !res.ok) return;
        var sd = sides[i];
        function part(k, size) {
          var A = res.areas[k], ig = S.ignored[sd + '.' + k], fl = flagged(sd, res, k);
          var t = D.tile(res, k, size, true, fl ? A.spots : []);
          return { label: SHORT[k], url: t.url, w: t.w, h: t.h, flag: fl, note: fl ? 'Suggests ' + LEVEL[A.kind][A.suggest] : ig ? 'Ignored' : 'Nothing found' };
        }
        out.push({
          side: sd === 'front' ? 'Front' : 'Back',
          corners: ['tl', 'tr', 'bl', 'br'].map(function (k) { return part(k, 420); }),
          edges: ['t', 'r', 'b', 'l'].map(function (k) { return part(k, 1600); })
        });
      });
      return out.length ? out : null;
    }).catch(function () { return null; });
  }

  // ── grade odds (shared by Measure and Worth it?) ───────────────────────────
  var COS = [['psa', 'PSA', '1–10'], ['tag', 'TAG', '1–10, halves'], ['bgs', 'Beckett', 'with sub-grades'], ['cgc', 'CGC', '1–10']];
  function oddsBox(c) {
    return '<div class="pg-est">' + COS.map(function (k) {
      var e = c.est[k[0]], shown = e.odds.filter(function (o) { return o[1] >= 0.03; }), rest = 1 - shown.reduce(function (a, o) { return a + o[1]; }, 0);
      var segs = shown.map(function (o) {
        var cls = o[0] === e.g ? 'o1' : o[0] > e.g ? 'o2' : 'o3';
        return '<i class="' + cls + '" style="flex:' + o[1] + '" title="' + k[1] + ' ' + fmt(o[0]) + ': ' + pct(o[1]) + '">' + (o[1] >= 0.12 ? fmt(o[0]) + ' · ' + pct(o[1]) : o[1] >= 0.06 ? fmt(o[0]) : '') + '</i>';
      }).join('') + (rest >= 0.01 ? '<i class="o4" style="flex:' + rest + '" title="Other grades: ' + pct(rest) + '"></i>' : '');
      return '<div class="pg-er"><div class="pg-co">' + k[1] + '<small>' + k[2] + '</small></div><div class="pg-odds">' + segs + '</div>' +
        '<div class="pg-gv">' + fmt(e.g) + '<small>most likely</small></div></div>';
    }).join('') + '</div>';
  }
  function weakBox(c) {
    var hb = holdingBack(c);
    return c.weak
      ? '<div class="pg-weak"><b>What’s holding it back:</b> ' + esc(c.weak) + '. ' + (hb ? esc(hb) + ' ' : '') + 'Check these again under angled light before you submit.</div>'
      : '<div class="pg-weak">No weak areas marked. Check corners and surface again under angled light before you submit.</div>';
  }

  // ── worth grading? ─────────────────────────────────────────────────────────
  // Raw price from the card database (editable). Graded prices and fees are typed in; fees are
  // remembered on this computer for the next card.
  var FEE_KEY = 'alr-pg-fees';
  function fees() { try { return JSON.parse(localStorage.getItem(FEE_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function setFee(co, v) { var f = fees(); if (v == null) delete f[co]; else f[co] = v; try { localStorage.setItem(FEE_KEY, JSON.stringify(f)); } catch (e) {} }
  function money(v) { var n = Math.abs(v); return (v < 0 ? '−' : '') + '$' + (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2)); }
  function moneyIn(v) { return v == null ? '' : String(v); }
  function readMoney(el) { var v = parseFloat(String(el.value).replace(/[$,\s]/g, '')); return isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null; }
  function coName(co) { return co === 'bgs' ? 'BGS' : co.toUpperCase(); }
  // expected outcome for one company; grades without a typed price count as the raw price
  function worth(c, co) {
    var V = S.value, raw = V.raw, fee = fees()[co], pr = V.prices[co] || {}, typed = Object.keys(pr).filter(function (g) { return pr[g] != null; }).length;
    if (raw == null || fee == null || !typed) return { ready: false, raw: raw, fee: fee, typed: typed };
    var ev = c.est[co].odds.reduce(function (a, o) { var v = pr[fmt(o[0])]; return a + o[1] * (v != null ? v : raw); }, 0);
    var net = ev - fee, gain = net - raw;
    return { ready: true, ev: ev, fee: fee, net: net, gain: gain, raw: raw, verdict: gain >= Math.max(5, raw * 0.15) ? 'Worth grading' : gain > 0 ? 'Worth it, barely' : 'Not worth it: sell raw' };
  }
  function renderValue() {
    if (view !== 'value') return;
    var left = $('pg-v-odds'), right = $('pg-v-worth');
    if (!left || !right) return;
    var c = compute(), V = S.value, co = V.co, card = S.card;
    left.innerHTML = '<div class="pg-subs">' + [['centering', 'Centering'], ['corners', 'Corners'], ['edges', 'Edges'], ['surface', 'Surface']].map(function (n) {
      var lo = Math.min(c.sub.centering, c.sub.corners, c.sub.edges, c.sub.surface);
      return '<div class="pg-sg' + (c.sub[n[0]] === lo && lo < 10 ? ' low' : '') + '"><span>' + n[1] + '</span><b>' + fmt(c.sub[n[0]]) + '</b></div>';
    }).join('') + '</div>' +
      '<div class="pg-cu-head"><div class="alr-lc-section-label">Grade odds</div><span class="pg-sub">How likely each grade is, not just one number</span></div>' +
      oddsBox(c) + weakBox(c) +
      '<div class="pg-sub">Odds allow for things a photo can miss: each sub-grade may really be a little lower (sometimes higher) than measured, and each company’s rules are applied to every case. Once real grades are logged they can be tuned against actual results.</div>';

    var img = card.official && G() ? G().shown(card.game, card.official, 200) : null, src = card.game && G() ? G().games[card.game].source : null;
    var rows = c.est[co].odds.filter(function (o) { return o[1] >= 0.03; }), pr = V.prices[co] || {};
    var q = [card.name, card.number, coName(co), fmt(c.est[co].g)].filter(Boolean).join(' ');
    right.innerHTML =
      '<div class="pg-vcard">' + (img ? '<img src="' + esc(img) + '" alt="">' : '') + '<div><b>' + esc(card.name || 'No card picked') + '</b>' +
        '<span>' + esc([card.number, card.setName].filter(Boolean).join(' · ')) + '</span>' +
        '<label class="pg-vin"><span>Raw (ungraded)</span><input class="alr-lc-input" id="pg-raw" inputmode="decimal" placeholder="$" value="' + esc(moneyIn(V.raw)) + '"></label>' +
        '<small>' + (V.raw == null ? (card.game ? 'No price in the card database. Type one in.' : 'Pick the card to fill this in.') : V.rawSrc === 'you' ? 'Typed by you' : 'Market price from ' + esc(V.rawSrc || src || 'the card database')) + '</small></div></div>' +
      '<div class="pg-seg" id="pg-v-cos">' + COS.map(function (k) { return '<button type="button" data-co="' + k[0] + '" class="' + (k[0] === co ? 'on' : '') + '">' + (k[0] === 'bgs' ? 'BGS' : k[1]) + '</button>'; }).join('') + '</div>' +
      '<div class="pg-box">' + rows.map(function (o) {
        return '<label class="pg-pr"><span>' + coName(co) + ' ' + fmt(o[0]) + ' sells for <small>' + pct(o[1]) + ' chance</small></span><input class="alr-lc-input" data-pg-price="' + fmt(o[0]) + '" inputmode="decimal" placeholder="$" value="' + esc(moneyIn(pr[fmt(o[0])])) + '"></label>';
      }).join('') +
        '<label class="pg-pr"><span>Grading fee + shipping, per card <small>remembered</small></span><input class="alr-lc-input" id="pg-fee" inputmode="decimal" placeholder="$" value="' + esc(moneyIn(fees()[co])) + '"></label></div>' +
      (card.name ? '<a class="pg-linkbtn" href="https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(q) + '&LH_Sold=1&LH_Complete=1">Look up sold ' + esc(coName(co)) + ' prices on eBay ↗</a>' : '') +
      '<div id="pg-verdict"></div>' +
      '<div class="pg-cu-lab">GAIN OVER RAW, BY COMPANY</div><div id="pg-gains"></div>' +
      '<div class="pg-disc">Graded prices are what you type, so check recent sold listings; prices move. Grades without a price count as the raw price. ' + (src ? 'Raw price from ' + esc(src) + '.' : '') + '</div>';
    Array.prototype.forEach.call(right.querySelectorAll('#pg-v-cos [data-co]'), function (b) {
      b.addEventListener('click', function () { V.co = b.getAttribute('data-co'); renderValue(); });
    });
    $('pg-raw').addEventListener('input', function (e) { V.raw = readMoney(e.target); V.rawSrc = 'you'; edited(); });
    $('pg-fee').addEventListener('input', function (e) { setFee(co, readMoney(e.target)); renderVerdict(); });
    Array.prototype.forEach.call(right.querySelectorAll('[data-pg-price]'), function (inp) {
      inp.addEventListener('input', function () { V.prices[co] = V.prices[co] || {}; V.prices[co][inp.getAttribute('data-pg-price')] = readMoney(inp); edited(); });
    });
    renderVerdict();
  }
  function edited() { S.dirty = true; renderCertBar(); renderVerdict(); }
  function renderVerdict() {
    var box = $('pg-verdict'), gains = $('pg-gains');
    if (!box || !gains) return;
    var c = compute(), co = S.value.co, w = worth(c, co);
    box.innerHTML = '<div class="pg-verd' + (w.ready ? '' : ' wait') + '"><div class="pg-cu-lab">VERDICT · ' + coName(co) + '</div>' + (w.ready
      ? '<b>' + w.verdict + '</b><p>Expected sale after grading <b>' + money(w.ev) + '</b>, minus ' + money(w.fee) + ' fees = <b>' + money(w.net) + '</b>. That’s <em class="' + (w.gain >= 0 ? 'up' : 'down') + '">' + (w.gain >= 0 ? '+' : '') + money(w.gain) + '</em> against selling it raw for ' + money(w.raw) + '.</p>'
      : '<p>' + (w.raw == null ? 'Add the raw price' : !w.typed ? 'Type what graded copies sell for' : 'Add your grading fee') + ' to see the verdict.</p>') + '</div>';
    var all = COS.map(function (k) { return [k[0], worth(c, k[0])]; }), top = Math.max.apply(null, all.map(function (x) { return x[1].ready ? Math.abs(x[1].gain) : 0; }).concat([1]));
    gains.innerHTML = all.map(function (x) {
      var w2 = x[1];
      return '<div class="pg-cmp"><b>' + coName(x[0]) + '</b><div class="pg-cb">' + (w2.ready && w2.gain > 0 ? '<i style="width:' + Math.round(w2.gain / top * 100) + '%"></i>' : '') + '</div>' +
        '<span' + (w2.ready && w2.gain < 0 ? ' class="down"' : '') + '>' + (w2.ready ? (w2.gain >= 0 ? '+' : '') + money(w2.gain) : 'no prices') + '</span></div>';
    }).join('');
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
      oddsBox(c) + weakBox(c);
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
      corners: S.corners, edges: S.edges, surface: S.surface, sub: c.sub, est: c.est, weak: c.weak, override: S.override, ignored: S.ignored,
      value: { raw: S.value.raw, rawSrc: S.value.rawSrc, co: S.value.co, prices: S.value.prices, fees: fees() }
    };
  }
  function labelFields(c) {
    var setLine = S.card.labelSet || [S.card.number, 'EN'].filter(Boolean).join(' · ') || (S.card.setName || '').toUpperCase().slice(0, 32);
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
    // the clean database image wherever there is one; your photo only if the card isn't listed
    var official = S.card.official || null, front = official ? null : photoSrc('front');
    Promise.all([window.ALRLabel.frontPng(v), closeupsForReport()]).then(function (got) {
      var png = got[0];
      return G().reportPdf({
        closeups: got[1],
        kind: 'pregrade', pregrade: snapshot(), cert: row.cert, certNo: S.cert_no,
        name: S.card.name || lf.name, set: S.card.setName, variant: S.card.printing, cardNumber: S.card.number,
        printing: S.card.printing, game: S.card.game ? G().gameName(S.card.game) : '', grade: lf.grade, gradeLabel: 'PRE-GRADE',
        date: new Date().toISOString().slice(0, 10), condition: {}, notes: S.notes, labelPng: png,
        photo: official || front || null, photoIsOfficial: !!official, photoSource: official ? G().games[S.card.game].source : null
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
  // Carries the card over for the final label: name, set line, variant, and the picked card
  // (game, number, set, printing, official image) so the Editor's reports use the clean image.
  function sendToEditor() {
    if (needCard()) return;
    function set(id, v) { var el = $(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }
    set('alr-lc-name', (S.card.name || '').toUpperCase().slice(0, 120));
    set('alr-lc-set', (S.card.labelSet || [S.card.number, 'EN'].filter(Boolean).join(' · ') || (S.card.setName || '').toUpperCase()).slice(0, 120));
    set('alr-lc-variant', (S.card.labelVariant || (S.card.printing || '').toUpperCase()).slice(0, 120));
    if (G() && G().setCard) G().setCard({ game: S.card.game, number: S.card.number, setName: S.card.setName, printing: S.card.printing, official: S.card.official });
    if (window.ALR_showView) window.ALR_showView('editor');
    var st = document.getElementById('alr-lc-status');
    if (st) st.textContent = 'Card details filled in from the pre-grade' + (S.cert ? ' (' + S.cert + ')' : '') + '. Set the final grade, then Save card.';
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
      ['corners', 'edges', 'surface', 'override', 'ignored'].forEach(function (k) { if (pg[k]) S[k] = pg[k]; });
      if (pg.value) { S.value = { raw: pg.value.raw != null ? pg.value.raw : null, rawSrc: pg.value.rawSrc || null, co: pg.value.co || 'psa', prices: Object.assign({ psa: {}, tag: {}, bgs: {}, cgc: {} }, pg.value.prices || {}) }; }
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
    $('pg-identify').addEventListener('click', identify);
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
    Array.prototype.forEach.call(document.querySelectorAll('#pg-cu-sides [data-side]'), function (b) {
      b.addEventListener('click', function () { S.side = b.getAttribute('data-side'); renderCloseups(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#pg-views [data-pgview]'), function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-pgview')); });
    });
    $('pg-lb-x').addEventListener('click', unzoom);
    $('pg-lb').addEventListener('click', function (e) { if (e.target === e.currentTarget) unzoom(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('pg-lb').hidden) unzoom(); });
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

  window.ALRPregrade = { load: load, reset: reset, refresh: function () { if (view === 'closeups') renderCloseups(); else if (view === 'value') renderValue(); else renderStage(); } };
  document.addEventListener('DOMContentLoaded', init);
})();
