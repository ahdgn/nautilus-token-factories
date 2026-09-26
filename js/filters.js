/* ============================================
   Filters — état, logique de filtrage, KPI,
   synchronisation URL (état partageable)
   ============================================ */

const Filters = (() => {
  const { fmtInt, fmtNum, escapeHtml, statutColor, statutLabel, fenetreLabel, STATUTS, FENETRES, PARAMS } = CONFIG;

  /* Groupes à choix multiples : clé d'état, id du conteneur, paramètre URL,
     lecture de la valeur sur un enregistrement, libellé, couleur. */
  const GROUPS = {
    statut:  { id: 'filter-statut',  url: 's',  value: (d) => d.statutKey, label: statutLabel, color: statutColor },
    fenetre: { id: 'filter-fenetre', url: 'w',  value: (d) => d.fenetreKey, label: fenetreLabel },
    cohorte: { id: 'filter-cohorte', url: 'co', value: (d) => d.cohorte },
    region:  { id: 'filter-region',  url: 'r',  value: (d) => d.region || 'Inconnue' },
    usage:   { id: 'filter-usage',   url: 'u',  value: (d) => d.usage_probable },
    tranche: { id: 'filter-tranche', url: 'p',  value: (d) => d.trancheKey || 'hors',
               label: (k) => { const t = CONFIG.tranches().find(x => x.key === k); return t ? t.label : 'Hors tranches'; } },
  };

  const state = {
    cible: true,        // cible D2 (cochée par défaut)
    search: '',
    gestionnaire: '',
    masque: '',         // '' | 'nommes' | 'confidentiels'
    sel: {},            // groupe -> Set des valeurs retenues
  };
  const options = {};   // groupe -> liste ordonnée des valeurs possibles
  let allData = [];
  let filteredData = [];
  const onChangeCallbacks = [];

  /* ---------------- init ---------------- */

  function init(data) {
    allData = data;
    computeOptions();
    restoreFromURL();
    populateOptions();
    bindEvents();
    syncControls();
    applyFilters();
  }

  function computeOptions() {
    Object.entries(GROUPS).forEach(([g, cfg]) => {
      const counts = {};
      allData.forEach(d => { const v = cfg.value(d); counts[v] = (counts[v] || 0) + 1; });
      let keys = Object.keys(counts);
      // ordre : statuts et fenêtres dans l'ordre de la config, cohortes et
      // tranches dans l'ordre des paramètres, le reste par effectif décroissant
      if (g === 'statut') keys = STATUTS.map(s => s.key).filter(k => counts[k] != null).concat(keys.filter(k => !STATUTS.some(s => s.key === k)));
      else if (g === 'fenetre') keys = FENETRES.map(f => f.key).filter(k => counts[k] != null).concat(keys.filter(k => !FENETRES.some(f => f.key === k)));
      else if (g === 'cohorte') keys = PARAMS.cohortes.map(c => c.label).filter(k => counts[k] != null).concat(keys.filter(k => !PARAMS.cohortes.some(c => c.label === k)));
      else if (g === 'tranche') keys = CONFIG.tranches().map(t => t.key).filter(k => counts[k] != null).concat(keys.filter(k => !CONFIG.tranches().some(t => t.key === k)));
      else if (g === 'region') keys.sort((a, b) => a.localeCompare(b, 'fr'));
      else keys.sort((a, b) => counts[b] - counts[a]);
      options[g] = keys.map(k => ({ key: k, count: counts[k] }));
      state.sel[g] = new Set(keys);
    });
  }

  function populateOptions() {
    Object.entries(GROUPS).forEach(([g, cfg]) => {
      const container = document.getElementById(cfg.id);
      container.innerHTML = options[g].map(o => {
        const label = cfg.label ? cfg.label(o.key) : o.key;
        const dot = cfg.color ? `<span class="type-dot" style="background:${cfg.color(o.key)}"></span>` : '';
        return `<label>
          <input type="checkbox" value="${escapeHtml(o.key)}" ${state.sel[g].has(o.key) ? 'checked' : ''}>
          ${dot}
          <span class="type-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
          <span class="type-count">${fmtInt(o.count)}</span>
        </label>`;
      }).join('');
    });

    // Gestionnaires (effectif décroissant)
    const counts = {};
    allData.forEach(d => { if (d.gestionnaire) counts[d.gestionnaire] = (counts[d.gestionnaire] || 0) + 1; });
    const select = document.getElementById('filter-gestionnaire');
    Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'fr'))
      .forEach(gest => select.appendChild(new Option(`${gest} (${fmtInt(counts[gest])})`, gest)));
  }

  /* ---------------- URL <-> état ---------------- */

  function restoreFromURL() {
    const hash = location.hash.replace(/^#/, '');
    if (!hash) return;
    const p = new URLSearchParams(hash);
    if (p.get('c') === '0') state.cible = false;
    if (p.has('q')) state.search = p.get('q').trim().toLowerCase();
    if (p.has('g')) state.gestionnaire = p.get('g');
    if (p.has('n') && ['nommes', 'confidentiels'].includes(p.get('n'))) state.masque = p.get('n');
    Object.entries(GROUPS).forEach(([g, cfg]) => {
      if (!p.has(cfg.url)) return;
      const wanted = new Set(p.get(cfg.url).split('|'));
      const valid = options[g].map(o => o.key).filter(k => wanted.has(k));
      state.sel[g] = new Set(valid); // liste vide = rien d'affiché, comme dans l'UI
    });
  }

  function writeURL() {
    const p = new URLSearchParams();
    if (!state.cible) p.set('c', '0');
    if (state.search) p.set('q', state.search);
    if (state.gestionnaire) p.set('g', state.gestionnaire);
    if (state.masque) p.set('n', state.masque);
    Object.entries(GROUPS).forEach(([g, cfg]) => {
      if (state.sel[g].size !== options[g].length) p.set(cfg.url, [...state.sel[g]].join('|'));
    });
    const s = p.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }

  /* ---------------- événements ---------------- */

  function bindEvents() {
    // Cible D2
    document.getElementById('filter-cible').addEventListener('change', (e) => {
      state.cible = e.target.checked;
      applyFilters();
    });
    const infoBtn = document.getElementById('cible-info-btn');
    const infoPop = document.getElementById('cible-info');
    infoBtn.addEventListener('click', () => {
      const open = infoPop.hidden;
      infoPop.hidden = !open;
      infoBtn.setAttribute('aria-expanded', String(open));
    });

    // Recherche (debounce)
    const searchInput = document.getElementById('filter-search');
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.search = searchInput.value.trim().toLowerCase();
        applyFilters();
      }, 200);
    });

    // Groupes à choix multiples
    Object.entries(GROUPS).forEach(([g, cfg]) => {
      document.getElementById(cfg.id).addEventListener('change', () => {
        readGroup(g);
        applyFilters();
      });
    });
    document.querySelectorAll('[data-all]').forEach(b => b.addEventListener('click', () => setAll(b.dataset.all, true)));
    document.querySelectorAll('[data-none]').forEach(b => b.addEventListener('click', () => setAll(b.dataset.none, false)));
    // Raccourci régions prioritaires (D5)
    document.getElementById('regions-prio').addEventListener('click', () => {
      const prio = new Set(PARAMS.regions_prioritaires);
      state.sel.region = new Set(options.region.map(o => o.key).filter(k => prio.has(k)));
      syncGroup('region');
      applyFilters();
    });

    // Gestionnaire
    document.getElementById('filter-gestionnaire').addEventListener('change', (e) => {
      state.gestionnaire = e.target.value;
      applyFilters();
    });

    // Nom masqué
    document.getElementById('filter-masque').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-masque]');
      if (!btn) return;
      state.masque = btn.dataset.masque;
      syncSegmented('filter-masque', 'masque', state.masque);
      applyFilters();
    });

    // Réinitialisation
    document.getElementById('btn-reset').addEventListener('click', resetFilters);
    const mapReset = document.getElementById('map-empty-reset');
    if (mapReset) mapReset.addEventListener('click', resetFilters);
  }

  function readGroup(g) {
    state.sel[g] = new Set([...document.querySelectorAll(`#${GROUPS[g].id} input:checked`)].map(cb => cb.value));
  }

  function setAll(g, checked) {
    state.sel[g] = checked ? new Set(options[g].map(o => o.key)) : new Set();
    syncGroup(g);
    applyFilters();
  }

  // Bascule une valeur isolée (appelé par la légende carte pour le statut)
  function toggleValue(g, key) {
    if (!GROUPS[g]) return;
    if (state.sel[g].has(key)) state.sel[g].delete(key); else state.sel[g].add(key);
    syncGroup(g);
    applyFilters();
  }

  /* ---------------- synchronisation UI ---------------- */

  function syncSegmented(groupId, dataAttr, value) {
    document.querySelectorAll(`#${groupId} .seg-btn`).forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset[dataAttr] === value));
    });
  }

  function syncGroup(g) {
    document.querySelectorAll(`#${GROUPS[g].id} input`).forEach(cb => {
      cb.checked = state.sel[g].has(cb.value);
    });
  }

  function syncControls() {
    document.getElementById('filter-cible').checked = state.cible;
    document.getElementById('filter-search').value = state.search;
    document.getElementById('filter-gestionnaire').value = state.gestionnaire;
    syncSegmented('filter-masque', 'masque', state.masque);
    Object.keys(GROUPS).forEach(syncGroup);
  }

  function activeFilterCount() {
    let n = 0;
    if (!state.cible) n++;  // l'état par défaut est « cible cochée »
    if (state.search) n++;
    if (state.gestionnaire) n++;
    if (state.masque) n++;
    Object.keys(GROUPS).forEach(g => { if (state.sel[g].size !== options[g].length) n++; });
    return n;
  }

  /* ---------------- filtrage ---------------- */

  function applyFilters() {
    filteredData = allData.filter(d => {
      if (state.cible && !d.cible) return false;
      if (state.masque === 'nommes' && d.nom_confidentiel) return false;
      if (state.masque === 'confidentiels' && !d.nom_confidentiel) return false;
      if (state.gestionnaire && d.gestionnaire !== state.gestionnaire) return false;
      if (state.search) {
        const hit = (d.nom || '').toLowerCase().includes(state.search)
          || (d.commune || '').toLowerCase().includes(state.search)
          || (d.poste_source || '').toLowerCase().includes(state.search);
        if (!hit) return false;
      }
      for (const [g, cfg] of Object.entries(GROUPS)) {
        if (!state.sel[g].has(cfg.value(d))) return false;
      }
      return true;
    });

    const n = activeFilterCount();
    const resetBtn = document.getElementById('btn-reset');
    resetBtn.hidden = n === 0;
    document.getElementById('reset-count').textContent = n;

    updateKPIs();
    writeURL();
    onChangeCallbacks.forEach(cb => cb(filteredData));
  }

  /* ---------------- KPI ---------------- */

  const sumMw = (arr) => arr.reduce((s, d) => s + (d.puissance_mw || 0), 0);

  function updateKPIs() {
    const strip = document.getElementById('kpi-strip');
    const f = filteredData;
    const dorm = f.filter(d => d.statutKey === 'dormante');
    const fen = f.filter(d => d.fenetreKey === '2026-2031');
    const nommes = f.filter(d => !d.nom_confidentiel).length;
    const conf = f.length - nommes;

    const cards = [];
    cards.push(kpi('Sites', `${fmtInt(f.length)} <span class="kpi-sub">/ ${fmtInt(allData.length)}</span>`));
    cards.push(kpi('Puissance installée', `${fmtInt(sumMw(f))} <span class="kpi-sub">MW</span>`, true));
    cards.push(kpi('Dormantes (FC < 5 %)', `${fmtInt(dorm.length)} <span class="kpi-sub">· ${fmtInt(sumMw(dorm))} MW</span>`));
    cards.push(kpi('Sortie OA 2026-2031', `${fmtInt(fen.length)} <span class="kpi-sub">· ${fmtInt(sumMw(fen))} MW</span>`));
    cards.push(kpi('Nommés / confidentiels', `${fmtInt(nommes)} <span class="kpi-sub">/ ${fmtInt(conf)}</span>`));

    strip.innerHTML = cards.join('');
  }

  function kpi(label, valueHtml, accent = false) {
    return `<div class="kpi-card${accent ? ' kpi-accent' : ''}">
      <span class="kpi-label">${label}</span>
      <span class="kpi-value">${valueHtml}</span>
    </div>`;
  }

  /* ---------------- reset ---------------- */

  function resetFilters() {
    state.cible = true;
    state.search = '';
    state.gestionnaire = '';
    state.masque = '';
    Object.keys(GROUPS).forEach(g => { state.sel[g] = new Set(options[g].map(o => o.key)); });
    syncControls();
    applyFilters();
  }

  function onChange(cb) { onChangeCallbacks.push(cb); }
  function getFiltered() { return filteredData; }
  function getState() { return state; }

  return { init, onChange, getFiltered, getState, toggleValue, resetFilters };
})();
