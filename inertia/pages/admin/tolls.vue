<script setup lang="ts">
import { ref } from 'vue'
import { useForm } from '@inertiajs/vue3'
import AdminLayout from '~/layouts/admin.vue'

defineOptions({ layout: AdminLayout })

const props = defineProps<{
  tollCount: number
  referenceDate: string | null
}>()

const numbers = new Intl.NumberFormat('fr-FR')
const dates = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' })

function formatDate(iso: string | null): string {
  return iso === null ? '—' : dates.format(new Date(iso))
}

const stats = [
  { label: 'Péages en base', value: numbers.format(props.tollCount) },
  { label: 'Date du référentiel', value: formatDate(props.referenceDate) },
]

/* ─── Import automatique depuis data.gouv.fr ───────────────────────────── */

const remote = useForm({})

function importRemote() {
  remote.post('/admin/tolls/import', { preserveScroll: true })
}

/* ─── Import depuis un fichier CSV ─────────────────────────────────────── */

const fileInput = ref<HTMLInputElement | null>(null)
const upload = useForm<{ csv: File | null }>({ csv: null })

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  upload.csv = input.files?.[0] ?? null
}

function submitUpload() {
  upload.post('/admin/tolls/upload', {
    preserveScroll: true,
    onSuccess: () => {
      upload.reset('csv')
      if (fileInput.value) {
        fileInput.value.value = ''
      }
    },
  })
}
</script>

<template>
  <div class="tolls">
    <h1 class="tolls-title">Référentiel des péages</h1>
    <p class="tolls-subtitle">
      Importez le référentiel des gares de péage du réseau routier national concédé (source :
      data.gouv.fr).
    </p>

    <!-- ─── Indicateurs ──────────────────────────────────────────────── -->
    <section class="tolls-stats">
      <article v-for="stat in stats" :key="stat.label" class="stat card">
        <span class="stat-value">{{ stat.value }}</span>
        <span class="stat-label">{{ stat.label }}</span>
      </article>
    </section>

    <!-- ─── Actions d'import ─────────────────────────────────────────── -->
    <section class="tolls-actions">
      <section class="card tolls-action">
        <h2 class="card-title">Import automatique</h2>
        <p class="tolls-action-text">
          Télécharge et importe la dernière ressource CSV publiée sur data.gouv.fr.
        </p>
        <button
          type="button"
          class="tolls-action-btn"
          :disabled="remote.processing"
          @click="importRemote"
        >
          {{ remote.processing ? 'Import en cours…' : 'Importer depuis data.gouv.fr' }}
        </button>
      </section>

      <section class="card tolls-action">
        <h2 class="card-title">Import depuis un fichier</h2>
        <p class="tolls-action-text">
          Téléversez un CSV téléchargé manuellement (séparateur «&nbsp;;&nbsp;»).
        </p>
        <form @submit.prevent="submitUpload">
          <input
            ref="fileInput"
            type="file"
            accept=".csv,text/csv"
            required
            class="tolls-action-file"
            @change="onFileChange"
          />
          <button
            type="submit"
            class="tolls-action-btn"
            :disabled="upload.processing || upload.csv === null"
          >
            {{ upload.processing ? 'Import en cours…' : 'Importer le fichier' }}
          </button>
          <span v-if="upload.progress" class="tolls-action-progress">
            {{ upload.progress.percentage }}%
          </span>
        </form>
      </section>
    </section>
  </div>
</template>

<style scoped lang="less">
.tolls {
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

  &-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
  }

  &-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;

    @media (max-width: 640px) {
      grid-template-columns: 1fr;
    }
  }

  &-action {
    &-text {
      font-size: 0.85rem;
      color: var(--color-muted);
      margin-bottom: 1rem;
    }

    &-file {
      display: block;
      width: 100%;
      margin-bottom: 0.85rem;
      font-size: 0.85rem;
    }

    &-btn {
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
  }
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  &-value {
    font-size: 1.5rem;
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
</style>
