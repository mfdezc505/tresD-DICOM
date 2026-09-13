"""Serie DICOM con la GEOMETRÍA ESTROPEADA, para probar la guarda de `enforceGeometry` (v0.7.0).

Reproduce el fallo que vio Manuel (12-09-2026): un CBCT normal que en el visor sale ESTIRADO a lo alto
(el corte axial se ve bien, pero el coronal, el sagital y el 3D salen como una columna).

Causa: Cornerstone deduce la distancia entre cortes repartiendo el trayecto del PRIMER corte al ÚLTIMO
entre el número de cortes. Basta con que UN corte de la serie esté en una posición disparatada (un
localizador, un corte repetido de otro estudio, una posición mal escrita) para que ese promedio se
dispare y TODO el volumen se estire, aunque los demás cortes estén perfectamente a 0,4 mm.

Genera /tmp/testdata/cbct_badgeom/ = copia de cbct_half con el ÚLTIMO corte desplazado 180 mm:
  - mediana del salto entre cortes: la real (0,5 mm)
  - promedio extremo a extremo: ~1,3 mm  ->  volumen 2,6 veces más alto de lo que debe
Uso: python3 tests/make_bad_geom.py
"""
import os, shutil
import numpy as np
import pydicom

SRC = "/tmp/testdata/cbct_half"
OUT = "/tmp/testdata/cbct_badgeom"
SHIFT_MM = 180.0

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

d = np.diff(sorted(pos))
print("cortes", len(files), "salto real (mediana)", float(np.median(d)))

# el ÚLTIMO corte se va 180 mm más allá: el promedio extremo a extremo se dispara
last = files[-1]
p = np.array(last.ImagePositionPatient, float) + normal * SHIFT_MM
last.ImagePositionPatient = [float(v) for v in p]

for n, ds in zip(names, files):
    ds.save_as(os.path.join(OUT, n), enforce_file_format=True)

pos2 = np.array([np.dot(np.array(d2.ImagePositionPatient, float), normal) for d2 in files])
span = (pos2.max() - pos2.min()) / (len(files) - 1)
print("promedio extremo a extremo tras estropearlo", round(float(span), 3), "mm ->", OUT)
