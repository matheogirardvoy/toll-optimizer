/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'home': {
    methods: ["GET","HEAD"]
    pattern: '/'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'api.tolls': {
    methods: ["GET","HEAD"]
    pattern: '/api/tolls.geojson'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/tolls_controller').default['geojson']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/tolls_controller').default['geojson']>>>
    }
  }
  'api.tolls.match': {
    methods: ["POST"]
    pattern: '/api/tolls/match'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/tolls').matchTollsValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/tolls').matchTollsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/tolls_controller').default['match']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/tolls_controller').default['match']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'api.optimize': {
    methods: ["POST"]
    pattern: '/api/optimize'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/optimize').optimizeValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/optimize').optimizeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/optimize_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/optimize_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.login': {
    methods: ["GET","HEAD"]
    pattern: '/admin/login'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
    }
  }
  'admin.login.store': {
    methods: ["POST"]
    pattern: '/admin/login'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>>
    }
  }
  'admin.logout': {
    methods: ["POST"]
    pattern: '/admin/logout'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
    }
  }
  'admin.dashboard': {
    methods: ["GET","HEAD"]
    pattern: '/admin'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/dashboard_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/dashboard_controller').default['index']>>>
    }
  }
  'admin.tolls': {
    methods: ["GET","HEAD"]
    pattern: '/admin/tolls'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/tolls_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/tolls_controller').default['index']>>>
    }
  }
  'admin.tolls.upload': {
    methods: ["POST"]
    pattern: '/admin/tolls/upload'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/tolls_controller').default['upload']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/tolls_controller').default['upload']>>>
    }
  }
  'admin.tolls.import': {
    methods: ["POST"]
    pattern: '/admin/tolls/import'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/tolls_controller').default['importRemote']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/tolls_controller').default['importRemote']>>>
    }
  }
  'admin.prices': {
    methods: ["GET","HEAD"]
    pattern: '/admin/prices'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/prices_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/prices_controller').default['index']>>>
    }
  }
  'admin.prices.import': {
    methods: ["POST"]
    pattern: '/admin/prices/import'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/prices_controller').default['import']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/prices_controller').default['import']>>>
    }
  }
  'admin.stations': {
    methods: ["GET","HEAD"]
    pattern: '/admin/stations'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/stations_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/stations_controller').default['index']>>>
    }
  }
  'admin.stations.show': {
    methods: ["GET","HEAD"]
    pattern: '/admin/stations/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/stations_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/stations_controller').default['show']>>>
    }
  }
}
