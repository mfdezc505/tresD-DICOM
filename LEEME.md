# tresD DICOM — visor gratuito de DICOM y DICOMDIR

Visor web de CBCT con la interfaz de VOXEL. Todo se procesa **en el navegador**: los archivos DICOM
nunca salen de tu ordenador.

## Qué hace (v0.7.15)
- Abre carpetas DICOM, DICOMDIR y ZIP (arrastrar o botones). Detecta las series y deja elegir. Repara solo
  las series mal escritas: tamaño de vóxel incoherente y **bloques de cortes colocados fuera de sitio** (la
  parte alta del cráneo saliendo suelta por debajo del resto); avisa en la barra de estado cuando lo hace.
- Volúmenes muy grandes (p. ej. 1003×1003×874) se reducen automáticamente a la mitad para caber en la memoria gráfica (aviso en la barra de estado). El render 3D usa una copia suavizada (≤ 400 vóxeles por eje, como VOXEL): sin grano y fluido; los cortes conservan la resolución completa.
- Render 3D con presets (marfil, hueso natural, radiográfico, gris, **tejido blando** (piel translúcida + hueso),
  **vía aérea** (hueso translúcido), estándar) + transparencia, brillo y contraste. El hueso se ve OPACO (marfil). Vistas Frontal / Derecha / Izquierda / Superior / Inferior / Posterior.
- Tres cortes MPR (axial, coronal, sagital): rueda = cambiar de corte, arrastrar = brillo/contraste,
  botón central = mover, botón derecho = zoom. **Cruz de referencia** (botón «✛ Cruz»): arrastra el centro
  para navegar los tres planos a la vez y gira los brazos con los circulitos que aparecen al pasar el ratón
  por una línea (brillo/contraste = Mayús + arrastrar).
- **Panorámica** (corte curvo a lo largo de la arcada dental, detectada automáticamente): llega **hasta los
  cóndilos** (la curva se prolonga por las ramas y la imagen es más alta), grosor ajustable en vivo, MIP
  activado por defecto, curva dibujada sobre el axial y **editable** («✎ Editar curva»: se arrastran los 13
  puntos amarillos sobre el corte axial (el axial se coloca solo a la altura de los dientes y dos líneas finas marcan el grosor del corte) y la panorámica se rehace; «↺ Curva automática» la recalcula);
  «✏ Dibujar curva» permite marcar la curva a mano con clics sobre el corte axial (de un cóndilo al otro por los dientes);
  brillo/contraste arrastrando sobre la imagen. **Mayús + arrastrar = medir** (en mm, con la etiqueta
  arrastrable); grosor por defecto 22 mm.
- **Cortes de ATM**: marcas un punto sobre cada cóndilo y el visor busca la cabeza condilar, calcula su eje
  entre polos y saca, por lado, 5 cortes sagitales perpendiculares a ese eje **a 1 mm** (de medial a lateral),
  1 coronal y 1 axial (este a la altura de la cabeza del cóndilo, ya separada de la fosa), en un mosaico (como el panel de ATM de VOXEL). La **rueda del ratón** recorre los
  cortes de milímetro en milímetro (sobre un sagital mueve los cinco; sobre el coronal o el axial, solo ese).
  **Arrastrar = brillo/contraste**. Los cortes se encuadran solos a la casilla del mosaico. Cada corte se
  puede **ver en grande** (doble clic sobre él o botón ⤢ de la casilla) y ahí se **mide** con los botones
  «📏 Distancia» (arrastrar) y «📐 Ángulo» (tres toques: extremo, vértice, extremo), sin teclas: vale para
  tabletas. Las medidas (en mm o grados, con su color y deshacer/rehacer; «⌫ Borrar medidas» las quita) se ven
  también en el mosaico, más pequeñas, y sus etiquetas se pueden arrastrar.
  Si los polos del cóndilo no quedan bien, **«⌖ Ajustar polos»** los coloca a mano sobre un corte axial y
  rehace los cortes perpendiculares al nuevo eje (medial y lateral salen bien también en los CBCT cuyo
  origen no está en la línea media). Al marcar los cóndilos, el corte coronal se coloca solo a su altura
  (la rueda lo ajusta). Rótulos y medidas se dibujan a la resolución de la pantalla: se leen nítidos también
  en el corte ampliado.
- **Exportar mallas a STL**: botón ⭳ del panel derecho (o botón derecho sobre ese panel) → se eligen las
  mallas y se descarga un STL por cada una, en la posición que tienen en pantalla.
- Multipantalla: 2×2, 3D + cortes, en fila, o cada visor solo (botón ⤢ o doble clic).
- Medición de distancias y ángulos, en el 3D (sobre el hueso) y en los cortes MPR: cada medición con su
  color y trazado en vivo mientras mueves el ratón.
- Corte del volumen por plano sagital / axial / coronal, con «voltear lado».
- Planos MPR dentro del render 3D (panel derecho).
- Chip del paciente en la cabecera (nombre · sexo · nacimiento y edad · fecha del estudio): un **clic lo
  oculta** (docencia, capturas) y otro lo muestra; el lápiz ✎ permite **editar nombre, sexo y nacimiento**
  solo para la sesión (el archivo DICOM no se modifica).
- Metadatos DICOM completos con búsqueda y exportación JSON / CSV. Captura PNG con el logotipo «DICOM viewer» como marca de agua, en la versión del tema activo (también de la panorámica y del mosaico de ATM). Doble clic sobre la panorámica vuelve al 2×2. Rotación automática.
- **Escáneres intraorales** (STL / PLY / OBJ), solos o junto al CBCT: se orientan automáticamente al marco
  del paciente (como el paso 1 de tresD Models) y, con CBCT, se **alinean solos sobre los dientes** (superficie
  dental por HU, multiarranque + ICP punto-a-plano, como VOXEL) con error y cobertura en la barra de estado; la arcada
  superior es la que se alinea y la inferior la sigue (misma oclusión), en cualquier orden de importación;
  si hace falta, **alineación por 3 puntos** (clics en el escáner y en los dientes del CBCT); la arcada
  complementaria hereda la posición (misma oclusión); aviso de escala y de trozos sueltos; tarjeta por escáner
  (ver/ocultar, transparencia, color, voltear, alinear al CBCT, alinear por puntos); corte y medición también
  sobre las mallas; **siluetas** de las mallas sobre los cortes MPR (desactivables).
- **Segmentación rápida** del CBCT (cráneo + piel por umbral automático, con la dentición a resolución fina
  para ver las coronas; la piel al 80 % de opacidad). La piel es la superficie EXTERNA: ya no lleva dentro
  la vía aérea ni los senos y **foto frontal drapeada** sobre la
  piel 3D: detección facial automática (MediaPipe, en el navegador) o, si no reconoce la cara en la piel 3D
  (p. ej. el CBCT no incluye los ojos), **3 clics** a mano (punta de la nariz y las dos comisuras) en la foto y
  los mismos 3 en el 3D.
- **Vía aérea faríngea** como en VOXEL: dos clics en el corte sagital (límite superior a la altura del paladar /
  PNS y límite inferior en la epiglotis) → malla de la columna de aire con **mapa de calor** del área de la
  sección (azul = amplio, rojo = estrecho) y **valores** (volumen en cm³ y área mínima MCA en mm²) comparados
  con la norma adulta por sexo (Guijarro-Martínez & Swennen 2013; verde / naranja / rojo) en la tarjeta de la
  malla; los valores se ocultan al ocultar la vía aérea. Al terminar, preset «vía aérea» y vista lateral derecha.
- **Deshacer / rehacer** (botones ↶ ↷ y Ctrl+Z / Ctrl+Y) de todo lo que se hace sobre el caso: añadir o quitar
  escáneres, alinear, voltear, transparencia, color, ver/ocultar, segmentación, foto, vía aérea, mediciones,
  corte, preset, brillo/contraste, siluetas. (Cargar o quitar el DICOM no se deshace.)
- Contador de visitas anónimo (GoatCounter: sin cookies ni datos personales).
- **Valoración** (1-5 estrellas + comentario opcional): se pide una vez tras unos minutos de uso y siempre desde el botón «★ Valorar» de la cabecera. Llega por correo al titular; anónima.
- Términos de uso (aceptación en la primera visita), aviso legal y política de privacidad (pie de página).
  Uso previsto: visualización y docencia; NO es un producto sanitario con marcado CE ni sirve para diagnosticar.
- Español / inglés, tema oscuro / claro, tamaño de letra (botón Aa), paneles replegables (⟨ ⟩ / 📌).
- Identidad según el manual de marca tresD DICOM (`marca/`): logotipos oficiales, paleta verde tresD / menta y tipografía Poppins.

## Cómo probarlo en tu PC
Doble clic en **`ABRIR_tresD_DICOM.bat`** (usa el Python del venv de VOXEL para servir la carpeta
`docs/` y abre el navegador en http://localhost:8123/).

## Cómo publicarlo
Doble clic en **`SUBIR_GITHUB.bat`**. En GitHub, la primera vez: *Settings → Pages → Source: Deploy
from a branch → Branch: main / carpeta /docs → Save*. La web queda en
https://mfdezc505.github.io/tresD-DICOM/ (tarda 1-2 minutos en actualizarse).

## Estructura
- `src/` código fuente (Vite + JavaScript). `docs/` web construida (es lo que se publica).
- `public/img/` logos e iconos derivados de los maestros de `marca/` (manual de marca + PNG oficiales; no se despliega).
  `public/fonts/` Poppins (OFL). `tests/` pruebas automáticas (Chromium sin cabeza).
- `CLAUDE.md` + `CONTEXTO.md`: contexto para las sesiones de trabajo con Claude.

## Motores (licencias)
Cornerstone3D (MIT) · vtk.js (BSD-3) · dcmjs (MIT) · dicom-parser (MIT) · fflate (MIT) · Vite (MIT) ·
MediaPipe Face Mesh (Apache-2.0, servido desde `docs/mediapipe/`) · Poppins (SIL Open Font License, en `docs/fonts/`).
Herramienta de visualización y docencia: no es un producto sanitario certificado ni está destinada al
diagnóstico. El uso y la custodia de los datos de los pacientes son responsabilidad de cada profesional.
