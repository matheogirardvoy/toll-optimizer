import { type DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import TollNetwork from '#models/toll_network'
import TollPrice, { VEHICLE_CLASSES } from '#models/toll_price'
import type { VehicleClass } from '#models/toll_price'
import type TollStation from '#models/toll_station'
import StationResolver from './station_resolver.js'
import type { PriceRow } from './types.js'

export type PriceImportInput = {
  /** Slug du réseau dans `toll_networks` ('area', 'aprr', 'sanef'…). */
  networkSlug: string

  /** Lignes pivot produites par le parseur de la grille. */
  rows: PriceRow[]

  /** Date d'entrée en vigueur de la grille (1er février, en général). */
  validFrom: DateTime

  /** Grille publiée en un seul sens par couple : insérer aussi le sens retour. */
  symmetric?: boolean
}

export type UnmatchedStation = {
  name: string
  code: string | null
  reason: 'not_found' | 'ambiguous'
}

export type PriceAnomaly = {
  entry: string
  exit: string | null
  vehicleClass: VehicleClass
  priceCents: number
  conflictingPriceCents: number
}

export type PriceImportReport = {
  inserted: number

  /** Lignes écartées faute d'avoir résolu leurs gares (détail dans `unmatched`). */
  skippedRows: number

  /** Libellés de gares sans correspondance dans le référentiel (dédupliqués). */
  unmatched: UnmatchedStation[]

  /** Même couple/classe publié deux fois avec des prix différents. */
  conflicts: PriceAnomaly[]

  /** A→B et B→A publiés avec des prix différents (suspicion d'erreur d'extraction). */
  asymmetries: PriceAnomaly[]

  /** Deux libellés distincts résolus vers la même gare : matching à vérifier. */
  selfPairs: { entry: string; exit: string }[]

  /** Prix rejetés (montant négatif ou non entier — zéro est légitime : section gratuite). */
  invalidPrices: {
    entry: string
    exit: string | null
    vehicleClass: VehicleClass
    priceCents: number
  }[]

  /** Couples dont la grille ne couvre pas les cinq classes. */
  incompletePairs: { entry: string; exit: string | null; missingClasses: VehicleClass[] }[]
}

type ResolvedEntry = {
  entryStationId: number
  exitStationId: number | null
  vehicleClass: VehicleClass
  priceCents: number
  distanceMeters: number | null
  entryLabel: string
  exitLabel: string | null
}

/**
 * Pipeline commun à toutes les grilles tarifaires : résolution des gares,
 * expansion symétrique, contrôles de cohérence puis insertion transactionnelle
 * avec gestion des périodes de validité. Seule l'extraction du PDF (le
 * parseur) est spécifique à chaque concessionnaire.
 */
export default class PriceImportPipeline {
  async run(input: PriceImportInput): Promise<PriceImportReport> {
    const network = await TollNetwork.findByOrFail('slug', input.networkSlug)

    const resolver = new StationResolver(network.id)
    await resolver.load()

    const report: PriceImportReport = {
      inserted: 0,
      skippedRows: 0,
      unmatched: [],
      conflicts: [],
      asymmetries: [],
      selfPairs: [],
      invalidPrices: [],
      incompletePairs: [],
    }

    const unmatchedKeys = new Set<string>()
    const adopted = new Map<number, TollStation>()
    const entries = new Map<string, ResolvedEntry>()

    const keyOf = (entryId: number, exitId: number | null, vehicleClass: VehicleClass) =>
      `${entryId}|${exitId ?? 'fixed'}|${vehicleClass}`

    const reportUnmatched = (ref: UnmatchedStation) => {
      const key = `${ref.name}|${ref.code ?? ''}`
      if (unmatchedKeys.has(key)) return
      unmatchedKeys.add(key)
      report.unmatched.push(ref)
    }

    const resolveRef = (name: string, code: string | null): TollStation | null => {
      const resolution = resolver.resolve({ name, code })
      if (resolution.station === null) {
        reportUnmatched({ name, code, reason: resolution.failure })
        return null
      }

      const station = resolution.station
      // Adoption : la première grille qui reconnaît une gare encore orpheline
      // la rattache à son réseau et lui pose son code concessionnaire.
      if (station.networkId === null) {
        station.networkId = network.id
        station.operatorCode = code
        adopted.set(station.id, station)
        if (code !== null) resolver.registerCode(code, station)
      } else if (
        station.networkId === network.id &&
        station.operatorCode === null &&
        code !== null
      ) {
        station.operatorCode = code
        adopted.set(station.id, station)
        resolver.registerCode(code, station)
      }

      return station
    }

    for (const row of input.rows) {
      if (!Number.isInteger(row.priceCents) || row.priceCents < 0) {
        report.invalidPrices.push({
          entry: row.entryName,
          exit: row.exitName,
          vehicleClass: row.vehicleClass,
          priceCents: row.priceCents,
        })
        report.skippedRows++
        continue
      }

      const entry = resolveRef(row.entryName, row.entryCode)
      const exit = row.exitName === null ? null : resolveRef(row.exitName, row.exitCode)
      if (entry === null || (row.exitName !== null && exit === null)) {
        report.skippedRows++
        continue
      }

      if (exit !== null && exit.id === entry.id) {
        report.selfPairs.push({ entry: row.entryName, exit: row.exitName! })
        report.skippedRows++
        continue
      }

      const key = keyOf(entry.id, exit?.id ?? null, row.vehicleClass)
      const existing = entries.get(key)
      if (existing) {
        if (existing.priceCents !== row.priceCents) {
          report.conflicts.push({
            entry: row.entryName,
            exit: row.exitName,
            vehicleClass: row.vehicleClass,
            priceCents: row.priceCents,
            conflictingPriceCents: existing.priceCents,
          })
        }
        continue
      }

      entries.set(key, {
        entryStationId: entry.id,
        exitStationId: exit?.id ?? null,
        vehicleClass: row.vehicleClass,
        priceCents: row.priceCents,
        distanceMeters: row.distanceMeters,
        entryLabel: row.entryName,
        exitLabel: row.exitName,
      })
    }

    if (input.symmetric) {
      for (const entry of [...entries.values()]) {
        if (entry.exitStationId === null) continue
        const reverseKey = keyOf(entry.exitStationId, entry.entryStationId, entry.vehicleClass)
        if (entries.has(reverseKey)) continue
        entries.set(reverseKey, {
          ...entry,
          entryStationId: entry.exitStationId,
          exitStationId: entry.entryStationId,
          entryLabel: entry.exitLabel ?? entry.entryLabel,
          exitLabel: entry.entryLabel,
        })
      }
    }

    for (const entry of entries.values()) {
      // Une seule vérification par paire non ordonnée
      if (entry.exitStationId === null || entry.entryStationId >= entry.exitStationId) continue
      const reverse = entries.get(
        keyOf(entry.exitStationId, entry.entryStationId, entry.vehicleClass)
      )
      if (reverse && reverse.priceCents !== entry.priceCents) {
        report.asymmetries.push({
          entry: entry.entryLabel,
          exit: entry.exitLabel,
          vehicleClass: entry.vehicleClass,
          priceCents: entry.priceCents,
          conflictingPriceCents: reverse.priceCents,
        })
      }
    }

    const coverage = new Map<
      string,
      { entry: string; exit: string | null; classes: Set<VehicleClass> }
    >()
    for (const entry of entries.values()) {
      const pairKey = `${entry.entryStationId}|${entry.exitStationId ?? 'fixed'}`
      let pair = coverage.get(pairKey)
      if (!pair) {
        pair = { entry: entry.entryLabel, exit: entry.exitLabel, classes: new Set() }
        coverage.set(pairKey, pair)
      }
      pair.classes.add(entry.vehicleClass)
    }
    for (const pair of coverage.values()) {
      const missingClasses = VEHICLE_CLASSES.filter((klass) => !pair.classes.has(klass))
      if (missingClasses.length > 0) {
        report.incompletePairs.push({ entry: pair.entry, exit: pair.exit, missingClasses })
      }
    }

    const validFrom = input.validFrom.startOf('day')
    const validFromDate = validFrom.toISODate()
    if (!validFromDate) {
      throw new Error('Date de validité de la grille invalide')
    }
    const previousPeriodEnd = validFrom.minus({ days: 1 }).toISODate()

    await db.transaction(async (trx) => {
      for (const station of adopted.values()) {
        station.useTransaction(trx)
        await station.save()
      }

      // Ré-import idempotent : une grille déjà chargée à cette date est remplacée
      await trx
        .from('toll_prices')
        .where('network_id', network.id)
        .where('valid_from', validFromDate)
        .delete()

      // Clôture de la grille précédente encore ouverte
      await trx
        .from('toll_prices')
        .where('network_id', network.id)
        .where('valid_from', '<', validFromDate)
        .where((query) => {
          query.whereNull('valid_to').orWhere('valid_to', '>=', validFromDate)
        })
        .update({ valid_to: previousPeriodEnd })

      const rows = [...entries.values()].map((entry) => ({
        networkId: network.id,
        entryStationId: entry.entryStationId,
        exitStationId: entry.exitStationId,
        vehicleClass: entry.vehicleClass,
        priceCents: entry.priceCents,
        distanceMeters: entry.distanceMeters,
        validFrom,
        validTo: null,
      }))

      // Insertion par lots pour rester sous les limites de paramètres SQLite.
      const chunkSize = 200
      for (let i = 0; i < rows.length; i += chunkSize) {
        await TollPrice.createMany(rows.slice(i, i + chunkSize), { client: trx })
      }

      report.inserted = rows.length
    })

    return report
  }
}
