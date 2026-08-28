// ============================================================================
// backend.js — facade que selecciona el backend de datos y expone una interfaz
// única a las vistas. Detección automática por prioridad:
//   1. Vercel      (funciones /api/* + Postgres)  → si /api/health responde db:true
//   2. Firebase    (Firestore + Auth + Storage)   → si hay firebase-config.js válido
//   3. Estático    (public/data/*)                → fallback de solo lectura
// Las páginas importan SIEMPRE desde aquí, no de db.js/api.js directamente.
// ============================================================================
import * as fbData from './db.js';
import { SNAPSHOT_PATHS } from './db.js';
import { login as fbLogin, logout as fbLogout, currentUser as fbUser, getUserRole as fbRole, initFirebase } from './firebase.js';
import * as vx from './api.js';

let _backend = null;

export async function getBackend() {
  if (_backend) return _backend;
  // 1) ¿Backend Vercel disponible y con base configurada?
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); if (j && j.backend === 'vercel' && j.db) { _backend = 'vercel'; return _backend; } }
  } catch { /* sin /api → no es Vercel */ }
  // 2) ¿Firebase configurado?
  try { if ((await initFirebase()).configured) { _backend = 'firebase'; return _backend; } } catch { /* */ }
  // 3) Estático.
  _backend = 'estatico';
  return _backend;
}

export async function isConfigured() { return (await getBackend()) !== 'estatico'; }
export function resetBackendCache() { _backend = null; }

const isVercel = async () => (await getBackend()) === 'vercel';

// ---- Autenticación ----
export async function login(email, password) { return (await isVercel()) ? vx.login(email, password) : fbLogin(email, password); }
export async function logout() { return (await isVercel()) ? vx.logout() : fbLogout(); }
export async function currentUser() { return (await isVercel()) ? vx.currentUser() : fbUser(); }
export async function getUserRole(user) { return (await isVercel()) ? vx.getUserRole(user) : fbRole(user); }

// ---- Árboles ----
export async function listArboles(o) { return (await isVercel()) ? vx.listArboles(o) : fbData.listArboles(o); }
export async function getArbol(id) { return (await isVercel()) ? vx.getArbol(id) : fbData.getArbol(id); }
export async function saveArbol(d, o) { return (await isVercel()) ? vx.saveArbol(d, o) : fbData.saveArbol(d, o); }
export async function softDeleteArbol(id) { return (await isVercel()) ? vx.softDeleteArbol(id) : fbData.softDeleteArbol(id); }
export async function restoreArbol(id) { return (await isVercel()) ? vx.restoreArbol(id) : fbData.restoreArbol(id); }
export async function nextArbolId() { return (await isVercel()) ? vx.nextArbolId() : fbData.nextArbolId(); }
export async function bulkImportArboles(rows, m, k, o) { return (await isVercel()) ? vx.bulkImportArboles(rows, m, k, o) : fbData.bulkImportArboles(rows, m, k, o); }

// ---- Especies ----
export async function listEspecies() { return (await isVercel()) ? vx.listEspecies() : fbData.listEspecies(); }
export async function saveEspecie(d, o) { return (await isVercel()) ? vx.saveEspecie(d, o) : fbData.saveEspecie(d, o); }
export async function softDeleteEspecie(s) { return (await isVercel()) ? vx.softDeleteEspecie(s) : fbData.softDeleteEspecie(s); }
export async function setEspecieImagen(s, img) { return (await isVercel()) ? vx.setEspecieImagen(s, img) : fbData.setEspecieImagen(s, img); }
export async function uploadImagen(f, s) { return (await isVercel()) ? vx.uploadImagen(f, s) : fbData.uploadImagen(f, s); }

// ---- Reportes ----
export async function crearReporte(d) { return (await isVercel()) ? vx.crearReporte(d) : fbData.crearReporte(d); }
export async function listReportes(e) { return (await isVercel()) ? vx.listReportes(e) : fbData.listReportes(e); }
export async function resolverReporte(id, e) { return (await isVercel()) ? vx.resolverReporte(id, e) : fbData.resolverReporte(id, e); }

// ---- Auditoría ----
export async function listAuditoria(max) { return (await isVercel()) ? vx.listAuditoria(max) : fbData.listAuditoria(max); }

// ---- Usuarios ----
export async function listUsuarios() { return (await isVercel()) ? vx.listUsuarios() : fbData.listUsuarios(); }

// ---- Snapshot ----
export async function publishSnapshot(o) { return (await isVercel()) ? vx.publishSnapshot(o) : fbData.publishSnapshot(o); }
export async function snapshotURL(w) { return (await isVercel()) ? vx.snapshotURL(w) : fbData.snapshotURL(w); }

// Fuentes del snapshot para la vista pública (o null → fallback estático).
export async function snapshotSources() {
  const b = await getBackend();
  if (b === 'vercel') return vx.snapshotSources();
  if (b === 'firebase') {
    try {
      const f = await initFirebase();
      const { ref, getDownloadURL } = f.storageApi;
      const [trees, species, stats, meta] = await Promise.all([
        getDownloadURL(ref(f.storage, SNAPSHOT_PATHS.trees)),
        getDownloadURL(ref(f.storage, SNAPSHOT_PATHS.species)),
        getDownloadURL(ref(f.storage, SNAPSHOT_PATHS.stats)),
        getDownloadURL(ref(f.storage, SNAPSHOT_PATHS.meta)).catch(() => null),
      ]);
      return { trees, species, stats, meta, origen: 'firebase' };
    } catch { return null; }
  }
  return null;
}
