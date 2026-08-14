import type { HttpContext } from '@adonisjs/core/http'
import StationDuplicateService from '#services/station_duplicate_service'
import StationMergeService from '#services/station_merge_service'
import { mergeStationsValidator } from '#validators/duplicates'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default class DuplicatesController {
  /**
   * Audit des doublons de gares : barrières éclatées (deux sens restés séparés)
   * et gares fantômes (tarifées mais sans point physique, donc invisibles à
   * l'appariement carto). Chaque cas est fusionnable depuis la page.
   */
  async index({ inertia }: HttpContext) {
    const service = new StationDuplicateService()
    const [barrierSplits, phantoms, targets] = await Promise.all([
      service.barrierSplits(),
      service.phantoms(),
      service.realStations(),
    ])

    return inertia.render('admin/duplicates', { barrierSplits, phantoms, targets })
  }

  /**
   * Aperçu d'une fusion : simulation intégrale annulée en fin de transaction.
   * En GET (lecture seule côté effets), donc consommable en `fetch` sans CSRF.
   */
  async preview({ request, response }: HttpContext) {
    const fromId = Number(request.input('from'))
    const intoId = Number(request.input('into'))
    if (!Number.isInteger(fromId) || !Number.isInteger(intoId)) {
      return response.badRequest({ error: 'Paramètres invalides.' })
    }

    try {
      const report = await new StationMergeService().merge({ fromId, intoId, dryRun: true })
      return response.json({ report })
    } catch (error) {
      return response.badRequest({ error: errorMessage(error) })
    }
  }

  /** Applique la fusion. */
  async merge({ request, response, session }: HttpContext) {
    const payload = await request.validateUsing(mergeStationsValidator)

    if (payload.fromId === payload.intoId) {
      session.flash('error', 'La gare source et la gare cible doivent être différentes.')
      return response.redirect().toRoute('admin.duplicates')
    }

    try {
      const report = await new StationMergeService().merge({
        fromId: payload.fromId,
        intoId: payload.intoId,
        newName: payload.newName,
      })

      const parts = [`${report.tollsMoved} point(s) déplacé(s)`]
      if (report.pricesRepointed > 0) parts.push(`${report.pricesRepointed} prix repointés`)
      if (report.pricesDeleted > 0) parts.push(`${report.pricesDeleted} prix dédoublonnés`)
      if (report.adoptedNetworkId !== null) parts.push('réseau adopté')

      session.flash(
        'success',
        `« ${report.fromName} » fusionnée dans « ${report.renamedTo ?? report.intoName} » : ` +
          `${parts.join(', ')}.`
      )
    } catch (error) {
      session.flash('error', `Fusion échouée : ${errorMessage(error)}`)
    }

    return response.redirect().toRoute('admin.duplicates')
  }
}
