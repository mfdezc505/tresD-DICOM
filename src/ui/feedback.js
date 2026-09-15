// tresD DICOM — VALORACIÓN del software (1-5 estrellas + comentario opcional), v0.7.11.
// Las respuestas van a un Google Form de Manuel (llegan por correo y a una hoja de cálculo) enviadas en
// segundo plano: el usuario nunca ve el formulario. No hay servidor propio.
// Cuándo se pide: una sola vez por navegador, pasados unos minutos de uso con un caso cargado (no se
// puede «al cerrar la pestaña»: los navegadores no permiten ventanas propias en ese momento). Además hay
// un botón «★ Valorar» fijo en el pie. Si el usuario pulsa «Ahora no», se vuelve a pedir a los 30 días.
import { t } from '../i18n/i18n.js';

const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdY7E8mRQufhXrfffJW4c2STN-wKmuXapj8yVS2C5TPDCJxZg/formResponse';
const ENTRY_STARS = 'entry.1125802240';       // pregunta «Valoración» (escala 1-5)
const ENTRY_TEXT = 'entry.1984945003';        // pregunta «Tu opinión nos ayuda a mejorar» (párrafo)
const KEY = 'tresd_dicom_feedback';           // localStorage: 'done' | 'later:<fecha ms>'
const DELAY_MS = 5 * 60 * 1000;               // minutos de uso antes de pedirla (con un caso cargado)
const LATER_MS = 30 * 24 * 3600 * 1000;       // «Ahora no»: volver a preguntar a los 30 días
const MAX_TEXT = 1000;

let timer = null;
let open = false;

const store = { get() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }, set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* nada */ } } };

/** ¿Toca pedirla? (nunca si ya se valoró; tras «Ahora no», solo pasados 30 días). */
function due() {
  const v = store.get();
  if (v === 'done') return false;
  if (v.startsWith('later:')) return Date.now() - Number(v.slice(6)) > LATER_MS;
  return true;
}

/** Envía la valoración al formulario en segundo plano. No se puede leer la respuesta (no-cors): se da por buena. */
export async function sendFeedback(stars, text) {
  const fd = new FormData();
  fd.append(ENTRY_STARS, String(stars));
  fd.append(ENTRY_TEXT, (text || '').trim().slice(0, MAX_TEXT));
  try { await fetch(FORM_URL, { method: 'POST', mode: 'no-cors', body: fd, keepalive: true }); return true; } catch (e) { return false; }
}

/**
 * Abre la ventana de valoración. `auto` = la abre el temporizador (si hay otra ventana abierta o el usuario
 * está marcando algo, se pospone un minuto). Devuelve true si se abrió.
 */
export function openFeedback({ auto = false, busy = () => false } = {}) {
  if (open) return false;
  if (auto && (document.querySelector('.modal-bg') || busy())) { schedule(60 * 1000, busy); return false; }
  open = true;
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal feedback" role="dialog" aria-labelledby="fb-title">
    <h3 id="fb-title">${t('fb_title')}</h3>
    <div class="hint">${t('fb_hint')}</div>
    <div class="fb-stars" role="radiogroup" aria-label="${t('fb_title')}">${[1, 2, 3, 4, 5].map((i) => `<button type="button" class="fb-star" data-v="${i}" aria-label="${i}">★</button>`).join('')}</div>
    <textarea id="fb-text" rows="4" maxlength="${MAX_TEXT}" placeholder="${t('fb_placeholder')}"></textarea>
    <div class="hint small">${t('fb_privacy')}</div>
    <div class="mrow"><button class="btn-ghost" id="fb-later">${t('fb_later')}</button>
      <button class="btn-primary" id="fb-send" disabled style="width:auto;min-height:40px;padding:8px 22px">${t('fb_send')}</button></div></div>`;
  document.body.appendChild(bg);
  let stars = 0;
  const paint = (n) => bg.querySelectorAll('.fb-star').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) <= n));
  bg.querySelectorAll('.fb-star').forEach((b) => {
    b.addEventListener('mouseenter', () => paint(Number(b.dataset.v)));
    b.addEventListener('mouseleave', () => paint(stars));
    b.addEventListener('click', () => { stars = Number(b.dataset.v); paint(stars); bg.querySelector('#fb-send').disabled = false; });
  });
  const close = () => { bg.remove(); open = false; };
  bg.querySelector('#fb-later').addEventListener('click', () => { store.set('later:' + Date.now()); close(); });
  bg.addEventListener('click', (e) => { if (e.target === bg) { store.set('later:' + Date.now()); close(); } });
  bg.querySelector('#fb-send').addEventListener('click', async () => {
    if (!stars) return;
    const btn = bg.querySelector('#fb-send'); btn.disabled = true;
    await sendFeedback(stars, bg.querySelector('#fb-text').value);
    store.set('done');
    bg.querySelector('.modal').innerHTML = `<h3>${t('fb_thanks')}</h3>`;
    setTimeout(close, 1400);
  });
  return true;
}

/** Programa la petición automática (se llama al cargar un caso; solo arma el temporizador una vez). */
export function scheduleFeedback(busy = () => false) {
  if (timer || !due()) return;
  const ms = (typeof window !== 'undefined' && Number.isFinite(window.__tresdFbDelay)) ? window.__tresdFbDelay : DELAY_MS;   // __tresdFbDelay: solo para las pruebas
  schedule(ms, busy);
}
function schedule(ms, busy) {
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; if (due()) openFeedback({ auto: true, busy }); }, ms);
}

/** Estado guardado (para las pruebas). */
export function feedbackState() { return store.get(); }
