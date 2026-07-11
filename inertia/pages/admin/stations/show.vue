<script setup lang="ts">
import { computed, ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin.vue'

defineOptions({ layout: AdminLayout })

const VEHICLE_CLASSES = [1, 2, 3, 4, 5] as const

interface PriceRow {
  exitStationId: number | null
  exitName: string | null
  distanceMeters: number | null
  priceCents: (number | null)[]
}

const props = defineProps<{
  station: {
    id: number
    name: string
    operatorCode: string | null
    networkName: string | null
    pricingMode: 'open' | 'closed' | null
  }
  periods: { validFrom: string; validTo: string | null }[]
  selectedGrid: string | null
  rows: PriceRow[]
}>()

/* ─── Sélection de la grille ───────────────────────────────────────────── */

const grid = ref(props.selectedGrid ?? '')

function onGridChange() {
  router.get(
    `/admin/stations/${props.station.id}`,
    { grid: grid.value },
    { preserveState: true, preserveScroll: true }
  )
}

/* ─── Filtre destinations ──────────────────────────────────────────────── */

const search = ref('')

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

const filteredRows = computed(() => {
  const needle = normalize(search.value.trim())
  if (needle === '') return props.rows
  return props.rows.filter(
    (row) => row.exitName === null || normalize(row.exitName).includes(needle)
  )
})

/* ─── Formatage ────────────────────────────────────────────────────────── */

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const dates = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' })

function formatCents(cents: number | null): string {
  return cents === null ? '—' : euros.format(cents / 100)
}

function formatDate(iso: string): string {
  return dates.format(new Date(iso))
}

function formatKilometers(meters: number | null): string {
  return meters === null ? '—' : `${(meters / 1000).toLocaleString('fr-FR')} km`
}

function periodLabel(period: { validFrom: string; validTo: string | null }): string {
  return period.validTo === null
    ? `En vigueur depuis le ${formatDate(period.validFrom)}`
    : `Du ${formatDate(period.validFrom)} au ${formatDate(period.validTo)}`
}
</script>

<template>
  <div class="station">
    <Link href="/admin/stations" class="station-back">← Toutes les gares</Link>

    <div class="station-head">
      <h1 class="station-head-title">{{ station.name }}</h1>
      <span v-if="station.networkName" class="station-head-badge">{{ station.networkName }}</span>
      <span v-if="station.pricingMode" class="station-head-badge">
        {{ station.pricingMode === 'closed' ? 'Système fermé' : 'Système ouvert' }}
      </span>
      <code v-if="station.operatorCode" class="station-head-code">
        code {{ station.operatorCode }}
      </code>
    </div>

    <p v-if="periods.length === 0" class="station-none card">
      Aucun prix enregistré au départ de cette gare. Importez une grille tarifaire depuis
      <Link href="/admin/prices">Grilles tarifaires</Link>.
    </p>

    <template v-else>
      <div class="station-toolbar">
        <select v-model="grid" class="station-toolbar-grid" @change="onGridChange">
          <option v-for="period in periods" :key="period.validFrom" :value="period.validFrom">
            {{ periodLabel(period) }}
          </option>
        </select>
        <input
          v-model="search"
          type="text"
          placeholder="Filtrer les destinations…"
          class="station-toolbar-search"
        />
        <span class="station-toolbar-count">
          {{ filteredRows.length }} destination{{ filteredRows.length > 1 ? 's' : '' }}
        </span>
      </div>

      <div class="station-table card">
        <table>
          <thead>
            <tr>
              <th>Destination</th>
              <th class="station-table-num">Distance</th>
              <th v-for="klass in VEHICLE_CLASSES" :key="klass" class="station-table-num">
                Classe {{ klass }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredRows" :key="row.exitStationId ?? 'fixed'">
              <td>
                <em v-if="row.exitName === null">Prix fixe au franchissement</em>
                <template v-else>{{ row.exitName }}</template>
              </td>
              <td class="station-table-num">{{ formatKilometers(row.distanceMeters) }}</td>
              <td v-for="klass in VEHICLE_CLASSES" :key="klass" class="station-table-num">
                <span :class="{ 'station-table-missing': row.priceCents[klass - 1] === null }">
                  {{ formatCents(row.priceCents[klass - 1] ?? null) }}
                </span>
              </td>
            </tr>
            <tr v-if="filteredRows.length === 0">
              <td colspan="7" class="station-table-none">Aucune destination ne correspond.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped lang="less">
.station {
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;

  &-back {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--color-muted);
    text-decoration: none;

    &:hover {
      color: var(--color-primary-dk);
    }
  }

  &-head {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    flex-wrap: wrap;

    &-title {
      font-size: 1.4rem;
      letter-spacing: -0.02em;
    }

    &-badge {
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--color-muted);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 99px;
      padding: 0.15rem 0.55rem;
      white-space: nowrap;
    }

    &-code {
      font-size: 0.78rem;
      color: var(--color-muted);
    }
  }

  &-none {
    font-size: 0.9rem;
    color: var(--color-muted);

    a {
      color: var(--color-primary-dk);
      font-weight: 600;
    }
  }

  &-toolbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;

    &-grid {
      width: auto;
      min-width: 260px;
    }

    &-search {
      flex: 1;
    }

    &-count {
      font-size: 0.82rem;
      color: var(--color-muted);
      white-space: nowrap;
    }
  }

  &-table {
    padding: 0;
    overflow: hidden;

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }

    th {
      text-align: left;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-muted);
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--color-border);
      background: var(--color-bg);
      position: sticky;
      top: 0;
    }

    td {
      padding: 0.55rem 1rem;
      border-bottom: 1px solid var(--color-border);

      em {
        color: var(--color-muted);
      }
    }

    tr:last-child td {
      border-bottom: none;
    }

    &-num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    &-missing {
      color: var(--color-warning);
    }

    &-none {
      text-align: center;
      color: var(--color-muted);
      padding: 1.5rem;
    }
  }
}
</style>
