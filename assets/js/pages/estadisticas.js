// ============================================================================
// pages/estadisticas.js — panel de arbolado (dashboard)
// ============================================================================
import { el, fmt, loadScript } from '../util.js';
import { getStats, getState } from '../data.js';
import { pageHeader } from '../ui.js';
import { footer } from './home.js';

export async function renderEstadisticas(main) {
  main.innerHTML = '';
  const st = getStats();
  const meta = getState().meta;
  const section = el('section', { class: 'section' });
  const wrap = el('div', { class: 'wrap' });
  wrap.append(pageHeader('Panel de Arbolado', 'Indicadores y analítica calculados sobre los datos reales del inventario.'));

  // KPIs
  const kpis = el('div', { class: 'kpi-grid' });
  const kpi = (v, l, ico, cls = '') => el('div', { class: `kpi ${cls}` }, [
    el('div', { class: 'kt', text: ico }), el('div', { class: 'kv', text: v }), el('div', { class: 'kl', text: l }),
  ]);
  kpis.append(
    kpi(fmt(st.total_arboles), 'Árboles inventariados', '🌳'),
    kpi(fmt(st.especies), 'Especies', '🌿'),
    kpi(fmt(st.familias), 'Familias botánicas', '🧬', 'blue'),
    kpi(st.nativas_pct + '%', 'Especies nativas', '🇨🇱'),
    kpi(st.altura_promedio + ' m', 'Altura promedio', '📏', 'amber'),
    kpi(st.dap_promedio + ' cm', 'DAP promedio', '⭕', 'amber'),
  );
  wrap.append(kpis);

  // Calidad del inventario
  const q = st.calidad_detalle;
  const qcard = el('div', { class: 'card card-pad', style: 'margin-bottom:26px' }, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px' }, [
      el('h3', { style: 'margin:0', text: 'Calidad del inventario' }),
      el('div', { style: 'font-size:2rem;font-weight:800;font-family:var(--font-display);color:var(--brand-strong)', text: st.calidad + '%' }),
    ]),
    el('div', { class: 'quality-meter' }, [el('i', { style: `width:${st.calidad}%` })]),
    el('div', { class: 'muted', style: 'font-size:.86rem', text: 'Índice compuesto: coordenadas válidas, especie asignada, identificación botánica, presencia de altura/diámetro y ausencia de duplicados.' }),
    recomendaciones(st),
  ]);
  wrap.append(qcard);

  // Gráficos
  const charts = el('div', { class: 'chart-grid' });
  charts.append(
    chartCard('Árboles por especie (Top 12)', 'c-species'),
    chartCard('Origen de las especies', 'c-origen'),
    chartCard('Distribución por familia (Top 10)', 'c-familia'),
    chartCard('Distribución por sector', 'c-sector'),
    chartCard('Distribución de altura', 'c-altura'),
    chartCard('Distribución de diámetro (DAP)', 'c-dap'),
  );
  wrap.append(charts);

  // Trazabilidad
  if (meta) wrap.append(el('div', { class: 'callout callout-blue', style: 'margin-top:26px' }, [
    el('span', { class: 'ci', text: '🗂️' }),
    el('div', {}, [
      el('strong', { text: 'Trazabilidad de los datos. ' }),
      `Fuente: ${meta.fuente_datos}. Archivo: ${meta.fuente_archivo}. CRS: ${meta.crs}. `,
      `Procesado el ${new Date(meta.fecha_procesamiento).toLocaleDateString('es-CL')} · ${fmt(meta.arboles_publicados)} de ${fmt(meta.registros_origen)} registros publicados.`,
    ]),
  ]));

  section.append(wrap);
  main.append(section, footer());

  // Render de gráficos (Chart.js diferido)
  try {
    await loadScript(window.__CDN.chart);
    drawCharts(st);
  } catch (e) {
    charts.querySelectorAll('.chart-wrap').forEach(c => c.innerHTML = '<div class="muted" style="display:grid;place-items:center;height:100%">No se pudieron cargar los gráficos (sin conexión).</div>');
  }
}

function chartCard(title, id) {
  return el('div', { class: 'chart-card' }, [el('h3', { text: title }), el('div', { class: 'chart-wrap' }, [el('canvas', { id })])]);
}

function recomendaciones(st) {
  const q = st.calidad_detalle;
  const recs = [];
  if (q.noIdentificadas) recs.push(`${fmt(q.noIdentificadas)} registros no tienen especie identificada botánicamente.`);
  if (q.duplicadas) recs.push(`${fmt(q.duplicadas)} árboles comparten coordenada exacta con otro (posibles duplicados).`);
  const sinDap = st.total_registros - q.conDap;
  if (sinDap > 0) recs.push(`${fmt(sinDap)} árboles no tienen diámetro (DAP) registrado.`);
  if (q.coordFueraArea) recs.push(`${fmt(q.coordFueraArea)} árboles tienen coordenadas fuera del área esperada.`);
  if (!recs.length) return el('div', {});
  return el('div', { style: 'margin-top:14px;display:flex;flex-direction:column;gap:6px' },
    recs.map(r => el('div', { style: 'display:flex;gap:8px;font-size:.88rem;color:var(--text-2)' }, [el('span', { text: '⚠️' }), r])));
}

function drawCharts(st) {
  const Chart = window.Chart;
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--text-2').trim();
  const grid = css.getPropertyValue('--border').trim();
  Chart.defaults.color = text;
  Chart.defaults.font.family = 'Inter, sans-serif';
  const palette = ['#256b47', '#3aa06a', '#57bd82', '#8fd6ab', '#e0a127', '#2e7ab8', '#d1495b', '#6a3d9a', '#b15928', '#1f78b4', '#33a02c', '#ff7f00'];

  new Chart('c-species', {
    type: 'bar',
    data: { labels: st.top_especies.map(s => s.comun), datasets: [{ data: st.top_especies.map(s => s.n), backgroundColor: '#3aa06a', borderRadius: 6 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { grid: { color: grid } }, y: { grid: { display: false } } }, maintainAspectRatio: false },
  });

  const o = st.origen;
  new Chart('c-origen', {
    type: 'doughnut',
    data: { labels: ['Introducida', 'Ornamental', 'Nativa', 'Sin dato'], datasets: [{ data: [o.introducida, o.ornamental, o.nativa, o.sin_dato], backgroundColor: ['#2e7ab8', '#e0a127', '#256b47', '#c3ccc6'] }] },
    options: { plugins: { legend: { position: 'bottom' } }, cutout: '58%', maintainAspectRatio: false },
  });

  new Chart('c-familia', {
    type: 'bar',
    data: { labels: st.top_familias.map(f => f.familia), datasets: [{ data: st.top_familias.map(f => f.n), backgroundColor: palette, borderRadius: 6 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { grid: { color: grid } }, y: { grid: { display: false } } }, maintainAspectRatio: false },
  });

  const sec = st.sectores.filter(s => s.n > 1);
  new Chart('c-sector', {
    type: 'polarArea',
    data: { labels: sec.map(s => s.sector), datasets: [{ data: sec.map(s => s.n), backgroundColor: palette.map(c => c + 'cc') }] },
    options: { plugins: { legend: { position: 'bottom' } }, maintainAspectRatio: false },
  });

  new Chart('c-altura', {
    type: 'bar',
    data: { labels: st.altura_dist.map(d => d.label), datasets: [{ data: st.altura_dist.map(d => d.n), backgroundColor: '#57bd82', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: grid } } }, maintainAspectRatio: false },
  });

  new Chart('c-dap', {
    type: 'bar',
    data: { labels: st.dap_dist.map(d => d.label + ' cm'), datasets: [{ data: st.dap_dist.map(d => d.n), backgroundColor: '#e0a127', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: grid } } }, maintainAspectRatio: false },
  });
}
