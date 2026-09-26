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

```bash
python tools/build_datasets.py      # registre ODRÉ → data/cogenerations_gaz.json + data/meta.json
```

```bash
python -m http.server 8000      # puis http://localhost:8000 : carte, filtres, graphiques, tableau, fiches, export CSV
```

L'application est statique (Leaflet et Chart.js vendorisés, aucun backend, seule dépendance en
ligne : les fonds de carte Esri). Elle fonctionne telle quelle sur GitHub Pages (chemins relatifs).
L'état des filtres est dans l'URL (`#c=0&r=Île-de-France|Normandie…`), donc partageable.
Le filtre « Cible D2 » est coché par défaut (612 sites, 2 466 MW) ; décoché, tout le périmètre
D1 s'affiche (654 sites, 2 600 MW).

## Structure

| Chemin | Rôle |
|---|---|
| `tools/screening_params.json` | Seuils du screening (puissance, cohortes, facteur de charge, échéance) : la config, jamais le code |
| `tools/build_datasets.py` | ETL : registre ODRÉ filtré (filière thermique non renouvelable, combustible gaz, hors RTE, 1-20 MW, **sans filtre technologie**), géocodé au centroïde de commune, enrichi (cohorte, facteur de charge, statut, fin de contrat initial, fenêtre de sortie, cible D2, usage probable) |
| `data/` | `cogenerations_gaz.json` (un objet par installation), `meta.json` (millésimes) |
| `index.html` | Application carte (étape 2) : filtres, KPI, carte, graphiques, tableau, fiche du site, note de source |
| `js/config.js` | Palette Nautilus, couleurs par statut, fenêtres de sortie, tranches de puissance, normalisation du jeu de données, liens ODRÉ / Google Maps, formats fr-FR ; seuils lus dans `tools/screening_params.json` |
| `js/filters.js` | Filtres (cible D2, statut, fenêtre, cohorte, région, usage, puissance, gestionnaire, nom masqué, recherche), KPI, état synchronisé dans l'URL |
| `js/map.js` | Carte Leaflet : marqueurs proportionnels à la puissance et colorés par statut, légende cliquable, fond clair / satellite, popup et fiche complète |
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
