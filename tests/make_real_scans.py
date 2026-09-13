"""«Escáneres» REALISTAS sacados del propio CBCT DZ (muestra pública de 3D Slicer) para probar la
alineación escáner→CBCT con dientes REALES (forma, apiñamiento, metal en molares):
  - superficie a 600 HU (dientes + hueso alveolar como «encía») a resolución completa (0,25 mm) dentro
    de la caja dental; se separa en arcada SUPERIOR (por encima de la línea oclusal) e INFERIOR;
  - cada arcada se guarda como STL en una POSE ALEATORIA conocida (marco propio del escáner), con la
    pose verdadera en pose.json (para medir el error tras alinear).
Escribe /tmp/testdata/real_scans/{upper,lower}.stl + pose.json (y la versión sin mover *_world.stl).
Uso: python3 tests/make_real_scans.py
"""
import json, os, struct
import numpy as np
import nrrd
from skimage import measure

SRC = "/tmp/testdata/DZ-CBCT.nrrd"
OUT = "/tmp/testdata/real_scans"
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)

data, hdr = nrrd.read(SRC)
D = np.array(hdr["space directions"], float)     # filas = vectores de los ejes i, j, k (LPS, con espaciado)
origin = np.array(hdr["space origin"], float)
a = data.astype(np.float32)
hi = np.percentile(a, 99.9)
idx = np.argwhere(a >= hi)
c = np.median(idx, 0)
d = np.linalg.norm((idx - c) * 0.25, axis=1)
idx = idx[d < np.percentile(d, 85)]
c = np.median(idx, 0).astype(int)                 # centro de la dentición (índices)
print("ancla ijk", c, "mundo", origin + c @ D)
# caja dental (índices): ±40 mm lateral (i), ±36 mm AP (j), ±26 mm vertical (k) a 0,25 mm
hw = (int(40 / 0.25), int(36 / 0.25), int(26 / 0.25))
lo = [max(0, c[q] - hw[q]) for q in range(3)]; hi_ = [min(a.shape[q], c[q] + hw[q]) for q in range(3)]
box = a[lo[0]:hi_[0], lo[1]:hi_[1], lo[2]:hi_[2]]
print("caja", box.shape)
verts, faces, _n, _v = measure.marching_cubes(box, level=600.0, step_size=2)     # 0,5 mm: ~250 k triángulos, como un escáner real
print("superficie 600 HU:", len(verts), "vértices", len(faces), "triángulos")
# índices → mundo
vw = origin + (verts + np.array(lo)) @ D
# línea oclusal: mediana de la altura (z LPS) de los vóxeles de esmalte (≥ p99,9) de la caja
ez = (origin + idx @ D)[:, 2]
mid = float(np.median(ez))
print("línea oclusal z =", mid)

def split(keep_mask, name):
    fm = keep_mask[faces].all(1)
    f2 = faces[fm]
    used = np.unique(f2)
    remap = -np.ones(len(vw), int); remap[used] = np.arange(len(used))
    V = vw[used]; F = remap[f2]
    # solo componentes grandes (quita ruido / islas)
    parent = np.arange(len(V))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for tri in F:
        ra, rb, rc = find(tri[0]), find(tri[1]), find(tri[2])
        parent[ra] = rb; parent[find(rb)] = rc
    roots = np.array([find(i) for i in range(len(V))])
    cnt = np.bincount(roots[F[:, 0]], minlength=len(V))
    big = np.where(cnt > 2000)[0]
    fm2 = np.isin(roots[F[:, 0]], big)
    F = F[fm2]; used = np.unique(F)
    remap = -np.ones(len(V), int); remap[used] = np.arange(len(used))
    V = V[used]; F = remap[F]
    print(name, len(V), "vértices", len(F), "triángulos", "componentes grandes", len(big))
    return V, F

def write_stl(path, V, F):
    P0, P1, P2 = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    N = np.cross(P1 - P0, P2 - P0); N /= (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)
    rec = np.zeros(len(F), dtype=[("n", "<f4", 3), ("a", "<f4", 3), ("b", "<f4", 3), ("c", "<f4", 3), ("attr", "<u2")])
    rec["n"] = N; rec["a"] = P0; rec["b"] = P1; rec["c"] = P2
    with open(path, "wb") as f:
        f.write(b"tresD pseudo-scan".ljust(80, b"\0")); f.write(struct.pack("<I", len(F))); f.write(rec.tobytes())

def rand_pose():
    q = rng.normal(size=4); q /= np.linalg.norm(q)
    w, x, y, z = q
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    t = rng.uniform(-40, 40, 3)
    return R, t

pose = {"mid_occ": mid}
R, t = rand_pose()                           # las DOS arcadas en el MISMO marco (como las exporta un escáner intraoral, en oclusión)
# altura como un escáner real: coronas (~10 mm) + «encía» (~6 mm); no 26 mm de hueso
for name, mask in (("upper", (vw[:, 2] >= mid - 0.5) & (vw[:, 2] <= mid + 16)), ("lower", (vw[:, 2] <= mid + 0.5) & (vw[:, 2] >= mid - 16))):
    V, F = split(mask, name)
    write_stl(os.path.join(OUT, name + "_world.stl"), V, F)
    Vs = V @ R.T + t                         # p_scan = R·p_world + t  →  el visor debe recuperar p_world
    write_stl(os.path.join(OUT, name + ".stl"), Vs, F)
    pose[name] = {"R": R.tolist(), "t": t.tolist(), "n": int(len(V))}
json.dump(pose, open(os.path.join(OUT, "pose.json"), "w"), indent=1)
# volcado del volumen para tests/align_node.mjs (Node, sin navegador): orden (k, j, i) como los cortes del visor
for step, name in ((2, "dz_half"), (1, "dz_full")):
    sub = data[::step, ::step, ::step]
    np.ascontiguousarray(sub.transpose(2, 1, 0)).astype(np.int16).tofile(f"/tmp/testdata/{name}.raw")
    json.dump({"dims": list(sub.shape), "origin": origin.tolist(), "axes": (D * step).tolist()}, open(f"/tmp/testdata/{name}.json", "w"))
print("hecho →", OUT, "+ dz_half/dz_full .raw/.json")
