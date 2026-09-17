// tresD DICOM — COMPARTIR CASO (.tresdz, v0.8.3). Un ZIP con:
//   · dicom/*.dcm  → el CBCT reescrito como DICOM CT sin comprimir (dcmjs), a resolución completa o REDUCIDA
//                    (vóxel × ∛4, trilineal → 1/4 del tamaño; v0.8.4) y ANONIMIZADO si se pide (sin nombre, ID,
//                    nacimiento, centro; se conservan sexo y fecha del estudio)
//   · escaneres/*.stl|ply → los escáneres en su posición actual (ya alineados; PLY si tienen color, v0.8.4)
//   · sesion.tresd  → la sesión (medidas, panorámica, polos, render…) con los escáneres marcados como colocados
// El visor lo abre como cualquier ZIP (`expandZips` acepta .tresdz): DICOM → sesión → escáneres colocados solos.
import dcmjs from 'dcmjs';
import { zip } from 'fflate';

const { DicomMetaDictionary, DicomDict } = dcmjs.data;
const CT_SOP = '1.2.840.10008.5.1.4.1.1.2';
const EXPLICIT_LE = '1.2.840.10008.1.2.1';
const IMPL_UID = '1.2.826.0.1.3680043.8.498.1';
const yieldUI = () => new Promise((r) => setTimeout(r, 0));

/** Marco del volumen: origen (mundo) y vector de un paso de índice en cada eje. */
function frameOf(img) {
  const o = img.indexToWorld([0, 0, 0], [0, 0, 0]);
  const e = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => { const w = img.indexToWorld(v, [0, 0, 0]); return [w[0] - o[0], w[1] - o[1], w[2] - o[2]]; });
  return { o, e };
}

/**
 * Escribe los cortes DICOM. opts = { volume, getSlice, series, reduce (bool), anonymize (bool), onProgress(0…1) }.
 * Devuelve { files: { 'dicom/0001.dcm': Uint8Array, … }, dims, spacing }.
 */
export async function volumeToDicom(opts) {
  const { volume, getSlice, series, reduce, anonymize, onProgress } = opts;
  const img = volume.imageData;
  const [nx, ny, nz] = img.getDimensions();
  const { o, e } = frameOf(img);
  // v0.8.4: la reducción es 1/4 del tamaño (vóxel × ∛4 ≈ 1,59 en los tres ejes, remuestreo trilineal); en v0.8.3
  // era 1/8 (bloques 2×2×2) y la panorámica perdía demasiado detalle
  const f = reduce ? Math.cbrt(4) : 1;
  const mx = Math.floor(nx / f), my = Math.floor(ny / f), mz = Math.floor(nz / f);
  const len = e.map((v) => Math.hypot(v[0], v[1], v[2]) || 1);
  const u = e.map((v, q) => v.map((x) => x / len[q]));
  const spacing = [len[0] * f, len[1] * f, len[2] * f];
  const h = (f - 1) / 2;                                    // centro del primer vóxel de salida, en índices de entrada
  const origin = [0, 1, 2].map((a) => o[a] + e[0][a] * h + e[1][a] * h + e[2][a] * h);
  const studyUid = DicomMetaDictionary.uid(), seriesUid = DicomMetaDictionary.uid();
  const forUid = (series && series.frameUid) || DicomMetaDictionary.uid();
  const date = series && series.date ? String(series.date).replace(/\D/g, '').slice(0, 8) : '';
  const files = {};
  // pesos del remuestreo en x e y (iguales para todos los cortes)
  const axis = (m, n) => { const i0 = new Int32Array(m), w = new Float32Array(m); for (let I = 0; I < m; I++) { const x = Math.min(n - 1, Math.max(0, (I + 0.5) * f - 0.5)); const a = Math.min(n - 2, Math.floor(x)); i0[I] = a; w[I] = x - a; } return { i0, w }; };
  const X = axis(mx, nx), Y = axis(my, ny);
  const cache = new Map();
  const slice = (k) => { if (!cache.has(k)) { if (cache.size > 3) cache.delete(cache.keys().next().value); cache.set(k, getSlice(k)); } return cache.get(k); };
  const acc = new Float32Array(mx * my);
  for (let K = 0; K < mz; K++) {
    if (K % 4 === 0) { if (onProgress) onProgress(K / mz); await yieldUI(); }
    let pix;
    if (f === 1) {
      const s = getSlice(K); if (!s) continue;
      pix = new Int16Array(mx * my);
      for (let i = 0; i < pix.length; i++) pix[i] = Math.max(-32768, Math.min(32767, Math.round(s[i])));
    } else {
      const z = Math.min(nz - 1, Math.max(0, (K + 0.5) * f - 0.5)), k0 = Math.min(nz - 2, Math.floor(z)), wz = z - k0;
      const sA = slice(k0), sB = slice(k0 + 1); if (!sA || !sB) continue;
      acc.fill(0);
      for (const [s, wk] of [[sA, 1 - wz], [sB, wz]]) {
        if (wk === 0) continue;
        for (let J = 0; J < my; J++) {
          const j0 = Y.i0[J], wy = Y.w[J], r0 = j0 * nx, r1 = (j0 + 1) * nx, orow = J * mx;
          for (let I = 0; I < mx; I++) {
            const i0 = X.i0[I], wx = X.w[I];
            const v = (s[r0 + i0] * (1 - wx) + s[r0 + i0 + 1] * wx) * (1 - wy) + (s[r1 + i0] * (1 - wx) + s[r1 + i0 + 1] * wx) * wy;
            acc[orow + I] += v * wk;
          }
        }
      }
      pix = new Int16Array(mx * my);
      for (let i = 0; i < pix.length; i++) pix[i] = Math.max(-32768, Math.min(32767, Math.round(acc[i])));
    }
    const ipp = [0, 1, 2].map((a) => origin[a] + e[2][a] * f * K);
    const sop = DicomMetaDictionary.uid();
    const ds = {
      SOPClassUID: CT_SOP, SOPInstanceUID: sop, StudyInstanceUID: studyUid, SeriesInstanceUID: seriesUid, FrameOfReferenceUID: forUid,
      Modality: 'CT', Manufacturer: 'tresD DICOM', SeriesDescription: (series && series.desc ? series.desc + ' ' : '') + (reduce ? '(tresD reducido)' : '(tresD)'),
      StudyDate: date, SeriesDate: date, InstanceNumber: K + 1, SeriesNumber: 1,
      PatientName: anonymize ? 'ANONIMO' : ((series && series.patient) || 'ANONIMO'),
      PatientID: anonymize ? 'tresD' : ((series && series.patientId) || ''),
      PatientBirthDate: anonymize ? '' : ((series && series.birth) || ''),
      PatientSex: (series && series.sex) || '',
      ImagePositionPatient: ipp, ImageOrientationPatient: [...u[0], ...u[1]],
      PixelSpacing: [spacing[1], spacing[0]], SliceThickness: spacing[2], SpacingBetweenSlices: spacing[2],
      Rows: my, Columns: mx, SamplesPerPixel: 1, PhotometricInterpretation: 'MONOCHROME2',
      BitsAllocated: 16, BitsStored: 16, HighBit: 15, PixelRepresentation: 1, RescaleIntercept: 0, RescaleSlope: 1,
      WindowCenter: 400, WindowWidth: 2000,
    };
    if (!anonymize && series && series.study) ds.StudyDescription = series.study;
    const meta = { FileMetaInformationVersion: new Uint8Array([0, 1]).buffer, MediaStorageSOPClassUID: CT_SOP, MediaStorageSOPInstanceUID: sop, TransferSyntaxUID: EXPLICIT_LE, ImplementationClassUID: IMPL_UID, ImplementationVersionName: 'tresD_DICOM' };
    const dict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
    dict.dict = DicomMetaDictionary.denaturalizeDataset(ds);
    dict.upsertTag('7FE00010', 'OW', [pix.buffer]);          // PixelData con VR explícita (si no, dcmjs avisa por consola)
    files[`dicom/${String(K + 1).padStart(4, '0')}.dcm`] = new Uint8Array(dict.write());
  }
  return { files, dims: [mx, my, mz], spacing };
}

/** Comprime en un ZIP (fflate, asíncrono). entries = { ruta: Uint8Array }. Devuelve Uint8Array. */
export function zipEntries(entries, level = 6) {
  const data = {};
  for (const [k, v] of Object.entries(entries)) data[k] = [v, { level }];
  return new Promise((resolve, reject) => zip(data, { level }, (err, out) => (err ? reject(err) : resolve(out))));
}
