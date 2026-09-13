// tresD DICOM — DESHACER / REHACER global (como Ctrl+Z / Ctrl+Y de VOXEL, `_push_undo`).
// Cada acción del usuario que cambia el caso (añadir/quitar mallas, alinear, voltear, opacidad, color,
// visibilidad, segmentar, foto, mediciones, corte, preset/ventana del render…) se apunta como un par
// { label, undo(), redo() }. Las funciones pueden ser asíncronas. Pila acotada (≤ 50); cargar o quitar el
// DICOM vacía la historia (no se deshace). Mientras se ejecuta un undo/redo NO se apuntan acciones nuevas.
export class History {
  constructor(limit = 50) {
    this.limit = limit; this.undoStack = []; this.redoStack = [];
    this.busy = false;                 // ejecutando undo/redo (las llamadas anidadas no se apuntan)
    this.onChange = null;              // () → la interfaz refresca botones / tarjetas
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  /** Apunta una acción YA hecha. entry = { label, undo, redo }. Devuelve la entrada (o null si se ignora). */
  record(entry) {
    if (this.busy || !entry || typeof entry.undo !== 'function' || typeof entry.redo !== 'function') return null;
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this._changed();
    return entry;
  }
  async undo() {
    const e = this.undoStack.pop(); if (!e) return null;
    this.busy = true;
    try { await e.undo(); } catch (err) { console.warn('deshacer', err); } finally { this.busy = false; }
    this.redoStack.push(e);
    this._changed();
    return e;
  }
  async redo() {
    const e = this.redoStack.pop(); if (!e) return null;
    this.busy = true;
    try { await e.redo(); } catch (err) { console.warn('rehacer', err); } finally { this.busy = false; }
    this.undoStack.push(e);
    this._changed();
    return e;
  }
  clear() { this.undoStack.length = 0; this.redoStack.length = 0; this._changed(); }
  _changed() { if (this.onChange) { try { this.onChange(); } catch (e) { /* nada */ } } }
}
