"""Serie DICOM con un BLOQUE DE CORTES FUERA DE SITIO ("vuelta al principio"), para probar la
reparación de `dicomLoad` (v0.7.2).

Reproduce el fallo que vio Manuel (13-09-2026): un CBCT en el que la parte ALTA del cráneo sale
recortada y aparece como un trozo suelto POR DEBAJO del resto (el corte axial se ve bien; el coronal,
el sagital y el 3D muestran la bóveda separada, con un hueco negro en medio).

Causa: un bloque contiguo de cortes (los de la parte alta del barrido) trae la posición
(ImagePositionPatient) desplazada muy por debajo de la del resto. Al ordenar por posición, ese bloque
se va al PRINCIPIO del volumen, y Cornerstone lo coloca abajo del todo, pegado al aire que había
encima de la cabeza: de ahí el trozo suelto y el hueco.

Genera /tmp/testdata/cbct_wrap/ = copia de cbct_half con los ÚLTIMOS `BLOQUE` cortes bajados
`span + dz` mm (es decir, "dan la vuelta" y quedan justo por debajo del primero).
Uso: python3 tests/make_wrap_geom.py
"""
import os, shutil
import numpy as np
import pydicom

SRC = "/tmp/testdata/cbct_half"
OUT = "/tmp/testdata/cbct_wrap"
BLOQUE = 40                     # cortes de la parte alta que se van abajo

if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

names = sorted(os.listdir(SRC))
files = [pydicom.dcmread(os.path.join(SRC, n)) for n in names]
iop = np.array(files[0].ImageOrientationPatient, float)
normal = np.cross(iop[:3], iop[3:])
normal /= np.linalg.norm(normal)
pos = np.array([np.dot(np.array(d.ImagePositionPatient, float), normal) for d in files])
order = np.argsort(pos)
files = [files[i] for i in order]
names = [names[i] for i in order]
pos = np.sort(pos)

dz = float(np.median(np.diff(pos)))
span = float(pos[-1] - pos[0])
print("cortes", len(files), "· salto real", round(dz, 3), "mm · recorrido", round(span, 1), "mm")

# los BLOQUE cortes de arriba bajan span + dz: quedan justo DEBAJO del primero
shift = -(span + dz)
for ds in files[-BLOQUE:]:
    p = np.array(ds.ImagePositionPatient, float) + normal * shift
    ds.ImagePositionPatient = [float(v) for v in p]

for n, ds in zip(names, files):
    ds.save_as(os.path.join(OUT, n), enforce_file_format=True)

# variante SIN pista: los números de instancia se reescriben siguiendo el orden (malo) de las posiciones,
# así que el fallo es indetectable. Sirve para ver el síntoma tal cual lo veía Manuel y para comprobar
# que, cuando no se puede confirmar, el visor no toca nada.
OUT2 = OUT + "_sinpista"
if os.path.isdir(OUT2):
    shutil.rmtree(OUT2)
os.makedirs(OUT2)
pos_mal = [np.dot(np.array(d.ImagePositionPatient, float), normal) for d in files]
orden = np.argsort(pos_mal)
for i, j in enumerate(orden):
    files[j].InstanceNumber = int(i + 1)
for n, ds in zip(names, files):
    ds.save_as(os.path.join(OUT2, n), enforce_file_format=True)
print("variante indetectable ->", OUT2)

pos2 = np.sort([np.dot(np.array(d2.ImagePositionPatient, float), normal) for d2 in files])
d2 = np.diff(pos2)
print("tras estropearlo: salto máximo", round(float(d2.max()), 1), "mm ·",
      int((d2 > 1.5 * dz).sum()), "hueco(s) ·", "recorrido", round(float(pos2[-1] - pos2[0]), 1), "mm ->", OUT)
