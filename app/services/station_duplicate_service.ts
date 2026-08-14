import db from '@adonisjs/lucid/services/db'
import TollStation from '#models/toll_station'
import { normalizeStationName } from '#services/import/name_normalizer'

export type DuplicateStation = {
  id: number
  name: string
  networkId: number | null
  networkName: string | null
  pointCount: number
  priceCount: number
}

export type BarrierSplit = {
  road: string
  milestone: number
  stations: DuplicateStation[]
}

export type PhantomStation = DuplicateStation & {
  /** Gares du référentiel (avec points physiques) au libellé proche. */
  suggestions: { id: number; name: string }[]
}

/** Mots trop génériques pour rapprocher deux libellés de gare. */
const STOPWORDS = new Set([
  'PEAGE',
  'DE',
  'DU',
  'DES',
  'VERS',
  'SUR',
  'EN',
  'ET',
  'LA',
  'LE',
  'LES',
])

function significantTokens(name: string): string[] {
  return normalizeStationName(name)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
}

/**
 * Repère les doublons de gares logiques qui créent des trous de tarification :
 *
 * - **barrière éclatée** : plusieurs gares portent des points physiques au même
 *   (route, PK) — typiquement les deux sens d'une même barrière restés séparés,
 *   dont un seul (voire aucun) est tarifé ;
 * - **fantôme** : une gare porte des prix mais aucun point physique, elle est
 *   donc invisible à l'appariement carto — souvent un libellé de grille qui
 *   doublonne une gare du référentiel.
 */
export default class StationDuplicateService {
  async barrierSplits(): Promise<BarrierSplit[]> {
    const rows = await db
      .from('tolls')
      .whereNotNull('station_id')
      .whereNotNull('milestone')
      .select('road', 'milestone', 'station_id')
      .groupBy('road', 'milestone', 'station_id')

    const groups = new Map<string, { road: string; milestone: number; ids: number[] }>()
    for (const row of rows) {
      const road = String(row.road)
      const milestone = Number(row.milestone)
      const key = `${road}|${milestone}`
      const group = groups.get(key) ?? { road, milestone, ids: [] }
      group.ids.push(Number(row.station_id))
      groups.set(key, group)
    }

    const splits = [...groups.values()].filter((group) => group.ids.length > 1)
    const described = await this.describe(splits.flatMap((group) => group.ids))

    return splits
      .map((group) => ({
        road: group.road,
        milestone: group.milestone,
        // La mieux tarifée d'abord : c'est la survivante naturelle.
        stations: group.ids
          .map((id) => described.get(id))
          .filter((station): station is DuplicateStation => station !== undefined)
          .sort((a, b) => b.priceCount - a.priceCount),
      }))
      .sort((a, b) => a.road.localeCompare(b.road) || a.milestone - b.milestone)
  }

  async phantoms(): Promise<PhantomStation[]> {
    const withPoints = await db.from('tolls').whereNotNull('station_id').distinct('station_id')
    const pointIds = new Set(withPoints.map((row) => Number(row.station_id)))

    const pricedIds = new Set<number>()
    const entries = await db.from('toll_prices').whereNull('valid_to').distinct('entry_station_id')
    for (const row of entries) {
      pricedIds.add(Number(row.entry_station_id))
    }
    const exits = await db
      .from('toll_prices')
      .whereNull('valid_to')
      .whereNotNull('exit_station_id')
      .distinct('exit_station_id')
    for (const row of exits) {
      pricedIds.add(Number(row.exit_station_id))
    }

    const phantomIds = [...pricedIds].filter((id) => !pointIds.has(id))
    if (phantomIds.length === 0) return []

    const described = await this.describe(phantomIds)
    const candidates = await this.realStations()
    const candidateTokens = candidates.map((station) => ({
      id: station.id,
      name: station.name,
      tokens: new Set(significantTokens(station.name)),
    }))

    // Pondération inverse-fréquence : un token rare (« CHALON ») identifie bien
    // mieux qu'un token banal (« CENTRE », « NORD »), qui sinon ferait remonter
    // « Annecy Centre » aussi haut que « Chalon Nord » pour « Chalon Centre ».
    const frequency = new Map<string, number>()
    for (const candidate of candidateTokens) {
      for (const token of candidate.tokens) {
        frequency.set(token, (frequency.get(token) ?? 0) + 1)
      }
    }

    return phantomIds
      .map((id) => described.get(id))
      .filter((station): station is DuplicateStation => station !== undefined)
      .map((station) => {
        const tokens = significantTokens(station.name)
        const suggestions = candidateTokens
          .map((candidate) => {
            let score = 0
            for (const token of tokens) {
              if (candidate.tokens.has(token)) {
                score += 1 / (frequency.get(token) ?? 1)
              }
            }
            return { id: candidate.id, name: candidate.name, score }
          })
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr'))
          .slice(0, 5)
          .map((candidate) => ({ id: candidate.id, name: candidate.name }))

        return { ...station, suggestions }
      })
      .sort((a, b) => b.priceCount - a.priceCount)
  }

  /**
   * Cibles de fusion possibles : seules les gares qui portent des points
   * physiques peuvent survivre (sinon la gare reste invisible du matching).
   */
  async realStations(): Promise<{ id: number; name: string }[]> {
    const stations = await TollStation.query()
      .whereIn('id', db.from('tolls').select('station_id').whereNotNull('station_id'))
      .orderBy('name')
      .select('id', 'name')

    return stations.map((station) => ({ id: station.id, name: station.name }))
  }

  /** Détail et compteurs (points physiques, prix en vigueur) d'un lot de gares. */
  private async describe(ids: number[]): Promise<Map<number, DuplicateStation>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Map()

    const [stations, points, entryPrices, exitPrices] = await Promise.all([
      TollStation.query().whereIn('id', unique).preload('network'),
      db
        .from('tolls')
        .whereIn('station_id', unique)
        .select('station_id')
        .count('* as total')
        .groupBy('station_id'),
      db
        .from('toll_prices')
        .whereIn('entry_station_id', unique)
        .whereNull('valid_to')
        .select('entry_station_id as sid')
        .count('* as total')
        .groupBy('entry_station_id'),
      db
        .from('toll_prices')
        .whereIn('exit_station_id', unique)
        .whereNull('valid_to')
        .select('exit_station_id as sid')
        .count('* as total')
        .groupBy('exit_station_id'),
    ])

    const pointCounts = new Map(points.map((row) => [Number(row.station_id), Number(row.total)]))
    const priceCounts = new Map<number, number>()
    for (const row of [...entryPrices, ...exitPrices]) {
      const id = Number(row.sid)
      priceCounts.set(id, (priceCounts.get(id) ?? 0) + Number(row.total))
    }

    return new Map(
      stations.map((station) => [
        station.id,
        {
          id: station.id,
          name: station.name,
          networkId: station.networkId,
          networkName: station.network?.name ?? null,
          pointCount: pointCounts.get(station.id) ?? 0,
          priceCount: priceCounts.get(station.id) ?? 0,
        },
      ])
    )
  }
}
