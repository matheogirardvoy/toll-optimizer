import { readPdfTextLines } from '../pdf_text_reader.js'
import type { PdfTextLine } from '../pdf_text_reader.js'
import { readPdfFilledRectangles } from '../pdf_shapes_reader.js'
import type { PdfFilledRectangle } from '../pdf_shapes_reader.js'
import type { PriceGridParser, PriceRow } from '../types.js'
import type { VehicleClass } from '#models/toll_price'

/** Prix Sanef : une décimale (« 12,6 » = 12,60 €), parfois deux. */
const PRICE = /^(\d+),(\d{1,2})$/

/** Badges d'autoroute flottant dans les pages (« A16 », « A26 NORD »…). */
const ROAD_BADGE = /^A\d+(?: NORD| SUD)?$/

/** Numéro de sortie en fin de libellé (« N°6.1 », « N°28 »). */
const EXIT_NUMBER = /\s*N°\s*[\d.]+\s*$/

type Station = { name: string }

/**
 * Grille Sanef : matrice triangulaire « en escalier », une page par classe de
 * véhicule, trois blocs de corridors par page. Chaque ligne porte les prix
 * vers les gares précédentes du bloc, puis le libellé de la gare.
 *
 * Le texte seul est ambigu : certaines gares n'obtiennent jamais de colonne
 * (relations non publiées, cellules grisées ou lignes tronquées). La
 * géométrie des cellules dessinées lève l'ambiguïté : chaque ligne qui
 * s'élargit d'une cellule par rapport à la précédente donne sa nouvelle
 * colonne à la gare de la ligne précédente.
 *
 * Prix symétriques (une cellule par paire) : le pipeline insère les deux
 * sens. Pas de distance tarifaire ni de codes gares dans cette publication.
 * Limite connue : les relations « appendice » publiées hors matrice sous
 * forme libellé + prix isolé (trois par page) sont ignorées.
 */
export default class SanefGridParser implements PriceGridParser {
  readonly networkSlug = 'sanef'
  readonly symmetric = true

  async parse(filePath: string): Promise<PriceRow[]> {
    const [textPages, shapePages] = await Promise.all([
      readPdfTextLines(filePath),
      readPdfFilledRectangles(filePath),
    ])

    const rows: PriceRow[] = []
    for (const [page, textPage] of textPages.entries()) {
      const vehicleClass = findVehicleClass(textPage)
      if (vehicleClass === null) continue
      this.parsePage(textPage, shapePages[page] ?? [], vehicleClass, rows)
    }
    return rows
  }

  private parsePage(
    lines: PdfTextLine[],
    shapes: PdfFilledRectangle[],
    vehicleClass: VehicleClass,
    rows: PriceRow[]
  ) {
    let stations: Station[] = []
    let owners: Station[] = []
    let previousCellCount = 0

    for (const line of lines) {
      const items = line.items.filter((item) => !ROAD_BADGE.test(item.text))
      if (items.length === 0) continue

      const prices: { x: number; cents: number }[] = []
      const labelParts: string[] = []
      for (const item of items) {
        const match = PRICE.exec(item.text)
        if (match) {
          const decimals = match[2]
          const cents = Number(match[1]) * 100 + Number(decimals) * (decimals.length === 1 ? 10 : 1)
          prices.push({ x: item.x, cents })
        } else {
          labelParts.push(item.text)
        }
      }
      const label = labelParts.join(' ').replace(EXIT_NUMBER, '').trim()

      if (
        label.includes('TARIFS DE PEAGE') ||
        /^CLASSE\b/.test(label) ||
        /^AUTOROUTES/.test(label)
      ) {
        continue
      }

      // Complément de libellé sur sa propre ligne (« (péage d'Haudricourt) ») :
      // purement parenthétique, sans incidence sur le rapprochement — ignoré.
      if (prices.length === 0 && label.startsWith('(')) continue

      // Nouveau bloc : libellé seul collé à la marge gauche.
      if (prices.length === 0 && items[0].x < 15) {
        stations = [{ name: label }]
        owners = []
        previousCellCount = 0
        continue
      }

      if (stations.length === 0) continue

      // Relations « appendice » publiées hors matrice (libellé avant le prix).
      if (prices.length > 0 && !PRICE.test(items[0].text)) continue

      const grid = cellGridAt(shapes, line.y + 2)
      if (grid === null) continue

      if (grid.cellCount === previousCellCount + 1) {
        owners.push(stations[stations.length - 1])
      } else if (grid.cellCount !== previousCellCount) {
        throw new Error(
          `Grille Sanef inattendue : « ${label} » passe de ${previousCellCount} à ${grid.cellCount} colonnes`
        )
      }

      const station: Station = { name: label }
      for (const price of prices) {
        const column = Math.floor((price.x - grid.origin) / grid.cellWidth)
        const owner = owners[column]
        if (owner === undefined) {
          throw new Error(
            `Grille Sanef inattendue : prix hors colonne pour « ${label} » (colonne ${column})`
          )
        }
        rows.push({
          entryName: station.name,
          exitName: owner.name,
          entryCode: null,
          exitCode: null,
          vehicleClass,
          priceCents: price.cents,
          distanceMeters: null,
        })
      }

      stations.push(station)
      previousCellCount = grid.cellCount
    }
  }
}

function findVehicleClass(lines: PdfTextLine[]): VehicleClass | null {
  for (const line of lines) {
    const match = /^CLASSE\s+([1-5])$/.exec(line.text)
    if (match) return Number(match[1]) as VehicleClass
  }
  return null
}

/**
 * Grille de cellules d'une ligne de la matrice : bordures verticales
 * traversant l'ordonnée donnée, dédupliquées (les jonctions de corridors
 * dessinent des doubles traits).
 */
function cellGridAt(
  shapes: PdfFilledRectangle[],
  midY: number
): { cellCount: number; origin: number; cellWidth: number } | null {
  const boundaries: number[] = []
  const crossing = shapes
    .filter((shape) => shape.w <= 2 && shape.y <= midY && shape.y + shape.h >= midY)
    .map((shape) => shape.x)
    .sort((a, b) => a - b)
  for (const x of crossing) {
    if (boundaries.length === 0 || x - boundaries[boundaries.length - 1] > 4) {
      boundaries.push(x)
    }
  }

  if (boundaries.length < 2) return null
  const origin = boundaries[0]
  const cellCount = boundaries.length - 1
  return { cellCount, origin, cellWidth: (boundaries[boundaries.length - 1] - origin) / cellCount }
}
