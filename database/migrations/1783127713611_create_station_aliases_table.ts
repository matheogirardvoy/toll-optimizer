import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'station_aliases'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Un alias vaut pour la grille d'un réseau donné : le même libellé
      // pourrait désigner deux gares différentes chez deux concessionnaires.
      table
        .integer('network_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('toll_networks')

      // Libellé sous forme normalisée (voir normalizeStationName)
      table.string('alias').notNullable()

      table
        .integer('station_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('toll_stations')

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['network_id', 'alias'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
