// tresD DICOM — SILUETAS de las mallas (cráneo, piel, dientes, escáneres) sobre los cortes MPR.
// Cada corte MPR es un plano perpendicular a un eje del mundo (axial = Z, coronal = Y, sagital = X) que
// pasa por el foco de la cámara. Se corta cada malla visible por ese plano (intersección triángulo-plano →
// segmentos) y se dibuja en un <canvas> superpuesto con el color de la malla. Para no recorrer los 500 k
// triángulos de la piel en cada corte, los triángulos se reparten UNA vez por «rebanadas» de 1 mm a lo largo
// de cada eje (caché por malla y revisión: se rehace si la malla se mueve).
import { Enums } from '@cornerstonejs/core';

const SLAB = 1.0;   // mm

export class Silhouettes {
  constructor(getViewport, getMeshes, hasVolume) {
    this.getViewport = getViewport; this.getMeshes = getMeshes; this.hasVolume = hasVolume;
    this.enabled = true;
    this.suppressed = false;      // apagado TEMPORAL (marcando la vía aérea, editando la curva…)
    this.canvases = {};           // vpId → canvas
    this.cache = new Map();       // mesh.id → { rev, buckets: { [axis]: { min, list: Int32Array[] } } }
    this.pending = {};
    this.extra = [];              // dibujos adicionales: fn(vpId, ctx2d, viewport, axis, value)
  }

  attach(elements) {
    for (const [id, el] of Object.entries(elements)) {
      if (this.canvases[id]) continue;
      const cv = document.createElement('canvas'); cv.className = 'silh';
      el.appendChild(cv);
      this.canvases[id] = cv;
      const cb = () => this.schedule(id);
      el.addEventListener(Enums.Events.IMAGE_RENDERED, cb);
      el.addEventListener(Enums.Events.CAMERA_MODIFIED, cb);
      el.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, cb);
    }
  }

  setEnabled(on) { this.enabled = !!on; this.redrawAll(); }

  /** Apaga las siluetas sin tocar la casilla del usuario (los dibujos extra se siguen viendo). */
  setSuppressed(on) { if (this.suppressed === !!on) return; this.suppressed = !!on; this.redrawAll(); }

  /** Una malla cambió (posición, color, visibilidad) o se añadió / quitó: repintar todos los cortes. */
  redrawAll() { for (const id of Object.keys(this.canvases)) this.schedule(id); }

  schedule(id) {
    if (this.pending[id]) return;
    this.pending[id] = requestAnimationFrame(() => { this.pending[id] = 0; this.redraw(id); });
  }

  forget(meshId) { this.cache.delete(meshId); }

  redraw(id) {
    const cv = this.canvases[id]; if (!cv) return;
    const el = cv.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth, h = el.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    if (!this.hasVolume()) return;
    const vp = this.getViewport(id); if (!vp) return;
    let cam; try { cam = vp.getCamera(); } catch (e) { return; }
    const n = cam.viewPlaneNormal, fp = cam.focalPoint;
    if (!n || !fp) return;
    let axis = 0; for (let q = 1; q < 3; q++) if (Math.abs(n[q]) > Math.abs(n[axis])) axis = q;
    if (Math.abs(n[axis]) < 0.99) return;                 // corte oblicuo (cruz girada): no se dibuja
    const value = fp[axis];
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineWidth = 1.6; g.lineCap = 'round'; g.globalAlpha = 0.95;
    // dibujos extra (p. ej. la curva de la panorámica sobre el axial): siempre, aunque las siluetas estén apagadas
    for (const fn of this.extra || []) { try { fn(id, g, vp, axis, value); } catch (e) { /* nada */ } }
    if (!this.enabled || this.suppressed) return;
    for (const m of this.getMeshes()) {
      if (!m.visible) continue;
      const segs = this.slice(m, axis, value);
      if (!segs.length) continue;
      g.strokeStyle = m.color || '#22D3EE';
      g.beginPath();
      for (const [a, b] of segs) {
        const pa = vp.worldToCanvas(a), pb = vp.worldToCanvas(b);
        g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]);
      }
      g.stroke();
    }
  }

  /** Segmentos [[x,y,z],[x,y,z]] de la intersección de la malla con el plano coord[axis] = value. */
  slice(m, axis, value) {
    const pts = m.pts, P = m.polys;
    let c = this.cache.get(m.id);
    if (!c || c.rev !== (m.rev || 0)) { c = { rev: m.rev || 0, buckets: {} }; this.cache.set(m.id, c); }
    let B = c.buckets[axis];
    if (!B) {
      const min = m.bounds[2 * axis], max = m.bounds[2 * axis + 1];
      const nb = Math.max(1, Math.ceil((max - min) / SLAB) + 1);
      const counts = new Int32Array(nb + 1);
      const lo = new Int32Array(P.length / 3), hi = new Int32Array(P.length / 3);
      for (let t = 0, k = 0; t < P.length; t += 3, k++) {
        const a = pts[3 * P[t] + axis], b = pts[3 * P[t + 1] + axis], d = pts[3 * P[t + 2] + axis];
        const l = Math.floor((Math.min(a, b, d) - min) / SLAB), u = Math.floor((Math.max(a, b, d) - min) / SLAB);
        lo[k] = l; hi[k] = u;
        for (let q = l; q <= u; q++) counts[q + 1]++;
      }
      for (let q = 0; q < nb; q++) counts[q + 1] += counts[q];
      const items = new Int32Array(counts[nb]); const fill = new Int32Array(nb);
      for (let k = 0; k < lo.length; k++) for (let q = lo[k]; q <= hi[k]; q++) items[counts[q] + fill[q]++] = 3 * k;
      B = { min, nb, start: counts, items };
      c.buckets[axis] = B;
    }
    const q = Math.floor((value - B.min) / SLAB);
    if (q < 0 || q >= B.nb) return [];
    const segs = [];
    const v = [0, 0, 0];
    for (let s = B.start[q], e = B.start[q + 1]; s < e; s++) {
      const t = B.items[s];
      const i0 = 3 * P[t], i1 = 3 * P[t + 1], i2 = 3 * P[t + 2];
      const d0 = pts[i0 + axis] - value, d1 = pts[i1 + axis] - value, d2 = pts[i2 + axis] - value;
      if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0)) continue;
      const out = [];
      const edge = (ia, ib, da, db) => {
        if ((da > 0) === (db > 0) && da !== 0 && db !== 0) return;
        if (da === db) return;
        const f = da / (da - db);
        out.push([pts[ia] + f * (pts[ib] - pts[ia]), pts[ia + 1] + f * (pts[ib + 1] - pts[ia + 1]), pts[ia + 2] + f * (pts[ib + 2] - pts[ia + 2])]);
      };
      edge(i0, i1, d0, d1); edge(i1, i2, d1, d2); edge(i2, i0, d2, d0);
      if (out.length >= 2) segs.push([out[0], out[1]]);
    }
    void v;
    return segs;
  }
}
