  /* ====================== Feuilles (détails / formulaires) ======================
   * iPhone : feuille qui monte du bas ; ordinateur : panneau qui glisse de la droite.
   * L'animation d'ouverture ne joue qu'une fois ; les mises à jour ne remplacent que le contenu. */
  // V26.96 : pile des fenêtres — fermer (clic sur le fond, Échap, Fermer) revient à la fenêtre précédente
  const SHEET_NAV = ['task', 'client', 'prodDetail', 'filDetail', 'msDetail', 'tvaRecap', 'isRecap', 'cfeRecap', 'group', 'collab'];
  function openSheet(s) {
    if (S.sheet && SHEET_NAV.includes(S.sheet.type) && SHEET_NAV.includes(s.type) && !(S.sheet.type === s.type && S.sheet.id === s.id)) (S.sheetStack = S.sheetStack || []).push(S.sheet);
    else if (!S.sheet) S.sheetStack = [];
    S.sheet = s; s._new = true; renderSheet();
  }
  function closeSheet(all) {
    if (!all && S.sheetStack && S.sheetStack.length) { const prev = S.sheetStack.pop(); S.sheet = prev; prev._new = true; renderSheet(); return; }
    S.sheetStack = []; document.body.classList.remove('has-modal');
    const root = $('#sheet-root'), ov = root.querySelector('.overlay');
    S.sheet = null;
    // V26.176 (tous les thèmes) : fermeture = ouverture inversée, plus rapide (140 ms, accélération de sortie), fond en fondu
    if (ov && fxOn()) { ov.classList.add('closing'); setTimeout(() => { if (!S.sheet) root.innerHTML = ''; }, FX.FAST); }
    else root.innerHTML = '';
  }
  function renderSheet() {
    const root = $('#sheet-root'); if (!root) return;
    if (!S.sheet) { const ov = root.querySelector('.overlay'); if (ov && !ov.classList.contains('closing')) root.innerHTML = ''; return; }
    if (typing() && root.contains(document.activeElement)) { S.dirty = true; return; }
    const s = S.sheet;
    let inner = '';
    try {
      inner = s.type === 'task' ? sheetTask(s) : s.type === 'prodDetail' ? sheetProdDetail(s) : s.type === 'irList' ? sheetIrList(s) : s.type === 'filDetail' ? sheetFilDetail(s) : s.type === 'msDetail' ? sheetMsDetail(s) : s.type === 'rebal' ? sheetRebalance(s) : s.type === 'diag' ? sheetDiag(s) : s.type === 'tvaRecap' ? sheetTvaRecap(s) : s.type === 'isRecap' ? sheetIsRecap(s) : s.type === 'viewUser' ? sheetViewUser(s) : s.type === 'isCalc' ? sheetIsCalc(s) : s.type === 'cfeRecap' ? sheetCfeRecap(s) : s.type === 'relance' ? sheetRelance(s) : s.type === 'group' ? sheetGroup(s) :s.type === 'client' ? sheetClient(s) : s.type === 'collab' ? sheetCollab(s) : s.type === 'user' ? sheetUser(s) : s.type === 'replan' ? sheetReplan(s) : s.type === 'import' ? sheetImport(s) : s.type === 'hist-import' ? sheetHistImport(s) : s.type === 'team' ? sheetTeam(s) : '';
    } catch (e) { console.error(e); inner = '<div class="sheet-b"><div class="notice bad">' + esc(errMsg(e)) + '</div></div>'; }
    if (!inner) { S.sheet = null; root.innerHTML = ''; document.body.classList.remove('has-modal'); return; }
    const center = s.type === 'relance' || s.type === 'replan' || s.type === 'import' || s.type === 'hist-import' || s.type === 'tvaRecap' || s.type === 'isRecap' || s.type === 'viewUser' || s.type === 'isCalc' || s.type === 'cfeRecap' || s.type === 'prodDetail' || s.type === 'irList' || s.type === 'filDetail' || s.type === 'msDetail' || s.type === 'rebal' || s.type === 'diag' || s.type === 'client' || s.type === 'task'; // V26.85 / V26.96 : fiche dossier centrée et agrandie
    document.body.classList.toggle('has-modal', center); // V26.96 : effet de profondeur (page en retrait derrière la fenêtre)
    const el = root.querySelector('.sheet');
    if (s._new || !el) {
      s._new = false;
      const swap = !!root.querySelector('.overlay:not(.closing)'); // V26.176 : fenêtre suivante ou précédente — le fond reste en place, seule la fenêtre change
      root.innerHTML = '<div class="overlay anim' + (swap ? ' swap' : '') + (center ? ' center' : '') + '" data-act="overlay"><div class="sheet st-' + s.type + (s.wide ? ' wide' : '') + (s.type === 'client' ? ' sheet-client' : s.type === 'task' ? ' sheet-task' : '') + '" role="dialog" aria-modal="true">' + inner + '</div></div>';
    } else { const sc = el.scrollTop; el.innerHTML = inner; el.scrollTop = sc; }
  }
  const sheetHead = (title, sub) => '<div class="sheet-h"><div style="margin-right:auto;min-width:0"><h2>' + title + '</h2>' + (sub ? '<div class="small muted" style="margin-top:4px">' + sub + '</div>' : '') + '</div><button class="x" data-act="close" aria-label="Fermer">' + ic('x', 'sm') + '</button></div>';
  function remoteNotice(s) { return s.remote ? '<div class="notice warn">Cet élément vient d\'être modifié par ' + esc(s.remote) + '. Les valeurs affichées sont à jour.</div>' : ''; }
  function histBlock(s, filter) {
    if (!s.showHist) return '<div><button class="btn sm" data-act="hist-toggle">' + ic('clock', 'sm') + 'Afficher l\'historique</button></div>';
    if (s.hist === undefined) { s.hist = null; S.store.loadHistory(Object.assign({ limit: 50 }, filter)).then(h => { if (S.sheet === s) { s.hist = h; renderSheet(); } }).catch(() => { s.hist = []; renderSheet(); }); }
    return '<div><h3 style="margin-bottom:6px">Historique</h3>' + (s.hist ? histRows(s.hist) : '<div class="empty">Chargement…</div>') + '</div>';
  }
  /* Parcours d'un dossier : Attendu/Reçu → Tenue → Lettrage → TVA → Échéance */
  function prodTimeline(p) {
    if (!p) return '';
    const td = today(), ts = list('tasks').filter(t => t.production_id === p.id);
    const steps = [{ lab: p.received_date ? 'Reçu' : p.partial_date ? 'Reçu en partie' : 'Attendu', date: p.received_date || p.partial_date || p.expected_date, st: p.received_date ? 'ok' : p.partial_date ? 'cur' : (p.expected_date < td ? 'late' : '') }];
    E.KINDS.forEach(k => { const t = ts.find(x => x.kind === k); if (t) steps.push({ lab: E.KIND_LABEL[k], date: t.planned_date, st: t.done ? 'ok' : ((t.planned_date && E.endDate(t) < td) || !t.planned_date ? 'late' : '') }); });
    const due = ts.reduce((m, t) => (t.due_date && (!m || t.due_date < m) ? t.due_date : m), null);
    const allDone = ts.length && ts.every(t => t.done);
    steps.push({ lab: 'Échéance', date: due, st: allDone ? 'ok' : (due && due < td ? 'late' : '') });
    const cur = steps.findIndex(s => s.st !== 'ok');
    if (cur >= 0 && steps[cur].st === '') steps[cur].st = 'cur';
    return '<div class="timeline">' + steps.map(s => '<div class="st ' + s.st + '"><i>' + (s.st === 'ok' ? CHECK_SVG : s.st === 'late' ? ic('alert') : s.st === 'cur' ? ic('flag') : '') + '</i><b>' + s.lab + '</b><span>' + (s.date ? fDM(s.date) : '—') + '</span></div>').join('') + '</div>';
  }

  /* V26.32 : pourquoi cette date prévue, meilleur jour de relance, marge nouveau dossier */
  function predictBox(p, t, c) {
    const i = p && predictInfo(p), nw = t.kind === 'production' && c.id && isNewDossier(c) && newMarginPct() > 0, rk = isManager() && p ? riskOf(p.id) : null;
    if (!i && !nw && !(rk && rk.level !== 'faible')) return '';
    return '<div class="notice info small">' + (i ? '<b>' + esc(i.text) + '</b>' + (i.relance ? '<br>' + esc(i.relance) + '.' : '') : '')
      + (nw ? (i ? '<br>' : '') + 'Nouveau dossier (coché le ' + fDMY(c.new_since) + ') : temps de production prévu majoré de ' + newMarginPct() + ' % pendant 3 mois.' : '')
      + (rk && rk.level !== 'faible' ? ((i || nw) ? '<br>' : '') + 'Risque ' + RISK_LABEL[rk.level][0].toLowerCase() + ' : ' + esc(rk.why.join(' · ')) + '.' : '') + '</div>';
  }
  /* V26.32 : score de risque d'un dossier non terminé (retard de réception, fin prévue après l'échéance, non planifié, client imprévisible, demande d'infos) */
  const RISK_LABEL = { eleve: ['Élevé', 'r'], moyen: ['Moyen', 'o'], faible: ['Faible', 'g'] };
  function riskOf(pid) {
    const p = S.data.productions.get(pid); if (!p) return null;
    const c = clientOf(p.client_id); if (!c) return null;
    const ts = list('tasks').filter(t => t.production_id === pid && t.kind !== 'info'), open = ts.filter(t => !t.done);
    if (!open.length) return null;
    const td = today(), why = []; let sc = 0;
    if (!p.received_date && p.expected_date && p.expected_date < td) { const d = E.daysBetween(p.expected_date, td); sc += d > 5 ? 4 : 3; why.push('éléments attendus depuis ' + d + ' j'); }
    if (open.some(t => !t.planned_date)) { sc += 3; why.push('non planifié'); }
    const due = open.map(t => t.due_date).filter(Boolean).sort()[0], end = open.map(t => t.planned_date).filter(Boolean).sort().pop();
    if (due && end && end > due) { sc += 4; why.push('fin prévue après l\'échéance du ' + fDM(due)); }
    else if (due && end && E.daysBetween(end, due) <= 1) { sc += 1; why.push('marge d\'un jour avant l\'échéance'); }
    if (due && due < td) { sc += 3; why.push('échéance dépassée'); }
    const m = agentModel().clients.get(c.id);
    if (m && m.reliability === 'imprevisible') { sc += 2; why.push('client imprévisible'); } else if (m && m.reliability === 'variable') { sc += 1; why.push('client variable'); }
    if (p.info_request === 'a_faire') { sc += 1; why.push('demande d\'infos à faire'); }
    if (isNewDossier(c)) { sc += 1; why.push('nouveau dossier'); }
    const cr = capRiskOf(pid); if (cr) { sc += 4; why.push('surcharge prévue : manque ' + E.fmtMin(cr.short) + ' avant l\'échéance'); }
    return { p, c, score: sc, level: sc >= 5 ? 'eleve' : sc >= 3 ? 'moyen' : 'faible', why, task: open[0] };
  }
  function riskSection(m) {
    const d = scopedData(), rs = d.productions.filter(p => p.month <= m && p.month >= E.addMonths(m, -1)).map(p => riskOf(p.id)).filter(r => r && r.level !== 'faible').sort((a, b) => b.score - a.score);
    const hi = rs.filter(r => r.level === 'eleve').length;
    // V26.84 : mois passés restés ouverts (dossiers traités hors de l'app) → bouton « Clôturer »
    const past = isManager() ? [...new Set(d.tasks.filter(t => !t.done && t.kind !== 'info' && E.windowOf(t.month, cfg()).end < today()).map(t => t.month))].sort() : []; // période de production terminée
    const closeBtns = past.map(pm => '<button class="btn sm" data-act="close-month" data-m="' + pm + '" title="Marque terminés tous les dossiers encore ouverts de ce mois passé (traités hors de l\'application)">' + ic('check', 'sm') + 'Clôturer ' + esc(fMonth(pm)) + '</button>').join('');
    return '<div class="section-t"><h2>Dossiers à risque</h2>' + closeBtns + (rs.length ? '<span class="badge ' + (hi ? 'r' : 'o') + '">' + hi + ' élevé(s) · ' + (rs.length - hi) + ' moyen(s)</span>' : '<span class="badge g">Aucun</span>') + '</div>'
      + '<div class="card">' + (rs.length ? '<div class="risk-list">' + rs.slice(0, 10).map(r => '<div class="row risk-row" data-act="task" data-id="' + r.task.id + '" role="button" tabindex="0" style="cursor:pointer;padding:6px 0;border-bottom:1px solid var(--line)"><span class="badge ' + RISK_LABEL[r.level][1] + '">' + RISK_LABEL[r.level][0] + ' · ' + r.score + '</span><b>' + esc(r.c.name) + '</b><span class="small muted" style="flex:1">' + esc(r.why.join(' · ')) + '</span><span class="small muted">' + esc((collabOf(r.task.collaborator_id) || {}).name || '') + '</span></div>').join('') + '</div>' + (rs.length > 10 ? '<div class="small muted" style="margin-top:6px">+ ' + (rs.length - 10) + ' autre(s)</div>' : '') : '<div class="muted">Aucun dossier à risque sur la période : réceptions à l\'heure, planning compatible avec les échéances.</div>') + '</div>';
  }
  /* V26.44 : surcharges prévues sur 3 mois (mois en cours et deux suivants), avant qu'elles arrivent */
  function capRisk() {
    if (!agentOn()) return { risks: [], team: [] };
    const key = S.agentKey + '|' + S.lastSync + '|' + S.data.tasks.size + '|' + S.data.productions.size + '|' + today();
    if (S.capRisk && S.capRiskKey === key) return S.capRisk;
    const m0 = defaultMonth(), months = [m0, E.addMonths(m0, 1), E.addMonths(m0, 2)];
    let r;
    try { r = E.capacityRisk(engineData(), months, today(), agentModel(), { doerOf }); } catch (e) { console.warn('capacityRisk', e); r = { risks: [], team: [] }; }
    S.capRisk = r; S.capRiskKey = key;
    logCapAlerts(r);
    return r;
  }
  const capRiskOf = pid => pid ? capRisk().risks.find(x => x.production_id === pid) : null;
  /* Chaque alerte est mémorisée une fois (historique) : sert à mesurer « surcharges vues à l'avance » */
  async function logCapAlerts(r) {
    if (S.readonly || !S.store.loadHistory) return;
    if (!S.capLogged) { S.capLogged = 'loading'; try { const h = await S.store.loadHistory({ action: 'alerte_surcharge', limit: 2000 }); S.capLogged = new Set(h.map(x => (x.detail || {}).production_id).filter(Boolean)); } catch (e) { S.capLogged = new Set(); } }
    if (S.capLogged === 'loading') return;
    const fresh = r.risks.filter(x => x.production_id && !S.capLogged.has(x.production_id) && (isManager() ? true : canSeeCollab(x.collab_id)));
    if (!fresh.length) return;
    fresh.forEach(x => S.capLogged.add(x.production_id));
    S.store.logHistory(fresh.map(x => ({ action: 'alerte_surcharge', entity: 'production', entity_id: x.production_id, client_id: x.client_id, detail: { production_id: x.production_id, due: x.due, flagged: today(), short: x.short, collab_id: x.collab_id, text: 'surcharge prévue : échéance du ' + fDMY(x.due) + ' menacée (manque ' + E.fmtMin(x.short) + ')' } }))).catch(() => { });
  }
  function capWhy(x) {
    const c = clientOf(x.client_id) || {};
    if (x.ready && x.ready >= x.due) return esc(c.name || 'Dossier') + ' — échéance ' + fDM(x.due) + ' · <b>pièces attendues le ' + fDM(x.ready) + ', après l\'échéance</b> : relancer le client';
    return esc(c.name || 'Dossier') + ' — échéance ' + fDM(x.due) + ' · manque ' + E.fmtMin(x.short) + (x.unplanned ? ' · aucune place avant l\'échéance' : '') + (x.learned ? ' · temps réel habituel plus long que prévu' : '') + (x.virtual ? ' · dossier ' + esc(deMonth(x.month)) + ' (pas encore créé)' : !x.received ? ' · pièces attendues vers le ' + fDM(x.ready) : '');
  }
  function capSection() {
    if (!isManager() || !agentOn()) return '';
    const r = capRisk(), vis = r.risks.filter(x => isAdmin() && !S.teamFilter ? true : scopedData().collaborators.some(c => c.id === x.collab_id));
    const byC = new Map(); vis.forEach(x => { if (!byC.has(x.collab_id)) byC.set(x.collab_id, []); byC.get(x.collab_id).push(x); });
    const free = scopedData().collaborators.filter(c => !byC.has(c.id)).map(c => c.name);
    const head = '<div class="section-t" id="cap-risk"><h2>Surcharges prévues</h2><span class="muted small">3 mois à venir · temps et dates de réception appris par l\'agent</span>' + (vis.length ? '<span class="badge r">' + vis.length + ' dossier(s)</span>' : '<span class="badge g">Aucune</span>') + '</div>';
    if (!vis.length) return head + '<div class="card"><div class="muted">Aucune surcharge prévue d\'ici ' + esc(fMonth(E.addMonths(defaultMonth(), 2))) + ' : chaque dossier trouve sa place avant son échéance.</div></div>';
    return head + '<div class="card"><div class="tasks">' + [...byC.entries()].map(([cid, xs]) => {
      const co = collabOf(cid) || { name: '?' }, short = xs.reduce((s, x) => s + x.short, 0);
      return '<div class="info-row" style="align-items:flex-start"><span class="mini-av" style="background:' + esc(co.color || '#888') + '">' + esc(initials(co.name)) + '</span><div class="t"><b>' + esc(co.name) + ' · ' + xs.length + ' dossier(s) menacé(s) · manque ' + E.fmtMin(short) + '</b>'
        + xs.slice(0, 4).map(x => '<span class="cap-li"' + (x.task_id ? ' data-act="task" data-id="' + x.task_id + '" style="cursor:pointer"' : '') + '>' + capWhy(x) + '</span>').join('') + (xs.length > 4 ? '<span class="muted cap-li">+ ' + (xs.length - 4) + ' autre(s)</span>' : '') + '</div></div>';
    }).join('') + '</div>' + (() => { const mm = defaultMonth(), rb = rebalanceProps(mm); return rb.length && !S.readonly ? '<div class="notice info small rb-cta" style="margin-top:8px">' + ic('users', 'sm') + '<span style="flex:1"><b>' + rb.length + ' réaffectation' + (rb.length > 1 ? 's' : '') + ' proposée' + (rb.length > 1 ? 's' : '') + '</b> : des collègues ont un créneau libre avant l\'échéance.</span><button class="btn sm primary" data-act="rb-open" data-m="' + mm + '">Voir les propositions</button></div>' : free.length ? '<div class="notice info small" style="margin-top:8px">Marge disponible : <b>' + free.map(esc).join(', ') + '</b> — confiez-leur un dossier menacé (fiche de la tâche › Collaborateur).</div>' : ''; })() + '</div>';
  }
  function capNoticeCollab(cid) {
    if (!agentOn()) return '';
    const xs = capRisk().risks.filter(x => x.collab_id === cid); if (!xs.length) return '';
    const first = xs[0], c = clientOf(first.client_id) || {};
    return '<div class="notice bad small anim-in" style="margin-bottom:var(--gap)"><b>Échéances à surveiller :</b> ' + xs.length + ' dossier(s) risquent de dépasser leur échéance d\'ici ' + esc(fMonth(E.addMonths(defaultMonth(), 2))) + ' (premier : <b>' + esc(c.name || '') + '</b>, échéance ' + fDM(first.due) + ', manque ' + E.fmtMin(first.short) + '). Parles-en à ton manager dès maintenant.</div>';
  }
  /* V26.34 : détail d'une carte Production du Pilotage (carte centrée) */
  function sheetProdDetail(s) {
    const m = S.month, td = today(), d = scopedData(), ts = d.tasks.filter(t => t.month === m && t.kind !== 'info');
    const rows = d.productions.filter(p => p.month === m).map(p => {
      const pt = ts.filter(t => t.production_id === p.id), c = clientOf(p.client_id) || { name: '?' };
      const done = pt.length > 0 && pt.every(t => t.done), planned = pt.length > 0 && pt.every(t => t.planned_date || t.done);
      // V26.91 : même définition que le compteur « En retard » (pièces en retard, date passée, échéance dépassée, ou fin prévue après l'échéance)
      const why = done ? '' : (!p.received_date && p.expected_date && p.expected_date < td) ? 'pièces attendues depuis le ' + fDM(p.expected_date) : pt.some(t => !t.done && t.due_date && t.due_date < td) ? 'échéance dépassée' : pt.some(t => !t.done && t.planned_date && E.endDate(t) < td) ? 'date planifiée passée' : pt.some(t => !t.done && t.planned_date && t.due_date && E.endDate(t) > t.due_date) ? 'fin prévue le ' + fDM(pt.filter(t => t.planned_date).map(t => E.endDate(t)).sort().pop()) + ', après l\'échéance du ' + fDM(pt.map(t => t.due_date).filter(Boolean).sort()[0]) : '';
      const late = !!why;
      return { p, c, pt, done, planned, late, why, rec: !!p.received_date };
    });
    const K = { 'dp-tot': ['Dossiers', r => true], 'dp-rec': ['Reçus', r => r.rec], 'dp-pla': ['Planifiés', r => r.planned], 'dp-don': ['Terminés', r => r.done], 'dp-lat': ['En retard', r => r.late] }[s.k] || ['Dossiers', r => true];
    const sel = rows.filter(K[1]).sort((a, b) => a.c.name.localeCompare(b.c.name, 'fr'));
    const st = r => r.done ? '<span class="badge g">Terminé</span>' : r.late ? '<span class="badge r" title="' + esc(r.why) + '">En retard · ' + esc(r.why) + '</span>' : r.rec ? '<span class="badge b">Reçu</span>' : '<span class="badge">Attendu le ' + fDM(r.p.expected_date) + '</span>';
    const body = sel.length ? '<div class="scroll-x"><table class="t"><thead><tr><th>Dossier</th><th>Collaborateur</th><th>État</th><th>Planifié</th><th class="num">Temps</th><th>Échéance</th></tr></thead><tbody>' + sel.map(r => { const t0 = r.pt[0]; const co = collabOf((t0 || {}).collaborator_id || r.c.collaborator_id); const pd = r.pt.map(t => t.planned_date).filter(Boolean).sort(); return '<tr' + (t0 ? ' data-act="task" data-id="' + t0.id + '" style="cursor:pointer"' : '') + '><td><b>' + esc(r.c.name) + '</b></td><td>' + esc(co ? co.name : '—') + '</td><td>' + st(r) + '</td><td class="nowrap">' + (pd.length ? fDM(pd[0]) + (pd.length > 1 && pd[pd.length - 1] !== pd[0] ? ' → ' + fDM(pd[pd.length - 1]) : '') : '—') + '</td><td class="num">' + E.fmtMin(r.pt.reduce((x, t) => x + (Number(t.duration_min) || 0), 0)) + '</td><td class="nowrap">' + (t0 && t0.due_date ? fDM(t0.due_date) : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">Aucun dossier.</div>';
    return sheetHead(K[0] + ' — ' + fMonth(m), sel.length + ' dossier(s) · cliquez sur une ligne pour ouvrir la tâche') + '<div class="sheet-b">' + body + '</div><div class="sheet-f"><button class="btn" data-act="close">Fermer</button></div>';
  }
  /* V26.104 : modification en échec affichée sur la fiche, avec Réessayer ou Abandonner (retour à la valeur enregistrée) */
  const failedNotice = (table, id) => '<div class="notice bad failed-note"><b>Modification non enregistrée</b> (erreur réseau) : les valeurs affichées ne sont pas encore en base.<div class="row" style="margin-top:8px;gap:8px"><button class="btn sm primary" data-act="retry">Réessayer</button><button class="btn sm" data-act="failed-drop" data-t="' + table + '" data-id="' + id + '">Abandonner la modification</button></div></div>';
  function sheetTask(s) {    const t = S.data.tasks.get(s.id); if (!t) return '';
    const c = clientOf(t.client_id) || { name: '?' }, p = S.data.productions.get(t.production_id), edit = canEditTask(t), lk = t.locked;
    const dis = (!edit || lk || t.done) ? ' disabled' : '';
    const co = collabOf(t.collaborator_id);
    return sheetHead(c.id ? '<button type="button" class="title-link" data-act="client" data-id="' + c.id + '" title="Ouvrir la fiche du dossier (paramètres et options)">' + esc(c.name) + '<span class="tl-go">' + ic('chevR', 'sm') + 'Fiche dossier</span></button>' : esc(c.name), E.KIND_LABEL[t.kind] + ' · ' + E.fmtMin(t.duration_min) + (co ? ' · ' + esc(co.name) : '') + ' · ' + esc(prodLine(p)))
      + '<div class="sheet-b">' + remoteNotice(s) + (() => { const r = lastRelance(p); return r && !(p && p.received_date) ? '<div class="notice small rel-note">' + ic(r.via === 'telephone' ? 'phone' : 'mail', 'sm') + ' Client ' + esc(relLabel(r)) + '.</div>' : ''; })()
      + '<div class="row">' + (t.done ? '<span class="badge g">' + ic('check') + 'Terminée</span>' : '<span class="badge">À faire</span>') + (lk ? '<span class="badge k">' + ic('lock') + 'Verrouillée</span>' : '') + (p && !p.received_date ? '<span class="badge">' + ic('calendar') + 'Prévisionnel</span>' : '<span class="badge b">' + ic('inbox') + 'Éléments reçus</span>') + (t.due_date ? '<span class="badge' + (E.daysBetween(today(), t.due_date) <= cfg().due_soon_days && !t.done ? ' o' : '') + '">Échéance TVA ' + fDM(t.due_date) + '</span>' : '') + '</div>'
      + (t.done && t.done_at ? '<div class="done-banner">' + ic('check', 'sm') + '<span>Tâche faite le <b>' + fDate(atDay(t.done_at)) + '</b>' + (t.planned_date && t.planned_date !== atDay(t.done_at) && !E.hasAlloc(t) ? ' (prévue le ' + fDM(t.planned_date) + ')' : '') + (t.actual_min ? ' · temps réel ' + E.fmtMin(t.actual_min) : '') + '</span></div>' // V26.166
        : (() => { const ds = (pIdx().tasks.get(t.production_id) || []).filter(x => x.id !== t.id && x.kind === t.kind && x.done && x.done_at).map(x => atDay(x.done_at)).sort(); return ds.length && t.kind !== 'info' ? '<div class="done-banner part">' + ic('clock', 'sm') + '<span>' + (ds.length > 1 ? ds.length + ' parties déjà faites : ' + ds.map(fDM).join(', ') : 'Une partie a été faite le <b>' + fDate(ds[0]) + '</b>') + ' · cette tâche est le reste à finir</span></div>' : ''; })())
      + (t._failed ? failedNotice('tasks', t.id) : '')
      + (lk ? '<div class="notice info">Tâche verrouillée : la replanification automatique ne modifie ni sa date, ni son collaborateur, ni sa durée. Déverrouillez pour la modifier.' + (edit && !S.readonly ? ' <button class="btn sm primary" data-act="lock" data-id="' + t.id + '" style="margin-left:8px">' + ic('lock', 'sm') + 'Déverrouiller</button>' : '') + '</div>' : '')
      + (!edit ? '<div class="notice">Lecture seule : cette tâche n\'est pas attribuée à votre collaborateur.</div>' : '')
      + '<div class="frame"><div class="frame-h">' + ic('route', 'sm') + '<h2>Parcours du dossier</h2></div><div class="inner">' + prodTimeline(p) + '</div></div>'
      + predictBox(p, t, c) + irBox(p) + waitBox(p) + filingBox(p) + (t.done && t.actual_min ? '<div class="notice ok">Temps réel : <b>' + E.fmtMin(t.actual_min) + '</b> (prévu ' + E.fmtMin(t.duration_min) + ')</div>' : '')
      + '<div class="form"><label class="f"><span>Date planifiée</span><input type="date" data-ch="t-date" data-id="' + t.id + '" value="' + (t.planned_date || '') + '"' + dis + '></label>'
      + '<label class="f"><span>Collaborateur</span><select data-ch="t-collab" data-id="' + t.id + '"' + (canEditTask(t) && !lk && !t.done ? '' : ' disabled') + '><option value="">—</option>' + collabs(true).filter(x => isAdmin() || canSeeCollab(x.id) || x.id === t.collaborator_id).map(x => '<option value="' + x.id + '"' + (x.id === t.collaborator_id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label>'
      + '<label class="f"><span>Durée prévue</span><input type="text" data-ch="t-dur" data-id="' + t.id + '" value="' + E.fmtMin(t.duration_min) + '"' + dis + '></label></div>'

      + histBlock(s, { entity_id: t.id }) + '</div>'
      + '<div class="sheet-f">' + (canSplit(t) ? '<button class="btn" data-act="task-split" data-id="' + t.id + '" title="La partie faite est terminée, le reste passe en tête du jour ouvré suivant (commentaire obligatoire)">' + ic('clock', 'sm') + 'Non terminée en totalité</button>' : '') + (edit ? '<button class="btn" data-act="lock" data-id="' + t.id + '">' + ic('lock', 'sm') + (lk ? 'Déverrouiller' : 'Verrouiller') + '</button><button class="btn ' + (t.done ? '' : 'primary') + '" data-act="done" data-id="' + t.id + '">' + (t.done ? ic('refresh', 'sm') + 'Rouvrir' : ic('check', 'sm') + 'Terminer') + '</button>' : '') + '<button class="btn" data-act="close">Fermer</button></div>';
  }

  function sheetClient(s) {
    const isNew = !s.id, c = isNew ? s.draft : S.data.clients.get(s.id);
    if (!c) return '';
    const ro = S.readonly || !(isManager() || (isRC() && (isNew || binomeIds().has(c.collaborator_id))) || (!isNew && clientEditor() && canSeeCollab(c.collaborator_id))) ? ' disabled' : ''; // V26.202 : exception « modifier les fiches dossiers » // V26.145 : le RC crée et règle les dossiers de son équipe
    const f = (k, l, v, type, extra) => '<label class="f"><span>' + l + '</span><input type="' + (type || 'text') + '" data-ch="c-field" data-k="' + k + '" value="' + esc(v === null || v === undefined ? '' : v) + '"' + ro + (extra || '') + '></label>';
    const m = S.month, p = !isNew && list('productions').find(x => x.client_id === c.id && x.month === m);
    const ts = p ? list('tasks').filter(t => t.production_id === p.id).sort((a, b) => E.KINDS.indexOf(a.kind) - E.KINDS.indexOf(b.kind)) : [];
    const total = E.clientTime(c), co = collabOf(c.collaborator_id), rc = co && collabOf(co.rc_id);
    const byField = (k, l) => '<label class="f"><span>' + l + '</span><select data-ch="c-field" data-k="' + k + '"' + ro + '><option value="collab"' + (c[k] !== 'rc' ? ' selected' : '') + '>' + esc(co ? co.name : 'Collaborateur') + ' (collaborateur)</option><option value="rc"' + (c[k] === 'rc' ? ' selected' : '') + '>' + esc(rc ? rc.name : 'RC') + ' (RC)</option></select></label>';
    return sheetHead(isNew ? 'Nouveau dossier' : esc(c.name), isNew ? '' : 'Temps de production : ' + E.fmtMin(total) + ' par période')
      + '<div class="sheet-b">' + remoteNotice(s) + (!isNew && c._failed ? failedNotice('clients', c.id) : '')
      + '<div class="form">' + f('name', 'Client', c.name)
      + '<label class="f"><span>Collaborateur responsable</span><select data-ch="c-field" data-k="collaborator_id"' + ro + '><option value="">—</option>' + collabs(true).map(co => '<option value="' + co.id + '"' + (co.id === c.collaborator_id ? ' selected' : '') + '>' + esc(co.name) + '</option>').join('') + '</select></label>'
      + '<label class="f"><span>Fréquence</span><select data-ch="c-field" data-k="frequency"' + ro + '>' + Object.keys(E.FREQ_LABEL).map(k => '<option value="' + k + '"' + (k === c.frequency ? ' selected' : '') + '>' + E.FREQ_LABEL[k] + '</option>').join('') + '</select></label>'
      + f('reception_day', 'Réception habituelle (jour du mois)', c.reception_day, 'number', ' min="1" max="31"')
      + f('time_min', 'Temps de production (tenue + lettrage + TVA)', E.fmtMin(E.clientTime(c))) + (hasRc(c) ? byField('production_by', 'Production faite par') : '<div></div>')
      + '<label class="f"><span>Régime de TVA</span><select data-ch="c-field" data-k="vat_regime"' + ro + '>' + Object.keys(E.VAT_REGIMES).map(k => '<option value="' + k + '"' + (k === (c.vat_regime || 'ca3_mensuel') ? ' selected' : '') + '>' + E.VAT_REGIMES[k] + '</option>').join('') + '</select></label>' + f('vat_due_day', 'Échéance TVA (jour du mois)', c.vat_due_day, 'number', ' min="1" max="31"')
      + '<div class="f" style="justify-content:flex-end"><div class="row" style="gap:16px;min-height:42px"><label class="cb"><input type="checkbox" data-ch="c-field" data-k="deb"' + (c.deb ? ' checked' : '') + ro + '> DEB</label><label class="cb"><input type="checkbox" data-ch="c-field" data-k="des"' + (c.des ? ' checked' : '') + ro + '> DES</label><label class="cb" title="Acomptes d\'IS à verser les 15 mars, 15 juin, 15 septembre et 15 décembre"><input type="checkbox" data-ch="c-field" data-k="is_acompte"' + (c.is_acompte ? ' checked' : '') + ro + '> Acomptes IS</label><label class="cb" title="À cocher uniquement pour un dossier réellement nouveau : son temps de production est majoré de ' + newMarginPct() + ' % pendant 3 mois (réglable dans Paramètres)."><input type="checkbox" data-ch="c-field" data-k="new_since"' + (c.new_since ? ' checked' : '') + ro + '> Nouveau dossier' + (c.new_since && isNewDossier(c) ? ' <span class="small muted">(marge jusqu\'au ' + fDM(E.addMonths(c.new_since.slice(0, 7), 3) + c.new_since.slice(7, 10)) + ')</span>' : '') + '</label><label class="cb" title="La tenue comptable est sous-traitée : le cabinet ne fait que la TVA. Un rappel s\'affiche au collaborateur quand il saisit son temps."><input type="checkbox" data-ch="c-field" data-k="sous_traitance"' + (c.sous_traitance ? ' checked' : '') + ro + '> Sous-traitance en place</label><label class="cb" title="Chaque année, un rappel au 5 novembre pour récupérer l\'avis de CFE, puis suivi du montant et du paiement dans « TVA & autres impôts »."><input type="checkbox" data-ch="c-field" data-k="cfe"' + (c.cfe ? ' checked' : '') + ro + '> Suivi CFE</label><label class="cb" title="Déclaration 1329-DEF et solde de CVAE au plus tard le 5 mai : rappel à partir du 1er mai, suivi dans « TVA & autres impôts »."><input type="checkbox" data-ch="c-field" data-k="cvae"' + (c.cvae ? ' checked' : '') + (S.readonly ? ' disabled' : '') + '> Suivi CVAE</label>' + (() => { const ap = apprenticeFor(Object.assign({}, c, { apprenti: true })); return ap || c.apprenti ? '<label class="cb" title="La production de ce dossier est confiée à l\'apprenti et apparaît dans son planning (ses jours en entreprise)."><input type="checkbox" data-ch="c-field" data-k="apprenti"' + (c.apprenti ? ' checked' : '') + ro + '> Apprenti' + (ap ? '' :' <span class="small muted">(aucun apprenti rattaché)</span>') + '</label>' : ''; })() + '</div></div>' + (c.is_acompte ? f('is_cloture', 'Date de clôture (JJ/MM)', c.is_cloture ? c.is_cloture.slice(3) + '/' + c.is_cloture.slice(0, 2) : '', 'text', ' placeholder="31/12" maxlength="5"') : '') + '<label class="f"><span>Priorité</span><select data-ch="c-field" data-k="priority"' + ro + '>' + [1, 2, 3].map(k => '<option value="' + k + '"' + (k === Number(c.priority) ? ' selected' : '') + '>' + E.PRIORITY_LABEL[k] + '</option>').join('') + '</select></label></div>'
      + (S.v8 ? '<div class="form"><label class="f"><span>Tableau de bord client</span><select data-ch="c-field" data-k="dashboard_freq"' + ro + '><option value="">Aucun</option><option value="mensuel"' + (c.dashboard_freq === 'mensuel' ? ' selected' : '') + '>Mensuel</option><option value="trimestriel"' + (c.dashboard_freq === 'trimestriel' ? ' selected' : '') + '>Trimestriel</option></select></label>'
        + (c.dashboard_freq ? f('dashboard_day', 'À publier avant le (jour du mois suivant)', c.dashboard_day || 25, 'number', ' min="1" max="31"') + f('dashboard_min', 'Temps du tableau de bord', E.fmtMin(c.dashboard_min || 0)) + (hasRc(c) ? byField('dashboard_by', 'Tableau de bord fait par') : '') : '') + '</div>'
        + (c.dashboard_freq ? '<p class="small muted" style="margin:-4px 0 0">Ex. : le tableau de bord de septembre est à faire et publier avant le ' + (c.dashboard_day || 25) + ' octobre' + (c.dashboard_freq === 'trimestriel' ? ' (trimestriel : en janvier, avril, juillet et octobre)' : '') + '.</p>' : '') : '')
      + '<label class="f"><span>Particularités</span><textarea data-ch="c-field" data-k="notes"' + ro + '>' + esc(c.notes || '') + '</textarea></label>'
      + (!isNew ? '<label class="cb"><input type="checkbox" data-ch="c-field" data-k="active"' + (c.active !== false ? ' checked' : '') + ro + '> Dossier actif <span class="small muted">— décocher pour griser le dossier et l\'exclure de la planification</span></label>' + (c.active === false ? '<div class="notice warn">Dossier inactif : il est grisé et n\'est plus pris en compte dans la planification ni dans les indicateurs. Recochez « Dossier actif » pour le réintégrer.</div>' : '') : '')
      + (!isNew ? '<div class="card" style="box-shadow:none"><div class="card-h"><h3 class="cap">' + fMonth(m) + '</h3>' + (p ? '<span>' + esc(prodLine(p)) + '</span>' : '') + '</div>'
        + (p ? '<div class="row" style="margin-bottom:10px">' + (p.received_date ? '<button class="btn sm" data-act="rec-undo" data-id="' + p.id + '">Annuler la réception</button>' : (p.expected_date < today() ? '<button class="btn icon sm rl-btn" data-act="relance" data-pid="' + p.id + '" title="Texte de relance à copier" aria-label="Relancer le client">' + ic('mail', 'sm') + '</button><button type="button" class="btn icon sm rl-btn rl-tel" data-act="relance-tel" data-pid="' + p.id + '" title="Client relancé par téléphone : noter la relance" aria-label="Client relancé par téléphone">' + ic('phone', 'sm') + '</button>' : '') + '<button class="btn sm primary" data-act="rec-one" data-id="' + p.id + '">📥 Éléments reçus aujourd\'hui</button>' + (S.v7 ? '<button class="btn sm" data-act="rec-part" data-id="' + p.id + '">◐ Réception partielle</button>' : '')) + '</div>' + irBox(p) + waitBox(p) + filingBox(p) + '<div class="tasks" style="margin-top:12px">' + (ts.map(t => taskRow(t, { showDate: true, showCollab: true })).join('') || '<div class="empty">Aucune tâche (temps à 0).</div>') + '</div>' : '<div class="empty">Ce dossier n\'est pas encore créé pour ce mois.</div>') + '</div>'
        + histBlock(s, { client_id: c.id }) : '')
      + '</div><div class="sheet-f">' + (isNew ? '<button class="btn" data-act="close">Annuler</button><button class="btn primary" data-act="client-create">Créer le dossier</button>' : (isManager() ? '<button class="btn danger" data-act="client-del" data-id="' + c.id + '">Supprimer</button><span class="spacer"></span>' : '') + '<span class="small muted">Enregistrement automatique</span><button class="btn" data-act="close">Fermer</button>') + '</div>';
  }

  /* V26.74 : calendrier annuel des jours de présence en entreprise d'un apprenti */
  function presenceCalendar(c) {
    const y = S.presYear || Number(today().slice(0, 4)), pres = new Set(c.presence_dates || []), edit = isAdmin() || isManager(), td = today();
    const months = Array.from({ length: 12 }, (_, i) => y + '-' + String(i + 1).padStart(2, '0'));
    const n = [...pres].filter(d => d.startsWith(y + '-')).length;
    const grid = months.map(m => {
      const days = E.monthDates(m).filter(d => E.dow(d) <= 5), lead = E.dow(days[0]) - 1;
      return '<div class="pc-m"><div class="pc-t cap">' + fMonth(m) + '</div><div class="pc-g">' + ['L', 'M', 'M', 'J', 'V'].map(w => '<span class="pc-w">' + w + '</span>').join('') + '<span></span>'.repeat(lead)
        + days.map(d => { const hol = E.holidayName(d), on = pres.has(d); return '<button type="button" class="pc-d' + (on ? ' on' : '') + (hol ? ' hol' : '') + (d === td ? ' td' : '') + '"' + (edit && !hol ? ' data-act="pres-day" data-d="' + d + '"' : ' disabled') + ' title="' + fDate(d) + (hol ? ' · férié' : on ? ' · en entreprise' : ' · école / hors entreprise') + '">' + Number(d.slice(8)) + '</button>'; }).join('') + '</div></div>';
    }).join('');
    return '<div class="pres-cal"><div class="row" style="margin-bottom:8px"><h3 style="margin:0">Jours de présence en entreprise</h3><span class="spacer"></span><button class="btn sm" data-act="pres-year" data-d="-1" aria-label="Année précédente">‹</button><b>' + y + '</b><button class="btn sm" data-act="pres-year" data-d="1" aria-label="Année suivante">›</button></div>'
      + '<p class="small muted" style="margin:0 0 8px">Cliquez un jour pour le marquer « en entreprise ». L\'apprenti n\'est planifié que ces jours-là (' + n + ' jour' + (n > 1 ? 's' : '') + ' en ' + y + ').' + (edit ? '' : ' Modifiable par un manager.') + '</p>'
      + (edit ? '<div class="row" style="gap:6px;margin-bottom:10px;flex-wrap:wrap"><span class="small muted">Tous les</span>' + DAYS.slice(0, 5).map((w, i) => { const on = [...pres].some(d => d >= td && d.startsWith(y + '-') && E.dow(d) === i + 1); return '<button class="btn sm pres-w' + (on ? ' on' : '') + '" data-act="pres-dow" data-w="' + (i + 1) + '" aria-pressed="' + on + '" title="' + (on ? 'Retirer tous les ' + w + 's à venir de ' + y + ' (école)' : 'Mettre tous les ' + w + 's à venir de ' + y + ' en entreprise') + '">' + (on ? ic('check', 'sm') : '') + DAYS_S[i] + '</button>'; }).join('') + '<button class="btn sm danger" data-act="pres-clear">Tout effacer ' + y + '</button></div>' : '')
      + '<div class="pc-y">' + grid + '</div></div>';
  }
  function sheetCollab(s) {    const isNew = !s.id, c = isNew ? s.draft : S.data.collaborators.get(s.id);
    if (!c) return '';
    const abs = isNew ? [] : list('absences').filter(a => a.collaborator_id === c.id).sort((a, b) => b.date_from.localeCompare(a.date_from));
    return sheetHead(isNew ? 'Nouveau collaborateur' : esc(c.name))
      + '<div class="sheet-b">' + remoteNotice(s) + '<div class="form"><label class="f"><span>Nom</span><input type="text" data-ch="co-field" data-k="name" value="' + esc(c.name || '') + '"></label>'
      + hoursField(c, isNew) // V26.208 : horaires de la semaine (contrats 39 h / 35 h)
      + (!isNew && (isManager() || isAdmin()) && c.kind !== 'apprenti' ? (() => { const by = cfg().reserve_min_by || {}, own = by[c.id] !== undefined && by[c.id] !== null && by[c.id] !== '', r = E.reserveOf(c, cfg()), cab = Number(cfg().reserve_min) || 0; // V26.207 : imprévus réservés à la personne, en minutes (jamais pour un apprenti)
        return '<label class="f"><span>Temps réservé aux imprévus</span><select data-ch="co-reserve"' + (S.readonly ? ' disabled' : '') + '><option value=""' + (own ? '' : ' selected') + '>Comme le cabinet (' + (cab ? E.fmtMin(cab) : 'aucun') + ')</option>' + [0, 15, 30, 45, 60, 90, 120].map(v => '<option value="' + v + '"' + (own && Number(by[c.id]) === v ? ' selected' : '') + '>' + (v ? E.fmtMin(v) + ' par jour' : 'Aucun') + '</option>').join('') + '</select><em class="small muted">' + (r ? 'soit ' + E.fmtMin(r) + ' de moins chaque jour pour le planning' : 'toute la journée est planifiable') + '</em></label>'; })() : '')
      + '<label class="f"><span>Couleur</span><input type="color" data-ch="co-field" data-k="color" value="' + esc(c.color || '#2f6fd0') + '" style="min-height:38px;width:100%"></label>'
      + (S.v8 ? '<label class="f"><span>Fonction</span><select data-ch="co-field" data-k="kind"' + (isAdmin() ? '' : ' disabled') + '><option value="collab"' + (c.kind !== 'rc' && c.kind !== 'apprenti' ? ' selected' : '') + '>Collaborateur comptable</option><option value="rc"' + (c.kind === 'rc' ? ' selected' : '') + '>Responsable client (RC)</option>' + (v17() ? '<option value="apprenti"' + (c.kind === 'apprenti' ? ' selected' : '') + '>Apprenti</option>' : '') + '</select></label>'
        + '<label class="f"><span>Équipe</span><select data-ch="co-field" data-k="team_id"' + (isAdmin() ? '' : ' disabled') + '><option value="">—</option>' + list('teams').sort(byName).map(tm => '<option value="' + tm.id + '"' + (tm.id === c.team_id ? ' selected' : '') + '>' + esc(tm.name) + '</option>').join('') + '</select></label>'
        + (c.kind === 'apprenti' ? '<label class="f"><span>Rattaché à (tuteur)</span><select data-ch="co-field" data-k="tutor_id"' + (isAdmin() || isManager() ? '' : ' disabled') + '><option value="">—</option>' + collabs(true).filter(x => x.kind !== 'apprenti' && x.id !== c.id).map(x => '<option value="' + x.id + '"' + (x.id === c.tutor_id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label><label class="f"><span>En binôme avec (collaborateur)</span><select data-ch="co-field" data-k="rc_id"' + (isAdmin() || isManager() ? '' : ' disabled') + '><option value="">—</option>' + collabs(true).filter(x => x.kind !== 'apprenti' && x.id !== c.id).map(x => '<option value="' + x.id + '"' + (x.id === c.rc_id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label>' : c.kind !== 'rc' ? '<label class="f"><span>Binôme : son RC</span><select data-ch="co-field" data-k="rc_id"' + (isAdmin() ? '' : ' disabled') + '><option value="">—</option>' + collabs(true).filter(x => x.kind === 'rc' && x.id !== c.id).map(x => '<option value="' + x.id + '"' + (x.id === c.rc_id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label>' : '<div class="f"><span>Binôme</span><div class="small" style="padding-top:10px">' + (collabs(true).filter(x => x.rc_id === c.id).map(x => esc(x.name)).join(', ') || 'RC hybride (pas de collaborateur)') + '</div></div>') : '') + '</div>'
      + '<div><div class="small muted" style="margin-bottom:6px"><b>Jours travaillés</b></div><div class="chips">' + [1, 2, 3, 4, 5].map(d => '<label class="chip' + ((c.work_days || []).includes(d) ? ' on' : '') + '"><input type="checkbox" data-ch="co-day" data-d="' + d + '"' + ((c.work_days || []).includes(d) ? ' checked' : '') + ' style="display:none">' + DAYS[d - 1] + '</label>').join('') + '</div></div>'
      + (!isNew && c.kind === 'apprenti' ? presenceCalendar(c) : '')
      + (!isNew ? '<label class="cb"><input type="checkbox" data-ch="co-field" data-k="active"' + (c.active !== false ? ' checked' : '') + '> Actif</label>'
        + '<div><h3 style="margin-bottom:8px">Congés, absences, formations</h3>' + (abs.length ? '<table class="t"><tbody>' + abs.map(a => '<tr><td>' + esc(absLabel(a)) + '</td><td>' + fDMY(a.date_from) + (a.date_to !== a.date_from ? ' → ' + fDMY(a.date_to) : '') + '</td><td class="small muted">' + esc(a.note || '') + '</td><td class="num"><button class="btn sm danger" data-act="abs-del" data-id="' + a.id + '">✕</button></td></tr>').join('') + '</tbody></table>' : '<div class="empty">Aucune.</div>')
        + '<div class="form" style="margin-top:10px"><label class="f"><span>Du</span><input type="date" id="abs-from"></label><label class="f"><span>Au</span><input type="date" id="abs-to"></label>'
        + '<label class="f"><span>Type</span><select id="abs-kind">' + ABS_KINDS.map(k => '<option value="' + k[0] + '">' + k[1] + '</option>').join('') + '</select></label>'
        + absPartField() + '<label class="f"><span>Précision (ex. séminaire, réunion d\'équipe)</span><input type="text" id="abs-note" placeholder="Formation TVA, réunion interne…"></label></div>'
        + '<div class="row" style="margin-top:8px"><button class="btn" data-act="abs-add" data-id="' + c.id + '">+ Ajouter l\'indisponibilité</button><span class="small muted">Les dossiers prévus ces jours-là sont replacés automatiquement.</span></div></div>' : '')
      + '</div><div class="sheet-f">' + (isNew ? '<button class="btn" data-act="close">Annuler</button><button class="btn primary" data-act="collab-create">Créer</button>' : '<button class="btn danger" data-act="collab-del" data-id="' + c.id + '">Supprimer</button><span class="spacer"></span><span class="small muted">Enregistrement automatique</span><button class="btn" data-act="close">Fermer</button>') + '</div>';
  }

  function sheetUser(s) {
    const isNew = !s.id, u = isNew ? s.draft : S.data.app_users.get(s.id);
    if (!u) return '';
    return sheetHead(isNew ? 'Nouvel utilisateur' : esc(u.name))
      + '<div class="sheet-b">' + remoteNotice(s) + '<div class="form"><label class="f"><span>Nom</span><input type="text" data-ch="u-field" data-k="name" value="' + esc(u.name || '') + '"></label>'
      + '<label class="f"><span>E-mail (identifiant de connexion)</span><input type="email" data-ch="u-field" data-k="email" value="' + esc(u.email || '') + '"' + (isNew ? '' : ' disabled') + '></label>'
      + '<label class="f"><span>Rôle</span><select data-ch="u-field" data-k="role">' + [['collab', 'Membre (RC ou collaborateur)'], ['apprenti', 'Apprenti'], ['manager', 'Manager']].concat([['admin', 'Administrateur']]).map(o => '<option value="' + o[0] + '"' + ((u.role || 'collab') === o[0] ? ' selected' : '') + ((o[0] === 'manager' && !S.v8) || (o[0] === 'apprenti' && !v17()) ? ' disabled' : '') + '>' + o[1] + ((o[0] === 'manager' && !S.v8) || (o[0] === 'apprenti' && !v17()) ? ' (base à mettre à jour)' : '') + '</option>').join('') + '</select></label>'
      + (!S.v8 ? '<div class="notice warn small" style="grid-column:1/-1">Le rôle <b>Manager</b> (et les équipes) nécessite une mise à jour de la base : exécutez <code>supabase/migration_v1_8.sql</code> puis <code>migration_v1_9.sql</code> dans Supabase › SQL Editor, puis rechargez la page.</div>' : '')
      + '<label class="f"><span>Collaborateur lié (son planning)</span><select data-ch="u-field" data-k="collaborator_id"><option value="">—</option>' + collabs(true).map(co => '<option value="' + co.id + '"' + (co.id === u.collaborator_id ? ' selected' : '') + '>' + esc(co.name) + '</option>').join('') + '</select></label>'
      // V26.168 : début d'utilisation propre à la personne (RC, collaborateur, apprenti) — rien n'apparaît avant pour elle
      + (['manager', 'admin'].includes(u.role || 'collab') ? '' : '<label class="f" style="grid-column:1/-1"><span>Début d\'utilisation (première période de TVA)</span><select data-ch="u-start">' + (isNew ? startOptions(s.draft.start || defaultMonth(), cabStart()) : startOptions(userStartOf(u.email), cabStart(), true)) + '</select></label>') + '</div>'
      + (['manager', 'admin'].includes(u.role || 'collab') ? '' : '<p class="small muted" style="margin:-4px 0 0">Avant ce mois, rien n\'apparaît pour cette personne : ni dossiers, ni réceptions, ni relances, ni historique. Le manager garde la vue de tout le cabinet.</p>')
      + (!isNew ? '<label class="cb"><input type="checkbox" data-ch="u-field" data-k="active"' + (u.active ? ' checked' : '') + '> Accès actif</label>' : '')
      // V26.202 : exception — modifier tous les paramètres des fiches de ses dossiers (administrateur seulement)
      + (!isNew && isAdmin() && !['manager', 'admin'].includes(u.role || 'collab') ? '<label class="cb" style="grid-column:1/-1"><input type="checkbox" data-ch="u-cedit"' + ((cfg().client_editors || []).map(x => String(x).toLowerCase()).includes(String(u.email || '').toLowerCase()) ? ' checked' : '') + '> <b>Exception</b> : peut modifier tous les paramètres des fiches de ses dossiers</label>' : '')
      + '<div class="notice small"><b>Administrateur</b> : tout le cabinet, paramètres, équipes, utilisateurs.<br><b>Manager</b> : tout le planning de ses équipes et la partie Pilotage (projection, agent, propositions), congés de ses collaborateurs.<br><b>Apprenti</b> : son planning (uniquement ses jours en entreprise) et celui de son tuteur. Réglez « Fonction : Apprenti », le tuteur et le calendrier de présence sur la fiche du collaborateur lié.<br><b>Membre</b> : son espace et celui de son binôme (un RC voit son ou ses collaborateurs, un collaborateur voit son RC). Qu\'il soit RC ou collaborateur se règle sur la fiche du collaborateur lié.</div>'
      + '</div><div class="sheet-f">' + (isNew ? '<button class="btn" data-act="close">Annuler</button><button class="btn primary" data-act="user-create">Ajouter</button>' : '<span class="small muted">Enregistrement automatique</span><button class="btn" data-act="close">Fermer</button>') + '</div>';
  }

  function sheetReplan(s) {
    const r = s.result, m = s.month;
    const moves = r.moved.map(mv => { const t = S.data.tasks.get(mv.id); return t ? { t, mv } : null; }).filter(Boolean)
      .sort((a, b) => (a.mv.to || '9').localeCompare(b.mv.to || '9'));
    // V26.186 : depuis le Planning, « Optimiser le planning » — un résumé d'abord, les propositions ensuite, rien ne bouge sans « Appliquer »
    const st = s.opt && s.stats, opt = st ? '<div class="pc-optsum"><div><b>' + st.over + '</b><span>journée' + (st.over > 1 ? 's' : '') + (isManager() ? ' en surcharge' : ' très remplie' + (st.over > 1 ? 's' : '')) + ' (≥ ' + ALERT_PCT + ' %)</span></div><div><b>' + st.free + '</b><span>collaborateur' + (st.free > 1 ? 's' : '') + ' disponible' + (st.free > 1 ? 's' : '') + '</span></div><div><b>' + r.moved.length + '</b><span>tâche' + (r.moved.length > 1 ? 's peuvent' : ' peut') + ' être déplacée' + (r.moved.length > 1 ? 's' : '') + '</span></div></div>'
      + (moves.length && !s.showMoves ? '<div><button class="btn" data-act="moves-toggle">Voir les propositions</button></div>' : '') : '';
    return sheetHead(st ? '⚡ Optimiser le planning' : '🔄 Replanifier ' + fMonth(m), (st ? fMonth(m) + ' · ' : '') + 'Période du ' + fDM(r.window.start) + ' au ' + fDM(r.window.end) + ' · calcul à partir du ' + fDM(today() > r.window.start ? today() : r.window.start))
      + '<div class="sheet-b">' + opt + (r.scoped ? '<div class="notice small">Seul ton planning' + (binomeIds().size > 1 ? ' (et celui des personnes que tu suis : ' + esc([...binomeIds()].filter(id => id !== S.me.collaborator_id).map(id => (collabOf(id) || {}).name || '').filter(Boolean).join(', ')) + ')' : '') + ' est replanifié. Les plannings des autres ne bougent pas.</div>' : '') + '<div class="summary-big">' + (st ? '' : '<div><b>' + r.moved.length + '</b> tâche' + (r.moved.length > 1 ? 's' : '') + ' ser' + (r.moved.length > 1 ? 'ont' : 'a') + ' déplacée' + (r.moved.length > 1 ? 's' : '') + '.</div>')
      + '<div>🔒 <b>' + r.lockedCount + '</b> tâche' + (r.lockedCount > 1 ? 's restent verrouillées' : ' reste verrouillée') + '.</div>'
      + '<div class="small muted">Non déplacées : ' + r.doneCount + ' tâche(s) terminée(s)' + (s.force ? '.' : ' et les dossiers reçus prévus dans la zone figée (jusqu\'au ' + fDM(E.freezeEnd(today(), cfg().freeze_days)) + ').') + '</div>'
      + '<div style="color:' + (r.problems.length ? 'var(--red)' : 'var(--green)') + '">' + (r.problems.length ? '⚠️ <b>' + r.problems.length + '</b> échéance' + (r.problems.length > 1 ? 's restent problématiques' : ' reste problématique') + '.' : '🟢 Aucune échéance problématique.') + '</div></div>'
      + '<label class="cb"><input type="checkbox" data-ch="replan-force"' + (s.force ? ' checked' : '') + '> <b>Forcer</b> : replanifier aussi la zone figée (aujourd\'hui' + (cfg().freeze_days === 1 ? ' et le jour ouvré suivant' : cfg().freeze_days > 1 ? ' et les ' + cfg().freeze_days + ' jours ouvrés suivants' : '') + ')</label>'
      + (r.problems.length ? '<div class="notice warn">' + r.problems.map(pb => esc((clientOf(pb.client_id) || {}).name) + ' : ' + pb.reason).join('<br>') + '</div>' : '')
      + (moves.length && !(st && !s.showMoves) ? (s.showMoves ? '<h3>' + (st ? 'Propositions de déplacement' : 'Détail des déplacements') + '</h3><table class="t"><tbody>' + moves.map(x => '<tr><td>' + esc((clientOf(x.t.client_id) || {}).name) + '</td><td>' + E.KIND_LABEL[x.t.kind] + '</td><td class="small">' + esc((collabOf(x.t.collaborator_id) || {}).name || '') + '</td><td class="nowrap">' + (x.mv.from ? fDM(x.mv.from) : '—') + ' → <b>' + (x.mv.to ? fDM(x.mv.to) : 'non planifiée') + '</b></td></tr>').join('') + '</tbody></table>' : '<div><button class="btn sm" data-act="moves-toggle">Voir le détail des déplacements</button></div>') : '')
      + '</div><div class="sheet-f"><button class="btn big" data-act="close">Annuler</button><button class="btn primary big" data-act="replan-apply"' + (r.changes.length ? '' : ' disabled') + '>Appliquer</button></div>';
  }

