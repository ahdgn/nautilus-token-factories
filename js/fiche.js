/* ============================================
   Fiche — panneau latéral « Fiche du site »
   Lecture seule : tous les champs du registre,
   liens ODRÉ et Google Maps (centroïde de commune).
   La qualification (registre équipe) arrive à
   l'étape 8 du backlog et prendra place ici.
   ============================================ */

const Fiche = (() => {
  let drawer, body, current = null;

  function init() {
    drawer = document.getElementById('fiche-drawer');
    body = document.getElementById('fiche-body');
    document.getElementById('fiche-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !drawer.hidden) close();
    });
  }

  function open(d) {
    current = d;
    document.getElementById('fiche-title').textContent = 'Fiche du site';
    body.innerHTML = MapView.detailHtml(d);
    body.scrollTop = 0;
    const wasHidden = drawer.hidden;
    drawer.hidden = false;
    document.body.classList.add('fiche-open');
    if (wasHidden) setTimeout(() => { MapView.invalidateSize(); Charts.resize(); }, 220);
  }

  function close() {
    drawer.hidden = true;
    document.body.classList.remove('fiche-open');
    current = null;
    setTimeout(() => { MapView.invalidateSize(); Charts.resize(); }, 220);
  }

  function getCurrent() { return current; }

  return { init, open, close, getCurrent };
})();
