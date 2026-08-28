// GET /api/audit — registro de auditoría (solo admin).
import { ok, bad } from './_lib/http.js';
import { sql } from './_lib/db.js';
import { requireRole } from './_lib/auth.js';

export default async function handler(req, res) {
  const user = requireRole(req, res, ['admin']);
  if (!user) return;
  const max = Math.min(parseInt((req.query || {}).max) || 150, 500);
  try {
    const { rows } = await sql`SELECT entidad, entidad_id, accion, usuario, fecha FROM auditoria ORDER BY fecha DESC LIMIT ${max}`;
    ok(res, rows.map(a => ({ entidad: a.entidad, entidadId: a.entidad_id, accion: a.accion, usuario: a.usuario, fecha: a.fecha })));
  } catch (e) { bad(res, e.message, 500); }
}
