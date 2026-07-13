import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import RouteOptimizer from '#services/optimizer/route_optimizer'
import type { EvaluatedRouteSummary } from '#services/optimizer/route_optimizer'
import { VEHICLE_CLASSES, type VehicleClass } from '#models/toll_price'
import type { LngLat } from '#services/pricing/geometry'

/**
 * Commande de contrôle : optimise un trajet réel de bout en bout (Mapbox +
 * greedy + grille de prix) et affiche toutes les candidates évaluées.
 *
 *   node ace optimize:route "45.7640,4.8357" "48.8566,2.3522" --max-price 20 --minutes 60
 */
export default class OptimizeRoute extends BaseCommand {
  static commandName = 'optimize:route'
  static description = 'Optimise un trajet péages/sans-péages entre deux points (lat,lng)'
  static options: CommandOptions = { startApp: true }

  @args.string({ description: 'Départ au format "lat,lng"' })
  declare from: string

  @args.string({ description: 'Arrivée au format "lat,lng"' })
  declare to: string

  @flags.number({ description: 'Prix maximal consenti, en euros', default: 20 })
  declare maxPrice: number

  @flags.number({ description: 'Minutes gagnées justifiant ce prix', default: 60 })
  declare minutes: number

  @flags.number({ description: 'Classe tarifaire (1 à 5)', default: 1 })
  declare vehicleClass: number

  async run() {
    if (!VEHICLE_CLASSES.includes(this.vehicleClass as VehicleClass)) {
      this.logger.error(`Classe tarifaire invalide : ${this.vehicleClass} (attendu 1 à 5)`)
      this.exitCode = 1
      return
    }

    const start = this.parseCoordinate(this.from, 'Départ')
    const end = this.parseCoordinate(this.to, 'Arrivée')
    if (!start || !end) {
      this.exitCode = 1
      return
    }

    const result = await new RouteOptimizer().optimize({
      start,
      end,
      vehicleClass: this.vehicleClass as VehicleClass,
      maxPriceCents: Math.round(this.maxPrice * 100),
      minutesSaved: this.minutes,
    })

    this.logger.info(
      `Consentement : ${this.maxPrice.toFixed(2)} € pour ${this.minutes} min ` +
        `→ rho ${result.rhoCentsPerMinute.toFixed(1)} c/min`
    )

    this.logger.info('Routes évaluées (score = minutes équivalentes) :')
    for (const route of result.evaluated) {
      this.logger.log(`  ${this.describe(route)}`)
      for (const issue of route.issues) {
        this.logger.log(`      ⚠ ${this.describeIssue(issue)}`)
      }
    }

    if (result.decisions.length > 0) {
      this.logger.info('Rentabilité par tronçon (garder le péage coûte X €/h gagnée) :')
      for (const decision of result.decisions) {
        const path = decision.exitStationName
          ? `${decision.entryStationName} → ${decision.exitStationName}`
          : `${decision.entryStationName} (barrière)`
        const ratio =
          decision.ratioCentsPerHour === null
            ? 'inévitable'
            : `${(decision.ratioCentsPerHour / 100).toFixed(2)} €/h`
        const extra =
          decision.extraDurationSeconds === null
            ? ''
            : ` (+${Math.round(decision.extraDurationSeconds / 60)} min si évité)`
        const flags = decision.reliable ? '' : '  [comparaison incertaine]'
        this.logger.log(
          `  ${decision.keptInBest ? '✅' : '🚫'} ${ratio.padStart(10)}  ${path}${extra}${flags}`
        )
      }
    }

    for (const warning of result.warnings) {
      this.logger.warning(warning)
    }

    const best = result.best
    const saved = result.fastest.pricing.totalCents - best.pricing.totalCents
    const slower = (best.durationSeconds - result.fastest.durationSeconds) / 60
    this.logger.success(
      `Recommandation : ${best.kind} — ${this.minutesLabel(best.durationSeconds)}, ` +
        `${this.euros(best.pricing.totalCents)}` +
        (best.kind === 'fastest'
          ? ''
          : ` (économise ${this.euros(saved)} pour ${slower.toFixed(0)} min de plus)`)
    )
    if (best.excludedStations.length > 0) {
      this.logger.log(`  Gares évitées : ${best.excludedStations.join(', ')}`)
    }
    if (!best.pricing.complete) {
      this.logger.warning('Tarification incomplète sur la route recommandée (voir issues)')
    }
  }

  private describe(route: EvaluatedRouteSummary): string {
    const score = route.scoreMinutes.toFixed(1).padStart(7)
    const price = this.euros(route.totalCents).padStart(9)
    const duration = this.minutesLabel(route.durationSeconds).padStart(8)
    const flags = route.pricingComplete ? '' : '  [tarification incomplète]'
    const excluded =
      route.excludedStations.length > 0 ? `  (évite ${route.excludedStations.join(', ')})` : ''
    return `score ${score}  ${duration}  ${price}  ${route.kind}${excluded}${flags}`
  }

  private describeIssue(issue: EvaluatedRouteSummary['issues'][number]): string {
    switch (issue.type) {
      case 'station-without-network':
        return `gare sans réseau : ${issue.station.stationName} (km ${(issue.station.alongMeters / 1000).toFixed(1)})`
      case 'unpaired-entry':
        return `entrée sans sortie : ${issue.station.stationName} [${issue.networkName}] (km ${(issue.station.alongMeters / 1000).toFixed(1)})`
      case 'missing-price':
        return `prix manquant : ${issue.entry.stationName} → ${issue.exit?.stationName ?? 'barrière'} [${issue.networkName}]`
    }
  }

  private euros(cents: number): string {
    return `${(cents / 100).toFixed(2)} €`
  }

  private minutesLabel(seconds: number): string {
    return `${(seconds / 60).toFixed(0)} min`
  }

  private parseCoordinate(value: string, label: string): LngLat | null {
    const parts = value.split(',').map((part) => Number.parseFloat(part.trim()))
    if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) {
      this.logger.error(`${label} invalide : "${value}" (attendu "lat,lng")`)
      return null
    }
    // L'utilisateur saisit lat,lng ; l'optimiseur attend l'ordre GeoJSON.
    return [parts[1], parts[0]]
  }
}
