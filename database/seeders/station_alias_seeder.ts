import { BaseSeeder } from '@adonisjs/lucid/seeders'
import TollNetwork from '#models/toll_network'
import TollStation from '#models/toll_station'
import StationAlias from '#models/station_alias'
import { normalizeStationName } from '#services/import/name_normalizer'

type AliasDefinition = {
  /** Libellé tel que publié dans la grille du concessionnaire. */
  label: string

  /** Nom de la gare dans le référentiel — motif LIKE SQL (« Chamb_ry » absorbe l'encodage cassé). */
  stationNamePattern: string
}

/**
 * Alias de rapprochement par réseau : libellés publiés dont la forme
 * normalisée ne retombe pas sur le nom du référentiel (abréviations propres
 * au concessionnaire, graphies divergentes, coquilles du référentiel…).
 */
const ALIASES: Record<string, AliasDefinition[]> = {
  area: [
    { label: 'CHAMBERY NORD', stationNamePattern: 'Chamb_ry Nord' },
    { label: 'PONTCHARRA', stationNamePattern: 'Pontcharrat' },
    { label: 'MOIRANS', stationNamePattern: 'Moirans Sud' },
    { label: 'ST MICHEL MAURIENNE BAR', stationNamePattern: 'St Michel Barriere' },
    { label: 'ST MICHEL MAURIENNE ECH', stationNamePattern: 'St Michel Echangeur' },
    { label: 'ST PIERRE BELLEVILLE', stationNamePattern: 'St Pierre de Belleville' },
    { label: 'ST MARTIN BELLEVUE A410', stationNamePattern: 'Saint Martin de Bellevue A410' },
    { label: 'ST MARTIN BELLEVUE A41 N', stationNamePattern: 'Saint Martin Bellevue A41 Nord' },
    { label: 'CRUSEILLES A 410', stationNamePattern: 'Cruseilles A410' },
  ],
  aprr: [
    { label: 'AMBOISE CH.RENAULT', stationNamePattern: 'Amboise Chateau Renault' },
    { label: 'CHALONS LA VEUVE', stationNamePattern: 'La Veuve' },
    { label: 'CHALONS MOURMELON', stationNamePattern: 'Mourmelon' },
    { label: 'CHARMONT (LIM.CONC)', stationNamePattern: 'Charmont-s-Barbuise' },
    { label: 'DORDIVES', stationNamePattern: 'Dordives Est' },
    { label: 'FONTENAY /LOING', stationNamePattern: 'Fontenay sur Loing' },
    // Deux points de tarification distincts (prix différents selon l'accès),
    // le référentiel ne connaissant qu'une gare « Gondreville la Franche »
    { label: 'GONDREVILLE A77/N', stationNamePattern: 'Gondreville A77 Nord' },
    { label: 'GONDREVILLE A77/S', stationNamePattern: 'Gondreville A77 Sud' },
    { label: 'LA FOLIE-B/PARIS', stationNamePattern: 'La Folie' },
    { label: 'MONTREUIL AUX LIONS', stationNamePattern: 'Montreuil' },
    { label: 'MONTREUIL (REIMS)', stationNamePattern: 'Montreuil bretelles vers Reims' },
    { label: 'REIMS EST (TAISSY)', stationNamePattern: 'Taissy' },
    { label: 'REIMS NORD (ORMES)', stationNamePattern: 'Ormes' },
    { label: 'REIMS OUEST (THILLOIS)', stationNamePattern: 'Thillois' },
    { label: 'SAVIGNY /CLAIRIS', stationNamePattern: 'Savigny sur Clairis' },
    { label: 'ST GERMAIN LES VERGNE', stationNamePattern: 'Saint Germain Les Vergnes' },
    { label: 'ST HILAIRE', stationNamePattern: 'Saint Hilaire les Andresis' },
    { label: 'TIL CHATEL', stationNamePattern: 'Tilchatel' },
    { label: 'TOURS-C/MONNAIE', stationNamePattern: 'Monnaie' },
    // Barrière pleine voie distincte de l'échangeur « Val De Loing-Souppes »
    { label: 'VAL DE LOING-BARRIERE', stationNamePattern: 'Val de Loing Barrière' },
    { label: 'VILLEFRANCHE S/ CHER', stationNamePattern: 'Villefranche Sur Cher' },
  ],
  sanef: [
    // Corridor A16 - A29
    { label: "BOULOGNE EST (péage d'Herquelingue)", stationNamePattern: 'Herquelingue' },
    { label: 'BOULOGNE SUD', stationNamePattern: 'Isques' },
    { label: 'VALLÉE DE LA NIÈVRE', stationNamePattern: 'Flixecourt' },
    { label: 'AMIENS SUD (péage de Dury)', stationNamePattern: 'Dury' },
    { label: "L'ISLE-ADAM (péage d'Amblainville)", stationNamePattern: 'Amblainville' },
    { label: 'AUMALE', stationNamePattern: 'Aumale Est' },
    { label: 'NEUFCHÂTEL-EN-BRAY (A28)', stationNamePattern: 'Haudricourt' },

    // Corridor A1 - A2 - A26 Nord - A29
    { label: 'CALAIS (péage de Setques)', stationNamePattern: 'Setques' },
    { label: 'SAINT-OMER', stationNamePattern: 'Audomarois A' },
    { label: 'AIRE-SUR-LA-LYS', stationNamePattern: 'Therouanne' },
    { label: 'BÉTHUNE', stationNamePattern: 'Le Bethunois' },
    { label: 'LIÉVIN', stationNamePattern: 'Le Lievinois' },
    { label: 'ARRAS NORD (A26)', stationNamePattern: 'Thelus' },
    { label: 'SAINT-QUENTIN NORD', stationNamePattern: 'Saint Quentin La Vallee' },
    { label: 'SAINT-QUENTIN SUD', stationNamePattern: 'Gauchy' },
    { label: 'LA FÈRE', stationNamePattern: 'Courbes' },
    { label: 'LAON', stationNamePattern: 'Laon Chambry' },
    { label: 'GUIGNICOURT', stationNamePattern: 'Vallee de l_Aisne' },
    { label: 'REIMS (péage de Courcy)', stationNamePattern: 'Courcy' },
    { label: 'AMIENS EST (péage de Jules Verne)', stationNamePattern: 'Jules Verne' },
    { label: 'GARE TGV', stationNamePattern: 'Santerre' },
    { label: 'CAMBRAI', stationNamePattern: 'Fontaine Notre-Dame' },
    { label: 'LILLE / DOURGES (péage de Fresnes)', stationNamePattern: 'Fresnes' },
    { label: 'ARRAS EST (A1)', stationNamePattern: 'L_Arrageois' },
    { label: 'ALBERT', stationNamePattern: 'Maurepas' },
    { label: 'PÉRONNE / VALLEE DE LA SOMME', stationNamePattern: 'Vallee de la Somme' },
    { label: 'COMPIÈGNE OUEST', stationNamePattern: 'Arsy' },
    { label: 'PONT-SAINTE-MAXENCE', stationNamePattern: 'Chevrieres' },
    { label: 'SENLIS', stationNamePattern: 'Senlis-Bonsecours' },
    { label: 'PARIS / ROISSY (péage de Chamant)', stationNamePattern: 'Chamant' },

    // Corridor A4 - A26 Sud
    { label: 'PARIS / NOISY-LE-GRAND (péage de Coutevroult)', stationNamePattern: 'Coutevroult' },
    { label: 'COUTEVROULT', stationNamePattern: 'Coutevroult Echangeur' },
    { label: 'MEAUX (A140) / CRECY', stationNamePattern: 'Meaux / Crecy' },
    { label: 'MONTREUIL-AUX-LIONS', stationNamePattern: 'Montreuil' },
    { label: 'REIMS OUEST (péage de Thillois)', stationNamePattern: 'Thillois' },
    { label: "REIMS NORD (péage d'Ormes)", stationNamePattern: 'Ormes' },
    { label: 'REIMS EST (péage de Taissy)', stationNamePattern: 'Taissy' },
    { label: 'CHARMONT-SOUS-BARBUISE', stationNamePattern: 'Charmont-s-Barbuise' },
    { label: 'CHÂLONS-EN-CHAMPAGNE / LA VEUVE', stationNamePattern: 'La Veuve' },
    { label: 'SAINTE-MARIE-AUX-CHÊNES', stationNamePattern: 'Sainte Marie' },
    { label: 'METZ (A31)', stationNamePattern: 'Metz A31' },
    { label: 'BOULAY', stationNamePattern: 'Boulay PSB' },
    { label: 'SAINT-AVOLD', stationNamePattern: 'Saint-Avold B' },
    { label: 'FREYMING-MERLEBACH (A320)', stationNamePattern: 'Loupershouse' },
    { label: 'STRASBOURG', stationNamePattern: 'Schwindratzheim' },
  ],
  asf: [
    // Barrières « Péage de X » → gare X du référentiel
    { label: 'Péage de Vienne', stationNamePattern: 'Vienne' },
    { label: "Péage d'Arles", stationNamePattern: 'Arles' },
    { label: 'Péage de Baillargues', stationNamePattern: 'Baillargues' },
    { label: 'Péage de Béziers-Cabrials', stationNamePattern: 'Beziers Cabrials' },
    { label: 'Péage du Perthus', stationNamePattern: 'Le Perthus' },
    { label: 'Péage de Lançon (Aix/Berre)', stationNamePattern: 'Lancon' },
    { label: 'Péage de St-Martin-de-Crau', stationNamePattern: 'Saint Martin De Crau' },
    {
      label: 'Péage de Montpellier St-Jean',
      stationNamePattern: 'Montpellier Saint Jean De Vedas',
    },
    { label: 'Péage de Pamiers', stationNamePattern: 'Pamiers' },
    { label: 'Péage de Montauban nord', stationNamePattern: 'Montauban Nord' },
    { label: 'Péage de Gignac', stationNamePattern: 'Gignac' },
    { label: 'Péage de Thenon', stationNamePattern: 'Thenon vers Brives' },
    { label: 'Péage de Mussidan', stationNamePattern: 'Péage de Mussidan' },
    { label: "Péage d'Arveyres", stationNamePattern: 'Arveyres' },
    { label: 'Péage de Virsac', stationNamePattern: 'Virsac' },
    { label: 'Péage de Cabariot', stationNamePattern: 'Cabariot' },
    { label: 'Péage de La Roche-sur-Yon', stationNamePattern: 'La Roche Sur Yon' },
    { label: 'Péage du Bignon', stationNamePattern: 'Bignon' },
    { label: 'Péage de La Gravelle', stationNamePattern: 'La Gravelle' },
    { label: 'Péage de St-Christophe', stationNamePattern: 'Saint Christophe' },
    { label: 'Péage de Corzé', stationNamePattern: 'Corze' },
    { label: 'Péage de Beaulieu-s.-Layon', stationNamePattern: 'Beaulieu%Layon' },
    { label: 'Péage du Roumois', stationNamePattern: 'Roumois' },
    { label: "Péage d'Argentan", stationNamePattern: 'Sees Argentan 1' },
    { label: 'Péage de Restigné', stationNamePattern: 'Restigne' },
    { label: 'Péage de Monnaie', stationNamePattern: 'Monnaie' },
    { label: 'Péage de Veigné', stationNamePattern: 'Veigne' },
    { label: 'Péage de St-Arnoult', stationNamePattern: 'Saint-Arnoult' },
    { label: 'Péage de Fleury-en-Bière', stationNamePattern: 'Fleury-En-Biere' },
    { label: 'Péage des Eprunes', stationNamePattern: 'Les Eprunes' },
    { label: 'Péage de St-Germain-les-Vergnes', stationNamePattern: 'Saint Germain Les Vergnes' },
    { label: "Péage des Martres-d'Artière", stationNamePattern: 'Les Martres D_Artiere' },
    { label: 'Péage de St-Romain-de-Popey', stationNamePattern: 'Saint Romain De Popey' },
    { label: 'Péage de St-Maurice', stationNamePattern: 'Saint Maurice' },
    { label: 'Péage de Clermont', stationNamePattern: 'Clermont-Barriere' },
    { label: 'Péage de Gannat', stationNamePattern: 'Gannat' },
    { label: 'Péage de Deux Chaises', stationNamePattern: 'Deux Chaises' },
    { label: 'Péage de Montluçon', stationNamePattern: 'Montlucon' },
    { label: 'Péage de Pouilly-en-Auxois', stationNamePattern: 'Pouilly-En-Auxois' },
    { label: 'Péage de Dijon sud', stationNamePattern: 'Dijon Sud' },
    { label: 'Péage de Dijon/Crimolois', stationNamePattern: 'Dijon-Crimolois' },
    { label: 'Péage de Bersaillin', stationNamePattern: 'Bersaillin' },
    { label: 'Péage de Val de Saône', stationNamePattern: 'Val De Saone' },
    { label: 'Péage de Val de Loing barrière', stationNamePattern: 'Val de Loing Barrière' },
    { label: 'Péage de Beynost', stationNamePattern: 'Beynost' },
    { label: 'Péage de La Boisse', stationNamePattern: 'La Boisse' },
    { label: 'Péage de La Côtière', stationNamePattern: 'La Cotiere' },
    { label: 'Péage de Groissiat', stationNamePattern: 'Groissiat' },
    { label: 'Péage de Viry', stationNamePattern: 'Viry' },
    { label: 'Péage de Gye', stationNamePattern: 'Gye' },
    { label: 'Péage de Beaumont', stationNamePattern: 'Beaumont' },
    { label: 'Péage de Toulouse est', stationNamePattern: 'Toulouse Est vers Toulouse' },
    { label: 'Péage de Toulouse sud/est', stationNamePattern: 'Toulouse Sud Est' },
    { label: 'Péage de Toulouse nord/ouest', stationNamePattern: 'Toulouse Nord Ouest' },

    // Graphies divergentes grille ↔ référentiel
    { label: 'Biriatou', stationNamePattern: 'Biriatou vers Espagne' },
    { label: 'Aire-sur-Adour nord', stationNamePattern: 'Gare de peage Aire sur l_Adour Nord' },
    { label: 'Aire-sur-Adour sud', stationNamePattern: 'Gare de peage Aire sur l_Adour Sud' },
    { label: 'Bazas', stationNamePattern: 'Gare de peage Bazas' },
    { label: 'Captieux', stationNamePattern: 'Gare de peage Captieux' },
    { label: 'Garlin', stationNamePattern: 'Gare de peage Garlin' },
    { label: 'Le Caloy', stationNamePattern: 'Gare de peage Le Caloy' },
    { label: 'Roquefort', stationNamePattern: 'Gare de peage Roquefort' },
    { label: 'Théze', stationNamePattern: 'Gare de peage Theze' },
    { label: 'Beaufort-en-Vallée', stationNamePattern: 'Beaufort' },
    { label: 'Belleville-sur-Saône', stationNamePattern: 'Belleville S/Saone' },
    { label: 'Chatenois sud', stationNamePattern: 'Chatenois' },
    { label: 'Châlons/La Veuve', stationNamePattern: 'La Veuve' },
    { label: 'Châlons/Mourmelon', stationNamePattern: 'Mourmelon' },
    { label: 'Charmont-sous-Barbuise', stationNamePattern: 'Charmont-s-Barbuise' },
    { label: 'Dijon/Arc-sur- Tille', stationNamePattern: 'Dijon-Arc S/Tille' },
    { label: 'Gacé', stationNamePattern: 'Gace 1' },
    { label: 'Gerzat', stationNamePattern: 'Gerzat-Ville' },
    { label: 'Gondreville nord', stationNamePattern: 'Gondreville A77 Nord' },
    { label: 'Gondreville sud', stationNamePattern: 'Gondreville A77 Sud' },
    { label: "L'Isle-sur-le-Doubs", stationNamePattern: 'L_Isle-S/Le-Doubs' },
    { label: "L'Union", stationNamePattern: 'L_Union vers l_Union' },
    { label: 'Mansac Terrasson', stationNamePattern: 'Terrasson' },
    { label: 'Montpon-Ménestérol', stationNamePattern: 'Montpon' },
    { label: 'Montreuil-Reims', stationNamePattern: 'Montreuil bretelles vers Reims' },
    { label: 'Péage de Montreuil-aux-Lions', stationNamePattern: 'Montreuil' },
    { label: 'Mousserolles', stationNamePattern: 'Bayonne Mousserolles' },
    { label: 'Nîmes Garons', stationNamePattern: 'Garons' },
    { label: 'Orange', stationNamePattern: 'Orange Centre' },
    { label: 'Péage Reims nord', stationNamePattern: 'Ormes' },
    { label: 'Péage de Reims est', stationNamePattern: 'Taissy' },
    { label: 'Reims ouest', stationNamePattern: 'Thillois' },
    { label: 'Salon nord', stationNamePattern: 'Salon Nord (sortie)' },
    { label: 'Sées', stationNamePattern: 'Sees Est' },
    { label: 'St-Maixent-Soudan', stationNamePattern: 'Soudan' },
    { label: 'Sylans sud', stationNamePattern: 'Sylans' },
    { label: 'Thivars', stationNamePattern: 'Thivars Nord' },
    { label: 'Til-Chatel', stationNamePattern: 'Tilchatel' },
    { label: 'Ville-sous-la-Ferté', stationNamePattern: 'Ville Sous Laferte' },
    { label: 'Villefranche-de-Lauragais', stationNamePattern: 'Villefranche de Lauraguais' },
    { label: 'Péage de Villefranche-Limas', stationNamePattern: 'Villefranche-Limas' },
    { label: 'Vivy Saumur', stationNamePattern: 'Vivy' },
    { label: 'Auberives accès nord/sud uniquement', stationNamePattern: 'Auberives' },
    { label: 'Le Boulou péage en système fermé', stationNamePattern: 'Le Boulou' },
    { label: 'Le Boulou système fermé', stationNamePattern: 'Le Boulou' },
    { label: 'La Rochelle Niort sud', stationNamePattern: 'Niort Sud' },
    { label: 'St-Aubin-de-Blaye', stationNamePattern: 'Saint Aubin' },
  ],
}

const NETWORK_DEFAULTS: Record<string, { name: string; pricingMode: 'open' | 'closed' }> = {
  area: { name: 'AREA', pricingMode: 'closed' },
  aprr: { name: 'APRR', pricingMode: 'closed' },
  sanef: { name: 'Sanef', pricingMode: 'closed' },
  asf: { name: 'ASF', pricingMode: 'closed' },
}

export default class extends BaseSeeder {
  async run() {
    for (const [slug, aliases] of Object.entries(ALIASES)) {
      const network = await TollNetwork.firstOrCreate({ slug }, NETWORK_DEFAULTS[slug])

      // La liste ci-dessus fait foi : les alias retirés doivent disparaître.
      await StationAlias.query().where('network_id', network.id).delete()

      for (const { label, stationNamePattern } of aliases) {
        const station = await TollStation.query()
          .where('name', 'like', stationNamePattern)
          .orderBy('id')
          .firstOrFail()

        await StationAlias.create({
          networkId: network.id,
          alias: normalizeStationName(label),
          stationId: station.id,
        })
      }
    }
  }
}
