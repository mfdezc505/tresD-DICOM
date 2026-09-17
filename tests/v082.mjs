// Comprobaciones de v0.8.2 (peticiones de Manuel del 16-09-2026):
//  1) regla de 50 mm con marcas cada 5 mm sobre la TeleRx (en pantalla, en la captura y en el informe)
//  2) deslizadores verticales para recorrer los cortes axial, coronal y sagital (tabletas / ratón sin rueda)
//  3) «Alinear por puntos» desde el 2×2 con un escáner ya alineado: el modelo NO sale cortado (los límites
//     cacheados de los puntos se quedaban viejos tras moverlos → planos de recorte estrechos)
//  4) el botón «⌖ Alinear al CBCT» pasa a llamarse «⌖ Refinar alineación»
//  5) el informe se descarga como PDF con el render ampliado (frontal, derecha, izquierda) y la TeleRx lateral
//     (se calcula sola si no se había abierto; si se ve la frontal, van las dos)
// Uso: node tests/v082.mjs
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
await new Promise((r) => server.listen(8790, r));
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

await page.goto('http://localhost:8790/'); await sleep(600);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await waitStatus(/^(Cargado|Aviso)/); await sleep(2000);

console.log('— 2) deslizadores de corte');
const sliders = await ev(() => [...document.querySelectorAll('.vslice')].map((s) => { const r = s.getBoundingClientRect(); return { vp: s.dataset.vp, max: +s.max, value: +s.value, hidden: s.classList.contains('hidden'), dir: s.style.direction, w: Math.round(r.width), h: Math.round(r.height), vertical: r.height > r.width * 3 }; }));
check(sliders.length === 3 && sliders.every((s) => !s.hidden && s.vertical && s.max > 100), `tres deslizadores verticales visibles: ${JSON.stringify(sliders.map((s) => [s.vp, s.max, s.value, s.h]))}`);
const slAx = sliders.find((s) => s.vp === 'vpAx');
check(slAx && Math.abs(slAx.value - slAx.max / 2) <= 1, 'el axial empieza en el corte central');
const z0 = (await ev(() => window.tresd.V.viewportFocal('vpAx')))[2];
const n0 = await ev(() => document.querySelector('.vp[data-id="vpAx"] .vpinfo').textContent.split('\n')[0]);
await ev(() => { const s = document.querySelector('.vp[data-id="vpAx"] .vslice'); s.value = String(Math.round(+s.max * 0.25)); s.dispatchEvent(new Event('input', { bubbles: true })); });
await sleep(1500);
const z1 = (await ev(() => window.tresd.V.viewportFocal('vpAx')))[2];
const n1 = await ev(() => document.querySelector('.vp[data-id="vpAx"] .vpinfo').textContent.split('\n')[0]);
check(Math.abs(z1 - z0) > 20 && n0 !== n1, `mover el deslizador cambia el corte axial (${n0} → ${n1}; z ${z0.toFixed(1)} → ${z1.toFixed(1)} mm)`);
// la rueda mueve el deslizador (sincronía en el otro sentido)
const bAx = await page.locator('#vpAx').boundingBox();
await page.mouse.move(bAx.x + bAx.width / 2, bAx.y + bAx.height / 2);
for (let k = 0; k < 10; k++) { await page.mouse.wheel(0, 120); await sleep(60); }
await sleep(1200);
const v2 = await ev(() => +document.querySelector('.vp[data-id="vpAx"] .vslice').value);
check(Math.abs(v2 - Math.round(slAx.max * 0.25)) >= 5, `la rueda mueve también el deslizador (${Math.round(slAx.max * 0.25)} → ${v2})`);
// sentido: en el axial, arriba = superior
const dirAx = await ev(() => { const s = document.querySelector('.vp[data-id="vpAx"] .vslice'); const n = window.tresd.V.viewPlaneNormal('vpAx'); return { dir: s.style.direction, nz: n[2] }; });
check((dirAx.nz > 0) === (dirAx.dir === 'rtl'), `el extremo superior del deslizador axial es el corte más alto (normal z ${dirAx.nz.toFixed(0)}, dirección ${dirAx.dir})`);
check((await ev(() => getComputedStyle(document.querySelector('.vp[data-id="vpAx"] .orient.r')).right)) === '30px', 'la letra de orientación derecha deja sitio al deslizador');
await shot('v082_deslizadores.png');

console.log('— 4) «Refinar alineación» y 3) alinear por puntos sin modelo cortado');
await page.setInputFiles('#in-mesh', ['/tmp/testdata/meshes/arch_upper.stl']);
await page.waitForSelector('.modal'); await page.click('input[name="dm-role"][value="upper"]'); await page.click('#dlg-ok');
await waitStatus(/^(Escáner añadido|No se pudo|Error)/); await sleep(1000);
check((await ev(() => document.querySelector('#mesh-cards .card[data-role="upper"] .m-align').textContent.trim())) === '⌖ Refinar alineación', 'el botón de la tarjeta se llama «⌖ Refinar alineación»');
// los límites de la malla (cacheados por vtk.js) coinciden con sus puntos tras haberla movido al alinearla
const bb = await ev(() => { const m = window.tresd.V.getMeshes()[0]; const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < m.pts.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.pts[i + k]); hi[k] = Math.max(hi[k], m.pts[i + k]); } const b = m.polydata.getBounds(); return { d: Math.max(...[0, 1, 2].map((k) => Math.max(Math.abs(b[2 * k] - lo[k]), Math.abs(b[2 * k + 1] - hi[k])))), b: b.map((v) => +v.toFixed(0)) }; });
check(bb.d < 0.01, `los límites del modelo están al día tras alinearlo (desvío ${bb.d.toFixed(3)} mm; ${bb.b.join(' ')})`);
check((await ev(() => document.querySelector('#grid').dataset.layout)) === 'quad', 'se parte del 2×2 (como Manuel)');
await page.click('#mesh-cards .card[data-role="upper"] .m-points'); await sleep(2500);
check(await page.locator('.vp[data-id="vp3d"]').isVisible() && await page.locator('.vp[data-id="vpAx"]').isHidden(), 'el render pasa a pantalla completa');
// píxeles del modelo con los planos de recorte que ha dejado el visor frente a unos planos «infinitos»
const b3 = await page.locator('#vp3d').boundingBox();
const clipArea = { x: b3.x, y: b3.y + 90, width: b3.width, height: b3.height - 90 };
const count = (buf) => { const png = buf; return png.length; };
const pixels = async (name) => { const buf = await page.screenshot({ clip: clipArea }); fs.writeFileSync(path.join(OUT, name), buf); return +execSync(`python3 -c "from PIL import Image; import numpy as np; a=np.array(Image.open('${path.join(OUT, name)}').convert('RGB')).astype(int); bg=a[5,5]; print((np.abs(a-bg).sum(axis=2)>40).sum())"`).toString(); };
const shown = await pixels('v082_pa_modelo.png');
const cr0 = await ev(() => window.tresd.V.getEngine().getViewport('vp3d').getRenderer().getActiveCamera().getClippingRange().map((v) => +v.toFixed(1)));
await ev(() => { const vp = window.tresd.V.getEngine().getViewport('vp3d'); vp.getRenderer().getActiveCamera().setClippingRange(1, 9000); vp.render(); }); await sleep(800);
const full = await pixels('v082_pa_modelo_ref.png');
check(shown > 2000 && Math.abs(shown - full) / full < 0.02, `el modelo se ve ENTERO al empezar a alinear por puntos (${shown} px frente a ${full} con planos infinitos; recorte ${cr0.join('…')})`);
await page.keyboard.press('Escape'); await sleep(800);

console.log('— 1) regla de 5 mm sobre la TeleRx');
await page.click('[data-layout="vpTele"]');
await waitStatus(/^TeleRx Lateral/, 180000); await sleep(600);
const ruler = await ev(() => {
  const cv = document.querySelector('#tele-canvas'), g = cv.getContext('2d');
  const img = window.tresd.V.state.tele.image, z = cv._imgZoom || 1, pxmm = z / img.step;
  // zona de la regla: 4 mm de margen, 50 mm de largo (+ cifras), abajo a la izquierda
  const x0 = Math.round(2 * pxmm), y0 = Math.round(cv.height - 60 * pxmm), w = Math.round(58 * pxmm), h = Math.round(58 * pxmm);
  const d = g.getImageData(x0, y0, w, h).data;
  let yellow = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 170 && d[i + 2] < 140) yellow++;
  // y en el resto de la imagen no hay amarillo (la regla está solo en su esquina)
  const d2 = g.getImageData(Math.round(cv.width * 0.5), 0, Math.round(cv.width * 0.5), Math.round(cv.height * 0.5)).data;
  let other = 0; for (let i = 0; i < d2.length; i += 4) if (d2[i] > 200 && d2[i + 1] > 170 && d2[i + 2] < 140) other++;
  // longitud real de la escala horizontal: primer y último píxel amarillo de la fila del eje
  const yAxis = Math.round(cv.height - 4 * pxmm); const row = g.getImageData(0, yAxis - 1, cv.width, 3).data;
  let xa = -1, xb = -1; for (let x = 0; x < cv.width; x++) { for (let r = 0; r < 3; r++) { const i = 4 * (r * cv.width + x); if (row[i] > 200 && row[i + 1] > 170 && row[i + 2] < 140) { if (xa < 0) xa = x; xb = x; } } }
  return { yellow, other, lenMm: (xb - xa) / pxmm, pxmm };
});
check(ruler.yellow > 300 && ruler.other === 0, `la regla amarilla está abajo a la izquierda (${ruler.yellow} píxeles) y no en el resto (${ruler.other})`);
check(Math.abs(ruler.lenMm - 50) < 1.5, `la escala horizontal mide 50 mm a escala 1:1 (${ruler.lenMm.toFixed(1)} mm)`);
await shot('v082_regla.png');
// la captura PNG también la lleva (se compone a partir del mismo canvas)
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#btn-shot')]);
const shotFile = path.join(OUT, 'v082_captura.png'); await dl.saveAs(shotFile);
const yellowShot = +execSync(`python3 -c "from PIL import Image; import numpy as np; a=np.array(Image.open('${shotFile}').convert('RGB')).astype(int); print(((a[:,:,0]>200)&(a[:,:,1]>170)&(a[:,:,2]<140)).sum())"`).toString();
check(yellowShot > 300, `la captura PNG incluye la regla (${yellowShot} píxeles amarillos)`);

console.log('— 5) informe PDF desde la vista frontal: TeleRx lateral + frontal y el render ampliado');
await page.click('#tele-pa'); await waitStatus(/^TeleRx Frontal/, 120000); await sleep(400);
await page.click('#btn-report'); await sleep(300);
await page.uncheck('#rp-mpr');
const [dlp] = await Promise.all([page.waitForEvent('download', { timeout: 1500000 }), page.click('#dlg-ok')]);
const pdfFile = path.join(OUT, 'v082_informe.pdf'); await dlp.saveAs(pdfFile);
const tx = execSync(`pdftotext -layout "${pdfFile}" -`).toString();
check(/\.pdf$/.test(dlp.suggestedFilename()) && fs.readFileSync(pdfFile).slice(0, 5).toString() === '%PDF-', `PDF descargado «${dlp.suggestedFilename()}» (${Math.round(fs.statSync(pdfFile).size / 1024)} kB)`);
for (const cap of ['Render 3D · Frontal', 'Render 3D · Derecha', 'Render 3D · Izquierda', 'TeleRx lateral · Radiografía', 'TeleRx frontal (pa) · Radiografía']) check(tx.includes(cap), `figura «${cap}»`);
check(!/\bAxial\b/.test(tx), 'sin los cortes (casilla desmarcada)');
// v0.8.5: el render 3D va como PNG con transparencia (smask); el resto sigue en JPEG
const imgList = execSync(`pdfimages -list "${pdfFile}"`).toString();
const nImg = (imgList.match(/\bjpeg\b/g) || []).length, nPng = (imgList.match(/\bsmask\b/g) || []).length;
check(nImg + nPng >= 7 && nPng >= 4, `${nImg} imágenes JPEG + ${nPng} PNG sin fondo (logotipo, 3D, 3 vistas, 4 TeleRx)`);
check((await ev(() => window.tresd.V.state.tele.view)) === 'pa' && await page.locator('.vp[data-id="vpTele"]').isVisible(), 'al terminar sigue la TeleRx frontal en pantalla');
// vista previa del PDF para el registro
try { execSync(`pdftoppm -r 40 -png -f 1 -l 3 "${pdfFile}" "${path.join(OUT, 'v082_pdf')}"`); } catch (e) { /* sin poppler */ }

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
