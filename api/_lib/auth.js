// ============================================================================
// api/_lib/auth.js — autenticación por JWT en cookie httpOnly + roles
// ----------------------------------------------------------------------------
// Login: /api/login valida email+contraseña (bcrypt) contra la tabla usuarios
// y emite un JWT firmado con AUTH_SECRET, guardado en una cookie httpOnly.
// Roles: admin | gis | editor | consulta.
// ============================================================================
import jwt from 'jsonwebtoken';
import { send } from './http.js';

const COOKIE = 'arbolado_sesion';
const SECRET = () => process.env.AUTH_SECRET || 'DEV_INSEGURO_cambia_AUTH_SECRET';
const puedeEscribir = rol => ['admin', 'gis', 'editor'].includes(rol);

export function signToken(payload) {
  return jwt.sign(payload, SECRET(), { expiresIn: '12h' });
}

export function setAuthCookie(res, token) {
  const attrs = ['HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=43200', 'Secure'];
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${attrs.join('; ')}`);
}
export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

// Usuario autenticado a partir de la cookie, o null.
export function getUser(req) {
  const raw = req.headers.cookie || '';
  const m = raw.split(/; */).find(c => c.startsWith(COOKIE + '='));
  if (!m) return null;
  try { return jwt.verify(decodeURIComponent(m.slice(COOKIE.length + 1)), SECRET()); }
  catch { return null; }
}

// Exige sesión con uno de los roles; si falla responde y devuelve null.
export function requireRole(req, res, roles = ['admin', 'gis', 'editor']) {
  const user = getUser(req);
  if (!user) { send(res, 401, { error: 'No autenticado.' }); return null; }
  if (roles && !roles.includes(user.rol)) { send(res, 403, { error: 'Sin permisos suficientes.' }); return null; }
  return user;
}

export { puedeEscribir };
