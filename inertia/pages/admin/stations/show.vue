<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
    networkId: number | null
    operatorCode: string | null
    networkName: string | null
    pricingMode: 'open' | 'closed' | null
  }
  networks: { id: number; name: string }[]
  exitStations: { id: number; name: string }[]
  periods: { validFrom: string; validTo: string | null }[]
  selectedGrid: string | null
  rows: PriceRow[]
}>()

const isOpenSystem = computed(() => props.station.pricingMode === 'open')
const hasNetwork = computed(() => props.station.networkId !== null)

/* ─── Rattachement à un réseau (gares orphelines) ──────────────────────── */

const assignNetworkId = ref('')
const showCreateNetwork = ref(false)
const newNetworkName = ref('')
const newNetworkSlug = ref('')
const newNetworkMode = ref<'open' | 'closed'>('closed')
const assigning = ref(false)

function slugify(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function onNetworkNameInput(event: Event) {
  const target = event.target as HTMLInputElement
  newNetworkName.value = target.value
  newNetworkSlug.value = slugify(target.value)
}

const canCreateNetwork = computed(
  () =>
    newNetworkName.value.trim().length >= 2 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newNetworkSlug.value)
)

function assignExistingNetwork() {
  if (assignNetworkId.value === '' || assigning.value) return
  assigning.value = true
  router.put(
    `/admin/stations/${props.station.id}/network`,
    { networkId: Number(assignNetworkId.value) },
    { preserveScroll: true, onFinish: () => (assigning.value = false) }
  )
}

function createAndAssignNetwork() {
  if (!canCreateNetwork.value || assigning.value) return
  assigning.value = true
  router.put(
    `/admin/stations/${props.station.id}/network`,
    {
      name: newNetworkName.value.trim(),
      slug: newNetworkSlug.value,
      pricingMode: newNetworkMode.value,
    },
    { preserveScroll: true, onFinish: () => (assigning.value = false) }
  )
}

/* ─── Sélection de la grille ───────────────────────────────────────────── */

const grid = ref(props.selectedGrid ?? '')

watch(
  () => props.selectedGrid,
  (value) => {
    grid.value = value ?? ''
  }
)

function onGridChange() {
  router.get(
    `/admin/stations/${props.station.id}`,
    { grid: grid.value },
    { preserveState: true, preserveScroll: true }
  )
}

/* ─── Filtre destinations (lecture seule) ──────────────────────────────── */

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

/* ─── Édition ──────────────────────────────────────────────────────────── */

interface EditRow {
  key: string
  exitStationId: number | null
  exitName: string | null
  distanceKm: number | null
  euros: (number | null)[]
  isNew: boolean
  saving: boolean
}

/** Les grilles entrent en vigueur au 1er février, en général. */
function defaultValidFrom(): string {
  return `${new Date().getFullYear()}-02-01`
}

const editing = ref(false)
const creatingGrid = ref(false)
const newGridDate = ref(defaultValidFrom())
const symmetric = ref(false)
const addExitId = ref('')
const editRows = ref<EditRow[]>([])

function centsToEuros(cents: number | null): number | null {
  return cents === null ? null : cents / 100
}

function buildEditRows(): EditRow[] {
  return props.rows.map((row) => ({
    key: row.exitStationId === null ? 'fixed' : String(row.exitStationId),
    exitStationId: row.exitStationId,
    exitName: row.exitName,
    distanceKm: row.distanceMeters === null ? null : row.distanceMeters / 1000,
    euros: VEHICLE_CLASSES.map((klass) => centsToEuros(row.priceCents[klass - 1] ?? null)),
    isNew: false,
    saving: false,
  }))
}

const targetValidFrom = computed(() =>
  creatingGrid.value ? newGridDate.value : (props.selectedGrid ?? '')
)

const canSaveGrid = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(targetValidFrom.value))

function startEditing() {
  creatingGrid.value = false
  editRows.value = buildEditRows()
  editing.value = true
}

function startNewGrid() {
  creatingGrid.value = true
  newGridDate.value = defaultValidFrom()
  // Pré-remplissage depuis la grille affichée pour accélérer la revalorisation.
  editRows.value = buildEditRows()
  editing.value = true
}

function stopEditing() {
  editing.value = false
  creatingGrid.value = false
  addExitId.value = ''
}

const usedExitIds = computed(
  () =>
    new Set(
      editRows.value.map((row) => row.exitStationId).filter((id): id is number => id !== null)
    )
)

const availableExits = computed(() =>
  props.exitStations.filter((station) => !usedExitIds.value.has(station.id))
)

const hasFixedRow = computed(() => editRows.value.some((row) => row.exitStationId === null))

function addDestination() {
  if (isOpenSystem.value) {
    if (hasFixedRow.value) return
    editRows.value.unshift({
      key: 'fixed',
      exitStationId: null,
      exitName: null,
      distanceKm: null,
      euros: [null, null, null, null, null],
      isNew: true,
      saving: false,
    })
    return
  }
  const id = Number(addExitId.value)
  if (!Number.isInteger(id) || id <= 0) return
  const station = props.exitStations.find((exit) => exit.id === id)
  if (station === undefined) return
  editRows.value.push({
    key: String(id),
    exitStationId: id,
    exitName: station.name,
    distanceKm: null,
    euros: [null, null, null, null, null],
    isNew: true,
    saving: false,
  })
  addExitId.value = ''
}

function onEuroInput(row: EditRow, index: number, event: Event) {
  const target = event.target as HTMLInputElement
  const value = target.value.trim()
  const parsed = Number(value)
  row.euros[index] = value === '' || Number.isNaN(parsed) ? null : parsed
}

function onDistanceInput(row: EditRow, event: Event) {
  const target = event.target as HTMLInputElement
  const value = target.value.trim()
  const parsed = Number(value)
  row.distanceKm = value === '' || Number.isNaN(parsed) ? null : parsed
}

function saveRow(row: EditRow) {
  if (!canSaveGrid.value || row.saving) return
  row.saving = true
  router.post(
    `/admin/stations/${props.station.id}/prices`,
    {
      validFrom: targetValidFrom.value,
      exitStationId: row.exitStationId,
      distanceMeters: row.distanceKm === null ? null : Math.round(row.distanceKm * 1000),
      symmetric: symmetric.value && row.exitStationId !== null,
      prices: row.euros,
    },
    {
      preserveScroll: true,
      preserveState: true,
      onSuccess: () => {
        row.isNew = false
        creatingGrid.value = false
      },
      onFinish: () => {
        row.saving = false
      },
    }
  )
}

function deleteRow(row: EditRow) {
  if (row.isNew) {
    editRows.value = editRows.value.filter((candidate) => candidate !== row)
    return
  }
  if (row.saving) return
  row.saving = true
  const query = new URLSearchParams({
    validFrom: targetValidFrom.value,
    exitStationId: row.exitStationId === null ? 'fixed' : String(row.exitStationId),
  })
  router.delete(`/admin/stations/${props.station.id}/prices?${query.toString()}`, {
    preserveScroll: true,
    preserveState: true,
    onSuccess: () => {
      editRows.value = editRows.value.filter((candidate) => candidate !== row)
    },
    onFinish: () => {
      row.saving = false
    },
  })
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

    <!-- ─── Rattachement à un réseau (gare orpheline) ──────────────────── -->
    <div v-if="!hasNetwork" class="station-assign card">
      <p class="station-assign-lead">
        Cette gare n'est rattachée à aucun réseau. Rattachez-la à un réseau pour pouvoir saisir ses
        prix.
      </p>

      <div class="station-assign-row">
        <select v-model="assignNetworkId" class="station-assign-select">
          <option value="">Choisir un réseau existant…</option>
          <option v-for="network in networks" :key="network.id" :value="String(network.id)">
            {{ network.name }}
          </option>
        </select>
        <button
          type="button"
          class="station-btn"
          :disabled="assignNetworkId === '' || assigning"
          @click="assignExistingNetwork"
        >
          Rattacher
        </button>
        <button
          v-if="!showCreateNetwork"
          type="button"
          class="station-btn station-btn-ghost"
          @click="showCreateNetwork = true"
        >
          + Créer un réseau
        </button>
      </div>

      <div v-if="showCreateNetwork" class="station-assign-create">
        <div class="station-assign-fields">
          <label>
            <span>Nom</span>
            <input
              :value="newNetworkName"
              type="text"
              placeholder="ex. Escota"
              @input="onNetworkNameInput"
            />
          </label>
          <label>
            <span>Slug</span>
            <input v-model="newNetworkSlug" type="text" placeholder="ex. escota" />
          </label>
          <label>
            <span>Tarification</span>
            <select v-model="newNetworkMode">
              <option value="closed">Système fermé (entrée/sortie)</option>
              <option value="open">Système ouvert (prix fixe)</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          class="station-btn"
          :disabled="!canCreateNetwork || assigning"
          @click="createAndAssignNetwork"
        >
          Créer et rattacher
        </button>
      </div>
    </div>

    <!-- ─── Tarification (nécessite un réseau) ──────────────────────────── -->
    <template v-else>
      <!-- ─── Barre d'action ─────────────────────────────────────────────── -->
      <div class="station-actions">
        <template v-if="!editing">
          <button
            type="button"
            class="station-btn"
            :disabled="selectedGrid === null"
            @click="startEditing"
          >
            Modifier la grille
          </button>
          <button type="button" class="station-btn station-btn-ghost" @click="startNewGrid">
            + Nouvelle grille
          </button>
        </template>
        <template v-else>
          <span class="station-actions-mode">
            <template v-if="creatingGrid">
              Nouvelle grille — entrée en vigueur&nbsp;:
              <input v-model="newGridDate" type="date" class="station-actions-date" />
            </template>
            <template v-else>
              Édition de la grille du
              <strong>{{ selectedGrid ? formatDate(selectedGrid) : '—' }}</strong>
            </template>
          </span>
          <label v-if="!isOpenSystem" class="station-actions-sym">
            <input v-model="symmetric" type="checkbox" />
            Appliquer au sens retour
          </label>
          <button type="button" class="station-btn station-btn-ghost" @click="stopEditing">
            Terminer
          </button>
        </template>
      </div>

      <!-- ─── Lecture seule ──────────────────────────────────────────────── -->
      <template v-if="!editing">
        <p v-if="periods.length === 0" class="station-none card">
          Aucun prix enregistré au départ de cette gare. Importez une grille depuis
          <Link href="/admin/prices">Grilles tarifaires</Link>, ou créez-en une avec «&nbsp;+
          Nouvelle grille&nbsp;».
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
      </template>

      <!-- ─── Édition ────────────────────────────────────────────────────── -->
      <template v-else>
        <div class="station-add card">
          <template v-if="isOpenSystem">
            <button
              type="button"
              class="station-btn"
              :disabled="hasFixedRow"
              @click="addDestination"
            >
              + Ajouter le prix fixe
            </button>
            <span v-if="hasFixedRow" class="station-add-hint">Le prix fixe est déjà listé.</span>
          </template>
          <template v-else>
            <select v-model="addExitId" class="station-add-select">
              <option value="">Choisir une destination…</option>
              <option v-for="exit in availableExits" :key="exit.id" :value="String(exit.id)">
                {{ exit.name }}
              </option>
            </select>
            <button
              type="button"
              class="station-btn"
              :disabled="addExitId === ''"
              @click="addDestination"
            >
              + Ajouter la destination
            </button>
            <span v-if="availableExits.length === 0" class="station-add-hint">
              Toutes les gares du réseau sont déjà listées.
            </span>
          </template>
        </div>

        <div class="station-table card">
          <table>
            <thead>
              <tr>
                <th>Destination</th>
                <th class="station-table-num">Distance (km)</th>
                <th v-for="klass in VEHICLE_CLASSES" :key="klass" class="station-table-num">
                  Classe {{ klass }} (€)
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in editRows" :key="row.key">
                <td>
                  <em v-if="row.exitStationId === null">Prix fixe au franchissement</em>
                  <template v-else>{{ row.exitName }}</template>
                </td>
                <td class="station-table-num">
                  <input
                    class="station-table-input station-table-input-sm"
                    type="number"
                    min="0"
                    step="0.1"
                    :value="row.distanceKm ?? ''"
                    @input="onDistanceInput(row, $event)"
                  />
                </td>
                <td v-for="klass in VEHICLE_CLASSES" :key="klass" class="station-table-num">
                  <input
                    class="station-table-input"
                    type="number"
                    min="0"
                    step="0.01"
                    inputmode="decimal"
                    :value="row.euros[klass - 1] ?? ''"
                    @input="onEuroInput(row, klass - 1, $event)"
                  />
                </td>
                <td class="station-table-actions">
                  <button
                    type="button"
                    class="station-row-save"
                    :disabled="row.saving || !canSaveGrid"
                    @click="saveRow(row)"
                  >
                    {{ row.saving ? '…' : 'Enregistrer' }}
                  </button>
                  <button
                    type="button"
                    class="station-row-del"
                    :disabled="row.saving"
                    title="Supprimer cette destination"
                    @click="deleteRow(row)"
                  >
                    ✕
                  </button>
                </td>
              </tr>
              <tr v-if="editRows.length === 0">
                <td colspan="8" class="station-table-none">
                  Ajoutez une destination pour saisir ses prix.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="station-edithint">
          Montants en euros TTC ; une classe laissée vide n'est pas tarifée. L'enregistrement se
          fait ligne par ligne.
        </p>
      </template>
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

  &-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;

    &-mode {
      font-size: 0.85rem;
      color: var(--color-muted);
    }

    &-date {
      width: auto;
    }

    &-sym {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.82rem;
      color: var(--color-muted);
      cursor: pointer;
    }
  }

  &-btn {
    padding: 0.5rem 1rem;
    background: var(--color-primary);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 0.85rem;
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

    &-ghost {
      background: var(--color-surface);
      color: var(--color-muted);
      border: 1px solid var(--color-border);

      &:hover {
        background: var(--color-bg);
        color: var(--color-text);
      }

      &:disabled {
        background: var(--color-surface);
        color: var(--color-muted);
      }
    }
  }

  &-add {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;

    &-select {
      width: auto;
      min-width: 240px;
    }

    &-hint {
      font-size: 0.8rem;
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
    // Horizontal scroll plutôt que clipping : en édition, les colonnes d'inputs
    // + la colonne d'actions dépassent la largeur du conteneur.
    overflow-x: auto;

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

    &-input {
      width: 100%;
      max-width: 6.5rem;
      margin-left: auto;
      padding: 0.3rem 0.4rem;
      border: 1.5px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-family: inherit;
      font-size: 0.85rem;
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--color-text);
      background: var(--color-surface);
      outline: none;

      &:focus {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
      }

      &-sm {
        max-width: 5rem;
      }
    }

    &-actions {
      text-align: right;
      white-space: nowrap;
    }
  }

  &-row-save {
    padding: 0.3rem 0.6rem;
    background: var(--color-primary);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 0.78rem;
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

  &-row-del {
    margin-left: 0.35rem;
    padding: 0.3rem 0.5rem;
    background: var(--color-surface);
    color: var(--color-muted);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.78rem;
    cursor: pointer;
    transition:
      border-color 0.15s,
      color 0.15s;

    &:hover {
      border-color: var(--color-danger);
      color: var(--color-danger);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  }

  &-edithint {
    font-size: 0.8rem;
    color: var(--color-muted);
  }

  &-assign {
    display: flex;
    flex-direction: column;
    gap: 1rem;

    &-lead {
      font-size: 0.9rem;
      color: var(--color-muted);
    }

    &-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    &-select {
      width: auto;
      min-width: 240px;
    }

    &-create {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding-top: 1rem;
      border-top: 1px solid var(--color-border);
    }

    &-fields {
      display: grid;
      grid-template-columns: 2fr 1fr 1.5fr;
      gap: 1rem;

      @media (max-width: 720px) {
        grid-template-columns: 1fr;
      }

      label {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--color-muted);
      }
    }
  }
}
</style>
