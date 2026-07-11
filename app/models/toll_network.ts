import { TollNetworkSchema } from '#database/schema'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import TollStation from '#models/toll_station'

/**
 * Mode de tarification d'un réseau :
 * - `closed` : système fermé, prix par couple gare d'entrée / gare de sortie
 * - `open` : système ouvert, prix fixe au franchissement de chaque barrière
 */
export type PricingMode = 'open' | 'closed'

export default class TollNetwork extends TollNetworkSchema {
  declare pricingMode: PricingMode

  @hasMany(() => TollStation, { foreignKey: 'networkId' })
  declare stations: HasMany<typeof TollStation>
}
