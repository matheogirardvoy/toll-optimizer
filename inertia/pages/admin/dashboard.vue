<script setup lang="ts">
import { computed } from 'vue'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin.vue'

defineOptions({ layout: AdminLayout })

interface DashboardStats {
  tollCount: number
  referenceDate: string | null
  networkCount: number
  stationCount: number
  priceCount: number
}

/** Sous-ensemble de `StoredImportReport` utile au rappel du dernier import. */
interface LastImportSummary {
  networkName: string
  fileName: string
  validFrom: string
  importedAt: string
  inserted: number
}

const props = defineProps<{
  stats: DashboardStats
  lastImport: LastImportSummary | null
}>()

const dates = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' })
const dateTimes = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' })
const numbers = new Intl.NumberFormat('fr-FR')

function formatDate(iso: string | null): string {
  return iso === null ? '—' : dates.format(new Date(iso))
}

/** Indicateurs chiffrés, dérivés des stats pour un rendu `v-for` DRY. */
const metrics = computed(() => [
  { label: 'Péages en base', value: numbers.format(props.stats.tollCount) },
  { label: 'Réseaux', value: numbers.format(props.stats.networkCount) },
  { label: 'Gares de péage', value: numbers.format(props.stats.stationCount) },
  { label: 'Prix en vigueur', value: numbers.format(props.stats.priceCount) },
])

/** Raccourcis vers les sections de gestion. */
const shortcuts = [
  {
    href: '/admin/tolls',
    icon: '🛣️',
    title: 'Référentiel des péages',
    text: "Importez le référentiel des gares du réseau national concédé depuis data.gouv.fr ou un fichier CSV.",
  },
  {
    href: '/admin/prices',
    icon: '💶',
    title: 'Grilles tarifaires',
    text: 'Importez les grilles de prix PDF des concessionnaires et suivez leur état par réseau.',
  },
  {
    href: '/admin/stations',
    icon: '🚧',
    title: 'Gares & tarifs',
    text: 'Consultez les prix au départ de chaque gare, par destination et par classe de véhicule.',
  },
]
</script>

<template>
  <div class="dashboard">
    <h1 class="dashboard-title">Tableau de bord</h1>
    <p class="dashboard-subtitle">
      Vue d'ensemble du référentiel des péages et des grilles tarifaires chargées.
    </p>

    <!-- ─── Indicateurs ──────────────────────────────────────────────── -->
    <section class="dashboard-metrics">
      <article v-for="metric in metrics" :key="metric.label" class="metric card">
        <span class="metric-value">{{ metric.value }}</span>
        <span class="metric-label">{{ metric.label }}</span>
      </article>
    </section>

    <p class="dashboard-reference">
      Référentiel des péages daté du <strong>{{ formatDate(stats.referenceDate) }}</strong>.
    </p>

    <!-- ─── Raccourcis ───────────────────────────────────────────────── -->
    <section class="dashboard-shortcuts">
      <Link
        v-for="shortcut in shortcuts"
        :key="shortcut.href"
        :href="shortcut.href"
        class="shortcut card"
      >
        <span class="shortcut-icon" aria-hidden="true">{{ shortcut.icon }}</span>
        <span class="shortcut-body">
          <span class="shortcut-title">{{ shortcut.title }}</span>
          <span class="shortcut-text">{{ shortcut.text }}</span>
        </span>
        <span class="shortcut-arrow" aria-hidden="true">→</span>
      </Link>
    </section>

    <!-- ─── Dernier import de grille ─────────────────────────────────── -->
    <section v-if="lastImport" class="card dashboard-import">
      <h2 class="card-title">Dernier import de grille</h2>
      <p class="dashboard-import-meta">
        <strong>{{ lastImport.networkName }}</strong> — grille du
        {{ formatDate(lastImport.validFrom) }}, {{ numbers.format(lastImport.inserted) }} prix
        importés le {{ dateTimes.format(new Date(lastImport.importedAt)) }} depuis
        <code>{{ lastImport.fileName }}</code>
      </p>
      <Link href="/admin/prices" class="dashboard-import-link">Voir le rapport complet →</Link>
    </section>
  </div>
</template>

<style scoped lang="less">
.dashboard {
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;

  &-title {
    font-size: 1.4rem;
    letter-spacing: -0.02em;
  }

  &-subtitle {
    color: var(--color-muted);
    font-size: 0.9rem;
    margin-top: -0.75rem;
  }

  &-metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 1rem;
  }

  &-reference {
    font-size: 0.85rem;
    color: var(--color-muted);
    margin-top: -0.5rem;
  }

  &-shortcuts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1rem;
  }

  &-import {
    &-meta {
      font-size: 0.88rem;
      margin-bottom: 0.75rem;

      code {
        background: var(--color-bg);
        border-radius: 4px;
        padding: 0.1rem 0.35rem;
        font-size: 0.8rem;
      }
    }

    &-link {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--color-primary-dk);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
  }
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  &-value {
    font-size: 1.75rem;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  &-label {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-muted);
  }
}

.shortcut {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  text-decoration: none;
  color: inherit;
  transition:
    border-color 0.15s,
    box-shadow 0.15s,
    transform 0.15s;

  &:hover {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }

  &-icon {
    font-size: 1.6rem;
    line-height: 1;
    flex-shrink: 0;
  }

  &-body {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    flex: 1;
  }

  &-title {
    font-size: 0.95rem;
    font-weight: 700;
  }

  &-text {
    font-size: 0.8rem;
    color: var(--color-muted);
    line-height: 1.35;
  }

  &-arrow {
    color: var(--color-primary);
    font-weight: 700;
    flex-shrink: 0;
  }
}
</style>
