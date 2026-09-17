// Comprobaciones de v0.7.15 (peticiones de Manuel del 15-09-2026):
//  1) la captura en 2×2 compone los cortes al tamaño en que se ven (antes salían pequeños en una esquina)
//  2) clic en el chip del paciente = ocultar / mostrar sus datos
//  3) los polos del cóndilo ya NO se pintan en los cortes MPR
//  7) el lápiz ✎ permite editar nombre, sexo y nacimiento (solo en la sesión)
//  8) editando la curva panorámica hay una barra «Terminar de editar» sobre el axial y la barra de la
//     panorámica no se corta (se parte en filas)
//  (4 → tests/photo.mjs; 5 → tests/v0714.mjs; 6 → tests/real.mjs)
// Uso: node tests/v0715.mjs
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
await new Promise((r) => server.listen(8790, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(ROOT, 'tests/out', n) });
const sleep = (ms) => page.waitForTimeout(ms);
const chip = () => ev(() => ({ txt: document.querySelector('#patient-chip').textContent, masked: document.querySelector('#patient-chip').classList.contains('masked') }));

await page.goto('http://localhost:8790/');
await sleep(600);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(2500);

console.log('— 1) captura en 2×2');
const cap = await ev(async () => {
  const url = window.tresd.shotPng();
  const img = new Image(); img.src = url; await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  const bg = [d[0], d[1], d[2]];                        // esquina = fondo
  const W = cv.width, H = cv.height, hw = W >> 1, hh = H >> 1;
  const frac = (x0, y0) => { let n = 0, tot = 0; for (let y = y0; y < y0 + hh; y += 2) for (let x = x0; x < x0 + hw; x += 2) { const i = 4 * (y * W + x); tot++; if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 40) n++; } return n / tot; };
  const grid = document.querySelector('#grid').getBoundingClientRect();
  const c3d = document.querySelector('#vp3d canvas'), cax = document.querySelector('#vpAx canvas');
  return { W, H, ratio: +(W / H).toFixed(2), gridRatio: +(grid.width / grid.height).toFixed(2), q: [frac(0, 0), frac(hw, 0), frac(0, hh), frac(hw, hh)].map((v) => +v.toFixed(2)), sz3d: [c3d.width, c3d.height], szAx: [cax.width, cax.height] };
});
console.log('   canvas 3D', cap.sz3d.join('×'), '· canvas axial', cap.szAx.join('×'), '· captura', cap.W + '×' + cap.H, '· cuadrantes', cap.q.join(' '));
check(Math.abs(cap.ratio - cap.gridRatio) < 0.05, `la captura tiene la proporción de la rejilla (${cap.ratio} vs ${cap.gridRatio})`);
check(cap.q.slice(1).every((f) => f > 0.2), `cada corte ocupa una parte sustancial de su cuadrante (${cap.q.slice(1).join(', ')}; antes ≈ 0,08)`);

console.log('— 2) ocultar / mostrar el chip');
const c0 = await chip();
check(/PRUEBA/.test(c0.txt) && !c0.masked, `chip con el nombre: «${c0.txt}»`);
await page.click('#patient-chip'); await sleep(200);
const c1 = await chip();
check(c1.masked && !/PRUEBA/.test(c1.txt) && /ocultos/.test(c1.txt), `un clic lo oculta: «${c1.txt}»`);
await shot('v0715_chip_oculto.png');
await page.click('#patient-chip'); await sleep(200);
const c2 = await chip();
check(!c2.masked && c2.txt === c0.txt, 'otro clic lo vuelve a mostrar');

console.log('— 7) editar los datos del paciente');
check(await page.locator('#btn-patient-edit').isVisible(), 'hay un botón ✎ junto al chip');
await page.click('#btn-patient-edit'); await sleep(300);
check((await page.locator('.modal.patient').count()) === 1, 'abre la ventana de edición');
check((await ev(() => document.querySelector('#pe-name').value)) === 'PRUEBA^CBCT' || /PRUEBA/.test(await ev(() => document.querySelector('#pe-name').value)), 'el nombre viene prellenado');
await page.fill('#pe-name', 'Paciente Demo');
await page.selectOption('#pe-sex', 'F');
await page.fill('#pe-birth', '2000-05-06');
await page.click('#dlg-ok'); await sleep(300);
const c3 = await chip();
check(/^Paciente Demo · F · 06\/05\/2000 \(26 años\)/.test(c3.txt), `chip actualizado: «${c3.txt}»`);
check(await ev(() => window.tresd.V.state && true) && (await ev(() => document.querySelector('#status-text').textContent)).includes('solo en esta sesión'), 'aviso en la barra de estado');
await page.click('#btn-meta'); await sleep(600);
const meta = await ev(() => document.querySelector('#meta-drawer').textContent);
check(/Paciente Demo/.test(meta) && /06\/05\/2000/.test(meta), 'los metadatos en pantalla recogen el cambio');
await page.keyboard.press('Escape'); await sleep(200);

console.log('— 3) polos fuera de los cortes MPR');
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
await ev(() => window.tresd.renderTmj());
await page.click('[data-layout="quad"]'); await sleep(800);
// coronal a la altura del polo medial derecho, donde antes se pintaba
await ev(() => { const V = window.tresd.V; const p = V.state.tmj.poles.R.med; V.jumpViewportSticky(V.VP.cor, 1, p[1]); });
await sleep(2500);
const polePx = await ev(() => {
  let n = 0;
  for (const id of ['vpCor', 'vpAx', 'vpSag']) {
    const cv = document.querySelector(`#${id} canvas.silh`); if (!cv || !cv.width) continue;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 200) continue; const r = d[i], g = d[i + 1], b = d[i + 2];
      if ((Math.abs(r - 34) < 12 && Math.abs(g - 224) < 12 && Math.abs(b - 255) < 12) || (Math.abs(r - 255) < 12 && Math.abs(g - 92) < 12 && Math.abs(b - 240) < 12)) n++; }
  }
  return n;
});
const corY = await ev(() => +window.tresd.V.viewportFocal(window.tresd.V.VP.cor)[1].toFixed(1));
const poleY = await ev(() => +window.tresd.V.state.tmj.poles.R.med[1].toFixed(1));
check(Math.abs(corY - poleY) < 1.5, `el coronal está a la altura del polo (y=${corY} vs ${poleY})`);
check(polePx === 0, `ningún píxel con el color de los polos en los cortes MPR (${polePx})`);
await shot('v0715_sin_polos.png');

console.log('— 8) barra «Terminar de editar» sobre el axial');
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano, null, { timeout: 300000 });
await sleep(1200);
await page.click('#pan-edit'); await sleep(1200);
check(await page.locator('#pe-bar').isVisible() && /Terminar de editar/.test(await page.textContent('#pe-done')), 'con la curva en edición aparece «✔ Terminar de editar» sobre el axial');
const inside = await ev(() => {
  const vp = document.querySelector('.vp[data-id="vpPan"]').getBoundingClientRect();
  // (v0.7.17: «Borrar medidas» está oculto sin medidas; no cuenta)
  return [...document.querySelectorAll('.vp[data-id="vpPan"] .pan-bar button')].filter((b) => getComputedStyle(b).display !== 'none').every((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.right <= vp.right + 1 && r.left >= vp.left - 1; });
});
check(inside, 'ningún botón de la barra de la panorámica queda cortado (la barra se parte en filas)');
await shot('v0715_editar_curva.png');
await page.click('#pe-done'); await sleep(800);
check(await page.locator('#pe-bar').isHidden() && (await ev(() => document.querySelector('#pan-edit').getAttribute('aria-pressed'))) === 'false', '«Terminar de editar» cierra la edición');
check(await page.locator('.vp[data-id="vpPan"]').isVisible() && await page.locator('.vp[data-id="vpAx"]').isHidden(), 'y vuelve la panorámica a solas');

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
