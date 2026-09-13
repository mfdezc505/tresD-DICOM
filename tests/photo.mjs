// Prueba de la FASE 3: segmentación rápida (hueso + piel) y foto drapeada sobre la piel.
// Con la muestra DZ-CBCT (cara sin ojos → MediaPipe no la reconoce): se usa como "foto" el propio render
// frontal de la piel y el REGISTRO MANUAL (7 puntos en la foto y los mismos en el 3D), así el ajuste
// esperado es exacto (error de registro ≈ 0 px) y el drapeado debe reproducir el render.
// Uso: node tests/photo.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(ROOT, 'tests', 'out');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.data': 'application/octet-stream', '.binarypb': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8770, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); } catch (e) {} });
page.setDefaultTimeout(240000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 300)); if (tx.startsWith('tresD ')) console.log('   ', tx.slice(0, 200)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const status = () => page.textContent('#status-text');
const shot = (n) => page.screenshot({ path: path.join(OUT, n) });

await page.goto('http://localhost:8770/'); await page.waitForTimeout(1200);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Error|No se|Volumen)/.test(document.querySelector('#status-text').textContent), null, { timeout: 240000 });
await page.waitForTimeout(1500);
check(await page.locator('#g3').isVisible() && await page.locator('#btn-seg').isVisible(), 'grupo 3 (piel y foto) visible con CBCT');

// 1) segmentación rápida
let t0 = Date.now();
await page.click('#btn-seg');
await page.waitForFunction(() => /^(Segmentación lista|La segmentación|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 240000 });
console.log(`segmentación: ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${await status()}`);
check((await status()).startsWith('Segmentación lista'), 'segmentación terminada');
check(await page.locator('#mesh-cards .card[data-seg="1"]').count() === 2, 'dos tarjetas: cráneo y piel');
check(await page.locator('#btn-seg').isHidden(), 'botón Segmentar oculto tras segmentar');
const tris = await page.evaluate(() => window.tresd.V.getMeshes().map((m) => [m.role, m.nTri, m.parts]));
console.log('   mallas:', JSON.stringify(tris));
check(tris.every((x) => x[1] > 20000), 'ambas mallas con > 20 000 triángulos');
await page.click('[data-layout="vp3d"]'); await page.waitForTimeout(3000);
await shot('p01_segmentacion.png');
// solo la piel, de frente: será la "foto"
await page.uncheck('#dicom-vis');
await page.uncheck('#mesh-cards .card[data-role="skull"] .m-vis');
await page.click('[data-view="frontal"]'); await page.waitForTimeout(3500);
await shot('p02_piel.png');
const photoData = await page.evaluate(() => document.querySelector('#vp3d canvas').toDataURL('image/png'));
const photoPath = path.join(OUT, 'p02_foto_piel.png');
fs.writeFileSync(photoPath, Buffer.from(photoData.split(',')[1], 'base64'));
const vpBox = await page.locator('#vp3d').boundingBox();
const cvSize = await page.evaluate(() => { const c = document.querySelector('#vp3d canvas'); return [c.width, c.height]; });
console.log('   foto (render):', cvSize.join('×'), 'visor', Math.round(vpBox.width) + '×' + Math.round(vpBox.height));

// 2) foto = ese render. Vía AUTOMÁTICA (MediaPipe en la foto y en la piel 3D): con la muestra DZ (sin ojos)
//    puede no reconocer la cara → entonces la app pasa al registro manual (se prueba en el paso 3).
t0 = Date.now();
await page.setInputFiles('#in-photo', [photoPath]);
await page.waitForFunction(() => /^(Foto drapeada|No se pudo|Error)/.test(document.querySelector('#status-text').textContent) || document.querySelector('.modal.photo'), null, { timeout: 240000 });
console.log(`vía automática: ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${(await status()).slice(0, 140)}`);
let auto = null;
if (await page.locator('.modal.photo').count()) {
  console.log('   (sin cara reconocible: la app ofrece el registro manual; se cancela para probarlo aparte)');
  await page.click('#ph-cancel'); await page.waitForTimeout(300);
} else {
  auto = await page.evaluate(() => { const s = window.tresd.V.softMesh(); return s && s.drape ? { err: s.drape.err, n: s.drape.n, painted: s.drape.painted } : null; });
  console.log('   automática:', JSON.stringify(auto));
  check(auto && auto.err < 4, `automática: error de registro ${auto ? auto.err.toFixed(2) : '?'} px`);
  await page.waitForTimeout(3000); await shot('p03_drapeado_auto.png');
  await page.click('#mesh-cards .card[data-role="soft"] .m-photo-del'); await page.waitForTimeout(500);
  await page.check('#dicom-vis'); await page.uncheck('#dicom-vis');
}

// 3) REGISTRO MANUAL (forzado): 7 puntos en la foto y los mismos en el 3D → ajuste exacto
await page.evaluate(() => { window.tresd.forceManual = true; });
await page.click('[data-view="frontal"]'); await page.waitForTimeout(2000);
await page.setInputFiles('#in-photo', [photoPath]);
await page.waitForSelector('.modal.photo', { timeout: 240000 });
check(/marca los puntos a mano/.test(await status()), 'registro manual: pide los puntos');
await shot('p03_dialogo_puntos.png');
// 7 puntos sobre la cara en la foto (fracciones del canvas del render)
const PTS = [[0.50, 0.30], [0.50, 0.40], [0.40, 0.55], [0.60, 0.55], [0.50, 0.72], [0.30, 0.30], [0.70, 0.30]];
const cvBox = await page.locator('#ph-canvas').boundingBox();
for (const [fx, fy] of PTS) { await page.mouse.click(cvBox.x + fx * cvBox.width, cvBox.y + fy * cvBox.height); await page.waitForTimeout(80); }
check(await page.locator('#ph-ok').isEnabled(), '7 puntos marcados en la foto');
await shot('p04_puntos_foto.png');
await page.click('#ph-ok'); await page.waitForTimeout(1500);
check(/Marca en la piel 3D/.test(await status()), 'pide los puntos en el 3D');
// los mismos puntos en el visor 3D (misma cámara frontal y mismo tamaño que la foto)
const box2 = await page.locator('#vp3d').boundingBox();
for (const [fx, fy] of PTS) {
  await page.mouse.click(box2.x + fx * box2.width, box2.y + fy * box2.height);
  await page.waitForTimeout(700);
}
await page.waitForFunction(() => /^(Foto drapeada|No se pudo|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 240000 });
console.log('drapeado manual:', await status());
const drape = await page.evaluate(() => { const s = window.tresd.V.softMesh(); return s && s.drape ? { err: s.drape.err, n: s.drape.n, painted: s.drape.painted, manual: s.drape.manual } : null; });
console.log('   drape:', JSON.stringify(drape));
check(drape && drape.err < 3, `error de registro ${drape ? drape.err.toFixed(2) : '?'} px (< 3)`);
check(drape && drape.painted > 1000, `${drape ? drape.painted : 0} vértices con foto`);
check(await page.locator('#mesh-cards .card[data-role="soft"] .m-photo').isVisible(), 'fila «Foto drapeada» en la tarjeta de la piel');
check(await page.locator('#btn-photo').isHidden(), 'botón Subir foto oculto con foto drapeada');
await page.waitForTimeout(3500);
await shot('p05_drapeado_frontal.png');
await page.click('[data-view="lat_r"]'); await page.waitForTimeout(3500);
await shot('p06_drapeado_lateral.png');
await page.click('[data-view="frontal"]');
await page.waitForTimeout(3000);
const drapedData = await page.evaluate(() => document.querySelector('#vp3d canvas').toDataURL('image/png'));
fs.writeFileSync(path.join(OUT, 'p05_drapeado_canvas.png'), Buffer.from(drapedData.split(',')[1], 'base64'));
await page.evaluate(() => { window.tresd.forceManual = false; });
// ocultar / quitar la foto
await page.uncheck('#mesh-cards .card[data-role="soft"] .m-photo-vis'); await page.waitForTimeout(2500);
await shot('p07_foto_oculta.png');
await page.check('#mesh-cards .card[data-role="soft"] .m-photo-vis'); await page.waitForTimeout(500);
await page.click('#mesh-cards .card[data-role="soft"] .m-photo-del'); await page.waitForTimeout(800);
check(await page.locator('#btn-photo').isVisible() && await page.locator('#mesh-cards .card[data-role="soft"] .m-photo').isHidden(), 'quitar la foto: vuelve el botón y desaparece la fila');
// imagen sin cara (logo) → manual → cancelar
await page.setInputFiles('#in-photo', [path.join(ROOT, 'public', 'img', 'logo_main_dark.png')]);
await page.waitForSelector('.modal.photo', { timeout: 240000 });
await page.click('#ph-cancel'); await page.waitForTimeout(300);
check((await status()) === 'Listo.', 'cancelar el registro manual → Listo');
// quitar la piel → vuelve el botón Segmentar
await page.click('#mesh-cards .card[data-role="soft"] .m-del'); await page.waitForTimeout(500);
check(await page.locator('#btn-seg').isVisible(), 'sin piel vuelve el botón Segmentar');

console.log('errores de consola:', errs.length, errs.slice(0, 5));
console.log(fails ? `${fails} FALLOS` : 'TODO OK');
await browser.close(); server.close();
process.exit(fails || errs.length ? 1 : 0);
