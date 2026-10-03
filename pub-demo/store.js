/* store.js — Couche d'accès aux données.
 * Deux implémentations de la même interface :
 *  - SupabaseStore : PRODUCTION. Base PostgreSQL partagée (Supabase), authentification,
 *    règles d'accès RLS, temps réel. Seules l'URL et la clé publique ("anon"/"publishable")
 *    sont utilisées côté navigateur ; la sécurité est assurée par RLS.
 *  - DemoStore     : ESSAI UNIQUEMENT. Données dans ce navigateur (localStorage), synchronisées
 *    entre onglets. Jamais utilisé dès que config.js contient une URL Supabase.
 * Contrôle de concurrence optimiste : chaque ligne a un numéro de version incrémenté par la base ;
 * une mise à jour n'est acceptée que si la version lue est toujours la version courante. */
(function (global) {
  'use strict';

  const TABLES = ['app_users', 'collaborators', 'absences', 'clients', 'productions', 'tasks', 'settings', 'message_templates', 'learning_history', 'teams'];
  const OPTIONAL = ['learning_history', 'teams']; // tables ajoutées par une migration : leur absence ne bloque pas l'application
  const READONLY_FIELDS = ['id', 'version', 'updated_at', 'updated_by', 'time_total'];

  class ConflictError extends Error { constructor(row) { super('conflict'); this.conflict = true; this.row = row; } }
  class PermissionError extends Error { constructor(msg) { super(msg || 'Droits insuffisants'); this.permission = true; } }

  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function clean(patch) { const o = {}; for (const k in patch) if (!READONLY_FIELDS.includes(k) && !k.startsWith('_')) o[k] = patch[k]; return o; }
  const nowIso = () => new Date().toISOString();

  /* =========================== SUPABASE =========================== */
  class SupabaseStore {
    constructor(url, key) {
      this.mode = 'supabase';
      this.url = url; this.key = key; // V26.105 : diagnostic (test d'accès sans connexion)
      this.sb = global.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      this.email = null;
      this.missing = new Set(); // tables d'une migration non encore exécutée
    }
    get v7() { return !this.missing.has('learning_history'); }
    get v8() { return !this.missing.has('teams'); }
    async _opt(table, fn) {
      if (!OPTIONAL.includes(table)) return fn();
      if (this.missing.has(table)) return [];
      try { return await fn(); } catch (e) { this.missing.add(table); console.warn('Table ' + table + ' absente : exécutez la dernière migration Supabase', e); return []; }
    }
    async getSessionEmail() { const { data } = await this.sb.auth.getSession(); this.email = data.session ? data.session.user.email : null; return this.email; }
    async signIn(email, password) { const { error } = await this.sb.auth.signInWithPassword({ email, password }); if (error) throw error; return this.getSessionEmail(); }
    async signUp(email, password) {
      const { data, error } = await this.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error; return data;
    }
    async resetPassword(email) { const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw error; }
    async updatePassword(password) { const { error } = await this.sb.auth.updateUser({ password }); if (error) throw error; }
    async signOut() { if (this.channel) await this.sb.removeChannel(this.channel); await this.sb.auth.signOut(); this.email = null; }
    onAuthChange(cb) { this.sb.auth.onAuthStateChange((ev, session) => cb(ev, session ? session.user.email : null)); }

    async _all(table, build) {
      const out = [];
      for (let from = 0; ; from += 1000) {
        let q = this.sb.from(table).select('*').order('id').range(from, from + 999);
        if (build) q = build(q);
        const { data, error } = await q;
        if (error) throw error;
        out.push(...data);
        if (data.length < 1000) break;
      }
      return out;
    }
    async loadAll(fromMonth) {
      const res = {};
      await Promise.all(TABLES.map(async t => {
        res[t] = await this._opt(t, () => this._all(t, (t === 'tasks' || t === 'productions') && fromMonth ? q => q.gte('month', fromMonth) : null));
      }));
      return res;
    }
    async loadMonth(month) {
      const [productions, tasks] = await Promise.all([
        this._all('productions', q => q.eq('month', month)), this._all('tasks', q => q.eq('month', month))]);
      return { productions, tasks };
    }
    /* Mois passés (apprentissage de l'agent) : productions et tâches de [from, to[ */
    async loadRange(from, to) {
      const [productions, tasks] = await Promise.all([
        this._all('productions', q => q.gte('month', from).lt('month', to)), this._all('tasks', q => q.gte('month', from).lt('month', to))]);
      return { productions, tasks };
    }
    async changesSince(iso) {
      const res = {};
      await Promise.all(TABLES.map(async t => { res[t] = await this._opt(t, () => this._all(t, q => q.gt('updated_at', iso))); }));
      return res;
    }
    async insert(table, rows) {
      if (!rows.length) return [];
      const out = [];
      for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await this.sb.from(table).insert(rows.slice(i, i + 500).map(r => Object.assign(clean(r), { id: r.id }))).select();
        if (error) throw error;
        out.push(...data);
      }
      return out;
    }
    async upsert(table, rows) {
      if (!rows.length) return [];
      const { data, error } = await this.sb.from(table).upsert(rows.map(r => Object.assign(clean(r), { id: r.id }))).select();
      if (error) throw error;
      return data;
    }
    async update(table, id, patch, version) {
      let q = this.sb.from(table).update(clean(patch)).eq('id', id);
      if (version !== undefined && version !== null) q = q.eq('version', version);
      const { data, error } = await q.select();
      if (error) throw error;
      if (data.length) return data[0];
      const { data: cur, error: e2 } = await this.sb.from(table).select('*').eq('id', id).maybeSingle();
      if (e2) throw e2;
      if (cur && cur.version === version) throw new PermissionError();
      throw new ConflictError(cur);
    }
    async remove(table, id) {
      const { data, error } = await this.sb.from(table).delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data.length) throw new PermissionError();
    }
    async logHistory(entries) {
      if (!entries.length) return;
      const { error } = await this.sb.from('history').insert(entries.map(e => Object.assign({ user_email: this.email }, e)));
      if (error) console.warn('Historique non enregistré', error);
    }
    async loadHistory(opts) {
      let q = this.sb.from('history').select('*').order('at', { ascending: false }).limit((opts && opts.limit) || 300);
      if (opts && opts.entity_id) q = q.eq('entity_id', opts.entity_id);
      if (opts && opts.client_id) q = q.eq('client_id', opts.client_id);
      if (opts && opts.action) q = q.eq('action', opts.action);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }
    async loadAllHistory() { return this._all('history'); }
    /* V26.44 : migrations déjà exécutées (table schema_version, créée par migration_v1_13.sql) ; null si la table n'existe pas encore */
    async schemaVersions() { try { const { data, error } = await this.sb.from('schema_version').select('version'); if (error) return null; return data.map(r => String(r.version)); } catch (e) { return null; } }
    async usage() { const { data, error } = await this.sb.rpc('db_usage'); if (error) throw error; return Number(data) || null; }
    /* V26.105 : diagnostic lecture seule (administrateur) — rien n'est écrit en base */
    async diagnostics() {
      const out = { mode: 'supabase' };
      const t0 = performance.now(); await this.schemaVersions(); out.latency = Math.round(performance.now() - t0);
      // 1. Accès SANS connexion (clé publique seule) : chaque table doit être fermée
      const tables = ['app_users', 'collaborators', 'absences', 'clients', 'productions', 'tasks', 'settings', 'history', 'message_templates', 'learning_history', 'teams', 'schema_version'];
      out.anon = [];
      for (const t of tables) {
        try {
          const r = await fetch(this.url.replace(/\/$/, '') + '/rest/v1/' + t + '?select=*&limit=1', { headers: { apikey: this.key, Authorization: 'Bearer ' + this.key } });
          let rows = null; try { rows = await r.json(); } catch (e) { }
          const open = r.ok && Array.isArray(rows) && rows.length > 0;
          out.anon.push({ table: t, status: r.status, open, missing: r.status === 404 });
        } catch (e) { out.anon.push({ table: t, status: 0, open: false, error: String(e.message || e) }); }
      }
      // 2. Chiffrement : les noms stockés en base doivent être illisibles (enc1:…)
      try { const { data } = await this.sb.from('clients').select('name,notes').limit(200); out.enc = { n: (data || []).length, clear: (data || []).filter(r => r.name && !String(r.name).startsWith('enc1:')).length, notesClear: (data || []).filter(r => r.notes && !String(r.notes).startsWith('enc1:')).length }; } catch (e) { out.enc = { error: String(e.message || e) }; }
      try { out.size = await this.usage(); } catch (e) { out.size = null; }
      return out;
    }
    subscribe(onChange, onStatus) {
      this.channel = this.sb.channel('planif-db')
        .on('postgres_changes', { event: '*', schema: 'public' }, p => {
          if (p.table === 'history') return;
          onChange(p.table, p.eventType, p.eventType === 'DELETE' ? p.old : p.new);
        })
        .subscribe(status => {
          if (status === 'SUBSCRIBED') onStatus('live');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus('poll');
        });
    }
  }

  /* =========================== DÉMO LOCALE =========================== */
  class DemoStore {
    constructor() {
      this.mode = 'demo';
      this.v7 = true; this.v8 = true;
      this.key = 'planif-tva-demo-v1';
      const p = new URLSearchParams(location.search);
      this.failRate = Number(p.get('fail')) || 0; // ?fail=0.5 simule des erreurs réseau (tests)
      if (p.get('as')) sessionStorage.setItem('planif-demo-user', p.get('as')); // démo uniquement : ?as=e-mail ouvre directement ce profil
      this.email = sessionStorage.getItem('planif-demo-user');
      this.bc = 'BroadcastChannel' in global ? new BroadcastChannel('planif-tva-demo') : null;
      this.handlers = [];
      if (this.bc) this.bc.onmessage = e => this.handlers.forEach(h => h(e.data));
    }
    _db() {
      let db = null;
      try { db = JSON.parse(localStorage.getItem(this.key)); } catch (e) { db = null; }
      if (!db) { db = this._seed(); this._save(db); }
      TABLES.forEach(t => { if (!db[t]) db[t] = []; }); // tables ajoutées par une version plus récente
      return db;
    }
    _save(db) { localStorage.setItem(this.key, JSON.stringify(db)); }
    _seed() {
      const db = { history: [], seq: 0 };
      TABLES.forEach(t => (db[t] = []));
      db.app_users.push({ id: uuid(), email: 'admin@demo.local', name: 'Administrateur', role: 'admin', active: true, collaborator_id: null, version: 1, updated_at: nowIso(), updated_by: 'système' });
      db.settings.push({ id: 'planning', value: Object.assign({}, global.PlanEngine.DEFAULT_SETTINGS), version: 1, updated_at: nowIso() });
      return db;
    }
    async _net() {
      await new Promise(r => setTimeout(r, 60));
      if (this.failRate && Math.random() < this.failRate) throw new Error('Erreur réseau simulée');
    }
    _emit(msg) { if (this.bc) this.bc.postMessage(msg); }
    _finish(table, r) { if (table === 'clients') r.time_total = global.PlanEngine.clientTime(r); return r; }

    async getSessionEmail() { return this.email; }
    async signIn(email) {
      const u = this._db().app_users.find(x => x.email.toLowerCase() === String(email).toLowerCase());
      if (!u) throw new Error('Utilisateur inconnu');
      this.email = u.email; sessionStorage.setItem('planif-demo-user', u.email); return u.email;
    }
    async signUp() { throw new Error('Non disponible en mode démo'); }
    async resetPassword() { throw new Error('Non disponible en mode démo'); }
    async updatePassword() { throw new Error('Non disponible en mode démo'); }
    async signOut() { this.email = null; sessionStorage.removeItem('planif-demo-user'); }
    onAuthChange() { }
    demoUsers() { return this._db().app_users.filter(u => u.active); }
    resetDemo() { localStorage.removeItem(this.key); this._emit({ type: 'RESET' }); }

    async loadAll(fromMonth) {
      await this._net();
      const db = this._db(), res = {};
      TABLES.forEach(t => { res[t] = db[t].filter(r => !fromMonth || !(t === 'tasks' || t === 'productions') || r.month >= fromMonth).map(r => Object.assign({}, r)); });
      return res;
    }
    async loadMonth(month) {
      await this._net();
      const db = this._db();
      return { productions: db.productions.filter(r => r.month === month), tasks: db.tasks.filter(r => r.month === month) };
    }
    async loadRange(from, to) {
      await this._net();
      const db = this._db(), f = r => r.month >= from && r.month < to;
      return { productions: db.productions.filter(f).map(r => Object.assign({}, r)), tasks: db.tasks.filter(f).map(r => Object.assign({}, r)) };
    }
    async changesSince(iso) {
      await this._net();
      const db = this._db(), res = {};
      TABLES.forEach(t => { res[t] = db[t].filter(r => r.updated_at > iso); });
      return res;
    }
    async insert(table, rows) {
      await this._net();
      const db = this._db(), out = [];
      for (const r0 of rows) {
        const r = this._finish(table, Object.assign(clean(r0), { id: r0.id || uuid(), version: 1, updated_at: nowIso(), updated_by: this.email }));
        if (table === 'productions' && db.productions.some(p => p.client_id === r.client_id && p.month === r.month)) throw new Error('duplicate key value violates unique constraint (production déjà créée)');
        db[table].push(r); out.push(Object.assign({}, r));
      }
      this._save(db);
      out.forEach(r => this._emit({ table, type: 'INSERT', row: r }));
      return out;
    }
    async upsert(table, rows) {
      await this._net();
      const db = this._db(), out = [];
      for (const r0 of rows) {
        const i = db[table].findIndex(x => x.id === r0.id);
        const r = this._finish(table, Object.assign(i >= 0 ? db[table][i] : {}, clean(r0), { id: r0.id, version: i >= 0 ? db[table][i].version + 1 : 1, updated_at: nowIso(), updated_by: this.email }));
        if (i < 0) db[table].push(r);
        out.push(Object.assign({}, r));
      }
      this._save(db);
      out.forEach(r => this._emit({ table, type: 'UPDATE', row: r }));
      return out;
    }
    async update(table, id, patch, version) {
      await this._net();
      const db = this._db();
      const r = db[table].find(x => x.id === id);
      if (!r) throw new ConflictError(null);
      if (version !== undefined && version !== null && r.version !== version) throw new ConflictError(Object.assign({}, r));
      Object.assign(r, clean(patch), { version: r.version + 1, updated_at: nowIso(), updated_by: this.email });
      this._finish(table, r);
      this._save(db);
      this._emit({ table, type: 'UPDATE', row: Object.assign({}, r) });
      return Object.assign({}, r);
    }
    async remove(table, id) {
      await this._net();
      const db = this._db();
      db[table] = db[table].filter(x => x.id !== id);
      if (table === 'productions') db.tasks = db.tasks.filter(t => t.production_id !== id);
      if (table === 'collaborators') db.absences = db.absences.filter(a => a.collaborator_id !== id);
      if (table === 'clients') { const pids = new Set(db.productions.filter(p => p.client_id === id).map(p => p.id)); db.productions = db.productions.filter(p => p.client_id !== id); db.tasks = db.tasks.filter(t => !pids.has(t.production_id)); db.learning_history = (db.learning_history || []).filter(x => x.client_id !== id); }
      this._save(db);
      this._emit({ table, type: 'DELETE', row: { id } });
    }
    async logHistory(entries) {
      const db = this._db();
      for (const e of entries) db.history.push(Object.assign({ id: ++db.seq, at: nowIso(), user_email: this.email }, e));
      if (db.history.length > 5000) db.history = db.history.slice(-5000);
      this._save(db);
    }
    async loadHistory(opts) {
      let h = this._db().history.slice().reverse();
      if (opts && opts.entity_id) h = h.filter(x => x.entity_id === opts.entity_id);
      if (opts && opts.client_id) h = h.filter(x => x.client_id === opts.client_id);
      if (opts && opts.action) h = h.filter(x => x.action === opts.action);
      return h.slice(0, (opts && opts.limit) || 300);
    }
    async loadAllHistory() { return this._db().history.slice(); }
    async schemaVersions() { return null; } // démo : pas de base Supabase, rien à vérifier
    async diagnostics() { return { mode: 'demo' }; }
    subscribe(onChange, onStatus) {
      this.handlers.push(m => { if (m.type === 'RESET') location.reload(); else onChange(m.table, m.type, m.row); });
      setTimeout(() => onStatus(this.bc ? 'live' : 'poll'), 0);
    }
  }

  global.PlanStore = { SupabaseStore, DemoStore, ConflictError, PermissionError, uuid, TABLES };
})(window);
