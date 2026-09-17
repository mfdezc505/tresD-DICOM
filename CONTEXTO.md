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
  **PUBLICADA el 15-09-2026 (v0.7.8)**: hasta entonces el repositorio no existía en GitHub (el `.bat` fallaba
  sin que se notara); se creó a mano (público, sin README) y se activó Pages (main / docs). Desde ahora,
  `SUBIR_GITHUB.bat` publica de verdad: cada versión entregada queda en la web al minuto.
- **Dominio propio `https://tresddicom.com`** (v0.7.9, 15-09-2026): comprado en Hostingenius (12 €/año,
  renovación 18 €). El DNS vive en el Plesk del hosting de `ortodonciatresd.com` (alias de dominio
  `tresddicom.com` con zona DNS PROPIA, sin correo ni web): 4 registros A a las IP de GitHub Pages
  (185.199.108-111.153) y `www` CNAME → `mfdezc505.github.io`. El fichero `public/CNAME` (→ `docs/CNAME`)
  dice `tresddicom.com`; si se borra, GitHub Pages pierde el dominio. En GitHub → Settings → Pages →
  Custom domain = `tresddicom.com` + «Enforce HTTPS». La dirección `mfdezc505.github.io/tresD-DICOM/`
  redirige a la nueva. `OWNER.site` (aviso legal) apunta ya al dominio propio.
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
- GoatCounter (`https://tresddicom.goatcounter.com/count`, constante `COUNTER` en main.js; cuenta creada por Manuel el 15-09-2026 con el código `tresddicom`, sin guion, v0.7.10): gratis, sin
  cookies, sin datos personales → sin banner RGPD. Se inyecta `gc.zgo.at/count.js` salvo en localhost/file:.
  Eventos anónimos: `evento-cbct` (CBCT cargado) y `evento-escaner`. Manuel debe crear la cuenta en
  goatcounter.com con el código EXACTO de la constante (si cambia el código, cambiar la constante).
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
- **`vtkPoints.modified()` NO invalida los límites cacheados**: tras cambiar `pts` en el sitio hay que llamar a
  `getPoints().dataChange()`; si no, `getBounds()` devuelve la caja vieja y todo lo que dependa de ella (planos de
  recorte, encuadres) falla de forma silenciosa (v0.8.2, modelo cortado al alinear por puntos).
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

## 2p. v0.7.4 (13-09-2026) — cruz adaptativa, ATM (medidas, corte ampliado, polos a mano) y panel limpio
- **Cruz**: los CUADRADOS ya estaban apagados desde v0.7.1 (`getReferenceLineSlabThicknessControlsOn`), y se
  ha comprobado con `tests/_dbg_cross2.mjs` que no se dibuja ni uno (0 `<rect>` con el ratón encima de una
  línea). Lo que faltaba era el TAMAÑO: Cornerstone dibuja los mangos y el hueco central en PÍXELES FIJOS, así
  que en «3D + cortes» o «en fila» salían enormes. `viewer.tuneCrosshairs()` los recalcula con el lado menor
  de los cortes MPR visibles (radio entre 0,8 y 1,6 px; hueco entre 8 y 26 px) y se llama desde `resize()` y
  desde `applyMprBindings()`.
- **Medidas de ATM**: arrastrando se repintaba el mosaico ENTERO en cada movimiento del ratón (14 cortes,
  `putImageData` en cada uno): iba a tirones y parecía que no funcionaba. Ahora `redrawTmj(cell)` repinta solo
  el corte que se está midiendo.
- **Corte de ATM ampliado**: botón ⤢ de cada casilla (o doble clic) → modal grande (`openAtmBig`) donde se
  mide igual, la rueda cambia de corte y las medidas son LAS MISMAS que las del mosaico (mismo almacén, por
  lado/familia/desplazamiento).
- **Polos del cóndilo a mano** (`openPolesDialog`, botón «⌖ Ajustar polos»): corte AXIAL a la altura de cada
  cóndilo (`viewer.condyleAxialView`) con los dos polos arrastrables; al aplicar, `viewer.setCondylePoles`
  rehace el marco con `tmj.polesFrom` y vuelve a sacar los 7 cortes de ese lado (con deshacer/rehacer).
  Para esto `samplePlane` devuelve ahora también el MARCO del plano (`o`, `ex`, `ey`), y `tmj.planeToWorld` /
  `worldToPlane` convierten píxel ↔ mundo.
- **Panel izquierdo**: fuera todos los textos explicativos de los pasos; quedan los títulos y los botones.
- **Doble clic / ⤢ con un visor a pantalla completa**: vuelve al 2×2 (antes, si el visor ya estaba solo por la
  barra de vistas, no hacía nada porque `maximized` estaba a null).

## 2q. v0.7.5 (13-09-2026) — piel sin aire interno, medidas con Mayús, panorámica y marca de agua
- **Edad del paciente** junto a la fecha de nacimiento, detrás del sexo (`patientAge` ya existía para la
  norma de la vía aérea; ahora también va al chip de la barra).
- **Piel sin vía aérea ni senos** (`segment.bodyField`, port de `segment_soft` de VOXEL): el contorno directo
  al umbral de piel captaba TAMBIÉN el aire interno y salía como nubes al ver el blando translúcido. Ahora se
  procesa la MÁSCARA: cierre morfológico de 4 mm (sella narinas, coanas y boca) → del aire se conserva solo el
  EXTERIOR → mayor componente sólido → gaussiano de 1 vóxel → marching cubes a 0,5.
  «Exterior» aquí es más estricto que en VOXEL: componentes de aire que TOCAN EL BORDE del volumen **y** que
  llegan al 55 % del mayor de ellos (así la faringe, que sale por el borde de abajo pero es mucho menor, se
  rellena). Con encuadres muy ajustados hay dos redes de seguridad: si el sólido pasa del 90 % se rellenan
  solo los huecos cerrados, y si pasa del 95 % se deja la máscara como estaba. El morfológico va con máximo /
  mínimo deslizante 1D en O(n) por eje (van Herk); etiquetado 6-conexo con cola propia. Resultado en el CBCT
  de prueba: la malla de piel baja de 498.130 a 148.638 triángulos (todo lo que sobraba era interior).
- **Panorámica**: grosor por defecto 22 mm (deslizador hasta 40) y, al entrar en «Editar curva», el axial
  salta a la altura de los dientes DESPUÉS de cambiar de disposición (antes el cambio de tamaño del visor
  deshacía el salto y había que buscar los dientes a mano).
- **Medidas sobre cortes** (ATM y panorámica), v0.7.5:
  · se mide con **MAYÚSCULAS + arrastrar** (el arrastre normal vuelve a ser brillo/contraste) y el cursor de
    cruz solo aparece con Mayús pulsado (`body.measuring-shift`);
  · la ETIQUETA del valor se arrastra (se guarda su desplazamiento en `m.lab`) y lleva una guía fina hasta la
    medida cuando se separa;
  · el tamaño de la etiqueta es FIJO EN PANTALLA: se divide por la escala del canvas (`canvasScale`), porque
    antes se escalaba con la imagen y en el corte ampliado salían enormes y solapadas;
  · la panorámica tiene sus propias medidas (`viewer.getPanoMeas` / `addPanoMeas`), que se conservan al
    cambiar el grosor o el MIP, con su botón de borrar y deshacer/rehacer.
- **Polos del cóndilo**: `tmj.polesFrom` intercambia los polos si hace falta para que MEDIAL sea siempre el
  más cercano a la línea media (los rótulos salían cambiados en el lado derecho), y en el diálogo la RUEDA
  del ratón sube y baja el corte axial ±20 mm (`condyleAxialView(side, half, step, dz)`), con el
  desplazamiento escrito al lado del lado.
- **Marcar los cóndilos**: se amplía el corte CORONAL a la altura estimada de las ATM (`viewer.condyleGuess`,
  que usa los extremos de la curva panorámica si ya está calculada y, si no, una proporción de la caja del
  volumen) y se apagan las siluetas de las mallas. El aviso con «deshacer / cancelar» tiene ahora su propia
  barra en el coronal (`#atm-bar`), porque la de la vía aérea vive dentro del visor sagital.
- **Marca de agua**: `viewer.screenshot(ids, img)` pinta el logotipo compacto abajo a la derecha al 55 % de
  opacidad y al 16 % del ancho.

## 2r. v0.7.6 (14-09-2026) — rótulos nítidos, el coronal sí salta a los cóndilos y polos con línea media real
- **Rótulos y medidas NÍTIDOS sobre los cortes** (`tmj.paintGray`, usado por `drawSlice` y por
  `drawPanoramic`): el canvas se pintaba con exactamente los píxeles del corte (p. ej. 216×243) y la pantalla
  lo ampliaba ×3 en el modal, así que un rótulo de «11 px de pantalla» se dibujaba con 3,7 px de canvas y
  salía borroso. Ahora se pinta con un factor de RESOLUCIÓN (`main.drawZoom` = escala en pantalla ×
  devicePixelRatio, entre 1 y 6), se guarda en `canvas._imgZoom` y quien dibuja encima multiplica sus
  coordenadas por él (`drawMeasures`, `measAtLabel`, el diálogo de polos) mientras que grosores y tipografía
  siguen en píxeles de PANTALLA. `atmPos` divide por el factor, así que las medidas se siguen guardando en
  píxeles del corte y no hay que tocar las ya hechas. La imagen se amplía con `drawImage` suavizado.
- **El salto de corte se repite hasta que cuaja** (`viewer.jumpViewportSticky`): al cambiar de disposición,
  Cornerstone recoloca la cámara en el CENTRO del volumen después de repartir el espacio, y se comía el
  salto. Con dos `requestAnimationFrame` (v0.7.5) seguía llegando tarde: medido, el coronal se quedaba en
  y = −55,8 (centro) en vez de y = −21,3 (cóndilos). Ahora se reintenta cada fotograma hasta que el valor
  aguanta 3 seguidos o pasan 900 ms. Se usa también al entrar en «Editar curva» (axial a la altura dental).
- **Línea media REAL para medial/lateral** (`tmj.polesFrom(..., midX)` y `refineCondyle(..., midX)`): se
  suponía que la línea media era x = 0, pero muchos CBCT llevan el origen en una esquina y el volumen entero
  cae en x > 0; entonces comparar |x| intercambiaba los polos del lado DERECHO (el izquierdo salía bien).
  `buildTmj` calcula `midX` como el punto medio entre los dos cóndilos marcados (o el centro del volumen si
  solo hay uno) y lo guarda en `state.tmj.midX` para cuando se ajustan a mano.

## 2s. v0.7.7 (15-09-2026) — captura en panorámica y ATM, doble clic para ampliar y curva apagada
- **Captura** (`main.shotPng` / `main.shotDom`): el botón solo sabía componer visores de CORNERSTONE
  (`viewer.screenshot`), y con la panorámica o el mosaico de ATM en pantalla no hay ninguno visible, así que
  devolvía null y el botón no hacía NADA. Ahora, si se ve el mosaico de ATM o la panorámica, la captura se
  compone a partir de sus canvas: cada uno en el sitio y el tamaño en que se ve (`object-fit: contain`
  resuelto a mano), más los rótulos de las casillas (pastilla oscura) y los de lado, que van en HTML y en
  VERTICAL. La marca de agua se comparte con la captura normal (`viewer.stampWatermark`).
- **Doble clic sobre un corte de ATM = ampliarlo**: había un `dblclick` en la rejilla, pero no llegaba nunca.
  El `pointerdown` de la rejilla llama a `preventDefault()` para poder arrastrar el brillo sin seleccionar
  texto, y cancelar `pointerdown` suprime los eventos de ratón de compatibilidad (mousedown/mouseup/click y,
  por tanto, dblclick). Se detecta a mano: dos pulsaciones en la misma casilla en menos de 450 ms.
- **Curva de la arcada apagada por defecto**: `state.showArch` arranca en false y la casilla «curva» sin
  marcar. Entrar en «Editar curva» la enciende (allí hace falta).

## 2t. v0.7.8 (15-09-2026) — curva apagada, marca de agua por tema, grosor en el axial, vía aérea, doble clic, axial de ATM
- **Curva de la arcada**: apagada por defecto; «Editar curva» la enciende y al salir se vuelve al estado que
  tenía la casilla antes (`archBeforeEdit` en `main.setPanoEdit`).
- **Marca de agua** = logotipo principal «DICOM viewer» (`logo_main_dark|light.png`) en la versión del TEMA
  activo (`main.watermark`): la de tema oscuro es clara y desaparecía en las capturas de fondo claro. Se
  precargan las dos.
- **Grosor de la panorámica sobre el axial** mientras se edita la curva: dos líneas finas a ±grosor/2 por la
  normal 2D a la curva (callback `extra` de las siluetas en `viewer.js`); siguen al deslizador.
- **BUG vía aérea** (desde v0.7.5): `awRestore` ocultaba `#atm-bar` en vez de `#aw-bar` (error de copia al
  crear la barra de ATM), así que el aviso «VÍA AÉREA 2/2…» se quedaba puesto después de segmentar y
  «Cancelar» no hacía nada (ya no había `airwayPick`). Arreglado; además `cancelAirway` oculta la barra
  aunque no haya marcado en curso.
- **Doble clic sobre la panorámica → 2×2** (cierra la edición si estaba abierta). No hacía falta detectar
  el doble clic a mano: el `pointerdown` de la panorámica no cancela el evento salvo al medir.
- **Axial de ATM a la altura de la CABEZA** (`tmj.bestAxialOffset`): el centro de los polos cae en lo alto
  de la cabeza, y ahí el axial sale con la cabeza pegada a la fosa y al temporal (no se distingue el
  cóndilo; en el DZ pasa igual). Se busca de +1 a −15 mm el nivel en que el hueso central es una MANCHA
  AISLADA (componente 4-conexo que no toca el borde de la ventana de 36 mm, centroide a < 7 mm) y más
  grande, midiendo la CAJA del componente (la cabeza es un anillo cortical con el interior esponjoso por
  debajo del umbral; por área ganaba el cuello, macizo). En el DZ: derecha −4 mm, izquierda −9 mm. El
  desplazamiento va en `pole.axiBase`; el rótulo y la rueda cuentan desde ahí (`it.base`), y se recalcula
  al ajustar los polos a mano. `tests/_dbg_axi.mjs` vuelca la pila de axiales para verlo a ojo.

## 2u. v0.7.11 (15-09-2026) — valoración del software (estrellas + comentario) → Google Form
- `src/ui/feedback.js`: ventana con 5 estrellas y comentario opcional. Se envía por `fetch` `no-cors` a
  `FORM_URL` (Google Form de Manuel, id `1FAIpQLSdY7E8mRQufhXrfffJW4c2STN-wKmuXapj8yVS2C5TPDCJxZg`):
  `entry.1125802240` = estrellas, `entry.1984945003` = comentario. Las respuestas le llegan por correo
  (aviso activado en el formulario) y a una hoja de cálculo. Si Manuel rehace el formulario, cambian los
  `entry.*`: se sacan de `FB_PUBLIC_LOAD_DATA_` en la página del formulario (ver `tests/v0711.mjs`).
- Cuándo: NO «al cerrar la pestaña» (imposible en navegadores). Sale sola UNA vez, 5 min después de cargar
  un caso (`scheduleFeedback` desde `openSeries`), salvo que haya otra ventana abierta o el usuario esté
  marcando puntos (`fbBusy`), en cuyo caso reintenta al minuto. «Ahora no» → 30 días. Enviada → nunca más.
  Estado en localStorage `tresd_dicom_feedback` (`done` | `later:<ms>`). Botón fijo «★ Valorar» en el pie.
  `window.__tresdFbDelay` acorta la espera SOLO en las pruebas.
- Privacidad: punto 5 nuevo («Valoración voluntaria», Google Forms, consentimiento art. 6.1.a, sin datos
  personales); los siguientes se renumeran. TERMS_VERSION no cambia (no se piden nuevas aceptaciones).

## 2v. v0.7.12 (15-09-2026) — 2×2 tras segmentar/foto, «Dibujar curva», letra pequeña, Cruz desactivada
- **Tras segmentar o drapear la foto** se vuelve al 2×2 (`applyLayout('quad')` al final de
  `runSegmentation` y `finishDrape`).
- **«✏ Dibujar curva»** (botón en la barra de la panorámica): modo `panDraw` en `main.js`, calcado del
  marcado de la vía aérea: solo el axial (a la altura de los dientes si ya hay curva), barra `#pd-bar`
  dentro del visor axial (texto con el número de puntos, Deshacer, Terminar, Cancelar), clics sin arrastre
  → `pickOnMpr`. Los puntos se pintan con un `extra` de las siluetas (`state.panDraw`). Al terminar:
  si el primer punto está más a la IZQUIERDA del paciente que el último se invierte el orden (la
  panorámica va de derecha a izquierda), z = media de los puntos, `viewer.curveFromPoints` → `buildPano({
  curve })` (opción nueva: usa esa curva en vez de detectarla) y se registra en deshacer. Mínimo 3 puntos;
  Esc / cambiar de disposición / otro modo cancelan.
- **Letra**: por defecto «Pequeña» (0,88) y opción nueva «Muy pequeña» (0,78). Quien ya tuviera un tamaño
  guardado lo conserva.
- **Botón Cruz** desactivado (`disabled`) en Render 3D, Panorámica (y edición) y ATM: `applyLayout`.
- Punto 5 de la petición (quitar «cuadrados de traslación» de la cruz) quedó pendiente de captura: en las
  pruebas no había cuadrados. Resuelto en v0.7.13 → ver §2w.
- `fitTmjAspect` reintenta unos fotogramas si la casilla mide 0 (recién cambiada la disposición). Y en las
  pruebas, con mallas segmentadas el `resize` del render 3D tarda > 1 s en SwiftShader: `tests/v073.mjs`
  espera a que cambie `gridAutoRows` en vez de un tiempo fijo.

## 2w. v0.7.13 (15-09-2026) — Cruz sin cuadrados en pantallas táctiles, sin recuadro duplicado de importar
- **Cruz**: la captura de Manuel mostraba círculos GRANDES y CUADRADOS en cada línea, siempre a la vista.
  Causa: `CrosshairsTool` enciende solo su modo «móvil» (`mobile.enabled = isMobile()`) cuando el navegador
  cumple `matchMedia('(any-pointer:coarse)')`, es decir, cuando el equipo tiene una pantalla táctil (o un
  puntero grueso cualquiera), aunque se use con ratón. En ese modo IGNORA `handleRadius` y
  `getReferenceLineSlabThicknessControlsOn`: círculos de radio 9, cuadrados de grosor de corte y todo pintado
  sin esperar al ratón. En las pruebas (SwiftShader, sin táctil) nunca salía; se reproduce en Playwright con
  `hasTouch: true`. Arreglo en `viewer.js`: `mobile: { enabled: false }` en la configuración de la cruz
  (BaseTool hace `deepMerge`, así que basta con esa clave). De paso, círculos de giro algo más visibles que
  los 1,4 px de antes (`handleRadius` 3,5; `tuneCrosshairs`: `clamp(minDim/130, 2,5, 4)`), que Manuel nunca
  había visto porque su PC iba en modo móvil. El agarre no depende del radio (proximidad fija de 6 px).
- **Recuadro «Arrastra aquí tu CBCT» del panel izquierdo** (`#side-drop`) eliminado: repetía el central.
  Quitados el HTML (`layout.js`), su `hidden` en `setHasCase`, sus oyentes de arrastre y clic (`wireUI`), la
  clave `drop_small` (es/en) y la regla `#side .drop`. Sigue funcionando el arrastre sobre el recuadro
  central y sobre toda la ventana.
- Prueba: `tests/v0713.mjs` (con `hasTouch: true`): sin cuadrados, 0 mangos sin ratón encima, 2 círculos de
  2,5–4 px al pasar por la línea, sin `#side-drop`. OJO: en SwiftShader la cruz tarda varios segundos en
  pintarse tras el clic; esperar a que haya `line` en `#svg-layer-vpAx` antes de contar (un tiempo fijo
  daba 0 líneas).

## 2x. v0.7.14 (15-09-2026) — Valorar en la cabecera, render radiográfico al alinear, ATM sin Mayús, pestañas
- **«★ Valorar»** pasa del pie (enlace pequeño) a la cabecera, entre «Rotación» y «Aa», como botón normal
  (`#btn-feedback`, `layout.js`).
- **Alinear por puntos**: al pasar a la fase del CBCT (`paPhaseDst`) se pone el preset «radiográfico cálido»
  (`radio`) para ver los dientes; `startPointAlign` guarda `prev.render = { ...state.render }` y `paRestore`
  (terminar, cancelar, Esc) lo devuelve entero (preset + ventana + opacidad) con `applyRender` +
  `syncRenderControls`.
- **ATM sin Mayús** (en tabletas no hay teclado): en el MOSAICO arrastrar = brillo/contraste (y mover
  etiquetas); NO se mide ni con Mayús. Se mide en el corte AMPLIADO con dos botones: «📏 Distancia»
  (arrastrar) y «📐 Ángulo» (tres toques: extremo, vértice, extremo; Esc cancela a medias). Sin botón,
  arrastrar en el ampliado = brillo/contraste. `atmBig.tool` (`null | 'len' | 'ang'`), `setAtmBigTool`,
  `atmBigHint`. Medida angular = `{ type: 'ang', a, v, b, color, lab }`; `measAngle`, `measText` («12,3 mm» /
  «34,5°»); `measLabelPos(m, gap)` coloca la etiqueta del ángulo dentro, por la bisectriz; `drawMeasures`
  pinta también el arco del vértice y admite `noLabel` (vista previa del primer tramo). `addAtmMeas(side, it,
  m)` ya no recibe la longitud. La panorámica sigue midiendo con Mayús + arrastrar (`measuring-shift`).
- **Tamaño de las medidas en el mosaico**: `gridMeasScale(cv)` = `clamp(minDim/420, 0,7, 1)` (casillas de
  ~150–300 px → 70 %); `drawMeasures(cv, list, mm, f)` y `measAtLabel(list, cv, p, f)` reciben el factor.
- **Foto frontal → marcado manual «sin motivo»** (captura de Manuel): la cara se reconoce sobre un render
  FRONTAL del visor 3D; si estaba oculto (vista de ATM, panorámica o un corte a solas) el render salía vacío
  y saltaba el manual. Ahora `ingestPhoto` hace `applyLayout('quad')` si `!vpShown('vp3d')` antes de
  detectar; `detectFace(img, conf)` aplica de verdad la confianza (antes solo al crear la instancia) y hay un
  segundo intento con 0,3 en la foto y en la piel 3D; la ventana de puntos muestra el MOTIVO en un
  `.hint.warn` (`manualRegistration(img, lm2, why)`). El manual sigue saliendo cuando el CBCT no incluye ojos
  o frente (piel sin cara reconocible): eso es lo esperado.
- **BUG GRAVE arreglado de paso en la ventana de puntos de la foto**: `.modal` es un flex en columna con
  `align-items: stretch`, así que el `<canvas>` de la foto se ESTIRABA al ancho de la ventana (que crecía con
  el texto de la pista hasta 92vw): la foto salía deformada y enorme (la captura de Manuel) y, peor, `pos()`
  mapeaba los clics suponiendo el tamaño intrínseco → los puntos marcados a mano caían en otro sitio y el
  registro manual salía disparatado (`tests/photo.mjs`: 253 px de error; ahora 0,7 px). Arreglo: el canvas
  lleva `style="width:cw;height:ch;align-self:center"`, la ventana `width: max(520, cw + 36)` y `pos()`
  corrige con el `getBoundingClientRect()` por si acaso.
- **Pestañas de los paneles** (`wirePanelTabs`): en los paneles replegados (`.sidewrap.auto`) hay una pestaña
  `.hot .tab` siempre visible en el borde, a media altura, con la flecha; un toque alterna la clase `open`
  (el panel se queda desplegado), tocar fuera lo repliega (oyente `pointerdown` en `document`, en captura),
  arrastrarla ≥ 30 px hacia dentro lo despliega y ≥ 12 px hacia el borde lo repliega (la pestaña mide 18 px:
  hacia el borde no hay más recorrido). El `:hover` del ratón sigue funcionando. `.hot` lleva
  `pointer-events: none` (solo la pestaña recibe eventos) y `z-index` por encima del panel. `applyPanels`
  quita `open`.
- Pruebas: `tests/v0714.mjs` (1, 3, 4, 6; con `hasTouch: true`), `tests/real.mjs` (2: preset `radio` en la
  fase 2 y `ivory` al terminar / cancelar) y `tests/photo.mjs` (5: con el 3D oculto vuelve al 2×2 y la ventana
  explica el motivo). `v072/v074/v075/v076` adaptadas: miden en el ampliado con `#ab-len`; `v074` acepta los
  círculos de 2,5–4 px de v0.7.13; `photo.mjs` vuelve al «Render 3D» antes del paso manual (desde v0.7.12 el
  drapeado deja el 2×2) y `real.mjs` espera a que los canvas de siluetas tengan tamaño (SwiftShader tarda).
  Pasadas en esta versión: v0714, smoke, v072, v074, v075, v076, v0711, v0712, v0713, photo, real, features.

## 2y. v0.7.15 (15-09-2026) — Captura 2×2, chip del paciente (ocultar / editar), polos fuera de los MPR, 3 clics, pestaña, render al alinear, «Terminar de editar»
- **Captura en 2×2** (captura de Manuel: cortes diminutos en una esquina): `viewer.screenshot` pegaba cada
  canvas de Cornerstone a su tamaño INTERNO en una rejilla de celdas iguales, y el canvas del render 3D no
  tiene el mismo tamaño interno que los de los cortes. Ahora `shotPng` compone SIEMPRE por lo que se ve
  (`shotDom($('#grid'))`: cada canvas en su sitio y tamaño en pantalla, siluetas incluidas). `viewer.screenshot`
  queda sin uso desde la interfaz.
- **Chip del paciente**: `renderChip()` + `chipHidden`; un clic lo oculta («Datos del paciente ocultos (clic
  para mostrar)», clase `masked`) y otro lo muestra. Botón **✎** (`#btn-patient-edit`) → `editPatientDialog()`
  (`.modal.patient`: nombre, sexo M/F/O, nacimiento con `<input type="date">`); guarda en `current.patient /
  sex / birth` (AAAAMMDD) SOLO en la sesión: chip, edad (vía aérea pediátrica), lista de series y resumen de
  metadatos (`updateSummaryPatient`). El DICOM no se toca (y se dice en la ventana).
- **Polos del cóndilo**: ya no se pintan en los cortes MPR (salían en el coronal); solo en «Ajustar polos».
  Las marcas D/I mientras se señalan los cóndilos siguen.
- **Registro manual de la foto con 3 CLICS**: `GUIDED_POINTS` = nariz (1), comisura derecha (61), comisura
  izquierda (291); el diálogo exige los 3 (sin «Omitir»). `solvePose` admite n = 3 solo con focal fija
  (`opts.f`, P3P): `drapePhoto` fija `f = 1,2·W` cuando hay < 5 puntos. La caja de la cara a pintar sin
  detección en la foto sale de los 3 puntos por proporciones (`faceBoxFrom3`: ±1,6 bocas de ancho, 2,2 arriba,
  1,3 abajo). Con detección en la foto (`lm2`) se sigue usando su caja y los 3 puntos vienen prellenados.
- **Pestaña de los paneles**: se esconde con el panel desplegado por toque (`.open`) y, con el ratón dentro del
  panel, salvo mientras el ratón está sobre la propia pestaña (`.tab:not(:hover)`; si no, no se podía pulsar).
  Mientras se arrastra (`.dragging`) se ve siempre. Se repliega tocando fuera o con el pin.
- **Alinear por puntos**: `applyLayout('vp3d')` al empezar (render a pantalla completa) y vuelta a la
  disposición previa (`prev.layout`) en `paRestore` (terminar, cancelar, Esc).
- **Editar curva**: barra `#pe-bar` sobre el AXIAL con «↺ Curva automática» y «✔ Terminar de editar»
  (`setPanoEdit` la muestra/oculta). La barra de la panorámica pasa a `flex-wrap: wrap` (min-height 40):
  con los dos paneles anclados y dos visores se cortaban los botones del final. `#pan-edit` sigue existiendo.
- **Caché del navegador** (Manuel: al abrir `ABRIR_tresD_DICOM.bat` salía la versión anterior): los assets
  tienen nombre FIJO (`assets/index.js`) y el navegador reutilizaba el viejo. `npm run build` ahora ejecuta
  también `scripts/version_stamp.mjs`, que añade `?v=VERSION` a los assets de `docs/index.html`: al cambiar de
  versión el navegador (y la CDN de GitHub Pages) piden el archivo nuevo. Vale también para el «aparece
  todavía la 0.7.9» de las publicaciones.
- Pruebas: `tests/v0715.mjs` (1, 2, 3, 7, 8), `v0714` (5: pestaña oculta con el panel abierto), `real.mjs`
  (6: pantalla completa al alinear y vuelta al 2×2 al cancelar), `photo.mjs` (4: 3 puntos).

## 2z. v0.7.16 (16-09-2026) — Flechas de deshacer, «Nuevo caso», distancia ATM con 2 toques, sin V·N en panorámica, ventana de Ayuda
- **↶ ↷** sin texto (`btn-icon`); el tooltip conserva «Deshacer (Ctrl+Z)». Sitio para el chip del paciente.
- **«✚ Nuevo caso»** (`#btn-new`, cabecera, solo con caso): `newCaseDialog()` pide confirmación y hace
  `location.reload()`: es la forma más limpia de vaciar Cornerstone, vtk, mallas, ATM, panorámica, vía aérea e
  historial y liberar la memoria gráfica. Los ajustes (tema, letra, idioma, paneles, términos aceptados) viven
  en localStorage y se conservan.
- **ATM, distancia con DOS TOQUES** en el corte ampliado: `pointerdown` en modo `len` crea `drag.mode = 'tap'`
  (con `a`); si antes de soltar se mueve > 8 px pasa a `'new'` (arrastre clásico, sigue valiendo); si se
  suelta sin mover, `atmBig.pts` recoge el punto y el segundo toque crea la medida (vista previa en vivo con el
  valor siguiendo al puntero; Esc cancela). Pistas `ab_hint_len` / `ab_hint_len2`.
- **Panorámica**: quitada la etiqueta de esquina «V · N · grosor · MIP» (`#pan-info`): se solapaba con la barra
  (ya con dos filas) al editar la curva.
- **Ayuda**: `src/ui/help.js` → `openHelp()`: ventana `.modal.help` con la estética del visor (cabecera, pista,
  cuerpo desplazable con 10 secciones en tarjetas y la nota `about` con versión y motores). El contenido está en
  `i18n` como `help_sections` (array de `{ t, items: [[negrita, texto]…] }`, ES y EN); `t()` devuelve el array
  tal cual. `help_text` (el antiguo alert) eliminado.
- Prueba: `tests/v0716.mjs` (todo lo anterior; comprueba que no salta ningún `dialog` del navegador y que tras
  «Nuevo caso» la página vuelve a la pantalla de importar con los ajustes intactos).

## 2aa. v0.7.17 (16-09-2026) — Panorámica por toques, polos en la sección más ancha, sagitales derechos espejados, marca de agua opaca
- **Panorámica sin Mayús**: botones «📏 Distancia» / «📐 Ángulo» (`#pan-len`, `#pan-ang`) en la barra;
  `panTool`, `panPts`, `panCur`, `setPanTool`, `addPanMeas`. Misma mecánica que el ATM ampliado: toques (2 / 3),
  arrastre también vale para la distancia, Esc cancela, vista previa en vivo, etiquetas arrastrables. Sin
  botón, arrastrar = brillo/contraste. `setShift` / `measuring-shift` eliminados (Mayús ya no hace nada).
  `#pan-clear` solo se ve con medidas (`drawPan`).
- **Grupo 3**: «Subir foto frontal» antes de «Segmentar hueso y piel».
- **Ayuda**: sección 11 «Requisitos mínimos del dispositivo» (navegador, ordenador, tabletas, archivos,
  conexión) en ES y EN.
- **Polos del cóndilo** (captura de Manuel: polos fuera del hueso): `refineCondyle` calculaba los extremos de
  la parte ALTA de la cabeza (vóxeles a < 10 mm del ápice), estrecha, y al proyectarlos a otra altura caían
  fuera. Ahora `polesAtWidest(smp, pole, thr, midX)`: nivel de `bestAxialOffset` (sección aislada más
  grande), píxeles del componente (`isolatedBlob(..., true)`), PCA 2D limitada a 45° y extremos del contorno
  (media de los 3 píxeles más extremos, puestos SOBRE la recta del eje) → `polesFrom`. Se acepta solo si es
  COHERENTE con la estimación clásica (anchura ≥ 85 % y eje a < 50°; la parte alta va pegada a la fosa y su eje
  sale sesgado, por eso la tolerancia es amplia); si no (muestra DZ, lado derecho: mancha de 8,6 mm frente a
  17,2) se conservan los polos clásicos. Con la sección aceptada el centro queda en ella, el diálogo «Ajustar
  polos» abre justo ahí y `axiBase` ≈ 0 (`v078` admite las dos situaciones).
- **Sagitales del lado derecho espejados**: `pole.side` ('R' | 'L', puesto en `buildTmj` y conservado en
  `setCondylePoles`); `condyleSlice` usa `ux = [0, -1, 0]` para R (anterior a la DERECHA de la imagen) y
  `[0, 1, 0]` para L. Cada cóndilo se ve desde su propio lado, como pidió Manuel.
- **Marca de agua** opaca con sombra (`stampWatermark`): al 55 % la imagen se veía a través y parecía que
  el corte quedaba por delante.
- Pruebas: `tests/v0717.mjs` (todo lo anterior; en la muestra DZ el cóndilo derecho es pequeño y solo se
  exige ≥ 6 mm de anchura); `v075` adaptada (mide en la panorámica con `#pan-len`; sin comprobaciones de
  Mayús).

## 2ab. v0.7.18 (16-09-2026) — «Ajustar polos» automático y captura del corte de ATM ampliado
- Manuel probó los polos de v0.7.17 y siguen «cerca pero no en su sitio»: se le explicó que es el tope de
  adivinar con un clic y un umbral (sin segmentación ni datos reales para afinar). Decisión suya: nada más
  marcar los dos cóndilos se abre solo **«Ajustar polos»** (`tmjPicked` → `openPolesDialog()` con 350 ms de
  margen; `window.tresd.noAutoPoles` lo desactiva para pruebas). La pista del diálogo dice ahora «Propuesta
  automática… Cancelar deja la propuesta».
- **Captura del corte de ATM ampliado**: botón «📷 Captura» (`#ab-shot`) en la cabecera del modal →
  `shotAtmBig()`: vuelve a pintar el corte a ≥ 1400 px de ancho (`drawTmjSlice` con zoom), pinta las medidas
  con `drawMeasures(out, list, step, out.width / 700)`, el rótulo «Derecha · Sagital centro» y la marca de
  agua; se descarga `tresD_DICOM_ATM_<lado>_<corte>_<fecha>.png`.
- Pruebas: `tests/v0718.mjs` (marca por la interfaz → diálogo abierto; Cancelar conserva la propuesta;
  captura con la medida y el logotipo, comprobando los píxeles) y `v071` adaptada (cierra el diálogo).

## 2ac. v0.8.0 (16-09-2026) — INFORME imprimible (PDF) y SESIÓN .tresd
- Manuel pidió 10 ideas de mejora «sin hacer cambios» y eligió la 1 (informe) y la 2 (guardar / abrir sesión).
- **Informe** (`src/ui/report.js` + bloque INFORME de `main.js`): `openReportDialog()` (modal `.modal.report`
  con casillas `#rp-pat/#rp-3d/#rp-mpr/#rp-pano/#rp-atm/#rp-meas`, deshabilitadas si no hay esa vista, y
  `#rp-notes`) → `generateReport(opts)`: pasa al 2×2 el tiempo justo (`settle(900)`), captura cada visor con
  `shotDomAsync(vp, false)` (compone canvas + **capas SVG de Cornerstone**, donde van las medidas MPR; la cruz
  se quita con `V.suspendCrosshairs(true/false)`, que la reactiva sin mover los cortes), panorámica a 1600 px
  (`panoFigureUrl`) y mosaico de ATM fuera de pantalla (`atmFigureUrl`), tabla de medidas
  (`reportMeasures()`: 3D, MPR (`V.getMprMeasureValues`), panorámica, ATM con «ATM derecha · Sagital centro»,
  y aparte ejes del cóndilo y vía aérea), datos del paciente (omitibles) y del estudio, observaciones.
  `buildReportHtml(data)` da una página autocontenida (imágenes en data-URL, Poppins por URL absoluta, `@page A4`,
  aviso legal + versión en el pie) que se abre con `openReport()` en una pestaña (blob) y lanza `window.print()`
  a los 500 ms: «Guardar como PDF» del navegador (sin librería PDF). Si el navegador bloquea la pestaña, se
  descarga el HTML. Sin `pdf-lib`/`jsPDF` a propósito: el PDF del navegador es vectorial y pesa poco.
- **Sesión .tresd** (JSON `{ app:'tresD DICOM', format:1, version, series, patient, chipHidden, layout, render,
  mprWindow, cut, silhouettes, showArch, measures:{v3d, mpr}, pano:{control, z, thickness, mip, win, meas},
  tmj:{poles, shift, meas, win, aspect, midX}, airway:{sup, inf, …}, seg, meshes:[{name, role, M, align, …}] }`):
  `buildSession()/saveSession()` (descarga `tresD_<paciente>_<fecha>.tresd`), `loadSessionFile(file)` (si no hay
  CBCT → `pendingSession`, se aplica en `openSeries` a los 300 ms), `applySession(d)` (paciente, chip, render,
  ventana, siluetas, medidas 3D (`V.setMeasures3D`) y MPR (`V.setMprAnnotations`: re-añade las anotaciones de
  Cornerstone serializadas con su color y visor), segmentación (`runSegmentation`), vía aérea
  (`V.segmentAirway(sup, inf)`), panorámica (`V.curveFromPoints` + `V.buildPano({curve, thickness, mip})`), ATM
  (`V.restoreTmj(saved, aspect)`: rehace los cortes desde los POLOS guardados sin volver a marcar; con
  `saved.aspect` para que las medidas en píxeles sigan valiendo), disposición). Los escáneres no van dentro:
  quedan en `pendingMeshes[nombre]` y `ingestMeshes` los reconoce por nombre (sin extensión) → `addMesh` con
  `autoOrient:false` + `V.applyMeshMatrix(id, M, align)` (M = escáner crudo → mundo, se compone en `meshes.transform`),
  sin diálogo ni alineación. `.tresd` también por arrastre (`isSessionName` en `ingest`). Cabecera:
  `#btn-open` (siempre), `#btn-save` y `#btn-report` (con caso), `<input id="in-session">`.
- No se guardan: la foto drapeada (habría que meter la imagen), la posición de cámara del 3D ni los cortes
  actuales de los MPR (Cornerstone los reencuadra al cargar).
- Pruebas: `tests/v080.mjs` (~7 min): caso con de todo → guardar (JSON comprobado) → informe (pestaña nueva:
  `ctx.waitForEvent('page')`, `window.print` sustituido en `ctx.addInitScript`, 6 figuras, 4 medidas, ejes,
  observaciones, pie) → informe sin paciente → visor nuevo + CBCT + sesión (todo restaurado; escáner reimportado
  con la MISMA matriz) → sesión antes del CBCT (pendiente) → arrastrar el .tresd. `v0716` acepta cualquier versión.

## 2ad. v0.8.1 (16-09-2026) — TELERRADIOGRAFÍA simulada (lateral / frontal, radiografía / MIP)
- Manuel preguntó si se puede sacar una telerx «en MIP y normal» del CBCT y pidió una prueba antes: se hizo en
  Python sobre DZ-CBCT (3,3 s las cuatro imágenes) y le gustó («me encanta, impleméntalo»).
- **Núcleo** `src/core/telerx.js`: `buildTelerx(volume, getSlice, { view, air, mipLo }, onProgress)` → `{ ray, mip }`
  en UNA pasada por el volumen (suma de `max(0, v − aire)` y máximo por rayo, acumulados con tablas de
  desplazamiento por eje: ~0,3 s para 334×334×217; cede el hilo cada 16 cortes para pintar el «%»). Ejes:
  `axisFrame(img)` saca el eje de índice dominante y su signo para X (izquierda), Y (posterior) y Z (superior) con
  `indexToWorld`; lateral = rayos por X, columnas hacia ANTERIOR (cara a la derecha); frontal (PA) = rayos por Y,
  columnas hacia la IZQUIERDA del paciente (se le mira de frente); filas hacia inferior. Radiografía: `normalize`
  (percentiles 3–99,7, gamma 1,6) + `unsharp` (caja de 1,5 mm, 60 %); MIP: negro por debajo de `mipLo`
  (= soft + 0,75·(bone − soft) de `autoThresholds`, ≈ 150 HU) y percentil 99,8 blanco. Ambas en 0…1000 con
  ventana por defecto 0–1000 (así el arrastre de brillo/contraste usa los mismos ×4 por píxel que la panorámica).
  `squareRows` si el vóxel no es cuadrado. `rotateImage(img, deg)` (bilineal, mismo tamaño; + = antihorario) y
  `rotatePoint` para las medidas: girar el volumen sobre el eje del rayo ≡ girar la proyección en 2D.
- **Núcleo** `viewer.js` bloque TELERRADIOGRAFÍA: `state.tele = { view, mode, tilt, cache: { lat, pa }, image, win: { ray, mip },
  meas: { lat, pa } }`; `buildTele(opts)` (caché por vista; aire = percentil 15 de `state.sorted`, nunca por
  debajo de −1000), `setTeleTilt` (gira imagen y medidas), `get/setTeleWindow(s)`, `get/add/set/clear/getAll/setAllTeleMeas`,
  `drawTelerx` = `paintGray`. `state.tele = null` donde se anula `state.pano` (cargar / quitar el volumen).
- **Interfaz** (`main.js` bloque «telerradiografía simulada»): disposición `vpTele` (botón «Telerx» /
  «Ceph» en la barra de vistas; primera vez calcula, luego solo repinta), `.vp[data-id="vpTele"]` con
  `#tele-canvas` y barra `#tele-lat/#tele-pa`, `#tele-ray/#tele-mip`, `#tele-tilt` (−20…+20°, con deshacer en
  `change`), `#tele-len/#tele-ang/#tele-clear`; letras P/A o D/I (`teleLetters`, también al cambiar de idioma);
  medidas por toques y arrastre como en la panorámica (`teleTool/telePts/teleMeasDrag`, `atmPos`, `measAtLabel`,
  `drawMeasures`); Esc cancela; doble clic → 2×2; `shotPng` captura el `.pan-wrap`; informe: casilla
  `#rp-tele`, figura `teleFigureUrl()` («Telerx lateral · Radiografía») y filas «Telerx lateral/frontal» en la
  tabla; sesión: `tele: { view, mode, tilt, win, meas }` → `applySession` rehace la vista (`showTelerx` silencioso)
  y repone ventana y medidas.
- Límites (en la ayuda 8b): sin magnificación (1:1) frente al 8-10 % de la telerx real; solo el campo del CBCT;
  la inclinación es en 2D (giro sobre el eje del rayo; un giro sobre otro eje exigiría reproyectar).
- Pruebas: `tests/v081.mjs` (~4 min): lateral (334×217 a 0,5 mm; corona metálica en la mitad anterior),
  MIP/frontal/caché, medidas por toques con el valor esperado por la escala 1:1, ángulo de 90°, Esc, Ctrl+Z/Y,
  brillo/contraste, inclinación +10° (misma longitud, imagen girada, deshacer), captura, informe, sesión, doble
  clic, inglés («Ceph»).

## 2ae. v0.8.2 (16-09-2026) — Regla en la telerx, deslizadores de corte, modelo cortado, «Refinar alineación», informe PDF
- **Regla** (`drawTeleRuler(cv, img, f)` en main.js): 50 mm horizontal + 50 mm vertical en la esquina inferior
  izquierda de la telerx, marcas cada 5 mm (largas cada 10, con cifra), amarillo #FFD166 con sombra; se pinta en
  `drawTele` (pantalla → captura) y en `teleFigureFor` (informe). No gira con la inclinación (es la escala).
- **Deslizadores de corte**: `<input type="range" class="vslice" data-vp>` en cada MPR (`layout.js`, `vp()`),
  vertical con `writing-mode: vertical-lr`; `onViewportInfo` lo sincroniza (max = n−1, value = corte−1) salvo
  mientras se arrastra (`dataset.drag`); `input` → `V.setSliceIndex(id, i)` (`csUtils.jumpToSlice`). Sentido por
  volumen (`openSeries`): `direction: rtl` (arriba = máximo) si la normal del plano (`V.viewPlaneNormal`) apunta a
  superior (axial), anterior (coronal) o izquierda del paciente (sagital). La letra `.orient.r` se desplaza a 30 px.
- **Modelo cortado al alinear por puntos (regresión desde v0.7.15)**: CAUSA REAL = límites CACHEADOS de los
  puntos en vtk.js. `meshes.transform/flip/restore` movían `it.pts` en el sitio y llamaban `getPoints().modified()`,
  que NO invalida `model.ranges` de `vtkDataArray`; `polydata.getBounds()` seguía dando la caja de ANTES de alinear
  (45 mm desplazada). `fixClipRange` calculaba los planos con esa caja vieja → recorte «correcto» sobre una caja que
  ya no era la del modelo. Hasta v0.7.14 no se notaba porque el rango ancho de antes (con el volumen visible) se
  conservaba; con `applyLayout('vp3d')` Cornerstone hace `resize(keepCamera=false)` → `resetCamera` → rango
  estrecho sobre la caja vieja → modelo cortado. Arreglo: `getPoints().dataChange()` (invalida rangos + modified).
- **«⌖ Alinear al CBCT» → «⌖ Refinar alineación»** (`mesh_align`, ES/EN; ayuda 5).
- **Informe en PDF** (`ui/report.js` reescrito con **jsPDF 4.2.1** (MIT, +370 kB en el bundle): `buildReportPdf(data)`
  → A4, Helvetica (WinAnsi: acentos, «», ·, ×, ° bien; evitar U+2212), cabecera con logotipo (JPEG vía `toJpeg`),
  dos columnas paciente/estudio, rejilla de figuras (2 por fila; `wide` a todo el ancho, alto máx. 120 mm) con
  salto de página (`ensure`), tabla de medidas con punto de color, extra, observaciones, pie con aviso legal +
  versión + «Página i de n» en todas las páginas; `doc.save(nombre)` descarga `tresD_informe_<paciente>_<fecha>.pdf`.
  Capturas convertidas a JPEG (`toJpeg`, 0,88) para que el PDF pese ~0,7 MB en vez de 5. `generateReport`: 2×2 →
  render 3D + cortes; `applyLayout('vp3d')` + `V.setView('frontal'|'lat_r'|'lat_l')` → tres vistas ampliadas
  (`rp-views`); restaura la disposición y la cámara (`vp3.setCamera(cam0)`); telerx LATERAL radiografía siempre
  (`teleFigureFor('lat','ray')` la calcula si falta y repone la vista que había) y, si se está viendo otra
  (frontal o MIP), también esa. Se quitó la página HTML imprimible (`buildReportHtml`/`openReport`).
- Pruebas: `tests/v082.mjs` (~6 min): deslizadores (3, verticales, mover uno cambia el corte y la rueda mueve el
  deslizador, sentido del axial, letra desplazada), botón «Refinar alineación», límites al día tras alinear,
  alinear por puntos desde el 2×2 → píxeles del modelo iguales con planos «infinitos», regla (píxeles amarillos
  solo en su esquina, 50 mm medidos, también en la captura), PDF desde la vista frontal (3 vistas + 2 telerx,
  sin cortes, ≥ 7 JPEG). `v080` y `v081` pasan a comprobar el PDF con `pdftotext` / `pdfinfo` / `pdfimages`
  (poppler, instalado en el contenedor).

## 2af. v0.8.3 (17-09-2026) — Polos al estilo VOXEL, Rejilla, Compartir caso, PDF con tema, botones según disposición
- **Polos del cóndilo** (`tmj.js`, `polesAtWidest(smp, pole, thr, midX)` dentro de `refineCondyle`): el error de la
  captura de Manuel (polos en la base del cuello) venía de medir la anchura en el nivel del clic. Ahora, a partir de
  la huella del cóndilo (mancha aislada en el axial más ancho `bestAxialOffset`, dilatada 2 px) se sube columna a
  columna dz −3…+6 mm (paso 0,35) hasta el ESPACIO ARTICULAR (hueco ≥ 1 mm) y, en cada nivel, se toman los extremos
  medio-laterales (media de los 3 puntos más mediales / laterales); se elige el nivel de anchura máxima (los dos
  polos a la misma z). Guarda: anchura ∈ [min(11, 0,8·w0), 27] mm y giro del eje ≤ 60° respecto a la primera
  estimación; si no, se vuelve a la estimación clásica (por eso en la media muestra el lado R queda con dz ≠ 0).
- **Rejilla** (`core/pointCloud.js`, `buildPointCloud`): preset `grid` en `presets.js`; `applyRender` oculta el
  actor del volumen y añade un actor de puntos (SUPERFICIE del hueso = vóxel ≥ umbral con un vecino de 6 por debajo,
  `stride` ≥ 2, máx. 1,5 M puntos, gris por intensidad con `vtkColorTransferFunction`, puntos de 2 px sin luz).
  El umbral es el brillo (límite inferior de la ventana); al entrar en el preset se usa `autoThresholds().bone`.
  `rebuildCloudSoon` (debounce 250 ms) al cambiar la ventana; `cloudInfo()` para las pruebas; `cloud = null` al
  quitar el volumen.
- **Compartir caso** (`core/sharePack.js` + `shareDialog`/`buildPackage` en main.js, botón 📦 `#btn-share`):
  `.tresdz` = ZIP (fflate) con `dicom/NNNN.dcm` (dcmjs, CT sin comprimir, `upsertTag('7FE00010','OW')`; reducción
  2×2×2 por media → 1/8; anonimizado: PatientName ANONIMO, PatientID tresD, sin nacimiento ni centro; se conservan
  sexo y fecha), `escaneres/*.stl` en pose mundial (M identidad en la sesión) y `sesion.tresd` (patient null si
  anónimo, series null, medidas de telerx/ATM en píxeles fuera si se reduce, `packaged:{reduced,anonymized}`).
  Se abre como un ZIP (`expandZips` acepta `.tresdz`); orden de ingesta DICOM → sesión → mallas → foto.
- **PDF con tema** (`report.js`, `THEMES` light/dark, radios `rp-theme` con el tema del visor por defecto): en oscuro
  `paintBg` pinta el fondo de CADA página (una página nueva nace blanca). Siluetas apagadas durante la captura de los
  MPR (se reponen). TeleRx lateral Y frontal en radiografía siempre (+ la MIP que se esté viendo).
- **Alinear por puntos**: `V.zoom3D(1.6)` sobre el escáner (y otra vez a los 450 ms: el cambio de disposición
  reencuadra la cámara); fase 2 `V.focusTeeth3D()` (foco = `state.teeth.all.center`, parallelScale = percentil 95
  de las distancias × 1,1, entre 15 y 45 mm) y si no hay dentición detectada `zoom3D(2.2)`.
- **Interfaz**: `CROSS_LAYOUTS = ['quad','main3','row']` (Cruz solo ahí, oculta y desactivada fuera); `[data-view]`,
  Centrar y Rotación solo con el render a la vista (`applyLayout`); `#btn-rotate` va tras `#btn-center` en la barra
  de vistas; `#btn-atm` se oculta con `state.tmj` (en `setHasCase` y `renderTmj`); `#btn-meta` = 🏷️ con tooltip;
  siluetas apagadas por defecto (`silhouettes:false` + `#sil-vis` sin marcar); deslizadores `.vslice` con pista de
  6 px del tema y pulgar degradado; textos `atm_r/atm_l` «1/2 … (navega en el corte axial…)»; «Telerx» → «TeleRx».
- Pruebas: `tests/v083.mjs` (~10 min): 15 puntos (siluetas, 🏷️, Rotación, TeleRx, deslizadores, botones por
  disposición, rejilla visible/oculta, polos L a la misma altura + anchuras, texto 1/2, alinear por puntos con
  zoom, PDF oscuro/claro con telerx frontal y fondo de página, paquete .tresdz verificado con pydicom y reabierto).
  Adaptadas `real`, `v073`, `v075`, `v0712`, `v0714`, `v080`, `v081`, `v082` (siluetas por defecto, Cruz oculta…).

## 2ag. v0.8.4 (17-09-2026) — Deslizadores de color, Rejilla con alambre, vista derecha al alinear, PDF, panel y paquete .tresdz
- **Deslizadores** `.vslice` del color de su corte (`--sl`: axial #E5484D, coronal #30A46C, sagital #3E63DD, los de la
  cruz): pista `color-mix` 45 % y pomo con degradado radial del mismo color (`app.css`).
- **«Cortes de ATM» oculto**: la regla vivía DOS veces en `setHasCase` (la segunda, `!vol`, ganaba y lo volvía a
  enseñar). Ahora una sola en `refreshImportGroups()` (llamada desde `setHasCase` y `renderTmj`).
- **Rejilla con alambre** (`buildWireframe` en `pointCloud.js`): marching cubes (vtk.js) al umbral sobre el volumen de
  render submuestreado al DOBLE del paso de los puntos (mín. 4 vóxeles; al mismo paso, de lejos las líneas se
  fundían en un relleno macizo), puntos transformados índice → mundo con el marco del volumen, actor en
  `WIREFRAME` gris-azulado, opacidad 0,22 (× opacidad del render), sin luz; los puntos siguen encima. ~1 s en un 200³.
  `cloudInfo()` devuelve también `tris` y `wireVisible`; `cloudShow(on)` sincroniza los dos actores.
- **Alinear por puntos en vista DERECHA**: `V.setView('lat_r')` antes de `reset3D()` en `fit()` (fase escáner) y en
  `paPhaseDst` (fase CBCT, seguido de `focusTeeth3D`). Las pruebas eligen ahora vértices del lado derecho (x mínimo
  en LPS) repartidos de delante atrás, no los anteriores (desde la derecha quedarían tapados).
- **PDF**: «Panorámica» se puede marcar aunque no se haya abierto (se calcula en `generateReport` con la curva
  automática y el grosor / MIP de la barra); TeleRx lateral y frontal en radiografía Y MIP (4 figuras; `rep_opt_tele`).
- **Panel izquierdo**: título «3 · Piel y foto facial» oculto con piel y foto hechas; la caja `#g3` entera sin
  ningún botón; «Importar» (`.phead .h1`) oculto con CBCT + 2 escáneres + piel + foto.
- **Paquete .tresdz (segunda tanda)**:
  · Foto drapeada: `V.drapeExport()` = atlas (recorte de la cara con margen color piel, `soft.textureCanvas`) en JPEG
    data-URL + `pose` (R, t, f, cx, cy) + geometría del atlas (`pad`, `box`, `skin`, W, H). Va en la SESIÓN
    (`photo`, también en el .tresd) y `V.drapeImport()` la vuelve a proyectar (`projectUV`) sobre la piel que segmente
    el receptor (misma posición en el mundo aunque el volumen esté reducido). Casilla «Incluir la foto drapeada»
    (`#sh-photo`), propuesta solo si NO se anonimiza (sigue al cambio de la casilla de anonimizar).
  · Escáneres con color por vértice → `escaneres/*.ply` (`writePLY` binario LE con red/green/blue; `V.meshPLY`);
    sin color, STL como antes. El lector PLY ya devolvía `colors`.
  · Reducción 1/4 en vez de 1/8: vóxel × ∛4 ≈ 1,59 en los tres ejes con remuestreo TRILINEAL (`volumeToDicom`,
    pesos precalculados por eje, caché de 4 cortes); origen = centro del primer vóxel de salida.
  · Abrir: `#in-session` («📂 Abrir», acepta .tresd/.tresdz/.zip) manda los .tresdz / .zip a `ingest()` (antes intentaba
    `JSON.parse` del ZIP → «sesión no válida»); en la pantalla inicial dos botones (`.drop-btns`): «📁 Carpeta DICOM»
    (`#drop-folder` → `#in-folder`) y «📦 ZIP, caso compartido (.tresdz) o sesión (.tresd)» (`#drop-open` →
    `#in-session`), porque el clic en el recuadro abre el selector de CARPETA, que no puede elegir un ZIP.
  · `applySession` por BLOQUES independientes (`step(nombre, fn)`): si falla uno (telerx, panorámica…) los demás
    (ATM, foto…) se restauran igual y el estado dice «No se pudo restaurar: …» (`st_sess_partial`). Explica el
    «no se empaquetan los cortes de ATM» de Manuel: un bloque anterior tiraba toda la restauración.
- Pruebas: `tests/v084.mjs` (~25 min): colores de los deslizadores, títulos del panel, rejilla con triángulos,
  botón de ATM tras refrescar el panel, vista derecha en las dos fases, PDF con panorámica calculada y 4 telerx,
  segmentación + foto manual + segundo escáner (títulos ocultos), paquete con PLY + foto + 1/4 verificado con
  pydicom, reabierto con «📂 Abrir» (foto, color, ATM, panorámica) y con «Subir ZIP». `real.mjs` y `v083.mjs`
  adaptados a la vista derecha.

## 2ah. v0.8.5 (17-09-2026) — ZIP en Worker, render al importar, PNG sin fondo, página de vía aérea, PowerPoint, app instalable
- **ZIP «no lo detecta»** (Manuel): el `unzip` ASÍNCRONO de fflate lanza UN Web Worker POR ARCHIVO del ZIP: con un
  CBCT de cientos de cortes se quedaba sin memoria / colgaba (en Node, el mismo `unzip` de un ZIP de 162 MB muere
  por OOM; `unzipSync` tarda 4 s y 620 MB). Ahora `core/unzip.worker.js` (Worker propio, `unzipSync`, buffers
  transferidos) y `expandZips` recursivo (ZIP dentro de ZIP, 2 niveles). Si no hay series, el estado dice cuántos
  archivos se leyeron y ejemplos (`st_files_seen`) y la consola lista los 20 primeros.
- **Archivos comprimidos por su FIRMA** (`sniffArchive`): «Ese archivo no es una sesión» salía con el ZIP de Manuel
  porque su nombre no acababa en .zip/.tresdz (el manejador de «📂 Abrir» decidía por la extensión). Ahora «📂 Abrir»
  y `expandZips` miran los primeros bytes: `PK` = ZIP (con cualquier extensión o sin ella), `Rar!` / `7z` / gzip
  → aviso `st_archive_other` («…es un archivo RAR: el visor solo abre ZIP. Descomprímelo…»). Solo se mira la firma de
  los archivos SIN extensión conocida (.dcm, .stl, .jpg… no se tocan).
- **RAR (WinRAR)**: el «ZIP» de Manuel era un .rar. `core/unrar.worker.js` con **node-unrar-js 2.0.2** (MIT; el unrar
  oficial de RARLAB en WebAssembly, licencia UnRAR: solo descomprimir) → `docs/assets/unrar.wasm` (208 kB, se carga al
  usarlo) + `unrar.worker.js`. `expandZips` trata .rar (o firma `Rar!`) igual que ZIP (RAR4/RAR5, 217 cortes en ~4 s);
  volúmenes partidos (.part1.rar) NO. `#in-zip` / `#in-session` aceptan .rar; textos «Subir ZIP / RAR». 7z y .gz siguen
  con el aviso. Para las pruebas se instaló `rar` (apt, trial) y se crean .rar en `tests/v085.mjs`.
- **Sello de versión con hash** (`scripts/version_stamp.mjs`): `?v=0.8.5-<sha1 8>` de index.js + index.css: dos builds
  de la misma versión ya no comparten caché (pasó con la 0.8.4).
- **Al importar un escáner** se activa la vista del render: `ingestMeshes` → si el 3D no está a la vista,
  `applyLayout('vp3d')`; si el volumen estaba apagado, se enciende.
- **Render sin fondo** (`V.shot3DAlpha(maxW)`): dos renders (fondo negro y blanco) → alfa = 1 − (B − N)/255 por píxel y
  color = N/alfa (difference matting; vale para lo translúcido). PNG con transparencia (jsPDF lo respeta con
  `smask`); casilla `rp-png` (marcada). El fondo del visor se repone (`viewerBg()`).
- **Página de vía aérea** (`airwayReportSection` en main.js → `data.airway` → `report.js` / `reportPptx.js`): 3D a
  solas, cráneo + escáneres + piel al 40 % (60 % de transparencia), vía aérea opaca con mapa de calor, volumen solo
  si no hay cráneo segmentado (también al 40 %), vista `lat_r`; tabla Medida / Valor / Norma (adulto) / Desviación
  con punto de color (`CLASS_RGB`), leyenda del mapa (`V.heatColorAt`, MCA → percentil 85), altura del segmento,
  aviso pediátrico / sin sexo, criterio de valoración y referencia (Guijarro-Martínez & Swennen 2013). Todo se
  repone después (visibilidad y opacidad de cada malla, volumen, mapa de calor).
- **PowerPoint** (`ui/reportPptx.js`, **PptxGenJS 4.0.1** MIT, `import()` dinámico → chunk `pptxgen.es.js` +
  `reportPptx.js` + `rolldown-runtime.js`, que hay que entregar en docs/assets): 16:9, portada con logotipo y dos
  columnas, una diapositiva por figura, vía aérea (imagen + leyenda + tabla), medidas (12 por diapositiva) y
  observaciones; pie con aviso, versión y «i de n»; fuente Segoe UI. Radios `rp-format` PDF / PowerPoint / Ambos.
- **App instalable** (`public/manifest.webmanifest` + `<link rel="manifest">` + `theme-color`): `display:
  standalone`, iconos existentes (icon-192/512) y `file_handlers` para `.tresdz` / `.tresd`; en main.js
  `launchQueue.setConsumer` → `ingest(files)`. Instalada desde Chrome/Edge, Windows enseña esos archivos con el icono
  de tresD y el doble clic los abre (ayuda §12). Sin instalar, la web no puede registrar tipos de archivo.
- Pruebas: `tests/v085.mjs` (~12 min): manifest y sello, ZIP anidado, ZIP con carpeta «Paciente Pérez» + DICOMDIR,
  ZIP sin DICOM, render al importar, PNG con alfa (esquina 0 / centro 255, fondo repuesto), vía aérea + informe en
  «Ambos» (PDF con página de vía aérea y ≥ 4 smask; PPTX válido: ≥ 6 diapositivas con pie y referencia), solo PPTX.
- Helvetica de jsPDF (WinAnsi) NO tiene «≥» ni «−» (U+2212): salen como `"e` y `"`. Textos del PDF sin esos signos.

## 2ai. v0.8.6 (18-09-2026) — Orientar el volumen, deslizadores bajo los cortes, PowerPoint que sí baja, ventana de progreso
- **Orientar el volumen** (`setOrient` / `getOrient` en viewer.js + panel `#orient-box` en el panel izquierdo):
  tres deslizadores (±30°, paso 0,5°) enderezan la cabeza en los tres planos. Como los cortes MPR van por los ejes
  del MUNDO, se gira EL CASO ENTERO alrededor del centro del volumen y así los cortes —y todo lo que sale de
  ellos: panorámica, TeleRx, ATM— quedan con el paciente derecho. Ángulos LPS: x = asentir (sagital, eje X),
  y = inclinación lateral (coronal, eje Y), z = giro (axial, eje Z); R = Rz·Ry·Rx.
  · Los ángulos son ABSOLUTOS y cada llamada aplica solo la DIFERENCIA (`R_nuevo · R_actualᵀ`): los deslizadores no
    acumulan error y «Orientación original» deja el volumen EXACTAMENTE donde estaba (0,000 mm en la prueba).
  · Volumen: `imageData.setDirection/​setOrigin` (las FILAS de la matriz de dirección de vtk.js son los ejes i, j, k;
    comprobado: `indexToWorld` tras girar coincide con la matriz esperada con error 0,0000 mm) + `vol.direction` y
    `vol.origin` de Cornerstone. También el volumen de RENDER (`renderVolumeId`), o el 3D se quedaría torcido.
  · Lo demás se gira con la misma matriz 4×4: mallas (`meshes.transform`: escáneres, cráneo, piel, vía aérea),
    medidas 3D, anotaciones de los cortes (puntos y caja de texto), polos de ATM, límites de la vía aérea y la POSE
    de la foto drapeada (las UV no cambian: la textura va pegada a los vértices). Se invalidan `enamel`/`teeth`
    (se re-detectan sobre el volumen derecho), la caché de TeleRx y la nube de la rejilla.
  · Lo caro se rehace al SOLTAR el deslizador (`finishOrient`): cortes de ATM (`restoreTmj` con los polos girados) y
    panorámica (curva desde los puntos de control girados). Mientras se arrastra solo se gira la geometría (90 ms
    de debounce). Prueba clave: con el volumen girado 12°, «Refinar alineación» mueve el escáner 0,43 mm → el caso
    gira coherentemente y el escáner sigue sobre los dientes.
  · Sesión: `orient` en el .tresd; al restaurar se aplica ANTES que nada con `{ volumeOnly: true }` (las mallas y las
    medidas guardadas ya vienen en el marco girado). En el paquete .tresdz va `orient: null`: `volumeToDicom` usa
    `indexToWorld`, así que el DICOM exportado sale YA enderezado.
- **Deslizadores de corte BAJO cada corte** (petición de Manuel): horizontales, pegados al borde inferior, al 94 %
  del ancho; suben la letra de orientación inferior y el pie de información (`:has(.vslice:not(.hidden))`).
- **El PowerPoint no se descargaba** en el PC de Manuel: `buildReportPptx` devuelve ahora un **Blob**
  (`pptx.write({ outputType: 'blob' })`) y lo descarga `download()` de main.js —el mismo camino que la sesión y el
  paquete, que sí le funcionaban— en vez del `writeFile` interno de PptxGenJS. Con «Ambos» las dos descargas se
  separan 1,2 s: dos descargas seguidas las bloquea Chrome («¿Descargar varios archivos?»).
- **Ventana de progreso** (`busyModal(title)` → `{ text, pct, close }`, `.modal.busy` con rueda y barra): informe
  (con el paso: capturas, TeleRx, vía aérea, PDF, PowerPoint), segmentación y foto drapeada, que en equipos
  modestos tardan 20-30 s y parecía que el visor se había colgado.
- **Al terminar de alinear** (por puntos y «Refinar alineación») se ve el render 3D con el CBCT y los escáneres
  encendidos (`showRenderWithMeshes`).
- **La piel fuera de la captura de vía aérea** del informe (tapaba la columna de aire); el cráneo y los escáneres
  siguen al 40 %.
- Pruebas: `tests/v086.mjs` (~20 min): deslizadores horizontales y sin tapar el pie, giro exacto y vuelta exacta,
  el escáner gira con el volumen y sigue alineado tras refinar, render tras alinear, orientación en la sesión,
  ventana de progreso en segmentación e informe, PDF+PPTX con «Ambos», PPTX válido y sin piel en la vía aérea.

## 3. TRAMPAS descubiertas (no volver a caer)
- **`unzip` asíncrono de fflate = un worker por archivo**: nunca para ZIP con cientos de archivos. `unzipSync` en un
  Worker propio.
- **Playwright `setInputFiles` con un archivo de 160 MB se queda colgado** (sin error): los ZIP grandes se prueban
  en Node (`unzipSync`) y en el navegador solo los pequeños.
- **jsPDF/Helvetica no tiene ≥ ni −**: revisar los textos nuevos del informe con `pdftotext`.
- **`python -m http.server` no manda `Cache-Control`**: Chrome guarda `index.html` por heurística y al abrir el .bat
  Manuel veía la versión ANTERIOR (los `?v=` de los assets no sirven si el propio index.html es el viejo). Desde
  v0.8.4 `servidor_local.py` responde `no-store` y el .bat abre `/?t=aleatorio`.
- **La matriz de dirección de vtk.js va por FILAS** (fila 0 = eje i en el mundo): al girar un volumen hay que
  multiplicar cada fila por R. Comprobarlo SIEMPRE con `indexToWorld` antes y después (si estuviera transpuesta, el
  volumen giraría al revés que las mallas y nadie lo vería hasta tener un escáner encima).
- **Al girar el volumen hay que girar TAMBIÉN el volumen de render** (`renderVolumeId`): es una copia con su propia
  dirección y si no, el 3D se queda torcido respecto a los cortes.
- **`pptx.writeFile()` de PptxGenJS descarga por su cuenta**: si el navegador la bloquea no hay error ninguno.
  Mejor pedirle el Blob (`write({ outputType: 'blob' })`) y descargarlo con el mismo camino que el resto.
- **Dos descargas seguidas las bloquea Chrome** («¿Descargar varios archivos?»): separarlas en el tiempo.
- **Dos `classList.toggle` sobre el mismo botón en la misma función**: gana el último. Antes de añadir una regla de
  visibilidad, grep del selector en TODO el archivo (regla 1) — `#btn-atm` estuvo una versión sin ocultarse por esto.
- **Un alambre (wireframe) al paso de los vóxeles se ve macizo de lejos**: hay que submuestrear más que los puntos.
- **`getComputedStyle().backgroundColor` de un `color-mix` devuelve `color(srgb r g b)`** con decimales, no `rgb(…)`:
  las pruebas deben aceptar los dos formatos.
- **Una restauración larga en secuencia (sesión) debe ir por bloques con su propio try/catch**: un fallo en la
  telerx dejaba sin ATM ni foto.
- **vtk.js: un `vtkDataArray` uchar de 1 componente se interpreta como COLOR directo** (no pasa por la tabla de
  colores) → una nube de puntos con escalares Uint8 sale invisible. Escalares Float32 + `setColorModeToMapScalars()`.
- **Los polos del cóndilo NO se miden en el nivel del clic**: el usuario pincha donde ve el cóndilo en el axial
  (a menudo el cuello); hay que subir hasta el espacio articular y quedarse con la sección más ancha (VOXEL).
- **Una página nueva de jsPDF nace blanca**: con fondo oscuro hay que pintarlo en `addPage()` (y en la primera).
- **Al copiar una barra de aviso (#aw-bar → #atm-bar) revisar TODOS los selectores del flujo original**:
  un `#atm-bar` en `awRestore` dejó el aviso de la vía aérea colgado durante tres versiones sin que ninguna
  prueba lo viera (comprobaban las siluetas, no la barra). Toda barra de aviso debe tener una prueba de
  «se oculta al terminar».
- **Toda ventana automática (valoración) rompe las pruebas** si salta a mitad: cada `addInitScript` de
  las pruebas pone `tresd_dicom_feedback = 'done'`. Al añadir una prueba nueva, copiar esa línea.
- **`preventDefault()` en `pointerdown` mata el `click` y el `dblclick`** de ese elemento (se cancelan los
  eventos de ratón de compatibilidad). Si hace falta arrastrar Y detectar dobles clics, hay que contarlos a
  mano con el tiempo entre pulsaciones.
- **`viewer.screenshot` solo ve los visores de Cornerstone**: la panorámica y el mosaico de ATM son canvas
  propios; cualquier vista nueva que no sea un visor de Cornerstone hay que componerla aparte.
- **Las medidas de los cortes MPR van en SVG, no en el canvas**: `shotDom` (solo canvas) no las saca. Para
  incluirlas hay que serializar la capa `svg` a imagen (`shotDomAsync`, asíncrono). La cruz también es SVG:
  se quita con `suspendCrosshairs(true)` (setToolDisabled borra sus anotaciones; al reactivar se recoloca sola).
- **La línea media del paciente NO es x = 0**: el origen DICOM puede estar en una esquina. Cualquier
  izquierda/derecha o medial/lateral se decide comparando con el centro del volumen (o, mejor, con un punto
  anatómico medio), nunca con el signo o el valor absoluto de x.
- **Un canvas pintado a los píxeles de la imagen sale borroso al ampliarlo en pantalla**: lo que se dibuje
  encima (rótulos, medidas) hay que pintarlo en un canvas a la resolución de la PANTALLA, no de la imagen.
- **Cornerstone reencuadra la cámara al cambiar de disposición**, y lo hace más tarde de lo que parece: un
  salto de corte hecho «después» con uno o dos `requestAnimationFrame` puede perderse igual. Hay que
  reintentarlo hasta comprobar que el valor se queda puesto.
- **Rellenar el aire «que no sea el mayor componente» falla con encuadres ajustados**: si la cabeza toca las
  paredes del FOV, el aire exterior queda partido en bolsas y se rellena el volumen entero. Hay que partir de
  los componentes que TOCAN EL BORDE y añadir una red de seguridad por fracción de sólido.
- **Las etiquetas dibujadas sobre un canvas escalado con `object-fit: contain`** hay que dimensionarlas
  dividiendo por la escala del canvas; si no, crecen con la imagen y se solapan.
- **Cornerstone dibuja la cruz en píxeles de pantalla**, no en mm: hay que reajustar `handleRadius` y
  `referenceLinesCenterGapRadius` cada vez que cambia el tamaño del visor.
- **Repintar 14 canvas en cada `pointermove`** hace que arrastrar parezca que no responde: durante el arrastre,
  repintar solo el que se está tocando.
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
- **Los canvas de Cornerstone no comparten tamaño interno** (el del render 3D difiere del de los cortes):
  cualquier composición hay que hacerla por el tamaño EN PANTALLA (`getBoundingClientRect`), nunca por
  `canvas.width`.
- **Un `<canvas>` dentro de `.modal` (flex en columna) se estira al ancho de la ventana** (`align-items:
  stretch`): darle tamaño fijo o `align-self: center`, y al mapear clics usar siempre `getBoundingClientRect()`
  frente al tamaño intrínseco.
- **El reconocimiento facial se hace sobre el visor 3D: si está oculto, el render sale vacío** y el fallo
  parece de MediaPipe. Cualquier cosa que lea el canvas 3D (drapeado, capturas) debe asegurarse antes de que
  el visor esté visible y con tamaño.
- **`CrosshairsTool` se pone solo en modo «móvil» en equipos con pantalla táctil** (`any-pointer: coarse`) y
  entonces ignora `handleRadius` y los controles de grosor: círculos de 9 px y cuadrados siempre visibles.
  Lo que no sale en SwiftShader puede salir en el PC de Manuel: probar también con `hasTouch: true`.
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
- `tests/make_offset_geom.py`: copia `cbct_half/` desplazando el origen (+200 mm en X, +150 en Y) →
  `cbct_offset/`, un CBCT cuyo volumen entero cae en x > 0. Prueba de que medial/lateral no se cambian
  cuando la línea media no es x = 0 (`tests/v076.mjs`).
- `tests/make_real_scans.py` (también vuelca `dz_half/dz_full.raw+json` para Node) + `tests/align_node.mjs`
  (Node, ~15 s) + `tests/real.mjs` (navegador, ~5 min):
  alineación con dientes REALES (auto y por puntos), siluetas, colores de mediciones y trazado en vivo,
  dentición fina. Ver 2i.
- `tests/v080.mjs`: informe y sesión .tresd (ver 2ac); necesita `cbct_half/` y `real_scans/upper.stl`.
- `tests/v081.mjs`: telerradiografía simulada (ver 2ad); necesita `cbct_half/`.
- `tests/v082.mjs`: regla, deslizadores, modelo cortado, PDF (ver 2ae); necesita `cbct_half/` y `meshes/arch_upper.stl`;
  usa `pdftotext`, `pdfinfo`, `pdfimages` y `pdftoppm` (poppler-utils) y Python + Pillow + numpy.
- `tests/v083.mjs`: los 15 puntos de v0.8.3 (ver 2af); necesita `cbct_half/` y `real_scans/upper.stl`; usa poppler,
  Pillow y **pydicom** (`pip install pydicom`) para verificar el paquete .tresdz.
- `tests/v084.mjs`: los 12 puntos de v0.8.4 (ver 2ag); necesita `cbct_half/`, `real_scans/upper.stl` y `lower.stl`,
  `meshes/arch_lower.ply` (con color); poppler, Pillow y pydicom.
- `tests/v085.mjs`: v0.8.5 (ver 2ah); necesita `cbct_half/`, `cbct_half.zip`, `cbct_dicomdir/`, `real_scans/upper.stl`;
  poppler, Pillow, `zip` y `rar` (`apt-get install rar`). Crea sus ZIP / RAR de prueba en `/tmp/testdata/ziptest_v085/`.
- `tests/v086.mjs`: v0.8.6 (ver 2ai); necesita `cbct_half/` y `real_scans/upper.stl`; poppler y Pillow.
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
