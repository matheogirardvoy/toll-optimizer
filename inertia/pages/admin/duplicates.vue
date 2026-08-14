<script setup lang="ts">
import { computed, ref } from 'vue'
import { router } from '@inertiajs/vue3'
import AdminLayout from '~/layouts/admin.vue'

defineOptions({ layout: AdminLayout })

interface DuplicateStation {
  id: number
  name: string
  networkId: number | null
  networkName: string | null
  pointCount: number
  priceCount: number
}

interface BarrierSplit {
  road: string
  milestone: number
  stations: DuplicateStation[]
}

interface StationRef {
  id: number
  name: string
}

interface PhantomStation extends DuplicateStation {
  suggestions: StationRef[]
}

/** Miroir de `MergeReport` (app/services/station_merge_service.ts). */
interface MergeReport {
  fromId: number
  fromName: string
  intoId: number
  intoName: string
  tollsMoved: number
  pricesRepointed: number
  pricesDeleted: number
  aliasAdded: string | null
  renamedTo: string | null
  adoptedNetworkId: number | null
}

const props = defineProps<{
  barrierSplits: BarrierSplit[]
  phantoms: PhantomStation[]
  targets: StationRef[]
}>()

/* ─── Clés et sélections ───────────────────────────────────────────────── */

function groupKey(split: BarrierSplit): string {
  return `${split.road}|${split.milestone}`
}

function pairKey(fromId: number, intoId: number): string {
  return `${fromId}->${intoId}`
}

// Survivante par défaut : la mieux tarifée (le serveur trie déjà ainsi).
const keep = ref<Record<string, number>>(
  Object.fromEntries(
    props.barrierSplits.map((split) => [groupKey(split), split.stations[0]?.id ?? 0])
  )
)
const groupRename = ref<Record<string, string>>({})
const phantomQuery = ref<Record<number, string>>({})
const phantomRename = ref<Record<number, string>>({})

const previews = ref<Record<string, MergeReport>>({})
const errors = ref<Record<string, string>>({})
const busy = ref<Record<string, boolean>>({})

function survivor(split: BarrierSplit): DuplicateStation | undefined {
  const id = keep.value[groupKey(split)]
  return split.stations.find((station) => station.id === id)
}

function victims(split: BarrierSplit): DuplicateStation[] {
  const id = keep.value[groupKey(split)]
  return split.stations.filter((station) => station.id !== id)
}

/* ─── Cible d'un fantôme ───────────────────────────────────────────────── */

/** Le nom seul peut être ambigu : on suffixe l'identifiant. */
function targetLabel(target: StationRef): string {
  return `${target.name} — #${target.id}`
}

function resolveQuery(query: string): number | null {
  const trimmed = query.trim()
  if (trimmed === '') return null
  const tagged = /#(\d+)\s*$/.exec(trimmed)
  if (tagged !== null) return Number(tagged[1])
  return props.targets.find((target) => target.name === trimmed)?.id ?? null
}

/** Mémoïsé : sinon on referait la recherche pour chaque fantôme à chaque rendu. */
const resolvedTargets = computed<Record<number, number | null>>(() =>
  Object.fromEntries(
    props.phantoms.map((phantom) => [
      phantom.id,
      resolveQuery(phantomQuery.value[phantom.id] ?? ''),
    ])
  )
)

function chooseSuggestion(phantomId: number, suggestion: StationRef) {
  phantomQuery.value[phantomId] = targetLabel(suggestion)
}

/* ─── Aperçu (dry-run) puis fusion ─────────────────────────────────────── */

async function preview(fromId: number, intoId: number) {
  const key = pairKey(fromId, intoId)
  busy.value[key] = true
  delete errors.value[key]
  try {
    const response = await fetch(`/admin/duplicates/preview?from=${fromId}&into=${intoId}`, {
      headers: { Accept: 'application/json' },
    })
    const payload = (await response.json()) as { report?: MergeReport; error?: string }
    if (payload.report !== undefined) {
      previews.value[key] = payload.report
    } else {
      errors.value[key] = payload.error ?? 'Aperçu impossible.'
    }
  } catch {
    errors.value[key] = 'Aperçu impossible (erreur réseau).'
  } finally {
    busy.value[key] = false
  }
}

function apply(fromId: number, intoId: number, newName: string | undefined) {
  const key = pairKey(fromId, intoId)
  // L'aperçu est obligatoire : on ne supprime pas une gare sans avoir montré l'impact.
  if (previews.value[key] === undefined || busy.value[key]) return
  busy.value[key] = true

  const data: { fromId: number; intoId: number; newName?: string } = { fromId, intoId }
  const trimmed = newName?.trim()
  if (trimmed !== undefined && trimmed !== '') {
    data.newName = trimmed
  }

  router.post('/admin/duplicates/merge', data, {
    preserveScroll: true,
    onFinish: () => {
      busy.value[key] = false
    },
  })
}

function summary(report: MergeReport): string {
  const parts = [
    `${report.tollsMoved} point(s) déplacé(s)`,
    `${report.pricesRepointed} prix repointés`,
    `${report.pricesDeleted} prix dédoublonnés`,
  ]
  if (report.adoptedNetworkId !== null) parts.push('réseau adopté')
  if (report.aliasAdded !== null) parts.push(`alias « ${report.aliasAdded} »`)
  return parts.join(', ')
}
</script>

<template>
  <div class="dup">
    <h1 class="dup-title">Doublons de gares</h1>
    <p class="dup-subtitle">
      Les gares en double créent des trous de tarification : un sens de barrière resté séparé et non
      tarifé, ou une gare « fantôme » qui porte des prix sans point physique (donc invisible à
      l'appariement carto). Lancez l'aperçu, puis fusionnez.
    </p>

    <p v-if="barrierSplits.length === 0 && phantoms.length === 0" class="dup-none card">
      Aucun doublon détecté. 🎉
    </p>

    <!-- ─── Barrières éclatées ─────────────────────────────────────────── -->
    <section v-if="barrierSplits.length > 0">
      <h2 class="dup-section">
        Barrières éclatées
        <span class="dup-section-count">{{ barrierSplits.length }}</span>
      </h2>
      <p class="dup-hint">
        Plusieurs gares portent des points physiques au même point kilométrique : ce sont
        généralement les deux sens d'une même barrière. Gardez la mieux tarifée et fusionnez l'autre
        dedans. Attention aux faux positifs (deux vraies gares voisines) : vérifiez les noms.
      </p>

      <article v-for="split in barrierSplits" :key="groupKey(split)" class="dup-group card">
        <header class="dup-group-head">
          <code>{{ split.road }}</code>
          <span>PK {{ split.milestone }}</span>
        </header>

        <table class="dup-table">
          <thead>
            <tr>
              <th>Garder</th>
              <th>Gare</th>
              <th>Réseau</th>
              <th class="dup-table-num">Points</th>
              <th class="dup-table-num">Prix</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="station in split.stations" :key="station.id">
              <td>
                <input
                  v-model="keep[groupKey(split)]"
                  type="radio"
                  :name="groupKey(split)"
                  :value="station.id"
                />
              </td>
              <td>{{ station.name }}</td>
              <td>{{ station.networkName ?? '—' }}</td>
              <td class="dup-table-num">{{ station.pointCount }}</td>
              <td class="dup-table-num">
                <span :class="{ 'dup-table-empty': station.priceCount === 0 }">
                  {{ station.priceCount }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-for="victim in victims(split)" :key="victim.id" class="dup-action">
          <p class="dup-action-label">
            Fusionner <strong>{{ victim.name }}</strong> dans
            <strong>{{ survivor(split)?.name ?? '—' }}</strong>
          </p>
          <div class="dup-action-row">
            <input
              v-model="groupRename[groupKey(split)]"
              type="text"
              placeholder="Renommer la survivante (optionnel)"
            />
            <button
              type="button"
              class="dup-btn dup-btn-ghost"
              :disabled="busy[pairKey(victim.id, keep[groupKey(split)])]"
              @click="preview(victim.id, keep[groupKey(split)])"
            >
              Aperçu
            </button>
            <button
              type="button"
              class="dup-btn"
              :disabled="previews[pairKey(victim.id, keep[groupKey(split)])] === undefined"
              @click="apply(victim.id, keep[groupKey(split)], groupRename[groupKey(split)])"
            >
              Fusionner
            </button>
          </div>
          <p v-if="previews[pairKey(victim.id, keep[groupKey(split)])]" class="dup-report">
            Aperçu : {{ summary(previews[pairKey(victim.id, keep[groupKey(split)])]!) }}
          </p>
          <p v-if="errors[pairKey(victim.id, keep[groupKey(split)])]" class="dup-error">
            {{ errors[pairKey(victim.id, keep[groupKey(split)])] }}
          </p>
        </div>
      </article>
    </section>

    <!-- ─── Gares fantômes ─────────────────────────────────────────────── -->
    <section v-if="phantoms.length > 0">
      <h2 class="dup-section">
        Gares fantômes tarifées
        <span class="dup-section-count">{{ phantoms.length }}</span>
      </h2>
      <p class="dup-hint">
        Ces gares portent des prix mais aucun point physique : l'optimiseur ne peut jamais les
        apparier à un franchissement. Si elles doublonnent une gare du référentiel, fusionnez-les
        dedans — leurs prix y seront repointés. Sinon, laissez-les : elles comblent un vrai trou du
        référentiel.
      </p>

      <article v-for="phantom in phantoms" :key="phantom.id" class="dup-phantom card">
        <div class="dup-phantom-head">
          <strong>{{ phantom.name }}</strong>
          <span class="dup-phantom-meta">
            {{ phantom.networkName ?? 'sans réseau' }} · {{ phantom.priceCount }} prix · 0 point
          </span>
        </div>

        <div v-if="phantom.suggestions.length > 0" class="dup-suggest">
          <span class="dup-suggest-label">Cibles probables</span>
          <button
            v-for="suggestion in phantom.suggestions"
            :key="suggestion.id"
            type="button"
            class="dup-chip"
            :class="{ 'dup-chip-on': resolvedTargets[phantom.id] === suggestion.id }"
            @click="chooseSuggestion(phantom.id, suggestion)"
          >
            {{ suggestion.name }}
          </button>
        </div>

        <div class="dup-action-row">
          <input
            v-model="phantomQuery[phantom.id]"
            type="text"
            list="dup-targets"
            placeholder="Gare cible (rechercher…)"
          />
          <input
            v-model="phantomRename[phantom.id]"
            type="text"
            placeholder="Renommer la cible (optionnel)"
          />
          <button
            type="button"
            class="dup-btn dup-btn-ghost"
            :disabled="resolvedTargets[phantom.id] === null"
            @click="preview(phantom.id, resolvedTargets[phantom.id]!)"
          >
            Aperçu
          </button>
          <button
            type="button"
            class="dup-btn"
            :disabled="
              resolvedTargets[phantom.id] === null ||
              previews[pairKey(phantom.id, resolvedTargets[phantom.id]!)] === undefined
            "
            @click="apply(phantom.id, resolvedTargets[phantom.id]!, phantomRename[phantom.id])"
          >
            Fusionner
          </button>
        </div>

        <template v-if="resolvedTargets[phantom.id] !== null">
          <p v-if="previews[pairKey(phantom.id, resolvedTargets[phantom.id]!)]" class="dup-report">
            Aperçu : {{ summary(previews[pairKey(phantom.id, resolvedTargets[phantom.id]!)]!) }}
          </p>
          <p v-if="errors[pairKey(phantom.id, resolvedTargets[phantom.id]!)]" class="dup-error">
            {{ errors[pairKey(phantom.id, resolvedTargets[phantom.id]!)] }}
          </p>
        </template>
      </article>
    </section>

    <!-- Rendue une seule fois et partagée par tous les champs cible. -->
    <datalist id="dup-targets">
      <option v-for="target in targets" :key="target.id" :value="targetLabel(target)" />
    </datalist>
  </div>
</template>

<style scoped lang="less">
.dup {
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

  &-none {
    font-size: 0.9rem;
    color: var(--color-success);
    font-weight: 600;
  }

  &-section {
    font-size: 1.05rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.35rem;

    &-count {
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--color-muted);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 99px;
      padding: 0.1rem 0.5rem;
    }
  }

  &-hint {
    font-size: 0.82rem;
    color: var(--color-muted);
    margin-bottom: 0.75rem;
  }

  &-group,
  &-phantom {
    margin-bottom: 1rem;
  }

  &-group-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-muted);
    margin-bottom: 0.6rem;

    code {
      background: var(--color-bg);
      border-radius: 4px;
      padding: 0.1rem 0.4rem;
    }
  }

  &-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.86rem;

    th {
      text-align: left;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-muted);
      padding: 0.4rem 0.5rem;
      border-bottom: 1px solid var(--color-border);
    }

    td {
      padding: 0.45rem 0.5rem;
      border-bottom: 1px solid var(--color-border);
    }

    tr:last-child td {
      border-bottom: none;
    }

    &-num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    &-empty {
      color: var(--color-warning);
      font-weight: 700;
    }
  }

  &-action {
    margin-top: 0.85rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--color-border);

    &-label {
      font-size: 0.85rem;
      margin-bottom: 0.5rem;
    }

    &-row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;

      input[type='text'] {
        flex: 1;
        min-width: 200px;
      }
    }
  }

  &-phantom {
    &-head {
      display: flex;
      align-items: baseline;
      gap: 0.6rem;
      flex-wrap: wrap;
      margin-bottom: 0.6rem;
    }

    &-meta {
      font-size: 0.78rem;
      color: var(--color-muted);
    }
  }

  &-suggest {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-bottom: 0.7rem;

    &-label {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-muted);
      margin-right: 0.2rem;
    }
  }

  &-chip {
    padding: 0.25rem 0.6rem;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 99px;
    font-family: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--color-text);
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s;

    &:hover {
      border-color: var(--color-primary);
    }

    &-on {
      background: #eff6ff;
      border-color: var(--color-primary);
      color: var(--color-primary-dk);
    }
  }

  &-report {
    margin-top: 0.55rem;
    font-size: 0.82rem;
    color: var(--color-primary-dk);
    font-weight: 600;
  }

  &-error {
    margin-top: 0.55rem;
    font-size: 0.82rem;
    color: var(--color-danger);
  }

  &-btn {
    padding: 0.45rem 0.9rem;
    background: var(--color-primary);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;

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
        opacity: 0.6;
      }
    }
  }
}
</style>
