// ============================================================================
// capas.js — lectura de archivos GIS en el navegador (sin servidor)
// ----------------------------------------------------------------------------
// Formatos: GeoJSON/JSON, KML, KMZ, Shapefile (.zip con .shp/.dbf/.prj),
// XLSX/XLS y CSV con columnas de latitud y longitud.
// Las librerías se cargan solo al importar (CDN de window.__CDN).
// ============================================================================
import { loadScript } from './util.js';
import { parseUploaded, autoMap } from './data.js';

export const FORMATOS_ACCEPT = '.geojson,.json,.kml,.kmz,.zip,.xlsx,.xls,.csv';
export const FORMATOS_TEXTO = 'GeoJSON, KML, KMZ, Shapefile (.zip), XLSX/CSV con Latitud y Longitud';

const ext = name => (name.split('.').pop() || '').toLowerCase();
const leerTexto = file => file.text();
const leerBuffer = file => file.arrayBuffer();

// Resultado: { kind: 'geojson', features, fields, count, formato }
//         o  { kind: 'tabular', rows, fields, count, formato }
export async function leerArchivoGIS(file) {
  const e = ext(file.name);
  if (e === 'geojson' || e === 'json') return desdeJSON(await leerTexto(file));
  if (e === 'kml') return desdeKML(await leerTexto(file), 'KML');
  if (e === 'kmz') return desdeKMZ(await leerBuffer(file));
  if (e === 'zip') return desdeShapefile(await leerBuffer(file));
  if (e === 'csv') { const r = parseUploaded(await leerTexto(file), 'datos.csv'); return { ...r, formato: 'CSV' }; }
  if (e === 'xlsx' || e === 'xls') return desdeExcel(await leerBuffer(file));
  throw new Error(`Formato .${e} no soportado. Usa: ${FORMATOS_TEXTO}.`);
}

function coleccion(features, formato) {
  const fields = new Set();
  features.slice(0, 300).forEach(f => Object.keys(f.properties || {}).forEach(k => fields.add(k)));
  return { kind: 'geojson', features, fields: [...fields], count: features.length, formato };
}

function desdeJSON(texto) {
  let j;
  try { j = JSON.parse(texto); } catch { throw new Error('El archivo no es un JSON válido.'); }
  if (j.type === 'FeatureCollection') return coleccion(j.features || [], 'GeoJSON');
  if (j.type === 'Feature') return coleccion([j], 'GeoJSON');
  if (Array.isArray(j)) { const r = parseUploaded(JSON.stringify(j), 'datos.json'); return { ...r, formato: 'JSON (tabla)' }; }
  throw new Error('JSON no reconocido: se espera un GeoJSON (FeatureCollection) o una lista de registros.');
}

async function desdeKML(texto, formato) {
  await loadScript(window.__CDN.togeojson);
  const xml = new DOMParser().parseFromString(texto, 'text/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('El KML no es un XML válido.');
  const fc = window.toGeoJSON.kml(xml);
  return coleccion((fc.features || []).filter(f => f.geometry), formato);
}

async function desdeKMZ(buffer) {
  await loadScript(window.__CDN.jszip);
  const zip = await window.JSZip.loadAsync(buffer);
  const kml = Object.values(zip.files).find(f => !f.dir && /\.kml$/i.test(f.name));
  if (!kml) throw new Error('El KMZ no contiene ningún archivo .kml.');
  return desdeKML(await kml.async('string'), 'KMZ');
}

async function desdeShapefile(buffer) {
  await loadScript(window.__CDN.shp);
  let res;
  try { res = await window.shp(buffer); }
  catch (e) { throw new Error('No se pudo leer el Shapefile. El .zip debe contener al menos .shp, .dbf y (recomendado) .prj. ' + (e.message || '')); }
  // shpjs devuelve una FeatureCollection o, si hay varias capas, un arreglo.
  const capas = Array.isArray(res) ? res : [res];
  const features = capas.flatMap(fc => (fc.features || []).map(ft => (
    capas.length > 1 ? { ...ft, properties: { ...ft.properties, _origen: fc.fileName || '' } } : ft
  )));
  return coleccion(features.filter(f => f.geometry), 'Shapefile');
}

async function desdeExcel(buffer) {
  await loadScript(window.__CDN.xlsx);
  const wb = window.XLSX.read(buffer, { type: 'array' });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  if (!hoja) throw new Error('El Excel no tiene hojas.');
  const rows = window.XLSX.utils.sheet_to_json(hoja, { defval: '' });
  return { kind: 'tabular', rows, fields: rows.length ? Object.keys(rows[0]) : [], count: rows.length, formato: `Excel (hoja "${wb.SheetNames[0]}")` };
}

// ---- Coordenadas ----
export function detectarLatLon(fields) {
  const m = autoMap(fields);
  return { lat: m.latitud || null, lon: m.longitud || null };
}

// Número que puede venir con coma decimal ("-33,4512").
export function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  return parseFloat(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s);
}

// Tabla → puntos GeoJSON usando las columnas de latitud y longitud.
export function filasAPuntos(rows, latField, lonField) {
  return rows.map(r => {
    const lat = num(r[latField]), lon = num(r[lonField]);
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { ...r } };
  });
}

// Valida y normaliza geometrías: descarta las vacías o fuera de rango y
// redondea a 6 decimales (~10 cm) para reducir el tamaño guardado.
export function limpiarFeatures(features) {
  const validas = [];
  let invalidas = 0;
  const tipos = {};
  for (const ft of features) {
    const g = ft && ft.geometry;
    if (!g || !g.type) { invalidas++; continue; }
    let ok = true;
    const redondear = c => {
      if (typeof c[0] === 'number') {
        const [lon, lat] = c;
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90 || lon < -180 || lon > 180) ok = false;
        return [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
      }
      return c.map(redondear);
    };
    let geometry;
    if (g.type === 'GeometryCollection') {
      geometry = { type: g.type, geometries: (g.geometries || []).map(x => ({ type: x.type, coordinates: redondear(x.coordinates || []) })) };
    } else {
      if (!Array.isArray(g.coordinates) || !g.coordinates.length) { invalidas++; continue; }
      geometry = { type: g.type, coordinates: redondear(g.coordinates) };
    }
    if (!ok) { invalidas++; continue; }
    const props = {};
    for (const [k, v] of Object.entries(ft.properties || {})) {
      if (v === undefined || typeof v === 'function') continue;
      props[k] = v instanceof Date ? v.toISOString() : (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
    }
    tipos[g.type] = (tipos[g.type] || 0) + 1;
    validas.push({ type: 'Feature', geometry, properties: props });
  }
  return { validas, invalidas, tipos };
}
