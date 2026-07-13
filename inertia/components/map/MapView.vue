<script setup lang="ts">
import {onMounted, ref, watch} from "vue";
import {GeoJSONSource, LngLatBounds, Map, Marker, NavigationControl, Popup, ScaleControl} from "mapbox-gl";
import {storeToRefs} from "pinia";
import {useLocationStore} from "~/composables/stores/useLocationStore";
import useMapbox, {Feature} from "~/composables/map/useMapbox";
import {RouteGeometry} from "~/composables/engine/useOptimizer";
import {RouteVariantKey} from "~/components/sidebar/RouteSwitcher.vue";

export type DisplayedRoute = {
  key: RouteVariantKey;
  geometry: RouteGeometry;
};

type TollFeature = {
  type: 'Feature';
  geometry: {type: 'Point'; coordinates: [number, number]};
  properties: Record<string, any>;
};

// Distance max (en mètres) entre un péage et la route pour le considérer "sur la route"
const TOLL_ROUTE_THRESHOLD_M = 500;

const store = useLocationStore();

const map = ref<HTMLDivElement>();
const tollsVisible = ref<boolean>(true);
const {start, end} = storeToRefs(store);

let mapbox: Map;
let startMarker: Marker;
let endMarker: Marker;
let tollFeatures: TollFeature[] = [];
let routeCoordsList: [number, number][][] = [];
const hasRoute = ref<boolean>(false);

function toggleTolls() {
  tollsVisible.value = !tollsVisible.value;
  // la layer peut ne pas encore exister si on clique avant le 'load'
  if (!mapbox.getLayer('tolls-layer')) return;
  mapbox.setLayoutProperty(
    'tolls-layer',
    'visibility',
    tollsVisible.value ? 'visible' : 'none',
  );
}

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!,
  );
}

function buildTollCard(p: Record<string, any>): string {
  const rows = [
    p.type && ['Type', p.type],
    p.side && ['Sens', p.side],
    p.laneCount && ['Voies', `${p.laneCount} voie${p.laneCount > 1 ? 's' : ''}`],
  ].filter(Boolean) as [string, string][];

  return `
    <div class="toll-card">
      <div class="toll-card-header">
        <span class="toll-card-dot"></span>
        <strong class="toll-card-name">${escapeHtml(p.name ?? 'Péage')}</strong>
        ${p.road ? `<span class="toll-card-road">${escapeHtml(p.road)}</span>` : ''}
      </div>
      ${rows.length ? `
      <div class="toll-card-body">
        ${rows.map(([label, value]) => `
          <div class="toll-card-row">
            <span class="toll-card-label">${label}</span>
            <span class="toll-card-value">${escapeHtml(value)}</span>
          </div>`).join('')}
      </div>` : ''}
    </div>`;
}

watch(start, (value) => {
  if (!value || !mapbox) return;
  defineStartLocation(value);
  let zoom = value.place_type.includes('address') ? 14 : 10;
  mapbox.flyTo({center: value.center, zoom});
});

watch(end, (value) => {
  if (!value || !mapbox) return;
  defineEndLocation(value);
});

onMounted(() => {
  mapbox = new Map({
    accessToken: import.meta.env.VITE_MAPBOX_TOKEN,
    container: map.value!,
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [2.3522, 48.8566],
    zoom: 5,
    language: 'fr'
  });

  mapbox.addControl(new NavigationControl(), 'top-right');
  mapbox.addControl(new ScaleControl({maxWidth: 120, unit: 'metric'}), 'bottom-right');

  mapbox.on('load', async () => {
    // Maps tolls
    mapbox.addSource('tolls', {
      type: 'geojson',
      data: {type: 'FeatureCollection', features: []},
    });
    mapbox.addLayer({
      id: 'tolls-layer',
      type: 'circle',
      source: 'tolls',
      paint: {
        'circle-radius': 6,
        'circle-color': '#e11d48',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
      },
    });
    mapbox.on('click', 'tolls-layer', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      new Popup({ offset: 12, maxWidth: '300px', className: 'toll-popup' })
        .setLngLat((f.geometry as any).coordinates)
        .setHTML(buildTollCard(f.properties ?? {}))
        .addTo(mapbox);
    });
    mapbox.on('mouseenter', 'tolls-layer', () => {
      mapbox.getCanvas().style.cursor = 'pointer';
    });
    mapbox.on('mouseleave', 'tolls-layer', () => {
      mapbox.getCanvas().style.cursor = '';
    });

    // Default route : liseré foncé + trait, insérés sous la layer des péages
    mapbox.addSource('default-route', {type: 'geojson', data: { type: 'FeatureCollection', features: [] }});
    mapbox.addLayer({
      id: 'default-route-casing', type: 'line', source: 'default-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint:  { 'line-color': '#475569', 'line-width': 7, 'line-opacity': 0.9 },
    }, 'tolls-layer');
    mapbox.addLayer({
      id: 'default-route', type: 'line', source: 'default-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint:  { 'line-color': '#94a3b8', 'line-width': 4 },
    }, 'tolls-layer');

    // Les trois variantes de l'optimisation vivent dans une seule source ;
    // la bascule d'onglet ne fait que changer les filtres des layers, sans
    // re-charger de données ni bouger la caméra.
    const variantColor = [
      'match', ['get', 'variant'],
      'fastest', '#94a3b8',
      'no-toll', '#f59e0b',
      '#3b82f6',
    ] as const;
    const variantCasing = [
      'match', ['get', 'variant'],
      'fastest', '#475569',
      'no-toll', '#b45309',
      '#1d4ed8',
    ] as const;

    mapbox.addSource('variant-routes', {type: 'geojson', data: { type: 'FeatureCollection', features: [] }});
    mapbox.addLayer({
      id: 'variant-routes-dim', type: 'line', source: 'variant-routes',
      filter: ['!=', ['get', 'variant'], 'best'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint:  { 'line-color': [...variantColor], 'line-width': 3, 'line-opacity': 0.5 },
    }, 'tolls-layer');
    mapbox.addLayer({
      id: 'variant-route-active-casing', type: 'line', source: 'variant-routes',
      filter: ['==', ['get', 'variant'], 'best'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint:  { 'line-color': [...variantCasing], 'line-width': 7, 'line-opacity': 0.9 },
    }, 'tolls-layer');
    mapbox.addLayer({
      id: 'variant-route-active', type: 'line', source: 'variant-routes',
      filter: ['==', ['get', 'variant'], 'best'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint:  { 'line-color': [...variantColor], 'line-width': 4 },
    }, 'tolls-layer');

    // Données chargées depuis la base via l'endpoint AdonisJS, conservées
    // en mémoire pour pouvoir filtrer les péages le long d'une route
    try {
      const res = await fetch('/api/tolls.geojson');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      tollFeatures = (await res.json()).features ?? [];
      (mapbox.getSource('tolls') as GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: tollFeatures,
      });
      applyTollFilter();
    } catch (e) {
      console.error('Erreur lors du chargement des péages :', e);
    }
  });
});

function defineStartLocation(feature: Feature) {
  if (startMarker) startMarker.remove();
  startMarker = new Marker({ color: '#3b82f6' }).setLngLat(feature.center).addTo(mapbox);
  drawRoute();
}

function defineEndLocation(feature: Feature) {
  if (endMarker) endMarker.remove();
  endMarker = new Marker({ color: '#ef4444' }).setLngLat(feature.center).addTo(mapbox);
  drawRoute();
}

async function drawRoute() {
  let s = store.start;
  let e = store.end;
  if (!s || !e) return;

  try {
    const data = await useMapbox.getRoute([s, e]);
    const geometry = data.routes[0].geometry;
    (mapbox.getSource('default-route') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry, properties: {} }],
    });
    // Les variantes d'une optimisation précédente ne correspondent plus
    // aux nouveaux marqueurs
    if (mapbox.getSource('variant-routes')) {
      (mapbox.getSource('variant-routes') as GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: [],
      });
    }
    routeCoordsList = [geometry.coordinates];
    hasRoute.value = true;
    applyTollFilter();
    mapbox.fitBounds([startMarker.getLngLat(), endMarker.getLngLat()], { padding: 60, maxZoom: 13, speed: 2 });
  } catch (e) {
    console.error('Erreur lors du dessin de l’itinéraire :', e);
  }
}

/**
 * Affiche simultanément les variantes issues de l'optimisation ; la
 * variante active est mise en avant, les autres restent visibles en
 * estompé. La caméra n'est recadrée qu'ici, jamais à la bascule.
 */
function showRoutes(routes: DisplayedRoute[], active: RouteVariantKey) {
  if (!mapbox.getSource('variant-routes')) return;

  (mapbox.getSource('variant-routes') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: routes.map((route) => ({
      type: 'Feature',
      geometry: route.geometry,
      properties: { variant: route.key },
    })),
  });
  // Le tracé de prévisualisation est remplacé par les variantes
  (mapbox.getSource('default-route') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: [],
  });

  routeCoordsList = routes.map((route) => route.geometry.coordinates);
  hasRoute.value = true;
  applyTollFilter();
  setActiveVariant(active);

  const allCoords = routes.flatMap((route) => route.geometry.coordinates);
  const bounds = allCoords.reduce(
    (box, coord) => box.extend(coord),
    new LngLatBounds(allCoords[0], allCoords[0]),
  );
  mapbox.fitBounds(bounds, { padding: 60, maxZoom: 13, speed: 2 });
}

/** Bascule instantanée de la variante mise en avant (simple filtre). */
function setActiveVariant(active: RouteVariantKey) {
  if (!mapbox.getLayer('variant-route-active')) return;
  mapbox.setFilter('variant-routes-dim', ['!=', ['get', 'variant'], active]);
  mapbox.setFilter('variant-route-active-casing', ['==', ['get', 'variant'], active]);
  mapbox.setFilter('variant-route-active', ['==', ['get', 'variant'], active]);
}

/** Recentre la carte sur un point (péage cliqué dans le panneau). */
function focusPoint(center: [number, number]) {
  mapbox.flyTo({ center, zoom: 13 });
}

defineExpose({ showRoutes, setActiveVariant, focusPoint });

/**
 * Restreint la layer des péages à ceux situés le long des routes affichées
 * (union des variantes). Sans route, tous les péages sont visibles.
 */
function applyTollFilter() {
  if (!mapbox.getLayer('tolls-layer')) return;

  if (routeCoordsList.length === 0 || !tollFeatures.length) {
    mapbox.setFilter('tolls-layer', null);
    return;
  }

  // Bounding box des routes élargie du seuil, pour écarter à moindre coût
  // les péages manifestement trop éloignés
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const coords of routeCoordsList) {
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  const latMargin = TOLL_ROUTE_THRESHOLD_M / 111_320;
  const lngMargin = latMargin / Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);

  const ids = tollFeatures
    .filter((f) => {
      const [lng, lat] = f.geometry.coordinates;
      if (lng < minLng - lngMargin || lng > maxLng + lngMargin) return false;
      if (lat < minLat - latMargin || lat > maxLat + latMargin) return false;
      return routeCoordsList.some((coords) =>
        isNearPolyline(lng, lat, coords, TOLL_ROUTE_THRESHOLD_M));
    })
    .map((f) => f.properties.id);

  mapbox.setFilter('tolls-layer', ['in', ['get', 'id'], ['literal', ids]]);

  // Le filtrage n'a d'intérêt que si la layer est visible
  if (!tollsVisible.value) toggleTolls();
}

/**
 * Distance point → polyligne en projection équirectangulaire locale,
 * suffisante à l'échelle de quelques centaines de mètres.
 */
function isNearPolyline(lng: number, lat: number, coords: [number, number][], thresholdM: number): boolean {
  const kx = 111_320 * Math.cos(lat * Math.PI / 180); // mètres par degré de longitude
  const ky = 111_320;                                 // mètres par degré de latitude
  const px = lng * kx;
  const py = lat * ky;
  const t2 = thresholdM * thresholdM;

  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i][0] * kx, ay = coords[i][1] * ky;
    const dx = coords[i + 1][0] * kx - ax;
    const dy = coords[i + 1][1] * ky - ay;
    let t = dx || dy ? ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy) : 0;
    t = Math.max(0, Math.min(1, t));
    const ddx = px - (ax + t * dx);
    const ddy = py - (ay + t * dy);
    if (ddx * ddx + ddy * ddy <= t2) return true;
  }
  return false;
}
</script>

<template>
  <div class="map-wrapper">
    <button class="layer-toggle" @click="toggleTolls">
      {{ tollsVisible ? 'Cacher' : 'Afficher' }} {{ hasRoute ? 'les péages du trajet' : 'les péages de France' }}
    </button>
    <div id="map" ref="map"></div>
  </div>
</template>

<style scoped lang="less">
.map-wrapper {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;

  #map {
    flex: 1;
    width: 100%;
    min-height: 0;
  }

  .layer-toggle {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 1;
    padding: 6px 12px;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }

  /* Popup péage — :deep() car le HTML est injecté par Mapbox, hors du scope Vue */
  :deep(.toll-popup) {
    .mapboxgl-popup-content {
      padding: 0;
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-md);
      overflow: hidden;
      font-family: var(--font-sans);
    }

    .mapboxgl-popup-close-button {
      width: 24px;
      height: 24px;
      top: 6px;
      right: 6px;
      border-radius: var(--radius-sm);
      font-size: 16px;
      color: var(--color-muted);

      &:hover {
        background: var(--color-bg);
        color: var(--color-text);
      }
    }

    .toll-card {
      min-width: 220px;

      /* Concaténation LESS : &-header → .toll-card-header, etc. */
      &-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 32px 10px 12px;
        background: var(--color-bg);
        border-bottom: 1px solid var(--color-border);
      }

      &-dot {
        flex: none;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #e11d48;
        border: 2px solid #fff;
        box-shadow: 0 0 0 1px var(--color-border);
      }

      &-name {
        font-size: 13px;
        color: var(--color-text);
        line-height: 1.3;
      }

      &-road {
        flex: none;
        margin-left: auto;
        padding: 2px 7px;
        border-radius: 999px;
        background: var(--color-primary);
        color: #fff;
        font-size: 11px;
        font-weight: 600;
      }

      &-body {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px 12px;
      }

      &-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        font-size: 12px;
      }

      &-label {
        color: var(--color-muted);
      }

      &-value {
        color: var(--color-text);
        font-weight: 500;
        text-align: right;
      }
    }
  }
}
</style>
