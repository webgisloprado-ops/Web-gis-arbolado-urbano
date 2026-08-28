// /api/trees/:id
//   GET    → un árbol (auth)
//   PUT    → edición (write)
//   DELETE → borrado LÓGICO / restauración con ?restore=1 (write)
import { ok, bad, body, method } from '../_lib/http.js';
import { sql, audit } from '../_lib/db.js';
import { requireRole } from '../_lib/auth.js';

export default async function handler(req, res) {
  const id = parseInt((req.query || {}).id);
  if (!id) return bad(res, 'Id inválido.');

  if (req.method === 'GET') {
    const user = requireRole(req, res, ['admin', 'gis', 'editor', 'consulta']);
    if (!user) return;
    const { rows } = await sql`SELECT * FROM arboles WHERE id = ${id} LIMIT 1`;
    return rows[0] ? ok(res, rows[0]) : bad(res, 'No encontrado.', 404);
  }

  if (req.method === 'PUT') {
    const user = requireRole(req, res, ['admin', 'gis', 'editor']);
    if (!user) return;
    const d = await body(req);
    try {
      await sql`
        UPDATE arboles SET
          codigo = ${d.codigo}, especie_key = ${(d.especieKey || 'SIN ESPECIE').toUpperCase()},
          especie_slug = ${d.especieSlug}, nombre_cientifico = ${d.nombreCientifico || null},
          familia = ${d.familia || null}, lat = ${d.lat}, lon = ${d.lon},
          direccion = ${d.direccion || null}, sector = ${d.sector || null},
          dap = ${d.dap ?? null}, altura_total = ${d.alturaTotal ?? null}, altura_copa = ${d.alturaCopa ?? null},
          coord_valida = ${d.coordValida !== false}, identificada = ${!!d.identificada},
          modificado_por = ${user.email}, modificado_en = now(), version = version + 1
        WHERE id = ${id}`;
      await audit('arbol', id, 'edicion', user.email, d);
      return ok(res, { id });
    } catch (e) { return bad(res, e.message, 500); }
  }

  if (req.method === 'DELETE') {
    const user = requireRole(req, res, ['admin', 'gis', 'editor']);
    if (!user) return;
    const restore = (req.query || {}).restore;
    try {
      await sql`UPDATE arboles SET eliminado = ${!restore}, modificado_por = ${user.email},
                modificado_en = now(), version = version + 1 WHERE id = ${id}`;
      await audit('arbol', id, restore ? 'restauracion' : 'borrado-logico', user.email);
      return ok(res, { id, eliminado: !restore });
    } catch (e) { return bad(res, e.message, 500); }
  }

  return method(req, res, ['GET', 'PUT', 'DELETE']);
}
