  /* ====================== Espace collaborateur ======================
   * Un outil qui aide à organiser et étaler son activité, pas un écran de contrôle :
   * sa semaine, sa journée, ce qui arrive, des suggestions qu'il accepte ou non, et « Proposer mon aide ». */
  function workdaysFrom(d, n, c) {
    const x = ctx(), out = [];
    for (let i = 0; out.length < n && i < n * 3; i++, d = E.addDays(d, 1)) if (E.capacityOn(c, d, x) > 0) out.push(d);
    return out;
  }
  /* Suggestion d'étalement : un jour à venir dépasse la capacité → déplacer un dossier vers un jour plus léger */
  function spreadSuggestion(cid) {
    const c = collabOf(cid); if (!c) return null;
    const x = ctx(), td = today(), tasks = list('tasks');
    let skip = {}; try { skip = JSON.parse(lsGet('planif-spread-skip') || '{}'); } catch (e) { skip = {}; }
    const days = workdaysFrom(td, 12, c).map(d => ({ d, cap: E.capacityOn(c, d, x), load: E.loadOf(tasks, cid, d).total }));
    for (const v of days.filter(v => overAlert(v.load, v.cap)) /* V26.185 : seulement au-delà de 108 % */) {
      const over = v.load - v.cap;
      const cands = dayTasks(cid, v.d).filter(t => !t.done && !t.locked && t.kind !== 'info' && !E.hasAlloc(t) && canEditTask(t))
        .sort((a, b) => ((a.duration_min >= over ? 0 : 1) - (b.duration_min >= over ? 0 : 1)) || (a.duration_min - b.duration_min));
      for (const t of cands) {
        const p = S.data.productions.get(t.production_id), rec = E.isReceived(t, p), from = rec ? (t.received_date || p.received_date) : p && p.expected_date;
        const dur = Number(t.duration_min) || 0;
        const to = days.filter(w => w.d !== v.d && w.cap - w.load >= dur && (!t.due_date || w.d <= t.due_date) && (w.d > v.d || (rec && w.d >= (from || td))) && !skip[t.id + '>' + w.d])
          .sort((a, b) => Math.abs(E.daysBetween(v.d, a.d)) - Math.abs(E.daysBetween(v.d, b.d)))[0];
        if (to) return { t, from: v, to };
      }
    }
    return null;
  }
  /* Propositions d'aide (enregistrées dans l'historique) */
  /* V26.43 : « Proposer mon aide » disponible à partir du 3e mois d'utilisation (date de la 1re connexion du collaborateur / RC) */
  async function firstUseInit() {
    if (!S.me || isManager()) return;
    const k = 'planif-first-use:' + (S.me.email || '').toLowerCase(), local = lsGet(k);
    if (local) { S.firstUse = local; return; }
    const h = await S.store.loadHistory({ action: 'premiere_connexion', limit: 1000 });
    const mine = h.filter(x => (x.user_email || '').toLowerCase() === (S.me.email || '').toLowerCase() || (x.detail && x.detail.email === (S.me.email || '').toLowerCase())).map(x => (x.detail && x.detail.date) || atDay(x.at)).sort()[0];
    S.firstUse = mine || today();
    if (!mine) await S.store.logHistory([{ action: 'premiere_connexion', detail: { email: (S.me.email || '').toLowerCase(), date: S.firstUse, text: 'Première connexion' } }]);
    lsSet(k, S.firstUse); scheduleRender();
  }
  const helpUnlockDate = () => S.firstUse ? E.addMonths(S.firstUse.slice(0, 7), 2) + S.firstUse.slice(7) : null;
  const helpAllowed = () => !!S.firstUse && today() >= helpUnlockDate();
  function helpOffers() {
    if (S.helpCache === undefined || (S.helpAt && Date.now() - S.helpAt > 60000)) {
      if (S.helpCache === undefined) S.helpCache = null;
      S.helpAt = Date.now();
      Promise.all([S.store.loadHistory({ action: 'aide_proposee', limit: 100 }), S.store.loadHistory({ action: 'aide_reponse', limit: 100 }).catch(() => [])]).then(([h, rep]) => {
        S.helpCache = h; S.helpReplies = rep; scheduleRender();
        // V26.42 : message au manager à l'ouverture quand des propositions attendent
        if (isManager() && !S.helpToasted) { const o = helpOffers(); if (o.length) { S.helpToasted = true; const f = o[0], c = collabOf(f.detail.collab_id); toast((c ? c.name : 'Un collaborateur') + ' propose ' + E.fmtMin(Number(f.detail.minutes) || 0) + ' d\'aide ' + fDate(f.detail.date) + (o.length > 1 ? ' (+ ' + (o.length - 1) + ' autre' + (o.length > 2 ? 's' : '') + ')' : '') + '.', 'ok', { label: 'Voir', fn: () => { go('dashboard'); setTimeout(() => { const el = $('#help-offers'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 250); } }, 10000); } }
      }).catch(() => { S.helpCache = []; S.helpReplies = []; });
    }
    const done = new Set((agentState().help_done || []).map(String).concat((S.helpReplies || []).map(r => String((r.detail || {}).offer_id))));
    // V26.42 : un manager ne voit que les propositions de ses équipes (l'administrateur voit tout)
    return (S.helpCache || []).filter(h => h.detail && h.detail.date >= today() && !done.has(String(h.id)) && (!isManager() || isAdmin() || canSeeCollab(h.detail.collab_id)));
  }
  /* V26.42 : réponse du manager à une proposition d'aide (retour affiché au collaborateur) */
  async function helpReply(h, result, extra) {
    const managerName = (S.me.name || '').split(' ')[0] || 'Ton manager';
    await S.store.logHistory([{ action: 'aide_reponse', entity: 'collaborator', entity_id: h.detail.collab_id, client_id: (extra && extra.client_id) || null, detail: Object.assign({ offer_id: String(h.id), collab_id: h.detail.collab_id, result, date: h.detail.date, manager: managerName }, extra || {}) }]).catch(() => { });
    await saveAgentState({ help_done: (agentState().help_done || []).concat([String(h.id)]).slice(-200) });
    S.helpCache = undefined; S.histCache = null;
  }
  function helpFeedback(cid) {
    const seen = new Set((lsGet('planif-help-seen') || '').split(',')), me = collabOf(cid), first = me ? me.name.split(' ')[0] : '';
    return (S.helpReplies || []).filter(r => r.detail && r.detail.collab_id === cid && r.detail.date >= today() && !seen.has(String(r.id))).map(r => {
      const d = r.detail, cl = d.client_id && clientOf(d.client_id), day = DAYS[E.dow(d.date) - 1] + ' ' + Number(d.date.slice(8));
      const txt = d.result === 'confie' ? 'Merci ' + esc(first) + ', ' + esc(d.manager || 'ton manager') + ' t\'a confié <b>' + esc(cl ? cl.name : 'un dossier') + '</b> ce ' + day + '.' : 'Merci pour ta disponibilité mais aucun besoin n\'est identifié.';
      return '<div class="sg-tip ok anim-in">' + ic(d.result === 'confie' ? 'check' : 'users') + '<span class="t">' + txt + '</span><button class="btn sm" data-act="help-seen" data-id="' + r.id + '">OK</button></div>';
    }).join('');
  }
  /* Conseil du jour : étaler un jour chargé, aide déjà proposée, ou marge pour proposer son aide (V26.167 : partagé avec la vue Aujourd'hui du RC / collaborateur) */
  function collabTip(cid) {
    const c = collabOf(cid); if (!c) return '';
    const d = today(), x = ctx(), all = list('tasks');
    const sg = spreadSuggestion(cid), offers = helpOffers().filter(h => h.detail.collab_id === cid);
    if (sg) {
      const cl = clientOf(sg.t.client_id) || {};
      return '<div class="sg-tip anim-in">' + ic('sparkle') + '<span class="t">' + esc(DAYS[E.dow(sg.from.d) - 1].replace(/^./, s => s.toUpperCase())) + ' ' + Number(sg.from.d.slice(8)) + ' est très rempli (' + E.fmtMin(sg.from.load) + ' pour ' + E.fmtMin(sg.from.cap) + '). Déplacer <b>' + esc(cl.name) + '</b> (' + E.fmtMin(sg.t.duration_min) + ') à ' + esc(DAYS[E.dow(sg.to.d) - 1]) + ' ' + Number(sg.to.d.slice(8)) + ', où il y a de la marge ?</span>'
        + '<button class="btn sm primary" data-act="spread-go" data-id="' + sg.t.id + '" data-date="' + sg.to.d + '">Déplacer</button><button class="btn sm" data-act="spread-skip" data-key="' + sg.t.id + '>' + sg.to.d + '">Laisser</button></div>';
    }
    if (offers.length) return '<div class="sg-tip ok anim-in">' + ic('users') + '<span class="t">Merci ! Ton aide est proposée pour ' + offers.map(h => esc(fShort(h.detail.date)) + ' (' + E.fmtMin(h.detail.minutes) + ')').join(', ') + '. Ton manager peut te confier un dossier.</span></div>';
    if (cid !== S.me.collaborator_id || !helpAllowed()) return ''; // « Proposer mon aide » : seulement sur son propre planning
    const free = workdaysFrom(E.addDays(d, 1), 8, c).map(day => ({ day, m: E.capacityOn(c, day, x) - E.loadOf(all, cid, day).total })).filter(v => v.m >= 90).sort((a, b) => b.m - a.m)[0];
    return free ? '<div class="sg-tip anim-in">' + ic('users') + '<span class="t">Tu as de la marge ' + esc(DAYS[E.dow(free.day) - 1]) + ' ' + Number(free.day.slice(8)) + ' (' + E.fmtMin(free.m) + ' libres). Tu peux proposer ton aide à l\'équipe.</span><button class="btn sm" data-act="help-offer">Proposer mon aide</button></div>' : '';
  }
  function vTodayCollab() {
    const d = today(), cid = S.collabId && canSeeCollab(S.collabId) ? S.collabId : S.me.collaborator_id, c = collabOf(cid), x = ctx(); // RC / collaborateur : bascule vers l'espace du binôme
    const first = (S.me.name || '').split(' ')[0];
    if (!c) return '<div class="hello anim-in"><div><div class="eyebrow cap">' + fDate(d) + '</div><h1>Bonjour, ' + esc(first) + '</h1><p>Ton compte n\'est pas encore relié à un planning. Demande à ton administrateur de le relier (Paramètres › Utilisateurs).</p></div></div>';
    const rg = ringHtml(cid, d), tasks = withTimes(dayTasks(cid, d), d);
    const mood = !rg.cap ? 'Journée non travaillée : profite.' : !tasks.length ? 'Aucune production prévue aujourd\'hui.' : { green: 'Ta journée est bien équilibrée.', orange: 'Journée bien remplie : pense à souffler.', red: 'Journée très remplie : regarde la suggestion ci-dessous.', off: '' }[msgLv(rg.lv, rg.l.total, rg.cap)]; // V26.185 : aucune phrase d'avertissement sous 108 %
    // Ma semaine (lundi → vendredi, semaine suivante possible)
    const ws = E.addDays(E.startOfWeek(d), 7 * (S.homeWeek || 0) + (E.dow(d) >= 6 && !S.homeWeek ? 7 : 0)), all = list('tasks');
    const week = E.rangeDates(ws, E.addDays(ws, 4)).map(day => {
      const cap = E.capacityOn(c, day, x), l = E.loadOf(all, cid, day), lv = E.levelOf(l.total, cap, x.settings);
      const prev = dayTasks(cid, day).filter(t => !t.done && !E.isReceived(t, S.data.productions.get(t.production_id)) && t.kind !== 'info').reduce((s, t) => s + E.minutesOn(t, day), 0);
      const h = cap ? Math.min(100, l.total / cap * 100) : 0, ab = E.absenceOn(cid, day, x), hol = x.settings.holidays && E.holidayName(day);
      return '<button class="wk-day' + (day === d ? ' today' : '') + (day < d ? ' past' : '') + '" data-act="goday" data-date="' + day + '"><span class="wk-d">' + fShort(day) + (day === d ? ' · aujourd\'hui' : '') + '</span>'
        + '<span class="wk-bar"><i class="lv-' + (cap ? lv : 'off') + (prev && prev >= l.todo ? ' prev' : '') + '" style="height:' + Math.max(cap && l.total ? 8 : 0, h).toFixed(0) + '%"></i></span>'
        + '<span class="wk-v">' + (cap ? E.fmtMin(l.total) + ' / ' + E.fmtMin(cap) : hol ? 'Férié' : ab ? 'Absent' : 'Repos') + '</span>' + (prev ? '<span class="wk-p">dont ' + E.fmtMin(prev) + ' prévues</span>' : '') + '</button>';
    }).join('');
    // Suggestion d'étalement / proposition d'aide
    const tip = collabTip(cid), fb = helpFeedback(cid);
    // À venir : ce qui dépend de moi
    const mineClients = new Set(list('clients').filter(cl => cl.collaborator_id === cid).map(cl => cl.id));
    const up = [];
    list('productions').filter(p => mineClients.has(p.client_id) && prodDone(p)).forEach(p => {
      const cl = clientOf(p.client_id);
      E.obligations(cl, p.month, cfg()).forEach(o => { if (p.filing && p.filing[o.code]) return; const j = E.daysBetween(d, o.due); if (j <= 7) up.push({ k: o.due, html: '<b>À déposer · ' + o.label + ' ' + esc(cl.name) + '</b><span class="' + (j <= 3 ? 'red' : '') + '">échéance le ' + Number(o.due.slice(8)) + (j < 0 ? ' · dépassée' : j === 0 ? ' · aujourd\'hui' : ' · dans ' + j + ' jour' + (j > 1 ? 's' : '')) + '</span>', task: (list('tasks').find(t => t.production_id === p.id && t.kind !== 'info') || {}).id }); });
    });
    all.filter(t => t.collaborator_id === cid && !t.done && t.planned_date && E.endDate(t) < d && t.kind !== 'info' && E.isReceived(t, S.data.productions.get(t.production_id))).forEach(t => up.push({ k: t.planned_date, html: '<b>À reprendre · ' + esc((clientOf(t.client_id) || {}).name) + '</b><span>prévu le ' + Number(t.planned_date.slice(8)) + ' · ' + E.fmtMin(t.duration_min) + '</span>', task: t.id }));
    const soon = list('productions').filter(p => mineClients.has(p.client_id) && awaitingRec(p) && p.expected_date >= d && p.expected_date <= E.addDays(d, 14)).sort((a, b) => a.expected_date.localeCompare(b.expected_date)).slice(0, 5);
    soon.forEach(p => up.push({ k: p.expected_date, html: '<b>' + esc((clientOf(p.client_id) || {}).name) + '</b><span>éléments attendus vers le ' + Number(p.expected_date.slice(8)) + ' · rien à faire pour l\'instant</span>' }));
    up.sort((a, b) => a.k.localeCompare(b.k));
    const nm = E.addMonths(defaultMonth(), 1), nmMin = all.filter(t => t.month === nm && t.collaborator_id === cid).reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
    const upHtml = (up.length ? up.map(u => '<div class="up-row"' + (u.task ? ' data-act="task" data-id="' + u.task + '"' : '') + '>' + u.html + '</div>').join('') : '<div class="empty">Rien de particulier dans les prochains jours.</div>')
      + (nmMin ? '<div class="up-row"><b>' + esc(fMonth(nm).replace(/^./, s => s.toUpperCase())) + '</b><span>' + E.fmtMin(nmMin) + ' prévues pour l\'instant</span></div>' : '');
    // Côté clients : éléments en retard (ne dépend pas de moi)
    const waiting = list('productions').filter(p => mineClients.has(p.client_id) && awaitingRec(p) && p.expected_date < d && p.month >= E.addMonths(d.slice(0, 7), -1)).sort(recOrder); // V26.163
    // V26.165 : 15 clients par page (boutons Précédent / Suivant)
    const cliHtml = waiting.length ? recPager('c', waiting.length, 15) + recPage('c', waiting, 15).map(p => { const cl = clientOf(p.client_id) || {}; return '<div class="up-row cli"><div><b>' + esc(cl.name) + '</b><span>éléments attendus le ' + fDM(p.expected_date) + (p.month < defaultMonth() ? ' (' + fMonth(p.month) + ')' : '') + (p.partial_date ? ' · reçus en partie' : ', pas encore arrivés') + (lastRelance(p) ? ' · <b class="rel-done">' + ic(lastRelance(p).via === 'telephone' ? 'phone' : 'mail', 'sm') + esc(relLabel(lastRelance(p))) + '</b>' : '') + '</span></div><div class="acts"><button class="btn sm" data-act="relance" data-pid="' + p.id + '">' + ic('mail', 'sm') + 'Relancer</button><button class="btn sm rl-tel' + (lastRelance(p) && lastRelance(p).via === 'telephone' && lastRelance(p).date === today() ? ' on' : '') + '" data-act="relance-tel" data-pid="' + p.id + '" title="' + (lastRelance(p) && lastRelance(p).via === 'telephone' && lastRelance(p).date === today() ? 'Cliquer pour annuler la relance téléphonique d\'aujourd\'hui' : 'Noter que le client a été relancé par téléphone') + '"' + (S.readonly ? ' disabled' : '') + '>' + ic('phone', 'sm') + (lastRelance(p) && lastRelance(p).via === 'telephone' && lastRelance(p).date === today() ? 'Annuler la relance tél.' : 'Relancé par tél.') + '</button><button class="btn sm" data-act="rec-one" data-id="' + p.id + '">Reçu</button>' + (S.v7 ? '<button class="btn sm" data-act="rec-part" data-id="' + p.id + '">Partiel</button>' : '') + '</div></div>'; }).join('') + recPager('c', waiting.length, 15, true) : '<div class="empty">Tous les éléments attendus sont arrivés.</div>';
    const mineView = cid === S.me.collaborator_id;
    return '<div class="hello anim-in"><div><div class="eyebrow cap">' + fDate(d) + '</div><h1>Bonjour, ' + esc(first) + '</h1>' + flowQuoteHtml() + '<p>' + (mineView ? mood : 'Planning de ton binôme : ' + esc(c.name) + '.') + '</p></div>' + monthRing(cid) + '</div>'
      + (binomeIds().size > 1 ? '<div style="margin-bottom:14px">' + collabChips() + '</div>' : '') + unplBanner(cid) + cfeReminder(cid) + cvaeReminder(cid) + capNoticeCollab(cid) + irStrip([cid]) // V26.197
      + '<div class="card anim-in" style="--i:1;margin-bottom:var(--gap)"><div class="card-h"><h2>Aujourd\'hui</h2><span class="badge">' + E.fmtMin(rg.l.total) + ' prévues</span><a class="btn sm" href="#/planning" data-act="goday" data-date="' + d + '">Planning' + ic('chevR', 'sm') + '</a></div>'
      + (tasks.length ? '<div class="tasks">' + unitsOf(tasks).map((u, i) => unitRow(u, { i: i + 3 })).join('') + '</div><div class="swipe-hint only-m">Glisse une carte vers la droite pour la terminer, vers la gauche pour la verrouiller</div>' : '<div class="empty">Aucune production prévue aujourd\'hui.</div>') + '</div>'
      + '<div class="card anim-in" style="--i:2"><div class="card-h"><h2>' + (mineView ? 'Ma semaine' : 'Semaine de ' + esc(c.name)) + '</h2><span class="spacer"></span><button class="btn icon sm" data-act="home-week" data-d="-1" aria-label="Semaine précédente"' + (S.homeWeek > 0 ? '' : ' disabled') + '>' + ic('chevL', 'sm') + '</button><button class="btn icon sm" data-act="home-week" data-d="1" aria-label="Semaine suivante">' + ic('chevR', 'sm') + '</button></div><div class="wk">' + week + '</div>' + fb + (cid === S.me.collaborator_id ? timeReminder(cid) : '') + tip + '</div>'
      + '<div class="grid g2" style="margin-top:var(--gap)">'
      + '<div class="card anim-in" style="--i:3"><div class="card-h"><h2>À venir</h2></div><div class="up">' + upHtml + '</div></div>'
      + '<div class="card anim-in" style="--i:4"><div class="card-h" style="flex-direction:column;align-items:flex-start;gap:2px"><h2>Mes clients</h2><em class="small muted">À eux de jouer !</em></div><div class="up">' + cliHtml + '</div></div>'
      + '<p class="privacy small muted">' + ic('lock', 'sm') + 'Tes temps me servent à ajuster ton planning et harmoniser ton niveau d\'activité.</p>';
  }
  /* Phrase du jour (change chaque jour), écrite comme en direct à la première ouverture */
  const FLOW_QUOTES = ['Une journée bien planifiée, c\'est déjà une journée gagnée.', 'Prêt(e) à mettre un peu de Flow dans ta journée ?', 'Ton planning est prêt. À toi de jouer !', 'Moins de stress, plus de Flow.', 'On garde le cap, les échéances n\'attendent pas.', 'On garde le rythme, on garde le Flow.', 'Organisé aujourd\'hui, tranquille demain.', 'La journée est à toi, le planning aussi.', 'Que les pièces soient avec toi !', 'Une bonne journée commence ici !', 'Ton planning est entre de bonnes mains !', 'Moins de flou. Plus de Flow.', 'Chaque chose en son temps. Chaque dossier à sa place.', 'On garde une longueur d\'avance !', 'Le secret ? Anticiper avant de courir.', 'Moins d\'impro, plus de maîtrise.', 'Voir venir, c\'est déjà gagner du temps !', 'Le futur est déjà dans ton planning.', 'Café. Planning. Et c\'est parti !', 'Le bon dossier au bon moment.'];
  function flowQuote() { const d = E.parseYmd(today()), n = Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + d.getFullYear() * 7; return FLOW_QUOTES[n % FLOW_QUOTES.length]; }
  function flowQuoteHtml() {
    const q = flowQuote();
    if (S.fqText !== q) { S.fqText = q; S.fqPos = reducedMotion() ? q.length : 0; }
    return '<p class="flow-quote' + (S.fqPos >= q.length ? ' done' : '') + '"><span id="fq">' + esc(q.slice(0, S.fqPos)) + '</span><i class="caret" aria-hidden="true"></i><span class="sr-only">' + esc(q) + '</span></p>';
  }
  function typeQuote() {
    if (S.fqTimer || !S.fqText || S.fqPos >= S.fqText.length || !document.getElementById('fq')) return;
    S.fqTimer = setInterval(() => {
      const el = document.getElementById('fq');
      if (!el) { clearInterval(S.fqTimer); S.fqTimer = 0; return; } // écran quitté : reprise au retour
      S.fqPos++; el.textContent = S.fqText.slice(0, S.fqPos);
      if (S.fqPos >= S.fqText.length) { clearInterval(S.fqTimer); S.fqTimer = 0; setTimeout(() => { const p = el.parentElement; if (p) p.classList.add('done'); }, 1400); }
    }, 55);
  }
  /* Dialogue « Proposer mon aide » */
  function helpDialog(cid) {
    const c = collabOf(cid), x = ctx(), all = list('tasks');
    const days = workdaysFrom(E.addDays(today(), 1), 10, c).map(d => ({ d, m: E.capacityOn(c, d, x) - E.loadOf(all, cid, d).total })).filter(v => v.m >= 30);
    return new Promise(resolve => {
      let sel = days[0] || null;
      const root = document.createElement('div');
      root.className = 'overlay anim center';
      root.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" style="width:min(480px,100%)"><div class="sheet-h"><div style="margin-right:auto"><h2>Proposer mon aide</h2><div class="small muted" style="margin-top:4px">Ton manager pourra te confier un dossier ce jour-là.</div></div></div>'
        + '<div class="sheet-b">' + (days.length ? '<div class="ir">' + days.map((v, i) => '<button type="button" data-d="' + v.d + '" data-m="' + v.m + '" class="' + (i ? '' : 'on') + '">' + fShort(v.d) + ' · ' + E.fmtMin(v.m) + ' libres</button>').join('') + '</div>' : '<div class="empty">Aucune marge dans les 10 prochains jours ouvrés.</div>')
        + '<label class="f"><span>Un mot (facultatif)</span><input type="text" id="hp-note" placeholder="Je peux prendre de la TVA ou du lettrage"></label></div>'
        + '<div class="sheet-f"><button class="btn" data-x="cancel">Annuler</button><button class="btn primary" data-x="ok"' + (days.length ? '' : ' disabled') + '>' + ic('users', 'sm') + 'Proposer</button></div></div>';
      const done = v => { fxClose(root); resolve(v); };
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-d]'), xb = e.target.closest('[data-x]');
        if (b) { sel = { d: b.dataset.d, m: Number(b.dataset.m) }; root.querySelectorAll('[data-d]').forEach(el => el.classList.toggle('on', el === b)); }
        else if (xb && xb.dataset.x === 'ok' && sel) done({ date: sel.d, minutes: sel.m, note: root.querySelector('#hp-note').value.trim() });
        else if (xb || e.target === root) done(null);
      });
      document.body.appendChild(root);
    });
  }
  async function offerHelp() {
    const cid = S.me.collaborator_id; if (!cid) return;
    const r = await helpDialog(cid); if (!r) return;
    await S.store.logHistory([{ action: 'aide_proposee', entity: 'collaborator', entity_id: cid, detail: { collab_id: cid, date: r.date, minutes: r.minutes, text: r.note || null } }]);
    S.helpCache = undefined; S.histCache = null;
    toast('Merci ! Ta proposition est transmise au manager.', 'ok');
    render();
  }
  /* Tableau de bord (manager) : propositions d'aide de l'équipe, avec un dossier à confier */
  function helpSection() {
    if (!isManager()) return '';
    const offers = helpOffers(); if (!offers.length) return '';
    const x = ctx(), all = list('tasks');
    const rows = offers.map(h => {
      const c = collabOf(h.detail.collab_id); if (!c) return '';
      const d = h.detail.date, m = Number(h.detail.minutes) || 0;
      const cand = all.filter(t => !t.done && !t.locked && t.kind !== 'info' && t.collaborator_id !== c.id && (Number(t.duration_min) || 0) <= m && E.isReceived(t, S.data.productions.get(t.production_id)) && (!t.due_date || t.due_date >= d) && (!t.planned_date || t.planned_date > d || E.loadOf(all, t.collaborator_id, t.planned_date).total > E.capacityOn(collabOf(t.collaborator_id), t.planned_date, x)))
        .sort((a, b) => (a.planned_date ? 1 : 0) - (b.planned_date ? 1 : 0) || (b.planned_date || '').localeCompare(a.planned_date || ''))[0];
      const cl = cand && clientOf(cand.client_id);
      return '<div class="info-row"><span class="mini-av" style="background:' + esc(c.color || '#888') + '">' + esc(initials(c.name)) + '</span><div class="t"><b>' + esc(c.name) + ' · ' + esc(fShort(d)) + ' · ' + E.fmtMin(m) + ' libres</b><span>' + (h.detail.text ? '« ' + esc(h.detail.text) + ' » · ' : '') + (cand ? 'suggestion : ' + esc(cl ? cl.name : '?') + ' (' + E.fmtMin(cand.duration_min) + ', ' + esc((collabOf(cand.collaborator_id) || {}).name || 'sans collaborateur') + ')' : 'aucun dossier à confier pour l\'instant') + '</span></div>'
        + (cand && !S.readonly ? '<button class="btn sm primary" data-act="help-assign" data-offer="' + h.id + '" data-task="' + cand.id + '" data-to="' + c.id + '" data-date="' + d + '">Confier</button>' : '') + '<button class="btn sm" data-act="help-done" data-offer="' + h.id + '">' + (cand ? 'Pas besoin' : 'Merci') + '</button></div>';
    }).join('');
    return '<div class="section-t" id="help-offers"><h2>Propositions d\'aide de l\'équipe</h2><span class="badge k">' + ic('lock') + 'Manager</span><span class="badge b">' + offers.length + '</span></div><div class="frame anim-in"><div class="inner"><div class="tasks">' + rows + '</div></div></div>';
  }
  /* ====================== V26.167 : suivi des tâches reportées au lendemain (managers) ======================
   * Les reports demandés par clic droit (30 derniers jours, équipes du manager) ; les nouveaux depuis sa dernière
   * visite du Pilotage sont comptés dans le menu et annoncés à l'ouverture de l'application. */
  const postSeenKey = () => 'planif-post-seen:' + (((S.realMe || S.me) || {}).email || '').toLowerCase();
  function postponeLog() {
    if (!isManager()) return [];
    if (S.postCache === undefined || (S.postAt && Date.now() - S.postAt > 60000)) {
      if (S.postCache === undefined) S.postCache = null;
      S.postAt = Date.now();
      Promise.all([S.store.loadHistory({ action: 'report_lendemain', limit: 300 }), S.store.loadHistory({ action: 'report_annule', limit: 300 }).catch(() => [])]).then(([h, u]) => {
        S.postCache = h; S.postUndo = u; scheduleRender();
        const fresh = unseenPostpones();
        if (fresh.length && !S.postToasted && S.route !== 'dashboard') {
          S.postToasted = true;
          const who = [...new Set(fresh.map(x => (collabOf(x.detail.collab_id) || {}).name).filter(Boolean))];
          toast((who.length === 1 ? who[0] + ' a reporté ' : who.join(', ') + ' ont reporté ') + fresh.length + ' tâche' + (fresh.length > 1 ? 's' : '') + ' au lendemain.', 'warn', { label: 'Voir', fn: () => { go('dashboard'); setTimeout(() => { const el = $('#postpones'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 250); } }, 10000);
        }
      }).catch(() => { S.postCache = []; S.postUndo = []; });
    }
    const from = E.addDays(today(), -30);
    const undone = new Set((S.postUndo || []).map(u => u.entity_id + '|' + ((u.detail || {}).from || '')));
    return (S.postCache || []).filter(h => h.detail && h.detail.to && (h.detail.date || atDay(h.at)) >= from && !undone.has(h.entity_id + '|' + h.detail.to) && (isAdmin() || canSeeCollab(h.detail.collab_id)));
  }
  const unseenPostpones = () => { const seen = lsGet(postSeenKey()) || ''; return postponeLog().filter(h => String(h.at || '') > seen); };
  function postponeSection() {
    if (!isManager()) return '';
    if (S.postSeenBase === undefined) S.postSeenBase = lsGet(postSeenKey()) || ''; // « Nouveau » reste affiché pendant la visite
    const rows = postponeLog(); if (!rows.length) return '';
    const latest = rows.reduce((m, h) => String(h.at || '') > m ? String(h.at || '') : m, '');
    if (latest > (lsGet(postSeenKey()) || '')) lsSet(postSeenKey(), latest); // vus : le compteur du menu s'efface
    const per = new Map(); rows.forEach(h => per.set(h.detail.collab_id, (per.get(h.detail.collab_id) || 0) + 1));
    const sum = [...per].sort((a, b) => b[1] - a[1]).map(([id, n]) => { const c = collabOf(id); return '<span class="badge"><span class="mini-av" style="background:' + esc((c && c.color) || '#888') + '">' + esc(initials(c ? c.name : '?')) + '</span>' + esc(c ? c.name : '?') + ' · ' + n + '</span>'; }).join('');
    const hm = at => { const d = new Date(at); return isNaN(d) ? '' : ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
    const items = rows.slice(0, 12).map(h => {
      const d = h.detail, c = collabOf(d.collab_id), cl = h.client_id && clientOf(h.client_id), t = S.data.tasks.get(h.entity_id), fresh = String(h.at || '') > S.postSeenBase;
      return '<div class="info-row"' + (t ? ' data-act="task" data-id="' + t.id + '" role="button" tabindex="0" style="cursor:pointer"' : '') + '><span class="mini-av" style="background:' + esc((c && c.color) || '#888') + '">' + esc(initials(c ? c.name : '?')) + '</span><div class="t"><b>' + esc(cl ? cl.name : 'Dossier') + ' · ' + esc(E.KIND_LABEL[d.kind] || '') + (t ? ' · ' + E.fmtMin(t.duration_min) : '') + (fresh ? ' <span class="badge o">Nouveau</span>' : '') + '</b>'
        + '<span>' + esc(c ? c.name : '') + ' · ' + (d.from ? 'prévue le ' + fDM(d.from) + ' → ' : '') + 'reportée au ' + fDM(d.to) + ' · demandé' + (d.by ? ' par ' + esc(String(d.by).split(' ')[0]) : '') + ' le ' + fDM(d.date || atDay(h.at)) + hm(h.at) + (t && t.done ? ' · faite depuis' : '') + '</span></div></div>';
    }).join('');
    return '<div class="section-t" id="postpones"><h2>Tâches reportées au lendemain</h2><span class="badge k">' + ic('lock') + 'Manager</span><span class="badge o">' + rows.length + ' sur 30 jours</span></div>'
      + '<div class="frame anim-in"><div class="inner"><div class="post-sum">' + sum + '</div><div class="tasks">' + items + '</div>' + (rows.length > 12 ? '<p class="small muted" style="margin:8px 0 0">… et ' + (rows.length - 12) + ' autre' + (rows.length > 13 ? 's' : '') + ' : voir l\'Historique.</p>' : '') + '</div></div>';
  }

