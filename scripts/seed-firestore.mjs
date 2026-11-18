// ============================================================================
// seed-firestore.mjs — migración inicial de los datos estáticos a Firestore
// ----------------------------------------------------------------------------
// Carga datos/*.json en Firestore (colecciones arboles y especies) con
// trazabilidad, asigna el rol de administrador a un usuario y sube el snapshot
// inicial a Storage para que la vista pública funcione de inmediato.
//
// Requisitos:
//   1. npm install firebase-admin
//   2. Una clave de cuenta de servicio (Firebase → Configuración del proyecto →
//      Cuentas de servicio → Generar nueva clave privada) guardada como
//      ./serviceAccount.json  (o exporta GOOGLE_APPLICATION_CREDENTIALS).
//
// Uso:
//   node scripts/seed-firestore.mjs --admin-email tucorreo@gmail.com
//   node scripts/seed-firestore.mjs --admin-uid <UID>        (alternativa)
//   node scripts/seed-firestore.mjs --solo-snapshot          (solo re-sube snapshot)
//   node scripts/seed-firestore.mjs --sin-snapshot           (no sube snapshot)
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'datos');

// ---- Argumentos ----
const args = process.argv.slice(2);
const getArg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const has = name => args.includes(name);
const adminEmail = getArg('--admin-email');
const adminUid = getArg('--admin-uid');
const soloSnapshot = has('--solo-snapshot');
const sinSnapshot = has('--sin-snapshot');

// ---- Firebase Admin ----
let admin;
try {
  admin = await import('firebase-admin/app');
} catch {
  console.error('\n✗ Falta firebase-admin. Instálalo con:\n\n    npm install firebase-admin\n');
  process.exit(1);
}
const { initializeApp, cert, applicationDefault } = admin;
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const { getStorage } = await import('firebase-admin/storage');

// Credenciales.
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(ROOT, 'serviceAccount.json');
let credential, projectId;
if (existsSync(saPath)) {
  const sa = JSON.parse(readFileSync(saPath, 'utf8'));
  credential = cert(sa); projectId = sa.project_id;
} else {
  try { credential = applicationDefault(); } catch {
    console.error(`\n✗ No se encontró la clave de servicio en ${saPath} ni credenciales por defecto.\n  Descárgala de Firebase → Configuración → Cuentas de servicio.\n`);
    process.exit(1);
  }
}
// Proyecto y bucket: se leen de assets/js/firebase-config.js si no vienen de la
// clave de servicio o de variables de entorno (los proyectos nuevos usan el
// dominio <proyecto>.firebasestorage.app, no <proyecto>.appspot.com).
let webCfg = null;
try { webCfg = (await import(new URL('../assets/js/firebase-config.js', import.meta.url).href)).firebaseConfig; } catch { /* sin config web */ }
projectId = projectId || process.env.GOOGLE_CLOUD_PROJECT || webCfg?.projectId;
const bucketName = process.env.STORAGE_BUCKET || webCfg?.storageBucket || (projectId ? `${projectId}.firebasestorage.app` : undefined);
initializeApp({ credential, projectId, storageBucket: bucketName });
const db = getFirestore();
const now = FieldValue.serverTimestamp();

const log = (...a) => console.log(...a);
const slugify = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------------------
async function seedArboles() {
  const geo = JSON.parse(readFileSync(join(DATA, 'trees.geojson'), 'utf8'));
  const feats = geo.features;
  log(`→ Árboles: ${feats.length.toLocaleString()} registros`);
  const writer = db.bulkWriter();
  writer.onWriteError(err => err.failedAttempts < 5);   // reintenta hasta 5 veces
  let n = 0;
  for (const ft of feats) {
    const p = ft.properties;
    const [lon, lat] = ft.geometry.coordinates;
    const ref = db.collection('arboles').doc(String(p.id));
    writer.set(ref, {
      id: p.id, codigo: p.codigo, especieKey: p.e, especieSlug: p.sp,
      nombreCientifico: p.sci || null, familia: p.fam || null,
      lat, lon, direccion: p.dir || null, sector: p.sec || null,
      dap: p.dap ?? null, alturaTotal: p.hT ?? null, alturaCopa: p.hC ?? null,
      fuente: p.fte || 'Catastro base', coordValida: p.ok !== false,
      duplicado: !!p.dup, identificada: !!p.idf,
      creadoPor: 'seed', creadoEn: now, modificadoPor: 'seed', modificadoEn: now,
      version: 1, eliminado: false,
    });
    if (++n % 2000 === 0) { await writer.flush(); log(`   ${n.toLocaleString()}…`); }
  }
  await writer.close();
  log(`✓ Árboles migrados: ${n.toLocaleString()}`);
}

async function seedEspecies() {
  const species = JSON.parse(readFileSync(join(DATA, 'species.json'), 'utf8'));
  const imgs = existsSync(join(DATA, 'species-images.json')) ? JSON.parse(readFileSync(join(DATA, 'species-images.json'), 'utf8')) : {};
  log(`→ Especies: ${species.length} registros`);
  const writer = db.bulkWriter();
  let n = 0;
  for (const s of species) {
    const slug = s.slug || slugify(s.comun || s.cientifico);
    const foto = imgs[slug];
    writer.set(db.collection('especies').doc(slug), {
      ...s, slug,
      imagenWikimedia: foto || null,   // fotografía real por nombre científico (prioridad 2)
      creadoPor: 'seed', creadoEn: now, modificadoPor: 'seed', modificadoEn: now,
      version: 1, eliminado: false,
    }, { merge: true });
    n++;
  }
  await writer.close();
  log(`✓ Especies migradas: ${n}`);
}

async function seedAdmin() {
  let uid = adminUid;
  if (!uid && adminEmail) {
    const { getAuth } = await import('firebase-admin/auth');
    try { uid = (await getAuth().getUserByEmail(adminEmail)).uid; }
    catch { console.error(`\n✗ No existe un usuario de Authentication con el correo ${adminEmail}.\n  Créalo primero en Firebase → Authentication → Agregar usuario.\n`); return; }
  }
  if (!uid) { log('ℹ Sin --admin-email/--admin-uid: no se asignó rol de administrador.'); return; }
  await db.collection('usuarios').doc(uid).set({
    rol: 'admin', nombre: adminEmail || uid, email: adminEmail || null,
    estado: 'activo', creadoEn: now,
  }, { merge: true });
  log(`✓ Rol de administrador asignado a ${adminEmail || uid}`);
}

async function subirSnapshot() {
  if (!bucketName) { log('⚠ Sin bucket de Storage (define STORAGE_BUCKET); se omite el snapshot.'); return; }
  const bucket = getStorage().bucket();
  const files = [
    ['trees.geojson', 'publico/trees.geojson', 'application/geo+json'],
    ['species.json', 'publico/species.json', 'application/json'],
    ['stats.json', 'publico/stats.json', 'application/json'],
    ['meta.json', 'publico/meta.json', 'application/json'],
  ];
  for (const [local, dest, type] of files) {
    const lp = join(DATA, local);
    if (!existsSync(lp)) continue;
    await bucket.upload(lp, { destination: dest, metadata: { contentType: `${type}; charset=utf-8`, cacheControl: 'public,max-age=300' } });
    log(`✓ Snapshot subido: ${dest}`);
  }
  // Marca de publicación: la vista pública solo usa Storage si existe.
  await db.collection('meta').doc('publicacion').set({ publicado: true, modificadoPor: 'seed', modificadoEn: now });
  log('✓ Marca meta/publicacion creada');
}

// ---------------------------------------------------------------------------
(async () => {
  log('\n=== Migración a Firestore — Arbolado Urbano ===\n');
  if (soloSnapshot) { await subirSnapshot(); log('\nListo (solo snapshot).\n'); return; }
  await seedEspecies();
  await seedArboles();
  await seedAdmin();
  if (!sinSnapshot) await subirSnapshot();
  log('\n✓ Migración completada.\n');
  log('  Siguiente paso: despliega las reglas con  firebase deploy --only firestore:rules,storage\n');
  process.exit(0);
})().catch(e => { console.error('\n✗ Error en la migración:', e); process.exit(1); });
