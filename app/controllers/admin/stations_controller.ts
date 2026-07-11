import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import TollNetwork from '#models/toll_network'
import TollPrice, { VEHICLE_CLASSES } from '#models/toll_price'
import TollStation from '#models/toll_station'

export default class StationsController {
  /**
   * Annuaire des gares de péage : la recherche et le filtre par réseau se
   * font côté client, le référentiel tient en quelques centaines de lignes.
   */
  async index({ inertia }: HttpContext) {
    const [stations, networks, priceCounts] = await Promise.all([
      TollStation.query().preload('network').orderBy('name'),
      TollNetwork.query().orderBy('name'),
      db
        .from('toll_prices')
        .whereNull('valid_to')
        .select('entry_station_id')
        .count('* as total')
        .groupBy('entry_station_id'),
    ])

    return inertia.render('admin/stations/index', {
      stations: stations.map((station) => {
        const prices = priceCounts.find((row) => row.entry_station_id === station.id)

        return {
          id: station.id,
          name: station.name,
          operatorCode: station.operatorCode,
          networkSlug: station.network?.slug ?? null,
          networkName: station.network?.name ?? null,
          priceCount: Number(prices?.total ?? 0),
        }
      }),
      networks: networks.map((network) => ({ slug: network.slug, name: network.name })),
    })
  }

  /**
   * Fiche d'une gare : ses prix au départ, une ligne par destination avec
   * les cinq classes en colonnes, pour la grille choisie (`?grid=` = date
   * d'entrée en vigueur, la plus récente par défaut).
   */
  async show({ params, request, response, session, inertia }: HttpContext) {
    const station = await TollStation.query()
      .where('id', Number(params.id))
      .preload('network')
      .first()

    if (station === null) {
      session.flash('error', 'Gare inconnue.')
      return response.redirect().toRoute('admin.stations')
    }

    const periods = await db
      .from('toll_prices')
      .where('entry_station_id', station.id)
      .select('valid_from', 'valid_to')
      .groupBy('valid_from', 'valid_to')
      .orderBy('valid_from', 'desc')

    const requestedGrid = String(request.input('grid', ''))
    const selectedPeriod =
      periods.find((period) => String(period.valid_from) === requestedGrid) ?? periods[0] ?? null

    let rows: {
      exitStationId: number | null
      exitName: string | null
      distanceMeters: number | null
      priceCents: (number | null)[]
    }[] = []

    if (selectedPeriod !== null) {
      const prices = await TollPrice.query()
        .where('entry_station_id', station.id)
        .where('valid_from', String(selectedPeriod.valid_from))
        .preload('exitStation')

      const byExit = new Map<number | null, (typeof rows)[number]>()
      for (const price of prices) {
        let row = byExit.get(price.exitStationId)
        if (!row) {
          row = {
            exitStationId: price.exitStationId,
            exitName: price.exitStation?.name ?? null,
            distanceMeters: price.distanceMeters,
            priceCents: VEHICLE_CLASSES.map(() => null),
          }
          byExit.set(price.exitStationId, row)
        }
        row.priceCents[price.vehicleClass - 1] = price.priceCents
      }

      // Prix fixe (système ouvert) en tête, puis destinations par ordre alphabétique
      rows = [...byExit.values()].sort((a, b) => {
        if (a.exitName === null) return -1
        if (b.exitName === null) return 1
        return a.exitName.localeCompare(b.exitName, 'fr')
      })
    }

    return inertia.render('admin/stations/show', {
      station: {
        id: station.id,
        name: station.name,
        operatorCode: station.operatorCode,
        networkName: station.network?.name ?? null,
        pricingMode: station.network?.pricingMode ?? null,
      },
      periods: periods.map((period) => ({
        validFrom: String(period.valid_from),
        validTo: period.valid_to === null ? null : String(period.valid_to),
      })),
      selectedGrid: selectedPeriod === null ? null : String(selectedPeriod.valid_from),
      rows,
    })
  }
}
