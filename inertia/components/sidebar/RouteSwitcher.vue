<script setup lang="ts">
/** RouteSwitcher — bascule entre les variantes d'itinéraire évaluées. */

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
        class="route-tab"
        :class="{ 'tab-active': tab.key === activeVariant }"
        type="button"
        role="tab"
        :aria-selected="tab.key === activeVariant"
        @click="emit('switch', tab.key)"
    >
      <span class="tab-label">{{ tab.label }}</span>
      <span
          class="tab-cost"
          :title="tab.pricingComplete ? undefined : 'Prix sous-estimé : certains péages n’ont pas pu être chiffrés'"
      >{{ euros(tab.priceCents) }}<span v-if="!tab.pricingComplete" aria-hidden="true"> ⚠️</span></span>
      <span class="tab-time">{{ duration(tab.durationSeconds) }}</span>
      <span class="tab-distance">{{ kilometers(tab.distanceMeters) }}</span>
      <span v-if="tab.detail" class="tab-detail">{{ tab.detail }}</span>
    </button>
  </div>
</template>

<style scoped lang="less">
/* Structure et états dans app.less (#route-switcher) ; seuls les éléments
   ajoutés ici sont stylés localement. */
#route-switcher {
  .route-tab {
    .tab-cost {
      white-space: nowrap;
    }

    .tab-distance {
      font-size: 11px;
      color: var(--color-muted);
      white-space: nowrap;
    }

    .tab-detail {
      font-size: 10px;
      color: var(--color-muted);
      font-weight: 500;
      line-height: 1.2;
    }

    &.tab-active {
      .tab-distance,
      .tab-detail {
        color: rgba(255, 255, 255, 0.8);
      }
    }
  }
}
</style>
