// tresD DICOM — INGESTA de archivos: carpeta / archivos sueltos / ZIP / DICOMDIR.
// Todo ocurre en el navegador (nada se sube a ningún servidor).
//
// Equivalente a ceph_dicom.load_dicom + list_series de VOXEL:
//   1) recoger archivos (input de carpeta, arrastre recursivo, ZIP con fflate)
//   2) leer SOLO cabeceras (dicom-parser, hasta PixelData) para agrupar por
//      (SeriesInstanceUID, filas×columnas) y contar cortes; detectar multiframe.
//   3) si hay un DICOMDIR, usarlo para etiquetar/limitar las series.
import dicomParser from 'dicom-parser';
import { unzipSync } from 'fflate';

const HEADER_BYTES = 64 * 1024;          // primer intento: 64 KB (cabeceras CT normales < 10 KB)
const SKIP_EXT = /\.(zip|txt|pdf|jpe?g|png|xml|html?|ini|exe|dll|bmp|gif|json|csv|stl|ply|obj|md|doc|docx|xlsx|pptx|mp4|avi|mov|js|css)$/i;

/** Lee el árbol de un arrastre (soporta carpetas). Devuelve [{file, path}]. */
export async function collectFromDataTransfer(dt) {
  const out = [];
  const items = dt.items ? Array.from(dt.items) : [];
  const entries = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null));
  if (entries.some((e) => e)) {
    for (const e of entries) if (e) await walkEntry(e, '', out);
  } else {
    for (const f of Array.from(dt.files || [])) out.push({ file: f, path: f.name });
  }
  return out;
}

async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ file, path: prefix + entry.name });
  } else if (entry.isDirectory) {
    if (entry.name === '__MACOSX' || entry.name.startsWith('.')) return;
    const reader = entry.createReader();
    // readEntries devuelve por lotes de ~100: hay que repetir hasta que venga vacío
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const sub of batch) await walkEntry(sub, prefix + entry.name + '/', out);
    }
  }
}

/** Archivos de un <input type=file> (con o sin webkitdirectory). */
export function collectFromFileList(list) {
  return Array.from(list || []).map((f) => ({ file: f, path: f.webkitRelativePath || f.name }));
}

/**
 * Tipo de archivo comprimido por su FIRMA (v0.8.5): 'zip' (PK), 'rar', '7z', 'gz' o null. Así un ZIP con otra
 * extensión (o sin ella, o «.ZIP » con espacio) se reconoce igual, y un RAR / 7z se explica en vez de fallar.
 */
export async function sniffArchive(file) {
  try {
    const b = new Uint8Array(await file.slice(0, 6).arrayBuffer());
    if (b.length < 4) return null;
    if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7)) return 'zip';
    if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return 'rar';
    if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf) return '7z';
    if (b[0] === 0x1f && b[1] === 0x8b) return 'gz';
  } catch (e) { /* nada */ }
  return null;
}
const isZipName = (p) => /\.(zip|tresdz)$/i.test(String(p || '').trim());

/** ZIP (File) → { nombre: Uint8Array } en un Worker (v0.8.5); si el Worker no arranca, en el hilo principal. */
async function unzipFile(file) {
  const buf = await file.arrayBuffer();
  const viaWorker = () => new Promise((resolve, reject) => {
    let w = null;
    try { w = new Worker(new URL('./unzip.worker.js', import.meta.url), { type: 'module' }); } catch (e) { reject(e); return; }
    w.onmessage = (ev) => { w.terminate(); if (ev.data && ev.data.error) reject(new Error(ev.data.error)); else resolve(ev.data.files || {}); };
    w.onerror = (ev) => { w.terminate(); reject(new Error('worker: ' + ((ev && ev.message) || 'no disponible'))); };
    w.postMessage(buf, [buf]);          // el buffer pasa al worker (sin copia); si falla, se vuelve a leer el archivo
  });
  try { return await viaWorker(); } catch (e) {
    if (/Invalid|zip/i.test(String(e && e.message))) throw e;     // ZIP corrupto: no insistir
    console.warn('unzip en worker falló; en el hilo principal', e);
    return unzipSync(new Uint8Array(await file.arrayBuffer()));
  }
}

/** RAR (File) → { nombre: Uint8Array } en un Worker con el unrar oficial en WebAssembly (v0.8.5). */
function unrarFile(file) {
  return new Promise((resolve, reject) => {
    let w = null;
    try { w = new Worker(new URL('./unrar.worker.js', import.meta.url), { type: 'module' }); } catch (e) { reject(e); return; }
    w.onmessage = (ev) => { w.terminate(); if (ev.data && ev.data.error) reject(new Error('RAR: ' + ev.data.error)); else resolve(ev.data.files || {}); };
    w.onerror = (ev) => { w.terminate(); reject(new Error('RAR: ' + ((ev && ev.message) || 'no disponible'))); };
    file.arrayBuffer().then((buf) => w.postMessage(buf, [buf]), reject);
  });
}
const isRarName = (p) => /\.rar$/i.test(String(p || '').trim());

/**
 * Descomprime los .zip / .tresdz / .rar de la lista y sustituye cada archivo comprimido por su contenido. v0.8.5: en
 * un Worker (unzip.worker.js / unrar.worker.js), comprimido dentro de comprimido (hasta 2 niveles) y reconocimiento
 * por la firma cuando la extensión no es la esperada.
 */
export async function expandZips(entries, onStatus, depth = 0) {
  const out = [];
  let nested = false;
  for (const e of entries) {
    let kind = isZipName(e.path) ? 'zip' : (isRarName(e.path) ? 'rar' : null);
    // sin extensión conocida (o con otra): se mira la firma; un 7z / .gz se avisa (no se pueden abrir aquí)
    if (!kind && !/\.(dcm|ima|dic|dicom|stl|ply|obj|jpe?g|png|webp|bmp|tresd|json|txt|xml|html?|pdf)$/i.test(e.path) && e.file.size > 64) {
      kind = await sniffArchive(e.file);
      if (kind && kind !== 'zip' && kind !== 'rar') { const err = new Error(`ARCHIVE:${kind}:${e.path.split('/').pop()}`); err.archive = kind; throw err; }
    }
    if (!kind) { out.push(e); continue; }
    if (onStatus) onStatus(kind === 'rar' ? 'unrar' : 'unzip');
    const files = kind === 'rar' ? await unrarFile(e.file) : await unzipFile(e.file);
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('/') || name.includes('__MACOSX') || /(^|\/)\./.test(name) || !data.length) continue;
      const base = name.split('/').pop();
      if (isZipName(base) || isRarName(base)) nested = true;
      out.push({ file: new File([data], base), path: e.path.replace(/\.(zip|tresdz|rar)$/i, '') + '/' + name });
    }
  }
  return nested && depth < 2 ? expandZips(out, onStatus, depth + 1) : out;
}

function looksLikeDicomName(path) {
  const base = path.split('/').pop() || '';
  if (/\.(dcm|ima|dic|dicom)$/i.test(base)) return true;
  if (/^dicomdir$/i.test(base)) return true;
  if (SKIP_EXT.test(base)) return false;
  return true;                         // sin extensión (frecuente en exportaciones de CBCT): se comprueba la firma
}

async function hasDicmMagic(file) {
  try {
    const head = new Uint8Array(await file.slice(128, 132).arrayBuffer());
    return head.length === 4 && head[0] === 0x44 && head[1] === 0x49 && head[2] === 0x43 && head[3] === 0x4d;
  } catch (e) { return false; }
}

function str(ds, tag) { try { return (ds.string(tag) || '').trim(); } catch (e) { return ''; } }
function u16(ds, tag) { try { return ds.uint16(tag) || 0; } catch (e) { return 0; } }
function num(ds, tag, d = 0) { const v = parseFloat(str(ds, tag)); return Number.isFinite(v) ? v : d; }
function nums(ds, tag) { const s = str(ds, tag); if (!s) return null; const a = s.split('\\').map(parseFloat); return a.every(Number.isFinite) ? a : null; }

async function parseHeader(file) {
  // primero solo el principio del archivo; si dicom-parser se queda sin bytes, el archivo entero
  let bytes = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  try {
    return dicomParser.parseDicom(bytes, { untilTag: 'x7fe00010' });
  } catch (e) {
    if (file.size <= HEADER_BYTES) return null;
  }
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    return dicomParser.parseDicom(bytes, { untilTag: 'x7fe00010' });
  } catch (e) { return null; }
}

function orientationLabel(iop) {
  if (!iop || iop.length < 6) return '?';
  const r = iop.slice(0, 3), c = iop.slice(3, 6);
  const n = [r[1] * c[2] - r[2] * c[1], r[2] * c[0] - r[0] * c[2], r[0] * c[1] - r[1] * c[0]];
  const ax = n.map(Math.abs);
  const i = ax.indexOf(Math.max(...ax));
  return ['Sagital', 'Coronal', 'Axial'][i];
}

/** Lee el DICOMDIR: devuelve { series: Map<uid, {desc, refs:[path]}> } (rutas relativas normalizadas). */
async function parseDicomdir(entry) {
  try {
    const bytes = new Uint8Array(await entry.file.arrayBuffer());
    const ds = dicomParser.parseDicom(bytes);
    const seq = ds.elements.x00041220;
    if (!seq || !seq.items) return null;
    const series = new Map();
    let cur = null;
    let patient = '', study = '';
    for (const it of seq.items) {
      const d = it.dataSet;
      const type = str(d, 'x00041430').toUpperCase();
      if (type === 'PATIENT') patient = str(d, 'x00100010');
      else if (type === 'STUDY') study = str(d, 'x00081030');
      else if (type === 'SERIES') {
        const uid = str(d, 'x0020000e') || ('serie' + series.size);
        cur = series.get(uid) || { uid, desc: str(d, 'x0008103e'), modality: str(d, 'x00080060'), patient, study, refs: [] };
        series.set(uid, cur);
      } else if (type === 'IMAGE' && cur) {
        const ref = str(d, 'x00041500');
        if (ref) cur.refs.push(ref.split('\\').join('/').toLowerCase());
      }
    }
    return { series, dir: entry.path.split('/').slice(0, -1).join('/').toLowerCase() };
  } catch (e) {
    console.warn('DICOMDIR ilegible', e);
    return null;
  }
}

/**
 * Explora las entradas y devuelve las SERIES encontradas, ordenadas por nº de cortes (mayor primero).
 * onProgress(i, n) informa del avance de la lectura de cabeceras.
 */
export async function scanDicom(entries, onProgress) {
  const dicomdirEntry = entries.find((e) => /(^|\/)dicomdir$/i.test(e.path));
  const dicomdir = dicomdirEntry ? await parseDicomdir(dicomdirEntry) : null;

  // candidatos: si hay DICOMDIR, los archivos que referencia; si no, todo lo que parezca DICOM
  let candidates = entries.filter((e) => e !== dicomdirEntry && looksLikeDicomName(e.path));
  const refOf = new Map();                       // path normalizado -> uid de serie del DICOMDIR
  if (dicomdir) {
    for (const s of dicomdir.series.values()) for (const r of s.refs) refOf.set(r, s.uid);
    const byRef = candidates.filter((e) => {
      const p = e.path.toLowerCase();
      for (const r of refOf.keys()) if (p.endsWith(r)) return true;
      return false;
    });
    if (byRef.length >= 2) candidates = byRef;    // si las rutas no casan, se explora todo (respaldo)
  }

  const groups = new Map();
  let done = 0;
  const n = candidates.length;
  // cabeceras en paralelo por lotes (I/O de disco; 8 a la vez como en VOXEL)
  const BATCH = 8;
  for (let i = 0; i < n; i += BATCH) {
    const slice = candidates.slice(i, i + BATCH);
    await Promise.all(slice.map(async (e) => {
      done++;
      if (onProgress && (done % 10 === 0 || done === n)) onProgress(done, n);
      const isDcmExt = /\.(dcm|ima|dic|dicom)$/i.test(e.path);
      if (!isDcmExt && !(await hasDicmMagic(e.file))) return;
      const ds = await parseHeader(e.file);
      if (!ds) return;
      const rows = u16(ds, 'x00280010'), cols = u16(ds, 'x00280011');   // US: binarios, no texto
      if (!rows || !cols) return;                  // sin imagen (p. ej. informes, presentaciones)
      const frames = Math.max(1, num(ds, 'x00280008', 1));
      const uid = str(ds, 'x0020000e') || 'sin-uid';
      const key = uid + '|' + rows + 'x' + cols;
      let g = groups.get(key);
      if (!g) {
        g = {
          key, uid, rows, cols, frames,
          desc: str(ds, 'x0008103e') || str(ds, 'x00081030') || '',
          modality: str(ds, 'x00080060'), patient: str(ds, 'x00100010').replace(/\^/g, ' ').trim(),
          patientId: str(ds, 'x00100020'), birth: str(ds, 'x00100030'), sex: str(ds, 'x00100040'),
          study: str(ds, 'x00081030'), date: str(ds, 'x00080020') || str(ds, 'x00080021'),
          manufacturer: [str(ds, 'x00080070'), str(ds, 'x00081090')].filter(Boolean).join(' '),
          spacing: nums(ds, 'x00280030'), thickness: num(ds, 'x00180050', 0), between: num(ds, 'x00180088', 0),
          iop: nums(ds, 'x00200037'), kvp: str(ds, 'x00180060'), frameUid: str(ds, 'x00200052'),
          wc: num(ds, 'x00281050', NaN), ww: num(ds, 'x00281051', NaN),
          transfer: (ds.string('x00020010') || '').trim(),
          files: [],
        };
        groups.set(key, g);
      }
      g.files.push({ file: e.file, path: e.path, ipp: nums(ds, 'x00200032'), inst: num(ds, 'x00200013', 0), frames });
    }));
  }

  const series = [];
  for (const g of groups.values()) {
    const multiframe = g.files.some((f) => f.frames > 1);
    const count = multiframe ? g.files.reduce((a, f) => a + f.frames, 0) : g.files.length;
    if (count < 2) continue;
    // orden por posición a lo largo de la normal (como VOXEL); respaldo: InstanceNumber
    if (!multiframe) {
      const iop = g.iop;
      let normal = null;
      if (iop && iop.length === 6) {
        const r = iop.slice(0, 3), c = iop.slice(3, 6);
        normal = [r[1] * c[2] - r[2] * c[1], r[2] * c[0] - r[0] * c[2], r[0] * c[1] - r[1] * c[0]];
      }
      const hasPos = normal && g.files.every((f) => f.ipp && f.ipp.length === 3);
      const keyOf = (f) => (hasPos ? f.ipp[0] * normal[0] + f.ipp[1] * normal[1] + f.ipp[2] * normal[2] : f.inst);
      g.files.sort((a, b) => keyOf(a) - keyOf(b));
      g.normal = normal;
      g.rot = hasPos ? rotationByInstance(g.files) : null;
      // Separación entre cortes: MEDIANA de los saltos entre cortes consecutivos. Antes se usaba solo
      // |IPP1 − IPP0|, y basta un corte repetido o un salto raro AL PRINCIPIO de la serie para que salga
      // mal y el volumen se vea estirado o aplastado. También se guarda el salto MEDIO (extremo a extremo),
      // que es lo que deduce Cornerstone: si los dos no coinciden, la serie tiene huecos o cortes repetidos.
      const pos = g.files.map((f) => (f.ipp && normal ? keyOf(f) : null));
      if (pos.length > 1 && pos[0] != null && pos[pos.length - 1] != null) {
        const d = [];
        for (let i = 1; i < pos.length; i++) d.push(Math.abs(pos[i] - pos[i - 1]));
        const sorted = d.slice().sort((a, b) => a - b);
        const med = sorted[Math.floor(sorted.length / 2)];
        g.dz = med > 1e-4 ? med : 0;
        g.dzSpan = Math.abs(pos[pos.length - 1] - pos[0]) / (pos.length - 1);
        g.dzMin = sorted[0]; g.dzMax = sorted[sorted.length - 1];
        g.dupes = d.filter((v) => v < 1e-4).length;                     // cortes en la MISMA posición
        g.gaps = g.dz ? d.filter((v) => v > 1.5 * g.dz).length : 0;     // huecos (cortes que faltan)
        // ¿es fiable la mediana? Sí si la MAYORÍA de los saltos coinciden con ella (serie regular con algún
        // corte repetido o algún hueco). Si los saltos son un caos, no se toca nada.
        g.dzOk = !!g.dz && d.filter((v) => Math.abs(v - g.dz) <= 0.1 * g.dz).length >= 0.6 * d.length;
      }
      if (!g.dz) g.dz = g.between || g.thickness || 1;
    } else {
      g.dz = g.between || g.thickness || 1;
    }
    g.multiframe = multiframe;
    g.count = count;
    g.orientation = orientationLabel(g.iop);
    g.label = (g.desc || (dicomdir && dicomdir.series.get(g.uid)?.desc) || g.modality || 'serie')
      + ' [' + g.orientation + ', ' + count + ']';
    series.push(g);
  }
  series.sort((a, b) => b.count - a.count);
  return { series, dicomdir };
}

/**
 * ¿La serie, ya ordenada POR POSICIÓN, tiene un BLOQUE de cortes fuera de sitio?
 *
 * Fallo real (CBCT de Manuel, 13-09-2026): la parte alta del cráneo sale recortada y aparece como un
 * trozo suelto POR DEBAJO del resto. Pasa cuando un bloque contiguo de cortes trae la posición
 * (ImagePositionPatient) desplazada justo un recorrido entero: las posiciones siguen siendo una
 * escalera perfecta —no hay nada raro que mirar en las cabeceras— pero el bloque "da la vuelta" y se
 * coloca al principio del volumen.
 *
 * Quien delata el orden verdadero es el NÚMERO DE INSTANCIA (orden de adquisición). Si al ordenar por
 * posición los números de instancia salen crecientes (o decrecientes) SALVO en un único punto, y girando
 * la serie por ese punto vuelven a ser monótonos, es que ese punto es la costura. Se devuelve su índice.
 * Cualquier otra cosa (números repetidos, ausentes o desordenados de verdad) devuelve null: no se toca.
 *
 * OJO: esto es solo la SOSPECHA. Antes de mover nada se confirma mirando los píxeles de los cortes de la
 * costura (viewer.confirmRotation), porque hay exportadores que numeran las instancias a su aire.
 */
export function rotationByInstance(files) {
  const n = files.length;
  if (n < 20) return null;
  const inst = files.map((f) => f.inst);
  if (inst.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  if (new Set(inst).size !== n) return null;                  // repetidos: no es un contador fiable
  // sentido general (la serie puede venir numerada al revés que la posición)
  let up = 0, down = 0;
  for (let i = 1; i < n; i++) (inst[i] > inst[i - 1] ? up++ : down++);
  const asc = up >= down;
  const breaks = [];
  for (let i = 1; i < n; i++) if (asc ? inst[i] < inst[i - 1] : inst[i] > inst[i - 1]) breaks.push(i);
  if (breaks.length !== 1) return null;                       // 0 = serie sana; 2+ = desorden real
  const k = breaks[0];                                        // costura: entre k-1 y k
  if (k < 3 || k > n - 3) return null;                        // bloques ridículos: no compensa
  // al girar, ¿queda monótona de verdad? (incluida la nueva unión, que antes era el extremo)
  const rot = inst.slice(k).concat(inst.slice(0, k));
  for (let i = 1; i < n; i++) if (asc ? rot[i] < rot[i - 1] : rot[i] > rot[i - 1]) return null;
  return k;
}

/** Fecha DICOM AAAAMMDD -> DD/MM/AAAA */
export function fmtDate(s) {
  s = (s || '').trim();
  return s.length >= 8 && /^\d{8}/.test(s) ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : s;
}
