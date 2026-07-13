import Toll from '#models/toll'
import { boundingBox, distanceMeters, type LngLat } from '#services/pricing/geometry'

/**
 * Rayon d'appariement d'un point de perception Mapbox avec le référentiel :
 * Mapbox place l'annotation sur la chaussée en amont de la barrière, alors
 * que le référentiel data.gouv pointe la plateforme — 285 m d'écart constaté
 * à Fleury-en-Bière, 224 m à Villefranche-Limas. Le « plus proche gagne »
 * discrimine les gares voisines, séparées d'au moins ~450 m (Villefranche).
 */
const MATCH_RADIUS_METERS = 400

/** Péage du référentiel apparié à un point de perception Mapbox. */
export type TollMatch = {
  tollId: number
  name: string
  road: string | null
  side: string | null
  gateTypeLabel: string | null
  laneCount: number | null
  stationId: number | null
  stationName: string | null
  networkName: string | null
  distanceMeters: number
}

/**
 * Apparie des points de perception (annotations `toll_collection` de
 * l'API Directions) avec les péages de la base : pour chaque point, le
 * péage le plus proche à moins de `MATCH_RADIUS_METERS`, ou null.
 */
export default class TollCollectionMatcher {
  async matchPoints(points: LngLat[]): Promise<(TollMatch | null)[]> {
    if (points.length === 0) return []

    const bbox = boundingBox(points, MATCH_RADIUS_METERS)
    const candidates = await Toll.query()
      .whereBetween('latitude', [bbox.minLat, bbox.maxLat])
      .whereBetween('longitude', [bbox.minLng, bbox.maxLng])
      .preload('station', (station) => station.preload('network'))

    return points.map((point) => this.nearest(point, candidates))
  }

  private nearest(point: LngLat, candidates: Toll[]): TollMatch | null {
    let best: { toll: Toll; distance: number } | null = null
    for (const toll of candidates) {
      const distance = distanceMeters(point, [toll.longitude, toll.latitude])
      if (distance > MATCH_RADIUS_METERS) continue
      if (!best || distance < best.distance) {
        best = { toll, distance }
      }
    }
    if (!best) return null

    const station = best.toll.station
    return {
      tollId: best.toll.id,
      name: best.toll.name,
      road: best.toll.road,
      side: best.toll.side,
      gateTypeLabel: best.toll.gateTypeLabel,
      laneCount: best.toll.laneCount,
      stationId: station?.id ?? null,
      stationName: station?.name ?? null,
      networkName: station?.network?.name ?? null,
      distanceMeters: Math.round(best.distance),
    }
  }
}
