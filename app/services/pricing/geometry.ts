/**
 * Géométrie plane locale pour le matching péages / itinéraire.
 *
 * Aux échelles qui nous intéressent (projeter un point à moins de ~100 m
 * d'une polyligne), une projection équirectangulaire centrée sur le point
 * suffit largement : l'erreur est centimétrique, pour un coût bien moindre
 * qu'un calcul géodésique complet sur chaque segment.
 */

/** Coordonnée GeoJSON : [longitude, latitude]. */
export type LngLat = [number, number]

const EARTH_RADIUS_METERS = 6_371_008.8
const DEGREES_TO_RADIANS = Math.PI / 180

/** Mètres par degré de latitude (constant sur le sphéroïde approximé). */
export const METERS_PER_DEGREE_LAT = EARTH_RADIUS_METERS * DEGREES_TO_RADIANS

/** Mètres par degré de longitude à une latitude donnée. */
export function metersPerDegreeLng(latitude: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos(latitude * DEGREES_TO_RADIANS)
}

/** Distance approchée entre deux coordonnées, en mètres. */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const meanLat = (a[1] + b[1]) / 2
  const dx = (b[0] - a[0]) * metersPerDegreeLng(meanLat)
  const dy = (b[1] - a[1]) * METERS_PER_DEGREE_LAT
  return Math.hypot(dx, dy)
}

/**
 * Distance cumulée le long d'une polyligne : `result[i]` est la longueur en
 * mètres du tracé entre son origine et le sommet `i`.
 */
export function cumulativeMeters(line: LngLat[]): number[] {
  const cumulative = new Array<number>(line.length)
  let total = 0
  for (let i = 0; i < line.length; i++) {
    if (i > 0) total += distanceMeters(line[i - 1], line[i])
    cumulative[i] = total
  }
  return cumulative
}

export type PolylineProjection = {
  /** Distance perpendiculaire du point à la polyligne, en mètres. */
  distanceMeters: number

  /** Abscisse curviligne du projeté : distance depuis l'origine du tracé. */
  alongMeters: number
}

/**
 * Projette un point sur une polyligne : segment le plus proche, distance et
 * abscisse curviligne du projeté. `cumulative` doit provenir de
 * `cumulativeMeters(line)` (précalculé une fois pour tous les points).
 *
 * Renvoie `null` pour une polyligne de moins de deux sommets.
 */
export function projectOnPolyline(
  point: LngLat,
  line: LngLat[],
  cumulative: number[]
): PolylineProjection | null {
  if (line.length < 2) return null

  // Repère plan local centré sur le point : x en mètres vers l'est, y vers le nord.
  const lngScale = metersPerDegreeLng(point[1])
  const toLocal = (coord: LngLat): [number, number] => [
    (coord[0] - point[0]) * lngScale,
    (coord[1] - point[1]) * METERS_PER_DEGREE_LAT,
  ]

  let best: PolylineProjection | null = null
  let [ax, ay] = toLocal(line[0])

  for (let i = 1; i < line.length; i++) {
    const [bx, by] = toLocal(line[i])
    const dx = bx - ax
    const dy = by - ay
    const lengthSquared = dx * dx + dy * dy

    // Position du projeté sur le segment, bornée aux extrémités.
    const t =
      lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSquared))
    const px = ax + t * dx
    const py = ay + t * dy
    const distance = Math.hypot(px, py)

    if (best === null || distance < best.distanceMeters) {
      const segmentLength = cumulative[i] - cumulative[i - 1]
      best = { distanceMeters: distance, alongMeters: cumulative[i - 1] + t * segmentLength }
    }

    ax = bx
    ay = by
  }

  return best
}

export type BoundingBox = {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

/**
 * Boîte englobante d'une polyligne, élargie de `marginMeters` : sert de
 * préfiltre SQL pour ne charger que les péages proches du tracé.
 */
export function boundingBox(line: LngLat[], marginMeters: number): BoundingBox {
  let minLng = Number.POSITIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY

  for (const [lng, lat] of line) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }

  const latMargin = marginMeters / METERS_PER_DEGREE_LAT
  const widestLat = Math.max(Math.abs(minLat), Math.abs(maxLat))
  const lngMargin = marginMeters / Math.max(metersPerDegreeLng(widestLat), 1)

  return {
    minLng: minLng - lngMargin,
    minLat: minLat - latMargin,
    maxLng: maxLng + lngMargin,
    maxLat: maxLat + latMargin,
  }
}
