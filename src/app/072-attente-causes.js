  /* ==========================================================================
   * V26.206 — Fiabilité du planning
   *  · « En attente du client » : un dossier bloqué sort du planning jusqu'à la réponse,
   *    avec une cadence de relance (J+3, J+7, puis signalement au manager à J+10).
   *    Stocké dans productions.filing.wait = { since, why, by } (aucune migration).
   *  · Cause d'un retard, demandée en un clic à la clôture d'une tâche en retard
   *    (historique « terminee », detail.cause) → Pareto dans Pilotage.
   *  · Pilotage : attente client, délai de réponse des clients, causes des retards, écart prévu / réel.
   * ========================================================================== */
  const WAIT_WHY = { infos: 'Réponse à une demande d\'infos', pieces: 'Pièces manquantes', validation: 'Validation du client', autre: 'Autre blocage' };
  const WAIT_STEPS = [[3, '1re relance'], [7, '2e relance'], [10, 'Signaler au manager']];
  const LATE_CAUSES = [['pieces', 'Pièces du client tardives'], ['reponse', 'Réponse du client attendue'], ['planning', 'Planning trop rempli'], ['complexe', 'Plus complexe que prévu'], ['absence', 'Absence'], ['reprise', 'Erreur / reprise'], ['autre', 'Autre']];
  const LATE_LABEL = Object.fromEntries(LATE_CAUSES);

  const waitOf = p => (p && p.filing && p.filing.wait) || null;
  /* Où en est l'attente : jours écoulés, relances faites depuis, prochaine étape et sa date */
  function waitStage(p) {
    const w = waitOf(p); if (!w) return null;
    const td = today(), days = Math.max(0, E.daysBetween(w.since, td));
    const rel = (S.relances || []).filter(r => r.client_id === p.client_id && r.month === p.month && r.date >= w.since).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const st = WAIT_STEPS[Math.min(rel.length, 2)], date = E.addDays(w.since, st[0]);
    return { w, days, n: rel.length, last: rel[rel.length - 1] || null, label: st[1], date, due: td >= date, esc: rel.length >= 2 && td >= date };
  }
  const waitBadge = p => { const s = waitStage(p); return s ? '<span class="badge ' + (s.due ? 'r' : 'o') + '" title="' + esc(WAIT_WHY[s.w.why] || '') + '">' + ic('clock') + 'Attente client · ' + s.days + ' j</span>' : ''; };
  const isLateNow = t => !t.done && t.kind !== 'info' && ((t.due_date && today() > t.due_date) || (t.planned_date && E.endDate(t) < today()));

  async function setWait(pid, why) {
    const p = S.data.productions.get(pid); if (!p || S.readonly || waitOf(p)) return;
    const c = clientOf(p.client_id) || {}, ts = list('tasks').filter(t => t.production_id === pid && !t.done && t.kind !== 'info');
    if (!ts.every(canEditTask)) { toast('Ce dossier ne fait pas partie de vos plannings.', 'warn'); return; }
    const filing = Object.assign({}, p.filing || {}, { wait: { since: today(), why: why || 'autre', by: meName() || '' } });
    const r = await saveUpdate('productions', pid, { filing }, { history: { action: 'attente', entity: 'production', entity_id: pid, client_id: p.client_id, detail: { why, text: 'En attente du client — ' + (WAIT_WHY[why] || '') } } });
    if (r !== 'ok') return;
    const out = ts.filter(t => t.planned_date || t.locked);
    if (out.length) await saveMany('tasks', out.map(t => ({ id: t.id, patch: { planned_date: null, seq: 0, alloc: null, locked: false } })));
    loadRelances();
    toast(c.name + ' : en attente du client, retiré du planning. 1re relance prévue le ' + fDM(E.addDays(today(), WAIT_STEPS[0][0])) + '.', 'ok', null, 5000);
  }
  async function endWait(pid) {
    const p = S.data.productions.get(pid), w = waitOf(p); if (!w || S.readonly) return;
    const c = clientOf(p.client_id) || {}, td = today(), days = Math.max(0, E.daysBetween(w.since, td));
    const filing = Object.assign({}, p.filing); delete filing.wait;
    const r = await saveUpdate('productions', pid, { filing }, { history: { action: 'attente_fin', entity: 'production', entity_id: pid, client_id: p.client_id, detail: { why: w.why, since: w.since, to: td, days, text: 'Réponse du client reçue après ' + days + ' j' } } });
    if (r !== 'ok') return;
    if (S.fiab) S.fiab.waits.push({ client_id: p.client_id, days, to: td });
    await applyPlan(runPlan(p.month, 'incremental', new Set([pid])));
    const t = list('tasks').filter(x => x.production_id === pid && !x.done && x.kind !== 'info' && x.planned_date).sort((a, b) => a.planned_date.localeCompare(b.planned_date))[0];
    toast(c.name + ' : dossier repris' + (t ? ', replanifié le ' + fDM(t.planned_date) : ' — aucune place trouvée, il est « à affecter »') + '.', t ? 'ok' : 'warn', null, 5000);
  }

  /* Encadré des fiches dossier / tâche */
  function waitBox(p) {
    if (!p) return '';
    const ts = list('tasks').filter(t => t.production_id === p.id && t.kind !== 'info');
    if (!ts.length || ts.every(t => t.done)) return '';
    const edit = !S.readonly && ts.every(canEditTask), s = waitStage(p);
    if (!s) {
      if (!edit) return '';
      return '<div class="ir-box wait-box"><div class="t">' + ic('clock', 'sm') + 'Bloqué par le client ?</div>'
        + (S.waitPick === p.id ? '<div class="ir">' + Object.keys(WAIT_WHY).map(k => '<button data-act="wait-set" data-pid="' + p.id + '" data-why="' + k + '">' + esc(WAIT_WHY[k]) + '</button>').join('') + '</div><span class="small muted">Le dossier sort du planning jusqu\'à la réponse. Relances proposées à J+3 et J+7, puis signalement au manager.</span>'
          : '<div class="row"><button class="btn sm" data-act="wait-pick" data-pid="' + p.id + '">' + ic('clock', 'sm') + 'Mettre en attente du client</button></div>') + '</div>';
    }
    if (!S.relancesLoaded) loadRelances().then(() => { if (S.sheet) renderSheet(); });
    const step = s.esc ? '<span class="badge r">' + ic('alert') + 'À signaler au manager (depuis le ' + fDM(s.date) + ')</span>'
      : '<span class="badge ' + (s.due ? 'r' : '') + '">' + ic(s.due ? 'alert' : 'calendar') + s.label + (s.due ? ' à faire' + (s.date < today() ? ' (prévue le ' + fDM(s.date) + ')' : ' aujourd\'hui') : ' le ' + fDM(s.date)) + '</span>';
    return '<div class="ir-box wait-box on"><div class="t">' + ic('clock', 'sm') + 'En attente du client depuis ' + (s.days ? s.days + ' jour' + (s.days > 1 ? 's' : '') : 'aujourd\'hui') + '</div>'
      + '<div class="small">' + esc(WAIT_WHY[s.w.why] || 'Blocage') + ' · ' + (s.n ? s.n + ' relance' + (s.n > 1 ? 's' : '') + ', la dernière ' + relLabel(s.last) : 'aucune relance') + '</div>'
      + '<div class="row" style="margin-top:6px">' + step + '</div>'
      + (edit ? '<div class="row" style="margin-top:8px"><button class="btn sm" data-act="wait-rel" data-pid="' + p.id + '" data-via="mail">' + ic('mail', 'sm') + 'Relancé par e-mail</button><button class="btn sm" data-act="wait-rel" data-pid="' + p.id + '" data-via="tel">' + ic('phone', 'sm') + 'Relancé par tél.</button><button class="btn sm primary" data-act="wait-end" data-pid="' + p.id + '">' + ic('check', 'sm') + 'Réponse reçue — reprendre</button></div>' : '')
      + '</div>';
  }

  /* Choix de la cause d'un retard (fenêtre « Terminer ») */
  const causeChips = () => '<div class="fd-cause"><div class="small muted" style="margin-bottom:8px"><b style="color:var(--text)">Cette tâche est en retard : pourquoi ?</b> <span>— un clic, pour comprendre où agir</span></div><div class="ir">'
    + LATE_CAUSES.map(c => '<button type="button" data-cause="' + c[0] + '">' + esc(c[1]) + '</button>').join('') + '</div></div>';
  /* Dossier terminé d'un coup (plusieurs tâches) : même question, dans une petite fenêtre */
  function askCause(c) {
    return new Promise(resolve => {
      const root = document.createElement('div');
      root.className = 'overlay anim center';
      root.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" style="width:min(460px,100%)"><div class="sheet-h"><div style="margin-right:auto"><h2>Retard — ' + esc((c && c.name) || 'dossier') + '</h2></div></div><div class="sheet-b">' + causeChips() + '</div><div class="sheet-f"><button class="btn" data-cause="">Passer</button></div></div>';
      root.addEventListener('click', e => { const b = e.target.closest('[data-cause]'); if (!b && e.target !== root) return; fxClose(root); resolve(b ? b.dataset.cause || null : null); });
      document.body.appendChild(root);
    });
  }

  /* Historique utile au Pilotage (chargé une fois) */
  async function loadFiab() {
    if (S.fiab || !S.store.loadHistory) return;
    S.fiab = { waits: [], causes: [] };
    try {
      const [a, b] = await Promise.all([S.store.loadHistory({ limit: 1000, action: 'attente_fin' }), S.store.loadHistory({ limit: 3000, action: 'terminee' })]);
      a.forEach(x => { const d = x.detail || {}; if (x.client_id && d.days !== undefined) S.fiab.waits.push({ client_id: x.client_id, days: Number(d.days) || 0, to: d.to || atDay(x.at) }); });
      b.forEach(x => { const d = x.detail || {}; if (d.cause) S.fiab.causes.push({ cause: d.cause, at: atDay(x.at), client_id: x.client_id }); });
    } catch (e) { /* sans historique : indicateurs vides */ }
    scheduleRender();
  }
  const noteCause = (t, cause) => { if (cause && S.fiab) S.fiab.causes.push({ cause, at: today(), client_id: t.client_id }); };

  /* ---------- Pilotage : fiabilité du planning ---------- */
  function fiabSection(m) {
    loadFiab();
    const td = today(), F = S.fiab || { waits: [], causes: [] }, vis = new Set(scopedData().clients.map(c => c.id));
    // 1. Dossiers en attente du client
    const waiting = list('productions').filter(p => waitOf(p) && vis.has(p.client_id)).map(p => ({ p, s: waitStage(p), c: clientOf(p.client_id) || {} })).sort((a, b) => b.s.days - a.s.days);
    const relDue = waiting.filter(x => x.s.due).length;
    const y1 = E.addDays(td, -365), ws = F.waits.filter(w => w.to >= y1 && vis.has(w.client_id));
    const avg = ws.length ? ws.reduce((s, w) => s + w.days, 0) / ws.length : null;
    const byC = new Map(); ws.forEach(w => { const o = byC.get(w.client_id) || { n: 0, d: 0 }; o.n++; o.d += w.days; byC.set(w.client_id, o); });
    const slow = [...byC.entries()].map(([id, o]) => ({ c: clientOf(id) || { name: '?' }, avg: o.d / o.n, n: o.n })).sort((a, b) => b.avg - a.avg).slice(0, 5);
    const f1 = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
    const wait = '<div class="card anim-in fb-card"><div class="card-h"><h2>' + ic('clock', 'sm') + ' Attente client</h2>' + (waiting.length ? '<span class="badge ' + (relDue ? 'r' : 'o') + '">' + waiting.length + ' dossier' + (waiting.length > 1 ? 's' : '') + '</span>' : '') + '</div>'
      + (waiting.length ? '<div class="fb-list">' + waiting.slice(0, 8).map(x => '<button class="fb-row" data-act="client" data-id="' + x.c.id + '"><b>' + esc(x.c.name) + '</b><span class="small muted">' + esc(WAIT_WHY[x.s.w.why] || '') + ' · ' + x.s.n + ' relance' + (x.s.n > 1 ? 's' : '') + '</span><span class="badge ' + (x.s.esc ? 'r' : x.s.due ? 'o' : '') + '">' + (x.s.esc ? 'À signaler' : x.s.due ? x.s.label + ' à faire' : x.s.days + ' j') + '</span></button>').join('') + '</div>' + (waiting.length > 8 ? '<p class="small muted">+ ' + (waiting.length - 8) + ' autre(s)</p>' : '')
        : '<div class="pc-c-empty">' + ic('check', 'sm') + 'Aucun dossier bloqué par un client.</div>')
      + '<div class="fb-sub"><div class="fb-big"><b>' + (avg === null ? '—' : f1(avg) + ' j') + '</b><span>délai moyen de réponse des clients' + (ws.length ? ' (' + ws.length + ' attente' + (ws.length > 1 ? 's' : '') + ', 12 mois)' : '') + '</span></div>'
      + (slow.length ? '<div class="fb-slow">' + slow.map(x => '<div><span>' + esc(x.c.name) + '</span><b>' + f1(x.avg) + ' j</b></div>').join('') + '</div>' : '<p class="small muted" style="margin:6px 0 0">Il se calcule à chaque « Réponse reçue — reprendre ».</p>') + '</div></div>';
    // 2. Causes des retards (90 derniers jours) — Pareto
    const d90 = E.addDays(td, -90), cs = F.causes.filter(x => x.at >= d90 && (!x.client_id || vis.has(x.client_id))), tot = cs.length;
    const cnt = LATE_CAUSES.map(c => ({ k: c[0], l: c[1], n: cs.filter(x => x.cause === c[0]).length })).filter(x => x.n).sort((a, b) => b.n - a.n);
    let cum = 0;
    const par = '<div class="card anim-in fb-card"><div class="card-h"><h2>' + ic('alert', 'sm') + ' Causes des retards</h2><span class="small muted">90 derniers jours</span></div>'
      + (tot ? '<div class="fb-par">' + cnt.map(x => { cum += x.n; return '<div class="fb-bar"><span class="l">' + esc(x.l) + '</span><span class="b"><i style="width:' + (x.n / cnt[0].n * 100).toFixed(1) + '%"></i></span><b>' + x.n + '</b><span class="cum small muted">' + Math.round(cum / tot * 100) + ' %</span></div>'; }).join('') + '</div>'
        + '<p class="small muted" style="margin:8px 0 0">' + tot + ' retard' + (tot > 1 ? 's' : '') + ' expliqué' + (tot > 1 ? 's' : '') + '. Agir d\'abord sur les premières lignes : elles cumulent l\'essentiel.</p>'
        : '<div class="pc-c-empty">' + ic('check', 'sm') + 'Aucune cause notée pour l\'instant : elle est demandée à la clôture d\'une tâche en retard.</div>')
      + fbGap(m) + '</div>';
    return '<div class="section-t"><h2>Fiabilité du planning</h2></div><div class="split fb-split">' + wait + par + '</div>';
  }
  /* Écart entre temps prévu et temps réel, par type, sur les tâches terminées du mois */
  function fbGap(m) {
    const vis = new Set(scopedData().collaborators.map(c => c.id));
    const ts = list('tasks').filter(t => t.month === m && t.done && Number(t.actual_min) > 0 && Number(t.duration_min) > 0 && vis.has(t.collaborator_id));
    if (!ts.length) return '';
    const rows = E.KINDS.map(k => { const xs = ts.filter(t => t.kind === k); if (!xs.length) return null; const p = xs.reduce((s, t) => s + Number(t.duration_min), 0), a = xs.reduce((s, t) => s + Number(t.actual_min), 0); return { k, n: xs.length, p, a, g: Math.round((a - p) / p * 100) }; }).filter(Boolean);
    return '<div class="fb-gap"><div class="small muted" style="margin:12px 0 6px"><b style="color:var(--text)">Temps prévu / temps réel</b> — ' + esc(fMonth(m)) + ', ' + ts.length + ' tâche' + (ts.length > 1 ? 's' : '') + ' terminée' + (ts.length > 1 ? 's' : '') + '</div>'
      + rows.map(r => '<div class="fb-g"><span>' + esc(E.KIND_LABEL[r.k]) + ' <em class="small muted">(' + r.n + ')</em></span><span class="small muted">' + E.fmtMin(r.p) + ' → ' + E.fmtMin(r.a) + '</span><b class="' + (r.g > 10 ? 'bad' : r.g < -10 ? 'good' : '') + '">' + (r.g > 0 ? '+' : '') + r.g + ' %</b></div>').join('') + '</div>';
  }
