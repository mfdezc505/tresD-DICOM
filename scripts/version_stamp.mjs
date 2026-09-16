// Tras `vite build`: añade `?v=VERSION` a los assets de docs/index.html para que el navegador (y la caché de
// GitHub Pages) pidan el index.js / index.css NUEVOS al cambiar de versión. Los nombres son fijos (sin hash)
// y, sin esto, al abrir la web recién actualizada seguía saliendo la versión anterior hasta un Ctrl+F5.
import fs from 'node:fs';
const v = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const p = 'docs/index.html';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/(\.\/assets\/[^"'?]+)(\?v=[^"']*)?/g, `$1?v=${v}`);
fs.writeFileSync(p, s);
console.log('docs/index.html → assets con ?v=' + v);
