import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND' && e.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') throw e;
    for (const suf of ['.js', '/index.js']) {
      try { const r = await next(specifier + suf, context); return r; } catch (e2) { /* siguiente */ }
    }
    // paquete sin exports: resolver a mano dentro de node_modules
    const m = specifier.match(/^(@[^/]+\/[^/]+|[^./][^/]*)\/(.+)$/);
    if (m) {
      const base = new URL('../node_modules/' + m[1] + '/' + m[2], import.meta.url);
      for (const suf of ['.js', '/index.js']) { const p = fileURLToPath(base) + suf; if (fs.existsSync(p)) return { url: base.href + suf, shortCircuit: true }; }
    }
    throw e;
  }
}
