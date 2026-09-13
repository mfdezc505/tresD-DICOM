// tresD DICOM — SEGMENTACIÓN DE LA VÍA AÉREA FARÍNGEA (port de VOXEL `steps.airway_auto` + `airway_axis`).
// Entre un límite SUPERIOR (clic a la altura del paladar / PNS) y otro INFERIOR (epiglotis, que además es la
// semilla) marcados en el corte sagital:
//   1. volumen SUBMUESTREADO a ~0,75 mm (para volumen y MCA sobra; el etiquetado es instantáneo);
//   2. aire = HU < max(Otsu aire/cuerpo, −500) (como el software grande: una Otsu muy negativa recorta la luz);
//   3. banda: por ENCIMA del plano axial de la epiglotis, por DEBAJO del plano por el clic superior PERPENDICULAR
//      al eje de la vía (sup→inf) y por DETRÁS de PNS (+3 mm; quita el aire de boca y fosas nasales);
//   4. componentes conexas del aire en la banda; se descartan las que tocan los bordes X/Y del volumen
//      (aire ambiente); se queda la de la semilla (o la interna más cercana);
//   5. volumen = vóxeles · vóxel; áreas por corte axial; MCA = mínimo de las secciones PERPENDICULARES al eje
//      de la vía (área axial · cos θ del eje, descartando 2 mm de cada punta);
//   6. malla por marching cubes en la caja de la región, trozo mayor, suavizada; `area_mm2` por vértice (área de
//      la sección a su altura) para el mapa de calor (azul = amplio, rojo = estrecho).
// Normas de adulto por sexo (Guijarro-Martínez & Swennen 2013): volumen cm³ y MCA mm² (media ± DE).
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkWindowedSincPolyDataFilter from '@kitware/vtk.js/Filters/General/WindowedSincPolyDataFilter';
import { autoThresholds } from './stats.js';
import { buildGrid, largestComponent } from './segment.js';

export const AIRWAY_NORM = {
  vol: { M: [32.1, 6.5], F: [22.7, 3.8] },      // cm³
  mca: { M: [101.3, 25.5], F: [78.5, 24.5] },   // mm²
};
export const AIRWAY_REF = 'Guijarro-Martínez R, Swennen GRJ. Int J Oral Maxillofac Surg 2013;42(9):1140-9.';

/** 'M' | 'F' | null a partir del sexo del DICOM ('M', 'F', 'H', 'MALE'…). */
export function normSex(sex) {
  const s = String(sex || '').trim().toUpperCase();
  if (!s) return null;
  if (s[0] === 'F' || s[0] === 'W' || s === 'MUJER') return 'F';
  if (s[0] === 'M' || s[0] === 'H') return 'M';
  return null;
}
/** (media, DE) de la norma adulta para 'vol' | 'mca' según sexo, o null. */
export function airwayNorm(which, sex) { const s = normSex(sex); return s ? AIRWAY_NORM[which][s] : null; }
/** 'green' | 'orange' | 'red' | null: verde ≥ media − 1 DE; naranja ≥ media − 2 DE; rojo por debajo. */
export function airwayClassify(value, which, sex) {
  const n = airwayNorm(which, sex); if (!n) return null;
  const [mean, sd] = n;
  if (value >= mean - sd) return 'green';
  if (value >= mean - 2 * sd) return 'orange';
  return 'red';
}

const yieldUI = () => new Promise((r) => setTimeout(r, 0));
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * Segmenta la vía aérea. sup / inf = [x,y,z] mundo (clics superior e inferior). onStatus(fase, pct):
 * 'grid' | 'label' | 'mesh'. Devuelve { pts, polys, area (Float32 por vértice), volume_mm3, mca_mm2, mca_z,
 * z_lo, z_hi, levels: [{z, area}], voxel } | null.
 */
export async function airwayAuto(volume, sorted, getSlice, sup, inf, onStatus) {
  const [nx, ny, nz] = volume.imageData.getDimensions();
  const vox = Math.min(...volume.spacing);
  const f = Math.max(1, Math.round(0.75 / vox));
  // buildGrid elige f por el número de vóxeles objetivo: se le pide justo el que da este f
  const target = Math.min(8e6, Math.max(1, (nx * ny * nz) / (f * f * f) + 1));   // ≤ 8 M vóxeles (memoria del etiquetado)
  const g = await buildGrid(volume, getSlice, (p) => onStatus && onStatus('grid', p), target);
  if (!g) return null;
  const { img, dims } = g;
  const [mx, my, mz] = dims;
  // toWorld de buildGrid espera índices del volumen ORIGINAL (su imagen lleva espaciado f): aquí se trabaja en
  // índices del GRID reducido → se multiplica por f
  const gf = g.f;
  const toWorld = (p) => g.toWorld([p[0] * gf, p[1] * gf, p[2] * gf]);
  const a = img.getPointData().getScalars().getData();
  // umbral de aire
  const thr = autoThresholds(sorted);
  const tAir = Math.max(thr.soft, -500);
  // marco del grid: world = o + i·e0 + j·e1 + k·e2
  const o = toWorld([0, 0, 0]);
  const e0 = sub3(toWorld([1, 0, 0]), o), e1 = sub3(toWorld([0, 1, 0]), o), e2 = sub3(toWorld([0, 0, 1]), o);
  const field = (vec) => ({ c0: dot3(o, vec), cx: dot3(e0, vec), cy: dot3(e1, vec), cz: dot3(e2, vec) });   // (world·vec) separable
  const ez = [0, 0, 1];
  const zLo = inf[2];
  // plano superior por el clic superior, perpendicular al eje sup→inf (normal hacia ARRIBA)
  let nrm = sub3(sup, inf); const nn = norm3(nrm);
  nrm = nn > 1e-9 ? nrm.map((v) => v / nn) : ez.slice();
  if (nrm[2] < 0) nrm = nrm.map((v) => -v);
  const fz = field(ez), fs = field(nrm), sSup = dot3(sup, nrm);
  // límite anterior: la marca superior ≈ PNS; la faringe queda DETRÁS. El mundo es LPS (anterior = −Y), así que
  // se descarta el aire con y < sup.y − 3 mm (boca, fosas nasales, paladar). VOXEL deducía el sentido anterior de
  // la geometría de los dos clics; aquí el marco es fijo y no depende de que los clics estén en el mismo corte.
  const ant = [0, -1, 0];
  const fa = field(ant); const sAnt = dot3(sup, ant) + 3;
  if (onStatus) onStatus('label');
  await yieldUI();
  // máscara de aire en la banda
  const N = mx * my * mz;
  const band = new Uint8Array(N);
  let any = 0;
  for (let k = 0; k < mz; k++) {
    for (let j = 0; j < my; j++) {
      const base = k * mx * my + j * mx;
      const z0 = fz.c0 + j * fz.cy + k * fz.cz, s0 = fs.c0 + j * fs.cy + k * fs.cz, a0 = fa.c0 + j * fa.cy + k * fa.cz;
      for (let i = 0; i < mx; i++) {
        if (a[base + i] >= tAir) continue;
        if (z0 + i * fz.cx < zLo) continue;
        if (s0 + i * fs.cx - sSup > 0) continue;
        if (a0 + i * fa.cx > sAnt) continue;
        band[base + i] = 1; any++;
      }
    }
  }
  if (!any) return null;
  // etiquetado de componentes conexas (6-vecindad) con pila
  const lab = new Int32Array(N);
  const stack = new Int32Array(N);
  let nLab = 0;
  const touches = [];                                   // por etiqueta: toca borde X/Y
  const sizes = [];
  for (let s = 0; s < N; s++) {
    if (!band[s] || lab[s]) continue;
    const id = ++nLab; let top = 0; stack[top++] = s; lab[s] = id; let cnt = 0, border = false;
    while (top) {
      const p = stack[--top]; cnt++;
      const i = p % mx, j = Math.floor(p / mx) % my, k = Math.floor(p / (mx * my));
      if (i === 0 || i === mx - 1 || j === 0 || j === my - 1) border = true;
      if (i > 0 && band[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[top++] = p - 1; }
      if (i < mx - 1 && band[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[top++] = p + 1; }
      if (j > 0 && band[p - mx] && !lab[p - mx]) { lab[p - mx] = id; stack[top++] = p - mx; }
      if (j < my - 1 && band[p + mx] && !lab[p + mx]) { lab[p + mx] = id; stack[top++] = p + mx; }
      if (k > 0 && band[p - mx * my] && !lab[p - mx * my]) { lab[p - mx * my] = id; stack[top++] = p - mx * my; }
      if (k < mz - 1 && band[p + mx * my] && !lab[p + mx * my]) { lab[p + mx * my] = id; stack[top++] = p + mx * my; }
    }
    touches[id] = border; sizes[id] = cnt;
  }
  // semilla (clic inferior) → índice del grid
  const seed = worldToGrid(inf, o, e0, e1, e2).map((v, q) => Math.max(0, Math.min(dims[q] - 1, Math.round(v))));
  let sid = lab[seed[2] * mx * my + seed[1] * mx + seed[0]];
  const seedInternal = !!sid && !touches[sid];
  if (!seedInternal) {
    // la semilla no cae en aire interno (clic en tejido, o en aire que toca el borde): entre las componentes
    // INTERNAS que pasan a menos de 20 mm de la semilla se toma la MAYOR (la columna faríngea), y si no hay
    // ninguna tan cerca, la más cercana. (VOXEL tomaba solo la más cercana: una burbuja diminuta ganaba.)
    const vox = Math.cbrt(Math.abs(det3(e0, e1, e2)));
    const near = new Float64Array(nLab + 1).fill(Infinity);
    for (let k = 0; k < mz; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
      const p = k * mx * my + j * mx + i; const l = lab[p];
      if (!l || touches[l]) continue;
      const d = (i - seed[0]) ** 2 + (j - seed[1]) ** 2 + (k - seed[2]) ** 2;
      if (d < near[l]) near[l] = d;
    }
    let best = -1, bestSize = -1, nearest = -1, nd = Infinity;
    const R = (20 / vox) ** 2;
    for (let l = 1; l <= nLab; l++) {
      if (!Number.isFinite(near[l])) continue;
      if (near[l] <= R && sizes[l] > bestSize) { bestSize = sizes[l]; best = l; }
      if (near[l] < nd) { nd = near[l]; nearest = l; }
    }
    sid = best > 0 ? best : nearest;
    if (sid < 0) return null;
  }
  console.log(`tresD vía aérea: umbral aire ${Math.round(tAir)} HU · grid ${mx}×${my}×${mz} · ${nLab} componentes · semilla ${seedInternal ? 'en aire interno' : 'reubicada'} · componente ${sizes[sid]} vóxeles`);
  const voxvol = Math.abs(det3(e0, e1, e2));
  const volume_mm3 = sizes[sid] * voxvol;
  // áreas por corte k (axial del grid) y centroides → eje de la vía
  const areaK = new Float64Array(mz), cxK = new Float64Array(mz), cyK = new Float64Array(mz), cntK = new Int32Array(mz);
  const bb = [mx, -1, my, -1, mz, -1];
  for (let k = 0; k < mz; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
    const p = k * mx * my + j * mx + i;
    if (lab[p] !== sid) continue;
    cntK[k]++; cxK[k] += i; cyK[k] += j;
    if (i < bb[0]) bb[0] = i; if (i > bb[1]) bb[1] = i; if (j < bb[2]) bb[2] = j; if (j > bb[3]) bb[3] = j; if (k < bb[4]) bb[4] = k; if (k > bb[5]) bb[5] = k;
  }
  const axialArea = norm3(cross3(e0, e1));               // área de un vóxel en el plano k
  const levels = [];
  for (let k = 0; k < mz; k++) if (cntK[k]) { areaK[k] = cntK[k] * axialArea; levels.push({ k, z: toWorld([cxK[k] / cntK[k], cyK[k] / cntK[k], k])[2], c: toWorld([cxK[k] / cntK[k], cyK[k] / cntK[k], k]), area: areaK[k] }); }
  // sección PERPENDICULAR al eje: área axial · cos θ (θ = ángulo del eje local con la vertical)
  const dz = norm3(e2);
  for (let q = 0; q < levels.length; q++) {
    const q0 = Math.max(0, q - 3), q1 = Math.min(levels.length - 1, q + 3);
    const t = sub3(levels[q1].c, levels[q0].c); const nt = norm3(t);
    const cos = nt > 1e-6 ? Math.abs(t[2]) / nt : 1;
    levels[q].perp = levels[q].area * Math.max(0.3, cos);
  }
  // MCA descartando las puntas: 2 mm por cada extremo y, además, los cortes parciales (los planos límite son
  // oblicuos respecto a los cortes del grid: en las puntas quedan «esquinitas» con un área falsa muy pequeña)
  const nk = Math.max(1, Math.round(2 / dz));
  let safe = levels.slice(nk, levels.length - nk); if (safe.length < 3) safe = levels;
  const med = safe.map((L) => L.perp).sort((x, y) => x - y)[Math.floor(safe.length / 2)] || 0;
  let s0 = 0, s1 = safe.length - 1;
  while (s0 < s1 - 2 && safe[s0].perp < 0.8 * med) s0++;
  while (s1 > s0 + 2 && safe[s1].perp < 0.8 * med) s1--;
  safe = safe.slice(s0, s1 + 1);
  let mcaL = safe[0]; for (const L of safe) if (L.perp < mcaL.perp) mcaL = L;
  const mca_mm2 = mcaL ? mcaL.perp : 0, mca_z = mcaL ? mcaL.z : 0;
  // malla: marching cubes de la máscara binaria en la caja (+1 vóxel)
  if (onStatus) onStatus('mesh');
  await yieldUI();
  const lo = [Math.max(0, bb[0] - 1), Math.max(0, bb[2] - 1), Math.max(0, bb[4] - 1)];
  const hi = [Math.min(mx - 1, bb[1] + 1), Math.min(my - 1, bb[3] + 1), Math.min(mz - 1, bb[5] + 1)];
  const sx = hi[0] - lo[0] + 1, sy = hi[1] - lo[1] + 1, sz = hi[2] - lo[2] + 1;
  const mask = new Float32Array(sx * sy * sz);
  for (let k = 0; k < sz; k++) for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
    if (lab[(k + lo[2]) * mx * my + (j + lo[1]) * mx + (i + lo[0])] === sid) mask[k * sx * sy + j * sx + i] = 1;
  }
  const sub = vtkImageData.newInstance();
  sub.setDimensions(sx, sy, sz); sub.setSpacing(1, 1, 1); sub.setOrigin(0, 0, 0);
  sub.getPointData().setScalars(vtkDataArray.newInstance({ name: 'seg', values: mask, numberOfComponents: 1 }));
  const mc = vtkImageMarchingCubes.newInstance({ contourValue: 0.5, computeNormals: false, mergePoints: true });
  mc.setInputData(sub);
  let m = fromPolyData(mc.getOutputData());
  if (!m.polys.length) return null;
  m = largestComponent(m.pts, m.polys);
  m = smooth(m.pts, m.polys, 25, 0.1);
  // índice → mundo (con espejo si el marco lo es)
  const det = det3(e0, e1, e2);
  const pts = new Float32Array(m.pts.length);
  for (let i = 0; i < m.pts.length; i += 3) { const p = toWorld([m.pts[i] + lo[0], m.pts[i + 1] + lo[1], m.pts[i + 2] + lo[2]]); pts[i] = p[0]; pts[i + 1] = p[1]; pts[i + 2] = p[2]; }
  if (det < 0) for (let t = 0; t < m.polys.length; t += 3) { const x = m.polys[t + 1]; m.polys[t + 1] = m.polys[t + 2]; m.polys[t + 2] = x; }
  // área de la sección por vértice (interpolada por altura z)
  const area = new Float32Array(pts.length / 3);
  const zs = levels.map((L) => L.z), ps = levels.map((L) => L.perp);
  for (let v = 0; v < area.length; v++) area[v] = interp(zs, ps, pts[3 * v + 2]);
  return { pts, polys: m.polys, area, volume_mm3, mca_mm2, mca_z, z_lo: zLo, z_hi: sup[2], levels: levels.map((L) => ({ z: L.z, area: L.perp })), voxel: Math.cbrt(voxvol), tAir };
}

function worldToGrid(w, o, e0, e1, e2) {
  // resolver [e0 e1 e2]·[i j k]ᵀ = w − o (3×3)
  const d = sub3(w, o);
  const M = [e0[0], e1[0], e2[0], e0[1], e1[1], e2[1], e0[2], e1[2], e2[2]];
  const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  if (Math.abs(det) < 1e-12) return [0, 0, 0];
  const inv = [
    (M[4] * M[8] - M[5] * M[7]) / det, (M[2] * M[7] - M[1] * M[8]) / det, (M[1] * M[5] - M[2] * M[4]) / det,
    (M[5] * M[6] - M[3] * M[8]) / det, (M[0] * M[8] - M[2] * M[6]) / det, (M[2] * M[3] - M[0] * M[5]) / det,
    (M[3] * M[7] - M[4] * M[6]) / det, (M[1] * M[6] - M[0] * M[7]) / det, (M[0] * M[4] - M[1] * M[3]) / det];
  return [inv[0] * d[0] + inv[1] * d[1] + inv[2] * d[2], inv[3] * d[0] + inv[4] * d[1] + inv[5] * d[2], inv[6] * d[0] + inv[7] * d[1] + inv[8] * d[2]];
}
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function det3(a, b, c) { return dot3(a, cross3(b, c)); }
function interp(xs, ys, x) {
  if (!xs.length) return 0;
  // xs puede ir creciente o decreciente según el sentido de k
  const asc = xs[xs.length - 1] >= xs[0];
  const X = asc ? xs : xs.slice().reverse(), Y = asc ? ys : ys.slice().reverse();
  if (x <= X[0]) return Y[0]; if (x >= X[X.length - 1]) return Y[Y.length - 1];
  let lo = 0, hi = X.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= x) lo = m; else hi = m; }
  const t = (x - X[lo]) / ((X[hi] - X[lo]) || 1);
  return Y[lo] + t * (Y[hi] - Y[lo]);
}
function fromPolyData(pd) {
  const pts = Float32Array.from(pd.getPoints().getData());
  const cells = pd.getPolys().getData();
  const tris = [];
  for (let i = 0; i < cells.length;) { const n = cells[i]; for (let k = 1; k < n - 1; k++) tris.push(cells[i + 1], cells[i + 1 + k], cells[i + 2 + k]); i += n + 1; }
  return { pts, polys: Uint32Array.from(tris) };
}
function smooth(pts, polys, iters, passBand) {
  const pd = vtkPolyData.newInstance();
  pd.getPoints().setData(pts, 3);
  const cells = new Uint32Array((polys.length / 3) * 4);
  for (let t = 0, o = 0; t < polys.length; t += 3, o += 4) { cells[o] = 3; cells[o + 1] = polys[t]; cells[o + 2] = polys[t + 1]; cells[o + 3] = polys[t + 2]; }
  pd.getPolys().setData(cells);
  const sm = vtkWindowedSincPolyDataFilter.newInstance({ numberOfIterations: iters, passBand, nonManifoldSmoothing: 0, featureEdgeSmoothing: 0, boundarySmoothing: 1 });
  sm.setInputData(pd);
  return fromPolyData(sm.getOutputData());
}

// ---------------------------------------------------------------- mapa de calor (RdYlBu invertido)
// RdYlBu de matplotlib (11 anclas) del ROJO al AZUL; con clim [mca, p85]: rojo = estrecho, azul = amplio.
const RDYLBU = [[165, 0, 38], [215, 48, 39], [244, 109, 67], [253, 174, 97], [254, 224, 144], [255, 255, 191], [224, 243, 248], [171, 217, 233], [116, 173, 209], [69, 117, 180], [49, 54, 149]];
export function heatColor(t) {
  const x = Math.max(0, Math.min(1, t)) * (RDYLBU.length - 1);
  const i = Math.min(RDYLBU.length - 2, Math.floor(x)); const u = x - i;
  const a = RDYLBU[i], b = RDYLBU[i + 1];
  return [Math.round(a[0] + u * (b[0] - a[0])), Math.round(a[1] + u * (b[1] - a[1])), Math.round(a[2] + u * (b[2] - a[2]))];
}
/** Colores RGB (Uint8, 3 por vértice) del mapa de calor de áreas; clim = [lo, hi]. */
export function heatColors(area, lo, hi) {
  const out = new Uint8Array(area.length * 3);
  const rng = Math.max(1e-6, hi - lo);
  for (let i = 0; i < area.length; i++) { const c = heatColor((area[i] - lo) / rng); out[3 * i] = c[0]; out[3 * i + 1] = c[1]; out[3 * i + 2] = c[2]; }
  return out;
}
/** Límites del mapa: [MCA, percentil 85 de las áreas por vértice] (como VOXEL). */
export function heatRange(area, mca) {
  const s = Float32Array.from(area).sort();
  const lo = mca || s[0] || 0;
  let hi = s.length ? s[Math.min(s.length - 1, Math.round(0.85 * (s.length - 1)))] : lo + 1;
  if (hi <= lo) hi = lo + 1;
  return [lo, hi];
}
