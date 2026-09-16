// Comprobaciones de v0.7.16 (peticiones de Manuel del 16-09-2026):
//  1) Deshacer / Rehacer solo con flechas (sin texto), dejando sitio al chip del paciente
//  2) «✚ Nuevo caso»: ventana de confirmación y vuelta a la pantalla inicial (recarga)
//  3) ATM: la distancia se mide con DOS toques (y arrastrar sigue valiendo)
//  4) la panorámica ya no lleva la etiqueta «V · N · grosor · MIP» (se solapaba con la barra al editar)
//  5) la ayuda es una ventana del visor (no un alert) con secciones
// Uso: node tests/v0716.mjs
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
const errs = []; let fails = 0; let alerts = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('dialog', async (d) => { alerts++; await d.dismiss(); });
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(ROOT, 'tests/out', n) });
const sleep = (ms) => page.waitForTimeout(ms);
const status = () => ev(() => document.querySelector('#status-text').textContent);
const nMeas = () => ev(() => Object.values(window.tresd.V.getAllTmjMeas()).reduce((a, l) => a + l.length, 0));

await page.goto('http://localhost:8790/');
await sleep(600);

console.log('— 5) ayuda');
await page.click('#btn-help'); await sleep(400);
check(alerts === 0, 'ya no sale un alert del navegador');
check((await page.locator('.modal.help').count()) === 1, 'se abre una ventana del visor');
const secs = await ev(() => [...document.querySelectorAll('.modal.help .help-sec h4')].map((h) => h.textContent));
check(secs.length >= 10 && /Empezar/.test(secs[0]) && secs.some((s) => /ATM/.test(s)) && secs.some((s) => /Panorámica/.test(s)), `${secs.length} secciones: ${secs.slice(0, 3).join(' | ')} …`);
const items = await ev(() => document.querySelectorAll('.modal.help .help-sec li').length);
check(items >= 30, `${items} apartados de ayuda (antes 7 líneas)`);
check(/v0\.7\.\d+/.test(await ev(() => document.querySelector('.modal.help .help-about').textContent)), 'termina con la versión y los motores');
await shot('v0716_ayuda.png');
await page.keyboard.press('Escape'); await sleep(200);
check((await page.locator('.modal.help').count()) === 0, 'Esc la cierra');
// en inglés también hay contenido
await page.click('#btn-lang'); await sleep(400);
await page.click('#btn-help'); await sleep(300);
check(/Getting started/.test(await ev(() => document.querySelector('.modal.help .help-sec h4').textContent)), 'la ayuda existe en inglés');
await page.click('#help-close'); await sleep(200);
await page.click('#btn-lang'); await sleep(400);

console.log('— carga del CBCT');
check(await page.locator('#btn-new').isHidden(), 'sin caso no hay botón «Nuevo caso»');
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1500);

console.log('— 1) Deshacer / Rehacer compactos');
const ur = await ev(() => { const u = document.querySelector('#btn-undo'), r = document.querySelector('#btn-redo'); return { u: u.textContent.trim(), r: r.textContent.trim(), w: u.getBoundingClientRect().width, tip: u.title }; });
check(ur.u === '↶' && ur.r === '↷', `solo las flechas («${ur.u}» «${ur.r}»)`);
check(ur.w < 50, `botón estrecho (${Math.round(ur.w)} px)`);
check(/Deshacer/.test(ur.tip), `el texto sigue en el tooltip: «${ur.tip}»`);

console.log('— 4) panorámica sin la etiqueta V · N');
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano, null, { timeout: 300000 });
await sleep(1200);
check((await ev(() => !document.querySelector('#pan-info'))), 'no existe la etiqueta «V · N · grosor · MIP»');
check(!/MIP/.test(await ev(() => [...document.querySelectorAll('.vp[data-id="vpPan"] .vpinfo')].map((e) => e.textContent).join(''))), 'ningún rótulo de esquina en la panorámica');

console.log('— 3) ATM: distancia con dos toques');
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
await ev(() => window.tresd.renderTmj());
await page.click('#lay-atm'); await sleep(900);
await ev(() => window.tresd.openAtmBig('R', 'sag0')); await sleep(700);
await page.click('#ab-len'); await sleep(150);
const ab = await page.locator('#ab-canvas').boundingBox();
await page.mouse.click(ab.x + ab.width * 0.3, ab.y + ab.height * 0.35); await sleep(250);
check((await nMeas()) === 0 && /SEGUNDO/.test(await page.textContent('#ab-hint')), 'tras el primer toque pide el segundo (sin medida aún)');
await page.mouse.move(ab.x + ab.width * 0.5, ab.y + ab.height * 0.5); await sleep(200);
await shot('v0716_atm_primer_toque.png');
await page.mouse.click(ab.x + ab.width * 0.6, ab.y + ab.height * 0.65); await sleep(300);
check((await nMeas()) === 1, 'el segundo toque crea la distancia');
check(/mm/.test(await status()), `valor: ${(await status()).slice(0, 50)}`);
// arrastrar sigue valiendo
await page.mouse.move(ab.x + ab.width * 0.3, ab.y + ab.height * 0.7); await page.mouse.down();
await page.mouse.move(ab.x + ab.width * 0.6, ab.y + ab.height * 0.8, { steps: 8 }); await page.mouse.up(); await sleep(300);
check((await nMeas()) === 2, 'arrastrar también mide (ratón)');
// un toque y Esc = nada
await page.mouse.click(ab.x + ab.width * 0.4, ab.y + ab.height * 0.2); await sleep(200);
await page.keyboard.press('Escape'); await sleep(200);
check((await nMeas()) === 2 && !/SEGUNDO/.test(await page.textContent('#ab-hint')), 'Esc cancela un primer toque suelto');
await page.click('#ab-close'); await sleep(300);

console.log('— 2) Nuevo caso');
check(await page.locator('#btn-new').isVisible(), 'con caso cargado aparece «✚ Nuevo caso»');
await page.click('#btn-new'); await sleep(300);
check((await page.locator('.modal').count()) === 1 && /Empezar un caso nuevo/.test(await page.textContent('.modal h3')), 'pide confirmación');
await page.click('#dlg-cancel'); await sleep(200);
check((await page.locator('.modal').count()) === 0 && (await ev(() => window.tresd.V.hasCase())), 'Cancelar no cierra nada');
await page.click('#btn-new'); await sleep(200);
await page.click('#dlg-ok');
await page.waitForFunction(() => document.querySelector('#main-drop') && !document.querySelector('#main-drop').classList.contains('hidden') && document.querySelector('#status-text'), null, { timeout: 60000 });
await sleep(800);
check(!(await ev(() => window.tresd.V.hasCase())), 'tras aceptar, el visor está vacío');
check(await page.locator('#main-drop').isVisible() && await page.locator('#btn-new').isHidden(), 'vuelve la pantalla inicial de importar');
check((await ev(() => localStorage.getItem('tresd_dicom_terms'))) === 'v1-2026-09', 'los ajustes guardados se conservan');

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
