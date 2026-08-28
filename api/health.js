// GET /api/health — el cliente lo usa para detectar el backend Vercel.
import { ok } from './_lib/http.js';
import { dbConfigured } from './_lib/db.js';

export default function handler(req, res) {
  ok(res, { ok: true, backend: 'vercel', db: dbConfigured() });
}
