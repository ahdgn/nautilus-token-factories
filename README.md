# Nautilus Token Factories — screening des cogénérations gaz en fin de contrat

Outil de screening des **cogénérations au gaz naturel raccordées en HTA** (1 à 20 MW,
gestionnaire Enedis ou entreprise locale de distribution) qui arrivent en fin de contrat
d'obligation d'achat entre 2026 et 2031, ou sont déjà à l'arrêt, et dont le site
(poste de livraison HTA, foncier ICPE, alimentation gaz, sous-station de chaleur)
peut accueillir une **unité de calcul d'inférence modulaire** de 1 à 10 MW.

Source unique à ce stade : le registre national des installations de production et de
stockage d'électricité (ODRÉ, licence ouverte, réédité chaque mois). Aucune donnée n'est
inventée : un champ inconnu reste vide.

## Résultat de l'étape 1 (registre au 31/07/2026)

| Périmètre | Unités | MW |
|---|---|---|
| Thermique gaz, Enedis ou ELD, 1 à 20 MW (décision D1) | 654 | 2 600 |
| dont mise en service 1995-2010 | 212 | 962 |
| dont 1995-2010 et facteur de charge < 5 % (« dormantes ») | 126 | 607 |
| Dormantes, toutes années de mise en service | 230 | 1 010 |
| **Cible (décision D2)** : dormantes + unités sortant de l'obligation d'achat entre 2026 et 2031, actives comprises (mise en service ≤ 2019) | **612** | **2 466** |

## Décisions prises (26/09/2026)

| # | Décision |
|---|---|
| D1 | Périmètre réseau : Enedis et entreprises locales de distribution, 1 à 20 MW. Les unités RTE (HTB) restent hors périmètre. |
| D2 | Cible : dormantes (toutes cohortes) + unités dont l'obligation d'achat s'éteint entre 2026 et 2031, actives comprises. Champ `cible` du jeu de données ; la fenêtre de sortie est dans `fenetre_sortie`. |
| D3 | Dépôt public. Le projet s'appelle « Nautilus Token Factories » ; il ne cite aucun partenaire. |
| D4 | Sources payantes (Pappers, etc.) : validation préalable avant chaque usage, avec nombre d'appels et coût. |
| D5 | Régions prioritaires pour la qualification manuelle : Île-de-France, Hauts-de-France, Normandie. |

## Lancer

Application publique : **https://ahdgn.github.io/nautilus-token-factories/** (GitHub Pages, branche `main`).

En local :

```bash
python tools/build_datasets.py      # 1. registre ODRÉ → data/cogenerations_gaz.json + data/meta.json (centroïdes de commune)
python tools/geocode_icpe.py        # 2. appariement Géorisques (ICPE 2910) : position réelle, SIRET, régime ; cache tools/cache/icpe_2910.json (~2 min la première fois), rapport tools/icpe_report.json
python tools/check_geo.py           # 3. contrôle géométrique (centroïdes et positions ICPE) : rapport dans tools/geo_report.json
python tools/check_geo.py --apply   #    applique les corrections (région, coordonnées hors de France, position ICPE douteuse → centroïde) dans data/
python tools/enrich_heat.py         # 4. réseaux de chaleur (France Chaleur Urbaine) : réseau le plus proche, distance au tracé, classe, gestionnaire, mix ; cache tools/cache/opendata-fcu.zip (62 Mo, une fois), rapport tools/heat_report.json, couche data/reseaux_chaleur.geojson
python tools/geocode_icpe.py --restore   # retour arrière : centroïdes rétablis, champs icpe_* retirés
python tools/enrich_heat.py --restore    # retour arrière : champs rc_* retirés, couche supprimée
```

L'ordre compte : `build_datasets.py` repart de zéro (centroïdes, sans champs ICPE ni réseau de chaleur),
`geocode_icpe.py` enrichit, `check_geo.py` contrôle le résultat, `enrich_heat.py` vient en dernier
(la distance au réseau se mesure depuis la position ICPE quand il y en a une ; il est à relancer après
tout changement de position). Dépendances : `shapely` (contrôle géométrique, distances aux tracés) ;
aucune clé d'API, aucune source payante.

```bash
python -m http.server 8000      # puis http://localhost:8000 : carte, filtres, graphiques, tableau, fiches, export CSV
```

L'application est statique (Leaflet et Chart.js vendorisés, aucun backend, seule dépendance en
ligne : les fonds de carte Esri). Elle fonctionne telle quelle sur GitHub Pages (chemins relatifs).
L'état des filtres est dans l'URL (`#c=0&r=Île-de-France|Normandie…&rad=48.8566,2.3522,25`), donc partageable.
Le filtre « Cible D2 » est coché par défaut (612 sites, 2 466 MW) ; décoché, tout le périmètre
D1 s'affiche (654 sites, 2 600 MW).

Outil de rayon (étape 3) : bouton « Rayon » (barre latérale ou ⌖ sur la carte) puis clic sur la
carte, ou lien « Rayon » du popup d'un site ; rayons 5, 10, 25 ou 50 km (défaut `rayon_km_defaut`
dans `tools/screening_params.json`) ; nombre de sites et MW dans le cercle affichés dans la barre
latérale ; l'interrupteur « Ne garder que les sites dans le rayon » restreint carte, graphiques et
tableau. Fond « Satellite » et case « Contours des régions » dans la légende de la carte.

Positions réelles (étape 4) : les sites appariés à un établissement de la base des installations
classées (Géorisques, rubrique 2910 combustion) sont placés sur cet établissement, avec un marqueur
cerclé ; les autres restent au centroïde de leur commune. Filtre « Précision de position », KPI
« Positions ICPE », section « Installation classée » dans la fiche (exploitant ou hôte, SIRET avec
lien vers l'annuaire des entreprises, régime, puissance thermique, fiche Géorisques), colonne « ICPE »
du tableau et 19 colonnes supplémentaires dans l'export CSV (52 au total). Un appariement « moyen » est à relire
(liste dans `tools/icpe_report.json`) ; un site sans appariement garde des champs ICPE vides.

Réseaux de chaleur (étape 5) : chaque site est rattaché au réseau de chaleur le plus proche des tracés
ouverts de France Chaleur Urbaine (distance en mètres au tracé, mesurée en Lambert-93 depuis la position
ICPE ou le centroïde de commune) : « sur le réseau » (≤ 300 m), « proche » (300 m à 1 km), « dans la
commune » (plus loin, mais un réseau y est recensé) ou « aucun ». Résultat du 26/09/2026 sur les 654
sites : 150 sur le réseau (733 MW), 83 proches (338 MW), 125 dans la commune (439 MW), 296 sans réseau
(1 090 MW) ; 144 cibles D2 sur le réseau (716 MW). Filtres « Réseau de chaleur » (classe) et
« Gestionnaire du réseau de chaleur », KPI « Sur / proche d'un réseau », case « Tracés des réseaux de
chaleur » dans la légende (couche chargée à la demande, réseaux rattachés seulement), section « Réseau de
chaleur » de la fiche (nom, gestionnaire, distance, taux EnR&R, mix, MWh livrés, fiche France Chaleur
Urbaine), colonne du tableau et 22 colonnes CSV supplémentaires (74 au total). Pour 477 sites la distance
part du centroïde de commune, pas du site : « sur le réseau » y signifie que le tracé passe par le centre
de la commune.

## Structure

| Chemin | Rôle |
|---|---|
| `tools/screening_params.json` | Seuils du screening (puissance, cohortes, facteur de charge, échéance), réglages de l'outil de rayon (`rayons_km`, `rayon_km_defaut`), appariement ICPE (`icpe`) et réseaux de chaleur (`reseaux_chaleur` : 300 m / 1 km, couche carte, composition du mix) : la config, jamais le code |
| `tools/build_datasets.py` | ETL : registre ODRÉ filtré (filière thermique non renouvelable, combustible gaz, hors RTE, 1-20 MW, **sans filtre technologie**), géocodé au centroïde de commune, enrichi (cohorte, facteur de charge, statut, fin de contrat initial, fenêtre de sortie, cible D2, usage probable) |
| `tools/geocode_icpe.py` | Appariement Géorisques (étape 4) : pour chaque cogénération, établissements de la base des installations classées de sa commune (API REST, licence ouverte) portant une rubrique de combustion 2910 / 3110, score nom × puissance thermique × nature (seuils dans `screening_params.json`, clé `icpe`), position réelle (`geo_precision` = « icpe », centroïde conservé dans `lat_commune` / `lon_commune`), SIRET, raison sociale, régime, alinéa et puissance thermique, état, Seveso, confiance forte / moyenne / aucune ; rapport `tools/icpe_report.json` ; `--restore` remet le centroïde |
| `tools/cache/icpe_2910.json` | Cache des établissements ICPE des 406 communes du jeu (ignoré par git, ~5 Mo, reconstruit par `geocode_icpe.py`, `--refresh` pour retélécharger) |
| `tools/icpe_report.json` | Dernier rapport d'appariement : sites testés, avec candidats, appariés forte / moyenne, sans appariement, régimes, distribution des distances centroïde → ICPE, liste des appariements moyens à relire et des refus avec candidats |
| `tools/check_geo.py` | Contrôle géométrique (étape 3) : chaque site testé contre le contour de sa région ; rapport `tools/geo_report.json` ; `--apply` corrige `region` (point dans une autre région) ou retire `lat`/`lon` (point hors de France) ; tolérance de 2 km au contour (communes littorales ou frontalières) ; une position ICPE hors région ou hors de France revient au centroïde (étape 4). Dépendance : `shapely` |
| `tools/geo/regions.geo.json` | Contours des 13 régions métropolitaines, copiés du dépôt `biomethane-france` : france-geojson (dérivé d'IGN Admin Express), licence ouverte. Servis tels quels à la carte (case « Contours des régions ») |
| `tools/geo_report.json` | Dernier rapport du contrôle géométrique (testés, conformes, tolérance frontalière, hors région, hors France, sans coordonnées, anomalies) |
| `tools/enrich_heat.py` | Réseaux de chaleur (étape 5) : télécharge une fois le ZIP « Tracés des réseaux de chaleur et de froid » de France Chaleur Urbaine (data.gouv.fr, licence ouverte, 1 033 tracés en Lambert-93 avec identifiant SNCU, gestionnaire, taux EnR&R, mix, livraisons ; 218 réseaux sans tracé ; 219 périmètres de développement prioritaire), projette chaque site en Lambert-93 (formules IGN, sans pyproj), mesure la distance au tracé le plus proche (shapely), classe le site (seuils dans `screening_params.json`, clé `reseaux_chaleur`), écrit les champs `rc_*`, le rapport `tools/heat_report.json`, la couche `data/reseaux_chaleur.geojson` et le millésime ; `--refresh` retélécharge, `--restore` retire tout |
| `tools/cache/opendata-fcu.zip` | Cache du ZIP France Chaleur Urbaine (ignoré par git, 62 Mo, édition dans `opendata-fcu.meta.json`) |
| `tools/heat_report.json` | Dernier rapport de rattachement : source et édition, distribution des distances, répartition par classe (sites, MW), réseaux et gestionnaires les plus fréquents, cibles D2 sur le réseau, sites « dans la commune », taille de la couche carte |
| `data/` | `cogenerations_gaz.json` (un objet par installation), `meta.json` (millésimes), `reseaux_chaleur.geojson` (tracés WGS84 fusionnés et simplifiés des 213 réseaux rattachés à au moins un site, 4,4 Mo ; la couche complète des 1 033 réseaux ferait 8,6 Mo, au-delà du seuil de 5 Mo fixé dans les paramètres) |
| `index.html` | Application carte (étape 2) : filtres, KPI, carte, graphiques, tableau, fiche du site, note de source |
| `js/config.js` | Palette Nautilus, couleurs par statut, fenêtres de sortie, tranches de puissance, précision de position (site ICPE / centroïde), confiance ICPE, classes de réseau de chaleur et couleurs du mix, normalisation du jeu de données, liens ODRÉ / Google Maps / annuaire des entreprises, formats fr-FR ; seuils lus dans `tools/screening_params.json` |
| `js/filters.js` | Filtres (cible D2, statut, fenêtre, cohorte, région, usage, puissance, précision de position, réseau de chaleur, gestionnaire du réseau de chaleur, gestionnaire électrique, nom masqué, recherche sur nom / commune / poste source / raison sociale ICPE / SIRET / nom du réseau), outil de rayon (centre, km, compteur sites / MW, interrupteur « dans le rayon »), sept KPI dont « Positions ICPE » et « Sur / proche d'un réseau », état synchronisé dans l'URL (`rc=`, `rg=`) |
| `js/map.js` | Carte Leaflet : marqueurs proportionnels à la puissance et colorés par statut, **cerclés quand la position vient de la base ICPE**, légende cliquable, fond clair / satellite, contours des régions, tracés des réseaux de chaleur (à la demande, survol = nom et gestionnaire, clic = fiche France Chaleur Urbaine), cercle de rayon et mode pointage, popup et fiche complète avec sections « Installation classée » (raison sociale, SIRET → annuaire des entreprises, régime, rubrique 2910, puissance thermique, état, Seveso, confiance, fiche Géorisques) et « Réseau de chaleur » (classe, réseau, gestionnaire, distance, PDP, taux EnR&R, CO2, mix, production, livraisons, points de livraison, année, fiche) |
| `js/charts.js` | Graphiques Chart.js : cohorte × statut, MW par région, unités par tranche et par usage |
| `js/table.js` | Tableau trié et paginé, clic = zoom + fiche, export CSV du jeu filtré (`;`, UTF-8 avec BOM) |
| `js/fiche.js` | Panneau « Fiche du site » (lecture seule ; la qualification viendra à l'étape 8) |
| `js/app.js` | Chargement des données et des paramètres, onglets, panneau redimensionnable, pied de page depuis `data/meta.json` |
| `css/`, `vendor/`, `assets/` | Feuille de style Nautilus, Leaflet + MarkerCluster + Chart.js + fontes Roboto vendorisés, logos (repris du dépôt `biomethane-france`) |
| `docs/` | Notes de recherche du 25/09/2026 : parc et contrats (A), sources de données (B), précédents et faisabilité (C) |
| `METHODOLOGIE.md` | Logique du screening et choix de design, mise à jour à chaque règle modifiée |
| `BACKLOG.md` | Plan par étapes, une PR par étape, décisions en attente |

## Règles de travail

- Toute évolution passe par une branche et une PR **ciblant `main`** ; pas d'empilement de PR.
- Les seuils vivent dans `tools/screening_params.json`, jamais en dur dans le code.
- Aucun appel payant (Pappers, etc.) sans accord préalable sur le nombre d'appels et le coût.
- `METHODOLOGIE.md` est mis à jour dans la même PR qu'une règle.
- Les exports Excel et mémos pour les partenaires vivent dans OneDrive
  (`Nautilus Business/8__Intelligence hub/Compute capacity/`), pas dans ce dépôt.

## Unités

- Puissance : **MW électriques** (`puismaxinstallee` du registre, en kW, divisé par 1 000).
- Énergie : **MWh électriques injectés sur 12 mois glissants** (`energieannuelleglissanteinjectee`, en kWh).
  Ce n'est pas la production : un site en autoconsommation apparaît « dormant » à tort.
