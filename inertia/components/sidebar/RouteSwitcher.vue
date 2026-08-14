<script setup lang="ts">
/**
 * RouteSwitcher — bascule entre les variantes d'itinéraire évaluées.
 * La variante active prend la forme d'un panneau de direction, dans la couleur
 * de son tracé sur la carte : le panneau tient lieu de légende.
 */

export type RouteVariantKey = 'best' | 'fastest' | 'no-toll';

export type RouteTabStat = {
  key: RouteVariantKey;
  label: string;
  /** Précision sous le libellé (ex. « évite 1 péage », « = le + rapide »). */
  detail: string | null;
  priceCents: number;
  /** false : prix sous-estimé, certains franchissements n'ont pas pu être chiffrés. */
  pricingComplete: boolean;
  durationSeconds: number;
  distanceMeters: number;
};

defineProps<{
  tabStats: RouteTabStat[];
  activeVariant: RouteVariantKey;
}>();

const emit = defineEmits<{
  (e: 'switch', variant: RouteVariantKey): void;
}>();

function euros(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
}

function kilometers(meters: number): string {
  return `${Math.round(meters / 1000)} km`;
}
</script>

<template>
  <div id="route-switcher" role="tablist" aria-label="Variantes d'itinéraire">
    <button
        v-for="tab in tabStats"
        :key="tab.key"
        class="variant"
        :class="[`variant-${tab.key}`, { 'is-active': tab.key === activeVariant }]"
        type="button"
        role="tab"
        :aria-selected="tab.key === activeVariant"
        @click="emit('switch', tab.key)"
    >
      <span class="variant-label">{{ tab.label }}</span>
      <span
          class="variant-price"
          :title="tab.pricingComplete ? undefined : 'Prix minimum : certains péages n’ont pas pu être chiffrés'"
      ><span v-if="!tab.pricingComplete" aria-label="au moins">≥ </span>{{ euros(tab.priceCents) }}</span>
      <span class="variant-detail">{{ tab.detail }}</span>
      <span class="variant-meta">{{ duration(tab.durationSeconds) }} · {{ kilometers(tab.distanceMeters) }}</span>
    </button>
  </div>
</template>
