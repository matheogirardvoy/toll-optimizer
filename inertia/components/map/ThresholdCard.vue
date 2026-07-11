<script setup lang="ts">
defineProps<{
  maxCost: number,
  gainMinutes: number,
  thresholdLabel: string
}>();

const emit = defineEmits<{
  (e: 'update:maxCost', value: number): void,
  (e: 'update:gainMinutes', value: number): void
}>();
</script>

<template>
  <div class="card">
    <p class="card-title">⚖️ Mon seuil de rentabilité</p>
    <div class="threshold-row">
      <span>Je veux payer max</span>
      <input
          :value="maxCost"
          @input="emit('update:maxCost', Number(($event.target as HTMLInputElement).value))"
          type="number" min="1" max="500" step="1"
          aria-label="Coût maximum accepté en euros"
      />
      <span>€ pour gagner</span>
      <input
          :value="gainMinutes"
          @input="emit('update:gainMinutes', Number(($event.target as HTMLInputElement).value))"
          type="number" min="1" max="360" step="5"
          aria-label="Gain de temps minimum en minutes"
      />
      <span>min</span>
      <span class="threshold-display">{{ thresholdLabel }}</span>
    </div>
  </div>
</template>

<style scoped lang="less">

</style>
