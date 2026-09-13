// Prueba de la puerta de TÉRMINOS DE USO (primera visita) y de los enlaces legales del pie.
// Uso: node tests/legal.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(ROOT, 'tests', 'out');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8769, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, locale: 'es-ES' });
const errs = []; let fails = 0;
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };

await page.goto('http://localhost:8769/'); await page.waitForTimeout(1200);
check(await page.locator('.modal-bg.legal').isVisible(), 'primera visita: aparece la ventana de términos');
check(await page.locator('#legal-enter').isDisabled(), 'botón «Aceptar» desactivado hasta marcar la casilla');
check(/no dispone de marcado CE/.test(await page.locator('.legal-body').textContent()), 'texto: no es producto sanitario con marcado CE');
await page.screenshot({ path: path.join(OUT, 'l01_terminos.png') });
await page.click('.modal.legal [data-tab="privacy"]'); await page.waitForTimeout(200);
check(/GoatCounter/.test(await page.locator('.legal-body').textContent()), 'pestaña Privacidad: menciona GoatCounter');
await page.click('.modal.legal [data-lang="en"]'); await page.waitForTimeout(300);
check(/Privacy policy/.test(await page.locator('.legal-body').textContent()), 'cambio a inglés dentro de la ventana');
check((await page.textContent('#btn-lang')) === 'EN', 'la interfaz también pasa a inglés');
await page.click('.modal.legal [data-lang="es"]'); await page.waitForTimeout(300);
await page.click('.modal.legal [data-tab="notice"]'); await page.waitForTimeout(200);
check(/29002594/.test(await page.locator('.legal-body').textContent()), 'pestaña Aviso legal: nº de colegiado');
await page.check('#legal-ok');
check(await page.locator('#legal-enter').isEnabled(), 'casilla marcada → botón activo');
await page.click('#legal-enter'); await page.waitForTimeout(300);
check(await page.locator('.modal-bg.legal').count() === 0, 'tras aceptar desaparece la ventana');
check((await page.evaluate(() => localStorage.getItem('tresd_dicom_terms'))) === 'v1-2026-09', 'aceptación guardada en el navegador');
await page.reload(); await page.waitForTimeout(1200);
check(await page.locator('.modal-bg.legal').count() === 0, 'segunda visita: no vuelve a pedir');
// enlaces del pie
await page.click('.legal-links a[data-legal="privacy"]'); await page.waitForTimeout(300);
check(await page.locator('.modal-bg.legal').isVisible() && /Política de privacidad/.test(await page.locator('.legal-body').textContent()), 'enlace del pie abre Privacidad');
await page.screenshot({ path: path.join(OUT, 'l02_privacidad.png') });
await page.click('#legal-close'); await page.waitForTimeout(200);
check(await page.locator('.modal-bg.legal').count() === 0, 'Cerrar funciona');
console.log('errores de consola:', errs.length, errs.slice(0, 3));
console.log(fails ? `${fails} FALLOS` : 'TODO OK');
await browser.close(); server.close();
process.exit(fails || errs.length ? 1 : 0);
