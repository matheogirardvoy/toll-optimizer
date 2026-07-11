import { StationAliasSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TollNetwork from '#models/toll_network'
import TollStation from '#models/toll_station'

/**
 * Alias manuel de rapprochement : libellé normalisé tel que publié dans la
 * grille d'un réseau → gare logique. Complète le matching automatique par
 * nom quand le libellé publié diverge trop du référentiel.
 */
export default class StationAlias extends StationAliasSchema {
  @belongsTo(() => TollNetwork, { foreignKey: 'networkId' })
  declare network: BelongsTo<typeof TollNetwork>

  @belongsTo(() => TollStation, { foreignKey: 'stationId' })
  declare station: BelongsTo<typeof TollStation>
}
