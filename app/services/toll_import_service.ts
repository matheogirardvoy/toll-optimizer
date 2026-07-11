import proj4 from 'proj4'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Toll from '#models/toll'

/**
 * Définition de la projection Lambert 93 (EPSG:2154) utilisée par le référentiel
 * routier français. Les coordonnées `x`/`y` du CSV sont exprimées dans ce système
 * et doivent être reprojetées en WGS84 (EPSG:4326) pour être affichées par Mapbox.
 */
proj4.defs(
  'EPSG:2154',
  '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 ' +
    '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
)

const DATASET_SLUG = 'gares-de-peage-du-reseau-routier-national-concede'
const DATASET_API = `https://www.data.gouv.fr/api/1/datasets/${DATASET_SLUG}/`

/**
 * Colonnes attendues dans le CSV source (séparateur `;`, décimales à la virgule).
 * En-tête réel :
 *   dateReferentiel;route;pr;depPr;concessionPr;abs;cumul;x;y;z;cote;nomGare;typeGare;typeGare_lib;nbVoies
 */
type TollRecord = {
  referenceDate: DateTime | null
  road: string | null
  milestone: number | null
  milestoneDepartment: number | null
  concession: string | null
  offsetMeters: number | null
  cumulativeMeters: number | null
  lambertX: number
  lambertY: number
  elevation: number | null
  side: string | null
  name: string
  gateType: string | null
  gateTypeLabel: string | null
  laneCount: number | null
  longitude: number
  latitude: number
}

export type ImportResult = {
  imported: number
  skipped: number
}

export default class TollImportService {
  /**
   * Importe le contenu d'un CSV (chaîne brute) dans la table `tolls`.
   * L'opération est idempotente : la table est vidée puis re-remplie dans une
   * seule transaction, ce qui reflète la nature « référentiel » du jeu de données.
   */
  async importFromCsv(content: string): Promise<ImportResult> {
    const { records, skipped } = this.parse(content)

    await db.transaction(async (trx) => {
      await trx.from('tolls').delete()

      // Insertion par lots pour rester sous les limites de paramètres SQLite.
      const chunkSize = 200
      for (let i = 0; i < records.length; i += chunkSize) {
        await Toll.createMany(records.slice(i, i + chunkSize), { client: trx })
      }
    })

    return { imported: records.length, skipped }
  }

  /**
   * Récupère automatiquement la dernière ressource CSV publiée sur data.gouv.fr
   * puis l'importe.
   */
  async importFromDataGouv(): Promise<ImportResult> {
    const url = await this.resolveLatestCsvUrl()
    if (!url) {
      throw new Error('Aucune ressource CSV trouvée sur la page du jeu de données data.gouv.fr')
    }

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Téléchargement du CSV échoué (HTTP ${response.status})`)
    }

    return this.importFromCsv(await response.text())
  }

  /**
   * Interroge l'API data.gouv.fr et renvoie l'URL de la ressource CSV la plus récente.
   */
  async resolveLatestCsvUrl(): Promise<string | null> {
    const response = await fetch(DATASET_API)
    if (!response.ok) {
      throw new Error(`Accès à l'API data.gouv.fr échoué (HTTP ${response.status})`)
    }

    const payload = (await response.json()) as {
      resources?: Array<{ format?: string; url?: string; last_modified?: string; created_at?: string }>
    }

    const csvResources = (payload.resources ?? [])
      .filter((resource) => (resource.format ?? '').toLowerCase() === 'csv' && resource.url)
      .sort((a, b) => this.resourceDate(b) - this.resourceDate(a))

    return csvResources[0]?.url ?? null
  }

  private resourceDate(resource: { last_modified?: string; created_at?: string }): number {
    return new Date(resource.last_modified ?? resource.created_at ?? 0).getTime()
  }

  /**
   * Parse le CSV en enregistrements prêts à insérer. Les lignes dont les
   * coordonnées sont inexploitables sont ignorées et comptées dans `skipped`.
   */
  private parse(content: string): { records: TollRecord[]; skipped: number } {
    const lines = content
      .replace(/^﻿/, '') // BOM éventuel
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)

    if (lines.length <= 1) {
      return { records: [], skipped: 0 }
    }

    const header = lines[0].split(';').map((h) => h.trim())
    const col = (name: string) => header.indexOf(name)

    const idx = {
      referenceDate: col('dateReferentiel'),
      road: col('route'),
      milestone: col('pr'),
      milestoneDepartment: col('depPr'),
      concession: col('concessionPr'),
      offsetMeters: col('abs'),
      cumulativeMeters: col('cumul'),
      x: col('x'),
      y: col('y'),
      z: col('z'),
      side: col('cote'),
      name: col('nomGare'),
      gateType: col('typeGare'),
      gateTypeLabel: col('typeGare_lib'),
      laneCount: col('nbVoies'),
    }

    const records: TollRecord[] = []
    let skipped = 0

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(';')

      const lambertX = this.toNumber(cells[idx.x])
      const lambertY = this.toNumber(cells[idx.y])
      const name = (cells[idx.name] ?? '').trim()

      // Sans coordonnées valides, le péage est inutilisable sur la carte.
      if (lambertX === null || lambertY === null || name.length === 0) {
        skipped++
        continue
      }

      const [longitude, latitude] = proj4('EPSG:2154', 'EPSG:4326', [lambertX, lambertY])
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        skipped++
        continue
      }

      records.push({
        referenceDate: this.toDate(cells[idx.referenceDate]),
        road: this.toText(cells[idx.road]),
        milestone: this.toInteger(cells[idx.milestone]),
        milestoneDepartment: this.toInteger(cells[idx.milestoneDepartment]),
        concession: this.toText(cells[idx.concession]),
        offsetMeters: this.toInteger(cells[idx.offsetMeters]),
        cumulativeMeters: this.toInteger(cells[idx.cumulativeMeters]),
        lambertX,
        lambertY,
        elevation: this.toNumber(cells[idx.z]),
        side: this.toText(cells[idx.side]),
        name,
        gateType: this.toText(cells[idx.gateType]),
        gateTypeLabel: this.toText(cells[idx.gateTypeLabel]),
        laneCount: this.toInteger(cells[idx.laneCount]),
        longitude,
        latitude,
      })
    }

    return { records, skipped }
  }

  private toNumber(value?: string): number | null {
    if (value === undefined) return null
    const parsed = Number.parseFloat(value.trim().replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }

  private toInteger(value?: string): number | null {
    const parsed = this.toNumber(value)
    return parsed === null ? null : Math.round(parsed)
  }

  private toText(value?: string): string | null {
    const trimmed = (value ?? '').trim()
    return trimmed.length > 0 ? trimmed : null
  }

  private toDate(value?: string): DateTime | null {
    const trimmed = (value ?? '').trim()
    if (!trimmed) return null
    const parsed = DateTime.fromFormat(trimmed, 'dd/MM/yyyy')
    return parsed.isValid ? parsed : null
  }
}
