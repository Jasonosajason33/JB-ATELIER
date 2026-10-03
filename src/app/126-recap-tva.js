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
