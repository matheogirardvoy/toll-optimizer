<script setup lang="ts">
/** RouteSwitcher — bascule entre les variantes d'itinéraire évaluées. */

export type RouteVariantKey = 'best' | 'fastest' | 'no-toll';

export type RouteTabStat = {
  key: RouteVariantKey;
  label: string;
  priceCents: number;
  durationSeconds: number;
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
      <span class="tab-cost">{{ euros(tab.priceCents) }}</span>
      <span class="tab-time">{{ duration(tab.durationSeconds) }}</span>
    </button>
  </div>
</template>

<style scoped lang="less">
/* Styles globaux dans app.less (#route-switcher). */
</style>
