// Prueba UNITARIA (Node, sin navegador) de la alineación escáner→CBCT con DIENTES REALES: los
// «escáneres» de tests/make_real_scans.py (superficie dental del propio CBCT DZ en una pose aleatoria)
// deben volver a su sitio: error medio de vértice < 0,5 mm respecto a la verdad (upper_world.stl).
// Recorre el mismo camino que la app: enamelTargets → pickTargets → patientFrame → alignToTeeth.
// Uso: node tests/align_node.mjs [half|full] [offset]   (offset = suma un valor a todo el volumen, como
// un CBCT sin calibrar en HU: la alineación debe seguir funcionando igual).
import fs from 'node:fs';
import { enamelTargets, pickTargets, alignToTeeth, alignQuality, rigidFromPairs, refineToTeeth, apply4, mul4 } from '../src/core/align.js';
import { patientFrame, applyMatrix } from '../src/core/orient.js';

const which = process.argv[2] || 'half';
const offset = Number(process.argv[3] || 0);
const meta = JSON.parse(fs.readFileSync(`/tmp/testdata/dz_${which}.json`, 'utf8'));
const [nx, ny, nz] = meta.dims;
const rawBuf = fs.readFileSync(`/tmp/testdata/dz_${which}.raw`);
let data = new Int16Array(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength / 2);
if (offset) { const d2 = new Int16Array(data.length); for (let i = 0; i < data.length; i++) d2[i] = data[i] + offset; data = d2; }
const o = meta.origin, ax = meta.axes;
const volume = {
  imageData: { getDimensions: () => [nx, ny, nz], indexToWorld: (ijk) => [0, 1, 2].map((q) => o[q] + ijk[0] * ax[0][q] + ijk[1] * ax[1][q] + ijk[2] * ax[2][q]) },
  voxelManager: { scalarData: data },
};
const stride = Math.max(1, Math.floor(data.length / 600000)); const sorted = new Float32Array(Math.floor(data.length / stride));
for (let i = 0, j = 0; j < sorted.length; i += stride, j++) sorted[j] = data[i];
sorted.sort();

function readSTL(path) {
  const buf = fs.readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(80, true);
  const raw = new Float32Array(n * 9);
  for (let i = 0, off = 84; i < n; i++, off += 50) for (let k = 0; k < 9; k++) raw[9 * i + k] = dv.getFloat32(off + 12 + 4 * k, true);
  const map = new Map(); const pts = []; const idx = new Uint32Array(n * 3); let c = 0;
  for (let i = 0; i < n * 3; i++) {
    const k = raw[3 * i].toFixed(3) + ',' + raw[3 * i + 1].toFixed(3) + ',' + raw[3 * i + 2].toFixed(3);
    let id = map.get(k); if (id === undefined) { id = c++; map.set(k, id); pts.push(raw[3 * i], raw[3 * i + 1], raw[3 * i + 2]); }
    idx[i] = id;
  }
  return { pts: Float32Array.from(pts), polys: idx, raw };
}
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'OK  ' : 'FALLO ') + msg); if (!ok) fails++; };

let t0 = Date.now();
const raw = await enamelTargets(volume, sorted, null, null);
console.log(`esmalte: ${raw ? raw.edgePts : 0} puntos de borde · umbral ${Math.round(raw.thr)} · LOW ${Math.round(raw.low)} · ${Date.now() - t0} ms`);
const tg = pickTargets(raw);
console.log('ancla', tg.anchor.map((v) => v.toFixed(1)), 'caja ±', tg.gate.map((v) => v.toFixed(0)), 'oclusal z', tg.mid.toFixed(1), 'upper', tg.upper.n, 'lower', tg.lower.n);
check(raw && raw.edgePts > 5000, 'hay puntos de esmalte');
const pose = JSON.parse(fs.readFileSync('/tmp/testdata/real_scans/pose.json', 'utf8'));
check(Math.abs(tg.mid - pose.mid_occ) < 3, `línea oclusal ${tg.mid.toFixed(1)} ≈ verdad ${pose.mid_occ.toFixed(1)}`);

const center = volume.imageData.indexToWorld([nx / 2, ny / 2, nz / 2]);
const vertErr = (P, W) => { let s = 0; const n = P.length / 3; for (let i = 0; i < P.length; i += 3) s += Math.hypot(P[i] - W[i], P[i + 1] - W[i + 1], P[i + 2] - W[i + 2]); return s / n; };

const results = {};
for (const role of ['upper', 'lower']) {
  const scan = readSTL(`/tmp/testdata/real_scans/${role}.stl`);
  const world = readSTL(`/tmp/testdata/real_scans/${role}_world.stl`);
  // como la app: orientar (patientFrame) y colocar en el centro del volumen
  t0 = Date.now();
  const r = patientFrame(scan.pts, scan.polys, role);
  const M = r.M.slice(); M[3] += center[0]; M[7] += center[1]; M[11] += center[2];
  const pts = applyMatrix(Float32Array.from(scan.pts), M);
  console.log(`\n${role}: ${scan.polys.length / 3} tri · orientación ${Date.now() - t0} ms · ok=${r.info.ok} corr ${r.info.corr.toFixed(2)} sym ${r.info.sym.toFixed(2)} ${r.info.detail}`);
  t0 = Date.now();
  const target = tg[role];
  const a = await alignToTeeth(pts, role, target, { sure: !!r.info.ok, debug: true });
  const P = apply4(a.T, pts);
  const e = vertErr(P, world.pts);
  console.log(`   alineación ${Date.now() - t0} ms · err ${a.err.toFixed(2)} mm · cov ${Math.round(100 * a.cov)} % · score ${a.score.toFixed(2)} · ERROR REAL medio ${e.toFixed(2)} mm`);
  check(e < 0.7, `${role}: error real ${e.toFixed(2)} mm < 0,7`);
  results[role] = { pts, P, world, T: mul4(a.T, M), err: a.err };
  { // diagnóstico: diferencia con la pose verdadera (p_world = R^T (p_scan - t))
    const Tt = mul4(a.T, M); const Rt = pose[role].R, tt = pose[role].t;
    const Rtrue = [Rt[0][0], Rt[1][0], Rt[2][0], Rt[0][1], Rt[1][1], Rt[2][1], Rt[0][2], Rt[1][2], Rt[2][2]];   // R^T (fila-mayor)
    const R = [Tt[0], Tt[1], Tt[2], Tt[4], Tt[5], Tt[6], Tt[8], Tt[9], Tt[10]];
    let tr = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += R[3 * i + j] * Rtrue[3 * i + j];   // traza(R·Rtrue^T)
    const ang = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI;
    const c = [0, 0, 0]; for (let i = 0; i < world.pts.length; i += 3) { c[0] += world.pts[i]; c[1] += world.pts[i + 1]; c[2] += world.pts[i + 2]; } for (let q = 0; q < 3; q++) c[q] /= world.pts.length / 3;
    const cp = [0, 0, 0]; for (let i = 0; i < P.length; i += 3) { cp[0] += P[i]; cp[1] += P[i + 1]; cp[2] += P[i + 2]; } for (let q = 0; q < 3; q++) cp[q] /= P.length / 3;
    console.log(`   giro respecto a la verdad ${ang.toFixed(1)}° · centroide desplazado ${[0, 1, 2].map((q) => (cp[q] - c[q]).toFixed(1))} mm`);
  }
  // re-alinear desde la pose ya alineada (no debe derivar)
  t0 = Date.now();
  const a2 = await alignToTeeth(P, role, target, { sure: true });
  const e2 = vertErr(apply4(a2.T, P), world.pts);
  console.log(`   re-alinear ${Date.now() - t0} ms · err ${a2.err.toFixed(2)} · ERROR REAL ${e2.toFixed(2)} mm`);
  check(e2 < 0.7, `${role}: re-alinear no deriva (${e2.toFixed(2)} mm)`);
}

// ALINEACIÓN POR PUNTOS: 3 puntos del escáner (en su pose orientada, lejos del sitio) ↔ los mismos en
// mundo (con ruido de 1 mm, como un clic) → rígido + encaje fino → error real < 0,5 mm
{
  const role = 'upper'; const { pts, world } = results[role];
  const n = pts.length / 3; const pick = [Math.floor(n * 0.1), Math.floor(n * 0.5), Math.floor(n * 0.9), Math.floor(n * 0.3)];
  const src = pick.map((i) => [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]]);
  const dst = pick.map((i, q) => [world.pts[3 * i] + 0.7 * Math.sin(q), world.pts[3 * i + 1] + 0.7 * Math.cos(q), world.pts[3 * i + 2] + 0.5]);
  const T0 = rigidFromPairs(src, dst);
  const q0 = alignQuality(pts, role, tg[role], T0);
  t0 = Date.now();
  const rr = await refineToTeeth(pts, role, tg[role], T0);
  const e = vertErr(apply4(rr.T, pts), world.pts);
  console.log(`\npor puntos: rígido err ${q0.err.toFixed(2)} → fino err ${rr.err.toFixed(2)} mm cov ${Math.round(100 * rr.cov)} % · ${Date.now() - t0} ms · ERROR REAL ${e.toFixed(2)} mm`);
  check(e < 0.5, `por puntos: error real ${e.toFixed(2)} mm < 0,5`);
}
console.log(fails ? `${fails} FALLOS` : 'TODO OK');
process.exit(fails ? 1 : 0);
