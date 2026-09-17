@echo off
REM ============================================================
REM  tresD DICOM - visor web de DICOM (prueba en local)
REM  Abre un servidor con la carpeta docs\ (la web ya construida)
REM  usando el Python del venv de VOXEL y lanza el navegador.
REM  No modifica VOXEL. Cierra la ventana del servidor para apagarlo.
REM ============================================================
cd /d "%~dp0"

set PY=C:\Users\dover\Desktop\CEPH_3D_actualizado\venv\Scripts\python.exe
if not exist %PY% set PY=python

if not exist docs\index.html goto :nodocs

echo Arrancando el servidor de tresD DICOM en http://localhost:8123/ ...
REM v0.8.4: servidor propio SIN cache (antes el navegador guardaba index.html y abria la version anterior)
start "tresD DICOM - servidor (no cerrar mientras uses el visor)" cmd /k %PY% servidor_local.py
timeout /t 2 /nobreak >nul
start "" http://localhost:8123/?t=%RANDOM%%RANDOM%
echo.
echo Listo: el visor se abre en el navegador. Esta ventana se puede cerrar.
echo Si el navegador dice "no se puede acceder", espera 3 segundos y pulsa F5.
timeout /t 8 >nul
exit /b 0

:nodocs
echo.
echo  ERROR: no encuentro docs\index.html en esta carpeta:
echo  %~dp0
echo  Pide a Claude que construya la web.
echo.
pause
exit /b 1
