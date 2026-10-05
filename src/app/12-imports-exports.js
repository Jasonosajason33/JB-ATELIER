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
        const created = await saveInsert('collaborators', imp.newCollabs.map((n, i) => ({ id: P.uuid(), name: n, daily_capacity_min: 480, work_days: [1, 2, 3, 4, 5], color: COLORS[(n0 + i) % COLORS.length], active: true })));
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

