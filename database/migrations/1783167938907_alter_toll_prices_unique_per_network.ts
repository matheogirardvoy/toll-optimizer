import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'toll_prices'

  /**
   * Les grilles de deux réseaux peuvent publier le même couple O/D à la même
   * date (trajets traversants : APRR publie des trajets vers le corridor
   * Sanef, et réciproquement). L'unicité doit donc être portée par réseau.
   */
  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique(['entry_station_id', 'exit_station_id', 'vehicle_class', 'valid_from'])
      table.unique([
        'network_id',
        'entry_station_id',
        'exit_station_id',
        'vehicle_class',
        'valid_from',
      ])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique([
        'network_id',
        'entry_station_id',
        'exit_station_id',
        'vehicle_class',
        'valid_from',
      ])
      table.unique(['entry_station_id', 'exit_station_id', 'vehicle_class', 'valid_from'])
    })
  }
}
