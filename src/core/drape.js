// tresD DICOM — DRAPEADO de una FOTO FRONTAL sobre la piel 3D (Fase 3). Port de VOXEL
// (`wizard._face_drape_3d`, `_detect_face3d`, `viewer3d.drape_texture`, `face_register.solve_pose`):
//   1) MediaPipe FaceMesh detecta los 468 puntos de la cara en la FOTO y en un RENDER FRONTAL de la piel
//      segmentada; los del render se retroproyectan a la malla (rayo) → puntos 3D.
//   2) Pose de la cámara (PnP): rotación, traslación y focal que proyectan los puntos 3D sobre los 2D
//      (Levenberg-Marquardt con pesos robustos; inicio = cámara frontal en el marco del paciente).
//   3) Cada vértice de la piel se proyecta con esa cámara → coordenadas de textura; los vértices que
//      no miran a la cámara o caen fuera de la zona de la cara toman un color de piel plano (atlas con
//      margen), como VOXEL. Todo en el navegador; la foto nunca sale del equipo.
// MediaPipe Face Mesh (Apache-2.0) se sirve desde ./mediapipe/ (sin CDN).

// ---------------------------------------------------------------- MediaPipe
let fmLoad = null, fmInstance = null;
export function loadFaceMesh() {
  if (!fmLoad) {
    fmLoad = new Promise((resolve, reject) => {
      if (window.FaceMesh) { resolve(window.FaceMesh); return; }
      const s = document.createElement('script');
      s.src = './mediapipe/face_mesh.js'; s.async = true;
      s.onload = () => (window.FaceMesh ? resolve(window.FaceMesh) : reject(new Error('FaceMesh no disponible')));
      s.onerror = () => reject(new Error('No se pudo cargar MediaPipe (./mediapipe/face_mesh.js)'));
      document.head.appendChild(s);
    });
  }
  return fmLoad;
}

/**
 * Detecta la cara en una imagen (HTMLImageElement / canvas). Devuelve 478 puntos [x, y] normalizados
 * (0..1, origen arriba-izquierda) o null si no reconoce ninguna cara.
 */
let fmConf = null;
export async function detectFace(imageSource, confidence = 0.5) {
  const FaceMesh = await loadFaceMesh();
  if (!fmInstance) fmInstance = new FaceMesh({ locateFile: (f) => './mediapipe/' + f });
  if (fmConf !== confidence) {                  // antes la confianza solo se aplicaba al crear la instancia
    fmInstance.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: confidence, minTrackingConfidence: confidence });
    fmConf = confidence;
  }
  try { fmInstance.reset(); } catch (e) { /* nada */ }
  const res = await new Promise((resolve, reject) => {
    fmInstance.onResults(resolve);
    fmInstance.send({ image: imageSource }).catch(reject);
  });
  const lm = res && res.multiFaceLandmarks && res.multiFaceLandmarks[0];
  return lm ? lm.map((p) => [p.x, p.y]) : null;
}

// Puntos guiados para el registro MANUAL (si MediaPipe no reconoce la piel 3D, p. ej. CBCT sin ojos).
// Desde v0.7.15 son TRES clics (petición de Manuel): punta de la nariz y las dos comisuras, un triángulo con
// profundidad (la nariz sobresale) que basta para la pose con la focal fija. Índices de FaceMesh equivalentes
// (para prellenarlos con la detección automática de la foto).
export const GUIDED_POINTS = [
  { key: 'prn', idx: 1 },      // punta de la nariz
  { key: 'ch_r', idx: 61 },    // comisura derecha del paciente (a la IZQUIERDA en la foto)
  { key: 'ch_l', idx: 291 },   // comisura izquierda del paciente
];

/**
 * Caja de la cara en la foto a partir de los TRES puntos guiados (nariz, comisura D, comisura I), por
 * proporciones faciales: ancho de la cara ≈ 3 bocas; de la nariz a la frente ≈ 2 bocas; de la boca al mentón ≈ 1.
 */
export function faceBoxFrom3(p2, W, H) {
  const [prn, chr, chl] = p2;
  const m = Math.max(20, Math.hypot(chl[0] - chr[0], chl[1] - chr[1]));
  const cx = (chr[0] + chl[0]) / 2, my = (chr[1] + chl[1]) / 2;
  return [Math.max(0, cx - 1.6 * m), Math.max(0, prn[1] - 2.2 * m), Math.min(W, cx + 1.6 * m), Math.min(H, my + 1.3 * m)];
}

// ---------------------------------------------------------------- álgebra mínima
const R0 = [1, 0, 0, 0, 0, -1, 0, 1, 0];      // cámara frontal en LPS: x=+X (izq. paciente), y=-Z (abajo), z=+Y (posterior)
function matVec(R, v) { return [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]]; }
function matMul(A, B) { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[3 * i + j] += A[3 * i + k] * B[3 * k + j]; return C; }
function rodrigues(w) {
  const th = Math.hypot(w[0], w[1], w[2]);
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const k = [w[0] / th, w[1] / th, w[2] / th], c = Math.cos(th), s = Math.sin(th), v = 1 - c;
  return [c + k[0] * k[0] * v, k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s,
    k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v, k[1] * k[2] * v - k[0] * s,
    k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v];
}
function solve7(A, b) {                           // Gauss con pivote (7×7)
  const n = 7; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-14) return null;
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function median(a) { const s = Float64Array.from(a).sort(); return s.length ? s[Math.floor(s.length / 2)] : 0; }

// ---------------------------------------------------------------- PnP (pose + focal)
/**
 * Pose de la cámara a partir de pares 2D (píxeles de la foto) ↔ 3D (mm, mundo). W,H = tamaño de la foto.
 * Devuelve { R (9, fila-mayor), t, f, cx, cy, err (px, mediana), inliers, n } o null.
 */
export function solvePose(pts2d, pts3d, W, H, opts = {}) {
  const n = Math.min(pts2d.length, pts3d.length);
  if (n < 3 || (n < 4 && !opts.f)) return null;      // con 3 puntos solo si la focal viene fija (P3P)
  const cx = W / 2, cy = H / 2;
  // inicio: cámara frontal; distancia por el tamaño de la cara (mm vs px) con focal ≈ 1,2·W
  const c3 = [0, 0, 0]; for (let i = 0; i < n; i++) { c3[0] += pts3d[i][0]; c3[1] += pts3d[i][1]; c3[2] += pts3d[i][2]; } c3[0] /= n; c3[1] /= n; c3[2] /= n;
  let xs3 = 0, xs2 = 0;
  for (let i = 0; i < n; i++) { const q = matVec(R0, [pts3d[i][0] - c3[0], pts3d[i][1] - c3[1], pts3d[i][2] - c3[2]]); xs3 += Math.abs(q[0]); xs2 += Math.abs(pts2d[i][0] - cx); }
  let f = opts.f || 1.2 * W;
  const d0 = Math.max(150, (f * (xs3 / n)) / Math.max(1, xs2 / n));
  let R = R0.slice();
  let t = [0, 0, d0]; { const rc = matVec(R, c3); t = [-rc[0], -rc[1], d0 - rc[2]]; }
  const fixF = !!opts.f;
  const proj = (Rm, tm, fm, P) => { const q = matVec(Rm, P); const z = q[0 + 2] + tm[2]; return [fm * (q[0] + tm[0]) / z + cx, fm * (q[1] + tm[1]) / z + cy, z]; };
  const wts = new Float64Array(n).fill(1);
  let lambda = 1e-3, lastCost = Infinity;
  const residuals = (Rm, tm, fm) => { const r = new Float64Array(2 * n); for (let i = 0; i < n; i++) { const p = proj(Rm, tm, fm, pts3d[i]); r[2 * i] = p[0] - pts2d[i][0]; r[2 * i + 1] = p[1] - pts2d[i][1]; } return r; };
  const cost = (r) => { let s = 0; for (let i = 0; i < n; i++) s += wts[i] * (r[2 * i] ** 2 + r[2 * i + 1] ** 2); return s; };
  for (let it = 0; it < 60; it++) {
    const r0 = residuals(R, t, f);
    // pesos robustos (Huber) a partir de la 3.ª iteración
    if (it >= 3) { const d = []; for (let i = 0; i < n; i++) d.push(Math.hypot(r0[2 * i], r0[2 * i + 1])); const delta = Math.max(2, 1.5 * median(d)); for (let i = 0; i < n; i++) wts[i] = d[i] <= delta ? 1 : delta / d[i]; }
    const c0 = cost(r0);
    // jacobiano numérico: 7 parámetros (ω, t, log f)
    const J = []; const eps = [1e-4, 1e-4, 1e-4, 1e-2, 1e-2, 1e-2, 1e-3];
    for (let p = 0; p < 7; p++) {
      if (p === 6 && fixF) { J.push(new Float64Array(2 * n)); continue; }
      const dw = [0, 0, 0], dt = [0, 0, 0]; let df = 1;
      if (p < 3) dw[p] = eps[p]; else if (p < 6) dt[p - 3] = eps[p]; else df = Math.exp(eps[6]);
      const Rp = p < 3 ? matMul(rodrigues(dw), R) : R;
      const r1 = residuals(Rp, [t[0] + dt[0], t[1] + dt[1], t[2] + dt[2]], f * df);
      const col = new Float64Array(2 * n); for (let k = 0; k < 2 * n; k++) col[k] = (r1[k] - r0[k]) / eps[p];
      J.push(col);
    }
    // ecuaciones normales con amortiguación
    const A = [], b = [];
    for (let i = 0; i < 7; i++) { A.push(new Array(7).fill(0)); b.push(0); }
    for (let k = 0; k < 2 * n; k++) {
      const w = wts[k >> 1];
      for (let i = 0; i < 7; i++) { b[i] -= w * J[i][k] * r0[k]; for (let j = 0; j < 7; j++) A[i][j] += w * J[i][k] * J[j][k]; }
    }
    for (let i = 0; i < 7; i++) A[i][i] *= (1 + lambda);
    if (fixF) { A[6][6] = 1; b[6] = 0; }
    const dx = solve7(A, b);
    if (!dx) break;
    const Rn = matMul(rodrigues([dx[0], dx[1], dx[2]]), R), tn = [t[0] + dx[3], t[1] + dx[4], t[2] + dx[5]];
    const fn = fixF ? f : Math.max(0.5 * W, Math.min(8 * W, f * Math.exp(dx[6])));   // focal acotada (0,5·W … 8·W)
    const c1 = cost(residuals(Rn, tn, fn));
    if (c1 < c0) { R = Rn; t = tn; f = fn; lambda = Math.max(1e-6, lambda / 3); if (Math.abs(lastCost - c1) < 1e-6 * Math.max(1, c1)) break; lastCost = c1; }
    else { lambda *= 5; if (lambda > 1e6) break; }
  }
  const r = residuals(R, t, f);
  const d = []; for (let i = 0; i < n; i++) d.push(Math.hypot(r[2 * i], r[2 * i + 1]));
  const med = median(d);
  let inl = 0; for (const v of d) if (v <= Math.max(4, 3 * med)) inl++;
  // comprobación: la cara debe quedar DELANTE de la cámara
  const zc = matVec(R, c3)[2] + t[2];
  if (!(zc > 0) || !Number.isFinite(f)) return null;
  return { R, t, f, cx, cy, err: med, inliers: inl, n, dist: zc };
}

/** Centro de la cámara en el mundo. */
export function cameraCenter(pose) {
  const { R, t } = pose;                      // C = -Rᵀ t
  return [-(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]), -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]), -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2])];
}

// ---------------------------------------------------------------- textura (atlas) y UV
/**
 * Compone el atlas: el RECORTE de la foto a la caja de la cara (box, píxeles) con un margen de color piel
 * (mediana en mejillas / frente / mentón según los puntos detectados, o un tono por defecto). Los vértices
 * que no reciben foto se mandan a ese margen, pegados al borde del recorte, para que la costura sea suave.
 * Devuelve { canvas, pad:[bx,by], box, skin }.
 */
export function buildAtlas(image, W, H, lm2d, box, padFrac = 0.08) {
  const [x0, y0, x1, y1] = box.map(Math.round);
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const bx = Math.max(8, Math.round(bw * padFrac)), by = Math.max(8, Math.round(bh * padFrac));
  const c = document.createElement('canvas'); c.width = bw + 2 * bx; c.height = bh + 2 * by;
  const g = c.getContext('2d');
  let skin = 'rgb(214,170,150)';
  try {
    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
    const tg = tmp.getContext('2d'); tg.drawImage(image, 0, 0, W, H);
    const px = [];
    for (const i of (lm2d ? [50, 280, 10, 199, 101, 330, 36, 266] : [])) {
      const p = lm2d[i]; if (!p) continue;
      const d = tg.getImageData(Math.max(0, Math.min(W - 3, Math.round(p[0] * W) - 1)), Math.max(0, Math.min(H - 3, Math.round(p[1] * H) - 1)), 3, 3).data;
      for (let k = 0; k < d.length; k += 4) px.push([d[k], d[k + 1], d[k + 2]]);
    }
    if (!px.length) {                              // sin puntos: mediana del centro del recorte
      const d = tg.getImageData(Math.round(x0 + bw * 0.4), Math.round(y0 + bh * 0.4), Math.max(1, Math.round(bw * 0.2)), Math.max(1, Math.round(bh * 0.2))).data;
      for (let k = 0; k < d.length; k += 16) px.push([d[k], d[k + 1], d[k + 2]]);
    }
    if (px.length) skin = `rgb(${Math.round(median(px.map((p) => p[0])))},${Math.round(median(px.map((p) => p[1])))},${Math.round(median(px.map((p) => p[2])))})`;
  } catch (e) { /* tono por defecto */ }
  g.fillStyle = skin; g.fillRect(0, 0, c.width, c.height);
  // "bleed": el recorte ampliado y semitransparente debajo (suaviza la costura) y el recorte nítido encima
  g.globalAlpha = 0.5; g.drawImage(image, x0, y0, bw, bh, -bx, -by, bw + 4 * bx, bh + 4 * by); g.globalAlpha = 1;
  g.drawImage(image, x0, y0, bw, bh, bx, by, bw, bh);
  return { canvas: c, pad: [bx, by], box: [x0, y0, x0 + bw, y0 + bh], skin };
}

/**
 * Coordenadas de textura por vértice. pts/normals Float32Array; pose de solvePose; atlas de buildAtlas.
 * Un vértice recibe la foto si cae dentro de la caja de la cara y mira a la cámara; si no, va al margen de
 * color piel pegado al borde más cercano del recorte. Devuelve { uv: Float32Array(2n), painted }.
 */
export function projectUV(pts, normals, pose, W, H, atlas) {
  const n = pts.length / 3;
  const uv = new Float32Array(2 * n);
  const AW = atlas.canvas.width, AH = atlas.canvas.height; const [bx, by] = atlas.pad;
  const [x0, y0, x1, y1] = atlas.box; const bw = x1 - x0, bh = y1 - y0;
  const C = cameraCenter(pose);
  const { R, t, f, cx, cy } = pose;
  let painted = 0;
  for (let i = 0; i < n; i++) {
    const x = pts[3 * i], y = pts[3 * i + 1], z = pts[3 * i + 2];
    const qx = R[0] * x + R[1] * y + R[2] * z + t[0], qy = R[3] * x + R[4] * y + R[5] * z + t[1], qz = R[6] * x + R[7] * y + R[8] * z + t[2];
    let u, v, ok = qz > 1;
    if (ok) { u = f * qx / qz + cx; v = f * qy / qz + cy; ok = u >= x0 && u <= x1 && v >= y0 && v <= y1; }
    else { u = x0 + bw / 2; v = y1 + bh; }                   // detrás de la cámara: margen inferior
    if (ok && normals) {
      const tx = C[0] - x, ty = C[1] - y, tz = C[2] - z; const l = Math.hypot(tx, ty, tz) || 1;
      ok = (normals[3 * i] * tx + normals[3 * i + 1] * ty + normals[3 * i + 2] * tz) / l > 0.2;    // mira a la cámara (no la silueta)
    }
    if (ok) { uv[2 * i] = (u - x0 + bx) / AW; uv[2 * i + 1] = 1 - (v - y0 + by) / AH; painted++; continue; }
    // al margen: se pega al borde más cercano del recorte y se empuja medio margen hacia fuera
    const cu = Math.max(x0, Math.min(x1, u)), cv = Math.max(y0, Math.min(y1, v));
    const dl = cu - x0, dr = x1 - cu, dt = cv - y0, db = y1 - cv;
    const m = Math.min(dl, dr, dt, db);
    let au = cu - x0 + bx, av = cv - y0 + by;
    if (m === dl) au = bx * 0.5; else if (m === dr) au = bw + bx * 1.5; else if (m === dt) av = by * 0.5; else av = bh + by * 1.5;
    uv[2 * i] = au / AW; uv[2 * i + 1] = 1 - av / AH;
  }
  return { uv, painted };
}

/** Caja de la cara en píxeles a partir de los puntos 2D (ampliada: lados +35 %, arriba +60 %, abajo +25 %). */
export function faceBoxFrom(lm2d, W, H) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of lm2d) { const x = p[0] * W, y = p[1] * H; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const w = x1 - x0, h = y1 - y0;
  return [Math.max(0, x0 - 0.35 * w), Math.max(0, y0 - 0.6 * h), Math.min(W, x1 + 0.35 * w), Math.min(H, y1 + 0.25 * h)];
}
