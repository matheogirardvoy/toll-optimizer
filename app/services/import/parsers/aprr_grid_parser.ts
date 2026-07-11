import { VEHICLE_CLASSES } from '#models/toll_price'
import { readPdfTextLines } from '../pdf_text_reader.js'
import { parseAmountCents, parseKilometersToMeters } from '../french_numbers.js'
import { OPEN_SYSTEM_EXIT_LABEL } from '../types.js'
import type { PriceGridParser, PriceRow } from '../types.js'

/**
 * Grille APRR : même tableau que la grille AREA (une ligne par couple
 * orienté, les deux sens publiés) mais sans codes gares, et avec le « € »
 * dans une cellule séparée du montant. Une ligne de données fait donc
 * 13 cellules :
 *   gare d'entrée · gare de sortie · distance km · 5 × (montant · €).
 * Les prix fixes du système ouvert passent par la même pseudo-gare de
 * sortie « Système Ouvert » que chez AREA.
 */
export default class AprrGridParser implements PriceGridParser {
  readonly networkSlug = 'aprr'
  readonly symmetric = false

  async parse(filePath: string): Promise<PriceRow[]> {
    const pages = await readPdfTextLines(filePath)
    const rows: PriceRow[] = []

    for (const lines of pages) {
      for (const line of lines) {
        if (line.items.length !== 13) continue
        const cells = line.items.map((item) => item.text)

        const [entryName, exitName, distance] = cells
        const distanceMeters = parseKilometersToMeters(distance)
        if (distanceMeters === null) continue

        const priceCents: number[] = []
        for (let index = 3; index < cells.length; index += 2) {
          if (cells[index + 1] !== '€') break
          const cents = parseAmountCents(cells[index])
          if (cents === null) break
          priceCents.push(cents)
        }
        if (priceCents.length !== VEHICLE_CLASSES.length) continue

        const openSystem = exitName === OPEN_SYSTEM_EXIT_LABEL
        for (const vehicleClass of VEHICLE_CLASSES) {
          rows.push({
            entryName,
            exitName: openSystem ? null : exitName,
            entryCode: null,
            exitCode: null,
            vehicleClass,
            priceCents: priceCents[vehicleClass - 1],
            distanceMeters,
          })
        }
      }
    }

    return rows
  }
}
