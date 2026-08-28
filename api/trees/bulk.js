// POST /api/trees/bulk  { arboles:[...] } → inserta un lote (write)
// El cliente envía la lista ya normalizada, troceada en lotes, para no trabar
// el navegador. Cada lote se inserta con UNA sola consulta multi-fila.
import { ok, bad, body, method } from '../_lib/http.js';
import { sql, audit } from '../_lib/db.js';
import { requireRole } from '../_lib/auth.js';

const COLS = ['id', 'codigo', 'especie_key', 'especie_slug', 'nombre_cientifico', 'familia',
  'lat', 'lon', 'direccion', 'sector', 'dap', 'altura_total', 'altura_copa', 'fuente',
  'coord_valida', 'duplicado', 'identificada', 'creado_por', 'modificado_por'];

export default async function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  const user = requireRole(req, res, ['admin', 'gis']);
  if (!user) return;
  const { arboles } = await body(req);
  if (!Array.isArray(arboles) || !arboles.length) return bad(res, 'Lote vacío.');

  try {
    const { rows } = await sql`SELECT COALESCE(MAX(id),0) AS m FROM arboles`;
    let id = Number(rows[0].m);
    const valid = arboles.filter(a => Number.isFinite(+a.lat) && Number.isFinite(+a.lon)
      && +a.lat >= -90 && +a.lat <= 90 && +a.lon >= -180 && +a.lon <= 180);
    const skipped = arboles.length - valid.length;
    if (!valid.length) return ok(res, { written: 0, skipped });

    // Inserción multi-fila parametrizada: $1,$2,… por cada valor.
    const params = [];
    const tuples = valid.map(a => {
      id++;
      const row = [
        id, a.codigo || `ARB-${String(id).padStart(5, '0')}`,
        (a.especieKey || 'SIN ESPECIE').toUpperCase(), a.especieSlug || 'sin-especie',
        a.nombreCientifico || null, a.familia || null, +a.lat, +a.lon,
        a.direccion || null, a.sector || null, a.dap ?? null, a.alturaTotal ?? null,
        a.alturaCopa ?? null, a.fuente || 'Importación', a.coordValida !== false,
        !!a.duplicado, !!a.identificada, user.email, user.email,
      ];
      const start = params.length;
      params.push(...row);
      return '(' + row.map((_, i) => `$${start + i + 1}`).join(',') + ',1,false,now(),now())';
    });
    const text = `INSERT INTO arboles (${COLS.join(',')},version,eliminado,creado_en,modificado_en)
                  VALUES ${tuples.join(',')} ON CONFLICT (id) DO NOTHING`;
    await sql.query(text, params);
    await audit('arbol', '(lote)', 'importacion', user.email, { written: valid.length, skipped });
    ok(res, { written: valid.length, skipped });
  } catch (e) { bad(res, e.message, 500); }
}
