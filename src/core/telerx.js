// tresD DICOM — TELERRADIOGRAFÍA simulada a partir del CBCT (v0.8.1).
// Proyección del volumen con rayos PARALELOS a lo largo de un eje del paciente:
//   · lateral: rayos derecha → izquierda; la cara queda a la DERECHA de la imagen (convención de la telerx)
//   · frontal (PA): rayos anteroposteriores; se mira al paciente de frente (su derecha a la izquierda de la imagen)
// Dos modos a partir de la MISMA pasada por el volumen:
//   · «radiografía»: suma de la atenuación (valor − aire) a lo largo del rayo → log-ventana + realce; se ve el
//     tejido blando y el hueso superpuesto, como en una telerx de verdad
//   · MIP: el valor máximo del rayo → solo hueso denso, dientes y metal
// Sin magnificación (rayos paralelos): escala 1:1 en mm reales (la telerx real amplía un 8-10 %).
// Se proyecta según los ejes del volumen (el eje de índice dominante para X, Y y Z): si el paciente estaba
// inclinado en el escáner, la imagen se gira después en 2D (`rotateImage`), que para una proyección a lo largo
// del eje de giro es exactamente lo mismo que girar el volumen.
import { paintGray } from './tmj.js';

export const TELE_VIEWS = ['lat', 'pa'];
export const TELE_MODES = ['ray', 'mip'];

/** Eje de índice dominante (y su signo) para cada eje del mundo LPS: X (izquierda), Y (posterior), Z (superior). */
function axisFrame(img) {
  const o = img.indexToWorld([0, 0, 0], [0, 0, 0]);
  const e = [0, 1, 2].map((a) => {
    const p = [0, 0, 0]; p[a] = 1;
    const w = img.indexToWorld(p, [0, 0, 0]);
    const v = [w[0] - o[0], w[1] - o[1], w[2] - o[2]];
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return v.map((x) => x / n);
  });
  const of = [0, 1, 2].map((w) => {
    let best = 0;
    for (let a = 1; a < 3; a++) if (Math.abs(e[a][w]) > Math.abs(e[best][w])) best = a;
    return { idx: best, sign: Math.sign(e[best][w]) || 1 };
  });
  return { e, of, distinct: new Set(of.map((x) => x.idx)).size === 3 };
}

function pct(sortedArr, p) { return sortedArr[Math.max(0, Math.min(sortedArr.length - 1, Math.round((p / 100) * (sortedArr.length - 1))))]; }

/** Lleva los valores a 0…1000 entre dos percentiles, con gamma (> 1 oscurece los medios: más contraste en el hueso). */
function normalize(data, pLo, pHi, gamma, loFixed) {
  const n = data.length, stride = Math.max(1, Math.floor(n / 200000));
  const sample = new Float32Array(Math.ceil(n / stride));
  for (let i = 0, k = 0; i < n; i += stride) sample[k++] = data[i];
  sample.sort();
  const lo = Number.isFinite(loFixed) ? loFixed : pct(sample, pLo), hi = Math.max(pct(sample, pHi), lo + 1e-6);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = Math.min(1, Math.max(0, (data[i] - lo) / (hi - lo))); out[i] = 1000 * (gamma === 1 ? x : Math.pow(x, gamma)); }
  return out;
}

/** Realce de bordes (máscara de desenfoque): x + amount·(x − media local), con una caja de radio r. */
function unsharp(data, w, h, r, amount) {
  const tmp = new Float32Array(w * h), blur = new Float32Array(w * h);
  // media horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w; let acc = 0;
    for (let x = -r; x <= r; x++) acc += data[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += data[row + Math.min(w - 1, x + r + 1)] - data[row + Math.max(0, x - r)];
    }
  }
  // media vertical
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      blur[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1000, Math.max(0, data[i] + amount * (data[i] - blur[i])));
  return out;
}

/** Filas remuestreadas (lineal) para que el píxel sea cuadrado cuando el vóxel no lo es. */
function squareRows(data, w, h, stepX, stepY) {
  const h2 = Math.max(2, Math.round((h * stepY) / stepX));
  const out = new Float32Array(w * h2);
  for (let y2 = 0; y2 < h2; y2++) {
    const y = Math.min(h - 1, (y2 * (h - 1)) / (h2 - 1));
    const y0 = Math.floor(y), y1 = Math.min(h - 1, y0 + 1), f = y - y0;
    for (let x = 0; x < w; x++) out[y2 * w + x] = data[y0 * w + x] * (1 - f) + data[y1 * w + x] * f;
  }
  return { data: out, height: h2 };
}

/**
 * Proyecta el volumen. volume = volumen Cornerstone (imageData + spacing); getSlice(k) = datos del corte k
 * (nx·ny, i más rápido). opts = { view: 'lat'|'pa', air: valor del aire (por defecto −1000), mipLo: nivel negro del MIP }.
 * onProgress(0…1) cada pocos cortes (se cede el hilo para que la interfaz pinte).
 * Devuelve { ray, mip }: dos imágenes { view, mode, width, height, data (0…1000), step (mm/px), depth } con la
 * misma geometría (las medidas valen para las dos).
 */
export async function buildTelerx(volume, getSlice, opts = {}, onProgress) {
  const view = opts.view === 'pa' ? 'pa' : 'lat';
  const img = volume.imageData;
  const dims = img.getDimensions(), sp = volume.spacing;
  const { of, distinct } = axisFrame(img);
  if (!distinct) throw new Error('volumen demasiado girado para proyectarlo por sus ejes');
  const X = of[0], Y = of[1], Z = of[2];
  const along = view === 'lat' ? X : Y;
  const colAx = view === 'lat' ? Y : X;
  // lateral: las columnas crecen hacia ANTERIOR (−Y) → cara a la derecha; frontal: hacia la IZQUIERDA del paciente (+X)
  const flipCol = view === 'lat' ? colAx.sign > 0 : colAx.sign < 0;
  const flipRow = Z.sign > 0;                                  // las filas crecen hacia INFERIOR (−Z): superior arriba
  const W = dims[colAx.idx], H = dims[Z.idx];
  const sum = new Float32Array(W * H), mx = new Float32Array(W * H).fill(-1e9);
  // desplazamiento de salida que aporta cada índice de cada eje (0 para el eje del rayo)
  const off = [0, 1, 2].map((a) => {
    const n = dims[a], o = new Int32Array(n);
    if (a === colAx.idx) for (let i = 0; i < n; i++) o[i] = flipCol ? W - 1 - i : i;
    else if (a === Z.idx) for (let i = 0; i < n; i++) o[i] = (flipRow ? H - 1 - i : i) * W;
    return o;
  });
  const air = Number.isFinite(opts.air) ? opts.air : -1000;
  const [nx, ny, nz] = dims;
  const o0 = off[0], o1 = off[1], o2 = off[2];
  for (let k = 0; k < nz; k++) {
    const s = getSlice(k); if (!s) continue;
    const ok = o2[k];
    for (let j = 0; j < ny; j++) {
      const oj = ok + o1[j], base = j * nx;
      for (let i = 0; i < nx; i++) {
        const v = s[base + i], o = oj + o0[i];
        if (v > mx[o]) mx[o] = v;
        const a = v - air; if (a > 0) sum[o] += a;
      }
    }
    if (onProgress && (k & 15) === 15) { onProgress(k / nz); await new Promise((r) => setTimeout(r, 0)); }
  }
  const stepX = sp[colAx.idx], stepY = sp[Z.idx], depth = sp[along.idx];
  for (let i = 0; i < mx.length; i++) if (mx[i] < -1e8) mx[i] = air;
  // radiografía: log-ventana (percentiles) con gamma > 1 para que el tejido blando quede gris y el hueso blanco, y realce
  let ray = normalize(sum, 3, 99.7, 1.6);
  ray = unsharp(ray, W, H, Math.max(2, Math.round(1.5 / stepX)), 0.6);
  // MIP: por debajo del umbral de hueso «blando» (opts.mipLo, ~150 HU) todo negro: así el tejido blando no vela el hueso
  let mip = normalize(mx, 5, 99.8, 0.9, opts.mipLo);
  let height = H;
  if (Math.abs(stepY / stepX - 1) > 0.02) {
    const a = squareRows(ray, W, H, stepX, stepY), b = squareRows(mip, W, H, stepX, stepY);
    ray = a.data; mip = b.data; height = a.height;
  }
  const mk = (mode, data) => ({ view, mode, width: W, height, data, step: stepX, depth, tilt: 0 });
  return { ray: mk('ray', ray), mip: mk('mip', mip) };
}

/** Imagen girada `deg` grados (positivo = antihorario en pantalla) sobre su centro, mismo tamaño (bilineal). */
export function rotateImage(image, deg) {
  if (!deg) return image;
  const { width: w, height: h, data } = image;
  const out = new Float32Array(w * h);
  const th = (deg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // píxel de origen: giro inverso (en pantalla el eje y crece hacia abajo → antihorario = signo cambiado)
      const dx = x - cx, dy = y - cy;
      const sx = cx + c * dx - s * dy, sy = cy + s * dx + c * dy;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
      const fx = sx - x0, fy = sy - y0, i0 = y0 * w + x0;
      out[y * w + x] = (data[i0] * (1 - fx) + data[i0 + 1] * fx) * (1 - fy) + (data[i0 + w] * (1 - fx) + data[i0 + w + 1] * fx) * fy;
    }
  }
  return { ...image, data: out, tilt: deg };
}

/** Gira un punto (px de la imagen) `deg` grados sobre el centro de la imagen: para conservar las medidas al inclinar. */
export function rotatePoint(p, image, deg) {
  const th = (deg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const cx = (image.width - 1) / 2, cy = (image.height - 1) / 2;
  const dx = p[0] - cx, dy = p[1] - cy;
  return [cx + c * dx + s * dy, cy - s * dx + c * dy];
}

export function drawTelerx(canvas, image, win, zoom = 1) {
  paintGray(canvas, image.width, image.height, image.data, win, zoom);
}
