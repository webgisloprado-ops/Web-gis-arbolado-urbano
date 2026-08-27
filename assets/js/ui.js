// ============================================================================
// ui.js — componentes compartidos (ficha de árbol, tarjeta de especie)
// ============================================================================
import { el, esc, fmt, fmtNum, ICON, speciesImage, botanicalPlate, toast } from './util.js';
import { getSpeciesBySlug } from './data.js';

// Imagen renderizada (img o svg) dentro de un contenedor.
export function renderImage(sp, target, opts = {}) {
  const im = speciesImage(sp, opts);
  target.innerHTML = '';
  if (im.type === 'img') {
    const img = el('img', {
      src: im.src, alt: `${sp.comun}${sp.cientifico ? ', ' + sp.cientifico : ''}`,
      loading: opts.size === 'card' ? 'lazy' : 'eager', decoding: 'async',
    });
    // Si la foto real fallara, se recurre a la lámina generada (nunca otra especie).
    img.onerror = () => { target.innerHTML = botanicalPlate(sp, opts.size); };
    target.append(img);
  } else {
    target.insertAdjacentHTML('afterbegin', im.svg);
  }
  return im.source;
}

// ---- Tarjeta de especie ----
export function speciesCard(sp, onClick) {
  const card = el('article', { class: 'species-card', tabindex: '0', role: 'button', 'aria-label': `Ver especie ${sp.comun}` });
  const thumb = el('div', { class: 'species-thumb' });
  renderImage(sp, thumb, { size: 'card' });
  thumb.append(el('span', { class: 'count-badge', text: `${fmt(sp.individuos)} ind.` }));
  const info = el('div', { class: 'species-info' }, [
    el('div', { class: 'cn', text: sp.comun }),
    el('div', { class: 'sn', text: sp.cientifico || (sp.es_no_especie ? 'Registro sin identificar' : 'Sin nombre científico') }),
    el('div', { class: 'fm' }, [
      sp.familia ? el('span', { text: sp.familia }) : el('span', { class: 'muted', text: '—' }),
      sp.origen ? el('span', { class: `badge badge-${sp.origen === 'Nativa' ? 'green' : 'gray'}`, style: 'margin-left:8px', text: sp.origen }) : null,
    ]),
  ]);
  card.append(thumb, info);
  const go = () => onClick ? onClick(sp) : (location.hash = `#/especie/${sp.slug}`);
  card.addEventListener('click', go);
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  return card;
}

// ---- Ficha de árbol (contenido interno; se usa en drawer y en página /arbol) ----
export function buildFicha(props, { onVerMapa, compact = false } = {}) {
  const sp = getSpeciesBySlug(props.sp) || { comun: props.e, slug: props.sp, cientifico: props.sci, familia: props.fam };
  const wrap = el('div', { class: 'ficha-content' });

  const hero = el('div', { class: 'ficha-hero' });
  renderImage(sp, hero, { size: 'hero' });
  wrap.append(hero);

  const body = el('div', { class: 'ficha-body' });
  body.append(
    el('div', { class: 'badge badge-gray', style: 'margin-bottom:10px', text: props.codigo }),
    el('h3', { class: 'ficha-title', text: sp.comun }),
    el('div', { class: 'ficha-sci', text: sp.cientifico || 'Especie sin identificación científica' }),
  );

  const attrs = el('div', { class: 'ficha-attrs' });
  const attr = (icon, k, v) => el('div', { class: 'attr' }, [
    el('div', { class: 'k', html: `${icon}<span>${esc(k)}</span>` }),
    el('div', { class: 'v', text: v }),
  ]);
  attrs.append(
    attr(ICON.ruler, 'Altura', fmtNum(props.hT, ' m')),
    attr(ICON.tree, 'DAP', fmtNum(props.dap, ' cm')),
    attr(ICON.leaf, 'Copa', fmtNum(props.hC, ' m')),
    attr(ICON.pin, 'Sector', props.sec || '—'),
  );
  body.append(attrs);

  if (props.dir) body.append(el('div', { class: 'ficha-section' }, [
    el('h4', { text: 'Ubicación' }),
    el('p', { style: 'margin:0', html: `${ICON.pin} ${esc(props.dir)}` }),
    el('p', { class: 'muted', style: 'margin:4px 0 0;font-size:.82rem', text: `Coordenadas: ${props._coords || ''}` }),
  ]));

  if (sp.descripcion) body.append(el('div', { class: 'ficha-section' }, [
    el('h4', { text: 'Sobre esta especie' }),
    el('p', { style: 'margin:0;font-size:.92rem;color:var(--text-2)', text: sp.descripcion }),
  ]));

  // Meta botánica
  const meta = [];
  if (sp.familia) meta.push(['Familia', sp.familia]);
  if (sp.origen) meta.push(['Origen', sp.origen]);
  if (sp.follaje) meta.push(['Follaje', sp.follaje]);
  if (meta.length) {
    const g = el('div', { class: 'ficha-attrs', style: 'margin-top:8px' });
    meta.forEach(([k, v]) => g.append(el('div', { class: 'attr' }, [el('div', { class: 'k', text: k }), el('div', { class: 'v', style: 'font-size:.92rem', text: v })])));
    body.append(g);
  }

  const actions = el('div', { class: 'ficha-actions' });
  actions.append(
    el('a', { class: 'btn btn-primary btn-sm', href: `#/arbol/${props.id}`, html: '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg> Ver ficha completa' }),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => shareTree(props), html: '<svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4M12 2v13"/></svg> Compartir' }),
  );
  if (onVerMapa) actions.append(el('button', { class: 'btn btn-soft btn-sm', style: 'grid-column:1/-1', onclick: onVerMapa, html: `${ICON.pin} Centrar en el mapa` }));
  actions.append(el('a', { class: 'btn btn-ghost btn-sm', style: 'grid-column:1/-1', href: `#/reportar/${props.id}`, html: '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg> Reportar un problema' }));
  body.append(actions);

  wrap.append(body);
  return wrap;
}

export function shareTree(props) {
  const url = location.origin + location.pathname + `#/arbol/${props.id}`;
  const data = { title: `Árbol ${props.codigo} — ${props.e}`, text: `Ficha del árbol ${props.codigo}`, url };
  if (navigator.share) navigator.share(data).catch(() => {});
  else navigator.clipboard?.writeText(url).then(() => toast('Enlace copiado al portapapeles')).catch(() => toast(url));
}

// ---- Cabeceras de sección reutilizables ----
export function pageHeader(title, subtitle, actions) {
  return el('div', { class: 'section-head' }, [
    el('div', {}, [el('h2', { class: 'display', text: title }), subtitle ? el('p', { text: subtitle }) : null]),
    actions || null,
  ]);
}
