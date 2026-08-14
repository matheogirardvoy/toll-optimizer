<script setup lang="ts">
import { watch } from 'vue';
import { usePage } from '@inertiajs/vue3';
import { toast, Toaster } from 'vue-sonner';
import type { Data } from '@generated/data';

const page = usePage<Data.SharedProps>();

watch(
  () => page.url,
  () => toast.dismiss()
);

watch(
  () => page.props.flash,
  (flashMessages) => {
    if (flashMessages.error) {
      toast.error(flashMessages.error);
    }
    if (flashMessages.success) {
      toast.success(flashMessages.success);
    }
  },
  { immediate: true }
);

const showMapboxTokenWarning = import.meta.env.VITE_MAPBOX_TOKEN.length === 0;
</script>

<template>
  <header>
    <span class="header-logo">TollOptimizer</span>
    <span class="header-subtitle">
      Quels péages valent leur prix, sur votre trajet.
    </span>
  </header>

  <div id="token-warning" v-if="showMapboxTokenWarning">
    Clé Mapbox non configurée : copiez <code>config.example.js</code> vers
    <code>config.js</code> et renseignez votre token depuis
    <a href="https://account.mapbox.com/" target="_blank" rel="noopener">account.mapbox.com</a>.
  </div>

  <div class="layout">
    <slot />
  </div>

  <Toaster position="top-center" rich-colors />
</template>
