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
