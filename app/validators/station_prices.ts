import vine from '@vinejs/vine'

/**
 * Saisie manuelle d'une ligne de prix depuis la fiche gare : un couple gare
 * d'entrée / sortie (ou franchissement seul en système ouvert) et ses cinq
 * classes, à une date d'entrée en vigueur.
 *
 * Les montants sont saisis en **euros** (nullable : une classe vide n'est pas
 * tarifée). La conversion en centimes entiers ≥ 0 et les contrôles métier
 * (réseau de la destination, self-pair, système ouvert) sont faits par le
 * contrôleur / le service, comme le pipeline d'import.
 */
const euroAmount = () => vine.number().min(0).max(10_000).nullable()

export const storeStationPriceValidator = vine.compile(
  vine.object({
    validFrom: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // null = prix fixe au franchissement (système ouvert).
    exitStationId: vine.number().positive().nullable(),
    // Distance tarifaire, en mètres (optionnelle).
    distanceMeters: vine.number().min(0).nullable().optional(),
    // Insère aussi le sens retour (couple fermé uniquement).
    symmetric: vine.boolean().optional(),
    // Index 0..4 = classes 1..5, en euros.
    prices: vine.tuple([euroAmount(), euroAmount(), euroAmount(), euroAmount(), euroAmount()]),
  })
)
