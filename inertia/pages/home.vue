<script setup lang="ts">
import {computed, ref, watch} from "vue";
import RouteForm from "~/components/route/RouteForm.vue";
import MapView from "~/components/map/MapView.vue";
import ChartPanel from "~/components/map/ChartPanel.vue";
import LegendCard from "~/components/sidebar/LegendCard.vue";
import ThresholdCard from "~/components/map/ThresholdCard.vue";
import RouteSwitcher, {RouteTabStat, RouteVariantKey} from "~/components/sidebar/RouteSwitcher.vue";
import ResultsPanel, {ResultsSummary, TollDecision} from "~/components/sidebar/ResultsPanel.vue";
import emitter from "~/composables/useEvent";
import useOptimizer, {
  EvaluatedRoute,
  OptimizeError,
  OptimizeResult,
  RouteTollSection,
  VehicleClass,
} from "~/composables/engine/useOptimizer";
import {Feature} from "~/composables/map/useMapbox";
import {useLocationStore} from "~/composables/stores/useLocationStore";

const map = ref<InstanceType<typeof MapView>>();

const vehicleClass = ref<string>('cl1');
const maxCost = ref<number>(20);
const gainMinutes = ref<number>(60);

const loading = ref<boolean>(false);
const routeFormMessage = ref<{ message: string, type: string }|null>(null);

const result = ref<OptimizeResult|null>(null);
const activeVariant = ref<RouteVariantKey>('best');
const selectedTollId = ref<string|null>(null);

function computeThreshold() {
  const cost = maxCost.value || 20;
  const mins = gainMinutes.value || 60;
  if (mins <= 0) return Infinity;
  return (cost / mins) * 60;
}
const thresholdLabel = computed(() => {
  const t = computeThreshold();
  return isFinite(t) ? `${Math.round(t)} €/h` : '—';
});

emitter.on('routeFormMessage', (e) => {
  routeFormMessage.value = e;
  setTimeout(() => { routeFormMessage.value = null }, 5000);
});

function onSelectStart(f: Feature) {
  useLocationStore().setStart(f);
}

function onSelectEnd(f: Feature) {
  useLocationStore().setEnd(f);
}

/** Le <select> du formulaire renvoie 'cl1'…'cl5'. */
function parseVehicleClass(value: string): VehicleClass {
  const parsed = Number(value.replace('cl', ''));
  return (parsed >= 1 && parsed <= 5 ? parsed : 1) as VehicleClass;
}

async function optimise() {
  const store = useLocationStore();
  if (!store.start || !store.end) {
    emitter.emit('routeFormMessage', { message: 'Veuillez saisir un départ et une arrivée.', type: 'error' });
    return;
  }

  loading.value = true;
  try {
    result.value = await useOptimizer.optimize(store.start, store.end, {
      vehicleClass: parseVehicleClass(vehicleClass.value),
      maxPriceCents: Math.round((maxCost.value || 20) * 100),
      minutesSaved: gainMinutes.value || 60,
    });
    activeVariant.value = 'best';
    selectedTollId.value = null;
  } catch (error) {
    const message = error instanceof OptimizeError
        ? error.message
        : 'Optimisation impossible : erreur inattendue.';
    emitter.emit('routeFormMessage', { message, type: 'error' });
  } finally {
    loading.value = false;
  }
}

/** Variante actuellement affichée sur la carte et dans le panneau. */
const activeRoute = computed<EvaluatedRoute|null>(() => {
  if (!result.value) return null;
  switch (activeVariant.value) {
    case 'fastest': return result.value.fastest;
    case 'no-toll': return result.value.noToll;
    default:        return result.value.best;
  }
});

const tabStats = computed<RouteTabStat[]>(() => {
  if (!result.value) return [];
  const tabs: RouteTabStat[] = [
    {
      key: 'best',
      label: '⭐ Recommandé',
      priceCents: result.value.best.pricing.totalCents,
      durationSeconds: result.value.best.durationSeconds,
    },
    {
      key: 'fastest',
      label: '⚡ Le + rapide',
      priceCents: result.value.fastest.pricing.totalCents,
      durationSeconds: result.value.fastest.durationSeconds,
    },
  ];
  if (result.value.noToll) {
    tabs.push({
      key: 'no-toll',
      label: '🆓 Sans péage',
      priceCents: result.value.noToll.pricing.totalCents,
      durationSeconds: result.value.noToll.durationSeconds,
    });
  }
  return tabs;
});

function switchToVariant(variant: RouteVariantKey) {
  activeVariant.value = variant;
  selectedTollId.value = null;
}

const summary = computed<ResultsSummary|null>(() => {
  if (!result.value || !activeRoute.value) return null;
  const fastest = result.value.fastest;
  return {
    durationSeconds: activeRoute.value.durationSeconds,
    totalCents: activeRoute.value.pricing.totalCents,
    deltaDurationSeconds: activeRoute.value.durationSeconds - fastest.durationSeconds,
    deltaCents: activeRoute.value.pricing.totalCents - fastest.pricing.totalCents,
    pricingComplete: activeRoute.value.pricing.complete,
  };
});

function sectionId(section: RouteTollSection): string {
  return `${section.entry.stationId}-${section.exit?.stationId ?? 'open'}`;
}

function sectionName(section: RouteTollSection): string {
  return section.exit
      ? `${section.entry.stationName} → ${section.exit.stationName}`
      : `${section.entry.stationName} (barrière)`;
}

/**
 * Péages de la variante affichée (conservés), plus ceux de la route rapide
 * qu'elle permet d'éviter.
 */
const tolls = computed<TollDecision[]>(() => {
  if (!result.value || !activeRoute.value) return [];

  const kept: TollDecision[] = activeRoute.value.pricing.sections.map((section) => ({
    id: sectionId(section),
    name: sectionName(section),
    networkName: section.networkName,
    priceCents: section.priceCents,
    status: 'kept',
  }));

  const keptIds = new Set(kept.map((toll) => toll.id));
  const avoided: TollDecision[] = result.value.fastest.pricing.sections
      .filter((section) => !keptIds.has(sectionId(section)))
      .map((section) => ({
        id: `avoided-${sectionId(section)}`,
        name: sectionName(section),
        networkName: section.networkName,
        priceCents: section.priceCents,
        status: 'avoided',
      }));

  return [...kept, ...avoided];
});

/** Recentre la carte sur l'entrée de la section cliquée. */
function onTollClick(decision: TollDecision) {
  selectedTollId.value = decision.id === selectedTollId.value ? null : decision.id;
  if (!result.value || !activeRoute.value || selectedTollId.value === null) return;

  const source = decision.status === 'kept' ? activeRoute.value : result.value.fastest;
  const section = source.pricing.sections.find((candidate) =>
      decision.id.endsWith(sectionId(candidate)));
  const point = section?.entry.points[0];
  if (point) {
    map.value?.focusPoint([point.longitude, point.latitude]);
  }
}

watch(activeRoute, (route) => {
  if (!route || !result.value) return;
  map.value?.showResult(result.value.fastest.geometry, route.geometry);
});
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-scroll">
      <RouteForm
          v-model:vehicleClass="vehicleClass"
          @select-start="onSelectStart"
          @select-end="onSelectEnd"
          @submit="optimise"
      />

      <ThresholdCard
          v-model:maxCost="maxCost"
          v-model:gainMinutes="gainMinutes"
          :threshold-label="thresholdLabel"
      />

      <button class="btn-optimise" type="button" :disabled="loading" @click="optimise">
        {{ loading ? 'Calcul en cours…' : 'Optimiser →' }}
      </button>

      <div :id="routeFormMessage.type + '-message'" v-if="routeFormMessage?.message" role="alert">{{ routeFormMessage.message }}</div>

      <LegendCard/>

      <RouteSwitcher
          v-if="tabStats.length > 0"
          :tab-stats="tabStats"
          :active-variant="activeVariant"
          @switch="switchToVariant"
      />

      <ResultsPanel
          v-if="summary"
          :summary="summary"
          :tolls="tolls"
          :selected-toll-id="selectedTollId"
          @toll-click="onTollClick"
      />

    </div>
  </aside>

  <div class="main">
    <MapView ref="map"/>

    <div id="loading-overlay" v-if="loading">
      <div class="spinner"></div>
      <p>Analyse des péages en cours…</p>
    </div>

    <ChartPanel/>
  </div>
</template>
