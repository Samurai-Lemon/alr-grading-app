// Desktop glue for the shared Grading Terminal code (label.js and alr-graded.js, synced from
// the website): bundled assets, saving into the chosen folder, the ALR account, and links.
(function () {
  var T = window.__TAURI__;
  window.ALR_DESKTOP = true;
  window.ALR_ASSETS = {
    fonts: 'fonts', opentype: 'vendor/opentype.min.js',
    jspdf: 'vendor/jspdf.umd.min.js', qrcode: 'vendor/qrcode.min.js', icon: 'icon-192.png'
  };

  // ── save folder ───────────────────────────────────────────────────────────
  var KEY = 'alr-save-dir', dir = null;
  try { dir = localStorage.getItem(KEY); } catch (e) {}

  function show() {
    var el = document.getElementById('app-save-path');
    if (el) { el.textContent = '‎' + (dir || '…'); el.title = dir || ''; }
  }
  function setDir(d) { dir = d; try { localStorage.setItem(KEY, d); } catch (e) {} show(); }
  function folderName(d) { return String(d || '').split(/[\\/]/).filter(Boolean).pop() || d; }

  function pick() {
    if (!T || !T.dialog) return Promise.resolve(null);
    return T.dialog.open({ directory: true, multiple: false, defaultPath: dir || undefined, title: 'Choose where to save labels' })
      .then(function (d) { if (typeof d === 'string' && d) setDir(d); return d; });
  }

  // Card name + grade + side, e.g. CHARIZARD_10_front.svg
  function fileName(info) {
    var n = String(info.name || 'CARD').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'CARD';
    var g = String(info.grade || '').replace(/[^0-9.]/g, '');
    return n + (g ? '_' + g : '') + '_' + info.side + '.svg';
  }

  window.ALR_SAVE = function (info) {
    if (!T || !T.core) return Promise.reject(new Error('desktop bridge not available'));
    return T.core.invoke('save_label', { dir: dir, name: fileName(info), contents: info.svg })
      .then(function (saved) { return 'Saved ' + saved + ' to ' + folderName(dir); });
  };

  // Reports (PDF) and any other file the shared code makes: written into the same folder.
  window.ALR_SAVE_FILE = function (blob, name) {
    if (!T || !T.core) return Promise.reject(new Error('desktop bridge not available'));
    return blob.arrayBuffer().then(function (buf) {
      var u = new Uint8Array(buf), bin = '';
      for (var i = 0; i < u.length; i += 32768) bin += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
      return T.core.invoke('save_file', { dir: dir, name: name, dataB64: btoa(bin) });
    }).then(function (saved) { return saved + ' in ' + folderName(dir); });
  };

  // ── ALR account (same Supabase project and public key as alrinitiative.com) ──
  var SUPABASE_URL = 'https://jkxduwtsssxayscbaxet.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_lbVFeryLdCR19axiOZKWcA_RdToAKOb';
  var client = null;
  function sb() {
    if (!client) {
      if (!window.supabase || !window.supabase.createClient) return Promise.reject(new Error('account library missing'));
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'alr-grading-auth' }
      });
    }
    return Promise.resolve(client);
  }
  window.ALR_supabase = sb;

  function $(id) { return document.getElementById(id); }
  function who(session) {
    var box = $('app-who');
    if (!box) return;
    if (!session) { box.innerHTML = ''; return; }
    var u = session.user || {}, name = (u.user_metadata && u.user_metadata.display_name) || u.email || 'Signed in';
    box.innerHTML = '<span class="app-av"></span><span class="app-name"></span><button type="button" id="app-signout">Sign out</button>';
    box.querySelector('.app-av').textContent = String(name).charAt(0).toUpperCase();
    box.querySelector('.app-name').textContent = name;
    $('app-signout').addEventListener('click', function () { sb().then(function (c) { return c.auth.signOut(); }); });
  }

  window.ALR_signIn = function () {
    var m = $('app-signin');
    if (!m) return;
    $('app-signin-msg').textContent = '';
    m.hidden = false;
    setTimeout(function () { var e = $('app-signin-email'); if (e) e.focus(); }, 30);
  };
  function closeSignIn() { var m = $('app-signin'); if (m) m.hidden = true; var p = $('app-signin-pass'); if (p) p.value = ''; }

  // ── links: anything that leaves the app opens in the normal browser ──
  function openExternal(url) {
    if (T && T.opener && T.opener.openUrl) return T.opener.openUrl(url);
    return Promise.reject(new Error('no opener'));
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^https?:\/\//.test(href)) { e.preventDefault(); openExternal(href).catch(function () {}); }
    else if (a.target === '_blank' || /^\//.test(href)) { e.preventDefault(); }   // site-only links do nothing in the app
  }, true);

  // ── Editor | My Cards ─────────────────────────────────────────────────
  var view = 'editor';
  function loadCards() {
    var box = $('alr-account-graded');
    if (!box) return;
    sb().then(function (c) {
      return c.auth.getSession().then(function (res) {
        var session = res && res.data ? res.data.session : null;
        if (!session) {
          box.innerHTML = '<div class="alr-reg-empty">Sign in to see the cards saved to your account.<br><button type="button" class="app-btn" id="app-cards-signin">Sign in</button></div>';
          var c2 = $('alr-account-graded-count'); if (c2) c2.textContent = '';
          var b = $('app-cards-signin'); if (b) b.addEventListener('click', window.ALR_signIn);
          return;
        }
        box.innerHTML = '<div class="alr-reg-empty">Loading your cards…</div>';
        if (window.ALRGraded) window.ALRGraded.loadAccount(c);
      });
    }).catch(function () { box.innerHTML = '<div class="alr-reg-empty">Couldn’t reach alrinitiative.com. Check your connection.</div>'; });
  }
  function showView(v) {
    view = v;
    ['editor', 'pregrade', 'cards'].forEach(function (n) {
      $('app-' + n).hidden = v !== n;
      $('app-tab-' + n).classList.toggle('on', v === n);
    });
    if (v === 'cards') loadCards();
    if (v === 'pregrade' && window.ALRPregrade) window.ALRPregrade.refresh();
  }
  window.ALR_showView = showView;
  // From My Cards: open a saved card in the editor, or a pre-grade in the Pre-grade tab.
  window.ALR_openEdit = function (id, kind) {
    if (kind === 'pregrade') {
      showView('pregrade');
      if (window.ALRPregrade) window.ALRPregrade.load(id);
      return;
    }
    showView('editor');
    if (window.ALRLabel && window.ALRLabel.editCard) window.ALRLabel.editCard(id);
  };
  // Native yes/no dialog (the app's web view has no window.confirm).
  window.ALR_confirm = function (msg) {
    if (T && T.dialog && T.dialog.ask) return T.dialog.ask(msg, { title: 'ALR Grading', kind: 'warning', okLabel: 'Delete', cancelLabel: 'Cancel' });
    return Promise.resolve(window.confirm(msg));
  };

  function start() {
    show();
    Array.prototype.forEach.call(document.querySelectorAll('.app-tabs [data-view]'), function (b) {
      b.addEventListener('click', function () { showView(b.getAttribute('data-view')); });
    });
    var rf = $('app-cards-refresh'); if (rf) rf.addEventListener('click', loadCards);
    var btn = $('app-save-change');
    if (btn) btn.addEventListener('click', function () { pick(); });
    if (!dir && T && T.core) T.core.invoke('default_dir').then(function (d) { setDir(d); });

    var form = $('app-signin-form');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var go = $('app-signin-go'), msg = $('app-signin-msg');
      go.disabled = true; msg.textContent = '';
      sb().then(function (c) {
        return c.auth.signInWithPassword({ email: $('app-signin-email').value.trim(), password: $('app-signin-pass').value });
      }).then(function (res) {
        go.disabled = false;
        if (res.error) { msg.textContent = res.error.message; return; }
        closeSignIn();
      }).catch(function () { go.disabled = false; msg.textContent = 'Couldn’t reach alrinitiative.com. Check your connection.'; });
    });
    var cancel = $('app-signin-cancel');
    if (cancel) cancel.addEventListener('click', closeSignIn);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSignIn(); });

    sb().then(function (c) {
      c.auth.onAuthStateChange(function (_evt, session) { who(session); if (view === 'cards') loadCards(); });
      return c.auth.getSession();
    }).then(function (res) { who(res && res.data ? res.data.session : null); }).catch(function () {});
  }
  document.addEventListener('DOMContentLoaded', start);
})();
