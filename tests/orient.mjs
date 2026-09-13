// Prueba UNITARIA (Node, sin navegador) de la autorientación: lee la arcada sintética girada al azar
// (tests/make_meshes.py), calcula el marco del paciente y comprueba que los dientes de la arcada
// superior apuntan hacia ABAJO (-Z), que los incisivos quedan ANTERIORES (-Y en LPS) y que la
// línea media queda centrada. Uso: node tests/orient.mjs
import fs from 'node:fs';
import { patientFrame, applyMatrix } from '../src/core/orient.js';

const DIR = '/tmp/testdata/meshes';
const frame = JSON.parse(fs.readFileSync(DIR + '/frame.json', 'utf8'));

function readSTL(path) {
  const buf = fs.readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(80, true);
  const raw = new Float32Array(n * 9);
  for (let i = 0, o = 84; i < n; i++, o += 50) for (let k = 0; k < 9; k++) raw[9 * i + k] = dv.getFloat32(o + 12 + 4 * k, true);
  // fusionar vértices (clave cuantizada)
  const map = new Map(); const pts = []; const idx = new Uint32Array(n * 3); let c = 0;
  for (let i = 0; i < n * 3; i++) {
    const k = raw[3 * i].toFixed(3) + ',' + raw[3 * i + 1].toFixed(3) + ',' + raw[3 * i + 2].toFixed(3);
    let id = map.get(k); if (id === undefined) { id = c++; map.set(k, id); pts.push(raw[3 * i], raw[3 * i + 1], raw[3 * i + 2]); }
    idx[i] = id;
  }
  return { pts: Float32Array.from(pts), polys: idx };
}

function apply(M, p) { return [M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[3], M[4] * p[0] + M[5] * p[1] + M[6] * p[2] + M[7], M[8] * p[0] + M[9] * p[1] + M[10] * p[2] + M[11]]; }
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };

for (const [file, role, tipsKey, teethSign] of [['arch_upper.stl', 'upper', 'tips_upper', -1], ['arch_islands.stl', 'upper', 'tips_upper', -1]]) {
  const { pts, polys } = readSTL(DIR + '/' + file);
  const t0 = Date.now();
  const { M, info } = patientFrame(pts, polys, role);
  console.log(`\n${file}: ${polys.length / 3} triángulos · ${Date.now() - t0} ms · corr ${info.corr.toFixed(2)} sym ${info.sym.toFixed(2)} detalle ${info.detail} ok=${info.ok} avisos=${JSON.stringify(info.warnings)}`);
  const out = applyMatrix(Float32Array.from(pts), M);
  let cz = 0, cx = 0; for (let i = 0; i < out.length; i += 3) { cx += out[i]; cz += out[i + 2]; }
  cz /= out.length / 3; cx /= out.length / 3;
  const tips = frame[tipsKey].map((p) => apply(M, p));
  const tipZ = mean(tips.map((p) => p[2]));
  check(Math.sign(tipZ - cz) === teethSign, `dientes hacia ${teethSign < 0 ? 'abajo' : 'arriba'} (z puntas ${tipZ.toFixed(1)} vs centro ${cz.toFixed(1)})`);
  const ant = apply(M, frame.anterior), post = apply(M, frame.posterior);
  check(ant[1] < post[1], `incisivos anteriores (y ant ${ant[1].toFixed(1)} < y post ${post[1].toFixed(1)})`);
  check(Math.abs(ant[0]) < 3, `línea media centrada (x incisivo ${ant[0].toFixed(1)})`);
  check(Math.abs(cx) < 1e-3, `centrada en el origen (x medio ${cx.toFixed(3)})`);
  const det = M[0] * (M[5] * M[10] - M[6] * M[9]) - M[1] * (M[4] * M[10] - M[6] * M[8]) + M[2] * (M[4] * M[9] - M[5] * M[8]);
  check(Math.abs(det - 1) < 1e-6, `rotación propia (det ${det.toFixed(6)})`);
}
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
process.exit(fails ? 1 : 0);
