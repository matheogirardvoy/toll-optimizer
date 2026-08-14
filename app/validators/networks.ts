import vine from '@vinejs/vine'

/**
 * Rattachement d'une gare à un réseau : soit un réseau existant (`networkId`),
 * soit la création d'un nouveau réseau (`name` + `slug` + `pricingMode`).
 * Le contrôleur arbitre entre les deux cas et vérifie l'unicité du slug.
 */
export const assignStationNetworkValidator = vine.compile(
  vine.object({
    networkId: vine.number().positive().optional(),
    name: vine.string().trim().minLength(2).maxLength(80).optional(),
    slug: vine
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .maxLength(40)
      .optional(),
    pricingMode: vine.enum(['open', 'closed']).optional(),
  })
)
