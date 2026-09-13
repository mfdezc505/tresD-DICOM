// tresD DICOM — AUTORIENTACIÓN de una arcada escaneada al marco del paciente.
// Portado de tresD_Models/tresd_models/core/orient.py (mismo método, misma lógica de decisión):
//   1) EJE OCLUSAL = eje de menor dispersión (PCA). Lado de los dientes: (a) la bóveda (paladar /
//      suelo lingual) está ENFRENTE de las caras oclusales; (b) si no hay bóveda, al cortar cerca de
//      las cúspides cada diente deja su islita (se cuentan los trozos de la sección); (c) último
//      recurso, hacia las cúspides hay menos superficie que hacia la base.
//   2) EJE ANTERO-POSTERIOR: el ángulo lo da la LÍNEA MEDIA (mejor simetría de la silueta con su
//      reflejo); el sentido, la forma de U (se ensancha hacia posterior).
//   3) EJE TRANSVERSAL por producto vectorial (rotación propia, nunca espejo).
// Salida en el marco DICOM/LPS del visor: +X = izquierda del paciente, +Y = posterior, +Z = superior
// (tresD Models usa +X derecha / +Y anterior; aquí se convierte para coincidir con el CBCT).

export const MIN_CORR = 0.45;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a) || 1e-12; return [a[0] / n, a[1] / n, a[2] / n]; };
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

function percentile(arr, p) {
  const s = Float64Array.from(arr).sort();
  if (!s.length) return 0;
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
}
function mean(arr) { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i]; return arr.length ? s / arr.length : 0; }
function median(arr) { return percentile(arr, 50); }

/** Submuestra los puntos (Float32Array xyz) a como mucho `max` puntos: devuelve array de [x,y,z]. */
function samplePoints(pts, max) {
  const n = pts.length / 3;
  const stride = Math.max(1, Math.floor(n / max));
  const out = [];
  for (let i = 0; i < n; i += stride) out.push([pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]]);
  return out;
}

function centroid(P) {
  const c = [0, 0, 0];
  for (const p of P) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return scale(c, 1 / Math.max(1, P.length));
}

/** Autovector del menor autovalor de la covarianza (Jacobi 3×3). */
function smallestAxis(P, c) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of P) {
    const d = sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j];
  }
  // Jacobi
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const A = C.map((r) => r.slice());
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += A[i][j] * A[i][j];
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(A[p][q]) < 1e-30) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 3; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = cs * akp - sn * akq; A[k][q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = cs * apk - sn * aqk; A[q][k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = cs * vkp - sn * vkq; V[k][q] = sn * vkp + cs * vkq;
      }
    }
  }
  let imin = 0;
  for (let i = 1; i < 3; i++) if (A[i][i] < A[imin][imin]) imin = i;
  return unit([V[0][imin], V[1][imin], V[2][imin]]);
}

/** Base ortonormal del plano perpendicular a `axis`. */
function planeBasis(axis) {
  let tmp = [1, 0, 0];
  if (Math.abs(dot(tmp, axis)) > 0.9) tmp = [0, 1, 0];
  const e1 = unit(cross(axis, tmp));
  const e2 = unit(cross(axis, e1));
  return [e1, e2];
}

/** Lado de la BÓVEDA (+1/-1) respecto al eje, o null si el hueco de la U está vacío. */
function vaultSide(P, axis, c) {
  const [e1, e2] = planeBasis(axis);
  const XY = P.map((p) => { const d = sub(p, c); return [dot(d, e1), dot(d, e2)]; });
  const mx = mean(XY.map((q) => q[0])), my = mean(XY.map((q) => q[1]));
  const r = XY.map((q) => Math.hypot(q[0] - mx, q[1] - my));
  const thr = percentile(r, 12);
  const inside = [];
  for (let i = 0; i < P.length; i++) if (r[i] < thr) inside.push(i);
  if (inside.length < Math.max(200, 0.005 * P.length)) return null;
  const s = P.map((p) => dot(sub(p, c), axis));
  const sIn = mean(inside.map((i) => s[i]));
  return sIn > median(s) ? 1 : -1;
}

/**
 * Cuántos trozos sueltos deja la sección de la malla por un plano (normal `axis`, punto `origin`).
 * Se intersectan los triángulos con el plano y se unen los segmentos por sus extremos (coordenadas
 * cuantizadas a 0,01 mm: vale aunque los vértices vengan duplicados, como en STL binario).
 */
function islands(pts, polys, axis, origin) {
  const d0 = dot(axis, origin);
  const parent = new Map();
  const find = (k) => { let r = k; while (parent.get(r) !== r) r = parent.get(r); let x = k; while (parent.get(x) !== r) { const nx = parent.get(x); parent.set(x, r); x = nx; } return r; };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const key = (p) => (Math.round(p[0] * 100) + ',' + Math.round(p[1] * 100) + ',' + Math.round(p[2] * 100));
  const segCount = new Map();
  let nseg = 0;
  const v = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], sd = [0, 0, 0];
  for (let t = 0; t < polys.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const id = polys[t + k];
      v[k][0] = pts[3 * id]; v[k][1] = pts[3 * id + 1]; v[k][2] = pts[3 * id + 2];
      sd[k] = dot(axis, v[k]) - d0;
    }
    const hits = [];
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3], sa = sd[k], sb = sd[(k + 1) % 3];
      if ((sa > 0 && sb <= 0) || (sa <= 0 && sb > 0)) {
        const f = sa / (sa - sb);
        hits.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])]);
      }
    }
    if (hits.length === 2) {
      const ka = key(hits[0]), kb = key(hits[1]);
      add(ka); add(kb); union(ka, kb); nseg++;
    }
  }
  if (!nseg) return 0;
  for (const k of parent.keys()) { const r = find(k); segCount.set(r, (segCount.get(r) || 0) + 1); }
  let n = 0;
  for (const cnt of segCount.values()) if (cnt >= 4) n++;      // trozos de al menos ~4 puntos
  return n;
}

/** Centros y áreas de los triángulos (submuestreados). */
function cells(pts, polys, max = 60000) {
  const nt = polys.length / 3;
  const stride = Math.max(1, Math.floor(nt / max));
  const cen = [], areas = [];
  for (let t = 0; t < nt; t += stride) {
    const a = polys[3 * t], b = polys[3 * t + 1], c = polys[3 * t + 2];
    const A = [pts[3 * a], pts[3 * a + 1], pts[3 * a + 2]], B = [pts[3 * b], pts[3 * b + 1], pts[3 * b + 2]], Cc = [pts[3 * c], pts[3 * c + 1], pts[3 * c + 2]];
    cen.push([(A[0] + B[0] + Cc[0]) / 3, (A[1] + B[1] + Cc[1]) / 3, (A[2] + B[2] + Cc[2]) / 3]);
    areas.push(0.5 * norm(cross(sub(B, A), sub(Cc, A))));
  }
  return { cen, areas };
}

/** Vector hacia el lado de los DIENTES + seguridad + detalle. */
function occlusalAxis(pts, polys, P) {
  const c = centroid(P);
  const axis = smallestAxis(P, c);
  const vault = vaultSide(P, axis, c);
  if (vault !== null) return { occ: scale(axis, -vault), sure: true, detail: 'vault', c };
  const s = P.map((p) => dot(sub(p, c), axis));
  const cut = (pcts) => mean(pcts.map((q) => islands(pts, polys, axis, [c[0] + percentile(s, q) * axis[0], c[1] + percentile(s, q) * axis[1], c[2] + percentile(s, q) * axis[2]])));
  const hi = cut([72, 80, 88]), lo = cut([12, 20, 28]);
  if (Math.max(hi, lo) >= 3 && Math.abs(hi - lo) >= 1.5) {
    return { occ: scale(axis, hi > lo ? 1 : -1), sure: true, detail: `cusps|${Math.round(Math.max(hi, lo))}|${Math.round(Math.min(hi, lo))}`, c };
  }
  const { cen, areas } = cells(pts, polys);
  const sc = cen.map((q) => dot(sub(q, c), axis));
  const p72 = percentile(sc, 72), p28 = percentile(sc, 28);
  let aHi = 0, aLo = 0;
  for (let i = 0; i < sc.length; i++) { if (sc[i] > p72) aHi += areas[i]; else if (sc[i] < p28) aLo += areas[i]; }
  return { occ: scale(axis, aHi < aLo ? 1 : -1), sure: false, detail: `none|${Math.round(hi)}|${Math.round(lo)}`, c };
}

/** Correlación entre avanzar en u y la anchura (positiva = se ensancha hacia +u = posterior). */
function widthCorr(P2, u, v) {
  const s = P2.map((q) => q[0] * u[0] + q[1] * u[1]), t = P2.map((q) => q[0] * v[0] + q[1] * v[1]);
  const lo = percentile(s, 2), hi = percentile(s, 98);
  if (hi - lo < 1e-6) return 0;
  const cx = [], wid = [];
  for (let i = 0; i < 10; i++) {
    const a = lo + (i / 10) * (hi - lo), b = lo + ((i + 1) / 10) * (hi - lo);
    const tt = [];
    for (let k = 0; k < s.length; k++) if (s[k] >= a && s[k] < b) tt.push(t[k]);
    if (tt.length < 20) continue;
    cx.push((a + b) / 2); wid.push(percentile(tt, 97.5) - percentile(tt, 2.5));
  }
  if (cx.length < 5) return 0;
  const mx = mean(cx), mw = mean(wid);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < cx.length; i++) { sxy += (cx[i] - mx) * (wid[i] - mw); sxx += (cx[i] - mx) ** 2; syy += (wid[i] - mw) ** 2; }
  if (syy < 1e-12 || sxx < 1e-12) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** Parecido de la silueta con su reflejo respecto al eje u (rejilla de ~1,2 mm). */
function symmetry(P2, u, v, step = 1.2) {
  let R = 0;
  const s = new Float64Array(P2.length), t = new Float64Array(P2.length);
  for (let i = 0; i < P2.length; i++) {
    s[i] = P2[i][0] * u[0] + P2[i][1] * u[1]; t[i] = P2[i][0] * v[0] + P2[i][1] * v[1];
    R = Math.max(R, Math.abs(s[i]), Math.abs(t[i]));
  }
  R += step;
  const n = Math.floor((2 * R) / step) + 1;
  if (n < 8 || n > 400) return 0;
  const grid = new Uint8Array(n * n);
  for (let i = 0; i < P2.length; i++) {
    const si = Math.floor((s[i] + R) / step), ti = Math.floor((t[i] + R) / step);
    if (si >= 0 && si < n && ti >= 0 && ti < n) grid[si * n + ti] = 1;
  }
  let inter = 0, union = 0;
  for (let si = 0; si < n; si++) for (let ti = 0; ti < n; ti++) {
    const a = grid[si * n + ti], b = grid[si * n + (n - 1 - ti)];
    if (a && b) inter++;
    if (a || b) union++;
  }
  return union ? inter / union : 0;
}

/** Dirección ANTERIOR dentro del plano oclusal: ángulo por simetría, sentido por anchura. */
function apAxis(P2full) {
  const P2 = P2full.length <= 40000 ? P2full : P2full.filter((_, i) => i % Math.ceil(P2full.length / 40000) === 0);
  const axes = (deg) => { const a = (deg * Math.PI) / 180; return [[Math.cos(a), Math.sin(a)], [-Math.sin(a), Math.cos(a)]]; };
  let bestDeg = 0, bestSym = -1;
  for (let deg = 0; deg < 180; deg += 2) { const [u, v] = axes(deg); const sym = symmetry(P2, u, v); if (sym > bestSym) { bestDeg = deg; bestSym = sym; } }
  for (let deg = bestDeg - 2; deg <= bestDeg + 2.01; deg += 0.5) { const [u, v] = axes(deg); const sym = symmetry(P2, u, v); if (sym > bestSym) { bestDeg = deg; bestSym = sym; } }
  const [u, v] = axes(bestDeg);
  const corr = widthCorr(P2, u, v);
  const ant = corr > 0 ? [-u[0], -u[1]] : u;          // se ensancha hacia posterior
  return { ant, corr, sym: bestSym };
}

/**
 * Matriz 4×4 (fila-mayor, 16 números) que lleva la malla al marco LPS del paciente, centrada en el
 * origen. `role` = 'upper' | 'lower'. Devuelve { M, info: {ok, corr, sym, detail, warnings[]} }.
 * pts: Float32Array xyz · polys: índices de triángulos (Uint32Array, 3 por triángulo).
 */
export function patientFrame(pts, polys, role = 'upper') {
  const P = samplePoints(pts, 60000);
  const { occ, sure, detail, c } = occlusalAxis(pts, polys, P);
  const [e1, e2] = planeBasis(occ);
  const P2 = P.map((p) => { const d = sub(p, c); return [dot(d, e1), dot(d, e2)]; });
  const { ant: ant2, corr, sym } = apAxis(P2);
  const ant = unit([ant2[0] * e1[0] + ant2[1] * e2[0], ant2[0] * e1[1] + ant2[1] * e2[1], ant2[0] * e1[2] + ant2[1] * e2[2]]);
  // marco tresD Models: ez arriba (maxilar: dientes hacia abajo), ey anterior, ex derecha
  let ez = role === 'lower' ? occ : scale(occ, -1);
  let ey = unit(sub(ant, scale(ez, dot(ant, ez))));
  let ex = unit(cross(ey, ez));
  ez = cross(ex, ey);
  // conversión a LPS del visor: +X izquierda (= -derecha), +Y posterior (= -anterior), +Z superior
  const rows = [scale(ex, -1), scale(ey, -1), ez];
  const det = dot(rows[0], cross(rows[1], rows[2]));
  if (det < 0) rows[0] = scale(rows[0], -1);              // nunca un espejo
  const R = rows;
  const t = [-dot(R[0], c), -dot(R[1], c), -dot(R[2], c)];
  const M = [R[0][0], R[0][1], R[0][2], t[0], R[1][0], R[1][1], R[1][2], t[1], R[2][0], R[2][1], R[2][2], t[2], 0, 0, 0, 1];
  const warnings = [];
  // códigos (se traducen en la interfaz): 'u_shape|0.30', 'symmetry|0.50', 'side|detalle'
  if (Math.abs(corr) < MIN_CORR) warnings.push(`u_shape|${Math.abs(corr).toFixed(2)}`);
  if (sym < 0.55) warnings.push(`symmetry|${sym.toFixed(2)}`);
  if (!sure) warnings.push(`side|${detail}`);
  const ok = Math.abs(corr) >= MIN_CORR && sure && sym >= 0.55;
  return { M, info: { ok, corr: Math.abs(corr), sym, detail, warnings } };
}

/** Aplica la matriz 4×4 (fila-mayor) a los puntos xyz EN EL SITIO. */
export function applyMatrix(pts, M) {
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    pts[i] = M[0] * x + M[1] * y + M[2] * z + M[3];
    pts[i + 1] = M[4] * x + M[5] * y + M[6] * z + M[7];
    pts[i + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
  }
  return pts;
}

/** Matriz de giro (grados) alrededor de 'x' | 'y' | 'z' pasando por `center`. */
export function rotationAbout(axis, degrees, center) {
  const a = (degrees * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  let R;
  if (axis === 'x') R = [1, 0, 0, 0, ca, -sa, 0, sa, ca];
  else if (axis === 'y') R = [ca, 0, sa, 0, 1, 0, -sa, 0, ca];
  else R = [ca, -sa, 0, sa, ca, 0, 0, 0, 1];
  const c = center;
  const t = [c[0] - (R[0] * c[0] + R[1] * c[1] + R[2] * c[2]), c[1] - (R[3] * c[0] + R[4] * c[1] + R[5] * c[2]), c[2] - (R[6] * c[0] + R[7] * c[1] + R[8] * c[2])];
  return [R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2], 0, 0, 0, 1];
}
