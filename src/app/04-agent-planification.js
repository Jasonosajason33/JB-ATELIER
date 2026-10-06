  /* ---------- Création automatique des dossiers du mois ---------- */
  async function autoCreateMonths() {
    if (!cfg().auto_create_month || S.readonly || !collabs().length) { await dedupeDashboards(); return; } // V26.180 : doublons supprimés à chaque ouverture (manager)
    const months = [...new Set([today().slice(0, 7), defaultMonth(), E.addMonths(defaultMonth(), 1)])].filter(m => !startMonth() || m >= startMonth()); // planning prospectif : le mois prochain est créé à l'avance (V26.164 : jamais avant le premier mois d'utilisation)
    for (const m of months) {
      if (list('productions').some(p => p.month === m) || !missingForMonth(m)) continue;
      await generateMonth(m, { auto: true });
    }
    await syncDashboards();
  }
  /* ====================== Agent de planification ======================
   * Il apprend des mois précédents (dates de réception réelles, temps réels) et de l'historique importé,
   * puis ajuste automatiquement les dates de réception prévues des dossiers non reçus (information dans le tableau
   * de bord et l'historique) et propose des temps de production à valider par l'administrateur.
   * Il tourne uniquement chez l'administrateur (une seule source de modifications). */
  const agentOn = () => !!(S.v7 && cfg().agent_enabled);
  const agentState = () => ((S.data.settings.get('agent') || {}).value) || {};
  async function saveAgentState(patch) {
    const cur = S.data.settings.get('agent'), value = Object.assign({}, agentState(), patch);
    if (cur) return saveUpdate('settings', 'agent', { value }, { quiet: true });
    try { await saveInsert('settings', [{ id: 'agent', value }]); return 'ok'; } catch (e) { return 'failed'; }
  }
  /* V26.16 : période de production du 1er au 24 (appliqué une seule fois) */
  async function upgradeSettings() {
    if (!isAdmin() || S.readonly || !S.data.settings.get('planning')) return;
    const st = cfg(); if (st.v2616) return;
    const value = Object.assign({}, st, { v2616: true }, st.start_day === 2 ? { start_day: 1 } : {});
    await saveUpdate('settings', 'planning', { value }, { quiet: true, history: st.start_day === 2 ? { action: 'parametres', detail: { text: 'Période de production : du 1er au ' + st.end_day } } : null });
  }
  async function loadPast() {
    if (S.past) return S.past;
    const to = S.loadedFrom || E.addMonths(today().slice(0, 7), -1);
    try { S.past = await S.store.loadRange(E.addMonths(to, -12), to); } catch (e) { S.past = { productions: [], tasks: [] }; }
    return S.past;
  }
  /* Observations : une ligne par dossier et par mois (données de l'application, sinon historique importé) */
  function agentSamples() {
    const past = S.past || { productions: [], tasks: [] }, st = cfg(), td = today();
    const prods = new Map(); past.productions.concat(list('productions')).forEach(p => prods.set(p.id, p));
    const byProd = new Map();
    past.tasks.concat(list('tasks')).forEach(t => { if (t.kind === 'info') return; if (!byProd.has(t.production_id)) byProd.set(t.production_id, new Map()); byProd.get(t.production_id).set(t.id, t); });
    const out = [], seen = new Set();
    for (const p of prods.values()) {
      const c = clientOf(p.client_id); if (!c) continue;
      const ts = [...(byProd.get(p.id) || new Map()).values()];
      const timed = ts.length > 0 && ts.every(t => t.done && Number(t.actual_min) > 0);
      out.push({
        client_id: c.id, month: p.month, source: 'app',
        nominal: p.nominal_date || p.expected_date || E.dateInMonth(p.month, c.reception_day || st.start_day),
        received: p.received_date && p.received_date <= td ? p.received_date : null,
        predicted: p.nominal_date ? p.expected_date : null,
        planned: timed ? ts.reduce((s, t) => s + (Number(t.duration_min) || 0), 0) : null,
        actual: timed ? ts.reduce((s, t) => s + (Number(t.actual_min) || 0), 0) : null,
        collaborator_id: (ts[0] || {}).collaborator_id || c.collaborator_id
      });
      seen.add(c.id + '|' + p.month);
    }
    for (const h of list('learning_history')) {
      if (seen.has(h.client_id + '|' + h.month) || !clientOf(h.client_id)) continue;
      out.push({ client_id: h.client_id, month: h.month, source: 'import', nominal: h.nominal_date, received: h.received_date, predicted: null, planned: h.planned_min, actual: h.actual_min, collaborator_id: h.collaborator_id });
    }
    return out;
  }
  function agentModel() {
    const key = S.lastSync + '|' + S.data.learning_history.size + '|' + (S.past ? S.past.productions.length : -1) + '|' + today() + '|' + S.data.clients.size + '|' + (S.relances || []).length;
    if (!S.agent || S.agentKey !== key) { S.agent = E.learn(agentSamples(), list('clients'), cfg(), today(), S.relances || []); S.agentKey = key; }
    return S.agent;
  }
  /* V26.44 : précision de l'agent semaine par semaine, alerte si elle se dégrade */
  function weeklyHtml(md) {
    const w = md.weekly || [], d = md.drift || {}, f1 = v => (v || 0).toFixed(1).replace('.', ',');
    if (!w.length) return '<div class="notice small" style="margin-top:8px"><b>Suivi hebdomadaire</b> : disponible dès les premières réceptions prévues par l\'agent.</div>';
    const max = Math.max(1, ...w.map(x => Math.max(x.agent, x.naive)));
    const bars = w.map(x => '<div class="wkp" title="Semaine du ' + fDM(x.week) + ' · ' + x.n + ' réception(s)\nAgent : ' + f1(x.agent) + ' j d\'écart · date habituelle : ' + f1(x.naive) + ' j"><div class="wkp-c"><i class="n" style="height:' + (x.naive / max * 100).toFixed(0) + '%"></i><i class="a" style="height:' + (x.agent / max * 100).toFixed(0) + '%"></i></div><span>' + Number(x.week.slice(8)) + '/' + x.week.slice(5, 7) + '</span></div>').join('');
    const status = d.alert ? '<div class="notice bad small"><b>Alerte :</b> la précision de l\'agent se dégrade (' + f1(d.last) + ' j sur les 4 dernières semaines contre ' + (d.prev !== null ? f1(d.prev) + ' j avant' : '—') + '). Vérifiez les réceptions déclarées en retard ou un changement d\'habitude d\'un client.</div>'
      : d.last !== null && d.last !== undefined ? '<div class="notice ok small">4 dernières semaines : <b>' + f1(d.last) + ' j</b> d\'écart moyen (date habituelle seule : ' + f1(d.naive) + ' j).</div>' : '';
    return '<div class="card anim-in" style="margin-top:var(--gap)"><div class="card-h"><h2>Précision semaine par semaine</h2><span class="small muted">écart moyen entre date prévue et date réelle de réception</span></div>' + status
      + '<div class="wkp-row">' + bars + '</div><div class="legend small"><span><i class="lg-sw" style="background:var(--accent)"></i>Agent</span><span><i class="lg-sw" style="background:var(--track)"></i>Date habituelle seule</span></div></div>';
  }
  function agentWhy(l) {
    const d = Number(l.nominal.slice(8));
    return l.shift === 0 ? 'date habituelle (le ' + d + ')' : (l.shift > 0 ? '+' : '') + l.shift + ' j par rapport au ' + d + (l.n ? ' · habitude sur ' + l.n + ' mois' : '') + (l.rel === 'imprevisible' ? ' · client imprévisible : hypothèse prudente' : '') + (l.season ? ' · ' + (l.season.v > 0 ? '+' : '') + l.season.v + ' j en ' + MONTHS[Number(l.month.slice(5, 7)) - 1] + ' (saisonnalité ' + l.season.src + ')' : '');
  }
  /* V26.32 : explication complète d'une prévision de réception (fiche, info-bulle, réceptions) */
  function predictInfo(p) {
    const c = clientOf(p.client_id); if (!c || p.received_date) return null;
    const pr = E.predictReception(agentModel(), c, p.month, cfg()), m = pr.m, parts = [];
    const nd = Number(pr.nominal.slice(8));
    if (!m || !m.n) parts.push('pas encore d\'historique : date habituelle du ' + nd);
    else {
      parts.push('habituellement ' + (m.delay === 0 ? 'à l\'heure' : m.delay > 0 ? m.delay + ' j après le ' + nd : Math.abs(m.delay) + ' j avant le ' + nd) + ' (observé sur ' + m.months + ' mois)');
      if (m.reliability === 'imprevisible') parts.push('client imprévisible : hypothèse prudente (8 fois sur 10)');
      else if (m.reliability === 'variable') parts.push('client variable');
    }
    if (pr.season) parts.push((pr.season.v > 0 ? '+' : '') + pr.season.v + ' j en ' + MONTHS[Number(p.month.slice(5, 7)) - 1] + ' (saisonnalité ' + (pr.season.src === 'dossier' ? 'du dossier' : 'du cabinet') + ')');
    let relance = '';
    if (pr.relanceDay) relance = 'Meilleur jour de relance : ' + fDate(pr.relanceDay) + ' (réception en moyenne ' + pr.lag + ' j après une relance' + (m && m.relance ? ', ' + m.relance.n + ' relance(s) observée(s)' : ', moyenne du cabinet') + ')';
    return { date: pr.date, text: 'Prévu le ' + fDM(pr.date) + ' : ' + parts.join(' · ') + '.', relance, pr };
  }
  const predictTitle = p => { const i = predictInfo(p); return i ? ' title="' + esc('Prévision de réception\n' + i.text + (i.relance ? '\n' + i.relance : '')) + '"' : ''; };
  /* Ajuste les dates prévues des dossiers non reçus (mois en cours et suivants), puis replanifie les prévisionnels */
  async function runAgent(opts) {
    opts = opts || {};
    if (!agentOn() || S.readonly) return 0; // V26.44 : l'agent tourne à la connexion de chaque utilisateur (collaborateur : ses dossiers seulement)
    const mgr = isManager();
    await loadPast(); await loadRelances();
    const model = agentModel(), cur = defaultMonth(), st = cfg(), items = [], log = []; // mois de production en cours et suivants (jamais une période terminée)
    for (const p of list('productions')) {
      if (p.month < cur || p.received_date || p.partial_date) continue;
      const c = clientOf(p.client_id); if (!c || (!mgr && !canSeeCollab(c.collaborator_id))) continue;
      const pr = E.predictReception(model, c, p.month, st);
      if (pr.date === p.expected_date && pr.nominal === p.nominal_date) continue;
      items.push({ id: p.id, patch: { expected_date: pr.date, nominal_date: pr.nominal } });
      if (pr.date !== p.expected_date) log.push({ at: new Date().toISOString(), client_id: c.id, month: p.month, from: p.expected_date, to: pr.date, nominal: pr.nominal, shift: pr.shift, n: pr.m ? pr.m.months : 0, rel: pr.m ? pr.m.reliability : 'nouveau', season: pr.season });
    }
    if (!items.length) return 0;
    await saveMany('productions', items);
    if (log.length) {
      S.store.logHistory(log.map(l => ({ action: 'agent_reception', entity: 'production', client_id: l.client_id, detail: { from: l.from, to: l.to, text: fMonth(l.month) + ' — ' + agentWhy(l) } }))).catch(() => { });
      S.histCache = null;
      if (mgr) await saveAgentState({ log: log.concat(agentState().log || []).slice(0, 80), last_run: new Date().toISOString() });
    }
    for (const m of new Set(items.map(x => (S.data.productions.get(x.id) || {}).month).filter(Boolean))) { const res = runPlan(m, 'incremental', new Set()); if (!mgr) res.changes = res.changes.filter(ch => { const t = S.data.tasks.get(ch.id); return t && canSeeCollab(t.collaborator_id); }); await applyPlan(res); }
    if (mgr && log.length && !opts.silent) toast('Agent de planification : ' + log.length + ' date(s) de réception ajustée(s) selon les habitudes des clients. Planning mis à jour.', 'ok', { label: 'Voir', fn: () => { go('previsions'); setTimeout(() => { const el = $('#agent'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 250); } }, 9000);
    return log.length;
  }
  async function agentStartup() { await runAgent(); scheduleRender(); }
  /* Indication affichée quand la date prévue diffère de la date habituelle (ajustement de l'agent) */
  function recRelHint(p) { const i = predictInfo(p); return i && i.relance && i.pr.relanceDay >= today() ? ' · <b>relancer le ' + fDM(i.pr.relanceDay) + '</b>' : ''; }
  function expHint(p) { return p && p.nominal_date && p.expected_date && p.nominal_date !== p.expected_date ? ' (habituel : le ' + Number(p.nominal_date.slice(8)) + ')' : ''; }
  const REL_LABEL = { regulier: ['Régulier', 'g'], variable: ['Variable', 'o'], imprevisible: ['Imprévisible', 'r'], nouveau: ['Peu d\'historique', ''] };
  /* Tableau de bord (administrateur) : ce que l'agent a appris, ses ajustements et ses propositions */
  function agentTimeList() {
    const md = agentModel(), dis = agentState().dismissed || {};
    const rows = [...md.clients.values()].map(r => ({ r, c: clientOf(r.client_id) })).filter(x => x.c && x.c.active !== false && x.r.time.suggest && dis[x.c.id] !== x.r.time.suggest)
      .sort((a, b) => Math.abs(b.r.time.suggest - b.r.time.cur) - Math.abs(a.r.time.suggest - a.r.time.cur)).slice(0, 12);
    if (!rows.length) return '<div class="empty">Aucun temps de production à revoir : les temps prévus correspondent aux temps réels.</div>';
    return '<div class="tasks">' + rows.map(x => { const g = Math.round((x.r.time.suggest - x.r.time.cur) / x.r.time.cur * 100); return '<div class="info-row"><span class="ibox ' + (g > 0 ? 'o' : 'b') + '">' + ic('clock', 'sm') + '</span><div class="t"><b>' + esc(x.c.name) + '</b><span>prévu ' + E.fmtMin(x.r.time.cur) + ' · réel habituel ' + E.fmtMin(x.r.time.est) + ' (' + (g > 0 ? '+' : '') + g + ' %) · ' + x.r.time.n + ' mois</span></div>'
      + '<button class="btn sm primary" data-act="adjust-time" data-id="' + x.c.id + '" data-v="' + x.r.time.suggest + '">Valider ' + E.fmtMin(x.r.time.suggest) + '</button><button class="btn sm" data-act="agent-dismiss" data-id="' + x.c.id + '" data-v="' + x.r.time.suggest + '">Ignorer</button></div>'; }).join('') + '</div>';
  }
  function agentSection() {
    if (!isManager()) return '';
    const head = extra => '<div class="section-t" id="agent"><h2>Agent de planification</h2><span class="badge k">' + ic('lock') + 'Administrateur</span>' + (extra || '') + '</div>';
    if (!S.v7) return head() + '<div class="notice warn">Pour activer l\'agent (planning prospectif, réception partielle, historique), exécutez une fois <b>supabase/migration_v1_7.sql</b> dans Supabase (SQL Editor), puis rechargez la page.</div>';
    if (!cfg().agent_enabled) return head('<span class="badge">Désactivé</span>') + '<div class="notice">L\'agent est désactivé (Paramètres › Planification).</div>';
    const md = agentModel(), ag = agentState();
    if (S.agentSeen === undefined) { S.agentSeen = lsGet('planif-agent-seen') || ''; lsSet('planif-agent-seen', new Date().toISOString()); }
    const rows = [...md.clients.values()].map(r => ({ r, c: clientOf(r.client_id) })).filter(x => x.c && x.c.active !== false);
    const learned = rows.filter(x => x.r.n > 0);
    const pr = md.precision.slice(-3), n = pr.reduce((s, a) => s + a.n, 0);
    const agErr = n ? pr.reduce((s, a) => s + a.agent * a.n, 0) / n : null, nvErr = n ? pr.reduce((s, a) => s + a.naive * a.n, 0) / n : null;
    const tp = md.timePrecision.slice(-3), tn = tp.reduce((s, a) => s + a.n, 0), tErr = tn ? tp.reduce((s, a) => s + a.err * a.n, 0) / tn : null;
    const unpred = learned.filter(x => x.r.reliability === 'imprevisible').length;
    const fj = v => String(Math.round(v * 10) / 10).replace('.', ',') + ' j';
    const kpi = (i, icon, box, label, val, foot) => '<div class="kpi anim-in" style="--i:' + i + '"><div class="kpi-h"><span class="ibox ' + box + '">' + ic(icon, 'sm') + '</span>' + label + '</div><div class="v">' + val + '</div><div class="foot">' + foot + '</div></div>';
    const kpis = kpi(0, 'sparkle', md.samples.months ? 'g' : '', 'Apprentissage', md.samples.months + '<small> mois</small>', md.samples.receptions + ' réceptions · ' + md.samples.times + ' temps réels' + (md.samples.imported ? ' (dont historique importé)' : ''))
      + kpi(1, 'calendar', agErr === null ? '' : agErr <= nvErr ? 'g' : 'o', 'Précision des réceptions', agErr === null ? '—' : fj(agErr), agErr === null ? 'mesurée dès les premières réceptions prévues par l\'agent' : 'd\'écart moyen · ' + fj(nvErr) + ' avec la seule date habituelle')
      + kpi(2, 'clock', tErr === null ? '' : tErr <= .15 ? 'g' : 'o', 'Précision des temps', tErr === null ? '—' : '± ' + Math.round(tErr * 100) + ' %', 'écart moyen entre temps réel et temps prévu')
      + kpi(3, 'alert', unpred ? 'o' : 'g', 'Clients imprévisibles', String(unpred), unpred ? 'planifiés avec une marge prudente' : 'aucun à ce jour');
    const seasonTxt = Object.keys(md.seasonCab || {}).sort().map(mm => MONTHS[Number(mm) - 1] + ' ' + (md.seasonCab[mm] > 0 ? '+' : '') + md.seasonCab[mm] + ' j').join(' · ');
    const insights = '<div class="notice info small" style="margin-top:10px"><b>Saisonnalité</b> : ' + (seasonTxt ? seasonTxt + ' (écart habituel du cabinet sur ces mois, appliqué aux prévisions)' : 'pas encore de mois atypique détecté (5 réceptions d\'un même mois nécessaires)') + '.<br><b>Effet des relances</b> : ' + (md.relanceLag != null ? 'les éléments arrivent en moyenne <b>' + md.relanceLag + ' j</b> après une relance (' + md.relancesN + ' relance(s) mesurée(s)) ; le meilleur jour de relance est indiqué sur chaque dossier attendu' : md.relancesN + ' relance(s) mesurée(s) pour l\'instant : l\'effet est calculé dès 3 relances suivies d\'une réception') + '.<br><b>Nouveaux dossiers</b> : temps de production majoré de ' + newMarginPct() + ' % tant qu\'il y a moins de 3 mois de temps réels.</div>';
    const log = (ag.log || []).slice(0, 10);
    const logHtml = log.length ? '<div class="tasks">' + log.map(l => { const c = clientOf(l.client_id); return '<div class="info-row"><span class="ibox b">' + ic('calendar', 'sm') + '</span><div class="t"><b>' + esc(c ? c.name : '?') + (l.at > S.agentSeen ? ' <span class="badge g">Nouveau</span>' : '') + '</b><span>' + esc(fMonth(l.month)) + ' : ' + (l.from ? 'le ' + Number(l.from.slice(8)) : '—') + ' → <b>le ' + Number(l.to.slice(8)) + '</b> · ' + esc(agentWhy(l)) + '</span></div><span class="small muted nowrap hide-m">' + fDateTime(l.at) + '</span></div>'; }).join('') + '</div>'
      : '<div class="empty">Aucun ajustement pour l\'instant. L\'agent ajuste les dates dès qu\'il repère une habitude (2 mois d\'historique ou plus).</div>';
    const prof = learned.sort((a, b) => Math.abs(b.r.delay) - Math.abs(a.r.delay) || b.r.lateRate - a.r.lateRate).slice(0, 12);
    const profHtml = prof.length ? '<div class="scroll-x"><table class="t stack"><thead><tr><th>Dossier</th><th>Habitude de réception</th><th>Régularité</th><th class="num">Historique</th><th class="num">Temps réel habituel</th></tr></thead><tbody>' + prof.map(x => { const rl = REL_LABEL[x.r.reliability]; return '<tr><td class="first">' + esc(x.c.name) + '</td><td data-l="Habitude">' + (x.r.delay === 0 ? 'à la date habituelle' : (x.r.delay > 0 ? x.r.delay + ' j après' : -x.r.delay + ' j avant') + ' la date habituelle') + (x.c.reception_day ? ' <span class="muted small">(le ' + x.c.reception_day + ')</span>' : '') + '</td><td data-l="Régularité"><span class="badge ' + rl[1] + '">' + rl[0] + '</span></td><td class="num" data-l="Historique">' + x.r.months + ' mois</td><td class="num" data-l="Temps">' + (x.r.time.est ? E.fmtMin(x.r.time.est) + ' <span class="muted small">/ ' + E.fmtMin(x.r.time.cur) + ' prévu</span>' : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<div class="empty">Pas encore d\'historique : importez vos mois passés (Paramètres › Historique pour l\'agent) ou laissez l\'agent apprendre au fil des mois.</div>';
    const cr = [...md.collab.entries()].map(([id, r]) => ({ c: collabOf(id), r })).filter(x => x.c && x.r.n >= 3);
    const collabHtml = cr.length ? '<div class="tasks">' + cr.map(x => { const g = Math.round((x.r.real / x.r.plan - 1) * 100); return '<div class="info-row"><span class="mini-av" style="background:' + esc(x.c.color || '#888') + '">' + esc(initials(x.c.name)) + '</span><div class="t"><b>' + esc(x.c.name) + '</b><span>' + x.r.n + ' dossier(s) sur 6 mois · ' + E.fmtMin(x.r.real) + ' réel / ' + E.fmtMin(x.r.plan) + ' prévu</span></div><span class="delta ' + (Math.abs(g) < 10 ? 'flat' : g > 0 ? 'down' : 'up') + '">' + (g > 0 ? '+' : '') + g + ' %</span></div>'; }).join('') + '</div>' : '<div class="empty">Disponible après quelques dossiers terminés avec leur temps réel.</div>';
    return head('<span class="small muted">' + (ag.last_run ? 'dernier passage ' + fDateTime(ag.last_run) : 'apprend des mois précédents') + '</span><span class="spacer"></span><button class="btn sm" data-act="agent-run">' + ic('refresh', 'sm') + 'Relancer l\'agent</button>')
      + '<div class="carousel desk-grid" style="--n:4" data-keep="kpi-agent">' + kpis + '</div><div class="dots" data-dots></div>' + insights + weeklyHtml(md)
      + '<div class="split" style="margin-top:var(--gap)"><div class="frame anim-in agent-log"><div class="frame-h">' + ic('calendar') + '<h2>Dates de réception ajustées</h2>' + (log.length ? '<span class="badge b">' + (ag.log || []).length + '</span>' : '') + '</div><div class="inner">' + logHtml + '</div></div>'
      + '<div class="frame anim-in"><div class="frame-h">' + ic('users') + '<h2>Rythme des collaborateurs</h2><span class="badge k">' + ic('lock') + 'Manager</span></div><div class="inner">' + collabHtml + '</div></div></div>'
      + '<div class="card anim-in" style="margin-top:var(--gap)"><div class="card-h"><h2>Profil de réception des dossiers</h2><span class="small muted">' + learned.length + ' dossier(s) avec historique</span></div>' + profHtml + '</div>';
  }
  /* Planning prospectif : prévision de charge du mois prochain */
  function nextMonthSection(m) {
    const td = today(); if (m !== td.slice(0, 7) && m !== defaultMonth()) return '';
    const nm = E.addMonths(m, 1), prods = scopedData().productions.filter(p => p.month === nm);
    const head = '<div class="section-t"><h2>Prévision ' + esc(deMonth(nm)) + '</h2><span class="muted small">planning prospectif selon les dates de réception prévues</span></div>';
    if (!prods.length) return head + '<div class="notice">' + (isManager() && missingForMonth(nm) ? 'Les dossiers ' + esc(deMonth(nm)) + ' ne sont pas encore créés. <button class="btn sm" data-act="generate" data-m="' + nm + '">' + ic('plus', 'sm') + 'Créer et planifier maintenant</button>' : 'Les dossiers ' + esc(deMonth(nm)) + ' seront créés automatiquement.') + '</div>';
    const x = ctx(), data = scopedData(), db = E.dashboard(data, nm, td), md = isManager() && agentOn() ? agentModel() : null;
    const unsure = md ? prods.filter(p => !p.received_date && ((md.clients.get(p.client_id) || {}).reliability === 'imprevisible')).length : 0;
    const maxv = Math.max(1, ...db.team.map(r => Math.max(r.cap, r.total)));
    const rows = db.team.map(r => { const lv = E.levelOf(r.total, r.cap, x.settings); return '<div class="pj-row"><div class="pj-n"><span class="mini-av" style="background:' + esc(r.collab.color || '#888') + '">' + esc(initials(r.collab.name)) + '</span><b>' + esc(r.collab.name) + '</b></div><div class="pj-bars"><div class="pj-cap" style="width:' + (r.cap / maxv * 100).toFixed(1) + '%"></div><div class="pj-todo' + (lv === 'red' ? ' over' : '') + '" style="width:' + (r.total / maxv * 100).toFixed(1) + '%"></div></div><div class="pj-v"><b style="color:' + (lv === 'red' ? 'var(--bad)' : lv === 'orange' ? 'var(--warn)' : 'var(--ok)') + '">' + r.fill + ' %</b><span>' + E.fmtMin(r.total) + ' prévues · ' + E.fmtMin(r.cap) + ' dispo' + (r.unplanned ? ' · <b style="color:var(--bad)">' + r.unplanned + ' non planifiée(s)</b>' : '') + '</span></div></div>'; }).join('');
    const sg = isManager() ? E.suggestTransfers(data, nm, td) : [];
    const sug = !isManager() ? '' : '<div class="frame anim-in"><div class="frame-h">' + ic('users') + '<h2>Propositions de répartition</h2><span class="badge k">' + ic('lock') + 'Manager</span></div><div class="inner">' + (sg.length ? '<div class="tasks">' + sg.map(s => { const cl = clientOf(s.task.client_id) || {}; return '<div class="info-row"><span class="ibox b">' + ic('users', 'sm') + '</span><div class="t"><b>' + esc(cl.name) + '</b><span>' + E.fmtMin(s.dur) + ' · ' + esc(s.from.name) + ' → ' + esc(s.to.name) + '</span></div>' + (S.readonly ? '' : '<button class="btn sm" data-act="transfer" data-id="' + s.task.id + '" data-to="' + s.to.id + '">' + ic('arrowUR', 'sm') + 'Transférer</button>') + '</div>'; }).join('') + '</div>' : '<div class="empty">Aucune répartition nécessaire pour ' + esc(fMonth(nm)) + '.</div>') + '</div></div>';
    return head + '<div class="split"><div class="card anim-in"><div class="card-h"><h2>Niveau d\'activité prévu par collaborateur</h2><span class="small muted">' + prods.length + ' dossiers · ' + db.productions.received + ' déjà reçus' + (unsure ? ' · ' + unsure + ' à réception incertaine' : '') + '</span></div>' + rows
      + '<div class="row" style="margin-top:12px"><button class="btn sm" data-act="see-month" data-m="' + nm + '">' + ic('calendar', 'sm') + 'Voir le planning ' + esc(deMonth(nm)) + '</button></div></div>' + (sug || '<div></div>') + '</div>';
  }

  /* ---------- Réception partielle : la partie reçue est planifiée tout de suite, le reste reste attendu ---------- */
  function partialDialog(p) {
    const c = clientOf(p.client_id) || {}, base = waitingTask(p);
    const total = base ? Number(base.duration_min) || 0 : 0, def = Math.max(15, Math.round(total / 2 / 15) * 15);
    return new Promise(resolve => {
      const root = document.createElement('div');
      root.className = 'overlay anim center';
      root.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" style="width:min(480px,100%)"><div class="sheet-h"><div style="margin-right:auto"><h2>Réception partielle — ' + esc(c.name) + '</h2><div class="small muted" style="margin-top:4px">Temps restant à produire : ' + E.fmtMin(total) + '</div></div></div>'
        + '<div class="sheet-b"><label class="f"><span>Temps estimé pour la partie reçue</span><div class="time-in"><button type="button" class="btn icon" data-d="-15" aria-label="Moins 15 minutes">−</button><input type="text" id="pr-time" value="' + E.fmtMin(def) + '" autocomplete="off"><button type="button" class="btn icon" data-d="15" aria-label="Plus 15 minutes">+</button></div></label>'
        + '<label class="f"><span>Reçue le</span><input type="date" id="pr-date" value="' + today() + '"></label>'
        + '<div class="notice" id="pr-rest"></div><div class="notice bad" id="pr-err" style="display:none"></div></div>'
        + '<div class="sheet-f"><button class="btn" data-x="cancel">Annuler</button><button class="btn primary" data-x="ok">' + ic('inbox', 'sm') + 'Enregistrer</button></div></div>';
      const inp = root.querySelector('#pr-time'), rest = root.querySelector('#pr-rest'), err = root.querySelector('#pr-err');
      const upd = () => { const n = E.parseDuration(inp.value); rest.innerHTML = isNaN(n) ? 'Temps illisible (ex. 1h30, 45 min).' : n >= total ? 'Cela couvre tout le dossier : il sera déclaré <b>entièrement reçu</b>.' : 'Planifiée dès maintenant : <b>' + E.fmtMin(n) + '</b> · reste attendu : <b>' + E.fmtMin(total - n) + '</b> (placé après la réception du reste).'; };
      const done = v => { fxClose(root); resolve(v); };
      root.addEventListener('input', upd);
      root.addEventListener('click', e => {
        const d = e.target.closest('[data-d]'), x = e.target.closest('[data-x]');
        if (d) { const n = E.parseDuration(inp.value); inp.value = E.fmtMin(Math.max(15, (isNaN(n) ? def : n) + Number(d.dataset.d))); upd(); }
        else if (x && x.dataset.x === 'ok') {
          const n = E.parseDuration(inp.value), date = root.querySelector('#pr-date').value;
          if (isNaN(n) || n <= 0) { err.textContent = 'Temps illisible (ex. 1h30, 45 min).'; err.style.display = ''; return; }
          if (!date) { err.textContent = 'Indiquez la date de réception.'; err.style.display = ''; return; }
          done({ minutes: n, date });
        } else if (x || e.target === root) done(null);
      });
      document.body.appendChild(root); upd();
      setTimeout(() => { inp.focus(); inp.select(); }, 60);
    });
  }
  /* Tâche de production encore en attente d'éléments pour ce dossier */
  const waitingTask = p => list('tasks').filter(t => t.production_id === p.id && t.kind !== 'info' && !t.done && !t.received_date).sort((a, b) => (b.part === 'reste') - (a.part === 'reste'))[0] || null;
  async function receivePartial(pid) {
    const p = S.data.productions.get(pid); if (!p || p.received_date) return;
    if (!S.v7) { toast('Réception partielle indisponible : exécutez d\'abord supabase/migration_v1_7.sql dans Supabase.', 'warn'); return; }
    const base = waitingTask(p);
    if (!base) { toast('Aucune production en attente pour ce dossier.', 'warn'); return; }
    const r = await partialDialog(p); if (!r) return;
    const total = Number(base.duration_min) || 0;
    if (r.minutes >= total) return validateReceptions([pid], r.date);
    const part = Object.assign({}, base, { id: P.uuid(), duration_min: r.minutes, part: 'recu', received_date: r.date, planned_date: null, seq: 0, alloc: null, locked: false, done: false, done_at: null, actual_min: null });
    ['version', 'updated_at', 'updated_by', '_unsaved', '_failed'].forEach(k => delete part[k]);
    if (S.partialBusy) return; S.partialBusy = true; // V26.181 : une seule réception partielle à la fois
    try {
      try { await saveInsert('tasks', [part]); } catch (e) { return; }
      // V26.181 : si le reste ne peut pas être réduit d'autant (conflit, réseau), la part reçue est retirée — sinon le dossier serait compté deux fois
      const cut = await saveUpdate('tasks', base.id, { duration_min: total - r.minutes, part: 'reste', alloc: null }, { quiet: true });
      if (cut !== 'ok') { await saveUpdate('tasks', part.id, { duration_min: 0, done: true, done_at: nowStamp(), part: null }, { quiet: true }).catch(() => { }); if (isAdmin()) await saveRemove('tasks', part.id); toast('Réception partielle non enregistrée (le dossier a été modifié en même temps). Réessayez.', 'warn'); return; }
    } finally { S.partialBusy = false; }
    await saveUpdate('productions', pid, { partial_date: r.date, status: 'partiel' }, { history: { action: 'reception_partielle', entity: 'production', entity_id: pid, client_id: p.client_id, detail: { date: r.date, text: E.fmtMin(r.minutes) + ' reçus · reste attendu ' + E.fmtMin(total - r.minutes) } } });
    const res = runPlan(p.month, 'incremental', new Set([pid]));
    await applyPlan(res);
    const t = S.data.tasks.get(part.id);
    toast('Réception partielle enregistrée : ' + E.fmtMin(r.minutes) + ' planifiés' + (t && t.planned_date ? ' le ' + fDM(t.planned_date) : '') + ', reste ' + E.fmtMin(total - r.minutes) + ' attendu.', 'ok');
  }

  /* Congés et absences saisis par le collaborateur lui-même (information pour la planification, sans validation) */
  function absenceForm(cid) {
    return '<div class="form" style="margin-top:10px"><label class="f"><span>Du</span><input type="date" id="abs-from"></label><label class="f"><span>Au</span><input type="date" id="abs-to"></label>'
      + '<label class="f"><span>Type</span><select id="abs-kind">' + ABS_KINDS.map(k => '<option value="' + k[0] + '">' + k[1] + '</option>').join('') + '</select></label>'
      + absPartField() + '<label class="f"><span>Précision (ex. séminaire, réunion d\'équipe)</span><input type="text" id="abs-note" placeholder="Formation TVA, réunion interne…"></label></div>'
      + '<div class="row" style="margin-top:8px"><button class="btn primary" data-act="abs-add" data-id="' + cid + '">+ Ajouter</button><span class="small muted">Les dossiers prévus ces jours-là sont replacés automatiquement.</span></div>';
  }
  function myAbsenceCard() {
    const cid = S.me.collaborator_id; if (!cid) return '';
    const abs = list('absences').filter(a => a.collaborator_id === cid && (a.date_to || a.date_from) >= today()).sort((a, b) => a.date_from.localeCompare(b.date_from));
    return '<div class="card"><div class="card-h"><h2>Mes congés et absences</h2><span class="small muted">à titre informatif, pour que rien ne soit planifié ces jours-là</span></div>'
      + (abs.length ? '<table class="t"><tbody>' + abs.map(a => '<tr><td>' + esc(absLabel(a)) + '</td><td>' + fDMY(a.date_from) + (a.date_to !== a.date_from ? ' → ' + fDMY(a.date_to) : '') + '</td><td class="small muted">' + esc(a.note || '') + '</td><td class="num"><button class="btn sm danger" data-act="abs-del" data-id="' + a.id + '">✕</button></td></tr>').join('') + '</tbody></table>' : '<div class="empty">Aucun congé à venir.</div>')
      + absenceForm(cid) + '</div>';
  }
  /* Après une absence : les dossiers prévus ces jours-là sont retirés puis replacés (le reste du planning ne bouge pas) */
  /* V26.211 — Tâches posées un jour où la personne n'est plus disponible (école, jour non travaillé, absence) :
   * retirées de ce jour (et déverrouillées), puis replacées par le planificateur. */
  async function replanOffDays(cid, quiet) {
    const c = collabOf(cid); if (!c || S.readonly) return 0;
    const x = ctx(), td = today();
    const hit = list('tasks').filter(t => t.collaborator_id === cid && !t.done && t.planned_date && canEditTask(t) && E.segs(t).some(s => s.d >= td && E.capacityOn(c, s.d, x, true) <= 0));
    if (!hit.length) return 0;
    await saveMany('tasks', hit.map(t => ({ id: t.id, patch: { planned_date: null, alloc: null, seq: 0, locked: false } })));
    for (const m of new Set(hit.map(t => t.month))) await applyPlan(runPlan(m, 'incremental', new Set(hit.filter(t => t.month === m).map(t => t.production_id).filter(Boolean))));
    if (!quiet) toast(hit.length + ' tâche' + (hit.length > 1 ? 's' : '') + ' de ' + c.name + ' replacée' + (hit.length > 1 ? 's' : '') + ' : elle' + (hit.length > 1 ? 's' : '') + ' étai' + (hit.length > 1 ? 'ent' : 't') + ' prévue' + (hit.length > 1 ? 's' : '') + ' un jour où ' + c.name + ' n\'est pas disponible.', 'ok', null, 5000);
    return hit.length;
  }
  async function replanAbsence(cid, from, to) {
    // V26.211 : chaque jour de l'absence, on garde les tâches (même verrouillées) qui tiennent dans le temps restant
    // (demi-journée : la moitié de la journée) ; les autres sont retirées, déverrouillées et replacées.
    const c = collabOf(cid), x = ctx(), own = list('tasks').filter(t => t.collaborator_id === cid && !t.done && canEditTask(t)), out = new Set();
    for (let d = from; d <= to; d = E.addDays(d, 1)) {
      const cap = c ? E.capacityOn(c, d, x, true) : 0; let used = 0;
      own.filter(t => E.onDay(t, d)).sort((a, b) => (a.seq || 0) - (b.seq || 0)).forEach(t => { const m = E.minutesOn(t, d); if (!out.has(t.id) && used + m <= cap) used += m; else out.add(t.id); });
    }
    const hit = own.filter(t => out.has(t.id));
    if (hit.length) await saveMany('tasks', hit.map(t => ({ id: t.id, patch: { planned_date: null, alloc: null, seq: 0, locked: false } })));
    let moved = 0;
    for (const m of new Set(hit.map(t => t.month))) { const r = runPlan(m, 'incremental', new Set(hit.filter(t => t.month === m).map(t => t.production_id).filter(Boolean))); moved += r.moved.length; await applyPlan(r); }
    return hit.length;
  }

