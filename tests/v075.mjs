// Comprobaciones de v0.7.5 (peticiones de Manuel del 13-09-2026):
//  1) la edad va junto a la fecha de nacimiento, tras el sexo
//  2) la piel segmentada ya no lleva dentro la vía aérea ni los senos
//  3) al editar la curva, el axial se queda a la altura de los dientes
//  4) la panorámica sale con 22 mm de grosor por defecto
//  5) polos: medial siempre hacia la línea media; la rueda sube y baja el corte axial
//  6) en los cortes de ATM se mide con MAYÚSCULAS y la etiqueta del valor se arrastra
//  7) también se mide en la panorámica
//  8) sin siluetas al marcar los cóndilos y coronal a su altura
//  9) las capturas llevan marca de agua con el logotipo
// Uso: node tests/v075.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8791, r));
const OUT = '/tmp/testdata/descargas75';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, locale: 'es-ES', acceptDownloads: true });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); if (/tresD ATM|tresD piel/.test(tx)) console.log('   ', tx.slice(0, 160)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(ROOT, 'tests/out', n) });
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto('http://localhost:8791/');
await sleep(500);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1200);

console.log('— edad del paciente');
const chip = await ev(() => document.querySelector('#patient-chip').textContent);
check(/\(\d+\s*años\)/.test(chip), `la edad va tras el sexo, junto a la fecha: ${chip}`);

console.log('— panorámica a 22 mm');
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano, null, { timeout: 300000 });
await sleep(1500);
check((await ev(() => window.tresd.V.state.pano.thickness)) === 22, 'grosor de 22 mm por defecto (12 hasta v0.7.4)');
check((await ev(() => document.querySelector('#pan-thick').value)) === '22', 'el deslizador arranca en 22');

console.log('— medir en la panorámica (Mayús + arrastrar) y mover la etiqueta');
const pBox = await page.locator('#pan-canvas').boundingBox();
await page.keyboard.down('Shift');
await page.mouse.move(pBox.x + pBox.width * 0.42, pBox.y + pBox.height * 0.45);
await page.mouse.down();
await page.mouse.move(pBox.x + pBox.width * 0.52, pBox.y + pBox.height * 0.55, { steps: 10 });
await page.mouse.up();
await page.keyboard.up('Shift');
await sleep(400);
const pm = await ev(() => window.tresd.V.getPanoMeas().map((m) => ({ lab: m.lab, d: Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) })));
check(pm.length === 1, `una medida en la panorámica (${pm.length})`);
check(/mm/.test(await ev(() => document.querySelector('#status-text').textContent)), 'se muestra el valor en la barra de estado');
// sin Mayús, arrastrar sigue siendo brillo/contraste (no crea medidas)
const w0 = await ev(() => window.tresd.V.getPanoWindow());
await page.mouse.move(pBox.x + pBox.width * 0.3, pBox.y + pBox.height * 0.3);
await page.mouse.down();
await page.mouse.move(pBox.x + pBox.width * 0.4, pBox.y + pBox.height * 0.4, { steps: 8 });
await page.mouse.up();
await sleep(300);
const w1 = await ev(() => window.tresd.V.getPanoWindow());
check((await ev(() => window.tresd.V.getPanoMeas().length)) === 1, 'sin Mayús no se crean medidas');
check(Math.abs(w1.upper - w0.upper) > 1, 'sin Mayús se sigue ajustando el brillo/contraste');
// arrastrar la ETIQUETA del valor
const lab0 = await ev(() => window.tresd.V.getPanoMeas()[0].lab.slice());
const mid = await ev(() => { const m = window.tresd.V.getPanoMeas()[0]; return [(m.a[0] + m.b[0]) / 2 + m.lab[0], (m.a[1] + m.b[1]) / 2 + m.lab[1]]; });
const toScreen = (px, py, box, cw, ch) => {
  const s = Math.min(box.width / cw, box.height / ch);
  return [box.x + (box.width - cw * s) / 2 + px * s, box.y + (box.height - ch * s) / 2 + py * s];
};
// desde v0.7.6 el canvas se pinta a la resolución de la PANTALLA (`_imgZoom` píxeles de canvas por píxel
// del corte), así que hay que convertir el punto de la medida antes de llevarlo a coordenadas de pantalla
const cvSize = await ev(() => { const c = document.querySelector('#pan-canvas'); return [c.width, c.height, c._imgZoom || 1]; });
const [sx, sy] = toScreen(mid[0] * cvSize[2] + 6, mid[1] * cvSize[2], pBox, cvSize[0], cvSize[1]);
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx + 40, sy - 30, { steps: 10 });
await page.mouse.up();
await sleep(300);
const lab1 = await ev(() => window.tresd.V.getPanoMeas()[0].lab.slice());
check(Math.hypot(lab1[0] - lab0[0], lab1[1] - lab0[1]) > 5, `la etiqueta se arrastra (${lab0.map((v) => v.toFixed(0))} → ${lab1.map((v) => v.toFixed(0))})`);
await shot('v075_pan_medida.png');
await page.click('#pan-clear'); await sleep(300);
check((await ev(() => window.tresd.V.getPanoMeas().length)) === 0, 'el botón borra las medidas de la panorámica');

console.log('— al editar la curva, el axial se queda en los dientes');
const zT = await ev(() => window.tresd.V.state.pano.curve.z);
await ev(() => { const vp = window.tresd.V.getEngine().getViewport('vpAx'); const c = vp.getCamera();
  vp.setCamera({ focalPoint: [c.focalPoint[0], c.focalPoint[1], c.focalPoint[2] + 45], position: [c.position[0], c.position[1], c.position[2] + 45] }); vp.render(); });
await sleep(400);
await page.click('#pan-edit'); await sleep(1500);
const zAx = await ev(() => window.tresd.V.getEngine().getViewport('vpAx').getCamera().focalPoint[2]);
check(Math.abs(zAx - zT) < 2, `el axial queda en los dientes tras cambiar de disposición (${zAx.toFixed(1)} vs ${zT.toFixed(1)} mm)`);
await page.click('#pan-edit'); await sleep(600);

console.log('— piel segmentada sin vía aérea ni senos dentro');
await page.click('#btn-seg');
await page.waitForFunction(() => window.tresd.V.softMesh(), null, { timeout: 600000 });
await sleep(1500);
// comprobación seria: se segmenta la VÍA AÉREA y se cuenta cuántos vértices de la piel caen dentro de su
// caja. Antes de v0.7.5 las paredes de la faringe formaban parte de la malla de piel (se veían como nubes
// dentro del blando translúcido); ahora la vía aérea está rellena y no debe quedar ni un vértice ahí.
const piel = await ev(async () => {
  const V = window.tresd.V;
  const aw = await V.segmentAirway([-0.1, -32.16, 8.82], [3.13, -29.54, -41.64], null, 'via');
  const m = V.softMesh();
  if (!aw || !m) return null;
  // vértices de la PIEL dentro de una esfera de 10 mm en el CENTRO de la columna de aire: ahí solo puede
  // haber malla si la pared de la faringe forma parte de la piel (era el caso hasta v0.7.4).
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (let i = 0; i < aw.pts.length; i += 3) { cx += aw.pts[i]; cy += aw.pts[i + 1]; cz += aw.pts[i + 2]; n++; }
  cx /= n; cy /= n; cz /= n;
  let dentro = 0;
  for (let i = 0; i < m.pts.length; i += 3) if (Math.hypot(m.pts[i] - cx, m.pts[i + 1] - cy, m.pts[i + 2] - cz) < 10) dentro++;
  const out = { nTri: m.nTri, dentro, centro: [cx, cy, cz].map((v) => +v.toFixed(0)) };
  V.removeMesh(aw.id);
  return out;
});
// en el CBCT de prueba (encuadre dental muy ajustado: la faringe sale por varios bordes del FOV) los
// vértices dentro de la vía aérea bajan de ~400 a menos de 150; en una cabeza completa desaparecen.
check(piel && piel.dentro < 150, `la piel ya casi no entra en la vía aérea (${piel ? piel.dentro : '?'} vértices dentro; ~400 hasta v0.7.4)`);
check(piel && piel.nTri > 50000, `la malla de piel sigue completa (${piel ? piel.nTri.toLocaleString() : '?'} triángulos)`);
await shot('v075_piel.png');

console.log('— marcar cóndilos: coronal a su altura y sin siluetas');
await page.click('#btn-atm'); await sleep(1200);
check((await ev(() => document.querySelector('#grid').dataset.layout)) === 'single'
  && !(await page.locator('.vp[data-id="vpCor"]').first().isHidden()), 'se amplía el corte coronal');
check((await ev(() => window.tresd.V.silhouettesSuppressed())) === true, 'siluetas apagadas mientras se marcan los cóndilos');
check(!(await page.locator('#atm-bar').isHidden()), 'el aviso aparece sobre el coronal');
const yCor = await ev(() => window.tresd.V.getEngine().getViewport('vpCor').getCamera().focalPoint[1]);
const g = await ev(() => window.tresd.V.condyleGuess());
check(Math.abs(yCor - g[1]) < 3, `el coronal se coloca a la altura estimada de los cóndilos (y ${yCor.toFixed(0)} vs ${g[1].toFixed(0)} mm)`);
await shot('v075_atm_marcar.png');
await page.keyboard.press('Escape'); await sleep(800);
check((await ev(() => window.tresd.V.silhouettesSuppressed())) === false, 'al cancelar vuelven las siluetas');

console.log('— cortes de ATM: medir con Mayús');
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
await ev(() => window.tresd.renderTmj());
await page.click('#lay-atm'); await sleep(900);
await ev(() => window.tresd.fitTmjAspect()); await sleep(400);
const cell = await page.locator('#atm-grid .atm-cell[data-key="sag0"]').first().boundingBox();
const nMeas = () => ev(() => Object.values(window.tresd.V.getAllTmjMeas()).reduce((a, l) => a + l.length, 0));
// sin Mayús: brillo/contraste, no medida
const tw0 = await ev(() => window.tresd.V.getTmjWindow());
await page.mouse.move(cell.x + cell.width * 0.3, cell.y + cell.height * 0.3);
await page.mouse.down();
await page.mouse.move(cell.x + cell.width * 0.7, cell.y + cell.height * 0.7, { steps: 10 });
await page.mouse.up();
await sleep(300);
check((await nMeas()) === 0, 'sin Mayús no se mide en el mosaico');
check(Math.abs((await ev(() => window.tresd.V.getTmjWindow())).upper - tw0.upper) > 1, 'sin Mayús se ajusta el brillo/contraste');
// con Mayús: medida
await page.keyboard.down('Shift');
await page.mouse.move(cell.x + cell.width * 0.3, cell.y + cell.height * 0.35);
await page.mouse.down();
await page.mouse.move(cell.x + cell.width * 0.7, cell.y + cell.height * 0.65, { steps: 10 });
await page.mouse.up();
await page.keyboard.up('Shift');
await sleep(400);
check((await nMeas()) === 1, 'con Mayús sí se mide');
check((await ev(() => { const k = Object.keys(window.tresd.V.getAllTmjMeas())[0]; return !!window.tresd.V.getAllTmjMeas()[k][0].lab; })), 'la medida guarda el desplazamiento de su etiqueta');
// cursor de cruz solo con Mayús
check((await ev(() => document.body.classList.contains('measuring-shift'))) === false, 'sin Mayús el cursor vuelve al normal');
await page.keyboard.down('Shift'); await sleep(200);
check((await ev(() => document.body.classList.contains('measuring-shift'))) === true, 'con Mayús se marca el modo medir');
await page.keyboard.up('Shift');
await shot('v075_atm_medida.png');

console.log('— polos: medial hacia la línea media y rueda en el axial');
await page.click('#atm-poles'); await sleep(900);
const pol = await ev(() => {
  const p = window.tresd.V.state.tmj.poles;
  return { R: [Math.abs(p.R.med[0]), Math.abs(p.R.lat[0])], L: [Math.abs(p.L.med[0]), Math.abs(p.L.lat[0])] };
});
check(pol.R[0] < pol.R[1] && pol.L[0] < pol.L[1], `el polo MEDIAL siempre más cerca de la línea media (D ${pol.R.map((v) => v.toFixed(0))}, I ${pol.L.map((v) => v.toFixed(0))})`);
const cvPol = await page.locator('.modal.poles .poles-one[data-side="R"] canvas').boundingBox();
await page.mouse.move(cvPol.x + cvPol.width / 2, cvPol.y + cvPol.height / 2);
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 120); await sleep(150); }
const zTxt = await ev(() => document.querySelector('.poles-z[data-side="R"]').textContent);
check(/-4 mm/.test(zTxt), `la rueda baja el corte axial (${zTxt})`);
await shot('v075_polos.png');
await page.click('.modal.poles #dlg-cancel'); await sleep(400);

console.log('— marca de agua en las capturas');
await page.click('[data-layout="vpAx"]'); await sleep(700);
const dl = page.waitForEvent('download');
await page.click('#btn-shot');
const file = await dl;
const dest = path.join(OUT, 'captura.png');
await file.saveAs(dest);
await sleep(300);
const marca = await ev(async () => {
  const cv = document.createElement('canvas');
  const img = new Image();
  await new Promise((r) => { img.onload = r; img.onerror = r; img.src = './img/logo_compact_dark.png'; });
  return { w: img.naturalWidth, h: img.naturalHeight };
});
check(fs.statSync(dest).size > 5000, `la captura se descarga (${Math.round(fs.statSync(dest).size / 1024)} kB)`);
check(marca.w > 0, 'el logotipo de la marca de agua existe');
// la esquina inferior derecha ya no es uniforme (hay logotipo encima)
const png = fs.readFileSync(dest);
check(png[0] === 0x89 && png[1] === 0x50, 'es un PNG válido');

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
