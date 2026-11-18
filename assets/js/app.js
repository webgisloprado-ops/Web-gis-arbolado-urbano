// ============================================================================
// app.js — arranque, router y comportamiento del shell
// ============================================================================
import { $, $$, el, esc, fmt, debounce, store } from './util.js';
import { loadData, search } from './data.js';
import { renderImage } from './ui.js';
import { renderHome } from './pages/home.js';
import { renderMapa, cleanupMapa } from './pages/mapa.js';
import { renderEspecies } from './pages/especies.js';
import { renderEspecie } from './pages/especie.js';
import { renderArbol, renderReportar } from './pages/arbol.js';
import { renderEstadisticas } from './pages/estadisticas.js';
import { renderImportar } from './pages/importar.js';
import { renderAdmin } from './pages/admin.js';
import { isConfigured, currentUser, getUserRole, puedeImportar } from './backend.js';

const main = document.getElementById('main');

// ---------- Menú según permisos: "Importar" solo para administradores ----------
async function actualizarMenuPermisos() {
  const link = document.getElementById('nav-importar');
  if (!link) return;
  try {
    const user = (await isConfigured()) ? await currentUser() : null;
    link.hidden = !(user && puedeImportar(await getUserRole(user)));
  } catch { link.hidden = true; }
}
window.addEventListener('perfil-cambio', actualizarMenuPermisos);
actualizarMenuPermisos();

// ---------- Tema ----------
(function initTheme() {
  const saved = store.get('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.setAttribute('data-theme', 'dark');
  $('#btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    store.set('theme', cur);
  });
})();

// ---------- Navegación móvil ----------
$('#nav-toggle').addEventListener('click', e => {
  const nav = $('.main-nav'); const open = nav.classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', open);
});
$$('.main-nav a').forEach(a => a.addEventListener('click', () => $('.main-nav').classList.remove('open')));

// ---------- Buscador global ----------
const overlay = $('#search-overlay');
const searchInput = $('#search-input');
const searchResults = $('#search-results');
function openSearch() { overlay.hidden = false; setTimeout(() => searchInput.focus(), 30); }
function closeSearch() { overlay.hidden = true; searchInput.value = ''; searchResults.innerHTML = ''; }
$('#btn-search').addEventListener('click', openSearch);
overlay.addEventListener('click', e => { if (e.target === overlay) closeSearch(); });
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); overlay.hidden ? openSearch() : closeSearch(); }
  if (e.key === 'Escape' && !overlay.hidden) closeSearch();
});
$$('.search-hint .chip').forEach(c => c.addEventListener('click', () => { searchInput.value = c.dataset.q; runSearch(c.dataset.q); }));
searchInput.addEventListener('input', debounce(e => runSearch(e.target.value), 140));

function runSearch(q) {
  if (!window.__dataReady) return;
  const res = search(q);
  searchResults.innerHTML = '';
  if (!q.trim()) return;
  if (!res.species.length && !res.trees.length) {
    searchResults.append(el('div', { style: 'padding:20px;text-align:center;color:var(--text-3)', text: 'Sin resultados' }));
    return;
  }
  res.species.forEach(s => {
    const a = el('a', { href: `#/especie/${s.slug}`, onclick: closeSearch });
    const thumb = el('div', { class: 'r-thumb' }); renderImage(s, thumb, { size: 'card' });
    a.append(thumb, el('div', {}, [
      el('div', { class: 'r-main', text: s.comun }),
      el('div', { class: 'r-sub', text: s.cientifico || 'Especie' }),
    ]), el('span', { class: 'r-tag badge badge-green', text: `${fmt(s.individuos)}` }));
    searchResults.append(a);
  });
  res.trees.forEach(t => {
    const p = t.properties;
    const a = el('a', { href: `#/arbol/${p.id}`, onclick: closeSearch }, [
      el('div', { class: 'r-thumb', style: 'display:grid;place-items:center;font-size:20px', text: '🌳' }),
      el('div', {}, [el('div', { class: 'r-main', text: p.codigo }), el('div', { class: 'r-sub', text: `${p.e} · ${p.dir || p.sec}` })]),
      el('span', { class: 'r-tag badge badge-gray', text: 'árbol' }),
    ]);
    searchResults.append(a);
  });
}

// ---------- Router ----------
const routes = {
  '': { fn: renderHome },
  'mapa': { fn: renderMapa, full: true },
  'especies': { fn: renderEspecies },
  'especie': { fn: renderEspecie, param: 'slug' },
  'arbol': { fn: renderArbol, param: 'id' },
  'reportar': { fn: renderReportar, param: 'id' },
  'estadisticas': { fn: renderEstadisticas },
  'importar': { fn: renderImportar },
  'admin': { fn: renderAdmin, param: 'section' },
};

let currentCleanup = null;

async function router() {
  // limpieza de la vista anterior (mapas, listeners)
  if (currentCleanup) { try { currentCleanup(main); } catch {} currentCleanup = null; }
  if (main._map) { try { main._map.destroy(); } catch {} main._map = null; }
  if (main._heroMap) { try { main._heroMap.destroy(); } catch {} main._heroMap = null; }

  const hash = location.hash.replace(/^#\/?/, '');
  const [path, query] = hash.split('?');
  const segs = path.split('/').filter(Boolean);
  const routeKey = segs[0] || '';
  const route = routes[routeKey] || routes[''];

  // parámetros
  const params = {};
  if (route.param && segs[1]) params[route.param] = decodeURIComponent(segs[1]);
  if (query) new URLSearchParams(query).forEach((v, k) => (params[k] = v));

  // estado activo del menú
  $$('.main-nav a').forEach(a => a.classList.toggle('active', a.dataset.route === routeKey));

  // scroll arriba salvo mapa
  if (!route.full) window.scrollTo(0, 0);

  // asegurar datos cargados
  if (!window.__dataReady) {
    main.innerHTML = '<div class="loader-full"><div class="spinner"></div><p>Cargando inventario de arbolado…</p></div>';
    try { await loadData(); window.__dataReady = true; }
    catch (e) {
      main.innerHTML = `<div class="wrap section"><div class="empty-state"><div class="es-ico">⚠️</div><h2>No se pudieron cargar los datos</h2><p class="muted">${esc(e.message)}</p><p class="muted">Asegúrate de servir el sitio con un servidor local (ver README): <code>npm start</code></p></div></div>`;
      return;
    }
  }

  try {
    await route.fn(main, params);
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="wrap section"><div class="empty-state"><div class="es-ico">😕</div><h2>Algo salió mal</h2><p class="muted">${esc(e.message)}</p><a class="btn btn-primary" href="#/">Volver al inicio</a></div></div>`;
  }
  if (routeKey === 'mapa') currentCleanup = cleanupMapa;
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);
if (document.readyState !== 'loading') router();
