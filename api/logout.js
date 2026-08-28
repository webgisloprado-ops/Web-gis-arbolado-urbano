// POST /api/logout — cierra la sesión.
import { ok, method } from './_lib/http.js';
import { clearAuthCookie } from './_lib/auth.js';

export default function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  clearAuthCookie(res);
  ok(res, { ok: true });
}
