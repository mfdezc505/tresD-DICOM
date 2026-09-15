// Prueba de la v0.6: con el CBCT REAL (DZ, 0,5 mm) y los «escáneres» con dientes reales de
// tests/make_real_scans.py (pose aleatoria conocida):
//   1) alineación automática (VOXEL + ICP punto-a-plano, multiarranque): pose recuperada (giro < 1,5°, centro < 1 mm);
//   2) alineación POR PUNTOS (3 clics en el escáner + 3 en el CBCT): la pose se mantiene;
//   3) siluetas de las mallas sobre los cortes MPR (y su casilla para desactivarlas);
//   4) mediciones: color distinto por medición (3D y MPR) y trazado en vivo al mover el ratón;
//   5) segmentación con la dentición a resolución fina (más triángulos en la caja dental).
// Uso: node tests/real.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(ROOT, 'tests', 'out');
const SC = '/tmp/testdata/real_scans';
const pose = JSON.parse(fs.readFileSync(SC + '/pose.json', 'utf8'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.data': 'application/octet-stream', '.binarypb': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8771, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 300)); if (tx.startsWith('tresD ')) console.log('   ', tx.slice(0, 240)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const status = () => page.textContent('#status-text');
const shot = (n) => page.screenshot({ path: path.join(OUT, n) });
const waitMesh = () => page.waitForFunction(() => /^(Escáner añadido|No se pudo|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
async function addMesh(file, role) {
  await page.setInputFiles('#in-mesh', [file]);
  await page.waitForSelector('.modal');
  await page.click(`input[name="dm-role"][value="${role}"]`);
  await page.click('#dlg-ok');
  await waitMesh();
}
/** Diferencia entre la pose del escáner en el visor (M: escáner → mundo) y la verdad (p_world = R^T (p_scan − t)). */
const poseError = (role) => page.evaluate(([role, P]) => {
  const m = window.tresd.V.getMeshes().find((x) => x.role === role); if (!m || !m.M) return null;
  const M = m.M; const R = [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]];
  const Rt = P.R; const Rtrue = [Rt[0][0], Rt[1][0], Rt[2][0], Rt[0][1], Rt[1][1], Rt[2][1], Rt[0][2], Rt[1][2], Rt[2][2]];
  let tr = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += R[3 * i + j] * Rtrue[3 * i + j];
  const ang = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI;
  const tTrue = [0, 1, 2].map((i) => -(Rtrue[3 * i] * P.t[0] + Rtrue[3 * i + 1] * P.t[1] + Rtrue[3 * i + 2] * P.t[2]));
  // error de traslación medido en el centro de la malla (independiente del origen)
  const p = m.pts; const c = [0, 0, 0]; for (let i = 0; i < p.length; i += 3) { c[0] += p[i]; c[1] += p[i + 1]; c[2] += p[i + 2]; } const n = p.length / 3; for (let q = 0; q < 3; q++) c[q] /= n;
  // centro verdadero = Rtrue·c_scan + tTrue, con c_scan = M⁻¹·c … más simple: comparar M y la verdad sobre el centro actual
  const inv = (M) => { const R = [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]]; const Rt = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]; const t = [M[3], M[7], M[11]]; return { Rt, t: [0, 1, 2].map((i) => -(Rt[3 * i] * t[0] + Rt[3 * i + 1] * t[1] + Rt[3 * i + 2] * t[2])) }; };
  const Mi = inv(M); const cs = [0, 1, 2].map((i) => Mi.Rt[3 * i] * c[0] + Mi.Rt[3 * i + 1] * c[1] + Mi.Rt[3 * i + 2] * c[2] + Mi.t[i]);
  const cw = [0, 1, 2].map((i) => Rtrue[3 * i] * cs[0] + Rtrue[3 * i + 1] * cs[1] + Rtrue[3 * i + 2] * cs[2] + tTrue[i]);
  return { ang, dc: Math.hypot(cw[0] - c[0], cw[1] - c[1], cw[2] - c[2]), align: m.align };
}, [role, pose[role]]);

await page.goto('http://localhost:8771/'); await page.waitForTimeout(1200);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Error|No se|Volumen)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await page.waitForTimeout(1000);

// 1) alineación automática con dientes reales
for (const role of ['upper', 'lower']) {
  const t0 = Date.now();
  await addMesh(`${SC}/${role}.stl`, role);
  console.log(`[1] ${role}: ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${(await status()).slice(0, 200)}`);
  const pe = await poseError(role);
  console.log(`   pose: giro ${pe.ang.toFixed(2)}° · centro ${pe.dc.toFixed(2)} mm · ${JSON.stringify(pe.align)}`);
  check(pe.ang < 1.5 && pe.dc < 1.0, `[1] ${role}: pose recuperada (giro ${pe.ang.toFixed(2)}°, centro ${pe.dc.toFixed(2)} mm)`);
  check(pe.align && pe.align.err < 0.7, `[1] ${role}: error de encaje ${pe.align ? pe.align.err.toFixed(2) : '?'} mm < 0,7`);
}
check(/sigue a la/.test(await status()), '[1] la inferior hereda la oclusión del mismo escaneo');
// re-alinear la INFERIOR por sí misma (botón de su tarjeta): debe quedarse en su sitio
{
  const t0 = Date.now();
  await page.click('#mesh-cards .card[data-role="lower"] .m-align');
  await page.waitForFunction(() => /^upper:/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
  console.log(`[1] re-alinear (botón de la inferior → alinea la superior): ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${await status()}`);
  const pe = await poseError('lower');
  console.log(`   pose: giro ${pe.ang.toFixed(2)}° · centro ${pe.dc.toFixed(2)} mm`);
  check(pe.ang < 1.5 && pe.dc < 1.0, `[1] inferior re-alineada por sí misma (giro ${pe.ang.toFixed(2)}°, centro ${pe.dc.toFixed(2)} mm)`);
}
await page.click('[data-layout="vp3d"]'); await page.waitForTimeout(2500);
await shot('r01_real_alineado.png');

// 2) alineación POR PUNTOS: 3 vértices anteriores del escáner superior → sus posiciones en pantalla
await page.click('[data-view="frontal"]'); await page.waitForTimeout(1500);
const pts2d = await page.evaluate(() => {
  const V = window.tresd.V; const m = V.getMeshes().find((x) => x.role === 'upper');
  const vp = V.state.engine.getViewport('vp3d'); const p = m.pts; const n = p.length / 3;
  // tres vértices bien repartidos y anteriores (y mínimo en LPS = frente): izquierda, centro, derecha
  const cand = []; for (let i = 0; i < n; i += 7) cand.push([p[3 * i], p[3 * i + 1], p[3 * i + 2]]);
  cand.sort((a, b) => a[1] - b[1]); const front = cand.slice(0, Math.floor(cand.length * 0.15));
  front.sort((a, b) => a[0] - b[0]);
  const pick = [front[Math.floor(front.length * 0.1)], front[Math.floor(front.length * 0.5)], front[Math.floor(front.length * 0.9)]];
  return pick.map((w) => vp.worldToCanvas(w));
});
const box = await page.locator('#vp3d').boundingBox();
await page.click('#mesh-cards .card[data-role="upper"] .m-points'); await page.waitForTimeout(500);
check(await page.locator('#pa-bar').isVisible(), '[2] barra de puntos visible');
check(await page.evaluate(() => !window.tresd.V.state.render.visible), '[2] fase 1: el CBCT se oculta');
for (const [x, y] of pts2d) { await page.mouse.click(box.x + x, box.y + y); await page.waitForTimeout(600); }
await page.waitForTimeout(500);
check(/FASE 2|CBCT/.test(await page.textContent('#pa-text')), '[2] tras 3 puntos pasa a la fase 2 (CBCT)');
check(await page.evaluate(() => window.tresd.V.state.render.visible), '[2] fase 2: el CBCT se muestra');
await shot('r02_puntos_fase2.png');
// los MISMOS puntos en pantalla, ahora sobre los dientes del CBCT (escáner ya alineado → mismo sitio ± mm)
for (const [x, y] of pts2d) { await page.mouse.click(box.x + x + 2, box.y + y + 2); await page.waitForTimeout(600); }
await page.waitForFunction(() => /alineado por puntos|no se pudo|Error|Ahí no hay/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
console.log('[2]', await status());
check(/alineado por puntos/.test(await status()), '[2] alineado por puntos');
const pe2 = await poseError('upper');
console.log(`   pose tras puntos: giro ${pe2.ang.toFixed(2)}° · centro ${pe2.dc.toFixed(2)} mm`);
check(pe2.ang < 1.5 && pe2.dc < 1.0, '[2] la pose sigue siendo correcta tras alinear por puntos');
const pe2l = await poseError('lower');
check(pe2l.ang < 1.5 && pe2l.dc < 1.0, '[2] la inferior siguió (misma oclusión)');
check(await page.locator('#pa-bar').isHidden(), '[2] barra oculta al terminar');
// cancelar con Esc
await page.click('#mesh-cards .card[data-role="upper"] .m-points'); await page.waitForTimeout(300);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
check(await page.locator('#pa-bar').isHidden() && await page.evaluate(() => window.tresd.V.state.render.visible), '[2] Esc cancela y restaura la escena');

// 3) siluetas en los cortes MPR
await page.click('[data-layout="quad"]'); await page.waitForTimeout(3000);
const silPixels = (id) => page.evaluate((id) => { const cv = document.querySelector(`#${id} canvas.silh`); if (!cv) return -1; const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; }, id);
const sAx = await silPixels('vpAx'), sCor = await silPixels('vpCor'), sSag = await silPixels('vpSag');
console.log('[3] píxeles de silueta:', sAx, sCor, sSag);
check(sAx > 200 && sCor > 200 && sSag > 200, '[3] siluetas dibujadas en los tres cortes');
await shot('r03_siluetas.png');
await page.uncheck('#sil-vis'); await page.waitForTimeout(600);
check((await silPixels('vpAx')) === 0, '[3] casilla desactiva las siluetas');
await page.check('#sil-vis'); await page.waitForTimeout(600);
for (const r of ['upper', 'lower']) await page.uncheck(`#mesh-cards .card[data-role="${r}"] .m-vis`);
await page.waitForTimeout(800);
const sAx2 = await silPixels('vpAx');
check(sAx2 === 0, `[3] ocultar las mallas quita sus siluetas (${sAx} → ${sAx2})`);
for (const r of ['upper', 'lower']) await page.check(`#mesh-cards .card[data-role="${r}"] .m-vis`);
await page.waitForTimeout(400);

// 4) mediciones: colores distintos y trazado en vivo (3D)
await page.click('[data-layout="vp3d"]'); await page.waitForTimeout(2000);
await page.click('#btn-dist'); await page.waitForTimeout(200);
const b3 = await page.locator('#vp3d').boundingBox();
const cx = b3.x + b3.width / 2, cy = b3.y + b3.height / 2;
await page.mouse.click(cx - 60, cy); await page.waitForTimeout(400);
await page.mouse.move(cx, cy - 40); await page.waitForTimeout(300);
const live = await page.evaluate(() => ({ live: window.tresd.V.getMeasures().live, svg: !!document.querySelector('#vp3d svg.rubber line'), label: (document.querySelector('#vp3d .mlabel.live') || {}).textContent }));
console.log('[4] en vivo:', JSON.stringify(live));
check(live.live && live.svg, '[4] línea en vivo al mover el ratón con un punto pendiente');
await shot('r04_traza_en_vivo.png');
await page.mouse.click(cx + 60, cy); await page.waitForTimeout(400);
await page.mouse.click(cx - 40, cy + 60); await page.waitForTimeout(300); await page.mouse.click(cx + 40, cy + 60); await page.waitForTimeout(400);
let ms = await page.evaluate(() => window.tresd.V.getMeasures());
console.log('[4] 3D:', JSON.stringify(ms.v3d));
check(ms.v3d.length === 2 && ms.v3d[0].color !== ms.v3d[1].color, '[4] dos mediciones 3D con colores distintos');
check(!ms.live, '[4] la línea en vivo desaparece al completar');
// MPR: dos distancias en el axial (arrastrar)
await page.click('[data-layout="quad"]'); await page.waitForTimeout(1500);
const ba = await page.locator('#vpAx').boundingBox();
const ax = ba.x + ba.width / 2, ay = ba.y + ba.height / 2;
await page.mouse.move(ax - 50, ay); await page.mouse.down(); await page.mouse.move(ax - 20, ay - 20, { steps: 5 }); await page.mouse.move(ax + 10, ay - 30, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(500);
await page.mouse.move(ax - 50, ay + 40); await page.mouse.down(); await page.mouse.move(ax, ay + 60, { steps: 5 }); await page.mouse.move(ax + 30, ay + 70, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(500);
ms = await page.evaluate(() => window.tresd.V.getMeasures());
console.log('[4] MPR:', JSON.stringify(ms.mpr));
check(ms.mpr.length >= 2 && ms.mpr[0].color && ms.mpr[1].color && ms.mpr[0].color !== ms.mpr[1].color, '[4] dos mediciones MPR con colores distintos');
await shot('r05_mediciones_colores.png');
await page.click('#btn-clear'); await page.waitForTimeout(300);

// 5) segmentación con dentición fina
const t0 = Date.now();
await page.click('#btn-seg');
await page.waitForFunction(() => /^(Segmentación lista|La segmentación|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
console.log(`[5] segmentación: ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${await status()}`);
check(/dentición a/.test(await status()), '[5] la segmentación incluye la dentición a resolución fina');
const sk = await page.evaluate(() => { const m = window.tresd.V.getMeshes().find((x) => x.role === 'skull'); return m ? { nTri: m.nTri, fine: m.fine } : null; });
console.log('[5] cráneo:', JSON.stringify(sk));
check(sk && sk.fine && sk.fine.nTri > 50000, `[5] dentición fina con ${sk && sk.fine ? sk.fine.nTri : 0} triángulos`);
await page.click('[data-layout="vp3d"]'); await page.uncheck('#dicom-vis');
for (const r of ['upper', 'lower', 'soft']) await page.uncheck(`#mesh-cards .card[data-role="${r}"] .m-vis`);
await page.click('[data-view="frontal"]'); await page.waitForTimeout(3000);
await shot('r06_craneo_dientes.png');
await page.evaluate(() => { const vp = window.tresd.V.state.engine.getViewport('vp3d'); const c = vp.getCamera(); vp.setCamera({ parallelScale: c.parallelScale / 2.6 }); vp.render(); });
await page.waitForTimeout(2500);
await shot('r07_dientes_zoom.png');

console.log('errores de consola:', errs.length, errs.slice(0, 5));
console.log(fails ? `${fails} FALLOS` : 'TODO OK');
await browser.close(); server.close();
process.exit(fails || errs.length ? 1 : 0);
