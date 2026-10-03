  /* ====================== Événements ====================== */
  const ACT = {
    refresh: () => refreshAll(),
    reload: e => { location.reload(); },
    retry: () => retryFailed(),
    logout: async () => { if (S.failed.length && !await confirmBox('Modifications non enregistrées', '<p>' + S.failed.length + ' modification(s) ne sont pas enregistrées et seront perdues.</p>', 'Se déconnecter quand même', true)) return; lsDel(CACHE_KEY); await S.store.signOut(); location.hash = ''; location.reload(); },
    collab: el => { S.collabId = el.dataset.id || null; lsSet('planif-collab', S.collabId || ''); render(); },
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

