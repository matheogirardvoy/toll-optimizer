import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import type TollNetwork from '#models/toll_network'
import type {
  DirectionsGateway,
  DirectionsQuery,
  DirectionsRoute,
} from '#services/mapbox/directions_client'
import RouteOptimizer, { NoRouteError } from '#services/optimizer/route_optimizer'
import RoutePricer from '#services/pricing/route_pricer'
import type { LngLat } from '#services/pricing/geometry'
import type { RouteLineString } from '#services/pricing/route_pricer'
import { MOTORWAY, seedNetwork, seedPrice, seedStation } from '#tests/fixtures/tolls'

/** Nationale parallèle, au sud de l'autoroute factice, sans aucun péage. */
const FREE_ROAD: RouteLineString = {
  type: 'LineString',
  coordinates: [
    [4.0, 45],
    [4.0, 44.98],
    [4.3, 44.98],
    [4.3, 45],
  ],
}

/** Autoroute : 20 min. Nationale : 40 min. */
const MOTORWAY_ROUTE: DirectionsRoute = { duration: 1200, distance: 25000, geometry: MOTORWAY }
const FREE_ROUTE: DirectionsRoute = { duration: 2400, distance: 32000, geometry: FREE_ROAD }

/**
 * Faux client Directions : la route standard passe par l'autoroute ; toute
 * exclusion (péages ou points) bascule sur la nationale.
 */
class FakeDirections implements DirectionsGateway {
  queries: DirectionsQuery[] = []

  constructor(private freeRoute: DirectionsRoute = FREE_ROUTE) {}

  async fetchRoutes(
    _start: LngLat,
    _end: LngLat,
    query: DirectionsQuery = {}
  ): Promise<DirectionsRoute[]> {
    this.queries.push(query)
    if (query.excludeTolls || (query.excludePoints?.length ?? 0) > 0) {
      return [this.freeRoute]
    }
    return [MOTORWAY_ROUTE]
  }
}

class NoRouteDirections implements DirectionsGateway {
  async fetchRoutes(): Promise<DirectionsRoute[]> {
    return []
  }
}

/** Gare d'entrée + gare de sortie sur l'autoroute, tronçon à 8,50 €. */
async function seedTolledMotorway(): Promise<TollNetwork> {
  const network = await seedNetwork('closed')
  const entry = await seedStation({
    name: 'Gare Nord',
    networkId: network.id,
    points: [[4.05, 45.00005]],
  })
  const exit = await seedStation({
    name: 'Gare Sud',
    networkId: network.id,
    points: [[4.25, 45.00005]],
  })
  await seedPrice(network, entry.id, exit.id, 850)
  return network
}

function makeQuery(maxPriceCents: number, minutesSaved: number) {
  return {
    start: [4.0, 45] as LngLat,
    end: [4.3, 45] as LngLat,
    vehicleClass: 1 as const,
    maxPriceCents,
    minutesSaved,
  }
}

test.group('RouteOptimizer', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('garde un péage rentable au regard du consentement à payer', async ({ assert }) => {
    await seedTolledMotorway()
    const directions = new FakeDirections()
    const optimizer = new RouteOptimizer(directions, new RoutePricer())

    // 30 € pour 60 min → rho 50 c/min ; le tronçon coûte 850/20 = 42,5 c/min : rentable.
    const result = await optimizer.optimize(makeQuery(3000, 60))

    assert.equal(result.best.kind, 'fastest')
    assert.equal(result.best.pricing.totalCents, 850)
    assert.equal(result.best.durationSeconds, 1200)
    // Le retrait a bien été tenté puis rejeté.
    assert.isTrue(result.evaluated.some((route) => route.kind === 'hybrid'))

    // L'analyse chiffre le tronçon : l'éviter coûte 20 min pour 8,50 €
    // d'économie, soit 25,50 € par heure gagnée en le gardant.
    assert.lengthOf(result.decisions, 1)
    const decision = result.decisions[0]
    assert.isTrue(decision.keptInBest)
    assert.isTrue(decision.reliable)
    assert.equal(decision.priceCents, 850)
    assert.equal(decision.extraDurationSeconds, 1200)
    assert.equal(decision.savedCents, 850)
    assert.equal(decision.ratioCentsPerHour, 2550)
    assert.equal(decision.entryStationName, 'Gare Nord')
    assert.equal(decision.exitStationName, 'Gare Sud')
  })

  test('retire un péage non rentable', async ({ assert }) => {
    await seedTolledMotorway()
    const directions = new FakeDirections()
    const optimizer = new RouteOptimizer(directions, new RoutePricer())

    // 20 € pour 60 min → rho ~33,3 c/min : le tronçon à 42,5 c/min ne vaut pas son prix.
    const result = await optimizer.optimize(makeQuery(2000, 60))

    assert.approximately(result.rhoCentsPerMinute, 33.33, 0.01)
    assert.equal(result.best.pricing.totalCents, 0)
    assert.equal(result.best.durationSeconds, 2400)
    // La rapide reste disponible comme référence.
    assert.equal(result.fastest.pricing.totalCents, 850)
    // Le tronçon écarté est marqué comme tel dans l'analyse.
    assert.lengthOf(result.decisions, 1)
    assert.isFalse(result.decisions[0].keptInBest)
  })

  test('exclut les portes des deux gares du couloir du tronçon', async ({ assert }) => {
    await seedTolledMotorway()
    const directions = new FakeDirections()
    await new RouteOptimizer(directions, new RoutePricer()).optimize(makeQuery(2000, 60))

    const exclusionQuery = directions.queries.find(
      (query) => (query.excludePoints?.length ?? 0) > 0
    )
    assert.exists(exclusionQuery)
    assert.lengthOf(exclusionQuery!.excludePoints!, 2)

    const hybrid = directions.queries.filter((query) => query.excludePoints)
    assert.lengthOf(hybrid, 1)
  })

  test('sans péage sur le trajet, renvoie la rapide sans appels superflus', async ({ assert }) => {
    const directions = new FakeDirections()
    const result = await new RouteOptimizer(directions, new RoutePricer()).optimize(
      makeQuery(2000, 60)
    )

    assert.equal(result.best.kind, 'fastest')
    assert.equal(result.best.pricing.totalCents, 0)
    assert.lengthOf(result.decisions, 0)
    // Une requête standard + une sans-péage, aucune tentative de retrait.
    assert.lengthOf(directions.queries, 2)
  })

  test('recommande une route incomplète quand son avance couvre la pénalité pessimiste', async ({ assert }) => {
    // Tronçon franchi mais sans prix en grille → tarification incomplète.
    const network = await seedNetwork('closed')
    await seedStation({ name: 'Gare Est', networkId: network.id, points: [[4.05, 45.00005]] })
    await seedStation({ name: 'Gare Ouest', networkId: network.id, points: [[4.25, 45.00005]] })

    // Alternative sans péage démesurément lente (200 min vs 20 min) : même
    // en prêtant 20 € à l'inconnue, la rapide reste largement devant.
    const slowFree: DirectionsRoute = { duration: 12000, distance: 60000, geometry: FREE_ROAD }
    const optimizer = new RouteOptimizer(new FakeDirections(slowFree), new RoutePricer())

    const result = await optimizer.optimize(makeQuery(2000, 60))

    assert.equal(result.best.kind, 'fastest')
    assert.isFalse(result.best.pricing.complete)
    assert.isTrue(result.warnings.some((warning) => warning.includes('sous-estimé')))
  })

  test('écarte une route incomplète quand son avance ne couvre pas la pénalité', async ({ assert }) => {
    const network = await seedNetwork('closed')
    await seedStation({ name: 'Gare Est', networkId: network.id, points: [[4.05, 45.00005]] })
    await seedStation({ name: 'Gare Ouest', networkId: network.id, points: [[4.25, 45.00005]] })

    // Nationale à 40 min : la rapide incomplète (20 min + 60 min de
    // pénalité au taux de 33 c/min) perd la comparaison.
    const result = await new RouteOptimizer(new FakeDirections(), new RoutePricer()).optimize(
      makeQuery(2000, 60)
    )

    assert.equal(result.best.kind, 'no-toll')
    assert.isTrue(result.best.pricing.complete)
  })

  test('échoue explicitement quand aucun itinéraire n’existe', async ({ assert }) => {
    const optimizer = new RouteOptimizer(new NoRouteDirections(), new RoutePricer())

    const error = await optimizer.optimize(makeQuery(2000, 60)).then(
      () => null,
      (caught: unknown) => caught
    )
    assert.instanceOf(error, NoRouteError)
  })
})
