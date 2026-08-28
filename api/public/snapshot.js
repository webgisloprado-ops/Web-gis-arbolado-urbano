// GET /api/public/snapshot — URLs del snapshot publicado (PÚBLICO).
// Devuelve { urls:{trees,species,stats,meta} } o 204 si aún no se publicó.
import { ok, send } from '../_lib/http.js';
import { sql, dbConfigured } from '../_lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  if (!dbConfigured()) return send(res, 204, {});
  try {
    const { rows } = await sql`SELECT valor FROM meta WHERE clave = 'snapshot' LIMIT 1`;
    if (!rows[0] || !rows[0].valor?.urls) return send(res, 204, {});
    ok(res, { urls: rows[0].valor.urls, meta: rows[0].valor });
  } catch { send(res, 204, {}); }
}
