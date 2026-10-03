  /* ====================== Actions métier ====================== */
  function nextSeq(collabId, date) { return dayTasks(collabId, date).reduce((m, t) => Math.max(m, Number(t.seq) || 0), 0) + 1; }
  /* Zone figée : aujourd'hui + N jour(s) ouvré(s) (Paramètres) — ignorée si la replanification est forcée */
  function runPlan(month, mode, newly, opts) { return E.plan(Object.assign(engineData(), { month, today: today(), mode, newlyReceived: newly, freezeUntil: E.freezeEnd(today(), cfg().freeze_days), force: !!(opts && opts.force) })); }
  // V26.106 : les planifications s'appliquent l'une après l'autre (jamais deux enregistrements de planning en parallèle)
  async function applyPlan(res) {
    const items = res.changes.map(c => ({ id: c.id, patch: { planned_date: c.planned_date, seq: c.seq, alloc: c.alloc || null } }));
    preApply('tasks', items); // visible tout de suite par tout calcul suivant
    const run = () => saveMany('tasks', items);
    const p = (S._planChain || Promise.resolve()).then(run, run); S._planChain = p.catch(() => { }); return p;
  }
  async function moveTask(t, date, toCollab) {
    if (!canEditTask(t) || t.locked || t.done) return;
    if (date && !E.isWorkday(date)) { const nd = E.nextWorkday(date); toast(fDate(date) + (E.holidayName(date) ? ' est férié (' + E.holidayName(date) + ')' : ' est un week-end') + ' : déplacé au ' + fDate(nd) + '.', 'warn', null, 4000); date = nd; }
    // V26.74 : glisser-déposer entre le planning du tuteur et celui de son apprenti
    const who = toCollab && toCollab !== t.collaborator_id && canSeeCollab(toCollab) ? toCollab : t.collaborator_id;
    const ap = collabOf(who);
    if (date && ap && ap.kind === 'apprenti' && !E.capacityOn(ap, date, ctx())) toast(ap.name + ' n\'est pas en entreprise le ' + fDate(date) + ' : la tâche est posée ce jour-là quand même.', 'warn', null, 4500);
    // Un dossier plus long qu'une journée est étalé sur les jours ouvrés suivants
    const alloc = date ? E.spread(collabOf(who), date, Number(t.duration_min) || 0, ctx()) : null;
    const patch = { planned_date: date || null, seq: date ? nextSeq(who, date) : 0, alloc: alloc || null };
    if (who !== t.collaborator_id) patch.collaborator_id = who;
    // V26.91 : un dossier non planifié posé à la main est verrouillé, pour que la replanification ne le retire pas
    if (!t.planned_date && date) patch.locked = true;
    if (cfg().auto_lock_on_move) patch.locked = true;
    const r = await saveUpdate('tasks', t.id, patch, { history: { action: 'deplacement', entity: 'task', entity_id: t.id, client_id: t.client_id, detail: { kind: t.kind, from: t.planned_date, to: date || null } } });
    if (r === 'ok' && patch.collaborator_id) toast((clientOf(t.client_id) || {}).name + ' → planning de ' + (collabOf(who) || {}).name + '.', 'ok', null, 3000);
    const end = alloc ? Object.keys(alloc).sort().pop() : date;
    if (r === 'ok' && end && t.due_date && end > t.due_date) toast('Attention : fin prévue après l\'échéance TVA (' + fDM(t.due_date) + ').', 'warn');
    if (r === 'ok' && alloc) toast('Dossier étalé sur ' + Object.keys(alloc).length + ' jours ouvrés (' + E.fmtMin(t.duration_min) + ').', 'ok', null, 3500);
  }
  /* Répartition d'une tâche terminée : les jours à venir sont ramenés à aujourd'hui. */
  function doneSpan(t, td) {
    if (!t.planned_date || t.planned_date > td) return { planned_date: td, alloc: null };
    if (!E.hasAlloc(t)) return { planned_date: t.planned_date, alloc: null };
    const alloc = {}; let used = 0;
    E.segs(t).forEach(s => { if (s.d < td) { alloc[s.d] = s.m; used += s.m; } });
    alloc[td] = Math.max(0, (Number(t.duration_min) || 0) - used);
    return { planned_date: t.planned_date, alloc: Object.keys(alloc).length > 1 ? alloc : null };
  }
  async function toggleDone(t, extra) {
    if (!canEditTask(t)) return;
    const td = today();
    const patch = t.done ? { done: false, done_at: null, actual_min: null } : Object.assign({ done: true, done_at: nowStamp() }, doneSpan(t, td), extra || {});
    const r = await saveUpdate('tasks', t.id, patch, { history: { action: t.done ? 'reouverte' : 'terminee', entity: 'task', entity_id: t.id, client_id: t.client_id, detail: { kind: t.kind, text: !t.done && t.planned_date && t.planned_date > td ? 'prévue le ' + fDMY(t.planned_date) + ', réalisée le ' + fDMY(td) : '' } } });
    if (r === 'ok') {
      syncProdStatus(t.production_id);
      if (patch.done) { S.justDone.add(t.id); scheduleRender(); setTimeout(() => S.justDone.delete(t.id), 900); }
      // Tâche « demande d'informations » : son statut suit la tâche
      if (t.kind === 'info') { const p = S.data.productions.get(t.production_id); const v = patch.done ? 'faite' : 'a_faire'; if (p && p.info_request !== v) saveUpdate('productions', p.id, { info_request: v, info_request_at: new Date().toISOString() }, { quiet: true, history: { action: 'demande_info', entity: 'production', entity_id: p.id, client_id: p.client_id, detail: { text: IR_LABEL[v] } } }); }
    }
    return r;
  }
  function syncProdStatus(pid) {
    const p = S.data.productions.get(pid); if (!p) return;
    const st = E.productionStatus(p, list('tasks').filter(t => t.production_id === pid));
    if (st !== p.status) saveUpdate('productions', pid, { status: st }, { quiet: true });
  }
  async function toggleLock(t) {
    if (!canEditTask(t)) return;
    await saveUpdate('tasks', t.id, { locked: !t.locked }, { history: { action: t.locked ? 'deverrouillage' : 'verrouillage', entity: 'task', entity_id: t.id, client_id: t.client_id, detail: { kind: t.kind } } });
  }
  async function validateReceptions(ids, date) {
    if (!ids.length) return;
    if (!date) { toast('Indiquez la date de réception.', 'warn'); return; }
    const items = ids.map(id => { const p = S.data.productions.get(id); return { id, patch: { received_date: date, status: 'recu' }, history: { action: 'reception', entity: 'production', entity_id: id, client_id: p && p.client_id, detail: { date } } }; });
    await saveMany('productions', items);
    const ok = ids.filter(id => { const p = S.data.productions.get(id); return p && p.received_date === date && !p._failed && !p._unsaved; });
    ids.forEach(id => S.recSel.delete(id));
    if (!ok.length) { render(); return; }
    let moved = 0;
    for (const m of new Set(ok.map(id => S.data.productions.get(id).month))) {
      const res = runPlan(m, 'incremental', new Set(ok));
      moved += res.moved.length;
      await applyPlan(res);
    }
    toast(ok.length + ' réception(s) enregistrée(s) · planning recalculé (' + moved + ' tâche(s) placée(s) ou déplacée(s)).', 'ok');
    render();
  }
  async function undoReception(pid) {
    const p = S.data.productions.get(pid); if (!p) return;
    if (!await confirmBox('Annuler la réception ?', '<p>Le dossier <b>' + esc((clientOf(p.client_id) || {}).name) + '</b> repassera en « éléments attendus » (prévisionnel).</p>', 'Annuler la réception')) return;
    await saveUpdate('productions', pid, { received_date: null, status: 'attendu' }, { history: { action: 'reception_annulee', entity: 'production', entity_id: pid, client_id: p.client_id } });
  }
  /* V26.32 : dossier nouveau (moins de 3 mois de temps réels) : marge de manœuvre sur le temps de production prévu */
  // V26.49 : « nouveau dossier » coché à la main dans la fiche (jamais par un import) ; marge pendant les 3 mois qui suivent la coche
  function isNewDossier(c) { return !!(c && c.new_since && today() < E.addMonths(c.new_since.slice(0, 7), 3) + c.new_since.slice(7, 10)); }
  const newMarginPct = () => { const v = Number(cfg().new_margin_pct); return isNaN(v) ? 20 : v; };
  function applyNewMargin(tasks) {
    const pct = newMarginPct(); if (!(pct > 0)) return;
    tasks.filter(t => t.kind === 'production').forEach(t => { const c = clientOf(t.client_id); if (c && isNewDossier(c)) t.duration_min = Math.round(t.duration_min * (1 + pct / 100) / 5) * 5; });
  }
  /* V26.181 : une génération à la fois (double clic, création automatique au démarrage pendant une génération manuelle…) :
     la suivante attend la fin de la précédente et repart des données à jour, sans recréer les mêmes tâches. */
  let genChain = Promise.resolve();
  function generateMonth(m, opts) { const run = genChain.then(() => generateMonthNow(m, opts)); genChain = run.catch(() => { }); return run; }
  async function generateMonthNow(m, opts) {
    const auto = !!(opts && opts.auto);
    if (!isManager() && !auto) return;
    if (startMonth() && m < startMonth()) { if (!auto) toast(fMonth(m).replace(/^./, s => s.toUpperCase()) + ' est antérieur au premier mois d\'utilisation (' + fMonth(startMonth()) + ', Paramètres › Planification).', 'warn'); return; }
    await poll(true);
    const built = E.buildMonth(m, list('clients'), list('productions'), cfg(), P.uuid, S.v7);
    if (S.v8) built.tasks.push(...dashFree(E.buildDashboards(m, list('clients'), list('tasks'), cfg(), P.uuid))); // V26.180 : jamais un tableau de bord déjà en cours de création
    assignDoers(built.tasks.filter(t => t.kind !== 'info'));
    applyNewMargin(built.tasks);
    // Réparation : productions existantes sans tâches (ex. génération interrompue)
    const withTasks = new Set(list('tasks').map(t => t.production_id));
    for (const p of list('productions').filter(x => x.month === m && !withTasks.has(x.id))) {
      const c = clientOf(p.client_id); if (!c) continue;
      const due = E.productionDue(c, m, cfg());
      let dur = E.clientTime(c); if (dur > 0 && isNewDossier(c) && newMarginPct() > 0) dur = Math.round(dur * (1 + newMarginPct() / 100) / 5) * 5; if (dur > 0) built.tasks.push(E.productionTask(P.uuid(), p.id, c, m, dur, due));
    }
    if (!built.productions.length && !built.tasks.length) { if (!auto) toast('Tous les dossiers du mois sont déjà créés.', ''); return; }
    const dk = built.tasks.filter(t => t.kind === 'dashboard').map(dashKey); dk.forEach(k => S.dashPending.add(k));
    try {
      if (built.productions.length) await saveInsert('productions', built.productions);
      if (built.tasks.length) await saveInsert('tasks', built.tasks);
    } catch (e) { await refreshAll(); return; } finally { dk.forEach(k => S.dashPending.delete(k)); }
    const res = runPlan(m, 'incremental', new Set(built.productions.map(p => p.id)));
    await applyPlan(res);
    hist('generation', { entity: 'month', entity_id: m, detail: { text: fMonth(m) + ' : ' + built.productions.length + ' dossier(s), ' + built.tasks.length + ' tâche(s)' } });
    toast((auto ? 'Dossiers ' + deMonth(m) + ' créés automatiquement : ' : fMonth(m) + ' : ') + built.productions.length + ' dossier(s), ' + built.tasks.length + ' tâche(s) planifiée(s)' + (res.unplanned.length ? ' — ' + res.unplanned.length + ' non planifiable(s)' : '') + '.', res.unplanned.length ? 'warn' : 'ok', null, auto ? 8000 : undefined);
  }
  /* V26.80 : échéances tombant un week-end / férié → premier jour ouvré suivant (tâches déjà créées) */
  async function fixDueDates(m, only) {
    const items = list('tasks').filter(t => t.month >= m && !t.done && t.due_date && !E.isWorkday(t.due_date) && (!only || only(t))).map(t => {
      const c = clientOf(t.client_id); if (!c) return null;
      const due = t.kind === 'dashboard' ? E.nextWorkday(t.due_date) : E.productionDue(c, t.month, cfg()); // V26.107 : tableaux de bord aussi
      return due !== t.due_date && due === E.nextWorkday(t.due_date) ? { id: t.id, patch: { due_date: due } } : null;
    }).filter(Boolean);
    if (items.length) await saveMany('tasks', items);
    return items.length;
  }
  /* V26.84 : clôturer un mois passé — tâches encore ouvertes marquées terminées (sans temps réel ni date de réception : l'apprentissage n'est pas faussé) */
  async function closeMonth(m) {
    if (!isManager() || E.windowOf(m, cfg()).end >= today()) return;
    const ts = scopedData().tasks.filter(t => t.month === m && !t.done && t.kind !== 'info');
    const infos = scopedData().tasks.filter(t => t.month === m && !t.done && t.kind === 'info');
    // V26.168 : dossiers encore « attendus » sans tâche ouverte (ex. aucun temps prévu) — clôturés eux aussi ; plus de message « Aucun dossier ouvert »
    const bare = scopedData().productions.filter(p => p.month === m && awaitingRec(p) && !ts.some(t => t.production_id === p.id));
    if (!ts.length && !bare.length) { render(); return; }
    const n = new Set(ts.map(t => t.production_id).concat(bare.map(p => p.id))).size;
    if (!await confirmBox('Clôturer ' + fMonth(m), '<p><b>' + n + ' dossier(s)</b> de ' + esc(fMonth(m)) + ' sont encore ouverts' + (ts.length ? ' (' + ts.length + ' tâche(s))' : '') + (bare.length ? ', dont ' + bare.length + ' jamais déclaré(s) reçu(s)' : '') + '. Ils seront marqués <b>terminés</b> : ils sortent des réceptions, des dossiers à risque, des alertes et des retards.</p><p class="small muted">Aucun temps passé ni date de réception n\'est inventé : l\'agent n\'apprend rien de faux de cette clôture. Les dépôts TVA ne sont pas cochés.</p>', 'Clôturer ' + fMonth(m))) return;
    const at = new Date().toISOString();
    const r = ts.length || infos.length ? await saveMany('tasks', ts.concat(infos).map(t => ({ id: t.id, patch: { done: true, done_at: at } }))) : null;
    if (bare.length) await saveMany('productions', bare.map(p => ({ id: p.id, patch: { status: 'cloture' } })), { quiet: true });
    hist('cloture_mois', { entity: 'month', entity_id: m, detail: { text: fMonth(m) + ' clôturé : ' + n + ' dossier(s), ' + ts.length + ' tâche(s) marquée(s) terminée(s)' } });
    toast(fMonth(m).replace(/^./, s => s.toUpperCase()) + ' clôturé : ' + n + ' dossier(s) terminé(s).', r && (r.failed || r.conflict) ? 'warn' : 'ok');
    render();
  }
  /* V26.164 : résultat de replanification limité, hors manager, aux tâches visibles par la personne (les autres plannings ne bougent pas) */
  function replanFor(m, force) {
    const res = runPlan(m, 'full', null, { force: !!force });
    if (isManager()) return res;
    const vis = id => { const t = S.data.tasks.get(id); return !!t && canSeeCollab(t.collaborator_id); };
    const mine = list('tasks').filter(t => t.month === m && canSeeCollab(t.collaborator_id)), pids = new Set(mine.map(t => t.production_id).filter(Boolean));
    return Object.assign({}, res, { scoped: true, changes: res.changes.filter(c => vis(c.id)), moved: res.moved.filter(x => vis(x.id)), unplanned: res.unplanned.filter(x => vis(x.id)),
      problems: res.problems.filter(pb => !pb.production_id || pids.has(pb.production_id)), lockedCount: mine.filter(t => t.locked && !t.done).length, doneCount: mine.filter(t => t.done).length });
  }
  async function openReplan(m, opt) { // V26.186 : opt = ouvert par « Optimiser le planning » (onglet Planning)
    if (!canReplan()) return;
    await poll(true);
    const nFix = await fixDueDates(m, isManager() ? null : t => canSeeCollab(t.collaborator_id));
    if (nFix) toast(nFix + ' échéance(s) tombant un week-end ou un jour férié reportée(s) au premier jour ouvré suivant.', 'ok', null, 5000);
    openSheet({ type: 'replan', month: m, result: replanFor(m, false), force: false, opt: !!opt, stats: opt ? pcOptStats(m) : null });
  }
  async function applyReplan() {
    const s = S.sheet; if (!s || s.type !== 'replan') return;
    closeSheet();
    const r = await applyPlan(s.result);
    hist('replanification', { entity: 'month', entity_id: s.month, detail: { text: (s.force ? 'Forcée (zone figée incluse) · ' : '') + s.result.moved.length + ' tâche(s) déplacée(s), ' + s.result.lockedCount + ' verrouillée(s), ' + s.result.problems.length + ' échéance(s) problématique(s)' } });
    toast('Replanification appliquée : ' + r.ok + ' tâche(s) mise(s) à jour.', r.failed || r.conflict ? 'warn' : 'ok');
  }

  /* Dossiers / collaborateurs / utilisateurs */
  function parseField(k, v) {
    if (['time_min', 'daily_capacity_min'].includes(k)) { const n = E.parseDuration(v); if (isNaN(n)) throw new Error('Durée illisible : « ' + v + ' » (ex. 1h30, 45 min, 2)'); return n; }
    if (['reception_day', 'vat_due_day'].includes(k)) { if (v === '' || v === null) return null; const n = Number(v); if (!(n >= 1 && n <= 31)) throw new Error('Jour invalide (1 à 31)'); return Math.round(n); }
    if (k === 'priority') return Number(v);
    if (k === 'is_cloture') { if (!v) return null; const m = String(v).trim().match(/^(\d{1,2})[\/.\- ](\d{1,2})$/); if (!m || +m[2] < 1 || +m[2] > 12 || +m[1] < 1 || +m[1] > 31) throw new Error('Date de clôture invalide (ex. 31/12)'); return String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0'); }
    if (['collaborator_id', 'team_id', 'rc_id', 'tutor_id', 'dashboard_freq'].includes(k)) return v || null;
    if (k === 'dashboard_min') { const n = E.parseDuration(v); if (isNaN(n)) throw new Error('Durée illisible : « ' + v + ' » (ex. 1h30, 45 min)'); return n; }
    if (k === 'dashboard_day') { if (v === '' || v === null) return 25; const n = Number(v); if (!(n >= 1 && n <= 31)) throw new Error('Jour invalide (1 à 31)'); return Math.round(n); }
    if (k === 'name' && !String(v).trim()) throw new Error('Le nom est obligatoire');
    return typeof v === 'string' ? v.trim() : v;
  }
  async function saveClientField(c, k, v) {
    let val; try { val = parseField(k, v); } catch (e) { toast(e.message, 'warn'); renderSheet(); return; }
    const old = c[k], oldTime = E.clientTime(c);
    if (k === 'active') return setClientActive(c, !!val);
    const r = await saveUpdate('clients', c.id, k === 'time_min' ? { time_min: val, time_tenue: 0, time_lettrage: 0, time_tva: 0 } : { [k]: val }, { history: { action: k === 'time_min' ? 'modification_temps' : 'dossier', entity: 'client', entity_id: c.id, client_id: c.id, detail: k === 'time_min' ? { kind: 'production', from_min: E.clientTime(c), to_min: val } : { text: k + ' modifié' } } });
    if (r !== 'ok') return;
    // Répercussion sur les tâches non terminées et non verrouillées du mois courant et suivants
    const cur = today().slice(0, 7);
    const impacted = list('tasks').filter(t => t.client_id === c.id && !t.done && !t.locked && t.month >= cur);
    let items = [];
    // V26.181 : un dossier scindé (réception partielle, tâche non terminée en totalité) garde la proportion de chaque part —
    // chaque part ne reçoit plus le temps complet (le planning comptait le dossier deux fois)
    if (k === 'time_min') items = impacted.filter(t => t.kind === 'production').map(t => {
      const parts = list('tasks').filter(x => x.production_id === t.production_id && x.kind === 'production').length;
      const dur = parts > 1 && oldTime > 0 ? Math.max(5, Math.round((Number(t.duration_min) || 0) * val / oldTime / 5) * 5) : val;
      return dur === t.duration_min ? null : { id: t.id, patch: { duration_min: dur, alloc: E.spread(collabOf(t.collaborator_id), t.planned_date, dur, ctx()) || null } };
    }).filter(Boolean);
    if (['collaborator_id', 'production_by', 'dashboard_by', 'apprenti'].includes(k)) { const nc = Object.assign({}, c, { [k]: val }); items = impacted.filter(t => (t.kind !== 'info' || k === 'collaborator_id') && (k !== 'apprenti' || t.kind === 'production')).map(t => ({ id: t.id, patch: { collaborator_id: t.kind === 'info' ? val : doerOf(nc, t.kind === 'dashboard' ? 'dashboard' : 'production') } })).filter(x => x.patch.collaborator_id !== (S.data.tasks.get(x.id) || {}).collaborator_id); }
    if (['vat_due_day', 'vat_regime', 'deb', 'des'].includes(k)) { const nc = Object.assign({}, c, { [k]: val }); items = impacted.map(t => ({ id: t.id, patch: { due_date: E.productionDue(nc, t.month, cfg()) } })).filter(x => x.patch.due_date !== (S.data.tasks.get(x.id) || {}).due_date); }
    if (k === 'reception_day' && agentOn()) runAgent().catch(() => { });
    if (['dashboard_freq', 'dashboard_day', 'dashboard_min', 'collaborator_id', 'dashboard_by'].includes(k)) syncDashboards().catch(() => { });
    if (items.length) { await saveMany('tasks', items); toast(items.length + ' tâche(s) en cours mise(s) à jour. Pensez à replanifier le mois.', 'ok', canReplan() ? { label: 'Replanifier', fn: () => openReplan(S.month) } : null); }
  }
  /* V26.73 : dossier inactif = grisé, exclu de la planification ; ses tâches à venir non commencées sont retirées */
  async function setClientActive(c, on) {
    const cur = today().slice(0, 7);
    const pending = on ? [] : list('tasks').filter(t => t.client_id === c.id && !t.done && !t.locked && t.month >= cur);
    if (!on && !await confirmBox('Rendre le dossier inactif', '<p><b>' + esc(c.name) + '</b> sera grisé et ne sera plus pris en compte dans la planification.</p>' + (pending.length ? '<p>' + pending.length + ' tâche(s) non terminée(s) de ce dossier seront retirées du planning. Les tâches terminées et l\'historique sont conservés.</p>' : ''), 'Rendre inactif', true)) { renderSheet(); return; }
    const patch = { active: on };
    const r = await saveUpdate('clients', c.id, patch, { history: { action: 'dossier', entity: 'client', entity_id: c.id, client_id: c.id, detail: { text: on ? 'Dossier réactivé' : 'Dossier rendu inactif' } } });
    if (r !== 'ok') return;
    for (const t of pending) await saveRemove('tasks', t.id);
    toast(on ? 'Dossier réactivé. Pensez à replanifier le mois pour l\'intégrer.' : 'Dossier inactif' + (pending.length ? ' · ' + pending.length + ' tâche(s) retirée(s) du planning' : '') + '.', 'ok', on && canReplan() ? { label: 'Replanifier', fn: () => openReplan(S.month) } : null);
    render();
  }
  async function createClient() {
    const d = S.sheet.draft;
    if (!d.name || !d.name.trim()) { toast('Le nom du client est obligatoire.', 'warn'); return; }
    // V26.181 : un double clic ne crée plus deux dossiers ; un nom déjà utilisé est signalé avant création (sinon double planning)
    if (S.creatingClient) return;
    S.creatingClient = true;
    try {
      const nm = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
      if (list('clients').some(c => nm(c.name) === nm(d.name)) && !await confirmBox('Dossier déjà existant', '<p>Un dossier « <b>' + esc(d.name.trim()) + '</b> » existe déjà. En créer un second planifiera cette société deux fois.</p>', 'Créer quand même', true)) return;
      try { await saveInsert('clients', [Object.assign({}, d, { id: P.uuid() })]); } catch (e) { return; }
    } finally { S.creatingClient = false; }
    hist('dossier', { detail: { text: 'Création d\'un dossier' } });
    closeSheet(); toast('Dossier créé. Générez le mois pour l\'intégrer au planning.', 'ok');
  }
  /* V26.74 : jours de présence en entreprise de l'apprenti (liste de dates AAAA-MM-JJ) */
  async function presSave(fn) {
    const c = S.sheet && S.sheet.id ? collabOf(S.sheet.id) : null; if (!c || !(isAdmin() || isManager())) return;
    const set = new Set(c.presence_dates || []); fn(set);
    const r = await saveUpdate('collaborators', c.id, { presence_dates: [...set].sort() }, { quiet: true, history: { action: 'collaborateur', entity: 'collaborator', entity_id: c.id, detail: { text: c.name + ' : jours de présence modifiés' } } });
    if (r === 'ok') renderSheet();
  }
  async function saveCollabField(c, k, v) {
    let val; try { val = parseField(k, v); } catch (e) { toast(e.message, 'warn'); renderSheet(); return; }
    if (S.sheet && !S.sheet.id) { S.sheet.draft[k] = val; return; }
    await saveUpdate('collaborators', c.id, { [k]: val }, { history: { action: 'collaborateur', entity: 'collaborator', entity_id: c.id, detail: { text: c.name + ' : ' + k + ' modifié' } } });
  }

  /* ====================== V26.165 : tâche non terminée en totalité ======================
   * Clic droit sur une tâche (Planning, Aujourd'hui) ou bouton de la fiche de la tâche : la partie faite est terminée
   * (temps réellement passé noté, comme une clôture), le reste devient une nouvelle tâche verrouillée, placée en tête du
   * jour ouvré suivant. Le commentaire, obligatoire, rejoint le commentaire du mois (repris dans le Récap TVA). */
  function openDayFrom(cid, from, strict) {
    const c = collabOf(cid), x = ctx(); let d = strict ? E.addDays(from, 1) : from;
    for (let i = 0; i < 90; i++, d = E.addDays(d, 1)) if (E.isWorkday(d) && (!c || E.capacityOn(c, d, x) > 0)) return d;
    return E.nextWorkday(strict ? E.addDays(from, 1) : from);
  }
  // numéro d'ordre placé devant toutes les tâches déjà prévues ce jour-là
  const topSeq = (cid, d, except) => { const ts = dayTasks(cid, d).filter(t => !except || !except.has(t.id)); return ts.length ? Math.min(...ts.map(t => Number(t.seq) || 0)) - 1 : 0; };
  const canSplit = t => !!t && !t.done && t.kind !== 'info' && !S.readonly && canEditTask(t) && (Number(t.duration_min) || 0) >= 10;
  function splitDialog(t) {
    const c = clientOf(t.client_id) || {}, planned = Number(t.duration_min) || 0;
    const rest0 = Math.min(planned - 5, Math.max(15, Math.round(planned / 2 / 15) * 15)), day = openDayFrom(t.collaborator_id, today(), true);
    return new Promise(resolve => {
      const root = document.createElement('div'); root.className = 'overlay anim center';
      const timeIn = (id, v, lbl) => '<label class="f"><span>' + lbl + '</span><div class="time-in"><button type="button" class="btn icon" data-t="' + id + '" data-d="-15" aria-label="Moins 15 minutes">−</button><input type="text" id="' + id + '" value="' + E.fmtMin(v) + '" autocomplete="off"><button type="button" class="btn icon" data-t="' + id + '" data-d="15" aria-label="Plus 15 minutes">+</button></div></label>';
      root.innerHTML = '<div class="sheet sheet-split" role="dialog" aria-modal="true"><div class="sheet-h"><div style="margin-right:auto"><h2>Tâche non terminée en totalité — ' + esc(c.name) + '</h2><div class="small muted" style="margin-top:4px">' + E.KIND_LABEL[t.kind] + ' · temps prévu ' + E.fmtMin(planned) + '</div></div></div>'
        + '<div class="sheet-b"><div class="form">' + timeIn('sp-done', planned - rest0, 'Temps passé sur la partie faite') + timeIn('sp-rest', rest0, 'Temps restant estimé') + '</div>'
        + '<label class="f"><span>Commentaire <b>(obligatoire)</b> <em class="small muted">— repris dans le Récap TVA</em></span><textarea id="sp-note" rows="3" maxlength="200" placeholder="Ex. : rapprochement bancaire à finir, attente du relevé Qonto"></textarea></label>'
        + '<div class="notice small">Le reste sera placé <b>en tête du ' + esc(fDate(day)) + '</b> (premier jour ouvré suivant), avant les autres tâches, et verrouillé.</div>'
        + '<div class="notice bad" id="sp-err" style="display:none"></div></div>'
        + '<div class="sheet-f"><button class="btn" data-x="cancel">Annuler</button><button class="btn primary" data-x="ok">' + ic('check', 'sm') + 'Scinder la tâche</button></div></div>';
      const err = root.querySelector('#sp-err'), fail = m => { err.textContent = m; err.style.display = ''; };
      const done = v => { fxClose(root); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const submit = () => {
        const sp = E.parseDuration(root.querySelector('#sp-done').value), rs = E.parseDuration(root.querySelector('#sp-rest').value), note = root.querySelector('#sp-note').value.trim();
        if (isNaN(sp) || sp <= 0) return fail('Temps passé illisible (ex. 1h30, 45 min).');
        if (isNaN(rs) || rs <= 0) return fail('Temps restant illisible (ex. 1h, 30 min).');
        if (note.length < 3) return fail('Le commentaire est obligatoire : indique ce qu\'il reste à faire ou pourquoi.');
        done({ spent: sp, rest: rs, note });
      };
      const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      root.addEventListener('click', e => {
        const d = e.target.closest('[data-d]'), x = e.target.closest('[data-x]');
        if (d) { const inp = root.querySelector('#' + d.dataset.t), n = E.parseDuration(inp.value); inp.value = E.fmtMin(Math.max(5, (isNaN(n) ? 0 : n) + Number(d.dataset.d))); }
        else if (x) x.dataset.x === 'ok' ? submit() : done(null);
        else if (e.target === root) done(null);
      });
      document.body.appendChild(root);
      setTimeout(() => root.querySelector('#sp-note').focus(), 60);
    });
  }
  async function splitTask(id) {
    let t = S.data.tasks.get(id);
    if (!canSplit(t)) { toast('Cette tâche ne peut pas être scindée (terminée, trop courte ou hors de ton planning).', 'warn'); return; }
    const r = await splitDialog(t); if (!r) return;
    t = S.data.tasks.get(id); if (!canSplit(t)) return;
    const planned = Number(t.duration_min) || 0, td = today();
    const rest = Math.max(5, Math.round(r.rest)), donePart = Math.max(5, planned - Math.min(rest, planned - 5));
    const day = openDayFrom(t.collaborator_id, td, true), co = collabOf(t.collaborator_id);
    // 1. la partie faite est terminée (la tâche d'origine garde son historique)
    const before = { duration_min: t.duration_min, done: false, done_at: null, actual_min: null, planned_date: t.planned_date, alloc: t.alloc || null };
    const res = await saveUpdate('tasks', t.id, Object.assign({ duration_min: donePart, done: true, done_at: nowStamp(), actual_min: r.spent }, doneSpan(Object.assign({}, t, { duration_min: donePart }), td)),
      { history: { action: 'tache_scindee', entity: 'task', entity_id: t.id, client_id: t.client_id, detail: { kind: t.kind, text: 'Non terminée en totalité : ' + E.fmtMin(donePart) + ' faits (' + E.fmtMin(r.spent) + ' passés), reste ' + E.fmtMin(rest) + ' le ' + fDMY(day) + ' — ' + r.note } } });
    if (res !== 'ok') return;
    // 2. le reste : nouvelle tâche en tête du jour ouvré suivant, verrouillée
    const nt = Object.assign({}, t, { id: P.uuid(), duration_min: rest, planned_date: day, seq: topSeq(t.collaborator_id, day), alloc: (co && E.spread(co, day, rest, ctx())) || null, locked: true, done: false, done_at: null, actual_min: null });
    ['version', 'updated_at', 'updated_by', '_unsaved', '_failed'].forEach(k => delete nt[k]);
    try { await saveInsert('tasks', [nt]); }
    catch (e) { await saveUpdate('tasks', t.id, before, { quiet: true }); toast('Le reste n\'a pas pu être créé : la tâche est revenue à son état d\'origine.', 'bad'); return; }
    // 3. le commentaire rejoint le commentaire du mois (Récap TVA) — enregistré AVANT la mise à jour du statut du dossier (sinon conflit de version)
    const p = S.data.productions.get(t.production_id);
    if (p) { const add = 'Reste ' + E.fmtMin(rest) + ' le ' + fDM(day) + ' : ' + r.note; await saveUpdate('productions', p.id, { tva_note: p.tva_note ? p.tva_note + ' · ' + add : add }, { quiet: true, history: { action: 'dossier', entity: 'production', entity_id: p.id, client_id: p.client_id, detail: { text: 'Commentaire du mois : ' + add } } }); }
    syncProdStatus(t.production_id);
    const load = dayTasks(t.collaborator_id, day).filter(x => !x.done).reduce((s, x) => s + E.minutesOn(x, day), 0), cap = co ? E.capacityOn(co, day, ctx()) : 0;
    if (S.sheet && S.sheet.type === 'task' && S.sheet.id === t.id) closeSheet();
    toast('Tâche scindée : ' + E.fmtMin(donePart) + ' terminés, reste ' + E.fmtMin(rest) + ' placé en tête du ' + fDate(day) + '.' + (cap && overAlert(load, cap) ? ' Ce jour dépasse la capacité : pense à replanifier.' : ''), 'ok', cap && overAlert(load, cap) && canReplan() ? { label: 'Replanifier', fn: () => openReplan(t.month) } : null, 8000);
    render();
  }
  /* Chaque jour : ce qui était prévu les jours précédents et n'est pas terminé (éléments reçus) passe automatiquement
     en tête du premier jour ouvré, devant le reste, et reste verrouillé à cette place. */
  async function carryOver() {
    if (S.readonly || !S.me) return;
    const td = today(), key = 'planif-carry:' + (((S.realMe || S.me) || {}).email || '');
    if (lsGet(key) === td) return; lsSet(key, td);
    const late = list('tasks').filter(t => !t.done && t.kind !== 'info' && t.planned_date && E.endDate(t) < td && canEditTask(t) && E.isReceived(t, S.data.productions.get(t.production_id)))
      .sort((a, b) => (a.planned_date || '').localeCompare(b.planned_date || '') || (Number(a.seq) || 0) - (Number(b.seq) || 0));
    if (!late.length) return;
    const byDay = new Map(), items = [], moved = new Set(late.map(t => t.id));
    for (const t of late) {
      const day = openDayFrom(t.collaborator_id, td, false), k = t.collaborator_id + '|' + day;
      if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push({ t, day });
    }
    for (const [, arr] of byDay) {
      const base = topSeq(arr[0].t.collaborator_id, arr[0].day, moved);
      arr.forEach((x, i) => { const co = collabOf(x.t.collaborator_id); items.push({ id: x.t.id, patch: { planned_date: x.day, seq: base - arr.length + 1 + i, alloc: (co && E.spread(co, x.day, Number(x.t.duration_min) || 0, ctx())) || null, locked: true }, history: { action: 'report_auto', entity: 'task', entity_id: x.t.id, client_id: x.t.client_id, detail: { kind: x.t.kind, from: x.t.planned_date, to: x.day, text: 'non terminée le ' + fDMY(x.t.planned_date) + ' : placée en tête du ' + fDMY(x.day) } } }); });
    }
    const res = await saveMany('tasks', items, { quiet: true });
    if (res.ok) toast(res.ok + ' tâche' + (res.ok > 1 ? 's' : '') + ' non terminée' + (res.ok > 1 ? 's' : '') + ' placée' + (res.ok > 1 ? 's' : '') + ' en tête du jour (report automatique).', 'ok', null, 6000);
  }
  /* ====================== V26.167 : tâche à reporter au lendemain ======================
   * Clic droit sur une tâche : elle passe en tête du jour ouvré suivant, verrouillée (comme un report automatique).
   * Le report est noté dans l'historique et signalé aux managers (Pilotage › Tâches reportées au lendemain). */
  const canPostpone = t => !!t && !t.done && !S.readonly && !!t.collaborator_id && canEditTask(t);
  async function postponeTask(id) {
    const t = S.data.tasks.get(id);
    if (!canPostpone(t)) { toast('Cette tâche ne peut pas être reportée (terminée ou hors de ton planning).', 'warn'); return; }
    const td = today(), from = t.planned_date || null, day = openDayFrom(t.collaborator_id, from && from > td ? from : td, true);
    const co = collabOf(t.collaborator_id), cl = clientOf(t.client_id) || {}, by = meName();
    const before = { planned_date: from, seq: Number(t.seq) || 0, alloc: t.alloc || null, locked: !!t.locked };
    const patch = { planned_date: day, seq: topSeq(t.collaborator_id, day, new Set([t.id])), alloc: (co && E.spread(co, day, Number(t.duration_min) || 0, ctx())) || null, locked: true };
    const r = await saveUpdate('tasks', t.id, patch, { history: { action: 'report_lendemain', entity: 'task', entity_id: t.id, client_id: t.client_id, detail: { kind: t.kind, from, to: day, date: td, collab_id: t.collaborator_id, by, text: 'reportée au lendemain' + (by ? ' par ' + by : '') } } });
    if (r !== 'ok') return;
    S.postCache = undefined; // suivi des managers à jour
    const load = dayTasks(t.collaborator_id, day).filter(x => !x.done).reduce((s, x) => s + E.minutesOn(x, day), 0), cap = co ? E.capacityOn(co, day, ctx()) : 0;
    toast((cl.name || 'La tâche') + ' est reportée au ' + fDate(day) + ', en tête de journée.' + (isManager() ? '' : ' Ton manager en est informé.') + (cap && overAlert(load, cap) ? ' Ce jour dépasse la capacité.' : ''), 'ok', { label: 'Annuler', fn: () => undoPostpone(t.id, before, day) }, 7000);
    render();
  }
  async function undoPostpone(id, before, day) {
    const t = S.data.tasks.get(id); if (!t || t.done || t.planned_date !== day) return;
    const r = await saveUpdate('tasks', id, before, { history: { action: 'report_annule', entity: 'task', entity_id: id, client_id: t.client_id, detail: { kind: t.kind, from: day, to: before.planned_date, date: today(), collab_id: t.collaborator_id, by: meName(), text: 'report au lendemain annulé' } } });
    if (r === 'ok') { S.postCache = undefined; toast('Report annulé : la tâche reprend sa place.', '', null, 3000); render(); }
  }
  /* Menu du clic droit sur une tâche */
  function taskMenu(t, x, y) {
    const old = $('#tk-menu'); if (old) old.remove();
    const el = document.createElement('div'); el.id = 'tk-menu'; el.className = 'me-card tk-menu'; el.setAttribute('role', 'menu');
    el.innerHTML = '<div class="tk-h">' + esc((clientOf(t.client_id) || {}).name || '') + '<span>' + E.KIND_LABEL[t.kind] + ' · ' + E.fmtMin(t.duration_min) + '</span></div><div class="me-list">'
      + (canSplit(t) ? '<button data-tk="split" role="menuitem">' + ic('clock', 'sm') + 'Tâche non terminée en totalité…</button>' : '')
      + (canPostpone(t) ? '<button data-tk="postpone" role="menuitem">' + ic('calendar', 'sm') + 'Tâche à reporter au lendemain</button>' : '')
      + '<button data-tk="done" role="menuitem">' + ic('check', 'sm') + 'Terminer</button>'
      + '<button data-tk="open" role="menuitem">' + ic('list', 'sm') + 'Ouvrir la tâche</button></div>';
    document.body.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px'; el.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
    const close = () => { el.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esck, true); window.removeEventListener('scroll', close, true); };
    const outside = e => { if (!el.contains(e.target)) close(); };
    const esck = e => { if (e.key === 'Escape') close(); };
    el.addEventListener('click', e => { const b = e.target.closest('[data-tk]'); if (!b) return; const k = b.dataset.tk; close(); if (k === 'split') splitTask(t.id); else if (k === 'postpone') postponeTask(t.id); else if (k === 'done') finishTask(S.data.tasks.get(t.id)); else openSheet({ type: 'task', id: t.id }); });
    setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', esck, true); window.addEventListener('scroll', close, true); }, 0);
    const first = el.querySelector('button'); if (first) first.focus();
  }
