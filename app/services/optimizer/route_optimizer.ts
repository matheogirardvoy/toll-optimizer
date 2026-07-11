import type { DateTime } from 'luxon'
import type { VehicleClass } from '#models/toll_price'
import type { LngLat } from '#services/pricing/geometry'
import DirectionsClient, { MAX_EXCLUDE_POINTS } from '#services/mapbox/directions_client'
import type {
  DirectionsGateway,
  DirectionsRoute,
} from '#services/mapbox/directions_client'
import RoutePricer from '#services/pricing/route_pricer'
import type {
  CrossedStation,
  RouteLineString,
  RoutePricing,
  RoutePricingIssue,
  RouteTollSection,
} from '#services/pricing/route_pricer'

/**
 * Chaque itération retire au plus un tronçon de péage ; au-delà de quelques
 * tronçons le trajet n'a plus rien à optimiser, la borne évite surtout de
 * consommer l'API Mapbox sur un cas pathologique.
 */
const MAX_ITERATIONS = 5

/**
 * Seuil du scan de couloir : très au-delà du corridor de matching (10 m)
 * parce qu'il faut bannir toutes les portes d'accès du tronçon, pas
 * seulement celles que le tracé courant traverse. Les gares de bretelle
 * peuvent être à plusieurs centaines de mètres de la voie principale ; les
 * oublier laisse Mapbox contourner chaque barrière par une sortie/rentrée
 * aux échangeurs voisins — trajet absurde et prix sous-estimé (constaté sur
 * l'A6 avec un scan à 100 m).
 */
const CORRIDOR_SCAN_METERS = 600

/** Marge curviligne autour d'un tronçon pour délimiter son couloir. */
const CORRIDOR_MARGIN_METERS = 1000

/**
 * Points exclus par gare du couloir : le plus souvent une gare de bretelle
 * a une plateforme d'entrée et une de sortie — deux points suffisent à la
 * condamner sans épuiser la limite Mapbox sur les longs tronçons.
 */
const MAX_POINTS_PER_STATION = 2

export type OptimizeQuery = {
  /** Ordre GeoJSON : [lng, lat]. */
  start: LngLat
  end: LngLat
  vehicleClass: VehicleClass

  /** Consentement utilisateur : payer au plus `maxPriceCents`… */
  maxPriceCents: number

  /** …pour gagner `minutesSaved` minutes (le ratio s'applique pro rata). */
  minutesSaved: number

  date?: DateTime
}

export type RouteKind = 'fastest' | 'alternative' | 'no-toll' | 'hybrid'

export type EvaluatedRoute = {
  kind: RouteKind
  durationSeconds: number
  distanceMeters: number
  geometry: RouteLineString
  pricing: RoutePricing

  /** Coût généralisé : durée + prix converti en minutes via rho. */
  scoreMinutes: number

  /** Gares dont les portes ont été exclues pour produire cette route. */
  excludedStations: string[]
}

export type EvaluatedRouteSummary = {
  kind: RouteKind
  durationSeconds: number
  distanceMeters: number
  totalCents: number
  pricingComplete: boolean
  issues: RoutePricingIssue[]
  scoreMinutes: number
  excludedStations: string[]
}

export type OptimizeResult = {
  /** Seuil de rentabilité dérivé de la requête, en centimes par minute. */
  rhoCentsPerMinute: number

  /** La route au meilleur coût généralisé — la recommandation. */
  best: EvaluatedRoute

  /** Références pour l'UI : la plus rapide et la sans-péage. */
  fastest: EvaluatedRoute
  noToll: EvaluatedRoute | null

  /** Toutes les routes évaluées, résumées, triées par score croissant. */
  evaluated: EvaluatedRouteSummary[]

  warnings: string[]
}

/** Aucun itinéraire entre le départ et l'arrivée. */
export class NoRouteError extends Error {}

type Exclusions = {
  points: LngLat[]
  stations: string[]
}

/**
 * Optimiseur péages/sans-péages par retraits successifs (greedy).
 *
 * Tout est comparé au coût généralisé `durée + prix/rho` (en minutes), où
 * rho est le consentement à payer de l'utilisateur : retirer un tronçon
 * améliore le score si et seulement si son prix par minute perdue dépasse
 * rho. À chaque itération, on tente de retirer chaque tronçon payant de la
 * route courante en excluant les portes de son couloir via
 * `exclude=point()`, on re-tarife les candidates entières (en système fermé
 * le couple entrée/sortie change), et on adopte la meilleure si elle
 * améliore le score. La réponse finale est la meilleure de toutes les
 * routes évaluées : rapide, alternatives Mapbox, sans péage, hybrides.
 */
export default class RouteOptimizer {
  constructor(
    private directions: DirectionsGateway = new DirectionsClient(),
    private pricer: RoutePricer = new RoutePricer()
  ) {}

  async optimize(query: OptimizeQuery): Promise<OptimizeResult> {
    const rho = query.maxPriceCents / query.minutesSaved
    const warnings: string[] = []

    const [standardRoutes, noTollRoutes] = await Promise.all([
      this.directions.fetchRoutes(query.start, query.end, { alternatives: true }),
      this.directions.fetchRoutes(query.start, query.end, { excludeTolls: true }),
    ])
    if (standardRoutes.length === 0) {
      throw new NoRouteError('Aucun itinéraire trouvé entre le départ et l’arrivée')
    }

    const evaluated: EvaluatedRoute[] = []
    const fastest = await this.evaluate(standardRoutes[0], 'fastest', [], rho, query)
    evaluated.push(fastest)
    for (const route of standardRoutes.slice(1)) {
      evaluated.push(await this.evaluate(route, 'alternative', [], rho, query))
    }
    const noToll =
      noTollRoutes.length > 0
        ? await this.evaluate(noTollRoutes[0], 'no-toll', [], rho, query)
        : null
    if (noToll) evaluated.push(noToll)

    await this.runGreedy(fastest, rho, query, evaluated, warnings)

    // Une tarification incomplète sous-estime le prix : une telle route ne
    // peut pas être recommandée, sauf si aucune candidate n'est fiable.
    const reliable = evaluated.filter((route) => route.pricing.complete)
    const pool = reliable.length > 0 ? reliable : evaluated
    if (reliable.length === 0) {
      warnings.push('Aucune candidate à la tarification complète : recommandation à vérifier')
    }
    const best = pool.reduce((winner, route) =>
      route.scoreMinutes < winner.scoreMinutes ? route : winner
    )

    return {
      rhoCentsPerMinute: rho,
      best,
      fastest,
      noToll,
      evaluated: evaluated
        .map((route) => this.summarize(route))
        .sort((a, b) => a.scoreMinutes - b.scoreMinutes),
      warnings,
    }
  }

  /**
   * Boucle de retraits : part de la route rapide et retire un tronçon par
   * itération tant que le score s'améliore. Les candidates évaluées (même
   * non adoptées) sont ajoutées à `evaluated`.
   */
  private async runGreedy(
    fastest: EvaluatedRoute,
    rho: number,
    query: OptimizeQuery,
    evaluated: EvaluatedRoute[],
    warnings: string[]
  ): Promise<void> {
    let current = fastest
    let exclusions: Exclusions = { points: [], stations: [] }
    const attempted = new Set<string>()

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const removable = current.pricing.sections.filter(
        (section) => section.priceCents !== null
      )
      if (removable.length === 0) break

      const corridor = await this.pricer.scanStations(current.geometry, CORRIDOR_SCAN_METERS)

      const candidates: Array<{ route: EvaluatedRoute; exclusions: Exclusions }> = []
      for (const section of removable) {
        const extended = this.extendExclusions(exclusions, section, corridor, warnings)
        if (!extended) continue

        const key = extended.points
          .map(([lng, lat]) => `${lng},${lat}`)
          .sort()
          .join(';')
        if (attempted.has(key)) continue
        attempted.add(key)

        const routes = await this.directions.fetchRoutes(query.start, query.end, {
          excludePoints: extended.points,
        })
        if (routes.length === 0) continue

        const route = await this.evaluate(routes[0], 'hybrid', extended.stations, rho, query)
        evaluated.push(route)
        // Un score fondé sur un prix incomplet n'est pas comparable : la
        // candidate reste visible dans `evaluated` mais n'est pas adoptée.
        if (route.pricing.complete) {
          candidates.push({ route, exclusions: extended })
        }
      }

      const bestCandidate = candidates.reduce<(typeof candidates)[number] | null>(
        (winner, candidate) =>
          winner === null || candidate.route.scoreMinutes < winner.route.scoreMinutes
            ? candidate
            : winner,
        null
      )
      if (!bestCandidate || bestCandidate.route.scoreMinutes >= current.scoreMinutes) break

      current = bestCandidate.route
      exclusions = bestCandidate.exclusions
    }
  }

  /**
   * Étend le jeu d'exclusions avec les portes du couloir du tronçon : gares
   * du même réseau (ou sans réseau connu) dont l'abscisse curviligne tombe
   * entre l'entrée et la sortie, marge comprise. Renvoie null si rien de
   * nouveau ne peut être exclu.
   */
  private extendExclusions(
    base: Exclusions,
    section: RouteTollSection,
    corridor: CrossedStation[],
    warnings: string[]
  ): Exclusions | null {
    const from = section.entry.alongMeters - CORRIDOR_MARGIN_METERS
    const to = (section.exit?.alongMeters ?? section.entry.alongMeters) + CORRIDOR_MARGIN_METERS
    const stationsInCorridor = corridor.filter(
      (station) =>
        station.alongMeters >= from &&
        station.alongMeters <= to &&
        (station.networkId === section.networkId || station.networkId === null)
    )

    // En cas de dépassement de la limite Mapbox, on garde les portes les
    // plus proches du tracé : ce sont les plus atteignables, donc celles
    // qu'il est le plus important d'interdire.
    const newPoints = stationsInCorridor
      .flatMap((station) =>
        [...station.points]
          .sort((a, b) => a.distanceMeters - b.distanceMeters)
          .slice(0, MAX_POINTS_PER_STATION)
      )
      .sort((a, b) => a.distanceMeters - b.distanceMeters)

    const points = [...base.points]
    const seen = new Set(points.map(([lng, lat]) => `${lng},${lat}`))
    for (const point of newPoints) {
      if (points.length >= MAX_EXCLUDE_POINTS) {
        warnings.push(
          `Limite de ${MAX_EXCLUDE_POINTS} points d'exclusion atteinte : le couloir ` +
            `de « ${section.entry.stationName} » n'est que partiellement interdit`
        )
        break
      }
      const key = `${point.longitude},${point.latitude}`
      if (seen.has(key)) continue
      seen.add(key)
      points.push([point.longitude, point.latitude])
    }

    if (points.length === base.points.length) return null

    const stations = [
      ...new Set([...base.stations, ...stationsInCorridor.map((station) => station.stationName)]),
    ]
    return { points, stations }
  }

  private async evaluate(
    route: DirectionsRoute,
    kind: RouteKind,
    excludedStations: string[],
    rho: number,
    query: OptimizeQuery
  ): Promise<EvaluatedRoute> {
    const pricing = await this.pricer.price({
      geometry: route.geometry,
      vehicleClass: query.vehicleClass,
      date: query.date,
    })

    return {
      kind,
      durationSeconds: route.duration,
      distanceMeters: route.distance,
      geometry: route.geometry,
      pricing,
      scoreMinutes: route.duration / 60 + pricing.totalCents / rho,
      excludedStations,
    }
  }

  private summarize(route: EvaluatedRoute): EvaluatedRouteSummary {
    return {
      kind: route.kind,
      durationSeconds: route.durationSeconds,
      distanceMeters: route.distanceMeters,
      totalCents: route.pricing.totalCents,
      pricingComplete: route.pricing.complete,
      issues: route.pricing.issues,
      scoreMinutes: route.scoreMinutes,
      excludedStations: route.excludedStations,
    }
  }
}
