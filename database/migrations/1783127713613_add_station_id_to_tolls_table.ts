import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'tolls'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Gare logique regroupant les points physiques (une par sens de circulation)
      table
        .integer('station_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('toll_stations')

      table.index('station_id')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex('station_id')
      table.dropColumn('station_id')
    })
  }
}
