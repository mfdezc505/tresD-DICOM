// Prueba de la ALINEACIÓN escáner→CBCT (port de VOXEL) con el CBCT sintético de tests/make_synth_cbct.py
// (arcadas en pose conocida) y la arcada girada al azar de tests/make_meshes.py:
//   A) CBCT primero, escáner después  → debe caer sobre las coronas (centroide ≈ verdadero, error < 0,6 mm)
//   B) inferior después → hereda (misma oclusión) y su centroide ≈ verdadero
//   C) escáneres primero, CBCT después → alignAllMeshes los coloca igual
//   D) botón «Alinear al CBCT» de la tarjeta
// Uso: node tests/align.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const M = '/tmp/testdata/meshes', C = '/tmp/testdata/cbct_synth';
const OUT = path.join(ROOT, 'tests', 'out');
const pose = JSON.parse(fs.readFileSync(C + '/pose.json', 'utf8'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8768, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
let fails = 0; const errs = [];
const only = process.argv[2] || null;   // p. ej. `node tests/align.mjs E` ejecuta solo esa sección
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
  await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
  page.setDefaultTimeout(240000);
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); if (m.text().startsWith('tresD alineación')) console.log('   ', m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.goto('http://localhost:8768/'); await page.waitForTimeout(1200);
  return page;
}
const status = (page) => page.textContent('#status-text');
const waitMesh = (page) => page.waitForFunction(() => /^(Escáner añadido|No se pudo|Error)/.test(document.querySelector('#status-text').textContent));
const waitCbct = (page) => page.waitForFunction(() => /^(Cargado|Error|No se|Volumen)/.test(document.querySelector('#status-text').textContent) && !/Buscando|Colocando|Encaje/.test(document.querySelector('#status-text').textContent), null, { timeout: 240000 });
const centroids = (page) => page.evaluate(() => window.tresd.V.getMeshes().map((m) => { const p = m.pts; const c = [0, 0, 0]; for (let i = 0; i < p.length; i += 3) { c[0] += p[i]; c[1] += p[i + 1]; c[2] += p[i + 2]; } const n = p.length / 3; return { name: m.name, c: [c[0] / n, c[1] / n, c[2] / n], align: m.align }; }));
async function addMesh(page, file, role) {
  await page.setInputFiles('#in-mesh', [file]);
  await page.waitForSelector('.modal');
  if (role) await page.click(`input[name="dm-role"][value="${role}"]`);
  await page.click('#dlg-ok');
  await waitMesh(page);
}

// ---------- A + B + D: CBCT primero
let page = null, cs = null, d = 0, t0 = 0;
if (!only || only === 'A') {
page = await newPage();
t0 = Date.now();
await page.setInputFiles('#in-folder', C);
await waitCbct(page);
console.log(`[A] CBCT sintético: ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${await status(page)}`);
t0 = Date.now();
await addMesh(page, M + '/arch_upper.stl', 'upper');
console.log(`[A] superior: ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${await status(page)}`);
cs = await centroids(page);
d = dist(cs[0].c, pose.centroid_upper);
check(d < 1.0, `[A] centroide superior a ${d.toFixed(2)} mm del verdadero (error ${cs[0].align && cs[0].align.err ? cs[0].align.err.toFixed(2) : '?'} mm, cobertura ${cs[0].align && cs[0].align.cov != null ? Math.round(100 * cs[0].align.cov) : '?'} %)`);
check(cs[0].align && cs[0].align.err < 0.6, '[A] error de encaje < 0,6 mm');
await page.waitForTimeout(1500);
await page.click('[data-layout="vp3d"]'); await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, 'a01_alineado_frontal.png') });
await page.click('[data-view="lat_r"]'); await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, 'a02_alineado_lateral.png') });
await page.click('[data-view="frontal"]');
// B) inferior hereda
t0 = Date.now();
await addMesh(page, M + '/arch_lower.ply', 'lower');
console.log(`[B] inferior: ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${await status(page)}`);
cs = await centroids(page);
d = dist(cs[1].c, pose.centroid_lower);
check(/sigue a la/.test(await status(page)), '[B] la inferior hereda (misma oclusión)');
check(d < 1.0, `[B] centroide inferior a ${d.toFixed(2)} mm del verdadero`);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, 'a03_dos_arcadas_cbct.png') });
check(await page.locator('#g1').isHidden(), '[UI] botones de subir DICOM ocultos con CBCT cargado');
check(await page.locator('#g2').isHidden(), '[UI] botón de subir escáner oculto con 2 escáneres');
// D) botón alinear de la tarjeta (re-encaje: debe seguir cerca)
await page.click('#mesh-cards .card:nth-child(1) .m-align');
await page.waitForFunction(() => /alineado|DUDOSA|no se/.test(document.querySelector('#status-text').textContent), null, { timeout: 120000 });
console.log('[D] realinear:', await status(page));
cs = await centroids(page);
check(dist(cs[0].c, pose.centroid_upper) < 1.0 && dist(cs[1].c, pose.centroid_lower) < 1.0, `[D] tras «Alinear al CBCT» las dos siguen en su sitio (${dist(cs[0].c, pose.centroid_upper).toFixed(2)} / ${dist(cs[1].c, pose.centroid_lower).toFixed(2)} mm)`);
// quitar el CBCT → vuelven los botones de DICOM; quitar un escáner → vuelve el botón de escáner
await page.click('#dicom-del'); await page.waitForTimeout(1500);
check(await page.locator('#g1').isVisible(), '[UI] al quitar el CBCT vuelven los botones de DICOM');
await page.click('#mesh-cards .card:nth-child(2) .m-del'); await page.waitForTimeout(500);
check(await page.locator('#g2').isVisible(), '[UI] al quitar un escáner vuelve el botón de escáner');
await page.close();
}

// ---------- C: escáneres primero, CBCT después
if (!only || only === 'C') {
page = await newPage();
await addMesh(page, M + '/arch_upper.stl', 'upper');
await addMesh(page, M + '/arch_lower.ply', 'lower');
t0 = Date.now();
await page.setInputFiles('#in-folder', C);
await waitCbct(page);
await page.waitForFunction(() => /arch_upper:/.test(document.querySelector('#status-text').textContent), null, { timeout: 240000 });
console.log(`[C] CBCT después: ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${await status(page)}`);
cs = await centroids(page);
const du = dist(cs[0].c, pose.centroid_upper), dl = dist(cs[1].c, pose.centroid_lower);
check(du < 1.0 && dl < 1.0, `[C] centroides a ${du.toFixed(2)} / ${dl.toFixed(2)} mm de los verdaderos`);
await page.waitForTimeout(1500);
await page.click('[data-layout="vp3d"]'); await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, 'a04_cbct_despues.png') });
await page.close();
}

// ---------- E: la SUPERIOR manda. Inferior primero y superior después → la superior se alinea y la inferior la sigue;
//              y al soltar las dos a la vez (inferior antes en la lista) se importa primero la superior.
if (!only || only === 'E') {
page = await newPage();
await page.setInputFiles('#in-folder', C);
await waitCbct(page);
await addMesh(page, M + '/arch_lower.ply', 'lower');
console.log('[E] inferior sola:', (await status(page)).slice(0, 220));
cs = await centroids(page); console.log('   inferior sola a', dist(cs[0].c, pose.centroid_lower).toFixed(2), 'mm del sitio');
await addMesh(page, M + '/arch_upper.stl', 'upper');
const stE = await status(page);
console.log('[E] superior después:', stE.slice(0, 200));
check(/alineado a los dientes/.test(stE) && !/sigue a la/.test(stE), '[E] la superior que llega después se alinea ELLA (manda)');
cs = await centroids(page);
const dU = dist(cs.find((c) => c.name === 'arch_upper').c, pose.centroid_upper), dL = dist(cs.find((c) => c.name === 'arch_lower').c, pose.centroid_lower);
check(dU < 1.0 && dL < 1.0, `[E] superior ${dU.toFixed(2)} mm · inferior la sigue ${dL.toFixed(2)} mm`);
// botón «Alinear al CBCT» de la INFERIOR → alinea la superior y la inferior la sigue
await page.click('#mesh-cards .card[data-role="lower"] .m-align');
await page.waitForFunction(() => /^arch_upper:/.test(document.querySelector('#status-text').textContent), null, { timeout: 120000 });
console.log('[E] botón de la inferior:', await status(page));
check(/^arch_upper:/.test(await status(page)) && /la sigue/.test(await status(page)), '[E] el botón de la inferior alinea la superior y la inferior la sigue');
await page.click('#mesh-cards .card[data-role="lower"] .m-del'); await page.click('#mesh-cards .card[data-role="upper"] .m-del'); await page.waitForTimeout(400);
// las dos a la vez, inferior antes en la lista
await page.setInputFiles('#in-mesh', [M + '/arch_lower.ply', M + '/arch_upper.stl']);
await page.waitForSelector('.modal');
const first = await page.textContent('.modal .hint b');
check(/arch_upper/.test(first), `[E] al soltar las dos, la primera en importarse es la superior (${first})`);
await page.click('#dlg-ok'); await page.waitForSelector('.modal'); await page.click('#dlg-ok'); await waitMesh(page);
await page.waitForTimeout(500);
cs = await centroids(page);
check(cs.length === 2 && cs.every((c) => dist(c.c, c.name === 'arch_upper' ? pose.centroid_upper : pose.centroid_lower) < 1.0), '[E] las dos en su sitio');
await page.close();
}

console.log('errores de consola:', errs.length, errs.slice(0, 5));
console.log(fails ? `${fails} FALLOS` : 'TODO OK');
await browser.close(); server.close();
process.exit(fails || errs.length ? 1 : 0);
