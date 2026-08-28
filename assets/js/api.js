// ============================================================================
// api.js — adaptador cliente del backend Vercel (funciones /api/*)
// ----------------------------------------------------------------------------
// Expone la MISMA interfaz que db.js (Firebase), pero hablando con el API
// serverless (Postgres + Blob) por fetch. El facade backend.js decide cuál usar.
// ============================================================================
import { normalizeRow } from './db.js';

const BULK_CHUNK = 500;   // filas por lote enviadas al servidor

async function req(method, url, bodyObj) {
  const res = await fetch(url, {
    method, credentials: 'include',
    headers: bodyObj ? { 'Content-Type': 'application/json' } : undefined,
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
  return data;
}

// Fila Postgres (snake_case) → objeto que esperan las vistas (camelCase).
function toClient(r) {
  return {
    _id: String(r.id), id: r.id, codigo: r.codigo,
    especieKey: r.especie_key, especieSlug: r.especie_slug,
    nombreCientifico: r.nombre_cientifico, familia: r.familia,
    lat: r.lat, lon: r.lon, direccion: r.direccion, sector: r.sector,
    dap: r.dap, alturaTotal: r.altura_total, alturaCopa: r.altura_copa,
    fuente: r.fuente, coordValida: r.coord_valida, duplicado: r.duplicado, identificada: r.identificada,
  };
}

// ---- Auth ----
export async function login(email, password) {
  const r = await req('POST', '/api/login', { email, password });
  return { user: r.user, rol: r.rol };
}
export const logout = () => req('POST', '/api/logout');
export async function currentUser() { const r = await req('GET', '/api/me').catch(() => ({ user: null })); return r.user || null; }
export async function getUserRole(user) { return user ? user.rol : (await currentUser())?.rol || null; }

// ---- Árboles ----
export async function listArboles({ pageSize = 20, cursor = null, sector = null, especie = null } = {}) {
  const qs = new URLSearchParams({ pageSize });
  if (cursor) qs.set('cursor', cursor);
  if (sector) qs.set('sector', sector);
  if (especie) qs.set('especie', especie);
  const r = await req('GET', `/api/trees?${qs}`);
  return { items: (r.items || []).map(toClient), cursor: r.nextCursor, done: r.done };
}
export async function getArbol(id) { const r = await req('GET', `/api/trees/${id}`); return toClient(r); }
export async function saveArbol(data, { create = false } = {}) {
  if (create) return (await req('POST', '/api/trees', data)).id;
  return (await req('PUT', `/api/trees/${data.id}`, data)).id;
}
export const softDeleteArbol = id => req('DELETE', `/api/trees/${id}`);
export const restoreArbol = id => req('DELETE', `/api/trees/${id}?restore=1`);
export async function nextArbolId() { return (await req('GET', '/api/trees?next=1')).nextId; }

export async function bulkImportArboles(rows, mapping, kind, { onProgress } = {}) {
  const total = rows.length;
  let written = 0, skipped = 0, done = 0;
  for (let i = 0; i < total; i += BULK_CHUNK) {
    const arboles = rows.slice(i, i + BULK_CHUNK).map(row => normalizeRow(row, mapping, kind));
    const r = await req('POST', '/api/trees/bulk', { arboles });
    written += r.written || 0; skipped += r.skipped || 0; done = Math.min(i + BULK_CHUNK, total);
    onProgress && onProgress({ done, total, written, skipped });
    await new Promise(res => setTimeout(res, 0));   // cede el hilo entre lotes
  }
  return { written, skipped, total };
}

// ---- Especies ----
export async function listEspecies() { return await req('GET', '/api/species'); }
export async function saveEspecie(data, { create = false } = {}) {
  if (create) return (await req('POST', '/api/species', data)).slug;
  return (await req('PUT', `/api/species/${data.slug}`, data)).slug;
}
export const softDeleteEspecie = slug => req('DELETE', `/api/species/${slug}`);
export const setEspecieImagen = (slug, imagen) => req('PUT', `/api/species/${slug}?action=image`, { imagen });

export async function uploadImagen(file, slug) {
  const dataBase64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject; r.readAsDataURL(file);
  });
  const r = await req('POST', '/api/upload', { filename: `${slug}-${Date.now()}-${file.name}`, contentType: file.type, dataBase64 });
  return { url: r.url };
}

// ---- Reportes ----
export const crearReporte = data => req('POST', '/api/reports', data).then(r => r.id);
export async function listReportes(estado = null) { return await req('GET', `/api/reports${estado ? `?estado=${estado}` : ''}`); }
export const resolverReporte = (id, estado) => req('PUT', `/api/reports/${id}`, { estado });

// ---- Auditoría ----
export async function listAuditoria(max = 150) { return await req('GET', `/api/audit?max=${max}`); }

// ---- Usuarios ----
export async function listUsuarios() { return await req('GET', '/api/users'); }

// ---- Snapshot ----
export async function publishSnapshot({ onProgress } = {}) {
  onProgress && onProgress({ fase: 'subiendo' });
  const r = await req('POST', '/api/publish');
  return { arboles: r.arboles, especies: r.especies };
}
export async function snapshotURL(which) {
  try { const r = await fetch('/api/public/snapshot'); if (!r.ok) return null; const j = await r.json(); return j.urls?.[which] || null; }
  catch { return null; }
}
export async function snapshotSources() {
  try {
    const r = await fetch('/api/public/snapshot', { cache: 'no-store' });
    if (r.status !== 200) return null;
    const j = await r.json();
    if (!j.urls) return null;
    return { ...j.urls, origen: 'vercel' };
  } catch { return null; }
}
