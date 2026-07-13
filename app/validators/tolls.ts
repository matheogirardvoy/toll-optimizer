import vine from '@vinejs/vine'

/**
 * Payload de POST /api/tolls/match : points de perception relevés par le
 * front dans la réponse Directions, en ordre GeoJSON [lng, lat]. Une route
 * française n'aligne jamais plus de quelques dizaines de péages — la borne
 * écarte les payloads aberrants.
 */
export const matchTollsValidator = vine.compile(
  vine.object({
    points: vine
      .array(
        vine.tuple([
          vine.number().min(-180).max(180),
          vine.number().min(-90).max(90),
        ])
      )
      .maxLength(200),
  })
)
