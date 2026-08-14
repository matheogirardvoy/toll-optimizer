import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DirectionsClient, { DirectionsError } from '#services/mapbox/directions_client'
import type { DirectionsRoute } from '#services/mapbox/directions_client'
import RoutePricer from '#services/pricing/route_pricer'
import { VEHICLE_CLASSES, type VehicleClass } from '#models/toll_price'

/**
 * Commande de contrôle : calcule un itinéraire réel via Mapbox puis le
 * tarife avec RoutePricer contre la base courante. Sert à valider le
 * matching et la grille de prix sur de vrais trajets.
 *
 *   node ace price:route "45.7640,4.8357" "48.8566,2.3522"
 */
export default class PriceRoute extends BaseCommand {
  static commandName = 'price:route'
  static description = 'Tarife un itinéraire Mapbox entre deux points (lat,lng)'
  static options: CommandOptions = { startApp: true }

  @args.string({ description: 'Départ au format "lat,lng"' })
  declare from: string

  @args.string({ description: 'Arrivée au format "lat,lng"' })
  declare to: string

  @flags.number({ description: 'Classe tarifaire (1 à 5)', default: 1 })
  declare vehicleClass: number

  @flags.boolean({ description: 'Itinéraire sans péage (exclude=toll)', default: false })
  declare noToll: boolean

  @flags.number({ description: 'Corridor de matching en mètres (défaut : celui du service)' })
  declare threshold: number | undefined

  async run() {
    if (!VEHICLE_CLASSES.includes(this.vehicleClass as VehicleClass)) {
      this.logger.error(`Classe tarifaire invalide : ${this.vehicleClass} (attendu 1 à 5)`)
      this.exitCode = 1
      return
    }

    const route = await this.fetchRoute()
    if (!route) return

    const pricer = new RoutePricer()
    const pricing = await pricer.price({
      geometry: route.geometry,
      vehicleClass: this.vehicleClass as VehicleClass,
      matchThresholdMeters: this.threshold,
      tollCollections: route.tollCollections,
    })

    this.logger.info(`Gares franchies : ${pricing.crossings.length}`)
    for (const crossing of pricing.crossings) {
      const km = (crossing.alongMeters / 1000).toFixed(1)
      const distances = crossing.points.map((point) => point.distanceMeters)
      const closest = Math.min(...distances).toFixed(0)
      this.logger.log(
        `  km ${km.padStart(6)}  ${crossing.stationName} [${crossing.networkName ?? 'sans réseau'}]` +
          ` (${crossing.points.length} pt(s), plus proche à ${closest} m)`
      )
    }

    this.logger.info(`Sections tarifées : ${pricing.sections.length}`)
    for (const section of pricing.sections) {
      const price = section.priceCents === null ? 'PRIX MANQUANT' : this.euros(section.priceCents)
      const path = section.exit
        ? `${section.entry.stationName} → ${section.exit.stationName}`
        : `${section.entry.stationName} (barrière)`
      this.logger.log(`  ${price.padStart(12)}  ${path} [${section.networkName}]`)
    }

    for (const issue of pricing.issues) {
      this.logger.warning(`Anomalie ${issue.type} : ${JSON.stringify(issue, null, 0).slice(0, 200)}`)
    }

    this.logger.success(
      `Total : ${this.euros(pricing.totalCents)}${pricing.complete ? '' : ' (INCOMPLET)'}`
    )
  }

  private euros(cents: number): string {
    return `${(cents / 100).toFixed(2)} €`
  }

  private async fetchRoute(): Promise<DirectionsRoute | null> {
    const parse = (value: string, label: string): [number, number] | null => {
      const parts = value.split(',').map((part) => Number.parseFloat(part.trim()))
      if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) {
        this.logger.error(`${label} invalide : "${value}" (attendu "lat,lng")`)
        return null
      }
      // Mapbox attend lng,lat
      return [parts[1], parts[0]]
    }

    const from = parse(this.from, 'Départ')
    const to = parse(this.to, 'Arrivée')
    if (!from || !to) {
      this.exitCode = 1
      return null
    }

    let routes: DirectionsRoute[]
    try {
      routes = await new DirectionsClient().fetchRoutes(from, to, { excludeTolls: this.noToll })
    } catch (error) {
      if (error instanceof DirectionsError) {
        this.logger.error(error.message)
        this.exitCode = 1
        return null
      }
      throw error
    }

    const route = routes[0]
    if (!route) {
      this.logger.error('Aucun itinéraire renvoyé par Mapbox')
      this.exitCode = 1
      return null
    }

    this.logger.info(
      `Itinéraire : ${(route.distance / 1000).toFixed(0)} km, ${(route.duration / 60).toFixed(0)} min, ` +
        `${route.geometry.coordinates.length} points, ` +
        `${route.tollCollections?.length ?? 0} annotation(s) de péage`
    )
    return route
  }
}
