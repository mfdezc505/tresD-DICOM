// Depuración de tmj.js en Node (sin navegador) con el volumen DZ: refinado del cóndilo y cortes.
// Uso: node --import ./tests/_register.mjs tests/_dbg_tmj_node.mjs
import fs from 'node:fs';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { tmjSampler, refineCondyle, condyleSeries } from '../src/core/tmj.js';
import { sampleSorted } from '../src/core/presets.js';
import { autoThresholds } from '../src/core/stats.js';

const J = JSON.parse(fs.readFileSync('/tmp/testdata/dz_half.json', 'utf8'));
const dims = J.dims; const raw = new Int16Array(fs.readFileSync('/tmp/testdata/dz_half.raw').buffer);
const A = J.axes, len = A.map((e) => Math.hypot(...e));
const img = vtkImageData.newInstance();
img.setDimensions(dims[0], dims[1], dims[2]);
img.setSpacing(len[0], len[1], len[2]);
img.setOrigin(...J.origin);
img.setDirection(...[0, 1, 2].flatMap((q) => A[q].map((v) => v / len[q])));
const frame = dims[0] * dims[1];
const getSlice = (k) => raw.subarray(k * frame, (k + 1) * frame);
const volume = { imageData: img, spacing: len };
const thr = autoThresholds(sampleSorted(raw)).bone;
console.log('umbral de hueso', thr.toFixed(0));
const smp = tmjSampler(volume, getSlice);
const SEEDS = { R: [-54, -24, 43], L: [50, -29, 45] };
for (const sd of ['R', 'L']) {
  const t0 = Date.now();
  const p = refineCondyle(smp, SEEDS[sd], thr);
  if (!p) { console.log(sd, 'SIN CÓNDILO'); continue; }
  const width = Math.hypot(p.lat[0] - p.med[0], p.lat[1] - p.med[1], p.lat[2] - p.med[2]);
  console.log(sd, Date.now() - t0, 'ms ·', p.n, 'vóx ·', 'med', p.med.map((v) => +v.toFixed(1)), 'lat', p.lat.map((v) => +v.toFixed(1)),
    '· ancho', width.toFixed(1), 'mm · ml', p.ml.map((v) => +v.toFixed(2)), '· centro', p.center.map((v) => +v.toFixed(1)));
  const t1 = Date.now();
  const s = condyleSeries(smp, p, 0.25);
  console.log('   cortes', s.length, s.map((x) => `${x.key}:${x.img.w}×${x.img.h}`).join(' '), Date.now() - t1, 'ms');
  // volcado PGM del corte sagital central para mirarlo
  const c = s.find((x) => x.key === 'sag0');
  const lo = -200, hi = 1600;
  const px = Buffer.from(Array.from(c.img.data, (v) => Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo)) * 255)))));
  fs.writeFileSync(`/home/claude/tresD_DICOM/tests/out/tmj_${sd}.pgm`, Buffer.concat([Buffer.from(`P5\n${c.img.w} ${c.img.h}\n255\n`), px]));
}
