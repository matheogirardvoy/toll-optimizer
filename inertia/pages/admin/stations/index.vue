<script setup lang="ts">
import { computed, ref } from 'vue'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin.vue'

defineOptions({ layout: AdminLayout })

interface StationSummary {
  id: number
  name: string
  operatorCode: string | null
  networkSlug: string | null
  networkName: string | null
  priceCount: number
}

const props = defineProps<{
  stations: StationSummary[]
  networks: { slug: string; name: string }[]
}>()

const search = ref('')
const networkFilter = ref('')

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

const filteredStations = computed(() => {
  const needle = normalize(search.value.trim())
  return props.stations.filter((station) => {
    if (networkFilter.value !== '' && station.networkSlug !== networkFilter.value) return false
    if (needle === '') return true
    return (
      normalize(station.name).includes(needle) ||
      (station.operatorCode !== null && station.operatorCode.includes(needle))
    )
  })
})
</script>

<template>
  <div class="stations">
    <h1 class="stations-title">Gares &amp; tarifs</h1>
    <p class="stations-subtitle">
      Recherchez une gare pour consulter ses prix au départ, par destination et par classe de
      véhicule.
    </p>

    <div class="stations-filters">
      <input
        v-model="search"
        type="text"
        placeholder="Rechercher une gare (nom ou code)…"
        class="stations-filters-search"
      />
      <select v-model="networkFilter">
        <option value="">Tous les réseaux</option>
        <option v-for="network in networks" :key="network.slug" :value="network.slug">
          {{ network.name }}
        </option>
      </select>
      <span class="stations-filters-count">
        {{ filteredStations.length }} gare{{ filteredStations.length > 1 ? 's' : '' }}
      </span>
    </div>

    <div class="stations-table card">
      <table>
        <thead>
          <tr>
            <th>Gare</th>
            <th>Réseau</th>
            <th>Code</th>
            <th class="stations-table-num">Prix en vigueur</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="station in filteredStations" :key="station.id">
            <td>
              <Link :href="`/admin/stations/${station.id}`">{{ station.name }}</Link>
            </td>
            <td>{{ station.networkName ?? '—' }}</td>
            <td>
              <code v-if="station.operatorCode">{{ station.operatorCode }}</code>
              <template v-else>—</template>
            </td>
            <td class="stations-table-num">
              <span :class="{ 'stations-table-empty': station.priceCount === 0 }">
                {{ station.priceCount }}
              </span>
            </td>
            <td class="stations-table-action">
              <Link :href="`/admin/stations/${station.id}`">Voir les prix →</Link>
            </td>
          </tr>
          <tr v-if="filteredStations.length === 0">
            <td colspan="5" class="stations-table-none">Aucune gare ne correspond.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped lang="less">
.stations {
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

  &-filters {
    display: flex;
    align-items: center;
    gap: 0.75rem;

    &-search {
      flex: 1;
    }

    select {
      width: auto;
      min-width: 180px;
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
    }

    td {
      padding: 0.6rem 1rem;
      border-bottom: 1px solid var(--color-border);

      a {
        color: var(--color-primary-dk);
        font-weight: 600;
        text-decoration: none;

        &:hover {
          text-decoration: underline;
        }
      }

      code {
        background: var(--color-bg);
        border-radius: 4px;
        padding: 0.1rem 0.35rem;
        font-size: 0.8rem;
      }
    }

    tr:last-child td {
      border-bottom: none;
    }

    &-num {
      text-align: right;
    }

    &-empty {
      color: var(--color-warning);
      font-weight: 600;
    }

    &-action {
      text-align: right;
      white-space: nowrap;

      a {
        font-size: 0.8rem;
      }
    }

    &-none {
      text-align: center;
      color: var(--color-muted);
      padding: 1.5rem;
    }
  }
}
</style>
