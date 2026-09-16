// Comprobaciones de v0.7.4 (peticiones de Manuel del 13-09-2026):
//  1) la cruz no dibuja cuadrados y sus círculos de giro son pequeños
//  2) la cruz se adapta al tamaño del visor (en «3D + cortes» sale más pequeña)
//  3) medidas sobre los cortes de ATM + corte ampliado en una ventana grande
//  4) los polos del cóndilo se colocan a mano sobre un corte axial
//  5) el panel izquierdo se queda con títulos y botones (sin textos explicativos)
//  6) con un visor a pantalla completa, el doble clic vuelve al 2×2
// Uso: node tests/v074.mjs
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
await new Promise((r) => server.listen(8789, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, locale: 'es-ES' });
await page.addInitScript(() => { try { localStorage.setItem('tresd_dicom_terms', 'v1-2026-09'); localStorage.setItem('tresd_dicom_feedback', 'done'); } catch (e) {} });
page.setDefaultTimeout(300000);
const errs = []; let fails = 0;
page.on('console', (m) => { const tx = m.text(); if (m.type() === 'error' && !/favicon/.test(tx)) errs.push(tx.slice(0, 250)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(ROOT, 'tests/out', n) });
const sleep = (ms) => page.waitForTimeout(ms);
const svgCount = () => ev(() => {
  const out = {};
  for (const id of ['vpAx', 'vpCor', 'vpSag']) {
    const svg = document.querySelector(`#${id} svg`);
    out[id] = svg ? { rect: svg.querySelectorAll('rect').length, circle: svg.querySelectorAll('circle').length,
      r: [...svg.querySelectorAll('circle')].map((c) => +c.getAttribute('r')) } : null;
  }
  return out;
});

await page.goto('http://localhost:8789/');
await sleep(500);

console.log('— panel izquierdo sin textos explicativos');
const side = await ev(() => ({
  hints: document.querySelectorAll('#side .group .hint, #side .group .small').length,
  titles: document.querySelectorAll('#side .group .gtitle').length,
  buttons: document.querySelectorAll('#side .group button').length,
}));
check(side.hints === 0, `ningún texto explicativo dentro de los pasos (${side.hints})`);
check(side.titles >= 3 && side.buttons >= 5, `siguen los títulos (${side.titles}) y los botones (${side.buttons})`);

await page.setInputFiles('#in-folder', '/tmp/testdata/cbct_half');
await page.waitForFunction(() => /^(Cargado|Aviso)/.test(document.querySelector('#status-text').textContent), null, { timeout: 300000 });
await sleep(1200);
check(true, 'CBCT cargado');

console.log('— cruz: sin cuadrados y círculos pequeños');
await page.click('#btn-cross'); await sleep(800);
// hay que poner el ratón ENCIMA de una línea para que salgan los mangos de giro
const hoverLine = async () => {
  await page.waitForFunction(() => document.querySelectorAll('#vpAx svg line').length >= 2, null, { timeout: 30000 }).catch(() => {});
  const ln = await ev(() => {
    const l = [...document.querySelectorAll('#vpAx svg line')].map((x) => ({ x1: +x.getAttribute('x1'), y1: +x.getAttribute('y1'), x2: +x.getAttribute('x2'), y2: +x.getAttribute('y2') }));
    return l.find((q) => Math.abs(q.y1 - q.y2) < 1) || l[0] || null;
  });
  if (!ln) return false;
  const cs = await page.locator('#vpAx').boundingBox();
  // se prueban varios puntos del trazo hasta que aparezcan los mangos (la cruz no está siempre centrada)
  for (const f of [0.35, 0.5, 0.2, 0.65, 0.8, 0.45, 0.3]) {
    const x = ln.x1 + (ln.x2 - ln.x1) * f, y = ln.y1 + (ln.y2 - ln.y1) * f;
    await page.mouse.move(cs.x + x, cs.y + y - 3);
    await sleep(120);
    await page.mouse.move(cs.x + x, cs.y + y);
    await sleep(450);
    if (await ev(() => document.querySelectorAll('#vpAx svg circle').length > 0)) return true;
  }
  console.log('   (sin mangos) línea', JSON.stringify(ln), 'caja', JSON.stringify(cs));
  return false;
};
await hoverLine();
const quad = await svgCount();
const cfgQuad = await ev(() => window.tresd.V.tools.ToolGroupManager.getToolGroup('tg-mpr').getToolConfiguration('Crosshairs'));
check(quad.vpAx.rect === 0 && quad.vpCor.rect === 0 && quad.vpSag.rect === 0, 'no se dibuja ningún cuadrado en los tres cortes');
check(quad.vpAx.circle > 0 && quad.vpAx.r.every((r) => r >= 2.5 && r <= 4), `círculos de giro de radio (2,5–4 px desde v0.7.13) ${quad.vpAx.r.join('/')} px`);
await shot('v074_cruz_quad.png');

console.log('— la cruz se adapta al tamaño del visor');
await page.click('[data-layout="main3"]'); await sleep(1200);
const cfgMain3 = await ev(() => window.tresd.V.tools.ToolGroupManager.getToolGroup('tg-mpr').getToolConfiguration('Crosshairs'));
check(cfgMain3.handleRadius < cfgQuad.handleRadius, `mangos más pequeños en «3D + cortes» (${cfgMain3.handleRadius.toFixed(2)} vs ${cfgQuad.handleRadius.toFixed(2)} px)`);
check(cfgMain3.referenceLinesCenterGapRadius < cfgQuad.referenceLinesCenterGapRadius, `hueco central más pequeño (${cfgMain3.referenceLinesCenterGapRadius} vs ${cfgQuad.referenceLinesCenterGapRadius} px)`);
await hoverLine();
const m3 = await svgCount();
check(m3.vpAx.rect === 0, 'tampoco hay cuadrados en la vista pequeña');
await shot('v074_cruz_main3.png');
await page.click('[data-layout="quad"]'); await sleep(800);
await page.click('#btn-cross'); await sleep(400);

console.log('— doble clic con un visor a pantalla completa → 2×2');
await page.click('[data-layout="vp3d"]'); await sleep(700);
check((await ev(() => document.querySelector('#grid').dataset.layout)) === 'single', 'el render 3D queda solo en pantalla');
await page.dblclick('#vp3d', { position: { x: 300, y: 300 } });
await sleep(800);
check((await ev(() => document.querySelector('#grid').dataset.layout)) === 'quad', 'el doble clic sobre la escena devuelve el 2×2');
// y el botón ⤢ hace lo mismo
await page.click('.vp[data-id="vpAx"] .vpmax'); await sleep(600);
check((await ev(() => document.querySelector('#grid').dataset.layout)) === 'single', 'el botón ⤢ pone el axial solo');
await page.click('.vp[data-id="vpAx"] .vpmax'); await sleep(600);
check((await ev(() => document.querySelector('#grid').dataset.layout)) === 'quad', 'y al pulsarlo otra vez vuelve al 2×2');

console.log('— cortes de ATM: medidas y corte ampliado');
await ev(() => window.tresd.V.buildTmj({ R: [-54, -24, 43], L: [50, -29, 45] }, null));
await page.waitForFunction(() => window.tresd.V.state.tmj, null, { timeout: 300000 });
await ev(() => window.tresd.renderTmj());
await page.click('#lay-atm'); await sleep(900);
await ev(() => window.tresd.fitTmjAspect());
await sleep(400);
// desde v0.7.14 en el mosaico arrastrar es brillo/contraste; se mide en el corte ampliado con el botón «Distancia»
const mBox = await page.locator('#atm-grid .atm-cell[data-key="sag0"]').first().boundingBox();
const nMeas = () => ev(() => Object.values(window.tresd.V.getAllTmjMeas()).reduce((a, l) => a + l.length, 0));
// corte ampliado
await page.hover('#atm-grid .atm-cell[data-key="sag0"]');
await sleep(200);
await page.click('#atm-grid .atm-cell[data-key="sag0"] .atm-zoom');
await sleep(600);
check((await page.locator('.modal.atm-big').count()) === 1, 'el botón ⤢ abre el corte en grande');
const big = await page.locator('.modal.atm-big canvas').boundingBox();
check(big.width > mBox.width * 2, `el corte ampliado es mucho mayor (${Math.round(big.width)} vs ${Math.round(mBox.width)} px)`);
// medir dentro del modal con el botón «Distancia»
await page.click('#ab-len'); await sleep(150);
await page.mouse.move(big.x + big.width * 0.35, big.y + big.height * 0.35);
await page.mouse.down();
await page.mouse.move(big.x + big.width * 0.6, big.y + big.height * 0.6, { steps: 10 });
await page.mouse.up();
await sleep(400);
check((await nMeas()) === 1, 'se mide dentro del corte ampliado con el botón «Distancia»');
check(/mm/.test(await ev(() => document.querySelector('#status-text').textContent)), 'se muestra el valor de la medida');
await shot('v074_atm_grande.png');
// la rueda cambia de corte dentro del modal
const off0 = await ev(() => window.tresd.V.state.tmj.series.R.find((x) => x.key === 'sag0').off);
await page.mouse.move(big.x + big.width / 2, big.y + big.height / 2);
await page.mouse.wheel(0, 120); await sleep(400);
const off1 = await ev(() => window.tresd.V.state.tmj.series.R.find((x) => x.key === 'sag0').off);
check(off1 === off0 + 1, `la rueda cambia de corte dentro del modal (${off0} → ${off1})`);
await page.click('.modal.atm-big #ab-close'); await sleep(400);
check((await page.locator('.modal.atm-big').count()) === 0, 'el modal se cierra');

console.log('— polos del cóndilo a mano');
const antes = await ev(() => { const p = window.tresd.V.state.tmj.poles.R; return { med: p.med.slice(), lat: p.lat.slice(), ml: p.ml.slice() }; });
await page.click('#atm-poles'); await sleep(800);
check((await page.locator('.modal.poles canvas').count()) === 2, 'el diálogo muestra un corte axial por lado');
const pBox = await page.locator('.modal.poles .poles-one[data-side="R"] canvas').boundingBox();
// coger el polo LATERAL y moverlo un poco
const pos = await ev(() => { const v = window.tresd.__poles; return v; }).catch(() => null);
const latPx = await ev(() => {
  const cv = document.querySelector('.modal.poles .poles-one[data-side="R"] canvas');
  const V = window.tresd.V, p = V.state.tmj.poles.R;
  return { w: cv.width, h: cv.height };
});
// el punto lateral está a la izquierda de la imagen en el lado derecho del paciente: se busca arrastrando
// desde donde lo pinta el propio diálogo
const latPos = await ev(() => {
  const V = window.tresd.V; const v = V.condyleAxialView('R');
  return { lat: v.lat, med: v.med, w: v.img.w, h: v.img.h };
});
const toScreen = (px, py) => {
  const s = Math.min(pBox.width / latPos.w, pBox.height / latPos.h);
  const ox = (pBox.width - latPos.w * s) / 2, oy = (pBox.height - latPos.h * s) / 2;
  return [pBox.x + ox + px * s, pBox.y + oy + py * s];
};
const [sx, sy] = toScreen(latPos.lat[0], latPos.lat[1]);
const [dx, dy] = toScreen(latPos.lat[0], latPos.lat[1] + 40);      // 40 px del corte ≈ 6 mm
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(dx, dy, { steps: 10 });
await page.mouse.up();
await sleep(300);
await shot('v074_polos.png');
await page.click('.modal.poles #dlg-ok'); await sleep(1200);
const despues = await ev(() => { const p = window.tresd.V.state.tmj.poles.R; return { med: p.med.slice(), lat: p.lat.slice(), ml: p.ml.slice() }; });
const movido = Math.hypot(despues.lat[0] - antes.lat[0], despues.lat[1] - antes.lat[1], despues.lat[2] - antes.lat[2]);
check(movido > 2, `el polo lateral se ha movido ${movido.toFixed(1)} mm`);
check(Math.abs(despues.ml[0] - antes.ml[0]) > 0.005 || Math.abs(despues.ml[1] - antes.ml[1]) > 0.005, `el eje del cóndilo cambia (${despues.ml.map((v) => v.toFixed(3)).join(', ')})`);
check((await ev(() => document.querySelector('#status-text').textContent)).includes('Polos'), 'se avisa en la barra de estado');
await page.keyboard.press('Control+z'); await sleep(800);
const vuelta = await ev(() => window.tresd.V.state.tmj.poles.R.lat.slice());
check(Math.hypot(vuelta[0] - antes.lat[0], vuelta[1] - antes.lat[1], vuelta[2] - antes.lat[2]) < 0.01, 'Ctrl+Z devuelve los polos');

check(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
