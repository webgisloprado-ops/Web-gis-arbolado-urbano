// /api/species
//   GET  → catálogo completo (auth: cualquiera con sesión)
//   POST → alta de especie (write)
import { ok, bad, body, method } from '../_lib/http.js';
import { sql, audit, rowToEspecie } from '../_lib/db.js';
import { requireRole } from '../_lib/auth.js';

const slugify = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const user = requireRole(req, res, ['admin', 'gis', 'editor', 'consulta']);
    if (!user) return;
    const { rows } = await sql`SELECT * FROM especies WHERE eliminado = false ORDER BY individuos DESC NULLS LAST`;
    return ok(res, rows.map(rowToEspecie));
  }
  if (req.method === 'POST') {
    const user = requireRole(req, res, ['admin', 'gis', 'editor']);
    if (!user) return;
    const d = await body(req);
    const slug = d.slug || slugify(d.comun || d.cientifico);
    if (!slug) return bad(res, 'Indica al menos nombre común o científico.');
    try {
      await sql`
        INSERT INTO especies (slug, especie_key, comun, cientifico, familia, origen, follaje, porte,
          descripcion, identificada, es_no_especie, creado_por, modificado_por, version, eliminado)
        VALUES (${slug}, ${(d.comun || '').toUpperCase()}, ${d.comun || null}, ${d.cientifico || null},
          ${d.familia || null}, ${d.origen || null}, ${d.follaje || null}, ${d.porte || null},
          ${d.descripcion || null}, ${!!(d.cientifico || d.comun)}, false, ${user.email}, ${user.email}, 1, false)
        ON CONFLICT (slug) DO UPDATE SET
          comun = EXCLUDED.comun, cientifico = EXCLUDED.cientifico, familia = EXCLUDED.familia,
          origen = EXCLUDED.origen, follaje = EXCLUDED.follaje, porte = EXCLUDED.porte,
          descripcion = EXCLUDED.descripcion, modificado_por = ${user.email}, modificado_en = now(),
          version = especies.version + 1`;
      await audit('especie', slug, 'alta', user.email, d);
      return ok(res, { slug });
    } catch (e) { return bad(res, e.message, 500); }
  }
  return method(req, res, ['GET', 'POST']);
}
