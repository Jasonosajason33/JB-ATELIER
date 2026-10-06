  /* ---------- Vue AUJOURD'HUI ---------- */
  // V26.167 : le RC et le collaborateur ont la même vue que le manager (l'apprenti garde son espace simplifié)
  const todayAsManager = () => isManager() || (!!S.me && S.me.role !== 'apprenti' && !!S.me.collaborator_id && !!collabOf(S.me.collaborator_id) && collabOf(S.me.collaborator_id).kind !== 'apprenti');
  function vToday() {
    if (!todayAsManager()) return vTodayCollab();
    const mgr = isManager();
    if (mgr && !collabs().length) return noCollabsHelp();
    const d = today(), vis = visibleCollabs(), team = mgr && !!S.todayTeam && vis.length > 1; // V26.190 : bouton « Équipe » (manager) — les cartes regroupent toute l'équipe visible
    const ids = team ? vis.map(x => x.id) : null, idSet = new Set(ids || []);
    const cid = team ? null : mgr ? S.collabId : (S.collabId && canSeeCollab(S.collabId) ? S.collabId : S.me.collaborator_id), c = collabOf(cid), key = team ? 'team' : cid;
    const first = (S.me.name || '').split(' ')[0];
    // V26.58 : en vue manager, le titre suit le collaborateur affiché (« Bonjour » seulement sur sa propre journée)
    const mine = c && c.id === S.me.collaborator_id;
    const tasks = team ? withTimes(dayTasks(null, d).filter(t => idSet.has(t.collaborator_id)), d) : c ? withTimes(dayTasks(cid, d), d) : [], todo = tasks.filter(x => !x.t.done);
    const rg = team ? ringHtml(null, d, ids) : c ? ringHtml(cid, d) : null;
    const mood = !rg ? '' : !rg.cap ? 'Journée non travaillée : profite.' : !tasks.length ? 'Aucune production prévue aujourd\'hui.' : { green: 'Ta journée est bien équilibrée.', orange: 'Journée bien remplie : pense à souffler.', red: 'Journée très remplie : regarde ton planning.', off: '' }[msgLv(rg.lv, rg.l.total, rg.cap)]; // V26.185 : aucune phrase d'avertissement sous 108 %
    // V26.190 : les noms des personnes sur la même ligne que le titre, au milieu de l'écran (les cartes remontent)
    const chips = collabChips(mgr && vis.length > 1 ? { none: team, pre: '<button class="chip chip-team' + (team ? ' on' : '') + '" data-act="today-team" title="Regrouper toute l\'équipe dans les cartes">' + ic('users', 'sm') + 'Équipe<span class="small" style="opacity:.6">' + vis.length + '</span></button>' } : {});
    const head = '<div class="hello anim-in"><div><div class="eyebrow cap">' + fDate(d) + (team ? ' · vue manager · équipe' : c && !mine ? (mgr ? ' · vue manager' : ' · ton binôme') : '') + '</div><div class="hello-row"><h1>' + (team ? 'Journée de l\'équipe' : mine || !c ? 'Bonjour, ' + esc(first) : 'Journée de ' + esc(c.name)) + '</h1>' + (chips ? '<div class="hello-chips">' + chips + '</div>' : '') + '</div>' + (mgr ? '' : flowQuoteHtml()) + '<p>'
      + (team ? 'La production du jour des ' + vis.length + ' personnes de l\'équipe et leurs clients à relancer.' : c ? (mine ? (mgr ? 'Voici votre production du jour.' : mood) : 'Sa production du jour et ses clients à relancer.') : 'Bonjour, ' + esc(first) + ' — choisissez un collaborateur.') + '</p></div>' + (team ? monthRing(null) : c ? monthRing(c.id) : '') + '</div>';
    if (!c && !team) return head;
    const al = alertsOf(engineData(), d, team ? {} : { collabId: cid }).filter(a => (a.type !== 'near' || a.date === d) && (!team || !a.collab_id || idSet.has(a.collab_id)));
    const bad = al.filter(a => a.level === 'bad').length;
    const recs = list('productions').filter(p => awaitingRec(p) && p.expected_date <= E.addDays(d, 2) && p.month >= E.addMonths(d.slice(0, 7), -1))
      .filter(p => { const cl = clientOf(p.client_id); return cl && (team ? idSet.has(cl.collaborator_id) : cl.collaborator_id === cid); })
      .sort(recOrder); // V26.163 : le mois en cours d'abord
    const doneN = tasks.length - todo.length, pctDone = tasks.length ? Math.round(doneN / tasks.length * 100) : 0;

    const k1 = '<div class="kpi anim-in" style="--i:1"><div class="kpi-h"><span class="ibox">' + ic('gauge', 'sm') + '</span>Niveau d\'activité du jour</div>'
      + '<div class="load-card">' + rg.html + '<div class="legend-list"><div><span class="badge ' + LV_BADGE[msgLv(rg.lv, rg.l.total, rg.cap)] + '">' + lvLabel(msgLv(rg.lv, rg.l.total, rg.cap)) + '</span></div><div><i class="lg-sw hatch"></i>Réalisé<b>' + E.fmtMin(rg.l.done) + '</b></div><div><i class="lg-sw lv-' + rg.lv + '"></i>Reste à faire<b>' + E.fmtMin(rg.l.todo) + '</b></div><div><i class="lg-sw" style="background:var(--track)"></i>Disponible<b>' + E.fmtMin(Math.max(0, rg.cap - rg.l.total)) + '</b></div></div></div></div>';
    // V26.194 : la carte « Reste à faire » ouvre le planning du jour (de la personne affichée, ou de toute l'équipe)
    const k2 = '<div class="kpi hero kpi-click anim-in" style="--i:2" role="button" tabindex="0" data-act="today-plan"' + (team ? '' : ' data-c="' + cid + '"') + ' title="Voir le planning du jour"><span class="go">' + ic('arrowUR', 'sm') + '</span><div class="kpi-h"><span class="ibox">' + ic('list', 'sm') + '</span>Reste à faire</div><div class="v"><span data-count="' + todo.length + '" data-fmt="int" data-key="t-todo-' + key + '">' + todo.length + '</span><small>tâche' + (todo.length > 1 ? 's' : '') + '</small></div>'
      + '<div class="foot">' + E.fmtMin(rg.l.todo) + ' · ' + doneN + ' terminée' + (doneN > 1 ? 's' : '') + '</div><div class="bar" style="background:rgba(255,255,255,.12)"><i style="width:' + pctDone + '%;background:var(--accent)"></i></div></div>';
    const k3 = '<a class="kpi popk anim-in" style="--i:3" href="#/receptions"><span class="go">' + ic('arrowUR', 'sm') + '</span><div class="kpi-h"><span class="ibox">' + ic('inbox', 'sm') + '</span>Réceptions attendues</div><div class="v" data-count="' + recs.length + '" data-fmt="int" data-key="t-rec-' + key + '">' + recs.length + '</div>'
      + '<div class="foot">' + (recs.length ? esc(recs.slice(0, 2).map(p => clientOf(p.client_id).name).join(', ')) + (recs.length > 2 ? '…' : '') : 'Rien à déclarer d\'ici 2 jours') + '</div></a>';
    const k4 = '<div class="kpi anim-in" style="--i:4"' + (al.length && mgr ? ' data-act="goto" data-r="dashboard"' : '') + '>' + (al.length && mgr ? '<span class="go">' + ic('arrowUR', 'sm') + '</span>' : '') + '<div class="kpi-h"><span class="ibox ' + (bad ? 'r' : al.length ? 'o' : 'g') + '">' + ic(bad ? 'alert' : 'check', 'sm') + '</span>Alertes</div><div class="v" data-count="' + al.length + '" data-fmt="int" data-key="t-al-' + key + '">' + al.length + '</div>'
      + '<div class="foot clamp">' + (al.length ? esc(softText(al[0].text)) : 'Tout est sous contrôle') + '</div></div>';
    // V26.167 : RC / collaborateur — rappels CFE, CVAE et capacité, puis conseils (étalement, aide, temps réels) sous les indicateurs
    const tips = mgr ? '' : helpFeedback(cid) + (mine ? timeReminder(cid) : '') + collabTip(cid);

    return head + (team ? '' : unplBanner(cid)) + (mgr ? '' : cfeReminder(cid) + cvaeReminder(cid) + capNoticeCollab(cid)) + progressBanner(cid, ids)
      + '<div class="carousel desk-grid kpis-today" data-keep="kpi-today">' + k1 + k2 + k3 + k4 + '</div><div class="dots" data-dots></div>' + irStrip(team ? ids : [cid]) // V26.198 : sous les cartes
      + (tips ? '<div class="today-tips">' + tips + '</div>' : '')
      + '<div class="split" style="margin-top:var(--gap)">'
      + '<div class="card anim-in" style="--i:5"><div class="card-h"><h2>' + (team ? 'Production de l\'équipe' : mine ? 'Ma production' : 'Production de ' + esc(c.name.split(' ')[0])) + '</h2><span class="badge hide-m">' + tasks.length + ' tâche' + (tasks.length > 1 ? 's' : '') + ' · ' + E.fmtMin(rg.l.total) + '</span><a class="btn sm" href="#/planning" data-act="goday" data-date="' + d + '">Planning' + ic('chevR', 'sm') + '</a></div>'
      + (tasks.length ? '<div class="tasks">' + unitsOf(tasks).map((u, i) => unitRow(u, { i: i + 6, showCollab: team })).join('') + '</div><div class="swipe-hint only-m">' + (mgr ? 'Glissez une carte vers la droite pour la terminer (ou déclarer les éléments reçus), vers la gauche pour la verrouiller' : 'Glisse une carte vers la droite pour la terminer (ou déclarer les éléments reçus), vers la gauche pour la verrouiller') + '</div>' : '<div class="empty">Aucune tâche planifiée aujourd\'hui.</div>')
      + '</div><div>'
      + '<div class="frame anim-in rec-home-f" style="--i:6"><div class="frame-h">' + ic('inbox') + '<h2>Réceptions</h2>' + (recs.length ? '<input type="search" class="rec-q" data-in="recq" placeholder="Rechercher un dossier…" value="' + esc(S.recQ || '') + '" aria-label="Rechercher un dossier">' : '') + '<a class="btn sm" href="#/receptions">Tout voir</a></div><div class="inner">'
      + (recs.length ? '<div id="rec-home">' + recHomeList(recs, d) + '</div><button class="btn primary" style="width:100%;margin-top:12px" data-act="rec-validate"' + (S.recSel.size ? '' : ' disabled') + '>' + ic('check', 'sm') + 'Valider · ' + S.recSel.size + '</button>' : '<div class="empty">Aucun élément attendu d\'ici 2 jours.</div>')
      + '</div></div>'
      + '<div class="frame anim-in" style="--i:7"><div class="frame-h">' + ic('alert') + '<h2>Alertes</h2>' + (al.length ? '<span class="badge ' + (bad ? 'r' : 'o') + '">' + al.length + '</span>' : '') + '</div><div class="inner">' + alertList(al, 6) + '</div></div>'
      + '</div></div>'
      + (mgr ? '' : '<p class="privacy small muted">' + ic('lock', 'sm') + 'Tes temps me servent à ajuster ton planning et harmoniser ton niveau d\'activité.</p>');
  }
  /* V26.148 : Réceptions — listes par pages (8 éléments à déclarer, 15 déjà reçus), comme « TVA à déposer » */
  function recPage(k, a, per) { const key = 'recPage_' + k, n = Math.max(1, Math.ceil(a.length / per)); S[key] = Math.min(Math.max(1, S[key] || 1), n); return a.slice((S[key] - 1) * per, S[key] * per); }
  function recPager(k, len, per, bottom) {
    if (len <= per) return '';
    const n = Math.ceil(len / per), p = Math.min(S['recPage_' + k] || 1, n), from = (p - 1) * per + 1, to = Math.min(len, p * per);
    return '<div class="fil-pager' + (bottom ? ' bottom' : '') + '"><span class="small muted">' + from + '–' + to + ' sur ' + len + '</span><span class="spacer"></span><button class="btn sm" data-act="rec-page" data-k="' + k + '" data-d="-1"' + (p <= 1 ? ' disabled' : '') + '>' + ic('chevL', 'sm') + 'Précédent</button><span class="small"><b>' + p + '</b> / ' + n + '</span><button class="btn sm primary" data-act="rec-page" data-k="' + k + '" data-d="1"' + (p >= n ? ' disabled' : '') + '>Suivant' + ic('chevR', 'sm') + '</button></div>';
  }  /* V26.157 : carte « Réceptions » de l'accueil — recherche par nom + pages de 15 */
  function recHomeList(recs, d) {
    S._recHome = { recs, d };
    const q = (S.recQ || '').trim().toLowerCase(), sel = q ? recs.filter(p => ((clientOf(p.client_id) || {}).name || '').toLowerCase().includes(q)) : recs;
    if (!sel.length) return '<div class="empty">Aucun dossier ne correspond à « ' + esc(S.recQ) + ' ».</div>';
    // V26.163 : les restes des mois précédents sont regroupés sous un intitulé (avec « Clôturer » pour le manager)
    let html = '', grp = null; const cm = defaultMonth();
    recPage('h', sel, 15).forEach(p => { const old = p.month < cm ? p.month : null; if (old && old !== grp) html += recGroupHead(old, sel.filter(x => x.month === old).length); grp = old; html += recRow(p, d); });
    return recPager('h', sel.length, 15) + '<div class="rec-list">' + html + '</div>';
  }
  function recGroupHead(m, n) {
    const canClose = isManager() && !S.readonly && E.windowOf(m, cfg()).end < today();
    return '<div class="rec-group">' + ic('alert', 'sm') + '<span><b>' + esc(fMonth(m).replace(/^./, s => s.toUpperCase())) + '</b> : ' + n + ' dossier' + (n > 1 ? 's' : '') + ' jamais déclaré' + (n > 1 ? 's' : '') + ' reçu' + (n > 1 ? 's' : '') + ' (mois précédent)</span>'
      + (canClose ? '<button type="button" class="btn sm" data-act="close-month" data-m="' + m + '" title="Dossiers traités hors de l\'application : les marquer terminés">' + ic('check', 'sm') + 'Clôturer ' + esc(fMonth(m)) + '</button>' : '') + '</div>';
  }
  function recRow(p, d) {
    const c = clientOf(p.client_id) || { name: '?' }, co = collabOf(c.collaborator_id);
    const late = p.expected_date < d;
    return '<label class="rec"' + predictTitle(p) + '><input type="checkbox" data-ch="recsel" data-id="' + p.id + '"' + (S.recSel.has(p.id) ? ' checked' : '') + '><span style="flex:1"><span class="n">' + esc(c.name) + '</span><br><span class="small muted">' + (co ? esc(co.name) + ' · ' : '') + 'attendus le ' + fDM(p.expected_date) + expHint(p) + recRelHint(p) + (p.partial_date ? ' · reçu en partie le ' + fDM(p.partial_date) : '') + (p.month !== S.month ? ' (' + fMonth(p.month) + ')' : '') + (lastRelance(p) ? ' · <b class="rel-done">' + ic(lastRelance(p).via === 'telephone' ? 'phone' : 'mail', 'sm') + esc(relLabel(lastRelance(p))) + '</b>' : '') + '</span></span>' + (S.v7 && !S.readonly ? '<button type="button" class="btn sm" data-act="rec-part" data-id="' + p.id + '" title="Une partie seulement des éléments est arrivée : indiquer le temps estimé de cette partie">Partiel</button>' : '')
      + (late ? '<span class="rec-side"><span class="badge r">En retard</span><button type="button" class="btn icon sm rl-btn" data-act="relance" data-pid="' + p.id + '" title="Texte de relance à copier" aria-label="Relancer ' + esc(c.name) + '">' + ic('mail', 'sm') + '</button>' + '<button type="button" class="btn icon sm rl-btn rl-tel' + (lastRelance(p) && lastRelance(p).via === 'telephone' && lastRelance(p).date === today() ? ' on' : '') + '" data-act="relance-tel" data-pid="' + p.id + '" title="' + (lastRelance(p) && lastRelance(p).via === 'telephone' && lastRelance(p).date === today() ? 'Relance téléphonique notée aujourd\'hui : cliquer pour l\'annuler' : 'Client relancé par téléphone : noter la relance') + '" aria-label="Client ' + esc(c.name) + ' relancé par téléphone"' + (S.readonly ? ' disabled' : '') + '>' + ic('phone', 'sm') + '</button></span>'
        : p.expected_date === d ? '<span class="badge o">Aujourd\'hui</span>' : '<span class="badge">Prévu</span>') + '</label>';
  }

  /* ---------- Vue PLANNING ---------- */
  /* V26.186 : l'onglet Planning devient le « cockpit » de l'équipe (071-planning-cockpit.js) — indicateurs, frise du jour, semaine, cartes de pilotage */
  function vPlanning() {
    if (!collabs().length) return noCollabsHelp();
    return pcView();
  }
  function weekDays(c, start) {
    return E.rangeDates(start, E.addDays(start, 4)); // lundi → vendredi (le week-end n'existe pas dans l'outil)
  }
  /* V26.74 : planning de la semaine, suivi du planning de l'apprenti (glisser-déposer entre les deux) */
  function planWeek(c) {
    // V26.76 : sous le planning affiché, ceux des personnes rattachées (collaborateurs du RC, apprentis) — jamais au-dessus
    const subs = juniorsOf(c.id).filter(a => canSeeCollab(a.id));
    if (!subs.length) return weekGrid(c, false);
    const lane = (p, i) => '<div class="ap-lane"><div class="ap-h"><span class="dot" style="background:' + esc(p.color || 'var(--accent)') + '"></span><b>' + (!i ? 'Planning de ' : p.kind === 'apprenti' ? 'Planning de l\'apprenti · ' : 'Planning de son collaborateur · ') + esc(p.name) + '</b>' + (p.kind === 'apprenti' ? '<span class="badge b">Apprenti · jours en entreprise</span>' : '') + '</div>' + weekGrid(p, true, true) + '</div>';
    return [c].concat(subs).map(lane).join('')
      + '<p class="small muted hide-m">Glissez-déposez une tâche d\'un planning à l\'autre pour la confier à votre collaborateur ou à l\'apprenti, ou la reprendre — même si le dossier ne lui est pas attribué. Les jours grisés de l\'apprenti sont ses jours hors entreprise (école).</p>';
  }
  function weekGrid(c, withDc, noHint) {
    const x = ctx(), start = E.startOfWeek(S.cursor), days = weekDays(c, start), td = today();
    const win = E.windowOf(S.cursor.slice(0, 7), x.settings);
    const cols = days.map(d => {
      const cap = E.capacityOn(c, d, x), l = E.loadOf(list('tasks'), c.id, d), pf = pcFill(l.total, cap); // V26.186 : barre graphique, sans pourcentage
      const hol = x.settings.holidays && E.holidayName(d), ab = E.absenceOn(c.id, d, x);
      const outwin = d < win.start || d > win.end;
      const units = unitsOf(dayTasks(c.id, d).map(t => ({ t, date: d })));
      const dens = units.length > 7 ? ' dense xdense' : units.length > 4 ? ' dense' : '';
      return '<div class="day-col pc-dcol' + dens + (d === td ? ' today' : '') + (outwin ? ' outwin' : '') + (c.kind === 'apprenti' && !cap ? ' ap-off' : '') + '" data-drop="' + d + '"' + (withDc ? ' data-dc="' + c.id + '"' : '') + '><div class="dh" data-act="goday" data-date="' + d + '"><b>' + (d === td ? '<i class="pc-dot g"></i>' : '') + fShort(d) + ' ' + fMonth(d.slice(0, 7)).split(' ')[0] + '</b><span class="small muted"><b>' + E.fmtMin(l.total) + '</b> / ' + E.fmtMin(cap) + '</span></div>'
        + (cap || l.total ? pcBar(pf) + '<div class="pc-who-f f-' + pf.cls + '">' + esc(pf.txt) + '</div>' : '<div class="small muted">' + (hol ? 'Férié' : ab ? absLabel(ab) : c.kind === 'apprenti' ? 'École / hors entreprise' : 'Non travaillé') + '</div>')
        + units.filter(u => pcMatch(u.tasks[0], pcState(u.tasks[0], d, null))).map(u => pcCard(u.tasks[0], d)).join('') + '</div>';
    }).join('');
    return '<div class="week" style="--cols:' + days.length + '">' + cols + '</div>' + (noHint ? '' : '<p class="small muted hide-m">Astuce : glissez-déposez une tâche d\'un jour à l\'autre, ou cliquez dessus pour la modifier. Les jours grisés sont hors de la période ' + x.settings.start_day + ' → ' + endLbl(S.cursor.slice(0, 7)) + '.</p>');
  }
  function planMonth(c, m, from) { // V26.193 : from = premier jour affiché (mois en cours : à partir d'aujourd'hui) — les totaux restent ceux de la période
    const x = ctx(), win = E.windowOf(m, x.settings), td = today(), dates = E.monthDates(m);
    const wdays = dates.filter(d => E.dow(d) <= 5), shown = wdays.filter(d => !from || d >= from), lead = E.dow((shown[0] || wdays[0])) - 1;
    let cells = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'].map(w => '<div class="wd">' + w + '</div>').join('');
    for (let i = 0; i < lead; i++) cells += '<div class="mcell blank"></div>';
    let tot = 0, capT = 0;
    for (const d of wdays) {
      const cap = E.capacityOn(c, d, x), l = E.loadOf(list('tasks'), c.id, d), lv = E.levelOf(l.total, cap, x.settings);
      const n = dayTasks(c.id, d).length, outwin = d < win.start || d > win.end;
      if (!outwin) { tot += l.total; capT += cap; }
      if (from && d < from) continue;
      const hol = x.settings.holidays && E.holidayName(d), ab = E.absenceOn(c.id, d, x), h = ab && cap > 0 ? E.absHalf(ab) : ''; // V26.211 : absences grisées
      cells += '<div class="mcell cell-' + (cap || l.total ? lv : 'off') + (!cap ? ' is-off' : '') + (h ? ' h' + h : '') + (outwin ? ' outwin' : '') + (d === td ? ' today' : '') + '" data-act="goday" data-date="' + d + '" data-drop="' + d + '" data-dc="' + c.id + '"><div class="dn"><span>' + Number(d.slice(8)) + '</span>' + (hol ? '<span title="' + esc(hol) + '">F</span>' : '') + '</div>'
        + (ab ? '<div class="abs-l">' + esc(absLabel(ab)) + '</div>' : !cap && c.kind === 'apprenti' && !hol ? '<div class="abs-l">École</div>' : '')
        + (l.total ? '<div class="hl">' + E.fmtMin(l.total) + '<span class="hide-m"> / ' + E.fmtMin(cap) + '</span></div><div class="cnt small">' + n + ' tâche' + (n > 1 ? 's' : '') + '</div>' : cap ? '<div class="small muted">libre<span class="hide-m"> · ' + E.fmtMin(cap) + '</span></div>' : '') + '</div>';
    }
    const unpl = list('tasks').filter(t => t.month === m && t.collaborator_id === c.id && !t.done && !t.planned_date);
    return '<div class="card"><div class="month">' + cells + '</div><div class="legend" style="margin-top:12px"><span><i class="swatch cell-green" style="background:var(--green)"></i>Normale</span><span><i class="swatch" style="background:var(--orange)"></i>≥ ' + x.settings.warn_pct + ' %</span><span><i class="swatch" style="background:var(--red)"></i>' + (isManager() ? 'Surcharge' : 'Au-delà de 100 %') + '</span><span>Période ' + x.settings.start_day + ' → ' + endLbl(m) + ' : <b>' + E.fmtMin(tot) + ' / ' + E.fmtMin(capT) + '</b> (' + (capT ? Math.round(tot / capT * 100) : 0) + ' %)</span></div></div>'
      + (unpl.length ? '<div class="card"><h2 style="margin-bottom:10px">⚠️ Non planifiées (' + unpl.length + ')</h2><div class="tasks">' + unpl.map(t => taskRow(t)).join('') + '</div></div>' : '');
  }

  /* ---------- Vue ÉQUIPE ---------- */
  function vTeam() {
    if (!collabs().length) return noCollabsHelp();
    const x = ctx(), td = today();
    let dates, lbl;
    if (S.teamRange === 'week') { const st = E.startOfWeek(S.cursor); dates = E.rangeDates(st, E.addDays(st, 4)); lbl = 'Semaine du ' + fDM(st); }
    else { const w = E.windowOf(S.month, x.settings); dates = E.rangeDates(w.start, w.end).filter(d => E.dow(d) <= 5); lbl = 'Période du ' + fDM(w.start) + ' au ' + fDM(w.end); }
    const cs = visibleCollabs(), tasks = list('tasks');
    const rows = cs.map(c => {
      let tot = 0, capT = 0;
      const cells = dates.map(d => {
        const cap = E.capacityOn(c, d, x), l = E.loadOf(tasks, c.id, d), lv = E.levelOf(l.total, cap, x.settings);
        tot += l.total; capT += cap;
        const rest = cap - l.total;
        return '<td class="c cell-' + (cap || l.total ? lv : 'off') + '" data-act="teamcell" data-c="' + c.id + '" data-date="' + d + '">' + (cap || l.total ? E.fmtMin(l.total) + ' / ' + E.fmtMin(cap) + '<small>' + (rest >= 0 ? 'reste ' + E.fmtMin(rest) : 'dépasse ' + E.fmtMin(-rest)) + '</small>' : '<small>' + (E.absenceOn(c.id, d, x) ? 'absent' : 'off') + '</small>') + '</td>';
      }).join('');
      const lv = E.levelOf(tot, capT, x.settings);
      return '<tr><td class="name"><i class="swatch" style="background:' + esc(c.color || '#888') + '"></i> ' + esc(c.name) + '</td>' + cells + '<td class="c cell-' + lv + '">' + E.fmtMin(tot) + ' / ' + E.fmtMin(capT) + '<small>' + (capT ? Math.round(tot / capT * 100) : 0) + ' %</small></td></tr>';
    }).join('');
    return '<div class="print-title">Vue équipe — ' + esc(lbl) + '</div><div class="row no-print" style="margin-bottom:14px"><div class="seg"><button class="' + (S.teamView !== 'gantt' ? 'on' : '') + '" data-act="tview" data-v="table">Tableau</button><button class="' + (S.teamView === 'gantt' ? 'on' : '') + '" data-act="tview" data-v="gantt">Frise</button></div><div class="seg"><button class="' + (S.teamRange === 'week' ? 'on' : '') + '" data-act="trange" data-r="week">Semaine</button><button class="' + (S.teamRange === 'period' ? 'on' : '') + '" data-act="trange" data-r="period">Période ' + x.settings.start_day + '→' + endLbl(S.month) + '</button></div>'
      + '<div class="row"><button class="btn icon sm" data-act="tnav" data-d="-1" aria-label="Précédent"' + (prevBlocked(S.teamRange === 'week' ? 'week' : 'month') ? ' disabled' : '') + '>' + ic('chevL', 'sm') + '</button><button class="btn sm" data-act="tnav" data-d="0">Aujourd\'hui</button><button class="btn icon sm" data-act="tnav" data-d="1" aria-label="Suivant">' + ic('chevR', 'sm') + '</button></div><b class="cap">' + esc(lbl) + '</b><span class="spacer"></span><button class="btn hide-m" data-act="print">' + ic('download', 'sm') + 'PDF</button></div>'
      + (S.teamView === 'gantt' ? teamGantt(dates) :
      '<div class="card"><div class="scroll-x"><table class="team"><thead><tr><th class="name">Collaborateur</th>' + dates.map(d => '<th' + (d === td ? ' style="color:var(--accent)"' : '') + '>' + fShort(d) + '</th>').join('') + '<th>Total</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<div class="legend" style="margin-top:12px"><span><i class="lg-sw" style="background:var(--ok)"></i>Disponible / activité normale</span><span><i class="lg-sw" style="background:var(--warn)"></i>Proche de la saturation (≥ ' + x.settings.warn_pct + ' %)</span><span><i class="lg-sw" style="background:var(--bad)"></i>Surchargé</span><span><i class="lg-sw" style="background:var(--track)"></i>Non travaillé / absent</span></div><p class="small muted">Cliquez sur une case pour ouvrir le planning du jour.</p></div>');
  }

  /* ---------- Vue RÉCEPTIONS ---------- */
  const monthNavRow = () => '<div class="tva-nav">' + monthNav() + '<div class="tva-recaps"><button class="btn primary tva-recap-btn" data-act="tva-recap">' + ic('list', 'sm') + 'Récap TVA du mois</button><button class="btn tva-recap-btn2" data-act="is-recap">' + ic('list', 'sm') + 'Récap Acompte IS</button><button class="btn tva-recap-btn2" data-act="cfe-recap">' + ic('list', 'sm') + 'Récap CFE</button></div><span></span></div>'; // V26.97 : bouton centré et allongé
  /* V26.213 : listes des Réceptions (recherche par nom de dossier, listes déroulantes à la molette au lieu des pages) */
  const recNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function recData() {
    const m = S.month, prods = list('productions').filter(p => p.month === m), q = recNorm(S.recQ).trim();
    const mine = p => { const c = clientOf(p.client_id); return c && (S.recAll || !S.me.collaborator_id || c.collaborator_id === S.me.collaborator_id); };
    const hit = p => !q || recNorm((clientOf(p.client_id) || {}).name).includes(q);
    const waitAll = prods.filter(p => !p.received_date && mine(p)), gotAll = prods.filter(p => p.received_date && mine(p));
    const waiting = waitAll.filter(hit).sort((a, b) => (a.expected_date || '').localeCompare(b.expected_date || '') || byName(clientOf(a.client_id) || {}, clientOf(b.client_id) || {}));
    const got = gotAll.filter(hit).sort((a, b) => b.received_date.localeCompare(a.received_date));
    return { prods, waiting, got, nW: waitAll.length, nG: gotAll.length, q };
  }
  const recWaitHtml = (w, td) => w.length ? w.map(p => recRow(p, td)).join('') : '<div class="empty">' + (S.recQ ? 'Aucun dossier à recevoir ne correspond.' : 'Tous les éléments sont reçus 🎉') + '</div>';
  const recGotHtml = g => g.length ? '<table class="t rec-got"><tbody>' + g.map(p => { const c = clientOf(p.client_id) || {}; return '<tr><td>✅ <b>' + esc(c.name) + '</b></td><td class="small muted">reçus le ' + fDM(p.received_date) + '</td><td class="num"><button class="btn sm" data-act="rec-undo" data-id="' + p.id + '">Annuler</button></td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">' + (S.recQ ? 'Aucun dossier reçu ne correspond.' : 'Aucun pour l\'instant.') + '</div>';
  const recCount = (n, all) => n === all ? String(all) : n + ' / ' + all;
  function recRefresh() {
    const r = recData(), td = today(), w = $('#rec-wl'), g = $('#rec-gl');
    if (w) w.innerHTML = recWaitHtml(r.waiting, td); if (g) g.innerHTML = recGotHtml(r.got);
    const a = $('#rec-nw'), b = $('#rec-ng'), c = $('#rec-qn'); if (a) a.textContent = 'Éléments reçus — à déclarer (' + recCount(r.waiting.length, r.nW) + ')'; if (b) b.textContent = 'Déjà reçus (' + recCount(r.got.length, r.nG) + ')';
    if (c) c.textContent = r.q ? (r.waiting.length + r.got.length) + ' résultat' + (r.waiting.length + r.got.length > 1 ? 's' : '') : '';
    const x = $('#rec-qx'); if (x) x.style.display = S.recQ ? '' : 'none';
  }
  function vReceptions() {
    const m = S.month, td = today();
    const R = recData(), prods = R.prods, waiting = R.waiting, got = R.got;
    const missing = missingForMonth(m);
    return '<div class="row" style="margin-bottom:14px">' + monthNav() + '<span class="spacer"></span>'
      + (S.me.collaborator_id ? '<button class="btn tg' + (S.recAll ? ' on' : '') + '" data-act="recall-tg" aria-pressed="' + !!S.recAll + '">' + ic(S.recAll ? 'check' : 'folder', 'sm') + 'Afficher tous les dossiers</button>' : '') + '</div>'
      + (!prods.length ? '<div class="notice warn">Le mois ' + deMonth(m) + ' n\'a pas encore ses dossiers. ' + (isManager() && missing ? '<button class="btn sm" data-act="generate" data-m="' + m + '">➕ Créer les dossiers du mois</button>' : 'Demandez à l\'administrateur de le générer.') + '</div>' : '')
      // V26.213 : carte de recherche d'un dossier
      + '<div class="card rec-search"><span class="ibox">' + ic('search', 'sm') + '</span><input type="search" data-in="rec-q" value="' + esc(S.recQ || '') + '" placeholder="Rechercher un client…" aria-label="Rechercher un client" autocomplete="off"><span class="small muted" id="rec-qn">' + (R.q ? (waiting.length + got.length) + ' résultat' + (waiting.length + got.length > 1 ? 's' : '') : '') + '</span><button class="btn sm ghost" id="rec-qx" data-act="rec-qx"' + (S.recQ ? '' : ' style="display:none"') + '>' + ic('x', 'sm') + 'Effacer</button></div>'
      + '<div class="grid g2"><div class="card"><div class="card-h"><h2 id="rec-nw">Éléments reçus — à déclarer (' + recCount(waiting.length, R.nW) + ')</h2>'
      + (R.nW ? '<button class="btn sm" data-act="rec-all">Tout cocher</button>' : '') + '</div>'
      + '<div class="rec-list rec-scroll" id="rec-wl" data-keep="rec-wl">' + recWaitHtml(waiting, td) + '</div>'
      + '<div class="sticky-foot"><label class="f" style="flex-direction:row;align-items:center;gap:8px"><span>Reçus le</span><input type="date" data-ch="recdate" value="' + S.recDate + '" style="width:auto"></label><span class="spacer"></span>'
      + '<button class="btn primary rec-ok" data-act="rec-validate" ' + (S.recSel.size && !S.readonly ? '' : 'disabled') + '>' + ic('check', 'sm') + 'Valider (' + S.recSel.size + ')</button></div></div>'
      + '<div class="card"><h2 style="margin-bottom:10px"><span id="rec-ng">Déjà reçus (' + recCount(got.length, R.nG) + ')</span></h2><div class="rec-scroll" id="rec-gl" data-keep="rec-gl">' + recGotHtml(got) + '</div></div></div>';
  }

  /* ---------- Vue DOSSIERS ---------- */
  /* V26.67 : index productions/tâches recalculé une seule fois par rendu (fluidité avec beaucoup de dossiers) */
  function pIdx() {
    const key = S.data.productions.size + '|' + S.data.tasks.size + '|' + (S.lastSync || '') + '|' + (S.idxTick || 0);
    if (S._pIdx) return S._pIdx;
    const prod = new Map(), tasks = new Map();
    for (const p of S.data.productions.values()) prod.set(p.client_id + '|' + p.month, p);
    for (const t of S.data.tasks.values()) { if (!t.production_id) continue; if (!tasks.has(t.production_id)) tasks.set(t.production_id, []); tasks.get(t.production_id).push(t); }
    S._pIdx = { prod, tasks }; return S._pIdx;
  }
  function clientStatus(c, m) {
    const ix = pIdx(), p = ix.prod.get(c.id + '|' + m);
    if (!p) return E.clientApplies(c, m, cfg()) ? '<span class="badge">Pas encore créé</span>' : '<span class="badge">Hors période</span>';
    if (p.status === 'cloture') return '<span class="badge g">✓ Clôturé</span>'; // V26.168 : clôturé sans tâche (« Clôturer le mois »)
    const st = E.productionStatus(p, ix.tasks.get(p.id) || []);
    const cls = { attendu: '', partiel: 'o', recu: 'b', planifie: 'b', en_cours: 'o', termine: 'g' }[st];
    return '<span class="badge ' + cls + '">' + (st === 'partiel' ? '◐ Reçu en partie' + (p.partial_date ? ' le ' + Number(p.partial_date.slice(8)) : '') : st === 'attendu' ? '📅 Attendus le ' + Number((p.expected_date || '').slice(8)) : st === 'termine' ? '✓ Terminé' : '✅ Reçus le ' + Number(p.received_date.slice(8)) + ' · ' + E.STATUS_LABEL[st]) + '</span>';
  }
  /* V26.57 : filtres (fréquence, TVA, priorité, état du mois) et tri par colonne */
  function cMonthState(c) {
    const ix = pIdx(), p = ix.prod.get(c.id + '|' + S.month); if (!p) return 'none';
    const ts = (ix.tasks.get(p.id) || []).filter(t => t.kind !== 'info');
    return ts.length && ts.every(t => t.done) ? 'done' : p.received_date || p.partial_date ? 'recu' : 'attendu';
  }
  function filteredClients() {
    const q = S.clientSearch.trim().toLowerCase(), f = S.cf || {}, so = S.csort || { k: 'name', d: 1 };
    const cs = list('clients').filter(c => (!S.clientCollab || c.collaborator_id === S.clientCollab) && (!q || (c.name || '').toLowerCase().includes(q) || ((collabOf(c.collaborator_id) || {}).name || '').toLowerCase().includes(q))
      && (!f.freq || c.frequency === f.freq) && (!f.reg || (c.vat_regime || 'ca3_mensuel') === f.reg) && (!f.prio || String(c.priority || 2) === f.prio) && (!f.st || cMonthState(c) === f.st));
    const key = { name: c => (c.name || '').toLowerCase(), collab: c => ((collabOf(c.collaborator_id) || {}).name || '').toLowerCase(), freq: c => c.frequency || '', rec: c => Number(c.reception_day) || 99, time: c => E.clientTime(c), tva: c => Number(c.vat_due_day) || 99, prio: c => Number(c.priority) || 2, st: c => ['attendu', 'recu', 'done', 'none'].indexOf(cMonthState(c)) }[so.k] || (c => (c.name || '').toLowerCase());
    return cs.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * so.d || byName(a, b); });
  }
  function clientFilters() {
    const f = S.cf || {}, sel = (k, label, opts) => '<select data-ch="cfilter" data-k="' + k + '" class="' + (f[k] ? 'v2-active' : '') + '" style="width:auto;border-radius:999px"><option value="">' + label + '</option>' + opts.map(o => '<option value="' + o[0] + '"' + (f[k] === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
    const n = Object.values(f).filter(Boolean).length;
    return '<div class="row cfilters" style="margin-bottom:12px;gap:8px;flex-wrap:wrap">' + ic('list', 'sm')
      + sel('freq', 'Toutes fréquences', Object.keys(E.FREQ_LABEL).map(k => [k, E.FREQ_LABEL[k]]))
      + sel('reg', 'Tous régimes TVA', Object.keys(E.VAT_REGIMES).map(k => [k, E.VAT_REGIMES[k]]))
      + sel('prio', 'Toutes priorités', [1, 2, 3].map(k => [String(k), E.PRIORITY_LABEL[k]]))
      + sel('st', 'Tous états (' + fMonth(S.month) + ')', [['attendu', 'Pièces attendues'], ['recu', 'Reçus, en production'], ['done', 'Terminés'], ['none', 'Sans dossier ce mois']])
      + (n ? '<button class="btn sm" data-act="cfilter-reset">Effacer les filtres (' + n + ')</button>' : '') + '</div>';
  }  function vClients() {
    return '<div class="row" style="margin-bottom:16px"><div class="search-box" style="max-width:360px">' + ic('search', 'sm') + '<input type="search" placeholder="Rechercher un client ou un collaborateur…" data-in="csearch" value="' + esc(S.clientSearch) + '"></div>'

      + '<span class="spacer"></span>' + monthNav() + (S.readonly ? '' : '<button class="btn" data-act="import">' + ic('download', 'sm') + (canCreateDossiers() ? 'Importer Excel' : 'Importer mes dossiers') + '</button>') + (canCreateDossiers() ? '<button class="btn dark" data-act="client-new">' + ic('plus', 'sm') + 'Dossier</button>' : '') + '</div>'
      + (Object.values(S.cf || {}).some(Boolean) || S.clientCollab ? '<div class="row" style="margin:-4px 0 10px"><button class="btn sm" data-act="cfilter-reset">Effacer les filtres</button></div>' : '') + inactiveNotice() + '<div class="only-m">' + clientFilters() + '</div><div class="card" id="results">' + clientsTable() + '</div>';
  }
  /* V26.64 : filtres intégrés dans l'en-tête du tableau (tri au clic sur le titre) */
  function clientHead() {
    const so = S.csort || { k: 'name', d: 1 }, f = S.cf || {};
    const opt = (list0) => list0.map(o => [o[0], o[1]]);
    const cols = [
      ['name', 'Client', '', null],
      ['collab', 'Collaborateur', '', { cur: S.clientCollab, opts: opt(collabs(true).map(c => [c.id, c.name])) }],
      ['freq', 'Fréquence', '', { key: 'freq', cur: f.freq, opts: Object.keys(E.FREQ_LABEL).map(k => [k, E.FREQ_LABEL[k]]) }],
      ['rec', 'Réception', '', null],
      ['time', 'Temps', 'num', null],
      ['tva', 'TVA', '', { key: 'reg', cur: f.reg, opts: Object.keys(E.VAT_REGIMES).map(k => [k, E.VAT_REGIMES[k]]) }],
      ['prio', 'Priorité', '', { key: 'prio', cur: f.prio, opts: [1, 2, 3].map(k => [String(k), E.PRIORITY_LABEL[k]]) }],
      ['st', fMonth(S.month), 'cap', { key: 'st', cur: f.st, opts: [['attendu', 'Pièces attendues'], ['recu', 'Reçus, en production'], ['done', 'Terminés'], ['none', 'Sans dossier ce mois']] }]
    ];
    return cols.map(c => {
      const flt = c[3], active = flt && flt.cur, lbl = active ? (flt.opts.find(o => o[0] === flt.cur) || [0, ''])[1] : '';
      const open = S.thMenu === c[0];
      const pop = open ? '<div class="th-pop" role="menu">'
        + '<button data-act="th-sort" data-k="' + c[0] + '" data-d="1" class="' + (so.k === c[0] && so.d > 0 ? 'sel' : '') + '">↑ Trier ' + (c[0] === 'time' || c[0] === 'rec' ? 'croissant' : 'de A à Z') + '</button>'
        + '<button data-act="th-sort" data-k="' + c[0] + '" data-d="-1" class="' + (so.k === c[0] && so.d < 0 ? 'sel' : '') + '">↓ Trier ' + (c[0] === 'time' || c[0] === 'rec' ? 'décroissant' : 'de Z à A') + '</button>'
        + (flt ? '<div class="th-sep"></div><div class="th-cap">Filtrer</div><button data-act="th-pick" data-k="' + c[0] + '" data-v="" class="' + (!flt.cur ? 'sel' : '') + '">Tous</button>' + flt.opts.map(o => '<button data-act="th-pick" data-k="' + c[0] + '" data-v="' + esc(o[0]) + '" class="' + (flt.cur === o[0] ? 'sel' : '') + '">' + esc(o[1]) + '</button>').join('') : '') + '</div>' : '';
      return '<th class="' + c[2] + (so.k === c[0] ? ' on' : '') + (active ? ' flt' : '') + '"><button class="th-b" data-act="th-menu" data-k="' + c[0] + '" aria-haspopup="menu" aria-expanded="' + open + '">' + esc(c[1]) + (so.k === c[0] ? (so.d > 0 ? ' ↑' : ' ↓') : '') + (active ? '<span class="th-chip">' + esc(lbl) + '</span>' : '') + '<svg class="th-caret" viewBox="0 0 24 24" width="12" height="12"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' + pop + '</th>';
    }).join('');
  }  function clientsTable() { S._pIdx = null;
    const cs = filteredClients();
    if (!cs.length) return '<div class="empty">Aucun dossier.' + (isManager() ? ' Importez votre fichier Excel ou ajoutez un dossier.' : '') + '</div>';
    const tot = cs.filter(c => c.active !== false).reduce((s, c) => s + E.clientTime(c), 0);
    return '<div class="row small muted" style="margin-bottom:8px"><span>' + cs.length + ' dossier' + (cs.length > 1 ? 's' : '') + '</span><span>·</span><span>' + E.fmtMin(tot) + ' de production par mois (dossiers actifs)</span></div>'
      + '<div class="scroll-x"><table class="t stack ct"><thead><tr>' + clientHead() + '</tr></thead><tbody>'
      + cs.map(c => { const co = collabOf(c.collaborator_id); return '<tr class="click' + (c.active === false ? ' row-off' : '') + '" data-act="client" data-id="' + c.id + '"' + (c.active === false ? ' title="Dossier inactif : exclu de la planification"' : '') + '><td class="first">' + (c.active === false ? '<s>' : '') + esc(c.name) + (c.active === false ? '</s>' : '') + (c.notes ? ' <span class="muted" title="' + esc(c.notes) + '">' + ic('list', 'sm') + '</span>' : '') + '</td><td data-l="Collaborateur">' + esc(co ? co.name : '—') + '</td><td data-l="Fréquence">' + (E.FREQ_LABEL[c.frequency] || '') + '</td><td data-l="Réception" class="nowrap">' + (c.reception_day ? 'le ' + c.reception_day : '—') + '</td>'
        + '<td class="num" data-l="Temps"><b>' + E.fmtMin(E.clientTime(c)) + '</b></td><td data-l="TVA"><span class="nowrap">' + E.VAT_REGIMES[c.vat_regime || 'ca3_mensuel'] + (c.vat_due_day && (c.vat_regime || 'ca3_mensuel') !== 'aucun' ? ' · le ' + c.vat_due_day : '') + '</span>' + (c.deb ? ' <span class="badge b">DEB</span>' : '') + (c.des ? ' <span class="badge b">DES</span>' : '') + '</td><td data-l="Priorité" class="nowrap"><span class="prio p' + (c.priority || 2) + '"><i></i><i></i><i></i></span> ' + (E.PRIORITY_LABEL[c.priority] || '') + '</td><td data-l="Statut">' + clientStatus(c, S.month) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }

  /* ---------- Vue RECHERCHE ---------- */
  function vSearch() {
    const f = S.filters, sel = (k, opts) => '<select data-ch="filter" data-k="' + k + '" style="width:auto">' + opts.map(o => '<option value="' + o[0] + '"' + (String(f[k]) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
    return '<div class="card"><div class="row"><input type="search" placeholder="Client, collaborateur ou mission (tenue, lettrage, TVA)…" data-in="search" value="' + esc(S.search) + '" style="flex:1;min-width:220px"></div>'
      + '<div class="row" style="margin-top:10px">' + sel('period', [['today', "Aujourd'hui"], ['week', 'Cette semaine'], ['month', 'Mois (' + fMonth(S.month) + ')'], ['all', 'Tout']])
      + sel('collab', [['', 'Tous les collaborateurs']].concat(collabs(true).filter(c => canSeeCollab(c.id)).map(c => [c.id, esc(c.name)])))
      + sel('status', [['', 'Tous statuts'], ['todo', 'À faire'], ['done', 'Terminées'], ['locked', 'Verrouillées'], ['unplanned', 'Non planifiées']])
      + sel('reception', [['', 'Réception : toutes'], ['recu', 'Éléments reçus'], ['attendu', 'Éléments attendus']])
      + sel('kind', [['', 'Tous types'], ['production', 'Production'], ['info', 'Demandes d\'infos']])
      + '<label class="cb"><input type="checkbox" data-ch="filter" data-k="late"' + (f.late ? ' checked' : '') + '> À reprendre</label><span class="spacer"></span><button class="btn sm" data-act="search-csv">⬇ CSV</button></div></div>'
      + inactiveNotice() + '<div class="only-m">' + clientFilters() + '</div><div class="card" id="results">' + searchResults() + '</div>';
  }
  function searchTasks() {
    const f = S.filters, td = today(), q = S.search.trim().toLowerCase(), ws = E.startOfWeek(td), we = E.addDays(ws, 6);
    return list('tasks').filter(t => {
      if (!canSeeCollab(t.collaborator_id)) return false;
      if (f.period === 'today' && !E.onDay(t, td)) return false;
      if (f.period === 'week' && !(t.planned_date >= ws && t.planned_date <= we)) return false;
      if (f.period === 'month' && t.month !== S.month) return false;
      if (f.collab && t.collaborator_id !== f.collab) return false;
      if (f.status === 'todo' && t.done) return false;
      if (f.status === 'done' && !t.done) return false;
      if (f.status === 'locked' && !t.locked) return false;
      if (f.status === 'unplanned' && (t.done || t.planned_date)) return false;
      if (f.kind && t.kind !== f.kind) return false;
      const p = S.data.productions.get(t.production_id);
      if (f.reception === 'recu' && !(p && p.received_date)) return false;
      if (f.reception === 'attendu' && (p && p.received_date)) return false;
      if (f.late && !(!t.done && ((t.planned_date && E.endDate(t) < td) || (t.due_date && t.due_date < td) || (t.planned_date && t.due_date && E.endDate(t) > t.due_date)))) return false;
      if (q) { const hay = ((clientOf(t.client_id) || {}).name + ' ' + ((collabOf(t.collaborator_id) || {}).name || '') + ' ' + E.KIND_LABEL[t.kind] + ' ' + t.kind).toLowerCase(); if (!hay.includes(q)) return false; }
      return true;
    }).sort((a, b) => (a.planned_date || '9').localeCompare(b.planned_date || '9') || (a.seq - b.seq));
  }
  function searchResults() {
    const ts = searchTasks();
    const tot = ts.reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
    return '<div class="small muted" style="margin-bottom:8px">' + ts.length + ' tâche(s) · ' + E.fmtMin(tot) + '</div>' + (ts.length ? '<div class="tasks">' + ts.slice(0, 300).map(t => taskRow(t, { showDate: true, showCollab: true })).join('') + '</div>' + (ts.length > 300 ? '<p class="muted small">300 premières affichées — affinez la recherche.</p>' : '') : '<div class="empty">Aucun résultat.</div>');
  }

  /* V26.197 : demandes d'informations — bandeau discret sur Aujourd'hui (toutes les vues), un clic ouvre la liste */
  function irProds(ids) {
    const m = today().slice(0, 7), set = new Set(ids.filter(Boolean));
    return list('productions').filter(p => p.month === m && clientOf(p.client_id) && set.has(clientOf(p.client_id).collaborator_id));
  }
  // une demande est « à faire » si elle est notée ainsi ou si sa tâche « Demande d'infos » n'est pas terminée (même règle que le Planning)
  function irState(p) { if (p.info_request === 'a_faire' || list('tasks').some(t => t.kind === 'info' && t.production_id === p.id && !t.done)) return 'a_faire'; return p.info_request || 'none'; }
  function irStrip(ids) {
    const ps = irProds(ids); if (!ps.length) return '';
    const n = { faite: 0, a_faire: 0, non: 0, none: 0 }; ps.forEach(p => n[irState(p)]++);
    return '<button class="ir-strip anim-in' + (n.a_faire ? ' todo' : '') + '" data-act="ir-list" data-ids="' + ids.filter(Boolean).join(',') + '" aria-label="Voir la liste des demandes d\'informations">'
      + '<span class="ir-i">' + ic('mail', 'sm') + '</span><b>Demandes d\'informations</b>'
      + '<span class="ir-n ' + (n.a_faire ? 'o' : 'g') + '">' + (n.a_faire ? n.a_faire + ' à faire' : 'Rien à envoyer') + '</span>'
      + '<span class="ir-m">' + n.faite + ' faite' + (n.faite > 1 ? 's' : '') + ' · ' + n.non + ' non nécessaire' + (n.non > 1 ? 's' : '') + ' · ' + n.none + ' non renseignée' + (n.none > 1 ? 's' : '') + '</span>' + ic('chevR', 'sm') + '</button>';
  }
  function sheetIrList(s) {
    const ps = irProds(s.ids || []), by = k => ps.filter(p => irState(p) === k).sort((a, b) => ((clientOf(a.client_id) || {}).name || '').localeCompare((clientOf(b.client_id) || {}).name || '', 'fr'));
    const row = (p, act) => { const c = clientOf(p.client_id), co = collabOf(c.collaborator_id); return '<div class="info-row"><span class="ibox ' + (act ? 'o' : 'g') + '">' + ic(act ? 'mail' : 'check', 'sm') + '</span><div class="t" data-act="client" data-id="' + c.id + '" style="cursor:pointer"><b>' + esc(c.name) + '</b><span>' + esc(co ? co.name : '—') + (p.info_request_at ? ' · ' + (act ? 'signalée' : 'faite') + ' le ' + fDM(p.info_request_at.slice(0, 10)) : '') + '</span></div>' + (act ? '<button class="btn sm" data-act="ir" data-pid="' + p.id + '" data-v="faite"' + (S.readonly ? ' disabled' : '') + '>' + ic('check', 'sm') + 'Faite</button>' : '') + '</div>'; };
    const todo = by('a_faire'), done = by('faite');
    return sheetHead('Demandes d\'informations — ' + fMonth(today().slice(0, 7)), todo.length + ' à faire · ' + done.length + ' faite' + (done.length > 1 ? 's' : '') + ' · ' + by('non').length + ' non nécessaire(s) · ' + by('none').length + ' non renseignée(s)')
      + '<div class="sheet-b"><h3 style="margin:0 0 8px">À faire</h3>' + (todo.length ? '<div class="tasks">' + todo.map(p => row(p, true)).join('') + '</div>' : '<div class="empty">Aucune demande en attente.</div>')
      + (done.length ? '<h3 style="margin:18px 0 8px">Faites</h3><div class="tasks">' + done.map(p => row(p, false)).join('') + '</div>' : '')
      + '<p class="small muted" style="margin-top:14px">Une demande se renseigne depuis la fiche du dossier (clic sur son nom) ou la fiche d\'une tâche.</p></div><div class="sheet-f"><button class="btn" data-act="close">Fermer</button></div>';
  }
  /* Suivi des demandes d'informations du mois (tableau de bord) */
  function irDashboard(m) {
    const prods = list('productions').filter(p => p.month === m && clientOf(p.client_id));
    const n = { faite: 0, a_faire: 0, non: 0, none: 0 };
    prods.forEach(p => n[p.info_request || 'none']++);
    const tot = prods.length || 1;
    const todo = prods.filter(p => p.info_request === 'a_faire').sort((a, b) => ((clientOf(a.client_id) || {}).name || '').localeCompare((clientOf(b.client_id) || {}).name || '', 'fr'));
    const cell = (k, lab, color) => '<div>' + '<span style="display:inline-flex;align-items:center;gap:6px"><i class="lg-sw" style="background:' + color + '"></i>' + lab + '</span><b data-count="' + n[k] + '" data-fmt="int" data-key="ir' + k + m + '">' + n[k] + '</b></div>';
    const seg = [['faite', 'var(--ok)'], ['a_faire', 'var(--warn)'], ['non', 'var(--ink)'], ['none', 'var(--track)']].map(s => n[s[0]] ? '<i style="width:' + (n[s[0]] / tot * 100).toFixed(1) + '%;background:' + s[1] + '"></i>' : '').join('');
    return '<div class="section-t"><h2>Demandes d\'informations</h2><span class="muted small">' + prods.length + ' dossier' + (prods.length > 1 ? 's' : '') + ' ce mois</span></div>'
      + '<div class="split">'
      + '<div class="card anim-in"><div class="card-h"><h2>Suivi du mois</h2><span class="badge ' + (n.a_faire ? 'o' : 'g') + '">' + (n.a_faire ? n.a_faire + ' à faire' : 'Rien à envoyer') + '</span></div>'
      + '<div class="segbar">' + seg + '</div>'
      + '<div class="ratios" style="grid-template-columns:repeat(4,minmax(0,1fr))">' + cell('a_faire', 'À faire', 'var(--warn)') + cell('faite', 'Faites', 'var(--ok)') + cell('non', 'Non nécessaires', 'var(--ink)') + cell('none', 'Non renseignées', 'var(--track)') + '</div></div>'
      + '<div class="frame anim-in"><div class="frame-h">' + ic('mail') + '<h2>Demandes à faire</h2>' + (todo.length ? '<span class="badge o">' + todo.length + '</span>' : '') + '</div><div class="inner">'
      + (todo.length ? '<div class="tasks">' + todo.slice(0, 12).map(p => { const c = clientOf(p.client_id), co = collabOf(c.collaborator_id); return '<div class="info-row"><span class="ibox o">' + ic('mail', 'sm') + '</span><div class="t" data-act="client" data-id="' + c.id + '" style="cursor:pointer"><b>' + esc(c.name) + '</b><span>' + esc(co ? co.name : '—') + (p.info_request_at ? ' · signalée le ' + fDM(p.info_request_at.slice(0, 10)) : '') + '</span></div><button class="btn sm" data-act="ir" data-pid="' + p.id + '" data-v="faite"' + (S.readonly ? ' disabled' : '') + '>' + ic('check', 'sm') + 'Marquer faite</button></div>'; }).join('') + '</div>' + (todo.length > 12 ? '<p class="small muted" style="margin-top:8px">+ ' + (todo.length - 12) + ' autre(s)</p>' : '')
        : '<div class="empty">Aucune demande en attente.</div>')
      + '</div></div></div>';
  }

