import { readFile } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export type PdfTextItem = {
  text: string

  /** Coordonnées dans le repère PDF : origine en bas à gauche de la page. */
  x: number
  y: number

  /** Largeur du fragment en unités de page, le long de sa direction. */
  width: number

  /** Rotation du fragment en degrés (0 = horizontal, 45 = diagonale montante…). */
  angleDegrees: number
}

export type PdfTextLine = {
  y: number

  /** Fragments de la ligne, ordonnés de gauche à droite. */
  items: PdfTextItem[]

  /** Contenu textuel de la ligne, fragments joints par un espace. */
  text: string
}

/** Tolérance verticale (points PDF) pour rattacher deux fragments à la même ligne. */
const LINE_Y_TOLERANCE = 2

/**
 * Extraction mutualisée du texte d'un PDF : tous les fragments de chaque
 * page, avec position et angle. Les parseurs de matrices « graphiques »
 * (libellés tournés le long d'une diagonale…) travaillent directement sur
 * ces fragments.
 */
export async function readPdfTextItems(filePath: string): Promise<PdfTextItem[][]> {
  const data = new Uint8Array(await readFile(filePath))
  const documentTask = getDocument({ data, verbosity: 0 })
  const pdf = await documentTask.promise

  try {
    const pages: PdfTextItem[][] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()

      const items: PdfTextItem[] = []
      for (const item of content.items) {
        if (!('str' in item)) continue
        const text = item.str.trim()
        if (text.length === 0) continue
        const [a, b, , , x, y] = item.transform
        items.push({
          text,
          x,
          y,
          width: item.width,
          angleDegrees: (Math.atan2(b, a) * 180) / Math.PI,
        })
      }

      pages.push(items)
      page.cleanup()
    }
    return pages
  } finally {
    await documentTask.destroy()
  }
}

/**
 * Texte d'un PDF reconstruit en lignes ordonnées de haut en bas. Les
 * parseurs de grilles y appliquent ensuite leur logique propre (lecture en
 * liste, en matrice…) — via `text` pour les formats en liste, via `items`
 * et leurs positions pour les matrices où la colonne porte du sens.
 */
export async function readPdfTextLines(filePath: string): Promise<PdfTextLine[][]> {
  const pages = await readPdfTextItems(filePath)
  return pages.map(groupIntoLines)
}

function groupIntoLines(items: PdfTextItem[]): PdfTextLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)

  const lines: { y: number; items: PdfTextItem[] }[] = []
  for (const item of sorted) {
    const current = lines.at(-1)
    if (current && Math.abs(item.y - current.y) <= LINE_Y_TOLERANCE) {
      current.items.push(item)
    } else {
      lines.push({ y: item.y, items: [item] })
    }
  }

  return lines.map((line) => {
    // Le tri de regroupement est (y, x) : deux fragments d'une même ligne
    // décalés d'un point en y peuvent arriver dans le désordre — on
    // garantit l'ordre de lecture gauche → droite.
    const orderedItems = [...line.items].sort((a, b) => a.x - b.x)
    return {
      y: line.y,
      items: orderedItems,
      text: orderedItems.map((item) => item.text).join(' '),
    }
  })
}
