import { TollSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TollStation from '#models/toll_station'

export default class Toll extends TollSchema {
  @belongsTo(() => TollStation, { foreignKey: 'stationId' })
  declare station: BelongsTo<typeof TollStation>
}
