  /* ===== V26.135 : cartes repliables (Suivi TVA, Suivi Acompte IS, Suivi CFE, Suivi CVAE) =====
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
    // V26.201 : rappel limité à la saison (1er mai → 30 juin) ; jamais pour une échéance antérieure au début d'utilisation de JB Flow.
    // Après le 30 juin, les retards restent visibles dans le suivi CVAE (onglet TVA & autres impôts), sans bandeau sur Aujourd'hui.
    if (td > y + '-06-30' || (startMonth() && startMonth() > cvaeDue(y).slice(0, 7))) return '';
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
