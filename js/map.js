/* ============================================
   Map — Leaflet + clusters (débrayables)
   Taille des marqueurs = puissance (MW)
   Couleur = statut (facteur de charge)
   Légende dynamique et interactive
   ============================================ */

const MapView = (() => {
  const { PALETTE, fmtNum, fmtInt, fmtPct, fmtDate, escapeHtml, statutColor, statutLabel, fenetreShort } = CONFIG;

  const FRANCE_BOUNDS = L.latLngBounds([41.2, -5.5], [51.3, 9.8]);

  let map;
  let clusterGroup;   // regroupement (option de la légende)
  let plainGroup;     // marqueurs individuels (par défaut : 654 points lisibles à l'échelle nationale)
  let clustered = false;
  let legendDiv;
  // légende repliée par défaut sur petit écran (elle couvrirait la carte)
  let legendCollapsed = window.matchMedia('(max-width: 860px)').matches;
  const markers = new Map(); // id -> marker
  const dataById = new Map(); // id -> site
  let lastData = [];
  let radiusCircle = null;   // cercle de l'outil de rayon (étape 3)
  let picking = false;       // mode pointage : le prochain clic place le centre
  let pickControlLink = null;
  let regionsLayer = null;   // contours des régions (chargés à la demande)
  let regionsOn = false;
  const REGIONS_URL = 'tools/geo/regions.geo.json';
  let heatLayer = null;      // tracés des réseaux de chaleur (étape 5, chargés à la demande)
  let heatOn = false;
  let heatCount = null;      // nombre de réseaux dans la couche (affiché dans la légende)
  const HEAT_URL = 'data/reseaux_chaleur.geojson';

  function init() {
    map = L.map('map', {
      center: FRANCE_BOUNDS.getCenter(),
      zoom: 6,
      // sur un écran de téléphone (carte ~300 px de haut), la France
      // entière demande un zoom < 5 : le plancher doit descendre à 4
      minZoom: 4,
      zoomControl: true,
      zoomSnap: 0.25,
    });

    // Esri World Light Gray : fond clair institutionnel servi sans clé.
    const baseMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Fond de carte &copy; <a href="https://www.esri.com/">Esri</a> · Données &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxNativeZoom: 16,
      maxZoom: 19,
    }).addTo(map);
    // Vue satellite : vérifier une installation sur imagerie avant d'aller sur site.
    const baseSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Imagerie &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
      maxNativeZoom: 18,
      maxZoom: 19,
    });
    L.control.layers({ 'Carte': baseMap, 'Satellite': baseSat }, null,
      { position: 'topleft', collapsed: false }).addTo(map);

    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    // Bouton recentrer
    const recenter = L.control({ position: 'topleft' });
    recenter.onAdd = () => {
      const div = L.DomUtil.create('div', 'leaflet-bar');
      const a = L.DomUtil.create('a', '', div);
      a.href = '#';
      a.title = 'Recentrer sur la France';
      a.setAttribute('aria-label', 'Recentrer sur la France');
      a.innerHTML = '⌂';
      L.DomEvent.on(a, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        fitFrance();
      });
      return div;
    };
    recenter.addTo(map);

    // Bouton « Rayon » : mode pointage, le clic suivant sur la carte place le centre
    const pick = L.control({ position: 'topleft' });
    pick.onAdd = () => {
      const div = L.DomUtil.create('div', 'leaflet-bar');
      pickControlLink = L.DomUtil.create('a', 'map-pick-btn', div);
      pickControlLink.href = '#';
      pickControlLink.title = 'Rayon : cliquer puis placer le centre sur la carte';
      pickControlLink.setAttribute('aria-label', 'Outil de rayon');
      pickControlLink.setAttribute('role', 'button');
      pickControlLink.innerHTML = '⌖';
      L.DomEvent.on(pickControlLink, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        setPickMode(!picking);
      });
      return div;
    };
    pick.addTo(map);
    map.on('click', (e) => {
      if (!picking) return;
      setPickMode(false);
      Filters.setRadiusCenter(e.latlng.lat, e.latlng.lng, '');
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && picking) setPickMode(false); });

    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 40,
      // au-delà du zoom 9, chaque cogénération est visible avec sa taille
      disableClusteringAtZoom: 9,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      chunkedLoading: true,
      iconCreateFunction: (cluster) => {
        const n = cluster.getChildCount();
        const size = n < 10 ? 30 : n < 100 ? 36 : 44;
        return L.divIcon({
          html: `<div class="cluster-icon">${n.toLocaleString('fr-FR')}</div>`,
          className: 'marker-cluster',
          iconSize: [size, size],
        });
      },
    });
    plainGroup = L.layerGroup();
    map.addLayer(clustered ? clusterGroup : plainGroup);

    addLegend();

    // Liens des popups : « Fiche » -> panneau fiche du site ; « Rayon » -> cercle centré sur le site
    map.on('popupopen', (e) => {
      const el = e.popup.getElement();
      const fi = el.querySelector('a[data-fiche-id]');
      if (fi) fi.addEventListener('click', (ev) => {
        ev.preventDefault();
        const d = dataById.get(fi.dataset.ficheId);
        if (d) Fiche.open(d);
        map.closePopup();
      });
      const ra = el.querySelector('a[data-radius-id]');
      if (ra) ra.addEventListener('click', (ev) => {
        ev.preventDefault();
        const d = dataById.get(ra.dataset.radiusId);
        if (d && d.lat != null) Filters.setRadiusCenter(d.lat, d.lon, `${d.nom} (${d.commune})`);
        map.closePopup();
      });
    });

    // vue d'entrée : la France entière, quelle que soit la taille de l'écran
    fitFrance();
  }

  function fitFrance() {
    if (map) map.fitBounds(FRANCE_BOUNDS, { padding: [10, 10] });
  }

  /* ---- Outil de rayon (repris du patron biométhane) ----
     Cercle en double trait (halo blanc + pointillés teal), lisible sur fond
     clair comme sur imagerie satellite ; dessiné / retiré par Filters. */
  function showRadius(lat, lon, km) {
    hideRadius();
    const casing = L.circle([lat, lon], {
      radius: km * 1000, color: '#FFFFFF', weight: 5, opacity: 0.85,
      fill: false, interactive: false,
    });
    const dash = L.circle([lat, lon], {
      radius: km * 1000, color: PALETTE.teal, weight: 2.25,
      dashArray: '8 8', fillColor: PALETTE.teal, fillOpacity: 0.05,
      interactive: false,
    });
    const centre = L.circleMarker([lat, lon], {
      radius: 4, color: '#FFFFFF', weight: 1.5, fillColor: PALETTE.teal, fillOpacity: 1, interactive: false,
    });
    radiusCircle = L.layerGroup([casing, dash, centre]).addTo(map);
    fitRadius();
  }
  function hideRadius() {
    if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }
  }
  // Cadre la vue sur le cercle ; renvoie false s'il n'y en a pas
  function fitRadius() {
    if (!radiusCircle) return false;
    const dash = radiusCircle.getLayers()[1];
    map.fitBounds(dash.getBounds(), { padding: [24, 24] });
    return true;
  }

  function setPickMode(on) {
    picking = !!on;
    map.getContainer().classList.toggle('map-picking', picking);
    if (pickControlLink) pickControlLink.classList.toggle('active', picking);
    const btn = document.getElementById('radius-pick');
    if (btn) {
      btn.setAttribute('aria-pressed', String(picking));
      btn.textContent = picking ? '⌖ Cliquez sur la carte pour placer le centre (Échap pour annuler)'
                                : '⌖ Rayon : choisir un centre sur la carte';
    }
    if (picking) map.closePopup();
  }
  const isPicking = () => picking;

  /* ---- Contours des régions : trait fin gris, chargé au premier affichage ---- */
  function setRegions(on) {
    regionsOn = !!on;
    if (!regionsOn) { if (regionsLayer) map.removeLayer(regionsLayer); return; }
    if (regionsLayer) { regionsLayer.addTo(map); return; }
    fetch(REGIONS_URL).then(r => { if (!r.ok) throw new Error(`${REGIONS_URL} : HTTP ${r.status}`); return r.json(); })
      .then(gj => {
        regionsLayer = L.geoJSON(gj, {
          style: { color: PALETTE.grey, weight: 1, opacity: 0.8, fill: false },
          interactive: false,
        });
        if (regionsOn) regionsLayer.addTo(map);
      })
      .catch(err => { console.warn('Contours des régions indisponibles', err); regionsOn = false; updateLegend(lastData); });
  }

  /* ---- Tracés des réseaux de chaleur (France Chaleur Urbaine) : trait terracotta,
     chargé au premier affichage ; data/reseaux_chaleur.geojson ne contient que les
     réseaux rattachés à au moins un site (la couche complète dépasserait 5 Mo) ---- */
  function setHeat(on) {
    heatOn = !!on;
    if (!heatOn) { if (heatLayer) map.removeLayer(heatLayer); return; }
    if (heatLayer) { heatLayer.addTo(map); return; }
    fetch(HEAT_URL).then(r => { if (!r.ok) throw new Error(`${HEAT_URL} : HTTP ${r.status}`); return r.json(); })
      .then(gj => {
        heatLayer = L.geoJSON(gj, {
          style: { color: PALETTE.terracotta, weight: 2.5, opacity: 0.85 },
          onEachFeature: (feature, layer) => {
            const p = feature.properties || {};
            const parts = [`<strong>${escapeHtml(p.nom || 'Réseau de chaleur')}</strong>`];
            if (p.gestionnaire) parts.push(escapeHtml(p.gestionnaire));
            if (p.taux_enrr != null) parts.push(`EnR&R ${fmtPct(p.taux_enrr, 0)}`);
            if (p.id) parts.push(`SNCU ${escapeHtml(p.id)}`);
            layer.bindTooltip(parts.join('<br>'), { sticky: true, className: 'heat-tooltip' });
            if (p.url) layer.on('click', () => window.open(p.url, '_blank', 'noopener'));
          },
        });
        heatCount = (gj.features || []).length;
        if (heatOn) heatLayer.addTo(map);
        updateLegend(lastData);
      })
      .catch(err => { console.warn('Tracés des réseaux de chaleur indisponibles', err); heatOn = false; updateLegend(lastData); });
  }

  /* Rayon proportionnel à la racine de la puissance : 1 MW → 5 px, 20 MW → 13 px */
  function radiusFor(mw) {
    if (!mw || mw <= 0) return 5;
    return Math.max(5, Math.min(13, 2.6 + Math.sqrt(mw) * 2.35));
  }

  function createIcon(d) {
    const color = statutColor(d.statutKey);
    const r = radiusFor(d.puissance_mw);
    const size = r * 2;
    // hors cible D2 : marqueur estompé ; position ICPE (étape 4) : marqueur cerclé (css .marker-icpe)
    const icpe = d.precisionKey === 'icpe';
    return L.divIcon({
      className: 'site-marker',
      html: `<div class="${icpe ? 'marker-icpe' : 'marker-commune'}" style="width:${size}px;height:${size}px;background:${color};border-radius:50%;
        border:1.5px solid #fff;box-shadow:0 1px 3px rgba(30,66,96,0.4);
        ${d.cible ? '' : 'opacity:0.45;'}"></div>`,
      iconSize: [size, size],
      iconAnchor: [r, r],
      popupAnchor: [0, -r - 2],
    });
  }

  /* ---- Aides d'affichage ---- */
  function statutChip(d) {
    const c = statutColor(d.statutKey);
    return `<span class="chip" style="background:${c}22;color:${c}">${escapeHtml(statutLabel(d.statutKey))}</span>`;
  }
  // Pastille de précision de position : « site ICPE » (cerclé) ou « ≈ commune »
  function precisionChip(d) {
    if (d.precisionKey === 'icpe') {
      return `<span class="chip chip-green" title="Position de l'établissement ICPE apparié (Géorisques, rubrique 2910), confiance ${escapeHtml(CONFIG.confianceInfo(d.icpe_confiance).label.toLowerCase())}">● site ICPE</span>`;
    }
    return `<span class="chip chip-grey" title="Position au centroïde de la commune">≈ commune</span>`;
  }
  function confianceChip(key) {
    const c = CONFIG.confianceInfo(key);
    return `<span class="chip ${c.cls}">${escapeHtml(c.label)}</span>`;
  }
  // Pastille de classe « réseau de chaleur » (étape 5)
  function rcChip(d) {
    const c = CONFIG.rcInfo(d.rcKey);
    return `<span class="chip ${c.cls}" title="${escapeHtml(CONFIG.rcLabel(d.rcKey))}">${escapeHtml(c.short)}</span>`;
  }
  // Résumé d'une ligne : chip + nom du réseau + distance ; pour « aucun », le plus proche à titre indicatif
  function rcSummary(d) {
    if (d.rc_rattache) {
      return `${rcChip(d)} ${escapeHtml(d.rc_nom || '—')}${d.rc_distance_m != null ? ` <span class="kpi-sub">à ${CONFIG.fmtDist(d.rc_distance_m)}</span>` : (d.rc_trace === false ? ' <span class="kpi-sub">(réseau sans tracé)</span>' : '')}`;
    }
    return `${rcChip(d)}${d.rc_distance_m != null ? ` <span class="kpi-sub">plus proche à ${CONFIG.fmtDist(d.rc_distance_m)}</span>` : ''}`;
  }
  const mapsTitle = (d) => (d.precisionKey === 'icpe' ? 'Google Maps sur le site (position ICPE)' : 'Google Maps au centroïde de la commune (pas le site)');
  function actionBar(d) {
    const a = [];
    a.push(`<a class="act" href="#" data-fiche-id="${escapeHtml(d.id)}" title="Fiche complète du site"><span class="act-ico">☰</span>Fiche</a>`);
    if (d.lat != null) a.push(`<a class="act" href="#" data-radius-id="${escapeHtml(d.id)}" title="Tracer un rayon autour de ce site"><span class="act-ico">⌖</span>Rayon</a>`);
    const gm = CONFIG.gmapsUrl(d.lat, d.lon);
    if (gm) a.push(`<a class="act" href="${gm}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(mapsTitle(d))}"><span class="act-ico">◎</span>Maps</a>`);
    if (d.code_eic) a.push(`<a class="act" href="${escapeHtml(CONFIG.odreUrl(d.code_eic))}" target="_blank" rel="noopener noreferrer" title="Enregistrement au registre ODRÉ (code EIC)"><span class="act-ico">⚙</span>ODRÉ</a>`);
    return `<div class="popup-actions">${a.join('')}</div>`;
  }
  function titleHtml(d) {
    return `
      <div class="popup-title"><span class="status-dot" style="background:${statutColor(d.statutKey)}" title="${escapeHtml(statutLabel(d.statutKey))}"></span>${escapeHtml(d.nom)}${d.cible ? '' : ' <span class="chip chip-grey" title="hors cible D2">hors cible</span>'}</div>
      <div class="popup-sub">${escapeHtml([d.commune, d.departement ? `${d.departement} (${d.code_departement})` : ''].filter(Boolean).join(' · '))}</div>`;
  }

  /* ---- Popup : résumé + barre d'actions ---- */
  function popupHtml(d) {
    const rows = [];
    rows.push(['Puissance', `${fmtNum(d.puissance_mw, 2)} MW${d.technologie ? ` · ${escapeHtml(d.technologie)}` : ''}`]);
    rows.push(['Statut', `${statutChip(d)}${d.facteur_charge_pct != null ? ` <span class="kpi-sub">FC ${fmtPct(d.facteur_charge_pct, 1)}</span>` : ''}`]);
    rows.push(['Mise en service', `${d.annee_mes != null ? d.annee_mes : '—'} <span class="chip chip-grey">${escapeHtml(d.cohorte)}</span>`]);
    rows.push(['Fin contrat initial', `${d.fin_contrat_initial != null ? d.fin_contrat_initial : '—'} <span class="chip ${d.fenetreKey === '2026-2031' ? 'chip-green' : 'chip-grey'}" title="${escapeHtml(CONFIG.fenetreLabel(d.fenetreKey))}">${escapeHtml(fenetreShort(d.fenetreKey))}</span>`]);
    rows.push(['Usage probable', escapeHtml(d.usage_probable)]);
    rows.push(['Poste source', `${escapeHtml(d.poste_source || '—')} · ${escapeHtml(d.gestionnaire || '—')}`]);
    if (d.icpe_apparie) {
      rows.push(['ICPE', `${escapeHtml(d.icpe_raison_sociale || '—')}${d.icpe_regime ? ` <span class="chip chip-grey">${escapeHtml(d.icpe_regime)}</span>` : ''} ${precisionChip(d)}`]);
    } else {
      rows.push(['Position', precisionChip(d)]);
    }
    rows.push(['Réseau de chaleur', rcSummary(d)]);
    return `
      ${titleHtml(d)}
      <dl class="popup-grid popup-grid-left">
        ${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}
      </dl>
      ${actionBar(d)}`;
  }

  /* ---- Fiche complète (panneau latéral) : tous les champs ---- */
  function section(title, rows, open = true) {
    return `<details class="fiche-sec"${open ? ' open' : ''}><summary>${title}</summary>
      <dl class="popup-grid popup-grid-left">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v == null || v === '' ? '—' : v}</dd>`).join('')}</dl></details>`;
  }
  function detailHtml(d) {
    const e = (v) => (v == null || v === '' ? '—' : escapeHtml(String(v)));
    const identite = [
      ['Code EIC', e(d.code_eic)],
      ['Nom', e(d.nom)],
      ['Nom masqué', d.nom_confidentiel ? 'oui (« Confidentiel » au registre)' : 'non'],
      ['Commune', e(d.commune)],
      ['Code INSEE', e(d.code_insee)],
      ['Département', d.departement ? `${e(d.departement)} (${e(d.code_departement)})` : '—'],
      ['Région', e(d.region)],
    ];
    const raccordement = [
      ['Gestionnaire', e(d.gestionnaire)],
      ['Poste source', e(d.poste_source)],
      ['Tension', e(d.tension)],
      ['Technologie', e(d.technologie)],
      ['Puissance installée', d.puissance_mw != null ? `${fmtNum(d.puissance_mw, 3)} MW (${fmtInt(d.puissance_kw)} kW)` : '—'],
      ['Puissance de raccordement', d.puissance_raccordement_kw != null ? `${fmtInt(d.puissance_raccordement_kw)} kW` : '—'],
      ['Nombre de groupes', d.nb_groupes != null ? fmtInt(d.nb_groupes) : '—'],
      ['Régime', e(d.regime)],
    ];
    const contrat = [
      ['Date de raccordement', fmtDate(d.date_raccordement)],
      ['Date de mise en service', fmtDate(d.date_mes)],
      ['Année de MES', d.annee_mes != null ? String(d.annee_mes) : '—'],
      ['Cohorte', e(d.cohorte)],
      ['Fin de contrat initial', d.fin_contrat_initial != null ? `${d.fin_contrat_initial} <span class="info-ico" title="MES + 12 ans (C97, C01, C13) ; indicatif">ⓘ</span>` : '—'],
      ['Fenêtre de sortie', e(d.fenetre_sortie)],
      ['Cible D2', d.cible ? '<span class="chip chip-green">oui</span>' : '<span class="chip chip-grey">non</span>'],
    ];
    const activite = [
      ['Énergie injectée (12 mois)', d.energie_injectee_mwh != null ? `${fmtNum(d.energie_injectee_mwh, 1)} MWh` : '—'],
      ['Facteur de charge', d.facteur_charge_pct != null ? `${fmtPct(d.facteur_charge_pct, 2)} <span class="info-ico" title="énergie injectée ÷ (puissance × 8 760 h) ; l'injection n'est pas la production">ⓘ</span>` : '—'],
      ['Statut', statutChip(d)],
      ['Usage probable', e(d.usage_probable)],
    ];
    const icpePos = d.precisionKey === 'icpe';
    const position = [
      ['Latitude', d.lat != null ? fmtNum(d.lat, 4) : '—'],
      ['Longitude', d.lon != null ? fmtNum(d.lon, 4) : '—'],
      ['Précision', icpePos
        ? `${precisionChip(d)} position de l'établissement ICPE apparié (Géorisques)${d.icpe_distance_km != null ? `, à ${fmtNum(d.icpe_distance_km, 1)} km du centroïde de la commune` : ''}`
        : `${precisionChip(d)} position au centroïde de la commune (geo.api.gouv.fr)`],
    ];
    if (icpePos && d.lat_commune != null) position.push(['Centroïde de la commune', `${fmtNum(d.lat_commune, 4)}, ${fmtNum(d.lon_commune, 4)}`]);
    const liens = [];
    if (d.code_eic) liens.push(`<a class="popup-link" href="${escapeHtml(CONFIG.odreUrl(d.code_eic))}" target="_blank" rel="noopener noreferrer" title="Registre national ODRÉ, recherche par code EIC">Registre ODRÉ ↗</a>`);
    const gm = CONFIG.gmapsUrl(d.lat, d.lon);
    if (gm) liens.push(`<a class="popup-link" href="${gm}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(mapsTitle(d))}">Google Maps (${icpePos ? 'site ICPE' : 'centroïde de la commune'}) ↗</a>`);
    if (d.icpe_url) liens.push(`<a class="popup-link" href="${escapeHtml(d.icpe_url)}" target="_blank" rel="noopener noreferrer" title="Fiche de l'établissement dans la base des installations classées">Fiche Géorisques ↗</a>`);
    const an = CONFIG.annuaireUrl(d.icpe_siret);
    if (an) liens.push(`<a class="popup-link" href="${an}" target="_blank" rel="noopener noreferrer" title="Annuaire des entreprises (data.gouv), établissement par SIRET">Annuaire des entreprises ↗</a>`);
    if (d.rc_rattache && d.rc_url) liens.push(`<a class="popup-link" href="${escapeHtml(d.rc_url)}" target="_blank" rel="noopener noreferrer" title="Fiche du réseau sur France Chaleur Urbaine">Fiche France Chaleur Urbaine ↗</a>`);
    return `
      ${titleHtml(d)}
      <div class="fiche-links">${liens.join('')}</div>
      ${section('Identité', identite)}
      ${icpeSection(d)}
      ${rcSection(d)}
      ${section('Raccordement', raccordement)}
      ${section('Contrat', contrat)}
      ${section('Activité', activite)}
      ${section('Position', position, false)}`;
  }

  /* ---- Section « Installation classée » (étape 4, Géorisques rubrique 2910) ----
     Renseignée seulement quand l'appariement est fort ou moyen ; sinon le nombre
     de candidats examinés dans la commune, sans rien inventer. */
  function icpeSection(d) {
    const e = (v) => (v == null || v === '' ? '—' : escapeHtml(String(v)));
    if (!d.icpe_apparie) {
      const n = d.icpe_candidats || 0;
      const txt = n === 0
        ? 'Aucun établissement à rubrique 2910 dans la commune (base Géorisques : établissements à autorisation ou enregistrement ; une cogénération seule en déclaration n\'y figure pas).'
        : `${fmtInt(n)} établissement${n > 1 ? 's' : ''} à rubrique 2910 dans la commune, aucun ne concorde assez (nom, puissance, nature) : position au centroïde conservée.`;
      return `<details class="fiche-sec fiche-sec-icpe" open><summary>Installation classée</summary>
        <p class="icpe-empty">${confianceChip('aucune')} ${txt}</p></details>`;
    }
    const rub = d.icpe_rubrique_2910 || {};
    const an = CONFIG.annuaireUrl(d.icpe_siret);
    const siret = d.icpe_siret
      ? (an ? `<a class="popup-link" href="${an}" target="_blank" rel="noopener noreferrer" title="Annuaire des entreprises (data.gouv)">${e(d.icpe_siret)} ↗</a>` : e(d.icpe_siret))
      : '—';
    const rubTxt = rub.numero
      ? `${e(rub.numero)}${rub.alinea ? `-${e(rub.alinea)}` : ''}${rub.regime ? ` (${e(rub.regime)})` : ''}${rub.puissance_th_mw != null ? ` · ${fmtNum(rub.puissance_th_mw, 2)} MW thermiques` : ''}${rub.unite_corrigee ? ` <span class="info-ico" title="${escapeHtml(rub.unite_corrigee)}">ⓘ</span>` : ''}`
      : 'aucune rubrique listée (établissement « Autres régimes » / « Non ICPE » : déclaration ou dossier ancien)';
    const ratio = rub.puissance_th_mw != null && d.puissance_mw ? rub.puissance_th_mw / d.puissance_mw : null;
    const rows = [
      ['Raison sociale', e(d.icpe_raison_sociale)],
      ['SIRET', siret],
      ['Adresse', e(d.icpe_adresse)],
      ['Régime', e(d.icpe_regime)],
      ['Rubrique 2910', rubTxt],
      ['Puissance th. / élec.', ratio != null ? `× ${fmtNum(ratio, 1)} <span class="info-ico" title="Puissance thermique de combustion déclarée ÷ puissance électrique du registre ; 2 à 3 attendu pour une cogénération seule, davantage si l'établissement hôte a d'autres chaudières">ⓘ</span>` : '—'],
      ['État', e(d.icpe_etat)],
      ['Seveso', e(d.icpe_seveso)],
      ['Confiance', `${confianceChip(d.icpe_confiance)}${d.icpe_score != null ? ` <span class="kpi-sub">score ${fmtNum(d.icpe_score, 2)} · ${fmtInt(d.icpe_candidats)} candidat${d.icpe_candidats > 1 ? 's' : ''} dans la commune</span>` : ''}`],
      ['Fiche Géorisques', d.icpe_url ? `<a class="popup-link" href="${escapeHtml(d.icpe_url)}" target="_blank" rel="noopener noreferrer">${e(d.icpe_code_aiot || 'fiche')} ↗</a>` : '—'],
    ];
    return `<details class="fiche-sec fiche-sec-icpe" open><summary>Installation classée</summary>
      <dl class="popup-grid popup-grid-left">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v == null || v === '' ? '—' : v}</dd>`).join('')}</dl></details>`;
  }

  /* ---- Section « Réseau de chaleur » (étape 5, France Chaleur Urbaine) ----
     Réseau le plus proche : nom, gestionnaire, distance, taux EnR&R, mix, MWh,
     lien vers la fiche. Pour « aucun », seule la distance au tracé le plus proche
     est donnée, à titre indicatif ; un champ absent de la source reste vide. */
  function mixBar(mix) {
    if (!mix) return '—';
    const parts = CONFIG.RC_MIX.filter(m => mix[m.key] != null && mix[m.key] > 0);
    if (!parts.length) return '—';
    const bar = parts.map(m => `<span style="width:${Math.max(0, Math.min(100, mix[m.key]))}%;background:${m.color}" title="${escapeHtml(m.label)} ${fmtPct(mix[m.key], 1)}"></span>`).join('');
    const txt = parts.map(m => `<span class="mix-item"><span class="type-dot" style="background:${m.color}"></span>${escapeHtml(m.label)} ${fmtPct(mix[m.key], 0)}</span>`).join(' ');
    return `<div class="mix-bar" aria-hidden="true">${bar}</div><div class="mix-legend">${txt}</div>`;
  }
  function rcSection(d) {
    const e = (v) => (v == null || v === '' ? '—' : escapeHtml(String(v)));
    const pos = d.precisionKey === 'icpe' ? 'position ICPE' : 'centroïde de la commune';
    if (!d.rc_rattache) {
      const txt = d.rc_distance_m != null
        ? `Aucun réseau de chaleur à moins de ${CONFIG.fmtDist(CONFIG.PARAMS.reseaux_chaleur.proche_m)} du site (${pos}) ni dans sa commune. Tracé le plus proche : ${e(d.rc_nom)}${d.rc_gestionnaire ? ` (${e(d.rc_gestionnaire)})` : ''} à ${CONFIG.fmtDist(d.rc_distance_m)}.`
        : 'Site sans position : rattachement impossible.';
      return `<details class="fiche-sec fiche-sec-rc" open><summary>Réseau de chaleur</summary>
        <p class="icpe-empty">${rcChip(d)} ${txt}</p></details>`;
    }
    const rows = [
      ['Classe', `${rcChip(d)} <span class="kpi-sub">${escapeHtml(CONFIG.rcLabel(d.rcKey))}</span>`],
      ['Réseau', `${e(d.rc_nom)}${d.rc_id ? ` <span class="chip chip-grey" title="Identifiant national du réseau (SNCU)">${e(d.rc_id)}</span>` : ' <span class="chip chip-grey" title="Tracé sans identifiant national : pas de données d\'enquête (mix, livraisons)">sans identifiant SNCU</span>'}`],
      ['Gestionnaire', e(d.rc_gestionnaire)],
      ['Maître d\'ouvrage', e(d.rc_mo)],
      ['Distance au tracé', d.rc_distance_m != null
        ? `${CONFIG.fmtDist(d.rc_distance_m)} <span class="info-ico" title="Distance en Lambert-93 entre le point du site (${escapeHtml(pos)}) et le tracé le plus proche du réseau">ⓘ</span> <span class="kpi-sub">depuis ${escapeHtml(pos)}</span>`
        : (d.rc_trace === false ? 'réseau sans tracé publié (recensé dans la commune)' : '—')],
      ['Dans la commune', d.rc_dans_commune ? 'oui' : 'non'],
      ['Périmètre de développement prioritaire', d.rc_pdp ? '<span class="chip chip-green">oui</span>' : 'non <span class="info-ico" title="Point du site hors des périmètres de développement prioritaire publiés (collecte partielle)">ⓘ</span>'],
      ['Taux EnR&R', d.rc_taux_enrr != null ? `${fmtPct(d.rc_taux_enrr, 1)} <span class="info-ico" title="Arrêté DPE (données 2023 ou moyenne 2021-2023)">ⓘ</span>` : '—'],
      ['Contenu CO2', d.rc_co2 != null ? `${fmtNum(d.rc_co2, 3)} kgCO₂/kWh` : '—'],
      ['Mix énergétique', mixBar(d.rc_mix)],
      ['Production', d.rc_production_mwh != null ? `${fmtInt(d.rc_production_mwh)} MWh` : '—'],
      ['Chaleur livrée', d.rc_mwh_livres != null ? `${fmtInt(d.rc_mwh_livres)} MWh <span class="info-ico" title="Enquête SNCU / Fedene, année 2024">ⓘ</span>` : '—'],
      ['Points de livraison', d.rc_nb_pdl != null ? fmtInt(d.rc_nb_pdl) : '—'],
      ['Année de création', d.rc_annee_creation != null ? String(d.rc_annee_creation) : '—'],
      ['Réseau classé', d.rc_reseau_classe == null ? '—' : (d.rc_reseau_classe ? 'oui' : 'non')],
      ['Fiche France Chaleur Urbaine', d.rc_url ? `<a class="popup-link" href="${escapeHtml(d.rc_url)}" target="_blank" rel="noopener noreferrer">${e(d.rc_id)} ↗</a>` : '—'],
    ];
    return `<details class="fiche-sec fiche-sec-rc" open><summary>Réseau de chaleur</summary>
      <dl class="popup-grid popup-grid-left">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v == null || v === '' ? '—' : v}</dd>`).join('')}</dl></details>`;
  }

  function update(data) {
    lastData = data;
    clusterGroup.clearLayers();
    plainGroup.clearLayers();
    markers.clear();
    dataById.clear();

    const layer = [];
    data.forEach(d => {
      dataById.set(d.id, d);
      if (d.lat == null || d.lon == null) return;
      const marker = L.marker([d.lat, d.lon], {
        icon: createIcon(d),
        title: `${d.nom} · ${d.commune} · ${fmtNum(d.puissance_mw, 1)} MW`,
        alt: d.nom,
      });
      marker.bindPopup(popupHtml(d), { maxWidth: 360, minWidth: 280 });
      layer.push(marker);
      markers.set(d.id, marker);
    });
    if (clustered) clusterGroup.addLayers(layer);
    else layer.forEach(m => plainGroup.addLayer(m));

    document.getElementById('map-empty').hidden = data.length > 0;
    updateLegend(data);
  }

  function setClustered(on) {
    if (on === clustered) return;
    clustered = on;
    if (clustered) { map.removeLayer(plainGroup); map.addLayer(clusterGroup); }
    else { map.removeLayer(clusterGroup); map.addLayer(plainGroup); }
    update(lastData);
  }

  function focusOn(id, openPopup = true) {
    const marker = markers.get(id);
    if (!marker) return;
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 11), { animate: true });
    if (clustered) clusterGroup.zoomToShowLayer(marker, () => { if (openPopup) marker.openPopup(); });
    else if (openPopup) marker.openPopup();
  }

  /* ---- Légende dynamique : statuts présents + effectifs, cliquable ---- */

  function addLegend() {
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => {
      legendDiv = L.DomUtil.create('div', 'map-legend');
      L.DomEvent.disableClickPropagation(legendDiv);
      L.DomEvent.disableScrollPropagation(legendDiv);
      return legendDiv;
    };
    legend.addTo(map);
  }

  function updateLegend(data) {
    if (!legendDiv) return;
    const counts = {}, mw = {};
    data.forEach(d => {
      counts[d.statutKey] = (counts[d.statutKey] || 0) + 1;
      mw[d.statutKey] = (mw[d.statutKey] || 0) + (d.puissance_mw || 0);
    });
    const sel = Filters.getState().sel.statut;
    const keys = CONFIG.STATUTS.map(s => s.key).filter(k => counts[k] || !sel.has(k));

    legendDiv.classList.toggle('collapsed', legendCollapsed);
    legendDiv.innerHTML = `
      <button class="map-legend-toggle" aria-expanded="${!legendCollapsed}"
              aria-label="Afficher ou masquer la légende">
        <span class="map-legend-title">Statut (facteur de charge)</span>
        <span class="chevron" aria-hidden="true">▼</span>
      </button>
      <div class="map-legend-body">
      ${keys.map(k => `<div class="legend-item${sel.has(k) ? '' : ' legend-off'}" data-statut="${escapeHtml(k)}" role="button" tabindex="0"
             title="Cliquer pour masquer / afficher ce statut">
          <span class="type-dot" style="background:${statutColor(k)}"></span>
          <span class="type-name">${escapeHtml(statutLabel(k))}</span>
          <span class="type-count">${fmtInt(counts[k] || 0)} · ${fmtInt(mw[k] || 0)} MW</span>
        </div>`).join('')}
      <div class="legend-note">Taille du point ∝ puissance (MW) · <span class="legend-swatch icpe"></span> site ICPE (Géorisques) · <span class="legend-swatch"></span> centroïde de commune</div>
      <label class="legend-toggle"><input type="checkbox" id="legend-cluster" ${clustered ? 'checked' : ''}> Regrouper les marqueurs</label>
      <label class="legend-toggle"><input type="checkbox" id="legend-regions" ${regionsOn ? 'checked' : ''}> Contours des régions</label>
      <label class="legend-toggle" title="Tracés des réseaux rattachés à au moins un site (France Chaleur Urbaine, data.gouv.fr) ; survol : nom et gestionnaire, clic : fiche du réseau"><input type="checkbox" id="legend-heat" ${heatOn ? 'checked' : ''}> <span class="legend-swatch rc"></span> Tracés des réseaux de chaleur${heatCount != null ? ` <span class="type-count">${fmtInt(heatCount)}</span>` : ''}</label>
      </div>`;

    legendDiv.querySelector('.map-legend-toggle').addEventListener('click', () => {
      legendCollapsed = !legendCollapsed;
      legendDiv.classList.toggle('collapsed', legendCollapsed);
      legendDiv.querySelector('.map-legend-toggle').setAttribute('aria-expanded', String(!legendCollapsed));
    });
    legendDiv.querySelector('#legend-cluster').addEventListener('change', (e) => setClustered(e.target.checked));
    legendDiv.querySelector('#legend-regions').addEventListener('change', (e) => setRegions(e.target.checked));
    legendDiv.querySelector('#legend-heat').addEventListener('change', (e) => setHeat(e.target.checked));

    legendDiv.querySelectorAll('.legend-item').forEach(el => {
      const toggle = () => Filters.toggleValue('statut', el.dataset.statut);
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  function invalidateSize() {
    if (map) map.invalidateSize();
  }

  return { init, update, focusOn, invalidateSize, fitFrance, popupHtml, detailHtml, setClustered,
           showRadius, hideRadius, fitRadius, setPickMode, isPicking, setRegions, setHeat };
})();
