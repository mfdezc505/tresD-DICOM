// Comprobaciones de v0.7.2 (peticiones de Manuel del 13-09-2026):
//  1) la panorámica ya no sale con tanto contraste
//  2) los cortes de ATM van a 1 mm y se recorren con la rueda del ratón
//  3) se pueden hacer medidas sobre los cortes de ATM
//  4) «Lateral D» / «Lateral I» pasan a «Derecha» / «Izquierda»
//  5) en modo claro se leen los rótulos de los cortes de ATM
//  6) la panorámica es más alta y la curva llega hasta los cóndilos
// Uso: node tests/v072.mjs
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
await new Promise((r) => server.listen(8787, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); if (/tresD ATM/.test(tx)) console.log('   ', tx.slice(0, 180)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(ROOT, 'tests/out', n) });
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto('http://localhost:8787/');
await sleep(600);

console.log('— nombres de las vistas laterales');
const views = await ev(() => [...document.querySelectorAll('#viewbtns button, header button')].map((b) => b.textContent.trim()));
check(views.includes('Derecha') && views.includes('Izquierda'), `la barra dice «Derecha» e «Izquierda» (${views.slice(0, 7).join(' | ')})`);
check(!views.some((v) => /Lateral [DI]/.test(v)), 'ya no aparece «Lateral D» ni «Lateral I»');

console.log('— carga del CBCT');
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1000);
check(true, 'CBCT cargado');

console.log('— panorámica: contraste, alto y curva hasta los cóndilos');
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano, null, { timeout: 300000 });
await sleep(1200);
const pan = await ev(() => {
  const p = window.tresd.V.state.pano, c = p.curve.control;
  return { w: p.image.width, h: p.image.height, ctrl: c.length, len: p.curve.length, win: [p.win.lower, p.win.upper], ends: [c[0], c[c.length - 1]] };
});
check(pan.h >= 280, `imagen más alta: ${pan.h} filas = ${Math.round(pan.h * 0.4)} mm (antes 213 = 85 mm)`);
check(pan.ctrl === 13, `${pan.ctrl} puntos de control (11 en v0.7.2, 9 en v0.7.1)`);
check(pan.len > 180, `curva de ${pan.len.toFixed(0)} mm (antes ~135)`);
// el punto negro ya no se come el hueso ni las partes blandas (antes ~p62, unos 1000 HU)
check(pan.win[0] < 500, `negro por debajo de las partes blandas: ${Math.round(pan.win[0])} HU (antes ~1000)`);
check(pan.win[1] - pan.win[0] > 2000, `ventana ancha (${Math.round(pan.win[1] - pan.win[0])} HU): menos contraste`);
// los extremos de la curva caen cerca de los cóndilos de este CBCT (D x≈−58, I x≈+50)
const dR = Math.abs(pan.ends[0][0] + 58), dL = Math.abs(pan.ends[1][0] - 50);
check(dR < 18 && dL < 18, `los extremos llegan a los cóndilos (D ${pan.ends[0].map((v) => v.toFixed(0))}, I ${pan.ends[1].map((v) => v.toFixed(0))})`);
await shot('v072_pano.png');

console.log('— cortes de ATM a 1 mm');
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
await ev(() => window.tresd.renderTmj());
await page.click('#lay-atm');
await sleep(800);
const offs0 = await ev(() => window.tresd.V.state.tmj.series.R.map((x) => `${x.family}:${x.off}`));
check(offs0.join(' ') === 'sag:-2 sag:-1 sag:0 sag:1 sag:2 cor:0 axi:0', `sagitales cada 1 mm (${offs0.join(' ')})`);
const labels = await ev(() => [...document.querySelectorAll('#atm-grid .atm-cell:not(.atm-gap) span')].slice(0, 5).map((s) => s.textContent));
check(/1 mm/.test(labels.join(' ')) && /centro/.test(labels.join(' ')), `rótulos con el desplazamiento (${labels.join(' · ')})`);

console.log('— rueda del ratón sobre los cortes');
const cellBox = await page.locator('#atm-grid .atm-cell:not(.atm-gap)').first().boundingBox();
await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 120); await sleep(120); }
const offs1 = await ev(() => window.tresd.V.state.tmj.series.R.map((x) => `${x.family}:${x.off}`));
check(offs1.join(' ') === 'sag:1 sag:2 sag:3 sag:4 sag:5 cor:0 axi:0', `la rueda mueve los 5 sagitales 1 mm por muesca (${offs1.join(' ')})`);
const sameL = await ev(() => window.tresd.V.state.tmj.series.L.every((x) => x.off === (x.base || 0)));
check(sameL, 'el otro lado no se mueve');
// la rueda sobre el coronal mueve solo el coronal
const corBox = await page.locator('#atm-grid .atm-cell[data-key="cor"]').first().boundingBox();
await page.mouse.move(corBox.x + corBox.width / 2, corBox.y + corBox.height / 2);
await page.mouse.wheel(0, -120); await sleep(200);
const offs2 = await ev(() => window.tresd.V.state.tmj.series.R.map((x) => `${x.family}:${x.off}`));
check(offs2.join(' ') === 'sag:1 sag:2 sag:3 sag:4 sag:5 cor:-1 axi:0', `la rueda sobre el coronal solo mueve el coronal (${offs2.join(' ')})`);
// y la imagen cambia de verdad
const changed = await ev(() => {
  const V = window.tresd.V, s = V.state.tmj.series.R.find((x) => x.family === 'cor');
  const sum = (d) => { let t = 0; for (let i = 0; i < d.length; i += 13) t += d[i]; return t / Math.ceil(d.length / 13); };
  const a = sum(s.img.data);
  V.scrollTmj('R', 'cor', 6);
  const b = sum(V.state.tmj.series.R.find((x) => x.family === 'cor').img.data);
  V.scrollTmj('R', 'cor', -6);
  return Math.abs(a - b) > 5;
});
check(changed, 'el corte se recalcula de verdad al desplazarse');
await shot('v072_atm.png');

console.log('— medidas sobre los cortes de ATM');
const mBox = await page.locator('#atm-grid .atm-cell[data-key="sag0"]').first().boundingBox();
await page.mouse.move(mBox.x + mBox.width * 0.35, mBox.y + mBox.height * 0.35);
await page.mouse.down();
await page.mouse.move(mBox.x + mBox.width * 0.65, mBox.y + mBox.height * 0.65, { steps: 8 });
await page.mouse.up();
await sleep(400);
const meas = await ev(() => { const m = window.tresd.V.getAllTmjMeas(); const k = Object.keys(m)[0]; return { k, n: k ? m[k].length : 0, st: document.querySelector('#status-text').textContent }; });
check(meas.n === 1, `una medida guardada en ${meas.k}`);
check(/mm/.test(meas.st), `se muestra el valor: ${meas.st.slice(0, 60)}`);
await shot('v072_atm_medida.png');
await page.keyboard.press('Control+z'); await sleep(400);
check((await ev(() => Object.values(window.tresd.V.getAllTmjMeas()).reduce((a, l) => a + l.length, 0))) === 0, 'Ctrl+Z quita la medida');
await page.keyboard.press('Control+y'); await sleep(400);
check((await ev(() => Object.values(window.tresd.V.getAllTmjMeas()).reduce((a, l) => a + l.length, 0))) === 1, 'Ctrl+Y la devuelve');
await page.click('#atm-clear'); await sleep(300);
check((await ev(() => Object.values(window.tresd.V.getAllTmjMeas()).reduce((a, l) => a + l.length, 0))) === 0, 'el botón «Borrar medidas» las quita todas');

console.log('— modo claro: rótulos de los cortes de ATM');
await page.click('#btn-theme'); await sleep(600);
const lbl = await ev(() => {
  const s = document.querySelector('#atm-grid .atm-cell:not(.atm-gap) span');
  const c = getComputedStyle(s);
  return { color: c.color, bg: c.backgroundColor, theme: document.documentElement.dataset.theme || '' };
});
check(/rgb\(255,\s*255,\s*255\)/.test(lbl.color), `rótulo en blanco en modo ${lbl.theme || 'claro'} (${lbl.color})`);
check(/rgba\(0,\s*0,\s*0/.test(lbl.bg), `sobre pastilla oscura (${lbl.bg})`);
await shot('v072_atm_claro.png');

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
