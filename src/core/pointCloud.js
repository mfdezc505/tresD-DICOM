// tresD DICOM — render «REJILLA» (v0.8.3): el hueso como NUBE DE PUNTOS, al estilo del modo de puntos de VOXEL
// (`style="points"` de PyVista). Se toman los vóxeles del volumen de render (≤ 400 por eje) por encima de un
// umbral (el «brillo» del preset = límite inferior de la ventana) y se pintan como puntos de 2 px con un gris
// según su intensidad. Si hay más de MAX_PTS vóxeles se salta uno de cada `stride` por eje (rejilla más rala).
// v0.8.4: debajo de los puntos va la superficie del hueso en ALAMBRE (marching cubes sobre el volumen submuestreado
// al mismo `stride`), con los triángulos sutiles (gris translúcido), que es lo que da el aspecto de rejilla.
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';

const MAX_PTS = 1500000;

/**
 * Superficie del hueso en alambre (v0.8.4): marching cubes al umbral sobre el volumen tomado cada `stride` vóxeles
 * (el doble que los puntos: con la malla al mismo paso, de lejos las líneas se funden en un relleno macizo).
 * Devuelve { actor, tris } o null.
 */
export function buildWireframe(data, dims, o, e, thr, stride) {
  const [nx, ny, nz] = dims;
  const mx = Math.ceil(nx / stride), my = Math.ceil(ny / stride), mz = Math.ceil(nz / stride);
  if (mx < 2 || my < 2 || mz < 2) return null;
  const sub = new Float32Array(mx * my * mz);
  for (let K = 0; K < mz; K++) { const k = K * stride; for (let J = 0; J < my; J++) { const base = (k * ny + J * stride) * nx, ob = (K * my + J) * mx; for (let I = 0; I < mx; I++) sub[ob + I] = data[base + I * stride]; } }
  const img = vtkImageData.newInstance();
  img.setDimensions(mx, my, mz); img.setSpacing(stride, stride, stride);        // salida en unidades de ÍNDICE del volumen
  img.getPointData().setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values: sub }));
  const mc = vtkImageMarchingCubes.newInstance({ contourValue: thr, computeNormals: false, mergePoints: true });
  mc.setInputData(img);
  const pd = mc.getOutputData();
  const P = pd.getPoints().getData(), n = P.length / 3;
  if (!n) return null;
  for (let q = 0; q < P.length; q += 3) {                                       // índice (i, j, k) → mundo
    const i = P[q], j = P[q + 1], k = P[q + 2];
    P[q] = o[0] + e[0][0] * i + e[1][0] * j + e[2][0] * k;
    P[q + 1] = o[1] + e[0][1] * i + e[1][1] * j + e[2][1] * k;
    P[q + 2] = o[2] + e[0][2] * i + e[1][2] * j + e[2][2] * k;
  }
  pd.getPoints().dataChange();
  const mapper = vtkMapper.newInstance(); mapper.setInputData(pd); mapper.setScalarVisibility(false);
  const actor = vtkActor.newInstance(); actor.setMapper(mapper);
  const prop = actor.getProperty();
  prop.setRepresentationToWireframe(); prop.setColor(0.62, 0.68, 0.76); prop.setOpacity(0.22); prop.setLineWidth(1); prop.setLighting(false);
  return { actor, tris: pd.getPolys().getNumberOfCells() };
}

/**
 * data = escalares del volumen (i más rápido), dims [nx,ny,nz], o = origen (mundo), e = [e0,e1,e2] (vector de
 * un paso de índice en cada eje, mundo), thr = umbral (mismas unidades que data), hi = valor que se pinta blanco.
 * Devuelve { actor, n, stride } (n = puntos) o null si no hay hueso.
 */
export function buildPointCloud(data, dims, o, e, thr, hi) {
  const [nx, ny, nz] = dims;
  // solo la SUPERFICIE del hueso (vóxeles ≥ umbral con algún vecino por debajo): así se ve una rejilla de puntos y
  // no un bloque macizo, y hay 10 veces menos puntos
  const nxy = nx * ny;
  const surf = (i, j, k, idx) => (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1
    || data[idx - 1] < thr || data[idx + 1] < thr || data[idx - nx] < thr || data[idx + nx] < thr || data[idx - nxy] < thr || data[idx + nxy] < thr);
  let count = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { const b = k * nxy + j * nx; for (let i = 0; i < nx; i++) { const idx = b + i; if (data[idx] >= thr && surf(i, j, k, idx)) count++; } }
  if (!count) return null;
  const stride = Math.max(2, Math.ceil(Math.cbrt(count / MAX_PTS)));   // mínimo 2: se ve la rejilla (uno de cada dos vóxeles por eje)
  const cap = Math.ceil(count / (stride * stride * stride)) + 16;
  const pts = new Float32Array(cap * 3);
  const val = new Float32Array(cap);          // Float32: los uchar de 1 componente vtk.js los toma como color directo (y no se ven)
  const rng = Math.max(1, hi - thr);
  let n = 0;
  for (let k = 0; k < nz; k += stride) {
    const bk = k * nx * ny;
    for (let j = 0; j < ny; j += stride) {
      const bj = bk + j * nx;
      for (let i = 0; i < nx; i += stride) {
        const v = data[bj + i];
        if (v < thr || !surf(i, j, k, bj + i)) continue;
        if (n >= cap) break;
        pts[3 * n] = o[0] + e[0][0] * i + e[1][0] * j + e[2][0] * k;
        pts[3 * n + 1] = o[1] + e[0][1] * i + e[1][1] * j + e[2][1] * k;
        pts[3 * n + 2] = o[2] + e[0][2] * i + e[1][2] * j + e[2][2] * k;
        val[n] = Math.max(0, Math.min(255, Math.round(((v - thr) / rng) * 255)));
        n++;
      }
    }
  }
  const pd = vtkPolyData.newInstance();
  pd.getPoints().setData(pts.subarray(0, 3 * n), 3);
  const verts = new Uint32Array(2 * n);
  for (let i = 0; i < n; i++) { verts[2 * i] = 1; verts[2 * i + 1] = i; }
  pd.getVerts().setData(verts);
  pd.getPointData().setScalars(vtkDataArray.newInstance({ name: 'gris', numberOfComponents: 1, values: val.subarray(0, n) }));
  const ctf = vtkColorTransferFunction.newInstance();
  ctf.addRGBPoint(0, 0.42, 0.44, 0.48); ctf.addRGBPoint(140, 0.80, 0.80, 0.82); ctf.addRGBPoint(255, 1, 1, 1);
  const mapper = vtkMapper.newInstance();
  mapper.setInputData(pd);
  mapper.setLookupTable(ctf); mapper.setUseLookupTableScalarRange(false); mapper.setScalarRange(0, 255);
  mapper.setScalarVisibility(true); mapper.setColorModeToMapScalars();
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  const prop = actor.getProperty();
  prop.setRepresentationToPoints(); prop.setPointSize(2); prop.setLighting(false);
  return { actor, n, stride };
}
