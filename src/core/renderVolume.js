// tresD DICOM — VOLUMEN DE RENDER (solo para el visor 3D), como `RENDER_MAX_DIM = 400` + `_resample_volume`
// de VOXEL: el ray-casting se hace sobre una copia SUAVIZADA y acotada a ≤ 400 vóxeles por eje (antialias:
// promedio de bloques f×f×f; si no hace falta reducir, media 3×3×3). Quita el grano del CBCT nativo (que a
// 0,2-0,3 mm se ve como ruido/arenilla en el render) y hace fluido el giro. Los cortes MPR, la medición, la
// alineación y la segmentación siguen usando el volumen COMPLETO. Coste: una copia de ≤ 64 M vóxeles (Int16).
import { volumeLoader, cache } from '@cornerstonejs/core';

const MAX_DIM = 400;
const yieldUI = () => new Promise((r) => setTimeout(r, 0));

/**
 * Crea (y cachea en Cornerstone) el volumen de render a partir del volumen cargado.
 * getSlice(k) → array del corte k. Devuelve { volumeId, f, dims, spacing } o null si no hace falta / falla.
 */
export async function buildRenderVolume(volume, getSlice, onProgress) {
  const img = volume.imageData;
  const [nx, ny, nz] = img.getDimensions();
  const f = Math.max(1, Math.ceil(Math.max(nx, ny, nz) / MAX_DIM));
  const mx = Math.floor(nx / f), my = Math.floor(ny / f), mz = Math.floor(nz / f);
  if (mx < 4 || my < 4 || mz < 4) return null;
  const out = new Float32Array(mx * my * mz);
  const acc = new Float32Array(mx * my);
  const inv = 1 / (f * f * f);
  for (let K = 0; K < mz; K++) {
    if (K % 8 === 0) { if (onProgress) onProgress(Math.round((100 * K) / mz)); await yieldUI(); }
    acc.fill(0);
    for (let dk = 0; dk < f; dk++) {
      const s = getSlice(K * f + dk); if (!s) continue;
      for (let J = 0; J < my; J++) {
        for (let dj = 0; dj < f; dj++) {
          const row = (J * f + dj) * nx, orow = J * mx;
          for (let I = 0; I < mx; I++) { let v = 0; const base = row + I * f; for (let di = 0; di < f; di++) v += s[base + di]; acc[orow + I] += v; }
        }
      }
    }
    out.set(acc.map((v) => v * inv), K * mx * my);
  }
  if (f === 1) meanFilter3(out, mx, my, mz);            // ya cabe: solo quitar el grano (≈ gaussiana σ 0,6 vóx)
  // geometría: mismo marco (ejes sacados de indexToWorld, sin depender del convenio interno de la matriz de
  // dirección); el vóxel reducido queda centrado en su bloque
  const o = img.indexToWorld([0, 0, 0], [0, 0, 0]);
  const ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => { const w = img.indexToWorld(v, [0, 0, 0]); return [w[0] - o[0], w[1] - o[1], w[2] - o[2]]; });
  const len = ax.map((e) => Math.hypot(...e) || 1);
  const u = ax.map((e, q) => e.map((v) => v / len[q]));
  const dir = [...u[0], ...u[1], ...u[2]];
  const h = (f - 1) / 2;
  const origin = [0, 1, 2].map((a) => o[a] + ax[0][a] * h + ax[1][a] * h + ax[2][a] * h);
  const spacing = [len[0] * f, len[1] * f, len[2] * f];
  const i16 = new Int16Array(out.length);
  for (let i = 0; i < out.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(out[i])));
  const src = volume.metadata || {};
  const metadata = {
    BitsAllocated: 16, BitsStored: 16, HighBit: 15, SamplesPerPixel: 1, PixelRepresentation: 1,
    PhotometricInterpretation: 'MONOCHROME2', Modality: src.Modality || 'CT',
    ImageOrientationPatient: [dir[0], dir[1], dir[2], dir[3], dir[4], dir[5]], PixelSpacing: [spacing[1], spacing[0]],
    FrameOfReferenceUID: src.FrameOfReferenceUID || ('1.2.826.0.1.3680043.8.498.' + Date.now()),
    Columns: mx, Rows: my, voiLut: [{ windowCenter: 400, windowWidth: 2000 }], VOILUTFunction: 'LINEAR',
  };
  const volumeId = 'tresdRender_' + Date.now();
  volumeLoader.createLocalVolume(volumeId, { metadata, dimensions: [mx, my, mz], spacing, origin, direction: [...dir], scalarData: i16 });
  return { volumeId, f, dims: [mx, my, mz], spacing };
}

export function removeRenderVolume(volumeId) {
  if (!volumeId) return;
  try { cache.removeVolumeLoadObject(volumeId); } catch (e) { /* nada */ }
}

/** Media 3×3×3 separable, en el sitio (Float32Array con orden k, j, i). */
function meanFilter3(a, nx, ny, nz) {
  const tmp = new Float32Array(a.length);
  const pass = (src, dst, s1, n1, s2, n2, s3, n3) => {
    for (let c = 0; c < n1; c++) for (let b = 0; b < n2; b++) {
      const base = c * s1 + b * s2;
      for (let i = 0; i < n3; i++) {
        const i0 = i > 0 ? i - 1 : i, i1 = i < n3 - 1 ? i + 1 : i;
        dst[base + i * s3] = (src[base + i0 * s3] + src[base + i * s3] + src[base + i1 * s3]) / 3;
      }
    }
  };
  pass(a, tmp, nx * ny, nz, nx, ny, 1, nx);
  pass(tmp, a, nx * ny, nz, 1, nx, nx, ny);
  pass(a, tmp, nx, ny, 1, nx, nx * ny, nz);
  a.set(tmp);
}
