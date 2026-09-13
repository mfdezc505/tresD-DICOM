// Prueba de CARGA por distintas vías: carpeta con DICOMDIR, ZIP, serie RLE y serie JPEG2000 (codecs wasm).
// Uso: node tests/loaders.mjs
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
await new Promise((r) => server.listen(8767, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });

const CASES = [
  { name: 'full', input: '#in-folder', files: '/tmp/testdata/cbct_full' },
  { name: 'unsigned', input: '#in-folder', files: '/tmp/testdata/cbct_unsigned' },
  { name: 'dicomdir', input: '#in-folder', files: '/tmp/testdata/cbct_dicomdir' },
  { name: 'zip', input: '#in-zip', files: ['/tmp/testdata/cbct_half.zip'] },
  { name: 'rle', input: '#in-folder', files: '/tmp/testdata/cbct_half_rle' },
  { name: 'j2k', input: '#in-folder', files: '/tmp/testdata/cbct_half_j2k' },
];
for (const c of (process.argv[2] ? CASES.filter((x) => x.name === process.argv[2]) : CASES)) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 }, locale: 'es-ES' });
  await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); } catch (e) {} });
  page.setDefaultTimeout(240000);
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.goto('http://localhost:8767/'); await page.waitForTimeout(1200);
  const t0 = Date.now();
  await page.setInputFiles(c.input, c.files);
  await page.waitForFunction(() => /^(Cargado|Error|No se|Volumen)/.test(document.querySelector('#status-text').textContent), null, { timeout: 240000 });
  const st = await page.textContent('#status-text');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `load_${c.name}.png`) });
  console.log(`[${c.name}] ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${st}`);
  if (errs.length) console.log(`[${c.name}] errores:`, errs.slice(0, 5));
  await page.close();
}
await browser.close(); server.close();
