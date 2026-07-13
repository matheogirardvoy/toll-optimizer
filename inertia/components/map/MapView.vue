<script setup lang="ts">
import {onMounted, ref, watch} from "vue";
import {GeoJSONSource, LngLatBounds, Map, Marker, NavigationControl, Popup, ScaleControl} from "mapbox-gl";
import {storeToRefs} from "pinia";
import {useLocationStore} from "~/composables/stores/useLocationStore";
import useMapbox, {Feature, RouteTollCollection} from "~/composables/map/useMapbox";
import useTolls from "~/composables/engine/useTolls";
import {LngLat, MapboxToll, RouteGeometry, RouteTollSection, TollMatch} from "~/composables/engine/useOptimizer";
import {RouteVariantKey} from "~/components/sidebar/RouteSwitcher.vue";

export type DisplayedRoute = {
  key: RouteVariantKey;
  geometry: RouteGeometry;
  /** Péages signalés par Mapbox sur cette variante, enrichis côté serveur. */
  tolls: MapboxToll[];
  /** Sections tarifées de cette variante (pricing serveur). */
  sections: RouteTollSection[];
};

/** Propriétés plates : les sources GeoJSON Mapbox aplatissent les objets imbriqués. */
type TollProperties = {
  /** Nom affiché : référentiel local, sinon nom Mapbox, sinon « Péage ». */
  name: string;
  /** false : signalé par Mapbox mais introuvable dans la base. */
  matched: boolean;
  type: string | null;
  road: string | null;
  side: string | null;
  laneCount: number | null;
  stationName: string | null;
  networkName: string | null;
};

type TollFeature = {
  type: 'Feature';
  geometry: {type: 'Point'; coordinates: [number, number]};
  properties: TollProperties;
};

/** Libellés des types de perception annotés par Mapbox. */
const TOLL_KIND_LABELS: Record<string, string> = {
  toll_booth: 'Gare de péage',
  toll_gantry: 'Portique flux libre',
};

/** Propriétés d'une portion payante (ligne survolable + étiquette de prix). */
type SectionProperties = {
  variant: RouteVariantKey;
  /** 'portion' : couple entrée → sortie ; 'gare' : barrière à prix fixe. */
  kind: 'portion' | 'gare';
  name: string;
  networkName: string;
  /** Étiquette posée sur la carte : « 12,30 € » ou « ? ». */
  label: string;
  /** Prix affiché dans la popup : « 12,30 € » ou « non chiffré ». */
  priceLabel: string;
};

type SectionFeature = {
  type: 'Feature';
  geometry:
    | {type: 'LineString'; coordinates: LngLat[]}
    | {type: 'Point'; coordinates: LngLat};
  properties: SectionProperties;
};

/**
 * ~2πR/360 sur le sphéroïde du serveur : les abscisses curvilignes des
 * sections (`alongMeters`) sont recalculées ici avec la même métrique.
 */
const METERS_PER_DEGREE_LAT = 111_195;

function euros(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

/** Distance cumulée le long du tracé, en mètres (projection locale). */
function cumulativeMeters(coords: LngLat[]): number[] {
  const cumulative = new Array<number>(coords.length);
  let total = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) {
      const [lng1, lat1] = coords[i - 1];
      const [lng2, lat2] = coords[i];
      const meanLat = ((lat1 + lat2) / 2) * Math.PI / 180;
      const dx = (lng2 - lng1) * METERS_PER_DEGREE_LAT * Math.cos(meanLat);
      const dy = (lat2 - lat1) * METERS_PER_DEGREE_LAT;
      total += Math.hypot(dx, dy);
    }
    cumulative[i] = total;
  }
  return cumulative;
}

/** Point du tracé à l'abscisse curviligne donnée (interpolation linéaire). */
function pointAt(coords: LngLat[], cumulative: number[], meters: number): LngLat {
  if (meters <= 0) return coords[0];
  const total = cumulative[cumulative.length - 1];
  if (meters >= total) return coords[coords.length - 1];

  let i = 1;
  while (cumulative[i] < meters) i++;
  const t = (meters - cumulative[i - 1]) / ((cumulative[i] - cumulative[i - 1]) || 1);
  return [
    coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]),
    coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1]),
  ];
}

/** Tronçon du tracé entre deux abscisses curvilignes, extrémités interpolées. */
function sliceLine(coords: LngLat[], cumulative: number[], from: number, to: number): LngLat[] {
  const middle = coords.filter((_, i) => cumulative[i] > from && cumulative[i] < to);
  return [pointAt(coords, cumulative, from), ...middle, pointAt(coords, cumulative, to)];
}

/**
 * Features d'une variante : pour chaque portion fermée, la sous-polyligne
 * entrée → sortie (survolable) et un point médian portant l'étiquette de
 * prix ; pour une barrière à prix fixe, la seule étiquette sur la gare.
 */
function sectionFeatures(route: DisplayedRoute): SectionFeature[] {
  const coords = route.geometry.coordinates;
  const cumulative = cumulativeMeters(coords);
  const features: SectionFeature[] = [];

  for (const section of route.sections) {
    const properties: SectionProperties = {
      variant: route.key,
      kind: section.exit ? 'portion' : 'gare',
      name: section.exit
        ? `${section.entry.stationName} → ${section.exit.stationName}`
        : section.entry.stationName,
      networkName: section.networkName,
      label: section.priceCents !== null ? euros(section.priceCents) : '?',
      priceLabel: section.priceCents !== null ? euros(section.priceCents) : 'non chiffré',
    };

    if (section.exit) {
      const from = section.entry.alongMeters;
      const to = section.exit.alongMeters;
      features.push({
        type: 'Feature',
        geometry: {type: 'LineString', coordinates: sliceLine(coords, cumulative, from, to)},
        properties,
      });
      features.push({
        type: 'Feature',
        geometry: {type: 'Point', coordinates: pointAt(coords, cumulative, (from + to) / 2)},
        properties,
      });
    } else {
      features.push({
        type: 'Feature',
        geometry: {type: 'Point', coordinates: pointAt(coords, cumulative, section.entry.alongMeters)},
        properties,
      });
    }
  }

  return features;
}

function buildSectionCard(p: SectionProperties): string {
  return `
    <div class="toll-card">
      <div class="toll-card-header">
        <span class="toll-card-dot toll-card-dot-price"></span>
        <strong class="toll-card-name">${escapeHtml(p.name)}</strong>
        ${p.networkName ? `<span class="toll-card-road">${escapeHtml(p.networkName)}</span>` : ''}
      </div>
      <div class="toll-card-body">
        <div class="toll-card-row">
          <span class="toll-card-label">Prix</span>
          <span class="toll-card-value">${escapeHtml(p.priceLabel)}</span>
        </div>
      </div>
      <div class="toll-card-note">${
        p.kind === 'portion'
          ? 'Prix de la portion (entrée → sortie)'
          : 'Prix au passage de la gare (barrière à prix fixe)'
      }</div>
    </div>`;
}

const store = useLocationStore();

const map = ref<HTMLDivElement>();
const tollsVisible = ref<boolean>(true);
const {start, end} = storeToRefs(store);

let mapbox: Map;
let startMarker: Marker;
let endMarker: Marker;

/** Écarte une réponse d'enrichissement arrivée après un nouvel affichage. */
let tollsGeneration = 0;
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

function buildTollCard(p: TollProperties): string {
  const rows = [
    p.type && ['Type', p.type],
    p.networkName && ['Réseau', p.networkName],
    p.stationName && ['Gare', p.stationName],
    p.side && ['Sens', p.side],
    p.laneCount && ['Voies', `${p.laneCount} voie${p.laneCount > 1 ? 's' : ''}`],
  ].filter(Boolean) as [string, string][];

  return `
    <div class="toll-card">
      <div class="toll-card-header">
        <span class="toll-card-dot"></span>
        <strong class="toll-card-name">${escapeHtml(p.name)}</strong>
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
      ${p.matched ? '' : '<div class="toll-card-note">Signalé par Mapbox — absent du référentiel local</div>'}
    </div>`;
}

/** Aplatit un péage Mapbox enrichi en feature prête pour la source `tolls`. */
function tollToFeature(toll: MapboxToll): TollFeature {
  const match = toll.match;
  const kindLabel = toll.kind ? TOLL_KIND_LABELS[toll.kind] ?? toll.kind : null;
  return {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: toll.location},
    properties: {
      name: match?.name ?? toll.name ?? 'Péage',
      matched: match !== null,
      type: match?.gateTypeLabel ?? kindLabel,
      road: match?.road ?? null,
      side: match?.side ?? null,
      laneCount: match?.laneCount ?? null,
      stationName: match?.stationName ?? null,
      networkName: match?.networkName ?? null,
    },
  };
}

/** Remplace les péages affichés (dédupliqués par coordonnées entre variantes). */
function displayTolls(tolls: MapboxToll[]) {
  const source = mapbox.getSource('tolls') as GeoJSONSource | undefined;
  if (!source) return;

  const seen = new Set<string>();
  const features = tolls
    .filter((toll) => {
      const key = toll.location.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(tollToFeature);

  source.setData({type: 'FeatureCollection', features});

  // Le nouvel affichage n'a d'intérêt que si la layer est visible
  if (!tollsVisible.value) toggleTolls();
}

/**
 * Péages du tracé de prévisualisation : les annotations Mapbox s'affichent
 * immédiatement, puis sont enrichies par le référentiel local dès que
 * l'appariement répond.
 */
async function showPreviewTolls(collections: RouteTollCollection[]) {
  const generation = ++tollsGeneration;
  displayTolls(collections.map((collection) => ({...collection, match: null})));
  if (collections.length === 0) return;

  let matches: (TollMatch | null)[];
  try {
    matches = await useTolls.matchTolls(collections.map((collection) => collection.location));
  } catch (e) {
    console.error('Enrichissement des péages impossible :', e);
    return;
  }

  // Une optimisation ou un nouveau tracé a remplacé l'affichage entre-temps
  if (generation !== tollsGeneration) return;
  displayTolls(collections.map((collection, index) => ({
    ...collection,
    match: matches[index] ?? null,
  })));
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
        .setLngLat((f.geometry as TollFeature['geometry']).coordinates)
        .setHTML(buildTollCard(f.properties as TollProperties))
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

    // Portions payantes de la variante active : sous-polylignes survolables
    // sous les points de péage (qui restent cliquables), étiquettes de prix
    // au-dessus de tout.
    mapbox.addSource('toll-sections', {type: 'geojson', data: { type: 'FeatureCollection', features: [] }});
    mapbox.addLayer({
      id: 'toll-sections-line', type: 'line', source: 'toll-sections',
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'variant'], 'best']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#7c3aed', 'line-width': 6, 'line-opacity': 0.7 },
    }, 'tolls-layer');
    mapbox.addLayer({
      id: 'toll-sections-label', type: 'symbol', source: 'toll-sections',
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'variant'], 'best']],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': 13,
        'text-offset': [0, -1],
        'text-anchor': 'bottom',
      },
      paint: {
        'text-color': '#6d28d9',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.6,
      },
    });

    // Popup de survol des portions : suit la souris, sans bouton de fermeture
    const hoverPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '320px', className: 'toll-popup' });
    for (const layer of ['toll-sections-line', 'toll-sections-label']) {
      mapbox.on('mousemove', layer, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        mapbox.getCanvas().style.cursor = 'pointer';
        hoverPopup
          .setLngLat(e.lngLat)
          .setHTML(buildSectionCard(f.properties as SectionProperties))
          .addTo(mapbox);
      });
      mapbox.on('mouseleave', layer, () => {
        mapbox.getCanvas().style.cursor = '';
        hoverPopup.remove();
      });
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
    const route = data.routes[0];
    (mapbox.getSource('default-route') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: route.geometry, properties: {} }],
    });
    // Les variantes d'une optimisation précédente (et leurs portions
    // tarifées) ne correspondent plus aux nouveaux marqueurs
    if (mapbox.getSource('variant-routes')) {
      (mapbox.getSource('variant-routes') as GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: [],
      });
    }
    if (mapbox.getSource('toll-sections')) {
      (mapbox.getSource('toll-sections') as GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: [],
      });
    }
    hasRoute.value = true;
    void showPreviewTolls(useMapbox.extractTollCollections(route));
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

  hasRoute.value = true;
  // Les péages viennent déjà enrichis de l'optimiseur ; l'union des
  // variantes est affichée, comme les tracés eux-mêmes.
  tollsGeneration++;
  displayTolls(routes.flatMap((route) => route.tolls));
  // Les portions payantes de toutes les variantes sont chargées d'un coup ;
  // seule celle de la variante active est visible (filtres).
  (mapbox.getSource('toll-sections') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: routes.flatMap(sectionFeatures),
  });
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
  mapbox.setFilter('toll-sections-line', ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'variant'], active]]);
  mapbox.setFilter('toll-sections-label', ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'variant'], active]]);
}

/** Recentre la carte sur un point (péage cliqué dans le panneau). */
function focusPoint(center: [number, number]) {
  mapbox.flyTo({ center, zoom: 13 });
}

defineExpose({ showRoutes, setActiveVariant, focusPoint });
</script>

<template>
  <div class="map-wrapper">
    <button v-if="hasRoute" class="layer-toggle" @click="toggleTolls">
      {{ tollsVisible ? 'Cacher' : 'Afficher' }} les péages du trajet
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

      /* Popup de portion tarifée : pastille assortie à la ligne violette */
      &-dot-price {
        background: #7c3aed;
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

      &-note {
        padding: 8px 12px;
        border-top: 1px dashed var(--color-border);
        font-size: 11px;
        font-style: italic;
        color: var(--color-muted);
      }
    }
  }
}
</style>
