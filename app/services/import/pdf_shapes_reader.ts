import { readFile } from 'node:fs/promises'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

export type PdfFilledRectangle = {
  x: number
  y: number
  w: number
  h: number

  /** Couleur de remplissage active (« #rrggbb ») au moment du tracé. */
  fill: string | null
}

/**
 * Opcodes des sous-chemins de `constructPath` (enum DrawOPS de pdf.js) :
 * vérifiés empiriquement sur la version épinglée dans package-lock.
 */
const MOVE_TO = 0
const LINE_TO = 1
const CURVE_TO = 2
const CLOSE_PATH = 4

type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

function multiply(m: Matrix, n: number[]): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

/**
 * Extraction mutualisée des rectangles pleins d'un PDF (bordures de cellules,
 * fonds grisés…), page par page, dans le même repère que le texte de
 * `readPdfTextLines` (les matrices de transformation sont suivies et
 * appliquées). Les parseurs de grilles matricielles s'en servent pour
 * reconstituer la géométrie des cellules quand le texte seul est ambigu.
 */
export async function readPdfFilledRectangles(filePath: string): Promise<PdfFilledRectangle[][]> {
  const data = new Uint8Array(await readFile(filePath))
  const documentTask = getDocument({ data, verbosity: 0 })
  const pdf = await documentTask.promise

  try {
    const pages: PdfFilledRectangle[][] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const operators = await page.getOperatorList()

      let ctm = IDENTITY
      const stack: Matrix[] = []
      let fill: string | null = null
      const rectangles: PdfFilledRectangle[] = []

      for (let i = 0; i < operators.fnArray.length; i++) {
        const fn = operators.fnArray[i]
        const args = operators.argsArray[i] as unknown[]

        if (fn === OPS.save) {
          stack.push(ctm)
        } else if (fn === OPS.restore) {
          ctm = stack.pop() ?? IDENTITY
        } else if (fn === OPS.transform) {
          ctm = multiply(ctm, args as number[])
        } else if (fn === OPS.setFillRGBColor) {
          fill = String(args[0] ?? args)
        } else if (fn === OPS.constructPath) {
          for (const subPath of (args[1] ?? []) as ArrayLike<number>[]) {
            collectQuads(subPath, ctm, fill, rectangles)
          }
        }
      }

      pages.push(rectangles)
      page.cleanup()
    }
    return pages
  } finally {
    await documentTask.destroy()
  }
}

export type PdfSegment = {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * Extraction mutualisée des segments de droite d'un PDF (bordures de
 * tableaux tracées trait par trait), page par page, dans le repère du
 * texte. Complète `readPdfFilledRectangles` pour les grilles dont les
 * cellules ne sont pas des rectangles fermés.
 */
export async function readPdfSegments(filePath: string): Promise<PdfSegment[][]> {
  const data = new Uint8Array(await readFile(filePath))
  const documentTask = getDocument({ data, verbosity: 0 })
  const pdf = await documentTask.promise

  try {
    const pages: PdfSegment[][] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const operators = await page.getOperatorList()

      let ctm = IDENTITY
      const stack: Matrix[] = []
      const segments: PdfSegment[] = []

      for (let i = 0; i < operators.fnArray.length; i++) {
        const fn = operators.fnArray[i]
        const args = operators.argsArray[i] as unknown[]

        if (fn === OPS.save) {
          stack.push(ctm)
        } else if (fn === OPS.restore) {
          ctm = stack.pop() ?? IDENTITY
        } else if (fn === OPS.transform) {
          ctm = multiply(ctm, args as number[])
        } else if (fn === OPS.constructPath) {
          for (const subPath of (args[1] ?? []) as ArrayLike<number>[]) {
            collectSegments(subPath, ctm, segments)
          }
        }
      }

      pages.push(segments)
      page.cleanup()
    }
    return pages
  } finally {
    await documentTask.destroy()
  }
}

/** Décompose un sous-chemin en segments consécutifs (y compris l'arête de fermeture). */
function collectSegments(subPath: ArrayLike<number>, ctm: Matrix, out: PdfSegment[]) {
  let index = 0
  let start: [number, number] | null = null
  let previous: [number, number] | null = null

  while (index < subPath.length) {
    const op = subPath[index]
    if (op === MOVE_TO || op === LINE_TO) {
      const x = subPath[index + 1]
      const y = subPath[index + 2]
      const point: [number, number] = [
        ctm[0] * x + ctm[2] * y + ctm[4],
        ctm[1] * x + ctm[3] * y + ctm[5],
      ]
      if (op === MOVE_TO) {
        start = point
      } else if (previous !== null) {
        out.push({ x1: previous[0], y1: previous[1], x2: point[0], y2: point[1] })
      }
      previous = point
      index += 3
    } else if (op === CURVE_TO) {
      previous = null
      index += 7
    } else if (op === CLOSE_PATH) {
      if (previous !== null && start !== null) {
        out.push({ x1: previous[0], y1: previous[1], x2: start[0], y2: start[1] })
      }
      previous = null
      index += 1
    } else {
      index += 1
    }
  }
}

/**
 * Parcourt un sous-chemin et enregistre chaque boucle fermée à quatre points
 * comme un rectangle aligné (boîte englobante des points transformés).
 */
function collectQuads(
  subPath: ArrayLike<number>,
  ctm: Matrix,
  fill: string | null,
  out: PdfFilledRectangle[]
) {
  let index = 0
  let points: [number, number][] = []

  while (index < subPath.length) {
    const op = subPath[index]
    if (op === MOVE_TO || op === LINE_TO) {
      const x = subPath[index + 1]
      const y = subPath[index + 2]
      points.push([ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]])
      index += 3
    } else if (op === CURVE_TO) {
      index += 7
    } else if (op === CLOSE_PATH) {
      if (points.length === 4) {
        const xs = points.map((point) => point[0])
        const ys = points.map((point) => point[1])
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        out.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, fill })
      }
      points = []
      index += 1
    } else {
      index += 1
    }
  }
}
