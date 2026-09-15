"""Serie DICOM con el ORIGEN DESPLAZADO: el volumen entero cae en x > 0 (como muchos CBCT, cuyo
origen esta en una esquina y no en la linea media). Sirve para comprobar que los polos MEDIAL y
LATERAL del condilo no se cambian (v0.7.6). Copia cbct_half aplicando +200 mm en X y +150 en Y."""
import os, shutil, sys
import pydicom

SRC = "/tmp/testdata/cbct_half"
OUT = "/tmp/testdata/cbct_offset"
DX, DY = 200.0, 150.0

if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)
n = 0
for name in sorted(os.listdir(SRC)):
    ds = pydicom.dcmread(os.path.join(SRC, name))
    p = [float(v) for v in ds.ImagePositionPatient]
    ds.ImagePositionPatient = [p[0] + DX, p[1] + DY, p[2]]
    ds.save_as(os.path.join(OUT, name))
    n += 1
print("cbct_offset:", n, "cortes  ·  +%.0f mm en X, +%.0f mm en Y" % (DX, DY))
