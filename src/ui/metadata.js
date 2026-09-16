// tresD DICOM — CAJÓN DE METADATOS: todas las etiquetas del primer corte de la serie (dcmjs),
// con nombre del diccionario, VR y valor; búsqueda instantánea y exportación JSON / CSV.
import dcmjs from 'dcmjs';
import { t } from '../i18n/i18n.js';
import { fmtDate } from '../core/dicomLoad.js';

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;
let rows = [];               // [{tag, name, vr, value}]
let summary = {};

function valueToString(el, tag) {
  if (!el) return '';
  if (tag === '7FE00010' || el.vr === 'OB' || el.vr === 'OW' || el.vr === 'UN' || el.vr === 'OF' || el.vr === 'OD') {
    const v = el.Value && el.Value[0];
    const n = v && v.byteLength !== undefined ? v.byteLength : (el._rawValue && el._rawValue.byteLength) || 0;
    return `[${el.vr} · ${n} bytes]`;
  }
  if (el.vr === 'SQ') return `[SQ · ${(el.Value || []).length} items]`;
  const vals = el.Value ?? el._rawValue ?? [];
  const arr = Array.isArray(vals) ? vals : [vals];
  return arr.map((v) => {
    if (v && typeof v === 'object') return v.Alphabetic || v.Ideographic || v.Phonetic || JSON.stringify(v);
    return String(v);
  }).join('\\');
}

function flatten(dict, prefix, out) {
  for (const tagKey of Object.keys(dict).sort()) {
    const el = dict[tagKey];
    const tag = tagKey.toUpperCase();
    const punct = '(' + tag.slice(0, 4) + ',' + tag.slice(4) + ')';
    const info = DicomMetaDictionary.dictionary[punct];
    const name = info ? info.name : (tag.slice(0, 2) % 2 === 1 || parseInt(tag.slice(0, 4), 16) % 2 === 1 ? 'Private' : '');
    out.push({ tag: prefix + punct, name, vr: el.vr || (info && info.vr) || '', value: valueToString(el, tag) });
    if (el.vr === 'SQ' && Array.isArray(el.Value)) {
      el.Value.forEach((item, i) => { if (item && typeof item === 'object') flatten(item, prefix + '  ' + `[${i + 1}] `, out); });
    }
  }
}

/** Lee el primer archivo de la serie y rellena el cajón. */
export async function buildMetadata(series) {
  const f = series.files[0].file;
  const buf = await f.arrayBuffer();
  let dd = null;
  try { dd = DicomMessage.readFile(buf, { ignoreErrors: true }); } catch (e) { console.warn('dcmjs', e); }
  rows = [];
  if (dd) {
    flatten(dd.meta || {}, '', rows);
    flatten(dd.dict || {}, '', rows);
  }
  const sp = series.spacing ? series.spacing.map((v) => (+v).toFixed(3)).join(' × ') : '?';
  summary = {
    meta_patient: series.patient || '—', meta_id: series.patientId || '—', meta_birth: fmtDate(series.birth) || '—',
    meta_sex: series.sex || '—', meta_study: series.study || '—', meta_series: series.desc || '—',
    meta_date: fmtDate(series.date) || '—', meta_modality: series.modality || '—', meta_manufacturer: series.manufacturer || '—',
    meta_dims: `${series.cols} × ${series.rows} × ${series.count}`, meta_spacing: `${sp} · dz ${(+series.dz).toFixed(3)}`,
    meta_slices: series.count, meta_kvp: series.kvp || '—', meta_transfer: series.transfer || '—',
    meta_files: series.files.length, meta_orientation: series.orientation || '—',
  };
  renderSummary();
  renderTable('');
}

/** Refresca en el resumen los datos que el usuario puede editar en la sesión (nombre, sexo, nacimiento; v0.7.15). */
export function updateSummaryPatient(series) {
  if (!summary || !('meta_patient' in summary)) return;
  summary.meta_patient = series.patient || '—'; summary.meta_birth = fmtDate(series.birth) || '—'; summary.meta_sex = series.sex || '—';
  renderSummary();
}

function renderSummary() {
  const box = document.getElementById('meta-summary');
  box.innerHTML = Object.entries(summary).map(([k, v]) => `<div><b>${t(k)}:</b> ${escapeHtml(String(v))}</div>`).join('');
}

export function renderTable(filter) {
  const q = (filter || '').trim().toLowerCase();
  const tb = document.querySelector('#meta-table tbody');
  const list = q ? rows.filter((r) => (r.tag + ' ' + r.name + ' ' + r.value).toLowerCase().includes(q)) : rows;
  tb.innerHTML = list.slice(0, 4000).map((r) =>
    `<tr><td>${escapeHtml(r.tag)}</td><td>${escapeHtml(r.name)}</td><td>${r.vr}</td><td class="val">${escapeHtml(r.value.slice(0, 400))}</td></tr>`).join('');
}

export function exportJSON(series) {
  const out = { resumen: summary, etiquetas: rows.map((r) => ({ tag: r.tag.trim(), name: r.name, vr: r.vr, value: r.value })) };
  download(JSON.stringify(out, null, 2), fileBase(series) + '_metadatos.json', 'application/json');
}

export function exportCSV(series) {
  const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const lines = ['tag,name,vr,value', ...rows.map((r) => [r.tag.trim(), r.name, r.vr, r.value].map(esc).join(','))];
  download('﻿' + lines.join('\r\n'), fileBase(series) + '_metadatos.csv', 'text/csv;charset=utf-8');
}

function fileBase(series) {
  return ((series && (series.patient || series.desc)) || 'dicom').replace(/[^\w\-]+/g, '_').slice(0, 40);
}

export function download(content, name, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
