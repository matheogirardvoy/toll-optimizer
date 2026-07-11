import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import TollNetwork from '#models/toll_network'
import PriceImportPipeline from '#services/import/price_import_pipeline'
import ImportReportStore, { summarizeReport } from '#services/import/import_report_store'
import { createParser, supportedNetworkSlugs } from '#services/import/parsers/registry'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default class PricesController {
  /**
   * Dashboard des grilles tarifaires : état de chaque réseau (grille en
   * vigueur, volume de prix), formulaire d'import PDF et rapport du
   * dernier import.
   */
  async index({ inertia }: HttpContext) {
    const [networks, stationCounts, currentGrids, lastImport] = await Promise.all([
      TollNetwork.query().orderBy('name'),
      db.from('toll_stations').select('network_id').count('* as total').groupBy('network_id'),
      db
        .from('toll_prices')
        .whereNull('valid_to')
        .select('network_id')
        .max('valid_from as valid_from')
        .count('* as total')
        .groupBy('network_id'),
      new ImportReportStore().load(),
    ])

    return inertia.render('admin/prices', {
      networks: networks.map((network) => {
        const stations = stationCounts.find((row) => row.network_id === network.id)
        const grid = currentGrids.find((row) => row.network_id === network.id)

        return {
          id: network.id,
          slug: network.slug,
          name: network.name,
          pricingMode: network.pricingMode,
          stationCount: Number(stations?.total ?? 0),
          hasParser: supportedNetworkSlugs.includes(network.slug),
          currentGrid: grid
            ? { validFrom: String(grid.valid_from), priceCount: Number(grid.total) }
            : null,
        }
      }),
      lastImport,
    })
  }

  /**
   * Import d'une grille tarifaire PDF téléversée : extraction par le parseur
   * du réseau, passage dans le pipeline commun, puis persistance du rapport
   * pour affichage sur le dashboard.
   */
  async import({ request, response, session }: HttpContext) {
    const network = await TollNetwork.findBy('slug', String(request.input('network', '')))
    if (network === null) {
      session.flash('error', 'Réseau inconnu.')
      return response.redirect().back()
    }

    const parser = await createParser(network.slug)
    if (parser === null) {
      session.flash(
        'error',
        `La grille PDF du réseau ${network.name} n'est pas encore prise en charge.`
      )
      return response.redirect().back()
    }

    const validFrom = DateTime.fromISO(String(request.input('validFrom', '')))
    const validFromDate = validFrom.isValid ? validFrom.toISODate() : null
    if (validFromDate === null) {
      session.flash('error', "Date d'entrée en vigueur invalide (format attendu : AAAA-MM-JJ).")
      return response.redirect().back()
    }

    const file = request.file('pdf', { extnames: ['pdf'], size: '20mb' })
    if (!file) {
      session.flash('error', 'Aucun fichier reçu.')
      return response.redirect().back()
    }
    if (!file.isValid) {
      session.flash('error', file.errors[0]?.message ?? 'Fichier invalide.')
      return response.redirect().back()
    }

    try {
      const rows = await parser.parse(file.tmpPath!)
      if (rows.length === 0) {
        session.flash(
          'error',
          `Aucune ligne de prix extraite de « ${file.clientName} » : ` +
            `le PDF ne correspond probablement pas à la grille ${network.name}.`
        )
        return response.redirect().back()
      }

      const report = await new PriceImportPipeline().run({
        networkSlug: network.slug,
        rows,
        validFrom,
        symmetric: parser.symmetric,
      })

      await new ImportReportStore().save(
        summarizeReport({
          networkSlug: network.slug,
          networkName: network.name,
          fileName: file.clientName,
          validFrom: validFromDate,
          extractedRows: rows.length,
          report,
        })
      )

      session.flash(
        'success',
        `${report.inserted} prix importés pour ${network.name} (grille du ${validFromDate})` +
          `${report.skippedRows ? `, ${report.skippedRows} lignes écartées` : ''}.`
      )
    } catch (error) {
      session.flash('error', `Import échoué : ${errorMessage(error)}`)
    }

    return response.redirect().toRoute('admin.prices')
  }
}
