@echo off
REM ============================================================
REM  SUBIR tresD DICOM a GitHub (doble clic).
REM  Hace: init (si hace falta) -> add -> commit -> main -> remoto -> push.
REM  GitHub Pages publica la carpeta docs\ de la rama main.
REM ============================================================
cd /d "%~dp0"
echo.
echo === Guardando cambios y subiendo tresD DICOM a GitHub ===
echo.

if not exist ".git" git init

git add .
git commit -m "tresD DICOM: actualizacion"
git branch -M main

REM asegurar que el repositorio remoto es el correcto
git remote remove origin 1>nul 2>nul
git remote add origin https://github.com/mfdezc505/tresD-DICOM.git

git push -u origin main

echo.
echo ============================================================
echo  Si arriba NO ves errores en rojo, ya esta subido en:
echo    https://github.com/mfdezc505/tresD-DICOM
echo  La web (GitHub Pages, carpeta docs) queda en:
echo    https://mfdezc505.github.io/tresD-DICOM/
echo  (La primera vez: Settings ^> Pages ^> Branch main / docs ^> Save)
echo ============================================================
pause
