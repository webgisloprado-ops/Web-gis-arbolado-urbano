// ============================================================================
// db.js — capa de acceso a datos sobre Firestore (plan gratuito Spark)
// ----------------------------------------------------------------------------
// Firestore es la FUENTE DE LA VERDAD (árboles, especies, reportes, usuarios,
// auditoría). La vista pública NO lee 17.000 documentos: lee un "snapshot"
// publicado en la colección `snapshot` (JSON troceado en documentos < 1 MB).
// El admin edita en vivo y pulsa "Publicar" para regenerar ese snapshot.
// No se usa Cloud Storage (requiere plan de pago): las fotos de especies se
// comprimen en el navegador y se guardan como data URL en Firestore.
//
// Todo cambio (alta/edición/borrado) queda con trazabilidad (quién y cuándo) y
// escribe una entrada en la colección `auditoria`. El borrado es LÓGICO
// (campo `eliminado`), nunca físico: siempre se puede recuperar.
// ============================================================================
import { initFirebase, currentUser } from './firebase.js';
import { slugify } from './util.js';

// Partes del snapshot publicado (colección `snapshot`).
export const SNAPSHOT_NAMES = ['trees', 'species', 'stats', 'meta'];
const SNAP_COL = 'snapshot';
const SNAP_CHUNK = 250000;           // caracteres por documento (< 1 MiB aun con UTF-8 de 3 bytes)
const MAX_IMG = 180000;              // tamaño máx. de una foto como data URL (~135 KB)
// Documento meta/{SNAPSHOT_MARK} que indica que hay un snapshot publicado.
export const SNAPSHOT_MARK = 'publicacion';
// Documento meta/{CARGA_BASE} que indica que el catastro base ya se cargó.
const CARGA_BASE = 'carga_base';

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

// Normaliza una fila importada (con el mapeo de columnas) a los campos comunes,
// SIN asignar id ni código (los asigna cada backend). Compartido Firebase/Vercel.
export function normalizeRow(row, mapping, kind) {
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
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  return {
    codigo: (get('codigo') || '').toString().trim() || null,
    especieKey: (comun || 'SIN ESPECIE').toUpperCase(),
    especieSlug: slugify(comun || sci || 'sin-especie'),
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

// Documento Firestore completo (con id y código por defecto).
export function rowToDoc(row, mapping, kind, idNum) {
  const base = normalizeRow(row, mapping, kind);
  return { id: idNum, ...base, codigo: base.codigo || `ARB-${String(idNum).padStart(5, '0')}` };
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

// Comprime una imagen en el navegador y la devuelve como data URL JPEG, lista
// para guardarse en el documento de la especie (sin Cloud Storage).
export async function uploadImagen(file) {
  if (!/^image\//.test(file.type)) throw new Error('El archivo no es una imagen.');
  const img = await new Promise((res, rej) => {
    const u = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(u); res(i); };
    i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('No se pudo leer la imagen.')); };
    i.src = u;
  });
  let max = 1200, q = 0.82, url = '';
  for (let t = 0; t < 10; t++) {
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    url = c.toDataURL('image/jpeg', q);
    if (url.length <= MAX_IMG) break;
    max = Math.round(max * 0.8); q = Math.max(0.5, q - 0.08);
  }
  if (url.length > MAX_IMG) throw new Error('La imagen es demasiado grande incluso comprimida.');
  return { url, path: null };
}

// ===========================================================================
// CARGA DEL CATASTRO BASE (datos/) A FIRESTORE — desde el panel, sin claves
// ===========================================================================
// Reanudable: si se corta (red, cuota diaria), al volver a pulsarla continúa
// desde el siguiente id. ~17.300 escrituras en total (cuota gratuita: 20.000/día).
export async function estadoCargaBase() {
  const f = await fb();
  const { doc, getDoc } = f.firestore;
  const s = await getDoc(doc(f.db, 'meta', CARGA_BASE));
  return s.exists() ? s.data() : { completado: false };
}

export async function cargarCatastroBase({ onProgress } = {}) {
  const f = await fb();
  const user = await currentUser();
  const { writeBatch, doc, setDoc, serverTimestamp } = f.firestore;
  if ((await estadoCargaBase()).completado) throw new Error('El catastro base ya se cargó en Firestore.');

  const [geo, species, imgs] = await Promise.all([
    fetch('datos/trees.geojson').then(r => r.json()),
    fetch('datos/species.json').then(r => r.json()),
    fetch('datos/species-images.json').then(r => r.json()).catch(() => ({})),
  ]);

  // 1) Especies (pocas: se reescriben siempre, es idempotente).
  let batch = writeBatch(f.db), n = 0;
  for (const s of species) {
    const slug = s.slug || slugify(s.comun || s.cientifico);
    batch.set(doc(f.db, 'especies', slug), { ...s, slug, imagenWikimedia: imgs[slug] || null, ...stamp(f, user, { create: true }) });
    if (++n % BATCH_SIZE === 0) { await batch.commit(); batch = writeBatch(f.db); }
  }
  await batch.commit();
  onProgress && onProgress({ fase: 'especies', n: species.length });

  // 2) Árboles, reanudando desde el siguiente id libre.
  const desde = await nextArbolId();
  const feats = geo.features.filter(ft => Number(ft.properties.id) >= desde);
  const total = geo.features.length;
  let hechos = total - feats.length;
  for (let i = 0; i < feats.length; i += BATCH_SIZE) {
    const b = writeBatch(f.db);
    for (const ft of feats.slice(i, i + BATCH_SIZE)) {
      const p = ft.properties;
      const [lon, lat] = ft.geometry.coordinates;
      b.set(doc(f.db, 'arboles', String(p.id)), {
        id: p.id, codigo: p.codigo, especieKey: p.e, especieSlug: p.sp,
        nombreCientifico: p.sci || null, familia: p.fam || null,
        lat, lon, direccion: p.dir || null, sector: p.sec || null,
        dap: p.dap ?? null, alturaTotal: p.hT ?? null, alturaCopa: p.hC ?? null,
        fuente: p.fte || 'Catastro base', coordValida: p.ok !== false,
        duplicado: !!p.dup, identificada: !!p.idf,
        ...stamp(f, user, { create: true }),
      });
    }
    await b.commit();
    hechos += Math.min(BATCH_SIZE, feats.length - i);
    onProgress && onProgress({ fase: 'arboles', n: hechos, total });
    await yield_();
  }

  await setDoc(doc(f.db, 'meta', CARGA_BASE), {
    completado: true, arboles: total, especies: species.length,
    modificadoPor: user ? (user.email || user.uid) : 'admin', modificadoEn: serverTimestamp(),
  });
  await audit('arbol', '(catastro-base)', 'carga-base', user, { arboles: total, especies: species.length });
  return { arboles: total, especies: species.length };
}

// ===========================================================================
// SNAPSHOT EN FIRESTORE — JSON troceado en documentos < 1 MB
// ===========================================================================
// Escribe un JSON troceado en `col/{name}__{i}`; devuelve { partes, version }.
// Borra las partes sobrantes de una versión anterior más larga.
async function putChunks(f, col, name, obj, partesPrevias = 0, onProgress) {
  const { doc, setDoc, deleteDoc } = f.firestore;
  const s = JSON.stringify(obj);
  const partes = Math.max(1, Math.ceil(s.length / SNAP_CHUNK));
  const version = Date.now();
  for (let i = 0; i < partes; i++) {
    await setDoc(doc(f.db, col, `${name}__${i}`), { version, i, data: s.slice(i * SNAP_CHUNK, (i + 1) * SNAP_CHUNK) });
    onProgress && onProgress({ parte: i + 1, partes });
  }
  for (let i = partes; i < partesPrevias; i++) {
    try { await deleteDoc(doc(f.db, col, `${name}__${i}`)); } catch { /* sobrante: se ignora */ }
  }
  return { partes, version, caracteres: s.length };
}

// Lee un JSON troceado conociendo su número de partes y versión.
async function getChunks(f, col, name, partes, version) {
  const { doc, getDoc } = f.firestore;
  const docs = await Promise.all(Array.from({ length: partes }, (_, i) => getDoc(doc(f.db, col, `${name}__${i}`))));
  const s = docs.map(d => {
    const x = d.data();
    if (!x || x.version !== version) throw new Error('Datos incompletos (publicación en curso). Recarga en unos segundos.');
    return x.data;
  }).join('');
  return JSON.parse(s);
}

async function putJSON(f, name, obj) {
  const { doc, getDoc, setDoc } = f.firestore;
  const prev = await getDoc(doc(f.db, SNAP_COL, name));
  const r = await putChunks(f, SNAP_COL, name, obj, prev.exists() ? prev.data().partes : 0);
  await setDoc(doc(f.db, SNAP_COL, name), r);
}

async function getJSON(f, name) {
  const { doc, getDoc } = f.firestore;
  const idx = await getDoc(doc(f.db, SNAP_COL, name));
  if (!idx.exists()) return null;
  const { partes, version } = idx.data();
  return getChunks(f, SNAP_COL, name, partes, version);
}

// ===========================================================================
// CAPAS GIS — capas/{id} (metadatos) + capas_datos/{id}__{i} (GeoJSON troceado)
// ===========================================================================
// Lectura pública (el mapa las muestra a todos); escritura solo admin/superadmin.
const CAPAS_DATOS = 'capas_datos';

export async function listCapas() {
  const f = await fb();
  const { collection, query, where, getDocs } = f.firestore;
  const snap = await getDocs(query(collection(f.db, 'capas'), where('eliminado', '==', false)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.nombre).localeCompare(b.nombre));
}

export async function getCapaGeoJSON(capa) {
  const f = await fb();
  return getChunks(f, CAPAS_DATOS, capa.id, capa.partes, capa.version);
}

// Tipo de geometría predominante de un conjunto de features.
function tipoGeometria(features) {
  const tipos = new Set(features.map(ft => (ft.geometry?.type || '').replace(/^Multi/, '')));
  return tipos.size === 1 ? [...tipos][0] : 'Mixta';
}

// Guarda una capa. modo: 'nueva' | 'reemplazar' | 'agregar'.
export async function guardarCapa({ modo, capaId, nombre, color, features, archivo }, { onProgress } = {}) {
  const f = await fb();
  const user = await currentUser();
  const { doc, getDoc, setDoc, serverTimestamp } = f.firestore;
  const quien = user ? (user.email || user.uid) : 'admin';
  let meta = null, id = capaId;

  if (modo === 'nueva') {
    if (!nombre || !nombre.trim()) throw new Error('La capa necesita un nombre.');
    id = `${slugify(nombre) || 'capa'}-${Date.now().toString(36)}`;
  } else {
    const s = await getDoc(doc(f.db, 'capas', id));
    if (!s.exists() || s.data().eliminado) throw new Error('La capa seleccionada no existe.');
    meta = s.data();
  }

  let todas = features;
  if (modo === 'agregar') {
    onProgress && onProgress({ fase: 'leyendo' });
    const prev = await getChunks(f, CAPAS_DATOS, id, meta.partes, meta.version);
    todas = [...(prev.features || []), ...features];
  }
  const campos = [...new Set(todas.slice(0, 500).flatMap(ft => Object.keys(ft.properties || {})))];
  const r = await putChunks(f, CAPAS_DATOS, id, { type: 'FeatureCollection', features: todas }, meta?.partes || 0,
    p => onProgress && onProgress({ fase: 'guardando', ...p }));

  const datos = {
    ...r, elementos: todas.length, geometria: tipoGeometria(todas), campos: campos.slice(0, 80),
    archivo: archivo || meta?.archivo || null,
    modificadoPor: quien, modificadoEn: serverTimestamp(),
  };
  if (modo === 'nueva') {
    Object.assign(datos, {
      nombre: nombre.trim(), color: color || '#2e7ab8', visible: true, orden: Date.now(),
      creadoPor: quien, creadoEn: serverTimestamp(), eliminado: false,
    });
  }
  await setDoc(doc(f.db, 'capas', id), datos, { merge: true });
  await audit('capa', id, modo === 'nueva' ? 'alta' : modo, user, { elementos: features.length, total: todas.length, archivo: archivo || null });
  return { id, elementos: todas.length, agregados: features.length };
}

export async function editarCapa(id, { nombre, color, visible }) {
  const f = await fb();
  const user = await currentUser();
  const { doc, updateDoc, serverTimestamp } = f.firestore;
  const datos = { modificadoPor: user ? (user.email || user.uid) : 'admin', modificadoEn: serverTimestamp() };
  if (nombre != null) datos.nombre = String(nombre).trim();
  if (color != null) datos.color = color;
  if (visible != null) datos.visible = !!visible;
  await updateDoc(doc(f.db, 'capas', id), datos);
  await audit('capa', id, 'edicion', user, { nombre, color, visible });
}

export async function eliminarCapa(id) {
  const f = await fb();
  const user = await currentUser();
  const { doc, updateDoc, serverTimestamp } = f.firestore;
  await updateDoc(doc(f.db, 'capas', id), { eliminado: true, modificadoPor: user ? (user.email || user.uid) : 'admin', modificadoEn: serverTimestamp() });
  await audit('capa', id, 'baja', user);
}

// ===========================================================================
// USUARIOS (CRUD del superadministrador sobre usuarios/{uid})
// ===========================================================================
export async function crearPerfilUsuario(uid, { email, nombre, rol }) {
  const f = await fb();
  const user = await currentUser();
  const { doc, setDoc, serverTimestamp } = f.firestore;
  await setDoc(doc(f.db, 'usuarios', uid), {
    email, nombre: nombre || email, rol, estado: 'activo', debeCambiarPassword: true,
    creadoPor: user ? (user.email || user.uid) : 'superadmin', creadoEn: serverTimestamp(),
  });
  await audit('usuario', uid, 'alta', user, { email, rol });
}

export async function actualizarPerfilUsuario(uid, cambios, accion = 'edicion') {
  const f = await fb();
  const user = await currentUser();
  const { doc, updateDoc, serverTimestamp } = f.firestore;
  await updateDoc(doc(f.db, 'usuarios', uid), { ...cambios, modificadoPor: user ? (user.email || user.uid) : 'superadmin', modificadoEn: serverTimestamp() });
  await audit('usuario', uid, accion, user, cambios);
}

// ¿Hay un snapshot publicado? (meta/publicacion es de lectura pública)
export async function haySnapshot() {
  const f = await fb();
  const { doc, getDoc } = f.firestore;
  const s = await getDoc(doc(f.db, 'meta', SNAPSHOT_MARK));
  return s.exists() && !!s.data().publicado;
}

// Lee el snapshot publicado: { trees, species, stats, meta } o null.
export async function readSnapshot() {
  const f = await fb();
  const [trees, species, stats, meta] = await Promise.all(SNAPSHOT_NAMES.map(n => getJSON(f, n)));
  if (!trees || !species || !stats) return null;
  return { trees, species, stats, meta };
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

// ---- Usuarios y roles ----
export async function listUsuarios() {
  const f = await fb();
  const { collection, getDocs } = f.firestore;
  const snap = await getDocs(collection(f.db, 'usuarios'));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
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

  // Nunca publicar un snapshot vacío: dejaría la vista pública sin árboles.
  if (!features.length) throw new Error('Firestore no tiene árboles. Primero usa "Cargar catastro base" o importa datos.');

  // 2) Leer especies vivas (sin campos de Firestore como Timestamps).
  const spSnap = await getDocs(query(collection(f.db, 'especies'), where('eliminado', '==', false)));
  const LIMPIAR = ['creadoEn', 'modificadoEn', 'creadoPor', 'modificadoPor', 'version', 'eliminado'];
  const species = spSnap.docs.map(d => { const o = { ...d.data() }; LIMPIAR.forEach(k => delete o[k]); return o; });
  // Individuos por especie recalculados desde los árboles publicados, y orden
  // de mayor a menor (igual que datos/species.json).
  const porEspecie = new Map();
  features.forEach(ft => porEspecie.set(ft.properties.sp, (porEspecie.get(ft.properties.sp) || 0) + 1));
  species.forEach(s => { s.individuos = porEspecie.get(s.slug) || 0; });
  species.sort((a, b) => (b.individuos || 0) - (a.individuos || 0) || String(a.comun).localeCompare(String(b.comun), 'es'));

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

  // 4) Guardar el snapshot troceado en Firestore.
  onProgress && onProgress({ fase: 'subiendo' });
  await putJSON(f, 'trees', { type: 'FeatureCollection', features });
  await putJSON(f, 'species', species);
  await putJSON(f, 'stats', stats);
  await putJSON(f, 'meta', meta);
  // Marca pública (lectura libre en las reglas): la vista pública solo pide el
  // snapshot a Storage si existe esta marca; si no, usa los datos estáticos.
  await f.firestore.setDoc(f.firestore.doc(f.db, 'meta', SNAPSHOT_MARK), {
    publicado: true, arboles: features.length, especies: species.length,
    modificadoPor: meta.publicado_por, modificadoEn: f.firestore.serverTimestamp(),
  });
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

// URL (blob local) de una parte del snapshot publicado, o null si no existe.
export async function snapshotURL(which) {
  try {
    const f = await fb();
    const obj = await getJSON(f, which);
    return obj ? URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' })) : null;
  } catch { return null; }
}
