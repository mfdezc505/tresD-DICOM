// ¿Se siguen dibujando los CUADRADOS de la cruz? Cuenta <rect> y <circle> en cada corte, con el ratón
// encima de una línea, y saca capturas. Uso: node tests/_dbg_cross2.mjs
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname), DOCS = path.join(ROOT, 'docs');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8790, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); } catch (e) {} });
page.setDefaultTimeout(300000);
await page.goto('http://localhost:8790/');
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await page.waitForTimeout(1200);
await page.click('#btn-cross'); await page.waitForTimeout(900);
const count = () => page.evaluate(() => {
  const out = {};
  for (const id of ['vpAx', 'vpCor', 'vpSag']) {
    const svg = document.querySelector(`#${id} svg`);
    out[id] = svg ? { rect: svg.querySelectorAll('rect').length, circle: svg.querySelectorAll('circle').length, line: svg.querySelectorAll('line').length,
      r: [...svg.querySelectorAll('circle')].map((c) => c.getAttribute('r')).slice(0, 4),
      w: [...svg.querySelectorAll('rect')].map((c) => c.getAttribute('width')).slice(0, 4) } : null;
  }
  return out;
});
console.log('quieto  ', JSON.stringify(await count()));
// ratón sobre una línea del axial (la horizontal que pasa por el centro)
const b = await page.locator('#vpAx').boundingBox();
await page.mouse.move(b.x + b.width * 0.25, b.y + b.height / 2);
await page.waitForTimeout(500);
console.log('en línea', JSON.stringify(await count()));
await page.screenshot({ path: `${ROOT}/tests/out/dbg_cross_quad.png` });
await page.click('[data-layout="main3"]'); await page.waitForTimeout(1200);
const b2 = await page.locator('#vpAx').boundingBox();
await page.mouse.move(b2.x + b2.width * 0.25, b2.y + b2.height / 2);
await page.waitForTimeout(600);
console.log('main3   ', JSON.stringify(await count()));
console.log('nodos', await page.evaluate(() => [...document.querySelector('#vpAx svg').children].map((n) => n.tagName + ' ' + (n.getAttribute('data-annotation-uid') || '') + ' | ' + n.id).slice(0, 8)));
await page.screenshot({ path: `${ROOT}/tests/out/dbg_cross_main3.png` });
await browser.close(); server.close();
