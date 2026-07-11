import { readFile, writeFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import type { PriceAnomaly, PriceImportReport, UnmatchedStation } from './price_import_pipeline.js'

/**
 * Nombre maximal d'exemples conservés par type d'anomalie : le rapport sert
 * à repérer un problème d'extraction ou de matching, pas à tout lister.
 */
const MAX_ITEMS = 50

export type CappedList<T> = {
  /** Nombre total d'occurrences, y compris celles au-delà de la coupe. */
  total: number
  items: T[]
}

/**
 * Rapport du dernier import de grille, aplati pour être affiché tel quel
 * dans le dashboard admin (dates ISO, listes plafonnées).
 */
export type StoredImportReport = {
  networkSlug: string
  networkName: string
  fileName: string
  validFrom: string
  importedAt: string
  extractedRows: number
  inserted: number
  skippedRows: number
  unmatched: CappedList<UnmatchedStation>
  selfPairs: CappedList<{ entry: string; exit: string }>
  conflicts: CappedList<PriceAnomaly>
  asymmetries: CappedList<PriceAnomaly>
  invalidPrices: CappedList<PriceImportReport['invalidPrices'][number]>
  incompletePairs: CappedList<PriceImportReport['incompletePairs'][number]>
}

function cap<T>(items: T[]): CappedList<T> {
  return { total: items.length, items: items.slice(0, MAX_ITEMS) }
}

export function summarizeReport(input: {
  networkSlug: string
  networkName: string
  fileName: string
  validFrom: string
  extractedRows: number
  report: PriceImportReport
}): StoredImportReport {
  const { report } = input
  return {
    networkSlug: input.networkSlug,
    networkName: input.networkName,
    fileName: input.fileName,
    validFrom: input.validFrom,
    importedAt: new Date().toISOString(),
    extractedRows: input.extractedRows,
    inserted: report.inserted,
    skippedRows: report.skippedRows,
    unmatched: cap(report.unmatched),
    selfPairs: cap(report.selfPairs),
    conflicts: cap(report.conflicts),
    asymmetries: cap(report.asymmetries),
    invalidPrices: cap(report.invalidPrices),
    incompletePairs: cap(report.incompletePairs),
  }
}

/**
 * Persistance du rapport du dernier import : trop volumineux pour le flash
 * de session (stockée en cookie), il est conservé dans `tmp/` à côté de la
 * base et rechargé à chaque affichage du dashboard.
 */
export default class ImportReportStore {
  #path = app.tmpPath('price_import_report.json')

  async load(): Promise<StoredImportReport | null> {
    try {
      return JSON.parse(await readFile(this.#path, 'utf-8')) as StoredImportReport
    } catch {
      return null
    }
  }

  async save(report: StoredImportReport): Promise<void> {
    await writeFile(this.#path, JSON.stringify(report, null, 2))
  }
}
