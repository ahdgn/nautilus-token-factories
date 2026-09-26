# Méthodologie — v0 (26/09/2026)

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
| `usage_probable` | Mots-clés du nom (industrie, hôpital, réseau de chaleur, serres, campus) ; « À qualifier » sinon | Faible : indicatif |
| `lat`, `lon` | Centroïde de la commune d'implantation (geo.api.gouv.fr) par code INSEE, sinon par nom et département | Commune |

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
   figurent dans le registre : appariements prévus avec Géorisques (SIRET, rubrique 2910),
   SIRENE, France Chaleur Urbaine, puis Pappers sur accord.
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
