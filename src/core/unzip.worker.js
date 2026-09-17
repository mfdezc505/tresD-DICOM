// tresD DICOM — descompresión de ZIP en un hilo aparte (v0.8.5). `unzipSync` de fflate en un Worker propio: el
// `unzip` asíncrono de fflate lanza UN worker POR ARCHIVO del ZIP (cientos en un CBCT) y con un ZIP grande se
// quedaba sin memoria / colgaba la pestaña; aquí se descomprime todo en serie sin bloquear la interfaz.
import { unzipSync } from 'fflate';

self.onmessage = (e) => {
  try {
    const files = unzipSync(new Uint8Array(e.data));
    const out = {}; const bufs = new Set();
    for (const [name, v] of Object.entries(files)) {
      // cada archivo con su propio ArrayBuffer (los guardados «sin comprimir» son vistas del ZIP entero)
      const own = v.byteOffset === 0 && v.byteLength === v.buffer.byteLength ? v : v.slice();
      out[name] = own; bufs.add(own.buffer);
    }
    self.postMessage({ files: out }, [...bufs]);
  } catch (err) { self.postMessage({ error: String((err && err.message) || err) }); }
};
