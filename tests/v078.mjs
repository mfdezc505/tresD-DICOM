// Comprobaciones de v0.7.8 (peticiones de Manuel del 15-09-2026):
//  1) la casilla «curva» arranca desactivada; editar la enciende y al salir vuelve a apagarse
//  2/4) la marca de agua es el logotipo «DICOM viewer» y se ve también sobre capturas de fondo CLARO
//  3) editando la curva, el GROSOR de la panorámica se dibuja con dos líneas finas sobre el axial
//  5) tras segmentar la vía aérea, el aviso de marcado desaparece (se quedaba puesto y «Cancelar» no hacía nada)
//  6) doble clic sobre la panorámica vuelve al 2×2
//  7) el axial de ATM arranca a la altura de la CABEZA del cóndilo (no en el ápice)
// Uso: node tests/v078.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCS = path.join(ROOT, 'docs');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8796, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); if (/tresD ATM/.test(tx)) console.log('   ', tx.slice(0, 200)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(ROOT, 'tests/out', n) });
const sleep = (ms) => page.waitForTimeout(ms);
const status = () => page.textContent('#status-text');
const waitStatus = (re) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector('#status-text').textContent), re.source, { timeout: 300000 });
const yellowAx = () => ev(() => { const cv = document.querySelector('#vpAx .silh'); const g = cv.getContext('2d'); const d = g.getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] > 200 && d[i + 1] > 180 && d[i + 2] < 120) n++; return n; });
const layoutIds = () => ev(() => [...document.querySelectorAll('#grid .vp')].filter((e) => !e.classList.contains('hidden')).map((e) => e.dataset.id).join(','));
/** Guarda la captura (dataURL) y mide, con PIL, el color medio de la esquina inferior derecha (donde va el logo). */
const cornerStats = (url, name) => {
  const f = path.join('/tmp/testdata', name); fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
  return JSON.parse(execSync(`python3 -c "
from PIL import Image; import json
im=Image.open('${f}').convert('RGB'); w,h=im.size
box=im.crop((int(w*0.82),int(h*0.93),int(w*0.985),int(h*0.985)))
bg=im.crop((int(w*0.82),int(h*0.85),int(w*0.985),int(h*0.90)))
px=list(box.getdata()); bgpx=list(bg.getdata())
mean=lambda l:[sum(p[i] for p in l)/len(l) for i in range(3)]
m=mean(px); b=mean(bgpx)
diff=sum(1 for p in px if abs(p[0]-b[0])+abs(p[1]-b[1])+abs(p[2]-b[2])>60)/len(px)
print(json.dumps({'w':w,'h':h,'corner':[round(v) for v in m],'bg':[round(v) for v in b],'frac':round(diff,3)}))
"`).toString());
};

await page.goto('http://localhost:8796/');
await sleep(600);
await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1200);
check(true, 'CBCT cargado');

console.log('— 1) curva desactivada por defecto; editar la enciende y al salir se apaga');
check((await ev(() => document.querySelector('#pan-curve').checked)) === false, 'casilla «curva» desmarcada al abrir');
await page.click('[data-layout="vpPan"]');
await page.waitForFunction(() => window.tresd.V.state.pano, null, { timeout: 300000 });
await sleep(1500);
check((await ev(() => document.querySelector('#pan-curve').checked)) === false && (await ev(() => window.tresd.V.state.showArch)) === false, 'sigue apagada con la panorámica calculada');
await page.click('#pan-edit'); await sleep(1500);
check((await ev(() => document.querySelector('#pan-curve').checked)) === true && (await ev(() => window.tresd.V.state.showArch)) === true, 'al editar se enciende');

console.log('— 3) líneas del grosor sobre el axial mientras se edita');
const yEdit = await yellowAx();
check(yEdit > 300, `curva + 2 líneas de grosor dibujadas (${yEdit} píxeles amarillos)`);
await page.locator('#pan-thick').evaluate((el) => { el.value = 8; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForFunction(() => window.tresd.V.state.pano && window.tresd.V.state.pano.thickness === 8, null, { timeout: 120000 });
await sleep(700);
const yThin = await yellowAx();
check(yThin !== yEdit, `las líneas siguen al grosor (22 mm: ${yEdit} px, 8 mm: ${yThin} px)`);
await shot('v078_grosor.png');
await page.click('#pan-edit'); await sleep(800);                       // salir de la edición
check((await ev(() => document.querySelector('#pan-curve').checked)) === false && (await ev(() => window.tresd.V.state.showArch)) === false, 'al salir de editar vuelve a apagarse');

console.log('— 6) doble clic sobre la panorámica → 2×2');
check((await layoutIds()) === 'vpPan', `panorámica sola en pantalla (${await layoutIds()})`);
const pBox = await page.locator('#pan-canvas').boundingBox();
await page.mouse.dblclick(pBox.x + pBox.width / 2, pBox.y + pBox.height / 2); await sleep(800);
check((await layoutIds()) === 'vp3d,vpAx,vpCor,vpSag', `vuelve al 2×2 (${await layoutIds()})`);
// también desde el modo de edición (axial + panorámica)
await page.click('[data-layout="vpPan"]'); await sleep(600); await page.click('#pan-edit'); await sleep(800);
check((await layoutIds()) === 'vpAx,vpPan', `editando: axial + panorámica (${await layoutIds()})`);
const pBox2 = await page.locator('#pan-canvas').boundingBox();
await page.mouse.dblclick(pBox2.x + pBox2.width / 2, pBox2.y + pBox2.height / 2); await sleep(800);
check((await layoutIds()) === 'vp3d,vpAx,vpCor,vpSag', `desde la edición también vuelve al 2×2 (${await layoutIds()})`);
check((await ev(() => document.querySelector('#pan-edit').getAttribute('aria-pressed'))) === 'false', 'y la edición queda cerrada');

console.log('— 5) vía aérea: el aviso de marcado desaparece al terminar');
const SUP = [-0.1, -32.16, 8.82], INF = [3.13, -29.54, -41.64];
await page.click('#btn-airway'); await sleep(800);
check(!(await page.locator('#aw-bar').evaluate((e) => e.classList.contains('hidden'))), 'barra de marcado visible');
const sagBox = await page.locator('#vpSag').boundingBox();
for (const w of [SUP, INF]) {
  const c = await ev((w) => window.tresd.V.getEngine().getViewport('vpSag').worldToCanvas(w), w);
  await page.mouse.click(sagBox.x + c[0], sagBox.y + c[1]); await sleep(400);
}
await waitStatus(/^(Vía aérea:|No se encontró|Error)/);
check(/^Vía aérea: volumen/.test(await status()), 'vía aérea segmentada');
await sleep(500);
check(await page.locator('#aw-bar').evaluate((e) => e.classList.contains('hidden')), 'la barra «VÍA AÉREA 2/2…» ya no está (antes se quedaba puesta)');
await shot('v078_aw.png');

console.log('— 7) el axial de ATM arranca en la cabeza del cóndilo');
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
const ax = await ev(() => {
  const V = window.tresd.V, tmj = V.state.tmj, out = {};
  for (const sd of ['R', 'L']) {
    const p = tmj.poles[sd], it = tmj.series[sd].find((x) => x.family === 'axi');
    const cnt = (img) => { let n = 0; for (let i = 0; i < img.data.length; i++) if (img.data[i] >= tmj.thr) n++; return n / img.data.length; };
    // el mismo corte a la altura del centro de los polos (como hasta v0.7.7) frente al nuevo
    const at0 = V.condyleAxialView(sd, 12, 0.3, 0), atB = V.condyleAxialView(sd, 12, 0.3, p.axiBase);
    out[sd] = { base: p.axiBase, off: it.off, itBase: it.base, bone0: +cnt(at0.img).toFixed(3), boneB: +cnt(atB.img).toFixed(3) };
  }
  return out;
});
// en el DZ, a la altura del centro de los polos CLÁSICOS la cabeza sale pegada a la fosa; el óvalo limpio
// aparece entre 3 y 12 mm por debajo. Desde v0.7.17 los polos se llevan a esa sección más ancha cuando la
// detección es coherente (lado L), así que el centro ya está ahí y el axial arranca a 0; en el lado R (muestra
// pobre) se conservan los polos clásicos y el axial sigue bajando.
for (const sd of ['R', 'L']) {
  const onWide = Math.abs(ax[sd].base) <= 2;
  check(onWide || (ax[sd].base <= -3 && ax[sd].base >= -12), `${sd}: el axial ${onWide ? 'arranca en la sección más ancha (polos v0.7.17)' : 'baja ' + (-ax[sd].base) + ' mm desde el centro de los polos (cabeza separada de la fosa)'}`);
  check(ax[sd].off === ax[sd].base && ax[sd].itBase === ax[sd].base, `${sd}: el corte del mosaico arranca en esa altura`);
}
await ev(() => window.tresd.renderTmj());
await page.click('#lay-atm'); await sleep(900);
const lbl = await ev(() => document.querySelector('#atm-grid .atm-cell[data-key="axi"] span').textContent);
check(lbl === 'Axial', `el rótulo dice solo «${lbl}» (el desplazamiento se cuenta desde esa altura)`);
await shot('v078_atm_axial.png');

console.log('— 2/4) marca de agua: logotipo «DICOM viewer», visible en tema claro y oscuro (sobre el mosaico, la esquina es fondo)');
const dark = cornerStats(await ev(() => window.tresd.shotPng()), 'v078_wm_dark.png');
check(dark.frac > 0.03, `tema oscuro: el logo se distingue del fondo en la esquina (${Math.round(dark.frac * 100)} % de píxeles distintos; fondo ${dark.bg})`);
await page.click('#btn-theme'); await sleep(1500);
const light = cornerStats(await ev(() => window.tresd.shotPng()), 'v078_wm_light.png');
check(light.frac > 0.03, `tema claro: el logo se distingue del fondo (${Math.round(light.frac * 100)} %; fondo ${light.bg})`);
check(light.bg[0] > 150 && dark.bg[0] < 100, `los fondos de las dos capturas son distintos (claro ${light.bg}, oscuro ${dark.bg})`);
await page.click('#btn-theme'); await sleep(800);

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
