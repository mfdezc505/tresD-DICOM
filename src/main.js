// tresD DICOM — arranque y lógica de la interfaz (equivalente al Wizard de VOXEL, solo paso Importar).
import './theme.css';
import './app.css';
import { loadLang, setLang, getLang, t, applyI18n } from './i18n/i18n.js';
import { buildLayout, orientationLetters, meshCard } from './ui/layout.js';
import { buildMetadata, renderTable, exportJSON, exportCSV, download, updateSummaryPatient } from './ui/metadata.js';
import { openHelp } from './ui/help.js';
import { buildReportPdf, toJpeg } from './ui/report.js';
import { VERSION } from './version.js';
import { volumeToDicom, zipEntries } from './core/sharePack.js';
import { openFeedback, scheduleFeedback, feedbackState } from './ui/feedback.js';
import { collectFromDataTransfer, collectFromFileList, expandZips, sniffArchive, scanDicom, fmtDate } from './core/dicomLoad.js';
import { isMeshName, guessRole, readMesh } from './core/meshes.js';
import { GUIDED_POINTS } from './core/drape.js';
import { showLegal, termsAccepted } from './ui/legal.js';
import * as V from './core/viewer.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const THEME_KEY = 'tresd_dicom_theme';
const PANELS_KEY = 'tresd_dicom_panels';    // {left:'pinned'|'auto', right:'pinned'|'auto'}
const FONT_KEY = 'tresd_dicom_font';        // factor --fs
const FONT_SIZES = [['font_xs', 0.78], ['font_s', 0.88], ['font_m', 1], ['font_l', 1.15], ['font_xl', 1.32]];
const FONT_DEFAULT = 0.88;                    // «Pequeña» por defecto (petición de Manuel, v0.7.12)

let seriesList = [];
let current = null;                 // serie cargada
const CROSS_LAYOUTS = ['quad', 'main3', 'row'];   // disposiciones con cortes MPR a la vista (cruz)
let layout = 'quad';
let maximized = null;
let rotTimer = null;
let busy = false;
const fbBusy = () => busy || !!(manualPick || pointAlign || airwayPick || tmjPick || panDraw || V.state.measureMode);

// ------------------------------------------------------------------ arranque
async function main() {
  loadLang();
  document.documentElement.lang = getLang();
  applyTheme(loadTheme());
  buildLayout($('#app'));
  applyI18n(document);
  refreshBrand();
  applyFontScale(loadFontScale());
  applyPanels(loadPanels());
  $('#btn-lang').textContent = getLang().toUpperCase();
  setOrientLetters();

  const els = {};
  for (const id of Object.values(V.VP)) els[id] = document.getElementById(id);
  V.state.onStatus = setStatus;
  V.state.onViewportInfo = (id, info) => {
    const box = document.querySelector(`.vp[data-id="${id}"] .vpinfo`);
    if (box) box.textContent = t('slice_of', { i: info.slice, n: info.n }) + '\n' + t('wl', { w: info.window, l: info.level });
    // deslizador de corte (v0.8.2): sigue a la rueda / la cruz; no se toca mientras el usuario lo arrastra
    const sl = document.querySelector(`.vp[data-id="${id}"] .vslice`);
    if (sl && !sl.dataset.drag) { sl.max = String(Math.max(0, info.n - 1)); sl.value = String(info.slice - 1); sl.classList.toggle('hidden', info.n < 2); }
  };
  V.state.onMeasureDone = () => setStatus(t(V.state.measureMode === 'linear' ? 'st_measure_dist' : 'st_measure_ang'));
  V.state.onMeshesChanged = syncCards;
  V.history.onChange = refreshHistoryButtons;
  try {
    await V.initViewer(els);
  } catch (e) {
    console.error(e);
    setStatus(t('st_error', { msg: e.message || e }));
  }
  if (!hasWebGL()) setStatus(t('st_webgl'));
  wireUI();
  let atmFit = 0;
  watermark();                       // precarga del logotipo para la marca de agua
  window.addEventListener('resize', () => {
    V.resize();
    clearTimeout(atmFit);
    atmFit = setTimeout(() => { if (layout === 'vpAtm') fitTmjAspect(); }, 350);   // reencuadrar los cortes de ATM
  });
  // primera visita: términos de uso (uso previsto, responsabilidad del profesional, datos locales)
  if (!termsAccepted()) showLegal('terms', { gate: true, onLang: afterLangChange });
  initCounter();
}

/** Tras cambiar de idioma: textos que no van por data-i18n. */
function afterLangChange() {
  $('#btn-lang').textContent = getLang().toUpperCase();
  setOrientLetters();
  if (current) $('#lbl-import').textContent = (current.desc || current.modality) + ' · ' + current.count + ' ' + t('slices');
}

function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

// ------------------------------------------------------------------ tema / idioma / marca
function loadTheme() { try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) { return 'dark'; } }
function applyTheme(name) {
  document.documentElement.dataset.theme = name === 'light' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, document.documentElement.dataset.theme); } catch (e) { /* nada */ }
  refreshBrand();
  V.applyThemeBackground();
}
function refreshBrand() {
  const dark = document.documentElement.dataset.theme !== 'light';
  const b = $('#brand-img'); if (b) b.src = dark ? './img/logo_main_dark.png' : './img/logo_main_light.png';   // Manuel: siempre el logo «DICOM viewer»
  const m = $('#main-logo'); if (m) m.src = dark ? './img/logo_main_dark.png' : './img/logo_main_light.png';
}
function setOrientLetters() {
  const L = orientationLetters(getLang());
  for (const [id, o] of Object.entries(L)) {
    const vp = document.querySelector(`.vp[data-id="${id}"]`);
    if (!vp) continue;
    for (const k of ['t', 'b', 'l', 'r']) { const s = vp.querySelector('.orient.' + k); if (s && o[k]) s.textContent = o[k]; }
  }
  teleLetters();
}

// ------------------------------------------------------------------ INFORME (v0.8.0)
/** Ventana previa del informe: qué incluir y observaciones; «Generar» abre la página imprimible. */
function openReportDialog() {
  if (!V.hasCase()) return;
  const has = { vol: !!current, pano: !!V.state.pano, tele: !!current, tmj: !!V.state.tmj, meas: reportMeasures().list.length > 0, airway: !!(V.airwayMesh() && V.airwayMesh().airway) };
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  const chk = (id, key, on, dis) => `<label class="chk"><input type="checkbox" id="${id}"${on ? ' checked' : ''}${dis ? ' disabled' : ''}><span>${t(key)}</span></label>`;
  bg.innerHTML = `<div class="modal report"><h3>${t('rep_dlg_title')}</h3><div class="hint">${t('rep_dlg_hint')}</div>
    <div class="rep-opts">
      ${chk('rp-pat', 'rep_opt_patient', !chipHidden, false)}
      ${chk('rp-3d', 'rep_opt_3d', true, false)}
      ${chk('rp-views', 'rep_opt_views', true, false)}
      ${chk('rp-mpr', 'rep_opt_mpr', has.vol, !has.vol)}
      ${chk('rp-pano', 'rep_opt_pano', has.pano, !has.vol)}
      ${chk('rp-tele', 'rep_opt_tele', has.tele, !has.tele)}
      ${chk('rp-atm', 'rep_opt_atm', has.tmj, !has.tmj)}
      ${chk('rp-airway', 'rep_opt_airway', has.airway, !has.airway)}
      ${chk('rp-meas', 'rep_opt_meas', has.meas, !has.meas)}
      ${chk('rp-png', 'rep_opt_png', true, false)}
    </div>
    <div class="frow rep-theme"><span>${t('rep_format')}</span>
      <label class="chk"><input type="radio" name="rp-format" value="pdf" checked><span>PDF</span></label>
      <label class="chk"><input type="radio" name="rp-format" value="pptx"><span>PowerPoint</span></label>
      <label class="chk"><input type="radio" name="rp-format" value="both"><span>${t('rep_format_both')}</span></label></div>
    <div class="frow rep-theme"><span>${t('rep_theme')}</span>
      <label class="chk"><input type="radio" name="rp-theme" value="dark"${document.documentElement.dataset.theme !== 'light' ? ' checked' : ''}><span>${t('rep_theme_dark')}</span></label>
      <label class="chk"><input type="radio" name="rp-theme" value="light"${document.documentElement.dataset.theme === 'light' ? ' checked' : ''}><span>${t('rep_theme_light')}</span></label></div>
    <label class="frow" style="align-items:flex-start"><span>${t('rep_notes')}</span><textarea id="rp-notes" rows="4" maxlength="2000" placeholder="${t('rep_notes_ph')}"></textarea></label>
    <div class="mrow"><button class="btn-ghost" id="dlg-cancel">${t('dlg_cancel')}</button>
    <button class="btn-primary" style="width:auto;min-height:40px;padding:8px 22px" id="dlg-ok">${t('rep_generate')}</button></div></div>`;
  bg.querySelector('#dlg-cancel').addEventListener('click', () => bg.remove());
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  bg.querySelector('#dlg-ok').addEventListener('click', async () => {
    const opts = { patient: bg.querySelector('#rp-pat').checked, v3d: bg.querySelector('#rp-3d').checked, views: bg.querySelector('#rp-views').checked, mpr: bg.querySelector('#rp-mpr').checked,
      pano: bg.querySelector('#rp-pano').checked, tele: bg.querySelector('#rp-tele').checked, atm: bg.querySelector('#rp-atm').checked, meas: bg.querySelector('#rp-meas').checked, notes: bg.querySelector('#rp-notes').value.trim(), theme: (bg.querySelector('input[name="rp-theme"]:checked') || {}).value || 'dark',
      airway: bg.querySelector('#rp-airway').checked, png: bg.querySelector('#rp-png').checked, format: (bg.querySelector('input[name="rp-format"]:checked') || {}).value || 'pdf' };
    bg.remove();
    await generateReport(opts);
  });
  document.body.appendChild(bg);
}

/**
 * Ventana de PROGRESO (v0.8.6, petición de Manuel): los procesos largos (informe, segmentación, foto drapeada,
 * vía aérea) tardan 20-30 s en equipos modestos y parecía que el visor se había colgado. Devuelve
 * { text(msg), pct(0..100 | null), close() }. No tiene botones: se cierra sola al terminar.
 */
function busyModal(title) {
  const bg = document.createElement('div'); bg.className = 'modal-bg busy-bg';
  bg.innerHTML = `<div class="modal busy"><div class="spin"></div><div class="bt">${title}</div><div class="bs"></div><div class="bbar hidden"><i></i></div></div>`;
  bg.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(bg);
  const sub = bg.querySelector('.bs'), bar = bg.querySelector('.bbar'), fill = bg.querySelector('.bbar > i');
  return {
    text(msg) { sub.textContent = msg || ''; },
    pct(v) { bar.classList.toggle('hidden', v == null); if (v != null) fill.style.width = Math.max(0, Math.min(100, v)) + '%'; },
    close() { bg.remove(); },
  };
}

/** Espera a que Cornerstone pinte tras un cambio de disposición. */
const settle = (ms) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, ms))));

/** Recoge las medidas de todas las vistas para la tabla del informe. */
function reportMeasures() {
  const list = [], extra = [];
  const vpName = { vp3d: t('vp_3d'), vpAx: t('vp_axial'), vpCor: t('vp_coronal'), vpSag: t('vp_sagittal') };
  for (const m of V.getMeasures().v3d) list.push({ where: vpName.vp3d, type: m.type, value: m.label, color: m.color });
  for (const m of V.getMprMeasureValues()) list.push({ where: vpName[m.where] || m.where, type: m.type, value: m.value, color: m.color });
  if (V.state.pano) for (const m of V.getPanoMeas()) list.push({ where: t('rep_opt_pano'), type: m.type === 'ang' ? 'angle' : 'linear', value: measText(m, V.state.pano.image.step), color: m.color });
  if (V.state.tele) for (const [view, arr] of Object.entries(V.getAllTeleMeas())) { const img = V.state.tele.cache[view] && V.state.tele.cache[view].ray; for (const m of arr) list.push({ where: teleName(view), type: m.type === 'ang' ? 'angle' : 'linear', value: img ? measText(m, img.step) : '—', color: m.color }); }
  if (V.state.tmj) {
    const fam = { sag: t('atm_sag_c').split(' ')[0], cor: t('atm_cor'), axi: t('atm_axi') };
    for (const [key, arr] of Object.entries(V.getAllTmjMeas())) {
      const [side, family, off] = key.split('|');
      const it = (V.state.tmj.series[side] || []).find((x) => x.family === family && String(x.off) === off);
      const where = `${t('layout_atm')} ${t(side === 'R' ? 'atm_side_r' : 'atm_side_l').toLowerCase()} · ${it ? atmLabel(it) : `${fam[family] || family} ${off} mm`}`;
      for (const m of arr) list.push({ where, type: m.type === 'ang' ? 'angle' : 'linear', value: it ? measText(m, it.img.step) : '—', color: m.color });
    }
    for (const sd of ['R', 'L']) { const p = V.state.tmj.poles[sd]; if (p) extra.push([`${t('rep_condyle_axis')} · ${t(sd === 'R' ? 'atm_side_r' : 'atm_side_l')}`, Math.hypot(p.lat[0] - p.med[0], p.lat[1] - p.med[1], p.lat[2] - p.med[2]).toFixed(1) + ' mm']); }
  }
  const aw = V.airwayMesh();
  if (aw && aw.airway) { extra.push([t('aw_vol'), (aw.airway.volume_mm3 / 1000).toFixed(1) + ' cm³']); extra.push([t('aw_mca'), aw.airway.mca_mm2.toFixed(0) + ' mm²']); }
  return { list, extra };
}

/** Panorámica a alta resolución con sus medidas (canvas fuera de pantalla). */
function panoFigureUrl() {
  const pano = V.state.pano; if (!pano) return null;
  const cv = document.createElement('canvas');
  V.drawPanoramic(cv, pano.image, V.getPanoWindow(), Math.max(1, 1600 / pano.image.width));
  drawMeasures(cv, V.getPanoMeas(), pano.image.step, cv.width / 800);
  return cv.toDataURL('image/jpeg', 0.92);
}

/** Mosaico de ATM fuera de pantalla: por lado, 5 sagitales y (coronal, axial), con rótulos y medidas. */
function atmFigureUrl() {
  const tmj = V.state.tmj; if (!tmj) return null;
  const W = 340, pad = 8, lbl = 34, sideW = 46;
  const sides = ['R', 'L'].filter((sd) => tmj.series[sd]);
  const rows = sides.length * 2;
  const H = Math.round(W / tmj.aspect);
  const out = document.createElement('canvas'); out.width = sideW + 5 * (W + pad) + pad; out.height = rows * (H + lbl + pad) + pad;
  const g = out.getContext('2d'); g.fillStyle = '#0B0F1A'; g.fillRect(0, 0, out.width, out.height);
  let row = 0;
  for (const sd of sides) {
    const serie = tmj.series[sd];
    const lines = [serie.filter((x) => x.family === 'sag'), serie.filter((x) => x.family !== 'sag')];
    const y0 = pad + row * (H + lbl + pad);
    g.save(); g.translate(sideW / 2, y0 + (H + lbl + pad)); g.rotate(-Math.PI / 2); g.font = '800 30px Poppins, sans-serif'; g.fillStyle = '#22E0FF'; g.textAlign = 'center'; g.fillText(t(sd === 'R' ? 'atm_side_r' : 'atm_side_l'), 0, 0); g.restore();
    lines.forEach((items, li) => {
      items.forEach((it, i) => {
        const x = sideW + pad + i * (W + pad), y = y0 + li * (H + lbl + pad);
        const cv = document.createElement('canvas');
        V.drawTmjSlice(cv, it.img, tmj.win, Math.max(1, W / it.img.w));
        drawMeasures(cv, V.getTmjMeas(sd, it.family, it.off), it.img.step, cv.width / 400);
        const k = Math.min(W / cv.width, H / cv.height), dw = cv.width * k, dh = cv.height * k;
        g.fillStyle = '#000'; g.fillRect(x, y + lbl, W, H);
        g.drawImage(cv, x + (W - dw) / 2, y + lbl + (H - dh) / 2, dw, dh);
        g.font = '600 20px Poppins, sans-serif'; g.fillStyle = '#e6edf3'; g.textAlign = 'left'; g.fillText(atmLabel(it), x + 2, y + lbl - 9);
      });
    });
    row += 2;
  }
  return out.toDataURL('image/jpeg', 0.9);
}

/**
 * Página de VÍA AÉREA del informe (v0.8.5, petición de Manuel): vista lateral con cráneo, escáneres y piel al 40 % de
 * opacidad (60 % de transparencia) y la vía aérea opaca con su mapa de calor; valores, norma adulta por sexo,
 * desviación y referencia. Devuelve { url, rows, notes, ref, legend } y deja el visor como estaba.
 */
async function airwayReportSection(opts) {
  const aw = V.airwayMesh(); if (!aw || !aw.airway) return null;
  const a = aw.airway;
  const prev = { layout, vol: V.state.render.visible, opacity: V.state.render.opacity, heat: aw.heat !== false, meshes: V.getMeshes().map((m) => [m.id, m.visible, m.opacity]) };
  let url = null;
  try {
    if (layout !== 'vp3d') applyLayout('vp3d');
    const skull = V.getMeshes().find((m) => m.seg && m.role === 'skull');
    for (const m of V.getMeshes()) {
      if (m.role === 'airway') { V.setMeshVisible(m.id, true); V.setMeshOpacity(m.id, 1); if (!m.heat) V.setAirwayHeat(m.id, true); }
      else if (m.role === 'soft') V.setMeshVisible(m.id, false);       // v0.8.6: la piel tapa la vía aérea en la captura
      else { V.setMeshVisible(m.id, true); V.setMeshOpacity(m.id, 0.4); }
    }
    // sin cráneo segmentado, el hueso lo pone el volumen (también al 40 %); con cráneo, el volumen sobra
    V.setVolumeVisible(!skull); if (!skull) V.setOpacity(0.4);
    V.setView('lat_r'); V.reset3D(); await settle(900);
    url = opts.png ? await V.shot3DAlpha(1400) : null;
    if (!url) { const u = await shotDomAsync($('.vp[data-id="vp3d"]'), false); if (u) url = await toJpeg(u, 0.88); }
  } catch (e) { console.warn('vía aérea en el informe', e); }
  // se deja todo como estaba
  for (const [id, vis, op] of prev.meshes) { V.setMeshVisible(id, vis); V.setMeshOpacity(id, op); }
  if (aw.heat !== prev.heat) V.setAirwayHeat(aw.id, prev.heat);
  V.setVolumeVisible(prev.vol); V.setOpacity(prev.opacity); $('#dicom-vis').checked = !!prev.vol; syncRenderControls();
  // tabla como la de la tarjeta (norma adulta por sexo; sin norma en pediatría o sin sexo)
  const sex = current && current.sex, age = patientAge();
  const pediatric = age != null && age < 18;
  const rows = [];
  for (const [label, val, which, unit, dec] of [[t('aw_vol'), a.volume_mm3 / 1000, 'vol', 'cm³', 1], [t('aw_mca'), a.mca_mm2, 'mca', 'mm²', 0]]) {
    const norm = V.airwayNorm(which, sex);
    let normTxt = t('aw_no_norm'), devTxt = t('aw_no_norm'), cls = null;
    if (norm && !pediatric) {
      const [mean, sd] = norm; const dev = val - mean, z = sd ? dev / sd : 0;
      normTxt = `${mean.toFixed(dec)} ± ${sd.toFixed(dec)} ${unit}`;
      devTxt = `${dev >= 0 ? '+' : ''}${dev.toFixed(1)} ${unit} (${z >= 0 ? '+' : ''}${z.toFixed(1)} DE)`;
      cls = V.airwayClassify(val, which, sex);
    }
    rows.push({ label, value: `${val.toFixed(dec)} ${unit}`, norm: normTxt, dev: devTxt, cls });
  }
  const notes = pediatric ? t('aw_pediatric', { a: Math.floor(age) }) : (!V.airwayNorm('vol', sex) ? t('aw_no_sex') : '');
  const [lo, hi] = aw.heatRange || [a.mca_mm2, a.mca_mm2 * 3];
  const legend = { lo, hi, colors: Array.from({ length: 24 }, (_, i) => { const c = V.heatColorAt(i / 23); return [c[0], c[1], c[2]]; }) };
  return { url, rows, notes, ref: t('aw_ref'), legend, title: t('aw_values_title'), extent: `${t('rep_aw_extent')}: ${Math.abs(a.z_hi - a.z_lo).toFixed(0)} mm` };
}

/** Genera el informe: capturas (cambiando al 2×2 el tiempo justo), medidas, datos y observaciones → pestaña imprimible. */
async function generateReport(opts) {
  if (busy) return;
  busy = true;
  setStatus(t('st_rep_building'));
  const prog = busyModal(t('st_rep_title'));
  prog.text(t('st_rep_building'));
  const figures = [];
  const prevLayout = layout;
  const vp3 = V.getEngine().getViewport(V.VP.v3d);
  const cam0 = vp3 ? vp3.getCamera() : null;
  try {
    // v0.8.5: el render 3D va como PNG sin fondo (rp-png); los cortes, en JPEG
    const cap = async (id, title, wide) => {
      if (id === 'vp3d' && opts.png) { const png = await V.shot3DAlpha(1400); if (png) { figures.push({ title, url: png, wide, png: true }); return; } }
      const url = await shotDomAsync($(`.vp[data-id="${id}"]`), false); if (url) figures.push({ title, url: await toJpeg(url, 0.88), wide });
    };
    if (opts.v3d || opts.mpr) {
      if (layout !== 'quad') applyLayout('quad');
      await settle(900);
      prog.text(t('st_rep_shots'));
      if (opts.v3d) await cap('vp3d', t('vp_3d'));
      if (opts.mpr && current) {
        const sil = V.state.silhouettes;
        V.suspendCrosshairs(true); if (sil) V.setSilhouettes(false); await settle(150);   // ni cruz ni siluetas en el informe; las medidas (SVG) sí
        try { await cap('vpAx', t('vp_axial')); await cap('vpCor', t('vp_coronal')); await cap('vpSag', t('vp_sagittal')); } finally { V.suspendCrosshairs(false); if (sil) V.setSilhouettes(true); }
      }
    }
    // vistas AMPLIADAS del render (frontal, derecha, izquierda): con el 3D a pantalla completa (v0.8.2)
    if (opts.views) {
      if (layout !== 'vp3d') applyLayout('vp3d');
      await settle(700);
      for (const [v, key] of [['frontal', 'view_frontal'], ['lat_r', 'view_lat_r'], ['lat_l', 'view_lat_l']]) {
        V.setView(v); await settle(600);
        await cap('vp3d', `${t('vp_3d')} · ${t(key)}`, true);
      }
    }
    if (opts.pano && current) {
      // v0.8.4: se puede pedir aunque no se haya abierto la panorámica: se calcula aquí (curva automática)
      if (!V.state.pano) { prog.text(t('st_pan_building')); setStatus(t('st_pan_building')); try { await V.buildPano({ thickness: +$('#pan-thick').value, mip: $('#pan-mip').checked }, alignStatus); } catch (e) { console.warn('panorámica para el informe', e); } setStatus(t('st_rep_building')); }
      const url = panoFigureUrl(); if (url) figures.push({ title: t('rep_opt_pano'), url, wide: true });
    }
    // TeleRx LATERAL y FRONTAL, en radiografía Y en MIP (v0.8.4; en v0.8.3 el MIP solo si se estaba viendo)
    if (opts.tele && current) {
      prog.text(t('st_rep_tele'));
      for (const v of ['lat', 'pa']) for (const m of ['ray', 'mip']) { const u = await teleFigureFor(v, m); if (u) figures.push({ title: `${teleName(v)} · ${t(m === 'ray' ? 'tele_ray' : 'tele_mip')}`, url: u, wide: true }); }
    }
    if (opts.atm && V.state.tmj) { const url = atmFigureUrl(); if (url) figures.push({ title: t('rep_opt_atm'), url, wide: true }); }
    if (opts.airway) prog.text(t('rep_opt_airway'));
    const airway = opts.airway && V.airwayMesh() && V.airwayMesh().airway ? await airwayReportSection(opts) : null;
    if (layout !== prevLayout) { applyLayout(prevLayout); await settle(300); }
    if (cam0 && vp3) { try { vp3.setCamera(cam0); vp3.render(); } catch (e) { /* nada */ } }
    const s = current;
    const yrs = patientAge();
    const patient = opts.patient && s ? [[t('rep_patient'), s.patient || '—'], [t('pat_sex'), s.sex || '—'], [t('pat_birth'), s.birth ? fmtDate(s.birth) + (yrs != null && yrs > 0 && yrs < 120 ? ` (${t('age_years', { n: Math.floor(yrs) })})` : '') : '—']] : null;
    const series = s ? [[t('rep_study_date'), s.date ? fmtDate(s.date) : '—'], [t('rep_series'), `${s.desc || s.modality || 'CBCT'} · ${s.count} ${t('slices')} · ${s.cols}×${s.rows}`],
      [t('rep_voxel'), s.spacing ? `${(+s.spacing[0]).toFixed(2)} × ${(+s.spacing[1]).toFixed(2)} × ${(+s.dz).toFixed(2)} mm` : '—']] : [[t('rep_series'), t('rep_no_volume')]];
    const meas = opts.meas ? reportMeasures() : { list: [], extra: [] };
    let logo = null;
    const dark = opts.theme === 'dark';
    try { logo = await toJpeg(new URL(dark ? './img/logo_main_dark.png' : './img/logo_main_light.png', document.baseURI).href, 0.92, dark ? '#0B0F1A' : '#fff'); } catch (e) { /* sin logotipo */ }
    const now = new Date();
    const when = now.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const data = { patient, series, figures, measures: meas.list, extra: meas.extra, notes: opts.notes, logo, when, theme: dark ? 'dark' : 'light', airway };
    const who = (s && s.patient && opts.patient ? s.patient : 'caso').replace(/[^\w\-]+/g, '_').slice(0, 30);
    const stem = `tresD_informe_${who}_${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
    if (opts.format !== 'pptx') { prog.text(t('st_rep_pdf')); const doc = buildReportPdf(data); doc.save(stem + '.pdf'); }
    if (opts.format === 'pptx' || opts.format === 'both') {
      // v0.8.6: dos descargas seguidas las bloquea el navegador («descargar varios archivos»): se separan en el
      // tiempo y el .pptx se descarga con el MISMO método que la sesión y el paquete (Blob + enlace)
      if (opts.format === 'both') await new Promise((r) => setTimeout(r, 1200));
      prog.text(t('st_rep_pptx')); setStatus(t('st_rep_pptx'));
      const { buildReportPptx } = await import('./ui/reportPptx.js');
      const blob = await buildReportPptx(data);
      download(blob, stem + '.pptx');
    }
    setStatus(t('st_rep_done'));
    countEvent('informe');
  } catch (e) { console.error(e); setStatus(t('st_error', { msg: e.message || e })); if (layout !== prevLayout) applyLayout(prevLayout); }
  prog.close();
  busy = false;
}

// ------------------------------------------------------------------ SESIÓN .tresd (v0.8.0)
// JSON con todo lo que el usuario ha hecho sobre el CBCT (render, ventanas, medidas, panorámica, polos de
// ATM, vía aérea, segmentación, colocación de los escáneres, datos editados del paciente). Los DICOM, los
// escáneres y la foto NO van dentro (privacidad y tamaño): al abrir la sesión hay que volver a cargar el CBCT
// (y los escáneres, que se colocan solos donde estaban).
let pendingSession = null;      // sesión leída antes de tener el CBCT: se aplica al cargarlo
let pendingMeshes = {};         // escáneres de la sesión pendientes de reimportar: nombre → { role, M, … }

function buildSession() {
  const s = current;
  const aw = V.airwayMesh();
  const tmj = V.state.tmj, pano = V.state.pano;
  const meshes = V.getMeshes().filter((m) => !m.seg && m.role !== 'airway');
  const seg = V.getMeshes().filter((m) => m.seg && m.role !== 'airway');
  return {
    app: 'tresD DICOM', format: 1, version: VERSION, saved: new Date().toISOString(),
    series: s ? { key: s.key, desc: s.desc || '', count: s.count, rows: s.rows, cols: s.cols } : null,
    patient: s ? { patient: s.patient || '', sex: s.sex || '', birth: s.birth || '' } : null,
    chipHidden, layout,
    render: { ...V.state.render }, mprWindow: V.getMprWindow(), cut: { ...V.state.cut }, silhouettes: V.state.silhouettes, showArch: V.state.showArch,
    measures: { v3d: V.getMeasures3D(), mpr: V.getMprAnnotations() },
    pano: pano ? { control: V.getPanoControl(), z: pano.curve.z, thickness: pano.thickness, mip: pano.mip, win: V.getPanoWindow(), meas: V.getPanoMeas() } : null,
    tele: V.state.tele && V.state.tele.image ? { view: V.state.tele.view, mode: V.state.tele.mode, tilt: V.state.tele.tilt, win: V.getTeleWindows(), meas: V.getAllTeleMeas() } : null,
    tmj: tmj ? { poles: Object.fromEntries(['R', 'L'].filter((sd) => tmj.poles[sd]).map((sd) => [sd, { med: tmj.poles[sd].med, lat: tmj.poles[sd].lat }])), shift: tmj.shift, meas: V.getAllTmjMeas(), win: V.getTmjWindow(), aspect: tmj.aspect, midX: tmj.midX } : null,
    airway: aw && aw.airway ? { sup: aw.airway.sup, inf: aw.airway.inf, visible: aw.visible, opacity: aw.opacity, heat: aw.heat !== false } : null,
    seg: seg.length ? Object.fromEntries(seg.map((m) => [m.role, { visible: m.visible, opacity: m.opacity, color: m.color }])) : null,
    meshes: meshes.map((m) => ({ name: m.name, role: m.role, M: m.M ? Array.from(m.M) : null, align: m.align || null, color: m.color, opacity: m.opacity, visible: m.visible, scale: m.scale || 1 })),
    photo: V.drapeExport(),      // v0.8.4: recorte de la cara + pose: se vuelve a proyectar sobre la piel al abrir
    orient: V.getOrient(),       // v0.8.6: cómo se ha enderezado la cabeza
  };
}
function saveSession() {
  if (!V.hasCase()) return;
  const data = buildSession();
  const who = (current && current.patient ? current.patient : 'caso').replace(/[^\w\-]+/g, '_').slice(0, 30);
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `tresD_${who}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.tresd`);
  setStatus(t('st_sess_saved'));
}
// ------------------------------------------------------------------ COMPARTIR CASO (.tresdz, v0.8.3)
/** Ventana: anonimizar (por defecto sí), resolución reducida (por defecto sí), incluir escáneres. */
function shareDialog() {
  if (!current) return;
  const nMesh = V.getMeshes().filter((m) => !m.seg && m.role !== 'airway').length;
  const soft = V.softMesh(), hasPhoto = !!(soft && soft.drape);
  const dims = current ? [current.cols, current.rows, current.count] : [0, 0, 0];
  const mb = (f) => Math.round((dims[0] * dims[1] * dims[2] * 2) / (f * f * f) / 2 / 1e6);   // ≈ la mitad tras el ZIP
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  const chk = (id, key, on, dis, hint) => `<label class="chk"><input type="checkbox" id="${id}"${on ? ' checked' : ''}${dis ? ' disabled' : ''}><span>${t(key)}${hint ? ` <small class="muted">${hint}</small>` : ''}</span></label>`;
  bg.innerHTML = `<div class="modal share"><h3>${t('share_title')}</h3><div class="hint">${t('share_hint')}</div>
    <div class="rep-opts one">
      ${chk('sh-anon', 'share_anon', true, false, '')}
      ${chk('sh-reduce', 'share_reduce', true, false, `≈ ${mb(Math.cbrt(4))} MB`)}
      ${chk('sh-mesh', 'share_meshes', nMesh > 0, nMesh === 0, nMesh ? `(${nMesh})` : '')}
      ${chk('sh-photo', 'share_photo', false, !hasPhoto, '')}
    </div>
    <div class="hint small">${t('share_legal')}</div>
    <div class="mrow"><button class="btn-ghost" id="dlg-cancel">${t('dlg_cancel')}</button>
    <button class="btn-primary" style="width:auto;min-height:40px;padding:8px 22px" id="dlg-ok">${t('share_go')}</button></div></div>`;
  bg.querySelector('#dlg-cancel').addEventListener('click', () => bg.remove());
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  // la foto identifica al paciente: se propone solo cuando NO se anonimiza (y siempre se puede cambiar a mano)
  const anonBox = bg.querySelector('#sh-anon'), photoBox = bg.querySelector('#sh-photo');
  if (hasPhoto) { photoBox.checked = !anonBox.checked; anonBox.addEventListener('change', () => { photoBox.checked = !anonBox.checked; }); }
  bg.querySelector('#dlg-ok').addEventListener('click', async () => {
    const opts = { anonymize: anonBox.checked, reduce: bg.querySelector('#sh-reduce').checked, meshes: bg.querySelector('#sh-mesh').checked, photo: hasPhoto && photoBox.checked };
    bg.remove();
    await buildPackage(opts);
  });
  document.body.appendChild(bg);
}
/** Escribe el CBCT como DICOM (completo o reducido, anónimo o no), los escáneres como STL y la sesión, y lo comprime. */
async function buildPackage(opts) {
  if (busy) return;
  busy = true;
  try {
    const src = V.exportSource(); if (!src) return;
    setStatus(t('st_share_dicom', { p: 0 })); setProgress(0);
    const { files } = await volumeToDicom({ ...src, reduce: opts.reduce, anonymize: opts.anonymize, onProgress: (p) => { setStatus(t('st_share_dicom', { p: Math.round(p * 100) })); setProgress(Math.round(p * 100)); } });
    const entries = { ...files };
    const sess = buildSession();
    if (opts.anonymize) { sess.patient = null; sess.chipHidden = false; }
    sess.series = null;                                     // la serie del paquete tiene otro UID: sin aviso de «otra serie»
    sess.meshes = [];
    if (opts.meshes) {
      for (const m of V.getMeshes().filter((x) => !x.seg && x.role !== 'airway')) {
        // con color por vértice (escáner PLY/OBJ con textura) va como PLY, que lo conserva (v0.8.4); si no, STL
        const ply = V.meshPLY(m.id), stl = ply ? null : V.meshSTL(m.id); if (!ply && !stl) continue;
        entries[`escaneres/${m.name}.${ply ? 'ply' : 'stl'}`] = new Uint8Array((ply || stl).buf);
        // ya va en su sitio: matriz identidad y sin reorientar al importarlo
        sess.meshes.push({ name: m.name, role: m.role, M: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], align: m.align || null, color: m.color, opacity: m.opacity, visible: m.visible, scale: 1 });
      }
    }
    // a resolución reducida cambian los píxeles de los cortes de ATM y de la telerx: esas medidas (en píxeles) no valen
    if (opts.reduce) { if (sess.tmj) sess.tmj.meas = {}; if (sess.tele) sess.tele.meas = { lat: [], pa: [] }; }
    if (!opts.photo) sess.photo = null;                     // la foto drapeada solo si se pide (v0.8.4)
    sess.orient = null;                                     // v0.8.6: el DICOM del paquete ya sale enderezado
    sess.packaged = { reduced: !!opts.reduce, anonymized: !!opts.anonymize, photo: !!opts.photo };
    entries['sesion.tresd'] = new TextEncoder().encode(JSON.stringify(sess));
    setStatus(t('st_share_zip')); setProgress(null);
    await new Promise((r) => setTimeout(r, 30));
    const out = await zipEntries(entries, 6);
    const who = opts.anonymize ? 'anonimo' : (current.patient || 'caso').replace(/[^\w\-]+/g, '_').slice(0, 30);
    download(new Blob([out], { type: 'application/zip' }), `tresD_caso_${who}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.tresdz`);
    setStatus(t('st_share_done', { mb: (out.length / 1e6).toFixed(1) }));
    countEvent('compartir');
  } catch (e) { console.error(e); setStatus(t('st_error', { msg: e.message || e })); }
  setProgress(null);
  busy = false;
}

async function loadSessionFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { setStatus(t('st_sess_bad')); return; }
  if (!data || data.app !== 'tresD DICOM' || !data.format) { setStatus(t('st_sess_bad')); return; }
  if (!current) { pendingSession = data; setStatus(t('st_sess_need_dicom', { n: data.series && data.series.desc ? data.series.desc : 'CBCT' })); return; }
  await applySession(data);
}
/** Aplica una sesión sobre el CBCT cargado. Los pasos lentos (segmentación, vía aérea, panorámica, ATM) avisan en la barra de estado. */
async function applySession(d) {
  if (!current) return;
  if (busy) { setTimeout(() => applySession(d), 500); return; }
  busy = true;
  const warn = d.series && d.series.key && current.key !== d.series.key;
  // v0.8.4: cada bloque va por su cuenta: si uno falla (p. ej. la telerx) los demás (ATM, foto…) se restauran igual
  const errors = [];
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.error('sesión: ' + name, e); errors.push(name); } };
  try {
    setStatus(t('st_sess_loading'));
    if (d.patient) { current.patient = d.patient.patient || current.patient; current.sex = d.patient.sex ?? current.sex; current.birth = d.patient.birth || current.birth; updateSummaryPatient(current); }
    chipHidden = !!d.chipHidden; renderChip();
    // v0.8.6: la orientación va ANTES que nada (las mallas y las medidas de la sesión ya vienen en el marco girado)
    if (d.orient && (d.orient.x || d.orient.y || d.orient.z)) await step('orientación', () => { V.setOrient(d.orient, { volumeOnly: true }); syncOrientControls(); });
    await step('render', () => { if (d.render) { Object.assign(V.state.render, d.render); V.applyRender(); syncRenderControls(); $('#dicom-vis').checked = !!V.state.render.visible; } });
    await step('ventana', () => { if (d.mprWindow) V.setMprWindow(d.mprWindow); });
    if (typeof d.silhouettes === 'boolean') { $('#sil-vis').checked = d.silhouettes; V.setSilhouettes(d.silhouettes); }
    await step('medidas', () => { if (d.measures) { if (d.measures.v3d) V.setMeasures3D(d.measures.v3d); if (d.measures.mpr) V.setMprAnnotations(d.measures.mpr); } });
    if (d.seg && !V.softMesh()) {
      await step('segmentación', async () => {
        busy = false; const ok = await runSegmentation(); busy = true;
        if (ok) for (const m of V.getMeshes().filter((x) => x.seg && x.role !== 'airway')) { const sv = d.seg[m.role]; if (!sv) continue; if (sv.color) V.setMeshColor(m.id, sv.color); if (Number.isFinite(sv.opacity)) setCardOpacity(m.id, sv.opacity); if (sv.visible === false) V.setMeshVisible(m.id, false); }
        syncCards();
      });
    }
    // foto drapeada (v0.8.4): recorte + pose guardados → se proyecta sobre la piel recién segmentada
    if (d.photo && V.softMesh() && !V.softMesh().drape) {
      await step('foto', async () => {
        setStatus(t('st_photo_load'));
        const res = await V.drapeImport(d.photo);
        if (res) { refreshPhotoRow(); const soft = V.softMesh(); if (soft && d.seg && d.seg.soft && Number.isFinite(d.seg.soft.opacity)) setCardOpacity(soft.id, d.seg.soft.opacity); }
      });
    }
    if (d.airway && d.airway.sup && d.airway.inf && !V.airwayMesh()) {
      await step('vía aérea', async () => {
        setProgress(0);
        const item = await V.segmentAirway(d.airway.sup, d.airway.inf, (ph, p) => { awStatus(ph, p); if (ph === 'grid') setProgress(p); else setProgress(null); }, t('role_airway'));
        setProgress(null);
        if (item) { addMeshCard(item); syncCards(); if (Number.isFinite(d.airway.opacity)) setCardOpacity(item.id, d.airway.opacity); if (d.airway.visible === false) V.setMeshVisible(item.id, false); }
      });
    }
    if (d.pano && d.pano.control && d.pano.control.length >= 3) {
      await step('panorámica', async () => {
        setStatus(t('st_pan_building'));
        const curve = V.curveFromPoints(d.pano.control, d.pano.z);
        if (curve) {
          await V.buildPano({ curve, thickness: d.pano.thickness, mip: d.pano.mip }, alignStatus);
          if (d.pano.win) V.setPanoWindow(d.pano.win);
          V.setPanoMeas(d.pano.meas || []);
          $('#pan-thick').value = d.pano.thickness; $('#pan-thick-val').textContent = d.pano.thickness + ' mm'; $('#pan-mip').checked = !!d.pano.mip;
          $('#pan-curve').checked = !!d.showArch; V.setArchVisible(!!d.showArch);
        }
      });
    }
    if (d.tele && d.tele.view) {
      await step('telerx', async () => {
        await showTelerx({ view: d.tele.view, mode: d.tele.mode, tilt: +d.tele.tilt || 0, silent: true });
        V.setTeleWindows(d.tele.win); V.setAllTeleMeas(d.tele.meas);
        if (V.state.tele) drawTele();
      });
    }
    if (d.tmj && d.tmj.poles) {
      await step('ATM', async () => {
        setStatus(t('st_atm_slices', { s: '' }));
        await new Promise((r) => setTimeout(r, 20));
        const res = V.restoreTmj(d.tmj, Number.isFinite(d.tmj.aspect) ? null : atmCellAspect());   // con la proporción guardada las medidas (en píxeles) siguen valiendo
        if (res) { renderTmj(); }
      });
    }
    pendingMeshes = {};
    for (const m of d.meshes || []) if (m && m.name && m.M) pendingMeshes[m.name] = m;
    setHasCase();
    applyLayout(d.layout && d.layout !== 'panEdit' ? d.layout : 'quad');
    if (layout === 'vpAtm') fitTmjAspect();
    if (layout === 'vpPan' && V.state.pano) drawPan();
    if (layout === 'vpTele' && V.state.tele) drawTele();
    const missing = Object.keys(pendingMeshes);
    setStatus((warn ? t('st_sess_other_series') + ' ' : '') + (missing.length ? t('st_sess_meshes', { n: missing.join(', ') }) : t('st_sess_loaded')) + (errors.length ? ' ' + t('st_sess_partial', { n: errors.join(', ') }) : ''));
    countEvent('sesion');
  } catch (e) { console.error(e); setStatus(t('st_error', { msg: e.message || e })); }
  busy = false;
}

// ------------------------------------------------------------------ paneles replegables y letra
function loadPanels() { try { return Object.assign({ left: 'pinned', right: 'pinned' }, JSON.parse(localStorage.getItem(PANELS_KEY) || '{}')); } catch (e) { return { left: 'pinned', right: 'pinned' }; } }
let panels = { left: 'pinned', right: 'pinned' };
function applyPanels(p) {
  panels = p;
  for (const side of ['left', 'right']) {
    const wrap = $('#wrap-' + side);
    const auto = p[side] === 'auto';
    wrap.classList.toggle('auto', auto);
    wrap.classList.remove('open');
    const btn = wrap.querySelector('.pin');
    if (btn) btn.textContent = auto ? '📌' : (side === 'left' ? '⟨' : '⟩');
  }
  try { localStorage.setItem(PANELS_KEY, JSON.stringify(p)); } catch (e) { /* nada */ }
  setTimeout(() => V.resize(), 50);
  setTimeout(() => V.resize(), 260);
}
/**
 * Pestaña con flecha de cada panel replegado (v0.7.14): un toque lo despliega y lo deja abierto (otro toque, o
 * tocar fuera, lo repliega); también vale arrastrarla hacia dentro / hacia fuera. En tabletas no hay ratón
 * que acercar al borde.
 */
function wirePanelTabs() {
  for (const side of ['left', 'right']) {
    const wrap = $('#wrap-' + side), hot = wrap.querySelector('.hot');
    const tab = document.createElement('button'); tab.className = 'tab'; tab.type = 'button'; tab.dataset.i18nTitle = 'pin_tab'; tab.title = t('pin_tab');
    hot.appendChild(tab);
    let pd = null;
    tab.addEventListener('pointerdown', (e) => { pd = { x: e.clientX, moved: false }; tab.classList.add('dragging'); try { tab.setPointerCapture(e.pointerId); } catch (err) { /* nada */ } e.preventDefault(); e.stopPropagation(); });
    tab.addEventListener('pointermove', (e) => {
      if (!pd) return;
      const inward = (e.clientX - pd.x) * (side === 'left' ? 1 : -1);
      if (inward > 30 && !wrap.classList.contains('open')) { wrap.classList.add('open'); pd.moved = true; }
      else if (inward < -12 && wrap.classList.contains('open')) { wrap.classList.remove('open'); pd.moved = true; }   // hacia el borde no hay más de 18 px
    });
    const end = () => { if (pd && !pd.moved) wrap.classList.toggle('open'); pd = null; tab.classList.remove('dragging'); };
    tab.addEventListener('pointerup', end); tab.addEventListener('pointercancel', () => { pd = null; tab.classList.remove('dragging'); });
    tab.addEventListener('click', (e) => e.stopPropagation());
  }
  // tocar fuera de un panel desplegado lo repliega
  document.addEventListener('pointerdown', (e) => {
    for (const side of ['left', 'right']) { const wrap = $('#wrap-' + side); if (wrap.classList.contains('open') && !wrap.contains(e.target)) wrap.classList.remove('open'); }
  }, true);
}
function togglePanel(side) {
  const next = Object.assign({}, panels);
  next[side] = panels[side] === 'auto' ? 'pinned' : 'auto';
  applyPanels(next);
}
function loadFontScale() { try { const v = parseFloat(localStorage.getItem(FONT_KEY)); return Number.isFinite(v) ? v : FONT_DEFAULT; } catch (e) { return FONT_DEFAULT; } }
function applyFontScale(f) {
  document.documentElement.style.setProperty('--fs', String(f));
  try { localStorage.setItem(FONT_KEY, String(f)); } catch (e) { /* nada */ }
  setTimeout(() => V.resize(), 50);
}
function fontMenu(anchor) {
  const old = $('.menu'); if (old) { old.remove(); return; }
  const m = document.createElement('div'); m.className = 'menu';
  const cur = loadFontScale();
  for (const [key, f] of FONT_SIZES) {
    const b = document.createElement('button');
    b.textContent = (Math.abs(f - cur) < 0.01 ? '✓ ' : '') + t(key);
    b.addEventListener('click', () => { applyFontScale(f); m.remove(); });
    m.appendChild(b);
  }
  const r = anchor.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  document.body.appendChild(m);
  const close = (e) => { if (!m.contains(e.target) && e.target !== anchor) { m.remove(); document.removeEventListener('pointerdown', close); } };
  setTimeout(() => document.addEventListener('pointerdown', close), 0);
}

// ------------------------------------------------------------------ estado
function setStatus(msg) { const el = $('#status-text'); if (el) el.textContent = msg; }
const statusText = () => { const el = $('#status-text'); return el ? el.textContent : ''; };
function setProgress(p) {
  const box = $('#progress');
  if (p == null) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden'); box.firstElementChild.style.width = Math.max(0, Math.min(100, p)) + '%';
}

/** Muestra u oculta la interfaz del caso. Con solo escáneres (sin CBCT) únicamente tiene sentido el visor 3D. */
function setHasCase() {
  const vol = !!current, has = V.hasCase();
  for (const sel of ['#btn-shot', '#view-bar', '#wrap-right', '#g-tools', '#btn-undo', '#btn-redo', '#btn-new', '#btn-report', '#btn-save', '#btn-share']) $(sel).classList.toggle('hidden', !has);
  for (const sel of ['#patient-chip', '#btn-patient-edit', '#btn-meta', '#vispanel .card.dicom', '#mpr-card']) $(sel).classList.toggle('hidden', !vol);
  $('#btn-cross').classList.toggle('hidden', !vol || !CROSS_LAYOUTS.includes(layout));   // v0.8.3: solo con cortes MPR a la vista
  $('#grid').classList.toggle('hidden', !has);
  $('#main-drop').classList.toggle('hidden', has);
  $$('#view-bar [data-layout]').forEach((b) => { b.disabled = !vol && b.dataset.layout !== 'vp3d'; });
  $$('.vpmax').forEach((b) => { b.disabled = !vol; });
  // botones de subida: el del CBCT se oculta con un CBCT cargado; el de escáner, con las dos arcadas
  // (2 escáneres). Reaparecen al quitarlos con ✕.
  $('#g1').classList.toggle('hidden', vol);
  $('#g2').classList.toggle('hidden', V.getMeshes().filter((m) => !m.seg).length >= 2);
  $('#btn-orient').classList.toggle('hidden', !vol);
  if (!vol) { $('#orient-box').classList.add('hidden'); $('#btn-orient').setAttribute('aria-pressed', 'false'); for (const ax of ['x', 'y', 'z']) { const el = $(`#or-${ax}`); if (el) el.value = 0; } syncOrientLabels(); }
  refreshImportGroups();
  $('#btn-export').classList.toggle('hidden', !V.getMeshes().length);
  $('#lay-atm').classList.toggle('hidden', !V.state.tmj);
  $$('#mesh-cards .m-align, #mesh-cards .m-points').forEach((b) => b.classList.toggle('hidden', !vol || b.closest('.card').dataset.seg === '1'));
  refreshHistoryButtons();
  if (has) applyLayout(vol ? layout : 'vp3d', vol);
}

/** Botones del grupo «3 · Piel y foto facial» (cada uno se oculta con su registro hecho) y títulos del panel (v0.8.4). */
function refreshImportGroups() {
  const vol = !!current, soft = V.softMesh();
  $('#btn-seg').classList.toggle('hidden', !!soft);
  $('#btn-photo').classList.toggle('hidden', !!(soft && soft.drape));
  $('#btn-airway').classList.toggle('hidden', !!V.airwayMesh());
  $('#btn-atm').classList.toggle('hidden', !vol || !!V.state.tmj);        // con los cortes ya calculados sobra el botón
  // con piel y foto ya subidas sobra el título «3 · Piel y foto facial»; sin ningún botón, la caja entera;
  // y sin nada que importar (CBCT, escáneres, piel, foto), el título «Importar»
  const g3Done = !!soft && !!soft.drape;
  $('#g3 .gtitle').classList.toggle('hidden', g3Done);
  $('#g3').classList.toggle('hidden', !vol || ['#btn-photo', '#btn-seg', '#btn-airway', '#btn-atm'].every((sel) => $(sel).classList.contains('hidden')));
  $('#side .phead .h1').classList.toggle('hidden', vol && $('#g2').classList.contains('hidden') && g3Done);
}

// ------------------------------------------------------------------ deshacer / rehacer
function refreshHistoryButtons() {
  const H = V.history;
  $('#btn-undo').disabled = !H.canUndo; $('#btn-redo').disabled = !H.canRedo;
  const label = (e) => (e ? t('h_' + e.label, { name: e.name || '' }) : '');
  $('#btn-undo').title = t('undo_tip') + (H.canUndo ? ': ' + label(H.undoStack[H.undoStack.length - 1]) : '');
  $('#btn-redo').title = t('redo_tip') + (H.canRedo ? ': ' + label(H.redoStack[H.redoStack.length - 1]) : '');
}
async function doUndo() {
  if (busy) return;
  if (!V.history.canUndo) { setStatus(t('st_nothing_undo')); return; }
  if (manualPick) cancelManual();
  if (pointAlign) cancelPointAlign(true);
  if (airwayPick) cancelAirway(true);
  busy = true;
  try { const e = await V.history.undo(); afterHistory(); setStatus(t('st_undone', { a: t('h_' + e.label, { name: e.name || '' }) })); }
  catch (err) { console.error(err); }
  busy = false;
}
async function doRedo() {
  if (busy) return;
  if (!V.history.canRedo) { setStatus(t('st_nothing_redo')); return; }
  busy = true;
  try { const e = await V.history.redo(); afterHistory(); setStatus(t('st_redone', { a: t('h_' + e.label, { name: e.name || '' }) })); }
  catch (err) { console.error(err); }
  busy = false;
}
/** Tras deshacer / rehacer: tarjetas, controles del DICOM, corte y botones al día. */
function afterHistory() {
  syncCards();
  renderTmj();
  if (current) syncRenderControls();
  syncCutUI();
  $('#sil-vis').checked = V.state.silhouettes;
  setHasCase();
}

/** Tarjetas del panel derecho = mallas del visor (añade las que faltan, quita las sobrantes, refresca valores). */
function syncCards() {
  const items = V.getMeshes();
  const ids = new Set(items.map((m) => m.id));
  $$('#mesh-cards .card').forEach((c) => { if (!ids.has(c.dataset.mesh)) c.remove(); });
  const box = $('#mesh-cards');
  for (const it of items) {
    const card = addMeshCard(it);
    box.appendChild(card);                         // en el orden del visor
    card.querySelector('.m-vis').checked = !!it.visible;
    card.querySelector('.m-op').value = Math.round(it.opacity * 100);
    card.querySelector('.m-color').value = it.color;
    const uc = card.querySelector('.m-usecol'); if (uc) uc.checked = !!it.useColors;
    const heat = card.querySelector('.m-heat-on'); if (heat) heat.checked = !!it.heat;
    fillAirwayValues(card, it);
  }
  refreshPhotoRow();
}

/** Casillas de corte = estado del visor (tras deshacer). */
function syncCutUI() {
  const c = V.state.cut;
  for (const ax of ['x', 'y', 'z']) $(`#cut-${ax}`).checked = c.axis === ax;
  $('#cut-flip').checked = !!c.flip; $('#cut-flip').disabled = !c.axis;
  $('#cut-slider').value = Math.round((c.frac ?? 0.5) * 100); $('#cut-slider').disabled = !c.axis;
}

/** Estado durante la alineación escáner→CBCT (fases de viewer.alignMesh). */
function alignStatus(phase, i, n) {
  if (phase === 'teeth') setStatus(t('st_align_teeth', { p: i }));
  else if (phase === 'cand') setStatus(t('st_align_cand', { i, n }));
  else if (phase === 'fine') setStatus(t('st_align_fine'));
  else if (phase === 'retry') setStatus(t('st_align_retry', { i, n }));
}
function alignText(a) {
  if (!a) return '';
  if (a.none) return t('st_align_none');
  if (a.failed) return t('st_align_failed');
  const v = { e: a.err.toFixed(2), c: Math.round(100 * a.cov) };
  return t(a.err <= 0.8 ? 'st_align_ok' : 'st_align_doubt', v);
}

// ------------------------------------------------------------------ carga
async function ingest(entries) {
  if (busy) return;
  busy = true;
  try {
    setProgress(0);
    setStatus(t('st_reading', { n: entries.length }));
    entries = await expandZips(entries, (k) => setStatus(t(k === 'unrar' ? 'st_unrar' : 'st_unzip')));
    const sessEntries = entries.filter((e) => isSessionName(e.path));
    const meshEntries = entries.filter((e) => isMeshName(e.path));
    const photoEntries = entries.filter((e) => isPhotoName(e.path));
    const rest = entries.filter((e) => !isMeshName(e.path) && !isPhotoName(e.path) && !isSessionName(e.path));
    if (rest.length) await ingestDicom(rest, meshEntries.length === 0 && photoEntries.length === 0);
    // la sesión va ANTES de los escáneres (v0.8.3): en un paquete .tresdz ya dice dónde va cada uno
    if (sessEntries.length) { busy = false; await loadSessionFile(sessEntries[0].file); busy = true; }
    if (meshEntries.length) await ingestMeshes(meshEntries);
    if (photoEntries.length) await ingestPhoto(photoEntries[0].file);
  } catch (e) {
    if (e && e.archive) setStatus(t('st_archive_other', { k: e.archive.toUpperCase(), n: String(e.message).split(':').pop() }));   // RAR / 7z: aviso, no error
    else { console.error(e); setStatus(t('st_error', { msg: e.message || e })); }
    setProgress(null);
  }
  busy = false;
}

async function ingestDicom(entries, reportEmpty) {
  const { series } = await scanDicom(entries, (i, n) => { setStatus(t('st_headers', { i, n })); setProgress((100 * i) / n); });
  if (!series.length) {
    // v0.8.5: se dice QUÉ se ha leído (para saber si el ZIP traía otra cosa)
    const names = entries.slice(0, 3).map((e) => e.path.split('/').pop()).join(', ');
    console.info('tresD: sin series DICOM entre', entries.length, 'archivos', entries.slice(0, 20).map((e) => e.path));
    if (reportEmpty) setStatus((entries.length ? t('st_no_series') : t('st_no_dicom')) + (entries.length ? ' ' + t('st_files_seen', { n: entries.length, ex: names }) : ''));
    setProgress(null); return;
  }
  seriesList = series;
  renderSeriesList();
  let pick = series[0];
  if (series.length > 1) {
    pick = await chooseSeriesDialog(series);
    if (!pick) { setStatus(t('st_ready')); setProgress(null); return; }
  }
  await openSeries(pick);
}

// ------------------------------------------------------------------ escáneres intraorales (Fase 2)
async function ingestMeshes(entries) {
  // la arcada SUPERIOR se importa (y alinea) primero; la inferior la sigue (misma oclusión)
  const rank = (e) => ({ upper: 0, other: 1, lower: 2 }[guessRole(e.file.name)] ?? 1);
  entries = [...entries].sort((a, b) => rank(a) - rank(b));
  let added = 0;
  for (const e of entries) {
    setStatus(t('st_mesh_reading', { name: e.file.name })); setProgress(null);
    let mesh;
    try { mesh = await readMesh(e.file); } catch (err) { console.error(err); setStatus(t('st_mesh_error', { name: e.file.name, msg: err.message || err })); continue; }
    // sesión restaurada (.tresd): si el escáner estaba en ella se coloca donde estaba, sin preguntar ni alinear
    const saved = pendingMeshes[mesh.name.replace(/\.[^.]+$/, '')];
    const opts = saved ? { role: saved.role, autoOrient: false, scale: saved.scale || 1 } : await meshDialog(mesh);
    if (!opts) { setStatus(t('st_ready')); continue; }
    setStatus(t('st_mesh_orienting', { name: mesh.name }));
    await new Promise((r) => setTimeout(r, 30));                 // deja pintar el estado antes del cálculo
    let item;
    try { item = await V.addMesh(mesh, { ...opts, onStatus: alignStatus }); } catch (err) { console.error(err); setStatus(t('st_mesh_error', { name: mesh.name, msg: err.message || err })); continue; }
    item.scale = opts.scale || 1;
    if (saved) {
      V.applyMeshMatrix(item.id, saved.M, saved.align);
      if (saved.color) V.setMeshColor(item.id, saved.color);
      if (Number.isFinite(saved.opacity)) V.setMeshOpacity(item.id, saved.opacity);
      if (saved.visible === false) V.setMeshVisible(item.id, false);
      delete pendingMeshes[mesh.name.replace(/\.[^.]+$/, '')];
    }
    const hadCase = $('#grid').classList.contains('hidden') === false;
    addMeshCard(item);
    setHasCase();
    if (!hadCase) resetCutUI();
    V.resize();
    setStatus(saved ? t('st_sess_mesh_placed', { name: item.name }) : meshSummary(item));
    countEvent('escaner');
    added++;
  }
  // v0.8.5 (petición de Manuel): al importar un escáner se ACTIVA la vista del render: si el visor 3D no estaba a la
  // vista (un corte, la panorámica, la ATM…) se pasa al 3D a solas, y si el volumen estaba apagado se enciende
  if (added && current) {
    if (!vpShown('vp3d')) applyLayout('vp3d');
    if (!V.state.render.visible) { V.setVolumeVisible(true); $('#dicom-vis').checked = true; }
  }
}

function meshDialog(mesh) {
  return new Promise((resolve) => {
    const role0 = guessRole(mesh.name), sc = mesh.scale;
    const size = mesh.size.map((v) => (v * (sc.factor || 1)).toFixed(0)).join(' × ') + ' mm';
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal"><h3>${t('dlg_mesh_title')}</h3>
      <div class="hint"><b>${esc(mesh.name)}</b> · ${mesh.nTri.toLocaleString()} ${t('triangles')} · ${size}</div>
      ${sc.factor !== 1 ? `<label class="chk"><input type="checkbox" id="dm-scale" checked><span>${t('dlg_mesh_scale', { unit: sc.unit, f: sc.factor })}</span></label>` : ''}
      ${sc.odd ? `<div class="hint warn">${t('dlg_mesh_odd', { d: mesh.diag.toFixed(1) })}</div>` : ''}
      ${mesh.warnings.map((w) => `<div class="hint warn">${esc(warnText(w))}</div>`).join('')}
      <div class="hint">${t('dlg_mesh_role')}</div>
      <div class="roles">
        ${['upper', 'lower', 'other'].map((r) => `<label class="chk"><input type="radio" name="dm-role" value="${r}"${r === role0 ? ' checked' : ''}><span>${t('role_' + r)}</span></label>`).join('')}
      </div>
      <label class="chk"><input type="checkbox" id="dm-orient" checked><span>${t('dlg_mesh_orient')}</span></label>
      <div class="mrow"><button class="btn-ghost" id="dlg-cancel">${t('dlg_cancel')}</button>
      <button class="btn-primary" style="width:auto;min-height:40px;padding:8px 22px" id="dlg-ok">${t('dlg_add')}</button></div></div>`;
    const done = (v) => { bg.remove(); resolve(v); };
    bg.querySelector('#dlg-cancel').addEventListener('click', () => done(null));
    bg.querySelector('#dlg-ok').addEventListener('click', () => {
      const scaleBox = bg.querySelector('#dm-scale');
      done({
        role: (bg.querySelector('input[name="dm-role"]:checked') || {}).value || 'other',
        autoOrient: bg.querySelector('#dm-orient').checked,
        scale: scaleBox && scaleBox.checked ? sc.factor : 1,
      });
    });
    document.body.appendChild(bg);
  });
}

/** Códigos de aviso ('islands_dropped|3|1.2', 'side|cusps|3|1'…) → texto en el idioma activo. */
function warnText(code) {
  const [k, ...a] = String(code).split('|');
  if (k === 'side') return t('w_side', { a: t('d_' + a[0], { a: a[1], b: a[2] }) });
  return t('w_' + k, { a: a[0], b: a[1] });
}

function meshSummary(item) {
  const parts = [t('st_mesh_added', { name: item.name, n: item.nTri.toLocaleString() })];
  const info = item.info;
  if (info) {
    if (info.inherited) parts.push(t('st_orient_inherit', { role: t('role_' + info.from).toLowerCase() }));
    else parts.push(t(info.ok ? 'st_orient_ok' : 'st_orient_doubt', { sym: info.sym.toFixed(2), u: info.corr.toFixed(2) }));
    for (const w of info.warnings) parts.push(warnText(w));
    if (current && info.inherited && !info.master) parts.push(t('st_align_follow'));
    else if (current && item.align) parts.push(alignText(item.align));
  }
  for (const w of item.warnings || []) parts.push(warnText(w));
  return parts.join(' · ');
}

function addMeshCard(item) {
  const existing = $(`#mesh-cards .card[data-mesh="${item.id}"]`);
  if (existing) return existing;
  const card = meshCard(item);
  applyI18n(card);
  card.dataset.role = item.role; card.dataset.ntri = String(item.nTri); card.dataset.seg = item.seg ? '1' : '0';
  if (item.seg) card.querySelector('.m-tools').classList.add('hidden');
  // foto drapeada (solo la piel)
  const pv = card.querySelector('.m-photo-vis'); if (pv) pv.addEventListener('change', (e) => V.setDrapeVisible(e.target.checked));
  const pd = card.querySelector('.m-photo-del'); if (pd) pd.addEventListener('click', () => { V.clearDrape(); refreshPhotoRow(); setHasCase(); setStatus(t('st_photo_removed')); });
  // vía aérea: mapa de calor y valores (los valores se ocultan con la malla)
  if (item.role === 'airway') {
    card.querySelector('.m-heat').classList.remove('hidden');
    card.querySelector('.m-heat-on').addEventListener('change', (e) => {
      const on = e.target.checked, prev = !on;
      V.setAirwayHeat(item.id, on);
      V.history.record({ label: 'heat', undo: () => V.setAirwayHeat(item.id, prev), redo: () => V.setAirwayHeat(item.id, on) });
    });
    fillAirwayValues(card, item);
  }
  card.querySelector('.m-vis').addEventListener('change', (e) => {
    const on = e.target.checked;
    V.setMeshVisible(item.id, on);
    card.querySelector('.aw-values').classList.toggle('hidden', !on || item.role !== 'airway');
    V.history.record({ label: 'vis', name: item.name, undo: () => V.setMeshVisible(item.id, !on), redo: () => V.setMeshVisible(item.id, on) });
  });
  // transparencia / color: se apunta al SOLTAR (evento change) con el valor de antes de empezar a arrastrar
  const op = card.querySelector('.m-op'); let opStart = null;
  op.addEventListener('pointerdown', () => { opStart = item.opacity; });
  op.addEventListener('input', (e) => { if (opStart == null) opStart = item.opacity; V.setMeshOpacity(item.id, e.target.value / 100); });
  op.addEventListener('change', (e) => {
    const prev = opStart ?? item.opacity, next = e.target.value / 100; opStart = null;
    if (Math.abs(prev - next) > 1e-3) V.history.record({ label: 'opacity', name: item.name, undo: () => V.setMeshOpacity(item.id, prev), redo: () => V.setMeshOpacity(item.id, next) });
  });
  const colorIn = card.querySelector('.m-color'); let colStart = null;
  colorIn.addEventListener('input', (e) => {
    if (colStart == null) colStart = { color: item.color, useColors: item.useColors };
    V.setMeshColor(item.id, e.target.value);
    const uc = card.querySelector('.m-usecol'); if (uc && uc.checked) { uc.checked = false; V.setMeshUseColors(item.id, false); }
  });
  colorIn.addEventListener('change', (e) => {
    const prev = colStart || { color: item.color, useColors: item.useColors }, next = { color: e.target.value, useColors: false }; colStart = null;
    if (prev.color !== next.color) V.history.record({ label: 'color', name: item.name, undo: () => { V.setMeshColor(item.id, prev.color); V.setMeshUseColors(item.id, prev.useColors); }, redo: () => { V.setMeshColor(item.id, next.color); V.setMeshUseColors(item.id, false); } });
  });
  const uc = card.querySelector('.m-usecol');
  if (uc) uc.addEventListener('change', (e) => { const on = e.target.checked; V.setMeshUseColors(item.id, on); V.history.record({ label: 'color', name: item.name, undo: () => V.setMeshUseColors(item.id, !on), redo: () => V.setMeshUseColors(item.id, on) }); });
  card.querySelector('.m-flip').addEventListener('click', () => { V.flipMesh(item.id); setStatus(t('st_mesh_flipped', { name: item.name })); });
  card.querySelector('.m-align').classList.toggle('hidden', !current);
  card.querySelector('.m-points').classList.toggle('hidden', !current);
  card.querySelector('.m-points').addEventListener('click', () => startPointAlign(item));
  card.querySelector('.m-align').addEventListener('click', async () => {
    if (!current || busy) return;
    busy = true;
    // la SUPERIOR manda: si esta arcada es la inferior y tiene superior en su grupo, se alinea la superior y ella la sigue
    const master = item.role === 'lower' ? (V.getMeshes().find((m) => m.role === 'upper' && m.group === item.group) || item) : item;
    try { const a = await V.alignMesh(master.id, alignStatus); setStatus(master.name + ': ' + alignText(a) + (master !== item ? ' · ' + t('st_align_follow_lower', { name: item.name }) : '')); showRenderWithMeshes(); }
    catch (e) { console.error(e); setStatus(t('st_error', { msg: e.message || e })); }
    busy = false;
  });
  card.querySelector('.m-del').addEventListener('click', () => {
    if (manualPick) cancelManual();
    if (pointAlign) cancelPointAlign(true);
    if (airwayPick) cancelAirway(true);
    V.removeMesh(item.id); card.remove();
    setHasCase();
    if (!V.hasCase()) { clearInterval(rotTimer); rotTimer = null; $('#btn-rotate').setAttribute('aria-pressed', 'false'); }
    setStatus(t('st_ready'));
  });
  $('#mesh-cards').appendChild(card);
  return card;
}

/** Tabla de valores de la vía aérea en su tarjeta (volumen y MCA con norma adulta por sexo, como VOXEL). */
function fillAirwayValues(card, item) {
  const box = card.querySelector('.aw-values'); if (!box) return;
  if (item.role !== 'airway' || !item.airway) { box.classList.add('hidden'); return; }
  const a = item.airway;
  const sex = current && current.sex, age = patientAge();
  const pediatric = age != null && age < 18;
  const rows = [[t('aw_vol'), a.volume_mm3 / 1000, 'vol', 'cm³', 1], [t('aw_mca'), a.mca_mm2, 'mca', 'mm²', 0]];
  let html = `<div class="aw-title">${t('aw_values_title')}</div><table class="aw-table"><thead><tr><th>${t('aw_measure')}</th><th>${t('aw_value')}</th><th>${t('aw_norm')}</th><th>${t('aw_dev')}</th></tr></thead><tbody>`;
  for (const [label, val, which, unit, dec] of rows) {
    const norm = V.airwayNorm(which, sex);
    let normTxt = t('aw_no_norm'), devTxt = t('aw_no_norm'), cls = '';
    if (norm && !pediatric) {
      const [mean, sd] = norm; const dev = val - mean, z = sd ? dev / sd : 0;
      normTxt = `${mean.toFixed(dec)} ± ${sd.toFixed(dec)} ${unit}`;
      devTxt = `${dev >= 0 ? '+' : ''}${dev.toFixed(1)} ${unit} (${z >= 0 ? '+' : ''}${z.toFixed(1)} DE)`;
      cls = V.airwayClassify(val, which, sex) || '';
    }
    html += `<tr class="${cls}"><td>${label}</td><td><b>${val.toFixed(dec)} ${unit}</b></td><td>${normTxt}</td><td><b>${devTxt}</b></td></tr>`;
  }
  html += '</tbody></table>';
  if (pediatric) html += `<div class="aw-note warn">${t('aw_pediatric', { a: Math.floor(age) })}</div>`;
  else if (!V.airwayNorm('vol', sex)) html += `<div class="aw-note">${t('aw_no_sex')}</div>`;
  html += `<div class="aw-ref">${t('aw_ref')}</div>`;
  box.innerHTML = html;
  box.classList.toggle('hidden', !item.visible);
}
/** Edad del paciente (años) a partir de nacimiento y fecha del estudio del DICOM, o null. */
// marca de agua de las capturas: el logotipo principal «DICOM viewer» (decisión de Manuel), en la versión
// del TEMA activo: la de tema oscuro es clara y no se veía sobre las capturas de fondo claro (v0.7.8).
// Se cargan una vez y se reutilizan.
const wmImgs = {};
function watermark() {
  for (const k of ['dark', 'light']) if (!wmImgs[k]) { wmImgs[k] = new Image(); wmImgs[k].src = `./img/logo_main_${k}.png`; }
  return wmImgs[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];
}

// ---- chip del paciente: nombre · sexo · nacimiento (edad a la fecha del estudio, v0.7.5) · fecha del estudio.
//      Un clic lo OCULTA (docencia, capturas de pantalla) y otro lo vuelve a mostrar; el lápiz ✎ permite editar
//      nombre, sexo y nacimiento SOLO para esta sesión (el DICOM no se toca) (v0.7.15).
let chipHidden = false;
function renderChip() {
  const s = current, el = $('#patient-chip');
  if (!s) { el.textContent = ''; return; }
  el.classList.toggle('masked', chipHidden);
  if (chipHidden) { el.textContent = t('pat_hidden'); return; }
  const yrs = patientAge();
  const nac = s.birth ? fmtDate(s.birth) + (yrs != null && yrs > 0 && yrs < 120 ? ` (${t('age_years', { n: Math.floor(yrs) })})` : '') : '';
  const chip = [s.patient, s.sex ? s.sex : '', nac, s.date ? fmtDate(s.date) : ''].filter(Boolean).join(' · ');
  el.textContent = chip || (s.desc || '');
}
/**
 * «Nuevo caso» (v0.7.16): confirmación y RECARGA de la página. Es la forma más segura de dejar el visor como
 * al abrirlo (volumen, mallas, panorámica, ATM, vía aérea, historial, memoria gráfica); los ajustes del usuario
 * (tema, letra, idioma, paneles) viven en localStorage y se conservan. Nada sale del ordenador.
 */
function newCaseDialog() {
  if (!V.hasCase()) return;
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal"><h3>${t('new_dlg_title')}</h3><div class="hint">${t('new_dlg_hint')}</div>
    <div class="mrow"><button class="btn-ghost" id="dlg-cancel">${t('dlg_cancel')}</button>
    <button class="btn-primary" style="width:auto;min-height:40px;padding:8px 22px" id="dlg-ok">${t('new_dlg_ok')}</button></div></div>`;
  bg.querySelector('#dlg-cancel').addEventListener('click', () => bg.remove());
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  bg.querySelector('#dlg-ok').addEventListener('click', () => { setStatus(t('st_new_case')); location.reload(); });
  document.body.appendChild(bg);
}

function editPatientDialog() {
  const s = current; if (!s) return;
  const iso = (d) => { const m = String(d || '').match(/^(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; };
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal patient"><h3>${t('pat_dlg_title')}</h3><div class="hint">${t('pat_dlg_hint')}</div>
    <label class="frow"><span>${t('pat_name')}</span><input type="text" id="pe-name" maxlength="80" value="${esc(s.patient || '')}"></label>
    <label class="frow"><span>${t('pat_sex')}</span><select id="pe-sex">
      <option value="">—</option><option value="M">M · ${t('pat_sex_m')}</option><option value="F">F · ${t('pat_sex_f')}</option><option value="O">O · ${t('pat_sex_o')}</option></select></label>
    <label class="frow"><span>${t('pat_birth')}</span><input type="date" id="pe-birth" value="${iso(s.birth)}"></label>
    <div class="mrow"><button class="btn-ghost" id="dlg-cancel">${t('dlg_cancel')}</button>
    <button class="btn-primary" style="width:auto;min-height:40px;padding:8px 22px" id="dlg-ok">${t('dlg_save')}</button></div></div>`;
  const sexSel = bg.querySelector('#pe-sex'); sexSel.value = ['M', 'F', 'O'].includes(String(s.sex || '').toUpperCase()) ? String(s.sex).toUpperCase() : '';
  bg.querySelector('#dlg-cancel').addEventListener('click', () => bg.remove());
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  bg.querySelector('#dlg-ok').addEventListener('click', () => {
    s.patient = bg.querySelector('#pe-name').value.trim();
    s.sex = sexSel.value;
    const b = bg.querySelector('#pe-birth').value;              // AAAA-MM-DD → AAAAMMDD (formato DICOM)
    s.birth = b ? b.replace(/-/g, '') : '';
    bg.remove();
    chipHidden = false; renderChip();
    updateSummaryPatient(s);
    $$('.series-item').forEach((el) => { const sm = el.querySelector('small'); if (sm && el.dataset.key === s.key) sm.textContent = `${s.orientation} · ${s.count} ${t('slices')} · ${s.cols}×${s.rows}${s.patient ? ' · ' + s.patient : ''}`; });
    setStatus(t('st_pat_saved'));
  });
  document.body.appendChild(bg);
  bg.querySelector('#pe-name').focus();
}

function patientAge() {
  if (!current || !current.birth) return null;
  const p = (s) => { const m = String(s).match(/^(\d{4})(\d{2})(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const b = p(current.birth), d = (current.date && p(current.date)) || new Date();
  if (!b || !d) return null;
  return (d - b) / (365.25 * 24 * 3600 * 1000);
}

async function openSeries(s) {
  setProgress(0);
  setStatus(t('st_loading_vol', { p: 0 }));
  try {
    await V.loadSeries(s, (p) => { setProgress(p); setStatus(t('st_loading_vol', { p })); });
  } catch (e) {
    console.error(e);
    setStatus(t('st_error', { msg: e.message || e }));
    setProgress(null);
    return;
  }
  current = s;
  setProgress(null);
  setHasCase();
  $$('.series-item').forEach((b) => b.classList.toggle('sel', b.dataset.key === s.key));
  const sp = s.spacing ? (+s.spacing[0]).toFixed(2) : '?';
  setStatus(t('st_loaded', { desc: s.desc || s.modality, n: s.count, r: s.rows, c: s.cols, sp, dz: (+s.dz).toFixed(2) }));
  if (s.decimation > 1) {
    setStatus(t('st_big', { r: s.cols, c: s.rows, n: s.count, f: s.decimation, sp: (s.spacing ? +s.spacing[0] * s.decimation : 0).toFixed(2) }));
  }
  // la serie traía un tamaño de vóxel incoherente (cortes repetidos, huecos…) y se ha corregido
  const geo = V.state.geometry;
  if (geo && geo.fixed) setStatus(t('st_geo_fixed', { a: geo.from.map((v) => v.toFixed(2)).join('×'), b: geo.to.map((v) => v.toFixed(2)).join('×') }));
  // un bloque de cortes venía colocado al principio del volumen (la bóveda salía suelta por debajo)
  if (s.rotTail) setStatus(t('st_geo_block', { n: s.rotTail }));
  $('#lbl-import').textContent = (s.desc || s.modality) + ' · ' + s.count + ' ' + t('slices');
  countEvent('cbct');
  scheduleFeedback(fbBusy);           // valoración del software, pasados unos minutos de uso (v0.7.11)
  // escáneres ya cargados: alinearlos a las coronas del nuevo CBCT (un representante por oclusión)
  if (V.getMeshes().some((m) => m.oriented)) {
    const loaded = $('#status-text').textContent;
    const res = await V.alignAllMeshes(alignStatus);
    setStatus(loaded + ' · ' + res.map((r) => r.item.name + ': ' + alignText(r.align)).join(' · '));
  }
  chipHidden = false;
  renderChip();                        // chip de paciente (barra superior, como VOXEL)
  if (pendingSession) { const sess = pendingSession; pendingSession = null; setTimeout(() => applySession(sess), 300); }
  // deslizadores de corte (v0.8.2): arriba = superior (axial), anterior (coronal), izquierda del paciente (sagital)
  for (const [id, ax, sign] of [[V.VP.ax, 2, 1], [V.VP.cor, 1, -1], [V.VP.sag, 0, 1]]) { const n = V.viewPlaneNormal(id); const sl = $(`.vp[data-id="${id}"] .vslice`); if (n && sl) sl.style.direction = n[ax] * sign > 0 ? 'rtl' : 'ltr'; }
  // sincronizar controles del panel derecho con el estado del render
  syncRenderControls();
  resetCutUI();
  for (const ax of ['x', 'y', 'z']) { $(`#mpr-${ax}`).checked = false; $(`#mpr-${ax}-sl`).disabled = true; }
  V.resize();
  buildMetadata(s).catch((e) => console.warn(e));
}

function renderSeriesList() {
  const box = $('#series-list');
  box.innerHTML = '';
  for (const s of seriesList) {
    const b = document.createElement('button');
    b.className = 'series-item'; b.dataset.key = s.key;
    b.innerHTML = `<div>${esc(s.desc || s.modality || 'serie')}</div><small>${esc(s.orientation)} · ${s.count} ${t('slices')} · ${s.cols}×${s.rows}${s.patient ? ' · ' + esc(s.patient) : ''}</small>`;
    b.addEventListener('click', () => { if (!busy && current !== s) openSeries(s); });
    box.appendChild(b);
  }
  $('#g-series').classList.toggle('hidden', seriesList.length < 2);
}

function chooseSeriesDialog(series) {
  return new Promise((resolve) => {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    let sel = series[0];
    bg.innerHTML = `<div class="modal"><h3>${t('dlg_series_title')}</h3><div class="hint">${t('dlg_series_hint')}</div>
      <div class="series-list"></div><div class="mrow"><button class="btn-ghost" id="dlg-cancel">${t('dlg_cancel')}</button>
      <button class="btn-primary" style="width:auto;min-height:40px;padding:8px 22px" id="dlg-ok">${t('dlg_open')}</button></div></div>`;
    const list = bg.querySelector('.series-list');
    series.forEach((s, i) => {
      const b = document.createElement('button'); b.className = 'series-item' + (i === 0 ? ' sel' : '');
      b.innerHTML = `<div>${esc(s.desc || s.modality || 'serie')}</div><small>${esc(s.orientation)} · ${s.count} ${t('slices')} · ${s.cols}×${s.rows}${s.patient ? ' · ' + esc(s.patient) : ''}</small>`;
      b.addEventListener('click', () => { sel = s; list.querySelectorAll('.series-item').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); });
      b.addEventListener('dblclick', () => { bg.remove(); resolve(s); });
      list.appendChild(b);
    });
    bg.querySelector('#dlg-cancel').addEventListener('click', () => { bg.remove(); resolve(null); });
    bg.querySelector('#dlg-ok').addEventListener('click', () => { bg.remove(); resolve(sel); });
    document.body.appendChild(bg);
  });
}

// ------------------------------------------------------------------ exportar mallas a STL
/** Diálogo con la lista de mallas del caso: se marcan las que se quieren y se bajan como STL. */
function exportMeshesDialog() {
  const items = V.getMeshes();
  if (!items.length) { setStatus(t('st_export_none')); return; }
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal"><h3>${t('dlg_export_title')}</h3>
    <div class="hint">${t('dlg_export_hint')}</div>
    <div class="exp-list">${items.map((m) => `<label class="chk"><input type="checkbox" class="exp-one" value="${m.id}" checked>
      <span>${esc(m.name)} <small>· ${t('role_' + m.role)} · ${m.nTri.toLocaleString()} ${t('triangles')}</small></span></label>`).join('')}</div>
    <div class="mrow"><button class="btn-ghost" id="dlg-cancel">${t('dlg_cancel')}</button>
    <button class="btn-primary" style="width:auto;min-height:40px;padding:8px 22px" id="dlg-ok">${t('dlg_export_ok')}</button></div></div>`;
  bg.querySelector('#dlg-cancel').addEventListener('click', () => bg.remove());
  bg.querySelector('#dlg-ok').addEventListener('click', () => {
    const ids = [...bg.querySelectorAll('.exp-one:checked')].map((c) => c.value);
    bg.remove();
    if (!ids.length) return;
    let n = 0;
    for (const id of ids) {
      const st = V.meshSTL(id);
      if (!st) continue;
      // nombre de archivo sin tildes ni caracteres raros: Windows y algunos navegadores los descartan
      const safe = st.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'malla';
      download(new Blob([st.buf], { type: 'model/stl' }), safe + '.stl');
      n++;
    }
    setStatus(t('st_export_done', { n }));
    countEvent('export');
  });
  document.body.appendChild(bg);
}

// ------------------------------------------------------------------ Fase 3: segmentación rápida y foto facial
const isPhotoName = (name) => /\.(jpe?g|png|webp|bmp)$/i.test(name || '');
const isSessionName = (name) => /\.tresd$/i.test(name || '');

function segStatus(phase, p) {
  if (phase === 'grid') setStatus(t('st_seg_grid', { p }));
  else if (phase === 'skull') setStatus(t('st_seg_bone'));
  else if (phase === 'soft') setStatus(t('st_seg_soft'));
  else if (phase === 'teeth') setStatus(t('st_seg_teeth', { p: p ?? 0 }));
}

/** Segmentación rápida (hueso + piel): tarjetas y estado. Devuelve true si hay piel. */
async function runSegmentation() {
  if (!current) { setStatus(t('st_need_dicom')); return false; }
  setProgress(0);
  const prog = busyModal(t('seg_btn'));      // v0.8.6: 20-30 s en equipos modestos
  await new Promise((r) => setTimeout(r, 30));
  let res = null;
  try {
    res = await V.segmentQuick((ph, p) => { segStatus(ph, p); prog.text(statusText()); prog.pct(ph === 'grid' ? p : null); if (ph === 'grid') setProgress(p); else setProgress(null); }, { skull: t('role_skull'), soft: t('role_soft') });
  } finally { prog.close(); }
  setProgress(null);
  if (!res || !res.items.length) { setStatus(t('st_seg_fail')); setHasCase(); return false; }
  for (const it of res.items) addMeshCard(it);
  setHasCase();
  const sk = res.items.find((m) => m.role === 'skull'), so = res.items.find((m) => m.role === 'soft');
  if (so) setCardOpacity(so.id, 0.8);      // la piel, al 80 % por defecto (se ve el hueso a través)
  const fine = sk && sk.fine ? t('st_seg_fine', { f: (sk.fine.f * Math.min(...V.state.volume.spacing)).toFixed(2) }) : '';
  setStatus(t('st_seg_done', { b: sk ? sk.nTri.toLocaleString() : 0, s: so ? so.nTri.toLocaleString() : 0, tb: Math.round(res.thresholds.bone), ts: Math.round(res.thresholds.soft), fine }));
  applyLayout('quad');                 // petición de Manuel (v0.7.12): al segmentar, volver al 2×2
  countEvent('segmentacion');
  return !!so;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen')); };
    img.src = url;
  });
}

function photoStatus(ph) { const k = 'st_photo_' + ph; setStatus(t(k)); }

/** Foto frontal → (segmentar si hace falta) → registro automático o manual → drapeado. */
async function ingestPhoto(file) {
  if (!current) { setStatus(t('st_need_dicom')); return; }
  setStatus(t('st_photo_load'));
  let img;
  try { img = await loadImage(file); } catch (e) { setStatus(t('st_photo_bad')); return; }
  if (!V.softMesh()) { const ok = await runSegmentation(); if (!ok) return; }
  // la cara se reconoce sobre un render FRONTAL del visor 3D: si estaba oculto (vista de ATM, panorámica o un
  // corte a solas) el render salía vacío y aparecía el marcado manual sin motivo (v0.7.14)
  if (!vpShown('vp3d')) { applyLayout('quad'); await new Promise((r) => setTimeout(r, 400)); }
  let res;
  const prog = busyModal(t('photo_btn'));        // v0.8.6: detección facial + drapeado, 20-30 s en equipos modestos
  await new Promise((r) => setTimeout(r, 30));
  try { res = window.tresd.forceManual ? { fail: 'no_face_3d', lm2: null } : await V.drapePhoto(img, { onStatus: (ph) => { photoStatus(ph); prog.text(statusText()); } }); }
  catch (e) { console.error(e); setStatus(t('st_error', { msg: e.message || e })); return; }
  finally { prog.close(); }
  if (res && res.ok) { finishDrape(res); return; }
  // sin detección automática (en la piel 3D, en la foto o sin MediaPipe): registro manual por puntos
  if (res && (res.fail === 'no_face_3d' || res.fail === 'no_face_photo' || res.fail === 'mediapipe')) {
    const why = t({ no_face_3d: 'st_photo_no_face3d', no_face_photo: 'st_photo_no_face', mediapipe: 'st_photo_mediapipe' }[res.fail]);
    setStatus(why);
    await manualRegistration(img, res.lm2 || null, why);
    return;
  }
  const msg = { pose: 'st_photo_pose_fail', no_soft: 'st_photo_no_soft' }[res && res.fail] || 'st_error';
  setStatus(msg === 'st_error' ? t('st_error', { msg: res && res.fail }) : t(msg));
}

/** Opacidad de una malla desde el programa: actualiza el deslizador de su tarjeta y el visor. */
function setCardOpacity(id, frac) {
  const card = $(`#mesh-cards .card[data-mesh="${id}"]`);
  if (card) card.querySelector('.m-op').value = Math.round(frac * 100);
  V.setMeshOpacity(id, frac);
}

function finishDrape(res) {
  refreshPhotoRow();
  const soft = V.softMesh(); if (soft) setCardOpacity(soft.id, 0.8);   // foto drapeada al 80 % por defecto
  // la piel drapeada se ve mejor sin el render del volumen: se oculta (la casilla DICOM lo devuelve)
  $('#dicom-vis').checked = false; V.setVolumeVisible(false);
  setHasCase();
  setStatus(t('st_photo_done', { e: res.err.toFixed(1), n: res.n, m: res.manual ? t('st_photo_manual_tag') : '' }));
  applyLayout('quad');                 // petición de Manuel (v0.7.12): al subir la foto, volver al 2×2
  countEvent('foto');
}

function refreshPhotoRow() {
  const soft = V.softMesh();
  $$('#mesh-cards .card').forEach((c) => {
    const row = c.querySelector('.m-photo'); if (!row) return;
    const on = !!(soft && c.dataset.mesh === soft.id && soft.drape);
    row.classList.toggle('hidden', !on);
    if (on) c.querySelector('.m-photo-vis').checked = true;
  });
}

// ---- registro MANUAL (si MediaPipe no reconoce la piel 3D): puntos guiados en la foto y luego en el 3D
let manualPick = null;   // { img, p2: [[u,v]…], names: [], p3: [], i }

function photoPointsDialog(img, lm2, why = '') {
  return new Promise((resolve) => {
    const W = img.naturalWidth, H = img.naturalHeight;
    const scale = Math.min(1, (window.innerWidth * 0.8) / W, (window.innerHeight * 0.52) / H);
    const cw = Math.round(W * scale), ch = Math.round(H * scale);
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal photo" style="width:${Math.max(520, cw + 36)}px"><h3>${t('dlg_photo_title')}</h3>${why ? `<div class="hint warn">${why}</div>` : ''}<div class="hint">${t('dlg_photo_hint')}</div>
      <div class="hint next" id="ph-next"></div><canvas id="ph-canvas" width="${cw}" height="${ch}" style="width:${cw}px;height:${ch}px;align-self:center"></canvas>
      <div class="mrow"><button class="btn-ghost" id="ph-undo">${t('dlg_undo')}</button>
      <button class="btn-ghost" id="ph-cancel">${t('dlg_cancel')}</button><button class="btn-primary" id="ph-ok" style="width:auto;min-height:40px;padding:8px 22px">${t('dlg_continue')}</button></div></div>`;
    document.body.appendChild(bg);
    const cv = bg.querySelector('#ph-canvas'), g = cv.getContext('2d');
    // prellenado con la detección automática de la foto (si la hubo): el usuario solo revisa
    const pts = GUIDED_POINTS.map((gp) => (lm2 && lm2[gp.idx] ? [lm2[gp.idx][0] * W, lm2[gp.idx][1] * H] : null));
    let cur = pts.findIndex((p) => !p); if (cur < 0) cur = pts.length;
    let drag = -1;
    const draw = () => {
      g.drawImage(img, 0, 0, cw, ch);
      pts.forEach((p, i) => { if (!p) return; const x = p[0] * scale, y = p[1] * scale; g.strokeStyle = '#000'; g.fillStyle = i === cur ? '#FDE047' : '#22D3EE'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.fillText(String(i + 1), x + 8, y - 8); });
      const nx = bg.querySelector('#ph-next');
      nx.textContent = cur < pts.length ? t('dlg_photo_next', { name: (cur + 1) + ' · ' + t('pt_' + GUIDED_POINTS[cur].key) }) : '✓';
      bg.querySelector('#ph-ok').disabled = pts.filter(Boolean).length < GUIDED_POINTS.length;   // los 3 (v0.7.15)
    };
    // del píxel de pantalla al píxel de la FOTO: el canvas podía salir estirado por el flex de la ventana (align-items:
    // stretch) y los clics se mapeaban mal (v0.7.14); ahora tiene tamaño fijo y, por si acaso, se corrige con su rect
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cw / r.width) / scale, (e.clientY - r.top) * (ch / r.height) / scale]; };
    cv.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      drag = pts.findIndex((q) => q && Math.hypot(q[0] - p[0], q[1] - p[1]) * scale < 12);
      if (drag < 0) { if (cur < pts.length) { pts[cur] = p; cur = pts.findIndex((q, i) => i > cur && !q); if (cur < 0) cur = pts.length; } }
      cv.setPointerCapture(e.pointerId); draw();
    });
    cv.addEventListener('pointermove', (e) => { if (drag >= 0) { pts[drag] = pos(e); draw(); } });
    cv.addEventListener('pointerup', () => { drag = -1; });
    bg.querySelector('#ph-undo').addEventListener('click', () => { const last = pts.map((p, i) => (p ? i : -1)).filter((i) => i >= 0).pop(); if (last != null) { pts[last] = null; cur = last; draw(); } });
    bg.querySelector('#ph-cancel').addEventListener('click', () => { bg.remove(); resolve(null); });
    bg.querySelector('#ph-ok').addEventListener('click', () => { bg.remove(); resolve(pts); });
    draw();
  });
}

async function manualRegistration(img, lm2, why = '') {
  const pts = await photoPointsDialog(img, lm2, why);
  if (!pts) { setStatus(t('st_ready')); return; }
  const p2 = [], names = [];
  pts.forEach((p, i) => { if (p) { p2.push(p); names.push(t('pt_' + GUIDED_POINTS[i].key)); } });
  manualPick = { img, p2, names, p3: [], i: 0 };
  $('#grid').classList.add('measuring');
  V.setView('frontal');
  promptManual();
}
function promptManual() {
  const m = manualPick; if (!m) return;
  setStatus(t('st_photo_manual_3d', { name: m.names[m.i], i: m.i + 1, n: m.names.length }));
}
function cancelManual() { manualPick = null; $('#grid').classList.remove('measuring'); V.showMarkers(null); }
async function manualPointPicked(canvasPos) {
  const m = manualPick; if (!m) return;
  const w = V.pickOnSoft(canvasPos);
  if (!w) return;
  m.p3.push(w); m.i++;
  V.showMarkers(m.p3);
  if (m.i < m.names.length) { promptManual(); return; }
  const { img, p2, p3 } = m;
  cancelManual();
  busy = true;
  try {
    const res = await V.drapePhoto(img, { onStatus: photoStatus, pairs: { p2, p3 } });
    if (res && res.ok) finishDrape(res); else setStatus(t('st_photo_pose_fail'));
  } catch (e) { console.error(e); setStatus(t('st_error', { msg: e.message || e })); }
  busy = false;
}

// ---- ALINEACIÓN POR PUNTOS (VOXEL _start_point_align / align_scanner_points): fase 1 solo el escáner (3 clics),
//      fase 2 solo el CBCT (los mismos 3 clics sobre los dientes) → rígido + ICP fino, manteniendo la oclusión.
let pointAlign = null;   // { item, phase: 'src'|'dst', src: [], dst: [], n: 3, prev: { vol, vis: [[id, visible]…] } }
const PA_COLORS = ['#22D3EE', '#F472B6', '#FDE047'];

function startPointAlign(item) {
  if (!current || busy) return;
  if (manualPick) cancelManual();
  if (pointAlign) cancelPointAlign(true);
  if (V.state.measureMode) setMeasureMode(null);
  // se guarda el render entero (preset + ventana + opacidad): la fase del CBCT pone «radiográfico cálido» para
  // ver los dientes, y al terminar o cancelar se vuelve al que había (v0.7.14, petición de Manuel)
  const prev = { vol: V.state.render.visible, render: { ...V.state.render }, vis: V.getMeshes().map((m) => [m.id, m.visible]), layout };
  pointAlign = { item, phase: 'src', src: [], dst: [], n: 3, prev };
  if (layout !== 'vp3d') applyLayout('vp3d');        // render 3D a pantalla completa mientras se marcan los puntos (v0.7.15)
  V.setVolumeVisible(false); $('#dicom-vis').checked = false;
  for (const m of V.getMeshes()) V.setMeshVisible(m.id, m.id === item.id);
  syncMeshVisBoxes();
  $('#grid').classList.add('measuring');
  $('#pa-bar').classList.remove('hidden');
  // encuadra SOLO el escáner y lo acerca (v0.8.3); se repite tras el cambio de disposición porque Cornerstone
  // reencuadra la cámara al repartir el espacio (v0.7.15) y se comía el zoom
  // v0.8.4: en vista DERECHA (petición de Manuel), tanto el escáner como después el CBCT
  const fit = () => { if (pointAlign && pointAlign.phase === 'src') { V.setView('lat_r'); V.reset3D(); V.zoom3D(1.6); } };
  fit(); setTimeout(fit, 450);
  promptPointAlign();
  setStatus(t('st_pa_start'));
}
/** Deja el resultado de una alineación a la vista: render 3D con el CBCT y los escáneres encendidos (v0.8.6). */
function showRenderWithMeshes() {
  if (!current) return;
  if (!vpShown('vp3d')) applyLayout('vp3d');
  if (!V.state.render.visible) { V.setVolumeVisible(true); $('#dicom-vis').checked = true; }
  for (const m of V.getMeshes()) if (!m.seg && m.role !== 'airway' && !m.visible) V.setMeshVisible(m.id, true);
  syncMeshVisBoxes();
  V.resize();
}
function syncMeshVisBoxes() {
  for (const m of V.getMeshes()) { const c = $(`#mesh-cards .card[data-mesh="${m.id}"] .m-vis`); if (c) c.checked = !!m.visible; }
}
function promptPointAlign() {
  const pa = pointAlign; if (!pa) return;
  const arr = pa.phase === 'src' ? pa.src : pa.dst;
  $('#pa-text').textContent = t(pa.phase === 'src' ? 'pa_src' : 'pa_dst', { i: arr.length + 1, n: pa.n });
  V.showMarkers(arr, PA_COLORS[arr.length % 3]);
}
function paPhaseDst() {
  const pa = pointAlign; if (!pa) return;
  pa.phase = 'dst';
  for (const m of V.getMeshes()) V.setMeshVisible(m.id, false);
  syncMeshVisBoxes();
  V.setVolumeVisible(true); $('#dicom-vis').checked = true;
  if (V.state.render.preset !== 'radio') { V.setPreset('radio'); syncRenderControls(); }
  V.setView('lat_r'); V.reset3D();
  // v0.8.3: el CBCT se ve de cerca y centrado en los dientes (la superficie dental ya detectada al alinear)
  if (!V.focusTeeth3D()) V.zoom3D(2.2);
  setStatus(t('st_pa_dst'));
  promptPointAlign();
}
function paPhaseSrc() {
  const pa = pointAlign; if (!pa) return;
  pa.phase = 'src';
  V.setVolumeVisible(false); $('#dicom-vis').checked = false;
  for (const m of V.getMeshes()) V.setMeshVisible(m.id, m.id === pa.item.id);
  syncMeshVisBoxes();
  promptPointAlign();
}
function paRestore() {
  const pa = pointAlign; if (!pa) return;
  Object.assign(V.state.render, pa.prev.render);          // preset y ventana de antes de alinear
  V.setVolumeVisible(pa.prev.vol); $('#dicom-vis').checked = pa.prev.vol;   // applyRender incluido
  syncRenderControls();
  for (const [id, vis] of pa.prev.vis) if (V.getMeshes().some((m) => m.id === id)) V.setMeshVisible(id, vis);
  syncMeshVisBoxes();
  V.showMarkers(null);
  if (pa.prev.layout && pa.prev.layout !== layout) applyLayout(pa.prev.layout);   // vuelve la disposición de antes
  V.reset3D();
  $('#grid').classList.remove('measuring');
  $('#pa-bar').classList.add('hidden');
}
function cancelPointAlign(silent = false) {
  if (!pointAlign) return;
  paRestore(); pointAlign = null;
  if (!silent) setStatus(t('st_pa_cancel'));
}
function undoPointAlign() {
  const pa = pointAlign; if (!pa) return;
  if (pa.phase === 'dst') { if (pa.dst.length) pa.dst.pop(); else { pa.src.pop(); paPhaseSrc(); return; } }
  else pa.src.pop();
  promptPointAlign();
}
async function pointAlignPicked(canvasPos) {
  const pa = pointAlign; if (!pa) return;
  const w = pa.phase === 'src' ? V.pickOnMesh(canvasPos, pa.item.id) : V.pickOnTeeth(canvasPos);
  if (!w) { setStatus(t('st_pa_miss')); return; }
  if (pa.phase === 'src') {
    pa.src.push(w);
    if (pa.src.length >= pa.n) paPhaseDst(); else promptPointAlign();
    return;
  }
  pa.dst.push(w);
  if (pa.dst.length < pa.n) { promptPointAlign(); return; }
  const { item, src, dst } = pa;
  paRestore(); pointAlign = null;
  busy = true;
  try {
    const a = await V.alignByPoints(item.id, src, dst, alignStatus);
    const q = a && a.err != null ? t('st_pa_quality', { e: a.err.toFixed(2), c: Math.round(100 * (a.cov || 0)) }) : t('st_pa_only');
    setStatus(a ? t('st_pa_done', { name: item.name, q }) : t('st_align_failed'));
    if (a) showRenderWithMeshes();      // v0.8.6: al terminar de alinear se ve el resultado en el render
  } catch (e) { console.error(e); setStatus(t('st_error', { msg: e.message || e })); }
  busy = false;
}

// ------------------------------------------------------------------ ORIENTAR EL VOLUMEN (v0.8.6)
// Tres deslizadores enderezan la cabeza (los tres planos). Gira TODO el caso, así que los cortes, la panorámica,
// la TeleRx y los cortes de ATM salen ya con el paciente derecho. Mientras se arrastra solo se gira la geometría
// (barato); al soltar se rehacen la panorámica y los cortes de ATM, que sí cuestan.
let orientTimer = 0, orientPending = null, orientLast = 0;
const orientDeg = () => ({ x: +$('#or-x').value, y: +$('#or-y').value, z: +$('#or-z').value });
function syncOrientLabels() {
  for (const ax of ['x', 'y', 'z']) { const v = +$(`#or-${ax}`).value; $(`#or-${ax}-val`).textContent = (v > 0 ? '+' : '') + v.toFixed(1).replace(/\.0$/, '') + '°'; }
}
function applyOrientLive() {
  if (!current) return;
  syncOrientLabels();
  // ACELERADOR, no espera (v0.8.6): con una espera, arrastrando sin parar no se veía nada hasta soltar. Ahora se
  // gira en cuanto se mueve y como mucho cada 60 ms, así los cortes y el render siguen al deslizador en vivo.
  const now = Date.now();
  clearTimeout(orientTimer);
  const run = () => { orientLast = Date.now(); const out = V.setOrient(orientDeg(), { live: true }); if (out) orientPending = out; };
  if (now - orientLast >= 60) run();
  else orientTimer = setTimeout(run, 60 - (now - orientLast));
}
/** Al soltar el deslizador: rehace lo que se calcula a partir de los cortes (panorámica, ATM, TeleRx). */
async function finishOrient() {
  clearTimeout(orientTimer); orientLast = 0;
  const out = V.setOrient(orientDeg()) || orientPending;    // sin `live`: rehace siluetas y rejilla
  orientPending = null;
  if (!current || busy) return;
  const d = orientDeg();
  if (!out) { setStatus(t('st_orient_done', { x: d.x, y: d.y, z: d.z })); return; }
  busy = true;
  const prog = busyModal(t('or_title'));
  try {
    if (out.tmj && V.state.tmj) {
      prog.text(t('st_atm_slices', { s: '' })); await new Promise((r) => setTimeout(r, 20));
      const tmj = V.state.tmj;
      const res = V.restoreTmj({ poles: tmj.poles, shift: tmj.shift, aspect: tmj.aspect, midX: tmj.midX, win: V.getTmjWindow(), meas: {} }, null);
      if (res) renderTmj();
    }
    if (out.panoControl && out.panoControl.length >= 3) {
      prog.text(t('st_pan_building')); await new Promise((r) => setTimeout(r, 20));
      const curve = V.curveFromPoints(out.panoControl, out.panoZ);
      if (curve) { await V.buildPano({ curve, thickness: +$('#pan-thick').value, mip: $('#pan-mip').checked }, alignStatus); drawPan(); }
    }
    if (layout === 'vpTele') { prog.text(t('layout_tele')); await showTelerx({ silent: true }); }
    setStatus(t('st_orient_done', { x: d.x, y: d.y, z: d.z }));
  } catch (e) { console.error(e); setStatus(t('st_error', { msg: e.message || e })); }
  prog.close();
  busy = false;
  V.resize();
}
/** Coloca los deslizadores (sin disparar el giro): al cargar un caso o restaurar una sesión. */
function syncOrientControls() {
  const o = V.getOrient() || { x: 0, y: 0, z: 0 };
  $('#or-x').value = o.x; $('#or-y').value = o.y; $('#or-z').value = o.z;
  syncOrientLabels();
}

// ------------------------------------------------------------------ vía aérea (2 clics en el corte sagital, como VOXEL)
let airwayPick = null;    // { marks: [[x,y,z]…], prevLayout }

function startAirway() {
  if (!current || busy || airwayPick) return;
  if (panDraw) cancelPanDraw(true);
  if (manualPick) cancelManual();
  if (pointAlign) cancelPointAlign(true);
  if (V.state.measureMode) setMeasureMode(null);
  airwayPick = { marks: [], prevLayout: layout };
  applyLayout('vpSag', false);
  $('#grid').classList.add('measuring');
  $('#aw-bar').classList.remove('hidden');
  V.suppressSilhouettes(true);          // marcando la vía aérea, las siluetas estorban sobre el corte
  promptAirway();
  setStatus(t('st_aw_start'));
}
function promptAirway() {
  const aw = airwayPick; if (!aw) return;
  $('#aw-text').textContent = t(aw.marks.length === 0 ? 'aw_sup' : 'aw_inf');
  V.setAirwayMarks(aw.marks);
}
function awRestore(restoreLayout = true) {
  const aw = airwayPick; if (!aw) return;
  V.setAirwayMarks(null);
  $('#grid').classList.remove('measuring');
  $('#aw-bar').classList.add('hidden');       // (v0.7.5–v0.7.7 ocultaba #atm-bar por error: el aviso se quedaba puesto tras segmentar)
  V.suppressSilhouettes(false);
  if (restoreLayout) applyLayout(aw.prevLayout || 'quad');
}
function cancelAirway(silent = false) {
  if (!airwayPick) { $('#aw-bar').classList.add('hidden'); return; }
  awRestore(); airwayPick = null;
  if (!silent) setStatus(t('st_aw_cancel'));
}
function undoAirway() { const aw = airwayPick; if (!aw) return; aw.marks.pop(); promptAirway(); }
function awStatus(ph, p) {
  if (ph === 'grid') setStatus(t('st_aw_grid', { p: p ?? 0 }));
  else if (ph === 'label') setStatus(t('st_aw_label'));
  else if (ph === 'mesh') setStatus(t('st_aw_mesh'));
}
async function airwayPicked(canvasPos) {
  const aw = airwayPick; if (!aw) return;
  const w = V.pickOnMpr(V.VP.sag, canvasPos);
  if (!w) return;
  aw.marks.push(w);
  if (aw.marks.length < 2) { promptAirway(); return; }
  const [sup, inf] = aw.marks;
  V.setAirwayMarks(aw.marks);
  busy = true;
  try {
    setProgress(0);
    const item = await V.segmentAirway(sup, inf, (ph, p) => { awStatus(ph, p); if (ph === 'grid') setProgress(p); else setProgress(null); }, t('role_airway'));
    setProgress(null);
    awRestore(!item); airwayPick = null;      // con malla se pasa al 3D; sin ella, a la disposición anterior
    if (!item) { setStatus(t('st_aw_none')); busy = false; return; }
    addMeshCard(item); syncCards();
    // como VOXEL: DICOM de referencia visible, preset «vía aérea» (tejidos translúcidos) y vista lateral derecha
    $('#dicom-vis').checked = true; V.setVolumeVisible(true);
    V.setPreset('airway'); syncRenderControls();
    applyLayout('vp3d'); setHasCase(); V.setView('lat_r');
    const a = item.airway;
    setStatus(t('st_aw_done', { v: (a.volume_mm3 / 1000).toFixed(1), a: a.mca_mm2.toFixed(0), z: (a.mca_z - a.z_lo).toFixed(0) }));
    countEvent('via_aerea');
  } catch (e) { console.error(e); setProgress(null); awRestore(); airwayPick = null; setStatus(t('st_error', { msg: e.message || e })); }
  busy = false;
}

// ------------------------------------------------------------------ dibujar la curva panorámica a mano (v0.7.12)
let panDraw = null;       // { pts: [[x,y,z]…], prevLayout }

function startPanDraw() {
  if (!current || busy || panDraw) return;
  if (manualPick) cancelManual();
  if (pointAlign) cancelPointAlign(true);
  if (airwayPick) cancelAirway(true);
  if (tmjPick) cancelTmj(true);
  if (V.state.measureMode) setMeasureMode(null);
  if (panEdit) setPanoEdit(false);
  panDraw = { pts: [], prevLayout: layout };
  applyLayout('vpAx', false);
  // a la altura de los dientes si ya hay curva; si no, donde esté el axial (el usuario lo mueve con la rueda)
  const z = V.state.pano && V.state.pano.curve ? V.state.pano.curve.z : null;
  if (Number.isFinite(z)) V.jumpViewportSticky(V.VP.ax, 2, z);
  $('#grid').classList.add('measuring');
  $('#pd-bar').classList.remove('hidden');
  V.suppressSilhouettes(true);
  promptPanDraw();
  setStatus(t('st_pan_draw'));
}
function promptPanDraw() {
  const p = panDraw; if (!p) return;
  $('#pd-text').textContent = t('pd_text', { n: p.pts.length });
  $('#pd-done').disabled = p.pts.length < 3;
  V.setPanoDrawPoints(p.pts);
}
function pdRestore() {
  const p = panDraw; if (!p) return;
  V.setPanoDrawPoints(null);
  $('#grid').classList.remove('measuring');
  $('#pd-bar').classList.add('hidden');
  V.suppressSilhouettes(false);
}
function cancelPanDraw(silent = false) {
  if (!panDraw) { $('#pd-bar').classList.add('hidden'); return; }
  const prev = panDraw.prevLayout; pdRestore(); panDraw = null;
  applyLayout(prev || 'quad');
  if (!silent) setStatus(t('st_pan_draw_cancel'));
}
function undoPanDraw() { const p = panDraw; if (!p) return; p.pts.pop(); promptPanDraw(); }
function panDrawPicked(canvasPos) {
  const p = panDraw; if (!p) return;
  const w = V.pickOnMpr(V.VP.ax, canvasPos); if (!w) return;
  p.pts.push(w); promptPanDraw();
}
async function finishPanDraw() {
  const p = panDraw; if (!p) return;
  if (p.pts.length < 3) { setStatus(t('st_pan_draw_few')); return; }
  // la panorámica va de la DERECHA del paciente (−X) a la izquierda: si se dibujó al revés, se invierte
  const pts = p.pts.slice(); if (pts[0][0] > pts[pts.length - 1][0]) pts.reverse();
  const z = pts.reduce((a, q) => a + q[2], 0) / pts.length;
  const curve = V.curveFromPoints(pts, z);
  pdRestore(); panDraw = null;
  if (!curve) { setStatus(t('st_pan_draw_few')); applyLayout('quad'); return; }
  const prev = V.getPanoControl();
  applyLayout('vpPan', true);
  await showPanoramic({ curve, silent: true });
  const next = V.getPanoControl();
  if (prev && next) V.history.record({ label: 'pan_curve', undo: () => { V.setPanoControl(prev); showPanoramic({ silent: true }); }, redo: () => { V.setPanoControl(next); showPanoramic({ silent: true }); } });
  refreshHistoryButtons();
  setStatus(t('st_pan_draw_done', { n: pts.length }));
}

// ------------------------------------------------------------------ cortes de ATM (2 clics, uno por cóndilo)
let tmjPick = null;      // { seeds: {R, L}, order: ['R','L'], prevLayout }

function startTmj() {
  if (!current || busy || tmjPick) return;
  if (panDraw) cancelPanDraw(true);
  if (manualPick) cancelManual();
  if (pointAlign) cancelPointAlign(true);
  if (airwayPick) cancelAirway(true);
  if (V.state.measureMode) setMeasureMode(null);
  tmjPick = { seeds: {}, order: ['R', 'L'], prevLayout: layout };
  // corte CORONAL solo, a la altura estimada de los cóndilos: es donde mejor se ven los dos a la vez
  applyLayout('vpCor', false);
  // el salto se REPITE hasta que se queda puesto: al cambiar de disposición Cornerstone recolocaba la
  // cámara en el centro del volumen después y el coronal se quedaba lejos de los cóndilos (v0.7.6)
  const g = V.condyleGuess();
  if (g) V.jumpViewportSticky(V.VP.cor, 1, g[1]);
  $('#grid').classList.add('measuring');
  $('#atm-bar').classList.remove('hidden');
  V.suppressSilhouettes(true);        // las siluetas de las mallas estorban para ver los cóndilos
  promptTmj();
  setStatus(t('st_atm_start'));
}
function promptTmj() {
  const p = tmjPick; if (!p) return;
  const next = p.order.find((s) => !p.seeds[s]);
  $('#atm-text').textContent = t(next === 'R' ? 'atm_r' : 'atm_l');
  V.setTmjMarks(p.order.filter((s) => p.seeds[s]).map((s) => p.seeds[s]));
}
function tmjRestore(restoreLayout = true) {
  const p = tmjPick; if (!p) return;
  V.setTmjMarks(null);
  $('#grid').classList.remove('measuring');
  $('#atm-bar').classList.add('hidden');
  V.suppressSilhouettes(false);
  if (restoreLayout) applyLayout(p.prevLayout || 'quad');
}
function cancelTmj(silent = false) {
  if (!tmjPick) return;
  tmjRestore(); tmjPick = null;
  if (!silent) setStatus(t('st_atm_cancel'));
}
function undoTmj() {
  const p = tmjPick; if (!p) return;
  const done = p.order.filter((s) => p.seeds[s]);
  if (done.length) delete p.seeds[done[done.length - 1]];
  promptTmj();
}
async function tmjPicked(vpId, canvasPos) {
  const p = tmjPick; if (!p) return;
  const w = V.pickOnMpr(vpId, canvasPos);
  if (!w) return;
  const next = p.order.find((s) => !p.seeds[s]);
  p.seeds[next] = w;
  promptTmj();
  if (p.order.some((s) => !p.seeds[s])) return;
  const seeds = p.seeds;
  busy = true;
  try {
    setProgress(null);
    const res = await V.buildTmj(seeds, (ph, sd) => setStatus(t(ph === 'condyle' ? 'st_atm_condyle' : 'st_atm_slices', { s: sd === 'R' ? t('atm_side_r') : t('atm_side_l') })), atmCellAspect());
    tmjRestore(!res); tmjPick = null;      // si hay cortes se pasa al panel de ATM, no a la disposición anterior
    if (!res) { setStatus(t('st_atm_none')); busy = false; return; }
    V.history.record({ label: 'atm', undo: () => { V.clearTmj(); renderTmj(); setHasCase(); if (layout === 'vpAtm') applyLayout('quad'); }, redo: () => { V.state.tmj = res; renderTmj(); setHasCase(); } });
    renderTmj();
    applyLayout('vpAtm');        // ANTES de setHasCase: si no, vuelve a la disposición recordada
    setHasCase();
    fitTmjAspect();              // con el mosaico ya en pantalla, se ajusta el encuadre a la casilla real
    const wid = (sd) => { const q = res.poles[sd]; return Math.hypot(q.lat[0] - q.med[0], q.lat[1] - q.med[1], q.lat[2] - q.med[2]).toFixed(1); };
    setStatus(t('st_atm_done', { r: wid('R'), l: wid('L') }));
    countEvent('atm');
    // v0.7.18 (petición de Manuel): la detección automática de los polos es aproximada, así que nada más
    // marcar los cóndilos se abre «Ajustar polos» para revisarlos; Cancelar deja los automáticos
    if (!window.tresd || !window.tresd.noAutoPoles) setTimeout(() => { if (V.state.tmj && !document.querySelector('.modal.poles')) openPolesDialog(); }, 350);
  } catch (e) { console.error(e); tmjRestore(); tmjPick = null; setStatus(t('st_error', { msg: e.message || e })); }
  busy = false;
}

/**
 * Encaja el mosaico de ATM: mide el ANCHO de casilla que da la rejilla (5 columnas) y el alto disponible,
 * elige una proporción sensata (ni sello ni tira, `clampAspect`), FIJA el alto de fila a esa proporción y
 * rehace los cortes con ella. Así el corte llena la casilla justa y no quedan franjas negras a los lados.
 */
function atmCellAspect() {
  const grid = $('#atm-grid');
  const cell = $('#atm-grid .atm-cell:not(.atm-gap)');
  const w = cell ? cell.getBoundingClientRect().width : (grid ? (grid.clientWidth - 56 - 3 * 5) / 5 : 0);
  const h = grid ? (grid.clientHeight - 3 * 4) / 4 : 0;
  return w > 20 && h > 20 ? w / h : 1.35;
}
function fitTmjAspect(retry = 0) {
  if (!V.state.tmj) return;
  const grid = $('#atm-grid'); if (!grid) return;
  const cell = $('#atm-grid .atm-cell:not(.atm-gap)');
  const w = cell ? cell.getBoundingClientRect().width : 0;
  // justo tras cambiar de disposición la casilla puede medir aún 0: se reintenta unos fotogramas (v0.7.12)
  if (w <= 20) { if (retry < 10) requestAnimationFrame(() => fitTmjAspect(retry + 1)); return; }
  const a = V.clampAspect(atmCellAspect());
  grid.style.gridAutoRows = (w / a).toFixed(1) + 'px';
  if (V.setTmjAspect(a)) redrawTmj();
}

/** Texto de cada corte: «Sagital medial 2 mm», «Coronal +3 mm»… (el desplazamiento va en el rótulo). */
function atmLabel(it) {
  if (it.family === 'sag') {
    if (it.off === 0) return t('atm_sag_c');
    return t(it.off < 0 ? 'atm_sag_m' : 'atm_sag_l', { o: Math.abs(it.off) });
  }
  const base = t(it.family === 'cor' ? 'atm_cor' : 'atm_axi');
  const d = it.off - (it.base || 0);                    // respecto a la altura por defecto (el axial arranca en la cabeza)
  return d ? `${base} ${d > 0 ? '+' : '-'}${Math.abs(d)} mm` : base;
}

/** Mosaico de cortes de ATM: por lado, una fila con los 5 sagitales y otra con el coronal y el axial. */
function renderTmj() {
  const box = $('#atm-grid'); if (!box) return;
  const tmj = V.state.tmj;
  box.innerHTML = '';
  $('#lay-atm').classList.toggle('hidden', !tmj);
  refreshImportGroups();                                                 // v0.8.3/4: con los cortes ya calculados sobra el botón
  if (!tmj) return;
  const cell = (it) => {
    const d = document.createElement('div'); d.className = 'atm-cell';
    d.dataset.side = it.side; d.dataset.key = it.key; d.dataset.family = it.family;
    d.appendChild(document.createElement('canvas'));
    d.appendChild(document.createElement('span'));
    const big = document.createElement('button');
    big.className = 'btn-ghost atm-zoom'; big.textContent = '⤢'; big.title = t('atm_big_tip');
    d.appendChild(big);
    return d;
  };
  for (const sd of ['R', 'L']) {
    const serie = tmj.series[sd]; if (!serie) continue;
    const lbl = document.createElement('div'); lbl.className = 'atm-side'; lbl.textContent = t(sd === 'R' ? 'atm_side_r' : 'atm_side_l');
    box.appendChild(lbl);
    const sag = serie.filter((x) => x.family === 'sag');
    const rest = serie.filter((x) => x.family !== 'sag');
    for (const it of sag) box.appendChild(cell({ ...it, side: sd }));
    for (const it of rest) box.appendChild(cell({ ...it, side: sd }));
    for (let i = rest.length; i < 5; i++) { const g = document.createElement('div'); g.className = 'atm-cell atm-gap'; box.appendChild(g); }
  }
  redrawTmj();
}

/** Repinta los cortes de ATM. Con `only` (un .atm-cell) repinta SOLO ese: arrastrar era lento con los 14. */
function redrawTmj(only) {
  const tmj = V.state.tmj; if (!tmj) return;
  const win = V.getTmjWindow();
  for (const cell of (only ? [only] : $$('#atm-grid .atm-cell:not(.atm-gap)'))) {
    const serie = tmj.series[cell.dataset.side]; if (!serie) continue;
    const it = serie.find((x) => x.key === cell.dataset.key);
    if (!it) continue;
    const cv = cell.querySelector('canvas');
    V.drawTmjSlice(cv, it.img, win, drawZoom(cv, it.img.w, it.img.h));
    const lbl = cell.querySelector('span'); if (lbl) lbl.textContent = atmLabel(it);
    drawTmjMeas(cv, it, cell.dataset.side);
  }
  if (!only && atmBig) drawAtmBig();
}

// ------------------------------------------------------------------ medidas sobre cortes (ATM y panorámica)
// Desde v0.7.14 en los cortes de ATM NO se mide con Mayús (en tabletas no hay teclado): en el mosaico
// arrastrar = brillo/contraste (y mover etiquetas); las medidas se hacen en el corte AMPLIADO con los botones
// «Distancia» (arrastrar) y «Ángulo» (tres toques: extremo, vértice, extremo). La etiqueta del valor se
// arrastra y va en tamaño de pantalla; en el mosaico se reduce con el tamaño de la casilla (v0.7.14).
// En la panorámica igual, con sus botones «Distancia» / «Ángulo» (v0.7.17).
let atmDrag = null;         // { cell, it, side, cv, mode: 'label', m, p0, lab0 } mientras se mueve una etiqueta del mosaico
let atmMeasN = 0;

/**
 * Factor de RESOLUCIÓN con el que pintar un corte: píxeles de canvas por píxel de la imagen. Se pinta a los
 * píxeles REALES de pantalla (nunca por debajo de 1) para que los rótulos y las medidas que van encima
 * salgan nítidos; antes se dibujaban en píxeles del corte y la pantalla los ampliaba (borrosos, v0.7.6).
 */
function drawZoom(cv, w, h) {
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height || !w || !h) return 2;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return Math.max(1, Math.min(6, Math.min(r.width / w, r.height / h) * dpr));
}

/** Escala canvas→pantalla de un canvas pintado con object-fit: contain (px de canvas por píxel de pantalla). */
function canvasScale(cv) {
  const r = cv.getBoundingClientRect();
  if (!r.width || !cv.width) return 1;
  return cv.width / Math.min(r.width, (cv.width / cv.height) * r.height);
}

/**
 * Tamaño de las medidas en una casilla del MOSAICO de ATM: en casillas pequeñas (~200–300 px) las líneas y
 * etiquetas de tamaño fijo tapaban el cóndilo (v0.7.14). 1 = tamaño normal (corte ampliado); mínimo 0,7.
 */
function gridMeasScale(cv) {
  const r = cv.getBoundingClientRect();
  const disp = Math.min(r.width || 0, r.height || 0);
  return disp ? Math.max(0.7, Math.min(1, disp / 420)) : 1;
}

/** Ángulo (grados, 0–180) de una medida angular {a, v, b}: entre los rayos v→a y v→b. */
function measAngle(m) {
  const u = [m.a[0] - m.v[0], m.a[1] - m.v[1]], w = [m.b[0] - m.v[0], m.b[1] - m.v[1]];
  return Math.abs(Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1])) * 180 / Math.PI;
}
/** Texto del valor de una medida: «12,3 mm» o «34,5°». `mm` = mm por píxel del corte. */
function measText(m, mm) {
  if (m.type === 'ang') return measAngle(m).toFixed(1) + '°';
  return (Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) * mm).toFixed(1) + ' mm';
}

/**
 * Posición de la etiqueta de una medida (en píxeles del corte): punto medio de la distancia, o el vértice del
 * ángulo desplazado hacia dentro por la bisectriz (`gap` px del corte), más el arrastre del usuario (`lab`).
 */
function measLabelPos(m, gap = 0) {
  const k = m.lab || [0, 0];
  if (m.type !== 'ang') return [(m.a[0] + m.b[0]) / 2 + k[0], (m.a[1] + m.b[1]) / 2 + k[1]];
  const n = (p) => { const d = Math.hypot(p[0] - m.v[0], p[1] - m.v[1]) || 1; return [(p[0] - m.v[0]) / d, (p[1] - m.v[1]) / d]; };
  const u = n(m.a), w = n(m.b);
  let bx = u[0] + w[0], by = u[1] + w[1], bl = Math.hypot(bx, by);
  if (bl < 1e-3) { bx = -u[1]; by = u[0]; bl = 1; }             // rayos opuestos: perpendicular
  return [m.v[0] + (bx / bl) * gap + k[0], m.v[1] + (by / bl) * gap + k[1]];
}

/**
 * Pinta una lista de medidas sobre un canvas ya dibujado. `mm` = mm por píxel del corte; `f` = factor de
 * tamaño (1 = normal; menor en las casillas del mosaico). Los tamaños van en píxeles de PANTALLA (se
 * multiplican por la escala del canvas). Una medida `live` va a trazos (se está dibujando); `noLabel` sin valor.
 */
function drawMeasures(cv, list, mm, f = 1) {
  if (!list || !list.length) return;
  const g = cv.getContext('2d');
  const k = canvasScale(cv) * f;                // px de canvas por px de pantalla (× tamaño)
  const z = cv._imgZoom || 1;                   // px de canvas por px del corte
  const P = (p) => [p[0] * z, p[1] * z];        // del corte al canvas
  const lw = 1.4 * k, dot = 2.6 * k, fs = 11 * k;
  g.save();
  g.font = `600 ${fs.toFixed(1)}px Poppins, sans-serif`;
  g.textBaseline = 'middle';
  for (const m of list) {
    const pts = m.type === 'ang' ? [m.a, m.v, m.b].map(P) : [m.a, m.b].map(P);
    g.strokeStyle = m.color; g.fillStyle = m.color; g.lineWidth = lw;
    g.setLineDash(m.live ? [4 * k, 3 * k] : []);
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) g.lineTo(q[0], q[1]); g.stroke();
    g.setLineDash([]);
    for (const q of pts) { g.beginPath(); g.arc(q[0], q[1], dot, 0, 2 * Math.PI); g.fill(); }
    if (m.type === 'ang') {                     // arco en el vértice, por el lado corto
      const [a, v, b] = pts;
      const a0 = Math.atan2(a[1] - v[1], a[0] - v[0]);
      const d = Math.atan2((a[0] - v[0]) * (b[1] - v[1]) - (a[1] - v[1]) * (b[0] - v[0]), (a[0] - v[0]) * (b[0] - v[0]) + (a[1] - v[1]) * (b[1] - v[1]));
      g.lineWidth = lw * 0.8;
      g.beginPath(); g.arc(v[0], v[1], 14 * k, a0, a0 + d, d < 0); g.stroke();
    }
    if (m.noLabel) continue;
    const anchor = m.type === 'ang' ? pts[1] : [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    const [lx, ly] = P(measLabelPos(m, 22 * k / z));
    const txt = measText(m, mm);
    const wtx = g.measureText(txt).width;
    // guía fina de la etiqueta a la medida cuando se ha separado
    if (m.lab && (m.lab[0] || m.lab[1])) {
      g.globalAlpha = 0.55; g.lineWidth = lw * 0.8;
      g.beginPath(); g.moveTo(anchor[0], anchor[1]); g.lineTo(lx, ly); g.stroke();
      g.globalAlpha = 1;
    }
    g.fillStyle = 'rgba(0,0,0,.6)';
    g.fillRect(lx - 2 * k, ly - fs * 0.72, wtx + 4 * k, fs * 1.44);
    g.fillStyle = m.color;
    g.fillText(txt, lx, ly);
  }
  g.restore();
}

/** Medida cuya ETIQUETA cae bajo el punto (px del corte), o null. `f` = mismo factor de tamaño que al pintar. */
function measAtLabel(list, cv, p, f = 1) {
  if (!list) return null;
  const g = cv.getContext('2d');
  const k = canvasScale(cv) * f, fs = 11 * k, z = cv._imgZoom || 1;
  g.font = `600 ${fs.toFixed(1)}px Poppins, sans-serif`;
  const q = [p[0] * z, p[1] * z];               // el punto viene en px del corte; la etiqueta va en px de canvas
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i], mp = measLabelPos(m, 22 * k / z), lx = mp[0] * z, ly = mp[1] * z;
    const w = g.measureText('00.0 mm').width;
    if (q[0] >= lx - 3 * k && q[0] <= lx + w + 3 * k && Math.abs(q[1] - ly) <= fs) return m;
  }
  return null;
}

/** Pinta las medidas guardadas de un corte de ATM sobre su canvas del MOSAICO (tamaño según la casilla). */
function drawTmjMeas(cv, it, side) {
  drawMeasures(cv, V.getTmjMeas(side, it.family, it.off), it.img.step, gridMeasScale(cv));
}

/** Posición del ratón en PÍXELES DEL CORTE (el canvas se pinta con object-fit: contain). */
function atmPos(cv, ev) {
  const r = cv.getBoundingClientRect();
  const s = Math.min(r.width / cv.width, r.height / cv.height);
  const ox = (r.width - cv.width * s) / 2, oy = (r.height - cv.height * s) / 2;
  const z = cv._imgZoom || 1;
  return [(ev.clientX - r.left - ox) / s / z, (ev.clientY - r.top - oy) / s / z];
}

/** Rueda del ratón sobre un corte: desplaza esa familia de cortes de milímetro en milímetro. */
function atmWheel(ev) {
  const cell = ev.target.closest('.atm-cell:not(.atm-gap)'); if (!cell || !V.state.tmj) return;
  ev.preventDefault();
  const d = ev.deltaY > 0 ? 1 : -1;
  if (V.scrollTmj(cell.dataset.side, cell.dataset.family, d) === null) return;
  redrawTmj();
}

/** Mosaico de ATM: pulsar sobre la ETIQUETA de una medida la agarra para moverla; lo demás es brillo/contraste. */
function atmDown(ev) {
  const cell = ev.target.closest('.atm-cell:not(.atm-gap)'); if (!cell || !V.state.tmj || ev.button !== 0) return;
  const serie = V.state.tmj.series[cell.dataset.side]; if (!serie) return;
  const it = serie.find((x) => x.key === cell.dataset.key); if (!it) return;
  const cv = cell.querySelector('canvas');
  const p = atmPos(cv, ev);
  const side = cell.dataset.side;
  const lab = measAtLabel(V.getTmjMeas(side, it.family, it.off), cv, p, gridMeasScale(cv));
  if (!lab) return;
  atmDrag = { cell, it, side, cv, mode: 'label', m: lab, p0: p, lab0: (lab.lab || [0, 0]).slice() };
  try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* nada */ }
  ev.preventDefault(); ev.stopPropagation();
}
function atmMove(ev) {
  if (!atmDrag) return;
  const p = atmPos(atmDrag.cv, ev);
  atmDrag.m.lab = [atmDrag.lab0[0] + (p[0] - atmDrag.p0[0]), atmDrag.lab0[1] + (p[1] - atmDrag.p0[1])];
  redrawTmj(atmDrag.cell);                 // solo el corte que se está tocando: así va fluido
}
function atmUp() {
  const d = atmDrag; atmDrag = null;
  if (d) redrawTmj(d.cell);
}

/** Guarda una medida (distancia o ángulo) de un corte de ATM con deshacer/rehacer y aviso en la barra de estado. */
function addAtmMeas(side, it, m) {
  const key = [side, it.family, it.off];
  V.addTmjMeas(key[0], key[1], key[2], m);
  atmMeasN++;
  V.history.record({
    label: 'atm_meas',
    undo: () => { const l = V.getTmjMeas(key[0], key[1], key[2]); const i = l.indexOf(m); if (i >= 0) l.splice(i, 1); redrawTmj(); },
    redo: () => { V.addTmjMeas(key[0], key[1], key[2], m); redrawTmj(); },
  });
  refreshHistoryButtons();
  redrawTmj();
  setStatus(t(m.type === 'ang' ? 'st_atm_ang' : 'st_atm_meas', { v: measText(m, it.img.step) }));
}

// ------------------------------------------------------------------ corte de ATM ampliado (modal)
let atmBig = null;          // { side, key, bg, cv, tool: null|'len'|'ang', drag, pts, cur }

/**
 * Abre un corte de ATM a pantalla grande. Rueda = cambiar de corte; arrastrar = brillo/contraste; con el botón
 * «Distancia» arrastrar mide; con «Ángulo» se dan tres toques (extremo, vértice, extremo). Sin Mayús: vale
 * para tabletas (v0.7.14). Las etiquetas de las medidas se arrastran siempre.
 */
function openAtmBig(side, key) {
  if (!V.state.tmj || atmBig) return;
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal atm-big"><div class="atm-big-head"><h3 id="ab-title"></h3>
      <span class="spacer" style="flex:1"></span>
      <button class="btn-ghost" id="ab-len" aria-pressed="false" title="${t('ab_len_tip')}">${t('ab_len')}</button>
      <button class="btn-ghost" id="ab-ang" aria-pressed="false" title="${t('ab_ang_tip')}">${t('ab_ang')}</button>
      <button class="btn-ghost" id="ab-shot" title="${t('ab_shot_tip')}">📷 ${t('shot_btn')}</button>
      <button class="btn-ghost" id="ab-close">${t('dlg_close')}</button></div>
    <div class="atm-big-wrap"><canvas id="ab-canvas"></canvas></div>
    <div class="hint" id="ab-hint"></div></div>`;
  document.body.appendChild(bg);
  atmBig = { side, key, bg, cv: bg.querySelector('#ab-canvas'), tool: null, drag: null, pts: [], cur: null };
  const close = () => { bg.remove(); atmBig = null; };
  bg.querySelector('#ab-close').addEventListener('click', close);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  bg.querySelector('#ab-shot').addEventListener('click', shotAtmBig);
  bg.querySelector('#ab-len').addEventListener('click', () => setAtmBigTool(atmBig.tool === 'len' ? null : 'len'));
  bg.querySelector('#ab-ang').addEventListener('click', () => setAtmBigTool(atmBig.tool === 'ang' ? null : 'ang'));
  const cv = atmBig.cv;
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const it = atmBigItem(); if (!it) return;
    if (V.scrollTmj(side, it.family, e.deltaY > 0 ? 1 : -1) === null) return;
    redrawTmj();
  }, { passive: false });
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const it = atmBigItem(); if (!it) return;
    const p = atmPos(cv, e);
    const lab = measAtLabel(V.getTmjMeas(side, it.family, it.off), cv, p);
    if (lab) atmBig.drag = { mode: 'label', m: lab, p0: p, lab0: (lab.lab || [0, 0]).slice() };
    // distancia: DOS TOQUES (v0.7.16, tabletas); si en vez de soltar se arrastra, también vale (mode pasa a 'new')
    else if (atmBig.tool === 'len') atmBig.drag = { mode: 'tap', p0: p, a: p, b: null, x: e.clientX, y: e.clientY, color: V.MEAS_COLORS[atmMeasN % V.MEAS_COLORS.length] };
    else if (atmBig.tool === 'ang') atmBig.drag = { mode: 'tap', p0: p, x: e.clientX, y: e.clientY };
    else atmBig.drag = { mode: 'win', x: e.clientX, y: e.clientY, w: V.getTmjWindow() };
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!atmBig) return;
    const d = atmBig.drag;
    if (atmBig.tool === 'ang' || atmBig.tool === 'len') { atmBig.cur = atmPos(cv, e); if (atmBig.pts.length && !d) drawAtmBig(); }
    if (!d) return;
    // distancia: si el primer toque se convierte en arrastre (> 8 px), se mide arrastrando como antes
    if (d.mode === 'tap' && atmBig.tool === 'len' && !atmBig.pts.length && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.mode = 'new';
    if (d.mode === 'win') {
      const w0 = d.w, ww = Math.max(20, (w0.upper - w0.lower) + (e.clientX - d.x) * 6), wl = (w0.upper + w0.lower) / 2 + (e.clientY - d.y) * 6;
      V.setTmjWindow({ lower: wl - ww / 2, upper: wl + ww / 2 }); redrawTmj();
      return;
    }
    const p = atmPos(cv, e);
    if (d.mode === 'label') d.m.lab = [d.lab0[0] + (p[0] - d.p0[0]), d.lab0[1] + (p[1] - d.p0[1])];
    else if (d.mode === 'new') d.b = p;
    drawAtmBig();
  });
  const up = (e) => {
    if (!atmBig || !atmBig.drag) return;
    const d = atmBig.drag; atmBig.drag = null;
    const it = atmBigItem(); if (!it) return;
    if (d.mode === 'tap') {                       // un toque (sin arrastre) añade un punto: 2 para distancia, 3 para ángulo
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) { drawAtmBig(); return; }
      atmBig.pts.push(d.p0);
      const need = atmBig.tool === 'ang' ? 3 : 2;
      if (atmBig.pts.length >= need) {
        const pts = atmBig.pts; atmBig.pts = [];
        const color = V.MEAS_COLORS[atmMeasN % V.MEAS_COLORS.length];
        if (atmBig.tool === 'ang') addAtmMeas(side, it, { type: 'ang', a: pts[0], v: pts[1], b: pts[2], color, lab: [0, 0] });
        else if (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) * it.img.step >= 1) addAtmMeas(side, it, { a: pts[0], b: pts[1], color, lab: [0, 0] });
        else drawAtmBig();
      } else drawAtmBig();
      atmBigHint();
      return;
    }
    if (d.mode !== 'new' || !d.b) { drawAtmBig(); return; }
    if (Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) * it.img.step < 1) { drawAtmBig(); return; }   // un clic suelto no es una medida
    addAtmMeas(side, it, { a: d.a, b: d.b, color: d.color, lab: [0, 0] });
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  atmBigHint();
  drawAtmBig();
}
/**
 * CAPTURA del corte de ATM ampliado (v0.7.18): el canvas tal cual (con sus medidas pintadas), el rótulo
 * «Derecha · Sagital centro» arriba a la izquierda y la marca de agua. Se descarga como PNG.
 */
function shotAtmBig() {
  const it = atmBigItem(); if (!it) return;
  // se vuelve a pintar el corte a ALTA resolución (≥ 1400 px de ancho) con sus medidas, no el canvas de pantalla
  const zoom = Math.max(1, 1400 / it.img.w);
  const out = document.createElement('canvas');
  V.drawTmjSlice(out, it.img, V.getTmjWindow(), zoom);
  drawMeasures(out, V.getTmjMeas(atmBig.side, it.family, it.off), it.img.step, out.width / 700);   // tamaños de pantalla × 2
  const g = out.getContext('2d');
  const label = `${t(atmBig.side === 'R' ? 'atm_side_r' : 'atm_side_l')} · ${atmLabel(it)}`;
  const fs = Math.max(12, Math.round(out.width / 45));
  g.font = `600 ${fs}px Poppins, sans-serif`; g.textBaseline = 'top';
  const tw = g.measureText(label).width;
  g.fillStyle = 'rgba(0,0,0,.62)'; g.fillRect(fs * 0.6, fs * 0.6, tw + fs, fs * 1.5);
  g.fillStyle = '#fff'; g.fillText(label, fs * 1.1, fs * 0.85);
  V.stampWatermark(out, watermark());
  const name = `tresD_DICOM_ATM_${atmBig.side}_${it.key}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  fetch(out.toDataURL('image/png')).then((r) => r.blob()).then((b) => download(b, name));
  setStatus(t('st_shot_saved'));
}
/** Cambia la herramienta del corte ampliado (null = brillo/contraste). Cancela un ángulo a medias. */
function setAtmBigTool(tool) {
  if (!atmBig) return;
  atmBig.tool = tool; atmBig.pts = []; atmBig.drag = null;
  atmBig.bg.querySelector('#ab-len').setAttribute('aria-pressed', String(tool === 'len'));
  atmBig.bg.querySelector('#ab-ang').setAttribute('aria-pressed', String(tool === 'ang'));
  atmBig.cv.classList.toggle('measuring', !!tool);
  atmBigHint();
  drawAtmBig();
}
function atmBigHint() {
  if (!atmBig) return;
  const n = atmBig.pts.length;
  const k = atmBig.tool === 'len' ? (n === 0 ? 'ab_hint_len' : 'ab_hint_len2') : atmBig.tool === 'ang' ? (n === 0 ? 'ab_hint_ang1' : n === 1 ? 'ab_hint_ang2' : 'ab_hint_ang3') : 'atm_big_hint';
  atmBig.bg.querySelector('#ab-hint').textContent = t(k);
}
function atmBigItem() {
  if (!atmBig || !V.state.tmj) return null;
  const serie = V.state.tmj.series[atmBig.side];
  return serie ? serie.find((x) => x.key === atmBig.key) : null;
}
function drawAtmBig() {
  const it = atmBigItem(); if (!it) return;
  const cv = atmBig.cv;
  V.drawTmjSlice(cv, it.img, V.getTmjWindow(), drawZoom(cv, it.img.w, it.img.h));
  const list = V.getTmjMeas(atmBig.side, it.family, it.off).slice();
  const d = atmBig.drag;
  if (d && d.mode === 'new' && d.b) list.push({ a: d.a, b: d.b, color: d.color, live: true });
  const pts = atmBig.pts, color = V.MEAS_COLORS[atmMeasN % V.MEAS_COLORS.length];
  if (pts.length === 1) list.push({ a: pts[0], b: atmBig.cur || pts[0], color, live: true, noLabel: atmBig.tool === 'ang' });   // distancia: con el valor en vivo
  else if (pts.length === 2) list.push({ type: 'ang', a: pts[0], v: pts[1], b: atmBig.cur || pts[1], color, live: true });
  drawMeasures(cv, list, it.img.step);
  atmBig.bg.querySelector('#ab-title').textContent = `${t(atmBig.side === 'R' ? 'atm_side_r' : 'atm_side_l')} · ${atmLabel(it)}`;
}
// ------------------------------------------------------------------ polos del cóndilo (ajuste a mano)
/**
 * Diálogo para COLOCAR LOS POLOS de cada cóndilo sobre un corte axial a su altura (como en VOXEL):
 * se arrastran los dos puntos y, al aceptar, se rehacen los cortes de ese lado.
 */
function openPolesDialog() {
  const tmj = V.state.tmj; if (!tmj) return;
  const sides = ['R', 'L'].filter((sd) => tmj.poles[sd]);
  if (!sides.length) return;
  const dzs = {}; for (const sd of sides) dzs[sd] = 0;
  const views = {}; for (const sd of sides) views[sd] = V.condyleAxialView(sd, 30, 0.15, 0);
  const prev = {}; for (const sd of sides) prev[sd] = V.getCondylePoles(sd);
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal poles"><h3>${t('dlg_poles_title')}</h3>
    <div class="hint">${t('dlg_poles_hint')}</div>
    <div class="poles-row">${sides.map((sd) => `<div class="poles-one" data-side="${sd}">
      <div class="poles-lbl">${t(sd === 'R' ? 'atm_side_r' : 'atm_side_l')} <span class="poles-z" data-side="${sd}"></span></div><canvas></canvas></div>`).join('')}</div>
    <div class="mrow"><button class="btn-ghost" id="dlg-cancel">${t('dlg_cancel')}</button>
    <button class="btn-primary" style="width:auto;min-height:40px;padding:8px 22px" id="dlg-ok">${t('dlg_poles_ok')}</button></div></div>`;
  document.body.appendChild(bg);
  const win = V.getTmjWindow();
  const draw = (sd) => {
    const box = bg.querySelector(`.poles-one[data-side="${sd}"] canvas`), v = views[sd];
    const zl = bg.querySelector(`.poles-z[data-side="${sd}"]`);
    if (zl) zl.textContent = dzs[sd] ? `${dzs[sd] > 0 ? '+' : '-'}${Math.abs(dzs[sd])} mm` : '';
    V.drawTmjSlice(box, v.img, win, drawZoom(box, v.img.w, v.img.h));
    const g = box.getContext('2d');
    const z = box._imgZoom || 1, k = canvasScale(box);
    const med = [v.med[0] * z, v.med[1] * z], lat = [v.lat[0] * z, v.lat[1] * z];
    const lw = 1.6 * k;
    g.save();
    g.strokeStyle = '#FDE047'; g.lineWidth = lw;
    g.beginPath(); g.moveTo(med[0], med[1]); g.lineTo(lat[0], lat[1]); g.stroke();
    g.font = `700 ${(12 * k).toFixed(1)}px Poppins, sans-serif`;
    for (const [p, col, tag] of [[med, '#22E0FF', t('poles_med')], [lat, '#FF5CF0', t('poles_lat')]]) {
      g.beginPath(); g.arc(p[0], p[1], lw * 4, 0, 2 * Math.PI); g.fillStyle = col; g.fill();
      g.lineWidth = lw; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = col; g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = lw * 2.5;
      g.strokeText(tag, p[0] + lw * 6, p[1] - lw * 5); g.fillText(tag, p[0] + lw * 6, p[1] - lw * 5);
      g.lineWidth = lw; g.strokeStyle = '#FDE047';
    }
    g.restore();
  };
  for (const sd of sides) {
    const cv = bg.querySelector(`.poles-one[data-side="${sd}"] canvas`);
    let drag = null;
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = atmPos(cv, e), v = views[sd];
      const dm = Math.hypot(p[0] - v.med[0], p[1] - v.med[1]), dl = Math.hypot(p[0] - v.lat[0], p[1] - v.lat[1]);
      const lim = v.img.w / 12;                 // en píxeles del CORTE (el canvas puede ir a más resolución)
      drag = dm < dl ? (dm < lim ? 'med' : null) : (dl < lim ? 'lat' : null);
      if (!drag) return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
      e.preventDefault();
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      dzs[sd] = Math.max(-20, Math.min(20, dzs[sd] + (e.deltaY > 0 ? -1 : 1)));
      const keep = { med: views[sd].med, lat: views[sd].lat };
      views[sd] = V.condyleAxialView(sd, 30, 0.15, dzs[sd]);
      views[sd].med = keep.med; views[sd].lat = keep.lat;      // los polos se quedan donde el usuario los puso
      draw(sd);
    }, { passive: false });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; views[sd][drag] = atmPos(cv, e); draw(sd); });
    const up = () => { drag = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    draw(sd);
  }
  const close = () => bg.remove();
  bg.querySelector('#dlg-cancel').addEventListener('click', close);
  bg.querySelector('#dlg-ok').addEventListener('click', () => {
    close();
    const next = {};
    for (const sd of sides) {
      const v = views[sd];
      const med = V.planeToWorld(v.img, v.med[0], v.med[1]);
      const lat = V.planeToWorld(v.img, v.lat[0], v.lat[1]);
      V.setCondylePoles(sd, med, lat);
      next[sd] = { med, lat };
    }
    renderTmj(); fitTmjAspect();
    V.history.record({
      label: 'atm_poles',
      undo: () => { for (const sd of sides) V.setCondylePoles(sd, prev[sd].med, prev[sd].lat); renderTmj(); },
      redo: () => { for (const sd of sides) V.setCondylePoles(sd, next[sd].med, next[sd].lat); renderTmj(); },
    });
    refreshHistoryButtons();
    const wid = (sd) => { const q = V.state.tmj.poles[sd]; return Math.hypot(q.lat[0] - q.med[0], q.lat[1] - q.med[1], q.lat[2] - q.med[2]).toFixed(1); };
    setStatus(t('st_atm_poles', { r: wid('R'), l: wid('L') }));
  });
}

// ------------------------------------------------------------------ panorámica (corte curvo)
let panBusy = false, panPending = null, panEdit = false, panDrag = null, panMeasDrag = null;
// medir en la panorámica por TOQUES (v0.7.17): herramienta activa, puntos ya tocados y posición del puntero
let panTool = null, panPts = [], panCur = null;

/** Rehace la panorámica. Si ya se está calculando, encola la última petición (grosor en vivo). */
async function showPanoramic(opts = {}) {
  if (!current) return;
  if (panBusy) { panPending = opts; return; }
  panBusy = true;
  try {
    const o = { thickness: +$('#pan-thick').value, mip: $('#pan-mip').checked, ...opts };
    if (!V.state.pano && !opts.silent) setStatus(t('st_pan_building'));
    const pano = await V.buildPano(o, alignStatus);
    if (!pano) { setStatus(t('st_pan_none')); panBusy = false; return; }
    drawPan();
    if (!opts.silent) setStatus(panEdit ? t('st_pan_edit') : t('st_ready'));
  } catch (e) { console.error(e); setStatus(t('st_error', { msg: e.message || e })); }
  panBusy = false;
  if (panPending) { const o = panPending; panPending = null; showPanoramic(o); }
}
function drawPan() {
  const pano = V.state.pano; if (!pano) return;
  const w = V.getPanoWindow();
  const cv = $('#pan-canvas');
  V.drawPanoramic(cv, pano.image, w, drawZoom(cv, pano.image.width, pano.image.height));
  const list = V.getPanoMeas().slice();
  if (panMeasDrag && panMeasDrag.mode === 'new' && panMeasDrag.b) list.push({ a: panMeasDrag.a, b: panMeasDrag.b, color: panMeasDrag.color, live: true });
  const color = V.MEAS_COLORS[atmMeasN % V.MEAS_COLORS.length];
  if (panPts.length === 1) list.push({ a: panPts[0], b: panCur || panPts[0], color, live: true, noLabel: panTool === 'ang' });
  else if (panPts.length === 2) list.push({ type: 'ang', a: panPts[0], v: panPts[1], b: panCur || panPts[1], color, live: true });
  drawMeasures(cv, list, pano.image.step);
  $('#pan-clear').classList.toggle('hidden', !V.getPanoMeas().length);     // solo con medidas (v0.7.17)
  // (la etiqueta «V · N · grosor · MIP» de la esquina se quitó en v0.7.16: se solapaba con la barra al editar la curva)
}

/** Herramienta de medida de la panorámica (null = brillo/contraste): «Distancia» 2 toques, «Ángulo» 3 toques. */
function setPanTool(tool) {
  panTool = tool; panPts = []; panMeasDrag = null;
  $('#pan-len').setAttribute('aria-pressed', String(tool === 'len'));
  $('#pan-ang').setAttribute('aria-pressed', String(tool === 'ang'));
  $('#pan-canvas').classList.toggle('measuring', !!tool);
  if (V.state.pano) drawPan();
  setStatus(t(tool === 'len' ? 'st_pan_len' : tool === 'ang' ? 'st_pan_ang' : 'st_ready'));
}
/** Guarda una medida de la panorámica con deshacer/rehacer y su valor en la barra de estado. */
function addPanMeas(m) {
  V.addPanoMeas(m); atmMeasN++;
  V.history.record({ label: 'pan_meas',
    undo: () => { const l = V.getPanoMeas(); const i = l.indexOf(m); if (i >= 0) l.splice(i, 1); drawPan(); },
    redo: () => { V.addPanoMeas(m); drawPan(); } });
  refreshHistoryButtons(); drawPan();
  setStatus(t(m.type === 'ang' ? 'st_pan_meas_ang' : 'st_pan_meas', { v: measText(m, V.state.pano.image.step) }));
}

/** Modo EDICIÓN de la curva: axial + panorámica a la vez y puntos de control arrastrables en el axial. */
let archBeforeEdit = false;   // estado de la casilla «curva» antes de entrar a editar (se restaura al salir)
function setPanoEdit(on) {
  const was = panEdit;
  panEdit = !!on;
  $('#pan-edit').setAttribute('aria-pressed', String(panEdit));
  // editando hace falta ver la curva; al salir vuelve a como estaba (desactivada por defecto, v0.7.8)
  if (panEdit && !was) { archBeforeEdit = $('#pan-curve').checked; $('#pan-curve').checked = true; }
  else if (!panEdit && was) { $('#pan-curve').checked = archBeforeEdit; V.setArchVisible(archBeforeEdit); }
  V.setPanoEdit(panEdit);
  $('.vp[data-id="vpAx"]').classList.toggle('editing', panEdit);
  $('#pe-bar').classList.toggle('hidden', !panEdit);          // «Terminar de editar» sobre el axial (v0.7.15)
  applyLayout(panEdit ? 'panEdit' : 'vpPan', false);
  // el salto a la altura de los dientes se repite TRAS la disposición: al cambiar de tamaño el visor,
  // Cornerstone reencuadra y el corte se quedaba donde estuviera (había que buscar los dientes a mano)
  if (panEdit) {
    const z = V.state.pano && V.state.pano.curve ? V.state.pano.curve.z : null;
    if (Number.isFinite(z)) V.jumpViewportSticky(V.VP.ax, 2, z);
  }
  setStatus(t(panEdit ? 'st_pan_edit' : 'st_pan_edit_off'));
}

/** Punto de control más cercano al cursor en el corte axial (o null). */
function panControlAt(canvasPos) {
  const pano = V.state.pano; if (!pano || !pano.curve.control) return null;
  const vp = V.getEngine().getViewport(V.VP.ax);
  let best = null, bd = 14;
  pano.curve.control.forEach((p, i) => {
    const q = vp.worldToCanvas([p[0], p[1], pano.curve.z]);
    const d = Math.hypot(q[0] - canvasPos[0], q[1] - canvasPos[1]);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

// ------------------------------------------------------------------ telerradiografía simulada (v0.8.1)
// Proyección del CBCT con rayos paralelos (núcleo en core/telerx.js): lateral / frontal, radiografía / MIP,
// inclinación en 2D, brillo/contraste arrastrando y medidas por toques como en la panorámica.
let teleBusy = false, teleTool = null, telePts = [], teleCur = null, teleMeasDrag = null;
const teleName = (view) => `${t('layout_tele')} ${t(view === 'lat' ? 'tele_lat' : 'tele_pa').toLowerCase()}`;

/** Calcula (una pasada por vista; el núcleo la guarda en caché) y pinta la telerx. opts = { view, mode, tilt, silent }. */
async function showTelerx(opts = {}) {
  if (!current || teleBusy) return null;
  teleBusy = true;
  let tele = null;
  try {
    const cached = V.state.tele && V.state.tele.cache[opts.view || V.state.tele.view];
    if (!cached) setStatus(t('st_tele_building', { p: 0 }));
    tele = await V.buildTele(opts, (p) => setStatus(t('st_tele_building', { p: Math.round(p * 100) })));
    syncTeleControls();
    drawTele();
    if (tele && (!cached || !opts.silent)) setStatus(t('st_tele_done', { v: t(tele.view === 'lat' ? 'tele_lat' : 'tele_pa'), m: t(tele.mode === 'ray' ? 'tele_ray' : 'tele_mip'), w: (tele.image.width * tele.image.step).toFixed(0), h: (tele.image.height * tele.image.step).toFixed(0) }));
  } catch (e) { console.error(e); setStatus(t('st_error', { msg: e.message || e })); }
  teleBusy = false;
  return tele;
}
function syncTeleControls() {
  const tele = V.state.tele; if (!tele) return;
  $('#tele-lat').setAttribute('aria-pressed', String(tele.view === 'lat')); $('#tele-pa').setAttribute('aria-pressed', String(tele.view === 'pa'));
  $('#tele-ray').setAttribute('aria-pressed', String(tele.mode === 'ray')); $('#tele-mip').setAttribute('aria-pressed', String(tele.mode === 'mip'));
  $('#tele-tilt').value = tele.tilt; $('#tele-tilt-val').textContent = (tele.tilt > 0 ? '+' : '') + tele.tilt + '°';
  teleLetters();
}
/** Letras de orientación: lateral P / A (cara a la derecha); frontal D / I (se mira al paciente de frente). */
function teleLetters() {
  const ol = $('#tele-ol'); if (!ol) return;
  const lat = !V.state.tele || V.state.tele.view === 'lat', en = getLang() === 'en';
  ol.textContent = lat ? 'P' : (en ? 'R' : 'D'); $('#tele-or').textContent = lat ? 'A' : (en ? 'L' : 'I');
}
function drawTele() {
  const tele = V.state.tele; if (!tele || !tele.image) return;
  const cv = $('#tele-canvas'), img = tele.image;
  V.drawTelerx(cv, img, V.getTeleWindow(), drawZoom(cv, img.width, img.height));
  const list = V.getTeleMeas().slice();
  if (teleMeasDrag && teleMeasDrag.mode === 'new' && teleMeasDrag.b) list.push({ a: teleMeasDrag.a, b: teleMeasDrag.b, color: teleMeasDrag.color, live: true });
  const color = V.MEAS_COLORS[atmMeasN % V.MEAS_COLORS.length];
  if (telePts.length === 1) list.push({ a: telePts[0], b: teleCur || telePts[0], color, live: true, noLabel: teleTool === 'ang' });
  else if (telePts.length === 2) list.push({ type: 'ang', a: telePts[0], v: telePts[1], b: teleCur || telePts[1], color, live: true });
  drawMeasures(cv, list, img.step);
  drawTeleRuler(cv, img);
  $('#tele-clear').classList.toggle('hidden', !V.getTeleMeas().length);
}
/** Herramienta de medida de la telerx (null = brillo/contraste): «Distancia» 2 toques, «Ángulo» 3 toques. */
function setTeleTool(tool) {
  teleTool = tool; telePts = []; teleMeasDrag = null;
  $('#tele-len').setAttribute('aria-pressed', String(tool === 'len'));
  $('#tele-ang').setAttribute('aria-pressed', String(tool === 'ang'));
  $('#tele-canvas').classList.toggle('measuring', !!tool);
  drawTele();
  setStatus(t(tool === 'len' ? 'st_tele_len' : tool === 'ang' ? 'st_tele_ang' : 'st_ready'));
}
function addTeleMeas(m) {
  const view = V.state.tele.view;
  V.addTeleMeas(m); atmMeasN++;
  V.history.record({ label: 'tele_meas',
    undo: () => { const l = V.state.tele && V.state.tele.meas[view]; if (l) { const i = l.indexOf(m); if (i >= 0) l.splice(i, 1); } drawTele(); },
    redo: () => { if (V.state.tele) (V.state.tele.meas[view] || (V.state.tele.meas[view] = [])).push(m); drawTele(); } });
  refreshHistoryButtons(); drawTele();
  setStatus(t(m.type === 'ang' ? 'st_tele_meas_ang' : 'st_tele_meas', { v: measText(m, V.state.tele.image.step) }));
}
/**
 * Telerx de una vista y modo concretos a alta resolución, con su inclinación, sus medidas y la regla (informe).
 * Si esa vista aún no se ha calculado, se calcula (y se deja la vista/modo que había).
 */
async function teleFigureFor(view, mode) {
  if (!current) return null;
  const prev = V.state.tele && V.state.tele.image ? { view: V.state.tele.view, mode: V.state.tele.mode } : null;
  if (!V.state.tele || !V.state.tele.cache[view]) { await V.buildTele({ view, mode }); if (prev) await V.buildTele(prev); else syncTeleControls(); }
  const tele = V.state.tele; if (!tele || !tele.cache[view]) return null;
  const base = tele.cache[view][mode] || tele.cache[view].ray;
  const img = tele.tilt ? V.rotateTeleImage(base, tele.tilt) : base;
  const cv = document.createElement('canvas');
  V.drawTelerx(cv, img, tele.win[mode] || { lower: 0, upper: 1000 }, Math.max(1, 1400 / img.width));
  drawMeasures(cv, tele.meas[view] || [], img.step, cv.width / 700);
  drawTeleRuler(cv, img, cv.width / 700);
  return cv.toDataURL('image/jpeg', 0.92);
}
/**
 * REGLA de referencia para cefalometría 2D (v0.8.2): dos escalas de 50 mm (horizontal y vertical) en la esquina
 * inferior izquierda, con marcas cada 5 mm (largas cada 10) y cifras. Va pintada sobre el canvas, así sale en
 * la captura y en el informe. No gira con la inclinación (es la escala de la imagen, no de la anatomía).
 */
function drawTeleRuler(cv, img, f = 1) {
  const g = cv.getContext('2d');
  const z = cv._imgZoom || 1, pxmm = z / img.step;                 // píxeles de canvas por mm
  const k = canvasScale(cv) * f;
  const L = 50, margin = 4 * pxmm;
  if (cv.width < (L + 12) * pxmm || cv.height < (L + 12) * pxmm) return;
  const x0 = margin, y0 = cv.height - margin;
  const col = '#FFD166', lw = 1.2 * k, fs = 10 * k;
  g.save();
  g.lineWidth = lw; g.strokeStyle = col; g.fillStyle = col;
  g.font = `600 ${fs.toFixed(1)}px Poppins, sans-serif`;
  g.shadowColor = 'rgba(0,0,0,.9)'; g.shadowBlur = 3 * k;
  // ejes
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + L * pxmm, y0); g.moveTo(x0, y0); g.lineTo(x0, y0 - L * pxmm); g.stroke();
  for (let mm = 0; mm <= L; mm += 5) {
    const big = mm % 10 === 0, len = (big ? 3 : 1.8) * pxmm;
    g.beginPath(); g.moveTo(x0 + mm * pxmm, y0); g.lineTo(x0 + mm * pxmm, y0 - len); g.stroke();
    g.beginPath(); g.moveTo(x0, y0 - mm * pxmm); g.lineTo(x0 + len, y0 - mm * pxmm); g.stroke();
    if (big && mm) {
      g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(String(mm), x0 + mm * pxmm, y0 - len - 2 * k);
      g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(String(mm), x0 + len + 3 * k, y0 - mm * pxmm);
    }
  }
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('mm · 1:1', x0 + 3 * k, y0 + 3 * k > cv.height - fs ? y0 - 3 * pxmm - fs : y0 + 2 * k);
  g.restore();
}

// ------------------------------------------------------------------ disposición (multipantalla)
function applyLayout(name, remember = true) {
  if (name === 'vpAtm' && !V.state.tmj) name = 'quad';      // sin cortes de ATM calculados no hay nada que enseñar
  if (remember) layout = name;
  maximized = null;
  const grid = $('#grid');
  const all = Object.values(V.VP);
  let visible = all;
  if (name === 'quad') grid.dataset.layout = 'quad';
  else if (name === 'main3') grid.dataset.layout = 'main3';
  else if (name === 'row') grid.dataset.layout = 'row';
  else if (name === 'panEdit') { grid.dataset.layout = 'pair'; visible = ['vpAx', 'vpPan']; }   // editar la curva
  else { grid.dataset.layout = 'single'; visible = [name]; }
  for (const id of [...all, 'vpPan', 'vpTele', 'vpAtm']) grid.querySelector(`.vp[data-id="${id}"]`).classList.toggle('hidden', !visible.includes(id));
  $('#btn-cross').disabled = !CROSS_LAYOUTS.includes(name);    // sin cortes MPR no hay cruz (v0.7.12)
  $('#btn-cross').classList.toggle('hidden', !current || !CROSS_LAYOUTS.includes(name));   // v0.8.3: y además se esconde
  // v0.8.3: los botones de vista (Frontal…, Centrar, Rotación) solo cuando el render 3D está a la vista
  const show3d = visible.includes('vp3d');
  $$('#view-bar [data-view], #btn-center, #btn-rotate').forEach((b) => b.classList.toggle('hidden', !show3d));
  if (!show3d && rotTimer) { clearInterval(rotTimer); rotTimer = null; $('#btn-rotate').setAttribute('aria-pressed', 'false'); }
  $$('[data-layout]').forEach((b) => { if (b.tagName === 'BUTTON') b.classList.toggle('on', b.dataset.layout === (name === 'panEdit' ? 'vpPan' : name)); });
  requestAnimationFrame(() => V.resize());
  if (name === 'vpPan' || name === 'panEdit') { if (V.state.pano) drawPan(); else showPanoramic(); }   // ya calculada: solo repintar
  if (name === 'vpAtm') requestAnimationFrame(() => fitTmjAspect());
  if (name === 'vpTele') { if (V.state.tele && V.state.tele.image) drawTele(); else showTelerx(); }   // v0.8.1: se calcula la primera vez
}

function toggleMaximize(id) {
  if (!current) return;                       // solo escáneres: únicamente hay visor 3D
  // ya está solo en pantalla (por el botón ⤢ o por la barra de vistas): al minimizar o hacer doble clic,
  // se vuelve al 2×2 (petición de Manuel, v0.7.4)
  if (maximized === id || layout === id) { maximized = null; applyLayout(maximized_prev && maximized_prev !== id ? maximized_prev : 'quad'); return; }
  maximized_prev = layout;
  applyLayout(id);
  maximized = id;
}
let maximized_prev = 'quad';

function visibleViewports() {
  return Object.values(V.VP).filter((id) => !$(`.vp[data-id="${id}"]`).classList.contains('hidden'));
}

const vpShown = (id) => !$(`.vp[data-id="${id}"]`).classList.contains('hidden');

/**
 * PNG de lo que se está viendo. La panorámica y el mosaico de ATM NO son visores de Cornerstone, así que
 * `viewer.screenshot` no los veía y el botón de Captura no hacía nada (v0.7.7): se componen aparte a partir
 * de sus canvas.
 */
function shotPng() {
  if (vpShown('vpAtm')) return shotDom($('#atm-grid'));
  if (vpShown('vpPan')) return shotDom($('.vp[data-id="vpPan"] .pan-wrap'));
  if (vpShown('vpTele')) return shotDom($('.vp[data-id="vpTele"] .pan-wrap'));
  // 2×2 y demás disposiciones: también por lo que se VE. `viewer.screenshot` pegaba cada canvas a su tamaño
  // interno y el del render 3D no tiene el mismo que los de los cortes: en la captura salían los cortes
  // pequeños en una esquina (v0.7.15). Así además entran las siluetas de las mallas.
  return shotDom($('#grid'));
}

/**
 * Compone en un PNG los canvas (y los rótulos) que hay dentro de un trozo de la interfaz, cada uno en el
 * sitio y el tamaño en que se ve (los canvas van con `object-fit: contain`).
 */
function shotDom(root, wm = true) {
  const c = composeDom(root); if (!c) return null;
  if (wm) V.stampWatermark(c.out, watermark());
  return c.out.toDataURL('image/png');
}
/**
 * Como shotDom pero además pinta las capas SVG de Cornerstone (las medidas de los cortes MPR van en SVG, no
 * en el canvas), que exigen pasar por una imagen: por eso es asíncrona. La usa el informe (v0.8.0).
 */
async function shotDomAsync(root, wm = true) {
  const c = composeDom(root); if (!c) return null;
  const { out, g, s, r0 } = c;
  for (const svg of root.querySelectorAll('svg')) {
    const r = svg.getBoundingClientRect(); if (!r.width || !r.height || !svg.childElementCount) continue;
    try {
      const cl = svg.cloneNode(true);
      cl.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); cl.setAttribute('width', r.width); cl.setAttribute('height', r.height);
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(cl)], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image(); img.src = url; await img.decode();
      g.drawImage(img, (r.left - r0.left) * s, (r.top - r0.top) * s, r.width * s, r.height * s);
      URL.revokeObjectURL(url);
    } catch (e) { console.warn('capa SVG', e); }
  }
  if (wm) V.stampWatermark(out, watermark());
  return out.toDataURL('image/png');
}
function composeDom(root) {
  if (!root) return null;
  const r0 = root.getBoundingClientRect();
  if (!r0.width || !r0.height) return null;
  const s = Math.max(1, Math.min(2, 1500 / r0.width));
  const out = document.createElement('canvas');
  out.width = Math.round(r0.width * s); out.height = Math.round(r0.height * s);
  const g = out.getContext('2d');
  g.fillStyle = (getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg') || '').trim() || '#000';
  g.fillRect(0, 0, out.width, out.height);
  for (const cv of root.querySelectorAll('canvas')) {
    const r = cv.getBoundingClientRect();
    if (!r.width || !r.height || !cv.width || !cv.height) continue;
    const k = Math.min(r.width / cv.width, r.height / cv.height);       // object-fit: contain
    const w = cv.width * k, h = cv.height * k;
    g.drawImage(cv, (r.left - r0.left + (r.width - w) / 2) * s, (r.top - r0.top + (r.height - h) / 2) * s, w * s, h * s);
  }
  // rótulos del mosaico (van en HTML, no en el canvas): pastilla oscura + texto blanco, como en pantalla
  for (const el of root.querySelectorAll('.atm-cell > span, .atm-side')) {
    const tx = (el.textContent || '').trim(); if (!tx) continue;
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize) * s;
    const x = (r.left - r0.left) * s, y = (r.top - r0.top) * s;
    g.font = `600 ${fs.toFixed(1)}px Poppins, sans-serif`;
    g.textBaseline = 'top';
    if (el.tagName === 'SPAN') {
      g.fillStyle = 'rgba(0,0,0,.62)';
      g.fillRect(x, y, g.measureText(tx).width + 8 * s, fs * 1.5);
      g.fillStyle = '#fff';
      g.fillText(tx, x + 4 * s, y + fs * 0.25);
    } else {
      // «Derecha» / «Izquierda» van en VERTICAL en su columna (writing-mode), leyéndose de abajo arriba
      g.save();
      g.translate(x + (r.width * s) / 2, y + (r.height * s) / 2);
      g.rotate(-Math.PI / 2);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `800 ${fs.toFixed(1)}px Poppins, sans-serif`;
      g.fillStyle = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '').trim() || '#22E0FF';
      g.fillText(tx, 0, 0);
      g.restore();
    }
  }
  return { out, g, s, r0 };
}

// ------------------------------------------------------------------ panel derecho
function syncRenderControls() {
  const r = V.state.render;
  const [lo, hi] = V.state.range;
  const lvl = $('#dicom-level'), win = $('#dicom-window');
  lvl.min = Math.floor(lo); lvl.max = Math.ceil(hi); lvl.value = Math.round((r.lo + r.hi) / 2);
  win.min = 50; win.max = Math.ceil(Math.max(200, hi - lo)); win.value = Math.round(r.hi - r.lo);
  $('#dicom-op').value = Math.round(r.opacity * 100);
  $('#dicom-vis').checked = r.visible;
  $('#dicom-preset').value = r.preset;
}

function resetCutUI() {
  for (const ax of ['x', 'y', 'z']) $(`#cut-${ax}`).checked = false;
  $('#cut-flip').checked = false; $('#cut-flip').disabled = true;
  $('#cut-slider').value = 50; $('#cut-slider').disabled = true;
}

function applyCut(changedAxis) {
  // un solo plano a la vez (como VOXEL): al marcar uno se desmarcan los otros
  if (changedAxis) for (const ax of ['x', 'y', 'z']) if (ax !== changedAxis) $(`#cut-${ax}`).checked = false;
  const axis = ['x', 'y', 'z'].find((ax) => $(`#cut-${ax}`).checked) || null;
  $('#cut-flip').disabled = !axis; $('#cut-slider').disabled = !axis;
  if (!axis) $('#cut-flip').checked = false;
  V.setCut({ axis, frac: $('#cut-slider').value / 100, flip: $('#cut-flip').checked });
}

function setMeasureMode(mode) {
  const cur = V.state.measureMode;
  const next = mode && cur === mode ? null : mode;          // pulsar el activo lo desactiva
  V.setMeasureMode(next);
  $('#grid').classList.toggle('measuring', !!next);
  $('#btn-dist').setAttribute('aria-pressed', String(next === 'linear'));
  $('#btn-ang').setAttribute('aria-pressed', String(next === 'angle'));
  setStatus(next ? t(next === 'linear' ? 'st_measure_dist' : 'st_measure_ang') : t('st_ready'));
}

// ------------------------------------------------------------------ eventos
function wireUI() {
  // arrastrar y soltar (el recuadro central y toda la ventana; el del panel izquierdo se quitó en v0.7.13
  // por repetido)
  for (const el of [$('#main-drop'), document.body]) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); if (el.classList.contains('drop')) el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault(); el.classList.remove('over');
      const entries = await collectFromDataTransfer(e.dataTransfer);
      if (entries.length) ingest(entries);
    });
  }
  $('#main-drop').addEventListener('click', () => $('#in-folder').click());
  $('#btn-folder').addEventListener('click', () => $('#in-folder').click());
  $('#btn-files').addEventListener('click', () => $('#in-files').click());
  $('#btn-zip').addEventListener('click', () => $('#in-zip').click());
  $('#btn-mesh').addEventListener('click', () => $('#in-mesh').click());
  $('#btn-seg').addEventListener('click', async () => { if (busy) return; busy = true; try { await runSegmentation(); } catch (e) { console.error(e); setStatus(t('st_error', { msg: e.message || e })); } busy = false; });
  $('#btn-photo').addEventListener('click', () => $('#in-photo').click());
  $('#in-photo').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f || busy) return; busy = true; try { await ingestPhoto(f); } catch (err) { console.error(err); setStatus(t('st_error', { msg: err.message || err })); } busy = false; });
  // registro manual de la foto: clic (sin arrastre) sobre la piel 3D
  let mdown = null;
  $('#vp3d').addEventListener('pointerdown', (e) => { if (e.button === 0) mdown = [e.clientX, e.clientY]; });
  $('#vp3d').addEventListener('pointerup', (e) => {
    if ((!manualPick && !pointAlign) || e.button !== 0 || !mdown) return;
    const moved = Math.hypot(e.clientX - mdown[0], e.clientY - mdown[1]); mdown = null;
    if (moved > 4) return;
    const r = $('#vp3d').getBoundingClientRect();
    const pos = [e.clientX - r.left, e.clientY - r.top];
    if (pointAlign) pointAlignPicked(pos); else manualPointPicked(pos);
  });
  $('#pa-undo').addEventListener('click', (e) => { e.stopPropagation(); undoPointAlign(); });
  $('#pa-cancel').addEventListener('click', (e) => { e.stopPropagation(); cancelPointAlign(); });
  for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'click']) $('#pa-bar').addEventListener(ev, (e) => e.stopPropagation());
  $('#sil-vis').addEventListener('change', (e) => { const on = e.target.checked; V.setSilhouettes(on); V.history.record({ label: 'silh', undo: () => V.setSilhouettes(!on), redo: () => V.setSilhouettes(on) }); });
  // vía aérea: 2 clics (sin arrastre) en el corte sagital
  $('#btn-airway').addEventListener('click', () => startAirway());
  let sdown = null;
  $('#vpSag').addEventListener('pointerdown', (e) => { if (e.button === 0) sdown = [e.clientX, e.clientY]; });
  $('#vpSag').addEventListener('pointerup', (e) => {
    if (!airwayPick || e.button !== 0 || !sdown) return;
    const moved = Math.hypot(e.clientX - sdown[0], e.clientY - sdown[1]); sdown = null;
    if (moved > 4) return;
    const r = $('#vpSag').getBoundingClientRect();
    airwayPicked([e.clientX - r.left, e.clientY - r.top]);
  });
  // dibujar la curva panorámica: clics (sin arrastre) sobre el corte axial
  $('#pan-draw').addEventListener('click', () => startPanDraw());
  let adown = null;
  $('#vpAx').addEventListener('pointerdown', (e) => { if (e.button === 0) adown = [e.clientX, e.clientY]; });
  $('#vpAx').addEventListener('pointerup', (e) => {
    if (!panDraw || e.button !== 0 || !adown) return;
    const moved = Math.hypot(e.clientX - adown[0], e.clientY - adown[1]); adown = null;
    if (moved > 4) return;
    const r = $('#vpAx').getBoundingClientRect();
    panDrawPicked([e.clientX - r.left, e.clientY - r.top]);
  });
  $('#pd-undo').addEventListener('click', (e) => { e.stopPropagation(); undoPanDraw(); });
  $('#pd-done').addEventListener('click', (e) => { e.stopPropagation(); finishPanDraw(); });
  $('#pd-cancel').addEventListener('click', (e) => { e.stopPropagation(); cancelPanDraw(); });
  $('#aw-undo').addEventListener('click', (e) => { e.stopPropagation(); undoAirway(); });
  $('#aw-cancel').addEventListener('click', (e) => { e.stopPropagation(); cancelAirway(); });
  $('#atm-undo').addEventListener('click', (e) => { e.stopPropagation(); undoTmj(); });
  $('#atm-cancel').addEventListener('click', (e) => { e.stopPropagation(); cancelTmj(); });
  // ATM: un clic sobre cada cóndilo, en cualquiera de los tres cortes
  $('#btn-atm').addEventListener('click', () => startTmj());
  $('#atm-redo').addEventListener('click', () => startTmj());
  for (const id of [V.VP.ax, V.VP.cor, V.VP.sag]) {
    const el = document.getElementById(id);
    let down = null;
    el.addEventListener('pointerdown', (e) => { if (e.button === 0) down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (!tmjPick || e.button !== 0 || !down) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]); down = null;
      if (moved > 4) return;
      const r = el.getBoundingClientRect();
      tmjPicked(id, [e.clientX - r.left, e.clientY - r.top]);
    });
  }
  // Sobre el mosaico de ATM: arrastrar = brillo/contraste (las etiquetas de las medidas se arrastran; medir
  // se hace en el corte ampliado, v0.7.14); rueda = moverse por los cortes de esa familia, de mm en mm.
  const grid = $('#atm-grid');
  let tdrag = null;
  grid.addEventListener('wheel', atmWheel, { passive: false });
  grid.addEventListener('contextmenu', (e) => { if (V.state.tmj) e.preventDefault(); });
  grid.addEventListener('click', (e) => {
    const z = e.target.closest('.atm-zoom'); if (!z) return;
    const cell = z.closest('.atm-cell'); if (!cell) return;
    e.stopPropagation();
    openAtmBig(cell.dataset.side, cell.dataset.key);
  });
  grid.addEventListener('dblclick', (e) => {
    const cell = e.target.closest('.atm-cell:not(.atm-gap)'); if (!cell) return;
    openAtmBig(cell.dataset.side, cell.dataset.key);
  });
  $('#atm-poles').addEventListener('click', openPolesDialog);
  // DOBLE CLIC = ampliar el corte. No vale el evento `dblclick`: este `pointerdown` llama a
  // preventDefault() (para arrastrar el brillo sin seleccionar texto) y eso cancela los eventos de ratón
  // de compatibilidad, incluido el doble clic (v0.7.7). Se detecta a mano.
  let lastTap = { t: 0, key: '' };
  grid.addEventListener('pointerdown', (e) => {
    if (!V.state.tmj || e.target.closest('.atm-zoom')) return;
    const cell = e.target.closest('.atm-cell:not(.atm-gap)');
    if (cell && e.button === 0) {
      const key = cell.dataset.side + '|' + cell.dataset.key, now = performance.now();
      if (lastTap.key === key && now - lastTap.t < 450) {
        lastTap = { t: 0, key: '' };
        openAtmBig(cell.dataset.side, cell.dataset.key);
        e.preventDefault();
        return;
      }
      lastTap = { t: now, key };
    }
    atmDown(e);                                   // mover una etiqueta
    if (atmDrag) return;
    tdrag = { x: e.clientX, y: e.clientY, w: V.getTmjWindow() }; grid.setPointerCapture(e.pointerId); e.preventDefault();
  });
  grid.addEventListener('pointermove', (e) => {
    if (tdrag) {
      const w0 = tdrag.w, ww = Math.max(20, (w0.upper - w0.lower) + (e.clientX - tdrag.x) * 6), wl = (w0.upper + w0.lower) / 2 + (e.clientY - tdrag.y) * 6;
      V.setTmjWindow({ lower: wl - ww / 2, upper: wl + ww / 2 }); redrawTmj();
    } else atmMove(e);
  });
  const tend = () => { if (tdrag) { tdrag = null; return; } atmUp(); };
  grid.addEventListener('pointerup', tend); grid.addEventListener('pointercancel', tend);
  // exportar mallas: botón del panel derecho y clic derecho sobre el propio panel
  $('#btn-export').addEventListener('click', exportMeshesDialog);
  $('#vispanel').addEventListener('contextmenu', (e) => {
    if (!V.getMeshes().length) return;
    e.preventDefault();
    exportMeshesDialog();
  });
  $('#atm-clear').addEventListener('click', () => {
    const prev = V.getAllTmjMeas();
    V.clearTmjMeas(); redrawTmj();
    V.history.record({ label: 'atm_meas_clear', undo: () => { V.setTmjMeas(prev); redrawTmj(); }, redo: () => { V.clearTmjMeas(); redrawTmj(); } });
    refreshHistoryButtons();
    setStatus(t('st_atm_meas_clear'));
  });
  for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'click']) for (const id of ['#aw-bar', '#atm-bar', '#pd-bar', '#pe-bar']) $(id).addEventListener(ev, (e) => e.stopPropagation());
  // deshacer / rehacer
  $('#btn-undo').addEventListener('click', () => doUndo());
  $('#btn-redo').addEventListener('click', () => doRedo());
  // cruz de referencia en los cortes
  $('#btn-cross').addEventListener('click', () => {
    const on = V.setCrosshairs($('#btn-cross').getAttribute('aria-pressed') !== 'true');
    $('#btn-cross').setAttribute('aria-pressed', String(on));
    setStatus(t(on ? 'st_cross_on' : 'st_cross_off'));
  });
  // panorámica: grosor, MIP, curva sobre el axial; brillo/contraste arrastrando sobre la imagen
  $('#pan-thick').addEventListener('input', (e) => { $('#pan-thick-val').textContent = e.target.value + ' mm'; showPanoramic({ silent: true }); });
  $('#pan-mip').addEventListener('change', () => showPanoramic());
  $('#pan-curve').addEventListener('change', (e) => V.setArchVisible(e.target.checked));
  $('#pan-edit').addEventListener('click', () => setPanoEdit(!panEdit));
  $('#pe-done').addEventListener('click', () => setPanoEdit(false));
  $('#pe-reset').addEventListener('click', () => $('#pan-reset').click());
  $('#pan-clear').addEventListener('click', () => {
    const prev = V.getPanoMeas().slice();
    if (!prev.length) return;
    V.clearPanoMeas(); drawPan();
    V.history.record({ label: 'pan_meas_clear', undo: () => { V.setPanoMeas(prev); drawPan(); }, redo: () => { V.clearPanoMeas(); drawPan(); } });
    refreshHistoryButtons();
    setStatus(t('st_pan_meas_clear'));
  });
  $('#pan-reset').addEventListener('click', async () => {
    const prev = V.getPanoControl();
    await showPanoramic({ recompute: true });
    const next = V.getPanoControl();
    if (prev && next) V.history.record({ label: 'pan_curve', undo: () => { V.setPanoControl(prev); showPanoramic({ silent: true }); }, redo: () => { V.setPanoControl(next); showPanoramic({ silent: true }); } });
    setStatus(t('st_pan_reset'));
  });
  // arrastrar los puntos de control sobre el corte axial (fase de captura: así no gana el brillo/contraste)
  const axEl = $('#vpAx');
  axEl.addEventListener('pointerdown', (e) => {
    if (!panEdit || e.button !== 0) return;
    const r = axEl.getBoundingClientRect();
    const i = panControlAt([e.clientX - r.left, e.clientY - r.top]);
    if (i == null) return;
    e.stopPropagation(); e.preventDefault();
    panDrag = { i, before: V.getPanoControl() };
    axEl.setPointerCapture(e.pointerId);
  }, true);
  axEl.addEventListener('pointermove', (e) => {
    if (!panDrag) return;
    e.stopPropagation(); e.preventDefault();
    const r = axEl.getBoundingClientRect();
    const w = V.pickOnMpr(V.VP.ax, [e.clientX - r.left, e.clientY - r.top]);
    if (w) V.movePanoControl(panDrag.i, w[0], w[1]);
  }, true);
  const panEnd = (e) => {
    if (!panDrag) return;
    e.stopPropagation();
    const before = panDrag.before; panDrag = null;
    const after = V.getPanoControl();
    V.history.record({ label: 'pan_curve', undo: () => { V.setPanoControl(before); showPanoramic({ silent: true }); }, redo: () => { V.setPanoControl(after); showPanoramic({ silent: true }); } });
    showPanoramic({ silent: true });
  };
  axEl.addEventListener('pointerup', panEnd, true);
  axEl.addEventListener('pointercancel', panEnd, true);
  let pdrag = null;
  // doble clic sobre la panorámica: vuelve al 2×2 (petición de Manuel, v0.7.8)
  $('#pan-canvas').addEventListener('dblclick', () => { if (panEdit) setPanoEdit(false); applyLayout('quad'); });
  $('#pan-len').addEventListener('click', () => setPanTool(panTool === 'len' ? null : 'len'));
  $('#pan-ang').addEventListener('click', () => setPanTool(panTool === 'ang' ? null : 'ang'));
  // medir en la panorámica: SIN Mayús (v0.7.17): botón «Distancia» = 2 toques (o arrastrar), «Ángulo» = 3 toques;
  // las etiquetas se arrastran siempre; sin botón, arrastrar = brillo/contraste
  $('#pan-canvas').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const cv = $('#pan-canvas');
    if (V.state.pano) {
      const p = atmPos(cv, e);
      const lab = measAtLabel(V.getPanoMeas(), cv, p);
      if (lab) panMeasDrag = { mode: 'label', m: lab, p0: p, lab0: (lab.lab || [0, 0]).slice() };
      else if (panTool) panMeasDrag = { mode: 'tap', p0: p, a: p, b: null, x: e.clientX, y: e.clientY, color: V.MEAS_COLORS[atmMeasN % V.MEAS_COLORS.length] };
      if (panMeasDrag) { cv.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    }
    pdrag = { x: e.clientX, y: e.clientY, w: V.getPanoWindow() }; e.target.setPointerCapture(e.pointerId);
  });
  $('#pan-canvas').addEventListener('pointermove', (e) => {
    if (panTool && V.state.pano) { panCur = atmPos($('#pan-canvas'), e); if (panPts.length && !panMeasDrag) drawPan(); }
    if (panMeasDrag) {
      const p = atmPos($('#pan-canvas'), e), d = panMeasDrag;
      if (d.mode === 'tap' && panTool === 'len' && !panPts.length && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.mode = 'new';
      if (d.mode === 'label') d.m.lab = [d.lab0[0] + (p[0] - d.p0[0]), d.lab0[1] + (p[1] - d.p0[1])];
      else if (d.mode === 'new') d.b = p;
      drawPan();
      return;
    }
    if (!pdrag) return;
    const w0 = pdrag.w, ww = Math.max(20, (w0.upper - w0.lower) + (e.clientX - pdrag.x) * 4), wl = (w0.upper + w0.lower) / 2 + (e.clientY - pdrag.y) * 4;
    V.setPanoWindow({ lower: wl - ww / 2, upper: wl + ww / 2 }); drawPan();
  });
  const pend = (e) => {
    if (panMeasDrag) {
      const d = panMeasDrag; panMeasDrag = null;
      const step = V.state.pano.image.step;
      if (d.mode === 'tap') {                       // un toque suelto añade un punto: 2 para distancia, 3 para ángulo
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) { drawPan(); return; }
        panPts.push(d.p0);
        const need = panTool === 'ang' ? 3 : 2;
        if (panPts.length < need) { drawPan(); setStatus(t(panTool === 'ang' ? (panPts.length === 1 ? 'st_pan_ang2' : 'st_pan_ang3') : 'st_pan_len2')); return; }
        const pts = panPts; panPts = [];
        if (panTool === 'ang') addPanMeas({ type: 'ang', a: pts[0], v: pts[1], b: pts[2], color: d.color, lab: [0, 0] });
        else if (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) * step >= 1) addPanMeas({ a: pts[0], b: pts[1], color: d.color, lab: [0, 0] });
        else drawPan();
        return;
      }
      if (d.mode === 'label' || !d.b) { drawPan(); return; }
      if (Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) * step < 1) { drawPan(); return; }
      addPanMeas({ a: d.a, b: d.b, color: d.color, lab: [0, 0] });
      return;
    }
    if (!pdrag) return; const w0 = pdrag.w, w1 = V.getPanoWindow(); pdrag = null; if (Math.abs(w0.lower - w1.lower) > 0.5 || Math.abs(w0.upper - w1.upper) > 0.5) V.history.record({ label: 'mprwin', undo: () => { V.setPanoWindow(w0); drawPan(); }, redo: () => { V.setPanoWindow(w1); drawPan(); } }); };
  $('#pan-canvas').addEventListener('pointerup', pend); $('#pan-canvas').addEventListener('pointercancel', pend);
  // telerradiografía (v0.8.1): vista, modo, inclinación (con deshacer), medidas por toques y brillo/contraste arrastrando
  $('#tele-lat').addEventListener('click', () => showTelerx({ view: 'lat' }));
  $('#tele-pa').addEventListener('click', () => showTelerx({ view: 'pa' }));
  $('#tele-ray').addEventListener('click', () => showTelerx({ mode: 'ray' }));
  $('#tele-mip').addEventListener('click', () => showTelerx({ mode: 'mip' }));
  let tilt0 = null;
  $('#tele-tilt').addEventListener('input', (e) => {
    const d = +e.target.value; $('#tele-tilt-val').textContent = (d > 0 ? '+' : '') + d + '°';
    if (!V.state.tele) return;
    if (tilt0 === null) tilt0 = V.state.tele.tilt;
    V.setTeleTilt(d); drawTele();
  });
  $('#tele-tilt').addEventListener('change', () => {
    if (!V.state.tele || tilt0 === null) return;
    const a = tilt0, b = V.state.tele.tilt; tilt0 = null;
    if (a === b) return;
    const go = (v) => { if (V.state.tele) { V.setTeleTilt(v); syncTeleControls(); drawTele(); } };
    V.history.record({ label: 'tele_tilt', undo: () => go(a), redo: () => go(b) });
    refreshHistoryButtons();
    setStatus(t('st_tele_tilt', { d: (b > 0 ? '+' : '') + b }));
  });
  $('#tele-canvas').addEventListener('dblclick', () => applyLayout('quad'));
  $('#tele-len').addEventListener('click', () => setTeleTool(teleTool === 'len' ? null : 'len'));
  $('#tele-ang').addEventListener('click', () => setTeleTool(teleTool === 'ang' ? null : 'ang'));
  $('#tele-clear').addEventListener('click', () => {
    const prev = V.getTeleMeas().slice(); if (!prev.length) return;
    const view = V.state.tele.view;
    V.clearTeleMeas(); drawTele();
    V.history.record({ label: 'tele_meas_clear', undo: () => { if (V.state.tele) V.state.tele.meas[view] = prev; drawTele(); }, redo: () => { if (V.state.tele) V.state.tele.meas[view] = []; drawTele(); } });
    refreshHistoryButtons(); setStatus(t('st_tele_meas_clear'));
  });
  let teleDrag = null;
  $('#tele-canvas').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !V.state.tele || !V.state.tele.image) return;
    const cv = $('#tele-canvas');
    const p = atmPos(cv, e);
    const lab = measAtLabel(V.getTeleMeas(), cv, p);
    if (lab) teleMeasDrag = { mode: 'label', m: lab, p0: p, lab0: (lab.lab || [0, 0]).slice() };
    else if (teleTool) teleMeasDrag = { mode: 'tap', p0: p, a: p, b: null, x: e.clientX, y: e.clientY, color: V.MEAS_COLORS[atmMeasN % V.MEAS_COLORS.length] };
    if (teleMeasDrag) { cv.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    teleDrag = { x: e.clientX, y: e.clientY, w: V.getTeleWindow() }; cv.setPointerCapture(e.pointerId);
  });
  $('#tele-canvas').addEventListener('pointermove', (e) => {
    if (!V.state.tele || !V.state.tele.image) return;
    if (teleTool) { teleCur = atmPos($('#tele-canvas'), e); if (telePts.length && !teleMeasDrag) drawTele(); }
    if (teleMeasDrag) {
      const p = atmPos($('#tele-canvas'), e), d = teleMeasDrag;
      if (d.mode === 'tap' && teleTool === 'len' && !telePts.length && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.mode = 'new';
      if (d.mode === 'label') d.m.lab = [d.lab0[0] + (p[0] - d.p0[0]), d.lab0[1] + (p[1] - d.p0[1])];
      else if (d.mode === 'new') d.b = p;
      drawTele();
      return;
    }
    if (!teleDrag) return;
    const w0 = teleDrag.w, ww = Math.max(20, (w0.upper - w0.lower) + (e.clientX - teleDrag.x) * 4), wl = (w0.upper + w0.lower) / 2 + (e.clientY - teleDrag.y) * 4;
    V.setTeleWindow({ lower: wl - ww / 2, upper: wl + ww / 2 }); drawTele();
  });
  const teleEnd = (e) => {
    if (teleMeasDrag) {
      const d = teleMeasDrag; teleMeasDrag = null;
      const step = V.state.tele.image.step;
      if (d.mode === 'tap') {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) { drawTele(); return; }
        telePts.push(d.p0);
        const need = teleTool === 'ang' ? 3 : 2;
        if (telePts.length < need) { drawTele(); setStatus(t(teleTool === 'ang' ? (telePts.length === 1 ? 'st_pan_ang2' : 'st_pan_ang3') : 'st_pan_len2')); return; }
        const pts = telePts; telePts = [];
        if (teleTool === 'ang') addTeleMeas({ type: 'ang', a: pts[0], v: pts[1], b: pts[2], color: d.color, lab: [0, 0] });
        else if (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) * step >= 1) addTeleMeas({ a: pts[0], b: pts[1], color: d.color, lab: [0, 0] });
        else drawTele();
        return;
      }
      if (d.mode === 'label' || !d.b) { drawTele(); return; }
      if (Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) * step < 1) { drawTele(); return; }
      addTeleMeas({ a: d.a, b: d.b, color: d.color, lab: [0, 0] });
      return;
    }
    if (!teleDrag) return; const w0 = teleDrag.w, w1 = V.getTeleWindow(); teleDrag = null; if (Math.abs(w0.lower - w1.lower) > 0.5 || Math.abs(w0.upper - w1.upper) > 0.5) V.history.record({ label: 'mprwin', undo: () => { V.setTeleWindow(w0); drawTele(); }, redo: () => { V.setTeleWindow(w1); drawTele(); } });
  };
  $('#tele-canvas').addEventListener('pointerup', teleEnd); $('#tele-canvas').addEventListener('pointercancel', teleEnd);
  for (const id of ['#in-folder', '#in-files', '#in-zip', '#in-mesh']) {
    $(id).addEventListener('change', (e) => { const list = collectFromFileList(e.target.files); e.target.value = ''; if (list.length) ingest(list); });
  }

  // vistas y disposición
  $$('#view-bar [data-view]').forEach((b) => b.addEventListener('click', () => V.setView(b.dataset.view)));
  $('#btn-center').addEventListener('click', () => V.centerAll());
  $$('#view-bar [data-layout]').forEach((b) => b.addEventListener('click', () => { if (panDraw) cancelPanDraw(true); if (panEdit && b.dataset.layout !== 'vpPan') setPanoEdit(false); applyLayout(b.dataset.layout); }));
  $$('.vpmax').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); toggleMaximize(b.dataset.max); }));
  // deslizadores de corte en los MPR (v0.8.2): para tabletas y ratones sin rueda
  $('#btn-orient').addEventListener('click', () => {
    const box = $('#orient-box'), on = box.classList.toggle('hidden') === false;
    $('#btn-orient').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) { syncOrientControls(); setStatus(t('st_orient_tip')); }
  });
  for (const ax of ['x', 'y', 'z']) {
    $(`#or-${ax}`).addEventListener('input', applyOrientLive);
    $(`#or-${ax}`).addEventListener('change', finishOrient);
  }
  $('#or-reset').addEventListener('click', () => { for (const ax of ['x', 'y', 'z']) $(`#or-${ax}`).value = 0; syncOrientLabels(); finishOrient(); });
  $$('.vslice').forEach((sl) => {
    const id = sl.dataset.vp;
    sl.addEventListener('pointerdown', () => { sl.dataset.drag = '1'; });
    const end = () => { delete sl.dataset.drag; };
    sl.addEventListener('pointerup', end); sl.addEventListener('pointercancel', end); sl.addEventListener('blur', end);
    sl.addEventListener('input', () => V.setSliceIndex(id, +sl.value));
    sl.addEventListener('dblclick', (e) => e.stopPropagation());
  });
  $$('.vp .vplabel').forEach((l) => l.parentElement.addEventListener('dblclick', (e) => {
    if (e.target.closest('.cs') && !V.state.measureMode) toggleMaximize(l.parentElement.dataset.id);
  }));

  // barra superior
  $('#btn-theme').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#btn-font').addEventListener('click', (e) => fontMenu(e.currentTarget));
  $$('.pin').forEach((b) => b.addEventListener('click', () => togglePanel(b.dataset.pin)));
  wirePanelTabs();
  $('#btn-lang').addEventListener('click', () => { setLang(getLang() === 'es' ? 'en' : 'es'); afterLangChange(); });
  $$('.legal-links a[data-legal]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showLegal(a.dataset.legal, { onLang: afterLangChange }); }));
  $('#btn-feedback').addEventListener('click', () => openFeedback());
  $('#patient-chip').addEventListener('click', () => { if (!current) return; chipHidden = !chipHidden; renderChip(); });
  $('#btn-new').addEventListener('click', newCaseDialog);
  $('#btn-report').addEventListener('click', openReportDialog);
  $('#btn-save').addEventListener('click', saveSession);
  $('#btn-share').addEventListener('click', shareDialog);
  $('#btn-open').addEventListener('click', () => $('#in-session').click());
  // «📂 Abrir» acepta también un paquete .tresdz (o un ZIP): va por la ruta de importación normal (v0.8.4)
  $('#in-session').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    // v0.8.5: se decide por el CONTENIDO, no por la extensión (un ZIP renombrado o «.ZIP » también entra)
    const kind = /\.(tresdz|zip)$/i.test(f.name.trim()) ? 'zip' : (/\.rar$/i.test(f.name.trim()) ? 'rar' : await sniffArchive(f));
    if (kind === 'zip' || kind === 'rar') ingest(collectFromFileList([f]));
    else if (kind) setStatus(t('st_archive_other', { k: kind.toUpperCase(), n: f.name }));
    else await loadSessionFile(f);
  });
  $('#drop-open').addEventListener('click', (e) => { e.stopPropagation(); $('#in-session').click(); });   // también un ZIP con el CBCT
  $('#drop-folder').addEventListener('click', (e) => { e.stopPropagation(); $('#in-folder').click(); });
  // v0.8.5: instalada como aplicación (manifest con file_handlers), Windows abre los .tresdz / .tresd con doble clic
  if ('launchQueue' in window && window.launchQueue && window.launchQueue.setConsumer) {
    window.launchQueue.setConsumer(async (params) => {
      try {
        const files = [];
        for (const h of params.files || []) { try { files.push(await h.getFile()); } catch (e) { /* nada */ } }
        if (files.length) ingest(files.map((f) => ({ file: f, path: f.name })));
      } catch (e) { console.warn('launchQueue', e); }
    });
  }
  $('#btn-patient-edit').addEventListener('click', editPatientDialog);
  $('#btn-help').addEventListener('click', openHelp);
  $('#btn-shot').addEventListener('click', () => {
    const url = shotPng();
    if (!url) return;
    fetch(url).then((r) => r.blob()).then((b) => download(b, 'tresD_DICOM_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png'));
    setStatus(t('st_shot_saved'));
  });
  $('#btn-rotate').addEventListener('click', () => {
    const on = $('#btn-rotate').getAttribute('aria-pressed') !== 'true';
    $('#btn-rotate').setAttribute('aria-pressed', String(on));
    clearInterval(rotTimer); rotTimer = null;
    if (on) rotTimer = setInterval(() => V.rotateStep(1.0), 30);
  });
  $('#btn-meta').addEventListener('click', () => $('#meta-drawer').classList.toggle('open'));
  $('#meta-close').addEventListener('click', () => $('#meta-drawer').classList.remove('open'));
  $('#meta-search').addEventListener('input', (e) => renderTable(e.target.value));
  $('#meta-json').addEventListener('click', () => current && exportJSON(current));
  $('#meta-csv').addEventListener('click', () => current && exportCSV(current));

  // panel derecho: DICOM (cada cambio se apunta para deshacer: los deslizadores, al soltar)
  const renderSnap = () => ({ ...V.state.render, tune: undefined });
  const restoreRender = (r) => { Object.assign(V.state.render, { preset: r.preset, lo: r.lo, hi: r.hi, opacity: r.opacity, visible: r.visible }); V.applyRender(); syncRenderControls(); };
  let rStart = null;
  const rBegin = () => { if (rStart == null) rStart = renderSnap(); };
  const rEnd = (label) => { const prev = rStart || renderSnap(), next = renderSnap(); rStart = null; if (JSON.stringify(prev) !== JSON.stringify(next)) V.history.record({ label, undo: () => restoreRender(prev), redo: () => restoreRender(next) }); };
  $('#dicom-vis').addEventListener('change', (e) => { rBegin(); V.setVolumeVisible(e.target.checked); rEnd('dicom_vis'); });
  $('#dicom-op').addEventListener('input', (e) => { rBegin(); V.setOpacity(e.target.value / 100); });
  $('#dicom-op').addEventListener('change', () => rEnd('dicom_op'));
  $('#dicom-level').addEventListener('input', (e) => { rBegin(); V.setRenderWindow({ level: +e.target.value }); });
  $('#dicom-level').addEventListener('change', () => rEnd('window'));
  $('#dicom-window').addEventListener('input', (e) => { rBegin(); V.setRenderWindow({ window: +e.target.value }); });
  $('#dicom-window').addEventListener('change', () => rEnd('window'));
  $('#dicom-preset').addEventListener('change', (e) => { rBegin(); V.setPreset(e.target.value); syncRenderControls(); rEnd('preset'); });
  $('#dicom-del').addEventListener('click', async () => {
    clearInterval(rotTimer); rotTimer = null; $('#btn-rotate').setAttribute('aria-pressed', 'false');
    if (manualPick) cancelManual();
    if (pointAlign) cancelPointAlign(true);
    if (airwayPick) cancelAirway(true);
    if (tmjPick) cancelTmj(true);
    if (panDraw) cancelPanDraw(true);
    V.clearTmj(); renderTmj();
    if (panEdit) setPanoEdit(false);
    $('#btn-cross').setAttribute('aria-pressed', 'false');
    for (const m of V.getMeshes().filter((x) => x.seg)) { V.removeMesh(m.id, false); const c = $(`#mesh-cards .card[data-mesh="${m.id}"]`); if (c) c.remove(); }
    await V.removeVolume(); current = null; setHasCase(); setStatus(t('st_ready'));
    $('#lbl-import').textContent = t('nothing_yet');
    $('#meta-drawer').classList.remove('open');
  });
  // panel derecho: planos MPR en el 3D
  $('#mpr-card .ctitle').addEventListener('click', () => $('#mpr-card').classList.toggle('open'));
  for (const ax of ['x', 'y', 'z']) {
    const cb = $(`#mpr-${ax}`), sl = $(`#mpr-${ax}-sl`);
    cb.addEventListener('change', () => { sl.disabled = !cb.checked; V.setMprPlane(ax, cb.checked, sl.value / 100); });
    sl.addEventListener('input', () => { if (cb.checked) V.setMprPlane(ax, true, sl.value / 100); });
  }

  // herramientas: corte (se apunta al soltar el deslizador / cambiar casilla) y medición
  let cutStart = null;
  const cutBegin = () => { if (cutStart == null) cutStart = { ...V.state.cut }; };
  const cutEnd = () => { const prev = cutStart || { ...V.state.cut }, next = { ...V.state.cut }; cutStart = null; if (JSON.stringify(prev) !== JSON.stringify(next)) V.history.record({ label: 'cut', undo: () => { V.setCut(prev); syncCutUI(); }, redo: () => { V.setCut(next); syncCutUI(); } }); };
  for (const ax of ['x', 'y', 'z']) $(`#cut-${ax}`).addEventListener('change', () => { cutBegin(); applyCut(ax); cutEnd(); });
  $('#cut-flip').addEventListener('change', () => { cutBegin(); applyCut(null); cutEnd(); });
  $('#cut-slider').addEventListener('input', () => { cutBegin(); applyCut(null); });
  $('#cut-slider').addEventListener('change', () => cutEnd());
  $('#btn-dist').addEventListener('click', () => (V.hasCase() ? setMeasureMode('linear') : setStatus(t('st_need_dicom'))));
  $('#btn-ang').addEventListener('click', () => (V.hasCase() ? setMeasureMode('angle') : setStatus(t('st_need_dicom'))));
  $('#btn-clear').addEventListener('click', () => { V.clearMeasures(); setMeasureMode(null); });

  // teclado: Escape cancela la medición / cierra metadatos; Ctrl+Z / Ctrl+Y (o Ctrl+Mayús+Z) deshacen / rehacen
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (V.state.measureMode) setMeasureMode(null); if (manualPick) { cancelManual(); setStatus(t('st_ready')); } if (pointAlign) cancelPointAlign(); if (airwayPick) cancelAirway(); if (tmjPick) cancelTmj(); if (panDraw) cancelPanDraw(); if (atmBig && atmBig.pts.length) { atmBig.pts = []; atmBigHint(); drawAtmBig(); } if (panPts.length) { panPts = []; drawPan(); } if (telePts.length) { telePts = []; drawTele(); } $('#meta-drawer').classList.remove('open'); }
    const tag = (e.target && e.target.tagName) || '';
    if ((e.ctrlKey || e.metaKey) && !/INPUT|TEXTAREA|SELECT/.test(tag)) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); }
    }
  });
}

// ------------------------------------------------------------------ contador de visitas (GoatCounter)
// Gratis, sin cookies y sin datos personales: no necesita banner de consentimiento. No cuenta en
// localhost. Solo se registra la visita y dos eventos anónimos (CBCT cargado / escáner cargado).
const COUNTER = 'https://tresddicom.goatcounter.com/count';
function initCounter() {
  if (!COUNTER || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:') return;
  const sc = document.createElement('script');
  sc.async = true; sc.dataset.goatcounter = COUNTER; sc.src = 'https://gc.zgo.at/count.js';
  document.head.appendChild(sc);
}
function countEvent(name) {
  try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: 'evento-' + name, title: name, event: true }); } catch (e) { /* nada */ }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

window.tresd = { V, renderTmj, redrawTmj, showPanoramic, fitTmjAspect, openAtmBig, openPolesDialog, shotPng, openFeedback, feedbackState, buildSession };   // acceso desde la consola del navegador (depuración)
main();
