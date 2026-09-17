// tresD DICOM — descompresión de RAR en un hilo aparte (v0.8.5). node-unrar-js (MIT) = el unrar oficial de RARLAB
// compilado a WebAssembly (licencia UnRAR: libre para descomprimir). WinRAR es lo que usan muchas clínicas para
// enviar un CBCT, así que un .rar entra igual que un ZIP. Los volúmenes partidos (.part1.rar) no se soportan.
import { createExtractorFromData } from 'node-unrar-js';
import wasmUrl from 'node-unrar-js/esm/js/unrar.wasm?url';

self.onmessage = async (e) => {
  try {
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
    const extractor = await createExtractorFromData({ data: e.data, wasmBinary });
    const out = {}; const bufs = [];
    for (const f of extractor.extract({}).files) {          // hay que recorrerlo entero (libera el objeto C++)
      if (!f.extraction || (f.fileHeader.flags && f.fileHeader.flags.directory)) continue;
      const own = f.extraction.slice();                     // copia: la vista apunta a la memoria del wasm (no transferible)
      out[String(f.fileHeader.name).replace(/\\/g, '/')] = own; bufs.push(own.buffer);
    }
    self.postMessage({ files: out }, bufs);
  } catch (err) { self.postMessage({ error: String((err && err.message) || err) }); }
};
