// Variantes de luz/sombreado para elegir el look (marfil, lateral, tema oscuro y claro).
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname); const DOCS = path.join(ROOT, 'docs'); const OUT = path.join(ROOT, 'tests', 'out');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(DOCS, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(8774, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--js-flags=--max-old-space-size=6000'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); Object.defineProperty(navigator, 'deviceMemory', { get: () => 32 }); } catch (e) {} });
page.setDefaultTimeout(600000);
await page.goto('http://localhost:8774/'); await page.waitForTimeout(1200);
await page.setInputFiles('#in-folder', process.argv[2] || '/tmp/testdata/cbct_full');
await page.waitForFunction(() => /^(Cargado|Error|No se|Volumen)/.test(document.querySelector('#status-text').textContent), null, { timeout: 600000 });
await page.click('[data-layout="vp3d"]'); await page.click('[data-view="lat_r"]'); await page.waitForTimeout(2000);
// solo el visor 3D
const box = await page.locator('#vp3d').boundingBox();
const variants = JSON.parse(process.argv[3] || '[]');
for (const v of variants) {
  if (v.view) { await page.click(`[data-view="${v.view}"]`); }
  await page.evaluate((v) => { const V = window.tresd.V; if (v.theme) { const cur = document.documentElement.dataset.theme; if (cur !== v.theme) document.querySelector('#btn-theme').click(); } if (v.preset) { V.setPreset(v.preset); } if (v.lights != null) V.tuneLights(v.lights); V.tune(v.tune || null); }, v);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(OUT, `rv_${v.name}.png`), clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  console.log('ok', v.name);
}
await browser.close(); server.close();
