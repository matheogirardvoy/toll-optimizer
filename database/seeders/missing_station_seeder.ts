import { BaseSeeder } from '@adonisjs/lucid/seeders'
import TollStation from '#models/toll_station'

/**
 * Points de tarification cités par les grilles des concessionnaires mais
 * absents du référentiel data.gouv des gares physiques (gares récentes,
 * points doubles d'une même gare, limites de concession…). Créés sans
 * coordonnées ni points physiques ; le rattachement réseau et le code
 * opérateur sont posés par l'import qui les reconnaît.
 *
 * S'exécute avant `station_alias_seeder` (ordre alphabétique des seeders),
 * qui fait pointer certains alias vers ces gares.
 */
const MISSING_STATIONS: string[] = [
  // Réseau AREA — barrière Adelac de l'A41 Nord
  'Saint Martin Bellevue A41 Nord',

  // Réseau APRR
  'Chalon Centre',
  'Deux Chaises',
  'Gidy',
  'Gondreville A77 Nord',
  'Gondreville A77 Sud',
  'La Folie',
  'Reims Sud',
  'Val de Loing Barrière',

  // Réseau Sanef — points de tarification distincts de la barrière voisine
  'Coutevroult Echangeur',
  'Meaux / Crecy',
  'Metz A31',

  // Réseau ASF — sections urbaines et gares absentes du référentiel.
  // Nommés comme dans la grille : le rapprochement par nom suffit alors.
  // Couloir A7/A46 lyonnais
  'Fort de St-Priest',
  'St-Priest centre',
  'Mions',
  'Vénissieux',
  'Marennes',
  'Communay',
  'Chasse sud',
  'Vienne nord',
  'Vienne sud',
  'Bifurcation A46S/A43 vers A43 ou A46',
  'Bifurcation A46S/A7/A47 vers Lyon ou St-Étienne',
  // A9/A54/A709 Provence-Languedoc
  'Aix ouest',
  'Coudoux',
  'Rognac Berre',
  'St-Martin-de-Crau est',
  'Vendargues',
  'Montpellier est',
  'Montpellier sud',
  'Montpellier ouest',
  'St-Jean-de-Védas',
  'Frontière Espagnole',
  // Périphérie toulousaine (A61/A62/A68/A64/A620)
  'Le Palays',
  'Montaudran',
  'Lasbordes',
  'Soupetard',
  'La Roseraie',
  'La Croix Daurade',
  'Borderouge',
  'Les Izards',
  'Sesquières',
  'ZI nord',
  'Chaumes',
  'Beausoleil',
  'Sapiac',
  'La Molle',
  'Parages',
  'Moulis',
  'Montastruc',
  'Gragnague',
  'Gemil',
  'Bretelle de Verfeil',
  'Péage de Toulouse nord/est',
  'Péage de Toulouse sud/ouest',
  'Péage de Tours centre',
  'Muret nord',
  'Péage de Muret',
  'Roques',
  'Francazal',
  'Le Chapitre',
  'La Boise/Montuel',
  'Le Boulou péage en système ouvert',
  'Pamiers Nord',
  'Pamiers Sud',
  'Agen Ouest',
  // A63/A64 Pays basque et Landes
  'Biarritz demi-échangeur sud',
  'Biarritz demi-échangeur nord',
  // « Péage de la Négresse » et « Péage de Biriatou » retirés : doublonnaient les
  // gares référentiel La Negresse (#79) et Biriatou (#78) ; fusionnés via
  // `stations:merge`, leurs libellés de grille sont désormais des alias.
  'Bayonne nord',
  'Bayonne Mousserolles',
  'Ondres',
  'Capbreton demi-échangeur sud',
  'Capbreton demi-échangeur nord',
  'Péage de Bénesse-Marenne',
  'St-Geours-de-Maremne',
  'Urt',
  'Briscous',
  'Mouguerre Bourg',
  'Mouguerre Elizaberry',
  'St-Jean-de-Luz nord',
  'Péage de St-Geours-de-Maremne',
  // Rocade bordelaise et A89 ouest
  'Lormont',
  'Carbon-Blanc',
  'Ambarès/St-Loubes',
  'Ambes',
  'St-André-de-Cubzac',
  'Blaye',
  'Sainte-Eulalie',
  'La Brède',
  'Libourne ouest',
  'Libourne/St-Antoine',
  'Brive ouest',
  'Périgueux est',
  'Périgueux ouest',
  'Périgueux sud',
  'Péage de Mussidan',
  'Nespouls',
  'Sorges',
  'RD 323',
  'RD 347',
  // A87/A85/A11 et A89 est
  'Rochefort nord',
  'Rochefort ouest',
  'Broglie ouest',
  'Connerré',
  'Illiers-Combray',
  'Haute-Perche',
  'Hanipet',
  'Gatignolle',
  'Grand-Clos',
  'La Bouvinerie',
  'La Cour-Neuve',
  'La Foucaudière',
  "Bd d'Estienne d'Orves",
  'Mûrs-Érigné',
  'Pellouailles-les-Vignes',
  'Lentilly',
  'Tarare est péage en système fermé',
  'Tarare est péage en système ouvert',
  'Tour de Salvagny limite de concession',
  'Clermont-Ferrand limite de concession',
  'Bordeaux limite de concession',
  'A 20 limite de concession',
  'La Roche-sur-Yon centre',
  'La Roche-sur-Yon est',
  'La Roche-sur-Yon ouest',
  'La Roche-sur-Yon sud',
]

export default class extends BaseSeeder {
  async run() {
    for (const name of MISSING_STATIONS) {
      await TollStation.firstOrCreate({ name })
    }
  }
}
