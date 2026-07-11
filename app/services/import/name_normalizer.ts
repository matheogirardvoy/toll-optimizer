/**
 * Abréviations rencontrées dans les grilles publiées, développées vers la
 * forme longue du référentiel (« ST QUENTIN FAL. » → « SAINT QUENTIN
 * FALLAVIER »). Les mots ambigus (« BAR »…) sont volontairement exclus :
 * les cas restants relèvent de la table `station_aliases`.
 */
const ABBREVIATIONS = new Map<string, string>([
  ['ST', 'SAINT'],
  ['STE', 'SAINTE'],
  ['FAL', 'FALLAVIER'],
])

/**
 * Article en tête de libellé, souvent omis par les grilles :
 * « L'Isle d'Abeau Centre » est publié « ISLE D'ABEAU CENTRE » par AREA.
 */
const LEADING_ARTICLE = /^(?:LE|LA|LES|L) /

/**
 * Forme canonique d'un nom de gare pour le rapprochement grille ↔ référentiel :
 * majuscules sans accents, mentions entre parenthèses supprimées
 * (« Voiron (Champfeuillet) » → « VOIRON »), ponctuation aplatie,
 * abréviations développées, article initial retiré.
 */
export function normalizeStationName(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/Œ/g, 'OE')
    .replace(/Æ/g, 'AE')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()

  const expanded = cleaned
    .split(' ')
    .map((word) => ABBREVIATIONS.get(word) ?? word)
    .join(' ')

  return expanded.replace(LEADING_ARTICLE, '')
}
