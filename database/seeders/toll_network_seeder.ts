import { BaseSeeder } from '@adonisjs/lucid/seeders'
import TollNetwork from '#models/toll_network'

/**
 * Réseaux de tarification connus. Les trois grilles disponibles à ce jour
 * sont toutes en système fermé : même les barrières pleine voie y figurent
 * comme origines/destinations de couples.
 */
export default class extends BaseSeeder {
  async run() {
    await TollNetwork.updateOrCreateMany('slug', [
      { slug: 'area', name: 'AREA', pricingMode: 'closed' },
      { slug: 'aprr', name: 'APRR', pricingMode: 'closed' },
      { slug: 'sanef', name: 'Sanef', pricingMode: 'closed' },
      { slug: 'asf', name: 'ASF', pricingMode: 'closed' },
    ])
  }
}
