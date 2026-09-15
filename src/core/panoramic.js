// tresD DICOM — CORTE CURVO PANORÁMICO (reconstrucción tipo ortopantomografía a partir del CBCT).
//  1. Curva de la arcada: de la superficie dental detectada para la alineación (align.pickTargets → state.teeth)
//     se toman las coronas de las dos arcadas proyectadas sobre el plano oclusal; se agrupan por columnas
//     laterales (bins de 3 mm en X), mediana antero-posterior por columna, suavizado y extensión de 10 mm por
//     cada extremo hacia atrás (ramas). De ahí salen 9 puntos de CONTROL (que el usuario puede arrastrar sobre
//     el corte axial) y la curva final es una Catmull-Rom entre ellos remuestreada cada 0,4 mm.
//  2. Imagen: columnas = posición a lo largo de la curva (derecha del paciente a la IZQUIERDA de la imagen,
//     como en una panorámica), filas = altura Z (desde 45 mm por debajo de la línea oclusal hasta 40 por
//     encima); cada píxel promedia (o toma el máximo, MIP) las muestras del volumen a lo largo de la NORMAL a
//     la curva dentro del grosor elegido (suma de rayos, como los equipos comerciales).
// Todo en el marco LPS del volumen (derecha del paciente = −X, anterior = −Y, superior = +Z).

import { paintGray } from './tmj.js';

const STEP = 0.4;            // mm por píxel (columnas y filas)
const N_CONTROL = 13;        // puntos de control de la curva (los que se arrastran para editarla)
// alto de la imagen respecto a la línea oclusal: hasta la basal por abajo y por encima de los CÓNDILOS
// por arriba (v0.7.2, petición de Manuel: que se vean las ATM en la panorámica).
const Z_BELOW = 48, Z_ABOVE = 78;
const EXT = 50;              // mm que se prolonga la curva por cada extremo (ramas → cóndilos)

/**
 * Curva de la arcada a partir de los destinos dentales { all: { pts }, mid }. Devuelve
 * { pts: [[x,y]…] (de −X a +X, es decir, de la derecha del paciente a su izquierda), z, tangents, normals, length } | null.
 */
export function archCurve(teeth) {
  if (!teeth || !teeth.all || teeth.all.n < 200) return null;
  const P = teeth.all.pts, z = teeth.mid;
  // columnas laterales de 3 mm: mediana de Y (antero-posterior) de las coronas de cada columna
  const BIN = 3;
  const cols = new Map();
  for (let i = 0; i < P.length; i += 3) {
    if (Math.abs(P[i + 2] - z) > 14) continue;
    const b = Math.round(P[i] / BIN);
    let c = cols.get(b); if (!c) { c = []; cols.set(b, c); }
    c.push(P[i + 1]);
  }
  const keys = [...cols.keys()].filter((k) => cols.get(k).length >= 8).sort((a, b) => a - b);
  if (keys.length < 5) return null;
  const pts = keys.map((k) => { const ys = cols.get(k).sort((a, b) => a - b); return [k * BIN, ys[Math.floor(ys.length / 2)]]; });
  // suavizado (media móvil de 3) manteniendo los extremos
  const sm = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; return [p[0], (a[1] + p[1] + b[1]) / 3]; });
  // Extensión por cada extremo hacia las RAMAS y los cóndilos. La tangente de la arcada en los últimos
  // molares apunta hacia atrás Y hacia fuera; la rama, en cambio, sube casi recta hacia atrás, así que la
  // dirección se mezcla con «posterior» (+Y en LPS) y además se limita cuánto puede abrirse hacia el lado
  // (los cóndilos no quedan mucho más afuera que los molares). Es una estimación: los dos puntos de control
  // de cada extremo se arrastran para ajustarla al caso.
  const n = sm.length;
  const maxX = Math.max(...sm.map((p) => Math.abs(p[0]))) + 14;
  const ext = (a, b, d1) => {
    const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(d[0], d[1]) || 1;
    let u = [0.45 * (d[0] / l), 0.45 * (d[1] / l) + 0.55];       // + 0.55 hacia posterior
    const ul = Math.hypot(u[0], u[1]) || 1; u = [u[0] / ul, u[1] / ul];
    const x = b[0] + u[0] * d1;
    return [Math.max(-maxX, Math.min(maxX, x)), b[1] + u[1] * d1];
  };
  const rIn = sm[Math.min(2, n - 1)], lIn = sm[Math.max(0, n - 3)];
  const poly = [ext(rIn, sm[0], EXT), ext(rIn, sm[0], EXT / 2), ...sm, ext(lIn, sm[n - 1], EXT / 2), ext(lIn, sm[n - 1], EXT)];
  return curveFrom(controlPoints(poly, N_CONTROL), z);
}

/** `n` puntos de CONTROL repartidos por igual a lo largo de una polilínea (los que el usuario arrastra). */
function controlPoints(poly, n) {
  const d = [0];
  for (let i = 1; i < poly.length; i++) d.push(d[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  const total = d[d.length - 1] || 1;
  const out = [];
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    let i = 1; while (i < d.length - 1 && d[i] < target) i++;
    const t = (target - d[i - 1]) / ((d[i] - d[i - 1]) || 1);
    out.push([poly[i - 1][0] + t * (poly[i][0] - poly[i - 1][0]), poly[i - 1][1] + t * (poly[i][1] - poly[i - 1][1])]);
  }
  return out;
}

/**
 * Curva completa a partir de los puntos de CONTROL: Catmull-Rom entre ellos y remuestreo por longitud de
 * arco cada STEP mm. Devuelve { control, pts, z, tangents, normals, length, step }.
 */
export function curveFrom(control, z) {
  if (!control || control.length < 3) return null;
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return [0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)];
  };
  const dense = [];
  for (let i = 0; i < control.length - 1; i++) {
    const p0 = control[Math.max(0, i - 1)], p1 = control[i], p2 = control[i + 1], p3 = control[Math.min(control.length - 1, i + 2)];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(segLen / 0.1));
    for (let s = 0; s < steps; s++) dense.push(cr(p0, p1, p2, p3, s / steps));
  }
  dense.push(control[control.length - 1]);
  const out = [];
  let acc = 0, next = 0;
  for (let i = 0; i < dense.length; i++) {
    if (i) acc += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    if (acc >= next) { out.push(dense[i]); next += STEP; }
  }
  if (out.length < 20) return null;
  const tangents = out.map((p, i) => { const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)]; const d = [b[0] - a[0], b[1] - a[1]]; const l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; });
  const normals = tangents.map((t) => [-t[1], t[0]]);
  return { control: control.map((p) => p.slice()), pts: out, z, tangents, normals, length: acc, step: STEP };
}

/**
 * Imagen panorámica { width, height, data: Float32Array (fila 0 = arriba), step, zTop, curve }.
 * volume = volumen Cornerstone (imageData + voxelManager); opts = { thickness (mm), mip }.
 */
export function buildPanoramic(volume, getSlice, curve, opts = {}) {
  const T = Math.max(0.5, opts.thickness || 22), mip = !!opts.mip;
  const img = volume.imageData;
  const dims = img.getDimensions();
  const sp = Math.min(...volume.spacing);
  const nT = Math.max(1, Math.round(T / Math.max(sp, 0.25)));
  const dt = nT > 1 ? T / (nT - 1) : 0;
  const zTop = curve.z + Z_ABOVE, zBot = curve.z - Z_BELOW;
  const height = Math.round((zTop - zBot) / STEP), width = curve.pts.length;
  const data = new Float32Array(width * height);
  // índice = A·(mundo − o): afín, se calcula una vez; los cortes se leen por k (referencias en caché)
  const o = img.indexToWorld([0, 0, 0], [0, 0, 0]);
  const A = worldToIndexMatrix(img);
  const slices = new Array(dims[2]).fill(null);
  const nx = dims[0];
  const at = (x, y, z) => {
    const dx = x - o[0], dy = y - o[1], dz = z - o[2];
    const i = Math.round(A[0] * dx + A[1] * dy + A[2] * dz), j = Math.round(A[3] * dx + A[4] * dy + A[5] * dz), k = Math.round(A[6] * dx + A[7] * dy + A[8] * dz);
    if (i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2]) return -1000;
    let s = slices[k]; if (!s) { s = getSlice(k); if (!s) return -1000; slices[k] = s; }
    return s[j * nx + i];
  };
  // la derecha del paciente (−X) queda a la IZQUIERDA de la imagen: la curva ya va de −X a +X
  for (let c = 0; c < width; c++) {
    const p = curve.pts[c], nrm = curve.normals[c];
    const x0 = p[0] - nrm[0] * (T / 2), y0 = p[1] - nrm[1] * (T / 2);
    for (let r = 0; r < height; r++) {
      const z = zTop - r * STEP;
      let acc = mip ? -Infinity : 0;
      for (let s = 0; s < nT; s++) {
        const v = at(x0 + nrm[0] * dt * s, y0 + nrm[1] * dt * s, z);
        if (mip) { if (v > acc) acc = v; } else acc += v;
      }
      data[r * width + c] = mip ? acc : acc / nT;
    }
  }
  return { width, height, data, step: STEP, zTop, zBot, curve, win: autoWindow(data) };
}

/** Ventana automática de la panorámica (percentiles de su propio histograma). Es imprescindible con MIP:
 *  al quedarse con el máximo de cada rayo, la ventana de los cortes MPR satura la imagen en blanco.
 *  v0.7.2: la ventana se ENSANCHA sobre los percentiles. Antes se recortaba en p62–p99,5 y salían
 *  panorámicas durísimas (fondo negro del todo y dientes quemados); ahora el negro entra por debajo de
 *  las partes blandas y el blanco por encima del esmalte, que es como se ven en los equipos. */
const PAN_WIDEN = 1.15;
function autoWindow(data) {
  const n = data.length, stride = Math.max(1, Math.floor(n / 60000));
  const s = [];
  for (let i = 0; i < n; i += stride) s.push(data[i]);
  s.sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
  // negro justo por debajo de las partes blandas (no en el hueso, que es lo que quemaba la imagen) y
  // blanco en el esmalte, dejando fuera los picos de metal (por eso p98,8 y no p99,9)
  const lo = q(42), hi = q(98.8);
  const c = (lo + hi) / 2, w = Math.max(2, (hi - lo) * PAN_WIDEN);
  return { lower: c - w / 2, upper: c + w / 2 };
}

function worldToIndexMatrix(img) {
  const o = img.indexToWorld([0, 0, 0], [0, 0, 0]);
  const e = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => { const w = img.indexToWorld(v, [0, 0, 0]); return [w[0] - o[0], w[1] - o[1], w[2] - o[2]]; });
  // M = [e0 e1 e2] por columnas; A = M⁻¹
  const M = [e[0][0], e[1][0], e[2][0], e[0][1], e[1][1], e[2][1], e[0][2], e[1][2], e[2][2]];
  const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  return [
    (M[4] * M[8] - M[5] * M[7]) / det, (M[2] * M[7] - M[1] * M[8]) / det, (M[1] * M[5] - M[2] * M[4]) / det,
    (M[5] * M[6] - M[3] * M[8]) / det, (M[0] * M[8] - M[2] * M[6]) / det, (M[2] * M[3] - M[0] * M[5]) / det,
    (M[3] * M[7] - M[4] * M[6]) / det, (M[1] * M[6] - M[0] * M[7]) / det, (M[0] * M[4] - M[1] * M[3]) / det];
}

/** Pinta la panorámica en un canvas con la ventana { lower, upper } (gris). */
export function drawPanoramic(canvas, pan, win, zoom = 1) {
  paintGray(canvas, pan.width, pan.height, pan.data, win, zoom);
}
