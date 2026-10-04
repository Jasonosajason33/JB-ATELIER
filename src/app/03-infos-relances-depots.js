  /* ---------- Demande d'informations au client (par dossier et par mois) ---------- */
  const IR_OPTS = [['faite', 'Déjà faite', 'check', 'g', 'La demande a été envoyée au client'], ['a_faire', 'À faire', 'mail', 'o', 'Une demande reste à envoyer — 45 min planifiées'], ['non', 'Non nécessaire', 'x', '', 'Aucune information à demander']];
  const IR_LABEL = { faite: 'Demande faite', a_faire: 'Demande à faire', non: 'Pas de demande' };
  /* Enregistre le statut et tient à jour la tâche « demande d'informations » du planning :
   * à faire → tâche créée et planifiée (45 min par défaut) ; faite → tâche terminée ; non nécessaire → tâche retirée. */
  async function setInfoRequest(pid, v) {
    const p = S.data.productions.get(pid);
    if (!p) return 'failed';
    if (p.info_request !== v) {
      const r = await saveUpdate('productions', pid, { info_request: v, info_request_at: new Date().toISOString() }, { history: { action: 'demande_info', entity: 'production', entity_id: pid, client_id: p.client_id, detail: { text: IR_LABEL[v] } } });
      if (r !== 'ok') return r;
    }
    const it = list('tasks').find(t => t.production_id === pid && t.kind === 'info');
    const c = clientOf(p.client_id);
    if (v === 'a_faire' && !it && c) {
      // V26.181 : un double clic (ou « À faire » choisi à deux endroits) ne crée plus deux tâches de 45 min
      S.irPending = S.irPending || new Set(); if (S.irPending.has(pid)) return 'ok'; S.irPending.add(pid);
      const dur = Number(cfg().info_request_min) || 45;
      const due = (list('tasks').find(t => t.production_id === pid && t.due_date) || {}).due_date || E.productionDue(c, p.month, cfg());
      try { await saveInsert('tasks', [{ id: P.uuid(), production_id: pid, client_id: c.id, month: p.month, kind: 'info', collaborator_id: c.collaborator_id || null, planned_date: null, seq: 0, duration_min: dur, due_date: due, locked: false, done: false, done_at: null, alloc: null }]); } catch (e) { return 'failed'; } finally { S.irPending.delete(pid); }
      const res = runPlan(p.month, 'incremental', new Set());
      await applyPlan(res);
      const t = list('tasks').find(x => x.production_id === pid && x.kind === 'info');
      toast(t && t.planned_date ? 'Demande d\'informations planifiée le ' + fDM(t.planned_date) + ' (' + E.fmtMin(dur) + ').' : 'Demande d\'informations ajoutée (non planifiable pour l\'instant).', t && t.planned_date ? 'ok' : 'warn');
    } else if (v === 'faite' && it && !it.done) {
      await saveUpdate('tasks', it.id, Object.assign({ done: true, done_at: nowStamp() }, doneSpan(it, today())), { quiet: true, history: { action: 'terminee', entity: 'task', entity_id: it.id, client_id: it.client_id, detail: { kind: 'info' } } });
    } else if (v === 'non' && it && !it.done) {
      await saveRemove('tasks', it.id);
    } else if (v === 'a_faire' && it && it.done) {
      await saveUpdate('tasks', it.id, { done: false, done_at: null }, { quiet: true });
    }
    return 'ok';
  }
  /* Avant de terminer : si le statut de la demande n'est pas encore renseigné, on le demande. */
  function askInfo(pid) {
    const p = S.data.productions.get(pid);
    if (!p || p.info_request) return Promise.resolve(true);
    const c = clientOf(p.client_id) || {};
    return new Promise(resolve => {
      const root = document.createElement('div');
      root.className = 'overlay anim center';
      root.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" style="width:min(460px,100%)"><div class="sheet-h"><div style="margin-right:auto"><h2>Demande d\'informations</h2><div class="small muted" style="margin-top:4px">' + esc(c.name) + ' — avant de terminer, la demande d\'informations au client est :</div></div></div>'
        + '<div class="sheet-b"><div class="ir-big">' + IR_OPTS.map(o => '<button class="btn" data-v="' + o[0] + '"><span class="ibox ' + o[3] + '">' + ic(o[2], 'sm') + '</span><span style="text-align:left;white-space:normal"><b>' + o[1] + '</b><br><span class="small muted">' + o[4] + '</span></span></button>').join('') + '</div></div>'
        + '<div class="sheet-f"><button class="btn" data-v="">Annuler</button></div></div>';
      root.addEventListener('click', async e => {
        const b = e.target.closest('[data-v]');
        if (!b && e.target !== root) return;
        fxClose(root);
        if (!b || !b.dataset.v) return resolve(false);
        await setInfoRequest(pid, b.dataset.v);
        resolve(true);
      });
      document.body.appendChild(root);
    });
  }
  function irBox(p) {
    if (!p) return '';
    return '<div class="ir-box"><div class="t">' + ic('mail', 'sm') + 'Demande d\'informations au client</div><div class="ir">'
      + IR_OPTS.map(o => '<button class="' + o[0] + (p.info_request === o[0] ? ' on' : '') + '" data-act="ir" data-pid="' + p.id + '" data-v="' + o[0] + '"' + (S.readonly ? ' disabled' : '') + '>' + ic(o[2], 'sm') + o[1] + '</button>').join('')
      + '</div>' + (p.info_request_at ? '<span class="small muted">Mis à jour le ' + fDateTime(p.info_request_at) + '</span>' : '<span class="small muted">Non renseigné</span>') + '</div>';
  }
  async function finishTask(t) {
    if (!canEditTask(t)) return;
    const extra = {};
    if (!t.done && t.kind !== 'info') {
      const r = await finishDialog(t);
      if (!r) return;
      if (r.ir) await setInfoRequest(t.production_id, r.ir);
      if (r.note !== undefined) { const p = S.data.productions.get(t.production_id); if (p && (p.tva_note || '') !== r.note) await saveUpdate('productions', p.id, { tva_note: r.note || null }, { quiet: true, history: { action: 'dossier', entity: 'production', entity_id: p.id, client_id: p.client_id, detail: { text: 'Commentaire du mois ' + (r.note ? 'modifié' : 'effacé') } } }); }
      extra.actual_min = r.actual;
      t = S.data.tasks.get(t.id) || t;
      const res = await toggleDone(t, extra);
      const dt = r.dash && S.data.tasks.get(r.dash);
      if (res === 'ok' && dt && !dt.done && (await toggleDone(dt, { actual_min: null })) === 'ok') toast('Tableau de bord noté fait et retiré du planning.', 'ok', null, 3500);
      return res;
    }
    return toggleDone(t, extra);
  }
  async function finishGroup(ts) {
    if (!ts.length || !ts.every(canEditTask)) return;
    const allDone = ts.every(t => t.done);
    if (!allDone && !(await askInfo(ts[0].production_id))) return;
    const todo = allDone ? ts : ts.filter(t => !t.done);
    let ok = true;
    for (const t of todo) { const cur = S.data.tasks.get(t.id); if (cur && (await toggleDone(cur)) !== 'ok') ok = false; }
    return ok ? 'ok' : 'failed';
  }
  async function lockGroup(ts) {
    if (!ts.every(canEditTask)) return;
    const unlock = ts.every(t => t.locked);
    await saveMany('tasks', ts.filter(t => t.locked === unlock).map(t => ({ id: t.id, patch: { locked: !unlock }, history: { action: unlock ? 'deverrouillage' : 'verrouillage', entity: 'task', entity_id: t.id, client_id: t.client_id, detail: { kind: t.kind } } })));
  }
  async function moveGroup(ts, date, toCollab) {
    for (const t of ts) { const cur = S.data.tasks.get(t.id); if (cur && !cur.locked && !cur.done) await moveTask(cur, date, toCollab); }
  }
  function sheetGroup(s) {
    const ts = groupTasks(s.pid, s.date, s.cid); if (!ts.length) return '';
    const t0 = ts[0], c = clientOf(t0.client_id) || { name: '?' }, p = S.data.productions.get(t0.production_id), co = collabOf(t0.collaborator_id);
    const edit = ts.every(canEditTask), done = ts.every(t => t.done), allLocked = ts.every(t => t.locked), anyLocked = ts.some(t => t.locked);
    const dur = ts.reduce((a, t) => a + (Number(t.duration_min) || 0), 0);
    return sheetHead(esc(c.name), ts.map(t => E.KIND_LABEL[t.kind]).join(' + ') + ' · ' + E.fmtMin(dur) + (co ? ' · ' + esc(co.name) : '') + ' · ' + esc(prodLine(p)))
      + '<div class="sheet-b">' + remoteNotice(s)
      + '<div class="row">' + (done ? '<span class="badge g">' + ic('check') + 'Dossier terminé</span>' : '<span class="badge">À faire</span>') + '<span class="badge b">' + ic('merge') + 'Réalisé en une fois</span>' + (anyLocked ? '<span class="badge k">' + ic('lock') + (allLocked ? 'Verrouillé' : 'En partie verrouillé') + '</span>' : '') + (t0.due_date ? '<span class="badge">Échéance TVA ' + fDM(t0.due_date) + '</span>' : '') + '</div>'
      + '<div class="frame"><div class="frame-h">' + ic('route', 'sm') + '<h2>Parcours du dossier</h2></div><div class="inner">' + prodTimeline(p) + '</div></div>'
      + irBox(p)
      + '<div class="form"><label class="f"><span>Date planifiée (tout le dossier)</span><input type="date" data-ch="g-date" data-key="' + groupKey(ts) + '" value="' + (t0.planned_date || '') + '"' + (edit && !anyLocked && !done ? '' : ' disabled') + '></label></div>'
      + '<div><h3 style="margin-bottom:8px">Tâches</h3><div class="tasks">' + ts.map(t => taskRow(t, { swipe: false })).join('') + '</div></div></div>'
      + '<div class="sheet-f">' + (edit ? '<button class="btn" data-act="lock-group" data-key="' + groupKey(ts) + '">' + ic('lock', 'sm') + (allLocked ? 'Déverrouiller' : 'Verrouiller') + '</button><button class="btn ' + (done ? '' : 'primary') + '" data-act="done-group" data-key="' + groupKey(ts) + '">' + (done ? ic('refresh', 'sm') + 'Rouvrir' : ic('check', 'sm') + 'Terminer le dossier') + '</button>' : '') + '<button class="btn" data-act="close">Fermer</button></div>';
  }

  /* Jauge circulaire de charge d'une journée */
  function ringHtml(collabId, date, ids) { // V26.190 : ids = plusieurs personnes (bouton « Équipe » d'Aujourd'hui) — capacités et activités additionnées
    const c = collabOf(collabId), x = ctx(), all = list('tasks');
    const cap = ids ? ids.reduce((s, id) => s + E.capacityOn(collabOf(id), date, x), 0) : E.capacityOn(c, date, x);
    const l = ids ? ids.map(id => E.loadOf(all, id, date)).reduce((a, b) => ({ todo: a.todo + b.todo, done: a.done + b.done, total: a.total + b.total }), { todo: 0, done: 0, total: 0 }) : E.loadOf(all, collabId, date);
    const lv = E.levelOf(l.total, cap, x.settings);
    const R = 52, C = 2 * Math.PI * R, base = Math.max(cap, l.total, 1);
    const dDone = C * l.done / base, dTodo = C * l.todo / base;
    const col = { green: 'var(--ok)', orange: 'var(--warn)', red: 'var(--bad)', off: 'var(--faint)' }[lv];
    const html = '<div class="ring"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="' + R + '" stroke="var(--track)"/>'
      + (l.done ? '<circle cx="66" cy="66" r="' + R + '" stroke="var(--hatch)" stroke-dasharray="' + dDone.toFixed(1) + ' ' + C.toFixed(1) + '"/>' : '')
      + (l.todo ? '<circle cx="66" cy="66" r="' + R + '" stroke="' + col + '" stroke-dasharray="' + dTodo.toFixed(1) + ' ' + C.toFixed(1) + '" stroke-dashoffset="' + (-dDone).toFixed(1) + '"/>' : '')
      + '</svg><div class="center"><b data-count="' + l.total + '" data-fmt="min" data-key="ring-' + collabId + date + '">' + E.fmtMin(l.total) + '</b><span>sur ' + E.fmtMin(cap) + '</span></div></div>';
    return { cap, l, lv, html };
  }
  function loadBlock(collabId, date) {
    const c = collabOf(collabId), x = ctx(), rg = ringHtml(collabId, date);
    const ab = E.absenceOn(collabId, date, x), hol = x.settings.holidays && E.holidayName(date);
    const note = hol ? '<div class="notice">Jour férié : ' + esc(hol) + '</div>' : ab ? '<div class="notice">' + esc(absLabel(ab)) + (ab.note ? ' — ' + esc(ab.note) : '') + '</div>' : (c && !(c.work_days || []).includes(E.dow(date)) ? '<div class="notice">Jour non travaillé</div>' : '');
    return '<div class="load"><div class="load-card">' + rg.html + '<div class="legend-list"><div><span class="badge ' + LV_BADGE[msgLv(rg.lv, rg.l.total, rg.cap)] + '">' + lvLabel(msgLv(rg.lv, rg.l.total, rg.cap)) + '</span></div>'
      + '<div><i class="lg-sw hatch"></i>Réalisé<b>' + E.fmtMin(rg.l.done) + '</b></div><div><i class="lg-sw lv-' + rg.lv + '"></i>Reste à faire<b>' + E.fmtMin(rg.l.todo) + '</b></div>'
      + '<div><i class="lg-sw" style="background:var(--track)"></i>Capacité restante<b>' + E.fmtMin(rg.cap - rg.l.total) + '</b></div></div></div>' + note + '</div>';
  }
  /* Week-end : on bascule sur le lundi suivant (le samedi et le dimanche n'existent pas dans l'outil) */
  function weekday(d) { while (E.dow(d) >= 6) d = E.addDays(d, 1); return d; }
  const ABS_KINDS = [['conge', 'Congés'], ['absence', 'Absence'], ['formation', 'Formation'], ['reunion', 'Réunion interne'], ['autre', 'Autre (préciser)']];
  function absLabel(a) { const k = a.kind === 'autre' && a.note ? a.note : (Object.fromEntries(ABS_KINDS)[a.kind] || 'Absence').replace(' (préciser)', ''); return k + (a.minutes ? ' (' + E.fmtMin(a.minutes) + ')' : ' (journée)'); }
  const AL_ICON = { projection: ['users', 'r'], overload: ['flame', 'r'], near: ['gauge', 'o'], due: ['clock', 'o'], unplanned: ['alert', 'o'], late: ['alert', 'r'], received: ['inbox', 'b'] };
  function alertList(al, max) {
    if (!al.length) return '<div class="empty">Aucune alerte — tout est sous contrôle.</div>';
    const shown = max ? al.slice(0, max) : al;
    return '<div class="alerts">' + shown.map((a, i) => { const k = AL_ICON[a.type] || ['alert', '']; return '<div class="alert anim-in" style="--i:' + i + '" data-act="alert" data-task="' + (a.task_id || '') + '" data-client="' + (a.client_id || '') + '" data-collab="' + (a.collab_id || '') + '" data-date="' + (a.date || '') + '"><span class="ibox ' + k[1] + '">' + ic(k[0], 'sm') + '</span><span class="t">' + esc(softText(a.text)) + '</span>' + ic('chevR', 'sm chev') + '</div>'; }).join('')
      + (max && al.length > max ? (isManager() ? '<a href="#/dashboard" class="btn sm" style="align-self:flex-start">+ ' + (al.length - max) + ' autre(s)</a>' : '<span class="small muted">+ ' + (al.length - max) + ' autre(s)</span>') : '') + '</div>';
  }
  function noCollabsHelp() {
    return '<div class="card anim-in"><h2 style="margin-bottom:10px">Bienvenue</h2><p>Pour démarrer :</p><ol><li>Créez les collaborateurs (<a href="#/settings">Paramètres › Collaborateurs</a>).</li><li>Importez vos dossiers depuis Excel (<a href="#/settings">Paramètres › Import Excel</a>).</li><li>Créez les dossiers du mois (bouton « Créer les dossiers du mois » dans Planning ou Tableau de bord).</li></ol>' + (isAdmin() ? '' : '<p class="muted">Ces étapes sont réservées à l\'administrateur.</p>') + '</div>';
  }
  function monthActions(m) {
    if (!canReplan()) return ''; // V26.164 : « Replanifier » pour le manager, le RC et le collaborateur (pas l'apprenti)
    const missing = isManager() ? missingForMonth(m) : 0;
    return (missing ? '<button class="btn" data-act="generate" data-m="' + m + '" title="Crée la production ' + deMonth(m) + ' pour les dossiers qui n\'y figurent pas encore (réception attendue, temps, échéance), puis les planifie">' + ic('plus', 'sm') + 'Créer les dossiers du mois (' + missing + ')</button>' : '')
      + '<button class="btn dark" data-act="replan" data-m="' + m + '">' + ic('refresh', 'sm') + 'Replanifier le mois</button>';
  }
  function missingForMonth(m) {
    const have = new Set(list('productions').filter(p => p.month === m).map(p => p.client_id));
    return list('clients').filter(c => c.active !== false && !have.has(c.id) && E.clientApplies(c, m, cfg())).length;
  }

  /* ---------- Bandeau de progression de la période (écran Aujourd'hui) ---------- */
  /* V26.83 : bandeau « dossiers non planifiés » (écran Aujourd'hui, collaborateur / RC / manager) */
  function unplBanner(cid) {
    if (!cid) return '';
    const m = today().slice(0, 7);
    // V26.93 : une ligne compacte par mois — rouge s'il reste des dossiers non planifiés, verte si tout est planifié
    const open = list('tasks').filter(t => t.month >= m && t.collaborator_id === cid && !t.done && t.kind !== 'info');
    const months = [...new Set(open.map(t => t.month))].sort();
    if (!months.length) return '';
    return '<div class="unpl-wrap anim-in">' + months.map(mo => {
      const tm = open.filter(t => t.month === mo && !t.planned_date);
      if (!tm.length) return '<div class="unpl-bn ok">' + ic('check', 'sm') + '<span><b>Tous les dossiers ' + esc(deMonth(mo)) + ' sont planifiés</b></span></div>';
      const n = new Set(tm.map(t => t.production_id)).size, names = [...new Set(tm.map(t => (clientOf(t.client_id) || {}).name).filter(Boolean))];
      return '<div class="unpl-bn ko">' + ic('alert', 'sm') + '<span><b>' + n + ' dossier' + (n > 1 ? 's non planifiés' : ' non planifié') + ' sur le mois de ' + esc(fMonth(mo)) + '</b> — ' + esc(names.slice(0, 4).join(', ')) + (names.length > 4 ? '…' : '') + '</span><button class="btn sm" data-act="go-unpl" data-m="' + mo + '">Voir</button></div>';
    }).join('') + '</div>';
  }
  function progressBanner(cid, ids) {    const x = ctx(), td = today(), m = td.slice(0, 7), w = E.windowOf(m, x.settings), c = collabOf(cid) || (ids && collabOf(ids[0])); // V26.190 : ids = équipe
    const mine = list('tasks').filter(t => t.month === m && (ids ? ids.includes(t.collaborator_id) : !cid || t.collaborator_id === cid));
    const tot = mine.reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
    const done = mine.filter(t => t.done).reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
    const pct = tot ? Math.round(done / tot * 100) : 0;
    let days = 0;
    for (let d = td > w.start ? td : w.start; d <= w.end; d = E.addDays(d, 1)) if (c && E.capacityOn(c, d, x) > 0) days++;
    // V26.167 : le dernier jour réel de la période (24 un samedi → lundi 26), pas le réglage brut
    const head = td > w.end ? 'Période terminée' : td < w.start ? 'Démarrage le ' + Number(w.start.slice(8)) : 'J-' + days + ' avant le ' + endLbl(m);
    const sub = td > w.end ? 'Période du ' + Number(w.start.slice(8)) + ' au ' + endLbl(m) + ' close' : days + ' jour' + (days > 1 ? 's' : '') + ' ouvré' + (days > 1 ? 's' : '') + ' restant' + (days > 1 ? 's' : '');
    return '<div class="pbanner anim-in"><div class="pb-l"><b>' + head + '</b><span>' + sub + '</span></div>'
      + '<div class="pb-bar"><div class="bar"><i class="lv-green" style="width:' + pct + '%"></i></div><span>' + E.fmtMin(done) + ' réalisées sur ' + E.fmtMin(tot) + '</span></div>'
      + '<div class="pb-r"><b data-count="' + pct + '" data-fmt="pct" data-key="pb' + cid + m + '">' + pct + ' %</b><span>réalisé · reste ' + E.fmtMin(tot - done) + '</span></div></div>';
  }

  /* ---------- Filtres rapides du planning ---------- */
  const QUICK = [['unpl', 'Non planifiés', 'alert', 'r'], ['late', 'À reprendre', 'refresh', 'o'], ['recv', 'À recevoir', 'inbox', 'b'], ['info', 'Demandes à faire', 'mail', 'o'], ['done', 'Tenue terminées', 'check', 'g'], ['tvatodo', 'TVA à faire', 'file', 'o'], ['tvasent', 'TVA envoyées', 'check', 'g']];
  const QUICK_TIP = { unpl: 'Dossiers que le planificateur n\'a pu placer dans aucun jour : capacité insuffisante avant l\'échéance, ou éléments attendus trop tard. À confier à un autre planning (glisser-déposer) ou à décaler.' /* V26.182 : plus de mention des heures supplémentaires */, late: 'Tâches dont la date planifiée est passée sans être terminées, ou dont l\'échéance TVA est dépassée : à replanifier ou terminer en priorité.', recv: 'Dossiers dont les éléments du client ne sont pas encore arrivés.', info: 'Demandes d\'informations au client à envoyer.', done: 'Tenues terminées ce mois-ci : cliquez pour rouvrir un dossier noté terminé par erreur.', tvatodo: 'Tenue terminée, déclaration de TVA pas encore déposée.', tvasent: 'Déclarations de TVA déposées ce mois-ci.' };
  /* V26.35 : dossiers avec une déclaration de TVA (CA3, CA12, acompte), déposée ou à faire (tenue terminée) */
  function tvaTasks(cid, m, sent) {
    return list('tasks').filter(t => t.month === m && t.collaborator_id === cid && t.kind !== 'info' && t.kind !== 'dashboard').filter((t, i, a) => a.findIndex(x => x.production_id === t.production_id) === i).filter(t => {
      const p = S.data.productions.get(t.production_id), c = clientOf(t.client_id); if (!p || !c) return false;
      const os = E.obligations(c, m, cfg()).filter(o => ['CA3', 'CA12', 'ACPT'].includes(o.code)); if (!os.length) return false;
      const filed = os.every(o => p.filing && p.filing[o.code]);
      return sent ? filed : !filed && prodDone(p);
    });
  }
  function quickSets(cid, m) {
    const td = today(), ts = list('tasks').filter(t => t.month === m && t.collaborator_id === cid && !t.done);
    const exp = t => (S.data.productions.get(t.production_id) || {}).expected_date || '';
    return {
      unpl: ts.filter(t => t.kind !== 'info' && !t.planned_date),
      late: ts.filter(t => (t.planned_date && E.endDate(t) < td) || (t.due_date && t.due_date < td)),
      recv: ts.filter(t => t.kind !== 'info' && !E.isReceived(t, S.data.productions.get(t.production_id))).sort((a, b) => exp(a).localeCompare(exp(b))),
      info: ts.filter(t => t.kind === 'info'),
      done: list('tasks').filter(t => t.month === m && t.collaborator_id === cid && t.done && t.kind !== 'info').sort((a, b) => (b.done_at || '').localeCompare(a.done_at || '')),
      tvatodo: tvaTasks(cid, m, false), tvasent: tvaTasks(cid, m, true)
    };
  }
  /* V26.83 : pourquoi des dossiers restent non planifiés */
  function unplWhy(ts, m) {
    const win = E.windowOf(m, cfg());
    const late = ts.filter(t => { const p = S.data.productions.get(t.production_id) || {}; const r = p.received_date || p.expected_date; return r && r > (t.due_date && t.due_date < win.end ? t.due_date : win.end); }).length;
    const cap = ts.length - late;
    return '<b>Non planifié sur le mois de ' + esc(fMonth(m)) + '</b> : aucune place trouvée avant l\'échéance — ' + [cap ? cap + ' par manque de capacité (planning plein jusqu\'à l\'échéance)' : '', late ? late + ' car les éléments sont attendus après l\'échéance ou la fin de période' : ''].filter(Boolean).join(', ') + '. <b>Glissez un dossier sur un jour du planning ci-dessous</b> (vue Semaine ou Mois) pour le placer à la main, ou vers le planning d\'une autre personne ; vous pouvez aussi l\'ouvrir pour choisir une date.';
  }
  function quickBar(cid, m) {    const q = quickSets(cid, m);
    const cur = QUICK.find(d => d[0] === S.quick);
    return '<div class="chips scroll qf no-print" data-keep="qf">' + QUICK.filter(d => d[0] !== 'unpl' || q.unpl.length || S.quick === 'unpl').map(d => '<button class="chip' + (S.quick === d[0] ? ' on' : '') + (d[0] === 'unpl' ? ' chip-unpl' : '') + '" data-act="quick" data-q="' + d[0] + '" title="' + esc(QUICK_TIP[d[0]] ? d[1] + '\n' + QUICK_TIP[d[0]] + (d[0] === 'unpl' && !isManager() ? ' Si aucune solution n\'est possible, rapproche-toi de ton manager.' : '') : '') + '">' + ic(d[2], 'sm') + d[1] + (d[0] === 'unpl' ? ' · ' + esc(fMonth(m).split(' ')[0]) : '') + '<span class="qn ' + d[3] + '">' + q[d[0]].length + '</span></button>').join('') + '</div>'
      + (cur ? '<div class="frame anim-in" style="margin-bottom:var(--gap)"><div class="frame-h">' + ic(cur[2]) + '<h2>' + cur[1] + (cur[0] === 'unpl' ? ' sur le mois de ' + esc(fMonth(m)) : '') + '</h2><span class="badge ' + cur[3] + '">' + q[cur[0]].length + '</span><button class="x" data-act="quick" data-q="' + cur[0] + '" aria-label="Fermer le filtre">' + ic('x', 'sm') + '</button></div><div class="inner">'
        + (cur[0] === 'unpl' && q.unpl.length ? '<p class="small" style="margin:0 0 10px">' + unplWhy(q.unpl, m) + '</p>' : '') + (q[cur[0]].length ? '<div class="tasks">' + q[cur[0]].map(t => taskRow(t, { showDate: true, swipe: false, drag: cur[0] === 'unpl' || cur[0] === 'late' })).join('') + '</div>' : '<div class="empty">Rien à signaler.</div>') + '</div></div>' : '');
  }

  /* ---------- Frise (Gantt) de l'équipe : un dossier étalé apparaît en barre continue ---------- */
  function teamGantt(dates) {
    const x = ctx(), td = today(), cs = visibleCollabs(), tasks = list('tasks');
    const idx = new Map(dates.map((d, i) => [d, i])), n = dates.length;
    const head = '<div class="grow ghead" style="--n:' + n + '"><div class="gname"></div>' + dates.map((d, i) => '<div class="gday' + (d === td ? ' today' : '') + '" style="grid-column:' + (i + 2) + '">' + DAYS_S[E.dow(d) - 1].slice(0, 3) + '<b>' + Number(d.slice(8)) + '</b></div>').join('') + '</div>';
    const rows = cs.map(c => {
      const items = tasks.filter(t => t.collaborator_id === c.id && t.planned_date).map(t => {
        const ds = E.segs(t).map(s => idx.get(s.d)).filter(v => v !== undefined);
        return ds.length ? { t, a: Math.min.apply(null, ds), b: Math.max.apply(null, ds) } : null;
      }).filter(Boolean).sort((p, q) => p.a - q.a || q.b - p.b);
      const lanes = [];
      items.forEach(it => { let l = lanes.findIndex(end => end < it.a); if (l < 0) { l = lanes.length; lanes.push(-1); } lanes[l] = it.b; it.l = l; });
      const L = Math.max(1, lanes.length);
      const bg = dates.map((d, i) => { const cap = E.capacityOn(c, d, x), l = E.loadOf(tasks, c.id, d).total; return '<div class="gbg' + (cap <= 0 ? ' off' : l > cap ? ' over' : '') + (d === td ? ' today' : '') + '" style="grid-column:' + (i + 2) + ';grid-row:1 / span ' + L + '"></div>'; }).join('');
      const bars = items.map(it => {
        const t = it.t, cl = clientOf(t.client_id) || {}, p = S.data.productions.get(t.production_id), late = !t.done && E.endDate(t) < td;
        return '<div class="gbar k-' + t.kind + (t.done ? ' done' : '') + (p && !p.received_date && t.kind !== 'info' ? ' forecast' : '') + (late ? ' late' : '') + '" style="grid-column:' + (it.a + 2) + ' / ' + (it.b + 3) + ';grid-row:' + (it.l + 1) + '" data-act="task" data-id="' + t.id + '" title="' + esc(cl.name + ' — ' + E.KIND_LABEL[t.kind] + ' — ' + E.fmtMin(t.duration_min)) + '"><span>' + (t.kind === 'info' ? ic('mail', 'sm') : '') + esc(cl.name) + '</span><small>' + E.fmtMin(t.duration_min) + '</small></div>';
      }).join('');
      const unpl = tasks.filter(t => t.collaborator_id === c.id && !t.done && !t.planned_date && t.month === S.month).length;
      return '<div class="grow" style="--n:' + n + ';grid-template-rows:repeat(' + L + ', 46px)"><div class="gname" style="grid-row:1 / span ' + L + '"><span class="mini-av" style="background:' + esc(c.color || '#888') + '">' + esc(initials(c.name)) + '</span><div><b>' + esc(c.name) + '</b>' + (unpl ? '<span class="badge r">' + unpl + ' non planifié' + (unpl > 1 ? 's' : '') + '</span>' : '') + '</div></div>' + bg + bars + '</div>';
    }).join('');
    return '<div class="card"><div class="gantt scroll-x" data-keep="gantt">' + head + rows + '</div>'
      + '<div class="legend" style="margin-top:12px"><span><i class="lg-sw" style="background:var(--k-production)"></i>Production</span><span><i class="lg-sw" style="background:var(--k-info)"></i>Demande d\'infos</span><span><i class="lg-sw hatch"></i>Prévisionnel (pointillés)</span><span><i class="lg-sw" style="background:var(--bad-soft)"></i>Jour surchargé</span><span><i class="lg-sw" style="background:var(--surface-2)"></i>Non travaillé</span></div></div>';
  }

  /* ---------- Projection de fin de période + propositions de répartition (tableau de bord) ---------- */
  /* Tenue des échéances TVA : « l'équipe tient le 21 » (TVA au 21) et « le 24 » (TVA au 24), en grand */
  /* Manager de plusieurs équipes : filtre du Pilotage par équipe */
  function teamPicker() {
    const teams = list('teams').filter(tm => isAdmin() || tm.manager_id === S.me.id).sort(byName);
    if (teams.length < 2) { if (S.teamFilter && !teams.some(tm => tm.id === S.teamFilter)) S.teamFilter = ''; return ''; }
    return '<div class="chips scroll" style="margin-bottom:14px" data-keep="team-pick"><button class="chip' + (!S.teamFilter ? ' on' : '') + '" data-act="team-filter" data-id="">' + (isAdmin() ? 'Tout le cabinet' : 'Toutes mes équipes') + '</button>' + teams.map(tm => '<button class="chip' + (S.teamFilter === tm.id ? ' on' : '') + '" data-act="team-filter" data-id="' + tm.id + '">' + ic('users', 'sm') + esc(tm.name) + '</button>').join('') + '</div>';
  }
  /* V26.90 : détail d'une échéance non tenue (carte centrée) */
  function sheetMsDetail(s) {
    const m = s.m, st = cfg(), td = today(), days = [Number(st.mid_day) || 21, st.end_day].filter(d => d >= st.start_day && d <= st.end_day);
    const data = scopedData(), ms = E.milestones(data, m, td, days).filter(x => !x.ok);
    const open = data.tasks.filter(t => t.month === m && !t.done && t.due_date && t.kind !== 'info');
    const body = ms.map((x, i) => {
      const all = E.milestones(data, m, td, days), k = all.findIndex(y => y.day === x.day), prev = k > 0 ? all[k - 1].date : null;
      const own = open.filter(t => t.due_date <= x.date && (!prev || t.due_date > prev));
      const bad = own.map(t => ({ t, end: t.planned_date ? E.endDate(t) : null })).filter(r => !r.end || r.end > r.t.due_date)
        .sort((a, b) => (a.end ? 1 : 0) - (b.end ? 1 : 0) || byName(clientOf(a.t.client_id) || {}, clientOf(b.t.client_id) || {}));
      const rows = bad.map(r => { const c = clientOf(r.t.client_id) || { name: '?' }, co = collabOf(r.t.collaborator_id), p = S.data.productions.get(r.t.production_id) || {};
        const rec = p.received_date ? 'reçu le ' + fDM(p.received_date) : p.expected_date ? 'pièces attendues le ' + fDM(p.expected_date) : '';
        return '<tr class="click" data-act="task" data-id="' + r.t.id + '"><td class="first"><b>' + esc(c.name) + '</b></td><td data-l="Qui">' + esc(co ? co.name : '—') + '</td><td data-l="Temps">' + E.fmtMin(r.t.duration_min) + '</td><td data-l="Pièces" class="small">' + esc(rec) + '</td><td data-l="Problème">' + (r.end ? '<span class="badge o">Fini le ' + fDM(r.end) + ', après l\'échéance du ' + fDM(r.t.due_date) + '</span>' : '<span class="badge r">Non planifié</span>') + '</td></tr>'; }).join('');
      const def = x.deficit.map(r => '<li><b>' + esc(r.collab.name) + '</b> : ' + E.fmtMin(r.todo) + ' à faire pour ' + E.fmtMin(r.cap) + ' disponibles d\'ici le ' + fDM(x.date) + ' → manque <b>' + E.fmtMin(-r.balance) + '</b></li>').join('');
      return '<div class="card" style="box-shadow:none"><div class="card-h"><h3>TVA au ' + x.day + (Number(x.date.slice(8)) !== Number(x.day) ? ' (reportée au ' + esc(fShort(x.date)) + ')' : '') + '</h3><span class="badge r">' + bad.length + ' dossier' + (bad.length > 1 ? 's' : '') + ' en difficulté sur ' + x.dossiers + '</span></div>'
        + (def ? '<p class="small" style="margin:0 0 6px">Capacité insuffisante :</p><ul class="small" style="margin:0 0 10px">' + def + '</ul>' : '<p class="small muted" style="margin:0 0 10px">Les heures suffisent au total, mais ces dossiers ne trouvent pas de créneau avant leur échéance (pièces attendues tard, journées déjà pleines juste avant l\'échéance).</p>')
        + (rows ? '<div class="scroll-x"><table class="t stack"><thead><tr><th>Dossier</th><th>Qui</th><th>Temps</th><th>Pièces</th><th>Problème</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="muted small">Aucun dossier isolé : c\'est la charge globale qui dépasse.</div>') + '</div>';
    }).join('');
    return sheetHead('Échéances non tenues — ' + esc(fMonth(m)), 'Dossiers qui ne seront pas finis à temps et pourquoi')
      + '<div class="sheet-b">' + (body || '<div class="empty">Toutes les échéances sont tenues.</div>')
      + '<p class="small muted">Solutions : glisser un dossier vers un autre planning (collaborateur, apprenti), relancer le client pour obtenir les pièces plus tôt, ou replanifier le mois. Cliquez sur un dossier pour l\'ouvrir.</p></div>'
      + '<div class="sheet-f">' + (canReplan() ? '<button class="btn" data-act="replan" data-m="' + m + '">Replanifier le mois</button>' : '') + '<span class="spacer"></span><button class="btn" data-act="close">Fermer</button></div>';
  }
  function milestoneBanner(m) {    const st = cfg(), td = today(), days = [Number(st.mid_day) || 21, st.end_day].filter(d => d >= st.start_day && d <= st.end_day);
    const ms = E.milestones(scopedData(), m, td, days).filter(x => !x.past || m !== td.slice(0, 7));
    if (!ms.length) return '';
    const ok = ms.every(x => x.ok), ko = ms.filter(x => !x.ok);
    const line = x => '<div class="ms-l ' + (x.ok ? 'ok' : 'ko') + '"' + (x.ok ? '' : ' data-act="ms-detail" data-m="' + m + '" role="button" tabindex="0" style="cursor:pointer" title="Voir le détail"') + '>' + ic(x.ok ? 'check' : 'alert', 'sm') + '<b>TVA au ' + x.day + (Number(x.date.slice(8)) !== Number(x.day) ? ' <small style="font-weight:500">(reportée au ' + esc(fShort(x.date)) + ')</small>' : '') + '</b><span>' + x.dossiers + ' dossier' + (x.dossiers > 1 ? 's' : '') + ' · ' + (x.ok ? 'tenue' : 'manque ' + esc(x.deficit.map(r => r.collab.name + ' ' + E.fmtMin(-r.balance)).join(', ') || 'des créneaux')) + (x.ok ? '' : ' <u>Voir le détail</u>') + '</span></div>';
    return '<div class="ms-pill ' + (ok ? 'ok' : 'ko') + '" tabindex="0"' + (ok ? '' : ' data-act="ms-detail" data-m="' + m + '" role="button" style="cursor:pointer"') + '>' + ic(ok ? 'check' : 'alert', 'sm') + '<b>' + (ok ? 'L\'équipe tiendra les échéances' : 'Échéance' + (ko.length > 1 ? 's' : '') + ' du ' + ko.map(x => x.day).join(' et du ') + ' non tenue' + (ko.length > 1 ? 's' : '')) + '</b>'
      + '<div class="ms-tip" role="tooltip">' + ms.map(line).join('') + '</div></div>';  }
  /* ====================== V26.100 : réaffectations proposées ====================== */
  function rebalanceProps(m) {
    const k = m + '|' + (S.dataVersion || 0) + '|' + list('tasks').length + '|' + list('tasks').reduce((s, t) => s + (t.version || 0), 0);
    if (S._rbKey === k) return S._rbCache;
    let r = [];
    try { r = E.rebalance(scopedData(), m, today(), { allowed: new Set(visibleCollabs().map(c => c.id)), freezeUntil: E.freezeEnd(today(), cfg().freeze_days) }); } catch (e) { console.warn('rebalance', e); }
    S._rbKey = k; S._rbCache = r; return r;
  }
  const rbWhen = x => x.alloc ? Object.keys(x.alloc).sort().map(d => fShort(d) + ' (' + E.fmtMin(x.alloc[d]) + ')').join(' + ') : fShort(x.date) + ' (' + E.fmtMin(x.dur) + ')';
  function sheetRebalance(s) {
    const props = s.props || [], sel = s.sel;
    const rows = props.map(x => '<tr><td><input type="checkbox" data-ch="rb-sel" data-id="' + x.task_id + '"' + (sel.has(x.task_id) ? ' checked' : '') + ' aria-label="Retenir ' + esc(x.client) + '"></td><td class="first"><b>' + esc(x.client) + '</b><div class="small muted">' + E.fmtMin(x.dur) + '</div></td><td data-l="De → À" class="nowrap">' + esc((collabOf(x.from) || {}).name || '?') + ' → <b>' + esc((collabOf(x.to) || {}).name || '?') + '</b></td><td data-l="Quand">' + esc(rbWhen(x)) + '</td><td data-l="Échéance" class="nowrap">' + fDM(x.due) + '</td><td data-l="Aujourd\'hui"><span class="badge r">' + esc(x.problem === 'non planifié' ? 'Non planifié' : 'Fin après l\'échéance') + '</span></td></tr>').join('');
    return sheetHead('Réaffectations proposées — ' + esc(fMonth(s.m)), 'Chaque dossier ci-dessous ne tiendra pas son échéance chez son titulaire ; un collègue a un créneau libre avant l\'échéance.')
      + '<div class="sheet-b">' + (props.length ? '<div class="row" style="margin-bottom:8px"><button class="btn sm" data-act="rb-all" data-v="1">Tout cocher</button><button class="btn sm" data-act="rb-all" data-v="0">Tout décocher</button><span class="spacer"></span><span class="small muted">' + sel.size + ' sur ' + props.length + ' retenue(s)</span></div>'
        + '<div class="scroll-x"><table class="t stack"><thead><tr><th></th><th>Dossier</th><th>De → À</th><th>Quand</th><th>Échéance</th><th>Aujourd\'hui</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        + '<p class="small muted">Rien n\'est modifié tant que vous n\'avez pas confirmé deux fois. Les dossiers réaffectés ne sont pas verrouillés : la replanification peut encore ajuster leur date chez leur nouveau titulaire.</p>' : '<div class="empty">Aucune réaffectation nécessaire.</div>') + '</div>'
      + '<div class="sheet-f"><button class="btn" data-act="close">Annuler</button><span class="spacer"></span><button class="btn primary" data-act="rb-apply"' + (sel.size && !S.readonly ? '' : ' disabled') + '>Appliquer la sélection (' + sel.size + ')</button></div>';
  }
  async function applyRebalance() {
    const s = S.sheet; if (!s || s.type !== 'rebal' || !isManager()) return;
    const chosen = s.props.filter(x => s.sel.has(x.task_id)); if (!chosen.length) return;
    const byTo = {}; chosen.forEach(x => { const n = (collabOf(x.to) || {}).name || '?'; byTo[n] = (byTo[n] || 0) + 1; });
    const ok = await confirmBox('Confirmer les réaffectations', '<p>Vous allez confier <b>' + chosen.length + ' dossier' + (chosen.length > 1 ? 's' : '') + '</b> à un autre collaborateur :</p><ul>' + Object.keys(byTo).map(n => '<li>' + esc(n) + ' : ' + byTo[n] + ' dossier' + (byTo[n] > 1 ? 's' : '') + '</li>').join('') + '</ul><ul class="small">' + chosen.map(x => '<li>' + esc(x.client) + ' → ' + esc((collabOf(x.to) || {}).name || '?') + ', ' + esc(rbWhen(x)) + '</li>').join('') + '</ul><p class="small muted">Les collaborateurs concernés verront ces dossiers dans leur planning.</p>', 'Oui, réaffecter ' + chosen.length + ' dossier' + (chosen.length > 1 ? 's' : ''));
    if (!ok) return;
    const items = chosen.map(x => ({ id: x.task_id, patch: { collaborator_id: x.to, planned_date: x.date, alloc: x.alloc || null, seq: nextSeq(x.to, x.date), locked: false } }));
    const r = await saveMany('tasks', items);
    hist('reaffectation', { entity: 'month', entity_id: s.m, detail: { text: chosen.length + ' dossier(s) réaffecté(s) : ' + chosen.map(x => x.client + ' → ' + ((collabOf(x.to) || {}).name || '?')).join(', ') } });
    S._rbKey = null; closeSheet(true);
    toast(chosen.length + ' dossier(s) réaffecté(s).', r && (r.failed || r.conflict) ? 'warn' : 'ok'); render();
  }
  function projectionSection(m) {    const td = today(), data = scopedData(), pj = E.projection(data, m, td), sg = E.suggestTransfers(data, m, td), st = cfg();
    const rb = isManager() ? rebalanceProps(m) : [];
    const x = ctx(), win = E.windowOf(m, x.settings), open = data.tasks.filter(t => t.month === m && !t.done);
    const isTva = t => !['info', 'dashboard'].includes(t.kind);
    const team = pj.team.map(r => {
      let cap = 0; for (let d = win.start; d <= win.end; d = E.addDays(d, 1)) cap += E.capacityOn(r.collab, d, x); // capacité du 1er au 24
      const mine = open.filter(t => t.collaborator_id === r.collab.id), sum = ts => ts.reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
      const tva = sum(mine.filter(isTva)), other = sum(mine.filter(t => !isTva(t)));
      return Object.assign({}, r, { cap, tva, other, used: Math.max(0, cap - r.capRest), free: r.capRest - tva - other });
    });
    const capAll = team.reduce((s, r) => s + r.capRest, 0), todoAll = team.reduce((s, r) => s + r.tva + r.other, 0), ok = todoAll <= capAll && !team.some(r => r.free < 0);
    const pc = (v, r) => (Math.max(0, v) / Math.max(1, r.cap, r.used + r.tva + r.other) * 100).toFixed(1) + '%';
    const rows = team.map(r => '<div class="pj-row"><div class="pj-n"><span class="mini-av" style="background:' + esc(r.collab.color || '#888') + '">' + esc(initials(r.collab.name)) + '</span><b>' + esc(r.collab.name) + '</b></div>'
      + '<div class="pjx" title="Capacité du 1er au ' + endLbl(m) + ' : ' + E.fmtMin(r.cap) + '"><i class="u" style="width:' + pc(r.used, r) + '"></i><i class="tva" style="width:' + pc(r.tva, r) + '"></i><i class="oth" style="width:' + pc(r.other, r) + '"></i>' + (r.free >= 0 ? '<i class="free" style="width:' + pc(r.free, r) + '"></i>' : '<i class="over" style="width:' + pc(-r.free, r) + '"></i>') + '</div>'
      + '<div class="pj-v"><b style="color:' + (r.free < 0 ? 'var(--bad)' : 'var(--ok)') + '">' + (r.free < 0 ? 'manque ' + E.fmtMin(-r.free) : E.fmtMin(r.free) + ' libres') + '</b><span>TVA ' + E.fmtMin(r.tva) + ' · autres ' + E.fmtMin(r.other) + ' · sur ' + E.fmtMin(r.cap) + '</span></div></div>').join('');    const sug = sg.length ? '<div class="tasks">' + sg.map(x => { const cl = clientOf(x.task.client_id) || {}; return '<div class="info-row"><span class="ibox b">' + ic('users', 'sm') + '</span><div class="t"><b>' + esc(cl.name) + '</b><span>' + E.fmtMin(x.dur) + ' · ' + esc(x.from.name) + ' → ' + esc(x.to.name) + (x.task.planned_date ? '' : ' · non planifié') + '</span></div>' + (isManager() && !S.readonly ? '<button class="btn sm" data-act="transfer" data-id="' + x.task.id + '" data-to="' + x.to.id + '">' + ic('arrowUR', 'sm') + 'Transférer</button>' : '') + '</div>'; }).join('') + '</div>'
      : '<div class="empty">' + (ok ? 'Aucune répartition nécessaire.' : 'Aucun collaborateur n\'a assez de marge pour absorber les dossiers en trop.') + '</div>';
    // V26.100 : réaffectations proposées (dossier, à qui, quand) — examinées puis confirmées deux fois par le manager
    const rbHtml = rb.length ? '<div class="rb-sum"><p class="small" style="margin:0 0 8px"><b>' + rb.length + ' dossier' + (rb.length > 1 ? 's' : '') + '</b> ne tiendront pas leur échéance faute de place, alors qu\'un collègue a un créneau libre avant l\'échéance.</p><div class="tasks">' + rb.slice(0, 4).map(x => '<div class="info-row"><span class="ibox o">' + ic('users', 'sm') + '</span><div class="t"><b>' + esc(x.client) + '</b><span>' + esc((collabOf(x.from) || {}).name || '?') + ' → <b>' + esc((collabOf(x.to) || {}).name || '?') + '</b> · ' + esc(rbWhen(x)) + ' · échéance ' + fDM(x.due) + '</span></div></div>').join('') + '</div>' + (rb.length > 4 ? '<div class="small muted" style="margin-top:6px">+ ' + (rb.length - 4) + ' autre(s)</div>' : '') + (S.readonly ? '' : '<button class="btn primary" style="width:100%;margin-top:10px" data-act="rb-open" data-m="' + m + '">' + ic('list', 'sm') + 'Examiner les ' + rb.length + ' proposition' + (rb.length > 1 ? 's' : '') + '</button>') + '</div>' : '';
    return '<div class="section-t"><h2>Projection TVA</h2><span class="badge k">' + ic('lock') + 'Manager</span></div>'
      + '<div class="split"><div class="card anim-in"><div class="card-h"><h2>Reste à faire et capacité</h2><span class="small muted">' + E.fmtMin(team.reduce((s, r) => s + r.tva, 0)) + ' de TVA · ' + E.fmtMin(team.reduce((s, r) => s + r.other, 0)) + ' d\'autres tâches</span></div>' + rows
      + '<div class="legend" style="margin-top:12px"><span><i class="lg-sw" style="background:var(--pj-used)"></i>Déjà passé / réalisé</span><span><i class="lg-sw" style="background:var(--pj-tva)"></i>Reste à faire TVA</span><span><i class="lg-sw" style="background:var(--pj-oth)"></i>Demandes d\'infos et tableaux de bord</span><span><i class="lg-sw" style="background:var(--ok)"></i>Capacité restante</span><span><i class="lg-sw" style="background:var(--bad)"></i>Dépassement</span></div></div>'
      + (isManager() ? '<div class="frame anim-in"><div class="frame-h">' + ic('users') + '<h2>Propositions de répartition</h2><span class="badge k">' + ic('lock') + 'Manager</span>' + (rb.length ? '<span class="badge o">' + rb.length + ' réaffectation' + (rb.length > 1 ? 's' : '') + '</span>' : sg.length ? '<span class="badge b">' + sg.length + '</span>' : '') + '</div><div class="inner">' + (rbHtml || sug) + '</div></div>' : '<div></div>') + '</div>';
  }
  async function transferTask(id, toId) {
    const t = S.data.tasks.get(id), to = collabOf(toId);
    if (!t || !to || !isManager()) return;
    const r = await saveUpdate('tasks', t.id, { collaborator_id: to.id, planned_date: null, alloc: null, seq: 0 }, { history: { action: 'changement_collaborateur', entity: 'task', entity_id: t.id, client_id: t.client_id, detail: { kind: t.kind, from_name: (collabOf(t.collaborator_id) || {}).name, to_name: to.name } } });
    if (r !== 'ok') return;
    await applyPlan(runPlan(t.month, 'incremental', new Set()));
    const n = S.data.tasks.get(t.id), cl = clientOf(t.client_id) || {};
    toast(cl.name + ' transféré à ' + to.name + (n && n.planned_date ? ', planifié le ' + fDM(n.planned_date) : ' (pas encore planifiable)'), n && n.planned_date ? 'ok' : 'warn');
  }

  /* ---------- Relance des éléments en retard : texte à copier-coller ----------
   * Rien n'est envoyé par l'application : le collaborateur copie le texte dans sa messagerie.
   * Vouvoiement / tutoiement en un clic ; modèles personnels, propres à chaque utilisateur. */
  const RELANCE_STD = {
    vous: 'Bonjour,\nJ’espère que vous allez bien.\nJe me permets de revenir vers vous car je n’ai toujours pas reçu vos documents comptables du mois de {mois}.\nPourriez-vous me les transmettre aujourd’hui ou demain afin que je puisse mettre à jour votre comptabilité et déclarer votre TVA dans les meilleures conditions ?\nMerci par avance pour votre retour et votre collaboration.\nJe vous souhaite une excellente journée.\nBien cordialement,',
    tu: 'Bonjour,\nJ’espère que tu vas bien.\nJe me permets de revenir vers toi car je n’ai toujours pas reçu tes documents comptables du mois de {mois}.\nPourrais-tu me les transmettre aujourd’hui ou demain afin que je puisse mettre à jour ta comptabilité et déclarer ta TVA dans les meilleures conditions ?\nMerci par avance pour ton retour et ta collaboration.\nJe te souhaite une excellente journée.\nBien cordialement,'
  };
  /* V26.165 : bibliothèque de modèles prêts à l'emploi ({mois} = mois des documents, {echeance} = date limite de la TVA) */
  const RELANCE_LIB = [
    { k: 'courte', name: 'Relance courte',
      vous: 'Bonjour,\nSauf erreur de ma part, je n’ai pas encore reçu vos documents comptables du mois de {mois}.\nPourriez-vous me les transmettre dès que possible ?\nMerci d’avance,\nBien cordialement,',
      tu: 'Bonjour,\nSauf erreur de ma part, je n’ai pas encore reçu tes documents comptables du mois de {mois}.\nPourrais-tu me les transmettre dès que possible ?\nMerci d’avance,\nBien cordialement,' },
    { k: 'preventif', name: 'Rappel avant la date habituelle',
      vous: 'Bonjour,\nPour préparer sereinement votre déclaration de TVA, pensez à m’envoyer vos documents comptables du mois de {mois} (relevés bancaires, factures d’achats et de ventes) dès qu’ils sont disponibles.\nMerci d’avance,\nBien cordialement,',
      tu: 'Bonjour,\nPour préparer sereinement ta déclaration de TVA, pense à m’envoyer tes documents comptables du mois de {mois} (relevés bancaires, factures d’achats et de ventes) dès qu’ils sont disponibles.\nMerci d’avance,\nBien cordialement,' },
    { k: 'deuxieme', name: 'Deuxième relance',
      vous: 'Bonjour,\nJe reviens vers vous au sujet de vos documents comptables du mois de {mois}, que je n’ai toujours pas reçus malgré ma précédente relance.\nSans ces éléments, je ne pourrai pas établir votre déclaration de TVA dans les délais (date limite le {echeance}).\nPourriez-vous me les faire parvenir au plus vite ?\nJe reste à votre disposition si vous rencontrez une difficulté.\nBien cordialement,',
      tu: 'Bonjour,\nJe reviens vers toi au sujet de tes documents comptables du mois de {mois}, que je n’ai toujours pas reçus malgré ma précédente relance.\nSans ces éléments, je ne pourrai pas établir ta déclaration de TVA dans les délais (date limite le {echeance}).\nPourrais-tu me les faire parvenir au plus vite ?\nJe reste à ta disposition si tu rencontres une difficulté.\nBien cordialement,' },
    { k: 'echeance', name: 'Échéance TVA proche',
      vous: 'Bonjour,\nVotre déclaration de TVA doit être déposée au plus tard le {echeance}.\nPour la préparer dans de bonnes conditions, j’ai besoin de vos documents comptables du mois de {mois} (relevés bancaires, factures d’achats et de ventes).\nPouvez-vous me les transmettre sous 48 heures ?\nMerci pour votre réactivité.\nBien cordialement,',
      tu: 'Bonjour,\nTa déclaration de TVA doit être déposée au plus tard le {echeance}.\nPour la préparer dans de bonnes conditions, j’ai besoin de tes documents comptables du mois de {mois} (relevés bancaires, factures d’achats et de ventes).\nPeux-tu me les transmettre sous 48 heures ?\nMerci pour ta réactivité.\nBien cordialement,' },
    { k: 'manquants', name: 'Pièces manquantes (envoi partiel)',
      vous: 'Bonjour,\nMerci pour les documents déjà transmis pour le mois de {mois}.\nIl me manque encore quelques éléments pour finaliser votre comptabilité et votre déclaration de TVA :\n- \n- \nPourriez-vous me les envoyer dès que possible ?\nBien cordialement,',
      tu: 'Bonjour,\nMerci pour les documents déjà transmis pour le mois de {mois}.\nIl me manque encore quelques éléments pour finaliser ta comptabilité et ta déclaration de TVA :\n- \n- \nPourrais-tu me les envoyer dès que possible ?\nBien cordialement,' },
    { k: 'releves', name: 'Relevés bancaires',
      vous: 'Bonjour,\nPour clôturer la comptabilité du mois de {mois}, il me manque vos relevés bancaires (tous vos comptes professionnels).\nUn simple fichier PDF suffit.\nMerci d’avance,\nBien cordialement,',
      tu: 'Bonjour,\nPour clôturer la comptabilité du mois de {mois}, il me manque tes relevés bancaires (tous tes comptes professionnels).\nUn simple fichier PDF suffit.\nMerci d’avance,\nBien cordialement,' },
    { k: 'factures', name: 'Factures d’achats et de ventes',
      vous: 'Bonjour,\nAfin de déclarer votre TVA du mois de {mois}, pourriez-vous me transmettre l’ensemble de vos factures d’achats et de ventes de la période ?\nUne photo nette ou un fichier PDF suffit.\nMerci beaucoup,\nBien cordialement,',
      tu: 'Bonjour,\nAfin de déclarer ta TVA du mois de {mois}, pourrais-tu me transmettre l’ensemble de tes factures d’achats et de ventes de la période ?\nUne photo nette ou un fichier PDF suffit.\nMerci beaucoup,\nBien cordialement,' },
    { k: 'sms', name: 'SMS / message court',
      vous: 'Bonjour, petit rappel : j’attends toujours vos documents comptables de {mois} pour la TVA (date limite le {echeance}). Merci d’avance et bonne journée !',
      tu: 'Bonjour, petit rappel : j’attends toujours tes documents comptables de {mois} pour la TVA (date limite le {echeance}). Merci d’avance et bonne journée !' },
    { k: 'dernier', name: 'Dernier rappel',
      vous: 'Bonjour,\nMalgré mes précédentes relances, je n’ai toujours pas reçu vos documents comptables du mois de {mois}.\nLa date limite de dépôt de votre déclaration de TVA est le {echeance}. Sans ces éléments, je ne pourrai pas la déposer à temps, ce qui peut entraîner des pénalités de retard.\nMerci de me les transmettre au plus vite, ou de m’appeler si vous rencontrez une difficulté.\nBien cordialement,',
      tu: 'Bonjour,\nMalgré mes précédentes relances, je n’ai toujours pas reçu tes documents comptables du mois de {mois}.\nLa date limite de dépôt de ta déclaration de TVA est le {echeance}. Sans ces éléments, je ne pourrai pas la déposer à temps, ce qui peut entraîner des pénalités de retard.\nMerci de me les transmettre au plus vite, ou de m’appeler si tu rencontres une difficulté.\nBien cordialement,' }
  ];
  /* Mois concerné par la relance : le mois précédant le mois actuel (« septembre » en octobre). */
  const relanceMonth = () => MONTHS[Number(E.addMonths(today().slice(0, 7), -1).slice(5, 7)) - 1];
  /* V26.165 : date limite de la TVA du dossier, en toutes lettres (« 21 octobre ») */
  function relanceDue(p) {
    const c = p && clientOf(p.client_id); if (!c) return '';
    let d = ''; try { d = E.obligations(c, p.month, cfg()).map(o => o.due).sort()[0] || E.productionDue(c, p.month, cfg()) || ''; } catch (e) { d = ''; }
    return d ? Number(d.slice(8)) + ' ' + MONTHS[Number(d.slice(5, 7)) - 1] : '';
  }
  /* Modèles personnels (illimités) et texte mémorisé par client : propres à chaque utilisateur (l'administrateur « en tant que » garde les siens) */
  const CLIENT_TPL = '§client:';
  // V26.167 : modèles nommés propres à un dossier (« §dossier:<id client>|<nom chiffré> », textes chiffrés), visibles sur ce seul dossier
  const DOSSIER_TPL = '§dossier:';
  const tplOwner = () => (((S.realMe || S.me) || {}).email || '').toLowerCase();
  const myTemplates = () => list('message_templates').filter(t => (t.owner_email || '').toLowerCase() === tplOwner() && !String(t.name || '').startsWith('§')).sort(byName);
  const clientTplOf = cid => cid ? list('message_templates').find(t => (t.owner_email || '').toLowerCase() === tplOwner() && t.name === CLIENT_TPL + cid) : null;
  const dossierTpls = cid => !cid ? [] : list('message_templates').filter(t => (t.owner_email || '').toLowerCase() === tplOwner() && String(t.name || '').startsWith(DOSSIER_TPL + cid + '|')).sort((a, b) => tplLabel(a).localeCompare(tplLabel(b), 'fr'));
  const isDossierTpl = t => !!t && String(t.name || '').startsWith(DOSSIER_TPL);
  // Nom affiché d'un modèle (celui d'un modèle de dossier est chiffré)
  const tplLabel = t => !t ? '' : isDossierTpl(t) ? (plainOf(t.name.slice(t.name.indexOf('|') + 1)) || 'Modèle illisible sur cet appareil') : String(t.name || '');
  // Texte en clair d'un champ éventuellement chiffré (déchiffré à l'ouverture de la fenêtre) ; undefined s'il est illisible ici
  const plainOf = v => (typeof v === 'string' && v.startsWith(ENC)) ? CRYPTO.cache.get(v) : v;
  const fillTpl = (txt, p) => String(txt || '').split('{echeance}').join(relanceDue(p) || 'la date limite').split('{mois}').join(relanceMonth());
  function relanceTexts(tplId, p) {
    let src = RELANCE_STD;
    if (tplId && tplId.startsWith('lib:')) src = RELANCE_LIB.find(x => 'lib:' + x.k === tplId) || RELANCE_STD;
    else if (tplId === 'client') { const ct = p && clientTplOf(p.client_id); if (ct) src = { vous: plainOf(ct.body_vous) || RELANCE_STD.vous, tu: plainOf(ct.body_tu) || RELANCE_STD.tu }; }
    else if (tplId) { const t = S.data.message_templates.get(tplId); if (t) src = { vous: plainOf(t.body_vous) || RELANCE_STD.vous, tu: plainOf(t.body_tu) || RELANCE_STD.tu }; }
    return { vous: fillTpl(src.vous, p), tu: fillTpl(src.tu, p) };
  }
  function sheetRelance(s) {
    const p = S.data.productions.get(s.pid); if (!p) return '';
    const c = clientOf(p.client_id) || {}, ct = clientTplOf(c.id), dts = dossierTpls(c.id);
    const ctOk = ct && (plainOf(ct.body_vous) || plainOf(ct.body_tu));
    if (!s.texts) {
      const last = lsGet('planif-relance-tpl') || '', lastC = lsGet('planif-relance-tpl:' + c.id) || '';
      const lastOk = (S.data.message_templates.has(last) && !isDossierTpl(S.data.message_templates.get(last))) || RELANCE_LIB.some(x => 'lib:' + x.k === last);
      // texte mémorisé du client, sinon un modèle du dossier (le dernier utilisé), sinon le dernier modèle utilisé
      s.tplId = ctOk ? 'client' : dts.some(t => t.id === lastC) ? lastC : dts.length ? dts[0].id : lastOk ? last : '';
      s.tone = lsGet('planif-tone-' + c.id) === 'tu' ? 'tu' : 'vous';
      s.texts = relanceTexts(s.tplId, p);
    }
    const tpls = myTemplates(), cur = s.tplId && s.tplId !== 'client' ? S.data.message_templates.get(s.tplId) : null;
    const opt = (v, l) => '<option value="' + esc(v) + '"' + (v === s.tplId ? ' selected' : '') + '>' + esc(l) + '</option>';
    const short = v => v.length > 22 ? v.slice(0, 21) + '…' : v;
    return sheetHead(ic('mail') + ' Relance — ' + esc(c.name), 'Éléments attendus le ' + fDM(p.expected_date) + ' · documents du mois de ' + relanceMonth())
      + '<div class="sheet-b">'
      + '<div class="rl-bar"><label class="f" style="flex:1;min-width:220px"><span>Modèle</span><select data-ch="rl-tpl">'
      + (ctOk || dts.length ? '<optgroup label="Ce dossier uniquement">' + (ctOk ? opt('client', '📌 Texte mémorisé pour ce client') : '') + dts.map(t => opt(t.id, '📁 ' + tplLabel(t))).join('') + '</optgroup>' : '')
      + '<optgroup label="Modèles JB Flow">' + opt('', 'Relance standard') + RELANCE_LIB.map(x => opt('lib:' + x.k, x.name)).join('') + '</optgroup>'
      + (tpls.length ? '<optgroup label="Mes modèles (tous mes dossiers)">' + tpls.map(t => opt(t.id, t.name)).join('') + '</optgroup>' : '') + '</select></label>'
      + '<label class="switch" title="Adapter le texte au tutoiement"><input type="checkbox" data-ch="rl-tone"' + (s.tone === 'tu' ? ' checked' : '') + '><span class="sw"></span><span>Tutoyer le client</span></label></div>'
      + (ct && !ctOk ? '<div class="notice warn small">Le texte mémorisé pour ce client n\'est pas lisible sur cet appareil (phrase secrète changée). Il sera remplacé à la prochaine copie.</div>' : '')
      + '<textarea class="rl-text" data-ch="rl-text" data-in="rl-text" spellcheck="true" aria-label="Texte de la relance">' + esc(s.texts[s.tone]) + '</textarea>'
      + (s.tplId === 'client'
        ? '<div class="rl-mem small"><span>📌 Texte adapté pour <b>' + esc(c.name) + '</b>, mémorisé lors de ta dernière copie. Le mois et la date limite se mettent à jour tout seuls.</span><button class="btn sm" data-act="rl-forget">Revenir au modèle standard</button></div>'
        : isDossierTpl(cur) ? '<div class="rl-mem small"><span>📁 Modèle « ' + esc(tplLabel(cur)) + ' », réservé à <b>' + esc(c.name) + '</b> : il n\'apparaît sur aucun autre dossier. Le mois et la date limite se mettent à jour tout seuls.</span></div>'
        : '<p class="small muted" style="margin:-6px 0 0">Adapte le texte si besoin : <b>il sera mémorisé pour ce client</b> dès que tu le copies, et proposé à la prochaine relance. ' + (s.tone === 'tu' ? 'Version tutoiement.' : 'Version vouvoiement.') + ' Le mois et la date limite sont insérés automatiquement.</p>')
      // V26.167 : enregistrer un modèle pour ce dossier uniquement, ou pour tous ses dossiers
      + (s.saving ? '<div class="rl-save"><label class="f" style="flex:1;min-width:200px"><span>Nom du modèle</span><input type="text" data-ch="rl-name" data-in="rl-name" value="' + esc(s.saveName || '') + '" placeholder="' + (s.saveScope === 'all' ? 'ex. Relance courte' : 'ex. Relance relevés Qonto') + '"></label>'
        + '<div class="f"><span>Disponible</span><div class="seg rl-scope"><button type="button" class="' + (s.saveScope === 'all' ? '' : 'on') + '" data-act="rl-scope" data-v="dossier">Pour ce dossier uniquement</button><button type="button" class="' + (s.saveScope === 'all' ? 'on' : '') + '" data-act="rl-scope" data-v="all">Pour tous mes dossiers</button></div></div>'
        + '<div class="rl-save-b"><button class="btn primary" data-act="rl-save-ok">' + ic('check', 'sm') + 'Enregistrer</button><button class="btn" data-act="rl-save-cancel">Annuler</button></div></div>' : '')
      // V26.167 : bas de fenêtre lisible — gestion des modèles à gauche, actions à droite (retour à la ligne si la place manque)
      + '</div><div class="sheet-f rl-foot"><div class="rl-grp">'
      + (s.saving ? '' : '<button class="btn" data-act="rl-save" title="Enregistrer ce texte comme modèle : pour ce dossier uniquement, ou pour tous tes dossiers">' + ic('plus', 'sm') + 'Enregistrer comme modèle</button>')
      + (cur ? '<button class="btn" data-act="rl-update" title="Remplacer le texte du modèle « ' + esc(tplLabel(cur)) + ' » par ce texte">Mettre à jour « ' + esc(short(tplLabel(cur))) + ' »</button><button class="btn danger" data-act="rl-del" title="Supprimer le modèle « ' + esc(tplLabel(cur)) + ' »">Supprimer</button>' : '') + '</div>'
      + '<div class="rl-grp rl-acts"><button class="btn primary" data-act="rl-copy">' + ic('list', 'sm') + 'Copier le texte</button>'
      + (S.readonly ? '' : (() => { const r = lastRelance(p), done = r && r.via === 'mail' && r.date === today(); return '<button class="btn rl-sent' + (done ? ' on' : '') + '" data-act="rl-sent" data-id="' + p.id + '" title="' + (done ? 'Cliquer pour annuler' : 'Note la relance par e-mail dans le suivi du dossier') + '">' + ic(done ? 'check' : 'mail', 'sm') + (done ? 'Mail envoyé ✓' : 'Mail envoyé') + '</button>'; })()) + '</div></div>';
  }
  /* Le texte enregistré garde le mois et la date limite sous la forme {mois} / {echeance}, remplacés à chaque relance. */
  const toTemplate = (txt, p) => { let out = String(txt || ''); const d = relanceDue(p); if (d) out = out.split(d).join('{echeance}'); return out.split(relanceMonth()).join('{mois}'); };
  /* V26.32 : chaque relance est mémorisée (historique) pour apprendre son effet sur la date de réception */
  function logRelance(p, via) {
    via = via || 'mail';
    const td = today(), k = p.id + '|' + td + '|' + via; if (S.relLogged && S.relLogged.has(k)) return false; (S.relLogged = S.relLogged || new Set()).add(k);
    const by = meName();
    hist('relance', { entity: 'production', entity_id: p.id, client_id: p.client_id, detail: { date: td, month: p.month, via, by, text: (via === 'telephone' ? 'relance par téléphone ' : 'relance ') + deMonth(p.month) } });
    (S.relances = S.relances || []).push({ client_id: p.client_id, month: p.month, date: td, via, by });
    return true;
  }
  /* V26.94 : dernière relance d'un dossier (e-mail ou téléphone) */
  function lastRelance(p) {
    if (!p) return null;
    return (S.relances || []).filter(r => r.client_id === p.client_id && r.month === p.month).sort((a, b) => (a.date || '').localeCompare(b.date || '')).pop() || null;
  }
  const relLabel = r => r ? (r.via === 'telephone' ? 'relancé par téléphone' : 'relancé par e-mail') + ' le ' + fDM(r.date) + (r.by ? ' par ' + r.by.split(' ')[0] : '') : '';
  function relanceTel(pid) {
    const p = S.data.productions.get(pid); if (!p || S.readonly) return;
    const c = clientOf(p.client_id) || {}, r = lastRelance(p);
    // V26.95 : un second clic le jour même annule la relance téléphonique (mauvaise manipulation)
    if (r && r.via === 'telephone' && r.date === today()) return cancelRelanceTel(pid);
    if (logRelance(p, 'telephone')) toast('Relance téléphonique notée pour ' + c.name + '.', 'ok', { label: 'Annuler', fn: () => cancelRelanceTel(pid) }, 6000);
    render(); if (S.sheet) renderSheet();
  }
  // V26.150 : bouton « Mail envoyé » de la fenêtre de relance — même principe que « Relancé par tél. » (second clic le jour même = annuler)
  function relanceMail(pid) {
    const p = S.data.productions.get(pid); if (!p || S.readonly) return;
    const c = clientOf(p.client_id) || {}, r = lastRelance(p);
    if (r && r.via === 'mail' && r.date === today()) return cancelRelanceTel(pid, 'mail');
    if (logRelance(p, 'mail')) toast('Relance par e-mail notée pour ' + c.name + '.', 'ok', { label: 'Annuler', fn: () => cancelRelanceTel(pid, 'mail') }, 6000);
    render(); if (S.sheet) renderSheet();
  }
  function cancelRelanceTel(pid, via) {
    via = via || 'telephone';
    const p = S.data.productions.get(pid); if (!p) return;
    const c = clientOf(p.client_id) || {}, td = today();
    const idx = (S.relances || []).map((r, i) => [r, i]).filter(x => x[0].client_id === p.client_id && x[0].month === p.month && x[0].via === via && x[0].date === td).map(x => x[1]).pop();
    if (idx === undefined) return;
    S.relances.splice(idx, 1);
    if (S.relLogged) S.relLogged.delete(p.id + '|' + td + '|' + via);
    // L'historique ne s'efface jamais : on y inscrit l'annulation, relue au chargement
    hist('relance_annulee', { entity: 'production', entity_id: p.id, client_id: p.client_id, detail: { date: td, month: p.month, via, by: meName() || '', text: (via === 'telephone' ? 'relance par téléphone' : 'relance par e-mail') + ' annulée ' + deMonth(p.month) } });
    toast((via === 'telephone' ? 'Relance téléphonique' : 'Relance par e-mail') + ' annulée pour ' + c.name + '.', '', null, 3000);
    render(); if (S.sheet) renderSheet();
  }
  async function loadRelances() {
    if (S.relancesLoaded || !S.store.loadHistory) return; S.relancesLoaded = true;
    try { const h = await S.store.loadHistory({ limit: 1000, action: 'relance' }); const seen = new Set((S.relances || []).map(r => r.client_id + r.month + r.date));
      h.filter(x => x.action === 'relance' && x.client_id).forEach(x => { const d = x.detail || {}, r = { client_id: x.client_id, month: d.month || atDay(x.at).slice(0, 7), date: d.date || atDay(x.at), via: d.via || 'mail', by: d.by || (x.user_email || '').split('@')[0] }; if (!seen.has(r.client_id + r.month + r.date)) (S.relances = S.relances || []).push(r); });
      try { const ca = await S.store.loadHistory({ limit: 1000, action: 'relance_annulee' }); ca.filter(x => x.action === 'relance_annulee' && x.client_id).forEach(x => { const d = x.detail || {}; const k = (S.relances || []).map((r, i) => [r, i]).filter(y => y[0].client_id === x.client_id && y[0].month === d.month && y[0].date === d.date && y[0].via === (d.via || 'telephone')).map(y => y[1]).pop(); if (k !== undefined) S.relances.splice(k, 1); }); } catch (e) { /* pas d'annulation connue */ }
      S.agentKey = null; scheduleRender(); } catch (e) { /* sans historique : effet des relances inconnu */ }
  }
  async function copyRelance() {
    const s = S.sheet; if (!s || !s.texts) return;
    const txt = s.texts[s.tone];
    const p = S.data.productions.get(s.pid); if (p) lsSet('planif-tone-' + p.client_id, s.tone); // V26.150 : la relance est notée avec le bouton « Mail envoyé » (plus à la copie)
    let ok = false;
    try { await navigator.clipboard.writeText(txt); ok = true; toast('Texte copié : collez-le dans votre e-mail.', 'ok', null, 3000); }
    catch (e) {
      const ta = $('.rl-text'); if (ta) { ta.focus(); ta.select(); try { document.execCommand('copy'); ok = true; toast('Texte copié : collez-le dans votre e-mail.', 'ok', null, 3000); } catch (er) { /* sélection manuelle */ } }
      if (!ok) toast('Copie automatique impossible : le texte est sélectionné, faites Ctrl+C.', 'warn');
    }
    rememberClientText(s); // V26.165 : le texte adapté est mémorisé pour ce client
  }
  /* V26.165 : mémorise le texte adapté pour ce client (un par client et par utilisateur, chiffré si le chiffrement est actif).
     Rien n'est retenu si le texte n'a pas été modifié. */
  async function rememberClientText(s) {
    if (!s || !s.texts || S.readonly) return false;
    const p = S.data.productions.get(s.pid); if (!p) return false;
    const c = clientOf(p.client_id) || {}, k = s.tone === 'tu' ? 'body_tu' : 'body_vous';
    const txt = toTemplate(s.texts[s.tone], p), ct = clientTplOf(p.client_id);
    if (ct) { if (plainOf(ct[k]) === txt) return false; }
    else if (txt.trim() === toTemplate(relanceTexts(s.tplId, p)[s.tone], p).trim()) return false;
    const body = await encStr(txt);
    if (ct) { if ((await saveUpdate('message_templates', ct.id, { [k]: body }, { quiet: true })) !== 'ok') return false; }
    // V26.167 : texte vide (et non null) pour l'autre version — la base refuse les valeurs nulles dans ces colonnes
    else { try { await saveInsert('message_templates', [{ id: P.uuid(), owner_email: tplOwner(), name: CLIENT_TPL + p.client_id, body_vous: k === 'body_vous' ? body : '', body_tu: k === 'body_tu' ? body : '' }]); } catch (e) { return false; } }
    if (S.sheet === s) { s.tplId = 'client'; if (!typing()) renderSheet(); }
    toast('Texte mémorisé pour ' + c.name + ' : il sera proposé à la prochaine relance.', 'ok', null, 3500);
    return true;
  }
  /* Avant d'ouvrir la fenêtre : déchiffre le texte mémorisé pour ce client et ses modèles de dossier (noms et textes) */
  async function prepRelance(pid) {
    const p = S.data.productions.get(pid); if (!p) return;
    const ct = clientTplOf(p.client_id), vals = ct ? [ct.body_vous, ct.body_tu] : [];
    dossierTpls(p.client_id).forEach(t => vals.push(t.name.slice(t.name.indexOf('|') + 1), t.body_vous, t.body_tu));
    try { await Promise.all(vals.map(v => decStr(v))); } catch (e) { /* illisible : modèle standard */ }
  }
  async function forgetClientText() {
    const s = S.sheet; if (!s) return;
    const p = S.data.productions.get(s.pid), ct = p && clientTplOf(p.client_id); if (!ct) return;
    if (!await confirmBox('Revenir au modèle standard ?', '<p>Le texte mémorisé pour <b>' + esc((clientOf(p.client_id) || {}).name || '') + '</b> sera oublié.</p>', 'Oublier ce texte', true)) return;
    if (await saveRemove('message_templates', ct.id)) { s.tplId = ''; s.texts = relanceTexts('', p); renderSheet(); toast('Texte mémorisé oublié : modèle standard.', 'ok', null, 2500); }
  }
  async function saveRelanceTemplate(update) {
    const s = S.sheet; if (!s) return;
    const p = S.data.productions.get(s.pid); if (!p) return;
    const bv = toTemplate(s.texts.vous, p), bt = toTemplate(s.texts.tu, p);
    if (update) {
      const t = S.data.message_templates.get(s.tplId); if (!t) return;
      const enc = isDossierTpl(t); // un modèle de dossier reste chiffré
      if ((await saveUpdate('message_templates', t.id, { body_vous: enc ? await encStr(bv) : bv, body_tu: enc ? await encStr(bt) : bt })) === 'ok') toast('Modèle « ' + tplLabel(t) + ' » mis à jour.', 'ok', null, 2500);
      return;
    }
    const name = String(s.saveName || '').trim();
    if (!name) { toast('Donnez un nom au modèle.', 'warn'); return; }
    // V26.167 : « pour ce dossier uniquement » (par défaut) — nom et textes chiffrés comme le texte mémorisé du client
    const forDossier = s.saveScope !== 'all', cl = clientOf(p.client_id) || {};
    try {
      const row = forDossier
        ? { id: P.uuid(), owner_email: tplOwner(), name: DOSSIER_TPL + p.client_id + '|' + await encStr(name), body_vous: await encStr(bv), body_tu: await encStr(bt) }
        : { id: P.uuid(), owner_email: tplOwner(), name, body_vous: bv, body_tu: bt };
      const [t] = await saveInsert('message_templates', [row]);
      s.tplId = t.id; s.saving = false; s.saveName = '';
      lsSet(forDossier ? 'planif-relance-tpl:' + p.client_id : 'planif-relance-tpl', t.id);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      toast(forDossier ? 'Modèle « ' + name + ' » enregistré pour ' + (cl.name || 'ce dossier') + ' uniquement : il n\'apparaît sur aucun autre dossier.' : 'Modèle « ' + name + ' » enregistré pour tous vos dossiers. Il n\'est visible que par vous.', 'ok', null, 4000);
      renderSheet();
    } catch (e) { /* message déjà affiché */ }
  }

  /* ---------- Clôture d'une tâche : temps réel passé (+ demande d'informations si non renseignée) ---------- */
  function finishDialog(t) {
    const p = S.data.productions.get(t.production_id), c = clientOf(t.client_id) || {};
    const needIr = t.kind !== 'info' && p && !p.info_request;
    const planned = Number(t.duration_min) || 0;
    // Tableau de bord du même client encore à faire : peut être fait en même temps que la production
    const dash = !['info', 'dashboard'].includes(t.kind) ? list('tasks').filter(x => x.kind === 'dashboard' && x.client_id === t.client_id && !x.done && x.month >= t.month).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))[0] : null;
    const dashLbl = dash ? (dash.period ? 'de ' + fMonth(dash.period) : '') + ' (à publier avant le ' + fDM(dash.due_date) + ')' : '';
    return new Promise(resolve => {
      let ir = null;
      const root = document.createElement('div');
      root.className = 'overlay anim center';
      root.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" style="width:min(480px,100%)"><div class="sheet-h"><div style="margin-right:auto"><h2>Terminer — ' + esc(c.name) + '</h2><div class="small muted" style="margin-top:4px">' + E.KIND_LABEL[t.kind] + ' · temps prévu ' + E.fmtMin(planned) + '</div></div></div>'
        + '<div class="sheet-b">' + (c.sous_traitance ? '<div role="note" style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);background:color-mix(in srgb,var(--accent) 12%,transparent)">' + ic('alert', 'sm') + '<div><b>Rappel — Sous-traitance en place</b><div class="small">La tenue comptable n\'est pas effectuée par le cabinet : <b>uniquement la TVA à faire</b>. Indique le temps passé sur la TVA seulement.</div></div></div>' : '') + '<label class="f"><span>Temps réellement passé</span><div class="time-in"><button type="button" class="btn icon" data-d="-15" aria-label="Moins 15 minutes">−</button><input type="text" id="fd-time" value="' + E.fmtMin(planned) + '" inputmode="text" autocomplete="off"><button type="button" class="btn icon" data-d="15" aria-label="Plus 15 minutes">+</button></div></label>'
        + '<p class="small muted" style="margin:-6px 0 0">Formats acceptés : 1h30, 1:30, 90 min. Tes temps me servent à ajuster ton planning et harmoniser ton niveau d\'activité.</p>'
        + (needIr ? '<div><div class="small muted" style="margin-bottom:8px"><b style="color:var(--text)">Demande d\'informations au client</b></div><div class="ir">' + IR_OPTS.map(o => '<button type="button" class="' + o[0] + '" data-ir="' + o[0] + '">' + ic(o[2], 'sm') + o[1] + '</button>').join('') + '</div></div>' : '')
        + (dash ? '<label class="cb" style="align-items:flex-start"><input type="checkbox" id="fd-dash"><span><b>Tableau de bord ' + esc(dashLbl) + ' fait en même temps</b><br><span class="small muted">Il sera noté fait et retiré du planning.</span></span></label>' : '')
        + (p ? '<div class="fd-note"><label class="f"><span>Commentaire du mois <em class="small muted">— repris dans le Récap TVA</em></span><textarea id="fd-note" rows="2" maxlength="240" placeholder="Ex. : manque le détail des encaissements Airbnb">' + esc(p.tva_note || '') + '</textarea></label></div>' : '')
        + '<div class="notice bad" id="fd-err" style="display:none"></div></div>'
        + '<div class="sheet-f"><button class="btn" data-x="cancel">Annuler</button><button class="btn primary" data-x="ok">' + ic('check', 'sm') + 'Terminer</button></div></div>';
      const inp = root.querySelector('#fd-time'), err = root.querySelector('#fd-err');
      const fail = m => { err.textContent = m; err.style.display = ''; };
      const done = v => { fxClose(root); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const submit = () => {
        const n = E.parseDuration(inp.value);
        if (isNaN(n) || n <= 0) return fail('Temps illisible (ex. 1h30, 45 min).');
        if (needIr && !ir) return fail('Indiquez si une demande d\'informations est faite, à faire ou non nécessaire.');
        const nt = root.querySelector('#fd-note');
        done({ actual: n, ir, dash: dash && root.querySelector('#fd-dash').checked ? dash.id : null, note: nt ? nt.value.trim() : undefined });
      };
      const onKey = e => { if (e.key === 'Enter' && e.target === inp) { e.preventDefault(); submit(); } if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      root.addEventListener('click', e => {
        const d = e.target.closest('[data-d]'), b = e.target.closest('[data-ir]'), x = e.target.closest('[data-x]');
        if (d) { const n = E.parseDuration(inp.value); inp.value = E.fmtMin(Math.max(5, (isNaN(n) ? planned : n) + Number(d.dataset.d))); }
        else if (b) { ir = b.dataset.ir; root.querySelectorAll('[data-ir]').forEach(el => el.classList.toggle('on', el === b)); err.style.display = 'none'; }
        else if (x) x.dataset.x === 'ok' ? submit() : done(null);
        else if (e.target === root) done(null);
      });
      document.body.appendChild(root);
      setTimeout(() => { inp.focus(); inp.select(); }, 60);
    });
  }

  /* ---------- Suivi des dépôts (TVA, DEB, DES) ---------- */
  const prodDone = p => { const ts = list('tasks').filter(t => t.production_id === p.id && t.kind !== 'info'); return ts.length > 0 && ts.every(t => t.done); };
  function filingBox(p) {
    if (!p) return '';
    const c = clientOf(p.client_id); if (!c) return '';
    const ob = E.obligations(c, p.month, cfg()); if (!ob.length) return '';
    const done = prodDone(p), f = p.filing || {};
    return '<div class="ir-box"><div class="t">' + ic('check', 'sm') + 'Suivi des dépôts' + (done ? '' : '<span class="badge" style="margin-left:auto">après la production</span>') + '</div>'
      + ob.map(o => {
        const st = f[o.code];
        return '<div class="fil-row"><div class="fil-l"><b>' + o.label + '</b><span>échéance ' + fDM(o.due) + '</span></div>'
          + (st ? '<span class="badge g">' + ic('check') + E.FILING_VIA[st.via] + ' · ' + fDM(atDay(st.at)) + (st.by ? ' · ' + esc(st.by) : '') + '</span><button class="btn sm" data-act="file" data-pid="' + p.id + '" data-code="' + o.code + '" data-via="" title="Annuler le dépôt">Annuler</button>'
            : '<div class="ir">' + Object.keys(E.FILING_VIA).map(v => '<button data-act="file" data-pid="' + p.id + '" data-code="' + o.code + '" data-via="' + v + '"' + (done && !S.readonly ? '' : ' disabled') + '>' + (v === 'jedeclare' ? 'jedeclare.com' : 'impots.gouv') + '</button>').join('') + '</div>')
          + '</div>';
      }).join('')
      + (done ? '' : '<span class="small muted">Le dépôt se renseigne une fois la production terminée.</span>') + '</div>';
  }
  async function setFiling(pid, code, via) {
    const p = S.data.productions.get(pid); if (!p) return;
    if (via && !prodDone(p)) { toast('Terminez d\'abord la production de ce dossier.', 'warn'); return; }
    const filing = Object.assign({}, p.filing || {});
    if (via) filing[code] = { via, at: new Date().toISOString(), by: meName() }; else delete filing[code];
    const r = await saveUpdate('productions', pid, { filing }, { history: { action: 'depot', entity: 'production', entity_id: pid, client_id: p.client_id, detail: { text: E.OBLIG_LABEL[code] + ' : ' + (via ? E.FILING_VIA[via] : 'dépôt annulé') } } });
    if (r === 'ok') toast(E.OBLIG_LABEL[code] + (via ? ' — ' + E.FILING_VIA[via].toLowerCase() + '.' : ' — dépôt annulé.'), 'ok', null, 2500);
  }
  /* Tableau de bord : dépôts du mois */
  function filingRows(m) {
    const rows = [];
    list('productions').filter(p => p.month === m).forEach(p => {
      const c = clientOf(p.client_id); if (!c || !canSeeCollab(c.collaborator_id)) return;
      E.obligations(c, m, cfg()).forEach(o => rows.push({ p, c, o, filed: !!(p.filing && p.filing[o.code]), ready: prodDone(p) }));
    });
    return rows;
  }
  const FIL_K = { done: ['Déposés', r => r.filed], todo: ['À déposer', r => !r.filed && r.ready], prod: ['En production', r => !r.filed && !r.ready], late: ['Échéance dépassée', r => !r.filed && r.o.due < today()] };
  /* V26.37 : détail d'une carte Dépôts (carte centrée) */
  function sheetFilDetail(s) {
    const K = FIL_K[s.k] || FIL_K.todo, sel = filingRows(s.m).filter(K[1]).sort((a, b) => a.o.due.localeCompare(b.o.due) || a.c.name.localeCompare(b.c.name, 'fr')), td = today();
    const btns = r => r.filed ? '<span class="badge g">' + ic('check') + E.FILING_VIA[r.p.filing[r.o.code].via] + ' · ' + fDM(atDay(r.p.filing[r.o.code].at)) + '</span>' : r.ready ? '<div class="ir">' + Object.keys(E.FILING_VIA).map(v => '<button data-act="file" data-pid="' + r.p.id + '" data-code="' + r.o.code + '" data-via="' + v + '"' + (S.readonly ? ' disabled' : '') + '>' + (v === 'jedeclare' ? 'jedeclare.com' : 'impots.gouv') + '</button>').join('') + '</div>' : '<span class="badge">Production en cours</span>';
    const body = sel.length ? '<div class="scroll-x"><table class="t"><thead><tr><th>Dossier</th><th>Déclaration</th><th>Collaborateur</th><th>Échéance</th><th>État</th></tr></thead><tbody>' + sel.map(r => { const t0 = list('tasks').find(t => t.production_id === r.p.id && t.kind !== 'info'), j = E.daysBetween(td, r.o.due); return '<tr' + (t0 ? ' data-act="task" data-id="' + t0.id + '"' : '') + '><td><b>' + esc(r.c.name) + '</b></td><td>' + r.o.label + '</td><td>' + esc((collabOf(r.c.collaborator_id) || {}).name || '—') + '</td><td class="nowrap">' + fDM(r.o.due) + (!r.filed && j < 0 ? ' <span class="badge r">dépassée</span>' : '') + '</td><td>' + btns(r) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">Aucun dossier.</div>';
    return sheetHead(K[0] + ' — ' + fMonth(s.m), sel.length + ' déclaration(s) · cliquez sur un dossier pour ouvrir la tâche') + '<div class="sheet-b">' + body + '</div><div class="sheet-f"><button class="btn" data-act="close">Fermer</button></div>';
  }
  /* V26.39 : acomptes d'impôt sur les sociétés — calendrier selon la date de clôture, montants enregistrés (chiffrés comme le nom) */
  // V26.44 : règles de calcul déplacées dans fiscal.js (module testé)
  const { fmtEur, isSched, isSolde, isCalc } = window.JBFiscal;
  const fDMY2 = d => Number(d.slice(8)) + ' ' + MONTHS[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4);
  const isClosing = (c, y) => { const md = c.is_cloture || '12-31'; return y + '-' + (md === '02-29' ? '02-28' : md); };
  /* Exercice en cours : le premier dont le 4e acompte n'est pas encore passé */
  function isCurrentClose(c) { const y = Number(today().slice(0, 4)); for (let k = y - 1; k <= y + 2; k++) { const cl = isClosing(c, k); if (isSched(cl)[3] >= today()) return cl; } return isClosing(c, y + 1); }
  const isDataOf = c => { try { return JSON.parse(c.is_data || '{}') || {}; } catch (e) { return {}; } };
  function isLoad(cid, close) {
    const c = clientOf(cid), saved = c ? isDataOf(c)[close] : null;
    S.isCalc = { client: cid, close, v: saved ? Object.assign({ man: {} }, JSON.parse(JSON.stringify(saved))) : { first: false, is1: '', is2: '', m1: 12, m2: 12, man: {} } };
  }
  /* V26.133 : acomptes IS — liste pleine largeur, calcul dans une carte centrée, suivi du paiement de chaque acompte */
  const isPaidOf = (c, cl) => ((isDataOf(c)[cl] || {}).paid) || {};
  function isAmountOf(sv, k) { if (!sv) return null; const r = isCalc(sv); if (!r.rows) return r.theo === 0 ? 0 : null; const m = sv.man && sv.man[k + 1]; return m !== undefined && m !== '' && m !== null ? Number(m) : r.rows[k][0]; }
  function isPayCell(c, cl, k, amt) {
    if (amt === null) return '<span class="small muted">à calculer</span>';
    if (!(amt > 0)) return '<span class="small muted">aucun</span>';
    const p = isPaidOf(c, cl)[k + 1];
    if (p) return '<span class="badge g">Payé le ' + fDM(p) + '</span>' + (S.readonly ? '' : ' <button class="btn sm" data-act="is-paid" data-id="' + c.id + '" data-cl="' + cl + '" data-n="' + (k + 1) + '" data-v="0" title="Annuler">↺</button>');
    return S.readonly ? '<span class="badge o">À payer</span>' : '<button class="btn sm is-pay" data-act="is-paid" data-id="' + c.id + '" data-cl="' + cl + '" data-n="' + (k + 1) + '" data-v="1">À payer</button>';
  }
  async function isSetPaid(el) {
    const c = clientOf(el.dataset.id); if (!c) return;
    const cl = el.dataset.cl, n = el.dataset.n, data = isDataOf(c);
    if (!data[cl]) { toast('Enregistrez d\'abord le calcul de cet exercice.', 'warn'); return; }
    const paid = Object.assign({}, data[cl].paid || {}); if (el.dataset.v === '1') paid[n] = today(); else delete paid[n];
    data[cl] = Object.assign({}, data[cl], { paid });
    await saveUpdate('clients', c.id, { is_data: JSON.stringify(data) }, { quiet: true, history: { action: 'dossier', entity: 'client', entity_id: c.id, client_id: c.id, detail: { text: 'Acompte IS n°' + n + ' (exercice clos le ' + fDMY(cl) + ') ' + (el.dataset.v === '1' ? 'payé' : 'paiement annulé') } } });
  }
  // V26.134 : même pagination que « À déposer »
  function isPage(a) { const n = Math.max(1, Math.ceil(a.length / FIL_PER)); S.isPage = Math.min(Math.max(1, S.isPage || 1), n); return a.slice((S.isPage - 1) * FIL_PER, S.isPage * FIL_PER); }
  function isPager(len) {
    if (len <= FIL_PER) return '';
    const n = Math.ceil(len / FIL_PER), p = Math.min(S.isPage || 1, n), from = (p - 1) * FIL_PER + 1, to = Math.min(len, p * FIL_PER);
    return '<div class="fil-pager bottom"><span class="small muted">' + from + '–' + to + ' sur ' + len + '</span><span class="spacer"></span><button class="btn sm" data-act="is-page" data-d="-1"' + (p <= 1 ? ' disabled' : '') + '>' + ic('chevL', 'sm') + 'Précédent</button><span class="small"><b>' + p + '</b> / ' + n + '</span><button class="btn sm primary" data-act="is-page" data-d="1"' + (p >= n ? ' disabled' : '') + '>Suivant' + ic('chevR', 'sm') + '</button></div>';
  }
  function isSection() {
    const td = today();
    const cls = list('clients').filter(c => c.active !== false && c.is_acompte && canSeeCollab(c.collaborator_id)).sort(byName);
    const rowOf = c => {
      const cl = isCurrentClose(c), sc = isSched(cl), k = Math.max(0, sc.findIndex(d => d >= td)), nx = sc[k], j = E.daysBetween(td, nx), sv = isDataOf(c)[cl], amt = isAmountOf(sv, k);
      return '<tr class="is-r" data-act="is-calc" data-id="' + c.id + '"><td><b>' + esc(c.name) + '</b><div class="small muted">' + esc((collabOf(c.collaborator_id) || {}).name || '') + '</div></td>'
        + '<td class="nowrap">' + fDM(cl) + (c.is_cloture ? '' : ' <span class="small muted">(défaut)</span>') + '</td>'
        + '<td class="nowrap">n°' + (k + 1) + ' le <b>' + fDM(nx) + '</b>' + (j <= 7 && j >= 0 ? ' <span class="badge o">J-' + j + '</span>' : '') + '</td>'
        + '<td class="num">' + (amt === null ? '—' : fmtEur(amt)) + '</td>'
        + '<td class="nowrap is-paycell">' + isPayCell(c, cl, k, amt) + '</td>'
        + '<td style="text-align:right"><button class="btn sm" data-act="is-calc" data-id="' + c.id + '">' + (sv ? 'Voir le calcul' : 'Calculer') + '</button></td></tr>';
    };
    const body = cls.length ? '<div class="scroll-x"><table class="t is-tbl"><thead><tr><th>Dossier</th><th>Clôture</th><th>Prochain acompte</th><th class="num">Montant</th><th>Paiement</th><th></th></tr></thead><tbody>' + isPage(cls).map(rowOf).join('') + '</tbody></table></div>' + isPager(cls.length)
      : '<div class="empty">Aucun dossier avec acomptes d\'IS. Cochez « Acomptes IS » et indiquez la date de clôture dans la fiche du dossier.</div>';
    return '<div class="section-t" style="margin-top:var(--gap)"><h2>Suivi Acompte IS</h2><span class="muted small">calendrier selon la date de clôture · cliquez sur un dossier pour ouvrir son calcul</span></div>'
      + '<div class="frame tva-frame"><div class="frame-h">' + ic('list') + '<h2>Dossiers concernés</h2>' + (cls.length ? '<span class="badge">' + cls.length + '</span>' : '') + '</div><div class="inner">' + body + '</div></div>';
  }
  function sheetIsCalc(s) {
    const st = S.isCalc, c = st && clientOf(st.client);
    return sheetHead('Calcul des acomptes IS' + (c ? ' — ' + esc(c.name) : ''), 'les montants retenus alimentent le Récap Acompte IS')
      + '<div class="sheet-b" id="is-calc">' + isCalcHtml() + '</div><div class="sheet-f"><span class="spacer"></span><button class="btn" data-act="close">Fermer</button></div>';
  }  function isCalcHtml() {
    const st = S.isCalc, c = st && clientOf(st.client);
    if (!c) return '<div class="empty">Cliquez sur « Calculer » à côté d\'un dossier.</div>';
    const v = st.v, r = isCalc(v), sc = isSched(st.close), saved = isDataOf(c)[st.close], ro = S.readonly ? ' disabled' : '', n1 = Number(st.close.slice(0, 4));
    const inp = (k, l, extra) => '<label class="f"><span>' + l + '</span><input type="number" min="0" step="1" data-ch="is-in" data-k="' + k + '" value="' + esc(v[k] === undefined ? '' : v[k]) + '"' + ro + (extra || '') + '></label>';
    let html = '<div class="row" style="margin-bottom:8px"><b>' + esc(c.name) + '</b><span class="spacer"></span><button class="btn icon sm" data-act="is-ex" data-d="-1" aria-label="Exercice précédent">' + ic('chevL', 'sm') + '</button><span class="small">Exercice clos le <b>' + fDMY2(st.close) + '</b></span><button class="btn icon sm" data-act="is-ex" data-d="1" aria-label="Exercice suivant">' + ic('chevR', 'sm') + '</button></div>'
      + (saved ? '<div class="notice ok small">Enregistré le ' + fDateTime(saved.at) + (saved.by ? ' par ' + esc(saved.by) : '') + '.</div>' : '<div class="notice small">Pas encore enregistré pour cet exercice.</div>')
      + '<label class="cb" style="margin:8px 0 10px"><input type="checkbox" data-ch="is-in" data-k="first"' + (v.first ? ' checked' : '') + ro + '> Premier exercice</label>'
      + (v.first ? '' : '<div class="form">' + inp('is2', 'IS exercice N-2 (clos en ' + (n1 - 2) + ') €') + inp('m2', 'Durée N-2 (mois)', ' max="24"') + inp('is1', 'IS exercice N-1 (clos en ' + (n1 - 1) + ') €') + inp('m1', 'Durée N-1 (mois)', ' max="24"') + '</div>');
    if (r.none) html += '<div class="notice info">' + r.none + '</div>';
    else {
      let sum = 0;
      html += '<div class="scroll-x"><table class="t"><thead><tr><th>Acompte</th><th>Échéance</th><th class="num">Calculé</th><th>Détail du calcul</th><th class="num">Montant retenu</th></tr></thead><tbody>'
        + r.rows.map((x, i) => { const m = v.man && v.man[i + 1], useM = m !== undefined && m !== '' && m !== null, val = useM ? Number(m) : x[0]; sum += val; return '<tr><td>n°' + (i + 1) + '</td><td class="nowrap">' + fDMY2(sc[i]) + '</td><td class="num">' + fmtEur(x[0]) + '</td><td class="small muted">' + x[1] + '</td><td class="num"><input type="number" min="0" step="1" style="width:110px;text-align:right" data-ch="is-man" data-i="' + (i + 1) + '" placeholder="' + x[0] + '" value="' + (useM ? esc(m) : '') + '"' + ro + '></td></tr>'; }).join('')
        + '<tr><td colspan="2"><b>Total</b></td><td class="num"><b>' + fmtEur(r.rows.reduce((a, x) => a + x[0], 0)) + '</b></td><td class="small muted">IS théorique à verser (IS N-1 sur 12 mois) : ' + fmtEur(r.theo) + '</td><td class="num"><b>' + fmtEur(sum) + '</b></td></tr></tbody></table></div>';
      const diff = Math.round(sum - r.theo);
      if (diff < 0) html += '<div class="notice bad" style="margin-top:8px"><b>Attention :</b> le total des acomptes (' + fmtEur(sum) + ') est <b>inférieur de ' + fmtEur(-diff) + '</b> à l\'IS théorique à verser (' + fmtEur(r.theo) + ').</div>';
      else if (diff > 0) html += '<div class="notice bad" style="margin-top:8px"><b>Attention :</b> le total des acomptes (' + fmtEur(sum) + ') est <b>supérieur de ' + fmtEur(diff) + '</b> à l\'IS théorique à verser (' + fmtEur(r.theo) + ')' + (r.a2neg ? ' : l\'acompte n°1 dépasse la moitié de l\'IS N-1' : '') + '.</div>';
      html += '<p class="small muted" style="margin-top:8px">« Montant retenu » vide = montant calculé. Base : IS au taux normal et réduit, avant crédits d\'impôt, hors contribution sociale ; aucun acompte si l\'IS N-1 est inférieur à 3 000 €.</p>';
    }
    html += '<p class="small muted">Solde de l\'IS : ' + fDMY2(isSolde(st.close)) + '.</p>'
      + (S.readonly ? '' : '<div class="row" style="justify-content:flex-end;gap:8px">' + (saved ? '<button class="btn sm" data-act="is-clear">Effacer</button>' : '') + '<button class="btn primary sm" data-act="is-save">' + ic('check', 'sm') + 'Enregistrer</button></div>');
    return html;
  }
  async function isSave(clear) {
    const st = S.isCalc, c = st && clientOf(st.client); if (!c) return;
    const data = isDataOf(c);
    if (clear) delete data[st.close]; else data[st.close] = Object.assign({}, st.v, { paid: (data[st.close] || {}).paid || st.v.paid || {}, at: new Date().toISOString(), by: meName()});
    const r = await saveUpdate('clients', c.id, { is_data: JSON.stringify(data) }, { history: { action: 'dossier', entity: 'client', entity_id: c.id, client_id: c.id, detail: { text: 'Acomptes IS exercice clos le ' + fDMY(st.close) + (clear ? ' effacés' : ' enregistrés') } } });
    if (r === 'ok') { toast(clear ? 'Calcul effacé.' : 'Acomptes IS enregistrés.', 'ok', null, 2500); if (clear) isLoad(c.id, st.close); render(); }
  }
  /* V26.133 : « À déposer » par pages de 8 */
  const FIL_PER = 8;
  function filPage(a) { const n = Math.max(1, Math.ceil(a.length / FIL_PER)); S.filPage = Math.min(Math.max(1, S.filPage || 1), n); return a.slice((S.filPage - 1) * FIL_PER, S.filPage * FIL_PER); }
  function filPager(len, bottom) {
    if (len <= FIL_PER) return '';
    const n = Math.ceil(len / FIL_PER), p = Math.min(S.filPage || 1, n), from = (p - 1) * FIL_PER + 1, to = Math.min(len, p * FIL_PER);
    return '<div class="fil-pager' + (bottom ? ' bottom' : '') + '"><span class="small muted">' + from + '–' + to + ' sur ' + len + '</span><span class="spacer"></span><button class="btn sm" data-act="fil-page" data-d="-1"' + (p <= 1 ? ' disabled' : '') + '>' + ic('chevL', 'sm') + 'Précédent</button><span class="small"><b>' + p + '</b> / ' + n + '</span><button class="btn sm primary" data-act="fil-page" data-d="1"' + (p >= n ? ' disabled' : '') + '>Suivant' + ic('chevR', 'sm') + '</button></div>';
  }  function filingsSection(m) {
    const td = today(), rows = filingRows(m);
    if (!rows.length) return '';
    const todo = rows.filter(r => !r.filed && r.ready).sort((a, b) => a.o.due.localeCompare(b.o.due));
    const n = { done: rows.filter(r => r.filed).length, todo: todo.length, prod: rows.filter(r => !r.filed && !r.ready).length, late: rows.filter(r => !r.filed && r.o.due < td).length };
    const kp = (i, icon, box, label, val, foot) => '<div class="kpi anim-in kpi-click" style="--i:' + i + '" data-act="fil-detail" data-m="' + m + '" data-k="' + ['done', 'todo', 'prod', 'late'][i] + '" role="button" tabindex="0"><div class="kpi-h"><span class="ibox ' + box + '">' + ic(icon, 'sm') + '</span>' + label + '</div><div class="v" data-count="' + val + '" data-fmt="int" data-key="fil' + label + m + '">' + val + '</div><div class="foot">' + foot + '</div></div>';
    return '<div class="section-t"><h2>Suivi TVA</h2><span class="muted small">TVA, DEB et DES du mois</span></div>'
      + '<div class="carousel desk-grid" style="--n:4" data-keep="kpi-fil">' + kp(0, 'check', 'g', 'Déposés', n.done, 'jedeclare.com ou impots.gouv') + kp(1, 'list', 'o', 'À déposer', n.todo, 'production terminée') + kp(2, 'clock', '', 'En production', n.prod, 'pas encore déposables') + kp(3, 'alert', n.late ? 'r' : 'g', 'Échéance dépassée', n.late, n.late ? '<span class="delta down">à régulariser</span>' : '<span class="delta up">aucune</span>') + '</div><div class="dots" data-dots></div>'
      + '<div class="frame anim-in tva-frame" style="margin-top:var(--gap)"><div class="frame-h">' + ic('list') + '<h2>TVA à déposer</h2>' + (todo.length ? '<span class="badge o">' + todo.length + '</span>' : '') + '</div><div class="inner">'
      + (todo.length ? filPager(todo.length) + '<div class="tasks">' + filPage(todo).map(r => { const j = E.daysBetween(td, r.o.due); return '<div class="info-row"><span class="ibox ' + (j < 0 ? 'r' : j <= cfg().due_soon_days ? 'o' : '') + '">' + ic('clock', 'sm') + '</span><div class="t"><b>' + esc(r.c.name) + ' — ' + r.o.label + '</b><span>échéance ' + fDM(r.o.due) + (j < 0 ? ' · dépassée' : j <= cfg().due_soon_days ? ' · J-' + j : '') + '</span></div><div class="ir">' + Object.keys(E.FILING_VIA).map(v => '<button data-act="file" data-pid="' + r.p.id + '" data-code="' + r.o.code + '" data-via="' + v + '"' + (S.readonly ? ' disabled' : '') + '>' + (v === 'jedeclare' ? 'jedeclare.com' : 'impots.gouv') + '</button>').join('') + '</div></div>'; }).join('') + '</div>'
        : '<div class="empty">Aucun dépôt en attente.</div>') + (todo.length > FIL_PER ? filPager(todo.length, true) : '') + '</div></div>';
  }
  /* Tableau de bord (administrateur) : temps réel face au temps prévu */
  function timeSection(m) {
    if (!isManager()) return '';
    const done = list('tasks').filter(t => t.done && Number(t.actual_min) > 0 && t.kind !== 'info');
    const month = done.filter(t => t.month === m);
    const pct = (a, b) => (b ? Math.round((a - b) / b * 100) : 0);
    const gap = (a, b) => { const g = pct(a, b); return '<span class="delta ' + (Math.abs(g) < 10 ? 'flat' : g > 0 ? 'down' : 'up') + '">' + (g > 0 ? '+' : '') + g + ' %</span>'; };
    const byCollab = collabs(true).map(c => { const ts = month.filter(t => t.collaborator_id === c.id); return { c, n: ts.length, plan: ts.reduce((s, t) => s + (Number(t.duration_min) || 0), 0), real: ts.reduce((s, t) => s + (Number(t.actual_min) || 0), 0) }; }).filter(r => r.n);
    const byClient = new Map();
    done.forEach(t => { const r = byClient.get(t.client_id) || { n: 0, plan: 0, real: 0 }; r.n++; r.plan += Number(t.duration_min) || 0; r.real += Number(t.actual_min) || 0; byClient.set(t.client_id, r); });
    const clientsRows = [...byClient.entries()].map(([id, r]) => ({ c: clientOf(id), ...r })).filter(r => r.c && Math.abs(pct(r.real, r.plan)) >= 15).sort((a, b) => Math.abs(pct(b.real, b.plan)) - Math.abs(pct(a.real, a.plan))).slice(0, 10);
    const tot = month.reduce((a, t) => ({ plan: a.plan + (Number(t.duration_min) || 0), real: a.real + (Number(t.actual_min) || 0) }), { plan: 0, real: 0 });
    return '<div class="section-t"><h2>Temps réel</h2><span class="badge k">' + ic('lock') + 'Administrateur</span></div>'
      + (month.length ? '<div class="split"><div class="card anim-in"><div class="card-h"><h2>Par collaborateur · ' + esc(fMonth(m)) + '</h2><span class="small muted">' + month.length + ' tâche(s) · ' + E.fmtMin(tot.real) + ' réel / ' + E.fmtMin(tot.plan) + ' prévu ' + gap(tot.real, tot.plan) + '</span></div>'
        + '<table class="t stack"><thead><tr><th>Collaborateur</th><th class="num">Tâches</th><th class="num">Prévu</th><th class="num">Réel</th><th class="num">Écart</th></tr></thead><tbody>' + byCollab.map(r => '<tr><td class="first">' + esc(r.c.name) + '</td><td class="num" data-l="Tâches">' + r.n + '</td><td class="num" data-l="Prévu">' + E.fmtMin(r.plan) + '</td><td class="num" data-l="Réel"><b>' + E.fmtMin(r.real) + '</b></td><td class="num" data-l="Écart">' + gap(r.real, r.plan) + '</td></tr>').join('') + '</tbody></table></div>'
        : '<div class="split"><div class="card anim-in"><div class="empty">Aucune tâche terminée avec un temps réel ce mois-ci.</div></div>')
      + '<div class="frame anim-in"><div class="frame-h">' + ic('gauge') + '<h2>' + (agentOn() ? 'Temps à valider (agent)' : 'Temps à ajuster') + '</h2></div><div class="inner">'
      + (agentOn() ? agentTimeList() : clientsRows.length ? '<div class="tasks">' + clientsRows.map(r => { const avg = Math.round(r.real / r.n / 5) * 5; return '<div class="info-row"><div class="t"><b>' + esc(r.c.name) + '</b><span>réel moyen ' + E.fmtMin(avg) + ' · prévu ' + E.fmtMin(E.clientTime(r.c)) + ' · ' + r.n + ' mois</span></div>' + gap(r.real, r.plan) + '<button class="btn sm" data-act="adjust-time" data-id="' + r.c.id + '" data-v="' + avg + '">Ajuster à ' + E.fmtMin(avg) + '</button></div>'; }).join('') + '</div>'
        : '<div class="empty">Aucun écart significatif (± 15 %) entre temps prévu et temps réel.</div>')
      + '</div></div></div>';
  }
  /* Mention discrète en bas de page */
  function legalHtml() {
    return '<footer class="legal" role="contentinfo">Outil pensé et développé par Jason BAHI, Expert-comptable inscrit à l’Ordre des Experts-Comptables. 2026 © JB FLOW – Version ' + esc(String(CFG.APP_VERSION || '').replace(/^V/i, '')) + '</footer>';
  }

