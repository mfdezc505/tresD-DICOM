// tresD DICOM — PRESETS de render del volumen (portados de realistic_render.py de VOXEL).
//   default  Estándar: tono hueso gris + opacidad sigmoide (look por defecto de VOXEL)
//   ivory    Blanco marfil hiperrealista (hueso blanco brillante)
//   natural  Hueso natural (cráneo seco beige mate, recovecos oscuros)
//   radio    Radiográfico cálido / cristal (naranja translúcido, estructuras internas)
//   gray     Gris Anatomage (gris neutro semitransparente)
//   soft     Tejido blando: cáscara de la piel translúcida + hueso opaco (v0.7)
//   airway   Vía aérea: hueso translúcido azulado, para ver la malla de la vía aérea (v0.7)
// El estado {preset, lo, hi, opacity} se aplica ENTERO cada vez: brillo/contraste mueven la
// ventana (lo, hi) del preset sin perder su aspecto, y la transparencia escala la opacidad.
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { otsu, autoThresholds } from './stats.js';

export const PRESETS = ['default', 'ivory', 'natural', 'radio', 'gray', 'soft', 'airway', 'grid'];   // grid = nube de puntos (pointCloud.js, v0.8.3)

// (fracción de la ventana, r, g, b) y (fracción, opacidad); gradiente = rampa lineal (mín/máx).
// unitScale: factor sobre la distancia unidad de opacidad (< 1 = cada muestra del rayo pesa más → superficie
// OPACA). Los presets de hueso (marfil, natural, gris) llevan la opacidad a 1 poco por encima del umbral de
// hueso y SIN opacidad por gradiente: en vtk.js, con la curva original de VOXEL y el volumen de render
// suavizado, el hueso salía semitransparente (se veían las raíces a través de la mandíbula).
const BONE_OTF = [[0.00, 0.0], [0.20, 0.0], [0.36, 0.75], [0.60, 1.0], [1.00, 1.0]];
const DEF = {
  ivory: {
    shade: [0.45, 0.85, 0.25, 25.0],
    ctf: [[0.00, 0.05, 0.045, 0.04], [0.20, 0.72, 0.69, 0.65], [0.36, 0.90, 0.885, 0.86],
      [0.60, 0.965, 0.96, 0.945], [0.80, 0.99, 0.988, 0.982], [1.00, 1.0, 1.0, 0.996]],
    otf: BONE_OTF, grad: null, unitScale: 0.4,
  },
  natural: {
    shade: [0.42, 0.85, 0.10, 12.0],
    ctf: [[0.00, 0.05, 0.04, 0.03], [0.20, 0.62, 0.53, 0.42], [0.36, 0.78, 0.70, 0.55],
      [0.60, 0.86, 0.80, 0.66], [0.80, 0.90, 0.85, 0.72], [1.00, 0.95, 0.92, 0.82]],
    otf: BONE_OTF, grad: null, unitScale: 0.4,
  },
  // TEJIDO BLANDO: la piel como una película translúcida (solo su cáscara) y el hueso opaco debajo. La ventana
  // va del umbral aire/cuerpo (piel, f = 0,10) al hueso cortical (f = 0,72) (skinWindow).
  soft: {
    shade: [0.42, 0.85, 0.12, 18.0],
    ctf: [[0.00, 0.30, 0.20, 0.16], [0.10, 0.88, 0.68, 0.58], [0.19, 0.90, 0.74, 0.64], [0.55, 0.94, 0.90, 0.84],
      [0.68, 0.97, 0.965, 0.95], [1.00, 1.0, 1.0, 0.996]],
    // solo la CÁSCARA de la piel (transición aire→piel, f 0,10-0,14) es visible; el interior blando (grasa,
    // músculo: f 0,19-0,55) queda a 0 para no crear neblina, y el hueso es opaco
    otf: [[0.00, 0.0], [0.07, 0.0], [0.10, 0.30], [0.14, 0.30], [0.19, 0.0], [0.55, 0.0], [0.68, 0.9], [1.00, 1.0]],
    grad: null, unitScale: 0.6,
  },
  // VÍA AÉREA: solo hueso, translúcido azulado, para ver la malla de la vía aérea dentro de la faringe; misma
  // ventana que el tejido blando.
  airway: {
    shade: [0.50, 0.70, 0.05, 10.0],
    ctf: [[0.00, 0.30, 0.34, 0.40], [0.10, 0.74, 0.78, 0.84], [0.55, 0.84, 0.86, 0.90], [0.68, 0.93, 0.94, 0.96], [1.00, 1.0, 1.0, 1.0]],
    // solo hueso, translúcido azulado (sin piel: hasta una cáscara tenue tapaba la faringe con neblina)
    otf: [[0.00, 0.0], [0.55, 0.0], [0.68, 0.28], [1.00, 0.4]],
    grad: null, unitScale: 0.5,
  },
  radio: {
    shade: [0.55, 0.55, 0.15, 10.0],
    ctf: [[0.00, 0.0, 0.0, 0.0], [0.15, 0.28, 0.15, 0.07], [0.40, 0.62, 0.40, 0.20],
      [0.65, 0.85, 0.65, 0.38], [0.85, 0.96, 0.86, 0.62], [1.00, 1.0, 0.98, 0.90]],
    otf: [[0.00, 0.0], [0.10, 0.0], [0.30, 0.03], [0.60, 0.10], [0.85, 0.26], [1.00, 0.60]],
    grad: [0, 0.30, 110, 0.95],
  },
  gray: {
    shade: [0.42, 0.85, 0.15, 15.0],
    ctf: [[0.00, 0.06, 0.06, 0.07], [0.20, 0.42, 0.42, 0.43], [0.36, 0.58, 0.58, 0.59], [0.60, 0.74, 0.74, 0.75],
      [0.80, 0.85, 0.85, 0.86], [1.00, 0.95, 0.95, 0.96]],
    otf: BONE_OTF, grad: null, unitScale: 0.4,
  },
  default: {
    shade: [0.40, 0.85, 0.15, 15.0],
    // cmap "bone" de matplotlib (aprox.) sobre la ventana
    ctf: [[0.00, 0.0, 0.0, 0.0], [0.375, 0.32, 0.32, 0.45], [0.75, 0.66, 0.78, 0.78], [1.00, 1.0, 1.0, 1.0]],
    // sigmoide (opacity='sigmoid' de PyVista) centrada en la ventana
    otf: sigmoidNodes(),
    grad: null,
  },
};

function sigmoidNodes() {
  const out = [];
  for (let i = 0; i <= 10; i++) {
    const f = i / 10;
    const y = 1 / (1 + Math.exp(-(f - 0.5) * 10));
    out.push([f, Math.max(0, (y - 0.0067) / (0.9933 - 0.0067))]);
  }
  return out;
}

/** Percentil de una muestra ORDENADA. */
function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Muestra ordenada del volumen (~600k valores) para calcular ventanas por percentiles
 * aunque el DICOM tenga una escala rara. Ignora nada: se filtra después según el preset.
 */
export function sampleSorted(scalars, target = 600000) {
  const n = scalars.length;
  const stride = Math.max(1, Math.floor(n / target));
  const m = Math.floor(n / stride);
  const out = new Float32Array(m);
  for (let i = 0, j = 0; j < m; i += stride, j++) out[j] = scalars[i];
  return out.sort();
}

export { otsu };

// Dónde debe caer cada hito del volumen dentro de la ventana de cada preset:
//  fT = fracción donde EMPIEZA la opacidad (umbral tejido blando / hueso), fB = fracción donde el
//  hueso cortical ya es opaco y blanco (percentil 90 del hueso). Así el aspecto no depende de la escala del escáner.
const ANCHORS = { ivory: [0.22, 0.68], natural: [0.22, 0.68], gray: [0.22, 0.68], radio: [0.10, 0.85], default: [0.25, 0.75] };
// presets con PIEL: fS = fracción donde cae el umbral aire/cuerpo (piel), fB = hueso cortical
const SKIN_ANCHORS = { soft: [0.10, 0.72], airway: [0.10, 0.72] };

/**
 * Ventana (lo, hi) adecuada al preset a partir de los DATOS: umbral hueso/tejido (Otsu sobre lo
 * que no es aire) y hueso cortical (percentil 90 de lo que supera el umbral). Antes se usaban
 * percentiles fijos (35 %-99 %) como VOXEL, pero en CBCT reales el 99 % cae en esmalte/metal y el
 * hueso quedaba gris y translúcido (muy contrastado).
 */
export function windowFor(sorted, preset) {
  if (SKIN_ANCHORS[preset]) return skinWindow(sorted, SKIN_ANCHORS[preset]);
  const [fT, fB] = ANCHORS[preset] || ANCHORS.ivory;
  let start = 0;
  while (start < sorted.length && sorted[start] <= -400) start++;
  const tissue = sorted.subarray(start);
  if (tissue.length < 100) return [300, 2200];
  const top = pct(tissue, 99.8);
  const T = otsu(tissue, tissue[0], top);
  let bStart = 0;
  while (bStart < tissue.length && tissue[bStart] < T) bStart++;
  const bone = tissue.subarray(bStart);
  const B90 = bone.length > 50 ? pct(bone, 90) : T + 800;
  const rng = Math.max(200, (B90 - T) / (fB - fT));
  const lo = T - fT * rng;
  return [lo, lo + rng];
}

/** Ventana para los presets con piel: el umbral aire/cuerpo cae en fS y el hueso cortical (p90) en fB. */
function skinWindow(sorted, [fS, fB]) {
  const { soft: S, bone: T } = autoThresholds(sorted);
  let bStart = 0;
  while (bStart < sorted.length && sorted[bStart] < T) bStart++;
  const bone = sorted.subarray(bStart);
  const B90 = bone.length > 50 ? pct(bone, 90) : T + 800;
  const rng = Math.max(300, (B90 - S) / (fB - fS));
  const lo = S - fS * rng;
  return [lo, lo + rng];
}

/** Rango robusto de TODO el volumen (percentiles 2 / 98) para deslizadores. */
export function robustRange(sorted) {
  const lo = pct(sorted, 2), hi = pct(sorted, 98);
  return [Math.min(lo, pct(sorted, 50)), Math.max(hi, lo + 1)];
}

/**
 * Aplica el estado completo al actor de volumen vtk.js.
 * state = { preset, lo, hi, opacity (0..1) }
 */
export function applyState(actor, state) {
  const base = DEF[state.preset] || DEF.ivory;
  // `tune` (opcional): ajustes finos {shade:[amb,dif,spec,pow], grad:[...], normalFromOpacity}
  const d = Object.assign({}, base, state.tune || {});
  const prop = actor.getProperty();
  try { prop.setComputeNormalFromOpacity(!!d.normalFromOpacity); } catch (e) { /* version antigua */ }
  const lo = state.lo, hi = Math.max(state.hi, lo + 1), rng = hi - lo;
  const P = (f) => lo + f * rng;
  const op = Math.max(0, Math.min(1, state.opacity ?? 1));

  const ctf = vtkColorTransferFunction.newInstance();
  for (const [f, r, g, b] of d.ctf) ctf.addRGBPoint(P(f), r, g, b);
  prop.setRGBTransferFunction(0, ctf);

  const otf = vtkPiecewiseFunction.newInstance();
  for (const [f, y] of d.otf) otf.addPoint(P(f), y * op);
  prop.setScalarOpacity(0, otf);

  if (d.grad) {
    prop.setUseGradientOpacity(0, true);
    prop.setGradientOpacityMinimumValue(0, d.grad[0]);
    prop.setGradientOpacityMinimumOpacity(0, d.grad[1]);
    prop.setGradientOpacityMaximumValue(0, d.grad[2]);
    prop.setGradientOpacityMaximumOpacity(0, d.grad[3]);
  } else {
    prop.setUseGradientOpacity(0, false);
  }
  const [amb, dif, spec, pow] = d.shade;
  prop.setShade(true);
  prop.setAmbient(amb); prop.setDiffuse(dif); prop.setSpecular(spec); prop.setSpecularPower(pow);
  prop.setInterpolationTypeToLinear();
  // unitScale < 1 = cada muestra del rayo cuenta más (superficie más OPACA), sin tocar la curva
  try { prop.setScalarOpacityUnitDistance(0, (state.unitDistance || 1.0) * (d.unitScale || 1)); } catch (e) { /* opcional */ }
  return { lo, hi };
}

/** Umbral HU a partir del cual el preset empieza a ser opaco (para el picking 3D de mediciones). */
export function opaqueThreshold(state) {
  const d = DEF[state.preset] || DEF.ivory;
  const rng = Math.max(1, state.hi - state.lo);
  const first = d.otf.find(([, y]) => y > 0.02);
  const f = first ? first[0] : 0.4;
  return state.lo + f * rng;
}
