// ============================================================================
// pages/especie.js — página individual de especie
// ============================================================================
import { el, esc, fmt, fmtNum, toast } from '../util.js';
import { getSpeciesBySlug, getTreesBySpecies, getSpecies } from '../data.js';
import { renderImage, speciesCard, pageHeader } from '../ui.js';
import { TreeMap } from '../map.js';
import { footer } from './home.js';

export async function renderEspecie(main, params) {
  main.innerHTML = '';
  const sp = getSpeciesBySlug(params.slug);
  if (!sp) { notFound(main); return; }

  const section = el('section', { class: 'section' });
  const wrap = el('div', { class: 'wrap' });

  wrap.append(el('a', { href: '#/especies', class: 'muted', style: 'font-size:.88rem;display:inline-block;margin-bottom:16px', html: '← Volver al catálogo' }));

  // ---- Hero ----
  const heroImg = el('div', { class: 'species-hero-img' });
  const source = renderImage(sp, heroImg, { size: 'hero' });
  const heroInfo = el('div', {}, [
    el('h1', { class: 'display', style: 'margin-bottom:2px', text: sp.comun }),
    el('div', { style: 'font-style:italic;color:var(--text-2);font-size:1.15rem', text: sp.cientifico || 'Especie sin identificación científica confirmada' }),
    metaChips(sp),
    el('p', { style: 'margin-top:14px;color:var(--text-2);max-width:60ch', text: sp.descripcion || 'No se dispone de una descripción botánica validada para este registro. Los datos científicos no se completan cuando la identificación no es fiable.' }),
    el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:8px' }, [
      el('a', { class: 'btn btn-primary', href: `#/mapa?especie=${sp.slug}`, html: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg> Ver en el mapa' }),
      el('button', { class: 'btn btn-ghost', onclick: () => { navigator.clipboard?.writeText(location.href).then(() => toast('Enlace copiado')); }, html: '<svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4M12 2v13"/></svg> Compartir' }),
    ]),
  ]);
  const hero = el('div', { class: 'species-hero' }, [heroImg, heroInfo]);
  wrap.append(hero);

  // fuente / atribución de la imagen
  wrap.append(imageCredit(source));

  // ---- Definiciones ----
  const defs = el('div', { class: 'def-grid' });
  const addDef = (k, v) => { if (v) defs.append(el('div', { class: 'def' }, [el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v })])); };
  addDef('Individuos', fmt(sp.individuos));
  addDef('Familia', sp.familia);
  addDef('Origen', sp.origen);
  addDef('Follaje', sp.follaje);
  addDef('Porte', sp.porte);
  addDef('Altura máxima', sp.altura_max);
  addDef('Req. hídrico', sp.hidrico);
  addDef('Floración', sp.floracion);
  addDef('Altura media (catastro)', sp.altura_promedio ? sp.altura_promedio + ' m' : null);
  addDef('DAP medio (catastro)', sp.dap_promedio ? sp.dap_promedio + ' cm' : null);
  if (defs.children.length) wrap.append(defs);

  if (sp.ecologia) wrap.append(el('div', { class: 'callout callout-green', style: 'margin:6px 0 20px' }, [
    el('span', { class: 'ci', text: '🌿' }), el('div', {}, [el('strong', { text: 'Valor ecológico. ' }), sp.ecologia]),
  ]));

  // ---- Distribución por sector ----
  if (sp.sectores && sp.sectores.length) {
    wrap.append(el('h3', { style: 'margin-top:10px', text: 'Distribución por sector' }));
    const maxN = Math.max(...sp.sectores.map(s => s.n));
    const bars = el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin:10px 0 24px' });
    sp.sectores.forEach(s => bars.append(el('div', { style: 'display:flex;align-items:center;gap:12px' }, [
      el('div', { style: 'width:120px;font-size:.88rem', text: s.sector }),
      el('div', { style: 'flex:1;background:var(--surface-2);border-radius:8px;overflow:hidden;height:22px' }, [
        el('div', { style: `width:${(s.n / maxN * 100).toFixed(1)}%;height:100%;background:var(--brand);border-radius:8px` }),
      ]),
      el('div', { style: 'width:60px;text-align:right;font-weight:600;font-size:.9rem', text: fmt(s.n) }),
    ])));
    wrap.append(bars);
  }

  // ---- Mapa: dónde se encuentra ----
  wrap.append(pageHeader('Dónde se encuentra esta especie', `Ubicación de los ${fmt(sp.individuos)} individuos registrados.`));
  const mapBox = el('div', { style: 'height:420px;border-radius:16px;overflow:hidden;border:1px solid var(--border);box-shadow:var(--shadow-sm)' });
  const mapEl = el('div', { style: 'width:100%;height:100%' });
  mapBox.append(mapEl);
  wrap.append(mapBox);

  // ---- Especies relacionadas (misma familia) ----
  const related = getSpecies().filter(s => s.familia && s.familia === sp.familia && s.slug !== sp.slug && !s.es_no_especie).slice(0, 5);
  if (related.length) {
    wrap.append(el('h3', { style: 'margin-top:34px', text: `Otras especies de ${sp.familia}` }));
    const grid = el('div', { class: 'species-grid', style: 'margin-top:14px' });
    related.forEach(s => grid.append(speciesCard(s)));
    wrap.append(grid);
  }

  section.append(wrap);
  main.append(section, footer());

  // init mapa diferido
  try {
    const tm = new TreeMap(mapEl, { zoomControl: true });
    await tm.init();
    tm.setBasemap('claro');
    const feats = getTreesBySpecies(sp.slug);
    tm.render(feats, { fit: true, onSelect: (p, f) => { location.hash = `#/arbol/${p.id}`; } });
    tm.invalidate();
    main._map = tm;
  } catch (e) { mapEl.style.background = 'var(--brand-soft)'; }
}

function imageCredit(source) {
  const box = el('div', { class: 'muted', style: 'font-size:.76rem;margin-top:8px' });
  if (source.kind === 'wikimedia') {
    box.append('📷 Fotografía real · ');
    box.append(el('a', { href: source.page, target: '_blank', rel: 'noopener', text: source.fuente || 'Wikimedia Commons' }));
    box.append(` · ${source.autor || 'Autor no especificado'} · ${source.licencia || 'CC'}`);
  } else if (source.kind === 'usuario') {
    box.textContent = `Imagen aportada · Fuente: ${source.fuente || 'administrador'}${source.licencia ? ' · ' + source.licencia : ''}`;
  } else {
    box.textContent = 'Imagen: lámina botánica generada por el sistema (esquemática, no fotográfica). Aún no se encontró una fotografía real con licencia para esta especie.';
  }
  return box;
}

function metaChips(sp) {
  const c = el('div', { class: 'spec-meta' });
  if (sp.origen) c.append(el('span', { class: `badge badge-${sp.origen === 'Nativa' ? 'green' : 'blue'}`, text: sp.origen }));
  if (sp.follaje) c.append(el('span', { class: 'badge badge-gray', text: sp.follaje }));
  if (sp.familia) c.append(el('span', { class: 'badge badge-gray', text: sp.familia }));
  c.append(el('span', { class: 'badge badge-green', text: `${fmt(sp.individuos)} individuos` }));
  return c;
}

function notFound(main) {
  main.append(el('div', { class: 'wrap section' }, [
    el('div', { class: 'empty-state', html: '<div class="es-ico">🌫️</div><h2>Especie no encontrada</h2><p>El identificador no corresponde a ninguna especie del catálogo.</p>' }),
    el('div', { style: 'text-align:center' }, [el('a', { class: 'btn btn-primary', href: '#/especies', text: 'Ir al catálogo' })]),
  ]));
}
