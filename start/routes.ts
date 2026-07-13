/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'
import router from '@adonisjs/core/services/router'

const DashboardController = () => import('#controllers/admin/dashboard_controller')
const TollsController = () => import('#controllers/admin/tolls_controller')
const PricesController = () => import('#controllers/admin/prices_controller')
const StationsController = () => import('#controllers/admin/stations_controller')
const OptimizeController = () => import('#controllers/optimize_controller')

router.on('/').renderInertia('home', {}).as('home')

// Endpoint public consommé par la carte Mapbox
router.get('api/tolls.geojson', [TollsController, 'geojson']).as('api.tolls')

// Enrichit les péages signalés par Mapbox avec le référentiel local
router.post('api/tolls/match', [TollsController, 'match']).as('api.tolls.match')

// Optimisation d'itinéraire péages/sans-péages
router.post('api/optimize', [OptimizeController, 'store']).as('api.optimize')

router
  .group(() => {
    router.get('admin/login', [controllers.Session, 'create']).as('admin.login')
    router.post('admin/login', [controllers.Session, 'store']).as('admin.login.store')
  })
  .use(middleware.guest())

router
  .group(() => {
    router.post('admin/logout', [controllers.Session, 'destroy']).as('admin.logout')

    router.get('admin', [DashboardController, 'index']).as('admin.dashboard')

    router.get('admin/tolls', [TollsController, 'index']).as('admin.tolls')
    router.post('admin/tolls/upload', [TollsController, 'upload']).as('admin.tolls.upload')
    router.post('admin/tolls/import', [TollsController, 'importRemote']).as('admin.tolls.import')

    router.get('admin/prices', [PricesController, 'index']).as('admin.prices')
    router.post('admin/prices/import', [PricesController, 'import']).as('admin.prices.import')

    router.get('admin/stations', [StationsController, 'index']).as('admin.stations')
    router.get('admin/stations/:id', [StationsController, 'show']).as('admin.stations.show')
  })
  .use(middleware.auth())
