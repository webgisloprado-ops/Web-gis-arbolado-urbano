// ============================================================================
// db.js — capa de acceso a datos sobre Firestore + Storage
// ----------------------------------------------------------------------------
// Firestore es la FUENTE DE LA VERDAD (árboles, especies, reportes, usuarios,
// auditoría). La vista pública NO lee 17.000 documentos: lee un "snapshot"
// publicado en Storage (trees.geojson / species.json / stats.json). El admin
// edita en vivo y pulsa "Publicar" para regenerar ese snapshot.
//
// Todo cambio (alta/edición/borrado) queda con trazabilidad (quién y cuándo) y
// escribe una entrada en la colección `auditoria`. El borrado es LÓGICO
// (campo `eliminado`), nunca físico: siempre se puede recuperar.
// ============================================================================
import { initFirebase, currentUser } from './firebase.js';
import { slugify } from './util.js';

// Rutas del snapshot publicado dentro de Storage.
export const SNAPSHOT_PATHS = {
  trees: 'publico/trees.geojson',
  species: 'publico/species.json',
  stats: 'publico/stats.json',
  meta: 'publico/meta.json',
};

const BATCH_SIZE = 450;              // < 500 operaciones por lote (límite Firestore)

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------
async function fb() {
  const f = await initFirebase();
  if (!f.configured) throw new Error('Firebase no está configurado.');
  return f;
}
export async function isConfigured() {
  return (await initFirebase()).configured;
}
const yield_ = () => new Promise(r => setTimeout(r, 0));   // cede el hilo (no traba la UI)

// Sello de trazabilidad para una escritura.
function stamp(f, user, { create = false } = {}) {
  const s = f.firestore.serverTimestamp();
  const who = user ? (user.email || user.uid) : 'sistema';
  const base = { modificadoPor: who, modificadoEn: s };
  if (create) { base.creadoPor = who; base.creadoEn = s; base.eliminado = false; base.version = 1; }
  else base.version = f.firestore.increment(1);
  return base;
}

// Registro de auditoría (append-only). Nunca se elimina información sin dejar rastro.
export async function audit(entidad, entidadId, accion, user, diff = null) {
  try {
    const f = await fb();
    await f.firestore.addDoc(f.firestore.collection(f.db, 'auditoria'), {
      entidad, entidadId: String(entidadId), accion,
      usuario: user ? (user.email || user.uid) : 'sistema',
      diff: diff ? JSON.parse(JSON.stringify(diff)) : null,
      fecha: f.firestore.serverTimestamp(),
    });
  } catch (e) { console.warn('No se pudo registrar auditoría:', e.message); }
}

// ===========================================================================
// Conversión entre el documento de Firestore (campos completos) y el
// "feature" compacto del snapshot que consume la vista pública.
// ===========================================================================
export function docToFeature(d) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
    properties: {
      id: d.id, codigo: d.codigo, e: d.especieKey, sp: d.especieSlug,
      sci: d.nombreCientifico || null, fam: d.familia || null,
      dir: d.direccion || null, sec: d.sector || null,
      dap: d.dap ?? null, hT: d.alturaTotal ?? null, hC: d.alturaCopa ?? null,
      fte: d.fuente || null, ok: d.coordValida !== false,
      dup: !!d.duplicado, idf: !!d.identificada,
    },
  };
}

// Normaliza una fila importada (con el mapeo de columnas) a documento Firestore.
export function rowToDoc(row, mapping, kind, idNum) {
  let lat, lon, props;
  if (kind === 'geojson') {
    const c = row.geometry?.coordinates || [];
    lon = +c[0]; lat = +c[1]; props = row.properties || {};
  } else {
    props = row; lat = parseFloat(row[mapping.latitud]); lon = parseFloat(row[mapping.longitud]);
  }
  const get = k => (mapping[k] != null ? props[mapping[k]] : undefined);
  const comun = (get('especie') ?? props.especie ?? '').toString().trim();
  const sci = (get('nombre_cientifico') ?? '').toString().trim();
  const slug = slugify(comun || sci || 'sin-especie');
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  return {
    id: idNum,
    codigo: (get('codigo') || `ARB-${String(idNum).padStart(5, '0')}`).toString(),
    especieKey: (comun || 'SIN ESPECIE').toUpperCase(),
    especieSlug: slug,
    nombreCientifico: sci || null,
    familia: (props.familia || props.fam || null),
    lat, lon,
    direccion: (get('direccion') || null),
    sector: (get('sector') || null),
    dap: num(get('diametro')),
    alturaTotal: num(get('altura')),
    alturaCopa: num(props.altura_cop ?? props.hC),
    fuente: (props.fuente || props.fte || 'Importación'),
    coordValida: Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180,
    duplicado: false,
    identificada: !!(sci || comun),
  };
}

// ===========================================================================
// ÁRBOLES — CRUD individual (Firestore en vivo, para el panel admin)
// ===========================================================================
export async function listArboles({ pageSize = 25, cursor = null, sector = null, especie = null } = {}) {
  const f = await fb();
  const { collection, query, where, orderBy, limit, startAfter, getDocs } = f.firestore;
  const clauses = [where('eliminado', '==', false)];
  if (sector) clauses.push(where('sector', '==', sector));
  if (especie) clauses.push(where('especieSlug', '==', especie));
  clauses.push(orderBy('id'));
  if (cursor) clauses.push(startAfter(cursor));
  clauses.push(limit(pageSize));
  const snap = await getDocs(query(collection(f.db, 'arboles'), ...clauses));
  const items = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  return { items, cursor: snap.docs[snap.docs.length - 1] || null, done: snap.size < pageSize };
}

export async function getArbol(id) {
  const f = await fb();
  const ref = f.firestore.doc(f.db, 'arboles', String(id));
  const s = await f.firestore.getDoc(ref);
  return s.exists() ? { _id: s.id, ...s.data() } : null;
}

// Alta o edición. `data` trae los campos editables; se sella la trazabilidad.
export async function saveArbol(data, { create = false } = {}) {
  const f = await fb();
  const user = await currentUser();
  const id = String(data.id);
  const ref = f.firestore.doc(f.db, 'arboles', id);
  const payload = { ...data, id: +data.id, ...stamp(f, user, { create }) };
  if (create) await f.firestore.setDoc(ref, payload);
  else await f.firestore.updateDoc(ref, payload);
  await audit('arbol', id, create ? 'alta' : 'edicion', user, data);
  return id;
}

// Borrado LÓGICO (recuperable) y restauración.
export async function softDeleteArbol(id) {
  const f = await fb();
  const user = await currentUser();
  await f.firestore.updateDoc(f.firestore.doc(f.db, 'arboles', String(id)),
    { eliminado: true, ...stamp(f, user) });
  await audit('arbol', id, 'borrado-logico', user);
}
export async function restoreArbol(id) {
  const f = await fb();
  const user = await currentUser();
  await f.firestore.updateDoc(f.firestore.doc(f.db, 'arboles', String(id)),
    { eliminado: false, ...stamp(f, user) });
  await audit('arbol', id, 'restauracion', user);
}

// Próximo id numérico libre (para altas unitarias).
export async function nextArbolId() {
  const f = await fb();
  const { collection, query, orderBy, limit, getDocs } = f.firestore;
  const snap = await getDocs(query(collection(f.db, 'arboles'), orderBy('id', 'desc'), limit(1)));
  return snap.empty ? 1 : (snap.docs[0].data().id + 1);
}

// ===========================================================================
// IMPORTACIÓN MASIVA — escritura por lotes que NO traba el navegador
// ===========================================================================
export async function bulkImportArboles(rows, mapping, kind, { onProgress } = {}) {
  const f = await fb();
  const user = await currentUser();
  const { writeBatch, doc } = f.firestore;
  let startId = await nextArbolId();
  let written = 0, skipped = 0;
  const total = rows.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = writeBatch(f.db);
    const slice = rows.slice(i, i + BATCH_SIZE);
    for (const row of slice) {
      const d = rowToDoc(row, mapping, kind, startId);
      if (!d.coordValida) { skipped++; continue; }   // no se importan coordenadas inválidas
      const ref = doc(f.db, 'arboles', String(startId));
      batch.set(ref, { ...d, ...stamp(f, user, { create: true }), fuente: d.fuente });
      startId++; written++;
    }
    await batch.commit();
    onProgress && onProgress({ done: Math.min(i + BATCH_SIZE, total), total, written, skipped });
    await yield_();                                  // cede el hilo entre lotes
  }
  await audit('arbol', '(masivo)', 'importacion', user, { written, skipped, total });
  return { written, skipped, total };
}

// ===========================================================================
// ESPECIES — CRUD + gestión de imágenes (prioridad guardada en Firestore)
// ===========================================================================
export async function listEspecies() {
  const f = await fb();
  const { collection, query, where, getDocs } = f.firestore;
  const snap = await getDocs(query(collection(f.db, 'especies'), where('eliminado', '==', false)));
  return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
}

export async function saveEspecie(data, { create = false } = {}) {
  const f = await fb();
  const user = await currentUser();
  const slug = data.slug || slugify(data.comun || data.cientifico);
  const ref = f.firestore.doc(f.db, 'especies', slug);
  const payload = { ...data, slug, ...stamp(f, user, { create }) };
  if (create) await f.firestore.setDoc(ref, payload, { merge: true });
  else await f.firestore.updateDoc(ref, payload);
  await audit('especie', slug, create ? 'alta' : 'edicion', user, data);
  return slug;
}

export async function softDeleteEspecie(slug) {
  const f = await fb();
  const user = await currentUser();
  await f.firestore.updateDoc(f.firestore.doc(f.db, 'especies', slug), { eliminado: true, ...stamp(f, user) });
  await audit('especie', slug, 'borrado-logico', user);
}

// Imagen de especie: prioridad admin → banco autorizado → externa → IA.
// Se guarda { url, thumb, fuente, autor, licencia, fecha, prioridad } en el doc.
export async function setEspecieImagen(slug, imagen) {
  const f = await fb();
  const user = await currentUser();
  const payload = imagen
    ? { imagenAdmin: { ...imagen, fecha: new Date().toISOString(), prioridad: 'admin' }, ...stamp(f, user) }
    : { imagenAdmin: f.firestore.deleteField(), ...stamp(f, user) };
  await f.firestore.updateDoc(f.firestore.doc(f.db, 'especies', slug), payload);
  await audit('especie', slug, imagen ? 'imagen-asignada' : 'imagen-restablecida', user, imagen);
}

// Sube un archivo de imagen a Storage y devuelve su URL pública.
export async function uploadImagen(file, slug) {
  const f = await fb();
  const { ref, uploadBytes, getDownloadURL } = f.storageApi;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `imagenes/especies/${slug}-${Date.now()}.${ext}`;
  const r = ref(f.storage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return { url: await getDownloadURL(r), path };
}

// ===========================================================================
// REPORTES CIUDADANOS — creación pública, revisión por admin
// ===========================================================================
export async function crearReporte(data) {
  const f = await fb();
  const { collection, addDoc, serverTimestamp } = f.firestore;
  const ref = await addDoc(collection(f.db, 'reportes'), {
    arbolId: data.arbolId ?? null, arbolCodigo: data.arbolCodigo ?? null,
    tipo: data.tipo, comentario: data.comentario || '',
    lat: data.lat ?? null, lon: data.lon ?? null, fotoUrl: data.fotoUrl ?? null,
    estado: 'pendiente', creadoEn: serverTimestamp(),
  });
  return ref.id;
}

export async function listReportes(estado = null) {
  const f = await fb();
  const { collection, query, where, orderBy, getDocs } = f.firestore;
  const clauses = [];
  if (estado) clauses.push(where('estado', '==', estado));
  clauses.push(orderBy('creadoEn', 'desc'));
  const snap = await getDocs(query(collection(f.db, 'reportes'), ...clauses));
  return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
}

export async function resolverReporte(id, estado) {
  const f = await fb();
  const user = await currentUser();
  await f.firestore.updateDoc(f.firestore.doc(f.db, 'reportes', id),
    { estado, revisadoPor: user ? (user.email || user.uid) : 'admin', revisadoEn: f.firestore.serverTimestamp() });
  await audit('reporte', id, `reporte-${estado}`, user);
}

// ===========================================================================
// AUDITORÍA — lectura para el panel
// ===========================================================================
export async function listAuditoria(max = 100) {
  const f = await fb();
  const { collection, query, orderBy, limit, getDocs } = f.firestore;
  const snap = await getDocs(query(collection(f.db, 'auditoria'), orderBy('fecha', 'desc'), limit(max)));
  return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
}

// ===========================================================================
// SNAPSHOT — publicación del catastro para la vista pública
// ---------------------------------------------------------------------------
// Lee TODOS los árboles/especies no eliminados de Firestore y sube a Storage
// trees.geojson + species.json + stats.json + meta.json. Es una acción de
// administrador (ocasional): el costo de leer todo el catastro se paga una vez
// al publicar, no en cada visita.
// ===========================================================================
export async function publishSnapshot({ onProgress } = {}) {
  const f = await fb();
  const user = await currentUser();
  const { collection, query, where, orderBy, limit, startAfter, getDocs } = f.firestore;

  // 1) Leer todos los árboles vivos, paginando para no saturar memoria.
  const features = [];
  let cursor = null;
  for (;;) {
    const clauses = [where('eliminado', '==', false), orderBy('id'), limit(2000)];
    if (cursor) clauses.splice(2, 0, startAfter(cursor));
    const snap = await getDocs(query(collection(f.db, 'arboles'), ...clauses));
    if (snap.empty) break;
    snap.docs.forEach(d => features.push(docToFeature(d.data())));
    cursor = snap.docs[snap.docs.length - 1];
    onProgress && onProgress({ fase: 'arboles', n: features.length });
    if (snap.size < 2000) break;
    await yield_();
  }

  // 2) Leer especies vivas.
  const spSnap = await getDocs(query(collection(f.db, 'especies'), where('eliminado', '==', false)));
  const species = spSnap.docs.map(d => d.data());

  // 3) Calcular estadísticas y metadatos.
  const stats = computeStats(features, species);
  const meta = {
    fuente_datos: 'Firestore (fuente de la verdad)',
    crs: 'EPSG:4326 (WGS 84)',
    arboles_publicados: features.length,
    especies: species.length,
    publicado_en: new Date().toISOString(),
    publicado_por: user ? (user.email || user.uid) : 'admin',
  };

  // 4) Subir a Storage.
  const { ref, uploadString } = f.storageApi;
  const put = (path, obj) => uploadString(ref(f.storage, path), JSON.stringify(obj),
    'raw', { contentType: 'application/json; charset=utf-8', cacheControl: 'public,max-age=300' });
  onProgress && onProgress({ fase: 'subiendo' });
  await Promise.all([
    put(SNAPSHOT_PATHS.trees, { type: 'FeatureCollection', features }),
    put(SNAPSHOT_PATHS.species, species),
    put(SNAPSHOT_PATHS.stats, stats),
    put(SNAPSHOT_PATHS.meta, meta),
  ]);
  await audit('snapshot', '(publicacion)', 'publicacion', user, { arboles: features.length, especies: species.length });
  return { arboles: features.length, especies: species.length };
}

// Estadísticas del panel a partir del snapshot (misma forma que stats.json).
function computeStats(features, species) {
  const bySector = new Map();
  let dapSum = 0, dapN = 0, hSum = 0, hN = 0, idf = 0;
  const speciesSet = new Set();
  for (const ft of features) {
    const p = ft.properties;
    bySector.set(p.sec || 'Sin sector', (bySector.get(p.sec || 'Sin sector') || 0) + 1);
    if (p.dap != null) { dapSum += p.dap; dapN++; }
    if (p.hT != null) { hSum += p.hT; hN++; }
    if (p.idf) idf++;
    if (p.sp) speciesSet.add(p.sp);
  }
  const spConIndiv = species.filter(s => !s.es_no_especie);
  const nativas = species.filter(s => s.origen === 'Nativa').length;
  const sectores = [...bySector.entries()].map(([sector, n]) => ({ sector, n })).sort((a, b) => b.n - a.n);
  const top = [...species].filter(s => s.individuos).sort((a, b) => b.individuos - a.individuos).slice(0, 10)
    .map(s => ({ comun: s.comun, cientifico: s.cientifico, key: s.key, slug: s.slug, n: s.individuos }));
  return {
    total_arboles: features.length, total_registros: features.length,
    especies: spConIndiv.length, especies_todas: species.length,
    familias: new Set(species.map(s => s.familia).filter(Boolean)).size,
    nativas_pct: species.length ? Math.round(nativas / species.length * 100) : 0,
    identificadas_pct: features.length ? Math.round(idf / features.length * 100) : 0,
    dap_promedio: dapN ? +(dapSum / dapN).toFixed(1) : 0,
    altura_promedio: hN ? +(hSum / hN).toFixed(1) : 0,
    calidad: features.length ? Math.round((idf / features.length) * 100 * 0.6 + (dapN / features.length) * 100 * 0.4) : 0,
    sectores, top_especies: top,
  };
}

// URL de descarga de un archivo del snapshot en Storage (o null si no existe).
export async function snapshotURL(which) {
  try {
    const f = await fb();
    return await f.storageApi.getDownloadURL(f.storageApi.ref(f.storage, SNAPSHOT_PATHS[which]));
  } catch { return null; }
}
