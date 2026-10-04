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
  const cfg = () => Object.assign({}, E.DEFAULT_SETTINGS, ((S.data.settings.get('planning') || {}).value) || {});
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

  /* ====================== Rendu ====================== */
  /* Icônes (trait fin, 24×24) */
  const ICONS = {
    home: '<path d="M3.5 10.5 12 3.5l8.5 7V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-6v6H5A1.5 1.5 0 0 1 3.5 19z"/>',
    file: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    inbox: '<path d="M3.5 13.5h4.5l1.5 2.5h5l1.5-2.5h4.5"/><path d="M6 5h12l2.5 8.5V18a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18v-4.5z"/>',
    users: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.7-3.3 3.1-5.2 6-5.2s5.3 1.9 6 5.2"/><circle cx="17" cy="9.5" r="2.6"/><path d="M16.3 14.4c2.5.2 4.2 1.8 4.7 4.6"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    chart: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M8.5 16v-4M12 16V8M15.5 16v-6"/>',
    bars: '<path d="M6 19v-7M12 19V5M18 19v-4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M4.5 16.5v1.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1.5"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    chevR: '<path d="m9.5 6 6 6-6 6"/>', chevL: '<path d="m14.5 6-6 6 6 6"/>', chevD: '<path d="m6 9.5 6 6 6-6"/>',
    arrowUR: '<path d="M7.5 16.5 16.5 7.5M9 7.5h7.5V15"/>',
    sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v1.9M12 19.3v1.9M4.9 4.9l1.3 1.3M17.8 17.8l1.3 1.3M2.8 12h1.9M19.3 12h1.9M4.9 19.1l1.3-1.3M17.8 6.2l1.3-1.3"/>',
    moon: '<path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z"/>',
    logout: '<path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
    refresh: '<path d="M19.5 11.5A7.5 7.5 0 1 0 17.3 17M19.5 5.5v6h-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    alert: '<path d="M12 4 3 19.5h18z"/><path d="M12 10v4.2M12 17h.01"/>',
    sparkle: '<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9z"/>',
    panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="4"/><path d="M9.5 4.5v15"/>',
    pin: '<path d="M9 3.5h6l-.8 5.5 3.3 3.2h-11L9.8 9z"/><path d="M12 12.2v8.3"/>',
    merge: '<path d="M6 4v5a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v5M18 4v5a3 3 0 0 1-3 3"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="3"/><path d="m4.5 7 7.5 6 7.5-6"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.6 5.2 3.4-5.2 3.4z" fill="currentColor"/>',
    phone: '<path d="M6.6 3.5h2.6l1.4 4.1-2 1.4a12 12 0 0 0 6.4 6.4l1.4-2 4.1 1.4v2.6a2.1 2.1 0 0 1-2.3 2.1A16.6 16.6 0 0 1 4.5 5.8a2.1 2.1 0 0 1 2.1-2.3z"/>',
    menu: '<path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15"/>',
    x: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
    gauge: '<path d="M4.2 16.5a8.5 8.5 0 1 1 15.6 0"/><path d="m12 13 3.5-4"/><circle cx="12" cy="13.3" r="1.2"/>',
    flame: '<path d="M12 21c3.6 0 6-2.4 6-5.8 0-3.6-2.8-5.6-3.6-9.2-2 1.4-3.2 3.3-3.4 5.6-.9-.7-1.5-1.8-1.6-3.1C7.6 10.2 6 12.4 6 15.2 6 18.6 8.4 21 12 21z"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
    flag: '<path d="M5.5 20.5v-16M5.5 4.5h11l-2 4 2 4h-11"/>',
    route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
    review: '<path d="M9 5.5H7.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-11a2 2 0 0 0-2-2H15"/><rect x="9" y="3.5" width="6" height="3.5" rx="1.2"/><path d="m9 13.5 2 2 4-4.2"/>',
    filter: '<path d="M4 5.5h16l-6.2 7.3v5.4l-3.6 1.8v-7.2z"/>'
  };
  function ic(n, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>'; }
  const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const reducedMotion = () => { const m = document.documentElement.dataset.motion; return m === 'reduced' || (m !== 'always' && !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)); };
  const LV_LABEL = { green: 'Activité normale', orange: 'Presque atteinte', red: 'Surcharge', off: 'Non travaillé' };
  // V26.173 : RC, collaborateur et apprenti — jamais les mots « surcharge » ou « charge » (le manager garde son vocabulaire)
  const lvLabel = lv => (isManager() ? LV_LABEL : Object.assign({}, LV_LABEL, { red: 'Très remplie' }))[lv];
  const softText = s => isManager() ? String(s || '') : String(s || '').replace(/ — surcharge le /g, ' — journée trop remplie le ').replace(/surcharg\w*/gi, 'dépassement de capacité');
  const LV_BADGE = { green: 'g', orange: 'o', red: 'r', off: '' };
  /* V26.185 : en dessous de 108 % de remplissage, aucune alerte ni phrase d'avertissement — la journée est considérée comme normale
     (les couleurs des jauges restent inchangées). Un seul seuil, utilisé partout. */
  const ALERT_PCT = 108;
  const overAlert = (total, cap) => (cap > 0 ? total / cap * 100 >= ALERT_PCT : total > 0);
  const msgLv = (lv, total, cap) => ((lv === 'orange' || lv === 'red') && !overAlert(total, cap) ? 'green' : lv);
  // alertes du moteur, sans « capacité presque atteinte » ni « surcharge » en dessous du seuil
  const alertsOf = (...a) => E.alerts(...a).filter(x => x.type !== 'near' && !(x.type === 'overload' && x.pct !== undefined && x.pct < ALERT_PCT));

  let renderTimer = 0;
  function scheduleRender() { if (renderTimer) return; renderTimer = setTimeout(() => { renderTimer = 0; render(); }, 16); }
  function typing() {
    const a = document.activeElement;
    return a && ((a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'file', 'color'].includes(a.type)) || a.tagName === 'TEXTAREA') && a.closest('#app,#sheet-root');
  }
  /* Le squelette (menu, en-tête, barre d'onglets) est créé une fois ; seules ses parties sont mises à jour,
   * ce qui permet les transitions (indicateur d'onglet qui glisse, tiroir, repli du menu). */
  function buildShell() {
    $('#app').innerHTML = '<div id="banner"></div><div class="shell" id="shell"><aside class="side" id="side" aria-label="Menu principal"></aside><div class="side-backdrop" id="side-backdrop" data-act="drawer-close"></div>'
      + '<div class="main"><header class="top" id="topbar"></header><main class="content" id="view"></main>' + legalHtml() + '</div></div>'
      + '<nav class="bottom-nav" id="bnav" aria-label="Navigation"><span class="ind"></span>'
      + bottomItems().map((n, i) => n[0] === 'more' ? '<button type="button" data-act="drawer" data-i="' + i + '">' + ic(n[1]) + '<span>' + n[2] + '</span></button>' : '<a href="#/' + n[0] + '" data-i="' + i + '">' + ic(n[1]) + '<span>' + n[2] + '</span></a>').join('') + '</nav>';
  }
  function render() { S._pIdx = null; S._closed = null; // V26.67 : index reconstruit une fois par affichage (V26.163 : dossiers clôturés aussi)
    if (!S.ready) return;
    if (typing()) { S.dirty = true; return; }
    S.dirty = false;
    if (!$('#shell')) buildShell();
    $('#shell').classList.toggle('pinned', !!S.navPinned);
    $('#banner').innerHTML = viewAsBanner() + bannerHtml();
    const side = $('#side'), sideScroll = side.scrollTop;
    side.innerHTML = sideHtml(); side.scrollTop = sideScroll;
    side.classList.toggle('open', !!S.drawer); $('#side-backdrop').classList.toggle('open', !!S.drawer);
    $('#topbar').innerHTML = topHtml();
    const view = $('#view'), keep = {}, y = window.scrollY;
    view.querySelectorAll('[data-keep]').forEach(el => (keep[el.dataset.keep] = el.scrollLeft));
    // V26.176 : système de mouvement commun (021-mouvement.js), pour tous les thèmes —
    // arrivée sur un écran : cascade d'entrée ; changement d'onglet : fondu + 4 px du contenu ; sinon seules les données qui changent bougent
    const now = performance.now(), tabFx = !S.enter && S.tabFx && now - S.tabFx < 400 && fxOn();
    const live = !S.enter && !tabFx && S.fxAt && now - S.fxAt < 520 && (view.classList.contains('enter') || view.classList.contains('tab-in')); // animation d'écran en cours : on la poursuit
    const snap = S.enter || tabFx || live ? null : fxSnapshot(view);
    if (!S.enter && !live) view.classList.remove('enter', 'tab-in');
    view.innerHTML = viewHtml();
    view.querySelectorAll('[data-keep]').forEach(el => { if (keep[el.dataset.keep] !== undefined) el.scrollLeft = keep[el.dataset.keep]; });
    if (S.enter) {
      S.enter = false; S.fxAt = now; view.style.setProperty('--fx-el', '0ms'); view.classList.remove('tab-in'); view.classList.add('enter');
      shownCounts.clear(); // à chaque arrivée sur un écran, les chiffres repartent de 0
      clearTimeout(S.enterT); S.enterT = setTimeout(() => view.classList.remove('enter'), 700);
      const tcol = view.querySelector('.week .day-col.today');
      if (tcol && tcol.parentElement.scrollWidth > tcol.parentElement.clientWidth + 4) tcol.parentElement.scrollLeft = tcol.offsetLeft - 16;
    } else if (tabFx) {
      // changement d'onglet : les commandes restent en place, le nouveau contenu apparaît en fondu léger
      S.fxAt = now; view.style.setProperty('--fx-el', '0ms'); view.classList.remove('enter'); view.classList.add('tab-in');
      clearTimeout(S.tabT); S.tabT = setTimeout(() => view.classList.remove('tab-in'), 520);
    } else if (live) view.style.setProperty('--fx-el', Math.round(now - S.fxAt) + 'ms');
    S.tabFx = 0;
    updateBottomNav();
    renderStatus();
    renderSheet();
    animateCounts(view);
    typeQuote();
    view.querySelectorAll('.carousel').forEach(syncDots);
    window.scrollTo(0, y);
    fxApply(view, snap);
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (S.dirty && !typing()) render(); }, 0));
  function bannerHtml() {
    return (S.store.mode === 'demo' ? '<div class="banner demo">Mode démo — données stockées uniquement dans ce navigateur (essai). Configurez Supabase pour l\'utilisation partagée.</div>' : '')
      + (S.limitMsg ? '<div class="banner bad">' + esc(S.limitMsg) + '</div>' : '')
      + (S.readonly ? '<div class="banner bad">Base de données inaccessible : dernière copie locale (' + esc(S.cacheAt ? fDateTime(S.cacheAt) : '') + '), en lecture seule. <a href="#" data-act="reload">Réessayer</a></div>' : '');
  }
  function renderStatus() {
    const el = $('#status'); if (!el) return;
    const sync = S.readonly ? '<span class="pill" title="Lecture seule"><i class="dot r"></i><span class="txt">Lecture seule</span></span>'
      : S.offline ? '<span class="pill" title="Hors ligne"><i class="dot r"></i><span class="txt">Hors ligne</span></span>'
        : S.sync === 'live' ? '<span class="pill" title="Les modifications des autres utilisateurs apparaissent automatiquement."><i class="dot g"></i><span class="txt">Temps réel</span></span>'
          : S.sync === 'poll' ? '<span class="pill" title="Actualisation automatique toutes les 30 s"><i class="dot o"></i><span class="txt">Auto · 30 s</span></span>' : '<span class="pill"><i class="dot"></i><span class="txt">Connexion…</span></span>';
    const save = S.failed.length ? '<span class="pill err" data-act="retry">' + ic('alert', 'sm') + S.failed.length + ' non enregistrée(s) · Réessayer</span>'
      : S.pending ? '<span class="pill"><span class="spin"></span><span class="txt">Enregistrement…</span></span>' : '<span class="pill d-only">' + ic('check', 'sm') + 'Enregistré</span>';
    el.innerHTML = '<button class="btn sm demo-btn" data-act="tour" title="Démo guidée : 2 minutes pour découvrir l\'outil" aria-label="Lancer la démo guidée">' + ic('play', 'sm') + '<span>Démo</span></button>' + sync + save + '<button class="btn icon sm d-only" data-act="refresh" title="Actualiser les données" aria-label="Actualiser">' + ic('refresh', 'sm') + '</button>';
  }

  const NAV_PILOT = ['Pilotage', [['dashboard', 'chart', 'Vue d\'ensemble'], ['activite', 'users', 'Équipe & activité'], ['previsions', 'sparkle', 'Prévisions & agent'], ['clients', 'folder', 'Dossiers']]];
  const NAV_SUIVI = ['Suivi', [['kpi', 'bars', 'Indicateurs'], ['history', 'clock', 'Historique'], ['export', 'download', 'Export & sauvegarde']]]; // V26.62
  const NAV = [
    ['Production', [['today', 'home', "Aujourd'hui"], ['planning', 'calendar', 'Planning'], ['receptions', 'inbox', 'Réceptions'], ['tva', 'file', 'TVA & autres impôts'], ['dashboards', 'gauge', 'Dashboard Clients'], ['team', 'users', 'Équipe']]],
    ['Recherche', [['search', 'search', 'Recherche']], false, true], // accessible par le bouton de recherche en haut du menu
    NAV_PILOT,
    NAV_SUIVI,
    ['Réglages', [['settings', 'sliders', 'Paramètres']]]
  ];
  const NAV_FLAT = NAV.reduce((a, s) => a.concat(s[1].map(n => n.concat([!!s[2]]))), []);
  const MANAGER_ONLY = ['team', 'dashboard', 'export', 'kpi', 'activite', 'previsions'];
  const navAllowed = r => r === 'export' ? isAdmin() : isManager() || !MANAGER_ONLY.includes(r);
  // V26.92 : collaborateur / apprenti — « Dossiers » rangé dans Production (pas de rubrique Pilotage)
  const NAV_COLLAB = [[NAV[0][0], NAV[0][1].concat([['clients', 'folder', 'Dossiers']])]].concat(NAV.slice(1).filter(s => s !== NAV_PILOT));
  const navSections = () => (isManager() ? [NAV_PILOT, NAV_SUIVI].concat(NAV.filter(s => s !== NAV_PILOT && s !== NAV_SUIVI)) : NAV_COLLAB); // manager : Pilotage avant Production
  const BOTTOM_ADMIN = [['today', 'home', "Aujourd'hui"], ['planning', 'calendar', 'Planning'], ['receptions', 'inbox', 'Réceptions'], ['team', 'users', 'Équipe'], ['more', 'menu', 'Plus']];
  const BOTTOM_COLLAB = [['today', 'home', "Aujourd'hui"], ['planning', 'calendar', 'Planning'], ['receptions', 'inbox', 'Réceptions'], ['clients', 'folder', 'Dossiers'], ['more', 'menu', 'Plus']];
  const bottomItems = () => (isManager() ? BOTTOM_ADMIN : BOTTOM_COLLAB);
  const TITLES = { today: "Aujourd'hui", planning: 'Planning', receptions: 'Réceptions', tva: 'TVA & autres impôts', team: 'Équipe', clients: 'Dossiers', search: 'Recherche', dashboard: 'Pilotage', dashboards: 'Dashboard Clients', kpi: 'Indicateurs', activite: 'Équipe & activité', previsions: 'Prévisions & agent', history: 'Historique', export: 'Export & sauvegarde', settings: 'Paramètres', more: 'Menu' };
  function updateBottomNav() {
    const nav = $('#bnav'); if (!nav) return;
    let idx = bottomItems().findIndex(n => n[0] === S.route); if (idx < 0 || S.drawer) idx = 4;
    nav.querySelectorAll('[data-i]').forEach(el => el.classList.toggle('on', Number(el.dataset.i) === idx));
    nav.querySelector('.ind').style.transform = 'translateX(' + (idx * 100) + '%)';
  }
  function navCounts() {
    const td = today(), cid = S.me.collaborator_id || S.collabId;
    return {
      today: list('tasks').filter(t => E.onDay(t, td) && !t.done && (!cid || t.collaborator_id === cid)).length,
      receptions: list('productions').filter(p => awaitingRec(p) && p.expected_date <= td && p.month >= E.addMonths(td.slice(0, 7), -1)).length,
      dashboard: isManager() ? alertsOf(engineData(), td, { month: S.month }).filter(a => a.level === 'bad').length + helpOffers().length + unseenPostpones().length : 0 // V26.42 : alertes + propositions d'aide en attente (V26.167 : + reports au lendemain pas encore vus)
    };
  }
  function sideHtml() {
    const r = S.route, cnt = navCounts(), x = ctx(), td = today(), w = E.windowOf(S.month, x.settings);
    let daysLeft = 0;
    for (let d = td > w.start ? td : w.start; d <= w.end; d = E.addDays(d, 1)) if (collabs().some(c => E.capacityOn(c, d, x) > 0)) daysLeft++;
    const fill = isManager() ? E.dashboard(engineData(), S.month, td).load.fill : 0;
    const sections = navSections().filter(s => !s[3] && (!s[2] || isManager()) && s[1].some(n => navAllowed(n[0]))).map(s => '<div class="nav-label">' + (isManager() || s[0] !== 'Pilotage' ? s[0] : 'Dossiers') + '</div>' + s[1].filter(n => navAllowed(n[0])).map(n => {
      const c = cnt[n[0]];
      return '<a class="nav' + (r === n[0] ? ' on' : '') + '" href="#/' + n[0] + '" title="' + n[2] + '">' + ic(n[1]) + '<span class="lbl">' + n[2] + '</span>' + (c ? '<span class="count' + (n[0] === 'dashboard' ? ' hot' : '') + '">' + c + '</span>' : '') + '</a>';
    }).join('')).join('');
    return '<div class="side-head"><button class="logo logo-btn" data-act="me-card" title="Mon compte" aria-label="Mon compte et déconnexion"><img src="logo-192.png" alt=""></button><div class="brand-t lbl">' + esc(CFG.APP_NAME || 'JB Flow') + '</div>'
      + '<button class="side-btn collapse-btn' + (S.navPinned ? ' on' : '') + '" data-act="side-pin" title="' + (S.navPinned ? 'Détacher : le menu se replie automatiquement' : 'Épingler le menu ouvert') + '" aria-label="Épingler le menu" aria-pressed="' + !!S.navPinned + '">' + ic('pin', 'sm') + '</button>'
      + '<button class="side-btn m-only" data-act="drawer-close" aria-label="Fermer le menu">' + ic('x', 'sm') + '</button></div>'
      + '<button class="side-search" data-act="go-search" title="Rechercher (Ctrl+K)">' + ic('search', 'sm') + '<span class="lbl">Rechercher…</span><kbd class="lbl">⌘K</kbd></button>'
      + '<a class="side-rec" href="#/receptions" title="Déclarer une réception"><span class="ri">' + ic('inbox', 'sm') + (cnt.receptions ? '<i>' + cnt.receptions + '</i>' : '') + '</span><span class="rt lbl"><b>Déclarer une réception</b><span>' + (cnt.receptions ? cnt.receptions + ' à valider · ' : '') + daysLeft + ' j ouvré' + (daysLeft > 1 ? 's' : '') + ' restant' + (daysLeft > 1 ? 's' : '') + (isManager() ? ' · équipe ' + fill + ' %' : '') + '</span></span>' + ic('chevR', 'sm lbl') + '</a>'
      + sections.replace('<div class="nav-label">Réglages</div>', '<div class="nav-label">Révision</div><span class="nav soon" title="Révision — bientôt disponible" aria-disabled="true">' + ic('review') + '<span class="lbl">Révision</span><span class="soon-b lbl">Bientôt</span></span><div class="nav-label">Réglages</div>')
      + '<div class="usercard"><span class="avatar">' + esc(initials(S.me.name)) + '<i class="online"></i></span><div class="who lbl"><b>' + esc(S.me.name) + '</b><span>' + roleLabel(S.me) + '</span></div>'
      + '<button class="side-btn m-only" data-act="theme" data-t="' + nextTheme() + '" aria-label="Changer de thème">' + ic(THEME_ICON[nextTheme()], 'sm') + '</button>'
      + '<button class="side-btn lbl" data-act="logout" title="Se déconnecter" aria-label="Se déconnecter">' + ic('logout', 'sm') + '</button></div>';
  }
  function topHtml() {
    const r = S.route;
    // V26.176 : un sous-titre sur chaque onglet du Pilotage — l'en-tête garde la même hauteur, les onglets ne sautent plus
    const sub = { planning: 'Organisation des tâches', receptions: 'Déclarez les éléments reçus en un geste', tva: 'Déclarations TVA, DEB, DES et acomptes d\'IS de vos dossiers', team: 'Niveau d\'activité et disponibilités de l\'équipe', clients: list('clients').length + ' dossiers', search: 'Clients, collaborateurs, missions', dashboard: 'Pilotage ' + deMonth(S.month), activite: 'Pilotage ' + deMonth(S.month), previsions: 'Pilotage · 3 prochains mois', kpi: 'Pilotage · 4 dernières semaines', history: isManager() ? 'Toutes les modifications' : 'Mes dossiers', export: 'Vos données, dans vos fichiers', settings: 'Équipe, utilisateurs et règles de planification' }[r] || '';
    return '<div class="title"><h1>' + esc(TITLES[r] || '') + '</h1>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>'
      + '<div class="top-actions"><div class="status" id="status"></div>'
      // V26.172 : icônes seules (le nom du thème s'affiche dans la bulle au survol)
      + '<div class="theme-switch top-themes d-only" role="group" aria-label="Thème">' + THEMES.map(t => '<button class="' + (S.theme === t[0] ? 'on' : '') + '" data-act="theme" data-t="' + t[0] + '" title="Thème ' + t[1] + '" aria-label="Thème ' + t[1] + '">' + ic(t[2], 'sm') + '</button>').join('') + '</div>'
      + '<button class="btn icon m-only-f" data-act="theme" data-t="' + nextTheme() + '" aria-label="Thème suivant : ' + THEMES.find(t => t[0] === nextTheme())[1] + '">' + ic(THEME_ICON[nextTheme()]) + '</button>'
      + '<button class="avatar top-av m-only-f" data-act="drawer" aria-label="Ouvrir le menu">' + esc(initials(S.me.name)) + '</button></div>';
  }
  // V26.62 : onglets en haut des pages du Pilotage (manager)
  const PILOT_TABS = [['dashboard', 'Vue d\'ensemble'], ['activite', 'Équipe & activité'], ['previsions', 'Prévisions & agent'], ['kpi', 'Indicateurs']];
  const pilotTabs = () => isManager() ? '<div class="seg pilot-tabs" role="tablist">' + PILOT_TABS.map(t => '<button role="tab" class="' + (S.route === t[0] ? 'on' : '') + '" data-act="go-route" data-r="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' : '';
  // V26.175 : 4e thème « Iris » — clair, aéré, accent pervenche, animations premium (fichier design-iris.css)
  ICONS.drop = '<path d="M12 3.2c3.3 4.1 6 7.4 6 10.6a6 6 0 0 1-12 0c0-3.2 2.7-6.5 6-10.6z"/>';
  const THEMES = [['signature', 'Signature', 'sparkle'], ['clair', 'Clair', 'sun'], ['nuit', 'Aurora', 'moon'], ['iris', 'Iris', 'drop']];
  const THEME_ICON = { signature: 'sparkle', clair: 'sun', nuit: 'moon', iris: 'drop' };
  const nextTheme = () => THEMES[(THEMES.findIndex(t => t[0] === S.theme) + 1) % THEMES.length][0];
  function setTheme(t) {
    S.theme = ['clair', 'nuit', 'iris'].includes(t) ? t : 'signature';
    // V26.47 : le thème Nuit « Aurora » reprend la structure en verre de Signature, recolorée (data-variant) ;
    // V26.175 : « Iris » reprend la base du thème Clair (data-variant="iris"), sans menu sombre ni couleur d'accent au choix
    const root = document.documentElement;
    root.dataset.theme = S.theme === 'nuit' ? 'signature' : S.theme === 'iris' ? 'clair' : S.theme;
    if (S.theme === 'nuit') root.dataset.variant = 'aurora'; else if (S.theme === 'iris') root.dataset.variant = 'iris'; else delete root.dataset.variant;
    const sd = lsGet('planif-side'); if (S.theme === 'clair' && (sd === 'dark' || sd === 'color')) root.dataset.side = sd; else delete root.dataset.side;
    lsSet('planif-theme', S.theme);
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = { signature: '#ECEBE6', clair: '#F2F4F9', nuit: '#07060D', iris: '#EEF0F8' }[S.theme];
    render();
  }

  /* Micro-interactions : compteurs animés et points de pagination des carrousels */
  const shownCounts = new Map();
  function fmtVal(v, f) { if (f && f[0] === 'n') { const [d, suf, pre] = f.slice(1).split('|'); return (pre || '') + Number(v).toFixed(Number(d) || 0).replace('.', ',') + (suf || ''); } return f === 'min' ? E.fmtMin(Math.round(v)) : f === 'pct' ? Math.round(v) + ' %' : String(Math.round(v)); }
  function animateCounts(root) {
    root.querySelectorAll('[data-count]').forEach(el => {
      const to = Number(el.dataset.count), f = el.dataset.fmt, key = el.dataset.key || '';
      // V26.174 : data-t0 / data-dur = animation déjà commencée (anneau du mois) — on la reprend là où elle en est
      const T0 = Number(el.dataset.t0) || 0, dur = Number(el.dataset.dur) || FX.SLOW; // V26.176 : transition numérique rapide (280 ms)
      const from = T0 ? 0 : shownCounts.has(key) ? shownCounts.get(key) : 0;
      shownCounts.set(key, to);
      if (from === to || reducedMotion() || document.hidden || (T0 && performance.now() - T0 >= dur)) { el.textContent = fmtVal(to, f); return; }
      const t0 = T0 || performance.now();
      const step = now => { if (!el.isConnected) return; const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmtVal(from + (to - from) * e, f); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  function syncDots(car) {
    const dots = car.nextElementSibling;
    if (!dots || !dots.hasAttribute('data-dots')) return;
    const n = car.children.length;
    if (dots.children.length !== n) dots.innerHTML = '<i></i>'.repeat(n);
    const first = car.children[0], w = first ? first.getBoundingClientRect().width + 12 : 1;
    const idx = Math.min(n - 1, Math.max(0, Math.round(car.scrollLeft / w)));
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === idx));
  }
  document.addEventListener('scroll', e => { const c = e.target; if (c && c.classList && c.classList.contains('carousel')) syncDots(c); }, true);
  function viewHtml() {
    try {
      switch (S.route) {
        case 'planning': return vPlanning();
        case 'receptions': return vReceptions();
      case 'tva': return monthNavRow() + (filingsSectionF(S.month) || '<div class="section-t"><h2>Suivi TVA</h2></div><div class="empty">Aucune déclaration pour ce mois.</div>') + isSectionF() + cfeSectionF() + cvaeSectionF();
        case 'team': return vTeam();
        case 'clients': return vClients();
        case 'search': return vSearch();
        case 'dashboard': return vDashboard();
        case 'activite': case 'previsions': return vDashboard();
        case 'dashboards': return vDashboards();
        case 'history': return vHistory();
        case 'kpi': return vKpi();
        case 'export': return vExport();
        case 'settings': return vSettings();
        case 'more': return vMore();
        default: return vToday();
      }
    } catch (e) { console.error(e); return '<div class="notice bad">Erreur d\'affichage : ' + esc(errMsg(e)) + '</div>'; }
  }

  /* ---------- Composants ---------- */
  function collabChips(opts) {
    opts = opts || {};
    const cs = visibleCollabs();
    if (!cs.length || (!isManager() && cs.length < 2)) return '';
    return '<div class="chips scroll" data-keep="chips-' + S.route + '">' + (opts.pre || '') + (opts.all ? '<button class="chip' + (!S.collabId ? ' on' : '') + '" data-act="collab" data-id="">Tous</button>' : '')
      + cs.map(c => '<button class="chip' + (S.collabId === c.id && !opts.none ? ' on' : '') + '" data-act="collab" data-id="' + c.id + '"><span class="mini-av" style="background:' + esc(c.color || '#888') + '">' + esc(initials(c.name)) + '</span>' + esc(c.name) + (c.id === S.me.collaborator_id ? '<span class="small" style="opacity:.6">moi</span>' : '') + '</button>').join('') + '</div>';
  }
  function monthNav() {
    return '<div class="month-pill"><button data-act="month" data-d="-1" aria-label="Mois précédent"' + (prevBlocked('month') ? ' disabled title="Premier mois d\'utilisation de JB Flow (modifiable dans Paramètres)"' : '') + '>' + ic('chevL', 'sm') + '</button><b class="cap">' + fMonth(S.month) + '</b><button data-act="month" data-d="1" aria-label="Mois suivant">' + ic('chevR', 'sm') + '</button></div>';
  }
  /* Tâches présentes un jour donné (un dossier étalé apparaît chaque jour de sa répartition) */
  function dayTasks(collabId, date) {
    return list('tasks').filter(t => E.onDay(t, date) && (!collabId || t.collaborator_id === collabId))
      .sort((a, b) => (a.collaborator_id || '').localeCompare(b.collaborator_id || '') || (a.seq - b.seq) || E.KINDS.indexOf(a.kind) - E.KINDS.indexOf(b.kind));
  }
  function withTimes(tasks, date) {
    const m = E.parseClock(cfg().day_start), by = {};
    return tasks.map(t => { const k = t.collaborator_id; if (!(k in by)) by[k] = m; const st = by[k]; by[k] += E.minutesOn(t, date) || 0; return { t, time: E.fmtClock(st), date }; });
  }
  function prodLine(p) {
    if (!p) return '';
    if (p.received_date) return 'Éléments reçus le ' + fDM(p.received_date);
    return 'Prévisionnel — éléments attendus le ' + fDM(p.expected_date);
  }
  /* Durée affichée : pour un dossier étalé, la part du jour et la position (« 7h · jour 1/2 »). */
  function durLabel(t, date, short) {
    if (!E.hasAlloc(t) || !date) return E.fmtMin(t.duration_min);
    const s = E.segs(t), i = s.findIndex(x => x.d === date);
    if (i < 0) return E.fmtMin(t.duration_min);
    return E.fmtMin(s[i].m) + (short ? ' · ' + (i + 1) + '/' + s.length : ' sur ' + E.fmtMin(t.duration_min) + ' · jour ' + (i + 1) + '/' + s.length);
  }
  /* Carte tâche. o : {time, date, showDate, showCollab, mini, drag, i (ordre d'apparition), swipe:false} */
  function taskRow(t, o) {
    o = o || {};
    const c = clientOf(t.client_id) || { name: '?' }, p = S.data.productions.get(t.production_id);
    const forecast = p && !E.isReceived(t, p) && t.kind !== 'info', td = today();
    const end = E.endDate(t);
    const late = !t.done && end && end < td;
    const after = !t.done && end && t.due_date && end > t.due_date;
    const edit = canEditTask(t);
    const cls = 'task k-' + t.kind + (t.done ? ' done' : '') + (forecast ? ' forecast' : '') + (t._unsaved ? ' unsaved' : '') + (t._failed ? ' failed' : '')
      + (o.mini ? ' mini' : '') + (o.time ? '' : ' nt') + (S.flash.has(t.id) ? ' flash' : '') + (S.justDone.has(t.id) ? ' just-done' : '');
    const drag = o.drag && edit && !t.locked && !t.done ? ' draggable="true" data-drag="' + t.id + '"' : '';
    // V26.166 : date de réalisation (tâche faite) ou des parties déjà faites (tâche scindée, réception partielle)
    const doneDay = t.done && t.done_at ? atDay(t.done_at) : '';
    const partDays = !t.done && t.kind !== 'info' && t.production_id ? (pIdx().tasks.get(t.production_id) || []).filter(x => x.id !== t.id && x.kind === t.kind && x.done && x.done_at).map(x => atDay(x.done_at)).sort() : [];
    const strip = doneDay ? '<div class="done-strip">' + ic('check', 'sm') + 'Faite le ' + fDate(doneDay) + (t.planned_date && t.planned_date !== doneDay && !E.hasAlloc(t) ? ' <span>(prévue le ' + fDM(t.planned_date) + ')</span>' : '') + '</div>'
      : partDays.length ? '<div class="done-strip part">' + ic('clock', 'sm') + (partDays.length > 1 ? partDays.length + ' parties faites : ' + partDays.map(fDM).join(', ') : 'Partie faite le ' + fDate(partDays[0])) + ' · reste à finir</div>' : '';
    if (o.mini) return '<div class="' + cls + '" data-act="task" data-id="' + t.id + '"' + drag + '><div class="tname">' + (t.locked ? ic('lock', 'sm') + ' ' : '') + esc(c.name) + '</div><div class="meta"><span class="kind"><i></i>' + (t.kind === 'info' ? 'Demande' : durLabel(t, o.date, true)) + '</span>' + (t.kind === 'info' ? '<span>' + E.fmtMin(t.duration_min) + '</span>' : '') + '<span class="long">' + (forecast ? 'prévu' : '') + (t.done ? 'fait' + (doneDay ? ' le ' + Number(doneDay.slice(8)) + '/' + doneDay.slice(5, 7) : '') : partDays.length ? 'suite' : '') + '</span>' + (late ? '<b style="color:var(--warn)">à reprendre</b>' : '') + '</div></div>';
    const meta = [];
    if (o.showDate) meta.push(t.planned_date ? '<span class="cap">' + fShort(t.planned_date) + (E.hasAlloc(t) && end !== t.planned_date ? ' → ' + fShort(end) : '') + '</span><span>·</span>' : '<span class="badge r">Non planifiée</span>');
    meta.push('<span class="kind"><i></i>' + E.KIND_LABEL[t.kind] + ' · ' + durLabel(t, o.date) + '</span>');
    if (o.showCollab) { const co = collabOf(t.collaborator_id); meta.push('<span>· ' + esc(co ? co.name : 'Sans collaborateur') + '</span>'); }
    if (t.kind === 'production' && !t.done && isNewDossier(c) && newMarginPct() > 0) meta.push('<span class="badge o" title="Nouveau dossier (coché le ' + fDMY(c.new_since) + ') : temps de production prévu majoré de ' + newMarginPct() + ' % pendant 3 mois">Nouveau dossier +' + newMarginPct() + ' %</span>');
    if (isManager() && !t.done && t.kind === 'production') { const rk = riskOf(t.production_id); if (rk && rk.level === 'eleve') meta.push('<span class="badge r" title="' + esc(rk.why.join(' · ')) + '">Risque élevé</span>'); }
    if (t.kind === 'dashboard') meta.push('<span class="badge b">' + (t.published_at ? 'Publié' : 'À publier avant le ' + fDM(t.due_date)) + '</span>');
    if (t.part === 'recu') meta.push('<span class="badge b">' + ic('inbox') + 'Partie reçue le ' + fDM(t.received_date) + '</span>');
    if (t.part === 'reste' && forecast) meta.push('<span class="badge">Reste attendu</span>');
    if (forecast) meta.push('<span class="badge"' + predictTitle(p) + '>' + ic('calendar') + (isManager() ? 'Prévu · attendus le ' + Number((p.expected_date || '').slice(8)) + expHint(p) : 'Éléments attendus vers le ' + Number((p.expected_date || '').slice(8)) + ' · rien à faire pour l\'instant') + '</span>' + (S.readonly ? '' : '<button class="badge b act" data-act="rec-one" data-id="' + p.id + '" title="Déclarer les éléments reçus aujourd\'hui">' + ic('inbox') + 'Reçu</button>' + (S.v7 ? '<button class="badge act" data-act="rec-part" data-id="' + p.id + '" title="Une partie seulement des éléments est arrivée">Partiel</button>' : '')));
    if (t.kind === 'production' || E.KINDS.indexOf(t.kind) < 3) E.obligations(c, t.month, cfg()).filter(o => o.code !== 'CA3').forEach(o => meta.push('<span class="badge b">' + o.label + ' · ' + fDM(o.due) + '</span>'));
    if (t.kind !== 'info' && p && p.info_request === 'a_faire') meta.push('<span class="badge o">' + ic('mail') + 'Demande à faire</span>');
    if (t.locked) meta.push(canEditTask(t) && !S.readonly ? '<button class="badge k lock-btn" data-act="lock" data-id="' + t.id + '" title="Cliquer pour déverrouiller">' + ic('lock') + 'Verrouillée<span class="lock-x">· déverrouiller</span></button>' : '<span class="badge k">' + ic('lock') + 'Verrouillée</span>'); // V26.143 : déverrouiller d'un clic
    if (late) meta.push('<span class="badge o">À reprendre</span>');
    if (after) meta.push('<span class="badge r">Après échéance</span>');
    if (!t.done && t.due_date) meta.push('<span class="badge' + (E.daysBetween(td, t.due_date) <= cfg().due_soon_days ? ' o' : '') + '">Éch. ' + fDM(t.due_date) + '</span>');
    if (t._unsaved) meta.push('<span class="badge o">Enregistrement…</span>');
    if (t._failed) meta.push('<span class="badge r">Non enregistrée</span>');
    const anim = o.i !== undefined ? ' style="--i:' + o.i + '"' : '';
    const row = '<div class="' + cls + (o.i !== undefined && !(edit && o.swipe !== false) ? ' anim-in' : '') + '" data-act="task" data-id="' + t.id + '"' + drag + (edit && o.swipe !== false ? '' : anim) + '>'
      + (o.time ? '<div class="time">' + o.time + '</div>' : '')
      + '<div style="min-width:0">' + strip + '<div class="tname">' + esc(c.name) + '</div><div class="meta">' + meta.join('') + '</div></div>'
      + '<button class="check" ' + (edit ? 'data-act="done" data-id="' + t.id + '"' : 'disabled') + ' title="' + (t.done ? 'Rouvrir' : 'Terminer') + '" aria-label="' + (t.done ? 'Rouvrir la tâche' : 'Terminer la tâche') + '">' + CHECK_SVG + '</button></div>';
    if (!edit || o.swipe === false) return row;
    return '<div class="swipe' + (forecast && !t.done ? ' swipe-recv' : '') + (o.i !== undefined ? ' anim-in' : '') + '" data-swipe="' + t.id + '"' + anim + '><div class="swipe-bg"><span class="l">' + (forecast && !t.done ? ic('inbox') + 'Éléments reçus' : ic('check') + (t.done ? 'Rouvrir' : 'Terminer')) + '</span><span class="r">' + (t.locked ? 'Déverrouiller' : 'Verrouiller') + ic('lock') + '</span></div>' + row + '</div>';
  }
  /* Une carte par tâche (le regroupement de missions n'a plus lieu d'être : temps unique par dossier). */
  function unitsOf(items) { return items.map(x => ({ tasks: [x.t], time: x.time, date: x.date })); }
  function unitRow(u, o) { return taskRow(u.tasks[0], Object.assign({}, o, { time: u.time, date: u.date })); }
  function groupTasks(pid, date, cid) { return list('tasks').filter(t => t.production_id === pid && (t.planned_date || '') === (date || '') && (t.collaborator_id || '') === (cid || '')).sort((a, b) => E.KINDS.indexOf(a.kind) - E.KINDS.indexOf(b.kind)); }
  const groupKey = ts => 'g:' + ts[0].production_id + ':' + (ts[0].planned_date || '') + ':' + (ts[0].collaborator_id || '');
  function groupFromKey(k) { const p = k.split(':'); return groupTasks(p[1], p[2], p[3]); }
  function groupRow(ts, o) {
    o = o || {};
    const t0 = ts[0], c = clientOf(t0.client_id) || { name: '?' }, p = S.data.productions.get(t0.production_id);
    const forecast = p && !ts.some(t => E.isReceived(t, p)), td = today();
    const done = ts.every(t => t.done), anyLocked = ts.some(t => t.locked), allLocked = ts.every(t => t.locked);
    const late = !done && t0.planned_date && t0.planned_date < td;
    const dur = ts.reduce((s, t) => s + (Number(t.duration_min) || 0), 0), durTodo = ts.filter(t => !t.done).reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
    const edit = ts.every(canEditTask), key = groupKey(ts);
    const kinds = '<span class="kinds">' + ts.map(t => '<i class="k-' + t.kind + (t.done ? ' done' : '') + '"></i>').join('') + '</span>';
    const labels = ts.map(t => E.KIND_LABEL[t.kind]).join(' + ');
    const cls = 'task merged' + (done ? ' done' : '') + (forecast ? ' forecast' : '') + (o.mini ? ' mini' : '') + (o.time ? '' : ' nt')
      + (ts.some(t => t._unsaved) ? ' unsaved' : '') + (ts.some(t => t._failed) ? ' failed' : '') + (ts.some(t => S.flash.has(t.id)) ? ' flash' : '') + (ts.some(t => S.justDone.has(t.id)) ? ' just-done' : '');
    const drag = o.drag && edit && !anyLocked && !done ? ' draggable="true" data-drag="' + key + '"' : '';
    const attrs = 'data-act="group" data-key="' + key + '"'; // V26.167 : plus de bulle au survol des cartes
    if (o.mini) return '<div class="' + cls + '" ' + attrs + drag + '><div class="tname">' + (anyLocked ? ic('lock', 'sm') + ' ' : '') + esc(c.name) + '</div><div class="meta">' + kinds + ' ' + E.fmtMin(dur) + '<span class="long">' + (forecast ? ' · prévu' : '') + (done ? ' · fait' : '') + '</span>' + (late ? ' · <b style="color:var(--bad)">retard</b>' : '') + '</div></div>';
    const meta = ['<span class="kind">' + kinds + labels + '</span><span>· ' + E.fmtMin(dur) + (durTodo && durTodo !== dur ? ' (reste ' + E.fmtMin(durTodo) + ')' : '') + '</span>'];
    if (forecast) meta.push('<span class="badge"' + predictTitle(p) + '>' + ic('calendar') + 'Prévu · attendus le ' + Number((p.expected_date || '').slice(8)) + '</span>');
    if (allLocked) meta.push('<span class="badge k">' + ic('lock') + 'Verrouillé</span>'); else if (anyLocked) meta.push('<span class="badge k">' + ic('lock') + 'En partie verrouillé</span>');
    if (p && p.info_request === 'a_faire') meta.push('<span class="badge o">' + ic('mail') + 'Demande à faire</span>');
    if (late) meta.push('<span class="badge r">Retard</span>');
    if (!done && t0.due_date) meta.push('<span class="badge' + (E.daysBetween(td, t0.due_date) <= cfg().due_soon_days ? ' o' : '') + '">Éch. ' + fDM(t0.due_date) + '</span>');
    const anim = o.i !== undefined ? ' style="--i:' + o.i + '"' : '';
    const row = '<div class="' + cls + (o.i !== undefined && !edit ? ' anim-in' : '') + '" ' + attrs + drag + (edit ? '' : anim) + '>'
      + (o.time ? '<div class="time">' + o.time + '</div>' : '')
      + '<div style="min-width:0">' + strip + '<div class="tname">' + esc(c.name) + '</div><div class="meta">' + meta.join('') + '</div></div>'
      + '<button class="check" ' + (edit ? 'data-act="done-group" data-key="' + key + '"' : 'disabled') + ' title="' + (done ? 'Rouvrir le dossier' : 'Terminer le dossier') + '" aria-label="' + (done ? 'Rouvrir le dossier' : 'Terminer le dossier') + '">' + CHECK_SVG + '</button></div>';
    if (!edit) return row;
    return '<div class="swipe' + (o.i !== undefined ? ' anim-in' : '') + '" data-swipe="' + key + '"' + anim + '><div class="swipe-bg"><span class="l">' + ic('check') + (done ? 'Rouvrir' : 'Terminer') + '</span><span class="r">' + (allLocked ? 'Déverrouiller' : 'Verrouiller') + ic('lock') + '</span></div>' + row + '</div>';
  }

  /* ====================== V26.176 : système de mouvement commun (tous les thèmes) ======================
   * Une seule source pour les durées et la courbe, reprises par design-motion.css (--fast, --medium, --slow, --easing)
   * et par ui-v2.js (window.JBFX) :
   *   FAST 140 ms : survol, appui, petits changements d'état · MEDIUM 200 ms : onglets, fenêtres, données
   *   SLOW 280 ms : grands déplacements · EASING cubic-bezier(.22, 1, .36, 1), sans rebond.
   * Uniquement opacity et transform ; rien ne bloque la saisie ; tout est coupé si « moins d'animations » est demandé.
   * La page est toujours redessinée en entier : juste avant, on note la place des éléments de données (tâches, lignes,
   * alertes…) ; juste après, seuls ceux qui ont changé bougent — nouveaux : fondu + 4 px (cascade très légère),
   * déplacés : glissement depuis leur ancienne place, modifiés : courte transition d'état. La structure ne bouge pas.
   * Ce fichier ne fait que définir : rien n'y est exécuté au chargement (l'ordre d'assemblage peut varier). */
  const FX = { FAST: 140, MEDIUM: 200, SLOW: 280, RIPPLE: 380, EASING: 'cubic-bezier(.22, 1, .36, 1)', EXIT: 'cubic-bezier(.4, 0, 1, 1)', STAGGER: 30 };
  window.JBFX = FX;
  const fxOn = () => !reducedMotion() && !document.hidden;

  /* ---------- Données qui changent ---------- */
  const FX_ITEMS = '.swipe[data-swipe], .task[data-id], [data-act="group"][data-key], tr[data-id], tr[data-act][data-task], .up-row, .info-row, .risk-row, .alert, .rec, .collab-card, .sg-tip, .cap-li, .gbar, .notice';
  // Identité stable d'un élément d'un affichage à l'autre (même dossier, même tâche…) ; doublons numérotés dans l'ordre
  function fxKey(el, seen) {
    const d = el.dataset;
    let id = d.swipe || d.id || d.task || d.pid || d.client || (d.act === 'group' ? d.key : '');
    if (!id) { const c = el.querySelector('[data-id], [data-pid], [data-task]'); id = c ? c.dataset.id || c.dataset.pid || c.dataset.task : (el.textContent || '').trim().slice(0, 48); }
    if (!id) return '';
    const k = (el.classList[0] || el.tagName) + ':' + id + (d.date ? '@' + d.date : '');
    const n = seen[k] = (seen[k] || 0) + 1;
    return n > 1 ? k + '#' + n : k;
  }
  // Signature d'état (lignes uniquement : les tâches ont déjà leurs propres effets — terminée, mise à jour par un collègue)
  const fxSig = el => el.matches('.task, .swipe, [data-act="group"]') ? '' : el.className.replace(/\b(anim-in|fx-in|fx-upd)\b/g, '').replace(/\s+/g, ' ') + '|' + el.textContent;
  function fxSnapshot(scope) {
    if (!scope || !fxOn()) return null;
    const els = scope.querySelectorAll(FX_ITEMS); if (els.length > 900) return null; // liste vide : tout ce qui arrive est nouveau
    const snap = new Map(), seen = {}, sx = scrollX, sy = scrollY;
    els.forEach(el => {
      const k = fxKey(el, seen); if (!k) return;
      const r = el.getBoundingClientRect(); if (!r.width && !r.height) return;
      snap.set(k, { x: r.left + sx, y: r.top + sy, sig: fxSig(el), t: el._fxT || 0 });
    });
    return snap;
  }
  function fxApply(scope, snap) {
    if (!snap || !scope) return;
    const now = performance.now(), sx = scrollX, sy = scrollY, H = innerHeight, seen = {}, items = [];
    scope.querySelectorAll(FX_ITEMS).forEach(el => { const k = fxKey(el, seen); if (k) items.push({ el, k, r: el.getBoundingClientRect() }); });
    const done = new Set(), inside = el => { for (let p = el.parentElement; p && p !== scope; p = p.parentElement) if (done.has(p)) return true; return false; };
    const drop = S.fxDrop && now - S.fxDrop.t < 700 ? S.fxDrop : null; S.fxDrop = null;
    const moves = [], pulses = []; let fresh = 0, kept = 0, seenVis = 0;
    for (const { el, k, r } of items) {
      if (!r.width && !r.height) continue;
      const vis = r.bottom > -40 && r.top < H + 40, p = snap.get(k);
      if (p) kept++;
      if (inside(el)) continue;
      // Élément déposé : il glisse de l'endroit où on l'a lâché jusqu'à sa place (et la carte « se pose »)
      if (drop && (el.dataset.swipe === drop.id || el.dataset.id === drop.id || (el.dataset.act === 'group' && el.dataset.key === drop.id))) {
        const dx = drop.x - r.left, dy = drop.y - r.top;
        if (Math.abs(dx) + Math.abs(dy) > 2) el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1.02)', boxShadow: '0 10px 22px -14px rgba(17, 19, 15, .4)' }, { transform: 'none' }], { duration: FX.MEDIUM, easing: FX.EASING });
        done.add(el); continue;
      }
      if (!p) { // nouveau : fondu + 4 px, cascade de 12 ms (10 niveaux au plus), seulement s'il est à l'écran
        if (vis) { const i = Math.min(fresh++, 10); el.classList.add('fx-in'); el.style.setProperty('--fx-i', i); el._fxT = now + i * 12; done.add(el); }
        continue;
      }
      if (p.t && now < p.t + FX.MEDIUM) { el.classList.add('fx-in'); el.style.animationDelay = Math.round(p.t - now) + 'ms'; el._fxT = p.t; done.add(el); continue; } // apparition pas finie : on la poursuit
      const dx = p.x - (r.left + sx), dy = p.y - (r.top + sy), wasVis = p.y - sy > -40 && p.y - sy < H + 40;
      if (vis || wasVis) seenVis++;
      if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) { if (vis || wasVis) moves.push({ el, dx, dy }); continue; }
      if (vis && p.sig && p.sig !== fxSig(el)) pulses.push(el);
    }
    // Tout a glissé d'un bloc sans ajout ni retrait (bandeau apparu en haut…) : simple décalage, pas d'animation
    const same = moves.length >= 3 && moves.length === seenVis && !fresh && kept === snap.size && moves.every(m => Math.abs(m.dx - moves[0].dx) < 1 && Math.abs(m.dy - moves[0].dy) < 1);
    if (!same && moves.length <= 80) moves.forEach(m => { if (inside(m.el)) return; m.el.animate([{ transform: 'translate(' + m.dx + 'px,' + m.dy + 'px)' }, { transform: 'none' }], { duration: FX.MEDIUM, easing: FX.EASING }); done.add(m.el); });
    pulses.forEach(el => { if (!inside(el)) el.classList.add('fx-upd'); });
  }
  // Mise à jour d'une seule zone (recherche, filtre) : même principe, limité à cette zone
  function fxSwap(el, html) { const snap = fxSnapshot(el); el.innerHTML = html; fxApply(el, snap); }
  // Petits groupes (notifications) : les voisins glissent à leur nouvelle place au lieu de sauter
  function fxFlip(parent, change) {
    if (!parent || !fxOn()) { change(); return; }
    const kids = [...parent.children], before = new Map(kids.map(k => [k, k.getBoundingClientRect()]));
    change();
    kids.forEach(k => { if (!k.isConnected) return; const a = before.get(k), b = k.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top; if (Math.abs(dx) + Math.abs(dy) > 1) k.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: FX.MEDIUM, easing: FX.EASING }); });
  }

  /* ---------- Fenêtres et notifications : fermeture = ouverture inversée, plus rapide ---------- */
  function fxClose(root, after) {
    if (!root) return;
    if (!fxOn() || !root.isConnected) { root.remove(); if (after) after(); return; }
    root.classList.add('closing');
    setTimeout(() => { root.remove(); if (after) after(); }, FX.FAST);
  }
  function fxToastOut(el) {
    if (!el || !el.isConnected || el.classList.contains('out')) return;
    if (!fxOn()) { el.remove(); return; }
    el.classList.add('out');
    setTimeout(() => fxFlip(el.parentElement, () => el.remove()), FX.FAST);
  }

  /* ---------- V26.179 : effet de clic « ripple », dans toute l'application ----------
   * Un petit cercle aux couleurs du thème apparaît exactement sous le pointeur, s'agrandit en 380 ms et s'efface.
   * Il n'intercepte rien (pointer-events: none) : aucun bouton ne change de fonctionnement. Branché dans 13-evenements.js. */
  const fxRipples = [];
  function fxRipple(x, y) {
    if (!fxOn()) return;
    const r = document.createElement('span'); r.className = 'fx-ripple'; r.setAttribute('aria-hidden', 'true');
    r.style.left = x + 'px'; r.style.top = y + 'px';
    document.body.appendChild(r); fxRipples.push(r);
    if (fxRipples.length > 6) fxRipples.shift().remove(); // clics très rapides : jamais plus de 6 cercles à la fois
    const done = () => { r.remove(); const i = fxRipples.indexOf(r); if (i >= 0) fxRipples.splice(i, 1); };
    r.addEventListener('animationend', done, { once: true }); setTimeout(done, FX.RIPPLE * 2);
  }

  /* ---------- Glisser-déposer ---------- */
  // La carte saisie est montrée mise en avant (échelle 1,02, ombre discrète, liseré d'accent) sous le curseur
  function fxDragStart(el, e) {
    const r = el.getBoundingClientRect(); S.fxGrab = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    if (!fxOn() || !e.dataTransfer || !e.dataTransfer.setDragImage) return;
    const box = document.createElement('div'); box.className = 'fx-drag-img'; box.setAttribute('aria-hidden', 'true');
    const c = el.cloneNode(true); c.removeAttribute('id'); c.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    c.classList.remove('dragging', 'fx-in', 'fx-upd', 'anim-in'); c.style.width = r.width + 'px';
    box.appendChild(c); document.body.appendChild(box);
    try { e.dataTransfer.setDragImage(box, S.fxGrab.dx * 1.02 + 10, S.fxGrab.dy * 1.02 + 10); } catch (er) { /* image par défaut du navigateur */ }
    requestAnimationFrame(() => box.remove());
  }
  // Au dépôt : on retient où la carte a été lâchée, l'affichage suivant la fait glisser de là jusqu'à sa place
  function fxDrop(id, e) { const g = S.fxGrab || { dx: 16, dy: 16 }; S.fxDrop = { id, x: e.clientX - g.dx, y: e.clientY - g.dy, t: performance.now() }; }

  /* ---------- Curseur de démonstration (démo guidée), réutilisable ----------
   * Se déplace en douceur (interpolation, courbe commune), marque une courte pause, montre un clic discret
   * (cercle de 300 ms), puis l'action a lieu. Il s'ajoute au vrai curseur de la souris, sans jamais le remplacer. */
  const DemoCursor = {
    el: null, x: 0, y: 0, anim: null, to: null, wait: null, hintT: 0,
    mount(parent) {
      if (this.el && this.el.isConnected) return this.el;
      const el = this.el = document.createElement('div'); el.className = 'fx-cursor'; el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<svg viewBox="0 0 22 22"><path d="M2 1 2 17.6 6.4 13.7 9.3 20.1 12.5 18.7 9.6 12.4 15.7 12.1Z"/></svg>';
      (parent || document.body).appendChild(el);
      if (!this.x && !this.y) { this.x = innerWidth / 2; this.y = innerHeight * .6; }
      this.place(this.x, this.y); return el;
    },
    place(x, y) { this.x = x; this.y = y; if (this.el) this.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)'; },
    moveTo(x, y) {
      const el = this.mount();
      if (this.anim && this.to && Math.hypot(x - this.to[0], y - this.to[1]) < 2) return this.wait; // déjà en route vers ce point
      if (this.anim) { const m = new DOMMatrixReadOnly(getComputedStyle(el).transform); this.anim.cancel(); this.anim = null; this.place(m.m41, m.m42); }
      const x0 = this.x, y0 = this.y, d = Math.hypot(x - x0, y - y0);
      this.place(x, y); el.classList.add('on');
      if (!fxOn() || d < 2) return Promise.resolve();
      const a = this.anim = el.animate([{ transform: 'translate3d(' + x0 + 'px,' + y0 + 'px,0)' }, { transform: 'translate3d(' + x + 'px,' + y + 'px,0)' }], { duration: Math.round(Math.min(560, Math.max(FX.SLOW, d * .55))), easing: FX.EASING });
      this.to = [x, y];
      return (this.wait = a.finished.then(() => { if (this.anim === a) this.anim = null; }, () => {}));
    },
    pause(ms) { return new Promise(r => setTimeout(r, ms === undefined ? 140 : ms)); },
    click() {
      const el = this.el; if (!el || !el.classList.contains('on') || !fxOn()) return Promise.resolve();
      const ring = document.createElement('i'); ring.className = 'fx-cur-ring'; el.appendChild(ring);
      el.classList.add('press'); setTimeout(() => el.classList.remove('press'), 110);
      return new Promise(r => setTimeout(() => { ring.remove(); r(); }, 300));
    },
    // Déplacement → pause → clic → action (ex. ouvrir une fiche)
    async tap(target, action) {
      const b = target.getBoundingClientRect();
      await this.moveTo(b.left + Math.min(b.width / 2, 60), b.top + b.height / 2);
      await this.pause(); await this.click();
      if (action) action();
    },
    hint(on) { clearInterval(this.hintT); this.hintT = on ? setInterval(() => this.click(), 2400) : 0; }, // rappel discret « clique ici »
    hide() { this.hint(false); if (this.el) this.el.classList.remove('on'); },
    destroy() { this.hint(false); if (this.anim) this.anim.cancel(); this.anim = null; this.to = null; if (this.el) this.el.remove(); this.el = null; }
  };
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
      + '<label class="f"><span>Durée / jour (vide = journée)</span><input type="text" id="abs-min" placeholder="ex. 3h30"></label><label class="f"><span>Précision (ex. séminaire, réunion d\'équipe)</span><input type="text" id="abs-note" placeholder="Formation TVA, réunion interne…"></label></div>'
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
  async function replanAbsence(cid, from, to) {
    const hit = list('tasks').filter(t => t.collaborator_id === cid && !t.done && !t.locked && E.segs(t).some(s => s.d >= from && s.d <= to));
    if (hit.length) await saveMany('tasks', hit.map(t => ({ id: t.id, patch: { planned_date: null, alloc: null, seq: 0 } })));
    let moved = 0;
    for (const m of new Set(hit.map(t => t.month))) { const r = runPlan(m, 'incremental', new Set(hit.filter(t => t.month === m).map(t => t.production_id).filter(Boolean))); moved += r.moved.length; await applyPlan(r); }
    return hit.length;
  }

  /* ====================== Équipes : manager, RC, collaborateurs ====================== */
  /* Qui fait la production / le tableau de bord d'un dossier : son collaborateur, ou le RC de ce collaborateur */
  function doerOf(c, which) {
    if (!c) return null;
    const co = collabOf(c.collaborator_id);
    const base = c[which + '_by'] === 'rc' && co && co.kind !== 'rc' && co.rc_id ? co.rc_id : (c.collaborator_id || null);
    // V26.74 : dossier coché « Apprenti » → la production va à l'apprenti de la personne qui la fait
    if (which === 'production' && c.apprenti) { const ap = apprenticeFor(c); if (ap) return ap.id; }
    return base;
  }
  function apprenticeFor(c) {
    if (!c) return null;
    const co = collabOf(c.collaborator_id);
    const base = c.production_by === 'rc' && co && co.kind !== 'rc' && co.rc_id ? co.rc_id : c.collaborator_id;
    return apprenticesOf(base)[0] || apprenticesOf(c.collaborator_id)[0] || null;
  }
  function assignDoers(tasks) { tasks.forEach(t => { const c = clientOf(t.client_id); if (c) t.collaborator_id = doerOf(c, t.kind === 'dashboard' ? 'dashboard' : 'production'); }); return tasks; }
  const hasRc = c => { const co = c && collabOf(c.collaborator_id); return !!(co && co.kind !== 'rc' && co.rc_id); };
  const collabKind = c => (c && c.kind === 'rc' ? (collabs(true).some(x => x.rc_id === c.id) ? 'RC' : 'RC hybride') : 'Collaborateur');
  function teamsCard() {
    if (!S.v8) return '<div class="card"><h2 style="margin-bottom:10px">Équipes</h2><div class="notice warn">Exécutez une fois <b>supabase/migration_v1_8.sql</b> dans Supabase (SQL Editor) pour activer les équipes, les rôles Manager / RC, les Dashboard Clients et le chiffrement.</div></div>';
    const users = list('app_users'), teams = list('teams').sort(byName);
    return '<div class="card"><div class="card-h"><h2>Équipes</h2><button class="btn primary" data-act="team-new">+ Équipe</button></div>'
      + (teams.length ? '<table class="t stack"><thead><tr><th>Équipe</th><th>Manager</th><th>Membres</th><th>Binômes</th></tr></thead><tbody>' + teams.map(tm => {
        const mem = collabs(true).filter(c => c.team_id === tm.id), mg = users.find(u => u.id === tm.manager_id);
        const bin = mem.filter(c => c.kind === 'rc').map(rc => esc(rc.name) + ' + ' + (mem.filter(c => c.rc_id === rc.id).map(c => esc(c.name)).join(', ') || '<i>hybride</i>')).join(' · ');
        return '<tr class="click" data-act="team-edit" data-id="' + tm.id + '"><td class="first"><b>' + esc(tm.name) + '</b></td><td data-l="Manager">' + esc(mg ? mg.name : '—') + '</td><td data-l="Membres">' + mem.length + '</td><td data-l="Binômes" class="small">' + (bin || '—') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="empty">Aucune équipe. Une équipe = un manager + ses RC et collaborateurs ; chaque collaborateur peut être relié à son RC (binôme).</div>') + '</div>';
  }
  function sheetTeam(s) {
    const tm = S.data.teams.get(s.id); if (!tm) return '';
    const mgrs = list('app_users').filter(u => u.active && (u.role === 'manager' || u.role === 'admin')).sort(byName);
    return sheetHead('Équipe · ' + esc(tm.name))
      + '<div class="sheet-b"><div class="form"><label class="f"><span>Nom de l\'équipe</span><input type="text" data-ch="team-field" data-k="name" value="' + esc(tm.name) + '"></label>'
      + '<label class="f"><span>Manager</span><select data-ch="team-field" data-k="manager_id"><option value="">—</option>' + mgrs.map(u => '<option value="' + u.id + '"' + (u.id === tm.manager_id ? ' selected' : '') + '>' + esc(u.name) + ' (' + roleLabel(u) + ')</option>').join('') + '</select></label></div>'
      + '<div><h3 style="margin-bottom:8px">Membres</h3><div class="tasks">' + collabs(true).map(c => '<label class="info-row" style="cursor:pointer"><input type="checkbox" data-ch="team-member" data-id="' + c.id + '"' + (c.team_id === tm.id ? ' checked' : '') + '><div class="t"><b>' + esc(c.name) + '</b><span>' + collabKind(c) + (c.rc_id ? ' · binôme de ' + esc((collabOf(c.rc_id) || {}).name || '?') : '') + (c.team_id && c.team_id !== tm.id ? ' · actuellement dans ' + esc((S.data.teams.get(c.team_id) || {}).name || '?') : '') + '</span></div></label>').join('') + '</div>'
      + '<p class="small muted">Fonction (RC / collaborateur) et binôme se règlent sur la fiche de chaque collaborateur (Paramètres › Collaborateurs).</p></div></div>'
      + '<div class="sheet-f"><button class="btn danger" data-act="team-del" data-id="' + tm.id + '">Supprimer l\'équipe</button><span class="spacer"></span><span class="small muted">Enregistrement automatique</span><button class="btn" data-act="close">Fermer</button></div>';
  }

  /* ====================== Chiffrement des noms de clients ======================
   * Le nom et les particularités de chaque dossier sont chiffrés (AES-GCM 256) dans le navigateur avant d'être
   * envoyés à la base : Supabase ne stocke que du texte illisible. La clé est dérivée d'une phrase secrète du cabinet
   * (PBKDF2, 250 000 itérations) et mémorisée sur chaque appareil après la première saisie. Sans la phrase, les noms
   * sont irrécupérables. */
  const ENC = 'enc1:', CRYPTO = { key: null, salt: null, alt: [], cache: new Map(), pending: new Set(), blocked: false };
  const ENC_FIELDS = ['name', 'notes', 'is_data'];
  const cryptoCfg = () => ((S.data.settings.get('crypto') || {}).value) || null;
  const b64e = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(salt), iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  async function encStr(s) {
    if (!CRYPTO.key || s === null || s === undefined || s === '' || (typeof s === 'string' && s.startsWith(ENC))) return s;
    const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, CRYPTO.key, new TextEncoder().encode(String(s))));
    const b = new Uint8Array(12 + ct.length); b.set(iv); b.set(ct, 12);
    const out = ENC + b64e(b); CRYPTO.cache.set(out, String(s)); return out;
  }
  // Déchiffre avec une clé précise (lève une erreur si ce n'est pas la bonne clé)
  async function decWith(key, s) { const b = b64d(s.slice(ENC.length)); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12))); }
  // V26.162 : la clé du cabinet d'abord, puis les clés de secours gardées sur cet appareil (ancienne phrase)
  async function decStr(s) {
    if (typeof s !== 'string' || !s.startsWith(ENC)) return s;
    if (CRYPTO.cache.has(s)) return CRYPTO.cache.get(s);
    if (!CRYPTO.key) return null;
    for (const k of [CRYPTO.key].concat(CRYPTO.alt.map(a => a.key))) { try { const v = await decWith(k, s); CRYPTO.cache.set(s, v); return v; } catch (e) { /* clé suivante */ } }
    return null;
  }
  /* Ligne « clients » reçue de la base : noms en clair en mémoire (jamais renvoyés tels quels) */
  function decClient(row) {
    if (!row) return row;
    const r = Object.assign({}, row);
    ENC_FIELDS.forEach(k => {
      const v = r[k]; if (typeof v !== 'string' || !v.startsWith(ENC)) return;
      r['_enc_' + k] = v;
      if (CRYPTO.cache.has(v)) r[k] = CRYPTO.cache.get(v);
      else { r[k] = k === 'name' ? '🔒 Dossier chiffré' : ''; if (CRYPTO.key && !CRYPTO.pending.has(v)) { CRYPTO.pending.add(v); decStr(v).then(() => { CRYPTO.pending.delete(v); const cur = S.data.clients.get(r.id); if (cur) { S.data.clients.set(r.id, decClient(Object.assign({}, cur, { [k]: cur['_enc_' + k] || cur[k] }))); scheduleRender(); } }); } }
    });
    return r;
  }
  async function encClientPatch(p) {
    if (!CRYPTO.key) return p;
    const o = Object.assign({}, p);
    for (const k of ENC_FIELDS) if (k in o) o[k] = await encStr(o[k]);
    return o;
  }
  async function decryptAllClients() {
    const rows = list('clients');
    await Promise.all(rows.flatMap(r => ENC_FIELDS.map(k => decStr(r['_enc_' + k] || r[k]))));
    rows.forEach(r => S.data.clients.set(r.id, decClient(Object.assign({}, r, { name: r._enc_name || r.name, notes: r._enc_notes !== undefined ? r._enc_notes : r.notes, is_data: r._enc_is_data !== undefined ? r._enc_is_data : r.is_data }))));
  }
  /* Clés mémorisées sur l'appareil : « planif-ck » = clé du cabinet ; « planif-ck-alt » = clés précédentes (V26.162),
   * gardées pour qu'aucune donnée ne devienne illisible ici pendant ou après un changement de phrase. */
  const keyRaw = async key => b64e(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
  const keyImport = raw => crypto.subtle.importKey('raw', b64d(raw), 'AES-GCM', true, ['encrypt', 'decrypt']);
  function deviceSlots() {
    const out = [];
    try { const k = JSON.parse(lsGet('planif-ck') || 'null'); if (k && k.salt && k.k) out.push(k); } catch (e) { /* illisible */ }
    try { const a = JSON.parse(lsGet('planif-ck-alt') || '[]'); if (Array.isArray(a)) a.forEach(k => { if (k && k.salt && k.k && !out.some(x => x.salt === k.salt)) out.push(k); }); } catch (e) { /* illisible */ }
    return out;
  }
  async function checkKey(key, cc) { try { return (await decWith(key, cc.check)) === 'jbflow-ok'; } catch (e) { return false; } }
  async function loadDeviceKey(cc) {
    try {
      const slots = deviceSlots(), main = slots.find(k => k.salt === cc.salt);
      if (main) {
        const key = await keyImport(main.k);
        if (await checkKey(key, cc)) {
          CRYPTO.key = key; CRYPTO.salt = cc.salt; CRYPTO.alt = [];
          for (const k of slots) if (k !== main) { try { CRYPTO.alt.push({ salt: k.salt, key: await keyImport(k.k) }); } catch (e) { /* clé illisible : ignorée */ } }
          return true;
        }
      }
    } catch (e) { /* clé absente ou illisible */ }
    CRYPTO.key = null; CRYPTO.salt = null; return false;
  }
  async function saveDeviceKey(salt) { lsSet('planif-ck', JSON.stringify({ salt, k: await keyRaw(CRYPTO.key) })); }
  function pushAltRaw(slot) {
    let a = []; try { a = JSON.parse(lsGet('planif-ck-alt') || '[]'); if (!Array.isArray(a)) a = []; } catch (e) { a = []; }
    a = a.filter(k => k && k.salt !== slot.salt); a.unshift({ salt: slot.salt, k: slot.k });
    lsSet('planif-ck-alt', JSON.stringify(a.slice(0, 4)));
  }
  async function rememberAltKey(salt, key) { pushAltRaw({ salt, k: await keyRaw(key) }); }
  // Fait de la clé correspondant au réglage « crypto » (la base fait foi) la clé principale de cet appareil
  async function alignTo(v) {
    if (!v || !v.salt || !CRYPTO.key) return false;
    if (CRYPTO.salt === v.salt) return true;
    const cand = CRYPTO.alt.find(a => a.salt === v.salt);
    if (!cand || !(await checkKey(cand.key, v))) return false;
    if (CRYPTO.salt) await rememberAltKey(CRYPTO.salt, CRYPTO.key);
    CRYPTO.alt = [{ salt: CRYPTO.salt, key: CRYPTO.key }].concat(CRYPTO.alt.filter(a => a !== cand && a.salt !== CRYPTO.salt));
    CRYPTO.key = cand.key; CRYPTO.salt = v.salt; await saveDeviceKey(v.salt);
    return true;
  }
  /* Écran de déverrouillage (première connexion sur un appareil) */
  function unlockScreen() {
    return new Promise(resolve => {
      const cc = cryptoCfg();
      $('#app').innerHTML = '<div class="login"><div class="card" style="max-width:460px"><h1>' + ic('lock') + ' Dossiers chiffrés</h1><p>Les noms des clients sont chiffrés. Saisis la <b>phrase secrète du cabinet</b> (une seule fois sur cet appareil).</p>'
        + '<form id="unlock"><label class="f"><span>Phrase secrète</span><input type="password" id="ul-pass" autocomplete="off" required></label><div class="notice bad" id="ul-err" style="display:none">Phrase secrète incorrecte.</div><button class="btn primary big" style="width:100%;margin-top:12px">Déverrouiller</button></form>'
        + '<p class="small muted" style="margin-top:12px">Tu ne la connais pas ? Demande-la à l\'administrateur du cabinet. Elle a peut-être été changée récemment.</p><button class="btn" data-act="logout">Se déconnecter</button></div></div>';
      setTimeout(() => { const i = $('#ul-pass'); if (i) i.focus(); }, 50);
      $('#unlock').onsubmit = async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Vérification…';
        let key = null; try { key = await deriveKey($('#ul-pass').value, cc.salt); } catch (er) { key = null; }
        if (key && await checkKey(key, cc)) {
          let prev = null; try { prev = JSON.parse(lsGet('planif-ck') || 'null'); } catch (er) { prev = null; }
          if (prev && prev.salt && prev.k && prev.salt !== cc.salt) pushAltRaw(prev); // ancienne clé gardée en secours
          CRYPTO.key = key; CRYPTO.salt = cc.salt; await saveDeviceKey(cc.salt); CRYPTO.alt = [];
          for (const k of deviceSlots()) if (k.salt !== cc.salt) { try { CRYPTO.alt.push({ salt: k.salt, key: await keyImport(k.k) }); } catch (er) { /* ignorée */ } }
          if (document.activeElement) document.activeElement.blur(); $('#app').innerHTML = '<div class="boot">Chargement…</div>'; resolve();
        }
        else { CRYPTO.key = null; $('#ul-err').style.display = ''; btn.disabled = false; btn.textContent = 'Déverrouiller'; }
      };
    });
  }
  function securityCard() {
    const cc = cryptoCfg();
    return '<div class="card"><div class="card-h"><h2>' + ic('lock', 'sm') + ' Confidentialité des dossiers</h2>' + (cc ? '<span class="badge g">' + ic('check') + 'Chiffrement actif</span>' : '<span class="badge o">Non chiffré</span>') + '</div>'
      + '<p class="small">JB Flow ne conserve aucune information client en dehors du <b>nom de l\'entreprise</b> (et des particularités si tu en saisis). ' + (cc ? 'Ces informations sont <b>chiffrées</b> : la base Supabase ne contient que du texte illisible. Chaque utilisateur saisit la phrase secrète une fois par appareil.' : 'Active le chiffrement pour qu\'en cas de fuite de la base, aucun nom de client ne soit lisible.') + '</p>'
      + (cc ? '<div class="row" style="flex-wrap:wrap;gap:8px"><span class="small muted">Activé le ' + esc(fDateTime(cc.at)) + (cc.changed_at ? ' · phrase changée le ' + esc(fDateTime(cc.changed_at)) : '') + '</span><span class="spacer"></span>'
        + (CRYPTO.key ? '<button class="btn sm" data-act="crypto-check">Vérifier le chiffrement</button><button class="btn sm primary" data-act="crypto-change">' + ic('lock', 'sm') + 'Changer la phrase secrète</button>' : '')
        + '<button class="btn sm" data-act="crypto-forget">Oublier la phrase sur cet appareil</button></div>'
        + (CRYPTO.key ? '<p class="small muted" style="margin-top:8px">Phrase oubliée ? Tant que cet appareil est déverrouillé, « Changer la phrase secrète » en définit une nouvelle sans connaître l\'ancienne.</p>' : '')
        : '<div class="notice warn small"><b>Important</b> : conserve la phrase secrète en lieu sûr. Si elle est perdue, les noms des clients ne pourront plus être lus (les plannings restent intacts, et un nouvel import Excel permet de les renommer).</div><button class="btn primary" data-act="crypto-enable">' + ic('lock', 'sm') + 'Activer le chiffrement des noms</button>') + '</div>';
  }
  async function enableCrypto() {
    if (!isAdmin() || cryptoCfg()) return;
    const pass = await passDialog(); if (!pass) return;
    const salt = b64e(crypto.getRandomValues(new Uint8Array(16)));
    CRYPTO.key = await deriveKey(pass, salt); CRYPTO.salt = salt;
    const check = await encStr('jbflow-ok');
    try { await saveInsert('settings', [{ id: 'crypto', value: { v: 1, salt, check, at: new Date().toISOString() } }]); } catch (e) { CRYPTO.key = null; CRYPTO.salt = null; return; }
    await saveDeviceKey(salt);
    const res = await saveMany('clients', list('clients').map(c => ({ id: c.id, patch: { name: c.name, notes: c.notes || null } })));
    hist('parametres', { detail: { text: 'Chiffrement des noms de clients activé (' + res.ok + ' dossier(s))' } });
    toast('Chiffrement activé : ' + res.ok + ' dossier(s) chiffré(s). Communique la phrase secrète à ton équipe.', 'ok', null, 9000);
    render();
  }
  /* V26.162 : saisie d'une phrase secrète (activation ou changement) */
  function passDialog(o) {
    o = o || {};
    return new Promise(resolve => {
      const root = document.createElement('div'); root.className = 'overlay anim center';
      root.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" style="width:min(520px,100%)"><div class="sheet-h"><div style="margin-right:auto"><h2>' + esc(o.title || 'Phrase secrète du cabinet') + '</h2><div class="small muted" style="margin-top:4px">12 caractères minimum. Elle ne sera jamais envoyée à Supabase.</div></div></div>'
        + '<div class="sheet-b">' + (o.notice || '') + '<label class="f"><span>' + esc(o.label || 'Phrase secrète') + '</span><input type="password" id="pp1" autocomplete="new-password"></label><label class="f"><span>Confirmer</span><input type="password" id="pp2" autocomplete="new-password"></label>'
        + (o.confirmNoted ? '<label class="row small" style="gap:8px;cursor:pointer"><input type="checkbox" id="pp3"> J\'ai noté la nouvelle phrase en lieu sûr (gestionnaire de mots de passe, coffre du cabinet).</label>' : '')
        + '<div class="notice bad" id="pp-err" style="display:none"></div></div>'
        + '<div class="sheet-f"><button class="btn" data-x="cancel">Annuler</button><button class="btn primary" data-x="ok">' + ic('lock', 'sm') + esc(o.ok || 'Chiffrer les dossiers') + '</button></div></div>';
      const done = v => { fxClose(root); resolve(v); };
      root.addEventListener('click', e => {
        const x = e.target.closest('[data-x]'); if (!x && e.target !== root) return;
        if (!x || x.dataset.x !== 'ok') return done(null);
        const a = root.querySelector('#pp1').value, b = root.querySelector('#pp2').value, er = root.querySelector('#pp-err'), noted = root.querySelector('#pp3');
        if (a.length < 12) { er.textContent = '12 caractères minimum.'; er.style.display = ''; return; }
        if (a !== b) { er.textContent = 'Les deux saisies sont différentes.'; er.style.display = ''; return; }
        if (noted && !noted.checked) { er.textContent = 'Coche la case pour confirmer que la nouvelle phrase est notée en lieu sûr.'; er.style.display = ''; return; }
        done(a);
      });
      document.body.appendChild(root);
      setTimeout(() => root.querySelector('#pp1').focus(), 50);
    });
  }
  /* Fenêtre d'attente bloquante pendant une opération longue */
  function busyBox(title, text) {
    const root = document.createElement('div'); root.className = 'overlay anim center';
    root.innerHTML = '<div class="sheet sheet-confirm" role="alertdialog" aria-modal="true" aria-live="polite"><div class="sheet-h"><h2>' + esc(title) + '</h2></div><div class="sheet-b"><p class="bx-t">' + esc(text) + '</p><p class="small muted">Ne ferme pas cette page.</p></div></div>';
    document.body.appendChild(root);
    return { set: t => { const p = root.querySelector('.bx-t'); if (p) p.textContent = t; }, close: () => fxClose(root) };
  }

  /* ====================== V26.162 : changer la phrase secrète ======================
   * Depuis un appareil déverrouillé, sans connaître l'ancienne phrase : chaque nom, particularité et donnée IS est
   * déchiffré avec la clé de cet appareil puis rechiffré avec la nouvelle, et vérifié ligne par ligne. La nouvelle clé
   * n'est publiée (réglage « crypto ») qu'une fois TOUS les dossiers rechiffrés ; sinon tout revient à l'ancienne clé.
   * Les deux clés restent sur cet appareil : aucune donnée ne peut y devenir illisible. */
  const storedOf = (r, k) => (r['_enc_' + k] !== undefined ? r['_enc_' + k] : r[k]);
  async function underKey(key, v) {
    if (v === undefined || v === null || v === '') return true;
    if (typeof v !== 'string' || !v.startsWith(ENC)) return false; // texte en clair : à chiffrer
    try { await decWith(key, v); return true; } catch (e) { return false; }
  }
  // Remet toutes les informations chiffrées sous la clé actuelle (plusieurs passages : conflits, coupures réseau)
  async function reencryptAll(onStep, passes) {
    const scan = async () => {
      const items = []; let fields = 0, unreadable = 0;
      for (const r of list('clients')) {
        const patch = {};
        for (const k of ENC_FIELDS) {
          const v = storedOf(r, k);
          if (await underKey(CRYPTO.key, v)) continue;
          fields++;
          const plain = await decStr(v);
          if (plain === null) { unreadable++; continue; }
          patch[k] = plain;
        }
        if (Object.keys(patch).length) items.push({ id: r.id, patch });
      }
      return { items, fields, unreadable };
    };
    let sc = await scan();
    for (let pass = 0; pass < (passes || 5) && sc.items.length; pass++) {
      if (onStep) onStep(sc.items.length);
      if (pass) await new Promise(res => setTimeout(res, 400 * pass)); // petite pause avant de réessayer
      await saveMany('clients', sc.items, { quiet: true });
      sc = await scan();
    }
    return { remaining: sc.fields, unreadable: sc.unreadable };
  }
  const allUnderKey = async row => { for (const k of ENC_FIELDS) if (!(await underKey(CRYPTO.key, storedOf(row, k)))) return false; return true; };
  function dropFailed(table, id) { for (let i = S.failed.length - 1; i >= 0; i--) if (S.failed[i].table === table && (!id || S.failed[i].id === id)) S.failed.splice(i, 1); }
  // Après un retour à l'ancienne clé : les échecs d'enregistrement devenus sans objet sont retirés
  async function tidyFailedClients() {
    for (let i = S.failed.length - 1; i >= 0; i--) {
      const f = S.failed[i]; if (f.table !== 'clients') continue;
      const row = S.data.clients.get(f.id);
      if (row && await allUnderKey(row)) { S.failed.splice(i, 1); const b = Object.assign({}, row); delete b._failed; S.data.clients.set(f.id, b); }
    }
    renderStatus();
  }
  async function changePassphrase() {
    const cc = cryptoCfg(), before = Object.assign({}, S.data.settings.get('crypto'));
    if (!isAdmin() || !cc || !CRYPTO.key) return;
    if (S.readonly) { toast('Mode lecture seule : la base est inaccessible, changement impossible pour le moment.', 'bad'); return; }
    if (S.pending || S.failed.length) { toast('Des enregistrements sont en cours ou en échec : attends la fin (ou clique « Réessayer ») avant de changer la phrase.', 'warn'); return; }
    if (!(await alignTo(cc))) { toast('La clé de cet appareil ne correspond pas à celle du cabinet : recharge la page avant de changer la phrase.', 'bad'); return; }
    // 1. Tout doit être lisible avec les clés de cet appareil : sinon, on ne touche à rien
    let unreadable = 0;
    for (const r of list('clients')) for (const k of ENC_FIELDS) { const v = storedOf(r, k); if (typeof v === 'string' && v.startsWith(ENC) && (await decStr(v)) === null) unreadable++; }
    if (unreadable) { toast(unreadable + ' information(s) ne peuvent pas être lues sur cet appareil : changement annulé, rien n\'a été modifié.', 'bad', null, 12000); return; }
    const pass = await passDialog({ title: 'Nouvelle phrase secrète', label: 'Nouvelle phrase secrète', ok: 'Changer la phrase', confirmNoted: true,
      notice: '<div class="notice warn small" style="margin-bottom:10px"><b>Avant de valider</b> : l\'ancienne phrase n\'est pas nécessaire, cet appareil est déverrouillé. Pendant l\'opération (une minute environ), personne d\'autre ne doit modifier de dossier. Ensuite, chaque appareil, y compris ceux de l\'équipe, demandera la nouvelle phrase une fois.</div>' });
    if (!pass) return;
    const oldKey = CRYPTO.key, oldSalt = CRYPTO.salt, since = new Date(Date.now() - 5 * 60000).toISOString();
    const busy = busyBox('Changement de la phrase secrète', 'Préparation de la nouvelle clé…');
    try {
      const salt = b64e(crypto.getRandomValues(new Uint8Array(16)));
      const newKey = await deriveKey(pass, salt);
      // les deux clés restent sur cet appareil jusqu'au bout : aucune donnée ne peut y devenir illisible
      await rememberAltKey(oldSalt, oldKey);
      CRYPTO.alt = [{ salt: oldSalt, key: oldKey }].concat(CRYPTO.alt.filter(a => a.salt !== oldSalt && a.salt !== salt));
      CRYPTO.key = newKey; CRYPTO.salt = salt; await saveDeviceKey(salt);
      // 2. Rechiffrement et vérification de chaque dossier
      const r = await reencryptAll(n => busy.set('Rechiffrement de ' + n + ' dossier(s)…'));
      // 3. La nouvelle clé n'est publiée qu'une fois tout rechiffré
      let st = 'failed';
      if (!r.remaining) {
        busy.set('Enregistrement de la nouvelle clé…');
        const value = Object.assign({}, cc, { salt, check: await encStr('jbflow-ok'), changed_at: new Date().toISOString() });
        for (let i = 0; i < 3 && st !== 'ok'; i++) st = await saveUpdate('settings', 'crypto', { value }, { quiet: true });
        if (st !== 'ok') { // la base a peut-être reçu la nouvelle clé malgré l'erreur : on vérifie avant de décider
          try {
            const ch = await S.store.changesSince(since);
            const row = (ch.settings || []).find(x => x.id === 'crypto');
            if (row && row.value && row.value.salt === salt) { dropFailed('settings', 'crypto'); S.data.settings.set('crypto', row); st = 'ok'; }
          } catch (e) { st = 'offline'; }
        }
      }
      if (st === 'ok') {
        cacheSnapshot();
        hist('parametres', { detail: { text: 'Phrase secrète du cabinet changée : ' + list('clients').length + ' dossier(s) rechiffré(s)' } });
        busy.close(); render();
        toast('Phrase secrète changée. Note-la en lieu sûr et communique-la à ton équipe : chaque appareil la demandera une fois.', 'ok', null, 12000);
        return;
      }
      if (st === 'offline') {
        busy.close(); render();
        toast('Connexion perdue pendant l\'enregistrement de la nouvelle clé. Rien n\'est perdu : cet appareil garde l\'ancienne et la nouvelle clé. Quand la connexion revient, clique « Réessayer » pour terminer le changement.', 'warn', { label: 'Réessayer', fn: retryFailed }, 20000);
        return;
      }
      // 4. Échec certain (réseau, droits) : tout revient à l'ancienne clé, qui reste valable pour tout le monde
      busy.set('Échec : retour à l\'ancienne clé…');
      dropFailed('settings', 'crypto'); if (before && before.id) S.data.settings.set('crypto', before);
      await rememberAltKey(salt, newKey);
      CRYPTO.alt = [{ salt, key: newKey }].concat(CRYPTO.alt.filter(a => a.salt !== oldSalt && a.salt !== salt));
      CRYPTO.key = oldKey; CRYPTO.salt = oldSalt; await saveDeviceKey(oldSalt);
      const back = await reencryptAll(n => busy.set('Retour à l\'ancienne clé : ' + n + ' dossier(s)…'), 8);
      await tidyFailedClients();
      busy.close(); cacheSnapshot(); render();
      toast('Changement annulé : ' + (r.remaining ? r.remaining + ' information(s) n\'ont pas pu être rechiffrées' : 'la nouvelle clé n\'a pas pu être enregistrée') + ' (réseau ou droits). L\'ancienne phrase reste en place'
        + (back.remaining ? ' ; ' + back.remaining + ' information(s) restent à remettre en ordre : relance « Vérifier le chiffrement » quand la connexion sera rétablie.' : ', rien n\'est perdu.'), 'bad', null, 15000);
    } catch (e) { busy.close(); throw e; }
  }
  async function verifyCrypto() {
    if (!isAdmin() || !cryptoCfg() || !CRYPTO.key) return;
    if (S.readonly) { toast('Mode lecture seule : vérification impossible pour le moment.', 'bad'); return; }
    if (!(await alignTo(cryptoCfg()))) { toast('La clé de cet appareil ne correspond pas à celle du cabinet : recharge la page et saisis la phrase.', 'bad'); return; }
    const busy = busyBox('Vérification du chiffrement', 'Contrôle de chaque dossier…');
    try {
      const r = await reencryptAll(n => busy.set('Rechiffrement de ' + n + ' dossier(s)…'));
      await tidyFailedClients();
      busy.close(); cacheSnapshot(); render();
      if (!r.remaining) toast('Tout est en ordre : chaque information est chiffrée avec la phrase actuelle.', 'ok');
      else toast(r.remaining + ' information(s) restent à corriger' + (r.unreadable ? ', dont ' + r.unreadable + ' illisible(s) sur cet appareil' : '') + '.', 'warn', null, 12000);
    } catch (e) { busy.close(); throw e; }
  }
  /* La phrase a été changée ailleurs : si cet appareil a déjà la bonne clé (changement fait ici), il l'adopte ;
   * sinon il s'arrête (aucune écriture avec l'ancienne clé) et demande de recharger pour saisir la nouvelle phrase. */
  async function cryptoWatch(row) {
    const v = row && row.value;
    if (!v || !v.salt || !CRYPTO.salt || v.salt === CRYPTO.salt || CRYPTO.blocked) return;
    if (await alignTo(v)) return;
    CRYPTO.blocked = true; S.readonly = true;
    const root = document.createElement('div'); root.className = 'overlay anim center';
    root.innerHTML = '<div class="sheet sheet-confirm" role="alertdialog" aria-modal="true"><div class="sheet-h"><h2>Phrase secrète changée</h2></div><div class="sheet-b"><p>Un administrateur vient de changer la phrase secrète du cabinet. Recharge JB Flow, puis saisis la nouvelle phrase pour continuer.</p></div><div class="sheet-f"><button class="btn primary" data-x="reload">Recharger</button></div></div>';
    root.addEventListener('click', e => { if (e.target.closest('[data-x="reload"]')) location.reload(); });
    document.body.appendChild(root);
  }

  /* ====================== Tableaux de bord clients ====================== */
  /* Crée les tableaux de bord manquants et met à jour ceux à faire (mois de production en cours et suivant) */
  /* V26.180 : un tableau de bord par client et par mois, jamais plus.
   * Les doublons venaient de passages simultanés (chaque champ modifié dans la fiche relançait la création, en plus du
   * démarrage) : les passages sont désormais faits l'un après l'autre, les créations en cours sont réservées,
   * et les doublons déjà enregistrés sont supprimés (on garde le publié, sinon le terminé, sinon le premier créé). */
  const dashKey = t => t.client_id + '|' + t.month;
  const dashGroups = ts => { const g = new Map(); ts.forEach(t => { const k = dashKey(t); if (!g.has(k)) g.set(k, []); g.get(k).push(t); }); return g; };
  const isOpen = t => !t.done && !t.published_at;
  /* V26.181 : distinguer un vrai doublon d'une tâche scindée (« non terminée en totalité » : partie faite + reste à faire).
     Doublons = plusieurs exemplaires encore à faire alors que rien n'est commencé, ou des exemplaires à faire alors qu'un
     exemplaire complet est déjà terminé. Une partie faite plus courte que le temps prévu signale une scission : rien n'est retiré. */
  function dashExtra(g) {
    const c = clientOf(g[0].client_id), full = Number(c && c.dashboard_min) || 0, open = g.filter(isOpen);
    if (g.length < 2 || !open.length) return [];
    if (open.length === g.length) return open.slice().sort((a, b) => (a.planned_date || '9').localeCompare(b.planned_date || '9')).slice(1);
    const doneFull = g.some(t => !isOpen(t) && (!full || Number(t.duration_min) >= full));
    return doneFull ? open.filter(t => !full || Number(t.duration_min) >= full) : [];
  }
  function dashUnique(ts) { // pour l'affichage : une ligne par client et par mois (le reste d'une tâche scindée reste visible)
    const hide = new Set(); dashGroups(ts).forEach(g => dashExtra(g).forEach(t => hide.add(t.id)));
    const g2 = dashGroups(ts.filter(t => !hide.has(t.id))), best = new Map();
    g2.forEach((g, k) => best.set(k, g.find(t => t.published_at) || g.find(isOpen) || g[0]));
    return ts.filter(t => best.get(dashKey(t)) === t);
  }
  async function dedupeDashboards() {
    if (!S.v8 || S.readonly || !isAdmin()) return 0; // seuls les administrateurs peuvent supprimer une tâche (droits Supabase)
    let n = 0;
    for (const g of dashGroups(list('tasks').filter(t => t.kind === 'dashboard')).values()) for (const t of dashExtra(g)) if (await saveRemove('tasks', t.id)) n++;
    if (n) { hist('dossier', { detail: { text: n + ' tableau(x) de bord en double supprimé(s)' } }); toast(n + ' tableau(x) de bord en double supprimé(s).', 'ok', null, 4000); }
    return n;
  }
  /* V26.181 : demandes d'informations — une seule par dossier et par mois (tout membre peut retirer une demande en double) */
  async function dedupeInfoTasks() {
    if (S.readonly) return 0;
    const g = new Map(); list('tasks').filter(t => t.kind === 'info' && t.production_id).forEach(t => { if (!g.has(t.production_id)) g.set(t.production_id, []); g.get(t.production_id).push(t); });
    let n = 0;
    for (const arr of g.values()) {
      if (arr.length < 2) continue;
      const keep = arr.find(t => t.done) || arr[0];
      for (const t of arr) if (t !== keep && !t.done && canEditTask(t) && await saveRemove('tasks', t.id)) n++;
    }
    return n;
  }
  S.dashPending = new Set(); // créations de tableaux de bord en cours d'enregistrement (client|mois)
  const dashFree = ts => ts.filter(t => !S.dashPending.has(dashKey(t)));
  let dashChain = Promise.resolve();
  function syncDashboards() { const run = dashChain.then(syncDashboardsNow, syncDashboardsNow); dashChain = run.catch(() => { }); return run; }
  async function syncDashboardsNow() {
    if (!S.v8 || S.readonly || !isManager()) return;
    await dedupeDashboards();
    const months = [defaultMonth(), E.addMonths(defaultMonth(), 1)], st = cfg(), created = [], upd = [];
    for (const m of months) {
      created.push(...assignDoers(dashFree(E.buildDashboards(m, list('clients'), list('tasks'), st, P.uuid))));
      const mt = list('tasks').filter(t => t.kind === 'dashboard' && t.month === m);
      mt.filter(t => !t.done).forEach(t => {
        const d = E.dashboardFor(clientOf(t.client_id), m, st), c = clientOf(t.client_id) || {};
        // V26.181 : le temps complet n'est remis que sur un tableau de bord unique — jamais sur le reste d'une tâche scindée
        const single = mt.filter(x => x.client_id === t.client_id).length === 1;
        const patch = {}; if (d && t.due_date !== d.due) patch.due_date = d.due; if (d && single && t.duration_min !== Number(c.dashboard_min)) patch.duration_min = Number(c.dashboard_min);
        if (Object.keys(patch).length) upd.push({ id: t.id, patch });
      });
    }
    if (created.length) { created.forEach(t => S.dashPending.add(dashKey(t))); try { await saveInsert('tasks', created); } catch (e) { return; } finally { created.forEach(t => S.dashPending.delete(dashKey(t))); } }
    if (upd.length) await saveMany('tasks', upd);
    for (const m of new Set(created.concat(upd.map(u => S.data.tasks.get(u.id) || {})).map(t => t.month).filter(Boolean))) { const res = runPlan(m, 'incremental', new Set()); if (!isManager()) res.changes = res.changes.filter(ch => { const t = S.data.tasks.get(ch.id); return t && canSeeCollab(t.collaborator_id); }); await applyPlan(res); }
    if (created.length) toast(created.length + ' tableau(x) de bord client planifié(s).', 'ok', null, 4000);
  }
  function vDashboards() {
    if (!S.v8) return '<div class="notice warn">Les Dashboard Clients nécessitent la mise à jour de la base : exécutez une fois <b>supabase/migration_v1_8.sql</b> dans Supabase.</div>';
    const m = S.month, td = today();
    const ts = dashUnique(list('tasks').filter(t => t.kind === 'dashboard' && t.month === m && (isAdmin() || canSeeCollab(t.collaborator_id)))) // V26.180 : une ligne par client
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '') || byName(clientOf(a.client_id) || {}, clientOf(b.client_id) || {}));
    const n = { todo: ts.filter(t => !t.done).length, done: ts.filter(t => t.done && !t.published_at).length, pub: ts.filter(t => t.published_at).length };
    const noTime = isManager() ? list('clients').filter(c => c.active !== false && c.dashboard_freq && !(Number(c.dashboard_min) > 0)) : [];
    const per = t => { const c = clientOf(t.client_id) || {}; if (!t.period) return ''; if (c.dashboard_freq === 'trimestriel') { const q = Math.ceil(Number(t.period.slice(5, 7)) / 3); return (q === 1 ? '1er' : q + 'e') + ' trimestre ' + t.period.slice(0, 4); } return fMonth(t.period); };
    const rows = ts.map(t => {
      const c = clientOf(t.client_id) || { name: '?' }, co = collabOf(t.collaborator_id), j = t.due_date ? E.daysBetween(td, t.due_date) : null;
      const st = t.published_at ? '<span class="badge g">' + ic('check') + 'Publié le ' + fDM(t.published_at.slice(0, 10)) + '</span>' : t.done ? '<span class="badge b">Fait · à publier</span>' : '<span class="badge">À faire</span>';
      const acts = !canEditTask(t) ? '' : t.published_at ? '<button class="btn sm" data-act="dash-pub" data-id="' + t.id + '">Annuler la publication</button>' : t.done ? '<button class="btn sm primary" data-act="dash-pub" data-id="' + t.id + '">Publié</button>' : '<button class="btn sm primary" data-act="done" data-id="' + t.id + '">Terminé</button>';
      return '<tr class="click" data-act="task" data-id="' + t.id + '"><td class="first"><b>' + esc(c.name) + '</b></td><td data-l="Période" class="cap">' + esc(per(t)) + '</td><td data-l="À publier avant"><span class="' + (!t.published_at && j !== null && j <= 3 ? (j < 0 ? 'badge r' : 'badge o') : '') + '">' + fDM(t.due_date) + '</span></td><td data-l="Qui">' + esc(co ? co.name : '—') + '</td><td data-l="Planifié">' + (t.planned_date ? fShort(t.planned_date) : '—') + ' · ' + E.fmtMin(t.duration_min) + '</td><td data-l="Statut">' + st + '</td><td class="num" data-l="">' + acts + '</td></tr>';
    }).join('');
    return '<div class="row" style="margin-bottom:14px">' + monthNav() + '<span class="spacer"></span><span class="badge">' + n.todo + ' à faire</span><span class="badge b">' + n.done + ' à publier</span><span class="badge g">' + n.pub + ' publié(s)</span></div>'
      + (noTime.length ? '<div class="notice warn">' + noTime.length + ' dossier(s) avec tableau de bord sans temps renseigné (non planifiés) : ' + noTime.slice(0, 6).map(c => '<a href="#" data-act="client" data-id="' + c.id + '">' + esc(c.name) + '</a>').join(', ') + (noTime.length > 6 ? '…' : '') + '</div>' : '')
      + '<div class="card dash-card">' + (ts.length ? '<div class="scroll-x"><table class="t stack"><thead><tr><th>Client</th><th>Période</th><th>À publier avant</th><th>Qui</th><th>Planifié</th><th>Statut</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">Aucun tableau de bord à produire ' + esc(deMonth(m)) + '. Active-les dans la fiche de chaque client (Tableau de bord : mensuel ou trimestriel, jour convenu, temps).</div>') + '</div>'
      + '<p class="small muted">Le tableau de bord d\'un mois est à faire et publier le mois suivant, avant le jour convenu avec le client (25 par défaut). Trimestriel : en janvier, avril, juillet et octobre. Ils sont planifiés automatiquement chez le collaborateur du dossier.</p>';
  }

  /* ====================== Choix de l'ambiance à la première connexion ====================== */
  function themePicker() {
    if (!S.me || document.getElementById('theme-pick') || lsGet('planif-theme-chosen:' + S.me.email.toLowerCase())) return;
    const card = (t, name, desc, prev) => '<button class="tp-card" data-act="theme-pick" data-t="' + t + '"><span class="tp-prev tp-' + t + '">' + prev + '</span><b>' + name + '</b><span>' + desc + '</span></button>';
    const mini = '<i class="tp-side"></i><i class="tp-k"></i><i class="tp-k"></i><i class="tp-k"></i><i class="tp-bar"></i>';
    const el = document.createElement('div'); el.id = 'theme-pick'; el.className = 'tp-overlay';
    el.innerHTML = '<div class="tp-box" role="dialog" aria-modal="true" aria-labelledby="tp-t"><img src="logo-192.png" alt="" class="tp-logo"><h2 id="tp-t">Choisis ton ambiance</h2><p>Tu pourras la changer à tout moment dans Paramètres › Apparence.</p><div class="tp-grid">'
      + card('signature', 'Signature', 'Verre, lumière et profondeur', mini) + card('clair', 'Clair', 'Épuré, lumineux, précis', mini) + card('nuit', 'Aurora', 'Violet et cyan, verre premium', mini) + card('iris', 'Iris', 'Aéré, pervenche, tout en douceur', mini) + '</div></div>';
    document.body.appendChild(el);
  }

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
      + (binomeIds().size > 1 ? '<div style="margin-bottom:14px">' + collabChips() + '</div>' : '') + unplBanner(cid) + cfeReminder(cid) + cvaeReminder(cid) + capNoticeCollab(cid)
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

  /* ---------- Vue AUJOURD'HUI ---------- */
  // V26.167 : le RC et le collaborateur ont la même vue que le manager (l'apprenti garde son espace simplifié)
  const todayAsManager = () => isManager() || (!!S.me && S.me.role !== 'apprenti' && !!S.me.collaborator_id && !!collabOf(S.me.collaborator_id) && collabOf(S.me.collaborator_id).kind !== 'apprenti');
  function vToday() {
    if (!todayAsManager()) return vTodayCollab();
    const mgr = isManager();
    if (mgr && !collabs().length) return noCollabsHelp();
    const d = today(), vis = visibleCollabs(), team = mgr && !!S.todayTeam && vis.length > 1; // V26.190 : bouton « Équipe » (manager) — les cartes regroupent toute l'équipe visible
    const ids = team ? vis.map(x => x.id) : null, idSet = new Set(ids || []);
    const cid = team ? null : mgr ? S.collabId : (S.collabId && canSeeCollab(S.collabId) ? S.collabId : S.me.collaborator_id), c = collabOf(cid), key = team ? 'team' : cid;
    const first = (S.me.name || '').split(' ')[0];
    // V26.58 : en vue manager, le titre suit le collaborateur affiché (« Bonjour » seulement sur sa propre journée)
    const mine = c && c.id === S.me.collaborator_id;
    const tasks = team ? withTimes(dayTasks(null, d).filter(t => idSet.has(t.collaborator_id)), d) : c ? withTimes(dayTasks(cid, d), d) : [], todo = tasks.filter(x => !x.t.done);
    const rg = team ? ringHtml(null, d, ids) : c ? ringHtml(cid, d) : null;
    const mood = !rg ? '' : !rg.cap ? 'Journée non travaillée : profite.' : !tasks.length ? 'Aucune production prévue aujourd\'hui.' : { green: 'Ta journée est bien équilibrée.', orange: 'Journée bien remplie : pense à souffler.', red: 'Journée très remplie : regarde ton planning.', off: '' }[msgLv(rg.lv, rg.l.total, rg.cap)]; // V26.185 : aucune phrase d'avertissement sous 108 %
    // V26.190 : les noms des personnes sur la même ligne que le titre, au milieu de l'écran (les cartes remontent)
    const chips = collabChips(mgr && vis.length > 1 ? { none: team, pre: '<button class="chip chip-team' + (team ? ' on' : '') + '" data-act="today-team" title="Regrouper toute l\'équipe dans les cartes">' + ic('users', 'sm') + 'Équipe<span class="small" style="opacity:.6">' + vis.length + '</span></button>' } : {});
    const head = '<div class="hello anim-in"><div><div class="eyebrow cap">' + fDate(d) + (team ? ' · vue manager · équipe' : c && !mine ? (mgr ? ' · vue manager' : ' · ton binôme') : '') + '</div><div class="hello-row"><h1>' + (team ? 'Journée de l\'équipe' : mine || !c ? 'Bonjour, ' + esc(first) : 'Journée de ' + esc(c.name)) + '</h1>' + (chips ? '<div class="hello-chips">' + chips + '</div>' : '') + '</div>' + (mgr ? '' : flowQuoteHtml()) + '<p>'
      + (team ? 'La production du jour des ' + vis.length + ' personnes de l\'équipe et leurs clients à relancer.' : c ? (mine ? (mgr ? 'Voici votre production du jour.' : mood) : 'Sa production du jour et ses clients à relancer.') : 'Bonjour, ' + esc(first) + ' — choisissez un collaborateur.') + '</p></div>' + (team ? monthRing(null) : c ? monthRing(c.id) : '') + '</div>';
    if (!c && !team) return head;
    const al = alertsOf(engineData(), d, team ? {} : { collabId: cid }).filter(a => (a.type !== 'near' || a.date === d) && (!team || !a.collab_id || idSet.has(a.collab_id)));
    const bad = al.filter(a => a.level === 'bad').length;
    const recs = list('productions').filter(p => awaitingRec(p) && p.expected_date <= E.addDays(d, 2) && p.month >= E.addMonths(d.slice(0, 7), -1))
      .filter(p => { const cl = clientOf(p.client_id); return cl && (team ? idSet.has(cl.collaborator_id) : cl.collaborator_id === cid); })
      .sort(recOrder); // V26.163 : le mois en cours d'abord
    const doneN = tasks.length - todo.length, pctDone = tasks.length ? Math.round(doneN / tasks.length * 100) : 0;

    const k1 = '<div class="kpi anim-in" style="--i:1"><div class="kpi-h"><span class="ibox">' + ic('gauge', 'sm') + '</span>Niveau d\'activité du jour</div>'
      + '<div class="load-card">' + rg.html + '<div class="legend-list"><div><span class="badge ' + LV_BADGE[msgLv(rg.lv, rg.l.total, rg.cap)] + '">' + lvLabel(msgLv(rg.lv, rg.l.total, rg.cap)) + '</span></div><div><i class="lg-sw hatch"></i>Réalisé<b>' + E.fmtMin(rg.l.done) + '</b></div><div><i class="lg-sw lv-' + rg.lv + '"></i>Reste à faire<b>' + E.fmtMin(rg.l.todo) + '</b></div><div><i class="lg-sw" style="background:var(--track)"></i>Disponible<b>' + E.fmtMin(Math.max(0, rg.cap - rg.l.total)) + '</b></div></div></div></div>';
    const k2 = '<div class="kpi hero anim-in" style="--i:2"><div class="kpi-h"><span class="ibox">' + ic('list', 'sm') + '</span>Reste à faire</div><div class="v"><span data-count="' + todo.length + '" data-fmt="int" data-key="t-todo-' + key + '">' + todo.length + '</span><small>tâche' + (todo.length > 1 ? 's' : '') + '</small></div>'
      + '<div class="foot">' + E.fmtMin(rg.l.todo) + ' · ' + doneN + ' terminée' + (doneN > 1 ? 's' : '') + '</div><div class="bar" style="background:rgba(255,255,255,.12)"><i style="width:' + pctDone + '%;background:var(--accent)"></i></div></div>';
    const k3 = '<a class="kpi popk anim-in" style="--i:3" href="#/receptions"><span class="go">' + ic('arrowUR', 'sm') + '</span><div class="kpi-h"><span class="ibox">' + ic('inbox', 'sm') + '</span>Réceptions attendues</div><div class="v" data-count="' + recs.length + '" data-fmt="int" data-key="t-rec-' + key + '">' + recs.length + '</div>'
      + '<div class="foot">' + (recs.length ? esc(recs.slice(0, 2).map(p => clientOf(p.client_id).name).join(', ')) + (recs.length > 2 ? '…' : '') : 'Rien à déclarer d\'ici 2 jours') + '</div></a>';
    const k4 = '<div class="kpi anim-in" style="--i:4"' + (al.length && mgr ? ' data-act="goto" data-r="dashboard"' : '') + '>' + (al.length && mgr ? '<span class="go">' + ic('arrowUR', 'sm') + '</span>' : '') + '<div class="kpi-h"><span class="ibox ' + (bad ? 'r' : al.length ? 'o' : 'g') + '">' + ic(bad ? 'alert' : 'check', 'sm') + '</span>Alertes</div><div class="v" data-count="' + al.length + '" data-fmt="int" data-key="t-al-' + key + '">' + al.length + '</div>'
      + '<div class="foot clamp">' + (al.length ? esc(softText(al[0].text)) : 'Tout est sous contrôle') + '</div></div>';
    // V26.167 : RC / collaborateur — rappels CFE, CVAE et capacité, puis conseils (étalement, aide, temps réels) sous les indicateurs
    const tips = mgr ? '' : helpFeedback(cid) + (mine ? timeReminder(cid) : '') + collabTip(cid);

    return head + (team ? '' : unplBanner(cid)) + (mgr ? '' : cfeReminder(cid) + cvaeReminder(cid) + capNoticeCollab(cid)) + progressBanner(cid, ids)
      + '<div class="carousel desk-grid kpis-today" data-keep="kpi-today">' + k1 + k2 + k3 + k4 + '</div><div class="dots" data-dots></div>'
      + (tips ? '<div class="today-tips">' + tips + '</div>' : '')
      + '<div class="split" style="margin-top:var(--gap)">'
      + '<div class="card anim-in" style="--i:5"><div class="card-h"><h2>' + (team ? 'Production de l\'équipe' : mine ? 'Ma production' : 'Production de ' + esc(c.name.split(' ')[0])) + '</h2><span class="badge hide-m">' + tasks.length + ' tâche' + (tasks.length > 1 ? 's' : '') + ' · ' + E.fmtMin(rg.l.total) + '</span><a class="btn sm" href="#/planning" data-act="goday" data-date="' + d + '">Planning' + ic('chevR', 'sm') + '</a></div>'
      + (tasks.length ? '<div class="tasks">' + unitsOf(tasks).map((u, i) => unitRow(u, { i: i + 6, showCollab: team })).join('') + '</div><div class="swipe-hint only-m">' + (mgr ? 'Glissez une carte vers la droite pour la terminer (ou déclarer les éléments reçus), vers la gauche pour la verrouiller' : 'Glisse une carte vers la droite pour la terminer (ou déclarer les éléments reçus), vers la gauche pour la verrouiller') + '</div>' : '<div class="empty">Aucune tâche planifiée aujourd\'hui.</div>')
      + '</div><div>'
      + '<div class="frame anim-in rec-home-f" style="--i:6"><div class="frame-h">' + ic('inbox') + '<h2>Réceptions</h2>' + (recs.length ? '<input type="search" class="rec-q" data-in="recq" placeholder="Rechercher un dossier…" value="' + esc(S.recQ || '') + '" aria-label="Rechercher un dossier">' : '') + '<a class="btn sm" href="#/receptions">Tout voir</a></div><div class="inner">'
      + (recs.length ? '<div id="rec-home">' + recHomeList(recs, d) + '</div><button class="btn primary" style="width:100%;margin-top:12px" data-act="rec-validate"' + (S.recSel.size ? '' : ' disabled') + '>' + ic('check', 'sm') + 'Valider · ' + S.recSel.size + '</button>' : '<div class="empty">Aucun élément attendu d\'ici 2 jours.</div>')
      + '</div></div>'
      + '<div class="frame anim-in" style="--i:7"><div class="frame-h">' + ic('alert') + '<h2>Alertes</h2>' + (al.length ? '<span class="badge ' + (bad ? 'r' : 'o') + '">' + al.length + '</span>' : '') + '</div><div class="inner">' + alertList(al, 6) + '</div></div>'
      + '</div></div>'
      + (mgr ? '' : '<p class="privacy small muted">' + ic('lock', 'sm') + 'Tes temps me servent à ajuster ton planning et harmoniser ton niveau d\'activité.</p>');
  }
  /* V26.148 : Réceptions — listes par pages (8 éléments à déclarer, 15 déjà reçus), comme « TVA à déposer » */
  function recPage(k, a, per) { const key = 'recPage_' + k, n = Math.max(1, Math.ceil(a.length / per)); S[key] = Math.min(Math.max(1, S[key] || 1), n); return a.slice((S[key] - 1) * per, S[key] * per); }
  function recPager(k, len, per, bottom) {
    if (len <= per) return '';
    const n = Math.ceil(len / per), p = Math.min(S['recPage_' + k] || 1, n), from = (p - 1) * per + 1, to = Math.min(len, p * per);
    return '<div class="fil-pager' + (bottom ? ' bottom' : '') + '"><span class="small muted">' + from + '–' + to + ' sur ' + len + '</span><span class="spacer"></span><button class="btn sm" data-act="rec-page" data-k="' + k + '" data-d="-1"' + (p <= 1 ? ' disabled' : '') + '>' + ic('chevL', 'sm') + 'Précédent</button><span class="small"><b>' + p + '</b> / ' + n + '</span><button class="btn sm primary" data-act="rec-page" data-k="' + k + '" data-d="1"' + (p >= n ? ' disabled' : '') + '>Suivant' + ic('chevR', 'sm') + '</button></div>';
  }  /* V26.157 : carte « Réceptions » de l'accueil — recherche par nom + pages de 15 */
  function recHomeList(recs, d) {
    S._recHome = { recs, d };
    const q = (S.recQ || '').trim().toLowerCase(), sel = q ? recs.filter(p => ((clientOf(p.client_id) || {}).name || '').toLowerCase().includes(q)) : recs;
    if (!sel.length) return '<div class="empty">Aucun dossier ne correspond à « ' + esc(S.recQ) + ' ».</div>';
    // V26.163 : les restes des mois précédents sont regroupés sous un intitulé (avec « Clôturer » pour le manager)
    let html = '', grp = null; const cm = defaultMonth();
    recPage('h', sel, 15).forEach(p => { const old = p.month < cm ? p.month : null; if (old && old !== grp) html += recGroupHead(old, sel.filter(x => x.month === old).length); grp = old; html += recRow(p, d); });
    return recPager('h', sel.length, 15) + '<div class="rec-list">' + html + '</div>';
  }
  function recGroupHead(m, n) {
    const canClose = isManager() && !S.readonly && E.windowOf(m, cfg()).end < today();
    return '<div class="rec-group">' + ic('alert', 'sm') + '<span><b>' + esc(fMonth(m).replace(/^./, s => s.toUpperCase())) + '</b> : ' + n + ' dossier' + (n > 1 ? 's' : '') + ' jamais déclaré' + (n > 1 ? 's' : '') + ' reçu' + (n > 1 ? 's' : '') + ' (mois précédent)</span>'
      + (canClose ? '<button type="button" class="btn sm" data-act="close-month" data-m="' + m + '" title="Dossiers traités hors de l\'application : les marquer terminés">' + ic('check', 'sm') + 'Clôturer ' + esc(fMonth(m)) + '</button>' : '') + '</div>';
  }
  function recRow(p, d) {
    const c = clientOf(p.client_id) || { name: '?' }, co = collabOf(c.collaborator_id);
    const late = p.expected_date < d;
    return '<label class="rec"' + predictTitle(p) + '><input type="checkbox" data-ch="recsel" data-id="' + p.id + '"' + (S.recSel.has(p.id) ? ' checked' : '') + '><span style="flex:1"><span class="n">' + esc(c.name) + '</span><br><span class="small muted">' + (co ? esc(co.name) + ' · ' : '') + 'attendus le ' + fDM(p.expected_date) + expHint(p) + recRelHint(p) + (p.partial_date ? ' · reçu en partie le ' + fDM(p.partial_date) : '') + (p.month !== S.month ? ' (' + fMonth(p.month) + ')' : '') + (lastRelance(p) ? ' · <b class="rel-done">' + ic(lastRelance(p).via === 'telephone' ? 'phone' : 'mail', 'sm') + esc(relLabel(lastRelance(p))) + '</b>' : '') + '</span></span>' + (S.v7 && !S.readonly ? '<button type="button" class="btn sm" data-act="rec-part" data-id="' + p.id + '" title="Une partie seulement des éléments est arrivée : indiquer le temps estimé de cette partie">Partiel</button>' : '')
      + (late ? '<span class="rec-side"><span class="badge r">En retard</span><button type="button" class="btn icon sm rl-btn" data-act="relance" data-pid="' + p.id + '" title="Texte de relance à copier" aria-label="Relancer ' + esc(c.name) + '">' + ic('mail', 'sm') + '</button>' + '<button type="button" class="btn icon sm rl-btn rl-tel' + (lastRelance(p) && lastRelance(p).via === 'telephone' && lastRelance(p).date === today() ? ' on' : '') + '" data-act="relance-tel" data-pid="' + p.id + '" title="' + (lastRelance(p) && lastRelance(p).via === 'telephone' && lastRelance(p).date === today() ? 'Relance téléphonique notée aujourd\'hui : cliquer pour l\'annuler' : 'Client relancé par téléphone : noter la relance') + '" aria-label="Client ' + esc(c.name) + ' relancé par téléphone"' + (S.readonly ? ' disabled' : '') + '>' + ic('phone', 'sm') + '</button></span>'
        : p.expected_date === d ? '<span class="badge o">Aujourd\'hui</span>' : '<span class="badge">Prévu</span>') + '</label>';
  }

  /* ---------- Vue PLANNING ---------- */
  /* V26.186 : l'onglet Planning devient le « cockpit » de l'équipe (071-planning-cockpit.js) — indicateurs, frise du jour, semaine, cartes de pilotage */
  function vPlanning() {
    if (!collabs().length) return noCollabsHelp();
    return pcView();
  }
  function weekDays(c, start) {
    return E.rangeDates(start, E.addDays(start, 4)); // lundi → vendredi (le week-end n'existe pas dans l'outil)
  }
  /* V26.74 : planning de la semaine, suivi du planning de l'apprenti (glisser-déposer entre les deux) */
  function planWeek(c) {
    // V26.76 : sous le planning affiché, ceux des personnes rattachées (collaborateurs du RC, apprentis) — jamais au-dessus
    const subs = juniorsOf(c.id).filter(a => canSeeCollab(a.id));
    if (!subs.length) return weekGrid(c, false);
    const lane = (p, i) => '<div class="ap-lane"><div class="ap-h"><span class="dot" style="background:' + esc(p.color || 'var(--accent)') + '"></span><b>' + (!i ? 'Planning de ' : p.kind === 'apprenti' ? 'Planning de l\'apprenti · ' : 'Planning de son collaborateur · ') + esc(p.name) + '</b>' + (p.kind === 'apprenti' ? '<span class="badge b">Apprenti · jours en entreprise</span>' : '') + '</div>' + weekGrid(p, true, true) + '</div>';
    return [c].concat(subs).map(lane).join('')
      + '<p class="small muted hide-m">Glissez-déposez une tâche d\'un planning à l\'autre pour la confier à votre collaborateur ou à l\'apprenti, ou la reprendre — même si le dossier ne lui est pas attribué. Les jours grisés de l\'apprenti sont ses jours hors entreprise (école).</p>';
  }
  function weekGrid(c, withDc, noHint) {
    const x = ctx(), start = E.startOfWeek(S.cursor), days = weekDays(c, start), td = today();
    const win = E.windowOf(S.cursor.slice(0, 7), x.settings);
    const cols = days.map(d => {
      const cap = E.capacityOn(c, d, x), l = E.loadOf(list('tasks'), c.id, d), pf = pcFill(l.total, cap); // V26.186 : barre graphique, sans pourcentage
      const hol = x.settings.holidays && E.holidayName(d), ab = E.absenceOn(c.id, d, x);
      const outwin = d < win.start || d > win.end;
      const units = unitsOf(dayTasks(c.id, d).map(t => ({ t, date: d })));
      const dens = units.length > 7 ? ' dense xdense' : units.length > 4 ? ' dense' : '';
      return '<div class="day-col pc-dcol' + dens + (d === td ? ' today' : '') + (outwin ? ' outwin' : '') + (c.kind === 'apprenti' && !cap ? ' ap-off' : '') + '" data-drop="' + d + '"' + (withDc ? ' data-dc="' + c.id + '"' : '') + '><div class="dh" data-act="goday" data-date="' + d + '"><b>' + (d === td ? '<i class="pc-dot g"></i>' : '') + fShort(d) + ' ' + fMonth(d.slice(0, 7)).split(' ')[0] + '</b><span class="small muted"><b>' + E.fmtMin(l.total) + '</b> / ' + E.fmtMin(cap) + '</span></div>'
        + (cap || l.total ? pcBar(pf) + '<div class="pc-who-f f-' + pf.cls + '">' + esc(pf.txt) + '</div>' : '<div class="small muted">' + (hol ? 'Férié' : ab ? absLabel(ab) : c.kind === 'apprenti' ? 'École / hors entreprise' : 'Non travaillé') + '</div>')
        + units.filter(u => pcMatch(u.tasks[0], pcState(u.tasks[0], d, null))).map(u => pcCard(u.tasks[0], d)).join('') + '</div>';
    }).join('');
    return '<div class="week" style="--cols:' + days.length + '">' + cols + '</div>' + (noHint ? '' : '<p class="small muted hide-m">Astuce : glissez-déposez une tâche d\'un jour à l\'autre, ou cliquez dessus pour la modifier. Les jours grisés sont hors de la période ' + x.settings.start_day + ' → ' + endLbl(S.cursor.slice(0, 7)) + '.</p>');
  }
  function planMonth(c, m, from) { // V26.193 : from = premier jour affiché (mois en cours : à partir d'aujourd'hui) — les totaux restent ceux de la période
    const x = ctx(), win = E.windowOf(m, x.settings), td = today(), dates = E.monthDates(m);
    const wdays = dates.filter(d => E.dow(d) <= 5), shown = wdays.filter(d => !from || d >= from), lead = E.dow((shown[0] || wdays[0])) - 1;
    let cells = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'].map(w => '<div class="wd">' + w + '</div>').join('');
    for (let i = 0; i < lead; i++) cells += '<div class="mcell blank"></div>';
    let tot = 0, capT = 0;
    for (const d of wdays) {
      const cap = E.capacityOn(c, d, x), l = E.loadOf(list('tasks'), c.id, d), lv = E.levelOf(l.total, cap, x.settings);
      const n = dayTasks(c.id, d).length, outwin = d < win.start || d > win.end;
      if (!outwin) { tot += l.total; capT += cap; }
      if (from && d < from) continue;
      const hol = x.settings.holidays && E.holidayName(d);
      cells += '<div class="mcell cell-' + (cap || l.total ? lv : 'off') + (outwin ? ' outwin' : '') + (d === td ? ' today' : '') + '" data-act="goday" data-date="' + d + '" data-drop="' + d + '" data-dc="' + c.id + '"><div class="dn"><span>' + Number(d.slice(8)) + '</span>' + (hol ? '<span title="' + esc(hol) + '">F</span>' : '') + '</div>'
        + (l.total ? '<div class="hl">' + E.fmtMin(l.total) + '<span class="hide-m"> / ' + E.fmtMin(cap) + '</span></div><div class="cnt small">' + n + ' tâche' + (n > 1 ? 's' : '') + '</div>' : cap ? '<div class="small muted">libre<span class="hide-m"> · ' + E.fmtMin(cap) + '</span></div>' : '') + '</div>';
    }
    const unpl = list('tasks').filter(t => t.month === m && t.collaborator_id === c.id && !t.done && !t.planned_date);
    return '<div class="card"><div class="month">' + cells + '</div><div class="legend" style="margin-top:12px"><span><i class="swatch cell-green" style="background:var(--green)"></i>Normale</span><span><i class="swatch" style="background:var(--orange)"></i>≥ ' + x.settings.warn_pct + ' %</span><span><i class="swatch" style="background:var(--red)"></i>' + (isManager() ? 'Surcharge' : 'Au-delà de 100 %') + '</span><span>Période ' + x.settings.start_day + ' → ' + endLbl(m) + ' : <b>' + E.fmtMin(tot) + ' / ' + E.fmtMin(capT) + '</b> (' + (capT ? Math.round(tot / capT * 100) : 0) + ' %)</span></div></div>'
      + (unpl.length ? '<div class="card"><h2 style="margin-bottom:10px">⚠️ Non planifiées (' + unpl.length + ')</h2><div class="tasks">' + unpl.map(t => taskRow(t)).join('') + '</div></div>' : '');
  }

  /* ---------- Vue ÉQUIPE ---------- */
  function vTeam() {
    if (!collabs().length) return noCollabsHelp();
    const x = ctx(), td = today();
    let dates, lbl;
    if (S.teamRange === 'week') { const st = E.startOfWeek(S.cursor); dates = E.rangeDates(st, E.addDays(st, 4)); lbl = 'Semaine du ' + fDM(st); }
    else { const w = E.windowOf(S.month, x.settings); dates = E.rangeDates(w.start, w.end).filter(d => E.dow(d) <= 5); lbl = 'Période du ' + fDM(w.start) + ' au ' + fDM(w.end); }
    const cs = visibleCollabs(), tasks = list('tasks');
    const rows = cs.map(c => {
      let tot = 0, capT = 0;
      const cells = dates.map(d => {
        const cap = E.capacityOn(c, d, x), l = E.loadOf(tasks, c.id, d), lv = E.levelOf(l.total, cap, x.settings);
        tot += l.total; capT += cap;
        const rest = cap - l.total;
        return '<td class="c cell-' + (cap || l.total ? lv : 'off') + '" data-act="teamcell" data-c="' + c.id + '" data-date="' + d + '">' + (cap || l.total ? E.fmtMin(l.total) + ' / ' + E.fmtMin(cap) + '<small>' + (rest >= 0 ? 'reste ' + E.fmtMin(rest) : 'dépasse ' + E.fmtMin(-rest)) + '</small>' : '<small>' + (E.absenceOn(c.id, d, x) ? 'absent' : 'off') + '</small>') + '</td>';
      }).join('');
      const lv = E.levelOf(tot, capT, x.settings);
      return '<tr><td class="name"><i class="swatch" style="background:' + esc(c.color || '#888') + '"></i> ' + esc(c.name) + '</td>' + cells + '<td class="c cell-' + lv + '">' + E.fmtMin(tot) + ' / ' + E.fmtMin(capT) + '<small>' + (capT ? Math.round(tot / capT * 100) : 0) + ' %</small></td></tr>';
    }).join('');
    return '<div class="print-title">Vue équipe — ' + esc(lbl) + '</div><div class="row no-print" style="margin-bottom:14px"><div class="seg"><button class="' + (S.teamView !== 'gantt' ? 'on' : '') + '" data-act="tview" data-v="table">Tableau</button><button class="' + (S.teamView === 'gantt' ? 'on' : '') + '" data-act="tview" data-v="gantt">Frise</button></div><div class="seg"><button class="' + (S.teamRange === 'week' ? 'on' : '') + '" data-act="trange" data-r="week">Semaine</button><button class="' + (S.teamRange === 'period' ? 'on' : '') + '" data-act="trange" data-r="period">Période ' + x.settings.start_day + '→' + endLbl(S.month) + '</button></div>'
      + '<div class="row"><button class="btn icon sm" data-act="tnav" data-d="-1" aria-label="Précédent"' + (prevBlocked(S.teamRange === 'week' ? 'week' : 'month') ? ' disabled' : '') + '>' + ic('chevL', 'sm') + '</button><button class="btn sm" data-act="tnav" data-d="0">Aujourd\'hui</button><button class="btn icon sm" data-act="tnav" data-d="1" aria-label="Suivant">' + ic('chevR', 'sm') + '</button></div><b class="cap">' + esc(lbl) + '</b><span class="spacer"></span><button class="btn hide-m" data-act="print">' + ic('download', 'sm') + 'PDF</button></div>'
      + (S.teamView === 'gantt' ? teamGantt(dates) :
      '<div class="card"><div class="scroll-x"><table class="team"><thead><tr><th class="name">Collaborateur</th>' + dates.map(d => '<th' + (d === td ? ' style="color:var(--accent)"' : '') + '>' + fShort(d) + '</th>').join('') + '<th>Total</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<div class="legend" style="margin-top:12px"><span><i class="lg-sw" style="background:var(--ok)"></i>Disponible / activité normale</span><span><i class="lg-sw" style="background:var(--warn)"></i>Proche de la saturation (≥ ' + x.settings.warn_pct + ' %)</span><span><i class="lg-sw" style="background:var(--bad)"></i>Surchargé</span><span><i class="lg-sw" style="background:var(--track)"></i>Non travaillé / absent</span></div><p class="small muted">Cliquez sur une case pour ouvrir le planning du jour.</p></div>');
  }

  /* ---------- Vue RÉCEPTIONS ---------- */
  const monthNavRow = () => '<div class="tva-nav">' + monthNav() + '<div class="tva-recaps"><button class="btn primary tva-recap-btn" data-act="tva-recap">' + ic('list', 'sm') + 'Récap TVA du mois</button><button class="btn tva-recap-btn2" data-act="is-recap">' + ic('list', 'sm') + 'Récap Acompte IS</button><button class="btn tva-recap-btn2" data-act="cfe-recap">' + ic('list', 'sm') + 'Récap CFE</button></div><span></span></div>'; // V26.97 : bouton centré et allongé
  function vReceptions() {
    const m = S.month, td = today();
    const prods = list('productions').filter(p => p.month === m);
    const mine = p => { const c = clientOf(p.client_id); return c && (S.recAll || !S.me.collaborator_id || c.collaborator_id === S.me.collaborator_id); };
    const waiting = prods.filter(p => !p.received_date && mine(p)).sort((a, b) => (a.expected_date || '').localeCompare(b.expected_date || '') || byName(clientOf(a.client_id) || {}, clientOf(b.client_id) || {}));
    const got = prods.filter(p => p.received_date && mine(p)).sort((a, b) => b.received_date.localeCompare(a.received_date));
    const missing = missingForMonth(m);
    return '<div class="row" style="margin-bottom:14px">' + monthNav() + '<span class="spacer"></span>'
      + (S.me.collaborator_id ? '<button class="btn tg' + (S.recAll ? ' on' : '') + '" data-act="recall-tg" aria-pressed="' + !!S.recAll + '">' + ic(S.recAll ? 'check' : 'folder', 'sm') + 'Afficher tous les dossiers</button>' : '') + '</div>'
      + (!prods.length ? '<div class="notice warn">Le mois ' + deMonth(m) + ' n\'a pas encore ses dossiers. ' + (isManager() && missing ? '<button class="btn sm" data-act="generate" data-m="' + m + '">➕ Créer les dossiers du mois</button>' : 'Demandez à l\'administrateur de le générer.') + '</div>' : '')
      + '<div class="grid g2"><div class="card"><div class="card-h"><h2>Éléments reçus — à déclarer (' + waiting.length + ')</h2>'
      + (waiting.length ? '<button class="btn sm" data-act="rec-all">Tout cocher</button>' : '') + '</div>'
      + (waiting.length ? recPager('w', waiting.length, 8) + '<div class="rec-list">' + recPage('w', waiting, 8).map(p => recRow(p, td)).join('') + '</div>' + recPager('w', waiting.length, 8, true) : '<div class="empty">Tous les éléments sont reçus 🎉</div>')
      + '<div class="sticky-foot"><label class="f" style="flex-direction:row;align-items:center;gap:8px"><span>Reçus le</span><input type="date" data-ch="recdate" value="' + S.recDate + '" style="width:auto"></label><span class="spacer"></span>'
      + '<button class="btn primary rec-ok" data-act="rec-validate" ' + (S.recSel.size && !S.readonly ? '' : 'disabled') + '>' + ic('check', 'sm') + 'Valider (' + S.recSel.size + ')</button></div></div>'
      + '<div class="card"><h2 style="margin-bottom:10px">Déjà reçus (' + got.length + ')</h2>' + (got.length ? recPager('g', got.length, 15) + '<table class="t rec-got"><tbody>' + recPage('g', got, 15).map(p => { const c = clientOf(p.client_id) || {}; return '<tr><td>✅ <b>' + esc(c.name) + '</b></td><td class="small muted">reçus le ' + fDM(p.received_date) + '</td><td class="num"><button class="btn sm" data-act="rec-undo" data-id="' + p.id + '">Annuler</button></td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">Aucun pour l\'instant.</div>') + '</div></div>';
  }

  /* ---------- Vue DOSSIERS ---------- */
  /* V26.67 : index productions/tâches recalculé une seule fois par rendu (fluidité avec beaucoup de dossiers) */
  function pIdx() {
    const key = S.data.productions.size + '|' + S.data.tasks.size + '|' + (S.lastSync || '') + '|' + (S.idxTick || 0);
    if (S._pIdx) return S._pIdx;
    const prod = new Map(), tasks = new Map();
    for (const p of S.data.productions.values()) prod.set(p.client_id + '|' + p.month, p);
    for (const t of S.data.tasks.values()) { if (!t.production_id) continue; if (!tasks.has(t.production_id)) tasks.set(t.production_id, []); tasks.get(t.production_id).push(t); }
    S._pIdx = { prod, tasks }; return S._pIdx;
  }
  function clientStatus(c, m) {
    const ix = pIdx(), p = ix.prod.get(c.id + '|' + m);
    if (!p) return E.clientApplies(c, m, cfg()) ? '<span class="badge">Pas encore créé</span>' : '<span class="badge">Hors période</span>';
    if (p.status === 'cloture') return '<span class="badge g">✓ Clôturé</span>'; // V26.168 : clôturé sans tâche (« Clôturer le mois »)
    const st = E.productionStatus(p, ix.tasks.get(p.id) || []);
    const cls = { attendu: '', partiel: 'o', recu: 'b', planifie: 'b', en_cours: 'o', termine: 'g' }[st];
    return '<span class="badge ' + cls + '">' + (st === 'partiel' ? '◐ Reçu en partie' + (p.partial_date ? ' le ' + Number(p.partial_date.slice(8)) : '') : st === 'attendu' ? '📅 Attendus le ' + Number((p.expected_date || '').slice(8)) : st === 'termine' ? '✓ Terminé' : '✅ Reçus le ' + Number(p.received_date.slice(8)) + ' · ' + E.STATUS_LABEL[st]) + '</span>';
  }
  /* V26.57 : filtres (fréquence, TVA, priorité, état du mois) et tri par colonne */
  function cMonthState(c) {
    const ix = pIdx(), p = ix.prod.get(c.id + '|' + S.month); if (!p) return 'none';
    const ts = (ix.tasks.get(p.id) || []).filter(t => t.kind !== 'info');
    return ts.length && ts.every(t => t.done) ? 'done' : p.received_date || p.partial_date ? 'recu' : 'attendu';
  }
  function filteredClients() {
    const q = S.clientSearch.trim().toLowerCase(), f = S.cf || {}, so = S.csort || { k: 'name', d: 1 };
    const cs = list('clients').filter(c => (!S.clientCollab || c.collaborator_id === S.clientCollab) && (!q || (c.name || '').toLowerCase().includes(q) || ((collabOf(c.collaborator_id) || {}).name || '').toLowerCase().includes(q))
      && (!f.freq || c.frequency === f.freq) && (!f.reg || (c.vat_regime || 'ca3_mensuel') === f.reg) && (!f.prio || String(c.priority || 2) === f.prio) && (!f.st || cMonthState(c) === f.st));
    const key = { name: c => (c.name || '').toLowerCase(), collab: c => ((collabOf(c.collaborator_id) || {}).name || '').toLowerCase(), freq: c => c.frequency || '', rec: c => Number(c.reception_day) || 99, time: c => E.clientTime(c), tva: c => Number(c.vat_due_day) || 99, prio: c => Number(c.priority) || 2, st: c => ['attendu', 'recu', 'done', 'none'].indexOf(cMonthState(c)) }[so.k] || (c => (c.name || '').toLowerCase());
    return cs.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * so.d || byName(a, b); });
  }
  function clientFilters() {
    const f = S.cf || {}, sel = (k, label, opts) => '<select data-ch="cfilter" data-k="' + k + '" class="' + (f[k] ? 'v2-active' : '') + '" style="width:auto;border-radius:999px"><option value="">' + label + '</option>' + opts.map(o => '<option value="' + o[0] + '"' + (f[k] === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
    const n = Object.values(f).filter(Boolean).length;
    return '<div class="row cfilters" style="margin-bottom:12px;gap:8px;flex-wrap:wrap">' + ic('list', 'sm')
      + sel('freq', 'Toutes fréquences', Object.keys(E.FREQ_LABEL).map(k => [k, E.FREQ_LABEL[k]]))
      + sel('reg', 'Tous régimes TVA', Object.keys(E.VAT_REGIMES).map(k => [k, E.VAT_REGIMES[k]]))
      + sel('prio', 'Toutes priorités', [1, 2, 3].map(k => [String(k), E.PRIORITY_LABEL[k]]))
      + sel('st', 'Tous états (' + fMonth(S.month) + ')', [['attendu', 'Pièces attendues'], ['recu', 'Reçus, en production'], ['done', 'Terminés'], ['none', 'Sans dossier ce mois']])
      + (n ? '<button class="btn sm" data-act="cfilter-reset">Effacer les filtres (' + n + ')</button>' : '') + '</div>';
  }  function vClients() {
    return '<div class="row" style="margin-bottom:16px"><div class="search-box" style="max-width:360px">' + ic('search', 'sm') + '<input type="search" placeholder="Rechercher un client ou un collaborateur…" data-in="csearch" value="' + esc(S.clientSearch) + '"></div>'

      + '<span class="spacer"></span>' + monthNav() + (S.readonly ? '' : '<button class="btn" data-act="import">' + ic('download', 'sm') + (canCreateDossiers() ? 'Importer Excel' : 'Importer mes dossiers') + '</button>') + (canCreateDossiers() ? '<button class="btn dark" data-act="client-new">' + ic('plus', 'sm') + 'Dossier</button>' : '') + '</div>'
      + (Object.values(S.cf || {}).some(Boolean) || S.clientCollab ? '<div class="row" style="margin:-4px 0 10px"><button class="btn sm" data-act="cfilter-reset">Effacer les filtres</button></div>' : '') + inactiveNotice() + '<div class="only-m">' + clientFilters() + '</div><div class="card" id="results">' + clientsTable() + '</div>';
  }
  /* V26.64 : filtres intégrés dans l'en-tête du tableau (tri au clic sur le titre) */
  function clientHead() {
    const so = S.csort || { k: 'name', d: 1 }, f = S.cf || {};
    const opt = (list0) => list0.map(o => [o[0], o[1]]);
    const cols = [
      ['name', 'Client', '', null],
      ['collab', 'Collaborateur', '', { cur: S.clientCollab, opts: opt(collabs(true).map(c => [c.id, c.name])) }],
      ['freq', 'Fréquence', '', { key: 'freq', cur: f.freq, opts: Object.keys(E.FREQ_LABEL).map(k => [k, E.FREQ_LABEL[k]]) }],
      ['rec', 'Réception', '', null],
      ['time', 'Temps', 'num', null],
      ['tva', 'TVA', '', { key: 'reg', cur: f.reg, opts: Object.keys(E.VAT_REGIMES).map(k => [k, E.VAT_REGIMES[k]]) }],
      ['prio', 'Priorité', '', { key: 'prio', cur: f.prio, opts: [1, 2, 3].map(k => [String(k), E.PRIORITY_LABEL[k]]) }],
      ['st', fMonth(S.month), 'cap', { key: 'st', cur: f.st, opts: [['attendu', 'Pièces attendues'], ['recu', 'Reçus, en production'], ['done', 'Terminés'], ['none', 'Sans dossier ce mois']] }]
    ];
    return cols.map(c => {
      const flt = c[3], active = flt && flt.cur, lbl = active ? (flt.opts.find(o => o[0] === flt.cur) || [0, ''])[1] : '';
      const open = S.thMenu === c[0];
      const pop = open ? '<div class="th-pop" role="menu">'
        + '<button data-act="th-sort" data-k="' + c[0] + '" data-d="1" class="' + (so.k === c[0] && so.d > 0 ? 'sel' : '') + '">↑ Trier ' + (c[0] === 'time' || c[0] === 'rec' ? 'croissant' : 'de A à Z') + '</button>'
        + '<button data-act="th-sort" data-k="' + c[0] + '" data-d="-1" class="' + (so.k === c[0] && so.d < 0 ? 'sel' : '') + '">↓ Trier ' + (c[0] === 'time' || c[0] === 'rec' ? 'décroissant' : 'de Z à A') + '</button>'
        + (flt ? '<div class="th-sep"></div><div class="th-cap">Filtrer</div><button data-act="th-pick" data-k="' + c[0] + '" data-v="" class="' + (!flt.cur ? 'sel' : '') + '">Tous</button>' + flt.opts.map(o => '<button data-act="th-pick" data-k="' + c[0] + '" data-v="' + esc(o[0]) + '" class="' + (flt.cur === o[0] ? 'sel' : '') + '">' + esc(o[1]) + '</button>').join('') : '') + '</div>' : '';
      return '<th class="' + c[2] + (so.k === c[0] ? ' on' : '') + (active ? ' flt' : '') + '"><button class="th-b" data-act="th-menu" data-k="' + c[0] + '" aria-haspopup="menu" aria-expanded="' + open + '">' + esc(c[1]) + (so.k === c[0] ? (so.d > 0 ? ' ↑' : ' ↓') : '') + (active ? '<span class="th-chip">' + esc(lbl) + '</span>' : '') + '<svg class="th-caret" viewBox="0 0 24 24" width="12" height="12"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' + pop + '</th>';
    }).join('');
  }  function clientsTable() { S._pIdx = null;
    const cs = filteredClients();
    if (!cs.length) return '<div class="empty">Aucun dossier.' + (isManager() ? ' Importez votre fichier Excel ou ajoutez un dossier.' : '') + '</div>';
    const tot = cs.filter(c => c.active !== false).reduce((s, c) => s + E.clientTime(c), 0);
    return '<div class="row small muted" style="margin-bottom:8px"><span>' + cs.length + ' dossier' + (cs.length > 1 ? 's' : '') + '</span><span>·</span><span>' + E.fmtMin(tot) + ' de production par mois (dossiers actifs)</span></div>'
      + '<div class="scroll-x"><table class="t stack ct"><thead><tr>' + clientHead() + '</tr></thead><tbody>'
      + cs.map(c => { const co = collabOf(c.collaborator_id); return '<tr class="click' + (c.active === false ? ' row-off' : '') + '" data-act="client" data-id="' + c.id + '"' + (c.active === false ? ' title="Dossier inactif : exclu de la planification"' : '') + '><td class="first">' + (c.active === false ? '<s>' : '') + esc(c.name) + (c.active === false ? '</s>' : '') + (c.notes ? ' <span class="muted" title="' + esc(c.notes) + '">' + ic('list', 'sm') + '</span>' : '') + '</td><td data-l="Collaborateur">' + esc(co ? co.name : '—') + '</td><td data-l="Fréquence">' + (E.FREQ_LABEL[c.frequency] || '') + '</td><td data-l="Réception" class="nowrap">' + (c.reception_day ? 'le ' + c.reception_day : '—') + '</td>'
        + '<td class="num" data-l="Temps"><b>' + E.fmtMin(E.clientTime(c)) + '</b></td><td data-l="TVA"><span class="nowrap">' + E.VAT_REGIMES[c.vat_regime || 'ca3_mensuel'] + (c.vat_due_day && (c.vat_regime || 'ca3_mensuel') !== 'aucun' ? ' · le ' + c.vat_due_day : '') + '</span>' + (c.deb ? ' <span class="badge b">DEB</span>' : '') + (c.des ? ' <span class="badge b">DES</span>' : '') + '</td><td data-l="Priorité" class="nowrap"><span class="prio p' + (c.priority || 2) + '"><i></i><i></i><i></i></span> ' + (E.PRIORITY_LABEL[c.priority] || '') + '</td><td data-l="Statut">' + clientStatus(c, S.month) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }

  /* ---------- Vue RECHERCHE ---------- */
  function vSearch() {
    const f = S.filters, sel = (k, opts) => '<select data-ch="filter" data-k="' + k + '" style="width:auto">' + opts.map(o => '<option value="' + o[0] + '"' + (String(f[k]) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
    return '<div class="card"><div class="row"><input type="search" placeholder="Client, collaborateur ou mission (tenue, lettrage, TVA)…" data-in="search" value="' + esc(S.search) + '" style="flex:1;min-width:220px"></div>'
      + '<div class="row" style="margin-top:10px">' + sel('period', [['today', "Aujourd'hui"], ['week', 'Cette semaine'], ['month', 'Mois (' + fMonth(S.month) + ')'], ['all', 'Tout']])
      + sel('collab', [['', 'Tous les collaborateurs']].concat(collabs(true).filter(c => canSeeCollab(c.id)).map(c => [c.id, esc(c.name)])))
      + sel('status', [['', 'Tous statuts'], ['todo', 'À faire'], ['done', 'Terminées'], ['locked', 'Verrouillées'], ['unplanned', 'Non planifiées']])
      + sel('reception', [['', 'Réception : toutes'], ['recu', 'Éléments reçus'], ['attendu', 'Éléments attendus']])
      + sel('kind', [['', 'Tous types'], ['production', 'Production'], ['info', 'Demandes d\'infos']])
      + '<label class="cb"><input type="checkbox" data-ch="filter" data-k="late"' + (f.late ? ' checked' : '') + '> À reprendre</label><span class="spacer"></span><button class="btn sm" data-act="search-csv">⬇ CSV</button></div></div>'
      + inactiveNotice() + '<div class="only-m">' + clientFilters() + '</div><div class="card" id="results">' + searchResults() + '</div>';
  }
  function searchTasks() {
    const f = S.filters, td = today(), q = S.search.trim().toLowerCase(), ws = E.startOfWeek(td), we = E.addDays(ws, 6);
    return list('tasks').filter(t => {
      if (!canSeeCollab(t.collaborator_id)) return false;
      if (f.period === 'today' && !E.onDay(t, td)) return false;
      if (f.period === 'week' && !(t.planned_date >= ws && t.planned_date <= we)) return false;
      if (f.period === 'month' && t.month !== S.month) return false;
      if (f.collab && t.collaborator_id !== f.collab) return false;
      if (f.status === 'todo' && t.done) return false;
      if (f.status === 'done' && !t.done) return false;
      if (f.status === 'locked' && !t.locked) return false;
      if (f.status === 'unplanned' && (t.done || t.planned_date)) return false;
      if (f.kind && t.kind !== f.kind) return false;
      const p = S.data.productions.get(t.production_id);
      if (f.reception === 'recu' && !(p && p.received_date)) return false;
      if (f.reception === 'attendu' && (p && p.received_date)) return false;
      if (f.late && !(!t.done && ((t.planned_date && E.endDate(t) < td) || (t.due_date && t.due_date < td) || (t.planned_date && t.due_date && E.endDate(t) > t.due_date)))) return false;
      if (q) { const hay = ((clientOf(t.client_id) || {}).name + ' ' + ((collabOf(t.collaborator_id) || {}).name || '') + ' ' + E.KIND_LABEL[t.kind] + ' ' + t.kind).toLowerCase(); if (!hay.includes(q)) return false; }
      return true;
    }).sort((a, b) => (a.planned_date || '9').localeCompare(b.planned_date || '9') || (a.seq - b.seq));
  }
  function searchResults() {
    const ts = searchTasks();
    const tot = ts.reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
    return '<div class="small muted" style="margin-bottom:8px">' + ts.length + ' tâche(s) · ' + E.fmtMin(tot) + '</div>' + (ts.length ? '<div class="tasks">' + ts.slice(0, 300).map(t => taskRow(t, { showDate: true, showCollab: true })).join('') + '</div>' + (ts.length > 300 ? '<p class="muted small">300 premières affichées — affinez la recherche.</p>' : '') : '<div class="empty">Aucun résultat.</div>');
  }

  /* Suivi des demandes d'informations du mois (tableau de bord) */
  function irDashboard(m) {
    const prods = list('productions').filter(p => p.month === m && clientOf(p.client_id));
    const n = { faite: 0, a_faire: 0, non: 0, none: 0 };
    prods.forEach(p => n[p.info_request || 'none']++);
    const tot = prods.length || 1;
    const todo = prods.filter(p => p.info_request === 'a_faire').sort((a, b) => ((clientOf(a.client_id) || {}).name || '').localeCompare((clientOf(b.client_id) || {}).name || '', 'fr'));
    const cell = (k, lab, color) => '<div>' + '<span style="display:inline-flex;align-items:center;gap:6px"><i class="lg-sw" style="background:' + color + '"></i>' + lab + '</span><b data-count="' + n[k] + '" data-fmt="int" data-key="ir' + k + m + '">' + n[k] + '</b></div>';
    const seg = [['faite', 'var(--ok)'], ['a_faire', 'var(--warn)'], ['non', 'var(--ink)'], ['none', 'var(--track)']].map(s => n[s[0]] ? '<i style="width:' + (n[s[0]] / tot * 100).toFixed(1) + '%;background:' + s[1] + '"></i>' : '').join('');
    return '<div class="section-t"><h2>Demandes d\'informations</h2><span class="muted small">' + prods.length + ' dossier' + (prods.length > 1 ? 's' : '') + ' ce mois</span></div>'
      + '<div class="split">'
      + '<div class="card anim-in"><div class="card-h"><h2>Suivi du mois</h2><span class="badge ' + (n.a_faire ? 'o' : 'g') + '">' + (n.a_faire ? n.a_faire + ' à faire' : 'Rien à envoyer') + '</span></div>'
      + '<div class="segbar">' + seg + '</div>'
      + '<div class="ratios" style="grid-template-columns:repeat(4,minmax(0,1fr))">' + cell('a_faire', 'À faire', 'var(--warn)') + cell('faite', 'Faites', 'var(--ok)') + cell('non', 'Non nécessaires', 'var(--ink)') + cell('none', 'Non renseignées', 'var(--track)') + '</div></div>'
      + '<div class="frame anim-in"><div class="frame-h">' + ic('mail') + '<h2>Demandes à faire</h2>' + (todo.length ? '<span class="badge o">' + todo.length + '</span>' : '') + '</div><div class="inner">'
      + (todo.length ? '<div class="tasks">' + todo.slice(0, 12).map(p => { const c = clientOf(p.client_id), co = collabOf(c.collaborator_id); return '<div class="info-row"><span class="ibox o">' + ic('mail', 'sm') + '</span><div class="t" data-act="client" data-id="' + c.id + '" style="cursor:pointer"><b>' + esc(c.name) + '</b><span>' + esc(co ? co.name : '—') + (p.info_request_at ? ' · signalée le ' + fDM(p.info_request_at.slice(0, 10)) : '') + '</span></div><button class="btn sm" data-act="ir" data-pid="' + p.id + '" data-v="faite"' + (S.readonly ? ' disabled' : '') + '>' + ic('check', 'sm') + 'Marquer faite</button></div>'; }).join('') + '</div>' + (todo.length > 12 ? '<p class="small muted" style="margin-top:8px">+ ' + (todo.length - 12) + ' autre(s)</p>' : '')
        : '<div class="empty">Aucune demande en attente.</div>')
      + '</div></div></div>';
  }

  /* ====================== V26.186 : Planning « cockpit » de l'équipe ======================
   * Vue d'ensemble journalière (et hebdomadaire) de toute l'équipe, construite uniquement sur les données existantes :
   *  - tâches (dayTasks), heures affichées (withTimes : enchaînement depuis « day_start », comme avant), durées (minutesOn) ;
   *  - capacité quotidienne des collaborateurs (capacityOn : horaires, absences, fériés, jours d'école) ;
   *  - statuts existants : terminée (done), éléments attendus (prévisionnel), à reprendre / en retard, verrouillée ;
   *  - « en cours » n'est pas un statut enregistré : c'est la tâche placée sous la ligne de l'heure actuelle, aujourd'hui.
   * Aucune donnée, aucune règle métier nouvelles : le glisser-déposer, la fiche de la tâche et la replanification sont ceux de l'outil.
   * Couleurs : 3 états de remplissage propres au planning (< 90 % disponible, 90–100 % pleine, > 100 % au-delà) ;
   * les phrases d'alerte (« surcharge ») restent réservées au manager et au seuil ALERT_PCT (108 %). */
  const PC = { H0: 8 * 60, H1: 18 * 60, timer: 0 };
  const PC_TVA = ['CA3', 'CA12', 'ACPT'];
  const PC_KIND = { rc: 'Responsable client', collab: 'Collaborateur', apprenti: 'Apprenti' };
  const PC_ST = { done: 'Terminée', late: 'En retard', now: 'En cours', recv: 'À recevoir', todo: 'Planifiée' };
  const pcNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const pcCap1 = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  const pcNorm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function pcInit() {
    if (!S.pf) S.pf = { kind: '', client: '', status: '', q: '' };
    if (S.planAll === undefined) S.planAll = visibleCollabs().length > 1;
    if (S.planAll && visibleCollabs().length < 2) S.planAll = false;
    if (!S.planAll && !(collabOf(S.collabId) && canSeeCollab(S.collabId))) S.collabId = (canSeeCollab(S.me.collaborator_id) && S.me.collaborator_id) || (visibleCollabs()[0] || {}).id || null;
    S._pcOb = new Map();
  }
  /* Personnes affichées : toute l'équipe visible, ou une seule personne */
  // V26.192 : une personne seule (collaborateur, apprenti) a la même organisation que le RC : semaine en grille, mois en frise
  const pcSolo = () => visibleCollabs().length < 2;
  const pcScope = () => S.planAll ? visibleCollabs() : [collabOf(S.collabId)].filter(Boolean);

  /* Type de tâche (existant) : la tâche « production » est la tenue du dossier ; la TVA du mois vient du régime de TVA du dossier */
  function pcType(t) {
    if (t.kind === 'info') return { k: 'info', label: 'Demande' };
    if (t.kind === 'dashboard') return { k: 'dash', label: 'Tableau de bord' };
    if (t.kind === 'tva') return { k: 'tva', label: 'TVA' };
    return { k: 'tenue', label: t.kind === 'lettrage' ? 'Lettrage' : 'Tenue' };
  }
  function pcTva(t) {
    if (t.kind === 'tva') return true;
    if (t.kind !== 'production' && t.kind !== 'tenue') return false;
    const key = t.client_id + '|' + t.month;
    if (S._pcOb && S._pcOb.has(key)) return S._pcOb.get(key);
    const c = clientOf(t.client_id), v = !!(c && t.month && E.obligations(c, t.month, cfg()).some(o => PC_TVA.includes(o.code)));
    if (S._pcOb) S._pcOb.set(key, v);
    return v;
  }
  /* Statut affiché, à partir des statuts existants (aucun statut parallèle enregistré) */
  function pcState(t, date, slot) {
    const td = today(), p = S.data.productions.get(t.production_id), end = E.endDate(t);
    const st = { done: !!t.done, recv: !t.done && !!(p && !E.isReceived(t, p) && t.kind !== 'info'), late: !t.done && ((!!end && end < td) || (!!t.due_date && t.due_date < td)), now: false };
    if (!t.done && slot && date === td) { const n = pcNow(); st.now = n >= slot.a && n < slot.b; }
    st.key = st.done ? 'done' : st.late ? 'late' : st.now ? 'now' : st.recv ? 'recv' : 'todo';
    return st;
  }
  function pcMatch(t, st) {
    const f = S.pf;
    if (f.kind && (f.kind === 'tva' ? !pcTva(t) : pcType(t).k !== f.kind)) return false;
    if (f.client && t.client_id !== f.client) return false;
    if (f.status && (f.status === 'todo' ? st.done : !st[f.status])) return false;
    if (f.q) { const c = clientOf(t.client_id) || {}; if (!pcNorm(c.name + ' ' + pcType(t).label + (pcTva(t) ? ' tva' : '')).includes(pcNorm(f.q.trim()))) return false; }
    return true;
  }
  const pcFiltered = () => !!(S.pf.kind || S.pf.client || S.pf.status || S.pf.q);

  /* Remplissage : barre graphique à 3 états, sans pourcentage */
  function pcFill(total, cap) {
    if (cap <= 0) return { cls: total > 0 ? 'over' : 'off', pct: total > 0 ? 100 : 0, txt: total > 0 ? '+' + E.fmtMin(total) + ' hors jour travaillé' : '' };
    const pct = total / cap * 100, cls = pct > 100 ? 'over' : pct >= 90 ? 'full' : 'ok', free = cap - total;
    const txt = free > 0 ? E.fmtMin(free) + (free === 60 ? ' disponible' : ' disponibles') : free === 0 ? 'Journée complète'
      : '+' + E.fmtMin(-free) + (overAlert(total, cap) ? (isManager() ? ' de surcharge' : ' au-delà de la capacité') : ' au-delà');
    return { cls, pct: Math.min(100, pct), txt };
  }
  const pcBar = (f, thin) => '<span class="pc-bar' + (thin ? ' thin' : '') + ' f-' + f.cls + '"><i style="width:' + f.pct.toFixed(1) + '%"></i></span>';

  /* ---------- Listes (reprend les filtres rapides de l'outil, pour toute l'équipe affichée) ---------- */
  function pcSets(cs, m) {
    const out = { unpl: [], late: [], recv: [], info: [], done: [], tvatodo: [], tvasent: [] }, ids = new Set(cs.map(c => c.id)), td = today();
    cs.forEach(c => { const q = quickSets(c.id, m); Object.keys(out).forEach(k => out[k].push(...q[k])); });
    if (isAdmin() && S.planAll) out.unpl.push(...list('tasks').filter(t => t.month === m && !t.collaborator_id && !t.done && t.kind !== 'info')); // dossier sans collaborateur
    const open = list('tasks').filter(t => ids.has(t.collaborator_id) && !t.done);
    out.today = open.filter(t => E.onDay(t, td));
    out.soon = open.filter(t => t.kind !== 'info' && t.due_date && t.due_date >= td && E.daysBetween(td, t.due_date) <= cfg().due_soon_days).sort((a, b) => a.due_date.localeCompare(b.due_date));
    return out;
  }
  const PC_LISTS = { today: ['À traiter aujourd\'hui', 'clock', 'r'], soon: ['Échéances proches', 'flag', 'o'] };
  function pcListFrame(sets, m) {
    const k = S.quick; if (!k || !sets[k]) return '';
    const q = QUICK.find(d => d[0] === k), def = PC_LISTS[k] || (q && [q[1], q[2], q[3]]); if (!def) return '';
    const ts = sets[k], title = k === 'done' ? 'Terminées · ' + fMonth(m) : k === 'unpl' ? 'Tâches à affecter · ' + fMonth(m) : def[0];
    return '<div class="frame pc-frame anim-in no-print"><div class="frame-h">' + ic(def[1]) + '<h2>' + esc(title) + '</h2><span class="badge ' + def[2] + '">' + ts.length + '</span><button class="x" data-act="quick" data-q="' + k + '" aria-label="Fermer la liste">' + ic('x', 'sm') + '</button></div><div class="inner">'
      + (k === 'unpl' && ts.length ? '<p class="small" style="margin:0 0 10px">' + unplWhy(ts, m) + '</p>' : QUICK_TIP[k] ? '<p class="small muted" style="margin:0 0 10px">' + esc(QUICK_TIP[k]) + '</p>' : '')
      + (ts.length ? '<div class="tasks">' + ts.slice(0, 60).map(t => taskRow(t, { showDate: true, showCollab: S.planAll, swipe: false, drag: k === 'unpl' || k === 'late' })).join('') + '</div>' + (ts.length > 60 ? '<p class="small muted">+ ' + (ts.length - 60) + ' autre(s)</p>' : '') : '<div class="empty">Rien à signaler.</div>') + '</div></div>';
  }

  /* ---------- En-tête : 4 indicateurs, puis la date ---------- */
  function pcKpis(sets) {
    const k = (id, label, n, tone, sub) => '<button class="pc-kpi' + (S.quick === id ? ' on' : '') + '" data-act="quick" data-q="' + id + '" title="' + esc(QUICK_TIP[id] || label) + '"><span class="pc-kpi-l">' + label + '</span><span class="pc-kpi-v"><i class="pc-dot ' + (n ? tone : 'z') + '"></i><b class="' + (n ? tone : 'z') + '" data-count="' + n + '" data-key="pck-' + id + '">' + n + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></button>';
    return '<div class="pc-kpis no-print">' + k('today', 'À traiter aujourd\'hui', sets.today.length, 'r') + k('late', 'En retard', sets.late.length, 'r') + k('recv', 'À recevoir', sets.recv.length, 'o') + k('done', 'Terminé', sets.done.length, 'g', 'ce mois') + '</div>';
  }
  function pcDateLabel() {
    if (S.planMode === 'day') return pcCap1(fDate(S.cursor)) + ' ' + S.cursor.slice(0, 4);
    if (S.planMode === 'week') { const a = E.startOfWeek(S.cursor), b = E.addDays(a, 4); return 'Lun ' + Number(a.slice(8)) + (a.slice(5, 7) !== b.slice(5, 7) ? ' ' + fMonth(a.slice(0, 7)).split(' ')[0] : '') + ' → Ven ' + Number(b.slice(8)) + ' ' + fMonth(b.slice(0, 7)); }
    return pcCap1(fMonth(S.cursor.slice(0, 7)));
  }
  function pcToolbar(m) {
    const mode = S.planMode === 'month' ? 'pmonth' : S.planMode, td = today();
    const isNow = S.planMode === 'day' ? S.cursor === td : S.planMode === 'week' ? E.startOfWeek(S.cursor) === E.startOfWeek(td) : S.cursor.slice(0, 7) === td.slice(0, 7);
    const missing = isManager() ? missingForMonth(m) : 0;
    return '<div class="pc-top no-print"><div class="pc-nav"><button class="pc-arrow" data-act="nav" data-d="-1" aria-label="Précédent"' + (prevBlocked(mode) ? ' disabled' : '') + '>' + ic('chevL', 'sm') + '</button>'
      + '<div class="pc-date"><b>' + esc(pcDateLabel()) + '</b>' + (isNow ? '<span class="pc-now-pill">' + (S.planMode === 'day' ? 'Aujourd\'hui' : S.planMode === 'week' ? 'Cette semaine' : 'Ce mois-ci') + '</span>' : '') + '</div>'
      + '<button class="pc-arrow" data-act="nav" data-d="1" aria-label="Suivant">' + ic('chevR', 'sm') + '</button>' + (isNow ? '' : '<button class="btn sm" data-act="nav" data-d="0">Aujourd\'hui</button>') + '</div>'
      + '<div class="seg pc-seg">' + [['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois']].map(x => '<button class="' + (S.planMode === x[0] ? 'on' : '') + '" data-act="pmode" data-m="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>'
      + '<span class="spacer"></span><div class="pc-actions">'
      + (missing ? '<button class="btn sm" data-act="generate" data-m="' + m + '" title="Crée la production ' + deMonth(m) + ' pour les dossiers qui n\'y figurent pas encore, puis les planifie">' + ic('plus', 'sm') + 'Créer les dossiers du mois (' + missing + ')</button>' : '')
      + (canReplan() ? '<button class="btn sm pc-opt" data-act="replan" data-m="' + m + '" data-opt="1" title="Propose des déplacements pour soulager les journées trop remplies — rien ne bouge sans votre validation">' + ic('sparkle', 'sm') + 'Optimiser le planning</button>' : '')
      + '<button class="btn sm icon-l hide-m" data-act="print" title="Imprimer ou enregistrer en PDF">' + ic('download', 'sm') + 'PDF</button></div></div>';
  }
  function pcFilters(m) {
    const cs = visibleCollabs(), f = S.pf;
    const ids = new Set(pcScope().map(c => c.id));
    const cls = [...new Set(list('tasks').filter(t => t.month === m && (ids.has(t.collaborator_id) || (!t.collaborator_id && isAdmin()))).map(t => t.client_id))].map(clientOf).filter(Boolean).sort(byName);
    if (f.client && !cls.some(c => c.id === f.client)) { const c = clientOf(f.client); if (c) cls.unshift(c); }
    const sel = (k, cur, opts, all) => '<select class="pc-sel' + (cur ? ' v2-active' : '') + '" data-ch="pc-f" data-k="' + k + '" aria-label="' + all + '"><option value="">' + all + '</option>' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    const who = cs.length > 1 ? '<select class="pc-sel pc-who-sel' + (S.planAll ? '' : ' v2-active') + '" data-ch="pc-who" aria-label="Collaborateurs"><option value="">Toute l\'équipe (' + cs.length + ')</option>' + cs.map(c => '<option value="' + c.id + '"' + (!S.planAll && S.collabId === c.id ? ' selected' : '') + '>' + esc(c.name) + (c.id === S.me.collaborator_id ? ' (moi)' : '') + '</option>').join('') + '</select>' : '';
    return '<div class="pc-filters no-print" data-keep="pc-filters">' + who
      + sel('client', f.client, cls.map(c => [c.id, c.name]), 'Tous les dossiers')
      + sel('status', f.status, [['todo', 'À faire'], ['now', 'En cours'], ['late', 'En retard'], ['recv', 'À recevoir'], ['done', 'Terminées']], 'Tous les statuts')
      + '<label class="pc-search">' + ic('search', 'sm') + '<input type="search" data-in="pc-q" placeholder="Rechercher un dossier" value="' + esc(f.q) + '" aria-label="Rechercher un dossier"></label>'
      + (pcFiltered() ? '<button class="btn sm ghost" data-act="pc-reset">Effacer les filtres</button>' : '') + '</div>';
  }
  const pcLegend = () => '<div class="pc-legend no-print"><span><i class="t-tenue"></i>Tenue</span><span><i class="t-tva"></i>TVA du mois</span><span><i class="t-info"></i>Demande</span><span class="sep"></span><span><i class="s-now"></i>En cours</span><span><i class="s-recv"></i>À recevoir</span><span><i class="s-late"></i>En retard</span><span><i class="s-done"></i>Terminée</span></div>';

  /* ---------- Cartes de tâche ---------- */
  function pcTip(t, st, slot, date) {
    const c = clientOf(t.client_id) || { name: '?' }, co = collabOf(t.collaborator_id), ob = c.id && t.month ? E.obligations(c, t.month, cfg()).filter(o => PC_TVA.includes(o.code)) : [];
    return [c.name, pcType(t).label + (ob.length ? ' + TVA ' + ob.map(o => o.code + ' (éch. ' + fDM(o.due) + ')').join(', ') : ''),
      slot ? E.fmtClock(slot.a) + ' → ' + E.fmtClock(slot.b) + ' (' + E.fmtMin(slot.b - slot.a) + ')' : durLabel(t, date),
      co ? co.name : 'Sans collaborateur', PC_ST[st.key] + (st.recv && st.key !== 'recv' ? ' · éléments attendus' : ''),
      !t.done && t.due_date ? 'Échéance ' + fDM(t.due_date) : '', t.locked ? 'Verrouillée : la replanification ne la déplace pas' : '', 'Cliquer pour ouvrir la fiche'].filter(Boolean).join('\n');
  }
  const pcDrag = t => canEditTask(t) && !t.locked && !t.done && !S.readonly ? ' draggable="true" data-drag="' + t.id + '"' : '';
  const pcStDot = st => '<i class="pc-st s-' + st.key + '"' + (st.key === 'done' ? '>' + CHECK_SVG + '</i>' : '></i>');
  /* Bloc de la frise du jour : largeur = durée (30 min = moitié d'une heure) */
  function pcBlock(it, d, h0, span) {
    const t = it.t, c = clientOf(t.client_id) || { name: '?' }, ty = pcType(t), tva = pcTva(t), st = pcState(t, d, it), m = it.b - it.a;
    const l = (it.a - h0) / span * 100, w = Math.max(m, 4) / span * 100;
    return '<div class="pc-blk t-' + (ty.k === 'tenue' && tva ? 'tenue tv' : ty.k) + ' s-' + st.key + (st.recv ? ' fc' : '') + (t.locked ? ' lk' : '') + (m < 25 ? ' xs xxs' : m < 45 ? ' xs' : m < 80 ? ' sm' : '') + (S.flash.has(t.id) ? ' flash' : '') + (t._unsaved ? ' unsaved' : '') + (t._failed ? ' failed' : '')
      + '" style="left:calc(' + l.toFixed(3) + '% + 2px);width:calc(' + w.toFixed(3) + '% - 4px)" role="button" tabindex="0" data-act="task" data-id="' + t.id + '" data-date="' + d + '" data-a="' + it.a + '" data-b="' + it.b + '"' + pcDrag(t) + ' title="' + esc(pcTip(t, st, it, d)) + '">'
      + '<div class="pc-blk-k"><span>' + ty.label + '</span>' + (tva && ty.k === 'tenue' ? '<em>TVA</em>' : '') + pcStDot(st) + '</div>'
      + (m < 25 ? '<span class="pc-blk-i">' + (t.kind === 'info' ? ic('mail', 'sm') : '') + '</span>' : '') + '<div class="pc-blk-n">' + esc(c.name) + '</div>'
      + '<div class="pc-blk-d">' + (st.key === 'now' ? '<b>En cours</b> · ' : '') + durLabel(t, d, true) + '</div></div>';
  }
  /* Carte compacte (semaine, tâches à affecter) : 2 lignes, sans cadenas */
  function pcCard(t, d, o) {
    o = o || {};
    const c = clientOf(t.client_id) || { name: '?' }, ty = pcType(t), tva = pcTva(t), st = pcState(t, d, null), td = today();
    const due = !t.done && t.due_date && (st.late || E.daysBetween(td, t.due_date) <= cfg().due_soon_days) ? '<div class="pc-card-d' + (t.due_date < td ? ' bad' : '') + '">Échéance ' + Number(t.due_date.slice(8)) + '/' + t.due_date.slice(5, 7) + '</div>' : '';
    return '<div class="pc-card t-' + (ty.k === 'tenue' && tva ? 'tenue tv' : ty.k) + ' s-' + st.key + (st.recv ? ' fc' : '') + (S.flash.has(t.id) ? ' flash' : '') + (t._unsaved ? ' unsaved' : '') + (t._failed ? ' failed' : '') + '" role="button" tabindex="0" data-act="task" data-id="' + t.id + '"' + pcDrag(t) + ' title="' + esc(pcTip(t, st, null, d)) + '">'
      + '<div class="pc-card-n">' + esc(c.name) + '</div>'
      + '<div class="pc-card-m"><span>' + (d ? durLabel(t, d, true) : E.fmtMin(t.duration_min)) + '</span><span class="dotsep">·</span><span class="pc-k">' + ty.label + '</span>' + (tva && ty.k === 'tenue' ? '<em>TVA</em>' : '') + (o.who ? '<span class="dotsep">·</span><span class="pc-who-s">' + esc((collabOf(t.collaborator_id) || {}).name || 'Sans collaborateur') + '</span>' : '') + pcStDot(st) + '</div>' + due + '</div>';
  }
  const pcAv = c => '<span class="pc-av" style="--c:' + esc(c.color || '#8a8f98') + '">' + esc(initials(c.name)) + '</span>';

  /* ---------- Vue Jour : frise horaire de l'équipe ---------- */
  function pcDay(d, sets, m) {
    const x = ctx(), td = today(), st0 = E.parseClock(cfg().day_start), all = list('tasks');
    const rows = pcScope().map(c => {
      const items = withTimes(dayTasks(c.id, d), d).map(it => { const a = E.parseClock(it.time), mm = E.minutesOn(it.t, d) || 0; return { t: it.t, a, b: a + mm }; });
      const cap = E.capacityOn(c, d, x), load = E.loadOf(all, c.id, d).total;
      return { c, items, cap, load, ab: E.absenceOn(c.id, d, x) };
    });
    let h0 = Math.min(PC.H0, Math.floor(st0 / 60) * 60), h1 = PC.H1;
    rows.forEach(r => { r.items.forEach(i => { h1 = Math.max(h1, Math.ceil(i.b / 60) * 60); }); if (r.cap) h1 = Math.max(h1, Math.ceil((st0 + r.cap) / 60) * 60); });
    h1 = Math.min(Math.max(h1, h0 + 60), 24 * 60);
    const span = h1 - h0, hours = span / 60, pos = v => ((v - h0) / span * 100).toFixed(3) + '%';
    const head = '<div class="pc-row pc-head"><div class="pc-who pc-who-h"><b>' + (S.planAll ? 'Équipe' : 'Planning') + '</b><span>' + rows.length + ' personne' + (rows.length > 1 ? 's' : '') + '</span></div><div class="pc-hours">'
      + Array.from({ length: hours }, (_, i) => '<span style="left:' + (i / hours * 100).toFixed(3) + '%">' + E.fmtClock(h0 + i * 60) + '</span>').join('') + '<span class="end">' + E.fmtClock(h1) + '</span></div></div>';
    // tâches à affecter (non planifiées / sans collaborateur) : à glisser sur la ligne d'une personne
    const un = sets.unpl.filter(t => pcMatch(t, pcState(t, d, null)));
    const unRow = un.length ? '<div class="pc-row pc-unpl"><div class="pc-who"><span class="pc-av ghost">' + ic('inbox', 'sm') + '</span><div class="pc-who-t"><b>À affecter</b><span>' + un.length + ' tâche' + (un.length > 1 ? 's' : '') + ' · ' + esc(fMonth(m).split(' ')[0]) + '</span></div></div>'
      + '<div class="pc-unpl-list" data-keep="pc-unpl">' + un.map(t => pcCard(t, null, { who: S.planAll })).join('') + '</div></div>' : '';
    const body = rows.map(r => {
      const f = pcFill(r.load, r.cap), hol = x.settings.holidays && E.holidayName(d), off = r.cap <= 0;
      const offLbl = hol ? 'Férié · ' + hol : r.ab && (r.ab.minutes === null || r.ab.minutes === undefined || r.ab.minutes === '') ? absLabel(r.ab) : r.c.kind === 'apprenti' ? 'École / hors entreprise' : 'Non travaillé';
      const shown = r.items.filter(i => pcMatch(i.t, pcState(i.t, d, i)));
      const lastEnd = r.items.reduce((v, i) => Math.max(v, i.b), st0), capEnd = st0 + r.cap;
      const ghost = !off && capEnd > lastEnd && d >= td && !pcFiltered() ? '<div class="pc-free" style="left:' + pos(lastEnd) + ';width:' + ((capEnd - lastEnd) / span * 100).toFixed(3) + '%" title="Disponible : ' + E.fmtMin(capEnd - lastEnd) + '"><span>' + (capEnd - lastEnd >= 50 ? 'Disponible · ' : '') + E.fmtMin(capEnd - lastEnd) + '</span></div>' : '';
      const zones = '<i class="pc-zone" style="left:0;width:' + pos(st0) + '"></i>' + (off ? '' : '<i class="pc-zone" style="left:' + pos(Math.min(capEnd, h1)) + ';right:0"></i><i class="pc-capend' + (overAlert(r.load, r.cap) ? ' over' : '') + '" style="left:' + pos(Math.min(capEnd, h1)) + '"></i>');
      return '<div class="pc-row' + (off ? ' off' : '') + '"><div class="pc-who">' + pcAv(r.c) + '<div class="pc-who-t"><b>' + esc(r.c.name) + (r.c.id === S.me.collaborator_id ? ' <small>moi</small>' : '') + '</b><span>' + esc(PC_KIND[r.c.kind] || '') + '</span>'
        + '<span class="pc-who-load"><b>' + E.fmtMin(r.load) + '</b>' + (r.cap ? ' / ' + E.fmtMin(r.cap) : '') + '<span class="lbl"> planifiées</span></span>' + (off && !r.load ? '' : pcBar(f, true) + '<span class="pc-who-f f-' + f.cls + '">' + esc(f.txt) + '</span>') + '</div></div>'
        + '<div class="pc-track" data-drop="' + d + '" data-dc="' + r.c.id + '">' + zones + (off ? '<span class="pc-off-l">' + esc(offLbl) + '</span>' : '') + ghost + shown.map(i => pcBlock(i, d, h0, span)).join('') + '</div></div>';
    }).join('');
    const n = pcNow(), now = d === td && n >= h0 && n <= h1 ? '<div class="pc-now" style="--p:' + ((n - h0) / span).toFixed(4) + '"><b>' + E.fmtClock(n) + '</b></div>' : '';
    return '<div class="card pc-board"><div class="pc-scroll" data-keep="pc-day"><div class="pc-tl" style="--hours:' + hours + '" data-h0="' + h0 + '" data-h1="' + h1 + '" data-date="' + d + '">' + head + unRow + body + now + '</div></div>'
      + (rows.some(r => r.items.length) || un.length ? '' : '<div class="empty" style="margin-top:12px">Aucune tâche ce jour-là.</div>')
      + '<p class="pc-hint small muted no-print hide-m">Glissez une tâche sur la ligne d\'une personne pour la lui confier ce jour-là · cliquez pour ouvrir sa fiche. Les heures affichées enchaînent les tâches à partir de ' + esc(cfg().day_start) + ' (Paramètres).</p></div>';
  }

  /* ---------- Vue Semaine de l'équipe : une ligne par personne, une colonne par jour ---------- */
  function pcWeek(sets, m) {
    const x = ctx(), td = today(), start = E.startOfWeek(S.cursor), days = E.rangeDates(start, E.addDays(start, 4)), all = list('tasks'), win = E.windowOf(S.cursor.slice(0, 7), x.settings);
    const head = '<div class="pc-wrow pc-whead"><div class="pc-who pc-who-h"><b>' + (S.planAll ? 'Équipe' : 'Planning') + '</b><span>Semaine</span></div>' + days.map(d => {
      const isT = d === td, hol = x.settings.holidays && E.holidayName(d);
      return '<div class="pc-wday' + (isT ? ' today' : '') + (d < win.start || d > win.end ? ' outwin' : '') + '" data-act="goday" data-date="' + d + '" role="button" tabindex="0" title="Ouvrir la journée"><b>' + (isT ? '<i class="pc-dot g"></i>' : '') + pcCap1(DAYS_S[E.dow(d) - 1].replace('.', '')) + ' ' + Number(d.slice(8)) + ' ' + MONTHS_S[Number(d.slice(5, 7)) - 1] + '</b>' + (isT ? '<span class="pc-now-pill">Aujourd\'hui</span>' : hol ? '<span class="small muted">Férié</span>' : '') + '</div>';
    }).join('') + '</div>';
    const un = sets.unpl.filter(t => pcMatch(t, pcState(t, null, null)));
    const unRow = un.length ? '<div class="pc-unpl pc-unpl-w"><div class="pc-who"><span class="pc-av ghost">' + ic('inbox', 'sm') + '</span><div class="pc-who-t"><b>À affecter</b><span>' + un.length + ' tâche' + (un.length > 1 ? 's' : '') + ' · ' + esc(fMonth(m).split(' ')[0]) + '</span></div></div><div class="pc-unpl-list" data-keep="pc-unpl-w">' + un.map(t => pcCard(t, null, { who: S.planAll })).join('') + '</div></div>' : '';
    const rows = pcScope().map(c => {
      let tl = 0, tc = 0;
      const cells = days.map(d => {
        const cap = E.capacityOn(c, d, x), load = E.loadOf(all, c.id, d).total; tl += load; tc += cap;
        const f = pcFill(load, cap), ts = dayTasks(c.id, d).filter(t => pcMatch(t, pcState(t, d, null)));
        const hol = x.settings.holidays && E.holidayName(d), ab = E.absenceOn(c.id, d, x);
        const max = 6, more = ts.length - max;
        return '<div class="pc-wcell' + (d === td ? ' today' : '') + (!cap && !load ? ' off' : '') + '" data-drop="' + d + '" data-dc="' + c.id + '">'
          + (cap || load ? '<div class="pc-wcap" title="' + esc(E.fmtMin(load) + ' planifiées sur ' + E.fmtMin(cap) + ' · ' + f.txt) + '"><span><b>' + E.fmtMin(load) + '</b> / ' + E.fmtMin(cap) + '</span>' + pcBar(f, true) + '</div>' : '<div class="pc-off-l">' + esc(hol ? 'Férié' : ab ? absLabel(ab) : c.kind === 'apprenti' ? 'École' : 'Non travaillé') + '</div>')
          + ts.slice(0, more > 0 ? max - 1 : max).map(t => pcCard(t, d)).join('') + (more > 0 ? '<button class="pc-more" data-act="teamcell" data-c="' + c.id + '" data-date="' + d + '">+ ' + (more + 1) + ' autres</button>' : '') + '</div>';
      }).join('');
      const f = pcFill(tl, tc);
      return '<div class="pc-wrow"><div class="pc-who">' + pcAv(c) + '<div class="pc-who-t"><b>' + esc(c.name) + (c.id === S.me.collaborator_id ? ' <small>moi</small>' : '') + '</b><span>' + esc(PC_KIND[c.kind] || '') + '</span>' + (tc || tl ? '<span class="pc-who-load"><b>' + E.fmtMin(tl) + '</b> / ' + E.fmtMin(tc) + '</span>' + pcBar(f, true) + '<span class="pc-who-f f-' + f.cls + '">' + esc(f.txt) + '</span>' : '<span class="pc-who-load">Non travaillé cette semaine</span>') + '</div></div>' + cells + '</div>';
    }).join('');
    return '<div class="card pc-board pc-wboard">' + unRow + '<div class="pc-scroll" data-keep="pc-week"><div class="pc-wgrid">' + head + rows + '</div></div>'
      + '<p class="pc-hint small muted no-print hide-m">Glissez une tâche vers un autre jour ou une autre personne · cliquez sur un jour pour l\'ouvrir en vue Jour.</p></div>';
  }

  /* ---------- Cartes de pilotage sous le planning ---------- */
  function pcCards(dates, sets, m) {
    const x = ctx(), all = list('tasks'), cs = pcScope(), td = today(), isDay = dates.length === 1;
    const per = cs.map(c => { let l = 0, cap = 0; dates.forEach(d => { l += E.loadOf(all, c.id, d).total; cap += E.capacityOn(c, d, x); }); return { c, l, cap, f: pcFill(l, cap) }; });
    const act = '<div class="card pc-c"><div class="pc-c-h"><h3>' + (S.planAll ? 'Activité de l\'équipe' : 'Activité') + '</h3><span class="small muted">' + (isDay ? esc(pcCap1(fDate(dates[0]))) : 'semaine') + '</span></div><div class="pc-act">'
      + per.map(p => '<div class="pc-act-r">' + pcAv(p.c) + '<div class="pc-act-b"><div class="pc-act-t"><b>' + esc(p.c.name) + '</b><span>' + (p.cap || p.l ? '<b>' + E.fmtMin(p.l) + '</b> / ' + E.fmtMin(p.cap) : '—') + '</span></div>' + pcBar(p.f) + '<span class="pc-who-f f-' + p.f.cls + '">' + esc(p.cap || p.l ? p.f.txt : 'Non travaillé') + '</span></div></div>').join('')
      + '</div><div class="pc-c-leg small muted"><span><i class="f-ok"></i>Disponible</span><span><i class="f-full"></i>Journée pleine (90–100 %)</span><span><i class="f-over"></i>Au-delà de la capacité</span></div></div>';
    const un = sets.unpl;
    const aff = '<div class="card pc-c"><div class="pc-c-h"><h3>Tâches à affecter</h3>' + (un.length ? '<span class="badge o">' + un.length + '</span>' : '') + '</div>'
      + (un.length ? '<div class="pc-aff">' + un.slice(0, 4).map(t => { const c = clientOf(t.client_id) || {}; return '<div class="pc-aff-r"><div><b>' + esc(c.name || '?') + '</b><span class="small muted">' + pcType(t).label + (pcTva(t) ? ' + TVA' : '') + ' · ' + E.fmtMin(t.duration_min) + (S.planAll ? ' · ' + esc((collabOf(t.collaborator_id) || {}).name || 'sans collaborateur') : '') + '</span></div>' + (canEditTask(t) ? '<button class="btn sm" data-act="task" data-id="' + t.id + '">Affecter</button>' : '') + '</div>'; }).join('') + '</div>'
        + (un.length > 4 ? '<button class="btn sm ghost pc-c-more" data-act="quick" data-q="unpl">Voir les ' + un.length + ' tâches</button>' : '') : '<div class="pc-c-empty">' + ic('check', 'sm') + 'Tout est planifié sur ' + esc(fMonth(m).split(' ')[0]) + '.</div>') + '</div>';
    // À surveiller : uniquement des informations existantes
    const overDays = []; cs.forEach(c => dates.forEach(d => { const cap = E.capacityOn(c, d, x), l = E.loadOf(all, c.id, d).total; if (l > 0 && overAlert(l, cap)) overDays.push(d); }));
    const watch = [
      sets.late.length && ['late', 'alert', 'r', 'En retard', sets.late.length],
      sets.soon.length && ['soon', 'flag', 'o', 'Échéances dans les ' + cfg().due_soon_days + ' jours', sets.soon.length],
      sets.info.length && ['info', 'mail', 'o', 'Demandes d\'infos à faire', sets.info.length],
      sets.tvatodo.length && ['tvatodo', 'file', 'o', 'TVA à déposer (tenue terminée)', sets.tvatodo.length],
      sets.recv.length && ['recv', 'inbox', 'b', 'Éléments attendus', sets.recv.length]
    ].filter(Boolean);
    const sv = '<div class="card pc-c"><div class="pc-c-h"><h3>À surveiller</h3></div><div class="pc-watch">'
      + (overDays.length ? '<button class="pc-w-r" data-act="goday" data-date="' + overDays.sort()[0] + '"><span class="ibox r">' + ic('flame', 'sm') + '</span><span>' + (isManager() ? 'Journée' + (overDays.length > 1 ? 's' : '') + ' en surcharge' : 'Journée' + (overDays.length > 1 ? 's' : '') + ' très remplie' + (overDays.length > 1 ? 's' : '')) + ' (≥ ' + ALERT_PCT + ' %)</span><b>' + overDays.length + '</b>' + ic('chevR', 'sm') + '</button>' : '')
      + (S.failed.length ? '<button class="pc-w-r" data-act="retry"><span class="ibox r">' + ic('alert', 'sm') + '</span><span>Modifications non enregistrées</span><b>' + S.failed.length + '</b>' + ic('chevR', 'sm') + '</button>' : '')
      + watch.map(w => '<button class="pc-w-r' + (S.quick === w[0] ? ' on' : '') + '" data-act="quick" data-q="' + w[0] + '"><span class="ibox ' + w[2] + '">' + ic(w[1], 'sm') + '</span><span>' + w[3] + '</span><b>' + w[4] + '</b>' + ic('chevR', 'sm') + '</button>').join('')
      + (!overDays.length && !S.failed.length && !watch.length ? '<div class="pc-c-empty">' + ic('check', 'sm') + 'Rien à signaler.</div>' : '') + '</div></div>';
    const ids = new Set(cs.map(c => c.id)), inRange = all.filter(t => ids.has(t.collaborator_id) && dates.some(d => E.onDay(t, d)));
    const hrs = per.reduce((s, p) => s + p.l, 0), caps = per.reduce((s, p) => s + p.cap, 0), doneN = inRange.filter(t => t.done).length;
    const syn = '<div class="card pc-c"><div class="pc-c-h"><h3>Synthèse</h3><span class="small muted">' + (isDay ? 'jour' : 'semaine') + '</span></div><div class="pc-syn">'
      + '<div class="sy-a"><b data-count="' + inRange.length + '" data-key="pcs-n">' + inRange.length + '</b><span>tâche' + (inRange.length > 1 ? 's' : '') + (isDay ? ' ce jour' : ' cette semaine') + '</span></div>'
      + '<div class="sy-v"><b>' + E.fmtMin(hrs) + '</b><span>planifiées' + (caps ? ' sur ' + E.fmtMin(caps) : '') + '</span></div>'
      + '<div class="sy-t"><b>' + cs.length + '</b><span>collaborateur' + (cs.length > 1 ? 's' : '') + '</span></div>'
      + '<div class="sy-g"><b>' + doneN + '</b><span>terminée' + (doneN > 1 ? 's' : '') + '</span></div></div>'
      + '<div class="pc-syn-f small muted"><button class="lnk" data-act="quick" data-q="done">' + sets.done.length + ' tenue' + (sets.done.length > 1 ? 's' : '') + ' terminée' + (sets.done.length > 1 ? 's' : '') + ' en ' + esc(fMonth(m).split(' ')[0]) + '</button> · <button class="lnk" data-act="quick" data-q="tvasent">' + sets.tvasent.length + ' TVA envoyée' + (sets.tvasent.length > 1 ? 's' : '') + '</button></div></div>';
    return '<div class="pc-cards">' + act + aff + sv + syn + '</div>';
  }

  /* ---------- Écran ---------- */
  function pcMain(sets, m) {
    if (S.planMode === 'day') return pcDay(S.cursor, sets, m) + pcCards([S.cursor], sets, m);
    if (S.planMode === 'week') {
      const start = E.startOfWeek(S.cursor), days = E.rangeDates(start, E.addDays(start, 4));
      return (S.planAll || pcSolo() ? pcWeek(sets, m) : planWeek(pcScope()[0])) + pcCards(days, sets, m);
    }
    // V26.193 : mois en cours — seuls les jours à partir d'aujourd'hui sont affichés ; un petit menu montre les premiers jours si besoin
    const td = today(), cur = m === td.slice(0, 7), wd = E.monthDates(m).filter(d => E.dow(d) <= 5), past = cur ? wd.filter(d => d < td) : [];
    const from = past.length && !S.pcMonthAll ? td : null;
    const bar = past.length ? '<div class="pc-mfrom no-print"><select class="pc-sel' + (S.pcMonthAll ? ' v2-active' : '') + '" data-ch="pc-mall" aria-label="Jours affichés"><option value="">Du ' + Number(td.slice(8)) + ' à la fin du mois</option><option value="1"' + (S.pcMonthAll ? ' selected' : '') + '>Tout le mois (avec les ' + (Number(td.slice(8)) - 1) + ' premiers jours)</option></select></div>' : '';
    if (S.planAll || pcSolo()) { const g = teamGantt(wd.filter(d => !from || d >= from)); return bar + (isManager() ? g : g.replace('Jour surchargé', 'Jour au-delà de la capacité')); } // vocabulaire V26.173
    return bar + planMonth(pcScope()[0], m, from);
  }
  function pcView() {
    pcInit();
    const m = S.cursor.slice(0, 7), cs = pcScope();
    if (!cs.length) return '<div class="notice">Sélectionnez un collaborateur.</div>';
    const sets = pcSets(cs, m);
    S._pcSets = sets;
    if (!PC.timer) PC.timer = setInterval(pcTick, 30000);
    setTimeout(pcAfter, 0);
    return '<div class="print-title">Planning — ' + esc(S.planAll ? 'équipe' : cs[0].name) + ' — ' + esc(pcDateLabel()) + '</div><div class="pc">'
      + pcKpis(sets) + pcToolbar(m) + pcFilters(m) + pcListFrame(sets, m) + (S.planMode !== 'month' ? pcLegend() : '')
      + '<div id="pc-main">' + pcMain(sets, m) + '</div></div>';
  }
  /* Recherche : seule la partie planning + cartes est recalculée (le champ garde le focus) */
  function pcRefresh() { const el = $('#pc-main'); if (!el || !S._pcSets) return; S._pcOb = new Map(); el.innerHTML = pcMain(S._pcSets, S.cursor.slice(0, 7)); animateCounts(el); pcAfter(); }
  /* Ligne de l'heure actuelle et tâche « en cours » : mises à jour sans réafficher l'écran */
  function pcTick() {
    if (S.route !== 'planning') return;
    const n = pcNow();
    document.querySelectorAll('.pc-tl[data-h0]').forEach(tl => {
      const h0 = +tl.dataset.h0, h1 = +tl.dataset.h1, isT = tl.dataset.date === today();
      let el = tl.querySelector('.pc-now');
      if (isT && n >= h0 && n <= h1) {
        if (!el) { el = document.createElement('div'); el.className = 'pc-now'; el.innerHTML = '<b></b>'; tl.appendChild(el); }
        el.style.setProperty('--p', ((n - h0) / (h1 - h0)).toFixed(4)); el.querySelector('b').textContent = E.fmtClock(n);
      } else if (el) el.remove();
      tl.querySelectorAll('.pc-blk[data-a]').forEach(b => { if (b.classList.contains('s-done') || b.classList.contains('s-late')) return; const on = isT && n >= +b.dataset.a && n < +b.dataset.b; b.classList.toggle('s-now', on); });
    });
  }
  /* Arrivée sur la vue Jour d'aujourd'hui : la frise défile jusqu'à l'heure actuelle (téléphone, petite fenêtre) */
  function pcAfter() {
    const ws = document.querySelector('.pc-scroll[data-keep="pc-week"]'), wt = ws && ws.querySelector('.pc-wday.today');
    if (wt && ws.scrollWidth > ws.clientWidth + 4) { const k = 'w' + E.startOfWeek(S.cursor) + (S.planAll ? '*' : S.collabId); if (S._pcScrolled !== k) { S._pcScrolled = k; ws.scrollLeft = Math.max(0, wt.offsetLeft - ((ws.querySelector('.pc-who') || {}).offsetWidth || 0)); } }
    const sc = document.querySelector('.pc-scroll[data-keep="pc-day"]'), tl = sc && sc.querySelector('.pc-tl');
    if (!sc || !tl || sc.scrollWidth <= sc.clientWidth + 4) return;
    const key = tl.dataset.date + (S.planAll ? '*' : S.collabId);
    if (S._pcScrolled === key) return; S._pcScrolled = key;
    if (tl.dataset.date !== today()) return;
    const h0 = +tl.dataset.h0, h1 = +tl.dataset.h1, who = (tl.querySelector('.pc-row .pc-who') || {}).offsetWidth || 0;
    const p = Math.max(0, Math.min(1, (pcNow() - 60 - h0) / (h1 - h0)));
    sc.scrollLeft = Math.round(p * (tl.scrollWidth - who));
  }
  /* Optimiser le planning : résumé avant toute proposition (rien n'est déplacé sans validation) */
  function pcOptStats(m) {
    const x = ctx(), td = today(), win = E.windowOf(m, x.settings), all = list('tasks'), from = td > win.start ? td : win.start;
    const dates = from <= win.end ? E.rangeDates(from, win.end).filter(d => E.isWorkday(d)) : [];
    let over = 0, free = 0;
    visibleCollabs().forEach(c => { let f = 0; dates.forEach(d => { const cap = E.capacityOn(c, d, x), l = E.loadOf(all, c.id, d).total; if (l > 0 && overAlert(l, cap)) over++; f += Math.max(0, cap - l); }); if (f >= 60) free++; });
    return { over, free, days: dates.length };
  }
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
    return migNotice() + inactiveNotice() + pilotTabs() + teamPicker() + (ov ? synthSection() + milestoneBanner(m) : '') + '<div class="row" style="margin-bottom:6px">' + monthNav() + '<span class="spacer"></span>' + monthActions(m) + '</div>'
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
      + '</div>' : '')
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
      + '<div class="form" style="margin-top:14px">' + num('freeze_days', 'Zone figée : aujourd\'hui + jours ouvrés', st.freeze_days, 0, 5) + '</div><p class="small muted" style="margin:6px 0 0">Dans la zone figée, un dossier reçu déjà planifié n\'est pas déplacé quand un autre dossier arrive (sauf « Forcer » lors d\'une replanification).</p>'
      + '<div class="row" style="margin-top:12px">' + chk('agent_enabled', 'Agent de planification : apprend des mois précédents et ajuste les dates de réception prévues', st.agent_enabled) + '</div></div>'
      + '<div class="card"><div class="card-h"><h2>Historique pour l\'agent</h2><span class="small muted">' + S.data.learning_history.size + ' ligne(s) importée(s)</span></div>'
      + (S.v7 ? '<p class="small">Importez vos mois passés (dates de réception réelles et temps réels) : l\'agent est précis dès le premier mois au lieu d\'apprendre progressivement.</p><div class="row"><button class="btn primary" data-act="hist-import">📥 Importer l\'historique</button><button class="btn" data-act="hist-template">⬇ Modèle pré-rempli (vos dossiers, 12 derniers mois)</button></div>'
        : '<div class="notice warn">Exécutez une fois <b>supabase/migration_v1_7.sql</b> dans Supabase (SQL Editor) pour activer l\'historique, la réception partielle et l\'agent.</div>') + '</div>'
      + (S.store.mode === 'demo' ? '<div class="card"><h2 style="margin-bottom:10px">Mode démo</h2><button class="btn danger" data-act="demo-reset">Effacer toutes les données de démonstration</button></div>' : '');
    function num(k, l, v, mi, ma) { return '<label class="f"><span>' + l + '</span><input type="number" min="' + mi + '" max="' + ma + '" data-ch="setting" data-k="' + k + '" value="' + esc(v) + '"></label>'; }
    function chk(k, l, v) { return '<label class="cb"><input type="checkbox" data-ch="setting" data-k="' + k + '"' + (v ? ' checked' : '') + '> ' + l + '</label>'; }
  }

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
      inner = s.type === 'task' ? sheetTask(s) : s.type === 'prodDetail' ? sheetProdDetail(s) : s.type === 'filDetail' ? sheetFilDetail(s) : s.type === 'msDetail' ? sheetMsDetail(s) : s.type === 'rebal' ? sheetRebalance(s) : s.type === 'diag' ? sheetDiag(s) : s.type === 'tvaRecap' ? sheetTvaRecap(s) : s.type === 'isRecap' ? sheetIsRecap(s) : s.type === 'viewUser' ? sheetViewUser(s) : s.type === 'isCalc' ? sheetIsCalc(s) : s.type === 'cfeRecap' ? sheetCfeRecap(s) : s.type === 'relance' ? sheetRelance(s) : s.type === 'group' ? sheetGroup(s) :s.type === 'client' ? sheetClient(s) : s.type === 'collab' ? sheetCollab(s) : s.type === 'user' ? sheetUser(s) : s.type === 'replan' ? sheetReplan(s) : s.type === 'import' ? sheetImport(s) : s.type === 'hist-import' ? sheetHistImport(s) : s.type === 'team' ? sheetTeam(s) : '';
    } catch (e) { console.error(e); inner = '<div class="sheet-b"><div class="notice bad">' + esc(errMsg(e)) + '</div></div>'; }
    if (!inner) { S.sheet = null; root.innerHTML = ''; document.body.classList.remove('has-modal'); return; }
    const center = s.type === 'relance' || s.type === 'replan' || s.type === 'import' || s.type === 'hist-import' || s.type === 'tvaRecap' || s.type === 'isRecap' || s.type === 'viewUser' || s.type === 'isCalc' || s.type === 'cfeRecap' || s.type === 'prodDetail' || s.type === 'filDetail' || s.type === 'msDetail' || s.type === 'rebal' || s.type === 'diag' || s.type === 'client' || s.type === 'task'; // V26.85 / V26.96 : fiche dossier centrée et agrandie
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
      + predictBox(p, t, c) + irBox(p) + filingBox(p) + (t.done && t.actual_min ? '<div class="notice ok">Temps réel : <b>' + E.fmtMin(t.actual_min) + '</b> (prévu ' + E.fmtMin(t.duration_min) + ')</div>' : '')
      + '<div class="form"><label class="f"><span>Date planifiée</span><input type="date" data-ch="t-date" data-id="' + t.id + '" value="' + (t.planned_date || '') + '"' + dis + '></label>'
      + '<label class="f"><span>Collaborateur</span><select data-ch="t-collab" data-id="' + t.id + '"' + (canEditTask(t) && !lk && !t.done ? '' : ' disabled') + '><option value="">—</option>' + collabs(true).filter(x => isAdmin() || canSeeCollab(x.id) || x.id === t.collaborator_id).map(x => '<option value="' + x.id + '"' + (x.id === t.collaborator_id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label>'
      + '<label class="f"><span>Durée prévue</span><input type="text" data-ch="t-dur" data-id="' + t.id + '" value="' + E.fmtMin(t.duration_min) + '"' + dis + '></label></div>'

      + histBlock(s, { entity_id: t.id }) + '</div>'
      + '<div class="sheet-f">' + (canSplit(t) ? '<button class="btn" data-act="task-split" data-id="' + t.id + '" title="La partie faite est terminée, le reste passe en tête du jour ouvré suivant (commentaire obligatoire)">' + ic('clock', 'sm') + 'Non terminée en totalité</button>' : '') + (edit ? '<button class="btn" data-act="lock" data-id="' + t.id + '">' + ic('lock', 'sm') + (lk ? 'Déverrouiller' : 'Verrouiller') + '</button><button class="btn ' + (t.done ? '' : 'primary') + '" data-act="done" data-id="' + t.id + '">' + (t.done ? ic('refresh', 'sm') + 'Rouvrir' : ic('check', 'sm') + 'Terminer') + '</button>' : '') + '<button class="btn" data-act="close">Fermer</button></div>';
  }

  function sheetClient(s) {
    const isNew = !s.id, c = isNew ? s.draft : S.data.clients.get(s.id);
    if (!c) return '';
    const ro = S.readonly || !(isManager() || (isRC() && (isNew || binomeIds().has(c.collaborator_id)))) ? ' disabled' : ''; // V26.145 : le RC crée et règle les dossiers de son équipe
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
        + (p ? '<div class="row" style="margin-bottom:10px">' + (p.received_date ? '<button class="btn sm" data-act="rec-undo" data-id="' + p.id + '">Annuler la réception</button>' : (p.expected_date < today() ? '<button class="btn icon sm rl-btn" data-act="relance" data-pid="' + p.id + '" title="Texte de relance à copier" aria-label="Relancer le client">' + ic('mail', 'sm') + '</button><button type="button" class="btn icon sm rl-btn rl-tel" data-act="relance-tel" data-pid="' + p.id + '" title="Client relancé par téléphone : noter la relance" aria-label="Client relancé par téléphone">' + ic('phone', 'sm') + '</button>' : '') + '<button class="btn sm primary" data-act="rec-one" data-id="' + p.id + '">📥 Éléments reçus aujourd\'hui</button>' + (S.v7 ? '<button class="btn sm" data-act="rec-part" data-id="' + p.id + '">◐ Réception partielle</button>' : '')) + '</div>' + irBox(p) + filingBox(p) + '<div class="tasks" style="margin-top:12px">' + (ts.map(t => taskRow(t, { showDate: true, showCollab: true })).join('') || '<div class="empty">Aucune tâche (temps à 0).</div>') + '</div>' : '<div class="empty">Ce dossier n\'est pas encore créé pour ce mois.</div>') + '</div>'
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
      + (edit ? '<div class="row" style="gap:6px;margin-bottom:10px;flex-wrap:wrap"><span class="small muted">Tous les</span>' + DAYS.slice(0, 5).map((w, i) => '<button class="btn sm" data-act="pres-dow" data-w="' + (i + 1) + '" title="Cocher / décocher tous les ' + w + 's de ' + y + '">' + DAYS_S[i] + '</button>').join('') + '<button class="btn sm danger" data-act="pres-clear">Tout effacer ' + y + '</button></div>' : '')
      + '<div class="pc-y">' + grid + '</div></div>';
  }
  function sheetCollab(s) {    const isNew = !s.id, c = isNew ? s.draft : S.data.collaborators.get(s.id);
    if (!c) return '';
    const abs = isNew ? [] : list('absences').filter(a => a.collaborator_id === c.id).sort((a, b) => b.date_from.localeCompare(a.date_from));
    return sheetHead(isNew ? 'Nouveau collaborateur' : esc(c.name))
      + '<div class="sheet-b">' + remoteNotice(s) + '<div class="form"><label class="f"><span>Nom</span><input type="text" data-ch="co-field" data-k="name" value="' + esc(c.name || '') + '"></label>'
      + '<label class="f"><span>Heures disponibles par jour</span><input type="text" data-ch="co-field" data-k="daily_capacity_min" value="' + E.fmtMin(c.daily_capacity_min) + '"></label>'
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
        + '<label class="f"><span>Durée / jour (vide = journée)</span><input type="text" id="abs-min" placeholder="ex. 3h30"></label><label class="f"><span>Précision (ex. séminaire, réunion d\'équipe)</span><input type="text" id="abs-note" placeholder="Formation TVA, réunion interne…"></label></div>'
        + '<div class="row" style="margin-top:8px"><button class="btn" data-act="abs-add" data-id="' + c.id + '">+ Ajouter l\'indisponibilité</button><span class="small muted">Pensez à replanifier le mois ensuite.</span></div></div>' : '')
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
  /* ====================== Import Excel ====================== */
  const COLS = {
    name: ['client', 'dossier', 'nomclient', 'nomdudossier', 'raisonsociale', 'nom', 'societe'],
    collab: ['collaborateur', 'responsable', 'collab', 'collaborateurresponsable'],
    freq: ['frequence', 'periodicite', 'regime'],
    reception: ['datereceptionhabituelle', 'receptionhabituelle', 'datedereceptionhabituelle', 'datereception', 'jourreception', 'reception', 'jourdereception'],
    time: ['tempsdeproduction', 'tempsproduction', 'temps', 'tempstotal', 'duree', 'dureeproduction', 'tempsprevu', 'tempsdossier'],
    tenue: ['tempstenue', 'tenue', 'tempsdetenue'],
    lettrage: ['tempslettrage', 'lettrage', 'tempsdelettrage'],
    tva: ['tempstva', 'tva', 'tempsdetva'],
    due: ['echeancetva', 'echeance', 'datelimitetva', 'dateecheancetva', 'echeancedetva'],
    priority: ['priorite'],
    regime: ['regimetva', 'regime', 'regimedetva', 'typetva', 'typedeclaration', 'declarationtva'],
    deb: ['deb'],
    des: ['des'],
    notes: ['particularites', 'particularite', 'remarques', 'notes', 'commentaires', 'commentaire', 'observations']
  };
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function cellValue(XLSX, cell) {
    if (!cell) return null;
    if (cell.t === 'n' && typeof cell.z === 'string') {
      const z = cell.z.toLowerCase().replace(/\[[^\]]*\]|"[^"]*"/g, '');
      if (/[dy]/.test(z)) { const dc = XLSX.SSF.parse_date_code(cell.v); return { date: true, day: dc.d }; }
      if (/h|:/.test(z)) return { time: true, minutes: Math.round(cell.v * 1440) };
    }
    if (cell.t === 'd' && cell.v instanceof Date) return { date: true, day: cell.v.getDate() };
    if (cell.t === 'b') return cell.v ? 'oui' : '';
    return cell.v;
  }
  async function readImportFile(file) {
    const XLSX = await needXLSX();
    const buf = await file.arrayBuffer();
    const isCsv = /\.csv$/i.test(file.name);
    const wb = isCsv ? XLSX.read(new TextDecoder('utf-8').decode(buf), { type: 'string', raw: true }) : XLSX.read(buf, { type: 'array', cellNF: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws || !ws['!ref']) throw new Error('Feuille vide');
    const rg = XLSX.utils.decode_range(ws['!ref']);
    const grid = [];
    for (let r = rg.s.r; r <= rg.e.r; r++) { const row = []; for (let c = rg.s.c; c <= rg.e.c; c++) row.push(cellValue(XLSX, ws[XLSX.utils.encode_cell({ r, c })])); grid.push(row); }
    // Ligne d'en-tête = première ligne contenant « client » (ou équivalent)
    const hi = grid.findIndex(row => row.some(v => COLS.name.includes(norm(v))));
    if (hi < 0) throw new Error('Colonne « Client » introuvable. Utilisez le modèle Excel.');
    const header = grid[hi].map(norm), map = {};
    for (const k in COLS) { const i = header.findIndex(h => COLS[k].includes(h)); if (i >= 0) map[k] = i; }
    return buildImportRows(grid.slice(hi + 1), map, Object.keys(COLS).filter(k => !(k in map) && !['tenue', 'lettrage', 'tva'].includes(k) && !(k === 'time' && ('tenue' in map || 'lettrage' in map || 'tva' in map))).map(k => ({ name: 'Client', collab: 'Collaborateur', freq: 'Fréquence', reception: 'Date réception habituelle', time: 'Temps de production', due: 'Échéance TVA', priority: 'Priorité', notes: 'Particularités' }[k] || k)));
  }
  function buildImportRows(lines, map, missingCols) {
    const collabByName = new Map(collabs(true).map(c => [norm(c.name), c]));
    const clientByName = new Map(list('clients').map(c => [norm(c.name), c]));
    const rows = [], newCollabs = new Set();
    lines.forEach((line, i) => {
      const g = k => (k in map ? line[map[k]] : null);
      const name = g('name'); if (name === null || String(name).trim() === '') return;
      const errs = [];
      const dur = k => { const v = g(k); if (v && v.date) { errs.push(k + ' : date au lieu d\'une durée'); return 0; } const n = v && v.time ? v.minutes : E.parseDuration(v); if (isNaN(n)) { errs.push('Temps ' + k + ' illisible (« ' + v + ' »)'); return 0; } return n; };
      const day = k => { const v = g(k); const n = v && v.date ? v.day : (v && v.time ? NaN : E.parseDay(v)); if (Number.isNaN(n)) { errs.push((k === 'due' ? 'Échéance TVA' : 'Date de réception') + ' illisible (« ' + (v && v.time ? 'heure' : v) + ' »)'); return null; } return n; };
      const freq = E.parseFrequency(g('freq'));
      if (!freq) errs.push('Fréquence inconnue (« ' + g('freq') + ' »)');
      const prio = E.parsePriority(g('priority'));
      if (Number.isNaN(prio)) errs.push('Priorité inconnue (« ' + g('priority') + ' »)');
      const cn = g('collab') ? String(g('collab')).trim() : '';
      const co = cn ? collabByName.get(norm(cn)) : null;
      if (cn && !co) newCollabs.add(cn);
      const r = {
        line: i + 1, name: String(name).trim(), collabName: cn, collabId: co ? co.id : null,
        frequency: freq || 'mensuel', reception_day: day('reception'), time_min: ('time' in map) ? dur('time') : dur('tenue') + dur('lettrage') + dur('tva'),
        vat_regime: (() => { const v = g('regime'), r = E.parseRegime(v); if (!r) { errs.push('Régime de TVA inconnu (« ' + v + ' »)'); return 'ca3_mensuel'; } return r; })(), deb: E.parseYes(g('deb')), des: E.parseYes(g('des')), vat_due_day: day('due'), priority: Number.isNaN(prio) ? 2 : prio, notes: g('notes') ? String(g('notes')).trim() : null, errors: errs
      };
      r.existing = clientByName.get(norm(r.name)) || null;
      // V26.181 : une même société deux fois dans le fichier créerait deux dossiers (et deux productions par mois) — la 2e ligne est ignorée
      const twin = rows.find(x => norm(x.name) === norm(r.name)); if (twin) errs.push('dossier déjà présent ligne ' + twin.line + ' du fichier');
      if (!isManager() && isRC()) { // V26.145 : le RC importe pour lui et son équipe (colonne Collaborateur limitée à son équipe)
        const me = collabOf(S.me && S.me.collaborator_id);
        if (co && !binomeIds().has(co.id)) errs.push('« ' + co.name + ' » ne fait pas partie de votre équipe');
        else if (!co) { if (cn) errs.push('collaborateur « ' + cn + ' » inconnu : demandez à votre manager de le créer'); else if (me) { r.collabName = me.name; r.collabId = me.id; } }
        if (r.existing && r.existing.collaborator_id && !binomeIds().has(r.existing.collaborator_id)) errs.push('dossier suivi hors de votre équipe');
      } else      if (!isManager()) { // V26.32 : un collaborateur importe ses propres dossiers
        const me = collabOf(S.me && S.me.collaborator_id);
        if (!me) errs.push('compte non lié à un collaborateur : demandez à l\'administrateur');
        else { r.collabName = me.name; r.collabId = me.id; }
        if (r.existing && r.existing.collaborator_id && !binomeIds().has(r.existing.collaborator_id)) errs.push('dossier suivi par un autre collaborateur');
      }
      rows.push(r);
    });
    return { rows, newCollabs: isManager() ? [...newCollabs] : [], missingCols, createCollabs: isManager() };
  }
  function sheetImport(s) {
    const imp = s.imp;
    let body = (isManager() ? '' : isRC() ? '<div class="notice info">Vous importez les dossiers de <b>votre équipe</b> : la colonne Collaborateur doit désigner vous-même ou un membre de votre équipe (vide = vous).</div>' : '<div class="notice info">Vous importez <b>vos</b> dossiers : ils vous sont attribués automatiquement (la colonne Collaborateur est ignorée). Un dossier déjà suivi par un autre collaborateur est refusé. Les dossiers du mois sont créés et planifiés dès l\'import.</div>') + '<p>Colonnes attendues : <b>Client, Collaborateur, Fréquence, Date réception habituelle, Temps de production, Échéance TVA, Priorité, Particularités</b>. Le temps de production est un temps unique par dossier (tenue + lettrage + TVA). Formats acceptés : <code>1h30</code>, <code>1:30</code>, <code>45 min</code>, <code>1,5</code> (heures), cellule au format heure Excel ; nombre seul : ≤ 12 = heures, &gt; 12 = minutes. Un ancien fichier avec les colonnes Tenue / Lettrage / TVA reste accepté : les trois temps sont additionnés.</p>'
      + '<div class="row"><input type="file" accept=".xlsx,.xls,.csv" data-ch="import-file" style="max-width:360px"><button class="btn sm" data-act="template">⬇ Modèle Excel</button></div>';
    if (s.loading) body += '<div class="empty">Lecture du fichier…</div>';
    if (s.error) body += '<div class="notice bad">' + esc(s.error) + '</div>';
    if (imp) {
      const bad = imp.rows.filter(r => r.errors.length).length, upd = imp.rows.filter(r => r.existing).length;
      body += '<div class="notice ' + (bad ? 'warn' : 'ok') + '">Aperçu : <b>' + imp.rows.length + '</b> ligne(s) — ' + (imp.rows.length - upd) + ' nouveau(x) dossier(s), ' + upd + ' mise(s) à jour' + (bad ? ', <b>' + bad + ' ligne(s) avec erreurs (ignorées)</b>' : '') + '.</div>'
        + (imp.missingCols.length ? '<div class="notice">Colonnes absentes (valeurs par défaut) : ' + imp.missingCols.join(', ') + '</div>' : '')
        + '<label class="cb"><input type="checkbox" data-ch="imp-cfe"' + (s.cfeAll !== false ? ' checked' : '') + '> Cocher « Suivi CFE » pour tous les dossiers importés <span class="small muted">(décochable ensuite dans chaque fiche dossier)</span></label>' // V26.165
        + (imp.newCollabs.length ? '<label class="cb"><input type="checkbox" data-ch="imp-cc"' + (imp.createCollabs ? ' checked' : '') + '> Créer les collaborateurs manquants : <b>' + imp.newCollabs.map(esc).join(', ') + '</b> (7h/jour, lundi → vendredi)</label>' : '')
        + '<div class="scroll-x"><table class="t"><thead><tr><th></th><th>Client</th><th>Collaborateur</th><th>Fréq.</th><th>Récep.</th><th class="num">Temps</th><th>Régime</th><th>Éch. TVA</th><th>Priorité</th><th>Particularités</th></tr></thead><tbody>'
        + imp.rows.map(r => '<tr style="' + (r.errors.length ? 'background:var(--red-soft)' : '') + '"><td class="nowrap">' + (r.errors.length ? '✖ <span class="small">' + esc(r.errors.join(' ; ')) + '</span>' : r.existing ? '<span class="badge b">MAJ</span>' : '<span class="badge g">Nouveau</span>') + '</td><td><b>' + esc(r.name) + '</b></td><td>' + esc(r.collabName || '—') + (r.collabName && !r.collabId ? ' <span class="badge o">nouveau</span>' : '') + '</td><td>' + E.FREQ_LABEL[r.frequency] + '</td><td>' + (r.reception_day || '—') + '</td><td class="num"><b>' + E.fmtMin(r.time_min) + '</b></td><td class="nowrap">' + E.VAT_REGIMES[r.vat_regime] + (r.deb ? ' · DEB' : '') + (r.des ? ' · DES' : '') + '</td><td>' + (r.vat_due_day || '—') + '</td><td>' + E.PRIORITY_LABEL[r.priority] + '</td><td class="small">' + esc(r.notes || '') + '</td></tr>').join('') + '</tbody></table></div>';
    }
    const n = imp ? imp.rows.filter(r => !r.errors.length).length : 0;
    return sheetHead('📥 Importer les dossiers (Excel)') + '<div class="sheet-b">' + body + '</div><div class="sheet-f"><button class="btn" data-act="close">Annuler</button><button class="btn primary" data-act="import-go"' + (n && !s.busy ? '' : ' disabled') + '>' + (s.busy ? 'Import en cours…' : 'Importer ' + n + ' dossier(s)') + '</button></div>';
  }
  async function doImport() {
    const s = S.sheet, imp = s.imp; if (!imp) return;
    s.busy = true; renderSheet();
    try {
      const nameMap = new Map(collabs(true).map(c => [norm(c.name), c.id]));
      if (isManager() && imp.createCollabs && imp.newCollabs.length) {
        const n0 = collabs(true).length;
        const created = await saveInsert('collaborators', imp.newCollabs.map((n, i) => ({ id: P.uuid(), name: n, daily_capacity_min: 420, work_days: [1, 2, 3, 4, 5], color: COLORS[(n0 + i) % COLORS.length], active: true })));
        created.forEach(c => nameMap.set(norm(c.name), c.id));
      }
      const ok = imp.rows.filter(r => !r.errors.length);
      // V26.165 : « Suivi CFE » coché pour tous les dossiers importés (option de la fenêtre, cochée par défaut ; base sans colonne CFE : ignoré)
      const cs = list('clients'), cfeCol = !cs.length || cs.some(c => 'cfe' in c), cfeAll = s.cfeAll !== false && cfeCol;
      const fields = r => Object.assign(cfeAll ? { cfe: true } : {}, { name: r.name, collaborator_id: r.collabName ? (nameMap.get(norm(r.collabName)) || null) : null, frequency: r.frequency, reception_day: r.reception_day, time_min: r.time_min, time_tenue: 0, time_lettrage: 0, time_tva: 0, vat_due_day: r.vat_due_day, priority: r.priority, notes: r.notes, vat_regime: r.vat_regime, deb: r.deb, des: r.des });
      const news = ok.filter(r => !r.existing).map(r => Object.assign({ id: P.uuid(), active: true }, fields(r)));
      if (news.length) await saveInsert('clients', news);
      const upd = ok.filter(r => r.existing);
      if (upd.length) await saveMany('clients', upd.map(r => { const f = fields(r); if (!r.collabName) delete f.collaborator_id; return { id: r.existing.id, patch: f }; }));
      hist('import', { detail: { text: news.length + ' dossier(s) créé(s), ' + upd.length + ' mis à jour' + (isManager() ? '' : ' (import collaborateur)') + (cfeAll ? ' · suivi CFE coché' : '') } });
      closeSheet();
      if (!isManager()) { await generateMonth(defaultMonth(), { auto: true }); toast('Import terminé : ' + news.length + ' dossier(s) créé(s), ' + upd.length + ' mis à jour. Cochez « Nouveau dossier » dans la fiche des dossiers réellement nouveaux pour leur appliquer la marge de ' + newMarginPct() + ' %.', 'ok', null, 10000); return; }
      toast('Import terminé : ' + news.length + ' dossier(s) créé(s), ' + upd.length + ' mis à jour.', 'ok', missingForMonth(S.month) ? { label: 'Créer les dossiers ' + deMonth(S.month), fn: () => generateMonth(S.month) } : null, 12000);
    } catch (e) { s.busy = false; s.error = 'Import interrompu : ' + errMsg(e); renderSheet(); }
  }
  async function downloadTemplate() {
    const XLSX = await needXLSX();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Client', 'Collaborateur', 'Fréquence', 'Date réception habituelle', 'Temps de production', 'Échéance TVA', 'Régime TVA', 'DEB', 'DES', 'Priorité', 'Particularités'],
      ['EXEMPLE SARL', 'Pierre', 'Mensuelle', 7, '3h', 19, 'CA3 mensuelle', 'non', 'non', 'Normale', 'Relevés bancaires par e-mail'],
      ['MODELE SAS', 'Marie', 'Trimestrielle', 10, '5h15', 24, 'CA3 trimestrielle', 'oui', 'non', 'Haute', '']
    ]);
    ws['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 13 }, { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 6 }, { wch: 6 }, { wch: 10 }, { wch: 30 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Dossiers');
    XLSX.writeFile(wb, 'modele_import_dossiers.xlsx');
  }

  /* ====================== Import de l'historique (apprentissage de l'agent) ======================
   * Une ligne par dossier et par mois passé : dates de réception prévue / réelle, temps prévu / réel. */
  const HCOLS = {
    name: COLS.name,
    month: ['mois', 'periode', 'moisdeproduction', 'moisconcerne', 'moisdelaproduction'],
    nominal: ['receptionprevue', 'datedereceptionprevue', 'datereceptionprevue', 'dateprevue', 'receptionhabituelle', 'datereceptionhabituelle', 'datedereceptionhabituelle', 'prevue', 'receptionprevuejouroudate'],
    received: ['receptionreelle', 'datedereceptionreelle', 'datereceptionreelle', 'datereelle', 'datedereception', 'recu', 'recule', 'reception'],
    planned: ['tempsprevu', 'tempsdeproductionprevu', 'tempsbudgete', 'budget', 'tempsdeproduction'],
    actual: ['tempsreel', 'tempspasse', 'tempsreellementpasse', 'reel'],
    collab: COLS.collab
  };
  const MONTH_WORDS = ['janv', 'fevr', 'mars', 'avr', 'mai', 'juin', 'juil', 'aout', 'sept', 'oct', 'nov', 'dec'];
  function histCell(XLSX, cell) {
    if (!cell) return null;
    if (cell.t === 'd' && cell.v instanceof Date) return { date: E.ymd(cell.v) };
    if (cell.t === 'n' && typeof cell.z === 'string') {
      const z = cell.z.toLowerCase().replace(/\[[^\]]*\]|"[^"]*"/g, '');
      if (/[dy]/.test(z)) { const dc = XLSX.SSF.parse_date_code(cell.v); return { date: dc.y + '-' + E.pad(dc.m) + '-' + E.pad(dc.d) }; }
      if (/h|:/.test(z)) return { minutes: Math.round(cell.v * 1440) };
    }
    return cell.v;
  }
  function parseHistDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v.date) return v.date;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + '-' + E.pad(m[2]) + '-' + E.pad(m[3]);
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/); if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + E.pad(m[2]) + '-' + E.pad(m[1]);
    return undefined; // illisible
  }
  function parseHistMonth(v, received) {
    if (v === null || v === undefined || v === '') return received ? received.slice(0, 7) : null;
    if (v.date) return v.date.slice(0, 7);
    const s = String(v).trim(), n = norm(s);
    let m = s.match(/^(\d{4})[-\/.](\d{1,2})$/); if (m) return m[1] + '-' + E.pad(m[2]);
    m = s.match(/^(\d{1,2})[-\/.](\d{4})$/); if (m) return m[2] + '-' + E.pad(m[1]);
    const d = parseHistDate(v); if (d) return d.slice(0, 7);
    const i = MONTH_WORDS.findIndex(w => n.startsWith(w)), y = s.match(/(\d{4}|\d{2})\s*$/);
    if (i >= 0 && y) return (y[1].length === 2 ? '20' + y[1] : y[1]) + '-' + E.pad(i + 1);
    return undefined;
  }
  async function readHistoryFile(file) {
    const XLSX = await needXLSX(), buf = await file.arrayBuffer(), isCsv = /\.csv$/i.test(file.name);
    const wb = isCsv ? XLSX.read(new TextDecoder('utf-8').decode(buf), { type: 'string', raw: true }) : XLSX.read(buf, { type: 'array', cellNF: true, cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws || !ws['!ref']) throw new Error('Feuille vide');
    const rg = XLSX.utils.decode_range(ws['!ref']), grid = [];
    for (let r = rg.s.r; r <= rg.e.r; r++) { const row = []; for (let c = rg.s.c; c <= rg.e.c; c++) row.push(histCell(XLSX, ws[XLSX.utils.encode_cell({ r, c })])); grid.push(row); }
    const hi = grid.findIndex(row => row.some(v => HCOLS.name.includes(norm(v))));
    if (hi < 0) throw new Error('Colonne « Client » introuvable. Utilisez le modèle de l\'historique.');
    const header = grid[hi].map(norm), map = {};
    for (const k in HCOLS) { const i = header.findIndex(h => HCOLS[k].includes(h)); if (i >= 0) map[k] = i; }
    const clientByName = new Map(list('clients').map(c => [norm(c.name), c])), collabByName = new Map(collabs(true).map(c => [norm(c.name), c]));
    const st = cfg(), byKey = new Map();
    grid.slice(hi + 1).forEach((line, i) => {
      const g = k => (k in map ? line[map[k]] : null);
      const name = g('name'); if (name === null || String(name).trim() === '') return;
      const errs = [], client = clientByName.get(norm(name)) || null;
      if (!client) errs.push('dossier inconnu dans JB Flow');
      const received = parseHistDate(g('received'));
      if (received === undefined) errs.push('date de réception réelle illisible');
      const month = parseHistMonth(g('month'), received || null);
      if (!month) errs.push(month === undefined ? 'mois illisible' : 'mois manquant');
      let nominal = null; const nv = g('nominal');
      if (nv !== null && nv !== '' && month) {
        const n = Number(nv);
        if (!nv.date && Number.isInteger(n) && n >= 1 && n <= 31) nominal = E.dateInMonth(month, n);
        else { nominal = parseHistDate(nv); if (nominal === undefined) { errs.push('réception prévue illisible'); nominal = null; } }
      } else if (client && month) nominal = E.dateInMonth(month, client.reception_day || st.start_day);
      const dur = k => { const v = g(k); if (v === null || v === '') return null; if (v.date) { errs.push('date au lieu d\'une durée'); return null; } const n = v.minutes !== undefined ? v.minutes : E.parseDuration(v); if (isNaN(n)) { errs.push('temps illisible (« ' + v + ' »)'); return null; } return n || null; };
      const planned = dur('planned'), actual = dur('actual');
      if (!received && !actual && !errs.length) errs.push('ni date de réception réelle ni temps réel');
      const cn = g('collab') ? String(g('collab')).trim() : '', co = cn ? collabByName.get(norm(cn)) : null;
      const r = { line: hi + i + 2, name: String(name).trim(), client, month, nominal, received: received || null, planned: planned || (client ? E.clientTime(client) || null : null), actual, collabId: co ? co.id : null, collabName: cn, errors: errs };
      byKey.set(client && month ? client.id + '|' + month : 'x' + i, r); // une ligne par dossier et par mois : la dernière l'emporte
    });
    const rows = [...byKey.values()];
    return { rows, missingCols: ['month', 'received', 'actual'].filter(k => !(k in map)).map(k => ({ month: 'Mois', received: 'Réception réelle', actual: 'Temps réel' }[k])) };
  }
  function sheetHistImport(s) {
    const imp = s.imp;
    let body = '<p>Une ligne par <b>dossier</b> et par <b>mois passé</b> (12 derniers mois conseillés). Colonnes : <b>Client, Mois, Réception prévue, Réception réelle, Temps prévu, Temps réel, Collaborateur</b>. Le <b>modèle pré-rempli</b> contient déjà vos dossiers et les 12 derniers mois : il suffit de compléter les dates réelles et les temps réels.</p>'
      + '<div class="row"><input type="file" accept=".xlsx,.xls,.csv" data-ch="hist-file" style="max-width:360px"><button class="btn sm" data-act="hist-template">⬇ Modèle pré-rempli</button></div>';
    if (s.loading) body += '<div class="empty">Lecture du fichier…</div>';
    if (s.error) body += '<div class="notice bad">' + esc(s.error) + '</div>';
    if (imp) {
      const bad = imp.rows.filter(r => r.errors.length).length, good = imp.rows.length - bad;
      const upd = imp.rows.filter(r => !r.errors.length && list('learning_history').some(h => h.client_id === r.client.id && h.month === r.month)).length;
      body += '<div class="notice ' + (bad ? 'warn' : 'ok') + '">Aperçu : <b>' + good + '</b> ligne(s) exploitable(s)' + (upd ? ' (dont ' + upd + ' mise(s) à jour)' : '') + (bad ? ', <b>' + bad + ' ignorée(s)</b>' : '') + '.</div>'
        + (imp.missingCols.length ? '<div class="notice">Colonnes absentes : ' + imp.missingCols.join(', ') + '</div>' : '')
        + '<div class="scroll-x"><table class="t"><thead><tr><th></th><th>Client</th><th>Mois</th><th>Prévue</th><th>Réelle</th><th class="num">Écart</th><th class="num">Temps prévu</th><th class="num">Temps réel</th></tr></thead><tbody>'
        + imp.rows.slice(0, 300).map(r => '<tr style="' + (r.errors.length ? 'background:var(--red-soft)' : '') + '"><td class="nowrap">' + (r.errors.length ? '✖ <span class="small">' + esc(r.errors.join(' ; ')) + '</span>' : '<span class="badge g">OK</span>') + '</td><td><b>' + esc(r.name) + '</b></td><td class="nowrap">' + (r.month ? esc(fMonth(r.month)) : '—') + '</td><td>' + fDMY(r.nominal) + '</td><td>' + fDMY(r.received) + '</td><td class="num">' + (r.nominal && r.received ? (E.daysBetween(r.nominal, r.received) > 0 ? '+' : '') + E.daysBetween(r.nominal, r.received) + ' j' : '—') + '</td><td class="num">' + (r.planned ? E.fmtMin(r.planned) : '—') + '</td><td class="num">' + (r.actual ? E.fmtMin(r.actual) : '—') + '</td></tr>').join('') + '</tbody></table></div>'
        + (imp.rows.length > 300 ? '<p class="small muted">… et ' + (imp.rows.length - 300) + ' autre(s) ligne(s).</p>' : '');
    }
    const n = imp ? imp.rows.filter(r => !r.errors.length).length : 0;
    return sheetHead('📥 Importer l\'historique (apprentissage de l\'agent)') + '<div class="sheet-b">' + body + '</div><div class="sheet-f"><button class="btn" data-act="close">Annuler</button><button class="btn primary" data-act="hist-import-go"' + (n && !s.busy ? '' : ' disabled') + '>' + (s.busy ? 'Import en cours…' : 'Importer ' + n + ' ligne(s)') + '</button></div>';
  }
  async function doHistImport() {
    const s = S.sheet, imp = s && s.imp; if (!imp) return;
    s.busy = true; renderSheet();
    try {
      const byKey = new Map(list('learning_history').map(h => [h.client_id + '|' + h.month, h]));
      const fields = r => ({ client_id: r.client.id, month: r.month, nominal_date: r.nominal, received_date: r.received, planned_min: r.planned, actual_min: r.actual, collaborator_id: r.collabId || r.client.collaborator_id || null, source: 'import' });
      const news = [], upd = [];
      imp.rows.filter(r => !r.errors.length).forEach(r => { const ex = byKey.get(r.client.id + '|' + r.month); if (ex) upd.push({ id: ex.id, patch: fields(r) }); else news.push(Object.assign({ id: P.uuid() }, fields(r))); });
      if (news.length) await saveInsert('learning_history', news);
      if (upd.length) await saveMany('learning_history', upd);
      hist('import_historique', { detail: { text: news.length + ' ligne(s) ajoutée(s), ' + upd.length + ' mise(s) à jour' } });
      closeSheet();
      S.agent = null;
      const n = await runAgent({ silent: true });
      const md = agentModel(), learned = [...md.clients.values()].filter(r => r.n > 0).length;
      toast('Historique importé : ' + (news.length + upd.length) + ' ligne(s). L\'agent connaît maintenant les habitudes de ' + learned + ' dossier(s)' + (n ? ' et a ajusté ' + n + ' date(s) de réception.' : '.'), 'ok', { label: 'Voir l\'agent', fn: () => { go('dashboard'); setTimeout(() => { const el = $('#agent'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 250); } }, 12000);
    } catch (e) { s.busy = false; s.error = 'Import interrompu : ' + errMsg(e); renderSheet(); }
  }
  async function downloadHistTemplate() {
    const XLSX = await needXLSX(), st = cfg(), cur = today().slice(0, 7), rows = [['Client', 'Mois', 'Réception prévue (jour ou date)', 'Réception réelle', 'Temps prévu', 'Temps réel', 'Collaborateur']];
    const cs = list('clients').filter(c => c.active !== false).sort(byName);
    if (!cs.length) rows.push(['EXEMPLE SARL', '2026-03', 5, '09/03/2026', '3h', '3h30', 'Pierre']);
    for (const c of cs) for (let k = 12; k >= 1; k--) {
      const m = E.addMonths(cur, -k); if (!E.clientApplies(c, m, st)) continue;
      const h = list('learning_history').find(x => x.client_id === c.id && x.month === m);
      rows.push([c.name, m, c.reception_day || st.start_day, h && h.received_date ? fDMY(h.received_date) : '', E.fmtMin(E.clientTime(c)), h && h.actual_min ? E.fmtMin(h.actual_min) : '', (collabOf(c.collaborator_id) || {}).name || '']);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 26 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 16 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Historique');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Mode d\'emploi'], ['Une ligne par dossier et par mois passé. Complétez « Réception réelle » (date d\'arrivée des éléments) et « Temps réel » (temps passé).'], ['Mois : 2026-03, 03/2026 ou mars 2026. Réception prévue : jour habituel (ex. 5) ou date complète.'], ['Temps : 1h30, 1:30, 90 min. Les lignes sans date réelle ni temps réel sont ignorées.'], ['Un nouvel import du même dossier et du même mois remplace la ligne précédente.']]), 'Mode d\'emploi');
    XLSX.writeFile(wb, 'historique_jbflow.xlsx');
  }

  /* ====================== Exports ====================== */
  function taskExportRows(m) {
    return list('tasks').filter(t => t.month === m).sort((a, b) => (a.planned_date || '9').localeCompare(b.planned_date || '9') || (a.seq - b.seq)).map(t => {
      const p = S.data.productions.get(t.production_id) || {};
      return { 'Date planifiée': t.planned_date ? fDMY(t.planned_date) : 'Non planifiée', Collaborateur: (collabOf(t.collaborator_id) || {}).name || '', Client: (clientOf(t.client_id) || {}).name || '', Mission: E.KIND_LABEL[t.kind], 'Durée (min)': t.duration_min, 'Durée': E.fmtMin(t.duration_min), 'Échéance TVA': fDMY(t.due_date), 'Réception prévue': fDMY(p.expected_date), 'Réception réelle': fDMY(p.received_date), "Demande d'informations": IR_LABEL[p.info_request] || '', Verrouillée: t.locked ? 'oui' : '', Terminée: t.done ? 'oui' : '', 'Temps réel (min)': t.actual_min || '', 'Dépôts': Object.keys(p.filing || {}).map(k => E.OBLIG_LABEL[k] + ' : ' + E.FILING_VIA[p.filing[k].via]).join(' ; ') };
    });
  }
  function toCsv(rows) {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]), q = v => { v = v === null || v === undefined ? '' : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return '﻿' + [cols.join(';')].concat(rows.map(r => cols.map(c => q(r[c])).join(';'))).join('\r\n');
  }
  async function exportXlsx(m) {
    const XLSX = await needXLSX(), wb = XLSX.utils.book_new(), x = ctx(), w = E.windowOf(m, x.settings);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(taskExportRows(m)), 'Planning');
    const dates = E.rangeDates(w.start, w.end);
    const load = collabs().map(c => { const r = { Collaborateur: c.name }; dates.forEach(d => { const l = E.loadOf(list('tasks'), c.id, d); r[fDMY(d).slice(0, 5)] = E.fmtMin(l.total) + ' / ' + E.fmtMin(E.capacityOn(c, d, x)); }); return r; });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(load), 'Niveau d\'activité par jour');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list('clients').sort(byName).map(c => ({ Client: c.name, Collaborateur: (collabOf(c.collaborator_id) || {}).name || '', Fréquence: E.FREQ_LABEL[c.frequency], 'Date réception habituelle': c.reception_day, 'Temps de production': E.fmtMin(E.clientTime(c)), 'Échéance TVA': c.vat_due_day, Priorité: E.PRIORITY_LABEL[c.priority], Particularités: c.notes || '' }))), 'Dossiers');
    XLSX.writeFile(wb, 'planning_' + m + '.xlsx');
  }
  async function fullDump() {
    const res = await S.store.loadAll(null);
    res.history = await S.store.loadAllHistory();
    return { app: 'planification-tva', format: 1, exported_at: new Date().toISOString(), exported_by: S.me.email, tables: res };
  }

  /* ====================== V26.48 : ergonomie (tous les thèmes) ======================
   * Anneau d'avancement du mois, mini-courbes des indicateurs, palette de commandes (Ctrl+K), raccourcis clavier. */

  /* ---------- Anneau d'avancement : heures terminées / heures prévues sur la période ---------- */
  const MRING_MS = 1200; // durée du remplissage animé de l'anneau
  function monthRing(cid) {
    const m = defaultMonth(), x = ctx(), w = E.windowOf(m, x.settings), td = today();
    const ids = cid ? new Set([cid]) : new Set(scopedData().collaborators.map(c => c.id));
    const ts = list('tasks').filter(t => t.month === m && t.kind !== 'info' && ids.has(t.collaborator_id));
    const tot = ts.reduce((s, t) => s + (Number(t.duration_min) || 0), 0); if (!tot) return '';
    const done = ts.filter(t => t.done).reduce((s, t) => s + (Number(t.duration_min) || 0), 0), pct = Math.round(done / tot * 100);
    const days = E.rangeDates(w.start, w.end).filter(d => E.isWorkday(d)), past = days.filter(d => d < td).length, expected = days.length ? Math.round(past / days.length * 100) : 0;
    // V26.99 : « en retard sur le rythme » réservé au manager (le collaborateur, le RC et l'apprenti ne le voient pas)
    const late = isManager() && td >= w.start && td <= w.end && pct < expected - 15, C = 2 * Math.PI * 31, off = C * (1 - Math.min(100, pct) / 100);
    const tip = (cid ? 'Ton avancement' : 'Avancement de l\'équipe') + ' ' + deMonth(m) + '\n' + E.fmtMin(done) + ' terminées sur ' + E.fmtMin(tot) + ' prévues.\nCalendrier : ' + expected + ' % de la période écoulée' + (late ? ' — en retard sur le rythme.' : '.');
    // V26.174 : à chaque arrivée sur l'écran, l'arc se remplit de 0 au % (1,2 s) et le chiffre compte avec lui ;
    // un nouvel affichage pendant l'animation la poursuit au même point au lieu de la couper
    const key = 'mring-' + (cid || 'all') + m, now = performance.now(), A = S.ringAnim || (S.ringAnim = {});
    if (S.enter) A[key] = now;
    const el = A[key] && !reducedMotion() ? now - A[key] : 1e9, anim = el < MRING_MS;
    return '<div class="mring' + (late ? ' late' : '') + '" title="' + esc(tip) + '"><svg viewBox="0 0 74 74" width="74" height="74"><defs><linearGradient id="mrg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="mr-a"/><stop offset="1" class="mr-b"/></linearGradient></defs><circle cx="37" cy="37" r="31" class="mr-t"/><circle cx="37" cy="37" r="31" class="mr-v' + (anim ? ' anim' : '') + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"' + (anim ? ' style="--c:' + C.toFixed(1) + ';--off:' + off.toFixed(1) + ';animation-delay:-' + Math.round(el) + 'ms"' : '') + '/></svg>'
      + '<b' + (anim ? ' data-count="' + pct + '" data-fmt="pct" data-key="' + key + '" data-t0="' + A[key].toFixed(0) + '" data-dur="' + MRING_MS + '"' : '') + '>' + (anim ? '0 %' : pct + ' %') + '</b><small>' + (late ? 'en retard sur le rythme' : 'du mois réalisé') + '</small></div>';
  }

  /* ---------- Mini-courbes des cartes Production (cumul jour par jour sur la période) ---------- */
  function sparkSvg(vals, cls) {
    if (!vals || vals.length < 2) return '';
    const max = Math.max(1, ...vals), n = vals.length - 1;
    const pts = vals.map((v, i) => (i / n * 100).toFixed(1) + ' ' + (26 - v / max * 22).toFixed(1));
    return '<svg class="spark ' + (cls || '') + '" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d="M' + pts.join(' L') + '"/></svg>';
  }
  function dashSparks(m) {
    const d = scopedData(), w = E.windowOf(m, cfg()), td = today();
    const days = E.rangeDates(w.start, td < w.end ? td : w.end).filter(x => E.isWorkday(x)); if (days.length < 2) return {};
    const prods = d.productions.filter(p => p.month === m), tasks = d.tasks.filter(t => t.month === m && t.kind === 'production');
    return {
      'dp-rec': sparkSvg(days.map(x => prods.filter(p => p.received_date && p.received_date <= x).length), 'sp-b'),
      'dp-don': sparkSvg(days.map(x => tasks.filter(t => t.done && t.done_at && t.done_at.slice(0, 10) <= x).length), 'sp-g'),
      'dp-pla': sparkSvg(days.map(x => tasks.filter(t => t.planned_date && t.planned_date <= x).length), 'sp-a'),
      'dp-lat': sparkSvg(days.map(x => prods.filter(p => !p.received_date && p.expected_date && p.expected_date < x).length), 'sp-r')
    };
  }

  /* ---------- Palette de commandes (Ctrl+K) ---------- */
  function paletteItems() {
    const out = [], pages = navSections().flatMap(s => s[1]).filter(n => navAllowed(n[0]) && n[0] !== 'search' && n[0] !== 'more');
    pages.forEach(n => out.push({ g: 'Pages', label: n[2], icon: n[1], hint: SHORTCUTS_REV[n[0]] || '', run: () => go(n[0]) }));
    out.push({ g: 'Pages', label: 'Recherche avancée (tâches, filtres, export CSV)', icon: 'search', run: () => { go('search'); setTimeout(() => { const i = $('[data-in=search]'); if (i) i.focus(); }, 60); } });
    if (isManager() && !S.readonly) out.push({ g: 'Actions', label: 'Nouveau dossier', icon: 'plus', hint: 'N', run: () => ACT['client-new'] && ACT['client-new']() });
    if (!S.readonly) out.push({ g: 'Actions', label: 'Déclarer une réception', icon: 'inbox', hint: 'R', run: () => go('receptions') });
    if (!isManager() && typeof helpAllowed === 'function' && helpAllowed() && !S.readonly) out.push({ g: 'Actions', label: 'Proposer mon aide', icon: 'users', run: () => offerHelp() });
    if (isManager()) out.push({ g: 'Actions', label: 'Copier la synthèse de la semaine', icon: 'list', run: () => ACT['synth-copy']() });
    out.push({ g: 'Actions', label: 'Changer de thème (' + THEMES.map(t => t[1]).join(' / ') + ')', icon: THEME_ICON[S.theme] || 'sun', run: () => setTheme(nextTheme()) });
    out.push({ g: 'Actions', label: 'Raccourcis clavier', icon: 'list', hint: '?', run: () => showShortcuts() });
    list('clients').filter(c => c.active !== false && (isAdmin() || canSeeCollab(c.collaborator_id))).sort(byName).forEach(c => out.push({ g: 'Dossiers', label: c.name, icon: 'folder', sub: (collabOf(c.collaborator_id) || {}).name || '', run: () => ACT.client({ dataset: { id: c.id } }) }));
    collabs().filter(c => canSeeCollab(c.id)).forEach(c => out.push({ g: 'Collaborateurs', label: c.name, icon: 'users', sub: 'planning', run: () => ACT['collab-plan']({ dataset: { id: c.id } }) }));
    return out;
  }
  function openPalette() {
    if (!S.ready || $('#cmdk')) return;
    const all = paletteItems(), root = document.createElement('div');
    root.id = 'cmdk'; root.className = 'cmdk-ov';
    root.innerHTML = '<div class="cmdk" role="dialog" aria-modal="true" aria-label="Palette de commandes"><div class="cmdk-in">' + ic('search', 'sm') + '<input type="text" placeholder="Rechercher un dossier, une page, une action…" aria-label="Rechercher" autocomplete="off"><kbd>Échap</kbd></div><div class="cmdk-l" role="listbox"></div><div class="cmdk-f"><span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span><span><kbd>Entrée</kbd> ouvrir</span><span><kbd>?</kbd> raccourcis</span></div></div>';
    document.body.appendChild(root);
    const inp = root.querySelector('input'), box = root.querySelector('.cmdk-l'); let sel = 0, shown = [];
    const norm2 = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const draw = () => {
      const q = norm2(inp.value.trim());
      shown = (q ? all.filter(it => norm2(it.label + ' ' + (it.sub || '')).includes(q)) : all.filter(it => it.g !== 'Dossiers' && it.g !== 'Collaborateurs')).slice(0, 40);
      if (sel >= shown.length) sel = Math.max(0, shown.length - 1);
      let g = '';
      box.innerHTML = shown.length ? shown.map((it, i) => (it.g !== g ? '<div class="cmdk-g">' + (g = it.g) + '</div>' : '') + '<div class="cmdk-i' + (i === sel ? ' on' : '') + '" role="option" data-i="' + i + '">' + ic(it.icon || 'chevR', 'sm') + '<span>' + esc(it.label) + (it.sub ? ' <em>' + esc(it.sub) + '</em>' : '') + '</span>' + (it.hint ? '<kbd>' + esc(it.hint) + '</kbd>' : '') + '</div>').join('') : '<div class="cmdk-e">Aucun résultat pour « ' + esc(inp.value) + ' ».</div>';
      const on = box.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    };
    const close = () => { fxClose(root); document.removeEventListener('keydown', key, true); };
    const run = i => { const it = shown[i]; if (!it) return; close(); it.run(); };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    };
    inp.addEventListener('input', () => { sel = 0; draw(); });
    box.addEventListener('mousemove', e => { const r = e.target.closest('.cmdk-i'); if (r && Number(r.dataset.i) !== sel) { sel = Number(r.dataset.i); box.querySelectorAll('.cmdk-i').forEach(x => x.classList.toggle('on', Number(x.dataset.i) === sel)); } });
    box.addEventListener('click', e => { const r = e.target.closest('.cmdk-i'); if (r) run(Number(r.dataset.i)); });
    root.addEventListener('mousedown', e => { if (e.target === root) close(); });
    document.addEventListener('keydown', key, true);
    draw(); setTimeout(() => inp.focus(), 0);
  }

  /* ---------- Raccourcis clavier (hors saisie) ---------- */
  const SHORTCUTS = [['a', 'today', 'Aujourd\'hui'], ['p', 'planning', 'Planning'], ['r', 'receptions', 'Réceptions'], ['t', 'tva', 'TVA & autres impôts'], ['d', 'dashboard', 'Pilotage (manager)'], ['i', 'kpi', 'Indicateurs (manager)'], ['h', 'history', 'Historique']];
  const SHORTCUTS_REV = Object.fromEntries(SHORTCUTS.map(s => [s[1], s[0].toUpperCase()]));
  function showShortcuts() {
    const row = (k, l) => '<tr><td><kbd class="kbd">' + k + '</kbd></td><td>' + l + '</td></tr>';
    confirmBox('Raccourcis clavier', '<table class="t kbd-t"><tbody>' + row('Ctrl + K', 'Palette de commandes : dossier, page, action') + SHORTCUTS.filter(s => navAllowed(s[1])).map(s => row(s[0].toUpperCase(), s[2])).join('') + (isManager() ? row('N', 'Nouveau dossier') : '') + row('?', 'Afficher cette aide') + row('Échap', 'Fermer une fenêtre') + '</tbody></table>', 'OK');
  }
  function onShortcut(e) {
    if (!S.ready || e.ctrlKey || e.metaKey || e.altKey || S.sheet || $('#cmdk') || $('.overlay')) return;
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const k = e.key.toLowerCase();
    if (k === '?') { e.preventDefault(); showShortcuts(); return; }
    if (k === '/') { e.preventDefault(); openPalette(); return; }
    if (k === 'n' && isManager() && !S.readonly && ACT['client-new']) { e.preventDefault(); ACT['client-new'](); return; }
    const s = SHORTCUTS.find(x => x[0] === k); if (s && navAllowed(s[1])) { e.preventDefault(); go(s[1]); }
  }
  document.addEventListener('keydown', onShortcut);
  // V26.65 : fermer le menu de colonne (Dossiers) au clic ailleurs ou avec Échap
  document.addEventListener('click', e => { if (S.thMenu && !(e.target.closest && e.target.closest('.th-pop, .th-b'))) { S.thMenu = null; const r = $('#results'); if (r) r.innerHTML = clientsTable(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.thMenu) { S.thMenu = null; const r = $('#results'); if (r) r.innerHTML = clientsTable(); } });

  /* ---------- V26.68 : carte « Mon compte » au clic sur le logo (infos, raccourcis, déconnexion) ---------- */
  function openMeCard(btn) {
    const old = $('#me-card'); if (old) { old.classList.add('out'); setTimeout(() => old.remove(), FX.FAST); return; }
    if (!S.me) return;
    const co = collabOf(S.me.collaborator_id), team = co && co.team_id && S.data.teams.get(co.team_id);
    const r = (btn || $('.logo-btn')).getBoundingClientRect();
    btn && btn.classList.remove('pulse'); btn && void btn.offsetWidth; btn && btn.classList.add('pulse');
    const el = document.createElement('div'); el.id = 'me-card'; el.className = 'me-card'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Mon compte');
    el.style.left = Math.round(r.left) + 'px'; el.style.top = Math.round(r.bottom + 10) + 'px';
    el.innerHTML = '<div class="me-top"><span class="me-av"><i></i>' + esc(initials(S.me.name)) + '</span><div><b>' + esc(S.me.name) + '</b><span>' + esc(S.me.email || '') + '</span></div></div>'
      + '<div class="me-tags"><span>' + esc(roleLabel(S.me)) + '</span>' + (team ? '<span>' + esc(team.name) + '</span>' : '') + (S.store.mode === 'demo' ? '<span>Démo</span>' : '') + '</div>'
      + '<div class="me-list">'
      + (S.me.collaborator_id ? '<button data-me="today">' + ic('home', 'sm') + 'Ma journée</button>' : '')
      + (realAdmin() ? '<button data-me="viewuser" class="me-viewas">' + ic('users', 'sm') + (S.realMe ? 'Revenir à ma vue administrateur' : 'Voir en tant que…') + '</button>' : '')
      + (realAdmin() && !S.realMe ? '<button data-me="viewas" class="me-viewas">' + ic('users', 'sm') + (viewAsManager() ? 'Revenir à la vue administrateur' : 'Voir comme un manager') + '</button>' : '')
      + '<button data-me="settings">' + ic('sliders', 'sm') + 'Paramètres & apparence</button>'
      + '<button data-me="keys">' + ic('list', 'sm') + 'Raccourcis clavier<kbd>?</kbd></button>'
      + '</div><button class="me-out" data-me="logout">' + ic('logout', 'sm') + 'Se déconnecter</button>';
    document.body.appendChild(el);
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), FX.FAST); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esck, true); };
    const outside = e => { if (!el.contains(e.target) && !(e.target.closest && e.target.closest('.logo-btn'))) close(); };
    const esck = e => { if (e.key === 'Escape') close(); };
    el.addEventListener('click', e => { const b = e.target.closest('[data-me]'); if (!b) return; const k = b.dataset.me; close(); if (k === 'logout') ACT.logout(); else if (k === 'keys') showShortcuts(); else if (k === 'viewas') toggleViewAs(); else if (k === 'viewuser') { if (S.realMe) viewAsUser(null); else openSheet({ type: 'viewUser' }); } else go(k); });
    setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', esck, true); }, 0);
  }
  function toggleViewAs() {
    const on = !viewAsManager();
    try { if (on) sessionStorage.setItem('planif-view-as', 'manager'); else sessionStorage.removeItem('planif-view-as'); } catch (e) { /* navigation privée */ }
    S.teamFilter = null; if (!navAllowed(S.route)) go('dashboard'); render();
    toast(on ? 'Aperçu : vous voyez l\'application comme un manager (vos droits d\'administrateur restent actifs en base).' : 'Retour à la vue administrateur.', 'ok', null, 4500);
  }
  /* V26.144 : « Voir en tant que… » — l'administrateur choisit une personne et voit exactement son application
     (menus, dossiers, plannings, alertes), avec ses propres droits d'administrateur pour agir. Limité à l'onglet en cours. */
  function viewAsUser(id) {
    try { if (id) sessionStorage.setItem('planif-view-user', id); else sessionStorage.removeItem('planif-view-user'); sessionStorage.removeItem('planif-view-as'); } catch (e) { }
    location.hash = '#/today'; location.reload();
  }
  function sheetViewUser() {
    const us = list('app_users').filter(u => u.active && u.id !== (S.realMe || S.me).id).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
    const rows = us.map(u => '<tr class="click" data-act="view-user" data-id="' + u.id + '"><td class="first"><b>' + esc(u.name || u.email) + '</b><div class="small muted">' + esc(u.email || '') + '</div></td><td>' + esc(roleLabel(u)) + '</td><td class="num"><button class="btn sm primary" data-act="view-user" data-id="' + u.id + '">Voir sa vue</button></td></tr>').join('');
    return sheetHead('Voir l\'application en tant que…', 'Vous voyez ses menus, ses dossiers et ses alertes. Vos droits d\'administrateur restent actifs : toute modification est enregistrée à votre nom.')
      + '<div class="sheet-b">' + (us.length ? '<div class="scroll-x"><table class="t rc-t"><thead><tr><th>Personne</th><th>Rôle</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">Aucun autre utilisateur actif.</div>') + '</div><div class="sheet-f"><span class="spacer"></span><button class="btn" data-act="close">Fermer</button></div>';
  }
  function viewAsBanner() {
    if (S.realMe) return '<div class="viewas-bar"><span>' + ic('users', 'sm') + '<b>Vue de ' + esc(S.me.name || S.me.email) + '</b> (' + esc(roleLabel(S.me)) + ') — vous agissez avec vos droits d\'administrateur ; les modifications sont enregistrées à votre nom.</span><button class="btn sm" data-act="view-user-off">Revenir à ma vue</button></div>';
    return viewAsManager() ? '<div class="viewas-bar"><span>' + ic('users', 'sm') + '<b>Aperçu « vue Manager »</b> — vous voyez l\'application comme un manager.</span><button class="btn sm" data-act="view-as-off">Revenir à la vue administrateur</button></div>' : '';
  }
  /* ====================== V26.53 : Récap TVA (fenêtre centrée, arrière-plan flouté) ======================
   * Une ligne par dossier soumis à TVA sur le mois : dossier, clôture, date limite, statut, commentaire.
   * Statut calculé automatiquement : Envoyé (dépôt noté) · Prêt à envoyer (tenue terminée) · En cours (pièces reçues, tenue commencée,
   * planifiée aujourd'hui ou réception partielle) · Planifié · À recevoir. Commentaire enregistré automatiquement. */
  const TVA_CODES = ['CA3', 'CA12', 'ACPT'];
  const RECAP_ST = { sent: ['Envoyé', 'g'], ready: ['Prêt à envoyer', 'b'], doing: ['En cours', 'o'], planned: ['Planifié', 'k'], wait: ['À recevoir', 'r'] };
  function recapRows(m) {
    const td = today(), rows = [];
    list('productions').filter(p => p.month === m).forEach(p => {
      const c = clientOf(p.client_id); if (!c || !canSeeCollab(c.collaborator_id)) return;
      const ob = E.obligations(c, m, cfg()).filter(o => TVA_CODES.includes(o.code)); if (!ob.length) return;
      const o = ob.sort((a, b) => a.due.localeCompare(b.due))[0], f = p.filing && p.filing[o.code];
      const ts = list('tasks').filter(t => t.production_id === p.id && t.kind !== 'info');
      let st;
      if (f) st = 'sent';
      else if (ts.length && ts.every(t => t.done)) st = 'ready';
      else if (p.partial_date || ts.some(t => t.done) || (p.received_date && ts.some(t => t.planned_date && t.planned_date <= td))) st = 'doing';
      else if (p.received_date) st = 'planned';
      else st = 'wait';
      rows.push({ p, c, o, f, st, plan: ts.map(t => t.planned_date).filter(Boolean).sort()[0] || null });
    });
    return rows.sort((a, b) => a.o.due.localeCompare(b.o.due) || a.c.name.localeCompare(b.c.name, 'fr'));
  }
  const clotureLbl = c => { const md = c.is_cloture || '12-31'; return Number(md.slice(3)) + ' ' + MONTHS_S[Number(md.slice(0, 2)) - 1].replace('.', ''); };
  /* V26.165 : filtres par colonne (date limite, statut, commentaire), cumulables avec les pastilles de statut */
  const recapHasNote = r => !!String(r.p.tva_note || '').trim();
  function recapView(s) {
    const all = recapRows(S.month), flt = (s && s.f) || 'all', due = (s && s.fDue) || '', note = (s && s.fNote) || '';
    const rows = all.filter(r => (flt === 'all' || r.st === flt) && (!due || r.o.due === due) && (!note || (note === 'with') === recapHasNote(r)));
    return { all, rows, flt, due, note, filtered: rows.length !== all.length };
  }
  function sheetTvaRecap(s) {
    const m = S.month, v = recapView(s), all = v.all, rows = v.rows, flt = v.flt;
    const n = k => all.filter(r => r.st === k).length, withN = all.filter(recapHasNote).length;
    const chips = '<div class="chips rc-f">' + [['all', 'Tous', all.length]].concat(Object.keys(RECAP_ST).map(k => [k, RECAP_ST[k][0], n(k)])).map(x => '<button class="chip' + (flt === x[0] ? ' on' : '') + '" data-act="rc-f" data-f="' + x[0] + '">' + x[1] + ' <span class="qn">' + x[2] + '</span></button>').join('')
      + (v.filtered ? '<button class="chip rc-reset" data-act="rc-reset">' + ic('x', 'sm') + 'Effacer les filtres</button>' : '') + '</div>';
    // en-têtes cliquables : un menu de filtre par colonne
    const thSel = (k, label, opts, val) => '<select class="th-f' + (val ? ' on' : '') + '" data-ch="rc-th" data-k="' + k + '" aria-label="Filtrer : ' + label + '" title="Cliquer pour filtrer"><option value="">' + label + '</option>' + opts.map(o => '<option value="' + o[0] + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    const dues = [...new Set(all.map(r => r.o.due))].sort();
    const head = '<thead><tr><th>Dossier</th><th>Clôture</th>'
      + '<th class="num">' + thSel('due', 'Date limite', dues.map(d => [d, 'Date limite : le ' + Number(d.slice(8)) + (d < today() ? ' (dépassée)' : '') + ' (' + all.filter(r => r.o.due === d).length + ')']), v.due) + '</th>'
      + '<th>' + thSel('st', 'Statut', Object.keys(RECAP_ST).map(k => [k, 'Statut : ' + RECAP_ST[k][0] + ' (' + n(k) + ')']), flt === 'all' ? '' : flt) + '</th>'
      + '<th>' + thSel('note', 'Commentaire', [['with', 'Avec commentaire (' + withN + ')'], ['without', 'Sans commentaire (' + (all.length - withN) + ')']], v.note) + '</th></tr></thead>';
    const statusTxt = r => r.st === 'sent' ? 'Envoyé le ' + fDMY(atDay(r.f.at)) : r.st === 'planned' && r.plan ? 'Planifié le ' + fDM(r.plan) : r.st === 'wait' ? 'À recevoir' + (r.p.expected_date ? ' (vers le ' + fDM(r.p.expected_date) + ')' : '') : RECAP_ST[r.st][0];
    const body = all.length ? '<div class="scroll-x"><table class="t rc-t">' + head + '<tbody>'
      + (rows.length ? rows.map(r => '<tr class="rc-' + r.st + '"><td><b class="rc-n" data-act="rc-open" data-id="' + r.p.id + '">' + esc(r.c.name) + '</b><div class="small muted">' + esc((collabOf(r.c.collaborator_id) || {}).name || '') + ' · ' + r.o.label + '</div></td>'
        + '<td class="nowrap">' + clotureLbl(r.c) + '</td><td class="num"><b>' + Number(r.o.due.slice(8)) + '</b>' + (r.st !== 'sent' && r.o.due < today() ? ' <span class="badge r">dépassée</span>' : '') + '</td>'
        + '<td><span class="badge ' + RECAP_ST[r.st][1] + '">' + statusTxt(r) + '</span>' + (r.st === 'ready' && !S.readonly ? '<div class="ir rc-go">' + Object.keys(E.FILING_VIA).map(vv => '<button data-act="file" data-pid="' + r.p.id + '" data-code="' + r.o.code + '" data-via="' + vv + '">' + (vv === 'jedeclare' ? 'jedeclare.com' : 'impots.gouv') + '</button>').join('') + '</div>' : '') + '</td>'
        + '<td class="rc-c"><input type="text" data-ch="rc-note" data-id="' + r.p.id + '" value="' + esc(r.p.tva_note || '') + '" placeholder="Ajouter un commentaire…" maxlength="240"' + (S.readonly ? ' disabled' : '') + '></td></tr>').join('')
        : '<tr><td colspan="5"><div class="empty">Aucun dossier ne correspond aux filtres. <button class="btn sm" data-act="rc-reset">Effacer les filtres</button></div></td></tr>')
      + '</tbody></table></div>'
      : '<div class="empty">Aucun dossier soumis à TVA ce mois-ci.</div>';
    return sheetHead('Récap TVA — ' + fMonth(m), all.length + ' dossier(s)' + (v.filtered ? ' · ' + rows.length + ' affiché(s)' : '') + ' · ' + n('sent') + ' envoyé(s) · les commentaires s\'enregistrent automatiquement')
      + '<div class="sheet-b">' + chips + body + '</div><div class="sheet-f"><span class="small muted" id="rc-saved"></span><span class="spacer"></span><button class="btn" data-act="rc-csv" title="' + (v.filtered ? 'Exporte les dossiers affichés (filtres appliqués)' : 'Exporte tous les dossiers') + '">⤓ Exporter (Excel)' + (v.filtered ? ' · ' + rows.length : '') + '</button><button class="btn" data-act="close">Fermer</button></div>';
  }
  async function saveRecapNote(el) {
    const p = S.data.productions.get(el.dataset.id); if (!p) return;
    const v = el.value.trim() || null; if ((p.tva_note || null) === v) return;
    const r = await saveUpdate('productions', p.id, { tva_note: v }, { quiet: true, history: { action: 'dossier', entity: 'production', entity_id: p.id, client_id: p.client_id, detail: { text: 'Récap TVA : commentaire ' + (v ? 'modifié' : 'effacé') } } });
    const s = $('#rc-saved'); if (s && r === 'ok') { s.textContent = '✓ Commentaire enregistré'; setTimeout(() => { if (s) s.textContent = ''; }, 2500); }
  }
  async function recapCsv() {
    const XLSX = await needXLSX(), m = S.month, v = recapView(S.sheet && S.sheet.type === 'tvaRecap' ? S.sheet : null); // V26.165 : exporte ce qui est affiché (filtres)
    const aoa = [['Nom dossier', 'Collaborateur', 'Déclaration', 'Clôture', 'Date limite', 'Statut', 'Commentaire']].concat(v.rows.map(r => [r.c.name, (collabOf(r.c.collaborator_id) || {}).name || '', r.o.label, clotureLbl(r.c), Number(r.o.due.slice(8)), r.st === 'sent' ? 'Envoyé le ' + fDMY(atDay(r.f.at)) : RECAP_ST[r.st][0], r.p.tva_note || '']));
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 22 }, { wch: 40 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Récap TVA'); XLSX.writeFile(wb, 'recap-tva-' + m + (v.filtered ? '-filtre' : '') + '.xlsx');
  }
  /* ====================== V26.111 : démo guidée (bouton « Démo ») ======================
   * Parcours de 2 minutes dans l'ordre logique d'une journée : chaque étape ouvre la bonne page,
   * zoome sur l'endroit utile (projecteur) et l'explique en une ou deux phrases.
   * Flèche → / Entrée / clic : étape suivante · Flèche ← : précédente · Échap : quitter. Rien n'est modifié. */
  /* V26.112 : une démo par rôle, choisie selon le compte connecté (manager / RC / collaborateur ou apprenti) */
  const END = { center: true, t: 'À toi de jouer', b: 'Tu peux relancer cette démo à tout moment avec le bouton « Démo » en haut à droite.', hint: 'Entrée pour terminer' };
  const TOURS = {
    collab: { label: 'Démo collaborateur', steps: [
      { center: true, t: 'Bienvenue dans JB Flow', b: 'En 2 minutes : organiser ta production, suivre les pièces de tes clients et tenir les échéances TVA.', hint: 'Flèche → ou clic pour avancer' },
      { r: 'today', sel: '.side', t: 'Le menu', b: 'Tes pages, dans l\'ordre de ta journée : Aujourd\'hui, Planning, Réceptions, TVA & autres impôts, Dashboard Clients et Dossiers.' },
      { r: 'today', sel: '.hello', t: 'Ta journée', b: 'Chaque matin, commence ici : ce qui est prévu aujourd\'hui et ton avancement du mois.' },
      { r: 'today', sel: '.unpl-wrap', opt: true, t: 'Tes alertes du mois', b: 'Vert : tout est planifié. Rouge : des dossiers n\'ont pas de place avant l\'échéance.', click: '.unpl-wrap .btn' },
      { r: 'today', sel: '.kpis-today', opt: true, t: 'Ta journée en un coup d\'œil', b: 'Niveau d\'activité, tâches qui restent, pièces attendues et alertes. Au-dessus, le compte à rebours avant la date limite de la TVA.' },
      { r: 'today', sel: '.rec-home-f, .card:has(.up-row.cli)', opt: true, t: 'Tes clients à relancer', b: 'Pièces en retard : l\'enveloppe prépare le mail de relance, le téléphone note un appel. Coche les dossiers arrivés puis « Valider ».', click: '.rec-home-f .rl-btn, .up-row.cli .btn' },
      { r: 'planning', sel: '.pc-board, .week, .month', t: 'Ton planning', b: 'Ta journée heure par heure (ou ta semaine avec « Semaine »). Glisse une tâche pour la déplacer si nécessaire.' },
      { r: 'planning', sel: '.pc-kpis', t: 'L\'essentiel en 4 chiffres', b: 'À traiter aujourd\'hui, en retard, à recevoir, terminé : un clic affiche la liste.', click: '.pc-kpis .pc-kpi' },
      { r: 'planning', sel: '.pc-blk, .pc-card, #view .task', opt: true, t: 'Terminer une tâche', b: 'Ouvre-la puis « Terminer » : indique le temps réellement passé, l\'outil apprend tes vrais temps.', click: '.pc-blk, .pc-card, #view .task' },
      { r: 'receptions', sel: '.rec-list, #view .card:has(.rec)', t: 'Les pièces reçues', b: 'Coche les dossiers dont les pièces sont arrivées puis « Valider » : ton planning se recalcule automatiquement.', click: '.rec input[type=checkbox]' },
      { r: 'tva', sel: '.tva-nav', t: 'Tes déclarations', b: 'Ce qui est à déposer, déposé ou en retard : coche le dépôt une fois fait. Les acomptes d\'IS se gèrent aussi sur cette page.', click: '.tva-recap-btn' },
      { r: 'dashboards', sel: '#view table, #view .card', opt: true, t: 'Le suivi des Dashboard Clients', b: 'Chaque tableau de bord client : à faire, fait ou publié, avec la date à laquelle il doit être publié.', click: '[data-act="done"], [data-act="dash-pub"]' },
      { r: 'clients', sel: '#results, #view .card', t: 'Tes dossiers', b: 'Une ligne par client. Clique sur un dossier pour ouvrir sa fiche.', click: 'tr[data-act="client"]' },
      { r: 'clients', open: 'tr[data-act="client"]', sel: '.sheet.sheet-client', opt: true, dock: true, t: 'La fiche du dossier', b: 'Tous les paramètres du dossier en un coup d\'œil : temps, réception, TVA, options. Ceux que tu peux modifier sont actifs, les autres grisés.' },
      END ] },    rc: { label: 'Démo RC', steps: [
      { center: true, t: 'Bienvenue dans JB Flow', b: 'En 2 minutes : ta production, celle de tes collaborateurs, et comment répartir le travail entre vous.', hint: 'Flèche → ou clic pour avancer' },
      { r: 'today', sel: '.hello', t: 'Ta journée', b: 'Ce qui est prévu aujourd\'hui et ton avancement du mois.' },
      { r: 'today', sel: '.chips:has([data-act="collab"])', opt: true, t: 'Tes collaborateurs', b: 'Un onglet par collaborateur rattaché : un clic affiche sa journée et ses alertes.', click: '.chips [data-act="collab"]:not(.on)' },
      { r: 'today', sel: '.unpl-wrap', opt: true, t: 'Les alertes du mois', b: 'Rouge : des dossiers sans place avant l\'échéance. « Voir » ouvre la liste.', click: '.unpl-wrap .btn' },
      { r: 'today', sel: '.kpis-today', opt: true, t: 'La journée en un coup d\'œil', b: 'Niveau d\'activité, tâches qui restent, pièces attendues et alertes, pour toi ou le collaborateur choisi au-dessus.' },
      { r: 'planning', sel: '.pc-board', t: 'Plannings côte à côte', b: 'Ton planning, puis celui de tes collaborateurs juste en dessous, heure par heure.' },
      { r: 'planning', sel: '.pc-board', t: 'Répartir le travail', b: 'Glisse une tâche sur la ligne d\'une autre personne pour la lui confier, ou la reprendre.' },
      { r: 'planning', sel: '.pc-kpis', t: 'L\'essentiel en 4 chiffres', b: 'À traiter aujourd\'hui, en retard, à recevoir, terminé : un clic affiche la liste. Les tâches à affecter se glissent sur la ligne d\'une personne.', click: '.pc-kpis .pc-kpi' },
      { r: 'receptions', sel: '.rec-list, #view .card:has(.rec)', t: 'Les pièces reçues', b: 'Coche les dossiers arrivés puis « Valider » : les plannings se recalculent seuls.', click: '.rec input[type=checkbox]' },
      { r: 'tva', sel: '.tva-nav', t: 'Les déclarations', b: 'Ce qui est à déposer ou en retard, et le Récap TVA du mois. Les acomptes d\'IS se gèrent aussi sur cette page.', click: '.tva-recap-btn' },
      { r: 'dashboards', sel: '#view table, #view .card', t: 'Le suivi des Dashboard Clients', b: 'Chaque tableau de bord client de ton équipe : à faire, fait ou publié, avec la date à laquelle il doit être publié.', click: '[data-act="done"], [data-act="dash-pub"]' },
      { r: 'clients', sel: '#results, #view .card', t: 'Les dossiers', b: 'Les dossiers de ton équipe : la fiche règle le temps, l\'échéance et les options.', click: 'tr[data-act="client"]' },
      END ] },
    manager: { label: 'Démo manager', steps: [
      { center: true, t: 'Bienvenue dans JB Flow', b: 'Une visite du menu, onglet par onglet : piloter l\'équipe, anticiper les surcharges, tenir les échéances.', hint: 'Flèche → ou clic pour avancer' },
      { r: 'dashboard', sel: '.side', t: 'Le menu', b: 'Pilotage (vue d\'ensemble, équipe, prévisions, dossiers), Suivi (indicateurs), puis la Production et les Paramètres.' },
      // Pilotage
      { r: 'dashboard', sel: '.pilot-tabs, .page-h', opt: true, t: 'Vue d\'ensemble', b: 'Ta page d\'accueil : l\'état de la production de toute l\'équipe, en un écran.' },
      { r: 'dashboard', sel: '.ms-pill', opt: true, t: 'À retenir : les échéances', b: 'Vert : l\'équipe tiendra les échéances. Rouge : clique pour voir quels dossiers et pourquoi.', click: '.ms-pill' },
      { r: 'dashboard', sel: '.synth', opt: true, t: 'À retenir : la synthèse', b: 'L\'essentiel de la semaine en cinq lignes, à copier pour ta réunion d\'équipe.', click: '[data-act="synth-copy"]' },
      { r: 'dashboard', sel: '.risk-list', opt: true, t: 'À retenir : les dossiers à risque', b: 'Du plus urgent au moins urgent, avec la raison. Un clic ouvre le dossier.', click: '.risk-row' },
      { r: 'activite', sel: '#view .card', t: 'Équipe & activité', b: 'La charge de chaque collaborateur jour par jour : repère d\'un coup d\'œil qui est surchargé (rouge) et qui a de la marge.' },
      { r: 'previsions', sel: '#cap-risk + .card, #view .card', t: 'Prévisions & agent', b: 'L\'agent prévoit les surcharges des 3 prochains mois et propose à qui confier un dossier. Rien ne change sans ta double confirmation.', click: '.rb-cta .btn' },
      { r: 'clients', sel: '#view .row:has([data-act="import"]), #results', t: 'Dossiers', b: 'Tous les dossiers du cabinet : crée-en un, importe ton fichier Excel, ou ouvre une fiche pour régler collaborateur, temps et options.', click: '[data-act="client-new"], [data-act="import"]' },
      // Suivi
      { r: 'kpi', sel: '.kpi, #view .card', t: 'Indicateurs', b: 'Délais de réception, temps réels contre temps prévus, respect des échéances : les chiffres pour ajuster l\'organisation.' },
      // Production
      { r: 'planning', sel: '.pc-board', opt: true, t: 'Planning de l\'équipe', b: 'Toute l\'équipe sur un écran, heure par heure : qui fait quoi, combien de travail chacun a. Glisse une tâche pour la confier à un autre.' },
      { r: 'planning', sel: '[data-act="replan"]', opt: true, t: 'À retenir : optimiser le planning', b: 'Après une absence ou un gros retard de pièces : l\'outil propose des déplacements, rien ne bouge sans ta validation.', click: '[data-act="replan"]' },
      { r: 'receptions', sel: '.rec-list, #view .card:has(.rec)', opt: true, t: 'Réceptions', b: 'Les pièces attendues de tous les clients : coche celles arrivées, les plannings se recalculent seuls.', click: '.rec input[type=checkbox]' },
      { r: 'tva', sel: '.tva-nav', t: 'TVA & autres impôts', b: 'Les dépôts de toute l\'équipe, les retards et le Récap TVA du mois. Les acomptes d\'IS se gèrent aussi sur cette page.', click: '.tva-recap-btn' },
      { r: 'dashboards', sel: '#view table, #view .card', opt: true, t: 'Dashboard Clients', b: 'Chaque tableau de bord client : à faire, fait ou publié, avec sa date limite de publication.' },
      { r: 'team', sel: '#view .card', opt: false, t: 'Équipe', b: 'L\'activité de chacun jour par jour : vert disponible, orange proche de la saturation, rouge surchargé. Clique une case pour ouvrir le planning du jour.', click: 'td[data-act], .cell[data-act], [data-act="team-day"]' },
      // Réglages
      { r: 'settings', sel: '#view .card', t: 'Paramètres', b: 'Apparence, règles de planification et sécurité de l\'outil.' },
      END ] }
  };
  function tourRole() {
    if (isManager()) return 'manager';
    const me = collabOf(S.me && S.me.collaborator_id);
    return me && me.kind === 'rc' ? 'rc' : 'collab';
  }  const TR = { on: false, i: 0, steps: [], el: null, raf: 0, target: null, back: null };
  function tourSteps() { TR.role = tourRole(); return TOURS[TR.role].steps.filter(s => !s.admin || isAdmin()); }
  function startTour() {
    if (TR.on) return;
    if (S.sheet) closeSheet(true);
    TR.on = true; TR.i = 0; TR.steps = tourSteps(); TR.back = location.hash;
    const el = TR.el = document.createElement('div'); el.id = 'tour'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Démo guidée');
    el.innerHTML = '<div class="tour-veil"></div><div class="tour-spot"><i class="tour-ring"></i></div><div class="tour-tgt" aria-hidden="true"><span>Clique ici</span></div>'
      + '<div class="tour-card" tabindex="-1"><div class="tour-top"><span class="tour-n"></span><button class="tour-x" aria-label="Quitter la démo">✕</button></div><h3 class="tour-t"></h3><p class="tour-b"></p>'
      + '<div class="tour-bar"><i></i></div><div class="tour-nav"><button class="btn sm tour-prev" aria-label="Étape précédente">←</button><span class="tour-hint"></span><button class="btn sm primary tour-next">Suivant →</button></div></div>';
    document.body.appendChild(el); document.body.classList.add('touring');
    DemoCursor.destroy(); DemoCursor.mount(el); // V26.176 : curseur de démonstration réutilisable (021-mouvement.js), en plus du vrai curseur
    el.querySelector('.tour-x').onclick = endTour;
    el.querySelector('.tour-prev').onclick = e => { e.stopPropagation(); tourGo(TR.i - 1); };
    el.querySelector('.tour-next').onclick = e => { e.stopPropagation(); tourGo(TR.i + 1); };
    el.querySelector('.tour-veil').onclick = () => tourGo(TR.i + 1);
    el.querySelector('.tour-spot').onclick = () => tourGo(TR.i + 1);
    document.addEventListener('keydown', tourKey, true);
    addEventListener('resize', tourPlace); addEventListener('scroll', tourPlace, true);
    requestAnimationFrame(() => el.classList.add('in'));
    tourGo(0);
    try { hist('demo', { detail: { text: 'Démo guidée lancée' } }); } catch (e) { }
  }
  function tourKey(e) {
    if (!TR.on) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); tourGo(TR.i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); tourGo(TR.i - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTour(); }
  }
  function endTour() {
    if (!TR.on) return; TR.on = false;
    document.removeEventListener('keydown', tourKey, true); removeEventListener('resize', tourPlace); removeEventListener('scroll', tourPlace, true);
    DemoCursor.hint(false);
    const el = TR.el; if (el) { el.classList.remove('in'); el.classList.add('out'); setTimeout(() => { el.remove(); if (!TR.on) DemoCursor.destroy(); }, FX.MEDIUM); }
    document.body.classList.remove('touring'); TR.el = null; TR.target = null; if (S.sheet) closeSheet(true);
    try { lsSet('planif-tour-seen', '1'); } catch (e) { }
  }
  const tourSleep = ms => new Promise(r => setTimeout(r, ms));
  const tourVis = el => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; };
  async function tourGo(i) {
    if (!TR.on) return;
    // une étape à la fois : un clic pendant le chargement d'une page est mis en attente, jamais perdu ni sauté
    if (TR.busy) { TR.queued = i; return; }
    TR.busy = true;
    try { await tourStep(i); } finally { TR.busy = false; }
    if (TR.queued !== undefined && TR.on) { const q = TR.queued; TR.queued = undefined; tourGo(q > TR.i ? TR.i + 1 : q < TR.i ? TR.i - 1 : q); }
  }
  async function tourStep(i) {
    if (i >= TR.steps.length) return endTour();
    if (i < 0) i = 0;
    const dir = i >= TR.i ? 1 : -1; TR.i = i;
    const s = TR.steps[i], el = TR.el; if (!el) return;
    const card = el.querySelector('.tour-card');
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // 1. La carte disparaît d'abord (fondu court), puis on change de page
    card.classList.add('swap'); DemoCursor.hint(false); el.querySelector('.tour-tgt').classList.remove('on'); TR.cur = null;
    await tourSleep(FX.FAST);
    if (S.sheet && !s.open) { closeSheet(true); await tourSleep(FX.MEDIUM); }
    if (s.r && S.route !== s.r) { go(s.r); await frame(); tourTop(); await frame(); await tourSleep(120); } // nouvelle page : on repart du haut (sinon le défilement de la page précédente est conservé)
    // fiche : le curseur de démonstration va jusqu'à la ligne, marque une pause, clique, puis la fiche s'ouvre (attendre la fin de son ouverture)
    if (s.open && !(S.sheet && S.sheet.type === 'client')) { const o = [...document.querySelectorAll(s.open)].find(tourVis); if (o) { await DemoCursor.tap(o, () => o.click()); DemoCursor.hide(); await frame(); await tourSleep(FX.SLOW); } }
    if (!TR.on || TR.el !== el) return;
    // 2. Cible de l'étape
    let target = null;
    if (s.sel) for (let k = 0; k < (s.opt ? 5 : 12) && !target; k++) { target = tourFind(s); if (!target) await tourSleep(60); }
    if (!TR.on || TR.el !== el) return;
    if (s.sel && !target && s.opt) return tourStep(i + dir); // élément absent (ex. aucune alerte ce mois-ci) : étape suivante
    TR.target = target; TR.step = s;
    if (target && !s.dock) { const r = target.getBoundingClientRect(); if (r.top < 70 || r.top > innerHeight - 160 || (r.bottom > innerHeight - 20 && r.height < innerHeight * .6)) { target.scrollIntoView({ block: r.height > innerHeight * .6 ? 'start' : 'center', behavior: 'smooth' }); await tourSleep(420); } }
    if (!TR.on || TR.el !== el) return;
    // 3. Texte, puis placement SANS glissement de la carte (elle est invisible), puis fondu d'apparition
    el.querySelector('.tour-n').textContent = TOURS[TR.role].label + ' · étape ' + (i + 1) + ' sur ' + TR.steps.length;
    el.querySelector('.tour-t').textContent = s.t;
    el.querySelector('.tour-b').textContent = s.b;
    el.querySelector('.tour-hint').textContent = s.hint || '← → pour naviguer';
    el.querySelector('.tour-bar i').style.width = ((i + 1) / TR.steps.length * 100) + '%';
    el.querySelector('.tour-prev').disabled = i === 0;
    el.querySelector('.tour-next').textContent = i === TR.steps.length - 1 ? 'Terminer ✓' : 'Suivant →';
    el.classList.toggle('centered', !target); el.classList.toggle('docked', !!s.dock);
    const spot = el.querySelector('.tour-spot'); spot.classList.remove('zoom'); void spot.offsetWidth; spot.classList.add('zoom');
    card.classList.add('jump'); tourPlaceNow(); void card.offsetWidth; card.classList.remove('jump');
    await frame();
    card.classList.remove('swap'); card.focus({ preventScroll: true });
    // Curseur de démonstration : il glisse jusqu'à l'endroit à cliquer, marque une courte pause, montre un clic discret, puis le rappelle de temps en temps
    if (TR.cur) DemoCursor.moveTo(TR.cur[0], TR.cur[1]).then(() => DemoCursor.pause()).then(() => { if (TR.on && TR.i === i && TR.cur) { DemoCursor.click(); DemoCursor.hint(true); } });
    // 4. Recalage : la page peut encore bouger (animations d'entrée, polices, images)
    [180, 450, 900].forEach(ms => setTimeout(() => { if (TR.on && TR.i === i) tourPlace(); }, ms));
  }
  function tourFind(s) { for (const q of s.sel.split(',')) { const e = [...document.querySelectorAll(q.trim())].find(tourVis); if (e) return e; } return null; } // sélecteurs essayés dans l'ordre de préférence
  function tourTop() { window.scrollTo(0, 0); document.querySelectorAll('main, .main, #view, .content').forEach(e => { if (e.scrollTop) e.scrollTop = 0; }); }
  function tourPlace() {
    if (!TR.on || !TR.el) return;
    cancelAnimationFrame(TR.raf);
    TR.raf = requestAnimationFrame(tourPlaceNow);
  }
  function tourPlaceNow() {
    if (!TR.on || !TR.el) return;
    const el = TR.el, s = TR.step || {}, spot = el.querySelector('.tour-spot'), card = el.querySelector('.tour-card'), tgt = el.querySelector('.tour-tgt');
    // La page a été redessinée (actualisation, notification…) : on retrouve l'élément au lieu de perdre le cadre
    if (TR.target && !document.body.contains(TR.target) && s.sel) TR.target = tourFind(s);
    const W = innerWidth, H = innerHeight, cw = s.dock ? Math.min(300, W - 32) : Math.min(360, W - 32);
    card.style.width = cw + 'px';
    if (!TR.target) {
      Object.assign(spot.style, { left: W / 2 + 'px', top: H / 2 + 'px', width: '0px', height: '0px' });
      card.style.left = (W - cw) / 2 + 'px'; card.style.top = Math.max(20, H / 2 - card.offsetHeight / 2) + 'px';
      TR.cur = null; DemoCursor.hide(); tgt.classList.remove('on'); return;
    }
    const r = TR.target.getBoundingClientRect(), pad = s.dock ? 2 : 8;
    const x = Math.max(6, r.left - pad), y = Math.max(6, r.top - pad), w = Math.min(W - 12, r.width + pad * 2), h = Math.min(H - 12, r.height + pad * 2);
    Object.assign(spot.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    const ch = card.offsetHeight || 190; let cx, cy;
    if (s.dock) { // fiche ouverte : carte compacte dans un coin, hors des paramètres autant que possible
      const right = W - (x + w), left = x;
      if (right >= cw + 24) { cx = x + w + 12; cy = H - ch - 16; } else if (left >= cw + 24) { cx = x - cw - 12; cy = H - ch - 16; } else { cx = W - cw - 16; cy = H - ch - 16; }
    }
    else if (y + h + ch + 18 < H) { cy = y + h + 14; cx = x + Math.min(w / 2, 180) - 40; }
    else if (y - ch - 14 > 0) { cy = y - ch - 14; cx = x + Math.min(w / 2, 180) - 40; }
    else if (x + w + cw + 18 < W) { cx = x + w + 14; cy = Math.min(H - ch - 16, Math.max(16, y)); }
    else { cx = Math.max(16, x - cw - 14); cy = Math.min(H - ch - 16, Math.max(16, y)); }
    card.style.left = Math.max(16, Math.min(W - cw - 16, cx)) + 'px'; card.style.top = Math.max(16, Math.min(H - ch - 16, cy)) + 'px';
    // Curseur de démonstration : montre où cliquer (V26.176 : il glisse jusqu'au nouvel endroit au lieu d'y sauter)
    const c = s.click ? [...TR.target.querySelectorAll(s.click)].concat(TR.target.matches(s.click) ? [TR.target] : []).find(tourVis) : null;
    if (c) {
      const b = c.getBoundingClientRect(), pt = [b.left + Math.min(b.width / 2, 60), b.top + b.height / 2], had = !!TR.cur;
      TR.cur = pt; if (had) DemoCursor.moveTo(pt[0], pt[1]); // première position : le glissement part une fois la carte affichée (tourStep)
      Object.assign(tgt.style, { left: (b.left - 6) + 'px', top: (b.top - 6) + 'px', width: (b.width + 12) + 'px', height: (b.height + 12) + 'px' }); tgt.classList.toggle('below', b.top < 60); tgt.classList.add('on');
    }
    else { TR.cur = null; DemoCursor.hide(); tgt.classList.remove('on'); }
  }  /* V26.125 : la démo ne se fait JAMAIS sur les vraies données du cabinet.
     Dans l'outil réel, « Démo » ouvre un bac à sable (demo.html) : dossiers et collaborateurs fictifs, stockés dans le navigateur, sans Supabase.
     Collaborateur → démo collaborateur, RC → démo RC, manager et administrateur → démo manager. */
  function sandboxUrl() {
    const role = isManager() ? 'manager' : ((collabOf(S.me && S.me.collaborator_id) || {}).kind === 'rc' ? 'rc' : 'collab');
    return 'demo.html?role=' + role;
  }
  async function offerDemo(first) {
    if (S.store && S.store.mode === 'demo') return startTour(); // déjà dans le bac à sable
    const ok = await confirmBox(first ? 'Bienvenue dans JB Flow' : 'Démo de JB Flow',
      '<p>Découvre l\'outil en 2 minutes dans un <b>bac à sable</b> : des dossiers et des collaborateurs <b>fictifs</b>, dans un nouvel onglet.</p><p>Tes vraies données ne sont ni affichées ni modifiées.</p>'
      + (first ? '<p class="small muted">Tu pourras relancer la démo à tout moment avec le bouton « Démo » en haut de l\'écran.</p>' : ''),
      'Lancer la démo');
    if (ok) window.open(sandboxUrl(), '_blank', 'noopener');
  }
  // Première connexion : proposition de la démo (après le choix de l'ambiance), une seule fois par utilisateur et par appareil
  function firstDemoOffer() {
    if (!S.me || (S.store && S.store.mode === 'demo')) return;
    const k = 'jbflow-demo-offered:' + String(S.me.email || '').toLowerCase();
    if (lsGet(k)) return;
    let n = 0;
    const tick = () => { if (!S.me) return; if (document.querySelector('.overlay, .tp-card, #tour') && n++ < 90) return setTimeout(tick, 1000); lsSet(k, '1'); offerDemo(true); };
    setTimeout(tick, 2500);
  }
  window.JBFlowTour = startTour; // démo publiée : lancement automatique à la première visite
  /* ===== V26.127 : suivi des CFE =====
     Option « Suivi CFE » sur la fiche du dossier. Chaque année, les avis sont disponibles vers le 5 novembre :
     à partir de cette date, un rappel invite à les récupérer tant que le montant n'est pas noté.
     Par dossier et par année (clients.cfe_suivi = { "2026": { amount, mode, warned, comment } }) :
     montant à payer, mode de paiement, client averti, commentaire. Échéance de paiement : 15 décembre. */
  const CFE_MODES = [['', '—'], ['mensualise', 'Mensualisé'], ['prelevement', 'Prélèvement à l\'échéance'], ['a_payer', 'Paiement à faire'], ['pas_avis', 'Pas d\'avis']]; // V26.129 : « Pas d'avis » (exonération, pas de CFE cette année…)
  const cfeAvailOn = y => y + '-11-05';
  const cfeOf = (c, y) => ((c && c.cfe_suivi) || {})[y] || {};
  // Visibilité : collaborateur = ses dossiers et ceux de ses juniors ; apprenti = aussi ceux de son tuteur ;
  // RC = son équipe ; manager = son équipe (canSeeCollab) ; administrateur = tout le cabinet
  const cfeCanSee = c => canSeeCollab(c.collaborator_id) || (() => { const me = collabOf(S.me && S.me.collaborator_id); return !!(me && me.kind === 'apprenti' && me.tutor_id && c.collaborator_id === me.tutor_id); })();
  const cfeClients = cid => list('clients').filter(c => c.active !== false && c.cfe && (cid ? c.collaborator_id === cid || (collabOf(cid) || {}).tutor_id === c.collaborator_id : cfeCanSee(c))).sort(byName);
  const cfeYear = () => S.cfeYear || Number(today().slice(0, 4));
  const cfeHasAmount = e => e.mode === 'pas_avis' || (e.amount !== undefined && e.amount !== null && e.amount !== ''); // « Pas d'avis » = rien à récupérer
  const cfeStatus = (e, avail) => e.mode === 'pas_avis' ? ['none', 'Pas d\'avis', ''] : (e.amount !== undefined && e.amount !== null && e.amount !== '') ? ['got', 'Avis reçu', 'g'] : avail ? ['todo', 'À récupérer', 'r'] : ['soon', 'Dispo. le 5 nov.', ''];
  // Dossiers dont l'avis est à récupérer (disponible et montant pas encore noté)
  function cfeToFetch(cid) {
    const y = Number(today().slice(0, 4));
    if (today() < cfeAvailOn(y)) return [];
    return cfeClients(cid).filter(c => !cfeHasAmount(cfeOf(c, y)));
  }
  // Rappel sur « Aujourd'hui » à partir du 5 novembre
  function cfeReminder(cid) {
    const l = cfeToFetch(cid); if (!l.length) return '';
    const y = today().slice(0, 4), names = l.slice(0, 4).map(c => esc(c.name)).join(', ') + (l.length > 4 ? ' et ' + (l.length - 4) + ' autre(s)' : '');
    return '<div class="notice warn anim-in" style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' + ic('file', 'sm') + '<div style="flex:1"><b>Avis de CFE ' + y + ' disponibles</b> : récupère les avis de ' + l.length + ' dossier(s) sur l\'espace professionnel impots.gouv — ' + names + '.</div><a class="btn sm" href="#/tva" data-act="cfe-go">Suivi CFE</a></div>';
  }
  function cfeSection() {
    const y = cfeYear(), td = today(), cls = cfeClients(), ro = S.readonly ? ' disabled' : '';
    const avail = td >= cfeAvailOn(y), paid = y + '-12-15';
    const todo = cls.filter(c => avail && !cfeHasAmount(cfeOf(c, y))).length, warnedN = cls.filter(c => cfeOf(c, y).warned).length;
    const row = c => {
      const e = cfeOf(c, y), has = cfeHasAmount(e);
      const s0 = cfeStatus(e, avail), st = '<span class="badge ' + s0[2] + '">' + s0[1] + '</span>';
      return '<tr id="cfe-r-' + c.id + '"><td><b>' + esc(c.name) + '</b><div class="small muted">' + esc((collabOf(c.collaborator_id) || {}).name || '') + '</div></td><td>' + st + '</td>'
        + '<td><input class="cfe-in" type="number" min="0" step="1" inputmode="decimal" placeholder="€" data-ch="cfe-in" data-id="' + c.id + '" data-k="amount" value="' + esc(e.amount === undefined || e.amount === null ? '' : e.amount) + '"' + ro + ' style="width:110px"></td>'
        + '<td><select data-ch="cfe-in" data-id="' + c.id + '" data-k="mode"' + ro + '>' + CFE_MODES.map(([v, l]) => '<option value="' + v + '"' + ((e.mode || '') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></td>'
        + '<td style="text-align:center"><input type="checkbox" data-ch="cfe-in" data-id="' + c.id + '" data-k="warned"' + (e.warned ? ' checked' : '') + ro + ' aria-label="Client averti"></td>'
        + '<td class="nowrap">' + cfePayCell(c, e) + '</td>'
        + '<td><input type="text" data-ch="cfe-in" data-id="' + c.id + '" data-k="comment" value="' + esc(e.comment || '') + '" placeholder="Commentaire"' + ro + ' style="width:100%;min-width:160px"></td></tr>';
    };
    const body = cls.length
      ? '<div style="overflow-x:auto"><table class="tbl cfe-tbl"><thead><tr><th>Client</th><th>Avis ' + y + '</th><th>Montant à payer</th><th>Mode de paiement</th><th>Client averti</th><th>Payé</th><th>Commentaire</th></tr></thead><tbody>' + cls.map(row).join('') + '</tbody></table></div>'
      : '<div class="empty">Aucun dossier suivi. Cochez « Suivi CFE » dans la fiche du dossier.</div>';
    return '<div class="section-t" style="margin-top:var(--gap)"><h2>Suivi CFE</h2><span class="muted small">avis disponibles vers le 5 novembre · paiement au ' + fDM(paid) + '</span></div>'
      + '<div class="frame cfe-card tva-frame"><div class="frame-h">' + ic('file') + '<h2>CFE ' + y + '</h2>'
      + (cls.length ? '<span class="badge">' + cls.length + ' dossier(s)</span>' : '') + (todo ? '<span class="badge r">' + todo + ' à récupérer</span>' : '') + (cls.length ? '<span class="badge g">' + warnedN + ' averti(s)</span>' : '')
      + '<span class="spacer"></span><button class="btn icon sm" data-act="cfe-year" data-d="-1" aria-label="Année précédente">' + ic('chevL', 'sm') + '</button><b>' + y + '</b><button class="btn icon sm" data-act="cfe-year" data-d="1" aria-label="Année suivante">' + ic('chevR', 'sm') + '</button></div>'
      + '<div class="inner">' + (!avail && cls.length ? '<div class="notice small" style="margin-bottom:10px">Les avis ' + y + ' seront disponibles vers le 5 novembre : un rappel s\'affichera alors pour les récupérer.</div>' : '') + body + '</div></div>';
  }
  // Enregistrements en file : deux modifications rapides ne s'écrasent pas
  function cfeSave(el) { S._cfeChain = (S._cfeChain || Promise.resolve()).then(() => cfeSave1(el)).catch(() => { }); return S._cfeChain; }
  async function cfeSave1(el) {
    const c = clientOf(el.dataset.id); if (!c) return;
    const y = String(cfeYear()), k = el.dataset.k;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'amount') { v = String(v).replace(',', '.').trim(); if (v !== '' && !(Number(v) >= 0)) { toast('Montant invalide', 'warn'); return; } v = v === '' ? null : Number(v); }
    if (k === 'comment') v = String(v).trim();
    if (k === 'paid') v = v || null;
    const all = Object.assign({}, c.cfe_suivi || {}), e = Object.assign({}, all[y] || {}, { [k]: v });
    all[y] = e;
    await saveUpdate('clients', c.id, { cfe_suivi: all }, { quiet: true, history: { action: 'dossier', entity: 'client', entity_id: c.id, client_id: c.id, detail: { text: 'CFE ' + y + ' : ' + k + ' modifié' } } });
  }

  /* V26.129 : Récap CFE (même présentation que le Récap TVA) */
  const CFE_ST = { todo: ['À récupérer', 'r'], got: ['Avis reçu', 'g'], none: ['Pas d\'avis', ''], soon: ['Dispo. le 5 nov.', ''] };
  function cfeRecapRows() {
    const y = cfeYear(), avail = today() >= cfeAvailOn(y);
    return cfeClients().map(c => { const e = cfeOf(c, y); return { c, e, st: cfeStatus(e, avail)[0] }; });
  }
  function sheetCfeRecap(s) {
    const y = cfeYear(), all = cfeRecapRows(), flt = s.f || 'all';
    const rows = flt === 'all' ? all : flt === 'topay' ? all.filter(r => cfeToPay(r.e)) : flt === 'nowarn' ? all.filter(r => !r.e.warned && r.st === 'got') : all.filter(r => r.st === flt);
    const n = k => all.filter(r => r.st === k).length, tot = all.reduce((a, r) => a + (Number(r.e.amount) || 0), 0), topay = all.filter(r => cfeToPay(r.e)), topayAmt = topay.reduce((a, r) => a + cfeAmt(r.e), 0);
    const chips = '<div class="chips rc-f">' + [['all', 'Tous', all.length], ['topay', 'À payer', all.filter(r => cfeToPay(r.e)).length], ['todo', 'À récupérer', n('todo')], ['got', 'Avis reçu', n('got')], ['nowarn', 'Client non averti', all.filter(r => !r.e.warned && r.st === 'got').length], ['none', 'Pas d\'avis', n('none')]].map(x => '<button class="chip' + (flt === x[0] ? ' on' : '') + '" data-act="rc-f" data-f="' + x[0] + '">' + x[1] + ' <span class="qn">' + x[2] + '</span></button>').join('') + '</div>';
    const modeL = v => (CFE_MODES.find(m => m[0] === (v || '')) || ['', '—'])[1];
    const body = rows.length ? '<div class="scroll-x"><table class="t rc-t"><thead><tr><th>Dossier</th><th>Avis ' + y + '</th><th class="num">Montant</th><th>Mode de paiement</th><th>Client averti</th><th>Paiement</th><th>Commentaire</th></tr></thead><tbody>'
      + rows.map(r => '<tr class="rc-row rc-' + (cfeToPay(r.e) ? 'doing' : r.st === 'got' ? 'sent' : r.st === 'todo' ? 'wait' : 'none') + '" data-act="cfe-row" data-id="' + r.c.id + '" title="Ouvrir dans le suivi CFE"><td><b class="rc-n">' + esc(r.c.name) + '</b><div class="small muted">' + esc((collabOf(r.c.collaborator_id) || {}).name || '') + '</div></td>'
        + '<td><span class="badge ' + CFE_ST[r.st][1] + '">' + CFE_ST[r.st][0] + '</span></td><td class="num">' + (r.e.amount !== undefined && r.e.amount !== null && r.e.amount !== '' ? fmtEur(r.e.amount) : '—') + '</td>'
        + '<td>' + esc(modeL(r.e.mode)) + '</td><td>' + (r.e.warned ? '<span class="badge g">Oui</span>' : '<span class="badge">Non</span>') + '</td><td class="nowrap">' + (r.e.mode !== 'a_payer' ? '<span class="small muted">—</span>' : r.e.paid ? '<span class="badge g">Payé le ' + fDM(r.e.paid) + '</span>' : cfeAmt(r.e) > 0 ? '<span class="badge o">À payer</span>' : '<span class="small muted">—</span>') + '</td><td>' + esc(r.e.comment || '') + '</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="empty">Aucun dossier ' + (flt === 'all' ? 'avec suivi CFE' : 'dans ce statut') + '.</div>';
    return sheetHead('Récap CFE — ' + y, all.length + ' dossier(s) · ' + n('got') + ' avis reçu(s) · total ' + fmtEur(tot) + ' · paiement au 15 déc.')
      + '<div class="sheet-b"><div class="cfe-topay"><span class="t">CFE à payer</span><b>' + topay.length + '</b><span class="small">dossier(s) à payer manuellement' + (topay.length ? ' · ' + fmtEur(topayAmt) : '') + ' · avant le 15 déc.</span></div>' + chips + body + '</div><div class="sheet-f"><span class="spacer"></span><button class="btn" data-act="cfe-csv">⤓ Exporter (Excel)</button><button class="btn" data-act="close">Fermer</button></div>';
  }
  async function cfeRecapCsv() {
    const XLSX = await needXLSX(), y = cfeYear(), modeL = v => (CFE_MODES.find(m => m[0] === (v || '')) || ['', ''])[1];
    const aoa = [['Nom dossier', 'Collaborateur', 'Avis ' + y, 'Montant', 'Mode de paiement', 'Client averti', 'Paiement', 'Commentaire']].concat(cfeRecapRows().map(r => [r.c.name, (collabOf(r.c.collaborator_id) || {}).name || '', CFE_ST[r.st][0], r.e.amount === undefined || r.e.amount === null || r.e.amount === '' ? '' : Number(r.e.amount), modeL(r.e.mode), r.e.warned ? 'Oui' : 'Non', r.e.mode !== 'a_payer' ? '' : r.e.paid ? 'Payé le ' + fDM(r.e.paid) : 'À payer', r.e.comment || '']));
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 40 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Récap CFE'); XLSX.writeFile(wb, 'recap-cfe-' + y + '.xlsx');
  }

  /* V26.129 / V26.133 : Récap Acomptes IS — les 3 prochains acomptes de chaque dossier (à partir du mois en cours), montant et paiement */
  function isNext3(c) {
    const m0 = today().slice(0, 7) + '-01', y = Number(today().slice(0, 4)), data = isDataOf(c), out = [];
    for (let yy = y - 1; yy <= y + 2 && out.length < 3; yy++) {
      const cl = isClosing(c, yy), sc = isSched(cl);
      sc.forEach((d, k) => { if (d >= m0 && out.length < 3 && !out.some(o => o.d === d)) out.push({ cl, k, d, amt: isAmountOf(data[cl], k), paid: (((data[cl] || {}).paid) || {})[k + 1] || null }); });
    }
    return out.sort((a, b) => a.d.localeCompare(b.d)).slice(0, 3);
  }
  function isRecapRows() {
    const td = today();
    return list('clients').filter(c => c.active !== false && c.is_acompte && canSeeCollab(c.collaborator_id)).sort(byName).map(c => {
      const cl = isCurrentClose(c), sc = isSched(cl), k = Math.max(0, sc.findIndex(d => d >= td)), nx = sc[k], j = E.daysBetween(td, nx), sv = isDataOf(c)[cl];
      const amt = isAmountOf(sv, k), none = amt === 0, next = isNext3(c), topay = next.slice(0, 1).filter(x => x.amt > 0 && !x.paid); // prochain acompte pas encore payé
      return { c, cl, k, nx, j, sv, amt, none, next, topay, st: !sv ? 'tocalc' : none ? 'none' : topay.length ? 'topay' : 'ok' };
    });
  }
  const IS_ST = { tocalc: ['À calculer', 'r'], topay: ['À payer', 'o'], ok: ['À jour', 'g'], none: ['Aucun acompte', ''] };
  function sheetIsRecap(s) {
    const all = isRecapRows(), flt = s.f || 'all', rows = flt === 'all' ? all : all.filter(r => r.st === flt), n = k => all.filter(r => r.st === k).length;
    const toPay = all.reduce((a, r) => a.concat(r.topay), []), toPayAmt = toPay.reduce((a, x) => a + x.amt, 0);
    const chips = '<div class="chips rc-f">' + [['all', 'Tous', all.length]].concat(Object.keys(IS_ST).map(k => [k, IS_ST[k][0], n(k)])).map(x => '<button class="chip' + (flt === x[0] ? ' on' : '') + '" data-act="rc-f" data-f="' + x[0] + '">' + x[1] + ' <span class="qn">' + x[2] + '</span></button>').join('') + '</div>';
    const cell = (r, x) => !x ? '<td></td>' : '<td class="is-nx"><div><b>' + fDM(x.d) + '</b> <span class="small muted">n°' + (x.k + 1) + (x.cl !== r.cl ? ' · ex. ' + x.cl.slice(0, 4) : '') + '</span></div><div>' + (x.amt === null ? '<span class="small muted">à calculer</span>' : x.amt > 0 ? fmtEur(x.amt) + ' ' + (x.paid ? '<span class="badge g">Payé le ' + fDM(x.paid) + '</span>' : '<span class="badge o">À payer</span>') : '<span class="small muted">aucun</span>') + '</div></td>';
    const body = rows.length ? '<div class="scroll-x"><table class="t rc-t"><thead><tr><th>Dossier</th><th>Clôture</th><th>Prochain acompte</th><th>Suivant</th><th>Puis</th><th>Statut</th></tr></thead><tbody>'
      + rows.map(r => '<tr class="rc-row rc-' + (r.st === 'ok' ? 'sent' : r.st === 'topay' ? 'doing' : r.st === 'tocalc' ? 'wait' : 'none') + '" data-act="is-row" data-id="' + r.c.id + '" title="Ouvrir le calcul des acomptes"><td><b class="rc-n">' + esc(r.c.name) + '</b><div class="small muted">' + esc((collabOf(r.c.collaborator_id) || {}).name || '') + '</div></td>'
        + '<td class="nowrap">' + fDM(r.cl) + '</td>' + cell(r, r.next[0]) + cell(r, r.next[1]) + cell(r, r.next[2]) + '<td><span class="badge ' + IS_ST[r.st][1] + '">' + IS_ST[r.st][0] + '</span></td></tr>').join('') + '</tbody></table></div>'
      : '<div class="empty">Aucun dossier ' + (flt === 'all' ? 'avec acomptes d\'IS. Cochez « Acomptes IS » dans la fiche du dossier.' : 'dans ce statut.') + '</div>';
    return sheetHead('Récap Acomptes IS', all.length + ' dossier(s) · ' + n('tocalc') + ' à calculer · les 3 prochains acomptes à partir de ' + fMonth(today().slice(0, 7)))
      + '<div class="sheet-b"><div class="cfe-topay is-topay"><span class="t">Prochains acomptes à payer</span><b>' + toPay.length + '</b><span class="small">' + (toPay.length ? fmtEur(toPayAmt) + ' · cliquez sur « À payer » dans la liste une fois le paiement lancé' : 'aucun paiement en attente') + '</span></div>' + chips + body + '</div><div class="sheet-f"><span class="spacer"></span><button class="btn" data-act="is-csv">⤓ Exporter (Excel)</button><button class="btn" data-act="close">Fermer</button></div>';
  }  async function isRecapCsv() {
    const XLSX = await needXLSX(), f = x => !x ? ['', '', ''] : [fDM(x.d), x.amt === null ? 'à calculer' : x.amt, x.paid ? 'Payé le ' + fDM(x.paid) : x.amt > 0 ? 'À payer' : ''];
    const aoa = [['Nom dossier', 'Collaborateur', 'Clôture', 'Acompte 1 : date', 'Montant', 'Paiement', 'Acompte 2 : date', 'Montant', 'Paiement', 'Acompte 3 : date', 'Montant', 'Paiement', 'Statut']].concat(isRecapRows().map(r => [r.c.name, (collabOf(r.c.collaborator_id) || {}).name || '', fDM(r.cl)].concat(f(r.next[0]), f(r.next[1]), f(r.next[2]), [IS_ST[r.st][0]])));
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 10 }].concat(Array(9).fill({ wch: 13 }), [{ wch: 14 }]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Récap IS'); XLSX.writeFile(wb, 'recap-acomptes-is.xlsx');
  }

  /* V26.130 : paiement manuel — bouton « Payé » une fois le paiement lancé (mode « Paiement à faire ») */
  const cfeAmt = e => e.amount !== undefined && e.amount !== null && e.amount !== '' ? Number(e.amount) : null;
  const cfeToPay = e => e.mode === 'a_payer' && cfeAmt(e) > 0 && !e.paid;
  function cfePayCell(c, e) {
    if (e.mode !== 'a_payer') return '<span class="small muted">' + (e.mode === 'mensualise' || e.mode === 'prelevement' ? 'automatique' : '—') + '</span>';
    if (e.paid) return '<span class="badge g">Payé le ' + fDM(e.paid) + '</span>' + (S.readonly ? '' : ' <button class="btn sm" data-act="cfe-paid" data-id="' + c.id + '" data-v="0" title="Annuler">↺</button>');
    if (!(cfeAmt(e) > 0)) return '<span class="small muted">montant à saisir</span>';
    return S.readonly ? '<span class="badge o">À payer</span>' : '<button class="btn sm primary" data-act="cfe-paid" data-id="' + c.id + '" data-v="1">Payé</button>';
  }
  function cfeSetPaid(el) {
    const fake = { dataset: { id: el.dataset.id, k: 'paid' }, type: 'text', value: el.dataset.v === '1' ? today() : '' };
    return cfeSave(fake);
  }
  // Ligne du récap → ferme le récap et amène sur la ligne du dossier dans le suivi CFE
  function cfeGoRow(id) {
    closeSheet(true); if (S.route !== 'tva') go('tva'); render();
    setTimeout(() => { const r = document.getElementById('cfe-r-' + id); if (!r) return; r.scrollIntoView({ behavior: 'smooth', block: 'center' }); r.classList.add('flash-row'); setTimeout(() => r.classList.remove('flash-row'), 2200); const i = r.querySelector('input[data-k=amount]'); if (i && !i.value) i.focus({ preventScroll: true }); }, 120);
  }  /* ===== V26.135 : cartes repliables (Suivi TVA, Suivi Acompte IS, Suivi CFE, Suivi CVAE) =====
     Repliée, une carte n'affiche plus qu'une ligne de synthèse (nombre de dossiers). Choix mémorisé sur l'appareil. */
  const isFold = k => lsGet('jbflow-fold-' + k) === '1';
  function foldSec(key, html, sum) {
    if (!html) return html;
    const i = html.indexOf('</div>'); if (i < 0) return html;
    const f = isFold(key);
    const btn = '<button class="btn icon sm fold-btn' + (f ? '' : ' open') + '" data-act="fold" data-k="' + key + '" aria-expanded="' + !f + '" title="' + (f ? 'Afficher' : 'Réduire') + '" aria-label="' + (f ? 'Afficher' : 'Réduire') + '">' + ic('chevD', 'sm') + '</button>';
    return '<div class="fold-sec' + (f ? ' folded' : '') + '">' + html.slice(0, i) + btn + '</div>' + (f ? '<div class="fold-sum" data-act="fold" data-k="' + key + '" role="button" tabindex="0">' + sum + '<span class="small muted">cliquer pour afficher</span></div>' : html.slice(i + 6)) + '</div>';
  }
  function toggleFold(k) { lsSet('jbflow-fold-' + k, isFold(k) ? '0' : '1'); render(); }
  function filingsSectionF(m) {
    const rows = filingRows(m), todo = rows.filter(r => !r.filed && r.ready).length, done = rows.filter(r => r.filed).length;
    return foldSec('tva', filingsSection(m), '<b>' + rows.length + '</b> déclaration(s) · <b>' + todo + '</b> à déposer · ' + done + ' déposée(s)');
  }
  function isSectionF() {
    const n = list('clients').filter(c => c.active !== false && c.is_acompte && canSeeCollab(c.collaborator_id)).length;
    return foldSec('is', isSection(), '<b>' + n + '</b> dossier(s) avec acomptes d\'IS');
  }
  function cfeSectionF() {
    const y = cfeYear(), cls = cfeClients(), todo = cls.filter(c => today() >= cfeAvailOn(y) && !cfeHasAmount(cfeOf(c, y))).length, pay = cls.filter(c => cfeToPay(cfeOf(c, y))).length;
    return foldSec('cfe', cfeSection(), '<b>' + cls.length + '</b> dossier(s) suivi(s) · ' + todo + ' avis à récupérer · ' + pay + ' à payer');
  }

  /* ===== V26.135 : suivi de la CVAE =====
     Option « Suivi CVAE » sur la fiche du dossier (cochable par tout le monde).
     Déclaration 1329-DEF et solde de CVAE au plus tard le 5 mai de chaque année :
     rappel à partir du 1er mai, pour les collaborateurs et les RC, tant que la déclaration n'est pas déposée et payée.
     Par dossier et par année (clients.cvae_suivi = { "2027": { filed, amount, paid, comment } }). */
  const cvaeDue = y => E.nextWorkday ? E.nextWorkday(y + '-05-05') : y + '-05-05';
  const cvaeOf = (c, y) => ((c && c.cvae_suivi) || {})[y] || {};
  const cvaeYear = () => S.cvaeYear || Number(today().slice(0, 4));
  const cvaeDone = e => !!(e.filed && (e.paid || Number(e.amount) === 0));
  const cvaeClients = cid => list('clients').filter(c => c.active !== false && c.cvae && (cid ? c.collaborator_id === cid || (collabOf(cid) || {}).tutor_id === c.collaborator_id : cfeCanSee(c))).sort(byName);
  // Rappel sur « Aujourd'hui » à partir du 1er mai (collaborateur : ses dossiers ; RC : aussi ceux de son équipe)
  function cvaeReminder(cid) {
    const y = Number(today().slice(0, 4)), td = today(); if (td < y + '-05-01') return '';
    const mine = S.me && cid === S.me.collaborator_id;
    const l = (mine ? cvaeClients() : cvaeClients(cid)).filter(c => !cvaeDone(cvaeOf(c, y))); if (!l.length) return '';
    const due = cvaeDue(y), late = td > due, names = l.slice(0, 4).map(c => esc(c.name)).join(', ') + (l.length > 4 ? ' et ' + (l.length - 4) + ' autre(s)' : '');
    return '<div class="notice ' + (late ? 'bad' : 'warn') + ' anim-in" style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' + ic('file', 'sm') + '<div style="flex:1"><b>CVAE ' + y + ' : déclaration 1329-DEF et solde à payer ' + (late ? '— échéance du ' + fDM(due) + ' dépassée' : 'au plus tard le ' + fDM(due)) + '</b> · ' + l.length + ' dossier(s) : ' + names + '.</div><a class="btn sm" href="#/tva" data-act="cvae-go">Suivi CVAE</a></div>';
  }
  function cvaeSave(el) { S._cvaeChain = (S._cvaeChain || Promise.resolve()).then(() => cvaeSave1(el)).catch(() => { }); return S._cvaeChain; }
  async function cvaeSave1(el) {
    const c = clientOf(el.dataset.id); if (!c) return;
    const y = String(cvaeYear()), k = el.dataset.k;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'amount') { v = String(v).replace(',', '.').trim(); if (v !== '' && !(Number(v) >= 0)) { toast('Montant invalide', 'warn'); return; } v = v === '' ? null : Number(v); }
    if (k === 'comment') v = String(v).trim();
    if (k === 'filed' || k === 'paid') v = el.dataset.v === '1' ? today() : null;
    const all = Object.assign({}, c.cvae_suivi || {}); all[y] = Object.assign({}, all[y] || {}, { [k]: v });
    await saveUpdate('clients', c.id, { cvae_suivi: all }, { quiet: true, history: { action: 'dossier', entity: 'client', entity_id: c.id, client_id: c.id, detail: { text: 'CVAE ' + y + ' : ' + k + ' modifié' } } });
  }
  function cvaeSection() {
    const y = cvaeYear(), td = today(), due = cvaeDue(y), cls = cvaeClients(), ro = S.readonly ? ' disabled' : '';
    const open = td >= y + '-05-01', late = td > due;
    const toFile = cls.filter(c => !cvaeOf(c, y).filed).length, toPay = cls.filter(c => { const e = cvaeOf(c, y); return !e.paid && Number(e.amount) > 0; }).length;
    const btn = (c, k, on, lbl, offLbl) => on ? '<span class="badge g">' + offLbl + ' ' + fDM(on) + '</span>' + (S.readonly ? '' : ' <button class="btn sm" data-act="cvae-set" data-id="' + c.id + '" data-k="' + k + '" data-v="0" title="Annuler">↺</button>') : (S.readonly ? '<span class="badge o">' + lbl + '</span>' : '<button class="btn sm is-pay" data-act="cvae-set" data-id="' + c.id + '" data-k="' + k + '" data-v="1">' + lbl + '</button>');
    const row = c => {
      const e = cvaeOf(c, y), amt = e.amount === undefined || e.amount === null ? '' : e.amount;
      const st = cvaeDone(e) ? '<span class="badge g">À jour</span>' : late ? '<span class="badge r">Échéance dépassée</span>' : open ? '<span class="badge o">À faire avant le ' + fDM(due) + '</span>' : '<span class="badge">Pour le ' + fDM(due) + '</span>';
      return '<tr id="cvae-r-' + c.id + '"><td><b>' + esc(c.name) + '</b><div class="small muted">' + esc((collabOf(c.collaborator_id) || {}).name || '') + '</div></td><td>' + st + '</td>'
        + '<td class="nowrap">' + btn(c, 'filed', e.filed, 'À déposer', 'Déposée le') + '</td>'
        + '<td><input type="number" min="0" step="1" inputmode="decimal" placeholder="€" data-ch="cvae-in" data-id="' + c.id + '" data-k="amount" value="' + esc(amt) + '"' + ro + ' style="width:110px"></td>'
        + '<td class="nowrap">' + (amt === '' ? '<span class="small muted">montant à saisir</span>' : Number(amt) === 0 ? '<span class="small muted">rien à payer</span>' : btn(c, 'paid', e.paid, 'À payer', 'Payé le')) + '</td>'
        + '<td><input type="text" data-ch="cvae-in" data-id="' + c.id + '" data-k="comment" value="' + esc(e.comment || '') + '" placeholder="Commentaire"' + ro + ' style="width:100%;min-width:160px"></td></tr>';
    };
    const pg = cls.length > FIL_PER ? (() => { const n = Math.ceil(cls.length / FIL_PER); S.cvaePage = Math.min(Math.max(1, S.cvaePage || 1), n); return { n, p: S.cvaePage }; })() : null;
    const shown = pg ? cls.slice((pg.p - 1) * FIL_PER, pg.p * FIL_PER) : cls;
    const pager = pg ? '<div class="fil-pager bottom"><span class="small muted">' + ((pg.p - 1) * FIL_PER + 1) + '–' + Math.min(cls.length, pg.p * FIL_PER) + ' sur ' + cls.length + '</span><span class="spacer"></span><button class="btn sm" data-act="cvae-page" data-d="-1"' + (pg.p <= 1 ? ' disabled' : '') + '>' + ic('chevL', 'sm') + 'Précédent</button><span class="small"><b>' + pg.p + '</b> / ' + pg.n + '</span><button class="btn sm primary" data-act="cvae-page" data-d="1"' + (pg.p >= pg.n ? ' disabled' : '') + '>Suivant' + ic('chevR', 'sm') + '</button></div>' : '';
    const body = cls.length
      ? '<div style="overflow-x:auto"><table class="tbl cfe-tbl"><thead><tr><th>Client</th><th>Statut</th><th>Déclaration 1329-DEF</th><th>Solde à payer</th><th>Paiement</th><th>Commentaire</th></tr></thead><tbody>' + shown.map(row).join('') + '</tbody></table></div>' + pager
      : '<div class="empty">Aucun dossier suivi. Cochez « Suivi CVAE » dans la fiche du dossier.</div>';
    return '<div class="section-t" style="margin-top:var(--gap)"><h2>Suivi CVAE</h2><span class="muted small">déclaration 1329-DEF et solde au plus tard le 5 mai · rappel à partir du 1er mai</span></div>'
      + '<div class="frame cfe-card tva-frame"><div class="frame-h">' + ic('file') + '<h2>CVAE ' + y + '</h2>'
      + (cls.length ? '<span class="badge">' + cls.length + ' dossier(s)</span>' : '') + (cls.length ? '<span class="badge ' + (toFile ? 'o' : 'g') + '">' + toFile + ' à déposer</span>' : '') + (toPay ? '<span class="badge o">' + toPay + ' à payer</span>' : '')
      + '<span class="spacer"></span><button class="btn icon sm" data-act="cvae-year" data-d="-1" aria-label="Année précédente">' + ic('chevL', 'sm') + '</button><b>' + y + '</b><button class="btn icon sm" data-act="cvae-year" data-d="1" aria-label="Année suivante">' + ic('chevR', 'sm') + '</button></div>'
      + '<div class="inner">' + body + '</div></div>';
  }
  function cvaeSectionF() {
    const y = cvaeYear(), cls = cvaeClients(), left = cls.filter(c => !cvaeDone(cvaeOf(c, y))).length;
    return foldSec('cvae', cvaeSection(), '<b>' + cls.length + '</b> dossier(s) suivi(s) · ' + left + ' à traiter avant le ' + fDM(cvaeDue(y)));
  }
  /* ====================== Événements ====================== */
  const ACT = {
    refresh: () => refreshAll(),
    reload: e => { location.reload(); },
    retry: () => retryFailed(),
    logout: async () => { if (S.failed.length && !await confirmBox('Modifications non enregistrées', '<p>' + S.failed.length + ' modification(s) ne sont pas enregistrées et seront perdues.</p>', 'Se déconnecter quand même', true)) return; lsDel(CACHE_KEY); await S.store.signOut(); location.hash = ''; location.reload(); },
    collab: el => { S.collabId = el.dataset.id || null; S.todayTeam = false; lsSet('planif-collab', S.collabId || ''); render(); },
    'today-team': () => { S.todayTeam = true; render(); }, // V26.190 : Aujourd'hui — toute l'équipe dans les cartes
    month: el => { S.month = E.addMonths(S.month, Number(el.dataset.d)); clampToStart(); S.recSel.clear(); shownCounts.clear(); ensureMonth(S.month); render(); }, // changement de mois : les chiffres repartent de 0 (V26.168 : jamais avant le début d'utilisation)
    pmode: el => { // V26.163 : de la vue Semaine à la vue Jour → premier jour (ouvré) de la semaine affichée
      if (el.dataset.m === 'day' && S.planMode === 'week') { const d = E.nextWorkday(E.startOfWeek(S.cursor)); S.cursor = E.startOfWeek(d) === E.startOfWeek(S.cursor) ? d : E.startOfWeek(S.cursor); S.month = S.cursor.slice(0, 7); }
      S.planMode = el.dataset.m; render();
    },
    'is-calc': el => { isLoad(el.dataset.id, isCurrentClose(clientOf(el.dataset.id))); openSheet({ type: 'isCalc', wide: true }); }, // V26.133 : calcul dans une carte centrée
    'is-paid': el => { isSetPaid(el); },
    'is-page': el => { S.isPage = (S.isPage || 1) + Number(el.dataset.d); render(); },
    'rec-page': el => { const k = 'recPage_' + el.dataset.k; S[k] = (S[k] || 1) + Number(el.dataset.d); if (el.dataset.k === 'h' && $('#rec-home') && S._recHome) { $('#rec-home').innerHTML = recHomeList(S._recHome.recs, S._recHome.d); return; } render(); }, // V26.148
    'fil-page': el => { S.filPage = (S.filPage || 1) + Number(el.dataset.d); render(); },
    'cfe-year': el => { S.cfeYear = cfeYear() + Number(el.dataset.d); render(); }, // V26.127 : suivi CFE
    'cfe-go': () => { S.cfeYear = null; },
    'fold': el => toggleFold(el.dataset.k), // V26.135 : cartes repliables
    'cvae-set': el => { cvaeSave(el); },
    'cvae-year': el => { S.cvaeYear = cvaeYear() + Number(el.dataset.d); render(); },
    'cvae-go': () => { S.cvaeYear = null; lsSet('jbflow-fold-cvae', '0'); },
    'cvae-page': el => { S.cvaePage = (S.cvaePage || 1) + Number(el.dataset.d); render(); },
    'cfe-paid': el => { cfeSetPaid(el); }, // V26.130
    'cfe-row': el => cfeGoRow(el.dataset.id),
    'is-row': el => { const id = el.dataset.id; closeSheet(true); if (S.route !== 'tva') go('tva'); isLoad(id, isCurrentClose(clientOf(id))); setTimeout(() => openSheet({ type: 'isCalc', wide: true }), 60); },
    'is-ex': el => { const st = S.isCalc; if (!st) return; isLoad(st.client, isClosing(clientOf(st.client), Number(st.close.slice(0, 4)) + Number(el.dataset.d))); render(); },
    'is-save': () => isSave(false),
    'is-clear': () => isSave(true),
    'fil-detail': el => openSheet({ type: 'filDetail', k: el.dataset.k, m: el.dataset.m, wide: true }),
    'prod-detail': el => openSheet({ type: 'prodDetail', k: el.dataset.k, wide: true }),
    'recall-tg': () => { S.recAll = !S.recAll; render(); },
    nav: el => {
      const d = Number(el.dataset.d);
      if (!d) S.cursor = weekday(today());
      else if (S.planMode === 'day') { let c = E.addDays(S.cursor, d); while (E.dow(c) >= 6) c = E.addDays(c, d); S.cursor = c; } // saute le week-end
      else if (S.planMode === 'week') S.cursor = E.addDays(S.cursor, 7 * d);
      else S.cursor = E.addMonths(S.cursor.slice(0, 7), d) + '-01';
      clampToStart(); // V26.168
      if (S.cursor.slice(0, 7) !== S.month) shownCounts.clear();
      S.month = S.cursor.slice(0, 7); ensureMonth(S.month); render();
    },
    goday: (el, e) => { e.preventDefault(); S.cursor = el.dataset.date; S.month = S.cursor.slice(0, 7); S.planMode = 'day'; S.keepMode = true; go('planning'); },
    trange: el => { S.teamRange = el.dataset.r; render(); },
    tnav: el => {
      const d = Number(el.dataset.d);
      if (S.teamRange === 'week') S.cursor = d ? E.addDays(S.cursor, 7 * d) : today();
      else { S.month = d ? E.addMonths(S.month, d) : defaultMonth(); shownCounts.clear(); ensureMonth(S.month); }
      clampToStart(); // V26.168
      render();
    },
    teamcell: el => { S.collabId = el.dataset.c; S.planAll = false; S.cursor = el.dataset.date; S.month = S.cursor.slice(0, 7); S.planMode = 'day'; S.keepMode = true; go('planning'); },
    'collab-plan': el => { S.collabId = el.dataset.id; S.planAll = false; S.planMode = 'month'; S.keepMode = true; S.cursor = S.month + '-01'; go('planning'); },
    task: el => openSheet({ type: 'task', id: el.dataset.id }),
    done: async (el, e) => { e.stopPropagation(); const t = S.data.tasks.get(el.dataset.id); if (!t) return; const inSheet = !!el.closest('.sheet'), was = t.done; const r = await finishTask(t); if (inSheet && !was && r === 'ok' && S.sheet && S.sheet.type === 'task') closeSheet(); },
    group: el => { const p = el.dataset.key.split(':'); openSheet({ type: 'group', pid: p[1], date: p[2], cid: p[3] }); },
    'done-group': (el, e) => { e.stopPropagation(); finishGroup(groupFromKey(el.dataset.key)); },
    'lock-group': el => lockGroup(groupFromKey(el.dataset.key)),
    ir: el => setInfoRequest(el.dataset.pid, el.dataset.v).then(r => { if (r === 'ok') toast(IR_LABEL[el.dataset.v] + ' — enregistré.', 'ok', null, 2500); }),
    lock: el => { const t = S.data.tasks.get(el.dataset.id); if (t) toggleLock(t); },
    alert: el => {
      if (el.dataset.task) openSheet({ type: 'task', id: el.dataset.task });
      else if (el.dataset.collab && el.dataset.date) { S.collabId = el.dataset.collab; S.planAll = false; S.cursor = el.dataset.date; S.planMode = 'day'; S.keepMode = true; go('planning'); }
      else if (el.dataset.collab) go('dashboard');
      else if (el.dataset.client) openSheet({ type: 'client', id: el.dataset.client });
    },
    close: () => closeSheet(),
    overlay: (el, e) => { if (e.target === el) closeSheet(); },
    generate: el => generateMonth(el.dataset.m),
    replan: el => openReplan(el.dataset.m, el.dataset.opt === '1'), // V26.186 : « Optimiser le planning » depuis le Planning
    'pc-reset': () => { S.pf = { kind: '', client: '', status: '', q: '' }; render(); },
    'rb-open': el => { const props = rebalanceProps(el.dataset.m); openSheet({ type: 'rebal', m: el.dataset.m, props, sel: new Set(props.map(x => x.task_id)), wide: true }); },
    'rb-all': el => { const s = S.sheet; if (!s || s.type !== 'rebal') return; s.sel = el.dataset.v === '1' ? new Set(s.props.map(x => x.task_id)) : new Set(); renderSheet(); },
    'rb-apply': () => applyRebalance(),
    'diag-run': () => { if (isAdmin()) runDiagnostic(); }, // V26.120 : diagnostic réservé à l'administrateur
    tour: () => offerDemo(false), // V26.125 : bac à sable fictif, jamais les vraies données
    'diag-copy': async () => { const s = S.sheet; if (!s || !s.res) return; const txt = 'Diagnostic JB Flow — ' + (CFG.APP_VERSION || '') + ' — ' + new Date().toLocaleString('fr-FR') + '\n' + s.res.map(r => ({ ok: '[OK] ', warn: '[ATTENTION] ', bad: '[PROBLÈME] ', info: '[INFO] ' }[r.lvl]) + r.group + ' : ' + r.title + (r.detail ? ' — ' + r.detail : '')).join('\n'); try { await navigator.clipboard.writeText(txt); toast('Rapport copié : collez-le dans un message.', 'ok', null, 3000); } catch (e) { toast('Copie impossible dans ce navigateur.', 'warn'); } },
    'failed-drop': async el => { S.failed = S.failed.filter(x => !(x.table === el.dataset.t && x.id === el.dataset.id)); await refreshAll(); renderSheet(); toast('Modification abandonnée : valeurs enregistrées rétablies.', 'ok', null, 3000); },
    'ms-detail': el => openSheet({ type: 'msDetail', m: el.dataset.m, wide: true }),
    'replan-apply': () => applyReplan(),
    'rec-validate': () => validateReceptions([...S.recSel], S.route === 'receptions' ? S.recDate : today()),
    'rec-all': () => { list('productions').filter(p => p.month === S.month && !p.received_date).forEach(p => { const c = clientOf(p.client_id); if (c && (S.recAll || !S.me.collaborator_id || c.collaborator_id === S.me.collaborator_id)) S.recSel.add(p.id); }); render(); },
    'rec-undo': el => undoReception(el.dataset.id),
    'rec-one': el => validateReceptions([el.dataset.id], today()),
    'rec-part': (el, e) => { e.preventDefault(); e.stopPropagation(); receivePartial(el.dataset.id); },
    cview: el => { S.clientView = el.dataset.v; render(); },
    client: el => openSheet({ type: 'client', id: el.dataset.id }),
    'client-new': () => openSheet({ type: 'client', draft: { name: '', collaborator_id: S.clientCollab || null, frequency: 'mensuel', reception_day: 5, time_min: 0, vat_due_day: 19, priority: 2, notes: '' } }),
    'client-create': () => createClient(),
    'client-del': async el => { const c = clientOf(el.dataset.id); if (c && await confirmBox('Supprimer le dossier ?', '<p>Le dossier <b>' + esc(c.name) + '</b> et toute sa production (tous les mois) seront supprimés définitivement. Pour simplement l\'arrêter, décochez plutôt « Dossier actif ».</p>', 'Supprimer', true)) { if (await saveRemove('clients', c.id)) { list('productions').filter(p => p.client_id === c.id).forEach(p => S.data.productions.delete(p.id)); list('tasks').filter(t => t.client_id === c.id).forEach(t => S.data.tasks.delete(t.id)); hist('dossier', { detail: { text: 'Suppression d\'un dossier' } }); closeSheet(); } } },
    'collab-new': () => openSheet({ type: 'collab', draft: { name: '', daily_capacity_min: 420, work_days: [1, 2, 3, 4, 5], color: COLORS[collabs(true).length % COLORS.length], active: true } }),
    'collab-edit': el => openSheet({ type: 'collab', id: el.dataset.id }),
    'collab-create': async () => {
      const d = S.sheet.draft;
      if (!d.name || !d.name.trim()) { toast('Le nom est obligatoire.', 'warn'); return; }
      try { const [c] = await saveInsert('collaborators', [Object.assign({ id: P.uuid() }, d, { name: d.name.trim() })]); hist('collaborateur', { entity: 'collaborator', entity_id: c.id, detail: { text: 'Création de ' + c.name } }); if (!S.collabId) S.collabId = c.id; closeSheet(); toast('Collaborateur « ' + c.name + ' » créé.', 'ok'); } catch (e) { /* message déjà affiché */ }
    },
    'collab-del': async el => { const c = collabOf(el.dataset.id); if (c && await confirmBox('Supprimer le collaborateur ?', '<p><b>' + esc(c.name) + '</b> sera supprimé. Ses dossiers et tâches n\'auront plus de collaborateur. Pour conserver l\'historique, préférez « Actif » décoché.</p>', 'Supprimer', true)) { if (await saveRemove('collaborators', c.id)) { list('absences').filter(a => a.collaborator_id === c.id).forEach(a => S.data.absences.delete(a.id)); closeSheet(); await refreshAll(); } } },
    /* V26.74 : calendrier de présence de l'apprenti */
    'pres-year': el => { S.presYear = (S.presYear || Number(today().slice(0, 4))) + Number(el.dataset.d); renderSheet(); },
    'pres-day': el => presSave(set => { const d = el.dataset.d; if (set.has(d)) set.delete(d); else set.add(d); }),
    'pres-dow': el => presSave(set => {
      const y = S.presYear || Number(today().slice(0, 4)), w = Number(el.dataset.w);
      const ds = E.rangeDates(y + '-01-01', y + '-12-31').filter(d => E.dow(d) === w && !E.holidayName(d));
      const all = ds.every(d => set.has(d)); ds.forEach(d => all ? set.delete(d) : set.add(d));
    }),
    'pres-clear': async el => { const y = String(S.presYear || today().slice(0, 4)); if (!await confirmBox('Effacer les jours de présence', '<p>Tous les jours de présence de ' + y + ' seront effacés.</p>', 'Effacer', true)) return; presSave(set => [...set].filter(d => d.startsWith(y + '-')).forEach(d => set.delete(d))); },
    'abs-add': async el => {      const from = $('#abs-from').value, to = $('#abs-to').value || from, kind = $('#abs-kind').value, mt = $('#abs-min').value.trim(), note = $('#abs-note').value.trim();
      if (!from) { toast('Indiquez la date de début.', 'warn'); return; }
      if (kind === 'autre' && !note) { toast('Précisez le motif de l\'indisponibilité (ex. séminaire).', 'warn'); return; }
      if (to < from) { toast('La date de fin précède la date de début.', 'warn'); return; }
      const minutes = mt ? E.parseDuration(mt) : null;
      if (mt && isNaN(minutes)) { toast('Durée illisible.', 'warn'); return; }
      try { await saveInsert('absences', [{ id: P.uuid(), collaborator_id: el.dataset.id, date_from: from, date_to: to, kind, minutes, note: note || null }]); hist('collaborateur', { entity: 'collaborator', entity_id: el.dataset.id, detail: { text: 'Indisponibilité ' + fDMY(from) + ' → ' + fDMY(to) } }); const n = await replanAbsence(el.dataset.id, from, to); toast('Indisponibilité ajoutée' + (n ? ' : ' + n + ' dossier(s) replacé(s) sur d\'autres jours.' : '.'), 'ok'); render(); } catch (e) { /* affiché */ }
    },
    'abs-del': async el => { if (await saveRemove('absences', el.dataset.id)) toast('Indisponibilité supprimée.', 'ok'); },
    'user-new': () => openSheet({ type: 'user', draft: { name: '', email: '', role: 'collab', collaborator_id: null, active: true } }),
    'start-edit': () => { if (isManager() && !S.readonly) askStartMonth(true); }, // V26.169 : revenir sur le mois de début si on s'est trompé
    'user-edit': el => openSheet({ type: 'user', id: el.dataset.id }),
    'user-create': async () => {
      const d = S.sheet.draft, email = (d.email || '').trim().toLowerCase();
      if (!d.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Nom et e-mail valide obligatoires.', 'warn'); return; }
      if (list('app_users').some(u => u.email.toLowerCase() === email)) { toast('Cet e-mail existe déjà.', 'warn'); return; }
      const { start: st0, ...row } = d, member = !['manager', 'admin'].includes(d.role || 'collab'), st = member ? (st0 || defaultMonth()) : '';
      try {
        await saveInsert('app_users', [Object.assign({ id: P.uuid() }, row, { email, active: true })]); hist('utilisateur', { detail: { text: 'Ajout de ' + email } });
        if (st) await setUserStart(email, st); // V26.168 : son début d'utilisation (première période de TVA)
        closeSheet(); toast('Utilisateur ajouté' + (st ? ', début d\'utilisation ' + fMonth(st) : '') + '. Envoyez-lui le lien de l\'application.', 'ok');
      } catch (e) { /* affiché */ }
    },
    import: () => openSheet({ type: 'import', wide: true }),
    'import-go': () => doImport(),
    template: () => downloadTemplate().catch(e => toast(errMsg(e), 'bad')),
    print: () => window.print(),
    'exp-xlsx': () => exportXlsx(S.month).catch(e => toast(errMsg(e), 'bad')),
    'exp-csv': () => download('planning_' + S.month + '.csv', toCsv(taskExportRows(S.month)), 'text/csv;charset=utf-8'),
    'exp-pdf': () => { S.planMode = 'month'; S.keepMode = true; S.cursor = S.month + '-01'; go('planning'); setTimeout(() => window.print(), 400); },
    'exp-all-json': async () => { try { download('sauvegarde_planification_' + today() + '.json', JSON.stringify(await fullDump(), null, 1), 'application/json'); } catch (e) { toast('Export impossible : ' + errMsg(e), 'bad'); } },
    'exp-all-xlsx': async () => { try { const XLSX = await needXLSX(), d = await fullDump(), wb = XLSX.utils.book_new(); Object.keys(d.tables).forEach(t => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.tables[t].map(r => { const o = {}; for (const k in r) o[k] = r[k] !== null && typeof r[k] === 'object' ? JSON.stringify(r[k]) : r[k]; return o; })), t.slice(0, 31))); XLSX.writeFile(wb, 'sauvegarde_planification_' + today() + '.xlsx'); } catch (e) { toast('Export impossible : ' + errMsg(e), 'bad'); } },
    'search-csv': () => download('recherche_' + today() + '.csv', toCsv(searchTasks().map(t => ({ Date: fDMY(t.planned_date), Collaborateur: (collabOf(t.collaborator_id) || {}).name || '', Client: (clientOf(t.client_id) || {}).name || '', Mission: E.KIND_LABEL[t.kind], Durée: E.fmtMin(t.duration_min), Terminée: t.done ? 'oui' : '', Verrouillée: t.locked ? 'oui' : '' }))), 'text/csv;charset=utf-8'),
    'hist-reload': () => { S.histCache = null; render(); },
    'hist-toggle': () => { S.sheet.showHist = true; renderSheet(); },
    'moves-toggle': () => { S.sheet.showMoves = true; renderSheet(); },
    'demo-reset': async () => { if (await confirmBox('Effacer la démo ?', '<p>Toutes les données de démonstration de ce navigateur seront effacées.</p>', 'Effacer', true)) { S.store.resetDemo(); sessionStorage.clear(); location.reload(); } }
  };
  const CH = {
    'rb-sel': el => { const s = S.sheet; if (!s || s.type !== 'rebal') return; if (el.checked) s.sel.add(el.dataset.id); else s.sel.delete(el.dataset.id); renderSheet(); },
    recsel: el => { if (el.checked) S.recSel.add(el.dataset.id); else S.recSel.delete(el.dataset.id); render(); },
    recdate: el => { S.recDate = el.value; },
    recall: el => { S.recAll = el.checked; render(); },
    ccollab: el => { S.clientCollab = el.value; render(); },
    // V26.186 : filtres du Planning (équipe / une personne, type, dossier, statut)
    'pc-who': el => { if (el.value) { S.planAll = false; S.collabId = el.value; lsSet('planif-collab', el.value); } else S.planAll = true; render(); },
    'pc-mall': el => { S.pcMonthAll = !!el.value; render(); }, // V26.193 : mois en cours, afficher aussi les premiers jours
    'pc-f': el => { S.pf = Object.assign({}, S.pf, { [el.dataset.k]: el.value }); render(); },
    cfilter: el => { S.cf = Object.assign({}, S.cf, { [el.dataset.k]: el.value }); render(); },
    filter: el => { S.filters[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; render(); },
    't-date': el => { const t = S.data.tasks.get(el.dataset.id); if (t && el.value !== (t.planned_date || '')) moveTask(t, el.value || null); },
    't-collab': el => { const t = S.data.tasks.get(el.dataset.id); if (!t || !canEditTask(t) || t.locked || (el.value && !canSeeCollab(el.value))) return; const from = (collabOf(t.collaborator_id) || {}).name, to = (collabOf(el.value) || {}).name; saveUpdate('tasks', t.id, { collaborator_id: el.value || null, seq: t.planned_date && el.value ? nextSeq(el.value, t.planned_date) : t.seq }, { history: { action: 'changement_collaborateur', entity: 'task', entity_id: t.id, client_id: t.client_id, detail: { kind: t.kind, from_name: from, to_name: to } } }); },
    't-dur': el => { const t = S.data.tasks.get(el.dataset.id); if (!t || t.locked) return; const n = E.parseDuration(el.value); if (isNaN(n) || n <= 0) { toast('Durée illisible (ex. 1h30, 45 min).', 'warn'); renderSheet(); return; } if (n !== t.duration_min) saveUpdate('tasks', t.id, { duration_min: n }, { history: { action: 'modification_temps', entity: 'task', entity_id: t.id, client_id: t.client_id, detail: { kind: t.kind, from_min: t.duration_min, to_min: n } } }); },
    'rc-note': el => saveRecapNote(el),
    'rc-th': el => { const s = S.sheet; if (!s || s.type !== 'tvaRecap') return; const k = el.dataset.k; if (k === 'st') s.f = el.value || 'all'; else if (k === 'due') s.fDue = el.value; else s.fNote = el.value; renderSheet(); }, // V26.165
    'imp-cfe': el => { if (S.sheet) S.sheet.cfeAll = el.checked; }, // V26.165
    'cfe-in': el => { cfeSave(el); },
    'cvae-in': el => { cvaeSave(el); },
    'is-in': el => { S.isCalc.v[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; render(); },
    'is-man': el => { const v = S.isCalc.v; v.man = v.man || {}; v.man[el.dataset.i] = el.value === '' ? '' : Number(el.value); render(); },
    'c-field': el => {
      const k = el.dataset.k, s = S.sheet; let v = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'new_since') v = el.checked ? today() : null; // V26.49 : coche « nouveau dossier »
      if (!s.id) { try { s.draft[k] = parseField(k, v); } catch (e) { toast(e.message, 'warn'); } renderSheet(); return; }
      const c = clientOf(s.id); if (c) saveClientField(c, k, v);
    },
    'co-field': el => { const s = S.sheet, c = s.id ? collabOf(s.id) : s.draft; if (c) saveCollabField(c, el.dataset.k, el.type === 'checkbox' ? el.checked : el.value); },
    'co-day': el => {
      const s = S.sheet, c = s.id ? collabOf(s.id) : s.draft; if (!c) return;
      const d = Number(el.dataset.d), days = new Set(c.work_days || []); if (el.checked) days.add(d); else days.delete(d);
      const wd = [...days].sort();
      if (!s.id) { s.draft.work_days = wd; renderSheet(); return; }
      saveUpdate('collaborators', c.id, { work_days: wd }, { history: { action: 'collaborateur', entity: 'collaborator', entity_id: c.id, detail: { text: c.name + ' : jours travaillés' } } });
    },
    'u-field': el => {
      const s = S.sheet, k = el.dataset.k, v = el.type === 'checkbox' ? el.checked : (el.value || (k === 'collaborator_id' ? null : ''));
      if (!s.id) { s.draft[k] = v; if (k === 'role') renderSheet(); return; } // V26.168 : le champ « Début d'utilisation » suit le rôle
      const u = S.data.app_users.get(s.id); if (!u) return;
      const admins = list('app_users').filter(x => x.role === 'admin' && x.active);
      if (((k === 'role' && v !== 'admin') || (k === 'active' && !v)) && u.role === 'admin' && admins.length <= 1) { toast('Impossible : il doit rester au moins un administrateur actif.', 'warn'); renderSheet(); return; }
      saveUpdate('app_users', u.id, { [k]: v }, { history: { action: 'utilisateur', detail: { text: u.email + ' : ' + k + ' modifié' } } });
    },
    'u-start': async el => { // V26.168 : début d'utilisation propre à l'utilisateur (vide = comme le cabinet)
      const s = S.sheet; if (!s) return;
      if (!s.id) { s.draft.start = el.value; return; }
      const u = S.data.app_users.get(s.id); if (!u) return;
      if (await setUserStart(u.email, el.value)) toast('Début d\'utilisation de ' + u.name + ' : ' + (el.value ? fMonth(el.value) : 'comme le cabinet') + '.', 'ok', null, 3000);
    },
    setting: el => {
      const k = el.dataset.k; let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number') v = Number(v);
      if (k === 'info_request_min') { v = E.parseDuration(v); if (isNaN(v) || v <= 0) { toast('Durée illisible (ex. 45 min).', 'warn'); render(); return; } }
      if (k === 'quarter_months') v = String(v).split(/[^0-9]+/).map(Number).filter(n => n >= 1 && n <= 12);
      if (k === 'start_month') { v = String(v || '').trim(); if (v && !/^\d{4}-\d{2}$/.test(v)) { toast('Format attendu : AAAA-MM (ex. 2026-10).', 'warn'); render(); return; } } // V26.164
      const cur = S.data.settings.get('planning');
      const value = Object.assign({}, cfg(), { [k]: v });
      if (value.start_day >= value.end_day) { toast('Le début de période doit précéder la fin.', 'warn'); render(); return; }
      if (k === 'info_request_min' && isManager()) setTimeout(() => toast('Durée des demandes d\'informations mise à jour : elle s\'applique aux nouvelles demandes.', 'ok', null, 5000), 300);
      if (cur) saveUpdate('settings', 'planning', { value }, { history: { action: 'parametres', detail: { text: k + ' = ' + JSON.stringify(v) } } }).then(r => { if (r === 'ok' && k === 'agent_enabled' && v) runAgent().then(() => render()); });
      else saveInsert('settings', [{ id: 'planning', value }]).catch(() => { });
    },
    'import-file': async el => {
      const f = el.files[0]; if (!f) return;
      const s = S.sheet; s.loading = true; s.error = null; s.imp = null; renderSheet();
      try { s.imp = await readImportFile(f); if (!s.imp.rows.length) s.error = 'Aucune ligne de dossier trouvée.'; } catch (e) { s.error = 'Lecture impossible : ' + errMsg(e); }
      s.loading = false; renderSheet();
    },
    'imp-cc': el => { S.sheet.imp.createCollabs = el.checked; },
    'team-field': el => { const tm = S.sheet && S.data.teams.get(S.sheet.id); if (!tm) return; const k = el.dataset.k, v = k === 'manager_id' ? (el.value || null) : el.value.trim(); if (k === 'name' && !v) { toast('Le nom est obligatoire.', 'warn'); renderSheet(); return; } saveUpdate('teams', tm.id, { [k]: v }, { history: { action: 'parametres', detail: { text: 'Équipe ' + tm.name + ' : ' + (k === 'name' ? 'renommée' : 'manager modifié') } } }); },
    'team-member': el => { const tm = S.sheet && S.data.teams.get(S.sheet.id), c = collabOf(el.dataset.id); if (!tm || !c) return; saveUpdate('collaborators', c.id, { team_id: el.checked ? tm.id : null }, { history: { action: 'collaborateur', entity: 'collaborator', entity_id: c.id, detail: { text: c.name + (el.checked ? ' rejoint ' : ' quitte ') + tm.name } } }); },
    'replan-force': el => { const s = S.sheet; if (!s || s.type !== 'replan') return; s.force = el.checked; s.result = replanFor(s.month, s.force); s.showMoves = false; renderSheet(); },
    'hist-file': async el => {
      const f = el.files[0]; if (!f) return;
      const s = S.sheet; s.loading = true; s.error = null; s.imp = null; renderSheet();
      try { s.imp = await readHistoryFile(f); if (!s.imp.rows.length) s.error = 'Aucune ligne trouvée.'; } catch (e) { s.error = 'Lecture impossible : ' + errMsg(e); }
      s.loading = false; renderSheet();
    },
    'rl-tone': el => { const s = S.sheet; if (!s) return; s.tone = el.checked ? 'tu' : 'vous'; renderSheet(); },
    'rl-tpl': el => { const s = S.sheet; if (!s) return; s.tplId = el.value; const p = S.data.productions.get(s.pid); s.texts = relanceTexts(s.tplId, p); if (isDossierTpl(S.data.message_templates.get(s.tplId))) { if (p) lsSet('planif-relance-tpl:' + p.client_id, s.tplId); } else if (s.tplId !== 'client') lsSet('planif-relance-tpl', s.tplId); renderSheet(); }, // V26.167 : modèle de dossier retenu pour ce dossier
    'rl-text': el => { const s = S.sheet; if (s && s.texts) s.texts[s.tone] = el.value; },
    'rl-name': el => { if (S.sheet) S.sheet.saveName = el.value; },
    'g-date': async el => {
      const ts = groupFromKey(el.dataset.key); if (!ts.length || el.value === (ts[0].planned_date || '')) return;
      if (S.sheet && S.sheet.type === 'group') S.sheet.date = el.value;
      await moveGroup(ts, el.value || null);
    },
    restore: async el => {
      const f = el.files[0]; if (!f) return;
      let d; try { d = JSON.parse(await f.text()); } catch (e) { toast('Fichier JSON illisible.', 'bad'); return; }
      if (!d || d.app !== 'planification-tva' || !d.tables) { toast('Ce fichier n\'est pas une sauvegarde de cette application.', 'bad'); return; }
      const counts = P.TABLES.map(t => t + ' : ' + ((d.tables[t] || []).length)).join('<br>');
      if (!await confirmBox('Restaurer la sauvegarde ?', '<p>Sauvegarde du ' + esc(fDateTime(d.exported_at)) + '</p><p class="small">' + counts + '</p><p>Les lignes de même identifiant seront remplacées.</p>', 'Restaurer', true)) return;
      try {
        for (const t of ['settings', 'collaborators', 'app_users', 'clients', 'absences', 'productions', 'tasks']) {
          const rows = d.tables[t] || [];
          for (let i = 0; i < rows.length; i += 200) await S.store.upsert(t, rows.slice(i, i + 200));
        }
        hist('restauration', { detail: { text: 'Sauvegarde du ' + d.exported_at } });
        toast('Restauration terminée.', 'ok'); await refreshAll();
      } catch (e) { toast('Restauration interrompue : ' + errMsg(e), 'bad'); }
    }
  };
  const INP = {
    'rl-text': el => { const s = S.sheet; if (s && s.texts) s.texts[s.tone] = el.value; },
    'rl-name': el => { if (S.sheet) S.sheet.saveName = el.value; },
    // V26.176 : filtres en saisie — les lignes retirées disparaissent, les nouvelles arrivent en fondu, les autres glissent à leur place
    recq: el => { S.recQ = el.value; S.recPage_h = 1; const r = $('#rec-home'); if (r && S._recHome) fxSwap(r, recHomeList(S._recHome.recs, S._recHome.d)); }, // V26.157
    csearch: el => { S.clientSearch = el.value; const r = $('#results'); if (r) fxSwap(r, clientsTable()); },
    search: el => { S.search = el.value; const r = $('#results'); if (r) fxSwap(r, searchResults()); },
    'pc-q': el => { S.pf = Object.assign({}, S.pf, { q: el.value }); pcRefresh(); } // V26.186 : recherche du Planning
  };
  Object.assign(ACT, {
    motion: el => { const m = el.dataset.m; lsSet('planif-motion', m); if (m === 'system') delete document.documentElement.dataset.motion; else document.documentElement.dataset.motion = m; toast(m === 'always' ? 'Animations toujours actives sur cet appareil.' : m === 'reduced' ? 'Animations réduites sur cet appareil.' : 'Animations selon le réglage de l\'appareil.', 'ok', null, 2500); render(); },
    file: (el, e) => { e.stopPropagation(); setFiling(el.dataset.pid, el.dataset.code, el.dataset.via); },
    'adjust-time': async el => { const c = clientOf(el.dataset.id); if (!c || !isManager()) return; if (!await confirmBox('Ajuster le temps de production ?', '<p><b>' + esc(c.name) + '</b> : ' + E.fmtMin(E.clientTime(c)) + ' → <b>' + E.fmtMin(Number(el.dataset.v)) + '</b> (moyenne des temps réels).</p><p class="small muted">S\'applique aux dossiers non terminés du mois en cours et aux mois suivants.</p>', 'Ajuster')) return; saveClientField(c, 'time_min', E.fmtMin(Number(el.dataset.v))); },
    quick: el => { S.quick = S.quick === el.dataset.q ? '' : el.dataset.q; render(); },
    'close-month': el => closeMonth(el.dataset.m),
    'go-unpl': el => { S.quick = 'unpl'; S.cursor = el.dataset.m + '-01' < today() ? today() : el.dataset.m + '-01'; S.month = el.dataset.m; go('planning'); },
    tview: el => { S.teamView = el.dataset.v; lsSet('planif-teamview', S.teamView); if (S.teamView === 'gantt' && S.teamRange === 'week') S.teamRange = 'period'; render(); },
    transfer: el => transferTask(el.dataset.id, el.dataset.to),
    relance: async (el, e) => { e.preventDefault(); e.stopPropagation(); const pid = el.dataset.pid; await prepRelance(pid); openSheet({ type: 'relance', pid }); }, // V26.165 : texte mémorisé du client déchiffré avant l'ouverture
    'relance-tel': (el, e) => { e.preventDefault(); e.stopPropagation(); relanceTel(el.dataset.pid); },
    'rl-copy': () => copyRelance(),
    'rl-sent': el => { rememberClientText(S.sheet); relanceMail(el.dataset.id); }, // V26.150 (V26.165 : texte adapté mémorisé aussi ici)
    'rl-forget': () => forgetClientText(), // V26.165
    'rl-save': () => { S.sheet.saving = true; S.sheet.saveScope = S.sheet.saveScope || 'dossier'; renderSheet(); setTimeout(() => { const i = $('[data-ch=rl-name]'); if (i) i.focus(); }, 30); },
    'rl-scope': el => { if (!S.sheet) return; S.sheet.saveScope = el.dataset.v; renderSheet(); setTimeout(() => { const i = $('[data-ch=rl-name]'); if (i) i.focus(); }, 30); }, // V26.167 : ce dossier uniquement / tous mes dossiers
    'rl-save-cancel': () => { S.sheet.saving = false; renderSheet(); },
    'rl-save-ok': () => saveRelanceTemplate(false),
    'rl-update': () => saveRelanceTemplate(true),
    'rl-del': async () => { const s = S.sheet, t = s && S.data.message_templates.get(s.tplId); if (!t) return; const p = S.data.productions.get(s.pid); if (!await confirmBox('Supprimer le modèle ?', '<p>Le modèle <b>' + esc(tplLabel(t)) + '</b> sera supprimé.</p>', 'Supprimer', true)) return; if (await saveRemove('message_templates', t.id)) { s.tplId = ''; s.texts = relanceTexts('', p); lsDel(isDossierTpl(t) && p ? 'planif-relance-tpl:' + p.client_id : 'planif-relance-tpl'); renderSheet(); toast('Modèle supprimé.', 'ok', null, 2500); } },
    theme: el => setTheme(el.dataset.t),
    cur: el => { lsSet('planif-cur', el.dataset.m); document.documentElement.dataset.cur = el.dataset.m; render(); },
    drop: el => { lsSet('planif-drop', el.dataset.m); if (window.JBFlowCursor) window.JBFlowCursor.sync(); toast(el.dataset.m === 'off' ? 'Curseur goutte désactivé.' : el.dataset.m === 'solo' ? 'Goutte seule (thème Signature).' : 'Goutte activée (thème Signature).', 'ok', null, 2500); render(); },
    'theme-pick': el => { setTheme(el.dataset.t); lsSet('planif-theme-chosen:' + (S.me ? S.me.email.toLowerCase() : ''), '1'); const o = document.getElementById('theme-pick'); if (o) { o.classList.add('out'); setTimeout(() => o.remove(), FX.FAST); } toast('Ambiance « ' + ({ signature: 'Signature', clair: 'Clair', nuit: 'Aurora', iris: 'Iris' }[el.dataset.t]) + ' » choisie. Modifiable dans Paramètres › Apparence.', 'ok', null, 4000); },
    'side-pin': () => { S.navPinned = !S.navPinned; lsSet('planif-nav-pin', S.navPinned ? '1' : ''); render(); },
    drawer: () => { S.drawer = true; render(); },
    'drawer-close': () => { S.drawer = false; render(); },
    'side-mode': el => { if (el.dataset.m === 'dark' || el.dataset.m === 'color') { lsSet('planif-side', el.dataset.m); document.documentElement.dataset.side = el.dataset.m; } else { lsDel('planif-side'); delete document.documentElement.dataset.side; } render(); }, // V26.98 : menu latéral sombre en thème Clair
    accent: el => { const c = el.dataset.c; if (c === 'vert') { lsDel('planif-accent'); delete document.documentElement.dataset.accent; } else { lsSet('planif-accent', c); document.documentElement.dataset.accent = c; } render(); },
    'cfilter-reset': () => { S.cf = {}; S.clientCollab = ''; render(); },
    csort: el => { const k = el.dataset.k, so = S.csort || { k: 'name', d: 1 }; S.csort = { k, d: so.k === k ? -so.d : 1 }; render(); },
    'kpi-fold': el => { const k = el.dataset.k; let l = kpiFolded(); l = l.includes(k) ? l.filter(x => x !== k) : l.concat([k]); lsSet('planif-kpi-fold', JSON.stringify(l)); render(); },
    'go-route': el => go(el.dataset.r),
    'th-menu': (el, e) => { e.stopPropagation(); S.thMenu = S.thMenu === el.dataset.k ? null : el.dataset.k; const r = $('#results'); if (r) r.innerHTML = clientsTable(); },
    'th-sort': (el, e) => { e.stopPropagation(); S.csort = { k: el.dataset.k, d: Number(el.dataset.d) }; S.thMenu = null; render(); },
    'th-pick': (el, e) => { e.stopPropagation(); const k = el.dataset.k, v = el.dataset.v; if (k === 'collab') S.clientCollab = v; else S.cf = Object.assign({}, S.cf, { [{ freq: 'freq', tva: 'reg', prio: 'prio', st: 'st' }[k]]: v }); S.thMenu = null; render(); },
    'me-card': el => openMeCard(el),
    'view-as-off': () => toggleViewAs(),
    'view-user': el => viewAsUser(el.dataset.id), // V26.144
    'view-user-off': () => viewAsUser(null),
    'tva-recap': () => openSheet({ type: 'tvaRecap', wide: true }),
    'rc-f': el => { S.sheet.f = el.dataset.f; renderSheet(); },
    'task-split': (el, e) => { if (e) e.stopPropagation(); splitTask(el.dataset.id); }, // V26.165
    'rc-reset': () => { const s = S.sheet; if (!s) return; s.f = 'all'; s.fDue = ''; s.fNote = ''; renderSheet(); }, // V26.165
    'rc-open': el => { const t = list('tasks').find(x => x.production_id === el.dataset.id && x.kind !== 'info'); if (t) openSheet({ type: 'task', id: t.id }); },
    'rc-csv': () => recapCsv(),
    'is-recap': () => openSheet({ type: 'isRecap', wide: true }), // V26.129
    'cfe-recap': () => openSheet({ type: 'cfeRecap', wide: true }),
    'is-csv': () => isRecapCsv(),
    'cfe-csv': () => cfeRecapCsv(),
    'go-search': () => openPalette(), // V26.48 : palette de commandes (la recherche avancée y figure)
    goto: el => go(el.dataset.r),
    'agent-run': async el => { el.disabled = true; S.agent = null; S.past = null; const n = await runAgent({ silent: true }); toast(n ? 'Agent : ' + n + ' date(s) de réception ajustée(s), planning mis à jour.' : 'Agent à jour : aucune date de réception à ajuster.', 'ok'); render(); },
    'agent-dismiss': async el => { const d = Object.assign({}, agentState().dismissed || {}, { [el.dataset.id]: Number(el.dataset.v) }); await saveAgentState({ dismissed: d }); render(); },
    'see-month': el => { S.month = el.dataset.m; S.cursor = S.month + '-01'; S.planMode = 'month'; ensureMonth(S.month); go('planning'); },
    'hist-import': () => openSheet({ type: 'hist-import', wide: true }),
    'hist-template': () => downloadHistTemplate().catch(e => toast(errMsg(e), 'bad')),
    'hist-import-go': () => doHistImport(),
    'team-new': async () => { try { const [tm] = await saveInsert('teams', [{ id: P.uuid(), name: 'Équipe ' + (list('teams').length + 1), manager_id: null }]); hist('parametres', { detail: { text: 'Création de l\'équipe ' + tm.name } }); openSheet({ type: 'team', id: tm.id }); } catch (e) { /* affiché */ } },
    'team-filter': el => { S.teamFilter = el.dataset.id || ''; shownCounts.clear(); render(); },
    'team-edit': el => openSheet({ type: 'team', id: el.dataset.id }),
    'team-del': async el => { const tm = S.data.teams.get(el.dataset.id); if (!tm || !await confirmBox('Supprimer l\'équipe ?', '<p>L\'équipe <b>' + esc(tm.name) + '</b> sera supprimée. Ses membres restent, sans équipe.</p>', 'Supprimer', true)) return; if (await saveRemove('teams', tm.id)) { list('collaborators').filter(c => c.team_id === tm.id).forEach(c => S.data.collaborators.set(c.id, Object.assign({}, c, { team_id: null }))); closeSheet(); } },
    'crypto-enable': () => enableCrypto().catch(e => toast('Chiffrement impossible : ' + errMsg(e), 'bad')),
    'crypto-forget': async () => { if (await confirmBox('Oublier la phrase sur cet appareil ?', '<p>La phrase secrète sera redemandée à la prochaine ouverture de JB Flow sur cet appareil.</p><div class="notice warn small"><b>Attention</b> : si tu ne connais plus la phrase, ne fais pas cela. Utilise d\'abord « Changer la phrase secrète » tant que cet appareil est déverrouillé.</div>', 'Oublier', true)) { lsDel('planif-ck'); lsDel('planif-ck-alt'); toast('La phrase sera redemandée à la prochaine ouverture.', 'ok'); } },
    'crypto-change': () => changePassphrase().catch(e => toast('Changement impossible : ' + errMsg(e), 'bad')),
    'crypto-check': () => verifyCrypto().catch(e => toast('Vérification impossible : ' + errMsg(e), 'bad')),
    'dash-pub': async (el, e) => { e.stopPropagation(); const t = S.data.tasks.get(el.dataset.id); if (!t || !canEditTask(t)) return; if (!t.done) { toast('Termine d\'abord le tableau de bord.', 'warn'); return; } const v = t.published_at ? null : new Date().toISOString(); const r = await saveUpdate('tasks', t.id, { published_at: v }, { history: { action: 'depot', entity: 'task', entity_id: t.id, client_id: t.client_id, detail: { text: v ? 'Tableau de bord publié' : 'Publication annulée' } } }); if (r === 'ok' && v) toast('Tableau de bord publié.', 'ok', null, 2500); },
    'home-week': el => { S.homeWeek = Math.max(0, (S.homeWeek || 0) + Number(el.dataset.d)); render(); },
    'spread-go': async el => { const t = S.data.tasks.get(el.dataset.id); if (!t) return; await moveTask(t, el.dataset.date); toast('C\'est fait : ' + ((clientOf(t.client_id) || {}).name || 'dossier') + ' est prévu ' + fDate(el.dataset.date) + '.', 'ok', null, 3500); },
    'spread-skip': el => { let s = {}; try { s = JSON.parse(lsGet('planif-spread-skip') || '{}'); } catch (e) { s = {}; } s[el.dataset.key] = 1; lsSet('planif-spread-skip', JSON.stringify(s)); render(); },
    'help-offer': () => { if (helpAllowed()) offerHelp(); },
    'help-done': async el => { const h = (S.helpCache || []).find(x => String(x.id) === String(el.dataset.offer)); if (h) await helpReply(h, 'pas_besoin'); else await saveAgentState({ help_done: (agentState().help_done || []).concat([String(el.dataset.offer)]).slice(-200) }); render(); },
    'synth-copy': async () => { const txt = synthText(weekSynthesis()); try { await navigator.clipboard.writeText(txt); toast('Synthèse copiée : collez-la dans un e-mail ou une messagerie.', 'ok', null, 3500); } catch (e) { download('synthese-semaine.txt', txt); } },
    'synth-fold': () => { lsSet('planif-synth-fold', lsGet('planif-synth-fold') === '1' ? '' : '1'); render(); },
    'time-tip-ok': () => { lsSet('planif-time-tip', today().slice(0, 7)); render(); },
    'help-seen': el => { const s = (lsGet('planif-help-seen') || '').split(',').filter(Boolean); s.push(String(el.dataset.id)); lsSet('planif-help-seen', s.slice(-200).join(',')); render(); },
    'help-assign': async el => {
      const t = S.data.tasks.get(el.dataset.task), to = collabOf(el.dataset.to), d = el.dataset.date; if (!t || !to || !isManager()) return;
      const r = await saveUpdate('tasks', t.id, { collaborator_id: to.id, planned_date: d, seq: nextSeq(to.id, d), alloc: null }, { history: { action: 'changement_collaborateur', entity: 'task', entity_id: t.id, client_id: t.client_id, detail: { kind: t.kind, from_name: (collabOf(t.collaborator_id) || {}).name, to_name: to.name, text: 'aide proposée par ' + to.name } } });
      if (r !== 'ok') return;
      const h = (S.helpCache || []).find(x => String(x.id) === String(el.dataset.offer));
      if (h) await helpReply(h, 'confie', { client_id: t.client_id, task_id: t.id }); else await saveAgentState({ help_done: (agentState().help_done || []).concat([String(el.dataset.offer)]).slice(-200) });
      toast(((clientOf(t.client_id) || {}).name || 'Dossier') + ' confié à ' + to.name + ' ' + fDate(d) + '. ' + to.name + ' en est informé(e).', 'ok'); render();
    }
  });
  let suppressClick = false;
  // V26.165 : clic droit sur une tâche (Planning, Aujourd'hui) → menu « Tâche non terminée en totalité… » (V26.167 : + « reporter au lendemain »)
  document.addEventListener('contextmenu', e => {
    const el = e.target.closest && e.target.closest('[data-act="task"][data-id]'); if (!el) return;
    const t = S.data.tasks.get(el.dataset.id); if (!canSplit(t) && !canPostpone(t)) return;
    e.preventDefault(); taskMenu(t, e.clientX, e.clientY);
  });
  document.addEventListener('click', e => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
    const el = e.target.closest('[data-act]');
    if (el && S.drawer && el.closest('#side') && el.tagName === 'A') S.drawer = false;
    if (!el || !ACT[el.dataset.act]) return;
    if (el.closest('.seg, [role="tablist"]')) S.tabFx = performance.now(); // V26.176 : onglet → fondu léger du nouveau contenu (tous les thèmes)
    if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
    ACT[el.dataset.act](el, e);
  }, true);
  // V26.179 : effet de clic — souris et stylet dès l'appui (bouton principal) ; au doigt, seulement sur un vrai appui (pas en faisant défiler)
  let fxTouch = null;
  document.addEventListener('pointerdown', e => {
    if (!e.isPrimary) return;
    if (e.pointerType === 'touch') { fxTouch = { x: e.clientX, y: e.clientY, id: e.pointerId }; return; }
    if (e.button === 0) fxRipple(e.clientX, e.clientY);
  }, { capture: true, passive: true });
  document.addEventListener('pointerup', e => {
    if (!fxTouch || e.pointerId !== fxTouch.id) return;
    const t = fxTouch; fxTouch = null;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10) fxRipple(e.clientX, e.clientY);
  }, { capture: true, passive: true });
  document.addEventListener('pointercancel', () => { fxTouch = null; }, true);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && S.ready) { e.preventDefault(); openPalette(); }
    else if (e.key === 'Escape' && S.drawer) { S.drawer = false; render(); }
  });

  /* Balayage des cartes tâche (écran tactile) : droite = terminer, gauche = verrouiller */
  let sw = null;
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    const w = e.target.closest('[data-swipe]');
    if (!w || e.target.closest('.check')) return;
    sw = { w, el: w.querySelector('.task'), x0: e.clientX, y0: e.clientY, dx: 0, active: false, id: e.pointerId };
  });
  document.addEventListener('pointermove', e => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x0, dy = e.clientY - sw.y0;
    if (!sw.active) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) { sw.active = true; sw.el.style.transition = 'none'; sw.w.classList.add('swiping'); }
      else if (Math.abs(dy) > 10) { sw = null; return; }
      else return;
    }
    sw.dx = Math.max(-150, Math.min(150, dx));
    sw.el.style.transform = 'translateX(' + sw.dx + 'px)';
    sw.w.classList.toggle('dir-r', sw.dx > 0); sw.w.classList.toggle('dir-l', sw.dx < 0);
    sw.w.classList.toggle('arm-r', sw.dx > 80); sw.w.classList.toggle('arm-l', sw.dx < -80);
  });
  function endSwipe() {
    if (!sw) return;
    const s = sw; sw = null;
    if (!s.active) return;
    s.el.style.transition = 'transform ' + FX.SLOW + 'ms ' + FX.EASING; s.el.style.transform = ''; // V26.176 : retour en place avec la courbe commune
    setTimeout(() => { s.el.style.transition = ''; s.w.classList.remove('swiping', 'arm-r', 'arm-l', 'dir-r', 'dir-l'); }, FX.SLOW);
    suppressClick = true; setTimeout(() => (suppressClick = false), 60);
    const key = s.w.dataset.swipe;
    if (key.startsWith('g:')) {
      const ts = groupFromKey(key); if (!ts.length) return;
      if (s.dx > 80) {
        const wasDone = ts.every(t => t.done), ids = (wasDone ? ts : ts.filter(t => !t.done)).map(t => t.id);
        finishGroup(ts).then(r => { if (r === 'ok') toast(wasDone ? 'Dossier rouvert.' : 'Dossier terminé.', 'ok', { label: 'Annuler', fn: async () => { for (const id of ids) { const x = S.data.tasks.get(id); if (x) await toggleDone(x); } } }, 5000); });
      } else if (s.dx < -80) lockGroup(ts);
      return;
    }
    const t = S.data.tasks.get(key); if (!t) return;
    const pr = S.data.productions.get(t.production_id);
    if (s.dx > 80 && pr && !pr.received_date && t.kind !== 'info' && !t.done) { validateReceptions([pr.id], today()); return; }
    if (s.dx > 80) {
      const wasDone = t.done;
      finishTask(t).then(r => { if (r === 'ok') toast(wasDone ? 'Tâche rouverte.' : 'Tâche terminée.', 'ok', { label: 'Annuler', fn: () => { const x = S.data.tasks.get(t.id); if (x) toggleDone(x); } }, 5000); });
    } else if (s.dx < -80) toggleLock(t);
  }
  document.addEventListener('pointerup', endSwipe);
  document.addEventListener('pointercancel', endSwipe);
  document.addEventListener('change', e => { const el = e.target.closest('[data-ch]'); if (el && CH[el.dataset.ch]) CH[el.dataset.ch](el, e); });
  document.addEventListener('input', e => { const el = e.target.closest('[data-in]'); if (el && INP[el.dataset.in]) INP[el.dataset.in](el, e); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) closeSheet(); });
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role=button][data-act]')) { e.preventDefault(); e.target.click(); } });
  document.addEventListener('dragstart', e => { const el = e.target.closest && e.target.closest('[data-drag]'); if (!el) return; e.dataTransfer.setData('text/plain', el.dataset.drag); e.dataTransfer.effectAllowed = 'move'; fxDragStart(el, e); }); // V26.176 : carte saisie mise en avant
  document.addEventListener('dragover', e => { const col = e.target.closest && e.target.closest('[data-drop]'); if (col) { e.preventDefault(); col.classList.add('drop'); } });
  document.addEventListener('dragleave', e => { const col = e.target.closest && e.target.closest('[data-drop]'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop'); });
  document.addEventListener('drop', e => {
    const col = e.target.closest && e.target.closest('[data-drop]'); if (!col) return;
    e.preventDefault(); col.classList.remove('drop');
    const key = e.dataTransfer.getData('text/plain');
    const dc = col.dataset.dc || null; // V26.74 : colonne d'un autre planning (tuteur / apprenti)
    // V26.176 : la carte glisse ensuite de l'endroit où elle a été lâchée jusqu'à sa place définitive
    if (key.startsWith('g:')) { const ts = groupFromKey(key); if (ts.length && (ts[0].planned_date !== col.dataset.drop || (dc && ts[0].collaborator_id !== dc))) { fxDrop(key, e); moveGroup(ts, col.dataset.drop, dc); } return; }
    const t = S.data.tasks.get(key);
    if (t && (t.planned_date !== col.dataset.drop || (dc && t.collaborator_id !== dc))) { fxDrop(t.id, e); moveTask(t, col.dataset.drop, dc); }
  });

  /* V26.183 : pendant un glisser-déposer dans le Planning (Semaine ou Jour), amener la tâche contre le bord droit de l'écran
     passe à la semaine (au jour) suivante, contre le bord gauche du contenu à la précédente : un repère se remplit en 0,6 s,
     puis la page change ; en restant au bord, elle continue d'avancer toutes les 0,9 s. On dépose ensuite normalement. */
  const EDGE = { side: 0, t: 0, n: 0, el: null, idle: 0 };
  function edgeShow(side) {
    if (!EDGE.el) { EDGE.el = document.createElement('div'); EDGE.el.className = 'edge-nav'; EDGE.el.setAttribute('aria-hidden', 'true'); document.body.appendChild(EDGE.el); }
    const el = EDGE.el, lbl = S.planMode === 'day' ? (side > 0 ? 'Jour suivant' : 'Jour précédent') : (side > 0 ? 'Semaine suivante' : 'Semaine précédente');
    el.className = 'edge-nav' + (side ? ' on ' + (side > 0 ? 'r' : 'l') : '');
    if (side) { el.innerHTML = '<span>' + (side < 0 ? ic('chevL', 'sm') : '') + lbl + (side > 0 ? ic('chevR', 'sm') : '') + '</span><i></i>'; void el.offsetWidth; el.classList.add('fill'); }
  }
  function edgeReset() { EDGE.side = 0; EDGE.n = 0; clearTimeout(EDGE.idle); edgeShow(0); document.querySelectorAll('[data-drop].drop').forEach(c => c.classList.remove('drop')); }
  document.addEventListener('dragover', e => {
    if (S.route !== 'planning' || !['week', 'day'].includes(S.planMode)) return;
    clearTimeout(EDGE.idle); EDGE.idle = setTimeout(edgeReset, 350); // plus de survol : le glisser est terminé ou a quitté la fenêtre
    const vr = $('#view').getBoundingClientRect();
    let side = e.clientX >= innerWidth - 56 ? 1 : e.clientX <= vr.left + 28 && e.clientX >= vr.left - 16 ? -1 : 0; // à gauche : le bord du contenu, pas le menu
    if (EDGE.el) EDGE.el.style.left = side < 0 ? Math.round(vr.left) + 'px' : '';
    if (side < 0 && prevBlocked(S.planMode)) side = 0;
    if (side !== EDGE.side) { EDGE.side = side; EDGE.t = performance.now(); EDGE.n = 0; edgeShow(side); return; }
    if (side && performance.now() - EDGE.t > (EDGE.n ? 900 : 600)) {
      EDGE.t = performance.now(); EDGE.n++;
      ACT.nav({ dataset: { d: String(side) } });
      edgeShow(side); // le repère repart pour le pas suivant
    }
  });
  document.addEventListener('drop', edgeReset);
  document.addEventListener('dragend', edgeReset);
  function go(route) { if (location.hash !== '#/' + route) location.hash = '#/' + route; else render(); }
  function onRoute() {
    const prevRoute = S.route; S.route = (location.hash.replace(/^#\/?/, '') || 'today').split('?')[0];
    if (S.route === 'planning' && prevRoute !== 'planning' && !S.keepMode) { S.planMode = 'day'; S.planAll = undefined; } S.keepMode = false; // V26.186 : le Planning s'ouvre sur la journée de toute l'équipe
    if ((!NAV_FLAT.some(n => n[0] === S.route) && S.route !== 'more') || !navAllowed(S.route)) S.route = 'today';
    if (S.sheet) closeSheet(true);
    S.drawer = false; S.enter = true;
    const side = $('#side'); if (side && side.contains(document.activeElement)) document.activeElement.blur(); // le rail se referme après un clic
    if (S.route === 'history') S.histCache = null;
    if (S.route === 'export') S.usage = undefined;
    // V26.176 (tous les thèmes) : le menu indique tout de suite la nouvelle page (aucun glissement) ;
    // l'ancien contenu s'efface en 60 ms, puis le nouveau apparaît (titre d'abord, cartes en cascade)
    const view = $('#view'), changed = prevRoute && prevRoute !== S.route;
    if (side) side.querySelectorAll('a.nav').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#/' + S.route));
    updateBottomNav();
    const pilot = r => PILOT_TABS.some(t => t[0] === r);
    clearTimeout(S.outT); if (view) view.classList.remove('v-out');
    if (changed && pilot(prevRoute) && pilot(S.route) && view && view.querySelector('.pilot-tabs')) {
      // onglets du Pilotage : les onglets restent en place, seul le contenu dessous change (fondu + 4 px)
      view.querySelectorAll('.pilot-tabs [data-r]').forEach(b => b.classList.toggle('on', b.dataset.r === S.route));
      S.enter = false; S.tabFx = performance.now(); render();
    } else if (changed && fxOn() && view && view.children.length) {
      view.classList.add('v-out');
      S.outT = setTimeout(() => { view.classList.remove('v-out'); render(); }, 60);
    } else render();
  }

  /* ====================== Connexion ====================== */
  /* ====================== Page de connexion « JB Flow » ======================
   * Fond vivant, verre dépoli, cartes et pastilles que la souris peut pousser, bouton magnétique
   * à pixels 3D, compte à rebours de la période, transition vers l'application.
   * Les effets déclenchés par l'utilisateur restent actifs même si le système réduit les animations. */
  let lgCtl = null; // AbortController des écouteurs de la page de connexion
  const LG_ICON = {
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="3"/><path d="m4.5 7 7.5 6 7.5-6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>'
  };
  /* Logo « JB » qui se dessine trait par trait */
  const LG_LOGO = '<img class="lg-mono" src="logo-192.png" alt="JB Flow" width="64" height="64">';
  const LG_OLD = new URLSearchParams(location.search).get('accueil') === 'ancien'; // V26.50 : ?accueil=ancien affiche l'ancienne page (comparaison)
  function lgPage(cardHtml) {
    return '<div class="lg" id="lg"><div class="lg-bg" aria-hidden="true"><div class="lg-blob b1"></div><div class="lg-blob b2"></div><div class="lg-blob b3"></div><div class="lg-grid"></div><div class="lg-spot"></div><div class="lg-noise"></div></div>'
      + '<main class="lg-wrap"><section class="lg-hero">'
      + '<div class="lg-brand lg-in" style="--d:0"><div class="lg-logo">' + LG_LOGO + '</div><div><b class="lg-name">JB Flow</b><small>Production comptable &amp; TVA</small></div></div>'
      + '<h1 class="lg-h1 lg-in" style="--d:1">Le pilotage de la<br>production comptable,<span class="g" style="--d:2">en flux continu.</span><span class="g" style="--d:3">en équipe.</span><span class="g" style="--d:4">sans retard.</span></h1>'
      + (LG_OLD ? '<div class="lg-chips lg-in" style="--d:5"><span class="lg-chip lg-body" style="--b:0s"><i></i>Planification automatique</span>' : '<div class="lg-chips lg-in" style="--d:5"><span class="lg-agent"><i>✦</i>Agent de planification intégré</span>')
      + '<span class="lg-chip lg-body" style="--b:-2.3s"><i></i>Temps réel partagé</span><span class="lg-chip lg-body" style="--b:-4.1s"><i></i>Alertes à J-3</span></div>'
      + (LG_OLD ? '' : '<div class="lg-cards lg-in" style="--d:6">'
        + '<div class="lg-cardx feat lg-body" style="--b:-1.2s"><div class="h"><span class="ico">✦</span>Agent de planification</div><p>Il apprend quand chaque client dépose ses pièces et le temps réel de chaque dossier, <b>propose automatiquement le planning du mois suivant</b>, puis l\'ajuste dès que les pièces arrivent.</p><div class="stat"><b>−25 %</b><span>d\'écart sur les dates de réception · temps prévus 2× plus justes</span></div></div>'
        + '<div class="lg-cardx lg-body" style="--b:-3.4s"><div class="h"><span class="ico r"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF8A8A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/></svg></span>Échéances menacées vues à l\'avance</div><p>Une échéance menacée est signalée avant qu\'il soit trop tard, avec une solution de répartition.</p><div class="stat"><b>~3 sem.</b><span>d\'anticipation</span></div></div>'
        + '<div class="lg-cardx lg-body" style="--b:-5.1s"><div class="h"><span class="ico b"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A9C2FF" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></span>Sa journée, clairement</div><p>Chaque collaborateur retrouve ses priorités du jour, son niveau d\'activité de la semaine et les clients à relancer.</p></div>'
        + '</div>')
      + (LG_OLD ? '<div class="lg-stage lg-in" style="--d:6" aria-hidden="true">'
      + '<div class="lg-fc lg-body fc-a"><svg class="lg-ring" viewBox="0 0 58 58"><circle cx="29" cy="29" r="24" stroke="rgba(255,255,255,.12)"/><circle cx="29" cy="29" r="24" stroke="#3DDC84" stroke-dasharray="145 151" transform="rotate(-90 29 29)"/></svg><div><div class="l">Niveau d\'activité du jour</div><div class="v">6h45 <span>/ 7h</span></div></div></div>'
      + '<div class="lg-fc lg-body fc-b"><div class="l">Réceptions</div><div class="v">3 à valider</div><div class="lg-avs"><span style="background:#3DDC84">PB</span><span style="background:#E4F25A">MC</span><span style="background:#2FD3C1">PL</span></div></div>'
      + '<div class="lg-fc lg-body fc-c"><div class="l">DUPONT SARL · DES</div><div class="v sm">À déposer avant le 10</div><span class="lg-pill">' + LG_ICON.clock + 'J-2</span></div>'
      + '<div class="lg-fc lg-body fc-d"><div class="l">Équipe · remplissage</div><div class="v">72 %</div><div class="lg-bars"><i style="height:40%"></i><i style="height:62%"></i><i class="on" style="height:88%"></i><i class="hot" style="height:70%"></i><i class="hot" style="height:54%"></i></div></div>'
      + '</div>' : '') + '</section>'
      + '<section class="lg-side"><div class="lg-card lg-in" style="--d:2" id="lg-card">' + cardHtml + '</div>'
      + '</section></main>'
      + legalHtml().replace('class="legal"', 'class="legal lg-legal"') + '</div>';
  }
  function lgMsg(msg) { return msg ? '<div class="lg-msg ' + (msg.type || '') + '">' + esc(msg.text) + '</div>' : ''; }
  /* Effets : lumière, cartes et pastilles « physiques », bouton magnétique + pixels 3D */
  function lgFx() {
    if (lgCtl) lgCtl.abort();
    lgCtl = new AbortController();
    const sig = { signal: lgCtl.signal }, root = $('#lg'); if (!root) return;
    const card = $('#lg-card');
    const bodies = [...root.querySelectorAll('.lg-body')].map(el => ({ el, x: 0, y: 0, vx: 0, vy: 0, r: 0 }));
    const ptr = { x: -1e4, y: -1e4, vx: 0, vy: 0, t: 0 };
    let loopOn = false, tiltRaf = 0;
    addEventListener('pointermove', e => {
      root.style.setProperty('--mx', e.clientX + 'px'); root.style.setProperty('--my', e.clientY + 'px');
      const now = performance.now(), dt = Math.max(8, now - ptr.t);
      if (ptr.t) { ptr.vx = (e.clientX - ptr.x) / dt * 16; ptr.vy = (e.clientY - ptr.y) / dt * 16; }
      ptr.x = e.clientX; ptr.y = e.clientY; ptr.t = now;
      if (!loopOn) { loopOn = true; requestAnimationFrame(step); }
      if (!tiltRaf && card && innerWidth > 920) tiltRaf = requestAnimationFrame(() => { tiltRaf = 0; const px = e.clientX / innerWidth - .5, py = e.clientY / innerHeight - .5; card.style.transform = 'perspective(1200px) rotateY(' + (px * 3) + 'deg) rotateX(' + (-py * 3) + 'deg)'; });
    }, sig);
    function step() {
      if (!document.body.contains(root)) { loopOn = false; return; }
      let energy = 0;
      for (const b of bodies) {
        const r = b.el.getBoundingClientRect();
        const inside = ptr.x > r.left - 6 && ptr.x < r.right + 6 && ptr.y > r.top - 6 && ptr.y < r.bottom + 6;
        b.el.classList.toggle('hit', inside);
        if (inside) { const dx = r.left + r.width / 2 - ptr.x, dy = r.top + r.height / 2 - ptr.y, d = Math.hypot(dx, dy) || 1; b.vx += ptr.vx * .22 + dx / d * .9; b.vy += ptr.vy * .22 + dy / d * .9; }
        b.vx += -b.x * .045; b.vy += -b.y * .045; b.vx *= .86; b.vy *= .86; b.x += b.vx; b.y += b.vy;
        b.x = Math.max(-140, Math.min(140, b.x)); b.y = Math.max(-110, Math.min(110, b.y));
        b.r += (b.vx * .6 - b.r) * .2;
        b.el.style.transform = 'translate3d(' + b.x.toFixed(2) + 'px,' + b.y.toFixed(2) + 'px,0) rotate(' + Math.max(-9, Math.min(9, b.r)).toFixed(2) + 'deg)';
        energy += Math.abs(b.x) + Math.abs(b.y) + Math.abs(b.vx) + Math.abs(b.vy) + (inside ? 1 : 0);
      }
      ptr.vx *= .7; ptr.vy *= .7;
      if (energy > .05) requestAnimationFrame(step); else loopOn = false;
    }
    // Bouton magnétique
    const btn = $('#lg-go'); if (!btn) return;
    const mag = { x: 0, y: 0, tx: 0, ty: 0, s: 1, ts: 1, on: false };
    // Magnétisme : le bouton est attiré par la souris quand elle s'en approche
    addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      const r = btn.getBoundingClientRect(), cx = r.left + r.width / 2 - mag.x, cy = r.top + r.height / 2 - mag.y;
      const dx = e.clientX - cx, dy = e.clientY - cy, zone = Math.max(r.width, r.height) * .75;
      const inZone = Math.abs(dx) < r.width / 2 + 130 && Math.abs(dy) < r.height / 2 + 100;
      mag.tx = inZone ? Math.max(-30, Math.min(30, dx / zone * 26)) : 0; mag.ty = inZone ? Math.max(-18, Math.min(18, dy / zone * 16)) : 0; mag.ts = inZone ? 1.04 : 1;
      if (!mag.on) { mag.on = true; requestAnimationFrame(magStep); }
    }, sig);
    function magStep() {
      mag.x += (mag.tx - mag.x) * .16; mag.y += (mag.ty - mag.y) * .16; mag.s = (mag.s || 1) + ((mag.ts || 1) - (mag.s || 1)) * .16;
      btn.style.transform = 'translate3d(' + mag.x.toFixed(2) + 'px,' + mag.y.toFixed(2) + 'px,0) scale(' + mag.s.toFixed(3) + ')';
      btn.classList.toggle('lg-near', (mag.ts || 1) > 1);
      if (Math.abs(mag.tx - mag.x) + Math.abs(mag.ty - mag.y) + Math.abs((mag.ts || 1) - mag.s) > .05 && document.body.contains(btn)) requestAnimationFrame(magStep); else mag.on = false;
    }
  }
  /* Transition vers l'application : « Accueil personnalisé ».
     « Bonjour Prénom » s'écrit en dégradé pendant que l'anneau autour du logo se remplit (= chargement des données),
     puis l'écran d'accueil s'efface sur l'application. Uniquement opacité / transformations (fluide sur PC et iPhone).
     Animations « Réduites » : même écran, en simple fondu, sans mouvement. */
  function lgName(email) {
    try { const c = JSON.parse(lsGet('planif-last-name') || 'null'); if (c && c.email === email && c.name) return c.name; } catch (e) {}
    const u = S.store.mode === 'demo' ? S.store.demoUsers().find(x => x.email.toLowerCase() === email) : null;
    if (u) return u.name.split(' ')[0];
    const p = (email || '').split('@')[0].split(/[._-]/)[0];
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : '';
  }
  function lgExit(then, email) {
    const root = $('#lg');
    if (lgCtl) { lgCtl.abort(); lgCtl = null; }
    haptic();
    if (!root || !root.animate) return then();
    const soft = document.documentElement.dataset.motion === 'reduced';
    email = (email || '').toLowerCase();
    const name = lgName(email);
    const word = 'Bonjour' + (name ? ' ' + name : '');
    const dl = new Date(today() + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const n = word.length;
    const ov = document.createElement('div'); ov.className = 'lg-hello';
    ov.innerHTML = '<div class="in"><div class="ring"><svg viewBox="0 0 100 100"><defs><linearGradient id="lgh-g"><stop offset="0" stop-color="#3DDC84"/><stop offset="1" stop-color="#E4F25A"/></linearGradient></defs><circle cx="50" cy="50" r="45" class="tr"/><circle cx="50" cy="50" r="45" class="ar" stroke="url(#lgh-g)"/></svg><img src="logo-192.png" alt=""></div>'
      + '<h1>' + [...word].map((c, i) => '<span style="background-size:' + n * 100 + '% 100%;background-position:' + (n > 1 ? i * 100 / (n - 1) : 0) + '% 0">' + (c === ' ' ? '&nbsp;' : esc(c)) + '</span>').join('') + '</h1>'
      + '<p>' + esc(dl.charAt(0).toUpperCase() + dl.slice(1)) + ' · bonne production !</p></div>';
    document.body.appendChild(ov);
    const inner = ov.querySelector('.in'), arc = ov.querySelector('.ar'), C = 283;
    const EZ = 'cubic-bezier(.2,.8,.2,1)';
    // 1. L'écran d'accueil recouvre la connexion
    ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out', fill: 'backwards' });
    ov.querySelector('.ring').animate(soft ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 60, easing: EZ, fill: 'backwards' });
    // 2. « Bonjour Prénom » lettre par lettre
    [...ov.querySelectorAll('h1 span')].forEach((s, i) => s.animate(soft ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(.45em)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 100 + i * 18, easing: EZ, fill: 'backwards' }));
    const t0 = Date.now(), lettersEnd = 100 + n * 18 + 320, pause = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
    ov.querySelector('p').animate(soft ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 200 + n * 18, easing: EZ, fill: 'backwards' });
    // 3. L'anneau suit le chargement des données
    arc.animate([{ strokeDashoffset: C }, { strokeDashoffset: C * .2 }], { duration: 520, delay: 80, easing: EZ, fill: 'forwards' });
    const done = Promise.resolve().then(then).catch(() => {});
    Promise.all([Promise.race([done, new Promise(r => setTimeout(r, 2500))]), new Promise(r => setTimeout(r, 520))]).then(async () => {
      try { if (S.me && S.me.name && S.me.email) lsSet('planif-last-name', JSON.stringify({ email: String(S.me.email).toLowerCase(), name: S.me.name.split(' ')[0] })); } catch (e) {}
      arc.animate([{ strokeDashoffset: C * .2 }, { strokeDashoffset: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
      await pause(Math.max(220, lettersEnd - (Date.now() - t0)) + 180); // minuteries (et non .finished) : jamais bloqué, même onglet en arrière-plan
      // 4. L'accueil s'efface sur l'application
      inner.animate(soft ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-22px) scale(.97)' }], { duration: 260, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
      ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 60, easing: 'ease-in-out', fill: 'forwards' });
      await pause(380); ov.remove();
    });
  }
  /* Petite vibration de confirmation (Android : API Vibration ; iPhone iOS 18+ : interrupteur natif « switch ») */
  function haptic() {
    try {
      if (navigator.vibrate) { navigator.vibrate(14); return; }
      const l = document.createElement('label'), i = document.createElement('input');
      i.type = 'checkbox'; i.setAttribute('switch', ''); l.appendChild(i);
      l.style.cssText = 'position:fixed;left:-99px;top:0;opacity:0;pointer-events:none';
      document.body.appendChild(l); l.click(); l.remove();
    } catch (e) { /* sans vibration : aucun effet */ }
  }
  function renderLogin(msg) {
    const demo = S.store.mode === 'demo', users = demo ? S.store.demoUsers() : [];
    const card = '<span class="lg-badge"><i></i>' + (demo ? 'Mode démonstration' : 'Espace cabinet sécurisé') + '</span><h2 id="lg-title">Bienvenue !</h2><p class="lg-sub" id="lg-subt">Travaillez en toute sérénité.</p>' + lgMsg(msg)
      + '<form id="login-form" novalidate>'
      + '<div class="lg-field"><label for="lg-email">E-mail professionnel</label><div class="lg-inp">' + LG_ICON.mail + '<input id="lg-email" name="email" type="email" placeholder="prenom.nom@cabinet.fr" autocomplete="username" required></div></div>'
      + (demo ? '<div class="lg-demo">' + users.map(u => '<button type="button" class="lg-dchip" data-demo="' + esc(u.email) + '"><span class="lg-av">' + esc(initials(u.name)) + '</span>' + esc(u.name.split(' ')[0]) + (u.role === 'admin' ? ' · admin' : '') + '</button>').join('') + '</div>' : '')
      + '<div class="lg-field"><label for="lg-pw">Mot de passe</label><div class="lg-inp">' + LG_ICON.lock + '<input id="lg-pw" name="password" type="password" placeholder="' + (demo ? 'Libre en démonstration' : '8 caractères minimum') + '" autocomplete="current-password" required minlength="8"><button type="button" class="lg-eye" id="lg-eye" aria-label="Afficher le mot de passe">' + LG_ICON.eye + '</button></div></div>'
      + '<div class="lg-field" id="signup-extra" style="display:none"><label for="lg-pw2">Confirmer le mot de passe</label><div class="lg-inp">' + LG_ICON.lock + '<input id="lg-pw2" name="password2" type="password" autocomplete="new-password" minlength="8"></div></div>'
      + '<div class="lg-row"><label class="lg-tog"><input type="checkbox" id="lg-remember"' + (lsGet('planif-remember') === '0' ? '' : ' checked') + '><span class="t"></span>Rester connecté</label>' + (demo ? '' : '<a class="lg-link" href="#" id="to-reset">Mot de passe oublié ?</a>') + '</div>'
      + '<button class="lg-btn" id="lg-go" type="submit"><span id="lg-go-t">Se connecter</span>' + LG_ICON.arrow + '</button></form>'
      + (demo ? '<div class="lg-secure">' + LG_ICON.shield + 'Démonstration : choisissez un profil ci-dessus, le mot de passe est libre'
        : '<div class="lg-or">ou</div><button class="lg-ghost" type="button" id="to-signup">Première connexion : créer mon accès</button><div class="lg-secure">' + LG_ICON.shield + 'Connexion chiffrée · accès réservé aux membres du cabinet') + '</div>';
    $('#app').innerHTML = lgPage(card);
    lgFx();
    let mode = 'login';
    const form = $('#login-form'), pw = $('#lg-pw');
    // E-mail retenu sur cet appareil (navigateur) : rien n'est envoyé à un serveur
    const lastEmail = lsGet('planif-last-email');
    if (lastEmail) { form.email.value = lastEmail; document.querySelectorAll('.lg-dchip').forEach(x => x.classList.toggle('on', x.dataset.demo === lastEmail)); setTimeout(() => { try { pw.focus({ preventScroll: true }); } catch (e) {} }, 400); }
    $('#lg-eye').onclick = () => { pw.type = pw.type === 'password' ? 'text' : 'password'; };
    if (demo) {
      document.querySelectorAll('[data-demo]').forEach(b => (b.onclick = () => { form.email.value = b.dataset.demo; document.querySelectorAll('.lg-dchip').forEach(x => x.classList.toggle('on', x === b)); pw.focus(); }));
    } else {
      $('#to-signup').onclick = e => {
        e.preventDefault(); mode = mode === 'signup' ? 'login' : 'signup';
        $('#signup-extra').style.display = mode === 'signup' ? '' : 'none';
        $('#lg-go-t').textContent = mode === 'signup' ? 'Créer mon accès' : 'Se connecter';
        $('#lg-title').textContent = mode === 'signup' ? 'Créer mon accès' : 'Bienvenue !';
        $('#lg-subt').textContent = mode === 'signup' ? 'Utilisez l\'adresse e-mail enregistrée par votre administrateur.' : 'Travaillez en toute sérénité.';
        e.target.textContent = mode === 'signup' ? 'J\'ai déjà un accès : me connecter' : 'Première connexion : créer mon accès';
      };
      $('#to-reset').onclick = async e => { e.preventDefault(); const email = form.email.value.trim(); if (!email) { renderLogin({ type: 'warn', text: 'Saisissez d\'abord votre e-mail, puis cliquez sur « Mot de passe oublié ».' }); return; } try { await S.store.resetPassword(email); renderLogin({ type: 'ok', text: 'Si ce compte existe, un e-mail de réinitialisation vient d\'être envoyé.' }); } catch (er) { renderLogin({ type: 'bad', text: errMsg(er) }); } };
    }
    form.onsubmit = async e => {
      e.preventDefault();
      const email = form.email.value.trim().toLowerCase(), password = pw.value, go = $('#lg-go'), t = $('#lg-go-t'), label = t.textContent;
      if (demo) {
        if (!users.some(u => u.email.toLowerCase() === email)) { renderLogin({ type: 'warn', text: 'En démonstration, choisissez un des profils proposés (ex. ' + (users[0] ? users[0].email : '') + ').' }); return; }
      } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8) { renderLogin({ type: 'warn', text: 'Indiquez un e-mail valide et un mot de passe de 8 caractères minimum.' }); return; }
      lsSet('planif-remember', $('#lg-remember').checked ? '1' : '0');
      go.disabled = true; t.innerHTML = '<span class="lg-spin"></span>' + (mode === 'signup' ? 'Création…' : 'Connexion…');
      try {
        if (mode === 'signup') {
          if (password !== form.password2.value) throw new Error('Les mots de passe ne correspondent pas.');
          const r = await S.store.signUp(email, password);
          if (r && r.session) { sessionStorage.setItem('planif-alive', '1'); return lgExit(() => start(email), email); }
          return renderLogin({ type: 'ok', text: 'Compte créé. Un e-mail de confirmation vous a été envoyé : cliquez sur le lien, puis revenez vous connecter.' });
        }
        await S.store.signIn(email, password);
        sessionStorage.setItem('planif-alive', '1'); lsSet('planif-last-email', email);
        t.textContent = 'Bienvenue';
        lgExit(() => start(email), email);
      } catch (er) { go.disabled = false; t.textContent = label; renderLogin({ type: 'bad', text: /invalid login/i.test(errMsg(er)) ? 'E-mail ou mot de passe incorrect (ou e-mail non confirmé).' : errMsg(er) }); }
    };
  }
  function renderPwdReset() {
    $('#app').innerHTML = lgPage('<span class="lg-badge"><i></i>Espace cabinet sécurisé</span><h2>Nouveau mot de passe</h2><p class="lg-sub">Choisissez un mot de passe d\'au moins 8 caractères.</p><form id="pw-form"><div class="lg-field"><label for="lg-np">Nouveau mot de passe</label><div class="lg-inp">' + LG_ICON.lock + '<input id="lg-np" type="password" name="p" minlength="8" required autocomplete="new-password"></div></div><button class="lg-btn" id="lg-go"><span>Enregistrer</span>' + LG_ICON.arrow + '</button></form>');
    lgFx();
    $('#pw-form').onsubmit = async e => { e.preventDefault(); try { await S.store.updatePassword(e.target.p.value); location.hash = ''; location.reload(); } catch (er) { toast(errMsg(er), 'bad'); } };
  }
  function renderNoAccess(email) {
    $('#app').innerHTML = lgPage('<span class="lg-badge warn"><i></i>Accès non autorisé</span><h2>Accès en attente</h2><p class="lg-sub">Le compte <b>' + esc(email) + '</b> n\'est pas (ou plus) autorisé. Demandez à l\'administrateur de vous ajouter dans <i>Paramètres › Utilisateurs</i> avec cette adresse e-mail.</p><button class="lg-ghost" id="lo">Se déconnecter</button>');
    lgFx();
    $('#lo').onclick = async () => { await S.store.signOut(); location.reload(); };
  }
  function looksSecret(key) {
    if (/^sb_secret_/.test(key)) return true;
    try { const p = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.role === 'service_role'; } catch (e) { return false; }
  }

  /* ====================== Démarrage ====================== */
  /* ====================== V26.168 : début d'utilisation de JB Flow ======================
   * Au premier lancement, le manager (ou l'administrateur) indique la première période de TVA traitée dans l'outil :
   * rien n'apparaît avant (dossiers, réceptions, alertes, relances, historique). Modifiable dans Paramètres › Planification.
   * Chaque RC, collaborateur ou apprenti reçoit aussi son propre début, choisi à sa création (Paramètres › Utilisateurs). */
  function startOptions(cur, min, withCab) {
    const out = [], base = defaultMonth();
    for (let i = -12; i <= 6; i++) { const m = E.addMonths(base, i); if (!min || m >= min) out.push(m); }
    if (cur && !out.includes(cur)) { out.push(cur); out.sort(); }
    return (withCab ? '<option value=""' + (!cur ? ' selected' : '') + '>Comme le cabinet' + (cabStart() ? ' (' + esc(fMonth(cabStart())) + ')' : '') + '</option>' : '')
      + out.map(m => '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + esc(fMonth(m).replace(/^./, x => x.toUpperCase())) + ' — TVA ' + esc(deMonth(E.addMonths(m, -1))) + '</option>').join('');
  }
  async function savePlanning(patch, histText) {
    const value = Object.assign({}, cfg(), patch), h = { action: 'parametres', detail: { text: histText } };
    if (S.data.settings.get('planning')) return (await saveUpdate('settings', 'planning', { value }, { history: h })) === 'ok';
    try { await saveInsert('settings', [{ id: 'planning', value }]); hist(h.action, h); return true; } catch (e) { return false; }
  }
  async function saveStart(m) {
    const ok = await savePlanning({ start_month: m || '', start_confirmed: true }, m ? 'Début d\'utilisation de JB Flow : ' + fMonth(m) : 'Début d\'utilisation de JB Flow retiré : tous les mois affichés');
    // V26.169 : « Modifier » dans le message, si on s'est trompé de mois
    if (ok) { clampToStart(); S.recSel.clear(); render(); toast(m ? 'JB Flow démarre en ' + fMonth(m) + ' : les mois précédents ne sont plus affichés.' : 'Tous les mois enregistrés sont de nouveau affichés.', 'ok', { label: 'Modifier', fn: () => askStartMonth(true) }, 9000); }
    return ok;
  }
  // Début propre à un utilisateur (vide = comme le cabinet)
  async function setUserStart(email, m) {
    const k = String(email || '').toLowerCase(), us = Object.assign({}, cfg().user_start || {});
    if (m) us[k] = m; else delete us[k];
    return savePlanning({ user_start: us }, k + ' : début d\'utilisation ' + (m ? fMonth(m) : 'comme le cabinet'));
  }
  // edit : V26.169 — revenir sur le mois choisi (Annuler possible, « aucun mois de début » proposé)
  function askStartMonth(edit) {
    if (document.querySelector('.sheet-start')) return Promise.resolve(false);
    return new Promise(resolve => {
      const root = document.createElement('div'); root.className = 'overlay anim center';
      const cur = edit ? cabStart() : (cabStart() || defaultMonth());
      root.innerHTML = '<div class="sheet sheet-start" role="dialog" aria-modal="true" aria-labelledby="st-t"><div class="sheet-h"><div style="margin-right:auto"><h2 id="st-t">' + (edit ? 'Modifier le début d\'utilisation' : 'Début d\'utilisation de JB Flow') + '</h2><div class="small muted" style="margin-top:4px">' + (edit ? 'Pour tout le cabinet' : 'Une seule fois, pour tout le cabinet') + '</div></div></div>'
        + '<div class="sheet-b"><p style="margin:0">' + (edit ? 'Tu t\'es trompé de mois ? Choisis le bon mois de la <b>première déclaration de TVA</b> préparée avec JB Flow.' : 'À partir de quand le cabinet utilise-t-il réellement JB Flow ? Choisis le mois de la <b>première déclaration de TVA</b> préparée avec l\'outil.') + '</p>'
        + '<label class="f"><span>Premier mois (première période de TVA)</span><select id="st-m">' + (edit ? '<option value=""' + (!cur ? ' selected' : '') + '>Aucun mois de début (afficher tous les mois)</option>' : '') + startOptions(cur) + '</select></label>'
        + '<div class="notice small">' + (edit ? 'Rien n\'a été effacé : un mois plus ancien fait réapparaître ses dossiers, un mois plus récent masque les précédents.' : 'Les mois précédents n\'apparaîtront nulle part : ni dossiers, ni réceptions, ni alertes, ni relances, ni historique. Rien n\'est effacé, et tu pourras revenir sur ce choix dans Paramètres.') + '</div></div>'
        + '<div class="sheet-f">' + (edit ? '<button class="btn" data-x="cancel">Annuler</button>' : '') + '<button class="btn primary" data-x="ok">' + ic('check', 'sm') + (edit ? 'Enregistrer' : 'Valider') + '</button></div></div>';
      const close = v => { fxClose(root); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = e => { if (edit && e.key === 'Escape') { e.stopPropagation(); close(false); } };
      root.addEventListener('click', async e => {
        if (edit && (e.target === root || e.target.closest('[data-x="cancel"]'))) return close(false);
        const b = e.target.closest('[data-x="ok"]'); if (!b || b.disabled) return;
        const m = root.querySelector('#st-m').value;
        if (edit && m === cabStart()) return close(false); // rien ne change
        b.disabled = true;
        if (await saveStart(m)) close(true); else b.disabled = false;
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(root);
      setTimeout(() => { const sel = root.querySelector('#st-m'); if (sel) sel.focus(); }, 60);
    });
  }
  /* V26.169 : bloc « Début d'utilisation » des Paramètres — mois choisi en clair et bouton pour le modifier */
  function startBlock() {
    const sm = cabStart();
    return '<div class="start-row"><div class="start-v"><span class="small muted">Premier mois d\'utilisation de JB Flow (première période de TVA)</span><b>' + (sm ? esc(fMonth(sm).replace(/^./, x => x.toUpperCase())) + ' — TVA ' + esc(deMonth(E.addMonths(sm, -1))) : 'Aucun : tous les mois sont affichés') + '</b></div>'
      + (S.readonly ? '' : '<button class="btn" data-act="start-edit">' + ic('calendar', 'sm') + (sm ? 'Modifier le mois de début' : 'Choisir le mois de début') + '</button>') + '</div>'
      + '<p class="small muted" style="margin:8px 0 14px">Les mois précédents n\'apparaissent nulle part : dossiers, réceptions, retards, alertes, relances, historique, planning. Tu t\'es trompé ? « Modifier » : rien n\'a été effacé, un mois plus ancien fait réapparaître ses dossiers. Le début propre à chaque RC, collaborateur ou apprenti se change dans sa fiche (Paramètres › Utilisateurs).</p>';
  }
  // Question posée au manager / à l'administrateur tant que le début n'est pas confirmé (pas dans la démo publique, sauf ?debut=1)
  async function startMonthCheck() {
    if (S.readonly || !S.me || S.realMe || !isManager()) return;
    if (S.store.mode === 'demo' && !qs.get('debut')) return;
    if (cfg().start_confirmed) return; // déjà répondu (même « aucun mois de début »)
    await askStartMonth(false);
  }
  async function start(email) {
    $('#app').innerHTML = '<div class="boot">Chargement des données…</div>';
    try { await loadAll(); cacheSnapshot(); }
    catch (e) {
      noteLimit(e);
      let snap = null; try { snap = JSON.parse(lsGet(CACHE_KEY)); } catch (er) { snap = null; }
      if (snap && snap.email && snap.email.toLowerCase() === email.toLowerCase()) {
        P.TABLES.forEach(t => (S.data[t] = new Map((snap.data[t] || []).map(r => [r.id, r]))));
        S.readonly = true; S.cacheAt = snap.at;
      } else {
        $('#app').innerHTML = '<div class="login"><div class="card"><h1>Base de données inaccessible</h1><div class="notice bad">' + esc(errMsg(e)) + '</div><p>' + (isLimitError(e) ? 'La limite de l\'offre gratuite est peut-être atteinte ou le projet Supabase est en pause (inactivité &gt; 7 jours) : ouvrez le tableau de bord Supabase et cliquez sur « Restore project ».' : 'Vérifiez la connexion Internet.') + '</p><button class="btn primary" onclick="location.reload()">Réessayer</button></div></div>';
        return;
      }
    }
    S.me = list('app_users').find(u => u.email.toLowerCase() === email.toLowerCase() && u.active);
    if (!S.me) return renderNoAccess(email);
    // V26.144 : un administrateur peut regarder l'application « en tant que » une personne (onglet en cours uniquement)
    try { const vid = sessionStorage.getItem('planif-view-user'), tgt = vid && S.me.role === 'admin' && list('app_users').find(u => u.id === vid && u.active); if (tgt && tgt.id !== S.me.id) { S.realMe = S.me; S.me = Object.assign({}, tgt); } else if (vid) sessionStorage.removeItem('planif-view-user'); } catch (e) { /* navigation privée */ }
    const cc = cryptoCfg();
    if (cc && !(await loadDeviceKey(cc))) await unlockScreen();
    if (cc) await decryptAllClients();
    S.v8 = S.store.v8 !== false;
    const saved = lsGet('planif-collab');
    S.collabId = (saved && S.data.collaborators.has(saved) && canSeeCollab(saved) ? saved : null) || S.me.collaborator_id || (visibleCollabs()[0] || {}).id || null;
    S.cursor = weekday(today()); S.month = defaultMonth(); S.recDate = today(); clampToStart(); // V26.168 : jamais avant le début d'utilisation
    S.navPinned = lsGet('planif-nav-pin') === '1';
    S.teamView = lsGet('planif-teamview') === 'gantt' ? 'gantt' : 'table';
    if (S.teamView === 'gantt') S.teamRange = 'period';
    if (!S.readonly) {
      S.store.subscribe(onRemote, st => { S.sync = st; renderStatus(); });
      setInterval(() => poll(false), 30000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(true); carryOver().catch(() => { }); } }); // V26.165 : report automatique au premier retour du jour
      window.addEventListener('online', () => { S.offline = false; poll(true); renderStatus(); });
      window.addEventListener('offline', () => { S.offline = true; renderStatus(); });
    }
    window.addEventListener('beforeunload', e => { if (S.pending || S.failed.length) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('hashchange', onRoute);
    S.ready = true;
    onRoute();
    S.v7 = S.store.v7 !== false;
    setTimeout(async () => { try { await upgradeSettings(); await autoCreateMonths(); await dedupeInfoTasks(); await carryOver(); } catch (e) { /* sans conséquence */ } agentStartup().catch(e => console.warn('Agent', e)); }, 600);
    setTimeout(() => { firstUseInit().catch(() => { }); logDailyConnexion(); checkMigrations().catch(() => { }); synthWeeklyToast(); }, 900);
    setTimeout(() => startMonthCheck().catch(() => { }), 300); // V26.168 : début d'utilisation demandé au premier lancement
    const tp = () => document.querySelector('.sheet-start') ? setTimeout(tp, 1000) : themePicker();
    setTimeout(tp, 1700); // première connexion : choix de l'ambiance (après l'écran d'accueil et la question du début d'utilisation)
    firstDemoOffer(); // V26.125 : puis proposition de la démo (bac à sable fictif)
  }
  /* Tolère les erreurs de saisie courantes dans config.js : « https:xxx », sans https, lien du tableau de bord, /rest/v1 */
  function normalizeSupabaseUrl(u) {
    u = String(u || '').trim().replace(/^['"\s]+|['"\s]+$/g, '');
    let m = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{20})/i); if (m) return 'https://' + m[1] + '.supabase.co';
    if (/^[a-z0-9]{20}$/i.test(u)) return 'https://' + u + '.supabase.co';
    u = u.replace(/^https?:\/*/i, '');
    u = 'https://' + u.replace(/\/(rest|auth)\/v1.*$/i, '').replace(/\/+$/, '');
    try { return new URL(u).origin; } catch (e) { return null; }
  }
  function configError(title, html) {
    $('#app').innerHTML = '<div class="login"><div class="card" style="max-width:560px"><h1>' + title + '</h1>' + html + '<p class="small muted">Corrigez <b>app/config.js</b>, publiez à nouveau, puis rechargez la page (Ctrl + F5).</p><button class="btn primary" onclick="location.reload()">Réessayer</button></div></div>';
  }
  async function boot() {
    try {
      if (CFG.SUPABASE_URL || CFG.SUPABASE_ANON_KEY) {
        const url = normalizeSupabaseUrl(CFG.SUPABASE_URL), key = String(CFG.SUPABASE_ANON_KEY || '').trim();
        if (!url) return configError('Adresse Supabase invalide', '<div class="notice bad">SUPABASE_URL vaut « ' + esc(CFG.SUPABASE_URL || '(vide)') + ' ».</div><p>Elle doit ressembler à <code>https://abcdefghijklmnopqrst.supabase.co</code> (Supabase › Project Settings › API › Project URL).</p>');
        if (!key || /\.\.\.|…/.test(key) || key.length < 30) return configError('Clé Supabase incomplète', '<div class="notice bad">SUPABASE_ANON_KEY est vide ou incomplète (« ' + esc(key.slice(0, 24) || '(vide)') + ' »).</div><p>Copiez la clé <b>publishable</b> en entier (elle commence par <code>sb_publishable_</code>) ou la clé <b>anon public</b> (commence par <code>eyJ</code>) : Supabase › Project Settings › API Keys, bouton « Copy ».</p>');
        CFG.SUPABASE_URL = url; CFG.SUPABASE_ANON_KEY = key;
      }
      if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
        if (looksSecret(CFG.SUPABASE_ANON_KEY)) { $('#app').innerHTML = '<div class="login"><div class="card"><h1>Configuration dangereuse</h1><div class="notice bad">config.js contient une clé SECRÈTE (service_role / secret). Elle ne doit jamais être publiée. Remplacez-la par la clé publique « anon » / « publishable », puis régénérez la clé secrète dans Supabase.</div></div></div>'; return; }
        await loadScript(SUPABASE_JS);
        S.store = new P.SupabaseStore(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
        let recovering = /type=recovery/.test(location.hash);
        S.store.onAuthChange((ev, email) => { if (ev === 'PASSWORD_RECOVERY') { recovering = true; renderPwdReset(); } });
        let email = await S.store.getSessionEmail();
        if (email && lsGet('planif-remember') === '0' && !sessionStorage.getItem('planif-alive')) { await S.store.signOut(); email = null; }
        if (recovering) return renderPwdReset();
        if (!email) return renderLogin();
        return start(email);
      }
      S.store = new P.DemoStore();
      const email = await S.store.getSessionEmail();
      if (!email) return renderLogin();
      start(email);
    } catch (e) {
      $('#app').innerHTML = '<div class="login"><div class="card"><h1>Démarrage impossible</h1><div class="notice bad">' + esc(errMsg(e)) + '</div><button class="btn primary" onclick="location.reload()">Réessayer</button></div></div>';
    }
  }
  window.PlanApp = { S, E, runPlan, readImportFile, validateReceptions, generateMonth, renderLogin }; // accès console (diagnostic)
  boot();
})();
