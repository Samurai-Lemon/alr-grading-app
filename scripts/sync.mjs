// Copies the Grading Terminal (editor markup, styles and label script) out of the website
// build into src/, so the app and alrinitiative.com share one label design.
// Usage: build the site first (npx quartz build in ../alr-archive), then `npm run sync`.
import fs from 'node:fs';
import path from 'node:path';

const site = process.env.ALR_SITE || path.resolve('..', 'alr-archive');
const page = fs.readFileSync(path.join(site, 'public', 'label-creator.html'), 'utf8');

function balancedDiv(html, startMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error('not found: ' + startMarker);
  const re = /<\/?div\b[^>]*>/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  throw new Error('unbalanced: ' + startMarker);
}
function blockWith(html, tag, needle) {
  const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'g');
  let m;
  while ((m = re.exec(html))) if (m[1].includes(needle)) return m[1];
  throw new Error(`no <${tag}> containing ${needle}`);
}

const tool = balancedDiv(page, '<div id="alr-lc-tool"');
const css = blockWith(page, 'style', '.alr-lc-wrap{');
const js = blockWith(page, 'script', 'function cricutSvg');

fs.writeFileSync('src/tool.html', tool);
fs.writeFileSync('src/tool.css', css);
fs.writeFileSync('src/label.js', js);
// report PDF, card lookup and photos (shared with the site's cert page and Account list)
fs.copyFileSync(path.join(site, 'quartz', 'static', 'alr-graded.js'), 'src/alr-graded.js');
// the card grid styles from the site's Account page (My Cards uses the same layout)
const gradedTsx = fs.readFileSync(path.join(site, 'quartz', 'components', 'ALRGradedCards.tsx'), 'utf8');
const gcStart = gradedTsx.indexOf('/* account: your graded cards */');
const gcCss = gcStart < 0 ? '' : gradedTsx.slice(gcStart, gradedTsx.indexOf('`', gcStart));
const shell = fs.readFileSync('src/shell.html', 'utf8')
  .replace('<!--TOOL-->', tool)
  .replace('/*TOOLCSS*/', css)
  .replace('/*CARDSCSS*/', gcCss);
fs.writeFileSync('src/index.html', shell);
console.log(`synced from ${site}: markup ${tool.length} B, css ${css.length} B, script ${js.length} B`);
