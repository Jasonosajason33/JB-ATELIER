/* =====================================================================
   JB Flow — suite de tests du moteur (V26.45)
   Utilisée par app/tests/moteur.html (navigateur) et par build.js (Cloudflare Pages : la mise en ligne est bloquée si un test échoue).
   ===================================================================== */
(function (root) {
  'use strict';
  root.JBTestSuite = function (E, F) {
  const results = [];
  function test(name, fn) { const checks = []; const expect = (ok, label) => checks.push({ ok: !!ok, label }); try { fn(expect); } catch (e) { checks.push({ ok: false, label: 'Erreur : ' + e.message }); } results.push({ name, checks }); }
  const mk = seed => { let a = seed; const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }; return { rnd, gauss }; };
  const st = Object.assign({}, E.DEFAULT_SETTINGS);
  const collabs = [1, 2, 3, 4, 5].map(i => ({ id: 'c' + i, name: 'C' + i, daily_capacity_min: 420, work_days: [1, 2, 3, 4, 5], active: true }));
  const PROFILES = [['ponctuel', 0, 0.7], ['léger retard', 2, 1.2], ['retard régulier', 5, 1.5], ['variable', 3, 3.5], ['imprévisible', 6, 6]];
  const f1 = v => v.toFixed(2).replace('.', ',');

  /* 1. Apprentissage des réceptions et des temps sur 5 mois de production */
  test('Apprentissage : dates de réception et temps de production', expect => {
    const { rnd, gauss } = mk(12345);
    const clients = []; for (let i = 0; i < 50; i++) { const p = PROFILES[i % 5]; clients.push({ id: 'k' + i, frequency: 'mensuel', reception_day: 2 + Math.floor(rnd() * 10), time_min: [90, 120, 150, 180, 240][Math.floor(rnd() * 5)], vat_due_day: [19, 21, 24][i % 3], active: true, collaborator_id: 'c' + (1 + i % 5), _p: p, _tf: 0.8 + rnd() * 0.6, _season: i % 3 === 0 ? 5 : 0 }); }
    const samples = []; let eA = 0, eN = 0, early = 0, earlyN = 0, eT = 0, eT0 = 0, n = 0, before = 0;
    for (let m = '2025-04'; m <= '2026-08'; m = E.addMonths(m, 1)) {
      const prod = m >= '2026-04', model = E.learn(samples, clients, st, m + '-01');
      for (const c of clients) {
        const [, mu, sd] = c._p; let d = Math.round(mu + sd * gauss() + (m.endsWith('-08') ? c._season : 0)); d = Math.max(-3, Math.min(20, d));
        const nom = E.dateInMonth(m, c.reception_day), rec = E.addDays(nom, d), t = Math.round(c.time_min * c._tf * (1 + 0.08 * gauss()) / 5) * 5;
        const pr = E.predictReception(model, c, m, st), mm = model.clients.get(c.id), est = (mm && mm.time && mm.time.est) || c.time_min;
        if (prod) { eA += Math.abs(E.daysBetween(pr.date, rec)); eN += Math.abs(E.daysBetween(pr.nominal, rec)); if (pr.date < rec) early++; if (pr.nominal < rec) earlyN++; eT += Math.abs(est - t); eT0 += Math.abs(c.time_min - t); n++; if (pr.date < pr.nominal) before++; }
        samples.push({ client_id: c.id, month: m, source: prod ? 'app' : 'import', nominal: pr.nominal, received: rec, predicted: prod ? pr.date : null, planned: c.time_min, actual: t, collaborator_id: c.collaborator_id });
      }
    }
    expect(eA / n < eN / n * 0.9, 'Écart moyen de réception : agent ' + f1(eA / n) + ' j < date habituelle ' + f1(eN / n) + ' j (−10 % minimum)');
    expect(early / n < earlyN / n / 1.5, 'Tenues prévues avant l\'arrivée des pièces : agent ' + Math.round(early / n * 100) + ' % contre ' + Math.round(earlyN / n * 100) + ' % sans IA');
    expect(eT / n < eT0 / n * 0.7, 'Erreur sur les temps : agent ' + Math.round(eT / n) + ' min < fiche ' + Math.round(eT0 / n) + ' min (−30 % minimum)');
    expect(before === 0, 'Aucune date prévue avant la date habituelle du client (' + before + ')');
  });

  /* 2. Saisonnalité : pas de fausse habitude apprise sur du bruit */
  test('Saisonnalité : détection sans faux positifs', expect => {
    for (const seed of [12345, 999, 4242]) {
      const { rnd, gauss } = mk(seed);
      const clients = []; for (let i = 0; i < 50; i++) { const p = PROFILES[i % 5]; clients.push({ id: 'k' + i, frequency: 'mensuel', reception_day: 2 + Math.floor(rnd() * 10), time_min: 120, active: true, _p: p, _season: i % 3 === 0 ? 5 : 0 }); }
      const samples = []; for (let m = '2024-09'; m <= '2026-08'; m = E.addMonths(m, 1)) for (const c of clients) { const [, mu, sd] = c._p; const d = Math.round(mu + sd * gauss() + (m.endsWith('-08') ? c._season : 0)); const nom = E.dateInMonth(m, c.reception_day); samples.push({ client_id: c.id, month: m, nominal: nom, received: E.addDays(nom, d), planned: 120, actual: 120 }); }
      const md = E.learn(samples, clients, st, '2026-09-01'), aug = clients.filter(c => md.clients.get(c.id).season['08'] != null), total = clients.reduce((s, c) => s + Object.keys(md.clients.get(c.id).season).length, 0);
      const falseAug = aug.filter(c => !c._season).length, trueAug = aug.filter(c => c._season).length, other = total - aug.length;
      expect(falseAug + other <= 10, 'Tirage ' + seed + ' : ' + (falseAug + other) + ' fausse(s) saisonnalité(s) sur 600 mois-dossiers (10 maximum)');
      expect(trueAug >= 6, 'Tirage ' + seed + ' : ' + trueAug + ' dossiers saisonniers en août repérés sur 17 (6 minimum ; clients imprévisibles exclus par prudence)');
    }
  });

  /* 3. Surcharges repérées avant l'échéance */
  test('Surcharges prévues en début de mois (avant l\'échéance)', expect => {
    const { rnd, gauss } = mk(2026), load = [2.3, 2.6, 2.9, 3.2, 3.5];
    const clients = []; for (let i = 0; i < 50; i++) { const p = PROFILES[i % 5], k = i % 5; clients.push({ id: 'k' + i, name: 'D' + i, frequency: 'mensuel', reception_day: 2 + Math.floor(rnd() * 10), time_min: Math.round([90, 120, 150, 180, 240][Math.floor(rnd() * 5)] * load[k] / 5) * 5, vat_due_day: [19, 21, 24][i % 3], priority: 2, active: true, collaborator_id: 'c' + (1 + k), _p: p, _tf: 0.85 + rnd() * 0.5 }); }
    const truth = (c, m) => { const [, mu, sd] = c._p; let d = Math.round(mu + sd * gauss()); d = Math.max(-3, Math.min(15, d)); return { rec: E.addDays(E.dateInMonth(m, c.reception_day), d), t: Math.round(c.time_min * c._tf * (1 + 0.08 * gauss()) / 5) * 5 }; };
    const samples = []; let id = 0; const uid = () => 'x' + (++id); const tot = { R: 0, A: 0, Atp: 0, N: 0, Ntp: 0, lead: [] };
    for (let m = '2025-04'; m <= '2026-08'; m = E.addMonths(m, 1)) {
      const prod = m >= '2026-04', model = E.learn(samples, clients, st, m + '-01'), tr = new Map(clients.map(c => [c.id, truth(c, m)]));
      if (prod) {
        const base = { tasks: [], productions: [], clients, collaborators: collabs, absences: [], settings: st };
        const ai = E.capacityRisk(base, [m], m + '-01', model), nv = E.capacityRisk(base, [m], m + '-01', null);
        const b = E.buildMonth(m, clients, [], st, uid, true); b.tasks.forEach(t => { t.collaborator_id = clients.find(c => c.id === t.client_id).collaborator_id; t.duration_min = tr.get(t.client_id).t; }); b.productions.forEach(p => { p.received_date = tr.get(p.client_id).rec; });
        const real = E.capacityRisk({ tasks: b.tasks, productions: b.productions, clients, collaborators: collabs, absences: [], settings: st }, [m], m + '-01', null);
        const R = new Set(real.risks.map(r => r.collab_id)), A = new Set(ai.risks.map(r => r.collab_id)), N = new Set(nv.risks.map(r => r.collab_id));
        tot.R += R.size; tot.A += A.size; tot.N += N.size; tot.Atp += [...A].filter(x => R.has(x)).length; tot.Ntp += [...N].filter(x => R.has(x)).length;
        ai.risks.forEach(r => tot.lead.push(E.daysBetween(m + '-01', r.due)));
      }
      clients.forEach(c => { const t = tr.get(c.id); samples.push({ client_id: c.id, month: m, source: prod ? 'app' : 'import', nominal: E.dateInMonth(m, c.reception_day), received: t.rec, planned: c.time_min, actual: t.t, collaborator_id: c.collaborator_id }); });
    }
    const rec = tot.Atp / tot.R, prec = tot.A ? tot.Atp / tot.A : 1;
    expect(rec >= 0.8, 'Surcharges repérées par l\'agent : ' + tot.Atp + '/' + tot.R + ' (' + Math.round(rec * 100) + ' %, 80 % minimum) — sans IA : ' + tot.Ntp + '/' + tot.R);
    expect(prec >= 0.7, 'Alertes justes : ' + Math.round(prec * 100) + ' % (70 % minimum)');
    expect(Math.min(...tot.lead) >= 5, 'Délai d\'alerte avant l\'échéance : au moins ' + Math.min(...tot.lead) + ' j (5 j minimum)');
  });

  /* 4. Planificateur : règles de base et performance */
  test('Planificateur : réceptions, échéances et rapidité', expect => {
    const { rnd } = mk(777);
    const clients = Array.from({ length: 50 }, (_, i) => ({ id: 'k' + i, name: 'D' + i, frequency: 'mensuel', reception_day: 2 + Math.floor(rnd() * 10), time_min: [90, 120, 150, 180, 240][Math.floor(rnd() * 5)], vat_due_day: [19, 21, 24][i % 3], priority: 2, active: true, collaborator_id: 'c' + (1 + i % 5) }));
    let id = 0; const uid = () => 'x' + (++id), m = '2026-06';
    const b = E.buildMonth(m, clients, [], st, uid, true); b.tasks.forEach(t => { t.collaborator_id = clients.find(c => c.id === t.client_id).collaborator_id; });
    b.productions.forEach(p => { p.received_date = E.addDays(p.expected_date, Math.round(rnd() * 6 - 1)); p.status = 'recu'; });
    const t0 = performance.now(), r = E.plan({ month: m, collaborators: collabs, clients, productions: b.productions, tasks: b.tasks, absences: [], settings: st, today: m + '-01', mode: 'full' }), ms = performance.now() - t0;
    const ch = new Map(r.changes.map(c => [c.id, c])); let late = 0, before = 0;
    b.tasks.forEach(t => { const c = ch.get(t.id), p = b.productions.find(p => p.id === t.production_id); if (!c || !c.planned_date) return; if (t.due_date && E.endDate(Object.assign({}, t, c)) > t.due_date) late++; if (p && c.planned_date < p.received_date) before++; });
    expect(r.unplanned.length === 0, 'Charge normale : tous les dossiers planifiés (' + r.unplanned.length + ' non planifié)');
    expect(before === 0, 'Aucune tenue planifiée avant la réception des pièces (' + before + ')');
    expect(late === 0, 'Aucune tenue finie après son échéance (' + late + ')');
    expect(ms < 200, 'Calcul du planning de 50 dossiers : ' + Math.round(ms) + ' ms (200 ms maximum)');
  });

  /* 5. Acomptes d'IS */
  test('Acomptes d\'IS : calendrier et montants', expect => {
    expect(F.isSched('2026-12-31').join() === '2026-03-15,2026-06-15,2026-09-15,2026-12-15', 'Clôture 31/12/2026 : 15 mars, juin, septembre, décembre 2026');
    expect(F.isSched('2027-06-30').join() === '2026-09-15,2026-12-15,2027-03-15,2027-06-15', 'Clôture 30/06/2027 : 15 sept. 2026 → 15 juin 2027');
    expect(F.isSched('2027-03-31').join() === '2026-06-15,2026-09-15,2026-12-15,2027-03-15', 'Clôture 31/03/2027 : 15 juin 2026 → 15 mars 2027');
    expect(F.isSched('2027-09-30').join() === '2026-12-15,2027-03-15,2027-06-15,2027-09-15', 'Clôture 30/09/2027 : 15 déc. 2026 → 15 sept. 2027');
    expect(F.isSched('2027-01-31').join() === '2026-03-15,2026-06-15,2026-09-15,2026-12-15', 'Clôture 31/01/2027 : acomptes 2026');
    const r = F.isCalc({ is2: 20000, is1: 40000, m1: 12, m2: 12 });
    expect(r.rows && r.rows.map(x => x[0]).join() === '5000,15000,10000,10000', 'IS N-2 20 000 € / N-1 40 000 € : 5 000, 15 000, 10 000, 10 000 €');
    expect(F.isCalc({ is2: 1000, is1: 2500 }).theo === 0, 'IS N-1 < 3 000 € : aucun acompte');
    expect(F.isCalc({ first: true }).theo === 0, 'Premier exercice : aucun acompte');
    expect(F.isSolde('2026-12-31') === '2027-05-15' && F.isSolde('2027-06-30') === '2027-10-15', 'Solde : 15 mai (clôture 31/12), 15 octobre (clôture 30/06)');
  });
  /* V26.160 — Tableaux de bord : toujours après la période (24, ou jour ouvré suivant) et après la production du dossier */
  test('Tableaux de bord : après la production et après le 24', expect => {
    const m = '2026-10', st = Object.assign({}, E.DEFAULT_SETTINGS), win = E.windowOf(m, st);
    const col = { id: 'k1', name: 'A', daily_capacity_min: 420, work_days: [1, 2, 3, 4, 5], active: true };
    const cl = (id, rd, tm, dd) => ({ id, name: id, collaborator_id: 'k1', frequency: 'mensuel', reception_day: rd, time_min: tm, vat_due_day: 24, vat_regime: 'ca3_mensuel', priority: 2, active: true, dashboard_freq: 'mensuel', dashboard_min: 60, dashboard_day: dd });
    const clients = [cl('X', 20, 600, 25), cl('Y', 1, 120, 28)];
    const productions = [{ id: 'pX', client_id: 'X', month: m, expected_date: m + '-20', received_date: m + '-20' }, { id: 'pY', client_id: 'Y', month: m, expected_date: m + '-01', received_date: m + '-01' }];
    const task = (id, pid, c, kind, dur, due) => ({ id, production_id: pid, client_id: c, month: m, kind, collaborator_id: 'k1', duration_min: dur, due_date: due, received_date: m + '-01', locked: false, done: false });
    const tasks = [task('tX', 'pX', 'X', 'production', 600, m + '-24'), task('tY', 'pY', 'Y', 'production', 120, m + '-24'), task('dX', null, 'X', 'dashboard', 60, m + '-26'), task('dY', null, 'Y', 'dashboard', 60, m + '-28')];
    const r = E.plan({ month: m, collaborators: [col], clients, productions, tasks, absences: [], settings: st, today: m + '-01', mode: 'full' });
    const ch = id => r.changes.find(c => c.id === id) || {}, end = id => { const c = ch(id); return c.alloc ? Object.keys(c.alloc).sort().pop() : c.planned_date; };
    expect(ch('dX').planned_date > win.end && ch('dY').planned_date > win.end, 'Tableaux de bord planifiés après la fin de période (' + win.end + ') : ' + ch('dX').planned_date + ', ' + ch('dY').planned_date);
    expect(ch('dX').planned_date > end('tX') && ch('dY').planned_date > end('tY'), 'Chaque tableau de bord après la production de son dossier');
    expect(!r.unplanned.length, 'Aucune tâche laissée non planifiée');
  });
  /* 6. V26.109 — Simulation grandeur nature : 100 dossiers × 24 mois, jour par jour, avec et sans réaffectations proposées */
  test('Simulation 24 mois : 100 dossiers, cohérence du planning', expect => {
    const run = withRebalance => {
      const { rnd } = mk(42), pick = a => a[Math.floor(rnd() * a.length)];
      let id = 0; const nid = () => 'x' + (++id);
      const S = Object.assign({}, E.DEFAULT_SETTINGS), bad = {}; const flag = k => { bad[k] = (bad[k] || 0) + 1; };
      const team = []; for (let i = 0; i < 6; i++) team.push({ id: 'c' + i, name: 'Collab' + i, kind: 'collab', daily_capacity_min: pick([420, 420, 390, 360]), work_days: i === 5 ? [1, 2, 3, 4] : [1, 2, 3, 4, 5], active: true });
      team.push({ id: 'rc', name: 'RC', kind: 'rc', daily_capacity_min: 420, work_days: [1, 2, 3, 4, 5], active: true }); team[0].rc_id = 'rc'; team[1].rc_id = 'rc';
      const pres = []; for (let d = '2026-09-01'; d <= '2028-12-31'; d = E.addDays(d, 1)) if ([1, 2, 3].includes(E.dow(d))) pres.push(d);
      const presSet = new Set(pres);
      team.push({ id: 'ap', name: 'Apprenti', kind: 'apprenti', tutor_id: 'c0', presence_dates: pres, daily_capacity_min: 420, work_days: [1, 2, 3, 4, 5], active: true });
      const byC = new Map(team.map(c => [c.id, c]));
      const absences = []; for (let k = 0; k < 40; k++) { const c = pick(team.slice(0, 7)), s0 = E.addDays('2026-10-01', Math.floor(rnd() * 700)); absences.push({ id: nid(), collaborator_id: c.id, date_from: s0, date_to: E.addDays(s0, Math.floor(rnd() * 5)), kind: 'conge', minutes: rnd() < .2 ? 180 : null }); }
      const clients = [], profile = {};
      for (let j = 0; j < 100; j++) {
        const freq = rnd() < .78 ? 'mensuel' : rnd() < .8 ? 'trimestriel' : 'annuel';
        const c = { id: 'd' + j, name: 'DOSSIER ' + j, collaborator_id: 'c' + (j % 6), frequency: freq, reception_day: pick([5, 5, 10, 10, 15, 20]), time_min: pick([30, 45, 60, 90, 120, 150, 180, 240, 300, 330, 390, 480, 600]), vat_regime: freq === 'mensuel' ? 'ca3_mensuel' : freq === 'trimestriel' ? 'ca3_trimestriel' : pick(['ca12', 'aucun']), vat_due_day: pick([19, 21, 21, 24, 24]), deb: rnd() < .08, des: rnd() < .08, priority: pick([1, 2, 2, 3]), active: j < 97, apprenti: j % 17 === 0, production_by: j % 13 === 1 ? 'rc' : 'collab' };
        clients.push(c); profile[c.id] = pick(['reg', 'reg', 'var', 'late']);
      }
      const byId = new Map(clients.map(c => [c.id, c]));
      const doer = c => { const co = byC.get(c.collaborator_id), base = c.production_by === 'rc' && co && co.rc_id ? co.rc_id : c.collaborator_id; if (c.apprenti) { const ap = team.find(x => x.kind === 'apprenti' && (x.tutor_id === base || x.tutor_id === c.collaborator_id)); if (ap) return ap.id; } return base; };
      let productions = [], tasks = []; const samples = [], relances = []; let capIssues = 0, dossiers = 0, planned = 0, reaff = 0;
      const ctx = E.makeCtx({ absences, settings: S });
      for (let m = '2026-10', n = 0; n < 24; n++, m = E.addMonths(m, 1)) {
        const win = E.windowOf(m, S); if (!E.isWorkday(win.end)) flag('fin de période non ouvrée');
        const model = E.learn(samples, clients, S, E.addDays(m + '-01', -1), relances);
        const b = E.buildMonth(m, clients, productions, S, nid, true);
        b.tasks.forEach(t => { t.collaborator_id = doer(byId.get(t.client_id)); if (!E.isWorkday(t.due_date)) flag('échéance non ouvrée'); });
        b.productions.forEach(p => {
          const c = byId.get(p.client_id); if (c.active === false) flag('dossier inactif généré');
          const pr = E.predictReception(model, c, m, S); if (pr.date < pr.nominal) flag('prévision avant la date habituelle'); if (!E.isWorkday(pr.date)) flag('prévision un jour non ouvré');
          p.expected_date = pr.date; const pf = profile[c.id];
          let delay = pf === 'reg' ? Math.floor(rnd() * 3) : pf === 'var' ? Math.floor(rnd() * 7) : 4 + Math.floor(rnd() * 12); if (m.slice(5) === '12' && pf !== 'reg') delay += 3;
          p._real = E.nextWorkday(E.addDays(p.nominal_date, delay));
        });
        productions = productions.concat(b.productions); tasks = tasks.concat(b.tasks); dossiers += b.productions.length;
        const taskById = new Map(tasks.map(x => [x.id, x])), monthTasks = tasks.filter(x => x.month === m);
        const prodById = new Map(productions.map(p => [p.id, p]));
        const data = today => ({ month: m, collaborators: team, clients, productions, tasks, absences, settings: S, today });
        const apply = res => res.changes.forEach(ch => { const t = taskById.get(ch.id); t.planned_date = ch.planned_date; t.seq = ch.seq; t.alloc = ch.alloc || null; });
        apply(E.plan(Object.assign(data(win.start), { mode: 'full', freezeUntil: win.start })));
        for (let d = win.start; d <= E.addDays(win.end, 6); d = E.addDays(d, 1)) {
          const newly = new Set(); productions.forEach(p => { if (p.month === m && !p.received_date && p._real === d) { p.received_date = d; newly.add(p.id); } });
          productions.forEach(p => { if (p.month === m && !p.received_date && E.daysBetween(p.expected_date, d) === 3) relances.push({ client_id: p.client_id, month: m, date: d }); });
          if (d <= win.end) {
            apply(E.plan(Object.assign(data(d), { mode: 'incremental', newlyReceived: newly, freezeUntil: E.freezeEnd(d, S.freeze_days) })));
            if (withRebalance) E.rebalance(data(d), m, d).forEach(pp => { const t = taskById.get(pp.task_id); if (byC.get(pp.to).kind === 'apprenti') flag('réaffectation vers un apprenti'); if (pp.end > pp.due) flag('réaffectation après l\'échéance'); t.collaborator_id = pp.to; t.planned_date = pp.date; t.alloc = pp.alloc; reaff++; });
            // contrôles du planning du jour
            const load = {};
            tasks.forEach(t => {
              if (t.month !== m || !t.planned_date) return;
              const co = byC.get(t.collaborator_id), p = prodById.get(t.production_id), segs = E.segs(t);
              segs.forEach(s => {
                if (!E.isWorkday(s.d)) flag('tâche un jour non ouvré');
                if (!t.done && co && E.capacityOn(co, s.d, ctx) <= 0) flag('tâche un jour sans capacité');
                if (!t.done && co && co.kind === 'apprenti' && !presSet.has(s.d)) flag('apprenti hors présence');
                if (!t.done && s.d < (p.received_date || p.expected_date)) flag('tâche avant l\'arrivée des pièces');
                if (!t.done && s.d > win.end) flag('tâche après la fin de période');
                if (!t.done && s.d >= d) { const k = t.collaborator_id + '|' + s.d; load[k] = (load[k] || 0) + s.m; }
              });
              if (E.hasAlloc(t)) { const sum = Object.values(t.alloc).reduce((a, v) => a + v, 0); if (sum !== Number(t.duration_min)) flag('répartition fausse'); if (co && t.duration_min <= co.daily_capacity_min && segs.length > 2) flag('plus de 2 parties'); }
            });
            Object.keys(load).forEach(k => { const [cid, dd] = k.split('|'); if (load[k] > E.capacityOn(byC.get(cid), dd, ctx) + 1) flag('journée surchargée'); });
          }
          monthTasks.forEach(t => { if (t.done || !t.planned_date || E.endDate(t) !== d) return; const p = prodById.get(t.production_id); if (!p.received_date) return; t.done = true; t.actual_min = Math.round(t.duration_min * (0.8 + rnd() * .5)); samples.push({ client_id: t.client_id, month: m, nominal: p.nominal_date, received: p.received_date, predicted: p.expected_date, planned: t.duration_min, actual: t.actual_min, collaborator_id: t.collaborator_id, source: 'sim' }); });
        }
        tasks.forEach(t => { if (t.month !== m || t.done) return; const p = prodById.get(t.production_id), rec = p.received_date || p._real; if (rec <= t.due_date && E.daysBetween(rec, t.due_date) > 1 && (!t.planned_date || E.endDate(t) > t.due_date)) capIssues++; if (t.planned_date) planned++; });
        const db = E.dashboard({ tasks, productions, clients, collaborators: team, absences, settings: S }, m, win.end), nP = productions.filter(p => p.month === m).length;
        if (db.productions.total !== nP || db.productions.done > db.productions.total) flag('compteurs du pilotage incohérents');
        const seen = new Set(); productions.filter(p => p.month === m).forEach(p => { if (seen.has(p.client_id)) flag('doublon client/mois'); seen.add(p.client_id); });
      }
      const model = E.learn(samples, clients, S, '2028-10-01', relances), pr = model.precision;
      const agent = pr.reduce((s, x) => s + x.agent * x.n, 0) / Math.max(1, pr.reduce((s, x) => s + x.n, 0)), naive = pr.reduce((s, x) => s + x.naive * x.n, 0) / Math.max(1, pr.reduce((s, x) => s + x.n, 0));
      return { bad, capIssues, dossiers, reaff, agent, naive };
    };
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const a = run(false), b = run(true), ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    const list = o => Object.keys(o).map(k => k + ' ×' + o[k]).join(', ');
    expect(!Object.keys(a.bad).length, 'Sans réaffectation : ' + a.dossiers + ' dossiers mensuels, aucune anomalie de planning' + (Object.keys(a.bad).length ? ' — ' + list(a.bad) : ''));
    expect(!Object.keys(b.bad).length, 'Avec les réaffectations proposées (' + b.reaff + ' appliquées) : aucune anomalie' + (Object.keys(b.bad).length ? ' — ' + list(b.bad) : ''));
    expect(b.capIssues <= Math.max(3, Math.round(a.capIssues * 0.25)), 'Retards dus à la charge : ' + a.capIssues + ' sans réaffectation → ' + b.capIssues + ' avec (−75 % minimum)');
    expect(a.agent < a.naive, 'Précision de l\'agent sur 6 mois : ' + f1(a.agent) + ' j d\'écart contre ' + f1(a.naive) + ' j sans agent');
    expect(ms < 20000, 'Durée des deux simulations : ' + (ms / 1000).toFixed(1) + ' s (20 s maximum)');
  });
  return results;
  };
})(typeof window !== 'undefined' ? window : globalThis);
