<script setup lang="ts">
import {computed, ref, watch} from "vue";
import RouteForm from "~/components/route/RouteForm.vue";
import MapView, {DisplayedRoute} from "~/components/map/MapView.vue";
import ChartPanel from "~/components/map/ChartPanel.vue";
import ThresholdCard from "~/components/map/ThresholdCard.vue";
import RouteSwitcher, {RouteTabStat, RouteVariantKey} from "~/components/sidebar/RouteSwitcher.vue";
import ResultsPanel, {ResultsSummary, TollDecision} from "~/components/sidebar/ResultsPanel.vue";
import emitter from "~/composables/useEvent";
import useOptimizer, {
  CrossedStation,
  EvaluatedRoute,
  OptimizeError,
  OptimizeResult,
  RouteTollSection,
  SectionDecision,
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
  resetResult();
}

function onSelectEnd(f: Feature) {
  useLocationStore().setEnd(f);
  resetResult();
}

/** Un nouveau départ/arrivée invalide le résultat affiché. */
function resetResult() {
  result.value = null;
  selectedTollId.value = null;
}

/** Le <select> du formulaire renvoie 'cl1'…'cl5'. */
function parseVehicleClass(value: string): VehicleClass {
  const parsed = Number(value.replace('cl', ''));
  return (parsed >= 1 && parsed <= 5 ? parsed : 1) as VehicleClass;
}

async function optimise() {
  const store = useLocationStore();
  if (!store.start || !store.end) {
    emitter.emit('routeFormMessage', { message: 'Renseignez un départ et une arrivée.', type: 'error' });
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
        : 'Optimisation impossible. Réessayez dans un instant.';
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

/** Ce qu'est la route recommandée, affiché sous le libellé de son onglet. */
function bestDetail(optimized: OptimizeResult): string | null {
  switch (optimized.best.kind) {
    case 'fastest':
      return 'c’est aussi le plus rapide';
    case 'no-toll':
      return 'c’est aussi le trajet sans péage';
    case 'alternative':
      return 'itinéraire alternatif';
    case 'hybrid': {
      const keptIds = new Set(optimized.best.pricing.sections.map(sectionId));
      const avoided = optimized.fastest.pricing.sections.filter(
          (section) => !keptIds.has(sectionId(section))).length;
      return avoided > 0 ? `évite ${avoided} péage${avoided > 1 ? 's' : ''}` : 'itinéraire modifié';
    }
  }
}

const tabStats = computed<RouteTabStat[]>(() => {
  if (!result.value) return [];

  const makeTab = (
      key: RouteVariantKey,
      label: string,
      route: EvaluatedRoute,
      detail: string | null,
  ): RouteTabStat => ({
    key,
    label,
    detail,
    priceCents: route.pricing.totalCents,
    pricingComplete: route.pricing.complete,
    durationSeconds: route.durationSeconds,
    distanceMeters: route.distanceMeters,
  });

  const tabs: RouteTabStat[] = [
    makeTab('best', 'Recommandé', result.value.best, bestDetail(result.value)),
    makeTab('fastest', 'Le plus rapide', result.value.fastest, null),
  ];
  if (result.value.noToll) {
    tabs.push(makeTab('no-toll', 'Sans péage', result.value.noToll, null));
  }
  return tabs;
});

function switchToVariant(variant: RouteVariantKey) {
  activeVariant.value = variant;
  selectedTollId.value = null;
  // Bascule instantanée : les trois tracés sont déjà sur la carte
  map.value?.setActiveVariant(variant);
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

/** Même format de clé que `sectionKey` côté serveur (décisions). */
function sectionId(section: RouteTollSection): string {
  return `${section.entry.stationId}:${section.exit?.stationId ?? 'open'}`;
}

function sectionName(section: RouteTollSection): string {
  return section.exit
      ? `${section.entry.stationName} → ${section.exit.stationName}`
      : `${section.entry.stationName} (barrière)`;
}

function decisionFor(key: string): SectionDecision | null {
  return result.value?.decisions.find((decision) => decision.sectionKey === key) ?? null;
}

function ratioLabel(decision: SectionDecision | null): string | null {
  if (decision?.ratioCentsPerHour == null) return null;
  return `${Math.round(decision.ratioCentsPerHour / 100)} €/h`;
}

function avoidanceDetail(decision: SectionDecision | null): string | null {
  if (decision?.extraDurationSeconds == null) return null;
  return `+${Math.round(decision.extraDurationSeconds / 60)} min si évité`;
}

function focusOf(station: CrossedStation): [number, number] | null {
  const point = station.points[0];
  return point ? [point.longitude, point.latitude] : null;
}

/**
 * Péages de la variante affichée (conservés), ceux de la route rapide
 * qu'elle permet d'éviter, et les franchissements intarifables (réseau non
 * couvert, sortie introuvable) — la liste doit refléter tout ce qui est
 * franchi, pas seulement ce qui a pu être chiffré.
 */
const tolls = computed<TollDecision[]>(() => {
  if (!result.value || !activeRoute.value) return [];

  const toDecision = (section: RouteTollSection, status: 'kept' | 'avoided'): TollDecision => {
    const key = sectionId(section);
    const decision = decisionFor(key);
    return {
      id: status === 'kept' ? key : `avoided-${key}`,
      name: sectionName(section),
      networkName: section.networkName,
      priceCents: section.priceCents,
      status,
      ratioLabel: ratioLabel(decision),
      detail: avoidanceDetail(decision),
      focus: focusOf(section.entry),
    };
  };

  const kept = activeRoute.value.pricing.sections.map((section) => toDecision(section, 'kept'));
  const keptIds = new Set(kept.map((toll) => toll.id));
  const avoided = result.value.fastest.pricing.sections
      .filter((section) => !keptIds.has(sectionId(section)))
      .map((section) => toDecision(section, 'avoided'));

  const unknown = activeRoute.value.pricing.issues.flatMap((issue): TollDecision[] => {
    if (issue.type === 'missing-price') return []; // déjà visible en section « ? »
    return [{
      id: `unknown-${issue.station.stationId}-${Math.round(issue.station.alongMeters)}`,
      name: issue.type === 'unpaired-entry'
          ? `${issue.station.stationName} (sortie introuvable)`
          : issue.station.stationName,
      networkName: issue.type === 'unpaired-entry' ? issue.networkName : 'réseau non couvert',
      priceCents: null,
      status: 'unknown',
      ratioLabel: null,
      detail: null,
      focus: focusOf(issue.station),
    }];
  });

  return [...kept, ...avoided, ...unknown];
});

/** Recentre la carte sur l'entrée de la section cliquée. */
function onTollClick(decision: TollDecision) {
  selectedTollId.value = decision.id === selectedTollId.value ? null : decision.id;
  if (selectedTollId.value !== null && decision.focus) {
    map.value?.focusPoint(decision.focus);
  }
}

/** Clic sur une colonne du graphique : sélectionne la ligne correspondante. */
function onChartSelect(sectionKey: string) {
  const toll = tolls.value.find((candidate) =>
      candidate.id === sectionKey || candidate.id === `avoided-${sectionKey}`);
  if (toll) onTollClick(toll);
}

// Les trois variantes sont envoyées une seule fois à la carte ; les
// bascules d'onglet ne touchent ensuite qu'aux filtres des layers.
watch(result, (optimized) => {
  if (!optimized) return;
  const toDisplayed = (key: RouteVariantKey, route: EvaluatedRoute): DisplayedRoute => ({
    key,
    geometry: route.geometry,
    tolls: route.mapboxTolls,
    sections: route.pricing.sections,
    crossings: route.pricing.crossings,
  });

  const routes: DisplayedRoute[] = [
    toDisplayed('best', optimized.best),
    toDisplayed('fastest', optimized.fastest),
  ];
  if (optimized.noToll) {
    routes.push(toDisplayed('no-toll', optimized.noToll));
  }
  map.value?.showRoutes(routes, activeVariant.value);
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
          :compact="result !== null"
      />

      <button class="btn-optimise" type="button" :disabled="loading" @click="optimise">
        {{ loading ? 'Analyse en cours…' : 'Optimiser l’itinéraire' }}
      </button>

      <div :id="routeFormMessage.type + '-message'" v-if="routeFormMessage?.message" role="alert">{{ routeFormMessage.message }}</div>

      <RouteSwitcher
          v-if="tabStats.length > 0"
          class="reveal"
          :tab-stats="tabStats"
          :active-variant="activeVariant"
          @switch="switchToVariant"
      />

      <ResultsPanel
          v-if="summary"
          class="reveal"
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
      <svg class="route-draw" viewBox="0 0 240 72" aria-hidden="true">
        <!-- Le lit gris est la couleur du trajet par défaut sur la carte :
             l'azur qui s'y dépose est l'itinéraire optimisé qui le remplace. -->
        <path class="route-draw-bed" d="M12 56C40 56 52 22 84 22s40 26 68 24 44-24 64-28"/>
        <path class="route-draw-line" pathLength="1"
              d="M12 56C40 56 52 22 84 22s40 26 68 24 44-24 64-28"/>
        <circle class="route-draw-toll route-draw-toll-a" cx="84" cy="22" r="5"/>
        <circle class="route-draw-toll route-draw-toll-b" cx="152" cy="46" r="5"/>
      </svg>
      <p>Analyse des péages</p>
    </div>

    <ChartPanel
        :decisions="result?.decisions ?? []"
        :threshold-cents-per-hour="result ? result.rhoCentsPerMinute * 60 : null"
        @select="onChartSelect"
    />
  </div>
</template>
