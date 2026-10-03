/* ui-v2.js — comportements du design V2 (thèmes Clair et Signature ; le thème Nuit n'est pas concerné).
 * N'agit que sur l'affichage : aucune donnée n'est lue ni modifiée ici.
 *  - squelette de chargement, en-tête détaché au défilement, filtres actifs, pas d'emoji
 *  - iPhone : cartes en carrousel avec effet de profondeur
 *  - glisser-déposer : aperçu de la date d'arrivée
 *  - Signature : surbrillance des cartes qui suit la souris ; curseur « goutte » (option)
 *  - effets : onglets liquides, boutons magnétiques, changement de mois en profondeur, réception déclarée */
(function () {
  'use strict';
  const root = document.documentElement, app = document.getElementById('app');
  const on = () => root.dataset.theme !== 'nuit';
  const calm = () => root.dataset.motion === 'reduced';
  // V26.176 : mêmes durées et même courbe que le reste de l'application (constantes de app.js, système de mouvement commun)
  const FX = () => window.JBFX || { FAST: 140, MEDIUM: 200, SLOW: 280, EASING: 'cubic-bezier(.22, 1, .36, 1)' };
  const mobile = () => matchMedia('(max-width: 800px)').matches;
  const fineMouse = matchMedia('(hover: hover) and (pointer: fine)');
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const fDate = s => { const [y, m, d] = s.split('-').map(Number), dt = new Date(y, m - 1, d); return DAYS[dt.getDay()] + ' ' + d + ' ' + MONTHS[m - 1]; };
  const ls = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };

  /* Squelette de chargement */
  const SKEL = '<div class="v2-skel" aria-label="Chargement"><i class="s-side"></i><div class="s-main"><i style="height:34px;width:40%"></i><div class="s-row"><i style="height:96px"></i><i style="height:96px"></i><i style="height:96px"></i><i style="height:96px"></i></div><i style="height:220px"></i><i style="height:160px"></i></div></div>';
  function skeleton() { const b = app.querySelector(':scope > .boot'); if (b) app.innerHTML = SKEL; }

  /* Pas d'emoji dans l'interface : les fonctions sont portées par des icônes */
  const EMO = /(?![©®™])[\p{Extended_Pictographic}]️?\s?/gu; // V26.111 : © ® ™ ne sont pas des emoji (mention légale en bas de page)
  function stripEmoji(el) {
    if (!el) return;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => { EMO.lastIndex = 0; return EMO.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
    const list = []; while (w.nextNode()) list.push(w.currentNode);
    list.forEach(n => { EMO.lastIndex = 0; n.nodeValue = n.nodeValue.replace(EMO, ''); });
  }

  /* Filtres actifs */
  const DEF = { period: 'month', collab: '', status: 'todo', reception: '', kind: '' };
  const markFilters = () => document.querySelectorAll('select[data-ch="filter"]').forEach(s => s.classList.toggle('v2-active', (s.value || '') !== (DEF[s.dataset.k] || '')));

  /* iPhone : carrousel à profondeur */
  function depth(car) {
    if (!mobile() || !car.children.length) return;
    const r = car.getBoundingClientRect(), cx = r.left + r.width / 2;
    let best = null, bestD = 1e9;
    [...car.children].forEach(el => {
      const b = el.getBoundingClientRect(), d = Math.min(1, Math.abs(b.left + b.width / 2 - cx) / b.width);
      el.style.transform = on() ? 'scale(' + (1 - d * .07).toFixed(3) + ')' : ''; el.style.opacity = on() ? (1 - d * .3).toFixed(3) : '';
      if (d < bestD) { bestD = d; best = el; }
    });
    [...car.children].forEach(el => el.classList.toggle('v2-center', el === best));
  }
  document.addEventListener('scroll', e => { const c = e.target; if (c && c.classList && c.classList.contains('carousel')) requestAnimationFrame(() => depth(c)); }, true);

  /* ---------- Effet 2 : onglets liquides (sélecteurs Jour / Semaine / Mois… et barre d'onglets iPhone) ---------- */
  const segPrev = new Map();
  function liquidSegs() {
    document.querySelectorAll('.seg').forEach(seg => {
      const btn = seg.querySelector('button.on'); if (!btn) return;
      const key = [...seg.querySelectorAll('button')].map(b => b.textContent.trim()).join('|');
      const sr = seg.getBoundingClientRect(), r = btn.getBoundingClientRect(), to = { l: r.left - sr.left, t: r.top - sr.top, w: r.width, h: r.height };
      const from = segPrev.get(key); segPrev.set(key, to);
      if (!from || !on() || calm() || Math.abs(from.l - to.l) < 2) return;
      const blob = document.createElement('span'); blob.className = 'fx-blob';
      blob.style.cssText = 'top:' + to.t + 'px;height:' + to.h + 'px;left:0;width:0';
      seg.appendChild(blob);
      const right = to.l > from.l, mid = right ? { l: from.l, w: to.l + to.w - from.l } : { l: to.l, w: from.l + from.w - to.l };
      btn.style.transition = 'none'; btn.style.background = 'transparent';
      blob.animate([{ left: from.l + 'px', width: from.w + 'px' }, { left: mid.l + 'px', width: mid.w + 'px', offset: .45 }, { left: to.l + 'px', width: to.w + 'px' }], { duration: FX().MEDIUM, easing: FX().EASING })
        .onfinish = () => { blob.remove(); btn.style.background = ''; btn.style.transition = ''; };
    });
  }
  let navIdx = null;
  let navObs = null;
  function liquidNav() {
    const ind = document.querySelector('.bottom-nav .ind'); if (!ind) return;
    if (!navObs || navObs.el !== ind) { navObs = new MutationObserver(liquidNav); navObs.el = ind; navObs.observe(ind, { attributes: true, attributeFilter: ['style'] }); }
    const m = /translateX\((-?\d+)%\)/.exec(ind.style.transform || ''), idx = m ? Number(m[1]) / 100 : 0;
    if (navIdx !== null && idx !== navIdx && on() && !calm()) {
      const a = navIdx, b = idx, span = Math.abs(b - a) + 1, left = Math.min(a, b);
      ind.animate([{ transform: 'translateX(' + a * 100 + '%) scaleX(1)', transformOrigin: 'left' }, { transform: 'translateX(' + left * 100 + '%) scaleX(' + span + ')', transformOrigin: 'left', offset: .45 }, { transform: 'translateX(' + b * 100 + '%) scaleX(1)', transformOrigin: 'left' }], { duration: FX().MEDIUM, easing: FX().EASING });
    }
    navIdx = idx;
  }

  /* Effet 4 (changement de mois en profondeur) retiré en V26.176 : la structure reste immobile,
     seules les données qui changent apparaissent (système de mouvement commun de app.js). */

  /* ---------- Effet 5 : réception déclarée — trace lumineuse sur le dossier à sa nouvelle place ----------
     (V26.176 : le glissement lui-même est fait par le système de mouvement commun, en 200 ms) */
  let prevTasks = new Map();
  function receptionFlip() {
    const now = new Map();
    // V26.106 : ne mesure les positions que s'il y a des dossiers prévisionnels à suivre (évite un recalcul de mise en page à chaque affichage)
    let hasFc = false; prevTasks.forEach(v => { if (v.forecast) hasFc = true; });
    if (!hasFc && !document.querySelector('#view .task.forecast[data-id]')) { prevTasks = now; return; }
    document.querySelectorAll('#view .task[data-id]').forEach(el => { const r = el.getBoundingClientRect(); now.set(el.dataset.id + '|' + (el.closest('[data-drop]') ? el.closest('[data-drop]').dataset.drop : ''), { el, top: r.top + scrollY, left: r.left, forecast: el.classList.contains('forecast') }); });
    if (on() && !calm()) {
      const moved = [];
      now.forEach((n, k) => { const id = k.split('|')[0]; const p = [...prevTasks.entries()].find(([pk]) => pk.split('|')[0] === id); if (p && p[1].forecast && !n.forecast) moved.push({ n, p: p[1] }); });
      moved.slice(0, 3).forEach(({ n }) => { n.el.classList.add('fx-fly'); setTimeout(() => n.el.classList.remove('fx-fly'), 1100); });
    }
    prevTasks = now;
  }

  /* ---------- Effet 3 : boutons magnétiques (actions principales, sans jamais toucher une voisine ni sortir) ---------- */
  const MAX = 4; let magBtn = null;
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const b = on() && !calm() && e.target.closest && e.target.closest('.btn.primary, .btn.dark, .btn.rl-sent, .tva-recap-btn2');
    if (magBtn && magBtn !== b) { magBtn.style.translate = ''; magBtn = null; }
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    // V26.176 : propriété « translate » (et non transform) — l'appui à 0,985 reste visible, les transitions de couleur sont conservées
    b.style.translate = Math.max(-MAX, Math.min(MAX, dx * .12)).toFixed(1) + 'px ' + Math.max(-MAX / 2, Math.min(MAX / 2, dy * .12)).toFixed(1) + 'px';
    magBtn = b;
  }, { passive: true });

  function enhance() {
    skeleton();
    if (typeof folds === 'function') folds();
    if (!on()) return;
    stripEmoji(app); stripEmoji(document.getElementById('sheet-root')); stripEmoji(document.getElementById('toasts'));
    markFilters();
    document.querySelectorAll('.carousel').forEach(depth);
    liquidSegs(); liquidNav(); receptionFlip();
  }
  let pending = 0;
  new MutationObserver(() => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; enhance(); }); }).observe(document.body, { childList: true, subtree: true });
  addEventListener('resize', () => document.querySelectorAll('.carousel').forEach(depth));
  document.addEventListener('change', e => { if (e.target.matches && e.target.matches('select[data-ch="filter"]')) markFilters(); });
  const onScroll = () => root.classList.toggle('scrolled', scrollY > 6);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* Glisser-déposer : aperçu de la date d'arrivée */
  let pill = null, dragEl = null;
  document.addEventListener('dragstart', e => {
    dragEl = e.target.closest && e.target.closest('[data-drag]'); if (!dragEl || !on()) return;
    dragEl.classList.add('dragging');
    pill = document.createElement('div'); pill.className = 'v2-drag-pill'; pill.style.opacity = '0'; document.body.appendChild(pill);
  });
  document.addEventListener('dragover', e => {
    if (!pill) return;
    const col = e.target.closest && e.target.closest('[data-drop]');
    pill.style.left = e.clientX + 'px'; pill.style.top = e.clientY + 'px';
    if (col) { const lab = 'Déposer · ' + fDate(col.dataset.drop); pill.textContent = '→ ' + fDate(col.dataset.drop); pill.style.opacity = '1'; if (col.getAttribute('data-drop-label') !== lab) col.setAttribute('data-drop-label', lab); }
    else pill.style.opacity = '0';
  });
  const dragDone = () => { if (dragEl) dragEl.classList.remove('dragging'); dragEl = null; if (pill) pill.remove(); pill = null; };
  document.addEventListener('dragend', dragDone);
  // V26.183 : si la semaine change pendant le glisser, la carte d'origine disparaît de la page et « dragend » ne remonte plus :
  // l'aperçu est aussi retiré au dépôt, ou dès que le survol s'arrête (glisser annulé, pointeur hors de la fenêtre)
  document.addEventListener('drop', dragDone);
  let dragIdle = 0; document.addEventListener('dragover', () => { clearTimeout(dragIdle); if (pill) dragIdle = setTimeout(dragDone, 400); });

  /* ---------- Signature : surbrillance des cartes qui suit la souris ---------- */
  const sig = () => root.dataset.theme === 'signature';
  let lit = null;
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const el = sig() && e.target.closest && e.target.closest('.card, .kpi, .frame');
    if (lit && lit !== el) { lit.classList.remove('v2-lit'); lit = null; }
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px');
    if (lit !== el) { el.classList.add('v2-lit'); lit = el; }
  }, { passive: true });

  /* ---------- Signature : curseur « goutte de verre » (option de Paramètres › Apparence) ----------
   * planif-drop : 'off' (défaut) · 'on' (goutte + curseur habituel) · 'solo' (goutte seule).
   * Ronde, sans étirement, exactement sous la souris ; 22 px, 30 px sur un élément cliquable, 16 px au clic. */
  const drop = document.createElement('div'); drop.className = 'v2-drop'; drop.setAttribute('aria-hidden', 'true'); document.body.appendChild(drop);
  const dropMode = () => 'off'; // V26.34 : goutte retirée, remplacée par le curseur noir Signature
  root.dataset.cur = ls('planif-cur') || 'noir';
  function syncCursor() { root.classList.toggle('v2-nocursor', dropMode() === 'solo'); if (dropMode() === 'off') drop.classList.remove('on'); }
  window.JBFlowCursor = { sync: syncCursor };
  document.addEventListener('pointermove', e => {
    const mode = dropMode(), inField = e.target.closest && e.target.closest('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), textarea, .lg');
    const show = mode !== 'off' && e.pointerType === 'mouse' && !inField;
    drop.classList.toggle('on', show);
    root.classList.toggle('v2-nocursor', mode === 'solo');
    if (!show) return;
    drop.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
    drop.classList.toggle('hot', !!(e.target.closest && e.target.closest('a, button, [data-act], [role="button"], label, .task, select')));
  }, { passive: true });
  document.addEventListener('pointerdown', () => drop.classList.add('down'));
  document.addEventListener('pointerup', () => drop.classList.remove('down'));
  document.addEventListener('mouseleave', () => drop.classList.remove('on'));
  new MutationObserver(syncCursor).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-motion'] });


  /* ---------- Listes déroulantes aux couleurs de l'application (souris ; au doigt, la liste native reste plus pratique) ---------- */
  let menu = null, menuSel = null;
  const closeMenu = () => { if (menu) menu.remove(); menu = null; menuSel = null; };
  function openMenu(sel) {
    closeMenu(); menuSel = sel;
    const r = sel.getBoundingClientRect(); menu = document.createElement('div'); menu.className = 'v2-menu'; menu.setAttribute('role', 'listbox');
    [...sel.options].forEach((o, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = o.textContent; b.dataset.i = i; if (o.disabled) b.disabled = true; if (i === sel.selectedIndex) b.className = 'sel'; b.setAttribute('role', 'option'); menu.appendChild(b); });
    document.body.appendChild(menu);
    const h = menu.offsetHeight, below = innerHeight - r.bottom - 8;
    menu.style.minWidth = r.width + 'px';
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = (below >= h || below > r.top ? r.bottom + 6 : r.top - h - 6) + 'px';
    const cur = menu.querySelector('.sel'); if (cur) cur.scrollIntoView({ block: 'nearest' });
    menu.addEventListener('mousedown', e => e.preventDefault());
    menu.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      const s = menuSel, i = Number(b.dataset.i); closeMenu();
      if (s && s.selectedIndex !== i) { s.selectedIndex = i; s.dispatchEvent(new Event('change', { bubbles: true })); s.dispatchEvent(new Event('input', { bubbles: true })); }
      if (s) s.focus({ preventScroll: true });
    });
  }
  document.addEventListener('mousedown', e => {
    const sel = e.target.closest && e.target.closest('select');
    if (menu && !(e.target.closest && e.target.closest('.v2-menu'))) { const was = menuSel; closeMenu(); if (was === sel) { e.preventDefault(); return; } }
    if (!sel || sel.multiple || sel.disabled || e.button !== 0 || !fineMouse.matches || sel.closest('.lg')) return;
    e.preventDefault(); sel.focus({ preventScroll: true }); openMenu(sel);
  }, true);
  document.addEventListener('keydown', e => {
    if (!menu) return;
    const items = [...menu.querySelectorAll('button:not(:disabled)')], k = menu.querySelector('.kb') || menu.querySelector('.sel'), i = items.indexOf(k);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; items.forEach(b => b.classList.toggle('kb', b === n)); if (n) n.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && k) { e.preventDefault(); k.click(); }
  }, true);
  addEventListener('scroll', e => { if (menu && !(e.target && e.target.closest && e.target.closest('.v2-menu'))) closeMenu(); }, true);
  addEventListener('resize', closeMenu);

  /* ---------- Vue d'ensemble : cartes et sections repliables (managers et administrateurs) ----------
   * Une carte repliée garde son titre et ses indicateurs d'en-tête ; mémorisé sur cet appareil. */
  /* Deux cartes côte à côte dont l'une est repliée : la rangée passe sur une colonne, la carte repliée devient
   * une fine barre au-dessus et sa voisine reprend toute la largeur (aucun espace vide). */
  function relayout(row) {
    if (!row || !row.matches || !row.matches('.split, .grid.g2')) row = row && row.closest && row.closest('.split, .grid.g2');
    if (!row) return;
    const kids = [...row.children], folded = kids.filter(k => k.classList.contains('v2-folded') || k.querySelector(':scope > .v2-folded'));
    row.classList.toggle('v2-row-folded', folded.length > 0 && folded.length < kids.length);
    row.classList.toggle('v2-row-allfolded', folded.length > 0 && folded.length === kids.length);
  }
  /* Animation FLIP : chaque carte glisse de son ancienne position à la nouvelle, la carte repliée change de hauteur en douceur */
  /* V26.159 : transition replier / déplier sans déformation — plus d'étirement (scale) du texte ;
     les cartes glissent et changent de hauteur en douceur, les blocs qui réapparaissent arrivent en fondu. */
  function flip(change) {
    const view = document.getElementById('view'); if (!view || calm()) { change(); return; }
    const sel = ':scope > *, .card, .frame, .kpi, .split > *, .grid > *';
    const all0 = [...view.querySelectorAll(sel)], els = all0.filter(el => el.offsetParent);
    const hidden0 = new Set(all0.filter(el => !el.offsetParent));
    const before = new Map(els.map(el => [el, el.getBoundingClientRect()]));
    change();
    const ease = FX().EASING, slow = FX().SLOW; // V26.176 : constantes communes
    els.forEach(el => {
      const a = before.get(el), b = el.getBoundingClientRect(); if (!b.width || !b.height) return;
      const dx = a.left - b.left, dy = a.top - b.top;
      const resized = Math.abs(a.height - b.height) > 1 || Math.abs(a.width - b.width) > 1;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && !resized) return;
      if (resized && el.matches('.card, .frame')) {
        el.style.overflow = 'hidden';
        el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)', height: a.height + 'px' }, { transform: 'none', height: b.height + 'px' }], { duration: slow, easing: ease }).onfinish = () => { el.style.overflow = ''; };
      } else if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
        el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: slow, easing: ease });
      }
    });
    // Blocs qui viennent de réapparaître : fondu + léger glissement (4 px), sans déformation
    [...view.querySelectorAll(sel)].filter(el => hidden0.has(el) && el.offsetParent).forEach((el, k) => {
      el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: FX().MEDIUM, delay: Math.min(k, 6) * 20, easing: ease, fill: 'backwards' });
    });
  }  const FOLD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9.5 6 6 6-6"/></svg>';
  const foldKey = t => 'planif-fold:' + t;
  function folds() {
    const S = window.PlanApp && window.PlanApp.S;
    if (!S || S.route !== 'dashboard' || !S.me || !['admin', 'manager'].includes(S.me.role)) return;
    const view = document.getElementById('view'); if (!view) return;
    view.querySelectorAll(':scope .card > .card-h, :scope .frame > .frame-h').forEach(h => {
      if (h.querySelector('.v2-fold')) return;
      const box = h.parentElement, title = (h.querySelector('h2') || h).textContent.trim(); if (!title) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'v2-fold'; b.title = 'Replier / déplier'; b.setAttribute('aria-label', 'Replier ou déplier « ' + title + ' »'); b.innerHTML = FOLD_ICON;
      h.appendChild(b);
      const apply = f => { box.classList.toggle('v2-folded', f); b.setAttribute('aria-expanded', String(!f)); relayout(box.parentElement); };
      apply(ls(foldKey(title)) === '1');
      b.addEventListener('click', e => { e.stopPropagation(); const f = !box.classList.contains('v2-folded'); try { localStorage.setItem(foldKey(title), f ? '1' : ''); } catch (er) { /* stockage indisponible */ } flip(() => apply(f)); });
    });
    view.querySelectorAll(':scope > .section-t').forEach(sec => {
      if (sec.querySelector('.v2-fold')) return;
      const title = (sec.querySelector('h2') || sec).textContent.trim(); if (!title) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'v2-fold'; b.title = 'Replier / déplier la section'; b.innerHTML = FOLD_ICON;
      const hint = document.createElement('span'); hint.className = 'v2-fold-hint'; sec.appendChild(hint); sec.appendChild(b);
      const members = () => { const out = []; let n = sec.nextElementSibling; while (n && !n.classList.contains('section-t')) { out.push(n); n = n.nextElementSibling; } return out; };
      const apply = f => { sec.classList.toggle('v2-folded', f); members().forEach(m => m.classList.toggle('v2-sec-folded', f)); hint.textContent = f ? members().length ? 'masquée' : '' : ''; };
      apply(ls(foldKey('§' + title)) === '1');
      b.addEventListener('click', () => { const f = !sec.classList.contains('v2-folded'); try { localStorage.setItem(foldKey('§' + title), f ? '1' : ''); } catch (er) { /* stockage indisponible */ } flip(() => apply(f)); });
    });
  }
  /* ---------- Capsule de défilement (souris) : barre native masquée, capsule de verre qui apparaît en défilant ----------
   * Affiche la position (ex. 40 %), disparaît après 0,8 s ; visible aussi quand la souris approche du bord droit ;
   * se saisit pour faire défiler. Au doigt (iPhone), la barre native est conservée. */
  if (fineMouse.matches) {
    root.classList.add('v2-caps');
    const caps = new Map();
    const scrollerOf = t => (t === document || t === document.documentElement || t === document.body ? document.scrollingElement : t);
    // V26.63 : capsule seulement pour la page et les vraies zones de défilement (fenêtres, menus) — plus de barre parasite au milieu d'une page
    const isVScroll = el => el === document.scrollingElement || (el.nodeType === 1 && el.matches && el.matches('.sheet, .sheet-b, .cmdk-l, .v2-menu, .tp-box') && el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY) && !el.closest('.lg'));
    const rectOf = el => (el === document.scrollingElement ? { top: 0, bottom: innerHeight, right: innerWidth, height: innerHeight } : el.getBoundingClientRect());
    function capFor(el) {
      let c = caps.get(el);
      if (!c || !c.node.isConnected) {
        const node = document.createElement('div'); node.className = 'v2-cap'; node.innerHTML = '<span class="v2-cap-pct"></span>'; document.body.appendChild(node);
        c = { node, pct: node.firstChild, hide: 0, lastTop: null }; caps.set(el, c);
        node.addEventListener('pointerdown', e => { // saisir la capsule pour faire défiler
          e.preventDefault(); node.setPointerCapture(e.pointerId); node.classList.add('drag');
          const y0 = e.clientY, s0 = el.scrollTop, r = rectOf(el), h = r.height, th = node.offsetHeight, max = el.scrollHeight - el.clientHeight;
          const move = ev => { el.scrollTop = s0 + (ev.clientY - y0) * max / Math.max(1, h - th - 8); };
          const up = () => { node.classList.remove('drag'); node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); hideLater(el, c); };
          node.addEventListener('pointermove', move); node.addEventListener('pointerup', up);
        });
      }
      return c;
    }
    function place(el, c) {
      const r = rectOf(el), h = el.clientHeight, H = el.scrollHeight, max = Math.max(1, H - h);
      if (H <= h + 2) { c.node.classList.remove('on'); return; }
      const inset = 4, avail = r.height - inset * 2, th = Math.max(36, avail * h / H), ratio = el.scrollTop / max;
      c.node.style.height = th + 'px';
      c.node.style.transform = 'translate3d(' + (r.right - 12) + 'px,' + (r.top + inset + (avail - th) * ratio) + 'px,0)';
      c.pct.textContent = Math.round(ratio * 100) + ' %';
    }
    function hideLater(el, c) { clearTimeout(c.hide); c.hide = setTimeout(() => { if (!c.node.classList.contains('drag') && !c.near) c.node.classList.remove('on'); }, 800); }
    function show(el) { const c = capFor(el); place(el, c); c.node.classList.add('on'); hideLater(el, c); }
    document.addEventListener('scroll', e => {
      const el = scrollerOf(e.target); if (!el || !isVScroll(el)) return;
      const c = capFor(el); if (c.lastTop === el.scrollTop) return; // défilement horizontal (carrousels) : ignoré
      c.lastTop = el.scrollTop; show(el);
    }, { capture: true, passive: true });
    // Souris près du bord droit d'une zone qui défile : la capsule apparaît et peut être saisie
    document.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      let el = e.target && e.target.nodeType === 1 ? e.target : null, found = null;
      for (; el && el !== document.documentElement; el = el.parentElement) if (isVScroll(el)) { found = el; break; }
      const cands = [found, document.scrollingElement].filter(Boolean);
      caps.forEach((c, s) => { c.near = false; });
      for (const s of cands) {
        const r = rectOf(s);
        if (e.clientX >= r.right - 22 && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom && s.scrollHeight > s.clientHeight + 2) { const c = capFor(s); c.near = true; show(s); break; }
      }
    }, { passive: true });
    addEventListener('resize', () => caps.forEach((c, el) => c.node.classList.contains('on') && place(el, c)));
    setInterval(() => caps.forEach((c, el) => { if (!el.isConnected && el !== document.scrollingElement) { c.node.remove(); caps.delete(el); } }), 4000);
  }
  enhance(); syncCursor();
})();

/* V26.40 : info-bulles « Verre » (option 1) à la place des bulles du navigateur. Première ligne en titre si le texte contient un retour à la ligne. */
(function () {
  if (!window.matchMedia || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const tip = document.createElement('div'); tip.className = 'v2-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
  let cur = null, timer = 0;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let muted = []; // V26.57 : titres des éléments parents masqués aussi (sinon la bulle du navigateur s'ajoutait après quelques secondes)
  function hide() { clearTimeout(timer); tip.classList.remove('on'); if (cur && cur.dataset.v2tip !== undefined) { cur.setAttribute('title', cur.dataset.v2tip); delete cur.dataset.v2tip; } muted.forEach(m => { if (m.el.getAttribute('title') === null) m.el.setAttribute('title', m.t); }); muted = []; cur = null; }
  function place(el) {
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, m = 10;
    let x = r.left + Math.min(r.width / 2, 40) - 22; x = Math.max(8, Math.min(x, innerWidth - w - 8));
    let y = r.bottom + m, up = false; if (y + h > innerHeight - 8) { y = r.top - h - m; up = true; }
    tip.classList.toggle('up', up); tip.style.left = x + 'px'; tip.style.top = y + 'px';
    tip.style.setProperty('--ax', Math.max(12, Math.min(w - 24, r.left + Math.min(r.width / 2, 40) - x - 6)) + 'px');
  }
  document.addEventListener('mouseover', e => {
    const el = e.target.closest && e.target.closest('[title]');
    if (!el || el === cur) return;
    hide();
    const t = el.getAttribute('title'); if (!t || !t.trim()) return;
    cur = el; el.dataset.v2tip = t; el.removeAttribute('title');
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const pt = p.getAttribute('title'); if (pt !== null) { muted.push({ el: p, t: pt }); p.removeAttribute('title'); } }
    if (el.closest('.side, #side, .bnav, #bnav')) return; // menu latéral : aucune bulle (V26.41)
    const lines = t.split('\n'), head = lines.length > 1 ? lines.shift() : '';
    tip.innerHTML = (head ? '<b>' + esc(head) + '</b>' : '') + lines.map(esc).join('<br>');
    timer = setTimeout(() => { if (cur !== el || !document.contains(el)) return; place(el); tip.classList.add('on'); }, 250);
  });
  document.addEventListener('mouseout', e => { if (cur && (!e.relatedTarget || !cur.contains(e.relatedTarget))) hide(); });
  document.addEventListener('scroll', hide, true); document.addEventListener('mousedown', hide, true); window.addEventListener('blur', hide);
})();
