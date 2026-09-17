// tresD DICOM — INFORME en PDF (v0.8.2; en v0.8.0 era una página imprimible). Se compone con jsPDF (MIT) en el
// navegador: A4 vertical, cabecera con el logotipo, datos del paciente y del estudio, las capturas en una
// rejilla, la tabla de medidas, las observaciones y el aviso legal al pie de cada página. Nada sale del
// ordenador: el PDF se descarga directamente.
import { jsPDF } from 'jspdf';
import { t } from '../i18n/i18n.js';
import { VERSION } from '../version.js';

// paletas del manual de marca: claro (sobre blanco) y oscuro (fondo #0B0F1A del visor) (v0.8.3)
const THEMES = {
  light: { bg: [255, 255, 255], ink: [27, 42, 40], muted: [91, 106, 104], accent: [0, 74, 70], line: [213, 225, 223], headBg: [238, 244, 243], box: [242, 246, 245] },
  dark: { bg: [11, 15, 26], ink: [238, 242, 255], muted: [174, 186, 186], accent: [137, 203, 196], line: [42, 51, 80], headBg: [28, 35, 51], box: [20, 26, 40] },
};
export const CLASS_RGB = { green: [16, 162, 59], orange: [245, 158, 11], red: [229, 72, 77] };   // valoración de la vía aérea
const PAGE_W = 210, PAGE_H = 297, MX = 15, TOP = 14, BOTTOM = 280;

/**
 * data = { patient: [[etiqueta, valor]…] | null, series: [[etiqueta, valor]…], figures: [{ title, url, wide }],
 *          measures: [{ where, type, value, color }], extra: [[etiqueta, valor]…], notes, logo (data-URL JPEG o null),
 *          when (texto de fecha), theme: 'light' | 'dark' }
 * Devuelve el documento jsPDF listo para `save()`.
 */
export function buildReportPdf(data) {
  const T = THEMES[data.theme === 'dark' ? 'dark' : 'light'];
  const INK = T.ink, MUTED = T.muted, ACCENT = T.accent, LINE = T.line, HEAD_BG = T.headBg;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = PAGE_W - 2 * MX;
  let y = TOP;
  // en el tema oscuro TODAS las páginas llevan el fondo pintado (una página nueva nace blanca)
  const paintBg = () => { if (data.theme === 'dark') { doc.setFillColor(...T.bg); doc.rect(0, 0, PAGE_W, PAGE_H, 'F'); } };
  paintBg();
  const font = (size, bold = false, color = INK) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color); };
  const ensure = (h) => { if (y + h > BOTTOM) { doc.addPage(); paintBg(); y = TOP; } };
  // ensure(26): que el título nunca quede solo al pie de la página
  const h2 = (txt) => { ensure(26); y += 4; font(10.5, true, ACCENT); doc.text(String(txt).toUpperCase(), MX, y); y += 2; doc.setDrawColor(...LINE); doc.line(MX, y, MX + W, y); y += 5; };

  // ---------- cabecera
  let x = MX;
  if (data.logo) {
    try { const p = doc.getImageProperties(data.logo); const h = 9, w = (h * p.width) / p.height; doc.addImage(data.logo, 'JPEG', MX, y, w, h, undefined, 'FAST'); x = MX + w + 5; } catch (e) { /* sin logotipo */ }
  }
  font(15, true); doc.text(t('rep_title'), x, y + 7);
  font(8, false, MUTED); doc.text(t('rep_generated') + ' ' + data.when, MX + W, y + 3, { align: 'right' });
  y += 12; doc.setDrawColor(...ACCENT); doc.setLineWidth(0.5); doc.line(MX, y, MX + W, y); doc.setLineWidth(0.2); y += 3;

  // ---------- paciente y estudio (dos columnas)
  const kvRows = (rows, x0, colW, y0, labelW = 34) => {
    let yy = y0;
    for (const [k, v] of rows) {
      font(8.5, true, MUTED); const kl = doc.splitTextToSize(String(k), labelW - 2); doc.text(kl, x0, yy);
      font(8.5, false); const lines = doc.splitTextToSize(String(v), colW - labelW); doc.text(lines, x0 + labelW, yy);
      yy += 4.6 * Math.max(kl.length, lines.length);
    }
    return yy;
  };
  const colW = (W - 8) / 2;
  const yTitles = y + 6;
  font(10.5, true, ACCENT); doc.text(t('rep_patient_h').toUpperCase(), MX, yTitles); doc.text(t('rep_study_h').toUpperCase(), MX + colW + 8, yTitles);
  let yA = yTitles + 6, yB = yTitles + 6;
  if (data.patient) yA = kvRows(data.patient, MX, colW, yA);
  else { font(8.5, false, MUTED); doc.setFont('helvetica', 'italic'); doc.text(t('rep_hidden'), MX, yA); yA += 4.6; }
  yB = kvRows(data.series, MX + colW + 8, colW, yB);
  y = Math.max(yA, yB) + 2;

  // ---------- imágenes (rejilla de 2, las anchas a todo el ancho)
  if (data.figures.length) {
    h2(t('rep_images'));
    const gap = 6, half = (W - gap) / 2;
    const size = (f, maxW, maxH) => { const p = doc.getImageProperties(f.url); const k = Math.min(maxW / p.width, maxH / p.height); return { w: p.width * k, h: p.height * k, type: p.fileType === 'PNG' ? 'PNG' : 'JPEG' }; };
    // v0.8.5: las figuras PNG (render sin fondo) van con transparencia: se ven sobre el fondo de la página
    const caption = (txt, x0, y0, w) => { font(7.5, false, MUTED); const lines = doc.splitTextToSize(txt, w); doc.text(lines, x0, y0); return 3.6 * lines.length; };
    let i = 0;
    while (i < data.figures.length) {
      const f = data.figures[i];
      if (f.wide) {
        const s = size(f, W, 100); ensure(s.h + 8);
        doc.setFillColor(0, 0, 0); doc.addImage(f.url, s.type, MX + (W - s.w) / 2, y, s.w, s.h, undefined, 'FAST');
        y += s.h + 4; y += caption(f.title, MX, y, W) + 3; i++;
      } else {
        const g = data.figures[i + 1] && !data.figures[i + 1].wide ? data.figures[i + 1] : null;
        const sA = size(f, half, 95), sB = g ? size(g, half, 95) : null;
        const rowH = Math.max(sA.h, sB ? sB.h : 0);
        ensure(rowH + 10);
        doc.addImage(f.url, sA.type, MX + (half - sA.w) / 2, y, sA.w, sA.h, undefined, 'FAST');
        if (g) doc.addImage(g.url, sB.type, MX + half + gap + (half - sB.w) / 2, y, sB.w, sB.h, undefined, 'FAST');
        const yc = y + rowH + 4;
        const cA = caption(f.title, MX, yc, half), cB = g ? caption(g.title, MX + half + gap, yc, half) : 0;
        y = yc + Math.max(cA, cB) + 3; i += g ? 2 : 1;
      }
    }
  }

  // ---------- vía aérea (v0.8.5): página propia con la vista lateral, la leyenda del mapa de calor y la tabla
  if (data.airway) {
    const A = data.airway;
    doc.addPage(); paintBg(); y = TOP;
    h2(A.title || t('rep_opt_airway'));
    if (A.url) {
      const p = doc.getImageProperties(A.url); const k = Math.min(W / p.width, 150 / p.height); const w = p.width * k, h = p.height * k;
      doc.addImage(A.url, p.fileType === 'PNG' ? 'PNG' : 'JPEG', MX + (W - w) / 2, y, w, h, undefined, 'FAST'); y += h + 3;
      font(7.5, false, MUTED); doc.text(t('rep_aw_caption'), MX, y); y += 5;
    }
    if (A.legend && A.legend.colors) {                  // barra de color: estrecho (MCA) → amplio
      const lw = 90, lx = MX + (W - lw) / 2, n = A.legend.colors.length, seg = lw / n;
      for (let i = 0; i < n; i++) { doc.setFillColor(...A.legend.colors[i]); doc.rect(lx + i * seg, y, seg + 0.2, 4, 'F'); }
      font(7.5, false, MUTED);
      doc.text(`${t('aw_narrow')} · ${A.legend.lo.toFixed(0)} mm²`, lx, y + 8); doc.text(`${A.legend.hi.toFixed(0)} mm² · ${t('aw_wide')}`, lx + lw, y + 8, { align: 'right' });
      doc.text(t('aw_legend'), lx + lw / 2, y + 8, { align: 'center' });
      y += 14;
    }
    const cols = [MX, MX + 52, MX + 92, MX + 132];
    ensure(8);
    doc.setFillColor(...HEAD_BG); doc.rect(MX, y - 4, W, 6.5, 'F');
    font(8, true, MUTED); doc.text(t('aw_measure'), cols[0] + 2, y); doc.text(t('aw_value'), cols[1] + 2, y); doc.text(t('aw_norm'), cols[2] + 2, y); doc.text(t('aw_dev'), cols[3] + 2, y);
    y += 6;
    for (const r of A.rows) {
      ensure(7);
      font(8.5, false); doc.text(String(r.label), cols[0] + 2, y);
      font(8.5, true); doc.text(String(r.value), cols[1] + 2, y);
      font(8.5, false); doc.text(String(r.norm), cols[2] + 2, y);
      const rgb = r.cls && CLASS_RGB[r.cls]; if (rgb) { doc.setFillColor(...rgb); doc.circle(cols[3] + 3.5, y - 1.1, 1.3, 'F'); }
      font(8.5, true); doc.text(String(r.dev), cols[3] + (rgb ? 7 : 2), y);
      doc.setDrawColor(...LINE); doc.line(MX, y + 2, MX + W, y + 2);
      y += 6.2;
    }
    y += 2;
    font(8, false, MUTED);
    const rowsTxt = [A.extent, A.notes, t('rep_aw_classes'), A.ref].filter(Boolean);
    for (const txt of rowsTxt) { const lines = doc.splitTextToSize(String(txt), W); ensure(4 * lines.length + 2); doc.text(lines, MX, y); y += 4 * lines.length + 1.5; }
  }

  // ---------- medidas
  if (data.measures.length || data.extra.length) {
    h2(t('rep_measures'));
    if (data.measures.length) {
      const cols = [MX, MX + 90, MX + 130];
      ensure(8);
      doc.setFillColor(...HEAD_BG); doc.rect(MX, y - 4, W, 6.5, 'F');
      font(8, true, MUTED); doc.text(t('rep_view'), cols[0] + 2, y); doc.text(t('rep_type'), cols[1] + 2, y); doc.text(t('rep_value'), cols[2] + 2, y);
      y += 6;
      for (const m of data.measures) {
        ensure(7);
        font(8.5, false); doc.text(doc.splitTextToSize(String(m.where), 86)[0], cols[0] + 2, y);
        const rgb = hexToRgb(m.color); if (rgb) { doc.setFillColor(...rgb); doc.circle(cols[1] + 3.5, y - 1.1, 1.3, 'F'); }
        doc.text(t(m.type === 'angle' ? 'rep_angle' : 'rep_linear'), cols[1] + 7, y);
        font(8.5, true); doc.text(String(m.value), cols[2] + 2, y);
        doc.setDrawColor(...LINE); doc.line(MX, y + 2, MX + W, y + 2);
        y += 6.2;
      }
      y += 1;
    }
    if (data.extra.length) { y += 2; ensure(6 * data.extra.length); y = kvRows(data.extra, MX, W, y, 90); }
    ensure(6); font(7.5, false, MUTED); doc.text(doc.splitTextToSize(t('rep_meas_note'), W), MX, y); y += 5;
  }

  // ---------- observaciones
  if (data.notes) {
    h2(t('rep_notes_title'));
    font(9, false);
    const lines = doc.splitTextToSize(String(data.notes), W - 6);
    ensure(lines.length * 4.6 + 6);
    doc.setDrawColor(...LINE); doc.setFillColor(...T.box); doc.roundedRect(MX, y - 4, W, lines.length * 4.6 + 5, 1.5, 1.5, 'FD');
    doc.text(lines, MX + 3, y + 0.5); y += lines.length * 4.6 + 6;
  }

  // ---------- pie en todas las páginas
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE); doc.line(MX, 284, MX + W, 284);
    font(6.8, false, MUTED);
    const disc = doc.splitTextToSize(t('rep_disclaimer'), W - 50);
    doc.text(disc, MX, 287.5);
    doc.text(`tresD DICOM v${VERSION} · tresddicom.com`, MX + W, 287.5, { align: 'right' });
    doc.text(t('rep_page', { i: p, n }), MX + W, 291.3, { align: 'right' });
  }
  return doc;
}

function hexToRgb(h) {
  if (!h || typeof h !== 'string') return null;
  const m = h.trim().match(/^#?([0-9a-f]{6})$/i);
  if (m) { const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  const r = h.match(/rgba?\((\d+)\D+(\d+)\D+(\d+)/i);
  return r ? [+r[1], +r[2], +r[3]] : null;
}

/** Cualquier imagen (data-URL PNG/JPEG) a JPEG sobre fondo `bg` (las capturas PNG pesan 5-10 veces más en el PDF). */
export function toJpeg(url, quality = 0.9, bg = '#000') {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}
