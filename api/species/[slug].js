// /api/species/:slug
//   PUT                 → edición de campos (write)
//   PUT ?action=image   → asignar/quitar imagen del admin (write)
//   DELETE              → borrado LÓGICO (write)
import { ok, bad, body, method } from '../_lib/http.js';
import { sql, audit } from '../_lib/db.js';
import { requireRole } from '../_lib/auth.js';

export default async function handler(req, res) {
  const slug = (req.query || {}).slug;
  if (!slug) return bad(res, 'Slug inválido.');

  if (req.method === 'PUT') {
    const user = requireRole(req, res, ['admin', 'gis', 'editor']);
    if (!user) return;
    const d = await body(req);
    try {
      if ((req.query || {}).action === 'image') {
        const img = d.imagen ? JSON.stringify({ ...d.imagen, fecha: new Date().toISOString(), prioridad: 'admin' }) : null;
        await sql`UPDATE especies SET imagen_admin = ${img}::jsonb, modificado_por = ${user.email},
                  modificado_en = now(), version = version + 1 WHERE slug = ${slug}`;
        await audit('especie', slug, d.imagen ? 'imagen-asignada' : 'imagen-restablecida', user.email, d.imagen || null);
        return ok(res, { slug });
      }
      await sql`
        UPDATE especies SET
          comun = ${d.comun || null}, especie_key = ${(d.comun || '').toUpperCase()},
          cientifico = ${d.cientifico || null}, familia = ${d.familia || null},
          origen = ${d.origen || null}, follaje = ${d.follaje || null}, porte = ${d.porte || null},
          descripcion = ${d.descripcion || null},
          modificado_por = ${user.email}, modificado_en = now(), version = version + 1
        WHERE slug = ${slug}`;
      await audit('especie', slug, 'edicion', user.email, d);
      return ok(res, { slug });
    } catch (e) { return bad(res, e.message, 500); }
  }

  if (req.method === 'DELETE') {
    const user = requireRole(req, res, ['admin', 'gis', 'editor']);
    if (!user) return;
    try {
      await sql`UPDATE especies SET eliminado = true, modificado_por = ${user.email},
                modificado_en = now(), version = version + 1 WHERE slug = ${slug}`;
      await audit('especie', slug, 'borrado-logico', user.email);
      return ok(res, { slug });
    } catch (e) { return bad(res, e.message, 500); }
  }

  return method(req, res, ['PUT', 'DELETE']);
}
