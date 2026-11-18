// ============================================================================
// pages/admin.js — panel administrativo
// ----------------------------------------------------------------------------
// Con Firebase configurado: login real (Firebase Auth), CRUD sobre Firestore
// con trazabilidad y borrado lógico, gestión de imágenes de especies, revisión
// de reportes, auditoría y publicación del snapshot público.
// Sin Firebase: modo demostración local (etiquetado), para poder navegar el
// panel sin conexión a un proyecto.
// ============================================================================
import { el, esc, fmt, fmtNum, toast, store, debounce, slugify } from '../util.js';
import { getStats, getSpecies, getTrees, reloadData } from '../data.js';
import { renderImage } from '../ui.js';
import * as db from '../backend.js';
import { isConfigured, login as fbLogin, logout as fbLogout, currentUser, getUserRole } from '../backend.js';

// Fecha de un valor que puede venir como Timestamp de Firestore o ISO/Date.
const aFecha = v => v == null ? null : (v.toDate ? v.toDate() : new Date(v));

const ROLES = {
  superadmin: { name: 'Superadministrador', desc: 'Todo, incluida la gestión de usuarios', badge: 'green' },
  admin: { name: 'Administrador', desc: 'Importa capas, publica y edita', badge: 'green' },
  gis: { name: 'Técnico GIS', desc: 'Edita información geográfica (sin importar)', badge: 'blue' },
  editor: { name: 'Editor', desc: 'Modifica registros', badge: 'blue' },
  consulta: { name: 'Consulta', desc: 'Solo lectura', badge: 'gray' },
};
const ESTADOS = { activo: ['Activo', 'green'], inactivo: ['Inactivo', 'amber'], eliminado: ['Eliminado', 'red'] };
const puedeEscribir = rol => db.ROLES_ESCRITURA.includes(rol);
const esAdminPleno = rol => rol === 'admin' || rol === 'superadmin';
const esSuper = rol => rol === 'superadmin';
const avisarCambioPerfil = () => window.dispatchEvent(new CustomEvent('perfil-cambio'));

// Credencial local por defecto (SOLO modo demostración sin Firebase).
const DEFAULT_CRED = { user: 'admin', pass: 'arbolado2026' };
const getCred = () => store.get('admin-cred', DEFAULT_CRED);

let _ctx = { configured: false, backend: 'estatico', user: null, rol: 'consulta' };
const nombreBackend = b => ({ firebase: 'Firebase', estatico: 'datos estáticos' }[b] || b);

export async function renderAdmin(main, params) {
  main.innerHTML = '<div class="loader-full"><div class="spinner"></div><p>Cargando panel…</p></div>';
  _ctx.backend = await db.getBackend();
  _ctx.configured = _ctx.backend !== 'estatico';

  // Si el usuario navegó a otra página mientras se cargaba, no dibujar.
  const sigueAqui = () => /^#\/admin/.test(location.hash);
  if (_ctx.configured) {
    _ctx.user = await currentUser();
    if (!sigueAqui()) return;
    if (!_ctx.user) { renderLogin(main); return; }
    _ctx.perfil = await db.getPerfil(_ctx.user);
    if (!sigueAqui()) return;
    if (!_ctx.perfil || (_ctx.perfil.estado && _ctx.perfil.estado !== 'activo')) {
      // Sesión abierta de una cuenta sin perfil o desactivada: se cierra.
      await fbLogout(); avisarCambioPerfil();
      renderLogin(main, 'Tu cuenta no tiene acceso activo. Contacta a un superadministrador.');
      return;
    }
    _ctx.rol = _ctx.perfil.rol || 'consulta';
    // Primer ingreso: obligatorio cambiar la contraseña temporal.
    if (_ctx.perfil.debeCambiarPassword) { renderCambioObligatorio(main); return; }
  } else {
    const session = store.get('admin-session');
    if (!session) { renderLogin(main); return; }
    _ctx.user = { email: session.user, uid: 'local' };
    _ctx.rol = session.rol || 'admin';
  }
  renderShell(main, params?.section || 'resumen');
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
function renderLogin(main, aviso = '') {
  main.innerHTML = '';
  const err = el('div', { id: 'adm-error', class: 'muted', style: 'color:var(--red-500);font-size:.82rem;min-height:1.1em;margin-bottom:10px', text: aviso });
  const userInput = el('input', { class: 'input', id: 'adm-user', type: _ctx.configured ? 'email' : 'text', value: _ctx.configured ? '' : 'admin', placeholder: _ctx.configured ? 'correo@ejemplo.com' : 'usuario', style: 'margin:6px 0 12px' });
  const passInput = el('input', { class: 'input', id: 'adm-pass', type: 'password', placeholder: '••••••', style: 'margin:6px 0 6px', onkeydown: e => { if (e.key === 'Enter') loginBtn.click(); } });

  const loginBtn = el('button', { id: 'adm-login', class: 'btn btn-primary btn-block', text: 'Ingresar', onclick: async () => {
    const u = userInput.value.trim(), p = passInput.value;
    err.textContent = '';
    if (_ctx.configured) {
      loginBtn.disabled = true; loginBtn.textContent = 'Verificando…';
      try { await fbLogin(u, p); avisarCambioPerfil(); await renderAdmin(main, { section: 'resumen' }); }
      catch (e2) { err.textContent = traducirError(e2.message); loginBtn.disabled = false; loginBtn.textContent = 'Ingresar'; }
    } else {
      const cred = getCred();
      if (u.toLowerCase() === cred.user.toLowerCase() && p === cred.pass) {
        store.set('admin-session', { user: u, rol: roleSel.value, ts: Date.now() });
        renderAdmin(main);
      } else err.textContent = 'Usuario o contraseña incorrectos.';
    }
  } });

  const roleSel = el('select', { class: 'select', id: 'adm-role', style: 'margin-top:6px' },
    Object.entries(ROLES).map(([k, r]) => el('option', { value: k, text: r.name })));

  const card = el('div', { class: 'card login-card' }, [
    el('div', { style: 'text-align:center;margin-bottom:20px' }, [
      el('div', { style: 'font-size:40px', text: '🌳' }),
      el('h2', { style: 'margin:8px 0 2px', text: 'Panel de administración' }),
      el('p', { class: 'muted', style: 'margin:0', text: 'Sistema Inteligente de Arbolado Urbano' }),
    ]),
    el('label', { class: 'filter-title', text: _ctx.configured ? 'Correo electrónico' : 'Usuario' }), userInput,
    el('label', { class: 'filter-title', text: 'Contraseña' }), passInput,
    err, loginBtn,
    // El selector de rol solo aplica al modo demostración local.
    _ctx.configured ? null : el('div', { style: 'margin-top:14px' }, [
      el('label', { class: 'filter-title', text: 'Rol (demostración)' }), roleSel,
    ]),
    _ctx.configured
      ? el('div', { class: 'callout callout-green', style: 'margin-top:16px;font-size:.84rem' }, [
          el('span', { class: 'ci', text: '🔐' }),
          el('div', {}, [el('strong', { text: `Autenticación segura (${nombreBackend(_ctx.backend)}). ` }), 'Ingresa con el usuario administrador configurado en el backend. Los permisos dependen del rol asignado.']),
        ])
      : el('div', { class: 'callout callout-amber', style: 'margin-top:16px;font-size:.82rem' }, [
          el('span', { class: 'ci', text: '⚠️' }),
          el('div', {}, [el('strong', { text: 'Modo demostración local. ' }), 'No hay backend configurado. Acceso por defecto: ', el('code', { text: getCred().user }), ' / ', el('code', { text: 'arbolado2026' }), '. Conecta Firebase (docs/FIREBASE.md) para seguridad real.']),
        ]),
  ]);
  main.append(el('div', { class: 'wrap' }, [card]));
}

function traducirError(msg = '') {
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/too-many-requests/i.test(msg)) return 'Demasiados intentos. Espera unos minutos.';
  if (/email-already-in-use/i.test(msg)) return 'Ya existe una cuenta con ese correo.';
  if (/invalid-email/i.test(msg)) return 'El correo no es válido.';
  if (/weak-password/i.test(msg)) return 'La contraseña es demasiado débil (mínimo 8 caracteres).';
  if (/requires-recent-login/i.test(msg)) return 'Por seguridad, vuelve a iniciar sesión e inténtalo de nuevo.';
  if (/permission-denied|insufficient permissions/i.test(msg)) return 'No tienes permiso para esta acción.';
  return msg || 'No se pudo completar la operación.';
}

// ---------------------------------------------------------------------------
// Cambio de contraseña (obligatorio en el primer ingreso y desde "Mi cuenta")
// ---------------------------------------------------------------------------
function formCambioPassword({ onDone, botonTexto = 'Cambiar contraseña' } = {}) {
  const err = el('div', { style: 'color:var(--red-500);font-size:.82rem;min-height:1.1em;margin:6px 0' });
  const actual = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', style: 'margin:6px 0 12px' });
  const nueva = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Mínimo 8 caracteres', style: 'margin:6px 0 12px' });
  const repetir = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', style: 'margin:6px 0 6px' });
  const btn = el('button', { class: 'btn btn-primary btn-block', text: botonTexto, onclick: async () => {
    err.textContent = '';
    if (nueva.value !== repetir.value) { err.textContent = 'Las contraseñas nuevas no coinciden.'; return; }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try { await db.cambiarPassword(actual.value, nueva.value); toast('Contraseña actualizada.'); onDone && onDone(); }
    catch (e) { err.textContent = traducirError(e.message); btn.disabled = false; btn.textContent = botonTexto; }
  } });
  return el('div', {}, [
    el('label', { class: 'filter-title', text: 'Contraseña actual' }), actual,
    el('label', { class: 'filter-title', text: 'Nueva contraseña' }), nueva,
    el('label', { class: 'filter-title', text: 'Repite la nueva contraseña' }), repetir,
    err, btn,
  ]);
}

function renderCambioObligatorio(main) {
  main.innerHTML = '';
  const card = el('div', { class: 'card login-card' }, [
    el('div', { style: 'text-align:center;margin-bottom:16px' }, [
      el('div', { style: 'font-size:40px', text: '🔑' }),
      el('h2', { style: 'margin:8px 0 2px', text: 'Cambia tu contraseña' }),
      el('p', { class: 'muted', style: 'margin:0', text: 'Es tu primer ingreso: reemplaza la contraseña temporal que te entregaron por una propia.' }),
    ]),
    formCambioPassword({ botonTexto: 'Guardar y entrar', onDone: () => renderAdmin(main, { section: 'resumen' }) }),
    el('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:10px', text: 'Cerrar sesión', onclick: async () => { await fbLogout(); avisarCambioPerfil(); renderLogin(main); } }),
  ]);
  main.append(el('div', { class: 'wrap' }, [card]));
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
function renderShell(main, section) {
  main.innerHTML = '';
  const shell = el('div', { class: 'admin-shell' });
  const side = el('nav', { class: 'admin-side' });
  const rol = _ctx.rol;
  const nav = [
    ['resumen', '📊', 'Resumen', true],
    ['arboles', '🌳', 'Árboles', true],
    ['especies', '🌿', 'Especies e imágenes', true],
    ['capas', '🗂️', 'Capas', true],
    ['reportes', '📨', 'Reportes', true],
    ['auditoria', '🧾', 'Auditoría', esAdminPleno(rol) || !_ctx.configured],
    ['usuarios', '👥', 'Usuarios y roles', esAdminPleno(rol) || !_ctx.configured],
    ['importar', '📥', 'Importación', db.puedeImportar(rol) || !_ctx.configured],
    ['cuenta', '🔑', 'Mi cuenta', _ctx.configured],
  ].filter(n => n[3]);
  if (!nav.some(n => n[0] === section)) section = 'resumen';
  nav.forEach(([k, i, l]) => side.append(el('a', { href: `#/admin/${k}`, class: section === k ? 'active' : '', html: `<span>${i}</span> ${l}` })));
  side.append(el('a', { href: '#/', style: 'margin-top:20px;color:var(--red-500)', html: '<span>↩</span> Salir', onclick: async e => {
    e.preventDefault();
    if (_ctx.configured) await fbLogout(); else store.del('admin-session');
    _ctx.user = null; avisarCambioPerfil(); location.hash = '#/';
  } }));

  const content = el('div', { class: 'admin-main' });
  const head = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:20px' }, [
    el('h2', { class: 'display', style: 'margin:0', text: nav.find(n => n[0] === section)?.[2] || 'Panel' }),
    el('div', { style: 'display:flex;align-items:center;gap:10px' }, [
      el('span', { class: `badge badge-${ROLES[_ctx.rol]?.badge || 'gray'}`, text: ROLES[_ctx.rol]?.name || 'Usuario' }),
      el('span', { class: 'muted', style: 'font-size:.86rem', text: _ctx.user?.email || 'usuario' }),
      _ctx.configured ? null : el('span', { class: 'badge badge-amber', text: 'demo local' }),
    ]),
  ]);
  content.append(head);
  const region = el('div', { id: 'adm-region' });
  content.append(region);
  shell.append(side, content);
  main.append(shell);

  const fn = { resumen, arboles, especies, capas, reportes, auditoria, usuarios, importar, cuenta }[section] || resumen;
  runSection(region, fn);
}

async function runSection(region, fn) {
  region.innerHTML = '<div style="padding:40px;text-align:center"><div class="spinner"></div></div>';
  try { region.innerHTML = ''; await fn(region); }
  catch (e) {
    region.innerHTML = '';
    region.append(el('div', { class: 'callout callout-amber' }, [el('span', { class: 'ci', text: '⚠️' }), el('div', {}, [el('strong', { text: 'No se pudo cargar la sección. ' }), esc(e.message)])]));
    console.error(e);
  }
}

const reload = section => renderAdmin(document.getElementById('main'), { section });

// ---------------------------------------------------------------------------
// Resumen + Publicar snapshot
// ---------------------------------------------------------------------------
async function resumen(c) {
  const st = getStats();
  const nReportes = _ctx.configured ? (await db.listReportes('pendiente')).length : (store.get('reportes', [])).length;
  const grid = el('div', { class: 'kpi-grid' });
  grid.append(
    kpi(fmt(st.total_arboles), 'Árboles publicados'), kpi(fmt(st.especies), 'Especies'),
    kpi(st.calidad + '%', 'Calidad'), kpi(fmt(nReportes), 'Reportes pendientes'),
  );
  c.append(grid);

  c.append(el('div', { class: `callout callout-${_ctx.configured ? 'green' : 'amber'}`, style: 'margin-top:16px' }, [
    el('span', { class: 'ci', text: _ctx.configured ? '☁️' : '⚠️' }),
    el('div', {}, _ctx.configured
      ? [el('strong', { text: `Conectado a ${nombreBackend(_ctx.backend)}. ` }), 'Los cambios que hagas aquí se guardan en la base de datos con trazabilidad. La vista pública lee el último snapshot publicado.']
      : [el('strong', { text: 'Modo demostración local. ' }), 'No hay backend configurado; los datos provienen de los archivos estáticos. Sigue ', el('a', { href: '#/admin/resumen', text: 'docs/FIREBASE.md' }), ' para conectar la base de datos.']),
  ]));

  // Carga inicial del catastro base (datos/) a Firestore — solo una vez.
  if (_ctx.configured && esAdminPleno(_ctx.rol)) {
    let estado = { completado: true };
    try { estado = await db.estadoCargaBase(); } catch { /* sin permisos de lectura de meta */ }
    if (!estado.completado) {
      const box = el('div', { class: 'callout callout-blue', style: 'margin-top:24px;display:block' });
      const status = el('div', { class: 'muted', style: 'font-size:.86rem;margin-top:8px' });
      const btn = el('button', { class: 'btn btn-primary', style: 'margin-top:10px', text: '🌳 Cargar catastro base en Firestore', onclick: async () => {
        btn.disabled = true; btn.textContent = 'Cargando…';
        try {
          const r = await db.cargarCatastroBase({ onProgress: p => {
            status.textContent = p.fase === 'especies' ? `Especies cargadas: ${fmt(p.n)}` : `Árboles: ${fmt(p.n)} de ${fmt(p.total)}…`;
          } });
          status.innerHTML = `<span style="color:var(--green-600,#16a34a)">✓ Cargados ${fmt(r.arboles)} árboles y ${fmt(r.especies)} especies. Ahora pulsa "Publicar snapshot".</span>`;
          btn.remove();
        } catch (e) {
          status.innerHTML = `<span style="color:var(--red-500)">Error: ${esc(e.message)}. Puedes volver a pulsar: continúa donde quedó.</span>`;
          btn.disabled = false; btn.textContent = '🌳 Continuar carga del catastro base';
        }
      } });
      box.append(
        el('strong', { text: 'Firestore está vacío. ' }),
        'Carga los 17.179 árboles y las especies del catastro base para poder editarlos aquí. Tarda unos minutos; no cierres la pestaña. Si se interrumpe, vuelve a pulsar y continúa donde quedó.',
        el('div', {}, [btn]), status,
      );
      c.append(box);
    }
  }

  if (_ctx.configured && (esAdminPleno(_ctx.rol) || _ctx.rol === 'gis')) {
    c.append(el('h3', { style: 'margin-top:24px', text: 'Publicación' }));
    c.append(el('p', { class: 'muted', style: 'margin-top:4px', text: 'Regenera el snapshot público (mapa, catálogo y estadísticas) a partir del estado actual de Firestore. Hazlo después de importar o editar.' }));
    const pubBox = el('div', { style: 'margin-top:8px' });
    const pubBtn = el('button', { class: 'btn btn-primary', html: '☁️ Publicar snapshot', onclick: async () => {
      pubBtn.disabled = true; pubBtn.textContent = 'Publicando…';
      const status = el('div', { class: 'muted', style: 'font-size:.86rem;margin-top:8px' });
      pubBox.append(status);
      try {
        const res = await db.publishSnapshot({ onProgress: p => { status.textContent = p.fase === 'arboles' ? `Leyendo árboles… ${fmt(p.n)}` : 'Subiendo snapshot…'; } });
        status.innerHTML = `<span style="color:var(--green-600,#16a34a)">✓ Publicado: ${fmt(res.arboles)} árboles y ${fmt(res.especies)} especies.</span>`;
        await reloadData();
        toast('Snapshot publicado. La vista pública ya está actualizada.');
      } catch (e) { status.innerHTML = `<span style="color:var(--red-500)">Error: ${esc(e.message)}</span>`; }
      finally { pubBtn.disabled = false; pubBtn.innerHTML = '☁️ Publicar snapshot'; }
    } });
    pubBox.prepend(pubBtn);
    c.append(pubBox);
  }

  c.append(el('h3', { style: 'margin-top:24px', text: 'Acciones rápidas' }));
  c.append(el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
    el('a', { class: 'btn btn-primary', href: '#/importar', text: '📥 Importar datos' }),
    el('a', { class: 'btn btn-ghost', href: '#/admin/especies', text: '🌿 Gestionar imágenes' }),
    el('a', { class: 'btn btn-ghost', href: '#/estadisticas', text: '📊 Ver estadísticas' }),
    puedeEscribir(_ctx.rol) && _ctx.configured ? el('button', { class: 'btn btn-ghost', text: '➕ Nuevo árbol', onclick: () => nuevoArbol() }) : null,
  ]));
}

// ---------------------------------------------------------------------------
// Árboles — listado + CRUD
// ---------------------------------------------------------------------------
async function arboles(c) {
  const canWrite = puedeEscribir(_ctx.rol);
  c.append(el('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px' }, [
    el('p', { class: 'muted', style: 'margin:0;max-width:520px', text: _ctx.configured ? 'Listado en vivo desde Firestore. El borrado es lógico (recuperable) y cada cambio queda auditado.' : 'Listado de solo lectura desde los datos estáticos. Conecta Firebase para editar.' }),
    canWrite && _ctx.configured ? el('button', { class: 'btn btn-primary btn-sm', text: '➕ Nuevo árbol', onclick: () => nuevoArbol() }) : null,
  ]));

  const tableWrap = el('div', { style: 'overflow-x:auto' });
  const pager = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:10px' });
  c.append(tableWrap, pager);

  if (_ctx.configured) return arbolesFirestore(tableWrap, pager, canWrite);
  return arbolesEstatico(c, tableWrap, pager);
}

async function arbolesFirestore(tableWrap, pager, canWrite) {
  const pages = [];         // pila de cursores (para "anterior")
  let cursor = null, pageIdx = 0, done = false;

  async function draw() {
    tableWrap.innerHTML = '<div style="padding:20px;text-align:center"><div class="spinner"></div></div>';
    const { items, cursor: next, done: isDone } = await db.listArboles({ pageSize: 20, cursor });
    done = isDone;
    tableWrap.innerHTML = '';
    tableWrap.append(tablaArboles(items, canWrite));
    pager.innerHTML = '';
    pager.append(
      el('span', { class: 'muted', style: 'font-size:.86rem', text: `Página ${pageIdx + 1}` }),
      el('div', { style: 'display:flex;gap:8px' }, [
        el('button', { class: 'btn btn-ghost btn-sm', text: '‹ Anterior', disabled: pageIdx === 0 ? '' : null, onclick: () => { if (pageIdx > 0) { pages.pop(); pageIdx--; cursor = pages[pageIdx - 1] || null; draw(); } } }),
        el('button', { class: 'btn btn-ghost btn-sm', text: 'Siguiente ›', disabled: done ? '' : null, onclick: () => { if (!done && next) { pages.push(next); cursor = next; pageIdx++; draw(); } } }),
      ]),
    );
  }
  await draw();
}

function tablaArboles(items, canWrite) {
  const table = el('table', { class: 'data-table' });
  table.append(el('thead', {}, [el('tr', {}, ['Código', 'Especie', 'Sector', 'Altura', 'DAP', 'Estado', ''].map(h => el('th', { text: h })))]));
  const tb = el('tbody');
  if (!items.length) tb.append(el('tr', {}, [el('td', { colspan: '7', class: 'muted', style: 'text-align:center;padding:24px', text: 'Sin árboles en esta página. Importa datos o crea uno nuevo.' })]));
  items.forEach(d => {
    tb.append(el('tr', {}, [
      el('td', {}, [el('strong', { text: d.codigo })]),
      el('td', { text: d.especieKey || d.nombreCientifico || '—' }),
      el('td', { text: d.sector || '—' }),
      el('td', { text: fmtNum(d.alturaTotal, ' m') }),
      el('td', { text: fmtNum(d.dap, ' cm') }),
      el('td', {}, [el('span', { class: `badge badge-${d.coordValida !== false ? 'green' : 'red'}`, text: d.coordValida !== false ? 'OK' : 'revisar' })]),
      el('td', { style: 'white-space:nowrap' }, [
        el('a', { href: `#/arbol/${d.id}`, style: 'margin-right:10px', text: 'Ver' }),
        canWrite ? el('button', { class: 'link-btn', style: 'margin-right:10px', text: 'Editar', onclick: () => editarArbol(d) }) : null,
        canWrite ? el('button', { class: 'link-btn', style: 'color:var(--red-500)', text: 'Borrar', onclick: () => borrarArbol(d) }) : null,
      ]),
    ]));
  });
  table.append(tb);
  return table;
}

function arbolesEstatico(c, tableWrap, pager) {
  const all = getTrees();
  let page = 0, q = ''; const perPage = 12;
  const search = el('input', { class: 'input', style: 'max-width:300px;margin-bottom:14px', placeholder: 'Buscar por código, especie o dirección…', oninput: debounce(e => { q = e.target.value.toLowerCase(); page = 0; draw(); }, 160) });
  c.prepend(search);
  const filtered = () => !q ? all : all.filter(f => { const p = f.properties; return p.codigo.toLowerCase().includes(q) || (p.e || '').toLowerCase().includes(q) || (p.dir || '').toLowerCase().includes(q); });
  function draw() {
    const list = filtered();
    const slice = list.slice(page * perPage, page * perPage + perPage);
    const items = slice.map(f => ({ id: f.properties.id, codigo: f.properties.codigo, especieKey: f.properties.e, sector: f.properties.sec, alturaTotal: f.properties.hT, dap: f.properties.dap, coordValida: f.properties.ok }));
    tableWrap.innerHTML = ''; tableWrap.append(tablaArboles(items, false));
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

// Formularios de árbol -------------------------------------------------------
function arbolForm(d = {}) {
  const f = (id, label, val, attrs = {}) => el('div', {}, [
    el('label', { class: 'filter-title', text: label }),
    el('input', { class: 'input', id, value: val ?? '', style: 'margin:4px 0 10px', ...attrs }),
  ]);
  return el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:0 14px' }, [
    f('af-codigo', 'Código', d.codigo),
    f('af-especie', 'Especie (nombre común)', d.especieKey),
    f('af-sci', 'Nombre científico', d.nombreCientifico),
    f('af-fam', 'Familia', d.familia),
    f('af-lat', 'Latitud', d.lat, { type: 'number', step: 'any' }),
    f('af-lon', 'Longitud', d.lon, { type: 'number', step: 'any' }),
    f('af-dir', 'Dirección', d.direccion),
    f('af-sec', 'Sector', d.sector),
    f('af-dap', 'DAP (cm)', d.dap, { type: 'number', step: 'any' }),
    f('af-ht', 'Altura total (m)', d.alturaTotal, { type: 'number', step: 'any' }),
  ]);
}
function readArbolForm(id) {
  const v = x => document.getElementById(x).value.trim();
  const num = x => { const n = parseFloat(v(x)); return Number.isFinite(n) ? n : null; };
  const lat = num('af-lat'), lon = num('af-lon');
  const comun = v('af-especie'), sci = v('af-sci');
  return {
    id, codigo: v('af-codigo') || `ARB-${String(id).padStart(5, '0')}`,
    especieKey: (comun || 'SIN ESPECIE').toUpperCase(),
    especieSlug: slugify(comun || sci || 'sin-especie'),
    nombreCientifico: sci || null, familia: v('af-fam') || null,
    lat, lon, direccion: v('af-dir') || null, sector: v('af-sec') || null,
    dap: num('af-dap'), alturaTotal: num('af-ht'),
    coordValida: Number.isFinite(lat) && Number.isFinite(lon),
    duplicado: false, identificada: !!(comun || sci),
  };
}

async function nuevoArbol() {
  const id = await db.nextArbolId();
  modal('Nuevo árbol', arbolForm({ id, codigo: `ARB-${String(id).padStart(5, '0')}` }), async () => {
    const data = readArbolForm(id);
    if (data.lat == null || data.lon == null) { toast('Latitud y longitud son obligatorias.'); return false; }
    await db.saveArbol(data, { create: true });
    toast('Árbol creado. Recuerda publicar el snapshot.'); reload('arboles'); return true;
  });
}
function editarArbol(d) {
  modal(`Editar ${d.codigo}`, arbolForm(d), async () => {
    const data = readArbolForm(d.id);
    await db.saveArbol(data, { create: false });
    toast('Cambios guardados.'); reload('arboles'); return true;
  });
}
function borrarArbol(d) {
  modal(`Borrar ${d.codigo}`,
    el('div', {}, [el('p', { text: `¿Borrar el árbol ${d.codigo}?` }), el('p', { class: 'muted', style: 'font-size:.86rem', text: 'Es un borrado lógico: el registro se marca como eliminado y puede recuperarse. Quedará fuera del próximo snapshot público.' })]),
    async () => { await db.softDeleteArbol(d.id); toast('Árbol borrado (recuperable).'); reload('arboles'); return true; },
    { danger: true, okText: 'Borrar' });
}

// ---------------------------------------------------------------------------
// Especies — CRUD + imágenes
// ---------------------------------------------------------------------------
async function especies(c) {
  const canWrite = puedeEscribir(_ctx.rol);
  c.append(el('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px' }, [
    el('p', { class: 'muted', style: 'margin:0;max-width:560px', text: 'Biblioteca botánica. La prioridad de imagen (admin → banco → externa con licencia → lámina generada) se guarda en la base de datos. Si no hay imagen, se muestra una lámina generada, nunca la de otra especie.' }),
    canWrite && _ctx.configured ? el('button', { class: 'btn btn-primary btn-sm', text: '➕ Nueva especie', onclick: () => nuevaEspecie() }) : null,
  ]));

  const lista = _ctx.configured ? await db.listEspecies() : getSpecies().filter(s => !s.es_no_especie);
  const grid = el('div', { class: 'species-grid' });
  lista.sort((a, b) => (b.individuos || 0) - (a.individuos || 0)).slice(0, 60).forEach(s => {
    if (!s.foto && s.imagenWikimedia) s.foto = s.imagenWikimedia;   // previsualización de la foto real
    const thumb = el('div', { class: 'species-thumb' });
    renderImage(s, thumb, { size: 'card' });
    const tieneImg = !!(s.imagenAdmin && s.imagenAdmin.url);
    grid.append(el('article', { class: 'species-card' }, [
      thumb,
      el('div', { class: 'species-info' }, [
        el('div', { class: 'cn', text: s.comun || s.especieKey || '—' }),
        el('div', { class: 'sn', text: s.cientifico || '—' }),
        el('div', { style: 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap' }, [
          el('span', { class: `badge badge-${tieneImg ? 'green' : (s.foto ? 'blue' : 'gray')}`, text: tieneImg ? 'Imagen admin' : (s.foto ? 'Foto Wikimedia' : 'Lámina generada') }),
        ]),
        canWrite ? el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, [
          el('button', { class: 'btn btn-ghost btn-sm', text: tieneImg ? 'Cambiar imagen' : 'Asignar imagen', onclick: () => imagenDialog(s) }),
          _ctx.configured ? el('button', { class: 'btn btn-ghost btn-sm', text: 'Editar', onclick: () => editarEspecie(s) }) : null,
        ]) : null,
      ]),
    ]));
  });
  c.append(grid);
}

function especieForm(d = {}) {
  const f = (id, label, val, attrs = {}) => el('div', {}, [el('label', { class: 'filter-title', text: label }), el('input', { class: 'input', id, value: val ?? '', style: 'margin:4px 0 10px', ...attrs })]);
  const origen = el('select', { class: 'select', id: 'ef-origen', style: 'margin:4px 0 10px' }, ['Nativa', 'Introducida', 'Ornamental'].map(o => el('option', { value: o, text: o, selected: d.origen === o ? '' : null })));
  return el('div', {}, [
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:0 14px' }, [
      f('ef-comun', 'Nombre común', d.comun),
      f('ef-sci', 'Nombre científico', d.cientifico),
      f('ef-fam', 'Familia', d.familia),
      el('div', {}, [el('label', { class: 'filter-title', text: 'Origen' }), origen]),
      f('ef-follaje', 'Follaje', d.follaje),
      f('ef-porte', 'Porte', d.porte),
    ]),
    el('label', { class: 'filter-title', text: 'Descripción' }),
    el('textarea', { class: 'input', id: 'ef-desc', rows: '3', style: 'margin:4px 0 4px;resize:vertical' }, [d.descripcion || '']),
  ]);
}
function readEspecieForm(slug) {
  const v = x => document.getElementById(x).value.trim();
  const comun = v('ef-comun');
  return {
    slug: slug || undefined, comun, key: (comun || '').toUpperCase(),
    cientifico: v('ef-sci') || null, familia: v('ef-fam') || null,
    origen: v('ef-origen'), follaje: v('ef-follaje') || null, porte: v('ef-porte') || null,
    descripcion: v('ef-desc') || null,
  };
}
function nuevaEspecie() {
  modal('Nueva especie', especieForm(), async () => {
    const data = readEspecieForm(null);
    if (!data.comun && !data.cientifico) { toast('Indica al menos el nombre común o científico.'); return false; }
    await db.saveEspecie(data, { create: true });
    toast('Especie creada.'); reload('especies'); return true;
  });
}
function editarEspecie(s) {
  modal(`Editar ${s.comun || s.cientifico}`, especieForm(s), async () => {
    await db.saveEspecie({ ...readEspecieForm(s.slug), slug: s.slug }, { create: false });
    toast('Especie actualizada.'); reload('especies'); return true;
  });
}

function imagenDialog(s) {
  const urlIn = el('input', { class: 'input', placeholder: 'https://…', value: s.imagenAdmin?.url || '', style: 'margin:4px 0 10px' });
  const fuenteIn = el('input', { class: 'input', placeholder: 'Fuente / autor', value: s.imagenAdmin?.fuente || '', style: 'margin:4px 0 10px' });
  const licIn = el('input', { class: 'input', placeholder: 'Licencia (p. ej. CC BY-SA)', value: s.imagenAdmin?.licencia || '', style: 'margin:4px 0 10px' });
  const fileIn = el('input', { class: 'input', type: 'file', accept: 'image/*', style: 'margin:4px 0 10px' });
  const body = el('div', {}, [
    el('p', { class: 'muted', style: 'font-size:.86rem', text: 'Pega una URL con derechos de uso o sube un archivo. Deja la URL vacía y sin archivo para volver a la lámina generada.' }),
    el('label', { class: 'filter-title', text: 'URL de la imagen' }), urlIn,
    _ctx.configured ? el('label', { class: 'filter-title', text: 'o subir archivo (a Firebase Storage)' }) : null,
    _ctx.configured ? fileIn : null,
    el('label', { class: 'filter-title', text: 'Fuente / autor' }), fuenteIn,
    el('label', { class: 'filter-title', text: 'Licencia' }), licIn,
  ]);
  modal(`Imagen de ${s.comun || s.cientifico}`, body, async () => {
    let url = urlIn.value.trim();
    if (_ctx.configured) {
      const file = fileIn.files[0];
      if (file) { toast('Subiendo imagen…'); const up = await db.uploadImagen(file, s.slug); url = up.url; }
      if (!url) { await db.setEspecieImagen(s.slug, null); toast('Imagen restablecida a lámina generada.'); }
      else await db.setEspecieImagen(s.slug, { url, fuente: fuenteIn.value.trim(), licencia: licIn.value.trim() });
    } else {
      // Modo demo: guarda en localStorage (como antes).
      const ov = store.get('img-overrides', {});
      if (!url) delete ov[s.slug]; else ov[s.slug] = { url, fuente: fuenteIn.value.trim(), licencia: licIn.value.trim(), fecha: new Date().toISOString() };
      store.set('img-overrides', ov);
    }
    toast('Imagen actualizada.'); reload('especies'); return true;
  });
}

// ---------------------------------------------------------------------------
// Reportes ciudadanos
// ---------------------------------------------------------------------------
async function reportes(c) {
  const canWrite = puedeEscribir(_ctx.rol);
  const list = _ctx.configured
    ? await db.listReportes()
    : (store.get('reportes', [])).map(r => ({ _id: r.id, arbolCodigo: r.arbol, tipo: r.tipo, comentario: r.comentario, estado: r.estado, creadoEn: r.fecha }));
  if (!list.length) { c.append(el('div', { class: 'empty-state', html: '<div class="es-ico">📭</div><p>No hay reportes ciudadanos.</p><p class="muted">Los reportes enviados desde la ficha de un árbol aparecerán aquí.</p>' })); return; }

  const table = el('table', { class: 'data-table' });
  table.append(el('thead', {}, [el('tr', {}, ['Fecha', 'Árbol', 'Tipo', 'Comentario', 'Estado', ''].map(h => el('th', { text: h })))]));
  const tb = el('tbody');
  list.forEach(r => {
    const fecha = aFecha(r.creadoEn);
    const badge = { pendiente: 'amber', aprobado: 'green', rechazado: 'red', resuelto: 'green' }[r.estado] || 'gray';
    tb.append(el('tr', {}, [
      el('td', { text: fecha ? fecha.toLocaleDateString('es-CL') : '—' }),
      el('td', {}, [r.arbolId ? el('a', { href: `#/arbol/${r.arbolId}`, text: r.arbolCodigo || r.arbolId }) : (r.arbolCodigo || '—')]),
      el('td', { text: r.tipo }),
      el('td', { text: (r.comentario || '—').slice(0, 48) }),
      el('td', {}, [el('span', { class: `badge badge-${badge}`, text: r.estado })]),
      el('td', { style: 'white-space:nowrap' }, canWrite && _ctx.configured && r.estado === 'pendiente' ? [
        el('button', { class: 'link-btn', style: 'color:var(--green-600,#16a34a);margin-right:10px', text: 'Aprobar', onclick: async () => { await db.resolverReporte(r._id, 'aprobado'); toast('Reporte aprobado.'); reload('reportes'); } }),
        el('button', { class: 'link-btn', style: 'color:var(--red-500)', text: 'Rechazar', onclick: async () => { await db.resolverReporte(r._id, 'rechazado'); toast('Reporte rechazado.'); reload('reportes'); } }),
      ] : (canWrite && !_ctx.configured && r.estado === 'pendiente' ? [
        el('button', { class: 'link-btn', text: 'Resolver', onclick: () => { const all = store.get('reportes', []); const t = all.find(x => x.id === r._id); if (t) { t.estado = 'resuelto'; store.set('reportes', all); } toast('Resuelto.'); reload('reportes'); } }),
      ] : [el('span', { class: 'muted', text: '—' })])),
    ]));
  });
  table.append(tb);
  c.append(el('div', { style: 'overflow-x:auto' }, [table]));
}

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------
async function auditoria(c) {
  if (!_ctx.configured) { c.append(el('div', { class: 'callout callout-amber' }, [el('span', { class: 'ci', text: '🧾' }), 'La auditoría requiere Firebase. En modo demostración no se registran cambios en base de datos.'])); return; }
  const list = await db.listAuditoria(150);
  if (!list.length) { c.append(el('div', { class: 'empty-state', html: '<div class="es-ico">🧾</div><p>Sin registros de auditoría todavía.</p>' })); return; }
  c.append(el('p', { class: 'muted', text: 'Cada alta, edición, borrado y publicación queda registrada con quién y cuándo.' }));
  const table = el('table', { class: 'data-table' });
  table.append(el('thead', {}, [el('tr', {}, ['Fecha', 'Entidad', 'ID', 'Acción', 'Usuario'].map(h => el('th', { text: h })))]));
  const tb = el('tbody');
  list.forEach(a => {
    const fecha = aFecha(a.fecha);
    tb.append(el('tr', {}, [
      el('td', { text: fecha ? fecha.toLocaleString('es-CL') : '—' }),
      el('td', { text: a.entidad }),
      el('td', {}, [el('code', { text: String(a.entidadId).slice(0, 16) })]),
      el('td', {}, [el('span', { class: 'badge badge-blue', text: a.accion })]),
      el('td', { class: 'muted', text: a.usuario }),
    ]));
  });
  table.append(tb);
  c.append(el('div', { style: 'overflow-x:auto' }, [table]));
}

// ---------------------------------------------------------------------------
// Usuarios y roles
// ---------------------------------------------------------------------------
async function usuarios(c) {
  if (!_ctx.configured) {
    const demo = [['María González', 'admin'], ['Pedro Soto', 'gis'], ['Ana Rivas', 'editor'], ['Consulta Pública', 'consulta']];
    c.append(tablaUsuarios(demo.map(([n, r]) => ({ nombre: n, rol: r, estado: 'activo' }))));
    c.append(el('div', { class: 'callout callout-amber', style: 'margin-top:16px' }, [el('span', { class: 'ci', text: '👥' }), 'Usuarios de demostración. Conecta Firebase para gestionar cuentas y roles reales.']));
    return;
  }
  const superadmin = esSuper(_ctx.rol);
  let rows = await db.listUsuarios();
  const verEliminados = store.get('ver-usuarios-eliminados', false);
  const eliminados = rows.filter(u => u.estado === 'eliminado').length;
  if (!verEliminados) rows = rows.filter(u => u.estado !== 'eliminado');
  rows.sort((a, b) => Object.keys(ROLES).indexOf(a.rol) - Object.keys(ROLES).indexOf(b.rol) || String(a.email).localeCompare(b.email));

  const bar = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px' });
  if (superadmin) bar.append(el('button', { class: 'btn btn-primary', text: '➕ Nuevo usuario', onclick: () => modalUsuario(null) }));
  if (eliminados) bar.append(el('label', { class: 'muted', style: 'font-size:.86rem;display:flex;gap:6px;align-items:center;cursor:pointer' }, [
    el('input', { type: 'checkbox', checked: verEliminados ? '' : null, onchange: e => { store.set('ver-usuarios-eliminados', e.target.checked); reload('usuarios'); } }),
    `Mostrar eliminados (${eliminados})`,
  ]));
  c.append(bar);
  c.append(tablaUsuarios(rows, superadmin));
  c.append(el('div', { class: 'callout callout-blue', style: 'margin-top:16px' }, [el('span', { class: 'ci', text: 'ℹ️' }), el('div', {}, superadmin
    ? ['Los usuarios nuevos reciben una contraseña temporal y deben cambiarla en su primer ingreso. "Eliminar" desactiva la cuenta y le quita el acceso (plan gratuito); para borrarla por completo usa Firebase Console → Authentication.']
    : ['Solo el Superadministrador puede crear, editar o desactivar usuarios.'])]));
}

function tablaUsuarios(rows, editable = false) {
  const table = el('table', { class: 'data-table' });
  table.append(el('thead', {}, [el('tr', {}, ['Usuario', 'Rol', 'Permisos', 'Estado', editable ? 'Acciones' : null].filter(Boolean).map(h => el('th', { text: h })))]));
  const tb = el('tbody');
  rows.forEach(u => {
    const [estTxt, estBadge] = ESTADOS[u.estado || 'activo'] || [u.estado, 'gray'];
    const yo = u.uid && _ctx.user && u.uid === _ctx.user.uid;
    const acciones = editable ? el('td', { style: 'white-space:nowrap' }, [
      el('button', { class: 'link-btn', text: 'Editar', onclick: () => modalUsuario(u) }), ' · ',
      el('button', { class: 'link-btn', text: 'Restablecer contraseña', onclick: () => resetUsuario(u) }),
      yo ? null : ' · ',
      yo ? null : u.estado === 'eliminado' || u.estado === 'inactivo'
        ? el('button', { class: 'link-btn', text: 'Reactivar', onclick: () => cambiarEstado(u, 'activo') })
        : el('button', { class: 'link-btn', style: 'color:var(--red-500)', text: 'Eliminar', onclick: () => eliminarUsuario(u) }),
    ]) : null;
    tb.append(el('tr', {}, [
      el('td', {}, [el('strong', { text: u.nombre || u.email || u.uid }), u.email && u.nombre !== u.email ? el('div', { class: 'muted', style: 'font-size:.8rem', text: u.email }) : null,
        u.debeCambiarPassword ? el('div', { class: 'muted', style: 'font-size:.75rem', text: '⏳ debe cambiar su contraseña' }) : null]),
      el('td', {}, [el('span', { class: `badge badge-${ROLES[u.rol]?.badge || 'gray'}`, text: ROLES[u.rol]?.name || u.rol || '—' })]),
      el('td', { text: ROLES[u.rol]?.desc || '—' }),
      el('td', {}, [el('span', { class: `badge badge-${estBadge}`, text: estTxt })]),
      acciones,
    ].filter(Boolean)));
  });
  if (!rows.length) tb.append(el('tr', {}, [el('td', { colspan: editable ? 5 : 4, class: 'muted', text: 'No hay usuarios.' })]));
  table.append(tb);
  return el('div', { style: 'overflow-x:auto' }, [table]);
}

// Contraseña temporal aleatoria legible (12 caracteres).
function passwordTemporal() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint32Array(12));
  return [...r].map(n => abc[n % abc.length]).join('');
}

const campo = (label, input) => el('div', { style: 'margin-bottom:12px' }, [el('label', { class: 'filter-title', text: label }), input]);
const selectRol = (valor, deshabilitado = false) => el('select', { class: 'select', disabled: deshabilitado ? '' : null },
  Object.entries(ROLES).map(([k, r]) => el('option', { value: k, text: `${r.name} — ${r.desc}`, selected: valor === k ? '' : null })));

function modalUsuario(u) {
  const nuevo = !u;
  const yo = u && _ctx.user && u.uid === _ctx.user.uid;
  const nombre = el('input', { class: 'input', value: u?.nombre || '', placeholder: 'Nombre y apellido' });
  const email = el('input', { class: 'input', type: 'email', value: u?.email || '', placeholder: 'correo@ejemplo.com', disabled: nuevo ? null : '' });
  const rol = selectRol(u?.rol || 'consulta', yo);
  const estado = el('select', { class: 'select', disabled: yo ? '' : null }, Object.entries(ESTADOS).map(([k, [t]]) => el('option', { value: k, text: t, selected: (u?.estado || 'activo') === k ? '' : null })));
  const temp = passwordTemporal();
  const pass = el('input', { class: 'input', value: temp, style: 'font-family:monospace' });
  const body = el('div', {}, [
    campo('Nombre', nombre), campo('Correo electrónico', email), campo('Rol', rol),
    nuevo ? campo('Contraseña temporal', el('div', { style: 'display:flex;gap:8px' }, [pass,
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '🎲', title: 'Generar otra', onclick: () => { pass.value = passwordTemporal(); } })])) : campo('Estado', estado),
    nuevo ? el('p', { class: 'muted', style: 'font-size:.82rem;margin:0', text: 'Entrégale esta contraseña al usuario: deberá cambiarla en su primer ingreso.' }) : null,
    yo ? el('p', { class: 'muted', style: 'font-size:.82rem;margin:0', text: 'No puedes cambiar tu propio rol ni estado.' }) : null,
  ]);
  modal(nuevo ? 'Nuevo usuario' : 'Editar usuario', body, async () => {
    try {
      if (nuevo) {
        const correo = email.value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) { toast('Escribe un correo válido.'); return false; }
        if (pass.value.length < 8) { toast('La contraseña temporal debe tener al menos 8 caracteres.'); return false; }
        await db.crearUsuario({ email: correo, nombre: nombre.value.trim() || correo, rol: rol.value, password: pass.value });
        modalInfo('Usuario creado', [
          el('p', { text: `Comparte estos datos con ${correo} por un canal seguro:` }),
          el('pre', { style: 'background:var(--surface-2);padding:12px;border-radius:10px;white-space:pre-wrap', text: `Web: ${location.origin}/#/admin\nCorreo: ${correo}\nContraseña temporal: ${pass.value}` }),
          el('p', { class: 'muted', style: 'font-size:.84rem', text: 'Al entrar por primera vez se le pedirá cambiar la contraseña.' }),
        ]);
      } else {
        const cambios = { nombre: nombre.value.trim() || u.email };
        if (!yo) { cambios.rol = rol.value; cambios.estado = estado.value; }
        await db.actualizarUsuario(u.uid, cambios);
        toast('Usuario actualizado.');
      }
      reload('usuarios');
    } catch (e) { toast(traducirError(e.message), 5000); return false; }
  }, { okText: nuevo ? 'Crear usuario' : 'Guardar' });
}

async function resetUsuario(u) {
  if (!u.email) return toast('Este usuario no tiene correo registrado.');
  if (!confirm(`¿Enviar a ${u.email} un correo para restablecer su contraseña?`)) return;
  try { await db.enviarResetPassword(u.email); toast(`Correo de restablecimiento enviado a ${u.email}.`, 4000); }
  catch (e) { toast(traducirError(e.message), 5000); }
}

async function cambiarEstado(u, estado) {
  try { await db.actualizarUsuario(u.uid, { estado }, estado === 'activo' ? 'reactivacion' : 'desactivacion'); toast('Usuario actualizado.'); reload('usuarios'); }
  catch (e) { toast(traducirError(e.message), 5000); }
}

function eliminarUsuario(u) {
  modal('Eliminar usuario', el('p', { text: `${u.email || u.nombre} perderá el acceso al panel de inmediato. Podrás reactivarlo más tarde desde "Mostrar eliminados".` }), async () => {
    await db.actualizarUsuario(u.uid, { estado: 'eliminado' }, 'eliminacion');
    toast('Usuario eliminado (desactivado).');
    reload('usuarios');
  }, { okText: 'Eliminar', danger: true });
}

function modalInfo(titulo, nodos) {
  const overlay = el('div', { class: 'modal-overlay', style: 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2100;padding:20px' });
  overlay.append(el('div', { class: 'card card-pad', style: 'max-width:520px;width:100%' }, [
    el('h3', { style: 'margin:0 0 12px', text: titulo }), ...nodos,
    el('div', { style: 'text-align:right;margin-top:14px' }, [el('button', { class: 'btn btn-primary', text: 'Entendido', onclick: () => overlay.remove() })]),
  ]));
  document.body.append(overlay);
}

// ---------------------------------------------------------------------------
// Capas GIS
// ---------------------------------------------------------------------------
async function capas(c) {
  const admin = db.puedeImportar(_ctx.rol);
  if (!_ctx.configured) { c.append(el('div', { class: 'callout callout-amber' }, [el('span', { class: 'ci', text: '⚠️' }), 'Las capas requieren Firebase configurado.'])); return; }
  const lista = await db.listCapas();
  if (admin) c.append(el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px' }, [
    el('a', { class: 'btn btn-primary', href: '#/importar?accion=nueva', text: '🆕 Nueva capa' }),
    el('a', { class: 'btn btn-ghost', href: '#/mapa', text: '🗺️ Ver en el mapa' }),
  ]));
  const table = el('table', { class: 'data-table' });
  table.append(el('thead', {}, [el('tr', {}, ['Capa', 'Geometría', 'Elementos', 'Visible al abrir el mapa', admin ? 'Acciones' : null].filter(Boolean).map(h => el('th', { text: h })))]));
  const tb = el('tbody');
  tb.append(el('tr', {}, [
    el('td', {}, [el('span', { class: 'layer-swatch', style: 'display:inline-block;vertical-align:middle;margin-right:8px;background:#3aa06a' }), el('strong', { text: 'Arbolado' }), el('div', { class: 'muted', style: 'font-size:.78rem', text: 'Capa principal (solo admite agregar árboles)' })]),
    el('td', { text: 'Point' }), el('td', { text: fmt(getTrees().length) }), el('td', { text: 'Sí' }),
    admin ? el('td', {}, [el('a', { class: 'link-btn', href: '#/importar?accion=agregar&capa=arbolado', text: 'Agregar árboles' })]) : null,
  ].filter(Boolean)));
  lista.forEach(k => tb.append(el('tr', {}, [
    el('td', {}, [el('span', { class: 'layer-swatch', style: `display:inline-block;vertical-align:middle;margin-right:8px;background:${k.color || '#2e7ab8'}` }), el('strong', { text: k.nombre }),
      el('div', { class: 'muted', style: 'font-size:.78rem', text: `${k.archivo || ''} · ${k.modificadoPor || ''}` })]),
    el('td', { text: k.geometria || '—' }), el('td', { text: fmt(k.elementos || 0) }),
    el('td', { text: k.visible === false ? 'No' : 'Sí' }),
    admin ? el('td', { style: 'white-space:nowrap' }, [
      el('button', { class: 'link-btn', text: 'Editar', onclick: () => modalCapa(k) }), ' · ',
      el('a', { class: 'link-btn', href: `#/importar?accion=agregar&capa=${encodeURIComponent(k.id)}`, text: 'Agregar' }), ' · ',
      el('a', { class: 'link-btn', href: `#/importar?accion=reemplazar&capa=${encodeURIComponent(k.id)}`, text: 'Reemplazar' }), ' · ',
      el('button', { class: 'link-btn', style: 'color:var(--red-500)', text: 'Eliminar', onclick: () => modal('Eliminar capa', el('p', { text: `La capa "${k.nombre}" dejará de mostrarse en el mapa.` }), async () => {
        await db.eliminarCapa(k.id); toast('Capa eliminada.'); reload('capas');
      }, { okText: 'Eliminar', danger: true }) }),
    ]) : null,
  ].filter(Boolean))));
  table.append(tb);
  c.append(el('div', { style: 'overflow-x:auto' }, [table]));
  if (!admin) c.append(el('p', { class: 'muted', style: 'margin-top:12px;font-size:.86rem', text: 'Solo los administradores pueden importar, reemplazar o editar capas.' }));
}

function modalCapa(k) {
  const nombre = el('input', { class: 'input', value: k.nombre });
  const color = el('input', { class: 'input', type: 'color', value: k.color || '#2e7ab8' });
  const visible = el('input', { type: 'checkbox', checked: k.visible === false ? null : '' });
  modal('Editar capa', el('div', {}, [
    campo('Nombre', nombre), campo('Color', color),
    el('label', { style: 'display:flex;gap:8px;align-items:center;cursor:pointer' }, [visible, 'Visible al abrir el mapa']),
  ]), async () => {
    if (!nombre.value.trim()) { toast('La capa necesita un nombre.'); return false; }
    await db.editarCapa(k.id, { nombre: nombre.value, color: color.value, visible: visible.checked });
    toast('Capa actualizada.'); reload('capas');
  });
}

// ---------------------------------------------------------------------------
// Importación (solo administradores)
// ---------------------------------------------------------------------------
function importar(c) {
  c.append(el('p', { class: 'muted', text: 'Crea capas nuevas, reemplaza capas existentes o agrégales elementos desde GeoJSON, KML, KMZ, Shapefile (.zip) o XLSX/CSV con latitud y longitud.' }));
  c.append(el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
    el('a', { class: 'btn btn-primary', href: '#/importar?accion=nueva', text: '🆕 Nueva capa' }),
    el('a', { class: 'btn btn-ghost', href: '#/importar?accion=reemplazar', text: '♻️ Reemplazar capa' }),
    el('a', { class: 'btn btn-ghost', href: '#/importar?accion=agregar', text: '➕ Agregar elementos' }),
  ]));
}

// ---------------------------------------------------------------------------
// Mi cuenta: cambio de contraseña
// ---------------------------------------------------------------------------
function cuenta(c) {
  const p = _ctx.perfil || {};
  c.append(el('div', { class: 'card card-pad', style: 'max-width:520px' }, [
    el('p', { style: 'margin-top:0' }, [el('strong', { text: p.nombre || _ctx.user?.email || '' }), el('br'), el('span', { class: 'muted', text: _ctx.user?.email || '' })]),
    el('p', {}, [el('span', { class: `badge badge-${ROLES[_ctx.rol]?.badge || 'gray'}`, text: ROLES[_ctx.rol]?.name || _ctx.rol })]),
    el('h3', { text: 'Cambiar mi contraseña' }),
    formCambioPassword({ onDone: () => reload('cuenta') }),
  ]));
}

// ---------------------------------------------------------------------------
// Modal genérico reutilizable
// ---------------------------------------------------------------------------
function modal(title, bodyNode, onOk, { okText = 'Guardar', danger = false } = {}) {
  const overlay = el('div', { class: 'modal-overlay', style: 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2000;padding:20px' });
  const close = () => overlay.remove();
  const okBtn = el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: okText, style: danger ? 'background:var(--red-500);border-color:var(--red-500)' : '', onclick: async () => {
    okBtn.disabled = true; const prev = okBtn.textContent; okBtn.textContent = 'Procesando…';
    try { const keep = await onOk(); if (keep !== false) close(); else { okBtn.disabled = false; okBtn.textContent = prev; } }
    catch (e) { toast('Error: ' + e.message); okBtn.disabled = false; okBtn.textContent = prev; }
  } });
  const card = el('div', { class: 'card card-pad', style: 'max-width:640px;width:100%;max-height:88vh;overflow:auto', onclick: e => e.stopPropagation() }, [
    el('h3', { style: 'margin:0 0 14px', text: title }),
    bodyNode,
    el('div', { style: 'display:flex;justify-content:flex-end;gap:10px;margin-top:18px' }, [
      el('button', { class: 'btn btn-ghost', text: 'Cancelar', onclick: close }), okBtn,
    ]),
  ]);
  overlay.addEventListener('click', close);
  overlay.append(card);
  document.body.append(overlay);
}

function kpi(v, l) { return el('div', { class: 'kpi' }, [el('div', { class: 'kv', text: v }), el('div', { class: 'kl', text: l })]); }
