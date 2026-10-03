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

