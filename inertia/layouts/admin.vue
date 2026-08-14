<script setup lang="ts">
import { watch } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { toast, Toaster } from 'vue-sonner'
import type { Data } from '@generated/data'

const page = usePage<Data.SharedProps>()

/**
 * Entrées de navigation de l'administration. Source unique de vérité pour le
 * menu latéral : ajouter une page = ajouter une ligne ici.
 * `exact` réserve la mise en surbrillance au tableau de bord, dont l'URL
 * (`/admin`) est le préfixe de toutes les autres.
 */
const navItems: { href: string; label: string; icon: string; exact?: boolean }[] = [
  { href: '/admin', label: 'Tableau de bord', icon: '📊', exact: true },
  { href: '/admin/tolls', label: 'Référentiel des péages', icon: '🛣️' },
  { href: '/admin/prices', label: 'Grilles tarifaires', icon: '💶' },
  { href: '/admin/stations', label: 'Gares & tarifs', icon: '🚧' },
  { href: '/admin/duplicates', label: 'Doublons de gares', icon: '🧩' },
]

function isActive(item: (typeof navItems)[number]): boolean {
  return item.exact ? page.url === item.href : page.url.startsWith(item.href)
}

watch(
  () => page.url,
  () => toast.dismiss()
)

watch(
  () => page.props.flash,
  (flashMessages) => {
    if (flashMessages.error) {
      toast.error(flashMessages.error)
    }
    if (flashMessages.success) {
      toast.success(flashMessages.success)
    }
  },
  { immediate: true }
)

function logout() {
  router.post('/admin/logout')
}
</script>

<template>
  <header>
    <span class="header-logo">TollOptimizer</span>
    <span class="header-subtitle">Administration</span>
    <a href="/" class="header-back">← Retour au site</a>
  </header>

  <div class="admin-shell">
    <aside class="admin-sidebar">
      <nav class="admin-nav">
        <Link
          v-for="item in navItems"
          :key="item.href"
          :href="item.href"
          class="admin-nav-link"
          :class="{ 'admin-nav-link-active': isActive(item) }"
        >
          <span class="admin-nav-link-icon" aria-hidden="true">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </Link>
      </nav>

      <button type="button" class="admin-nav-logout" @click="logout">Se déconnecter</button>
    </aside>

    <main class="admin-main">
      <slot />
    </main>
  </div>

  <Toaster position="top-center" rich-colors />
</template>

<style scoped lang="less">
.header-back {
  margin-left: auto;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-muted);
  text-decoration: none;

  &:hover {
    color: var(--color-primary-dk);
  }
}

.admin-shell {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.admin-sidebar {
  width: 240px;
  min-width: 240px;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  padding: 1rem 0.75rem;
  gap: 0.5rem;
}

.admin-nav {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;

  &-link {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--color-muted);
    text-decoration: none;
    transition:
      background 0.15s,
      color 0.15s;

    &-icon {
      font-size: 1rem;
      line-height: 1;
    }

    &:hover {
      background: var(--color-bg);
      color: var(--color-text);
    }

    &-active {
      background: #eff6ff;
      color: var(--color-primary-dk);

      &:hover {
        background: #eff6ff;
        color: var(--color-primary-dk);
      }
    }
  }

  &-logout {
    margin-top: auto;
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-muted);
    cursor: pointer;
    transition:
      border-color 0.15s,
      color 0.15s;

    &:hover {
      border-color: var(--color-danger);
      color: var(--color-danger);
    }
  }
}

.admin-main {
  flex: 1;
  overflow-y: auto;
  padding: 2rem 1.5rem;
}

@media (max-width: 768px) {
  .admin-shell {
    flex-direction: column;
    overflow: auto;
  }

  .admin-sidebar {
    width: 100%;
    min-width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }

  .admin-nav {
    flex-direction: row;
    flex-wrap: wrap;
    flex: 1;

    &-logout {
      margin-top: 0;
    }
  }
}
</style>
