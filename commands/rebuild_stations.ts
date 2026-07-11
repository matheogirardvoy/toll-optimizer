import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Regroupe les points physiques du référentiel (`tolls`) en gares logiques
 * (`toll_stations`), auxquelles les prix sont rattachés.
 *
 *   node ace stations:rebuild
 */
export default class RebuildStations extends BaseCommand {
  static commandName = 'stations:rebuild'
  static description = 'Regrouper les points de péage en gares logiques'

  // L'application doit être démarrée pour accéder à la base de données.
  static options: CommandOptions = { startApp: true }

  async run() {
    const { default: StationBuilderService } = await import('#services/station_builder_service')

    const result = await new StationBuilderService().rebuild()

    this.logger.success(
      `${result.created} gares créées, ${result.updated} mises à jour, ` +
        `${result.deleted} supprimées, ${result.linkedTolls} points rattachés`
    )
  }
}
