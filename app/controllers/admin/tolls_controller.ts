import { readFile } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import Toll from '#models/toll'
import TollCollectionMatcher from '#services/mapbox/toll_collection_matcher'
import TollImportService from '#services/toll_import_service'
import { matchTollsValidator } from '#validators/tolls'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default class TollsController {
  /**
   * Page d'administration des péages : compteur courant + actions d'import.
   */
  async index({ inertia }: HttpContext) {
    const [{ $extras }, latest] = await Promise.all([
      Toll.query().count('* as total').firstOrFail(),
      Toll.query().whereNotNull('reference_date').orderBy('reference_date', 'desc').first(),
    ])

    return inertia.render('admin/tolls', {
      tollCount: Number($extras.total ?? 0),
      referenceDate: latest?.referenceDate?.toISODate() ?? null,
    })
  }

  /**
   * Import depuis un fichier CSV téléversé manuellement.
   */
  async upload({ request, response, session }: HttpContext) {
    const file = request.file('csv', { extnames: ['csv'], size: '25mb' })

    if (!file) {
      session.flash('error', 'Aucun fichier reçu.')
      return response.redirect().back()
    }

    if (!file.isValid) {
      session.flash('error', file.errors[0]?.message ?? 'Fichier invalide.')
      return response.redirect().back()
    }

    try {
      const content = await readFile(file.tmpPath!, 'utf-8')
      const { imported, skipped } = await new TollImportService().importFromCsv(content)
      session.flash('success', `${imported} péages importés${skipped ? ` (${skipped} ignorés)` : ''}.`)
    } catch (error) {
      session.flash('error', `Import échoué : ${errorMessage(error)}`)
    }

    return response.redirect().back()
  }

  /**
   * Import automatique de la dernière ressource CSV publiée sur data.gouv.fr.
   */
  async importRemote({ response, session }: HttpContext) {
    try {
      const { imported, skipped } = await new TollImportService().importFromDataGouv()
      session.flash('success', `${imported} péages importés depuis data.gouv.fr${skipped ? ` (${skipped} ignorés)` : ''}.`)
    } catch (error) {
      session.flash('error', `Import automatique échoué : ${errorMessage(error)}`)
    }

    return response.redirect().back()
  }

  /**
   * Appariement des points de perception signalés par Mapbox avec le
   * référentiel local : pour chaque point reçu, le péage le plus proche
   * (ou null), dans l'ordre de la requête.
   */
  async match({ request, response }: HttpContext) {
    const { points } = await request.validateUsing(matchTollsValidator)
    const matches = await new TollCollectionMatcher().matchPoints(points)
    return response.json({ matches })
  }

  /**
   * Endpoint GeoJSON consommé par la carte Mapbox.
   */
  async geojson({ response }: HttpContext) {
    const tolls = await Toll.query().select(
      'id',
      'name',
      'road',
      'side',
      'gate_type_label',
      'lane_count',
      'longitude',
      'latitude'
    )

    return response.json({
      type: 'FeatureCollection',
      features: tolls.map((toll) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [toll.longitude, toll.latitude] },
        properties: {
          id: toll.id,
          name: toll.name,
          road: toll.road,
          side: toll.side,
          type: toll.gateTypeLabel,
          laneCount: toll.laneCount,
        },
      })),
    })
  }
}