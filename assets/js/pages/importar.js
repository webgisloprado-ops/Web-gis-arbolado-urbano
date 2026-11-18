// ============================================================================
// pages/importar.js — importación de capas GIS (solo administradores)
// ----------------------------------------------------------------------------
// Acciones: crear una capa nueva, reemplazar una capa existente o agregar
// elementos a una capa (incluida la capa de Arbolado, que solo admite agregar).
// Formatos: GeoJSON, KML, KMZ, Shapefile (.zip), XLSX/CSV con Latitud/Longitud.
// Todo se procesa en el navegador y se guarda en Firestore (plan gratuito).
// ============================================================================
import { el, esc, fmt, toast } from '../util.js';
import { autoMap } from '../data.js';
import { pageHeader } from '../ui.js';
import { footer } from './home.js';
import {
  bulkImportArboles, isConfigured, currentUser, getUserRole, listCapas, guardarCapa, puedeImportar,
} from '../backend.js';
import { leerArchivoGIS, filasAPuntos, limpiarFeatures, detectarLatLon, num, FORMATOS_ACCEPT, FORMATOS_TEXTO } from '../capas.js';

const STEPS = ['Acción', 'Subir archivo', 'Analizar', 'Columnas', 'Validar', 'Importar'];
const COLORES = ['#2e7ab8', '#d9822b', '#8e44ad', '#c0392b', '#16a085', '#7f8c8d'];

export async function renderImportar(main, params = {}) {
  main.innerHTML = '<div class="loader-full"><div class="spinner"></div><p>Verificando permisos…</p></div>';

  // ---- Acceso: solo administradores (admin / superadmin) ----
  const configured = await isConfigured();
  const user = configured ? await currentUser() : null;
  const rol = user ? await getUserRole(user) : null;
  // Si el usuario navegó a otra página mientras se verificaba, no dibujar.
  const sigueAqui = () => /^#\/importar/.test(location.hash);
  if (!sigueAqui()) return;
  if (!configured || !puedeImportar(rol)) {
    main.innerHTML = '';
    const motivo = !configured
      ? 'La importación necesita la base de datos (Firebase) configurada.'
      : !user ? 'Inicia sesión con una cuenta de administrador para importar capas.'
        : 'Tu perfil no tiene permiso para importar capas. Solo los administradores pueden hacerlo.';
    main.append(el('section', { class: 'section' }, [el('div', { class: 'wrap', style: 'max-width:640px' }, [
      el('div', { class: 'empty-state' }, [
        el('div', { class: 'es-ico', text: '🔒' }),
        el('h2', { text: 'Importación restringida' }),
        el('p', { class: 'muted', text: motivo }),
        user ? null : el('a', { class: 'btn btn-primary', href: '#/admin', text: 'Ir al inicio de sesión' }),
      ]),
    ])]), footer());
    return;
  }

  let capas = [];
  try { capas = await listCapas(); } catch (e) { toast('No se pudieron leer las capas: ' + e.message); }
  if (!sigueAqui()) return;

  main.innerHTML = '';
  const section = el('section', { class: 'section' });
  const wrap = el('div', { class: 'wrap', style: 'max-width:900px' });
  wrap.append(pageHeader('Importar capas GIS', `Crea una capa nueva, reemplaza una existente o agrégale elementos. Formatos: ${FORMATOS_TEXTO}.`));

  const stepsBar = el('div', { class: 'steps' });
  STEPS.forEach(s => stepsBar.append(el('div', { class: 'step' }, [el('span', { text: s })])));
  wrap.append(stepsBar);
  const body = el('div', { id: 'wizard-body' });
  wrap.append(body);
  section.append(wrap);
  main.append(section, footer());

  const ctx = {
    accion: params.accion || null, destino: params.capa || null, capas,
    nombre: '', color: COLORES[capas.length % COLORES.length],
    file: null, parsed: null, mapping: null, lat: null, lon: null, validas: null,
  };
  const pasos = [pasoAccion, pasoSubir, pasoAnalizar, pasoColumnas, pasoValidar, pasoImportar];
  const go = i => {
    [...stepsBar.children].forEach((s, idx) => { s.classList.toggle('done', idx < i); s.classList.toggle('active', idx === i); });
    body.innerHTML = '';
    pasos[i](body, ctx, go);
    body.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  go(0);
}

const esArbolado = ctx => ctx.destino === 'arbolado';
const capaDestino = ctx => ctx.capas.find(c => c.id === ctx.destino);
const nombreDestino = ctx => esArbolado(ctx) ? 'Arbolado' : (ctx.accion === 'nueva' ? ctx.nombre : capaDestino(ctx)?.nombre || '—');

// ---------- Paso 0: acción ----------
function pasoAccion(body, ctx, go) {
  body.append(el('h3', { text: '¿Qué quieres hacer?' }));
  const acciones = [
    ['nueva', '🆕', 'Nueva capa', 'Crea una capa a partir de un archivo GIS.'],
    ['reemplazar', '♻️', 'Reemplazar capa', 'Sustituye todos los elementos de una capa existente por los del archivo.'],
    ['agregar', '➕', 'Agregar elementos', 'Suma los elementos del archivo a una capa existente (también a Arbolado).'],
  ];
  const grid = el('div', { class: 'accion-grid' });
  const form = el('div');
  acciones.forEach(([k, ico, t, d]) => grid.append(el('button', {
    class: 'accion-card' + (ctx.accion === k ? ' on' : ''), type: 'button',
    onclick: () => { ctx.accion = k; if (k === 'reemplazar' && esArbolado(ctx)) ctx.destino = null; body.innerHTML = ''; pasoAccion(body, ctx, go); },
  }, [el('span', { class: 'ac-ico', text: ico }), el('strong', { text: t }), el('small', { text: d })])));
  body.append(grid, form);

  if (ctx.accion === 'nueva') {
    const nombre = el('input', { class: 'input', value: ctx.nombre, placeholder: 'Ej.: Áreas verdes, Sectores, Red de riego', oninput: e => { ctx.nombre = e.target.value; } });
    const color = el('input', { class: 'input', type: 'color', value: ctx.color, oninput: e => { ctx.color = e.target.value; } });
    form.append(el('div', { class: 'form-grid' }, [
      el('div', {}, [el('label', { text: 'Nombre de la capa' }), nombre]),
      el('div', {}, [el('label', { text: 'Color' }), color]),
    ]));
  } else if (ctx.accion) {
    const opciones = ctx.capas.map(c => [c.id, `${c.nombre} (${fmt(c.elementos || 0)} elementos)`]);
    if (ctx.accion === 'agregar') opciones.unshift(['arbolado', 'Arbolado (árboles del catastro)']);
    if (!opciones.length) {
      form.append(el('div', { class: 'callout callout-amber' }, [el('span', { class: 'ci', text: 'ℹ️' }), 'Aún no hay capas importadas. Crea primero una "Nueva capa".']));
    } else {
      const sel = el('select', { class: 'select', onchange: e => { ctx.destino = e.target.value || null; } }, [
        el('option', { value: '', text: '— elige una capa —' }),
        ...opciones.map(([v, t]) => el('option', { value: v, text: t, selected: ctx.destino === v ? '' : null })),
      ]);
      form.append(el('div', { style: 'max-width:480px' }, [el('label', { class: 'filter-title', text: 'Capa de destino' }), sel]));
      if (ctx.accion === 'reemplazar') form.append(el('div', { class: 'callout callout-amber', style: 'margin-top:12px' }, [el('span', { class: 'ci', text: '⚠️' }), 'Reemplazar elimina los elementos actuales de la capa y deja solo los del archivo. La capa de Arbolado no se puede reemplazar, solo agregarle árboles.']));
      if (ctx.accion === 'agregar') form.append(el('p', { class: 'muted', style: 'font-size:.85rem;margin-top:8px', text: 'Al agregar a Arbolado, los árboles se guardan en Firestore y aparecen en la vista pública después de "Publicar snapshot".' }));
    }
  }

  body.append(navRow(null, () => {
    if (!ctx.accion) return toast('Elige una acción.');
    if (ctx.accion === 'nueva' && !ctx.nombre.trim()) return toast('Escribe el nombre de la nueva capa.');
    if (ctx.accion !== 'nueva' && !ctx.destino) return toast('Elige la capa de destino.');
    if (ctx.accion === 'reemplazar' && esArbolado(ctx)) return toast('La capa de Arbolado solo admite agregar.');
    if (ctx.accion === 'nueva') ctx.destino = null;
    go(1);
  }, 'Continuar'));
}

// ---------- Paso 1: subir ----------
function pasoSubir(body, ctx, go) {
  const estado = el('p', { class: 'muted', style: 'margin-top:14px;font-size:.84rem', text: `Formatos: ${FORMATOS_TEXTO}.` });
  const dz = el('div', { class: 'dropzone' }, [
    el('div', { class: 'dz-ico', text: '📁' }),
    el('h3', { text: 'Arrastra aquí tu archivo GIS' }),
    el('p', { class: 'muted', text: 'o' }),
    el('button', { class: 'btn btn-primary', type: 'button', text: 'Seleccionar archivo' }),
    estado,
  ]);
  const input = el('input', { type: 'file', accept: FORMATOS_ACCEPT, style: 'display:none' });
  dz.append(input);
  const procesar = async file => {
    estado.textContent = `Leyendo ${file.name}…`;
    try {
      ctx.file = file; ctx.parsed = await leerArchivoGIS(file); ctx.mapping = null; ctx.lat = ctx.lon = null;
      if (!ctx.parsed.count) throw new Error('El archivo no contiene elementos.');
      go(2);
    } catch (err) { estado.textContent = `Formatos: ${FORMATOS_TEXTO}.`; toast(err.message, 5000); }
  };
  dz.addEventListener('click', e => { if (e.target !== input) input.click(); });
  input.addEventListener('change', e => e.target.files[0] && procesar(e.target.files[0]));
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) procesar(f); });
  body.append(el('p', { class: 'muted', html: `Destino: <strong>${esc(nombreDestino(ctx))}</strong> · Acción: <strong>${esc({ nueva: 'Nueva capa', reemplazar: 'Reemplazar', agregar: 'Agregar elementos' }[ctx.accion])}</strong>` }), dz);
  body.append(el('div', { class: 'callout callout-blue', style: 'margin-top:16px' }, [el('span', { class: 'ci', text: '💡' }), el('div', {}, [
    el('strong', { text: 'Shapefile: ' }), 'comprime en un .zip los archivos .shp, .dbf, .shx y .prj (el .prj permite convertir las coordenadas automáticamente). ',
    el('strong', { text: 'Excel/CSV: ' }), 'debe tener una columna de latitud y otra de longitud en grados decimales (WGS84).',
  ])]));
  body.append(navRow(() => go(0), null));
}

// ---------- Paso 2: analizar ----------
function pasoAnalizar(body, ctx, go) {
  const p = ctx.parsed;
  body.append(el('h3', { text: 'Análisis del archivo' }));
  const items = [
    ['Archivo', ctx.file.name],
    ['Formato', p.formato],
    ['Elementos encontrados', fmt(p.count)],
    ['Campos', `${p.fields.length} columnas`],
  ];
  if (p.kind === 'geojson') {
    const tipos = {};
    p.features.forEach(f => { const t = f.geometry?.type || 'sin geometría'; tipos[t] = (tipos[t] || 0) + 1; });
    items.push(['Geometrías', Object.entries(tipos).map(([t, n]) => `${t}: ${fmt(n)}`).join(' · ')]);
  } else {
    const c = detectarLatLon(p.fields);
    items.push(['Coordenadas', c.lat && c.lon ? `${c.lat} / ${c.lon}` : 'requieren elegir columnas']);
  }
  const list = el('ul', { class: 'analyze-list' });
  items.forEach(([k, v]) => list.append(el('li', { class: 'ok' }, [el('span', { class: 'al-ico', text: '✓' }), el('span', { text: k }), el('span', { class: 'al-v', text: v })])));
  body.append(list, navRow(() => go(1), () => go(3), 'Continuar'));
}

// ---------- Paso 3: columnas ----------
function pasoColumnas(body, ctx, go) {
  const p = ctx.parsed;
  const fields = p.fields;

  if (esArbolado(ctx)) {
    // Mapeo completo de atributos de árbol.
    ctx.mapping = ctx.mapping || autoMap(fields);
    body.append(el('h3', { text: 'Columnas del árbol' }));
    body.append(el('p', { class: 'muted', text: 'Indica qué columna del archivo corresponde a cada dato del árbol.' }));
    const targets = { especie: 'Especie / nombre común', nombre_cientifico: 'Nombre científico', latitud: 'Latitud', longitud: 'Longitud', altura: 'Altura', diametro: 'Diámetro (DAP)', direccion: 'Dirección', sector: 'Sector / comuna', codigo: 'Código' };
    const tbody = el('tbody');
    Object.entries(targets).forEach(([key, label]) => {
      if (p.kind === 'geojson' && (key === 'latitud' || key === 'longitud')) return;   // vienen de la geometría
      const sel = el('select', { class: 'select', onchange: e => { ctx.mapping[key] = e.target.value || undefined; } },
        [el('option', { value: '', text: '— sin asignar —' }), ...fields.map(f => el('option', { value: f, text: f, selected: ctx.mapping[key] === f ? '' : null }))]);
      tbody.append(el('tr', {}, [el('td', {}, [el('strong', { text: label }), key === 'latitud' || key === 'longitud' ? el('span', { class: 'badge badge-red', style: 'margin-left:8px', text: 'requerido' }) : null]), el('td', {}, [sel])]));
    });
    body.append(el('div', { style: 'overflow-x:auto' }, [el('table', { class: 'map-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Dato' }), el('th', { text: 'Columna del archivo' })])]), tbody,
    ])]));
    body.append(navRow(() => go(2), () => {
      if (p.kind !== 'geojson' && (!ctx.mapping.latitud || !ctx.mapping.longitud)) return toast('Asigna latitud y longitud.');
      go(4);
    }, 'Validar'));
    return;
  }

  if (p.kind === 'geojson') {
    body.append(el('h3', { text: 'Atributos' }));
    body.append(el('p', { class: 'muted', text: 'El archivo ya trae geometrías: no hay que elegir columnas de coordenadas. Se conservarán todos los atributos:' }));
    body.append(el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, (fields.length ? fields : ['(sin atributos)']).slice(0, 60).map(f => el('span', { class: 'badge badge-gray', text: f }))));
    body.append(navRow(() => go(2), () => go(4), 'Validar'));
    return;
  }

  // Tabla (Excel/CSV): elegir latitud y longitud.
  const det = detectarLatLon(fields);
  ctx.lat = ctx.lat || det.lat; ctx.lon = ctx.lon || det.lon;
  const selCol = (key, label) => el('div', {}, [
    el('label', { text: label }),
    el('select', { class: 'select', onchange: e => { ctx[key] = e.target.value || null; } },
      [el('option', { value: '', text: '— elige la columna —' }), ...fields.map(f => el('option', { value: f, text: f, selected: ctx[key] === f ? '' : null }))]),
  ]);
  body.append(el('h3', { text: 'Columnas de coordenadas' }));
  body.append(el('p', { class: 'muted', text: 'Elige las columnas con la latitud y la longitud en grados decimales (WGS84). El resto de columnas se guardan como atributos.' }));
  body.append(el('div', { class: 'form-grid', style: 'max-width:560px' }, [selCol('lat', 'Latitud'), selCol('lon', 'Longitud')]));
  body.append(navRow(() => go(2), () => {
    if (!ctx.lat || !ctx.lon) return toast('Elige las columnas de latitud y longitud.');
    if (ctx.lat === ctx.lon) return toast('Latitud y longitud deben ser columnas distintas.');
    go(4);
  }, 'Validar'));
}

// ---------- Paso 4: validar ----------
function pasoValidar(body, ctx, go) {
  const p = ctx.parsed;
  body.append(el('h3', { text: 'Validación geográfica' }));
  let validos = 0, invalidos = 0, detalle = '';

  if (esArbolado(ctx)) {
    // Árboles: solo puntos con coordenadas válidas.
    const m = ctx.mapping;
    if (p.kind === 'geojson') {
      ctx.filasArbol = p.features.filter(f => f.geometry?.type === 'Point');
      detalle = p.features.length - ctx.filasArbol.length ? `${fmt(p.features.length - ctx.filasArbol.length)} elementos no son puntos y se omitirán.` : '';
    } else {
      // Normaliza coma decimal en lat/lon.
      ctx.filasArbol = p.rows.map(r => ({ ...r, [m.latitud]: num(r[m.latitud]), [m.longitud]: num(r[m.longitud]) }));
    }
    for (const r of ctx.filasArbol) {
      const [lat, lon] = p.kind === 'geojson' ? [r.geometry.coordinates[1], r.geometry.coordinates[0]] : [r[m.latitud], r[m.longitud]];
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) validos++; else invalidos++;
    }
    invalidos += p.kind === 'geojson' ? p.features.length - ctx.filasArbol.length : 0;
  } else {
    const features = p.kind === 'geojson' ? p.features : filasAPuntos(p.rows, ctx.lat, ctx.lon);
    const r = limpiarFeatures(features);
    ctx.validas = r.validas; validos = r.validas.length; invalidos = r.invalidas;
    detalle = Object.entries(r.tipos).map(([t, n]) => `${t}: ${fmt(n)}`).join(' · ');
  }
  ctx.validCount = validos;

  const list = el('ul', { class: 'analyze-list' });
  const item = (label, v, ok) => el('li', { class: ok ? 'ok' : '' }, [el('span', { class: 'al-ico', text: ok ? '✓' : '⚠' }), el('span', { text: label }), el('span', { class: 'al-v', text: fmt(v) })]);
  list.append(item('Elementos válidos', validos, validos > 0), item('Elementos con geometría o coordenadas inválidas', invalidos, invalidos === 0));
  body.append(list);
  if (detalle) body.append(el('p', { class: 'muted', style: 'font-size:.86rem', text: detalle }));
  if (invalidos) body.append(el('div', { class: 'callout callout-amber', style: 'margin-top:12px' }, [el('span', { class: 'ci', text: '⚠️' }), `${fmt(invalidos)} elementos no se importarán. Revisa las columnas elegidas o el archivo de origen.`]));
  body.append(navRow(() => go(3), validos ? () => go(5) : null, 'Continuar'));
}

// ---------- Paso 5: importar ----------
function pasoImportar(body, ctx, go) {
  const textos = {
    nueva: `Se creará la capa "${ctx.nombre}" con ${fmt(ctx.validCount)} elementos.`,
    reemplazar: `La capa "${nombreDestino(ctx)}" quedará con ${fmt(ctx.validCount)} elementos (se reemplazan los ${fmt(capaDestino(ctx)?.elementos || 0)} actuales).`,
    agregar: `Se agregarán ${fmt(ctx.validCount)} elementos a la capa "${nombreDestino(ctx)}".`,
  };
  body.append(el('h3', { text: 'Confirmar importación' }));
  body.append(el('p', { text: textos[ctx.accion] }));

  const bar = el('div', { style: 'height:10px;background:var(--brand-soft);border-radius:99px;overflow:hidden;margin-top:14px' }, [el('div', { style: 'height:100%;width:0;background:var(--brand);transition:width .2s' })]);
  const label = el('div', { class: 'muted', style: 'font-size:.86rem;margin-top:8px' });
  const progreso = el('div', { hidden: true }, [bar, label]);
  const setPct = pct => { bar.firstChild.style.width = `${Math.round(pct)}%`; };

  const btn = el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:14px', text: ctx.accion === 'reemplazar' ? '♻️ Reemplazar capa' : '✓ Confirmar importación', onclick: async () => {
    if (ctx.accion === 'reemplazar' && !confirm(`¿Reemplazar todos los elementos de "${nombreDestino(ctx)}"?`)) return;
    btn.disabled = true; btn.textContent = 'Importando…'; progreso.hidden = false;
    try {
      if (esArbolado(ctx)) {
        const res = await bulkImportArboles(ctx.filasArbol, ctx.mapping, ctx.parsed.kind, {
          onProgress: ({ done, total, written }) => { setPct(done / total * 100); label.textContent = `${fmt(done)} / ${fmt(total)} procesados · ${fmt(written)} guardados`; },
        });
        setPct(100);
        label.innerHTML = `<strong>Listo.</strong> ${fmt(res.written)} árboles agregados, ${fmt(res.skipped)} omitidos.`;
        body.append(el('div', { class: 'callout callout-green', style: 'margin-top:14px' }, [el('span', { class: 'ci', text: '✓' }),
          el('div', {}, ['Para que aparezcan en el mapa público, ve a ', el('a', { href: '#/admin/resumen', text: 'Admin → Resumen' }), ' y pulsa ', el('strong', { text: 'Publicar snapshot' }), '.'])]));
      } else {
        const res = await guardarCapa({
          modo: ctx.accion, capaId: ctx.destino, nombre: ctx.nombre, color: ctx.color, features: ctx.validas, archivo: ctx.file.name,
        }, { onProgress: pr => {
          if (pr.fase === 'leyendo') label.textContent = 'Leyendo la capa actual…';
          else { setPct(pr.parte / pr.partes * 100); label.textContent = `Guardando parte ${pr.parte} de ${pr.partes}…`; }
        } });
        setPct(100);
        label.innerHTML = `<strong>Listo.</strong> La capa tiene ${fmt(res.elementos)} elementos.`;
        body.append(el('div', { class: 'callout callout-green', style: 'margin-top:14px' }, [el('span', { class: 'ci', text: '✓' }),
          el('div', {}, ['La capa ya está disponible en el ', el('a', { href: '#/mapa', text: 'mapa' }), ' (panel de capas). Puedes editarla en ', el('a', { href: '#/admin/capas', text: 'Admin → Capas' }), '.'])]));
      }
      btn.textContent = '✓ Importado';
      body.append(el('div', { style: 'text-align:center;margin-top:12px' }, [el('button', { class: 'btn btn-ghost btn-sm', text: 'Importar otro archivo', onclick: () => location.reload() })]));
    } catch (err) {
      label.innerHTML = `<span style="color:var(--red-500)">Error: ${esc(err.message)}</span>`;
      btn.disabled = false; btn.textContent = 'Reintentar';
    }
  } });
  body.append(progreso, btn, el('div', { style: 'text-align:center;margin-top:12px' }, [el('button', { class: 'btn btn-ghost btn-sm', text: '← Volver', onclick: () => go(4) })]));
}

// ---------- helpers ----------
function navRow(onBack, onNext, nextLabel = 'Continuar') {
  return el('div', { style: 'display:flex;justify-content:space-between;margin-top:24px;gap:10px' }, [
    onBack ? el('button', { class: 'btn btn-ghost', type: 'button', text: '← Atrás', onclick: onBack }) : el('span'),
    onNext ? el('button', { class: 'btn btn-primary', type: 'button', text: nextLabel, onclick: onNext }) : el('span'),
  ]);
}
