// Comprobaciones de v0.7.6 (peticiones de Manuel del 14-09-2026):
//  1) las etiquetas de los cortes de ATM ya no salen borrosas (el canvas se pinta a la resolución de la
//     pantalla, no a la del corte)
//  2) al marcar los cóndilos, el corte coronal salta DE VERDAD a su altura (antes Cornerstone recolocaba
//     la cámara después del cambio de disposición y se comía el salto)
//  3) los polos MEDIAL y LATERAL del cóndilo derecho no salen cambiados en un CBCT cuyo origen no está en
//     la línea media (volumen entero en x > 0)
// Uso: node tests/v076.mjs
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
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); if (/tresD ATM/.test(tx)) console.log('   ', tx.slice(0, 180)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(ROOT, 'tests/out', n) });
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto('http://localhost:8790/');
await sleep(600);

console.log('— carga del CBCT');
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1200);
check(true, 'CBCT cargado');

console.log('— 2) el coronal salta a la altura de los cóndilos al marcar');
await page.click('#btn-atm');
await sleep(1600);
const jump = await ev(() => {
  const V = window.tresd.V, g = V.condyleGuess();
  const f = V.viewportFocal(V.VP.cor);
  return { g: g.map((v) => +v.toFixed(1)), f: f.map((v) => +v.toFixed(1)), bar: !document.querySelector('#atm-bar').classList.contains('hidden') };
});
check(Math.abs(jump.f[1] - jump.g[1]) < 1, `corte coronal en y=${jump.f[1]} = altura estimada de los cóndilos ${jump.g[1]} (antes se quedaba en el centro del volumen)`);
check(jump.bar, 'la barra de marcar está visible');
await shot('v076_marcar.png');
await page.click('#atm-cancel'); await sleep(500);

console.log('— cortes de ATM');
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
await ev(() => window.tresd.renderTmj());
await page.click('#lay-atm');
await sleep(900);

console.log('— 1) nitidez de las etiquetas');
// una medida sobre el corte sagital central, para que haya etiqueta que mirar
await page.click('#atm-grid .atm-cell[data-key="sag0"] .atm-zoom', { force: true });
await sleep(800);
await page.click('#ab-len'); await sleep(150);                 // v0.7.14: se mide con el botón «Distancia»
const mBox = await page.locator('#ab-canvas').boundingBox();
await page.mouse.move(mBox.x + mBox.width * 0.35, mBox.y + mBox.height * 0.4);
await page.mouse.down();
await page.mouse.move(mBox.x + mBox.width * 0.62, mBox.y + mBox.height * 0.62, { steps: 8 });
await page.mouse.up();
await sleep(400);
const big = await ev(() => {
  const cv = document.querySelector('#ab-canvas'); const r = cv.getBoundingClientRect();
  const V = window.tresd.V, it = V.state.tmj.series.R.find((x) => x.key === 'sag0');
  return { cw: cv.width, ch: cv.height, dw: Math.round(r.width), dh: Math.round(r.height), z: +(cv._imgZoom || 1).toFixed(2), iw: it.img.w, ih: it.img.h };
});
const up = Math.min(big.dw / big.cw, big.dh / big.ch);   // cuánto amplía la PANTALLA al canvas
check(big.z > 1.5, `el canvas del modal se pinta a ${big.z}× la resolución del corte (${big.iw}×${big.ih} → ${big.cw}×${big.ch})`);
check(up < 1.08, `la pantalla ya no amplía el canvas (factor ${up.toFixed(2)}; antes ~3, por eso los rótulos salían borrosos)`);
const lab = await ev(() => {
  const cv = document.querySelector('#ab-canvas'), g = cv.getContext('2d');
  const k = cv.width / Math.min(cv.getBoundingClientRect().width, (cv.width / cv.height) * cv.getBoundingClientRect().height);
  g.font = `600 ${(11 * k).toFixed(1)}px Poppins, sans-serif`;
  return { k: +k.toFixed(2), px: +(11 * k).toFixed(1) };
});
check(lab.px >= 9, `la etiqueta se dibuja con ${lab.px} px de canvas (antes ~3,7 px ampliados a 11)`);
await shot('v076_atm_nitido.png');
await page.click('#ab-close'); await sleep(400);

console.log('— 3) polos medial/lateral con el origen fuera de la línea media');
await page.goto('http://localhost:8790/');            // sesión limpia: el visor ya tenía un estudio cargado
await sleep(700);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_offset');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1400);
const bnds = await ev(() => window.tresd.V.state.volume.imageData.getBounds().map((v) => +v.toFixed(1)));
check(bnds[0] > 50, `volumen entero en x > 0 (x de ${bnds[0]} a ${bnds[1]}): el origen no está en la línea media`);
await ev(() => window.tresd.V.buildTmj({ R: [146, 126, 43], L: [250, 121, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
const pol = await ev(() => {
  const tmj = window.tresd.V.state.tmj;
  const f = (sd) => ({ med: tmj.poles[sd].med.map((v) => +v.toFixed(1)), lat: tmj.poles[sd].lat.map((v) => +v.toFixed(1)) });
  return { mid: +tmj.midX.toFixed(1), R: f('R'), L: f('L') };
});
// derecha del paciente = x MENOR: su polo medial queda MÁS CERCA de la línea media, o sea con x MAYOR
check(pol.R.med[0] > pol.R.lat[0], `derecha: medial x=${pol.R.med[0]} más cerca de la línea media (${pol.mid}) que lateral x=${pol.R.lat[0]}`);
check(pol.L.med[0] < pol.L.lat[0], `izquierda: medial x=${pol.L.med[0]} más cerca de la línea media que lateral x=${pol.L.lat[0]}`);
check(Math.abs(pol.mid - (bnds[0] + bnds[1]) / 2) < 30, `línea media tomada de los dos cóndilos: ${pol.mid} mm`);
await ev(() => window.tresd.renderTmj());
await page.click('#lay-atm'); await sleep(600);
await page.click('#atm-poles'); await sleep(900);
const pd = await ev(() => {
  const one = document.querySelector('.modal.poles .poles-one[data-side="R"] canvas');
  return { z: +(one._imgZoom || 1).toFixed(2), w: one.width };
});
check(pd.z >= 1, `el axial de polos también se pinta a la resolución de pantalla (${pd.z}×)`);
await shot('v076_polos_offset.png');
await page.click('#dlg-cancel'); await sleep(300);

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
