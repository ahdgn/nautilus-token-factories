# Backlog — Nautilus Token Factories

Une PR par étape, du plus simple au plus incertain. Chaque PR indique le degré d'assurance,
la méthode de vérification et les chiffres avant/après. `main` est toujours livrable.

## Décisions (arbitrées le 26/09/2026)

| # | Question | Décision |
|---|---|---|
| D1 | Périmètre réseau | Enedis et ELD, 1-20 MW pour le moment ; RTE hors périmètre |
| D2 | Cibles | Dormantes + unités sortant de contrat 2026-2031, actives comprises (champ `cible`) |
| D3 | Forme | Dépôt public, application carte statique (GitHub Pages) ; projet nommé « Nautilus Token Factories », sans référence à un partenaire |
| D4 | Sources payantes | Validation préalable avant chaque usage (nombre d'appels, coût) |
| D5 | Priorité régionale | Île-de-France, Hauts-de-France, Normandie |

## Étapes

- [x] **0. Dépôt et socle** (26/09/2026) : README, backlog, méthodologie v0, paramètres, notes de recherche A/B/C.
- [x] **1. Registre ODRÉ** (26/09/2026) : `tools/build_datasets.py`, filtre gaz sans technologie, géocodage au centroïde de commune, cohorte, facteur de charge, statut, usage probable, fin de contrat initial ; `data/cogenerations_gaz.json`. Assurance : élevée sur les comptages, moyenne sur le statut (énergie injectée ≠ production).
- [x] **2. Carte et tableau** (26/09/2026, branche `feat/etape-2-carte`) : application Leaflet statique reprise de `ahdgn/biomethane-france` (`index.html`, `js/`, `css/`, `vendor/`, `assets/`) : marqueurs proportionnels à la puissance et colorés par statut, légende cliquable, fond clair / satellite ; filtres cible D2 (coché par défaut) / recherche / statut / fenêtre de sortie / cohorte / région (raccourci D5) / usage / tranche de puissance / gestionnaire / nom masqué, état dans l'URL ; cinq KPI ; quatre graphiques ; tableau trié, paginé, export CSV ; fiche du site avec liens ODRÉ et Google Maps. Assurance : élevée sur l'affichage et les comptages (KPI recoupés avec le jeu de données : cible 612 / 2 466 MW, périmètre 654 / 2 600 MW, dormantes 230 / 1 010 MW, fenêtre 2026-2031 303 / 1 139 MW), moyenne sur l'ergonomie mobile (non testée sur appareil). Vérification : `python -m http.server 8000`, navigateur intégré (carte, filtres, fiche, export CSV avec BOM et 33 colonnes, aucune erreur console), lecture croisée des KPI avec un script Python sur `data/cogenerations_gaz.json`.
- [ ] **3. Contrôle géométrique et satellite** : contours régionaux, rayon de recherche (la vue satellite est déjà dans l'étape 2).
- [ ] **4. Géorisques** : appariement par code INSEE avec les établissements ICPE (rubrique 2910, puissance thermique, SIRET, coordonnées réelles). Limite connue : établissements A/E seulement.
- [ ] **5. Réseaux de chaleur** : France Chaleur Urbaine (tracés, gestionnaire, mix) par commune ; indicateur « réseau de chaleur dans la commune ».
- [ ] **6. Postes sources** : géométrie des postes Enedis, distance au poste source ; capacité de soutirage relevée à la main sur le portail Enedis pour les 30 à 50 meilleurs sites (fichier de saisie).
- [ ] **7. Score v1** : pondération dans `screening_params.json` (raccordement, dormance et échéance, site, acteurs, marché) ; classeur Excel de shortlist pour l'équipe et les partenaires (OneDrive).
- [ ] **8. Registre équipe** : base Airtable et formulaire de qualification (patron `REGISTER.md` du dépôt biométhane).
- [ ] **9. Exploitants et propriétaires** : SIRENE puis Pappers (dépend de D4) ; contact-matcher sur les exploitants et hôtes retenus.
- [ ] **10. Urbanisme et foncier** : PLU (destination « entrepôt »), cadastre, Cartofriches, SITADEL.

## Idées non planifiées

- Croiser avec le registre des garanties d'origine (EEX) pour retrouver les noms masqués « Confidentiel ».
- Éditions annuelles du registre (2017-2024) pour reconstituer la trajectoire d'injection site par site et dater l'arrêt.
- Enedis « production par filière à la maille commune » (2011-2016) pour repérer les cogés déjà déraccordées.
