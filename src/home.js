// ALR Grading: Home (the desk and the binder), Settings, the light/dark theme and the header search.
// Home reads the same cards as My Cards (graded_cards, kind 'pregrade' and 'grade').
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function G() { return window.ALRGraded; }
  function get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function coName(co) { return co === 'bgs' ? 'BGS' : String(co || 'psa').toUpperCase(); }
  function fmt(x) { return String(Math.round(Number(x) * 2) / 2); }
  function money(v) { var n = Math.abs(v); return (v < 0 ? '−' : '') + '$' + (n >= 100 ? Math.round(n).toLocaleString('en-US') : Math.round(n)); }
  function img(r, w) { return (r.official_image_url && G() ? G().shown(r.game, r.official_image_url, w || 200) : null) || (G() ? G().photoUrl(r.front_photo_path) : null); }

  // ── theme (light like alrinitiative.com, dark, or follow the computer) ─────
  function applyTheme() {
    var t = get('alr-theme', 'light');
    var eff = t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
    document.documentElement.setAttribute('data-theme', eff);
    Array.prototype.forEach.call(document.querySelectorAll('#st-theme [data-theme]'), function (b) { b.classList.toggle('on', b.getAttribute('data-theme') === t); });
  }
  function setTheme(t) { put('alr-theme', t); applyTheme(); }

  // ── Home: the binder ─────────────────────────────────────────────────────
  // rows: the account's cards, newest first. offline: the last load couldn't reach the server,
  // so the binder shows the copy saved on this computer (alr-home-cache).
  var rows = null, loading = false, offline = false, page = 0, played = false, turn = '', PER = 8, CACHE = 'alr-home-cache';
  function cacheRows(list) { try { localStorage.setItem(CACHE, JSON.stringify(list.slice(0, 48))); } catch (e) {} }
  function cachedRows() { try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) { return null; } }
  function load(force) {
    if (loading || (rows && !force)) { renderHome(); return; }
    loading = true;
    window.ALR_supabase().then(function (sb) {
      return sb.auth.getSession().then(function (res) {
        if (!res.data || !res.data.session) { rows = []; offline = false; return; }
        return sb.from('graded_cards').select('id, kind, cert, cert_no, game, card_name, card_number, set_name, printing, grade, grade_label, official_image_url, front_photo_path, created_at, pregrade')
          .order('created_at', { ascending: false }).then(function (r) {
            if (r.error) throw r.error;
            rows = r.data || []; offline = false; cacheRows(rows);
          });
      });
    }).catch(function () {
      // couldn't reach the server: show what was saved here last time
      offline = true; rows = cachedRows() || [];
    }).then(function () { loading = false; renderHome(); var m = $('cards-meta'), s = $('app-search'); if (m && !(s && s.value.trim())) m.innerHTML = cardsMeta(); });
  }
  // what grading a saved pre-grade would gain over selling raw, from the prices typed for it
  function gain(pg) {
    var v = pg && pg.value, co = v && v.co || 'psa', e = pg && pg.est && pg.est[co];
    if (!v || v.raw == null || !e || !e.odds) return null;
    var pr = (v.prices || {})[co] || {}, fee = v.fees && v.fees[co];
    if (fee == null || !Object.keys(pr).some(function (k) { return pr[k] != null; })) return null;
    var ev = e.odds.reduce(function (a, o) { var p = pr[fmt(o[0])]; return a + o[1] * (p != null ? p : v.raw); }, 0);
    return ev - fee - v.raw;
  }
  function said(pg) { var co = (pg.value && pg.value.co) || 'psa', e = pg.est && pg.est[co]; return e && e.g != null ? coName(co) + ' ' + fmt(e.g) : ''; }
  // the tag on a sleeve: a real grade in black, a pre-grade outlined
  function tag(r) {
    var pg = r.pregrade || {};
    if (r.kind !== 'pregrade') return r.grade != null ? '<span class="bd-tag">ALR ' + esc(r.grade) + '</span>' : '';
    if (pg.real && pg.real.g != null) return '<span class="bd-tag">' + esc(coName(pg.real.co) + ' ' + pg.real.g) + '</span>';
    var t = said(pg); return t ? '<span class="bd-tag pre">PRE ' + esc(t.split(' ').pop()) + '</span>' : '';
  }
  var PLUS = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  function note(n, text, attrs, cls) {
    var tagName = attrs ? 'button type="button" ' + attrs : 'div';
    return '<' + tagName + ' class="bd-note' + (cls ? ' ' + cls : '') + '"><b>' + n + '</b><span>' + text + '</span></' + (attrs ? 'button' : 'div') + '>';
  }
  // the opening animation, once per launch: the cards start stacked in the middle of the binder
  // and deal out into their sleeves; the desk card drops in and the words fade up
  // waits for the splash and for the first page's pictures to decode, so nothing stutters mid-deal
  function maybeDeal() {
    var home = $('app-home');
    if (played || rows === null || !home || home.hidden || !window.ALR_splashDone) return;
    played = true;
    var imgs = Array.prototype.slice.call(home.querySelectorAll('#bd-sleeves img, .bd-desk img'));
    var ready = Promise.all(imgs.map(function (im) { return im.decode ? im.decode().catch(function () {}) : null; }));
    Promise.race([ready, new Promise(function (r) { setTimeout(r, 900); })]).then(function () {
      requestAnimationFrame(function () { deal(home); });
    });
  }
  function deal(home) {
    var grid = $('bd-sleeves'), g = grid.getBoundingClientRect(), cx = g.left + g.width / 2, cy = g.top + g.height / 2;
    Array.prototype.forEach.call(grid.children, function (el, i) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--dx', Math.round(cx - (r.left + r.width / 2)) + 'px');
      el.style.setProperty('--dy', Math.round(cy - (r.top + r.height / 2)) + 'px');
      el.style.setProperty('--r', ((i * 37) % 17 - 8) + 'deg');
    });
    home.classList.remove('intro'); void home.offsetWidth; home.classList.add('intro'); home.classList.remove('wait');
    setTimeout(function () { home.classList.remove('intro'); }, 2600);
  }
  function renderHome() {
    if (!$('bd-h')) return;
    var acct = window.ALR_account ? window.ALR_account() : null, list = rows || [];
    var pre = list.filter(function (r) { return r.kind === 'pregrade'; });
    var gains = pre.map(function (r) { return gain(r.pregrade); }).filter(function (g) { return g != null && g > 0; });
    var waiting = pre.filter(function (r) { return !(r.pregrade && r.pregrade.real); });
    var s = window.ALRPregrade && window.ALRPregrade.summary ? window.ALRPregrade.summary() : null;
    var none = !list.length, first = !acct && none;
    var h = new Date().getHours(), hello = h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';

    $('bd-off').hidden = !offline;
    $('bd-date').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    $('bd-h').innerHTML = s ? hello + '<br><i>One card on the desk.</i>'
      : first ? 'Welcome to ALR Grading.<br><i>Your binder is empty.</i>'
      : none ? (rows ? hello + '<br><i>Nothing in the binder yet.</i>' : hello)
      : hello + '<br><i>The desk is clear.</i>';
    $('bd-intro').hidden = !first;
    $('bd-intro').textContent = 'Pre-grade a card from a photo, see what PSA, TAG, Beckett and CGC would likely give it, and keep every card in one binder.';

    // the desk: the pre-grade you're in the middle of, or an empty space for the next card
    $('bd-desk').innerHTML = s
      ? '<figure class="bd-desk">' + (s.img ? '<img src="' + esc(s.img) + '" alt="' + esc(s.name) + ', in progress">' : '<div class="bd-empty"></div>') +
        '<figcaption><b>' + esc(s.name) + '</b><span>' + (s.sub ? esc(s.sub) + '. ' : '') + (s.saved ? 'Unsaved changes to ' + esc(s.cert) : 'Not saved yet') + '; next: ' + esc(s.step.toLowerCase()) + '.</span>' +
        '<button type="button" class="app-b pri" data-view="pregrade">Carry on</button></figcaption></figure>'
      : '<figure class="bd-desk"><div class="bd-empty' + (none ? ' first' : '') + '">' + PLUS + '</div><figcaption>' +
        '<b>' + (none ? 'Your first card goes here' : 'Nothing in progress') + '</b>' +
        '<span>' + (none ? 'Photograph the front, out of the sleeve, on a dark plain surface.' : 'Add a photo of the next card to pre-grade it.') + '</span>' +
        '<button type="button" class="app-b pri" data-view="pregrade">' + (none ? 'Pre-grade your first card' : 'Pre-grade a card') + '</button></figcaption></figure>';
    $('bd-acts').innerHTML = first ? ''
      : '<button type="button" class="app-b sec" data-view="batch">A whole stack</button><button type="button" class="app-b sec" data-view="editor">Make a label</button>';

    // the notes under the desk
    var notes;
    if (!acct) notes = note('Sign in', 'to keep your cards here and on alrinitiative.com. Optional.', 'id="bd-signin"', 'txt') +
      note('Slabbed?', 'Make an ALR label for a graded card.', 'data-view="editor"', 'txt');
    else if (none) notes = note(rows ? '0' : '…', rows ? 'cards in your account so far' : 'loading your cards') + note('Slabbed?', 'Make an ALR label for a graded card.', 'data-view="editor"', 'txt');
    else notes = note(gains.length, gains.length ? 'worth sending, about +' + money(gains.reduce(function (a, b) { return a + b; }, 0)) : 'worth sending yet; add prices in Worth it?', 'data-view="cards"') +
      note(waiting.length, waiting.length === 1 ? 'pre-grade waiting on a real grade' : 'pre-grades waiting on a real grade', 'data-view="cards"');
    $('bd-notes').innerHTML = notes;

    // the binder: 8 sleeves a page
    var pages = Math.max(1, Math.ceil(list.length / PER));
    if (page >= pages) page = pages - 1;
    var shown = list.slice(page * PER, page * PER + PER);
    $('bd-count').textContent = none ? (acct || offline ? 'empty' : 'sign in to see your cards') : 'page ' + (page + 1) + ' of ' + pages + ' · ' + list.length + (list.length === 1 ? ' card' : ' cards');
    $('bd-nav').innerHTML = (page > 0 ? '<button type="button" id="bd-prev">← Back a page</button>' : '') +
      (page < pages - 1 ? '<button type="button" id="bd-next">Turn the page →</button>' : '') +
      (!none ? '<button type="button" data-view="cards">All cards</button>' : '');
    var cells = shown.map(function (r) {
      var src = img(r, 240);
      return '<button type="button" class="bd-sl" data-open="' + esc(r.id) + '" data-kind="' + esc(r.kind || 'grade') + '" title="' + esc(r.card_name || '') + '">' +
        (src ? '<img src="' + esc(src) + '" alt="' + esc(r.card_name || '') + '">' : '<span class="bd-ph"></span>') + tag(r) + '</button>';
    });
    var fill = none ? 4 : (4 - cells.length % 4) % 4;
    for (var i = 0; i < fill; i++) cells.push('<div class="bd-sl none" aria-hidden="true"><span class="bd-ph"></span></div>');
    $('bd-sleeves').innerHTML = cells.join('');
    $('bd-how').innerHTML = none
      ? '<div class="bd-hl">HOW IT WORKS</div><div class="bd-steps">' +
        '<div class="bd-step"><i>1</i><div><b>Photograph it</b>Front and back. The app finds the card and straightens the photo.</div></div>' +
        '<div class="bd-step"><i>2</i><div><b>Check it</b>Centering is measured; look over the corners, edges and surface.</div></div>' +
        '<div class="bd-step"><i>3</i><div><b>See the grade</b>The likely grade at each company, and whether it’s worth sending.</div></div></div>'
      : '';

    var home = $('app-home');
    Array.prototype.forEach.call($('bd-sleeves').children, function (el, i) { el.style.setProperty('--i', i); });
    home.classList.toggle('wait', !played);
    if (!played) maybeDeal();
    else if (turn) { var sl = $('bd-sleeves'); sl.classList.remove('turn-n', 'turn-p'); void sl.offsetWidth; sl.classList.add('turn-' + turn); }
    turn = '';

    Array.prototype.forEach.call(document.querySelectorAll('#app-home [data-open]'), function (b) {
      b.addEventListener('click', function () { if (window.ALR_openEdit) window.ALR_openEdit(b.getAttribute('data-open'), b.getAttribute('data-kind')); });
    });
    var si = $('bd-signin'); if (si) si.addEventListener('click', function () { window.ALR_signIn(); });
    var pv = $('bd-prev'); if (pv) pv.addEventListener('click', function () { page--; turn = 'p'; renderHome(); });
    var nx = $('bd-next'); if (nx) nx.addEventListener('click', function () { page++; turn = 'n'; renderHome(); });
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  var FEES = 'alr-pg-fees';
  function fees() { try { return JSON.parse(localStorage.getItem(FEES) || '{}') || {}; } catch (e) { return {}; } }
  function renderSettings() {
    var acct = window.ALR_account ? window.ALR_account() : null, box = $('st-account');
    if (!box) return;
    box.innerHTML = acct
      ? '<div><b>' + esc(acct.name) + '</b><span class="d">Signed in to alrinitiative.com' + (acct.email && acct.email !== acct.name ? ' as ' + esc(acct.email) : '') + '. Saved cards show on your Account page.</span></div><button type="button" class="app-b sec sm" id="st-out">Sign out</button>'
      : '<div><b>Not signed in</b><span class="d">Sign in with your alrinitiative.com account to save cards and pre-grades.</span></div><button type="button" class="app-b pri sm" id="st-in">Sign in</button>';
    var o = $('st-out'); if (o) o.addEventListener('click', function () { window.ALR_signOut(); });
    var i = $('st-in'); if (i) i.addEventListener('click', function () { window.ALR_signIn(); });
    applyTheme();
    function pills(id, key, def) {
      var v = get(key, def);
      Array.prototype.forEach.call(document.querySelectorAll('#' + id + ' [data-v]'), function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
    }
    pills('st-game', 'alr-pg-game', 'one-piece');
    pills('st-co', 'alr-pg-co', 'psa');
    var f = fees();
    $('st-fees').innerHTML = [['psa', 'PSA'], ['tag', 'TAG'], ['bgs', 'BGS'], ['cgc', 'CGC']].map(function (c) {
      return '<label>' + c[1] + '<input class="st-in" data-fee="' + c[0] + '" inputmode="decimal" placeholder="$" value="' + (f[c[0]] != null ? '$' + f[c[0]] : '') + '"></label>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#st-fees [data-fee]'), function (inp) {
      inp.addEventListener('change', function () {
        var all = fees(), v = parseFloat(String(inp.value).replace(/[$,\s]/g, ''));
        if (isFinite(v) && v >= 0) all[inp.getAttribute('data-fee')] = Math.round(v * 100) / 100; else delete all[inp.getAttribute('data-fee')];
        put(FEES, JSON.stringify(all));
        inp.value = all[inp.getAttribute('data-fee')] != null ? '$' + all[inp.getAttribute('data-fee')] : '';
      });
    });
  }

  // ── header search: filters My Cards as you type ───────────────────────────
  function search(q) {
    q = String(q || '').trim().toLowerCase();
    var cards = document.querySelectorAll('#alr-account-graded .alr-gc');
    var shown = 0;
    Array.prototype.forEach.call(cards, function (el) {
      var hit = !q || el.textContent.toLowerCase().indexOf(q) >= 0;
      el.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    var meta = $('cards-meta');
    if (meta) { if (q) meta.textContent = shown + ' MATCH' + (shown === 1 ? '' : 'ES') + ' FOR “' + q.toUpperCase() + '”'; else meta.innerHTML = cardsMeta(); }
  }
  // My Cards hero: totals and how close the pre-grades have been
  function cardsMeta() {
    var list = rows || [], pre = list.filter(function (r) { return r.kind === 'pregrade'; });
    if (!list.length) return 'SYNCED WITH ALRINITIATIVE.COM';
    var waiting = pre.filter(function (r) { return !(r.pregrade && r.pregrade.real); }).length;
    var back = pre.filter(function (r) { var pg = r.pregrade || {}, co = pg.real && pg.real.co; return co && pg.est && pg.est[co] && pg.est[co].g != null; });
    var near = back.filter(function (r) { var pg = r.pregrade; return Math.abs(Number(pg.real.g) - Number(pg.est[pg.real.co].g)) <= 1; }).length;
    return esc(list.length + (list.length === 1 ? ' CARD' : ' CARDS') + ' · ' + waiting + ' WAITING ON A GRADE') + (back.length ? '<br>PRE-GRADES WITHIN 1 GRADE: ' + near + ' OF ' + back.length : '') + '<br>SYNCED WITH ALRINITIATIVE.COM';
  }

  function init() {
    applyTheme();
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) {}
    $('app-theme-btn').addEventListener('click', function () { setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); renderSettings(); });
    Array.prototype.forEach.call(document.querySelectorAll('#st-theme [data-theme]'), function (b) {
      b.addEventListener('click', function () { setTheme(b.getAttribute('data-theme')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#st-game [data-v]'), function (b) {
      b.addEventListener('click', function () { put('alr-pg-game', b.getAttribute('data-v')); if (window.ALRPregrade && window.ALRPregrade.game) window.ALRPregrade.game(b.getAttribute('data-v')); renderSettings(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#st-co [data-v]'), function (b) {
      b.addEventListener('click', function () { put('alr-pg-co', b.getAttribute('data-v')); renderSettings(); });
    });
    var T = window.__TAURI__;
    var ver = $('st-version');
    if (ver) {
      if (T && T.app && T.app.getVersion) T.app.getVersion().then(function (v) { ver.textContent = 'VERSION ' + v; }).catch(function () {});
      else ver.textContent = 'DESKTOP APP';
    }
    var s = $('app-search'), t = null;
    s.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        if (s.value.trim() && window.ALR_showView && $('app-cards').hidden) window.ALR_showView('cards');
        search(s.value);
      }, 150);
    });
    // My Cards re-renders after loading: keep the search applied
    var list = $('alr-account-graded');
    if (list && window.MutationObserver) new MutationObserver(function () { if (s.value.trim()) search(s.value); }).observe(list, { childList: true });
    document.addEventListener('alr-view', function (e) {
      if (e.detail === 'home') { load(false); maybeDeal(); }
      if (e.detail === 'cards') load(true);
      if (e.detail === 'settings') renderSettings();
    });
    document.addEventListener('alr-splash-done', maybeDeal);
    // the sign-in check fires a few times at launch (stored session, token refresh): only reload when the account changes
    var who = undefined;
    document.addEventListener('alr-account', function (e) {
      var a = e.detail ? (e.detail.email || e.detail.name) : null;
      renderSettings();
      if (a === who) return;
      who = a; rows = null; page = 0; load(true);
    });
    $('bd-retry').addEventListener('click', function () { load(true); });
    window.addEventListener('online', function () { if (offline) load(true); });
    window.addEventListener('offline', function () { offline = true; renderHome(); });
    renderSettings();
    load(true);
  }
  document.addEventListener('DOMContentLoaded', init);
  // a save anywhere refreshes Home's numbers next time it's shown
  window.ALRHome = { refresh: function () { rows = null; } };
})();
