// tresD DICOM — VOLÚMENES GRANDES (p. ej. 1003×1003×874 = 880 M vóxeles, 1,8 GB): no caben en la
// memoria gráfica ni conviene tener los 874 archivos + los 874 cortes decodificados en RAM.
// Equivalente al RENDER_MAX_DIM de VOXEL: se construye un volumen REDUCIDO por un factor entero f
// (promedio de bloques f×f×f, con antialias implícito) leyendo los archivos UNO A UNO y liberando
// cada uno al terminar. El resultado es un volumen local de Cornerstone (createLocalVolume) que
// sirve igual para el render 3D y para los cortes MPR.
import dicomParser from 'dicom-parser';
import { volumeLoader, imageLoader, cache } from '@cornerstonejs/core';
import { wadouri, prefetchPart10Instance } from '@cornerstonejs/dicom-image-loader';
import { metaData as csMeta, Enums as MetaEnums } from '@cornerstonejs/metadata';

const UNCOMPRESSED = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1', '1.2.840.10008.1.2.2']);

/** Presupuesto de vóxeles para render + MPR en la GPU. */
export function voxelBudget() {
  const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 8;   // GB (Chrome)
  return mem >= 16 ? 260e6 : 170e6;
}

/** Factor de reducción entero necesario (1 = sin reducir). */
export function decimationFactor(series) {
  const vox = series.rows * series.cols * series.count;
  const f = Math.ceil(Math.cbrt(vox / voxelBudget()));
  return Math.max(1, f);
}

function str(ds, tag) { try { return (ds.string(tag) || '').trim(); } catch (e) { return ''; } }
function num(ds, tag, d) { const v = parseFloat(str(ds, tag)); return Number.isFinite(v) ? v : d; }

/** Píxeles de un archivo: ruta rápida sin comprimir (vista directa) o decodificación por Cornerstone. */
async function readPixels(entry, buf, rows, cols) {
  const bytes = new Uint8Array(buf);
  let ds = null;
  try { ds = dicomParser.parseDicom(bytes); } catch (e) { ds = null; }
  const slope = ds ? num(ds, 'x00281053', 1) : 1;
  const inter = ds ? num(ds, 'x00281052', 0) : 0;
  if (ds) {
    const ts = str(ds, 'x00020010');
    const pe = ds.elements.x7fe00010;
    const bits = ds.uint16('x00280100') || 16;
    const frames = num(ds, 'x00280008', 1);
    const signed = (ds.uint16('x00280103') || 0) === 1;
    if (pe && UNCOMPRESSED.has(ts) && bits === 16 && frames <= 1 && ts !== '1.2.840.10008.1.2.2') {
      const n = rows * cols;
      let off = pe.dataOffset;
      let arr;
      if (off % 2 === 0) arr = signed ? new Int16Array(buf, off, n) : new Uint16Array(buf, off, n);
      else { const c = bytes.slice(off, off + 2 * n); arr = signed ? new Int16Array(c.buffer) : new Uint16Array(c.buffer); }
      return { px: arr, slope, inter };
    }
  }
  // comprimido (JPEG lossless, J2K, RLE...): que lo decodifique Cornerstone y luego se libera todo
  const id = wadouri.fileManager.add(entry.file);
  await prefetchPart10Instance(id, buf);
  const image = await imageLoader.loadAndCacheImage(id);
  const px = image.getPixelData();
  const out = { px, slope: image.slope ?? slope, inter: image.intercept ?? inter };
  try { cache.removeImageLoadObject(id, { force: true }); } catch (e) { /* nada */ }
  try { csMeta.clearQuery(MetaEnums.MetadataModules.NATURALIZED, id); } catch (e) { /* nada */ }
  try { wadouri.fileManager.remove(parseInt(wadouri.parseImageId(id).url, 10)); } catch (e) { /* nada */ }
  return out;
}

/**
 * Construye el volumen reducido por `f` y lo deja en el caché de Cornerstone. Devuelve {volumeId, info}.
 * onProgress(0..100).
 */
export async function buildDecimatedVolume(series, f, onProgress) {
  const files = series.files;
  const rows = series.rows, cols = series.cols, nz = files.length;
  const nxo = Math.floor(cols / f), nyo = Math.floor(rows / f), nzo = Math.ceil(nz / f);
  const sliceLen = nxo * nyo;
  const out = new Int16Array(sliceLen * nzo);
  const acc = new Float32Array(sliceLen);
  let inGroup = 0, kOut = 0;
  const flush = () => {
    const div = inGroup * f * f;
    const base = kOut * sliceLen;
    for (let i = 0; i < sliceLen; i++) {
      const v = Math.round(acc[i] / div);
      out[base + i] = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
    }
    acc.fill(0); inGroup = 0; kOut++;
  };
  for (let k = 0; k < nz; k++) {
    const entry = files[k];
    const buf = await entry.file.arrayBuffer();
    const { px, slope, inter } = await readPixels(entry, buf, rows, cols);
    if (px && px.length >= rows * cols) {
      // suma de bloques f×f (píxel [y][x] -> acc[yo*nxo + xo]); escala HU aplicada al final del bloque
      for (let yo = 0; yo < nyo; yo++) {
        const y0 = yo * f;
        for (let xo = 0; xo < nxo; xo++) {
          const x0 = xo * f;
          let s = 0;
          for (let dy = 0; dy < f; dy++) {
            const row = (y0 + dy) * cols + x0;
            for (let dx = 0; dx < f; dx++) s += px[row + dx];
          }
          acc[yo * nxo + xo] += s * slope + inter * f * f;
        }
      }
    }
    inGroup++;
    if (inGroup === f) flush();
    if (onProgress && (k % 5 === 0 || k === nz - 1)) onProgress(Math.round((100 * (k + 1)) / nz));
    if (k % 20 === 0) await new Promise((r) => setTimeout(r, 0));   // deja respirar a la interfaz
  }
  if (inGroup > 0) flush();

  // geometría: ejes DICOM (fila = columnas i, columna = filas j, normal = cortes k)
  const iop = series.iop || [1, 0, 0, 0, 1, 0];
  const r = iop.slice(0, 3), c = iop.slice(3, 6);
  const n = [r[1] * c[2] - r[2] * c[1], r[2] * c[0] - r[0] * c[2], r[0] * c[1] - r[1] * c[0]];
  const sx = (series.spacing ? series.spacing[1] : 1), sy = (series.spacing ? series.spacing[0] : 1), sz = series.dz || 1;
  const ipp0 = files[0].ipp || [0, 0, 0];
  const h = (f - 1) / 2;                       // el vóxel reducido queda centrado en su bloque
  const origin = [0, 1, 2].map((a) => ipp0[a] + r[a] * sx * h + c[a] * sy * h + n[a] * sz * h);
  const spacing = [sx * f, sy * f, sz * f];
  const metadata = {
    BitsAllocated: 16, BitsStored: 16, HighBit: 15, SamplesPerPixel: 1, PixelRepresentation: 1,
    PhotometricInterpretation: 'MONOCHROME2', Modality: series.modality || 'CT',
    ImageOrientationPatient: iop, PixelSpacing: [spacing[1], spacing[0]],
    FrameOfReferenceUID: series.frameUid || ('1.2.826.0.1.3680043.8.498.' + Date.now()),
    Columns: nxo, Rows: nyo, voiLut: [{ windowCenter: 400, windowWidth: 2000 }], VOILUTFunction: 'LINEAR',
  };
  // SIN dos puntos: si el id de los cortes locales lleva ':' Cornerstone intenta cargarlos con un image loader (no existe)
  const volumeId = 'tresdLocal_' + Date.now();
  volumeLoader.createLocalVolume(volumeId, {
    metadata, dimensions: [nxo, nyo, nzo], spacing, origin, direction: [...r, ...c, ...n], scalarData: out,
  });
  return { volumeId, dims: [nxo, nyo, nzo], spacing };
}
