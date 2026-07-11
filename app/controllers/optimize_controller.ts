import type { HttpContext } from '@adonisjs/core/http'
import { DirectionsError } from '#services/mapbox/directions_client'
import RouteOptimizer, { NoRouteError } from '#services/optimizer/route_optimizer'
import { optimizeValidator } from '#validators/optimize'

/**
 * Optimisation péages/sans-péages : renvoie la route au meilleur coût
 * généralisé selon le consentement à payer de l'utilisateur, avec les
 * références (rapide, sans péage) et le détail des candidates pour l'UI.
 */
export default class OptimizeController {
  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(optimizeValidator)

    try {
      const result = await new RouteOptimizer().optimize(payload)
      return response.json(result)
    } catch (error) {
      if (error instanceof NoRouteError) {
        return response.unprocessableEntity({ message: error.message })
      }
      if (error instanceof DirectionsError) {
        return response.serviceUnavailable({
          message: 'Calcul d’itinéraire momentanément indisponible',
        })
      }
      throw error
    }
  }
}
