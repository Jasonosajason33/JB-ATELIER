  /* ---------- Vue TABLEAU DE BORD ---------- */
  /* ====================== V26.45 : synthèse hebdomadaire du manager (règles, sans IA générative) ======================
   * Phrases construites à partir des données : avancement, réceptions, échéances, surcharges prévues, marges, aide, absences. */
  function weekSynthesis() {
    const td = today(), d = scopedData(), x = ctx(), all = list('tasks'), m = defaultMonth(), w = E.windowOf(m, x.settings);
    const mon = E.dow(td) >= 6 ? E.addDays(E.startOfWeek(td), 7) : E.startOfWeek(td), days = E.rangeDates(mon, E.addDays(mon, 4)), fri = days[4];
    const cName = id => (clientOf(id) || {}).name || 'dossier', coName = id => (collabOf(id) || {}).name || '—';
    const names = (arr, n) => arr.slice(0, n || 3).map(esc).join(', ') + (arr.length > (n || 3) ? ' et ' + (arr.length - (n || 3)) + ' autre(s)' : '');
    const cids = new Set(d.collaborators.map(c => c.id)), out = [];
    // 1. Avancement du mois
    const prods = d.productions.filter(p => p.month === m), done = prods.filter(p => prodDone(p)).length;
    const open = d.tasks.filter(t => t.month === m && !t.done && t.kind !== 'info'), rest = open.reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
    let cap = 0; for (let dd = td > w.start ? td : w.start; dd <= w.end; dd = E.addDays(dd, 1)) d.collaborators.forEach(c => { cap += E.capacityOn(c, dd, x); });
    if (prods.length) out.push({ k: 'prod', lvl: rest > cap ? 'r' : rest > cap * .85 ? 'o' : 'g', t: 'Production ' + esc(deMonth(m)) + ' : <b>' + done + ' dossier(s) terminé(s) sur ' + prods.length + '</b> (' + Math.round(done / prods.length * 100) + ' %). Il reste ' + E.fmtMin(rest) + ' de travail pour ' + E.fmtMin(cap) + ' de capacité d\'ici le ' + Number(w.end.slice(8)) + (rest > cap ? ' : <b>la période ne suffira pas</b>.' : '.') });
    // 2. Réceptions
    const late = d.productions.filter(p => awaitingRec(p) && p.expected_date < td && p.month >= E.addMonths(m, -1)).sort((a, b) => a.expected_date.localeCompare(b.expected_date)); // V26.163 : hors dossiers clôturés
    const soon = d.productions.filter(p => awaitingRec(p) && p.expected_date >= td && p.expected_date <= fri);
    if (late.length) out.push({ k: 'late', lvl: 'o', t: '<b>' + late.length + ' dossier(s) attendu(s) en retard</b> : ' + names(late.map(p => cName(p.client_id) + ' (depuis le ' + fDM(p.expected_date) + ')')) + '. Une relance est conseillée.' });
    if (soon.length) out.push({ k: 'soon', lvl: '', t: soon.length + ' réception(s) attendue(s) cette semaine' + (soon.length <= 4 ? ' : ' + names(soon.map(p => cName(p.client_id) + ' vers le ' + fDM(p.expected_date)), 4) : '') + '.' });
    // 3. Échéances de la semaine
    const dueW = open.filter(t => t.due_date && t.due_date >= td && t.due_date <= fri && t.kind === 'production');
    if (dueW.length) out.push({ k: 'due', lvl: 'o', t: '<b>' + dueW.length + ' tenue(s) à terminer avant leur échéance cette semaine</b> : ' + names(dueW.sort((a, b) => a.due_date.localeCompare(b.due_date)).map(t => cName(t.client_id) + ' (' + fDM(t.due_date) + ', ' + coName(t.collaborator_id) + ')')) + '.' });
    const fil = filingRows(m).filter(r => !r.filed && r.ready && r.o.due <= fri && cids.has(r.c.collaborator_id));
    if (fil.length) out.push({ k: 'fil', lvl: fil.some(r => r.o.due < td) ? 'r' : 'o', t: fil.length + ' déclaration(s) prête(s) à déposer d\'ici vendredi : ' + names(fil.map(r => cName(r.c.id) + ' — ' + r.o.label)) + '.' });
    // 4. Surcharges prévues et marges
    const allRisks = capRisk().risks.filter(r => cids.has(r.collab_id)), byC = new Map();
    // Pièces attendues après l'échéance : ce n'est pas un manque de temps, c'est le client qu'il faut relancer
    const tooLate = allRisks.filter(r => r.ready && r.ready >= r.due), risks = allRisks.filter(r => !(r.ready && r.ready >= r.due));
    if (tooLate.length) out.push({ k: 'rec', lvl: 'r', t: '<b>Échéance intenable sans les pièces</b> : ' + names(tooLate.map(r => cName(r.client_id) + ' (pièces attendues le ' + fDM(r.ready) + ', échéance ' + fDM(r.due) + ')')) + '. Relancer le client dès maintenant ou prévoir un report.' });
    risks.forEach(r => { if (!byC.has(r.collab_id)) byC.set(r.collab_id, []); byC.get(r.collab_id).push(r); });
    const margin = d.collaborators.filter(c => c.active !== false).map(c => ({ c, free: days.reduce((s, dd) => s + Math.max(0, E.capacityOn(c, dd, x) - E.loadOf(all, c.id, dd).total), 0) })).filter(v => v.free >= 180).sort((a, b) => b.free - a.free);
    byC.forEach((xs, cid) => {
      const short = xs.reduce((s, r) => s + r.short, 0), first = xs[0], helper = margin.find(v => v.c.id !== cid && v.free >= Math.min(first.short, first.dur || first.short));
      out.push({ k: 'cap', lvl: 'r', t: '<b>Surcharge prévue pour ' + esc(coName(cid)) + '</b> : ' + xs.length + ' dossier(s) menacé(s), il manque ' + E.fmtMin(short) + ' (premier : ' + esc(cName(first.client_id)) + ', échéance ' + fDM(first.due) + ').' + (helper ? ' Suggestion : confier ' + esc(cName(first.client_id)) + ' à ' + esc(helper.c.name) + ', qui a ' + E.fmtMin(helper.free) + ' de marge cette semaine.' : '') });
    });
    if (!byC.size && !tooLate.length && agentOn()) out.push({ k: 'cap', lvl: 'g', t: 'Aucune surcharge prévue d\'ici ' + esc(fMonth(E.addMonths(m, 2))) + ' : chaque dossier trouve sa place avant son échéance.' });
    if (margin.length) out.push({ k: 'free', lvl: '', t: 'Marge disponible cette semaine : ' + margin.slice(0, 3).map(v => esc(v.c.name) + ' (' + E.fmtMin(v.free) + ')').join(', ') + '.' });
    // 5. Dossiers à risque, aide proposée, absences
    const hi = prods.map(p => riskOf(p.id)).filter(r => r && r.level === 'eleve');
    if (hi.length) out.push({ k: 'risk', lvl: 'r', t: hi.length + ' dossier(s) à risque élevé : ' + names(hi.map(r => r.c.name)) + '.' });
    const offers = helpOffers();
    if (offers.length) out.push({ k: 'help', lvl: 'g', t: offers.length + ' proposition(s) d\'aide en attente : ' + names(offers.map(h => coName(h.detail.collab_id) + ' ' + fShort(h.detail.date) + ' (' + E.fmtMin(Number(h.detail.minutes) || 0) + ')')) + '.' });
    const abs = []; d.collaborators.forEach(c => { const n = days.filter(dd => { const a = E.absenceOn(c.id, dd, x); return a && E.capacityOn(c, dd, x) === 0; }).length; if (n) abs.push(c.name + ' (' + n + ' j)'); });
    if (abs.length) out.push({ k: 'abs', lvl: '', t: 'Absences cette semaine : ' + names(abs, 5) + '.' });
    // 6. Agent
    if (agentOn()) { const md = agentModel(), dr = md.drift || {}; if (dr.alert) out.push({ k: 'ai', lvl: 'r', t: 'La précision des prévisions de réception se dégrade (' + dr.last.toFixed(1).replace('.', ',') + ' j d\'écart sur 4 semaines) : vérifiez les réceptions déclarées en retard.' }); }
    return { from: mon, to: fri, items: out };
  }
  function synthText(sy) {
    const tmp = document.createElement('div');
    return 'Synthèse de la semaine du ' + fDM(sy.from) + ' au ' + fDM(sy.to) + '\n\n' + sy.items.map(i => { tmp.innerHTML = i.t; return '• ' + tmp.textContent; }).join('\n') + '\n\n— JB Flow';
  }
  /* Première connexion de la semaine : le manager est prévenu que la synthèse est prête */
  function synthWeeklyToast() {
    if (!isManager()) return;
    const td = today(), mon = E.dow(td) >= 6 ? E.addDays(E.startOfWeek(td), 7) : E.startOfWeek(td), k = 'planif-synth-week:' + (S.me.email || '').toLowerCase();
    if (lsGet(k) === mon) return; lsSet(k, mon);
    const n = weekSynthesis().items.filter(i => i.lvl === 'r' || i.lvl === 'o').length;
    toast('La synthèse de la semaine est prête' + (n ? ' : ' + n + ' point(s) d\'attention.' : '.'), n ? 'warn' : 'ok', { label: 'Lire', fn: () => { lsSet('planif-synth-fold', ''); go('dashboard'); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 10000);
  }
  function synthSection() {
    if (!isManager()) return '';
    const sy = weekSynthesis(), open = true; // repli géré par les cartes (ui-v2.js)
    const dot = { r: 'var(--bad)', o: 'var(--warn)', g: 'var(--ok)', '': 'var(--muted, #8A9185)' };
    return '<div class="card anim-in synth" style="margin-bottom:var(--gap)"><div class="card-h"><h2>Synthèse de la semaine</h2><span class="small muted">du ' + fDM(sy.from) + ' au ' + fDM(sy.to) + '</span><span class="spacer"></span><button class="btn sm" data-act="synth-copy">' + ic('list', 'sm') + 'Copier</button></div>'
      + '<div class="synth-b">' + (open ? (sy.items.length ? '<ul class="synth-l">' + sy.items.map(i => '<li><i style="background:' + dot[i.lvl || ''] + '"></i><span>' + i.t + '</span></li>').join('') + '</ul>' : '<div class="muted">Rien de particulier cette semaine.</div>') : '') + monthRing(null) + '</div></div>';
  }
  /* V26.73 : information manager sur les dossiers non actifs */
  function inactiveNotice() {
    if (!isManager()) return '';
    const cs = list('clients').filter(c => c.active === false && (isAdmin() || canSeeCollab(c.collaborator_id))).sort(byName);
    if (!cs.length) return '';
    return '<div class="notice inactive-note" style="margin-bottom:var(--gap)">' + ic('alert', 'sm') + '<div><b>' + cs.length + ' dossier' + (cs.length > 1 ? 's non actifs' : ' non actif') + '</b> — exclu' + (cs.length > 1 ? 's' : '') + ' de la planification et des indicateurs : '
      + cs.map(c => '<button type="button" class="inactive-link" data-act="client" data-id="' + c.id + '">' + esc(c.name) + '</button>').join(', ') + '. Ouvrez un dossier pour le réactiver.</div></div>';
  }
  function vDashboard() {    const m = S.month, td = today(), x = ctx(), db = E.dashboard(scopedData(), m, td), al = alertsOf(scopedData(), td, { month: m });
    const Pr = db.productions, L = db.load, tot = Pr.total || 1, tasks = list('tasks');
    db.unplanned = db.unplanned.filter(t => t.kind === 'info' || !waitOf(S.data.productions.get(t.production_id))); // V26.206 : l'attente client n'est pas un manque de place
    const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
    const sparks = dashSparks(m);
    const kp = (i, icon, box, label, val, fmt, key, foot, extra) => '<div class="kpi anim-in' + (extra || '') + (key.indexOf('dp-') === 0 ? ' kpi-click' : '') + '" style="--i:' + i + '"' + (key.indexOf('dp-') === 0 ? ' data-act="prod-detail" data-k="' + key + '" role="button" tabindex="0"' : '') + '><div class="kpi-h"><span class="ibox ' + box + '">' + ic(icon, 'sm') + '</span>' + label + '</div><div class="v" data-count="' + val + '" data-fmt="' + fmt + '" data-key="' + key + m + '">' + fmtVal(val, fmt) + '</div><div class="foot">' + foot + '</div>' + (sparks[key] || '') + '</div>';
    // Histogramme : charge de l'équipe par jour de la période
    const days = E.rangeDates(db.window.start, db.window.end).map(d => {
      let cap = 0, load = 0;
      collabs().forEach(c => { cap += E.capacityOn(c, d, x); load += E.loadOf(tasks, c.id, d).total; });
      return { d, cap, load };
    }).filter(v => v.cap > 0 || v.load > 0);
    const max = Math.max(1, ...days.map(v => Math.max(v.cap, v.load)));
    const bars = days.map((v, i) => {
      const cls = v.load > v.cap ? 'over' : v.d < td ? 'past' : v.d === td ? 'today' : 'future';
      return '<div class="vb' + (v.d === td ? ' is-today' : '') + '" style="--i:' + i + '"><div class="col"><div class="cap-t" style="height:' + (v.cap / max * 100).toFixed(1) + '%"></div><div class="fill ' + cls + '" style="height:' + Math.max(1.5, v.load / max * 100).toFixed(1) + '%"></div></div><span class="lab">' + Number(v.d.slice(8)) + '</span><span class="tip">' + fShort(v.d) + ' · ' + E.fmtMin(v.load) + ' / ' + E.fmtMin(v.cap) + '</span></div>';
    }).join('');
    // Entonnoir de production
    const stages = [['Dossiers', Pr.total], ['Reçus', Pr.received], ['Planifiés', Pr.planned], ['Terminés', Pr.done]];
    const funnel = stages.map((s, i) => '<div class="fr"><span>' + s[0] + '</span><div><div class="ft ' + (i === stages.length - 1 ? 'last' : 'hatch') + '" style="width:' + Math.max(3, s[1] / tot * 100).toFixed(1) + '%;--i:' + i + '"></div></div><span class="fv" data-count="' + s[1] + '" data-fmt="int" data-key="f' + i + m + '">' + s[1] + '</span></div>').join('');
    // Anneau : répartition du reste à faire
    const parts = db.team.filter(r => r.todo > 0).map(r => ({ name: r.collab.name, v: r.todo, color: r.collab.color || '#888' }));
    const sum = parts.reduce((s, p) => s + p.v, 0) || 1, R = 60, C = 2 * Math.PI * R;
    let acc = 0;
    const arcs = parts.map(p => { const len = C * p.v / sum, gap = parts.length > 1 ? 3 : 0; const s = '<circle cx="75" cy="75" r="' + R + '" stroke="' + esc(p.color) + '" stroke-dasharray="' + Math.max(0, len - gap).toFixed(1) + ' ' + C.toFixed(1) + '" stroke-dashoffset="' + (-acc).toFixed(1) + '"/>'; acc += len; return s; }).join('');
    const donut = '<div class="donut"><div class="donut-c"><svg viewBox="0 0 150 150"><circle cx="75" cy="75" r="' + R + '" stroke="var(--track)"/>' + arcs + '</svg><div class="center"><b>' + E.fmtMin(L.todo) + '</b><span>reste à faire</span></div></div>'
      + '<div class="legend-list">' + (parts.length ? parts.map(p => '<div><i class="lg-sw" style="background:' + esc(p.color) + '"></i>' + esc(p.name) + '<b>' + E.fmtMin(p.v) + ' <span class="muted small">' + pct(p.v, sum) + ' %</span></b></div>').join('') : '<div class="muted">Rien à faire.</div>') + '</div></div>';
    // Cartes collaborateur (semaine en cours de la période)
    const ref = td > db.window.start ? (td > db.window.end ? db.window.end : td) : db.window.start;
    const wk = E.rangeDates(E.startOfWeek(ref), E.addDays(E.startOfWeek(ref), 4));
    const team = db.team.map((r, i) => {
      const lv = E.levelOf(r.total, r.cap, x.settings);
      const mb = wk.map((d, j) => { const cap = E.capacityOn(r.collab, d, x), l = E.loadOf(tasks, r.collab.id, d).total, h = cap ? Math.min(100, l / cap * 100) : 0; const cls = !cap ? 'off' : l > cap ? 'over' : d < td ? 'past' : d === td ? 'today' : ''; return '<i class="' + cls + '" style="height:' + Math.max(6, h).toFixed(0) + '%;--i:' + (i * 5 + j) + '" title="' + fShort(d) + ' · ' + E.fmtMin(l) + ' / ' + E.fmtMin(cap) + '"></i>'; }).join('');
      return '<div class="card collab-card anim-in" style="--i:' + (i + 12) + '" data-act="collab-plan" data-id="' + r.collab.id + '" role="button" tabindex="0"><div class="ch"><span class="avatar" style="background:' + esc(r.collab.color || '#888') + ';color:#fff">' + esc(initials(r.collab.name)) + '</span><div style="min-width:0;flex:1"><b>' + esc(r.collab.name) + '</b><span class="nowrap">' + E.fmtMin(r.total) + ' / ' + E.fmtMin(r.cap) + '</span></div><div class="cc-pct"><b data-count="' + r.fill + '" data-fmt="pct" data-key="cc' + r.collab.id + m + '">' + r.fill + ' %</b><span class="badge ' + LV_BADGE[msgLv(lv, r.total, r.cap)] + '">' + LV_LABEL[msgLv(lv, r.total, r.cap)] + '</span></div></div>'
        + '<div><div class="mbars">' + mb + '</div><div class="mlabs">' + wk.map(d => '<span' + (d === td ? ' class="on"' : '') + '>' + DAYS_S[E.dow(d) - 1].slice(0, 3) + '</span>').join('') + '</div></div>'
        + '<div class="row small" style="justify-content:space-between"><span class="muted">Reste à faire <b style="color:var(--text)">' + E.fmtMin(r.todo) + '</b></span><span class="muted">Disponible <b style="color:' + (r.remaining < 0 ? 'var(--bad)' : 'var(--text)') + '">' + E.fmtMin(r.remaining) + '</b></span>' + (r.unplanned ? '<span class="badge r">' + r.unplanned + ' non planifiée(s)</span>' : '') + '</div></div>';
    }).join('');
    const fillBox = L.fill > 100 ? 'r' : L.fill >= x.settings.warn_pct ? 'o' : 'g';
    const ov = S.route === 'dashboard', act = S.route === 'activite', prev = S.route === 'previsions'; // V26.61 : Pilotage réparti en 3 pages
    return migNotice() + inactiveNotice() + pilotTabs(monthNav() + monthActions(m)) + teamPicker() + (ov ? synthSection() + milestoneBanner(m) : '')
      + (ov ? '<div class="section-t"><h2>Production</h2></div>'
      + '<div class="carousel desk-grid" style="--n:5" data-keep="kpi-dash-p">'
      + kp(0, 'folder', '', 'Dossiers', Pr.total, 'int', 'dp-tot', Pr.received + ' reçus sur ' + Pr.total, ' hero')
      + kp(1, 'inbox', 'b', 'Reçus', Pr.received, 'int', 'dp-rec', '<span class="delta up">' + pct(Pr.received, Pr.total) + ' %</span> des dossiers')
      + kp(2, 'calendar', 'a', 'Planifiés', Pr.planned, 'int', 'dp-pla', '<span class="delta ' + (Pr.planned === Pr.total ? 'up' : 'flat') + '">' + pct(Pr.planned, Pr.total) + ' %</span> du mois')
      + kp(3, 'check', 'g', 'Terminés', Pr.done, 'int', 'dp-don', '<span class="delta up">' + pct(Pr.done, Pr.total) + ' %</span> terminés')
      + kp(4, 'alert', Pr.late ? 'r' : 'g', 'En retard', Pr.late, 'int', 'dp-lat', Pr.late ? '<span class="delta down">à traiter</span>' : '<span class="delta up">aucun retard</span>')
      + '</div><div class="dots" data-dots></div>'
      + capSection() + riskSection(m) + helpSection() + postponeSection() + '<div class="split" style="margin-top:var(--gap)">'
      + (db.unplanned.length ? '<div class="frame anim-in"><div class="frame-h">' + ic('alert') + '<h2>Tâches non planifiées</h2><span class="badge r">' + db.unplanned.length + '</span></div><div class="inner"><div class="tasks">' + db.unplanned.slice(0, 20).map(t => taskRow(t, { showCollab: true, swipe: false })).join('') + '</div></div></div>' : '<div class="frame anim-in"><div class="frame-h">' + ic('check') + '<h2>Planification</h2></div><div class="inner"><div class="empty">Toutes les tâches du mois sont planifiées.</div></div></div>')
      + '<div class="frame anim-in"><div class="frame-h">' + ic('alert') + '<h2>Alertes</h2><span class="badge' + (al.some(a => a.level === 'bad') ? ' r' : '') + '">' + al.length + '</span></div><div class="inner">' + alertList(al, 12) + '</div></div>'
      + '</div>' + fiabSection(m) : '')
      + (act ? '<div class="section-t"><h2>Niveau d\'activité</h2><span class="legend d-only"><span><i class="lg-sw hatch"></i>Jours passés</span><span><i class="lg-sw" style="background:var(--pop)"></i>Aujourd\'hui</span><span><i class="lg-sw vb-fut"></i>À venir</span><span><i class="lg-sw" style="background:var(--bad)"></i>Surcharge</span><span><i class="lg-sw" style="background:var(--track)"></i>Capacité</span></span></div>'
      + '<div class="split">'
      + '<div class="card anim-in" style="--i:5"><div class="card-h"><h2>Niveau d\'activité de l\'équipe par jour</h2><span class="badge">' + E.fmtMin(L.total) + ' planifiées</span></div><div class="vbars">' + (bars || '<div class="empty" style="width:100%">Les dossiers du mois ne sont pas encore créés.</div>') + '</div></div>'
      + '<div class="grid g2" style="align-content:start">'
      + kp(6, 'gauge', fillBox, 'Remplissage', L.fill, 'pct', 'dl-fil', '<div class="bar" style="flex:1"><i class="lv-' + ({ r: 'red', o: 'orange', g: 'green' }[fillBox]) + '" style="width:' + Math.min(100, L.fill) + '%"></i></div>')
      + kp(7, 'list', '', 'Reste à faire', L.todo, 'min', 'dl-tod', E.fmtMin(L.done) + ' réalisées')
      + kp(8, 'calendar', '', 'Capacité', L.capacity, 'min', 'dl-cap', collabs().length + ' collaborateur' + (collabs().length > 1 ? 's' : ''))
      + kp(9, 'sparkle', '', 'Disponible', L.remaining, 'min', 'dl-rem', (L.remaining < 0 ? '<span class="delta down">dépassé</span>' : '<span class="delta up">marge</span>') + ' d\'ici le ' + endLbl(m), ' popk')
      + '</div></div>'
      + '<div class="grid g2" style="margin-top:var(--gap)">'
      + '<div class="card anim-in" style="--i:10"><div class="card-h"><h2>Avancement de la production</h2></div><div class="funnel">' + funnel + '</div>'
      + '<div class="ratios"><div>Réception<b data-count="' + pct(Pr.received, Pr.total) + '" data-fmt="pct" data-key="r1' + m + '">' + pct(Pr.received, Pr.total) + ' %</b></div><div>Planification<b data-count="' + pct(Pr.planned, Pr.total) + '" data-fmt="pct" data-key="r2' + m + '">' + pct(Pr.planned, Pr.total) + ' %</b></div><div>Réalisation<b data-count="' + pct(Pr.done, Pr.total) + '" data-fmt="pct" data-key="r3' + m + '">' + pct(Pr.done, Pr.total) + ' %</b></div></div></div>'
      + '<div class="card anim-in" style="--i:11"><div class="card-h"><h2>Répartition du reste à faire</h2></div>' + donut + '</div></div>'
      + timeSection(m) + projectionSection(m) + irDashboard(m)
      + '<div class="section-t"><h2>Équipe</h2><span class="muted small cap">Semaine du ' + fDM(wk[0]) + '</span></div>'
      + '<div class="grid g3">' + team + '</div>' : '')
      + (isManager() ? '' : filingsSection(m))
      + (prev ? nextMonthSection(m) + agentSection() : '');
  }
  /* ---------- Vue HISTORIQUE ---------- */
  const ACTION_LABEL = { premiere_connexion: '👋 Première connexion', relance: '📨 Relance client', reception: '📥 Réception', reception_annulee: '↩️ Réception annulée', deplacement: '↔️ Déplacement', changement_collaborateur: '👤 Changement de collaborateur', modification_temps: '⏱ Modification du temps', verrouillage: '🔒 Verrouillage', deverrouillage: '🔓 Déverrouillage', terminee: '✅ Tâche terminée', reouverte: '↩️ Tâche rouverte', depot: '🏛 Dépôt', demande_info: '✉️ Demande d\'informations',replanification: '🔄 Replanification', generation: '➕ Génération du mois', import: '📥 Import Excel', dossier: '🗂 Dossier modifié', collaborateur: '👥 Collaborateur modifié', utilisateur: '🔑 Utilisateur modifié', parametres: '⚙️ Paramètres', restauration: '♻️ Restauration', aide_proposee: '🤝 Aide proposée', agent_reception: '🤖 Agent : date de réception ajustée', reception_partielle: '◐ Réception partielle', import_historique: '📥 Import de l\'historique', tache_scindee: '✂️ Tâche non terminée en totalité', report_auto: '⏩ Report automatique', report_lendemain: '⏭ Reportée au lendemain', report_annule: '↩️ Report annulé', aide_reponse: '🤝 Réponse à une aide' };
  function histDetail(h) {
    const d = h.detail || {};
    const parts = [];
    if (d.kind) parts.push(E.KIND_LABEL[d.kind] || d.kind);
    if ('from' in d || 'to' in d) parts.push((d.from ? fDMY(d.from) : '—') + ' → ' + (d.to ? fDMY(d.to) : '—'));
    if (d.from_name || d.to_name) parts.push((d.from_name || '—') + ' → ' + (d.to_name || '—'));
    if (d.from_min !== undefined) parts.push(E.fmtMin(d.from_min) + ' → ' + E.fmtMin(d.to_min));
    if (d.date) parts.push('le ' + fDMY(d.date));
    if (d.text) parts.push(d.text);
    return parts.join(' · ');
  }
  function histWho(h) { if (isManager()) return h.user_email || ''; return h.user_email && S.me && h.user_email.toLowerCase() === S.me.email.toLowerCase() ? 'toi' : h.action === 'agent_reception' ? 'planification automatique' : 'le cabinet'; }
  /* Collaborateur : uniquement les événements de ses dossiers */
  function histMine(hs) {
    if (isManager()) return hs;
    const mine = new Set(list('clients').filter(c => c.collaborator_id === S.me.collaborator_id).map(c => c.id));
    return hs.filter(h => h.action !== 'aide_proposee' && ((h.client_id && mine.has(h.client_id)) || (!h.client_id && h.user_email && h.user_email.toLowerCase() === S.me.email.toLowerCase())));
  }
