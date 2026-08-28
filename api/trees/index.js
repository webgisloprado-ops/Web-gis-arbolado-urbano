// /api/trees
//   GET  ?cursor=&pageSize=&sector=&especie=   → listado paginado (auth)
//   GET  ?next=1                               → siguiente id libre (auth)
//   POST                                       → alta de un árbol (write)
import { ok, bad, body, method } from '../_lib/http.js';
import { sql, audit } from '../_lib/db.js';
import { requireRole } from '../_lib/auth.js';

const slugify = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export default async function handler(req, res) {
  if (req.method === 'GET') return listar(req, res);
  if (req.method === 'POST') return crear(req, res);
  return method(req, res, ['GET', 'POST']);
}

async function listar(req, res) {
  const user = requireRole(req, res, ['admin', 'gis', 'editor', 'consulta']);
  if (!user) return;
  const q = req.query || {};
  if (q.next) {
    const { rows } = await sql`SELECT COALESCE(MAX(id),0)+1 AS next FROM arboles`;
    return ok(res, { nextId: Number(rows[0].next) });
  }
  const pageSize = Math.min(parseInt(q.pageSize) || 20, 100);
  const cursor = parseInt(q.cursor) || 0;
  const sector = q.sector || null;
  const especie = q.especie || null;
  try {
    const { rows } = await sql`
      SELECT * FROM arboles
      WHERE eliminado = false AND id > ${cursor}
        AND (${sector}::text IS NULL OR sector = ${sector})
        AND (${especie}::text IS NULL OR especie_slug = ${especie})
      ORDER BY id ASC
      LIMIT ${pageSize}`;
    const nextCursor = rows.length ? rows[rows.length - 1].id : null;
    ok(res, { items: rows, nextCursor, done: rows.length < pageSize });
  } catch (e) { bad(res, e.message, 500); }
}

async function crear(req, res) {
  const user = requireRole(req, res, ['admin', 'gis', 'editor']);
  if (!user) return;
  const d = await body(req);
  const comun = (d.especieKey || '').toString();
  const especieSlug = d.especieSlug || slugify(comun || d.nombreCientifico || 'sin-especie');
  try {
    let id = parseInt(d.id);
    if (!id) { const { rows } = await sql`SELECT COALESCE(MAX(id),0)+1 AS n FROM arboles`; id = Number(rows[0].n); }
    const codigo = d.codigo || `ARB-${String(id).padStart(5, '0')}`;
    await sql`
      INSERT INTO arboles (id, codigo, especie_key, especie_slug, nombre_cientifico, familia,
        lat, lon, direccion, sector, dap, altura_total, altura_copa, fuente,
        coord_valida, duplicado, identificada, creado_por, modificado_por, version, eliminado)
      VALUES (${id}, ${codigo}, ${(comun || 'SIN ESPECIE').toUpperCase()}, ${especieSlug},
        ${d.nombreCientifico || null}, ${d.familia || null}, ${d.lat}, ${d.lon},
        ${d.direccion || null}, ${d.sector || null}, ${d.dap ?? null}, ${d.alturaTotal ?? null},
        ${d.alturaCopa ?? null}, ${d.fuente || 'Formulario'}, ${d.coordValida !== false},
        ${!!d.duplicado}, ${!!d.identificada}, ${user.email}, ${user.email}, 1, false)`;
    await audit('arbol', id, 'alta', user.email, d);
    ok(res, { id });
  } catch (e) { bad(res, e.message, 500); }
}
