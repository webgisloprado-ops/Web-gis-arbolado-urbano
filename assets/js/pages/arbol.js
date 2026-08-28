// ============================================================================
// pages/arbol.js — ficha individual del árbol (URL única + QR) y reporte
// ============================================================================
import { el, esc, fmt, fmtNum, ICON, toast, makeQR, store } from '../util.js';
import { getTreeById, getSpeciesBySlug } from '../data.js';
import { crearReporte, isConfigured } from '../backend.js';
import { renderImage, shareTree } from '../ui.js';
import { TreeMap } from '../map.js';
import { footer } from './home.js';

export async function renderArbol(main, params) {
  main.innerHTML = '';
  const f = getTreeById(params.id);
  if (!f) { notFound(main, 'Árbol no encontrado', 'No existe un árbol con ese identificador.'); return; }
  const p = f.properties;
  const sp = getSpeciesBySlug(p.sp) || { comun: p.e, slug: p.sp, cientifico: p.sci, familia: p.fam };
  const [lon, lat] = f.geometry.coordinates;

  const section = el('section', { class: 'section' });
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('a', { href: '#/mapa', class: 'muted', style: 'font-size:.88rem;display:inline-block;margin-bottom:16px', html: '← Volver al mapa' }));

  const grid = el('div', { style: 'display:grid;grid-template-columns:minmax(280px,380px) 1fr;gap:32px;align-items:start' });

  // Columna izquierda: imagen + QR
  const left = el('div', {});
  const img = el('div', { class: 'species-hero-img', style: 'aspect-ratio:1/1' });
  renderImage(sp, img, { size: 'hero' });
  left.append(img);
  const qrCard = el('div', { class: 'card card-pad', style: 'margin-top:16px;text-align:center' }, [
    el('div', { class: 'k', style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3);margin-bottom:10px', text: 'Código QR del árbol' }),
    el('div', { id: 'qr-box', style: 'display:flex;justify-content:center' }, [el('div', { class: 'skeleton', style: 'width:168px;height:168px' })]),
    el('div', { class: 'muted', style: 'font-size:.78rem;margin-top:10px', text: 'Escanéalo en terreno para abrir esta ficha.' }),
  ]);
  left.append(qrCard);
  grid.append(left);

  // Columna derecha: datos
  const right = el('div', {});
  right.append(
    el('span', { class: 'badge badge-gray', style: 'margin-bottom:10px', text: p.codigo }),
    el('h1', { class: 'display', style: 'margin-bottom:2px', text: sp.comun }),
    el('div', { style: 'font-style:italic;color:var(--text-2);font-size:1.15rem;margin-bottom:6px', text: sp.cientifico || 'Sin identificación científica' }),
  );
  const chips = el('div', { class: 'spec-meta' });
  if (sp.origen) chips.append(el('span', { class: `badge badge-${sp.origen === 'Nativa' ? 'green' : 'blue'}`, text: sp.origen }));
  if (sp.familia) chips.append(el('span', { class: 'badge badge-gray', text: sp.familia }));
  if (p.dup) chips.append(el('span', { class: 'badge badge-amber', text: '⚠ posible duplicado' }));
  chips.append(el('span', { class: `badge badge-${p.ok ? 'green' : 'red'}`, text: p.ok ? 'Coordenada válida' : 'Coordenada revisar' }));
  right.append(chips);

  // atributos
  const attrs = el('div', { class: 'def-grid', style: 'margin:18px 0' });
  const add = (icon, k, v) => attrs.append(el('div', { class: 'def' }, [el('div', { class: 'k', html: `${icon} ${esc(k)}` }), el('div', { class: 'v', text: v })]));
  add(ICON.ruler, 'Altura total', fmtNum(p.hT, ' m'));
  add(ICON.tree, 'DAP', fmtNum(p.dap, ' cm'));
  add(ICON.leaf, 'Altura de copa', fmtNum(p.hC, ' m'));
  add(ICON.pin, 'Sector', p.sec || '—');
  add(ICON.pin, 'Dirección', p.dir || '—');
  add(ICON.pin, 'Coordenadas', `${lat.toFixed(5)}, ${lon.toFixed(5)}`);
  right.append(attrs);

  if (sp.descripcion) right.append(el('div', {}, [
    el('h3', { style: 'font-size:1.05rem', text: 'Sobre esta especie' }),
    el('p', { class: 'muted', text: sp.descripcion }),
    el('a', { href: `#/especie/${sp.slug}`, text: 'Ver ficha completa de la especie →' }),
  ]));

  const actions = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:18px' }, [
    el('button', { class: 'btn btn-primary', onclick: () => shareTree(p), html: '<svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4M12 2v13"/></svg> Compartir' }),
    el('a', { class: 'btn btn-ghost', href: `#/reportar/${p.id}`, html: '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg> Reportar problema' }),
  ]);
  right.append(actions);
  grid.append(right);
  wrap.append(grid);

  // Mapa de ubicación
  wrap.append(el('h3', { style: 'margin-top:34px', text: 'Ubicación' }));
  const mapBox = el('div', { style: 'height:360px;border-radius:16px;overflow:hidden;border:1px solid var(--border);margin-top:12px' });
  const mapEl = el('div', { style: 'width:100%;height:100%' });
  mapBox.append(mapEl);
  wrap.append(mapBox);

  section.append(wrap);
  main.append(section, footer());

  // QR + mapa diferidos
  makeQR(location.origin + location.pathname + `#/arbol/${p.id}`).then(node => {
    const box = document.getElementById('qr-box'); if (box) { box.innerHTML = ''; box.append(node); }
  });
  try {
    const tm = new TreeMap(mapEl, {});
    await tm.init([lat, lon], 17);
    tm.render([f], {});
    tm.invalidate();
    main._map = tm;
  } catch (e) { mapEl.style.background = 'var(--brand-soft)'; }
}

// ---- Reporte ciudadano (queda pendiente de revisión; demo local) ----
export function renderReportar(main, params) {
  main.innerHTML = '';
  const f = getTreeById(params.id);
  const section = el('section', { class: 'section' });
  const wrap = el('div', { class: 'wrap', style: 'max-width:640px' });
  wrap.append(el('a', { href: f ? `#/arbol/${params.id}` : '#/mapa', class: 'muted', style: 'font-size:.88rem;display:inline-block;margin-bottom:16px', html: '← Volver' }));
  wrap.append(el('h1', { class: 'display', text: 'Reportar un problema' }));
  if (f) wrap.append(el('p', { class: 'muted', text: `Árbol ${f.properties.codigo} · ${f.properties.e} · ${f.properties.dir || 'sin dirección'}` }));

  const card = el('div', { class: 'card card-pad' });
  const tipo = el('select', { class: 'select', style: 'margin-bottom:12px' }, [
    'Árbol dañado', 'Árbol caído', 'Riesgo de caída', 'Enfermedad aparente', 'Interferencia con infraestructura', 'Falta de riego', 'Otro',
  ].map(t => el('option', { text: t })));
  const coment = el('textarea', { class: 'input', rows: '4', placeholder: 'Describe el problema…', style: 'resize:vertical' });
  const foto = el('input', { class: 'input', type: 'file', accept: 'image/*' });
  const ubic = el('label', { class: 'check', style: 'margin:10px 0' }, [el('input', { type: 'checkbox', checked: '' }), el('span', { text: 'Compartir la ubicación del árbol con el reporte' })]);
  card.append(
    el('label', { class: 'filter-title', text: 'Tipo de problema' }), tipo,
    el('label', { class: 'filter-title', text: 'Comentario' }), coment,
    el('label', { class: 'filter-title', style: 'margin-top:12px;display:block', text: 'Fotografía (opcional)' }), foto,
    ubic,
    el('div', { class: 'callout callout-blue', style: 'margin:8px 0 16px' }, [el('span', { class: 'ci', text: 'ℹ️' }), 'El reporte quedará pendiente de revisión por el equipo administrativo antes de publicarse.']),
    el('button', { class: 'btn btn-primary btn-block', text: 'Enviar reporte', onclick: async e => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Enviando…';
      const compartirUbic = ubic.querySelector('input').checked;
      const coords = (f && compartirUbic) ? f.geometry.coordinates : [null, null];
      const payload = {
        arbolId: f ? f.properties.id : null, arbolCodigo: f ? f.properties.codigo : null,
        tipo: tipo.value, comentario: coment.value, lon: coords[0], lat: coords[1],
      };
      try {
        if (await isConfigured()) await crearReporte(payload);
        else { const r = store.get('reportes', []); r.push({ id: Date.now(), arbol: payload.arbolCodigo, tipo: payload.tipo, comentario: payload.comentario, fecha: new Date().toISOString(), estado: 'pendiente' }); store.set('reportes', r); }
        toast('Reporte enviado. Quedó pendiente de revisión.');
        setTimeout(() => (location.hash = f ? `#/arbol/${params.id}` : '#/mapa'), 900);
      } catch (err) { toast('No se pudo enviar el reporte: ' + err.message); btn.disabled = false; btn.textContent = 'Enviar reporte'; }
    } }),
  );
  wrap.append(card);
  section.append(wrap);
  main.append(section, footer());
}

function notFound(main, title, msg) {
  main.append(el('div', { class: 'wrap section' }, [
    el('div', { class: 'empty-state', html: `<div class="es-ico">🌫️</div><h2>${esc(title)}</h2><p>${esc(msg)}</p>` }),
    el('div', { style: 'text-align:center' }, [el('a', { class: 'btn btn-primary', href: '#/mapa', text: 'Ir al mapa' })]),
  ]));
}
