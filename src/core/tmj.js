// tresD DICOM — CORTES DE ATM (port del panel de ATM de VOXEL, `_atm_build_series` / `_atm_slice`).
// Para cada cóndilo se construye su PROPIO marco (no los ejes del volumen) y se sacan cortes remuestreados
// del CBCT sobre planos arbitrarios:
//   · 5 SAGITALES perpendiculares al eje entre polos del cóndilo (medial → lateral, cada 3 mm),
//   · 1 CORONAL central (contiene ese eje),
//   · 1 AXIAL a la altura del cóndilo.
// VOXEL deduce los polos MEDIAL y LATERAL de la cabeza condilar a partir de la mandíbula ya segmentada
// (`derive_condyle_poles`). Aquí no hay mandíbula aparte, así que el usuario marca UN punto sobre cada
// cóndilo (en cualquier corte MPR) y `refineCondyle` hace lo mismo que VOXEL a partir de esa semilla:
// se queda con el hueso de alrededor, sube al ápice de la cabeza, recorta a 12 mm y saca los dos polos.
// Marco LPS: derecha del paciente = −X, anterior = −Y, superior = +Z.

/** Desplazamientos de los 5 sagitales respecto al centro de la ventana (mm; − medial, + lateral).
 *  Desde v0.7.2 van a 1 mm, y la ventana entera se desplaza con la rueda del ratón. */
export const TMJ_SAG_OFFS = [-2, -1, 0, 1, 2];
// ALTO de cada corte (mm). El ANCHO sale de la proporción de la casilla del mosaico (v0.7.3): así el corte
// llena la casilla y no quedan las franjas negras que se veían antes a los lados. La proporción se limita
// para que no salga ni un sello ni una tira.
const H = 34, AXH = 36;
const ASPECT = [0.85, 2.4];
export const clampAspect = (a) => Math.max(ASPECT[0], Math.min(ASPECT[1], Number.isFinite(a) && a > 0 ? a : 1.35));

const SI = [0, 0, 1];                            // superior
const ANT = [0, -1, 0];                          // anterior
const LEFT = [1, 0, 0];                          // izquierda del paciente (queda a la derecha de la imagen)

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addS = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

/** Marco índice ↔ mundo del volumen: { o, e:[e0,e1,e2], inv } (inv·(w−o) = índices continuos). */
function frameOf(img) {
  const o = img.indexToWorld([0, 0, 0], [0, 0, 0]);
  const e = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => sub(img.indexToWorld(v, [0, 0, 0]), o));
  const M = [e[0][0], e[1][0], e[2][0], e[0][1], e[1][1], e[2][1], e[0][2], e[1][2], e[2][2]];
  const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  const inv = [
    (M[4] * M[8] - M[5] * M[7]) / det, (M[2] * M[7] - M[1] * M[8]) / det, (M[1] * M[5] - M[2] * M[4]) / det,
    (M[5] * M[6] - M[3] * M[8]) / det, (M[0] * M[8] - M[2] * M[6]) / det, (M[2] * M[3] - M[0] * M[5]) / det,
    (M[3] * M[7] - M[4] * M[6]) / det, (M[1] * M[6] - M[0] * M[7]) / det, (M[0] * M[4] - M[1] * M[3]) / det];
  return { o, e, inv };
}

/** Lector de vóxeles con interpolación trilineal a partir de los cortes (con caché por corte k). */
function sampler(volume, getSlice) {
  const img = volume.imageData;
  const [nx, ny, nz] = img.getDimensions();
  const F = frameOf(img);
  const slices = new Array(nz).fill(null);
  const sl = (k) => { let s = slices[k]; if (s === null) { s = getSlice(k) || undefined; slices[k] = s; } return s; };
  const at = (i, j, k) => { const s = sl(k); return s ? s[j * nx + i] : -1000; };
  const idx = (w) => { const d = sub(w, F.o); return [F.inv[0] * d[0] + F.inv[1] * d[1] + F.inv[2] * d[2], F.inv[3] * d[0] + F.inv[4] * d[1] + F.inv[5] * d[2], F.inv[6] * d[0] + F.inv[7] * d[1] + F.inv[8] * d[2]]; };
  const value = (w) => {
    const p = idx(w);
    const i0 = Math.floor(p[0]), j0 = Math.floor(p[1]), k0 = Math.floor(p[2]);
    if (i0 < 0 || j0 < 0 || k0 < 0 || i0 >= nx - 1 || j0 >= ny - 1 || k0 >= nz - 1) return -1000;
    const fx = p[0] - i0, fy = p[1] - j0, fz = p[2] - k0;
    const c00 = at(i0, j0, k0) * (1 - fx) + at(i0 + 1, j0, k0) * fx;
    const c10 = at(i0, j0 + 1, k0) * (1 - fx) + at(i0 + 1, j0 + 1, k0) * fx;
    const c01 = at(i0, j0, k0 + 1) * (1 - fx) + at(i0 + 1, j0, k0 + 1) * fx;
    const c11 = at(i0, j0 + 1, k0 + 1) * (1 - fx) + at(i0 + 1, j0 + 1, k0 + 1) * fx;
    return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  };
  return { value, idx, at, dims: [nx, ny, nz], F, toWorld: (p) => addS(addS(addS(F.o, F.e[0], p[0]), F.e[1], p[1]), F.e[2], p[2]) };
}

/**
 * Corte remuestreado sobre un plano arbitrario. plane = { c (centro, mundo), normal, ux (eje X de la
 * imagen), up (qué dirección queda ARRIBA), half:[ancho/2, alto/2] mm, step (mm/píxel) }.
 * Devuelve { data: Float32Array (fila 0 = arriba), w, h, step }.
 */
export function samplePlane(smp, plane) {
  const n = norm(plane.normal);
  let x = sub(plane.ux, [n[0] * dot(plane.ux, n), n[1] * dot(plane.ux, n), n[2] * dot(plane.ux, n)]);
  x = norm(x);
  const y = norm(cross(n, x));
  const up = plane.up || SI;
  const flip = dot(y, up) > 0;                    // si la fila crece hacia «arriba», hay que darle la vuelta
  const step = plane.step, hw = plane.half[0], hh = plane.half[1];
  const w = Math.max(8, Math.round((2 * hw) / step)), h = Math.max(8, Math.round((2 * hh) / step));
  const data = new Float32Array(w * h);
  const o = addS(addS(plane.c, x, -hw), y, -hh);
  for (let j = 0; j < h; j++) {
    const row = (flip ? h - 1 - j : j) * w;
    const py = j * step;
    for (let i = 0; i < w; i++) {
      const px = i * step;
      data[row + i] = smp.value([o[0] + x[0] * px + y[0] * py, o[1] + x[1] * px + y[1] * py, o[2] + x[2] * px + y[2] * py]);
    }
  }
  // se devuelve también el MARCO del plano (origen y ejes del píxel) para poder ir de píxel a mundo:
  // hace falta para medir en mm y para arrastrar los polos sobre el corte axial.
  const oy = flip ? addS(o, y, 2 * hh - step) : o;
  return { data, w, h, step, o: oy, ex: x, ey: flip ? [-y[0], -y[1], -y[2]] : y };
}

/** Punto del MUNDO bajo un píxel (col, fila) de un corte remuestreado. */
export function planeToWorld(img, col, row) {
  return [img.o[0] + img.ex[0] * col * img.step + img.ey[0] * row * img.step,
    img.o[1] + img.ex[1] * col * img.step + img.ey[1] * row * img.step,
    img.o[2] + img.ex[2] * col * img.step + img.ey[2] * row * img.step];
}
/** Píxel (col, fila) de un corte donde cae un punto del MUNDO. */
export function worldToPlane(img, w) {
  const d = sub(w, img.o);
  return [dot(d, img.ex) / img.step, dot(d, img.ey) / img.step];
}

/**
 * Refina la marca del usuario hasta la cabeza del cóndilo y devuelve sus polos.
 * seed = [x,y,z] mundo (clic), thr = umbral de hueso. Devuelve { med, lat, center, ml, ap, si, n } | null.
 */
export function refineCondyle(smp, seed, thr, midX = 0) {
  const R = 13;                                   // radio de búsqueda alrededor del clic (mm)
  const pts = [];
  const st = 0.7;                                 // paso de barrido (mm)
  for (let dz = -R; dz <= R; dz += st) {
    for (let dy = -R; dy <= R; dy += st) {
      for (let dx = -R; dx <= R; dx += st) {
        if (dx * dx + dy * dy + dz * dz > R * R) continue;
        const w = [seed[0] + dx, seed[1] + dy, seed[2] + dz];
        if (smp.value(w) >= thr) pts.push(w);
      }
    }
  }
  if (pts.length < 40) return null;
  // como en VOXEL (`derive_condyle_poles`): parte ALTA (cabeza, no cuello) y tercio POSTERIOR (fuera la
  // apófisis coronoides, que queda por delante); después, recorte a 10 mm del ápice.
  const pick = (list, key, frac, keepHigh) => {
    const v = list.map(key).sort((a, b) => a - b);
    const q = v[Math.min(v.length - 1, Math.floor(frac * (v.length - 1)))];
    const out = list.filter((p) => (keepHigh ? key(p) >= q : key(p) <= q));
    return out.length >= 30 ? out : list;
  };
  let use = pick(pts, (p) => p[2], 0.45, true);          // 55 % más superior
  use = pick(use, (p) => p[1], 0.30, true);              // 70 % más posterior (LPS: +Y = posterior)
  let apex = use[0];
  for (const p of use) if (p[2] > apex[2]) apex = p;
  const head = use.filter((p) => Math.hypot(p[0] - apex[0], p[1] - apex[1], p[2] - apex[2]) <= 10);
  if (head.length >= 30) use = head;
  // eje MEDIO-LATERAL: dirección de máxima extensión en el plano axial (PCA 2×2 de x, y)
  let cx = 0, cy = 0;
  for (const p of use) { cx += p[0]; cy += p[1]; }
  cx /= use.length; cy /= use.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of use) { const a = p[0] - cx, b = p[1] - cy; sxx += a * a; sxy += a * b; syy += b * b; }
  const tr = sxx + syy, dt = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - dt));
  let ml = Math.abs(sxy) > 1e-9 ? norm([l1 - syy, sxy, 0]) : [sxx >= syy ? 1 : 0, sxx >= syy ? 0 : 1, 0];
  if (ml[0] < 0) ml = [-ml[0], -ml[1], 0];              // que apunte hacia la IZQUIERDA del paciente (+X)
  // el eje del cóndilo nunca se aleja mucho de la horizontal medio-lateral: si el ajuste se va (ruido,
  // coronoides, hueso del temporal), se limita a 45° respecto al eje X
  const ang = Math.atan2(ml[1], ml[0]);
  const lim = Math.PI / 4;
  if (Math.abs(ang) > lim) ml = [Math.cos(Math.sign(ang) * lim), Math.sin(Math.sign(ang) * lim), 0];
  // extremos a lo largo de ese eje: media de los 3 más extremos de cada lado (robusto al ruido)
  const proj = use.map((p) => (p[0] - cx) * ml[0] + (p[1] - cy) * ml[1]);
  const order = use.map((_, i) => i).sort((a, b) => proj[a] - proj[b]);
  const mean = (list) => { const s = [0, 0, 0]; for (const i of list) { s[0] += use[i][0]; s[1] += use[i][1]; s[2] += use[i][2]; } return s.map((v) => v / list.length); };
  const k = Math.max(1, Math.min(3, order.length));
  const pA = mean(order.slice(0, k)), pB = mean(order.slice(-k));
  // MEDIAL = el polo más cerca de la LÍNEA MEDIA del paciente; LATERAL = el otro
  const [med, lat] = Math.abs(pA[0] - midX) <= Math.abs(pB[0] - midX) ? [pA, pB] : [pB, pA];
  const first = polesFrom(med, lat, use.length, apex, midX);
  // v0.7.17: esos polos salen de la parte ALTA de la cabeza (cerca del ápice), que es estrecha, y a menudo
  // caían fuera del hueso al proyectarlos. Los polos de verdad son los extremos medial y lateral de la
  // sección axial MÁS ANCHA de la cabeza: se busca ese nivel y se toman los extremos del contorno del hueso.
  const wide = polesAtWidest(smp, first, thr, midX);
  if (!wide) return first;
  // solo se acepta si es COHERENTE con la primera estimación: al menos tan ancho (la sección más ancha no
  // puede ser más estrecha que la parte alta) y con el eje en una dirección parecida. Si no, la mancha era
  // otra cosa (cuello, coronoides, temporal) y se conservan los polos de siempre.
  const w0 = Math.hypot(lat[0] - med[0], lat[1] - med[1]), w1 = Math.hypot(wide.lat[0] - wide.med[0], wide.lat[1] - wide.med[1]);
  const d0 = norm([lat[0] - med[0], lat[1] - med[1], 0]), d1 = norm([wide.lat[0] - wide.med[0], wide.lat[1] - wide.med[1], 0]);
  // v0.8.3: la anchura medio-lateral de una cabeza adulta va de 13 a 25 mm; fuera de eso (o con el eje a más
  // de 60° del primero: la mancha era otra cosa) se conservan los polos de siempre
  if (w1 < Math.min(11, 0.8 * w0) || w1 > 27 || Math.abs(dot(d0, d1)) < Math.cos((60 * Math.PI) / 180)) return first;
  return polesFrom(wide.med, wide.lat, use.length, apex, midX);
}

/**
 * Polos medial y lateral de la CABEZA del cóndilo en 3D (v0.8.3, como `derive_condyle_poles` de VOXEL pero
 * sobre el CBCT): la huella de la cabeza es la mancha aislada de hueso de la sección axial más ancha
 * (`bestAxialOffset`); sobre cada columna de esa huella se sube desde 4 mm por debajo de ese nivel hasta el
 * TECHO del cóndilo, que es donde aparece el ESPACIO ARTICULAR (un hueco ≥ 1,2 mm sin hueso) — así el temporal
 * (fosa, eminencia) queda fuera aunque esté a 2 mm. De todos esos vóxeles de la cabeza, el polo MEDIAL es el
 * más medial y el LATERAL el más lateral (media de los 3 más extremos): la definición anatómica, y no los
 * extremos del eje de una elipse (PCA), que se torcían hacia anterior-lateral / posterior-medial.
 * Devuelve { med, lat, off } o null si no hay mancha.
 */
export function polesAtWidest(smp, pole, thr, midX = 0) {
  const off = bestAxialOffset(smp, pole, thr);
  const st = 0.3, half = 18;
  const level = addS(pole.center, SI, off);
  const img = samplePlane(smp, { c: level, normal: SI, ux: LEFT, up: ANT, half: [half, half], step: st });
  const pix = isolatedBlob(img, thr, 7 / st, true);
  if (!pix || pix.length < 40) return null;
  const w = img.w, h = img.h;
  // huella dilatada 2 px (0,6 mm): la cortical más externa a veces queda justo fuera de la mancha
  const mask = new Uint8Array(w * h);
  for (const i of pix) { const x = i % w, y = (i - x) / w; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) mask[yy * w + xx] = 1; } }
  // subir columna a columna hasta el espacio articular
  const zStep = 0.35, zLo = -3, zHi = 6, gapMm = 1.0;      // la cúpula sube 4-7 mm sobre la sección más ancha
  const nz = Math.round((zHi - zLo) / zStep) + 1;
  const levels = Array.from({ length: nz }, () => []);      // vóxeles de hueso de la cabeza por nivel
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!mask[j * w + i]) continue;
      const base = planeToWorld(img, i, j);
      let gap = 0, seen = false;
      for (let q = 0; q < nz; q++) {
        const dz = zLo + q * zStep, p = [base[0], base[1], base[2] + dz];
        if (smp.value(p) >= thr) { levels[q].push(p); seen = true; gap = 0; }
        else if (seen && dz > 0) { gap += zStep; if (gap >= gapMm) break; }   // techo del cóndilo: espacio articular
      }
    }
  }
  // el nivel en que la cabeza es MÁS ANCHA de medial a lateral; los polos son sus extremos en X (media de los 3
  // más extremos de cada lado), los dos a la misma altura, que es como se ven en el corte axial del diálogo
  let best = null;
  for (let q = 0; q < nz; q++) {
    const pts = levels[q]; if (pts.length < 20) continue;
    const order = pts.map((_, i) => i).sort((a, b) => pts[a][0] - pts[b][0]);
    const k = Math.min(3, order.length);
    const mean = (list) => { const s = [0, 0, 0]; for (const i of list) { s[0] += pts[i][0]; s[1] += pts[i][1]; s[2] += pts[i][2]; } return s.map((v) => v / list.length); };
    const pA = mean(order.slice(0, k)), pB = mean(order.slice(-k));
    const width = Math.abs(pB[0] - pA[0]);
    if (!best || width > best.width) best = { pA, pB, width, q };
  }
  if (!best) return null;
  const [med, lat] = Math.abs(best.pA[0] - midX) <= Math.abs(best.pB[0] - midX) ? [best.pA, best.pB] : [best.pB, best.pA];
  return { med, lat, off: off + zLo + best.q * zStep };
}

/**
 * Marco del cóndilo a partir de sus dos POLOS (medial y lateral, mundo). Se usa tanto al detectarlo
 * automáticamente como cuando el usuario los mueve a mano sobre el corte axial.
 */
export function polesFrom(med, lat, n = 0, apex = null, midX = 0) {
  // MEDIAL = el más cercano a la LÍNEA MEDIA del paciente. Si vienen al revés se intercambian: así los
  // rótulos del diálogo de polos nunca salen cambiados (v0.7.5).
  // OJO (v0.7.6): la línea media NO es x = 0. Muchos CBCT tienen el origen en una esquina, así que el
  // volumen cae entero en x > 0 y comparar |x| invertía los polos del lado derecho. `midX` viene del
  // punto medio entre los dos cóndilos marcados (o del centro del volumen).
  if (Math.abs(med[0] - midX) > Math.abs(lat[0] - midX)) { const q = med; med = lat; lat = q; }
  const center = [(med[0] + lat[0]) / 2, (med[1] + lat[1]) / 2, (med[2] + lat[2]) / 2];
  let ml = norm([lat[0] - med[0], lat[1] - med[1], 0]);   // horizontal (plano axial), de medial a lateral
  if (!Number.isFinite(ml[0])) ml = LEFT;
  const ap = norm(cross(SI, ml));
  return { med: med.slice(), lat: lat.slice(), center, ml, ap, si: SI, n, apex };
}

/**
 * Serie de cortes de un cóndilo: 5 sagitales + 1 coronal + 1 axial.
 * Devuelve [{ key, tag, img: {data,w,h,step}, plane }].
 */
export function condyleSeries(smp, pole, step = 0.2, shift = { sag: 0, cor: 0, axi: 0 }, aspect = 1.35) {
  const out = [];
  for (const s of TMJ_SAG_OFFS) {
    const off = s + (shift.sag || 0);
    out.push({ key: 'sag' + s, family: 'sag', base: s, off, img: condyleSlice(smp, pole, 'sag', off, step, aspect) });
  }
  out.push({ key: 'cor', family: 'cor', base: 0, off: shift.cor || 0, img: condyleSlice(smp, pole, 'cor', shift.cor || 0, step, aspect) });
  const ab = pole.axiBase || 0;
  out.push({ key: 'axi', family: 'axi', base: ab, off: ab + (shift.axi || 0), img: condyleSlice(smp, pole, 'axi', ab + (shift.axi || 0), step, aspect) });
  return out;
}

/**
 * Altura del corte AXIAL por defecto (mm respecto al centro de los polos, negativo = hacia abajo). El
 * centro de los polos cae en lo alto de la cabeza, donde el corte axial sale con la cabeza PEGADA a la
 * fosa y al temporal y no se distingue el cóndilo (había que buscarlo con la rueda, v0.7.8). Se busca,
 * de 1 mm por encima a 15 por debajo, el nivel en que el cóndilo sale como una MANCHA AISLADA de hueso
 * (un componente que no toca el borde de la ventana de 36 mm, con el centro a menos de 7 mm del centro
 * de los polos) y más grande: es la sección más ancha de la cabeza, ya separada de la fosa.
 */
export function bestAxialOffset(smp, pole, thr) {
  const half = 18, st = 0.5;
  let best = null;
  for (let off = 1; off >= -15; off -= 1) {
    const img = samplePlane(smp, { c: addS(pole.center, SI, off), normal: SI, ux: LEFT, up: ANT, half: [half, half], step: st });
    const s = isolatedBlob(img, thr, 7 / st);
    if (s > 0 && (!best || s > best.s)) best = { off, s };
  }
  return best ? best.off : -5;
}

/**
 * Tamaño (área de su caja, px²) del mayor componente 4-conexo de hueso que NO toca el borde y cuyo centroide
 * cae a menos de `rad` px del centro; 0 si no hay. Se mide la CAJA y no el área: la cabeza es un anillo
 * cortical con el interior esponjoso por debajo del umbral, y por área ganaba el cuello (macizo y más abajo).
 * Con `pixels = true` devuelve los índices de los píxeles de ese componente (null si no hay) (v0.7.17).
 */
function isolatedBlob(img, thr, rad, pixels = false) {
  const { w, h, data } = img;
  const lab = new Int32Array(w * h);
  const qx = new Int32Array(w * h);
  let best = 0, next = 0, bestPix = null;
  for (let s0 = 0; s0 < w * h; s0++) {
    if (lab[s0] || data[s0] < thr) continue;
    next++;
    let head = 0, tail = 0, area = 0, sx = 0, sy = 0, border = false, x0 = w, x1 = 0, y0 = h, y1 = 0;
    qx[tail++] = s0; lab[s0] = next;
    while (head < tail) {
      const i = qx[head++], x = i % w, y = (i - x) / w;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) if (j >= 0 && !lab[j] && data[j] >= thr) { lab[j] = next; qx[tail++] = j; }
    }
    if (border) continue;
    const dc = Math.hypot(sx / area - w / 2, sy / area - h / 2);
    const box = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (dc <= rad && box > best) { best = box; if (pixels) bestPix = Array.from(qx.subarray(0, tail)); }
  }
  return pixels ? bestPix : best;
}

/** Un solo corte del cóndilo: family = 'sag' (⊥ al eje medio-lateral) | 'cor' | 'axi'; off en mm. */
export function condyleSlice(smp, pole, family, off, step = 0.2, aspect = 1.35) {
  const c = pole.center, ml = pole.ml, ap = pole.ap, a = clampAspect(aspect);
  const half = (h) => [(h * a) / 2, h / 2];
  if (family === 'cor') return samplePlane(smp, { c: addS(c, ap, off), normal: ap, ux: LEFT, up: SI, half: half(H), step });
  if (family === 'axi') return samplePlane(smp, { c: addS(c, SI, off), normal: SI, ux: LEFT, up: ANT, half: half(AXH), step });
  // sagitales: cada cóndilo visto desde SU lado. El izquierdo lleva posterior a la derecha de la imagen
  // (ux = +Y); el derecho, al revés (v0.7.17, petición de Manuel: anterior a la derecha)
  return samplePlane(smp, { c: addS(c, ml, off), normal: ml, ux: pole.side === 'R' ? [0, -1, 0] : [0, 1, 0], up: SI, half: half(H), step });
}

/** Prepara el muestreador una vez para todo el panel. */
export function tmjSampler(volume, getSlice) { return sampler(volume, getSlice); }

/** Pinta un corte en un canvas con la ventana { lower, upper }. */
export function drawSlice(canvas, img, win, zoom = 1) {
  paintGray(canvas, img.w, img.h, img.data, win, zoom);
}

/**
 * Pinta un mapa de grises en un canvas con un factor de RESOLUCIÓN `zoom` (píxeles de canvas por píxel
 * de la imagen). Con zoom > 1 el canvas tiene más píxeles que la imagen: los rótulos y las medidas que se
 * dibujen encima salen NÍTIDOS en vez de ampliarse con la imagen (v0.7.6). El factor queda en
 * `canvas._imgZoom` para que quien dibuje encima convierta sus coordenadas.
 */
export function paintGray(canvas, w, h, src, win, zoom = 1) {
  const z = Math.max(1, Math.min(8, zoom || 1));
  const lo = win.lower, rng = Math.max(1, win.upper - win.lower);
  const im = new ImageData(w, h);
  const d = im.data;
  for (let i = 0; i < src.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(((src[i] - lo) / rng) * 255)));
    d[4 * i] = v; d[4 * i + 1] = v; d[4 * i + 2] = v; d[4 * i + 3] = 255;
  }
  canvas._imgZoom = z;
  if (z === 1) { canvas.width = w; canvas.height = h; canvas.getContext('2d').putImageData(im, 0, 0); return; }
  const off = paintGray.off || (paintGray.off = document.createElement('canvas'));
  off.width = w; off.height = h;
  off.getContext('2d').putImageData(im, 0, 0);
  canvas.width = Math.round(w * z); canvas.height = Math.round(h * z);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(off, 0, 0, canvas.width, canvas.height);
}
