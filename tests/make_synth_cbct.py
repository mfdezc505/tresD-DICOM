# CBCT SINTÉTICO con las dos arcadas de tests/make_meshes.py en una POSE CONOCIDA, para probar la
# alineación escáner→CBCT (tests/align.mjs). Volumen 0,5 mm, 176×176×128, marco LPS:
#   - fondo: aire (-1000) fuera de un elipsoide "cabeza" y tejido blando (+40) dentro;
#   - hueso (900) en una losa por encima de la arcada superior y otra por debajo de la inferior;
#   - ESMALTE (2400): banda de coronas de las dos arcadas (superficie engrosada ±0,6 mm);
#   - encía / paladar (300) en el resto de la superficie de cada arcada.
# Escribe /tmp/testdata/cbct_synth/ (DICOM) y /tmp/testdata/cbct_synth/pose.json (pose verdadera).
import json, os, sys, datetime
import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid, CTImageStorage
sys.path.insert(0, os.path.dirname(__file__))
from make_meshes import arch

OUT = '/tmp/testdata/cbct_synth'
os.makedirs(OUT, exist_ok=True)
SP = 0.5
NX, NY, NZ = 176, 176, 128
origin = np.array([-44.0, -60.0, -32.0])            # LPS; la arcada cae en el centro

# pose verdadera: la arcada "modelo" (marco tresD: dientes hacia +z, anterior +y) → paciente LPS
# (superior: dientes hacia -Z; anterior = -Y; derecha = -X). Rotación base = diag(-1,-1,-1)?? no:
# ex(paciente) = -ex(modelo) [derecha = -X LPS], ey = -ey [anterior = -Y], ez = -ez (dientes abajo)
# → eso es det = -1 (espejo). Igual que orient.js: filas [-ex, -ey, ez] y luego ez se invierte
# por el rol 'upper' (occ = -axis) → R_base = diag(-1, -1, 1) aplicado a (x, y, -z): usamos
# la conversión explícita: p_lps = [-x, -y, -z] · [1,1,-1]... simplificamos: el modelo superior
# tiene dientes +z y anterior +y; en LPS queremos dientes -Z y anterior -Y: (x, y, z) → (x, -y, -z)
# (rotación de 180° alrededor de X, det=+1).
def rx(deg):
    a = np.radians(deg); return np.array([[1, 0, 0], [0, np.cos(a), -np.sin(a)], [0, np.sin(a), np.cos(a)]])
def ry(deg):
    a = np.radians(deg); return np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
def rz(deg):
    a = np.radians(deg); return np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
R_true = rz(12) @ ry(-6) @ rx(4) @ rx(180)          # pequeño giro extra sobre la pose anatómica
t_true = np.array([2.0, -8.0, 5.0])
Pu, Tu, _ = arch(step=0.4, teeth_up=True)
Pl, Tl, _ = arch(step=0.4, teeth_up=False)
Pl = Pl.copy(); Pl[:, 2] = -Pl[:, 2] + 16            # inferior en oclusión (mismo marco que en make_meshes)
hu_u = Pu[:, 2] > 1.0                                 # coronas superiores (esmalte hasta cerca de la encía)
hu_l = (16 - Pl[:, 2]) > 1.0                          # coronas inferiores
Pu_w = Pu @ R_true.T + t_true
Pl_w = Pl @ R_true.T + t_true

vol = np.full((NX, NY, NZ), -1000, dtype=np.int16)
ii, jj, kk = np.meshgrid(np.arange(NX), np.arange(NY), np.arange(NZ), indexing='ij')
X = origin[0] + ii * SP; Y = origin[1] + jj * SP; Z = origin[2] + kk * SP
head = ((X - 0) / 75.0) ** 2 + ((Y + 5) / 90.0) ** 2 + ((Z - 0) / 100.0) ** 2 < 1
vol[head] = 40
# losas de hueso (maxilar arriba de la arcada superior, mandíbula debajo de la inferior), en marco paciente
loc = np.stack([X - t_true[0], Y - t_true[1], Z - t_true[2]], -1) @ R_true   # → coordenadas del modelo
zm = loc[..., 2]
inU = (np.abs(loc[..., 0]) < 34) & (loc[..., 1] > -8) & (loc[..., 1] < 48)
vol[head & inU & (zm < -6) & (zm > -22)] = 900       # "maxilar" (por encima de las coronas superiores en LPS)
vol[head & inU & (zm > 22) & (zm < 38)] = 900        # "mandíbula"

def paint(P, crown_mask, hu_crown, hu_rest, rad=0.6):
    # engrosar la superficie: cada vértice pinta los vóxeles a < rad (vecindario 3×3×3 a 0,5 mm)
    idx = np.rint((P - origin) / SP).astype(int)
    for d in np.array(np.meshgrid([-1, 0, 1], [-1, 0, 1], [-1, 0, 1])).T.reshape(-1, 3):
        q = idx + d
        ok = (q[:, 0] >= 0) & (q[:, 0] < NX) & (q[:, 1] >= 0) & (q[:, 1] < NY) & (q[:, 2] >= 0) & (q[:, 2] < NZ)
        dist = np.linalg.norm((q * SP + origin) - P, axis=1)
        ok &= dist <= rad + 0.26
        v = np.where(crown_mask, hu_crown, hu_rest)
        vol[q[ok, 0], q[ok, 1], q[ok, 2]] = np.maximum(vol[q[ok, 0], q[ok, 1], q[ok, 2]], v[ok])

paint(Pu_w, hu_u, 2400, 300)
paint(Pl_w, hu_l, 2400, 300)
print('esmalte vóxeles:', int((vol >= 2000).sum()), 'de', vol.size, '(%.2f %%)' % (100 * (vol >= 2000).mean()))

study_uid = generate_uid(); series_uid = generate_uid(); for_uid = generate_uid()
today = datetime.date.today().strftime('%Y%m%d')
for k in range(NZ):
    ds = Dataset(); ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = CTImageStorage
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.file_meta.ImplementationClassUID = '1.2.826.0.1.3680043.8.498.1'
    ds.SOPClassUID = CTImageStorage; ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.PatientName = 'SINTETICO^ARCADAS'; ds.PatientID = 'SYN001'; ds.PatientBirthDate = '19800101'; ds.PatientSex = 'O'
    ds.StudyInstanceUID = study_uid; ds.SeriesInstanceUID = series_uid; ds.FrameOfReferenceUID = for_uid
    ds.StudyDate = today; ds.SeriesDate = today; ds.Modality = 'CT'; ds.Manufacturer = 'tresD sintetico'
    ds.SeriesDescription = 'CBCT sintetico arcadas'; ds.SeriesNumber = 1; ds.StudyID = '1'; ds.InstanceNumber = k + 1
    ds.ImagePositionPatient = [float(origin[0]), float(origin[1]), float(origin[2] + k * SP)]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.PixelSpacing = [SP, SP]; ds.SliceThickness = SP; ds.SpacingBetweenSlices = SP
    ds.RescaleIntercept = 0.0; ds.RescaleSlope = 1.0; ds.WindowCenter = 400; ds.WindowWidth = 2000
    ds.SamplesPerPixel = 1; ds.PhotometricInterpretation = 'MONOCHROME2'
    pix = np.ascontiguousarray(vol[:, :, k].T)          # filas = j (Y), columnas = i (X)
    ds.Rows, ds.Columns = pix.shape
    ds.BitsAllocated = 16; ds.BitsStored = 16; ds.HighBit = 15; ds.PixelRepresentation = 1
    ds.PixelData = pix.tobytes(); ds.is_little_endian = True; ds.is_implicit_VR = False
    ds.save_as(os.path.join(OUT, 'IM%04d.dcm' % (k + 1)), enforce_file_format=True)
json.dump({'R': R_true.tolist(), 't': t_true.tolist(), 'centroid_upper': Pu_w.mean(0).tolist(), 'centroid_lower': Pl_w.mean(0).tolist(),
           'crown_centroid_upper': Pu_w[hu_u].mean(0).tolist()}, open(os.path.join(OUT, 'pose.json'), 'w'))
print('hecho:', NZ, 'cortes; centroide superior verdadero', Pu_w.mean(0).round(2))
