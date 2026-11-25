// ALR Grading: Pre-grades vs real grades (desktop app only, in My Cards).
// When a card comes back from PSA, TAG, Beckett or CGC, enter the real grade. It's saved in the
// pre-grade's record (pregrade.real), shown on its public report page, and the list here works out
// how close the pre-grades have been.
//
// pregrade.real = { co: 'psa'|'tag'|'bgs'|'cgc', g: 9.5, cert: '84512937', on: 'YYYY-MM-DD',
//                   sub: { centering, corners, edges, surface } (BGS/TAG/CGC, optional) }
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function G() { return window.ALRGraded; }
  var COS = [['psa', 'PSA'], ['tag', 'TAG'], ['bgs', 'BGS'], ['cgc', 'CGC']];
  var SUBS = [['centering', 'Centering'], ['corners', 'Corners'], ['edges', 'Edges'], ['surface', 'Surface']];
  function coName(co) { return co === 'bgs' ? 'BGS' : String(co || '').toUpperCase(); }
  function fmt(x) { return x == null || x === '' ? '—' : String(Math.round(Number(x) * 2) / 2); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  var rows = [], sel = null, form = null, busy = false, view = 'all', status = '';

  // what the pre-grade said for a company, and the chance its odds gave a grade
  function said(pg, co) { var e = pg && pg.est && pg.est[co]; return e && e.g != null ? Number(e.g) : null; }
  function chanceOf(pg, co, g) {
    var e = pg && pg.est && pg.est[co];
    if (!e || !e.odds) return null;
    var x = e.odds.filter(function (o) { return Number(o[0]) === Number(g); })[0];
    return x ? x[1] : 0;
  }
  function diffText(d) { return d === 0 ? 'Exact' : (d > 0 ? '+' : '−') + fmt(Math.abs(d)); }
  function gradeWords(d) { var n = Math.abs(d); return n === 1 ? 'one grade' : n === 0.5 ? 'half a grade' : fmt(n) + ' grades'; }

  function load() {
    var box = $('app-rg');
    if (!box) return;
    box.innerHTML = '<div class="alr-reg-empty">Loading your pre-grades…</div>';
    window.ALR_supabase().then(function (sb) {
      return sb.auth.getSession().then(function (res) {
        if (!res.data || !res.data.session) {
          box.innerHTML = '<div class="alr-reg-empty">Sign in to see your pre-grades.<br><button type="button" class="app-btn" id="app-rg-signin">Sign in</button></div>';
          var b = $('app-rg-signin'); if (b) b.addEventListener('click', window.ALR_signIn);
          return;
        }
        return sb.from('graded_cards').select('id, cert, card_name, card_number, game, official_image_url, front_photo_path, pregrade')
          .eq('kind', 'pregrade').order('created_at', { ascending: false }).then(function (r) {
            if (r.error) throw r.error;
            rows = r.data || [];
            if (!rows.some(function (x) { return x.id === sel; })) {
              var open = rows.filter(function (x) { return !(x.pregrade && x.pregrade.real); })[0] || rows[0];
              sel = open ? open.id : null;
            }
            form = null;
            render();
          });
      });
    }).catch(function () { box.innerHTML = '<div class="alr-reg-empty">Couldn’t reach alrinitiative.com. Check your connection.</div>'; });
  }

  function current() { return rows.filter(function (x) { return x.id === sel; })[0] || null; }
  // the form starts from what's saved, else the company the pre-grade was valued for
  function startForm(r) {
    var pg = r.pregrade || {}, real = pg.real || {};
    return { co: real.co || (pg.value && pg.value.co) || 'psa', g: real.g != null ? String(real.g) : '', cert: real.cert || '', on: real.on || today(),
      sub: Object.assign({}, real.sub || {}) };
  }

  function stats() {
    var done = rows.filter(function (r) { var pg = r.pregrade || {}; return pg.real && said(pg, pg.real.co) != null; });
    var n = done.length, exact = 0, near = 0, sum = 0, odds = [], miss = { centering: 0, corners: 0, edges: 0, surface: 0 }, subsN = 0;
    done.forEach(function (r) {
      var pg = r.pregrade, d = Number(pg.real.g) - said(pg, pg.real.co);
      if (d === 0) exact++;
      if (Math.abs(d) <= 1) near++;
      sum += d;
      var ch = chanceOf(pg, pg.real.co, pg.real.g);
      if (ch != null) odds.push(ch);
      if (pg.real.sub && pg.sub) {
        var any = false;
        SUBS.forEach(function (k) { var v = pg.real.sub[k[0]]; if (v != null && v !== '') { any = true; if (Number(v) < Number(pg.sub[k[0]])) miss[k[0]]++; } });
        if (any) subsN++;
      }
    });
    var mean = n ? sum / n : 0;
    return { n: n, exact: exact, near: near, mean: mean, odds: odds, miss: miss, subsN: subsN,
      tend: n < 3 ? null : mean > 0.25 ? 'A bit strict' : mean < -0.25 ? 'A bit generous' : 'About right' };
  }

  function render() {
    var box = $('app-rg');
    if (!box) return;
    var back = rows.filter(function (r) { return r.pregrade && r.pregrade.real; }).length;
    var count = $('app-rg-count');
    if (count) count.textContent = rows.length + (rows.length === 1 ? ' pre-grade' : ' pre-grades') + ' · ' + back + ' back from grading';
    if (!rows.length) {
      box.innerHTML = '<div class="alr-reg-empty">No saved pre-grades yet. Make one in the Pre-grade tab and choose Save Pre-grade.</div>';
      return;
    }
    var st = stats();
    var list = rows.map(function (r) {
      var pg = r.pregrade || {}, real = pg.real, co = real ? real.co : (pg.value && pg.value.co) || 'psa', p = said(pg, co);
      var img = (r.official_image_url && G() ? G().shown(r.game, r.official_image_url, 120) : null) || (G() ? G().photoUrl(r.front_photo_path) : null);
      var d = real && p != null ? Number(real.g) - p : null;
      return '<button type="button" class="app-rg-row' + (r.id === sel ? ' sel' : '') + '" data-rg="' + esc(r.id) + '">' +
        (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '<span class="app-rg-ph"></span>') +
        '<span class="app-rg-card"><b>' + esc(r.card_name) + '</b><span class="app-rg-mono">' + esc(r.cert) + '</span></span>' +
        '<span>' + (p != null ? coName(co) + ' ' + fmt(p) : '—') + '</span>' +
        (real ? '<b>' + coName(real.co) + ' ' + fmt(real.g) + '</b>' : '<span class="app-rg-wait">Enter grade</span>') +
        (d == null ? '<span class="app-rg-wait">—</span>' : '<span class="' + (d === 0 ? 'app-rg-hit' : '') + '">' + diffText(d) + '</span>') +
        '</button>';
    }).join('');
    var top = Math.max(1, st.miss.centering, st.miss.corners, st.miss.edges, st.miss.surface);
    var acc = st.n
      ? '<div class="app-rg-stats">' +
          '<div class="pg-sg"><span>Exact match</span><b>' + st.exact + ' of ' + st.n + '</b></div>' +
          '<div class="pg-sg"><span>Within 1 grade</span><b>' + st.near + ' of ' + st.n + '</b></div>' +
          '<div class="pg-sg"><span>Your pre-grades are</span><b class="app-rg-tend">' + (st.tend || 'Need 3 results') + '</b></div></div>' +
        '<div class="pg-sub">' + (st.n >= 3 ? 'On average real grades came back ' + (Math.abs(st.mean) < 0.05 ? 'the same as the pre-grade' : Math.abs(st.mean).toFixed(1) + (st.mean > 0 ? ' higher' : ' lower') + ' than the pre-grade') + '. ' : '') +
          (st.odds.length ? 'The odds gave the real grade a ' + Math.round(st.odds.reduce(function (a, b) { return a + b; }, 0) / st.odds.length * 100) + '% chance on average.' : '') + '</div>' +
        '<div class="pg-box app-rg-miss"><div class="pg-cu-lab">WHERE THE PRE-GRADES WERE TOO GENEROUS</div>' +
          (st.subsN ? SUBS.map(function (k) {
            return '<div class="pg-cmp"><b>' + k[1] + '</b><div class="pg-cb"><i style="width:' + Math.round(st.miss[k[0]] / top * 100) + '%"></i></div><span>' + st.miss[k[0]] + '</span></div>';
          }).join('') + '<div class="pg-sub">Times the real sub-grade came back lower, out of ' + st.subsN + (st.subsN === 1 ? ' card' : ' cards') + ' with sub-grades.</div>'
            : '<div class="pg-sub">Shows once you enter sub-grades from a BGS, TAG or CGC grade. PSA doesn’t give sub-grades.</div>') + '</div>'
      : '<div class="pg-sub">Your accuracy shows here once a card is back from grading and you’ve entered its real grade.</div>';

    box.innerHTML = '<div class="app-rg-grid"><section class="pg-col">' +
        '<div class="pg-box"><div class="app-rg-th"><span></span><span>CARD</span><span>PRE-GRADE</span><span>REAL GRADE</span><span>RESULT</span></div>' + list + '</div>' +
        '<div class="pg-sub">Real grades are optional. Every one you enter sharpens these stats and helps tune the odds.</div>' +
        '<div class="alr-lc-section-label pg-gap">Your accuracy</div>' + acc +
      '</section><section class="pg-col" id="app-rg-form"></section></div>';
    Array.prototype.forEach.call(box.querySelectorAll('[data-rg]'), function (b) {
      b.addEventListener('click', function () { sel = b.getAttribute('data-rg'); form = null; status = ''; render(); });
    });
    renderForm();
  }

  function renderForm() {
    var el = $('app-rg-form'), r = current();
    if (!el) return;
    if (!r) { el.innerHTML = ''; return; }
    if (!form) form = startForm(r);
    var pg = r.pregrade || {}, img = (r.official_image_url && G() ? G().shown(r.game, r.official_image_url, 160) : null) || (G() ? G().photoUrl(r.front_photo_path) : null);
    var p = said(pg, form.co), hasSubs = form.co !== 'psa';
    el.innerHTML = '<div class="alr-lc-section-label">Got it back?</div>' +
      '<div class="pg-vcard">' + (img ? '<img src="' + esc(img) + '" alt="">' : '<span class="app-rg-ph"></span>') + '<div><b>' + esc(r.card_name) + '</b><span>' + esc(r.cert) + (p != null ? ' · pre-graded ' + coName(form.co) + ' ' + fmt(p) : '') + '</span></div></div>' +
      '<div class="app-rg-fld">Graded by<div class="pg-seg app-rg-cos">' + COS.map(function (c) { return '<button type="button" data-co="' + c[0] + '" class="' + (form.co === c[0] ? 'on' : '') + '">' + c[1] + '</button>'; }).join('') + '</div></div>' +
      '<label class="app-rg-fld">Grade<input class="alr-lc-input" id="app-rg-g" inputmode="decimal" placeholder="' + (form.co === 'psa' ? 'e.g. 9' : 'e.g. 9.5') + '" value="' + esc(form.g) + '"></label>' +
      '<label class="app-rg-fld"><span>Their cert number <small>optional</small></span><input class="alr-lc-input app-rg-mono" id="app-rg-cert" maxlength="30" value="' + esc(form.cert) + '"></label>' +
      '<label class="app-rg-fld">Date back<input class="alr-lc-input" id="app-rg-on" type="date" value="' + esc(form.on) + '"></label>' +
      (hasSubs ? '<div class="app-rg-fld"><span>Their sub-grades <small>optional, from the slab or report</small></span><div class="app-rg-subs">' + SUBS.map(function (k) {
        return '<label><span>' + k[1] + '</span><input class="alr-lc-input" data-rg-sub="' + k[0] + '" inputmode="decimal" placeholder="' + fmt(pg.sub && pg.sub[k[0]]) + '" value="' + esc(form.sub[k[0]] != null ? form.sub[k[0]] : '') + '"></label>';
      }).join('') + '</div></div>' : '') +
      '<div class="pg-box app-rg-cmp" id="app-rg-cmp"></div>' +
      '<button type="button" class="alr-lc-btn-primary" id="app-rg-save"' + (busy ? ' disabled' : '') + '>Save real grade</button>' +
      (pg.real ? '<button type="button" class="pg-linkbtn" id="app-rg-clear" style="align-self:flex-start">Remove the real grade</button>' : '') +
      '<div class="pg-msg" id="app-rg-st">' + esc(status) + '</div>' +
      '<div class="pg-sub">Saved to the pre-grade’s record. Its public report page then shows both, e.g. “Pre-grade PSA 9 · Graded PSA 10”.</div>';
    Array.prototype.forEach.call(el.querySelectorAll('[data-co]'), function (b) {
      b.addEventListener('click', function () { form.co = b.getAttribute('data-co'); renderForm(); });
    });
    $('app-rg-g').addEventListener('input', function (e) { form.g = e.target.value; compare(); });
    $('app-rg-cert').addEventListener('input', function (e) { form.cert = e.target.value; });
    $('app-rg-on').addEventListener('input', function (e) { form.on = e.target.value; });
    Array.prototype.forEach.call(el.querySelectorAll('[data-rg-sub]'), function (inp) {
      inp.addEventListener('input', function () { form.sub[inp.getAttribute('data-rg-sub')] = inp.value; });
    });
    $('app-rg-save').addEventListener('click', save);
    var cl = $('app-rg-clear');
    if (cl) cl.addEventListener('click', clear);
    compare();
  }
  function readGrade(v, co) {
    var n = parseFloat(String(v).replace(',', '.'));
    if (!isFinite(n) || n < 1 || n > 10) return null;
    return co === 'psa' ? (Number.isInteger(n) || n === 1.5 ? n : null) : Math.round(n * 2) / 2 === n ? n : null;
  }
  // "Pre-grade said PSA 9 (30% chance of a 10). It came back a PSA 10, so it was one grade under."
  function compare() {
    var el = $('app-rg-cmp'), r = current();
    if (!el || !r) return;
    var pg = r.pregrade || {}, p = said(pg, form.co), g = readGrade(form.g, form.co), nm = coName(form.co);
    if (p == null) { el.innerHTML = '<p>This pre-grade has no ' + nm + ' estimate to compare with.</p>'; return; }
    var ch = g != null ? chanceOf(pg, form.co, g) : null;
    if (g == null) { el.innerHTML = '<p>Pre-grade said <b>' + nm + ' ' + fmt(p) + '</b>. Type the grade it came back with.</p>'; return; }
    var d = g - p;
    el.innerHTML = '<p>Pre-grade said <b>' + nm + ' ' + fmt(p) + '</b>' + (ch != null && d !== 0 ? ' (' + Math.round(ch * 100) + '% chance of a ' + fmt(g) + ')' : '') + '. ' +
      'It came back a <b class="app-rg-hit">' + nm + ' ' + fmt(g) + '</b>, ' + (d === 0 ? 'spot on.' : 'so the pre-grade was ' + gradeWords(d) + (d > 0 ? ' under.' : ' over.')) + '</p>';
  }
  function put(r, real) {
    busy = true; renderForm();
    var pg = Object.assign({}, r.pregrade || {});
    if (real) pg.real = real; else delete pg.real;
    return window.ALR_supabase().then(function (sb) {
      return sb.from('graded_cards').update({ pregrade: pg }).eq('id', r.id).select('id, pregrade').single();
    }).then(function (res) {
      busy = false;
      if (res.error) throw res.error;
      r.pregrade = res.data.pregrade;
      if (window.ALRPregrade && window.ALRPregrade.setReal) window.ALRPregrade.setReal(r.id, r.pregrade.real);
      return true;
    }).catch(function (e) { busy = false; status = 'Couldn’t save: ' + ((e && e.message) || 'check your connection.'); renderForm(); return false; });
  }
  function save() {
    var r = current();
    if (!r || busy) return;
    var g = readGrade(form.g, form.co);
    if (g == null) { status = form.co === 'psa' ? 'Type a PSA grade from 1 to 10.' : 'Type a grade from 1 to 10, in halves.'; renderForm(); return; }
    var sub = {};
    if (form.co !== 'psa') SUBS.forEach(function (k) { var v = readGrade(form.sub[k[0]], 'bgs'); if (v != null) sub[k[0]] = v; });
    var real = { co: form.co, g: g, cert: String(form.cert || '').trim().slice(0, 30) || null, on: /^\d{4}-\d{2}-\d{2}$/.test(form.on) ? form.on : today() };
    if (Object.keys(sub).length) real.sub = sub;
    put(r, real).then(function (ok) {
      if (!ok) return;
      status = 'Saved. ' + r.cert + ' now shows ' + coName(real.co) + ' ' + fmt(real.g) + ' on its report page.';
      form = null; render();
    });
  }
  function clear() {
    var r = current();
    if (!r || busy) return;
    Promise.resolve(window.ALR_confirm ? window.ALR_confirm('Remove the real grade from ' + r.cert + '?') : true).then(function (ok) {
      if (!ok) return;
      put(r, null).then(function (done) { if (done) { status = 'Real grade removed.'; form = null; render(); } });
    });
  }

  function setView(v) {
    view = v;
    var all = $('alr-account-graded'), rg = $('app-rg');
    if (!all || !rg) return;
    all.hidden = v !== 'all'; rg.hidden = v !== 'real';
    $('alr-account-graded-count').hidden = v !== 'all'; $('app-rg-count').hidden = v !== 'real';
    Array.prototype.forEach.call(document.querySelectorAll('#app-cards-views [data-cv]'), function (b) { b.classList.toggle('on', b.getAttribute('data-cv') === v); });
    var h = $('app-cards-title'); if (h) h.textContent = v === 'real' ? 'Pre-grades vs real grades' : 'My Graded Cards';
    if (v === 'real') load();
    else if (window.ALR_showView) window.ALR_showView('cards');
  }
  // From the Pre-grade tab: jump here with that pre-grade picked.
  function open(id) {
    if (window.ALR_showView) window.ALR_showView('cards');
    sel = id; form = null; status = '';
    setView('real');
  }
  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('#app-cards-views [data-cv]'), function (b) {
      b.addEventListener('click', function () { if (b.getAttribute('data-cv') !== view) setView(b.getAttribute('data-cv')); });
    });
    var rf = $('app-cards-refresh');
    if (rf) rf.addEventListener('click', function () { if (view === 'real') load(); });
  }
  window.ALRRealGrade = { open: open, view: function () { return view; } };
  document.addEventListener('DOMContentLoaded', init);
})();
