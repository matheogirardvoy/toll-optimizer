import { TollStationSchema } from '#database/schema'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import TollNetwork from '#models/toll_network'
import Toll from '#models/toll'

/**
 * Gare de péage logique : regroupe les points physiques du référentiel
 * (une ligne par sens dans `tolls`) sous une seule entité, à laquelle
 * les prix sont rattachés.
 */
export default class TollStation extends TollStationSchema {
  @belongsTo(() => TollNetwork, { foreignKey: 'networkId' })
  declare network: BelongsTo<typeof TollNetwork>

  @hasMany(() => Toll, { foreignKey: 'stationId' })
  declare points: HasMany<typeof Toll>
}
