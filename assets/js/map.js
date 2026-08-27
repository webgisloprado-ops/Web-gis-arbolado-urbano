// ============================================================================
// map.js — gestor de mapa WebGIS (Leaflet + clustering + heatmap)
// ============================================================================
import { loadScript } from './util.js';

let libsReady = null;
export function ensureMapLibs() {
  if (libsReady) return libsReady;
  libsReady = (async () => {
    await loadScript(window.__CDN.leaflet);
    await Promise.all([loadScript(window.__CDN.cluster), loadScript(window.__CDN.heat)]);
  })();
  return libsReady;
}

export const BASEMAPS = {
  street: { name: 'Callejero', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap', max: 19 },
  satelite: { name: 'Satélite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '© Esri, Maxar', max: 19 },
  topo: { name: 'Topográfico', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '© OpenTopoMap', max: 17 },
  claro: { name: 'Claro', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attribution: '© CARTO © OSM', max: 20 },
};

export class TreeMap {
  constructor(container, opts = {}) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.opts = opts;
    this.map = null;
    this.baseLayer = null;
    this.cluster = null;
    this.heat = null;
    this.mode = 'cluster';
    this._features = [];
  }

  async init(center = [-33.475, -70.72], zoom = 13) {
    await ensureMapLibs();
    const L = window.L;
    this.map = L.map(this.container, {
      center, zoom, zoomControl: false, preferCanvas: true, attributionControl: this.opts.attribution !== false,
    });
    if (this.opts.zoomControl !== false) L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    this.setBasemap('street');
    return this;
  }

  setBasemap(key) {
    const L = window.L;
    const b = BASEMAPS[key]; if (!b) return;
    if (this.baseLayer) this.map.removeLayer(this.baseLayer);
    this.baseLayer = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.max, crossOrigin: true }).addTo(this.map);
    this.currentBase = key;
  }

  _iconFor() {
    const L = window.L;
    this._icon = this._icon || L.divIcon({ className: '', html: '<div class="tree-dot"></div>', iconSize: [14, 14], iconAnchor: [7, 13], popupAnchor: [0, -12] });
    return this._icon;
  }

  // Renderiza el conjunto filtrado. onSelect(props) al hacer clic.
  render(features, { onSelect, fit = false } = {}) {
    const L = window.L;
    this._features = features;
    this._clearLayers();

    if (this.mode === 'heat') {
      const pts = features.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0], 0.6]);
      this.heat = L.heatLayer(pts, { radius: 18, blur: 22, maxZoom: 17, gradient: { 0.2: '#8fd6ab', 0.4: '#3aa06a', 0.7: '#256b47', 1: '#123524' } }).addTo(this.map);
    } else {
      this.cluster = L.markerClusterGroup({
        chunkedLoading: true, maxClusterRadius: 55, spiderfyOnMaxZoom: true,
        iconCreateFunction: cl => {
          const n = cl.getChildCount();
          const size = n < 20 ? 34 : n < 100 ? 42 : n < 1000 ? 52 : 62;
          return L.divIcon({
            html: `<div style="width:${size}px;height:${size}px;display:grid;place-items:center;border-radius:50%;
              background:radial-gradient(circle at 35% 30%, #57bd82, #256b47);color:#fff;font-weight:700;
              border:3px solid rgba(255,255,255,.85);box-shadow:0 3px 10px rgba(18,53,36,.4);font-size:${n>999?'.72rem':'.85rem'}">${n>999?(n/1000).toFixed(1)+'k':n}</div>`,
            className: '', iconSize: [size, size],
          });
        },
      });
      const icon = this._iconFor();
      const chunk = features;
      const markers = chunk.map(f => {
        const [lon, lat] = f.geometry.coordinates;
        const m = L.marker([lat, lon], { icon });
        m.on('click', () => onSelect && onSelect(f.properties, f));
        return m;
      });
      this.cluster.addLayers(markers);
      this.map.addLayer(this.cluster);
    }
    if (fit && features.length) this.fitTo(features);
  }

  fitTo(features) {
    const L = window.L;
    if (!features.length) return;
    const b = L.latLngBounds(features.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]));
    this.map.fitBounds(b.pad(0.08), { maxZoom: 16 });
  }

  setMode(mode) { this.mode = mode; this.render(this._features, { onSelect: this._onSelect }); }

  _clearLayers() {
    if (this.cluster) { this.map.removeLayer(this.cluster); this.cluster = null; }
    if (this.heat) { this.map.removeLayer(this.heat); this.heat = null; }
  }

  locate() {
    this.map.locate({ setView: true, maxZoom: 16 });
    this.map.once('locationfound', e => {
      const L = window.L;
      L.circleMarker(e.latlng, { radius: 8, color: '#2e7ab8', fillColor: '#2e7ab8', fillOpacity: .5, weight: 3 })
        .addTo(this.map).bindPopup('Tu ubicación').openPopup();
    });
    this.map.once('locationerror', () => this.opts.onLocateError && this.opts.onLocateError());
  }

  flyToTree(feature, zoom = 18) {
    const [lon, lat] = feature.geometry.coordinates;
    this.map.flyTo([lat, lon], zoom, { duration: .8 });
  }

  invalidate() { setTimeout(() => this.map && this.map.invalidateSize(), 60); }
  destroy() { if (this.map) { this.map.remove(); this.map = null; } }
}
