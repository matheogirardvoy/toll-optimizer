import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'home': { paramsTuple?: []; params?: {} }
    'api.tolls': { paramsTuple?: []; params?: {} }
    'api.tolls.match': { paramsTuple?: []; params?: {} }
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
    'admin.stations.network': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.stations.prices.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.stations.prices.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.duplicates': { paramsTuple?: []; params?: {} }
    'admin.duplicates.preview': { paramsTuple?: []; params?: {} }
    'admin.duplicates.merge': { paramsTuple?: []; params?: {} }
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
    'admin.duplicates': { paramsTuple?: []; params?: {} }
    'admin.duplicates.preview': { paramsTuple?: []; params?: {} }
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
    'admin.duplicates': { paramsTuple?: []; params?: {} }
    'admin.duplicates.preview': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'api.tolls.match': { paramsTuple?: []; params?: {} }
    'api.optimize': { paramsTuple?: []; params?: {} }
    'admin.login.store': { paramsTuple?: []; params?: {} }
    'admin.logout': { paramsTuple?: []; params?: {} }
    'admin.tolls.upload': { paramsTuple?: []; params?: {} }
    'admin.tolls.import': { paramsTuple?: []; params?: {} }
    'admin.prices.import': { paramsTuple?: []; params?: {} }
    'admin.stations.prices.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.duplicates.merge': { paramsTuple?: []; params?: {} }
  }
  PUT: {
    'admin.stations.network': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  DELETE: {
    'admin.stations.prices.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}