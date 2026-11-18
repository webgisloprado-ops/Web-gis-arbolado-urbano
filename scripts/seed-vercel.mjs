// ============================================================================
// seed-vercel.mjs — migración inicial a Vercel Postgres + Blob
// ----------------------------------------------------------------------------
// Crea el esquema, carga datos/*.json en Postgres (con trazabilidad),
// crea el usuario administrador (contraseña cifrada con bcrypt) y sube el
// snapshot inicial a Blob para que la vista pública funcione de inmediato.
//
// Requisitos:
//   1. npm install
//   2. Variables de entorno (Vercel → Storage → tu base → .env.local, o
//      `vercel env pull .env.local`):
//        POSTGRES_URL=...             (Vercel Postgres / Neon)
//        BLOB_READ_WRITE_TOKEN=...    (Vercel Blob)
//
// Uso:
//   node scripts/seed-vercel.mjs --admin-email tucorreo@gmail.com --admin-password "TuClave123"
//   node scripts/seed-vercel.mjs --solo-esquema       (solo crea las tablas)
//   node scripts/seed-vercel.mjs --sin-snapshot       (no sube snapshot a Blob)
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'datos');

// ---- Carga simple de .env.local si existe (sin dependencias) ----
for (const envFile of ['.env.local', '.env']) {
  const p = join(ROOT, envFile);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const args = process.argv.slice(2);
const getArg = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const has = n => args.includes(n);
const adminEmail = getArg('--admin-email');
const adminPassword = getArg('--admin-password') || 'arbolado2026';
const soloEsquema = has('--solo-esquema');
const sinSnapshot = has('--sin-snapshot');

if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
  console.error('\n✗ Falta POSTGRES_URL. Ejecuta `vercel env pull .env.local` o define la variable.\n');
  process.exit(1);
}
if (process.env.DATABASE_URL && !process.env.POSTGRES_URL) process.env.POSTGRES_URL = process.env.DATABASE_URL;

let sql, put, bcrypt;
try {
  ({ sql } = await import('@vercel/postgres'));
  ({ put } = await import('@vercel/blob'));
  bcrypt = (await import('bcryptjs')).default;
} catch {
  console.error('\n✗ Faltan dependencias. Ejecuta:  npm install\n');
  process.exit(1);
}

const log = (...a) => console.log(...a);
const slugify = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function crearEsquema() {
  log('→ Creando esquema…');
  await sql`CREATE TABLE IF NOT EXISTS usuarios (
    uid text PRIMARY KEY, email text UNIQUE, nombre text, rol text DEFAULT 'consulta',
    password_hash text, estado text DEFAULT 'activo', creado_en timestamptz DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS especies (
    slug text PRIMARY KEY, especie_key text, comun text, cientifico text, familia text,
    origen text, follaje text, porte text, altura_max text, hidrico text, floracion text,
    ecologia text, descripcion text, individuos int, dap_promedio numeric, altura_promedio numeric,
    identificada boolean, es_no_especie boolean, imagen_admin jsonb, imagen_wikimedia jsonb,
    sectores jsonb, creado_por text, creado_en timestamptz DEFAULT now(),
    modificado_por text, modificado_en timestamptz DEFAULT now(), version int DEFAULT 1,
    eliminado boolean DEFAULT false)`;
  await sql`CREATE TABLE IF NOT EXISTS arboles (
    id bigint PRIMARY KEY, codigo text, especie_key text, especie_slug text,
    nombre_cientifico text, familia text, lat double precision, lon double precision,
    direccion text, sector text, dap numeric, altura_total numeric, altura_copa numeric,
    fuente text, coord_valida boolean, duplicado boolean, identificada boolean,
    creado_por text, creado_en timestamptz DEFAULT now(),
    modificado_por text, modificado_en timestamptz DEFAULT now(), version int DEFAULT 1,
    eliminado boolean DEFAULT false)`;
  await sql`CREATE INDEX IF NOT EXISTS arboles_slug_ix ON arboles (especie_slug)`;
  await sql`CREATE INDEX IF NOT EXISTS arboles_sector_ix ON arboles (sector)`;
  await sql`CREATE INDEX IF NOT EXISTS arboles_vivos_ix ON arboles (eliminado, id)`;
  await sql`CREATE TABLE IF NOT EXISTS reportes (
    id bigserial PRIMARY KEY, arbol_id bigint, arbol_codigo text, tipo text, comentario text,
    lat double precision, lon double precision, foto_url text, estado text DEFAULT 'pendiente',
    creado_en timestamptz DEFAULT now(), revisado_por text, revisado_en timestamptz)`;
  await sql`CREATE TABLE IF NOT EXISTS auditoria (
    id bigserial PRIMARY KEY, entidad text, entidad_id text, accion text, usuario text,
    diff jsonb, fecha timestamptz DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS meta (clave text PRIMARY KEY, valor jsonb)`;
  log('✓ Esquema listo.');
}

async function seedEspecies() {
  const species = JSON.parse(readFileSync(join(DATA, 'species.json'), 'utf8'));
  const imgs = existsSync(join(DATA, 'species-images.json')) ? JSON.parse(readFileSync(join(DATA, 'species-images.json'), 'utf8')) : {};
  log(`→ Especies: ${species.length}`);
  for (const s of species) {
    const slug = s.slug || slugify(s.comun || s.cientifico);
    await sql`INSERT INTO especies (slug, especie_key, comun, cientifico, familia, origen, follaje,
        porte, altura_max, hidrico, floracion, ecologia, descripcion, individuos, dap_promedio,
        altura_promedio, identificada, es_no_especie, imagen_wikimedia, sectores, creado_por, modificado_por)
      VALUES (${slug}, ${s.key || null}, ${s.comun || null}, ${s.cientifico || null}, ${s.familia || null},
        ${s.origen || null}, ${s.follaje || null}, ${s.porte || null}, ${s.altura_max || null},
        ${s.hidrico || null}, ${s.floracion || null}, ${s.ecologia || null}, ${s.descripcion || null},
        ${s.individuos ?? null}, ${s.dap_promedio ?? null}, ${s.altura_promedio ?? null},
        ${s.identificada ?? null}, ${s.es_no_especie ?? false},
        ${imgs[slug] ? JSON.stringify(imgs[slug]) : null}::jsonb,
        ${s.sectores ? JSON.stringify(s.sectores) : null}::jsonb, 'seed', 'seed')
      ON CONFLICT (slug) DO NOTHING`;
  }
  log(`✓ Especies migradas.`);
}

async function seedArboles() {
  const geo = JSON.parse(readFileSync(join(DATA, 'trees.geojson'), 'utf8'));
  const feats = geo.features;
  log(`→ Árboles: ${feats.length.toLocaleString()} (en lotes)…`);
  const COLS = ['id', 'codigo', 'especie_key', 'especie_slug', 'nombre_cientifico', 'familia',
    'lat', 'lon', 'direccion', 'sector', 'dap', 'altura_total', 'altura_copa', 'fuente',
    'coord_valida', 'duplicado', 'identificada', 'creado_por', 'modificado_por'];
  const CHUNK = 500;
  let done = 0;
  for (let i = 0; i < feats.length; i += CHUNK) {
    const slice = feats.slice(i, i + CHUNK);
    const params = [];
    const tuples = slice.map(ft => {
      const p = ft.properties; const [lon, lat] = ft.geometry.coordinates;
      const row = [p.id, p.codigo, p.e, p.sp, p.sci || null, p.fam || null, lat, lon,
        p.dir || null, p.sec || null, p.dap ?? null, p.hT ?? null, p.hC ?? null,
        p.fte || 'Catastro base', p.ok !== false, !!p.dup, !!p.idf, 'seed', 'seed'];
      const start = params.length; params.push(...row);
      return '(' + row.map((_, j) => `$${start + j + 1}`).join(',') + ',1,false,now(),now())';
    });
    const text = `INSERT INTO arboles (${COLS.join(',')},version,eliminado,creado_en,modificado_en)
                  VALUES ${tuples.join(',')} ON CONFLICT (id) DO NOTHING`;
    await sql.query(text, params);
    done += slice.length;
    if (done % 2500 === 0 || done === feats.length) log(`   ${done.toLocaleString()}…`);
  }
  log(`✓ Árboles migrados: ${done.toLocaleString()}`);
}

async function seedAdmin() {
  if (!adminEmail) { log('ℹ Sin --admin-email: no se creó administrador.'); return; }
  const hash = bcrypt.hashSync(adminPassword, 10);
  const uid = 'admin-' + slugify(adminEmail);
  await sql`INSERT INTO usuarios (uid, email, nombre, rol, password_hash, estado)
    VALUES (${uid}, ${adminEmail}, ${adminEmail}, 'admin', ${hash}, 'activo')
    ON CONFLICT (email) DO UPDATE SET rol = 'admin', password_hash = ${hash}, estado = 'activo'`;
  log(`✓ Administrador: ${adminEmail}  (contraseña: ${adminPassword})`);
}

async function subirSnapshot() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) { log('⚠ Sin BLOB_READ_WRITE_TOKEN: se omite el snapshot.'); return; }
  const files = [['trees.geojson', 'application/geo+json'], ['species.json', 'application/json'],
    ['stats.json', 'application/json'], ['meta.json', 'application/json']];
  const urls = {};
  for (const [name, type] of files) {
    const lp = join(DATA, name);
    if (!existsSync(lp)) continue;
    const blob = await put(`publico/${name}`, readFileSync(lp), {
      access: 'public', contentType: `${type}; charset=utf-8`, addRandomSuffix: false, allowOverwrite: true,
    });
    urls[name.split('.')[0]] = blob.url;
    log(`✓ Snapshot: ${blob.url}`);
  }
  await sql`INSERT INTO meta (clave, valor) VALUES ('snapshot', ${JSON.stringify({ urls, publicado_en: new Date().toISOString(), publicado_por: 'seed' })}::jsonb)
    ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`;
}

(async () => {
  log('\n=== Migración a Vercel Postgres + Blob — Arbolado Urbano ===\n');
  await crearEsquema();
  if (soloEsquema) { log('\nListo (solo esquema).\n'); process.exit(0); }
  await seedEspecies();
  await seedArboles();
  await seedAdmin();
  if (!sinSnapshot) await subirSnapshot();
  log('\n✓ Migración completada.\n');
  process.exit(0);
})().catch(e => { console.error('\n✗ Error:', e); process.exit(1); });
