// ============================================================================
// GENERADOR DE DATOS — Sistema Inteligente de Arbolado Urbano
// ----------------------------------------------------------------------------
// Lee el Shapefile real (Prueba.shp/.dbf) referenciado por el proyecto ArcGIS
// Pro (Prueba.aprx), lo une con la referencia botánica y produce los archivos
// de datos que consume la aplicación web:
//   datos/trees.geojson  — todos los árboles (geometría + atributos)
//   datos/species.json   — catálogo de especies agregado
//   datos/stats.json     — indicadores del panel
//   datos/meta.json      — metadatos de la importación (trazabilidad)
//
// Uso:  node scripts/generar-datos.mjs "<carpeta del shapefile>"
// Por defecto usa la ruta del proyecto de prueba.
// ============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BOTANICA, NO_ESPECIE } from './botanica.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'datos');
fs.mkdirSync(OUT, { recursive: true });

const SHP_DIR = process.argv[2] || 'C:/Users/xavie/OneDrive/Desktop/Xavier/Prueba Final/Shapefile';
const SHP_NAME = 'Prueba';

// ---------- utilidades ----------
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const clean = v => (v == null ? '' : String(v).replace(/\0/g, '').trim());
const norm = v => clean(v).toUpperCase().replace(/\s+/g, ' ');

// ---------- DBF ----------
function readDBF(file) {
  const buf = fs.readFileSync(file);
  const numRecords = buf.readUInt32LE(4);
  const headerSize = buf.readUInt16LE(8);
  const recordSize = buf.readUInt16LE(10);
  const fields = [];
  let off = 32;
  while (buf[off] !== 0x0d) {
    fields.push({
      name: buf.toString('ascii', off, off + 11).replace(/\0.*$/, '').trim(),
      type: String.fromCharCode(buf[off + 11]),
      len: buf[off + 16],
    });
    off += 32;
  }
  const rows = [];
  for (let i = 0; i < numRecords; i++) {
    const start = headerSize + i * recordSize;
    if (buf[start] === 0x2a) continue; // borrado
    const rec = {};
    let c = start + 1;
    for (const f of fields) {
      rec[f.name] = buf.toString('utf8', c, c + f.len).replace(/\0/g, '').trim();
      c += f.len;
    }
    rows.push(rec);
  }
  return { rows, fields };
}

// ---------- SHP (puntos) ----------
function readSHPpoints(file) {
  const buf = fs.readFileSync(file);
  const pts = [];
  let p = 100;
  while (p < buf.length) {
    const contentLen = buf.readInt32BE(p + 4);
    const rs = p + 8;
    const st = buf.readInt32LE(rs);
    if (st === 1 || st === 11 || st === 21) {
      pts.push([buf.readDoubleLE(rs + 4), buf.readDoubleLE(rs + 12)]);
    } else pts.push(null);
    p = rs + contentLen * 2;
  }
  return pts;
}

console.log('→ Leyendo Shapefile:', SHP_DIR);
const { rows } = readDBF(path.join(SHP_DIR, SHP_NAME + '.dbf'));
const geoms = readSHPpoints(path.join(SHP_DIR, SHP_NAME + '.shp'));
console.log(`  registros DBF: ${rows.length} · geometrías SHP: ${geoms.length}`);

// ---------- Construcción de árboles + validación ----------
const features = [];
const speciesAgg = new Map();      // key normalizado -> agregado
const sectorSet = new Map();
let idSeq = 0;
const seenCoord = new Map();       // "lon,lat" -> firstId
const quality = {
  total: rows.length, conCoord: 0, sinCoord: 0, coordFueraArea: 0,
  conEspecie: 0, sinEspecie: 0, identificadas: 0, noIdentificadas: 0,
  conAltura: 0, conDap: 0, duplicadas: 0,
};

const dapVals = [], altVals = [];

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const g = geoms[i];
  let lon = num(r.longitud_w), lat = num(r.latitud_wg);
  // respaldo desde la geometría si faltan columnas
  if ((lon === null || lat === null) && g) { lon = g[0]; lat = g[1]; }

  const hasCoord = lon !== null && lat !== null && lon !== 0 && lat !== 0;
  const inArea = hasCoord && lon >= -75 && lon <= -68 && lat >= -40 && lat <= -30;
  if (hasCoord) quality.conCoord++; else quality.sinCoord++;
  if (hasCoord && !inArea) quality.coordFueraArea++;

  const espNorm = norm(r.especie_no);
  const espKey = espNorm || 'SIN ESPECIE';
  if (espNorm) quality.conEspecie++; else quality.sinEspecie++;

  const bot = BOTANICA[espNorm];
  const esNoEspecie = NO_ESPECIE.has(espNorm) || !espNorm;
  if (bot && bot.cientifico) quality.identificadas++; else quality.noIdentificadas++;

  const dap = num(r.dap_origin);
  const altT = num(r.altura_tot);
  const altC = num(r.altura_cop);
  if (dap !== null && dap > 0 && dap < 400) { quality.conDap++; dapVals.push(dap); }
  if (altT !== null && altT > 0 && altT < 80) { quality.conAltura++; altVals.push(altT); }

  const id = ++idSeq;
  const codigo = `ARB-${String(id).padStart(5, '0')}`;

  // detección de duplicado por coordenada exacta
  let dup = false;
  if (hasCoord) {
    const k = lon.toFixed(6) + ',' + lat.toFixed(6);
    if (seenCoord.has(k)) { dup = true; quality.duplicadas++; }
    else seenCoord.set(k, id);
  }

  const sector = clean(r.sector) || 'Sin sector';
  sectorSet.set(sector, (sectorSet.get(sector) || 0) + 1);

  // slug de especie estable
  const slug = espKey.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sin-especie';

  const props = {
    id, codigo,
    e: espKey,               // especie normalizada (fuente)
    sp: slug,                // slug de especie
    sci: bot?.cientifico || clean(r.nombre_cie) || null,
    fam: bot?.familia || null,
    dir: clean(r.direccion) || null,
    sec: sector,
    dap: dap ?? null,
    hT: altT ?? null,
    hC: altC ?? null,
    fte: clean(r.fuente_hoj) || null,
    ok: inArea,              // coordenada válida dentro del área
    dup,                     // posible duplicado
    idf: !!(bot && bot.cientifico), // identificada botánicamente
  };

  if (hasCoord) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
      properties: props,
    });
  }

  // agregación por especie
  if (!speciesAgg.has(espKey)) {
    speciesAgg.set(espKey, {
      key: espKey, slug, count: 0, sectores: new Map(),
      dap: [], alt: [], sample: props.dir,
      esNoEspecie,
    });
  }
  const agg = speciesAgg.get(espKey);
  agg.count++;
  if (dap !== null && dap > 0 && dap < 400) agg.dap.push(dap);
  if (altT !== null && altT > 0 && altT < 80) agg.alt.push(altT);
  agg.sectores.set(sector, (agg.sectores.get(sector) || 0) + 1);
}

const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const round1 = v => (v == null ? null : Math.round(v * 10) / 10);

// ---------- species.json ----------
const species = [...speciesAgg.values()]
  .sort((a, b) => b.count - a.count)
  .map(a => {
    const bot = BOTANICA[a.key] || null;
    return {
      key: a.key,
      slug: a.slug,
      comun: bot?.comun || titleCase(a.key),
      cientifico: bot?.cientifico || null,
      familia: bot?.familia || null,
      origen: bot?.origen || null,
      follaje: bot?.follaje || null,
      porte: bot?.porte || null,
      altura_max: bot?.altura_max || null,
      hidrico: bot?.hidrico || null,
      floracion: bot?.floracion || null,
      ecologia: bot?.ecologia || null,
      descripcion: bot?.desc || null,
      individuos: a.count,
      dap_promedio: round1(avg(a.dap)),
      altura_promedio: round1(avg(a.alt)),
      identificada: !!(bot && bot.cientifico),
      es_no_especie: a.esNoEspecie,
      sectores: [...a.sectores.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ sector: k, n: v })),
    };
  });

function titleCase(s) {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ---------- stats.json ----------
const familias = new Set(species.filter(s => s.familia).map(s => s.familia));
const identificadosCount = species.filter(s => s.identificada).reduce((n, s) => n + s.individuos, 0);
const nativas = species.filter(s => s.origen === 'Nativa');
const nativasCount = nativas.reduce((n, s) => n + s.individuos, 0);

// Índice de calidad del inventario (0-100) sobre criterios objetivos
const cTotal = quality.total;
const qCoord = quality.conCoord / cTotal;
const qArea = (quality.conCoord - quality.coordFueraArea) / cTotal;
const qEspecie = quality.conEspecie / cTotal;
const qIdent = quality.identificadas / cTotal;
const qDap = quality.conDap / cTotal;
const qAlt = quality.conAltura / cTotal;
const qDup = 1 - (quality.duplicadas / cTotal);
const calidad = Math.round(100 * (0.25*qArea + 0.15*qEspecie + 0.20*qIdent + 0.12*qDap + 0.13*qAlt + 0.15*qDup));

const stats = {
  total_arboles: features.length,
  total_registros: cTotal,
  especies: species.filter(s => !s.es_no_especie).length,
  especies_todas: species.length,
  familias: familias.size,
  nativas_pct: Math.round((nativasCount / cTotal) * 100),
  identificadas_pct: Math.round((identificadosCount / cTotal) * 100),
  dap_promedio: round1(avg(dapVals)),
  altura_promedio: round1(avg(altVals)),
  calidad,
  sectores: [...sectorSet.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ sector: k, n: v })),
  top_especies: species.filter(s => !s.es_no_especie).slice(0, 12)
    .map(s => ({ comun: s.comun, cientifico: s.cientifico, key: s.key, slug: s.slug, n: s.individuos })),
  top_familias: topFamilias(species),
  origen: {
    nativa: species.filter(s=>s.origen==='Nativa').reduce((n,s)=>n+s.individuos,0),
    introducida: species.filter(s=>s.origen==='Introducida').reduce((n,s)=>n+s.individuos,0),
    ornamental: species.filter(s=>s.origen==='Ornamental').reduce((n,s)=>n+s.individuos,0),
    sin_dato: species.filter(s=>!s.origen).reduce((n,s)=>n+s.individuos,0),
  },
  altura_dist: histograma(altVals, [0,3,6,9,12,15,100], ['0–3 m','3–6 m','6–9 m','9–12 m','12–15 m','>15 m']),
  dap_dist: histograma(dapVals, [0,10,20,30,40,60,1000], ['0–10','10–20','20–30','30–40','40–60','>60']),
  calidad_detalle: {
    conCoord: quality.conCoord, sinCoord: quality.sinCoord,
    coordFueraArea: quality.coordFueraArea,
    conEspecie: quality.conEspecie, sinEspecie: quality.sinEspecie,
    identificadas: quality.identificadas, noIdentificadas: quality.noIdentificadas,
    conDap: quality.conDap, conAltura: quality.conAltura, duplicadas: quality.duplicadas,
  },
};

function topFamilias(sp) {
  const m = new Map();
  for (const s of sp) if (s.familia) m.set(s.familia, (m.get(s.familia) || 0) + s.individuos);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ familia: k, n: v }));
}
function histograma(vals, bins, labels) {
  const counts = new Array(labels.length).fill(0);
  for (const v of vals) {
    for (let i = 0; i < bins.length - 1; i++) {
      if (v >= bins[i] && v < bins[i + 1]) { counts[i]++; break; }
    }
  }
  return labels.map((l, i) => ({ label: l, n: counts[i] }));
}

// ---------- meta.json (trazabilidad) ----------
const meta = {
  fuente_archivo: 'Prueba.aprx (ArcGIS Pro) → Prueba.shp',
  fuente_datos: 'CATASTRO_ARBOLADO_BASE_MAESTRA (catastro municipal de arbolado)',
  crs: 'EPSG:4326 (WGS 84)',
  encoding: 'UTF-8',
  campos_origen: ['fuente_hoj','fila_origi','sector','direccion','comuna','utm_x','utm_y','longitud_w','latitud_wg','especie_no','nombre_cie','dap_origin','altura_tot','altura_cop','fecha_cata'],
  fecha_procesamiento: new Date().toISOString(),
  registros_origen: cTotal,
  arboles_publicados: features.length,
  nota: 'Datos reales extraídos del catastro. El .aprx solo referencia las fuentes; la geometría y atributos provienen del Shapefile externo asociado.',
};

// ---------- escritura ----------
const geojson = { type: 'FeatureCollection', features };
fs.writeFileSync(path.join(OUT, 'trees.geojson'), JSON.stringify(geojson));
fs.writeFileSync(path.join(OUT, 'species.json'), JSON.stringify(species));
fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 2));
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));

const mb = n => (fs.statSync(path.join(OUT, n)).size / 1048576).toFixed(2) + ' MB';
console.log('✓ trees.geojson  ', features.length, 'árboles ·', mb('trees.geojson'));
console.log('✓ species.json   ', species.length, 'especies');
console.log('✓ stats.json     · calidad', calidad + '%', '· nativas', stats.nativas_pct + '%');
console.log('✓ meta.json');
