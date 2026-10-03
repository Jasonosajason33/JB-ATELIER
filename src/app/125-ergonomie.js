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
