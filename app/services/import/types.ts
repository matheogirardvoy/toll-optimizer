import type { VehicleClass } from '#models/toll_price'

/**
 * Ligne pivot produite par les parseurs de grilles tarifaires. Quel que soit
 * le format publié (liste O/D AREA ou APRR, matrice triangulaire Sanef…),
 * tout converge vers cette forme avant de passer dans le pipeline commun.
 */
export interface PriceRow {
  entryName: string

  /** null = prix fixe au franchissement de la gare d'entrée (système ouvert). */
  exitName: string | null

  /** Code gare du concessionnaire, quand la grille le publie (AREA uniquement). */
  entryCode: string | null
  exitCode: string | null

  vehicleClass: VehicleClass

  /** Montant TTC en centimes. */
  priceCents: number

  /** Distance tarifaire en mètres (absente de la grille Sanef). */
  distanceMeters: number | null
}

/**
 * Pseudo-gare de sortie utilisée par les grilles AREA et APRR pour publier
 * les prix fixes de leurs barrières en système ouvert. Les parseurs la
 * traduisent en sortie nulle, la convention « prix fixe » du modèle.
 */
export const OPEN_SYSTEM_EXIT_LABEL = 'Système Ouvert'

/**
 * Contrat des parseurs : un par concessionnaire, seule brique spécifique
 * du dispositif d'import.
 */
export interface PriceGridParser {
  readonly networkSlug: string

  /**
   * true quand la grille ne publie qu'un sens par couple (matrice
   * triangulaire Sanef) : le pipeline insère alors aussi le sens retour.
   */
  readonly symmetric: boolean

  parse(filePath: string): Promise<PriceRow[]>
}
