// ============================================================================
// pages/home.js — portada
// ============================================================================
import { el, fmt } from '../util.js';
import { loadData, getStats, getSpecies } from '../data.js';
import { speciesCard, pageHeader } from '../ui.js';
import { TreeMap } from '../map.js';

export async function renderHome(main) {
  main.innerHTML = '';
  const st = getStats();

  // ---- HERO ----
  const hero = el('section', { class: 'hero' });
  const inner = el('div', { class: 'wrap hero-inner' });
  const copy = el('div', { class: 'hero-copy' }, [
    el('span', { class: 'eyebrow', html: '🌳 Plataforma GIS de arbolado urbano' }),
    el('h1', { html: 'Explora, conoce y protege el <em>patrimonio arbóreo</em> de tu ciudad.' }),
    el('p', { class: 'lead', text: 'Un inventario forestal urbano interactivo: cada árbol georreferenciado, con su especie, su ficha botánica y su ubicación exacta.' }),
    el('div', { class: 'hero-cta' }, [
      el('a', { class: 'btn btn-primary', href: '#/mapa', html: '<svg viewBox="0 0 24 24"><path d="M9 20l-5.5 2V6L9 4m0 16l6-2m-6 2V4m6 14l5.5 2V4L15 6m0 12V6m0 0L9 4"/></svg> Explorar el mapa' }),
      el('a', { class: 'btn btn-ghost', href: '#/especies', html: '<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/></svg> Catálogo de especies' }),
      el('a', { class: 'btn btn-ghost', href: '#/estadisticas', html: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18M7 15l4-4 3 3 5-6"/></svg> Estadísticas' }),
    ]),
  ]);
  const visual = el('div', { class: 'hero-visual' });
  const mapDiv = el('div', { class: 'hero-map', id: 'hero-leaflet' });
  visual.append(mapDiv);
  const floatStat = el('div', { class: 'hero-stat-float' }, [
    el('b', { text: fmt(st.total_arboles) }),
    el('span', { text: 'árboles inventariados' }),
  ]);
  visual.append(floatStat);
  inner.append(copy, visual);
  hero.append(inner);

  // Franja de indicadores
  const strip = el('div', { class: 'wrap' }, [
    el('div', { class: 'hero-strip' }, [
      cell(fmt(st.total_arboles), 'Árboles'),
      cell(fmt(st.especies), 'Especies'),
      cell(fmt(st.familias), 'Familias'),
      cell(st.nativas_pct + '%', 'Nativas'),
    ]),
  ]);
  main.append(hero, strip);

  // ---- ¿Qué puedes hacer? ----
  const feats = el('section', { class: 'section section-alt' });
  const fwrap = el('div', { class: 'wrap' });
  fwrap.append(pageHeader('Una plataforma, muchas miradas', 'Del ciudadano curioso al equipo técnico municipal.'));
  const fgrid = el('div', { class: 'feature-grid' });
  [
    ['🗺️', 'Mapa interactivo', 'Miles de árboles con clustering, mapa de calor y capas base (callejero, satélite, topográfico).'],
    ['🔍', 'Búsqueda y filtros', 'Encuentra por especie, familia, código o dirección. Filtra por altura, diámetro y sector en tiempo real.'],
    ['📖', 'Fichas botánicas', 'Cada especie con su nombre científico, familia, origen y descripción. Cada árbol con su ficha individual.'],
    ['📊', 'Analítica', 'Panel con indicadores, distribución por especie, familia y sector, y un índice de calidad del inventario.'],
    ['📥', 'Importación GIS', 'Asistente que analiza archivos, mapea columnas y valida coordenadas antes de publicar.'],
    ['📱', 'Ciudadano y móvil', 'Vista simple para explorar, compartir un árbol por enlace o QR y reportar problemas.'],
  ].forEach(([i, t, d]) => fgrid.append(el('div', { class: 'feature' }, [
    el('div', { class: 'fico', text: i }), el('h3', { text: t }), el('p', { text: d }),
  ])));
  fwrap.append(fgrid);
  feats.append(fwrap);
  main.append(feats);

  // ---- Especies destacadas ----
  const sp = getSpecies().filter(s => !s.es_no_especie).slice(0, 5);
  const secSp = el('section', { class: 'section' });
  const spWrap = el('div', { class: 'wrap' });
  spWrap.append(pageHeader('Especies destacadas', 'Las más frecuentes en el inventario.',
    el('a', { class: 'btn btn-ghost btn-sm', href: '#/especies', text: 'Ver todo el catálogo →' })));
  const grid = el('div', { class: 'species-grid' });
  sp.forEach(s => grid.append(speciesCard(s)));
  spWrap.append(grid);
  secSp.append(spWrap);
  main.append(secSp);

  main.append(footer());

  // Mapa del hero (diferido)
  try {
    const tm = new TreeMap(mapDiv, { zoomControl: false, attribution: false });
    await tm.init([-33.475, -70.72], 12);
    tm.setBasemap('claro');
    const { getTrees } = await import('../data.js');
    tm.render(getTrees(), { fit: true });
    tm.invalidate();
    main._heroMap = tm;
  } catch (e) { mapDiv.style.background = 'var(--brand-soft)'; }
}

function cell(v, l) { return el('div', { class: 'cell' }, [el('b', { text: v }), el('span', { text: l })]); }

export function footer() {
  const f = el('footer', { class: 'foot' });
  f.append(el('div', { class: 'wrap foot-inner' }, [
    el('div', {}, [
      el('strong', { text: '🌳 Sistema Inteligente de Arbolado Urbano' }),
      el('div', { class: 'muted', style: 'margin-top:4px', text: 'Plataforma GIS de inventario forestal urbano.' }),
    ]),
    el('div', { style: 'text-align:right' }, [
      el('a', { href: '#/estadisticas', text: 'Estadísticas' }), ' · ',
      el('a', { href: '#/importar', text: 'Importar datos' }), ' · ',
      el('a', { href: '#/admin', text: 'Administración' }),
      el('div', { class: 'muted', style: 'margin-top:4px;font-size:.8rem', text: 'Datos: catastro municipal de arbolado (Prueba.aprx).' }),
    ]),
  ]));
  return f;
}
