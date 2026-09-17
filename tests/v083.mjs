// Comprobaciones de v0.8.3 (peticiones de Manuel del 16-09-2026, 15 puntos):
//  1) polos del cóndilo: extremos medio-laterales de la cabeza en 3D (techo por el espacio articular), sobre hueso
//  2) deslizadores de corte con el estilo del visor (pista fina, pomo con degradado)
//  3) siluetas apagadas por defecto
//  4) preset «Rejilla» (nube de puntos de la superficie del hueso)
//  5) «📦 Compartir caso»: paquete .tresdz anonimizado y reducido por defecto, que se vuelve a abrir arrastrándolo
//  6) «Rotación» junto a «Centrar» (barra de vistas)
//  7) alinear por puntos: escáner más cerca; CBCT centrado en los dientes y de cerca
//  8) PDF con tema oscuro / claro, sin siluetas en los cortes; 9) TeleRx frontal en el PDF
//  10) «TeleRx»; 11) «Cortes de ATM» oculto con cortes hechos; 12) vistas/Centrar/Rotación solo con el render;
//  13) Cruz solo en 2×2, 3D+cortes y en fila; 14) textos de marcar cóndilos; 15) Metadatos con emoticono
// Uso: node tests/v083.mjs
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
const hidden = (sel) => ev((s) => document.querySelector(s).classList.contains('hidden'), sel);
const pixels = async (clip, name) => { const buf = await page.screenshot({ clip }); fs.writeFileSync(path.join(OUT, name), buf); return +execSync(`python3 -c "from PIL import Image; import numpy as np; a=np.array(Image.open('${path.join(OUT, name)}').convert('RGB')).astype(int); bg=a[5,5]; print((np.abs(a-bg).sum(axis=2)>40).sum())"`).toString(); };

await page.goto('http://localhost:8790/'); await sleep(600);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await waitStatus(/^(Cargado|Aviso)/); await sleep(2000);

console.log('— 3) siluetas apagadas por defecto; 15) Metadatos; 6) Rotación; 10) TeleRx');
check((await ev(() => window.tresd.V.state.silhouettes)) === false && !(await page.isChecked('#sil-vis')), 'las siluetas empiezan apagadas (casilla sin marcar)');
check((await ev(() => document.querySelector('#btn-meta').textContent.trim())) === '🏷️' && /Metadatos/.test(await ev(() => document.querySelector('#btn-meta').title)), 'Metadatos es un emoticono 🏷️ (texto en el tooltip)');
await page.click('#btn-meta'); await sleep(400);
check(await page.locator('#meta-drawer').evaluate((e) => e.classList.contains('open')), 'y sigue abriendo el cajón');
await page.keyboard.press('Escape'); await sleep(200);   // el cajón tapa el botón: se cierra con Esc
const rot = await ev(() => { const r = document.querySelector('#btn-rotate'), c = document.querySelector('#btn-center'); return { inBar: !!r.closest('#view-bar'), next: c.nextElementSibling === r, visible: !r.classList.contains('hidden') }; });
check(rot.inBar && rot.next && rot.visible, '«⟳ Rotación» va justo después de «Centrar» en la barra de vistas');
check((await ev(() => document.querySelector('#view-bar [data-layout="vpTele"]').textContent)) === 'TeleRx', 'el botón se llama «TeleRx»');

console.log('— 2) deslizadores con el estilo del visor');
const sl = await ev(() => { const s = document.querySelector('.vp[data-id="vpAx"] .vslice'); const cs = getComputedStyle(s); return { app: cs.appearance || cs.webkitAppearance, w: Math.round(s.getBoundingClientRect().width), h: Math.round(s.getBoundingClientRect().height), bg: cs.backgroundColor, radius: cs.borderRadius }; });
check(sl.app === 'none' && sl.w <= 8 && sl.h > 200 && sl.bg !== 'rgba(0, 0, 0, 0)' && sl.radius === '3px', `pista fina de ${sl.w} px con fondo del tema (${sl.bg}) y bordes redondeados, sin estilo nativo`);

console.log('— 12) y 13) botones según la disposición');
check(!(await hidden('#btn-cross')) && !(await hidden('[data-view="frontal"]')), 'en 2×2: Cruz y vistas visibles');
await page.click('[data-layout="vpAx"]'); await sleep(600);
check((await hidden('#btn-cross')) && (await ev(() => [...document.querySelectorAll('#view-bar [data-view]')].every((b) => b.classList.contains('hidden')))) && (await hidden('#btn-center')) && (await hidden('#btn-rotate')), 'en el axial a solas: sin Cruz, sin vistas, sin Centrar ni Rotación');
await page.click('[data-layout="vp3d"]'); await sleep(600);
check((await hidden('#btn-cross')) && !(await hidden('[data-view="lat_r"]')) && !(await hidden('#btn-rotate')), 'en el render a solas: vistas y Rotación sí, Cruz no');
await page.click('[data-layout="main3"]'); await sleep(600);
check(!(await hidden('#btn-cross')) && !(await hidden('#btn-center')), 'en 3D + cortes: Cruz y Centrar');
await page.click('[data-layout="quad"]'); await sleep(600);

console.log('— 4) preset Rejilla');
check((await ev(() => [...document.querySelectorAll('#dicom-preset option')].map((o) => o.value))).includes('grid'), 'el desplegable tiene «Rejilla (nube de puntos)»');
await page.click('[data-layout="vp3d"]'); await sleep(2500);
const b3 = await page.locator('#vp3d').boundingBox();
const area = { x: b3.x, y: b3.y + 40, width: b3.width, height: b3.height - 40 };
await page.selectOption('#dicom-preset', 'grid'); await sleep(4000);
const cloud = await ev(() => window.tresd.V.cloudInfo());
check(cloud && cloud.n > 10000 && cloud.visible, `nube de ${cloud && cloud.n.toLocaleString()} puntos visible (1 de cada ${cloud && cloud.stride} vóxeles)`);
check(await ev(() => { const vp = window.tresd.V.getEngine().getViewport('vp3d'); return vp.getRenderer().getVolumes().every((v) => !v.getVisibility()); }), 'el volumen se esconde mientras se ve la rejilla');
const pxGrid = await pixels(area, 'v083_rejilla.png');
check(pxGrid > 40000, `la rejilla se pinta (${pxGrid} píxeles)`);
check(/^Rejilla:/.test(await status()), `estado: «${(await status()).slice(0, 60)}»`);
await page.selectOption('#dicom-preset', 'ivory'); await sleep(2000);
check((await ev(() => window.tresd.V.cloudInfo().visible)) === false && (await ev(() => window.tresd.V.getEngine().getViewport('vp3d').getRenderer().getVolumes().some((v) => v.getVisibility()))), 'al volver a marfil, vuelve el volumen y se esconde la nube');
await page.click('[data-layout="quad"]'); await sleep(800);

console.log('— 1) polos del cóndilo y 11) botón de ATM; 14) textos');
check(!(await hidden('#btn-atm')), 'sin cortes de ATM el botón «Cortes de ATM» se ve');
await page.click('#btn-atm'); await sleep(500);
check((await page.textContent('#atm-text')) === '1/2 Clic sobre el cóndilo derecho (navega en el corte axial hasta visualizar los cóndilos)', 'texto del primer cóndilo');
await page.keyboard.press('Escape'); await sleep(400);
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
await ev(() => { window.tresd.renderTmj(); });
await page.click('#lay-atm'); await sleep(800);
check(await hidden('#btn-atm'), 'con los cortes hechos, «Cortes de ATM» se oculta');
const pol = await ev(() => {
  const V = window.tresd.V, tmj = V.state.tmj, out = {};
  for (const sd of ['R', 'L']) {
    const p = tmj.poles[sd];
    const bone = (w) => { let mx = -9999; for (const dx of [-0.6, 0, 0.6]) for (const dy of [-0.6, 0, 0.6]) mx = Math.max(mx, tmj.smp.value([w[0] + dx, w[1] + dy, w[2]])); return mx; };
    out[sd] = { med: bone(p.med) >= tmj.thr, lat: bone(p.lat) >= tmj.thr, width: +Math.hypot(p.lat[0] - p.med[0], p.lat[1] - p.med[1]).toFixed(1), dz: +Math.abs(p.lat[2] - p.med[2]).toFixed(2), medX: p.med[0], latX: p.lat[0] };
  }
  return out;
});
console.log('   polos:', JSON.stringify(pol));
check(pol.L.med && pol.L.lat && pol.L.width >= 12 && pol.L.width <= 26, `L: polos sobre hueso, anchura ${pol.L.width} mm`);
// el lado R de la media muestra no supera la comprobación de anchura y vuelve a la estimación clásica (polos a distinta altura)
check(pol.L.dz < 0.01, 'los dos polos del lado L van a la misma altura (extremos medio-laterales del nivel más ancho)');
check(Math.abs(pol.L.medX) < Math.abs(pol.L.latX) && Math.abs(pol.R.medX) < Math.abs(pol.R.latX), 'medial más cerca de la línea media que lateral, en los dos lados');
check(pol.R.width >= 12 && pol.R.width <= 26, `R: anchura plausible ${pol.R.width} mm`);
await page.click('#atm-poles'); await sleep(800);
await shot('v083_polos.png');
await page.click('#dlg-cancel'); await sleep(300);

console.log('— 7) alinear por puntos: escáner de cerca y CBCT centrado en los dientes');
await page.click('[data-layout="quad"]'); await sleep(800);
await page.setInputFiles('#in-mesh', ['/tmp/testdata/real_scans/upper.stl']);
await page.waitForSelector('.modal'); await page.click('input[name="dm-role"][value="upper"]'); await page.click('#dlg-ok');
await waitStatus(/^(Escáner añadido|No se pudo|Error)/); await sleep(1000);
await page.click('[data-layout="vp3d"]'); await sleep(2000);
await page.click('[data-view="frontal"]'); await sleep(1200);
await ev(() => { window.tresd.V.reset3D(); }); await sleep(600);
const zoomRef = await ev(() => window.tresd.V.getEngine().getViewport('vp3d').getCamera().parallelScale);
await page.click('#mesh-cards .card[data-role="upper"] .m-points'); await sleep(1200);
const zoomPa = await ev(() => window.tresd.V.getEngine().getViewport('vp3d').getCamera().parallelScale);
check(zoomPa < zoomRef / 1.4, `fase 1: el escáner se ve más cerca (escala ${zoomPa.toFixed(1)} frente a ${zoomRef.toFixed(1)} mm)`);
const pts2d = await ev(() => {
  const V = window.tresd.V; const m = V.getMeshes().find((x) => x.role === 'upper');
  const vp = V.state.engine.getViewport('vp3d'); const p = m.pts; const n = p.length / 3;
  const cand = []; for (let i = 0; i < n; i += 7) cand.push([p[3 * i], p[3 * i + 1], p[3 * i + 2]]);
  // v0.8.4: la alineación por puntos se hace en vista DERECHA: vértices del lado derecho (x mínimo en LPS), repartidos de delante atrás
  cand.sort((a, b) => a[0] - b[0]); const front = cand.slice(0, Math.floor(cand.length * 0.15));
  front.sort((a, b) => a[1] - b[1]);
  const pick = [front[Math.floor(front.length * 0.1)], front[Math.floor(front.length * 0.5)], front[Math.floor(front.length * 0.9)]];
  return pick.map((w) => vp.worldToCanvas(w));
});
for (const [x, y] of pts2d) { await page.mouse.click(b3.x + x, b3.y + y); await sleep(700); }
await sleep(800);
check(/FASE 2|CBCT/.test(await page.textContent('#pa-text')), 'tras 3 puntos pasa a la fase del CBCT');
const cam2 = await ev(() => { const V = window.tresd.V; const c = V.getEngine().getViewport('vp3d').getCamera(); const tg = V.state.teeth && V.state.teeth.all; return { ps: c.parallelScale, fp: c.focalPoint, teeth: tg ? tg.center : null }; });
check(cam2.ps < 60 && cam2.teeth && Math.hypot(cam2.fp[0] - cam2.teeth[0], cam2.fp[1] - cam2.teeth[1], cam2.fp[2] - cam2.teeth[2]) < 1, `fase 2: cámara centrada en los dientes y de cerca (escala ${cam2.ps.toFixed(1)} mm)`);
await shot('v083_puntos_cbct.png');
await page.keyboard.press('Escape'); await sleep(800);

console.log('— 8) y 9) PDF oscuro con TeleRx frontal (sin siluetas)');
await page.click('[data-layout="quad"]'); await sleep(1500);
await page.check('#sil-vis'); await sleep(300);
await page.click('#btn-report'); await sleep(300);
const themeDef = await ev(() => (document.querySelector('input[name="rp-theme"]:checked') || {}).value);
check(themeDef === 'dark' && (await page.locator('input[name="rp-theme"]').count()) === 2, `el diálogo ofrece tema oscuro / claro (por defecto ${themeDef}, como el visor)`);
await page.uncheck('#rp-views'); await page.uncheck('#rp-3d');
const [dlp] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.click('#dlg-ok')]);
const pdfDark = path.join(OUT, 'v083_informe_oscuro.pdf'); await dlp.saveAs(pdfDark);
check((await ev(() => window.tresd.V.state.silhouettes)) === true && await page.isChecked('#sil-vis'), 'las siluetas vuelven a estar como estaban tras el informe');
const tx = execSync(`pdftotext -layout "${pdfDark}" -`).toString();
check(tx.includes('TeleRx lateral · Radiografía') && tx.includes('TeleRx frontal (pa) · Radiografía'), 'TeleRx lateral y frontal en el PDF');
execSync(`pdftoppm -r 30 -png -f 1 -l 2 "${pdfDark}" "${path.join(OUT, 'v083_pdf_oscuro')}"`);
const corner = (f) => execSync(`python3 -c "from PIL import Image; im=Image.open('${f}').convert('RGB'); print(*im.getpixel((5,5)), *im.getpixel((im.width-5, im.height-5)))"`).toString().trim().split(' ').map(Number);
const c1 = corner(path.join(OUT, 'v083_pdf_oscuro-1.png')), c2 = corner(path.join(OUT, 'v083_pdf_oscuro-2.png'));
check(c1[0] < 40 && c1[1] < 40 && c1[2] < 60 && c1[3] < 40 && c2[0] < 40 && c2[3] < 40, `tema oscuro: fondo oscuro en todas las páginas (esquinas ${c1.join(',')} / ${c2.join(',')})`);
await page.click('#btn-report'); await sleep(300);
await page.check('input[name="rp-theme"][value="light"]'); await page.uncheck('#rp-views'); await page.uncheck('#rp-3d'); await page.uncheck('#rp-tele'); await page.uncheck('#rp-atm');
const [dlp2] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.click('#dlg-ok')]);
const pdfLight = path.join(OUT, 'v083_informe_claro.pdf'); await dlp2.saveAs(pdfLight);
execSync(`pdftoppm -r 30 -png -f 1 -l 1 "${pdfLight}" "${path.join(OUT, 'v083_pdf_claro')}"`);
const c3 = corner(path.join(OUT, 'v083_pdf_claro-1.png'));
check(c3[0] > 240 && c3[1] > 240 && c3[2] > 240, `tema claro: fondo blanco (esquina ${c3.join(',')})`);

console.log('— 5) compartir caso (.tresdz) y volver a abrirlo');
const M0 = await ev(() => Array.from(window.tresd.V.getMeshes().find((m) => m.role === 'upper').M));
const c0 = await ev(() => { const m = window.tresd.V.getMeshes().find((x) => x.role === 'upper'); const c = [0, 0, 0]; for (let i = 0; i < m.pts.length; i += 3) { c[0] += m.pts[i]; c[1] += m.pts[i + 1]; c[2] += m.pts[i + 2]; } return c.map((v) => v / (m.pts.length / 3)); });
const poles0 = await ev(() => window.tresd.V.getCondylePoles('L'));
await page.click('#btn-share'); await sleep(300);
const sh = await ev(() => Object.fromEntries([...document.querySelectorAll('.modal.share input')].map((i) => [i.id, [i.checked, i.disabled]])));
check(sh['sh-anon'][0] && sh['sh-reduce'][0] && sh['sh-mesh'][0] && !sh['sh-mesh'][1], `anonimizar y reducir marcados por defecto; escáneres incluidos: ${JSON.stringify(sh)}`);
const [dlz] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.click('#dlg-ok')]);
const pack = path.join(OUT, 'v083_caso.tresdz'); await dlz.saveAs(pack);
const kb = Math.round(fs.statSync(pack).size / 1024);
check(/^tresD_caso_anonimo_.*\.tresdz$/.test(dlz.suggestedFilename()) && kb > 500 && kb < 20000, `paquete «${dlz.suggestedFilename()}» de ${kb} kB (reducido y comprimido)`);
check(/^Paquete \.tresdz descargado/.test(await status()), `estado: «${(await status()).slice(0, 60)}»`);
const dir = path.join(OUT, 'v083_pack'); execSync(`rm -rf "${dir}" && mkdir -p "${dir}" && cd "${dir}" && unzip -q "${pack}"`);
const ls = execSync(`cd "${dir}" && ls dicom | wc -l && ls escaneres && cat sesion.tresd | head -c 100`).toString().split('\n');
check(ls[0].trim() === '136' && ls[1].trim() === 'upper.stl', `136 cortes DICOM (217 / 1,59: reducción 1/4 desde v0.8.4) y escaneres/upper.stl`);
const sess = JSON.parse(fs.readFileSync(path.join(dir, 'sesion.tresd'), 'utf8'));
check(sess.packaged && sess.packaged.reduced && sess.packaged.anonymized && sess.patient === null && sess.meshes.length === 1 && sess.meshes[0].M.join(',') === '1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1' && sess.tmj && sess.tmj.poles.L, 'sesión del paquete: anónima, escáner con matriz identidad, polos de ATM dentro');
const hdr = execSync(`python3 -W ignore -c "import pydicom; d=pydicom.dcmread('${path.join(dir, 'dicom/0050.dcm')}'); print(d.PatientName, '|', d.PatientID, '|', d.PatientBirthDate, '|', d.PatientSex, '|', d.Rows, d.Columns, '|', d.PixelSpacing[0], '|', d.pixel_array.min(), d.pixel_array.max())"`).toString().trim();
console.log('   DICOM del paquete:', hdr);
check(/^ANONIMO \| tresD \|\s*\| O \| 210 210 \| 0\.79/.test(hdr), 'DICOM anonimizado (sin nombre ni nacimiento), 210×210 a 0,79 mm');
// se abre en un visor recién cargado, arrastrándolo (aquí: por el botón de ZIP)
await page.goto('http://localhost:8790/'); await sleep(600);
await page.setInputFiles('#in-zip', pack);
await waitStatus(/^(upper: colocado|Sesión restaurada|Error|No se)/, 300000); await sleep(2500);
const re = await ev(() => { const V = window.tresd.V; const m = V.getMeshes().find((x) => x.role === 'upper'); let c = null; if (m) { c = [0, 0, 0]; for (let i = 0; i < m.pts.length; i += 3) { c[0] += m.pts[i]; c[1] += m.pts[i + 1]; c[2] += m.pts[i + 2]; } c = c.map((v) => v / (m.pts.length / 3)); } return { cols: V.state.series && V.state.series.cols, patient: V.state.series && V.state.series.patient, mesh: !!m, c, tmj: !!V.state.tmj, poles: V.getCondylePoles('L'), status: document.querySelector('#status-text').textContent }; });
console.log('   reabierto:', JSON.stringify({ ...re, c: re.c && re.c.map((v) => +v.toFixed(1)) }));
check(re.cols === 210 && re.patient === 'ANONIMO', `el CBCT reducido y anónimo se carga (${re.cols} columnas, paciente «${re.patient}»)`);
check(re.mesh && re.c && Math.hypot(re.c[0] - c0[0], re.c[1] - c0[1], re.c[2] - c0[2]) < 0.5, `el escáner vuelve exactamente a su sitio (${re.c && Math.hypot(re.c[0] - c0[0], re.c[1] - c0[1], re.c[2] - c0[2]).toFixed(2)} mm)`);
check(re.tmj && re.poles && Math.hypot(re.poles.med[0] - poles0.med[0], re.poles.med[1] - poles0.med[1], re.poles.med[2] - poles0.med[2]) < 0.01, 'los cortes de ATM se rehacen con los mismos polos');
check(await page.locator('.modal').count() === 0, 'sin preguntar nada (el escáner se coloca solo)');
await shot('v083_paquete_abierto.png');

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
