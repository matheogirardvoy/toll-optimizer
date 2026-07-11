/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  home: typeof routes['home']
  api: {
    tolls: typeof routes['api.tolls']
    optimize: typeof routes['api.optimize']
  }
  admin: {
    login: typeof routes['admin.login'] & {
      store: typeof routes['admin.login.store']
    }
    logout: typeof routes['admin.logout']
    dashboard: typeof routes['admin.dashboard']
    tolls: typeof routes['admin.tolls'] & {
      upload: typeof routes['admin.tolls.upload']
      import: typeof routes['admin.tolls.import']
    }
    prices: typeof routes['admin.prices'] & {
      import: typeof routes['admin.prices.import']
    }
    stations: typeof routes['admin.stations'] & {
      show: typeof routes['admin.stations.show']
    }
  }
}
