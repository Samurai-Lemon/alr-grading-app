// Desktop glue for the shared label script (label.js, synced from the website).
(function () {
  var T = window.__TAURI__;
  window.ALR_DESKTOP = true;
  window.ALR_ASSETS = { fonts: 'fonts', opentype: 'vendor/opentype.min.js' };

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

  function start() {
    show();
    var btn = document.getElementById('app-save-change');
    if (btn) btn.addEventListener('click', function () { pick(); });
    if (!dir && T && T.core) {
      T.core.invoke('default_dir').then(function (d) { setDir(d); });
    }
  }
  document.addEventListener('DOMContentLoaded', start);
})();
