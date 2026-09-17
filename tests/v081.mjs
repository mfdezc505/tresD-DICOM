// Comprobaciones de v0.8.1 (petición de Manuel del 16-09-2026: «me encanta, impleméntalo»):
//  TELERRADIOGRAFÍA simulada desde el CBCT (vista «TeleRx»): proyección con rayos paralelos, lateral (cara a la
//  derecha) y frontal (PA), radiografía (suma de atenuación) y MIP, escala 1:1, inclinación en 2D que arrastra
//  las medidas, medidas por toques (distancia / ángulo) con deshacer, brillo/contraste arrastrando, captura,
//  informe y sesión .tresd.
// Uso: node tests/v081.mjs
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
const waitStatus = (re, ms = 300000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#status-text').textContent), re.source, { timeout: ms, polling: 100 });
const tele = () => ev(() => { const T = window.tresd.V.state.tele; return T ? { view: T.view, mode: T.mode, tilt: T.tilt, w: T.image.width, h: T.image.height, step: T.image.step, n: (T.meas[T.view] || []).length, cached: Object.keys(T.cache) } : null; });
const nMeas = () => ev(() => window.tresd.V.getTeleMeas().length);
const loadCbct = async () => {
  await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
  await waitStatus(/^(Cargado|Aviso)/); await sleep(1500);
};

await page.goto('http://localhost:8790/'); await sleep(600);
await loadCbct();
check((await ev(() => { const b = document.querySelector('#view-bar [data-layout="vpTele"]'); return b && b.textContent; })) === 'TeleRx', 'la barra de vistas tiene el botón «TeleRx»');

console.log('— 1) lateral, radiografía');
const t0 = Date.now();
await page.click('[data-layout="vpTele"]');
await waitStatus(/^TeleRx Lateral/, 180000);
console.log(`   calculada en ${((Date.now() - t0) / 1000).toFixed(1)} s (incluye el cambio de disposición en SwiftShader)`);
await sleep(500);
let T = await tele();
check(T && T.view === 'lat' && T.mode === 'ray' && T.w === 334 && T.h === 217 && Math.abs(T.step - 0.5) < 1e-6, `imagen ${T && T.w}×${T && T.h} px a ${T && T.step} mm (una columna por corte, escala 1:1)`);
check(/167 × 109 mm/.test(await status()) && /escala 1:1/.test(await status()), `estado: «${(await status()).slice(0, 70)}»`);
check(await page.locator('.vp[data-id="vpTele"]').isVisible() && await page.locator('.vp[data-id="vpAx"]').isHidden(), 'la TeleRx ocupa el visor');
check((await page.textContent('#tele-ol')) === 'P' && (await page.textContent('#tele-or')) === 'A', 'letras P (izquierda) y A (derecha): la cara mira a la derecha');
const px = await ev(() => {
  const V = window.tresd.V, T = V.state.tele, img = T.cache.lat.mip;
  let mx = -1, at = 0; for (let i = 0; i < img.data.length; i++) if (img.data[i] > mx) { mx = img.data[i]; at = i; }
  const col = at % img.width, row = Math.floor(at / img.width);
  let zeros = 0; for (let i = 0; i < img.data.length; i++) if (img.data[i] === 0) zeros++;
  const ray = T.cache.lat.ray; let mean = 0; for (let i = 0; i < ray.data.length; i++) mean += ray.data[i]; mean /= ray.data.length;
  return { col: col / img.width, row: row / img.height, zeros: zeros / img.data.length, mean };
});
check(px.col > 0.45 && px.row > 0.3 && px.row < 0.8, `lo más denso (la corona metálica) cae en la mitad ANTERIOR, a media altura (columna ${px.col.toFixed(2)}, fila ${px.row.toFixed(2)})`);
check(px.mean > 150 && px.mean < 600, `la radiografía tiene grises intermedios (media ${px.mean.toFixed(0)} / 1000)`);
check(px.zeros > 0.1, `en el MIP el aire y el tejido blando quedan negros (${(px.zeros * 100).toFixed(0)} % de píxeles a 0)`);
await shot('v081_lateral.png');

console.log('— 2) MIP, frontal y vuelta (caché)');
await page.click('#tele-mip'); await sleep(400);
T = await tele();
check(T.mode === 'mip' && /^TeleRx Lateral · MIP/.test(await status()) && (await ev(() => document.querySelector('#tele-mip').getAttribute('aria-pressed'))) === 'true', 'MIP al instante (misma pasada por el volumen)');
await shot('v081_lateral_mip.png');
const t1 = Date.now();
await page.click('#tele-pa');
await waitStatus(/^TeleRx Frontal/, 120000);
T = await tele();
check(T.view === 'pa' && T.mode === 'mip' && T.w === 334 && T.h === 217, `frontal (PA) en ${((Date.now() - t1) / 1000).toFixed(1)} s: ${T.w}×${T.h} px, sigue en MIP`);
check((await page.textContent('#tele-ol')) === 'D' && (await page.textContent('#tele-or')) === 'I', 'letras D / I: se mira al paciente de frente');
await page.click('#tele-ray'); await sleep(400);
await shot('v081_frontal.png');
const t2 = Date.now();
await page.click('#tele-lat'); await sleep(300);
T = await tele();
check(T.view === 'lat' && T.mode === 'ray' && Date.now() - t2 < 1500 && T.cached.length === 2, 'volver a la lateral es inmediato (las dos vistas quedan en caché)');

console.log('— 3) medir por toques, deshacer, borrar');
await page.click('#tele-len'); await sleep(150);
check(/PRIMER punto sobre la TeleRx/.test(await status()), 'pide el primer punto');
const cb = await page.locator('#tele-canvas').boundingBox();
const geo = await ev(() => { const cv = document.querySelector('#tele-canvas'), r = cv.getBoundingClientRect(); const s = Math.min(r.width / cv.width, r.height / cv.height); return { s, z: cv._imgZoom || 1, step: window.tresd.V.state.tele.image.step }; });
const dxScreen = cb.width * 0.25;
await page.mouse.click(cb.x + cb.width * 0.35, cb.y + cb.height * 0.45); await sleep(250);
check((await nMeas()) === 0 && /SEGUNDO/.test(await status()), 'primer toque: pide el segundo');
await page.mouse.click(cb.x + cb.width * 0.6, cb.y + cb.height * 0.45); await sleep(300);
const expected = (dxScreen / geo.s / geo.z) * geo.step;
const got = parseFloat(((await status()).match(/([\d.]+) mm/) || [])[1]);
check((await nMeas()) === 1 && Math.abs(got - expected) / expected < 0.03, `segundo toque: ${got} mm (esperado ${expected.toFixed(1)} mm por la escala 1:1)`);
check(await page.locator('#tele-clear').isVisible(), 'aparece «Borrar medidas»');
await page.click('#tele-ang'); await sleep(150);
for (const [fx, fy] of [[0.3, 0.3], [0.3, 0.6], [0.6, 0.6]]) { await page.mouse.click(cb.x + cb.width * fx, cb.y + cb.height * fy); await sleep(250); }
await sleep(200);
const ang = await ev(() => { const m = window.tresd.V.getTeleMeas().find((x) => x.type === 'ang'); if (!m) return null; const u = [m.a[0] - m.v[0], m.a[1] - m.v[1]], w = [m.b[0] - m.v[0], m.b[1] - m.v[1]]; return Math.abs(Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1])) * 180 / Math.PI; });
check((await nMeas()) === 2 && ang !== null && Math.abs(ang - 90) < 1.5, `tres toques: ángulo de ${ang && ang.toFixed(1)}° (esperado 90)`);
await page.mouse.click(cb.x + cb.width * 0.7, cb.y + cb.height * 0.3); await sleep(150);
await page.keyboard.press('Escape'); await sleep(150);
check((await nMeas()) === 2, 'Esc cancela un ángulo a medias');
await page.click('#tele-ang'); await sleep(100);                  // herramienta apagada
await shot('v081_medidas.png');
await page.keyboard.press('Control+z'); await sleep(300);
check((await nMeas()) === 1, 'Ctrl+Z quita la última medida');
await page.keyboard.press('Control+y'); await sleep(300);
check((await nMeas()) === 2, 'Ctrl+Y la devuelve');

console.log('— 4) brillo/contraste arrastrando (sin herramienta)');
const w0 = await ev(() => window.tresd.V.getTeleWindow());
await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.3); await page.mouse.down();
await page.mouse.move(cb.x + cb.width * 0.6, cb.y + cb.height * 0.4, { steps: 8 }); await page.mouse.up(); await sleep(300);
const w1 = await ev(() => window.tresd.V.getTeleWindow());
check((await nMeas()) === 2 && Math.abs(w1.upper - w0.upper) > 1, `arrastrar cambia la ventana (${w0.lower.toFixed(0)}–${w0.upper.toFixed(0)} → ${w1.lower.toFixed(0)}–${w1.upper.toFixed(0)}) y no crea medidas`);

console.log('— 5) inclinación: la imagen y las medidas giran juntas');
const len0 = await ev(() => { const V = window.tresd.V, m = V.getTeleMeas().find((x) => !x.type); return Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) * V.state.tele.image.step; });
const pA0 = await ev(() => window.tresd.V.getTeleMeas().find((x) => !x.type).a.slice());
await ev(() => { const s = document.querySelector('#tele-tilt'); s.value = '10'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
await sleep(400);
T = await tele();
const len1 = await ev(() => { const V = window.tresd.V, m = V.getTeleMeas().find((x) => !x.type); return Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) * V.state.tele.image.step; });
const pA1 = await ev(() => window.tresd.V.getTeleMeas().find((x) => !x.type).a.slice());
check(T.tilt === 10 && (await ev(() => window.tresd.V.state.tele.image.tilt)) === 10 && /inclinada \+10°/.test(await status()), 'inclinación +10°');
check(Math.abs(len1 - len0) < 0.05 && Math.hypot(pA1[0] - pA0[0], pA1[1] - pA0[1]) > 2, `la medida gira con la imagen (misma longitud ${len1.toFixed(1)} mm, otro sitio)`);
// el giro de la imagen es real: el píxel más brillante (corona) se desplaza
const px2 = await ev(() => { const img = window.tresd.V.state.tele.image; let mx = -1, at = 0; for (let i = 0; i < img.data.length; i++) if (img.data[i] > mx) { mx = img.data[i]; at = i; } return [at % img.width, Math.floor(at / img.width)]; });
check(px2[0] !== Math.round(px.col * 334) || px2[1] !== Math.round(px.row * 217), 'la imagen está girada de verdad');
await shot('v081_inclinada.png');
await page.keyboard.press('Control+z'); await sleep(300);
check((await tele()).tilt === 0 && (await ev(() => document.querySelector('#tele-tilt').value)) === '0', 'Ctrl+Z deshace la inclinación (y el deslizador vuelve a 0)');
await page.keyboard.press('Control+y'); await sleep(300);
check((await tele()).tilt === 10, 'Ctrl+Y la rehace');

console.log('— 6) captura PNG de la TeleRx');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#btn-shot')]);
const shotFile = path.join(OUT, 'v081_captura.png'); await dl.saveAs(shotFile);
check(/\.png$/.test(dl.suggestedFilename()) && fs.statSync(shotFile).size > 20000, `«📷 Captura» descarga «${dl.suggestedFilename()}» (${Math.round(fs.statSync(shotFile).size / 1024)} kB)`);

console.log('— 7) informe (PDF) con la TeleRx');
await page.click('#btn-report'); await sleep(300);
const opt = await ev(() => { const e = document.getElementById('rp-tele'); return { on: e.checked, dis: e.disabled }; });
check(opt.on && !opt.dis, 'la opción «Telerradiografía lateral» está marcada y activa');
await page.uncheck('#rp-views'); await page.uncheck('#rp-mpr');            // más rápido en SwiftShader
const [dlp] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.click('#dlg-ok')]);
const pdfFile = path.join(OUT, 'v081_informe.pdf'); await dlp.saveAs(pdfFile);
const tx = execSync(`pdftotext -layout "${pdfFile}" -`).toString();
check(/\.pdf$/.test(dlp.suggestedFilename()) && tx.includes('TeleRx lateral · Radiografía'), `figura «TeleRx lateral · Radiografía» en el PDF («${dlp.suggestedFilename()}»)`);
const rowsTx = tx.split('\n').filter((l) => /^\s*TeleRx lateral\s+(Distancia|Ángulo)/.test(l));
check(rowsTx.length === 2 && rowsTx.some((l) => /Ángulo\s+90\.0°/.test(l)), `la tabla lleva las 2 medidas de la TeleRx: ${rowsTx.map((l) => l.trim().replace(/\s+/g, ' ')).join(' ; ')}`);
await sleep(500);
check(await page.locator('.vp[data-id="vpTele"]').isVisible(), 'el visor vuelve a la TeleRx');

console.log('— 8) sesión: se guarda y se restaura (vista, modo, inclinación, ventana, medidas)');
const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#btn-save')]);
const sessFile = path.join(OUT, 'v081_sesion.tresd'); await dl2.saveAs(sessFile);
const sess = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
check(sess.tele && sess.tele.view === 'lat' && sess.tele.mode === 'ray' && sess.tele.tilt === 10 && sess.tele.meas.lat.length === 2 && sess.tele.win.ray && sess.layout === 'vpTele', `sesión con tele: ${JSON.stringify({ ...sess.tele, meas: Object.fromEntries(Object.entries(sess.tele.meas).map(([k, v]) => [k, v.length])) })}`);
await page.goto('http://localhost:8790/'); await sleep(600);
await loadCbct();
await page.setInputFiles('#in-session', sessFile);
await waitStatus(/^(Sesión restaurada|Error)/); await sleep(1500);
T = await tele();
check(T && T.view === 'lat' && T.mode === 'ray' && T.tilt === 10 && T.n === 2, `TeleRx restaurada: ${JSON.stringify(T)}`);
check(await page.locator('.vp[data-id="vpTele"]').isVisible() && (await ev(() => document.querySelector('#tele-tilt').value)) === '10', 'la disposición «TeleRx» y el deslizador vuelven como estaban');
const lenR = await ev(() => { const V = window.tresd.V, m = V.getTeleMeas().find((x) => !x.type); return Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) * V.state.tele.image.step; });
check(Math.abs(lenR - len0) < 0.05, `la medida vale lo mismo (${lenR.toFixed(1)} mm)`);
check(Math.abs((await ev(() => window.tresd.V.getTeleWindow())).upper - w1.upper) < 0.5, 'la ventana (brillo/contraste) se conserva');
await shot('v081_sesion.png');

console.log('— 9) doble clic → 2×2; inglés');
await page.dblclick('#tele-canvas'); await sleep(800);
check(await page.locator('.vp[data-id="vpAx"]').isVisible() && await page.locator('.vp[data-id="vpTele"]').isHidden(), 'doble clic vuelve al 2×2');
await page.click('#btn-lang'); await sleep(400);
check((await ev(() => document.querySelector('#view-bar [data-layout="vpTele"]').textContent)) === 'Ceph', 'en inglés el botón es «Ceph»');
await page.click('#btn-lang'); await sleep(300);

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
