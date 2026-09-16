// tresD DICOM — VISOR: Cornerstone3D (render, MPR, herramientas) + vtk.js (presets, corte, planos).
// Un solo RenderingEngine con 4 visores: 'vp3d' (render volumétrico) y 'vpAx' / 'vpCor' / 'vpSag'
// (cortes MPR ortográficos). Todo el estado del caso vive aquí (módulo singleton).
import {
  init as csInit, RenderingEngine, Enums, volumeLoader, setVolumesForViewports, cache, eventTarget,
  getRenderingEngine,
} from '@cornerstonejs/core';
import * as csTools from '@cornerstonejs/tools';
import { init as loaderInit, wadouri, prefetchPart10Instance } from '@cornerstonejs/dicom-image-loader';
import { imageLoader, metaData as csMetaData } from '@cornerstonejs/core';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import { applyState, sampleSorted, windowFor, opaqueThreshold } from './presets.js';
import { Measure3D, MEAS_COLORS } from './measure3d.js';
export { MEAS_COLORS };
import { MprPlanes } from './mprPlanes.js';
import { Silhouettes } from './contours.js';
import { decimationFactor, buildDecimatedVolume } from './bigVolume.js';
import { buildRenderVolume, removeRenderVolume } from './renderVolume.js';
import vtkLight from '@kitware/vtk.js/Rendering/Core/Light';
import { MeshLayer, readMesh, writeSTL } from './meshes.js';
import { patientFrame } from './orient.js';
import { enamelTargets, pickTargets, alignToTeeth, refineToTeeth, rigidFromPairs, alignQuality, snapToTarget } from './align.js';
import { quickSegment } from './segment.js';
import { autoThresholds } from './stats.js';
import { detectFace, solvePose, buildAtlas, projectUV, faceBoxFrom, faceBoxFrom3 } from './drape.js';
import { History } from './history.js';
import { airwayAuto, heatColors, heatRange, airwayNorm, airwayClassify } from './airway.js';
export { airwayNorm, airwayClassify };
import { archCurve, curveFrom, buildPanoramic, drawPanoramic } from './panoramic.js';
import { tmjSampler, refineCondyle, condyleSeries, condyleSlice, samplePlane, polesFrom, planeToWorld, worldToPlane, drawSlice, clampAspect, bestAxialOffset, TMJ_SAG_OFFS } from './tmj.js';
export { clampAspect, planeToWorld, worldToPlane };
export { drawSlice as drawTmjSlice, TMJ_SAG_OFFS };
export { drawPanoramic };

/** Deshacer / rehacer global (main.js apunta las acciones de la interfaz; aquí las geométricas). */
export const history = new History(50);

const RE_ID = 'tresd';
export const VP = { v3d: 'vp3d', ax: 'vpAx', cor: 'vpCor', sag: 'vpSag' };
const MPR_IDS = [VP.ax, VP.cor, VP.sag];
const TG_MPR = 'tg-mpr', TG_3D = 'tg-3d';
const { ViewportType, OrientationAxis, Events } = Enums;
const { MouseBindings } = csTools.Enums;

// Vistas estándar de VOXEL en el marco DICOM/LPS: derecha del paciente = -X, anterior = -Y, superior = +Z.
// viewPlaneNormal apunta del foco HACIA la cámara.
export const VIEWS = {
  frontal: { n: [0, -1, 0], up: [0, 0, 1] },
  lat_r: { n: [-1, 0, 0], up: [0, 0, 1] },
  lat_l: { n: [1, 0, 0], up: [0, 0, 1] },
  sup: { n: [0, 0, 1], up: [0, -1, 0] },
  inf: { n: [0, 0, -1], up: [0, -1, 0] },
  post: { n: [0, 1, 0], up: [0, 0, 1] },
};

export const state = {
  ready: false,
  engine: null,
  volume: null, volumeId: null, series: null,
  renderVolumeId: null,         // copia suavizada ≤ 400 vóx/eje para el visor 3D (renderVolume.js)
  sorted: null,                 // muestra ordenada de HU
  render: { preset: 'ivory', lo: 300, hi: 2200, opacity: 1.0, visible: true },
  range: [-1000, 3000],
  mprWindow: { lower: -600, upper: 1400 },
  cut: { axis: null, frac: 0.5, flip: false },
  measureMode: null,
  mprMeasures: 0,               // contador de mediciones en los MPR (color cíclico)
  silhouettes: true,            // siluetas de las mallas sobre los cortes MPR
  enamel: null,                 // superficie dental del CBCT (caché bruta, align.enamelTargets)
  teeth: null,                  // destinos por arco elegidos (pickTargets; tras el reintento mutuo, la arcada ganadora)
  crosshairs: false,            // cruz de referencia en los MPR (CrosshairsTool)
  pano: null,                   // panorámica { curve, image, thickness, mip }
  showArch: false,              // dibujar la curva de la arcada sobre el axial (apagada por defecto, v0.7.7)
  panDraw: null,                // puntos que el usuario está marcando para dibujar la curva panorámica (v0.7.12)
  panoEdit: false,              // editando la curva de la panorámica (puntos de control sobre el axial)
  awMarks: null,                // marcas [sup, inf] (mundo) mientras se marca la vía aérea en el sagital
  tmj: null,                    // cortes de ATM { poles: {R, L}, series: {R: [...], L: [...]}, win }
  tmjMarks: null,               // marcas de los cóndilos mientras se señalan en los cortes
  geometry: null,               // resultado de la guarda de geometría del volumen (enforceGeometry)
  onStatus: null,               // (texto) -> barra de estado
  onViewportInfo: null,         // (vpId, texto) -> etiqueta del visor
  onMeasureDone: null,          // () -> al completar una medición
  onMeshesChanged: null,        // () -> tras deshacer / rehacer (la interfaz sincroniza las tarjetas)
};

let measure3d = null;
let mprPlanes = null;
let silhouettes = null;          // siluetas de las mallas sobre los cortes MPR
let meshes = null;               // escáneres intraorales (Fase 2)
let elements = {};

/** Hay algo que ver (volumen o alguna malla). */
export function hasCase() { return !!state.volume || (meshes && meshes.items.length > 0); }
export function getMeshes() { return meshes ? meshes.items : []; }

/** STL binario de una malla, en su posición actual. Devuelve { name, buf } o null. */
export function meshSTL(id) {
  const it = (meshes ? meshes.items : []).find((m) => m.id === id);
  return it ? { name: it.name, buf: writeSTL(it, 'tresD DICOM - ' + it.name) } : null;
}

/** Caja del escenario: volumen ∪ mallas visibles (para el corte y para el rayo de medición). */
export function sceneBounds() {
  let b = null;
  if (state.volume) b = state.volume.imageData.getBounds().slice();
  const m = meshes && meshes.bounds();
  if (m) b = b ? [Math.min(b[0], m[0]), Math.max(b[1], m[1]), Math.min(b[2], m[2]), Math.max(b[3], m[3]), Math.min(b[4], m[4]), Math.max(b[5], m[5])] : m;
  return b;
}

// ------------------------------------------------------------------ inicialización
export async function initViewer(els) {
  elements = els;
  csInit({ rendering: { preferSizeOverAccuracy: false } });
  // Codecs wasm (JPEG 2000, JPEG-LS, JPEG baseline, HTJ2K): Vite los copia a docs/assets y el
  // trabajador los localiza por su URL; probado con una serie JPEG 2000 (tests/loaders.mjs).
  loaderInit({ maxWebWorkers: Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2))) });
  csTools.init();

  const engine = new RenderingEngine(RE_ID);
  state.engine = engine;
  const bg = viewerBg();
  engine.setViewports([
    { viewportId: VP.v3d, type: ViewportType.VOLUME_3D, element: els[VP.v3d], defaultOptions: { background: bg, parallelProjection: true } },
    { viewportId: VP.ax, type: ViewportType.ORTHOGRAPHIC, element: els[VP.ax], defaultOptions: { orientation: OrientationAxis.AXIAL, background: bg } },
    { viewportId: VP.cor, type: ViewportType.ORTHOGRAPHIC, element: els[VP.cor], defaultOptions: { orientation: OrientationAxis.CORONAL, background: bg } },
    { viewportId: VP.sag, type: ViewportType.ORTHOGRAPHIC, element: els[VP.sag], defaultOptions: { orientation: OrientationAxis.SAGITTAL, background: bg } },
  ]);

  // herramientas
  for (const T of [csTools.StackScrollTool, csTools.WindowLevelTool, csTools.PanTool, csTools.ZoomTool,
    csTools.LengthTool, csTools.AngleTool, csTools.TrackballRotateTool, csTools.CrosshairsTool]) {
    try { csTools.addTool(T); } catch (e) { /* ya añadida */ }
  }
  const tgm = csTools.ToolGroupManager.createToolGroup(TG_MPR);
  tgm.addTool(csTools.StackScrollTool.toolName);
  tgm.addTool(csTools.WindowLevelTool.toolName);
  tgm.addTool(csTools.PanTool.toolName);
  tgm.addTool(csTools.ZoomTool.toolName);
  tgm.addTool(csTools.LengthTool.toolName);
  tgm.addTool(csTools.AngleTool.toolName);
  // Cruz de referencia (colores por corte: axial rojo, coronal verde, sagital azul, como 3D Slicer).
  //  - `handleRadius` 3,5 (Cornerstone trae 3; el modo móvil 9): mangos discretos, solo al pasar el ratón.
  //  - los CUADRADOS son el grosor de corte (slab thickness), que este visor no ofrece: se apagan. Eran los
  //    que se montaban encima de los círculos de giro.
  //  - `referenceLinesCenterGapRadius` 26: hueco central algo mayor, para ver el punto exacto del cruce.
  // (El círculo de giro lo coloca Cornerstone en el punto MEDIO del tramo visible de cada media línea, así
  // que se separa del centro según dónde esté la cruz dentro del visor; no es configurable.)
  //  - `mobile.enabled: false` (v0.7.13): Cornerstone enciende solo su modo «móvil» si el equipo declara un
  //    puntero grueso (`any-pointer: coarse`: pantalla táctil, portátil con táctil...). En ese modo ignora
  //    todo lo anterior: círculos de radio 9, CUADRADOS de grosor siempre a la vista y sin esperar al ratón.
  //    Es lo que veía Manuel en su PC. Se apaga siempre: este visor se maneja con ratón.
  tgm.addTool(csTools.CrosshairsTool.toolName, {
    getReferenceLineColor: (id) => ({ [VP.ax]: '#E5484D', [VP.cor]: '#30A46C', [VP.sag]: '#3E63DD' }[id] || '#FFFFFF'),
    getReferenceLineControllable: () => true,
    getReferenceLineDraggableRotatable: () => true,
    getReferenceLineSlabThicknessControlsOn: () => false,
    handleRadius: 3.5,            // círculos de giro: menos de la mitad de los 9 del modo móvil; los ajusta tuneCrosshairs
    enableHDPIHandles: false,
    referenceLinesCenterGapRadius: 26,
    mobile: { enabled: false },
  });
  tgm.setToolActive(csTools.StackScrollTool.toolName, { bindings: [{ mouseButton: MouseBindings.Wheel }] });
  tgm.setToolActive(csTools.WindowLevelTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
  tgm.setToolActive(csTools.PanTool.toolName, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
  tgm.setToolActive(csTools.ZoomTool.toolName, { bindings: [{ mouseButton: MouseBindings.Secondary }] });
  tgm.setToolPassive(csTools.LengthTool.toolName);
  tgm.setToolPassive(csTools.AngleTool.toolName);
  tgm.setToolDisabled(csTools.CrosshairsTool.toolName);
  for (const id of MPR_IDS) tgm.addViewport(id, RE_ID);

  const tg3 = csTools.ToolGroupManager.createToolGroup(TG_3D);
  tg3.addTool(csTools.TrackballRotateTool.toolName);
  tg3.addTool(csTools.PanTool.toolName);
  tg3.addTool(csTools.ZoomTool.toolName);
  tg3.setToolActive(csTools.TrackballRotateTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
  tg3.setToolActive(csTools.PanTool.toolName, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
  tg3.setToolActive(csTools.ZoomTool.toolName, { bindings: [{ mouseButton: MouseBindings.Secondary }, { mouseButton: MouseBindings.Wheel }] });
  tg3.addViewport(VP.v3d, RE_ID);

  meshes = new MeshLayer(() => engine.getViewport(VP.v3d));
  measure3d = new Measure3D(() => engine.getViewport(VP.v3d), (force) => (force || state.render.visible ? state.volume : null), () => opaqueThreshold(state.render));
  measure3d.getBounds = sceneBounds;
  measure3d.extraPick = (start, dir, maxT, kept) => meshes.pick(start, dir, maxT, kept);
  measure3d.onDone = (mode, m) => {
    if (m) history.record({ label: 'measure', undo: () => measure3d.removeMeasure(m), redo: () => measure3d.addMeasure(m) });
    if (state.onMeasureDone) state.onMeasureDone();
  };
  measure3d.onRemove = (m, index) => history.record({ label: 'measure_del', undo: () => measure3d.addMeasure(m, index), redo: () => measure3d.removeMeasure(m) });
  mprPlanes = new MprPlanes(() => engine.getViewport(VP.v3d), () => state.volume);
  silhouettes = new Silhouettes((id) => engine.getViewport(id), () => meshes.items, () => !!state.volume);
  silhouettes.attach({ [VP.ax]: els[VP.ax], [VP.cor]: els[VP.cor], [VP.sag]: els[VP.sag] });
  // curva de la arcada de la panorámica sobre el corte AXIAL (línea discontinua)
  silhouettes.extra.push((id, g, vp, axis) => {
    if (id !== VP.ax || axis !== 2 || !state.showArch || !state.pano || !state.pano.curve) return;
    const c = state.pano.curve;
    g.save(); g.setLineDash([6, 4]); g.lineWidth = 1.5; g.strokeStyle = '#FDE047'; g.globalAlpha = 0.9;
    g.beginPath();
    c.pts.forEach((p, i) => { const q = vp.worldToCanvas([p[0], p[1], c.z]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
    g.stroke();
    // editando: el GROSOR de la panorámica como dos líneas finas a ±grosor/2 por la normal a la curva (v0.7.8)
    if (state.panoEdit && state.pano.thickness > 0 && c.pts.length > 2) {
      const h = state.pano.thickness / 2, n = c.pts.length;
      g.setLineDash([]); g.lineWidth = 1; g.globalAlpha = 0.6;
      for (const sgn of [1, -1]) {
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const a = c.pts[Math.max(0, i - 1)], b = c.pts[Math.min(n - 1, i + 1)];
          const tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1;
          const p = c.pts[i], q = vp.worldToCanvas([p[0] + sgn * h * (-ty / L), p[1] + sgn * h * (tx / L), c.z]);
          if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]);
        }
        g.stroke();
      }
      g.globalAlpha = 0.9;
    }
    if (state.panoEdit && c.control) {                    // puntos de CONTROL arrastrables
      g.setLineDash([]); g.lineWidth = 2; g.strokeStyle = '#0B0F1A';
      for (const p of c.control) {
        const q = vp.worldToCanvas([p[0], p[1], c.z]);
        g.beginPath(); g.arc(q[0], q[1], 5, 0, 2 * Math.PI); g.fillStyle = '#FDE047'; g.fill(); g.stroke();
      }
    }
    g.restore();
  });
  // puntos de la curva panorámica que el usuario está DIBUJANDO sobre el axial (v0.7.12)
  silhouettes.extra.push((id, g, vp, axis) => {
    if (id !== VP.ax || axis !== 2 || !state.panDraw) return;
    const q = state.panDraw.map((w) => vp.worldToCanvas(w));
    g.save(); g.globalAlpha = 1;
    if (q.length > 1) { g.setLineDash([5, 4]); g.lineWidth = 1.5; g.strokeStyle = '#FDE047'; g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); }
    g.setLineDash([]); g.lineWidth = 2; g.strokeStyle = '#0B0F1A'; g.font = 'bold 11px Poppins, sans-serif';
    q.forEach((p, i) => { g.beginPath(); g.arc(p[0], p[1], 5, 0, 2 * Math.PI); g.fillStyle = '#FDE047'; g.fill(); g.stroke(); g.fillStyle = '#FDE047'; g.fillText(String(i + 1), p[0] + 8, p[1] - 6); });
    g.restore();
  });
  // marcas de los CÓNDILOS mientras se señalan, sobre cualquier corte. Los POLOS ya no se pintan en los MPR
  // (v0.7.15, petición de Manuel: salían en el coronal); se ven solo en el diálogo «Ajustar polos», sobre su
  // propio corte axial.
  silhouettes.extra.push((id, g, vp, axis, value) => {
    const marks = [];
    if (state.tmjMarks) state.tmjMarks.forEach((w, i) => marks.push([w, ['#22E0FF', '#FF5CF0'][i], ['D', 'I'][i]]));
    for (const [w, col, tag] of marks) {
      if (Math.abs(w[axis] - value) > 4) continue;          // solo si el corte pasa cerca de la marca
      const q = vp.worldToCanvas(w);
      g.save(); g.setLineDash([]); g.globalAlpha = 1;
      g.beginPath(); g.arc(q[0], q[1], 5, 0, 2 * Math.PI); g.fillStyle = col; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
      g.font = 'bold 11px Poppins, sans-serif'; g.fillStyle = col; g.fillText(tag, q[0] + 9, q[1] + 4);
      g.restore();
    }
  });
  // marcas de la vía aérea (SUP azul / INF rojo) sobre el corte SAGITAL mientras se marcan
  silhouettes.extra.push((id, g, vp) => {
    if (id !== VP.sag || !state.awMarks || !state.awMarks.length) return;
    const cols = ['#2F6FED', '#E0403F'], names = ['SUP', 'INF'];
    state.awMarks.slice(0, 2).forEach((w, i) => {
      const q = vp.worldToCanvas(w);
      g.save(); g.setLineDash([]); g.globalAlpha = 1;
      g.beginPath(); g.arc(q[0], q[1], 6, 0, 2 * Math.PI); g.fillStyle = cols[i]; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
      g.font = 'bold 12px Poppins, sans-serif'; g.fillStyle = cols[i]; g.fillText(names[i], q[0] + 10, q[1] + 4);
      g.restore();
    });
  });
  // cada medición en los cortes MPR con su color (cíclico, como en el 3D)
  eventTarget.addEventListener(csTools.Enums.Events.ANNOTATION_ADDED, (evt) => {
    const a = evt.detail && evt.detail.annotation; if (!a || !a.annotationUID) return;
    const tn = a.metadata && a.metadata.toolName;
    if (tn !== csTools.LengthTool.toolName && tn !== csTools.AngleTool.toolName) return;
    try { const st = csTools.annotation.config.style.getAnnotationToolStyles(a.annotationUID); if (st && st.color) return; } catch (e) { /* nada */ }   // rehecha: conserva su color
    const col = MEAS_COLORS[state.mprMeasures++ % MEAS_COLORS.length];
    try { csTools.annotation.config.style.setAnnotationStyles(a.annotationUID, { color: col, colorHighlighted: col, colorSelected: col, colorLocked: col, textBoxColor: col, textBoxColorHighlighted: col, textBoxColorSelected: col, textBoxColorLocked: col }); } catch (e) { /* nada */ }
  });

  // al completar una medición en un MPR se avisa a la interfaz (el modo SIGUE activo para encadenar) y se
  // apunta para deshacer (quitar / volver a poner la anotación)
  eventTarget.addEventListener(csTools.Enums.Events.ANNOTATION_COMPLETED, (evt) => {
    const a = evt.detail && evt.detail.annotation;
    const tn = a && a.metadata && a.metadata.toolName;
    if (a && (tn === csTools.LengthTool.toolName || tn === csTools.AngleTool.toolName)) {
      const el = elements[viewportOfAnnotation(a)] || null;
      history.record({ label: 'measure', undo: () => removeAnnotations([a]), redo: () => addAnnotations([[a, el]]) });
    }
    if (state.measureMode && state.onMeasureDone) state.onMeasureDone();
  });
  // El zoom del visor 3D acerca la cámara. Con los planos de recorte (cercano/lejano) fijos, al acercarse
  // el plano CERCANO se mete dentro del modelo y este aparece CORTADO (se ve el interior), sobre todo con
  // el volumen oculto y solo mallas — que es justo lo que pasa al alinear por puntos. Tras cada cambio de
  // cámara se recalculan los planos con los límites reales de lo que hay en escena.
  let clipRaf = 0;
  const clipSoon = () => { if (clipRaf) return; clipRaf = requestAnimationFrame(() => { clipRaf = 0; fixClipRange(); }); };
  // también tras cada pintado: `resetCamera` y el alta de actores de Cornerstone vuelven a estrechar el
  // rango por su cuenta después de que lo arreglemos. `fixClipRange` no hace nada si ya está bien, así que
  // esto converge en un fotograma y no se realimenta.
  els[VP.v3d].addEventListener(Enums.Events.CAMERA_MODIFIED, clipSoon);
  els[VP.v3d].addEventListener(Enums.Events.IMAGE_RENDERED, clipSoon);
  // información de corte / ventana en cada MPR
  for (const id of MPR_IDS) {
    const el = els[id];
    el.addEventListener(Events.VOLUME_NEW_IMAGE, () => updateInfo(id));
    el.addEventListener(Events.VOI_MODIFIED, () => { updateInfo(id); syncMprWindow(id); });
    el.addEventListener(Events.IMAGE_RENDERED, () => updateInfo(id));
  }
  state.ready = true;
  return engine;
}

/**
 * Juego de luces como el LightKit de VTK (el que usa PyVista en VOXEL): luz principal arriba-delante, luz de
 * relleno abajo, luz frontal (headlight) débil y dos luces traseras. Con un solo foco (por defecto en vtk.js)
 * el volumen sale muy contrastado: caras oscuras y brillos duros. Todas van ligadas a la cámara.
 */
let lightScale = 0.55;   // el mapper de vtk.js SUMA las luces: con el 0,75 de VTK queda sobreexpuesto
export function tuneLights(scale) { lightScale = scale; const vp = state.engine && state.engine.getViewport(VP.v3d); if (vp) { setupLights(vp); vp.render(); } }
function setupLights(vp) {
  try {
    const ren = vp.getRenderer();
    ren.removeAllLights();
    const key = lightScale, fill = key / 3, head = key / 3, back = key / 3.5;
    const add = (intensity, elevation, azimuth) => {
      const l = vtkLight.newInstance({ intensity, lightType: 'CameraLight', color: [1, 1, 1] });
      l.setDirectionAngle(elevation, azimuth);
      ren.addLight(l);
    };
    add(key, 50, 10); add(fill, -75, -10); add(head, 0, 0); add(back, 0, 110); add(back, 0, -110);
    ren.setTwoSidedLighting(true);
    ren.setAutomaticLightCreation(false);
  } catch (e) { console.warn('luces', e); }
}

/**
 * Recalcula los planos de recorte del visor 3D con los límites de TODO lo visible (volumen + mallas) y
 * deja un margen generoso por delante y por detrás, para que ni el zoom ni el giro corten el modelo.
 */
function fixClipRange() {
  try {
    const vp = state.engine && state.engine.getViewport(VP.v3d);
    const ren = vp && vp.getRenderer();
    if (!ren) return;
    const cam = ren.getActiveCamera();
    const b = ren.computeVisiblePropBounds();
    if (!b || !(b[1] >= b[0])) return;
    // extensión REAL de la escena a lo largo del eje de visión (las 8 esquinas de la caja proyectadas)
    const p = cam.getPosition(), n = cam.getDirectionOfProjection();
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 8; i++) {
      const c = [b[i & 1], b[2 + ((i >> 1) & 1)], b[4 + ((i >> 2) & 1)]];
      const d = (c[0] - p[0]) * n[0] + (c[1] - p[1]) * n[1] + (c[2] - p[2]) * n[2];
      if (d < lo) lo = d; if (d > hi) hi = d;
    }
    const m = Math.max(2, 0.15 * (hi - lo));                 // margen, para que el giro no lo corte
    const cur = cam.getClippingRange();
    if (cur && cur[0] <= lo && cur[1] >= hi) return;          // ya cabe entero: no se toca (evita rebotes)
    cam.setClippingRange(lo - m, hi + m);
    vp.render();
  } catch (e) { /* nada */ }
}

function viewerBg() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg-rgb').trim();
  const p = v.split(',').map((x) => parseFloat(x));
  return p.length === 3 && p.every(Number.isFinite) ? p : [0.043, 0.059, 0.102];
}

/** Cambia el color de fondo de los 4 visores al cambiar de tema. */
export function applyThemeBackground() {
  if (!state.engine) return;
  const bg = viewerBg();
  for (const id of Object.values(VP)) {
    const vp = state.engine.getViewport(id);
    if (!vp) continue;
    try { vp.getRenderer().setBackground(...bg); } catch (e) { /* nada */ }
    // el visor 3D con Cornerstone también soporta setOptions? se usa el renderer directo
  }
  state.engine.render();
}

function status(msg) { if (state.onStatus) state.onStatus(msg); }

// La ventana (brillo/contraste) que el usuario ajusta arrastrando en un MPR se copia a los otros
// dos cortes y a los planos MPR del 3D (una sola ventana para todos, como en VOXEL).
let syncing = false, syncTimer = null;
function syncMprWindow(fromId) {
  if (syncing || !state.volume) return;
  try {
    const p = state.engine.getViewport(fromId).getProperties();
    if (!p || !p.voiRange) return;
    const r = p.voiRange;
    if (Math.abs(r.lower - state.mprWindow.lower) < 0.5 && Math.abs(r.upper - state.mprWindow.upper) < 0.5) return;
    state.mprWindow = { lower: r.lower, upper: r.upper };
    syncing = true;
    for (const id of MPR_IDS) if (id !== fromId) { const vp = state.engine.getViewport(id); vp.setProperties({ voiRange: { ...state.mprWindow } }); vp.render(); }
    syncing = false;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => mprPlanes.setWindow(state.mprWindow), 150);
  } catch (e) { syncing = false; }
}

const infoTimers = {};
function updateInfo(id) {
  if (!state.onViewportInfo || !state.engine) return;
  clearTimeout(infoTimers[id]);
  infoTimers[id] = setTimeout(() => {
    const vp = state.engine.getViewport(id);
    if (!vp || !state.volume) return;
    try {
      const i = vp.getSliceIndex(), n = vp.getNumberOfSlices();
      const p = vp.getProperties();
      const r = p && p.voiRange ? p.voiRange : state.mprWindow;
      const w = Math.round(r.upper - r.lower), l = Math.round((r.upper + r.lower) / 2);
      state.onViewportInfo(id, { slice: i + 1, n, window: w, level: l });
    } catch (e) { /* visor sin volumen */ }
  }, 30);
}

// ------------------------------------------------------------------ carga de una serie
export async function loadSeries(series, onProgress) {
  const engine = state.engine;
  await removeVolume();
  // ¿hay un BLOQUE de cortes fuera de sitio? (la parte alta del cráneo saliendo suelta por debajo)
  await repairRotation(series);
  // VOLUMEN GRANDE (no cabe en la GPU / RAM): volumen reducido por bloques f×f×f (ver bigVolume.js)
  const f = series.multiframe ? 1 : decimationFactor(series);
  series.decimation = f;
  if (f > 1) {
    const { volumeId } = await buildDecimatedVolume(series, f, (p) => { if (onProgress) onProgress(p); });
    state.volume = cache.getVolume(volumeId); state.volumeId = volumeId; state.series = series;
    return finishLoad(series, onProgress);
  }
  // imageIds locales (dicomfile:N); multiframe -> un imageId por frame
  const imageIds = [];
  const baseIds = [];
  for (const f of series.files) {
    const id = wadouri.fileManager.add(f.file);
    baseIds.push(id);
    if (f.frames > 1) for (let k = 1; k <= f.frames; k++) imageIds.push(id + '?frame=' + k);   // frame= es 1-based
    else imageIds.push(id);
  }
  // PRIMING de metadatos: el proveedor de metadatos de Cornerstone 5 (naturalizado) solo conoce un
  // archivo cuando se le ha entregado su contenido (addDicomPart10Instance). Hay que hacerlo con
  // TODOS los cortes ANTES de crear el volumen (necesita posición/orientación/spacing de cada uno).
  for (let i = 0; i < baseIds.length; i += 8) {
    await Promise.all(baseIds.slice(i, i + 8).map(async (id) => {
      const buf = await wadouri.loadFileRequest(id);
      await prefetchPart10Instance(id, buf);
    }));
    if (onProgress) onProgress(Math.round((20 * Math.min(baseIds.length, i + 8)) / baseIds.length));
  }
  state.rotProvider = installRotationProvider(series, baseIds);
  const volumeId = 'cornerstoneStreamingImageVolume:' + Date.now();
  const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds });
  state.volume = volume; state.volumeId = volumeId; state.series = series;

  await new Promise((resolve, reject) => {
    let done = false;
    const total = imageIds.length;
    const onImg = (evt) => {
      const d = evt.detail || {};
      if (d.volumeId && d.volumeId !== volumeId) return;
      if (onProgress) onProgress(20 + Math.min(79, Math.round(80 * (volume.framesLoaded ?? 0) / total)));
    };
    eventTarget.addEventListener(Events.IMAGE_LOADED, onImg);
    const finish = (err) => {
      if (done) return; done = true;
      eventTarget.removeEventListener(Events.IMAGE_LOADED, onImg);
      err ? reject(err) : resolve();
    };
    try {
      volume.load((evt) => { if (evt && evt.framesProcessed === evt.totalNumFrames) finish(); });
    } catch (e) { finish(e); }
    // respaldo: si el callback no llega, comprobar cada segundo
    const iv = setInterval(() => {
      if (done) { clearInterval(iv); return; }
      if (volume.loadStatus && volume.loadStatus.loaded) { clearInterval(iv); finish(); }
    }, 1000);
  });
  if (onProgress) onProgress(100);
  return finishLoad(series, onProgress);
}

/** Parte común tras tener el volumen en caché: estadísticas, ventanas, visores y cámara. */
async function finishLoad(series, onProgress) {
  const engine = state.engine;
  const volume = state.volume, volumeId = state.volumeId;
  // estadística robusta de HU para ventanas (percentiles, como VOXEL). Se MUESTREA por el
  // VoxelManager (Cornerstone guarda los cortes por separado): sin copiar el volumen entero.
  state.geometry = enforceGeometry(volume, series);
  state.sorted = sampleVolume(volume);
  state.range = state.sorted ? [state.sorted[0], state.sorted[state.sorted.length - 1]] : [-1000, 3000];   // rango REAL para los deslizadores
  const [lo, hi] = state.sorted ? windowFor(state.sorted, state.render.preset) : [300, 2200];
  state.render.lo = lo; state.render.hi = hi; state.render.opacity = 1.0; state.render.visible = true;
  state.render.unitDistance = Math.min(...volume.spacing);

  // MPR: ventana del DICOM si viene; si no, hueso 400/2000 como VOXEL
  const wc = series.wc, ww = series.ww;
  state.mprWindow = (Number.isFinite(wc) && Number.isFinite(ww) && ww > 1)
    ? { lower: wc - ww / 2, upper: wc + ww / 2 } : { lower: -600, upper: 1400 };

  await setVolumesForViewports(engine, [{ volumeId }], MPR_IDS);
  // visor 3D: copia SUAVIZADA y acotada (≤ 400 vóx/eje), como RENDER_MAX_DIM de VOXEL: sin grano y fluida
  let renderId = volumeId;
  try {
    const rv = await buildRenderVolume(volume, sliceGetter(), (p) => { if (onProgress) onProgress(100); status(`Preparando el render 3D (${p} %)…`); });
    if (rv) { state.renderVolumeId = rv.volumeId; renderId = rv.volumeId; state.render.unitDistance = Math.min(...rv.spacing); }
  } catch (e) { console.warn('volumen de render', e); }
  await setVolumesForViewports(engine, [{ volumeId: renderId }], [VP.v3d]);
  setupLights(engine.getViewport(VP.v3d));
  meshes.reattach();                 // setVolumes quita TODOS los actores del visor 3D: volver a colgar las mallas
  for (const id of MPR_IDS) {
    const vp = engine.getViewport(id);
    vp.setProperties({ voiRange: { ...state.mprWindow } });
    vp.resetCamera();
  }
  applyRender();
  const v3 = engine.getViewport(VP.v3d);
  setView('frontal');
  v3.resetCamera();
  engine.render();
  measure3d.attach(elements[VP.v3d]);
  measure3d.redraw();                 // mediciones hechas sobre escáneres antes de cargar el CBCT
  for (const id of MPR_IDS) updateInfo(id);
  silhouettes.redrawAll();
  state.pano = null;
  if (state.crosshairs) { applyMprBindings(); resetCrosshairs(); }
  history.clear();                    // cargar el DICOM no se deshace
  return volume;
}

/**
 * GUARDA DE GEOMETRÍA (v0.7.0). Cornerstone deduce el tamaño del vóxel del volumen a partir de los metadatos
 * de los cortes: el espaciado dentro del corte de PixelSpacing y el de ENTRE cortes repartiendo la distancia
 * del primero al último entre el número de cortes. En series reales eso se va: si faltan cortes, si hay cortes
 * REPETIDOS en la misma posición, o si la serie mezcla dos reconstrucciones, el espaciado entre cortes sale
 * mayor (volumen ESTIRADO a lo alto) o menor (aplastado), y se ve en los cortes coronal / sagital y en el 3D.
 * Aquí se compara con lo que dicen las cabeceras (PixelSpacing y la MEDIANA del salto entre cortes
 * consecutivos, dicomLoad.js) y, si hay más de un 2 % de diferencia, se corrige el vóxel del volumen.
 * Devuelve { fixed, from, to, series } para avisar en la barra de estado.
 */
function enforceGeometry(volume, series) {
  const out = { fixed: false };
  try {
    const f = series.decimation || 1;
    const sp = series.spacing || [];
    const want = [(sp[1] || sp[0] || 0) * f, (sp[0] || sp[1] || 0) * f, (series.dz || 0) * f];
    const got = Array.from(volume.spacing || []);
    out.from = got.slice(); out.to = want.slice();
    const sane = (v) => Number.isFinite(v) && v > 0.01 && v < 10;
    // el espaciado DENTRO del corte (PixelSpacing) siempre es fiable; el de ENTRE cortes solo se corrige si la
    // mediana de los saltos es sólida (la mayoría de los cortes a esa distancia; dicomLoad.js)
    const trust = (q) => (q < 2 ? true : !!series.dzOk);
    const off = [0, 1, 2].filter((q) => trust(q) && sane(want[q]) && sane(got[q]) && Math.abs(want[q] - got[q]) / want[q] > 0.02);
    console.log(`tresD geometría: vóxel del volumen ${got.map((v) => v.toFixed(3)).join(' × ')} mm · cabeceras ${want.map((v) => v.toFixed(3)).join(' × ')} mm`
      + (series.dzSpan ? ` · salto entre cortes: mediana ${series.dz.toFixed(3)} / medio ${series.dzSpan.toFixed(3)} (mín ${series.dzMin.toFixed(3)}, máx ${series.dzMax.toFixed(3)}, ${series.dupes || 0} repetidos, ${series.gaps || 0} huecos)` : ''));
    if (!off.length) return out;
    const fix = [0, 1, 2].map((q) => (off.includes(q) ? want[q] : got[q]));
    volume.imageData.setSpacing(fix[0], fix[1], fix[2]);
    volume.imageData.modified();
    try { volume.spacing = fix; } catch (e) { /* solo lectura en alguna versión */ }
    out.fixed = true; out.to = fix;
    console.warn('tresD geometría CORREGIDA:', got.join(' × '), '→', fix.join(' × '), 'mm');
  } catch (e) { console.warn('geometría', e); }
  return out;
}

// ---------------------------------------------- bloque de cortes fuera de sitio ("vuelta al principio")
// dicomLoad.rotationByInstance() SOSPECHA (por el número de instancia) que la serie está girada: un
// bloque de cortes contiguo, con la posición desplazada un recorrido entero, se ha colocado al principio
// del volumen. Aquí se CONFIRMA mirando los píxeles y, si procede, se reparan las posiciones.
const ROT_GRID = 24;

/** Miniatura media de un corte (ROT_GRID × ROT_GRID) para comparar cortes entre sí. */
function coarseSlice(image) {
  const px = image.getPixelData(), w = image.columns, h = image.rows;
  const out = new Float32Array(ROT_GRID * ROT_GRID);
  const bw = w / ROT_GRID, bh = h / ROT_GRID;
  for (let gy = 0; gy < ROT_GRID; gy++) {
    const y0 = Math.floor(gy * bh), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * bh));
    for (let gx = 0; gx < ROT_GRID; gx++) {
      const x0 = Math.floor(gx * bw), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * bw));
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) { const row = y * w; for (let x = x0; x < x1; x++) { s += px[row + x]; n++; } }
      out[gy * ROT_GRID + gx] = n ? s / n : 0;
    }
  }
  return out;
}
/** Diferencia entre dos miniaturas, normalizada por su propio contraste (0 = idénticas). */
function coarseDiff(a, b) {
  let dif = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    dif += Math.abs(a[i] - b[i]);
    if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i];
    if (b[i] < lo) lo = b[i]; if (b[i] > hi) hi = b[i];
  }
  const rng = Math.max(1, hi - lo);
  return dif / a.length / rng;
}

/**
 * Confirma la sospecha con los píxeles: en una serie GIRADA por la costura k, los cortes k-1 y k son
 * dos trozos de anatomía que no tienen nada que ver (hay un salto enorme), mientras que el último y el
 * primero SÍ encajan (son vecinos de verdad). En una serie sana pasa justo lo contrario.
 * Recibe los 4 cortes implicados [antes de la costura, después, último, primero].
 * Devuelve { ok, seam, ends } (solo 4 cortes decodificados).
 */
async function confirmRotation(ids) {
  const imgs = [];
  for (const id of ids) imgs.push(coarseSlice(await imageLoader.loadAndCacheImage(id)));
  const seam = coarseDiff(imgs[0], imgs[1]);      // costura sospechosa
  const ends = coarseDiff(imgs[2], imgs[3]);      // unión que quedaría al girar
  return { ok: seam > 3 * ends && seam > 0.01, seam, ends };
}

/**
 * Comprueba y repara el orden de una serie ANTES de construir el volumen. Devuelve el nº de cortes
 * movidos (0 si no había nada que reparar). Deja `series.files` en el orden bueno y apunta en
 * `series.rotTail` / `series.rotShift` cuánto hay que desplazar la cola para que el volumen salga seguido.
 */
async function repairRotation(series) {
  series.rotTail = 0;
  const k = series.rot;
  if (!k || series.multiframe || !series.normal) return 0;
  const probes = [k - 1, k, series.files.length - 1, 0].map((i) => wadouri.fileManager.add(series.files[i].file));
  let ok = null;
  try {
    for (const id of probes) await prefetchPart10Instance(id, await wadouri.loadFileRequest(id));
    ok = await confirmRotation(probes);                          // [k-1, k, último, primero]
  } catch (e) { console.warn('tresD orden: no se pudo comprobar', e); return 0; }
  if (!ok.ok) {
    console.log(`tresD orden: los números de instancia sugerían un bloque movido en el corte ${k}, pero los píxeles dicen que no (costura ${ok.seam.toFixed(3)} vs extremos ${ok.ends.toFixed(3)}): no se toca`);
    return 0;
  }
  const nrm = series.normal, n = series.files.length;
  const posOf = (f) => f.ipp[0] * nrm[0] + f.ipp[1] * nrm[1] + f.ipp[2] * nrm[2];
  const dz = series.dz || Math.abs(posOf(series.files[1]) - posOf(series.files[0])) || 1;
  series.rotShift = posOf(series.files[n - 1]) + dz - posOf(series.files[0]);   // el bloque de cabeza se va al final
  series.files = series.files.slice(k).concat(series.files.slice(0, k));
  series.rotTail = k;
  console.warn(`tresD orden CORREGIDO: ${k} cortes estaban colocados al principio del volumen (costura ${ok.seam.toFixed(3)} vs extremos ${ok.ends.toFixed(3)}); se desplazan ${series.rotShift.toFixed(1)} mm al final`);
  return k;
}

/**
 * Cornerstone reordena los cortes por su ImagePositionPatient, así que reordenar el array no basta:
 * hay que darle la posición corregida de los `rotTail` cortes finales con un proveedor de metadatos
 * propio (prioridad alta). Se llama con los metadatos YA cargados.
 */
function installRotationProvider(series, baseIds) {
  const k = series.rotTail;
  if (!k) return null;
  const nrm = series.normal, n = baseIds.length, fixed = new Map();
  for (let i = n - k; i < n; i++) {
    const p = csMetaData.get('imagePlaneModule', baseIds[i]);
    if (!p || !p.imagePositionPatient) return null;
    const ipp = p.imagePositionPatient, s = series.rotShift;
    fixed.set(baseIds[i], { ...p, imagePositionPatient: [ipp[0] + nrm[0] * s, ipp[1] + nrm[1] * s, ipp[2] + nrm[2] * s] });
  }
  const provider = (type, query) => (type === 'imagePlaneModule' && typeof query === 'string' ? fixed.get(query.split('?')[0]) : undefined);
  csMetaData.addProvider(provider, 20000);
  return provider;
}

function sampleVolume(volume, target = 600000) {
  try {
    const vm = volume.voxelManager;
    const n = vm.getScalarDataLength ? vm.getScalarDataLength() : volume.numVoxels;
    const stride = Math.max(1, Math.floor(n / target));
    const m = Math.floor(n / stride);
    const out = new Float32Array(m);
    for (let i = 0, j = 0; j < m; i += stride, j++) out[j] = vm.getAtIndex(i);
    return out.sort();
  } catch (e) {
    try { return sampleSorted(volume.imageData.getPointData().getScalars().getData()); } catch (e2) { return null; }
  }
}

export async function removeVolume() {
  const engine = state.engine;
  // el proveedor de posiciones corregidas (bloque fuera de sitio) es de ESTE caso: fuera siempre
  if (state.rotProvider) { try { csMetaData.removeProvider(state.rotProvider); } catch (e) { /* nada */ } state.rotProvider = null; }
  if (!engine || !state.volume) return;
  try { measure3d.clear(); measure3d.detach(); } catch (e) { /* nada */ }
  try { mprPlanes.clear(); } catch (e) { /* nada */ }
  try { csTools.annotation.state.removeAllAnnotations(); } catch (e) { /* nada */ }
  state.mprMeasures = 0;
  for (const id of Object.values(VP)) {
    try {
      const vp = engine.getViewport(id);
      const actors = vp.getActors();
      if (actors.length) vp.removeActors(actors.map((a) => a.uid));
    } catch (e) { /* nada */ }
  }
  try { cache.removeVolumeLoadObject(state.volumeId); } catch (e) { /* nada */ }
  removeRenderVolume(state.renderVolumeId); state.renderVolumeId = null;
  try { cache.purgeCache(); } catch (e) { /* nada */ }
  try { wadouri.fileManager.purge(); } catch (e) { /* nada */ }
  state.volume = null; state.volumeId = null; state.series = null; state.sorted = null; state.enamel = null; state.teeth = null;
  state.cut = { axis: null, frac: 0.5, flip: false };
  state.pano = null;
  if (state.crosshairs) { state.crosshairs = false; try { applyMprBindings(); } catch (e) { /* nada */ } }
  history.clear();
  meshes.setClip(null);
  if (meshes.items.length) {         // las mallas siguen: volver a colgarlas y a escuchar los clics de medición
    meshes.reattach();
    measure3d.attach(elements[VP.v3d]);
    const v3 = engine.getViewport(VP.v3d);
    try { v3.resetCamera(); } catch (e) { /* nada */ }
  }
  engine.render();
}

// ------------------------------------------------------------------ render 3D
function volumeActor() {
  try {
    const vp = state.engine.getViewport(VP.v3d);
    const a = vp.getActors().find((e) => e.actor && e.actor.isA && e.actor.isA('vtkVolume'));
    return a ? a.actor : null;
  } catch (e) { return null; }
}

export function applyRender() {
  const actor = volumeActor();
  if (!actor) return;
  applyState(actor, state.render);
  actor.setVisibility(!!state.render.visible);
  state.engine.getViewport(VP.v3d).render();
}

export function setPreset(preset) {
  state.render.preset = preset;
  if (state.sorted) { const [lo, hi] = windowFor(state.sorted, preset); state.render.lo = lo; state.render.hi = hi; }
  applyRender();
  return { level: (state.render.lo + state.render.hi) / 2, window: state.render.hi - state.render.lo };
}

/** Brillo = nivel (centro) de la ventana del preset; Contraste = ancho. */
export function setRenderWindow({ level, window }) {
  const cur = { level: (state.render.lo + state.render.hi) / 2, window: state.render.hi - state.render.lo };
  const l = level ?? cur.level, w = Math.max(20, window ?? cur.window);
  state.render.lo = l - w / 2; state.render.hi = l + w / 2;
  applyRender();
}

/** Ajuste fino del render (experimentos): tune({shade:[a,d,s,p], grad:[min,minOp,max,maxOp], normalFromOpacity}) */
export function tune(obj) { state.render.tune = obj || null; applyRender(); }

export function setOpacity(frac) { state.render.opacity = Math.max(0.02, Math.min(1, frac)); applyRender(); }
export function setVolumeVisible(on) { state.render.visible = !!on; applyRender(); }

// ------------------------------------------------------------------ cámara
export function setView(name) {
  const v = VIEWS[name];
  const vp = state.engine && state.engine.getViewport(VP.v3d);
  if (!v || !vp) return;
  const cam = vp.getCamera();
  const fp = cam.focalPoint || [0, 0, 0];
  const dist = cam.position ? Math.hypot(cam.position[0] - fp[0], cam.position[1] - fp[1], cam.position[2] - fp[2]) : 500;
  vp.setCamera({
    focalPoint: fp, viewUp: v.up, viewPlaneNormal: v.n,
    position: [fp[0] + v.n[0] * dist, fp[1] + v.n[1] * dist, fp[2] + v.n[2] * dist],
  });
  vp.resetCamera({ resetPan: true, resetZoom: true, resetToCenter: true });
  vp.render();
}

/** Encuadra el visor 3D sobre lo que está VISIBLE y recalcula los planos de recorte. */
export function reset3D() {
  try {
    const vp = state.engine.getViewport(VP.v3d);
    vp.resetCamera(); fixClipRange(); vp.render();
    // `resetCamera` de Cornerstone vuelve a estrechar el rango de recorte después de que lo arreglemos:
    // se repasa en el siguiente fotograma (si no, el modelo entra ya cortado al alinear por puntos)
    requestAnimationFrame(() => fixClipRange());
  } catch (e) { /* nada */ }
}

export function centerAll() {
  for (const id of Object.values(VP)) { try { state.engine.getViewport(id).resetCamera(); } catch (e) { /* nada */ } }
  state.engine.render();
}

export function rotateStep(deg = 1) {
  const vp = state.engine && state.engine.getViewport(VP.v3d);
  if (!vp || !hasCase()) return;
  const cam = vp.getCamera();
  const fp = cam.focalPoint, up = cam.viewUp, pos = cam.position;
  const a = (deg * Math.PI) / 180;
  const v = [pos[0] - fp[0], pos[1] - fp[1], pos[2] - fp[2]];
  const r = rotateAround(v, up, a);
  const n = rotateAround(cam.viewPlaneNormal, up, a);
  vp.setCamera({ position: [fp[0] + r[0], fp[1] + r[1], fp[2] + r[2]], viewPlaneNormal: n, focalPoint: fp, viewUp: up });
  vp.render();
}

function rotateAround(v, k, a) {           // Rodrigues
  const c = Math.cos(a), s = Math.sin(a);
  const kn = Math.hypot(...k) || 1; const u = [k[0] / kn, k[1] / kn, k[2] / kn];
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return [v[0] * c + cr[0] * s + u[0] * dot * (1 - c), v[1] * c + cr[1] * s + u[1] * dot * (1 - c), v[2] * c + cr[2] * s + u[2] * dot * (1 - c)];
}

// ------------------------------------------------------------------ corte por plano (set_volume_clip)
export function setCut({ axis, frac, flip }) {
  state.cut = { axis, frac: frac ?? state.cut.frac, flip: !!flip };
  const actor = volumeActor();
  const b = sceneBounds();
  if (!b) return;
  const mapper = actor ? actor.getMapper() : null;
  if (mapper) mapper.removeAllClippingPlanes();
  measure3d.setClip(null);
  let clip = null;
  if (axis) {
    const ai = { x: 0, y: 1, z: 2 }[axis];
    const lo = b[2 * ai], hi = b[2 * ai + 1];
    const cut = lo + Math.max(0, Math.min(1, state.cut.frac)) * (hi - lo);
    const origin = [0, 0, 0]; origin[ai] = cut;
    const normal = [0, 0, 0]; normal[ai] = state.cut.flip ? -1 : 1;
    if (mapper) mapper.addClippingPlane(vtkPlane.newInstance({ origin, normal }));
    clip = { ai, cut, flip: state.cut.flip };
    measure3d.setClip(clip);
  }
  meshes.setClip(clip);              // el mismo plano recorta también los escáneres
  state.engine.getViewport(VP.v3d).render();
}

// ------------------------------------------------------------------ escáneres intraorales (Fase 2)
/**
 * Lee un STL/PLY/OBJ y lo cuelga en el 3D. opts: { role:'upper'|'lower'|'other', autoOrient, scale }.
 * Si hay CBCT, la malla orientada se coloca en el centro del volumen (sin registro; solo para verla junta).
 * Devuelve el item (id, name, role, nTri, info de orientación, warnings de lectura).
 */
export async function addMesh(fileOrMesh, opts = {}) {
  const mesh = fileOrMesh.pts ? fileOrMesh : await readMesh(fileOrMesh);
  const hadCase = hasCase();
  let target = [0, 0, 0];
  if (state.volume) { const b = state.volume.imageData.getBounds(); target = [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2]; }
  // para deshacer: la llegada de una arcada puede mover a las que ya estaban (misma oclusión)
  const before = meshes.items.filter((m) => !m.seg).map((m) => meshes.snapshot(m.id));
  const item = meshes.add(mesh, { ...opts, target });
  item.warnings = mesh.warnings;
  const wasBusy = history.busy; history.busy = true;    // las alineaciones internas no se apuntan aparte
  try { await addMeshInner(item, opts, target, hadCase); } finally { history.busy = wasBusy; }
  const after = meshes.items.filter((m) => !m.seg && m.id !== item.id).map((m) => meshes.snapshot(m.id));
  history.record({
    label: 'mesh_add', name: item.name,
    undo: () => { detachMesh(item.id); for (const s of before) meshes.restore(s); afterMeshChange(); },
    redo: () => { meshes.reinsert(item); for (const s of after) meshes.restore(s); afterMeshChange(); },
  });
  return item;
}

async function addMeshInner(item, opts, target, hadCase) {
  const v3 = state.engine.getViewport(VP.v3d);
  measure3d.attach(elements[VP.v3d]);
  if (state.cut.axis) setCut(state.cut);
  if (!state.volume) { if (!hadCase) setView('frontal'); v3.resetCamera(); }
  v3.render();
  // con CBCT: alinear a los dientes (VOXEL auto_align_scanner). La arcada SUPERIOR manda: si llega después
  // de la inferior, hereda su giro (misma oclusión) pero se alinea ELLA al CBCT y arrastra a la inferior
  // (mismo grupo). La inferior que llega después de la superior solo la sigue (no se re-alinea).
  if (state.volume && item.oriented && item.info && (!item.info.inherited || item.role === 'upper')) {
    if (item.info.inherited) item.info.master = true;
    try { await alignMesh(item.id, opts.onStatus); } catch (e) { console.warn('alineación', e); item.align = { failed: true }; }
    // La superior heredó la pose de una inferior que quizá quedó MAL alineada (volteada, ladeada): si el encaje
    // es pobre, segundo intento desde la orientación PROPIA del escáner (orient.js) y se queda el mejor.
    if (item.info.inherited && (!item.align || item.align.err == null || item.align.err > 0.8)) {
      const group = meshes.items.filter((m) => m.group === item.group);
      const snaps = group.map((m) => meshes.snapshot(m.id));
      const infoPrev = item.info;
      try {
        const own = ownFrameTransform(item, target);
        if (own) {
          for (const m of group) meshes.transform(m.id, own.T);
          item.info = { ...own.info, inherited: false, master: true, reoriented: true, from: infoPrev.from };   // ya con orientación propia
          const before = item.align && item.align.err != null ? item.align.err : Infinity;
          const a2 = await alignMesh(item.id, opts.onStatus);
          if (!(a2 && a2.err != null && a2.err < before)) { for (const sn of snaps) meshes.restore(sn); item.info = infoPrev; }
        }
      } catch (e) { console.warn('reorientación', e); for (const sn of snaps) meshes.restore(sn); item.info = infoPrev; }
      if (state.cut.axis) setCut(state.cut);
      state.engine.getViewport(VP.v3d).render();
    }
  }
  silhouettes.redrawAll();
  return item;
}

/** Transformación (mundo→mundo) que lleva la malla de su pose actual a su orientación PROPIA (orient.js) colocada en `target`. */
function ownFrameTransform(item, target) {
  if (!item.M) return null;
  const Mi = invRigid(item.M);
  const orig = new Float32Array(item.pts.length);
  for (let i = 0; i < orig.length; i += 3) { const x = item.pts[i], y = item.pts[i + 1], z = item.pts[i + 2]; orig[i] = Mi[0] * x + Mi[1] * y + Mi[2] * z + Mi[3]; orig[i + 1] = Mi[4] * x + Mi[5] * y + Mi[6] * z + Mi[7]; orig[i + 2] = Mi[8] * x + Mi[9] * y + Mi[10] * z + Mi[11]; }
  const r = patientFrame(orig, item.polys, item.role === 'lower' ? 'lower' : 'upper');
  const M2 = r.M.slice(); M2[3] += target[0]; M2[7] += target[1]; M2[11] += target[2];
  return { T: mul4(M2, Mi), info: r.info };
}
function invRigid(M) {
  const R = [M[0], M[4], M[8], M[1], M[5], M[9], M[2], M[6], M[10]];          // R^T
  const t = [M[3], M[7], M[11]];
  return [R[0], R[1], R[2], -(R[0] * t[0] + R[1] * t[1] + R[2] * t[2]), R[3], R[4], R[5], -(R[3] * t[0] + R[4] * t[1] + R[5] * t[2]), R[6], R[7], R[8], -(R[6] * t[0] + R[7] * t[1] + R[8] * t[2]), 0, 0, 0, 1];
}
function mul4(A, B) { const C = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) C[4 * i + j] += A[4 * i + k] * B[4 * k + j]; return C; }

// ------------------------------------------------------------------ alineación escáner → CBCT
/** Lector de cortes (HU) por índice k: volumen local (array entero) o streaming (píxeles de cada imagen en caché). */
function sliceGetter() {
  const vol = state.volume; const vm = vol.voxelManager;
  const [nx, ny] = vol.imageData.getDimensions(); const frame = nx * ny;
  return (k) => {
    if (vm.scalarData) return vm.scalarData.subarray(k * frame, (k + 1) * frame);
    try { const id = vol.imageIds && vol.imageIds[k]; const im = id && cache.getImage(id); const v = im && im.voxelManager; const a = v ? (v.scalarData || v.getScalarData()) : null; return a && a.length === frame ? a : vm.getSliceData({ sliceIndex: k, slicePlane: 2 }); } catch (e) { return vm.getSliceData({ sliceIndex: k, slicePlane: 2 }); }
  };
}

async function getEnamel(onStatus) {
  if (state.enamel !== null) return state.enamel;
  state.enamel = (await enamelTargets(state.volume, state.sorted, (p) => onStatus && onStatus('teeth', p), sliceGetter())) || false;
  state.teeth = state.enamel ? pickTargets(state.enamel) : null;
  return state.enamel;
}
const targetOf = (tg, role) => (!tg ? null : role === 'upper' ? tg.upper : role === 'lower' ? tg.lower : tg.all);
/** Destino (superficie dental del CBCT) del arco de la malla, o null si no hay CBCT / dentición detectada. */
export async function teethTarget(role, onStatus) { const raw = await getEnamel(onStatus); return raw ? targetOf(state.teeth, role) : null; }

// ------------------------------------------------------------------ Fase 3: segmentación rápida y foto drapeada
/**
 * Segmentación rápida (hueso + piel) por umbral automático → dos mallas (roles 'skull' y 'soft').
 * names = { skull, soft } (nombres para las tarjetas). onStatus(fase, pct). Devuelve { items, thresholds, f }.
 */
export async function segmentQuick(onStatus, names = {}) {
  if (!state.volume || !state.sorted) return null;
  const prev = meshes.items.filter((m) => m.role === 'skull' || m.role === 'soft').map((m) => detachMesh(m.id));
  afterMeshChange();
  // caja de la DENTICIÓN (de la superficie dental usada para alinear): ahí el hueso se segmenta a resolución fina
  let teethBox = null;
  try {
    const raw = await getEnamel((ph, p) => onStatus && onStatus('teeth', p));
    const all = raw && state.teeth && state.teeth.all;
    if (all && all.n > 500) {
      const b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]; const P = all.pts;
      for (let i = 0; i < P.length; i += 3) for (let q = 0; q < 3; q++) { if (P[i + q] < b[2 * q]) b[2 * q] = P[i + q]; if (P[i + q] > b[2 * q + 1]) b[2 * q + 1] = P[i + q]; }
      // caja de las CORONAS: la franja de esmalte (±12 mm de la línea oclusal) con margen lateral
      const mid = state.teeth.mid;
      teethBox = [b[0] - 4, b[1] + 4, b[2] - 4, b[3] + 4, Math.max(b[4], mid - 13), Math.min(b[5], mid + 13)];
    }
  } catch (e) { console.warn('caja dental', e); }
  const res = await quickSegment(state.volume, state.sorted, sliceGetter(), onStatus, { teethBox, toothThr: state.enamel ? state.enamel.thr : null });
  const items = [];
  for (const role of ['skull', 'soft']) {
    const m = res[role]; if (!m) continue;
    const item = meshes.add({ name: names[role] || role, ext: 'seg', pts: m.pts, polys: m.polys, colors: null, warnings: [] }, { role });
    item.warnings = []; item.seg = true; item.parts = m.parts; item.fine = m.fine || null;
    items.push(item);
  }
  history.record({
    label: 'seg',
    undo: () => { for (const it of items) detachMesh(it.id); for (const it of prev) meshes.reinsert(it); afterMeshChange(); },
    redo: () => { for (const it of prev) detachMesh(it.id); for (const it of items) meshes.reinsert(it); afterMeshChange(); },
  });
  afterMeshChange();
  return { items, thresholds: res.thresholds, f: res.f };
}

export function softMesh() { return meshes.items.find((m) => m.role === 'soft') || null; }

function renderOnce(vp) {
  return new Promise((resolve) => {
    const el = vp.element; let done = false;
    const h = () => { if (done) return; done = true; el.removeEventListener(Events.IMAGE_RENDERED, h); setTimeout(resolve, 30); };
    el.addEventListener(Events.IMAGE_RENDERED, h);
    vp.render();
    setTimeout(h, 5000);
  });
}

/**
 * Render FRONTAL de la piel sola (opaca, sin volumen ni otras mallas) para que MediaPipe la reconozca
 * (VOXEL _detect_face3d). Devuelve { canvas, pick(nx, ny) → [x,y,z]|null, restore() }. Llamar a
 * restore() SIEMPRE (devuelve la escena a como estaba).
 */
export async function skinSnapshot(softId) {
  const vp = state.engine.getViewport(VP.v3d);
  const soft = meshes.get(softId);
  const prev = { vol: state.render.visible, items: meshes.items.map((m) => [m.id, m.visible, m.opacity]), cam: vp.getCamera(), cut: { ...state.cut }, tex: !!soft.texture };
  const va = volumeActor(); if (va) va.setVisibility(false);
  if (state.cut.axis) setCut({ axis: null });
  for (const m of meshes.items) m.actor.setVisibility(m.id === softId);
  soft.actor.getProperty().setOpacity(1);
  if (prev.tex) meshes.setTextureVisible(softId, false);
  setView('frontal');
  await renderOnce(vp);
  const src = vp.getCanvas();
  const canvas = document.createElement('canvas'); canvas.width = src.width; canvas.height = src.height;
  canvas.getContext('2d').drawImage(src, 0, 0);
  const rect = vp.element.getBoundingClientRect();
  const cam = vp.getCamera(); const n = cam.viewPlaneNormal;
  const b = soft.bounds; const diag = Math.hypot(b[1] - b[0], b[3] - b[2], b[5] - b[4]);
  const pick = (nx, ny) => {
    const p = vp.canvasToWorld([nx * rect.width, ny * rect.height]);
    const start = [p[0] + n[0] * diag, p[1] + n[1] * diag, p[2] + n[2] * diag];
    const hit = meshes.pick(start, [-n[0], -n[1], -n[2]], 2 * diag, null, softId);
    return hit ? hit.w : null;
  };
  const restore = () => {
    for (const [id, vis, op] of prev.items) { const m = meshes.get(id); if (m) { m.actor.setVisibility(vis); m.actor.getProperty().setOpacity(op); } }
    if (prev.tex) meshes.setTextureVisible(softId, true);
    if (va) va.setVisibility(!!prev.vol);
    if (prev.cut.axis) setCut(prev.cut);
    try { vp.setCamera(prev.cam); } catch (e) { /* nada */ }
    vp.render();
  };
  return { canvas, pick, restore };
}

/**
 * Drapea la foto (HTMLImageElement cargada) sobre la piel. opts: { onStatus(fase), pairs: {p2, p3} (registro
 * manual: píxeles de la foto ↔ puntos 3D) }. Devuelve { ok, err, n, inliers, painted } o { fail: motivo }.
 */
export async function drapePhoto(image, opts = {}) {
  const soft = softMesh();
  if (!soft) return { fail: 'no_soft' };
  const st = (ph) => { if (opts.onStatus) opts.onStatus(ph); };
  const W = image.naturalWidth || image.width, H = image.naturalHeight || image.height;
  st('photo');
  let lm2 = null;
  try { lm2 = (await detectFace(image)) || (await detectFace(image, 0.3)); } catch (e) { console.warn(e); return { fail: 'mediapipe' }; }
  let p2 = [], p3 = [];
  if (opts.pairs) {
    p2 = opts.pairs.p2; p3 = opts.pairs.p3;
  } else {
    if (!lm2) return { fail: 'no_face_photo' };
    st('render');
    const snap = await skinSnapshot(soft.id);
    let lm3 = null, pts3 = null;
    try {
      st('face3d');
      lm3 = (await detectFace(snap.canvas)) || (await detectFace(snap.canvas, 0.3));   // la piel gris cuesta más (v0.7.14)
      if (lm3) pts3 = lm3.map((p) => snap.pick(p[0], p[1]));
    } finally { snap.restore(); }
    if (!lm3) return { fail: 'no_face_3d', lm2 };
    const nMax = Math.min(468, lm2.length, pts3.length);
    for (let i = 0; i < nMax; i++) if (pts3[i]) { p2.push([lm2[i][0] * W, lm2[i][1] * H]); p3.push(pts3[i]); }
    if (p2.length < 30) return { fail: 'no_face_3d', lm2 };
  }
  st('pose');
  // con pocos puntos (registro manual de 3 clics) la focal no se puede estimar: se fija en 1,2·W (≈ 50 mm)
  const pose = solvePose(p2, p3, W, H, p2.length < 5 ? { f: 1.2 * W } : {});
  if (!pose) return { fail: 'pose' };
  st('texture');
  // zona de la cara que se pinta: caja de los puntos detectados en la foto; sin detección, la de los 3 puntos
  // marcados a mano por proporciones faciales (v0.7.15) o la de los puntos que haya
  const box = lm2 ? faceBoxFrom(lm2, W, H) : (p2.length === 3 ? faceBoxFrom3(p2, W, H) : faceBoxFrom(p2.map((q) => [q[0] / W, q[1] / H]), W, H));
  const atlas = buildAtlas(image, W, H, lm2, box);
  const { uv, painted } = projectUV(soft.pts, meshes.normals(soft.id), pose, W, H, atlas);
  const prev = drapeSnapshot(soft);
  meshes.setTexture(soft.id, atlas.canvas, uv);
  soft.drape = { ok: true, err: pose.err, n: pose.n, inliers: pose.inliers, painted, manual: !!opts.pairs, pose };
  const next = drapeSnapshot(soft);
  history.record({ label: 'photo', undo: () => restoreDrape(soft.id, prev), redo: () => restoreDrape(soft.id, next) });
  state.engine.getViewport(VP.v3d).render();
  return soft.drape;
}

function drapeSnapshot(s) { return s.drape ? { canvas: s.textureCanvas, uv: s.uv, drape: s.drape } : null; }
function restoreDrape(id, snap) {
  const s = meshes.get(id); if (!s) return;
  if (snap) { meshes.setTexture(id, snap.canvas, snap.uv); s.drape = snap.drape; }
  else { meshes.clearTexture(id); s.drape = null; s.textureCanvas = null; s.uv = null; }
  try { state.engine.getViewport(VP.v3d).render(); } catch (e) { /* nada */ }
  if (state.onMeshesChanged) state.onMeshesChanged();
}

export function setDrapeVisible(on) { const s = softMesh(); if (s) { meshes.setTextureVisible(s.id, on); state.engine.getViewport(VP.v3d).render(); } }
export function clearDrape() {
  const s = softMesh(); if (!s || !s.drape) return;
  const prev = drapeSnapshot(s);
  restoreDrape(s.id, null);
  history.record({ label: 'photo_del', undo: () => restoreDrape(s.id, prev), redo: () => restoreDrape(s.id, null) });
}

/** Punto 3D sobre UNA malla concreta bajo una posición del canvas del visor 3D (registro manual, puntos). */
export function pickOnMesh(canvasPos, id) {
  const s = meshes.get(id); if (!s) return null;
  const vp = state.engine.getViewport(VP.v3d);
  const cam = vp.getCamera(); const n = cam.viewPlaneNormal;
  const p = vp.canvasToWorld(canvasPos);
  const b = s.bounds; const diag = Math.hypot(b[1] - b[0], b[3] - b[2], b[5] - b[4]);
  const hit = meshes.pick([p[0] + n[0] * diag, p[1] + n[1] * diag, p[2] + n[2] * diag], [-n[0], -n[1], -n[2]], 2 * diag, null, s.id);
  return hit ? hit.w : null;
}
export function pickOnSoft(canvasPos) { const s = softMesh(); return s ? pickOnMesh(canvasPos, s.id) : null; }
/** Punto 3D sobre la DENTICIÓN del CBCT (rayo que para en el primer vóxel ≥ umbral de diente), ignorando mallas. */
export function pickOnTeeth(canvasPos) {
  if (!state.volume) return null;
  const thr = state.enamel ? state.enamel.thr : opaqueThreshold(state.render);
  return measure3d.pickVolume(canvasPos, thr);
}
export function showMarkers(points, color) { measure3d.setMarkers(points, color); }

/**
 * Alinea la malla `id` a las coronas del CBCT y mueve con la MISMA transformación a sus compañeras
 * de oclusión (mismo grupo). onStatus(fase, i, n). Devuelve { err, cov } | { none: true } | null.
 */
export async function alignMesh(id, onStatus) {
  const it = meshes.get(id);
  if (!it || !state.volume || !state.sorted) return null;
  const t0 = performance.now();
  const raw = await getEnamel(onStatus);
  const t1 = performance.now();
  if (!raw || !state.teeth) { it.align = { none: true }; return it.align; }
  // orientación fiable = la de orient.js con ok; una malla que HEREDÓ el giro de otra (y quizá su alineación
  // dudosa) se busca en las dos familias (arriba/abajo): cuesta medio segundo y evita heredar un volteo
  const sure = it.info ? !!(it.info.ok && !it.info.inherited) : true;
  let tg = state.teeth;
  let r = await alignToTeeth(it.pts, it.role, targetOf(tg, it.role), { sure, onStatus });
  // REINTENTO MUTUO (VOXEL auto_align_scanner): si el encaje es pobre, la dentición detectada pudo ser
  // hueso/metal/peñasco → se re-ancla en el SIGUIENTE cúmulo denso y el ENCAJE del escáner arbitra.
  let tries = 0;
  if (r.err > 1.0) {
    let avoid = tg.anchor;
    for (let t = 0; t < 2 && avoid; t++) {
      const alt = pickTargets(raw, { c: avoid, r: 22 });
      if (!alt || !alt.anchor) break;
      if (onStatus) onStatus('retry', t + 1, 2);
      tries++;
      const r2 = await alignToTeeth(it.pts, it.role, targetOf(alt, it.role), { sure, onStatus });
      if (r2.err < r.err) { r = r2; tg = alt; }
      avoid = alt.anchor;
      if (r.err <= 0.8) break;
    }
    state.teeth = tg;                     // la arcada ELEGIDA queda como destino para el resto
  }
  console.log(`tresD alineación ${it.name}: dentición ${Math.round(t1 - t0)} ms (${raw.edgePts} pts de borde, umbral ${Math.round(raw.thr)} / ancla ${Math.round(raw.thrAnchor)}, ${raw.yielded || 0} ms de esperas) · encaje ${Math.round(performance.now() - t1)} ms (${tries} reintentos) · error ${r.err.toFixed(2)} mm · cobertura ${Math.round(100 * r.cov)} %`);
  applyAlign(it, r.T, { err: r.err, cov: r.cov });
  return it.align;
}

/** Aplica la transformación a la malla y a todo su grupo de oclusión; anota la calidad. */
function applyAlign(it, T, align) {
  const group = meshes.items.filter((m) => m.group === it.group);
  const before = group.map((m) => meshes.snapshot(m.id));
  for (const m of group) { meshes.transform(m.id, T); m.align = { ...align }; }
  it.align = { ...align };
  const after = group.map((m) => meshes.snapshot(m.id));
  history.record({
    label: align.points ? 'points' : 'align', name: it.name,
    undo: () => { for (const s of before) meshes.restore(s); afterMeshChange(); },
    redo: () => { for (const s of after) meshes.restore(s); afterMeshChange(); },
  });
  afterMeshChange();
}

/** Tras mover / añadir / quitar mallas (también al deshacer): corte, mediciones, siluetas y tarjetas. */
function afterMeshChange() {
  if (state.cut.axis) setCut(state.cut);
  measure3d.refresh();
  if (!hasCase()) { measure3d.clear(); measure3d.detach(); state.cut = { axis: null, frac: 0.5, flip: false }; }
  else measure3d.attach(elements[VP.v3d]);
  try { state.engine.getViewport(VP.v3d).render(); } catch (e) { /* nada */ }
  silhouettes.redrawAll();
  if (state.onMeshesChanged) state.onMeshesChanged();
}

/** Quita la malla del visor sin destruirla (deshacer): devuelve el item. */
function detachMesh(id) {
  const it = meshes.detach(id);
  if (it) silhouettes.forget(id);
  return it;
}

/**
 * Alineación POR PUNTOS (VOXEL align_scanner_points): src = puntos marcados sobre el escáner (mundo, pose
 * actual), dst = los mismos puntos marcados sobre la dentición del CBCT (N ≥ 3, mismo orden). Rígido (Horn)
 * → encaje fino contra la superficie dental (si hay). Mantiene la oclusión. Devuelve it.align | null.
 */
export async function alignByPoints(id, src, dst, onStatus) {
  const it = meshes.get(id);
  if (!it || !state.volume || src.length < 3 || dst.length < 3) return null;
  const raw = await getEnamel(onStatus);
  const target = raw ? targetOf(state.teeth, it.role) : null;
  const dstSnap = target ? snapToTarget(dst, target, 3) : dst;
  const T0 = rigidFromPairs(src, dstSnap);
  if (!T0) return null;
  let r = { T: T0, err: null, cov: null };
  if (target) {
    if (onStatus) onStatus('fine');
    const q0 = alignQuality(it.pts, it.role, target, T0);
    const rr = await refineToTeeth(it.pts, it.role, target, T0);
    r = rr.err <= q0.err + 1e-4 ? rr : { T: T0, err: q0.err, cov: q0.cov };   // guardia: el fino nunca empeora
    console.log(`tresD alineación por puntos ${it.name}: rígido ${q0.err.toFixed(2)} mm → fino ${rr.err.toFixed(2)} mm · cobertura ${Math.round(100 * r.cov)} %`);
  }
  applyAlign(it, r.T, { err: r.err, cov: r.cov, points: true });
  return it.align;
}

/** Tras cargar un CBCT con escáneres ya presentes: alinea un representante por grupo de oclusión. */
export async function alignAllMeshes(onStatus) {
  const out = [];
  const done = new Set();
  const order = [...meshes.items].sort((a, b) => (a.role === 'upper' ? -1 : 1) - (b.role === 'upper' ? -1 : 1));
  for (const it of order) {
    if (!it.oriented || done.has(it.group)) continue;
    done.add(it.group);
    try { out.push({ item: it, align: await alignMesh(it.id, onStatus) }); } catch (e) { console.warn('alineación', e); out.push({ item: it, align: { failed: true } }); }
  }
  return out;
}

/** Quita una malla (se puede deshacer). `record=false` para quitar sin apuntar (p. ej. al quitar el DICOM). */
export function removeMesh(id, record = true) {
  const it = detachMesh(id);
  if (!it) return;
  if (record) {
    history.record({
      label: 'mesh_del', name: it.name,
      undo: () => { meshes.reinsert(it); afterMeshChange(); },
      redo: () => { detachMesh(it.id); afterMeshChange(); },
    });
  }
  afterMeshChange();
}
export function setMeshVisible(id, on) { meshes.setVisible(id, on); state.engine.getViewport(VP.v3d).render(); silhouettes.redrawAll(); }
export function setMeshOpacity(id, f) { meshes.setOpacity(id, f); state.engine.getViewport(VP.v3d).render(); }
export function setMeshColor(id, hex) { meshes.setColor(id, hex); state.engine.getViewport(VP.v3d).render(); silhouettes.redrawAll(); }
export function setMeshUseColors(id, on) { meshes.setUseColors(id, on); state.engine.getViewport(VP.v3d).render(); }
export function flipMesh(id) {
  const it = meshes.get(id); if (!it) return;
  meshes.flip(id, 'y');
  history.record({
    label: 'flip', name: it.name,
    undo: () => { meshes.flip(id, 'y'); afterMeshChange(); },
    redo: () => { meshes.flip(id, 'y'); afterMeshChange(); },
  });
  afterMeshChange();
}
/** Siluetas de las mallas sobre los cortes MPR: activar / desactivar. */
export function setSilhouettes(on) { state.silhouettes = !!on; silhouettes.setEnabled(on); }
/** Apagado TEMPORAL de las siluetas (marcando la vía aérea o editando la curva), sin tocar la casilla. */
export function suppressSilhouettes(on) { if (silhouettes) silhouettes.setSuppressed(on); }
export function silhouettesSuppressed() { return !!(silhouettes && silhouettes.suppressed); }

// ------------------------------------------------------------------ planos MPR dentro del 3D
export function setMprPlane(axis, on, frac) {
  if (!state.volume) return;
  mprPlanes.set(axis, on, frac, state.mprWindow);
}

// ------------------------------------------------------------------ mediciones
export function setMeasureMode(mode) {
  state.measureMode = mode;
  applyMprBindings();
  measure3d.setMode(mode);
}

/**
 * Botón IZQUIERDO en los cortes MPR según prioridad: medición activa > cruz de referencia > brillo/contraste.
 * Con la cruz activa, brillo/contraste pasa a Mayús + arrastrar (y la cruz se queda visible pero quieta
 * mientras se mide).
 */
function applyMprBindings() {
  const tgm = csTools.ToolGroupManager.getToolGroup(TG_MPR);
  const L = csTools.LengthTool.toolName, A = csTools.AngleTool.toolName, W = csTools.WindowLevelTool.toolName, X = csTools.CrosshairsTool.toolName;
  const mode = state.measureMode;
  const primary = { bindings: [{ mouseButton: MouseBindings.Primary }] };
  const shiftPrimary = { bindings: [{ mouseButton: MouseBindings.Primary, modifierKey: csTools.Enums.KeyboardBindings.Shift }] };
  // setToolActive SUMA vinculaciones a las que ya tenía la herramienta: hay que vaciarlas antes
  const clear = (n) => tgm.setToolPassive(n, { removeAllBindings: true });
  clear(L); clear(A); clear(W); clear(X);
  if (mode) {
    tgm.setToolActive(mode === 'linear' ? L : A, primary);
    tgm.setToolActive(W, shiftPrimary);
    if (!state.crosshairs) tgm.setToolDisabled(X);
  } else if (state.crosshairs) {
    tgm.setToolActive(X, primary);
    tgm.setToolActive(W, shiftPrimary);
  } else {
    tgm.setToolDisabled(X);
    tgm.setToolActive(W, primary);
  }
  tuneCrosshairs();
  for (const id of MPR_IDS) { try { state.engine.getViewport(id).render(); } catch (e) { /* nada */ } }
}

/** Cruz de referencia en los cortes MPR (CrosshairsTool): activar / desactivar. */
export function setCrosshairs(on) {
  state.crosshairs = !!on && !!state.volume;
  applyMprBindings();
  if (state.crosshairs) resetCrosshairs();
  return state.crosshairs;
}
function resetCrosshairs() {
  try {
    const tgm = csTools.ToolGroupManager.getToolGroup(TG_MPR);
    const tool = tgm.getToolInstance(csTools.CrosshairsTool.toolName);
    if (tool && tool.resetCrosshairs) tool.resetCrosshairs();
  } catch (e) { /* nada */ }
}

/** Mediciones (para pruebas / depuración): las del 3D y los colores de las anotaciones MPR. */
export function getMeasures() {
  let mpr = [];
  try { mpr = csTools.annotation.state.getAllAnnotations().map((a) => ({ tool: a.metadata.toolName, color: (csTools.annotation.config.style.getAnnotationToolStyles(a.annotationUID) || {}).color || null })); } catch (e) { /* nada */ }
  return { v3d: measure3d ? measure3d.measures.map((m) => ({ type: m.type, color: m.color, label: m.label })) : [], mpr, live: !!(measure3d && measure3d.live) };
}

export function clearMeasures() {
  let mpr = [];
  try { mpr = csTools.annotation.state.getAllAnnotations().map((a) => [a, elements[viewportOfAnnotation(a)] || null]); } catch (e) { /* nada */ }
  const v3 = measure3d.measures.slice(), count = state.mprMeasures;
  if (mpr.length || v3.length) {
    history.record({
      label: 'measures_clear',
      undo: () => { addAnnotations(mpr); state.mprMeasures = count; measure3d.setMeasures(v3); state.engine.render(); },
      redo: () => { removeAnnotations(mpr.map((x) => x[0])); state.mprMeasures = 0; measure3d.setMeasures([]); state.engine.render(); },
    });
  }
  try { csTools.annotation.state.removeAllAnnotations(); } catch (e) { /* nada */ }
  state.mprMeasures = 0;
  measure3d.clear();
  state.engine.render();
}

/** Visor (id) al que pertenece una anotación MPR: por la normal del plano de su metadato. */
function viewportOfAnnotation(a) {
  const n = a && a.metadata && a.metadata.viewPlaneNormal;
  if (!n) return VP.ax;
  let axis = 0; for (let q = 1; q < 3; q++) if (Math.abs(n[q]) > Math.abs(n[axis])) axis = q;
  return [VP.sag, VP.cor, VP.ax][axis];
}
function removeAnnotations(list) {
  for (const a of list) { try { csTools.annotation.state.removeAnnotation(a.annotationUID); } catch (e) { /* nada */ } }
  try { state.engine.render(); } catch (e) { /* nada */ }
}
function addAnnotations(pairs) {
  for (const [a, el] of pairs) {
    try { if (!csTools.annotation.state.getAnnotation(a.annotationUID)) csTools.annotation.state.addAnnotation(a, el || elements[VP.ax]); } catch (e) { console.warn('anotación', e); }
  }
  try { state.engine.render(); } catch (e) { /* nada */ }
}

// ------------------------------------------------------------------ disposición / captura
export function resize() {
  if (!state.engine) return;
  try { state.engine.resize(true, false); } catch (e) { /* nada */ }
  tuneCrosshairs();
  measure3d && measure3d.refresh();
  silhouettes && silhouettes.redrawAll();
}

/**
 * Tamaño de la CRUZ según el tamaño del visor (v0.7.4). Cornerstone dibuja los mangos y el hueco central en
 * PÍXELES FIJOS, así que en las disposiciones con visores pequeños («3D + cortes», «en fila») salían enormes.
 * Se recalcula con el lado menor de los cortes MPR visibles.
 */
function tuneCrosshairs() {
  const tg = csTools.ToolGroupManager.getToolGroup(TG_MPR);
  if (!tg || !elements) return;
  let minDim = Infinity;
  for (const id of MPR_IDS) {
    const el = elements[id];
    if (!el || !el.clientWidth || !el.clientHeight || el.closest('.hidden')) continue;
    minDim = Math.min(minDim, el.clientWidth, el.clientHeight);
  }
  if (!Number.isFinite(minDim) || minDim < 20) return;
  const r = Math.max(2.5, Math.min(4, minDim / 130));              // círculos de giro: visibles pero discretos (v0.7.13)
  const gap = Math.max(8, Math.min(26, Math.round(minDim * 0.055)));
  const cur = tg.getToolConfiguration(csTools.CrosshairsTool.toolName) || {};
  if (Math.abs((cur.handleRadius || 0) - r) < 0.05 && cur.referenceLinesCenterGapRadius === gap) return;
  tg.setToolConfiguration(csTools.CrosshairsTool.toolName, { handleRadius: r, referenceLinesCenterGapRadius: gap });
  if (state.crosshairs) for (const id of MPR_IDS) { try { state.engine.getViewport(id).render(); } catch (e) { /* nada */ } }
}

/** Compone las vistas VISIBLES en un PNG (como «Captura» de VOXEL). */
export function screenshot(visibleIds, marca = null) {
  const canvases = visibleIds.map((id) => state.engine.getViewport(id).getCanvas()).filter(Boolean);
  if (!canvases.length) return null;
  let out, ctx;
  if (canvases.length === 1) {
    out = document.createElement('canvas'); out.width = canvases[0].width; out.height = canvases[0].height;
    ctx = out.getContext('2d');
    ctx.drawImage(canvases[0], 0, 0);
  } else {
    const cols = 2, rows = Math.ceil(canvases.length / cols);
    const w = Math.max(...canvases.map((c) => c.width)), h = Math.max(...canvases.map((c) => c.height));
    out = document.createElement('canvas'); out.width = w * cols; out.height = h * rows;
    ctx = out.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim() || '#000';
    ctx.fillRect(0, 0, out.width, out.height);
    canvases.forEach((c, i) => ctx.drawImage(c, (i % cols) * w, Math.floor(i / cols) * h));
  }
  stampWatermark(out, marca);
  return out.toDataURL('image/png');
}

/** MARCA DE AGUA: el logotipo abajo a la derecha, translúcido (v0.7.5). */
export function stampWatermark(out, marca) {
  if (!marca || !marca.complete || !marca.naturalWidth) return;
  const ctx = out.getContext('2d');
  const mw = Math.max(90, Math.round(out.width * 0.16));
  const mh = Math.round((mw * marca.naturalHeight) / marca.naturalWidth);
  const pad = Math.round(out.width * 0.015);
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.drawImage(marca, out.width - mw - pad, out.height - mh - pad, mw, mh);
  ctx.restore();
}

// ------------------------------------------------------------------ cortes de ATM (port del panel de VOXEL)
/** Marcas de los cóndilos mientras se señalan (null las quita). */
export function setTmjMarks(marks) { state.tmjMarks = marks && marks.length ? marks : null; silhouettes.redrawAll(); }

/**
 * Construye el panel de ATM a partir de un clic sobre cada cóndilo. seeds = { R: [x,y,z], L: [x,y,z] }.
 * Devuelve state.tmj = { poles, series, win } o null si no encuentra hueso donde se marcó.
 */
export async function buildTmj(seeds, onStatus, aspect = 1.35) {
  if (!state.volume || !state.sorted) return null;
  const thr = autoThresholds(state.sorted).bone;
  const smp = tmjSampler(state.volume, sliceGetter());
  const poles = {}, series = {};
  // LÍNEA MEDIA del paciente: punto medio entre los dos cóndilos marcados (si solo hay uno, el centro del
  // volumen). Decide cuál de los dos polos es el MEDIAL; antes se suponía x = 0 y en los CBCT cuyo origen
  // está en una esquina salían cambiados los del lado derecho (v0.7.6).
  const bnds = state.volume.imageData.getBounds();
  const midX = (seeds.R && seeds.L) ? (seeds.R[0] + seeds.L[0]) / 2 : (bnds[0] + bnds[1]) / 2;
  for (const sd of ['R', 'L']) {
    if (!seeds[sd]) continue;
    if (onStatus) onStatus('condyle', sd);
    await new Promise((r) => setTimeout(r, 0));
    const pole = refineCondyle(smp, seeds[sd], thr, midX);
    if (!pole) return null;
    pole.axiBase = bestAxialOffset(smp, pole, thr);     // el axial, a la altura de la cabeza (v0.7.8)
    poles[sd] = pole;
    if (onStatus) onStatus('slices', sd);
    await new Promise((r) => setTimeout(r, 0));
    const step = Math.min(0.14, Math.max(0.07, Math.min(...state.volume.spacing) / 3));   // v0.7.3: más fino (se veían borrosos)
    series[sd] = condyleSeries(smp, pole, step, { sag: 0, cor: 0, axi: 0 }, aspect);
    poles[sd].step = step;
    console.log(`tresD ATM ${sd}: ${pole.n} vóxeles de hueso · polos ${pole.med.map((v) => v.toFixed(1))} / ${pole.lat.map((v) => v.toFixed(1))} · ancho ${Math.hypot(pole.lat[0] - pole.med[0], pole.lat[1] - pole.med[1], pole.lat[2] - pole.med[2]).toFixed(1)} mm · axial a ${pole.axiBase} mm del centro`);
  }
  if (!Object.keys(series).length) return null;
  state.tmj = {
    poles, series, win: { ...state.mprWindow }, thr, smp, midX, aspect: clampAspect(aspect),
    shift: { R: { sag: 0, cor: 0, axi: 0 }, L: { sag: 0, cor: 0, axi: 0 } },
    meas: {},                                   // medidas por corte: clave `lado|familia|desplazamiento`
  };
  state.tmjMarks = null;
  silhouettes.redrawAll();
  return state.tmj;
}
export function clearTmj() { state.tmj = null; state.tmjMarks = null; silhouettes.redrawAll(); }

/** Límite del desplazamiento con la rueda, por familia de cortes (mm desde el centro del cóndilo). */
const TMJ_RANGE = { sag: 12, cor: 12, axi: 14 };

/**
 * Mueve con la rueda los cortes de una familia ('sag' | 'cor' | 'axi') de un lado, de milímetro en
 * milímetro. Devuelve el nuevo desplazamiento, o null si ya estaba en el tope.
 */
export function scrollTmj(side, family, delta) {
  const tmj = state.tmj; if (!tmj || !tmj.poles[side] || !delta) return null;
  const lim = TMJ_RANGE[family] || 10;
  const sh = tmj.shift[side];
  const next = Math.max(-lim, Math.min(lim, (sh[family] || 0) + delta));
  if (next === sh[family]) return null;
  sh[family] = next;
  const pole = tmj.poles[side], step = pole.step || 0.2;
  for (const it of tmj.series[side]) {
    if (it.family !== family) continue;
    it.off = (it.base || 0) + next;
    it.img = condyleSlice(tmj.smp, pole, family, it.off, step, tmj.aspect);
  }
  return next;
}

/**
 * Corte AXIAL amplio a la altura del cóndilo, para colocar los POLOS a mano (como el panel de VOXEL).
 * Devuelve { img, med, lat } con los polos ya en píxeles del corte.
 */
export function condyleAxialView(side, half = 30, step = 0.15, dz = 0) {
  const tmj = state.tmj; if (!tmj || !tmj.poles[side]) return null;
  const p = tmj.poles[side];
  const img = samplePlane(tmj.smp, { c: [p.center[0], p.center[1], p.center[2] + dz], normal: [0, 0, 1], ux: [1, 0, 0], up: [0, -1, 0], half: [half, half], step });
  // los polos se proyectan sobre ESTE corte (solo cambia la altura, así que el píxel es el mismo)
  return { img, med: worldToPlane(img, p.med), lat: worldToPlane(img, p.lat), z: p.center[2] + dz, dz };
}

/**
 * Coloca los POLOS de un cóndilo a mano (puntos del mundo) y rehace sus cortes. Devuelve el nuevo marco.
 */
export function setCondylePoles(side, med, lat, aspect) {
  const tmj = state.tmj; if (!tmj || !tmj.poles[side]) return null;
  const old = tmj.poles[side];
  const pole = polesFrom(med, lat, old.n, old.apex, tmj.midX || 0);
  pole.step = old.step;
  pole.axiBase = bestAxialOffset(tmj.smp, pole, tmj.thr);
  tmj.poles[side] = pole;
  const step = pole.step || 0.2, a = aspect || tmj.aspect;
  for (const it of tmj.series[side]) {
    if (it.family === 'axi') { it.base = pole.axiBase; it.off = pole.axiBase + ((tmj.shift[side] || {}).axi || 0); }
    it.img = condyleSlice(tmj.smp, pole, it.family, it.off, step, a);
  }
  for (const k of Object.keys(tmj.meas)) if (k.startsWith(side + '|')) delete tmj.meas[k];
  silhouettes.redrawAll();
  return pole;
}
/** Polos actuales de un lado (para deshacer). */
export function getCondylePoles(side) {
  const p = state.tmj && state.tmj.poles[side];
  return p ? { med: p.med.slice(), lat: p.lat.slice() } : null;
}

/**
 * Ajusta la PROPORCIÓN de los cortes de ATM a la de las casillas del mosaico (así llenan la casilla y no
 * quedan franjas negras). Devuelve true si hubo que rehacerlos. Borra las medidas, que iban en píxeles.
 */
export function setTmjAspect(aspect) {
  const tmj = state.tmj; if (!tmj) return false;
  const a = clampAspect(aspect);
  if (Math.abs(a - tmj.aspect) / tmj.aspect < 0.08) return false;
  tmj.aspect = a;
  for (const sd of Object.keys(tmj.series)) {
    const pole = tmj.poles[sd], step = pole.step || 0.2;
    for (const it of tmj.series[sd]) it.img = condyleSlice(tmj.smp, pole, it.family, it.off, step, a);
  }
  tmj.meas = {};
  return true;
}

/** Medidas de un corte de ATM (se guardan por lado, familia y desplazamiento). */
export function tmjMeasKey(side, family, off) { return `${side}|${family}|${off}`; }
export function getTmjMeas(side, family, off) { const t = state.tmj; return (t && t.meas[tmjMeasKey(side, family, off)]) || []; }
export function addTmjMeas(side, family, off, m) {
  const t = state.tmj; if (!t) return null;
  const k = tmjMeasKey(side, family, off);
  (t.meas[k] || (t.meas[k] = [])).push(m);
  return k;
}
export function clearTmjMeas() { if (state.tmj) state.tmj.meas = {}; }
export function setTmjMeas(meas) { if (state.tmj) state.tmj.meas = meas || {}; }
export function getAllTmjMeas() { const t = state.tmj; return t ? JSON.parse(JSON.stringify(t.meas)) : {}; }
/** Ventana (brillo/contraste) de los cortes de ATM. */
export function setTmjWindow(win) { if (state.tmj) state.tmj.win = { lower: win.lower, upper: win.upper }; }
export function getTmjWindow() { return state.tmj ? { ...state.tmj.win } : { ...state.mprWindow }; }

export function getEngine() { return state.engine || getRenderingEngine(RE_ID); }
export const tools = csTools;   // depuración desde la consola (window.tresd.V.tools)

// ------------------------------------------------------------------ vía aérea (port de VOXEL airway_auto)
/** Punto MUNDO bajo una posición del canvas de un corte MPR (sobre el plano del corte actual). */
export function pickOnMpr(vpId, canvasPos) {
  if (!state.volume) return null;
  try { const p = state.engine.getViewport(vpId).canvasToWorld(canvasPos); return [p[0], p[1], p[2]]; } catch (e) { return null; }
}

/**
 * Segmenta la vía aérea entre los clics superior e inferior (mundo) → malla con rol 'airway', mapa de calor
 * y valores en item.airway = { volume_mm3, mca_mm2, mca_z, z_lo, z_hi, levels }. onStatus(fase, pct).
 * Devuelve el item o null si no hay columna de aire.
 */
export async function segmentAirway(sup, inf, onStatus, name = 'airway') {
  if (!state.volume || !state.sorted) return null;
  const res = await airwayAuto(state.volume, state.sorted, sliceGetter(), sup, inf, onStatus);
  if (!res) return null;
  const prev = meshes.items.filter((m) => m.role === 'airway').map((m) => detachMesh(m.id));
  const item = meshes.add({ name, ext: 'seg', pts: res.pts, polys: res.polys, colors: null, warnings: [] }, { role: 'airway' });
  item.warnings = []; item.seg = true; item.airway = { volume_mm3: res.volume_mm3, mca_mm2: res.mca_mm2, mca_z: res.mca_z, z_lo: res.z_lo, z_hi: res.z_hi, levels: res.levels, voxel: res.voxel, tAir: res.tAir, sup, inf };
  item.area = res.area; item.heat = true;
  const [lo, hi] = heatRange(res.area, res.mca_mm2);
  item.heatRange = [lo, hi];
  meshes.setVertexColors(item.id, heatColors(res.area, lo, hi));
  history.record({
    label: 'airway',
    undo: () => { detachMesh(item.id); for (const it of prev) meshes.reinsert(it); afterMeshChange(); },
    redo: () => { for (const it of prev) detachMesh(it.id); meshes.reinsert(item); afterMeshChange(); },
  });
  afterMeshChange();
  return item;
}
export function airwayMesh() { return meshes.items.find((m) => m.role === 'airway') || null; }
/** Marcas de la vía aérea sobre el sagital (null las quita). */
export function setAirwayMarks(marks) { state.awMarks = marks && marks.length ? marks : null; silhouettes.redrawAll(); }
/** Mapa de calor de la vía aérea (área de la sección por vértice) o color sólido. */
export function setAirwayHeat(id, on) {
  const it = meshes.get(id); if (!it || !it.area) return;
  it.heat = !!on; meshes.setUseColors(id, !!on);
  state.engine.getViewport(VP.v3d).render();
}

// ------------------------------------------------------------------ panorámica (corte curvo)
/**
 * Calcula (o recalcula) la panorámica: curva de la arcada desde la dentición detectada y la imagen con el
 * grosor pedido. opts = { thickness, mip }. Devuelve state.pano = { curve, image, thickness, mip } o null.
 */
export async function buildPano(opts = {}, onStatus) {
  if (!state.volume) return null;
  let curve = state.pano && state.pano.curve;
  if (opts.curve) curve = opts.curve;                 // curva DIBUJADA a mano por el usuario (v0.7.12)
  else if (!curve || opts.recompute) {
    const raw = await getEnamel(onStatus);
    curve = raw && state.teeth ? archCurve(state.teeth) : null;
  }
  if (!curve) { state.pano = null; return null; }
  const thickness = opts.thickness ?? (state.pano ? state.pano.thickness : 22), mip = opts.mip ?? (state.pano ? state.pano.mip : true);
  const image = buildPanoramic(state.volume, sliceGetter(), curve, { thickness, mip });
  // la ventana la propone la propia imagen (con MIP la de los cortes satura); si el usuario ya la ha
  // ajustado a mano en esta panorámica, se respeta
  const win = state.pano && state.pano.winTouched && state.pano.mip === mip ? state.pano.win : image.win;
  const meas = state.pano ? state.pano.meas || [] : [];      // las medidas se conservan al cambiar grosor/MIP
  state.pano = { curve, image, thickness, mip, win, meas, winTouched: !!(state.pano && state.pano.winTouched && state.pano.mip === mip) };
  silhouettes.redrawAll();
  return state.pano;
}

/** Mueve un punto de CONTROL de la curva (mm) y rehace la curva; la imagen se rehace con buildPano. */
export function movePanoControl(i, x, y) {
  const p = state.pano; if (!p || !p.curve || !p.curve.control[i]) return null;
  const ctrl = p.curve.control.map((q) => q.slice());
  ctrl[i] = [x, y];
  const curve = curveFrom(ctrl, p.curve.z);
  if (!curve) return null;
  p.curve = curve;
  silhouettes.redrawAll();
  return curve;
}
/** Medidas sobre la panorámica (en píxeles de la imagen; se conservan al cambiar grosor o MIP). */
export function getPanoMeas() { return (state.pano && state.pano.meas) || []; }
export function addPanoMeas(m) { if (state.pano) (state.pano.meas || (state.pano.meas = [])).push(m); return m; }
export function setPanoMeas(list) { if (state.pano) state.pano.meas = list || []; }
export function clearPanoMeas() { if (state.pano) state.pano.meas = []; }

/** Curva de la arcada tal y como está (para deshacer). */
export function getPanoControl() { return state.pano && state.pano.curve ? state.pano.curve.control.map((p) => p.slice()) : null; }
export function setPanoControl(ctrl) {
  const p = state.pano; if (!p || !ctrl) return null;
  const curve = curveFrom(ctrl.map((q) => q.slice()), p.curve.z);
  if (curve) { p.curve = curve; silhouettes.redrawAll(); }
  return curve;
}
/** Curva de la panorámica a partir de puntos DIBUJADOS por el usuario (mundo, en un corte axial a la altura z). */
export function curveFromPoints(pts, z) { return curveFrom(pts.map((q) => [q[0], q[1]]), z); }
/** Puntos que el usuario va marcando para dibujar la curva (se pintan sobre el axial); null los quita. */
export function setPanoDrawPoints(pts) { state.panDraw = pts && pts.length ? pts : null; silhouettes.redrawAll(); }

export function setArchVisible(on) { state.showArch = !!on; silhouettes.redrawAll(); }
export function setPanoEdit(on) {
  state.panoEdit = !!on;
  if (on) {
    state.showArch = true;
    jumpAxialToZ(state.pano && state.pano.curve ? state.pano.curve.z : null);   // axial a la altura de los dientes
  }
  silhouettes.setSuppressed(!!on);          // editando la curva, las siluetas estorban sobre el axial
  silhouettes.redrawAll();
}

/** Lleva un visor MPR a una coordenada concreta de su eje (0 = X, 1 = Y, 2 = Z; mm del paciente). */
export function jumpViewportTo(vpId, axis, value) {
  if (!Number.isFinite(value) || !state.engine) return;
  try {
    const vp = state.engine.getViewport(vpId); if (!vp) return;
    const cam = vp.getCamera();
    const d = value - cam.focalPoint[axis];
    if (Math.abs(d) < 1e-6) return;
    const fp = cam.focalPoint.slice(), po = cam.position.slice();
    fp[axis] += d; po[axis] += d;
    vp.setCamera({ focalPoint: fp, position: po });
    vp.render();
  } catch (e) { /* corte oblicuo o sin volumen */ }
}
/** Punto de mira actual de un visor MPR (mundo), o null. */
export function viewportFocal(vpId) {
  try { const vp = state.engine.getViewport(vpId); return vp ? vp.getCamera().focalPoint.slice() : null; } catch (e) { return null; }
}

/**
 * Como `jumpViewportTo`, pero INSISTE hasta que el salto se queda puesto. Al cambiar de disposición,
 * Cornerstone recoloca la cámara en el centro del volumen DESPUÉS de repartir el espacio, y se comía el
 * salto (por eso el coronal no caía en los cóndidos al marcar la ATM, v0.7.6). Para en cuanto el corte
 * aguanta 3 fotogramas o a los 900 ms.
 */
export function jumpViewportSticky(vpId, axis, value, ms = 900) {
  if (!Number.isFinite(value)) return;
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let firm = 0;
  const tick = () => {
    jumpViewportTo(vpId, axis, value);
    const f = viewportFocal(vpId);
    firm = (f && Math.abs(f[axis] - value) < 0.5) ? firm + 1 : 0;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (firm < 3 && now - t0 < ms) requestAnimationFrame(tick);
  };
  tick();
}

/** Lleva el corte AXIAL a una altura concreta (mm, marco del paciente). Sin z, no hace nada. */
export function jumpAxialToZ(z) { jumpViewportTo(VP.ax, 2, z); }

/**
 * Estimación de DÓNDE están los cóndilos (mundo), para encuadrar el corte coronal antes de marcarlos.
 * Si ya se ha calculado la panorámica, sus extremos caen justo en las ATM; si no, se usa una proporción
 * de la caja del volumen (los cóndilos quedan atrás y arriba). Es solo una ayuda: el usuario ajusta con la rueda.
 */
export function condyleGuess() {
  if (!state.volume) return null;
  const b = state.volume.imageData.getBounds();
  const x = (b[0] + b[1]) / 2;
  if (state.pano && state.pano.curve && state.pano.curve.control.length > 2) {
    const c = state.pano.curve.control;
    return [x, (c[0][1] + c[c.length - 1][1]) / 2, state.pano.curve.z + 45];
  }
  return [x, b[2] + 0.68 * (b[3] - b[2]), b[4] + 0.70 * (b[5] - b[4])];
}
/** Ventana (brillo/contraste) PROPIA de la panorámica. */
export function getPanoWindow() { return state.pano ? { ...state.pano.win } : { lower: 0, upper: 1 }; }
export function setPanoWindow(win) { if (state.pano) { state.pano.win = { lower: win.lower, upper: win.upper }; state.pano.winTouched = true; } }

/** Ventana (brillo/contraste) de los cortes MPR. */
export function getMprWindow() { return { ...state.mprWindow }; }
export function setMprWindow(win) {
  state.mprWindow = { lower: win.lower, upper: win.upper };
  syncing = true;
  for (const id of MPR_IDS) { try { const vp = state.engine.getViewport(id); vp.setProperties({ voiRange: { ...state.mprWindow } }); vp.render(); } catch (e) { /* nada */ } }
  syncing = false;
  try { mprPlanes.setWindow(state.mprWindow); } catch (e) { /* nada */ }
}
