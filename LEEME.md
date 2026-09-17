# tresD DICOM — visor gratuito de DICOM y DICOMDIR

Visor web de CBCT con la interfaz de VOXEL. Todo se procesa **en el navegador**: los archivos DICOM
nunca salen de tu ordenador.

## Qué hace (v0.8.6)
- Abre carpetas DICOM, DICOMDIR, ZIP y **RAR** (arrastrar o botones; también comprimido dentro de comprimido y archivos
  grandes, descomprimidos aparte sin bloquear la ventana; un ZIP se reconoce por su contenido aunque tenga otra extensión). Detecta las series y deja elegir. Repara solo
  las series mal escritas: tamaño de vóxel incoherente y **bloques de cortes colocados fuera de sitio** (la
  parte alta del cráneo saliendo suelta por debajo del resto); avisa en la barra de estado cuando lo hace.
- Volúmenes muy grandes (p. ej. 1003×1003×874) se reducen automáticamente a la mitad para caber en la memoria gráfica (aviso en la barra de estado). El render 3D usa una copia suavizada (≤ 400 vóxeles por eje, como VOXEL): sin grano y fluido; los cortes conservan la resolución completa.
- Render 3D con presets (marfil, hueso natural, radiográfico, gris, **tejido blando** (piel translúcida + hueso),
  **vía aérea** (hueso translúcido), estándar, **rejilla** = nube de puntos de la superficie del hueso como el modo
  de puntos de VOXEL, con la superficie en alambre (triángulos sutiles) debajo) + transparencia, brillo y contraste. El hueso se ve OPACO (marfil). Vistas Frontal / Derecha /
  Izquierda / Superior / Inferior / Posterior, Centrar y Rotación (solo aparecen cuando el render está a la vista).
- Tres cortes MPR (axial, coronal, sagital): rueda = cambiar de corte (o el **deslizador horizontal** que va **bajo
  cada corte**, del color de ese corte, para tabletas y ratones sin rueda), arrastrar = brillo/contraste,
  botón central = mover, botón derecho = zoom. **Cruz de referencia** (botón «✛ Cruz»): arrastra el centro
  para navegar los tres planos a la vez y gira los brazos con los circulitos que aparecen al pasar el ratón
  por una línea (brillo/contraste = Mayús + arrastrar). La Cruz solo está en 2×2, «3D + cortes» y «En fila».
- **Panorámica** (corte curvo a lo largo de la arcada dental, detectada automáticamente): llega **hasta los
  cóndilos** (la curva se prolonga por las ramas y la imagen es más alta), grosor ajustable en vivo, MIP
  activado por defecto, curva dibujada sobre el axial y **editable** («✎ Editar curva»: se arrastran los 13
  puntos amarillos sobre el corte axial (el axial se coloca solo a la altura de los dientes y dos líneas finas marcan el grosor del corte) y la panorámica se rehace; «↺ Curva automática» la recalcula);
  «✏ Dibujar curva» permite marcar la curva a mano con clics sobre el corte axial (de un cóndilo al otro por los dientes);
  brillo/contraste arrastrando sobre la imagen. **Medir** con los botones «📏 Distancia» (dos toques) y
  «📐 Ángulo» (tres toques), con la etiqueta arrastrable; grosor por defecto 22 mm.
- **Telerradiografía simulada** (botón «TeleRx»): proyección del CBCT con rayos paralelos, como una TeleRx.
  **Lateral** (cara a la derecha) o **frontal (PA)**; **radiografía** (suma de la atenuación a lo largo de cada
  rayo: tejido blando y hueso superpuesto) o **MIP** (solo lo más denso). Escala **1:1** en mm reales (sin la
  magnificación del 8-10 % de la TeleRx convencional; solo sale lo que abarca el CBCT). Deslizador de
  **inclinación** para nivelar la cabeza (las medidas giran con la imagen), brillo/contraste arrastrando,
  medidas por toques («📏 Distancia», «📐 Ángulo», «⌫ Borrar medidas») con deshacer/rehacer, **regla de 50 mm con
  marcas cada 5 mm** (abajo a la izquierda; sale en la captura y en el informe, para calibrar programas de
  cefalometría 2D), captura PNG, y entra en el informe y en la sesión .tresd. Se calcula una vez por vista (menos de un segundo en un CBCT
  normal) y luego cambia al instante.
- **Cortes de ATM**: marcas un punto sobre cada cóndilo y el visor busca la cabeza condilar, calcula su eje
  entre polos y saca, por lado, 5 cortes sagitales perpendiculares a ese eje **a 1 mm** (de medial a lateral),
  1 coronal y 1 axial (este a la altura de la cabeza del cóndilo, ya separada de la fosa), en un mosaico (como el panel de ATM de VOXEL). La **rueda del ratón** recorre los
  cortes de milímetro en milímetro (sobre un sagital mueve los cinco; sobre el coronal o el axial, solo ese).
  **Arrastrar = brillo/contraste**. Los cortes se encuadran solos a la casilla del mosaico. Cada corte se
  puede **ver en grande** (doble clic sobre él o botón ⤢ de la casilla) y ahí se **mide** con los botones
  «📏 Distancia» (dos toques) y «📐 Ángulo» (tres toques: extremo, vértice, extremo), sin teclas: vale para
  tabletas. Las medidas (en mm o grados, con su color y deshacer/rehacer; «⌫ Borrar medidas» las quita) se ven
  también en el mosaico, más pequeñas, y sus etiquetas se pueden arrastrar.
  Los **polos medial y lateral** se buscan como en VOXEL: desde la huella del cóndilo se sube hasta el espacio
  articular y se toma la sección más ancha, con los dos polos a la misma altura (si el resultado no es plausible se
  usa la estimación clásica). Con los cortes hechos, el botón «Cortes de ATM» se oculta.
  Nada más marcar los cóndilos se abre **«⌖ Ajustar polos»** para revisar la propuesta automática (los polos
  se colocan a mano sobre un corte axial; Cancelar deja la propuesta). En el corte ampliado, «📷 Captura»
  guarda ese corte en PNG con sus medidas. El mismo botón «⌖ Ajustar polos» del mosaico vuelve a abrirlo y
  rehace los cortes perpendiculares al nuevo eje (medial y lateral salen bien también en los CBCT cuyo
  origen no está en la línea media). Al marcar los cóndilos, el corte coronal se coloca solo a su altura
  (la rueda lo ajusta). Rótulos y medidas se dibujan a la resolución de la pantalla: se leen nítidos también
  en el corte ampliado.
- **Informe (PDF / PowerPoint)**: botón «📄 Informe» de la cabecera → eliges qué incluir (datos del paciente, render 3D
  como se ve y **ampliado en frontal / derecha / izquierda** (sin fondo: PNG transparente), cortes axial/coronal/sagital
  sin siluetas, panorámica (se calcula sola si no se ha abierto), **TeleRx lateral y frontal en radiografía y MIP**,
  cortes de ATM, **página de vía aérea** (vista lateral con el cráneo y los escáneres translúcidos y sin la piel, vía aérea opaca con
  su mapa de calor, valores, norma adulta por sexo, desviación y referencia), tabla de medidas), el **tema** (oscuro como
  el visor, con el fondo oscuro en todas las páginas, o claro para imprimir), el **formato** (PDF, PowerPoint o ambos) y
  escribes observaciones; se **descarga** directamente (PDF A4 con jsPDF; PowerPoint 16:9 con PptxGenJS). Lleva el logotipo, la fecha, los datos del estudio, las medidas con su color y vista, los ejes del cóndilo,
  la vía aérea, las observaciones, el aviso legal y el número de página. Nada sale del ordenador.
- **Guardar / abrir sesión (.tresd)**: «💾 Guardar» descarga un archivo pequeño (JSON) con todo lo hecho sobre el
  caso: render y brillo/contraste, medidas (3D, cortes MPR, panorámica, ATM), curva de la panorámica, polos de la
  ATM, vía aérea, segmentación, colocación de los escáneres, datos editados del paciente y disposición. Los
  DICOM y los escáneres NO van dentro (privacidad y tamaño). «📂 Abrir» (o arrastrar el .tresd) lo restaura sobre
  el CBCT cargado; si se abre antes, queda pendiente y se aplica al cargar el CBCT. Los escáneres se importan
  otra vez y se colocan solos donde estaban (sin preguntar ni realinear). La foto drapeada se guarda en la sesión
  (recorte de la cara y pose de la cámara) y se vuelve a proyectar sobre la piel al abrirla.
- **Compartir caso (.tresdz)**: «📦 Compartir» empaqueta en UN archivo el CBCT (reescrito como DICOM), los escáneres
  ya alineados y la sesión, para enviárselo a un colega, que lo abre en tresddicom.com con «Subir ZIP» o
  arrastrándolo, con «📂 Abrir», con «Subir ZIP» o con el botón de la pantalla inicial, sin los DICOM originales. Por
  defecto **anonimizado** (sin nombre, ID, nacimiento ni centro; quedan sexo y fecha del estudio) y **reducido** (vóxel
  × 1,6 → 1/4 del tamaño; las medidas sobre TeleRx y ATM no se conservan); ambas casillas se pueden desmarcar. Los
  escáneres con color van en PLY (conservan el color). La **foto drapeada** solo va si se marca su casilla (identifica
  al paciente; se propone cuando no se anonimiza).
- **Exportar mallas a STL**: botón ⭳ del panel derecho (o botón derecho sobre ese panel) → se eligen las
  mallas y se descarga un STL por cada una, en la posición que tienen en pantalla.
- Multipantalla: 2×2, 3D + cortes, en fila, o cada visor solo (botón ⤢ o doble clic). Al importar un escáner —y al
  terminar de alinearlo— el render 3D pasa a la vista (y el volumen se enciende si estaba apagado).
- Los procesos largos (informe, segmentación, foto drapeada) muestran una **ventana de progreso** con el paso actual.
- **Instalable como aplicación** (Chrome / Edge → «Instalar»): ventana propia con el logotipo y los archivos .tresdz /
  .tresd se abren con **doble clic** (Windows y macOS los muestran con el icono de tresD DICOM).
- Medición de distancias y ángulos, en el 3D (sobre el hueso) y en los cortes MPR: cada medición con su
  color y trazado en vivo mientras mueves el ratón.
- **Orientar el volumen** (panel izquierdo): tres deslizadores enderezan la cabeza en los tres planos (inclinación
  sagital, inclinación lateral y giro). Gira el caso entero —volumen, escáneres, segmentaciones y medidas—, así que
  los cortes, la **panorámica**, la **TeleRx** y los **cortes de ATM** salen ya con el paciente derecho; «↺ Orientación
  original» vuelve exactamente al punto de partida y la orientación se guarda en la sesión.
- Corte del volumen por plano sagital / axial / coronal, con «voltear lado».
- Planos MPR dentro del render 3D (panel derecho).
- «✚ Nuevo caso» (cabecera) cierra todo y vuelve a la pantalla inicial, con confirmación. Botón «?» con la
  **ayuda completa** por secciones (ES / EN).
- Chip del paciente en la cabecera (nombre · sexo · nacimiento y edad · fecha del estudio): un **clic lo
  oculta** (docencia, capturas) y otro lo muestra; el lápiz ✎ permite **editar nombre, sexo y nacimiento**
  solo para la sesión (el archivo DICOM no se modifica).
- Metadatos DICOM completos (botón 🏷️) con búsqueda y exportación JSON / CSV. Captura PNG con el logotipo «DICOM viewer» como marca de agua, en la versión del tema activo (también de la panorámica y del mosaico de ATM). Doble clic sobre la panorámica vuelve al 2×2. Rotación automática.
- **Escáneres intraorales** (STL / PLY / OBJ), solos o junto al CBCT: se orientan automáticamente al marco
  del paciente (como el paso 1 de tresD Models) y, con CBCT, se **alinean solos sobre los dientes** (superficie
  dental por HU, multiarranque + ICP punto-a-plano, como VOXEL) con error y cobertura en la barra de estado; la arcada
  superior es la que se alinea y la inferior la sigue (misma oclusión), en cualquier orden de importación;
  si hace falta, **alineación por 3 puntos** (clics en el escáner y en los dientes del CBCT); la arcada
  complementaria hereda la posición (misma oclusión); aviso de escala y de trozos sueltos; tarjeta por escáner
  (ver/ocultar, transparencia, color, voltear, refinar alineación, alinear por puntos); corte y medición también
  sobre las mallas; **siluetas** de las mallas sobre los cortes MPR (apagadas por defecto). Al alinear por puntos
  el render pasa a pantalla completa en vista derecha: el escáner de cerca y, después, el CBCT centrado y ampliado
  sobre los dientes.
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
Cornerstone3D (MIT) · vtk.js (BSD-3) · dcmjs (MIT) · dicom-parser (MIT) · fflate (MIT) · node-unrar-js (MIT; unrar de RARLAB, licencia UnRAR) · jsPDF (MIT) · PptxGenJS (MIT) · Vite (MIT) ·
MediaPipe Face Mesh (Apache-2.0, servido desde `docs/mediapipe/`) · Poppins (SIL Open Font License, en `docs/fonts/`).
Herramienta de visualización y docencia: no es un producto sanitario certificado ni está destinada al
diagnóstico. El uso y la custodia de los datos de los pacientes son responsabilidad de cada profesional.
