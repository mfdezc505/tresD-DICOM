import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

// tresD DICOM — configuracion de Vite.
// base './' -> rutas relativas: funciona en GitHub Pages (usuario.github.io/tresD-DICOM/)
// y tambien sirviendo la carpeta docs/ en local con `python -m http.server`.
export default defineConfig({
  base: './',
  resolve: {
    // modulos de Node que piden dependencias (dcmjs -> xmlbuilder2; codecs wasm): sustitutos para el navegador
    alias: {
      events: r('./node_modules/events/events.js'),
      url: r('./src/shims/url.js'),
      fs: r('./src/shims/empty.js'),
      path: r('./src/shims/empty.js'),
    },
  },
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
    // nombres FIJOS (sin hash): cada build sobrescribe los mismos archivos en docs/ del PC de Manuel
    // en vez de acumular copias. GitHub Pages cachea solo 10 min, asi que no hace falta el hash.
    rollupOptions: { output: { entryFileNames: 'assets/[name].js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' } },
  },
  worker: { format: 'es', rollupOptions: { output: { entryFileNames: 'assets/[name].js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' } } },
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: ['dicom-parser'],
  },
  server: { port: 5173, host: true },
});
