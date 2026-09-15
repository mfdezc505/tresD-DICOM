// tresD DICOM — SEGMENTACIÓN RÁPIDA (hueso / cráneo + tejido blando / piel) por umbral automático.
// Port de VOXEL `steps.segment_auto` + `_auto_thresholds`: Otsu sobre el CBCT → umbral piel (aire vs
// cuerpo) y, sobre lo que queda, umbral hueso (blando vs hueso); marching cubes sobre un volumen
// SUBMUESTREADO (≤ ~10 M vóxeles, como el 0,4 mm de VOXEL → segundos en cualquier PC); se conserva
// solo el TROZO MÁS GRANDE (quita el reposacabezas, ruido y trozos sueltos) y se suaviza (windowed
// sinc, ≈ Taubin: no encoge). Motores: vtk.js ImageMarchingCubes + WindowedSincPolyDataFilter.
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
import vtkWindowedSincPolyDataFilter from '@kitware/vtk.js/Filters/General/WindowedSincPolyDataFilter';
import { autoThresholds } from './stats.js';
export { autoThresholds };

const yieldUI = () => new Promise((r) => setTimeout(r, 0));
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * Vuelca el volumen (o una versión reducida por bloques f×f×f) en un vtkImageData en coordenadas de
 * ÍNDICE (origen 0, espaciado f): los puntos de salida se llevan al mundo con `toWorld`.
 * getSlice(k) → array del corte k (HU). Devuelve { img, f, toWorld(p) }.
 */
export async function buildGrid(volume, getSlice, onStatus, targetVoxels = 10e6, box = null) {
  const imgV = volume.imageData;
  const [nx, ny, nz] = imgV.getDimensions();
  const o = imgV.indexToWorld([0, 0, 0], [0, 0, 0]);
  const e0 = sub3(imgV.indexToWorld([1, 0, 0], [0, 0, 0]), o), e1 = sub3(imgV.indexToWorld([0, 1, 0], [0, 0, 0]), o), e2 = sub3(imgV.indexToWorld([0, 0, 1], [0, 0, 0]), o);
  // caja de índices (por defecto todo el volumen)
  const b = box ? { i0: Math.max(0, box.i0), i1: Math.min(nx, box.i1), j0: Math.max(0, box.j0), j1: Math.min(ny, box.j1), k0: Math.max(0, box.k0), k1: Math.min(nz, box.k1) } : { i0: 0, i1: nx, j0: 0, j1: ny, k0: 0, k1: nz };
  const bx = b.i1 - b.i0, by = b.j1 - b.j0, bz = b.k1 - b.k0;
  if (bx < 4 || by < 4 || bz < 4) return null;
  const f = Math.max(1, Math.ceil(Math.cbrt((bx * by * bz) / targetVoxels)));
  const mx = Math.floor(bx / f), my = Math.floor(by / f), mz = Math.floor(bz / f);
  const out = new Float32Array(mx * my * mz);
  const acc = new Float32Array(mx * my);
  const inv = 1 / (f * f * f);
  for (let K = 0; K < mz; K++) {
    if (K % 8 === 0) { if (onStatus) onStatus(Math.round((100 * K) / mz)); await yieldUI(); }
    acc.fill(0);
    for (let dk = 0; dk < f; dk++) {
      const s = getSlice(b.k0 + K * f + dk);
      if (!s) continue;
      for (let J = 0; J < my; J++) {
        for (let dj = 0; dj < f; dj++) {
          const row = (b.j0 + J * f + dj) * nx + b.i0;
          const orow = J * mx;
          for (let I = 0; I < mx; I++) {
            let v = 0; const base = row + I * f;
            for (let di = 0; di < f; di++) v += s[base + di];
            acc[orow + I] += v;
          }
        }
      }
    }
    const off = K * mx * my;
    for (let i = 0; i < acc.length; i++) out[off + i] = acc[i] * inv;
  }
  const img = vtkImageData.newInstance();
  img.setDimensions(mx, my, mz); img.setSpacing(f, f, f); img.setOrigin(0, 0, 0);
  img.getPointData().setScalars(vtkDataArray.newInstance({ name: 'HU', values: out, numberOfComponents: 1 }));
  // el bloque f×f×f se centra en (i·f + (f-1)/2): índice → mundo con el desplazamiento del centro y la caja
  const c = (f - 1) / 2;
  const toWorld = (p) => {
    const i = b.i0 + p[0] + c, j = b.j0 + p[1] + c, k = b.k0 + p[2] + c;
    return [o[0] + i * e0[0] + j * e1[0] + k * e2[0], o[1] + i * e0[1] + j * e1[1] + k * e2[1], o[2] + i * e0[2] + j * e1[2] + k * e2[2]];
  };
  return { img, f, toWorld, dims: [mx, my, mz], box: b };
}

/** Caja de ÍNDICES del volumen que envuelve unos límites en mundo [xmin,xmax,ymin,ymax,zmin,zmax] (+ margen mm). */
export function indexBox(volume, wb, margin = 0) {
  const img = volume.imageData;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const idx = [0, 0, 0];
  for (const x of [wb[0] - margin, wb[1] + margin]) for (const y of [wb[2] - margin, wb[3] + margin]) for (const z of [wb[4] - margin, wb[5] + margin]) {
    img.worldToIndex([x, y, z], idx);
    for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], idx[q]); hi[q] = Math.max(hi[q], idx[q]); }
  }
  return { i0: Math.floor(lo[0]), i1: Math.ceil(hi[0]) + 1, j0: Math.floor(lo[1]), j1: Math.ceil(hi[1]) + 1, k0: Math.floor(lo[2]), k1: Math.ceil(hi[2]) + 1 };
}

/** Marching cubes al umbral → { pts, polys } en coordenadas de índice del grid (sin suavizar). */
function isosurface(img, value) {
  const mc = vtkImageMarchingCubes.newInstance({ contourValue: value, computeNormals: false, mergePoints: true });
  mc.setInputData(img);
  const pd = mc.getOutputData();
  return fromPolyData(pd);
}

function fromPolyData(pd) {
  const pts = Float32Array.from(pd.getPoints().getData());
  const cells = pd.getPolys().getData();
  const tris = [];
  for (let i = 0; i < cells.length;) { const n = cells[i]; for (let k = 1; k < n - 1; k++) tris.push(cells[i + 1], cells[i + 1 + k], cells[i + 2 + k]); i += n + 1; }
  return { pts, polys: Uint32Array.from(tris) };
}

function toPolyData(pts, polys) {
  const pd = vtkPolyData.newInstance();
  pd.getPoints().setData(pts, 3);
  const cells = new Uint32Array((polys.length / 3) * 4);
  for (let t = 0, o = 0; t < polys.length; t += 3, o += 4) { cells[o] = 3; cells[o + 1] = polys[t]; cells[o + 2] = polys[t + 1]; cells[o + 3] = polys[t + 2]; }
  pd.getPolys().setData(cells);
  return pd;
}

/** Deja el componente conexo con MÁS triángulos (quita reposacabezas, ruido, islas); con minFrac < 1 se
 *  conservan también los que tengan al menos esa fracción de triángulos respecto al mayor (dientes sueltos). */
export function largestComponent(pts, polys, minFrac = 1, minTris = 0) {
  const nv = pts.length / 3;
  const parent = new Uint32Array(nv); for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let t = 0; t < polys.length; t += 3) { union(polys[t], polys[t + 1]); union(polys[t + 1], polys[t + 2]); }
  const count = new Map();
  for (let t = 0; t < polys.length; t += 3) { const r = find(polys[t]); count.set(r, (count.get(r) || 0) + 1); }
  let big = -1, bc = -1; for (const [r, c] of count) if (c > bc) { bc = c; big = r; }
  if (count.size <= 1) return { pts, polys, parts: count.size };
  const keep = new Set(); for (const [r, c] of count) if (r === big || c >= minFrac * bc || (minTris && c >= minTris)) keep.add(r);
  const remap = new Int32Array(nv).fill(-1); const np = []; const nt = []; let k = 0;
  for (let t = 0; t < polys.length; t += 3) {
    if (!keep.has(find(polys[t]))) continue;
    for (let j = 0; j < 3; j++) { const v = polys[t + j]; if (remap[v] < 0) { remap[v] = k++; np.push(pts[3 * v], pts[3 * v + 1], pts[3 * v + 2]); } nt.push(remap[v]); }
  }
  return { pts: Float32Array.from(np), polys: Uint32Array.from(nt), parts: count.size };
}

function smooth(pts, polys, iters, passBand) {
  const sm = vtkWindowedSincPolyDataFilter.newInstance({ numberOfIterations: iters, passBand, nonManifoldSmoothing: 0, featureEdgeSmoothing: 0, boundarySmoothing: 1 });
  sm.setInputData(toPolyData(pts, polys));
  return fromPolyData(sm.getOutputData());
}

/**
 * Segmentación rápida: { skull: {pts, polys}, soft: {pts, polys}, thresholds, f }. pts YA en mundo.
 * onStatus(fase, pct): 'grid' | 'bone' | 'teeth' | 'soft'. opts.teethBox = límites en mundo de la DENTICIÓN
 * ([xmin,xmax,ymin,ymax,zmin,zmax], de align.pickTargets): dentro de esa caja el hueso se calcula a
 * resolución FINA (≤ 8 M vóxeles solo para la caja: 0,25-0,5 mm) y sustituye al trozo grueso del cráneo, así
 * los dientes salen con su detalle (cúspides, apiñamiento) en vez de en bloque.
 */
export async function quickSegment(volume, sorted, getSlice, onStatus, opts = {}) {
  const thr = autoThresholds(sorted);
  const { img, f, toWorld } = await buildGrid(volume, getSlice, (p) => onStatus && onStatus('grid', p));
  const out = { thresholds: thr, f };
  // si el marco índice→mundo es un espejo (det < 0), invertir el sentido de los triángulos (normales)
  const a = toWorld([1, 0, 0]), b = toWorld([0, 1, 0]), c = toWorld([0, 0, 1]), o0 = toWorld([0, 0, 0]);
  const e0 = sub3(a, o0), e1 = sub3(b, o0), e2 = sub3(c, o0);
  const det = e0[0] * (e1[1] * e2[2] - e1[2] * e2[1]) - e0[1] * (e1[0] * e2[2] - e1[2] * e2[0]) + e0[2] * (e1[0] * e2[1] - e1[1] * e2[0]);
  const finish = (m, tw) => {
    const w = new Float32Array(m.pts.length);
    for (let i = 0; i < m.pts.length; i += 3) { const p = tw([m.pts[i], m.pts[i + 1], m.pts[i + 2]]); w[i] = p[0]; w[i + 1] = p[1]; w[i + 2] = p[2]; }
    if (det < 0) for (let t = 0; t < m.polys.length; t += 3) { const x = m.polys[t + 1]; m.polys[t + 1] = m.polys[t + 2]; m.polys[t + 2] = x; }
    return { pts: w, polys: m.polys };
  };
  const mmPerVox = f * Math.min(...volume.spacing);
  for (const [key, value, iters, pass] of [['skull', thr.bone, 15, 0.1], ['soft', thr.soft, 12, 0.08]]) {
    if (onStatus) onStatus(key);
    await yieldUI();
    // la PIEL se saca de la superficie EXTERNA del cuerpo (sin senos ni vía aérea dentro): ver bodyField
    let m = null;
    if (key === 'soft') {
      try {
        const body = bodyField(img, value, mmPerVox);
        await yieldUI();
        if (body) m = isosurface(body, value);
      } catch (e) { console.warn('tresD piel: superficie externa no disponible', e); m = null; }
    }
    if (!m || !m.polys.length) m = isosurface(img, value);
    if (!m.polys.length) { out[key] = null; continue; }
    m = largestComponent(m.pts, m.polys);
    const parts = m.parts;
    m = smooth(m.pts, m.polys, iters, pass);
    const r = finish(m, toWorld);
    out[key] = { pts: r.pts, polys: r.polys, parts, nTri: r.polys.length / 3 };
  }
  // DENTICIÓN a resolución fina: en la caja de las CORONAS se quita el trozo grueso del cráneo (al umbral de
  // hueso los artefactos de metal y el volumen parcial funden los dientes en un bloque) y se sustituye por la
  // isosuperficie FINA al umbral de SUPERFICIE DENTAL (opts.toothThr, el mismo de la alineación): las coronas
  // salen separadas y con sus cúspides; el hueso cortical (más denso que ese umbral) sigue presente.
  if (out.skull && opts.teethBox && opts.toothThr) {
    try {
      if (onStatus) onStatus('teeth');
      await yieldUI();
      const wb = opts.teethBox;
      const fine = await buildGrid(volume, getSlice, (p) => onStatus && onStatus('teeth', p), (opts.fineVoxels || 8e6), indexBox(volume, wb, 2));
      if (fine) {
        // a resolución nativa fina (≤ 0,35 mm) el CBCT es ruidoso: filtro de media 3×3×3 (quita el grano sin
        // perder cúspides). Umbral un poco por encima del de hueso: separa mejor los dientes entre sí (menos
        // volumen parcial en los espacios interproximales); el escalón con el cráneo grueso es < 0,3 mm.
        const vox = fine.f * Math.min(...volume.spacing);
        if (vox <= 0.35) meanFilter3(fine.img);
        let m = isosurface(fine.img, opts.toothThr);
        if (m.polys.length) {
          m = largestComponent(m.pts, m.polys, 1, 400);      // cada diente puede ser un trozo suelto: se conservan
          m = smooth(m.pts, m.polys, 12, 0.1);
          const r = finish(m, fine.toWorld);
          out.skull = mergeWithBox(out.skull, r, wb);
          out.skull.fine = { f: fine.f, nTri: r.polys.length / 3 };
        }
      }
    } catch (e) { console.warn('dentición fina', e); }
  }
  return out;
}

/** Filtro de media 3×3×3 (separable, en el sitio) sobre un vtkImageData de escalares Float32. */
function meanFilter3(img) {
  const [nx, ny, nz] = img.getDimensions();
  const a = img.getPointData().getScalars().getData();
  const tmp = new Float32Array(a.length);
  const pass = (src, dst, s1, n1, s2, n2, s3, n3) => {   // media a lo largo del eje de paso s3 (n3 muestras)
    for (let c = 0; c < n1; c++) for (let b = 0; b < n2; b++) {
      const base = c * s1 + b * s2;
      for (let i = 0; i < n3; i++) {
        const i0 = i > 0 ? i - 1 : i, i1 = i < n3 - 1 ? i + 1 : i;
        dst[base + i * s3] = (src[base + i0 * s3] + src[base + i * s3] + src[base + i1 * s3]) / 3;
      }
    }
  };
  pass(a, tmp, nx * ny, nz, nx, ny, 1, nx);        // eje i
  pass(tmp, a, nx * ny, nz, 1, nx, nx, ny);        // eje j
  pass(a, tmp, nx, ny, 1, nx, nx * ny, nz);        // eje k
  a.set(tmp);
  img.modified();
}

/** Sustituye en la malla gruesa los triángulos cuyo centro cae dentro de la caja (menos 1 mm) por la malla fina. */
function mergeWithBox(coarse, fine, wb) {
  const m = 1.0;
  const inside = (x, y, z) => x > wb[0] + m && x < wb[1] - m && y > wb[2] + m && y < wb[3] - m && z > wb[4] + m && z < wb[5] - m;
  const P = coarse.pts, T = coarse.polys; const keep = [];
  for (let t = 0; t < T.length; t += 3) {
    const a = 3 * T[t], b = 3 * T[t + 1], c = 3 * T[t + 2];
    if (inside((P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3)) continue;
    keep.push(T[t], T[t + 1], T[t + 2]);
  }
  const nv = P.length / 3;
  const pts = new Float32Array(P.length + fine.pts.length); pts.set(P, 0); pts.set(fine.pts, P.length);
  const polys = new Uint32Array(keep.length + fine.polys.length);
  polys.set(keep, 0);
  for (let i = 0; i < fine.polys.length; i++) polys[keep.length + i] = fine.polys[i] + nv;
  return { pts, polys, parts: coarse.parts, nTri: polys.length / 3 };
}

// ------------------------------------------------------------------ superficie EXTERNA de la piel
// Port de `segment_soft` de VOXEL (ceph_segment.py). El contorno directo al umbral de piel capta TAMBIÉN
// el aire interno (senos, fosas nasales, VÍA AÉREA) y aparece como nubes dentro del blando translúcido.
// El truco de VOXEL: procesar la MÁSCARA antes de sacar la isosuperficie.
//   1) máscara de cuerpo (HU > umbral de piel)
//   2) CIERRE morfológico de ~4 mm: sella narinas, coanas y boca sin mover el perfil facial
//   3) del AIRE se conserva solo el EXTERIOR (el componente mayor, y los que pasen del 55 % del mayor
//      por si el FOV lo parte en dos); todo lo demás (senos, nasofaringe, orofaringe) pasa a sólido
//   4) mayor componente sólido = la cabeza
//   5) marching cubes sobre la máscara SUAVIZADA (gaussiano de ~1 vóxel): si se marcha sobre el 0/1 la
//      piel sale escalonada.

/** Máximo (o mínimo) deslizante 1D exacto en O(n) por eje (van Herk / Gil-Werman). */
function morph1D(src, dst, nx, ny, nz, axis, r, isMax) {
  if (r <= 0) { dst.set(src); return; }
  const k = 2 * r + 1;
  const n = axis === 0 ? nx : axis === 1 ? ny : nz;
  const stride = axis === 0 ? 1 : axis === 1 ? nx : nx * ny;
  const outer = [nx, ny, nz]; outer[axis] = 1;
  const pre = new Uint8Array(n + k), suf = new Uint8Array(n + k);
  const best = isMax ? (a, b) => (a > b ? a : b) : (a, b) => (a < b ? a : b);
  const pad = isMax ? 0 : 1;
  for (let c = 0; c < outer[2]; c++) {
    for (let b2 = 0; b2 < outer[1]; b2++) {
      for (let a2 = 0; a2 < outer[0]; a2++) {
        const base = a2 + b2 * nx + c * nx * ny;
        // prefijos por bloques de k
        for (let i = 0; i < n; i++) {
          const v = src[base + i * stride];
          pre[i] = (i % k === 0) ? v : best(pre[i - 1], v);
        }
        for (let i = n; i < n + k; i++) pre[i] = pad;
        for (let i = n - 1; i >= 0; i--) {
          const v = src[base + i * stride];
          suf[i] = ((i + 1) % k === 0 || i === n - 1) ? v : best(suf[i + 1], v);
        }
        for (let i = 0; i < n; i++) {
          const lo = i - r, hi = i + r;
          const a = lo < 0 ? pad : suf[lo];
          const bb = hi >= n ? pad : pre[hi];
          dst[base + i * stride] = best(a, bb);
        }
      }
    }
  }
}

/** Cierre morfológico (dilatar y erosionar) con elemento cúbico de radio r vóxeles. */
function closeMask(mask, nx, ny, nz, r) {
  const tmp = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  morph1D(mask, tmp, nx, ny, nz, 0, r, true);
  morph1D(tmp, out, nx, ny, nz, 1, r, true);
  morph1D(out, tmp, nx, ny, nz, 2, r, true);
  morph1D(tmp, out, nx, ny, nz, 0, r, false);
  morph1D(out, tmp, nx, ny, nz, 1, r, false);
  morph1D(tmp, out, nx, ny, nz, 2, r, false);
  return out;
}

/** Etiquetado 6-conexo de `mask === want`. Devuelve { lab: Int32Array (0 = fuera), sizes: [n0, n1…] }. */
function label3D(mask, nx, ny, nz, want) {
  const lab = new Int32Array(mask.length);
  const q = new Int32Array(mask.length);
  const sizes = [0];
  const frame = nx * ny;
  let cur = 0;
  for (let s = 0; s < mask.length; s++) {
    if (mask[s] !== want || lab[s]) continue;
    cur++; let head = 0, tail = 0;
    q[tail++] = s; lab[s] = cur;
    let n = 0;
    while (head < tail) {
      const p = q[head++]; n++;
      const i = p % nx, j = ((p / nx) | 0) % ny, k = (p / frame) | 0;
      if (i > 0 && mask[p - 1] === want && !lab[p - 1]) { lab[p - 1] = cur; q[tail++] = p - 1; }
      if (i < nx - 1 && mask[p + 1] === want && !lab[p + 1]) { lab[p + 1] = cur; q[tail++] = p + 1; }
      if (j > 0 && mask[p - nx] === want && !lab[p - nx]) { lab[p - nx] = cur; q[tail++] = p - nx; }
      if (j < ny - 1 && mask[p + nx] === want && !lab[p + nx]) { lab[p + nx] = cur; q[tail++] = p + nx; }
      if (k > 0 && mask[p - frame] === want && !lab[p - frame]) { lab[p - frame] = cur; q[tail++] = p - frame; }
      if (k < nz - 1 && mask[p + frame] === want && !lab[p + frame]) { lab[p + frame] = cur; q[tail++] = p + frame; }
    }
    sizes.push(n);
  }
  return { lab, sizes };
}

/**
 * Votos de «agujero» por vóxel: para cada uno de los tres ejes se recorre corte a corte, se marca el aire
 * que se alcanza desde el BORDE del corte y el aire que queda sin alcanzar suma un voto. Un vóxel con 2 o 3
 * votos es aire ENCERRADO dentro de la cabeza (faringe, fosas, senos); las concavidades de la cara están
 * abiertas en los tres ejes y se quedan en 0 ó 1 voto.
 */
function holeVotes(mask, nx, ny, nz) {
  const votes = new Uint8Array(mask.length);
  const frame = nx * ny;
  const cap = Math.max(nx * ny, ny * nz, nx * nz);
  const lab = new Int32Array(cap), q = new Int32Array(cap);
  const run = (axis) => {
    const [w, h, ns] = axis === 2 ? [nx, ny, nz] : axis === 1 ? [nx, nz, ny] : [ny, nz, nx];
    const at = axis === 2 ? (a2, b2, s) => a2 + b2 * nx + s * frame
      : axis === 1 ? (a2, b2, s) => a2 + s * nx + b2 * frame
        : (a2, b2, s) => s + a2 * nx + b2 * frame;
    const perim = 2 * (w + h);
    const minBorde = Math.max(6, Math.round(0.12 * perim));
    for (let s = 0; s < ns; s++) {
      lab.fill(0, 0, w * h);
      let cur = 0;
      const touch = [0];
      for (let p0 = 0; p0 < w * h; p0++) {
        const a0 = p0 % w, b0 = (p0 / w) | 0;
        if (lab[p0] || mask[at(a0, b0, s)]) continue;
        cur++; let head = 0, tail = 0, tb = 0;
        lab[p0] = cur; q[tail++] = p0;
        while (head < tail) {
          const p = q[head++], a2 = p % w, b2 = (p / w) | 0;
          if (a2 === 0 || a2 === w - 1 || b2 === 0 || b2 === h - 1) tb++;
          if (a2 > 0 && !lab[p - 1] && !mask[at(a2 - 1, b2, s)]) { lab[p - 1] = cur; q[tail++] = p - 1; }
          if (a2 < w - 1 && !lab[p + 1] && !mask[at(a2 + 1, b2, s)]) { lab[p + 1] = cur; q[tail++] = p + 1; }
          if (b2 > 0 && !lab[p - w] && !mask[at(a2, b2 - 1, s)]) { lab[p - w] = cur; q[tail++] = p - w; }
          if (b2 < h - 1 && !lab[p + w] && !mask[at(a2, b2 + 1, s)]) { lab[p + w] = cur; q[tail++] = p + w; }
        }
        touch.push(tb);
      }
      // FUERA = el aire que se apoya en buena parte del marco del corte. El que solo lo roza (la faringe
      // saliendo por el borde del encuadre, una fosa cortada) cuenta como AGUJERO.
      for (let b2 = 0; b2 < h; b2++) for (let a2 = 0; a2 < w; a2++) {
        const p = a2 + b2 * w, l = lab[p];
        if (l && touch[l] < minBorde) votes[at(a2, b2, s)]++;
      }
    }
  };
  run(0); run(1); run(2);
  return votes;
}

/**
 * Campo 0..1 de la SUPERFICIE EXTERNA del cuerpo, listo para marching cubes a 0,5.
 * `img` = grid reducido (buildGrid), `thr` = umbral de piel, `mmPerVox` = mm por vóxel del grid.
 */
export function bodyField(img, thr, mmPerVox) {
  const [nx, ny, nz] = img.getDimensions();
  const hu = img.getPointData().getScalars().getData();
  let mask = new Uint8Array(hu.length);
  let any = 0;
  for (let i = 0; i < hu.length; i++) if (hu[i] > thr) { mask[i] = 1; any++; }
  if (!any) return null;
  const rmm = 3.0;
  const r = Math.max(1, Math.round(rmm / Math.max(mmPerVox, 0.1)));      // cierre corto: sella narinas y poros
  const closed = closeMask(mask, nx, ny, nz, r);
  // AIRE INTERNO por VOTACIÓN EN LOS TRES EJES (2,5D). Buscar el aire exterior en 3D no vale: la faringe
  // se comunica con el exterior por la boca o por el borde del encuadre y queda unida al aire de fuera
  // (medido: el 60 % de la pared de la vía aérea seguía en la malla). En cambio, en un corte AXIAL la
  // faringe es un agujero cerrado, y en uno CORONAL o SAGITAL también lo son los senos. Se rellena el aire
  // que queda encerrado en AL MENOS DOS de los tres ejes: así no se toca ninguna concavidad de la cara
  // (que está abierta en los tres) y desaparecen faringe, fosas y senos.
  const total = hu.length;
  const votos = holeVotes(closed, nx, ny, nz);
  let dentro = 0;
  const tapado = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    tapado[i] = (closed[i] || votos[i] >= 2) ? 1 : 0;
    if (!mask[i] && votos[i] >= 2) { mask[i] = 1; dentro++; }
  }
  // con las fugas ya tapadas, el aire que NO llega al borde del volumen es cavidad cerrada: se rellena
  // entera (esto remata las paredes de la faringe que la votación deja por los pelos)
  const air = label3D(tapado, nx, ny, nz, 0);
  if (air.sizes.length > 1) {
    const borde = new Uint8Array(air.sizes.length);
    const mk = (p) => { if (air.lab[p]) borde[air.lab[p]] = 1; };
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { mk(j * nx + k * nx * ny); mk(nx - 1 + j * nx + k * nx * ny); }
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { mk(i + k * nx * ny); mk(i + (ny - 1) * nx + k * nx * ny); }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { mk(i + j * nx); mk(i + j * nx + (nz - 1) * nx * ny); }
    for (let i = 0; i < total; i++) if (!mask[i] && air.lab[i] && !borde[air.lab[i]]) { mask[i] = 1; dentro++; }
  }
  const sol = label3D(mask, nx, ny, nz, 1);                              // mayor sólido = la cabeza
  let fuera = null;
  if (sol.sizes.length > 2) {
    let big = 1, top = 0;
    for (let i = 1; i < sol.sizes.length; i++) if (sol.sizes[i] > top) { top = sol.sizes[i]; big = i; }
    fuera = (i) => sol.lab[i] !== big;
  }
  console.log(`tresD piel: cierre ${r} vóx · ${dentro} vóxeles de aire interno rellenos`);
  // El campo que va a marching cubes es el HU ORIGINAL con el aire interno SUBIDO por encima del umbral:
  // así la superficie externa sale EXACTAMENTE igual que antes (sub-vóxel, sin suavizar la nariz ni los
  // labios, que es lo que descuadraba el drapeado de la foto) y desaparecen las superficies de dentro.
  const alto = thr + 400, bajo = Math.min(thr - 400, -1000);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    if (fuera && fuera(i) && hu[i] <= thr) { out[i] = bajo; continue; }   // trozos sueltos: fuera
    out[i] = (mask[i] && hu[i] <= thr) ? alto : hu[i];
  }
  const img2 = vtkImageData.newInstance();
  img2.setDimensions(nx, ny, nz);
  img2.setSpacing(...img.getSpacing());
  img2.setOrigin(...img.getOrigin());
  img2.getPointData().setScalars(vtkDataArray.newInstance({ name: 'body', values: out, numberOfComponents: 1 }));
  return img2;
}
