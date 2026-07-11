import { DateTime } from 'luxon'
import Toll from '#models/toll'
import TollNetwork from '#models/toll_network'
import TollPrice from '#models/toll_price'
import TollStation from '#models/toll_station'
import type { PricingMode } from '#models/toll_network'
import type { RouteLineString } from '#services/pricing/route_pricer'

/**
 * Autoroute factice ouest → est, à latitude constante 45°.
 * À cette latitude : 0.001° de latitude ≈ 111 m, 0.01° de longitude ≈ 786 m.
 * Les gares des fixtures sont décalées de 0.00005° (~5.6 m) du tracé, sous
 * le corridor de matching par défaut (10 m).
 */
export const MOTORWAY: RouteLineString = {
  type: 'LineString',
  coordinates: [
    [4.0, 45],
    [4.1, 45],
    [4.2, 45],
    [4.3, 45],
  ],
}

let networkCounter = 0

export async function seedNetwork(pricingMode: PricingMode): Promise<TollNetwork> {
  networkCounter++
  return TollNetwork.create({
    name: `Réseau ${networkCounter}`,
    slug: `reseau-${networkCounter}`,
    pricingMode,
  })
}

export async function seedStation(options: {
  name: string
  networkId: number | null
  points: Array<[number, number]>
}): Promise<TollStation> {
  const station = await TollStation.create({ name: options.name, networkId: options.networkId })
  for (const [longitude, latitude] of options.points) {
    await Toll.create({
      name: options.name,
      stationId: station.id,
      longitude,
      latitude,
      lambertX: 0,
      lambertY: 0,
    })
  }
  return station
}

export async function seedPrice(
  network: TollNetwork,
  entryStationId: number,
  exitStationId: number | null,
  priceCents: number
): Promise<TollPrice> {
  return TollPrice.create({
    networkId: network.id,
    entryStationId,
    exitStationId,
    vehicleClass: 1,
    priceCents,
    validFrom: DateTime.fromISO('2020-01-01'),
  })
}
