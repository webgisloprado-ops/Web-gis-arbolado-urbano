// ============================================================================
// pages/importar.js — asistente de importación GIS (5 pasos)
// ============================================================================
import { el, esc, fmt, toast } from '../util.js';
import { parseUploaded, autoMap } from '../data.js';
import { pageHeader } from '../ui.js';
import { footer } from './home.js';
import { bulkImportArboles, isConfigured } from '../db.js';
import { currentUser } from '../firebase.js';

const STEPS = ['Subir archivo', 'Analizar', 'Mapear columnas', 'Validar', 'Importar'];

export function renderImportar(main) {
  main.innerHTML = '';
  const section = el('section', { class: 'section' });
  const wrap = el('div', { class: 'wrap', style: 'max-width:860px' });
  wrap.append(pageHeader('Importar datos GIS', 'Asistente de 5 pasos: analiza la estructura, mapea columnas y valida coordenadas antes de publicar.'));

  const stepsBar = el('div', { class: 'steps' });
  STEPS.forEach(s => stepsBar.append(el('div', { class: 'step' }, [el('span', { text: s })])));
  wrap.append(stepsBar);

  const body = el('div', { id: 'wizard-body' });
  wrap.append(body);
  section.append(wrap);
  main.append(section, footer());

  const ctx = { step: 0, parsed: null, mapping: null, filename: null, aprx: false };
  setStep(0);

  function setStep(i) {
    ctx.step = i;
    [...stepsBar.children].forEach((s, idx) => { s.classList.toggle('done', idx < i); s.classList.toggle('active', idx === i); });
    body.innerHTML = '';
    [step1, step2, step3, step4, step5][i](body, ctx, setStep);
    body.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ---------- Paso 1: subir ----------
function step1(body, ctx, next) {
  const dz = el('div', { class: 'dropzone' }, [
    el('div', { class: 'dz-ico', text: '📁' }),
    el('h3', { text: 'Arrastra aquí tu archivo GIS' }),
    el('p', { class: 'muted', text: 'o' }),
    el('button', { class: 'btn btn-primary', text: 'Seleccionar archivo' }),
    el('p', { class: 'muted', style: 'margin-top:14px;font-size:.84rem', text: 'Formatos: GeoJSON, JSON, CSV (en el navegador). .aprx, .shp, .zip, .gpkg, .kml/.kmz requieren procesamiento en servidor.' }),
  ]);
  const input = el('input', { type: 'file', accept: '.geojson,.json,.csv,.aprx,.shp,.zip,.gpkg,.kml,.kmz', style: 'display:none' });
  dz.append(input);
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', e => e.target.files[0] && handleFile(e.target.files[0], ctx, next));
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f, ctx, next); });
  body.append(dz);

  body.append(el('div', { class: 'callout callout-green', style: 'margin-top:20px' }, [
    el('span', { class: 'ci', text: '🌳' }),
    el('div', {}, [el('strong', { text: 'Datos de ejemplo. ' }), 'La plataforma ya está cargada con un catastro real de 17.179 árboles procesado desde un proyecto ArcGIS Pro (Prueba.aprx). Puedes probar el asistente con cualquier GeoJSON o CSV propio.']),
  ]));
}

function handleFile(file, ctx, next) {
  ctx.filename = file.name;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  ctx.aprx = ['aprx', 'shp', 'zip', 'gpkg', 'kml', 'kmz'].includes(ext);
  if (ctx.aprx) { ctx.parsed = null; next(1); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try { ctx.parsed = parseUploaded(reader.result, file.name); next(1); }
    catch (err) { toast(err.message); }
  };
  reader.readAsText(file);
}

// ---------- Paso 2: analizar ----------
function step2(body, ctx, next) {
  if (ctx.aprx) return analyzeAprx(body, ctx, next);
  const p = ctx.parsed;
  body.append(el('h3', { text: 'Analizando información…' }));
  const list = el('ul', { class: 'analyze-list' });
  body.append(list);
  const items = [
    ['Archivo detectado', ctx.filename],
    ['Formato', p.kind === 'geojson' ? 'GeoJSON (FeatureCollection)' : 'Tabular (CSV/JSON)'],
    ['Registros encontrados', fmt(p.count)],
    ['Campos identificados', p.fields.length + ' columnas'],
  ];
  const coordFields = detectCoords(p.fields);
  items.push(['Coordenadas detectadas', coordFields ? `${coordFields.lon} / ${coordFields.lat}` : 'requiere mapeo manual']);
  reveal(list, items, () => {
    body.append(navRow(() => next(0), () => next(2), 'Continuar al mapeo'));
  });
}

function analyzeAprx(body, ctx, next) {
  body.append(el('h3', { text: 'Proyecto ArcGIS Pro detectado' }));
  body.append(el('div', { class: 'callout callout-amber' }, [
    el('span', { class: 'ci', text: '⚠️' }),
    el('div', {}, [
      el('strong', { text: 'Este proyecto contiene referencias a fuentes de datos externas. ' }),
      'Un archivo .aprx (o .shp/.gpkg) describe mapas, capas y estilos, pero los datos suelen vivir en archivos externos (Shapefile, Excel, geodatabase). Para importar la información completa, esas fuentes deben estar disponibles y el procesamiento debe hacerse en el servidor con GDAL/ogr2ogr.',
    ]),
  ]));
  body.append(el('div', { class: 'card card-pad', style: 'margin-top:16px' }, [
    el('h4', { style: 'margin-bottom:10px', text: 'Qué extrae el procesador de .aprx (en servidor)' }),
    el('ul', { style: 'margin:0;padding-left:20px;color:var(--text-2);font-size:.92rem;line-height:1.9' }, [
      el('li', { html: 'Mapas y <b>capas</b> del proyecto, con su tipo (puntos, líneas, polígonos, tablas).' }),
      el('li', { html: '<b>Rutas de las fuentes</b> (Shapefile, Excel, GDB) y su factory de conexión.' }),
      el('li', { html: 'Campos de atributos, <b>sistema de referencia espacial</b> (CRS) y campo de visualización.' }),
      el('li', { html: 'Transformación a GeoJSON interoperable, si las fuentes están presentes.' }),
    ]),
  ]));
  body.append(el('div', { class: 'callout callout-blue', style: 'margin-top:16px' }, [
    el('span', { class: 'ci', text: '💡' }),
    el('div', {}, ['Ejemplo real de este proyecto: ', el('code', { text: 'Prueba.aprx' }), ' referenciaba un Shapefile externo (', el('code', { text: 'Prueba.shp' }), ', 17.179 puntos, EPSG:4326) y una tabla Excel. El sistema resolvió el Shapefile y publicó los árboles que ves en el mapa. La documentación técnica describe el endpoint ', el('code', { text: 'POST /api/import' }), ' para automatizarlo.']),
  ]));
  body.append(navRow(() => next(0), null));
}

// ---------- Paso 3: mapear columnas ----------
function step3(body, ctx, next) {
  const p = ctx.parsed;
  const fields = p.kind === 'geojson' ? p.fields : p.fields;
  ctx.mapping = ctx.mapping || autoMap(fields);
  body.append(el('h3', { text: 'Mapeo inteligente de columnas' }));
  body.append(el('p', { class: 'muted', text: 'Revisa y corrige las equivalencias detectadas antes de importar. El sistema reconoce nombres alternativos (especie, scientific_name, lat/y, lon/x…).' }));

  const targets = { especie: 'Especie / nombre común', nombre_cientifico: 'Nombre científico', latitud: 'Latitud', longitud: 'Longitud', altura: 'Altura', diametro: 'Diámetro (DAP)', direccion: 'Dirección', sector: 'Sector / comuna', codigo: 'Código' };
  const table = el('table', { class: 'map-table' });
  table.append(el('thead', {}, [el('tr', {}, [el('th', { text: 'Campo del sistema' }), el('th', { text: 'Columna del archivo' })])]));
  const tbody = el('tbody');
  Object.entries(targets).forEach(([key, label]) => {
    const sel = el('select', { class: 'select', onchange: e => { ctx.mapping[key] = e.target.value || undefined; } });
    sel.append(el('option', { value: '', text: '— sin asignar —' }));
    fields.forEach(f => sel.append(el('option', { value: f, text: f, selected: ctx.mapping[key] === f ? '' : null })));
    tbody.append(el('tr', {}, [
      el('td', {}, [el('strong', { text: label }), key === 'latitud' || key === 'longitud' ? el('span', { class: 'badge badge-red', style: 'margin-left:8px', text: 'requerido' }) : null]),
      el('td', {}, [sel]),
    ]));
  });
  table.append(tbody);
  body.append(el('div', { style: 'overflow-x:auto' }, [table]));
  body.append(navRow(() => next(1), () => {
    if ((!ctx.mapping.latitud || !ctx.mapping.longitud) && p.kind !== 'geojson') { toast('Asigna latitud y longitud para continuar.'); return; }
    next(3);
  }, 'Validar datos'));
}

// ---------- Paso 4: validar ----------
function step4(body, ctx, next) {
  const p = ctx.parsed;
  body.append(el('h3', { text: 'Validación geográfica' }));
  const rows = p.kind === 'geojson' ? p.features : p.rows;
  const m = ctx.mapping;
  let valid = 0, sinCoord = 0, fuera = 0, sinEsp = 0;
  const getLatLon = r => {
    if (p.kind === 'geojson') { const c = r.geometry?.coordinates; return c ? [c[1], c[0]] : [null, null]; }
    return [parseFloat(r[m.latitud]), parseFloat(r[m.longitud])];
  };
  const getEsp = r => p.kind === 'geojson' ? (r.properties?.[m.especie] ?? r.properties?.especie) : r[m.especie];
  for (const r of rows) {
    const [lat, lon] = getLatLon(r);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { sinCoord++; continue; }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { fuera++; continue; }
    valid++;
    if (!getEsp(r)) sinEsp++;
  }
  const list = el('ul', { class: 'analyze-list' });
  const okItem = (label, v, ok) => el('li', { class: ok ? 'ok' : '' }, [
    el('span', { class: 'al-ico', text: ok ? '✓' : '⚠' }), el('span', { text: label }), el('span', { class: 'al-v', text: fmt(v) }),
  ]);
  list.append(
    okItem('Registros con coordenadas válidas', valid, true),
    okItem('Registros sin coordenadas', sinCoord, sinCoord === 0),
    okItem('Coordenadas fuera de rango', fuera, fuera === 0),
    okItem('Registros sin especie', sinEsp, sinEsp === 0),
  );
  body.append(list);
  if (sinCoord || fuera) body.append(el('div', { class: 'callout callout-amber', style: 'margin-top:16px' }, [
    el('span', { class: 'ci', text: '⚠️' }), `${fmt(sinCoord + fuera)} registros tienen coordenadas inválidas o faltantes y no se importarán. Revisa el mapeo o el archivo de origen.`,
  ]));
  ctx.validCount = valid;
  body.append(navRow(() => next(2), () => next(4), 'Continuar a importación'));
}

// ---------- Paso 5: importar (vista previa) ----------
function step5(body, ctx, next) {
  const p = ctx.parsed;
  body.append(el('h3', { text: 'Vista previa e importación' }));
  body.append(el('p', { class: 'muted', text: `Se importarán ${fmt(ctx.validCount)} árboles válidos. Revisa la vista previa antes de confirmar.` }));

  const rows = (p.kind === 'geojson' ? p.features : p.rows).slice(0, 6);
  const m = ctx.mapping;
  const table = el('table', { class: 'map-table' });
  table.append(el('thead', {}, [el('tr', {}, ['Especie', 'Científico', 'Lat', 'Lon', 'Altura', 'DAP'].map(h => el('th', { text: h })))]));
  const tb = el('tbody');
  rows.forEach(r => {
    const props = p.kind === 'geojson' ? (r.properties || {}) : r;
    const c = p.kind === 'geojson' ? r.geometry?.coordinates : null;
    const val = k => props[m[k]] ?? '—';
    tb.append(el('tr', {}, [
      el('td', { text: val('especie') }),
      el('td', { text: props[m.nombre_cientifico] || '—' }),
      el('td', { text: c ? c[1].toFixed(5) : (props[m.latitud] || '—') }),
      el('td', { text: c ? c[0].toFixed(5) : (props[m.longitud] || '—') }),
      el('td', { text: props[m.altura] || '—' }),
      el('td', { text: props[m.diametro] || '—' }),
    ]));
  });
  table.append(tb);
  body.append(el('div', { style: 'overflow-x:auto' }, [table]));

  const progress = el('div', { style: 'margin:16px 0' });
  const btn = el('button', { class: 'btn btn-primary btn-block', html: '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg> Confirmar importación', onclick: async () => {
    const configured = await isConfigured();
    const user = configured ? await currentUser() : null;
    if (configured && !user) { toast('Inicia sesión en el panel de administración para importar.'); location.hash = '#/admin'; return; }
    if (!configured) {
      btn.disabled = true; btn.textContent = 'Validando…';
      setTimeout(() => { toast(`Validación completada: ${fmt(ctx.validCount)} árboles. Conecta Firebase para persistir.`); btn.innerHTML = '✓ Validación completada'; }, 700);
      return;
    }
    btn.disabled = true; btn.textContent = 'Importando…';
    const rows = ctx.parsed.kind === 'geojson' ? ctx.parsed.features : ctx.parsed.rows;
    const bar = el('div', { class: 'progress-track', style: 'height:10px;background:var(--brand-soft);border-radius:99px;overflow:hidden' }, [
      el('div', { class: 'progress-fill', style: 'height:100%;width:0;background:var(--brand);transition:width .2s' }),
    ]);
    const label = el('div', { class: 'muted', style: 'font-size:.86rem;margin-top:8px', text: 'Preparando lotes…' });
    progress.innerHTML = ''; progress.append(bar, label);
    try {
      const res = await bulkImportArboles(rows, ctx.mapping, ctx.parsed.kind, {
        onProgress: ({ done, total, written, skipped }) => {
          bar.firstChild.style.width = `${Math.round(done / total * 100)}%`;
          label.textContent = `${fmt(done)} / ${fmt(total)} procesados · ${fmt(written)} importados · ${fmt(skipped)} omitidos`;
        },
      });
      bar.firstChild.style.width = '100%';
      label.innerHTML = `<strong>Importación completada.</strong> ${fmt(res.written)} árboles guardados en Firestore, ${fmt(res.skipped)} omitidos por coordenadas inválidas.`;
      btn.innerHTML = '✓ Importado';
      body.append(el('div', { class: 'callout callout-green', style: 'margin-top:14px' }, [
        el('span', { class: 'ci', text: '✓' }),
        el('div', {}, ['Los datos están en Firestore. Ve a ', el('a', { href: '#/admin/resumen', text: 'Admin → Resumen' }), ' y pulsa ', el('strong', { text: 'Publicar snapshot' }), ' para que aparezcan en la vista pública.']),
      ]));
    } catch (err) {
      label.innerHTML = `<span style="color:var(--red-500)">Error al importar: ${esc(err.message)}</span>`;
      btn.disabled = false; btn.innerHTML = 'Reintentar importación';
    }
  } });
  body.append(progress, btn);
  body.append(el('div', { style: 'text-align:center;margin-top:12px' }, [el('button', { class: 'btn btn-ghost btn-sm', text: '← Volver', onclick: () => next(3) })]));
}

// ---------- helpers ----------
function detectCoords(fields) {
  const m = autoMap(fields);
  return m.latitud && m.longitud ? { lat: m.latitud, lon: m.longitud } : null;
}
function reveal(list, items, done) {
  let i = 0;
  const tick = () => {
    if (i >= items.length) { done && done(); return; }
    const [k, v] = items[i++];
    const li = el('li', { class: 'ok' }, [el('span', { class: 'al-ico', text: '✓' }), el('span', { text: k }), el('span', { class: 'al-v', text: v })]);
    list.append(li);
    setTimeout(tick, 380);
  };
  tick();
}
function navRow(onBack, onNext, nextLabel = 'Continuar') {
  return el('div', { style: 'display:flex;justify-content:space-between;margin-top:24px;gap:10px' }, [
    onBack ? el('button', { class: 'btn btn-ghost', text: '← Atrás', onclick: onBack }) : el('span'),
    onNext ? el('button', { class: 'btn btn-primary', text: nextLabel, onclick: onNext }) : el('span'),
  ]);
}
