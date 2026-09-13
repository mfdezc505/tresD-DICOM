"""Convierte DZ-CBCT.nrrd (muestra publica de 3D Slicer, donada sin restricciones) en una
serie DICOM CT sintetica para PROBAR tresD DICOM. Genera:
  - cbct_half/      serie sin comprimir (submuestreo x2, ~0,5 mm)   -> carpeta DICOM
  - cbct_half_rle/  misma serie comprimida RLE (prueba de codecs)
  - cbct_dicomdir/  FileSet con DICOMDIR (prueba de DICOMDIR)
  - cbct_half.zip   ZIP de la carpeta sin comprimir
"""
import os, sys, zipfile, datetime
import numpy as np
import nrrd
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid, RLELossless, CTImageStorage
from pydicom.fileset import FileSet

SRC = "/tmp/testdata/DZ-CBCT.nrrd"
OUT = "/tmp/testdata"
STEP = int(sys.argv[1]) if len(sys.argv) > 1 else 2

data, hdr = nrrd.read(SRC)            # (i, j, k) en orden C? pynrrd devuelve index order 'F' -> data[i,j,k]
print("nrrd", data.shape, data.dtype, data.min(), data.max())
D = np.array(hdr["space directions"], float)   # filas = ejes i,j,k (vectores en LPS)
origin = np.array(hdr["space origin"], float)
sub = data[::STEP, ::STEP, ::STEP]
D2 = D * STEP
ni, nj, nk = sub.shape
print("sub", sub.shape)

row_dir = D2[0] / np.linalg.norm(D2[0])      # direccion en la que crece i (columnas)
col_dir = D2[1] / np.linalg.norm(D2[1])      # direccion en la que crece j (filas)
dz_vec = D2[2]
ps_col = np.linalg.norm(D2[0]); ps_row = np.linalg.norm(D2[1])

study_uid = generate_uid(); series_uid = generate_uid(); for_uid = generate_uid()
today = datetime.date.today().strftime("%Y%m%d")

def make_ds(k, pix, transfer=ExplicitVRLittleEndian):
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = transfer
    ds.file_meta.MediaStorageSOPClassUID = CTImageStorage
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.file_meta.ImplementationClassUID = "1.2.826.0.1.3680043.8.498.1"
    ds.SOPClassUID = CTImageStorage
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.PatientName = "PRUEBA^CBCT"
    ds.PatientID = "TEST001"
    ds.PatientBirthDate = "19800101"
    ds.PatientSex = "O"
    ds.StudyInstanceUID = study_uid
    ds.SeriesInstanceUID = series_uid
    ds.FrameOfReferenceUID = for_uid
    ds.StudyDate = today; ds.SeriesDate = today; ds.ContentDate = today
    ds.StudyTime = "120000"; ds.SeriesTime = "120000"
    ds.Modality = "CT"
    ds.Manufacturer = "tresD (sintetico desde 3D Slicer DZ-CBCT)"
    ds.StudyDescription = "CBCT cabeza (muestra publica)"
    ds.SeriesDescription = "CBCT %.2f mm" % ps_col
    ds.SeriesNumber = 1
    ds.StudyID = "1"
    ds.AccessionNumber = ""
    ds.ReferringPhysicianName = ""
    ds.InstanceNumber = k + 1
    ds.ImagePositionPatient = [float(v) for v in (origin + k * dz_vec)]
    ds.ImageOrientationPatient = [float(v) for v in list(row_dir) + list(col_dir)]
    ds.PixelSpacing = [float(ps_row), float(ps_col)]
    ds.SliceThickness = float(np.linalg.norm(dz_vec))
    ds.SpacingBetweenSlices = float(np.linalg.norm(dz_vec))
    ds.KVP = 90
    ds.RescaleIntercept = 0.0
    ds.RescaleSlope = 1.0
    ds.RescaleType = "HU"
    ds.WindowCenter = 400; ds.WindowWidth = 2000
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.Rows, ds.Columns = pix.shape
    ds.BitsAllocated = 16; ds.BitsStored = 16; ds.HighBit = 15
    ds.PixelRepresentation = 1
    ds.PixelData = pix.tobytes()
    ds.is_little_endian = True; ds.is_implicit_VR = False
    return ds

def slice_k(k):
    # pix[fila=j, columna=i]
    return np.ascontiguousarray(sub[:, :, k].T.astype(np.int16))

d1 = os.path.join(OUT, "cbct_half"); d2 = os.path.join(OUT, "cbct_half_rle"); d3 = os.path.join(OUT, "cbct_dicomdir")
for d in (d1, d2, d3):
    os.makedirs(d, exist_ok=True)
fs = FileSet()
for k in range(nk):
    pix = slice_k(k)
    ds = make_ds(k, pix)
    ds.save_as(os.path.join(d1, "IM%04d.dcm" % (k + 1)), enforce_file_format=True)
    fs.add(ds)
    if k % 3 == 0:                      # RLE: 1 de cada 3 cortes basta para probar el codec
        dsr = make_ds(k, pix)
        dsr.compress(RLELossless)
        dsr.save_as(os.path.join(d2, "IM%04d.dcm" % (k + 1)), enforce_file_format=True)
fs.write(d3)
with zipfile.ZipFile(os.path.join(OUT, "cbct_half.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    for fn in sorted(os.listdir(d1)):
        z.write(os.path.join(d1, fn), "cbct/" + fn)
print("hecho:", nk, "cortes", ps_row, ps_col, np.linalg.norm(dz_vec))
