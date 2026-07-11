import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'home': { paramsTuple?: []; params?: {} }
    'api.tolls': { paramsTuple?: []; params?: {} }
    'api.optimize': { paramsTuple?: []; params?: {} }
    'admin.login': { paramsTuple?: []; params?: {} }
    'admin.login.store': { paramsTuple?: []; params?: {} }
    'admin.logout': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.tolls': { paramsTuple?: []; params?: {} }
    'admin.tolls.upload': { paramsTuple?: []; params?: {} }
    'admin.tolls.import': { paramsTuple?: []; params?: {} }
    'admin.prices': { paramsTuple?: []; params?: {} }
    'admin.prices.import': { paramsTuple?: []; params?: {} }
    'admin.stations': { paramsTuple?: []; params?: {} }
    'admin.stations.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  GET: {
    'home': { paramsTuple?: []; params?: {} }
    'api.tolls': { paramsTuple?: []; params?: {} }
    'admin.login': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.tolls': { paramsTuple?: []; params?: {} }
    'admin.prices': { paramsTuple?: []; params?: {} }
    'admin.stations': { paramsTuple?: []; params?: {} }
    'admin.stations.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  HEAD: {
    'home': { paramsTuple?: []; params?: {} }
    'api.tolls': { paramsTuple?: []; params?: {} }
    'admin.login': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.tolls': { paramsTuple?: []; params?: {} }
    'admin.prices': { paramsTuple?: []; params?: {} }
    'admin.stations': { paramsTuple?: []; params?: {} }
    'admin.stations.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  POST: {
    'api.optimize': { paramsTuple?: []; params?: {} }
    'admin.login.store': { paramsTuple?: []; params?: {} }
    'admin.logout': { paramsTuple?: []; params?: {} }
    'admin.tolls.upload': { paramsTuple?: []; params?: {} }
    'admin.tolls.import': { paramsTuple?: []; params?: {} }
    'admin.prices.import': { paramsTuple?: []; params?: {} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}