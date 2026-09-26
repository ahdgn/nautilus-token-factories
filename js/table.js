/* ============================================
   Table — tri accessible (aria-sort), pagination
   avec sélecteur de taille, export CSV filtré
   (séparateur « ; », UTF-8 avec BOM, décimale virgule)
   ============================================ */

const DataTable = (() => {
  const { fmtNum, fmtPct, escapeHtml, statutColor, statutLabel, fenetreShort, fenetreLabel, csvNum } = CONFIG;

  let currentData = [];
  let sortKey = 'puissance_mw';
  let sortDir = 'desc';
  let currentPage = 1;
  let pageSize = 25;
  const NUMERIC_DESC = ['puissance_mw', 'facteur_charge_pct', 'annee_mes', 'fin_contrat_initial'];

  function init() {
    bindEvents();
    updateSortUI();
  }

  function bindEvents() {
    document.querySelectorAll('#data-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (sortKey === key) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = key;
          // premier clic : ordre le plus utile selon la colonne
          sortDir = NUMERIC_DESC.includes(key) ? 'desc' : 'asc';
        }
        updateSortUI();
        render();
      });
    });

    document.getElementById('page-size').addEventListener('change', (e) => {
      pageSize = parseInt(e.target.value, 10);
      currentPage = 1;
      render();
    });

    document.getElementById('btn-export').addEventListener('click', exportCSV);
  }

  function update(data) {
    currentData = data;
    currentPage = 1;
    render();
  }

  function render() {
    const sorted = sortData(currentData);
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * pageSize;
    const pageData = sorted.slice(start, start + pageSize);

    const mw = currentData.reduce((s, d) => s + (d.puissance_mw || 0), 0);
    document.getElementById('table-count').innerHTML =
      `<strong>${total.toLocaleString('fr-FR')}</strong> site${total > 1 ? 's' : ''} · ${fmtNum(mw, 0)} MW`;
    document.getElementById('table-range').textContent = total === 0 ? '' :
      `${(start + 1).toLocaleString('fr-FR')}–${Math.min(start + pageSize, total).toLocaleString('fr-FR')} sur ${total.toLocaleString('fr-FR')}`;
    document.getElementById('table-empty').hidden = total > 0;

    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    pageData.forEach(d => {
      const tr = document.createElement('tr');
      tr.dataset.id = d.id;
      tr.title = 'Cliquer pour localiser sur la carte et ouvrir la fiche';
      const c = statutColor(d.statutKey);

      tr.innerHTML = `
        <td title="${escapeHtml(d.nom)}${d.cible ? '' : ' (hors cible D2)'}">${escapeHtml(d.nom || '—')}${d.cible ? '' : ' <span class="chip chip-grey">hors cible</span>'}</td>
        <td>${escapeHtml(d.commune || '—')}</td>
        <td title="${escapeHtml(d.departement || '')}">${escapeHtml(d.code_departement || '—')}</td>
        <td>${escapeHtml(d.region || '—')}</td>
        <td class="col-num">${fmtNum(d.puissance_mw, 2)}</td>
        <td title="${escapeHtml(d.technologie || '')}">${escapeHtml(d.technologie || '—')}</td>
        <td class="col-num">${d.annee_mes != null ? d.annee_mes : '—'}</td>
        <td class="col-num">${d.fin_contrat_initial != null ? d.fin_contrat_initial : '—'}</td>
        <td title="${escapeHtml(fenetreLabel(d.fenetreKey))}">${escapeHtml(fenetreShort(d.fenetreKey))}</td>
        <td class="col-num" title="${d.energie_injectee_mwh != null ? fmtNum(d.energie_injectee_mwh, 0) + ' MWh injectés sur 12 mois' : 'énergie non renseignée'}">${d.facteur_charge_pct != null ? fmtNum(d.facteur_charge_pct, 1) : '—'}</td>
        <td><span class="status-tag" style="background:${c}22;color:${c}">${escapeHtml(statutLabel(d.statutKey))}</span></td>
        <td title="${escapeHtml(d.usage_probable)}">${escapeHtml(d.usage_probable || '—')}</td>
        <td>${escapeHtml(d.poste_source || '—')}</td>
        <td title="${escapeHtml(d.gestionnaire || '')}">${escapeHtml(d.gestionnaire || '—')}</td>
      `;

      tr.addEventListener('click', () => {
        document.querySelectorAll('#data-table tbody tr').forEach(r => r.classList.remove('highlighted'));
        tr.classList.add('highlighted');
        MapView.focusOn(d.id, false);
        Fiche.open(d);
      });

      tbody.appendChild(tr);
    });

    renderPagination(totalPages);
  }

  function sortData(data) {
    const numeric = ['puissance_mw', 'facteur_charge_pct', 'annee_mes', 'fin_contrat_initial'];
    return [...data].sort((a, b) => {
      let va = a[sortKey];
      let vb = b[sortKey];
      // valeurs absentes : toujours en fin de liste
      if (va == null || va === '') va = numeric.includes(sortKey) ? (sortDir === 'asc' ? Infinity : -Infinity) : (sortDir === 'asc' ? '￿' : '');
      if (vb == null || vb === '') vb = numeric.includes(sortKey) ? (sortDir === 'asc' ? Infinity : -Infinity) : (sortDir === 'asc' ? '￿' : '');

      let cmp;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), 'fr', { sensitivity: 'base', numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  function updateSortUI() {
    document.querySelectorAll('#data-table th[data-sort]').forEach(th => {
      if (th.dataset.sort === sortKey) {
        th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
      } else {
        th.setAttribute('aria-sort', 'none');
      }
    });
  }

  function renderPagination(totalPages) {
    const container = document.getElementById('pagination');
    container.innerHTML = '';
    if (totalPages <= 1) return;

    const mk = (label, page, opts = {}) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (opts.disabled) btn.disabled = true;
      if (opts.current) btn.setAttribute('aria-current', 'page');
      if (opts.aria) btn.setAttribute('aria-label', opts.aria);
      if (page != null && !opts.disabled && !opts.current) {
        btn.addEventListener('click', () => { currentPage = page; render(); });
      }
      container.appendChild(btn);
      return btn;
    };

    mk('‹', currentPage - 1, { disabled: currentPage === 1, aria: 'Page précédente' });

    const maxVisible = 7;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    const endPage = Math.min(totalPages, startPage + maxVisible - 1);
    startPage = Math.max(1, endPage - maxVisible + 1);

    if (startPage > 1) {
      mk('1', 1, { current: currentPage === 1 });
      if (startPage > 2) mk('…', null, { disabled: true });
    }
    for (let i = startPage; i <= endPage; i++) mk(String(i), i, { current: i === currentPage });
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) mk('…', null, { disabled: true });
      mk(String(totalPages), totalPages, { current: currentPage === totalPages });
    }

    mk('›', currentPage + 1, { disabled: currentPage === totalPages, aria: 'Page suivante' });
  }

  /* Export du jeu filtré, dans l'ordre de tri courant : tous les champs du
     jeu de données plus les liens ODRÉ et Google Maps. */
  function exportCSV() {
    if (currentData.length === 0) return;

    const headers = ['Code EIC', 'Nom', 'Nom masqué', 'Commune', 'Code INSEE', 'Département', 'Code département', 'Région',
      'Gestionnaire', 'Poste source', 'Tension', 'Technologie', 'Puissance installée (kW)', 'Puissance installée (MW)',
      'Puissance de raccordement (kW)', 'Nombre de groupes', 'Date de raccordement', 'Date de mise en service', 'Année MES',
      'Cohorte', 'Fin de contrat initial (MES + 12)', 'Énergie injectée 12 mois (MWh)', 'Facteur de charge (%)', 'Statut',
      'Fenêtre de sortie', 'Cible D2', 'Usage probable', 'Régime', 'Latitude', 'Longitude', 'Précision géo',
      'Lien registre ODRÉ', 'Lien Google Maps (centroïde commune)'];

    const rows = sortData(currentData).map(d => [
      d.code_eic || '', d.nom || '', d.nom_confidentiel ? 'oui' : 'non', d.commune || '', d.code_insee || '',
      d.departement || '', d.code_departement || '', d.region || '',
      d.gestionnaire || '', d.poste_source || '', d.tension || '', d.technologie || '',
      csvNum(d.puissance_kw), csvNum(d.puissance_mw), csvNum(d.puissance_raccordement_kw), csvNum(d.nb_groupes),
      d.date_raccordement || '', d.date_mes || '', d.annee_mes != null ? d.annee_mes : '',
      d.cohorte || '', d.fin_contrat_initial != null ? d.fin_contrat_initial : '',
      csvNum(d.energie_injectee_mwh), d.facteur_charge_pct != null ? csvNum(Math.round(d.facteur_charge_pct * 100) / 100) : '',
      d.statut || '', d.fenetre_sortie || '', d.cible ? 'oui' : 'non', d.usage_probable || '', d.regime || '',
      csvNum(d.lat), csvNum(d.lon), d.geo_precision || '',
      d.code_eic ? CONFIG.odreUrl(d.code_eic) : '', CONFIG.gmapsUrl(d.lat, d.lon) || '',
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell == null ? '' : cell).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');

    const BOM = '﻿'; // BOM UTF-8 pour Excel
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nautilus-token-factories-cogenerations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { init, update, exportCSV };
})();
