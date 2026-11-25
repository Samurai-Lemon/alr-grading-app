// ALR Grading: Pre-grade photo check + straighten (desktop app only).
// Finds the card in a photo, flattens it into a straight card (63×88 mm, or Yu-Gi-Oh!'s 59×86 mm)
// with a thin strip of table around it, then checks the photo: whole card in frame, big enough,
// sharp, no glare, out of its sleeve. Everything runs on this computer; nothing is uploaded.
//
// window.ALRPhoto.process(fileOrBlob, { game }) -> Promise of
//   { ok, blob, url, w, h, outer:{l,r,t,b}, tilt, keystone, checks:[{id, ok, label, detail}] }
// ok=false means the card couldn't be found; use the photo as it is.
(function () {
  var MAX_SRC = 3000;   // longest side we read from the original
  var DET = 900;        // longest side used to find the card
  var MARGIN = 0.04;    // table kept around the card, as a share of card width
  var MAX_OUT = 1800;   // tallest straightened card (px)

  function loadImage(src) {
    return new Promise(function (res, rej) {
      var own = typeof src !== 'string', url = own ? URL.createObjectURL(src) : src, img = new Image();
      img.onload = function () { if (own) URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { if (own) URL.revokeObjectURL(url); rej(new Error('This photo format can’t be read here. Try a JPEG or PNG.')); };
      img.src = url;
    });
  }
  function raster(img, maxSide) {
    var s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    var c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { w: c.width, h: c.height, s: s, px: ctx.getImageData(0, 0, c.width, c.height).data };
  }
  function median(a) { if (!a.length) return 0; a = a.slice().sort(function (x, y) { return x - y; }); return a[a.length >> 1]; }
  function otsu(hist) {
    var total = 0, sum = 0, i;
    for (i = 0; i < hist.length; i++) { total += hist[i]; sum += i * hist[i]; }
    var sB = 0, wB = 0, best = 0, t = 0;
    for (i = 0; i < hist.length; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = total - wB; if (!wF) break;
      sB += i * hist[i];
      var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = i; }
    }
    return t;
  }
  // colour at a sub-pixel point (bilinear), into out[0..2]
  function sample(r, x, y, out) {
    var W = r.w, H = r.h, px = r.px;
    if (x < 0) x = 0; if (y < 0) y = 0; if (x > W - 1.001) x = W - 1.001; if (y > H - 1.001) y = H - 1.001;
    var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = (y0 * W + x0) * 4, j = i + W * 4;
    for (var k = 0; k < 3; k++) {
      var a = px[i + k] + (px[i + 4 + k] - px[i + k]) * fx, b = px[j + k] + (px[j + 4 + k] - px[j + k]) * fx;
      out[k] = a + (b - a) * fy;
    }
    return out;
  }
  function cdist(a, b) { var r = a[0] - b[0], g = a[1] - b[1], u = a[2] - b[2]; return Math.sqrt(r * r + g * g + u * u); }

  // v = m*u + k, dropping outliers a few times
  function fit(pts) {
    var use = pts, m = 0, k = 0;
    for (var it = 0; it < 4 && use.length >= 4; it++) {
      var n = use.length, su = 0, sv = 0, suu = 0, suv = 0;
      use.forEach(function (p) { su += p[0]; sv += p[1]; suu += p[0] * p[0]; suv += p[0] * p[1]; });
      var den = n * suu - su * su;
      m = den ? (n * suv - su * sv) / den : 0; k = (sv - m * su) / n;
      var res = use.map(function (p) { return Math.abs(p[1] - (m * p[0] + k)); });
      var lim = Math.max(1.2, median(res) * 2.5);
      var next = use.filter(function (p, i) { return res[i] <= lim; });
      if (next.length === use.length) break;
      use = next;
    }
    return { m: m, k: k, n: use.length };
  }

  // Find the card's four edges in the small copy, as lines in its pixels.
  // 5×5 box blur (two passes of a running sum), so wood grain and paper texture average out
  function blur(d, r) {
    var W = d.w, H = d.h, a = new Float32Array(W * H * 3), b = new Float32Array(W * H * 3), x, y, k, i;
    for (i = 0; i < W * H; i++) { a[i * 3] = d.px[i * 4]; a[i * 3 + 1] = d.px[i * 4 + 1]; a[i * 3 + 2] = d.px[i * 4 + 2]; }
    for (y = 0; y < H; y++) for (k = 0; k < 3; k++) {
      var acc = 0, n = 0;
      for (x = -r; x < W + r; x++) {
        if (x + r < W) { acc += a[(y * W + x + r) * 3 + k]; n++; }
        if (x - r - 1 >= 0) { acc -= a[(y * W + x - r - 1) * 3 + k]; n--; }
        if (x >= 0 && x < W) b[(y * W + x) * 3 + k] = acc / n;
      }
    }
    for (x = 0; x < W; x++) for (k = 0; k < 3; k++) {
      var acc2 = 0, n2 = 0;
      for (y = -r; y < H + r; y++) {
        if (y + r < H) { acc2 += b[((y + r) * W + x) * 3 + k]; n2++; }
        if (y - r - 1 >= 0) { acc2 -= b[((y - r - 1) * W + x) * 3 + k]; n2--; }
        if (y >= 0 && y < H) a[(y * W + x) * 3 + k] = acc2 / n2;
      }
    }
    var out = new Uint8ClampedArray(W * H * 4);
    for (i = 0; i < W * H; i++) { out[i * 4] = a[i * 3]; out[i * 4 + 1] = a[i * 3 + 1]; out[i * 4 + 2] = a[i * 3 + 2]; out[i * 4 + 3] = 255; }
    return { w: W, h: H, px: out };
  }
  function findEdges(d0) {
    var d = blur(d0, 2);
    var W = d.w, H = d.h, px = d.px, ring = Math.max(2, Math.round(Math.min(W, H) * 0.02));
    var rs = [], gs = [], bs = [], x, y, i, p;
    for (y = 0; y < H; y += 2) for (x = 0; x < W; x += 2) {
      if (x >= ring && x < W - ring && y >= ring && y < H - ring) continue;
      i = (y * W + x) * 4; rs.push(px[i]); gs.push(px[i + 1]); bs.push(px[i + 2]);
    }
    var bg = [median(rs), median(gs), median(bs)], N = W * H, hist = new Array(256).fill(0), dist = new Float32Array(N);
    for (p = 0; p < N; p++) {
      i = p * 4;
      var dr = px[i] - bg[0], dg = px[i + 1] - bg[1], db = px[i + 2] - bg[2], v = Math.sqrt(dr * dr + dg * dg + db * db);
      dist[p] = v; hist[Math.min(255, v >> 1)]++;
    }
    // anything more different from the table than the table is from itself counts as card
    var rd = [];
    for (y = 0; y < H; y += 2) for (x = 0; x < W; x += 2) {
      if (x >= ring && x < W - ring && y >= ring && y < H - ring) continue;
      rd.push(dist[y * W + x]);
    }
    rd.sort(function (a, b) { return a - b; });
    var t = Math.max(24, rd[Math.floor(rd.length * 0.95)] * 1.25 + 8);
    var mask = new Uint8Array(N);
    for (p = 0; p < N; p++) mask[p] = dist[p] > t ? 1 : 0;
    // shave two pixels off every shape so thin lines (wood grain, scratches) can't join the card
    for (var pass = 0; pass < 2; pass++) {
      var m2 = new Uint8Array(N);
      for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
        p = y * W + x;
        m2[p] = mask[p] && mask[p - 1] && mask[p + 1] && mask[p - W] && mask[p + W] ? 1 : 0;
      }
      mask = m2;
    }
    // largest connected piece = the card
    var lab = new Int32Array(N), q = new Int32Array(N), best = 0, bestN = 0, cur = 0;
    for (p = 0; p < N; p++) {
      if (!mask[p] || lab[p]) continue;
      cur++; var qh = 0, qt = 0, n = 0; q[qt++] = p; lab[p] = cur;
      while (qh < qt) {
        var a = q[qh++]; n++;
        var ax = a % W, nb = [ax > 0 ? a - 1 : -1, ax < W - 1 ? a + 1 : -1, a - W, a + W];
        for (var z = 0; z < 4; z++) { var b = nb[z]; if (b >= 0 && b < N && mask[b] && !lab[b]) { lab[b] = cur; q[qt++] = b; } }
      }
      if (n > bestN) { bestN = n; best = cur; }
    }
    if (!best || bestN < N * 0.06) return null;
    var minX = W, maxX = -1, minY = H, maxY = -1, left = new Float32Array(H).fill(-1), right = new Float32Array(H).fill(-1), top = new Float32Array(W).fill(-1), bot = new Float32Array(W).fill(-1);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (lab[y * W + x] !== best) continue;
      if (left[y] < 0) left[y] = x; right[y] = x;
      if (top[x] < 0) top[x] = y; bot[x] = y;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    var touches = (minX <= 1 ? 1 : 0) + (maxX >= W - 2 ? 1 : 0) + (minY <= 1 ? 1 : 0) + (maxY >= H - 2 ? 1 : 0);
    // the card's outline = convex hull of the piece, which bridges dark patches of art that
    // happen to match the table
    var pts0 = [];
    for (y = 0; y < H; y++) if (left[y] >= 0) { pts0.push([left[y], y]); if (right[y] !== left[y]) pts0.push([right[y], y]); }
    var hull = convexHull(pts0);
    spans(hull, W, H, left, right, top, bot);
    function along(arr, lo, hi) { var pts = []; for (var u = Math.round(lo); u <= Math.round(hi); u++) if (arr[u] >= 0) pts.push([u, arr[u]]); return pts; }
    var hh = maxY - minY, ww = maxX - minX;
    var L = fit(along(left, minY + hh * 0.25, maxY - hh * 0.25));   // x = m*y + k
    var R = fit(along(right, minY + hh * 0.25, maxY - hh * 0.25));
    var T = fit(along(top, minX + ww * 0.25, maxX - ww * 0.25));    // y = m*x + k
    var B = fit(along(bot, minX + ww * 0.25, maxX - ww * 0.25));
    if (L.n < 8 || R.n < 8 || T.n < 8 || B.n < 8) return null;
    return { L: L, R: R, T: T, B: B, bg: bg, touches: touches };
  }
  function convexHull(P) {
    P.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], i;
    for (i = 0; i < P.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], P[i]) <= 0) lo.pop(); lo.push(P[i]); }
    for (i = P.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], P[i]) <= 0) up.pop(); up.push(P[i]); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  // per row: leftmost/rightmost x of the hull; per column: top/bottom y
  function spans(hull, W, H, left, right, top, bot) {
    left.fill(-1); right.fill(-1); top.fill(-1); bot.fill(-1);
    var n = hull.length, i, y, x;
    for (y = 0; y < H; y++) {
      var lo = Infinity, hi = -Infinity;
      for (i = 0; i < n; i++) {
        var a = hull[i], b = hull[(i + 1) % n];
        if ((a[1] <= y && b[1] >= y) || (b[1] <= y && a[1] >= y)) {
          var xx = a[1] === b[1] ? Math.min(a[0], b[0]) : a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
          var xx2 = a[1] === b[1] ? Math.max(a[0], b[0]) : xx;
          if (xx < lo) lo = xx; if (xx2 > hi) hi = xx2;
        }
      }
      if (lo <= hi) { left[y] = lo; right[y] = hi; }
    }
    for (x = 0; x < W; x++) {
      var lo2 = Infinity, hi2 = -Infinity;
      for (i = 0; i < n; i++) {
        var c = hull[i], d = hull[(i + 1) % n];
        if ((c[0] <= x && d[0] >= x) || (d[0] <= x && c[0] >= x)) {
          var yy = c[0] === d[0] ? Math.min(c[1], d[1]) : c[1] + (d[1] - c[1]) * (x - c[0]) / (d[0] - c[0]);
          var yy2 = c[0] === d[0] ? Math.max(c[1], d[1]) : yy;
          if (yy < lo2) lo2 = yy; if (yy2 > hi2) hi2 = yy2;
        }
      }
      if (lo2 <= hi2) { top[x] = lo2; bot[x] = hi2; }
    }
  }
  function cross(v, h) { // v: x = m*y + k ; h: y = m*x + k
    var x = (v.m * h.k + v.k) / (1 - v.m * h.m);
    return [x, h.m * x + h.k];
  }
  // Settle each edge on the strongest colour change within ~1% of the rough edge (full-size copy).
  function refine(src, e, sc) {
    var c0 = corners(e), c = {};
    Object.keys(c0).forEach(function (k) { c[k] = [c0[k][0] * sc, c0[k][1] * sc]; });
    var cardW = (len(c.tl, c.tr) + len(c.bl, c.br)) / 2, span = Math.max(4, Math.round(cardW * 0.012));
    function side(p0, p1, vertical) {
      var pts = [], nx = vertical ? 1 : 0, ny = vertical ? 0 : 1;
      for (var k = 0; k <= 60; k++) {
        var f = 0.12 + 0.76 * k / 60, x = p0[0] + (p1[0] - p0[0]) * f, y = p0[1] + (p1[1] - p0[1]) * f;
        var bestS = 0, bestV = -1, prof = [];
        for (var s = -span - 1; s <= span + 1; s++) prof.push(sample(src, x + nx * s, y + ny * s, [0, 0, 0]));
        for (var j = 1; j < prof.length - 1; j++) { var v = cdist(prof[j - 1], prof[j + 1]); if (v > bestV) { bestV = v; bestS = j; } }
        if (bestV < 20) continue;
        var s0 = bestS - span - 1;
        pts.push(vertical ? [y, x + s0] : [x, y + s0]);
      }
      return pts;
    }
    var out = { L: fit(side(c.tl, c.bl, true)), R: fit(side(c.tr, c.br, true)), T: fit(side(c.tl, c.tr, false)), B: fit(side(c.bl, c.br, false)) };
    ['L', 'R', 'T', 'B'].forEach(function (k) { if (out[k].n < 12) out[k] = { m: e[k].m, k: e[k].k * sc, n: 0 }; });
    return out;
  }
  function corners(e) { return { tl: cross(e.L, e.T), tr: cross(e.R, e.T), bl: cross(e.L, e.B), br: cross(e.R, e.B) }; }
  function len(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  // homography taking (u,v) in the straight card to (x,y) in the photo
  function homography(from, to) {
    var A = [], i;
    for (i = 0; i < 4; i++) {
      var u = from[i][0], v = from[i][1], x = to[i][0], y = to[i][1];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
    }
    for (var c = 0; c < 8; c++) {
      var piv = c;
      for (i = c + 1; i < 8; i++) if (Math.abs(A[i][c]) > Math.abs(A[piv][c])) piv = i;
      var tmp = A[c]; A[c] = A[piv]; A[piv] = tmp;
      for (i = 0; i < 8; i++) {
        if (i === c) continue;
        var f = A[i][c] / A[c][c];
        for (var j = c; j < 9; j++) A[i][j] -= f * A[c][j];
      }
    }
    var h = []; for (i = 0; i < 8; i++) h.push(A[i][8] / A[i][i]); h.push(1);
    return h;
  }

  function where(cx, cy) {
    var r = cy < 0.33 ? 'top' : cy > 0.67 ? 'bottom' : '', c = cx < 0.33 ? 'left' : cx > 0.67 ? 'right' : '';
    return (r && c) ? r + ' ' + c : (r || c || 'middle');
  }

  // ── checks on the straightened card ───────────────────────────────────────
  // Sharpness: how many pixels the card's own edge takes to go from table to card (a sharp photo
  // does it in 2–3 px per 1000 px of card width; a blurry one smears it out).
  function edgeWidth(o, m, cw, ch) {
    var r = Math.max(8, Math.round(cw * 0.012)), widths = [], a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    function prof(x0, y0, dx, dy) {
      var A = sample(o, x0 - dx * r, y0 - dy * r, [0, 0, 0]), B = sample(o, x0 + dx * r, y0 + dy * r, [0, 0, 0]);
      var D = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], dd = D[0] * D[0] + D[1] * D[1] + D[2] * D[2];
      if (dd < 45 * 45) return;
      var lo = null, hi = null;
      for (var s = -r; s <= r; s += 0.5) {
        sample(o, x0 + dx * s, y0 + dy * s, c);
        var f = ((c[0] - A[0]) * D[0] + (c[1] - A[1]) * D[1] + (c[2] - A[2]) * D[2]) / dd;
        if (lo == null && f >= 0.1) lo = s;
        if (hi == null && f >= 0.9) { hi = s; break; }
      }
      if (lo != null && hi != null) widths.push(hi - lo);
    }
    for (var k = 0; k < 30; k++) {
      var f = 0.2 + 0.6 * k / 29;
      prof(m, m + ch * f, 1, 0); prof(m + cw, m + ch * f, -1, 0);
      prof(m + cw * f, m, 0, 1); prof(m + cw * f, m + ch, 0, -1);
    }
    if (widths.length < 10) return null;
    return median(widths) * 1000 / cw;
  }
  // Glare: blown-out (pure white) patches on the card.
  function glare(o, m, cw, ch) {
    var step = Math.max(1, cw / 420), gw = Math.floor(cw / step), gh = Math.floor(ch / step), g = new Uint8Array(gw * gh), i, x, y;
    for (y = 0; y < gh; y++) for (x = 0; x < gw; x++) {
      i = (Math.round(m + y * step) * o.w + Math.round(m + x * step)) * 4;
      var lo = Math.min(o.px[i], o.px[i + 1], o.px[i + 2]);
      if (lo >= 247) g[y * gw + x] = 1;
    }
    var seen = new Uint8Array(gw * gh), q = new Int32Array(gw * gh), best = 0, bx = 0, by = 0;
    for (var p = 0; p < gw * gh; p++) {
      if (!g[p] || seen[p]) continue;
      var qh = 0, qt = 0, n = 0, sx = 0, sy = 0; q[qt++] = p; seen[p] = 1;
      while (qh < qt) {
        var a = q[qh++], ax = a % gw, ay = (a / gw) | 0; n++; sx += ax; sy += ay;
        var nb = [ax > 0 ? a - 1 : -1, ax < gw - 1 ? a + 1 : -1, ay > 0 ? a - gw : -1, ay < gh - 1 ? a + gw : -1];
        for (var z = 0; z < 4; z++) { var b = nb[z]; if (b >= 0 && g[b] && !seen[b]) { seen[b] = 1; q[qt++] = b; } }
      }
      if (n > best) { best = n; bx = sx / n / gw; by = sy / n / gh; }
    }
    return { share: best / (gw * gh), where: where(bx, by) };
  }
  // Sleeve: either the edge we found is the sleeve's (then a thin strip just inside it still looks
  // like the table, seen through plastic), or it's the card's and the sleeve shows as a second
  // straight line just outside. Colours are averaged along each whole side, so texture washes out.
  function sleeve(o, m, cw, ch) {
    var c = [0, 0, 0];
    function avg(side, off) {   // off: px from the edge, + = into the card
      var acc = [0, 0, 0];
      for (var k = 0; k < 40; k++) {
        var f = 0.15 + 0.7 * k / 39;
        if (side === 'L') sample(o, m + off, m + ch * f, c);
        else if (side === 'R') sample(o, m + cw - off, m + ch * f, c);
        else if (side === 'T') sample(o, m + cw * f, m + off, c);
        else sample(o, m + cw * f, m + ch - off, c);
        acc[0] += c[0] / 40; acc[1] += c[1] / 40; acc[2] += c[2] / 40;
      }
      return acc;
    }
    var inner = 0, outer = 0, dbl = 0, info = {};
    ['L', 'R', 'T', 'B'].forEach(function (sd) {
      var table = avg(sd, -Math.round(m * 0.6)), strip = avg(sd, Math.max(2, Math.round(cw * 0.004))), deep = avg(sd, Math.round(cw * 0.03));
      var dS = cdist(strip, table), dD = cdist(deep, table);
      var isInner = dD > 30 && dS < dD * 0.45;
      // a line between the card edge and the table, with table on both sides of it
      var line = 0, prev = null, base = cdist(avg(sd, 2), table);
      for (var off = -Math.max(3, Math.round(cw * 0.004)); off >= -Math.round(m * 0.85); off--) {
        var a = avg(sd, off), b = avg(sd, off - 2);
        line = Math.max(line, cdist(a, b));
      }
      var isOuter = base > 25 && line > base * 0.3 && line > 12;
      // double edge: the sleeve's rim, a dip, then the card's own edge, all within ~1.4% of the edge
      var prof = [], lim = Math.max(8, Math.round(cw * 0.014)), pk = 0, lo = Infinity, rise = 0, top = 0;
      for (var pp = 1; pp <= lim; pp++) prof.push(cdist(avg(sd, pp), table));
      prof.forEach(function (v) { if (v > top) top = v; });
      for (var q = 0; q < prof.length; q++) {
        if (prof[q] > pk && lo === Infinity) pk = prof[q];
        else if (pk && prof[q] < lo) lo = prof[q];
        else if (lo !== Infinity) rise = Math.max(rise, prof[q] - lo);
      }
      var isDouble = rise > Math.max(22, top * 0.25);
      if (isDouble) dbl++;
      info[sd] = { rise: Math.round(rise), top: Math.round(top), dbl: isDouble, dS: Math.round(dS), dD: Math.round(dD), line: Math.round(line), base: Math.round(base), inner: isInner, outer: isOuter };
      if (isInner) inner++; if (isOuter) outer++;
    });
    return { inner: inner, outer: outer, dbl: dbl, sleeved: inner >= 3 || outer >= 3 || dbl >= 2, info: info };
  }

  function process(file, opts) {
    opts = opts || {};
    return loadImage(file).then(function (img) {
      var src = raster(img, MAX_SRC), det = raster(img, DET), sc = src.w / det.w;
      var natural = 1 / src.s;   // original px per full-size px
      var checks = [];
      var e = findEdges(det);
      if (!e) {
        checks.push({ id: 'frame', ok: false, label: 'Card not found', detail: 'whole card, plain background' });
        return { ok: false, checks: checks };
      }
      var ref = refine(src, e, sc), c = corners(ref);
      var pts = [c.tl, c.tr, c.br, c.bl];
      var top = len(c.tl, c.tr), bot = len(c.bl, c.br), lef = len(c.tl, c.bl), rig = len(c.tr, c.br);
      var wide = (top + bot) / 2, tall = (lef + rig) / 2;
      // a card lying sideways: turn it upright
      var turned = wide > tall;
      if (turned) { pts = [c.bl, c.tl, c.tr, c.br]; var t0 = wide; wide = tall; tall = t0; }
      var inside = pts.every(function (p) { return p[0] > -src.w * 0.01 && p[1] > -src.h * 0.01 && p[0] < src.w * 1.01 && p[1] < src.h * 1.01; });
      var shape = wide / tall, keystone = Math.max(top, bot) / Math.min(top, bot) - 1, keystone2 = Math.max(lef, rig) / Math.min(lef, rig) - 1;
      var sane = shape > 0.6 && shape < 0.8 && keystone < 0.35 && keystone2 < 0.35 && wide * tall > src.w * src.h * 0.06;
      if (!sane) {
        checks.push({ id: 'frame', ok: false, label: 'Card edges unclear', detail: 'plain background helps' });
        return { ok: false, checks: checks, debug: { shape: shape, keystone: keystone, keystone2: keystone2, area: wide * tall / (src.w * src.h), corners: pts.map(function (p) { return [p[0] / src.w, p[1] / src.h]; }), coarse: corners(e) } };
      }
      if (!inside || e.touches >= 2) {
        checks.push({ id: 'frame', ok: false, label: 'Card cut off', detail: 'fit the whole card' });
        return { ok: false, checks: checks };
      }
      var aspect = opts.game === 'yugioh' ? 59 / 86 : opts.game ? 63 / 88 : (Math.abs(shape - 59 / 86) < Math.abs(shape - 63 / 88) - 0.006 ? 59 / 86 : 63 / 88);
      var ch = Math.min(MAX_OUT, Math.round(tall)), cw = Math.round(ch * aspect), m = Math.round(cw * MARGIN);
      var OW = cw + 2 * m, OH = ch + 2 * m;
      var H = homography([[m, m], [m + cw, m], [m + cw, m + ch], [m, m + ch]], pts);
      var cv = document.createElement('canvas'); cv.width = OW; cv.height = OH;
      var ctx = cv.getContext('2d', { willReadFrequently: true }), out = ctx.createImageData(OW, OH), od = out.data, spx = src.px, SW = src.w, SH = src.h;
      for (var v = 0; v < OH; v++) {
        for (var u = 0; u < OW; u++) {
          var zz = H[6] * u + H[7] * v + 1, x = (H[0] * u + H[1] * v + H[2]) / zz, y = (H[3] * u + H[4] * v + H[5]) / zz, o4 = (v * OW + u) * 4;
          if (x < 0 || y < 0 || x > SW - 1.001 || y > SH - 1.001) { od[o4] = e.bg[0]; od[o4 + 1] = e.bg[1]; od[o4 + 2] = e.bg[2]; od[o4 + 3] = 255; continue; }
          var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i0 = (y0 * SW + x0) * 4, i1 = i0 + SW * 4;
          for (var k = 0; k < 3; k++) {
            var a = spx[i0 + k] + (spx[i0 + 4 + k] - spx[i0 + k]) * fx, b = spx[i1 + k] + (spx[i1 + 4 + k] - spx[i1 + k]) * fx;
            od[o4 + k] = a + (b - a) * fy;
          }
          od[o4 + 3] = 255;
        }
      }
      ctx.putImageData(out, 0, 0);
      var o = { w: OW, h: OH, px: od };

      var tilt = Math.atan2((c.tr[1] - c.tl[1]) + (c.br[1] - c.bl[1]), (c.tr[0] - c.tl[0]) + (c.br[0] - c.bl[0])) * 180 / Math.PI;
      tilt = ((tilt + 45) % 90 + 90) % 90 - 45;
      var cardPx = Math.round(wide * natural);
      checks.push({ id: 'frame', ok: true, label: 'Whole card in frame', detail: '4 corners found' });
      checks.push(cardPx >= 900
        ? { id: 'size', ok: true, label: 'Big enough', detail: cardPx + ' px wide' }
        : { id: 'size', ok: false, label: 'Card too small', detail: 'move closer' });
      var sl = sleeve(o, m, cw, ch);
      var ew = sl.sleeved ? null : edgeWidth(o, m, cw, ch);
      checks.push(sl.sleeved
        ? { id: 'sharp', ok: true, label: 'Sharpness', detail: 'checked once out of the sleeve' }
        : ew == null
        ? { id: 'sharp', ok: true, label: 'Sharpness', detail: 'couldn’t measure' }
        : ew <= 6
          ? { id: 'sharp', ok: true, label: 'Sharp', detail: 'edge ' + ew.toFixed(1) }
          : { id: 'sharp', ok: false, label: 'Looks soft', detail: 'hold still, tap to focus' });
      var gl = glare(o, m, cw, ch);
      checks.push(gl.share < 0.0025
        ? { id: 'glare', ok: true, label: 'No glare', detail: '' }
        : { id: 'glare', ok: false, label: 'Glare, ' + gl.where, detail: 'move the light' });
      checks.push(sl.sleeved
        ? { id: 'sleeve', ok: false, label: 'Looks sleeved', detail: 'take it out' }
        : { id: 'sleeve', ok: true, label: 'Out of sleeve', detail: '' });

      return new Promise(function (res) {
        cv.toBlob(function (blob) {
          res({
            ok: true, blob: blob, url: URL.createObjectURL(blob), w: OW, h: OH,
            outer: { l: m / OW, r: (m + cw) / OW, t: m / OH, b: (m + ch) / OH },
            tilt: Math.round(tilt * 10) / 10, keystone: Math.round(Math.max(keystone, keystone2) * 1000) / 10, turned: turned,
            checks: checks, debug: { edge: ew, glare: gl, sleeve: sl, corners: pts.map(function (p) { return [p[0] / src.w, p[1] / src.h]; }) }
          });
        }, 'image/jpeg', 0.93);
      });
    });
  }

  window.ALRPhoto = { process: process };
})();
