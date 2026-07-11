import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import RoutePricer from '#services/pricing/route_pricer'
import { MOTORWAY, seedNetwork, seedPrice, seedStation } from '#tests/fixtures/tolls'

test.group('RoutePricer', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('apparie et tarife un couple entrée/sortie en système fermé', async ({ assert }) => {
    const network = await seedNetwork('closed')
    const nord = await seedStation({
      name: 'Gare Nord',
      networkId: network.id,
      points: [[4.05, 45.00005]],
    })
    const sud = await seedStation({
      name: 'Gare Sud',
      networkId: network.id,
      points: [[4.25, 45.00005]],
    })
    await seedPrice(network, nord.id, sud.id, 850)

    const pricing = await new RoutePricer().price({ geometry: MOTORWAY, vehicleClass: 1 })

    assert.isTrue(pricing.complete)
    assert.equal(pricing.totalCents, 850)
    assert.lengthOf(pricing.sections, 1)
    assert.equal(pricing.sections[0].entry.stationId, nord.id)
    assert.equal(pricing.sections[0].exit?.stationId, sud.id)
    assert.equal(pricing.sections[0].pricingMode, 'closed')
    assert.lengthOf(pricing.crossings, 2)
    assert.isBelow(pricing.crossings[0].alongMeters, pricing.crossings[1].alongMeters)
  })

  test('reconstitue deux traversées successives du même réseau fermé', async ({ assert }) => {
    const network = await seedNetwork('closed')
    const stations = await Promise.all(
      ([
        ['Gare A', 4.02],
        ['Gare B', 4.1],
        ['Gare C', 4.18],
        ['Gare D', 4.26],
      ] as const).map(([name, lng]) =>
        seedStation({ name, networkId: network.id, points: [[lng, 45.00005]] })
      )
    )
    await seedPrice(network, stations[0].id, stations[1].id, 500)
    await seedPrice(network, stations[2].id, stations[3].id, 700)

    const pricing = await new RoutePricer().price({ geometry: MOTORWAY, vehicleClass: 1 })

    assert.isTrue(pricing.complete)
    assert.equal(pricing.totalCents, 1200)
    assert.lengthOf(pricing.sections, 2)
    assert.equal(pricing.sections[0].entry.stationId, stations[0].id)
    assert.equal(pricing.sections[0].exit?.stationId, stations[1].id)
    assert.equal(pricing.sections[1].entry.stationId, stations[2].id)
    assert.equal(pricing.sections[1].exit?.stationId, stations[3].id)
  })

  test('signale une entrée en système fermé restée sans sortie', async ({ assert }) => {
    const network = await seedNetwork('closed')
    await seedStation({ name: 'Gare Seule', networkId: network.id, points: [[4.05, 45.00005]] })

    const pricing = await new RoutePricer().price({ geometry: MOTORWAY, vehicleClass: 1 })

    assert.isFalse(pricing.complete)
    assert.equal(pricing.totalCents, 0)
    assert.lengthOf(pricing.sections, 0)
    assert.lengthOf(pricing.issues, 1)
    assert.equal(pricing.issues[0].type, 'unpaired-entry')
  })

  test('tarife chaque franchissement de barrière en système ouvert', async ({ assert }) => {
    const network = await seedNetwork('open')
    // Une BPV a un point physique par sens : les deux doivent fusionner en
    // un seul franchissement, pas produire deux sections.
    const barrier = await seedStation({
      name: 'Barrière Centre',
      networkId: network.id,
      points: [
        [4.15, 45.00005],
        [4.1501, 45.00008],
      ],
    })
    await seedPrice(network, barrier.id, null, 250)

    const pricing = await new RoutePricer().price({ geometry: MOTORWAY, vehicleClass: 1 })

    assert.isTrue(pricing.complete)
    assert.equal(pricing.totalCents, 250)
    assert.lengthOf(pricing.crossings, 1)
    assert.lengthOf(pricing.crossings[0].points, 2)
    assert.lengthOf(pricing.sections, 1)
    assert.isNull(pricing.sections[0].exit)
    assert.equal(pricing.sections[0].pricingMode, 'open')
  })

  test('ignore les gares au-delà du seuil de matching', async ({ assert }) => {
    const network = await seedNetwork('closed')
    // ~1112 m du tracé : hors seuil par défaut.
    await seedStation({ name: 'Gare Lointaine', networkId: network.id, points: [[4.15, 45.01]] })

    const pricing = await new RoutePricer().price({ geometry: MOTORWAY, vehicleClass: 1 })

    assert.isTrue(pricing.complete)
    assert.equal(pricing.totalCents, 0)
    assert.lengthOf(pricing.crossings, 0)
    assert.lengthOf(pricing.sections, 0)
  })

  test('respecte un seuil de matching personnalisé', async ({ assert }) => {
    const network = await seedNetwork('closed')
    // ~22 m du tracé : hors corridor par défaut (10 m), matchée à 50 m.
    await seedStation({ name: 'Gare Adjacente', networkId: network.id, points: [[4.05, 45.0002]] })

    const strict = await new RoutePricer().price({ geometry: MOTORWAY, vehicleClass: 1 })
    assert.lengthOf(strict.crossings, 0)

    const wide = await new RoutePricer().price({
      geometry: MOTORWAY,
      vehicleClass: 1,
      matchThresholdMeters: 50,
    })
    assert.lengthOf(wide.crossings, 1)
  })

  test('remonte une anomalie pour une gare sans réseau', async ({ assert }) => {
    await seedStation({ name: 'Gare Orpheline', networkId: null, points: [[4.15, 45.00005]] })

    const pricing = await new RoutePricer().price({ geometry: MOTORWAY, vehicleClass: 1 })

    assert.isFalse(pricing.complete)
    assert.lengthOf(pricing.sections, 0)
    assert.lengthOf(pricing.issues, 1)
    assert.equal(pricing.issues[0].type, 'station-without-network')
  })

  test('remonte une anomalie quand le prix est absent de la grille', async ({ assert }) => {
    const network = await seedNetwork('closed')
    await seedStation({ name: 'Gare Est', networkId: network.id, points: [[4.05, 45.00005]] })
    await seedStation({ name: 'Gare Ouest', networkId: network.id, points: [[4.25, 45.00005]] })

    const pricing = await new RoutePricer().price({ geometry: MOTORWAY, vehicleClass: 1 })

    assert.isFalse(pricing.complete)
    assert.equal(pricing.totalCents, 0)
    assert.lengthOf(pricing.sections, 1)
    assert.isNull(pricing.sections[0].priceCents)
    assert.lengthOf(pricing.issues, 1)
    assert.equal(pricing.issues[0].type, 'missing-price')
  })

  test('renvoie un résultat vide pour une géométrie dégénérée', async ({ assert }) => {
    const pricing = await new RoutePricer().price({
      geometry: { type: 'LineString', coordinates: [[4.0, 45]] },
      vehicleClass: 1,
    })

    assert.isTrue(pricing.complete)
    assert.equal(pricing.totalCents, 0)
    assert.lengthOf(pricing.crossings, 0)
  })
})
