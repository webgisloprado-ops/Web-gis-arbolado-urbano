// /api/reports
//   POST → crear reporte ciudadano (PÚBLICO, sin sesión)
//   GET  → listar reportes (write)
import { ok, bad, body, method } from '../_lib/http.js';
import { sql } from '../_lib/db.js';
import { requireRole } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const d = await body(req);
    if (!d.tipo || String(d.tipo).length > 80) return bad(res, 'Tipo de reporte inválido.');
    if ((d.comentario || '').length > 2000) return bad(res, 'Comentario demasiado largo.');
    try {
      const { rows } = await sql`
        INSERT INTO reportes (arbol_id, arbol_codigo, tipo, comentario, lat, lon, foto_url, estado)
        VALUES (${d.arbolId ?? null}, ${d.arbolCodigo ?? null}, ${d.tipo}, ${d.comentario || ''},
          ${d.lat ?? null}, ${d.lon ?? null}, ${d.fotoUrl ?? null}, 'pendiente')
        RETURNING id`;
      return ok(res, { id: rows[0].id });
    } catch (e) { return bad(res, e.message, 500); }
  }
  if (req.method === 'GET') {
    const user = requireRole(req, res, ['admin', 'gis', 'editor']);
    if (!user) return;
    const estado = (req.query || {}).estado || null;
    const { rows } = await sql`
      SELECT * FROM reportes
      WHERE (${estado}::text IS NULL OR estado = ${estado})
      ORDER BY creado_en DESC`;
    return ok(res, rows.map(r => ({
      _id: r.id, arbolId: r.arbol_id, arbolCodigo: r.arbol_codigo, tipo: r.tipo,
      comentario: r.comentario, estado: r.estado, creadoEn: r.creado_en, fotoUrl: r.foto_url,
    })));
  }
  return method(req, res, ['GET', 'POST']);
}
