/* ============================================
   Config — source unique de vérité
   (palette, couleurs par statut, formats,
   normalisation du jeu de données)
   Nautilus Token Factories — étape 2
   ============================================ */

const CONFIG = (() => {

  // Palette Nautilus (Masterbook)
  const PALETTE = {
    teal: '#22788C',
    navy: '#1E4260',
    deepNavy: '#002D5F',
    steel: '#3E6B96',
    lightBlue: '#9BB4D2',
    gold: '#CDAC81',
    sage: '#6F8F6D',
    terracotta: '#D9844A',
    amber: '#FBAE40',
    violet: '#503C64',
    ink: '#1A1A1A',
    grey: '#7F7F7F',
    hairline: '#D5DCE4',
  };

  /* ---- Statut d'activité (facteur de charge) ----
     Clés internes stables ; les libellés viennent de
     tools/screening_params.json (statut.labels), copie de secours ici.
     Couleur utilisée PARTOUT : marqueurs, légende, graphiques, tableau. */
  const STATUTS = [
    { key: 'dormante', label: 'Dormante (< 5 %)', color: PALETTE.teal },
    { key: 'faible', label: 'Faible (5-15 %)', color: PALETTE.gold },
    { key: 'active', label: 'Active (> 15 %)', color: PALETTE.navy },
    { key: 'na', label: 'Non renseigné', color: PALETTE.grey },
  ];
  const STATUT_BY_KEY = Object.fromEntries(STATUTS.map(s => [s.key, s]));
  function statutKey(label) {
    const l = String(label || '').toLowerCase();
    if (l.startsWith('dormante')) return 'dormante';
    if (l.startsWith('faible')) return 'faible';
    if (l.startsWith('active')) return 'active';
    return 'na';
  }
  const statutColor = (key) => (STATUT_BY_KEY[key] || STATUT_BY_KEY.na).color;
  const statutLabel = (key) => (STATUT_BY_KEY[key] || STATUT_BY_KEY.na).label;

  /* ---- Fenêtre de sortie de l'obligation d'achat ----
     Valeurs longues dans le jeu de données (voir METHODOLOGIE § 3) ; clés
     courtes pour les filtres et l'URL. */
  const FENETRES = [
    { key: '2026-2031', label: '2026-2031', match: (v) => v === '2026-2031' },
    { key: 'echue', label: 'Contrat initial échu (≤ 2025), sortie ≤ 2031 si rénové',
      short: 'Échu ≤ 2025', match: (v) => v.startsWith('contrat initial échu') },
    { key: 'hors-oa', label: 'Hors obligation d\'achat (MES ≥ 2020)',
      short: 'Hors OA (≥ 2020)', match: (v) => v.startsWith('hors obligation') },
  ];
  function fenetreKey(value) {
    const v = String(value || '');
    const f = FENETRES.find(x => x.match(v));
    return f ? f.key : (v ? 'autre' : 'na');
  }
  const FENETRE_BY_KEY = Object.fromEntries(FENETRES.map(f => [f.key, f]));
  const fenetreLabel = (key) => (FENETRE_BY_KEY[key] ? FENETRE_BY_KEY[key].label : (key === 'na' ? 'Non renseignée' : key));
  const fenetreShort = (key) => (FENETRE_BY_KEY[key] ? (FENETRE_BY_KEY[key].short || FENETRE_BY_KEY[key].label) : (key === 'na' ? '—' : key));

  /* ---- Paramètres de screening ----
     Les seuils vivent dans tools/screening_params.json (chargé par app.js) ;
     copie de secours ci-dessous si le fichier est inaccessible. */
  const PARAMS = {
    cohortes: [
      { label: 'avant 1995', max: 1994 },
      { label: '1995-2010', min: 1995, max: 2010 },
      { label: '2011-2014', min: 2011, max: 2014 },
      { label: '2015 et après', min: 2015 },
    ],
    cohorte_cible: '1995-2010',
    tranches_puissance_mw: [[1, 3], [3, 6], [6, 12], [12, 20]],
    regions_prioritaires: ['Île-de-France', 'Hauts-de-France', 'Normandie'],
    cible: { fenetre_min: 2026, fenetre_max: 2031, annee_mes_max_oa: 2019 },
    statut: { dormante_max: 0.05, faible_max: 0.15 },
    version: '',
  };
  function setParams(p) {
    if (!p) return;
    if (Array.isArray(p.cohortes) && p.cohortes.length) PARAMS.cohortes = p.cohortes;
    if (p.cohorte_cible) PARAMS.cohorte_cible = p.cohorte_cible;
    if (Array.isArray(p.tranches_puissance_mw) && p.tranches_puissance_mw.length) PARAMS.tranches_puissance_mw = p.tranches_puissance_mw;
    if (Array.isArray(p.regions_prioritaires) && p.regions_prioritaires.length) PARAMS.regions_prioritaires = p.regions_prioritaires;
    if (p.cible) Object.assign(PARAMS.cible, p.cible);
    if (p.statut) {
      if (p.statut.dormante_max != null) PARAMS.statut.dormante_max = p.statut.dormante_max;
      if (p.statut.faible_max != null) PARAMS.statut.faible_max = p.statut.faible_max;
      if (p.statut.labels) STATUTS.forEach(s => { if (p.statut.labels[s.key]) s.label = p.statut.labels[s.key]; });
    }
    if (p.version) PARAMS.version = p.version;
  }

  /* ---- Tranches de puissance (MW) ----
     Clé « 1-3 », « 3-6 »… ; borne basse incluse, borne haute exclue sauf
     pour la dernière tranche (20 MW inclus). */
  function tranches() {
    const t = PARAMS.tranches_puissance_mw;
    return t.map(([a, b], i) => ({
      key: `${a}-${b}`, label: `${fmtNum(a, 0)} à ${fmtNum(b, 0)} MW`, min: a, max: b, last: i === t.length - 1,
    }));
  }
  function trancheKey(mw) {
    if (mw == null) return null;
    const t = tranches().find(tr => mw >= tr.min && (tr.last ? mw <= tr.max : mw < tr.max));
    return t ? t.key : null;
  }

  /* ---- Normalisation d'un enregistrement de data/cogenerations_gaz.json ----
     Les champs du jeu de données sont conservés tels quels ; on ajoute
     l'identifiant, les clés de filtre et le facteur de charge en %. */
  function normalize(d, i) {
    const r = Object.assign({}, d);
    r.id = d.code_eic || ('row-' + i);
    r.nom = d.nom || 'Confidentiel';
    r.nom_confidentiel = !!d.nom_confidentiel;
    r.puissance_mw = d.puissance_mw != null ? Number(d.puissance_mw) : (d.puissance_kw != null ? Number(d.puissance_kw) / 1000 : null);
    r.statutKey = statutKey(d.statut);
    r.fenetreKey = fenetreKey(d.fenetre_sortie);
    r.trancheKey = trancheKey(r.puissance_mw);
    r.cible = !!d.cible;
    r.facteur_charge_pct = d.facteur_charge != null ? Number(d.facteur_charge) * 100 : null;
    r.usage_probable = d.usage_probable || 'À qualifier';
    r.cohorte = d.cohorte || '—';
    r.region = d.region || '';
    r.gestionnaire = d.gestionnaire || '';
    return r;
  }

  /* ---- Liens externes ---- */
  const ODRE_DATASET = 'registre-national-installation-production-stockage-electricite-agrege';
  const odreUrl = (codeEic) =>
    `https://odre.opendatasoft.com/explore/dataset/${ODRE_DATASET}/table/?q=${encodeURIComponent(codeEic || '')}`;
  const gmapsUrl = (lat, lon) => (lat != null && lon != null ? `https://www.google.com/maps?q=${lat},${lon}` : null);

  const SOURCE_NOTE = 'ODRÉ, registre national des installations de production et de stockage d\'électricité (licence ouverte)';

  // ---- Formats français ----
  const fmtInt = (n) => (n == null || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('fr-FR'));
  const fmtNum = (n, dec = 1) =>
    n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: dec });
  const fmtPct = (n, dec = 1) => (n == null || Number.isNaN(n) ? '—' : `${fmtNum(n, dec)} %`);
  const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const t = Date.parse(iso.length === 10 ? iso + 'T00:00:00' : iso);
    return Number.isNaN(t) ? iso : dateFmt.format(new Date(t));
  };
  const escapeHtml = (text) => String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // décimale à la virgule pour l'export CSV (Excel fr-FR)
  const csvNum = (n) => (n == null ? '' : String(n).replace('.', ','));

  return { PALETTE, STATUTS, statutKey, statutColor, statutLabel,
           FENETRES, fenetreKey, fenetreLabel, fenetreShort,
           PARAMS, setParams, tranches, trancheKey, normalize,
           odreUrl, gmapsUrl, SOURCE_NOTE,
           fmtInt, fmtNum, fmtPct, fmtDate, escapeHtml, csvNum };
})();
