import db from '@adonisjs/lucid/services/db'
import Toll from '#models/toll'
import TollStation from '#models/toll_station'

export type StationBuildResult = {
  created: number
  updated: number
  deleted: number
  linkedTolls: number
}

/**
 * Nom de gare logique dérivé du nom d'un point physique : retire les
 * guillemets et espaces parasites du référentiel, puis les suffixes
 * directionnels (« Entrée »/« Sortie », « BPV Sens 1 », « Bpv »…) afin de
 * fusionner les points des deux sens d'une même gare. Les suffixes porteurs
 * d'identité (« Barriere », « Est »/« Ouest », noms de bretelles) sont
 * conservés : ils distinguent de vraies gares.
 */
export function logicalStationName(rawName: string): string {
  let name = rawName.replace(/^["\s]+|["\s]+$/g, '')

  // Les suffixes se cumulent (« Dury BPV Sortie Sens 1 ») : on pèle
  // jusqu'à stabilité.
  let previous: string
  do {
    previous = name
    name = name
      .replace(/\s+Sens\s*\d$/i, '')
      .replace(/\s+(?:Entrée|Entree|Sortie)(?:\s+\d)?$/i, '')
      // Variante abrégée du référentiel : « Condrieu E » / « Condrieu S »
      .replace(/\s+[ES]$/, '')
      .replace(/\s+BPV$/i, '')
  } while (name !== previous)

  return name.trim()
}

/**
 * Construit les gares logiques à partir des points physiques du référentiel
 * (`tolls` contient une ligne par sens de circulation, parfois sous deux
 * conventions de route différentes pour la même gare).
 *
 * Idempotent : les gares existantes sont mises à jour (type, centroïde) en
 * conservant leur rattachement réseau, leur code opérateur et leurs alias ;
 * les gares devenues orphelines et non référencées sont supprimées.
 */
export default class StationBuilderService {
  async rebuild(): Promise<StationBuildResult> {
    const tolls = await Toll.all()

    const groups = new Map<string, Toll[]>()
    for (const toll of tolls) {
      const name = logicalStationName(toll.name)
      const points = groups.get(name)
      if (points) {
        points.push(toll)
      } else {
        groups.set(name, [toll])
      }
    }

    const result: StationBuildResult = { created: 0, updated: 0, deleted: 0, linkedTolls: 0 }

    await db.transaction(async (trx) => {
      const existing = await TollStation.query({ client: trx })
      const byName = new Map(existing.map((station) => [station.name, station]))
      const keptIds = new Set<number>()

      for (const [name, points] of groups) {
        const gateTypes = new Set(points.map((point) => point.gateType))
        const attributes = {
          // Type conservé seulement s'il est homogène entre les points
          gateType: gateTypes.size === 1 ? points[0].gateType : null,
          longitude: average(points.map((point) => point.longitude)),
          latitude: average(points.map((point) => point.latitude)),
        }

        let station = byName.get(name)
        if (station) {
          station.useTransaction(trx)
          station.merge(attributes)
          await station.save()
          result.updated++
        } else {
          station = await TollStation.create({ name, ...attributes }, { client: trx })
          result.created++
        }
        keptIds.add(station.id)

        await trx
          .from('tolls')
          .whereIn(
            'id',
            points.map((point) => point.id)
          )
          .update({ station_id: station.id })
        result.linkedTolls += points.length
      }

      // Gares que le regroupement ne produit plus : supprimées seulement si
      // rien ne les référence (ni prix, ni alias).
      const deleted: unknown = await trx
        .from('toll_stations')
        .whereNotIn('id', [...keptIds])
        .whereNotIn('id', trx.from('toll_prices').select('entry_station_id'))
        .whereNotIn(
          'id',
          trx.from('toll_prices').select('exit_station_id').whereNotNull('exit_station_id')
        )
        .whereNotIn('id', trx.from('station_aliases').select('station_id'))
        .delete()
      // Lucid type le retour en tableau mais SQLite renvoie le nombre de lignes
      result.deleted = Array.isArray(deleted) ? Number(deleted[0] ?? 0) : Number(deleted)
    })

    return result
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
