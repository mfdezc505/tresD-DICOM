// Prueba de la v0.7: con el CBCT real DZ (0,5 mm):
//   1) presets nuevos (tejido blando, vía aérea) y ventanas finitas; marfil opaco (curva sin gradiente);
//   2) cruz de referencia en los MPR (activar / desactivar, botón y estado);
//   3) vía aérea: 2 clics en el sagital → malla con mapa de calor, valores (volumen, MCA) y tabla en la tarjeta;
//      los valores se ocultan al ocultar la malla; DICOM visible con preset «vía aérea» y vista lateral derecha;
//   4) deshacer / rehacer: vía aérea, escáner (añadir), transparencia, segmentación, mediciones, corte, preset;
//   5) piel segmentada al 80 % por defecto;
//   6) panorámica: curva de la arcada e imagen.
// Uso: node tests/features.mjs [carpeta DICOM]  (por defecto /tmp/testdata/cbct_half)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(ROOT, 'tests', 'out');
const DICOM = process.argv[2] || '/tmp/testdata/cbct_half';
const SC = '/tmp/testdata/real_scans';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2', '.data': 'application/octet-stream', '.binarypb': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8776, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--js-flags=--max-old-space-size=6000'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); Object.defineProperty(navigator, 'deviceMemory', { get: () => 32 }); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 300)); if (tx.startsWith('tresD ')) console.log('   ', tx.slice(0, 240)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const status = () => page.textContent('#status-text');
const shot = (n) => page.screenshot({ path: path.join(OUT, n) });
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
const waitStatus = (re, timeout = 300000) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector('#status-text').textContent), re.source, { timeout });

await page.goto('http://localhost:8776/'); await sleep(1000);
console.log('— carga del CBCT', DICOM);
await page.setInputFiles('#in-folder', DICOM);
await waitStatus(/^(Cargado|Error|No se|Volumen)/);
check(/^Cargado/.test(await status()), 'CBCT cargado: ' + (await status()).slice(0, 80));
await sleep(1500);

// ---------------------------------------------------------------- 1) presets
console.log('— presets');
for (const p of ['soft', 'airway', 'ivory', 'natural', 'gray', 'radio', 'default']) {
  await page.selectOption('#dicom-preset', p); await sleep(300);
  const r = await ev(() => { const r = window.tresd.V.state.render; return { preset: r.preset, lo: r.lo, hi: r.hi }; });
  check(r.preset === p && Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.hi > r.lo, `preset ${p}: ventana ${Math.round(r.lo)}…${Math.round(r.hi)}`);
}
// ventana del preset de piel: empieza por debajo del umbral aire/cuerpo (piel visible) y acaba en hueso
const win = await ev(() => { const V = window.tresd.V; V.setPreset('soft'); const r = V.state.render; return [r.lo, r.hi]; });
check(win[0] < -200 && win[1] > 800, `preset piel: ventana ${Math.round(win[0])}…${Math.round(win[1])} (piel por debajo de −200, hueso por encima de 800)`);
await page.click('[data-layout="vp3d"]'); await sleep(2500); await shot('feat_soft.png');
await ev(() => window.tresd.V.setPreset('airway')); await sleep(2500); await shot('feat_airway_preset.png');
await ev(() => window.tresd.V.setPreset('ivory')); await page.click('[data-layout="quad"]'); await sleep(600);
// deshacer el cambio de preset hecho desde el desplegable (el último apuntado fue «default» desde el select)
const nUndo0 = await ev(() => window.tresd.V.history.undoStack.length);
check(nUndo0 >= 7, `cambios de preset apuntados para deshacer: ${nUndo0}`);

// ---------------------------------------------------------------- 2) cruz de referencia
console.log('— cruz de referencia');
await page.click('#btn-cross'); await sleep(800);
let cross = await ev(() => window.tresd.V.state.crosshairs);
check(cross === true && (await page.getAttribute('#btn-cross', 'aria-pressed')) === 'true', 'cruz activada');
check(/Cruz activa/.test(await status()), 'estado: ' + (await status()).slice(0, 60));
await shot('feat_cross.png');
// arrastrar el centro de la cruz en el axial mueve los otros cortes (el corte sagital cambia de índice)
const before = await ev(() => { const V = window.tresd.V; return V.getEngine().getViewport('vpSag').getSliceIndex(); });
const axBox = await page.locator('#vpAx').boundingBox();
const cx = axBox.x + axBox.width / 2, cy = axBox.y + axBox.height / 2;
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy + 10, { steps: 8 }); await page.mouse.up(); await sleep(800);
const after = await ev(() => { const V = window.tresd.V; return V.getEngine().getViewport('vpSag').getSliceIndex(); });
check(before !== after, `arrastrar la cruz en el axial cambia el corte sagital (${before} → ${after})`);
await page.click('#btn-cross'); await sleep(500);
cross = await ev(() => window.tresd.V.state.crosshairs);
check(cross === false && /desactivada/.test(await status()), 'cruz desactivada');
// medir con la cruz activa: la medición manda sobre la cruz y al terminar vuelve la cruz
await page.click('#btn-cross'); await page.click('#btn-dist'); await sleep(300);
const bind = await ev(() => { const V = window.tresd.V; return V.state.measureMode + '/' + V.state.crosshairs; });
check(bind === 'linear/true', 'medición activa con la cruz encendida (' + bind + ')');
await page.click('#btn-dist'); await page.click('#btn-cross'); await sleep(300);

// ---------------------------------------------------------------- 3) vía aérea (2 clics en el sagital)
console.log('— vía aérea');
const SUP = [-0.1, -32.16, 8.82], INF = [3.13, -29.54, -41.64];      // columna de aire faríngea del DZ (medida en el volumen)
await page.click('#btn-airway'); await sleep(800);
check(!(await page.locator('#aw-bar').evaluate((e) => e.classList.contains('hidden'))), 'barra de marcado visible en el sagital');
check((await ev(() => document.querySelector('#grid').dataset.layout)) === 'single', 'solo el corte sagital en pantalla');
const sagBox = await page.locator('#vpSag').boundingBox();
for (const w of [SUP, INF]) {
  const c = await ev((w) => window.tresd.V.getEngine().getViewport('vpSag').worldToCanvas(w), w);
  await page.mouse.click(sagBox.x + c[0], sagBox.y + c[1]); await sleep(400);
}
await waitStatus(/^(Vía aérea:|No se encontró|Error)/);
const awSt = await status();
check(/^Vía aérea: volumen/.test(awSt), 'vía aérea segmentada: ' + awSt.slice(0, 120));
const aw = await ev(() => { const m = window.tresd.V.airwayMesh(); return m ? { n: m.nTri, vol: m.airway.volume_mm3 / 1000, mca: m.airway.mca_mm2, colors: !!m.colors, heat: m.heat, vis: m.visible, op: m.opacity } : null; });
check(aw && aw.n > 500 && aw.vol > 3 && aw.vol < 80 && aw.mca > 20 && aw.mca < 600, `malla ${aw && aw.n} triángulos · ${aw && aw.vol.toFixed(1)} cm³ · MCA ${aw && aw.mca.toFixed(0)} mm²`);
check(aw && aw.colors && aw.heat, 'mapa de calor por vértice activo');
const cardAw = page.locator('#mesh-cards .card[data-role="airway"]');
check((await cardAw.count()) === 1, 'tarjeta «Vía aérea» en el panel');
check((await cardAw.locator('.aw-table tr').count()) >= 3 && /Guijarro/.test(await cardAw.locator('.aw-ref').textContent()), 'tabla de valores con norma y referencia');
const st3 = await ev(() => { const V = window.tresd.V; const cam = V.getEngine().getViewport('vp3d').getCamera(); return { preset: V.state.render.preset, vis: V.state.render.visible, n: cam.viewPlaneNormal.map((v) => Math.round(v)) }; });
check(st3.preset === 'airway' && st3.vis && st3.n[0] === -1, `preset «vía aérea», DICOM visible y vista lateral derecha (${JSON.stringify(st3)})`);
check(await page.locator('#btn-airway').evaluate((e) => e.classList.contains('hidden')), 'botón «Segmentar vía aérea» oculto con la vía aérea hecha');
await sleep(2500); await shot('feat_airway.png');
// el preset «vía aérea» (translúcido) es muy lento en SwiftShader: volver a marfil y a la rejilla para el resto
await ev(() => window.tresd.V.setPreset('ivory')); await page.click('[data-layout="quad"]'); await sleep(3000);
// ocultar la malla → se ocultan los valores; mostrar → vuelven
await cardAw.locator('.m-vis').click(); await sleep(1500);
check(await cardAw.locator('.aw-values').evaluate((e) => e.classList.contains('hidden')), 'valores ocultos al ocultar la vía aérea');
await cardAw.locator('.m-vis').click(); await sleep(1500);
check(!(await cardAw.locator('.aw-values').evaluate((e) => e.classList.contains('hidden'))), 'valores visibles de nuevo');
// mapa de calor apagado → color sólido
await cardAw.locator('.m-heat-on').click(); await sleep(1500);
check((await ev(() => window.tresd.V.airwayMesh().useColors)) === false, 'mapa de calor apagado → color sólido');
await cardAw.locator('.m-heat-on').click(); await sleep(1500);

// ---------------------------------------------------------------- 4) deshacer / rehacer
console.log('— deshacer / rehacer');
const undoN = () => ev(() => window.tresd.V.history.undoStack.length);
// deshacer hasta quitar la vía aérea (los últimos apuntes: ver/ocultar ×2, mapa ×2, vía aérea)
for (let i = 0; i < 4; i++) { await page.click('#btn-undo'); await sleep(1500); }
await page.click('#btn-undo'); await sleep(2500);
check((await ev(() => window.tresd.V.airwayMesh())) === null && (await page.locator('#mesh-cards .card[data-role="airway"]').count()) === 0, 'deshacer quita la vía aérea (malla y tarjeta)');
check(!(await page.locator('#btn-airway').evaluate((e) => e.classList.contains('hidden'))), 'el botón de vía aérea reaparece');
check(/^Deshecho:/.test(await status()), 'estado: ' + (await status()).slice(0, 60));
await page.click('#btn-redo'); await sleep(2500);
check((await ev(() => !!window.tresd.V.airwayMesh())) && (await page.locator('#mesh-cards .card[data-role="airway"]').count()) === 1, 'rehacer devuelve la vía aérea (malla y tarjeta con valores)');
check((await page.locator('#mesh-cards .card[data-role="airway"] .aw-table tr').count()) >= 3, 'tarjeta rehecha con la tabla');
// Ctrl+Z / Ctrl+Y
await page.keyboard.press('Control+z'); await sleep(2500);
check((await ev(() => window.tresd.V.airwayMesh())) === null, 'Ctrl+Z deshace');
await page.keyboard.press('Control+y'); await sleep(2500);
check((await ev(() => !!window.tresd.V.airwayMesh())), 'Ctrl+Y rehace');

// escáner: añadir → deshacer → rehacer
await page.setInputFiles('#in-mesh', [SC + '/upper.stl']); await page.waitForSelector('.modal');
await page.click('input[name="dm-role"][value="upper"]'); await page.click('#dlg-ok');
await waitStatus(/^(Escáner añadido|No se pudo|Error)/);
const nScan = () => ev(() => window.tresd.V.getMeshes().filter((m) => !m.seg).length);
check((await nScan()) === 1, 'escáner añadido y alineado: ' + (await status()).slice(0, 90));
await page.click('#btn-undo'); await sleep(600);
check((await nScan()) === 0 && (await page.locator('#mesh-cards .card[data-role="upper"]').count()) === 0, 'deshacer quita el escáner (y su tarjeta)');
await page.click('#btn-redo'); await sleep(600);
check((await nScan()) === 1 && (await page.locator('#mesh-cards .card[data-role="upper"]').count()) === 1, 'rehacer lo devuelve alineado');
const alignBefore = await ev(() => window.tresd.V.getMeshes().find((m) => m.role === 'upper').align);
check(alignBefore && alignBefore.err != null && alignBefore.err < 1.5, `alineación conservada al rehacer (error ${alignBefore && alignBefore.err && alignBefore.err.toFixed(2)} mm)`);
// voltear → deshacer
const cUp = page.locator('#mesh-cards .card[data-role="upper"]');
const ptsBefore = await ev(() => Array.from(window.tresd.V.getMeshes().find((m) => m.role === 'upper').pts.slice(0, 6)));
await cUp.locator('.m-flip').click(); await sleep(400);
await page.click('#btn-undo'); await sleep(400);
const ptsAfter = await ev(() => Array.from(window.tresd.V.getMeshes().find((m) => m.role === 'upper').pts.slice(0, 6)));
check(ptsBefore.every((v, i) => Math.abs(v - ptsAfter[i]) < 1e-3), 'voltear + deshacer deja la malla donde estaba');
// transparencia desde la tarjeta: cambiar (input + change) → deshacer
await cUp.locator('.m-op').evaluate((el) => { el.value = 40; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
await sleep(200);
check(Math.abs((await ev(() => window.tresd.V.getMeshes().find((m) => m.role === 'upper').opacity)) - 0.4) < 0.01, 'transparencia 40 %');
await page.click('#btn-undo'); await sleep(300);
check(Math.abs((await ev(() => window.tresd.V.getMeshes().find((m) => m.role === 'upper').opacity)) - 1) < 0.01 && (await cUp.locator('.m-op').inputValue()) === '100', 'deshacer devuelve el 100 % (visor y deslizador)');
// corte: activar sagital → deshacer
await page.click('#cut-x'); await sleep(300);
check((await ev(() => window.tresd.V.state.cut.axis)) === 'x', 'corte sagital activo');
await page.click('#btn-undo'); await sleep(300);
check((await ev(() => window.tresd.V.state.cut.axis)) === null && !(await page.isChecked('#cut-x')), 'deshacer quita el corte (y la casilla)');
// medición 3D: 2 clics → deshacer → rehacer
await page.click('[data-layout="vp3d"]'); await sleep(1500);
await page.click('#btn-dist');
const b3 = await page.locator('#vp3d').boundingBox();
await page.mouse.click(b3.x + b3.width * 0.5, b3.y + b3.height * 0.45); await sleep(800);
await page.mouse.click(b3.x + b3.width * 0.6, b3.y + b3.height * 0.55); await sleep(800);
const nMeas = () => ev(() => window.tresd.V.getMeasures().v3d.length);
const m0 = await nMeas();
check(m0 === 1, 'medición 3D hecha (' + m0 + ')');
await page.click('#btn-dist');
await page.keyboard.press('Control+z'); await sleep(400);
check((await nMeas()) === 0, 'Ctrl+Z quita la medición 3D');
await page.keyboard.press('Control+y'); await sleep(400);
check((await nMeas()) === 1, 'Ctrl+Y la devuelve');
await page.click('[data-layout="quad"]'); await sleep(500);

// ---------------------------------------------------------------- 5) segmentación: piel al 80 % + deshacer
console.log('— segmentación (piel al 80 %) y deshacer');
await page.click('#btn-seg');
await waitStatus(/^(Segmentación lista|La segmentación|Error)/, 600000);
check(/^Segmentación lista/.test(await status()), 'segmentación: ' + (await status()).slice(0, 100));
const soft = await ev(() => { const s = window.tresd.V.softMesh(); return s ? { op: s.opacity, slider: document.querySelector(`#mesh-cards .card[data-mesh="${s.id}"] .m-op`).value } : null; });
check(soft && Math.abs(soft.op - 0.8) < 0.01 && soft.slider === '80', `piel al 80 % por defecto (visor ${soft && soft.op}, deslizador ${soft && soft.slider})`);
const nSeg = () => ev(() => window.tresd.V.getMeshes().filter((m) => m.role === 'skull' || m.role === 'soft').length);
check((await nSeg()) === 2, 'cráneo + piel');
await page.click('#btn-undo'); await sleep(800);
check((await nSeg()) === 0 && (await page.locator('#mesh-cards .card[data-role="soft"]').count()) === 0, 'deshacer quita la segmentación (mallas y tarjetas)');
await page.click('#btn-redo'); await sleep(800);
check((await nSeg()) === 2 && (await page.locator('#mesh-cards .card[data-role="soft"]').count()) === 1, 'rehacer la devuelve');
check((await ev(() => window.tresd.V.getMeshes().length)) === 4, 'mallas: escáner + vía aérea + cráneo + piel = ' + (await ev(() => window.tresd.V.getMeshes().length)));

// ---------------------------------------------------------------- 6) panorámica
console.log('— panorámica');
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano && document.querySelector('#pan-canvas').width > 100, null, { timeout: 300000 });
const pan = await ev(() => { const p = window.tresd.V.state.pano; return { n: p.curve.pts.length, len: p.curve.length, w: p.image.width, h: p.image.height, thick: p.thickness }; });
check(pan.n > 150 && pan.len > 60 && pan.len < 220 && pan.w === pan.n && pan.h > 100, `curva de ${pan.n} puntos (${pan.len.toFixed(0)} mm) · imagen ${pan.w}×${pan.h} · grosor ${pan.thick} mm`);
await sleep(600); await shot('feat_pano.png');
// grosor y MIP
await page.locator('#pan-thick').evaluate((el) => { el.value = 20; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForFunction(() => window.tresd.V.state.pano && window.tresd.V.state.pano.thickness === 20, null, { timeout: 120000 });
// desde v0.7.1 el MIP viene activado por defecto: se apaga y se vuelve a encender
check(await ev(() => window.tresd.V.state.pano.mip === true), 'MIP activado por defecto');
await page.click('#pan-mip'); await page.waitForFunction(() => window.tresd.V.state.pano && window.tresd.V.state.pano.mip === false, null, { timeout: 120000 });
await page.click('#pan-mip'); await page.waitForFunction(() => window.tresd.V.state.pano && window.tresd.V.state.pano.mip === true, null, { timeout: 120000 });
await sleep(400); await shot('feat_pano_mip.png');
check(true, 'grosor 20 mm y MIP recalculados');
// la curva se dibuja sobre el axial (desde v0.7.7 la casilla arranca DESMARCADA: se marca aquí)
check((await ev(() => document.querySelector('#pan-curve').checked)) === false, 'la casilla «curva» arranca desmarcada (v0.7.7)');
await page.check('#pan-curve'); await sleep(400);
await page.click('[data-layout="vpAx"]'); await sleep(800); await shot('feat_pano_axial.png');
const drawn = await ev(() => { const cv = document.querySelector('#vpAx .silh'); const g = cv.getContext('2d'); const d = g.getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] > 200 && d[i + 1] > 180 && d[i + 2] < 120) n++; return n; });
check(drawn > 50, `curva de la arcada dibujada sobre el axial (${drawn} píxeles amarillos)`);
await page.click('[data-layout="quad"]');

// ---------------------------------------------------------------- fin
check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
