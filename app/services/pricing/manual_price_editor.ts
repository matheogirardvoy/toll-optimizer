import { type DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import TollPrice, { VEHICLE_CLASSES } from '#models/toll_price'

export type UpsertDestinationInput = {
  networkId: number
  entryStationId: number
  /** null = prix fixe au franchissement (système ouvert). */
  exitStationId: number | null
  validFrom: DateTime
  /** Index 0..4 = classes 1..5, en centimes ; null = classe non tarifée. */
  pricesCents: (number | null)[]
  /** Mètres ; null / undefined = ne pas modifier la distance existante. */
  distanceMeters?: number | null
  /** Insère aussi le sens retour (couple fermé uniquement). */
  symmetric?: boolean
}

export type RemoveDestinationInput = {
  networkId: number
  entryStationId: number
  exitStationId: number | null
  validFrom: DateTime
}

type Pair = { entry: number; exit: number | null }

/**
 * Édition manuelle des prix d'une gare depuis l'admin : upsert d'un couple et
 * de ses cinq classes à une date de validité, avec la même couture de périodes
 * que l'import (clôture de la grille précédente à la veille) mais **bornée au
 * couple** concerné. Le pricer résolvant les prix couple par couple
 * (`price_lookup.ts`), une grille versionnée par gare est cohérente.
 */
export default class ManualPriceEditor {
  async upsertDestination(
    input: UpsertDestinationInput
  ): Promise<{ saved: number; removed: number }> {
    const validFrom = input.validFrom.startOf('day')
    const validFromDate = validFrom.toISODate()
    if (validFromDate === null) {
      throw new Error("Date d'entrée en vigueur invalide")
    }
    const previousPeriodEnd = validFrom.minus({ days: 1 }).toISODate()

    const pairs: Pair[] = [{ entry: input.entryStationId, exit: input.exitStationId }]
    if (input.symmetric === true && input.exitStationId !== null) {
      pairs.push({ entry: input.exitStationId, exit: input.entryStationId })
    }

    let saved = 0
    let removed = 0

    await db.transaction(async (trx) => {
      for (const pair of pairs) {
        // Clôture de la période ouverte antérieure de ce couple (bornée au couple).
        const closing = trx
          .from('toll_prices')
          .where('network_id', input.networkId)
          .where('entry_station_id', pair.entry)
          .where('valid_from', '<', validFromDate)
          .where((period) => {
            period.whereNull('valid_to').orWhere('valid_to', '>=', validFromDate)
          })
        if (pair.exit === null) closing.whereNull('exit_station_id')
        else closing.where('exit_station_id', pair.exit)
        await closing.update({ valid_to: previousPeriodEnd })

        // Fin de période de la grille D pour ce couple : une classe ajoutée à une
        // grille déjà close doit hériter de son `valid_to` (sinon elle resterait
        // ouverte et débordait sur les grilles postérieures). null = grille neuve.
        const anchor = TollPrice.query({ client: trx })
          .where('network_id', input.networkId)
          .where('entry_station_id', pair.entry)
          .where('valid_from', validFromDate)
        if (pair.exit === null) anchor.whereNull('exit_station_id')
        else anchor.where('exit_station_id', pair.exit)
        const anchorRow = await anchor.first()
        const periodEnd = anchorRow?.validTo ?? null

        for (const klass of VEHICLE_CLASSES) {
          const cents = input.pricesCents[klass - 1] ?? null

          const lookup = TollPrice.query({ client: trx })
            .where('network_id', input.networkId)
            .where('entry_station_id', pair.entry)
            .where('vehicle_class', klass)
            .where('valid_from', validFromDate)
          if (pair.exit === null) lookup.whereNull('exit_station_id')
          else lookup.where('exit_station_id', pair.exit)
          const existing = await lookup.first()

          if (cents === null) {
            if (existing !== null) {
              existing.useTransaction(trx)
              await existing.delete()
              removed++
            }
            continue
          }

          if (existing !== null) {
            existing.useTransaction(trx)
            existing.priceCents = cents
            if (input.distanceMeters !== null && input.distanceMeters !== undefined) {
              existing.distanceMeters = input.distanceMeters
            }
            await existing.save()
          } else {
            await TollPrice.create(
              {
                networkId: input.networkId,
                entryStationId: pair.entry,
                exitStationId: pair.exit,
                vehicleClass: klass,
                priceCents: cents,
                distanceMeters: input.distanceMeters ?? null,
                validFrom,
                validTo: periodEnd,
              },
              { client: trx }
            )
          }
          saved++
        }
      }
    })

    return { saved, removed }
  }

  async removeDestination(input: RemoveDestinationInput): Promise<{ removed: number }> {
    const validFrom = input.validFrom.startOf('day')
    const validFromDate = validFrom.toISODate()
    if (validFromDate === null) {
      throw new Error('Grille invalide')
    }
    const previousPeriodEnd = validFrom.minus({ days: 1 }).toISODate()

    let removed = 0

    await db.transaction(async (trx) => {
      const targets = TollPrice.query({ client: trx })
        .where('network_id', input.networkId)
        .where('entry_station_id', input.entryStationId)
        .where('valid_from', validFromDate)
      if (input.exitStationId === null) targets.whereNull('exit_station_id')
      else targets.where('exit_station_id', input.exitStationId)

      const rows = await targets
      for (const row of rows) {
        row.useTransaction(trx)
        await row.delete()
      }
      removed = rows.length

      // Ré-ouverture de la période précédente, close la veille de cette grille,
      // pour préserver la continuité de lecture après suppression.
      if (removed > 0 && previousPeriodEnd !== null) {
        const reopen = trx
          .from('toll_prices')
          .where('network_id', input.networkId)
          .where('entry_station_id', input.entryStationId)
          .where('valid_to', previousPeriodEnd)
        if (input.exitStationId === null) reopen.whereNull('exit_station_id')
        else reopen.where('exit_station_id', input.exitStationId)
        await reopen.update({ valid_to: null })
      }
    })

    return { removed }
  }
}
