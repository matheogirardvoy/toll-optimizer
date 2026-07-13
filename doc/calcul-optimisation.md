# Calcul et optimisation des trajets — fonctionnement complet

Ce document décrit toute la logique de calcul de TollOptimizer : comment un
itinéraire est tarifé au centime près, comment l'optimiseur décide quels
péages valent leur prix, et pourquoi chaque règle existe (la plupart ont été
calibrées sur des trajets réels — les anecdotes sont citées, elles servent de
tests de non-régression).

Code concerné :

| Brique | Fichier |
|---|---|
| Tarification d'un itinéraire | `app/services/pricing/route_pricer.ts` |
| Géométrie (projection, distances) | `app/services/pricing/geometry.ts` |
| Lecture de la grille de prix | `app/services/pricing/price_lookup.ts` |
| Optimiseur greedy | `app/services/optimizer/route_optimizer.ts` |
| Client Mapbox serveur | `app/services/mapbox/directions_client.ts` |
| Endpoint HTTP | `app/controllers/optimize_controller.ts` + `app/validators/optimize.ts` |
| Diagnostic CLI | `commands/price_route.ts`, `commands/optimize_route.ts` |

---

## 1. Le principe : un seuil de rentabilité

L'utilisateur exprime son consentement à payer : « je veux payer au plus
**X €** pour gagner **Y minutes** ». Ce couple définit un taux :

```
ρ (rho) = maxPriceCents / minutesSaved        [centimes par minute]
```

Exemple : 20 € pour 60 min → ρ = 33,3 c/min (20 €/h). Un péage est rentable
si et seulement si chaque minute qu'il fait gagner coûte moins que ρ.

Toutes les routes sont comparées au **coût généralisé** (« score »), exprimé
en minutes équivalentes :

```
score(route) = durée_minutes + prixCents / ρ
```

Le prix est ainsi converti en temps : la route au score minimal est la
meilleure *au sens de l'utilisateur*. Retirer un péage améliore le score si
et seulement si `prix_économisé / temps_perdu > ρ` — c'est exactement la
règle du seuil, mais avec une condition d'arrêt propre et la possibilité de
comparer n'importe quelles routes entre elles.

---

## 2. Vue d'ensemble de la chaîne

```
POST /api/optimize { start, end, vehicleClass, maxPriceCents, minutesSaved }
        │
        ▼
RouteOptimizer.optimize()
  1. Mapbox Directions : route rapide (+ alternatives) et route exclude=toll
  2. RoutePricer.price() sur chaque candidate  ──►  prix + anomalies
  3. Greedy : tenter de retirer chaque tronçon payant (exclusions de couloir)
  4. Recommandation = score pessimiste minimal parmi toutes les candidates
        │
        ▼
{ best, fastest, noToll, evaluated[], decisions[], warnings[] }
```

Le front (`inertia/composables/engine/useOptimizer.ts`) consomme cette
réponse : onglets de variantes, panneau de résultats, graphique de
rentabilité. Il ne recalcule rien.

---

## 3. Tarifer un itinéraire (`RoutePricer`)

Entrée : une géométrie GeoJSON `LineString` (le tracé Mapbox), une classe de
véhicule (1 à 5), une date (la grille en vigueur ce jour-là s'applique).
Sortie : `{ totalCents, complete, crossings, sections, issues }`.

### 3.1 Matching : quelles gares le tracé franchit-il ?

Le référentiel (`tolls`, importé de data.gouv) contient ~1 266 points
physiques de péage (une ligne par sens de circulation), regroupés en ~783
gares logiques (`toll_stations`) par `station_builder_service`.

Chaque point candidat (préfiltré par la boîte englobante du tracé, élargie du
seuil) est **projeté sur la polyligne** (projection équirectangulaire locale,
erreur centimétrique à ces échelles — `geometry.ts`). Un point est retenu si
sa distance perpendiculaire est sous le **corridor de matching : 10 m**.

> **Pourquoi 10 m ?** Calibré sur A1/A6/A7 (APRR, Sanef, ASF) : une gare
> réellement franchie se projette à **≤ 6 m** du tracé Mapbox (barrières
> pleine voie comme bretelles), les gares adjacentes non franchies
> (bretelles voisines, barrières contournées par les voies de transit,
> doublons du référentiel) apparaissent à **≥ 12 m**. Contre-exemple qui
> interdit d'élargir : Pouilly-en-Auxois est à 12 m de la voie nord de l'A6
> (non franchie) mais à **0 m** de la voie sud — le seuil seul ne suffit
> pas, d'où la règle d'appariement du §3.3.

Les points retenus sont regroupés par gare en **franchissements** : les
points d'une même gare à moins de **500 m** l'un de l'autre le long du tracé
fusionnent (les deux sens d'une barrière, les bretelles d'un échangeur) ; la
même gare rencontrée bien plus loin compte comme un second franchissement
(aller-retour).

### 3.2 Modes de tarification

- **Système fermé** (`toll_networks.pricing_mode = 'closed'`) : ticket à
  l'entrée, prix au couple gare d'entrée / gare de sortie
  (`toll_prices.entry_station_id` + `exit_station_id`).
- **Système ouvert** : prix fixe au franchissement d'une barrière
  (`exit_station_id NULL`). Les grilles APRR/AREA publient ces
  « franchissements seuls » (pseudo-sortie « Système Ouvert » dans les PDF).

Les quatre réseaux importés (ASF, APRR, AREA, Sanef) sont déclarés fermés,
mais contiennent des barrières à prix fixe (A42, A46, A49…) : le mode réel
est résolu à la tarification (§3.4), pas déclaré par gare.

### 3.3 Appariement : reconstituer les sections tarifaires

Les franchissements ordonnés par abscisse curviligne sont découpés en
**blocs contigus d'un même réseau fermé** (les gares sans réseau ou en
système ouvert ne scindent pas un bloc). Dans un bloc, la règle est :

> La section court de la première gare du bloc jusqu'à une gare
> d'**échangeur** (`Ech`) ou jusqu'à la **dernière gare du bloc**. Une
> barrière pleine voie (`Bpv`) **intermédiaire** ne clôt pas la section.

Justification physique : une bretelle franchie est forcément une vraie
entrée/sortie (on ne passe pas par une bretelle en transit), tandis qu'une
BPV intermédiaire se franchit ticket en main — ou n'est qu'un point du
référentiel côtoyé sans être franchi (Pouilly à 0 m de la voie sud). Une
gare de type inconnu est traitée comme un échangeur (conservateur).

C'est cette règle qui donne Paris→Marseille = Fleury→Villefranche (41,30 €)
+ Vienne→Lançon (28,10 €) = **69,40 €**, le prix réel, au lieu d'apparier
Fleury→Pouilly à tort.

### 3.4 Replis de tarification

Chaque section est tarifée par `PriceLookup.forTraversal` (grille en vigueur
à la date du trajet, par classe de véhicule). Deux replis, tous deux
**gardés par la grille** (aucun prix n'est jamais inventé) :

1. **Franchissement seul.** Un franchissement resté orphelin (entrée sans
   sortie), ou un couple absent de la grille, est tarifé par les prix
   barrière (`exit NULL`) de ses gares s'ils existent. Un couple absent dont
   les deux gares ont chacune leur prix fixe était en réalité **deux
   barrières indépendantes** (Le Crozet puis Voreppe sur A49/A48), pas un
   trajet fermé. La section résultante porte `pricingMode: 'open'`.

2. **Réparation par gares frôlées.** Une bretelle réellement empruntée peut
   projeter à 15-35 m du tracé Mapbox (géométrie de bretelle simplifiée —
   constaté sur le complexe La Côtière/La Boisse de l'A42, sorties à
   18-32 m). Quand une entrée reste sans sortie, on cherche la gare manquée
   parmi celles frôlées à **≤ 60 m** du tracé et **≤ 30 km** le long, en
   amont comme en aval ; le couple n'est retenu que si **la grille le
   tarife** — le prix commercial sert de preuve de plausibilité.

### 3.5 Anomalies plutôt qu'échecs

Tout ce qui reste intarifable devient une entrée de `issues` :

| Type | Sens |
|---|---|
| `station-without-network` | gare franchie hors des réseaux couverts (Escota, Atlandes…) |
| `unpaired-entry` | entrée en système fermé restée sans sortie (après replis) |
| `missing-price` | couple ou barrière absent de la grille |

`complete` passe à `false` dès qu'une anomalie existe : **le total est alors
un minorant du vrai prix**, jamais présenté comme certain (voir §4.4 et §6).

---

## 4. L'optimiseur greedy (`RouteOptimizer`)

### 4.1 Candidates initiales

Deux appels Mapbox Directions (profil `driving`, mêmes conditions pour toute
l'optimisation) :

- la **route rapide** + ses alternatives (`alternatives=true`) ;
- la **route sans péage** (`exclude=toll`).

Chacune est tarifée et scorée.

### 4.2 Retirer un tronçon = interdire son couloir

Mapbox sait exclure des points arbitraires : `exclude=point(lon lat)`
(≤ **50 points**, profils driving). Mais exclure seulement les portes
franchies ne suffit pas : Mapbox contourne alors chaque barrière par une
sortie/rentrée aux échangeurs voisins (trajet absurde, prix sous-estimé —
constaté sur l'A6). Il faut interdire **tout le couloir du tronçon** :

1. scan des gares à **≤ 600 m** du tracé courant (`scanStations`) — assez
   large pour attraper les portes de bretelle non franchies ;
2. sélection de celles dont l'abscisse tombe entre l'entrée et la sortie du
   tronçon (**± 1 km**), du même réseau (ou sans réseau connu) ;
3. **≤ 2 points par gare** (les plus proches du tracé), pour tenir dans la
   limite Mapbox — l'A6 entière (24 gares) tient dans le budget de 50 ;
   en cas de dépassement, on garde les portes les plus proches du tracé et
   on émet un `warning`.

### 4.3 La boucle

```
current = route rapide ; exclusions = ∅
répéter (≤ 5 itérations) :
    pour chaque tronçon payant de current :
        candidate = Mapbox(exclusions ∪ couloir du tronçon)   [mémoïsé]
        re-tarifer la candidate ENTIÈRE                        [crucial]
    adopter la meilleure candidate si elle améliore le score pessimiste
    sinon stop
```

**Re-tarifer entièrement** est indispensable : en système fermé, éviter un
tronçon change le couple entrée/sortie de ce qui reste — l'économie réelle
n'est pas le prix du tronçon retiré.

La recommandation finale est la meilleure de **toutes** les routes évaluées
(rapide, alternatives, sans péage, hybrides — adoptées ou non).

### 4.4 Score pessimiste : gérer l'intarifable

Une tarification incomplète sous-estime le prix, donc fausse le score. Mais
écarter toute candidate incomplète produit l'absurde inverse : Rennes→Bilbao
recommandait +4 h 42 de détour parce que les 4 barrières de l'A63
(Atlandes, non couvert) étaient intarifables. La règle est donc une
**pénalité pessimiste** :

```
scorePessimiste = score + (nbAnomalies × 2000 centimes) / ρ
```

Chaque franchissement intarifable est réputé coûter 20 € (l'ordre de
grandeur d'une longue section française). Une route incomplète n'est adoptée
ou recommandée que si son avance survit à cette hypothèse défavorable — et
elle est alors accompagnée d'un `warning` et du drapeau `pricingComplete:
false` que l'UI affiche (⚠️).

Effets validés : Rennes→Bilbao garde sa route rapide (4 h d'avance ≫ 4 ×
20 €) ; l'hybride Paris→Marseille à 18,80 € incomplet reste écarté (avance
insuffisante face à ses inconnues).

### 4.5 Les décisions : rentabilité par tronçon

À la première itération (chaque évitement comparé à la route rapide),
l'optimiseur publie `decisions[]` — pour chaque tronçon payant :

- `extraDurationSeconds` : temps perdu si on l'évite ;
- `savedCents` : économie **réelle** (route d'évitement re-tarifée) ;
- `ratioCentsPerHour` : prix payé par heure gagnée en le gardant
  (0 si l'éviter est gratuit ; négatif impossible, écrêté par l'UI) ;
- `reliable` : faux si l'une des deux routes comparées est incomplète ;
- `keptInBest` : le tronçon est-il sur la route recommandée.

C'est la matière du graphique « € / heure par péage » (ChartPanel) et des
chips €/h du panneau de résultats : une colonne sous la ligne de seuil ρ est
un péage rentable (conservé), au-dessus il est évité.

---

## 5. L'API

`POST /api/optimize` (CSRF Shield actif — le front envoie le cookie
`XSRF-TOKEN` en en-tête) :

```jsonc
// Requête (ordre GeoJSON [lng, lat])
{ "start": [4.8357, 45.764], "end": [2.3522, 48.8566],
  "vehicleClass": 1, "maxPriceCents": 2000, "minutesSaved": 60 }

// Réponse (extraits)
{
  "rhoCentsPerMinute": 33.33,
  "best":    { "kind": "hybrid", "durationSeconds": ..., "geometry": ..., "pricing": ..., "mapboxTolls": [...], "scoreMinutes": ..., "excludedStations": [...] },
  "fastest": { ... }, "noToll": { ... } | null,
  "evaluated": [ /* résumés sans géométrie, triés par score, avec issues */ ],
  "decisions": [ /* rentabilité par tronçon, cf. §4.5 */ ],
  "warnings": [ "..." ]
}
```

Erreurs : `422` (aucun itinéraire, ou payload invalide), `503` (Mapbox
indisponible).

Chaque route évaluée porte `mapboxTolls` : les points de perception que
Mapbox annote sur le tracé (`toll_collection` des intersections, livré
avec `steps=true`), chacun apparié au péage le plus proche du référentiel
local (`match` : gare, réseau, type, sens, voies, distance — ou `null` si
rien à moins de `MATCH_RADIUS_METERS`). C'est ce que la carte affiche.

`POST /api/tolls/match` fait le même appariement pour le front (tracé de
prévisualisation calculé côté client) : `{ "points": [[lng, lat], …] }` →
`{ "matches": [TollMatch | null, …] }`, dans l'ordre de la requête.

---

## 6. Affichage (résumé)

- **RouteSwitcher** : les trois variantes (Recommandé / Le + rapide / Sans
  péage) avec prix (⚠️ si sous-estimé), durée, distance, et la nature du
  recommandé (« évite N péages », « = le + rapide »…). Les trois tracés
  sont dessinés simultanément sur la carte (actif en avant, autres
  estompés) ; la bascule ne change que des filtres de layers — instantanée.
- **ResultsPanel** : écarts vs rapide, liste des péages ✅ conservés /
  🚫 évités (avec ratio €/h et « +N min si évité ») / ❓ intarifables
  (« réseau non couvert », « sortie introuvable »).
- **ChartPanel** : colonnes €/h par péage, ligne de seuil ρ, colonnes
  translucides quand la comparaison est incertaine.
- **Péages sur la carte** : la layer `tolls` n'affiche plus le référentiel
  complet mais les péages que Mapbox annote sur les tracés affichés
  (prévisualisation : extraction côté front + enrichissement via
  `POST /api/tolls/match` ; variantes d'optimisation : `mapboxTolls`
  déjà enrichis par le serveur). La popup montre le nom du référentiel,
  la route, le type, le réseau, la gare, le sens et le nombre de voies ;
  un point sans correspondance est signalé « absent du référentiel local ».
- **Prix des portions sur la carte** : pour la variante active, chaque
  section tarifée est dessinée en surcouche violette (sous-polyligne
  découpée du tracé entre les `alongMeters` d'entrée et de sortie) avec
  une étiquette de prix (« 12,30 € », « ? » si non chiffré). Au survol,
  une popup précise s'il s'agit du **prix de la portion** (couple
  entrée → sortie, système fermé) ou du **prix au passage de la gare**
  (barrière à prix fixe, `exit` nul). Une barrière n'a pas de ligne :
  seulement l'étiquette sur la gare. La bascule de variante ne change que
  les filtres des layers, comme pour les tracés.

---

## 7. Données et import

- **Référentiel des gares** : data.gouv « gares de péage du réseau routier
  national concédé » (`node ace` + admin), reprojeté Lambert 93 → WGS84,
  une ligne par sens. `station_builder_service` regroupe les points en
  gares logiques par nom nettoyé.
- **Grilles tarifaires** : PDF concessionnaires importés par
  `node ace prices:import <réseau> <pdf> --valid-from=AAAA-MM-JJ`
  (parseurs par format dans `app/services/import/parsers/`, résolution des
  libellés vers les gares par code opérateur → alias manuels
  (`station_aliases`, seeders) → nom normalisé ; rapport d'import avec
  lignes non résolues, conflits, asymétries).
- **Couverture actuelle** : ASF, APRR, AREA, Sanef (~209 000 prix, classes
  1 à 5, validité datée). **Trous connus** : Escota (A8/A51/A52…),
  Cofiroute (A10/A11/A28…, barrière Saint-Arnoult), Atlandes + Côte basque
  (A63 — cas Rennes→Bilbao), SAPN/ALIS/ATMB…, soit ~174 gares sans réseau ;
  prix barrière SQF/Voreppe absents du PDF AREA ; l'étranger est totalement
  invisible (référentiel France-only). Ces cas produisent des anomalies,
  jamais des prix silencieusement faux.

### Diagnostic en ligne de commande

```bash
# Tarifer le trajet réel entre deux points (lat,lng)
docker compose run --rm node node ace price:route "45.764,4.8357" "48.8566,2.3522"

# Optimisation complète avec le détail des candidates et décisions
docker compose run --rm node node ace optimize:route "45.764,4.8357" "48.8566,2.3522" --max-price 20 --minutes 60
```

---

## 8. Constantes calibrées

| Constante | Valeur | Rôle / origine |
|---|---|---|
| `DEFAULT_MATCH_THRESHOLD_METERS` | 10 m | corridor de matching — vraies gares ≤ 6 m, adjacentes ≥ 12 m (calibré A1/A6/A7) |
| `CROSSING_WINDOW_METERS` | 500 m | fusion des points d'une même gare en un franchissement |
| `RESCUE_SCAN_METERS` / `RESCUE_RANGE_METERS` | 60 m / 30 km | réparation des orphelins par gares frôlées (cas La Côtière) |
| `CORRIDOR_SCAN_METERS` | 600 m | scan des portes d'un couloir à exclure (bretelles éloignées de la voie) |
| `CORRIDOR_MARGIN_METERS` | 1 km | marge curviligne autour d'un tronçon |
| `MAX_POINTS_PER_STATION` | 2 | budget de points d'exclusion par gare |
| `MAX_EXCLUDE_POINTS` | 50 | limite de l'API Mapbox |
| `MAX_ITERATIONS` | 5 | borne de la boucle greedy |
| `UNPRICEABLE_CROSSING_PENALTY_CENTS` | 2 000 | pénalité pessimiste par franchissement intarifable |
| `MATCH_RADIUS_METERS` | 400 m | appariement point `toll_collection` Mapbox → péage du référentiel : Mapbox annote la chaussée en amont de la barrière (285 m d'écart à Fleury-en-Bière, 224 m à Villefranche-Limas) ; gares voisines séparées d'au moins ~450 m, « le plus proche gagne » |

---

## 9. Validation

- **30 tests unitaires** (`node ace test unit`) : géométrie, matching,
  appariement (dont BPV intermédiaire), replis, réparation, greedy,
  pénalité pessimiste — sur un monde synthétique (autoroute factice à
  45° N, base SQLite de test isolée dans `tmp/test.sqlite3`).
- **Trajets de référence exacts au centime** (grilles 2026, classe 1),
  à re-vérifier après tout changement de matching ou d'appariement :

| Trajet | Prix attendu |
|---|---|
| Lyon → Paris | 41,30 € (Villefranche-Limas → Fleury-en-Bière) |
| Mâcon → Paris | 34,50 € |
| Paris → Lille | 18,90 € (Chamant → Fresnes) |
| Marseille → Lyon | 28,10 € (Lançon → Vienne) |
| Paris → Marseille | 69,40 € (deux sections APRR + ASF) |

- Scénario produit de référence : Lyon → Paris à 20 €/h recommande
  l'hybride **313 min / 3,30 €** (A42 + RCEA), soit 38 € économisés pour
  ~20 min de plus que l'A6.
