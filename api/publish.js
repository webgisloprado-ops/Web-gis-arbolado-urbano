// POST /api/publish — genera el snapshot público desde Postgres y lo sube a Blob.
// (roles admin/gis). La vista pública lee esos archivos, no la base de datos.
import { put } from '@vercel/blob';
import { ok, bad, method } from './_lib/http.js';
import { sql, audit, rowToFeature, rowToEspecie } from './_lib/db.js';
import { requireRole } from './_lib/auth.js';

export default async function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  const user = requireRole(req, res, ['admin', 'gis']);
  if (!user) return;
  try {
    const { rows: arboles } = await sql`SELECT * FROM arboles WHERE eliminado = false ORDER BY id`;
    const { rows: espRows } = await sql`SELECT * FROM especies WHERE eliminado = false`;
    const features = arboles.map(rowToFeature);
    const species = espRows.map(rowToEspecie);
    const stats = computeStats(features, species);
    const meta = {
      fuente_datos: 'Vercel Postgres (fuente de la verdad)',
      crs: 'EPSG:4326 (WGS 84)', arboles_publicados: features.length, especies: species.length,
      publicado_en: new Date().toISOString(), publicado_por: user.email,
    };
    const putJson = (path, obj) => put(path, JSON.stringify(obj), {
      access: 'public', contentType: 'application/json; charset=utf-8',
      addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 300,
    });
    const [t, sp, st, mt] = await Promise.all([
      putJson('publico/trees.geojson', { type: 'FeatureCollection', features }),
      putJson('publico/species.json', species),
      putJson('publico/stats.json', stats),
      putJson('publico/meta.json', meta),
    ]);
    const urls = { trees: t.url, species: sp.url, stats: st.url, meta: mt.url };
    await sql`
      INSERT INTO meta (clave, valor) VALUES ('snapshot', ${JSON.stringify({ urls, ...meta })}::jsonb)
      ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`;
    await audit('snapshot', '(publicacion)', 'publicacion', user.email, { arboles: features.length, especies: species.length });
    ok(res, { arboles: features.length, especies: species.length, urls });
  } catch (e) { bad(res, e.message, 500); }
}

function computeStats(features, species) {
  const bySector = new Map();
  let dapSum = 0, dapN = 0, hSum = 0, hN = 0, idf = 0;
  for (const ft of features) {
    const p = ft.properties;
    bySector.set(p.sec || 'Sin sector', (bySector.get(p.sec || 'Sin sector') || 0) + 1);
    if (p.dap != null) { dapSum += p.dap; dapN++; }
    if (p.hT != null) { hSum += p.hT; hN++; }
    if (p.idf) idf++;
  }
  const nativas = species.filter(s => s.origen === 'Nativa').length;
  const sectores = [...bySector.entries()].map(([sector, n]) => ({ sector, n })).sort((a, b) => b.n - a.n);
  const top = [...species].filter(s => s.individuos).sort((a, b) => b.individuos - a.individuos).slice(0, 10)
    .map(s => ({ comun: s.comun, cientifico: s.cientifico, key: s.key, slug: s.slug, n: s.individuos }));
  return {
    total_arboles: features.length, total_registros: features.length,
    especies: species.filter(s => !s.es_no_especie).length, especies_todas: species.length,
    familias: new Set(species.map(s => s.familia).filter(Boolean)).size,
    nativas_pct: species.length ? Math.round(nativas / species.length * 100) : 0,
    identificadas_pct: features.length ? Math.round(idf / features.length * 100) : 0,
    dap_promedio: dapN ? +(dapSum / dapN).toFixed(1) : 0,
    altura_promedio: hN ? +(hSum / hN).toFixed(1) : 0,
    calidad: features.length ? Math.round((idf / features.length) * 100 * 0.6 + (dapN / features.length) * 100 * 0.4) : 0,
    sectores, top_especies: top,
  };
}
