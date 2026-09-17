// Tras `vite build`: sella con `?v=VERSION-hash` las referencias a los assets (index.html y, desde v0.8.5, también
// las que hay DENTRO de los chunks de docs/assets: `from "./index.js"`, `new URL("x.worker.js", import.meta.url)`…).
// Los nombres son fijos (sin hash) y sin el sello el navegador (y la caché de GitHub Pages) seguía enseñando la
// versión anterior hasta un Ctrl+F5. El hash del contenido hace que dos builds de la misma versión no compartan
// caché. IMPORTANTE: los chunks deben importar `./index.js?v=SELLO` (la MISMA URL con la que index.html carga la
// entrada); si importaran `./index.js` a secas, el navegador ejecutaría main.js DOS veces (la app se reiniciaba al
// pedir el PowerPoint, v0.8.5).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const v = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const h = crypto.createHash('sha1');
for (const f of ['docs/assets/index.js', 'docs/assets/index.css']) if (fs.existsSync(f)) h.update(fs.readFileSync(f));
const stamp = `${v}-${h.digest('hex').slice(0, 8)}`;
// index.html
const p = 'docs/index.html';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/(\.\/assets\/[^"'?]+)(\?v=[^"']*)?/g, `$1?v=${stamp}`);
fs.writeFileSync(p, s);
// chunks: referencias entre archivos .js / .css de docs/assets (no los .wasm: su nombre se compara con endsWith)
const dir = 'docs/assets';
const names = fs.readdirSync(dir).filter((n) => /\.(js|css)$/.test(n));
const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const re1 = new RegExp(`(["'\`])\\./(${esc})\\1`, 'g');                 // "./index.js"
const re2 = new RegExp(`URL\\((["'\`])(${esc})\\1,`, 'g');              // URL(`x.worker.js`, import.meta.url)
let touched = 0;
for (const n of names.filter((x) => x.endsWith('.js'))) {
  const f = path.join(dir, n);
  const src = fs.readFileSync(f, 'utf8');
  const out = src.replace(re1, (m, q, name) => `${q}./${name}?v=${stamp}${q}`).replace(re2, (m, q, name) => `URL(${q}${name}?v=${stamp}${q},`);
  if (out !== src) { fs.writeFileSync(f, out); touched++; }
}
console.log(`docs/index.html → assets con ?v=${stamp} (${touched} chunks sellados)`);
