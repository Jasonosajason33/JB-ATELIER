  /* ====================== Rendu ====================== */
  /* Icônes (trait fin, 24×24) */
  const ICONS = {
    home: '<path d="M3.5 10.5 12 3.5l8.5 7V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-6v6H5A1.5 1.5 0 0 1 3.5 19z"/>',
    file: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    inbox: '<path d="M3.5 13.5h4.5l1.5 2.5h5l1.5-2.5h4.5"/><path d="M6 5h12l2.5 8.5V18a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18v-4.5z"/>',
    users: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.7-3.3 3.1-5.2 6-5.2s5.3 1.9 6 5.2"/><circle cx="17" cy="9.5" r="2.6"/><path d="M16.3 14.4c2.5.2 4.2 1.8 4.7 4.6"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    chart: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M8.5 16v-4M12 16V8M15.5 16v-6"/>',
    bars: '<path d="M6 19v-7M12 19V5M18 19v-4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M4.5 16.5v1.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1.5"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    chevR: '<path d="m9.5 6 6 6-6 6"/>', chevL: '<path d="m14.5 6-6 6 6 6"/>', chevD: '<path d="m6 9.5 6 6 6-6"/>',
    arrowUR: '<path d="M7.5 16.5 16.5 7.5M9 7.5h7.5V15"/>',
    sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v1.9M12 19.3v1.9M4.9 4.9l1.3 1.3M17.8 17.8l1.3 1.3M2.8 12h1.9M19.3 12h1.9M4.9 19.1l1.3-1.3M17.8 6.2l1.3-1.3"/>',
    moon: '<path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z"/>',
    logout: '<path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
    refresh: '<path d="M19.5 11.5A7.5 7.5 0 1 0 17.3 17M19.5 5.5v6h-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    alert: '<path d="M12 4 3 19.5h18z"/><path d="M12 10v4.2M12 17h.01"/>',
    sparkle: '<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9z"/>',
    panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="4"/><path d="M9.5 4.5v15"/>',
    pin: '<path d="M9 3.5h6l-.8 5.5 3.3 3.2h-11L9.8 9z"/><path d="M12 12.2v8.3"/>',
    merge: '<path d="M6 4v5a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v5M18 4v5a3 3 0 0 1-3 3"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="3"/><path d="m4.5 7 7.5 6 7.5-6"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.6 5.2 3.4-5.2 3.4z" fill="currentColor"/>',
    phone: '<path d="M6.6 3.5h2.6l1.4 4.1-2 1.4a12 12 0 0 0 6.4 6.4l1.4-2 4.1 1.4v2.6a2.1 2.1 0 0 1-2.3 2.1A16.6 16.6 0 0 1 4.5 5.8a2.1 2.1 0 0 1 2.1-2.3z"/>',
    menu: '<path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15"/>',
    x: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
    gauge: '<path d="M4.2 16.5a8.5 8.5 0 1 1 15.6 0"/><path d="m12 13 3.5-4"/><circle cx="12" cy="13.3" r="1.2"/>',
    flame: '<path d="M12 21c3.6 0 6-2.4 6-5.8 0-3.6-2.8-5.6-3.6-9.2-2 1.4-3.2 3.3-3.4 5.6-.9-.7-1.5-1.8-1.6-3.1C7.6 10.2 6 12.4 6 15.2 6 18.6 8.4 21 12 21z"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
    flag: '<path d="M5.5 20.5v-16M5.5 4.5h11l-2 4 2 4h-11"/>',
    route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
    review: '<path d="M9 5.5H7.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-11a2 2 0 0 0-2-2H15"/><rect x="9" y="3.5" width="6" height="3.5" rx="1.2"/><path d="m9 13.5 2 2 4-4.2"/>',
    filter: '<path d="M4 5.5h16l-6.2 7.3v5.4l-3.6 1.8v-7.2z"/>'
  };
  function ic(n, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>'; }
  const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const reducedMotion = () => { const m = document.documentElement.dataset.motion; return m === 'reduced' || (m !== 'always' && !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)); };
  const LV_LABEL = { green: 'Activité normale', orange: 'Presque atteinte', red: 'Surcharge', off: 'Non travaillé' };
  // V26.173 : RC, collaborateur et apprenti — jamais les mots « surcharge » ou « charge » (le manager garde son vocabulaire)
  const lvLabel = lv => (isManager() ? LV_LABEL : Object.assign({}, LV_LABEL, { red: 'Très remplie' }))[lv];
  const softText = s => isManager() ? String(s || '') : String(s || '').replace(/ — surcharge le /g, ' — journée trop remplie le ').replace(/surcharg\w*/gi, 'dépassement de capacité');
  const LV_BADGE = { green: 'g', orange: 'o', red: 'r', off: '' };
  /* V26.185 : en dessous de 108 % de remplissage, aucune alerte ni phrase d'avertissement — la journée est considérée comme normale
     (les couleurs des jauges restent inchangées). Un seul seuil, utilisé partout. */
  const ALERT_PCT = 108;
  const overAlert = (total, cap) => (cap > 0 ? total / cap * 100 >= ALERT_PCT : total > 0);
  const msgLv = (lv, total, cap) => ((lv === 'orange' || lv === 'red') && !overAlert(total, cap) ? 'green' : lv);
  // alertes du moteur, sans « capacité presque atteinte » ni « surcharge » en dessous du seuil
  const alertsOf = (...a) => E.alerts(...a).filter(x => x.type !== 'near' && !(x.type === 'overload' && x.pct !== undefined && x.pct < ALERT_PCT));

  let renderTimer = 0;
  function scheduleRender() { if (renderTimer) return; renderTimer = setTimeout(() => { renderTimer = 0; render(); }, 16); }
  function typing() {
    const a = document.activeElement;
    return a && ((a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'file', 'color'].includes(a.type)) || a.tagName === 'TEXTAREA') && a.closest('#app,#sheet-root');
  }
  /* Le squelette (menu, en-tête, barre d'onglets) est créé une fois ; seules ses parties sont mises à jour,
   * ce qui permet les transitions (indicateur d'onglet qui glisse, tiroir, repli du menu). */
  function buildShell() {
    $('#app').innerHTML = '<div id="banner"></div><div class="shell" id="shell"><aside class="side" id="side" aria-label="Menu principal"></aside><div class="side-backdrop" id="side-backdrop" data-act="drawer-close"></div>'
      + '<div class="main"><header class="top" id="topbar"></header><main class="content" id="view"></main>' + legalHtml() + '</div></div>'
      + '<nav class="bottom-nav" id="bnav" aria-label="Navigation"><span class="ind"></span>'
      + bottomItems().map((n, i) => n[0] === 'more' ? '<button type="button" data-act="drawer" data-i="' + i + '">' + ic(n[1]) + '<span>' + n[2] + '</span></button>' : '<a href="#/' + n[0] + '" data-i="' + i + '">' + ic(n[1]) + '<span>' + n[2] + '</span></a>').join('') + '</nav>';
  }
  function render() { S._pIdx = null; S._closed = null; // V26.67 : index reconstruit une fois par affichage (V26.163 : dossiers clôturés aussi)
    if (!S.ready) return;
    if (typing()) { S.dirty = true; return; }
    S.dirty = false;
    if (!$('#shell')) buildShell();
    $('#shell').classList.toggle('pinned', !!S.navPinned);
    $('#banner').innerHTML = viewAsBanner() + bannerHtml();
    const side = $('#side'), sideScroll = side.scrollTop;
    side.innerHTML = sideHtml(); side.scrollTop = sideScroll;
    side.classList.toggle('open', !!S.drawer); $('#side-backdrop').classList.toggle('open', !!S.drawer);
    $('#topbar').innerHTML = topHtml();
    const view = $('#view'), keep = {}, y = window.scrollY;
    view.querySelectorAll('[data-keep]').forEach(el => (keep[el.dataset.keep] = el.scrollLeft));
    // V26.176 : système de mouvement commun (021-mouvement.js), pour tous les thèmes —
    // arrivée sur un écran : cascade d'entrée ; changement d'onglet : fondu + 4 px du contenu ; sinon seules les données qui changent bougent
    const now = performance.now(), tabFx = !S.enter && S.tabFx && now - S.tabFx < 400 && fxOn();
    const live = !S.enter && !tabFx && S.fxAt && now - S.fxAt < 520 && (view.classList.contains('enter') || view.classList.contains('tab-in')); // animation d'écran en cours : on la poursuit
    const snap = S.enter || tabFx || live ? null : fxSnapshot(view);
    if (!S.enter && !live) view.classList.remove('enter', 'tab-in');
    view.innerHTML = viewHtml();
    view.querySelectorAll('[data-keep]').forEach(el => { if (keep[el.dataset.keep] !== undefined) el.scrollLeft = keep[el.dataset.keep]; });
    if (S.enter) {
      S.enter = false; S.fxAt = now; view.style.setProperty('--fx-el', '0ms'); view.classList.remove('tab-in'); view.classList.add('enter');
      shownCounts.clear(); // à chaque arrivée sur un écran, les chiffres repartent de 0
      clearTimeout(S.enterT); S.enterT = setTimeout(() => view.classList.remove('enter'), 700);
      const tcol = view.querySelector('.week .day-col.today');
      if (tcol && tcol.parentElement.scrollWidth > tcol.parentElement.clientWidth + 4) tcol.parentElement.scrollLeft = tcol.offsetLeft - 16;
    } else if (tabFx) {
      // changement d'onglet : les commandes restent en place, le nouveau contenu apparaît en fondu léger
      S.fxAt = now; view.style.setProperty('--fx-el', '0ms'); view.classList.remove('enter'); view.classList.add('tab-in');
      clearTimeout(S.tabT); S.tabT = setTimeout(() => view.classList.remove('tab-in'), 520);
    } else if (live) view.style.setProperty('--fx-el', Math.round(now - S.fxAt) + 'ms');
    S.tabFx = 0;
    updateBottomNav();
    renderStatus();
    renderSheet();
    animateCounts(view);
    typeQuote();
    view.querySelectorAll('.carousel').forEach(syncDots);
    window.scrollTo(0, y);
    fxApply(view, snap);
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (S.dirty && !typing()) render(); }, 0));
  function bannerHtml() {
    return (S.store.mode === 'demo' ? '<div class="banner demo">Mode démo — données stockées uniquement dans ce navigateur (essai). Configurez Supabase pour l\'utilisation partagée.</div>' : '')
      + (S.limitMsg ? '<div class="banner bad">' + esc(S.limitMsg) + '</div>' : '')
      + (S.readonly ? '<div class="banner bad">Base de données inaccessible : dernière copie locale (' + esc(S.cacheAt ? fDateTime(S.cacheAt) : '') + '), en lecture seule. <a href="#" data-act="reload">Réessayer</a></div>' : '');
  }
  function renderStatus() {
    const el = $('#status'); if (!el) return;
    const sync = S.readonly ? '<span class="pill" title="Lecture seule"><i class="dot r"></i><span class="txt">Lecture seule</span></span>'
      : S.offline ? '<span class="pill" title="Hors ligne"><i class="dot r"></i><span class="txt">Hors ligne</span></span>'
        : S.sync === 'live' ? '<span class="pill" title="Les modifications des autres utilisateurs apparaissent automatiquement."><i class="dot g"></i><span class="txt">Temps réel</span></span>'
          : S.sync === 'poll' ? '<span class="pill" title="Actualisation automatique toutes les 30 s"><i class="dot o"></i><span class="txt">Auto · 30 s</span></span>' : '<span class="pill"><i class="dot"></i><span class="txt">Connexion…</span></span>';
    const save = S.failed.length ? '<span class="pill err" data-act="retry">' + ic('alert', 'sm') + S.failed.length + ' non enregistrée(s) · Réessayer</span>'
      : S.pending ? '<span class="pill"><span class="spin"></span><span class="txt">Enregistrement…</span></span>' : '<span class="pill d-only">' + ic('check', 'sm') + 'Enregistré</span>';
    el.innerHTML = '<button class="btn sm demo-btn" data-act="tour" title="Démo guidée : 2 minutes pour découvrir l\'outil" aria-label="Lancer la démo guidée">' + ic('play', 'sm') + '<span>Démo</span></button>' + sync + save + '<button class="btn icon sm d-only" data-act="refresh" title="Actualiser les données" aria-label="Actualiser">' + ic('refresh', 'sm') + '</button>';
  }

  const NAV_PILOT = ['Pilotage', [['dashboard', 'chart', 'Vue d\'ensemble'], ['activite', 'users', 'Équipe & activité'], ['previsions', 'sparkle', 'Prévisions & agent'], ['clients', 'folder', 'Dossiers']]];
  const NAV_SUIVI = ['Suivi', [['kpi', 'bars', 'Indicateurs'], ['history', 'clock', 'Historique'], ['export', 'download', 'Export & sauvegarde']]]; // V26.62
  const NAV = [
    ['Production', [['today', 'home', "Aujourd'hui"], ['planning', 'calendar', 'Planning'], ['receptions', 'inbox', 'Réceptions'], ['tva', 'file', 'TVA & autres impôts'], ['dashboards', 'gauge', 'Dashboard Clients'], ['team', 'users', 'Équipe']]],
    ['Recherche', [['search', 'search', 'Recherche']], false, true], // accessible par le bouton de recherche en haut du menu
    NAV_PILOT,
    NAV_SUIVI,
    ['Réglages', [['settings', 'sliders', 'Paramètres']]]
  ];
  const NAV_FLAT = NAV.reduce((a, s) => a.concat(s[1].map(n => n.concat([!!s[2]]))), []);
  const MANAGER_ONLY = ['team', 'dashboard', 'export', 'kpi', 'activite', 'previsions'];
  const navAllowed = r => r === 'export' ? isAdmin() : isManager() || !MANAGER_ONLY.includes(r);
  // V26.92 : collaborateur / apprenti — « Dossiers » rangé dans Production (pas de rubrique Pilotage)
  const NAV_COLLAB = [[NAV[0][0], NAV[0][1].concat([['clients', 'folder', 'Dossiers']])]].concat(NAV.slice(1).filter(s => s !== NAV_PILOT));
  const navSections = () => (isManager() ? [NAV_PILOT, NAV_SUIVI].concat(NAV.filter(s => s !== NAV_PILOT && s !== NAV_SUIVI)) : NAV_COLLAB); // manager : Pilotage avant Production
  const BOTTOM_ADMIN = [['today', 'home', "Aujourd'hui"], ['planning', 'calendar', 'Planning'], ['receptions', 'inbox', 'Réceptions'], ['team', 'users', 'Équipe'], ['more', 'menu', 'Plus']];
  const BOTTOM_COLLAB = [['today', 'home', "Aujourd'hui"], ['planning', 'calendar', 'Planning'], ['receptions', 'inbox', 'Réceptions'], ['clients', 'folder', 'Dossiers'], ['more', 'menu', 'Plus']];
  const bottomItems = () => (isManager() ? BOTTOM_ADMIN : BOTTOM_COLLAB);
  const TITLES = { today: "Aujourd'hui", planning: 'Planning', receptions: 'Réceptions', tva: 'TVA & autres impôts', team: 'Équipe', clients: 'Dossiers', search: 'Recherche', dashboard: 'Pilotage', dashboards: 'Dashboard Clients', kpi: 'Indicateurs', activite: 'Équipe & activité', previsions: 'Prévisions & agent', history: 'Historique', export: 'Export & sauvegarde', settings: 'Paramètres', more: 'Menu' };
  function updateBottomNav() {
    const nav = $('#bnav'); if (!nav) return;
    let idx = bottomItems().findIndex(n => n[0] === S.route); if (idx < 0 || S.drawer) idx = 4;
    nav.querySelectorAll('[data-i]').forEach(el => el.classList.toggle('on', Number(el.dataset.i) === idx));
    nav.querySelector('.ind').style.transform = 'translateX(' + (idx * 100) + '%)';
  }
  function navCounts() {
    const td = today(), cid = S.me.collaborator_id || S.collabId;
    return {
      today: list('tasks').filter(t => E.onDay(t, td) && !t.done && (!cid || t.collaborator_id === cid)).length,
      receptions: list('productions').filter(p => awaitingRec(p) && p.expected_date <= td && p.month >= E.addMonths(td.slice(0, 7), -1)).length,
      dashboard: isManager() ? alertsOf(engineData(), td, { month: S.month }).filter(a => a.level === 'bad').length + helpOffers().length + unseenPostpones().length : 0 // V26.42 : alertes + propositions d'aide en attente (V26.167 : + reports au lendemain pas encore vus)
    };
  }
  function sideHtml() {
    const r = S.route, cnt = navCounts(), x = ctx(), td = today(), w = E.windowOf(S.month, x.settings);
    let daysLeft = 0;
    for (let d = td > w.start ? td : w.start; d <= w.end; d = E.addDays(d, 1)) if (collabs().some(c => E.capacityOn(c, d, x) > 0)) daysLeft++;
    const fill = isManager() ? E.dashboard(engineData(), S.month, td).load.fill : 0;
    const sections = navSections().filter(s => !s[3] && (!s[2] || isManager()) && s[1].some(n => navAllowed(n[0]))).map(s => '<div class="nav-label">' + (isManager() || s[0] !== 'Pilotage' ? s[0] : 'Dossiers') + '</div>' + s[1].filter(n => navAllowed(n[0])).map(n => {
      const c = cnt[n[0]];
      return '<a class="nav' + (r === n[0] ? ' on' : '') + '" href="#/' + n[0] + '" title="' + n[2] + '">' + ic(n[1]) + '<span class="lbl">' + n[2] + '</span>' + (c ? '<span class="count' + (n[0] === 'dashboard' ? ' hot' : '') + '">' + c + '</span>' : '') + '</a>';
    }).join('')).join('');
    return '<div class="side-head"><button class="logo logo-btn" data-act="me-card" title="Mon compte" aria-label="Mon compte et déconnexion"><img src="logo-192.png" alt=""></button><div class="brand-t lbl">' + esc(CFG.APP_NAME || 'JB Flow') + '</div>'
      + '<button class="side-btn collapse-btn' + (S.navPinned ? ' on' : '') + '" data-act="side-pin" title="' + (S.navPinned ? 'Détacher : le menu se replie automatiquement' : 'Épingler le menu ouvert') + '" aria-label="Épingler le menu" aria-pressed="' + !!S.navPinned + '">' + ic('pin', 'sm') + '</button>'
      + '<button class="side-btn m-only" data-act="drawer-close" aria-label="Fermer le menu">' + ic('x', 'sm') + '</button></div>'
      + '<button class="side-search" data-act="go-search" title="Rechercher (Ctrl+K)">' + ic('search', 'sm') + '<span class="lbl">Rechercher…</span><kbd class="lbl">⌘K</kbd></button>'
      + '<a class="side-rec" href="#/receptions" title="Déclarer une réception"><span class="ri">' + ic('inbox', 'sm') + (cnt.receptions ? '<i>' + cnt.receptions + '</i>' : '') + '</span><span class="rt lbl"><b>Déclarer une réception</b><span>' + (cnt.receptions ? cnt.receptions + ' à valider · ' : '') + daysLeft + ' j ouvré' + (daysLeft > 1 ? 's' : '') + ' restant' + (daysLeft > 1 ? 's' : '') + (isManager() ? ' · équipe ' + fill + ' %' : '') + '</span></span>' + ic('chevR', 'sm lbl') + '</a>'
      + sections.replace('<div class="nav-label">Réglages</div>', '<div class="nav-label">Révision</div><span class="nav soon" title="Révision — bientôt disponible" aria-disabled="true">' + ic('review') + '<span class="lbl">Révision</span><span class="soon-b lbl">Bientôt</span></span><div class="nav-label">Réglages</div>')
      + '<div class="usercard"><span class="avatar">' + esc(initials(S.me.name)) + '<i class="online"></i></span><div class="who lbl"><b>' + esc(S.me.name) + '</b><span>' + roleLabel(S.me) + '</span></div>'
      + '<button class="side-btn m-only" data-act="theme" data-t="' + nextTheme() + '" aria-label="Changer de thème">' + ic(THEME_ICON[nextTheme()], 'sm') + '</button>'
      + '<button class="side-btn lbl" data-act="logout" title="Se déconnecter" aria-label="Se déconnecter">' + ic('logout', 'sm') + '</button></div>';
  }
  function topHtml() {
    const r = S.route;
    // V26.176 : un sous-titre sur chaque onglet du Pilotage — l'en-tête garde la même hauteur, les onglets ne sautent plus
    const sub = { planning: 'Organisation des tâches', receptions: 'Déclarez les éléments reçus en un geste', tva: 'Déclarations TVA, DEB, DES et acomptes d\'IS de vos dossiers', team: 'Niveau d\'activité et disponibilités de l\'équipe', clients: list('clients').length + ' dossiers', search: 'Clients, collaborateurs, missions', dashboard: 'Pilotage ' + deMonth(S.month), activite: 'Pilotage ' + deMonth(S.month), previsions: 'Pilotage · 3 prochains mois', kpi: 'Pilotage · 4 dernières semaines', history: isManager() ? 'Toutes les modifications' : 'Mes dossiers', export: 'Vos données, dans vos fichiers', settings: 'Équipe, utilisateurs et règles de planification' }[r] || '';
    return '<div class="title"><h1>' + esc(TITLES[r] || '') + '</h1>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>'
      + (r === 'receptions' ? '<div class="top-month">' + monthNav() + '</div>' : '') // V26.213 : mois sur la ligne du titre
      + '<div class="top-actions"><div class="status" id="status"></div>'
      // V26.172 : icônes seules (le nom du thème s'affiche dans la bulle au survol)
      + '<div class="theme-switch top-themes d-only" role="group" aria-label="Thème">' + THEMES.map(t => '<button class="' + (S.theme === t[0] ? 'on' : '') + '" data-act="theme" data-t="' + t[0] + '" title="Thème ' + t[1] + '" aria-label="Thème ' + t[1] + '">' + ic(t[2], 'sm') + '</button>').join('') + '</div>'
      + '<button class="btn icon m-only-f" data-act="theme" data-t="' + nextTheme() + '" aria-label="Thème suivant : ' + THEMES.find(t => t[0] === nextTheme())[1] + '">' + ic(THEME_ICON[nextTheme()]) + '</button>'
      + '<button class="avatar top-av m-only-f" data-act="drawer" aria-label="Ouvrir le menu">' + esc(initials(S.me.name)) + '</button></div>';
  }
  // V26.62 : onglets en haut des pages du Pilotage (manager)
  const PILOT_TABS = [['dashboard', 'Vue d\'ensemble'], ['activite', 'Équipe & activité'], ['previsions', 'Prévisions & agent'], ['kpi', 'Indicateurs']];
  // V26.209 : le mois et les actions du mois (ex. « Replanifier le mois ») se placent sur la ligne des onglets
  const pilotTabs = right => { const tabs = isManager() ? '<div class="seg pilot-tabs" role="tablist">' + PILOT_TABS.map(t => '<button role="tab" class="' + (S.route === t[0] ? 'on' : '') + '" data-act="go-route" data-r="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' : ''; return right ? '<div class="pilot-bar">' + tabs + '<span class="spacer"></span><div class="pilot-right">' + right + '</div></div>' : tabs; };
  // V26.175 : 4e thème « Iris » — clair, aéré, accent pervenche, animations premium (fichier design-iris.css)
  ICONS.shield = '<path d="M12 3l7 3v5.5c0 4.4-3 8.1-7 9.5-4-1.4-7-5.1-7-9.5V6l7-3z"/><path d="M8.8 12.2l2.3 2.3 4.3-4.6"/>'; // V26.210 : TVA validée
  ICONS.drop = '<path d="M12 3.2c3.3 4.1 6 7.4 6 10.6a6 6 0 0 1-12 0c0-3.2 2.7-6.5 6-10.6z"/>';
  const THEMES = [['signature', 'Signature', 'sparkle'], ['clair', 'Clair', 'sun'], ['nuit', 'Aurora', 'moon'], ['iris', 'Iris', 'drop']];
  const THEME_ICON = { signature: 'sparkle', clair: 'sun', nuit: 'moon', iris: 'drop' };
  const nextTheme = () => THEMES[(THEMES.findIndex(t => t[0] === S.theme) + 1) % THEMES.length][0];
  function setTheme(t) {
    S.theme = ['clair', 'nuit', 'iris'].includes(t) ? t : 'signature';
    // V26.47 : le thème Nuit « Aurora » reprend la structure en verre de Signature, recolorée (data-variant) ;
    // V26.175 : « Iris » reprend la base du thème Clair (data-variant="iris"), sans menu sombre ni couleur d'accent au choix
    const root = document.documentElement;
    root.dataset.theme = S.theme === 'nuit' ? 'signature' : S.theme === 'iris' ? 'clair' : S.theme;
    if (S.theme === 'nuit') root.dataset.variant = 'aurora'; else if (S.theme === 'iris') root.dataset.variant = 'iris'; else delete root.dataset.variant;
    const sd = lsGet('planif-side'); if (S.theme === 'clair' && (sd === 'dark' || sd === 'color')) root.dataset.side = sd; else delete root.dataset.side;
    lsSet('planif-theme', S.theme);
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = { signature: '#ECEBE6', clair: '#F2F4F9', nuit: '#07060D', iris: '#EEF0F8' }[S.theme];
    render();
  }

  /* Micro-interactions : compteurs animés et points de pagination des carrousels */
  const shownCounts = new Map();
  function fmtVal(v, f) { if (f && f[0] === 'n') { const [d, suf, pre] = f.slice(1).split('|'); return (pre || '') + Number(v).toFixed(Number(d) || 0).replace('.', ',') + (suf || ''); } return f === 'min' ? E.fmtMin(Math.round(v)) : f === 'pct' ? Math.round(v) + ' %' : String(Math.round(v)); }
  function animateCounts(root) {
    root.querySelectorAll('[data-count]').forEach(el => {
      const to = Number(el.dataset.count), f = el.dataset.fmt, key = el.dataset.key || '';
      // V26.174 : data-t0 / data-dur = animation déjà commencée (anneau du mois) — on la reprend là où elle en est
      const T0 = Number(el.dataset.t0) || 0, dur = Number(el.dataset.dur) || FX.SLOW; // V26.176 : transition numérique rapide (280 ms)
      const from = T0 ? 0 : shownCounts.has(key) ? shownCounts.get(key) : 0;
      shownCounts.set(key, to);
      if (from === to || reducedMotion() || document.hidden || (T0 && performance.now() - T0 >= dur)) { el.textContent = fmtVal(to, f); return; }
      const t0 = T0 || performance.now();
      const step = now => { if (!el.isConnected) return; const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmtVal(from + (to - from) * e, f); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  function syncDots(car) {
    const dots = car.nextElementSibling;
    if (!dots || !dots.hasAttribute('data-dots')) return;
    const n = car.children.length;
    if (dots.children.length !== n) dots.innerHTML = '<i></i>'.repeat(n);
    const first = car.children[0], w = first ? first.getBoundingClientRect().width + 12 : 1;
    const idx = Math.min(n - 1, Math.max(0, Math.round(car.scrollLeft / w)));
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === idx));
  }
  document.addEventListener('scroll', e => { const c = e.target; if (c && c.classList && c.classList.contains('carousel')) syncDots(c); }, true);
  function viewHtml() {
    try {
      switch (S.route) {
        case 'planning': return vPlanning();
        case 'receptions': return vReceptions();
      case 'tva': return monthNavRow() + (filingsSectionF(S.month) || '<div class="section-t"><h2>Suivi TVA</h2></div><div class="empty">Aucune déclaration pour ce mois.</div>') + isSectionF() + cfeSectionF() + cvaeSectionF();
        case 'team': return vTeam();
        case 'clients': return vClients();
        case 'search': return vSearch();
        case 'dashboard': return vDashboard();
        case 'activite': case 'previsions': return vDashboard();
        case 'dashboards': return vDashboards();
        case 'history': return vHistory();
        case 'kpi': return vKpi();
        case 'export': return vExport();
        case 'settings': return vSettings();
        case 'more': return vMore();
        default: return vToday();
      }
    } catch (e) { console.error(e); return '<div class="notice bad">Erreur d\'affichage : ' + esc(errMsg(e)) + '</div>'; }
  }

  /* ---------- Composants ---------- */
  function collabChips(opts) {
    opts = opts || {};
    const cs = visibleCollabs();
    if (!cs.length || (!isManager() && cs.length < 2)) return '';
    return '<div class="chips scroll" data-keep="chips-' + S.route + '">' + (opts.pre || '') + (opts.all ? '<button class="chip' + (!S.collabId ? ' on' : '') + '" data-act="collab" data-id="">Tous</button>' : '')
      + cs.map(c => '<button class="chip' + (S.collabId === c.id && !opts.none ? ' on' : '') + '" data-act="collab" data-id="' + c.id + '"><span class="mini-av" style="background:' + esc(c.color || '#888') + '">' + esc(initials(c.name)) + '</span>' + esc(c.name) + (c.id === S.me.collaborator_id ? '<span class="small" style="opacity:.6">moi</span>' : '') + '</button>').join('') + '</div>';
  }
  function monthNav() {
    return '<div class="month-pill"><button data-act="month" data-d="-1" aria-label="Mois précédent"' + (prevBlocked('month') ? ' disabled title="Premier mois d\'utilisation de JB Flow (modifiable dans Paramètres)"' : '') + '>' + ic('chevL', 'sm') + '</button><b class="cap">' + fMonth(S.month) + '</b><button data-act="month" data-d="1" aria-label="Mois suivant">' + ic('chevR', 'sm') + '</button></div>';
  }
  /* Tâches présentes un jour donné (un dossier étalé apparaît chaque jour de sa répartition) */
  function dayTasks(collabId, date) {
    return list('tasks').filter(t => E.onDay(t, date) && (!collabId || t.collaborator_id === collabId))
      .sort((a, b) => (a.collaborator_id || '').localeCompare(b.collaborator_id || '') || (a.seq - b.seq) || E.KINDS.indexOf(a.kind) - E.KINDS.indexOf(b.kind));
  }
  /* V26.204 : pause déjeuner (12:30 → 13:30 par défaut) — les heures affichées la sautent ; une tâche à cheval est coupée en deux parties */
  const lunchOf = () => { const c = cfg(); return { a: E.parseClock(c.lunch_start || '12:30'), b: E.parseClock(c.lunch_end || '13:30') }; };
  function clockSegs(st, m) {
    const L = lunchOf(); if (L.b <= L.a) return [{ a: st, b: st + m }];
    if (st >= L.a && st < L.b) st = L.b;
    const e = st + m;
    return st < L.a && e > L.a ? [{ a: st, b: L.a }, { a: L.b, b: L.b + e - L.a }] : [{ a: st, b: e }];
  }
  function withTimes(tasks, date) {
    const m = E.parseClock(cfg().day_start), by = {}; let x = null;
    // V26.211 : absence le matin → la journée commence après la pause
    const startOf = k => { x = x || ctx(); const ab = E.absenceOn(k, date, x), L = lunchOf(); return ab && E.absHalf(ab) === 'am' && L.b > L.a ? L.b : m; };
    return tasks.map(t => { const k = t.collaborator_id; if (!(k in by)) by[k] = startOf(k); const sg = clockSegs(by[k], E.minutesOn(t, date) || 0); by[k] = sg[sg.length - 1].b; return { t, time: E.fmtClock(sg[0].a), date, segs: sg }; });
  }
  function prodLine(p) {
    if (!p) return '';
    if (p.received_date) return 'Éléments reçus le ' + fDM(p.received_date);
    return 'Prévisionnel — éléments attendus le ' + fDM(p.expected_date);
  }
  /* Durée affichée : pour un dossier étalé, la part du jour et la position (« 7h · jour 1/2 »). */
  function durLabel(t, date, short) {
    if (!E.hasAlloc(t) || !date) return E.fmtMin(t.duration_min);
    const s = E.segs(t), i = s.findIndex(x => x.d === date);
    if (i < 0) return E.fmtMin(t.duration_min);
    return E.fmtMin(s[i].m) + (short ? ' · ' + (i + 1) + '/' + s.length : ' sur ' + E.fmtMin(t.duration_min) + ' · jour ' + (i + 1) + '/' + s.length);
  }
  /* Carte tâche. o : {time, date, showDate, showCollab, mini, drag, i (ordre d'apparition), swipe:false} */
  function taskRow(t, o) {
    o = o || {};
    const c = clientOf(t.client_id) || { name: '?' }, p = S.data.productions.get(t.production_id);
    const forecast = p && !E.isReceived(t, p) && t.kind !== 'info', td = today();
    const end = E.endDate(t);
    const late = !t.done && end && end < td;
    const after = !t.done && end && t.due_date && end > t.due_date;
    const edit = canEditTask(t);
    const cls = 'task k-' + t.kind + (t.done ? ' done' : '') + (forecast ? ' forecast' : '') + (t._unsaved ? ' unsaved' : '') + (t._failed ? ' failed' : '')
      + (o.mini ? ' mini' : '') + (o.time ? '' : ' nt') + (S.flash.has(t.id) ? ' flash' : '') + (S.justDone.has(t.id) ? ' just-done' : '');
    const drag = o.drag && edit && !t.locked && !t.done ? ' draggable="true" data-drag="' + t.id + '"' : '';
    // V26.166 : date de réalisation (tâche faite) ou des parties déjà faites (tâche scindée, réception partielle)
    const doneDay = t.done && t.done_at ? atDay(t.done_at) : '';
    const partDays = !t.done && t.kind !== 'info' && t.production_id ? (pIdx().tasks.get(t.production_id) || []).filter(x => x.id !== t.id && x.kind === t.kind && x.done && x.done_at).map(x => atDay(x.done_at)).sort() : [];
    const strip = doneDay ? '<div class="done-strip">' + ic('check', 'sm') + 'Faite le ' + fDate(doneDay) + (t.planned_date && t.planned_date !== doneDay && !E.hasAlloc(t) ? ' <span>(prévue le ' + fDM(t.planned_date) + ')</span>' : '') + '</div>'
      : partDays.length ? '<div class="done-strip part">' + ic('clock', 'sm') + (partDays.length > 1 ? partDays.length + ' parties faites : ' + partDays.map(fDM).join(', ') : 'Partie faite le ' + fDate(partDays[0])) + ' · reste à finir</div>' : '';
    if (o.mini) return '<div class="' + cls + '" data-act="task" data-id="' + t.id + '"' + drag + '><div class="tname">' + (t.locked ? ic('lock', 'sm') + ' ' : '') + esc(c.name) + '</div><div class="meta"><span class="kind"><i></i>' + (t.kind === 'info' ? 'Demande' : durLabel(t, o.date, true)) + '</span>' + (t.kind === 'info' ? '<span>' + E.fmtMin(t.duration_min) + '</span>' : '') + '<span class="long">' + (forecast ? 'prévu' : '') + (t.done ? 'fait' + (doneDay ? ' le ' + Number(doneDay.slice(8)) + '/' + doneDay.slice(5, 7) : '') : partDays.length ? 'suite' : '') + '</span>' + (late ? '<b style="color:var(--warn)">à reprendre</b>' : '') + '</div></div>';
    const meta = [];
    if (o.showDate) meta.push(t.planned_date ? '<span class="cap">' + fShort(t.planned_date) + (E.hasAlloc(t) && end !== t.planned_date ? ' → ' + fShort(end) : '') + '</span><span>·</span>' : '<span class="badge r">Non planifiée</span>');
    meta.push('<span class="kind"><i></i>' + E.KIND_LABEL[t.kind] + ' · ' + durLabel(t, o.date) + '</span>');
    if (o.showCollab) { const co = collabOf(t.collaborator_id); meta.push('<span>· ' + esc(co ? co.name : 'Sans collaborateur') + '</span>'); }
    if (t.kind === 'production' && !t.done && isNewDossier(c) && newMarginPct() > 0) meta.push('<span class="badge o" title="Nouveau dossier (coché le ' + fDMY(c.new_since) + ') : temps de production prévu majoré de ' + newMarginPct() + ' % pendant 3 mois">Nouveau dossier +' + newMarginPct() + ' %</span>');
    if (isManager() && !t.done && t.kind === 'production') { const rk = riskOf(t.production_id); if (rk && rk.level === 'eleve') meta.push('<span class="badge r" title="' + esc(rk.why.join(' · ')) + '">Risque élevé</span>'); }
    if (t.kind === 'dashboard') meta.push('<span class="badge b">' + (t.published_at ? 'Publié' : 'À publier avant le ' + fDM(t.due_date)) + '</span>');
    if (t.part === 'recu') meta.push('<span class="badge b">' + ic('inbox') + 'Partie reçue le ' + fDM(t.received_date) + '</span>');
    if (t.part === 'reste' && forecast) meta.push('<span class="badge">Reste attendu</span>');
    if (forecast) meta.push('<span class="badge"' + predictTitle(p) + '>' + ic('calendar') + (isManager() ? 'Prévu · attendus le ' + Number((p.expected_date || '').slice(8)) + expHint(p) : 'Éléments attendus vers le ' + Number((p.expected_date || '').slice(8)) + ' · rien à faire pour l\'instant') + '</span>' + (S.readonly ? '' : '<button class="badge b act" data-act="rec-one" data-id="' + p.id + '" title="Déclarer les éléments reçus aujourd\'hui">' + ic('inbox') + 'Reçu</button>' + (S.v7 ? '<button class="badge act" data-act="rec-part" data-id="' + p.id + '" title="Une partie seulement des éléments est arrivée">Partiel</button>' : '')));
    if (t.kind === 'production' || E.KINDS.indexOf(t.kind) < 3) E.obligations(c, t.month, cfg()).filter(o => o.code !== 'CA3').forEach(o => meta.push('<span class="badge b">' + o.label + ' · ' + fDM(o.due) + '</span>'));
    if (t.kind !== 'info' && p && p.info_request === 'a_faire') meta.push('<span class="badge o">' + ic('mail') + 'Demande à faire</span>'); if (t.kind !== 'info' && waitOf(p)) meta.push(waitBadge(p)); // V26.206
    if (t.locked) meta.push(canEditTask(t) && !S.readonly ? '<button class="badge k lock-btn" data-act="lock" data-id="' + t.id + '" title="Cliquer pour déverrouiller">' + ic('lock') + 'Verrouillée<span class="lock-x">· déverrouiller</span></button>' : '<span class="badge k">' + ic('lock') + 'Verrouillée</span>'); // V26.143 : déverrouiller d'un clic
    if (late) meta.push('<span class="badge o">À reprendre</span>');
    if (after) meta.push('<span class="badge r">Après échéance</span>');
    if (!t.done && t.due_date) meta.push('<span class="badge' + (E.daysBetween(td, t.due_date) <= cfg().due_soon_days ? ' o' : '') + '">Éch. ' + fDM(t.due_date) + '</span>');
    if (t._unsaved) meta.push('<span class="badge o">Enregistrement…</span>');
    if (t._failed) meta.push('<span class="badge r">Non enregistrée</span>');
    const anim = o.i !== undefined ? ' style="--i:' + o.i + '"' : '';
    const row = '<div class="' + cls + (o.i !== undefined && !(edit && o.swipe !== false) ? ' anim-in' : '') + '" data-act="task" data-id="' + t.id + '"' + drag + (edit && o.swipe !== false ? '' : anim) + '>'
      + (o.time ? '<div class="time">' + o.time + '</div>' : '')
      + '<div style="min-width:0">' + strip + '<div class="tname">' + esc(c.name) + '</div><div class="meta">' + meta.join('') + '</div></div>'
      + '<button class="check" ' + (edit ? 'data-act="done" data-id="' + t.id + '"' : 'disabled') + ' title="' + (t.done ? 'Rouvrir' : 'Terminer') + '" aria-label="' + (t.done ? 'Rouvrir la tâche' : 'Terminer la tâche') + '">' + CHECK_SVG + '</button></div>';
    if (!edit || o.swipe === false) return row;
    return '<div class="swipe' + (forecast && !t.done ? ' swipe-recv' : '') + (o.i !== undefined ? ' anim-in' : '') + '" data-swipe="' + t.id + '"' + anim + '><div class="swipe-bg"><span class="l">' + (forecast && !t.done ? ic('inbox') + 'Éléments reçus' : ic('check') + (t.done ? 'Rouvrir' : 'Terminer')) + '</span><span class="r">' + (t.locked ? 'Déverrouiller' : 'Verrouiller') + ic('lock') + '</span></div>' + row + '</div>';
  }
  /* Une carte par tâche (le regroupement de missions n'a plus lieu d'être : temps unique par dossier). */
  function unitsOf(items) { return items.map(x => ({ tasks: [x.t], time: x.time, date: x.date })); }
  function unitRow(u, o) { return taskRow(u.tasks[0], Object.assign({}, o, { time: u.time, date: u.date })); }
  function groupTasks(pid, date, cid) { return list('tasks').filter(t => t.production_id === pid && (t.planned_date || '') === (date || '') && (t.collaborator_id || '') === (cid || '')).sort((a, b) => E.KINDS.indexOf(a.kind) - E.KINDS.indexOf(b.kind)); }
  const groupKey = ts => 'g:' + ts[0].production_id + ':' + (ts[0].planned_date || '') + ':' + (ts[0].collaborator_id || '');
  function groupFromKey(k) { const p = k.split(':'); return groupTasks(p[1], p[2], p[3]); }
  function groupRow(ts, o) {
    o = o || {};
    const t0 = ts[0], c = clientOf(t0.client_id) || { name: '?' }, p = S.data.productions.get(t0.production_id);
    const forecast = p && !ts.some(t => E.isReceived(t, p)), td = today();
    const done = ts.every(t => t.done), anyLocked = ts.some(t => t.locked), allLocked = ts.every(t => t.locked);
    const late = !done && t0.planned_date && t0.planned_date < td;
    const dur = ts.reduce((s, t) => s + (Number(t.duration_min) || 0), 0), durTodo = ts.filter(t => !t.done).reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
    const edit = ts.every(canEditTask), key = groupKey(ts);
    const kinds = '<span class="kinds">' + ts.map(t => '<i class="k-' + t.kind + (t.done ? ' done' : '') + '"></i>').join('') + '</span>';
    const labels = ts.map(t => E.KIND_LABEL[t.kind]).join(' + ');
    const cls = 'task merged' + (done ? ' done' : '') + (forecast ? ' forecast' : '') + (o.mini ? ' mini' : '') + (o.time ? '' : ' nt')
      + (ts.some(t => t._unsaved) ? ' unsaved' : '') + (ts.some(t => t._failed) ? ' failed' : '') + (ts.some(t => S.flash.has(t.id)) ? ' flash' : '') + (ts.some(t => S.justDone.has(t.id)) ? ' just-done' : '');
    const drag = o.drag && edit && !anyLocked && !done ? ' draggable="true" data-drag="' + key + '"' : '';
    const attrs = 'data-act="group" data-key="' + key + '"'; // V26.167 : plus de bulle au survol des cartes
    if (o.mini) return '<div class="' + cls + '" ' + attrs + drag + '><div class="tname">' + (anyLocked ? ic('lock', 'sm') + ' ' : '') + esc(c.name) + '</div><div class="meta">' + kinds + ' ' + E.fmtMin(dur) + '<span class="long">' + (forecast ? ' · prévu' : '') + (done ? ' · fait' : '') + '</span>' + (late ? ' · <b style="color:var(--bad)">retard</b>' : '') + '</div></div>';
    const meta = ['<span class="kind">' + kinds + labels + '</span><span>· ' + E.fmtMin(dur) + (durTodo && durTodo !== dur ? ' (reste ' + E.fmtMin(durTodo) + ')' : '') + '</span>'];
    if (forecast) meta.push('<span class="badge"' + predictTitle(p) + '>' + ic('calendar') + 'Prévu · attendus le ' + Number((p.expected_date || '').slice(8)) + '</span>');
    if (allLocked) meta.push('<span class="badge k">' + ic('lock') + 'Verrouillé</span>'); else if (anyLocked) meta.push('<span class="badge k">' + ic('lock') + 'En partie verrouillé</span>');
    if (p && p.info_request === 'a_faire') meta.push('<span class="badge o">' + ic('mail') + 'Demande à faire</span>'); if (waitOf(p)) meta.push(waitBadge(p));
    if (late) meta.push('<span class="badge r">Retard</span>');
    if (!done && t0.due_date) meta.push('<span class="badge' + (E.daysBetween(td, t0.due_date) <= cfg().due_soon_days ? ' o' : '') + '">Éch. ' + fDM(t0.due_date) + '</span>');
    const anim = o.i !== undefined ? ' style="--i:' + o.i + '"' : '';
    const row = '<div class="' + cls + (o.i !== undefined && !edit ? ' anim-in' : '') + '" ' + attrs + drag + (edit ? '' : anim) + '>'
      + (o.time ? '<div class="time">' + o.time + '</div>' : '')
      + '<div style="min-width:0">' + strip + '<div class="tname">' + esc(c.name) + '</div><div class="meta">' + meta.join('') + '</div></div>'
      + '<button class="check" ' + (edit ? 'data-act="done-group" data-key="' + key + '"' : 'disabled') + ' title="' + (done ? 'Rouvrir le dossier' : 'Terminer le dossier') + '" aria-label="' + (done ? 'Rouvrir le dossier' : 'Terminer le dossier') + '">' + CHECK_SVG + '</button></div>';
    if (!edit) return row;
    return '<div class="swipe' + (o.i !== undefined ? ' anim-in' : '') + '" data-swipe="' + key + '"' + anim + '><div class="swipe-bg"><span class="l">' + ic('check') + (done ? 'Rouvrir' : 'Terminer') + '</span><span class="r">' + (allLocked ? 'Déverrouiller' : 'Verrouiller') + ic('lock') + '</span></div>' + row + '</div>';
  }

