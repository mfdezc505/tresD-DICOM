// Panorámica v0.7.1: MIP por defecto, grosor en vivo y edición de la curva (puntos de control).
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const DOCS = '/home/claude/tresD_DICOM/docs', OUT = '/home/claude/tresD_DICOM/tests/out';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(DOCS, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(8783, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); } catch (e) {} });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('  pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('  [error]', m.text().slice(0, 200)); });
const ev = (fn, a) => page.evaluate(fn, a);
await page.goto('http://localhost:8783/'); await page.waitForTimeout(600);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano && document.querySelector('#pan-canvas').width > 100, null, { timeout: 300000 });
await page.waitForTimeout(600);
console.log('MIP por defecto:', await page.isChecked('#pan-mip'), JSON.stringify(await ev(() => ({ mip: window.tresd.V.state.pano.mip, th: window.tresd.V.state.pano.thickness, ctrl: window.tresd.V.state.pano.curve.control.length }))));
await page.screenshot({ path: path.join(OUT, 'pano_mip.png') });
// grosor EN VIVO
await page.locator('#pan-thick').evaluate((el) => { el.value = 24; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForFunction(() => window.tresd.V.state.pano.thickness === 24, null, { timeout: 60000 });
console.log('grosor en vivo (solo input):', await ev(() => window.tresd.V.state.pano.thickness));
// EDICIÓN de la curva
await page.click('#pan-edit'); await page.waitForTimeout(1500);
console.log('disposición', await ev(() => document.querySelector('#grid').dataset.layout), 'edit', await ev(() => window.tresd.V.state.panoEdit));
await page.screenshot({ path: path.join(OUT, 'pano_edit.png') });
const before = await ev(() => window.tresd.V.state.pano.curve.control.map((p) => p.map((v) => +v.toFixed(1))));
// arrastrar el punto de control central 8 mm hacia delante (−Y)
const box = await page.locator('#vpAx').boundingBox();
const pos = await ev(() => { const V = window.tresd.V, c = V.state.pano.curve, p = c.control[4]; const vp = V.getEngine().getViewport('vpAx'); const a = vp.worldToCanvas([p[0], p[1], c.z]), b = vp.worldToCanvas([p[0], p[1] - 8, c.z]); return { a, b }; });
await page.mouse.move(box.x + pos.a[0], box.y + pos.a[1]);
await page.mouse.down();
await page.mouse.move(box.x + pos.b[0], box.y + pos.b[1], { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(2500);
const after = await ev(() => window.tresd.V.state.pano.curve.control.map((p) => p.map((v) => +v.toFixed(1))));
console.log('control 4 antes', before[4], 'después', after[4]);
console.log('resto sin tocar:', before.filter((_, i) => i !== 4).every((p, k) => { const q = after.filter((_, i) => i !== 4)[k]; return Math.abs(p[0] - q[0]) < 0.01 && Math.abs(p[1] - q[1]) < 0.01; }));
await page.screenshot({ path: path.join(OUT, 'pano_edit2.png') });
// deshacer
await page.keyboard.press('Control+z'); await page.waitForTimeout(2000);
console.log('tras deshacer', await ev(() => window.tresd.V.state.pano.curve.control[4].map((v) => +v.toFixed(1))));
// curva automática
await page.click('#pan-reset'); await page.waitForTimeout(2500);
console.log('tras restablecer', await ev(() => window.tresd.V.state.pano.curve.control[4].map((v) => +v.toFixed(1))), await page.textContent('#status-text'));
await browser.close(); server.close();
