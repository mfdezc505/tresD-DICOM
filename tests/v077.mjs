// Comprobaciones de v0.7.7 (peticiones de Manuel del 15-09-2026):
//  1) el botón de Captura funciona también en la PANORÁMICA y en el mosaico de ATM (antes no hacía nada:
//     ninguno de los dos es un visor de Cornerstone y `screenshot` devolvía null)
//  2) doble clic sobre un corte de ATM lo amplía
//  3) la casilla «curva» de la panorámica arranca DESACTIVADA
// Uso: node tests/v077.mjs
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
await new Promise((r) => server.listen(8795, r));
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
const OUT = '/tmp/testdata/shots_v077';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
page.on('download', async (d) => { try { await d.saveAs(path.join(OUT, d.suggestedFilename() || 'x.png')); } catch (e) {} });
const shots = () => fs.readdirSync(OUT).map((f) => ({ n: f, b: fs.statSync(path.join(OUT, f)).size }));

await page.goto('http://localhost:8795/');
await sleep(600);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1200);
check(true, 'CBCT cargado');

console.log('— 3) la casilla «curva» arranca desactivada');
check((await ev(() => document.querySelector('#pan-curve').checked)) === false, 'la casilla «curva» está desmarcada al abrir');
check((await ev(() => window.tresd.V.state.showArch)) === false, 'la curva NO se dibuja sobre el axial');

console.log('— 1a) captura de la PANORÁMICA');
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano, null, { timeout: 300000 });
await sleep(1500);
check((await ev(() => document.querySelector('#pan-curve').checked)) === false, 'sigue desmarcada con la panorámica en pantalla');
const before = shots().length;
await page.click('#btn-shot'); await sleep(2500);
const s1 = shots();
check(s1.length === before + 1, `se descarga la captura de la panorámica (${s1.length - before})`);
check(s1.length > before && s1[s1.length - 1].b > 20000, `el PNG tiene contenido (${Math.round((s1[s1.length - 1] || {}).b / 1024)} kB)`);
check(/PNG/.test(fs.readFileSync(path.join(OUT, s1[s1.length - 1].n)).subarray(0, 8).toString('latin1')), 'es un PNG válido');
await shot('v077_pan.png');

console.log('— cortes de ATM');
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
await ev(() => window.tresd.renderTmj());
await page.click('#lay-atm');
await sleep(1000);

console.log('— 2) doble clic para ampliar un corte');
const box = await page.locator('#atm-grid .atm-cell[data-key="sag0"]').first().boundingBox();
await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
await sleep(700);
check(await page.locator('.modal.atm-big').isVisible(), 'el doble clic abre el corte ampliado');
const tit = await ev(() => { const h = document.querySelector('#ab-title'); return h ? h.textContent : ''; });
check(/Sagital/.test(tit), `es el corte sobre el que se hizo doble clic (${tit})`);
await page.click('#ab-close'); await sleep(400);
check((await page.locator('.modal.atm-big').count()) === 0, 'se cierra');
// el arrastre normal (brillo/contraste) sigue funcionando después
const w0 = await ev(() => window.tresd.V.getTmjWindow());
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
await page.mouse.up(); await sleep(300);
const w1 = await ev(() => window.tresd.V.getTmjWindow());
check(Math.abs(w1.upper - w0.upper) > 1, 'arrastrar sigue ajustando el brillo/contraste');

console.log('— 1b) captura del MOSAICO de ATM');
const before2 = shots().length;
await page.click('#btn-shot'); await sleep(2500);
const s2 = shots();
check(s2.length === before2 + 1, `se descarga la captura del mosaico (${s2.length - before2})`);
check(s2.length > before2 && s2[s2.length - 1].b > 20000, `el PNG tiene contenido (${Math.round((s2[s2.length - 1] || {}).b / 1024)} kB)`);
await shot('v077_atm.png');

console.log('— la captura normal (2×2) sigue funcionando');
await page.click('[data-layout="quad"]'); await sleep(1500);
const before3 = shots().length;
await page.click('#btn-shot'); await sleep(2500);
check(shots().length === before3 + 1, 'se descarga la captura de los cuatro visores');

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
