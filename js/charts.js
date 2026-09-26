/* ============================================
   Charts — Chart.js
   Cohorte × statut (empilé, unités ou MW),
   MW par région, unités par tranche de puissance,
   unités par usage probable ; couleurs = statut
   ============================================ */

const Charts = (() => {
  const { PALETTE, fmtInt, fmtNum, statutColor, statutLabel, STATUTS, PARAMS } = CONFIG;

  let chartCohorte, chartRegions, chartTranches, chartUsages;
  let lastData = [];
  const cohorteOpts = { metric: 'sites' };

  const GRID = 'rgba(30, 66, 96, 0.08)';

  const baseOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#FFFFFF',
        titleColor: PALETTE.navy,
        bodyColor: '#24303C',
        borderColor: '#D5DCE4',
        borderWidth: 1,
        cornerRadius: 6,
        padding: 10,
        titleFont: { family: 'Roboto', weight: '700' },
        bodyFont: { family: 'Roboto' },
      },
    },
  });

  const legendTop = () => ({
    display: true,
    position: 'top',
    align: 'end',
    labels: { usePointStyle: true, pointStyleWidth: 8, boxHeight: 6, padding: 10 },
  });

  function init() {
    Chart.defaults.color = '#5F6B7A';
    Chart.defaults.font.family = 'Roboto';
    Chart.defaults.font.size = 11;

    chartCohorte = new Chart(document.getElementById('chart-cohorte'), {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: stackedOptions('Unités', (ctx) => ` ${ctx.dataset.label} : ${
        cohorteOpts.metric === 'sites' ? fmtInt(ctx.parsed.y) + ' unité' + (ctx.parsed.y > 1 ? 's' : '') : fmtNum(ctx.parsed.y, 0) + ' MW'}`, true),
    });

    chartRegions = new Chart(document.getElementById('chart-regions'), {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: horizontalBarOptions('MW', (ctx) => ` ${fmtNum(ctx.parsed.x, 0)} MW`),
    });

    chartTranches = new Chart(document.getElementById('chart-tranches'), {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: stackedOptions('Unités', (ctx) => ` ${ctx.dataset.label} : ${fmtInt(ctx.parsed.y)}`, false),
    });

    chartUsages = new Chart(document.getElementById('chart-usages'), {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: { ...horizontalBarOptions('Unités', (ctx) => ` ${ctx.dataset.label} : ${fmtInt(ctx.parsed.x)}`),
                 scales: { x: { stacked: true, beginAtZero: true, grid: { color: GRID }, ticks: { callback: (v) => v.toLocaleString('fr-FR') },
                                title: { display: true, text: 'Unités', font: { size: 11 } } },
                           y: { stacked: true, grid: { display: false }, ticks: { color: '#24303C', font: { size: 10.5 }, autoSkip: false } } } },
    });

    bindControls();
  }

  function stackedOptions(yTitle, tooltipLabel, withLegend) {
    const o = baseOptions();
    return {
      ...o,
      plugins: {
        ...o.plugins,
        legend: withLegend ? legendTop() : { display: false },
        tooltip: { ...o.plugins.tooltip, callbacks: { label: tooltipLabel } },
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: GRID },
          ticks: { callback: (v) => v.toLocaleString('fr-FR') },
          title: { display: true, text: yTitle, font: { size: 11 } },
        },
      },
    };
  }

  function horizontalBarOptions(xTitle, tooltipLabel) {
    const o = baseOptions();
    return {
      ...o,
      indexAxis: 'y',
      plugins: {
        ...o.plugins,
        tooltip: { ...o.plugins.tooltip, callbacks: { label: tooltipLabel } },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: GRID },
          ticks: { callback: (v) => v.toLocaleString('fr-FR') },
          title: { display: true, text: xTitle, font: { size: 11 } },
        },
        y: {
          grid: { display: false },
          ticks: { color: '#24303C', font: { size: 10.5 }, autoSkip: false,
                   callback: function (v) {
                     const label = this.getLabelForValue(v);
                     return label.length > 26 ? label.slice(0, 25) + '…' : label;
                   } },
        },
      },
    };
  }

  function bindControls() {
    document.getElementById('cohorte-metric').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-metric]');
      if (!btn) return;
      cohorteOpts.metric = btn.dataset.metric;
      document.querySelectorAll('#cohorte-metric .seg-btn').forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.metric === cohorteOpts.metric)));
      updateCohorte(lastData);
    });
  }

  function update(data) {
    lastData = data;
    updateCohorte(data);
    updateRegions(data);
    updateTranches(data);
    updateUsages(data);
  }

  function setEmpty(canvasId, empty) {
    const card = document.getElementById(canvasId).closest('.chart-card');
    card.querySelector('.chart-empty').hidden = !empty;
  }

  /* Un jeu de données par statut présent, empilé sur les libellés donnés */
  function statutDatasets(data, labels, keyOf, metricOf, thickness) {
    const present = STATUTS.filter(s => data.some(d => d.statutKey === s.key));
    return present.map(s => {
      const acc = Object.fromEntries(labels.map(l => [l, 0]));
      data.filter(d => d.statutKey === s.key).forEach(d => {
        const k = keyOf(d);
        if (k in acc) acc[k] += metricOf(d);
      });
      return { label: s.label, data: labels.map(l => Math.round(acc[l] * 10) / 10),
               backgroundColor: statutColor(s.key), borderRadius: 2, maxBarThickness: thickness };
    });
  }

  /* ---- Cohorte × statut ---- */
  function updateCohorte(data) {
    setEmpty('chart-cohorte', data.length === 0);
    const labels = PARAMS.cohortes.map(c => c.label).filter(l => data.some(d => d.cohorte === l));
    const isMw = cohorteOpts.metric === 'mw';
    chartCohorte.options.scales.y.title.text = isMw ? 'MW' : 'Unités';
    chartCohorte.data.labels = labels;
    chartCohorte.data.datasets = statutDatasets(data, labels, d => d.cohorte, d => (isMw ? (d.puissance_mw || 0) : 1), 40);
    chartCohorte.update('none');
  }

  /* ---- MW par région ---- */
  function updateRegions(data) {
    setEmpty('chart-regions', data.length === 0);
    const byRegion = {};
    data.forEach(d => {
      const r = d.region || 'Inconnue';
      byRegion[r] = (byRegion[r] || 0) + (d.puissance_mw || 0);
    });
    const sorted = Object.entries(byRegion).sort((a, b) => b[1] - a[1]);
    chartRegions.data.labels = sorted.map(([k]) => k);
    chartRegions.data.datasets = [{
      data: sorted.map(([, v]) => Math.round(v)),
      backgroundColor: sorted.map(([k]) => (PARAMS.regions_prioritaires.includes(k) ? PALETTE.teal : PALETTE.steel)),
      borderRadius: 2,
      maxBarThickness: 18,
    }];
    chartRegions.update('none');
  }

  /* ---- Unités par tranche de puissance × statut ---- */
  function updateTranches(data) {
    setEmpty('chart-tranches', data.length === 0);
    const tr = CONFIG.tranches();
    const labels = tr.map(t => t.label);
    const labelOf = (d) => { const t = tr.find(x => x.key === d.trancheKey); return t ? t.label : 'Hors tranches'; };
    if (data.some(d => !d.trancheKey)) labels.push('Hors tranches');
    chartTranches.data.labels = labels;
    chartTranches.data.datasets = statutDatasets(data, labels, labelOf, () => 1, 40);
    chartTranches.update('none');
  }

  /* ---- Unités par usage probable × statut ---- */
  function updateUsages(data) {
    setEmpty('chart-usages', data.length === 0);
    const counts = {};
    data.forEach(d => { counts[d.usage_probable] = (counts[d.usage_probable] || 0) + 1; });
    const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    chartUsages.data.labels = labels;
    chartUsages.data.datasets = statutDatasets(data, labels, d => d.usage_probable, () => 1, 18);
    chartUsages.update('none');
  }

  function resize() {
    [chartCohorte, chartRegions, chartTranches, chartUsages].forEach(c => c && c.resize());
  }

  return { init, update, resize };
})();
