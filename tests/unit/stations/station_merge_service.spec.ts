import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import StationMergeService from '#services/station_merge_service'
import TollStation from '#models/toll_station'
import TollPrice from '#models/toll_price'
import Toll from '#models/toll'
import StationAlias from '#models/station_alias'
import { seedNetwork, seedPrice, seedStation } from '#tests/fixtures/tolls'

test.group('StationMergeService', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('fusionne un sens vide dans sa jumelle : déplace le point, supprime la source', async ({
    assert,
  }) => {
    const network = await seedNetwork('closed')
    const from = await seedStation({
      name: 'Gare vers Bordeaux',
      networkId: null,
      points: [[4.0, 45]],
    })
    const into = await seedStation({
      name: 'Gare vers Espagne',
      networkId: network.id,
      points: [[4.001, 45]],
    })
    const dest = await seedStation({ name: 'Dest', networkId: network.id, points: [[4.2, 45]] })
    await seedPrice(network, into.id, dest.id, 500)

    const report = await new StationMergeService().merge({
      fromId: from.id,
      intoId: into.id,
      newName: 'Gare',
    })

    assert.equal(report.tollsMoved, 1)
    assert.isNull(await TollStation.find(from.id))
    assert.lengthOf(await Toll.query().where('station_id', into.id), 2)
    const survivor = await TollStation.findOrFail(into.id)
    assert.equal(survivor.name, 'Gare')
    assert.lengthOf(await TollPrice.query().where('entry_station_id', into.id), 1)
  })

  test('replie un fantôme : dédoublonne les conflits, repointe le reste', async ({ assert }) => {
    const network = await seedNetwork('closed')
    const into = await seedStation({ name: 'Réel', networkId: network.id, points: [[4.0, 45]] })
    const from = await seedStation({ name: 'Fantôme', networkId: network.id, points: [] })
    const dest = await seedStation({ name: 'Dest', networkId: network.id, points: [[4.2, 45]] })
    const only = await seedStation({ name: 'Only', networkId: network.id, points: [[4.3, 45]] })

    await seedPrice(network, into.id, dest.id, 500) // déjà porté par la cible
    await seedPrice(network, from.id, dest.id, 999) // → conflit, supprimé
    await seedPrice(network, from.id, only.id, 700) // → repointé

    const report = await new StationMergeService().merge({ fromId: from.id, intoId: into.id })

    assert.equal(report.pricesDeleted, 1)
    assert.equal(report.pricesRepointed, 1)
    // La cible conserve son prix d'origine (500, pas 999).
    const intoDest = await TollPrice.query()
      .where('entry_station_id', into.id)
      .where('exit_station_id', dest.id)
      .firstOrFail()
    assert.equal(intoDest.priceCents, 500)
    // Le prix unique du fantôme est bien passé sur la cible.
    assert.isNotNull(
      await TollPrice.query()
        .where('entry_station_id', into.id)
        .where('exit_station_id', only.id)
        .first()
    )
    assert.isNull(await TollStation.find(from.id))
  })

  test('ne crée jamais de prix d’une gare vers elle-même', async ({ assert }) => {
    const network = await seedNetwork('closed')
    const into = await seedStation({ name: 'A', networkId: network.id, points: [[4.0, 45]] })
    const from = await seedStation({ name: 'B', networkId: network.id, points: [[4.1, 45]] })
    await seedPrice(network, from.id, into.id, 300) // B → A

    const report = await new StationMergeService().merge({ fromId: from.id, intoId: into.id })

    assert.equal(report.pricesDeleted, 1)
    assert.lengthOf(await TollPrice.query().where('entry_station_id', into.id), 0)
  })

  test('ajoute le libellé de la source comme alias normalisé vers la cible', async ({ assert }) => {
    const network = await seedNetwork('closed')
    const into = await seedStation({
      name: 'Biriatou vers Espagne',
      networkId: network.id,
      points: [[4.0, 45]],
    })
    const from = await seedStation({ name: 'Péage de Biriatou', networkId: network.id, points: [] })

    const report = await new StationMergeService().merge({ fromId: from.id, intoId: into.id })

    assert.equal(report.aliasAdded, 'PEAGE DE BIRIATOU')
    const alias = await StationAlias.query()
      .where('network_id', network.id)
      .where('station_id', into.id)
      .firstOrFail()
    assert.equal(alias.alias, 'PEAGE DE BIRIATOU')
  })

  test('la cible orpheline adopte le réseau de la source (cas Bénesse)', async ({ assert }) => {
    const network = await seedNetwork('closed')
    // Gare référentiel : a le point physique, mais aucun réseau ni prix.
    const into = await seedStation({ name: 'Benesse', networkId: null, points: [[4.0, 45]] })
    // Fantôme de grille : porte le réseau et les prix, mais aucun point.
    const from = await seedStation({
      name: 'Péage de Benesse-Marenne',
      networkId: network.id,
      points: [],
    })
    const dest = await seedStation({ name: 'Dest', networkId: network.id, points: [[4.2, 45]] })
    await seedPrice(network, from.id, dest.id, 750)

    const report = await new StationMergeService().merge({ fromId: from.id, intoId: into.id })

    assert.equal(report.adoptedNetworkId, network.id)
    assert.equal(report.pricesRepointed, 1)
    const survivor = await TollStation.findOrFail(into.id)
    assert.equal(survivor.networkId, network.id)
  })

  test('dry-run : calcule le rapport sans rien persister', async ({ assert }) => {
    const network = await seedNetwork('closed')
    const into = await seedStation({ name: 'A', networkId: network.id, points: [[4.0, 45]] })
    const from = await seedStation({ name: 'B', networkId: network.id, points: [[4.1, 45]] })

    const report = await new StationMergeService().merge({
      fromId: from.id,
      intoId: into.id,
      dryRun: true,
    })

    assert.equal(report.tollsMoved, 1)
    // Rien n'a été écrit.
    assert.isNotNull(await TollStation.find(from.id))
    assert.lengthOf(await Toll.query().where('station_id', into.id), 1)
  })
})
