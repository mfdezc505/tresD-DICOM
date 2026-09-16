// Comprobaciones de v0.7.11 (petición de Manuel del 15-09-2026): VALORACIÓN del software.
//  1) botón «★ Valorar» en el pie abre la ventana; sin estrellas no se puede enviar
//  2) al enviar, la valoración y el comentario van al Google Form (se intercepta la petición: no se envía de
//     verdad) y queda guardado que ya se valoró
//  3) la ventana automática sale pasado el tiempo con un caso cargado, y NO sale si ya se valoró o si el
//     usuario dijo «Ahora no» hace menos de 30 días
//  4) la política de privacidad menciona la valoración
// Uso: node tests/v0711.mjs
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
await new Promise((r) => server.listen(8799, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.removeItem('tresd_dicom_feedback'); } catch (e) {} window.__tresdFbDelay = 1500; });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(ROOT, 'tests/out', n) });
const sleep = (ms) => page.waitForTimeout(ms);
// el envío al formulario se INTERCEPTA: se guarda lo que iba a mandar y no llega a Google
const sent = [];
await page.route('https://docs.google.com/**', (route) => { const r = route.request(); sent.push({ url: r.url(), method: r.method(), body: r.postData() || '' }); route.fulfill({ status: 200, body: '' }); });

await page.goto('http://localhost:8799/');
await sleep(600);

console.log('— 1) botón del pie y ventana');
check((await ev(() => document.querySelector('#btn-feedback').textContent)) === '★ Valorar', 'la cabecera tiene «★ Valorar»');
await page.click('#btn-feedback'); await sleep(300);
check(await page.locator('.modal.feedback').isVisible(), 'se abre la ventana de valoración');
check(await page.locator('#fb-send').isDisabled(), '«Enviar» desactivado hasta elegir estrellas');
check((await page.locator('.fb-star').count()) === 5, 'cinco estrellas');
await page.click('.fb-star[data-v="4"]'); await sleep(150);
check((await page.locator('.fb-star.on').count()) === 4, 'cuatro estrellas encendidas al pulsar la cuarta');
check(!(await page.locator('#fb-send').isDisabled()), '«Enviar» se activa');
await page.fill('#fb-text', 'Muy útil para docencia. Falta exportar el informe.');
await shot('v0711_valoracion.png');

console.log('— 2) envío al formulario');
await page.click('#fb-send'); await sleep(800);
check(sent.length === 1 && sent[0].method === 'POST' && /formResponse$/.test(sent[0].url), `una petición POST al formulario (${sent.length})`);
const body = sent[0] ? sent[0].body : '';
check(/entry\.1125802240/.test(body) && /\b4\b/.test(body.split('entry.1125802240')[1] || ''), 'lleva la valoración 4 en la pregunta de estrellas');
check(/entry\.1984945003/.test(body) && /Muy útil para docencia/.test(body), 'lleva el comentario en la pregunta de texto');
check(/Gracias/.test(await ev(() => document.querySelector('.modal.feedback').textContent)), 'muestra «¡Gracias!»');
await sleep(1600);
check((await page.locator('.modal.feedback').count()) === 0, 'la ventana se cierra sola');
check((await ev(() => window.tresd.feedbackState())) === 'done', 'queda guardado que ya se valoró');

console.log('— 3) ventana automática');
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(2500);
check((await page.locator('.modal.feedback').count()) === 0, 'ya valorado: NO vuelve a salir al cargar un caso');
// «Ahora no» reciente: tampoco
await ev(() => localStorage.setItem('tresd_dicom_feedback', 'later:' + Date.now()));
await page.reload(); await sleep(600);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(2500);
check((await page.locator('.modal.feedback').count()) === 0, '«Ahora no» hace poco: tampoco sale');
// sin nada guardado: sale sola pasado el tiempo (1,5 s en la prueba, 5 min de verdad)
await ev(() => localStorage.removeItem('tresd_dicom_feedback'));
await page.reload(); await sleep(600);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await page.waitForSelector('.modal.feedback', { timeout: 20000 });
check(true, 'con un caso cargado, la ventana sale sola pasado el tiempo');
await page.click('#fb-later'); await sleep(300);
check((await page.locator('.modal.feedback').count()) === 0 && /^later:/.test(await ev(() => window.tresd.feedbackState())), '«Ahora no» la cierra y lo recuerda');
check(sent.length === 1, 'no se envió nada más');

console.log('— 4) privacidad');
await page.click('.legal-links a[data-legal="privacy"]'); await sleep(500);
const priv = await ev(() => document.body.textContent);
check(/Valoración voluntaria/.test(priv) && /Google Forms/.test(priv), 'la política de privacidad explica la valoración');

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
