<script setup lang="ts">
import {nextTick, ref} from "vue";
import useMapbox, {Feature} from "~/composables/map/useMapbox";

const props = defineProps<{
  label: string,
  placeholder: string,
  input: string
}>();

const emit = defineEmits<{
  (e: 'select', location: Feature): void,
}>();

const HISTORY_MAX = 5;

const inputText = ref<string>('');
const suggestions = ref<Feature[]>([]);
const isHistory = ref<boolean>(false);
const highlighted = ref<number>(-1);
const list = ref<HTMLUListElement>();

let debounce: NodeJS.Timeout|number|undefined = undefined;

const historyKey = (): string => `location-history:${props.input}`;

function loadHistory(): Feature[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(historyKey()) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Feature[]) : [];
  } catch {
    return [];
  }
}

function saveToHistory(f: Feature) {
  const entries = [f, ...loadHistory().filter((h) => h.place_name !== f.place_name)]
    .slice(0, HISTORY_MAX);
  localStorage.setItem(historyKey(), JSON.stringify(entries));
}

function showHistory() {
  suggestions.value = loadHistory();
  isHistory.value = true;
  highlighted.value = -1;
}

function onFocus() {
  // Tant qu'aucune recherche n'est en cours, proposer les recherches précédentes
  if (inputText.value.trim().length < 2) showHistory();
}

function onInput() {
  clearTimeout(debounce);
  const q = inputText.value.trim();
  if (q.length < 2) {showHistory(); return;}
  debounce = setTimeout(async() => {
    suggestions.value = await useMapbox.geocodeSuggestions(q);
    isHistory.value = false;
    highlighted.value = -1;
  })
}

function onBlur() {
  // Delay so a suggestion's mousedown fires before the list is hidden.
  setTimeout(() => { suggestions.value = []; highlighted.value = -1; }, 200);
}

function onKeydown(e: KeyboardEvent) {
  if (!suggestions.value.length) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      moveHighlight(1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      moveHighlight(-1);
      break;
    case 'Enter':
      // Empêche la soumission du formulaire tant que la liste est ouverte ;
      // sans surlignage, la première suggestion est retenue
      e.preventDefault();
      select(suggestions.value[highlighted.value] ?? suggestions.value[0]);
      break;
    case 'Escape':
      suggestions.value = [];
      highlighted.value = -1;
      break;
  }
}

function moveHighlight(step: 1 | -1) {
  const count = suggestions.value.length;
  highlighted.value = highlighted.value === -1
    ? (step === 1 ? 0 : count - 1)
    : (highlighted.value + step + count) % count;
  // La liste est scrollable (max-height) : garder l'élément surligné visible.
  // Cibler .suggestion pour ne pas compter l'entête de l'historique
  nextTick(() => {
    list.value?.querySelectorAll<HTMLLIElement>('.suggestion')[highlighted.value]
      ?.scrollIntoView({block: 'nearest'});
  });
}

function select(f: Feature) {
  inputText.value = f.place_name;
  suggestions.value = [];
  highlighted.value = -1;
  saveToHistory(f);
  emit('select', f);
}
</script>

<template>
  <div class="form-group">
    <label :for="input">{{ label }}</label>
    <input
        :id="input"
        v-model="inputText"
        type="text"
        :placeholder="placeholder"
        autocomplete="off"
        @input="onInput"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKeydown"
        required
    />
    <ul class="suggestions" v-if="suggestions.length" ref="list">
      <li v-if="isHistory" class="suggestions-title">Recherches récentes</li>
      <li
          v-for="(f, i) in suggestions"
          :key="i"
          class="suggestion"
          :class="{highlighted: i === highlighted}"
          @mouseenter="highlighted = i"
          @mousedown.prevent="select(f)"
      ><span v-if="isHistory" class="suggestion-icon">🕘</span>{{ f.place_name }}</li>
    </ul>
  </div>
</template>

<style scoped lang="less">
.suggestions {
  li.highlighted {
    background: #f0f9ff;
    color: var(--color-primary);
  }

  .suggestions-title {
    font-size: .7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: var(--color-muted);
    background: var(--color-bg);
    cursor: default;

    &:hover {
      background: var(--color-bg);
      color: var(--color-muted);
    }
  }

  .suggestion-icon {
    margin-right: .4rem;
    opacity: .6;
  }
}
</style>
