// tresD DICOM — ESCÁNERES INTRAORALES (STL / PLY / OBJ) dentro del render 3D (Fase 2).
// Portado de tresD Models (core/mesh_io.py + core/orient.py):
//  - lectura de STL (binario y ASCII, con fusión de vértices repetidos), PLY (con colores) y OBJ;
//  - comprobación de ESCALA (una arcada mide 25-200 mm de diagonal; si no, se propone el factor);
//  - se quitan los TROZOS SUELTOS (lengua, mejilla, ruido) si entre todos son < 5 % de la superficie;
//  - rol (superior / inferior) adivinado por el NOMBRE del archivo;
//  - orientación automática al marco del paciente (orient.js) y herencia del giro entre arcadas
//    complementarias del mismo escaneo (para no romper la oclusión).
// La capa `MeshLayer` mantiene los actores vtk.js dentro del visor 3D de Cornerstone: visibilidad,
// transparencia, color, plano de corte compartido con el volumen y "picado" de rayo para medir.
import vtkPLYReader from '@kitware/vtk.js/IO/Geometry/PLYReader';
import vtkOBJReader from '@kitware/vtk.js/IO/Misc/OBJReader';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkTexture from '@kitware/vtk.js/Rendering/Core/Texture';
import { patientFrame, applyMatrix } from './orient.js';

export const MESH_EXT = /\.(stl|ply|obj)$/i;
export const isMeshName = (name) => MESH_EXT.test(name || '');
export const CLAY = '#DBCCAE';                 // "arcilla" de tresD Models para STL sin color
const ROLE_COLORS = { upper: '#DBCCAE', lower: '#C9D3DE', other: '#D9C9B0', skull: '#E9E2D0', soft: '#E6B8A2', airway: '#73BFFA' };
const MATERIAL = { default: [0.3, 0.8, 0.08, 20], soft: [0.35, 0.7, 0.05, 15], skull: [0.32, 0.78, 0.1, 25], airway: [0.4, 0.75, 0.15, 20] };

// ---------------------------------------------------------------- rol por nombre (guess_role)
const UPPER = ['upper', 'up', 'sup', 'superior', 'max', 'maxilar', 'maxillary', '_u', 'arcadasup'];
const LOWER = ['lower', 'low', 'inf', 'inferior', 'mand', 'mandibular', '_l', 'arcadainf'];
export function guessRole(name) {
  const stem = String(name || '').replace(/\.[^.]+$/, '').toLowerCase().replace(/\s+/g, '');
  if (UPPER.some((k) => stem.includes(k))) return 'upper';
  if (LOWER.some((k) => stem.includes(k))) return 'lower';
  return 'other';
}

// ---------------------------------------------------------------- escala (scale_warning)
const DIAG_MIN = 25, DIAG_MAX = 200;
const FACTORS = [[10, 'cm'], [1000, 'm'], [25.4, 'in'], [0.001, 'µm']];
/** Devuelve { factor, unit, odd }: factor 1 = ya está en mm; unit = unidad detectada; odd = tamaño raro. */
export function scaleCheck(diag) {
  if (diag >= DIAG_MIN && diag <= DIAG_MAX) return { factor: 1, unit: 'mm', odd: false };
  for (const [f, unit] of FACTORS) if (diag * f >= DIAG_MIN && diag * f <= DIAG_MAX) return { factor: f, unit, odd: false };
  return { factor: 1, unit: '?', odd: true };
}

// ---------------------------------------------------------------- lectura
/** Lee un archivo STL/PLY/OBJ → { pts: Float32Array, polys: Uint32Array (3 índices/triángulo), colors|null, ... } */
export async function readMesh(file) {
  const name = file.name || 'malla';
  const ext = (name.match(MESH_EXT) || ['', ''])[1].toLowerCase();
  const buf = await file.arrayBuffer();
  let pts, polys, colors = null;
  if (ext === 'stl') {
    ({ pts, polys } = parseSTL(buf));
  } else if (ext === 'ply') {
    const r = vtkPLYReader.newInstance();
    r.parseAsArrayBuffer(buf);
    const pd = r.getOutputData();
    pts = Float32Array.from(pd.getPoints().getData());
    polys = trianglesFromCells(pd.getPolys().getData());
    const sc = pd.getPointData().getScalars();
    if (sc && sc.getNumberOfComponents() === 3 && sc.getData().length === pts.length) colors = Uint8Array.from(sc.getData());
  } else if (ext === 'obj') {
    const r = vtkOBJReader.newInstance({ splitMode: null });
    r.parseAsText(new TextDecoder().decode(buf));
    const pd = r.getOutputData(0);
    pts = Float32Array.from(pd.getPoints().getData());
    polys = trianglesFromCells(pd.getPolys().getData());
  } else {
    throw new Error('Formato no soportado: ' + name);
  }
  if (!polys.length) throw new Error('El archivo no contiene triángulos: ' + name);
  const warnings = [];
  // trozos sueltos (drop_islands)
  const dropped = dropIslands(pts, polys, colors);
  if (dropped) { ({ pts, polys, colors } = dropped); if (dropped.msg) warnings.push(dropped.msg); }
  const b = bounds(pts);
  const size = [b[1] - b[0], b[3] - b[2], b[5] - b[4]];
  const diag = Math.hypot(...size);
  return { name, ext, pts, polys, colors, size, diag, nTri: polys.length / 3, warnings, scale: scaleCheck(diag) };
}

function parseSTL(buf) {
  const dv = new DataView(buf);
  let raw;
  const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : -1;
  if (n >= 0 && buf.byteLength === 84 + 50 * n) {
    raw = new Float32Array(n * 9);
    for (let i = 0, o = 84; i < n; i++, o += 50) {
      for (let k = 0; k < 9; k++) raw[9 * i + k] = dv.getFloat32(o + 12 + 4 * k, true);   // 12 = normal
    }
  } else {
    const txt = new TextDecoder().decode(buf);
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    const arr = []; let m;
    while ((m = re.exec(txt))) arr.push(+m[1], +m[2], +m[3]);
    raw = Float32Array.from(arr.slice(0, arr.length - (arr.length % 9)));
  }
  return mergeVertices(raw);
}

/** Fusiona vértices repetidos (STL trae 3 vértices sueltos por triángulo): índices compartidos. */
function mergeVertices(raw) {
  const nv = raw.length / 3;
  const b = bounds(raw);
  const diag = Math.hypot(b[1] - b[0], b[3] - b[2], b[5] - b[4]) || 1;
  const q = 2e5 / diag;                          // resolución ≈ diagonal / 200 000 (0,001 mm en una arcada)
  const map = new Map();
  const idx = new Uint32Array(nv);
  const out = [];
  let count = 0;
  for (let i = 0; i < nv; i++) {
    const x = raw[3 * i], y = raw[3 * i + 1], z = raw[3 * i + 2];
    const key = Math.round((x - b[0]) * q) + ',' + Math.round((y - b[2]) * q) + ',' + Math.round((z - b[4]) * q);
    let id = map.get(key);
    if (id === undefined) { id = count++; map.set(key, id); out.push(x, y, z); }
    idx[i] = id;
  }
  const polys = [];
  for (let t = 0; t < nv; t += 3) {
    const a = idx[t], c = idx[t + 1], d = idx[t + 2];
    if (a !== c && a !== d && c !== d) polys.push(a, c, d);
  }
  return { pts: Float32Array.from(out), polys: Uint32Array.from(polys) };
}

/** Celdas vtk [n, i0..in-1, n, ...] → triángulos (abanico para polígonos de más de 3 lados). */
function trianglesFromCells(cells) {
  const out = [];
  for (let i = 0; i < cells.length;) {
    const n = cells[i];
    for (let k = 1; k < n - 1; k++) out.push(cells[i + 1], cells[i + 1 + k], cells[i + 2 + k]);
    i += n + 1;
  }
  return Uint32Array.from(out);
}

export function bounds(pts) {
  const b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    if (x < b[0]) b[0] = x; if (x > b[1]) b[1] = x;
    if (y < b[2]) b[2] = y; if (y > b[3]) b[3] = y;
    if (z < b[4]) b[4] = z; if (z > b[5]) b[5] = z;
  }
  return b;
}

function triArea(pts, a, b, c) {
  const ux = pts[3 * b] - pts[3 * a], uy = pts[3 * b + 1] - pts[3 * a + 1], uz = pts[3 * b + 2] - pts[3 * a + 2];
  const vx = pts[3 * c] - pts[3 * a], vy = pts[3 * c + 1] - pts[3 * a + 1], vz = pts[3 * c + 2] - pts[3 * a + 2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/** Quita los trozos sueltos si en total son < 5 % de la superficie (drop_islands de tresD Models). */
function dropIslands(pts, polys, colors, maxFrac = 0.05) {
  const nv = pts.length / 3;
  const parent = new Uint32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let t = 0; t < polys.length; t += 3) { union(polys[t], polys[t + 1]); union(polys[t + 1], polys[t + 2]); }
  const area = new Map();
  let total = 0;
  for (let t = 0; t < polys.length; t += 3) {
    const r = find(polys[t]);
    const a = triArea(pts, polys[t], polys[t + 1], polys[t + 2]);
    area.set(r, (area.get(r) || 0) + a); total += a;
  }
  if (area.size <= 1) return null;
  let big = -1, bigA = -1;
  for (const [r, a] of area) if (a > bigA) { bigA = a; big = r; }
  const frac = 1 - bigA / total;
  if (frac > maxFrac) return { pts, polys, colors, msg: `islands_kept|${area.size}|${Math.round(100 * (1 - frac))}` };
  // conservar solo el trozo mayor, compactando los puntos
  const remap = new Int32Array(nv).fill(-1);
  const newPts = [], newCol = colors ? [] : null, newPolys = [];
  let k = 0;
  for (let t = 0; t < polys.length; t += 3) {
    if (find(polys[t]) !== big) continue;
    for (let j = 0; j < 3; j++) {
      const v = polys[t + j];
      if (remap[v] < 0) {
        remap[v] = k++;
        newPts.push(pts[3 * v], pts[3 * v + 1], pts[3 * v + 2]);
        if (newCol) newCol.push(colors[3 * v], colors[3 * v + 1], colors[3 * v + 2]);
      }
      newPolys.push(remap[v]);
    }
  }
  return {
    pts: Float32Array.from(newPts), polys: Uint32Array.from(newPolys), colors: newCol ? Uint8Array.from(newCol) : null,
    msg: `islands_dropped|${area.size - 1}|${(100 * frac).toFixed(1)}`,
  };
}

/** Normales por vértice ponderadas por área (sin vtkPolyDataNormals: más rápido y sin sorpresas). */
function vertexNormals(pts, polys) {
  const n = new Float32Array(pts.length);
  for (let t = 0; t < polys.length; t += 3) {
    const a = polys[t], b = polys[t + 1], c = polys[t + 2];
    const ux = pts[3 * b] - pts[3 * a], uy = pts[3 * b + 1] - pts[3 * a + 1], uz = pts[3 * b + 2] - pts[3 * a + 2];
    const vx = pts[3 * c] - pts[3 * a], vy = pts[3 * c + 1] - pts[3 * a + 1], vz = pts[3 * c + 2] - pts[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;   // |n| = 2·área
    for (const v of [a, b, c]) { n[3 * v] += nx; n[3 * v + 1] += ny; n[3 * v + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

function hex2rgb(h) { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255); }

// ---------------------------------------------------------------- capa de mallas en el visor 3D
let seq = 0, groupSeq = 0;
export class MeshLayer {
  constructor(getViewport) {
    this.getViewport = getViewport;
    this.items = [];
    this.clip = null;             // { ai, cut, flip } igual que measure3d
    this.lastFrame = null;        // { role, M } de la última malla orientada (herencia del giro)
  }

  /**
   * Añade una malla leída con readMesh. opts: { role, autoOrient, scale, target }.
   * target = [x,y,z] donde colocar el centro tras orientar (centro del CBCT o el origen).
   * Devuelve el item con `info` de la orientación (o null si no se orientó).
   */
  add(mesh, opts = {}) {
    const role = opts.role || 'other';
    const pts = mesh.pts;                           // se transforma EN EL SITIO
    if (opts.scale && opts.scale !== 1) for (let i = 0; i < pts.length; i++) pts[i] *= opts.scale;
    let info = null, M = null, group = ++groupSeq, align = null;
    if (opts.autoOrient) {
      const comp = role === 'upper' ? 'lower' : role === 'lower' ? 'upper' : null;
      const sameRole = this.items.some((it) => it.role === role && it.oriented);
      const donor = comp && !sameRole ? this.items.find((it) => it.role === comp && it.oriented && it.M) : null;
      if (donor) {                                  // arcada complementaria del mismo escaneo: hereda el giro
        M = donor.M; group = donor.group; align = donor.align;   // (M ya incluye la alineación al CBCT si la hubo)
        applyMatrix(pts, M);
        info = { ok: true, inherited: true, from: donor.role, warnings: [] };
      } else {
        const r = patientFrame(pts, mesh.polys, role === 'lower' ? 'lower' : 'upper');
        const c = opts.target || [0, 0, 0];
        M = r.M.slice(); M[3] += c[0]; M[7] += c[1]; M[11] += c[2];   // giro + colocación en el centro elegido
        applyMatrix(pts, M);
        info = r.info;
      }
    }
    const item = {
      id: 'mesh' + (++seq), name: mesh.name.replace(/\.[^.]+$/, ''), ext: mesh.ext, role,
      pts, polys: mesh.polys, colors: mesh.colors, nTri: mesh.polys.length / 3,
      visible: true, opacity: 1, color: ROLE_COLORS[role] || CLAY, useColors: !!mesh.colors,
      oriented: !!opts.autoOrient, M, info, group, align, bounds: bounds(pts), rev: 0,
    };
    item.polydata = vtkPolyData.newInstance();
    item.polydata.getPoints().setData(pts, 3);
    const cells = new Uint32Array(item.nTri * 4);
    for (let t = 0, o = 0; t < mesh.polys.length; t += 3, o += 4) { cells[o] = 3; cells[o + 1] = mesh.polys[t]; cells[o + 2] = mesh.polys[t + 1]; cells[o + 3] = mesh.polys[t + 2]; }
    item.polydata.getPolys().setData(cells);
    item.polydata.getPointData().setNormals(vtkDataArray.newInstance({ name: 'Normals', numberOfComponents: 3, values: vertexNormals(pts, mesh.polys) }));
    if (mesh.colors) item.polydata.getPointData().setScalars(vtkDataArray.newInstance({ name: 'RGB', numberOfComponents: 3, values: mesh.colors }));
    item.mapper = vtkMapper.newInstance({ scalarVisibility: !!mesh.colors });
    item.mapper.setInputData(item.polydata);
    if (mesh.colors) { item.mapper.setColorModeToDirectScalars(); item.mapper.setScalarModeToUsePointData(); }
    item.actor = vtkActor.newInstance();
    item.actor.setMapper(item.mapper);
    const pr = item.actor.getProperty();
    pr.setColor(...hex2rgb(item.color));
    const mat = MATERIAL[role] || MATERIAL.default;
    pr.setAmbient(mat[0]); pr.setDiffuse(mat[1]); pr.setSpecular(mat[2]); pr.setSpecularPower(mat[3]);
    pr.setInterpolationToPhong();
    item.material = mat;
    this.items.push(item);
    this._applyClip(item);
    this._attach(item);
    return item;
  }

  _attach(item) {
    const vp = this.getViewport();
    if (!vp) return;
    try { if (!vp.getActor(item.id)) vp.addActor({ uid: item.id, actor: item.actor }); } catch (e) { console.warn(e); }
  }

  /** Vuelve a colgar los actores en el visor (Cornerstone los quita al cambiar de volumen). */
  reattach() { for (const it of this.items) this._attach(it); }

  get(id) { return this.items.find((it) => it.id === id); }

  remove(id) {
    const it = this.detach(id);
    if (!it) return;
    it.polydata.delete(); it.mapper.delete(); it.actor.delete();
  }

  /** Quita la malla del visor y de la lista SIN destruirla (para poder deshacer): devuelve { item, index }. */
  detach(id) {
    const index = this.items.findIndex((x) => x.id === id);
    if (index < 0) return null;
    const it = this.items[index];
    const vp = this.getViewport();
    try { vp && vp.removeActors([id]); } catch (e) { /* nada */ }
    this.items.splice(index, 1);
    it.index = index;
    return it;
  }

  /** Vuelve a colgar una malla quitada con detach (en su posición original si cabe). */
  reinsert(it, index = it.index) {
    if (!it || this.get(it.id)) return;
    const i = Math.max(0, Math.min(this.items.length, index ?? this.items.length));
    this.items.splice(i, 0, it);
    it.actor.setVisibility(!!it.visible);
    this._applyClip(it);
    this._attach(it);
  }

  clear() { for (const it of this.items.slice()) this.remove(it.id); }

  setVisible(id, on) { const it = this.get(id); if (it) { it.visible = !!on; it.actor.setVisibility(!!on); } }
  setOpacity(id, f) { const it = this.get(id); if (it) { it.opacity = Math.max(0.02, Math.min(1, f)); it.actor.getProperty().setOpacity(it.opacity); } }
  setColor(id, hexColor) {
    const it = this.get(id); if (!it) return;
    it.color = hexColor; it.actor.getProperty().setColor(...hex2rgb(hexColor));
  }
  setUseColors(id, on) {
    const it = this.get(id); if (!it || !it.colors) return;
    it.useColors = !!on; it.mapper.setScalarVisibility(!!on);
  }
  /** Colores por vértice (Uint8 RGB, 3 por punto) calculados después (mapa de calor de la vía aérea). */
  setVertexColors(id, colors) {
    const it = this.get(id); if (!it) return;
    it.colors = colors;
    it.polydata.getPointData().setScalars(vtkDataArray.newInstance({ name: 'RGB', numberOfComponents: 3, values: colors }));
    it.mapper.setColorModeToDirectScalars(); it.mapper.setScalarModeToUsePointData();
    it.useColors = true; it.mapper.setScalarVisibility(true);
    it.polydata.modified();
  }

  /** Gira una malla 180° (dientes arriba/abajo) alrededor de su centro; por si la orientación automática duda. */
  flip(id, axis = 'y') {
    const it = this.get(id); if (!it) return;
    const b = it.bounds, c = [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2];
    const pts = it.pts;
    const i0 = axis === 'x' ? 1 : 0, i1 = axis === 'y' ? 2 : axis === 'x' ? 2 : 1;   // ejes que se invierten
    for (let i = 0; i < pts.length; i += 3) { pts[i + i0] = 2 * c[i0] - pts[i + i0]; pts[i + i1] = 2 * c[i1] - pts[i + i1]; }
    it.polydata.getPointData().setNormals(vtkDataArray.newInstance({ name: 'Normals', numberOfComponents: 3, values: vertexNormals(pts, it.polys) }));
    it.polydata.getPoints().dataChange(); it.polydata.modified();   // dataChange: invalida los LÍMITES cacheados (modified no lo hace; v0.8.2)
    it.bounds = bounds(pts); it.rev = (it.rev || 0) + 1;
    if (it.M) {                                   // el giro se compone en M para que la otra arcada lo herede igual
      const F = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      for (const i of [i0, i1]) { F[5 * i] = -1; F[4 * i + 3] = 2 * c[i]; }
      it.M = mul4(F, it.M);
    }
  }

  /** Normales por vértice (Float32Array) de la malla. */
  normals(id) { const it = this.get(id); const n = it && it.polydata.getPointData().getNormals(); return n ? n.getData() : null; }

  /** Foto drapeada: canvas (atlas) + coordenadas de textura por vértice (2 por punto). */
  setTexture(id, canvas, uv) {
    const it = this.get(id); if (!it) return;
    this.clearTexture(id);
    it.polydata.getPointData().setTCoords(vtkDataArray.newInstance({ name: 'uv', numberOfComponents: 2, values: uv }));
    const tex = vtkTexture.newInstance({ interpolate: true, edgeClamp: true });
    tex.setCanvas(canvas);
    it.actor.addTexture(tex);
    it.mapper.setScalarVisibility(false);
    const pr = it.actor.getProperty();
    pr.setColor(1, 1, 1); pr.setAmbient(0.55); pr.setDiffuse(0.55); pr.setSpecular(0);
    it.texture = tex; it.textureCanvas = canvas; it.uv = uv;
    it.polydata.modified();
  }
  clearTexture(id) {
    const it = this.get(id); if (!it || !it.texture) return;
    try { it.actor.removeAllTextures(); } catch (e) { /* nada */ }
    it.texture = null; it.textureCanvas = null;
    const pr = it.actor.getProperty(); const mat = it.material || MATERIAL.default;
    pr.setColor(...hex2rgb(it.color)); pr.setAmbient(mat[0]); pr.setDiffuse(mat[1]); pr.setSpecular(mat[2]);
    it.mapper.setScalarVisibility(!!(it.colors && it.useColors));
  }
  setTextureVisible(id, on) {
    const it = this.get(id); if (!it || !it.textureCanvas) return;
    if (on && !it.texture) this.setTexture(id, it.textureCanvas, it.uv);
    else if (!on && it.texture) { const c = it.textureCanvas, uv = it.uv; this.clearTexture(id); it.textureCanvas = c; it.uv = uv; }
  }

  /** Instantánea de la pose (para poder deshacer un intento de alineación). */
  snapshot(id) { const it = this.get(id); return it ? { id, pts: Float32Array.from(it.pts), M: it.M ? it.M.slice() : null, align: it.align } : null; }
  restore(snap) {
    const it = snap && this.get(snap.id); if (!it) return;
    it.pts.set(snap.pts); it.M = snap.M; it.align = snap.align;
    it.polydata.getPointData().setNormals(vtkDataArray.newInstance({ name: 'Normals', numberOfComponents: 3, values: vertexNormals(it.pts, it.polys) }));
    it.polydata.getPoints().dataChange(); it.polydata.modified();   // dataChange: invalida los LÍMITES cacheados (modified no lo hace; v0.8.2)
    it.bounds = bounds(it.pts); it.rev = (it.rev || 0) + 1;
  }

  /** Aplica una transformación rígida 4×4 (mundo→mundo) a la malla; se compone en M (herencia). */
  transform(id, T) {
    const it = this.get(id); if (!it) return;
    applyMatrix(it.pts, T);
    it.polydata.getPointData().setNormals(vtkDataArray.newInstance({ name: 'Normals', numberOfComponents: 3, values: vertexNormals(it.pts, it.polys) }));
    it.polydata.getPoints().dataChange(); it.polydata.modified();   // dataChange: invalida los LÍMITES cacheados (modified no lo hace; v0.8.2)
    it.bounds = bounds(it.pts); it.rev = (it.rev || 0) + 1;
    if (it.M) it.M = mul4(T, it.M);
  }

  /**
   * Giro RÍGIDO (v0.8.6): como `transform`, pero las normales se GIRAN en vez de recalcularse triángulo a
   * triángulo. En un giro puro el resultado es el mismo y cuesta la décima parte, así que se puede aplicar
   * mientras se arrastran los deslizadores de orientación sin que se note el tirón.
   */
  rotate(id, T) {
    const it = this.get(id); if (!it) return;
    applyMatrix(it.pts, T);
    const nr = it.polydata.getPointData().getNormals();
    if (nr) {
      const v = nr.getData();
      for (let i = 0; i < v.length; i += 3) {
        const x = v[i], y = v[i + 1], z = v[i + 2];
        v[i] = T[0] * x + T[1] * y + T[2] * z; v[i + 1] = T[4] * x + T[5] * y + T[6] * z; v[i + 2] = T[8] * x + T[9] * y + T[10] * z;
      }
      nr.modified();
    }
    it.polydata.getPoints().dataChange(); it.polydata.modified();
    it.bounds = bounds(it.pts); it.rev = (it.rev || 0) + 1;
    if (it.M) it.M = mul4(T, it.M);
  }

  /** Plano de corte compartido con el volumen: { ai, cut, flip } o null. */
  setClip(clip) { this.clip = clip; for (const it of this.items) this._applyClip(it); }
  _applyClip(it) {
    it.mapper.removeAllClippingPlanes();
    if (!this.clip) return;
    const origin = [0, 0, 0]; origin[this.clip.ai] = this.clip.cut;
    const normal = [0, 0, 0]; normal[this.clip.ai] = this.clip.flip ? -1 : 1;
    it.mapper.addClippingPlane(vtkPlane.newInstance({ origin, normal }));
  }

  /** Caja que envuelve todas las mallas visibles (null si no hay). */
  bounds() {
    let b = null;
    for (const it of this.items) {
      if (!it.visible) continue;
      const c = it.bounds;
      b = b ? [Math.min(b[0], c[0]), Math.max(b[1], c[1]), Math.min(b[2], c[2]), Math.max(b[3], c[3]), Math.min(b[4], c[4]), Math.max(b[5], c[5])] : c.slice();
    }
    return b;
  }

  /**
   * Intersección rayo-malla más cercana (Möller–Trumbore sobre todos los triángulos visibles).
   * start, dir (unitario); maxT = no buscar más lejos; kept(w) = respeta el corte. → { t, w } | null
   */
  pick(start, dir, maxT = Infinity, kept = null, onlyId = null) {
    let best = null;
    for (const it of this.items) {
      if (onlyId ? it.id !== onlyId : !it.visible) continue;
      if (!rayHitsBox(start, dir, it.bounds, maxT)) continue;
      const pts = it.pts, P = it.polys;
      const [ox, oy, oz] = start, [dx, dy, dz] = dir;
      for (let t = 0; t < P.length; t += 3) {
        const a = 3 * P[t], b = 3 * P[t + 1], c = 3 * P[t + 2];
        const ax = pts[a], ay = pts[a + 1], az = pts[a + 2];
        const e1x = pts[b] - ax, e1y = pts[b + 1] - ay, e1z = pts[b + 2] - az;
        const e2x = pts[c] - ax, e2y = pts[c + 1] - ay, e2z = pts[c + 2] - az;
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-12 && det < 1e-12) continue;
        const inv = 1 / det;
        const tx = ox - ax, ty = oy - ay, tz = oz - az;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt <= 0 || tt >= maxT) continue;
        const w = [ox + dx * tt, oy + dy * tt, oz + dz * tt];
        if (kept && !kept(w)) continue;
        maxT = tt; best = { t: tt, w, id: it.id };
      }
    }
    return best;
  }
}

function mul4(A, B) {                     // A·B, matrices 4×4 fila-mayor
  const C = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) C[4 * i + j] += A[4 * i + k] * B[4 * k + j];
  return C;
}

function rayHitsBox(o, d, b, maxT) {
  let tmin = 0, tmax = maxT;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) { if (o[i] < b[2 * i] || o[i] > b[2 * i + 1]) return false; continue; }
    let t1 = (b[2 * i] - o[i]) / d[i], t2 = (b[2 * i + 1] - o[i]) / d[i];
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/**
 * STL BINARIO de una malla TAL Y COMO ESTÁ AHORA (`item.pts` ya lleva aplicados el giro, la alineación y
 * los volteos, así que se exporta en el marco del paciente, igual que se ve en pantalla).
 * Devuelve un ArrayBuffer listo para descargar. 84 bytes de cabecera + 50 por triángulo.
 */
/** PLY binario (little endian) con el color por vértice si lo hay (v0.8.4: los escáneres con color van así en el paquete). */
export function writePLY(item, comment = 'tresD DICOM') {
  const pts = item.pts, P = item.polys, n = pts.length / 3, nTri = P.length / 3, col = item.colors && item.colors.length === pts.length ? item.colors : null;
  const header = ['ply', 'format binary_little_endian 1.0', `comment ${comment}`, `element vertex ${n}`, 'property float x', 'property float y', 'property float z']
    .concat(col ? ['property uchar red', 'property uchar green', 'property uchar blue'] : [])
    .concat([`element face ${nTri}`, 'property list uchar int vertex_indices', 'end_header', '']).join('\n');
  const head = new TextEncoder().encode(header);
  const vs = col ? 15 : 12;
  const buf = new ArrayBuffer(head.length + n * vs + nTri * 13);
  new Uint8Array(buf).set(head, 0);
  const dv = new DataView(buf);
  let o = head.length;
  for (let i = 0; i < n; i++) {
    dv.setFloat32(o, pts[3 * i], true); dv.setFloat32(o + 4, pts[3 * i + 1], true); dv.setFloat32(o + 8, pts[3 * i + 2], true); o += 12;
    if (col) { dv.setUint8(o, col[3 * i]); dv.setUint8(o + 1, col[3 * i + 1]); dv.setUint8(o + 2, col[3 * i + 2]); o += 3; }
  }
  for (let t = 0; t < P.length; t += 3) { dv.setUint8(o, 3); dv.setInt32(o + 1, P[t], true); dv.setInt32(o + 5, P[t + 1], true); dv.setInt32(o + 9, P[t + 2], true); o += 13; }
  return buf;
}

export function writeSTL(item, header = 'tresD DICOM') {
  const pts = item.pts, P = item.polys, nTri = P.length / 3;
  const buf = new ArrayBuffer(84 + 50 * nTri);
  const dv = new DataView(buf), head = new Uint8Array(buf, 0, 80);
  for (let i = 0; i < 80 && i < header.length; i++) head[i] = header.charCodeAt(i) & 0x7f;
  dv.setUint32(80, nTri, true);
  let o = 84;
  for (let t = 0; t < P.length; t += 3) {
    const a = 3 * P[t], b = 3 * P[t + 1], c = 3 * P[t + 2];
    const ux = pts[b] - pts[a], uy = pts[b + 1] - pts[a + 1], uz = pts[b + 2] - pts[a + 2];
    const vx = pts[c] - pts[a], vy = pts[c + 1] - pts[a + 1], vz = pts[c + 2] - pts[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true); o += 12;
    for (const v of [a, b, c]) { dv.setFloat32(o, pts[v], true); dv.setFloat32(o + 4, pts[v + 1], true); dv.setFloat32(o + 8, pts[v + 2], true); o += 12; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return buf;
}
