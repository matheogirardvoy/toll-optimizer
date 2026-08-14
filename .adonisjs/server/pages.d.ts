import '@adonisjs/inertia/types'

import type { VNodeProps, AllowedComponentProps, ComponentInstance } from 'vue'

type ExtractProps<T> = Omit<
  ComponentInstance<T>['$props'],
  keyof VNodeProps | keyof AllowedComponentProps
>

declare module '@adonisjs/inertia/types' {
  export interface InertiaPages {
    'admin/dashboard': ExtractProps<(typeof import('../../inertia/pages/admin/dashboard.vue'))['default']>
    'admin/duplicates': ExtractProps<(typeof import('../../inertia/pages/admin/duplicates.vue'))['default']>
    'admin/prices': ExtractProps<(typeof import('../../inertia/pages/admin/prices.vue'))['default']>
    'admin/stations/index': ExtractProps<(typeof import('../../inertia/pages/admin/stations/index.vue'))['default']>
    'admin/stations/show': ExtractProps<(typeof import('../../inertia/pages/admin/stations/show.vue'))['default']>
    'admin/tolls': ExtractProps<(typeof import('../../inertia/pages/admin/tolls.vue'))['default']>
    'errors/not_found': ExtractProps<(typeof import('../../inertia/pages/errors/not_found.vue'))['default']>
    'errors/server_error': ExtractProps<(typeof import('../../inertia/pages/errors/server_error.vue'))['default']>
    'home_': ExtractProps<(typeof import('../../inertia/pages/home_.vue'))['default']>
    'home': ExtractProps<(typeof import('../../inertia/pages/home.vue'))['default']>
  }
}
