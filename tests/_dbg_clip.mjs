// Comprobación del RECORTE del visor 3D al hacer zoom (v0.7.1): con el volumen oculto y solo la malla,
// acercar mucho la rueda cortaba el modelo. Se hacen capturas antes / después de varios zooms.
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const DOCS = '/home/claude/tresD_DICOM/docs', OUT = '/home/claude/tresD_DICOM/tests/out';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(DOCS, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(8782, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); } catch (e) {} });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('  pageerror', e.message));
await page.goto('http://localhost:8782/'); await page.waitForTimeout(600);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await page.setInputFiles('#in-mesh', ['/tmp/testdata/real_scans/upper.stl']);
await page.waitForSelector('.modal'); await page.click('input[name="dm-role"][value="upper"]'); await page.click('#dlg-ok');
await page.waitForFunction(() => /^(Escáner añadido|No se pudo|Error)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
// FLUJO REAL: botón «Alinear por puntos» de la tarjeta del escáner
await page.click('[data-layout="vp3d"]'); await page.waitForTimeout(1500);
await page.click('#mesh-cards .card[data-role="upper"] .m-points'); await page.waitForTimeout(1500);
const b = await page.locator('#vp3d').boundingBox();
const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
const rango = () => page.evaluate(() => { const c = window.tresd.V.getEngine().getViewport('vp3d').getRenderer().getActiveCamera(); const p = c.getPosition(), f = c.getFocalPoint(); const n = c.getDirectionOfProjection(); const d = (f[0]-p[0])*n[0]+(f[1]-p[1])*n[1]+(f[2]-p[2])*n[2]; return { clip: c.getClippingRange().map((v) => +v.toFixed(1)), scale: +c.getParallelScale().toFixed(1), dist: +d.toFixed(1), pos: p.map((v) => +v.toFixed(1)) }; });
await page.screenshot({ path: path.join(OUT, 'clip_0.png'), clip: b });
console.log('inicio', JSON.stringify(await rango()));
for (let i = 1; i <= 6; i++) {
  await page.mouse.move(cx + b.width * 0.18, cy + b.height * 0.10);   // el ratón SOBRE el modelo, fuera del centro
  for (let k = 0; k < 12; k++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
  await page.waitForTimeout(1200);
  console.log('zoom', i, JSON.stringify(await rango()), 'dbg', JSON.stringify(await page.evaluate(() => window.tresd.V.state.clipDbg)));
  await page.screenshot({ path: path.join(OUT, `clip_${i}.png`), clip: b });
}
await browser.close(); server.close();
