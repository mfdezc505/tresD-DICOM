// Comprobaciones de v0.8.0 (peticiones de Manuel del 16-09-2026: «Hagamos 1 y 2»):
//  1) INFORME: «📄 Informe» abre una ventana previa (qué incluir + observaciones) y «Generar informe» abre
//     una pestaña imprimible con los datos, las capturas (3D, MPR, panorámica, ATM), la tabla de medidas,
//     las observaciones y el aviso legal; lanza el diálogo de imprimir («Guardar como PDF»)
//  2) SESIÓN .tresd: «💾 Guardar» descarga un JSON con todo lo hecho; «📂 Abrir» (o arrastrar) lo restaura
//     sobre el CBCT (render, ventana, medidas 3D/MPR/panorámica/ATM, panorámica, polos, disposición); si
//     se abre antes que el CBCT queda pendiente y se aplica al cargarlo; los escáneres se colocan solos al
//     reimportarlos; un archivo que no es sesión se rechaza
// Uso: node tests/v080.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(ROOT, 'tests/out');
const SC = '/tmp/testdata/real_scans';
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
// en todas las pestañas (también la del informe): ajustes aceptados y window.print() sustituido por una marca
await ctx.addInitScript(() => {
  try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {}
  window.__printed = 0; window.print = () => { window.__printed++; };
});
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
const waitStatus = (re, ms = 300000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#status-text').textContent), re.source, { timeout: ms });
const loadCbct = async () => {
  await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
  await waitStatus(/^(Cargado|Aviso)/); await sleep(1500);
};
const addMesh = async (file, role) => {
  await page.setInputFiles('#in-mesh', [file]);
  await page.waitForSelector('.modal');
  await page.click(`input[name="dm-role"][value="${role}"]`);
  await page.click('#dlg-ok');
  await waitStatus(/^(Escáner añadido|No se pudo|Error)/);
};

await page.goto('http://localhost:8790/');
await sleep(600);
check(await page.locator('#btn-open').isVisible() && await page.locator('#btn-save').isHidden() && await page.locator('#btn-report').isHidden(), 'sin caso: se ve «Abrir» pero no «Guardar» ni «Informe»');

console.log('— sesión abierta ANTES del CBCT: queda pendiente');
const sessDir = path.join(OUT, 'v080'); fs.mkdirSync(sessDir, { recursive: true });
const bad = path.join(sessDir, 'no_es_sesion.tresd'); fs.writeFileSync(bad, '{"hola": 1}');
await page.setInputFiles('#in-session', bad); await sleep(500);
check(/no es una sesión/.test(await status()), `archivo que no es sesión → «${(await status()).slice(0, 60)}»`);

await loadCbct();
check(await page.locator('#btn-save').isVisible() && await page.locator('#btn-report').isVisible(), 'con caso: aparecen «💾 Guardar» y «📄 Informe»');

console.log('— preparar un caso con de todo: render, medidas 3D y MPR, panorámica con medida, ATM con medida, escáner');
await page.selectOption('#dicom-preset', 'natural'); await sleep(600);
// medida 3D (2 clics)
await page.click('[data-layout="vp3d"]'); await sleep(1500);
await page.click('#btn-dist'); await sleep(200);
const b3 = await page.locator('#vp3d').boundingBox();
await page.mouse.click(b3.x + b3.width * 0.5, b3.y + b3.height * 0.45); await sleep(700);
await page.mouse.click(b3.x + b3.width * 0.6, b3.y + b3.height * 0.55); await sleep(700);
// medida MPR (arrastrar en el axial con la herramienta activa)
await page.click('[data-layout="quad"]'); await sleep(1500);
const ba = await page.locator('#vpAx').boundingBox();
const ax = ba.x + ba.width / 2, ay = ba.y + ba.height / 2;
await page.mouse.move(ax - 50, ay); await page.mouse.down(); await page.mouse.move(ax - 20, ay - 20, { steps: 5 }); await page.mouse.move(ax + 10, ay - 30, { steps: 5 }); await page.mouse.up(); await sleep(600);
await page.click('#btn-dist'); await sleep(200);
const ms0 = await ev(() => window.tresd.V.getMeasures());
check(ms0.v3d.length === 1 && ms0.mpr.length === 1, `una medida 3D y una MPR (${ms0.v3d.length} / ${ms0.mpr.length})`);
// panorámica + medida por toques
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano, null, { timeout: 300000 }); await sleep(1200);
await page.click('#pan-len'); await sleep(150);
const pb = await page.locator('#pan-canvas').boundingBox();
await page.mouse.click(pb.x + pb.width * 0.35, pb.y + pb.height * 0.45); await sleep(250);
await page.mouse.click(pb.x + pb.width * 0.55, pb.y + pb.height * 0.5); await sleep(300);
await page.click('#pan-len'); await sleep(100);
check((await ev(() => window.tresd.V.getPanoMeas().length)) === 1, 'una medida en la panorámica');
// ATM + medida en el sagital 0 del lado derecho
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
await ev(() => window.tresd.renderTmj());
await page.click('#lay-atm'); await sleep(900);
await ev(() => window.tresd.openAtmBig('R', 'sag0')); await sleep(600);
await page.click('#ab-len'); await sleep(150);
const ab = await page.locator('#ab-canvas').boundingBox();
await page.mouse.click(ab.x + ab.width * 0.3, ab.y + ab.height * 0.35); await sleep(200);
await page.mouse.click(ab.x + ab.width * 0.6, ab.y + ab.height * 0.65); await sleep(300);
await page.click('#ab-close'); await sleep(300);
check((await ev(() => Object.values(window.tresd.V.getAllTmjMeas()).flat().length)) === 1, 'una medida en un corte de ATM');
// escáner superior (alineado al CBCT) → su matriz debe volver igual al reimportarlo
await page.click('[data-layout="quad"]'); await sleep(600);
await addMesh(`${SC}/upper.stl`, 'upper');
const M0 = await ev(() => Array.from(window.tresd.V.getMeshes().find((m) => m.role === 'upper').M));
check(M0.length === 16, 'escáner superior alineado (matriz guardable)');
const saved0 = await ev(() => ({ poles: window.tresd.V.getCondylePoles('R'), win: window.tresd.V.getMprWindow(), render: { ...window.tresd.V.state.render } }));
await page.click('[data-layout="vpPan"]'); await sleep(800);

console.log('— 2) guardar la sesión');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#btn-save')]);
const sessFile = path.join(sessDir, dl.suggestedFilename());
await dl.saveAs(sessFile);
const sess = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
check(/^tresD_.*\.tresd$/.test(dl.suggestedFilename()), `se descarga «${dl.suggestedFilename()}» (${Math.round(fs.statSync(sessFile).size / 1024)} kB)`);
const VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
check(sess.app === 'tresD DICOM' && sess.format === 1 && sess.version === VER, `cabecera app/format/version (${sess.version})`);
check(sess.render.preset === 'natural' && sess.layout === 'vpPan' && sess.mprWindow && Number.isFinite(sess.mprWindow.lower), 'render, disposición y ventana MPR guardados');
check(sess.measures.v3d.length === 1 && sess.measures.mpr.length === 1 && sess.measures.mpr[0].a && sess.measures.mpr[0].vp === 'vpAx', 'medidas 3D y MPR (anotación con su visor)');
check(sess.pano && sess.pano.control.length >= 3 && Number.isFinite(sess.pano.z) && sess.pano.meas.length === 1, `panorámica: ${sess.pano && sess.pano.control.length} puntos de control, z=${sess.pano && sess.pano.z.toFixed(1)}, 1 medida`);
check(sess.tmj && sess.tmj.poles.R && sess.tmj.poles.L && Object.values(sess.tmj.meas).flat().length === 1, 'ATM: polos de los dos lados y su medida');
check(sess.meshes.length === 1 && sess.meshes[0].name === 'upper' && sess.meshes[0].M.length === 16 && sess.meshes[0].role === 'upper', 'escáner: nombre, papel y matriz');
check(/Sesión guardada/.test(await status()), `estado: «${(await status()).slice(0, 50)}…»`);

console.log('— 1) informe (PDF descargado, v0.8.2)');
await page.click('#btn-report'); await sleep(300);
check((await page.locator('.modal.report').count()) === 1, 'se abre la ventana previa del informe');
const opts = await ev(() => Object.fromEntries(['rp-pat', 'rp-3d', 'rp-views', 'rp-mpr', 'rp-pano', 'rp-tele', 'rp-atm', 'rp-meas'].map((id) => { const e = document.getElementById(id); return [id, { on: e.checked, dis: e.disabled }]; })));
check(Object.values(opts).every((o) => o.on && !o.dis), `todas las opciones marcadas y activas: ${JSON.stringify(opts)}`);
await page.fill('#rp-notes', 'Observación de prueba: asimetría condilar leve.');
await shot('v080_informe_dialogo.png');
const [dlp] = await Promise.all([page.waitForEvent('download', { timeout: 1500000 }), page.click('#dlg-ok')]);
const pdfFile = path.join(sessDir, 'informe.pdf'); await dlp.saveAs(pdfFile);
await sleep(500);
check(/^tresD_informe_PRUEBA_CBCT_.*\.pdf$/.test(dlp.suggestedFilename()) && fs.statSync(pdfFile).size > 100000, `se descarga «${dlp.suggestedFilename()}» (${Math.round(fs.statSync(pdfFile).size / 1024)} kB)`);
check(/Informe descargado/.test(await status()), `estado: «${(await status()).slice(0, 60)}»`);
const pdfText = (f) => execSync(`pdftotext -layout "${f}" -`).toString();
const pdfPages = (f) => +(execSync(`pdfinfo "${f}"`).toString().match(/Pages:\s+(\d+)/) || [])[1];
const tx = pdfText(pdfFile);
check(fs.readFileSync(pdfFile).slice(0, 5).toString() === '%PDF-' && pdfPages(pdfFile) >= 3, `PDF válido de ${pdfPages(pdfFile)} páginas`);
check(/Informe de visualización/.test(tx) && /Generado el/.test(tx), 'cabecera con título y fecha');
check(/Nombre\s+PRUEBA CBCT/.test(tx) && /Fecha del estudio/.test(tx) && /Vóxel/.test(tx), 'datos del paciente y del estudio');
for (const cap of ['Render 3D', 'Axial', 'Coronal', 'Sagital', 'Render 3D · Frontal', 'Render 3D · Derecha', 'Render 3D · Izquierda', 'Panorámica', 'TeleRx lateral · Radiografía', 'Cortes de ATM']) check(tx.includes(cap), `figura «${cap}»`);
const rowsTx = tx.split('\n').filter((l) => /(Distancia|Ángulo)\s+[\d.]+ (mm|°)/.test(l));
check(rowsTx.length === 4 && rowsTx.some((l) => /^\s*Render 3D/.test(l)) && rowsTx.some((l) => /^\s*Axial/.test(l)) && rowsTx.some((l) => /^\s*Panorámica/.test(l)) && rowsTx.some((l) => /ATM derecha · Sagital centro/.test(l)), `tabla con 4 medidas: ${rowsTx.map((l) => l.trim().replace(/\s+/g, ' ')).join(' ; ')}`);
check((tx.match(/Eje del cóndilo/g) || []).length === 2, 'ejes del cóndilo (dos lados)');
check(/asimetría condilar leve/.test(tx), 'las observaciones van al final');
check(/No es un producto sanitario/.test(tx) && tx.includes('v' + VER) && /Página 1 de \d/.test(tx), 'pie con el aviso legal, la versión y el número de página');
// el PDF lleva imágenes JPEG (las capturas) y el logotipo
const imgL = execSync(`pdfimages -list "${pdfFile}"`).toString();
check((imgL.match(/\bjpeg\b/g) || []).length + (imgL.match(/\bsmask\b/g) || []).length >= 11, 'las capturas van como imágenes (JPEG; el 3D en PNG sin fondo desde v0.8.5) dentro del PDF');
check((await ev(() => window.tresd.V.state.pano && document.querySelector('.vp[data-id="vpPan"]') && !document.querySelector('.vp[data-id="vpPan"]').classList.contains('hidden'))) === true, 'el visor vuelve a la disposición que tenía (panorámica)');

console.log('— sin datos del paciente');
await page.click('#btn-report'); await sleep(300);
await page.uncheck('#rp-pat'); await page.uncheck('#rp-mpr'); await page.uncheck('#rp-atm'); await page.uncheck('#rp-views'); await page.uncheck('#rp-tele');
const [dlp2] = await Promise.all([page.waitForEvent('download', { timeout: 1500000 }), page.click('#dlg-ok')]);
const pdfFile2 = path.join(sessDir, 'informe2.pdf'); await dlp2.saveAs(pdfFile2);
const tx2 = pdfText(pdfFile2);
check(/^tresD_informe_caso_/.test(dlp2.suggestedFilename()) && /Datos del paciente omitidos/.test(tx2) && !/PRUEBA CBCT/.test(tx2) && !/^\s*Coronal\s*$/m.test(tx2) && /Panorámica/.test(tx2) && pdfPages(pdfFile2) <= 2, `paciente omitido, sin cortes: ${pdfPages(pdfFile2)} páginas («${dlp2.suggestedFilename()}»)`);
check(/Eje del cóndilo \(medial–lateral\) · DERECHA\s+17\.\d mm/.test(tx2), 'los ejes del cóndilo van en una línea (etiqueta ancha)');

console.log('— 2) restaurar la sesión sobre un visor recién abierto');
await page.goto('http://localhost:8790/'); await sleep(600);
await loadCbct();
await page.setInputFiles('#in-session', sessFile);
await waitStatus(/^(Sesión restaurada|Aviso|Error)/); await sleep(1500);
check(/^Sesión restaurada\. Importa de nuevo los escáneres \(upper\)/.test(await status()), `estado: «${(await status()).slice(0, 90)}»`);
const rs = await ev(() => { const V = window.tresd.V; return {
  preset: V.state.render.preset, win: V.getMprWindow(), layout: !document.querySelector('.vp[data-id="vpPan"]').classList.contains('hidden'),
  v3d: V.getMeasures().v3d.length, mpr: V.getMeasures().mpr.length, pano: !!V.state.pano, panoMeas: V.getPanoMeas().length,
  tmj: !!V.state.tmj, poles: V.getCondylePoles('R'), tmjMeas: Object.values(V.getAllTmjMeas()).flat().length, sel: document.querySelector('#dicom-preset').value,
}; });
check(rs.preset === 'natural' && rs.sel === 'natural', `render restaurado (${rs.preset}, desplegable ${rs.sel})`);
check(Math.abs(rs.win.lower - saved0.win.lower) < 1e-6 && Math.abs(rs.win.upper - saved0.win.upper) < 1e-6, 'ventana MPR restaurada');
check(rs.v3d === 1 && rs.mpr === 1, `medidas 3D y MPR de vuelta (${rs.v3d} / ${rs.mpr})`);
check(rs.pano && rs.panoMeas === 1, 'panorámica rehecha con su medida');
check(rs.tmj && rs.tmjMeas === 1 && rs.poles && rs.poles.med.every((v, i) => Math.abs(v - saved0.poles.med[i]) < 1e-6), 'cortes de ATM rehechos con los mismos polos y su medida');
check(rs.layout, 'disposición guardada (panorámica) aplicada');
await shot('v080_sesion_restaurada.png');
// el escáner vuelve a su sitio sin pasar por el diálogo ni alinear
await page.setInputFiles('#in-mesh', [`${SC}/upper.stl`]);
await waitStatus(/^(upper: colocado|Escáner añadido|No se pudo|Error)/); await sleep(500);
check(/^upper: colocado como en la sesión guardada/.test(await status()) && (await page.locator('.modal').count()) === 0, `escáner reimportado sin preguntar: «${(await status()).slice(0, 60)}»`);
const M1 = await ev(() => Array.from(window.tresd.V.getMeshes().find((m) => m.role === 'upper').M));
const dM = Math.max(...M1.map((v, i) => Math.abs(v - M0[i])));
check(dM < 1e-3, `misma matriz que al guardar (diferencia máxima ${dM.toExponential(1)})`);
const pts = await ev(() => { const m = window.tresd.V.getMeshes().find((x) => x.role === 'upper'); const c = [0, 0, 0]; for (let i = 0; i < m.pts.length; i += 3) { c[0] += m.pts[i]; c[1] += m.pts[i + 1]; c[2] += m.pts[i + 2]; } return c.map((v) => v / (m.pts.length / 3)); });
const bnds = await ev(() => window.tresd.V.state.volume.imageData.getBounds());
check(pts[0] > bnds[0] && pts[0] < bnds[1] && pts[1] > bnds[2] && pts[1] < bnds[3] && pts[2] > bnds[4] && pts[2] < bnds[5], `el escáner cae dentro del CBCT (centro ${pts.map((v) => v.toFixed(0)).join(', ')})`);

console.log('— 2) sesión ANTES del CBCT (pendiente) y arrastrar el .tresd');
await page.goto('http://localhost:8790/'); await sleep(600);
await page.setInputFiles('#in-session', sessFile); await sleep(500);
check(/^Sesión leída\. Carga ahora el CBCT/.test(await status()), `queda pendiente: «${(await status()).slice(0, 70)}»`);
await loadCbct();
await waitStatus(/^(Sesión restaurada|Error)/); await sleep(1000);
const rs2 = await ev(() => ({ pano: !!window.tresd.V.state.pano, tmj: !!window.tresd.V.state.tmj, preset: window.tresd.V.state.render.preset }));
check(rs2.pano && rs2.tmj && rs2.preset === 'natural', 'al cargar el CBCT se aplica sola');
// arrastrar el .tresd sobre el visor (DataTransfer con el archivo)
await page.goto('http://localhost:8790/'); await sleep(600);
await loadCbct();
const buf = fs.readFileSync(sessFile).toString('base64');
await ev(async ([b64, name]) => {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const dt = new DataTransfer(); dt.items.add(new File([u8], name, { type: 'application/json' }));
  const target = document.querySelector('#grid');
  for (const type of ['dragenter', 'dragover', 'drop']) { const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }); target.dispatchEvent(e); }
}, [buf, path.basename(sessFile)]);
await waitStatus(/^(Sesión restaurada|Error|Ese archivo)/); await sleep(800);
check(/^Sesión restaurada/.test(await status()) && (await ev(() => !!window.tresd.V.state.pano)), 'arrastrar el .tresd también restaura');

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
