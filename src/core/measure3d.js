// tresD DICOM — MEDICIÓN sobre el RENDER 3D (distancia de 2 puntos / ángulo de 3 puntos).
// Portado de VOXEL (_imp_measure_mode / _on_imp_measure_pick / _imp_draw_measures):
//  - el clic izquierdo (sin arrastre) "pica" la superficie del hueso lanzando un RAYO desde la
//    cámara a través del volumen y parando en el primer vóxel con HU >= umbral del preset;
//  - respeta el CORTE: si hay plano de corte, se ignora el lado recortado (el punto cae dentro);
//  - líneas + esferas de color por medición y etiqueta HTML con el valor (arrastrable; doble clic la
//    borra). El modo sigue activo tras completar: se encadenan mediciones (Esc o el botón lo apagan).
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import { Enums } from '@cornerstonejs/core';

export const MEAS_COLORS = ['#22D3EE', '#F472B6', '#FDE047', '#34D399', '#A78BFA', '#F59E0B'];

function hex(c) { const s = c.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255); }

export class Measure3D {
  constructor(getViewport, getVolume, getThreshold) {
    this.getViewport = getViewport; this.getVolume = getVolume; this.getThreshold = getThreshold;
    this.mode = null; this.pending = []; this.measures = []; this.clip = null;
    this.markers = null;          // { pts: [[x,y,z]…], color } (registro manual de la foto)
    this.actors = []; this.labels = []; this.el = null; this.overlay = null;
    this.onDone = null;
    this._down = null;
    this._onDown = (e) => { if (e.button === 0) this._down = [e.clientX, e.clientY]; this._hideLive(); };
    this._onUp = (e) => this._pointerUp(e);
    this._onCam = () => this.refresh();
    this._onMove = (e) => this._pointerMove(e);
    this._onLeave = () => this._hideLive();
    this.live = null;             // { line (SVG), label } trazado EN VIVO hasta el cursor
    this._liveTimer = 0; this._livePos = null;
  }

  attach(el) {
    if (this.el === el) return;               // ya escuchando este visor
    this.detach();
    this.el = el;
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    el.appendChild(this.overlay);
    el.addEventListener('pointerdown', this._onDown);
    el.addEventListener('pointerup', this._onUp);
    el.addEventListener('pointermove', this._onMove);
    el.addEventListener('pointerleave', this._onLeave);
    el.addEventListener(Enums.Events.CAMERA_MODIFIED, this._onCam);
    el.addEventListener(Enums.Events.IMAGE_RENDERED, this._onCam);
  }

  detach() {
    if (!this.el) return;
    this.el.removeEventListener('pointerdown', this._onDown);
    this.el.removeEventListener('pointerup', this._onUp);
    this.el.removeEventListener('pointermove', this._onMove);
    this.el.removeEventListener('pointerleave', this._onLeave);
    this.el.removeEventListener(Enums.Events.CAMERA_MODIFIED, this._onCam);
    this.el.removeEventListener(Enums.Events.IMAGE_RENDERED, this._onCam);
    if (this.overlay) this.overlay.remove();
    this.overlay = null; this.el = null;
  }

  setMode(mode) {
    this.mode = mode; this.pending = []; this._hideLive();
    if (this.el) this.el.parentElement?.classList.toggle('measuring', !!mode);
    this._draw();
  }

  setClip(clip) { this.clip = clip; }

  clear() {
    this.measures = []; this.pending = []; this.mode = null; this._hideLive();
    if (this.el) this.el.parentElement?.classList.remove('measuring');
    this._draw();
  }

  _pointerUp(e) {
    if (!this.mode || e.button !== 0 || !this._down) return;
    const moved = Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]);
    this._down = null;
    if (moved > 4) return;                    // fue un arrastre (giro), no un clic
    const vp = this.getViewport();
    const rect = vp.element.getBoundingClientRect();
    const world = this.pick([e.clientX - rect.left, e.clientY - rect.top]);
    if (!world) return;
    this.pending.push(world);
    const need = this.mode === 'linear' ? 2 : 3;
    if (this.pending.length < need) { this._draw(); return; }
    const col = this.nextColor();
    const [a, b, c] = this.pending;
    if (this.mode === 'linear') {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      this.measures.push({ type: 'linear', pts: [a, b], color: col, label: d.toFixed(1) + ' mm',
        labelpos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], offset: [0, -16] });
    } else {
      const v1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], v2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
      const cs = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / ((Math.hypot(...v1) * Math.hypot(...v2)) + 1e-9);
      const ang = (Math.acos(Math.max(-1, Math.min(1, cs))) * 180) / Math.PI;
      this.measures.push({ type: 'angle', pts: [a, b, c], color: col, label: ang.toFixed(1) + '°', labelpos: b.slice(), offset: [0, -16] });
    }
    this.pending = []; this._hideLive();
    this._draw();
    if (this.onDone) this.onDone(this.mode, this.measures[this.measures.length - 1]);     // el modo sigue activo: se pueden encadenar mediciones
  }

  /** Color que tendrá la PRÓXIMA medición (cada una lleva el suyo, cíclico). */
  nextColor() { return MEAS_COLORS[this.measures.length % MEAS_COLORS.length]; }

  // ---------------------------------------------------------------- trazado EN VIVO (goma elástica)
  /** Al mover el ratón con un punto pendiente: línea desde el último punto al cursor y valor provisional
   *  (distancia / ángulo) calculado con un «pick» acotado en el tiempo (no en cada píxel). */
  _pointerMove(e) {
    if (!this.mode || !this.pending.length || this._down || !this.overlay) { if (this.live) this._hideLive(); return; }
    const vp = this.getViewport(); if (!vp) return;
    const rect = vp.element.getBoundingClientRect();
    const pos = [e.clientX - rect.left, e.clientY - rect.top];
    this._livePos = pos;
    if (!this.live) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'rubber');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); svg.appendChild(line);
      const label = document.createElement('div'); label.className = 'mlabel live';
      this.overlay.appendChild(svg); this.overlay.appendChild(label);
      this.live = { svg, line, label, value: '' };
    }
    const col = this.nextColor();
    const last = vp.worldToCanvas(this.pending[this.pending.length - 1]);
    const L = this.live;
    L.line.setAttribute('x1', last[0]); L.line.setAttribute('y1', last[1]); L.line.setAttribute('x2', pos[0]); L.line.setAttribute('y2', pos[1]); L.line.setAttribute('stroke', col);
    L.label.style.left = (pos[0] + 14) + 'px'; L.label.style.top = (pos[1] - 10) + 'px';
    L.label.style.background = col; L.label.textContent = L.value; L.label.style.display = L.value ? '' : 'none';
    // valor provisional: pick acotado (cada ~70 ms)
    if (!this._liveTimer) this._liveTimer = setTimeout(() => { this._liveTimer = 0; this._liveValue(); }, 70);
  }
  _liveValue() {
    const L = this.live; if (!L || !this._livePos || !this.pending.length) return;
    const w = this.pick(this._livePos);
    let txt = '';
    if (w) {
      if (this.mode === 'linear') { const a = this.pending[0]; txt = Math.hypot(w[0] - a[0], w[1] - a[1], w[2] - a[2]).toFixed(1) + ' mm'; }
      else if (this.pending.length === 2) {
        const [a, b] = this.pending; const v1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], v2 = [w[0] - b[0], w[1] - b[1], w[2] - b[2]];
        const cs = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / ((Math.hypot(...v1) * Math.hypot(...v2)) + 1e-9);
        txt = ((Math.acos(Math.max(-1, Math.min(1, cs))) * 180) / Math.PI).toFixed(1) + '°';
      } else { const a = this.pending[0]; txt = Math.hypot(w[0] - a[0], w[1] - a[1], w[2] - a[2]).toFixed(1) + ' mm'; }
    }
    L.value = txt; L.label.textContent = txt; L.label.style.display = txt ? '' : 'none';
  }
  _hideLive() {
    if (this._liveTimer) { clearTimeout(this._liveTimer); this._liveTimer = 0; }
    if (!this.live) return;
    this.live.svg.remove(); this.live.label.remove(); this.live = null;
  }

  /** Vuelve a dibujar (tras cambiar de volumen, que quita los actores del visor). */
  redraw() { this._draw(); }

  /** Esferas auxiliares (puntos marcados a mano); null las quita. */
  setMarkers(pts, color = '#22D3EE') { this.markers = pts && pts.length ? { pts, color } : null; this._draw(); }

  /** Quita una medición concreta (doble clic en su etiqueta). */
  remove(index) {
    const m = this.measures[index];
    this.measures.splice(index, 1);
    this._draw();
    if (m && this.onRemove) this.onRemove(m, index);
  }

  /** Quita / vuelve a poner una medición concreta (deshacer / rehacer). */
  removeMeasure(m) { const i = this.measures.indexOf(m); if (i >= 0) { this.measures.splice(i, 1); this._draw(); } }
  addMeasure(m, index = this.measures.length) { if (!this.measures.includes(m)) { this.measures.splice(Math.min(index, this.measures.length), 0, m); this._draw(); } }
  /** Sustituye la lista entera (borrar / restaurar todas). */
  setMeasures(list) { this.measures = list.slice(); this.pending = []; this._draw(); }

  /**
   * Rayo desde la cámara por el píxel (canvas): primer vóxel opaco del volumen y/o primer triángulo de
   * las mallas (gancho `extraPick`); gana el impacto más cercano. Devuelve [x,y,z] o null.
   */
  pick(canvasPos) {
    const vp = this.getViewport(); const vol = this.getVolume();
    if (!vp) return null;
    const b = this.getBounds ? this.getBounds() : (vol ? vol.imageData.getBounds() : null);
    if (!b) return null;
    const cam = vp.getCamera();
    const n = cam.viewPlaneNormal;                      // del foco hacia la cámara
    const p = vp.canvasToWorld(canvasPos);              // punto del rayo en el plano focal
    const diag = Math.hypot(b[1] - b[0], b[3] - b[2], b[5] - b[4]);
    const start = [p[0] + n[0] * diag, p[1] + n[1] * diag, p[2] + n[2] * diag];
    const dir = [-n[0], -n[1], -n[2]];
    const kept = (w) => !this.clip || (this.clip.flip ? w[this.clip.ai] <= this.clip.cut : w[this.clip.ai] >= this.clip.cut);
    let best = null, bestT = 2 * diag;
    if (vol) {
      const w = this._pickVolume(vol, start, dir, bestT, kept);
      if (w) { best = w; bestT = Math.hypot(w[0] - start[0], w[1] - start[1], w[2] - start[2]); }
    }
    if (this.extraPick) {
      const hit = this.extraPick(start, dir, bestT, kept);
      if (hit && hit.t < bestT) best = hit.w;
    }
    return best;
  }

  /** Rayo contra el VOLUMEN solamente (aunque esté oculto) con un umbral dado: [x,y,z] | null. */
  pickVolume(canvasPos, thr) {
    const vp = this.getViewport(); const vol = this.getVolume(true);
    if (!vp || !vol) return null;
    const b = vol.imageData.getBounds();
    const cam = vp.getCamera(); const n = cam.viewPlaneNormal;
    const p = vp.canvasToWorld(canvasPos);
    const diag = Math.hypot(b[1] - b[0], b[3] - b[2], b[5] - b[4]);
    const start = [p[0] + n[0] * diag, p[1] + n[1] * diag, p[2] + n[2] * diag];
    const kept = (w) => !this.clip || (this.clip.flip ? w[this.clip.ai] <= this.clip.cut : w[this.clip.ai] >= this.clip.cut);
    return this._pickVolume(vol, start, [-n[0], -n[1], -n[2]], 2 * diag, kept, thr);
  }

  _pickVolume(vol, start, dir, total, kept, thrOverride = null) {
    const img = vol.imageData; const vm = vol.voxelManager;
    const dims = img.getDimensions(); const b = img.getBounds();
    const step = Math.min(...vol.spacing) * 0.6;
    const thr = thrOverride ?? this.getThreshold();
    const idx = [0, 0, 0];
    const inside = (w) => w[0] >= b[0] && w[0] <= b[1] && w[1] >= b[2] && w[1] <= b[3] && w[2] >= b[4] && w[2] <= b[5];
    const sample = (w) => {
      img.worldToIndex(w, idx);
      const i = Math.round(idx[0]), j = Math.round(idx[1]), k = Math.round(idx[2]);
      if (i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2]) return -1e9;
      return vm.getAtIJK(i, j, k);
    };
    let prev = null;
    for (let t = 0; t <= total; t += step) {
      const w = [start[0] + dir[0] * t, start[1] + dir[1] * t, start[2] + dir[2] * t];
      if (!inside(w) || !kept(w)) { prev = null; continue; }
      const v = sample(w);
      if (v >= thr) {
        if (!prev) return w;
        // afinar por bisección entre la muestra anterior (fuera) y esta (dentro)
        let lo = prev, hi = w;
        for (let it = 0; it < 6; it++) {
          const m = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
          if (sample(m) >= thr) hi = m; else lo = m;
        }
        return hi;
      }
      prev = w;
    }
    return null;
  }

  // ---------------------------------------------------------------- dibujo
  _draw() {
    const vp = this.getViewport();
    if (!vp) return;
    // (Cornerstone ya puede haber quitado los actores al cambiar de volumen: solo se quitan los que siguen)
    const alive = this.actors.filter((uid) => vp.getActor(uid));
    if (alive.length) { try { vp.removeActors(alive); } catch (e) { /* nada */ } }
    this.actors = [];
    if (this.overlay) this.overlay.innerHTML = '';
    this.labels = [];
    let k = 0;
    const add = (actor) => { const uid = 'meas_' + Date.now() + '_' + (k++); vp.addActor({ uid, actor }); this.actors.push(uid); };
    this.measures.forEach((m, idx) => {
      add(lineActor(m.pts, m.color, 3));
      for (const p of m.pts) add(sphereActor(p, m.color, 0.9));
      if (this.overlay) {
        const d = document.createElement('div');
        d.className = 'mlabel'; d.textContent = m.label; d.style.background = m.color; d.style.color = '#0B0F1A';
        d.title = 'Arrastrar para mover · doble clic para borrar';
        this._makeDraggable(d, m);
        d.addEventListener('dblclick', (e) => { e.stopPropagation(); this.remove(idx); });
        this.overlay.appendChild(d); this.labels.push({ el: d, m });
      }
    });
    if (this.pending.length) {
      const col = this.nextColor();
      if (this.pending.length > 1) add(lineActor(this.pending, col, 2));
      for (const p of this.pending) add(sphereActor(p, col, 0.9));
    }
    if (this.markers) for (const p of this.markers.pts) add(sphereActor(p, this.markers.color, 1.4));
    this.refresh();
    try { vp.render(); } catch (e) { /* nada */ }
  }

  refresh() {
    const vp = this.getViewport();
    if (!vp || !this.labels.length) return;
    for (const l of this.labels) {
      try {
        const c = vp.worldToCanvas(l.m.labelpos);
        const off = l.m.offset || [0, -16];
        l.el.style.left = (c[0] + off[0]) + 'px'; l.el.style.top = (c[1] + off[1]) + 'px';
      } catch (e) { /* nada */ }
    }
  }

  /** La etiqueta se arrastra con el ratón (desplazamiento en píxeles respecto a su punto ancla).
   *  Se paran los eventos para que Cornerstone no empiece a girar el volumen. */
  _makeDraggable(el, m) {
    let start = null;
    const stop = (e) => { e.stopPropagation(); };
    el.addEventListener('mousedown', stop);
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      start = { x: e.clientX, y: e.clientY, off: (m.offset || [0, -16]).slice() };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    });
    el.addEventListener('pointermove', (e) => {
      if (!start) return;
      e.stopPropagation();
      m.offset = [start.off[0] + (e.clientX - start.x), start.off[1] + (e.clientY - start.y)];
      this.refresh();
    });
    const end = (e) => { if (start) { e.stopPropagation(); start = null; el.style.cursor = 'grab'; } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', stop);
  }
}

function lineActor(pts, color, width) {
  const pd = vtkPolyData.newInstance();
  const flat = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => { flat[3 * i] = p[0]; flat[3 * i + 1] = p[1]; flat[3 * i + 2] = p[2]; });
  pd.getPoints().setData(flat, 3);
  const lines = new Uint32Array(pts.length + 1);
  lines[0] = pts.length; for (let i = 0; i < pts.length; i++) lines[i + 1] = i;
  pd.getLines().setData(lines);
  const mapper = vtkMapper.newInstance(); mapper.setInputData(pd);
  const actor = vtkActor.newInstance(); actor.setMapper(mapper);
  const pr = actor.getProperty(); pr.setColor(...hex(color)); pr.setLineWidth(width); pr.setLighting(false);
  return actor;
}

function sphereActor(center, color, radius) {
  const src = vtkSphereSource.newInstance({ center, radius, thetaResolution: 16, phiResolution: 12 });
  const mapper = vtkMapper.newInstance(); mapper.setInputConnection(src.getOutputPort());
  const actor = vtkActor.newInstance(); actor.setMapper(mapper);
  actor.getProperty().setColor(...hex(color));
  return actor;
}
