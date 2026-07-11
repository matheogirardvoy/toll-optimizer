import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'toll_prices'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('network_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('toll_networks')

      table
        .integer('entry_station_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('toll_stations')

      // null = prix fixe au franchissement de la gare d'entrée (barrière en
      // système ouvert) ; sinon prix du couple entrée/sortie (système fermé).
      table
        .integer('exit_station_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('toll_stations')

      // Classes tarifaires françaises : 1 à 5
      table.integer('vehicle_class').notNullable()

      // Montant TTC en centimes — jamais de flottant pour de l'argent
      table.integer('price_cents').notNullable()

      // Distance tarifaire publiée par le concessionnaire (absente chez Sanef)
      table.integer('distance_meters').nullable()

      // Période de validité de la grille (revalorisation annuelle au 1er février)
      table.date('valid_from').notNullable()
      table.date('valid_to').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['entry_station_id', 'exit_station_id', 'vehicle_class', 'valid_from'])
      table.index(['entry_station_id', 'exit_station_id', 'vehicle_class'])
      table.index('network_id')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
