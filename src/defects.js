// ALR Grading: Pre-grade close-ups + whitening finder (desktop app only).
// Looks along a card's corners and edges for white spots: wear showing through the ink. It only
// suggests; the Inspection ratings stay the user's call. It can't see surface scratches, print
// lines or dents. Everything runs on this computer.
//
// window.ALRDefects.scan(src, outer, { cardMm }) -> Promise of
//   { ok, img, W, H, rect:{L,R,T,B}, cw, areas:{tl,tr,bl,br,t,r,b,l}, warn:[] }
//   each area: { kind:'corner'|'edge', suggest:0|1|2, mm2, lenMm, count, spots:[{x,y,rx,ry,r}] }
//   (all positions in the photo's own pixels)
// window.ALRDefects.tile(res, key, longSide, burn, spots) -> { url, w, h, rings:[{x,y,rx,ry}] }
(function () {
  var AW = 1000;   // card width (px) the finder works at
  var AREAS = ['tl', 'tr', 'bl', 'br', 't', 'r', 'b', 'l'];
  var NAMES = { tl: 'Top left corner', tr: 'Top right corner', bl: 'Bottom left corner', br: 'Bottom right corner', t: 'Top edge', r: 'Right edge', b: 'Bottom edge', l: 'Left edge' };
  var SIDE_WORD = { t: 'top', r: 'right', b: 'bottom', l: 'left' };

  function loadImage(src) {
    return new Promise(function (res, rej) {
      var img = new Image();
      if (!/^(blob|data):/.test(src)) img.crossOrigin = 'anonymous';
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('Couldn’t read the photo.')); };
      img.src = src;
    });
  }
  function median(a) { if (!a.length) return 0; a = a.slice().sort(function (x, y) { return x - y; }); return a[a.length >> 1]; }

  function analyse(img, outer, cardMm) {
    var W0 = img.naturalWidth, H0 = img.naturalHeight, s = Math.min(1, AW / ((outer.r - outer.l) * W0));
    var W = Math.max(1, Math.round(W0 * s)), H = Math.max(1, Math.round(H0 * s));
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    var px = ctx.getImageData(0, 0, W, H).data;
    var L = outer.l * W, R = outer.r * W, T = outer.t * H, B = outer.b * H, cw = R - L, ch = B - T;
    var mm = cardMm / cw, warn = [], x, y, i, p;
    var pad = Math.max(0, Math.min(L, W - R, T, H - B, cw * 0.035));
    var x0 = Math.max(0, Math.floor(L - pad)), x1 = Math.min(W - 1, Math.ceil(R + pad));
    var y0 = Math.max(0, Math.floor(T - pad)), y1 = Math.min(H - 1, Math.ceil(B + pad));
    var RW = x1 - x0 + 1, RH = y1 - y0 + 1, N = RW * RH;
    function depth(xx, yy) { return Math.min(xx - L, R - xx, yy - T, B - yy); }   // + = inside the card
    function minC(j) { return Math.min(px[j], px[j + 1], px[j + 2]); }

    // the table's colour, from the strip of background around the card
    var table = null, tT = 0, tMin = 0;
    if (pad >= 5) {
      var tr = [], tg = [], tb = [];
      for (y = y0; y <= y1; y += 2) for (x = x0; x <= x1; x += 2) {
        var dd0 = depth(x + 0.5, y + 0.5);
        if (dd0 < -pad * 0.3 && dd0 > -pad * 0.95) { i = (y * W + x) * 4; tr.push(px[i]); tg.push(px[i + 1]); tb.push(px[i + 2]); }
      }
      if (tr.length >= 150) {
        table = [median(tr), median(tg), median(tb)];
        var spread = tr.map(function (v, k) { return Math.hypot(v - table[0], tg[k] - table[1], tb[k] - table[2]); }).sort(function (a, b) { return a - b; });
        tT = Math.max(30, spread[Math.floor(spread.length * 0.9)] * 1.4 + 10);
        tMin = Math.min(table[0], table[1], table[2]);
      }
    }
    if (!table) warn.push('There’s little background around the card, so the edge check is rougher. Leave a margin of table around the card.');
    else if (tMin > 150) warn.push('The background is light, so white wear can blend into it. A dark, plain background works best.');
    if (cw < 500) warn.push('The card is small in this photo, so tiny wear may be missed.');

    // "outside the card": table-coloured pixels at the very edge, or anything clearly past the guides
    var out = new Uint8Array(N), dist = new Float32Array(N), BIG = 1e9;
    for (y = 0; y < RH; y++) for (x = 0; x < RW; x++) {
      p = y * RW + x;
      var gx = x + x0 + 0.5, gy = y + y0 + 0.5, dd = depth(gx, gy), o;
      if (table) {
        i = ((y + y0) * W + x + x0) * 4;
        var like = Math.hypot(px[i] - table[0], px[i + 1] - table[1], px[i + 2] - table[2]) < tT;
        o = dd < -cw * 0.01 || (like && dd < cw * 0.012);
      } else o = dd < 0;
      out[p] = o ? 1 : 0; dist[p] = o ? 0 : BIG;
    }
    // distance from the card's real outline (two-pass chamfer)
    var D = 1.4142;
    for (y = 0; y < RH; y++) for (x = 0; x < RW; x++) {
      p = y * RW + x; var v = dist[p];
      if (x > 0 && dist[p - 1] + 1 < v) v = dist[p - 1] + 1;
      if (y > 0) {
        if (dist[p - RW] + 1 < v) v = dist[p - RW] + 1;
        if (x > 0 && dist[p - RW - 1] + D < v) v = dist[p - RW - 1] + D;
        if (x < RW - 1 && dist[p - RW + 1] + D < v) v = dist[p - RW + 1] + D;
      }
      dist[p] = v;
    }
    for (y = RH - 1; y >= 0; y--) for (x = RW - 1; x >= 0; x--) {
      p = y * RW + x; var w = dist[p];
      if (x < RW - 1 && dist[p + 1] + 1 < w) w = dist[p + 1] + 1;
      if (y < RH - 1) {
        if (dist[p + RW] + 1 < w) w = dist[p + RW] + 1;
        if (x < RW - 1 && dist[p + RW + 1] + D < w) w = dist[p + RW + 1] + D;
        if (x > 0 && dist[p + RW - 1] + D < w) w = dist[p + RW - 1] + D;
      }
      dist[p] = w;
    }

    // the border's own colour, a little way in from each side (so wear is judged against its
    // own border: a white spot on black, red, yellow or blue all stand out)
    var ref = {}, lightSides = [];
    ['t', 'r', 'b', 'l'].forEach(function (sd) {
      var len = sd === 't' || sd === 'b' ? cw : ch, n = Math.max(1, Math.round(len)), raw = new Array(n), d1 = cw * 0.018, d2 = cw * 0.035;
      for (var k = 0; k < n; k++) {
        var vals = [];
        for (var dp = d1; dp <= d2; dp += 1) {
          var xx = sd === 't' || sd === 'b' ? L + k : sd === 'l' ? L + dp : R - dp;
          var yy = sd === 'l' || sd === 'r' ? T + k : sd === 't' ? T + dp : B - dp;
          xx = Math.max(0, Math.min(W - 1, Math.round(xx))); yy = Math.max(0, Math.min(H - 1, Math.round(yy)));
          vals.push(minC((yy * W + xx) * 4));
        }
        raw[k] = median(vals);
      }
      var sm = new Float32Array(n), win = Math.max(5, Math.round(cw * 0.015));
      for (var k2 = 0; k2 < n; k2++) sm[k2] = median(raw.slice(Math.max(0, k2 - win), Math.min(n, k2 + win + 1)));
      ref[sd] = sm;
      if (median(Array.prototype.slice.call(sm, Math.round(n * 0.1), Math.round(n * 0.9))) > 190) lightSides.push(SIDE_WORD[sd]);
    });
    if (lightSides.length >= 3) warn.push('This side’s border is light, so whitening on it is hard to see. Check it with the loupe.');
    else if (lightSides.length) warn.push('The ' + lightSides.join(' and ') + ' border' + (lightSides.length > 1 ? 's are' : ' is') + ' light, so whitening there is hard to see.');

    // candidate wear: just inside the outline, whitish, clearly lighter than its border and the table
    var cand = new Uint8Array(N), Dw = cw * 0.014, band = cw * 0.045, edgeIn = cw * 0.08;
    for (y = 0; y < RH; y++) for (x = 0; x < RW; x++) {
      p = y * RW + x;
      if (out[p] || dist[p] < 1.5 || dist[p] > Dw) continue;
      var ix = x + x0, iy = y + y0, cx = ix + 0.5, cy = iy + 0.5;
      var dl = cx - L, dr = R - cx, dt = cy - T, db = B - cy, mn = Math.min(dl, dr, dt, db);
      if (mn > band) continue;
      var sd2 = mn === dt ? 't' : mn === db ? 'b' : mn === dl ? 'l' : 'r';
      var along = sd2 === 't' || sd2 === 'b' ? dl : dt, len2 = ref[sd2].length;
      var rv = ref[sd2][Math.max(0, Math.min(len2 - 1, Math.round(Math.max(edgeIn, Math.min(len2 - edgeIn, along)))))];
      i = (iy * W + ix) * 4;
      var lo = minC(i), hi = Math.max(px[i], px[i + 1], px[i + 2]);
      if (lo < 120 || lo < rv + 45 || hi - lo > 75) continue;
      if (table && lo < tMin + 30) continue;
      cand[p] = 1;
    }

    // group into spots and sort them into corners and edges
    var areas = {}, Q = cw * 0.09;
    AREAS.forEach(function (k) { areas[k] = { kind: k.length === 2 ? 'corner' : 'edge', n: 0, count: 0, spots: [], iv: [] }; });
    var seen = new Uint8Array(N), q = new Int32Array(N);
    for (p = 0; p < N; p++) {
      if (!cand[p] || seen[p]) continue;
      var qh = 0, qt = 0, n = 0, sx = 0, sy = 0, bx0 = RW, bx1 = 0, by0 = RH, by1 = 0;
      q[qt++] = p; seen[p] = 1;
      while (qh < qt) {
        var a = q[qh++], ax = a % RW, ay = (a / RW) | 0;
        n++; sx += ax; sy += ay;
        if (ax < bx0) bx0 = ax; if (ax > bx1) bx1 = ax; if (ay < by0) by0 = ay; if (ay > by1) by1 = ay;
        for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
          var nx = ax + ox, ny = ay + oy;
          if ((!ox && !oy) || nx < 0 || ny < 0 || nx >= RW || ny >= RH) continue;
          var b = ny * RW + nx;
          if (cand[b] && !seen[b]) { seen[b] = 1; q[qt++] = b; }
        }
      }
      if (n < 4) continue;
      var mx = sx / n + x0 + 0.5, my = sy / n + y0 + 0.5;
      var nL = mx - L < Q, nR = R - mx < Q, nT = my - T < Q, nB = B - my < Q, key;
      if ((nL || nR) && (nT || nB)) key = (nT ? 't' : 'b') + (nL ? 'l' : 'r');
      else { var m2 = Math.min(mx - L, R - mx, my - T, B - my); key = m2 === my - T ? 't' : m2 === B - my ? 'b' : m2 === mx - L ? 'l' : 'r'; }
      var A = areas[key];
      A.n += n; A.count++;
      A.spots.push({ x: mx / s, y: my / s, rx: ((bx1 - bx0) / 2 + 3) / s, ry: ((by1 - by0) / 2 + 3) / s, r: (Math.max(bx1 - bx0, by1 - by0) / 2 + 3) / s, n: n });
      if (A.kind === 'edge') A.iv.push(key === 't' || key === 'b' ? [bx0 + x0, bx1 + x0 + 1] : [by0 + y0, by1 + y0 + 1]);
    }
    AREAS.forEach(function (k) {
      var A = areas[k];
      A.mm2 = Math.round(A.n * mm * mm * 100) / 100;
      // total length of the edge that shows wear (overlapping spots counted once)
      var len = 0, end = -Infinity;
      A.iv.sort(function (u, v) { return u[0] - v[0]; }).forEach(function (iv) { if (iv[1] > end) { len += iv[1] - Math.max(iv[0], end); end = iv[1]; } });
      A.lenMm = Math.round(len * mm * 10) / 10;
      // Rough, uncalibrated thresholds; tuned from real photos as they come in.
      if (A.kind === 'corner') A.suggest = A.mm2 < 0.04 ? 0 : A.mm2 < 0.4 ? 1 : 2;
      else A.suggest = A.lenMm < 0.6 && A.mm2 < 0.05 ? 0 : A.lenMm > 8 || A.mm2 > 1.5 ? 2 : 1;
      A.spots.sort(function (u, v) { return v.n - u.n; });
      A.spots = A.spots.slice(0, 8);
      delete A.iv; delete A.n;
    });
    return {
      ok: true, img: img, W: W0, H: H0, rect: { L: L / s, R: R / s, T: T / s, B: B / s }, cw: cw / s,
      areas: areas, warn: warn, lightBg: !!(table && tMin > 150)
    };
  }

  function scan(src, outer, opts) {
    opts = opts || {};
    if (!src || !outer) return Promise.resolve({ ok: false, warn: [] });
    return loadImage(src).then(function (img) { return analyse(img, outer, opts.cardMm || 63); });
  }

  // Each close-up as a flat strip or square: corners as they are, edges laid flat with the card's
  // outer edge at the top. Returns the affine map photo -> tile (canvas setTransform order).
  function box(res, key) {
    var r = res.rect, o = res.cw * 0.02, q = res.cw * 0.14, sd = res.cw * 0.06;
    var xl = r.L - o, xr = r.R + o, yt = r.T - o, yb = r.B + o, lw = xr - xl, lh = yb - yt;
    switch (key) {
      case 'tl': return { m: [1, 0, 0, 1, -xl, -yt], w: q, h: q };
      case 'tr': return { m: [1, 0, 0, 1, -(xr - q), -yt], w: q, h: q };
      case 'bl': return { m: [1, 0, 0, 1, -xl, -(yb - q)], w: q, h: q };
      case 'br': return { m: [1, 0, 0, 1, -(xr - q), -(yb - q)], w: q, h: q };
      case 't': return { m: [1, 0, 0, 1, -xl, -yt], w: lw, h: sd };
      case 'b': return { m: [-1, 0, 0, -1, xr, yb], w: lw, h: sd };
      case 'l': return { m: [0, 1, -1, 0, yb, -xl], w: lh, h: sd };
      case 'r': return { m: [0, -1, 1, 0, -yt, xr], w: lh, h: sd };
    }
  }
  function tile(res, key, longSide, burn, rings) {
    var bx = box(res, key), k = Math.min(3, longSide / Math.max(bx.w, bx.h)), m = bx.m;
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(bx.w * k)); cv.height = Math.max(1, Math.round(bx.h * k));
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#1a1917'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
    ctx.drawImage(res.img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // rings for the spots that fall in this tile, mapped into it
    var out = [];
    (rings || []).forEach(function (s) {
      // edges turned on their side swap width and height
      var x = (m[0] * s.x + m[2] * s.y + m[4]) * k, y = (m[1] * s.x + m[3] * s.y + m[5]) * k, turned = m[0] === 0;
      var rx = Math.max(9, (turned ? s.ry : s.rx) * k * 1.2 + 4), ry = Math.max(9, (turned ? s.rx : s.ry) * k * 1.2 + 4);
      if (x < -rx || y < -ry || x > cv.width + rx || y > cv.height + ry) return;
      out.push({ x: x, y: y, rx: rx, ry: ry });
    });
    if (burn) out.forEach(function (c) {
      var lw = ctx.lineWidth = Math.max(2, Math.min(cv.width, cv.height * 4) / 220);
      ctx.strokeStyle = 'rgba(18,17,16,.75)'; ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx + lw, c.ry + lw, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#e09a7e'; ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, Math.PI * 2); ctx.stroke();
    });
    return { url: cv.toDataURL('image/jpeg', 0.9), w: cv.width, h: cv.height, rings: out };
  }

  window.ALRDefects = { scan: scan, tile: tile, AREAS: AREAS, NAMES: NAMES };
})();
