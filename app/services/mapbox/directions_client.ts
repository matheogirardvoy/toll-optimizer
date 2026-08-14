import env from '#start/env'
import type { LngLat } from '#services/pricing/geometry'
import type { RouteLineString } from '#services/pricing/route_pricer'

const DIRECTIONS_BASE = 'https://api.mapbox.com/directions/v5/mapbox/driving'

/** Nombre maximal de points exclus acceptés par l'API Directions. */
export const MAX_EXCLUDE_POINTS = 50

/** Point de perception annoté par Mapbox le long d'un itinéraire. */
export type TollCollectionPoint = {
  location: LngLat

  /** `toll_booth` (gare/barrière) ou `toll_gantry` (portique flux libre). */
  kind: string | null

  /** Nom envoyé par Mapbox — souvent absent. */
  name: string | null
}

export type DirectionsRoute = {
  /** Durée en secondes. */
  duration: number

  /** Distance en mètres. */
  distance: number

  geometry: RouteLineString

  /** Points de perception rencontrés, dans l'ordre du tracé. */
  tollCollections?: TollCollectionPoint[]
}

/**
 * Fragments de la réponse Directions utiles à l'extraction des péages :
 * chaque intersection d'une étape peut porter une annotation
 * `toll_collection` (nécessite `steps=true`).
 */
type RawIntersection = {
  location: LngLat
  toll_collection?: { type?: string; name?: string }
}

type RawRoute = DirectionsRoute & {
  legs?: { steps?: { intersections?: RawIntersection[] }[] }[]
}

export type DirectionsQuery = {
  alternatives?: boolean
  excludeTolls?: boolean

  /** Points à éviter (`exclude=point(lon lat)`), 50 au plus. */
  excludePoints?: LngLat[]
}

/**
 * Surface minimale du client Directions — permet d'injecter un faux client
 * dans les tests de l'optimiseur.
 */
export interface DirectionsGateway {
  fetchRoutes(start: LngLat, end: LngLat, query?: DirectionsQuery): Promise<DirectionsRoute[]>
}

/** Échec de l'API Mapbox (réseau, quota, token) — à distinguer d'un simple « pas de route ». */
export class DirectionsError extends Error {}

/**
 * Client Directions côté serveur. Un itinéraire infaisable (code `NoRoute`…)
 * renvoie un tableau vide ; seule une erreur HTTP lève `DirectionsError`.
 */
export default class DirectionsClient implements DirectionsGateway {
  constructor(private token: string = env.get('VITE_MAPBOX_TOKEN').release()) {}

  async fetchRoutes(
    start: LngLat,
    end: LngLat,
    query: DirectionsQuery = {}
  ): Promise<DirectionsRoute[]> {
    const params = new URLSearchParams({
      access_token: this.token,
      geometries: 'geojson',
      overview: 'full',
      // Les annotations toll_collection ne sont livrées qu'avec le détail des étapes.
      steps: 'true',
    })
    if (query.alternatives) {
      params.set('alternatives', 'true')
    }

    const exclusions: string[] = []
    if (query.excludeTolls) {
      exclusions.push('toll')
    }
    for (const [lng, lat] of query.excludePoints ?? []) {
      exclusions.push(`point(${lng} ${lat})`)
    }
    if (exclusions.length > MAX_EXCLUDE_POINTS + 1) {
      throw new DirectionsError(`Trop de points exclus : ${exclusions.length}`)
    }
    if (exclusions.length > 0) {
      params.set('exclude', exclusions.join(','))
    }

    const coordinates = `${start.join(',')};${end.join(',')}`
    const response = await fetch(`${DIRECTIONS_BASE}/${coordinates}?${params}`)
    if (!response.ok) {
      throw new DirectionsError(`Directions API : HTTP ${response.status}`)
    }

    const payload = (await response.json()) as {
      code: string
      routes?: RawRoute[]
    }

    if (payload.code !== 'Ok' || !payload.routes) {
      return []
    }
    return payload.routes.map((route) => ({
      duration: route.duration,
      distance: route.distance,
      geometry: route.geometry,
      tollCollections: this.extractTollCollections(route),
    }))
  }

  /**
   * Collecte les annotations `toll_collection` des intersections. La
   * dernière intersection d'une étape est aussi la première de la suivante :
   * on déduplique par coordonnées.
   */
  private extractTollCollections(route: RawRoute): TollCollectionPoint[] {
    const seen = new Set<string>()
    const collections: TollCollectionPoint[] = []

    for (const leg of route.legs ?? []) {
      for (const step of leg.steps ?? []) {
        for (const intersection of step.intersections ?? []) {
          if (!intersection.toll_collection) continue
          const key = intersection.location.join(',')
          if (seen.has(key)) continue
          seen.add(key)
          collections.push({
            location: intersection.location,
            kind: intersection.toll_collection.type ?? null,
            name: intersection.toll_collection.name ?? null,
          })
        }
      }
    }

    return collections
  }
}
