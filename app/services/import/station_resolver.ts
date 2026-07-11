import TollStation from '#models/toll_station'
import StationAlias from '#models/station_alias'
import { normalizeStationName } from './name_normalizer.js'

export type StationRef = {
  name: string
  code: string | null
}

export type StationResolution =
  | { station: TollStation; failure?: undefined }
  | { station: null; failure: 'not_found' | 'ambiguous' }

/**
 * Résout les gares citées par une grille tarifaire vers les gares logiques
 * du référentiel. Ordre de priorité :
 *   1. code concessionnaire (stable d'une grille annuelle à l'autre)
 *   2. alias manuel du réseau (décision humaine, prime sur l'automatique)
 *   3. nom normalisé (tous réseaux : une grille peut citer une gare voisine)
 */
export default class StationResolver {
  private byCode = new Map<string, TollStation>()
  private byAlias = new Map<string, TollStation>()
  private byName = new Map<string, TollStation>()
  private ambiguousNames = new Set<string>()

  constructor(private networkId: number) {}

  async load(): Promise<void> {
    const stations = await TollStation.all()
    for (const station of stations) {
      if (station.networkId === this.networkId && station.operatorCode !== null) {
        this.byCode.set(station.operatorCode, station)
      }

      const key = normalizeStationName(station.name)
      if (this.byName.has(key)) {
        this.byName.delete(key)
        this.ambiguousNames.add(key)
      } else if (!this.ambiguousNames.has(key)) {
        this.byName.set(key, station)
      }
    }

    const aliases = await StationAlias.query()
      .where('network_id', this.networkId)
      .preload('station')
    for (const alias of aliases) {
      this.byAlias.set(alias.alias, alias.station)
    }
  }

  /**
   * Enregistre un code concessionnaire découvert en cours d'import (adoption),
   * pour que les lignes suivantes de la grille résolvent directement par code
   * même si leur libellé varie.
   */
  registerCode(code: string, station: TollStation): void {
    this.byCode.set(code, station)
  }

  resolve(ref: StationRef): StationResolution {
    if (ref.code !== null) {
      const station = this.byCode.get(ref.code)
      if (station) return { station }
    }

    const normalized = normalizeStationName(ref.name)

    const aliased = this.byAlias.get(normalized)
    if (aliased) return { station: aliased }

    if (this.ambiguousNames.has(normalized)) return { station: null, failure: 'ambiguous' }

    const named = this.byName.get(normalized)
    if (named) return { station: named }

    return { station: null, failure: 'not_found' }
  }
}
