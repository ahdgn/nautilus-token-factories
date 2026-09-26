# -*- coding: utf-8 -*-
"""
Appariement Géorisques (étape 4) : position réelle, SIRET, régime et puissance
thermique des cogénérations via la base des installations classées (rubrique 2910).
=============================================================================
Source : Géorisques, API REST « installations_classees » (BRGM, licence ouverte,
https://georisques.gouv.fr/api/v1/installations_classees). Le filtre `rubrique`
de l'API est ignoré (vérifié le 26/09/2026 : 138 675 résultats avec ou sans), mais
le filtre `code_insee` fonctionne et `page_size=1000` renvoie une commune entière en
une requête. On interroge donc une fois chaque commune du jeu de données et on met
en cache tous ses établissements, allégés (`tools/cache/icpe_2910.json`, ignoré par
git ; reprise commune par commune ; `--refresh` pour retélécharger).

Patron : `biomethane-france/tools/geocode_icpe.py` (couche WFS BRGM filtrée sur la
rubrique 2781). L'API REST est préférée ici parce qu'elle donne les rubriques avec
leur alinéa et leur quantité (puissance thermique en MW), absentes de la couche WFS.

Ce que contient la base pour une commune (exemple Pontoise, Nangis, Gennevilliers) :
  · établissements à autorisation ou enregistrement, avec leurs rubriques (dont
    2910 « combustion » et 3110 « combustion IED ≥ 50 MW », quantité en MW) ;
  · établissements « Autres régimes » ou « Non ICPE » (déclarations, dossiers
    anciens) : position, SIRET, raison sociale, mais aucune rubrique. Exemple :
    « DALKIA - (CH René DUBOS - local cogé) » à Pontoise. Ils ne sont retenus que si
    leur nom concorde fortement avec celui de l'installation.

Appariement, pour chaque cogénération (tools/screening_params.json, clé `icpe`) :
  1. candidats = établissements de la même commune (code INSEE) portant une rubrique
     de combustion (2910 ou 3110), plus les établissements sans rubrique dont le nom
     concorde (similarité ≥ `seuil_nom_fort`) ;
  2. score = moyenne pondérée de trois composantes, chacune ignorée si inconnue :
     · nom : similarité entre le nom de l'installation et la raison sociale, après
       normalisation (accents, sigles, mots creux, nom de la commune, synonymes
       hôpital / CH) ; sans objet si le nom du registre est « Confidentiel » ;
     · puissance : rapport puissance thermique / puissance électrique, attendu
       entre 1,8 et 3,5 (rendement électrique 30-55 %), toléré largement ;
       contradictoire si la puissance thermique est inférieure à l'électrique ;
     · nature : cohérence entre l'usage probable du site et la raison sociale ou le
       code NAF de l'établissement (chaufferie / réseau de chaleur, hôpital,
       industrie, serres, campus) ;
     · bonus si la raison sociale mentionne la cogénération.
  3. décision : « forte » si le nom concorde et le score dépasse `seuil_forte`, ou si
     le candidat est unique avec puissance et nature concordantes ; « moyenne »
     au-dessus de `seuil_moyenne` (ou candidat unique plausible au-dessus de
     `seuil_unique`) ; « aucune » sinon. Un second candidat trop proche du premier
     (autre SIRET) ramène « forte » à « moyenne », et « moyenne » à « aucune » quand
     le nom est masqué (homonymies, sites multi-établissements : on ne tranche pas).

Écriture (réversible) : `lat_commune` / `lon_commune` conservent le centroïde ;
`lat` / `lon` prennent la position ICPE si la confiance est forte ou moyenne et que
la distance au centroïde reste sous `distance_max_km` ; `geo_precision` = « icpe ».
Champs ajoutés à chaque site : icpe_siret, icpe_raison_sociale, icpe_regime,
icpe_rubrique_2910 {numero, alinea, regime, puissance_th_mw}, icpe_etat, icpe_seveso,
icpe_code_aiot, icpe_url, icpe_adresse, icpe_confiance, icpe_score, icpe_candidats,
icpe_distance_km. Un site sans appariement garde son centroïde et des champs vides.
Rapport : tools/icpe_report.json ; millésime dans data/meta.json (clé `icpe`).
`--restore` remet le centroïde et retire les champs.

Usage :
  python tools/geocode_icpe.py              # télécharge (cache) puis apparie
  python tools/geocode_icpe.py --refresh    # retélécharge toutes les communes
  python tools/geocode_icpe.py --restore    # retour arrière
Ensuite : python tools/check_geo.py
"""
import json
import math
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA_PATH = REPO / "data" / "cogenerations_gaz.json"
META_PATH = REPO / "data" / "meta.json"
PARAMS_PATH = REPO / "tools" / "screening_params.json"
CACHE_DIR = REPO / "tools" / "cache"
CACHE_PATH = CACHE_DIR / "icpe_2910.json"
REPORT_PATH = REPO / "tools" / "icpe_report.json"
UA = {"User-Agent": "nautilus-token-factories-etl", "Accept": "application/json"}

PARAMS = json.load(open(PARAMS_PATH, encoding="utf-8"))
P = PARAMS["icpe"]
RUBRIQUE = str(P.get("rubrique", "2910"))
RUBRIQUES_COMBUSTION = {str(r) for r in P.get("rubriques_combustion", [RUBRIQUE])}
API = P["api"]
FICHE_URL = P.get("fiche_url", "https://www.georisques.gouv.fr/risques/installations/donnees/details/{code_aiot}")
CACHE_FORMAT = 2
ICPE_FIELDS = ["icpe_siret", "icpe_raison_sociale", "icpe_regime", "icpe_rubrique_2910", "icpe_etat",
               "icpe_seveso", "icpe_code_aiot", "icpe_url", "icpe_adresse", "icpe_confiance", "icpe_score",
               "icpe_candidats", "icpe_distance_km"]


# ---------------------------------------------------------------- téléchargement
def fetch_json(url, tries=5):
    """GET avec reprise sur erreur (429, 5xx, réseau) et attente croissante."""
    pause = P.get("pause_s", 0.25)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429 or e.code >= 500:
                time.sleep(pause * (2 ** (i + 1)))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
            last = e
            time.sleep(pause * (2 ** (i + 1)))
    raise RuntimeError(f"Géorisques injoignable après {tries} essais : {url} ({last})")


def fetch_commune(insee):
    """Tous les établissements ICPE d'une commune (pagination au cas où)."""
    out, page = [], 1
    while True:
        url = API + "?" + urllib.parse.urlencode({"code_insee": insee, "page": page, "page_size": P.get("page_size", 1000)})
        j = fetch_json(url)
        out.extend(j.get("data") or [])
        if page >= (j.get("total_pages") or 1):
            break
        page += 1
        time.sleep(P.get("pause_s", 0.25))
    return out


def slim(e):
    """Champs utiles d'un établissement ; rubriques de combustion détaillées, autres en liste."""
    rubs = [{"numero": str(r.get("numeroRubrique")), "alinea": r.get("alinea"), "regime": r.get("regimeAutoriseAlinea"),
             "quantite": r.get("quantiteTotale"), "unite": r.get("unite")}
            for r in (e.get("rubriques") or []) if str(r.get("numeroRubrique")) in RUBRIQUES_COMBUSTION]
    return {
        "code_aiot": e.get("codeAIOT"), "raison_sociale": e.get("raisonSociale"), "siret": e.get("siret"),
        "adresse": " ".join(str(e.get(k) or "").strip() for k in ("adresse1", "adresse2", "adresse3")).strip() or None,
        "code_postal": e.get("codePostal"), "code_insee": e.get("codeInsee"), "commune": e.get("commune"),
        "code_naf": e.get("codeNaf"), "lon": e.get("longitude"), "lat": e.get("latitude"),
        "regime": e.get("regime"), "etat": e.get("etatActivite"), "seveso": e.get("statutSeveso"),
        "ied": e.get("ied"), "industrie": e.get("industrie"), "service": e.get("serviceAIOT"),
        "date_maj": (e.get("date_maj") or "")[:10] or None,
        "rubriques_combustion": rubs,
        "autres_rubriques": sorted({str(r.get("numeroRubrique")) for r in (e.get("rubriques") or [])
                                    if str(r.get("numeroRubrique")) not in RUBRIQUES_COMBUSTION}),
    }


def load_cache():
    if CACHE_PATH.exists():
        c = json.load(open(CACHE_PATH, encoding="utf-8"))
        if c.get("_meta", {}).get("format") == CACHE_FORMAT:
            return c
        print("   cache d'un format antérieur : retéléchargement")
    return {"_meta": {"source": API, "format": CACHE_FORMAT, "rubriques_combustion": sorted(RUBRIQUES_COMBUSTION)},
            "communes": {}}


def save_cache(cache):
    CACHE_DIR.mkdir(exist_ok=True)
    cache["_meta"]["communes_telechargees"] = len(cache["communes"])
    cache["_meta"]["date"] = date.today().isoformat()
    json.dump(cache, open(CACHE_PATH, "w", encoding="utf-8"), ensure_ascii=False)


def download(communes, refresh=False):
    cache = load_cache()
    todo = [c for c in sorted(communes) if refresh or c not in cache["communes"]]
    print(f"Géorisques : {len(communes)} communes, {len(todo)} à télécharger (cache : {CACHE_PATH.relative_to(REPO)})")
    t0, n_etab = time.time(), 0
    for i, insee in enumerate(todo, 1):
        etabs = [slim(e) for e in fetch_commune(insee)]
        cache["communes"][insee] = etabs
        n_etab += len(etabs)
        if i % 25 == 0 or i == len(todo):
            save_cache(cache)
            print(f"   {i}/{len(todo)} communes, {n_etab} établissements ({time.time() - t0:.0f} s)")
        time.sleep(P.get("pause_s", 0.25))
    if todo:
        save_cache(cache)
    return cache


# ---------------------------------------------------------------- normalisation
STOP = set(P.get("mots_creux", []))
SYNONYMES = P.get("synonymes", {})
COMMUNE_STOP = {"saint", "sainte", "sur", "sous", "les", "le", "la", "en", "et", "de", "du", "des", "aux", "au"}
COGE_RX = re.compile(P.get("regex_cogeneration", r"\bCOG[EÉ]"), re.I)


def strip_accents(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def norm(s):
    s = strip_accents(s).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def tokens(s, extra_stop=()):
    out = set()
    for t in norm(s).split():
        t = SYNONYMES.get(t, t)
        if len(t) >= 3 and t not in STOP and t not in extra_stop:
            out.add(t)
    return out


def commune_tokens(name):
    return {t for t in norm(name).split() if len(t) >= 3 and t not in COMMUNE_STOP}


def name_similarity(site_name, raison_sociale, commune):
    """0..1 : meilleur de (part des jetons significatifs partagés, ratio de séquence).
    Les jetons du nom de la commune ne comptent pas (ils apparaissent des deux côtés
    sans rien prouver). Si les deux noms sont identiques une fois normalisés
    (« GENNEVILLIERS ENERGIE » / « Gennevilliers Energie »), 1."""
    na, nb = norm(site_name), norm(raison_sociale)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    ct = commune_tokens(commune)
    a, b = tokens(site_name, ct), tokens(raison_sociale, ct)
    if not a or not b:
        # plus rien de significatif : seule une quasi-égalité des chaînes compte
        r = SequenceMatcher(None, na, nb).ratio()
        return round(r, 3) if r >= P.get("seuil_egalite_chaines", 0.85) else 0.0
    shared = a & b
    # jetons partagés par préfixe (LESAFFRE / LESAFFRE FRERES, SODIEN / SODIENERGIE)
    for x in a:
        for y in b:
            if x != y and len(x) >= 5 and len(y) >= 5 and (x.startswith(y) or y.startswith(x)):
                shared.add(x)
    jac = len(shared) / min(len(a), len(b))
    # ratio de séquence : seulement s'il est très élevé (OLIVIERS / RIVIERE donnent 0,67 à tort)
    seq = SequenceMatcher(None, " ".join(sorted(a)), " ".join(sorted(b))).ratio()
    if seq < P.get("seuil_sequence", 0.9):
        seq = 0.0
    return round(max(jac, seq), 3)


def name_exact(site_name, raison_sociale, commune):
    """Vrai si les deux noms sont identiques une fois normalisés, ou si leurs jetons
    significatifs sont exactement les mêmes (SAS KLENERGY / KLENERGY)."""
    na, nb = norm(site_name), norm(raison_sociale)
    if not na or not nb:
        return False
    if na == nb:
        return True
    ct = commune_tokens(commune)
    a, b = tokens(site_name, ct), tokens(raison_sociale, ct)
    return bool(a) and a == b


NATURE_RX = {k: re.compile(v, re.I) for k, v in P.get("nature_regex", {}).items()}
NATURE_NAF = {k: v for k, v in P.get("nature_naf", {}).items() if not k.startswith("_")}


def nature_of_etab(e):
    """Familles d'établissement déduites de la raison sociale et du code NAF."""
    fam = set()
    rs = strip_accents(e.get("raison_sociale") or "")
    for k, rx in NATURE_RX.items():
        if rx.search(rs):
            fam.add(k)
    naf = str(e.get("code_naf") or "")
    for k, codes in NATURE_NAF.items():
        if naf and naf[:2] in codes:
            fam.add(k)
    return fam


def nature_score(site, e):
    """1 : usage probable du site et famille de l'établissement concordent ;
    0.5 : pas d'indice (usage « À qualifier » ou établissement sans famille) ;
    0.75 : énergéticien pour un hôpital ou un campus (il exploite souvent la cogé) ;
    0 : familles connues et contradictoires."""
    usage = site.get("usage_probable") or "À qualifier"
    fam = nature_of_etab(e)
    if usage == "À qualifier" or not fam:
        return 0.5
    if usage in fam:
        return 1.0
    if "Réseau de chaleur / urbain" in fam and usage in ("Hôpital / santé", "Campus / piscine"):
        return 0.75
    return 0.0


def puissance_th(e):
    """Puissance thermique de combustion (MW) : la plus grande des lignes 2910 / 3110.
    Renvoie (MW, unité corrigée ?). Une quantité « MW » supérieure à `mw_max_plausible`
    est lue comme des kW (saisies en kW rencontrées : 10 500 « MW » pour une
    blanchisserie)."""
    best, fixed = None, False
    for r in e.get("rubriques_combustion") or []:
        try:
            q = float(str(r.get("quantite") or "").replace(",", "."))
        except ValueError:
            continue
        unit = str(r.get("unite") or "").strip().lower()
        f = False
        if unit.startswith("kw"):
            q = q / 1000
        elif unit.startswith("mw"):
            if q > P.get("mw_max_plausible", 500):
                q, f = q / 1000, True
        else:
            continue
        if q > 0 and (best is None or q > best):
            best, fixed = q, f
    return best, fixed


def power_score(pe_mw, pth_mw):
    """None si inconnu ; 1 dans la plage attendue ; dégradé au-delà ; 0 si contradictoire."""
    if not pe_mw or pth_mw is None:
        return None
    r = pth_mw / pe_mw
    pp = P["puissance"]
    if pp["ratio_attendu_min"] <= r <= pp["ratio_attendu_max"]:
        return 1.0
    if pp["ratio_tolere_min"] <= r <= pp["ratio_tolere_max"]:
        return 0.6
    if r > pp["ratio_tolere_max"]:
        return 0.3  # gros établissement hôte (chaufferie de réseau, usine) : plausible
    return 0.0      # puissance thermique inférieure à l'électrique : incompatible


def rubrique_principale(e):
    rubs = e.get("rubriques_combustion") or []
    if not rubs:
        return None
    pth, fixed = puissance_th(e)

    def q(r):
        try:
            return float(str(r.get("quantite") or 0).replace(",", "."))
        except ValueError:
            return 0.0
    # priorité à la rubrique cible (2910), puis à la plus grande quantité
    main = sorted(rubs, key=lambda r: (r.get("numero") != RUBRIQUE, -q(r)))[0]
    out = {"numero": main.get("numero"), "alinea": main.get("alinea"), "regime": main.get("regime"), "puissance_th_mw": pth}
    if fixed:
        out["unite_corrigee"] = "quantité lue en kW (valeur « MW » invraisemblable)"
    return out


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def regime_rank(e):
    r = str(e.get("regime") or "")
    return {"Autorisation": 0, "Enregistrement": 1}.get(r, 2)


def candidates(site, etabs):
    """Établissements de combustion de la commune, plus ceux sans rubrique dont le nom concorde."""
    out = []
    excl = {(x.get("code_eic"), x.get("siret")) for x in P.get("exclusions", [])}
    for e in etabs:
        if e.get("lat") is None or e.get("lon") is None:
            continue
        if (site.get("code_eic"), e.get("siret")) in excl:
            continue  # paire écartée à la main (tools/screening_params.json, icpe.exclusions)
        if e.get("rubriques_combustion"):
            out.append(e)
        elif not site.get("nom_confidentiel") and \
                name_similarity(site.get("nom"), e.get("raison_sociale"), site.get("commune")) >= P["seuil_nom_fort"]:
            out.append(e)
    return out


def score_candidate(site, e):
    w = P["poids"]
    parts = {}
    if not site.get("nom_confidentiel"):
        parts["nom"] = name_similarity(site.get("nom"), e.get("raison_sociale"), site.get("commune"))
    ps = power_score(site.get("puissance_mw"), puissance_th(e)[0])
    if ps is not None:
        parts["puissance"] = ps
    parts["nature"] = nature_score(site, e)
    tot_w = sum(w[k] for k in parts)
    score = sum(w[k] * v for k, v in parts.items()) / tot_w if tot_w else 0.0
    if COGE_RX.search(strip_accents(e.get("raison_sociale") or "")):
        score += P.get("bonus_cogeneration", 0.1)
        parts["bonus_cogeneration"] = P.get("bonus_cogeneration", 0.1)
    if str(e.get("etat") or "").lower().startswith("cess"):
        score *= P.get("malus_cessation", 0.5)
    return round(score, 3), parts  # peut dépasser 1 avec le bonus : il départage deux fiches identiques


def decide(site, cands):
    """Retourne (candidat retenu ou None, confiance, score, détail des candidats)."""
    if not cands:
        return None, "aucune", None, []
    scored = sorted(((*score_candidate(site, e), e) for e in cands),
                    key=lambda t: (-t[0], not t[2].get("rubriques_combustion"), regime_rank(t[2])))
    best_score, parts, best = scored[0]
    # second candidat d'un autre SIRET (deux fiches d'un même établissement ne sont pas une ambiguïté)
    second = next((s for s, _, e in scored[1:] if not best.get("siret") or e.get("siret") != best.get("siret")), 0.0)
    nom, puis, nat = parts.get("nom"), parts.get("puissance"), parts.get("nature", 0.5)
    conf = "aucune"
    if puis == 0.0 and (nom is None or nom < P["seuil_nom_fort"]):
        conf = "aucune"  # puissance contradictoire sans nom probant
    elif nom is not None and nom >= P["seuil_nom_fort"] and best_score >= P["seuil_forte"]:
        conf = "forte"
        if not best.get("rubriques_combustion"):
            # établissement sans rubrique (déclaration, dossier ancien) : le nom est la seule
            # preuve ; « forte » seulement si les noms sont identiques, si la nature concorde
            # ou si la raison sociale mentionne la cogénération (un nom de quartier partagé,
            # « COGENERATION CHATEAUCREUX » / « CARROSSERIE DE CHATEAUCREUX », ne suffit pas)
            if not (name_exact(site.get("nom"), best.get("raison_sociale"), site.get("commune"))
                    or nat >= 1.0 or "bonus_cogeneration" in parts):
                conf = "moyenne"
    elif len(cands) == 1 and puis == 1.0 and nat >= 0.75:
        conf = "forte"
    elif best_score >= P["seuil_moyenne"]:
        conf = "moyenne"
    elif len(cands) == 1 and (puis is None or puis > 0) and best_score >= P["seuil_unique"]:
        conf = "moyenne"
    margin = best_score - second
    if conf == "forte" and margin < P["ecart_min_forte"]:
        conf = "moyenne"
    if conf == "moyenne" and nom is None and margin < P["ecart_min_moyenne"]:
        conf = "aucune"  # nom masqué et deux candidats indiscernables : on ne tranche pas
    detail = [{"code_aiot": e.get("code_aiot"), "raison_sociale": e.get("raison_sociale"), "siret": e.get("siret"),
               "score": s, "composantes": p, "puissance_th_mw": puissance_th(e)[0], "regime": e.get("regime"),
               "rubriques_combustion": [r.get("numero") for r in e.get("rubriques_combustion") or []]}
              for s, p, e in scored]
    return (best if conf != "aucune" else None), conf, best_score, detail


# ---------------------------------------------------------------- restauration
def reset_site(d):
    if "lat_commune" in d:
        d["lat"], d["lon"] = d.pop("lat_commune"), d.pop("lon_commune")
        d["geo_precision"] = "commune" if d["lat"] is not None else None
    for k in ICPE_FIELDS:
        d.pop(k, None)


def restore(sites):
    n = sum(1 for d in sites if "lat_commune" in d)
    for d in sites:
        reset_site(d)
    json.dump(sites, open(DATA_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    if META_PATH.exists():
        meta = json.load(open(META_PATH, encoding="utf-8"))
        meta.pop("icpe", None)
        meta.get("cogenerations_gaz", {})["geo"] = "centroïde de commune (geo.api.gouv.fr, code INSEE)"
        json.dump(meta, open(META_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"Restauration : {n} sites remis au centroïde de commune, champs icpe_* retirés")


# ---------------------------------------------------------------- appariement
def main():
    sites = json.load(open(DATA_PATH, encoding="utf-8"))
    if "--restore" in sys.argv:
        restore(sites)
        return
    for d in sites:  # repart toujours du centroïde : script rejouable
        reset_site(d)

    communes = {str(d["code_insee"]).zfill(5) for d in sites if d.get("code_insee")}
    cache = download(communes, refresh="--refresh" in sys.argv)
    by_insee = cache["communes"]
    n_etab = sum(len(v) for v in by_insee.values())
    n_comb = sum(1 for v in by_insee.values() for e in v if e.get("rubriques_combustion"))
    n_comm_comb = sum(1 for v in by_insee.values() if any(e.get("rubriques_combustion") for e in v))
    print(f"Cache : {n_etab} établissements dans {len(by_insee)} communes ; {n_comb} avec rubrique "
          f"{'/'.join(sorted(RUBRIQUES_COMBUSTION))} dans {n_comm_comb} communes")

    stats = Counter()
    distances, moyens, forts, sans, hors_distance = [], [], [], [], []
    regimes, etats, alineas = Counter(), Counter(), Counter()
    for d in sites:
        insee = str(d.get("code_insee") or "").zfill(5)
        cands = candidates(d, by_insee.get(insee, []))
        d["icpe_candidats"] = len(cands)
        stats["testes"] += 1
        if cands:
            stats["avec_candidats"] += 1
        best, conf, score, detail = decide(d, cands)
        d["icpe_confiance"] = conf
        d["icpe_score"] = score
        if best is None:
            stats["sans_appariement"] += 1
            if cands:
                sans.append({"code_eic": d.get("code_eic"), "nom": d.get("nom"), "commune": d.get("commune"),
                             "puissance_mw": d.get("puissance_mw"), "candidats": detail[:3]})
            continue
        stats[conf] += 1
        dist = None
        if d.get("lat") is not None:
            dist = round(haversine_km(d["lat"], d["lon"], best["lat"], best["lon"]), 2)
            distances.append(dist)
        rub = rubrique_principale(best)
        d["icpe_siret"] = best.get("siret")
        d["icpe_raison_sociale"] = best.get("raison_sociale")
        d["icpe_regime"] = best.get("regime")
        d["icpe_rubrique_2910"] = rub
        d["icpe_etat"] = best.get("etat")
        d["icpe_seveso"] = best.get("seveso")
        d["icpe_code_aiot"] = best.get("code_aiot")
        d["icpe_url"] = FICHE_URL.format(code_aiot=best.get("code_aiot")) if best.get("code_aiot") else None
        d["icpe_adresse"] = best.get("adresse")
        d["icpe_distance_km"] = dist
        regimes[best.get("regime") or "—"] += 1
        etats[best.get("etat") or "non renseigné"] += 1
        alineas[(rub or {}).get("numero", "sans rubrique") + ("-" + rub["alinea"] if rub and rub.get("alinea") else "")] += 1
        row = {"code_eic": d.get("code_eic"), "nom": d.get("nom"), "commune": d.get("commune"),
               "puissance_mw": d.get("puissance_mw"), "usage_probable": d.get("usage_probable"),
               "icpe_raison_sociale": best.get("raison_sociale"), "icpe_siret": best.get("siret"),
               "icpe_regime": best.get("regime"), "rubrique": rub, "score": score,
               "composantes": detail[0]["composantes"], "candidats": len(cands),
               "second": detail[1]["raison_sociale"] if len(detail) > 1 else None,
               "second_score": detail[1]["score"] if len(detail) > 1 else None, "distance_km": dist}
        if dist is not None and dist > P["distance_max_km"]:
            hors_distance.append(row)          # établissement gardé, position non appliquée
            stats["position_non_appliquee_distance"] += 1
        else:
            if "lat_commune" not in d:
                d["lat_commune"], d["lon_commune"] = d.get("lat"), d.get("lon")
            d["lat"], d["lon"] = round(float(best["lat"]), 6), round(float(best["lon"]), 6)
            d["geo_precision"] = "icpe"
            stats["positions_icpe"] += 1
        (forts if conf == "forte" else moyens).append(row)

    json.dump(sites, open(DATA_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=0)

    def bins(vals):
        edges = [0, 1, 2, 5, 10, 20, 50, 1e9]
        labels = ["< 1 km", "1-2 km", "2-5 km", "5-10 km", "10-20 km", "20-50 km", "> 50 km"]
        c = Counter()
        for v in vals:
            for i in range(len(edges) - 1):
                if edges[i] <= v < edges[i + 1]:
                    c[labels[i]] += 1
                    break
        return {k: c.get(k, 0) for k in labels}

    resultat = {
        "testes": stats["testes"], "avec_candidats": stats["avec_candidats"],
        "forte": stats["forte"], "moyenne": stats["moyenne"], "sans_appariement": stats["sans_appariement"],
        "positions_icpe": stats["positions_icpe"],
        "position_non_appliquee_distance": stats["position_non_appliquee_distance"],
        "taux_appariement": round((stats["forte"] + stats["moyenne"]) / max(stats["testes"], 1), 3),
    }
    report = {
        "_comment": "Écrit par tools/geocode_icpe.py : appariement des cogénérations avec les établissements ICPE (rubrique 2910) de leur commune.",
        "date": date.today().isoformat(),
        "source": API,
        "rubriques_combustion": sorted(RUBRIQUES_COMBUSTION),
        "parametres": {k: P[k] for k in ("poids", "seuil_forte", "seuil_moyenne", "seuil_unique", "seuil_nom_fort",
                                         "ecart_min_forte", "ecart_min_moyenne", "bonus_cogeneration",
                                         "distance_max_km", "puissance")},
        "cache": {"communes": len(communes), "etablissements": n_etab, "etablissements_combustion": n_comb,
                  "communes_avec_combustion": n_comm_comb, "date": cache["_meta"].get("date")},
        "resultat": resultat,
        "regimes": dict(regimes), "etats": dict(etats), "rubriques": dict(alineas),
        "distances_centroide_icpe_km": {
            "n": len(distances), "mediane": round(sorted(distances)[len(distances) // 2], 2) if distances else None,
            "max": max(distances) if distances else None, "repartition": bins(distances)},
        "hors_distance": hors_distance,
        "appariements_forts": forts,
        "appariements_moyens_a_relire": moyens,
        "sans_appariement_avec_candidats": sans,
    }
    json.dump(report, open(REPORT_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    if META_PATH.exists():
        meta = json.load(open(META_PATH, encoding="utf-8"))
        meta["icpe"] = {"source": "Géorisques, base des installations classées (API REST, licence ouverte)",
                        "rubrique": RUBRIQUE, "date": date.today().isoformat(),
                        "forte": resultat["forte"], "moyenne": resultat["moyenne"], "positions_icpe": resultat["positions_icpe"]}
        meta.get("cogenerations_gaz", {})["geo"] = (
            f"position ICPE (Géorisques, rubrique {RUBRIQUE}) pour {resultat['positions_icpe']} sites, "
            "centroïde de commune (geo.api.gouv.fr) sinon")
        json.dump(meta, open(META_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print("Appariement :", ", ".join(f"{k}={v}" for k, v in resultat.items()))
    print("Régimes :", dict(regimes), "| états :", dict(etats))
    print("Rubriques :", dict(alineas))
    print("Distances centroïde → ICPE :", report["distances_centroide_icpe_km"]["repartition"],
          "| médiane", report["distances_centroide_icpe_km"]["mediane"], "km")
    print("rapport :", REPORT_PATH.relative_to(REPO), "| data/cogenerations_gaz.json et data/meta.json mis à jour (--restore pour revenir)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
