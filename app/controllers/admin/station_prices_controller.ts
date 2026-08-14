import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import TollStation from '#models/toll_station'
import { VEHICLE_CLASSES } from '#models/toll_price'
import ManualPriceEditor from '#services/pricing/manual_price_editor'
import { storeStationPriceValidator } from '#validators/station_prices'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default class StationPricesController {
  /**
   * Saisie / mise à jour d'une ligne destination (les cinq classes) au départ
   * d'une gare, pour une grille donnée. Upsert par le service, puis retour sur
   * la fiche gare positionnée sur la grille éditée.
   */
  async store({ params, request, response, session }: HttpContext) {
    const station = await TollStation.query()
      .where('id', Number(params.id))
      .preload('network')
      .first()

    if (station === null) {
      session.flash('error', 'Gare inconnue.')
      return response.redirect().toRoute('admin.stations')
    }
    if (station.networkId === null) {
      session.flash('error', "Cette gare n'est rattachée à aucun réseau : saisie impossible.")
      return response.redirect().back()
    }

    const payload = await request.validateUsing(storeStationPriceValidator)
    const network = station.network

    // Destination : même réseau, différente de la gare d'entrée.
    if (payload.exitStationId !== null) {
      if (payload.exitStationId === station.id) {
        session.flash('error', "La destination doit différer de la gare d'entrée.")
        return response.redirect().back()
      }
      if (network.pricingMode === 'open') {
        session.flash(
          'error',
          'Réseau en système ouvert : seul un prix fixe (sans destination) est possible.'
        )
        return response.redirect().back()
      }
      const exit = await TollStation.find(payload.exitStationId)
      if (exit === null || exit.networkId !== station.networkId) {
        session.flash('error', 'Destination invalide (réseau différent).')
        return response.redirect().back()
      }
    }

    const validFrom = DateTime.fromISO(payload.validFrom)
    const validFromDate = validFrom.isValid ? validFrom.toISODate() : null
    if (validFromDate === null) {
      session.flash('error', "Date d'entrée en vigueur invalide.")
      return response.redirect().back()
    }

    // Euros → centimes entiers ≥ 0 (zéro = section gratuite, légitime).
    const pricesCents: (number | null)[] = []
    for (const klass of VEHICLE_CLASSES) {
      const euros = payload.prices[klass - 1]
      if (euros === null || euros === undefined) {
        pricesCents.push(null)
        continue
      }
      const cents = Math.round(euros * 100)
      if (!Number.isInteger(cents) || cents < 0) {
        session.flash('error', `Prix invalide pour la classe ${klass}.`)
        return response.redirect().back()
      }
      pricesCents.push(cents)
    }

    if (pricesCents.every((cents) => cents === null)) {
      session.flash('error', 'Saisissez au moins un prix.')
      return response.redirect().back()
    }

    try {
      const { saved, removed } = await new ManualPriceEditor().upsertDestination({
        networkId: station.networkId,
        entryStationId: station.id,
        exitStationId: payload.exitStationId,
        validFrom,
        pricesCents,
        distanceMeters: payload.distanceMeters ?? null,
        symmetric: payload.symmetric === true,
      })
      const parts = [`${saved} prix enregistré${saved > 1 ? 's' : ''}`]
      if (removed > 0) parts.push(`${removed} supprimé${removed > 1 ? 's' : ''}`)
      session.flash('success', `${parts.join(', ')}.`)
    } catch (error) {
      session.flash('error', `Enregistrement échoué : ${errorMessage(error)}`)
    }

    return response
      .redirect()
      .toRoute('admin.stations.show', { id: station.id }, { qs: { grid: validFromDate } })
  }

  /**
   * Suppression d'une ligne destination (les cinq classes) pour une grille.
   * Discriminants passés en query string (`validFrom`, `exitStationId`).
   */
  async destroy({ params, request, response, session }: HttpContext) {
    const station = await TollStation.find(Number(params.id))
    if (station === null || station.networkId === null) {
      session.flash('error', 'Gare inconnue.')
      return response.redirect().toRoute('admin.stations')
    }

    const validFrom = DateTime.fromISO(String(request.input('validFrom', '')))
    if (!validFrom.isValid) {
      session.flash('error', 'Grille invalide.')
      return response.redirect().back()
    }

    const exitRaw = request.input('exitStationId', 'fixed')
    const exitStationId =
      exitRaw === 'fixed' || exitRaw === '' || exitRaw === null ? null : Number(exitRaw)
    if (exitStationId !== null && !Number.isInteger(exitStationId)) {
      session.flash('error', 'Destination invalide.')
      return response.redirect().back()
    }

    try {
      const { removed } = await new ManualPriceEditor().removeDestination({
        networkId: station.networkId,
        entryStationId: station.id,
        exitStationId,
        validFrom,
      })
      session.flash(
        removed > 0 ? 'success' : 'error',
        removed > 0 ? 'Destination supprimée.' : 'Aucun prix à supprimer pour cette grille.'
      )
    } catch (error) {
      session.flash('error', `Suppression échouée : ${errorMessage(error)}`)
    }

    return response.redirect().back()
  }
}
