/* app.js — Interface, sauvegarde automatique, synchronisation, conflits.
 * FICHIER ASSEMBLÉ AUTOMATIQUEMENT (V26.45) à partir de src/app/*.js par build.js (ou build.ps1).
 * Ne pas le modifier directement : modifier le fichier concerné dans src/app/, puis relancer l'assemblage. */
(function () {
  'use strict';
  const E = window.PlanEngine, P = window.PlanStore, CFG = window.APP_CONFIG || {};
  const qs = new URLSearchParams(location.search);
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/dist/umd/supabase.js';
  const XLSX_JS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  const CACHE_KEY = 'planif-tva-cache-v1';

  /* ====================== État ====================== */
  const S = {
    store: null, me: null, ready: false, readonly: false, limitMsg: null,
    data: {}, route: 'today', planMode: 'week', collabId: null, cursor: null, month: null,
    sync: 'connecting', offline: !navigator.onLine, pending: 0, failed: [], lastSync: '', lastPoll: 0, loadedFrom: null, loadedMonths: new Set(),
    teamRange: 'week', teamView: 'table', quick: '', clientView: 'dossier', clientSearch: '', clientCollab: '',
    search: '', filters: { period: 'month', collab: '', status: 'todo', late: false, reception: '', kind: '' },
    recDate: null, recSel: new Set(), recAll: false, sheet: null, dirty: false, histCache: null,
    theme: document.documentElement.dataset.variant === 'aurora' ? 'nuit' : document.documentElement.dataset.variant === 'iris' ? 'iris' : document.documentElement.dataset.theme === 'clair' ? 'clair' : 'signature',
    navPinned: false, drawer: false, enter: true, flash: new Set(), justDone: new Set()
  };
  P.TABLES.forEach(t => (S.data[t] = new Map()));

  /* ====================== Utilitaires ====================== */
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // V26.83 : les productions et tâches d'un dossier inactif ne comptent plus nulle part (compteurs, planning, TVA, pilotage)
  // V26.164 : les mois antérieurs au « premier mois d'utilisation » (Paramètres) ne comptent plus nulle part non plus (rien n'est supprimé)
  const list = t => { const a = [...S.data[t].values()]; if (t !== 'productions' && t !== 'tasks') return a; const sm = startMonth(); return a.filter(r => { const c = S.data.clients.get(r.client_id); return (!c || c.active !== false) && (!sm || !r.month || r.month >= sm); }); };
  // V26.164 : premier mois d'utilisation du cabinet ; V26.168 : + début propre à chaque utilisateur (RC, collaborateur, apprenti),
  // demandé à sa création — rien n'apparaît avant pour lui (le manager garde la vue du cabinet)
  const planVal = () => ((S.data.settings && S.data.settings.get('planning')) || {}).value || {};
  const cabStart = () => /^\d{4}-\d{2}$/.test(planVal().start_month || '') ? planVal().start_month : '';
  const userStartOf = email => { const us = (planVal().user_start || {})[String(email || '').toLowerCase()]; return /^\d{4}-\d{2}$/.test(us || '') ? us : ''; };
  const startMonth = () => { const cab = cabStart(); if (!S.me || isManager()) return cab; const us = userStartOf(S.me.email); return us > cab ? us : cab; };
  // V26.202 : exception accordée par l'administrateur (Paramètres › Utilisateurs) — la personne peut modifier tous les champs des fiches des dossiers qu'elle voit
  const clientEditor = () => !!S.me && !S.readonly && (planVal().client_editors || []).map(x => String(x).toLowerCase()).includes(String(S.me.email || '').toLowerCase());
  // V26.206 : 20 % de chaque journée gardés pour les imprévus, par défaut (Paramètres › Planification, et par personne)
  const cfg = () => Object.assign({}, E.DEFAULT_SETTINGS, { reserve_pct: 20 }, ((S.data.settings.get('planning') || {}).value) || {});
  // V26.73 : un administrateur peut prévisualiser l'application « comme un manager » (affichage uniquement)
  const realAdmin = () => !!((S.realMe || S.me) && (S.realMe || S.me).role === 'admin'); // V26.144 : S.realMe = l'administrateur quand il regarde l'application « en tant que » quelqu'un
  const meName = () => ((S.realMe || S.me) || {}).name || '';
  const viewAsManager = () => realAdmin() && (function () { try { return sessionStorage.getItem('planif-view-as') === 'manager'; } catch (e) { return false; } })();
  const isAdmin = () => S.realMe ? S.me.role === 'admin' : realAdmin() && !viewAsManager();
  const roleLabel = u => !u ? '' : u.role === 'admin' ? (S.me && u.id === S.me.id && viewAsManager() ? 'Manager (aperçu)' : 'Administrateur') : u.role === 'manager' ? 'Manager' : u.role === 'apprenti' ? 'Apprenti' : ((collabOf(u.collaborator_id) || {}).kind === 'rc' ? 'Responsable client' : 'Collaborateur');
  // V26.145 : création et import de dossiers — administrateur, manager et RC (le RC pour son équipe)
  const isRC = () => !!(S.me && (collabOf(S.me.collaborator_id) || {}).kind === 'rc');
  const canCreateDossiers = () => !S.readonly && (isManager() || isRC());
  const isManager = () => !!(S.me && (S.me.role === 'admin' || S.me.role === 'manager'));
  /* Manager : les collaborateurs de ses équipes (tous si aucune équipe ne lui est confiée) */
  function managedCollabIds() {
    const teams = new Set(list('teams').filter(t => t.manager_id === S.me.id).map(t => t.id));
    return new Set(list('collaborators').filter(c => !teams.size || (c.team_id && teams.has(c.team_id))).map(c => c.id));
  }
  /* V26.76 : visibilité descendante uniquement — le RC voit ses collaborateurs, le collaborateur / tuteur voit son apprenti.
     Le collaborateur ne voit pas le planning de son RC, ni l'apprenti celui de son tuteur ou binôme. */
  function juniorsOf(id) {
    const out = [], seen = new Set([id]), queue = [id];
    while (queue.length) {
      const cur = queue.shift();
      list('collaborators').filter(x => x.active !== false && !seen.has(x.id) && (x.rc_id === cur || (x.kind === 'apprenti' && x.tutor_id === cur))).sort(byName)
        .forEach(x => { seen.add(x.id); out.push(x); queue.push(x.id); });
    }
    return out;
  }
  function binomeIds() {
    const me = S.me && S.me.collaborator_id, out = new Set(); if (!me) return out;
    out.add(me); juniorsOf(me).forEach(x => out.add(x.id));
    return out;
  }
  /* V26.74 : apprentis rattachés à une personne ; base à jour (colonnes apprenti) */
  const apprenticesOf = id => !id ? [] : list('collaborators').filter(x => x.kind === 'apprenti' && (x.tutor_id === id || x.rc_id === id) && x.active !== false).sort(byName);
  const v17 = () => S.store.mode !== 'supabase' || list('collaborators').some(c => 'presence_dates' in c);
  const clientOf = id => S.data.clients.get(id);
  const collabOf = id => S.data.collaborators.get(id);
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'fr');
  const collabs = all => list('collaborators').filter(c => all || c.active !== false).sort(byName);
  const visibleCollabs = () => collabs().filter(c => canSeeCollab(c.id));
  const canSeeCollab = id => isManager() ? (isAdmin() || managedCollabIds().has(id) || id === S.me.collaborator_id) : binomeIds().has(id); // V26.19 : équipes et binômes
  const canEditTask = t => !S.readonly && canSeeCollab(t.collaborator_id);
  // V26.164 : replanifier — manager, RC et collaborateur (pas l'apprenti) ; hors manager, seul son planning (et celui de son apprenti / ses collaborateurs) bouge
  const canReplan = () => !S.readonly && !!S.me && (isManager() || (S.me.role !== 'apprenti' && !!S.me.collaborator_id && (collabOf(S.me.collaborator_id) || {}).kind !== 'apprenti'));
  /* V26.163 : un dossier dont toutes les tâches de production sont terminées (mois clôturé, travail fait sans déclarer
     la réception) n'attend plus d'éléments : il sort des réceptions. Calculé une fois par affichage. */
  function closedProds() {
    if (S._closed) return S._closed;
    const any = new Set(), open = new Set();
    for (const t of S.data.tasks.values()) { if (t.kind === 'info' || !t.production_id) continue; any.add(t.production_id); if (!t.done) open.add(t.production_id); }
    const out = new Set(); any.forEach(id => { if (!open.has(id)) out.add(id); });
    for (const p of S.data.productions.values()) if (p.status === 'cloture') out.add(p.id); // V26.168 : dossier clôturé sans tâche (« Clôturer le mois »)
    return (S._closed = out);
  }
  const awaitingRec = p => !p.received_date && !!p.expected_date && p.status !== 'cloture' && !closedProds().has(p.id);
  // V26.168 : rien avant le début d'utilisation — mois et date affichés ramenés au premier mois utilisé
  function clampToStart() {
    const sm = startMonth(); if (!sm) return;
    if (S.month && S.month < sm) S.month = sm;
    if (S.cursor && S.cursor < sm + '-01') S.cursor = E.nextWorkday(sm + '-01');
  }
  // bouton « précédent » bloqué au premier mois utilisé (mois, jour ou semaine affichés)
  const prevBlocked = mode => {
    const sm = startMonth(); if (!sm) return false; const s0 = sm + '-01', cur = S.cursor || s0;
    if (mode === 'month') return (S.month || '') <= sm;
    if (mode === 'day') { let c = E.addDays(cur, -1); while (E.dow(c) >= 6) c = E.addDays(c, -1); return c < s0; } // jour ouvré précédent
    if (mode === 'week') return E.addDays(E.startOfWeek(cur), -3) < s0; // vendredi de la semaine précédente
    return cur.slice(0, 7) <= sm;
  };
  // Réceptions : le mois de production en cours d'abord, puis les restes des mois précédents, chacun par date attendue
  const recOrder = (a, b) => { const cm = defaultMonth(); return ((b.month >= cm) - (a.month >= cm)) || (a.expected_date || '').localeCompare(b.expected_date || ''); };
  const demoDay = () => qs.get('today') || window.JBFLOW_DEMO_TODAY || ''; // démo : date fixée (paramètre ?today= ou page de démo)
  const today = () => (S.store && S.store.mode === 'demo' && /^\d{4}-\d{2}-\d{2}$/.test(demoDay())) ? demoDay() : E.ymd(new Date());
  /* Manager : uniquement ses équipes ; administrateur : tout le cabinet */
  function scopedData() {
    const d = engineData(); if (!isManager() || (isAdmin() && !S.teamFilter)) return d;
    let ids = isAdmin() ? new Set(list('collaborators').map(c => c.id)) : managedCollabIds();
    if (S.teamFilter) ids = new Set([...ids].filter(id => (collabOf(id) || {}).team_id === S.teamFilter));
    const cl = new Set(d.clients.filter(c => ids.has(c.collaborator_id)).map(c => c.id));
    return Object.assign(d, { collaborators: d.collaborators.filter(c => ids.has(c.id)), tasks: d.tasks.filter(t => ids.has(t.collaborator_id) || (!t.collaborator_id && cl.has(t.client_id))), productions: d.productions.filter(p => cl.has(p.client_id)), clients: d.clients.filter(c => cl.has(c.id)) });
  }
  const engineData = () => ({ tasks: list('tasks'), productions: list('productions'), clients: list('clients'), collaborators: list('collaborators'), absences: list('absences'), settings: cfg() });
  const ctx = () => E.makeCtx(engineData());
  const errMsg = e => (e && (e.message || e.error_description || e.details)) || String(e);

  const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const DAYS_S = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const fDate = s => DAYS[E.dow(s) - 1] + ' ' + Number(s.slice(8)) + ' ' + MONTHS[Number(s.slice(5, 7)) - 1];
  const fShort = s => DAYS_S[E.dow(s) - 1] + ' ' + Number(s.slice(8));
  const MONTHS_S = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const fDM = s => s ? Number(s.slice(8)) + ' ' + MONTHS_S[Number(s.slice(5, 7)) - 1] : '—';
  const fDMY = s => s ? s.slice(8) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '';
  const fMonth = m => MONTHS[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4);
  const deMonth = m => (/^[aeiouh]/i.test(fMonth(m)) ? 'd\'' : 'de ') + fMonth(m); // « d'octobre », « de mars »
  const fDateTime = iso => { const d = new Date(iso); return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
  const WD_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const COLORS = ['#4C7DF0', '#12B3A3', '#9B6CF0', '#F08A3E', '#E5484D', '#1FA75A', '#C9A227'];

  function defaultMonth() { const t = today(); return Number(t.slice(8)) > cfg().end_day ? E.addMonths(t.slice(0, 7), 1) : t.slice(0, 7); }
  // V26.167 : dernier jour réel de la période d'un mois (fin un week-end ou un férié → premier jour ouvré suivant : « 26 », « 2 nov. » hors du mois)
  const endLbl = m => { const e = E.windowOf(m, cfg()).end; return e.slice(0, 7) === m ? String(Number(e.slice(8))) : fDM(e); };
  // V26.132 : date « AAAA-MM-JJ » d'un horodatage, qu'il soit texte (base) ou objet Date (modification locale pas encore rechargée)
  // V26.166 : un horodatage est ramené au jour local (une tâche finie à 0 h 30 reste datée du bon jour)
  const atDay = v => !v ? '' : typeof v === 'string' && v.length <= 10 ? v : (d => isNaN(d) ? String(v).slice(0, 10) : E.ymd(d))(new Date(v));
  // V26.166 : horodatage de fin de tâche — en démo, au jour fictif de la démo, pour que « Faite le … » reste cohérent
  const nowStamp = () => { const n = new Date(), td = today(); if (td === E.ymd(n)) return n.toISOString(); const d = new Date(td + 'T12:00:00'); d.setHours(n.getHours(), n.getMinutes(), n.getSeconds()); return d.toISOString(); };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible : sans conséquence */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* idem */ } }
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Impossible de charger ' + src)); document.head.appendChild(s); });
  }
  async function needXLSX() { if (!window.XLSX) await loadScript(XLSX_JS); return window.XLSX; }
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ====================== Toasts & confirmations ====================== */
  function toast(msg, type, action, ms) {
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.innerHTML = '<span style="flex:1">' + esc(msg) + '</span>' + (action ? '<button>' + esc(action.label) + '</button>' : '') + '<button aria-label="Fermer">✕</button>';
    const btns = el.querySelectorAll('button'), close = () => fxToastOut(el); // V26.176 : sortie en 140 ms, les autres glissent à leur place
    if (action) btns[0].onclick = () => { close(); action.fn(); };
    btns[btns.length - 1].onclick = close;
    $('#toasts').appendChild(el);
    setTimeout(close, ms || (type === 'bad' || type === 'warn' ? 9000 : 4500));
  }
  function confirmBox(title, html, okLabel, danger) {
    return new Promise(resolve => {
      const root = document.createElement('div');
      root.className = 'overlay anim center'; // V26.100 : confirmation au centre
      root.innerHTML = '<div class="sheet sheet-confirm" role="dialog" aria-modal="true"><div class="sheet-h"><h2>' + esc(title) + '</h2></div><div class="sheet-b">' + html + '</div><div class="sheet-f"><button class="btn" data-r="0">Annuler</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-r="1">' + esc(okLabel || 'Confirmer') + '</button></div></div>';
      root.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b || e.target === root) { fxClose(root); resolve(!!(b && b.dataset.r === '1')); } });
      document.body.appendChild(root);
    });
  }

  /* ====================== Sauvegarde automatique ====================== */
  function setPending(d) { S.pending = Math.max(0, S.pending + d); renderStatus(); }
  function hist(action, o) {
    o = o || {};
    S.store.logHistory([{ action, entity: o.entity || null, entity_id: o.entity_id || null, client_id: o.client_id || null, detail: o.detail || null }]).catch(() => { });
    S.histCache = null;
  }
  function isLimitError(e) {
    const m = errMsg(e).toLowerCase(), st = e && (e.status || e.code);
    return st === 402 || /exceed|quota|restricted|paused|limit reached|too many/.test(m);
  }
  function noteLimit(e) {
    if (isLimitError(e)) { S.limitMsg = 'Supabase refuse les requêtes : limite de l\'offre gratuite atteinte ou projet en pause. Ouvrez le tableau de bord Supabase (Usage / Restore project). Les données affichées restent consultables ; les modifications ne sont pas enregistrées.'; render(); }
  }
  /* Met à jour une ligne : affichage immédiat, enregistrement en base, jamais marqué « enregistré » tant que
   * la base n'a pas confirmé. Retourne 'ok' | 'conflict' | 'denied' | 'failed'. */
  async function saveUpdate(table, id, patch, opts) {
    opts = opts || {};
    const cur = S.data[table].get(id);
    if (!cur) return 'conflict';
    if (S.readonly) { toast('Mode lecture seule : la base de données est inaccessible, modification non enregistrée.', 'bad'); return 'failed'; }
    const fi = S.failed.findIndex(f => f.table === table && f.id === id);
    if (fi >= 0) { patch = Object.assign({}, S.failed[fi].patch, patch); S.failed.splice(fi, 1); }
    const base = Object.assign({}, cur); delete base._unsaved; delete base._failed;
    S.data[table].set(id, Object.assign({}, base, patch, { _unsaved: true }));
    setPending(1); scheduleRender();
    try {
      let row = await S.store.update(table, id, table === 'clients' ? await encClientPatch(patch) : patch, base.version);
      if (table === 'clients') row = decClient(row);
      S.data[table].set(id, row);
      if (row.updated_at > S.lastSync) S.lastSync = row.updated_at;
      if (opts.history) hist(opts.history.action, opts.history);
      return 'ok';
    } catch (e) {
      if (e.conflict) {
        if (e.row) S.data[table].set(id, e.row); else S.data[table].delete(id);
        if (!opts.quiet) toast('Cette donnée vient d\'être modifiée par un autre utilisateur. Les données ont été actualisées : vérifiez avant de poursuivre.', 'warn');
        return 'conflict';
      }
      if (e.permission) {
        S.data[table].set(id, base);
        if (!opts.quiet) toast('Modification refusée : droits insuffisants.', 'bad');
        return 'denied';
      }
      noteLimit(e);
      S.data[table].set(id, Object.assign({}, base, patch, { _failed: true }));
      S.failed.push({ table, id, patch, version: base.version, history: opts.history });
      if (!opts.quiet) toast('Échec de l\'enregistrement (' + errMsg(e) + '). La modification N\'EST PAS enregistrée.', 'bad', { label: 'Réessayer', fn: retryFailed });
      return 'failed';
    } finally { setPending(-1); scheduleRender(); }
  }
  function preApply(table, items) { items.forEach(it => { const cur = S.data[table].get(it.id); if (!cur) return; const b0 = Object.assign({}, cur); delete b0._failed; S.data[table].set(it.id, Object.assign({}, b0, it.patch, { _unsaved: true })); }); }
  async function saveMany(table, items, opts) { // V26.162 : opts.quiet = pas de message (l'appelant gère les échecs)
    const res = { ok: 0, conflict: 0, denied: 0, failed: 0 };
    // V26.106 : tout le lot est appliqué à l'écran d'un coup AVANT l'envoi, pour qu'un calcul lancé pendant l'enregistrement voie un état complet et cohérent
    preApply(table, items);
    const queue = items.slice();
    const worker = async () => { while (queue.length) { const it = queue.shift(); res[await saveUpdate(table, it.id, it.patch, { quiet: true, history: it.history })]++; } };
    await Promise.all(Array.from({ length: Math.min(6, items.length) }, worker));
    if (opts && opts.quiet) return res;
    if (res.failed) toast(res.failed + ' modification(s) non enregistrée(s) (erreur réseau).', 'bad', { label: 'Réessayer', fn: retryFailed });
    if (res.conflict) toast(res.conflict + ' élément(s) modifié(s) entre-temps par un autre utilisateur : non écrasé(s), données actualisées.', 'warn');
    if (res.denied) toast(res.denied + ' modification(s) refusée(s) (droits insuffisants).', 'bad');
    return res;
  }
  async function retryFailed() {
    const items = S.failed.splice(0);
    for (const f of items) {
      const cur = S.data[f.table].get(f.id);
      if (cur) { const b = Object.assign({}, cur); delete b._failed; b.version = f.version; S.data[f.table].set(f.id, b); }
    }
    renderStatus();
    const byTable = {};
    items.forEach(f => (byTable[f.table] = byTable[f.table] || []).push({ id: f.id, patch: f.patch, history: f.history }));
    let ok = 0;
    for (const t in byTable) ok += (await saveMany(t, byTable[t])).ok;
    if (ok) toast(ok + ' modification(s) enregistrée(s).', 'ok');
  }
  async function saveInsert(table, rows) {
    if (S.readonly) { toast('Mode lecture seule : création impossible.', 'bad'); throw new Error('readonly'); }
    setPending(1);
    try {
      const out = (await S.store.insert(table, table === 'clients' ? await Promise.all(rows.map(encClientPatch)) : rows)).map(r => (table === 'clients' ? decClient(r) : r));
      out.forEach(r => { S.data[table].set(r.id, r); if (r.updated_at > S.lastSync) S.lastSync = r.updated_at; });
      return out;
    } catch (e) {
      noteLimit(e);
      toast('Échec de l\'enregistrement : ' + errMsg(e) + '. Rien n\'a été enregistré pour cette action.', 'bad');
      throw e;
    } finally { setPending(-1); scheduleRender(); }
  }
  async function saveRemove(table, id) {
    setPending(1);
    try { await S.store.remove(table, id); S.data[table].delete(id); if (table === 'productions') list('tasks').filter(t => t.production_id === id).forEach(t => S.data.tasks.delete(t.id)); return true; }
    catch (e) { toast('Suppression impossible : ' + errMsg(e), 'bad'); return false; }
    finally { setPending(-1); scheduleRender(); }
  }

  /* ====================== Synchronisation ====================== */
  function mergeRow(table, row) {
    if (!S.data[table] || !row || row.id === undefined) return;
    if (table === 'settings' && row.id === 'crypto') cryptoWatch(row); // V26.162 : phrase secrète changée sur un autre appareil
    const cur = S.data[table].get(row.id);
    if (cur && cur._unsaved) return; // un enregistrement local est en cours : son résultat fera foi
    if (cur && cur._failed) {
      if ((row.version || 0) > (cur.version || 0)) {
        const i = S.failed.findIndex(f => f.table === table && f.id === row.id);
        if (i >= 0) S.failed.splice(i, 1);
        toast('Une modification non enregistrée a été abandonnée : l\'élément a été modifié par un autre utilisateur entre-temps.', 'warn');
      } else return;
    }
    if (table === 'clients') row = decClient(row);
    if (!cur || (row.version || 0) >= (cur.version || 0)) {
      if (S.sheet && S.sheet.id === row.id && cur && (row.version || 0) > (cur.version || 0) && row.updated_by && row.updated_by !== S.me.email) S.sheet.remote = row.updated_by;
      S.data[table].set(row.id, row);
    }
    if (table === 'app_users' && S.me && row.id === S.me.id) S.me = row;
    if (row.updated_at && row.updated_at > S.lastSync) S.lastSync = row.updated_at;
  }
  function onRemote(table, type, row) {
    if (type === 'DELETE') { if (S.data[table]) S.data[table].delete(row.id); }
    else {
      mergeRow(table, row);
      // Halo discret sur une tâche modifiée par un autre utilisateur
      if (table === 'tasks' && row.updated_by && S.me && row.updated_by !== S.me.email) { S.flash.add(row.id); setTimeout(() => S.flash.delete(row.id), 1300); }
    }
    scheduleRender();
  }
  function cacheSnapshot() {
    const snap = { email: S.me && S.me.email, at: new Date().toISOString(), data: {} };
    P.TABLES.forEach(t => (snap.data[t] = list(t).filter(r => !r._unsaved && !r._failed).map(r => (t === 'clients' && (r._enc_name || r._enc_notes || r._enc_is_data) ? Object.assign({}, r, { name: r._enc_name || r.name, notes: r._enc_notes !== undefined ? r._enc_notes : r.notes, is_data: r._enc_is_data !== undefined ? r._enc_is_data : r.is_data }) : r))));
    lsSet(CACHE_KEY, JSON.stringify(snap));
  }
  async function loadAll() {
    const from = E.addMonths(E.ymd(new Date()).slice(0, 7), -1);
    const res = await S.store.loadAll(from);
    P.TABLES.forEach(t => (S.data[t] = new Map(res[t].map(r => [r.id, t === 'clients' ? decClient(r) : r]))));
    S.loadedFrom = from; S.loadedMonths = new Set();
    S.lastSync = P.TABLES.reduce((m, t) => res[t].reduce((mm, r) => (r.updated_at > mm ? r.updated_at : mm), m), '');
  }
  async function ensureMonth(m) {
    if (!S.loadedFrom || m >= S.loadedFrom || S.loadedMonths.has(m)) return;
    S.loadedMonths.add(m);
    try { const r = await S.store.loadMonth(m); r.productions.forEach(x => mergeRow('productions', x)); r.tasks.forEach(x => mergeRow('tasks', x)); scheduleRender(); }
    catch (e) { S.loadedMonths.delete(m); toast('Chargement du mois impossible : ' + errMsg(e), 'bad'); }
  }
  async function poll(force) {
    if (!S.ready || S.readonly) return;
    const age = Date.now() - S.lastPoll;
    if (!force && S.sync === 'live' && age < 5 * 60000) return;
    if (!force && age < 25000) return;
    S.lastPoll = Date.now();
    try {
      const since = S.lastSync ? new Date(new Date(S.lastSync).getTime() - 120000).toISOString() : '1970-01-01T00:00:00Z';
      const res = await S.store.changesSince(since);
      P.TABLES.forEach(t => res[t].forEach(r => mergeRow(t, r)));
      if (S.offline) { S.offline = false; }
      if (S.limitMsg) S.limitMsg = null;
      cacheSnapshot();
      scheduleRender();
    } catch (e) { S.offline = true; noteLimit(e); renderStatus(); }
  }
  async function refreshAll() {
    try { await loadAll(); cacheSnapshot(); S.offline = false; S.limitMsg = null; toast('Données actualisées.', 'ok', null, 2000); }
    catch (e) { S.offline = true; noteLimit(e); toast('Actualisation impossible : ' + errMsg(e), 'bad'); }
    render();
  }

