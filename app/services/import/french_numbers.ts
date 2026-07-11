/**
 * Conversions numériques partagées par les parseurs de grilles : les
 * concessionnaires publient tous des montants et distances à la française
 * (virgule décimale).
 */

/** « 58,20 » → 5820 : montant en euros converti en centimes entiers. */
export function parseAmountCents(text: string): number | null {
  const match = /^(\d+),(\d{2})$/.exec(text)
  if (match === null) return null
  return Number(match[1]) * 100 + Number(match[2])
}

/** « 462,61 » → 462610 : distance en kilomètres convertie en mètres entiers. */
export function parseKilometersToMeters(text: string): number | null {
  if (!/^\d+,\d{2}$/.test(text)) return null
  return Math.round(Number(text.replace(',', '.')) * 1000)
}
