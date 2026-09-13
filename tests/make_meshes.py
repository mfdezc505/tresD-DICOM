# Genera ARCADAS SINTÉTICAS para probar la Fase 2 (escáneres): un heightfield en forma de U con
# "dientes" (bultos gaussianos) y bóveda palatina, girado al azar para probar la autorientación.
#   /tmp/testdata/meshes/arch_upper.stl     arcada superior, mm, STL binario, giro aleatorio
#   /tmp/testdata/meshes/arch_lower.ply     arcada inferior EN OCLUSIÓN con la superior (mismo giro), PLY ASCII con colores
#   /tmp/testdata/meshes/arch_cm.stl        la superior en CENTÍMETROS (prueba de escala)
#   /tmp/testdata/meshes/arch_islands.stl   la superior + trozo suelto pequeño (prueba de islas)
#   /tmp/testdata/meshes/arch_upper.obj     la superior en OBJ
#   /tmp/testdata/meshes/frame.json         giro y puntos de control (para tests/orient.mjs)
import json, os, struct
import numpy as np

OUT = '/tmp/testdata/meshes'
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)


def arch(step=0.6, teeth_up=True):
    xs = np.arange(-32, 32 + 1e-6, step); ys = np.arange(-6, 46 + 1e-6, step)
    X, Y = np.meshgrid(xs, ys)
    cx, cy, r_in, r_out = 0.0, 10.0, 18.0, 28.0
    R = np.hypot(X - cx, Y - cy)
    round_part = Y >= cy
    on_arch = np.where(round_part, (R >= r_in) & (R <= r_out), (np.abs(X) >= r_in) & (np.abs(X) <= r_out))
    inner = np.where(round_part, R < r_in, np.abs(X) < r_in)
    mask = on_arch | inner
    Z = np.zeros_like(X)
    # bóveda (paladar): cóncava hacia los dientes → se hunde hacia -z
    depth = np.where(round_part, 1 - (R / r_in) ** 2, 1 - (X / r_in) ** 2)
    Z = np.where(inner, -12 * np.clip(depth, 0, 1), Z)
    # dientes: bultos a lo largo de la línea media de la arcada (r = 23)
    tips = []
    rc = 23.0
    for ang in np.linspace(0, np.pi, 9):
        tips.append((cx + rc * np.cos(ang), cy + rc * np.sin(ang)))
    for yy in np.arange(cy - 7, -6, -7):
        tips.append((-rc, yy)); tips.append((rc, yy))
    tips = np.array(tips)
    for (tx, ty) in tips:
        Z += 7 * np.exp(-((X - tx) ** 2 + (Y - ty) ** 2) / (2 * 2.6 ** 2)) * on_arch
    # ligera inclinación del plano oclusal (los molares algo más altos) para que no sea trivial
    Z += 0.05 * (cy - Y) * on_arch
    if not teeth_up:
        Z = -Z
    pts = np.stack([X, Y, Z], -1)
    ny, nx = X.shape
    idx = np.arange(ny * nx).reshape(ny, nx)
    tris = []
    m = mask
    for j in range(ny - 1):
        for i in range(nx - 1):
            a, b, c, d = idx[j, i], idx[j, i + 1], idx[j + 1, i], idx[j + 1, i + 1]
            if m[j, i] and m[j, i + 1] and m[j + 1, i]: tris.append((a, b, c))
            if m[j, i + 1] and m[j + 1, i + 1] and m[j + 1, i]: tris.append((b, d, c))
    tris = np.array(tris, dtype=np.int64)
    P = pts.reshape(-1, 3)
    used = np.unique(tris)
    remap = -np.ones(len(P), dtype=np.int64); remap[used] = np.arange(len(used))
    P = P[used]; tris = remap[tris]
    tip3 = np.array([[tx, ty, 7.0 if teeth_up else -7.0] for tx, ty in tips])
    return P, tris, tip3


def rot_matrix(rng):
    q = rng.normal(size=4); q /= np.linalg.norm(q)
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def write_stl(path, P, T):
    with open(path, 'wb') as f:
        f.write(b'tresD synthetic arch'.ljust(80, b' '))
        f.write(struct.pack('<I', len(T)))
        v = P[T]  # (n,3,3)
        n = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0]); n /= (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)
        rec = np.zeros(len(T), dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]))
        rec['n'] = n; rec['v'] = v
        f.write(rec.tobytes())


def write_ply(path, P, T, colors):
    with open(path, 'w') as f:
        f.write('ply\nformat ascii 1.0\nelement vertex %d\nproperty float x\nproperty float y\nproperty float z\n'
                'property uchar red\nproperty uchar green\nproperty uchar blue\nelement face %d\nproperty list uchar int vertex_indices\nend_header\n' % (len(P), len(T)))
        for p, c in zip(P, colors):
            f.write('%.4f %.4f %.4f %d %d %d\n' % (p[0], p[1], p[2], c[0], c[1], c[2]))
        for t in T:
            f.write('3 %d %d %d\n' % tuple(t))


def write_obj(path, P, T):
    with open(path, 'w') as f:
        f.write('# tresD synthetic arch\n')
        for p in P: f.write('v %.4f %.4f %.4f\n' % tuple(p))
        for t in T: f.write('f %d %d %d\n' % (t[0] + 1, t[1] + 1, t[2] + 1))


def main():
    R = rot_matrix(rng); t = np.array([40.0, -25.0, 60.0])
    Pu, Tu, tips_u = arch(teeth_up=True)                 # superior: dientes hacia +z en su marco propio ("abajo" en el paciente)
    Pl, Tl, tips_l = arch(teeth_up=False)                # inferior: en oclusión, espejo por el plano oclusal (z = 10)
    Pl = Pl.copy(); Pl[:, 2] = -Pl[:, 2] + 16; tips_l = tips_l.copy(); tips_l[:, 2] = -tips_l[:, 2] + 16
    Pu_r = Pu @ R.T + t; Pl_r = Pl @ R.T + t
    write_stl(f'{OUT}/arch_upper.stl', Pu_r, Tu)
    write_stl(f'{OUT}/arch_cm.stl', Pu_r * 0.1, Tu)
    write_obj(f'{OUT}/arch_upper.obj', Pu_r, Tu)
    # colores: encía rosada abajo, dientes blancos en los bultos
    h = (Pl[:, 2] - 16)
    col = np.where((-h > 3.5)[:, None], np.array([[235, 232, 220]]), np.array([[214, 120, 130]])).astype(int)
    write_ply(f'{OUT}/arch_lower.ply', Pl_r, Tl, col)
    # isla: esferita de 2 mm a 40 mm de la arcada (< 5 % de la superficie)
    th, ph = np.meshgrid(np.linspace(0, np.pi, 8), np.linspace(0, 2 * np.pi, 12))
    S = np.stack([2 * np.sin(th) * np.cos(ph), 2 * np.sin(th) * np.sin(ph), 2 * np.cos(th)], -1).reshape(-1, 3) + np.array([0, -40, 0])
    S = S @ R.T + t
    Ts = []
    n1, n2 = th.shape
    for j in range(n1 - 1):
        for i in range(n2 - 1):
            a, b, c, d = j * n2 + i, j * n2 + i + 1, (j + 1) * n2 + i, (j + 1) * n2 + i + 1
            Ts.append((a, b, c)); Ts.append((b, d, c))
    Ts = np.array(Ts) + len(Pu_r)
    write_stl(f'{OUT}/arch_islands.stl', np.vstack([Pu_r, S]), np.vstack([Tu, Ts]))
    json.dump({'R': R.tolist(), 't': t.tolist(), 'tips_upper': (tips_u @ R.T + t).tolist(), 'tips_lower': (tips_l @ R.T + t).tolist(),
               'anterior': (np.array([0, 33, 0]) @ R.T + t).tolist(), 'posterior': (np.array([0, -6, 0]) @ R.T + t).tolist()},
              open(f'{OUT}/frame.json', 'w'))
    print('upper', len(Pu), len(Tu), 'lower', len(Pl), len(Tl))


if __name__ == '__main__':
    main()
