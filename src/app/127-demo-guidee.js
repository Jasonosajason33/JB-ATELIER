  /* ====================== V26.111 : démo guidée (bouton « Démo ») ======================
   * Parcours de 2 minutes dans l'ordre logique d'une journée : chaque étape ouvre la bonne page,
   * zoome sur l'endroit utile (projecteur) et l'explique en une ou deux phrases.
   * Flèche → / Entrée / clic : étape suivante · Flèche ← : précédente · Échap : quitter. Rien n'est modifié. */
  /* V26.112 : une démo par rôle, choisie selon le compte connecté (manager / RC / collaborateur ou apprenti) */
  const END = { center: true, t: 'À toi de jouer', b: 'Tu peux relancer cette démo à tout moment avec le bouton « Démo » en haut à droite.', hint: 'Entrée pour terminer' };
  const TOURS = {
    collab: { label: 'Démo collaborateur', steps: [
      { center: true, t: 'Bienvenue dans JB Flow', b: 'En 2 minutes : organiser ta production, suivre les pièces de tes clients et tenir les échéances TVA.', hint: 'Flèche → ou clic pour avancer' },
      { r: 'today', sel: '.side', t: 'Le menu', b: 'Tes pages, dans l\'ordre de ta journée : Aujourd\'hui, Planning, Réceptions, TVA & autres impôts, Dashboard Clients et Dossiers.' },
      { r: 'today', sel: '.hello', t: 'Ta journée', b: 'Chaque matin, commence ici : ce qui est prévu aujourd\'hui et ton avancement du mois.' },
      { r: 'today', sel: '.unpl-wrap', opt: true, t: 'Tes alertes du mois', b: 'Vert : tout est planifié. Rouge : des dossiers n\'ont pas de place avant l\'échéance.', click: '.unpl-wrap .btn' },
      { r: 'today', sel: '.kpis-today', opt: true, t: 'Ta journée en un coup d\'œil', b: 'Niveau d\'activité, tâches qui restent, pièces attendues et alertes. Au-dessus, le compte à rebours avant la date limite de la TVA.' },
      { r: 'today', sel: '.rec-home-f, .card:has(.up-row.cli)', opt: true, t: 'Tes clients à relancer', b: 'Pièces en retard : l\'enveloppe prépare le mail de relance, le téléphone note un appel. Coche les dossiers arrivés puis « Valider ».', click: '.rec-home-f .rl-btn, .up-row.cli .btn' },
      { r: 'planning', sel: '.pc-board, .week, .month', t: 'Ton planning', b: 'Ta journée heure par heure (ou ta semaine avec « Semaine »). Glisse une tâche pour la déplacer si nécessaire.' },
      { r: 'planning', sel: '.pc-kpis', t: 'L\'essentiel en 4 chiffres', b: 'À traiter aujourd\'hui, en retard, à recevoir, terminé : un clic affiche la liste.', click: '.pc-kpis .pc-kpi' },
      { r: 'planning', sel: '.pc-blk, .pc-card, #view .task', opt: true, t: 'Terminer une tâche', b: 'Ouvre-la puis « Terminer » : indique le temps réellement passé, l\'outil apprend tes vrais temps.', click: '.pc-blk, .pc-card, #view .task' },
      { r: 'receptions', sel: '.rec-list, #view .card:has(.rec)', t: 'Les pièces reçues', b: 'Coche les dossiers dont les pièces sont arrivées puis « Valider » : ton planning se recalcule automatiquement.', click: '.rec input[type=checkbox]' },
      { r: 'tva', sel: '.tva-nav', t: 'Tes déclarations', b: 'Ce qui est à déposer, déposé ou en retard : coche le dépôt une fois fait. Les acomptes d\'IS se gèrent aussi sur cette page.', click: '.tva-recap-btn' },
      { r: 'dashboards', sel: '#view table, #view .card', opt: true, t: 'Le suivi des Dashboard Clients', b: 'Chaque tableau de bord client : à faire, fait ou publié, avec la date à laquelle il doit être publié.', click: '[data-act="done"], [data-act="dash-pub"]' },
      { r: 'clients', sel: '#results, #view .card', t: 'Tes dossiers', b: 'Une ligne par client. Clique sur un dossier pour ouvrir sa fiche.', click: 'tr[data-act="client"]' },
      { r: 'clients', open: 'tr[data-act="client"]', sel: '.sheet.sheet-client', opt: true, dock: true, t: 'La fiche du dossier', b: 'Tous les paramètres du dossier en un coup d\'œil : temps, réception, TVA, options. Ceux que tu peux modifier sont actifs, les autres grisés.' },
      END ] },    rc: { label: 'Démo RC', steps: [
      { center: true, t: 'Bienvenue dans JB Flow', b: 'En 2 minutes : ta production, celle de tes collaborateurs, et comment répartir le travail entre vous.', hint: 'Flèche → ou clic pour avancer' },
      { r: 'today', sel: '.hello', t: 'Ta journée', b: 'Ce qui est prévu aujourd\'hui et ton avancement du mois.' },
      { r: 'today', sel: '.chips:has([data-act="collab"])', opt: true, t: 'Tes collaborateurs', b: 'Un onglet par collaborateur rattaché : un clic affiche sa journée et ses alertes.', click: '.chips [data-act="collab"]:not(.on)' },
      { r: 'today', sel: '.unpl-wrap', opt: true, t: 'Les alertes du mois', b: 'Rouge : des dossiers sans place avant l\'échéance. « Voir » ouvre la liste.', click: '.unpl-wrap .btn' },
      { r: 'today', sel: '.kpis-today', opt: true, t: 'La journée en un coup d\'œil', b: 'Niveau d\'activité, tâches qui restent, pièces attendues et alertes, pour toi ou le collaborateur choisi au-dessus.' },
      { r: 'planning', sel: '.pc-board', t: 'Plannings côte à côte', b: 'Ton planning, puis celui de tes collaborateurs juste en dessous, heure par heure.' },
      { r: 'planning', sel: '.pc-board', t: 'Répartir le travail', b: 'Glisse une tâche sur la ligne d\'une autre personne pour la lui confier, ou la reprendre.' },
      { r: 'planning', sel: '.pc-kpis', t: 'L\'essentiel en 4 chiffres', b: 'À traiter aujourd\'hui, en retard, à recevoir, terminé : un clic affiche la liste. Les tâches à affecter se glissent sur la ligne d\'une personne.', click: '.pc-kpis .pc-kpi' },
      { r: 'receptions', sel: '.rec-list, #view .card:has(.rec)', t: 'Les pièces reçues', b: 'Coche les dossiers arrivés puis « Valider » : les plannings se recalculent seuls.', click: '.rec input[type=checkbox]' },
      { r: 'tva', sel: '.tva-nav', t: 'Les déclarations', b: 'Ce qui est à déposer ou en retard, et le Récap TVA du mois. Les acomptes d\'IS se gèrent aussi sur cette page.', click: '.tva-recap-btn' },
      { r: 'dashboards', sel: '#view table, #view .card', t: 'Le suivi des Dashboard Clients', b: 'Chaque tableau de bord client de ton équipe : à faire, fait ou publié, avec la date à laquelle il doit être publié.', click: '[data-act="done"], [data-act="dash-pub"]' },
      { r: 'clients', sel: '#results, #view .card', t: 'Les dossiers', b: 'Les dossiers de ton équipe : la fiche règle le temps, l\'échéance et les options.', click: 'tr[data-act="client"]' },
      END ] },
    manager: { label: 'Démo manager', steps: [
      { center: true, t: 'Bienvenue dans JB Flow', b: 'Une visite du menu, onglet par onglet : piloter l\'équipe, anticiper les surcharges, tenir les échéances.', hint: 'Flèche → ou clic pour avancer' },
      { r: 'dashboard', sel: '.side', t: 'Le menu', b: 'Pilotage (vue d\'ensemble, équipe, prévisions, dossiers), Suivi (indicateurs), puis la Production et les Paramètres.' },
      // Pilotage
      { r: 'dashboard', sel: '.pilot-tabs, .page-h', opt: true, t: 'Vue d\'ensemble', b: 'Ta page d\'accueil : l\'état de la production de toute l\'équipe, en un écran.' },
      { r: 'dashboard', sel: '.ms-pill', opt: true, t: 'À retenir : les échéances', b: 'Vert : l\'équipe tiendra les échéances. Rouge : clique pour voir quels dossiers et pourquoi.', click: '.ms-pill' },
      { r: 'dashboard', sel: '.synth', opt: true, t: 'À retenir : la synthèse', b: 'L\'essentiel de la semaine en cinq lignes, à copier pour ta réunion d\'équipe.', click: '[data-act="synth-copy"]' },
      { r: 'dashboard', sel: '.risk-list', opt: true, t: 'À retenir : les dossiers à risque', b: 'Du plus urgent au moins urgent, avec la raison. Un clic ouvre le dossier.', click: '.risk-row' },
      { r: 'activite', sel: '#view .card', t: 'Équipe & activité', b: 'La charge de chaque collaborateur jour par jour : repère d\'un coup d\'œil qui est surchargé (rouge) et qui a de la marge.' },
      { r: 'previsions', sel: '#cap-risk + .card, #view .card', t: 'Prévisions & agent', b: 'L\'agent prévoit les surcharges des 3 prochains mois et propose à qui confier un dossier. Rien ne change sans ta double confirmation.', click: '.rb-cta .btn' },
      { r: 'clients', sel: '#view .row:has([data-act="import"]), #results', t: 'Dossiers', b: 'Tous les dossiers du cabinet : crée-en un, importe ton fichier Excel, ou ouvre une fiche pour régler collaborateur, temps et options.', click: '[data-act="client-new"], [data-act="import"]' },
      // Suivi
      { r: 'kpi', sel: '.kpi, #view .card', t: 'Indicateurs', b: 'Délais de réception, temps réels contre temps prévus, respect des échéances : les chiffres pour ajuster l\'organisation.' },
      // Production
      { r: 'planning', sel: '.pc-board', opt: true, t: 'Planning de l\'équipe', b: 'Toute l\'équipe sur un écran, heure par heure : qui fait quoi, combien de travail chacun a. Glisse une tâche pour la confier à un autre.' },
      { r: 'planning', sel: '[data-act="replan"]', opt: true, t: 'À retenir : optimiser le planning', b: 'Après une absence ou un gros retard de pièces : l\'outil propose des déplacements, rien ne bouge sans ta validation.', click: '[data-act="replan"]' },
      { r: 'receptions', sel: '.rec-list, #view .card:has(.rec)', opt: true, t: 'Réceptions', b: 'Les pièces attendues de tous les clients : coche celles arrivées, les plannings se recalculent seuls.', click: '.rec input[type=checkbox]' },
      { r: 'tva', sel: '.tva-nav', t: 'TVA & autres impôts', b: 'Les dépôts de toute l\'équipe, les retards et le Récap TVA du mois. Les acomptes d\'IS se gèrent aussi sur cette page.', click: '.tva-recap-btn' },
      { r: 'dashboards', sel: '#view table, #view .card', opt: true, t: 'Dashboard Clients', b: 'Chaque tableau de bord client : à faire, fait ou publié, avec sa date limite de publication.' },
      { r: 'team', sel: '#view .card', opt: false, t: 'Équipe', b: 'L\'activité de chacun jour par jour : vert disponible, orange proche de la saturation, rouge surchargé. Clique une case pour ouvrir le planning du jour.', click: 'td[data-act], .cell[data-act], [data-act="team-day"]' },
      // Réglages
      { r: 'settings', sel: '#view .card', t: 'Paramètres', b: 'Apparence, règles de planification et sécurité de l\'outil.' },
      END ] }
  };
  function tourRole() {
    if (isManager()) return 'manager';
    const me = collabOf(S.me && S.me.collaborator_id);
    return me && me.kind === 'rc' ? 'rc' : 'collab';
  }  const TR = { on: false, i: 0, steps: [], el: null, raf: 0, target: null, back: null };
  function tourSteps() { TR.role = tourRole(); return TOURS[TR.role].steps.filter(s => !s.admin || isAdmin()); }
  function startTour() {
    if (TR.on) return;
    if (S.sheet) closeSheet(true);
    TR.on = true; TR.i = 0; TR.steps = tourSteps(); TR.back = location.hash;
    const el = TR.el = document.createElement('div'); el.id = 'tour'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Démo guidée');
    el.innerHTML = '<div class="tour-veil"></div><div class="tour-spot"><i class="tour-ring"></i></div><div class="tour-tgt" aria-hidden="true"><span>Clique ici</span></div>'
      + '<div class="tour-card" tabindex="-1"><div class="tour-top"><span class="tour-n"></span><button class="tour-x" aria-label="Quitter la démo">✕</button></div><h3 class="tour-t"></h3><p class="tour-b"></p>'
      + '<div class="tour-bar"><i></i></div><div class="tour-nav"><button class="btn sm tour-prev" aria-label="Étape précédente">←</button><span class="tour-hint"></span><button class="btn sm primary tour-next">Suivant →</button></div></div>';
    document.body.appendChild(el); document.body.classList.add('touring');
    DemoCursor.destroy(); DemoCursor.mount(el); // V26.176 : curseur de démonstration réutilisable (021-mouvement.js), en plus du vrai curseur
    el.querySelector('.tour-x').onclick = endTour;
    el.querySelector('.tour-prev').onclick = e => { e.stopPropagation(); tourGo(TR.i - 1); };
    el.querySelector('.tour-next').onclick = e => { e.stopPropagation(); tourGo(TR.i + 1); };
    el.querySelector('.tour-veil').onclick = () => tourGo(TR.i + 1);
    el.querySelector('.tour-spot').onclick = () => tourGo(TR.i + 1);
    document.addEventListener('keydown', tourKey, true);
    addEventListener('resize', tourPlace); addEventListener('scroll', tourPlace, true);
    requestAnimationFrame(() => el.classList.add('in'));
    tourGo(0);
    try { hist('demo', { detail: { text: 'Démo guidée lancée' } }); } catch (e) { }
  }
  function tourKey(e) {
    if (!TR.on) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); tourGo(TR.i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); tourGo(TR.i - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTour(); }
  }
  function endTour() {
    if (!TR.on) return; TR.on = false;
    document.removeEventListener('keydown', tourKey, true); removeEventListener('resize', tourPlace); removeEventListener('scroll', tourPlace, true);
    DemoCursor.hint(false);
    const el = TR.el; if (el) { el.classList.remove('in'); el.classList.add('out'); setTimeout(() => { el.remove(); if (!TR.on) DemoCursor.destroy(); }, FX.MEDIUM); }
    document.body.classList.remove('touring'); TR.el = null; TR.target = null; if (S.sheet) closeSheet(true);
    try { lsSet('planif-tour-seen', '1'); } catch (e) { }
  }
  const tourSleep = ms => new Promise(r => setTimeout(r, ms));
  const tourVis = el => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; };
  async function tourGo(i) {
    if (!TR.on) return;
    // une étape à la fois : un clic pendant le chargement d'une page est mis en attente, jamais perdu ni sauté
    if (TR.busy) { TR.queued = i; return; }
    TR.busy = true;
    try { await tourStep(i); } finally { TR.busy = false; }
    if (TR.queued !== undefined && TR.on) { const q = TR.queued; TR.queued = undefined; tourGo(q > TR.i ? TR.i + 1 : q < TR.i ? TR.i - 1 : q); }
  }
  async function tourStep(i) {
    if (i >= TR.steps.length) return endTour();
    if (i < 0) i = 0;
    const dir = i >= TR.i ? 1 : -1; TR.i = i;
    const s = TR.steps[i], el = TR.el; if (!el) return;
    const card = el.querySelector('.tour-card');
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // 1. La carte disparaît d'abord (fondu court), puis on change de page
    card.classList.add('swap'); DemoCursor.hint(false); el.querySelector('.tour-tgt').classList.remove('on'); TR.cur = null;
    await tourSleep(FX.FAST);
    if (S.sheet && !s.open) { closeSheet(true); await tourSleep(FX.MEDIUM); }
    if (s.r && S.route !== s.r) { go(s.r); await frame(); tourTop(); await frame(); await tourSleep(120); } // nouvelle page : on repart du haut (sinon le défilement de la page précédente est conservé)
    // fiche : le curseur de démonstration va jusqu'à la ligne, marque une pause, clique, puis la fiche s'ouvre (attendre la fin de son ouverture)
    if (s.open && !(S.sheet && S.sheet.type === 'client')) { const o = [...document.querySelectorAll(s.open)].find(tourVis); if (o) { await DemoCursor.tap(o, () => o.click()); DemoCursor.hide(); await frame(); await tourSleep(FX.SLOW); } }
    if (!TR.on || TR.el !== el) return;
    // 2. Cible de l'étape
    let target = null;
    if (s.sel) for (let k = 0; k < (s.opt ? 5 : 12) && !target; k++) { target = tourFind(s); if (!target) await tourSleep(60); }
    if (!TR.on || TR.el !== el) return;
    if (s.sel && !target && s.opt) return tourStep(i + dir); // élément absent (ex. aucune alerte ce mois-ci) : étape suivante
    TR.target = target; TR.step = s;
    if (target && !s.dock) { const r = target.getBoundingClientRect(); if (r.top < 70 || r.top > innerHeight - 160 || (r.bottom > innerHeight - 20 && r.height < innerHeight * .6)) { target.scrollIntoView({ block: r.height > innerHeight * .6 ? 'start' : 'center', behavior: 'smooth' }); await tourSleep(420); } }
    if (!TR.on || TR.el !== el) return;
    // 3. Texte, puis placement SANS glissement de la carte (elle est invisible), puis fondu d'apparition
    el.querySelector('.tour-n').textContent = TOURS[TR.role].label + ' · étape ' + (i + 1) + ' sur ' + TR.steps.length;
    el.querySelector('.tour-t').textContent = s.t;
    el.querySelector('.tour-b').textContent = s.b;
    el.querySelector('.tour-hint').textContent = s.hint || '← → pour naviguer';
    el.querySelector('.tour-bar i').style.width = ((i + 1) / TR.steps.length * 100) + '%';
    el.querySelector('.tour-prev').disabled = i === 0;
    el.querySelector('.tour-next').textContent = i === TR.steps.length - 1 ? 'Terminer ✓' : 'Suivant →';
    el.classList.toggle('centered', !target); el.classList.toggle('docked', !!s.dock);
    const spot = el.querySelector('.tour-spot'); spot.classList.remove('zoom'); void spot.offsetWidth; spot.classList.add('zoom');
    card.classList.add('jump'); tourPlaceNow(); void card.offsetWidth; card.classList.remove('jump');
    await frame();
    card.classList.remove('swap'); card.focus({ preventScroll: true });
    // Curseur de démonstration : il glisse jusqu'à l'endroit à cliquer, marque une courte pause, montre un clic discret, puis le rappelle de temps en temps
    if (TR.cur) DemoCursor.moveTo(TR.cur[0], TR.cur[1]).then(() => DemoCursor.pause()).then(() => { if (TR.on && TR.i === i && TR.cur) { DemoCursor.click(); DemoCursor.hint(true); } });
    // 4. Recalage : la page peut encore bouger (animations d'entrée, polices, images)
    [180, 450, 900].forEach(ms => setTimeout(() => { if (TR.on && TR.i === i) tourPlace(); }, ms));
  }
  function tourFind(s) { for (const q of s.sel.split(',')) { const e = [...document.querySelectorAll(q.trim())].find(tourVis); if (e) return e; } return null; } // sélecteurs essayés dans l'ordre de préférence
  function tourTop() { window.scrollTo(0, 0); document.querySelectorAll('main, .main, #view, .content').forEach(e => { if (e.scrollTop) e.scrollTop = 0; }); }
  function tourPlace() {
    if (!TR.on || !TR.el) return;
    cancelAnimationFrame(TR.raf);
    TR.raf = requestAnimationFrame(tourPlaceNow);
  }
  function tourPlaceNow() {
    if (!TR.on || !TR.el) return;
    const el = TR.el, s = TR.step || {}, spot = el.querySelector('.tour-spot'), card = el.querySelector('.tour-card'), tgt = el.querySelector('.tour-tgt');
    // La page a été redessinée (actualisation, notification…) : on retrouve l'élément au lieu de perdre le cadre
    if (TR.target && !document.body.contains(TR.target) && s.sel) TR.target = tourFind(s);
    const W = innerWidth, H = innerHeight, cw = s.dock ? Math.min(300, W - 32) : Math.min(360, W - 32);
    card.style.width = cw + 'px';
    if (!TR.target) {
      Object.assign(spot.style, { left: W / 2 + 'px', top: H / 2 + 'px', width: '0px', height: '0px' });
      card.style.left = (W - cw) / 2 + 'px'; card.style.top = Math.max(20, H / 2 - card.offsetHeight / 2) + 'px';
      TR.cur = null; DemoCursor.hide(); tgt.classList.remove('on'); return;
    }
    const r = TR.target.getBoundingClientRect(), pad = s.dock ? 2 : 8;
    const x = Math.max(6, r.left - pad), y = Math.max(6, r.top - pad), w = Math.min(W - 12, r.width + pad * 2), h = Math.min(H - 12, r.height + pad * 2);
    Object.assign(spot.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    const ch = card.offsetHeight || 190; let cx, cy;
    if (s.dock) { // fiche ouverte : carte compacte dans un coin, hors des paramètres autant que possible
      const right = W - (x + w), left = x;
      if (right >= cw + 24) { cx = x + w + 12; cy = H - ch - 16; } else if (left >= cw + 24) { cx = x - cw - 12; cy = H - ch - 16; } else { cx = W - cw - 16; cy = H - ch - 16; }
    }
    else if (y + h + ch + 18 < H) { cy = y + h + 14; cx = x + Math.min(w / 2, 180) - 40; }
    else if (y - ch - 14 > 0) { cy = y - ch - 14; cx = x + Math.min(w / 2, 180) - 40; }
    else if (x + w + cw + 18 < W) { cx = x + w + 14; cy = Math.min(H - ch - 16, Math.max(16, y)); }
    else { cx = Math.max(16, x - cw - 14); cy = Math.min(H - ch - 16, Math.max(16, y)); }
    card.style.left = Math.max(16, Math.min(W - cw - 16, cx)) + 'px'; card.style.top = Math.max(16, Math.min(H - ch - 16, cy)) + 'px';
    // Curseur de démonstration : montre où cliquer (V26.176 : il glisse jusqu'au nouvel endroit au lieu d'y sauter)
    const c = s.click ? [...TR.target.querySelectorAll(s.click)].concat(TR.target.matches(s.click) ? [TR.target] : []).find(tourVis) : null;
    if (c) {
      const b = c.getBoundingClientRect(), pt = [b.left + Math.min(b.width / 2, 60), b.top + b.height / 2], had = !!TR.cur;
      TR.cur = pt; if (had) DemoCursor.moveTo(pt[0], pt[1]); // première position : le glissement part une fois la carte affichée (tourStep)
      Object.assign(tgt.style, { left: (b.left - 6) + 'px', top: (b.top - 6) + 'px', width: (b.width + 12) + 'px', height: (b.height + 12) + 'px' }); tgt.classList.toggle('below', b.top < 60); tgt.classList.add('on');
    }
    else { TR.cur = null; DemoCursor.hide(); tgt.classList.remove('on'); }
  }  /* V26.125 : la démo ne se fait JAMAIS sur les vraies données du cabinet.
     Dans l'outil réel, « Démo » ouvre un bac à sable (demo.html) : dossiers et collaborateurs fictifs, stockés dans le navigateur, sans Supabase.
     Collaborateur → démo collaborateur, RC → démo RC, manager et administrateur → démo manager. */
  function sandboxUrl() {
    const role = isManager() ? 'manager' : ((collabOf(S.me && S.me.collaborator_id) || {}).kind === 'rc' ? 'rc' : 'collab');
    return 'demo.html?role=' + role;
  }
  async function offerDemo(first) {
    if (S.store && S.store.mode === 'demo') return startTour(); // déjà dans le bac à sable
    const ok = await confirmBox(first ? 'Bienvenue dans JB Flow' : 'Démo de JB Flow',
      '<p>Découvre l\'outil en 2 minutes dans un <b>bac à sable</b> : des dossiers et des collaborateurs <b>fictifs</b>, dans un nouvel onglet.</p><p>Tes vraies données ne sont ni affichées ni modifiées.</p>'
      + (first ? '<p class="small muted">Tu pourras relancer la démo à tout moment avec le bouton « Démo » en haut de l\'écran.</p>' : ''),
      'Lancer la démo');
    if (ok) window.open(sandboxUrl(), '_blank', 'noopener');
  }
  // Première connexion : proposition de la démo (après le choix de l'ambiance), une seule fois par utilisateur et par appareil
  function firstDemoOffer() {
    if (!S.me || (S.store && S.store.mode === 'demo')) return;
    const k = 'jbflow-demo-offered:' + String(S.me.email || '').toLowerCase();
    if (lsGet(k)) return;
    let n = 0;
    const tick = () => { if (!S.me) return; if (document.querySelector('.overlay, .tp-card, #tour') && n++ < 90) return setTimeout(tick, 1000); lsSet(k, '1'); offerDemo(true); };
    setTimeout(tick, 2500);
  }
  window.JBFlowTour = startTour; // démo publiée : lancement automatique à la première visite
