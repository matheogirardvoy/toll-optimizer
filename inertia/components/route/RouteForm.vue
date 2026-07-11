<script setup lang="ts">
/** RouteForm — the "Itinéraire" card: two LocationInput fields + vehicle class. */
import LocationInput from '~/components/route/LocationInput.vue';
import {Feature} from "~/composables/map/useMapbox";

defineProps<{
  vehicleClass: string
}>();

const emit = defineEmits<{
  (e: 'select-start', location: Feature): void,
  (e: 'select-end', location: Feature): void,
  (e: 'update:vehicleClass', value: string|null): void,
  (e: 'submit'): void,
}>();
</script>

<template>
  <div class="card">
    <p class="card-title">🗺️ Itinéraire</p>
    <form @submit.prevent="$emit('submit')" novalidate>
      <LocationInput
          label="Départ"
          input="input-start"
          placeholder="Ex : Paris, Gare de Lyon"
          @select="emit('select-start', $event)"
      />
      <LocationInput
          label="Arrivée"
          input="input-end"
          placeholder="Ex : Lyon, Confluence"
          @select="emit('select-end', $event)"
      />
      <div class="form-group">
        <label for="vehicle-class">Type de véhicule</label>
        <select
            id="vehicle-class"
            :value="vehicleClass"
            @change="emit('update:vehicleClass', ($event.target as HTMLSelectElement).value)"
            aria-label="Classe de véhicule"
        >
          <option value="cl1">🚗 Voiture (≤ 2m)</option>
          <option value="cl2">🚗🚌 Voiture + caravane</option>
          <option value="cl3">🚐 Camionnette 3 essieux</option>
          <option value="cl4">🚛 PL 4 essieux</option>
          <option value="cl5">🏍️ Moto</option>
        </select>
      </div>
    </form>
  </div>
</template>

<style scoped lang="less">

</style>
