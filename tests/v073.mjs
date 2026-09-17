// Comprobaciones de v0.7.3 (peticiones de Manuel del 13-09-2026):
//  1) los mangos de la cruz son más pequeños
//  2) exportar mallas a STL (botón del panel derecho y clic derecho sobre el panel)
//  3) las tarjetas de malla ya no llevan la línea de descripción / nº de triángulos
//  4) sin siluetas sobre los cortes al marcar la vía aérea ni al editar la curva panorámica
//  5) 13 puntos de control en la curva y, al editarla, el axial se pone a la altura de los dientes
//  6) los cortes de ATM son más anchos y más finos (ya no salen con franjas negras a los lados)
// Uso: node tests/v073.mjs
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
await new Promise((r) => server.listen(8788, r));
const OUT = '/tmp/testdata/descargas';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES', acceptDownloads: true });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(ROOT, 'tests/out', n) });
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto('http://localhost:8788/');
await sleep(500);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await page.check('#sil-vis'); await page.waitForTimeout(300);   // v0.8.3: las siluetas van apagadas por defecto; estas pruebas las necesitan
await sleep(1000);
check(true, 'CBCT cargado');

console.log('— mangos de la cruz');
const cross = await ev(() => {
  const g = window.tresd.V.tools.ToolGroupManager.getToolGroup('tg-mpr');
  const c = g.getToolConfiguration('Crosshairs');
  return { r: c.handleRadius, hdpi: c.enableHDPIHandles };
});
check(cross.r >= 2.5 && cross.r <= 4, `radio de los mangos ${cross.r.toFixed(2)} px (2,5–4 desde v0.7.13; 3 de fábrica)`);
check(cross.hdpi === false, 'sin escalado por densidad de pantalla (en pantallas retina se veían al doble)');

console.log('— curva panorámica');
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano, null, { timeout: 300000 });
await sleep(1200);
check((await ev(() => window.tresd.V.state.pano.curve.control.length)) === 13, '13 puntos de control (11 en v0.7.2)');
// al editar: axial a la altura de los dientes y SIN siluetas
const zTeeth = await ev(() => window.tresd.V.state.pano.curve.z);
await ev(() => { const vp = window.tresd.V.getEngine().getViewport('vpAx'); const c = vp.getCamera();
  vp.setCamera({ focalPoint: [c.focalPoint[0], c.focalPoint[1], c.focalPoint[2] + 40], position: [c.position[0], c.position[1], c.position[2] + 40] }); vp.render(); });
await sleep(400);
const zAntes = await ev(() => window.tresd.V.getEngine().getViewport('vpAx').getCamera().focalPoint[2]);
await page.click('#pan-edit');
await sleep(900);
const zDespues = await ev(() => window.tresd.V.getEngine().getViewport('vpAx').getCamera().focalPoint[2]);
check(Math.abs(zAntes - zTeeth) > 30, `el axial estaba lejos de los dientes (${zAntes.toFixed(0)} vs ${zTeeth.toFixed(0)} mm)`);
check(Math.abs(zDespues - zTeeth) < 2, `al editar, el axial salta a la altura de los dientes (${zDespues.toFixed(1)} mm, dientes ${zTeeth.toFixed(1)})`);
check((await ev(() => window.tresd.V.state.silhouettes)) === true && (await ev(() => window.tresd.V.silhouettesSuppressed())) === true, 'siluetas apagadas mientras se edita (sin tocar la casilla)');
check((await ev(() => window.tresd.V.state.panoEdit)) === true, 'modo edición activo');
await shot('v073_pan_edit.png');
await page.click('#pan-edit'); await sleep(600);

console.log('— tarjetas de malla y exportación');
await page.click('#btn-seg');
await page.waitForFunction(() => window.tresd.V.getMeshes().length >= 2, null, { timeout: 300000 });
await sleep(1500);
check((await page.locator('#mesh-cards .m-desc').count()) === 0, 'las tarjetas ya no llevan la línea de descripción / triángulos');
check(!(await page.locator('#btn-export').first().isHidden()), 'aparece el botón de exportar en el panel derecho');
// clic derecho sobre el panel: abre el mismo diálogo
await page.click('#vispanel', { button: 'right', position: { x: 20, y: 40 } });
await sleep(400);
check((await page.locator('.modal-bg .exp-list').count()) === 1, 'el clic derecho sobre el panel abre el diálogo de exportar');
const n = await page.locator('.exp-one').count();
check(n >= 2, `lista con las ${n} mallas del caso`);
// dejar solo la primera y exportar
await page.locator('.exp-one').nth(1).uncheck();
const dl = page.waitForEvent('download');
await page.click('.modal-bg #dlg-ok');
const file = await dl;
const dest = path.join(OUT, file.suggestedFilename());
await file.saveAs(dest);
await sleep(500);
const size = fs.statSync(dest).size;
const head = fs.readFileSync(dest).subarray(0, 84);
const nTri = head.readUInt32LE(80);
check(/\.stl$/i.test(dest), `se descarga ${path.basename(dest)}`);
check(size === 84 + 50 * nTri && nTri > 1000, `STL binario correcto: ${nTri.toLocaleString()} triángulos, ${(size / 1e6).toFixed(1)} MB`);
check((await page.locator('.modal-bg').count()) === 0, 'el diálogo se cierra al exportar');
// las coordenadas del STL están en el marco del paciente (caben en el volumen)
const dv = new DataView(fs.readFileSync(dest).buffer);
let minZ = Infinity, maxZ = -Infinity;
const paso = Math.max(1, Math.floor(nTri / 4000));
for (let t = 0; t < nTri; t += paso) { const o = 84 + 50 * t + 12; for (let v = 0; v < 3; v++) { const z = dv.getFloat32(o + 12 * v + 8, true); if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; } }
check(maxZ - minZ > 10 && Math.abs(minZ) < 400 && Math.abs(maxZ) < 400, `coordenadas en mm del paciente (Z de ${minZ.toFixed(0)} a ${maxZ.toFixed(0)})`);

console.log('— siluetas al marcar la vía aérea');
await page.click('#btn-airway');
await sleep(700);
check((await ev(() => window.tresd.V.state.silhouettes)) === true && (await ev(() => window.tresd.V.silhouettesSuppressed())) === true, 'siluetas apagadas al marcar la vía aérea (sin tocar la casilla)');
const silPix = await ev(() => {
  const cv = document.querySelector('#vpSag .silh'); if (!cv) return -1;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
});
check(silPix >= 0 && silPix < 400, `el corte sagital sale limpio mientras se marca (${silPix} píxeles dibujados)`);
await shot('v073_aw.png');
await page.keyboard.press('Escape'); await sleep(1200);
check((await ev(() => window.tresd.V.silhouettesSuppressed())) === false, 'al salir vuelven las siluetas');

console.log('— cortes de ATM');
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
await ev(() => window.tresd.renderTmj());
await page.click('#lay-atm');
// el encuadre llega tras el resize del render 3D (lento en SwiftShader con mallas): se espera a que se aplique
await page.waitForFunction(() => document.querySelector('#atm-grid').style.gridAutoRows !== '', null, { timeout: 30000 });
await sleep(600);
const tmj = await ev(() => {
  const s = window.tresd.V.state.tmj.series.R[2].img;
  const cell = document.querySelector('#atm-grid .atm-cell:not(.atm-gap)');
  const r = cell.getBoundingClientRect();
  return { w: s.w, h: s.h, step: s.step, cell: r.width / r.height };
});
check(tmj.step <= 0.15, `cortes más finos: ${tmj.step.toFixed(3)} mm/píxel (0,2 en v0.7.2)`);
check(tmj.h * tmj.step > 30 && tmj.w * tmj.step > 24, `campo del corte ${(tmj.w * tmj.step).toFixed(0)}×${(tmj.h * tmj.step).toFixed(0)} mm`);
const hueco = Math.abs(tmj.cell - tmj.w / tmj.h) / tmj.cell;
check(hueco < 0.1, `el corte llena la casilla (casilla ${tmj.cell.toFixed(2)} vs corte ${(tmj.w / tmj.h).toFixed(2)}: ${Math.round(hueco * 100)} % de franja negra)`);
// y se reencuadra si cambia el tamaño de la ventana
const rows0 = await ev(() => document.querySelector('#atm-grid').style.gridAutoRows);
await page.setViewportSize({ width: 1200, height: 980 });
// el reencuadre va 350 ms después del último «resize», pero con mallas segmentadas el propio resize del
// render 3D tarda más de 1 s en SwiftShader: se espera a que cambie la altura de las filas, no un tiempo fijo
await page.waitForFunction((r0) => document.querySelector('#atm-grid').style.gridAutoRows !== r0, rows0, { timeout: 30000 });
await sleep(600);
const tmj2 = await ev(() => {
  const s = window.tresd.V.state.tmj.series.R[2].img;
  const r = document.querySelector('#atm-grid .atm-cell:not(.atm-gap)').getBoundingClientRect();
  return { a: s.w / s.h, cell: r.width / r.height };
});
check(Math.abs(tmj2.cell - tmj2.a) / tmj2.cell < 0.1, `sigue llenando la casilla tras cambiar el tamaño (casilla ${tmj2.cell.toFixed(2)} vs corte ${tmj2.a.toFixed(2)})`);
await shot('v073_atm.png');

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
