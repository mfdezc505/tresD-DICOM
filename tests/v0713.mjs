// Comprobaciones de v0.7.13 (peticiones de Manuel del 15-09-2026):
//  1) CRUZ en un equipo con pantalla táctil (`any-pointer: coarse`, como el PC de Manuel): sin CUADRADOS de
//     grosor, sin mangos a la vista si el ratón no está sobre una línea, y círculos de giro pequeños (≤ 4 px;
//     Cornerstone ponía 9 en su modo «móvil»).
//  2) el recuadro «Arrastra aquí tu CBCT» del panel izquierdo ha desaparecido (se repetía con el central);
//     el central sigue y sigue funcionando el arrastre sobre él.
// Uso: node tests/v0713.mjs
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
await new Promise((r) => server.listen(8790, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
// hasTouch: el navegador declara puntero grueso, como un portátil con pantalla táctil
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, locale: 'es-ES', hasTouch: true });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(ROOT, 'tests/out', n) });
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto('http://localhost:8790/');
await sleep(600);
check(await ev(() => window.matchMedia('(any-pointer:coarse)').matches), 'el navegador de prueba declara puntero grueso (como el PC de Manuel)');

console.log('— 2) recuadro de importar: solo el central');
const drops = await ev(() => ({ side: !!document.querySelector('#side-drop'), main: !!document.querySelector('#main-drop') && !document.querySelector('#main-drop').classList.contains('hidden'),
  txt: document.querySelector('#side') ? document.querySelector('#side').textContent : '' }));
check(!drops.side, 'el panel izquierdo ya no tiene el recuadro «Arrastra aquí tu CBCT»');
check(!/Arrastra aquí tu CBCT/.test(drops.txt), 'ni su texto');
check(drops.main, 'el recuadro central sigue visible sin estudio');
await shot('v0713_importar.png');

console.log('— carga del CBCT (arrastrando sobre el recuadro central)');
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1200);
check(await ev(() => document.querySelector('#main-drop').classList.contains('hidden')), 'con el estudio cargado el recuadro central se oculta');

console.log('— 1) cruz sin cuadrados y con círculos pequeños');
await page.click('#btn-cross');
await page.waitForFunction(() => document.querySelectorAll('#svg-layer-vpAx line').length >= 4, null, { timeout: 120000 });
await sleep(800);
const count = (id) => ev((id) => {
  const svg = document.querySelector(`#svg-layer-${id}`);
  return { rect: svg.querySelectorAll('rect').length, circle: svg.querySelectorAll('circle').length, line: svg.querySelectorAll('line').length,
    r: [...svg.querySelectorAll('circle')].map((c) => +c.getAttribute('r')) };
}, id);
const quiet = await count('vpAx');
check(quiet.line === 4 && quiet.rect === 0 && quiet.circle === 0, `sin el ratón encima: 4 líneas, ${quiet.rect} cuadrados, ${quiet.circle} círculos (el modo móvil de Cornerstone pintaba 8 cuadrados y 4 círculos fijos)`);
// ratón sobre la línea horizontal del axial
const b = await page.locator('#vpAx').boundingBox();
const h = await ev(() => { const l = [...document.querySelectorAll('#svg-layer-vpAx line')].map((l) => ({ x1: +l.getAttribute('x1'), y1: +l.getAttribute('y1'), x2: +l.getAttribute('x2'), y2: +l.getAttribute('y2') })); return l.find((q) => Math.abs(q.y1 - q.y2) < 2 && q.x1 > q.x2) || l[0]; });
// a un cuarto del tramo desde el centro: SOBRE la línea pero lejos del círculo de giro (que está en su punto medio)
const hx = h.x1 + (h.x2 - h.x1) * 0.25, hy = (h.y1 + h.y2) / 2;
await page.mouse.move(b.x + hx + 3, b.y + hy + 3); await sleep(300);
await page.mouse.move(b.x + hx, b.y + hy, { steps: 3 });
await page.waitForFunction(() => document.querySelectorAll('#svg-layer-vpAx circle').length > 0, null, { timeout: 20000 }).catch(() => {});
const hover = await count('vpAx');
check(hover.rect === 0, `con el ratón sobre la línea: ${hover.rect} cuadrados de grosor`);
check(hover.circle === 2, `${hover.circle} círculos de giro (uno por media línea)`);
check(hover.r.length && hover.r.every((r) => r >= 2.5 && r <= 4), `radio de los círculos ${hover.r.map((r) => r.toFixed(1)).join(' y ')} px (antes 9)`);
await shot('v0713_cruz.png');
await page.mouse.move(b.x + 10, b.y + 10); await sleep(400);

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
