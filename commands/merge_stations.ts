import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Fusionne une gare logique dans une autre (points physiques, prix, alias),
 * pour réconcilier les doublons du référentiel : deux sens d'une même barrière
 * restés séparés, ou une gare « fantôme » de grille doublonnant une gare réelle.
 *
 *   node ace stations:merge --from=73 --into=78 --name="Biriatou" --dry-run
 */
export default class MergeStations extends BaseCommand {
  static commandName = 'stations:merge'
  static description = 'Fusionner une gare de péage dans une autre'

  // L'application doit être démarrée pour accéder à la base de données.
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: 'Id de la gare source (sera supprimée)' })
  declare from?: number

  @flags.number({ description: 'Id de la gare cible (conservée)' })
  declare into?: number

  @flags.string({ description: 'Renommer la gare cible après fusion' })
  declare name?: string

  @flags.boolean({ flagName: 'dry-run', description: 'Simulation sans écriture' })
  declare dryRun?: boolean

  async run() {
    if (this.from === undefined || this.into === undefined) {
      this.logger.error('--from et --into sont requis.')
      this.exitCode = 1
      return
    }

    const { default: StationMergeService } = await import('#services/station_merge_service')

    try {
      const report = await new StationMergeService().merge({
        fromId: this.from,
        intoId: this.into,
        newName: this.name,
        dryRun: this.dryRun,
      })

      const details =
        `${report.tollsMoved} point(s) déplacé(s), ` +
        `${report.pricesRepointed} prix repointés, ${report.pricesDeleted} prix dédoublonnés` +
        (report.aliasAdded !== null ? `, alias « ${report.aliasAdded} »` : '') +
        (report.renamedTo !== null ? `, renommée « ${report.renamedTo} »` : '')

      const headline = `${report.fromName} (#${report.fromId}) → ${report.intoName} (#${report.intoId})`
      if (this.dryRun === true) {
        this.logger.info(`[DRY-RUN] ${headline} : ${details}`)
      } else {
        this.logger.success(`${headline} : ${details}`)
      }
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error))
      this.exitCode = 1
    }
  }
}
