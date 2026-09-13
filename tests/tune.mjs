// Experimentos de RENDER: carga la serie, deja solo el visor 3D (frontal) y captura variantes de
// sombreado/gradiente aplicadas con window.tresd.V.tune(...). Uso: node tests/tune.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(ROOT, 'tests', 'out', 'tune');
fs.mkdirSync(OUT, { recursive: true });
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
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, locale: 'es-ES' });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8769/'); await page.waitForTimeout(1200);
await page.setInputFiles('#in-folder', process.argv[2] || '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Error|No se)/.test(document.querySelector('#status-text').textContent), null, { timeout: 240000 });
await page.click('[data-layout="vp3d"]'); await page.waitForTimeout(500);

const VARIANTS = JSON.parse(process.argv[3] || 'null') || [
  { name: 'A_defecto', tune: null },
  { name: 'B_normalOpacidad', tune: { normalFromOpacity: true } },
  { name: 'C_mas_ambiente', tune: { shade: [0.6, 0.7, 0.15, 20] } },
  { name: 'D_sin_gradiente', tune: { grad: null } },
];
for (const v of VARIANTS) {
  await page.evaluate((tune) => window.tresd.V.tune(tune), v.tune);
  await page.waitForTimeout(600);
  const t0 = Date.now();
  await page.locator('#vp3d').screenshot({ path: path.join(OUT, v.name + '.png') });
  console.log(v.name, ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
await browser.close(); server.close();
