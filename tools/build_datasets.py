# -*- coding: utf-8 -*-
"""ETL Cogen → Compute France : registre national ODRÉ → data/cogenerations_gaz.json + data/meta.json.

Périmètre (tools/screening_params.json) : filière « Thermique non renouvelable », combustible gaz,
gestionnaire hors RTE, 1 000 à 20 000 kW, SANS filtre sur la technologie (les cogénérations
anciennes sont classées « Autre » ou sans technologie dans le registre ; voir METHODOLOGIE.md § 2).

Champs dérivés : cohorte, facteur de charge, statut d'activité, fin de contrat initial,
usage probable (mots-clés du nom), coordonnées au centroïde de commune (geo.api.gouv.fr).

Usage : python tools/build_datasets.py
"""
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
PARAMS = json.load(open(REPO / "tools" / "screening_params.json", encoding="utf-8"))
UA = {"User-Agent": "cogen-compute-france-etl (Nautilus)"}


def fetch_json(url, timeout=300):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def dataset_meta(api, ds):
    m = fetch_json(api + ds)["metas"]["default"]
    return {"title": m.get("title"), "modified": str(m.get("modified"))[:10],
            "data_processed": str(m.get("data_processed"))[:10], "records_count": m.get("records_count")}


def norm(s):
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower().replace("-", " ").replace("'", " ").replace("’", " ")
    s = " ".join(s.split())
    for a, b in ((" st ", " saint "), (" ste ", " sainte ")):
        s = f" {s} ".replace(a, b).strip()
    if s.startswith("st "):
        s = "saint " + s[3:]
    if s.startswith("ste "):
        s = "sainte " + s[4:]
    return s


def commune_base(name):
    if not isinstance(name, str):
        return ""
    n = name.split(" (")[0]
    if "arrondissement" in n.lower():
        n = " ".join(w for w in n.split() if not w.lower().rstrip("er").isdigit() and w.lower() != "arrondissement")
    return n


def iso_date(fr):
    if not fr or not isinstance(fr, str) or len(fr) < 10:
        return None
    d, m, y = fr[:10].split("/")
    return f"{y}-{m}-{d}"


def cohorte(year):
    if year is None:
        return None
    for c in PARAMS["cohortes"]:
        if year >= c.get("min", -10**9) and year <= c.get("max", 10**9):
            return c["label"]
    return None


def statut(fc):
    lab = PARAMS["statut"]["labels"]
    if fc is None:
        return lab["na"]
    if fc < PARAMS["statut"]["dormante_max"]:
        return lab["dormante"]
    if fc < PARAMS["statut"]["faible_max"]:
        return lab["faible"]
    return lab["active"]


USAGE = [(k, re.compile(v, re.I)) for k, v in PARAMS["usage_probable"].items()]


def usage_probable(name):
    n = str(name or "")
    for k, rx in USAGE:
        if rx.search(n):
            return k
    return "À qualifier"


def main():
    src = PARAMS["source"]
    api, ds = src["api"], src["dataset"]
    meta = dataset_meta(api, ds)
    rows = fetch_json(api + ds + "/exports/json?where=" + urllib.parse.quote(src["where"]))
    print(f"Registre ODRÉ, thermique gaz : {len(rows)} lignes (édition « {meta['title']} »)")

    communes = fetch_json(src["communes"])
    by_code, by_dept = {}, {}
    for c in communes:
        centre = c.get("centre")
        if not centre:
            continue
        lon, lat = centre["coordinates"]
        by_code[c["code"]] = (lat, lon)
        by_dept[(c.get("codeDepartement"), norm(c["nom"]))] = (lat, lon)

    per = PARAMS["perimetre"]
    kept, dropped = [], {"gestionnaire": 0, "region": 0, "puissance": 0, "agregat": 0}
    unmatched = []
    for r in rows:
        p = r.get("puismaxinstallee") or 0
        if (r.get("nbinstallations") or 1) > 1 or str(r.get("nominstallation") or "").startswith("Agrégation"):
            dropped["agregat"] += 1
            continue
        if r.get("gestionnaire") in per["gestionnaires_exclus"]:
            dropped["gestionnaire"] += 1
            continue
        if r.get("region") in per["regions_exclues"]:
            dropped["region"] += 1
            continue
        if not (per["puissance_kw_min"] <= p <= per["puissance_kw_max"]):
            dropped["puissance"] += 1
            continue
        code = r.get("codeinseecommuneimplantation") or r.get("codeinseecommune")
        hit = by_code.get(code) if code else None
        if not hit:
            hit = by_dept.get((r.get("codedepartement"), norm(commune_base(r.get("commune")))))
        if not hit and r.get("commune"):
            unmatched.append(f"{r.get('commune')} ({r.get('codedepartement')}, {code})")
        lat, lon = hit if hit else (None, None)
        mes = r.get("datemiseenservice_date") or iso_date(r.get("datemiseenservice"))
        year = int(mes[:4]) if mes else None
        e = r.get("energieannuelleglissanteinjectee")
        fc = (e / (p * PARAMS["statut"]["heures_an"])) if (e is not None and p) else None
        kept.append({
            "code_eic": r.get("codeeicresourceobject"),
            "nom": r.get("nominstallation") or "Confidentiel",
            "nom_confidentiel": str(r.get("nominstallation") or "").startswith("Confidentiel"),
            "commune": r.get("commune") or "",
            "code_insee": code,
            "departement": r.get("departement") or "",
            "code_departement": r.get("codedepartement") or "",
            "region": r.get("region") or "",
            "gestionnaire": r.get("gestionnaire") or "",
            "poste_source": r.get("postesource"),
            "tension": r.get("tensionraccordement") or "",
            "technologie": r.get("technologie") or "",
            "puissance_kw": p,
            "puissance_mw": round(p / 1000, 3),
            "puissance_raccordement_kw": r.get("puismaxrac"),
            "nb_groupes": r.get("nbgroupes"),
            "date_raccordement": iso_date(r.get("dateraccordement")),
            "date_mes": mes,
            "annee_mes": year,
            "cohorte": cohorte(year),
            "fin_contrat_initial": (year + PARAMS["fin_contrat"]["duree_ans"]) if year else None,
            "energie_injectee_mwh": round(e / 1000, 1) if e is not None else None,
            "facteur_charge": round(fc, 4) if fc is not None else None,
            "statut": statut(fc),
            "usage_probable": usage_probable(r.get("nominstallation")),
            "regime": r.get("regime") or "",
            "lat": round(lat, 4) if lat is not None else None,
            "lon": round(lon, 4) if lon is not None else None,
            "geo_precision": "commune" if lat is not None else None,
        })

    kept.sort(key=lambda d: (d["region"], d["code_departement"], -d["puissance_kw"]))
    DATA.mkdir(exist_ok=True)
    json.dump(kept, open(DATA / "cogenerations_gaz.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)

    cible = [d for d in kept if d["cohorte"] == PARAMS["cohorte_cible"]]
    dorm = [d for d in cible if d["statut"] == PARAMS["statut"]["labels"]["dormante"]]
    mw = lambda L: round(sum(d["puissance_kw"] for d in L) / 1000)
    print(f"Périmètre : {len(kept)} installations, {mw(kept)} MW (écartées : {dropped}) ; non géocodées : {len(unmatched)}")
    print(f"Cohorte {PARAMS['cohorte_cible']} : {len(cible)} / {mw(cible)} MW ; dormantes : {len(dorm)} / {mw(dorm)} MW")
    for u in unmatched[:10]:
        print("   non géocodée :", u)

    title = meta["title"] or ""
    edition = title[title.rfind("(au ") + 4:title.rfind(")")] if "(au " in title else None
    out_meta = {
        "_comment": "Millésimes écrits par tools/build_datasets.py.",
        "build_date": date.today().isoformat(),
        "cogenerations_gaz": {"source": title, "dataset": ds, "edition": iso_date(edition) if edition else meta["data_processed"],
                              "data_processed": meta["data_processed"], "records": len(kept),
                              "cohorte_cible": {"label": PARAMS["cohorte_cible"], "records": len(cible), "mw": mw(cible),
                                                "dormantes": len(dorm), "dormantes_mw": mw(dorm)},
                              "geo": "centroïde de commune (geo.api.gouv.fr, code INSEE)", "params_version": PARAMS["version"]},
    }
    json.dump(out_meta, open(DATA / "meta.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("meta.json écrit")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
