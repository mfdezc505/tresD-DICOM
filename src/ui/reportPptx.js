// tresD DICOM — INFORME en PowerPoint (v0.8.5). Mismos datos que el PDF (`buildReportPdf`), compuestos con
// PptxGenJS (MIT; se carga solo cuando se pide: chunk aparte). Diapositivas 16:9: portada (logotipo, paciente y
// estudio), una por figura, la vía aérea (imagen + tabla), la tabla de medidas y las observaciones; en todas, el
// aviso legal, la versión y el número de diapositiva al pie. Tema claro u oscuro como el PDF.
import { t } from '../i18n/i18n.js';
import { VERSION } from '../version.js';
import { CLASS_RGB } from './report.js';

const THEMES = {
  light: { bg: 'FFFFFF', ink: '1B2A28', muted: '5B6A68', accent: '004A46', line: 'D5E1DF', head: 'EEF4F3', box: 'F2F6F5' },
  dark: { bg: '0B0F1A', ink: 'EEF2FF', muted: 'AEBABA', accent: '89CBC4', line: '2A3350', head: '1C2333', box: '141A28' },
};
const W = 10, H = 5.625, MX = 0.45, TOP = 0.35;   // pulgadas (LAYOUT_16x9)
const hex = (rgb) => rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

/** Tamaño natural de una imagen (data-URL). */
function imgSize(url) {
  return new Promise((resolve) => { const im = new Image(); im.onload = () => resolve([im.naturalWidth || 1, im.naturalHeight || 1]); im.onerror = () => resolve([4, 3]); im.src = url; });
}

/**
 * data = como en buildReportPdf (+ airway). Devuelve el .pptx como Blob (v0.8.6: lo descarga quien llama, con el
 * mismo método que la sesión y el paquete; antes lo hacía PptxGenJS y en algunos equipos no llegaba a descargarse).
 */
export async function buildReportPptx(data) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const T = THEMES[data.theme === 'dark' ? 'dark' : 'light'];
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = t('rep_title'); pptx.author = 'tresD DICOM'; pptx.company = 'tresD Ortodoncia Digital';
  const FONT = 'Segoe UI';
  const foot = (slide, i, n) => {
    slide.background = { color: T.bg };
    slide.addShape(pptx.ShapeType.line, { x: MX, y: H - 0.42, w: W - 2 * MX, h: 0, line: { color: T.line, width: 0.5 } });
    slide.addText(t('rep_disclaimer'), { x: MX, y: H - 0.4, w: W - 2 * MX - 2.2, h: 0.36, fontFace: FONT, fontSize: 6.5, color: T.muted, valign: 'top' });
    slide.addText(`tresD DICOM v${VERSION} · tresddicom.com · ${t('rep_page', { i, n })}`, { x: W - MX - 2.2, y: H - 0.4, w: 2.2, h: 0.36, fontFace: FONT, fontSize: 6.5, color: T.muted, align: 'right', valign: 'top' });
  };
  const heading = (slide, txt) => {
    slide.addText(String(txt).toUpperCase(), { x: MX, y: TOP, w: W - 2 * MX, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: T.accent });
    slide.addShape(pptx.ShapeType.line, { x: MX, y: TOP + 0.42, w: W - 2 * MX, h: 0, line: { color: T.line, width: 0.75 } });
  };
  const slides = [];   // [fn(slide)]: se cuentan primero para el «i de n»

  // ---------- portada
  slides.push(async (s) => {
    let x = MX;
    if (data.logo) { const [lw, lh] = await imgSize(data.logo); const h = 0.6, w = (h * lw) / lh; s.addImage({ data: data.logo, x: MX, y: TOP, w, h }); x = MX + w + 0.25; }
    s.addText(t('rep_title'), { x, y: TOP, w: W - x - MX - 2.6, h: 0.6, fontFace: FONT, fontSize: 24, bold: true, color: T.ink, valign: 'middle' });
    s.addText(t('rep_generated') + ' ' + data.when, { x: W - MX - 2.6, y: TOP, w: 2.6, h: 0.6, fontFace: FONT, fontSize: 9, color: T.muted, align: 'right', valign: 'middle' });
    s.addShape(pptx.ShapeType.line, { x: MX, y: TOP + 0.75, w: W - 2 * MX, h: 0, line: { color: T.accent, width: 1.5 } });
    const colW = (W - 2 * MX - 0.4) / 2;
    const block = (title, rows, x0) => {
      s.addText(String(title).toUpperCase(), { x: x0, y: TOP + 1.0, w: colW, h: 0.35, fontFace: FONT, fontSize: 11, bold: true, color: T.accent });
      const body = rows.flatMap(([k, v]) => [{ text: `${k}: `, options: { bold: true, color: T.muted } }, { text: String(v), options: { color: T.ink, breakLine: true } }]);
      s.addText(body, { x: x0, y: TOP + 1.35, w: colW, h: 2.6, fontFace: FONT, fontSize: 11, color: T.ink, valign: 'top', paraSpaceAfter: 4 });
    };
    block(t('rep_patient_h'), data.patient || [[t('rep_patient'), t('rep_hidden')]], MX);
    block(t('rep_study_h'), data.series, MX + colW + 0.4);
  });

  // ---------- figuras: una por diapositiva
  for (const f of data.figures) {
    slides.push(async (s) => {
      heading(s, f.title);
      const [iw, ih] = await imgSize(f.url);
      const maxW = W - 2 * MX, maxH = H - TOP - 0.55 - 0.55;
      const k = Math.min(maxW / iw, maxH / ih); const w = iw * k, h = ih * k;
      s.addImage({ data: f.url, x: MX + (maxW - w) / 2, y: TOP + 0.55, w, h });
    });
  }

  // ---------- vía aérea
  if (data.airway) {
    const A = data.airway;
    slides.push(async (s) => {
      heading(s, A.title || t('rep_opt_airway'));
      const leftW = 4.6;
      if (A.url) {
        const [iw, ih] = await imgSize(A.url); const maxH = H - TOP - 0.55 - 0.9;
        const k = Math.min(leftW / iw, maxH / ih); const w = iw * k, h = ih * k;
        s.addImage({ data: A.url, x: MX + (leftW - w) / 2, y: TOP + 0.55, w, h });
        if (A.legend && A.legend.colors) {
          const lw = 3.2, lx = MX + (leftW - lw) / 2, ly = TOP + 0.6 + h, n = A.legend.colors.length, seg = lw / n;
          for (let i = 0; i < n; i++) s.addShape(pptx.ShapeType.rect, { x: lx + i * seg, y: ly, w: seg + 0.005, h: 0.14, fill: { color: hex(A.legend.colors[i]) }, line: { color: hex(A.legend.colors[i]), width: 0 } });
          s.addText(`${t('aw_narrow')} · ${A.legend.lo.toFixed(0)} mm²`, { x: lx, y: ly + 0.15, w: lw / 2, h: 0.25, fontFace: FONT, fontSize: 7.5, color: T.muted });
          s.addText(`${A.legend.hi.toFixed(0)} mm² · ${t('aw_wide')}`, { x: lx + lw / 2, y: ly + 0.15, w: lw / 2, h: 0.25, fontFace: FONT, fontSize: 7.5, color: T.muted, align: 'right' });
        }
      }
      const x0 = MX + leftW + 0.3, tw = W - MX - x0;
      const head = [t('aw_measure'), t('aw_value'), t('aw_norm'), t('aw_dev')].map((h) => ({ text: h, options: { bold: true, color: T.muted, fill: { color: T.head }, fontSize: 9 } }));
      const body = A.rows.map((r) => [
        { text: r.label, options: { color: T.ink, fontSize: 9 } },
        { text: r.value, options: { bold: true, color: T.ink, fontSize: 9 } },
        { text: r.norm, options: { color: T.ink, fontSize: 9 } },
        { text: (r.cls ? '● ' : '') + r.dev, options: { bold: true, color: r.cls && CLASS_RGB[r.cls] ? hex(CLASS_RGB[r.cls]) : T.ink, fontSize: 9 } },
      ]);
      s.addTable([head, ...body], { x: x0, y: TOP + 0.55, w: tw, colW: [1.35, 1.0, 1.15, tw - 3.5], fontFace: FONT, border: { type: 'solid', color: T.line, pt: 0.5 }, autoPage: false });
      const txt = [A.extent, A.notes, t('rep_aw_classes'), A.ref, t('rep_aw_caption')].filter(Boolean).join('\n');
      s.addText(txt, { x: x0, y: TOP + 0.55 + 0.42 * (A.rows.length + 1) + 0.15, w: tw, h: H - TOP - 0.55 - 0.42 * (A.rows.length + 1) - 0.8, fontFace: FONT, fontSize: 8, color: T.muted, valign: 'top', paraSpaceAfter: 3 });
    });
  }

  // ---------- medidas (hasta 12 filas por diapositiva)
  if (data.measures.length || data.extra.length) {
    const per = 12;
    const chunks = []; for (let i = 0; i < data.measures.length; i += per) chunks.push(data.measures.slice(i, i + per));
    if (!chunks.length) chunks.push([]);
    chunks.forEach((rows, ci) => {
      slides.push(async (s) => {
        heading(s, t('rep_measures') + (chunks.length > 1 ? ` (${ci + 1}/${chunks.length})` : ''));
        let y = TOP + 0.55;
        if (rows.length) {
          const head = [t('rep_view'), t('rep_type'), t('rep_value')].map((h) => ({ text: h, options: { bold: true, color: T.muted, fill: { color: T.head }, fontSize: 9 } }));
          const body = rows.map((m) => [
            { text: String(m.where), options: { color: T.ink, fontSize: 9 } },
            { text: '● ' + t(m.type === 'angle' ? 'rep_angle' : 'rep_linear'), options: { color: m.color && /^#?[0-9a-f]{6}$/i.test(m.color) ? m.color.replace('#', '').toUpperCase() : T.ink, fontSize: 9 } },
            { text: String(m.value), options: { bold: true, color: T.ink, fontSize: 9 } },
          ]);
          s.addTable([head, ...body], { x: MX, y, w: W - 2 * MX, colW: [5.2, 2.0, W - 2 * MX - 7.2], fontFace: FONT, border: { type: 'solid', color: T.line, pt: 0.5 }, autoPage: false });
          y += 0.3 * (rows.length + 1) + 0.2;
        }
        if (ci === chunks.length - 1 && data.extra.length) {
          const body = data.extra.map(([k, v]) => [{ text: String(k), options: { color: T.muted, bold: true, fontSize: 9 } }, { text: String(v), options: { color: T.ink, fontSize: 9 } }]);
          s.addTable(body, { x: MX, y, w: W - 2 * MX, colW: [6.2, W - 2 * MX - 6.2], fontFace: FONT, border: { type: 'solid', color: T.line, pt: 0.5 }, autoPage: false });
          y += 0.3 * data.extra.length + 0.2;
        }
        if (ci === chunks.length - 1) s.addText(t('rep_meas_note'), { x: MX, y: Math.min(y, H - 1.0), w: W - 2 * MX, h: 0.4, fontFace: FONT, fontSize: 8, color: T.muted, valign: 'top' });
      });
    });
  }

  // ---------- observaciones
  if (data.notes) {
    slides.push(async (s) => {
      heading(s, t('rep_notes_title'));
      s.addText(String(data.notes), { x: MX, y: TOP + 0.55, w: W - 2 * MX, h: H - TOP - 0.55 - 0.6, fontFace: FONT, fontSize: 12, color: T.ink, valign: 'top', fill: { color: T.box }, line: { color: T.line, width: 0.5 }, margin: 8 });
    });
  }

  const n = slides.length;
  for (let i = 0; i < n; i++) { const s = pptx.addSlide(); foot(s, i + 1, n); await slides[i](s); }
  const out = await pptx.write({ outputType: 'blob' });
  return out instanceof Blob ? out : new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
