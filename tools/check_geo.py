# -*- coding: utf-8 -*-
"""Contrôle géométrique des coordonnées (étape 3 du backlog).

Chaque site de data/cogenerations_gaz.json est testé contre le contour de la région
que le registre ODRÉ lui attribue (tools/geo/regions.geo.json : france-geojson,
dérivé d'IGN Admin Express, licence ouverte ; copié du dépôt biomethane-france).
Règle, identique à celle du patron :
  · point hors de France métropolitaine -> coordonnées jugées fausses
    (signalées ; avec --apply, lat/lon retirés et geo_precision = null, la carte
    n'affiche plus le site mais il reste dans le tableau) ;
  · point dans une autre région que celle déclarée, au-delà d'une tolérance
    frontalière (~2 km) -> la géométrie fait foi (avec --apply, `region` corrigée
    et l'ancienne valeur conservée dans `region_registre`) ;
  · à moins de 2 km du contour de la région déclarée (frontière régionale,
    frontière nationale ou trait de côte) -> bénéfice du doute, inchangé. Ajout
    par rapport au patron : le centroïde d'une commune littorale ou frontalière
    peut tomber en mer ou de l'autre côté de la frontière (Perros-Guirec, Wattrelos) ;
  · étape 4 : une position ICPE (geo_precision = « icpe », tools/geocode_icpe.py)
    hors de sa région ou hors de France est jugée douteuse : avec --apply, retour au
    centroïde de commune (lat_commune / lon_commune), confiance ICPE ramenée à
    « aucune », motif dans `icpe_position_rejetee`. Le rapport compte les positions
    ICPE testées et en anomalie.

Usage :
  python tools/check_geo.py            # rapport seulement (tools/geo_report.json)
  python tools/check_geo.py --apply    # applique les corrections dans data/cogenerations_gaz.json
"""
import json
import sys
from datetime import date
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.prepared import prep

REPO = Path(__file__).resolve().parent.parent
DATA_PATH = REPO / "data" / "cogenerations_gaz.json"
REGIONS_PATH = REPO / "tools" / "geo" / "regions.geo.json"
REPORT_PATH = REPO / "tools" / "geo_report.json"
BORDER_TOL_DEG = 0.02  # ~2 km

# Le registre ODRÉ écrit les régions comme l'INSEE, france-geojson aussi.
# Table de secours pour les variantes rencontrées.
ALIASES = {
    "Ile-de-France": "Île-de-France",
    "Auvergne-Rhone-Alpes": "Auvergne-Rhône-Alpes",
    "Bourgogne-Franche-Comte": "Bourgogne-Franche-Comté",
    "Provence-Alpes-Cote d'Azur": "Provence-Alpes-Côte d'Azur",
}


def load_regions():
    gj = json.load(open(REGIONS_PATH, encoding="utf-8"))
    regions = [(f["properties"]["nom"], shape(f["geometry"])) for f in gj["features"]]
    return [(name, prep(geom), geom) for name, geom in regions]


def check_point(regions, declared, lat, lon):
    """Retourne (verdict, région géométrique).
    verdict : 'ok' | 'border' | 'mismatch' | 'outside' | 'nocoord'"""
    if lat is None or lon is None:
        return "nocoord", None
    pt = Point(lon, lat)
    inside = next((n for n, p, _ in regions if p.covers(pt)), None)
    declared = ALIASES.get(declared, declared)
    if inside is not None and (not declared or inside == declared):
        return "ok", inside
    claimed = next((g for n, _, g in regions if n == declared), None)
    near_claimed = claimed is not None and claimed.distance(pt) < BORDER_TOL_DEG
    if inside is None:
        return ("border" if near_claimed else "outside"), None
    return ("border" if near_claimed else "mismatch"), inside


def run(apply):
    regions = load_regions()
    sites = json.load(open(DATA_PATH, encoding="utf-8"))
    stats = {"testes": len(sites), "conformes": 0, "frontiere": 0, "hors_region": 0,
             "hors_france": 0, "sans_coordonnees": 0,
             # étape 4 : positions issues de la base ICPE (Géorisques), testées de la même façon
             "positions_icpe_testees": 0, "positions_icpe_anomalies": 0}
    anomalies = []
    verdict_key = {"ok": "conformes", "border": "frontiere", "mismatch": "hors_region",
                   "outside": "hors_france", "nocoord": "sans_coordonnees"}
    for d in sites:
        verdict, inside = check_point(regions, d.get("region"), d.get("lat"), d.get("lon"))
        stats[verdict_key[verdict]] += 1
        icpe = str(d.get("geo_precision") or "").startswith("icpe")
        if icpe:
            stats["positions_icpe_testees"] += 1
        if verdict in ("mismatch", "outside", "border"):
            if icpe:
                stats["positions_icpe_anomalies"] += 1
            anomalies.append({"verdict": verdict, "code_eic": d.get("code_eic"), "nom": d.get("nom"),
                              "commune": d.get("commune"), "code_insee": d.get("code_insee"),
                              "region_declaree": d.get("region"), "region_geometrique": inside,
                              "lat": d.get("lat"), "lon": d.get("lon"), "geo_precision": d.get("geo_precision"),
                              "corrige": apply and verdict != "border"})
            if apply and verdict in ("mismatch", "outside") and icpe and d.get("lat_commune") is not None:
                # position ICPE hors de sa région ou hors de France : l'appariement est douteux,
                # on revient au centroïde de commune (les champs icpe_* restent, confiance dégradée)
                d["lat"], d["lon"] = d["lat_commune"], d["lon_commune"]
                d["geo_precision"] = "commune"
                d["icpe_confiance"] = "aucune"
                d["icpe_position_rejetee"] = verdict
                verdict2, inside2 = check_point(regions, d.get("region"), d["lat"], d["lon"])
                anomalies[-1]["retour_centroide"] = True
                anomalies[-1]["verdict_centroide"] = verdict2
                if verdict2 == "mismatch":
                    d["region_registre"] = d.get("region")
                    d["region"] = inside2
            elif apply and verdict == "mismatch":
                d["region_registre"] = d.get("region")
                d["region"] = inside
            elif apply and verdict == "outside":
                d["lat"], d["lon"], d["geo_precision"] = None, None, None

    report = {
        "_comment": "Écrit par tools/check_geo.py : chaque site testé contre le contour de sa région (tools/geo/regions.geo.json).",
        "date": date.today().isoformat(),
        "mode": "apply" if apply else "rapport",
        "tolerance_frontiere_deg": BORDER_TOL_DEG,
        "regle": "hors_region -> region corrigée par la géométrie ; hors_france -> lat/lon retirés ; frontiere (< 2 km) -> inchangé ; position ICPE hors région ou hors de France -> retour au centroïde de commune",
        "resultat": stats,
        "anomalies": anomalies,
    }
    json.dump(report, open(REPORT_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    if apply:
        json.dump(sites, open(DATA_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=0)

    print("Contrôle géométrique : " + ", ".join(f"{k}={v}" for k, v in stats.items()))
    for a in anomalies[:30]:
        print(f"   {a['verdict']:8s} | {a['code_eic']} | {a['nom']} | {a['commune']} | "
              f"{a['region_declaree']} -> {a['region_geometrique']}")
    print("rapport :", REPORT_PATH.relative_to(REPO),
          "| corrections appliquées dans data/cogenerations_gaz.json" if apply
          else "| aucune modification (--apply pour corriger)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run(apply="--apply" in sys.argv)
