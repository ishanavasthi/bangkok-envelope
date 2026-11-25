import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode, ValidateNotSelfIntersecting } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import './style.css';
import { centroid, distM, makeFrame, type Frame, type LngLat } from './engine/geo';
import { area, intersect, pointInRing, segDist, toPolygons, type Pt, type Rings } from './engine/poly';
import {
  applicableRules, baseFootprint, designs, envelope, fmt, limits, roadSetback, TYPES,
  type BuildingType, type Design, type Input, type Regime,
} from './engine/model';
import zoneY10 from './data/zone-y10.geojson?raw';
import zonesCtx from './data/zones-context.geojson?raw';
import stationsRaw from './data/stations.json';
import rulesJson from './rules/rules.json';

type FC = GeoJSON.FeatureCollection;
const ZONE: FC = JSON.parse(zoneY10);
const CTX: FC = JSON.parse(zonesCtx);
const STATIONS = (stationsRaw as { stations: { name: string; nameTh: string; lng: number; lat: number; network: string }[] }).stations;
const SOURCES = rulesJson.sources as Record<string, { title: string; url: string }>;

// Sample plot: an irregular six-sided lot on Soi Sukhumvit 39 (Phrom Phong), zone ย.10-4.
const SAMPLE: LngLat[] = [
  [100.5725355, 13.738601], [100.5725355, 13.739017], [100.5727574, 13.7390442],
  [100.5729609, 13.7389266], [100.5729146, 13.7387096], [100.5727389, 13.738583],
];

interface State {
  ring: LngLat[]; // open ring
  roadSegs: [LngLat, LngLat][]; // road-facing edges, kept by position so edits don't lose them
  roadWidth: number;
  type: BuildingType;
  farBonus: number;
  envelope: Regime | 'none';
  selected: string;
  drawing: boolean;
}
const st: State = {
  ring: SAMPLE,
  roadSegs: [[SAMPLE[0], SAMPLE[1]]],
  roadWidth: 12,
  type: 'condo',
  farBonus: 0,
  envelope: 'high',
  selected: 'B',
  drawing: false,
};

// ---------- map ----------
// MapLibre 6 finds its worker next to its own module; once bundled, point it at the copied asset.
maplibregl.setWorkerUrl(workerUrl);
const map: MLMap = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [100.57274, 13.73893],
  zoom: 18.15,
  pitch: 62,
  bearing: -35,
  maxPitch: 80,
  attributionControl: { compact: true },
  canvasContextAttributes: { antialias: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

let draw: TerraDraw;
const empty: FC = { type: 'FeatureCollection', features: [] };

map.on('load', () => {
  styleBaseMap();
  map.addSource('zones', { type: 'geojson', data: CTX });
  map.addSource('plot', { type: 'geojson', data: empty });
  map.addSource('edges', { type: 'geojson', data: empty });
  map.addSource('ground', { type: 'geojson', data: empty });
  map.addSource('env', { type: 'geojson', data: empty });
  map.addSource('design', { type: 'geojson', data: empty });
  map.addSource('stations', { type: 'geojson', data: { type: 'FeatureCollection', features: STATIONS.map((s) => ({ type: 'Feature', properties: { name: s.name }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })) } });

  const below = map.getLayer('building-3d') ? 'building-3d' : undefined;
  map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: {
    'fill-color': ['case', ['==', ['get', 'LUP_ZONE'], 'ย.๑๐'], '#a0663a', 'rgba(0,0,0,0)'],
    'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.22, 16, 0.07],
  } }, below);
  map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: {
    'line-color': ['case', ['==', ['get', 'LUP_ZONE'], 'ย.๑๐'], '#8a5128', '#9aa0a6'],
    'line-width': ['case', ['==', ['get', 'LUP_ZONE'], 'ย.๑๐'], 2, 0.7],
    'line-dasharray': [3, 2],
  } }, below);
  map.addLayer({ id: 'zones-label', type: 'symbol', source: 'zones', minzoom: 13, layout: {
    'text-field': ['concat', ['get', 'LUP_SUBZONE'], '\nFAR ', ['to-string', ['get', 'LUP_FAR']]],
    'text-size': 11, 'text-font': ['Noto Sans Regular'],
  }, paint: { 'text-color': '#6b4423', 'text-halo-color': '#fff', 'text-halo-width': 1.4, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 13, 1, 16.5, 0] } });
  map.addLayer({ id: 'ground-fill', type: 'fill', source: 'ground', paint: {
    'fill-color': ['match', ['get', 'kind'], 'plot', '#d8ead2', 'base', 'rgba(0,0,0,0)', '#ccc'],
    'fill-opacity': 0.85,
  } }, below);
  map.addLayer({ id: 'ground-line', type: 'line', source: 'ground', paint: {
    'line-color': ['match', ['get', 'kind'], 'base', '#0f6e74', '#0f3d3e'],
    'line-width': ['match', ['get', 'kind'], 'base', 1.6, 2],
    'line-dasharray': ['match', ['get', 'kind'], 'base', ['literal', [2, 1.5]], ['literal', [1, 0]]],
  } }, below);
  map.addLayer({ id: 'edges-hit', type: 'line', source: 'edges', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 22 } });
  map.addLayer({ id: 'edges', type: 'line', source: 'edges', layout: { 'line-cap': 'round' }, paint: {
    'line-color': ['case', ['get', 'road'], '#e07a1f', '#0f3d3e'],
    'line-width': ['case', ['get', 'road'], 7, 2.5],
  } });
  map.addLayer({ id: 'edges-label', type: 'symbol', source: 'edges', layout: {
    'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-size': 11, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, -1.1], 'text-allow-overlap': true,
  }, paint: { 'text-color': ['case', ['get', 'road'], '#a24d06', '#0f3d3e'], 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
  map.addLayer({ id: 'env', type: 'fill-extrusion', source: 'env', paint: {
    'fill-extrusion-color': ['get', 'color'],
    'fill-extrusion-base': ['get', 'base'],
    'fill-extrusion-height': ['get', 'top'],
    'fill-extrusion-opacity': 0.26,
  } });
  map.addLayer({ id: 'design', type: 'fill-extrusion', source: 'design', paint: {
    'fill-extrusion-color': ['get', 'color'],
    'fill-extrusion-base': ['get', 'base'],
    'fill-extrusion-height': ['get', 'top'],
    'fill-extrusion-opacity': 0.96,
    'fill-extrusion-vertical-gradient': true,
  } });
  map.addLayer({ id: 'stations', type: 'circle', source: 'stations', paint: { 'circle-radius': 5, 'circle-color': '#1f5fbf', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'stations-label', type: 'symbol', source: 'stations', layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#1f5fbf', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });

  map.on('click', 'edges-hit', (e) => {
    if (st.drawing) return;
    const f = e.features?.[0];
    if (!f) return;
    toggleRoad(Number(f.properties!.i));
  });
  map.on('mouseenter', 'edges-hit', () => { if (!st.drawing) map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'edges-hit', () => { map.getCanvas().style.cursor = ''; });

  setupDraw();
  map.on('idle', hideBuildingsOnPlot);
  update();
});

function styleBaseMap() {
  // Calm, client-friendly basemap: muted neighbours, real heights kept.
  if (map.getLayer('building-3d')) {
    map.setPaintProperty('building-3d', 'fill-extrusion-color', ['interpolate', ['linear'], ['get', 'render_height'], 0, '#e7e3dc', 30, '#d9d4cb', 120, '#c9c3b8']);
    map.setPaintProperty('building-3d', 'fill-extrusion-opacity', 0.92);
  }
  for (const l of map.getStyle().layers) {
    if (l.type === 'symbol' && /poi|housenumber/.test(l.id)) map.setLayoutProperty(l.id, 'visibility', 'none');
  }
}

// ---------- drawing ----------
function setupDraw() {
  draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawPolygonMode({
        validation: (f) => ValidateNotSelfIntersecting(f),
        styles: { fillColor: '#0f6e74', fillOpacity: 0.15, outlineColor: '#0f3d3e', outlineWidth: 2, closingPointColor: '#e07a1f', closingPointWidth: 6 },
      }),
      new TerraDrawSelectMode({
        flags: {
          polygon: {
            feature: {
              draggable: true,
              validation: (f) => ValidateNotSelfIntersecting(f),
              coordinates: { draggable: true, midpoints: { draggable: true }, deletable: true },
            },
          },
        },
        styles: {
          selectedPolygonColor: '#0f6e74', selectedPolygonFillOpacity: 0.08, selectedPolygonOutlineColor: '#0f3d3e', selectedPolygonOutlineWidth: 1,
          selectionPointColor: '#ffffff', selectionPointOutlineColor: '#0f3d3e', selectionPointWidth: 5, selectionPointOutlineWidth: 2,
          midPointColor: '#0f6e74', midPointOutlineColor: '#ffffff', midPointWidth: 3,
        },
      }),
    ],
  });
  draw.start();
  loadRingIntoDraw();
  let pending = 0;
  draw.on('change', (ids, type) => {
    if (st.drawing || type === 'styling') return;
    const f = draw.getSnapshot().find((x) => x.geometry.type === 'Polygon');
    if (!f || !ids.includes(f.id as never)) return;
    const coords = (f.geometry as GeoJSON.Polygon).coordinates[0].slice(0, -1) as LngLat[];
    if (coords.length < 3) return;
    st.ring = coords;
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => update());
  });
  draw.on('finish', (id, ctx) => {
    if (!st.drawing || ctx.action !== 'draw') return;
    const f = draw.getSnapshotFeature(id);
    if (!f || f.geometry.type !== 'Polygon') return;
    st.ring = (f.geometry.coordinates[0] as LngLat[]).slice(0, -1);
    st.drawing = false;
    st.roadSegs = autoDetectRoad(st.ring);
    loadRingIntoDraw();
    update();
    renderPanel();
  });
}

function loadRingIntoDraw() {
  draw.clear();
  draw.setMode('select');
  const [id] = draw.addFeatures([{ type: 'Feature', properties: { mode: 'polygon' }, geometry: { type: 'Polygon', coordinates: [[...st.ring, st.ring[0]]] } }]).map((v) => v.id);
  if (id !== undefined) draw.selectFeature(id);
}

function startDrawing() {
  st.drawing = true;
  draw.clear();
  draw.setMode('polygon');
  renderPanel();
  update();
}

const ROAD_W: Record<string, number> = { motorway: 40, trunk: 40, primary: 30, secondary: 20, tertiary: 12, minor: 8, service: 6 };
/** Mark the edge(s) nearest to a mapped road and guess its width from the road class. */
function autoDetectRoad(ring: LngLat[]): [LngLat, LngLat][] {
  const f = makeFrame(centroid(ring));
  const pts = ring.map(f.toLocal);
  const xs = ring.map((p) => map.project(p as [number, number]));
  const pad = 80;
  const bbox: [[number, number], [number, number]] = [
    [Math.min(...xs.map((p) => p.x)) - pad, Math.min(...xs.map((p) => p.y)) - pad],
    [Math.max(...xs.map((p) => p.x)) + pad, Math.max(...xs.map((p) => p.y)) + pad],
  ];
  const roads = map.queryRenderedFeatures(bbox).filter((x) => x.sourceLayer === 'transportation' && x.geometry.type.includes('LineString') && !/rail|path|track|pedestrian/.test(String(x.properties.class)));
  let best = { i: 0, d: Infinity, cls: 'minor' };
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const r of roads) {
      const lines = r.geometry.type === 'LineString' ? [r.geometry.coordinates] : (r.geometry as GeoJSON.MultiLineString).coordinates;
      for (const line of lines) for (let k = 0; k + 1 < line.length; k++) {
        const d = segDist(mid, f.toLocal(line[k] as LngLat), f.toLocal(line[k + 1] as LngLat));
        if (d < best.d) best = { i, d, cls: String(r.properties.class) };
      }
    }
  });
  if (best.d < 40) st.roadWidth = ROAD_W[best.cls] ?? 8;
  return [[ring[best.i], ring[(best.i + 1) % ring.length]]];
}

// ---------- model glue ----------
function roadEdgeIdx(ring: LngLat[], frame: Frame): number[] {
  const pts = ring.map(frame.toLocal);
  const segs = st.roadSegs.map(([a, b]) => [frame.toLocal(a), frame.toLocal(b)] as [Pt, Pt]);
  const out: number[] = [];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (segs.some(([p, q]) => segDist(mid, p, q) < 1.5)) out.push(i);
  });
  return out;
}

function toggleRoad(i: number) {
  const n = st.ring.length;
  const seg: [LngLat, LngLat] = [st.ring[i], st.ring[(i + 1) % n]];
  const frame = makeFrame(centroid(st.ring));
  const idx = roadEdgeIdx(st.ring, frame);
  if (idx.includes(i)) {
    const mid = frame.toLocal([(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2]);
    st.roadSegs = st.roadSegs.filter(([a, b]) => segDist(mid, frame.toLocal(a), frame.toLocal(b)) >= 1.5);
  } else st.roadSegs = [...st.roadSegs, seg];
  update();
}

let last: { inp: Input; frame: Frame; ds: Design[]; zoneName: string; station: { name: string; d: number } } | null = null;

function zoneShare(frame: Frame, plot: Pt[]): { share: number; name: string } {
  const A = Math.abs(area([plot]));
  let inside = 0;
  let name = '';
  for (const f of ZONE.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : (f.geometry as GeoJSON.MultiPolygon).coordinates;
    for (const poly of polys) {
      const rings: Rings = poly.map((r) => r.slice(0, -1).map((p) => frame.toLocal(p as LngLat)));
      const a = area(intersect([plot], rings));
      if (a > 0) { inside += a; name = String(f.properties!.LUP_SUBZONE); }
    }
  }
  if (!name) {
    // Not in Y.10: say which zone it is in, so the user knows why.
    const c = frame.toLocal(centroid(st.ring));
    for (const f of CTX.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : (f.geometry as GeoJSON.MultiPolygon).coordinates;
      for (const poly of polys) {
        const outer = poly[0].slice(0, -1).map((p) => frame.toLocal(p as LngLat));
        if (pointInRing(c, outer)) name = `${f.properties!.LUP_SUBZONE} (FAR ${f.properties!.LUP_FAR})`;
      }
    }
  }
  return { share: A ? Math.min(1, inside / A) : 0, name };
}

function nearestStation(c: LngLat) {
  let best = { name: '', d: Infinity };
  for (const s of STATIONS) {
    const d = distM(c, [s.lng, s.lat]);
    if (d < best.d) best = { name: s.name, d };
  }
  return best;
}

function update() {
  const ring = st.ring;
  if (st.drawing || ring.length < 3) {
    setData('plot', empty); setData('edges', empty); setData('ground', empty); setData('env', empty); setData('design', empty);
    renderPanel();
    return;
  }
  const c = centroid(ring);
  const frame = makeFrame(c);
  const plot = ring.map(frame.toLocal);
  const z = zoneShare(frame, plot);
  const station = nearestStation(c);
  const inp: Input = {
    plot, roadEdges: roadEdgeIdx(ring, frame), roadWidth: st.roadWidth, type: st.type,
    farBonus: st.farBonus, nearStation: station.d <= 500, inZoneShare: z.share,
  };
  const ds = designs(inp);
  if (!ds.find((d) => d.id === st.selected)) st.selected = ds[0].id;
  last = { inp, frame, ds, zoneName: z.name, station };
  drawMap(inp, frame, ds);
  renderPanel();
}

function setData(id: string, fc: FC) {
  const s = map.getSource(id) as GeoJSONSource | undefined;
  if (s) s.setData(fc);
}

function ringsToFeatures(rings: Rings, frame: Frame, props: Record<string, unknown>): GeoJSON.Feature[] {
  return toPolygons(rings).map((poly) => ({
    type: 'Feature', properties: props,
    geometry: { type: 'Polygon', coordinates: poly.map((r) => { const ll = r.map(frame.toLngLat); return [...ll, ll[0]]; }) },
  }));
}

function drawMap(inp: Input, frame: Frame, ds: Design[]) {
  const n = inp.plot.length;
  const edgesFC: FC = { type: 'FeatureCollection', features: inp.plot.map((a, i) => {
    const b = inp.plot[(i + 1) % n];
    const road = inp.roadEdges.includes(i);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { type: 'Feature', properties: { i, road, label: road ? `ROAD ${fmt(len)} m` : `${fmt(len)} m` }, geometry: { type: 'LineString', coordinates: [frame.toLngLat(a), frame.toLngLat(b)] } };
  }) };
  setData('edges', edgesFC);
  const d = ds.find((x) => x.id === st.selected)!;
  const ground: GeoJSON.Feature[] = [...ringsToFeatures([inp.plot], frame, { kind: 'plot' })];
  const regime: Regime = st.envelope === 'none' ? d.regime : st.envelope;
  ground.push(...ringsToFeatures(baseFootprint(inp, regime), frame, { kind: 'base' }));
  setData('ground', { type: 'FeatureCollection', features: ground });

  const envFeats: GeoJSON.Feature[] = [];
  if (st.envelope !== 'none') {
    const env = envelope(inp, st.envelope, 3);
    for (const s of env) envFeats.push(...ringsToFeatures(s.rings, frame, { base: s.z0, top: s.z1, color: st.envelope === 'high' ? '#2b8cbe' : '#41ab5d' }));
  }
  setData('env', { type: 'FeatureCollection', features: envFeats });

  const df: GeoJSON.Feature[] = [];
  const palette = d.pass ? ['#f4efe6', '#e9e1d2'] : ['#f3c7bd', '#eab0a3'];
  d.floors.forEach((fl, k) => {
    const gap = fl.n === 1 ? 0 : 0.22;
    df.push(...ringsToFeatures(fl.rings, frame, { base: fl.z0 + gap, top: fl.z1, color: k === 0 ? '#c9b99a' : palette[k % 2] }));
  });
  setData('design', { type: 'FeatureCollection', features: df });
  setData('plot', empty);
  hideBuildingsOnPlot();
}

let hiddenKey = '';
function hideBuildingsOnPlot() {
  if (!map.getLayer('building-3d') || !last || st.drawing) return;
  const ring = st.ring;
  const xs = ring.map((p) => map.project(p as [number, number]));
  const bbox: [[number, number], [number, number]] = [[Math.min(...xs.map((p) => p.x)), Math.min(...xs.map((p) => p.y))], [Math.max(...xs.map((p) => p.x)), Math.max(...xs.map((p) => p.y))]];
  const frame = last.frame;
  const plot = ring.map(frame.toLocal);
  const ids = new Set<number | string>();
  for (const f of map.queryRenderedFeatures(bbox, { layers: ['building-3d'] })) {
    if (f.id === undefined) continue;
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const r = poly[0].slice(0, -1).map((p) => frame.toLocal(p as LngLat));
      const a = Math.abs(area([r]));
      if (a > 0 && area(intersect([plot], [r])) / a > 0.3) ids.add(f.id);
    }
  }
  const key = [...ids].sort().join(',');
  if (key === hiddenKey) return;
  hiddenKey = key;
  map.setFilter('building-3d', ids.size ? ['!', ['in', ['id'], ['literal', [...ids]]]] : null);
}

// ---------- panel ----------
const panel = document.getElementById('panel')!;
const thaiArea = (A: number) => {
  const rai = Math.floor(A / 1600), ngan = Math.floor((A % 1600) / 400), wah = (A % 400) / 4;
  return `${rai}-${ngan}-${fmt(wah, 0)} rai`;
};
/** ย.๑๐-๔ -> Y.10-4 (zone letters per the plan's colour classes). */
const latinZone = (z: string) => z
  .replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)))
  .replace('ย', 'Y').replace('พ', 'C').replace('อ', 'I').replace('ก', 'A').replace('ศ', 'H').replace('ส', 'G');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function refLink(ref: string) {
  const src = /MR 33/.test(ref) ? SOURCES.mr33 : /BMA ord/.test(ref) ? SOURCES.bmaOrd2544 : /MR 55/.test(ref) ? SOURCES.mr55 : /Plan/.test(ref) ? SOURCES.plan2556 : null;
  return src ? `<a class="ref" href="${src.url}" target="_blank" rel="noopener" title="${esc(src.title)}">${esc(ref)}</a>` : `<span class="ref">${esc(ref)}</span>`;
}

function renderPanel() {
  const keep = panel.scrollTop;
  renderPanelInner();
  panel.scrollTop = keep;
}
function renderPanelInner() {
  const L = last;
  const head = `
    <header class="brand">
      <div class="mark" aria-hidden="true"></div>
      <div><h1>Plot Envelope</h1><p>What can you build on a Bangkok plot? Zone ย.10 (Y.10), high-density residential.</p></div>
    </header>`;
  if (st.drawing || !L) {
    panel.innerHTML = head + `
      <section class="card focus">
        <h2>Draw your plot</h2>
        <p class="muted">Click on the map to place each corner. Click the first corner again to close the shape. Any shape works. Brown hatched areas are zone Y.10.</p>
        <div class="row"><button class="btn ghost" id="cancelDraw">Cancel</button></div>
      </section>`;
    panel.querySelector('#cancelDraw')?.addEventListener('click', () => { st.drawing = false; loadRingIntoDraw(); update(); });
    return;
  }
  const { inp, ds, zoneName, station } = L;
  const lim = limits(inp);
  const d = ds.find((x) => x.id === st.selected)!;
  const frontage = inp.roadEdges.reduce((s, i) => { const a = inp.plot[i], b = inp.plot[(i + 1) % inp.plot.length]; return s + Math.hypot(b[0] - a[0], b[1] - a[1]); }, 0);
  const inZone = inp.inZoneShare > 0.99;
  const rules = applicableRules(inp);
  const passCount = ds.filter((x) => x.pass).length;

  panel.innerHTML = head + `
    <section class="card">
      <div class="cardhead"><h2>1 · Plot</h2>
        <div class="btns"><button class="btn small" id="redraw">Draw new plot</button><button class="btn small ghost" id="reset">Sample plot</button></div></div>
      <div class="stats">
        <div><b>${fmt(lim.A, 0)} m²</b><span>${thaiArea(lim.A)}</span></div>
        <div><b class="${inZone ? 'ok' : 'bad'}">${inZone ? '✓ ' : '✗ '}${esc(zoneName ? latinZone(zoneName) : 'No zone')}</b><span>${inZone ? `inside zone Y.10 · ${esc(zoneName)}` : `${fmt(inp.inZoneShare * 100, 0)}% in Y.10: out of scope`}</span></div>
        <div><b>${fmt(station.d, 0)} m</b><span>to ${esc(station.name)} station${inp.nearStation ? ' (≤ 500 m)' : ''}</span></div>
      </div>
      <p class="hint">Drag the corners to reshape. Drag a mid-point to add a corner. Select a corner and press Delete to remove it.</p>
    </section>

    <section class="card">
      <div class="cardhead"><h2>2 · Road</h2></div>
      <p class="hint">Click a plot edge on the map to mark it as road frontage (orange).</p>
      <label class="field"><span>Road width (right of way)</span>
        <div class="inline"><input type="range" id="rw" min="4" max="40" step="0.5" value="${st.roadWidth}"><output>${fmt(st.roadWidth)} m</output></div></label>
      <div class="chips">${[6, 8, 10, 12, 16, 20, 30].map((w) => `<button class="chip ${st.roadWidth === w ? 'on' : ''}" data-w="${w}">${w} m</button>`).join('')}</div>
      <p class="kv">Frontage <b>${fmt(frontage)} m</b> on ${inp.roadEdges.length} edge${inp.roadEdges.length === 1 ? '' : 's'} · Road setback <b>${fmt(roadSetback(st.roadWidth).d, 2)} m</b></p>
      ${inp.roadEdges.length ? '' : '<p class="warn">No road edge is marked. Height limits are measured from the road, so click the edge that faces it.</p>'}
    </section>

    <section class="card">
      <div class="cardhead"><h2>3 · Building type</h2></div>
      <div class="seg">${(Object.keys(TYPES) as BuildingType[]).map((t) => `<button class="${st.type === t ? 'on' : ''}" data-type="${t}">${TYPES[t].label}</button>`).join('')}</div>
      <p class="hint">${esc(TYPES[st.type].note)}</p>
      <label class="field"><span>FAR bonus (affordable units, public space, rain tanks, green building), capped at +20%</span>
        <select id="bonus">${[0, 0.05, 0.1, 0.15, 0.2].map((b) => `<option value="${b}" ${st.farBonus === b ? 'selected' : ''}>${b ? '+' + b * 100 + '%' : 'None'}</option>`).join('')}</select></label>
    </section>

    <section class="card">
      <div class="cardhead"><h2>4 · Rules that apply</h2></div>
      <ul class="rules">${rules.map((r) => `<li><div class="rl">${esc(r.label)}</div><div class="rv">${esc(r.value)}</div>${refLink(r.ref)}</li>`).join('')}</ul>
    </section>

    <section class="card">
      <div class="cardhead"><h2>5 · Allowed space</h2></div>
      <div class="seg">
        <button class="${st.envelope === 'low' ? 'on' : ''}" data-env="low">Below 23 m</button>
        <button class="${st.envelope === 'high' ? 'on' : ''}" data-env="high">High-rise</button>
        <button class="${st.envelope === 'none' ? 'on' : ''}" data-env="none">Hide</button>
      </div>
      <p class="hint">${st.envelope === 'low' ? 'Green volume: below 23 m and 10,000 m², setbacks are 3 m from neighbours (ord. 54) plus the road setback.' : st.envelope === 'high' ? 'Blue volume: once a building is 23 m+ or 10,000 m²+, it must stay 6 m from every edge (MR 33). The top steps back from the road under the 2:1 height plane (ord. 49).' : 'Envelope hidden.'} The dashed line on the ground is the footprint limit.</p>
    </section>

    <section class="card">
      <div class="cardhead"><h2>6 · Concept designs</h2><span class="pill ${passCount >= 2 ? 'ok' : 'bad'}">${passCount} of ${ds.length} pass</span></div>
      <div class="designs">${ds.map((x) => `
        <button class="design ${x.id === st.selected ? 'on' : ''}" data-design="${x.id}">
          <div class="dh"><span class="did">${x.id}</span><b>${esc(x.name)}</b><span class="badge ${x.pass ? 'ok' : 'bad'}">${x.pass ? 'PASS' : 'FAIL'}</span></div>
          <div class="dm">${x.floors.length} fl · ${fmt(x.height, 0)} m · ${fmt(x.gfa, 0)} m² · FAR ${fmt(x.far, 2)}</div>
        </button>`).join('')}</div>
      <div class="detail">
        <p class="muted">${esc(d.summary)}</p>
        <div class="stats four">
          <div><b>${fmt(d.gfa, 0)}</b><span>m² floor area</span></div>
          <div><b>${d.floors.length}</b><span>floors · ${fmt(d.height)} m</span></div>
          <div><b>${fmt(lim.A ? (d.footprint / lim.A) * 100 : 0, 0)}%</b><span>coverage</span></div>
          <div><b>${fmt(d.openSpace, 0)}</b><span>m² open space</span></div>
        </div>
        <p class="kv">${esc(d.units ?? '')}</p>
        <table class="checks"><thead><tr><th></th><th>Check</th><th>Required</th><th>This design</th></tr></thead><tbody>
          ${d.checks.map((c) => `<tr class="${c.pass ? '' : 'fail'}"><td class="ic">${c.pass ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'}</td><td>${esc(c.label)}<div>${refLink(c.ref)}${c.note ? ` <span class="muted small">${esc(c.note)}</span>` : ''}</div></td><td>${esc(c.required)}</td><td>${esc(c.actual)}</td></tr>`).join('')}
        </tbody></table>
        <details class="floors"><summary>Floor-by-floor areas (${d.floors.length} floors)</summary>
          <table><thead><tr><th>Floor</th><th>Level (m)</th><th>Area m²</th><th>Running total</th></tr></thead><tbody>
          ${(() => { let run = 0; return d.floors.map((f) => { run += f.area; return `<tr><td>${f.n}</td><td>${fmt(f.z0)}–${fmt(f.z1)}</td><td>${fmt(f.area, 1)}</td><td>${fmt(run, 0)}</td></tr>`; }).join(''); })()}
          <tr class="tot"><td colspan="2">Total</td><td>${fmt(d.gfa, 1)}</td><td>FAR ${fmt(d.far, 3)}</td></tr></tbody></table>
        </details>
      </div>
    </section>

    <section class="card sources">
      <h2>Sources and assumptions</h2>
      <p class="muted small">Rules come from the Bangkok Comprehensive Plan B.E. 2556 (2013, still in force; the 2026 draft is not law yet), the Bangkok Building Control Ordinance 2544, and Ministerial Regulation 33. Zone boundaries come from the BMA City Planning GIS. Neighbouring buildings and roads come from OpenStreetMap, and only about 1 in 10 buildings has a mapped height. Station distance is measured from the station point, not the platform edge. Not modelled: airport and heritage height controls, parking, EIA. This is a feasibility sketch, not a permit check.</p>
      <ul class="srcs">${Object.values(SOURCES).map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul>
    </section>`;

  panel.querySelector('#redraw')!.addEventListener('click', startDrawing);
  panel.querySelector('#reset')!.addEventListener('click', () => {
    st.ring = SAMPLE; st.roadSegs = [[SAMPLE[0], SAMPLE[1]]]; st.roadWidth = 12;
    loadRingIntoDraw(); update();
    map.easeTo({ center: [100.57274, 13.73893], zoom: 18.15, pitch: 62, bearing: -35 });
  });
  const rw = panel.querySelector<HTMLInputElement>('#rw')!;
  rw.addEventListener('input', () => { st.roadWidth = Number(rw.value); rw.nextElementSibling!.textContent = `${fmt(st.roadWidth)} m`; scheduleUpdate(); });
  panel.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => b.addEventListener('click', () => { st.roadWidth = Number(b.dataset.w); update(); }));
  panel.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((b) => b.addEventListener('click', () => { st.type = b.dataset.type as BuildingType; update(); }));
  panel.querySelector<HTMLSelectElement>('#bonus')!.addEventListener('change', (e) => { st.farBonus = Number((e.target as HTMLSelectElement).value); update(); });
  panel.querySelectorAll<HTMLButtonElement>('[data-env]').forEach((b) => b.addEventListener('click', () => { st.envelope = b.dataset.env as State['envelope']; update(); }));
  panel.querySelectorAll<HTMLButtonElement>('[data-design]').forEach((b) => b.addEventListener('click', () => {
    st.selected = b.dataset.design!;
    const dd = last!.ds.find((x) => x.id === st.selected)!;
    if (st.envelope !== 'none') st.envelope = dd.regime;
    update();
  }));
  renderLegend(d);
}

let sched = 0;
function scheduleUpdate() {
  if (sched) return;
  sched = requestAnimationFrame(() => { sched = 0; updateKeepPanelFocus(); });
}
function updateKeepPanelFocus() {
  const active = document.activeElement?.id;
  const scroll = panel.scrollTop;
  update();
  panel.scrollTop = scroll;
  if (active) (document.getElementById(active) as HTMLElement | null)?.focus();
}

function renderLegend(d: Design) {
  const el = document.getElementById('legend')!;
  el.innerHTML = `
    <div class="lg"><i class="sw road"></i>Road frontage</div>
    <div class="lg"><i class="sw base"></i>Footprint limit</div>
    <div class="lg"><i class="sw ${st.envelope === 'low' ? 'envl' : 'envh'}"></i>Allowed space</div>
    <div class="lg"><i class="sw ${d.pass ? 'des' : 'desbad'}"></i>Design ${d.id}: ${d.pass ? 'passes' : 'fails'}</div>`;
}
