<script setup lang="ts">
import { computed, ref } from 'vue'
import { useForm } from '@inertiajs/vue3'
import AdminLayout from '~/layouts/admin.vue'

defineOptions({ layout: AdminLayout })

type VehicleClass = 1 | 2 | 3 | 4 | 5

interface NetworkSummary {
  id: number
  slug: string
  name: string
  pricingMode: 'open' | 'closed'
  stationCount: number
  hasParser: boolean
  currentGrid: { validFrom: string; priceCount: number } | null
}

interface CappedList<T> {
  total: number
  items: T[]
}

interface PriceAnomaly {
  entry: string
  exit: string | null
  vehicleClass: VehicleClass
  priceCents: number
  conflictingPriceCents: number
}

/** Miroir de `StoredImportReport` (app/services/import/import_report_store.ts). */
interface LastImportReport {
  networkSlug: string
  networkName: string
  fileName: string
  validFrom: string
  importedAt: string
  extractedRows: number
  inserted: number
  skippedRows: number
  unmatched: CappedList<{ name: string; code: string | null; reason: 'not_found' | 'ambiguous' }>
  selfPairs: CappedList<{ entry: string; exit: string }>
  conflicts: CappedList<PriceAnomaly>
  asymmetries: CappedList<PriceAnomaly>
  invalidPrices: CappedList<{
    entry: string
    exit: string | null
    vehicleClass: VehicleClass
    priceCents: number
  }>
  incompletePairs: CappedList<{
    entry: string
    exit: string | null
    missingClasses: VehicleClass[]
  }>
}

const props = defineProps<{
  networks: NetworkSummary[]
  lastImport: LastImportReport | null
}>()

/* ─── Import ───────────────────────────────────────────────────────────── */

/** Les grilles entrent en vigueur au 1er février, en général. */
function defaultValidFrom(): string {
  return `${new Date().getFullYear()}-02-01`
}

const fileInput = ref<HTMLInputElement | null>(null)

const form = useForm<{ network: string; validFrom: string; pdf: File | null }>({
  network: props.networks.find((network) => network.hasParser)?.slug ?? '',
  validFrom: defaultValidFrom(),
  pdf: null,
})

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  form.pdf = input.files?.[0] ?? null
}

function submit() {
  form.post('/admin/prices/import', {
    onSuccess: () => {
      form.reset('pdf')
      if (fileInput.value) {
        fileInput.value.value = ''
      }
    },
  })
}

/* ─── Formatage ────────────────────────────────────────────────────────── */

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const dates = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' })
const dateTimes = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' })

function formatCents(cents: number): string {
  return euros.format(cents / 100)
}

function formatDate(iso: string): string {
  return dates.format(new Date(iso))
}

function formatDateTime(iso: string): string {
  return dateTimes.format(new Date(iso))
}

function formatPair(entry: string, exit: string | null): string {
  return exit === null ? `${entry} (prix fixe)` : `${entry} → ${exit}`
}

function formatRemainder<T>(list: CappedList<T>): string | null {
  const hidden = list.total - list.items.length
  return hidden > 0 ? `… et ${hidden} autres` : null
}

const anomalyCount = computed(() => {
  const report = props.lastImport
  if (report === null) return 0
  return (
    report.unmatched.total +
    report.selfPairs.total +
    report.conflicts.total +
    report.asymmetries.total +
    report.invalidPrices.total +
    report.incompletePairs.total
  )
})
</script>

<template>
  <div class="prices">
    <h1 class="prices-title">Grilles tarifaires</h1>
    <p class="prices-subtitle">
      Importez les grilles de prix PDF publiées par les concessionnaires et suivez l'état des tarifs
      chargés par réseau.
    </p>

    <!-- ─── État des réseaux ─────────────────────────────────────────── -->
    <section class="networks">
      <article v-for="network in networks" :key="network.id" class="networks-card">
        <div class="networks-card-head">
          <h2>{{ network.name }}</h2>
          <span class="networks-card-mode">
            {{ network.pricingMode === 'closed' ? 'Système fermé' : 'Système ouvert' }}
          </span>
        </div>

        <dl class="networks-card-stats">
          <div>
            <dt>Gares</dt>
            <dd>{{ network.stationCount }}</dd>
          </div>
          <div>
            <dt>Prix en vigueur</dt>
            <dd>{{ network.currentGrid?.priceCount ?? '—' }}</dd>
          </div>
          <div>
            <dt>Grille du</dt>
            <dd>{{ network.currentGrid ? formatDate(network.currentGrid.validFrom) : '—' }}</dd>
          </div>
        </dl>

        <p v-if="!network.hasParser" class="networks-card-noparser">
          Grille PDF non prise en charge pour l'instant
        </p>
      </article>
    </section>

    <!-- ─── Import d'une grille ──────────────────────────────────────── -->
    <section class="card import">
      <h2 class="card-title">Importer une grille PDF</h2>

      <form @submit.prevent="submit">
        <div class="import-fields">
          <div class="form-group">
            <label for="network">Réseau</label>
            <select id="network" v-model="form.network" required>
              <option
                v-for="network in networks"
                :key="network.id"
                :value="network.slug"
                :disabled="!network.hasParser"
              >
                {{ network.name }}{{ network.hasParser ? '' : ' — non pris en charge' }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label for="valid-from">Entrée en vigueur</label>
            <input id="valid-from" v-model="form.validFrom" type="date" required />
          </div>

          <div class="form-group">
            <label for="pdf">Grille PDF</label>
            <input
              id="pdf"
              ref="fileInput"
              type="file"
              accept=".pdf,application/pdf"
              required
              @change="onFileChange"
            />
          </div>
        </div>

        <p class="import-hint">
          L'import remplace la grille du réseau à cette date et clôt la grille précédente.
          Ré-importer un même PDF est sans danger.
        </p>

        <button
          type="submit"
          class="import-submit"
          :disabled="form.processing || form.pdf === null"
        >
          {{ form.processing ? 'Import en cours…' : 'Importer la grille' }}
        </button>
        <span v-if="form.progress" class="import-progress">{{ form.progress.percentage }}%</span>
      </form>
    </section>

    <!-- ─── Rapport du dernier import ────────────────────────────────── -->
    <section v-if="lastImport" class="card report">
      <h2 class="card-title">Dernier import</h2>

      <p class="report-meta">
        <strong>{{ lastImport.networkName }}</strong> — grille du
        {{ formatDate(lastImport.validFrom) }}, importée le
        {{ formatDateTime(lastImport.importedAt) }} depuis
        <code>{{ lastImport.fileName }}</code>
      </p>

      <dl class="report-stats">
        <div>
          <dt>Lignes extraites du PDF</dt>
          <dd>{{ lastImport.extractedRows }}</dd>
        </div>
        <div>
          <dt>Prix insérés</dt>
          <dd class="report-stats-ok">{{ lastImport.inserted }}</dd>
        </div>
        <div>
          <dt>Lignes écartées</dt>
          <dd :class="{ 'report-stats-warn': lastImport.skippedRows > 0 }">
            {{ lastImport.skippedRows }}
          </dd>
        </div>
      </dl>

      <p v-if="anomalyCount === 0" class="report-clean">Aucune anomalie détectée. ✅</p>

      <template v-else>
        <details v-if="lastImport.unmatched.total > 0" class="report-issues">
          <summary>{{ lastImport.unmatched.total }} gares non résolues</summary>
          <ul>
            <li v-for="(station, index) in lastImport.unmatched.items" :key="index">
              {{ station.name }}<code v-if="station.code"> [{{ station.code }}]</code> —
              {{
                station.reason === 'ambiguous'
                  ? 'plusieurs correspondances'
                  : 'aucune correspondance'
              }}
            </li>
            <li v-if="formatRemainder(lastImport.unmatched)">
              {{ formatRemainder(lastImport.unmatched) }}
            </li>
          </ul>
        </details>

        <details v-if="lastImport.selfPairs.total > 0" class="report-issues">
          <summary>{{ lastImport.selfPairs.total }} couples résolus vers la même gare</summary>
          <ul>
            <li v-for="(pair, index) in lastImport.selfPairs.items" :key="index">
              {{ pair.entry }} → {{ pair.exit }}
            </li>
            <li v-if="formatRemainder(lastImport.selfPairs)">
              {{ formatRemainder(lastImport.selfPairs) }}
            </li>
          </ul>
        </details>

        <details v-if="lastImport.conflicts.total > 0" class="report-issues">
          <summary>{{ lastImport.conflicts.total }} conflits de prix</summary>
          <ul>
            <li v-for="(anomaly, index) in lastImport.conflicts.items" :key="index">
              {{ formatPair(anomaly.entry, anomaly.exit) }}, classe {{ anomaly.vehicleClass }} :
              {{ formatCents(anomaly.priceCents) }} vs
              {{ formatCents(anomaly.conflictingPriceCents) }}
            </li>
            <li v-if="formatRemainder(lastImport.conflicts)">
              {{ formatRemainder(lastImport.conflicts) }}
            </li>
          </ul>
        </details>

        <details v-if="lastImport.asymmetries.total > 0" class="report-issues">
          <summary>{{ lastImport.asymmetries.total }} asymétries A→B / B→A</summary>
          <ul>
            <li v-for="(anomaly, index) in lastImport.asymmetries.items" :key="index">
              {{ formatPair(anomaly.entry, anomaly.exit) }}, classe {{ anomaly.vehicleClass }} :
              {{ formatCents(anomaly.priceCents) }} vs
              {{ formatCents(anomaly.conflictingPriceCents) }}
            </li>
            <li v-if="formatRemainder(lastImport.asymmetries)">
              {{ formatRemainder(lastImport.asymmetries) }}
            </li>
          </ul>
        </details>

        <details v-if="lastImport.invalidPrices.total > 0" class="report-issues">
          <summary>{{ lastImport.invalidPrices.total }} prix invalides rejetés</summary>
          <ul>
            <li v-for="(invalid, index) in lastImport.invalidPrices.items" :key="index">
              {{ formatPair(invalid.entry, invalid.exit) }}, classe {{ invalid.vehicleClass }} :
              {{ invalid.priceCents }} centimes
            </li>
            <li v-if="formatRemainder(lastImport.invalidPrices)">
              {{ formatRemainder(lastImport.invalidPrices) }}
            </li>
          </ul>
        </details>

        <details v-if="lastImport.incompletePairs.total > 0" class="report-issues">
          <summary>{{ lastImport.incompletePairs.total }} couples sans les cinq classes</summary>
          <ul>
            <li v-for="(pair, index) in lastImport.incompletePairs.items" :key="index">
              {{ formatPair(pair.entry, pair.exit) }} — classes manquantes :
              {{ pair.missingClasses.join(', ') }}
            </li>
            <li v-if="formatRemainder(lastImport.incompletePairs)">
              {{ formatRemainder(lastImport.incompletePairs) }}
            </li>
          </ul>
        </details>
      </template>
    </section>
  </div>
</template>

<style scoped lang="less">
.prices {
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
}

.networks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;

  &-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 1rem;
    box-shadow: var(--shadow-sm);

    &-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.75rem;

      h2 {
        font-size: 1rem;
      }
    }

    &-mode {
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--color-muted);
      background: var(--color-bg);
      border-radius: 99px;
      padding: 0.15rem 0.55rem;
      white-space: nowrap;
    }

    &-stats {
      display: flex;
      gap: 1.25rem;

      dt {
        font-size: 0.72rem;
        color: var(--color-muted);
      }

      dd {
        font-size: 1.05rem;
        font-weight: 700;
      }
    }

    &-noparser {
      margin-top: 0.75rem;
      font-size: 0.78rem;
      color: var(--color-warning);
    }
  }
}

.import {
  &-fields {
    display: grid;
    grid-template-columns: 2fr 1fr 2fr;
    gap: 1rem;

    @media (max-width: 720px) {
      grid-template-columns: 1fr;
    }
  }

  &-hint {
    font-size: 0.78rem;
    color: var(--color-muted);
    margin: 0.5rem 0 1rem;
  }

  &-submit {
    padding: 0.6rem 1.25rem;
    background: var(--color-primary);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;

    &:hover {
      background: var(--color-primary-dk);
    }

    &:disabled {
      background: #93c5fd;
      cursor: not-allowed;
    }
  }

  &-progress {
    margin-left: 0.75rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-primary-dk);
  }

  input[type='date'],
  input[type='file'] {
    width: 100%;
    padding: 0.45rem 0.75rem;
    border: 1.5px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
    font-family: inherit;
    color: var(--color-text);
    background: var(--color-surface);
    outline: none;

    &:focus {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }
  }
}

.report {
  &-meta {
    font-size: 0.88rem;
    margin-bottom: 1rem;

    code {
      background: var(--color-bg);
      border-radius: 4px;
      padding: 0.1rem 0.35rem;
      font-size: 0.8rem;
    }
  }

  &-stats {
    display: flex;
    gap: 2rem;
    margin-bottom: 1rem;

    dt {
      font-size: 0.72rem;
      color: var(--color-muted);
    }

    dd {
      font-size: 1.3rem;
      font-weight: 700;
    }

    &-ok {
      color: var(--color-success);
    }

    &-warn {
      color: var(--color-warning);
    }
  }

  &-clean {
    font-size: 0.88rem;
    color: var(--color-success);
    font-weight: 600;
  }

  &-issues {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    margin-bottom: 0.5rem;

    summary {
      padding: 0.6rem 0.85rem;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      color: #92400e;
      background: #fffbeb;
      border-radius: var(--radius-sm);
    }

    ul {
      list-style: none;
      padding: 0.5rem 0.85rem;
      font-size: 0.82rem;

      li {
        padding: 0.2rem 0;

        code {
          color: var(--color-muted);
        }
      }
    }
  }
}
</style>
