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

/**
 * Réparation des orphelins : une gare de bretelle réellement empruntée peut
 * projeter à 15-35 m du tracé Mapbox (géométrie de bretelle simplifiée —
 * constaté sur le complexe La Côtière/La Boisse de l'A42). Quand une entrée
 * reste sans sortie, on cherche la gare manquée parmi celles frôlées à
 * moins de `RESCUE_SCAN_METERS`, à moins de `RESCUE_RANGE_METERS` le long
 * du tracé ; l'existence du couple dans la grille sert de garde-fou.
 */
const RESCUE_SCAN_METERS = 60
const RESCUE_RANGE_METERS = 30_000

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

/** Franchissement resté sans sortie après appariement d'un bloc fermé. */
type OrphanCrossing = {
  network: TollNetwork
  crossing: Crossing
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
    const { sections, orphans, issues } = this.pairCrossings(crossings)

    const { rescued, remaining } = await this.rescueOrphans(orphans, crossings, line, threshold, query)
    sections.push(...rescued)

    const pricedSections = await this.priceSections(sections, remaining, issues, query)

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
   * fixe. Système fermé : les franchissements sont regroupés en blocs
   * contigus d'un même réseau (les gares sans réseau ou en système ouvert
   * ne scindent pas un bloc), appariés par `pairBlock`.
   */
  private pairCrossings(crossings: Crossing[]): {
    sections: UnpricedSection[]
    orphans: OrphanCrossing[]
    issues: RoutePricingIssue[]
  } {
    const sections: UnpricedSection[] = []
    const orphans: OrphanCrossing[] = []
    const issues: RoutePricingIssue[] = []

    type Block = { network: TollNetwork; crossings: Crossing[] }
    const blocks: Block[] = []
    let openBlock: Block | null = null

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

      if (openBlock && openBlock.network.id === network.id) {
        openBlock.crossings.push(crossing)
      } else {
        openBlock = { network, crossings: [crossing] }
        blocks.push(openBlock)
      }
    }

    for (const block of blocks) {
      this.pairBlock(block.network, block.crossings, sections, orphans)
    }

    return { sections, orphans, issues }
  }

  /**
   * Appariement d'un bloc de franchissements d'un même réseau fermé : la
   * section court de la première gare jusqu'à une gare d'échangeur (`Ech`)
   * ou jusqu'à la dernière gare du bloc. Une bretelle franchie est
   * forcément une vraie entrée/sortie ; une barrière pleine voie (`Bpv`)
   * intermédiaire, elle, se franchit ticket en main sans clore le trajet —
   * quand ce n'est pas un point du référentiel côtoyé sans être franchi
   * (Pouilly-en-Auxois sur l'A6, à 0 m de la voie sud). Une gare de type
   * inconnu est traitée comme un échangeur (comportement conservateur).
   */
  private pairBlock(
    network: TollNetwork,
    crossings: Crossing[],
    sections: UnpricedSection[],
    orphans: OrphanCrossing[]
  ): void {
    let pending: Crossing | null = null
    const lastIndex = crossings.length - 1

    for (let index = 0; index <= lastIndex; index++) {
      const crossing = crossings[index]
      if (!pending) {
        pending = crossing
        continue
      }

      const closesSection = crossing.station.gateType !== 'Bpv' || index === lastIndex
      if (closesSection) {
        sections.push({ network, entry: pending, exit: crossing })
        pending = null
      }
    }

    // Le sort du franchissement resté seul se joue à la tarification : s'il
    // a un prix « franchissement seul », c'était une barrière à prix fixe.
    if (pending) {
      orphans.push({ network, crossing: pending })
    }
  }

  /**
   * Tente d'apparier chaque orphelin avec une gare du même réseau frôlée
   * par le tracé sans avoir été matchée (bretelle à 15-60 m). Le couple
   * n'est retenu que si la grille le tarife — une gare voisine non
   * empruntée ne produit pas de couple commercial plausible dans ce sens.
   */
  private async rescueOrphans(
    orphans: OrphanCrossing[],
    strictCrossings: Crossing[],
    line: LngLat[],
    strictThreshold: number,
    query: RoutePricingQuery
  ): Promise<{ rescued: UnpricedSection[]; remaining: OrphanCrossing[] }> {
    if (orphans.length === 0) {
      return { rescued: [], remaining: [] }
    }

    const strictStationIds = new Set(strictCrossings.map((crossing) => crossing.station.id))
    const nearMisses = this.groupIntoCrossings(
      (await this.matchTolls(line, RESCUE_SCAN_METERS)).filter(
        (match) =>
          match.distanceMeters > strictThreshold && !strictStationIds.has(match.station.id)
      )
    )

    const rescued: UnpricedSection[] = []
    const remaining: OrphanCrossing[] = []

    for (const orphan of orphans) {
      const candidates = nearMisses
        .filter(
          (candidate) =>
            candidate.network?.id === orphan.network.id &&
            Math.abs(candidate.alongMeters - orphan.crossing.alongMeters) <= RESCUE_RANGE_METERS
        )
        .sort(
          (a, b) =>
            Math.abs(a.alongMeters - orphan.crossing.alongMeters) -
            Math.abs(b.alongMeters - orphan.crossing.alongMeters)
        )

      let section: UnpricedSection | null = null
      for (const candidate of candidates) {
        const downstream = candidate.alongMeters >= orphan.crossing.alongMeters
        const entry = downstream ? orphan.crossing : candidate
        const exit = downstream ? candidate : orphan.crossing

        const price = await this.priceLookup.forTraversal({
          entryStationId: entry.station.id,
          exitStationId: exit.station.id,
          vehicleClass: query.vehicleClass,
          date: query.date,
        })
        if (price !== null) {
          section = { network: orphan.network, entry, exit }
          break
        }
      }

      if (section) {
        rescued.push(section)
      } else {
        remaining.push(orphan)
      }
    }

    return { rescued, remaining }
  }

  /**
   * Tarife les sections appariées et les franchissements orphelins.
   *
   * Repli « franchissement seul » : les grilles publient un prix fixe
   * (sortie nulle) pour les barrières traversables hors système fermé.
   * Un orphelin qui possède un tel prix était donc une barrière à prix
   * fixe, pas une entrée restée sans sortie ; et un couple absent de la
   * grille dont les deux gares ont chacune leur prix fixe était en réalité
   * deux barrières indépendantes (Le Crozet puis Voreppe sur A49/A48), pas
   * un trajet fermé.
   */
  private async priceSections(
    sections: UnpricedSection[],
    orphans: OrphanCrossing[],
    issues: RoutePricingIssue[],
    query: RoutePricingQuery
  ): Promise<RouteTollSection[]> {
    const priced: RouteTollSection[] = []

    const lookup = (entryStationId: number, exitStationId: number | null) =>
      this.priceLookup.forTraversal({
        entryStationId,
        exitStationId,
        vehicleClass: query.vehicleClass,
        date: query.date,
      })

    for (const section of sections) {
      const price = await lookup(section.entry.station.id, section.exit?.station.id ?? null)
      if (price !== null || section.exit === null) {
        priced.push(this.describeSection(section.network, section.entry, section.exit, price))
        if (price === null) {
          issues.push({
            type: 'missing-price',
            networkName: section.network.name,
            entry: this.describeCrossing(section.entry),
            exit: section.exit ? this.describeCrossing(section.exit) : null,
          })
        }
        continue
      }

      // Couple fermé absent de la grille : chaque extrémité tente son prix
      // de franchissement seul ; celle qui n'en a pas redevient orpheline.
      const [entryBarrier, exitBarrier] = await Promise.all([
        lookup(section.entry.station.id, null),
        lookup(section.exit.station.id, null),
      ])

      if (entryBarrier === null && exitBarrier === null) {
        priced.push(this.describeSection(section.network, section.entry, section.exit, null))
        issues.push({
          type: 'missing-price',
          networkName: section.network.name,
          entry: this.describeCrossing(section.entry),
          exit: this.describeCrossing(section.exit),
        })
        continue
      }

      for (const [crossing, barrier] of [
        [section.entry, entryBarrier],
        [section.exit, exitBarrier],
      ] as const) {
        if (barrier !== null) {
          priced.push(this.describeSection(section.network, crossing, null, barrier))
        } else {
          issues.push({
            type: 'unpaired-entry',
            station: this.describeCrossing(crossing),
            networkName: section.network.name,
          })
        }
      }
    }

    for (const orphan of orphans) {
      const barrier = await lookup(orphan.crossing.station.id, null)
      if (barrier !== null) {
        priced.push(this.describeSection(orphan.network, orphan.crossing, null, barrier))
      } else {
        issues.push({
          type: 'unpaired-entry',
          station: this.describeCrossing(orphan.crossing),
          networkName: orphan.network.name,
        })
      }
    }

    return priced.sort((a, b) => a.entry.alongMeters - b.entry.alongMeters)
  }

  private describeSection(
    network: TollNetwork,
    entry: Crossing,
    exit: Crossing | null,
    price: { priceCents: number } | null
  ): RouteTollSection {
    return {
      networkId: network.id,
      networkName: network.name,
      // Une section sans sortie est tarifée au franchissement (prix fixe),
      // quel que soit le mode nominal du réseau.
      pricingMode: exit === null ? 'open' : network.pricingMode,
      entry: this.describeCrossing(entry),
      exit: exit ? this.describeCrossing(exit) : null,
      priceCents: price?.priceCents ?? null,
    }
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
