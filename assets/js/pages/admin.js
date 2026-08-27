// ============================================================================
// pages/admin.js — panel administrativo (sesión local de demostración)
// ============================================================================
import { el, esc, fmt, fmtNum, toast, store, debounce } from '../util.js';
import { getStats, getSpecies, getTrees } from '../data.js';
import { renderImage } from '../ui.js';

const ROLES = {
  admin: { name: 'Administrador', desc: 'Acceso completo', badge: 'green' },
  gis: { name: 'Técnico GIS', desc: 'Importa y edita información geográfica', badge: 'blue' },
  editor: { name: 'Editor', desc: 'Modifica registros', badge: 'blue' },
  consulta: { name: 'Consulta', desc: 'Solo lectura', badge: 'gray' },
};

// Credencial local por defecto (se puede cambiar desde el panel).
// NOTA: es una autenticación local del navegador, no una seguridad de producción.
const DEFAULT_CRED = { user: 'admin', pass: 'arbolado2026' };
const getCred = () => store.get('admin-cred', DEFAULT_CRED);

export function renderAdmin(main, params) {
  main.innerHTML = '';
  const session = store.get('admin-session');
  if (!session) { renderLogin(main); return; }
  renderShell(main, params?.section || 'resumen');
}

function renderLogin(main) {
  const card = el('div', { class: 'card login-card' }, [
    el('div', { style: 'text-align:center;margin-bottom:20px' }, [
      el('div', { style: 'font-size:40px', text: '🌳' }),
      el('h2', { style: 'margin:8px 0 2px', text: 'Panel de administración' }),
      el('p', { class: 'muted', style: 'margin:0', text: 'Sistema Inteligente de Arbolado Urbano' }),
    ]),
    el('label', { class: 'filter-title', text: 'Usuario' }),
    el('input', { class: 'input', id: 'adm-user', value: 'admin', style: 'margin:6px 0 12px' }),
    el('label', { class: 'filter-title', text: 'Contraseña' }),
    el('input', { class: 'input', id: 'adm-pass', type: 'password', placeholder: '••••••', style: 'margin:6px 0 6px', onkeydown: e => { if (e.key === 'Enter') document.getElementById('adm-login').click(); } }),
    el('div', { id: 'adm-error', class: 'muted', style: 'color:var(--red-500);font-size:.82rem;min-height:1.1em;margin-bottom:10px' }),
    el('button', { id: 'adm-login', class: 'btn btn-primary btn-block', text: 'Ingresar', onclick: () => {
      const u = document.getElementById('adm-user').value.trim();
      const p = document.getElementById('adm-pass').value;
      const rol = document.getElementById('adm-role').value;
      const cred = getCred();
      if (u.toLowerCase() === cred.user.toLowerCase() && p === cred.pass) {
        store.set('admin-session', { user: u, rol, ts: Date.now() });
        renderAdmin(main);
      } else {
        document.getElementById('adm-error').textContent = 'Usuario o contraseña incorrectos.';
      }
    } }),
    el('div', { style: 'margin-top:14px' }, [
      el('label', { class: 'filter-title', text: 'Rol' }),
      el('select', { class: 'select', id: 'adm-role', style: 'margin-top:6px' }, Object.entries(ROLES).map(([k, r]) => el('option', { value: k, text: r.name }))),
    ]),
    el('div', { class: 'callout callout-blue', style: 'margin-top:16px;font-size:.84rem' }, [
      el('span', { class: 'ci', text: '🔑' }),
      el('div', {}, [
        el('strong', { text: 'Acceso por defecto: ' }),
        el('code', { text: getCred().user }), ' / ', el('code', { text: 'arbolado2026' }),
        el('div', { style: 'margin-top:4px', text: 'Puedes cambiar la contraseña dentro del panel (Resumen → Cambiar contraseña).' }),
      ]),
    ]),
    el('div', { class: 'callout callout-amber', style: 'margin-top:12px;font-size:.82rem' }, [
      el('span', { class: 'ci', text: '🔐' }),
      'Autenticación local del navegador. En producción se usa un sistema seguro con contraseñas cifradas, JWT y control de acceso por rol (ver documentación de seguridad).',
    ]),
  ]);
  main.append(el('div', { class: 'wrap' }, [card]));
}

function renderShell(main, section) {
  const session = store.get('admin-session');
  const shell = el('div', { class: 'admin-shell' });
  const side = el('nav', { class: 'admin-side' });
  const nav = [
    ['resumen', '📊', 'Resumen'],
    ['arboles', '🌳', 'Árboles'],
    ['especies', '🌿', 'Especies e imágenes'],
    ['reportes', '📨', 'Reportes'],
    ['capas', '🗂️', 'Capas'],
    ['usuarios', '👥', 'Usuarios y roles'],
    ['importar', '📥', 'Importación'],
  ];
  nav.forEach(([k, i, l]) => side.append(el('a', { href: `#/admin/${k}`, class: section === k ? 'active' : '', html: `<span>${i}</span> ${l}` })));
  side.append(el('a', { href: '#/', style: 'margin-top:20px;color:var(--red-500)', html: '<span>↩</span> Salir', onclick: e => { e.preventDefault(); store.del('admin-session'); location.hash = '#/'; } }));

  const content = el('div', { class: 'admin-main' });
  const head = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:20px' }, [
    el('div', {}, [el('h2', { class: 'display', style: 'margin:0', text: nav.find(n => n[0] === section)?.[2] || 'Panel' })]),
    el('div', { style: 'display:flex;align-items:center;gap:10px' }, [
      el('span', { class: `badge badge-${ROLES[session.rol]?.badge || 'gray'}`, text: ROLES[session.rol]?.name || 'Usuario' }),
      el('span', { class: 'muted', style: 'font-size:.86rem', text: session.user }),
    ]),
  ]);
  content.append(head);
  ({ resumen, arboles, especies, reportes, capas, usuarios, importar }[section] || resumen)(content);
  shell.append(side, content);
  main.append(shell);
}

// ---------- Secciones ----------
function resumen(c) {
  const st = getStats();
  const grid = el('div', { class: 'kpi-grid' });
  grid.append(
    kpi(fmt(st.total_arboles), 'Árboles'), kpi(fmt(st.especies), 'Especies'),
    kpi(st.calidad + '%', 'Calidad'), kpi(fmt((store.get('reportes', [])).length), 'Reportes'),
  );
  c.append(grid);
  c.append(el('div', { class: 'callout callout-green' }, [
    el('span', { class: 'ci', text: '✓' }),
    el('div', {}, [el('strong', { text: 'Inventario publicado. ' }), `${fmt(st.total_arboles)} árboles y ${fmt(st.especies)} especies visibles en el mapa público. Última actualización: ${new Date().toLocaleDateString('es-CL')}.`]),
  ]));
  c.append(el('h3', { style: 'margin-top:24px', text: 'Acciones rápidas' }));
  c.append(el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
    el('a', { class: 'btn btn-primary', href: '#/importar', text: '📥 Importar datos' }),
    el('a', { class: 'btn btn-ghost', href: '#/admin/especies', text: '🌿 Gestionar imágenes' }),
    el('a', { class: 'btn btn-ghost', href: '#/estadisticas', text: '📊 Ver estadísticas' }),
    el('button', { class: 'btn btn-ghost', text: '🔑 Cambiar contraseña', onclick: cambiarPassword }),
  ]));
}

function arboles(c) {
  const all = getTrees();
  let page = 0, q = '';
  const perPage = 12;
  const search = el('input', { class: 'input', style: 'max-width:300px;margin-bottom:14px', placeholder: 'Buscar por código, especie o dirección…', oninput: debounce(e => { q = e.target.value.toLowerCase(); page = 0; draw(); }, 160) });
  c.append(search);
  const tableWrap = el('div', { style: 'overflow-x:auto' });
  const pager = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:14px' });
  c.append(tableWrap, pager);

  function filtered() {
    if (!q) return all;
    return all.filter(f => { const p = f.properties; return p.codigo.toLowerCase().includes(q) || p.e.toLowerCase().includes(q) || (p.dir || '').toLowerCase().includes(q); });
  }
  function draw() {
    const list = filtered();
    const slice = list.slice(page * perPage, page * perPage + perPage);
    const table = el('table', { class: 'data-table' });
    table.append(el('thead', {}, [el('tr', {}, ['Código', 'Especie', 'Sector', 'Altura', 'DAP', 'Estado', ''].map(h => el('th', { text: h })))]));
    const tb = el('tbody');
    slice.forEach(f => {
      const p = f.properties;
      tb.append(el('tr', {}, [
        el('td', {}, [el('strong', { text: p.codigo })]),
        el('td', { text: p.e }),
        el('td', { text: p.sec }),
        el('td', { text: fmtNum(p.hT, ' m') }),
        el('td', { text: fmtNum(p.dap, ' cm') }),
        el('td', {}, [el('span', { class: `badge badge-${p.ok ? 'green' : 'red'}`, text: p.ok ? 'OK' : 'revisar' })]),
        el('td', {}, [el('a', { href: `#/arbol/${p.id}`, text: 'Ver' })]),
      ]));
    });
    table.append(tb);
    tableWrap.innerHTML = ''; tableWrap.append(table);
    const pages = Math.ceil(list.length / perPage);
    pager.innerHTML = '';
    pager.append(
      el('span', { class: 'muted', style: 'font-size:.86rem', text: `${fmt(list.length)} árboles · página ${page + 1} de ${fmt(pages)}` }),
      el('div', { style: 'display:flex;gap:8px' }, [
        el('button', { class: 'btn btn-ghost btn-sm', text: '‹ Anterior', onclick: () => { if (page > 0) { page--; draw(); } } }),
        el('button', { class: 'btn btn-ghost btn-sm', text: 'Siguiente ›', onclick: () => { if (page < pages - 1) { page++; draw(); } } }),
      ]),
    );
  }
  draw();
}

function especies(c) {
  c.append(el('p', { class: 'muted', text: 'Gestión de la Biblioteca Botánica: asigna una fotografía real a cada especie con su fuente y licencia. Si no hay imagen, el sistema muestra una lámina generada (nunca la de otra especie).' }));
  const sp = getSpecies().filter(s => !s.es_no_especie);
  const overrides = store.get('img-overrides', {});
  const grid = el('div', { class: 'species-grid' });
  sp.slice(0, 24).forEach(s => {
    const thumb = el('div', { class: 'species-thumb' });
    renderImage(s, thumb, { size: 'card' });
    const has = overrides[s.slug];
    const card = el('article', { class: 'species-card' }, [
      thumb,
      el('div', { class: 'species-info' }, [
        el('div', { class: 'cn', text: s.comun }),
        el('div', { class: 'sn', text: s.cientifico || '—' }),
        el('div', { style: 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap' }, [
          el('span', { class: `badge badge-${has ? 'green' : 'gray'}`, text: has ? 'Imagen asignada' : 'Lámina generada' }),
        ]),
        el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:10px', text: has ? 'Cambiar imagen' : 'Asignar imagen', onclick: () => imageDialog(s) }),
      ]),
    ]);
    grid.append(card);
  });
  c.append(grid);
  c.append(el('div', { class: 'callout callout-blue', style: 'margin-top:20px' }, [
    el('span', { class: 'ci', text: '🖼️' }),
    'Prioridad de fuentes: (1) imagen del usuario → (2) banco de imágenes autorizado → (3) fuente externa con licencia → (4) generación por IA. La generación por IA usa el nombre científico como referencia y se etiqueta claramente.',
  ]));
}

function imageDialog(sp) {
  const url = prompt(`Asignar imagen a "${sp.comun}"\n\nPega la URL de una fotografía (con derechos de uso). Deja vacío para volver a la lámina generada:`, '');
  if (url === null) return;
  const overrides = store.get('img-overrides', {});
  if (!url.trim()) { delete overrides[sp.slug]; store.set('img-overrides', overrides); toast('Imagen restablecida a lámina generada'); }
  else {
    const fuente = prompt('Fuente / autor (para atribución y licencia):', 'Aportada por administrador') || '';
    overrides[sp.slug] = { url: url.trim(), fuente, licencia: '', fecha: new Date().toISOString() };
    store.set('img-overrides', overrides);
    toast('Imagen asignada a ' + sp.comun);
  }
  location.hash = '#/admin/especies';
  setTimeout(() => renderAdmin(document.getElementById('main'), { section: 'especies' }), 0);
}

function reportes(c) {
  const list = store.get('reportes', []);
  if (!list.length) { c.append(el('div', { class: 'empty-state', html: '<div class="es-ico">📭</div><p>No hay reportes ciudadanos pendientes.</p><p class="muted">Los reportes enviados desde la ficha de un árbol aparecerán aquí.</p>' })); return; }
  const table = el('table', { class: 'data-table' });
  table.append(el('thead', {}, [el('tr', {}, ['Fecha', 'Árbol', 'Tipo', 'Comentario', 'Estado', ''].map(h => el('th', { text: h })))]));
  const tb = el('tbody');
  list.slice().reverse().forEach(r => {
    tb.append(el('tr', {}, [
      el('td', { text: new Date(r.fecha).toLocaleDateString('es-CL') }),
      el('td', { text: r.arbol || '—' }),
      el('td', { text: r.tipo }),
      el('td', { text: (r.comentario || '—').slice(0, 40) }),
      el('td', {}, [el('span', { class: 'badge badge-amber', text: r.estado })]),
      el('td', {}, [el('button', { class: 'btn btn-ghost btn-sm', text: 'Resolver', onclick: () => { r.estado = 'resuelto'; store.set('reportes', list); toast('Reporte marcado como resuelto'); renderAdmin(document.getElementById('main'), { section: 'reportes' }); } })]),
    ]));
  });
  table.append(tb);
  c.append(el('div', { style: 'overflow-x:auto' }, [table]));
}

function capas(c) {
  const st = getStats();
  const capasList = [
    ['Arbolado', st.total_arboles, true], ['Sectores / Territorios', st.sectores.filter(s => s.n > 1).length, true],
    ['Calles', 0, false], ['Barrios', 0, false], ['Áreas verdes', 0, false], ['Plazas', 0, false], ['Equipamiento', 0, false], ['Infraestructura', 0, false],
  ];
  const table = el('table', { class: 'data-table' });
  table.append(el('thead', {}, [el('tr', {}, ['Capa', 'Elementos', 'Estado', 'Visible'].map(h => el('th', { text: h })))]));
  const tb = el('tbody');
  capasList.forEach(([n, cnt, avail]) => tb.append(el('tr', {}, [
    el('td', {}, [el('strong', { text: n })]),
    el('td', { text: avail ? fmt(cnt) : '—' }),
    el('td', {}, [el('span', { class: `badge badge-${avail ? 'green' : 'gray'}`, text: avail ? 'Disponible' : 'Sin datos' })]),
    el('td', {}, [avail ? el('input', { type: 'checkbox', checked: '', style: 'accent-color:var(--brand)' }) : el('span', { class: 'muted', text: '—' })]),
  ])));
  table.append(tb);
  c.append(el('div', { style: 'overflow-x:auto' }, [table]));
  c.append(el('p', { class: 'muted', style: 'margin-top:14px;font-size:.86rem', text: 'El administrador de capas permite activar/desactivar capas cargadas. Las capas sin datos se habilitan al importar sus fuentes correspondientes.' }));
}

function usuarios(c) {
  const demo = [
    ['María González', 'admin', 'activo'], ['Pedro Soto', 'gis', 'activo'], ['Ana Rivas', 'editor', 'activo'], ['Consulta Pública', 'consulta', 'activo'],
  ];
  const table = el('table', { class: 'data-table' });
  table.append(el('thead', {}, [el('tr', {}, ['Usuario', 'Rol', 'Permisos', 'Estado'].map(h => el('th', { text: h })))]));
  const tb = el('tbody');
  demo.forEach(([n, rk, s]) => tb.append(el('tr', {}, [
    el('td', {}, [el('strong', { text: n })]),
    el('td', {}, [el('span', { class: `badge badge-${ROLES[rk].badge}`, text: ROLES[rk].name })]),
    el('td', { text: ROLES[rk].desc }),
    el('td', {}, [el('span', { class: 'badge badge-green', text: s })]),
  ])));
  table.append(tb);
  c.append(el('div', { style: 'overflow-x:auto' }, [table]));
  c.append(el('div', { class: 'callout callout-amber', style: 'margin-top:16px' }, [el('span', { class: 'ci', text: '👥' }), 'Usuarios de demostración. El control de acceso por rol (Administrador, Técnico GIS, Editor, Consulta, Público) se implementa en el backend con autenticación segura.']));
}

function importar(c) {
  c.append(el('p', { class: 'muted', text: 'El asistente de importación de 5 pasos analiza, mapea, valida y publica datos GIS.' }));
  c.append(el('a', { class: 'btn btn-primary', href: '#/importar', text: '📥 Abrir asistente de importación' }));
}

function cambiarPassword() {
  const cred = getCred();
  const actual = prompt('Contraseña actual:');
  if (actual === null) return;
  if (actual !== cred.pass) { toast('La contraseña actual no coincide.'); return; }
  const nueva = prompt('Nueva contraseña (mínimo 6 caracteres):');
  if (nueva === null) return;
  if ((nueva || '').length < 6) { toast('La contraseña debe tener al menos 6 caracteres.'); return; }
  const user = prompt('Nombre de usuario:', cred.user) || cred.user;
  store.set('admin-cred', { user: user.trim(), pass: nueva });
  toast('Credencial actualizada. Úsala en el próximo inicio de sesión.');
}

function kpi(v, l) { return el('div', { class: 'kpi' }, [el('div', { class: 'kv', text: v }), el('div', { class: 'kl', text: l })]); }
