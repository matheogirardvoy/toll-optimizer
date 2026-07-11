import type { DateTime } from 'luxon'
import Toll from '#models/toll'
import type TollNetwork from '#models/toll_network'
import type TollStation from '#models/toll_station'
import type { PricingMode } from '#models/toll_network'
import type { VehicleClass } from '#models/toll_price'
import PriceLookup from '#services/pricing/price_lookup'
import {
  boundingBox,
  cumulativeMeters,
  projectOnPolyline,
  type LngLat,
} from '#services/pricing/geometry'

/**
 * Corridor de matching calibré sur des trajets réels (A1, A6, A7, réseaux
 * APRR/Sanef/ASF) : une gare réellement franchie se projette à 6 m ou moins
 * du tracé Mapbox (barrières pleine voie comme bretelles d'échangeur),
 * tandis que les gares adjacentes non franchies — bretelles voisines,
 * barrières contournées par les voies de transit, doublons du référentiel —
 * apparaissent à 12 m ou plus. 10 m sépare nettement les deux populations.
 */
const DEFAULT_MATCH_THRESHOLD_METERS = 10

/**
 * Fenêtre de regroupement des points d'une même gare en un seul
 * franchissement : les deux sens d'une BPV ou les bretelles d'un échangeur
 * s'étalent sur quelques centaines de mètres, alors que deux franchissements
 * réels de la même gare (aller-retour) en sont séparés de bien plus.
 */
const CROSSING_WINDOW_METERS = 500

export type RouteLineString = {
  type: 'LineString'
  coordinates: LngLat[]
}

export type RoutePricingQuery = {
  /** Tracé de l'itinéraire tel que renvoyé par Mapbox (`geometries=geojson`). */
  geometry: RouteLineString

  vehicleClass: VehicleClass

  /** Date du trajet — la grille en vigueur ce jour-là s'applique (défaut : aujourd'hui). */
  date?: DateTime

  matchThresholdMeters?: number
}

/** Point physique apparié au tracé — coordonnées prêtes pour `exclude=point()`. */
export type MatchedTollPoint = {
  tollId: number
  longitude: number
  latitude: number
  distanceMeters: number
}

/** Gare logique franchie par l'itinéraire. */
export type CrossedStation = {
  stationId: number
  stationName: string
  networkId: number | null
  networkName: string | null
  alongMeters: number
  points: MatchedTollPoint[]
}

export type RouteTollSection = {
  networkId: number
  networkName: string
  pricingMode: PricingMode
  entry: CrossedStation

  /** null : franchissement d'une barrière en système ouvert (prix fixe). */
  exit: CrossedStation | null

  priceCents: number | null
}

export type RoutePricingIssue =
  | { type: 'station-without-network'; station: CrossedStation }
  | { type: 'unpaired-entry'; station: CrossedStation; networkName: string }
  | { type: 'missing-price'; networkName: string; entry: CrossedStation; exit: CrossedStation | null }

export type RoutePricing = {
  /** Somme des sections tarifées, en centimes. */
  totalCents: number

  /** false dès qu'une gare franchie n'a pas pu être tarifée (voir `issues`). */
  complete: boolean

  /** Toutes les gares franchies, dans l'ordre du tracé. */
  crossings: CrossedStation[]

  sections: RouteTollSection[]
  issues: RoutePricingIssue[]
}

type Match = {
  toll: Toll
  station: TollStation
  network: TollNetwork | null
  alongMeters: number
  distanceMeters: number
}

type Crossing = {
  station: TollStation
  network: TollNetwork | null
  alongMeters: number
  lastAlongMeters: number
  matches: Match[]
}

type UnpricedSection = {
  network: TollNetwork
  entry: Crossing
  exit: Crossing | null
}

/**
 * Tarife un itinéraire : détecte les gares de péage franchies par le tracé,
 * les reconstitue en sections tarifaires (couple entrée/sortie en système
 * fermé, barrière seule en système ouvert) et interroge la grille de prix.
 *
 * Toute gare impossible à tarifer (réseau inconnu, entrée sans sortie, prix
 * absent de la grille) est remontée dans `issues` plutôt que d'échouer : le
 * total reste exploitable mais `complete` passe à false.
 */
export default class RoutePricer {
  constructor(private priceLookup: PriceLookup = new PriceLookup()) {}

  async price(query: RoutePricingQuery): Promise<RoutePricing> {
    const line = query.geometry.coordinates
    if (line.length < 2) {
      return { totalCents: 0, complete: true, crossings: [], sections: [], issues: [] }
    }

    const threshold = query.matchThresholdMeters ?? DEFAULT_MATCH_THRESHOLD_METERS
    const matches = await this.matchTolls(line, threshold)
    const crossings = this.groupIntoCrossings(matches)
    const { sections, issues } = this.pairCrossings(crossings)
    const pricedSections = await this.priceSections(sections, issues, query)

    return {
      totalCents: pricedSections.reduce((sum, section) => sum + (section.priceCents ?? 0), 0),
      complete: issues.length === 0,
      crossings: crossings.map((crossing) => this.describeCrossing(crossing)),
      sections: pricedSections,
      issues,
    }
  }

  /**
   * Scan « large » : gares proches du tracé sans être forcément franchies
   * (bretelles voisines, barrières contournées). L'optimiseur s'en sert pour
   * construire les exclusions de couloir — exclure toutes les portes d'un
   * tronçon, pas seulement celles que le tracé courant traverse.
   */
  async scanStations(geometry: RouteLineString, thresholdMeters: number): Promise<CrossedStation[]> {
    if (geometry.coordinates.length < 2) return []
    const matches = await this.matchTolls(geometry.coordinates, thresholdMeters)
    return this.groupIntoCrossings(matches).map((crossing) => this.describeCrossing(crossing))
  }

  /**
   * Projette chaque point physique candidat (préfiltré par la boîte
   * englobante du tracé) sur la polyligne et retient ceux à moins de
   * `threshold` mètres, triés par abscisse curviligne.
   */
  private async matchTolls(line: LngLat[], threshold: number): Promise<Match[]> {
    const bbox = boundingBox(line, threshold)
    const cumulative = cumulativeMeters(line)

    const candidates = await Toll.query()
      .whereNotNull('station_id')
      .whereBetween('latitude', [bbox.minLat, bbox.maxLat])
      .whereBetween('longitude', [bbox.minLng, bbox.maxLng])
      .preload('station', (station) => station.preload('network'))

    const matches: Match[] = []
    for (const toll of candidates) {
      if (!toll.station) continue

      const projection = projectOnPolyline([toll.longitude, toll.latitude], line, cumulative)
      if (!projection || projection.distanceMeters > threshold) continue

      matches.push({
        toll,
        station: toll.station,
        network: toll.station.network,
        alongMeters: projection.alongMeters,
        distanceMeters: projection.distanceMeters,
      })
    }

    return matches.sort((a, b) => a.alongMeters - b.alongMeters)
  }

  /**
   * Regroupe les points appariés d'une même gare en franchissements : les
   * matches consécutifs (à moins de `CROSSING_WINDOW_METERS` l'un de
   * l'autre le long du tracé) forment un seul franchissement.
   */
  private groupIntoCrossings(matches: Match[]): Crossing[] {
    const crossings: Crossing[] = []
    const openCrossings = new Map<number, Crossing>()

    for (const match of matches) {
      const open = openCrossings.get(match.station.id)
      if (open && match.alongMeters - open.lastAlongMeters <= CROSSING_WINDOW_METERS) {
        open.lastAlongMeters = match.alongMeters
        open.matches.push(match)
        continue
      }

      const crossing: Crossing = {
        station: match.station,
        network: match.network,
        alongMeters: match.alongMeters,
        lastAlongMeters: match.alongMeters,
        matches: [match],
      }
      crossings.push(crossing)
      openCrossings.set(match.station.id, crossing)
    }

    return crossings
  }

  /**
   * Reconstitue les sections tarifaires à partir des franchissements
   * ordonnés. Système ouvert : chaque franchissement est une section à prix
   * fixe. Système fermé : les franchissements consécutifs d'un même réseau
   * sont appariés deux à deux (entrée puis sortie).
   *
   * Limite connue de cet appariement : une BPV intermédiaire franchie au
   * milieu d'un trajet payant du même réseau serait prise pour une sortie.
   * Si le cas apparaît dans les données, affiner ici avec `gateType`
   * (une gare `Ech` est forcément une vraie entrée/sortie de bretelle).
   */
  private pairCrossings(crossings: Crossing[]): {
    sections: UnpricedSection[]
    issues: RoutePricingIssue[]
  } {
    const sections: UnpricedSection[] = []
    const issues: RoutePricingIssue[] = []
    const pendingEntries = new Map<number, Crossing>()

    for (const crossing of crossings) {
      const network = crossing.network
      if (!network) {
        issues.push({ type: 'station-without-network', station: this.describeCrossing(crossing) })
        continue
      }

      if (network.pricingMode === 'open') {
        sections.push({ network, entry: crossing, exit: null })
        continue
      }

      const pending = pendingEntries.get(network.id)
      if (pending) {
        sections.push({ network, entry: pending, exit: crossing })
        pendingEntries.delete(network.id)
      } else {
        pendingEntries.set(network.id, crossing)
      }
    }

    for (const pending of pendingEntries.values()) {
      issues.push({
        type: 'unpaired-entry',
        station: this.describeCrossing(pending),
        networkName: pending.network?.name ?? '',
      })
    }

    return { sections, issues }
  }

  private async priceSections(
    sections: UnpricedSection[],
    issues: RoutePricingIssue[],
    query: RoutePricingQuery
  ): Promise<RouteTollSection[]> {
    const priced = await Promise.all(
      sections.map(async (section): Promise<RouteTollSection> => {
        const price = await this.priceLookup.forTraversal({
          entryStationId: section.entry.station.id,
          exitStationId: section.exit?.station.id ?? null,
          vehicleClass: query.vehicleClass,
          date: query.date,
        })

        return {
          networkId: section.network.id,
          networkName: section.network.name,
          pricingMode: section.network.pricingMode,
          entry: this.describeCrossing(section.entry),
          exit: section.exit ? this.describeCrossing(section.exit) : null,
          priceCents: price?.priceCents ?? null,
        }
      })
    )

    for (const section of priced) {
      if (section.priceCents === null) {
        issues.push({
          type: 'missing-price',
          networkName: section.networkName,
          entry: section.entry,
          exit: section.exit,
        })
      }
    }

    return priced.sort((a, b) => a.entry.alongMeters - b.entry.alongMeters)
  }

  private describeCrossing(crossing: Crossing): CrossedStation {
    return {
      stationId: crossing.station.id,
      stationName: crossing.station.name,
      networkId: crossing.network?.id ?? null,
      networkName: crossing.network?.name ?? null,
      alongMeters: crossing.alongMeters,
      points: crossing.matches.map((match) => ({
        tollId: match.toll.id,
        longitude: match.toll.longitude,
        latitude: match.toll.latitude,
        distanceMeters: match.distanceMeters,
      })),
    }
  }
}
