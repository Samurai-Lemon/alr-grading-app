// ALR Grading: Pre-grade batch mode (desktop app only).
// Drop a stack of photos (front, back, front, back…). Each card in turn gets the photo check,
// straightening, centering, card recognition and the whitening finder on its own; you confirm the
// card, fix anything flagged, and save. The right-hand column ranks the cards by what grading
// would gain over selling raw. Each card is an ordinary pre-grade, so "Open full pre-grade" shows
// it in Measure / Close-ups / Worth it? as usual.
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function G() { return window.ALRGraded; }
  function A() { return window.ALRPregrade && window.ALRPregrade._batch; }
  var GAMES = [['one-piece', 'One Piece'], ['pokemon', 'Pokémon'], ['yugioh', 'Yu-Gi-Oh!']];
  var COS = [['psa', 'PSA'], ['tag', 'TAG'], ['bgs', 'BGS'], ['cgc', 'CGC']];

  // card: { label, files:{front,back}, st, status, step, matches, read, flags, picking, results, msg }
  // status: waiting | working | review | saved | skipped | error
  var B = { cards: [], cur: -1, pairs: true, co: 'psa', running: false };

  function natural(a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }); }
  function addFiles(list) {
    var files = Array.prototype.filter.call(list || [], function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name); }).sort(natural);
    if (!files.length) return;
    var step = B.pairs ? 2 : 1;
    for (var i = 0; i < files.length; i += step) {
      B.cards.push({ label: files[i].name, files: { front: files[i], back: B.pairs ? files[i + 1] || null : null }, st: null, status: 'waiting', matches: [], flags: null });
    }
    render();
    if (!B.running && B.cur < 0) next();
  }
  function card() { return B.cards[B.cur] || null; }
  // the Pre-grade tab may have moved to another card (New pre-grade, My Cards): bring this one back
  function ensure(c) { if (c && c.st && A().state() !== c.st) A().use(c.st); }
  function title(c) { return c.st && c.st.card && c.st.card.name ? c.st.card.name : c.label; }

  // ── the pipeline for one card ──────────────────────────────────────────────
  function step(c, msg) { c.step = msg; render(); }
  function process(i) {
    var c = B.cards[i], api = A();
    if (!c || !api) return;
    B.cur = i; B.running = true;
    c.st = api.blank(); c.st.batch = true; c.st.value.co = B.co; c.status = 'working';
    api.use(c.st);
    step(c, 'Checking the front photo…');
    api.takePhoto('front', c.files.front).then(function () {
      if (!c.files.back) return;
      step(c, 'Checking the back photo…');
      return api.takePhoto('back', c.files.back);
    }).then(function () {
      c.st.side = 'front';
      step(c, 'Reading the card… about 10–20 seconds');
      return api.recognise().then(function (res) {
        c.matches = (res.items || []).slice(0, 8);
        var r = res.read || {};
        c.read = r.code || (r.number ? r.number + (r.total ? '/' + r.total : '') : '') || '';
        if (r.back) c.back = true;
        if (res.game) api.game(res.game);
      }).catch(function () { c.matches = []; });
    }).then(function () {
      step(c, 'Checking corners and edges…');
      return api.flags().then(function (f) { c.flags = f; });
    }).then(function () {
      c.status = 'review'; c.step = ''; B.running = false; render();
    }).catch(function (e) {
      c.status = 'error'; c.step = ''; c.msg = (e && e.message) || 'Couldn’t read these photos.'; B.running = false; render();
    });
  }
  // the next card that hasn't been looked at yet
  function next() {
    for (var i = 0; i < B.cards.length; i++) if (B.cards[i].status === 'waiting') { process(i); return; }
    render();
  }
  function show(i) {
    var c = B.cards[i];
    if (!c || B.running || !c.st) return;
    B.cur = i; A().use(c.st); render();
  }

  // ── actions ────────────────────────────────────────────────────────────────
  function confirm(it) {
    var c = card();
    if (!c || !it) return;
    ensure(c); A().pick(it); c.picking = false; c.results = null; render();
  }
  function saveNext() {
    var c = card();
    if (!c || B.running) return;
    if (!(c.st.card.name || '').trim()) { c.msg = 'Pick the card first (Yes, or Pick another).'; render(); return; }
    c.msg = 'Saving…'; ensure(c); render();
    A().save().then(function (ok) {
      c.msg = ok ? '' : 'Couldn’t save. Check you’re signed in, then try again.';
      if (ok) { c.status = 'saved'; next(); } else render();
    });
  }
  function skip() {
    var c = card();
    if (!c || B.running) return;
    if (c.status === 'review') c.status = 'skipped';
    next();
  }
  function full() {
    var c = card();
    if (!c || !c.st || B.running) return;
    ensure(c); A().setView('measure');
  }
  // save every card that's been looked at but not saved yet, one at a time
  function saveRest() {
    if (B.running) return;
    var todo = B.cards.filter(function (c) { return c.st && (c.status === 'review' || c.status === 'skipped') && (c.st.card.name || '').trim(); });
    if (!todo.length) return;
    B.running = true; var done = 0, before = B.cur;
    function one(k) {
      if (k >= todo.length) {
        B.running = false; B.flash = 'Saved ' + done + ' of ' + todo.length + (done < todo.length ? '. Check you’re signed in for the rest.' : '.');
        if (B.cards[before] && B.cards[before].st) { B.cur = before; A().use(B.cards[before].st); }
        render(); return;
      }
      var c = todo[k]; B.cur = B.cards.indexOf(c); A().use(c.st);
      B.flash = 'Saving ' + (k + 1) + ' of ' + todo.length + '…'; render();
      A().save().then(function (ok) { if (ok) { c.status = 'saved'; done++; } one(k + 1); });
    }
    one(0);
  }

  // ── worth submitting ───────────────────────────────────────────────────────
  function ranked() {
    var api = A();
    return B.cards.filter(function (c) { return c.st && c.st.card && c.st.card.name; }).map(function (c) {
      var cc = api.compute(c.st);
      return { c: c, cc: cc, w: api.worth(cc, B.co, c.st) };
    }).sort(function (x, y) {
      if (x.w.ready !== y.w.ready) return x.w.ready ? -1 : 1;
      return x.w.ready ? y.w.gain - x.w.gain : 0;
    });
  }
  function listPdf() {
    var api = A(), list = ranked().filter(function (r) { return r.w.ready && r.w.gain > 0; });
    if (!list.length || !G()) return;
    B.flash = 'Making the list…'; render();
    Promise.all([G().loadPdf(), G().loadPdfFonts(), G().loadIcon()]).then(function (r) {
      var fonts = r[1], icon = r[2], doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
      doc.addFileToVFS('Inter-500.ttf', fonts[0]); doc.addFont('Inter-500.ttf', 'Inter', 'normal');
      doc.addFileToVFS('Inter-700.ttf', fonts[1]); doc.addFont('Inter-700.ttf', 'Inter', 'bold');
      doc.addFileToVFS('Mono-400.ttf', fonts[2]); doc.addFont('Mono-400.ttf', 'Mono', 'normal');
      var INK = [31, 27, 23], MUTED = [107, 98, 88], ACC = [168, 92, 66], LINE = [227, 221, 209], L = 40, R = 572;
      function font(f, st, size, col) { doc.setFont(f, st); doc.setFontSize(size); doc.setTextColor.apply(doc, col || INK); }
      var nm = api.coName(B.co), today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      function head() {
        if (icon) doc.addImage(icon, 'PNG', L, 36, 30, 30, 'icon', 'FAST');
        font('Mono', 'normal', 8, ACC); doc.setCharSpace(1.2); doc.text('ALR INITIATIVE GRADING', L + 40, 47); doc.setCharSpace(0);
        font('Inter', 'bold', 16); doc.text('Submission list · ' + nm, L + 40, 64);
        font('Inter', 'normal', 9, MUTED); doc.text(today, R, 64, { align: 'right' });
        doc.setDrawColor.apply(doc, INK); doc.setLineWidth(1.5); doc.line(L, 80, R, 80);
        font('Mono', 'normal', 7.5, MUTED);
        [['#', L], ['CARD', L + 22], ['NUMBER', L + 250], ['PRE-GRADE', L + 330], ['MOST LIKELY', L + 400], ['RAW', R - 60, 'right'], ['GAIN', R, 'right']].forEach(function (h) {
          doc.text(h[0], h[1], 98, h[2] ? { align: h[2] } : {});
        });
        return 112;
      }
      var y = head(), total = 0;
      list.forEach(function (x, i) {
        if (y > 730) { doc.addPage(); y = head(); }
        var c = x.c.st, e = x.cc.est[B.co];
        font('Inter', 'normal', 9, MUTED); doc.text(String(i + 1), L, y);
        font('Inter', 'bold', 9.5); doc.text(doc.splitTextToSize(c.card.name, 220)[0], L + 22, y);
        font('Inter', 'normal', 9); doc.text(String(c.card.number || '—'), L + 250, y);
        font('Mono', 'normal', 8.5); doc.text(c.cert || 'not saved', L + 330, y);
        font('Inter', 'normal', 9); doc.text(nm + ' ' + api.fmt(e.g) + ' (' + api.pct(api.chance(e, e.g)) + ')', L + 400, y);
        doc.text(api.money(x.w.raw), R - 60, y, { align: 'right' });
        font('Inter', 'bold', 9.5, ACC); doc.text('+' + api.money(x.w.gain), R, y, { align: 'right' });
        doc.setDrawColor.apply(doc, LINE); doc.setLineWidth(0.6); doc.line(L, y + 8, R, y + 8);
        total += x.w.gain; y += 22;
      });
      font('Inter', 'bold', 11); doc.text(list.length + (list.length === 1 ? ' card' : ' cards') + ' · combined expected gain +' + api.money(total) + ' after fees', L, y + 14);
      font('Inter', 'normal', 7.5, MUTED);
      doc.text(doc.splitTextToSize('Pre-grade estimates by the ALR Grading app. Gains use the graded prices and fees you typed and the odds for each grade; real results can differ. Not affiliated with PSA, TAG, Beckett or CGC.', R - L), L, 760);
      return G().saveFile(doc.output('blob'), 'ALR_submission_list_' + B.co.toUpperCase() + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
    }).then(function (msg) { B.flash = 'Saved ' + (msg || 'the list'); render(); })
      .catch(function () { B.flash = 'Couldn’t make the list.'; render(); });
  }

  // ── rendering ──────────────────────────────────────────────────────────────
  function thumb(c) {
    var p = c.st && c.st.photos.front, src = p ? (p.data || p.url) : null;
    return src ? '<img src="' + esc(src) + '" alt="">' : '<span class="pg-b-blank"></span>';
  }
  function render() {
    var stack = $('pg-b-stack'), mid = $('pg-b-card'), right = $('pg-b-worth');
    if (!stack || !mid || !right || $('pg-batch').hidden) return;
    var api = A(), done = B.cards.filter(function (c) { return c.status === 'saved' || c.status === 'skipped'; }).length;

    // stack
    var game = api.game();
    stack.innerHTML =
      '<div class="pg-b-prog"><div class="pg-b-bar"><i style="width:' + (B.cards.length ? Math.round(done / B.cards.length * 100) : 0) + '%"></i></div><span>' + done + ' of ' + B.cards.length + ' done</span></div>' +
      '<div class="alr-lc-games" id="pg-b-games">' + GAMES.map(function (g) { return '<button type="button" data-bgame="' + g[0] + '" class="' + (g[0] === game ? 'on' : '') + '">' + g[1] + '</button>'; }).join('') + '</div>' +
      '<label class="pg-b-drop" id="pg-b-drop"><input type="file" id="pg-b-files" accept="image/*" multiple hidden><b>Add photos</b><span>Drop a stack of photos here, or click to choose.</span></label>' +
      '<label class="pg-b-pairs"><input type="checkbox" id="pg-b-pairs"' + (B.pairs ? ' checked' : '') + '> Each card has a back photo (front, back, front, back…, in file-name order)</label>' +
      (B.cards.length ? '<div class="pg-box pg-b-list">' + B.cards.map(function (c, i) {
        var stTxt = c.status === 'working' ? 'Now' : c.status === 'review' ? 'Check' : c.status === 'saved' ? (c.st.cert || 'Saved') : c.status === 'skipped' ? 'Skipped' : c.status === 'error' ? 'Error' : '—';
        var est = c.st && c.st.card.name && (c.status !== 'working') ? api.coName(B.co) + ' ' + api.fmt(api.compute(c.st).est[B.co].g) : '';
        var sub = c.status === 'working' ? c.step : c.status === 'error' ? c.msg : c.st && c.st.card.number ? c.st.card.number : !c.files.back && B.pairs ? 'no back photo' : c.status === 'waiting' ? 'waiting' : c.read ? 'read ' + c.read : 'card not picked yet';
        return '<button type="button" class="pg-b-q' + (i === B.cur ? ' cur' : '') + '" data-bq="' + i + '"' + (B.running && i !== B.cur ? ' disabled' : '') + '>' +
          '<span class="pg-b-n">' + (i + 1) + '</span>' + thumb(c) +
          '<span class="pg-b-t"><b>' + esc(title(c)) + '</b><small>' + esc(sub || '') + '</small></span>' +
          '<span class="pg-b-s' + (c.status === 'working' || c.status === 'review' || c.status === 'error' ? ' ac' : '') + '">' + esc(est || stTxt) + '</span></button>';
      }).join('') + '</div>' : '') +
      (B.cards.length && !B.running ? '<button type="button" class="pg-linkbtn" id="pg-b-clear" style="align-self:flex-start">Clear the stack</button>' : '');

    // the card on screen
    var c = card();
    if (!c) {
      mid.innerHTML = '<div class="pg-empty">Add photos to start. Photo check, straightening, centering, card recognition and the whitening finder run on their own; you step in when something is flagged.</div>';
    } else if (c.status === 'working' || c.status === 'waiting') {
      mid.innerHTML = '<div class="alr-lc-section-label">Card ' + (B.cur + 1) + '</div><div class="pg-b-work">' + thumb(c) + '<div><b>' + esc(c.step || 'Waiting…') + '</b><span>' + esc(c.label) + (c.files.back ? ' + ' + esc(c.files.back.name) : '') + '</span></div></div>';
    } else if (c.status === 'error') {
      mid.innerHTML = '<div class="alr-lc-section-label">Card ' + (B.cur + 1) + '</div><div class="pg-warn">' + esc(c.msg) + '</div>';
    } else {
      var st = c.st, cc = api.compute(st), e = cc.est[B.co], picked = !!(st.card && st.card.name);
      var best = c.matches[0], img = function (it) { return it && it.img ? G().shown(it.game, it.img, 200) : null; };
      var matchHtml = picked
        ? '<div class="pg-box pg-b-match on">' + (st.card.official ? '<img src="' + esc(G().shown(st.card.game, st.card.official, 200)) + '" alt="">' : '') + '<div><b>' + esc(st.card.name) + '</b>' + esc([st.card.number, st.card.printing].filter(Boolean).join(' · ')) + '<br>' + esc(st.card.setName || '') + '</div></div>' +
          '<button type="button" class="pg-linkbtn" id="pg-b-repick" style="align-self:flex-start">Wrong card? Pick another</button>'
        : best && !c.picking
          ? '<div class="pg-sub">Best match' + (c.read ? ' (read ' + esc(c.read) + ')' : '') + '. Is this your card?</div><div class="pg-box pg-b-match">' + (img(best) ? '<img src="' + esc(img(best)) + '" alt="">' : '') + '<div><b>' + esc(best.title) + '</b>' + esc(best.sub || '') + '<br>' + esc(best.sub2 || '') + '</div></div>' +
            '<div class="pg-b-yn"><button type="button" class="alr-lc-btn-primary" id="pg-b-yes">Yes</button><button type="button" class="alr-lc-btn-ghost" id="pg-b-other">Pick another</button></div>'
          : '<div class="pg-sub">' + (c.back ? 'The first photo looks like a card back. Check the photo order (front, then back), or search:' : c.matches.length ? 'Pick your card, or search:' : 'Couldn’t recognise this card' + (c.read ? ' (read ' + esc(c.read) + ')' : '') + '. Search for it:') + '</div>' +
            '<div class="alr-lc-findrow"><input class="alr-lc-input" id="pg-b-q" type="search" placeholder="Name or card number"><button type="button" class="alr-lc-qbtn" id="pg-b-qbtn">Search</button></div>' +
            '<div class="alr-lc-tiles pg-b-tiles">' + (c.results || c.matches).map(function (it, k) {
              return '<button type="button" class="alr-lc-tile" data-bpick="' + k + '" title="' + esc(it.title + ' · ' + it.sub) + '">' + (img(it) ? '<img src="' + esc(img(it)) + '" alt="" loading="lazy">' : '<span class="alr-lc-tile-ph"></span>') + '<span class="alr-lc-tile-t">' + esc(it.title) + '</span><span class="alr-lc-tile-s">' + esc(it.sub) + '</span></button>';
            }).join('') + '</div>';
      var f = c.flags || { photo: [], finder: [] };
      var flagHtml = f.photo.map(function (x) { return '<div class="pg-b-flag"><span>' + esc((x.side === 'front' ? 'Front' : 'Back') + ' photo: ' + x.label) + '</span></div>'; }).join('') +
        f.finder.map(function (x, k) {
          var grp = x.kind === 'corner' ? st.corners : st.edges, set = (grp[x.k] || 0) >= x.suggest;
          return '<div class="pg-b-flag"><span>' + esc((x.side === 'front' ? 'Front' : 'Back') + ' ' + x.name.toLowerCase()) + ': suggests ' + esc(x.level) + '</span>' +
            (set ? '<small>set</small>' : '<button type="button" class="alr-lc-btn-ghost" data-bset="' + k + '">Set ' + esc(x.level) + '</button>') + '</div>';
        }).join('');
      var shownOdds = e.odds.filter(function (o) { return o[1] >= 0.05; }).map(function (o) { return api.coName(B.co) + ' ' + api.fmt(o[0]) + ' ' + api.pct(o[1]); }).join(' · ');
      var fee = api.fees()[B.co], V = st.value, pr = V.prices[B.co] || {};
      var priceRows = e.odds.filter(function (o) { return o[1] >= 0.1; }).map(function (o) {
        var g = api.fmt(o[0]);
        return '<label class="pg-pr"><span>' + api.coName(B.co) + ' ' + g + ' sells for <small>' + api.pct(o[1]) + '</small></span><input class="alr-lc-input" data-bprice="' + g + '" inputmode="decimal" placeholder="$" value="' + esc(pr[g] != null ? pr[g] : '') + '"></label>';
      }).join('');
      mid.innerHTML = '<div class="alr-lc-section-label">Card ' + (B.cur + 1) + ' <span class="pg-sub" style="font-weight:400">· quick pass</span></div>' +
        '<div class="pg-b-main"><div class="pg-b-photo">' + thumb(c) + '</div><div class="pg-b-side">' + matchHtml + '</div></div>' +
        '<div class="pg-subs">' + [['centering', 'Centering'], ['corners', 'Corners'], ['edges', 'Edges'], ['surface', 'Surface']].map(function (n) {
          return '<div class="pg-sg' + (cc.sub[n[0]] < 10 ? ' low' : '') + '"><span>' + n[1] + '</span><b>' + api.fmt(cc.sub[n[0]]) + '</b></div>';
        }).join('') + '</div>' +
        '<div class="pg-box pg-b-flags">' + (flagHtml || '<div class="pg-b-flag"><span>Nothing flagged</span></div>') + '<div class="pg-b-flag"><span><b>' + esc(api.coName(B.co) + ' ' + api.fmt(e.g)) + ' most likely</b> · ' + esc(shownOdds) + '</span></div></div>' +
        '<div class="pg-box">' +
          '<label class="pg-pr"><span>Raw (ungraded) <small>' + (V.raw == null ? 'no database price' : V.rawSrc === 'you' ? 'typed' : esc(V.rawSrc || '')) + '</small></span><input class="alr-lc-input" id="pg-b-raw" inputmode="decimal" placeholder="$" value="' + esc(V.raw != null ? V.raw : '') + '"></label>' +
          priceRows +
          '<label class="pg-pr"><span>Fee + shipping, per card <small>remembered</small></span><input class="alr-lc-input" id="pg-b-fee" inputmode="decimal" placeholder="$" value="' + esc(fee != null ? fee : '') + '"></label></div>' +
        (c.msg ? '<div class="pg-msg">' + esc(c.msg) + '</div>' : '') +
        '<button type="button" class="pg-linkbtn" id="pg-b-full" style="align-self:flex-start;font-size:13px">Open the full pre-grade for this card</button>';
    }

    // worth submitting
    var rk = ranked(), ready = rk.filter(function (r) { return r.w.ready; }), good = ready.filter(function (r) { return r.w.gain > 0; });
    var sum = good.reduce(function (a, r) { return a + r.w.gain; }, 0);
    var unsaved = B.cards.filter(function (x) { return x.st && (x.status === 'review' || x.status === 'skipped') && x.st.card.name; }).length;
    right.innerHTML =
      '<div class="pg-seg" id="pg-b-cos">' + COS.map(function (k) { return '<button type="button" data-bco="' + k[0] + '" class="' + (k[0] === B.co ? 'on' : '') + '">' + k[1] + '</button>'; }).join('') + '</div>' +
      '<div class="pg-sub">Sorted by gain over selling raw, using the prices you type for each card.</div>' +
      (rk.length ? '<div class="pg-box">' + rk.map(function (r) {
        var x = r.c, p = x.st.photos.front, src = x.st.card.official ? G().shown(x.st.card.game, x.st.card.official, 120) : p ? (p.data || p.url) : null;
        return '<button type="button" class="pg-b-wr" data-bq="' + B.cards.indexOf(x) + '"' + (B.running ? ' disabled' : '') + '>' + (src ? '<img src="' + esc(src) + '" alt="">' : '<span class="pg-b-blank"></span>') +
          '<span><b>' + esc(x.st.card.name) + '</b> · ' + esc(api.coName(B.co) + ' ' + api.fmt(r.cc.est[B.co].g)) + ' likely</span>' +
          '<span class="pg-b-gain' + (r.w.ready && r.w.gain > 0 ? '' : ' no') + '">' + (r.w.ready ? (r.w.gain >= 0 ? '+' : '') + api.money(r.w.gain) : 'add prices') + '</span></button>';
      }).join('') + '</div>' : '<div class="pg-sub">Cards show here once they’re identified.</div>') +
      '<div class="pg-verd' + (ready.length ? '' : ' wait') + '"><div class="pg-cu-lab">SO FAR</div><b>' + good.length + ' of ' + rk.length + ' worth sending</b><p>' +
        (ready.length ? 'Combined gain about <b>+' + api.money(sum) + '</b> after fees.' + (ready.length < rk.length ? ' ' + (rk.length - ready.length) + ' still need prices.' : '') : 'Type graded prices and your fee on each card to rank them.') + '</p></div>' +
      '<button type="button" class="alr-lc-btn-primary" id="pg-b-pdf"' + (good.length && !B.running ? '' : ' disabled') + '>' + (good.length === 1 ? 'Save this card as a list (PDF)' : good.length ? 'Save these ' + good.length + ' as a list (PDF)' : 'Save a list (PDF)') + '</button>' +
      '<button type="button" class="alr-lc-btn-ghost" id="pg-b-rest"' + (unsaved && !B.running ? '' : ' disabled') + '>Save the rest as pre-grades' + (unsaved ? ' (' + unsaved + ')' : '') + '</button>' +
      (B.flash ? '<div class="pg-msg">' + esc(B.flash) + '</div>' : '');
    // the card or the ranked stack, one at a time
    var review = !!B.review && rk.length > 0;
    mid.hidden = review; $('pg-b-worthcol').hidden = !review;
    var foot = $('pg-foot-batch'), canAct = c && !B.running && (c.status === 'review' || c.status === 'saved' || c.status === 'skipped' || c.status === 'error');
    if (foot) foot.innerHTML =
      (review ? '<button type="button" class="alr-lc-btn-ghost" id="pg-b-rev">Back to the card</button>'
        : '<button type="button" class="alr-lc-btn-ghost" id="pg-b-rev"' + (rk.length ? '' : ' disabled') + '>Review the stack' + (good.length ? ' · ' + good.length + ' worth sending' : '') + '</button>') +
      '<span class="pg-foot-t" style="margin-left:auto">' + (review || !canAct ? '' : '<span class="pg-kbd">Enter</span> saves · <span class="pg-kbd">→</span> skips') + '</span>' +
      (review ? '' : '<button type="button" class="alr-lc-btn-ghost" id="pg-b-skip"' + (canAct ? '' : ' disabled') + '>' + (c && c.status === 'saved' ? 'Next' : 'Skip') + '</button>' +
        '<button type="button" class="alr-lc-btn-primary" id="pg-b-save"' + (canAct && c.status !== 'error' ? '' : ' disabled') + '>' + (c && c.status === 'saved' ? 'Save changes & next' : 'Save & next card') + '</button>');
    var meta = $('pg-cert');
    if (meta && $('app-pregrade') && !$('pg-batch').hidden) meta.innerHTML = metaText();
    wire(c);
  }
  function metaText() {
    if (!B.cards.length) return 'NO PHOTOS YET';
    var done = B.cards.filter(function (c) { return c.status === 'saved' || c.status === 'skipped'; }).length;
    var good = ranked().filter(function (r) { return r.w.ready && r.w.gain > 0; });
    return done + ' OF ' + B.cards.length + ' DONE' + (good.length ? '<br>' + good.length + ' WORTH SENDING · ABOUT +' + A().money(good.reduce(function (a, r) { return a + r.w.gain; }, 0)) : '');
  }

  function wire(c) {
    function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
    var api = A();
    on('pg-b-files', 'change', function (e) { addFiles(e.target.files); e.target.value = ''; });
    var drop = $('pg-b-drop');
    if (drop) {
      ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('drag'); }); });
      ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('drag'); }); });
      drop.addEventListener('drop', function (e) { addFiles(e.dataTransfer && e.dataTransfer.files); });
    }
    on('pg-b-pairs', 'change', function (e) { B.pairs = e.target.checked; render(); });
    on('pg-b-clear', 'click', function () {
      Promise.resolve(window.ALR_confirm ? window.ALR_confirm('Clear the stack? Saved pre-grades stay in your account; unsaved cards are dropped.') : true).then(function (ok) {
        if (!ok) return;
        B.cards = []; B.cur = -1; B.flash = ''; A().use(A().blank()); render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#pg-b-games [data-bgame]'), function (b) {
      b.addEventListener('click', function () { api.game(b.getAttribute('data-bgame')); render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#pg-batch [data-bq]'), function (b) {
      b.addEventListener('click', function () { show(Number(b.getAttribute('data-bq'))); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#pg-b-cos [data-bco]'), function (b) {
      b.addEventListener('click', function () { B.co = b.getAttribute('data-bco'); render(); });
    });
    on('pg-b-pdf', 'click', listPdf);
    on('pg-b-rev', 'click', function () { B.review = !B.review; render(); });
    on('pg-b-rest', 'click', saveRest);
    if (!c) return;
    on('pg-b-yes', 'click', function () { confirm(c.matches[0]); });
    on('pg-b-other', 'click', function () { c.picking = true; render(); });
    on('pg-b-repick', 'click', function () { c.picking = true; c.st.card = { game: null, name: '', number: '', setName: '', printing: '', official: null }; api.touched(); render(); });
    Array.prototype.forEach.call(document.querySelectorAll('#pg-batch [data-bpick]'), function (b) {
      b.addEventListener('click', function () { confirm((c.results || c.matches)[Number(b.getAttribute('data-bpick'))]); });
    });
    function search() {
      var q = ($('pg-b-q').value || '').trim();
      if (q.length < 2 || !G()) return;
      c.results = []; render();
      G().search(api.game(), q).then(function (items) { c.results = items; c.msg = items.length ? '' : 'No cards found.'; render(); })
        .catch(function () { c.msg = 'Couldn’t reach the card database.'; render(); });
    }
    on('pg-b-qbtn', 'click', search);
    on('pg-b-q', 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    Array.prototype.forEach.call(document.querySelectorAll('#pg-batch [data-bset]'), function (b) {
      b.addEventListener('click', function () { var x = c.flags.finder[Number(b.getAttribute('data-bset'))]; ensure(c); api.rate(x.k, x.suggest); render(); });
    });
    function money(el) { var v = parseFloat(String(el.value).replace(/[$,\s]/g, '')); return isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null; }
    // typing updates the numbers on the right without redrawing the field being typed in
    function soft() { c.st.dirty = true; var r = $('pg-b-worth'); if (r) { var keep = document.activeElement && document.activeElement.id; render(); var el = keep && $(keep); if (el) { el.focus(); var n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} } } }
    on('pg-b-raw', 'input', function (e) { c.st.value.raw = money(e.target); c.st.value.rawSrc = 'you'; soft(); });
    on('pg-b-fee', 'input', function (e) { api.setFee(B.co, money(e.target)); soft(); });
    Array.prototype.forEach.call(document.querySelectorAll('#pg-batch [data-bprice]'), function (inp) {
      inp.addEventListener('input', function () {
        var g = inp.getAttribute('data-bprice');
        c.st.value.co = B.co; c.st.value.prices[B.co] = c.st.value.prices[B.co] || {}; c.st.value.prices[B.co][g] = money(inp);
        inp.id = 'pg-b-price-' + g.replace('.', '_'); soft();
      });
      inp.id = 'pg-b-price-' + inp.getAttribute('data-bprice').replace('.', '_');
    });
    on('pg-b-full', 'click', full);
    on('pg-b-skip', 'click', skip);
    on('pg-b-save', 'click', saveNext);
  }

  // keys, only while batch is on screen and you're not typing
  document.addEventListener('keydown', function (e) {
    var box = $('pg-batch'), app = $('app-pregrade');
    if (!box || box.hidden || !app || app.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    var c = card();
    if (!c || B.running) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (c.st && !c.st.card.name && c.matches[0] && !c.picking) confirm(c.matches[0]); else saveNext();
    } else if (e.key === 'ArrowRight') { e.preventDefault(); skip(); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); full(); }
  });

  window.ALRBatch = { render: render, meta: metaText };
})();
