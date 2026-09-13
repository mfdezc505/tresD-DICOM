// tresD DICOM — estadística de HU (pura, sin DOM ni vtk.js): percentiles, Otsu y umbrales automáticos.
// La usan presets.js (ventanas), segment.js (piel/hueso) y align.js (coronas): un solo sitio.

/** Percentil p (0..100) de una muestra ORDENADA. */
export function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];
}

/** Umbral de Otsu (separa dos poblaciones) sobre una muestra ORDENADA acotada a [a, b]. */
export function otsu(sorted, a, b, bins = 512) {
  const hist = new Float64Array(bins);
  const w = (b - a) / bins || 1;
  let n = 0;
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    if (v < a || v > b) continue;
    hist[Math.min(bins - 1, Math.floor((v - a) / w))]++; n++;
  }
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = bins / 2;
  for (let i = 0; i < bins; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = i; }
  }
  return a + (thr + 0.5) * w;
}

/**
 * Umbrales automáticos { soft, bone } sobre la muestra ORDENADA de HU (_auto_thresholds de VOXEL):
 * soft separa aire de cuerpo; bone separa tejido blando de hueso. Funcionan aunque el CBCT no esté
 * calibrado en HU (valores 0…4095, etc.): todo es relativo al histograma.
 */
export function autoThresholds(sorted) {
  const lo = pct(sorted, 0.5), hi = pct(sorted, 99.5);
  if (!(hi > lo)) return { soft: -300, bone: 300 };
  const tSoft = otsu(sorted, lo, hi, 256);
  let tBone = otsu(sorted, tSoft, hi, 256);
  if (!(tBone > tSoft)) tBone = tSoft + 400;
  return { soft: tSoft, bone: tBone };
}
