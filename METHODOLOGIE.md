# Méthodologie — v0.5 (26/09/2026)

Ce document explique la logique du screening et les choix de design. Il est mis à jour
dans la même PR que toute règle modifiée. Les seuils sont dans `tools/screening_params.json`.

## 1. Question posée

Quels sites de cogénération au gaz naturel, raccordés en HTA, arrivent en fin de contrat
d'obligation d'achat ou sont déjà à l'arrêt, tout en conservant un raccordement, un foncier
industriel et souvent une sous-station de chaleur, et peuvent accueillir une unité de calcul
d'inférence de 1 à 10 MW ?

## 2. Source et périmètre

- **Source** : ODRÉ, « Registre national des installations de production et de stockage
  d'électricité », édition mensuelle, API Opendatasoft Explore v2.1, licence ouverte.
- **Filtre** : `filiere = "Thermique non renouvelable"` et `codecombustible = "GAZ"`,
  gestionnaire différent de RTE, puissance installée de 1 000 à 20 000 kW.
- **Pas de filtre sur la technologie.** Les cogénérations anciennes sont classées « Autre »
  (221 lignes) ou sans technologie (163 lignes) ; un filtre « Cogénération » ne retient que
  12 % des unités mises en service entre 1995 et 2010. Le registre ne distingue pas non plus
  une cogénération d'un moteur de secours ou d'une turbine : le nom de l'installation et la
  qualification terrain font la différence.
- **Exclusions** : les installations raccordées à RTE (148 unités gaz, HTB), qui relèvent d'une
  logique « powered land » classique ; les DOM (EDF SEI).

## 3. Champs dérivés

| Champ | Règle | Confiance |
|---|---|---|
| `puissance_mw` | `puismaxinstallee` / 1 000 | Élevée |
| `annee_mes` | Année de `datemiseenservice_date` ; en pratique la date de raccordement, une rénovation ne la modifie pas | Moyenne |
| `cohorte` | avant 1995 ; 1995-2010 ; 2011-2014 ; 2015 et après (seuils dans les paramètres) | Élevée |
| `facteur_charge` | `energieannuelleglissanteinjectee` / (`puismaxinstallee` × 8 760) | Moyenne : injection ≠ production |
| `statut` | Dormante si facteur de charge < 5 % ; faible de 5 à 15 % ; active au-delà ; non renseigné si l'énergie est absente. Une cogénération sous contrat C13 tourne du 1er novembre au 1er avril, soit 30 à 50 % attendus | Moyenne |
| `fin_contrat_initial` | `annee_mes` + 12 (durée des contrats C97, C01, C13). Une rénovation sous C13 a pu prolonger le soutien jusqu'au 1er janvier 2031 au plus tard | Faible : indicatif |
| `fenetre_sortie` | « 2026-2031 » si `annee_mes` + 12 est dans la fenêtre ; « contrat initial échu (≤ 2025), sortie au plus tard 2031 si rénové » si `annee_mes` + 12 < 2026 ; « hors obligation d'achat (MES ≥ 2020) » au-delà de 2019, le décret 2020-1079 ayant fermé tout nouveau soutien | Moyenne |
| `cible` | Décision D2 : vrai si `statut` = dormante, ou si `annee_mes` ≤ 2019 (tout contrat d'achat de 12 ans encore en cours s'éteint avant le 01/01/2031, RTE). 612 unités sur 654 : le filtre est large par construction, ce sont les filtres de l'application et le score v1 qui hiérarchisent | Moyenne |
| `usage_probable` | Mots-clés du nom (industrie, hôpital, réseau de chaleur, serres, campus) ; « À qualifier » sinon | Faible : indicatif |
| `lat`, `lon` | Position de l'établissement ICPE apparié (Géorisques, § 8) quand l'appariement est fort ou moyen (`geo_precision` = « icpe », centroïde conservé dans `lat_commune` / `lon_commune`) ; sinon centroïde de la commune d'implantation (geo.api.gouv.fr) par code INSEE, sinon par nom et département (`geo_precision` = « commune ») ; contrôlé contre le contour de la région (§ 7) | Site (178) / commune (476) |
| `icpe_*` | Établissement ICPE apparié (§ 8) : SIRET, raison sociale, adresse, régime, rubrique 2910 (alinéa, régime, puissance thermique MW), état, Seveso, code AIOT et fiche Géorisques, confiance (forte / moyenne / aucune), score, nombre de candidats dans la commune, distance au centroïde. Vides sans appariement | Forte : élevée ; moyenne : à relire |
| `rc_*` | Réseau de chaleur le plus proche (§ 9, France Chaleur Urbaine) : `rc_classe` (sur le réseau / proche / dans la commune / aucun), `rc_distance_m` (au tracé, Lambert-93), identifiant SNCU, nom, gestionnaire, maître d'ouvrage, fiche, tracé publié ou non, réseau dans la commune, PDP, taux EnR&R, CO2, mix (% de la production : gaz, biomasse, géothermie, UVE, autres), production, livraisons, points de livraison, année de création, réseau classé. Vides si absents de la source | Distance : élevée depuis une position ICPE, moyenne depuis un centroïde ; données d'enquête : 2023-2024 |

## 4. Limites connues

1. Le registre ne contient que les installations encore raccordées (`regime` = « En service ») :
   les cogénérations déjà déraccordées n'y figurent plus. C'est cohérent avec la cible
   (sites gardant leur raccordement) mais interdit de mesurer le parc démantelé.
2. L'énergie injectée n'est pas la production : un site industriel en autoconsommation
   apparaît dormant à tort (exemple vérifié : Norenergy à Blendecques, papeterie).
   Inversement, deux contrôles positifs : Parly 2 (géothermie) et Vaulx-en-Velin (biomasse).
3. 225 des 654 noms sont « Confidentiel » (51 parmi les 126 dormantes 1995-2010). La commune,
   le poste source et la puissance restent disponibles.
4. Ni l'exploitant, ni le propriétaire, ni le régime d'achat, ni les coordonnées exactes ne
   figurent dans le registre. L'appariement Géorisques (§ 8) apporte position, SIRET et régime
   ICPE pour 178 sites (27 %) ; France Chaleur Urbaine (§ 9) donne le réseau de chaleur voisin et son
   gestionnaire pour 358 sites ; restent prévus SIRENE, puis Pappers sur accord.
5. Aucune liste nominative des contrats d'obligation d'achat n'est publiée (EDF OA, CRE, ATEE).

## 5. Vérifications faites (25/09/2026)

- Comptages recoupés avec une seconde extraction indépendante (213 lignes 1995-2010 contre 212 :
  l'écart est une unité RTE en 90 kV, hors périmètre).
- Trois contrôles web sur les noms les plus puissants (voir limite 2).

## 6. Ce que le score v1 devra pondérer (étape 7)

Raccordement (HTA, 3 à 12 MW, poste source urbain, capacité de soutirage relevée),
dormance et échéance, site (réseau de chaleur, ICPE, foncier, PLU), acteurs (exploitant
identifié, hôte public ou privé), marché (métropole, fibre, densité de demande).
Pondérations à fixer avec l'équipe après la décision D2.

## 7. Contrôle géométrique (étape 3, 26/09/2026)

- **Règle** (`tools/check_geo.py`, reprise du dépôt biométhane) : chaque site est testé contre le
  contour de la région que le registre lui attribue (`tools/geo/regions.geo.json` : france-geojson,
  dérivé d'IGN Admin Express, licence ouverte). Point dans une autre région → la géométrie fait foi,
  `region` est corrigée avec `--apply` et l'ancienne valeur conservée dans `region_registre`. Point
  hors de France métropolitaine → coordonnées jugées fausses, `lat`/`lon` retirés et `geo_precision`
  mis à `null` avec `--apply` (le site reste dans le tableau, plus sur la carte). Point à moins de
  2 km (0,02°) du contour de la région déclarée → bénéfice du doute, inchangé : le centroïde d'une
  commune littorale ou frontalière peut tomber en mer ou de l'autre côté de la frontière sans que la
  commune soit fausse. Cette tolérance s'applique aussi au verdict « hors de France », ajout par
  rapport au patron.
- **Résultat du 26/09/2026** (`tools/geo_report.json`) : 654 sites testés, 652 conformes, 2 en
  tolérance frontalière (Perros-Guirec, Bretagne : centroïde à 0,16 km en mer, les Sept-Îles tirent
  le centre de la commune vers le large ; Wattrelos, Hauts-de-France : centroïde à 0,01 km de la
  frontière belge), 0 hors région, 0 hors de France, 0 sans coordonnées. Aucune correction appliquée,
  `data/cogenerations_gaz.json` inchangé, KPI inchangés (cible 612 / 2 466 MW).
- **Outil de rayon** : distance à vol d'oiseau (haversine, rayon terrestre 6 371 km) entre le centre
  choisi et le centroïde de commune de chaque site ; rayons proposés et défaut dans
  `tools/screening_params.json` (`rayons_km`, `rayon_km_defaut`). Le compteur « sites · MW dans le
  rayon » respecte les autres filtres ; la précision est celle du centroïde de commune, pas du site.

## 8. Appariement Géorisques, installations classées (étape 4, 26/09/2026)

- **Source** : Géorisques, base des installations classées, API REST
  `https://georisques.gouv.fr/api/v1/installations_classees` (BRGM, licence ouverte 2.0, gratuite,
  1 000 requêtes/min). Le filtre `rubrique` de l'API est ignoré (138 675 résultats avec ou sans,
  vérifié le 26/09/2026) ; le filtre `code_insee` fonctionne et `page_size=1000` renvoie une commune
  entière en une requête. `tools/geocode_icpe.py` interroge donc une fois chacune des 406 communes du
  jeu (pause 0,25 s, reprise sur erreur 429 / 5xx) et met tous leurs établissements en cache, allégés
  (`tools/cache/icpe_2910.json`, ignoré par git) : 13 336 établissements, dont 603 portent une
  rubrique de combustion (2910, ou 3110 pour les grandes chaufferies IED ≥ 50 MW) dans 199 communes.
  Le patron biométhane utilisait la couche WFS BRGM filtrée sur la rubrique 2781 ; l'API REST est
  préférée ici parce qu'elle donne les rubriques avec alinéa et quantité (puissance thermique en MW).
- **Ce que contient la base** : les établissements à autorisation ou enregistrement, avec leurs
  rubriques chiffrées ; et des fiches « Autres régimes » ou « Non ICPE » (déclarations, dossiers
  anciens) qui ont une position, un SIRET et une raison sociale mais aucune rubrique. Exemples :
  « DALKIA - (CH René DUBOS - local cogé) » à Pontoise, « SA LESAFFRE FRERES » à Nangis,
  « Gennevilliers Energie » (SIRET d'Engie Réseaux). Une cogénération seule (2910-A.2, 1-20 MW
  thermiques : déclaration ou enregistrement) n'apparaît que si son dossier a été saisi ou si
  l'établissement hôte est classé.
- **Candidats** : établissements de la même commune (code INSEE) portant une rubrique 2910 ou 3110,
  plus les fiches sans rubrique dont la raison sociale concorde avec le nom de l'installation
  (similarité ≥ `seuil_nom_fort` = 0,5). Aucune recherche par rayon : un établissement d'une commune
  voisine n'est jamais retenu.
- **Score** (`tools/screening_params.json`, clé `icpe`) : moyenne pondérée des composantes
  disponibles, poids nom 0,5 / puissance 0,3 / nature 0,2 ; une composante inconnue est retirée du
  dénominateur, elle ne pénalise ni ne favorise.
  - *Nom* : après normalisation (accents, ponctuation, minuscules), retrait des mots creux
    (formes juridiques, « cogénération », « énergie », « chaufferie »…), des jetons du nom de la
    commune (présents des deux côtés sans rien prouver) et synonymes (hôpital, CH, CHU, clinique →
    un même jeton) ; score = part des jetons significatifs partagés, y compris par préfixe
    (LESAFFRE / LESAFFRE FRERES), ou ratio de séquence s'il dépasse 0,9. Sans objet pour les 225
    noms « Confidentiel ».
  - *Puissance* : rapport puissance thermique de combustion (MW, la plus grande ligne 2910 / 3110,
    une valeur « MW » > 500 est lue en kW) sur puissance électrique du registre : 1 si 1,8 ≤ r ≤ 3,5
    (rendement électrique 30-55 %) ; 0,6 si 1 ≤ r ≤ 8 ; 0,3 au-delà (établissement hôte avec
    d'autres chaudières : chaufferie de réseau, sucrerie) ; 0 si r < 1 (incompatible). Sans objet
    pour une fiche sans rubrique chiffrée.
  - *Nature* : usage probable du site (§ 3) contre famille de l'établissement, déduite de la raison
    sociale (expressions régulières) et de la division NAF (35 énergie, 86-87 santé, 01 agriculture,
    10-33 industrie, 85 / 93 campus) : 1 si concordance, 0,75 si un énergéticien porte la cogé d'un
    hôpital ou d'un campus, 0,5 sans indice, 0 si contradiction.
  - *Bonus* + 0,1 si la raison sociale mentionne la cogénération (« local cogé », « COGE DU
    COSQUER ») ; malus × 0,5 si l'établissement est en cessation d'activité.
- **Décision** : « forte » si le nom concorde (≥ 0,5) et le score atteint 0,6, ou si le candidat est
  unique avec puissance et nature concordantes ; pour une fiche sans rubrique, « forte » exige en
  plus des noms identiques, une nature concordante ou la mention de la cogénération (un nom de
  quartier partagé, « COGENERATION CHATEAUCREUX » / « CARROSSERIE DE CHATEAUCREUX », ne suffit pas) ;
  « moyenne » si le score atteint 0,55, ou 0,4 pour un candidat unique plausible ; « aucune » sinon,
  et toujours si la puissance est contradictoire sans nom probant. Un second candidat (autre SIRET)
  à moins de 0,15 du premier ramène « forte » à « moyenne » ; à moins de 0,05 et nom masqué, on ne
  tranche pas (« aucune »). La position ICPE n'est appliquée que sous 15 km du centroïde (aucun
  cas au-delà de 5,9 km).
- **Résultat du 26/09/2026** (`tools/icpe_report.json`) : 654 sites testés, 357 avec au moins un
  candidat, 74 appariements forts, 104 moyens, 476 sans appariement (taux 27 %) ; 178 sites
  positionnés sur leur établissement (870 MW ; 167 dans la cible D2, 820 MW). Régimes retenus :
  61 autorisation, 58 enregistrement, 50 « Autres régimes », 9 « Non ICPE » ; 92 fiches avec
  rubrique chiffrée (2910-A.1 : 22, 2910-A.2 : 49, 2910-B.1 : 2, 3110 : 19), 86 sans. Distance
  centroïde → ICPE : médiane 1,5 km, maximum 5,9 km. Contrôle géométrique relancé : 178 positions
  ICPE testées, 0 hors région, 0 hors de France ; KPI par défaut inchangés (612 / 2 466 MW).
- **Retour arrière** : `python tools/geocode_icpe.py --restore` (centroïdes rétablis, champs
  `icpe_*` retirés) ; `check_geo.py --apply` ramène au centroïde toute position ICPE qui sortirait
  de sa région.
- **Limites** : (1) la base ne liste que les établissements classés A/E et les déclarations
  saisies : 297 sites n'ont aucun candidat dans leur commune, dont « BONDY ENERGIE » ; (2) homonymies
  et sites multi-établissements : « Cogénération Caucriauville » au Havre reste sans appariement
  parmi 10 candidats (deux réseaux de chaleur, Résocéane et Mont-Gaillard, sans lien de nom) ;
  (3) 48 des 104 appariements moyens concernent des noms « Confidentiel » retenus sur la seule
  cohérence de puissance (et de nature) avec un candidat nettement dominant : à relire un par un
  avant usage nominatif ; (4) la position ICPE est celle de l'établissement, parfois son siège ou
  son entrée, pas celle du groupe de cogénération ; (5) un même SIRET peut porter plusieurs fiches
  (sucrerie et « SA LESAFFRE FRERES » à Nangis) : la fiche la mieux nommée est retenue, l'autre
  n'est pas comptée comme ambiguïté ; (6) la puissance thermique de la rubrique est celle de
  l'établissement entier (chaudières comprises), d'où la tolérance large du rapport.

## 9. Réseaux de chaleur, France Chaleur Urbaine (étape 5, 26/09/2026)

- **Source** : France Chaleur Urbaine, « Tracés des réseaux de chaleur et de froid », data.gouv.fr,
  licence ouverte 2.0, mise à jour mensuelle (édition du 14/09/2026 utilisée, ZIP de 62 Mo, mis en
  cache dans `tools/cache/`, non commité). Structure vérifiée sur place : `reseaux_de_chaleur.geojson`,
  1 033 tracés MultiLineString **en Lambert-93 (EPSG:2154)**, 2,2 millions de sommets, avec l'identifiant
  national SNCU (`Identifiant reseau`, vide pour 192 tracés), le nom, les communes (noms séparés par des
  virgules, sans code INSEE), le maître d'ouvrage, le gestionnaire, le classement, l'année de création,
  les points de livraison, le taux EnR&R et le contenu CO2 (arrêté DPE, année 2023 ou moyenne
  2021-2023), la production par source et les livraisons par secteur (enquête SNCU / Fedene 2024) ;
  `reseaux_de_chaleur_sans_traces.geojson`, 218 réseaux recensés sans tracé, en point au centroïde de
  commune ; `pdp.geojson`, 219 périmètres de développement prioritaire. Le mix et les MWh sont donc dans
  le jeu : l'API de France Chaleur Urbaine n'est pas appelée (pour mémoire, `GET /api/v1/networks`
  renvoie la même liste en un appel de 63 Mo ; il n'y a pas d'accès par identifiant, et la fiche
  `/reseaux/<id>` embarque les mêmes champs dans son JSON de page).
- **Règle** (`tools/enrich_heat.py`, seuils dans `tools/screening_params.json`, clé `reseaux_chaleur`) :
  1. le point du site (position ICPE quand elle existe, § 8 ; sinon centroïde de commune) est projeté en
     Lambert-93 par les formules IGN (GRS80 ; vérification : origine (3° E, 46,5° N) → (700 000,
     6 600 000) exact, 1 km de latitude → 999,97 m ; aucune dépendance à pyproj) ;
  2. distance euclidienne en mètres au tracé le plus proche (shapely, index STRtree), jamais en degrés ;
  3. classe : **« sur le réseau »** si la distance est ≤ `sur_reseau_m` (300 m) ; **« proche »** si
     ≤ `proche_m` (1 km) ; **« dans la commune »** au-delà, quand un réseau (tracé ou sans tracé) liste
     la commune du site dans `communes` (noms normalisés : accents, ponctuation, St/Ste, arrondissements)
     et que son tracé, ou son point, reste sous `dans_commune_distance_max_km` (30 km, pour écarter un
     homonyme d'un autre département) ; **« aucun »** sinon ;
  4. le réseau retenu (`rc_*`) est le plus proche ; pour « dans la commune », le plus proche de ceux qui
     listent la commune, tracé de préférence (un réseau sans tracé donne une distance vide) ; pour
     « aucun », le tracé le plus proche est indiqué avec sa distance, à titre indicatif ;
  5. `rc_dans_commune` (un réseau liste la commune) et `rc_pdp` (point du site dans un périmètre de
     développement prioritaire publié) sont calculés pour tous les sites ; le mix est exprimé en % de la
     production totale (gaz naturel ; biomasse solide + biogaz ; géothermie ; UIOM ; autres = charbon,
     fioul, GPL, déchets internes, PAC, solaire, chaleur industrielle et récupérée, chaudières électriques,
     autres) et vide si la production est absente ou nulle. Aucun champ n'est inventé.
- **Résultat du 26/09/2026** (`tools/heat_report.json`) : 654 sites testés ; **150 sur le réseau
  (733 MW), 83 proches (338 MW), 125 dans la commune (439 MW), 296 sans réseau (1 090 MW)** ; 144 cibles
  D2 sur le réseau (716 MW), 220 cibles D2 sur ou proches (1 039 MW). Distances au tracé le plus proche :
  médiane 2,26 km, maximum 49 km ; 353 sites ont un réseau recensé dans leur commune, 81 sont dans un
  PDP ; 338 des 358 sites rattachés ont un mix renseigné (les 20 autres sont sur un tracé sans
  identifiant SNCU, donc sans données d'enquête), 13 sont rattachés à un réseau sans tracé. Réseaux les
  plus fréquents : Nantes (11 sites), Thassalia Marseille (9), Plougastel-Daoulas (8), Arques (7),
  Amiens (7) ; gestionnaires : Dalkia et filiales, Engie Solutions et filiales, Idex, Coriance. KPI par
  défaut inchangés (612 / 2 466 MW).
- **Contrôles manuels** (8) : Cogénération Caucriauville (Le Havre, centroïde) sur le réseau à 1 m de
  ResOcéane (Dalkia, EnR&R 14 %, gaz 86 %) ; Parly (Le Chesnay-Rocquencourt, ICPE) à 3 m de Parly II
  (Engie Solutions, gaz 100 %) ; Cogénération Grande Île (Vaulx-en-Velin, centroïde) à 46 m du réseau de
  Vaulx-en-Velin (Dalkia, biomasse 69 %) ; Gennevilliers Énergie (ICPE) à 227 m du réseau de
  Gennevilliers (Engie Solutions) ; Bondy Énergie (centroïde) « proche » à 582 m du réseau de Bondy
  (Coriance) ; Société Orléanaise de Distribution de Chaleur (centroïde) « dans la commune », à 2,2 km du
  tracé Socos source (Dalkia), le centroïde d'Orléans n'étant pas la chaufferie ; deux cogénérations de
  serres du Trégor, SARL Les Reflets (Pleumeur-Gautier) et Coge Kerfiet (Camlez), « aucun » (tracé le
  plus proche à 6,4 et 4,9 km).
- **Couche carte** : `data/reseaux_chaleur.geojson`, WGS84, tracés fusionnés (linemerge) puis simplifiés
  (Douglas-Peucker 25 m, cinq décimales) ; la couche complète des 1 033 réseaux pèserait 8,6 Mo, au-delà
  du seuil `taille_max_mo` (5 Mo), donc seuls les 213 réseaux rattachés à au moins un site sont commités
  (4,4 Mo) ; chargée à la demande depuis la légende.
- **Retour arrière** : `python tools/enrich_heat.py --restore` (champs `rc_*` retirés, couche et
  millésime supprimés). À relancer après `geocode_icpe.py` ou `check_geo.py --apply`, puisque la distance
  part de la position courante du site.
- **Limites** : (1) pour 477 sites la distance part du centroïde de commune, pas du site : « sur le
  réseau » y signifie que le tracé passe par le centre de la commune, et « proche » ou « aucun » peuvent
  être faux dans les deux sens (Orléans, Bondy) ; les 177 positions ICPE sont fiables au niveau de
  l'établissement ; (2) les tracés sont collectés auprès des collectivités et exploitants et restent
  parfois partiels ou absents (218 réseaux sans tracé, 192 tracés sans identifiant SNCU) : un site peut
  être « dans la commune » ou « aucun » alors qu'une canalisation passe devant ; (3) le mix, la production
  et les livraisons datent de l'enquête 2024 (taux EnR&R et CO2 : 2023 ou moyenne 2021-2023) et peuvent
  avoir changé après une conversion biomasse ou géothermie ; (4) l'appariement « dans la commune » repose
  sur le nom de commune (pas de code INSEE dans la source) : une fusion de communes ou une graphie
  différente peut le faire manquer ; (5) la présence d'une cogénération sur le réseau n'est pas un champ
  de la source : le rattachement dit qu'un réseau est là, pas que la cogé l'alimente.
