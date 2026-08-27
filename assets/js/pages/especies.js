// ============================================================================
// pages/especies.js — catálogo de especies
// ============================================================================
import { el, fmt, debounce } from '../util.js';
import { getSpecies } from '../data.js';
import { speciesCard, pageHeader } from '../ui.js';
import { footer } from './home.js';

export function renderEspecies(main) {
  main.innerHTML = '';
  const all = getSpecies();
  const section = el('section', { class: 'section' });
  const wrap = el('div', { class: 'wrap' });
  wrap.append(pageHeader('Catálogo de especies', `${fmt(all.filter(s => !s.es_no_especie).length)} especies identificadas en el inventario municipal.`));

  const state = { q: '', origen: 'todas', sort: 'individuos', soloReales: true };

  // Barra de controles
  const bar = el('div', { class: 'filters-bar' });
  const searchInput = el('input', { class: 'input', style: 'max-width:280px', type: 'search', placeholder: 'Buscar especie o nombre científico…', oninput: debounce(e => { state.q = e.target.value; draw(); }, 160) });
  const origenSel = el('select', { class: 'select', style: 'max-width:180px', onchange: e => { state.origen = e.target.value; draw(); } }, [
    el('option', { value: 'todas', text: 'Todos los orígenes' }),
    el('option', { value: 'Nativa', text: 'Nativas' }),
    el('option', { value: 'Introducida', text: 'Introducidas' }),
    el('option', { value: 'Ornamental', text: 'Ornamentales' }),
  ]);
  const sortSel = el('select', { class: 'select', style: 'max-width:190px', onchange: e => { state.sort = e.target.value; draw(); } }, [
    el('option', { value: 'individuos', text: 'Más individuos' }),
    el('option', { value: 'alfabetico', text: 'Alfabético' }),
    el('option', { value: 'altura', text: 'Mayor altura media' }),
  ]);
  const realChip = el('button', { class: 'chip on', text: 'Ocultar registros sin identificar', onclick: e => { state.soloReales = !state.soloReales; e.target.classList.toggle('on', state.soloReales); e.target.textContent = state.soloReales ? 'Ocultar registros sin identificar' : 'Mostrar todo'; draw(); } });
  bar.append(searchInput, origenSel, sortSel, realChip);
  wrap.append(bar);

  const counter = el('div', { class: 'muted', style: 'margin-bottom:14px;font-size:.88rem' });
  wrap.append(counter);
  const grid = el('div', { class: 'species-grid' });
  wrap.append(grid);

  function draw() {
    let list = all.slice();
    if (state.soloReales) list = list.filter(s => !s.es_no_especie);
    if (state.origen !== 'todas') list = list.filter(s => s.origen === state.origen);
    if (state.q) {
      const q = state.q.toLowerCase();
      list = list.filter(s => s.comun.toLowerCase().includes(q) || (s.cientifico || '').toLowerCase().includes(q) || (s.familia || '').toLowerCase().includes(q));
    }
    if (state.sort === 'alfabetico') list.sort((a, b) => a.comun.localeCompare(b.comun, 'es'));
    else if (state.sort === 'altura') list.sort((a, b) => (b.altura_promedio || 0) - (a.altura_promedio || 0));
    else list.sort((a, b) => b.individuos - a.individuos);

    counter.textContent = `${fmt(list.length)} especies · ${fmt(list.reduce((n, s) => n + s.individuos, 0))} individuos`;
    grid.innerHTML = '';
    if (!list.length) { grid.append(el('div', { class: 'empty-state', html: '<div class="es-ico">🔍</div><p>No hay especies que coincidan con la búsqueda.</p>' })); return; }
    list.forEach(s => grid.append(speciesCard(s)));
  }
  draw();

  section.append(wrap);
  main.append(section, footer());
}
