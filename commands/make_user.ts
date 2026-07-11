import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Crée un utilisateur depuis la ligne de commande.
 *
 *   node ace make:user
 *   node ace make:user --email=admin@toll.fr --password=secret123 --full-name="Jane Doe"
 */
export default class MakeUser extends BaseCommand {
  static commandName = 'make:user'
  static description = 'Créer un nouvel utilisateur'

  // L'application doit être démarrée pour accéder à la base de données.
  static options: CommandOptions = { startApp: true }

  @flags.string({ description: "Adresse email de l'utilisateur" })
  declare email?: string

  @flags.string({ flagName: 'full-name', description: "Nom complet (optionnel)" })
  declare fullName?: string

  @flags.string({ description: 'Mot de passe (8 caractères minimum)' })
  declare password?: string

  async run() {
    const { default: User } = await import('#models/user')

    const email =
      this.email ??
      (await this.prompt.ask('Adresse email', {
        validate: (value) => (/^\S+@\S+\.\S+$/.test(value) ? true : 'Email invalide'),
      }))

    const fullName =
      this.fullName ?? (await this.prompt.ask('Nom complet (laisser vide pour aucun)'))

    const password =
      this.password ??
      (await this.prompt.secure('Mot de passe', {
        validate: (value) => (value.length >= 8 ? true : '8 caractères minimum'),
      }))

    if (!password || password.length < 8) {
      this.logger.error('Le mot de passe doit contenir au moins 8 caractères.')
      this.exitCode = 1
      return
    }

    const existing = await User.findBy('email', email)
    if (existing) {
      this.logger.error(`Un utilisateur existe déjà avec l'email ${email}.`)
      this.exitCode = 1
      return
    }

    // Le mot de passe est haché automatiquement par le mixin withAuthFinder.
    const user = await User.create({
      email,
      fullName: fullName?.trim() ? fullName.trim() : null,
      password,
    })

    this.logger.success(`Utilisateur #${user.id} créé : ${user.email}`)
  }
}
