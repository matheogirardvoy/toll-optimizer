import { BaseTransformer } from '@adonisjs/core/transformers'
import Toll from '#models/toll'

export default class TollTransformer extends BaseTransformer<Toll> {
  toObject() {
    return this.pick(this.resource, [
      'id',
      'name',
      'road',
      'side',
      'gateType',
      'gateTypeLabel',
      'laneCount',
      'longitude',
      'latitude',
    ])
  }
}