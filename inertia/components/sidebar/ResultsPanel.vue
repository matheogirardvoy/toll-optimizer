<script setup lang="ts">
/**
 * ResultsPanel — synthèse de la variante affichée : durée/prix, écart avec
 * la route la plus rapide, et liste des péages conservés/évités.
 */

export type ResultsSummary = {
  durationSeconds: number;
  totalCents: number;
  /** Écarts avec la route la plus rapide (positifs = plus lent / plus cher). */
  deltaDurationSeconds: number;
  deltaCents: number;
  pricingComplete: boolean;
};

export type TollDecision = {
  /** Clé stable de la section (entrée-sortie). */
  id: string;
  name: string;
  networkName: string;
  priceCents: number | null;
  status: 'kept' | 'avoided';
};

defineProps<{
  summary: ResultsSummary;
  tolls: TollDecision[];
  selectedTollId: string | null;
}>();

const emit = defineEmits<{
  (e: 'toll-click', decision: TollDecision): void;
}>();

function euros(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

function signedEuros(cents: number): string {
  return `${cents > 0 ? '+' : '−'}${euros(Math.abs(cents))}`;
}

function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
}

function signedDuration(seconds: number): string {
  const minutes = Math.round(Math.abs(seconds) / 60);
  return `${seconds > 0 ? '+' : '−'}${minutes} min`;
}
</script>

<template>
  <div id="results-panel" class="card">
    <p class="card-title">🧾 Résultat</p>

    <div class="summary-grid">
      <div class="summary-item">
        <div class="summary-label">Durée</div>
        <div class="summary-value">{{ duration(summary.durationSeconds) }}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Péages</div>
        <div class="summary-value">{{ euros(summary.totalCents) }}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Temps vs rapide</div>
        <div
            class="summary-value"
            :class="summary.deltaDurationSeconds > 0 ? 'time-loss' : 'time-gain'"
        >
          {{ signedDuration(summary.deltaDurationSeconds) }}
        </div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Prix vs rapide</div>
        <div class="summary-value" :class="summary.deltaCents > 0 ? 'extra' : 'savings'">
          {{ signedEuros(summary.deltaCents) }}
        </div>
      </div>
    </div>

    <p v-if="!summary.pricingComplete" class="pricing-warning" role="alert">
      ⚠️ Tarification partielle : certains péages de ce trajet n'ont pas pu être chiffrés.
    </p>

    <ul class="toll-list">
      <li v-if="tolls.length === 0" class="toll-item toll-item-none">
        Aucun péage sur ce trajet.
      </li>
      <li
          v-for="toll in tolls"
          :key="toll.id"
          class="toll-item"
          :class="[`toll-item-${toll.status}`, { 'toll-selected': toll.id === selectedTollId }]"
          @click="emit('toll-click', toll)"
      >
        <span class="toll-item-icon">{{ toll.status === 'kept' ? '✅' : '🚫' }}</span>
        <span class="toll-item-name">
          {{ toll.name }}
          <small>{{ toll.networkName }}</small>
        </span>
        <span class="toll-item-price">
          {{ toll.priceCents === null ? '?' : euros(toll.priceCents) }}
        </span>
      </li>
    </ul>
  </div>
</template>

<style scoped lang="less">
/* Grille et liste stylées globalement dans app.less (#results-panel). */
#results-panel {
  .pricing-warning {
    font-size: .78rem;
    color: var(--color-warning);
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.35);
    border-radius: var(--radius-sm);
    padding: .5rem .65rem;
  }
}
</style>
