// GET /api/users — usuarios y roles (solo admin).
import { ok, bad } from './_lib/http.js';
import { sql } from './_lib/db.js';
import { requireRole } from './_lib/auth.js';

export default async function handler(req, res) {
  const user = requireRole(req, res, ['admin']);
  if (!user) return;
  try {
    const { rows } = await sql`SELECT uid, email, nombre, rol, estado FROM usuarios ORDER BY rol`;
    ok(res, rows);
  } catch (e) { bad(res, e.message, 500); }
}
