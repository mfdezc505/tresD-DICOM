// tresD DICOM — textos de la interfaz en ESPAÑOL e INGLES.
// t('clave') devuelve el texto en el idioma activo. Los elementos con data-i18n se
// traducen solos al cambiar de idioma (applyI18n).
import es from './es.js';
import en from './en.js';

const DICTS = { es, en };
const KEY = 'tresd_dicom_lang';
let current = 'es';

export function loadLang() {
  try {
    const v = localStorage.getItem(KEY);
    if (v && DICTS[v]) current = v;
    else current = (navigator.language || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  } catch (e) { current = 'es'; }
  return current;
}

export function setLang(code) {
  if (!DICTS[code]) return;
  current = code;
  try { localStorage.setItem(KEY, code); } catch (e) { /* sin almacenamiento */ }
  document.documentElement.lang = code;
  applyI18n(document);
}

export function getLang() { return current; }

export function t(key, vars) {
  let s = DICTS[current][key] ?? DICTS.es[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.replaceAll('{' + k + '}', String(vars[k]));
  return s;
}

/** Traduce todos los nodos con data-i18n (texto), data-i18n-title (tooltip) y data-i18n-ph (placeholder). */
export function applyI18n(root) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
}
