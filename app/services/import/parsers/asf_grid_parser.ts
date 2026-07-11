import { readPdfTextItems } from '../pdf_text_reader.js'
import type { PdfTextItem } from '../pdf_text_reader.js'
import { readPdfSegments } from '../pdf_shapes_reader.js'
import type { PriceGridParser, PriceRow } from '../types.js'
import type { VehicleClass } from '#models/toll_price'

const PRICE = /^(\d+)(?:,(\d{1,2}))?$/
const NO_LINK = /^[.·–-]$/
const ROAD_BADGE = /^A\d{1,4}(?: (?:nord|sud))?$/i
const CIRCLED_NUMBER = /^\d+(?:\.\d+)?$/
const LEADING_EXIT_NUMBER = /^\d+(?:\.\d+)?[ab]?\s+/

/** Distance maximale entre deux cellules de texte d'un même bloc. */
const BLOCK_GAP = 16

/**
 * Flèches de destination aux extrémités des escaliers (« Lyon »,
 * « Toulouse Espagne »…) : de simples directions, pas des gares.
 */
const DESTINATION_ARROWS = new Set([
  'lyon',
  'marseille',
  'toulouse',
  'espagne',
  'toulouseespagne',
  'lyonmarseille',
  'bordeaux',
  'brive',
  'albi',
  'montauban',
  'paris',
  'angers',
  'bayonne',
  'stétienne',
  'clermontferrand',
  'clermont',
  'ferrand',
  'larochelle',
  'nantes',
])

/** Fragment de grille : tous ses jetons sont des prix ou des tirets. */
function isGridText(text: string): boolean {
  return text.split(/\s+/).every((token) => PRICE.test(token) || NO_LINK.test(token))
}

type VerticalLine = { x: number; yMin: number; yMax: number }

type HorizontalLine = { y: number; xMin: number; xMax: number }

type GridCell = { text: string; column: number }

type BlockRow = { y: number; boundaries: number[]; cells: GridCell[] }

type Block = {
  rows: BlockRow[]
  pitch: number
  x0: number
  maxX: number

  /** Bord haut de la première ligne de cellules. */
  topY: number
}

type LabelCluster = { center: number; items: PdfTextItem[] }

/**
 * Guide tarifaire ASF : matrices denses par classe de véhicule (une page
 * « CLASSE n » par région), en deux dispositions :
 *   - triangles « en escalier » — libellés de gares tournés à 45° le long de
 *     la diagonale, la ligne k porte les prix vers les k gares précédentes ;
 *   - rectangles croisés — libellés de colonnes tournés à 45° en tête,
 *     libellés de lignes horizontaux sur un côté (liaisons inter-régions).
 * Chaque cellule contient un prix, « 0 » (gratuit) ou « . » (liaison
 * impossible). La grille est tracée trait par trait : les blocs sont
 * reconstruits depuis le texte (matrice dense), puis bornés colonne par
 * colonne grâce aux segments verticaux — ce qui écarte au passage les
 * numéros de sortie cerclés qui jouxtent les cellules. Les libellés tournés
 * sont rattachés par auto-calibration sur le pas de la grille (ajustement
 * linéaire puis balayage de décalage : les flèches de destination aux
 * extrémités des escaliers ne correspondent à aucune gare).
 */
export default class AsfGridParser implements PriceGridParser {
  readonly networkSlug = 'asf'
  readonly symmetric = true

  async parse(filePath: string): Promise<PriceRow[]> {
    const [textPages, segmentPages] = await Promise.all([
      readPdfTextItems(filePath),
      readPdfSegments(filePath),
    ])

    const rows: PriceRow[] = []
    for (const [page, items] of textPages.entries()) {
      const vehicleClass = findVehicleClass(items)
      if (vehicleClass === null) continue

      const segments = segmentPages[page] ?? []
      const verticals: VerticalLine[] = segments
        .filter(
          (segment) =>
            Math.abs(segment.x1 - segment.x2) <= 0.7 && Math.abs(segment.y1 - segment.y2) >= 4
        )
        .map((segment) => ({
          x: (segment.x1 + segment.x2) / 2,
          yMin: Math.min(segment.y1, segment.y2),
          yMax: Math.max(segment.y1, segment.y2),
        }))
      const horizontals: HorizontalLine[] = segments
        .filter(
          (segment) =>
            Math.abs(segment.y1 - segment.y2) <= 0.7 && Math.abs(segment.x1 - segment.x2) >= 4
        )
        .map((segment) => ({
          y: (segment.y1 + segment.y2) / 2,
          xMin: Math.min(segment.x1, segment.x2),
          xMax: Math.max(segment.x1, segment.x2),
        }))

      const blocks = buildBlocks(items, verticals, horizontals)
      for (const block of blocks) {
        this.parseBlock(
          block,
          blocks.filter((other) => other !== block),
          items,
          vehicleClass,
          rows,
          page + 1
        )
      }
    }
    return rows
  }

  private parseBlock(
    block: Block,
    siblings: Block[],
    items: PdfTextItem[],
    vehicleClass: VehicleClass,
    rows: PriceRow[],
    pageNumber: number
  ) {
    const shape = classifyBlock(block)
    if (shape === 'unknown') {
      // Les petits amas inclassables sont des restes de mise en page
      // (encarts, marges) ; un gros bloc illisible est signalé : il
      // représente des données perdues, visibles aussi dans le rapport.
      if (block.rows.length >= 8) {
        console.warn(
          `Grille ASF : bloc ignoré page ${pageNumber} (${block.rows.length} lignes, ` +
            `x≈${Math.round(block.x0)}, y≈${Math.round(block.rows[0].y)}, ` +
            `largeurs ${block.rows.map((row) => row.boundaries.length - 1).join(',')})`
        )
      }
      return
    }

    const entryStations =
      shape === 'triangle'
        ? readDiagonalLabels(block, items, siblings)
        : readRowLabels(block, items, siblings)
    const exitStations = shape === 'triangle' ? entryStations : readColumnLabels(block, items)

    for (const [rowIndex, row] of block.rows.entries()) {
      const entryName = shape === 'triangle' ? entryStations[rowIndex + 1] : entryStations[rowIndex]
      if (entryName === undefined) continue

      for (const cell of row.cells) {
        if (NO_LINK.test(cell.text)) continue
        const match = PRICE.exec(cell.text)
        if (!match) continue
        const exitName = exitStations[cell.column]
        if (exitName === undefined) continue

        const decimals = match[2] ?? '0'
        rows.push({
          entryName,
          exitName,
          entryCode: null,
          exitCode: null,
          vehicleClass,
          priceCents: Number(match[1]) * 100 + Number(decimals) * (decimals.length === 1 ? 10 : 1),
          distanceMeters: null,
        })
      }
    }
  }
}

function findVehicleClass(items: PdfTextItem[]): VehicleClass | null {
  const classes = new Set<number>()
  for (const item of items) {
    const match = /^CLASSE\s+([1-5])$/.exec(item.text)
    if (match && Math.abs(item.angleDegrees) < 5) classes.add(Number(match[1]))
  }
  // Plusieurs classes sur la même page = page de synthèse, pas une grille.
  if (classes.size !== 1) return null
  return [...classes][0] as VehicleClass
}

/**
 * Blocs de matrice reconstruits depuis les cellules de texte (la matrice est
 * dense) : chaque cellule est rattachée à sa ligne par la bordure
 * horizontale qui la souligne, les colonnes sont bornées par les segments
 * verticaux de la grille.
 */
function buildBlocks(
  items: PdfTextItem[],
  verticals: VerticalLine[],
  horizontals: HorizontalLine[]
): Block[] {
  // Sur les pages les plus denses, pdf.js fusionne plusieurs cellules
  // voisines en un seul fragment (« 21,3 21,3 . 20,6 ») : on accepte tout
  // fragment dont chaque jeton est un prix ou un tiret.
  const candidates = items.filter(
    (item) => Math.abs(item.angleDegrees) < 5 && isGridText(item.text)
  )

  // Rattachement à la bordure basse : insensible aux petites variations de
  // ligne de base, et écarte le texte hors grille (numéros de sortie
  // cerclés, notes…).
  const gridItems: { item: PdfTextItem; bottom: number }[] = []
  for (const item of candidates) {
    let bottom = Number.NEGATIVE_INFINITY
    for (const line of horizontals) {
      if (line.xMin - 1 > item.x || line.xMax + 1 < item.x) continue
      if (line.y > item.y + 1) continue
      if (line.y > bottom) bottom = line.y
    }
    if (!Number.isFinite(bottom) || item.y - bottom > 12) continue
    gridItems.push({ item, bottom })
  }

  const assigned = new Array<number>(gridItems.length).fill(-1)
  let clusterCount = 0
  // Les fragments fusionnés s'étendent bien au-delà de leur ancre : la
  // distance de regroupement se mesure entre étendues, pas entre ancres.
  const gap = (a: { item: PdfTextItem }, b: { item: PdfTextItem }) => {
    const dx = Math.max(
      0,
      b.item.x - (a.item.x + a.item.width),
      a.item.x - (b.item.x + b.item.width)
    )
    return Math.max(dx, Math.abs(a.item.y - b.item.y))
  }
  for (let i = 0; i < gridItems.length; i++) {
    if (assigned[i] !== -1) continue
    const queue = [i]
    assigned[i] = clusterCount
    while (queue.length > 0) {
      const current = queue.pop()!
      for (let j = 0; j < gridItems.length; j++) {
        if (assigned[j] !== -1) continue
        if (gap(gridItems[current], gridItems[j]) <= BLOCK_GAP) {
          assigned[j] = clusterCount
          queue.push(j)
        }
      }
    }
    clusterCount++
  }

  const blocks: Block[] = []
  for (let cluster = 0; cluster < clusterCount; cluster++) {
    const members = gridItems.filter((_, index) => assigned[index] === cluster)
    if (members.length < 6) continue

    // Lignes = groupes de cellules partageant la même bordure basse.
    const sorted = [...members].sort((a, b) => b.bottom - a.bottom || a.item.x - b.item.x)
    const rawRows: { bottom: number; items: PdfTextItem[] }[] = []
    for (const member of sorted) {
      const current = rawRows.at(-1)
      if (current && current.bottom - member.bottom <= 1.5) {
        current.items.push(member.item)
      } else {
        rawRows.push({ bottom: member.bottom, items: [member.item] })
      }
    }

    const rows: BlockRow[] = []
    let unbounded = 0
    for (const rawRow of rawRows) {
      const midY = rawRow.bottom + 3
      const crossing = verticals
        .filter((line) => line.yMin <= midY && line.yMax >= midY)
        .map((line) => line.x)
        .sort((a, b) => a - b)
      const rawBoundaries: number[] = []
      for (const x of crossing) {
        if (rawBoundaries.length === 0 || x - rawBoundaries[rawBoundaries.length - 1] > 1.5) {
          rawBoundaries.push(x)
        }
      }

      // Des traits étrangers à la grille traversent parfois la ligne (bande
      // de marge, cadre d'encart…) : on ne retient que la plus longue chaîne
      // de bordures régulièrement espacées couvrant les cellules de texte.
      let boundaries = selectGridChain(rawBoundaries, rawRow.items)
      if (boundaries.length < 2) {
        unbounded++
        continue
      }

      // Chaque jeton d'un fragment fusionné occupe la cellule suivante de
      // celle où le fragment est ancré (grille dense : un jeton par cellule).
      const cells: GridCell[] = []
      let minColumn = Number.POSITIVE_INFINITY
      let maxColumn = -1
      for (const item of rawRow.items) {
        const start = boundaries.findIndex(
          (boundary, index) =>
            index < boundaries.length - 1 && item.x >= boundary && item.x < boundaries[index + 1]
        )
        if (start === -1) continue
        for (const [offset, token] of item.text.split(/\s+/).entries()) {
          const column = start + offset
          if (column >= boundaries.length - 1) break
          cells.push({ text: token, column })
          minColumn = Math.min(minColumn, column)
          maxColumn = Math.max(maxColumn, column)
        }
      }
      if (cells.length === 0) {
        unbounded++
        continue
      }

      // La matrice est dense : les intervalles vides en bord de ligne sont
      // des bordures étrangères (marche d'escalier du bandeau de libellés,
      // trait de marge…). On rogne et on réindexe.
      boundaries = boundaries.slice(minColumn, maxColumn + 2)
      for (const cell of cells) cell.column -= minColumn
      const y = rawRow.items.reduce((sum, item) => sum + item.y, 0) / rawRow.items.length
      rows.push({ y, boundaries, cells })
    }

    // Un bloc dont trop de lignes n'ont pas de grille n'est pas une matrice
    // (tableau annexe, note…)
    if (rows.length < 2 || unbounded > rawRows.length * 0.3) continue

    const spacings: number[] = []
    for (const row of rows) {
      for (let i = 1; i < row.boundaries.length; i++) {
        spacings.push(row.boundaries[i] - row.boundaries[i - 1])
      }
    }
    spacings.sort((a, b) => a - b)
    const pitch = spacings[Math.floor(spacings.length / 2)] ?? 10

    blocks.push({
      rows,
      pitch,
      x0: Math.min(...rows.map((row) => row.boundaries[0])),
      maxX: Math.max(...rows.map((row) => row.boundaries[row.boundaries.length - 1])),
      topY: rows[0].y + pitch,
    })
  }
  return blocks
}

/**
 * Plus longue chaîne de bordures verticales au pas régulier : le pas est
 * estimé par la médiane des écarts plausibles, puis les chaînes candidates
 * sont départagées au nombre de cellules de texte couvertes.
 */
function selectGridChain(candidates: number[], items: PdfTextItem[]): number[] {
  if (candidates.length < 2) return []

  const gaps: number[] = []
  for (let i = 1; i < candidates.length; i++) {
    const gap = candidates[i] - candidates[i - 1]
    if (gap >= 5 && gap <= 20) gaps.push(gap)
  }
  if (gaps.length === 0) return []
  gaps.sort((a, b) => a - b)
  const pitch = gaps[Math.floor(gaps.length / 2)]

  // Les jonctions de corridors sont tracées en double trait : deux bordures
  // à deux ou trois points l'une de l'autre valent une seule limite.
  const merged: number[] = []
  for (const x of candidates) {
    if (merged.length === 0 || x - merged[merged.length - 1] > pitch * 0.45) {
      merged.push(x)
    } else {
      merged[merged.length - 1] = (merged[merged.length - 1] + x) / 2
    }
  }

  const chains: number[][] = []
  let current: number[] = [merged[0]]
  for (let i = 1; i < merged.length; i++) {
    const gap = merged[i] - merged[i - 1]
    if (gap >= pitch * 0.55 && gap <= pitch * 1.45) {
      current.push(merged[i])
    } else {
      chains.push(current)
      current = [merged[i]]
    }
  }
  chains.push(current)

  let best: number[] = []
  let bestCovered = -1
  for (const chain of chains) {
    if (chain.length < 2) continue
    const covered = items.filter(
      (item) => item.x >= chain[0] && item.x < chain[chain.length - 1]
    ).length
    if (covered > bestCovered || (covered === bestCovered && chain.length > best.length)) {
      best = chain
      bestCovered = covered
    }
  }
  return best
}

function classifyBlock(block: Block): 'triangle' | 'rectangle' | 'unknown' {
  const lengths = block.rows.map((row) => row.boundaries.length - 1)
  const triangular = lengths.filter((length, index) => length === index + 1).length
  if (triangular >= lengths.length * 0.9 && lengths[0] === 1) return 'triangle'
  const width = lengths[0]
  if (lengths.every((length) => length === width)) return 'rectangle'
  return 'unknown'
}

/**
 * Libellés d'un triangle : fragments tournés à 45° le long de la diagonale.
 * L'invariant x − y est constant le long d'un même libellé et avance de
 * deux pas de grille par gare — on regroupe donc par x − y avant le calage.
 */
function readDiagonalLabels(
  block: Block,
  items: PdfTextItem[],
  siblings: Block[]
): (string | undefined)[] {
  const stationCount = block.rows.length + 1
  const sCorner = block.x0 + block.topY
  const dMin = block.x0 - block.topY

  const candidates = items.filter((item) => {
    if (item.angleDegrees < 35 || item.angleDegrees > 55) return false
    if (isGridText(item.text)) return false
    const s = item.x + item.y
    const sDelta = s - sCorner
    if (sDelta < -block.pitch || sDelta > 340) return false
    // Plusieurs escaliers peuvent s'empiler sur la page : un fragment
    // appartient au bloc dont la bande diagonale est la plus proche.
    for (const other of siblings) {
      const sDeltaOther = s - (other.x0 + other.topY)
      if (sDeltaOther >= -other.pitch && sDeltaOther < sDelta) return false
    }
    const d = item.x - item.y
    return d >= dMin - 2 * block.pitch && d <= dMin + 2 * block.pitch * (stationCount + 2)
  })

  const clusters = clusterByMeasure(candidates, (item) => item.x - item.y, block.pitch * 0.9)
  return assignClustersToSlots(clusters, stationCount, block.pitch * 2)
}

/** Libellés de colonnes d'un rectangle : fragments tournés au-dessus du bloc. */
function readColumnLabels(block: Block, items: PdfTextItem[]): (string | undefined)[] {
  const columnCount = block.rows[0].boundaries.length - 1

  const candidates = items.filter(
    (item) =>
      item.angleDegrees >= 35 &&
      item.angleDegrees <= 55 &&
      (CIRCLED_NUMBER.test(item.text) || !isGridText(item.text)) &&
      item.y >= block.topY - 2 &&
      item.y <= block.topY + 340 &&
      item.x >= block.x0 - block.pitch &&
      item.x <= block.maxX + 340
  )

  // Un numéro de sortie cerclé précède souvent le nom : on les apparie pour
  // ancrer le libellé au centre de son créneau de colonne.
  const sorted = [...candidates].sort((a, b) => a.x - b.x)
  const clusters: LabelCluster[] = []
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i]
    const next = sorted[i + 1]
    if (
      next !== undefined &&
      CIRCLED_NUMBER.test(item.text) &&
      !CIRCLED_NUMBER.test(next.text) &&
      next.x - item.x <= 9
    ) {
      clusters.push({ center: (item.x + next.x) / 2, items: [item, next] })
      i++
    } else {
      clusters.push({ center: item.x, items: [item] })
    }
  }

  return assignClustersToSlots(clusters, columnCount, block.pitch)
}

/** Libellés de lignes d'un rectangle : texte horizontal sur l'un des côtés. */
function readRowLabels(
  block: Block,
  items: PdfTextItem[],
  siblings: Block[]
): (string | undefined)[] {
  const edgeDistance = (candidate: Block, x: number) =>
    Math.min(Math.abs(x - candidate.x0), Math.abs(x - candidate.maxX))

  const horizontal = items.filter((item) => {
    if (Math.abs(item.angleDegrees) >= 5) return false
    if (ROAD_BADGE.test(item.text) || isGridText(item.text)) return false
    // Deux blocs peuvent cohabiter sur la page : un fragment de libellé
    // appartient au bloc dont le bord est le plus proche de son début.
    const own = edgeDistance(block, item.x)
    return siblings.every((other) => own <= edgeDistance(other, item.x))
  })

  let leftHits = 0
  let rightHits = 0
  const perRow = block.rows.map((row) => {
    const inBand = horizontal.filter(
      (item) => item.y >= row.y - 1.5 && item.y <= row.y + block.pitch - 2
    )
    const left = inBand.filter((item) => item.x < block.x0 - 1 && item.x > block.x0 - 280)
    const right = inBand.filter((item) => item.x > block.maxX + 1 && item.x < block.maxX + 280)
    leftHits += left.length > 0 ? 1 : 0
    rightHits += right.length > 0 ? 1 : 0
    return { left, right }
  })

  const side = rightHits > leftHits ? 'right' : 'left'
  return perRow.map((row) => {
    const fragments = (side === 'right' ? row.right : row.left)
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .filter((text) => !CIRCLED_NUMBER.test(text))
    if (fragments.length === 0) return undefined
    return cleanLabel(fragments.join(' '))
  })
}

function clusterByMeasure(
  items: PdfTextItem[],
  measure: (item: PdfTextItem) => number,
  maxGap: number
): LabelCluster[] {
  const sorted = [...items].sort((a, b) => measure(a) - measure(b))
  const clusters: { min: number; max: number; items: PdfTextItem[] }[] = []
  for (const item of sorted) {
    const value = measure(item)
    const current = clusters.at(-1)
    if (current && value - current.max <= maxGap) {
      current.max = value
      current.items.push(item)
    } else {
      clusters.push({ min: value, max: value, items: [item] })
    }
  }
  return clusters.map((cluster) => ({
    center: (cluster.min + cluster.max) / 2,
    items: cluster.items,
  }))
}

/**
 * Cale des grappes de libellés sur les créneaux 0..count-1 : ajustement
 * linéaire du pas réel (les ancres dérivent légèrement), puis balayage du
 * décalage entier qui couvre le mieux les créneaux.
 */
function assignClustersToSlots(
  clusters: LabelCluster[],
  count: number,
  spacing: number
): (string | undefined)[] {
  // Les flèches de destination sont écartées avant le calage : en bord
  // d'escalier, elles fausseraient l'origine et la pente de l'ajustement.
  const labelled = clusters
    .map((cluster) => {
      const fragments = [...cluster.items]
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .filter((text) => !ROAD_BADGE.test(text))
        // Une flèche de destination peut partager sa diagonale avec un vrai
        // libellé : on l'écarte fragment par fragment.
        .filter((text) => !DESTINATION_ARROWS.has(text.toLowerCase().replace(/[^a-zà-ÿ]+/gu, '')))
        // Certains libellés sont dessinés en double (contour + aplat)
        .filter((text, index, all) => all.indexOf(text) === index)
      return { center: cluster.center, label: cleanLabel(fragments.join(' ')) }
    })
    .filter(
      (cluster) =>
        cluster.label.length > 0 &&
        !/^[\d.]+$/.test(cluster.label) &&
        !DESTINATION_ARROWS.has(cluster.label.toLowerCase().replace(/[^a-zà-ÿ]+/gu, ''))
    )
  if (labelled.length === 0) return new Array<string | undefined>(count).fill(undefined)

  const base = Math.min(...labelled.map((cluster) => cluster.center))
  let slots = labelled.map((cluster) => Math.round((cluster.center - base) / spacing))

  // Ajustement linéaire centre ≈ a + b·créneau, puis réaffectation.
  for (let pass = 0; pass < 2; pass++) {
    const n = labelled.length
    const sumX = slots.reduce((sum, slot) => sum + slot, 0)
    const sumY = labelled.reduce((sum, cluster) => sum + cluster.center, 0)
    const sumXX = slots.reduce((sum, slot) => sum + slot * slot, 0)
    const sumXY = labelled.reduce((sum, cluster, index) => sum + slots[index] * cluster.center, 0)
    const denominator = n * sumXX - sumX * sumX
    if (denominator === 0) break
    const b = (n * sumXY - sumX * sumY) / denominator
    const a = (sumY - b * sumX) / n
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) break
    slots = labelled.map((cluster) => Math.round((cluster.center - a) / b))
  }

  let bestShift = 0
  let bestScore = -1
  for (const shift of [-1, 0, 1, 2]) {
    const covered = new Set<number>()
    let outside = 0
    for (const slot of slots) {
      const index = slot - shift
      if (index >= 0 && index < count) covered.add(index)
      else outside++
    }
    const score = covered.size - outside * 0.4
    if (score > bestScore) {
      bestScore = score
      bestShift = shift
    }
  }

  const labels: (string | undefined)[] = new Array<string | undefined>(count).fill(undefined)
  for (const [clusterIndex, cluster] of labelled.entries()) {
    const index = slots[clusterIndex] - bestShift
    if (index < 0 || index >= count) continue
    const existing = labels[index]
    if (existing === undefined) labels[index] = cluster.label
    else if (!existing.includes(cluster.label)) labels[index] = `${existing} ${cluster.label}`
  }
  return labels
}

function cleanLabel(raw: string): string {
  return (
    raw
      .replace(LEADING_EXIT_NUMBER, '')
      // Les parenthèses discriminantes deviennent des mots à part entière :
      // « (demi-échangeur sud) » distingue deux gares homonymes, alors que
      // le normaliseur de rapprochement ignore les parenthèses.
      .replace(/\((demi-échangeur[^)]*|péage en système[^)]*|système[^)]*)\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  )
}
