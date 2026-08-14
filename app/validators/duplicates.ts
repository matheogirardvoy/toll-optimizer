import vine from '@vinejs/vine'

/**
 * Fusion de deux gares depuis l'admin : la source (`fromId`) est absorbée par
 * la cible (`intoId`), qui peut être renommée au passage.
 */
export const mergeStationsValidator = vine.compile(
  vine.object({
    fromId: vine.number().positive(),
    intoId: vine.number().positive(),
    newName: vine.string().trim().minLength(2).maxLength(120).optional(),
  })
)
