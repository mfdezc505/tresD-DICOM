// Capturas del fallo del bloque de cortes fuera de sitio: ANTES (variante indetectable) y DESPUÉS.
// Uso: node tests/_dbg_wrap.mjs
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
await new Promise((r) => server.listen(8784, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); } catch (e) {} });
page.setDefaultTimeout(300000);
page.on('console', (m) => { if (/tresD orden/.test(m.text())) console.log('   ', m.text().slice(0, 200)); });

for (const [dir, name] of [['/tmp/testdata/cbct_wrap_sinpista', 'wrap_antes'], ['/tmp/testdata/cbct_wrap', 'wrap_despues']]) {
  await page.goto('http://localhost:8784/'); await page.waitForTimeout(600);
  await page.setInputFiles('#in-folder', dir);
  await page.waitForFunction(() => /^(Cargado|Aviso|Error|No se|Volumen)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
  await page.waitForTimeout(4000);
  const rot = await page.evaluate(() => window.tresd.V.state.series.rotTail || 0);
  console.log(name, '· cortes movidos', rot);
  await page.screenshot({ path: `${ROOT}/tests/out/${name}.png` });
}
await browser.close(); server.close();
