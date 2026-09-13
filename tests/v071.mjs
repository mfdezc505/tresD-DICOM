// Pruebas de la v0.7.1 (peticiones de Manuel del 13-09-2026):
//   1) pantalla inicial sin la línea de apoyo ni la de privacidad;
//   2) cruz de referencia con mangos más pequeños y SIN los cuadrados de grosor de corte;
//   3) el modelo no se corta al acercar la rueda en «Alinear por puntos» (planos de recorte del visor 3D);
//   4) panorámica: MIP por defecto, grosor EN VIVO y curva editable (puntos de control arrastrables);
//   5) cortes de ATM: un clic sobre cada cóndilo → 5 sagitales + coronal + axial por lado.
// Uso: node tests/v071.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(ROOT, 'tests', 'out');
const SC = '/tmp/testdata/real_scans';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8786, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 300)); if (tx.startsWith('tresD ATM')) console.log('   ', tx.slice(0, 200)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const sleep = (ms) => page.waitForTimeout(ms);
const status = () => page.textContent('#status-text');
const shot = (n, clip) => page.screenshot({ path: path.join(OUT, n), ...(clip ? { clip } : {}) });

await page.goto('http://localhost:8786/'); await sleep(900);

// ---------------------------------------------------------------- 1) pantalla inicial
console.log('— pantalla inicial');
const drop = await page.locator('#main-drop').innerText();
check(!/gratuito para visualización/.test(drop), 'sin la línea «Visor DICOM gratuito…»');
check(!/nunca salen de tu ordenador/.test(drop), 'sin la línea «Todo se procesa en tu navegador…»');
check(/Haz clic para subir tu CBCT/.test(drop) && /Ortodoncia tresD/.test(drop), 'quedan la llamada a subir el CBCT y el pie de propiedad');
await shot('v071_inicio.png');

console.log('— carga del CBCT');
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso|Error|No se)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1200);
check(/^Cargado/.test(await status()), 'CBCT cargado');

// ---------------------------------------------------------------- 2) mangos de la cruz
console.log('— cruz de referencia');
await page.click('#btn-cross'); await sleep(1000);
const cfg = await ev(() => {
  const T = window.tresd.V.tools;
  const tool = T.ToolGroupManager.getToolGroup('tg-mpr').getToolInstance(T.CrosshairsTool.toolName);
  return { r: tool.configuration.handleRadius, gap: tool.configuration.referenceLinesCenterGapRadius, slab: tool._getReferenceLineSlabThicknessControlsOn('vpAx') };
});
check(cfg.r === 1.4, `radio de los mangos ${cfg.r} px (2 en v0.7.1, 3 de fábrica)`);
check(cfg.slab === false, 'cuadrados de grosor de corte desactivados');
// en el SVG del corte coronal solo debe haber círculos de giro, ningún rectángulo de mango
await page.mouse.move(400, 400); await sleep(400);
const svg = await ev(() => {
  const el = document.querySelector('.vp[data-id="vpCor"] svg');
  if (!el) return null;
  return { circles: el.querySelectorAll('circle').length, rects: el.querySelectorAll('rect').length, lines: el.querySelectorAll('line').length };
});
check(svg && svg.rects === 0, `sin cuadrados en el corte coronal (${svg ? svg.rects : '?'} rect, ${svg ? svg.lines : '?'} líneas)`);
await shot('v071_cruz.png');
await page.click('#btn-cross'); await sleep(400);

// ---------------------------------------------------------------- 3) recorte del 3D al hacer zoom
console.log('— recorte del visor 3D');
await page.setInputFiles('#in-mesh', [SC + '/upper.stl']);
await page.waitForSelector('.modal'); await page.click('input[name="dm-role"][value="upper"]'); await page.click('#dlg-ok');
await page.waitForFunction(() => /^(Escáner añadido|No se pudo|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await page.click('[data-layout="vp3d"]'); await sleep(1500);
await page.click('#mesh-cards .card[data-role="upper"] .m-points'); await sleep(1500);
// rango de recorte frente a la extensión REAL del modelo a lo largo del eje de visión (8 esquinas)
const clip = () => ev(() => {
  const ren = window.tresd.V.getEngine().getViewport('vp3d').getRenderer();
  const cam = ren.getActiveCamera(); const b = ren.computeVisiblePropBounds();
  const p = cam.getPosition(), n = cam.getDirectionOfProjection();
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c = [b[i & 1], b[2 + ((i >> 1) & 1)], b[4 + ((i >> 2) & 1)]];
    const d = (c[0] - p[0]) * n[0] + (c[1] - p[1]) * n[1] + (c[2] - p[2]) * n[2];
    if (d < lo) lo = d; if (d > hi) hi = d;
  }
  return { cr: cam.getClippingRange(), lo, hi };
});
let c0 = await clip();
check(c0.cr[0] <= c0.lo && c0.cr[1] >= c0.hi, `el modelo entero cabe entre los planos de recorte (${c0.cr[0].toFixed(0)}…${c0.cr[1].toFixed(0)}, modelo ${c0.lo.toFixed(0)}…${c0.hi.toFixed(0)})`);
// se estropea el rango a propósito (rodaja de 10 mm) y se comprueba que el visor lo recompone al mover la cámara
await ev(() => { const cam = window.tresd.V.getEngine().getViewport('vp3d').getRenderer().getActiveCamera(); const d = cam.getClippingRange(); cam.setClippingRange((d[0] + d[1]) / 2 - 5, (d[0] + d[1]) / 2 + 5); });
const bad = await clip();
check(bad.cr[1] - bad.cr[0] < 11, 'rango de recorte estropeado a 10 mm (el modelo saldría cortado)');
const b3 = await page.locator('#vp3d').boundingBox();
await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2);
for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, -120); await sleep(80); }
await sleep(1200);
c0 = await clip();
check(c0.cr[0] <= c0.lo && c0.cr[1] >= c0.hi, `tras el zoom vuelve a caber entero (${c0.cr[0].toFixed(0)}…${c0.cr[1].toFixed(0)}, modelo ${c0.lo.toFixed(0)}…${c0.hi.toFixed(0)})`);
await shot('v071_zoom.png', b3);
await page.click('#pa-cancel'); await sleep(800);

// ---------------------------------------------------------------- 4) panorámica
console.log('— panorámica');
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano && document.querySelector('#pan-canvas').width > 100, null, { timeout: 300000 });
await sleep(800);
check(await page.isChecked('#pan-mip') && (await ev(() => window.tresd.V.state.pano.mip)) === true, 'MIP activado por defecto');
check((await ev(() => window.tresd.V.state.pano.curve.control.length)) === 13, '13 puntos de control en la curva (9 hasta v0.7.1)');
await shot('v071_pano.png');
// grosor EN VIVO: solo el evento `input`, sin soltar
await page.locator('#pan-thick').evaluate((el) => { el.value = 22; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForFunction(() => window.tresd.V.state.pano.thickness === 22, null, { timeout: 120000 });
check(true, 'el grosor se recalcula en vivo (sin soltar el deslizador)');
// editar la curva
await page.click('#pan-edit'); await sleep(1500);
check((await ev(() => document.querySelector('#grid').dataset.layout)) === 'pair' && (await ev(() => window.tresd.V.state.panoEdit)) === true, 'modo edición: axial + panorámica y puntos de control visibles');
const before = await ev(() => window.tresd.V.state.pano.curve.control.map((p) => p.map((v) => +v.toFixed(2))));
const axBox = await page.locator('#vpAx').boundingBox();
const pos = await ev(() => { const V = window.tresd.V, c = V.state.pano.curve, p = c.control[4]; const vp = V.getEngine().getViewport('vpAx'); return { a: vp.worldToCanvas([p[0], p[1], c.z]), b: vp.worldToCanvas([p[0], p[1] - 8, c.z]) }; });
await page.mouse.move(axBox.x + pos.a[0], axBox.y + pos.a[1]);
await page.mouse.down(); await page.mouse.move(axBox.x + pos.b[0], axBox.y + pos.b[1], { steps: 10 }); await page.mouse.up();
await sleep(2500);
const after = await ev(() => window.tresd.V.state.pano.curve.control.map((p) => p.map((v) => +v.toFixed(2))));
check(Math.abs(after[4][1] - (before[4][1] - 8)) < 1.5, `el punto arrastrado se mueve 8 mm (${before[4][1]} → ${after[4][1]})`);
check(before.every((p, i) => i === 4 || (Math.abs(p[0] - after[i][0]) < 0.01 && Math.abs(p[1] - after[i][1]) < 0.01)), 'los demás puntos no se mueven');
await shot('v071_pano_edit.png');
await page.keyboard.press('Control+z'); await sleep(2500);
check(Math.abs((await ev(() => window.tresd.V.state.pano.curve.control[4][1])) - before[4][1]) < 0.01, 'Ctrl+Z devuelve la curva');
await page.click('#pan-edit'); await sleep(1200);

// ---------------------------------------------------------------- 5) cortes de ATM
console.log('— cortes de ATM');
await page.click('#btn-atm'); await sleep(1200);
check(!(await page.locator('#aw-bar').evaluate((e) => e.classList.contains('hidden'))) && /ATM 1\/2/.test(await page.textContent('#aw-text')), 'pide marcar el cóndilo derecho');
const SEEDS = [[-54, -24, 43], [50, -29, 45]];    // cóndilos del CBCT DZ (medidos sobre el volumen)
const corBox = await page.locator('#vpCor').boundingBox();
for (const w of SEEDS) {
  await ev((w) => { const V = window.tresd.V; const vp = V.getEngine().getViewport('vpCor'); const c = vp.getCamera(); vp.setCamera({ ...c, focalPoint: [c.focalPoint[0], w[1], c.focalPoint[2]] }); vp.render(); }, w);
  await sleep(500);
  const c = await ev((w) => window.tresd.V.getEngine().getViewport('vpCor').worldToCanvas(w), w);
  await page.mouse.click(corBox.x + c[0], corBox.y + c[1]);
  await sleep(700);
}
await page.waitForFunction(() => /^(Cortes de ATM|Ahí no|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
check(/^Cortes de ATM/.test(await status()), 'ATM: ' + (await status()).slice(0, 90));
const tmj = await ev(() => { const t = window.tresd.V.state.tmj; if (!t) return null; const w = (s) => { const p = t.poles[s]; return Math.hypot(p.lat[0] - p.med[0], p.lat[1] - p.med[1], p.lat[2] - p.med[2]); }; return { lados: Object.keys(t.series), n: t.series.R.length, wR: w('R'), wL: w('L'), mlR: t.poles.R.ml, mlL: t.poles.L.ml }; });
check(tmj && tmj.lados.length === 2 && tmj.n === 7, `dos lados con 7 cortes cada uno (5 sagitales + coronal + axial)`);
check(tmj && tmj.wR > 12 && tmj.wR < 26 && tmj.wL > 12 && tmj.wL < 26, `anchura condilar razonable: D ${tmj && tmj.wR.toFixed(1)} mm, I ${tmj && tmj.wL.toFixed(1)} mm`);
check(tmj && Math.abs(tmj.mlR[0]) > 0.8 && Math.abs(tmj.mlL[0]) > 0.8, 'el eje del cóndilo sale medio-lateral (no antero-posterior)');
check((await ev(() => document.querySelector('#grid').dataset.layout)) === 'single' && (await page.locator('#atm-grid .atm-cell:not(.atm-gap)').count()) === 14, '14 cortes en el mosaico');
check(!(await page.locator('#lay-atm').evaluate((e) => e.classList.contains('hidden'))), 'aparece el botón «ATM» en la barra de vistas');
await sleep(800);
await shot('v071_atm.png');
// los cortes tienen contenido (no están en negro)
const lleno = await ev(() => {
  const cv = document.querySelector('#atm-grid .atm-cell canvas');
  const g = cv.getContext('2d'); const d = g.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 60) n++;
  return n / (cv.width * cv.height);
});
check(lleno > 0.05, `el corte tiene hueso (${(100 * lleno).toFixed(0)} % de píxeles claros)`);
// deshacer quita los cortes
await page.keyboard.press('Control+z'); await sleep(1200);
check((await ev(() => window.tresd.V.state.tmj)) === null && (await page.locator('#atm-grid .atm-cell').count()) === 0, 'Ctrl+Z quita los cortes de ATM');
await page.keyboard.press('Control+y'); await sleep(1200);
check((await ev(() => !!window.tresd.V.state.tmj)) && (await page.locator('#atm-grid .atm-cell:not(.atm-gap)').count()) === 14, 'Ctrl+Y los devuelve');

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
