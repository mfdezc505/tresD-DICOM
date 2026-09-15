// tresD DICOM — TEXTOS LEGALES (términos de uso, aviso legal, privacidad) en ES y EN, y su ventana.
// Datos del titular facilitados por Manuel el 11-09-2026 (NIF de sociedad B…: el titular es la sociedad).
// El uso previsto declarado aquí (visualización / docencia, NO diagnóstico) debe coincidir con el resto
// de la interfaz: es lo que mira el Reglamento de productos sanitarios (MDR) y el RGPD.
import { t, getLang, setLang } from '../i18n/i18n.js';

export const TERMS_VERSION = 'v1-2026-09';
export const TERMS_KEY = 'tresd_dicom_terms';

const OWNER = {
  name: 'Manuel Fernández Cano',
  brand: 'tresD Ortodoncia Digital',
  company: 'Ortodoncia tresD Formación, S.L.U.',
  nif: 'B21663380',
  reg: 'Odontólogo colegiado nº 29002594 (Colegio Oficial de Dentistas de Málaga)',
  regEn: 'Registered dentist no. 29002594 (Málaga Official College of Dentists, Spain)',
  address: 'Clínica Áncora, Av. Sor Teresa Prat 57 bajo, Málaga (España)',
  addressEn: 'Clínica Áncora, Av. Sor Teresa Prat 57 bajo, Málaga (Spain)',
  email: 'tresdortodoncia@gmail.com',
  site: 'https://tresddicom.com/',
};

const ES = {
  terms: `
<h3>Términos de uso</h3>
<p><b>1. Qué es tresD DICOM.</b> Una herramienta web gratuita de <b>visualización</b> de imágenes DICOM / DICOMDIR (CBCT) y de escáneres intraorales (STL, PLY, OBJ), con fines de <b>docencia, comunicación y consulta general</b>. Todo el procesado ocurre en el navegador del usuario.</p>
<p><b>2. No es un producto sanitario.</b> tresD DICOM <b>no dispone de marcado CE</b> conforme al Reglamento (UE) 2017/745 y <b>no está destinada al diagnóstico, al seguimiento ni a la planificación de tratamientos</b>. Las mediciones, los cortes, la orientación y la superposición escáner-CBCT son <b>orientativas</b> y pueden contener errores. Toda decisión clínica debe basarse en sistemas certificados para uso diagnóstico y en el criterio del profesional.</p>
<p><b>3. Usuarios.</b> La herramienta se dirige a profesionales sanitarios y estudiantes del ámbito odontológico. Al usarla, el usuario declara pertenecer a ese ámbito y contar con la formación necesaria para interpretar imágenes radiológicas.</p>
<p><b>4. Responsabilidad del usuario.</b> El uso se realiza <b>bajo la exclusiva responsabilidad del usuario</b>. El usuario es el único responsable de la interpretación de las imágenes, de las decisiones que tome y de la <b>custodia y protección de los datos de sus pacientes</b> (Reglamento (UE) 2016/679 y Ley Orgánica 3/2018), incluidas la seguridad de su equipo y de su navegador y la obtención de los consentimientos que procedan.</p>
<p><b>5. Datos.</b> Los archivos que el usuario abre <b>no se transmiten ni se almacenan</b> en servidores del titular: permanecen en la memoria de su navegador y desaparecen al cerrar la pestaña. El titular no accede a ellos en ningún momento. Véase la Política de privacidad.</p>
<p><b>6. Sin garantías.</b> La herramienta se ofrece «tal cual», sin garantía de exactitud, disponibilidad, continuidad ni idoneidad para un fin concreto. En la medida permitida por la ley, el titular no responde de los daños directos o indirectos derivados de su uso o de la imposibilidad de usarla.</p>
<p><b>7. Propiedad intelectual.</b> La interfaz y el código propio son © ${OWNER.company} (${OWNER.brand}). Los motores de terceros (Cornerstone3D, vtk.js, dcmjs, dicom-parser, fflate, Vite, MediaPipe Face Mesh) se distribuyen bajo sus licencias (MIT, BSD-3, Apache-2.0). No está permitido presentar la herramienta como propia ni retirar las menciones de origen.</p>
<p><b>8. Cambios.</b> La herramienta y estos términos pueden actualizarse; la versión vigente se muestra en la propia aplicación. El uso posterior a un cambio implica su aceptación.</p>
<p><b>9. Ley aplicable.</b> Legislación española. Para cualquier controversia, los juzgados y tribunales de Málaga, salvo que la ley imponga otro fuero.</p>`,
  notice: `
<h3>Aviso legal</h3>
<p>En cumplimiento del artículo 10 de la Ley 34/2002 (LSSI-CE):</p>
<ul>
<li><b>Titular:</b> ${OWNER.company} (marca ${OWNER.brand}) · <b>NIF:</b> ${OWNER.nif}</li>
<li><b>Responsable:</b> ${OWNER.name}</li>
<li><b>Actividad:</b> ${OWNER.reg}</li>
<li><b>Domicilio:</b> ${OWNER.address}</li>
<li><b>Contacto:</b> ${OWNER.email}</li>
<li><b>Sitio web:</b> ${OWNER.site}</li>
</ul>
<p><b>Alojamiento.</b> La aplicación se sirve desde GitHub Pages (GitHub, Inc.), que entrega únicamente los archivos de la aplicación (código, estilos e imágenes). Ningún dato de pacientes pasa por ese servidor.</p>
<p><b>Propiedad intelectual.</b> El diseño, los textos y el código propio pertenecen al titular. Los componentes de terceros se usan bajo sus respectivas licencias, citadas en la ayuda de la aplicación.</p>
<p><b>Enlaces.</b> El titular no se hace responsable del contenido de sitios de terceros enlazados.</p>
<p><b>Uso previsto.</b> Herramienta de visualización y docencia. No es un producto sanitario con marcado CE ni está destinada al diagnóstico (véanse los Términos de uso).</p>`,
  privacy: `
<h3>Política de privacidad</h3>
<p><b>Responsable:</b> ${OWNER.company} (NIF ${OWNER.nif}), ${OWNER.address}. Contacto: ${OWNER.email}.</p>
<p><b>1. Datos de pacientes: no se recogen.</b> Los archivos DICOM, los escáneres y las fotografías se procesan íntegramente en el navegador del usuario (la detección facial también se ejecuta en local, sin servicios externos). No se suben, no se copian y no se almacenan en ningún servidor. El titular no tiene acceso a ellos. El usuario (o su clínica) es el responsable del tratamiento de los datos de sus pacientes.</p>
<p><b>2. Estadísticas de uso anónimas.</b> Para conocer cuántas personas usan la herramienta se utiliza <a href="https://www.goatcounter.com/help/privacy" target="_blank" rel="noopener">GoatCounter</a>, un servicio que <b>no usa cookies ni identificadores</b> y no conserva la dirección IP. Se registran: página visitada, país aproximado, tipo de navegador y sistema, tamaño de pantalla, página de origen, y dos eventos sin contenido («CBCT cargado», «escáner cargado»). No se pueden asociar a una persona. Base jurídica: interés legítimo del titular en conocer el uso de la herramienta (art. 6.1.f RGPD). No se realiza en el uso local (localhost).</p>
<p><b>3. Almacenamiento en su navegador.</b> La aplicación guarda en su propio navegador (localStorage) preferencias técnicas: idioma, tema, tamaño de letra, estado de los paneles y la aceptación de los términos. Son necesarias para el funcionamiento y no salen de su equipo (art. 22.2 LSSI). Puede borrarlas desde la configuración del navegador.</p>
<p><b>4. Alojamiento.</b> GitHub Pages (GitHub, Inc., EE. UU.) sirve los archivos de la aplicación y, como cualquier servidor web, puede registrar temporalmente direcciones IP en sus registros técnicos conforme a su <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">declaración de privacidad</a>. GitHub declara su adhesión al Marco de Privacidad de Datos UE-EE. UU.</p>
<p><b>5. Sin cuentas, formularios ni cookies.</b> La aplicación no requiere registro y no envía correos ni comunicaciones comerciales.</p>
<p><b>6. Derechos.</b> Puede ejercer los derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a ${OWNER.email}, y reclamar ante la Agencia Española de Protección de Datos (www.aepd.es). Dado que no se recogen datos personales identificables, en la práctica no existen datos que entregar o suprimir.</p>
<p><b>7. Cambios.</b> Esta política puede actualizarse; la fecha de versión es ${TERMS_VERSION}.</p>`,
  accept: 'He leído y acepto los Términos de uso: soy profesional sanitario o estudiante, la herramienta no es un producto sanitario certificado ni sirve para diagnosticar, y los datos de mis pacientes son mi responsabilidad.',
  btn: 'Aceptar y entrar',
  tabs: { terms: 'Términos de uso', notice: 'Aviso legal', privacy: 'Privacidad' },
  close: 'Cerrar',
  title: 'Antes de empezar',
};

const EN = {
  terms: `
<h3>Terms of use</h3>
<p><b>1. What tresD DICOM is.</b> A free web tool for <b>viewing</b> DICOM / DICOMDIR images (CBCT) and intraoral scans (STL, PLY, OBJ) for <b>teaching, communication and general reference</b>. All processing happens in the user's browser.</p>
<p><b>2. Not a medical device.</b> tresD DICOM <b>does not carry a CE mark</b> under Regulation (EU) 2017/745 and is <b>not intended for diagnosis, monitoring or treatment planning</b>. Measurements, cuts, orientation and scan-to-CBCT alignment are <b>indicative</b> and may contain errors. Any clinical decision must rely on systems certified for diagnostic use and on the professional's own judgement.</p>
<p><b>3. Users.</b> The tool is aimed at dental healthcare professionals and students. By using it, the user declares to belong to that field and to have the training required to interpret radiological images.</p>
<p><b>4. User responsibility.</b> Use is <b>at the user's sole responsibility</b>. The user alone is responsible for interpreting the images, for the decisions taken and for the <b>custody and protection of their patients' data</b> (Regulation (EU) 2016/679 and applicable national law), including the security of their computer and browser and any required consents.</p>
<p><b>5. Data.</b> Files opened by the user are <b>never transmitted or stored</b> on the owner's servers: they stay in the browser's memory and disappear when the tab is closed. The owner never has access to them. See the Privacy policy.</p>
<p><b>6. No warranty.</b> The tool is provided "as is", without warranty of accuracy, availability, continuity or fitness for a particular purpose. To the extent permitted by law, the owner is not liable for direct or indirect damages arising from its use or inability to use it.</p>
<p><b>7. Intellectual property.</b> The interface and original code are © ${OWNER.company} (${OWNER.brand}). Third-party engines (Cornerstone3D, vtk.js, dcmjs, dicom-parser, fflate, Vite, MediaPipe Face Mesh) are distributed under their own licenses (MIT, BSD-3, Apache-2.0). Presenting the tool as your own or removing attribution is not allowed.</p>
<p><b>8. Changes.</b> The tool and these terms may be updated; the current version is shown in the application. Continued use after a change implies acceptance.</p>
<p><b>9. Governing law.</b> Spanish law. Any dispute is subject to the courts of Málaga (Spain), unless the law provides otherwise.</p>`,
  notice: `
<h3>Legal notice</h3>
<p>Pursuant to article 10 of Spanish Law 34/2002 (LSSI-CE):</p>
<ul>
<li><b>Owner:</b> ${OWNER.company} (brand ${OWNER.brand}) · <b>Tax ID (NIF):</b> ${OWNER.nif}</li>
<li><b>Person in charge:</b> ${OWNER.name}</li>
<li><b>Activity:</b> ${OWNER.regEn}</li>
<li><b>Address:</b> ${OWNER.addressEn}</li>
<li><b>Contact:</b> ${OWNER.email}</li>
<li><b>Website:</b> ${OWNER.site}</li>
</ul>
<p><b>Hosting.</b> The application is served from GitHub Pages (GitHub, Inc.), which only delivers the application files (code, styles and images). No patient data goes through that server.</p>
<p><b>Intellectual property.</b> Design, texts and original code belong to the owner. Third-party components are used under their respective licenses, listed in the application help.</p>
<p><b>Links.</b> The owner is not responsible for the content of linked third-party sites.</p>
<p><b>Intended use.</b> Viewing and teaching tool. Not a CE-marked medical device and not intended for diagnosis (see the Terms of use).</p>`,
  privacy: `
<h3>Privacy policy</h3>
<p><b>Controller:</b> ${OWNER.company} (Tax ID ${OWNER.nif}), ${OWNER.addressEn}. Contact: ${OWNER.email}.</p>
<p><b>1. Patient data: none is collected.</b> DICOM files, scans and photographs are processed entirely in the user's browser (face detection also runs locally, without external services). They are never uploaded, copied or stored on any server. The owner has no access to them. The user (or their clinic) is the controller of their patients' data.</p>
<p><b>2. Anonymous usage statistics.</b> To know how many people use the tool we use <a href="https://www.goatcounter.com/help/privacy" target="_blank" rel="noopener">GoatCounter</a>, a service that <b>uses no cookies or identifiers</b> and does not keep the IP address. Recorded: page visited, approximate country, browser and system type, screen size, referring page, and two content-free events ("CBCT loaded", "scan loaded"). They cannot be linked to a person. Legal basis: the owner's legitimate interest in knowing how the tool is used (art. 6.1.f GDPR). Not performed for local use (localhost).</p>
<p><b>3. Storage in your browser.</b> The application keeps technical preferences in your own browser (localStorage): language, theme, font size, panel state and acceptance of the terms. They are needed for operation and never leave your computer. You can delete them from your browser settings.</p>
<p><b>4. Hosting.</b> GitHub Pages (GitHub, Inc., USA) serves the application files and, like any web server, may temporarily log IP addresses in its technical logs under its <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">privacy statement</a>. GitHub declares adherence to the EU-US Data Privacy Framework.</p>
<p><b>5. No accounts, forms or cookies.</b> The application requires no registration and sends no e-mails or commercial communications.</p>
<p><b>6. Your rights.</b> You may exercise your rights of access, rectification, erasure, objection, restriction and portability by writing to ${OWNER.email}, and lodge a complaint with the Spanish Data Protection Agency (www.aepd.es). Since no identifiable personal data is collected, in practice there is no data to hand over or delete.</p>
<p><b>7. Changes.</b> This policy may be updated; version date ${TERMS_VERSION}.</p>`,
  accept: 'I have read and accept the Terms of use: I am a healthcare professional or student, the tool is not a certified medical device and is not for diagnosis, and my patients’ data are my responsibility.',
  btn: 'Accept and enter',
  tabs: { terms: 'Terms of use', notice: 'Legal notice', privacy: 'Privacy' },
  close: 'Close',
  title: 'Before you start',
};

const TEXTS = { es: ES, en: EN };
export function legal(lang) { return TEXTS[lang] || ES; }

export function termsAccepted() {
  try { return localStorage.getItem(TERMS_KEY) === TERMS_VERSION; } catch (e) { return false; }
}

/**
 * Ventana legal. tab = 'terms' | 'notice' | 'privacy'. Si `gate` es true (primera visita) no se puede
 * cerrar sin marcar la casilla y pulsar «Aceptar»; guarda la aceptación en localStorage.
 * onLang(code) se llama al cambiar de idioma desde la ventana (para que la interfaz se traduzca).
 */
export function showLegal(tab = 'terms', { gate = false, onLang = null, onAccept = null } = {}) {
  const old = document.querySelector('.modal-bg.legal'); if (old) old.remove();
  const bg = document.createElement('div'); bg.className = 'modal-bg legal';
  let cur = tab;
  const render = () => {
    const L = legal(getLang());
    bg.innerHTML = `<div class="modal legal" role="dialog" aria-modal="true">
      <div class="legal-head"><h3>${gate ? L.title : L.tabs[cur]}</h3>
        <div class="legal-lang"><button class="btn-ghost btn-icon${getLang() === 'es' ? ' on' : ''}" data-lang="es">ES</button><button class="btn-ghost btn-icon${getLang() === 'en' ? ' on' : ''}" data-lang="en">EN</button></div></div>
      <div class="legal-tabs">${['terms', 'notice', 'privacy'].map((k) => `<button class="btn-ghost${k === cur ? ' on' : ''}" data-tab="${k}">${L.tabs[k]}</button>`).join('')}</div>
      <div class="legal-body">${L[cur]}</div>
      ${gate ? `<label class="chk legal-accept"><input type="checkbox" id="legal-ok"><span>${L.accept}</span></label>` : ''}
      <div class="mrow">${gate
    ? `<button class="btn-primary" id="legal-enter" disabled style="width:auto;min-height:40px;padding:8px 22px">${L.btn}</button>`
    : `<button class="btn-ghost" id="legal-close">${L.close}</button>`}</div>
    </div>`;
    bg.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { cur = b.dataset.tab; render(); }));
    bg.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); if (onLang) onLang(b.dataset.lang); render(); }));
    const close = bg.querySelector('#legal-close'); if (close) close.addEventListener('click', () => bg.remove());
    const ok = bg.querySelector('#legal-ok'), enter = bg.querySelector('#legal-enter');
    if (ok && enter) {
      ok.addEventListener('change', () => { enter.disabled = !ok.checked; });
      enter.addEventListener('click', () => {
        try { localStorage.setItem(TERMS_KEY, TERMS_VERSION); } catch (e) { /* sin almacenamiento: se pedirá cada vez */ }
        bg.remove(); if (onAccept) onAccept();
      });
    }
  };
  render();
  if (!gate) bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  return bg;
}

export { t };
