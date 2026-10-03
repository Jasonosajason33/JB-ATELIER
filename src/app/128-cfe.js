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
  }