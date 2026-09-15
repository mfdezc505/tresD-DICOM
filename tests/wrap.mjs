// BLOQUE DE CORTES FUERA DE SITIO (v0.7.2): un CBCT en el que la parte alta del cráneo salía recortada
// y aparecía como un trozo suelto POR DEBAJO del resto (axial bien; coronal, sagital y 3D con la bóveda
// separada y un hueco negro en medio). Causa: un bloque contiguo de cortes trae la posición desplazada
// un recorrido entero, así que al ordenar por posición se coloca al principio del volumen.
// Se comprueba que:
//   1) la serie sana (cbct_half) se carga SIN tocar nada;
//   2) la serie estropeada (cbct_wrap, tests/make_wrap_geom.py) se detecta y se repara;
//   3) el volumen reparado coincide corte a corte con el de la serie sana;
//   4) al cargar otra serie después, la reparación no se queda pegada.
// Uso: node tests/wrap.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8783, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 300)); if (tx.startsWith('tresD orden')) console.log('   ', tx.slice(0, 240)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);

/** Carga una carpeta en una pestaña LIMPIA y devuelve el resumen del volumen. */
async function load(dir) {
  await page.goto('http://localhost:8783/'); await page.waitForTimeout(600);
  await page.setInputFiles('#in-folder', dir);
  await page.waitForFunction(() => /^(Cargado|Aviso|Error|No se|Volumen)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
  await page.waitForTimeout(1200);
  return ev(() => {
    const V = window.tresd.V, v = V.state.volume, s = V.state.series;
    return {
      dims: Array.from(v.imageData.getDimensions()), spacing: Array.from(v.spacing), n: s.count,
      rot: s.rot ?? null, rotTail: s.rotTail || 0, status: document.querySelector('#status-text').textContent,
    };
  });
}
/** Firma del volumen: media de HU de cada corte axial (delata cualquier bloque descolocado). */
const profile = () => ev(() => {
  const v = window.tresd.V.state.volume, vm = v.voxelManager;
  const nz = v.imageData.getDimensions()[2], out = [];
  for (let k = 0; k < nz; k++) {
    const sl = vm.getSliceData({ sliceIndex: k, slicePlane: 2 });
    let s = 0, n = 0;
    for (let i = 0; i < sl.length; i += 7) { s += sl[i]; n++; }
    out.push(Math.round(s / n));
  }
  return out;
});

console.log('— serie sana');
const good = await load('/tmp/testdata/cbct_half');
check(good.n === 217, `217 cortes (${good.n})`);
check(good.rot === null, `los números de instancia van seguidos: nada que sospechar (rot ${good.rot})`);
check(good.rotTail === 0, 'no se mueve ningún corte');
const pGood = await profile();
check(pGood.length === good.dims[2], `perfil de ${pGood.length} cortes`);

console.log('— serie con un bloque de 40 cortes fuera de sitio');
const bad = await load('/tmp/testdata/cbct_wrap');
check(bad.rot === 40, `sospecha por el número de instancia en el corte ${bad.rot}`);
check(bad.rotTail === 40, `confirmada con los píxeles y reparada: ${bad.rotTail} cortes devueltos a su sitio`);
check(/40 cortes/.test(bad.status), `se avisa en la barra de estado: ${bad.status.slice(0, 90)}`);
check(bad.dims.join() === good.dims.join(), `mismas dimensiones que la sana (${bad.dims.join('×')})`);
check(Math.abs(bad.spacing[2] - good.spacing[2]) < 0.01, `mismo salto entre cortes (${bad.spacing[2].toFixed(3)} mm)`);

const pBad = await profile();
let difs = 0, maxDif = 0;
for (let i = 0; i < pBad.length; i++) {
  const d = Math.abs(pBad[i] - pGood[i]);
  if (d > 2) difs++;
  if (d > maxDif) maxDif = d;
}
check(difs === 0, `coincide corte a corte con la serie sana (${difs} cortes distintos, máx ${maxDif} HU)`);
// y NO se quedó girado (que es justo lo que veía Manuel)
const rolled = pGood.slice(-40).concat(pGood.slice(0, -40));
let comoGirado = 0;
for (let i = 0; i < pBad.length; i++) if (Math.abs(pBad[i] - rolled[i]) <= 2) comoGirado++;
check(comoGirado < pBad.length * 0.9, `ya no está girado (${comoGirado}/${pBad.length} cortes encajaban con el giro)`);

console.log('— la serie sana otra vez (que la reparación no se quede pegada)');
const good2 = await load('/tmp/testdata/cbct_half');
check(good2.rotTail === 0, 'la serie sana se vuelve a cargar sin tocar nada');
const pGood2 = await profile();
let dif2 = 0;
for (let i = 0; i < pGood2.length; i++) if (Math.abs(pGood2[i] - pGood[i]) > 2) dif2++;
check(dif2 === 0, `idéntica a la primera carga (${dif2} cortes distintos)`);

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
