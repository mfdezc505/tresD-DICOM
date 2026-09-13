import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const DOCS = '/home/claude/tresD_DICOM/docs', OUT = '/home/claude/tresD_DICOM/tests/out';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(DOCS, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(8785, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); } catch (e) {} });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('  pageerror', e.message));
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error') console.log('  [error]', tx.slice(0, 200)); if (tx.startsWith('tresD ATM')) console.log('   ', tx.slice(0, 200)); });
const ev = (fn, a) => page.evaluate(fn, a);
await page.goto('http://localhost:8785/'); await page.waitForTimeout(600);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await page.waitForTimeout(1000);
// flujo real: botón ATM + un clic sobre cada cóndilo en el corte CORONAL
await page.click('#btn-atm'); await page.waitForTimeout(1200);
console.log('barra visible:', !(await page.locator('#aw-bar').evaluate((e) => e.classList.contains('hidden'))), '·', await page.textContent('#aw-text'));
const SEEDS = [[-54, -24, 43], [50, -29, 45]];
const box = await page.locator('#vpCor').boundingBox();
for (const w of SEEDS) {
  // llevar el corte coronal a la altura de la marca y pinchar
  await ev((w) => { const V = window.tresd.V; const vp = V.getEngine().getViewport('vpCor'); const c = vp.getCamera(); vp.setCamera({ ...c, focalPoint: [c.focalPoint[0], w[1], c.focalPoint[2]] }); vp.render(); }, w);
  await page.waitForTimeout(500);
  const c = await ev((w) => window.tresd.V.getEngine().getViewport('vpCor').worldToCanvas(w), w);
  await page.mouse.click(box.x + c[0], box.y + c[1]);
  await page.waitForTimeout(800);
}
await page.waitForFunction(() => /^(Cortes de ATM|Ahí no|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
console.log('estado:', await page.textContent('#status-text'));
console.log('disposición', await ev(() => document.querySelector('#grid').dataset.layout), '· celdas', await page.locator('#atm-grid .atm-cell').count());
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, 'atm.png') });
await page.screenshot({ path: path.join(OUT, 'atm_only.png'), clip: await page.locator('#vpAtm').boundingBox() });
await browser.close(); server.close();
