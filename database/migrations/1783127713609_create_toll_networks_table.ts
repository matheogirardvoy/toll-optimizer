import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'toll_networks'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Identifiant stable utilisé par les imports ('area', 'aprr', 'sanef'…)
      table.string('slug').notNullable().unique()
      table.string('name').notNullable()

      // 'closed' : prix par couple entrée/sortie — 'open' : prix fixe par barrière
      table.string('pricing_mode').notNullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
