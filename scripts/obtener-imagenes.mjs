// ============================================================================
// obtener-imagenes.mjs — Biblioteca Botánica: fotografías reales por especie
// ----------------------------------------------------------------------------
// Para cada especie con nombre científico, busca en Wikimedia Commons (vía la
// API REST de Wikipedia) una fotografía representativa y guarda su URL, autor,
// licencia y página de origen. La búsqueda se hace por NOMBRE CIENTÍFICO, de
// modo que nunca se asigna la imagen de una especie diferente.
//
// Salida: datos/species-images.json  { slug: {url, thumb, page, autor, licencia, fuente} }
//
// Uso:  node scripts/obtener-imagenes.mjs
// ============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'datos', 'species-images.json');
const UA = { 'User-Agent': 'SistemaArboladoUrbano/1.0 (proyecto educativo de catastro de arbolado)' };

const species = JSON.parse(fs.readFileSync(path.join(ROOT, 'datos', 'species.json'), 'utf8'));
const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// fetch con reintentos y espaciado global (evita 429 de Wikimedia).
let _lastReq = 0;
const MIN_GAP = Number(process.env.GAP || 220); // ms entre peticiones
async function fetchJSON(url, tries = Number(process.env.TRIES || 4)) {
  for (let i = 0; i < tries; i++) {
    const wait = Math.max(0, MIN_GAP - (Date.now() - _lastReq));
    if (wait) await sleep(wait);
    _lastReq = Date.now();
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 429 || r.status >= 500) { await sleep(600 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(400 * (i + 1)); }
  }
  return null;
}

// Genera nombres candidatos a partir del nombre científico.
function candidates(sci) {
  const out = new Set();
  const base = sci.trim();
  out.add(base);
  const noCultivar = base.replace(/\s*['"‘’].*$/, '').replace(/\s*\bvar\.\b.*$/, '').trim();
  out.add(noCultivar);
  const noSp = noCultivar.replace(/\s+sp\.?$/i, '').trim();
  out.add(noSp);
  const words = noSp.split(/\s+/);
  if (words.length >= 2) out.add(words[0] + ' ' + words[1]); // género + especie
  out.add(words[0]); // género
  // versión con "×" quitado (híbridos)
  out.add(base.replace(/\s*×\s*/g, ' ').replace(/\s+/g, ' ').trim());
  return [...out].filter(Boolean);
}

const deacc = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Devuelve {thumb, original, page} o null desde la API REST de una wiki.
// `epithet`: epíteto específico que DEBE aparecer en el título del artículo
// encontrado, para garantizar que la foto es de la especie correcta y no de
// otra especie del mismo género (requisito: nunca una imagen de otra especie).
async function summary(lang, name, epithet) {
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, '_'))}`;
    const j = await fetchJSON(url);
    if (!j) return null;
    if (j.type === 'disambiguation') return null;
    if (!j.originalimage && !j.thumbnail) return null;
    // El título del artículo debe contener el epíteto específico (evita fotos
    // del género o de otra especie). Sin epíteto (nivel de género) → se rechaza.
    if (!epithet) return null;
    const title = deacc(j.title || '');
    if (!title.includes(epithet)) return null;
    // descartar imágenes que claramente no son fotos (mapas, escudos, SVG)
    const src = (j.originalimage?.source || j.thumbnail?.source || '');
    if (/(range|map|distribution|locator|\.svg)/i.test(src)) return null;
    return {
      thumb: j.thumbnail?.source || null,
      original: j.originalimage?.source || j.thumbnail?.source || null,
      page: j.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(name)}`,
      title: j.title,
    };
  } catch { return null; }
}

// Nombre de archivo Commons a partir de una URL de upload/thumb.
function fileFromUrl(u) {
  try {
    const clean = u.split('?')[0];
    const m = clean.match(/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+?\.(?:jpe?g|png|gif|tiff?|webp))/i);
    if (m) return decodeURIComponent(m[1]);
    const parts = clean.split('/'); return decodeURIComponent(parts[parts.length - 1]);
  } catch { return null; }
}

// Miniatura del ancho pedido usando Special:FilePath, que RECORTA de forma
// segura (si el original es más pequeño devuelve el original, sin error 400).
function thumbUrl(original, width = 700) {
  const file = fileFromUrl(original);
  if (!file) return original;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
}

async function imageinfo(file) {
  try {
    const u = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent('File:' + file)}&prop=imageinfo&iiprop=extmetadata&format=json&formatversion=2`;
    const j = await fetchJSON(u);
    const md = j?.query?.pages?.[0]?.imageinfo?.[0]?.extmetadata || {};
    return {
      autor: strip(md.Artist?.value) || 'Autor no especificado',
      licencia: strip(md.LicenseShortName?.value) || 'Ver Wikimedia Commons',
    };
  } catch { return { autor: 'Autor no especificado', licencia: 'Ver Wikimedia Commons' }; }
}

const targets = species.filter(s => s.cientifico && !s.es_no_especie);
console.log(`→ Buscando fotografías para ${targets.length} especies con nombre científico…\n`);

let ok = 0, fail = 0;
const result = { ...existing };

for (const s of targets) {
  if (result[s.slug]?.url && !process.env.FORCE) { ok++; continue; }
  // Epíteto específico (segunda palabra del binomio, sin "sp.", cultivar ni ×).
  const cleanSci = s.cientifico.replace(/\s*['"‘’].*$/, '').replace(/\s*×\s*/g, ' ').replace(/\s+sp\.?$/i, '').trim();
  const epithet = deacc(cleanSci.split(/\s+/)[1] || '');
  let found = null, usedName = null;
  for (const name of candidates(s.cientifico)) {
    found = await summary('es', name, epithet) || await summary('en', name, epithet);
    if (found?.original) { usedName = name; break; }
    await sleep(40);
  }
  if (!found?.original) {
    if (result[s.slug]) { delete result[s.slug]; fs.writeFileSync(OUT, JSON.stringify(result, null, 1)); } // purgar entradas incorrectas
    console.log(`  ✗ ${s.comun.padEnd(26)} (${s.cientifico}) — sin foto`);
    fail++; await sleep(40); continue;
  }
  const file = fileFromUrl(found.original);
  const info = file ? await imageinfo(file) : { autor: 'Autor no especificado', licencia: 'CC — ver origen' };
  result[s.slug] = {
    url: thumbUrl(found.original, 700),
    thumb: thumbUrl(found.original, 420),
    page: found.page,
    autor: info.autor,
    licencia: info.licencia,
    fuente: 'Wikimedia Commons',
    match: usedName,
  };
  ok++;
  console.log(`  ✓ ${s.comun.padEnd(26)} → ${file} [${info.licencia}]`);
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1)); // guardado incremental
  await sleep(120);
}

console.log(`\n✓ Listas ${ok} especies con fotografía · ${fail} sin resultado.`);
console.log('  Archivo:', path.relative(ROOT, OUT));
