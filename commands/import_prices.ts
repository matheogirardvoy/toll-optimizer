import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { DateTime } from 'luxon'

/**
 * Importe une grille tarifaire publiée par un concessionnaire.
 *
 *   node ace prices:import area tmp/TARIFS_AREA.pdf --valid-from=2026-02-01
 */
export default class ImportPrices extends BaseCommand {
  static commandName = 'prices:import'
  static description = 'Importer une grille tarifaire de concessionnaire'

  // L'application doit être démarrée pour accéder à la base de données.
  static options: CommandOptions = { startApp: true }

  @args.string({ description: 'Réseau (area, aprr, sanef…)' })
  declare network: string

  @args.string({ description: 'Chemin du PDF de la grille' })
  declare file: string

  @flags.string({ flagName: 'valid-from', description: "Date d'entrée en vigueur (AAAA-MM-JJ)" })
  declare validFrom?: string

  async run() {
    const { createParser } = await import('#services/import/parsers/registry')
    const { default: PriceImportPipeline } = await import('#services/import/price_import_pipeline')

    const parser = await createParser(this.network)
    if (parser === null) {
      this.logger.error(`Aucun parseur disponible pour le réseau « ${this.network} »`)
      this.exitCode = 1
      return
    }

    const validFrom = DateTime.fromISO(this.validFrom ?? '')
    if (!validFrom.isValid) {
      this.logger.error('Date --valid-from invalide ou absente (format attendu : AAAA-MM-JJ)')
      this.exitCode = 1
      return
    }

    const rows = await parser.parse(this.file)
    this.logger.info(`${rows.length} lignes de prix extraites de ${this.file}`)

    const report = await new PriceImportPipeline().run({
      networkSlug: parser.networkSlug,
      rows,
      validFrom,
      symmetric: parser.symmetric,
    })

    this.logger.success(
      `${report.inserted} prix insérés (grille du ${validFrom.toISODate()}), ` +
        `${report.skippedRows} lignes écartées`
    )

    for (const station of report.unmatched) {
      const code = station.code === null ? '' : ` [${station.code}]`
      this.logger.warning(`gare non résolue (${station.reason}) : ${station.name}${code}`)
    }
    for (const pair of report.selfPairs) {
      this.logger.warning(`même gare des deux côtés : ${pair.entry} → ${pair.exit}`)
    }

    this.printAnomalies('conflits de prix', report.conflicts)
    this.printAnomalies('asymétries A→B / B→A', report.asymmetries)

    if (report.invalidPrices.length > 0) {
      this.logger.warning(`${report.invalidPrices.length} prix invalides rejetés, par exemple :`)
      for (const invalid of report.invalidPrices.slice(0, 5)) {
        this.logger.warning(
          `  ${invalid.entry} → ${invalid.exit ?? '(fixe)'} ` +
            `classe ${invalid.vehicleClass} : ${invalid.priceCents} centimes`
        )
      }
    }
    if (report.incompletePairs.length > 0) {
      this.logger.warning(`${report.incompletePairs.length} couples sans les cinq classes`)
    }
  }

  private printAnomalies(
    label: string,
    anomalies: {
      entry: string
      exit: string | null
      priceCents: number
      conflictingPriceCents: number
    }[]
  ) {
    if (anomalies.length === 0) return
    this.logger.warning(`${anomalies.length} ${label}, par exemple :`)
    for (const anomaly of anomalies.slice(0, 5)) {
      this.logger.warning(
        `  ${anomaly.entry} → ${anomaly.exit ?? '(fixe)'} : ` +
          `${anomaly.priceCents} vs ${anomaly.conflictingPriceCents} centimes`
      )
    }
  }
}
