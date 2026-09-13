// Sustituto MINIMO del modulo 'url' de Node para el navegador (lo pide xmlbuilder2, dependencia de dcmjs).
export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;
export function domainToASCII(d) { return d; }
export function domainToUnicode(d) { return d; }
export default { URL, URLSearchParams, domainToASCII, domainToUnicode };
