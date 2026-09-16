// Comprobaciones de v0.7.18 (peticiones de Manuel del 16-09-2026):
//  1) tras marcar los dos cóndilos se abre solo «Ajustar polos» (Cancelar deja la propuesta automática)
//  2) el corte de ATM ampliado tiene «📷 Captura»: PNG con el corte, sus medidas, el rótulo y la marca de agua
// Uso: node tests/v0718.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(ROOT, 'tests/out');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8790, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, locale: 'es-ES', acceptDownloads: true });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(OUT, n) });
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto('http://localhost:8790/');
await sleep(600);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1500);

console.log('— 1) marcar los cóndilos por la interfaz → se abre «Ajustar polos»');
await page.click('#btn-atm'); await sleep(1500);
// los dos clics sobre el coronal, en la posición en pantalla de los cóndilos estimados
const pts = await ev(() => { const V = window.tresd.V; const vp = V.state.engine.getViewport('vpCor'); return [[-54, -24, 43], [50, -29, 45]].map((w) => vp.worldToCanvas(w)); });
const box = await page.locator('#vpCor').boundingBox();
for (const [x, y] of pts) { await page.mouse.click(box.x + x, box.y + y); await sleep(600); }
await page.waitForFunction(() => /^(Cortes de ATM|Ahí no|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1200);
check(/^Cortes de ATM/.test(await ev(() => document.querySelector('#status-text').textContent)), 'cortes de ATM calculados');
check((await page.locator('.modal.poles').count()) === 1, 'se abre solo la ventana «Polos del cóndilo»');
check(/Propuesta automática/.test(await page.textContent('.modal.poles .hint')), 'la pista explica que es una propuesta a revisar');
await shot('v0718_polos_auto.png');
const before = await ev(() => JSON.stringify(window.tresd.V.getCondylePoles('R')));
await page.click('#dlg-cancel'); await sleep(400);
check((await page.locator('.modal.poles').count()) === 0 && (await ev(() => JSON.stringify(window.tresd.V.getCondylePoles('R')))) === before, 'Cancelar cierra y deja la propuesta automática');
check((await page.locator('#atm-grid .atm-cell:not(.atm-gap)').count()) === 14, 'el mosaico está detrás con sus 14 cortes');

console.log('— 2) captura del corte ampliado con medidas');
await ev(() => window.tresd.openAtmBig('R', 'sag0')); await sleep(700);
check(await page.locator('#ab-shot').isVisible(), 'el corte ampliado tiene el botón «📷 Captura»');
await page.click('#ab-len'); await sleep(150);
const ab = await page.locator('#ab-canvas').boundingBox();
await page.mouse.click(ab.x + ab.width * 0.3, ab.y + ab.height * 0.35); await sleep(200);
await page.mouse.click(ab.x + ab.width * 0.6, ab.y + ab.height * 0.65); await sleep(400);
check((await ev(() => Object.values(window.tresd.V.getAllTmjMeas()).flat().length)) === 1, 'una medida sobre el corte');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#ab-shot')]);
const file = path.join(OUT, 'v0718_captura_atm.png');
await dl.saveAs(file);
check(/tresD_DICOM_ATM_R_sag0_/.test(dl.suggestedFilename()) && fs.statSync(file).size > 20000, `se descarga «${dl.suggestedFilename()}» (${Math.round(fs.statSync(file).size / 1024)} kB)`);
// la imagen lleva la medida (color de la medida) y el logotipo (colores saturados abajo a la derecha)
const px = await ev(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  const col = window.tresd.V.MEAS_COLORS[0];       // primera medida: primer color
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const c = hex(col);
  let meas = 0, logo = 0;
  const mw = Math.round(cv.width * 0.16), mh = Math.round(mw * 0.35), pad = Math.round(cv.width * 0.015);
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const i = 4 * (y * cv.width + x);
    if (Math.abs(d[i] - c[0]) < 30 && Math.abs(d[i + 1] - c[1]) < 30 && Math.abs(d[i + 2] - c[2]) < 30) meas++;
    if (x >= cv.width - mw - pad && y >= cv.height - mh - pad) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx - mn > 60 && mx > 120) logo++; }
  }
  return { w: cv.width, h: cv.height, meas, logo, col };
}, fs.readFileSync(file).toString('base64'));
check(px.meas > 40, `la captura incluye la medida (${px.meas} píxeles del color ${px.col})`);
check(px.logo > 50, `y la marca de agua (${px.logo} píxeles saturados en la esquina)`);
console.log(`   captura ${px.w}×${px.h}`);
await page.click('#ab-close'); await sleep(300);

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
