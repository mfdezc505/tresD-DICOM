// Guarda de GEOMETRÍA (v0.7.0): un CBCT cuya serie trae un corte en una posición disparatada hacía que
// Cornerstone dedujese una distancia entre cortes ~2,7 veces mayor y el volumen salía ESTIRADO a lo alto
// (axial bien, coronal / sagital / 3D como una columna). Se comprueba que:
//   1) la serie sana (cbct_half) se carga con el vóxel correcto y SIN corregir nada;
//   2) la serie estropeada (cbct_badgeom, tests/make_bad_geom.py) se detecta, se corrige al vóxel real y
//      el volumen queda con las mismas dimensiones en mm que la sana (± 1 %);
//   3) se avisa en la barra de estado.
// Uso: node tests/geom.mjs
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
await new Promise((r) => server.listen(8781, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 300)); if (tx.startsWith('tresD geometría')) console.log('   ', tx.slice(0, 240)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);

/** Carga una carpeta y devuelve el vóxel, el tamaño real en mm y el aviso de corrección. */
async function load(dir) {
  await page.goto('http://localhost:8781/'); await page.waitForTimeout(600);
  await page.setInputFiles('#in-folder', dir);
  await page.waitForFunction(() => /^(Cargado|Aviso|Error|No se|Volumen)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
  await page.waitForTimeout(1200);
  return ev(() => {
    const V = window.tresd.V, vol = V.state.volume;
    const d = vol.imageData.getDimensions(), s = Array.from(vol.spacing);
    return { spacing: s, dims: Array.from(d), mm: [0, 1, 2].map((q) => d[q] * s[q]), geo: V.state.geometry, status: document.querySelector('#status-text').textContent };
  });
}

console.log('— serie SANA (cbct_half)');
const good = await load('/tmp/testdata/cbct_half');
console.log('   vóxel', good.spacing.map((v) => v.toFixed(3)).join(' × '), 'mm · tamaño', good.mm.map((v) => Math.round(v)).join(' × '), 'mm');
check(!good.geo.fixed, 'no se corrige nada en una serie correcta');
check(Math.abs(good.spacing[2] - good.spacing[0]) < 0.02, `vóxel isótropo (${good.spacing.map((v) => v.toFixed(2)).join(', ')})`);

console.log('— serie ESTROPEADA (cbct_badgeom: un corte 180 mm fuera de sitio)');
const bad = await load('/tmp/testdata/cbct_badgeom');
console.log('   vóxel', bad.spacing.map((v) => v.toFixed(3)).join(' × '), 'mm · tamaño', bad.mm.map((v) => Math.round(v)).join(' × '), 'mm');
check(bad.geo && bad.geo.fixed, 'se detecta y se corrige la geometría');
check(bad.geo && bad.geo.from[2] > 1.15, `Cornerstone deducía ${bad.geo ? bad.geo.from[2].toFixed(3) : '?'} mm entre cortes (el volumen salía ~2,7 veces más alto)`);
check(Math.abs(bad.spacing[2] - good.spacing[2]) / good.spacing[2] < 0.01, `tras corregir, el vóxel coincide con el de la serie sana (${bad.spacing[2].toFixed(3)} vs ${good.spacing[2].toFixed(3)} mm)`);
const dz = Math.abs(bad.mm[2] - good.mm[2]) / good.mm[2];
check(dz < 0.01, `altura del volumen igual que la sana (${Math.round(bad.mm[2])} vs ${Math.round(good.mm[2])} mm, ${(100 * dz).toFixed(1)} %)`);
check(/^Aviso:/.test(bad.status), 'se avisa en la barra de estado: ' + bad.status.slice(0, 90));

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
