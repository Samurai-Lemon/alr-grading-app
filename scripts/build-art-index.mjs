// Rebuilds the One Piece artwork index (src/vendor/cardart/one-piece.{json,bin}) that card
// recognition compares photos against. Run before a release so new sets are included:
//
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/build-art-index.mjs
//
// It loads every printing's image from optcgapi.com (through images.weserv.nl, as the app does)
// in a headless browser, works out the same artwork pattern recognize.js uses, and writes the
// patterns as signed bytes (40×30 each). The card-back pattern already in the index is kept.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_FROM ? process.env.PLAYWRIGHT_FROM + '/' : import.meta.url)('playwright');

const SRC = path.resolve('src'), OUT = path.join(SRC, 'vendor', 'cardart');
const PAGE = `<!doctype html><html><body><script src="alr-graded.js"></script><script src="recognize.js"></script></body></html>`;
const types = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__build.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  const file = path.join(SRC, url);
  if (!file.startsWith(SRC) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/__build.html`);
const result = await page.evaluate(async () => {
  const R = window.ALRRecognize;
  const load = s => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('img')); i.src = s; });
  const lists = await Promise.all(['allSetCards', 'allSTCards', 'allPromos'].map(e => fetch('https://optcgapi.com/api/' + e + '/').then(r => r.json()).catch(() => [])));
  const seen = {}, imgs = [];
  [].concat(...lists).forEach(c => { if (c.card_image && !seen[c.card_image]) { seen[c.card_image] = 1; imgs.push(c.card_image); } });
  const out = new Array(imgs.length);
  let k = 0, fails = 0;
  async function worker() {
    while (k < imgs.length) {
      const i = k++;
      for (let tries = 0; tries < 3 && !out[i]; tries++) {
        try { out[i] = R.pattern(await load(R.thumb(imgs[i]))); } catch { await new Promise(r => setTimeout(r, 1500)); }
      }
      if (!out[i]) fails++;
    }
  }
  await Promise.all(Array.from({ length: 10 }, worker));
  const keys = [], bytes = [];
  imgs.forEach((u, i) => {
    const g = out[i];
    if (!g) return;
    let mx = 0; for (const v of g) mx = Math.max(mx, Math.abs(v));
    keys.push(u);
    for (const v of g) bytes.push(Math.round(v / mx * 127));
  });
  return { keys, bytes, total: imgs.length, fails };
});
await browser.close();
server.close();

const BASE = 'https://optcgapi.com/media/static/Card_Images/';
const old = fs.existsSync(path.join(OUT, 'one-piece.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'one-piece.json'), 'utf8')) : {};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'one-piece.json'), JSON.stringify({
  v: 1, built: new Date().toISOString().slice(0, 10), w: 40, h: 30, base: BASE,
  keys: result.keys.map(u => u.replace(BASE, '')), back: old.back
}));
fs.writeFileSync(path.join(OUT, 'one-piece.bin'), Buffer.from(Int8Array.from(result.bytes).buffer));
console.log(`artwork index: ${result.keys.length} of ${result.total} printings (${result.fails} images failed to load)`);
