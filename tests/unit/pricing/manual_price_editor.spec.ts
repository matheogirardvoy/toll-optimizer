import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import ManualPriceEditor from '#services/pricing/manual_price_editor'
import PriceLookup from '#services/pricing/price_lookup'
import TollPrice from '#models/toll_price'
import { seedNetwork, seedStation } from '#tests/fixtures/tolls'

async function closedPair() {
  const network = await seedNetwork('closed')
  const entry = await seedStation({ name: 'Entrée', networkId: network.id, points: [[4.0, 45]] })
  const exit = await seedStation({ name: 'Sortie', networkId: network.id, points: [[4.2, 45]] })
  return { network, entry, exit }
}

test.group('ManualPriceEditor', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('insère les cinq classes d’un couple fermé', async ({ assert }) => {
    const { network, entry, exit } = await closedPair()

    const { saved, removed } = await new ManualPriceEditor().upsertDestination({
      networkId: network.id,
      entryStationId: entry.id,
      exitStationId: exit.id,
      validFrom: DateTime.fromISO('2025-02-01'),
      pricesCents: [850, 1280, 1920, 2560, 530],
    })

    assert.equal(saved, 5)
    assert.equal(removed, 0)

    const rows = await TollPrice.query()
      .where('entry_station_id', entry.id)
      .where('exit_station_id', exit.id)
    assert.lengthOf(rows, 5)

    const price = await new PriceLookup().forTraversal({
      entryStationId: entry.id,
      exitStationId: exit.id,
      vehicleClass: 1,
      date: DateTime.fromISO('2025-06-01'),
    })
    assert.equal(price?.priceCents, 850)
  })

  test('met à jour une classe existante et supprime une classe vidée', async ({ assert }) => {
    const { network, entry, exit } = await closedPair()
    const editor = new ManualPriceEditor()
    await editor.upsertDestination({
      networkId: network.id,
      entryStationId: entry.id,
      exitStationId: exit.id,
      validFrom: DateTime.fromISO('2025-02-01'),
      pricesCents: [850, 1280, null, null, null],
    })

    const { saved, removed } = await editor.upsertDestination({
      networkId: network.id,
      entryStationId: entry.id,
      exitStationId: exit.id,
      validFrom: DateTime.fromISO('2025-02-01'),
      pricesCents: [900, null, null, null, null],
    })

    assert.equal(saved, 1) // classe 1 mise à jour
    assert.equal(removed, 1) // classe 2 vidée

    const rows = await TollPrice.query()
      .where('entry_station_id', entry.id)
      .where('exit_station_id', exit.id)
      .orderBy('vehicle_class')
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].vehicleClass, 1)
    assert.equal(rows[0].priceCents, 900)
  })

  test('une nouvelle grille clôt la précédente à la veille', async ({ assert }) => {
    const { network, entry, exit } = await closedPair()
    const editor = new ManualPriceEditor()
    await editor.upsertDestination({
      networkId: network.id,
      entryStationId: entry.id,
      exitStationId: exit.id,
      validFrom: DateTime.fromISO('2024-02-01'),
      pricesCents: [800, null, null, null, null],
    })
    await editor.upsertDestination({
      networkId: network.id,
      entryStationId: entry.id,
      exitStationId: exit.id,
      validFrom: DateTime.fromISO('2025-02-01'),
      pricesCents: [850, null, null, null, null],
    })

    const lookup = new PriceLookup()
    const before = await lookup.forTraversal({
      entryStationId: entry.id,
      exitStationId: exit.id,
      vehicleClass: 1,
      date: DateTime.fromISO('2024-06-01'),
    })
    const after = await lookup.forTraversal({
      entryStationId: entry.id,
      exitStationId: exit.id,
      vehicleClass: 1,
      date: DateTime.fromISO('2025-06-01'),
    })
    assert.equal(before?.priceCents, 800)
    assert.equal(after?.priceCents, 850)

    const old = await TollPrice.query()
      .where('entry_station_id', entry.id)
      .where('valid_from', '2024-02-01')
      .firstOrFail()
    assert.equal(old.validTo?.toISODate(), '2025-01-31')
  })

  test('le mode symétrique crée aussi le sens retour', async ({ assert }) => {
    const { network, entry, exit } = await closedPair()

    await new ManualPriceEditor().upsertDestination({
      networkId: network.id,
      entryStationId: entry.id,
      exitStationId: exit.id,
      validFrom: DateTime.fromISO('2025-02-01'),
      pricesCents: [850, null, null, null, null],
      symmetric: true,
    })

    const reverse = await new PriceLookup().forTraversal({
      entryStationId: exit.id,
      exitStationId: entry.id,
      vehicleClass: 1,
      date: DateTime.fromISO('2025-06-01'),
    })
    assert.equal(reverse?.priceCents, 850)
  })

  test('supprimer une grille ré-ouvre la période précédente', async ({ assert }) => {
    const { network, entry, exit } = await closedPair()
    const editor = new ManualPriceEditor()
    await editor.upsertDestination({
      networkId: network.id,
      entryStationId: entry.id,
      exitStationId: exit.id,
      validFrom: DateTime.fromISO('2024-02-01'),
      pricesCents: [800, null, null, null, null],
    })
    await editor.upsertDestination({
      networkId: network.id,
      entryStationId: entry.id,
      exitStationId: exit.id,
      validFrom: DateTime.fromISO('2025-02-01'),
      pricesCents: [850, null, null, null, null],
    })

    const { removed } = await editor.removeDestination({
      networkId: network.id,
      entryStationId: entry.id,
      exitStationId: exit.id,
      validFrom: DateTime.fromISO('2025-02-01'),
    })
    assert.isAbove(removed, 0)

    const old = await TollPrice.query()
      .where('entry_station_id', entry.id)
      .where('valid_from', '2024-02-01')
      .firstOrFail()
    assert.isNull(old.validTo)

    const now = await new PriceLookup().forTraversal({
      entryStationId: entry.id,
      exitStationId: exit.id,
      vehicleClass: 1,
      date: DateTime.fromISO('2025-06-01'),
    })
    assert.equal(now?.priceCents, 800)
  })

  test('ajouter une classe à une grille close hérite de sa fin de période', async ({ assert }) => {
    const { network, entry, exit } = await closedPair()
    const editor = new ManualPriceEditor()
    // Grille 2024 (classe 1) puis grille 2026 (classe 1), qui clôt 2024 au 2026-01-31.
    await editor.upsertDestination({
      networkId: network.id,
      entryStationId: entry.id,
      exitStationId: exit.id,
      validFrom: DateTime.fromISO('2024-02-01'),
      pricesCents: [800, null, null, null, null],
    })
    await editor.upsertDestination({
      networkId: network.id,
      entryStationId: entry.id,
      exitStationId: exit.id,
      validFrom: DateTime.fromISO('2026-02-01'),
      pricesCents: [900, null, null, null, null],
    })

    // Ajout de la classe 2 à la grille 2024 déjà close.
    await editor.upsertDestination({
      networkId: network.id,
      entryStationId: entry.id,
      exitStationId: exit.id,
      validFrom: DateTime.fromISO('2024-02-01'),
      pricesCents: [null, 400, null, null, null],
    })

    const klass2 = await TollPrice.query()
      .where('entry_station_id', entry.id)
      .where('exit_station_id', exit.id)
      .where('valid_from', '2024-02-01')
      .where('vehicle_class', 2)
      .firstOrFail()
    assert.equal(klass2.validTo?.toISODate(), '2026-01-31')

    // La classe 2 ne déborde pas au-delà de la grille 2024.
    const after = await new PriceLookup().forTraversal({
      entryStationId: entry.id,
      exitStationId: exit.id,
      vehicleClass: 2,
      date: DateTime.fromISO('2027-01-01'),
    })
    assert.isNull(after)
  })

  test('un prix fixe en système ouvert se lit sans destination', async ({ assert }) => {
    const network = await seedNetwork('open')
    const barrier = await seedStation({
      name: 'Barrière',
      networkId: network.id,
      points: [[4.1, 45]],
    })

    await new ManualPriceEditor().upsertDestination({
      networkId: network.id,
      entryStationId: barrier.id,
      exitStationId: null,
      validFrom: DateTime.fromISO('2025-02-01'),
      pricesCents: [320, 480, 720, 960, 200],
    })

    const price = await new PriceLookup().forTraversal({
      entryStationId: barrier.id,
      exitStationId: null,
      vehicleClass: 3,
      date: DateTime.fromISO('2025-06-01'),
    })
    assert.equal(price?.priceCents, 720)
  })
})
