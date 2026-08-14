/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'home': {
    methods: ["GET","HEAD"],
    pattern: '/',
    tokens: [{"old":"/","type":0,"val":"/","end":""}],
    types: placeholder as Registry['home']['types'],
  },
  'api.tolls': {
    methods: ["GET","HEAD"],
    pattern: '/api/tolls.geojson',
    tokens: [{"old":"/api/tolls.geojson","type":0,"val":"api","end":""},{"old":"/api/tolls.geojson","type":0,"val":"tolls.geojson","end":""}],
    types: placeholder as Registry['api.tolls']['types'],
  },
  'api.tolls.match': {
    methods: ["POST"],
    pattern: '/api/tolls/match',
    tokens: [{"old":"/api/tolls/match","type":0,"val":"api","end":""},{"old":"/api/tolls/match","type":0,"val":"tolls","end":""},{"old":"/api/tolls/match","type":0,"val":"match","end":""}],
    types: placeholder as Registry['api.tolls.match']['types'],
  },
  'api.optimize': {
    methods: ["POST"],
    pattern: '/api/optimize',
    tokens: [{"old":"/api/optimize","type":0,"val":"api","end":""},{"old":"/api/optimize","type":0,"val":"optimize","end":""}],
    types: placeholder as Registry['api.optimize']['types'],
  },
  'admin.login': {
    methods: ["GET","HEAD"],
    pattern: '/admin/login',
    tokens: [{"old":"/admin/login","type":0,"val":"admin","end":""},{"old":"/admin/login","type":0,"val":"login","end":""}],
    types: placeholder as Registry['admin.login']['types'],
  },
  'admin.login.store': {
    methods: ["POST"],
    pattern: '/admin/login',
    tokens: [{"old":"/admin/login","type":0,"val":"admin","end":""},{"old":"/admin/login","type":0,"val":"login","end":""}],
    types: placeholder as Registry['admin.login.store']['types'],
  },
  'admin.logout': {
    methods: ["POST"],
    pattern: '/admin/logout',
    tokens: [{"old":"/admin/logout","type":0,"val":"admin","end":""},{"old":"/admin/logout","type":0,"val":"logout","end":""}],
    types: placeholder as Registry['admin.logout']['types'],
  },
  'admin.dashboard': {
    methods: ["GET","HEAD"],
    pattern: '/admin',
    tokens: [{"old":"/admin","type":0,"val":"admin","end":""}],
    types: placeholder as Registry['admin.dashboard']['types'],
  },
  'admin.tolls': {
    methods: ["GET","HEAD"],
    pattern: '/admin/tolls',
    tokens: [{"old":"/admin/tolls","type":0,"val":"admin","end":""},{"old":"/admin/tolls","type":0,"val":"tolls","end":""}],
    types: placeholder as Registry['admin.tolls']['types'],
  },
  'admin.tolls.upload': {
    methods: ["POST"],
    pattern: '/admin/tolls/upload',
    tokens: [{"old":"/admin/tolls/upload","type":0,"val":"admin","end":""},{"old":"/admin/tolls/upload","type":0,"val":"tolls","end":""},{"old":"/admin/tolls/upload","type":0,"val":"upload","end":""}],
    types: placeholder as Registry['admin.tolls.upload']['types'],
  },
  'admin.tolls.import': {
    methods: ["POST"],
    pattern: '/admin/tolls/import',
    tokens: [{"old":"/admin/tolls/import","type":0,"val":"admin","end":""},{"old":"/admin/tolls/import","type":0,"val":"tolls","end":""},{"old":"/admin/tolls/import","type":0,"val":"import","end":""}],
    types: placeholder as Registry['admin.tolls.import']['types'],
  },
  'admin.prices': {
    methods: ["GET","HEAD"],
    pattern: '/admin/prices',
    tokens: [{"old":"/admin/prices","type":0,"val":"admin","end":""},{"old":"/admin/prices","type":0,"val":"prices","end":""}],
    types: placeholder as Registry['admin.prices']['types'],
  },
  'admin.prices.import': {
    methods: ["POST"],
    pattern: '/admin/prices/import',
    tokens: [{"old":"/admin/prices/import","type":0,"val":"admin","end":""},{"old":"/admin/prices/import","type":0,"val":"prices","end":""},{"old":"/admin/prices/import","type":0,"val":"import","end":""}],
    types: placeholder as Registry['admin.prices.import']['types'],
  },
  'admin.stations': {
    methods: ["GET","HEAD"],
    pattern: '/admin/stations',
    tokens: [{"old":"/admin/stations","type":0,"val":"admin","end":""},{"old":"/admin/stations","type":0,"val":"stations","end":""}],
    types: placeholder as Registry['admin.stations']['types'],
  },
  'admin.stations.show': {
    methods: ["GET","HEAD"],
    pattern: '/admin/stations/:id',
    tokens: [{"old":"/admin/stations/:id","type":0,"val":"admin","end":""},{"old":"/admin/stations/:id","type":0,"val":"stations","end":""},{"old":"/admin/stations/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['admin.stations.show']['types'],
  },
  'admin.stations.network': {
    methods: ["PUT"],
    pattern: '/admin/stations/:id/network',
    tokens: [{"old":"/admin/stations/:id/network","type":0,"val":"admin","end":""},{"old":"/admin/stations/:id/network","type":0,"val":"stations","end":""},{"old":"/admin/stations/:id/network","type":1,"val":"id","end":""},{"old":"/admin/stations/:id/network","type":0,"val":"network","end":""}],
    types: placeholder as Registry['admin.stations.network']['types'],
  },
  'admin.stations.prices.store': {
    methods: ["POST"],
    pattern: '/admin/stations/:id/prices',
    tokens: [{"old":"/admin/stations/:id/prices","type":0,"val":"admin","end":""},{"old":"/admin/stations/:id/prices","type":0,"val":"stations","end":""},{"old":"/admin/stations/:id/prices","type":1,"val":"id","end":""},{"old":"/admin/stations/:id/prices","type":0,"val":"prices","end":""}],
    types: placeholder as Registry['admin.stations.prices.store']['types'],
  },
  'admin.stations.prices.destroy': {
    methods: ["DELETE"],
    pattern: '/admin/stations/:id/prices',
    tokens: [{"old":"/admin/stations/:id/prices","type":0,"val":"admin","end":""},{"old":"/admin/stations/:id/prices","type":0,"val":"stations","end":""},{"old":"/admin/stations/:id/prices","type":1,"val":"id","end":""},{"old":"/admin/stations/:id/prices","type":0,"val":"prices","end":""}],
    types: placeholder as Registry['admin.stations.prices.destroy']['types'],
  },
  'admin.duplicates': {
    methods: ["GET","HEAD"],
    pattern: '/admin/duplicates',
    tokens: [{"old":"/admin/duplicates","type":0,"val":"admin","end":""},{"old":"/admin/duplicates","type":0,"val":"duplicates","end":""}],
    types: placeholder as Registry['admin.duplicates']['types'],
  },
  'admin.duplicates.preview': {
    methods: ["GET","HEAD"],
    pattern: '/admin/duplicates/preview',
    tokens: [{"old":"/admin/duplicates/preview","type":0,"val":"admin","end":""},{"old":"/admin/duplicates/preview","type":0,"val":"duplicates","end":""},{"old":"/admin/duplicates/preview","type":0,"val":"preview","end":""}],
    types: placeholder as Registry['admin.duplicates.preview']['types'],
  },
  'admin.duplicates.merge': {
    methods: ["POST"],
    pattern: '/admin/duplicates/merge',
    tokens: [{"old":"/admin/duplicates/merge","type":0,"val":"admin","end":""},{"old":"/admin/duplicates/merge","type":0,"val":"duplicates","end":""},{"old":"/admin/duplicates/merge","type":0,"val":"merge","end":""}],
    types: placeholder as Registry['admin.duplicates.merge']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
