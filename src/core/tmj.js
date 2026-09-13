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
  return { data, w, h, step };
}

/**
 * Refina la marca del usuario hasta la cabeza del cóndilo y devuelve sus polos.
 * seed = [x,y,z] mundo (clic), thr = umbral de hueso. Devuelve { med, lat, center, ml, ap, si, n } | null.
 */
export function refineCondyle(smp, seed, thr) {
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
  // MEDIAL = el polo más cerca de la línea media (x = 0); LATERAL = el otro
  const [med, lat] = Math.abs(pA[0]) <= Math.abs(pB[0]) ? [pA, pB] : [pB, pA];
  const center = [(med[0] + lat[0]) / 2, (med[1] + lat[1]) / 2, (med[2] + lat[2]) / 2];
  ml = norm([lat[0] - med[0], lat[1] - med[1], 0]);      // horizontal (plano axial), de medial a lateral
  const ap = norm(cross(SI, ml));
  return { med, lat, center, ml, ap, si: SI, n: use.length, apex };
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
  out.push({ key: 'axi', family: 'axi', base: 0, off: shift.axi || 0, img: condyleSlice(smp, pole, 'axi', shift.axi || 0, step, aspect) });
  return out;
}

/** Un solo corte del cóndilo: family = 'sag' (⊥ al eje medio-lateral) | 'cor' | 'axi'; off en mm. */
export function condyleSlice(smp, pole, family, off, step = 0.2, aspect = 1.35) {
  const c = pole.center, ml = pole.ml, ap = pole.ap, a = clampAspect(aspect);
  const half = (h) => [(h * a) / 2, h / 2];
  if (family === 'cor') return samplePlane(smp, { c: addS(c, ap, off), normal: ap, ux: LEFT, up: SI, half: half(H), step });
  if (family === 'axi') return samplePlane(smp, { c: addS(c, SI, off), normal: SI, ux: LEFT, up: ANT, half: half(AXH), step });
  return samplePlane(smp, { c: addS(c, ml, off), normal: ml, ux: [0, 1, 0], up: SI, half: half(H), step });
}

/** Prepara el muestreador una vez para todo el panel. */
export function tmjSampler(volume, getSlice) { return sampler(volume, getSlice); }

/** Pinta un corte en un canvas con la ventana { lower, upper }. */
export function drawSlice(canvas, img, win) {
  canvas.width = img.w; canvas.height = img.h;
  const g = canvas.getContext('2d');
  const im = g.createImageData(img.w, img.h);
  const lo = win.lower, rng = Math.max(1, win.upper - win.lower);
  const d = im.data, src = img.data;
  for (let i = 0; i < src.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(((src[i] - lo) / rng) * 255)));
    d[4 * i] = v; d[4 * i + 1] = v; d[4 * i + 2] = v; d[4 * i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
}
