  /* ====================== V26.44 : Indicateurs clés (adoption, engagement, planification, IA) ======================
   * Calculés à partir de l'historique déjà enregistré dans la base : aucun outil externe, aucune donnée envoyée ailleurs. */
  function kpiHistory() {
    if (!S.kpiHist || Date.now() - (S.kpiAt || 0) > 300000) {
      S.kpiAt = Date.now(); if (!S.kpiHist) S.kpiHist = 'loading';
      S.store.loadHistory({ limit: 5000 }).then(h => { S.kpiHist = h; scheduleRender(); }).catch(() => { S.kpiHist = []; scheduleRender(); });
    }
    return Array.isArray(S.kpiHist) ? S.kpiHist : null;
  }
  const pctOf = (a, b) => (b ? Math.round(a / b * 100) : null);
  function workdaysBetween(a, b) { if (!a || !b) return null; let n = 0; const s = a < b ? a : b, e = a < b ? b : a; for (let d = s; d < e; d = E.addDays(d, 1)) if (E.isWorkday(d)) n++; return a <= b ? n : -n; }
  function computeKpis(h) {
    const td = today(), d28 = E.addDays(td, -28), d56 = E.addDays(td, -56), day = x => atDay(x.at);
    const inP = (x, from, to) => day(x) > from && day(x) <= to;
    const users = list('app_users').filter(u => u.active !== false), nUsers = users.length || 1;
    const conn = h.filter(x => x.action === 'connexion');
    // Adoption : utilisateurs actifs sur 7 jours / utilisateurs invités
    const active7 = new Set(conn.filter(x => day(x) > E.addDays(td, -7)).map(x => (x.user_email || '').toLowerCase())).size;
    const active7p = new Set(conn.filter(x => inP(x, E.addDays(td, -14), E.addDays(td, -7))).map(x => (x.user_email || '').toLowerCase())).size;
    // Engagement : jours actifs par semaine et par utilisateur actif (4 semaines)
    const eng = (from, to) => { const by = new Map(); conn.filter(x => inP(x, from, to)).forEach(x => { const k = (x.user_email || '').toLowerCase(); if (!by.has(k)) by.set(k, new Set()); by.get(k).add(day(x)); }); return by.size ? [...by.values()].reduce((s, v) => s + v.size, 0) / by.size / 4 : null; };
    // Temps de planification : réception déclarée → début planifié de la tenue (jours ouvrés), et interventions manuelles par dossier
    const plan = (from, to) => { const v = []; h.filter(x => x.action === 'reception' && inP(x, from, to) && x.entity_id).forEach(x => { const t = list('tasks').find(t => t.production_id === x.entity_id && t.kind === 'production'); const r = (x.detail && x.detail.date) || day(x); if (t && t.planned_date) v.push(Math.max(0, workdaysBetween(r, t.planned_date))); }); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const manual = (from, to) => { const n = h.filter(x => ['deplacement', 'changement_collaborateur'].includes(x.action) && inP(x, from, to)).length, p = h.filter(x => x.action === 'reception' && inP(x, from, to)).length; return p ? n / p : null; };
    // Temps réels ajustés et tenue avant échéance (tâches terminées sur la période)
    const doneIn = (from, to) => list('tasks').filter(t => t.done && t.kind === 'production' && t.done_at && t.done_at.slice(0, 10) > from && t.done_at.slice(0, 10) <= to);
    const adj = (from, to) => { const ts = doneIn(from, to); return ts.length ? pctOf(ts.filter(t => Number(t.actual_min) > 0 && Number(t.actual_min) !== Number(t.duration_min)).length, ts.length) : null; };
    const ontime = (from, to) => { const ts = doneIn(from, to).filter(t => t.due_date); return ts.length ? pctOf(ts.filter(t => t.done_at.slice(0, 10) <= t.due_date).length, ts.length) : null; };
    // Surcharges vues à l'avance : dossiers finis (ou encore ouverts) après l'échéance, signalés au moins 5 jours avant
    const flagged = new Map(h.filter(x => x.action === 'alerte_surcharge' && x.detail).map(x => [x.detail.production_id, x.detail.flagged || day(x)]));
    const lateTasks = list('tasks').filter(t => t.kind === 'production' && t.due_date && t.due_date > E.addDays(td, -90) && ((t.done && t.done_at && t.done_at.slice(0, 10) > t.due_date) || (!t.done && t.due_date < td)));
    const seen = lateTasks.filter(t => { const f = flagged.get(t.production_id); return f && E.daysBetween(f, t.due_date) >= 5; }).length;
    const md = agentOn() ? agentModel() : null, dr = md && md.drift, tp = md && md.timePrecision && md.timePrecision.length ? md.timePrecision[md.timePrecision.length - 1] : null;
    const f1 = v => v.toFixed(1).replace('.', ',');
    return [
      { label: 'Temps moyen de planification', nf: 'n1| j ouvrés', val: plan(d28, td), prev: plan(d56, d28), target: 2, good: 'low', fmt: v => f1(v) + ' j ouvrés', foot: 'entre la réception des pièces et le début planifié de la tenue', rule: 'Au-delà de 2 j : vérifier la charge des collaborateurs concernés (Surcharges prévues).' },
      { label: 'Interventions manuelles', nf: 'n2| / dossier', val: manual(d28, td), prev: manual(d56, d28), target: .5, good: 'low', fmt: v => v.toFixed(2).replace('.', ',') + ' / dossier', foot: 'déplacements et changements de collaborateur par dossier reçu', rule: 'Au-delà de 0,5 : le planning automatique est trop souvent corrigé, revoir les temps et priorités des dossiers.' },
      { label: 'Adoption', pct: true, val: pctOf(active7, nUsers), prev: pctOf(active7p, nUsers), target: 80, good: 'high', fmt: v => v + ' %', foot: active7 + ' utilisateur(s) actif(s) sur 7 jours / ' + users.length, rule: 'Sous 80 % : relancer les utilisateurs inactifs, proposer une prise en main de 15 minutes.' },
      { label: 'Engagement', nf: 'n1| j / semaine', val: eng(d28, td), prev: eng(d56, d28), target: 3, good: 'high', fmt: v => f1(v) + ' j / semaine', foot: 'jours actifs par semaine et par utilisateur actif', rule: 'Sous 3 j : l\'outil n\'est pas encore le réflexe quotidien — mettre en avant la page Aujourd\'hui.' },
      { label: 'Temps réels ajustés', pct: true, val: adj(d28, td), prev: adj(d56, d28), target: 50, good: 'high', fmt: v => v + ' %', foot: 'tâches terminées dont le temps réel diffère du prévu (carburant de l\'IA)', rule: 'Sous 50 % : les temps sont validés sans être ajustés, l\'IA apprend moins — un rappel s\'affiche aux collaborateurs.' },
      { label: 'Précision réception', nf: 'n1| j d\'écart', val: dr && dr.last !== null && dr.last !== undefined ? dr.last : null, prev: dr ? dr.prev : null, target: dr && dr.naive ? dr.naive * .8 : null, good: 'low', fmt: v => f1(v) + ' j d\'écart', foot: dr && dr.naive !== null && dr.naive !== undefined ? 'date habituelle seule : ' + f1(dr.naive) + ' j (4 dernières semaines)' : '4 dernières semaines', rule: 'Si l\'agent n\'est pas meilleur de 20 % que la date habituelle : vérifier les réceptions déclarées en retard.' },
      { label: 'Précision des temps', nf: 'n0| %|± ', val: tp ? Math.round(tp.err * 100) : null, prev: null, target: 15, good: 'low', fmt: v => '± ' + v + ' %', foot: 'écart moyen entre temps prévu et temps réel (dernier mois)', rule: 'Au-delà de 15 % : accepter les temps proposés par l\'agent dans la fiche des dossiers.' },
      { label: 'Surcharges vues à l\'avance', pct: true, val: lateTasks.length ? pctOf(seen, lateTasks.length) : null, prev: null, target: 90, good: 'high', fmt: v => v + ' %', foot: lateTasks.length ? seen + ' sur ' + lateTasks.length + ' dossier(s) en retard signalé(s) au moins 5 j avant (90 jours)' : 'aucun dossier en retard sur 90 jours', rule: 'Sous 90 % : compléter l\'historique (temps réels, réceptions) pour affiner les prévisions.' },
      { label: 'Tenue avant échéance', pct: true, val: ontime(d28, td), prev: ontime(d56, d28), target: 95, good: 'high', fmt: v => v + ' %', foot: 'dossiers terminés avant leur échéance TVA (28 jours)', rule: 'Sous 95 % : traiter la section Surcharges prévues du Pilotage en priorité.' }
    ];
  }
  /* V26.60 : indicateurs repliables et anneau pour les valeurs en % */
  const kpiFolded = () => { try { return JSON.parse(lsGet('planif-kpi-fold') || '[]'); } catch (e) { return []; } };
  function kpiRing(v, st, key) {
    const C = 2 * Math.PI * 30, p = Math.max(0, Math.min(100, v)), id = 'krg' + (key || '');
    return '<div class="kpi-ring ' + st + '"><svg viewBox="0 0 72 72" width="112" height="112"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="ka"/><stop offset="1" class="kb"/></linearGradient></defs><circle cx="36" cy="36" r="30" class="t"/><circle cx="36" cy="36" r="30" class="p" stroke="url(#' + id + ')" style="--C:' + C.toFixed(1) + ';--off:' + (C * (1 - p / 100)).toFixed(1) + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - p / 100)).toFixed(1) + '"/></svg><b data-count="' + Math.round(v) + '" data-fmt="pct" data-key="' + (key || '') + '">' + Math.round(v) + ' %</b></div>';
  }  function vKpi() {
    if (!isManager()) return '<div class="empty">Réservé aux managers.</div>';
    const h = kpiHistory();
    if (!h) return '<div class="empty">Calcul des indicateurs…</div>';
    const ks = computeKpis(h), has = v => v !== null && v !== undefined;
    const status = k => !has(k.val) || !has(k.target) ? '' : (k.good === 'high' ? k.val >= k.target : k.val <= k.target) ? 'g' : 'r';
    const trend = k => { if (!has(k.val) || !has(k.prev)) return ''; const up = k.val > k.prev, better = k.good === 'high' ? up : !up; return k.val === k.prev ? '<span class="delta flat">stable</span>' : '<span class="delta ' + (better ? 'up' : 'down') + '">' + (up ? '↑' : '↓') + ' vs 4 sem. précédentes</span>'; };
    return pilotTabs() + '<div class="notice info small" style="margin-bottom:var(--gap)">Indicateurs calculés à partir de l\'historique de l\'outil (aucune donnée envoyée à l\'extérieur). Période : 4 dernières semaines, comparées aux 4 précédentes.</div>'
      + '<div class="grid g3 kpi-page">' + ks.map((k, i) => {
        const folded = kpiFolded().includes(k.label), st = status(k), val = has(k.val) ? k.fmt(k.val) : '—';
        const big = k.pct && has(k.val) ? kpiRing(k.val, st, 'kr' + i) : '<div class="v">' + (has(k.val) && k.nf ? '<span data-count="' + k.val + '" data-fmt="' + k.nf + '" data-key="kv' + i + '">' + val + '</span>' : val) + '</div>';
        return '<div class="kpi anim-in' + (folded ? ' kpi-folded' : '') + '" style="--i:' + i + '"><div class="kpi-h"><span class="ibox ' + st + '">' + ic(st === 'r' ? 'alert' : 'check', 'sm') + '</span>' + k.label + (folded ? ' <b class="kf-v">' + val + '</b>' : '') + '<button class="kpi-fold" data-act="kpi-fold" data-k="' + esc(k.label) + '" title="' + (folded ? 'Déplier' : 'Réduire') + '" aria-label="' + (folded ? 'Déplier' : 'Réduire') + ' l\'indicateur">' + ic('chevR', 'sm') + '</button></div>'
          + (folded ? '' : big + '<div class="foot">' + k.foot + '</div><div class="foot">' + (has(k.target) ? 'Cible : ' + (k.good === 'high' ? '≥ ' : '≤ ') + k.fmt(k.target) : '') + ' ' + trend(k) + '</div>' + (st === 'r' ? '<div class="small" style="margin-top:6px;color:var(--bad)">' + k.rule + '</div>' : '')) + '</div>';
      }).join('') + '</div>';
  }
  /* V26.44 (M8) : migrations Supabase manquantes, signalées à l'administrateur */
  const MIGRATIONS = ['1.7', '1.8', '1.9', '1.10', '1.11', '1.12', '1.13', '1.14', '1.15', '1.16', '1.17', '1.18', '1.19', '1.20', '1.21'];
  async function checkMigrations() {
    if (!isAdmin() || S.store.mode !== 'supabase' || !S.store.schemaVersions) return;
    const vs = await S.store.schemaVersions();
    S.migMissing = vs === null ? ['1.13'] : MIGRATIONS.filter(v => !vs.includes(v));
    scheduleRender();
  }
  function migNotice() {
    if (!isAdmin() || !S.migMissing || !S.migMissing.length) return '';
    return '<div class="notice warn" style="margin-bottom:var(--gap)"><b>Base de données à mettre à jour.</b> Exécutez dans Supabase › SQL Editor, dans cet ordre : ' + S.migMissing.map(v => '<code>supabase/migration_v' + v.replace('.', '_') + '.sql</code>').join(', ') + '. Rechargez ensuite la page.</div>';
  }
  /* Une connexion par jour et par utilisateur : sert à mesurer l'adoption et l'engagement */
  function logDailyConnexion() {
    if (!S.me || S.readonly) return;
    const k = 'planif-connexion:' + (S.me.email || '').toLowerCase(); if (lsGet(k) === today()) return;
    lsSet(k, today()); S.store.logHistory([{ action: 'connexion', detail: { date: today() } }]).catch(() => { });
  }
  /* V26.44 (M6) : rappel de saisie du temps réel quand les temps sont validés sans être ajustés */
  function timeReminder(cid) {
    const from = E.addDays(today(), -60), ts = list('tasks').filter(t => t.collaborator_id === cid && t.done && t.kind === 'production' && t.done_at && t.done_at.slice(0, 10) > from);
    if (ts.length < 8 || lsGet('planif-time-tip') === today().slice(0, 7)) return '';
    const same = ts.filter(t => !(Number(t.actual_min) > 0) || Number(t.actual_min) === Number(t.duration_min)).length;
    if (same / ts.length < .8) return '';
    return '<div class="sg-tip anim-in">' + ic('clock') + '<span class="t">Sur tes ' + ts.length + ' derniers dossiers, le temps réel est presque toujours celui prévu. Indique le temps vraiment passé en terminant : ton planning s\'ajustera à ton rythme réel.</span><button class="btn sm" data-act="time-tip-ok">OK</button></div>';
  }
  function histRows(hs) {
    const sm = startMonth(), s0 = sm ? sm + '-01' : ''; // V26.168 : rien avant le début d'utilisation
    hs = histMine(hs).filter(h => h.action !== 'connexion' && h.action !== 'alerte_surcharge' && (!sm || (atDay(h.at) >= s0 && !(h.detail && /^\d{4}-\d{2}$/.test(h.detail.month || '') && h.detail.month < sm))));
    if (!hs.length) return '<div class="empty">Aucun événement.</div>';
    return '<div class="hist">' + hs.map(h => '<div><b>' + (ACTION_LABEL[h.action] || esc(h.action)) + '</b>' + (h.client_id && clientOf(h.client_id) ? ' — ' + esc(clientOf(h.client_id).name) : '') + ' <span class="muted">' + esc(histDetail(h)) + '</span><br><span class="small muted">' + fDateTime(h.at) + ' · ' + esc(histWho(h)) + '</span></div>').join('') + '</div>';
  }
  function vHistory() {
    if (!S.histCache) { S.histCache = 'loading'; S.store.loadHistory({ limit: 300 }).then(h => { S.histCache = h; scheduleRender(); }).catch(e => { S.histCache = null; toast('Historique indisponible : ' + errMsg(e), 'bad'); }); }
    return '<div class="card"><div class="card-h"><h2>' + (isManager() ? '300 derniers événements' : 'Derniers événements de mes dossiers') + '</h2><button class="btn sm" data-act="hist-reload">⟳</button></div>' + (S.histCache === 'loading' || !S.histCache ? '<div class="empty">Chargement…</div>' : histRows(S.histCache)) + '</div>';
  }

  /* ---------- Vue EXPORT ---------- */
  function vExport() {
    if (S.usage === undefined) { S.usage = null; S.store.usage && S.store.usage().then(u => { S.usage = u; scheduleRender(); }).catch(() => { }); }
    const u = S.usage;
    const usageHtml = S.store.mode === 'supabase' ? (u ? '<div class="load"><div class="nums"><span>Taille de la base : <b>' + (u / 1048576).toFixed(1) + ' Mo</b> / 500 Mo (offre gratuite)</span></div><div class="bar"><i class="lv-' + (u > 400 * 1048576 ? 'red' : u > 250 * 1048576 ? 'orange' : 'green') + '" style="width:' + Math.min(100, u / (500 * 1048576) * 100) + '%"></i></div></div>' : '<p class="muted small">Taille de la base : indisponible.</p>') : '<p class="muted small">Mode démo : les données sont dans ce navigateur uniquement.</p>';
    return '<div class="grid g2"><div class="card"><h2 style="margin-bottom:10px">Planning du mois — ' + fMonth(S.month) + '</h2><div class="row" style="margin-bottom:10px">' + monthNav() + '</div><div class="row">'
      + '<button class="btn" data-act="exp-xlsx">📗 Export Excel</button><button class="btn" data-act="exp-csv">📄 Export CSV</button><button class="btn" data-act="exp-pdf">🖨 Export PDF du planning</button></div>'
      + '<p class="small muted">PDF : ouvre le planning puis la fenêtre d\'impression — choisissez « Enregistrer au format PDF » (sur iPhone : Partager › Imprimer, puis pincer l\'aperçu).</p></div>'
      + '<div class="card"><h2 style="margin-bottom:10px">Sauvegarde complète</h2><p class="small">Récupérez <b>toutes</b> les données (collaborateurs, dossiers, production, tâches, historique) indépendamment du service utilisé.</p><div class="row"><button class="btn primary" data-act="exp-all-json">💾 Exporter toutes les données (JSON)</button><button class="btn" data-act="exp-all-xlsx">📗 Toutes les données (Excel)</button></div>'
      + (isAdmin() ? '<hr style="border:0;border-top:1px solid var(--border);margin:16px 0"><h3>Restaurer une sauvegarde JSON</h3><p class="small muted">Réimporte une sauvegarde (ex. migration vers une autre base). Les lignes existantes de même identifiant sont remplacées.</p><input type="file" accept=".json,application/json" data-ch="restore">' : '')
      + '</div><div class="card"><h2 style="margin-bottom:10px">Stockage</h2>' + usageHtml + '</div></div>';
  }

  /* ---------- Menu mobile « Plus » ---------- */
  function vMore() {
    return '<div class="card"><div class="tasks">' + NAV_FLAT.filter(n => !bottomItems().some(b => b[0] === n[0]) && (!n[3] || isManager()) && navAllowed(n[0])).map(n => '<a class="btn big" style="justify-content:flex-start" href="#/' + n[0] + '">' + ic(n[1]) + n[2] + '</a>').join('')
      + '<button class="btn big" style="justify-content:flex-start" data-act="logout">' + ic('logout') + 'Se déconnecter (' + esc(S.me.name) + ')</button></div></div>';
  }

  /* ---------- Vue PARAMÈTRES ---------- */
  const ACCENTS = [['vert', 'Vert (défaut)', '#14924F'], ['bleu', 'Bleu', '#2563EB'], ['indigo', 'Indigo', '#4F46E5'], ['violet', 'Violet', '#7C3AED'], ['rose', 'Rose', '#DB2777'], ['corail', 'Corail', '#EA580C'], ['turquoise', 'Turquoise', '#0D9488'], ['ardoise', 'Ardoise', '#334155']];
  /* ====================== V26.105 : Diagnostic (administrateur, lecture seule) ====================== */
  const diagCard = () => '<div class="card diag-card"><div class="card-h"><h2>Diagnostic</h2><span class="badge k">' + ic('lock') + 'Administrateur</span></div><p class="small muted" style="margin:0 0 10px">Vérifie en quelques secondes la version de la base, la protection des données (accès sans connexion), le chiffrement des noms, la connexion et la cohérence des données. Rien n\'est modifié.</p><button class="btn primary" data-act="diag-run">' + ic('check', 'sm') + 'Lancer le diagnostic</button></div>';
  async function runDiagnostic() {
    if (!isAdmin()) return;
    openSheet({ type: 'diag', busy: true, wide: true });
    const R = [], add = (lvl, group, title, detail) => R.push({ lvl, group, title, detail });
    let d = { mode: S.store.mode };
    try { d = await S.store.diagnostics(); } catch (e) { add('bad', 'Connexion', 'Diagnostic de la base impossible', errMsg(e)); }
    const demo = d.mode !== 'supabase';
    // 1. Version et migrations
    add('ok', 'Version', 'Application ' + String(CFG.APP_VERSION || '').replace(/^V/i, 'version '), '');
    if (demo) add('info', 'Version', 'Mode démo', 'Pas de base Supabase : les contrôles de sécurité et de chiffrement ne s\'appliquent pas.');
    else {
      const vs = await S.store.schemaVersions();
      const miss = vs ? MIGRATIONS.filter(v => !vs.includes(v)) : null;
      if (!vs) add('bad', 'Version', 'Suivi des migrations absent', 'Exécutez supabase/migration_v1_13.sql puis les suivantes.');
      else if (miss.length) add('bad', 'Version', miss.length + ' migration(s) à exécuter', miss.map(v => 'migration_v' + v.replace('.', '_') + '.sql').join(', '));
      else add('ok', 'Version', 'Base à jour', 'Migrations 1.2 à ' + MIGRATIONS[MIGRATIONS.length - 1] + ' présentes (1.2 à 1.6 incluses dans les suivantes).');
      // 2. Sécurité : accès sans connexion
      const open = (d.anon || []).filter(x => x.open), err = (d.anon || []).filter(x => x.error);
      if (open.length) add('bad', 'Sécurité', open.length + ' table(s) lisible(s) SANS connexion', open.map(x => x.table).join(', ') + ' — exécutez à nouveau supabase/schema.sql (partie « Row Level Security ») ou contactez-moi.');
      else if (err.length === (d.anon || []).length) add('warn', 'Sécurité', 'Test d\'accès sans connexion impossible', 'Le navigateur n\'a pas pu joindre Supabase.');
      else add('ok', 'Sécurité', 'Aucune donnée accessible sans connexion', (d.anon || []).filter(x => !x.missing).length + ' tables testées avec la seule clé publique : toutes fermées.');
      if (/service_role|secret/i.test(String(CFG.SUPABASE_ANON_KEY || ''))) add('bad', 'Sécurité', 'Clé secrète dans config.js', 'Remplacez-la immédiatement par la clé publique (anon / publishable).');
      else add('ok', 'Sécurité', 'Clé publique uniquement dans l\'application', '');
      // 3. Chiffrement
      const cc = cryptoCfg();
      if (!cc) add('warn', 'Chiffrement', 'Chiffrement des noms non activé', 'Paramètres › Sécurité : définissez la phrase secrète du cabinet.');
      else if (d.enc && d.enc.error) add('warn', 'Chiffrement', 'Vérification impossible', d.enc.error);
      else if (d.enc && d.enc.clear) add('bad', 'Chiffrement', d.enc.clear + ' nom(s) de dossier stocké(s) en clair', 'Sur ' + d.enc.n + ' dossiers lus. Ouvrez puis refermez ces dossiers pour les rechiffrer, ou contactez-moi.');
      else add('ok', 'Chiffrement', 'Noms de dossiers chiffrés en base', (d.enc ? d.enc.n : 0) + ' dossiers vérifiés (enc1:…)' + (d.enc && d.enc.notesClear ? ' · ' + d.enc.notesClear + ' particularité(s) en clair' : ''));
      if (!CRYPTO.key && cc) add('warn', 'Chiffrement', 'Phrase secrète non saisie sur cet appareil', 'Les noms ne peuvent pas être lus ici.');
      // 4. Connexion
      add(d.latency > 1500 ? 'warn' : 'ok', 'Connexion', 'Temps de réponse de la base : ' + d.latency + ' ms', d.latency > 1500 ? 'Lent : vérifiez la connexion Internet.' : '');
      add(S.sync === 'live' ? 'ok' : 'warn', 'Connexion', S.sync === 'live' ? 'Temps réel actif' : 'Temps réel inactif', S.sync === 'live' ? 'Les modifications des autres apparaissent automatiquement.' : 'L\'application actualise régulièrement à la place (mode relevé).');
      if (d.size) add(d.size > 400 * 1048576 ? 'warn' : 'ok', 'Connexion', 'Taille de la base : ' + Math.round(d.size / 1048576) + ' Mo sur 500 Mo gratuits', '');
    }
    if (S.failed.length) add('bad', 'Connexion', S.failed.length + ' modification(s) non enregistrée(s)', 'Cliquez sur « Réessayer » dans le bandeau rouge.');
    // 5. Cohérence des données
    const users = list('app_users').filter(u => u.active), cos = collabs(true), act = collabs(), cls = [...S.data.clients.values()], tasks = [...S.data.tasks.values()], prods = [...S.data.productions.values()], td = today();
    const coIds = new Set(cos.map(c => c.id)), clIds = new Set(cls.map(c => c.id)), prIds = new Set(prods.map(p => p.id));
    const noLink = users.filter(u => (u.role === 'collab' || u.role === 'apprenti') && !u.collaborator_id);
    if (noLink.length) add('warn', 'Données', noLink.length + ' utilisateur(s) sans planning lié', noLink.map(u => u.name).join(', ') + ' — Paramètres › Utilisateurs › Collaborateur lié.');
    const aps = act.filter(c => c.kind === 'apprenti');
    aps.filter(c => !c.tutor_id && !c.rc_id).forEach(c => add('warn', 'Données', 'Apprenti sans tuteur ni binôme : ' + c.name, 'Fiche collaborateur › Rattaché à.'));
    aps.filter(c => !(c.presence_dates || []).some(d2 => d2 >= td && d2 <= E.addDays(td, 60))).forEach(c => add('warn', 'Données', 'Apprenti sans jour de présence prévu : ' + c.name, 'Aucun jour en entreprise dans les 60 prochains jours : il ne sera pas planifié.'));
    const noCo = cls.filter(c => c.active !== false && (!c.collaborator_id || !coIds.has(c.collaborator_id)));
    if (noCo.length) add('bad', 'Données', noCo.length + ' dossier(s) actif(s) sans collaborateur', noCo.slice(0, 6).map(c => c.name).join(', '));
    const zero = cls.filter(c => c.active !== false && !(E.clientTime(c) > 0));
    if (zero.length) add('warn', 'Données', zero.length + ' dossier(s) actif(s) avec un temps de production à 0', zero.slice(0, 6).map(c => c.name).join(', ') + ' — aucune tâche ne sera créée.');
    const orphanT = tasks.filter(t => !t.done && (!clIds.has(t.client_id) || (t.production_id && !prIds.has(t.production_id) && t.month >= (S.loadedFrom || '0000')))); // V26.107 : un tableau de bord n'a pas de production (ce n'est pas une anomalie)
    if (orphanT.length) add('bad', 'Données', orphanT.length + ' tâche(s) rattachée(s) à un dossier supprimé', 'Elles n\'apparaissent nulle part ; contactez-moi.');
    const badCo = tasks.filter(t => !t.done && t.collaborator_id && !act.some(c => c.id === t.collaborator_id) && clIds.has(t.client_id) && (clientOf(t.client_id) || {}).active !== false);
    if (badCo.length) add('bad', 'Données', badCo.length + ' tâche(s) confiée(s) à un collaborateur inactif ou supprimé', 'Réaffectez-les (planning ou Pilotage › Propositions).');
    const seen = new Map(); let dup = 0; prods.forEach(p => { const k = p.client_id + '|' + p.month; if (seen.has(k)) dup++; else seen.set(k, 1); });
    if (dup) add('bad', 'Données', dup + ' dossier(s) en double sur un même mois', 'Contactez-moi pour les fusionner.');
    const badDue = tasks.filter(t => !t.done && t.due_date && t.due_date >= td && !E.isWorkday(t.due_date));
    if (badDue.length) add('warn', 'Données', badDue.length + ' échéance(s) à venir un week-end ou un férié', 'Replanifiez le mois concerné pour les reporter au jour ouvré suivant.');
    const hid = tasks.filter(t => !t.done && (clientOf(t.client_id) || {}).active === false).length;
    if (hid) add('info', 'Données', hid + ' tâche(s) ouverte(s) de dossiers inactifs', 'Elles sont masquées partout ; elles réapparaîtront si le dossier est réactivé.');
    if (!R.some(r => r.group === 'Données')) add('ok', 'Données', 'Aucune incohérence détectée', cls.length + ' dossiers, ' + prods.length + ' productions, ' + tasks.length + ' tâches, ' + cos.length + ' collaborateurs contrôlés.');
    // 6. V26.106 : contrôle du planning réel (mêmes règles que la simulation 24 mois), mois en cours et suivant
    (function () {
      const x = ctx(), m0 = defaultMonth(), months = [m0, E.addMonths(m0, 1)], load = {}, pb = {};
      const note = (k, ex) => { (pb[k] = pb[k] || []).push(ex); };
      const ts = tasks.filter(t => months.includes(t.month) && t.planned_date && clIds.has(t.client_id));
      ts.forEach(t => {
        const co = collabOf(t.collaborator_id), c = clientOf(t.client_id) || {}, p = S.data.productions.get(t.production_id) || {};
        const nm = c.name || '?', dur = Number(t.duration_min) || 0, segs = E.segs(t);
        segs.forEach(sg => {
          if (!E.isWorkday(sg.d)) note('Tâche posée un week-end ou un jour férié', nm + ' le ' + fDM(sg.d));
          else if (co && !t.done && sg.d >= td && E.capacityOn(co, sg.d, x) <= 0) note('Tâche posée un jour d\'absence (ou hors présence de l\'apprenti)', nm + ' · ' + co.name + ' le ' + fDM(sg.d));
          const ready = p.received_date || p.partial_date || t.received_date;
          if (!t.done && ready && sg.d < ready) note('Tâche planifiée avant l\'arrivée des pièces', nm + ' le ' + fDM(sg.d) + ' (pièces le ' + fDM(ready) + ')');
          if (!t.done && sg.d >= td && t.collaborator_id) { const k = t.collaborator_id + '|' + sg.d; load[k] = (load[k] || 0) + sg.m; }
        });
        if (E.hasAlloc(t)) {
          const sum = Object.values(t.alloc).reduce((s, v) => s + (Number(v) || 0), 0);
          if (sum !== dur) note('Répartition sur plusieurs jours incohérente', nm + ' (' + E.fmtMin(sum) + ' au lieu de ' + E.fmtMin(dur) + ')');
          if (co && dur <= (Number(co.daily_capacity_min) || 0) && segs.length > 2 && !t.locked) note('Dossier coupé en plus de 2 parties', nm);
        }
        if (!t.done && t.due_date && !E.isWorkday(t.due_date)) note('Échéance un week-end ou un jour férié', nm + ' (' + fDM(t.due_date) + ')');
      });
      Object.keys(load).forEach(k => { const [cid, d] = k.split('|'), co = collabOf(cid); if (!co) return; const cap = E.capacityOn(co, d, x); if (load[k] > cap + 30 && cap > 0) note('Journée chargée au-delà de la capacité', co.name + ' le ' + fDM(d) + ' : ' + E.fmtMin(load[k]) + ' pour ' + E.fmtMin(cap)); });
      const keys = Object.keys(pb);
      if (!keys.length) add('ok', 'Planning', 'Planning conforme aux règles', ts.length + ' tâches contrôlées sur ' + months.map(fMonth).join(' et ') + ' : jours ouvrés, présence, arrivée des pièces, capacité, découpage, échéances.');
      keys.forEach(k => add(/surcharg|au-delà|Échéance/.test(k) ? 'warn' : k.indexOf('avant l\'arrivée') >= 0 || k.indexOf('absence') >= 0 ? 'warn' : 'bad', 'Planning', pb[k].length + ' × ' + k, pb[k].slice(0, 3).join(' · ') + (pb[k].length > 3 ? ' …' : '') + (/au-delà|absence|avant/.test(k) ? ' — souvent un déplacement à la main : replanifiez ou déplacez la tâche.' : /Échéance/.test(k) ? ' — cliquez sur « Replanifier le mois » pour la reporter au jour ouvré suivant.' : '')));
    })();
    // 7. V26.106 : rapidité des écrans principaux sur cet appareil (calcul + mise en page, hors réseau)
    (function () {
      const view = document.getElementById('view'), box = document.createElement('div');
      box.id = 'diag-view'; box.setAttribute('aria-hidden', 'true'); box.style.cssText = 'position:absolute;left:-10000px;top:0;width:' + ((view && view.clientWidth) || 1200) + 'px;visibility:hidden;pointer-events:none';
      document.body.appendChild(box);
      const keep = S.route, res = [];
      [['today', 'Aujourd\'hui'], ['planning', 'Planning'], ['dashboard', 'Pilotage'], ['clients', 'Dossiers'], ['tva', 'TVA & autres impôts'], ['dashboards', 'Dashboard Clients'], ['receptions', 'Réceptions']].forEach(([r, lbl]) => {
        try { S.route = r; const a = performance.now(); box.innerHTML = viewHtml(); void box.offsetHeight; res.push({ lbl, ms: Math.round(performance.now() - a) }); } catch (e) { res.push({ lbl, ms: -1 }); }
      });
      S.route = keep; box.remove();
      const slow = res.filter(r => r.ms > 300), mid = res.filter(r => r.ms > 120 && r.ms <= 300);
      add(slow.length ? 'warn' : 'ok', 'Rapidité', slow.length ? slow.length + ' écran(s) lent(s) sur cet appareil' : 'Écrans rapides sur cet appareil', res.map(r => r.lbl + ' ' + (r.ms < 0 ? 'erreur' : r.ms + ' ms')).join(' · ') + (slow.length ? ' — au-delà de 300 ms, signalez-le-moi.' : mid.length ? ' — correct.' : ' — excellent (moins de 120 ms).'));
    })();
    // 8. V26.110 : page des tests automatiques présente sur le site ?
    try { const r = await fetch('tests/moteur.html', { method: 'HEAD', cache: 'no-store' }); if (r.ok) add('ok', 'Tests', 'Page des tests du moteur disponible', 'Cliquez sur « Lancer les tests du moteur » en bas de cette fenêtre (environ 10 secondes).'); else add('warn', 'Tests', 'Page des tests absente du site en ligne', 'Le dossier app/tests n\'a pas été mis en ligne : déposez le dossier app entier (avec son sous-dossier tests).'); } catch (e) { add('info', 'Tests', 'Présence de la page des tests non vérifiable', ''); }
    // 9. Appareil
    let ls = true; try { localStorage.setItem('planif-diag', '1'); localStorage.removeItem('planif-diag'); } catch (e) { ls = false; }
    add(ls ? 'ok' : 'warn', 'Appareil', ls ? 'Stockage du navigateur disponible' : 'Stockage du navigateur bloqué', ls ? 'Préférences et cache hors ligne fonctionnels.' : 'Navigation privée ou cookies bloqués : préférences non mémorisées.');
    const s = S.sheet; if (s && s.type === 'diag') { s.busy = false; s.res = R; s.at = new Date(); renderSheet(); }
    hist('diagnostic', { detail: { text: 'Diagnostic : ' + R.filter(r => r.lvl === 'bad').length + ' problème(s), ' + R.filter(r => r.lvl === 'warn').length + ' point(s) d\'attention' } });
  }
  const DIAG_IC = { ok: ['check', 'g'], warn: ['alert', 'o'], bad: ['alert', 'r'], info: ['list', 'b'] };
  function sheetDiag(s) {
    const R = s.res || [], nb = R.filter(r => r.lvl === 'bad').length, nw = R.filter(r => r.lvl === 'warn').length;
    const groups = [...new Set(R.map(r => r.group))];
    const summary = s.busy ? '<div class="empty">Diagnostic en cours…</div>' : '<div class="notice ' + (nb ? 'bad' : nw ? 'warn' : 'ok') + '" style="margin-bottom:12px"><b>' + (nb ? nb + ' problème' + (nb > 1 ? 's' : '') + ' à corriger' : nw ? 'Tout fonctionne — ' + nw + ' point' + (nw > 1 ? 's' : '') + ' d\'attention' : 'Tout est en ordre') + '</b></div>';
    const body = groups.map(g => '<div class="diag-g"><h3>' + esc(g) + '</h3>' + R.filter(r => r.group === g).map(r => '<div class="diag-r ' + r.lvl + '"><span class="ibox ' + DIAG_IC[r.lvl][1] + '">' + ic(DIAG_IC[r.lvl][0], 'sm') + '</span><div><b>' + esc(r.title) + '</b>' + (r.detail ? '<div class="small muted">' + esc(r.detail) + '</div>' : '') + (r.group === 'Tests' && r.lvl === 'ok' ? '<a class="small" href="tests/moteur.html" target="_blank" rel="noopener">' + esc(new URL('tests/moteur.html', location.href).href) + '</a>' : '') + '</div></div>').join('') + '</div>').join('');
    return sheetHead('Diagnostic', s.at ? 'Réalisé le ' + fDate(today()) + ' à ' + s.at.toTimeString().slice(0, 5) + ' — lecture seule, rien n\'a été modifié' : 'Lecture seule')
      + '<div class="sheet-b">' + summary + body + '</div>'
      + '<div class="sheet-f"><button class="btn" data-act="diag-copy"' + (s.busy ? ' disabled' : '') + '>' + ic('list', 'sm') + 'Copier le rapport</button><a class="btn" href="tests/moteur.html" target="_blank" rel="noopener" title="Ouvre la page des tests du moteur dans un nouvel onglet (' + esc(new URL('tests/moteur.html', location.href).href) + ')">' + ic('check', 'sm') + 'Lancer les tests du moteur</a><span class="spacer"></span><button class="btn" data-act="diag-run">Relancer</button><button class="btn primary" data-act="close">Fermer</button></div>';
  }
  function vSettings() {    const st = cfg();
    const users = list('app_users').sort(byName);
    const motion = lsGet('planif-motion') || 'always'; // par défaut : animations toujours actives (V26.11)
    const appearance = '<div class="card"><div class="card-h"><h2>Apparence</h2><span class="small muted">Réglages propres à cet appareil</span></div><div class="grid" style="gap:16px"><div><div class="small muted" style="margin-bottom:8px"><b style="color:var(--text)">Thème</b></div><div class="theme-switch">' + THEMES.map(t => '<button class="' + (S.theme === t[0] ? 'on' : '') + '" data-act="theme" data-t="' + t[0] + '">' + ic(t[2], 'sm') + t[1] + '</button>').join('') + '</div></div>'
      + '<div><div class="small muted" style="margin-bottom:8px"><b style="color:var(--text)">Animations</b> — « Toujours actives » affiche les animations même si Windows ou l\'iPhone demande de les réduire.</div><div class="theme-switch">' + [['system', 'Selon l\'appareil'], ['always', 'Toujours actives'], ['reduced', 'Réduites']].map(o => '<button class="' + (motion === o[0] ? 'on' : '') + '" data-act="motion" data-m="' + o[0] + '">' + o[1] + '</button>').join('') + '</div>' + (motion === 'system' && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches ? '<p class="small" style="margin:8px 0 0;color:var(--warn)">Cet appareil demande actuellement de réduire les animations.</p>' : '') + '</div>'
      + '<div><div class="small muted" style="margin-bottom:8px"><b style="color:var(--text)">Curseur</b> — à la souris (sans effet sur iPhone).</div><div class="theme-switch">' + [['noir', 'Noir Signature'], ['sys', 'Standard']].map(o => '<button class="' + ((lsGet('planif-cur') || 'noir') === o[0] ? 'on' : '') + '" data-act="cur" data-m="' + o[0] + '">' + o[1] + '</button>').join('') + '</div></div>'
      + '<div><div class="small muted" style="margin-bottom:8px"><b style="color:var(--text)">Couleur du thème Clair</b> — boutons, menu actif, graphiques.' + (S.theme !== 'clair' ? ' <a href="#" data-act="theme" data-t="clair">Passer en Clair pour voir</a>' : '') + '</div><div class="acc-sw">' + ACCENTS.map(a => '<button class="' + ((lsGet('planif-accent') || 'vert') === a[0] ? 'on' : '') + '" style="--c:' + a[2] + '" data-act="accent" data-c="' + a[0] + '" title="' + a[1] + '" aria-label="' + a[1] + '"></button>').join('') + '</div></div>'
      + '<div><div class="small muted" style="margin-bottom:8px"><b style="color:var(--text)">Menu latéral (thème Clair)</b> — menu de gauche clair, sombre, ou coloré à la couleur choisie ci-dessus.</div><div class="seg">' + [['clair', 'Clair'], ['dark', 'Sombre'], ['color', 'Coloré']].map(o => '<button class="' + ((lsGet('planif-side') || 'clair') === o[0] ? 'on' : '') + '" data-act="side-mode" data-m="' + o[0] + '">' + o[1] + '</button>').join('') + '</div></div></div></div>';
    const cs = collabs(true).filter(c => isAdmin() || canSeeCollab(c.id));
    const collabCard = '<div class="card"><div class="card-h"><h2>Collaborateurs</h2>' + (isAdmin() ? '<button class="btn primary" data-act="collab-new">+ Collaborateur</button>' : '<span class="small muted">Congés et absences de ton équipe</span>') + '</div>'
      + (cs.length ? '<table class="t stack"><thead><tr><th>Nom</th><th>Type</th><th>Capacité / jour</th><th>Jours travaillés</th><th>Absences à venir</th><th>Statut</th></tr></thead><tbody>' + cs.map(c => { const ab = list('absences').filter(a => a.collaborator_id === c.id && (a.date_to || a.date_from) >= today()); return '<tr class="click" data-act="collab-edit" data-id="' + c.id + '"><td class="first"><i class="swatch" style="background:' + esc(c.color || '#888') + '"></i> ' + esc(c.name) + '</td><td data-l="Type">' + collabKind(c) + '</td><td data-l="Capacité">' + E.fmtMin(c.daily_capacity_min) + '</td><td data-l="Jours">' + (c.work_days || []).sort().map(d => WD_LETTERS[d - 1]).join(' ') + '</td><td data-l="Absences">' + ab.length + '</td><td data-l="Statut">' + (c.active === false ? '<span class="badge">Inactif</span>' : '<span class="badge g">Actif</span>') + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">Aucun collaborateur. Commencez ici.</div>') + '</div>';
    if (!isAdmin()) return appearance + (isManager() ? '<div class="card"><h2 style="margin-bottom:12px">Début d\'utilisation</h2>' + startBlock() + '</div>' + collabCard : myAbsenceCard()); // V26.169 : le manager peut aussi revenir sur le mois de début
    return migNotice() + (isAdmin() ? diagCard() : '') + appearance + collabCard + teamsCard() + securityCard()
      + '<div class="card"><div class="card-h"><h2>Utilisateurs (' + users.filter(u => u.active).length + ' actifs)</h2><button class="btn primary" data-act="user-new">+ Utilisateur</button></div>'
      + '<table class="t stack"><thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Collaborateur lié</th><th>Début</th><th>Statut</th></tr></thead><tbody>' + users.map(u => '<tr class="click" data-act="user-edit" data-id="' + u.id + '"><td class="first">' + esc(u.name) + '</td><td data-l="E-mail">' + esc(u.email) + '</td><td data-l="Rôle">' + (roleLabel(u) || 'Collaborateur') + '</td><td data-l="Collaborateur">' + esc((collabOf(u.collaborator_id) || {}).name || '—') + '</td>'
        + '<td data-l="Début" title="' + (['manager', 'admin'].includes(u.role) ? 'Le manager voit tout le cabinet' : 'Cliquer pour modifier son début d\'utilisation') + '">' + (['manager', 'admin'].includes(u.role) ? '—' : userStartOf(u.email) ? esc(fMonth(userStartOf(u.email))) : '<span class="muted">Comme le cabinet</span>') + '</td><td data-l="Statut">' + (u.active ? '<span class="badge g">Actif</span>' : '<span class="badge">Inactif</span>') + '</td></tr>').join('') + '</tbody></table>'
      + '<p class="small muted">' + (S.store.mode === 'supabase' ? 'Après l\'ajout, envoyez le lien de l\'application : la personne clique sur « Créer mon accès » avec <b>cette adresse e-mail</b>, confirme l\'e-mail reçu, puis se connecte.' : 'Mode démo : chaque utilisateur se choisit sur l\'écran de connexion (sans mot de passe).') + '</p></div>'
      + '<div class="card"><h2 style="margin-bottom:12px">Import des dossiers</h2><div class="row"><button class="btn primary" data-act="import">📥 Importer un fichier Excel</button><button class="btn" data-act="template">⬇ Modèle Excel</button></div></div>'
      + '<div class="card"><h2 style="margin-bottom:12px">Planification</h2>'
      + startBlock() + '<div class="form">' // V26.169 : mois de début affiché en clair, modifiable si on s'est trompé
      + num('start_day', 'Début de période (jour)', st.start_day, 1, 28) + num('mid_day', 'Échéance TVA suivie (« tient le … »)', st.mid_day || 21, 1, 31) + num('end_day', 'Fin de période (jour)', st.end_day, 2, 31)
      + '<label class="f"><span>Heure de début de journée</span><input type="time" data-ch="setting" data-k="day_start" value="' + esc(st.day_start) + '"></label>'
      + num('warn_pct', 'Seuil « presque atteint » (%)', st.warn_pct, 50, 100) + num('due_soon_days', 'Échéance proche (jours)', st.due_soon_days, 0, 15) + num('new_margin_pct', 'Marge nouveau dossier, 3 premiers mois (%)', st.new_margin_pct, 0, 100)
      + '<label class="f"><span>Mois des dossiers trimestriels</span><input type="text" data-ch="setting" data-k="quarter_months" value="' + esc((st.quarter_months || []).join(', ')) + '"></label>'
      + num('annual_month', 'Mois des dossiers annuels', st.annual_month, 1, 12) + '</div><div class="row" style="margin-top:12px">'
      + chk('holidays', 'Jours fériés = non travaillés', st.holidays) + chk('auto_lock_on_move', 'Verrouiller automatiquement une tâche déplacée à la main', st.auto_lock_on_move) + '</div>'
      + '<div class="form" style="margin-top:14px"><label class="f"><span>Durée d\'une demande d\'informations (planning)</span><input type="text" data-ch="setting" data-k="info_request_min" value="' + E.fmtMin(st.info_request_min || 45) + '"></label>' + num('alert_from_day', 'Alerte « ne tiendra pas le ' + st.end_day + ' » à partir du', st.alert_from_day, 1, 28) + '</div><div class="row" style="margin-top:12px">' + chk('auto_create_month', 'Créer automatiquement les dossiers du mois en cours et du mois suivant (planning prospectif)', st.auto_create_month) + '</div>'
      + '<div class="form" style="margin-top:14px">' + num('reserve_pct', 'Temps réservé aux imprévus (% de la journée)', st.reserve_pct, 0, 60) + '</div><p class="small muted" style="margin:6px 0 0">Appels, mails, questions internes : cette part de chaque journée n\'est jamais planifiée (20 % conseillé). Réglable aussi par personne, dans sa fiche.</p>'
      + '<div class="form" style="margin-top:14px">' + num('freeze_days', 'Zone figée : aujourd\'hui + jours ouvrés', st.freeze_days, 0, 5) + '</div><p class="small muted" style="margin:6px 0 0">Dans la zone figée, un dossier reçu déjà planifié n\'est pas déplacé quand un autre dossier arrive (sauf « Forcer » lors d\'une replanification).</p>'
      + '<div class="row" style="margin-top:12px">' + chk('agent_enabled', 'Agent de planification : apprend des mois précédents et ajuste les dates de réception prévues', st.agent_enabled) + '</div></div>'
      + '<div class="card"><div class="card-h"><h2>Historique pour l\'agent</h2><span class="small muted">' + S.data.learning_history.size + ' ligne(s) importée(s)</span></div>'
      + (S.v7 ? '<p class="small">Importez vos mois passés (dates de réception réelles et temps réels) : l\'agent est précis dès le premier mois au lieu d\'apprendre progressivement.</p><div class="row"><button class="btn primary" data-act="hist-import">📥 Importer l\'historique</button><button class="btn" data-act="hist-template">⬇ Modèle pré-rempli (vos dossiers, 12 derniers mois)</button></div>'
        : '<div class="notice warn">Exécutez une fois <b>supabase/migration_v1_7.sql</b> dans Supabase (SQL Editor) pour activer l\'historique, la réception partielle et l\'agent.</div>') + '</div>'
      + (S.store.mode === 'demo' ? '<div class="card"><h2 style="margin-bottom:10px">Mode démo</h2><button class="btn danger" data-act="demo-reset">Effacer toutes les données de démonstration</button></div>' : '');
    function num(k, l, v, mi, ma) { return '<label class="f"><span>' + l + '</span><input type="number" min="' + mi + '" max="' + ma + '" data-ch="setting" data-k="' + k + '" value="' + esc(v) + '"></label>'; }
    function chk(k, l, v) { return '<label class="cb"><input type="checkbox" data-ch="setting" data-k="' + k + '"' + (v ? ' checked' : '') + '> ' + l + '</label>'; }
  }

