# CONTEXTO.md — tresD DICOM (decisiones, caminos y estado)

Última actualización: 11-09-2026 · v0.5.0 (FASE 3: segmentación rápida hueso + piel y foto frontal drapeada)

## 1. Decisiones de arquitectura (10-09-2026, Manuel eligió las recomendadas)
- **100% navegador, sin servidor.** Motivo: RGPD (los DICOM de pacientes no salen del PC), coste cero
  de hosting (GitHub Pages) y sin instalación para el usuario final.
- **Por fases**: Fase 1 = DICOM/DICOMDIR/ZIP + metadatos + render 3D + MPR + medición + corte +
  multipantalla (HECHA). Fase 2 = importar escáner STL/PLY/OBJ + autorientación + alineación al CBCT (HECHA,
  ver 2d/2e). Fase 3 = segmentación rápida + UNA foto frontal drapeada sobre la piel (HECHA en v0.5.0, ver 2h).
- **Repositorio** `Desktop\tresD_DICOM`, GitHub `mfdezc505/tresD-DICOM`, web en
  `https://mfdezc505.github.io/tresD-DICOM/` sirviendo la carpeta `docs/` de `main`.
- **Idioma ES + EN** con selector (botón ES/EN arriba a la derecha), persistido en localStorage.
- **Manuel no instala Node**: Claude construye `docs/` en la nube y lo escribe en su PC.

## 2. Qué se portó de VOXEL y cómo
| VOXEL (Python)                                   | tresD DICOM (JS)                                  |
|--------------------------------------------------|---------------------------------------------------|
| `theme.py` LIGHT/DARK, degradado, botones        | `src/theme.css` (mismos hex), `src/app.css`       |
| Disposición Wizard: panel izq 330 / visor / panel der / barra de estado | `src/ui/layout.js`  |
| `ceph_dicom.load_dicom` (agrupar por serie, orden IPP·normal, dz real, multiframe) | `src/core/dicomLoad.js` (cabeceras con dicom-parser; el volumen lo monta Cornerstone) |
| `realistic_render.py` presets ivory/natural/radio/gray + estándar | `src/core/presets.js` (CTF/OTF por fracción de ventana; gradiente = rampa mín/máx de vtk.js) |
| Brillo/Contraste (`set_volume_window`)           | mueven la VENTANA del preset sin perder el aspecto (mejora sobre VOXEL, que pasaba a gris) |
| `set_volume_opacity` lineal                      | escala los nodos de opacidad del preset           |
| `set_volume_clip` (1 plano, voltear, slider)     | `viewer.setCut` → `mapper.addClippingPlane`       |
| `_imp_measure_mode` (2 puntos / 3 puntos, colores, se desactiva al completar) | `src/core/measure3d.js` (3D: rayo hasta el primer vóxel opaco) + LengthTool/AngleTool de Cornerstone en los MPR |
| `set_mpr_slice` (planos MPR dentro del 3D)       | `src/core/mprPlanes.js` (cuadrado texturizado muestreado por VoxelManager) |
| `STANDARD_VIEWS` Frontal/Lateral D/I/Superior/Inferior/Posterior | `viewer.VIEWS` (marco LPS: derecha = -X, anterior = -Y, superior = +Z) |
| Metadatos paciente (`read_patient_meta`)         | chip de paciente + cajón de metadatos completo (dcmjs) con búsqueda y JSON/CSV |

## 2b. Mejoras v0.2.0 (petición de Manuel tras probar con un CBCT real, 10-09-2026)
- **Render "muy contrastado"**: dos causas. (1) vtk.js exagera el especular: sombreado suavizado
  (ivory amb 0.45 / dif 0.85 / spec 0.25 / pow 25; gradiente 0→150 con opacidad mínima 0.35).
  (2) La ventana por percentiles (35 %-99 % como VOXEL) caía en esmalte/metal en CBCT reales y
  dejaba el hueso gris/translúcido: ahora `windowFor` usa **Otsu** (umbral tejido/hueso) y el
  percentil 90 del hueso, anclados a las fracciones del preset donde empieza la opacidad (0,22)
  y donde el hueso ya es blanco opaco (0,68). Hook `window.tresd.V.tune({...})` para experimentar
  desde la consola y `tests/tune.mjs` para capturar variantes.
- Cursor normal en los MPR (CSS `!important` sobre el icono W/L de Cornerstone); cruz solo al medir.
- **Paneles replegables** (botón ⟨ / ⟩; 📌 vuelve a anclar): replegado = fuera del flujo, aparece
  al acercar el ratón a la franja del borde (`.sidewrap.auto`, como el visor HTML de VOXEL).
  Estado en localStorage `tresd_dicom_panels`.
- **Mediciones encadenadas**: el modo NO se apaga al completar (Esc / botón). Etiquetas 3D
  arrastrables (desplazamiento en píxeles respecto al ancla) y doble clic las borra. En los MPR
  las cajas de texto de Cornerstone ya eran arrastrables.
- Botones y letra más compactos; **tamaño de letra** ajustable (botón "Aa", 4 tamaños, variable
  CSS `--fs`, localStorage `tresd_dicom_font`).
- Vistas en inglés: Front / Right / Left / Top / Bottom / Back (Frontal/Superior/... se escribían
  igual y parecía que no traducía).
- Build con nombres FIJOS en `docs/assets/` (sin hash) para sobrescribir en el PC de Manuel sin
  acumular copias; Pages cachea 10 min. Los archivos con hash de v0.1.0 que queden en su
  `docs\assets` son basura inofensiva.

## 2c. Volúmenes GRANDES (v0.2.1) — caso Dylan Simpson: 1003×1003×874 = 880 M vóxeles (1,8 GB)
- Síntoma: "Cargado" pero visores vacíos (rectángulos grises): la textura 3D no cabe en la GPU y los
  874 archivos + 874 cortes decodificados desbordan la RAM.
- Solución (`src/core/bigVolume.js`, equivalente al `RENDER_MAX_DIM` de VOXEL): si
  filas×columnas×cortes > presupuesto (170 M vóxeles; 260 M si `navigator.deviceMemory` ≥ 16 GB),
  se construye un volumen REDUCIDO por un factor entero f = ceil(cbrt(vóxeles/presupuesto))
  (promedio de bloques f×f×f) leyendo los archivos UNO A UNO y liberándolos. Ruta rápida sin
  decodificar para sintaxis sin comprimir (vista Int16 directa sobre el archivo); si vienen
  comprimidos, decodifica Cornerstone y se libera imagen + metadatos (`clearQuery(NATURALIZED, id)`).
  Resultado: `volumeLoader.createLocalVolume` (sirve para render y MPR). Aviso en la barra de estado.
- TRAMPA: el id del volumen local NO puede llevar ':' (`tresdLocal_<t>`): si los cortes locales tienen
  ':' Cornerstone cree que son cargables y falla ("No image loader found for scheme").
- Caso Dylan → f = 2 → 501×501×437 (0,40 mm). Probado aquí con la muestra a 0,25 mm (667×667×433 → ×2).

## 2d. FASE 2 — Escáneres intraorales (v0.3.0, 11-09-2026)
Portado de tresD Models (`core/mesh_io.py` + `core/orient.py`), sin tocar tresD Models.
- `src/core/meshes.js`: lectura STL (parser propio binario/ASCII + fusión de vértices repetidos: STL trae
  3 vértices sueltos por triángulo y sin fusionar no hay conectividad ni normales suaves), PLY (vtkPLYReader,
  colores por vértice "RGB") y OBJ (vtkOBJReader, polígonos → abanico de triángulos). Comprobación de
  ESCALA (diagonal 25-200 mm; si no, el diálogo ofrece ×10 / ×1000 / ×25,4 / ×0,001), TROZOS SUELTOS
  (union-find por triángulos; se quitan si suman < 5 % del área, como `drop_islands`), rol por NOMBRE
  (`guess_role`: upper/sup/max… · lower/inf/mand…). Normales por vértice ponderadas por área (sin
  vtkPolyDataNormals). Clase `MeshLayer`: actores vtkActor colgados en el visor 3D de Cornerstone
  (`vp.addActor({uid, actor})`), visibilidad, transparencia, color, plano de corte (mismo `{ai, cut, flip}`
  que el volumen), `pick` rayo-triángulo Möller–Trumbore (para medir sobre la malla) y `flip` 180°.
- `src/core/orient.js`: port fiel de `orient.py` (PCA → eje oclusal; lado de los dientes por la BÓVEDA,
  si no por islas de la sección, si no por área; línea media por simetría de la silueta; sentido por la
  forma de U). Devuelve matriz 4×4 al marco LPS del visor (+X izquierda, +Y posterior, +Z superior:
  la superior queda con los dientes hacia -Z). Avisos como CÓDIGOS (`u_shape|0.30`, `symmetry|0.50`,
  `side|cusps|3|1`) que traduce la interfaz (`warnText` en main.js).
- HERENCIA del giro (regla de tresD Models): al añadir la arcada COMPLEMENTARIA (superior↔inferior) con
  orientación automática, si no hay ya otra del mismo rol, hereda la matriz completa (giro + colocación)
  de la otra para NO romper la oclusión del escaneo. Dos del mismo rol se orientan cada una por su cuenta.
- Con CBCT cargado, la malla orientada se ALINEA a las coronas del CBCT (ver 2e). Sin CBCT, en el origen.
  Sin orientación automática no se toca nada.
- Cornerstone: `setVolumes` hace `removeAllActors` en el visor 3D → tras cargar un CBCT hay que volver a
  colgar las mallas (`meshes.reattach()`) y redibujar las mediciones (`measure3d.redraw()`). El actor del
  volumen ya NO se busca con `getDefaultActor()` (podría ser una malla) sino con `actor.isA('vtkVolume')`.
  `resetCamera` sin volumen funciona (usa `computeVisiblePropBounds`). TrackballRotate/Zoom/Pan toleran que
  el actor por defecto sea una malla.
- Interfaz: grupo "2 · Escáner intraoral" (botón + arrastre de .stl/.ply/.obj, también dentro de ZIP);
  diálogo por archivo (nombre, triángulos, tamaño mm, casilla de escala, rol, casilla de orientar);
  tarjetas por malla en el panel derecho (ver/ocultar, transparencia, color, «Color del escáner» si PLY
  con colores, «Voltear 180°», ✕). Sin CBCT solo se muestra el visor 3D (los MPR no tienen sentido) y la
  tarjeta DICOM / MPR se ocultan. `hasCase()` = volumen o alguna malla.
- Pruebas: `python3 tests/make_meshes.py` genera arcadas sintéticas (U con bultos-dientes y bóveda,
  giradas al azar; superior STL, inferior PLY con colores EN OCLUSIÓN, copia en cm, copia con isla, OBJ).
  `node tests/orient.mjs` (unitaria en Node: dientes abajo, incisivos anteriores, línea media, det=+1) y
  `node tests/meshes.mjs` (Chromium: todo el flujo, incluido CBCT cargado después) → 0 errores.
- Pendiente de Manuel: probar con escáneres REALES (`tresD_Models\Ejemplo\T0.stl`, `T1.stl` y los de
  Dropbox); las sintéticas orientan con simetría 0,98 / U 0,83.

## 2e. ALINEACIÓN escáner → CBCT (v0.4.0, 11-09-2026) — port de VOXEL `ceph_lite/core/steps.py`
Manuel vio que con CBCT el escáner quedaba flotando en el centro del volumen. Ahora `src/core/align.js`
replica la estrategia de VOXEL (`auto_align_scanner`), en JS puro:
1. **Coronas del CBCT por HU** (`_build_teeth`): esmalte = vóxeles ≥ percentil 99,5 de la muestra de HU
   (`state.sorted`); ANCLA = mediana de los ≥ p99,9 (descartando el 15 % más lejano: peñasco/metal);
   caja de recorte alrededor (p90 + 8 mm por eje, máx. 45/45/30); línea oclusal = mediana de la altura;
   franja de coronas de 12 mm por arco. Solo vóxeles de BORDE EXTERIOR (algún vecino a 1-2 vóxeles < 400 HU:
   la cara que ve el escáner, no la unión esmalte-dentina). Lectura por cortes: `vm.scalarData` (volumen
   reducido) o `cache.getImage(imageIds[k]).voxelManager.scalarData` (streaming); `getSliceData` es el último
   recurso (vóxel a vóxel, lento). Caché en `state.enamel` (se borra con el volumen).
2. **Colocación** (`_scan_to_teeth`): banda de coronas del escáner (`_crown_source`: superior = 55 % más
   bajo en Z; inferior = 45 % más alto) centrada sobre las coronas del CBCT; candidatos: giro 0°/180° en Z
   (frente/atrás) y, si orient.js dudó, también volteo arriba/abajo; si el escáner ya estaba sobre las
   coronas (re-alinear) su pose actual también compite. Cada candidato: ICP recortado corto (2000 pts,
   keep 0,5, 25 it) → puntuación = cobertura a 1,5 mm + 0,15 si coronas hacia el lado correcto + 0,2·(acuerdo
   incisivos escáner/CBCT, `_arch_frame`+`_arch_ap_sign` portados en `archAnterior`).
3. **Encaje fino** (`_fine_seat`): ICP recortado (6000 pts) keep 0,5/0,35, luego rondas multiescala
   0,6/0,45/0,30/0,20 con GUARDIA (nunca empeora, métrica = media recortada 60 %), y una etapa final solo
   con pares a < 1,5 / 1,0 / 0,7 mm (para que encía y paladar sin esmalte enfrente no tiren).
   Vecino más cercano por rejilla de 1 mm con anillos crecientes y parada temprana; rígido por Horn
   (cuaterniones, Jacobi 4×4). Calidad: error (media recortada 60 %) y cobertura a 0,7 mm; > 0,8 mm = DUDOSA.
4. **Oclusión** (`_apply_occlusion`): la transformación se aplica a TODAS las mallas del mismo grupo (las que
   heredaron el giro) y se compone en `item.M`, así la arcada complementaria que se añada después hereda ya
   la posición alineada. Solo se alinea un representante por grupo (la superior primero). Botón
   «⌖ Alinear al CBCT» en cada tarjeta (re-encaje manual; visible solo con CBCT).
5. Cuándo: al añadir un escáner con CBCT cargado (`addMesh`), al cargar un CBCT con escáneres presentes
   (`alignAllMeshes` desde `openSeries`) y con el botón. Estado: «alineado a las coronas del CBCT (error X mm,
   cobertura Y %)». La consola registra tiempos (`tresD alineación …`).
- Pruebas: `python3 tests/make_synth_cbct.py` (CBCT sintético 0,5 mm con las dos arcadas en pose CONOCIDA:
  esmalte 2400 HU, encía 300, losas de hueso 900, tejido 40) + `node tests/align.mjs`: centroide a 0,17 mm
  del verdadero, error 0,25 mm, cobertura 65 %; la inferior hereda (0,66 mm); CBCT después → igual;
  re-alinear no se mueve. Con la muestra DZ-CBCT real y la arcada sintética (no coinciden) da 0,67 mm / 34 %
  sin fallar. TRAMPA: en Chromium sin GPU (SwiftShader) los `await` de la interfaz dejan renderizar y la
  extracción "tarda" 30 s; el cálculo real son ~250 ms (el log lo separa: «esperas de interfaz»).
- (v0.4) Manuel probó con reales: el escáner quedaba delante del maxilar → rehecho en v0.6 (ver 2i).

## 2f. Contador de visitas y botones de subida (v0.4.0)
- GoatCounter (`https://tresd-dicom.goatcounter.com/count`, constante `COUNTER` en main.js): gratis, sin
  cookies, sin datos personales → sin banner RGPD. Se inyecta `gc.zgo.at/count.js` salvo en localhost/file:.
  Eventos anónimos: `evento-cbct` (CBCT cargado) y `evento-escaner`. Manuel debe crear la cuenta en
  goatcounter.com con el código EXACTO `tresd-dicom` (si está ocupado, cambiar la constante).
  Decisión: NO login ni AdSense (fricción, RGPD, ingresos ínfimos); ver conversación 11-09-2026.
- Botones de subida: el grupo «1 · Sube el CBCT» se oculta con un CBCT cargado; «2 · Escáner» con 2
  escáneres. Reaparecen al quitarlos con ✕ (`setHasCase`).

## 2g. Textos legales y uso previsto (v0.4.1, 11-09-2026) — `src/ui/legal.js`
- Decisión con Manuel (11-09-2026): sin login ni AdSense. Ingresos posibles: patrocinio sectorial, publicidad
  propia (LOOPS / tresD), versión Pro, licencias a clínicas, formación. Servidor: hoy NO hay tratamiento de
  datos de pacientes en ningún servidor (GitHub Pages solo sirve código); si algún día se suben casos, hará
  falta proveedor UE con DPA, cifrado, EIPD (datos de salud) y la clínica sigue siendo responsable.
- **MDR**: un software destinado al DIAGNÓSTICO es producto sanitario (clase IIa) y exige marcado CE aunque sea
  gratis. Por eso el uso previsto declarado es «visualización y docencia, NO diagnóstico» y hay que mantener ese
  lenguaje en TODA la interfaz (no escribir «herramientas diagnósticas»; medidas y alineación «orientativas»).
- Primera visita: ventana obligatoria «Antes de empezar» (términos, casilla de aceptación, botón desactivado
  hasta marcar; ES/EN dentro). Aceptación en localStorage `tresd_dicom_terms` = `TERMS_VERSION`
  (`v1-2026-09`): al cambiar los términos, subir la versión y volverá a pedirse. Enlaces en el pie:
  Términos · Aviso legal · Privacidad (misma ventana, con «Cerrar»).
- Contenido: Términos (uso previsto, no producto sanitario, usuarios profesionales, responsabilidad del usuario
  y de la custodia de datos RGPD, datos locales, sin garantías, propiedad intelectual, ley española / Málaga);
  Aviso legal LSSI art. 10 (titular, NIF, colegiado 29002594, domicilio Clínica Áncora, contacto, hosting
  GitHub Pages); Privacidad (sin datos de pacientes, GoatCounter anónimo por interés legítimo, localStorage
  técnico art. 22.2 LSSI, logs de GitHub, derechos / AEPD).
- Titular: Ortodoncia tresD Formación, S.L.U. (marca tresD Ortodoncia Digital), NIF B21663380, responsable Manuel; contacto tresdortodoncia@gmail.com (constante `OWNER` en `src/ui/legal.js`).
- Pruebas: `node tests/legal.mjs`; los demás tests saltan la puerta con `addInitScript` (localStorage).

## 2h. FASE 3 — Segmentación rápida y foto drapeada (v0.5.0, 11-09-2026)
Decisión de Manuel: UNA sola foto frontal y "matching" con la malla de tejido blando; para tenerla se
incorpora la segmentación rápida de VOXEL (hueso + piel por umbral). Port de `steps.segment_auto`,
`_auto_thresholds`, `wizard._face_drape_3d`, `_detect_face3d`, `viewer3d.drape_texture`, `face_register`.
- `src/core/segment.js`: umbrales por Otsu (piel = aire/cuerpo; hueso = Otsu sobre lo que queda) en la muestra
  de HU; volumen submuestreado por bloques a ≤ 10 M vóxeles (`buildGrid`, índices → mundo con `toWorld`);
  `vtkImageMarchingCubes` + componente conexo MÁS grande (quita reposacabezas, ruido) + `WindowedSinc`
  (≈ Taubin, no encoge; hueso 30 it / 0,05, piel 20 it / 0,08). Si el marco índice→mundo es espejo, se
  invierte el sentido de los triángulos. Muestra DZ (24 M vóx → f=2): cráneo 239 k tri (umbral 203 HU),
  piel 498 k tri (−543 HU); cálculo ~5 s (37 s en Chromium sin GPU por los renders entre `await`).
  Las mallas entran en `MeshLayer` con roles 'skull' / 'soft' (`item.seg = true`: sin voltear/alinear;
  colores hueso / piel; material propio). Se quitan con el CBCT.
- `src/core/drape.js`:
  · MediaPipe **Face Mesh** (Solutions legacy 0.4, Apache-2.0) SERVIDO DESDE `public/mediapipe/` (17 MB:
    wasm + modelos; ningún CDN, no hay red exterior). El paquete moderno `tasks-vision` necesita el modelo
    `face_landmarker.task` de storage.googleapis.com (bloqueado aquí); el legacy trae todo en npm. Carga
    perezosa por `<script>` al primer uso; una instancia reutilizada con `reset()`; 478 puntos (x,y) 0..1.
    Funciona en Chromium sin GPU (WebGL2 SwiftShader, ~3 s por detección).
  · `solvePose` (PnP con focal libre acotada 0,5·W…8·W): Levenberg-Marquardt sobre 7 parámetros (giro
    Rodrigues, traslación, log f), jacobiano numérico, pesos Huber, inicio = cámara FRONTAL en LPS
    (R0 = x→+X, y→−Z, z→+Y) a la distancia que da el tamaño de la cara. Devuelve error mediano (px) e inliers.
    Probado en Node: 300 puntos + ruido 2 px + 20 atípicos → 0,8 px; 7 puntos → 0,5 px.
  · `buildAtlas`: RECORTE de la foto a la caja de la cara (puntos ±35 % lados, +60 % arriba, +25 % abajo) con
    margen 8 % de color piel (mediana en mejillas/frente/mentón) y "bleed". `projectUV`: cada vértice de la
    piel se proyecta con la pose; recibe foto si cae en la caja y mira a la cámara (n·v > 0,2); si no, va al
    margen pegado al borde más cercano del recorte (costura suave, sin el fondo de la foto en la nuca).
    Textura vtk.js: `vtkTexture.setCanvas` + TCoords (`meshes.setTexture`); origen de textura abajo (v = 1 − y).
- `viewer.js`: `segmentQuick`, `skinSnapshot` (piel sola, opaca, frontal, sin volumen ni corte → canvas del
  visor + `pick(nx, ny)` por rayo sobre la piel; `restore()` devuelve la escena), `drapePhoto(image, {pairs})`,
  `setDrapeVisible`, `clearDrape`, `pickOnSoft`, `showMarkers` (esferas en `measure3d.setMarkers`).
- Flujo (main.js): grupo «3 · Piel y foto facial» (solo con CBCT): «⚡ Segmentar hueso y piel» (se oculta
  al haber piel) y «📷 Subir foto frontal» (se oculta al drapear; también arrastrando .jpg/.png). Al subir la
  foto sin piel, se segmenta primero. AUTOMÁTICO: cara en la foto → render de la piel → cara en el render →
  puntos 3D por rayo → PnP → textura. Si falla (foto sin cara reconocible, piel sin ojos —CBCT pequeño—, o
  MediaPipe no carga) → REGISTRO MANUAL: diálogo con la foto para marcar 7 puntos guiados (nariz, subnasal,
  comisuras, mentón, cantos externos; prellenados si la foto sí se detectó; arrastrables; mínimo 5) y luego los
  mismos puntos con clic sobre la piel 3D (Esc cancela). Al drapear se oculta el render del volumen (casilla
  DICOM lo devuelve). Tarjeta de la piel: fila «📷 Foto drapeada» (ver/ocultar, ✕ quitar). Estado: error de
  registro en px. Gancho de prueba `window.tresd.forceManual`.
- Pruebas: `node tests/photo.mjs` con la muestra DZ: segmentación; vía automática con el propio render de la
  piel como foto (MediaPipe SÍ reconoce la piel de DZ aunque no tenga ojos: 425 puntos, error 1,1 px);
  vía manual forzada con 7 puntos exactos → 0,9 px; ocultar/quitar foto; imagen sin cara → manual → cancelar.
- Pendiente de Manuel: probar con un CBCT y una foto REALES del mismo paciente; decir si el ajuste vale.
  Mejoras posibles (backlog): fotos 3/4 para las mejillas (atlas multivista de VOXEL), recorte de la nuca
  por detrás de las orejas, suavizado ajustable por malla.

## 2i. v0.6.0 (12-09-2026) — alineación con dientes REALES, por puntos, dentición fina, siluetas, mediciones
Manuel probó con CBCT + escáner reales: el escáner quedaba DELANTE del maxilar. Con un banco de pruebas nuevo
con dientes reales se vio por qué y se rehízo `src/core/align.js` (sigue siendo un port de VOXEL, pero con
lo que faltaba):
1. **Banco de pruebas con dientes reales** (`tests/make_real_scans.py` → `/tmp/testdata/real_scans/`): del
   propio CBCT DZ se extrae la superficie a 600 HU (0,5 mm) de la zona dental, se parte en arcada superior
   e inferior por la línea oclusal (16 mm de alto: coronas + «encía»), y se guardan como STL en una pose
   ALEATORIA conocida (`pose.json`; las dos en el MISMO marco, como las exporta un escáner). Así se mide el
   error REAL de la alineación (giro y centro), no solo el error de encaje. `node tests/align_node.mjs [half|full]
   [offset]` lo corre en Node en ~15 s (sin navegador; `offset` simula un CBCT sin calibrar en HU) y
   `tests/real.mjs` en el navegador (con la interfaz).
2. **Por qué fallaba**: (a) el esmalte a p99,5 en un CBCT de 0,5 mm son 4 vóxeles sueltos por diente → el ICP
   no tenía a qué agarrarse (30 k puntos de borde en toda la cabeza, casi todo hueso cortical); (b) el umbral
   de «vecino de aire» era 400 HU FIJO (falla en CBCT sin calibrar); (c) la orientación de orient.js puede
   fallar > 15° en escáneres raros y los dientes son PERIÓDICOS: un giro de ~12° encaja cada diente sobre el
   vecino con cobertura casi igual (mínimo local); (d) el centro de la banda del escáner (con encía/paladar)
   no coincide con el de las coronas del CBCT (10-15 mm) y un solo arranque caía en un mínimo local.
3. **Destino** (`enamelTargets` + `pickTargets`): DOS umbrales relativos al histograma (`stats.js`:
   `autoThresholds` de Otsu, ahora compartido por presets/segment/align): `thrAnchor` = p99,9 (esmalte y metal,
   solo para LOCALIZAR la dentición: ancla, caja, línea oclusal) y `thr` = bone + 0,35·(p99,9 − bone) =
   SUPERFICIE del diente (la cara que ve el escáner; DZ: 816 HU); borde = algún vecino a 1-2 vóxeles < umbral
   de hueso (Otsu). Cada punto lleva su NORMAL (−gradiente de HU) para el ICP punto-a-plano. `pickTargets(raw,
   avoid)` reparte por arcos y permite RE-ANCLAR excluyendo 22 mm alrededor de la ancla anterior (reintento
   MUTUO de VOXEL `_build_teeth(avoid)`: `alignMesh` lo hace hasta 2 veces si el error > 1,0 mm y cachea la
   arcada ganadora en `state.teeth`).
4. **Colocación jerárquica** (`alignToTeeth`): nivel 0 = barrido COMPLETO de guiñada (0…345° cada 15°) ×
   desplazamientos ±8 mm (plano) y ±4 mm (altura) por familia (arriba/abajo si orient.js dudó) → cobertura
   bruta a 2,5 mm de 400 puntos (sin ICP, ~0,3 ms/pose, ~650-1300 poses); nivel 1 = 24 mejores distintas →
   ICP recortado corto (800 pts) → cobertura a 1,5 mm + sesgos anatómicos (masa central = paladar/base
   `centralMassDir`, incisivos = extremo estrecho `archAnterior` sobre el ESCÁNER y sobre el CBCT); nivel 2 =
   finalistas (el mejor de CADA familia + los mejores globales distintos, hasta 6) → encaje fino rápido (2000
   pts) → gana el ERROR final (discrimina el mínimo periódico: 0,43 vs 0,65 mm) → remate con 5000 pts.
   `Grid` ahora es CSR en arrays tipados (~10× más rápida que el Map). Total ~6 s en Node/Chrome.
5. **Encaje fino** (`fineSeat`): ICP recortado PUNTO-A-PLANO (`icpP2Plane`: sistema 6×6 con normales del
   CBCT, giro exacto por Rodrigues, guardia de paso absurdo) multiescala 0,7/0,5/0,35/0,25/0,2 en rondas con
   guardia + etapa final por distancia absoluta 1,5/1,0/0,7 mm. Resultado con dientes reales: superior giro
   0,13°, centro 0,05 mm (error de encaje 0,43 mm, cobertura 57 %); inferior 0,11° / 0,07 mm; igual con el
   volumen a 0,25 mm y con offset +1000 HU.
6. **Alineación POR PUNTOS** (`alignByPoints`, port de `align_scanner_points` + `_start_point_align`): botón
   «⊕ Alinear por puntos» en la tarjeta del escáner (con CBCT). FASE 1: solo se ve ese escáner; 3 clics
   (`pickOnMesh`: rayo-triángulo). FASE 2: se oculta el escáner y se muestra el CBCT; los MISMOS 3 clics en el
   mismo orden sobre los dientes (`pickOnTeeth`: rayo por el volumen aunque esté oculto, parando en el umbral
   de superficie dental). Los puntos del CBCT se encajan al punto de dentición más cercano (< 3 mm,
   `snapToTarget` = `_snap`), rígido por Horn (`rigidFromPairs`), ICP p2p + encaje fino (`refineToTeeth`) con
   guardia; la otra arcada se mueve igual (grupo). Barra flotante `#pa-bar` (Deshacer / Cancelar), Esc cancela,
   se restaura la visibilidad previa. Prueba: 3 clics con ±2 px → giro 0,28°, centro 0,05 mm.
7. **Dentición a resolución fina en la segmentación** (`segment.js`): el cráneo grueso (≤ 10 M vóxeles,
   suavizado 15 it) se recorta en la CAJA DE LAS CORONAS (extensión de la dentición ±4 mm, altura ±13 mm de
   la línea oclusal) y se sustituye por la isosuperficie FINA (`buildGrid` con caja de índices, ≤ 8 M vóxeles
   → 0,4-0,5 mm; filtro de media 3×3×3 solo si ≤ 0,35 mm) al umbral de SUPERFICIE DENTAL (816 HU en DZ):
   al umbral de hueso (203) los artefactos de metal y el volumen parcial fundían las coronas en un bloque
   (comprobado en `tests/out/bin_row.png`-style con la muestra). Componentes ≥ 400 triángulos (cada diente
   puede ser un trozo suelto). Se empalma con `mergeWithBox` (quita del grueso los triángulos con centro
   dentro de la caja − 1 mm; la fina sobresale 2 mm). Estado: «dentición a 0,50 mm».
8. **Siluetas en los cortes MPR** (`src/core/contours.js`, `Silhouettes`): por cada MPR un `<canvas
   class="silh">` superpuesto; en IMAGE_RENDERED / CAMERA_MODIFIED (rAF) se corta cada malla visible por el
   plano del foco de la cámara (eje mundo dominante) y se dibujan los segmentos con `vp.worldToCanvas` y el
   color de la malla. Triángulos repartidos por rebanadas de 1 mm (CSR) por eje y malla, caché por
   `item.rev` (sube en `transform`/`flip`). Casilla «Siluetas de las mallas en los cortes» (`#sil-vis`) en la
   tarjeta DICOM (`setSilhouettes`); una malla oculta no dibuja silueta.
9. **Mediciones**: en el 3D cada medición ya tenía su color (`MEAS_COLORS` cíclico); ahora la previsualización
   (puntos pendientes) usa el color que le tocará y hay TRAZADO EN VIVO: al mover el ratón con un punto
   pendiente, línea SVG (`svg.rubber`, discontinua) desde el último punto al cursor + etiqueta con el valor
   provisional (distancia o ángulo) calculada con un pick acotado a ~70 ms; desaparece al arrastrar (giro),
   al salir del visor o al completar. En los MPR cada anotación recibe su color en `ANNOTATION_ADDED`
   (`annotation.config.style.setAnnotationStyles`: color/highlighted/selected/locked + textBox), contador
   `state.mprMeasures` (se reinicia al borrar). `getMeasures()` expone ambas listas para las pruebas.
- Textos: «coronas» → «dientes» en los estados; DUDOSA sugiere «Alinear por puntos».

## 2j. Marca aplicada al software (v0.6.1, 12-09-2026) — manual `marca/tresD_DICOM_Manual_de_Marca.html` v1.2
Manuel pidió aplicar logos, colores y fuentes del manual, y dejar en la pantalla inicial solo el texto de
importar CBCT (sin mencionar escáneres STL/PLY/OBJ).
- `src/theme.css` reescrito con la paleta: verde tresD #004A46, verde bisel #10A23B, menta #89CBC4, azul bisel
  #ADD9E9 (sobre oscuro #B6D8E7/#97C9C3/#399F48), fondo oscuro #0B0F1A, gris tagline #373736/#AEBABA. Acento:
  claro = verde tresD (hover verde bisel); oscuro = menta (hover azul). Degradado de marca a 108° solo en el
  botón principal (`--grad`; claro verde→verde bisel con texto blanco, oscuro azul→menta→verde con texto
  #0B0F1A, `--grad-text`). Deslizadores (`--thumb`), progreso y tarjetas DICOM en la misma paleta. Tema claro
  sobre BLANCO (#FFFFFF, como el manual). Los colores de las mediciones (`MEAS_COLORS`) y las letras de
  orientación (cian) son semánticos y no cambian.
- Tipografía Poppins (OFL) empaquetada en `public/fonts/` (latin 300/400/500/600/700 woff2 de `@fontsource/poppins`,
  8 KB cada una; licencia `LICENSE-Poppins-OFL.txt`). `@font-face` en theme.css con `url("../fonts/…")`: Vite
  avisa «didn't resolve at build time» y lo deja tal cual → en `docs/assets/index.css` resuelve a `docs/fonts/`
  (funciona en local y en GitHub Pages con subruta). Pesos: 700 títulos/marca, 600 botón principal y títulos
  de tarjeta, 500 botones, 400 texto.
- Logos (`public/img/`, derivados de los maestros de `marca/` sin redibujar; script en el historial de la sesión):
  barra = versión COMPACTA (`logo_compact_light/dark.png`, 425×56, mostrada a 28 px; fondo blanco/oscuro
  convertido a alfa), pantalla inicial = versión PRINCIPAL con «viewer» (`logo_main_light/dark.png`, 1200 px,
  mostrada a min(56 %, 560 px) ≥ 260 px), icono = la D biselada sobre cuadrado redondeado (radio 22 %, D al 58 %,
  fondo blanco): `icon-16/32/48/180/192/512.png`, `icon.png` (256) y `favicon.ico` (16/32/48) enlazados en
  `index.html` (+ `theme-color` #0B0F1A). Se quitaron `tresd_mark_*.png` y el texto «DICOM / VISOR DICOM» de la barra
  (el manual prohíbe «VIEWER» en mayúsculas y la compacta ya lleva DICOM). En el PC de Manuel los `tresd_mark_*.png`
  antiguos pueden quedar en `public/img/` y `docs/img/`: no se usan.
- Pantalla inicial (`#main-drop`): logo principal + línea de apoyo del manual («Visor DICOM gratuito para
  visualización y docencia · funciona en tu navegador, sin subir archivos», `support_line`) + «Haz clic para subir
  tu CBCT / o arrastra aquí la carpeta DICOM, un DICOMDIR o un ZIP» (`drop_big`, sin escáneres) + privacidad +
  pie de titular (`owner_line`: tresD DICOM · Ortodoncia tresD Formación, S.L.U. · email). `import_hint` y
  `drop_small` del panel izquierdo también solo CBCT (el grupo «2 · Escáner intraoral» sigue explicando STL/PLY/OBJ).
- El manual (cap. 4) decía que la interfaz conservaría la tipografía de sistema; Manuel pidió expresamente
  «fuentes» → Poppins en toda la interfaz.

## 2k. v0.6.2 (12-09-2026) — la superior manda, render sin grano (volumen de render + luces), logo «DICOM viewer»
- **Flujo de escáneres (Manuel: «se usa el inferior para superponer en lugar del superior»)**: la arcada
  SUPERIOR es la que se alinea al CBCT y la inferior la sigue (misma oclusión), en cualquier orden de llegada:
  (a) `ingestMeshes` ordena los archivos superior → otros → inferior (por `guessRole` del nombre) al soltar
  varios; (b) `viewer.addMesh`: la superior que llega DESPUÉS de la inferior hereda su giro (grupo) pero se alinea
  ELLA (`info.master`) y arrastra a la inferior; la inferior que llega después de la superior solo la sigue; si la
  superior heredó una pose mala (la inferior sola había quedado DUDOSA/volteada) y su encaje sale > 0,8 mm, segundo
  intento desde su orientación PROPIA (`ownFrameTransform` = patientFrame sobre M⁻¹·pts, `meshes.snapshot/restore`
  para deshacer si no mejora; `info.reoriented`); (c) `alignMesh` busca en las DOS familias (arriba/abajo) cuando
  la malla heredó (`sure = ok && !inherited`); (d) el botón «Alinear al CBCT» de la INFERIOR alinea la superior de
  su grupo y la inferior la sigue (`st_align_follow_lower`). Prueba: `node tests/align.mjs E` (secciones A/C/E
  seleccionables por argumento).
- **Render 3D sin grano** (Manuel: «ruido del render» y «muy contrastado, no como VOXEL»): `src/core/renderVolume.js`
  = `RENDER_MAX_DIM = 400` + `_resample_volume` de VOXEL: el visor 3D usa un volumen local APARTE (`state.renderVolumeId`),
  promedio de bloques f×f×f hasta ≤ 400 vóx/eje (0,25 mm → 0,5 mm) o media 3×3×3 si ya cabe; los MPR, medición,
  alineación y segmentación siguen con el volumen completo. Se borra en `removeVolume`. `unitDistance` = espaciado del
  volumen de render. Y `setupLights`: juego de luces tipo LightKit de VTK/PyVista (principal 50°/10°, relleno −75°,
  frontal, dos traseras; `lightScale` 0,55 — el mapper de vtk.js SUMA las luces y con 0,75 sobreexpone; el efecto
  de la intensidad es pequeño, el ambiente del preset domina). `V.tuneLights(escala)` para experimentar.
  Resultado con DZ a 0,25 mm: hueso liso, sombreado suave (`tests/out/rv_*.png`). El marfil en tema claro sigue
  siendo blanco sobre blanco (como en VOXEL): usar «natural» o «gris» si se quiere contraste sobre fondo claro.
- **Logo**: Manuel quiere el «DICOM viewer» (versión principal) también en la barra (36 px de alto), no la compacta.

## 2l. v0.7.0 (12-09-2026) — opacidades, presets nuevos, deshacer/rehacer, cruz, vía aérea, panorámica y guarda de geometría
Petición de Manuel (7 puntos) + un fallo que apareció al probar («algunos DICOM aparecen con cambios de dimensión»).

- **Opacidad 80 % por defecto en la piel** (`main.js` `setCardOpacity`): al segmentar (`runSegmentation`) y al
  drapear la foto (`finishDrape`) la malla de piel queda al 80 % y el deslizador de su tarjeta lo refleja.
- **Marfil OPACO** (Manuel: «se ve semitransparente»): en vtk.js la curva de opacidad de VOXEL + el volumen de
  render suavizado dejaban ver las raíces a través de la mandíbula. `presets.js`: los presets de hueso (marfil,
  natural, gris) comparten `BONE_OTF` (0 hasta f 0,20 → 0,75 en 0,36 → **1,0 desde 0,60**), SIN opacidad por
  gradiente (`grad: null`, que era lo que dejaba «ver a través») y con `unitScale: 0.4` (nuevo campo: multiplica
  `setScalarOpacityUnitDistance`, así cada muestra del rayo pesa más y la superficie es sólida). El color se
  aclara antes (nodo en f 0,20) para que no salga gris sucio al ser ya opaco.
- **Presets nuevos** `soft` (tejido blando) y `airway` (vía aérea), con su propia ventana: `SKIN_ANCHORS` +
  `skinWindow` colocan el umbral aire/cuerpo (Otsu) en f 0,10 y el hueso cortical (p90) en f 0,72, así el preset
  no depende de la escala del escáner. `soft` pinta SOLO la cáscara de la piel (f 0,10-0,14 al 30 %) y pone a 0
  el interior blando (grasa/músculo, f 0,19-0,55) — si no, sale una neblina que tapa todo — con el hueso opaco
  detrás. `airway` es solo hueso translúcido azulado (0,28-0,4): una cáscara de piel, por tenue que fuera,
  tapaba la faringe. Tras segmentar la vía aérea se activa este preset (como VOXEL).
- **Deshacer / rehacer** (`src/core/history.js` + `viewer.history`): pila de ≤ 50 pares {undo, redo}, botones
  ↶ ↷ en la barra (con el nombre de la acción en el tooltip) y Ctrl+Z / Ctrl+Y (o Ctrl+Mayús+Z). Se apuntan:
  añadir / quitar mallas (con `meshes.detach`/`reinsert`, que quitan del visor SIN destruir el actor, y con
  instantáneas del grupo porque al llegar una arcada se mueven las otras), alineación automática y por puntos,
  voltear, transparencia / color / visibilidad (al SOLTAR el deslizador: `pointerdown` guarda el valor previo y
  `change` apunta), segmentación, foto drapeada y su borrado, vía aérea, mapa de calor, mediciones 3D y MPR
  (quitando / reañadiendo la anotación de Cornerstone), borrar mediciones, corte, preset, brillo/contraste,
  transparencia y visibilidad del DICOM, siluetas. Cargar o quitar el DICOM VACÍA la historia (no se deshace).
  `state.onMeshesChanged` → `main.syncCards()` reconstruye las tarjetas tras deshacer.
- **Cruz de referencia** (`CrosshairsTool` de Cornerstone en el grupo MPR, botón «✛ Cruz»): colores por corte
  (axial rojo, coronal verde, sagital azul). `applyMprBindings()` reparte el botón izquierdo por prioridad
  medición > cruz > brillo/contraste, y cuando la cruz está activa el brillo/contraste pasa a Mayús + arrastrar.
- **Vía aérea** (`src/core/airway.js`, port de `steps.airway_auto` + `airway_axis` de VOXEL): 2 clics en el corte
  sagital (superior ≈ PNS, inferior = epiglotis y semilla). Volumen submuestreado a ~0,75 mm; aire = HU <
  max(Otsu, −500); banda por encima del plano axial del clic inferior, por debajo del plano por el clic superior
  perpendicular al eje sup→inf, y por DETRÁS de PNS + 3 mm (en LPS: descarta y < sup.y − 3, que quita boca y
  fosas nasales); componentes conexas 6-vecinas, se descartan las que tocan los bordes X/Y (aire ambiente) y se
  coge la de la semilla (si la semilla no cae en aire interno, la MAYOR de las que pasan a < 20 mm: VOXEL cogía
  la más cercana y ganaba cualquier burbuja); volumen = vóxeles · vóxel; MCA = mínimo de las secciones
  PERPENDICULARES (área axial · cos θ del eje local) descartando 2 mm de cada punta y los cortes < 80 % de la
  mediana (los planos límite son oblicuos y dejan «esquinitas» con un área falsa de 8 mm²); marching cubes en la
  caja de la región, trozo mayor, suavizado 25. Mapa de calor RdYlBu invertido por vértice (`area_mm2`
  interpolada por altura), clim [MCA, p85]. Valores con norma adulta por sexo (Guijarro-Martínez & Swennen 2013,
  volumen H 32,1 ± 6,5 / M 22,7 ± 3,8 cm³; MCA H 101,3 ± 25,5 / M 78,5 ± 24,5 mm²), verde ≥ media−1DE, naranja
  ≥ media−2DE, rojo debajo, sin norma < 18 años, tabla en la tarjeta de la malla que **se oculta con la malla**.
- **Panorámica** (`src/core/panoramic.js`, disposición «Panorámica»): `archCurve` saca la curva del arco de la
  superficie dental ya detectada para alinear (`state.teeth.all`): columnas de 3 mm en X, mediana de Y por
  columna, suavizado, 10 mm extra por cada extremo (ramas) y remuestreo Catmull-Rom cada 0,4 mm. `buildPanoramic`
  suma (o toma el máximo, MIP) las muestras a lo largo de la NORMAL a la curva dentro del grosor elegido, con
  filas = Z (de −45 a +40 mm de la línea oclusal). La curva se dibuja sobre el corte axial (`silhouettes.extra`,
  que ahora se pinta aunque las siluetas estén apagadas). Brillo/contraste arrastrando sobre la imagen.
- **GUARDA DE GEOMETRÍA** (el fallo «cambios de dimensión»): con un CBCT real de 505×505×436 a 0,40 mm, el axial
  salía bien pero el coronal, el sagital y el 3D salían ESTIRADOS a lo alto ~2,7 veces. Causa: Cornerstone
  deduce la distancia entre cortes repartiendo el trayecto del PRIMER corte al ÚLTIMO entre el número de cortes,
  así que **basta UN corte en una posición disparatada** (un localizador, un corte de otro estudio, una posición
  mal escrita) para que ese promedio se dispare y TODO el volumen se estire, aunque los demás estén a 0,40 mm.
  Arreglo en dos partes: (a) `dicomLoad.js` calcula `dz` como la **MEDIANA** de los saltos entre cortes
  consecutivos (antes era solo |IPP1 − IPP0|, que también falla si el corte raro está al principio) y guarda
  `dzSpan` (el promedio extremo a extremo, que es lo que deduce Cornerstone), `dzMin`, `dzMax`, `dupes`, `gaps`
  y `dzOk` (la mediana es fiable si ≥ 60 % de los saltos coinciden con ella); (b) `viewer.enforceGeometry`
  compara el vóxel del volumen con el de las cabeceras y, si difiere > 2 %, corrige `imageData.setSpacing` y
  avisa en la barra de estado (`st_geo_fixed`). El espaciado DENTRO del corte (PixelSpacing) siempre se cree; el
  de ENTRE cortes solo se corrige si `dzOk`. Diagnóstico siempre en la consola (`tresD geometría: …`).
  Prueba: `tests/make_bad_geom.py` (copia de cbct_half con el último corte 180 mm fuera de sitio → 1,333 mm
  deducidos) + `node tests/geom.mjs`.

## 2m. v0.7.1 (13-09-2026) — pantalla inicial, mangos de la cruz, recorte del 3D, panorámica editable y ATM
- **Pantalla inicial**: fuera la línea de apoyo y la de privacidad (`layout.js`); quedan el logotipo, la
  llamada a subir el CBCT y el pie de propiedad. La privacidad sigue en el enlace del pie de página.
- **Mangos de la cruz**: `handleRadius` 2 (antes 3) y `referenceLinesCenterGapRadius` 26. Los CUADRADOS que
  se montaban sobre los círculos eran los del GROSOR DE CORTE (slab thickness), que este visor no ofrece:
  apagados (`getReferenceLineSlabThicknessControlsOn`). El círculo de giro lo coloca Cornerstone en el punto
  MEDIO del tramo visible de cada media línea, así que se separa del centro según dónde esté la cruz; no es
  configurable sin reescribir `renderAnnotation` del tool (se descartó). El modo `minimal` sí los deja
  simétricos pero DESACTIVA el giro (`viewportDraggableRotatable = !minimal.enabled`), así que no se usa.
- **Modelo cortado al hacer zoom** (alinear por puntos): eran los planos de recorte de la cámara del visor 3D.
  `viewer.fixClipRange()` recalcula cerca/lejos con los límites de lo VISIBLE (± 2 veces el radio de la escena)
  tras cada cambio de cámara Y tras cada pintado (`resetCamera` y el alta de actores de Cornerstone vuelven a
  estrecharlo por su cuenta; como `fixClipRange` no toca nada si ya está bien, converge en un fotograma y no se
  realimenta). Además `viewer.reset3D()` encuadra el visor 3D al entrar y salir de «Alinear por puntos».
- **Panorámica**: la curva pasa por 9 puntos de CONTROL (`panoramic.controlPoints` + `curveFrom`) que se
  arrastran sobre el corte axial con el botón «✎ Editar curva» (disposición `pair` = axial + panorámica,
  `movePanoControl`, deshacer/rehacer incluido) y «↺ Curva automática» los recalcula. MIP activado por
  defecto y grosor EN VIVO (evento `input`, con cola: si ya se está calculando se guarda la última petición).
  La panorámica tiene su PROPIA ventana, sacada de su histograma (`autoWindow`, percentiles 62/99,5): con MIP
  la ventana de los cortes MPR la dejaba toda blanca.
- **Cortes de ATM** (`src/core/tmj.js`, port de `_atm_build_series` / `_atm_slice` de VOXEL): un clic sobre
  cada cóndilo en cualquier corte MPR → `refineCondyle` hace lo que `derive_condyle_poles` de VOXEL pero
  partiendo de la semilla (hueso en 13 mm alrededor → 55 % superior → 70 % posterior, que quita la coronoides
  → 10 mm del ápice → PCA en el plano axial, limitada a 45° del eje X → polos medial y lateral). Con ese eje
  se sacan 5 SAGITALES perpendiculares (−6 a +6 mm), 1 CORONAL y 1 AXIAL por lado, remuestreados del volumen
  completo con interpolación trilineal (`samplePlane`; anterior a la izquierda, superior arriba). Mosaico en
  la disposición «ATM» (2 filas por lado: 5 sagitales + coronal/axial), brillo/contraste arrastrando, y
  deshacer/rehacer. VOXEL los deduce de la mandíbula ya segmentada; aquí no hay mandíbula aparte (con los
  dientes en oclusión, maxilar y mandíbula quedan CONECTADOS al umbral de hueso), de ahí el clic.

## 2n. v0.7.2 (13-09-2026) — bloque de cortes fuera de sitio, panorámica hasta los cóndilos y ATM a 1 mm
- **Bloque de cortes fuera de sitio** (fallo de Manuel: la parte alta del cráneo salía recortada y aparecía
  como un trozo suelto POR DEBAJO del resto, con un hueco negro en medio; el axial se veía bien). Causa: un
  bloque contiguo de cortes trae el `ImagePositionPatient` desplazado justo un recorrido entero, así que al
  ordenar por posición «da la vuelta» y se coloca al principio del volumen, arrastrando consigo el aire que
  había por encima de la cabeza (ese es el hueco). Ojo: las posiciones siguen siendo una escalera PERFECTA,
  no hay ningún salto raro que mirar en las cabeceras.
  - Quien delata el orden verdadero es el **número de instancia**: `dicomLoad.rotationByInstance()` marca la
    serie cuando, ordenada por posición, los números de instancia salen monótonos SALVO en un único punto y
    girando por ahí vuelven a serlo (repetidos, ausentes o desordenados de verdad → no se toca).
  - Eso es solo la sospecha. `viewer.repairRotation()` la **confirma con los píxeles** (4 cortes
    decodificados, miniatura 24×24): en una serie girada, los dos cortes de la costura no tienen nada que ver
    entre sí mientras que el último y el primero SÍ encajan; en una serie sana pasa al revés. Margen real
    medido: 0,167 frente a 0,008.
  - Reparación: se gira `series.files` y, como Cornerstone reordena por su cuenta, se registra un proveedor
    de metadatos propio (prioridad 20000) que devuelve el `imagePositionPatient` corregido de la cola
    (`installRotationProvider`; se quita en `removeVolume`, que si no se queda pegado al caso siguiente).
  - Pruebas: `tests/make_wrap_geom.py` genera `cbct_wrap/` (40 cortes girados) y `cbct_wrap_sinpista/` (lo
    mismo pero renumerando las instancias: indetectable, para ver el síntoma y comprobar que no se toca);
    `tests/wrap.mjs` comprueba que el volumen reparado coincide CORTE A CORTE con el de la serie sana.
- **Panorámica menos contrastada** (`autoWindow`): antes se recortaba en p62–p99,5 y el negro se comía el
  hueso (fondo negro del todo y dientes quemados). Ahora p42–p98,8 ensanchado un 15 %: el negro queda por
  debajo de las partes blandas y el blanco en el esmalte, dejando fuera los picos de metal.
- **Panorámica más alta y hasta los cóndilos**: `Z_BELOW/Z_ABOVE` 48/78 mm (antes 45/40) y la curva se
  prolonga 50 mm por cada extremo (antes 10). La tangente de la arcada en los últimos molares apunta hacia
  atrás Y hacia fuera, pero la rama sube casi recta hacia atrás: la dirección se mezcla 45 % tangente /
  55 % posterior y se limita la apertura lateral (|x| ≤ máximo de la arcada + 14 mm). Con el CBCT de prueba
  los extremos caen a 6-8 mm de los cóndilos. 11 puntos de control (antes 9) para retocarlo a mano.
- **ATM a 1 mm y con rueda**: los 5 sagitales pasan de 3 mm a 1 mm (`TMJ_SAG_OFFS = [-2…2]`) y la rueda del
  ratón desplaza esa FAMILIA de cortes de milímetro en milímetro (`viewer.scrollTmj`, tope ±12 mm; los
  cortes se recalculan al vuelo con `tmj.condyleSlice`, uno solo por corte). La rueda sobre el coronal o el
  axial mueve solo ese. El rótulo de cada corte lleva el desplazamiento.
- **Medidas sobre los cortes de ATM**: arrastrar sobre un corte = medir (distancia en mm, con color de
  `MEAS_COLORS` y deshacer/rehacer); se guardan por lado, familia y desplazamiento (`viewer.addTmjMeas`), así
  que al cambiar de corte aparecen las de ESE corte. Botón «⌫ Borrar medidas». El brillo/contraste pasa a
  **Mayús+arrastrar** (o botón derecho), porque el arrastre normal ya es la medida.
- **Rótulos de ATM en modo claro**: iban con `--overlay-text`, que en claro es oscuro, sobre pastilla oscura.
  Ahora son blancos siempre.
- **«Lateral D» / «Lateral I» → «Derecha» / «Izquierda»** en la barra de vistas (solo español).

## 2o. v0.7.3 (13-09-2026) — cruz, exportar mallas, tarjetas, siluetas, curva y encuadre de la ATM
- **Mangos de la cruz**: `handleRadius` 1,4 (2 en v0.7.1, 3 de fábrica) y `enableHDPIHandles: false` — de
  fábrica Cornerstone multiplica el radio por `devicePixelRatio`, así que en pantallas retina salían al doble.
- **Exportar mallas a STL**: `meshes.writeSTL(item)` (STL BINARIO, 84 + 50·nTri bytes) sobre `item.pts`, que
  ya lleva aplicados el giro, la alineación y los volteos: sale en el marco del paciente, tal y como se ve.
  `viewer.meshSTL(id)` → `{ name, buf }`; `main.exportMeshesDialog()` lista las mallas con casillas y baja un
  archivo por malla. Se abre con el botón ⭳ del panel derecho y con el BOTÓN DERECHO sobre ese panel. El
  nombre de archivo se pasa a ASCII (sin tildes): Windows y Chromium descartan el `download` con caracteres
  raros y el archivo acababa llamándose «download».
- **Tarjetas de malla**: fuera la línea `m-desc` (rol + nº de triángulos), que Manuel no usaba.
- **Siluetas apagadas temporalmente** (`contours.setSuppressed`, `viewer.suppressSilhouettes`): mientras se
  marcan los dos puntos de la vía aérea y mientras se edita la curva panorámica. Es un apagado aparte de la
  casilla del usuario (`state.silhouettes` no se toca) y los dibujos EXTRA (marcas SUP/INF, curva) siguen
  viéndose, porque en `Silhouettes.redraw` van antes del `return`.
- **Curva panorámica**: 13 puntos de control (11 en v0.7.2) y, al entrar en «Editar curva», el corte AXIAL
  salta a la altura de los dientes (`viewer.jumpAxialToZ(curve.z)`, desplazando cámara y foco por igual).
- **Encuadre de los cortes de ATM**: el ALTO es fijo (34 mm sagital/coronal, 36 axial) y el ANCHO sale de la
  PROPORCIÓN de la casilla del mosaico (`tmj.clampAspect`, entre 0,85 y 2,4), así que el corte llena la
  casilla y desaparecen las franjas negras de los lados (que se notaban porque el fondo del corte es gris y
  el de la casilla negro). `main.fitTmjAspect()` mide la casilla, FIJA `grid-auto-rows` a ancho/proporción
  y llama a `viewer.setTmjAspect`, que rehace los 7 cortes de cada lado; se llama al crear el panel, al
  cambiar a la disposición ATM y al cambiar el tamaño de la ventana (con retardo). Además el remuestreo es
  más fino: paso 0,14 mm (0,2 antes), que es lo que hacía que se vieran borrosos al ampliarlos.

## 3. TRAMPAS descubiertas (no volver a caer)
- **`enableHDPIHandles` de Cornerstone**: multiplica el radio de los mangos por `devicePixelRatio`; en un
  portátil retina se ven al doble de lo configurado.
- **Un `<a download="…">` con tildes**: Chromium (y Windows) pueden descartar el nombre y guardar el archivo
  como «download». Pasar el nombre a ASCII antes de descargar.
- **En una rejilla CSS con filas `1fr`, `aspect-ratio` no sirve**: para que una casilla tenga una proporción
  concreta hay que FIJAR `grid-auto-rows` en píxeles desde JS.
- **Un bloque de cortes puede venir GIRADO con las posiciones perfectas**: si el desplazamiento es justo un
  recorrido entero, la escalera de posiciones no tiene ningún salto raro. Solo lo delatan el número de
  instancia y los propios píxeles.
- **`metaData.addProvider` de Cornerstone se consulta por prioridad y el primero que NO devuelve `undefined`
  gana**: para corregir posiciones basta con un proveedor propio de prioridad alta que solo conozca los
  imageId afectados (nada de llamar a `metaData.get` dentro del proveedor: se realimenta).
- **`wadouri.fileManager.add` devuelve un imageId NUEVO cada vez** aunque sea el mismo fichero.
- **`CrosshairsTool` en modo `minimal` desactiva el giro**: `viewportDraggableRotatable = !minimal.enabled`.
- **Cornerstone vuelve a estrechar el rango de recorte de la cámara 3D** después de `resetCamera` y al añadir
  actores: hay que repasarlo también tras el pintado, no solo al cambiar la cámara.
- Un `setStatus` lanzado por una tarea ASÍNCRONA (la panorámica se recalcula al volver a su disposición)
  pisa el mensaje de la tarea que acaba de terminar: no restaurar la disposición anterior si se va a cambiar.
- **Cornerstone deduce la distancia entre cortes del PRIMERO al ÚLTIMO** (span / (n−1)), no corte a corte: un
  solo corte fuera de sitio estira TODO el volumen. Nunca fiarse de `volume.spacing` sin contrastarlo con la
  mediana de los saltos de las cabeceras (`enforceGeometry`, v0.7.0).
- **`setToolActive` de Cornerstone SUMA vinculaciones** a las que ya tenía la herramienta: para cambiar el botón
  izquierdo de herramienta hay que vaciar antes con `setToolPassive(nombre, { removeAllBindings: true })`; si no,
  dos herramientas se quedan con el botón primario y gana la que estaba (la cruz no respondía al arrastre).
- `buildGrid` (segment.js) devuelve un `vtkImageData` con espaciado `f` y su `toWorld` espera índices del volumen
  ORIGINAL: al recorrer el grid reducido hay que multiplicar por `f` (la vía aérea salía vacía por esto).
- **Cornerstone 5 no conoce los metadatos de un archivo local hasta que se le entrega su contenido**:
  hay que llamar `prefetchPart10Instance(imageId, arrayBuffer)` para TODOS los cortes ANTES de
  `createAndCacheVolume`; si no: "Cannot destructure property 'pixelRepresentation'".
- `dicom-parser`: Rows/Columns son **US binarios** → `ds.uint16()`, nunca `ds.string()` (devolvía "N").
- `imageId?frame=N` de wadouri es **1-based**.
- El `imageData` de Cornerstone **no lleva escalares** (`hasScalarVolume:false`): los vóxeles se leen
  con `volume.voxelManager.getAtIJK/getAtIndex`. No copiar el volumen entero (RAM).
- vtk.js `ImageResliceMapper` **no soporta planos de corte** y necesita escalares → los planos MPR del
  3D se hacen como textura sobre `vtkPlaneSource`.
- `dcmjs` arrastra `xmlbuilder2`, que pide módulos de Node (`events`, `url`): alias en
  `vite.config.js` (`events` → paquete `events`; `url`/`fs`/`path` → `src/shims/`). Sin esto la
  web moría al arrancar ("Class extends value undefined").
- Playwright: un `<input webkitdirectory>` se rellena con `setInputFiles(rutaDeCarpeta)`, no con la lista.
- En un `.bat`, un paréntesis dentro de un `echo` que está dentro de un bloque `if (...)` rompe el
  script sin mensaje (la ventana se cierra): usar `goto :etiqueta` en vez de bloques.
- El render 3D con SwiftShader (sin GPU) tarda >30 s por captura: en las pruebas, timeouts de 3 min.

## 4. Estado de las pruebas (tests/)
- `tests/make_dicom.py`: genera series sintéticas desde la muestra pública **DZ-CBCT.nrrd** (3D Slicer,
  donada sin restricciones; se descarga de la SampleData de 3D Slicer: https://github.com/Slicer/SlicerTestingData
  → `SHA256/…` de «DZ-CBCT», o desde slicer.kitware.com; guardar en `/tmp/testdata/DZ-CBCT.nrrd`): `cbct_half/` (217 cortes, 0,5 mm), `cbct_dicomdir/` (FileSet con DICOMDIR),
  `cbct_half.zip`, `cbct_half_rle/` (RLE), `cbct_half_j2k/` (JPEG 2000).
- `tests/smoke.mjs`: carga + vistas + disposiciones + presets + corte + 2 mediciones 3D encadenadas con
  arrastre de etiqueta + planos MPR + ángulo en axial + metadatos + tema claro + paneles replegados +
  letra grande + inglés → **0 errores de consola**. `tests/tune.mjs`: variantes de sombreado.
- `tests/loaders.mjs`: DICOMDIR, ZIP, RLE, JPEG 2000, sin signo (12 bits + intercepto) y `full` (0,25 mm →
  ruta de volumen grande) → todos cargan. `node tests/loaders.mjs <nombre>` ejecuta uno solo.
- `tests/make_real_scans.py` (también vuelca `dz_half/dz_full.raw+json` para Node) + `tests/align_node.mjs`
  (Node, ~15 s) + `tests/real.mjs` (navegador, ~5 min):
  alineación con dientes REALES (auto y por puntos), siluetas, colores de mediciones y trazado en vivo,
  dentición fina. Ver 2i.
- Manuel YA probó con un CBCT real (10-09-2026): carga y funciona en su PC. Pendiente: su opinión sobre
  el nuevo render. Si algún caso grande se atasca: `decimatedVolumeLoader` de Cornerstone o rebajar la
  resolución del render (como `RENDER_MAX_DIM=400` de VOXEL).

## 5. Ideas descartadas
- Trame (Python+VTK en servidor): reutilizaría VOXEL pero exige servidor de pago y subir DICOM.
- Pyodide: no hay VTK para navegador.
- Parsear/decodificar DICOM a mano en JS: los codecs (JPEG lossless / J2K) los resuelve
  `dicom-image-loader` con wasm; no reinventar.

## 6. Backlog (no hacer sin pedirlo)
- Crosshairs / líneas de referencia entre los MPR.
- Escáneres: giro manual fino, renombrar, exportar STL orientado/alineado.
- Segmentación: umbral/suavizado manual; dentición fina también en el resto de la mandíbula (hoy solo la
  caja de las coronas); decimación de la malla fina si pesa (> 1 M triángulos) en CBCT de 0,2 mm.
- Drapeado: fotos 3/4 (atlas multivista), recorte de nuca, umbral/suavizado manual de la segmentación.
- Posible logo propio "tresD DICOM" (ahora: marca tresD + texto "DICOM").
