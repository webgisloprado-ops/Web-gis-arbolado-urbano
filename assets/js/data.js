// ============================================================================
// data.js — carga y modelo de datos (geometría + especies + estadísticas)
// ============================================================================
import { slugify } from './util.js';

const state = {
  loaded: false,
  trees: [],          // features del GeoJSON (properties + coords)
  species: [],        // catálogo de especies
  speciesBySlug: new Map(),
  stats: null,
  meta: null,
};

let _loadPromise = null;

export function loadData() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    const [g, sp, st, mt, imgs] = await Promise.all([
      fetch('public/data/trees.geojson').then(r => r.json()),
      fetch('public/data/species.json').then(r => r.json()),
      fetch('public/data/stats.json').then(r => r.json()),
      fetch('public/data/meta.json').then(r => r.json()).catch(() => null),
      fetch('public/data/species-images.json').then(r => r.json()).catch(() => ({})),
    ]);
    state.trees = g.features;
    state.species = sp;
    state.stats = st;
    state.meta = mt;
    state.images = imgs || {};
    for (const s of sp) {
      s.foto = state.images[s.slug] || null;   // fotografía real (Wikimedia) si existe
      state.speciesBySlug.set(s.slug, s);
    }
    state.loaded = true;
    return state;
  })();
  return _loadPromise;
}

export const getState = () => state;
export const getStats = () => state.stats;
export const getSpecies = () => state.species;
export const getSpeciesBySlug = slug => state.speciesBySlug.get(slug);
export const getTrees = () => state.trees;
export const getTreeById = id => state.trees.find(f => f.properties.id === +id);
export const getTreesBySpecies = slug => state.trees.filter(f => f.properties.sp === slug);

// ---- Filtrado del mapa ----
export function filterTrees(f) {
  const { species, sectores, hMin, hMax, dMin, dMax, soloIdentificadas, soloNativas } = f;
  const nativeSlugs = soloNativas
    ? new Set(state.species.filter(s => s.origen === 'Nativa').map(s => s.slug)) : null;
  return state.trees.filter(t => {
    const p = t.properties;
    if (species && species.size && !species.has(p.sp)) return false;
    if (sectores && sectores.size && !sectores.has(p.sec)) return false;
    if (hMin != null && (p.hT == null || p.hT < hMin)) return false;
    if (hMax != null && (p.hT == null || p.hT > hMax)) return false;
    if (dMin != null && (p.dap == null || p.dap < dMin)) return false;
    if (dMax != null && (p.dap == null || p.dap > dMax)) return false;
    if (soloIdentificadas && !p.idf) return false;
    if (nativeSlugs && !nativeSlugs.has(p.sp)) return false;
    return true;
  });
}

// ---- Búsqueda global ----
export function search(q, limit = 24) {
  q = q.trim().toLowerCase();
  if (!q) return { species: [], trees: [] };
  const qn = q.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const results = { species: [], trees: [] };

  // Filtros semánticos
  const wantNativa = /\bnativ/.test(qn);
  const wantOrn = /\bornament/.test(qn);

  for (const s of state.species) {
    const hay = [s.comun, s.cientifico, s.familia, s.key, s.origen]
      .filter(Boolean).join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let hit = hay.includes(qn);
    if (wantNativa && s.origen === 'Nativa') hit = true;
    if (wantOrn && s.origen === 'Ornamental') hit = true;
    if (hit) results.species.push(s);
  }
  results.species.sort((a, b) => b.individuos - a.individuos);
  results.species = results.species.slice(0, limit);

  // Árboles por código o dirección
  const byCode = /^arb[-\s]?\d+/i.test(q) || /^\d{3,}$/.test(q);
  if (byCode || q.length >= 3) {
    const code = q.replace(/[^0-9]/g, '');
    for (const t of state.trees) {
      const p = t.properties;
      const codeHit = code && p.codigo.replace(/[^0-9]/g, '').includes(code);
      const dirHit = p.dir && p.dir.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(qn) && qn.length >= 3;
      if (codeHit || dirHit) { results.trees.push(t); if (results.trees.length >= 12) break; }
    }
  }
  return results;
}

// ---- Importación en el navegador (GeoJSON / CSV / JSON) para el asistente ----
export function parseUploaded(text, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'geojson' || ext === 'json') {
    const j = JSON.parse(text);
    if (j.type === 'FeatureCollection') {
      const fields = new Set();
      j.features.slice(0, 200).forEach(f => Object.keys(f.properties || {}).forEach(k => fields.add(k)));
      return { kind: 'geojson', count: j.features.length, fields: [...fields], features: j.features };
    }
    if (Array.isArray(j)) return parseRows(j);
    throw new Error('JSON no reconocido como FeatureCollection ni arreglo de registros.');
  }
  if (ext === 'csv') {
    const rows = parseCSV(text);
    return parseRows(rows);
  }
  throw new Error('Formato leído en el navegador: GeoJSON, JSON o CSV. Para .aprx/.shp/.gpkg se requiere procesamiento en servidor (ver documentación).');
}

function parseRows(rows) {
  const fields = rows.length ? Object.keys(rows[0]) : [];
  return { kind: 'tabular', count: rows.length, fields, rows };
}

function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length);
  if (!lines.length) return [];
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const split = line => {
    const out = []; let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === delim && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur); return out.map(s => s.trim());
  };
  const head = split(lines[0]);
  return lines.slice(1).map(l => { const c = split(l); const o = {}; head.forEach((h, i) => (o[h] = c[i] ?? '')); return o; });
}

// ---- Mapeo inteligente de columnas (normalización, sección 5) ----
const FIELD_SYNONYMS = {
  nombre_cientifico: ['nombre_cientifico', 'nombre cientifico', 'scientific_name', 'nombre_cie', 'cientifico', 'especie_cientifica'],
  especie: ['especie', 'especie_no', 'especie_normalizada', 'nombre_especie', 'especie_nombre', 'species', 'nombre_comun', 'nombre comun'],
  latitud: ['latitud', 'latitude', 'lat', 'latitud_wg', 'y', 'coord_y'],
  longitud: ['longitud', 'longitude', 'lon', 'lng', 'long', 'longitud_w', 'x', 'coord_x'],
  altura: ['altura', 'altura_tot', 'altura_total', 'height', 'alto'],
  diametro: ['diametro', 'dap', 'dap_origin', 'diameter', 'dbh'],
  direccion: ['direccion', 'dirección', 'address', 'calle', 'ubicacion'],
  sector: ['sector', 'comuna', 'barrio', 'zona', 'territorio'],
  codigo: ['codigo', 'código', 'id', 'code', 'id_arbol'],
};
export function autoMap(fields) {
  const map = {};
  const used = new Set();
  const nf = fields.map(f => ({ raw: f, n: slugify(f).replace(/-/g, '_') }));
  for (const [target, syns] of Object.entries(FIELD_SYNONYMS)) {
    for (const s of syns) {
      const hit = nf.find(f => !used.has(f.raw) && (f.n === slugify(s).replace(/-/g, '_') || f.n.includes(slugify(s).replace(/-/g, '_'))));
      if (hit) { map[target] = hit.raw; used.add(hit.raw); break; }
    }
  }
  return map;
}
