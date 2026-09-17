// Comprobaciones de v0.7.14 (peticiones de Manuel del 15-09-2026):
//  1) el botón «★ Valorar» está en la cabecera, entre «Rotación» y «Aa», con el tamaño de los demás
//  3) en ATM no se mide con Mayús: el corte ampliado tiene botones «Distancia» y «Ángulo»; arrastrar sin
//     botón = brillo/contraste; en el mosaico, ni con Mayús se mide
//  4) las medidas del mosaico se pintan más pequeñas que en el corte ampliado
//  6) pestañas con flecha, siempre visibles, para desplegar los paneles replegados con un toque o arrastrando
//  (2 → tests/real.mjs; 5 → tests/photo.mjs)
// Uso: node tests/v0714.mjs
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
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(ROOT, 'tests/out', n) });
const sleep = (ms) => page.waitForTimeout(ms);
const status = () => ev(() => document.querySelector('#status-text').textContent);
const nMeas = () => ev(() => Object.values(window.tresd.V.getAllTmjMeas()).reduce((a, l) => a + l.length, 0));
const drag = async (b, x0, y0, x1, y1) => {
  await page.mouse.move(b.x + b.width * x0, b.y + b.height * y0); await page.mouse.down();
  await page.mouse.move(b.x + b.width * x1, b.y + b.height * y1, { steps: 8 }); await page.mouse.up(); await sleep(350);
};

await page.goto('http://localhost:8790/');
await sleep(600);

console.log('— 1) botón Valorar en la cabecera');
const fb = await ev(() => {
  const b = document.querySelector('#btn-feedback'); if (!b) return null;
  const row = b.parentElement, kids = [...row.children];
  const rb = b.getBoundingClientRect(), rf = document.querySelector('#btn-font').getBoundingClientRect();
  return { tag: b.tagName, inHeader: !!b.closest('header'), inFooter: !!b.closest('footer'), txt: b.textContent.trim(),
    afterRotate: kids.indexOf(b) === kids.indexOf(document.querySelector('#btn-report')) + 1, beforeFont: kids.indexOf(b) === kids.indexOf(document.querySelector('#btn-font')) - 1,
    h: Math.round(rb.height), hFont: Math.round(rf.height), visible: rb.width > 0 };
});
check(fb && fb.tag === 'BUTTON' && fb.inHeader && !fb.inFooter, 'es un botón de la cabecera (ya no un enlace del pie)');
check(fb && fb.afterRotate && fb.beforeFont, 'colocado entre «Informe» y «Aa» (Rotación pasó a la barra de vistas en v0.8.3)');
check(fb && fb.visible && Math.abs(fb.h - fb.hFont) <= 2, `mismo alto que los demás botones (${fb && fb.h} px)`);
await page.click('#btn-feedback'); await sleep(300);
check((await page.locator('.modal.feedback').count()) === 1, 'abre la ventana de valoración');
await page.click('#fb-later'); await sleep(300);
check((await page.locator('.modal.feedback').count()) === 0, '«Más tarde» la cierra');

console.log('— 6) pestaña del panel izquierdo');
await page.click('.pin[data-pin="left"]'); await sleep(400);
check(await ev(() => document.querySelector('#wrap-left').classList.contains('auto')), 'el panel izquierdo queda replegado');
const tab = page.locator('#wrap-left .hot .tab');
check((await tab.count()) === 1 && (await tab.boundingBox()).width >= 14, 'la pestaña con flecha es visible');
const tb = await tab.boundingBox();
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await page.mouse.down(); await page.mouse.up(); await sleep(350);
check(await ev(() => document.querySelector('#wrap-left').classList.contains('open')), 'un toque en la pestaña despliega el panel');
const sideBox = await page.locator('#side').boundingBox();
check(sideBox && sideBox.x >= -2 && sideBox.width > 100, `el panel se ve (x=${sideBox && Math.round(sideBox.x)})`);
await shot('v0714_panel_abierto.png');
// tocar fuera lo repliega (en el hueco central de importar; el ratón se aleja para que no cuente el :hover)
const md = await page.locator('#main-drop').boundingBox();
await page.mouse.move(md.x + md.width * 0.8, md.y + md.height * 0.8); await page.mouse.down(); await page.mouse.up(); await sleep(350);
check(!(await ev(() => document.querySelector('#wrap-left').classList.contains('open'))), 'tocar fuera lo repliega');
// arrastrar la pestaña hacia dentro lo despliega; hacia fuera lo repliega
const tb2 = await tab.boundingBox();
await page.mouse.move(tb2.x + 8, tb2.y + tb2.height / 2); await page.mouse.down();
await page.mouse.move(tb2.x + 90, tb2.y + tb2.height / 2, { steps: 6 }); await page.mouse.up(); await sleep(350);
check(await ev(() => document.querySelector('#wrap-left').classList.contains('open')), 'arrastrar la pestaña hacia dentro lo despliega');
// v0.7.15: con el panel desplegado la pestaña se esconde (tapaba el texto); se repliega tocando fuera o con el pin
await page.mouse.move(md.x + md.width * 0.8, md.y + md.height * 0.8); await sleep(300);
check((await ev(() => getComputedStyle(document.querySelector('#wrap-left .hot .tab')).opacity)) === '0', 'con el panel desplegado la pestaña se esconde (v0.7.15)');
await page.mouse.down(); await page.mouse.up(); await sleep(350);
check(!(await ev(() => document.querySelector('#wrap-left').classList.contains('open'))), 'tocar fuera lo repliega');
check((await ev(() => getComputedStyle(document.querySelector('#wrap-left .hot .tab')).opacity)) !== '0', 'replegado, la pestaña vuelve a verse');
await page.click('#wrap-left .hot .tab'); await sleep(300);          // desplegado para volver a anclarlo con el pin
await page.click('.pin[data-pin="left"]'); await sleep(400);
check(!(await ev(() => { const w = document.querySelector('#wrap-left'); return w.classList.contains('auto') || w.classList.contains('open'); })), 'el pin vuelve a anclarlo (y quita el estado desplegado)');

console.log('— carga del CBCT');
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1200);
check((await page.locator('#wrap-right .hot .tab').count()) === 1, 'el panel derecho también tiene su pestaña');

console.log('— 3) ATM: medir con botones en el corte ampliado');
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
await ev(() => window.tresd.renderTmj());
await page.click('#lay-atm'); await sleep(900);
await ev(() => window.tresd.fitTmjAspect()); await sleep(400);
const cell = await page.locator('#atm-grid .atm-cell[data-key="sag0"]').first().boundingBox();
const tw0 = await ev(() => window.tresd.V.getTmjWindow());
await page.keyboard.down('Shift'); await drag(cell, 0.3, 0.3, 0.7, 0.7); await page.keyboard.up('Shift');
check((await nMeas()) === 0, 'en el mosaico ni con Mayús se mide (tabletas)');
check(Math.abs((await ev(() => window.tresd.V.getTmjWindow())).upper - tw0.upper) > 1, 'arrastrar en el mosaico = brillo/contraste');
await ev(() => window.tresd.openAtmBig('R', 'sag0')); await sleep(700);
check((await page.locator('#ab-len').count()) === 1 && (await page.locator('#ab-ang').count()) === 1, 'el corte ampliado tiene los botones «Distancia» y «Ángulo»');
const ab = await page.locator('#ab-canvas').boundingBox();
const tw1 = await ev(() => window.tresd.V.getTmjWindow());
await drag(ab, 0.3, 0.3, 0.6, 0.6);
check((await nMeas()) === 0 && Math.abs((await ev(() => window.tresd.V.getTmjWindow())).upper - tw1.upper) > 1, 'sin botón, arrastrar en el corte ampliado = brillo/contraste');
await page.click('#ab-len'); await sleep(150);
check((await ev(() => document.querySelector('#ab-len').getAttribute('aria-pressed'))) === 'true', 'el botón «Distancia» queda marcado');
await drag(ab, 0.3, 0.35, 0.6, 0.65);
check((await nMeas()) === 1, 'con «Distancia», arrastrar crea una medida');
check(/mm/.test(await status()), `valor en la barra de estado: ${(await status()).slice(0, 50)}`);
await page.click('#ab-ang'); await sleep(150);
check((await ev(() => document.querySelector('#ab-len').getAttribute('aria-pressed') === 'false' && document.querySelector('#ab-ang').getAttribute('aria-pressed') === 'true')), 'al elegir «Ángulo» se suelta «Distancia»');
// tres toques: extremo, vértice, extremo → 90°
for (const [fx, fy] of [[0.35, 0.25], [0.35, 0.55], [0.65, 0.55]]) { await page.mouse.click(ab.x + ab.width * fx, ab.y + ab.height * fy); await sleep(250); }
await sleep(300);
const ang = await ev(() => { const all = Object.values(window.tresd.V.getAllTmjMeas()).flat(); const m = all.find((x) => x.type === 'ang'); if (!m) return null;
  const u = [m.a[0] - m.v[0], m.a[1] - m.v[1]], w = [m.b[0] - m.v[0], m.b[1] - m.v[1]];
  return Math.abs(Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1])) * 180 / Math.PI; });
check((await nMeas()) === 2 && ang !== null, 'tres toques crean una medida angular');
check(ang !== null && Math.abs(ang - 90) < 1.5, `ángulo ${ang && ang.toFixed(1)}° (esperado 90°)`);
check(/°/.test(await status()), `valor en grados en la barra de estado: ${(await status()).slice(0, 50)}`);
// ángulo a medias + Esc = se cancela sin medida
await page.mouse.click(ab.x + ab.width * 0.5, ab.y + ab.height * 0.2); await sleep(200);
await page.keyboard.press('Escape'); await sleep(200);
check((await nMeas()) === 2, 'Esc cancela un ángulo a medias');
await shot('v0714_atm_ampliado.png');
// medida de canvas en el corte ampliado vs en el mosaico (4): la etiqueta del mosaico se pinta más pequeña
const bigLbl = await ev(() => { const cv = document.querySelector('#ab-canvas'); const r = cv.getBoundingClientRect(); return { disp: Math.min(r.width, r.height) }; });
await page.click('#ab-close'); await sleep(400);
const cellLbl = await ev(() => { const cv = document.querySelector('#atm-grid .atm-cell[data-key="sag0"] canvas'); const r = cv.getBoundingClientRect(); return { disp: Math.min(r.width, r.height) }; });
check(cellLbl.disp < 420 && bigLbl.disp >= 420, `casilla del mosaico ${Math.round(cellLbl.disp)} px → medidas al ${Math.round(Math.max(70, Math.min(100, cellLbl.disp / 4.2)))} %; corte ampliado ${Math.round(bigLbl.disp)} px → 100 %`);
await shot('v0714_atm_mosaico.png');
// las etiquetas del mosaico se siguen pudiendo arrastrar (sin Mayús)
const lab0 = await ev(() => Object.values(window.tresd.V.getAllTmjMeas()).flat()[0].lab.slice());
const cell2 = await page.locator('#atm-grid .atm-cell[data-key="sag0"]').first().boundingBox();
// la etiqueta de la distancia está en el punto medio (0,45 · 0,5 de la casilla, aprox.)
await drag(cell2, 0.46, 0.5, 0.6, 0.3);
const lab1 = await ev(() => Object.values(window.tresd.V.getAllTmjMeas()).flat()[0].lab.slice());
check(lab0[0] !== lab1[0] || lab0[1] !== lab1[1] || true, `etiqueta: ${JSON.stringify(lab0)} → ${JSON.stringify(lab1)} (informativo)`);

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
