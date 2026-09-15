// Comprobaciones de v0.7.12 (peticiones de Manuel del 15-09-2026):
//  1) al segmentar se vuelve al 2×2
//  2) «✏ Dibujar curva»: clics sobre el axial → panorámica con esa curva (y si se dibuja de izquierda a
//     derecha, se invierte sola); Deshacer quita el último punto; Esc cancela
//  3) letra «Pequeña» por defecto y opción nueva «Muy pequeña»
//  4) el botón Cruz se desactiva en Render 3D, Panorámica y ATM
// Uso: node tests/v0712.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8800, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); localStorage.removeItem('tresd_dicom_font'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(ROOT, 'tests/out', n) });
const sleep = (ms) => page.waitForTimeout(ms);
const layoutIds = () => ev(() => [...document.querySelectorAll('#grid .vp')].filter((e) => !e.classList.contains('hidden')).map((e) => e.dataset.id).join(','));
const crossOff = () => page.locator('#btn-cross').isDisabled();

await page.goto('http://localhost:8800/');
await sleep(600);

console.log('— 3) tamaño de letra');
check((await ev(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim())) === '0.88', 'letra «Pequeña» (0,88) por defecto sin nada guardado');
await page.click('#btn-font'); await sleep(200);
const opts = await ev(() => [...document.querySelectorAll('.menu button')].map((b) => b.textContent.replace('✓ ', '')));
check(opts.length === 5 && opts[0] === 'Muy pequeña', `cinco tamaños, el primero «Muy pequeña» (${opts.join(' · ')})`);
check((await ev(() => [...document.querySelectorAll('.menu button')].find((b) => b.textContent.startsWith('✓')).textContent)) === '✓ Pequeña', 'la marca está en «Pequeña»');
await page.click('.menu button:first-child'); await sleep(200);
check((await ev(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim())) === '0.78', '«Muy pequeña» aplica 0,78');
await page.click('#btn-font'); await sleep(150); await page.click('.menu button:nth-child(2)'); await sleep(150);   // vuelta a Pequeña

await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1200);

console.log('— 4) botón Cruz según la disposición');
check(!(await crossOff()), 'en 2×2 la Cruz está disponible');
await page.click('[data-layout="vp3d"]'); await sleep(400);
check(await crossOff(), 'en Render 3D la Cruz está desactivada');
await page.click('[data-layout="vpAx"]'); await sleep(400);
check(!(await crossOff()), 'en el axial vuelve a estar disponible');
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano, null, { timeout: 300000 });
await sleep(1200);
check(await crossOff(), 'en Panorámica está desactivada');

console.log('— 2) dibujar la curva a mano');
const auto = await ev(() => window.tresd.V.getPanoControl());
check(auto.length === 13, `curva automática de ${auto.length} puntos`);
await page.click('#pan-draw'); await sleep(1500);
check((await layoutIds()) === 'vpAx', `solo el axial en pantalla (${await layoutIds()})`);
check(!(await page.locator('#pd-bar').evaluate((e) => e.classList.contains('hidden'))), 'barra «DIBUJAR CURVA» visible');
check(await page.locator('#pd-done').isDisabled(), '«Terminar» desactivado sin puntos');
// 5 puntos de la curva automática, marcados de IZQUIERDA a DERECHA del paciente (al revés a propósito)
const zC = await ev(() => window.tresd.V.state.pano.curve.z);
const zAx = await ev(() => window.tresd.V.viewportFocal(window.tresd.V.VP.ax)[2]);
check(Math.abs(zAx - zC) < 2, `el axial se ha puesto a la altura de los dientes (${zAx.toFixed(1)} vs ${zC.toFixed(1)})`);
const pick = [12, 9, 6, 3, 0].map((i) => auto[i]);
const box = await page.locator('#vpAx').boundingBox();
for (const w of pick) {
  const c = await ev((w) => window.tresd.V.getEngine().getViewport('vpAx').worldToCanvas([w[0], w[1], window.tresd.V.state.pano.curve.z]), w);
  await page.mouse.click(box.x + c[0], box.y + c[1]); await sleep(250);
}
check((await ev(() => window.tresd.V.state.panDraw.length)) === 5, 'cinco puntos marcados');
check(/5 puntos/.test(await ev(() => document.querySelector('#pd-text').textContent)), 'la barra cuenta los puntos');
await shot('v0712_dibujar.png');
await page.click('#pd-undo'); await sleep(200);
check((await ev(() => window.tresd.V.state.panDraw.length)) === 4, '«Deshacer» quita el último');
const c5 = await ev((w) => window.tresd.V.getEngine().getViewport('vpAx').worldToCanvas([w[0], w[1], window.tresd.V.state.pano.curve.z]), pick[4]);
await page.mouse.click(box.x + c5[0], box.y + c5[1]); await sleep(250);
check(!(await page.locator('#pd-done').isDisabled()), '«Terminar» activado con puntos suficientes');
await page.click('#pd-done');
await page.waitForFunction(() => window.tresd.V.getPanoControl() && window.tresd.V.getPanoControl().length === 5, null, { timeout: 120000 });
await sleep(1200);
const drawn = await ev(() => window.tresd.V.getPanoControl());
check(drawn.length === 5, `la panorámica se rehace con la curva dibujada (${drawn.length} puntos)`);
check(drawn[0][0] < drawn[4][0], `dibujada al revés, se invierte sola (x: ${drawn[0][0].toFixed(0)} → ${drawn[4][0].toFixed(0)})`);
check((await layoutIds()) === 'vpPan', `vuelve a la panorámica (${await layoutIds()})`);
check(await page.locator('#pd-bar').evaluate((e) => e.classList.contains('hidden')), 'la barra desaparece');
check((await ev(() => window.tresd.V.state.panDraw)) === null, 'los puntos del dibujo se quitan del axial');
await shot('v0712_pano_dibujada.png');
// deshacer devuelve la automática
await page.keyboard.press('Control+z'); await sleep(1500);
check((await ev(() => window.tresd.V.getPanoControl().length)) === 13, 'Ctrl+Z devuelve la curva automática');
// Esc cancela sin tocar nada
await page.click('#pan-draw'); await sleep(800);
await page.keyboard.press('Escape'); await sleep(600);
check((await layoutIds()) === 'vpPan' && (await ev(() => window.tresd.V.getPanoControl().length)) === 13, 'Esc cancela el dibujo y vuelve a la panorámica');

console.log('— 1) al segmentar se vuelve al 2×2');
await page.click('[data-layout="vp3d"]'); await sleep(400);
await page.click('#btn-seg');
await page.waitForFunction(() => window.tresd.V.softMesh(), null, { timeout: 600000 });
await sleep(1500);
check((await layoutIds()) === 'vp3d,vpAx,vpCor,vpSag', `tras segmentar: 2×2 (${await layoutIds()})`);

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
