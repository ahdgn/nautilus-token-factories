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

    // Liens des popups : « Fiche » -> panneau fiche du site
    map.on('popupopen', (e) => {
      const el = e.popup.getElement();
      const fi = el.querySelector('a[data-fiche-id]');
      if (fi) fi.addEventListener('click', (ev) => {
        ev.preventDefault();
        const d = dataById.get(fi.dataset.ficheId);
        if (d) Fiche.open(d);
        map.closePopup();
      });
    });

    // vue d'entrée : la France entière, quelle que soit la taille de l'écran
    fitFrance();
  }

  function fitFrance() {
    if (map) map.fitBounds(FRANCE_BOUNDS, { padding: [10, 10] });
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
    // hors cible D2 : marqueur estompé
    return L.divIcon({
      className: 'site-marker',
      html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;
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
  function actionBar(d) {
    const a = [];
    a.push(`<a class="act" href="#" data-fiche-id="${escapeHtml(d.id)}" title="Fiche complète du site"><span class="act-ico">☰</span>Fiche</a>`);
    const gm = CONFIG.gmapsUrl(d.lat, d.lon);
    if (gm) a.push(`<a class="act" href="${gm}" target="_blank" rel="noopener noreferrer" title="Google Maps au centroïde de la commune (pas le site)"><span class="act-ico">◎</span>Maps</a>`);
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
    rows.push(['Poste source', `${escapeHtml(d.poste_source || '—')} · ${escapeHtml(d.gestionnaire || '—')} <span class="chip chip-grey" title="position au centroïde de la commune">≈ commune</span>`]);
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
    const position = [
      ['Latitude', d.lat != null ? fmtNum(d.lat, 4) : '—'],
      ['Longitude', d.lon != null ? fmtNum(d.lon, 4) : '—'],
      ['Précision', `${e(d.geo_precision)} — position au centroïde de la commune`],
    ];
    const liens = [];
    if (d.code_eic) liens.push(`<a class="popup-link" href="${escapeHtml(CONFIG.odreUrl(d.code_eic))}" target="_blank" rel="noopener noreferrer" title="Registre national ODRÉ, recherche par code EIC">Registre ODRÉ ↗</a>`);
    const gm = CONFIG.gmapsUrl(d.lat, d.lon);
    if (gm) liens.push(`<a class="popup-link" href="${gm}" target="_blank" rel="noopener noreferrer" title="Centre de la commune, pas le site">Google Maps (centroïde de la commune) ↗</a>`);
    return `
      ${titleHtml(d)}
      <div class="fiche-links">${liens.join('')}</div>
      ${section('Identité', identite)}
      ${section('Raccordement', raccordement)}
      ${section('Contrat', contrat)}
      ${section('Activité', activite)}
      ${section('Position', position, false)}`;
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
      <div class="legend-note">Taille du point ∝ puissance (MW) · position au centroïde de la commune</div>
      <label class="legend-toggle"><input type="checkbox" id="legend-cluster" ${clustered ? 'checked' : ''}> Regrouper les marqueurs</label>
      </div>`;

    legendDiv.querySelector('.map-legend-toggle').addEventListener('click', () => {
      legendCollapsed = !legendCollapsed;
      legendDiv.classList.toggle('collapsed', legendCollapsed);
      legendDiv.querySelector('.map-legend-toggle').setAttribute('aria-expanded', String(!legendCollapsed));
    });
    legendDiv.querySelector('#legend-cluster').addEventListener('change', (e) => setClustered(e.target.checked));

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

  return { init, update, focusOn, invalidateSize, fitFrance, popupHtml, detailHtml, setClustered };
})();
