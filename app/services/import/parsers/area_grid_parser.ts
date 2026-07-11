import { VEHICLE_CLASSES } from '#models/toll_price'
import { readPdfTextLines } from '../pdf_text_reader.js'
import { parseAmountCents, parseKilometersToMeters } from '../french_numbers.js'
import { OPEN_SYSTEM_EXIT_LABEL } from '../types.js'
import type { PriceGridParser, PriceRow } from '../types.js'

const CODE = /^\d{3,6}$/

/** Pseudo-gare « Système Ouvert » : AREA lui donne aussi un code dédié. */
const OPEN_SYSTEM_CODE = '3400'

/**
 * Grille AREA : tableau « une ligne par couple orienté » (les deux sens sont
 * publiés) avec les codes gares du concessionnaire. Chaque cellule du PDF est
 * un fragment de texte distinct, la lecture se fait donc par cellules :
 *   code entrée · gare d'entrée · code sortie · gare de sortie ·
 *   distance tarifaire en km · un prix par classe (1 à 5).
 * Les en-têtes, titres et pieds de page ne passent pas les gardes de format.
 */
export default class AreaGridParser implements PriceGridParser {
  readonly networkSlug = 'area'
  readonly symmetric = false

  async parse(filePath: string): Promise<PriceRow[]> {
    const pages = await readPdfTextLines(filePath)
    const rows: PriceRow[] = []

    for (const lines of pages) {
      for (const line of lines) {
        if (line.items.length !== 10) continue
        const cells = line.items.map((item) => item.text)

        const [entryCode, entryName, exitCode, exitName, distance] = cells
        if (!CODE.test(entryCode) || !CODE.test(exitCode)) continue

        const distanceMeters = parseKilometersToMeters(distance)
        if (distanceMeters === null) continue

        const priceCents: number[] = []
        for (const cell of cells.slice(5)) {
          const cents = parseAmountCents(cell.replace(/\s*€$/, ''))
          if (cents !== null) priceCents.push(cents)
        }
        if (priceCents.length !== VEHICLE_CLASSES.length) continue

        const openSystem = exitCode === OPEN_SYSTEM_CODE || exitName === OPEN_SYSTEM_EXIT_LABEL

        for (const vehicleClass of VEHICLE_CLASSES) {
          rows.push({
            entryName,
            exitName: openSystem ? null : exitName,
            entryCode,
            exitCode: openSystem ? null : exitCode,
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
