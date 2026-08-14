<script setup lang="ts">
/**
 * ChartPanel — rentabilité par péage : une colonne par tronçon payant de la
 * route rapide, hauteur = prix payé par heure gagnée en le gardant (€/h),
 * ligne de référence = seuil de l'utilisateur. Une colonne sous le seuil est
 * un péage rentable (conservé), au-dessus il est évité.
 */
import {computed, onBeforeUnmount, onMounted, ref} from "vue";
import {SectionDecision} from "~/composables/engine/useOptimizer";

const props = defineProps<{
  decisions: SectionDecision[];
  thresholdCentsPerHour: number | null;
}>();

const emit = defineEmits<{
  (e: 'select', sectionKey: string): void;
}>();

// Remplissage vif, liseré encré : à 2,4:1 sur blanc, l'aplat seul ne tiendrait
// pas le 3:1 exigé d'un élément graphique — c'est le liseré qui porte le bord.
const KEPT_COLOR = '#1ebe64';
const AVOIDED_COLOR = '#ff6b5a';
const KEPT_EDGE = '#0a7a3d';
const AVOIDED_EDGE = '#c42e22';

/** Marges intérieures du tracé (place pour l'axe Y et les libellés X). */
const PLOT = { top: 18, right: 12, bottom: 18, left: 44 };
const MAX_BAR_WIDTH = 24;

const wrapper = ref<HTMLDivElement>();
const width = ref<number>(0);
const height = ref<number>(0);
const hovered = ref<number>(-1);
const tooltipPos = ref<{ x: number; y: number }>({ x: 0, y: 0 });

let observer: ResizeObserver | null = null;

onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect;
    if (!box) return;
    width.value = box.width;
    height.value = box.height;
  });
  if (wrapper.value) observer.observe(wrapper.value);
});

onBeforeUnmount(() => observer?.disconnect());

type Bar = {
  decision: SectionDecision;
  /** €/h réel (peut dépasser l'échelle) ; `clamped` si écrêté à l'affichage. */
  value: number;
  clamped: boolean;
  x: number;
  barWidth: number;
  y: number;
  baseline: number;
  color: string;
  edge: string;
  label: string;
  xLabel: string;
};

const chartable = computed(() =>
    props.decisions.filter((decision) => decision.ratioCentsPerHour !== null));

/** Échelle Y : de 0 au max affiché, écrêté à 4× le seuil pour rester lisible. */
const scale = computed(() => {
  const threshold = (props.thresholdCentsPerHour ?? 0) / 100;
  const values = chartable.value.map((decision) => (decision.ratioCentsPerHour ?? 0) / 100);
  const cap = threshold > 0 ? threshold * 4 : Number.POSITIVE_INFINITY;
  const displayMax = Math.max(threshold * 1.4, ...values.map((value) => Math.min(value, cap)), 1);

  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  const step = steps.find((candidate) => displayMax / candidate <= 5) ?? 1000;
  const max = Math.ceil(displayMax / step) * step;

  const ticks: number[] = [];
  for (let tick = 0; tick <= max; tick += step) ticks.push(tick);
  return { max, ticks, cap, threshold };
});

const plotHeight = computed(() => Math.max(height.value - PLOT.top - PLOT.bottom, 10));
const plotWidth = computed(() => Math.max(width.value - PLOT.left - PLOT.right, 10));

function yFor(value: number): number {
  return PLOT.top + plotHeight.value * (1 - value / scale.value.max);
}

const bars = computed<Bar[]>(() => {
  const count = chartable.value.length;
  if (count === 0 || width.value === 0) return [];

  const band = plotWidth.value / count;
  const barWidth = Math.min(MAX_BAR_WIDTH, band * 0.55);

  return chartable.value.map((decision, index) => {
    const value = (decision.ratioCentsPerHour ?? 0) / 100;
    const clamped = value > scale.value.cap;
    // Ratio négatif : le garder économise même de l'argent — colonne à zéro,
    // le libellé porte la valeur réelle.
    const displayValue = Math.max(Math.min(value, scale.value.cap), 0);
    const name = decision.exitStationName
        ? `${decision.entryStationName} → ${decision.exitStationName}`
        : decision.entryStationName;

    return {
      decision,
      value,
      clamped,
      x: PLOT.left + band * index + (band - barWidth) / 2,
      barWidth,
      y: yFor(displayValue),
      baseline: PLOT.top + plotHeight.value,
      color: decision.keptInBest ? KEPT_COLOR : AVOIDED_COLOR,
      edge: decision.keptInBest ? KEPT_EDGE : AVOIDED_EDGE,
      label: `${clamped ? '≥ ' : ''}${Math.round(clamped ? displayValue : value)} €/h`,
      xLabel: name.length > 22 ? `${name.slice(0, 21)}…` : name,
    };
  });
});

/** Colonne à sommet arrondi (4 px), base carrée sur l'axe. */
function barPath(bar: Bar): string {
  const radius = Math.min(4, (bar.baseline - bar.y) / 2, bar.barWidth / 2);
  const right = bar.x + bar.barWidth;
  return [
    `M ${bar.x} ${bar.baseline}`,
    `L ${bar.x} ${bar.y + radius}`,
    `Q ${bar.x} ${bar.y} ${bar.x + radius} ${bar.y}`,
    `L ${right - radius} ${bar.y}`,
    `Q ${right} ${bar.y} ${right} ${bar.y + radius}`,
    `L ${right} ${bar.baseline}`,
    'Z',
  ].join(' ');
}

const thresholdY = computed(() =>
    scale.value.threshold > 0 ? yFor(Math.min(scale.value.threshold, scale.value.max)) : null);

function describe(decision: SectionDecision): string {
  const name = decision.exitStationName
      ? `${decision.entryStationName} → ${decision.exitStationName}`
      : `${decision.entryStationName} (barrière)`;
  const ratio = `${((decision.ratioCentsPerHour ?? 0) / 100).toFixed(2)} € par heure gagnée`;
  const status = decision.keptInBest ? 'conservé' : 'évité';
  return `${name} : ${ratio}, ${status}`;
}

function onHover(index: number, event: MouseEvent) {
  hovered.value = index;
  const box = wrapper.value?.getBoundingClientRect();
  if (!box) return;
  tooltipPos.value = {
    x: Math.min(event.clientX - box.left + 12, box.width - 190),
    y: Math.max(event.clientY - box.top - 8, 4),
  };
}

function onFocus(index: number) {
  hovered.value = index;
  const bar = bars.value[index];
  if (bar) {
    tooltipPos.value = { x: Math.min(bar.x, width.value - 190), y: Math.max(bar.y - 8, 4) };
  }
}

function euros(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

const hoveredBar = computed(() => bars.value[hovered.value] ?? null);
</script>

<template>
  <div class="chart-panel">
    <div class="chart-panel-title">Rentabilité par péage — € par heure gagnée</div>

    <div v-if="chartable.length > 0" class="chart-legend">
      <span class="chart-legend-item">
        <span
            class="chart-legend-swatch"
            :style="{ background: KEPT_COLOR, borderColor: KEPT_EDGE }"
        ></span>
        sous le seuil, franchi
      </span>
      <span class="chart-legend-item">
        <span
            class="chart-legend-swatch"
            :style="{ background: AVOIDED_COLOR, borderColor: AVOIDED_EDGE }"
        ></span>
        au-dessus, évité
      </span>
      <span class="chart-legend-item chart-legend-threshold">
        <span class="chart-legend-rule"></span>
        votre seuil
      </span>
    </div>

    <div ref="wrapper" class="chart-wrapper">
      <p v-if="chartable.length === 0" class="chart-empty">
        {{ decisions.length === 0
            ? 'Optimisez un itinéraire pour comparer chaque péage à votre seuil.'
            : 'Aucun tronçon comparable sur ce trajet.' }}
      </p>

      <svg
          v-else
          id="profitability-chart"
          :viewBox="`0 0 ${width} ${height}`"
          role="group"
          aria-label="Rentabilité des péages en euros par heure gagnée"
      >
        <!-- Grille + axe Y -->
        <g v-for="tick in scale.ticks" :key="tick">
          <line
              :x1="PLOT.left" :x2="width - PLOT.right"
              :y1="yFor(tick)" :y2="yFor(tick)"
              class="chart-gridline"
          />
          <text :x="PLOT.left - 6" :y="yFor(tick) + 3" class="chart-tick" text-anchor="end">
            {{ tick }} €
          </text>
        </g>

        <!-- Colonnes -->
        <g v-for="(bar, index) in bars" :key="bar.decision.sectionKey">
          <path
              :d="barPath(bar)"
              :fill="bar.color"
              :fill-opacity="bar.decision.reliable ? (hovered === index ? 1 : 0.9) : 0.45"
              :stroke="bar.edge"
              :stroke-width="hovered === index ? 2.5 : 1.25"
          />
          <text
              :x="bar.x + bar.barWidth / 2"
              :y="bar.y - 5"
              class="chart-value"
              text-anchor="middle"
          >{{ bar.label }}</text>
          <text
              :x="bar.x + bar.barWidth / 2"
              :y="bar.baseline + 13"
              class="chart-tick"
              text-anchor="middle"
          >{{ bar.xLabel }}</text>

          <!-- Zone de survol plus large que la colonne -->
          <rect
              :x="bar.x - 12" :y="PLOT.top"
              :width="bar.barWidth + 24" :height="plotHeight"
              fill="transparent"
              tabindex="0"
              role="img"
              :aria-label="describe(bar.decision)"
              @mousemove="onHover(index, $event)"
              @mouseleave="hovered = -1"
              @focus="onFocus(index)"
              @blur="hovered = -1"
              @click="emit('select', bar.decision.sectionKey)"
              @keydown.enter="emit('select', bar.decision.sectionKey)"
          />
        </g>

        <!-- Seuil utilisateur -->
        <g v-if="thresholdY !== null">
          <line
              :x1="PLOT.left" :x2="width - PLOT.right"
              :y1="thresholdY" :y2="thresholdY"
              class="chart-threshold"
          />
          <text :x="width - PLOT.right" :y="thresholdY - 4" class="chart-threshold-label" text-anchor="end">
            Seuil {{ Math.round(scale.threshold) }} €/h
          </text>
        </g>
      </svg>

      <div
          v-if="hoveredBar"
          class="chart-tooltip"
          :style="{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }"
      >
        <div class="chart-tooltip-value">{{ hoveredBar.label }} gagnée</div>
        <div class="chart-tooltip-name">
          {{ hoveredBar.decision.exitStationName
              ? `${hoveredBar.decision.entryStationName} → ${hoveredBar.decision.exitStationName}`
              : `${hoveredBar.decision.entryStationName} (barrière)` }}
        </div>
        <div class="chart-tooltip-row">Péage : {{ euros(hoveredBar.decision.priceCents) }}</div>
        <div v-if="hoveredBar.decision.extraDurationSeconds !== null" class="chart-tooltip-row">
          Éviter : +{{ Math.round(hoveredBar.decision.extraDurationSeconds / 60) }} min,
          −{{ euros(hoveredBar.decision.savedCents ?? 0) }}
        </div>
        <div class="chart-tooltip-row">
          {{ hoveredBar.decision.keptInBest ? 'Franchi' : 'Évité' }} par la recommandation
        </div>
        <div v-if="!hoveredBar.decision.reliable" class="chart-tooltip-warning">
          Comparaison incertaine : tarification partielle.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.chart-panel {
  .chart-legend {
    display: flex;
    gap: 1rem;
    font-size: .72rem;
    color: var(--ardoise);
    flex-shrink: 0;

    &-item {
      display: flex;
      align-items: center;
      gap: .35rem;
    }

    /* La teinte du liseré arrive en style inline ; sans `border-style` ici,
       elle n'aurait rien à colorer. */
    &-swatch {
      width: 12px;
      height: 8px;
      border: 1px solid;
      border-radius: 1px;
      flex-shrink: 0;
    }

    /* Le trait de seuil, repris tel quel du graphique. */
    &-rule {
      width: 14px;
      height: 0;
      border-top: 2px dashed var(--soleil-encre);
      flex-shrink: 0;
    }
  }

  .chart-wrapper {
    position: relative;

    .chart-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      font-size: .82rem;
      color: var(--ardoise);
    }

    .chart-gridline {
      stroke: var(--trait);
      stroke-width: 1;
    }

    .chart-tick {
      font-family: var(--font-mono);
      font-size: 10px;
      fill: var(--ardoise);
    }

    .chart-value {
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 700;
      fill: var(--encre);
    }

    .chart-threshold {
      stroke: var(--soleil-encre);
      stroke-width: 2;
      stroke-dasharray: 5 4;
    }

    .chart-threshold-label {
      font-family: var(--font-signal);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .04em;
      fill: var(--soleil-encre);
    }

    .chart-tooltip {
      position: absolute;
      z-index: 5;
      pointer-events: none;
      min-width: 170px;
      max-width: 220px;
      background: var(--blanc);
      border: 1px solid var(--trait);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-md);
      padding: .5rem .6rem;
      font-size: .74rem;
      color: var(--ardoise);

      &-value {
        font-family: var(--font-mono);
        font-variant-numeric: tabular-nums;
        font-size: .9rem;
        font-weight: 700;
        color: var(--encre);
      }

      &-name {
        color: var(--encre);
        margin-bottom: .25rem;
      }

      &-warning {
        color: var(--soleil-encre);
        margin-top: .25rem;
      }
    }
  }
}
</style>
