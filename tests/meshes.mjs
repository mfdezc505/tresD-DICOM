// Prueba de la FASE 2 (escáneres intraorales) en Chromium sin cabeza: STL solo (sin CBCT), PLY con
// colores heredando la orientación, medición sobre la malla, corte, diálogo de escala (cm), islas,
// CBCT cargado DESPUÉS con las mallas presentes, quitar el CBCT y quitar las mallas.
// Requiere: python3 tests/make_meshes.py y tests/make_dicom.py. Uso: node tests/meshes.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const M = '/tmp/testdata/meshes';
const OUT = path.join(ROOT, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8766, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
  page.setDefaultTimeout(180000);
const logs = []; let fails = 0;
page.on('console', (m) => { const s = `[${m.type()}] ${m.text()}`; logs.push(s); if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('tresD ')) console.log(s.slice(0, 300)); });
page.on('pageerror', (e) => { logs.push('[pageerror] ' + e.message); console.log('[pageerror]', e.message); });
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const status = () => page.textContent('#status-text');
const shot = (n) => page.screenshot({ path: path.join(OUT, n) });

await page.goto('http://localhost:8766/'); await page.waitForTimeout(1500);

// 1) STL solo, sin CBCT
await page.setInputFiles('#in-mesh', [M + '/arch_upper.stl']);
await page.waitForSelector('.modal');
check(await page.isChecked('input[name="dm-role"][value="upper"]'), 'diálogo: rol adivinado = superior');
await page.click('#dlg-ok');
await page.waitForFunction(() => /^(Escáner añadido|No se pudo|Error)/.test(document.querySelector('#status-text').textContent));
console.log('estado:', await status());
await page.waitForTimeout(2000);
check((await status()).includes('orientado (') && !(await status()).includes('DUDOSA'), 'STL orientado con confianza');
check(await page.locator('#mesh-cards .card').count() === 1, 'una tarjeta de malla');
check(await page.locator('#grid .vp:not(.hidden)').count() === 1, 'solo el visor 3D visible sin CBCT');
check(await page.locator('#vispanel .card.dicom').first().isHidden(), 'tarjeta DICOM oculta sin CBCT');
await shot('m01_stl_solo.png');
await page.click('[data-view="lat_r"]'); await page.waitForTimeout(1200); await shot('m02_stl_lateral.png');
await page.click('[data-view="inf"]'); await page.waitForTimeout(1200); await shot('m03_stl_inferior.png');
await page.click('[data-view="frontal"]'); await page.waitForTimeout(800);

// 2) PLY inferior con colores: hereda el giro de la superior
await page.setInputFiles('#in-mesh', [M + '/arch_lower.ply']);
await page.waitForSelector('.modal');
check(await page.isChecked('input[name="dm-role"][value="lower"]'), 'diálogo: rol adivinado = inferior');
await page.click('#dlg-ok');
await page.waitForFunction(() => /^(Escáner añadido|No se pudo|Error)/.test(document.querySelector('#status-text').textContent));
console.log('estado:', await status());
await page.waitForTimeout(2000);
check((await status()).includes('hereda'), 'PLY hereda la orientación (misma oclusión)');
check(await page.locator('#mesh-cards .card').count() === 2, 'dos tarjetas');
check(await page.locator('#mesh-cards .card:nth-child(2) .m-real').isVisible(), 'PLY con colores: casilla «Color del escáner»');
await shot('m04_dos_arcadas.png');
// oclusión: la inferior debe quedar DEBAJO (z menor) de la superior en LPS
const zs = await page.evaluate(() => window.tresd.V.getMeshes().map((m) => (m.bounds[4] + m.bounds[5]) / 2));
check(zs[1] < zs[0], `inferior debajo de la superior (z ${zs.map((z) => z.toFixed(1)).join(' / ')})`);

// 3) medición sobre la malla (2 clics) + corte
await page.click('#btn-dist');
const box = await page.locator('#vp3d').boundingBox();
await page.mouse.click(box.x + box.width * 0.40, box.y + box.height * 0.5); await page.waitForTimeout(500);
await page.mouse.click(box.x + box.width * 0.60, box.y + box.height * 0.5); await page.waitForTimeout(1000);
const nlab = await page.locator('#vp3d .mlabel').count();
check(nlab === 1, `medición sobre la malla: ${nlab} etiqueta (${nlab ? await page.locator('#vp3d .mlabel').first().textContent() : '-'})`);
await page.click('#btn-dist');
await page.check('#cut-x'); await page.fill('#cut-slider', '50'); await page.waitForTimeout(1200);
await shot('m05_corte_medicion.png');
await page.uncheck('#cut-x'); await page.waitForTimeout(300);
// transparencia y color de la primera
await page.fill('#mesh-cards .card:nth-child(1) .m-op', '40'); await page.waitForTimeout(800);
await shot('m06_transparencia.png');
await page.fill('#mesh-cards .card:nth-child(1) .m-op', '100');
await page.click('#mesh-cards .card:nth-child(2) .m-flip'); await page.waitForTimeout(1000);
await shot('m07_voltear.png');
await page.click('#mesh-cards .card:nth-child(2) .m-flip'); await page.waitForTimeout(500);

// 4) escala en cm → el diálogo ofrece convertir; islas → aviso
await page.setInputFiles('#in-mesh', [M + '/arch_cm.stl']);
await page.waitForSelector('.modal');
check(await page.locator('#dm-scale').count() === 1 && await page.isChecked('#dm-scale'), 'STL en cm: casilla de conversión a mm marcada');
await shot('m08_dialogo_cm.png');
await page.click('#dlg-cancel'); await page.waitForTimeout(300);
await page.setInputFiles('#in-mesh', [M + '/arch_islands.stl']);
await page.waitForSelector('.modal');
const dlgTxt = await page.locator('.modal').textContent();
check(/quitados 1 trozos/.test(dlgTxt), 'islas: aviso de trozo suelto quitado (' + (dlgTxt.match(/quitados[^·]*/) || ['-'])[0].trim() + ')');
await page.click('#dlg-cancel'); await page.waitForTimeout(300);
// OBJ
await page.setInputFiles('#in-mesh', [M + '/arch_upper.obj']);
await page.waitForSelector('.modal'); await page.click('input[name="dm-role"][value="other"]'); await page.click('#dlg-ok');
await page.waitForFunction(() => /^(Escáner añadido|No se pudo|Error)/.test(document.querySelector('#status-text').textContent));
console.log('estado OBJ:', await status());
check((await status()).startsWith('Escáner añadido'), 'OBJ leído');
await page.click('#mesh-cards .card:nth-child(3) .m-del'); await page.waitForTimeout(500);
check(await page.locator('#mesh-cards .card').count() === 2, 'OBJ quitado');

// 5) CBCT cargado DESPUÉS: las mallas siguen colgadas
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Error|No se|Volumen)/.test(document.querySelector('#status-text').textContent), null, { timeout: 180000 });
console.log('estado CBCT:', await status());
await page.waitForTimeout(3000);
const nAct = await page.evaluate(() => window.tresd.V.getEngine().getViewport('vp3d').getActors().length);
check(nAct >= 3, `actores en el 3D con CBCT + 2 mallas: ${nAct}`);
check(await page.locator('#grid .vp:not(.hidden)').count() === 4, 'rejilla 2×2 con CBCT');
await shot('m09_cbct_y_mallas.png');
await page.click('[data-layout="vp3d"]'); await page.waitForTimeout(2500);
await shot('m10_cbct_y_mallas_3d.png');
// medición mixta: clic sobre hueso y sobre malla
await page.click('#btn-dist');
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3); await page.waitForTimeout(600);
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55); await page.waitForTimeout(1200);
console.log('etiquetas tras CBCT:', await page.locator('#vp3d .mlabel').count());
await page.click('#btn-dist');

// 6) quitar el CBCT: quedan las mallas; quitar las mallas: estado vacío
await page.click('#dicom-del'); await page.waitForTimeout(2500);
check(await page.locator('#mesh-cards .card').count() === 2 && await page.locator('#grid').isVisible(), 'sin CBCT siguen las 2 mallas');
check(await page.locator('#grid .vp:not(.hidden)').count() === 1, 'vuelve a verse solo el 3D');
await shot('m11_sin_cbct.png');
await page.click('#btn-lang'); await page.waitForTimeout(400);
console.log('tarjeta EN:', (await page.locator('#mesh-cards .card:nth-child(1)').textContent()).replace(/\s+/g, ' ').trim().slice(0, 120));
await page.click('#btn-lang');
await page.click('#mesh-cards .card:nth-child(1) .m-del'); await page.waitForTimeout(400);
await page.click('#mesh-cards .card:nth-child(1) .m-del'); await page.waitForTimeout(800);
check(await page.locator('#main-drop').isVisible() && await page.locator('#grid').isHidden(), 'estado vacío tras quitar todo');
await shot('m12_vacio.png');

fs.writeFileSync(path.join(OUT, 'console_meshes.log'), logs.join('\n'));
const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
console.log('errores de consola:', errs.length, errs.slice(0, 5));
console.log(fails ? `${fails} FALLOS` : 'TODO OK');
await browser.close(); server.close();
process.exit(fails || errs.length ? 1 : 0);
