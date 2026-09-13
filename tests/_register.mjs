// Registro de un resolvedor para Node: permite importar módulos sin extensión (.js) como hace Vite.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('./_resolver.mjs', pathToFileURL(import.meta.filename));
