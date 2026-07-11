import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import Toll from '#models/toll'
import TollNetwork from '#models/toll_network'
import TollStation from '#models/toll_station'
import ImportReportStore from '#services/import/import_report_store'

export default class DashboardController {
  /**
   * Tableau de bord d'accueil de l'administration : quelques compteurs
   * transverses sur le référentiel et les tarifs, plus le rappel du dernier
   * import de grille.
   */
  async index({ inertia }: HttpContext) {
    const [tollAgg, latestToll, networkCount, stationCount, priceAgg, lastImport] =
      await Promise.all([
        Toll.query().count('* as total').firstOrFail(),
        Toll.query().whereNotNull('reference_date').orderBy('reference_date', 'desc').first(),
        TollNetwork.query().count('* as total').firstOrFail(),
        TollStation.query().count('* as total').firstOrFail(),
        db.from('toll_prices').whereNull('valid_to').count('* as total').first(),
        new ImportReportStore().load(),
      ])

    return inertia.render('admin/dashboard', {
      stats: {
        tollCount: Number(tollAgg.$extras.total ?? 0),
        referenceDate: latestToll?.referenceDate?.toISODate() ?? null,
        networkCount: Number(networkCount.$extras.total ?? 0),
        stationCount: Number(stationCount.$extras.total ?? 0),
        priceCount: Number(priceAgg?.total ?? 0),
      },
      lastImport,
    })
  }
}
