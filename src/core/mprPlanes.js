// tresD DICOM — CORTES MPR DENTRO DEL RENDER 3D (tarjeta "Cortes MPR" del panel derecho de VOXEL).
// Cada plano (axial z / coronal y / sagital x) es un CUADRADO TEXTURIZADO: se muestrea el volumen
// en el plano a resolución nativa (a través del VoxelManager de Cornerstone, sin copiar el volumen),
// se aplica la ventana (nivel/ancho) y se pinta como textura. Independientes entre sí y del render.
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPlaneSource from '@kitware/vtk.js/Filters/Sources/PlaneSource';
import vtkTexture from '@kitware/vtk.js/Rendering/Core/Texture';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

const AX = { x: 0, y: 1, z: 2 };

export class MprPlanes {
  constructor(getViewport, getVolume) {
    this.getViewport = getViewport; this.getVolume = getVolume;
    this.planes = {};          // axis -> { uid, actor, texture, frac }
    this.window = { lower: -600, upper: 1400 };
  }

  set(axis, on, frac, window) {
    const vp = this.getViewport(); const vol = this.getVolume();
    if (!vp || !vol) return;
    if (window) this.window = window;
    const cur = this.planes[axis];
    if (!on) {
      if (cur) { try { vp.removeActors([cur.uid]); } catch (e) { /* nada */ } delete this.planes[axis]; vp.render(); }
      return;
    }
    const f = Math.max(0, Math.min(1, frac ?? (cur ? cur.frac : 0.5)));
    const { imageData, texture, origin, p1, p2 } = this._sample(vol, axis, f);
    if (cur) {
      cur.frac = f;
      cur.src.setOrigin(...origin); cur.src.setPoint1(...p1); cur.src.setPoint2(...p2);
      cur.texture.setInputData(imageData); cur.texture.modified();
    } else {
      const src = vtkPlaneSource.newInstance({ xResolution: 1, yResolution: 1 });
      src.setOrigin(...origin); src.setPoint1(...p1); src.setPoint2(...p2);
      const mapper = vtkMapper.newInstance(); mapper.setInputConnection(src.getOutputPort());
      const actor = vtkActor.newInstance(); actor.setMapper(mapper);
      actor.getProperty().setLighting(false);
      actor.addTexture(texture);
      const uid = 'mpr_' + axis;
      vp.addActor({ uid, actor });
      this.planes[axis] = { uid, actor, texture, src, frac: f };
    }
    vp.render();
  }

  setWindow(window) {
    this.window = window;
    for (const axis of Object.keys(this.planes)) this.set(axis, true, this.planes[axis].frac);
  }

  clear() {
    const vp = this.getViewport();
    const uids = Object.values(this.planes).map((p) => p.uid);
    if (vp && uids.length) { try { vp.removeActors(uids); } catch (e) { /* nada */ } }
    this.planes = {};
  }

  /** Muestrea el plano `axis` a la fracción `f` de los límites del volumen -> textura RGB 8 bits. */
  _sample(vol, axis, f) {
    const img = vol.imageData; const vm = vol.voxelManager;
    const b = img.getBounds(); const dims = img.getDimensions();
    const ai = AX[axis];
    const [u, v] = [[1, 2], [0, 2], [0, 1]][ai];          // ejes del plano (mundo)
    const pos = b[2 * ai] + f * (b[2 * ai + 1] - b[2 * ai]);
    const res = Math.min(...vol.spacing);
    const nu = Math.max(2, Math.round((b[2 * u + 1] - b[2 * u]) / res));
    const nv = Math.max(2, Math.round((b[2 * v + 1] - b[2 * v]) / res));
    const lo = this.window.lower, hi = Math.max(this.window.upper, lo + 1), sc = 255 / (hi - lo);
    const data = new Uint8Array(nu * nv * 3);
    const w = [0, 0, 0], idx = [0, 0, 0];
    w[ai] = pos;
    let minv = Infinity;
    for (let jv = 0; jv < nv; jv++) {
      w[v] = b[2 * v] + (jv + 0.5) * res;
      for (let iu = 0; iu < nu; iu++) {
        w[u] = b[2 * u] + (iu + 0.5) * res;
        img.worldToIndex(w, idx);
        const i = Math.round(idx[0]), j = Math.round(idx[1]), k = Math.round(idx[2]);
        let g = 0;
        if (i >= 0 && j >= 0 && k >= 0 && i < dims[0] && j < dims[1] && k < dims[2]) {
          const val = vm.getAtIJK(i, j, k);
          if (val < minv) minv = val;
          g = Math.max(0, Math.min(255, Math.round((val - lo) * sc)));
        }
        const o = 3 * (jv * nu + iu);
        data[o] = g; data[o + 1] = g; data[o + 2] = g;
      }
    }
    const imageData = vtkImageData.newInstance();
    imageData.setDimensions(nu, nv, 1);
    imageData.getPointData().setScalars(vtkDataArray.newInstance({ numberOfComponents: 3, values: data, name: 'rgb' }));
    const texture = vtkTexture.newInstance(); texture.setInterpolate(true); texture.setInputData(imageData);
    const origin = [0, 0, 0], p1 = [0, 0, 0], p2 = [0, 0, 0];
    origin[ai] = p1[ai] = p2[ai] = pos;
    origin[u] = b[2 * u]; origin[v] = b[2 * v];
    p1[u] = b[2 * u + 1]; p1[v] = b[2 * v];
    p2[u] = b[2 * u]; p2[v] = b[2 * v + 1];
    return { imageData, texture, origin, p1, p2 };
  }
}
