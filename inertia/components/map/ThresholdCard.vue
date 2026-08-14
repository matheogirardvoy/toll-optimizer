<script setup lang="ts">
/**
 * ThresholdCard — l'instrument de la page : le prix que vaut une heure gagnée.
 * Chaque péage du trajet est mesuré contre ce seuil, et le graphique en trace
 * la ligne. Une fois le résultat affiché, la carte se replie (`compact`) pour
 * laisser la place au verdict.
 */
defineProps<{
  maxCost: number,
  gainMinutes: number,
  thresholdLabel: string,
  compact?: boolean
}>();

const emit = defineEmits<{
  (e: 'update:maxCost', value: number): void,
  (e: 'update:gainMinutes', value: number): void
}>();
</script>

<template>
  <div class="card tariff" :class="{ 'is-compact': compact }">
    <p class="card-title">Ce que vaut une heure</p>

    <p class="tariff-readout">{{ thresholdLabel }}</p>

    <p class="tariff-sentence">
      Payer jusqu’à
      <input
          class="tariff-input"
          :value="maxCost"
          @input="emit('update:maxCost', Number(($event.target as HTMLInputElement).value))"
          type="number" min="1" max="500" step="1"
          aria-label="Coût maximum accepté, en euros"
      />
      € pour gagner
      <input
          class="tariff-input"
          :value="gainMinutes"
          @input="emit('update:gainMinutes', Number(($event.target as HTMLInputElement).value))"
          type="number" min="1" max="360" step="5"
          aria-label="Gain de temps minimum, en minutes"
      />
      min.
    </p>

    <p class="tariff-help">Au-dessus de ce prix, le péage est évité.</p>
  </div>
</template>
