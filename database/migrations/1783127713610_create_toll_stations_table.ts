import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'toll_stations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Renseigné lors du premier import tarifaire qui reconnaît la gare ;
      // null tant que la gare n'a été rapprochée d'aucune grille.
      table
        .integer('network_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('toll_networks')

      table.string('name').notNullable()

      // Code gare publié par le concessionnaire (AREA uniquement à ce jour),
      // clé de rapprochement stable d'une grille annuelle à l'autre.
      table.string('operator_code').nullable()

      // Type dominant des points physiques (Ech / Bpv)
      table.string('gate_type').nullable()

      // Centroïde WGS84 des points physiques rattachés
      table.double('longitude').nullable()
      table.double('latitude').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['network_id', 'operator_code'])
      table.index('name')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
