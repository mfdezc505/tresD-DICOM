// tresD DICOM — ventana de AYUDA (v0.7.16). Antes era un `alert()` del navegador; ahora es una ventana con la
// estética del visor, por secciones, con el contenido en src/i18n (clave `help_sections`) y la nota de
// versión / motores / uso previsto (`about`) al final.
import { t } from '../i18n/i18n.js';
import { VERSION } from '../version.js';

let open = false;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function openHelp() {
  if (open) return;
  const sections = t('help_sections');
  if (!Array.isArray(sections)) return;
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  const body = sections.map((sec, i) => `<section class="help-sec"${i === 0 ? ' open' : ''}>
      <h4>${esc(sec.t)}</h4>
      <ul>${sec.items.map(([k, v]) => `<li><b>${esc(k)}</b> ${esc(v)}</li>`).join('')}</ul>
    </section>`).join('');
  bg.innerHTML = `<div class="modal help"><div class="help-head"><h3>${t('help_title')}</h3>
      <span class="spacer" style="flex:1"></span><button class="btn-ghost" id="help-close">${t('dlg_close')}</button></div>
    <div class="hint">${t('help_intro')}</div>
    <div class="help-body">${body}
      <div class="help-about">${esc(t('about', { v: VERSION })).replace(/\n/g, '<br>')}</div></div></div>`;
  document.body.appendChild(bg);
  open = true;
  const close = () => { bg.remove(); open = false; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.querySelector('#help-close').addEventListener('click', close);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
}
