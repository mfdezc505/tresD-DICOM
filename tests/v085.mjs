// Comprobaciones de v0.8.5 (peticiones de Manuel del 17-09-2026):
//  Z) ZIP: descompresión en un Worker (sin un worker por archivo), ZIP dentro de ZIP, ZIP con carpeta y DICOMDIR,
//     y aviso con lo leído cuando el ZIP no trae DICOM
//  1) al importar un escáner se activa la vista del render (visor 3D a la vista y volumen encendido)
//  2) render 3D sin fondo (PNG con transparencia) en el informe
//  3) página de vía aérea en el informe (vista lateral, mapa de calor, valores, norma y referencia)
//  4) informe en PDF, PowerPoint o ambos
//  5) manifest de aplicación instalable con file_handlers (.tresdz / .tresd) y sello de versión con hash
// Uso: node tests/v085.mjs  (necesita /tmp/testdata/cbct_half, cbct_half.zip, cbct_dicomdir, real_scans/upper.stl;
//      poppler-utils; Pillow; zip)
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
await new Promise((r) => server.listen(8798, r));
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
const py = (code) => execSync(`python3 - <<'PY'\n${code}\nPY`).toString().trim();

// ZIPs de prueba: anidado (zip dentro de zip), carpeta con DICOMDIR (nombre con tilde) y uno sin DICOM
const ZT = '/tmp/testdata/ziptest_v085'; fs.rmSync(ZT, { recursive: true, force: true }); fs.mkdirSync(path.join(ZT, 'tmp', 'Paciente Pérez'), { recursive: true });
execSync(`cd ${ZT} && zip -qj anidado.zip /tmp/testdata/cbct_half.zip && cp -r /tmp/testdata/cbct_dicomdir/* "tmp/Paciente Pérez/" && cd tmp && zip -qr ../dicomdir_carpeta.zip "Paciente Pérez" && cd .. && zip -qj sin_dicom.zip /tmp/testdata/real_scans/pose.json ${ROOT}/LEEME.md`);

console.log('— 5) manifest instalable y sello con hash');
const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
check(/<link rel="manifest" href="\.\/manifest\.webmanifest">/.test(html) && /\?v=\d+\.\d+\.\d+-[0-9a-f]{8}/.test(html), 'index.html enlaza el manifest y sella los assets con versión + hash');
const man = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));
check(man.file_handlers && man.file_handlers[0].accept && Object.values(man.file_handlers[0].accept).flat().includes('.tresdz') && man.icons.length >= 2 && man.display === 'standalone', 'manifest con file_handlers (.tresdz / .tresd), iconos y ventana propia');
await page.goto('http://localhost:8798/'); await sleep(600);
const manResp = await ev(async () => { const r = await fetch('./manifest.webmanifest'); return r.ok ? (await r.json()).short_name : null; });
check(manResp === 'tresD DICOM', 'el manifest se sirve junto a la web');

console.log('— Z) ZIP dentro de ZIP');
await page.setInputFiles('#in-zip', [path.join(ZT, 'anidado.zip')]);
await waitStatus(/^(Cargado|Aviso|Error|No se)/); await sleep(500);
check(/^Cargado: CBCT .*217 cortes/.test(await status()), `ZIP anidado: ${(await status()).slice(0, 60)}`);
check((await ev(() => window.tresd.V.state.volume.imageData.getDimensions()[0])) === 334, 'el CBCT del ZIP anidado se carga entero');

console.log('— 1) importar un escáner desde un corte a solas activa el render');
await page.click('[data-layout="vpAx"]'); await sleep(800);
await page.uncheck('#dicom-vis'); await sleep(300);
check(!(await ev(() => window.tresd.V.state.render.visible)) && (await ev(() => document.querySelector('.vp[data-id="vp3d"]').classList.contains('hidden'))), 'de partida: axial a solas y volumen apagado');
await page.setInputFiles('#in-mesh', ['/tmp/testdata/real_scans/upper.stl']);
await page.waitForSelector('.modal'); await page.click('input[name="dm-role"][value="upper"]'); await page.click('#dlg-ok');
await waitStatus(/^(Escáner añadido|No se pudo|Error)/); await sleep(1500);
check(!(await ev(() => document.querySelector('.vp[data-id="vp3d"]').classList.contains('hidden'))) && (await ev(() => document.querySelector('.vp[data-id="vpAx"]').classList.contains('hidden'))), 'tras importar, el visor 3D a la vista (a solas)');
check((await ev(() => window.tresd.V.state.render.visible)) && await page.isChecked('#dicom-vis'), 'y el volumen encendido');

console.log('— 2) captura del 3D sin fondo');
await page.click('[data-view="frontal"]'); await sleep(1500);
const png = await ev(() => window.tresd.V.shot3DAlpha(800));
check(typeof png === 'string' && png.startsWith('data:image/png'), 'shot3DAlpha devuelve un PNG');
fs.writeFileSync(path.join(OUT, 'v085_alpha.png'), Buffer.from(png.split(',')[1], 'base64'));
const alpha = py(`from PIL import Image
im = Image.open('${path.join(OUT, 'v085_alpha.png')}').convert('RGBA'); w, h = im.size; a = im.split()[3]
print(a.getpixel((3, 3)), max(a.getpixel((w // 2, h // 2 + d)) for d in range(-20, 21, 5)), w, h)`).split(' ').map(Number);
check(alpha[0] === 0 && alpha[1] > 200, `esquina transparente (alfa ${alpha[0]}) y anatomía opaca en el centro (alfa ${alpha[1]}), ${alpha[2]}×${alpha[3]} px`);
const bgBack = await ev(() => { const vp = window.tresd.V.getEngine().getViewport('vp3d'); return vp.getRenderer().getBackground().slice(0, 3).map((v) => +v.toFixed(2)); });
check(bgBack[0] < 0.2 && bgBack[1] < 0.2, `el fondo del visor vuelve al del tema (${bgBack.join(',')})`);

console.log('— 3) vía aérea');
await page.click('[data-layout="quad"]'); await sleep(1200);
const SUP = [-0.1, -32.16, 8.82], INF = [3.13, -29.54, -41.64];
await page.click('#btn-airway'); await sleep(800);
const sagBox = await page.locator('#vpSag').boundingBox();
for (const w of [SUP, INF]) { const c = await ev((w) => window.tresd.V.getEngine().getViewport('vpSag').worldToCanvas(w), w); await page.mouse.click(sagBox.x + c[0], sagBox.y + c[1]); await sleep(400); }
await waitStatus(/^(Vía aérea:|No se encontró|Error)/); await sleep(1000);
check(/^Vía aérea: volumen/.test(await status()), `vía aérea segmentada: ${(await status()).slice(0, 80)}`);
await ev(() => window.tresd.V.setPreset('ivory')); await sleep(800);
await page.click('[data-layout="quad"]'); await sleep(1500);

console.log('— 2-4) informe: PDF con PNG sin fondo y página de vía aérea; PowerPoint; ambos');
await page.click('#btn-report'); await sleep(300);
check((await page.locator('input[name="rp-format"]').count()) === 3 && (await ev(() => document.querySelector('input[name="rp-format"]:checked').value)) === 'pdf', 'formato: PDF (por defecto) / PowerPoint / Ambos');
check(await page.isChecked('#rp-png') && await page.isEnabled('#rp-airway') && await page.isChecked('#rp-airway'), 'casillas «render sin fondo» (marcada) y «vía aérea» (disponible y marcada)');
await page.uncheck('#rp-mpr'); await page.uncheck('#rp-tele'); await page.uncheck('#rp-pano');
await page.check('input[name="rp-format"][value="both"]');
const dls = [];
page.on('download', (d) => dls.push(d));
await page.click('#dlg-ok');
await page.waitForFunction(() => /^(Informe|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 1500000 });   // SwiftShader: 5 capturas del 3D por duplicado (alfa) + vía aérea translúcida = varios minutos
await sleep(2500);
console.log('   estado:', (await status()).slice(0, 80), '| descargas:', dls.map((d) => d.suggestedFilename()));
check(dls.length === 2 && dls.some((d) => /\.pdf$/.test(d.suggestedFilename())) && dls.some((d) => /\.pptx$/.test(d.suggestedFilename())), 'con «Ambos» se descargan el PDF y el PowerPoint');
const pdf = path.join(OUT, 'v085_informe.pdf'), pptx = path.join(OUT, 'v085_informe.pptx');
for (const d of dls) await d.saveAs(/\.pdf$/.test(d.suggestedFilename()) ? pdf : pptx);
const tx = execSync(`pdftotext -layout "${pdf}" -`).toString();
check(/Vía aérea faríngea/i.test(tx) && /Volumen faríngeo/.test(tx) && /Área mínima/.test(tx) && /Guijarro/.test(tx) && /Norma/.test(tx), 'página de vía aérea: título, valores, norma y referencia');
const imgs = execSync(`pdfimages -list "${pdf}"`).toString();
const nSmask = (imgs.match(/\bsmask\b/g) || []).length;
check(nSmask >= 4, `${nSmask} imágenes con transparencia (smask) en el PDF: render como se ve, 3 vistas y vía aérea`);
execSync(`pdftoppm -r 40 -png "${pdf}" "${path.join(OUT, 'v085_pdf')}"`);
const pptInfo = py(`import zipfile, re
z = zipfile.ZipFile('${pptx}'); names = z.namelist()
slides = [n for n in names if re.match(r'ppt/slides/slide\\d+\\.xml$', n)]
media = [n for n in names if n.startswith('ppt/media/')]
xml = ''.join(z.read(n).decode('utf8', 'ignore') for n in slides)
print(len(slides), len(media), 'tresD DICOM' in xml, 'Guijarro' in xml, 'INFORME' in xml.upper())`).split(' ');
console.log('   pptx:', pptInfo.join(' '));
check(+pptInfo[0] >= 6 && +pptInfo[1] >= 4 && pptInfo[2] === 'True' && pptInfo[3] === 'True', `PowerPoint válido: ${pptInfo[0]} diapositivas, ${pptInfo[1]} imágenes, con pie y vía aérea`);
// el visor queda como estaba tras la página de vía aérea (mallas y volumen)
const after = await ev(() => { const V = window.tresd.V; const up = V.getMeshes().find((m) => m.role === 'upper'); return { meshes: V.getMeshes().map((m) => m.role), up: up ? up.opacity : null, aw: V.airwayMesh().opacity, vol: V.state.render.visible, op: V.state.render.opacity }; });
check(after.up === 1 && after.aw === 1 && after.vol && after.op === 1, `tras el informe todo vuelve a como estaba (${JSON.stringify(after)})`);

console.log('— 4b) solo PowerPoint');
dls.length = 0;
await page.click('#btn-report'); await sleep(300);
await page.uncheck('#rp-views'); await page.uncheck('#rp-mpr'); await page.uncheck('#rp-tele'); await page.uncheck('#rp-pano'); await page.uncheck('#rp-airway');
await page.check('input[name="rp-format"][value="pptx"]');
await page.click('#dlg-ok');
await page.waitForFunction(() => /^(Informe|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 1500000 });   // SwiftShader: 5 capturas del 3D por duplicado (alfa) + vía aérea translúcida = varios minutos
await sleep(2000);
check(dls.length === 1 && /\.pptx$/.test(dls[0].suggestedFilename()), `con «PowerPoint» solo se descarga el .pptx (${dls.map((d) => d.suggestedFilename())})`);

console.log('— Z) ZIP con carpeta + DICOMDIR y ZIP sin DICOM');
await page.goto('http://localhost:8798/'); await sleep(600);
await page.setInputFiles('#in-zip', [path.join(ZT, 'dicomdir_carpeta.zip')]);
await waitStatus(/^(Cargado|Aviso|Error|No se)/); await sleep(300);
check(/^Cargado: CBCT .*217 cortes/.test(await status()), `ZIP con carpeta «Paciente Pérez» y DICOMDIR: ${(await status()).slice(0, 50)}`);
await page.goto('http://localhost:8798/'); await sleep(600);
await page.setInputFiles('#in-zip', [path.join(ZT, 'sin_dicom.zip')]);
await page.waitForFunction(() => /^(Cargado|Aviso|Error|No se|Escáner)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 }); await sleep(300);
console.log('   sin DICOM:', (await status()).slice(0, 120));
check(/^No se encontr.*archivos leídos, p\. ej\. (pose\.json|LEEME\.md)/.test(await status()), 'un ZIP sin DICOM: el estado dice cuántos archivos se leyeron y ejemplos');

console.log('— Z) ZIP con otra extensión (por la firma), RAR (WinRAR) y 7z (aviso)');
fs.copyFileSync('/tmp/testdata/cbct_half.zip', path.join(ZT, 'paciente.dat'));
execSync(`cd /tmp/testdata && rar a -r -inul ${ZT}/paciente.rar cbct_dicomdir`);
fs.writeFileSync(path.join(ZT, 'paciente.7z'), Buffer.concat([Buffer.from('7z\xbc\xaf\x27\x1c', 'latin1'), Buffer.alloc(4000)]));
await page.goto('http://localhost:8798/'); await sleep(600);
await page.setInputFiles('#in-session', [path.join(ZT, 'paciente.dat')]);
await waitStatus(/^(Cargado|Aviso|Error|No se|Ese archivo)/); await sleep(300);
check(/^Cargado: CBCT .*217 cortes/.test(await status()), `un ZIP renombrado (.dat) por «📂 Abrir» se reconoce por su firma: ${(await status()).slice(0, 40)}`);
await page.goto('http://localhost:8798/'); await sleep(600);
await page.setInputFiles('#in-session', [path.join(ZT, 'paciente.rar')]);
await waitStatus(/^(Cargado|Aviso|Error|No se|Ese archivo|«)/); await sleep(300);
check(/^Cargado: CBCT .*217 cortes/.test(await status()), `un RAR de WinRAR (con DICOMDIR) se abre por «📂 Abrir»: ${(await status()).slice(0, 40)}`);
await page.goto('http://localhost:8798/'); await sleep(600);
await page.setInputFiles('#in-zip', [path.join(ZT, 'paciente.7z')]);
await page.waitForFunction(() => /7Z|Ese archivo|Error|No se/.test(document.querySelector('#status-text').textContent), null, { timeout: 60000 });
check(/es un archivo 7Z: el visor abre ZIP y RAR/.test(await status()), `un 7z se explica: «${(await status()).slice(0, 70)}»`);
check(/RAR/.test(await ev(() => document.querySelector('#btn-zip').textContent)) && /\.rar/.test(await ev(() => document.querySelector('#in-zip').accept)), 'el botón dice «Subir ZIP / RAR» y acepta .rar');

check(errs.length === 0, `sin errores de consola${errs.length ? ': ' + errs.join(' | ') : ''}`);
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
