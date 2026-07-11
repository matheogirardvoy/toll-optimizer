import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'tolls'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Référentiel
      table.date('reference_date').nullable()

      // Localisation routière (point repère)
      table.string('road').nullable()
      table.integer('milestone').nullable()
      table.integer('milestone_department').nullable()
      table.string('concession').nullable()
      table.integer('offset_meters').nullable()
      table.integer('cumulative_meters').nullable()

      // Coordonnées Lambert 93 (EPSG:2154) d'origine
      table.double('lambert_x').notNullable()
      table.double('lambert_y').notNullable()
      table.double('elevation').nullable()

      // Coordonnées WGS84 (EPSG:4326) reprojetées — utilisées par Mapbox
      table.double('longitude').notNullable()
      table.double('latitude').notNullable()

      // Identification de la gare
      table.string('side').nullable()
      table.string('name').notNullable()
      table.string('gate_type').nullable()
      table.string('gate_type_label').nullable()
      table.integer('lane_count').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      // Recherche par route et regroupement par gare
      table.index(['road', 'milestone'])
      table.index('name')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}