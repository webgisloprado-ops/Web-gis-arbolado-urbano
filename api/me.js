// GET /api/me — usuario de la sesión actual (o null).
import { ok } from './_lib/http.js';
import { getUser } from './_lib/auth.js';

export default function handler(req, res) {
  ok(res, { user: getUser(req) || null });
}
