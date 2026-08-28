// POST /api/login  { email, password } → cookie de sesión + { user, rol }
import bcrypt from 'bcryptjs';
import { ok, bad, body, method } from './_lib/http.js';
import { sql } from './_lib/db.js';
import { signToken, setAuthCookie } from './_lib/auth.js';

export default async function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  const { email, password } = await body(req);
  if (!email || !password) return bad(res, 'Correo y contraseña son obligatorios.');
  try {
    const { rows } = await sql`SELECT uid, email, nombre, rol, password_hash, estado
                               FROM usuarios WHERE lower(email) = lower(${email}) LIMIT 1`;
    const u = rows[0];
    if (!u || u.estado !== 'activo' || !u.password_hash) return bad(res, 'Credenciales inválidas.', 401);
    if (!bcrypt.compareSync(password, u.password_hash)) return bad(res, 'Credenciales inválidas.', 401);
    if (!['admin', 'gis', 'editor', 'consulta'].includes(u.rol)) return bad(res, 'Cuenta sin rol asignado.', 403);
    const payload = { uid: u.uid, email: u.email, nombre: u.nombre, rol: u.rol };
    setAuthCookie(res, signToken(payload));
    ok(res, { user: payload, rol: u.rol });
  } catch (e) { bad(res, 'Error de autenticación: ' + e.message, 500); }
}
