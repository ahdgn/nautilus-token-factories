# -*- coding: utf-8 -*-
"""
Réseaux de chaleur (étape 5) : rattachement de chaque cogénération au réseau de
chaleur le plus proche, à partir des tracés ouverts de France Chaleur Urbaine.
=============================================================================
Source : « Tracés des réseaux de chaleur et de froid » (France Chaleur Urbaine,
data.gouv.fr, licence ouverte 2.0, mise à jour mensuelle) :
https://www.data.gouv.fr/datasets/traces-des-reseaux-de-chaleur-et-de-froid

Structure réelle du ZIP (vérifiée le 26/09/2026, édition du 14/09/2026, 61,6 Mo) :
  · reseaux_de_chaleur.geojson (83 Mo) : 1 033 MultiLineString en **Lambert-93
    (EPSG:2154)**, 2,2 millions de sommets ; propriétés : `Identifiant reseau`
    (identifiant SNCU, vide pour 192 tracés), nom_reseau, communes (noms séparés par
    des virgules, sans code INSEE), departement, region, MO, Gestionnaire,
    `reseaux classes`, annee_creation, longueur_reseau, nb_pdl, `Taux EnR&R`,
    `contenu CO2`, `contenu CO2 ACV`, prix (PM, PM_L, PM_T, PV%, PF%), Rend%,
    production_totale_MWh et prod_MWh_<source> (gaz naturel, charbon, fioul, GPL,
    biomasse solide, déchets internes, UIOM, biogaz, géothermie, PAC, solaire,
    autres ENR, chaleur industrielle, autre chaleur récupérée, chaudières
    électriques, autres), puissance_totale_MW et puissance_MW_<source>,
    livraisons_totale_MWh et livraisons_<secteur>_MWh, fluide caloporteur ;
  · reseaux_de_chaleur_sans_traces.geojson : 218 réseaux sans tracé, Point au
    centroïde de la commune, mêmes propriétés ;
  · pdp.geojson : 219 périmètres de développement prioritaire (MultiPolygon,
    `Identifiant reseau` le plus souvent vide) ;
  · reseaux_de_froid*.geojson, zones_et_reseaux_en_construction.geojson (non
    utilisés ici) ; shapefiles équivalents ; nomenclature_shapefile_*.xlsx.
  Le mix énergétique, les MWh livrés et les points de livraison sont donc déjà dans
  le jeu (enquête SNCU / Fedene 2024 ; taux EnR&R et CO2 : arrêté DPE, année 2023) :
  l'API de France Chaleur Urbaine n'est pas appelée. Pour mémoire, `GET
  https://france-chaleur-urbaine.beta.gouv.fr/api/v1/networks` renvoie la même
  liste avec géométrie WGS84 (63 Mo, un seul appel, pas d'accès par identifiant :
  /api/v1/networks/<id> répond 404) ; la fiche
  https://france-chaleur-urbaine.beta.gouv.fr/reseaux/<id> embarque les mêmes
  champs dans son JSON de page.

Règle (tools/screening_params.json, clé `reseaux_chaleur`) :
  1. le point du site (position ICPE si appariée, sinon centroïde de commune) est
     projeté en Lambert-93 (formules IGN, GRS80 ; vérifié : origine (3° E, 46,5° N)
     → (700 000, 6 600 000), 1 km → 999,97 m ; pas de dépendance à pyproj) ;
  2. distance euclidienne en mètres au tracé le plus proche (shapely, STRtree) ;
  3. classe : « sur le réseau » si ≤ sur_reseau_m (300) ; « proche » si ≤ proche_m
     (1 000) ; « dans la commune » au-delà, quand un réseau (tracé ou sans tracé)
     liste la commune du site dans `communes` et que son tracé (ou son point) reste
     sous dans_commune_distance_max_km (homonymes) ; « aucun » sinon ;
  4. le réseau retenu est le plus proche ; pour « dans la commune », le plus proche
     de ceux qui listent la commune (tracé de préférence) ; pour « aucun », le plus
     proche tout court, à titre indicatif (la distance le dit).

Champs ajoutés à chaque site (vides si absents de la source, rien n'est inventé) :
  rc_classe, rc_distance_m, rc_id, rc_nom, rc_gestionnaire, rc_mo, rc_url,
  rc_trace (le réseau a un tracé), rc_dans_commune, rc_pdp (point dans un périmètre
  de développement prioritaire), rc_taux_enrr, rc_co2, rc_mix {gaz, biomasse,
  geothermie, uve, autres} en % de la production, rc_production_mwh, rc_mwh_livres,
  rc_nb_pdl, rc_annee_creation, rc_reseau_classe.

Sorties : data/cogenerations_gaz.json enrichi ; data/reseaux_chaleur.geojson (couche
carte, WGS84, tracés fusionnés et simplifiés ; réseaux rattachés seulement si la
couche complète dépasse taille_max_mo) ; tools/heat_report.json ; data/meta.json
(clé `reseaux_chaleur`). Cache : tools/cache/opendata-fcu.zip (ignoré par git).

Usage :
  python tools/enrich_heat.py              # télécharge (cache) puis rattache
  python tools/enrich_heat.py --refresh    # retélécharge le ZIP
  python tools/enrich_heat.py --restore    # retire les champs rc_*, la couche et le millésime
Dépendance : shapely (déjà requise par check_geo.py).
"""
import io
import json
import math
import re
import sys
import time
import unicodedata
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from shapely import STRtree, simplify
from shapely.geometry import Point, shape
from shapely.ops import linemerge
from shapely.prepared import prep

REPO = Path(__file__).resolve().parent.parent
DATA_PATH = REPO / "data" / "cogenerations_gaz.json"
META_PATH = REPO / "data" / "meta.json"
LAYER_PATH = REPO / "data" / "reseaux_chaleur.geojson"
PARAMS_PATH = REPO / "tools" / "screening_params.json"
CACHE_DIR = REPO / "tools" / "cache"
ZIP_PATH = CACHE_DIR / "opendata-fcu.zip"
ZIP_META_PATH = CACHE_DIR / "opendata-fcu.meta.json"
REPORT_PATH = REPO / "tools" / "heat_report.json"
UA = {"User-Agent": "nautilus-token-factories-etl", "Accept": "application/json"}

PARAMS = json.load(open(PARAMS_PATH, encoding="utf-8"))
P = PARAMS["reseaux_chaleur"]
CLASSES = ("sur le réseau", "proche", "dans la commune", "aucun")
RC_FIELDS = ["rc_classe", "rc_distance_m", "rc_id", "rc_nom", "rc_gestionnaire", "rc_mo", "rc_url", "rc_trace",
             "rc_dans_commune", "rc_pdp", "rc_taux_enrr", "rc_co2", "rc_mix", "rc_production_mwh", "rc_mwh_livres",
             "rc_nb_pdl", "rc_annee_creation", "rc_reseau_classe"]


# ---------------------------------------------------------------- projection Lambert-93
# Constantes IGN (RGF93 / Lambert-93, ellipsoïde GRS80) ; formules de la note NTG_71.
L93_N = 0.7256077650532670
L93_C = 11754255.426
L93_XS = 700000.0
L93_YS = 12655612.049876
L93_E = 0.0818191910428158
L93_LON0 = math.radians(3.0)


def wgs_to_l93(lon, lat):
    """(lon, lat) en degrés WGS84 → (x, y) en mètres Lambert-93."""
    phi, lam = math.radians(lat), math.radians(lon)
    es = L93_E * math.sin(phi)
    lat_iso = math.log(math.tan(math.pi / 4 + phi / 2) * ((1 - es) / (1 + es)) ** (L93_E / 2))
    r = L93_C * math.exp(-L93_N * lat_iso)
    g = L93_N * (lam - L93_LON0)
    return L93_XS + r * math.sin(g), L93_YS - r * math.cos(g)


def l93_to_wgs(x, y, dec=5):
    """(x, y) Lambert-93 → (lon, lat) WGS84, arrondis à `dec` décimales (~1 m)."""
    r = math.hypot(x - L93_XS, L93_YS - y)
    g = math.atan2(x - L93_XS, L93_YS - y)
    lon = L93_LON0 + g / L93_N
    lat_iso = -math.log(r / L93_C) / L93_N
    phi = 2 * math.atan(math.exp(lat_iso)) - math.pi / 2
    for _ in range(6):
        es = L93_E * math.sin(phi)
        phi = 2 * math.atan(math.exp(lat_iso) * ((1 + es) / (1 - es)) ** (L93_E / 2)) - math.pi / 2
    return round(math.degrees(lon), dec), round(math.degrees(phi), dec)


# ---------------------------------------------------------------- téléchargement
def fetch_json(url, tries=4):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # réseau, HTTP 5xx, JSON
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"data.gouv injoignable : {url} ({last})")


def latest_resource():
    """Ressource « opendata-fcu.zip » (sans préfixe de date = édition courante) du jeu data.gouv."""
    j = fetch_json(P["dataset_api"])
    res = [r for r in j.get("resources", []) if str(r.get("format", "")).lower() == "zip"]
    if not res:
        raise RuntimeError("aucune ressource ZIP dans le jeu data.gouv")
    current = [r for r in res if str(r.get("title", "")).lower() == "opendata-fcu.zip"]
    r = current[0] if current else sorted(res, key=lambda x: x.get("last_modified") or "", reverse=True)[0]
    return {"title": r.get("title"), "url": r.get("url"), "filesize": r.get("filesize"),
            "last_modified": (r.get("last_modified") or "")[:10] or None,
            "dataset_last_update": (j.get("last_update") or "")[:10] or None,
            "license": j.get("license"), "dataset_title": j.get("title")}


def download(refresh=False):
    CACHE_DIR.mkdir(exist_ok=True)
    if ZIP_PATH.exists() and not refresh:
        meta = json.load(open(ZIP_META_PATH, encoding="utf-8")) if ZIP_META_PATH.exists() else {}
        print(f"Cache : {ZIP_PATH.relative_to(REPO)} ({ZIP_PATH.stat().st_size / 1e6:.1f} Mo, édition {meta.get('last_modified', '?')}) ; --refresh pour retélécharger")
        return meta
    meta = latest_resource()
    print(f"Téléchargement : {meta['title']} ({(meta.get('filesize') or 0) / 1e6:.1f} Mo, édition {meta.get('last_modified')}) → {ZIP_PATH.relative_to(REPO)}")
    t0 = time.time()
    req = urllib.request.Request(meta["url"], headers={"User-Agent": UA["User-Agent"]})
    with urllib.request.urlopen(req, timeout=600) as resp, open(ZIP_PATH, "wb") as out:
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
    meta["downloaded"] = date.today().isoformat()
    json.dump(meta, open(ZIP_META_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"   {ZIP_PATH.stat().st_size / 1e6:.1f} Mo en {time.time() - t0:.0f} s")
    return meta


def read_member(z, name):
    return json.loads(z.read(name).decode("utf-8"))


# ---------------------------------------------------------------- normalisation
ARR_RX = re.compile(r"\s+\d+(?:er|e)\s+arrondissement$")


def strip_accents(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def norm_commune(s):
    """Nom de commune comparable : accents, casse, ponctuation, St/Ste, arrondissements."""
    s = strip_accents(s).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    s = ARR_RX.sub("", s)
    s = re.sub(r"\bst\b", "saint", s)
    s = re.sub(r"\bste\b", "sainte", s)
    return " ".join(s.split())


def num(v):
    if v is None or v == "":
        return None
    try:
        f = float(str(v).replace(",", "."))
    except ValueError:
        return None
    return f


def mix_of(props):
    """Parts du mix en % de la production totale ; None si production absente ou nulle."""
    total = num(props.get("production_totale_MWh"))
    if not total or total <= 0:
        return None
    out = {}
    for k, cols in P["mix"].items():
        if k.startswith("_"):
            continue
        s = sum(num(props.get(c)) or 0.0 for c in cols)
        out[k] = round(100.0 * s / total, 1)
    return out


def network_record(props, has_trace):
    rid = (props.get("Identifiant reseau") or "").strip() or None
    return {
        "rc_id": rid,
        "rc_nom": props.get("nom_reseau") or None,
        "rc_gestionnaire": (props.get("Gestionnaire") or "").strip() or None,
        "rc_mo": (props.get("MO") or "").strip() or None,
        "rc_url": P["fiche_url"].format(id=rid) if rid else None,
        "rc_trace": bool(has_trace),
        "rc_taux_enrr": num(props.get("Taux EnR&R")),
        "rc_co2": num(props.get("contenu CO2")),
        "rc_mix": mix_of(props),
        "rc_production_mwh": num(props.get("production_totale_MWh")),
        "rc_mwh_livres": num(props.get("livraisons_totale_MWh")),
        "rc_nb_pdl": int(num(props.get("nb_pdl"))) if num(props.get("nb_pdl")) is not None else None,
        "rc_annee_creation": int(num(props.get("annee_creation"))) if num(props.get("annee_creation")) is not None else None,
        "rc_reseau_classe": (bool(props.get("reseaux classes")) if props.get("reseaux classes") is not None else None),
    }


# ---------------------------------------------------------------- restauration
def restore(sites):
    n = sum(1 for d in sites if "rc_classe" in d)
    for d in sites:
        for k in RC_FIELDS:
            d.pop(k, None)
    json.dump(sites, open(DATA_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    if META_PATH.exists():
        meta = json.load(open(META_PATH, encoding="utf-8"))
        meta.pop("reseaux_chaleur", None)
        json.dump(meta, open(META_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    if LAYER_PATH.exists():
        LAYER_PATH.unlink()
    print(f"Restauration : champs rc_* retirés de {n} sites, {LAYER_PATH.relative_to(REPO)} supprimé, millésime retiré")


# ---------------------------------------------------------------- couche carte
def build_layer(traces, geoms, keep_idx):
    """GeoJSON WGS84 allégé : tracés fusionnés (linemerge) puis simplifiés. Renvoie (texte, n)."""
    cc = P["couche_carte"]
    tol, dec = float(cc.get("tolerance_m", 25)), int(cc.get("decimales", 5))
    feats = []
    for i in sorted(keep_idx):
        g = geoms[i]
        try:
            g = linemerge(g)
        except Exception:
            pass
        g = simplify(g, tol, preserve_topology=False)
        parts = list(g.geoms) if g.geom_type == "MultiLineString" else [g]
        coords = [[list(l93_to_wgs(x, y, dec)) for x, y in part.coords] for part in parts if len(part.coords) >= 2]
        if not coords:
            continue
        p = traces[i]["properties"]
        rid = (p.get("Identifiant reseau") or "").strip() or None
        feats.append({"type": "Feature",
                      "properties": {"id": rid, "nom": p.get("nom_reseau"), "gestionnaire": (p.get("Gestionnaire") or "").strip() or None,
                                     "taux_enrr": num(p.get("Taux EnR&R")), "url": P["fiche_url"].format(id=rid) if rid else None},
                      "geometry": {"type": "MultiLineString", "coordinates": coords}})
    fc = {"type": "FeatureCollection",
          "_source": "France Chaleur Urbaine, « Tracés des réseaux de chaleur et de froid » (data.gouv.fr, licence ouverte) ; tracés fusionnés et simplifiés par tools/enrich_heat.py",
          "features": feats}
    return json.dumps(fc, ensure_ascii=False, separators=(",", ":")), len(feats)


# ---------------------------------------------------------------- principal
def main():
    sites = json.load(open(DATA_PATH, encoding="utf-8"))
    if "--restore" in sys.argv:
        restore(sites)
        return
    for d in sites:  # rejouable : repart d'un jeu sans champs rc_*
        for k in RC_FIELDS:
            d.pop(k, None)

    zmeta = download(refresh="--refresh" in sys.argv)
    t0 = time.time()
    with zipfile.ZipFile(ZIP_PATH) as z:
        traces = read_member(z, P["zip_membre_traces"])["features"]
        sans = read_member(z, P["zip_membre_sans_traces"])["features"]
        pdp = read_member(z, P["zip_membre_pdp"])["features"]
    print(f"Lecture : {len(traces)} tracés, {len(sans)} réseaux sans tracé, {len(pdp)} PDP ({time.time() - t0:.0f} s)")

    geoms = [shape(f["geometry"]) for f in traces]
    tree = STRtree(geoms)
    sans_pts = [shape(f["geometry"]) for f in sans]
    pdp_geoms = [shape(f["geometry"]) for f in pdp]
    pdp_tree = STRtree(pdp_geoms)
    pdp_prep = [prep(g) for g in pdp_geoms]

    # index commune normalisée -> réseaux (tracés et sans tracé)
    by_commune = defaultdict(list)
    for i, f in enumerate(traces):
        for c in (f["properties"].get("communes") or "").split(","):
            if c.strip():
                by_commune[norm_commune(c)].append(("trace", i))
    for i, f in enumerate(sans):
        for c in (f["properties"].get("communes") or "").split(","):
            if c.strip():
                by_commune[norm_commune(c)].append(("sans", i))

    sur_m, proche_m = float(P["sur_reseau_m"]), float(P["proche_m"])
    commune_max_m = float(P.get("dans_commune_distance_max_km", 30)) * 1000
    stats = Counter()
    mw_by_class = Counter()
    distances = []
    reseaux, gestionnaires = Counter(), Counter()
    sur_reseau, dans_commune_list = [], []
    keep_idx = set()
    sans_position = 0

    for d in sites:
        stats["testes"] += 1
        if d.get("lat") is None or d.get("lon") is None:
            sans_position += 1
            d["rc_classe"] = None
            continue
        x, y = wgs_to_l93(float(d["lon"]), float(d["lat"]))
        pt = Point(x, y)
        idx, dist = tree.query_nearest(pt, return_distance=True, all_matches=False)
        nearest_i, nearest_d = int(idx[0]), float(dist[0])
        distances.append(nearest_d)

        # réseaux qui listent la commune du site (nom), tracé de préférence, homonymes écartés par la distance
        cn = norm_commune(d.get("commune"))
        commune_nets = []
        for kind, i in by_commune.get(cn, []):
            dd = geoms[i].distance(pt) if kind == "trace" else sans_pts[i].distance(pt)
            if dd <= commune_max_m:
                commune_nets.append((kind != "trace", dd, kind, i))
        commune_nets.sort()
        d["rc_dans_commune"] = bool(commune_nets)

        # périmètre de développement prioritaire
        d["rc_pdp"] = any(pdp_prep[int(j)].contains(pt) for j in pdp_tree.query(pt))

        if nearest_d <= sur_m:
            classe, kind, i, dist_m = "sur le réseau", "trace", nearest_i, nearest_d
        elif nearest_d <= proche_m:
            classe, kind, i, dist_m = "proche", "trace", nearest_i, nearest_d
        elif commune_nets:
            _, dd, kind, i = commune_nets[0]
            classe, dist_m = "dans la commune", (dd if kind == "trace" else None)
        else:
            classe, kind, i, dist_m = "aucun", "trace", nearest_i, nearest_d
        props = (traces if kind == "trace" else sans)[i]["properties"]
        d.update(network_record(props, kind == "trace"))
        d["rc_classe"] = classe
        d["rc_distance_m"] = round(dist_m) if dist_m is not None else None
        if classe == "aucun":
            # à titre indicatif : le réseau le plus proche, avec sa distance
            d["rc_distance_m"] = round(nearest_d)
        stats[classe] += 1
        mw_by_class[classe] += d.get("puissance_mw") or 0
        if classe != "aucun":
            key = f"{d['rc_id'] or '—'} · {d['rc_nom']}"
            reseaux[key] += 1
            gestionnaires[d["rc_gestionnaire"] or "non renseigné"] += 1
            if kind == "trace":
                keep_idx.add(i)
        row = {"code_eic": d.get("code_eic"), "nom": d.get("nom"), "commune": d.get("commune"), "puissance_mw": d.get("puissance_mw"),
               "cible": d.get("cible"), "geo_precision": d.get("geo_precision"), "rc_id": d["rc_id"], "rc_nom": d["rc_nom"],
               "rc_gestionnaire": d["rc_gestionnaire"], "rc_distance_m": d["rc_distance_m"], "rc_taux_enrr": d["rc_taux_enrr"]}
        if classe == "sur le réseau":
            sur_reseau.append(row)
        elif classe == "dans la commune":
            dans_commune_list.append(row)

    json.dump(sites, open(DATA_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"Rattachement ({time.time() - t0:.0f} s) : " + ", ".join(f"{c} = {stats[c]} ({round(mw_by_class[c])} MW)" for c in CLASSES)
          + (f", sans position = {sans_position}" if sans_position else ""))

    # couche carte : complète si elle tient sous taille_max_mo, sinon réseaux rattachés seulement
    max_mo = float(P["couche_carte"].get("taille_max_mo", 5))
    txt_all, n_all = build_layer(traces, geoms, range(len(traces)))
    size_all = len(txt_all.encode("utf-8")) / 1e6
    if size_all <= max_mo:
        txt, n_layer, layer_mode = txt_all, n_all, "complète"
    else:
        txt, n_layer = build_layer(traces, geoms, keep_idx)
        layer_mode = "réseaux rattachés"
    size_layer = len(txt.encode("utf-8")) / 1e6
    LAYER_PATH.write_text(txt, encoding="utf-8")
    print(f"Couche carte : {LAYER_PATH.relative_to(REPO)} = {n_layer} réseaux, {size_layer:.2f} Mo ({layer_mode} ; couche complète {n_all} réseaux = {size_all:.2f} Mo, seuil {max_mo} Mo)")

    def bins(vals):
        edges = [(0, sur_m, f"≤ {sur_m:.0f} m"), (sur_m, proche_m, f"{sur_m:.0f} m - {proche_m / 1000:g} km"),
                 (proche_m, 2000, f"{proche_m / 1000:g}-2 km"), (2000, 5000, "2-5 km"), (5000, 10000, "5-10 km"),
                 (10000, 20000, "10-20 km"), (20000, 50000, "20-50 km"), (50000, 1e12, "> 50 km")]
        c = Counter()
        for v in vals:
            for lo, hi, lab in edges:
                if lo <= v < hi or (lo == 0 and v <= hi):
                    c[lab] += 1
                    break
        return {lab: c.get(lab, 0) for _, _, lab in edges}

    sd = sorted(distances)
    sur_cible = [r for r in sur_reseau if r.get("cible")]
    n_ids = sum(1 for f in traces if (f["properties"].get("Identifiant reseau") or "").strip())
    report = {
        "_comment": "Écrit par tools/enrich_heat.py : rattachement des cogénérations au réseau de chaleur le plus proche (France Chaleur Urbaine).",
        "date": date.today().isoformat(),
        "source": {"jeu": zmeta.get("dataset_title") or "Tracés des réseaux de chaleur et de froid", "page": P["dataset_page"],
                   "ressource": zmeta.get("title"), "edition": zmeta.get("last_modified"), "licence": zmeta.get("license"),
                   "crs": "EPSG:2154 (Lambert-93)", "traces": len(traces), "traces_avec_identifiant_sncu": n_ids,
                   "sans_trace": len(sans), "pdp": len(pdp)},
        "parametres": {k: P[k] for k in ("sur_reseau_m", "proche_m", "dans_commune_distance_max_km", "couche_carte")},
        "resultat": {"testes": stats["testes"], "sans_position": sans_position,
                     **{c: {"n": stats[c], "mw": round(mw_by_class[c])} for c in CLASSES},
                     "sur_ou_proche": {"n": stats["sur le réseau"] + stats["proche"], "mw": round(mw_by_class["sur le réseau"] + mw_by_class["proche"])},
                     "dans_commune_flag": sum(1 for d in sites if d.get("rc_dans_commune")),
                     "dans_pdp": sum(1 for d in sites if d.get("rc_pdp")),
                     "mix_renseigne": sum(1 for d in sites if d.get("rc_classe") not in (None, "aucun") and d.get("rc_mix")),
                     "mwh_livres_renseigne": sum(1 for d in sites if d.get("rc_classe") not in (None, "aucun") and d.get("rc_mwh_livres") is not None),
                     "sans_identifiant_sncu": sum(1 for d in sites if d.get("rc_classe") not in (None, "aucun") and not d.get("rc_id")),
                     "cibles_d2_sur_reseau": {"n": len(sur_cible), "mw": round(sum(r["puissance_mw"] or 0 for r in sur_cible))}},
        "distances_m": {"n": len(sd), "mediane": round(sd[len(sd) // 2]) if sd else None, "max": round(sd[-1]) if sd else None,
                        "repartition": bins(sd)},
        "reseaux_les_plus_frequents": [{"reseau": k, "sites": v} for k, v in reseaux.most_common(20)],
        "gestionnaires_les_plus_frequents": [{"gestionnaire": k, "sites": v} for k, v in gestionnaires.most_common(20)],
        "couche_carte": {"fichier": str(LAYER_PATH.relative_to(REPO)), "mode": layer_mode, "reseaux": n_layer, "taille_mo": round(size_layer, 2),
                         "couche_complete_mo": round(size_all, 2)},
        "sites_cibles_d2_sur_reseau": sorted(sur_cible, key=lambda r: -(r["puissance_mw"] or 0)),
        "sites_sur_reseau_hors_cible": [r for r in sur_reseau if not r.get("cible")],
        "sites_dans_la_commune": sorted(dans_commune_list, key=lambda r: -(r["puissance_mw"] or 0)),
    }
    json.dump(report, open(REPORT_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    if META_PATH.exists():
        meta = json.load(open(META_PATH, encoding="utf-8"))
        meta["reseaux_chaleur"] = {
            "source": "France Chaleur Urbaine, « Tracés des réseaux de chaleur et de froid » (data.gouv.fr, licence ouverte)",
            "edition": zmeta.get("last_modified"), "date": date.today().isoformat(), "traces": len(traces),
            "donnees": "mix, production, livraisons, points de livraison : enquête SNCU/Fedene 2024 ; taux EnR&R et CO2 : arrêté DPE (2023)",
            **{c: stats[c] for c in CLASSES}, "couche": f"{n_layer} réseaux ({layer_mode}), {size_layer:.1f} Mo",
        }
        json.dump(meta, open(META_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print("Distances au tracé le plus proche :", report["distances_m"]["repartition"], "| médiane", report["distances_m"]["mediane"], "m")
    print("Réseaux les plus fréquents :", [(r["reseau"], r["sites"]) for r in report["reseaux_les_plus_frequents"][:8]])
    print("Gestionnaires :", [(r["gestionnaire"], r["sites"]) for r in report["gestionnaires_les_plus_frequents"][:8]])
    print(f"Cibles D2 sur le réseau : {len(sur_cible)} ({report['resultat']['cibles_d2_sur_reseau']['mw']} MW)")
    print("rapport :", REPORT_PATH.relative_to(REPO), "| data/cogenerations_gaz.json, data/reseaux_chaleur.geojson et data/meta.json mis à jour (--restore pour revenir)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
