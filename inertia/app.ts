import './css/app.less';
import 'vue-sonner/style.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import { client } from '~/client';
import Layout from '~/layouts/default.vue';
import { createInertiaApp } from '@inertiajs/vue3';
import { TuyauProvider } from '@adonisjs/inertia/vue';
import { createApp, type DefineComponent, h } from 'vue';
import { resolvePageComponent } from '@adonisjs/inertia/helpers';
import {createPinia} from "pinia";

const appName = import.meta.env.VITE_APP_NAME || 'AdonisJS';

createInertiaApp({
  title: (title) => (title ? `${title} - ${appName}` : appName),
  resolve: (name) => {
    return resolvePageComponent(
      `./pages/${name}.vue`,
      import.meta.glob<DefineComponent>('./pages/**/*.vue'),
      Layout
    )
  },
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(TuyauProvider, { client }, { default: () => h(App, props) }) })
      .use(plugin).use(createPinia())
      .mount(el)
  },
  progress: {
    // `--azur` : la barre de navigation Inertia n'est pas du CSS et ne peut
    // pas lire la variable, la valeur est donc reprise en dur.
    color: '#3d8fff',
  },
});
