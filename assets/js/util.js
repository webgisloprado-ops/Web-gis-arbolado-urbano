// ============================================================================
// util.js — utilidades compartidas
// ============================================================================

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const el = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};

export const fmt = n => (n == null ? '—' : n.toLocaleString('es-CL'));
export const fmtNum = (n, u = '') => (n == null || n === '' ? '—' : `${(+n).toLocaleString('es-CL')}${u}`);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const slugify = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---- Toast ----
let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => (t.hidden = true), 250); }, ms);
}

// ---- Cargador de scripts externos (diferido, con caché) ----
const _loaded = {};
export function loadScript(src) {
  if (_loaded[src]) return _loaded[src];
  _loaded[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
  return _loaded[src];
}

// ---- Almacenamiento local seguro (overrides de imágenes, reportes demo, sesión) ----
export const store = {
  get(k, def = null) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ============================================================================
// Imagen representativa de especie — "lámina botánica"
// ----------------------------------------------------------------------------
// Sistema de prioridad de fuentes (sección 10 del prompt):
//   1. Imagen provista por el usuario/admin (guardada en localStorage con
//      metadatos de fuente/licencia).
//   2. [Configurable] banco de imágenes / fuente externa confiable.
//   3. Lámina botánica generada (garantiza representación visual siempre,
//      nunca una imagen de OTRA especie).
// Devuelve { type:'img'|'svg', src?, svg?, source } para renderizar.
// ============================================================================
export function speciesImage(sp, { size = 'card' } = {}) {
  // 1) Imagen aportada por el administrador (máxima prioridad).
  const overrides = store.get('img-overrides', {});
  const ov = overrides[sp.slug];
  if (ov && ov.url) return { type: 'img', src: ov.url, source: { ...ov, kind: 'usuario' } };
  // 2) Fotografía real de Wikimedia Commons asociada por nombre científico.
  if (sp.foto && sp.foto.url) {
    const src = size === 'card' && sp.foto.thumb ? sp.foto.thumb : sp.foto.url;
    return { type: 'img', src, source: { ...sp.foto, kind: 'wikimedia' } };
  }
  // 3) Lámina botánica generada (respaldo garantizado).
  return { type: 'svg', svg: botanicalPlate(sp, size), source: { kind: 'generada' } };
}

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// Genera una lámina SVG determinista y distinta por especie.
export function botanicalPlate(sp, size = 'card') {
  const seed = hashStr(sp.slug || sp.key || 'x');
  const hue = seed % 360;
  const isConifer = /pino|cipres|araucaria|casuarina|macrocarpa|sequoia|palo colorado/i.test(sp.key || '');
  const isPalm = /palm|washingtonia|phoenix|dracena|drácena/i.test(sp.key || '');
  const native = sp.origen === 'Nativa';
  // paleta verde-natural modulada por el hash (mantener tonos vegetales)
  const baseH = 95 + (seed % 60);            // 95–155 (verdes-amarillos-oliva)
  const c1 = `hsl(${baseH} 42% 88%)`;
  const c2 = `hsl(${baseH} 38% 78%)`;
  const trunk = `hsl(28 35% ${34 + (seed % 12)}%)`;
  const leaf = `hsl(${baseH} ${native ? 55 : 42}% ${34 + (seed % 10)}%)`;
  const leaf2 = `hsl(${baseH} ${native ? 48 : 38}% ${46 + (seed % 8)}%)`;
  const accent = native ? `hsl(${(hue + 20) % 360} 60% 60%)` : `hsl(${baseH} 40% 60%)`;

  const cn = esc(sp.comun || sp.key || '');
  const snText = sp.cientifico ? esc(sp.cientifico) : '';

  let canopy;
  if (isPalm) {
    canopy = `
      <g transform="translate(200,150)">
        ${[...Array(9)].map((_, i) => {
          const a = -90 + (i - 4) * 22;
          return `<path d="M0,0 Q${Math.cos(a*Math.PI/180)*70},${Math.sin(a*Math.PI/180)*70 - 18} ${Math.cos(a*Math.PI/180)*118},${Math.sin(a*Math.PI/180)*118 + 6}" stroke="${leaf}" stroke-width="9" fill="none" stroke-linecap="round"/>`;
        }).join('')}
        <circle r="10" fill="${leaf2}"/>
      </g>`;
  } else if (isConifer) {
    canopy = `<g>
      <polygon points="200,58 150,150 250,150" fill="${leaf}"/>
      <polygon points="200,100 138,196 262,196" fill="${leaf2}"/>
      <polygon points="200,146 126,246 274,246" fill="${leaf}"/></g>`;
  } else {
    const r = 74 + (seed % 22);
    canopy = `<g>
      <circle cx="200" cy="150" r="${r}" fill="${leaf2}"/>
      <circle cx="${162 + seed % 10}" cy="${138}" r="${r*0.62}" fill="${leaf}"/>
      <circle cx="${242 - seed % 10}" cy="${150}" r="${r*0.6}" fill="${leaf}"/>
      <circle cx="200" cy="${118}" r="${r*0.55}" fill="${leaf2}"/>
      ${[...Array(5)].map((_,i)=>{const ax=140+i*30+ (seed%7);const ay=120+((seed>>i)%40);return `<circle cx="${ax}" cy="${ay}" r="4.5" fill="${accent}" opacity=".8"/>`;}).join('')}
    </g>`;
  }
  const trunkPath = isPalm
    ? `<path d="M193,150 Q196,240 190,300 L210,300 Q204,240 207,150 Z" fill="${trunk}"/>`
    : `<path d="M188,196 Q185,250 178,300 L222,300 Q215,250 212,196 Z" fill="${trunk}"/>
       <path d="M200,205 l-26,-26 M200,215 l24,-22" stroke="${trunk}" stroke-width="7" stroke-linecap="round"/>`;

  return `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${cn}${snText?', '+snText:''}" preserveAspectRatio="xMidYMid slice">
    <defs><linearGradient id="bg${seed}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="400" height="300" fill="url(#bg${seed})"/>
    <circle cx="330" cy="60" r="34" fill="hsl(${baseH} 45% 92%)" opacity=".7"/>
    <ellipse cx="200" cy="298" rx="150" ry="16" fill="hsl(${baseH} 30% 70%)" opacity=".5"/>
    ${trunkPath}${canopy}
    ${native ? `<g transform="translate(20,20)"><rect width="76" height="24" rx="12" fill="hsl(${baseH} 45% 96%)" opacity=".9"/><text x="38" y="16" font-family="Inter,sans-serif" font-size="12" font-weight="700" fill="hsl(150 45% 30%)" text-anchor="middle">NATIVA</text></g>` : ''}
  </svg>`;
}

// ---- QR (carga diferida de la librería; si falla, degrada con gracia) ----
export async function makeQR(text, size = 168) {
  try {
    await loadScript(window.__CDN.qr);
    const qr = window.qrcode(0, 'M');
    qr.addData(text); qr.make();
    const svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    const w = el('div', { class: 'qr-wrap', style: `width:${size}px;height:${size}px` });
    w.innerHTML = svg;
    const s = w.querySelector('svg');
    if (s) { s.setAttribute('width', size); s.setAttribute('height', size); s.style.background = '#fff'; s.style.borderRadius = '10px'; s.style.padding = '6px'; }
    return w;
  } catch {
    return el('div', { class: 'muted', style: 'font-size:.8rem', text: 'QR no disponible sin conexión' });
  }
}

// ---- iconos SVG inline reutilizables ----
export const ICON = {
  pin: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  ruler: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8l13 13 5-5L8 3z"/><path d="M8 9l1.5 1.5M11 6l1.5 1.5M14 12l1.5 1.5M6 12l1.5 1.5"/></svg>',
  tree: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22v-6M9 16h6M12 2a5 5 0 0 0-3 9 5 5 0 0 0 6 0 5 5 0 0 0-3-9z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  drop: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3z"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20c8 0 14-6 15-16C10 4 4 10 4 20z"/><path d="M4 20c4-6 8-8 12-9"/></svg>',
};
