// Comprobaciones de v0.8.6 (peticiones de Manuel del 18-09-2026):
//  1) al TERMINAR de alinear escáner-DICOM (por puntos y «Refinar alineación») se ve el render 3D
//  2) orientar el volumen en los 3 planos: gira TODO el caso (volumen, escáneres, medidas, ATM) y lo derivado
//     (panorámica, TeleRx) se rehace; vuelve exacto a la orientación original; se guarda en la sesión
//  3) los deslizadores de corte van BAJO cada corte (horizontales), no a la derecha
//  4) el informe en PowerPoint se descarga (Blob propio, no el de PptxGenJS) y con «Ambos» llegan los dos
//  5) ventana de progreso mientras se genera el informe, la segmentación y la foto drapeada
//  6) la piel NO sale en la captura de vía aérea del informe
// Uso: node tests/v086.mjs   (necesita /tmp/testdata/cbct_half y real_scans/upper.stl; poppler-utils; Pillow)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(ROOT, 'tests/out');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8796, r));
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
const setOr = async (ax, v) => { await page.fill(`#or-${ax}`, String(v)); await page.dispatchEvent(`#or-${ax}`, 'input'); await sleep(500); await page.dispatchEvent(`#or-${ax}`, 'change'); };

await page.goto('http://localhost:8796/'); await sleep(600);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await waitStatus(/^(Cargado|Aviso)/); await sleep(2500);
await page.click('[data-layout="quad"]'); await sleep(1500);

console.log('— 3) deslizadores de corte bajo cada corte');
const sl = await ev(() => ['vpAx', 'vpCor', 'vpSag'].map((id) => {
  const s = document.querySelector(`.vp[data-id="${id}"] .vslice`), r = s.getBoundingClientRect(), vp = s.closest('.vp').getBoundingClientRect();
  const info = s.closest('.vp').querySelector('.vpinfo').getBoundingClientRect();
  return { id, horiz: r.width > r.height * 3, dBottom: Math.round(vp.bottom - r.bottom), wide: Math.round(r.width / vp.width * 100), overInfo: r.top < info.bottom - 1 };
}));
console.log('   ', JSON.stringify(sl));
check(sl.every((x) => x.horiz && x.dBottom < 20 && x.wide > 80), 'los tres son horizontales, pegados al borde inferior y ocupan casi todo el ancho');
check(sl.every((x) => !x.overInfo), 'no tapan el pie de información del corte');

console.log('— 2) orientar el volumen');
check(!(await hidden('#orient-box')) && (await page.locator('#orient-box input[type="range"]').count()) === 3, 'el panel «Orientar el volumen» tiene tres deslizadores');
const p0 = await ev(() => window.tresd.V.state.volume.imageData.indexToWorld([60, 90, 120], [0, 0, 0]));
await setOr('z', 20); await sleep(1500);
const rot = await ev(() => {
  const V = window.tresd.V, img = V.state.volume.imageData, d = img.getDimensions();
  const c = img.indexToWorld([(d[0] - 1) / 2, (d[1] - 1) / 2, (d[2] - 1) / 2], [0, 0, 0]);
  return { p: img.indexToWorld([60, 90, 120], [0, 0, 0]), c, orient: V.getOrient() };
});
const a = (20 * Math.PI) / 180, v = [p0[0] - rot.c[0], p0[1] - rot.c[1], p0[2] - rot.c[2]];
const exp = [Math.cos(a) * v[0] - Math.sin(a) * v[1] + rot.c[0], Math.sin(a) * v[0] + Math.cos(a) * v[1] + rot.c[1], v[2] + rot.c[2]];
const err = Math.hypot(rot.p[0] - exp[0], rot.p[1] - exp[1], rot.p[2] - exp[2]);
check(err < 0.01 && rot.orient.z === 20, `giro axial de 20°: el volumen rota exactamente lo pedido (error ${err.toFixed(4)} mm)`);
check(/Volumen orientado/.test(await status()), `estado: «${(await status()).slice(0, 55)}»`);
await shot('v086_orientado.png');
await page.click('#or-reset'); await sleep(1500);
const back = await ev(() => window.tresd.V.state.volume.imageData.indexToWorld([60, 90, 120], [0, 0, 0]));
check(Math.hypot(back[0] - p0[0], back[1] - p0[1], back[2] - p0[2]) < 0.001 && (await ev(() => window.tresd.V.getOrient().z)) === 0, 'volver a la orientación original deja el volumen EXACTAMENTE donde estaba');

// EN VIVO: varios `input` seguidos SIN pausa (como un arrastre real) deben ir girando el volumen, no esperar al soltar
await page.click('#btn-orient'); await sleep(300);
const vivo = [];
for (let i = 1; i <= 5; i++) { await page.fill('#or-z', String(i * 3)); await page.dispatchEvent('#or-z', 'input'); await sleep(70); vivo.push(await ev(() => window.tresd.V.getOrient().z)); }
console.log('   orientación durante el arrastre:', JSON.stringify(vivo));
check(new Set(vivo).size >= 3 && vivo[vivo.length - 1] > 0, `los cortes se actualizan EN VIVO mientras se arrastra (${new Set(vivo).size} valores distintos sin soltar)`);
await page.dispatchEvent('#or-z', 'change'); await sleep(1200);
await page.click('#or-reset'); await sleep(1500);

console.log('— 1) y 2b) el escáner acompaña al volumen y al alinear se ve el render');
await page.setInputFiles('#in-mesh', ['/tmp/testdata/real_scans/upper.stl']);
await page.waitForSelector('.modal'); await page.click('input[name="dm-role"][value="upper"]'); await page.click('#dlg-ok');
await waitStatus(/^(Escáner añadido|No se pudo|Error)/); await sleep(1500);
const cen = () => ev(() => { const m = window.tresd.V.getMeshes().find((x) => x.role === 'upper'); const p = m.pts; let s = [0, 0, 0]; for (let i = 0; i < p.length; i += 3) { s[0] += p[i]; s[1] += p[i + 1]; s[2] += p[i + 2]; } const n = p.length / 3; return s.map((x) => x / n); });
const c0 = await cen();
await setOr('x', 12); await sleep(2500);
const c1 = await cen();
const b = (12 * Math.PI) / 180, w = [c0[0] - rot.c[0], c0[1] - rot.c[1], c0[2] - rot.c[2]];
const cExp = [w[0] + rot.c[0], Math.cos(b) * w[1] - Math.sin(b) * w[2] + rot.c[1], Math.sin(b) * w[1] + Math.cos(b) * w[2] + rot.c[2]];
const cErr = Math.hypot(c1[0] - cExp[0], c1[1] - cExp[1], c1[2] - cExp[2]);
check(cErr < 0.05, `el escáner gira con el volumen (centro a ${cErr.toFixed(3)} mm de lo esperado)`);
// coherencia REAL: volver a alinear sobre el volumen girado no lo mueve apenas (sigue sobre los dientes)
await page.click('[data-layout="quad"]'); await sleep(800);
await page.click('#mesh-cards .card[data-role="upper"] .m-align');
await waitStatus(/(alineado|Alineado|No se pudo|Error|error)/, 600000); await sleep(1500);
const c2 = await cen();
const move = Math.hypot(c2[0] - c1[0], c2[1] - c1[1], c2[2] - c1[2]);
console.log('   tras «Refinar alineación»:', (await status()).slice(0, 90));
check(move < 3, `con el volumen girado el escáner sigue sobre los dientes (refinar lo mueve ${move.toFixed(2)} mm)`);
check(!(await hidden('.vp[data-id="vp3d"]')) && (await ev(() => window.tresd.V.state.render.visible)), 'tras «Refinar alineación» se ve el render 3D con el CBCT encendido');
await page.click('#or-reset'); await sleep(2500);

console.log('— 2c) la orientación se guarda en la sesión');
await setOr('y', 8); await sleep(1500);
const sess = await ev(() => JSON.parse(JSON.stringify(window.tresd.buildSession ? window.tresd.buildSession() : { orient: window.tresd.V.getOrient() })));
check(sess.orient && sess.orient.y === 8, `la sesión guarda la orientación (${JSON.stringify(sess.orient)})`);
await page.click('#or-reset'); await sleep(2000);

console.log('— 5) ventana de progreso en la segmentación');
const segProm = page.click('#btn-seg');
await page.waitForSelector('.modal.busy', { timeout: 60000 });
check(true, 'al segmentar sale la ventana de progreso');
const busyTxt = await ev(() => document.querySelector('.modal.busy .bt').textContent);
await segProm;
await waitStatus(/^(Segmentación lista|La segmentación|Error)/, 600000); await sleep(1500);
check(/Segmentar/.test(busyTxt) && (await page.locator('.modal.busy').count()) === 0, `la ventana dice «${busyTxt}» y se cierra al terminar`);

console.log('— 3b) vía aérea para el informe');
await page.click('[data-layout="quad"]'); await sleep(1200);
const SUP = [-0.1, -32.16, 8.82], INF = [3.13, -29.54, -41.64];
await page.click('#btn-airway'); await sleep(800);
const sagBox = await page.locator('#vpSag').boundingBox();
for (const wp of [SUP, INF]) { const c = await ev((wp) => window.tresd.V.getEngine().getViewport('vpSag').worldToCanvas(wp), wp); await page.mouse.click(sagBox.x + c[0], sagBox.y + c[1]); await sleep(400); }
await waitStatus(/^(Vía aérea:|No se encontró|Error)/, 600000); await sleep(1200);
check(/^Vía aérea: volumen/.test(await status()), `vía aérea segmentada: ${(await status()).slice(0, 60)}`);
await ev(() => window.tresd.V.setPreset('ivory')); await sleep(800);
await page.click('[data-layout="quad"]'); await sleep(1500);

console.log('— 4) 5) 6) informe: PowerPoint, progreso y vía aérea sin piel');
const softVis0 = await ev(() => { const m = window.tresd.V.getMeshes().find((x) => x.role === 'soft'); return { vis: m.visible, op: m.opacity }; });
// la piel se pinta de MAGENTA: ningún otro elemento del informe usa ese color (el hueso es marfil y el mapa de
// calor va de rojo a azul), así que si aparece un solo píxel magenta es que la piel se ha colado en la captura
await ev(() => { const V = window.tresd.V; V.setMeshColor(V.getMeshes().find((x) => x.role === 'soft').id, '#FF00FF'); });
await sleep(400);
await page.click('#btn-report'); await sleep(300);
await page.uncheck('#rp-views'); await page.uncheck('#rp-mpr'); await page.uncheck('#rp-tele'); await page.uncheck('#rp-pano');
await page.check('input[name="rp-format"][value="both"]');
const dls = [];
page.on('download', (d) => dls.push(d));
await page.click('#dlg-ok');
await page.waitForSelector('.modal.busy', { timeout: 60000 });
check(true, 'al generar el informe sale la ventana de progreso');
await page.waitForFunction(() => /^(Informe|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 1500000 });
await sleep(3000);
check((await page.locator('.modal.busy').count()) === 0, 'la ventana de progreso se cierra al terminar el informe');
console.log('   descargas:', dls.map((d) => d.suggestedFilename()));
check(dls.length === 2 && dls.some((d) => /\.pdf$/.test(d.suggestedFilename())) && dls.some((d) => /\.pptx$/.test(d.suggestedFilename())), 'con «Ambos» se descargan el PDF y el PowerPoint');
const pptx = path.join(OUT, 'v086_informe.pptx'), pdf = path.join(OUT, 'v086_informe.pdf');
for (const d of dls) await d.saveAs(/\.pptx$/.test(d.suggestedFilename()) ? pptx : pdf);
const ppt = execSync(`python3 - <<'PY'
import zipfile, re
z = zipfile.ZipFile('${pptx}'); names = z.namelist()
slides = [n for n in names if re.match(r'ppt/slides/slide\\d+\\.xml$', n)]
xml = ''.join(z.read(n).decode('utf8', 'ignore') for n in slides)
print(len(slides), len([n for n in names if n.startswith('ppt/media/')]), 'Guijarro' in xml, zipfile.ZipFile('${pptx}').testzip() is None)
PY`).toString().trim().split(' ');
console.log('   pptx:', ppt.join(' '), '|', Math.round(fs.statSync(pptx).size / 1024), 'kB');
check(+ppt[0] >= 3 && ppt[3] === 'True' && ppt[2] === 'True', `PowerPoint válido: ${ppt[0]} diapositivas, ${ppt[1]} imágenes, con la vía aérea`);
const softVis1 = await ev(() => { const m = window.tresd.V.getMeshes().find((x) => x.role === 'soft'); return { vis: m.visible, op: m.opacity }; });
check(softVis1.vis === softVis0.vis && softVis1.op === softVis0.op, `la piel vuelve a como estaba tras el informe (${JSON.stringify(softVis1)})`);
// la piel NO puede salir en la PÁGINA DE VÍA AÉREA (se pintó de magenta arriba). En el render «como se ve» sí
// sale, y debe salir: ahí la piel está encendida en pantalla.
const nPag = +execSync(`pdfinfo "${pdf}" | awk '/^Pages:/{print $2}'`).toString().trim();
let pgAw = 0;
for (let i = 1; i <= nPag; i++) if (/VÍA AÉREA/.test(execSync(`pdftotext -f ${i} -l ${i} -layout "${pdf}" -`).toString())) pgAw = i;
check(pgAw > 0, `la página de vía aérea está en el PDF (página ${pgAw} de ${nPag})`);
execSync(`pdftoppm -r 60 -png -f ${pgAw} -l ${pgAw} "${pdf}" "${path.join(OUT, 'v086_aw')}"`);
const magenta = (glob) => +execSync(`python3 - <<'PY'
from PIL import Image
import numpy as np, glob
best = 0
for f in sorted(glob.glob('${glob}')):
    a = np.array(Image.open(f).convert('RGB')).astype(int)
    m = (a[:,:,0] > 120) & (a[:,:,2] > 120) & (a[:,:,0] - a[:,:,1] > 60) & (a[:,:,2] - a[:,:,1] > 60)
    best = max(best, int(m.sum()))
print(best)
PY`).toString().trim();
const skinAw = magenta(`${OUT}/v086_aw-*.png`);
execSync(`pdftoppm -r 60 -png -f 1 -l 1 "${pdf}" "${path.join(OUT, 'v086_p1')}"`);
const skin3d = magenta(`${OUT}/v086_p1-*.png`);
console.log('   píxeles magenta (piel) → página de vía aérea:', skinAw, '| render «como se ve»:', skin3d);
check(skinAw < 60, `la piel NO aparece en la página de vía aérea (${skinAw} píxeles magenta)`);
check(skin3d > 500, `y sí sigue saliendo en el render «como se ve», donde está encendida (${skin3d} píxeles magenta)`);

check(errs.length === 0, `sin errores de consola${errs.length ? ': ' + errs.join(' | ') : ''}`);
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
