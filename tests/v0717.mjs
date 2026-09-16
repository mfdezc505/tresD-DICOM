// Comprobaciones de v0.7.17 (peticiones de Manuel del 16-09-2026):
//  1) panorámica: medir por TOQUES con los botones «Distancia» (2) y «Ángulo» (3), sin Mayús
//  2) «Subir foto frontal» va encima de «Segmentar hueso y piel»
//  3) la ayuda tiene la sección de requisitos mínimos del dispositivo
//  4) los polos del cóndilo caen sobre el hueso, en la sección axial más ancha de la cabeza
//  5) los sagitales del cóndilo DERECHO llevan anterior a la derecha (los del izquierdo, a la izquierda)
//  6) «⌫ Borrar medidas» de la panorámica solo se ve cuando hay medidas
//  7) marca de agua opaca (siempre por delante)
// Uso: node tests/v0717.mjs
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
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES', hasTouch: true });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); if (/tresD ATM/.test(tx)) console.log('   ', tx.slice(0, 160)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(ROOT, 'tests/out', n) });
const sleep = (ms) => page.waitForTimeout(ms);
const status = () => ev(() => document.querySelector('#status-text').textContent);
const nPan = () => ev(() => window.tresd.V.getPanoMeas().length);

await page.goto('http://localhost:8790/');
await sleep(600);

console.log('— 2) orden de los botones del grupo 3');
const order = await ev(() => [...document.querySelectorAll('#g3 button')].map((b) => b.id));
check(order.indexOf('btn-photo') >= 0 && order.indexOf('btn-photo') < order.indexOf('btn-seg'), `«Subir foto» va antes de «Segmentar» (${order.join(' → ')})`);

console.log('— 3) requisitos en la ayuda');
await page.click('#btn-help'); await sleep(300);
const req = await ev(() => { const h = [...document.querySelectorAll('.modal.help .help-sec')].find((s) => /Requisitos/.test(s.querySelector('h4').textContent)); return h ? h.textContent : ''; });
check(/Navegador/.test(req) && /RAM/.test(req) && /Tabletas/.test(req) && /Archivos/.test(req), 'sección «Requisitos mínimos del dispositivo» con navegador, memoria, tabletas y archivos');
await page.click('#help-close'); await sleep(200);

console.log('— carga del CBCT');
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1500);

console.log('— 7) marca de agua opaca');
const wm = await ev(async () => {
  const url = window.tresd.shotPng();
  const img = new Image(); img.src = url; await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  // zona del logotipo: 16 % del ancho abajo a la derecha. Se buscan píxeles del verde/azul de la «D» del logo
  const mw = Math.round(cv.width * 0.16), mh = Math.round(mw * 0.35), pad = Math.round(cv.width * 0.015);
  const d = g.getImageData(cv.width - mw - pad, cv.height - mh - pad, mw, mh).data;
  let sat = 0; for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx - mn > 60 && mx > 120) sat++; }
  return { sat, tot: d.length / 4 };
});
check(wm.sat > wm.tot * 0.01, `el logotipo se ve con sus colores plenos en la esquina (${wm.sat} píxeles saturados)`);

console.log('— 1) y 6) medir en la panorámica por toques');
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano, null, { timeout: 300000 });
await sleep(1200);
check(await page.locator('#pan-len').isVisible() && await page.locator('#pan-ang').isVisible(), 'la barra tiene «Distancia» y «Ángulo»');
check(await page.locator('#pan-clear').isHidden(), 'sin medidas no se ve «Borrar medidas»');
const pb = await page.locator('#pan-canvas').boundingBox();
const w0 = await ev(() => window.tresd.V.getPanoWindow());
await page.mouse.move(pb.x + pb.width * 0.3, pb.y + pb.height * 0.3); await page.mouse.down();
await page.mouse.move(pb.x + pb.width * 0.4, pb.y + pb.height * 0.4, { steps: 8 }); await page.mouse.up(); await sleep(300);
check((await nPan()) === 0 && Math.abs((await ev(() => window.tresd.V.getPanoWindow())).upper - w0.upper) > 1, 'sin botón, arrastrar = brillo/contraste (sin medidas)');
await page.click('#pan-len'); await sleep(150);
check((await ev(() => document.querySelector('#pan-len').getAttribute('aria-pressed'))) === 'true' && /PRIMER/.test(await status()), '«Distancia» activa: pide el primer punto');
await page.mouse.click(pb.x + pb.width * 0.35, pb.y + pb.height * 0.45); await sleep(250);
check((await nPan()) === 0 && /SEGUNDO/.test(await status()), 'primer toque: pide el segundo');
await page.mouse.click(pb.x + pb.width * 0.55, pb.y + pb.height * 0.5); await sleep(300);
check((await nPan()) === 1 && /mm/.test(await status()), `segundo toque: medida creada (${(await status()).slice(0, 48)})`);
check(await page.locator('#pan-clear').isVisible(), 'con una medida aparece «Borrar medidas»');
await page.click('#pan-ang'); await sleep(150);
check((await ev(() => document.querySelector('#pan-len').getAttribute('aria-pressed') === 'false' && document.querySelector('#pan-ang').getAttribute('aria-pressed') === 'true')), '«Ángulo» suelta «Distancia»');
for (const [fx, fy] of [[0.3, 0.3], [0.3, 0.6], [0.6, 0.6]]) { await page.mouse.click(pb.x + pb.width * fx, pb.y + pb.height * fy); await sleep(250); }
await sleep(200);
const ang = await ev(() => { const m = window.tresd.V.getPanoMeas().find((x) => x.type === 'ang'); if (!m) return null; const u = [m.a[0] - m.v[0], m.a[1] - m.v[1]], w = [m.b[0] - m.v[0], m.b[1] - m.v[1]]; return Math.abs(Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1])) * 180 / Math.PI; });
check((await nPan()) === 2 && ang !== null && Math.abs(ang - 90) < 1.5, `tres toques: ángulo de ${ang && ang.toFixed(1)}° (esperado 90)`);
check(/°/.test(await status()), `valor en grados: ${(await status()).slice(0, 48)}`);
await page.mouse.click(pb.x + pb.width * 0.7, pb.y + pb.height * 0.3); await sleep(200);
await page.keyboard.press('Escape'); await sleep(200);
check((await nPan()) === 2, 'Esc cancela un ángulo a medias');
await shot('v0717_pano_medidas.png');
await page.click('#pan-clear'); await sleep(300);
check((await nPan()) === 0 && await page.locator('#pan-clear').isHidden(), 'al borrar las medidas el botón desaparece');
await page.click('#pan-ang'); await sleep(100);                 // herramienta apagada

console.log('— 4) y 5) polos en el hueso y orientación de los sagitales');
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
const pol = await ev(() => {
  const V = window.tresd.V, tmj = V.state.tmj, out = {};
  for (const sd of ['R', 'L']) {
    const p = tmj.poles[sd];
    // ¿hay hueso en el polo (o a menos de 0,6 mm)?
    const bone = (w) => { let mx = -9999; for (const dx of [-0.6, 0, 0.6]) for (const dy of [-0.6, 0, 0.6]) mx = Math.max(mx, tmj.smp.value([w[0] + dx, w[1] + dy, w[2]])); return mx; };
    const sag = tmj.series[sd].find((x) => x.key === 'sag0');
    out[sd] = { med: bone(p.med) >= tmj.thr, lat: bone(p.lat) >= tmj.thr, width: +Math.hypot(p.lat[0] - p.med[0], p.lat[1] - p.med[1]).toFixed(1), axiBase: p.axiBase, exY: +sag.img.ex[1].toFixed(2), side: p.side };
  }
  return out;
});
console.log('   polos:', JSON.stringify(pol));
// En la muestra DZ el cóndilo DERECHO es pequeño y raro (la sección aislada más grande no es la cabeza): ahí
// el algoritmo debe RECHAZAR la sección y conservar los polos clásicos. El izquierdo es un cóndilo normal.
check(pol.L.med && pol.L.lat, 'L: los dos polos caen sobre hueso (sección axial más ancha)');
check(pol.L.width >= 12 && pol.L.width <= 26, `L: anchura medio-lateral ${pol.L.width} mm (cabeza del cóndilo: 15–20 típica)`);
check(Math.abs(pol.L.axiBase) <= 2, `L: el centro de los polos está en la sección más ancha (axial base ${pol.L.axiBase} mm)`);
check(pol.R.width >= 12 && pol.R.width <= 26, `R: la sección incoherente se rechaza y se conservan los polos clásicos (${pol.R.width} mm)`);
check(pol.R.exY < 0 && pol.L.exY > 0, `sagitales: derecho con anterior a la DERECHA (ex·Y=${pol.R.exY}), izquierdo con posterior a la derecha (ex·Y=${pol.L.exY})`);
await ev(() => window.tresd.renderTmj());
await page.click('#lay-atm'); await sleep(900);
await page.click('#atm-poles'); await sleep(900);
await shot('v0717_polos.png');
await page.click('#dlg-cancel'); await sleep(300);

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
