// Prueba de humo en Chromium sin cabeza: sirve docs/, abre la app, carga una serie DICOM de
// prueba, ejercita las herramientas y saca capturas a tests/out/. Uso: node tests/smoke.mjs [carpetaDICOM]
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const DATA = process.argv[2] || '/tmp/testdata/cbct_half';
const OUT = path.join(ROOT, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8765, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
  page.setDefaultTimeout(180000);
const logs = [];
page.on('console', (m) => { const s = `[${m.type()}] ${m.text()}`; logs.push(s); if (m.type() === 'error' || m.type() === 'warning') console.log(s.slice(0, 400)); });
page.on('pageerror', (e) => { logs.push('[pageerror] ' + e.message); console.log('[pageerror]', e.message); });

await page.goto('http://localhost:8765/');
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '01_vacio.png') });

// cargar la serie por el input de carpeta
const files = fs.readdirSync(DATA).filter((f) => !f.startsWith('.')).map((f) => path.join(DATA, f));
console.log('archivos:', files.length);
await page.setInputFiles('#in-folder', DATA);
await page.waitForFunction(() => /^(Cargado|Error|No se|Volumen)/.test(document.querySelector('#status-text').textContent), null, { timeout: 180000 });
console.log('estado:', await page.textContent('#status-text'));
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, '02_cargado_2x2.png') });

// vistas y disposiciones
await page.click('[data-view="lat_r"]'); await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, '03_lateral_d.png') });
await page.click('[data-layout="vp3d"]'); await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '04_solo3d.png') });
// preset y corte
await page.selectOption('#dicom-preset', 'natural'); await page.waitForTimeout(800);
await page.check('#cut-x'); await page.fill('#cut-slider', '55'); await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(OUT, '05_corte_sagital_natural.png') });
await page.check('#cut-flip'); await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, '06_corte_volteado.png') });
await page.uncheck('#cut-x');
// medición 3D: dos clics sobre el hueso
await page.click('#btn-dist');
const box = await page.locator('#vp3d').boundingBox();
await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
await page.waitForTimeout(400);
await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.55);
await page.waitForTimeout(600);
// segunda medición encadenada (el modo sigue activo) y arrastre de su etiqueta
await page.mouse.click(box.x + box.width * 0.47, box.y + box.height * 0.44); await page.waitForTimeout(300);
await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.47); await page.waitForTimeout(800);
console.log('mediciones 3D:', await page.locator('#vp3d .mlabel').count(), '| estado:', await page.textContent('#status-text'));
const lb = await page.locator('#vp3d .mlabel').nth(1).boundingBox();
await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2); await page.mouse.down();
await page.mouse.move(lb.x + lb.width / 2 + 60, lb.y + lb.height / 2 - 40, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, '07_medicion_3d.png') });
await page.click('#btn-dist');       // apaga el modo
console.log('estado tras apagar medición:', await page.textContent('#status-text'));
// planos MPR en el 3D
await page.click('#mpr-card .ctitle');
await page.check('#mpr-z'); await page.check('#mpr-x'); await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '08_planos_mpr_3d.png') });
// axial ampliado + rueda + medición MPR
await page.click('[data-layout="vpAx"]'); await page.waitForTimeout(1000);
const ab = await page.locator('#vpAx').boundingBox();
await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
for (let i = 0; i < 15; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
await page.waitForTimeout(800);
await page.click('#btn-ang');
await page.mouse.click(ab.x + ab.width * 0.4, ab.y + ab.height * 0.4); await page.waitForTimeout(200);
await page.mouse.click(ab.x + ab.width * 0.5, ab.y + ab.height * 0.6); await page.waitForTimeout(200);
await page.mouse.click(ab.x + ab.width * 0.65, ab.y + ab.height * 0.45); await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, '09_axial_angulo.png') });
console.log('info axial:', await page.textContent('.vp[data-id="vpAx"] .vpinfo'));
// metadatos
await page.click('[data-layout="quad"]'); await page.waitForTimeout(800);
await page.click('#btn-meta'); await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, '10_metadatos.png') });
console.log('filas metadatos:', await page.locator('#meta-table tbody tr').count());
await page.click('#meta-close');
// tema claro
await page.click('#btn-theme'); await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(OUT, '11_tema_claro.png') });
await page.click('#btn-theme'); await page.waitForTimeout(300);
// paneles replegables: replegar los dos y luego asomar el izquierdo con el ratón en el borde
await page.click('[data-pin="left"]'); await page.click('[data-pin="right"]'); await page.waitForTimeout(700);
await page.mouse.move(700, 450); await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, '12_paneles_replegados.png') });
await page.mouse.move(4, 450); await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, '13_panel_izq_asoma.png') });
await page.mouse.move(700, 450); await page.waitForTimeout(300);
await page.hover('#wrap-left .hot'); await page.waitForTimeout(400);
await page.click('[data-pin="left"]'); await page.mouse.move(1490, 450); await page.waitForTimeout(400);
await page.click('[data-pin="right"]'); await page.waitForTimeout(500);
// tamaño de letra grande + inglés
await page.click('#btn-font'); await page.waitForTimeout(200);
await page.click('.menu button:nth-child(3)'); await page.waitForTimeout(400);
await page.click('#btn-lang'); await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, '14_letra_grande_en.png') });
console.log('vistas EN:', await page.evaluate(() => Array.from(document.querySelectorAll('#view-bar [data-view]')).map((b) => b.textContent).join(' | ')));

fs.writeFileSync(path.join(OUT, 'console.log'), logs.join('\n'));
const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
console.log('errores de consola:', errs.length);
await browser.close();
server.close();
