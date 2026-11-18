// ============================================================================
// backend.js — facade que selecciona el backend de datos y expone una interfaz
// única a las vistas. Detección automática por prioridad:
//   1. Firebase    (Firestore + Auth, plan gratuito) → si hay firebase-config.js válido
//   2. Estático    (datos/*)                       → fallback de solo lectura
// Las páginas importan SIEMPRE desde aquí, no de db.js/firebase.js directamente.
// ============================================================================
import * as fbData from './db.js';
import {
  login as fbLogin, logout as fbLogout, currentUser as fbUser, getUserRole as fbRole, getPerfil as fbPerfil,
  cambiarPassword as fbCambiarPassword, crearCuentaAuth, enviarResetPassword as fbReset, initFirebase,
} from './firebase.js';

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

// ---- Perfil y contraseña ----
export const getPerfil = user => fbPerfil(user);
export const cambiarPassword = (actual, nueva) => fbCambiarPassword(actual, nueva);
export const enviarResetPassword = email => fbReset(email);

// ---- Usuarios (CRUD del superadministrador) ----
export const listUsuarios = () => fbData.listUsuarios();
export async function crearUsuario({ email, nombre, rol, password }) {
  const uid = await crearCuentaAuth(email, password);
  await fbData.crearPerfilUsuario(uid, { email, nombre, rol });
  return uid;
}
export const actualizarUsuario = (uid, cambios, accion) => fbData.actualizarPerfilUsuario(uid, cambios, accion);

// ---- Capas GIS ----
// En modo estático (sin Firebase) no hay capas adicionales.
export async function listCapas() {
  if ((await getBackend()) !== 'firebase') return [];
  return fbData.listCapas();
}
export const getCapaGeoJSON = capa => fbData.getCapaGeoJSON(capa);
export const guardarCapa = (d, o) => fbData.guardarCapa(d, o);
export const editarCapa = (id, d) => fbData.editarCapa(id, d);
export const eliminarCapa = id => fbData.eliminarCapa(id);

// Permisos por rol (compartidos por las vistas).
export const ROLES_ESCRITURA = ['superadmin', 'admin', 'gis', 'editor'];
export const puedeImportar = rol => ['superadmin', 'admin'].includes(rol);
export const esSuperadmin = rol => rol === 'superadmin';

// ---- Snapshot ----
export const publishSnapshot = o => fbData.publishSnapshot(o);
export const snapshotURL = w => fbData.snapshotURL(w);

// ---- Catastro base ----
export const estadoCargaBase = () => fbData.estadoCargaBase();
export const cargarCatastroBase = o => fbData.cargarCatastroBase(o);

// Fuentes del snapshot para la vista pública (o null → fallback estático).
// Si no hay snapshot publicado o Firestore no responde a tiempo, se usan los
// datos estáticos de datos/ sin romper la vista pública. El snapshot se
// entrega como URLs blob locales para que data.js lo cargue igual que datos/.
const conLimite = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const blobURL = obj => (obj ? URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' })) : null);

export async function snapshotSources() {
  if ((await getBackend()) !== 'firebase') return null;
  try {
    if (!(await conLimite(fbData.haySnapshot(), 5000))) return null;
    const snap = await conLimite(fbData.readSnapshot(), 30000);
    if (!snap) return null;
    return {
      trees: blobURL(snap.trees), species: blobURL(snap.species),
      stats: blobURL(snap.stats), meta: blobURL(snap.meta), origen: 'firebase',
    };
  } catch { return null; }
}
