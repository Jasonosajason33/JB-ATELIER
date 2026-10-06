/* engine.js — Logique métier pure : dates, capacités, génération du mois,
 * planification (1 → 24), alertes, indicateurs et agent de planification.
 * Aucune dépendance, aucun accès réseau : testable isolément et réutilisable
 * (ex. futur module d'analyse des temps réels). */
(function (global) {
  'use strict';

  /* Un dossier = une tâche « production » (temps unique incluant tenue, lettrage et TVA),
   * plus une tâche « info » quand une demande d'informations est à faire.
   * Les anciennes missions (tenue/lettrage/tva) restent reconnues pour les mois déjà générés. */
  const KINDS = ['tenue', 'lettrage', 'tva', 'production', 'info', 'dashboard'];
  const KIND_LABEL = { tenue: 'Tenue', lettrage: 'Lettrage', tva: 'TVA', production: 'Production', info: 'Demande d\'infos', dashboard: 'Tableau de bord' };
  const DEFAULT_SETTINGS = {
    new_margin_pct: 20, // V26.32 : marge sur le temps des nouveaux dossiers (moins de 3 mois d'historique)
    start_day: 1,            // début de la période de production
    end_day: 24,             // fin de la période de production
    day_start: '09:00',      // heure de début affichée dans les plannings
    warn_pct: 85,            // seuil orange (capacité presque atteinte)
    due_soon_days: 3,        // échéance "proche" (jours calendaires)
    quarter_months: [1, 4, 7, 10],
    annual_month: 4,
    holidays: true,          // jours fériés français = capacité 0
    collab_see_all: true,    // un collaborateur peut voir les autres plannings
    auto_lock_on_move: false, // verrouiller automatiquement une tâche déplacée à la main
    info_request_min: 45,    // temps planifié pour une demande d'informations « à faire »
    auto_create_month: true, // les dossiers du mois sont créés automatiquement à l'ouverture de l'application
    alert_from_day: 15,      // à partir de ce jour, alerte si l'équipe ne tiendra pas la fin de période
    freeze_days: 1,          // zone figée : aujourd'hui + N jour(s) ouvré(s) ne sont pas bousculés (sauf replanification forcée)
    mid_day: 21,             // premier jalon d'échéances TVA suivi (« l'équipe tient le 21 »), en plus de la fin de période
    agent_enabled: true      // agent de planification : apprend des mois précédents (dates de réception, temps réels)
    // V26.207 : reserve_min (minutes gardées chaque jour pour les imprévus, 0 si absent) et reserve_min_by {id: minutes}
    // ne figurent pas ici, pour que le défaut de l'application (20 %) s'applique tant que rien n'est enregistré.
  };

  /* ---------- Dates (chaînes 'YYYY-MM-DD', heure locale) ---------- */
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function dow(s) { const g = parseYmd(s).getDay(); return g === 0 ? 7 : g; } // 1 = lundi … 7 = dimanche
  function daysInMonth(month) { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); }
  function dateInMonth(month, day) { return month + '-' + pad(Math.min(Math.max(1, Number(day) || 1), daysInMonth(month))); }
  function addMonths(month, n) { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function monthDates(month) { const out = []; for (let i = 1; i <= daysInMonth(month); i++) out.push(month + '-' + pad(i)); return out; }
  function rangeDates(a, b) { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }
  function startOfWeek(s) { return addDays(s, 1 - dow(s)); }
  function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
  function windowOf(month, settings) {
    const st = Object.assign({}, DEFAULT_SETTINGS, settings);
    return { start: dateInMonth(month, st.start_day), end: nextWorkday(dateInMonth(month, st.end_day)) }; // V26.81 : fin de période un week-end / férié → premier jour ouvré suivant (24 → 26)
  }

  /* ---------- Jours fériés (France métropolitaine) ---------- */
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return y + '-' + pad(mo) + '-' + pad(da);
  }
  const holidayCache = {};
  function holidays(y) {
    if (holidayCache[y]) return holidayCache[y];
    const e = easter(y);
    return (holidayCache[y] = new Map([
      [y + '-01-01', "Jour de l'an"], [addDays(e, 1), 'Lundi de Pâques'], [y + '-05-01', 'Fête du travail'],
      [y + '-05-08', 'Victoire 1945'], [addDays(e, 39), 'Ascension'], [addDays(e, 50), 'Lundi de Pentecôte'],
      [y + '-07-14', 'Fête nationale'], [y + '-08-15', 'Assomption'], [y + '-11-01', 'Toussaint'],
      [y + '-11-11', 'Armistice'], [y + '-12-25', 'Noël']
    ]));
  }
  function holidayName(s) { return holidays(Number(s.slice(0, 4))).get(s) || null; }

  /* ---------- Durées ---------- */
  function fmtMin(m) {
    m = Math.round(m || 0);
    const neg = m < 0; m = Math.abs(m);
    const h = Math.floor(m / 60), r = m % 60;
    const s = h === 0 ? r + ' min' : (r === 0 ? h + 'h' : h + 'h' + pad(r));
    return (neg ? '-' : '') + s;
  }
  function fmtClock(m) { m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function parseClock(s) { const m = String(s || '09:00').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 540; }
  /* Durée saisie → minutes. "1h30", "1:30", "45 min", "1,5" (heures), 2 (heures), 90 (minutes).
   * Règle des nombres seuls : ≤ 12 = heures, > 12 = minutes. Retourne NaN si illisible. */
  function parseDuration(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') {
      if (!isFinite(v) || v < 0) return NaN;
      return v <= 12 ? Math.round(v * 60) : Math.round(v);
    }
    const s = String(v).trim().toLowerCase().replace(/\s+/g, '').replace(',', '.');
    if (!s || s === '-') return 0;
    let m;
    if ((m = s.match(/^(\d+(?:\.\d+)?)h(\d{1,2})?(?:min|mn|m)?$/))) return Math.round(parseFloat(m[1]) * 60 + (m[2] ? parseInt(m[2], 10) : 0));
    if ((m = s.match(/^(\d+):(\d{2})(?::\d{2})?$/))) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    if ((m = s.match(/^(\d+(?:\.\d+)?)(?:min|mn|m)$/))) return Math.round(parseFloat(m[1]));
    if (/^\d+(?:\.\d+)?$/.test(s)) return parseDuration(parseFloat(s));
    return NaN;
  }
  function parseDay(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v >= 1 && v <= 31 ? Math.round(v) : NaN;
    const s = String(v).trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return Number(m[3]);
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})([\/.\-]\d{2,4})?$/))) return Number(m[1]);
    if ((m = s.match(/(\d{1,2})/))) { const n = Number(m[1]); return n >= 1 && n <= 31 ? n : NaN; }
    return NaN;
  }
  function parsePriority(v) {
    if (v === null || v === undefined || v === '') return 2;
    const s = String(v).trim().toLowerCase();
    if (/^1|haut|urgent|élev|elev|forte/.test(s)) return 1;
    if (/^3|bas|faible/.test(s)) return 3;
    if (/^2|norm|moy/.test(s)) return 2;
    return NaN;
  }
  function parseFrequency(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s || s.startsWith('mens') || s === 'm') return 'mensuel';
    if (s.startsWith('trim') || s === 't') return 'trimestriel';
    if (s.startsWith('ann') || s === 'a') return 'annuel';
    return null;
  }
  const PRIORITY_LABEL = { 1: 'Haute', 2: 'Normale', 3: 'Basse' };
  const FREQ_LABEL = { mensuel: 'Mensuelle', trimestriel: 'Trimestrielle', annuel: 'Annuelle' };

  /* ---------- Obligations déclaratives : TVA (CA3 / CA12), DEB, DES ----------
   * CA3 mensuelle : chaque mois, au jour d'échéance du client ; CA3 trimestrielle : mois de trimestre ;
   * CA12 : déclaration annuelle en mai (2e jour ouvré après le 1er mai), acomptes en juillet et décembre ;
   * DEB : 10e jour ouvré du mois ; DES : le 10 du mois. */
  const VAT_REGIMES = { ca3_mensuel: 'CA3 mensuelle', ca3_trimestriel: 'CA3 trimestrielle', ca12: 'CA12 annuelle', aucun: 'Pas de TVA' };
  const OBLIG_LABEL = { CA3: 'TVA CA3', CA12: 'CA12 annuelle', ACPT: 'Acompte CA12', DEB: 'DEB', DES: 'DES' };
  const FILING_VIA = { jedeclare: 'Validée sur jedeclare.com', impots: 'Faite sur impots.gouv' };
  function isWorkday(d) { return dow(d) <= 5 && !holidayName(d); }
  function nextWorkday(d) { for (let i = 0; i < 10 && !isWorkday(d); i++) d = addDays(d, 1); return d; }
  function receptionDate(client, month, st) { return nextWorkday(dateInMonth(month, client.reception_day || st.start_day)); }
  function nthWorkday(from, n) { let d = from, k = 0; for (let i = 0; i < 40; i++, d = addDays(d, 1)) { if (isWorkday(d) && ++k === n) return d; } return d; }
  function parseRegime(v) {
    const s = String(v || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!s || /ca3.*mens|^mens|^ca3$/.test(s)) return 'ca3_mensuel';
    if (/trim/.test(s)) return 'ca3_trimestriel';
    if (/ca12|annu|simplif/.test(s)) return 'ca12';
    if (/aucun|franchise|^non|exon|sans|pas de|^pas/.test(s)) return 'aucun';
    return null;
  }
  const parseYes = v => /^(oui|o|x|yes|1|vrai|true)$/i.test(String(v === undefined || v === null ? '' : v).trim());
  function obligations(client, month, settings) {
    const st = Object.assign({}, DEFAULT_SETTINGS, settings), m = Number(month.slice(5, 7)), out = [];
    const reg = client.vat_regime || 'ca3_mensuel', tvaDue = nextWorkday(dateInMonth(month, client.vat_due_day || st.end_day)); // V26.80 : échéance un samedi, dimanche ou férié → premier jour ouvré suivant (ex. 24 → 26)
    if (reg === 'ca3_mensuel') out.push({ code: 'CA3', due: tvaDue });
    else if (reg === 'ca3_trimestriel' && st.quarter_months.includes(m)) out.push({ code: 'CA3', due: tvaDue });
    else if (reg === 'ca12') { if (m === 5) out.push({ code: 'CA12', due: nthWorkday(month + '-02', 2) }); if (m === 7 || m === 12) out.push({ code: 'ACPT', due: tvaDue }); }
    if (client.deb) out.push({ code: 'DEB', due: nthWorkday(month + '-01', 10) });
    if (client.des) out.push({ code: 'DES', due: nextWorkday(month + '-10') });
    return out.map(o => Object.assign(o, { label: OBLIG_LABEL[o.code] }));
  }
  /* Échéance de la production du mois = la plus proche de ses obligations (sinon la fin de période). */
  function productionDue(client, month, settings) {
    const st = Object.assign({}, DEFAULT_SETTINGS, settings), ob = obligations(client, month, st);
    return ob.length ? ob.map(o => o.due).sort()[0] : nextWorkday(dateInMonth(month, st.end_day));
  }

  /* ---------- Capacité ---------- */
  function makeCtx(data) {
    const settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    const absByCollab = new Map();
    for (const a of data.absences || []) {
      if (!absByCollab.has(a.collaborator_id)) absByCollab.set(a.collaborator_id, []);
      absByCollab.get(a.collaborator_id).push(a);
    }
    return { settings, absByCollab };
  }
  const PRES = new WeakMap();
  function presenceSet(collab) {
    const arr = collab.presence_dates || [], hit = PRES.get(collab);
    if (hit && hit.arr === arr) return hit.set;
    const set = new Set(arr); PRES.set(collab, { arr, set }); return set;
  }
  /* Minutes disponibles d'un collaborateur un jour donné (réserve pour imprévus déduite, sauf raw). */
  function capacityOn(collab, date, ctx, raw) {
    if (!collab || collab.active === false) return 0;
    if (dow(date) >= 6) return 0; // samedi et dimanche : jamais travaillés
    const wd = collab.work_days && collab.work_days.length ? collab.work_days : [1, 2, 3, 4, 5];
    if (!wd.includes(dow(date))) return 0;
    if (ctx.settings.holidays && holidayName(date)) return 0;
    if (collab.kind === 'apprenti' && !presenceSet(collab).has(date)) return 0; // apprenti : uniquement ses jours en entreprise
    let cap = baseOn(collab, date, ctx.settings);
    const base = cap;
    for (const a of ctx.absByCollab.get(collab.id) || []) {
      if (a.date_from <= date && date <= (a.date_to || a.date_from)) {
        // V26.211 : demi-journée (type « conge|am » = matin, « conge|pm » = après-midi)
        const half = absHalf(a);
        if (half) { const am = morningMin(base, ctx.settings); cap -= half === 'am' ? am : base - am; continue; }
        if (a.minutes === null || a.minutes === undefined || a.minutes === '') return 0;
        cap -= Number(a.minutes) || 0;
      }
    }
    if (raw) return Math.max(0, cap);
    return Math.max(0, cap - reserveOf(collab, ctx.settings));
  }
  /* V26.207 — Temps réservé chaque jour aux imprévus (en minutes) : réglage de la personne, sinon celui du cabinet. */
  function reserveOf(collab, settings) {
    if (!collab || collab.kind === 'apprenti') return 0; // V26.207 : jamais d'imprévus réservés pour un apprenti
    const st = settings || {}, by = st.reserve_min_by || {}, v = by[collab.id] !== undefined && by[collab.id] !== null && by[collab.id] !== '' ? by[collab.id] : st.reserve_min;
    return Math.min(240, Math.max(0, Math.round(Number(v) || 0)));
  }
  const prodDayCap = (collab, settings) => Math.max(0, (collab ? Math.max(...weekHours(collab, settings)) : 0) - reserveOf(collab, settings));
  /* V26.208 — Horaires de la semaine (lundi → vendredi, en minutes) :
   * horaires propres à la personne (hours_by), sinon contrat (contract_hours) : 39 h = 8 h du lundi au jeudi + 7 h le vendredi
   * (RC, collaborateurs), 35 h = 7 h par jour (apprentis) ; sinon la capacité par jour de la fiche. */
  const CONTRACT = { full: [480, 480, 480, 480, 420], apprenti: [420, 420, 420, 420, 420] };
  function weekHours(collab, settings) {
    const st = settings || {}, own = collab && (st.hours_by || {})[collab.id];
    if (Array.isArray(own) && own.length === 5) return own.map(n => Math.max(0, Math.round(Number(n) || 0)));
    if (st.contract_hours && collab) return (collab.kind === 'apprenti' ? CONTRACT.apprenti : CONTRACT.full).slice();
    const d = Number(collab && collab.daily_capacity_min) || 0; return [d, d, d, d, d];
  }
  function baseOn(collab, date, settings) { const w = dow(date); return w <= 5 ? weekHours(collab, settings)[w - 1] : 0; }
  /* V26.206 — Dossier « en attente du client » : retiré du planning jusqu'à la réponse */
  const onHold = p => !!(p && p.filing && p.filing.wait);
  /* V26.211 — Demi-journées d'absence : le matin va du début de journée à la pause déjeuner */
  const absHalf = a => { const h = String((a && a.kind) || '').split('|')[1]; return h === 'am' || h === 'pm' ? h : ''; };
  const morningMin = (base, settings) => Math.max(0, Math.min(base, parseClock((settings || {}).lunch_start || '12:30') - parseClock((settings || {}).day_start || '09:00')));
  function absenceOn(collabId, date, ctx) {
    return (ctx.absByCollab.get(collabId) || []).find(a => a.date_from <= date && date <= (a.date_to || a.date_from)) || null;
  }

  /* ---------- Génération du mois ---------- */
  function clientApplies(client, month, settings) {
    const st = Object.assign({}, DEFAULT_SETTINGS, settings);
    const m = Number(month.slice(5, 7));
    if (client.frequency === 'trimestriel') return st.quarter_months.includes(m);
    if (client.frequency === 'annuel') return m === Number(st.annual_month);
    return true;
  }
  /* Temps de production d'un dossier (valeur unique ; repli sur l'ancien découpage tenue/lettrage/TVA). */
  function clientTime(c) {
    if (!c) return 0;
    const t = Number(c.time_min);
    if (t > 0) return t;
    return (Number(c.time_tenue) || 0) + (Number(c.time_lettrage) || 0) + (Number(c.time_tva) || 0);
  }
  /* Crée les productions + tâches manquantes du mois (sans les planifier) : une tâche « production » par dossier. */
  function buildMonth(month, clients, existingProductions, settings, newId, withNominal) {
    const st = Object.assign({}, DEFAULT_SETTINGS, settings);
    const have = new Set(existingProductions.filter(p => p.month === month).map(p => p.client_id));
    const productions = [], tasks = [];
    for (const c of clients) {
      if (c.active === false || have.has(c.id) || !clientApplies(c, month, st)) continue;
      const pid = newId();
      const due = productionDue(c, month, st);
      productions.push(Object.assign({
        id: pid, client_id: c.id, month,
        expected_date: receptionDate(c, month, st),
        received_date: null, status: 'attendu'
      }, withNominal ? { nominal_date: receptionDate(c, month, st) } : {}));
      const dur = clientTime(c);
      if (dur > 0) tasks.push(productionTask(newId(), pid, c, month, dur, due));
    }
    return { productions, tasks };
  }
  function productionTask(id, pid, c, month, dur, due) {
    return { id, production_id: pid, client_id: c.id, month, kind: 'production', collaborator_id: c.collaborator_id || null, planned_date: null, seq: 0, duration_min: dur, due_date: due, locked: false, done: false, done_at: null, alloc: null };
  }

  /* ---------- Répartition d'une tâche sur plusieurs jours ----------
   * alloc = { 'YYYY-MM-DD': minutes } quand un dossier dépasse une journée ; sinon null (tout sur planned_date). */
  function hasAlloc(t) { return !!(t && t.alloc && typeof t.alloc === 'object' && Object.keys(t.alloc).length); }
  function segs(t) {
    if (hasAlloc(t)) return Object.keys(t.alloc).sort().map(d => ({ d, m: Number(t.alloc[d]) || 0 }));
    return t.planned_date ? [{ d: t.planned_date, m: Number(t.duration_min) || 0 }] : [];
  }
  function minutesOn(t, d) { if (hasAlloc(t)) return Number(t.alloc[d]) || 0; return t.planned_date === d ? (Number(t.duration_min) || 0) : 0; }
  function endDate(t) { const s = segs(t); return s.length ? s[s.length - 1].d : null; }
  function onDay(t, d) { return hasAlloc(t) ? t.alloc[d] !== undefined : t.planned_date === d; }
  /* Étalement « manuel » d'une tâche longue à partir d'une date : journées complètes du collaborateur,
   * puis jours ouvrés suivants (sans tenir compte des autres tâches). */
  function spread(collab, start, dur, ctx, limit) {
    const cap0 = prodDayCap(collab, ctx.settings);
    if (!collab || !start || dur <= cap0) return null;
    const alloc = {}; let rest = dur;
    for (let d = start, i = 0; rest > 0 && i < 90; d = addDays(d, 1), i++) {
      const cap = capacityOn(collab, d, ctx); if (cap <= 0) continue;
      const take = Math.min(cap, rest); alloc[d] = take; rest -= take;
      if (limit && d >= limit && rest > 0) { alloc[d] += rest; rest = 0; }
    }
    return alloc;
  }

  /* ---------- Planification ----------
   * mode 'full'        : toutes les tâches non verrouillées et non terminées sont recalculées.
   * mode 'incremental' : les tâches des dossiers déjà reçus restent en place ; seuls les dossiers
   *                      nouvellement reçus (newlyReceived), les tâches prévisionnelles et les tâches
   *                      non planifiées sont (re)placés.
   * Dans les deux modes, les tâches verrouillées, terminées et celles prévues aujourd'hui restent en place.
   * Règles : jamais avant la réception (réelle, sinon prévisionnelle) ni avant aujourd'hui ;
   * dossiers reçus d'abord, puis échéance, priorité, date de réception ;
   * un dossier qui tient dans une journée est placé le premier jour où il reste assez de capacité ;
   * un dossier plus long qu'une journée démarre sur un jour libre et continue les jours ouvrés suivants ;
   * une demande d'informations (45 min par défaut) est planifiée dès que possible, indépendamment. */
  const SPLIT_MIN = 30; // V26.89 : une partie de dossier coupé fait au moins 30 min
  function plan(input) {
    const { month, collaborators, clients, productions, tasks, today } = input;
    const mode = input.mode || 'full';
    const newly = input.newlyReceived || new Set();
    const ctx = makeCtx(input);
    const win = windowOf(month, ctx.settings);
    const floor = today > win.start ? today : win.start;
    const collabById = new Map(collaborators.map(c => [c.id, c]));
    const clientById = new Map(clients.map(c => [c.id, c]));
    const prodById = new Map(productions.map(p => [p.id, p]));
    const kindIdx = k => KINDS.indexOf(k);

    const freezeUntil = input.force ? null : (input.freezeUntil || today);
    const isFixed = t => {
      if (t.locked || t.done) return true;
      const p = prodById.get(t.production_id), rec = isReceived(t, p);
      if (onHold(p) && t.kind !== 'info') return false; // V26.206 : en attente du client → retiré, même dans la zone figée
      // Zone figée (aujourd'hui + jours suivants) : un dossier reçu déjà placé n'est pas bousculé,
      // sauf replanification forcée ou collaborateur indisponible ce jour-là.
      if (freezeUntil && rec && t.planned_date && t.planned_date >= today && t.planned_date <= freezeUntil
        && capacityOn(collabById.get(t.collaborator_id), t.planned_date, ctx) > 0) return true;
      if (mode === 'incremental') return !!(p && rec && !newly.has(p.id) && t.planned_date);
      return false;
    };
    const movable = tasks.filter(t => t.month === month && !isFixed(t));
    const movableIds = new Set(movable.map(t => t.id));

    const used = new Map(), seqMax = new Map();
    const key = (c, d) => c + '|' + d;
    for (const t of tasks) {
      if (movableIds.has(t.id) || !t.collaborator_id) continue;
      for (const s of segs(t)) {
        const k = key(t.collaborator_id, s.d);
        used.set(k, (used.get(k) || 0) + s.m);
        seqMax.set(k, Math.max(seqMax.get(k) || 0, Number(t.seq) || 0));
      }
    }

    const gk = t => t.production_id || 't:' + t.id;
    const groups = new Map();
    for (const t of movable) {
      if (!groups.has(gk(t))) groups.set(gk(t), []);
      groups.get(gk(t)).push(t);
    }
    // Date à partir de laquelle une tâche peut être traitée : réception (totale ou partielle), sinon date prévue.
    // Planning prospectif : des éléments attendus mais pas encore reçus ne sont jamais prévus avant demain.
    const readyOf = (t, p) => {
      const r = t.received_date || (p && p.received_date);
      if (r) return r;
      const e = (p && p.expected_date) || win.start;
      return e <= today ? addDays(today, 1) : e;
    };
    const partIdx = t => (t.part === 'recu' ? 0 : t.part === 'reste' ? 2 : 1);
    const order = [...groups.keys()].map(pid => {
      const p = prodById.get(pid) || {}, c = clientById.get(p.client_id) || {}, ts = groups.get(pid);
      const due = ts.reduce((m, t) => (t.due_date && t.due_date < m ? t.due_date : m), '9999-12-31');
      const ready = ts.reduce((m, t) => { const r = readyOf(t, p); return r < m ? r : m; }, '9999-12-31');
      // Dossiers reçus (même en partie) d'abord : ils passent devant les dossiers seulement attendus
      return { pid, k: [ts.some(t => isReceived(t, p)) ? 0 : 1, due, Number(c.priority) || 2, ready, c.name || ''] };
    }).sort((a, b) => {
      // V26.160 : priorité à la production — les tableaux de bord sont placés en dernier
      const da = groups.get(a.pid).every(t => t.kind === 'dashboard') ? 1 : 0, db = groups.get(b.pid).every(t => t.kind === 'dashboard') ? 1 : 0;
      if (da !== db) return da - db;
      for (let i = 0; i < a.k.length; i++) { if (a.k[i] < b.k[i]) return -1; if (a.k[i] > b.k[i]) return 1; }
      return 0;
    });

    // Cherche l'emplacement d'une tâche : un seul jour si elle tient dans une journée, sinon étalement.
    function findSpot(collab, start, dur, until) {
      const end = until || win.end;
      const dayCap = prodDayCap(collab, ctx.settings);
      if (dur <= dayCap) {
        const rem = d => Math.max(0, capacityOn(collab, d, ctx) - (used.get(key(collab.id, d)) || 0));
        for (let d = start; d <= end; d = addDays(d, 1)) {
          const cap = capacityOn(collab, d, ctx);
          if (cap <= 0) continue;
          const r1 = rem(d);
          if (r1 >= dur) return { date: d, alloc: null };
          // V26.89 : ne tient pas dans la journée → coupé en 2 parties maximum, sur ce jour et le jour travaillé suivant
          if (r1 >= SPLIT_MIN && dur - r1 >= SPLIT_MIN) {
            let d2 = addDays(d, 1); while (d2 <= end && capacityOn(collab, d2, ctx) <= 0) d2 = addDays(d2, 1);
            if (d2 <= end && rem(d2) >= dur - r1) return { date: d, alloc: { [d]: r1, [d2]: dur - r1 } };
          }
        }
        return null;
      }
      // Dossier plus long qu'une journée : démarre sur un jour entièrement libre, continue les jours ouvrés suivants.
      for (let d0 = start; d0 <= end; d0 = addDays(d0, 1)) {
        const cap0 = capacityOn(collab, d0, ctx);
        if (cap0 <= 0 || (used.get(key(collab.id, d0)) || 0) > 0) continue;
        const alloc = {}; let rest = dur;
        for (let d = d0; d <= end && rest > 0; d = addDays(d, 1)) {
          const cap = capacityOn(collab, d, ctx); if (cap <= 0) continue;
          const take = Math.min(cap - (used.get(key(collab.id, d)) || 0), rest);
          if (take > 0) { alloc[d] = take; rest -= take; }
        }
        if (rest <= 0) return { date: d0, alloc };
      }
      return null;
    }

    const placed = new Map(); // id -> {planned_date, seq, alloc}
    const unplanned = [];
    for (const { pid } of order) {
      const p = prodById.get(pid);
      const fixedSame = tasks.filter(t => gk(t) === pid && !movableIds.has(t.id) && t.planned_date);
      const list = groups.get(pid).sort((a, b) => kindIdx(a.kind) - kindIdx(b.kind) || partIdx(a) - partIdx(b));
      const before = (f, t) => kindIdx(f.kind) < kindIdx(t.kind) || (f.kind === t.kind && partIdx(f) < partIdx(t));
      let prev = floor;
      for (const t of list) {
        const independent = t.kind === 'info'; // la demande d'infos ne dépend pas de l'avancement de la production
        if (!independent && onHold(p)) { unplanned.push({ id: t.id, reason: 'En attente du client' }); placed.set(t.id, { planned_date: null, seq: 0, alloc: null }); continue; }
        let ready = readyOf(t, p);
        if (ready < floor) ready = floor;
        let start = independent || prev < ready ? ready : prev;
        if (!independent) for (const f of fixedSame) { const fe = endDate(f); if (f.kind !== 'info' && before(f, t) && fe > start) start = fe; }
        const collab = collabById.get(t.collaborator_id);
        const dur = Number(t.duration_min) || 0;
        let spot = null;
        if (collab && t.kind === 'dashboard') {
          // V26.160 : un tableau de bord commence toujours après la période de production (le 24, ou le jour ouvré suivant)
          // et après la production du dossier ce mois-ci (jamais avant).
          let s = addDays(win.end, 1);
          for (const q of tasks) {
            if (q.client_id !== t.client_id || q.month !== t.month || q.kind === 'dashboard' || q.kind === 'info') continue;
            const pl = placed.get(q.id), qe = pl ? (pl.alloc ? Object.keys(pl.alloc).sort().pop() : pl.planned_date) : endDate(q);
            if (qe && qe >= s) s = addDays(qe, 1);
          }
          if (start > s) s = start;
          const lim = t.due_date && t.due_date >= s ? t.due_date : addDays(s, 21);
          spot = findSpot(collab, s, dur, lim) || findSpot(collab, s, dur, addDays(s, 31));
          if (!spot) { unplanned.push({ id: t.id, reason: 'Aucune place après la production (fin de période le ' + Number(win.end.slice(8)) + ')' }); placed.set(t.id, { planned_date: null, seq: 0, alloc: null }); continue; }
        }        if (!spot && collab) spot = findSpot(collab, start, dur);
        if (!spot) {
          const reason = !collab ? 'Aucun collaborateur actif' : (start > win.end ? 'Éléments attendus après la période' : 'Capacité insuffisante avant le ' + Number(win.end.slice(8)));
          unplanned.push({ id: t.id, reason }); placed.set(t.id, { planned_date: null, seq: 0, alloc: null });
          continue;
        }
        const days = spot.alloc ? Object.keys(spot.alloc) : [spot.date];
        let s0 = 0;
        for (const d of days) {
          const k = key(collab.id, d), m = spot.alloc ? spot.alloc[d] : dur;
          used.set(k, (used.get(k) || 0) + m);
          const s = (seqMax.get(k) || 0) + 1; seqMax.set(k, s); if (!s0) s0 = s;
        }
        placed.set(t.id, { planned_date: spot.date, seq: s0, alloc: spot.alloc });
        if (!independent) prev = days[days.length - 1];
      }
    }

    const changes = [], moved = [];
    const aKey = a => (a && Object.keys(a).length ? JSON.stringify(Object.keys(a).sort().map(k => [k, a[k]])) : '');
    for (const t of movable) {
      const n = placed.get(t.id) || { planned_date: null, seq: 0, alloc: null };
      const dateChanged = (t.planned_date || null) !== n.planned_date;
      const allocChanged = aKey(t.alloc) !== aKey(n.alloc);
      if (dateChanged || allocChanged || (Number(t.seq) || 0) !== n.seq) changes.push({ id: t.id, planned_date: n.planned_date, seq: n.seq, alloc: n.alloc || null });
      if (dateChanged || allocChanged) moved.push({ id: t.id, from: t.planned_date || null, to: n.planned_date });
    }
    // Échéances problématiques après application (par dossier)
    const problems = new Map();
    for (const t of tasks) {
      if (t.month !== month || t.done) continue;
      const n = placed.get(t.id);
      const end = n ? (n.alloc ? Object.keys(n.alloc).sort().pop() : n.planned_date) : endDate(t);
      let reason = null;
      if (!end) reason = 'non planifié';
      else if (t.due_date && end > t.due_date) reason = 'planifié après l\'échéance';
      if (reason && !problems.has(t.production_id || t.id)) problems.set(t.production_id || t.id, { production_id: t.production_id, client_id: t.client_id, reason });
    }
    return {
      changes, moved, unplanned,
      lockedCount: tasks.filter(t => t.month === month && t.locked && !t.done).length,
      doneCount: tasks.filter(t => t.month === month && t.done).length,
      problems: [...problems.values()],
      window: win
    };
  }

  /* ---------- Charge & indicateurs ---------- */
  function loadOf(tasks, collabId, date) {
    let todo = 0, done = 0;
    for (const t of tasks) {
      if (collabId && t.collaborator_id !== collabId) continue;
      const m = minutesOn(t, date);
      if (!m) continue;
      if (t.done) done += m; else todo += m;
    }
    return { todo, done, total: todo + done };
  }
  function levelOf(total, cap, settings) {
    const warn = (settings && settings.warn_pct) || DEFAULT_SETTINGS.warn_pct;
    if (cap <= 0) return total > 0 ? 'red' : 'off';
    const pct = total / cap * 100;
    if (pct > 100) return 'red';
    if (pct >= warn) return 'orange';
    return 'green';
  }
  function isReceived(t, p) { return !!(t.received_date || (p && p.received_date)); }
  function productionStatus(p, ptasks) {
    if (ptasks.length && ptasks.every(t => t.done)) return 'termine';
    if (!p.received_date) return p.partial_date || ptasks.some(t => t.received_date) ? 'partiel' : 'attendu';
    if (ptasks.some(t => t.done)) return 'en_cours';
    if (ptasks.every(t => t.planned_date)) return 'planifie';
    return 'recu';
  }
  const STATUS_LABEL = { attendu: 'Attendu', partiel: 'Reçu en partie', recu: 'Reçu', planifie: 'Planifié', en_cours: 'En cours', termine: 'Terminé' };

  /* Alertes. data : {tasks, productions, clients, collaborators, absences, settings}. */
  function alerts(data, today, opts) {
    opts = opts || {};
    const ctx = makeCtx(data);
    const out = [];
    const clientById = new Map(data.clients.map(c => [c.id, c]));
    const collabById = new Map(data.collaborators.map(c => [c.id, c]));
    const month = opts.month;
    const inScope = t => (!month || t.month === month) && (!opts.collabId || t.collaborator_id === opts.collabId);
    const tasks = data.tasks.filter(inScope);
    const seenProd = new Set();
    const cname = id => (clientById.get(id) || {}).name || '?';
    // Échéances, retards, non planifiés
    for (const t of tasks) {
      if (t.done) continue;
      const tag = t.production_id + ':';
      if (!t.planned_date) {
        if (!seenProd.has(tag + 'u')) { seenProd.add(tag + 'u'); out.push({ type: 'unplanned', icon: '⚠️', level: 'warn', client_id: t.client_id, task_id: t.id, text: cname(t.client_id) + ' — dossier non planifié' }); }
      } else if (endDate(t) < today) {
        if (!seenProd.has(tag + 'l')) { seenProd.add(tag + 'l'); out.push({ type: 'late', icon: '⚠️', level: 'bad', client_id: t.client_id, task_id: t.id, text: cname(t.client_id) + ' — retard (' + KIND_LABEL[t.kind] + ' prévue le ' + Number(t.planned_date.slice(8)) + ')' }); }
      } else if (t.due_date && endDate(t) > t.due_date) {
        if (!seenProd.has(tag + 'a')) { seenProd.add(tag + 'a'); out.push({ type: 'late', icon: '⚠️', level: 'bad', client_id: t.client_id, task_id: t.id, text: cname(t.client_id) + ' — planifié après l\'échéance du ' + Number(t.due_date.slice(8)) }); }
      }
      if (t.due_date && t.due_date >= today && daysBetween(today, t.due_date) <= ctx.settings.due_soon_days) {
        if (!seenProd.has(tag + 'd')) { seenProd.add(tag + 'd'); out.push({ type: 'due', icon: '⚠️', level: 'warn', client_id: t.client_id, task_id: t.id, text: cname(t.client_id) + ' — échéance TVA proche (' + (t.due_date === today ? "aujourd'hui" : 'le ' + Number(t.due_date.slice(8))) + ')' }); }
      } else if (t.due_date && t.due_date < today && !seenProd.has(tag + 'o')) {
        seenProd.add(tag + 'o'); out.push({ type: 'late', icon: '⚠️', level: 'bad', client_id: t.client_id, task_id: t.id, text: cname(t.client_id) + ' — échéance TVA dépassée (' + Number(t.due_date.slice(8)) + ')' });
      }
    }
    // Réceptions en retard / nouvelles réceptions
    for (const p of data.productions) {
      if (month && p.month !== month) continue;
      const c = clientById.get(p.client_id);
      if (!c || (opts.collabId && c.collaborator_id !== opts.collabId)) continue;
      if (!p.received_date && p.expected_date && p.expected_date < today) out.push({ type: 'late', icon: '⚠️', level: 'bad', client_id: c.id, text: c.name + ' — éléments attendus le ' + Number(p.expected_date.slice(8)) + ', non reçus' });
      if (p.received_date && daysBetween(p.received_date, today) <= 1 && p.received_date <= today) out.push({ type: 'received', icon: '🔵', level: 'info', client_id: c.id, text: c.name + ' — nouveaux éléments reçus le ' + Number(p.received_date.slice(8)) });
      // Obligations déclaratives non déposées : alerte à J-3 (réglable), puis retard
      for (const o of obligations(c, p.month, ctx.settings)) {
        if (p.filing && p.filing[o.code]) continue;
        const j = daysBetween(today, o.due);
        if (j < 0) out.push({ type: 'filing', icon: '⚠️', level: 'bad', client_id: c.id, text: c.name + ' — ' + o.label + ' non déposée (échéance ' + Number(o.due.slice(8)) + ')' });
        else if (j <= ctx.settings.due_soon_days) out.push({ type: 'filing', icon: '⚠️', level: 'warn', client_id: c.id, text: c.name + ' — ' + o.label + ' à déposer ' + (j === 0 ? 'aujourd\'hui' : 'avant le ' + Number(o.due.slice(8)) + ' (J-' + j + ')') });
      }
    }
    // Surcharges (jours à venir de la période)
    const collabs = data.collaborators.filter(c => c.active !== false && (!opts.collabId || c.id === opts.collabId));
    const months = month ? [month] : [...new Set(data.tasks.map(t => t.month))];
    for (const m of months) {
      const win = windowOf(m, ctx.settings);
      const from = today > win.start ? today : win.start;
      for (const c of collabs) {
        for (let d = from; d <= win.end; d = addDays(d, 1)) {
          const l = loadOf(data.tasks, c.id, d);
          if (!l.todo) continue;
          const cap = capacityOn(c, d, ctx);
          const lv = levelOf(l.total, cap, ctx.settings);
          const pct = cap > 0 ? Math.round(l.total / cap * 100) : 999; // V26.185 : taux de remplissage joint à l'alerte
          if (lv === 'red') out.push({ type: 'overload', icon: '🔴', level: 'bad', collab_id: c.id, date: d, pct, text: c.name + ' — surcharge le ' + Number(d.slice(8)) + ' (' + fmtMin(l.total) + ' / ' + fmtMin(cap) + ')' });
          else if (lv === 'orange') out.push({ type: 'near', icon: '🟠', level: 'warn', collab_id: c.id, date: d, text: c.name + ' — capacité presque atteinte le ' + Number(d.slice(8)) + ' (' + fmtMin(l.total) + ' / ' + fmtMin(cap) + ')' });
        }
      }
    }
    // Projection de fin de période : à partir du jour d'alerte, prévenir si l'équipe ne tiendra pas l'échéance
    const pm = month || today.slice(0, 7);
    if (today.slice(0, 7) === pm && Number(today.slice(8)) >= ctx.settings.alert_from_day && today <= windowOf(pm, ctx.settings).end) {
      for (const r of projection(data, pm, today).team) {
        if (opts.collabId && r.collab.id !== opts.collabId) continue;
        if (r.balance < 0) out.push({ type: 'projection', icon: '📉', level: 'bad', collab_id: r.collab.id, text: r.collab.name + ' — ' + fmtMin(-r.balance) + ' de travail en trop d\'ici le ' + ctx.settings.end_day + ' : répartir sur l\'équipe' });
      }
    }
    const rank = { bad: 0, warn: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  /* Projection jusqu'à la fin de période : capacité restante face au reste à faire, par collaborateur. */
  function projection(data, month, today) {
    const ctx = makeCtx(data), win = windowOf(month, ctx.settings);
    const from = today > win.start ? today : win.start;
    const open = data.tasks.filter(t => t.month === month && !t.done);
    const team = data.collaborators.filter(c => c.active !== false).map(c => {
      let capRest = 0;
      for (let d = from; d <= win.end; d = addDays(d, 1)) capRest += capacityOn(c, d, ctx);
      const mine = open.filter(t => t.collaborator_id === c.id);
      const todo = mine.reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
      return { collab: c, capRest, todo, balance: capRest - todo, unplanned: mine.filter(t => !t.planned_date) };
    });
    return { window: win, from, team, deficit: team.filter(r => r.balance < 0) };
  }
  /* Propositions de transfert de dossiers : du collaborateur en dépassement (ou avec des dossiers non planifiés)
   * vers le collaborateur qui a le plus de marge d'ici la fin de période. */
  function suggestTransfers(data, month, today) {
    const pj = projection(data, month, today);
    const bal = new Map(pj.team.map(r => [r.collab.id, r.balance]));
    const out = [];
    for (const r of pj.team.filter(x => x.balance < 0 || x.unplanned.length).sort((a, b) => a.balance - b.balance)) {
      const cands = data.tasks.filter(t => t.month === month && !t.done && !t.locked && t.kind !== 'info' && t.collaborator_id === r.collab.id)
        .sort((a, b) => (a.planned_date ? 1 : 0) - (b.planned_date ? 1 : 0) || (b.planned_date || '').localeCompare(a.planned_date || ''));
      for (const t of cands) {
        if (bal.get(r.collab.id) >= 0 && t.planned_date) break;
        const dur = Number(t.duration_min) || 0;
        const to = pj.team.filter(x => x.collab.id !== r.collab.id && bal.get(x.collab.id) >= dur).sort((a, b) => bal.get(b.collab.id) - bal.get(a.collab.id))[0];
        if (!to) continue;
        out.push({ task: t, from: r.collab, to: to.collab, dur });
        bal.set(r.collab.id, bal.get(r.collab.id) + dur);
        bal.set(to.collab.id, bal.get(to.collab.id) - dur);
        if (out.length >= 8) return out;
      }
    }
    return out;
  }

  /* Tableau de bord du mois. */
  function dashboard(data, month, today) {
    const ctx = makeCtx(data);
    const win = windowOf(month, ctx.settings);
    const tasks = data.tasks.filter(t => t.month === month);
    const prods = data.productions.filter(p => p.month === month);
    const byProd = new Map();
    for (const t of tasks) { if (!byProd.has(t.production_id)) byProd.set(t.production_id, []); byProd.get(t.production_id).push(t); }
    const late = p => {
      const ts = byProd.get(p.id) || [];
      return (!p.received_date && p.expected_date < today) || ts.some(t => !t.done && ((t.planned_date && endDate(t) < today) || (t.due_date && t.due_date < today) || (t.planned_date && t.due_date && endDate(t) > t.due_date)));
    };
    const from = today > win.start ? today : win.start;
    const collabs = data.collaborators.filter(c => c.active !== false);
    const per = collabs.map(c => {
      const mine = tasks.filter(t => t.collaborator_id === c.id);
      let cap = 0, capRest = 0;
      for (let d = win.start; d <= win.end; d = addDays(d, 1)) { const x = capacityOn(c, d, ctx); cap += x; if (d >= from) capRest += x; }
      const total = mine.reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
      const todo = mine.filter(t => !t.done).reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
      return { collab: c, cap, total, todo, done: total - todo, remaining: capRest - todo, fill: cap ? Math.round(total / cap * 100) : 0, unplanned: mine.filter(t => !t.done && !t.planned_date).length };
    });
    const sum = f => per.reduce((s, x) => s + x[f], 0);
    const totalAll = tasks.reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
    const todoAll = tasks.filter(t => !t.done).reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
    const capAll = sum('cap');
    return {
      window: win,
      productions: {
        total: prods.length,
        received: prods.filter(p => p.received_date).length,
        planned: prods.filter(p => { const ts = byProd.get(p.id) || []; return ts.length && ts.every(t => t.done || t.planned_date); }).length,
        done: prods.filter(p => { const ts = byProd.get(p.id) || []; return ts.length && ts.every(t => t.done); }).length,
        late: prods.filter(late).length
      },
      load: {
        total: totalAll, todo: todoAll, done: totalAll - todoAll, capacity: capAll,
        fill: capAll ? Math.round(totalAll / capAll * 100) : 0,
        remaining: per.reduce((s, x) => s + x.remaining, 0) - tasks.filter(t => !t.done && !data.collaborators.some(c => c.id === t.collaborator_id && c.active !== false)).reduce((s, t) => s + (Number(t.duration_min) || 0), 0)
      },
      team: per,
      unplanned: tasks.filter(t => !t.done && !t.planned_date)
    };
  }

  /* ---------- Tableaux de bord clients ----------
   * Le tableau de bord d'un mois (ou d'un trimestre) est à faire et publier le mois suivant, avant le jour convenu
   * (25 par défaut). Mensuel : chaque mois ; trimestriel : le mois qui suit la fin du trimestre (janvier, avril, juillet, octobre). */
  function dashboardFor(client, month, settings) {
    const st = Object.assign({}, DEFAULT_SETTINGS, settings), m = Number(month.slice(5, 7));
    if (!client || client.active === false || !client.dashboard_freq || !(Number(client.dashboard_min) > 0)) return null;
    if (client.dashboard_freq === 'trimestriel' && !st.quarter_months.includes(m)) return null;
    const period = addMonths(month, -1);
    return { period, due: nextWorkday(dateInMonth(month, client.dashboard_day || 25)), label: client.dashboard_freq === 'trimestriel' ? 'T' + Math.ceil(Number(period.slice(5, 7)) / 3) + ' ' + period.slice(0, 4) : period };
  }
  function buildDashboards(month, clients, tasks, settings, newId) {
    const have = new Set(tasks.filter(t => t.kind === 'dashboard' && t.month === month).map(t => t.client_id)), out = [];
    for (const c of clients) {
      const d = dashboardFor(c, month, settings); if (!d || have.has(c.id)) continue;
      out.push({ id: newId(), production_id: null, client_id: c.id, month, kind: 'dashboard', period: d.period, collaborator_id: c.collaborator_id || null, planned_date: null, seq: 0, duration_min: Number(c.dashboard_min), due_date: d.due, received_date: month + '-01', locked: false, done: false, done_at: null, alloc: null });
    }
    return out;
  }
  /* Tenue des échéances (ex. TVA au 21 et au 24) : pour chaque jalon, le reste à faire des dossiers dont l'échéance
   * tombe jusqu'à ce jalon, face à la capacité restante jusqu'à ce jalon (cumulé), par collaborateur. */
  function milestones(data, month, today, days) {
    const ctx = makeCtx(data), win = windowOf(month, ctx.settings), from = today > win.start ? today : win.start;
    const open = data.tasks.filter(t => t.month === month && !t.done && t.due_date);
    const collabs = data.collaborators.filter(c => c.active !== false);
    return [...new Set(days)].sort((a, b) => a - b).map((day, i, arr) => {
      const date = nextWorkday(dateInMonth(month, day)), prevDate = i ? nextWorkday(dateInMonth(month, arr[i - 1])) : null; // V26.88 : jalon un week-end → premier jour ouvré (24 → 26)
      const mine = open.filter(t => t.due_date <= date);
      const own = open.filter(t => t.due_date <= date && (!prevDate || t.due_date > prevDate)); // échéances propres à ce jalon
      const team = collabs.map(c => {
        let cap = 0; for (let d = from; d <= date; d = addDays(d, 1)) cap += capacityOn(c, d, ctx);
        const todo = mine.filter(t => t.collaborator_id === c.id).reduce((s, t) => s + (Number(t.duration_min) || 0), 0);
        return { collab: c, cap, todo, balance: cap - todo };
      });
      const dossiers = new Set(own.map(t => t.production_id || t.id)).size;
      return { day, date, past: date < today, dossiers, todo: team.reduce((s, r) => s + r.todo, 0), deficit: team.filter(r => r.balance < 0), ok: !team.some(r => r.balance < 0) && !own.some(t => !t.planned_date) };
    });
  }

  /* ---------- Zone figée : dernier jour « intouchable » (aujourd'hui + N jours ouvrés) ---------- */
  function freezeEnd(today, n) {
    let d = today;
    for (let k = Number(n) || 0, i = 0; k > 0 && i < 30; i++) { d = addDays(d, 1); if (isWorkday(d)) k--; }
    return d;
  }

  /* ---------- Agent de planification ----------
   * Apprend des mois précédents, dossier par dossier :
   *  - le décalage habituel entre la date de réception habituelle et la date réelle (en jours),
   *    et sa régularité (écart typique) ;
   *  - le temps réellement passé face au temps prévu.
   * Méthode robuste et explicable : médiane pondérée (les mois récents comptent davantage, demi-vie 4 mois),
   * rapprochée de la moyenne du cabinet quand un dossier a peu d'historique. Aucune donnée ne quitte l'application.
   * samples : [{ client_id, month, nominal, received, predicted, planned, actual, collaborator_id, source }] */
  function monthsBetween(a, b) { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); }
  function wQuantile(xs, q) {
    const a = xs.filter(x => x.w > 0 && isFinite(x.v)).sort((x, y) => x.v - y.v), tot = a.reduce((s, x) => s + x.w, 0);
    if (!tot) return null;
    let acc = 0;
    for (const x of a) { acc += x.w; if (acc >= q * tot - 1e-9) return x.v; }
    return a[a.length - 1].v;
  }
  function learn(samples, clients, settings, today, relances) {
    const cur = today.slice(0, 7), HALF = 4, K_DELAY = 1, K_TIME = 1;
    const weight = s => Math.pow(0.5, Math.max(0, monthsBetween(s.month, cur)) / HALF);
    const recv = samples.filter(s => s.nominal && s.received && s.received <= today && monthsBetween(s.month, cur) <= 24)
      .map(s => ({ s, v: Math.max(-20, Math.min(40, daysBetween(s.nominal, s.received))), w: weight(s) }));
    const times = samples.filter(s => Number(s.planned) > 0 && Number(s.actual) > 0 && monthsBetween(s.month, cur) <= 24)
      .map(s => ({ s, v: Number(s.actual), r: Number(s.actual) / Number(s.planned), w: weight(s) }));
    const prior = recv.length >= 8 ? (wQuantile(recv, .5) || 0) : 0; // habitude moyenne du cabinet
    const byClient = new Map();
    const bucket = id => { if (!byClient.has(id)) byClient.set(id, { d: [], t: [] }); return byClient.get(id); };
    recv.forEach(x => bucket(x.s.client_id).d.push(x));
    times.forEach(x => bucket(x.s.client_id).t.push(x));
    const out = new Map();
    for (const c of clients) {
      const b = byClient.get(c.id) || { d: [], t: [] }, W = b.d.length; // pondération « mois récents » dans la médiane, rapprochement du cabinet selon le nombre de mois observés
      const med = b.d.length ? wQuantile(b.d, .5) : prior, p80 = b.d.length ? wQuantile(b.d, .8) : prior;
      const delay = Math.round((W * med + K_DELAY * prior) / (W + K_DELAY));
      const late = Math.max(delay, Math.round((W * p80 + K_DELAY * prior) / (W + K_DELAY)));
      const spread = b.d.length ? p80 - wQuantile(b.d, .2) : null; // amplitude habituelle (8 mois sur 10 entre ces bornes)
      const reliability = b.d.length < 2 ? 'nouveau' : spread <= 2 ? 'regulier' : spread <= 5 ? 'variable' : 'imprevisible';
      const dw = b.d.reduce((s, x) => s + x.w, 0), lateRate = dw ? b.d.filter(x => x.v > 2).reduce((s, x) => s + x.w, 0) / dw : 0;
      // Temps de production : médiane pondérée des temps réels, rapprochée du temps actuel du dossier
      const curT = clientTime(c), TW = b.t.length;
      let est = null, suggest = null;
      if (b.t.length) {
        est = Math.round(((TW * wQuantile(b.t, .5)) + K_TIME * curT) / (TW + K_TIME) / 5) * 5;
        if (b.t.length >= 2 && curT > 0 && Math.abs(est - curT) >= Math.max(15, curT * .15)) suggest = est;
      }
      out.set(c.id, { client_id: c.id, n: b.d.length, months: [...new Set(b.d.map(x => x.s.month))].length, delay, late, spread, reliability, lateRate, time: { n: b.t.length, est, cur: curT, suggest } });
    }
    // Saisonnalité (V26.44, corrigée) : un mois n'est « saisonnier » que si l'écart revient chaque année, dans le même sens,
    // et dépasse la variabilité habituelle du dossier. Observations sur 36 mois ; l'effet est atténué quand il y a peu d'années.
    const recvS = samples.filter(s => s.nominal && s.received && s.received <= today && monthsBetween(s.month, cur) <= 36)
      .map(s => ({ s, v: Math.max(-20, Math.min(40, daysBetween(s.nominal, s.received))), w: 1 }));
    const season = {}, sBy = new Map();
    recvS.forEach(x => { const o = out.get(x.s.client_id); if (!o) return; const mm = x.s.month.slice(5, 7), r = { v: x.v - o.delay, w: 1, y: x.s.month.slice(0, 4) };
      (season[mm] = season[mm] || []).push(r); const k = x.s.client_id + '|' + mm; if (!sBy.has(k)) sBy.set(k, []); sBy.get(k).push(r); });
    const years = arr => new Set(arr.map(r => r.y)).size;
    const seasonCab = {};
    Object.keys(season).forEach(mm => {
      const arr = season[mm]; if (arr.length < 10 || years(arr) < 2) return;
      const q = Math.round(wQuantile(arr, .5) || 0); if (Math.abs(q) < 1) return;
      const same = arr.filter(r => Math.sign(r.v) === Math.sign(q) && Math.abs(r.v) >= 1).length / arr.length;
      if (same >= .6 && q > 0) seasonCab[mm] = q; // cabinet : retard saisonnier uniquement
    });
    out.forEach(o => { o.season = {}; });
    sBy.forEach((arr, k) => {
      if (arr.length < 2 || years(arr) < 2) return;
      const [id, mm] = k.split('|'), o = out.get(id), q = wQuantile(arr, .5) || 0;
      if (q <= 0 || o.reliability === 'imprevisible') return; // prudence : seul un retard saisonnier est retenu (jamais une avance), pas pour un client imprévisible
      if (!arr.every(r => r.v >= 1)) return;                  // chaque année dans le même sens
      if (Math.abs(q) < Math.max(2, (o.spread || 0) * .8)) return;                          // plus fort que la variabilité habituelle
      const val = Math.round(q * arr.length / (arr.length + 1)); if (val >= 2) o.season[mm] = val; // atténuation selon le nombre d'années
    });
    // V26.100 : saisonnalité de groupe — quand au moins 30 % des dossiers non réguliers glissent le même mois chaque année,
    // le glissement (médian) est appliqué aux dossiers « variables » de ce mois, même si leur propre historique est trop court ou trop dispersé.
    const seasonGroup = {}, perMonth = {};
    sBy.forEach((arr, k) => {
      const [id, mm] = k.split('|'), o = out.get(id); if (!o || o.reliability === 'regulier' || o.reliability === 'nouveau' || years(arr) < 2) return;
      const pm = perMonth[mm] = perMonth[mm] || { n: 0, hit: [] }; pm.n++;
      const ys = {}; arr.forEach(r => { (ys[r.y] = ys[r.y] || []).push(r.v); });
      if (Object.values(ys).every(v => v.reduce((s, x) => s + x, 0) / v.length >= 1)) pm.hit.push({ v: wQuantile(arr, .5) || 0, w: 1 });
    });
    Object.keys(perMonth).forEach(mm => { const pm = perMonth[mm]; if (pm.n >= 5 && pm.hit.length / pm.n >= .3) { const avg = pm.hit.reduce((s, h) => s + h.v, 0) / pm.hit.length; if (avg >= 1.5) seasonGroup[mm] = Math.round(avg); } });
    // Effet des relances : délai entre la relance et la réception
    const lags = [];
    (relances || []).forEach(r => {
      const x = recv.find(y => y.s.client_id === r.client_id && y.s.month === r.month && y.s.received >= r.date); if (!x) return;
      const l = Math.max(0, Math.min(20, daysBetween(r.date, x.s.received))); lags.push({ id: r.client_id, v: l, w: 1 });
      const o = out.get(r.client_id); if (o) (o._rl = o._rl || []).push({ v: l, w: 1 });
    });
    const relanceLag = lags.length >= 3 ? Math.round(wQuantile(lags, .5)) : null;
    out.forEach(o => { o.relance = o._rl ? { n: o._rl.length, lag: Math.round(wQuantile(o._rl, .5)) } : null; delete o._rl; });
    // Rythme des collaborateurs : temps réel / temps prévu (6 derniers mois)
    const collab = new Map();
    times.filter(x => x.s.collaborator_id && monthsBetween(x.s.month, cur) <= 6).forEach(x => {
      const r = collab.get(x.s.collaborator_id) || { plan: 0, real: 0, n: 0 }; r.plan += Number(x.s.planned); r.real += Number(x.s.actual); r.n++; collab.set(x.s.collaborator_id, r);
    });
    // Précision : écart moyen (jours) entre la date réelle et la date prévue par l'agent, face à la date habituelle seule
    const acc = new Map();
    recv.filter(x => x.s.predicted && x.s.source !== 'import').forEach(x => {
      const a = acc.get(x.s.month) || { month: x.s.month, n: 0, agent: 0, naive: 0 };
      a.n++; a.agent += Math.abs(daysBetween(x.s.predicted, x.s.received)); a.naive += Math.abs(daysBetween(x.s.nominal, x.s.received)); acc.set(x.s.month, a);
    });
    const precision = [...acc.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6).map(a => ({ month: a.month, n: a.n, agent: a.agent / a.n, naive: a.naive / a.n }));
    // V26.44 : précision semaine par semaine (semaine de la réception) et alerte de dégradation
    const wk = new Map();
    recv.filter(x => x.s.predicted && x.s.source !== 'import').forEach(x => {
      const w = startOfWeek(x.s.received), a = wk.get(w) || { week: w, n: 0, agent: 0, naive: 0 };
      a.n++; a.agent += Math.abs(daysBetween(x.s.predicted, x.s.received)); a.naive += Math.abs(daysBetween(x.s.nominal, x.s.received)); wk.set(w, a);
    });
    const weekly = [...wk.values()].sort((a, b) => a.week.localeCompare(b.week)).slice(-12).map(a => ({ week: a.week, n: a.n, agent: a.agent / a.n, naive: a.naive / a.n }));
    const avg = (arr, k) => { const n = arr.reduce((s, a) => s + a.n, 0); return n ? arr.reduce((s, a) => s + a[k] * a.n, 0) / n : null; };
    const last4 = weekly.slice(-4), prev4 = weekly.slice(-8, -4);
    const drift = { last: avg(last4, 'agent'), prev: avg(prev4, 'agent'), naive: avg(last4, 'naive'), n: last4.reduce((s, a) => s + a.n, 0) };
    drift.alert = drift.n >= 8 && ((drift.prev !== null && drift.last > drift.prev * 1.25 && drift.last - drift.prev >= .5) || (drift.naive !== null && drift.last > drift.naive + .3));
    const tAcc = new Map();
    times.forEach(x => { const a = tAcc.get(x.s.month) || { month: x.s.month, n: 0, err: 0 }; a.n++; a.err += Math.abs(x.r - 1); tAcc.set(x.s.month, a); });
    return {
      at: today, prior, clients: out, collab, seasonCab, seasonGroup, relanceLag, relancesN: lags.length, weekly, drift,
      samples: { receptions: recv.length, times: times.length, months: [...new Set(recv.map(x => x.s.month).concat(times.map(x => x.s.month)))].length, imported: samples.filter(s => s.source === 'import').length },
      precision, timePrecision: [...tAcc.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6).map(a => ({ month: a.month, n: a.n, err: a.err / a.n }))
    };
  }
  /* Date de réception prévue par l'agent pour un dossier et un mois.
   * Dossier régulier ou variable : habitude médiane ; dossier imprévisible : hypothèse prudente (8 fois sur 10). */
  function predictReception(model, client, month, settings) {
    const st = Object.assign({}, DEFAULT_SETTINGS, settings);
    const nominal = receptionDate(client, month, st);
    const m = model && model.clients.get(client.id);
    let shift = m && m.n ? (m.reliability === 'imprevisible' ? m.late : m.delay) : 0; // sans historique : date habituelle
    const mm = month.slice(5, 7), season = m && m.season && m.season[mm] != null ? { v: m.season[mm], src: 'dossier' } : model && model.seasonCab && model.seasonCab[mm] != null ? { v: model.seasonCab[mm], src: 'cabinet' } : m && m.reliability === 'variable' && model.seasonGroup && model.seasonGroup[mm] != null ? { v: model.seasonGroup[mm], src: 'groupe' } : null;
    if (season) shift += season.v;
    if (shift < 0) shift = 0; // V26.36 : jamais avant la date habituelle de dépôt (on ne planifie pas une tenue avant l'arrivée probable des pièces)
    let d = addDays(nominal, shift);
    if (shift > 0) for (let i = 0; i < 7 && !isWorkday(d); i++) d = addDays(d, 1);
    const first = month + '-01', last = dateInMonth(month, 31);
    if (d < first) d = first;
    if (d > last) { d = last; for (let i = 0; i < 7 && !isWorkday(d); i++) d = addDays(d, -1); } // V26.100 : fin de mois un week-end -> dernier jour ouvré
    // Meilleur jour de relance : assez tôt pour que la réception arrive à la date habituelle, jamais avant elle
    const lag = m && m.relance ? m.relance.lag : model ? model.relanceLag : null;
    let relanceDay = null;
    if (lag != null && daysBetween(nominal, d) > 1) { relanceDay = addDays(d, -lag); if (relanceDay < nominal) relanceDay = addDays(nominal, 1); for (let i = 0; i < 7 && !isWorkday(relanceDay); i++) relanceDay = addDays(relanceDay, 1); }
    return { date: d, nominal, shift: daysBetween(nominal, d), m, season, lag, relanceDay };
  }

  /* V26.44 — Surcharges prévues AVANT qu'elles arrivent.
   * Rejoue le planificateur (sans rien enregistrer) sur le mois en cours et les suivants avec :
   *  - les dates de réception prévues par l'agent pour les dossiers pas encore reçus,
   *  - les temps réels appris par l'agent quand ils dépassent le temps prévu,
   *  - des dossiers simulés pour les mois pas encore créés.
   * Un dossier est « à risque » s'il ne trouve pas de place ou s'il finirait après son échéance. */
  function capacityRisk(data, months, today, model, opts) {
    opts = opts || {};
    const st = Object.assign({}, DEFAULT_SETTINGS, data.settings || {}), doerOf = opts.doerOf || (c => c.collaborator_id);
    const clientById = new Map(data.clients.map(c => [c.id, c]));
    const est = c => { const m = model && model.clients.get(c.id); return m && m.time && m.time.est ? m.time.est : null; };
    let n = 0; const vid = () => 'sim-' + (++n);
    const risks = [], perCollab = new Map();
    for (const month of months) {
      let prods = data.productions.filter(p => p.month === month), tasks, virtual = false;
      if (prods.length) {
        tasks = data.tasks.filter(t => t.month === month).map(t => Object.assign({}, t));
        prods = prods.map(p => Object.assign({}, p));
      } else {
        const b = buildMonth(month, data.clients, [], st, vid, true); virtual = true;
        prods = b.productions; tasks = b.tasks;
        tasks.forEach(t => { const c = clientById.get(t.client_id); t.collaborator_id = c ? doerOf(c, 'production') : null; });
      }
      const prodById = new Map(prods.map(p => [p.id, p]));
      prods.forEach(p => { if (!p.received_date && !p.partial_date && model) { const c = clientById.get(p.client_id); if (c) p.expected_date = predictReception(model, c, month, st).date; } });
      const learnedSet = new Set();
      tasks.forEach(t => { if (t.kind !== 'production' || t.done || t.part) return; const c = clientById.get(t.client_id), l = c && est(c); if (l && l > (Number(t.duration_min) || 0)) { t.duration_min = l; learnedSet.add(t.id); } });
      const res = plan({ month, collaborators: data.collaborators, clients: data.clients, productions: prods, tasks, absences: data.absences || [], settings: st, today, mode: 'full' });
      const placed = new Map(res.changes.map(c => [c.id, c]));
      const unpl = new Set(res.unplanned.map(u => u.id));
      for (const t of tasks) {
        if (t.done || t.kind === 'info' || !t.collaborator_id) continue;
        const pl = Object.assign({}, t, placed.get(t.id) || {});
        let short = 0, end = null;
        if (unpl.has(t.id) || !pl.planned_date) short = Number(t.duration_min) || 0;
        else if (t.due_date) { end = endDate(pl); if (end > t.due_date) short = hasAlloc(pl) ? Object.keys(pl.alloc).filter(d => d > t.due_date).reduce((s, d) => s + (Number(pl.alloc[d]) || 0), 0) : (Number(t.duration_min) || 0); }
        if (!short) continue;
        const p = prodById.get(t.production_id);
        risks.push({ collab_id: t.collaborator_id, client_id: t.client_id, production_id: virtual ? null : t.production_id, task_id: virtual ? null : t.id, month, kind: t.kind, due: t.due_date || productionDue(clientById.get(t.client_id) || {}, month, st), ready: p ? (p.received_date || p.expected_date) : null, short, end, unplanned: unpl.has(t.id), learned: learnedSet.has(t.id), virtual, received: !!(p && p.received_date) });
        const r = perCollab.get(t.collaborator_id) || { collab_id: t.collaborator_id, late: 0, short: 0, first: null };
        r.late++; r.short += short; if (!r.first || r.first > (t.due_date || '9')) r.first = t.due_date || r.first; perCollab.set(t.collaborator_id, r);
      }
    }
    risks.sort((a, b) => (a.due || '').localeCompare(b.due || '') || b.short - a.short);
    return { months, from: today, risks, team: [...perCollab.values()] };
  }

  /* V26.100 — Réaffectations proposées (jamais appliquées automatiquement).
   * Part du planning enregistré, repère les dossiers non planifiés ou finis après l'échéance À CAUSE DE LA CHARGE
   * (pièces disponibles au moins 2 jours ouvrés avant l'échéance), puis cherche chez un autre collaborateur
   * (pas un apprenti) le premier créneau libre avant l'échéance : un jour, ou deux jours consécutifs au maximum. */
  function rebalance(data, month, today, opts) {
    opts = opts || {};
    const st = Object.assign({}, DEFAULT_SETTINGS, data.settings || {}), ctx = makeCtx(data), win = windowOf(month, st);
    const cur = data.tasks.filter(t => t.month === month); // planning réel tel qu'il est enregistré
    const prodById = new Map(data.productions.map(p => [p.id, p])), clientById = new Map(data.clients.map(c => [c.id, c]));
    const used = new Map(), key = (c, d) => c + '|' + d;
    for (const t of data.tasks.filter(x => x.month !== month).concat(cur)) { if (!t.collaborator_id || t.done) continue; for (const s of segs(t)) used.set(key(t.collaborator_id, s.d), (used.get(key(t.collaborator_id, s.d)) || 0) + s.m); }
    const free = (c, d) => Math.max(0, capacityOn(c, d, ctx) - (used.get(key(c.id, d)) || 0));
    const cands = data.collaborators.filter(c => c.active !== false && c.kind !== 'apprenti' && (!opts.allowed || opts.allowed.has(c.id)));
    const out = [];
    const problems = cur.filter(t => !t.done && !t.locked && t.kind === 'production' && t.collaborator_id && t.due_date && !onHold(prodById.get(t.production_id)) && (!t.planned_date || endDate(t) > t.due_date))
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || (Number(b.duration_min) || 0) - (Number(a.duration_min) || 0));
    for (const t of problems) {
      const p = prodById.get(t.production_id) || {}, dur = Number(t.duration_min) || 0;
      let ready = t.received_date || p.received_date || p.expected_date || win.start;
      if (!(t.received_date || p.received_date) && ready <= today) ready = addDays(today, 1);
      if (ready < today) ready = today;
      const lim = t.due_date < win.end ? t.due_date : win.end;
      let wd = 0; for (let d = ready; d <= lim; d = addDays(d, 1)) if (isWorkday(d)) wd++;
      if (wd < 2) continue; // pièces trop tardives : ce n'est pas un problème de charge
      let best = null;
      for (const c of cands) {
        if (c.id === t.collaborator_id || dur > Math.max(...weekHours(c, st)) * 2) continue;
        for (let d = ready; d <= lim; d = addDays(d, 1)) {
          const f1 = free(c, d); if (!f1) continue;
          if (f1 >= dur) { best = pickBest(best, { c, date: d, alloc: null, f: f1 }); break; }
          if (f1 >= SPLIT_MIN && dur - f1 >= SPLIT_MIN) {
            let d2 = addDays(d, 1); while (d2 <= lim && capacityOn(c, d2, ctx) <= 0) d2 = addDays(d2, 1);
            if (d2 <= lim && free(c, d2) >= dur - f1) { best = pickBest(best, { c, date: d, alloc: { [d]: f1, [d2]: dur - f1 }, f: f1 }); break; }
          }
        }
      }
      if (!best) continue;
      (best.alloc ? Object.keys(best.alloc) : [best.date]).forEach(d => used.set(key(best.c.id, d), (used.get(key(best.c.id, d)) || 0) + (best.alloc ? best.alloc[d] : dur)));
      if (t.planned_date) for (const s of segs(t)) used.set(key(t.collaborator_id, s.d), (used.get(key(t.collaborator_id, s.d)) || 0) - s.m);
      const c = clientById.get(t.client_id) || {};
      out.push({ task_id: t.id, client_id: t.client_id, client: c.name, from: t.collaborator_id, to: best.c.id, date: best.date, alloc: best.alloc, end: best.alloc ? Object.keys(best.alloc).sort().pop() : best.date, dur, due: t.due_date, problem: t.planned_date ? 'fin prévue le ' + endDate(t) : 'non planifié' });
      if (out.length >= (opts.max || 30)) break;
    }
    return out;
    function pickBest(a, b) { if (!a) return b; if (b.date < a.date) return b; if (b.date === a.date && !b.alloc && a.alloc) return b; return a; }
  }

  global.PlanEngine = {
    KINDS, KIND_LABEL, DEFAULT_SETTINGS, PRIORITY_LABEL, FREQ_LABEL, STATUS_LABEL, VAT_REGIMES, OBLIG_LABEL, FILING_VIA, obligations, productionDue, parseRegime, parseYes,
    pad, ymd, parseYmd, addDays, dow, daysInMonth, dateInMonth, addMonths, monthDates, rangeDates, startOfWeek, daysBetween, windowOf,
    easter, holidays, holidayName,
    fmtMin, fmtClock, parseClock, parseDuration, parseDay, parsePriority, parseFrequency,
    makeCtx, capacityOn, absHalf, morningMin, reserveOf, weekHours, CONTRACT, onHold, absenceOn, clientApplies, buildMonth, plan, clientTime, productionTask, projection, suggestTransfers, hasAlloc, segs, minutesOn, endDate, onDay, spread, loadOf, levelOf, productionStatus, alerts, dashboard,
    isReceived, freezeEnd, learn, predictReception, capacityRisk, rebalance, monthsBetween, isWorkday, nextWorkday, dashboardFor, buildDashboards, milestones
  };
})(typeof window !== 'undefined' ? window : globalThis);
