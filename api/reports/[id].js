// PUT /api/reports/:id  { estado } → aprobar/rechazar/resolver (write)
import { ok, bad, body, method } from '../_lib/http.js';
import { sql, audit } from '../_lib/db.js';
import { requireRole } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (!method(req, res, 'PUT')) return;
  const user = requireRole(req, res, ['admin', 'gis', 'editor']);
  if (!user) return;
  const id = parseInt((req.query || {}).id);
  const { estado } = await body(req);
  if (!['aprobado', 'rechazado', 'resuelto', 'pendiente'].includes(estado)) return bad(res, 'Estado inválido.');
  try {
    await sql`UPDATE reportes SET estado = ${estado}, revisado_por = ${user.email}, revisado_en = now() WHERE id = ${id}`;
    await audit('reporte', id, `reporte-${estado}`, user.email);
    ok(res, { id, estado });
  } catch (e) { bad(res, e.message, 500); }
}
