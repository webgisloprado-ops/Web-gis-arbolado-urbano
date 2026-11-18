// ============================================================================
// pages/mapa.js — mapa WebGIS con panel de filtros y ficha lateral
// ============================================================================
import { el, esc, fmt, debounce, toast, ICON } from '../util.js';
import { getSpecies, getStats, getTrees, filterTrees, getSpeciesBySlug } from '../data.js';
import { TreeMap, BASEMAPS } from '../map.js';
import { buildFicha } from '../ui.js';
import { listCapas, getCapaGeoJSON } from '../backend.js';

export async function renderMapa(main, params = {}) {
  main.innerHTML = '';
  const species = getSpecies();
  const stats = getStats();

  const filters = { species: new Set(), sectores: new Set(), hMin: null, hMax: null, dMin: null, dMax: null, soloIdentificadas: false, soloNativas: false };
  if (params.especie) filters.species.add(params.especie);

  // ---------- Layout ----------
  const layout = el('div', { class: 'map-layout' });
  const panel = el('aside', { class: 'filters-panel', id: 'filters-panel' });
  const canvas = el('div', { class: 'map-canvas' });
  const mapDiv = el('div', { id: 'map' });
  canvas.append(mapDiv);
  layout.append(panel, canvas);
  main.append(layout);

  // ---------- Mapa ----------
  const tm = new TreeMap(mapDiv, {});
  await tm.init();
  main._map = tm;

  // ---------- Barra superior (inteligencia de zona) ----------
  const topbar = el('div', { class: 'map-topbar' });
  const pillCount = el('div', { class: 'map-pill', html: `${ICON.tree} <span id="mp-count"><b>—</b> árboles</span>` });
  const pillZone = el('div', { class: 'map-pill', id: 'mp-zone', hidden: true });
  topbar.append(pillCount, pillZone);
  canvas.append(topbar);

  // ---------- Herramientas ----------
  const toolbar = el('div', { class: 'map-toolbar' });
  const modeSeg = el('div', { class: 'seg' }, [
    segBtn('Puntos', true, () => setMode('cluster')),
    segBtn('Calor', false, () => setMode('heat')),
  ]);
  const btnLoc = el('button', { class: 'map-btn', title: 'Mi ubicación', 'aria-label': 'Mi ubicación', html: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>', onclick: () => tm.locate() });
  const btnFit = el('button', { class: 'map-btn', title: 'Ver todo', 'aria-label': 'Ajustar a los datos', html: '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>', onclick: () => tm.fitTo(current) });
  const baseSel = el('select', { class: 'select', style: 'width:auto', 'aria-label': 'Capa base', onchange: e => tm.setBasemap(e.target.value) });
  Object.entries(BASEMAPS).forEach(([k, b]) => baseSel.append(el('option', { value: k, text: b.name })));
  const baseWrap = el('div', { class: 'map-pill', style: 'padding:4px' }, [baseSel]);
  const btnCapas = el('button', { class: 'map-btn', title: 'Capas', 'aria-label': 'Capas del mapa', 'aria-expanded': 'false',
    html: '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
    onclick: () => { const abierto = layersPanel.hidden; layersPanel.hidden = !abierto; btnCapas.setAttribute('aria-expanded', String(abierto)); } });
  toolbar.append(modeSeg, baseWrap, btnCapas, btnLoc, btnFit);
  canvas.append(toolbar);

  // ---------- Panel de capas (Arbolado + capas importadas) ----------
  const layersPanel = el('div', { class: 'layers-panel', hidden: true, role: 'region', 'aria-label': 'Capas' });
  canvas.append(layersPanel);
  const capasState = { arbolado: true, capas: [], visibles: new Set(), cache: new Map(), cargando: new Set() };
  tm.opts.onLocateError = () => toast('No se pudo obtener tu ubicación');

  // ---------- Drawer ficha ----------
  const drawer = el('aside', { class: 'drawer', id: 'tree-drawer', 'aria-hidden': 'true' });
  const drawerClose = el('button', { class: 'btn-icon drawer-close', 'aria-label': 'Cerrar ficha', html: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>', onclick: closeDrawer });
  const drawerBody = el('div', { id: 'drawer-body' });
  drawer.append(drawerClose, drawerBody);
  canvas.append(drawer);

  // Manija móvil para el panel de filtros
  const handle = el('div', { class: 'filters-handle', onclick: () => panel.classList.toggle('open') });
  panel.append(handle);

  // ---------- Construcción del panel de filtros ----------
  buildFilters(panel, species, stats, filters, apply);

  // ---------- Selección ----------
  let current = getTrees();
  function onSelect(props, feature) {
    props._coords = feature.geometry.coordinates.map(c => c.toFixed(5)).reverse().join(', ');
    drawerBody.innerHTML = '';
    drawerBody.append(buildFicha(props, {
      onVerMapa: () => { tm.flyToTree(feature); },
    }));
    openDrawer();
  }
  function openDrawer() { drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); }
  function closeDrawer() { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); }

  function setMode(mode) {
    tm.mode = mode;
    [...modeSeg.children].forEach((b, i) => b.classList.toggle('on', (mode === 'cluster') === (i === 0)));
    renderArbolado();
  }

  // La capa de arbolado se puede ocultar desde el panel de capas.
  function renderArbolado() {
    if (capasState.arbolado) tm.render(current, { onSelect });
    else tm._clearLayers();
  }

  function apply() {
    current = filterTrees(filters);
    const cnt = pillCount.querySelector('#mp-count');
    if (cnt) cnt.innerHTML = `<b>${fmt(current.length)}</b> de ${fmt(getTrees().length)} árboles`;
    renderArbolado();
    updateZone();
  }

  // ---------- Capas: mostrar / ocultar ----------
  async function mostrarCapa(capa, visible) {
    if (!visible) { capasState.visibles.delete(capa.id); tm.removeOverlay(capa.id); drawLayers(); return; }
    capasState.visibles.add(capa.id);
    drawLayers();
    try {
      if (!capasState.cache.has(capa.id)) {
        capasState.cargando.add(capa.id); drawLayers();
        capasState.cache.set(capa.id, await getCapaGeoJSON(capa));
      }
      if (capasState.visibles.has(capa.id) && tm.map) tm.addOverlay(capa.id, capasState.cache.get(capa.id), { color: capa.color, nombre: capa.nombre });
    } catch (e) {
      capasState.visibles.delete(capa.id);
      toast(`No se pudo cargar la capa "${capa.nombre}": ${e.message}`);
    } finally { capasState.cargando.delete(capa.id); drawLayers(); }
  }

  function setArbolado(visible) { capasState.arbolado = visible; renderArbolado(); drawLayers(); }

  const todasActivas = () => capasState.arbolado && capasState.capas.every(c => capasState.visibles.has(c.id));
  function toggleTodas() {
    const activar = !todasActivas();
    setArbolado(activar);
    capasState.capas.forEach(c => { if (capasState.visibles.has(c.id) !== activar) mostrarCapa(c, activar); });
  }

  function drawLayers() {
    layersPanel.innerHTML = '';
    const allOn = todasActivas();
    layersPanel.append(el('div', { class: 'layers-head' }, [
      el('strong', { text: 'Capas' }),
      el('button', { class: 'btn btn-sm ' + (allOn ? 'btn-ghost' : 'btn-primary'), text: allOn ? 'Desactivar todas' : 'Activar todas', onclick: toggleTodas }),
    ]));
    const fila = (id, nombre, detalle, color, checked, onChange, cargando) => el('label', { class: 'layer-row', for: `ly-${id}` }, [
      el('input', { type: 'checkbox', id: `ly-${id}`, checked: checked ? '' : null, onchange: e => onChange(e.target.checked) }),
      el('span', { class: 'layer-swatch', style: `background:${color}` }),
      el('span', { class: 'layer-name' }, [el('span', { text: nombre }), el('small', { class: 'muted', text: cargando ? 'cargando…' : detalle })]),
    ]);
    layersPanel.append(fila('arbolado', 'Arbolado', `${fmt(getTrees().length)} árboles`, '#3aa06a', capasState.arbolado, setArbolado));
    capasState.capas.forEach(c => layersPanel.append(
      fila(c.id, c.nombre, `${fmt(c.elementos || 0)} elementos · ${c.geometria || ''}`, c.color || '#2e7ab8',
        capasState.visibles.has(c.id), v => mostrarCapa(c, v), capasState.cargando.has(c.id)),
    ));
    if (!capasState.capas.length) layersPanel.append(el('p', { class: 'muted', style: 'font-size:.8rem;margin:8px 0 0', text: 'No hay capas importadas todavía.' }));
  }
  drawLayers();

  // Carga la lista de capas sin bloquear el mapa; las marcadas como visibles
  // por defecto se dibujan al llegar.
  Promise.race([listCapas(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))])
    .then(capas => {
      if (!tm.map) return;
      capasState.capas = capas || [];
      drawLayers();
      capasState.capas.filter(c => c.visible !== false).forEach(c => mostrarCapa(c, true));
    })
    .catch(() => { /* sin capas adicionales: solo arbolado */ });

  // Inteligencia de zona: cuenta lo visible al mover el mapa
  const updateZone = debounce(() => {
    const b = tm.map.getBounds();
    let n = 0; const sp = new Set();
    for (const f of current) {
      const [lon, lat] = f.geometry.coordinates;
      if (b.contains([lat, lon])) { n++; sp.add(f.properties.sp); }
    }
    const z = pillZone;
    if (tm.map.getZoom() >= 14 && n > 0) {
      z.hidden = false;
      z.innerHTML = `📍 En esta vista: <b style="margin:0 4px">${fmt(n)}</b> árboles · <b style="margin:0 4px">${sp.size}</b> especies`;
    } else z.hidden = true;
  }, 220);
  tm.map.on('moveend zoomend', updateZone);

  // Primera carga
  apply();
  if (params.especie) {
    const s = getSpeciesBySlug(params.especie);
    if (s) { toast(`Mostrando ${fmt(s.individuos)} · ${s.comun}`); tm.fitTo(current); }
  } else {
    tm.fitTo(current);
  }
  tm.invalidate();

  // atajo: cerrar drawer con Escape
  main._escHandler = e => { if (e.key === 'Escape') closeDrawer(); };
  document.addEventListener('keydown', main._escHandler);
}

function segBtn(label, on, onClick) {
  return el('button', { class: on ? 'on' : '', text: label, onclick: e => { onClick(); } });
}

// ---------- Panel de filtros ----------
function buildFilters(panel, species, stats, filters, apply) {
  panel.append(el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px' }, [
    el('strong', { html: `${ICON.leaf} Filtros` }),
    el('button', { class: 'btn btn-ghost btn-sm', text: 'Limpiar', onclick: () => { clearAll(); apply(); } }),
  ]));

  // --- Especies (con buscador) ---
  const realSpecies = species.filter(s => !s.es_no_especie);
  const gSpecies = group('Especie', true);
  const spSearch = el('input', { class: 'input', placeholder: 'Buscar especie…', style: 'margin-bottom:6px' });
  const spList = el('div', { style: 'max-height:230px;overflow-y:auto;display:flex;flex-direction:column;gap:1px' });
  const renderSp = (q = '') => {
    spList.innerHTML = '';
    const qn = q.toLowerCase();
    realSpecies.filter(s => !qn || s.comun.toLowerCase().includes(qn) || (s.cientifico || '').toLowerCase().includes(qn))
      .slice(0, 60).forEach(s => {
        const id = 'sp-' + s.slug;
        const row = el('label', { class: 'check' }, [
          el('input', { type: 'checkbox', id, checked: filters.species.has(s.slug) ? '' : null, onchange: e => { e.target.checked ? filters.species.add(s.slug) : filters.species.delete(s.slug); apply(); } }),
          el('span', { text: s.comun }),
          el('span', { class: 'n', text: fmt(s.individuos) }),
        ]);
        spList.append(row);
      });
  };
  spSearch.addEventListener('input', debounce(e => renderSp(e.target.value), 150));
  renderSp();
  gSpecies.body.append(spSearch, spList);
  panel.append(gSpecies.details);

  // --- Sector ---
  const gSector = group('Sector', true);
  stats.sectores.filter(s => s.n > 1).forEach(s => {
    gSector.body.append(el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', onchange: e => { e.target.checked ? filters.sectores.add(s.sector) : filters.sectores.delete(s.sector); apply(); } }),
      el('span', { text: s.sector }),
      el('span', { class: 'n', text: fmt(s.n) }),
    ]));
  });
  panel.append(gSector.details);

  // --- Altura ---
  const gH = group('Altura (m)');
  gH.body.append(rangeRow('hMin', 'hMax', filters, apply, 0, 40));
  panel.append(gH.details);

  // --- Diámetro (DAP) ---
  const gD = group('Diámetro DAP (cm)');
  gD.body.append(rangeRow('dMin', 'dMax', filters, apply, 0, 200));
  panel.append(gD.details);

  // --- Atributos ---
  const gA = group('Atributos');
  gA.body.append(
    el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', onchange: e => { filters.soloNativas = e.target.checked; apply(); } }),
      el('span', { text: 'Solo especies nativas' }),
    ]),
    el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', onchange: e => { filters.soloIdentificadas = e.target.checked; apply(); } }),
      el('span', { text: 'Solo identificadas botánicamente' }),
    ]),
  );
  panel.append(gA.details);

  panel.append(el('div', { class: 'muted', style: 'font-size:.78rem;padding:4px 2px', text: 'Los filtros actualizan el mapa en tiempo real.' }));

  function clearAll() {
    filters.species.clear(); filters.sectores.clear();
    filters.hMin = filters.hMax = filters.dMin = filters.dMax = null;
    filters.soloIdentificadas = filters.soloNativas = false;
    panel.querySelectorAll('input[type=checkbox]').forEach(c => (c.checked = false));
    panel.querySelectorAll('input[type=number]').forEach(c => (c.value = ''));
  }
}

function group(title, open = false) {
  const details = el('details', { class: 'filter-group', ...(open ? { open: '' } : {}) });
  const summary = el('summary', { text: title });
  const body = el('div', { class: 'filter-body' });
  details.append(summary, body);
  return { details, body };
}

function rangeRow(minKey, maxKey, filters, apply, lo, hi) {
  const onInput = debounce(apply, 350);
  const mkInput = (key, ph) => el('input', { type: 'number', min: lo, max: hi, placeholder: ph, oninput: e => { filters[key] = e.target.value === '' ? null : +e.target.value; onInput(); } });
  return el('div', { class: 'range-row' }, [mkInput(minKey, 'mín'), el('span', { class: 'muted', text: '—' }), mkInput(maxKey, 'máx')]);
}

export function cleanupMapa(main) {
  if (main._escHandler) document.removeEventListener('keydown', main._escHandler);
  if (main._map) { main._map.destroy(); main._map = null; }
}
