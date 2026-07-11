import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'

export default class SessionController {
  async create({ view }: HttpContext) {
    return view.render('admin/login')
  }

  async store({ request, auth, response, session }: HttpContext) {
    const { email, password } = request.only(['email', 'password'])

    try {
      const user = await User.verifyCredentials(email, password)
      await auth.use('web').login(user)
    } catch {
      session.flash('error', 'Identifiants invalides.')
      session.flash('email', email)
      return response.redirect().back()
    }

    return response.redirect().toRoute('admin.dashboard')
  }

  async destroy({ auth, request, response, inertia }: HttpContext) {
    await auth.use('web').logout()

    // La page de connexion est rendue par Edge : depuis le dashboard Inertia,
    // il faut forcer une visite complète plutôt qu'une navigation Inertia.
    if (request.header('x-inertia')) {
      return inertia.location('/admin/login')
    }

    return response.redirect().toRoute('admin.login')
  }
}
