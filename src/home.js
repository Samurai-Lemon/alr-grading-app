// ALR Grading: Home (the Grading Desk), Settings, the light/dark theme and the header search.
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
  function pic(src, cls) { return src ? '<img src="' + esc(src) + '" alt="" loading="lazy">' : '<span class="hm-ph' + (cls ? ' ' + cls : '') + '"></span>'; }

  // ── theme (light like alrinitiative.com, dark, or follow the computer) ─────
  function applyTheme() {
    var t = get('alr-theme', 'light');
    var eff = t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
    document.documentElement.setAttribute('data-theme', eff);
    Array.prototype.forEach.call(document.querySelectorAll('#st-theme [data-theme]'), function (b) { b.classList.toggle('on', b.getAttribute('data-theme') === t); });
  }
  function setTheme(t) { put('alr-theme', t); applyTheme(); }

  // ── Home ─────────────────────────────────────────────────────────────────
  var rows = null, loading = false;
  function load(force) {
    if (loading || (rows && !force)) { renderHome(); return; }
    loading = true;
    window.ALR_supabase().then(function (sb) {
      return sb.auth.getSession().then(function (res) {
        if (!res.data || !res.data.session) { rows = []; return; }
        return sb.from('graded_cards').select('id, kind, cert, cert_no, game, card_name, card_number, set_name, printing, grade, grade_label, official_image_url, front_photo_path, created_at, pregrade')
          .order('created_at', { ascending: false }).then(function (r) { rows = r.error ? [] : (r.data || []); });
      });
    }).catch(function () { rows = []; }).then(function () { loading = false; renderHome(); var m = $('cards-meta'), s = $('app-search'); if (m && !(s && s.value.trim())) m.innerHTML = cardsMeta(); });
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
  function renderHome() {
    if (!$('hm-stats')) return;
    var acct = window.ALR_account ? window.ALR_account() : null, list = rows || [];
    var pre = list.filter(function (r) { return r.kind === 'pregrade'; });
    var monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    var thisMonth = pre.filter(function (r) { return new Date(r.created_at) >= monthStart; }).length;
    var weekAgo = Date.now() - 7 * 864e5, thisWeek = pre.filter(function (r) { return new Date(r.created_at).getTime() >= weekAgo; }).length;
    var gains = pre.map(function (r) { return gain(r.pregrade); }).filter(function (g) { return g != null && g > 0; });
    var waiting = pre.filter(function (r) { return !(r.pregrade && r.pregrade.real); });
    var back = pre.filter(function (r) { var pg = r.pregrade || {}, co = pg.real && pg.real.co; return co && pg.est && pg.est[co] && pg.est[co].g != null; });
    var near = back.filter(function (r) { var pg = r.pregrade; return Math.abs(Number(pg.real.g) - Number(pg.est[pg.real.co].g)) <= 1; }).length;

    $('hm-meta').innerHTML = acct
      ? esc(list.length + (list.length === 1 ? ' CARD' : ' CARDS') + ' · ' + waiting.length + ' WAITING ON A GRADE') + '<br>SYNCED WITH ALRINITIATIVE.COM<br>' + esc(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase())
      : 'NOT SIGNED IN<br>SIGN IN TO SYNC YOUR CARDS';
    $('hm-stats').innerHTML =
      '<div class="app-card hm-stat"><span>Pre-graded this month</span><b>' + thisMonth + '</b><small>' + thisWeek + ' in the last 7 days</small></div>' +
      '<div class="app-card hm-stat"><span>Worth sending</span><b>' + gains.length + '</b><small>' + (gains.length ? 'about +' + money(gains.reduce(function (a, b) { return a + b; }, 0)) + ' over selling raw' : 'add prices in Worth it?') + '</small></div>' +
      '<div class="app-card hm-stat"><span>Waiting on a grade</span><b class="ac">' + waiting.length + '</b><small>pre-grades with no real grade yet</small></div>' +
      '<div class="app-card hm-stat"><span>Pre-grade accuracy</span><b>' + (back.length ? near + '/' + back.length : '—') + '</b><small>' + (back.length ? 'within 1 grade' : 'shows once a grade comes back') + '</small></div>';

    // the pre-grade on screen, if it isn't saved yet
    var s = window.ALRPregrade && window.ALRPregrade.summary ? window.ALRPregrade.summary() : null;
    $('hm-resume').innerHTML = s
      ? '<div class="hm-resume">' + pic(s.img) + '<div><b>' + esc(s.name) + (s.sub ? ' · ' + esc(s.sub) : '') + '</b><span>' + (s.saved ? 'Unsaved changes to ' + esc(s.cert) : 'Not saved yet') + ' · next: ' + esc(s.step.toLowerCase()) + '</span></div><button type="button" class="app-b pri sm" data-view="pregrade">Continue</button></div>'
      : '<div class="hm-empty">Nothing in progress. <button type="button" class="hm-link" style="margin:0" data-view="pregrade">Start a pre-grade</button></div>';

    $('hm-recent').innerHTML = !acct
      ? '<div class="hm-empty">Sign in to see your cards here. <button type="button" class="hm-link" style="margin:0" id="hm-signin">Sign in</button></div>'
      : !list.length
      ? '<div class="hm-empty">' + (rows ? 'No cards yet. Pre-grade one, or make a label and save it.' : 'Loading your cards…') + '</div>'
      : '<div class="hm-tiles">' + list.slice(0, 5).map(function (r) {
          var pg = r.pregrade || {}, isPre = r.kind === 'pregrade';
          var line = isPre ? (pg.real ? '<span class="hm-ok">' + esc(coName(pg.real.co) + ' ' + pg.real.g) + '</span>' : 'Pre · ' + esc(said(pg))) : 'ALR label · ' + esc(r.grade);
          return '<button type="button" class="hm-tile" data-open="' + esc(r.id) + '" data-kind="' + esc(r.kind || 'grade') + '">' + pic(img(r, 240)) + '<b>' + esc(r.card_name) + '</b><span>' + line + '</span></button>';
        }).join('') + '</div>';
    $('hm-all').textContent = list.length ? 'All ' + list.length : 'All cards';

    $('hm-wait-n').textContent = waiting.length ? waiting.length + ' pre-graded' : '';
    $('hm-wait').innerHTML = !acct
      ? '<div class="hm-empty">Sign in to track your pre-grades.</div>'
      : !waiting.length
      ? '<div class="hm-empty">Nothing waiting. When a card comes back from grading, enter its grade here to see how close the pre-grade was.</div>'
      : waiting.slice(0, 5).map(function (r) {
          return '<div class="hm-row">' + pic(img(r, 120)) + '<div><b>' + esc(r.card_name) + '</b><span class="hm-mono">' + esc(r.cert + ' · ' + said(r.pregrade || {}) + ' likely') + '</span></div><button type="button" class="app-b sec sm" data-back="' + esc(r.id) + '">Got it back?</button></div>';
        }).join('');

    Array.prototype.forEach.call(document.querySelectorAll('#app-home [data-open]'), function (b) {
      b.addEventListener('click', function () { if (window.ALR_openEdit) window.ALR_openEdit(b.getAttribute('data-open'), b.getAttribute('data-kind')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#app-home [data-back]'), function (b) {
      b.addEventListener('click', function () { if (window.ALRRealGrade) window.ALRRealGrade.open(b.getAttribute('data-back')); });
    });
    var si = $('hm-signin'); if (si) si.addEventListener('click', function () { window.ALR_signIn(); });
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
      if (e.detail === 'home') load(false);
      if (e.detail === 'cards') load(true);
      if (e.detail === 'settings') renderSettings();
    });
    document.addEventListener('alr-account', function () { rows = null; renderSettings(); load(true); });
    renderSettings();
    load(true);
  }
  document.addEventListener('DOMContentLoaded', init);
  // a save anywhere refreshes Home's numbers next time it's shown
  window.ALRHome = { refresh: function () { rows = null; } };
})();
