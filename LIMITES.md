# Limites méthodologiques à garder en mémoire

*Version v0.5 de l'outil, 26/09/2026. Ce document résume ce que l'outil ne sait pas ou sait mal. Il est à relire avant tout usage externe d'une liste de sites, et à mettre à jour à chaque étape. Le détail des règles est dans `METHODOLOGIE.md`.*

## 1. Le périmètre est un registre de raccordement, pas un inventaire de cogénérations
- Le registre national ODRÉ ne contient que les installations **encore raccordées** (« En service »). Les cogénérations déjà déraccordées ou démantelées n'y figurent plus : on ne mesure pas le parc disparu, et un site retiré du registre entre deux éditions disparaît de l'outil sans trace.
- Le registre ne distingue pas une cogénération d'un moteur de secours, d'une turbine ou d'une chaudière-turbine industrielle : le filtre porte sur le combustible gaz et la puissance, **sans filtre technologie** (les cogés anciennes sont classées « Autre » ou sans technologie). Le nom de l'installation et la qualification terrain font la différence.
- Les unités raccordées à RTE (148, en HTB) et les DOM sont hors périmètre par décision (D1).

## 2. Localisation : trois niveaux de précision, jamais celle du groupe
- **477 sites sur 654 sont au centroïde de leur commune** (geo.api.gouv.fr, par code INSEE). Dans une grande commune, l'écart réel peut atteindre plusieurs kilomètres ; le centroïde d'une commune littorale ou frontalière peut tomber en mer ou de l'autre côté de la frontière (Perros-Guirec, Wattrelos), sans que la commune soit fausse.
- **177 sites sont positionnés sur leur établissement ICPE** (Géorisques). C'est la position de l'établissement, parfois son entrée ou son siège, pas celle du local de cogénération ; 103 de ces appariements sont de confiance « moyenne » et 48 d'entre eux reposent sur la seule cohérence de puissance pour des noms masqués.
- Le contrôle géométrique vérifie qu'un point tombe dans la région déclarée, rien de plus : il attrape une commune homonyme à l'autre bout de la France, pas une erreur de quelques kilomètres.
- Conséquence : toute distance calculée (rayon, tracé de réseau de chaleur, futur poste source) hérite de cette imprécision. « Sur le réseau » depuis un centroïde signifie que le tracé passe par le centre-ville, pas que la chaufferie est dessus (91 cas sur 150).

## 3. Activité et dormance : l'injection n'est pas la production
- Le statut « dormante » repose sur l'énergie **injectée** sur 12 mois glissants rapportée au productible. Un site industriel en autoconsommation apparaît dormant à tort (Norenergy à Blendecques, papeterie) ; à l'inverse, une cogé de réseau de chaleur qui injecte tout est bien mesurée (Parly 2, Vaulx-en-Velin, contrôlés).
- Le seuil de 5 % est un choix ; une cogé sous contrat qui tourne du 1er novembre au 1er avril affiche 30 à 50 %. Entre 5 et 15 %, on ne sait pas trancher.
- L'énergie est absente pour une trentaine de sites (« non renseigné »).

## 4. Échéances contractuelles : estimées, jamais lues
- Aucune liste nominative des contrats d'obligation d'achat n'est publiée (EDF OA, CRE, ATEE). La « fin du contrat initial » est calculée comme mise en service + 12 ans, et la date de mise en service du registre est en pratique la date de raccordement : une rénovation sous C13 prolonge le soutien jusqu'au plus tard le 1er janvier 2031 sans changer cette date.
- La cible D2 (dormantes + unités mises en service jusqu'en 2019) retient donc 612 sites sur 654 : elle est large par construction et ne hiérarchise rien. Ce sont les filtres et le score v1 qui le feront.
- La nomenclature « C09 » n'existe pas dans les sources publiques ; les unités 2006-2012 relèvent du C01, souvent avec avenant C13.

## 5. Propriété, exploitant, clauses de fin de contrat : incomplets et à confirmer
- Le registre ne donne ni exploitant, ni propriétaire, ni régime d'achat. Géorisques fournit un SIRET et une raison sociale pour **27 % des sites** seulement, car la base ne liste que les établissements à autorisation ou enregistrement et les déclarations saisies ; une cogé seule de 1 à 20 MW en déclaration n'y est que si l'hôte y est déjà (Bondy Énergie : aucun candidat).
- Le SIRET trouvé peut être celui de l'hôte (hôpital, sucrerie) ou de l'exploitant (Dalkia, Engie Solutions) : il ne dit pas qui détient le moteur, le poste HTA et le foncier à l'échéance. Les montages en tiers-investissement, crédit-bail ou délégation de service public ne sont pas documentés publiquement, et la cession à l'euro symbolique n'a été observée dans aucune source : hypothèse à confirmer par entretiens.
- Homonymies et sites multi-établissements produisent des faux positifs (Châteaucreux, écarté à la main) ; une liste d'exclusions existe dans les paramètres et doit être alimentée à chaque contrôle.

## 6. Réseaux de chaleur : le réseau est là, la cogé n'est pas forcément dessus
- La source (France Chaleur Urbaine) donne des tracés parfois partiels ou absents (218 réseaux sans tracé, 192 tracés sans identifiant SNCU) ; un site peut être classé « dans la commune » ou « aucun » alors qu'une canalisation passe devant.
- Le mix, la production, le taux EnR&R et le CO2 viennent de l'enquête 2024 (données 2023 ou moyenne 2021-2023) : une conversion biomasse ou géothermie récente n'y est pas encore.
- La présence d'une cogénération dans le mix n'est pas un champ de la source : le rattachement dit qu'un réseau existe à proximité, pas que la cogé l'alimente ni que le gestionnaire du réseau exploite la cogé.
- L'appariement « dans la commune » repose sur le nom de commune (pas de code INSEE dans la source) : fusions de communes et graphies différentes peuvent le faire manquer.

## 7. Raccordement électrique : le point le plus important n'est pas encore dans l'outil
- La puissance du registre est une puissance **d'injection**. Rien dans l'outil ne dit quelle puissance de **soutirage** le poste source peut accueillir ; la cartographie HTA d'Enedis n'existe que sur le portail client, et la réforme du 1er août 2025 réajuste à la baisse les puissances peu utilisées. La conversion injection → soutirage est une nouvelle demande (procédure consommateur), pas un droit acquis : question à poser à Enedis sur un cas concret.
- Le nom du poste source est celui du registre ; sa capacité et sa distance viendront à l'étape 6, et la capacité restera une saisie manuelle site par site.

## 8. Usage, segmentation et noms masqués
- L'« usage probable » est déduit de mots-clés du nom de l'installation ; 107 des 126 dormantes 1995-2010 restent « à qualifier ». Le nom est masqué (« Confidentiel ») pour 225 sites sur 654 : la commune, le poste source et la puissance restent, mais pas l'identité.
- Aucune information sur la demande locale de calcul (fibre, densité de clients, foncier disponible, PLU) n'est encore intégrée.

## 9. Reproductibilité et versions
- Le registre est réédité chaque mois et les identifiants EIC sont stables ; les sources externes (Géorisques, France Chaleur Urbaine) évoluent sans version : relancer les scripts dans l'ordre documenté (`build_datasets`, `geocode_icpe`, `check_geo`, `enrich_heat`) et comparer les chiffres avant/après à chaque mise à jour.
- Les seuils (puissance, cohortes, 5 %, 300 m, 1 km, poids d'appariement) sont des choix consignés dans `tools/screening_params.json` ; en changer change les comptages. Chaque règle modifiée doit être documentée dans `METHODOLOGIE.md` dans la même PR.

## 10. Ce que l'outil peut et ne peut pas affirmer
- **Il peut dire** : combien de cogénérations gaz raccordées en HTA existent, où (à la commune, parfois à l'établissement), quelle puissance, depuis quand, si elles injectent encore, et quel réseau de chaleur passe à proximité avec quel gestionnaire et quel mix.
- **Il ne peut pas dire** : qui détient le site à l'échéance, quand le contrat s'éteint exactement, si le moteur fonctionne, quelle puissance de soutirage est disponible, si la cogé alimente le réseau, ni si le foncier et le PLU permettent un data center. Tout cela relève de la qualification manuelle, site par site, avant tout engagement ou communication externe.
