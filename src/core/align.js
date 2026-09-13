// tresD DICOM — ALINEACIÓN ESCÁNER → CBCT. Port de VOXEL `ceph_lite/core/steps.py`
// (dicom_teeth_surface / _build_teeth (con `avoid`), _scan_to_teeth, _fine_seat, align_quality,
// auto_align_scanner (reintentos MUTUOS), align_scanner_points, _apply_occlusion):
//   1) DESTINO = CORONAS del CBCT por HU: el ESMALTE es lo más denso (vóxeles ≥ percentil 99,5),
//      anclado en la mediana de los MÁS densos (≥ p99,9) y recortado a una caja alrededor; se separa
//      superior/inferior por la línea oclusal (mediana de la altura) y se conserva la franja de coronas
//      (12 mm). Solo se usan los vóxeles de BORDE (cara externa del esmalte, la que ve el escáner), con
//      su NORMAL (gradiente de HU) para el ICP punto-a-plano. `pickTargets(raw, avoid)` permite RE-ANCLAR
//      en otro cúmulo denso si el primero resultó ser hueso/metal (reintento mutuo de VOXEL).
//   2) COLOCACIÓN por geometría: el escáner ya viene orientado al marco del paciente (orient.js); su
//      banda de coronas se centra sobre las coronas del CBCT y se prueban las orientaciones posibles
//      (frente/atrás; arriba/abajo si la orientación dudó; la pose actual si ya está cerca), cada una
//      con un ICP recortado corto; gana la de mejor cobertura con sesgo anatómico (como VOXEL).
//   3) ENCAJE FINO (_fine_seat): ICP recortado PUNTO-A-PLANO multiescala (banda de coronas del escáner
//      contra coronas del CBCT) con guardia (nunca empeora) + etapa final por distancia absoluta.
//      Calidad = distancia media recortada (60 %) y cobertura a 0,7 mm.
//   4) POR PUNTOS (align_scanner_points): 3+ pares escáner↔CBCT → rígido (Horn) → mismo encaje fino.
// Todo en JS puro (rejilla de celdas para el vecino más cercano + Horn/cuaterniones para el rígido).
import { pct, autoThresholds } from './stats.js';

const RIGHT = [-1, 0, 0], ANT = [0, -1, 0], UP = [0, 0, 1];          // marco LPS del visor

function percentileOf(arr, p) { const s = Float64Array.from(arr).sort(); return pct(s, p); }
function median(arr) { return percentileOf(arr, 50); }
const yieldUI = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- 1) coronas del CBCT
/**
 * Extrae los vóxeles de BORDE de esmalte del volumen (con normal). `sorted` = muestra ordenada de HU.
 * Devuelve { pts, nrm, val, thr, low, thrAnchor, edgePts, total, yielded } (Float32Array xyz en mundo) o null.
 * Es la parte cara (recorre todo el volumen): se cachea y se reparte por arcos con `pickTargets`.
 */
export async function enamelTargets(volume, sorted, onStatus, getSlice = null) {
  const img = volume.imageData; const vm = volume.voxelManager;
  const [nx, ny, nz] = img.getDimensions();
  const o = img.indexToWorld([0, 0, 0], [0, 0, 0]);
  const e0 = sub3(img.indexToWorld([1, 0, 0], [0, 0, 0]), o), e1 = sub3(img.indexToWorld([0, 1, 0], [0, 0, 0]), o), e2 = sub3(img.indexToWorld([0, 0, 1], [0, 0, 0]), o);
  const l0 = Math.hypot(...e0) || 1, l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
  const u0 = e0.map((v) => v / l0), u1 = e1.map((v) => v / l1), u2 = e2.map((v) => v / l2);
  const full = vm.scalarData || null;                       // volumen local (reducido): todo en un array
  const frame = nx * ny;
  const slice = (k) => {
    if (k < 0 || k >= nz) return null;
    if (full) return full.subarray(k * frame, (k + 1) * frame);
    if (getSlice) { const a = getSlice(k); if (a && a.length === frame) return a; }
    return vm.getSliceData({ sliceIndex: k, slicePlane: 2 });   // lento (vóxel a vóxel): último recurso
  };
  // Dos umbrales, ambos RELATIVOS al histograma (funcionan también en CBCT sin calibrar en HU):
  //  - thrAnchor = lo MÁS denso (p99,9: esmalte y metal) → solo para LOCALIZAR la dentición (ancla, caja,
  //    línea oclusal) en pickTargets;
  //  - thrSurf = SUPERFICIE del diente (entre el umbral hueso/tejido de Otsu y el esmalte): es la cara que
  //    ve el escáner intraoral (límite diente/encía-aire). Con p99,5 a secas (VOXEL) en un CBCT de 0,5 mm el
  //    esmalte quedaba en 4 vóxeles sueltos por diente y el ICP no tenía a qué agarrarse.
  //  - LOW = umbral hueso/tejido (Otsu): un vóxel es de BORDE si a 1-2 vóxeles hay algo por debajo (aire,
  //    tejido blando, encía); así se conserva la cara EXTERNA (no la unión esmalte-dentina ni el interior).
  const at = autoThresholds(sorted);
  const top = pct(sorted, 99.9);
  const thrAnchor = Math.max(at.bone + 300, top);
  const thr = Math.max(at.bone + 100, at.bone + 0.35 * (top - at.bone));
  const LOW = at.bone;
  const pts = [], nrm = [], val = [];
  let prev2 = null, prev = null, cur = slice(0), next = slice(1), next2 = slice(2);
  let total = 0, yielded = 0;
  for (let k = 0; k < nz; k++) {
    if (k % 32 === 0) { if (onStatus) onStatus(Math.round((100 * k) / nz)); const ty = Date.now(); await yieldUI(); yielded += Date.now() - ty; }
    for (let j = 0; j < ny; j++) {
      const row = j * nx;
      for (let i = 0; i < nx; i++) {
        const v = cur[row + i];
        if (v < thr) continue;
        total++;
        // borde EXTERIOR: algún vecino (a 1 o 2 vóxeles, 6 direcciones) es aire/tejido blando (< LOW).
        // Así se queda la cara externa del esmalte (la que ve el escáner) y no la unión esmalte-dentina.
        const edge = (i === 0 || cur[row + i - 1] < LOW || (i > 1 && cur[row + i - 2] < LOW))
          || (i === nx - 1 || cur[row + i + 1] < LOW || (i < nx - 2 && cur[row + i + 2] < LOW))
          || (j === 0 || cur[row - nx + i] < LOW || (j > 1 && cur[row - 2 * nx + i] < LOW))
          || (j === ny - 1 || cur[row + nx + i] < LOW || (j < ny - 2 && cur[row + 2 * nx + i] < LOW))
          || (!prev || prev[row + i] < LOW || (prev2 && prev2[row + i] < LOW))
          || (!next || next[row + i] < LOW || (next2 && next2[row + i] < LOW));
        if (!edge) continue;
        pts.push(o[0] + i * e0[0] + j * e1[0] + k * e2[0], o[1] + i * e0[1] + j * e1[1] + k * e2[1], o[2] + i * e0[2] + j * e1[2] + k * e2[2]);
        val.push(v);
        // normal = -gradiente de HU (hacia fuera, donde baja la densidad), en mundo
        const gx = ((i < nx - 1 ? cur[row + i + 1] : v) - (i > 0 ? cur[row + i - 1] : v)) / l0;
        const gy = ((j < ny - 1 ? cur[row + nx + i] : v) - (j > 0 ? cur[row - nx + i] : v)) / l1;
        const gz = ((next ? next[row + i] : v) - (prev ? prev[row + i] : v)) / l2;
        let wx = gx * u0[0] + gy * u1[0] + gz * u2[0], wy = gx * u0[1] + gy * u1[1] + gz * u2[1], wz = gx * u0[2] + gy * u1[2] + gz * u2[2];
        const gl = Math.hypot(wx, wy, wz) || 1;
        nrm.push(-wx / gl, -wy / gl, -wz / gl);
      }
    }
    prev2 = prev; prev = cur; cur = next; next = next2; next2 = slice(k + 3);
  }
  if (pts.length < 600) return null;
  return { pts: Float32Array.from(pts), nrm: Float32Array.from(nrm), val: Float32Array.from(val), thr, low: LOW, thrAnchor, bone: at.bone, edgePts: pts.length / 3, total, yielded };
}

/**
 * Reparte los puntos de esmalte por arcos: { upper:{pts,nrm,center,n}, lower, all, anchor, gate, mid } o null.
 * avoid = { c:[x,y,z], r } excluye los vóxeles de ancla cercanos a ese centro para RE-ANCLAR en el
 * siguiente cúmulo denso (VOXEL _build_teeth(avoid=…)): si el primero era hueso/metal/peñasco.
 */
export function pickTargets(raw, avoid = null) {
  if (!raw) return null;
  const { pts, nrm, val, thrAnchor } = raw;
  const n = pts.length / 3;
  let A = [];
  for (let i = 0; i < n; i++) {
    if (val[i] < thrAnchor) continue;
    if (avoid && dist3([pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]], avoid.c) <= avoid.r) continue;
    A.push(i);
  }
  if (avoid && A.length < 50) return null;
  let idx = null, c0 = null, gate = null;
  if (A.length >= 200) {
    const med = (arr) => [median(arr.map((i) => pts[3 * i])), median(arr.map((i) => pts[3 * i + 1])), median(arr.map((i) => pts[3 * i + 2]))];
    c0 = med(A);
    // descartar densos lejanos (peñasco / estiloides / metal) antes de medir la caja
    const d = A.map((i) => dist3([pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]], c0));
    const d85 = percentileOf(d, 85);
    A = A.filter((_, q) => d[q] < d85);
    c0 = med(A);
    const proj = (u) => A.map((i) => Math.abs(dot3(sub3([pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]], c0), u)));
    gate = [Math.min(45, percentileOf(proj(RIGHT), 90) + 8), Math.min(45, percentileOf(proj(ANT), 90) + 8), Math.min(30, percentileOf(proj(UP), 90) + 8)];
    idx = [];
    for (let i = 0; i < n; i++) {
      const q = [pts[3 * i] - c0[0], pts[3 * i + 1] - c0[1], pts[3 * i + 2] - c0[2]];
      if (Math.abs(dot3(q, RIGHT)) < gate[0] && Math.abs(dot3(q, ANT)) < gate[1] && Math.abs(dot3(q, UP)) < gate[2]) idx.push(i);
    }
    if (idx.length < 50) idx = null;
  }
  if (!idx) { idx = []; for (let i = 0; i < n; i++) idx.push(i); }
  // línea oclusal = mediana de la altura; franja de CORONAS de 12 mm a cada lado
  const mid = median(idx.map((i) => pts[3 * i + 2]));
  const CROWN = 12;
  let up = idx.filter((i) => pts[3 * i + 2] >= mid && pts[3 * i + 2] <= mid + CROWN), lo = idx.filter((i) => pts[3 * i + 2] <= mid && pts[3 * i + 2] >= mid - CROWN);
  if (up.length < 200) up = idx.filter((i) => pts[3 * i + 2] >= mid);
  if (lo.length < 200) lo = idx.filter((i) => pts[3 * i + 2] < mid);
  if (up.length < 50) up = idx; if (lo.length < 50) lo = idx;
  const pack = (arr) => {
    const cap = 250000; const st = Math.max(1, Math.ceil(arr.length / cap)); const m = Math.ceil(arr.length / st);
    const P = new Float32Array(3 * m), N = new Float32Array(3 * m); const c = [0, 0, 0];
    for (let q = 0, j = 0; q < arr.length; q += st, j += 3) { const i = 3 * arr[q]; P[j] = pts[i]; P[j + 1] = pts[i + 1]; P[j + 2] = pts[i + 2]; N[j] = nrm[i]; N[j + 1] = nrm[i + 1]; N[j + 2] = nrm[i + 2]; c[0] += pts[i]; c[1] += pts[i + 1]; c[2] += pts[i + 2]; }
    return { pts: P, nrm: N, center: [c[0] / m, c[1] / m, c[2] / m], n: m };
  };
  return { upper: pack(up), lower: pack(lo), all: pack(idx), anchor: c0, gate, mid, thr: raw.thr };
}

// ---------------------------------------------------------------- vecino más cercano por rejilla
/** Rejilla de celdas (CSR en arrays tipados: sin Map, ~10× más rápida) para el vecino más cercano. */
export class Grid {
  constructor(pts, cell = 1.0, nrm = null) {
    this.pts = pts; this.cell = cell; this.nrm = nrm;
    const b = [Infinity, Infinity, Infinity], B = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pts.length; i += 3) for (let q = 0; q < 3; q++) { const v = pts[i + q]; if (v < b[q]) b[q] = v; if (v > B[q]) B[q] = v; }
    this.min = b;
    this.dims = [0, 1, 2].map((q) => Math.max(1, Math.floor((B[q] - b[q]) / cell) + 1));
    const [dx, dy, dz] = this.dims; const nc = dx * dy * dz;
    const n = pts.length / 3;
    const cellOf = new Int32Array(n);
    const count = new Int32Array(nc + 1);
    for (let i = 0, p = 0; i < n; i++, p += 3) {
      const c = Math.floor((pts[p] - b[0]) / cell) + dx * (Math.floor((pts[p + 1] - b[1]) / cell) + dy * Math.floor((pts[p + 2] - b[2]) / cell));
      cellOf[i] = c; count[c + 1]++;
    }
    for (let c = 0; c < nc; c++) count[c + 1] += count[c];
    this.start = count;                                   // start[c] … start[c+1]-1 = índices (×3) de la celda c
    this.items = new Int32Array(n); const fill = new Int32Array(nc);
    for (let i = 0; i < n; i++) { const c = cellOf[i]; this.items[count[c] + fill[c]++] = 3 * i; }
  }
  /**
   * Índice (×3) del punto más cercano y d². Busca por anillos de celdas crecientes (±0, ±1, … ±maxRing)
   * y para cuando el mejor hallado ya está más cerca que el siguiente anillo. null si no hay nada cerca.
   */
  nearest(x, y, z, maxRing = 4) {
    const cell = this.cell, [dx, dy, dz] = this.dims, P = this.pts, S = this.start, I = this.items;
    const cx = Math.floor((x - this.min[0]) / cell), cy = Math.floor((y - this.min[1]) / cell), cz = Math.floor((z - this.min[2]) / cell);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= maxRing; r++) {
      if (best >= 0 && bd <= ((r - 1) * cell) ** 2) break;
      const x0 = Math.max(0, cx - r), x1 = Math.min(dx - 1, cx + r), y0 = Math.max(0, cy - r), y1 = Math.min(dy - 1, cy + r), z0 = Math.max(0, cz - r), z1 = Math.min(dz - 1, cz + r);
      if (x0 > x1 || y0 > y1 || z0 > z1) { if (cx + r < 0 || cx - r >= dx || cy + r < 0 || cy - r >= dy || cz + r < 0 || cz - r >= dz) continue; else continue; }
      for (let iz = z0; iz <= z1; iz++) {
        const ez = Math.abs(iz - cz) === r;
        for (let iy = y0; iy <= y1; iy++) {
          const ey = ez || Math.abs(iy - cy) === r;
          for (let ix = x0; ix <= x1; ix++) {
            if (!ey && Math.abs(ix - cx) !== r) continue;     // solo la cáscara del anillo r
            const c = ix + dx * (iy + dy * iz);
            for (let q = S[c], qe = S[c + 1]; q < qe; q++) {
              const i = I[q];
              const d = (P[i] - x) ** 2 + (P[i + 1] - y) ** 2 + (P[i + 2] - z) ** 2;
              if (d < bd) { bd = d; best = i; }
            }
          }
        }
      }
    }
    return best < 0 ? null : { i: best, d2: bd };
  }
}

// ---------------------------------------------------------------- álgebra
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function mul4(A, B) { const C = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) C[4 * i + j] += A[4 * i + k] * B[4 * k + j]; return C; }
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function rt4(R, t) { return [R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2], 0, 0, 0, 1]; }
export function apply4(M, pts) {
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    out[i] = M[0] * x + M[1] * y + M[2] * z + M[3]; out[i + 1] = M[4] * x + M[5] * y + M[6] * z + M[7]; out[i + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
  }
  return out;
}
function mulVec3(M, v) { return [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[4] * v[0] + M[5] * v[1] + M[6] * v[2], M[8] * v[0] + M[9] * v[1] + M[10] * v[2]]; }
function centroid(pts) { const c = [0, 0, 0]; const n = pts.length / 3; for (let i = 0; i < pts.length; i += 3) { c[0] += pts[i]; c[1] += pts[i + 1]; c[2] += pts[i + 2]; } return [c[0] / n, c[1] / n, c[2] / n]; }
function subsample(pts, max) {
  const n = pts.length / 3; if (n <= max) return pts;
  const st = n / max; const out = new Float32Array(max * 3);
  for (let j = 0; j < max; j++) { const i = 3 * Math.floor(j * st); out[3 * j] = pts[i]; out[3 * j + 1] = pts[i + 1]; out[3 * j + 2] = pts[i + 2]; }
  return out;
}
/** Autovector del MAYOR autovalor de una matriz simétrica n×n (Jacobi). */
function topEigenvector(A, n) {
  const a = A.map((r) => r.slice()); const V = []; for (let i = 0; i < n; i++) { V.push(new Array(n).fill(0)); V[i][i] = 1; }
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
      for (let k = 0; k < n; k++) { const kp = V[k][p], kq = V[k][q]; V[k][p] = c * kp - s * kq; V[k][q] = s * kp + c * kq; }
    }
  }
  let im = 0; for (let i = 1; i < n; i++) if (a[i][i] > a[im][im]) im = i;
  return V.map((r) => r[im]);
}
/** Transformación rígida (Horn, cuaterniones) que lleva src → dst (pares [ia, ib] índices ×3). Devuelve 4×4. */
function rigidFit(src, dst, idx) {
  const n = idx.length; if (n < 3) return I4();
  const cs = [0, 0, 0], cd = [0, 0, 0];
  for (const [a, b] of idx) { cs[0] += src[a]; cs[1] += src[a + 1]; cs[2] += src[a + 2]; cd[0] += dst[b]; cd[1] += dst[b + 1]; cd[2] += dst[b + 2]; }
  for (let k = 0; k < 3; k++) { cs[k] /= n; cd[k] /= n; }
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0];     // Σ (s-cs)(d-cd)^T
  for (const [a, b] of idx) {
    const sx = src[a] - cs[0], sy = src[a + 1] - cs[1], sz = src[a + 2] - cs[2];
    const dx = dst[b] - cd[0], dy = dst[b + 1] - cd[1], dz = dst[b + 2] - cd[2];
    S[0] += sx * dx; S[1] += sx * dy; S[2] += sx * dz; S[3] += sy * dx; S[4] += sy * dy; S[5] += sy * dz; S[6] += sz * dx; S[7] += sz * dy; S[8] += sz * dz;
  }
  const [Sxx, Sxy, Sxz, Syx, Syy, Syz, Szx, Szy, Szz] = S;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const [w, x, y, z] = topEigenvector(N, 4);
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  const rc = [R[0] * cs[0] + R[1] * cs[1] + R[2] * cs[2], R[3] * cs[0] + R[4] * cs[1] + R[5] * cs[2], R[6] * cs[0] + R[7] * cs[1] + R[8] * cs[2]];
  return rt4(R, [cd[0] - rc[0], cd[1] - rc[1], cd[2] - rc[2]]);
}
/** Rígido (Horn) entre listas de puntos emparejados [[x,y,z]…] (N ≥ 3): src → dst. */
export function rigidFromPairs(src, dst) {
  const n = Math.min(src.length, dst.length); if (n < 3) return null;
  const S = new Float32Array(3 * n), D = new Float32Array(3 * n), idx = [];
  for (let i = 0; i < n; i++) { S.set(src[i], 3 * i); D.set(dst[i], 3 * i); idx.push([3 * i, 3 * i]); }
  return rigidFit(S, D, idx);
}
/** Rotación exacta (Rodrigues) del vector de giro pequeño w = (a, b, c). */
function rodrigues(a, b, c) {
  const th = Math.hypot(a, b, c);
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const kx = a / th, ky = b / th, kz = c / th, s = Math.sin(th), co = Math.cos(th), v = 1 - co;
  return [co + kx * kx * v, kx * ky * v - kz * s, kx * kz * v + ky * s,
    ky * kx * v + kz * s, co + ky * ky * v, ky * kz * v - kx * s,
    kz * kx * v - ky * s, kz * ky * v + kx * s, co + kz * kz * v];
}
/** Resuelve A·x = b (6×6, simétrica) por eliminación gaussiana con pivote; null si es singular. */
function solve6(A, b) {
  const n = 6; const M = []; for (let i = 0; i < n; i++) { M.push([]); for (let j = 0; j < n; j++) M[i].push(A[n * i + j] + (i === j ? 1e-9 * (A[n * i + j] + 1) : 0)); M[i].push(b[i]); }
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; if (!f) continue; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// ---------------------------------------------------------------- ICP recortado
/**
 * ICP recortado punto-a-punto: devuelve la 4×4 acumulada que lleva `src` (Float32Array) al destino.
 * keep = fracción de pares (los más cercanos) que se usan; maxDist = además, descartar pares más lejos
 * (mm) para que la encía / el paladar sin esmalte enfrente no tiren del encaje.
 */
function trimmedICP(src, grid, keep = 0.5, iters = 40, maxDist = 0) {
  let cur = Float32Array.from(src); let T = I4();
  const md2 = maxDist > 0 ? maxDist * maxDist : Infinity;
  for (let it = 0; it < iters; it++) {
    const pairs = [];
    for (let i = 0; i < cur.length; i += 3) {
      const h = grid.nearest(cur[i], cur[i + 1], cur[i + 2]);
      if (h && h.d2 <= md2) pairs.push([i, h.i, h.d2]);
    }
    if (pairs.length < 10) break;
    pairs.sort((a, b) => a[2] - b[2]);
    const kept = pairs.slice(0, Math.max(10, Math.floor(keep * pairs.length)));
    const M = rigidFit(cur, grid.pts, kept);
    const next = apply4(M, cur);
    let shift = 0; for (let i = 0; i < cur.length; i++) shift = Math.max(shift, Math.abs(next[i] - cur[i]));
    cur = next; T = mul4(M, T);
    if (shift < 5e-3) break;                  // convergido (5 µm)
  }
  return T;
}
/**
 * ICP recortado PUNTO-A-PLANO (VOXEL trimmed_icp_p2plane): minimiza la distancia de cada punto al plano
 * tangente de su vecino (normal del esmalte); converge mejor y no «resbala» sobre el esmalte. Misma firma.
 */
function icpP2Plane(src, grid, keep = 0.5, iters = 40, maxDist = 0) {
  if (!grid.nrm) return trimmedICP(src, grid, keep, iters, maxDist);
  let cur = Float32Array.from(src); let T = I4();
  const md2 = maxDist > 0 ? maxDist * maxDist : Infinity;
  const P = grid.pts, N = grid.nrm;
  for (let it = 0; it < iters; it++) {
    const pairs = [];
    for (let i = 0; i < cur.length; i += 3) {
      const h = grid.nearest(cur[i], cur[i + 1], cur[i + 2]);
      if (h && h.d2 <= md2) pairs.push([i, h.i, h.d2]);
    }
    if (pairs.length < 10) break;
    pairs.sort((a, b) => a[2] - b[2]);
    const kept = pairs.slice(0, Math.max(10, Math.floor(keep * pairs.length)));
    const A = new Float64Array(36), b = new Float64Array(6); const c = new Float64Array(6);
    for (const [i, j] of kept) {
      const px = cur[i], py = cur[i + 1], pz = cur[i + 2];
      const nx = N[j], ny = N[j + 1], nz = N[j + 2];
      const r = (px - P[j]) * nx + (py - P[j + 1]) * ny + (pz - P[j + 2]) * nz;
      c[0] = py * nz - pz * ny; c[1] = pz * nx - px * nz; c[2] = px * ny - py * nx; c[3] = nx; c[4] = ny; c[5] = nz;
      for (let a = 0; a < 6; a++) { b[a] -= c[a] * r; for (let q = 0; q < 6; q++) A[6 * a + q] += c[a] * c[q]; }
    }
    const x = solve6(A, b);
    if (!x) break;
    const M = rt4(rodrigues(x[0], x[1], x[2]), [x[3], x[4], x[5]]);
    const next = apply4(M, cur);
    let shift = 0; for (let i = 0; i < cur.length; i++) shift = Math.max(shift, Math.abs(next[i] - cur[i]));
    if (!Number.isFinite(shift) || shift > 20) break;   // paso absurdo: sistema mal condicionado
    cur = next; T = mul4(M, T);
    if (shift < 5e-3) break;
  }
  return T;
}
function coverage(pts, grid, thr) {
  let c = 0; const t2 = thr * thr; const n = pts.length / 3;
  for (let i = 0; i < pts.length; i += 3) { const h = grid.nearest(pts[i], pts[i + 1], pts[i + 2]); if (h && h.d2 <= t2) c++; }
  return n ? c / n : 0;
}
/** Distancia media RECORTADA (mejor `frac`) de pts al destino (mm). */
function trimmedError(pts, grid, frac = 0.6) {
  const d = [];
  for (let i = 0; i < pts.length; i += 3) { const h = grid.nearest(pts[i], pts[i + 1], pts[i + 2]); d.push(h ? Math.sqrt(h.d2) : 6); }
  d.sort((a, b) => a - b);
  const k = Math.max(10, Math.floor(frac * d.length));
  let s = 0; for (let i = 0; i < k; i++) s += d[i];
  return k ? s / k : 9e9;
}

/** Marco de una arcada (nube): anterior por el hueco angular de la U (_arch_frame + _arch_ap_sign). */
function archAnterior(pts) {
  const P = subsample(pts, 20000); const c = centroid(P);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < P.length; i += 3) { const x = P[i] - c[0], y = P[i + 1] - c[1]; sxx += x * x; sxy += x * y; syy += y * y; }
  const ang0 = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const e1 = [Math.cos(ang0), Math.sin(ang0)], e2 = [-Math.sin(ang0), Math.cos(ang0)];
  const nb = 72; const h = new Int32Array(nb);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i] - c[0], y = P[i + 1] - c[1];
    const a = Math.atan2(x * e2[0] + y * e2[1], x * e1[0] + y * e1[1]);
    h[Math.min(nb - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * nb))]++;
  }
  let bestLen = 0, bestStart = 0, curLen = 0, curStart = 0;
  for (let i = 0; i < 2 * nb; i++) {
    if (h[i % nb] === 0) { if (!curLen) curStart = i; curLen++; if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; } } else curLen = 0;
  }
  let ant;
  if (!bestLen) ant = e2;
  else { const mid = (bestStart + bestLen / 2) % nb; const ap = -Math.PI + (mid + 0.5) * ((2 * Math.PI) / nb); ant = [-(Math.cos(ap) * e1[0] + Math.sin(ap) * e2[0]), -(Math.cos(ap) * e1[1] + Math.sin(ap) * e2[1])]; }
  const lat = [-ant[1], ant[0]]; const a = [], l = [];
  for (let i = 0; i < P.length; i += 3) { const x = P[i] - c[0], y = P[i + 1] - c[1]; a.push(x * ant[0] + y * ant[1]); l.push(x * lat[0] + y * lat[1]); }
  const p70 = percentileOf(a, 70), p30 = percentileOf(a, 30);
  const spread = (mask) => { const v = []; for (let i = 0; i < a.length; i++) if (mask(a[i])) v.push(l[i]); return v.length < 20 ? null : percentileOf(v, 90) - percentileOf(v, 10); };
  const sp = spread((v) => v > p70), sn = spread((v) => v < p30);
  const sign = sp == null || sn == null ? 1 : (sp <= sn ? 1 : -1);
  return [sign * ant[0], sign * ant[1], 0];
}

/** ±1: lado (en Z) de la MASA CENTRAL de la arcada (paladar / base gingival) respecto a su centro (VOXEL _central_mass_dir). */
function centralMassDir(pts) {
  const P = subsample(pts, 20000); const c = centroid(P);
  const rd = [], along = [];
  for (let i = 0; i < P.length; i += 3) { rd.push(Math.hypot(P[i] - c[0], P[i + 1] - c[1])); along.push(P[i + 2] - c[2]); }
  const thr = percentileOf(rd, 35);
  let s = 0, n = 0; for (let i = 0; i < rd.length; i++) if (rd[i] <= thr) { s += along[i]; n++; }
  return n < 20 || s >= 0 ? 1 : -1;
}

// ---------------------------------------------------------------- 2+3) colocación y encaje
/** Banda de CORONAS del escáner (ya orientado en LPS): superior = parte baja; inferior = parte alta. */
export function crownBand(pts, role) {
  if (role !== 'upper' && role !== 'lower') return pts;
  const z = []; for (let i = 2; i < pts.length; i += 3) z.push(pts[i]);
  const cut = percentileOf(z, role === 'upper' ? 55 : 45);
  const out = [];
  for (let i = 0; i < pts.length; i += 3) if (role === 'upper' ? pts[i + 2] <= cut : pts[i + 2] >= cut) out.push(pts[i], pts[i + 1], pts[i + 2]);
  return Float32Array.from(out);
}

function makeGrid(target) { return new Grid(target.pts, 2.0, target.nrm || null); }

/**
 * Encaje FINO (VOXEL _fine_seat) desde la pose T sobre la nube `full` (banda del escáner, ya en mundo tras T):
 * ICP punto-a-plano multiescala en rondas con guardia (solo se acepta si baja el error) + etapa final por
 * distancia absoluta. Devuelve { T, P, err }.
 */
function fineSeat(P0, grid, T0, fast = false) {
  let T = T0, P = P0;
  let err = trimmedError(P, grid, 0.6);
  const stages = fast ? [[0.7, 20], [0.5, 20], [0.35, 15], [0.25, 15]] : [[0.7, 40], [0.5, 40], [0.35, 30], [0.25, 25], [0.2, 20]];
  for (let round = 0; round < (fast ? 2 : 4); round++) {
    let T2 = T, P2 = P;
    for (const [keep, it] of stages) { const M = icpP2Plane(P2, grid, keep, it); P2 = apply4(M, P2); T2 = mul4(M, T2); }
    const e2 = trimmedError(P2, grid, 0.6);
    let shift = 0; for (let i = 0; i < P.length; i++) shift = Math.max(shift, Math.abs(P2[i] - P[i]));
    if (e2 < err - 1e-4) { T = T2; P = P2; err = e2; } else break;
    if (shift < 0.02) break;
  }
  // etapa final: solo los pares que YA están cerca del esmalte (umbral absoluto), con guardia
  for (const md of [1.5, 1.0, 0.7]) {
    const M = icpP2Plane(P, grid, 0.9, 30, md);
    const P2 = apply4(M, P); const e2 = trimmedError(P2, grid, 0.6);
    if (e2 <= err + 1e-4) { T = mul4(M, T); P = P2; err = e2; }
  }
  return { T, P, err };
}

/**
 * Alinea un escáner (pts orientados en LPS) a las coronas del CBCT. target = {pts, nrm, center} de su arco.
 * opts: { sure (orientación fiable), onStatus }. Devuelve { T (4×4 mundo→mundo), err, cov, score }.
 */
export async function alignToTeeth(pts, role, target, opts = {}) {
  const grid = makeGrid(target);
  const band = crownBand(pts, role);
  const full = subsample(band, 5000);
  const bc = centroid(band), tc = target.center;
  const antT = archAnterior(target.pts);                       // hacia los incisivos del CBCT
  const antS0 = archAnterior(band);                            // hacia los incisivos del ESCÁNER (por su geometría)
  const crownS0 = [0, 0, -centralMassDir(pts)];                // hacia las CORONAS del escáner (opuesto al paladar/base)
  const wantZ = role === 'lower' ? 1 : -1;                     // coronas superiores miran abajo; inferiores arriba
  const rz = (deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
  const ry = (deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
  // MULTIARRANQUE JERÁRQUICO. La orientación de orient.js puede fallar en escáneres raros (paladar grande,
  // arcadas parciales) y los dientes son PERIÓDICOS (un giro de ~12° encaja cada diente sobre el vecino:
  // mínimo local con cobertura casi igual). Por eso:
  //   nivel 0: barrido COMPLETO de guiñada (0…345°, paso 15°) × desplazamientos (±8 mm en el plano, ±4 mm en
  //            altura) para cada familia (frente/atrás no hace falta: la cubre el barrido; arriba/abajo si la
  //            orientación dudó): cobertura bruta a 2,5 mm de 400 puntos (sin ICP: ~0,3 ms por pose);
  //   nivel 1: los 24 mejores (poses distintas) → ICP recortado corto → cobertura a 1,5 mm + sesgos anatómicos;
  //   nivel 2: finalistas (el mejor de cada familia + los mejores globales) → encaje fino rápido → gana el
  //            ERROR final (discrimina mucho mejor que la cobertura) → remate con más puntos.
  const families = opts.sure === false ? [{ R: rz(0), up: true }, { R: ry(180), up: false }] : [{ R: rz(0), up: true }];
  const tiny = subsample(band, 400), small = subsample(band, 800);
  const level0 = [];
  for (const fam of families) for (let yaw = 0; yaw < 360; yaw += 15) {
    const R = mul3(rz(yaw), fam.R);
    const Rc = mulVec3(rt4(R, [0, 0, 0]), bc);
    for (const dx of [-8, 0, 8]) for (const dy of [-8, 0, 8]) for (const dz of [-4, 0, 4]) {
      const T0 = rt4(R, [tc[0] - Rc[0] + dx, tc[1] - Rc[1] + dy, tc[2] - Rc[2] + dz]);
      level0.push({ T: T0, fam, cover: coverage(apply4(T0, tiny), grid, 2.5) });
    }
  }
  // si el escáner YA está sobre las coronas (re-alinear), su pose actual también compite
  if (dist3(bc, tc) < 15) level0.push({ T: I4(), fam: families[0], keepPose: true, cover: coverage(tiny, grid, 2.5) + 1 });
  level0.sort((a, b) => b.cover - a.cover);
  await yieldUI();
  const poseKey = (T) => { const c = mulVec3(T, bc); return { c: [c[0] + T[3], c[1] + T[7], c[2] + T[11]], ax: mulVec3(T, [1, 0, 0]) }; };
  const samePose = (a, b, dc = 5, da = 0.99) => dist3(a.c, b.c) < dc && dot3(a.ax, b.ax) > da;
  const level1 = [];
  for (const c of level0) {
    if (level1.length >= 24) break;
    const k = poseKey(c.T);
    if (level1.some((x) => samePose(x.k0, k, 4, 0.995))) continue;
    level1.push({ ...c, k0: k });
  }
  const scored = [];
  for (let ci = 0; ci < level1.length; ci++) {
    if (opts.onStatus && ci % 6 === 0) opts.onStatus('cand', ci + 1, level1.length);
    if (ci % 6 === 0) await yieldUI();
    const c = level1[ci];
    const P0 = apply4(c.T, small);
    const T1 = trimmedICP(P0, grid, 0.5, 15);
    const P1 = apply4(T1, P0);
    const cover = coverage(P1, grid, 1.5);
    let score = cover;
    const T01 = mul4(T1, c.T);
    if (c.fam.up) score += 0.1;                                // coronas hacia el lado correcto según orient.js
    if (role !== 'other' && Math.sign(mulVec3(T01, crownS0)[2]) === wantZ) score += 0.1;   // …y según la masa central (paladar/base)
    const antS = mulVec3(T01, antS0);                          // incisivos del escáner tras colocar
    const d = dot3(antS, antT); if (d > 0) score += 0.2 * d;   // hacia el mismo lado que los incisivos del CBCT
    scored.push({ score, T: T01, cover, fam: c.fam, keepPose: !!c.keepPose, ci });
  }
  scored.sort((a, b) => b.score - a.score);
  // FINALISTAS: el mejor de CADA familia + los mejores globales con poses DISTINTAS → encaje fino. Los sesgos
  // anatómicos solo ordenan; entre poses decide el ERROR FINAL.
  const finalists = [];
  const addFinalist = (c) => {
    const k = poseKey(c.T);
    if (finalists.some((f) => samePose(f.k, k))) return;
    finalists.push({ ...c, k });
  };
  for (const fam of families) { const c = scored.find((x) => x.fam === fam); if (c) addFinalist(c); }
  const kp = scored.find((x) => x.keepPose); if (kp) addFinalist(kp);
  for (const c of scored) { if (finalists.length >= families.length + 4) break; addFinalist(c); }
  if (opts.onStatus) opts.onStatus('fine');
  const mid = subsample(band, 2000);
  let best = null;
  for (let fi = 0; fi < finalists.length; fi++) {
    await yieldUI();
    const f = finalists[fi];
    let T = f.T, P = apply4(T, mid);
    for (const [keep, it] of [[0.5, 30], [0.35, 20]]) { const M = trimmedICP(P, grid, keep, it); P = apply4(M, P); T = mul4(M, T); }
    const fs = fineSeat(P, grid, T, true);
    const cov = coverage(fs.P, grid, 0.7);
    if (opts.debug) console.log(`   finalista ${fi + 1}: nivel1 #${f.ci + 1} up=${f.fam.up} keep=${f.keepPose} score ${f.score.toFixed(3)} → err ${fs.err.toFixed(2)} cov ${cov.toFixed(2)}`);
    if (!best || fs.err < best.err) best = { T: fs.T, err: fs.err, cov, score: f.score, cover: f.cover };
  }
  // remate con más puntos desde la pose ganadora
  await yieldUI();
  const fs = fineSeat(apply4(best.T, full), grid, best.T);
  const cov = coverage(fs.P, grid, 0.7);
  return { T: fs.T, err: fs.err, cov, score: best.score, cover: best.cover };
}

/**
 * Encaje fino desde una pose dada (alineación POR PUNTOS o re-asentar): T0 lleva `pts` (LPS) a su pose
 * inicial en mundo. Devuelve { T, err, cov } (T ya incluye T0).
 */
export async function refineToTeeth(pts, role, target, T0) {
  const grid = makeGrid(target);
  const band = crownBand(pts, role);
  const full = subsample(band, 5000);
  await yieldUI();
  // mismas etapas que el remate automático: ICP punto-a-punto recortado (acerca desde los clics) + encaje fino
  let T = T0, P = apply4(T0, full);
  const e0 = trimmedError(P, grid, 0.6);
  for (const [keep, it] of [[0.5, 30], [0.35, 20]]) { const M = trimmedICP(P, grid, keep, it); P = apply4(M, P); T = mul4(M, T); }
  if (trimmedError(P, grid, 0.6) > e0) { T = T0; P = apply4(T0, full); }   // guardia
  const fs = fineSeat(P, grid, T);
  return { T: fs.T, err: fs.err, cov: coverage(fs.P, grid, 0.7) };
}

/** Calidad de una pose (align_quality): { err (media recortada 60 %), cov (a 0,7 mm) } de la banda de coronas. */
export function alignQuality(pts, role, target, T = null) {
  const grid = makeGrid(target);
  let band = subsample(crownBand(pts, role), 5000);
  if (T) band = apply4(T, band);
  return { err: trimmedError(band, grid, 0.6), cov: coverage(band, grid, 0.7) };
}

function mul3(A, B) { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[3 * i + j] += A[3 * i + k] * B[3 * k + j]; return C; }
export const _internals = { trimmedICP, icpP2Plane, fineSeat, coverage, trimmedError, subsample, centroid, archAnterior, centralMassDir, rigidFit, apply4 };

/** Encaja cada punto marcado al punto más cercano del destino si está a < maxDist mm (VOXEL _snap); si no, lo deja. */
export function snapToTarget(points, target, maxDist = 3) {
  const grid = makeGrid(target);
  return points.map((p) => { const h = grid.nearest(p[0], p[1], p[2]); return h && h.d2 <= maxDist * maxDist ? [grid.pts[h.i], grid.pts[h.i + 1], grid.pts[h.i + 2]] : p; });
}
