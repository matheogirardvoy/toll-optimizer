import db from '@adonisjs/lucid/services/db'
import TollStation from '#models/toll_station'
import TollPrice from '#models/toll_price'
import StationAlias from '#models/station_alias'
import { normalizeStationName } from '#services/import/name_normalizer'

export type MergeReport = {
  fromId: number
  fromName: string
  intoId: number
  intoName: string
  tollsMoved: number
  pricesRepointed: number
  pricesDeleted: number
  aliasAdded: string | null
  renamedTo: string | null
  /** Réseau hérité de la source quand la cible était orpheline. */
  adoptedNetworkId: number | null
}

/** Sentinelle pour annuler la transaction en mode simulation. */
class DryRunRollback extends Error {}

/**
 * Fusionne une gare logique dans une autre : déplace ses points physiques
 * (`tolls`), replie ses prix sur la cible en dédoublonnant sur la clé d'unicité
 * `(network, entrée, sortie, classe, valid_from)` (et sans jamais créer de prix
 * d'une gare vers elle-même), reprend ses alias, ajoute son libellé comme alias
 * vers la cible (pour les futurs imports de grille), puis la supprime.
 *
 * Sert à réconcilier les doublons du référentiel : deux sens d'une même barrière
 * restés séparés, ou une gare « fantôme » de grille (sans point physique)
 * doublonnant une gare réelle.
 */
export default class StationMergeService {
  async merge(options: {
    fromId: number
    intoId: number
    newName?: string
    dryRun?: boolean
  }): Promise<MergeReport> {
    const from = await TollStation.find(options.fromId)
    const into = await TollStation.find(options.intoId)
    if (from === null) throw new Error(`Gare source ${options.fromId} introuvable`)
    if (into === null) throw new Error(`Gare cible ${options.intoId} introuvable`)
    if (from.id === into.id) throw new Error('Source et cible identiques')

    const report: MergeReport = {
      fromId: from.id,
      fromName: from.name,
      intoId: into.id,
      intoName: into.name,
      tollsMoved: 0,
      pricesRepointed: 0,
      pricesDeleted: 0,
      aliasAdded: null,
      renamedTo: null,
      adoptedNetworkId: null,
    }

    try {
      await db.transaction(async (trx) => {
        // 1) Points physiques : repointés vers la cible.
        const moved: unknown = await trx
          .from('tolls')
          .where('station_id', from.id)
          .update({ station_id: into.id })
        report.tollsMoved = Array.isArray(moved) ? Number(moved[0] ?? 0) : Number(moved)

        // 2) Prix référençant la source (en entrée ou en sortie) : repliés sur
        //    la cible, en dédoublonnant sur la clé d'unicité.
        const rows = await TollPrice.query({ client: trx }).where((query) => {
          query.where('entry_station_id', from.id).orWhere('exit_station_id', from.id)
        })
        for (const row of rows) {
          row.useTransaction(trx)
          const newEntry = row.entryStationId === from.id ? into.id : row.entryStationId
          const newExit = row.exitStationId === from.id ? into.id : row.exitStationId

          // Jamais de prix d'une gare vers elle-même.
          if (newExit !== null && newEntry === newExit) {
            await row.delete()
            report.pricesDeleted++
            continue
          }

          const conflict = TollPrice.query({ client: trx })
            .where('network_id', row.networkId)
            .where('entry_station_id', newEntry)
            .where('vehicle_class', row.vehicleClass)
            .where('valid_from', row.validFrom.toISODate()!)
            .whereNot('id', row.id)
          if (newExit === null) conflict.whereNull('exit_station_id')
          else conflict.where('exit_station_id', newExit)

          if ((await conflict.first()) !== null) {
            await row.delete()
            report.pricesDeleted++
          } else {
            row.entryStationId = newEntry
            row.exitStationId = newExit
            await row.save()
            report.pricesRepointed++
          }
        }

        // 3) Adoption réseau : une cible orpheline hérite du réseau (et du code
        //    exploitant) de la source. Cas d'un fantôme de grille — qui porte le
        //    réseau — replié sur les gares du référentiel restées orphelines.
        if (into.networkId === null && from.networkId !== null) {
          into.useTransaction(trx)
          into.networkId = from.networkId
          if (into.operatorCode === null) {
            into.operatorCode = from.operatorCode
          }
          await into.save()
          report.adoptedNetworkId = from.networkId
        }

        // 4) Alias existants de la source : repointés (ou supprimés si doublon).
        const fromAliases = await StationAlias.query({ client: trx }).where('station_id', from.id)
        for (const alias of fromAliases) {
          alias.useTransaction(trx)
          const duplicate = await StationAlias.query({ client: trx })
            .where('network_id', alias.networkId)
            .where('alias', alias.alias)
            .whereNot('id', alias.id)
            .first()
          if (duplicate !== null) {
            await alias.delete()
          } else {
            alias.stationId = into.id
            await alias.save()
          }
        }

        // …et le libellé de la source devient un alias vers la cible.
        if (into.networkId !== null) {
          const normalized = normalizeStationName(from.name)
          const redundant = normalized === '' || normalizeStationName(into.name) === normalized
          if (!redundant) {
            const existing = await StationAlias.query({ client: trx })
              .where('network_id', into.networkId)
              .where('alias', normalized)
              .first()
            if (existing === null) {
              await StationAlias.create(
                { alias: normalized, networkId: into.networkId, stationId: into.id },
                { client: trx }
              )
              report.aliasAdded = normalized
            }
          }
        }

        // 5) Renommage éventuel de la survivante.
        if (options.newName !== undefined && options.newName !== into.name) {
          into.useTransaction(trx)
          into.name = options.newName
          await into.save()
          report.renamedTo = options.newName
        }

        // 6) Suppression de la source.
        from.useTransaction(trx)
        await from.delete()

        if (options.dryRun === true) throw new DryRunRollback()
      })
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error
    }

    return report
  }
}
