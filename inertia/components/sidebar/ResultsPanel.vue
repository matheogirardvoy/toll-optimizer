<script setup lang="ts">
/**
 * ResultsPanel — synthèse de la variante affichée : durée/prix, écart avec
 * la route la plus rapide, et liste des péages conservés/évités.
 *
 * Les péages reprennent la signalétique des voies de péage : flèche verte, on
 * franchit ; croix rouge, l'itinéraire contourne.
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
  /** `unknown` : franchissement détecté mais intarifable (réseau non couvert…). */
  status: 'kept' | 'avoided' | 'unknown';
  /** Prix par heure gagnée en gardant ce péage, ex. « 26 €/h ». */
  ratioLabel: string | null;
  /** Détail de l'évitement, ex. « +20 min si évité ». */
  detail: string | null;
  /** Point de recentrage carte ([lng, lat]). */
  focus: [number, number] | null;
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

function statusLabel(status: TollDecision['status']): string {
  switch (status) {
    case 'kept':    return 'Franchi';
    case 'avoided': return 'Évité';
    default:        return 'Non tarifé';
  }
}
</script>

<template>
  <div id="results-panel" class="card">
    <p class="card-title">Détail du trajet</p>

    <div>
      <div class="readout">
        <div class="readout-cell">
          <div class="readout-label">Durée</div>
          <div class="readout-value">{{ duration(summary.durationSeconds) }}</div>
        </div>
        <div class="readout-cell">
          <div class="readout-label">Péages</div>
          <div class="readout-value">{{ euros(summary.totalCents) }}</div>
        </div>
        <div class="readout-cell">
          <div class="readout-label">Écart temps</div>
          <div
              class="readout-value"
              :class="summary.deltaDurationSeconds > 0 ? 'is-loss' : 'is-gain'"
          >{{ signedDuration(summary.deltaDurationSeconds) }}</div>
        </div>
        <div class="readout-cell">
          <div class="readout-label">Écart prix</div>
          <div
              class="readout-value"
              :class="summary.deltaCents > 0 ? 'is-loss' : 'is-gain'"
          >{{ signedEuros(summary.deltaCents) }}</div>
        </div>
      </div>
      <p class="readout-caption">Écarts mesurés face au trajet le plus rapide.</p>
    </div>

    <p v-if="!summary.pricingComplete" class="pricing-warning" role="alert">
      Tarification partielle : certains péages de ce trajet n’ont pas pu être chiffrés.
      Le total affiché est un minimum.
    </p>

    <div>
      <div class="toll-head">
        <span class="eyebrow">Péages</span>
        <span class="toll-key">
          <span class="toll-key-item">
            <svg class="lane-sign lane-sign-kept" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M9 4v7.5M5.5 8.5 9 12l3.5-3.5" fill="none" stroke="var(--encre)" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            franchi
          </span>
          <span class="toll-key-item">
            <svg class="lane-sign lane-sign-avoided" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M5.5 5.5l7 7M12.5 5.5l-7 7" stroke="var(--encre)" stroke-width="2" stroke-linecap="round"/>
            </svg>
            évité
          </span>
        </span>
      </div>

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
          <svg
              class="lane-sign"
              :class="`lane-sign-${toll.status}`"
              viewBox="0 0 18 18"
              role="img"
              :aria-label="statusLabel(toll.status)"
          >
            <path v-if="toll.status === 'kept'" d="M9 4v7.5M5.5 8.5 9 12l3.5-3.5"
                  fill="none" stroke="var(--encre)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path v-else-if="toll.status === 'avoided'" d="M5.5 5.5l7 7M12.5 5.5l-7 7"
                  stroke="var(--encre)" stroke-width="2" stroke-linecap="round"/>
            <text v-else x="9" y="13.5" text-anchor="middle" fill="var(--encre)"
                  font-size="12" font-weight="700" font-family="inherit">?</text>
          </svg>

          <span class="toll-item-name">{{ toll.name }}</span>
          <span class="toll-item-price">{{ toll.priceCents === null ? '—' : euros(toll.priceCents) }}</span>
          <span class="toll-item-sub">{{ toll.networkName }}{{ toll.detail ? ` · ${toll.detail}` : '' }}</span>
          <span class="toll-item-ratio">{{ toll.ratioLabel }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
