import { DateTime } from 'luxon'
import TollPrice from '#models/toll_price'
import type { VehicleClass } from '#models/toll_price'

export type TraversalQuery = {
  entryStationId: number

  /** null : franchissement d'une barrière en système ouvert (prix fixe). */
  exitStationId: number | null

  vehicleClass: VehicleClass

  /** Date du trajet — la grille en vigueur ce jour-là s'applique (défaut : aujourd'hui). */
  date?: DateTime
}

/**
 * Lecture des prix : une seule requête quel que soit le mode de tarification
 * du réseau. L'optimiseur ne branche sur `pricing_mode` que pour décider
 * quels lookups faire le long d'un itinéraire, jamais sur comment les faire.
 */
export default class PriceLookup {
  async forTraversal(query: TraversalQuery): Promise<TollPrice | null> {
    const date = (query.date ?? DateTime.now()).toISODate()
    if (!date) {
      throw new Error('Date de trajet invalide')
    }

    const builder = TollPrice.query()
      .where('entry_station_id', query.entryStationId)
      .where('vehicle_class', query.vehicleClass)
      .where('valid_from', '<=', date)
      .where((period) => {
        period.whereNull('valid_to').orWhere('valid_to', '>=', date)
      })
      .orderBy('valid_from', 'desc')

    if (query.exitStationId === null) {
      builder.whereNull('exit_station_id')
    } else {
      builder.where('exit_station_id', query.exitStationId)
    }

    return builder.first()
  }
}
