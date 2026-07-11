import { TollPriceSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TollNetwork from '#models/toll_network'
import TollStation from '#models/toll_station'

/** Classes tarifaires françaises (1 = véhicule léger … 5 = moto). */
export type VehicleClass = 1 | 2 | 3 | 4 | 5

export const VEHICLE_CLASSES: readonly VehicleClass[] = [1, 2, 3, 4, 5]

/**
 * Prix d'une traversée : couple gare d'entrée / gare de sortie en système
 * fermé, ou franchissement seul (`exitStationId` null) en système ouvert.
 */
export default class TollPrice extends TollPriceSchema {
  declare vehicleClass: VehicleClass

  @belongsTo(() => TollNetwork, { foreignKey: 'networkId' })
  declare network: BelongsTo<typeof TollNetwork>

  @belongsTo(() => TollStation, { foreignKey: 'entryStationId' })
  declare entryStation: BelongsTo<typeof TollStation>

  @belongsTo(() => TollStation, { foreignKey: 'exitStationId' })
  declare exitStation: BelongsTo<typeof TollStation>
}
