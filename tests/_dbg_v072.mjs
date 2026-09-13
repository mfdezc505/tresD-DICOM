// Vistazo rápido a los cambios de v0.7.2: panorámica (alto/curva/ventana) y ATM (1 mm, rueda, medidas).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname), DOCS = path.join(ROOT, 'docs');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8786, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); } catch (e) {} });
page.setDefaultTimeout(300000);
page.on('console', (m) => { const x = m.text(); if (/tresD ATM|tresD orden/.test(x)) console.log('  ', x.slice(0, 180)); if (m.type() === 'error') console.log('  ERR', x.slice(0, 200)); });
await page.goto('http://localhost:8786/');
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await page.waitForTimeout(1000);
// panorámica
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano, null, { timeout: 300000 });
await page.waitForTimeout(1500);
console.log('panorámica', await page.evaluate(() => {
  const p = window.tresd.V.state.pano, d = p.image.data;
  const s = []; for (let i = 0; i < d.length; i += 7) s.push(d[i]); s.sort((a, b) => a - b);
  const q = (x) => Math.round(s[Math.round((x / 100) * (s.length - 1))]);
  return { ctrlPts: p.curve.control.map((q)=>q.map((v)=>+v.toFixed(0))), z: +p.curve.z.toFixed(0), n: p.curve.pts.length, ctrl: p.curve.control.length, len: +p.curve.length.toFixed(0), w: p.image.width, h: p.image.height,
    win: [Math.round(p.win.lower), Math.round(p.win.upper)], pcts: { p5: q(5), p25: q(25), p40: q(40), p50: q(50), p62: q(62), p75: q(75), p90: q(90), p97: q(97), p99: q(99), p999: q(99.9) } };
}));
await page.screenshot({ path: `${ROOT}/tests/out/v072_pano.png` });
// ATM
await page.evaluate(() => { const V = window.tresd.V; return V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null); });
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
await page.waitForTimeout(500);
console.log('ATM', await page.evaluate(() => {
  const s = window.tresd.V.state.tmj;
  return { offs: s.series.R.map((x) => x.family + ':' + x.off), shift: s.shift.R };
}));
console.log('scroll', await page.evaluate(() => { window.tresd.V.scrollTmj('R', 'sag', 3); return window.tresd.V.state.tmj.series.R.map((x) => x.family + ':' + x.off); }));
await browser.close(); server.close();
