// Comprobaciones de v0.8.4 (peticiones de Manuel del 17-09-2026, 7 puntos):
//  1) cada deslizador de corte del color de su corte (axial rojo, coronal verde, sagital azul)
//  2) «Cortes de ATM» oculto con los cortes hechos, y sigue oculto cuando se refresca el panel (importar un escáner)
//  3) preset «Rejilla»: puntos + superficie en alambre (triángulos sutiles)
//  4) alinear por puntos en vista DERECHA (escáner y CBCT)
//  5) panorámica en el PDF aunque no se haya abierto (se calcula sola); 6) TeleRx lateral y frontal en radiografía y MIP
//  7) títulos «Importar» y «3 · Piel y foto facial» ocultos con esos registros subidos
//  Compartir caso (segunda tanda del 17-09): 8) foto drapeada opcional en el paquete; 9) escáner con color en PLY;
//  10) reducción 1/4 (vóxel × 1,6); 11) el paquete se abre con «📂 Abrir», «Subir ZIP» y el botón de la pantalla inicial;
//  12) cortes de ATM y polos restaurados aunque falle otro bloque
// Uso: node tests/v084.mjs  (necesita /tmp/testdata/cbct_half y real_scans/upper.stl, lower.stl; poppler-utils; Pillow)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(ROOT, 'tests/out');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8797, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, locale: 'es-ES', acceptDownloads: true });
await ctx.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
const page = await ctx.newPage();
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(OUT, n) });
const sleep = (ms) => page.waitForTimeout(ms);
const status = () => ev(() => document.querySelector('#status-text').textContent);
const waitStatus = (re, ms = 300000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#status-text').textContent), re.source, { timeout: ms, polling: 100 });
const hidden = (sel) => ev((s) => document.querySelector(s).classList.contains('hidden'), sel);
const pixels = async (clip, name) => { const buf = await page.screenshot({ clip }); fs.writeFileSync(path.join(OUT, name), buf); return +execSync(`python3 -c "from PIL import Image; import numpy as np; a=np.array(Image.open('${path.join(OUT, name)}').convert('RGB')).astype(int); bg=a[5,5]; print((np.abs(a-bg).sum(axis=2)>40).sum())"`).toString(); };
const camNormal = () => ev(() => window.tresd.V.getEngine().getViewport('vp3d').getCamera().viewPlaneNormal.map((v) => +v.toFixed(2)));

await page.goto('http://localhost:8797/'); await sleep(600);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await waitStatus(/^(Cargado|Aviso)/); await sleep(2000);

console.log('— 1) deslizadores del color de cada corte');
const cols = await ev(() => Object.fromEntries(['vpAx', 'vpCor', 'vpSag'].map((id) => [id, getComputedStyle(document.querySelector(`.vp[data-id="${id}"] .vslice`)).backgroundColor.replace(/srgb/, '').match(/\d*\.?\d+/g).slice(0, 3).map(Number)])));   // «rgb(r, g, b)» o «color(srgb r g b)» (color-mix)
console.log('   colores:', JSON.stringify(cols));
const dom = (c) => c.indexOf(Math.max(...c));
check(dom(cols.vpAx) === 0 && dom(cols.vpCor) === 1 && dom(cols.vpSag) === 2, 'axial rojizo, coronal verdoso y sagital azulado (los colores de la cruz)');
check(new Set(Object.values(cols).map((c) => c.join(','))).size === 3, 'los tres deslizadores tienen colores distintos');

console.log('— 7a) títulos del panel al empezar');
check(!(await hidden('#side .phead .h1')) && !(await hidden('#g3 .gtitle')) && !(await hidden('#g3')), 'con solo el CBCT se ven «Importar» y «3 · Piel y foto facial»');

console.log('— 3) Rejilla con alambre');
await page.click('[data-layout="vp3d"]'); await sleep(1500);
await page.selectOption('#dicom-preset', 'grid');
await page.waitForFunction(() => { const c = window.tresd.V.cloudInfo(); return c && c.visible; }, null, { timeout: 300000 }); await sleep(2500);
const ci = await ev(() => window.tresd.V.cloudInfo());
console.log('   nube:', JSON.stringify(ci));
check(ci.tris > 20000 && ci.wireVisible, `superficie en alambre con ${ci.tris.toLocaleString()} triángulos, visible bajo los ${ci.n.toLocaleString()} puntos`);
check(/triángulos/.test(await status()), `estado: «${(await status()).slice(0, 80)}»`);
const b3 = await page.locator('#vp3d').boundingBox();
const pxGrid = await pixels({ x: b3.x + 40, y: b3.y + 60, width: b3.width - 80, height: b3.height - 100 }, 'v084_rejilla_px.png');
check(pxGrid > 40000, `la rejilla se pinta (${pxGrid} píxeles)`);
await shot('v084_rejilla.png');
await page.selectOption('#dicom-preset', 'ivory'); await sleep(2000);
check((await ev(() => { const c = window.tresd.V.cloudInfo(); return c && !c.visible && !c.wireVisible; })), 'al volver a marfil se esconden puntos y alambre');

console.log('— 2) «Cortes de ATM» oculto con los cortes hechos');
await ev(() => { window.tresd.noAutoPoles = true; });
check(!(await hidden('#btn-atm')), 'sin cortes: el botón se ve');
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
await ev(() => { window.tresd.renderTmj(); }); await sleep(300);
check(await hidden('#btn-atm') && !(await hidden('#lay-atm')), 'con los cortes hechos se oculta el botón (y aparece la vista ATM)');
await page.click('[data-layout="quad"]'); await sleep(800);
await page.setInputFiles('#in-mesh', ['/tmp/testdata/real_scans/upper.stl']);
await page.waitForSelector('.modal'); await page.click('input[name="dm-role"][value="upper"]'); await page.click('#dlg-ok');
await waitStatus(/^(Escáner añadido|No se pudo|Error)/); await sleep(1000);
check(await hidden('#btn-atm'), 'y sigue oculto tras importar un escáner (el panel se refresca)');

console.log('— 4) alinear por puntos en vista derecha');
await page.click('[data-layout="vp3d"]'); await sleep(2000);
await page.click('[data-view="frontal"]'); await sleep(1200);
check((await camNormal())[1] !== 0, `de partida, vista frontal (normal ${(await camNormal()).join(',')})`);
await page.click('#mesh-cards .card[data-role="upper"] .m-points'); await sleep(1500);
const n1 = await camNormal();
check(n1[0] === -1 && n1[1] === 0 && n1[2] === 0, `fase 1 (escáner): vista DERECHA (normal ${n1.join(',')})`);
const b3b = await page.locator('#vp3d').boundingBox();
const pts2d = await ev(() => {
  const V = window.tresd.V; const m = V.getMeshes().find((x) => x.role === 'upper');
  const vp = V.state.engine.getViewport('vp3d'); const p = m.pts; const n = p.length / 3;
  const cand = []; for (let i = 0; i < n; i += 7) cand.push([p[3 * i], p[3 * i + 1], p[3 * i + 2]]);
  cand.sort((a, b) => a[0] - b[0]); const side = cand.slice(0, Math.floor(cand.length * 0.15));   // lado derecho (x mínimo en LPS)
  side.sort((a, b) => a[1] - b[1]);
  const pick = [side[Math.floor(side.length * 0.1)], side[Math.floor(side.length * 0.5)], side[Math.floor(side.length * 0.9)]];
  return pick.map((w) => vp.worldToCanvas(w));
});
for (const [x, y] of pts2d) { await page.mouse.click(b3b.x + x, b3b.y + y); await sleep(700); }
await sleep(800);
check(/FASE 2|CBCT/.test(await page.textContent('#pa-text')), 'tras 3 puntos pasa a la fase del CBCT');
const n2 = await camNormal();
const ps2 = await ev(() => window.tresd.V.getEngine().getViewport('vp3d').getCamera().parallelScale);
check(n2[0] === -1 && n2[1] === 0 && n2[2] === 0 && ps2 < 60, `fase 2 (CBCT): vista DERECHA y de cerca (normal ${n2.join(',')}, escala ${ps2.toFixed(1)} mm)`);
await shot('v084_puntos_derecha.png');
await page.keyboard.press('Escape'); await sleep(800);

console.log('— 5) y 6) PDF: panorámica sin haberla abierto; TeleRx lateral y frontal en radiografía y MIP');
await page.click('[data-layout="quad"]'); await sleep(1200);
check(!(await ev(() => !!window.tresd.V.state.pano)), 'la panorámica no se ha abierto todavía');
await page.click('#btn-report'); await sleep(300);
check(await page.locator('#rp-pano').isEnabled() && !(await page.isChecked('#rp-pano')), 'la casilla «Panorámica» se puede marcar aunque no se haya visto (sin marcar por defecto)');
check(/MIP/.test(await ev(() => document.querySelector('#rp-tele').parentElement.textContent)), 'la casilla de TeleRx dice «radiografía y MIP»');
await page.check('#rp-pano');
await page.uncheck('#rp-views'); await page.uncheck('#rp-3d'); await page.uncheck('#rp-mpr'); await page.uncheck('#rp-atm');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.click('#dlg-ok')]);
const pdf = path.join(OUT, 'v084_informe.pdf'); await dl.saveAs(pdf);
const tx = execSync(`pdftotext -layout "${pdf}" -`).toString();
check(await ev(() => !!window.tresd.V.state.pano), 'la panorámica se ha calculado para el informe');
check(/Panorámica/.test(tx), 'figura «Panorámica» en el PDF');
for (const cap of ['TeleRx lateral · Radiografía', 'TeleRx lateral · MIP', 'TeleRx frontal (pa) · Radiografía', 'TeleRx frontal (pa) · MIP']) check(tx.includes(cap), `figura «${cap}» en el PDF`);
const nImg = +execSync(`pdfimages -list "${pdf}" | tail -n +3 | wc -l`).toString().trim();
check(nImg >= 5, `${nImg} imágenes en el PDF (panorámica + 4 TeleRx)`);
execSync(`pdftoppm -r 40 -png "${pdf}" "${path.join(OUT, 'v084_pdf')}"`);
await page.click('[data-layout="vpPan"]'); await sleep(2500);
check((await ev(() => document.querySelector('#pan-canvas').width)) > 100 && (await ev(() => window.tresd.V.state.pano.image.width)) > 200, 'la panorámica calculada se abre en el visor');

console.log('— 7b) títulos ocultos con piel, foto y dos escáneres');
await page.click('[data-layout="quad"]'); await sleep(800);
await page.click('#btn-seg');
await waitStatus(/^(Segmentación lista|La segmentación|Error)/); await sleep(1500);
check(await hidden('#btn-seg') && !(await hidden('#g3 .gtitle')), 'segmentado: se oculta «Segmentar» pero el título 3 sigue (falta la foto)');
await page.click('[data-layout="vp3d"]'); await sleep(2500);
await page.uncheck('#dicom-vis');
await page.uncheck('#mesh-cards .card[data-role="skull"] .m-vis');
await page.click('[data-view="frontal"]'); await sleep(3000);
const photoData = await ev(() => document.querySelector('#vp3d canvas').toDataURL('image/png'));
const photoPath = path.join(OUT, 'v084_foto.png');
fs.writeFileSync(photoPath, Buffer.from(photoData.split(',')[1], 'base64'));
await ev(() => { window.tresd.forceManual = true; });
await page.setInputFiles('#in-photo', [photoPath]);
await page.waitForSelector('.modal.photo', { timeout: 300000 });
const PTS = [[0.50, 0.30], [0.40, 0.55], [0.60, 0.55]];
const cvBox = await page.locator('#ph-canvas').boundingBox();
for (const [fx, fy] of PTS) { await page.mouse.click(cvBox.x + fx * cvBox.width, cvBox.y + fy * cvBox.height); await sleep(80); }
await page.click('#ph-ok'); await sleep(1500);
const box2 = await page.locator('#vp3d').boundingBox();
for (const [fx, fy] of PTS) { await page.mouse.click(box2.x + fx * box2.width, box2.y + fy * box2.height); await sleep(700); }
await waitStatus(/^(Foto drapeada|No se pudo|Error)/); await sleep(1500);
console.log('   foto:', (await status()).slice(0, 80));
check(await hidden('#btn-photo') && await hidden('#g3 .gtitle') && !(await hidden('#g3')), 'con piel y foto: sin título «3 · Piel y foto facial» (quedan vía aérea y ATM)');
check(!(await hidden('#side .phead .h1')), '«Importar» sigue: falta el segundo escáner');
await page.click('[data-layout="quad"]'); await sleep(800);
await page.setInputFiles('#in-mesh', ['/tmp/testdata/real_scans/lower.stl']);
await page.waitForSelector('.modal'); await page.click('input[name="dm-role"][value="lower"]'); await page.click('#dlg-ok');
await waitStatus(/^(Escáner añadido|No se pudo|Error)/); await sleep(1000);
check(await hidden('#g1') && await hidden('#g2') && await hidden('#side .phead .h1'), 'con CBCT, dos escáneres, piel y foto: se oculta el título «Importar»');
await shot('v084_panel.png');

console.log('— 8-10) paquete con foto, escáner con color (PLY) y reducción 1/4');
await page.setInputFiles('#in-mesh', ['/tmp/testdata/meshes/arch_lower.ply']);
await page.waitForSelector('.modal'); await page.click('input[name="dm-role"][value="other"]'); await page.click('#dlg-ok');
await waitStatus(/^(Escáner añadido|No se pudo|Error)/); await sleep(1000);
check(await ev(() => { const m = window.tresd.V.getMeshes().find((x) => x.name === 'arch_lower'); return !!(m && m.colors); }), 'el escáner PLY se carga con su color');
await page.click('#btn-share'); await sleep(300);
check(await page.locator('#sh-photo').isEnabled() && !(await page.isChecked('#sh-photo')), 'casilla «Incluir la foto drapeada»: disponible y sin marcar con anonimizar');
await page.uncheck('#sh-anon'); await sleep(100);
check(await page.isChecked('#sh-photo'), 'al quitar «anonimizar» se propone incluir la foto');
check(/1\/4/.test(await ev(() => document.querySelector('#sh-reduce').parentElement.textContent)), 'la reducción dice 1/4');
const [dlz] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.click('#dlg-ok')]);
const pkg = path.join(OUT, 'v084_paquete.tresdz'); await dlz.saveAs(pkg);
await waitStatus(/^Paquete/); 
const info = JSON.parse(execSync(`python3 - <<'PY'
import zipfile, json, io, pydicom
z = zipfile.ZipFile('${pkg}')
names = z.namelist()
sess = json.loads(z.read('sesion.tresd'))
dcm = sorted([n for n in names if n.startswith('dicom/')])
ds = pydicom.dcmread(io.BytesIO(z.read(dcm[0])))
print(json.dumps({ 'n': len(dcm), 'cols': int(ds.Columns), 'rows': int(ds.Rows), 'sp': [float(x) for x in ds.PixelSpacing], 'thick': float(ds.SliceThickness), 'name': str(ds.PatientName),
  'ply': [n for n in names if n.endswith('.ply')], 'stl': [n for n in names if n.endswith('.stl')],
  'photo': bool(sess.get('photo') and sess['photo'].get('image', '').startswith('data:image/jpeg') and sess['photo'].get('pose')),
  'tmj': bool(sess.get('tmj') and sess['tmj'].get('poles', {}).get('L')), 'pano': bool(sess.get('pano') and sess['pano'].get('control')), 'packaged': sess.get('packaged') }))
PY`).toString());
console.log('   paquete:', JSON.stringify(info));
check(info.n === 136 && info.cols === 210 && Math.abs(info.sp[0] - 0.7937) < 0.01, `reducción 1/4: ${info.n} cortes de ${info.cols}×${info.rows} a ${info.sp[0].toFixed(3)} mm (vóxel × 1,59)`);
check(info.ply.includes('escaneres/arch_lower.ply') && info.stl.includes('escaneres/upper.stl'), 'el escáner con color va en PLY y los demás en STL');
check(info.photo && info.packaged.photo, 'la foto drapeada (recorte + pose) va en la sesión del paquete');
check(info.tmj && info.pano, 'polos de ATM y curva panorámica en la sesión del paquete');
check(info.name !== 'ANONIMO', 'sin anonimizar se conserva el nombre');

console.log('— 11-12) abrir el paquete desde cero con «📂 Abrir»: foto, color, ATM y panorámica restaurados');
await page.goto('http://localhost:8797/'); await sleep(800);
check(await page.locator('#drop-open').isVisible() && await page.locator('#drop-folder').isVisible() && /tresdz/.test(await ev(() => document.querySelector('#in-session').accept)) && /\.zip/.test(await ev(() => document.querySelector('#in-session').accept)), 'la pantalla inicial ofrece «Carpeta DICOM» y «ZIP / caso compartido / sesión»; «📂 Abrir» acepta .tresdz y .zip');
await page.setInputFiles('#in-session', [pkg]);
await waitStatus(/^(Cargado|Aviso)/); await sleep(500);
check((await ev(() => window.tresd.V.state.volume.imageData.getDimensions()[0])) === 210, 'el CBCT reducido del paquete se carga (210 columnas)');
await page.waitForFunction(() => window.tresd.V.getMeshes().filter((m) => !m.seg && m.role !== 'airway').length === 3 && window.tresd.V.state.tmj && !/Restaurando|Segmentando|Colocando|Leyendo|Calculando|Escribiendo/.test(document.querySelector('#status-text').textContent), null, { timeout: 600000 });
await sleep(1500);
const back = await ev(() => { const V = window.tresd.V; const soft = V.softMesh(); const ply = V.getMeshes().find((m) => m.name === 'arch_lower'); return { drape: !!(soft && soft.drape), restored: !!(soft && soft.drape && soft.drape.restored), painted: soft && soft.drape ? soft.drape.painted : 0, plyColor: !!(ply && ply.colors), tmj: !!V.state.tmj, poles: V.state.tmj ? V.state.tmj.poles.L.med.map((v) => +v.toFixed(1)) : null, pano: !!V.state.pano, status: document.querySelector('#status-text').textContent }; });
console.log('   reabierto:', JSON.stringify(back));
check(back.drape && back.restored && back.painted > 500, `la foto drapeada vuelve sobre la piel (${back.painted} vértices con foto)`);
check(back.plyColor, 'el escáner PLY vuelve con su color');
check(back.tmj && back.poles && Math.abs(back.poles[0] - 41.6) < 0.1, 'los cortes de ATM se rehacen con los mismos polos');
check(back.pano, 'la panorámica se restaura');
check(!/No se pudo restaurar/.test(back.status), `sin bloques fallidos («${back.status.slice(0, 70)}»)`);
await page.click('[data-layout="vp3d"]'); await sleep(2500);
await shot('v084_paquete_reabierto.png');

console.log('— 11b) el paquete también entra por «Subir ZIP»');
await page.goto('http://localhost:8797/'); await sleep(800);
await page.setInputFiles('#in-zip', [pkg]);
await waitStatus(/^(Cargado|Aviso)/); await sleep(300);
check((await ev(() => window.tresd.V.state.volume.imageData.getDimensions()[0])) === 210, 'por «Subir ZIP» también se carga el CBCT del paquete');
await page.waitForFunction(() => /Sesión restaurada|colocado como en la sesión|No se pudo/.test(document.querySelector('#status-text').textContent), null, { timeout: 600000 });

check(errs.length === 0, `sin errores de consola${errs.length ? ': ' + errs.join(' | ') : ''}`);
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
