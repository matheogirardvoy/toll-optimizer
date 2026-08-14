<script setup lang="ts">
/** RouteForm — le bloc « Trajet » : départ, arrivée, classe de véhicule. */
import {computed} from "vue";
import LocationInput from '~/components/route/LocationInput.vue';
import {Feature} from "~/composables/map/useMapbox";

/**
 * Les cinq classes du portique de péage. La valeur (`cl1`…`cl5`) est celle
 * attendue par le pricer ; le chiffre est celui affiché sur les panneaux.
 */
const VEHICLE_CLASSES: { value: string; digit: string; label: string }[] = [
  { value: 'cl1', digit: '1', label: 'Voiture, jusqu’à 2 m de hauteur' },
  { value: 'cl2', digit: '2', label: 'Voiture avec caravane' },
  { value: 'cl3', digit: '3', label: 'Camionnette 3 essieux' },
  { value: 'cl4', digit: '4', label: 'Poids lourd 4 essieux' },
  { value: 'cl5', digit: '5', label: 'Moto' },
];

const props = defineProps<{
  vehicleClass: string
}>();

const emit = defineEmits<{
  (e: 'select-start', location: Feature): void,
  (e: 'select-end', location: Feature): void,
  (e: 'update:vehicleClass', value: string|null): void,
  (e: 'submit'): void,
}>();

const selectedLabel = computed<string>(() =>
    VEHICLE_CLASSES.find((option) => option.value === props.vehicleClass)?.label ?? '');
</script>

<template>
  <div class="card">
    <p class="card-title">Trajet</p>
    <form @submit.prevent="emit('submit')" novalidate>
      <LocationInput
          label="Départ"
          marker="start"
          input="input-start"
          placeholder="Ex : Paris, Gare de Lyon"
          @select="emit('select-start', $event)"
      />
      <LocationInput
          label="Arrivée"
          marker="end"
          input="input-end"
          placeholder="Ex : Lyon, Confluence"
          @select="emit('select-end', $event)"
      />
      <div class="form-group">
        <span id="vehicle-class-label" class="field-label">Classe de véhicule</span>
        <div class="class-picker" role="radiogroup" aria-labelledby="vehicle-class-label">
          <button
              v-for="option in VEHICLE_CLASSES"
              :key="option.value"
              type="button"
              role="radio"
              class="class-picker-option"
              :class="{ 'is-selected': option.value === vehicleClass }"
              :aria-checked="option.value === vehicleClass"
              :aria-label="`Classe ${option.digit} : ${option.label}`"
              @click="emit('update:vehicleClass', option.value)"
          >{{ option.digit }}</button>
        </div>
        <p class="class-caption">{{ selectedLabel }}</p>
      </div>
    </form>
  </div>
</template>
