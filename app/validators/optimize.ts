import vine from '@vinejs/vine'
import { VEHICLE_CLASSES } from '#models/toll_price'

/**
 * Payload de POST /api/optimize. Coordonnées en ordre GeoJSON [lng, lat] ;
 * le consentement à payer s'exprime en « au plus `maxPriceCents` pour
 * gagner `minutesSaved` minutes ».
 */
export const optimizeValidator = vine.compile(
  vine.object({
    start: vine.tuple([
      vine.number().min(-180).max(180),
      vine.number().min(-90).max(90),
    ]),
    end: vine.tuple([
      vine.number().min(-180).max(180),
      vine.number().min(-90).max(90),
    ]),
    vehicleClass: vine.enum(VEHICLE_CLASSES),
    maxPriceCents: vine.number().positive(),
    minutesSaved: vine.number().positive(),
  })
)
