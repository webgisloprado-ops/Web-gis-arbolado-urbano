// ============================================================================
// api/_lib/db.js — acceso a Vercel Postgres + registro de auditoría
// ----------------------------------------------------------------------------
// Usa @vercel/postgres (variable de entorno POSTGRES_URL). Las tablas se crean
// con scripts/seed-vercel.mjs. Aquí van consultas y helpers compartidos.
// ============================================================================
import { sql } from '@vercel/postgres';

export { sql };

// ¿Está la base configurada? (para /api/health y el fallback del cliente)
export function dbConfigured() {
  return !!(process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL);
}

// Registro de auditoría (append-only): quién, qué y cuándo.
export async function audit(entidad, entidadId, accion, usuario, diff = null) {
  try {
    await sql`INSERT INTO auditoria (entidad, entidad_id, accion, usuario, diff)
              VALUES (${entidad}, ${String(entidadId)}, ${accion}, ${usuario || 'sistema'},
                      ${diff ? JSON.stringify(diff) : null})`;
  } catch (e) { console.warn('auditoría:', e.message); }
}

// ---- Conversión fila Postgres → feature GeoJSON compacto (snapshot público) ----
export function rowToFeature(r) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
    properties: {
      id: r.id, codigo: r.codigo, e: r.especie_key, sp: r.especie_slug,
      sci: r.nombre_cientifico || null, fam: r.familia || null,
      dir: r.direccion || null, sec: r.sector || null,
      dap: r.dap ?? null, hT: r.altura_total ?? null, hC: r.altura_copa ?? null,
      fte: r.fuente || null, ok: r.coord_valida !== false,
      dup: !!r.duplicado, idf: !!r.identificada,
    },
  };
}

// ---- Especie fila → objeto del catálogo (misma forma que species.json) ----
export function rowToEspecie(r) {
  return {
    slug: r.slug, key: r.especie_key, comun: r.comun, cientifico: r.cientifico,
    familia: r.familia, origen: r.origen, follaje: r.follaje, porte: r.porte,
    altura_max: r.altura_max, hidrico: r.hidrico, floracion: r.floracion,
    ecologia: r.ecologia, descripcion: r.descripcion,
    individuos: r.individuos, dap_promedio: r.dap_promedio, altura_promedio: r.altura_promedio,
    identificada: r.identificada, es_no_especie: r.es_no_especie,
    imagenAdmin: r.imagen_admin || null, imagenWikimedia: r.imagen_wikimedia || null,
    sectores: r.sectores || [],
  };
}
