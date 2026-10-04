  /* ====================== V26.186 : Planning « cockpit » de l'équipe ======================
   * Vue d'ensemble journalière (et hebdomadaire) de toute l'équipe, construite uniquement sur les données existantes :
   *  - tâches (dayTasks), heures affichées (withTimes : enchaînement depuis « day_start », comme avant), durées (minutesOn) ;
   *  - capacité quotidienne des collaborateurs (capacityOn : horaires, absences, fériés, jours d'école) ;
   *  - statuts existants : terminée (done), éléments attendus (prévisionnel), à reprendre / en retard, verrouillée ;
   *  - « en cours » n'est pas un statut enregistré : c'est la tâche placée sous la ligne de l'heure actuelle, aujourd'hui.
   * Aucune donnée, aucune règle métier nouvelles : le glisser-déposer, la fiche de la tâche et la replanification sont ceux de l'outil.
   * Couleurs : 3 états de remplissage propres au planning (< 90 % disponible, 90–100 % pleine, > 100 % au-delà) ;
   * les phrases d'alerte (« surcharge ») restent réservées au manager et au seuil ALERT_PCT (108 %). */
  const PC = { H0: 8 * 60, H1: 18 * 60, timer: 0 };
  const PC_TVA = ['CA3', 'CA12', 'ACPT'];
  const PC_KIND = { rc: 'Responsable client', collab: 'Collaborateur', apprenti: 'Apprenti' };
  const PC_ST = { done: 'Terminée', late: 'En retard', now: 'En cours', recv: 'À recevoir', todo: 'Planifiée' };
  const pcNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const pcCap1 = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  const pcNorm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function pcInit() {
    if (!S.pf) S.pf = { kind: '', client: '', status: '', q: '' };
    if (S.planAll === undefined) S.planAll = visibleCollabs().length > 1;
    if (S.planAll && visibleCollabs().length < 2) S.planAll = false;
    if (!S.planAll && !(collabOf(S.collabId) && canSeeCollab(S.collabId))) S.collabId = (canSeeCollab(S.me.collaborator_id) && S.me.collaborator_id) || (visibleCollabs()[0] || {}).id || null;
    S._pcOb = new Map();
  }
  /* Personnes affichées : toute l'équipe visible, ou une seule personne */
  // V26.192 : une personne seule (collaborateur, apprenti) a la même organisation que le RC : semaine en grille, mois en frise
  const pcSolo = () => visibleCollabs().length < 2;
  const pcScope = () => S.planAll ? visibleCollabs() : [collabOf(S.collabId)].filter(Boolean);

  /* Type de tâche (existant) : la tâche « production » est la tenue du dossier ; la TVA du mois vient du régime de TVA du dossier */
  function pcType(t) {
    if (t.kind === 'info') return { k: 'info', label: 'Demande' };
    if (t.kind === 'dashboard') return { k: 'dash', label: 'Tableau de bord' };
    if (t.kind === 'tva') return { k: 'tva', label: 'TVA' };
    return { k: 'tenue', label: t.kind === 'lettrage' ? 'Lettrage' : 'Tenue' };
  }
  function pcTva(t) {
    if (t.kind === 'tva') return true;
    if (t.kind !== 'production' && t.kind !== 'tenue') return false;
    const key = t.client_id + '|' + t.month;
    if (S._pcOb && S._pcOb.has(key)) return S._pcOb.get(key);
    const c = clientOf(t.client_id), v = !!(c && t.month && E.obligations(c, t.month, cfg()).some(o => PC_TVA.includes(o.code)));
    if (S._pcOb) S._pcOb.set(key, v);
    return v;
  }
  /* Statut affiché, à partir des statuts existants (aucun statut parallèle enregistré) */
  function pcState(t, date, slot) {
    const td = today(), p = S.data.productions.get(t.production_id), end = E.endDate(t);
    const st = { done: !!t.done, recv: !t.done && !!(p && !E.isReceived(t, p) && t.kind !== 'info'), late: !t.done && ((!!end && end < td) || (!!t.due_date && t.due_date < td)), now: false };
    if (!t.done && slot && date === td) { const n = pcNow(); st.now = n >= slot.a && n < slot.b; }
    st.key = st.done ? 'done' : st.late ? 'late' : st.now ? 'now' : st.recv ? 'recv' : 'todo';
    return st;
  }
  function pcMatch(t, st) {
    const f = S.pf;
    if (f.kind && (f.kind === 'tva' ? !pcTva(t) : pcType(t).k !== f.kind)) return false;
    if (f.client && t.client_id !== f.client) return false;
    if (f.status && (f.status === 'todo' ? st.done : !st[f.status])) return false;
    if (f.q) { const c = clientOf(t.client_id) || {}; if (!pcNorm(c.name + ' ' + pcType(t).label + (pcTva(t) ? ' tva' : '')).includes(pcNorm(f.q.trim()))) return false; }
    return true;
  }
  const pcFiltered = () => !!(S.pf.kind || S.pf.client || S.pf.status || S.pf.q);

  /* Remplissage : barre graphique à 3 états, sans pourcentage */
  function pcFill(total, cap) {
    if (cap <= 0) return { cls: total > 0 ? 'over' : 'off', pct: total > 0 ? 100 : 0, txt: total > 0 ? '+' + E.fmtMin(total) + ' hors jour travaillé' : '' };
    const pct = total / cap * 100, cls = pct > 100 ? 'over' : pct >= 90 ? 'full' : 'ok', free = cap - total;
    const txt = free > 0 ? E.fmtMin(free) + (free === 60 ? ' disponible' : ' disponibles') : free === 0 ? 'Journée complète'
      : '+' + E.fmtMin(-free) + (overAlert(total, cap) ? (isManager() ? ' de surcharge' : ' au-delà de la capacité') : ' au-delà');
    return { cls, pct: Math.min(100, pct), txt };
  }
  const pcBar = (f, thin) => '<span class="pc-bar' + (thin ? ' thin' : '') + ' f-' + f.cls + '"><i style="width:' + f.pct.toFixed(1) + '%"></i></span>';

  /* ---------- Listes (reprend les filtres rapides de l'outil, pour toute l'équipe affichée) ---------- */
  function pcSets(cs, m) {
    const out = { unpl: [], late: [], recv: [], info: [], done: [], tvatodo: [], tvasent: [] }, ids = new Set(cs.map(c => c.id)), td = today();
    cs.forEach(c => { const q = quickSets(c.id, m); Object.keys(out).forEach(k => out[k].push(...q[k])); });
    if (isAdmin() && S.planAll) out.unpl.push(...list('tasks').filter(t => t.month === m && !t.collaborator_id && !t.done && t.kind !== 'info')); // dossier sans collaborateur
    const open = list('tasks').filter(t => ids.has(t.collaborator_id) && !t.done);
    out.today = open.filter(t => E.onDay(t, td));
    out.soon = open.filter(t => t.kind !== 'info' && t.due_date && t.due_date >= td && E.daysBetween(td, t.due_date) <= cfg().due_soon_days).sort((a, b) => a.due_date.localeCompare(b.due_date));
    return out;
  }
  const PC_LISTS = { today: ['À traiter aujourd\'hui', 'clock', 'r'], soon: ['Échéances proches', 'flag', 'o'] };
  function pcListFrame(sets, m) {
    const k = S.quick; if (!k || !sets[k]) return '';
    const q = QUICK.find(d => d[0] === k), def = PC_LISTS[k] || (q && [q[1], q[2], q[3]]); if (!def) return '';
    const ts = sets[k], title = k === 'done' ? 'Terminées · ' + fMonth(m) : k === 'unpl' ? 'Tâches à affecter · ' + fMonth(m) : def[0];
    return '<div class="frame pc-frame anim-in no-print"><div class="frame-h">' + ic(def[1]) + '<h2>' + esc(title) + '</h2><span class="badge ' + def[2] + '">' + ts.length + '</span><button class="x" data-act="quick" data-q="' + k + '" aria-label="Fermer la liste">' + ic('x', 'sm') + '</button></div><div class="inner">'
      + (k === 'unpl' && ts.length ? '<p class="small" style="margin:0 0 10px">' + unplWhy(ts, m) + '</p>' : QUICK_TIP[k] ? '<p class="small muted" style="margin:0 0 10px">' + esc(QUICK_TIP[k]) + '</p>' : '')
      + (ts.length ? '<div class="tasks">' + ts.slice(0, 60).map(t => taskRow(t, { showDate: true, showCollab: S.planAll, swipe: false, drag: k === 'unpl' || k === 'late' })).join('') + '</div>' + (ts.length > 60 ? '<p class="small muted">+ ' + (ts.length - 60) + ' autre(s)</p>' : '') : '<div class="empty">Rien à signaler.</div>') + '</div></div>';
  }

  /* ---------- En-tête : 4 indicateurs, puis la date ---------- */
  function pcKpis(sets) {
    const k = (id, label, n, tone, sub) => '<button class="pc-kpi' + (S.quick === id ? ' on' : '') + '" data-act="quick" data-q="' + id + '" title="' + esc(QUICK_TIP[id] || label) + '"><span class="pc-kpi-l">' + label + '</span><span class="pc-kpi-v"><i class="pc-dot ' + (n ? tone : 'z') + '"></i><b class="' + (n ? tone : 'z') + '" data-count="' + n + '" data-key="pck-' + id + '">' + n + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></button>';
    return '<div class="pc-kpis no-print">' + k('today', 'À traiter aujourd\'hui', sets.today.length, 'r') + k('late', 'En retard', sets.late.length, 'r') + k('recv', 'À recevoir', sets.recv.length, 'o') + k('done', 'Terminé', sets.done.length, 'g', 'ce mois') + '</div>';
  }
  function pcDateLabel() {
    if (S.planMode === 'day') return pcCap1(fDate(S.cursor)) + ' ' + S.cursor.slice(0, 4);
    if (S.planMode === 'week') { const a = E.startOfWeek(S.cursor), b = E.addDays(a, 4); return 'Lun ' + Number(a.slice(8)) + (a.slice(5, 7) !== b.slice(5, 7) ? ' ' + fMonth(a.slice(0, 7)).split(' ')[0] : '') + ' → Ven ' + Number(b.slice(8)) + ' ' + fMonth(b.slice(0, 7)); }
    return pcCap1(fMonth(S.cursor.slice(0, 7)));
  }
  function pcToolbar(m) {
    const mode = S.planMode === 'month' ? 'pmonth' : S.planMode, td = today();
    const isNow = S.planMode === 'day' ? S.cursor === td : S.planMode === 'week' ? E.startOfWeek(S.cursor) === E.startOfWeek(td) : S.cursor.slice(0, 7) === td.slice(0, 7);
    const missing = isManager() ? missingForMonth(m) : 0;
    return '<div class="pc-top no-print"><div class="pc-nav"><button class="pc-arrow" data-act="nav" data-d="-1" aria-label="Précédent"' + (prevBlocked(mode) ? ' disabled' : '') + '>' + ic('chevL', 'sm') + '</button>'
      + '<div class="pc-date"><b>' + esc(pcDateLabel()) + '</b>' + (isNow ? '<span class="pc-now-pill">' + (S.planMode === 'day' ? 'Aujourd\'hui' : S.planMode === 'week' ? 'Cette semaine' : 'Ce mois-ci') + '</span>' : '') + '</div>'
      + '<button class="pc-arrow" data-act="nav" data-d="1" aria-label="Suivant">' + ic('chevR', 'sm') + '</button>' + (isNow ? '' : '<button class="btn sm" data-act="nav" data-d="0">Aujourd\'hui</button>') + '</div>'
      + '<div class="seg pc-seg">' + [['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois']].map(x => '<button class="' + (S.planMode === x[0] ? 'on' : '') + '" data-act="pmode" data-m="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>'
      + '<span class="spacer"></span><div class="pc-actions">'
      + (missing ? '<button class="btn sm" data-act="generate" data-m="' + m + '" title="Crée la production ' + deMonth(m) + ' pour les dossiers qui n\'y figurent pas encore, puis les planifie">' + ic('plus', 'sm') + 'Créer les dossiers du mois (' + missing + ')</button>' : '')
      + (canReplan() ? '<button class="btn sm pc-opt" data-act="replan" data-m="' + m + '" data-opt="1" title="Propose des déplacements pour soulager les journées trop remplies — rien ne bouge sans votre validation">' + ic('sparkle', 'sm') + 'Optimiser le planning</button>' : '')
      + '<button class="btn sm icon-l hide-m" data-act="print" title="Imprimer ou enregistrer en PDF">' + ic('download', 'sm') + 'PDF</button></div></div>';
  }
  function pcFilters(m) {
    const cs = visibleCollabs(), f = S.pf;
    const ids = new Set(pcScope().map(c => c.id));
    const cls = [...new Set(list('tasks').filter(t => t.month === m && (ids.has(t.collaborator_id) || (!t.collaborator_id && isAdmin()))).map(t => t.client_id))].map(clientOf).filter(Boolean).sort(byName);
    if (f.client && !cls.some(c => c.id === f.client)) { const c = clientOf(f.client); if (c) cls.unshift(c); }
    const sel = (k, cur, opts, all) => '<select class="pc-sel' + (cur ? ' v2-active' : '') + '" data-ch="pc-f" data-k="' + k + '" aria-label="' + all + '"><option value="">' + all + '</option>' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    const who = cs.length > 1 ? '<select class="pc-sel pc-who-sel' + (S.planAll ? '' : ' v2-active') + '" data-ch="pc-who" aria-label="Collaborateurs"><option value="">Toute l\'équipe (' + cs.length + ')</option>' + cs.map(c => '<option value="' + c.id + '"' + (!S.planAll && S.collabId === c.id ? ' selected' : '') + '>' + esc(c.name) + (c.id === S.me.collaborator_id ? ' (moi)' : '') + '</option>').join('') + '</select>' : '';
    return '<div class="pc-filters no-print" data-keep="pc-filters">' + who
      + sel('client', f.client, cls.map(c => [c.id, c.name]), 'Tous les dossiers')
      + sel('status', f.status, [['todo', 'À faire'], ['now', 'En cours'], ['late', 'En retard'], ['recv', 'À recevoir'], ['done', 'Terminées']], 'Tous les statuts')
      + '<label class="pc-search">' + ic('search', 'sm') + '<input type="search" data-in="pc-q" placeholder="Rechercher un dossier" value="' + esc(f.q) + '" aria-label="Rechercher un dossier"></label>'
      + (pcFiltered() ? '<button class="btn sm ghost" data-act="pc-reset">Effacer les filtres</button>' : '') + '</div>';
  }
  const pcLegend = () => '<div class="pc-legend no-print"><span><i class="t-tenue"></i>Tenue</span><span><i class="t-tva"></i>TVA du mois</span><span><i class="t-info"></i>Demande</span><span class="sep"></span><span><i class="s-now"></i>En cours</span><span><i class="s-recv"></i>À recevoir</span><span><i class="s-late"></i>En retard</span><span><i class="s-done"></i>Terminée</span></div>';

  /* ---------- Cartes de tâche ---------- */
  function pcTip(t, st, slot, date) {
    const c = clientOf(t.client_id) || { name: '?' }, co = collabOf(t.collaborator_id), ob = c.id && t.month ? E.obligations(c, t.month, cfg()).filter(o => PC_TVA.includes(o.code)) : [];
    return [c.name, pcType(t).label + (ob.length ? ' + TVA ' + ob.map(o => o.code + ' (éch. ' + fDM(o.due) + ')').join(', ') : ''),
      slot ? E.fmtClock(slot.a) + ' → ' + E.fmtClock(slot.b) + ' (' + E.fmtMin(slot.b - slot.a) + ')' : durLabel(t, date),
      co ? co.name : 'Sans collaborateur', PC_ST[st.key] + (st.recv && st.key !== 'recv' ? ' · éléments attendus' : ''),
      !t.done && t.due_date ? 'Échéance ' + fDM(t.due_date) : '', t.locked ? 'Verrouillée : la replanification ne la déplace pas' : '', 'Cliquer pour ouvrir la fiche'].filter(Boolean).join('\n');
  }
  const pcDrag = t => canEditTask(t) && !t.locked && !t.done && !S.readonly ? ' draggable="true" data-drag="' + t.id + '"' : '';
  const pcStDot = st => '<i class="pc-st s-' + st.key + '"' + (st.key === 'done' ? '>' + CHECK_SVG + '</i>' : '></i>');
  /* Bloc de la frise du jour : largeur = durée (30 min = moitié d'une heure) */
  function pcBlock(it, d, h0, span) {
    const t = it.t, c = clientOf(t.client_id) || { name: '?' }, ty = pcType(t), tva = pcTva(t), st = pcState(t, d, it), m = it.b - it.a;
    const l = (it.a - h0) / span * 100, w = Math.max(m, 4) / span * 100;
    return '<div class="pc-blk t-' + (ty.k === 'tenue' && tva ? 'tenue tv' : ty.k) + ' s-' + st.key + (st.recv ? ' fc' : '') + (t.locked ? ' lk' : '') + (m < 25 ? ' xs xxs' : m < 45 ? ' xs' : m < 80 ? ' sm' : '') + (S.flash.has(t.id) ? ' flash' : '') + (t._unsaved ? ' unsaved' : '') + (t._failed ? ' failed' : '')
      + '" style="left:calc(' + l.toFixed(3) + '% + 2px);width:calc(' + w.toFixed(3) + '% - 4px)" role="button" tabindex="0" data-act="task" data-id="' + t.id + '" data-date="' + d + '" data-a="' + it.a + '" data-b="' + it.b + '"' + pcDrag(t) + ' title="' + esc(pcTip(t, st, it, d)) + '">'
      + '<div class="pc-blk-k"><span>' + ty.label + '</span>' + (tva && ty.k === 'tenue' ? '<em>TVA</em>' : '') + pcStDot(st) + '</div>'
      + (m < 25 ? '<span class="pc-blk-i">' + (t.kind === 'info' ? ic('mail', 'sm') : '') + '</span>' : '') + '<div class="pc-blk-n">' + esc(c.name) + '</div>'
      + '<div class="pc-blk-d">' + (st.key === 'now' ? '<b>En cours</b> · ' : '') + durLabel(t, d, true) + '</div></div>';
  }
  /* Carte compacte (semaine, tâches à affecter) : 2 lignes, sans cadenas */
  function pcCard(t, d, o) {
    o = o || {};
    const c = clientOf(t.client_id) || { name: '?' }, ty = pcType(t), tva = pcTva(t), st = pcState(t, d, null), td = today();
    const due = !t.done && t.due_date && (st.late || E.daysBetween(td, t.due_date) <= cfg().due_soon_days) ? '<div class="pc-card-d' + (t.due_date < td ? ' bad' : '') + '">Échéance ' + Number(t.due_date.slice(8)) + '/' + t.due_date.slice(5, 7) + '</div>' : '';
    return '<div class="pc-card t-' + (ty.k === 'tenue' && tva ? 'tenue tv' : ty.k) + ' s-' + st.key + (st.recv ? ' fc' : '') + (S.flash.has(t.id) ? ' flash' : '') + (t._unsaved ? ' unsaved' : '') + (t._failed ? ' failed' : '') + '" role="button" tabindex="0" data-act="task" data-id="' + t.id + '"' + pcDrag(t) + ' title="' + esc(pcTip(t, st, null, d)) + '">'
      + '<div class="pc-card-n">' + esc(c.name) + '</div>'
      + '<div class="pc-card-m"><span>' + (d ? durLabel(t, d, true) : E.fmtMin(t.duration_min)) + '</span><span class="dotsep">·</span><span class="pc-k">' + ty.label + '</span>' + (tva && ty.k === 'tenue' ? '<em>TVA</em>' : '') + (o.who ? '<span class="dotsep">·</span><span class="pc-who-s">' + esc((collabOf(t.collaborator_id) || {}).name || 'Sans collaborateur') + '</span>' : '') + pcStDot(st) + '</div>' + due + '</div>';
  }
  const pcAv = c => '<span class="pc-av" style="--c:' + esc(c.color || '#8a8f98') + '">' + esc(initials(c.name)) + '</span>';

  /* ---------- Vue Jour : frise horaire de l'équipe ---------- */
  function pcDay(d, sets, m) {
    const x = ctx(), td = today(), st0 = E.parseClock(cfg().day_start), all = list('tasks');
    const rows = pcScope().map(c => {
      const items = withTimes(dayTasks(c.id, d), d).map(it => { const a = E.parseClock(it.time), mm = E.minutesOn(it.t, d) || 0; return { t: it.t, a, b: a + mm }; });
      const cap = E.capacityOn(c, d, x), load = E.loadOf(all, c.id, d).total;
      return { c, items, cap, load, ab: E.absenceOn(c.id, d, x) };
    });
    let h0 = Math.min(PC.H0, Math.floor(st0 / 60) * 60), h1 = PC.H1;
    rows.forEach(r => { r.items.forEach(i => { h1 = Math.max(h1, Math.ceil(i.b / 60) * 60); }); if (r.cap) h1 = Math.max(h1, Math.ceil((st0 + r.cap) / 60) * 60); });
    h1 = Math.min(Math.max(h1, h0 + 60), 24 * 60);
    const span = h1 - h0, hours = span / 60, pos = v => ((v - h0) / span * 100).toFixed(3) + '%';
    const head = '<div class="pc-row pc-head"><div class="pc-who pc-who-h"><b>' + (S.planAll ? 'Équipe' : 'Planning') + '</b><span>' + rows.length + ' personne' + (rows.length > 1 ? 's' : '') + '</span></div><div class="pc-hours">'
      + Array.from({ length: hours }, (_, i) => '<span style="left:' + (i / hours * 100).toFixed(3) + '%">' + E.fmtClock(h0 + i * 60) + '</span>').join('') + '<span class="end">' + E.fmtClock(h1) + '</span></div></div>';
    // tâches à affecter (non planifiées / sans collaborateur) : à glisser sur la ligne d'une personne
    const un = sets.unpl.filter(t => pcMatch(t, pcState(t, d, null)));
    const unRow = un.length ? '<div class="pc-row pc-unpl"><div class="pc-who"><span class="pc-av ghost">' + ic('inbox', 'sm') + '</span><div class="pc-who-t"><b>À affecter</b><span>' + un.length + ' tâche' + (un.length > 1 ? 's' : '') + ' · ' + esc(fMonth(m).split(' ')[0]) + '</span></div></div>'
      + '<div class="pc-unpl-list" data-keep="pc-unpl">' + un.map(t => pcCard(t, null, { who: S.planAll })).join('') + '</div></div>' : '';
    const body = rows.map(r => {
      const f = pcFill(r.load, r.cap), hol = x.settings.holidays && E.holidayName(d), off = r.cap <= 0;
      const offLbl = hol ? 'Férié · ' + hol : r.ab && (r.ab.minutes === null || r.ab.minutes === undefined || r.ab.minutes === '') ? absLabel(r.ab) : r.c.kind === 'apprenti' ? 'École / hors entreprise' : 'Non travaillé';
      const shown = r.items.filter(i => pcMatch(i.t, pcState(i.t, d, i)));
      const lastEnd = r.items.reduce((v, i) => Math.max(v, i.b), st0), capEnd = st0 + r.cap;
      const ghost = !off && capEnd > lastEnd && d >= td && !pcFiltered() ? '<div class="pc-free" style="left:' + pos(lastEnd) + ';width:' + ((capEnd - lastEnd) / span * 100).toFixed(3) + '%" title="Disponible : ' + E.fmtMin(capEnd - lastEnd) + '"><span>' + (capEnd - lastEnd >= 50 ? 'Disponible · ' : '') + E.fmtMin(capEnd - lastEnd) + '</span></div>' : '';
      const zones = '<i class="pc-zone" style="left:0;width:' + pos(st0) + '"></i>' + (off ? '' : '<i class="pc-zone" style="left:' + pos(Math.min(capEnd, h1)) + ';right:0"></i><i class="pc-capend' + (overAlert(r.load, r.cap) ? ' over' : '') + '" style="left:' + pos(Math.min(capEnd, h1)) + '"></i>');
      return '<div class="pc-row' + (off ? ' off' : '') + '"><div class="pc-who">' + pcAv(r.c) + '<div class="pc-who-t"><b>' + esc(r.c.name) + (r.c.id === S.me.collaborator_id ? ' <small>moi</small>' : '') + '</b><span>' + esc(PC_KIND[r.c.kind] || '') + '</span>'
        + '<span class="pc-who-load"><b>' + E.fmtMin(r.load) + '</b>' + (r.cap ? ' / ' + E.fmtMin(r.cap) : '') + '<span class="lbl"> planifiées</span></span>' + (off && !r.load ? '' : pcBar(f, true) + '<span class="pc-who-f f-' + f.cls + '">' + esc(f.txt) + '</span>') + '</div></div>'
        + '<div class="pc-track" data-drop="' + d + '" data-dc="' + r.c.id + '">' + zones + (off ? '<span class="pc-off-l">' + esc(offLbl) + '</span>' : '') + ghost + shown.map(i => pcBlock(i, d, h0, span)).join('') + '</div></div>';
    }).join('');
    const n = pcNow(), now = d === td && n >= h0 && n <= h1 ? '<div class="pc-now" style="--p:' + ((n - h0) / span).toFixed(4) + '"><b>' + E.fmtClock(n) + '</b></div>' : '';
    return '<div class="card pc-board"><div class="pc-scroll" data-keep="pc-day"><div class="pc-tl" style="--hours:' + hours + '" data-h0="' + h0 + '" data-h1="' + h1 + '" data-date="' + d + '">' + head + unRow + body + now + '</div></div>'
      + (rows.some(r => r.items.length) || un.length ? '' : '<div class="empty" style="margin-top:12px">Aucune tâche ce jour-là.</div>')
      + '<p class="pc-hint small muted no-print hide-m">Glissez une tâche sur la ligne d\'une personne pour la lui confier ce jour-là · cliquez pour ouvrir sa fiche. Les heures affichées enchaînent les tâches à partir de ' + esc(cfg().day_start) + ' (Paramètres).</p></div>';
  }

  /* ---------- Vue Semaine de l'équipe : une ligne par personne, une colonne par jour ---------- */
  function pcWeek(sets, m) {
    const x = ctx(), td = today(), start = E.startOfWeek(S.cursor), days = E.rangeDates(start, E.addDays(start, 4)), all = list('tasks'), win = E.windowOf(S.cursor.slice(0, 7), x.settings);
    const head = '<div class="pc-wrow pc-whead"><div class="pc-who pc-who-h"><b>' + (S.planAll ? 'Équipe' : 'Planning') + '</b><span>Semaine</span></div>' + days.map(d => {
      const isT = d === td, hol = x.settings.holidays && E.holidayName(d);
      return '<div class="pc-wday' + (isT ? ' today' : '') + (d < win.start || d > win.end ? ' outwin' : '') + '" data-act="goday" data-date="' + d + '" role="button" tabindex="0" title="Ouvrir la journée"><b>' + (isT ? '<i class="pc-dot g"></i>' : '') + pcCap1(DAYS_S[E.dow(d) - 1].replace('.', '')) + ' ' + Number(d.slice(8)) + ' ' + MONTHS_S[Number(d.slice(5, 7)) - 1] + '</b>' + (isT ? '<span class="pc-now-pill">Aujourd\'hui</span>' : hol ? '<span class="small muted">Férié</span>' : '') + '</div>';
    }).join('') + '</div>';
    const un = sets.unpl.filter(t => pcMatch(t, pcState(t, null, null)));
    const unRow = un.length ? '<div class="pc-unpl pc-unpl-w"><div class="pc-who"><span class="pc-av ghost">' + ic('inbox', 'sm') + '</span><div class="pc-who-t"><b>À affecter</b><span>' + un.length + ' tâche' + (un.length > 1 ? 's' : '') + ' · ' + esc(fMonth(m).split(' ')[0]) + '</span></div></div><div class="pc-unpl-list" data-keep="pc-unpl-w">' + un.map(t => pcCard(t, null, { who: S.planAll })).join('') + '</div></div>' : '';
    const rows = pcScope().map(c => {
      let tl = 0, tc = 0;
      const cells = days.map(d => {
        const cap = E.capacityOn(c, d, x), load = E.loadOf(all, c.id, d).total; tl += load; tc += cap;
        const f = pcFill(load, cap), ts = dayTasks(c.id, d).filter(t => pcMatch(t, pcState(t, d, null)));
        const hol = x.settings.holidays && E.holidayName(d), ab = E.absenceOn(c.id, d, x);
        const max = 6, more = ts.length - max;
        return '<div class="pc-wcell' + (d === td ? ' today' : '') + (!cap && !load ? ' off' : '') + '" data-drop="' + d + '" data-dc="' + c.id + '">'
          + (cap || load ? '<div class="pc-wcap" title="' + esc(E.fmtMin(load) + ' planifiées sur ' + E.fmtMin(cap) + ' · ' + f.txt) + '"><span><b>' + E.fmtMin(load) + '</b> / ' + E.fmtMin(cap) + '</span>' + pcBar(f, true) + '</div>' : '<div class="pc-off-l">' + esc(hol ? 'Férié' : ab ? absLabel(ab) : c.kind === 'apprenti' ? 'École' : 'Non travaillé') + '</div>')
          + ts.slice(0, more > 0 ? max - 1 : max).map(t => pcCard(t, d)).join('') + (more > 0 ? '<button class="pc-more" data-act="teamcell" data-c="' + c.id + '" data-date="' + d + '">+ ' + (more + 1) + ' autres</button>' : '') + '</div>';
      }).join('');
      const f = pcFill(tl, tc);
      return '<div class="pc-wrow"><div class="pc-who">' + pcAv(c) + '<div class="pc-who-t"><b>' + esc(c.name) + (c.id === S.me.collaborator_id ? ' <small>moi</small>' : '') + '</b><span>' + esc(PC_KIND[c.kind] || '') + '</span>' + (tc || tl ? '<span class="pc-who-load"><b>' + E.fmtMin(tl) + '</b> / ' + E.fmtMin(tc) + '</span>' + pcBar(f, true) + '<span class="pc-who-f f-' + f.cls + '">' + esc(f.txt) + '</span>' : '<span class="pc-who-load">Non travaillé cette semaine</span>') + '</div></div>' + cells + '</div>';
    }).join('');
    return '<div class="card pc-board pc-wboard">' + unRow + '<div class="pc-scroll" data-keep="pc-week"><div class="pc-wgrid">' + head + rows + '</div></div>'
      + '<p class="pc-hint small muted no-print hide-m">Glissez une tâche vers un autre jour ou une autre personne · cliquez sur un jour pour l\'ouvrir en vue Jour.</p></div>';
  }

  /* ---------- Cartes de pilotage sous le planning ---------- */
  function pcCards(dates, sets, m) {
    const x = ctx(), all = list('tasks'), cs = pcScope(), td = today(), isDay = dates.length === 1;
    const per = cs.map(c => { let l = 0, cap = 0; dates.forEach(d => { l += E.loadOf(all, c.id, d).total; cap += E.capacityOn(c, d, x); }); return { c, l, cap, f: pcFill(l, cap) }; });
    const act = '<div class="card pc-c"><div class="pc-c-h"><h3>' + (S.planAll ? 'Activité de l\'équipe' : 'Activité') + '</h3><span class="small muted">' + (isDay ? esc(pcCap1(fDate(dates[0]))) : 'semaine') + '</span></div><div class="pc-act">'
      + per.map(p => '<div class="pc-act-r">' + pcAv(p.c) + '<div class="pc-act-b"><div class="pc-act-t"><b>' + esc(p.c.name) + '</b><span>' + (p.cap || p.l ? '<b>' + E.fmtMin(p.l) + '</b> / ' + E.fmtMin(p.cap) : '—') + '</span></div>' + pcBar(p.f) + '<span class="pc-who-f f-' + p.f.cls + '">' + esc(p.cap || p.l ? p.f.txt : 'Non travaillé') + '</span></div></div>').join('')
      + '</div><div class="pc-c-leg small muted"><span><i class="f-ok"></i>Disponible</span><span><i class="f-full"></i>Journée pleine (90–100 %)</span><span><i class="f-over"></i>Au-delà de la capacité</span></div></div>';
    const un = sets.unpl;
    const aff = '<div class="card pc-c"><div class="pc-c-h"><h3>Tâches à affecter</h3>' + (un.length ? '<span class="badge o">' + un.length + '</span>' : '') + '</div>'
      + (un.length ? '<div class="pc-aff">' + un.slice(0, 4).map(t => { const c = clientOf(t.client_id) || {}; return '<div class="pc-aff-r"><div><b>' + esc(c.name || '?') + '</b><span class="small muted">' + pcType(t).label + (pcTva(t) ? ' + TVA' : '') + ' · ' + E.fmtMin(t.duration_min) + (S.planAll ? ' · ' + esc((collabOf(t.collaborator_id) || {}).name || 'sans collaborateur') : '') + '</span></div>' + (canEditTask(t) ? '<button class="btn sm" data-act="task" data-id="' + t.id + '">Affecter</button>' : '') + '</div>'; }).join('') + '</div>'
        + (un.length > 4 ? '<button class="btn sm ghost pc-c-more" data-act="quick" data-q="unpl">Voir les ' + un.length + ' tâches</button>' : '') : '<div class="pc-c-empty">' + ic('check', 'sm') + 'Tout est planifié sur ' + esc(fMonth(m).split(' ')[0]) + '.</div>') + '</div>';
    // À surveiller : uniquement des informations existantes
    const overDays = []; cs.forEach(c => dates.forEach(d => { const cap = E.capacityOn(c, d, x), l = E.loadOf(all, c.id, d).total; if (l > 0 && overAlert(l, cap)) overDays.push(d); }));
    const watch = [
      sets.late.length && ['late', 'alert', 'r', 'En retard', sets.late.length],
      sets.soon.length && ['soon', 'flag', 'o', 'Échéances dans les ' + cfg().due_soon_days + ' jours', sets.soon.length],
      sets.info.length && ['info', 'mail', 'o', 'Demandes d\'infos à faire', sets.info.length],
      sets.tvatodo.length && ['tvatodo', 'file', 'o', 'TVA à déposer (tenue terminée)', sets.tvatodo.length],
      sets.recv.length && ['recv', 'inbox', 'b', 'Éléments attendus', sets.recv.length]
    ].filter(Boolean);
    const sv = '<div class="card pc-c"><div class="pc-c-h"><h3>À surveiller</h3></div><div class="pc-watch">'
      + (overDays.length ? '<button class="pc-w-r" data-act="goday" data-date="' + overDays.sort()[0] + '"><span class="ibox r">' + ic('flame', 'sm') + '</span><span>' + (isManager() ? 'Journée' + (overDays.length > 1 ? 's' : '') + ' en surcharge' : 'Journée' + (overDays.length > 1 ? 's' : '') + ' très remplie' + (overDays.length > 1 ? 's' : '')) + ' (≥ ' + ALERT_PCT + ' %)</span><b>' + overDays.length + '</b>' + ic('chevR', 'sm') + '</button>' : '')
      + (S.failed.length ? '<button class="pc-w-r" data-act="retry"><span class="ibox r">' + ic('alert', 'sm') + '</span><span>Modifications non enregistrées</span><b>' + S.failed.length + '</b>' + ic('chevR', 'sm') + '</button>' : '')
      + watch.map(w => '<button class="pc-w-r' + (S.quick === w[0] ? ' on' : '') + '" data-act="quick" data-q="' + w[0] + '"><span class="ibox ' + w[2] + '">' + ic(w[1], 'sm') + '</span><span>' + w[3] + '</span><b>' + w[4] + '</b>' + ic('chevR', 'sm') + '</button>').join('')
      + (!overDays.length && !S.failed.length && !watch.length ? '<div class="pc-c-empty">' + ic('check', 'sm') + 'Rien à signaler.</div>' : '') + '</div></div>';
    const ids = new Set(cs.map(c => c.id)), inRange = all.filter(t => ids.has(t.collaborator_id) && dates.some(d => E.onDay(t, d)));
    const hrs = per.reduce((s, p) => s + p.l, 0), caps = per.reduce((s, p) => s + p.cap, 0), doneN = inRange.filter(t => t.done).length;
    const syn = '<div class="card pc-c"><div class="pc-c-h"><h3>Synthèse</h3><span class="small muted">' + (isDay ? 'jour' : 'semaine') + '</span></div><div class="pc-syn">'
      + '<div class="sy-a"><b data-count="' + inRange.length + '" data-key="pcs-n">' + inRange.length + '</b><span>tâche' + (inRange.length > 1 ? 's' : '') + (isDay ? ' ce jour' : ' cette semaine') + '</span></div>'
      + '<div class="sy-v"><b>' + E.fmtMin(hrs) + '</b><span>planifiées' + (caps ? ' sur ' + E.fmtMin(caps) : '') + '</span></div>'
      + '<div class="sy-t"><b>' + cs.length + '</b><span>collaborateur' + (cs.length > 1 ? 's' : '') + '</span></div>'
      + '<div class="sy-g"><b>' + doneN + '</b><span>terminée' + (doneN > 1 ? 's' : '') + '</span></div></div>'
      + '<div class="pc-syn-f small muted"><button class="lnk" data-act="quick" data-q="done">' + sets.done.length + ' tenue' + (sets.done.length > 1 ? 's' : '') + ' terminée' + (sets.done.length > 1 ? 's' : '') + ' en ' + esc(fMonth(m).split(' ')[0]) + '</button> · <button class="lnk" data-act="quick" data-q="tvasent">' + sets.tvasent.length + ' TVA envoyée' + (sets.tvasent.length > 1 ? 's' : '') + '</button></div></div>';
    return '<div class="pc-cards">' + act + aff + sv + syn + '</div>';
  }

  /* ---------- Écran ---------- */
  function pcMain(sets, m) {
    if (S.planMode === 'day') return pcDay(S.cursor, sets, m) + pcCards([S.cursor], sets, m);
    if (S.planMode === 'week') {
      const start = E.startOfWeek(S.cursor), days = E.rangeDates(start, E.addDays(start, 4));
      return (S.planAll || pcSolo() ? pcWeek(sets, m) : planWeek(pcScope()[0])) + pcCards(days, sets, m);
    }
    if (S.planAll || pcSolo()) { const g = teamGantt(E.monthDates(m).filter(d => E.dow(d) <= 5)); return isManager() ? g : g.replace('Jour surchargé', 'Jour au-delà de la capacité'); } // vocabulaire V26.173
    return planMonth(pcScope()[0], m);
  }
  function pcView() {
    pcInit();
    const m = S.cursor.slice(0, 7), cs = pcScope();
    if (!cs.length) return '<div class="notice">Sélectionnez un collaborateur.</div>';
    const sets = pcSets(cs, m);
    S._pcSets = sets;
    if (!PC.timer) PC.timer = setInterval(pcTick, 30000);
    setTimeout(pcAfter, 0);
    return '<div class="print-title">Planning — ' + esc(S.planAll ? 'équipe' : cs[0].name) + ' — ' + esc(pcDateLabel()) + '</div><div class="pc">'
      + pcKpis(sets) + pcToolbar(m) + pcFilters(m) + pcListFrame(sets, m) + (S.planMode !== 'month' ? pcLegend() : '')
      + '<div id="pc-main">' + pcMain(sets, m) + '</div></div>';
  }
  /* Recherche : seule la partie planning + cartes est recalculée (le champ garde le focus) */
  function pcRefresh() { const el = $('#pc-main'); if (!el || !S._pcSets) return; S._pcOb = new Map(); el.innerHTML = pcMain(S._pcSets, S.cursor.slice(0, 7)); animateCounts(el); pcAfter(); }
  /* Ligne de l'heure actuelle et tâche « en cours » : mises à jour sans réafficher l'écran */
  function pcTick() {
    if (S.route !== 'planning') return;
    const n = pcNow();
    document.querySelectorAll('.pc-tl[data-h0]').forEach(tl => {
      const h0 = +tl.dataset.h0, h1 = +tl.dataset.h1, isT = tl.dataset.date === today();
      let el = tl.querySelector('.pc-now');
      if (isT && n >= h0 && n <= h1) {
        if (!el) { el = document.createElement('div'); el.className = 'pc-now'; el.innerHTML = '<b></b>'; tl.appendChild(el); }
        el.style.setProperty('--p', ((n - h0) / (h1 - h0)).toFixed(4)); el.querySelector('b').textContent = E.fmtClock(n);
      } else if (el) el.remove();
      tl.querySelectorAll('.pc-blk[data-a]').forEach(b => { if (b.classList.contains('s-done') || b.classList.contains('s-late')) return; const on = isT && n >= +b.dataset.a && n < +b.dataset.b; b.classList.toggle('s-now', on); });
    });
  }
  /* Arrivée sur la vue Jour d'aujourd'hui : la frise défile jusqu'à l'heure actuelle (téléphone, petite fenêtre) */
  function pcAfter() {
    const ws = document.querySelector('.pc-scroll[data-keep="pc-week"]'), wt = ws && ws.querySelector('.pc-wday.today');
    if (wt && ws.scrollWidth > ws.clientWidth + 4) { const k = 'w' + E.startOfWeek(S.cursor) + (S.planAll ? '*' : S.collabId); if (S._pcScrolled !== k) { S._pcScrolled = k; ws.scrollLeft = Math.max(0, wt.offsetLeft - ((ws.querySelector('.pc-who') || {}).offsetWidth || 0)); } }
    const sc = document.querySelector('.pc-scroll[data-keep="pc-day"]'), tl = sc && sc.querySelector('.pc-tl');
    if (!sc || !tl || sc.scrollWidth <= sc.clientWidth + 4) return;
    const key = tl.dataset.date + (S.planAll ? '*' : S.collabId);
    if (S._pcScrolled === key) return; S._pcScrolled = key;
    if (tl.dataset.date !== today()) return;
    const h0 = +tl.dataset.h0, h1 = +tl.dataset.h1, who = (tl.querySelector('.pc-row .pc-who') || {}).offsetWidth || 0;
    const p = Math.max(0, Math.min(1, (pcNow() - 60 - h0) / (h1 - h0)));
    sc.scrollLeft = Math.round(p * (tl.scrollWidth - who));
  }
  /* Optimiser le planning : résumé avant toute proposition (rien n'est déplacé sans validation) */
  function pcOptStats(m) {
    const x = ctx(), td = today(), win = E.windowOf(m, x.settings), all = list('tasks'), from = td > win.start ? td : win.start;
    const dates = from <= win.end ? E.rangeDates(from, win.end).filter(d => E.isWorkday(d)) : [];
    let over = 0, free = 0;
    visibleCollabs().forEach(c => { let f = 0; dates.forEach(d => { const cap = E.capacityOn(c, d, x), l = E.loadOf(all, c.id, d).total; if (l > 0 && overAlert(l, cap)) over++; f += Math.max(0, cap - l); }); if (f >= 60) free++; });
    return { over, free, days: dates.length };
  }
