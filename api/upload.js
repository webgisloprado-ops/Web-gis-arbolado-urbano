// POST /api/upload  { filename, contentType, dataBase64 } → sube a Vercel Blob (write)
// Para imágenes de especies/individuos. Límite ~4 MB (tope de cuerpo de función);
// para archivos mayores, usa una URL externa con licencia.
import { put } from '@vercel/blob';
import { ok, bad, body, method } from './_lib/http.js';
import { requireRole } from './_lib/auth.js';

export default async function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  const user = requireRole(req, res, ['admin', 'gis', 'editor']);
  if (!user) return;
  const { filename, contentType, dataBase64 } = await body(req);
  if (!dataBase64) return bad(res, 'Falta el contenido de la imagen.');
  if (!/^image\//.test(contentType || '')) return bad(res, 'El archivo debe ser una imagen.');
  try {
    const buf = Buffer.from(dataBase64, 'base64');
    if (buf.length > 8 * 1024 * 1024) return bad(res, 'La imagen supera 8 MB.');
    const safe = (filename || `img-${Date.now()}.jpg`).replace(/[^\w.\-]/g, '_');
    const blob = await put(`imagenes/especies/${Date.now()}-${safe}`, buf, {
      access: 'public', contentType, addRandomSuffix: false,
    });
    ok(res, { url: blob.url });
  } catch (e) { bad(res, e.message, 500); }
}
