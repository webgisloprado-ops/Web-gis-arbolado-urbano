// ============================================================================
// backend.js — facade que selecciona el backend de datos y expone una interfaz
// única a las vistas. Detección automática por prioridad:
//   1. Firebase    (Firestore + Auth + Storage)   → si hay firebase-config.js válido
//   2. Estático    (datos/*)                       → fallback de solo lectura
// Las páginas importan SIEMPRE desde aquí, no de db.js/firebase.js directamente.
// ============================================================================
import * as fbData from './db.js';
import { SNAPSHOT_PATHS, SNAPSHOT_MARK } from './db.js';
import { login as fbLogin, logout as fbLogout, currentUser as fbUser, getUserRole as fbRole, initFirebase } from './firebase.js';

let _backend = null;

export async function getBackend() {
  if (_backend) return _backend;
  try { if ((await initFirebase()).configured) { _backend = 'firebase'; return _backend; } } catch { /* */ }
  _backend = 'estatico';
  return _backend;
}

export async function isConfigured() { return (await getBackend()) !== 'estatico'; }
export function resetBackendCache() { _backend = null; }

// ---- Autenticación ----
export const login = (email, password) => fbLogin(email, password);
export const logout = () => fbLogout();
export const currentUser = () => fbUser();
export const getUserRole = user => fbRole(user);

// ---- Árboles ----
export const listArboles = o => fbData.listArboles(o);
export const getArbol = id => fbData.getArbol(id);
export const saveArbol = (d, o) => fbData.saveArbol(d, o);
export const softDeleteArbol = id => fbData.softDeleteArbol(id);
export const restoreArbol = id => fbData.restoreArbol(id);
export const nextArbolId = () => fbData.nextArbolId();
export const bulkImportArboles = (rows, m, k, o) => fbData.bulkImportArboles(rows, m, k, o);

// ---- Especies ----
export const listEspecies = () => fbData.listEspecies();
export const saveEspecie = (d, o) => fbData.saveEspecie(d, o);
export const softDeleteEspecie = s => fbData.softDeleteEspecie(s);
export const setEspecieImagen = (s, img) => fbData.setEspecieImagen(s, img);
export const uploadImagen = (f, s) => fbData.uploadImagen(f, s);

// ---- Reportes ----
export const crearReporte = d => fbData.crearReporte(d);
export const listReportes = e => fbData.listReportes(e);
export const resolverReporte = (id, e) => fbData.resolverReporte(id, e);

// ---- Auditoría ----
export const listAuditoria = max => fbData.listAuditoria(max);

// ---- Usuarios ----
export const listUsuarios = () => fbData.listUsuarios();

// ---- Snapshot ----
export const publishSnapshot = o => fbData.publishSnapshot(o);
export const snapshotURL = w => fbData.snapshotURL(w);

// Fuentes del snapshot para la vista pública (o null → fallback estático).
// Si Storage aún no está activado o no hay snapshot publicado, se usan los
// datos estáticos de datos/ sin romper la vista pública.
const conLimite = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export async function snapshotSources() {
  if ((await getBackend()) !== 'firebase') return null;
  try {
    return await conLimite((async () => {
      const f = await initFirebase();
      // 1) ¿Hay un snapshot publicado? (meta/publicacion es de lectura pública)
      const { doc, getDoc } = f.firestore;
      const marca = await getDoc(doc(f.db, 'meta', SNAPSHOT_MARK));
      if (!marca.exists() || !marca.data().publicado) return null;
      // 2) URLs de descarga del snapshot en Storage.
      const { ref, getDownloadURL } = f.storageApi;
      const [trees, species, stats, meta] = await Promise.all([
        getDownloadURL(ref(f.storage, SNAPSHOT_PATHS.trees)),
        getDownloadURL(ref(f.storage, SNAPSHOT_PATHS.species)),
        getDownloadURL(ref(f.storage, SNAPSHOT_PATHS.stats)),
        getDownloadURL(ref(f.storage, SNAPSHOT_PATHS.meta)).catch(() => null),
      ]);
      return { trees, species, stats, meta, origen: 'firebase' };
    })(), 5000);
  } catch { return null; }
}
