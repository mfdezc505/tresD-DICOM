# CLAUDE.md — tresD DICOM

> **IDIOMA: responde SIEMPRE en ESPAÑOL.** Léeme al empezar CADA sesión, junto con `CONTEXTO.md`.
> Manuel es ortodoncista, NO programador: instrucciones paso a paso, comandos exactos, sin jerga.

## Qué es
Visor web GRATUITO de DICOM / DICOMDIR (CBCT) con la interfaz de VOXEL, para VISUALIZACIÓN y DOCENCIA:
render 3D con presets, 3 cortes MPR, medición orientativa (distancia/ángulo), corte por plano, multipantalla,
metadatos, escáneres intraorales STL/PLY/OBJ autorientados y alineados al CBCT (Fase 2), segmentación rápida
hueso + piel (dentición a resolución fina) y foto frontal drapeada sobre la piel (Fase 3), alineación por
puntos, siluetas de las mallas en los cortes, mediciones con color y trazado en vivo (v0.6), deshacer/rehacer,
cruz de referencia en los cortes, segmentación de VÍA AÉREA con mapa de calor y valores (norma de Guijarro),
corte curvo PANORÁMICO editable y presets de tejido blando y vía aérea (v0.7), cortes de ATM por cóndilo
(v0.7.1), cortes de ATM a 1 mm recorribles con la rueda y con medidas, panorámica hasta los cóndilos y
reparación de series con un bloque de cortes fuera de sitio (v0.7.2), exportación de mallas a STL y encuadre
automático de los cortes de ATM (v0.7.3), cruz adaptativa al tamaño del visor, corte de ATM ampliado y polos
del cóndilo ajustables a mano (v0.7.4), piel sin aire interno, medidas sobre panorámica y ATM con Mayús y
marca de agua en las capturas (v0.7.5), rótulos y medidas nítidos sobre los cortes, coronal que salta de
verdad a los cóndilos al marcarlos y medial/lateral correctos en CBCT sin la línea media en x = 0 (v0.7.6),
captura de pantalla también en panorámica y ATM, doble clic para ampliar un corte de ATM y curva de la
arcada apagada por defecto (v0.7.7), marca de agua «DICOM viewer» según el tema, grosor de la panorámica
sobre el axial al editar, aviso de vía aérea que se cierra, doble clic en panorámica → 2×2 y axial de ATM
a la altura de la cabeza del cóndilo (v0.7.8).
100% en el navegador: los DICOM y las fotos nunca salen del ordenador del usuario.
**Uso previsto declarado (MDR/RGPD): NO es producto sanitario con marcado CE ni sirve para diagnosticar.**
No escribir en la interfaz ni en los textos «herramienta diagnóstica»: medidas y alineación son «orientativas».

## Reglas FIJAS
- **NO tocar VOXEL** (`Desktop\CEPH_3D_actualizado`) **ni tresD_Models** (`Desktop\tresD_Models`): solo se
  LEEN para portar ideas. Al terminar, `git status` en ambos debe seguir limpio.
- Trabajar SOLO en esta carpeta (`Desktop\tresD_DICOM`), con su propio git.
- **Manuel NO tiene Node.js**: la web se construye en la nube (Claude ejecuta `npm run build`) y se
  escribe la carpeta `docs/` ya construida en su PC. GitHub Pages sirve `docs/` de la rama `main` en
  **https://tresddicom.com** (dominio propio; `public/CNAME` NO se borra).
  Para probar en local: `ABRIR_tresD_DICOM.bat` (servidor Python del venv de VOXEL + navegador).
- **Versión en DOS sitios**: `package.json` ("version") y `src/version.js` (VERSION). Subirla en ambos.
- Regla 1 de Manuel: antes de cambiar código, buscar TODOS los sitios que afectan al comportamiento
  (grep) y confirmar qué ruta gana; luego cambiar y subir versión.
- Regla 3 (matizada el 15-09-2026 por Manuel, para no tardar 2 h en cambios pequeños): en peticiones
  PEQUEÑAS (interfaz, valores por defecto, un botón) se pasan solo las baterías de lo tocado (~10 min).
  La regresión COMPLETA queda para cambios grandes (carga de DICOM, segmentación, alineación, geometría,
  render) o cuando se toca código compartido por muchas partes (`viewer.js` en zonas comunes, `contours.js`).
  Regresión completa = `node tests/smoke.mjs`, `node tests/loaders.mjs`,
  `node tests/orient.mjs`, `node tests/meshes.mjs`, `node tests/align.mjs`, `node tests/legal.mjs`,
  `node tests/photo.mjs`, `node tests/align_node.mjs` (Node, dientes reales), `node tests/geom.mjs` (guarda de
  geometría), `node tests/wrap.mjs` (bloque de cortes fuera de sitio), `node tests/real.mjs`,
  `node tests/features.mjs` (v0.7), `node tests/v071.mjs`, `node tests/v072.mjs`, `node tests/v073.mjs`, `node tests/v074.mjs`, `node tests/v075.mjs`, `node tests/v076.mjs`, `node tests/v077.mjs` y `node tests/v078.mjs` hasta 0 errores.
- Solo visualización: NO añadir diagnóstico automático ni IA sin pedirlo. Citar licencias de los motores.

## Arquitectura (ver CONTEXTO.md para el detalle)
- Vite 8 + JavaScript (sin framework). `src/main.js` = interfaz (equivalente al Wizard de VOXEL).
- `@cornerstonejs/core` + `tools` + `dicom-image-loader` 5.8 (render, MPR, herramientas, decodificación
  con wasm) · `@kitware/vtk.js` 36 (presets, clipping, planos, mediciones 3D, marching cubes, texturas) ·
  `dicom-parser` (cabeceras y DICOMDIR) · `dcmjs` (volcado de metadatos) · `fflate` (ZIP) · MediaPipe Face
  Mesh legacy en `public/mediapipe/` (detección facial para el drapeado; sin CDN).
- Tema: `src/theme.css` = paleta y tipografía (Poppins, `public/fonts/`) del MANUAL DE MARCA (`marca/`, v0.6.1);
  disposición heredada de VOXEL. Logos en `public/img/` derivados de los maestros de `marca/` (nunca redibujar);
  en la barra va el logo principal «DICOM viewer» (decisión de Manuel). Render 3D sobre `renderVolume.js` (≤ 400 vóx/eje).
- Historia de deshacer/rehacer en `core/history.js` (`viewer.history`); vía aérea en `core/airway.js`;
  panorámica en `core/panoramic.js`; cortes de ATM en `core/tmj.js`; guarda de geometría en `viewer.enforceGeometry`.
  Idiomas: `src/i18n/`.

## Flujo de trabajo (Claude)
1. Editar `src/`. 2. `npm run build` (genera `docs/`). 3. `node tests/smoke.mjs`, `node tests/loaders.mjs`,
   `node tests/orient.mjs`, `node tests/meshes.mjs`, `node tests/align.mjs` (Chromium sin cabeza con SwiftShader;
   datos de prueba en `/tmp/testdata`, generados con `tests/make_dicom.py` (muestra pública DZ-CBCT de 3D Slicer),
   `tests/make_meshes.py` (arcadas sintéticas), `tests/make_synth_cbct.py` (CBCT sintético con esas arcadas) y
   `tests/make_real_scans.py` (escáneres con dientes REALES sacados del CBCT DZ, en pose conocida) y
   `tests/make_bad_geom.py` (serie con un corte fuera de sitio: prueba de la guarda de geometría) y
   `tests/make_wrap_geom.py` (serie con un BLOQUE de cortes girado: prueba de la reparación del orden) y
   `tests/make_offset_geom.py` (serie con el origen fuera de la línea media: prueba de medial/lateral)).
   Los `/tmp/testdata` no sobreviven a una sesión nueva: regenerarlos con esos scripts (DZ-CBCT.nrrd se
   descarga de la muestra de 3D Slicer; ver CONTEXTO.md §4).
4. Escribir en el PC de Manuel `src/`, `docs/`, `public/`, configs (device_commit_files; device_bash NO monta).
5. Manuel: doble clic en `SUBIR_GITHUB.bat` → GitHub Pages actualiza la web en ~1 minuto.
