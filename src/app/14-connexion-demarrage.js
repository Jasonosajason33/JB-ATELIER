  /* ====================== Connexion ====================== */
  /* ====================== Page de connexion « JB Flow » ======================
   * Fond vivant, verre dépoli, cartes et pastilles que la souris peut pousser, bouton magnétique
   * à pixels 3D, compte à rebours de la période, transition vers l'application.
   * Les effets déclenchés par l'utilisateur restent actifs même si le système réduit les animations. */
  let lgCtl = null; // AbortController des écouteurs de la page de connexion
  const LG_ICON = {
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="3"/><path d="m4.5 7 7.5 6 7.5-6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>'
  };
  /* Logo « JB » qui se dessine trait par trait */
  const LG_LOGO = '<img class="lg-mono" src="logo-192.png" alt="JB Flow" width="64" height="64">';
  const LG_OLD = new URLSearchParams(location.search).get('accueil') === 'ancien'; // V26.50 : ?accueil=ancien affiche l'ancienne page (comparaison)
  function lgPage(cardHtml) {
    return '<div class="lg" id="lg"><div class="lg-bg" aria-hidden="true"><div class="lg-blob b1"></div><div class="lg-blob b2"></div><div class="lg-blob b3"></div><div class="lg-grid"></div><div class="lg-spot"></div><div class="lg-noise"></div></div>'
      + '<main class="lg-wrap"><section class="lg-hero">'
      + '<div class="lg-brand lg-in" style="--d:0"><div class="lg-logo">' + LG_LOGO + '</div><div><b class="lg-name">JB Flow</b><small>Production comptable &amp; TVA</small></div></div>'
      + '<h1 class="lg-h1 lg-in" style="--d:1">Le pilotage de la<br>production comptable,<span class="g" style="--d:2">en flux continu.</span><span class="g" style="--d:3">en équipe.</span><span class="g" style="--d:4">sans retard.</span></h1>'
      + (LG_OLD ? '<div class="lg-chips lg-in" style="--d:5"><span class="lg-chip lg-body" style="--b:0s"><i></i>Planification automatique</span>' : '<div class="lg-chips lg-in" style="--d:5"><span class="lg-agent"><i>✦</i>Agent de planification intégré</span>')
      + '<span class="lg-chip lg-body" style="--b:-2.3s"><i></i>Temps réel partagé</span><span class="lg-chip lg-body" style="--b:-4.1s"><i></i>Alertes à J-3</span></div>'
      + (LG_OLD ? '' : '<div class="lg-cards lg-in" style="--d:6">'
        + '<div class="lg-cardx feat lg-body" style="--b:-1.2s"><div class="h"><span class="ico">✦</span>Agent de planification</div><p>Il apprend quand chaque client dépose ses pièces et le temps réel de chaque dossier, <b>propose automatiquement le planning du mois suivant</b>, puis l\'ajuste dès que les pièces arrivent.</p><div class="stat"><b>−25 %</b><span>d\'écart sur les dates de réception · temps prévus 2× plus justes</span></div></div>'
        + '<div class="lg-cardx lg-body" style="--b:-3.4s"><div class="h"><span class="ico r"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF8A8A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/></svg></span>Échéances menacées vues à l\'avance</div><p>Une échéance menacée est signalée avant qu\'il soit trop tard, avec une solution de répartition.</p><div class="stat"><b>~3 sem.</b><span>d\'anticipation</span></div></div>'
        + '<div class="lg-cardx lg-body" style="--b:-5.1s"><div class="h"><span class="ico b"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A9C2FF" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></span>Sa journée, clairement</div><p>Chaque collaborateur retrouve ses priorités du jour, son niveau d\'activité de la semaine et les clients à relancer.</p></div>'
        + '</div>')
      + (LG_OLD ? '<div class="lg-stage lg-in" style="--d:6" aria-hidden="true">'
      + '<div class="lg-fc lg-body fc-a"><svg class="lg-ring" viewBox="0 0 58 58"><circle cx="29" cy="29" r="24" stroke="rgba(255,255,255,.12)"/><circle cx="29" cy="29" r="24" stroke="#3DDC84" stroke-dasharray="145 151" transform="rotate(-90 29 29)"/></svg><div><div class="l">Niveau d\'activité du jour</div><div class="v">6h45 <span>/ 7h</span></div></div></div>'
      + '<div class="lg-fc lg-body fc-b"><div class="l">Réceptions</div><div class="v">3 à valider</div><div class="lg-avs"><span style="background:#3DDC84">PB</span><span style="background:#E4F25A">MC</span><span style="background:#2FD3C1">PL</span></div></div>'
      + '<div class="lg-fc lg-body fc-c"><div class="l">DUPONT SARL · DES</div><div class="v sm">À déposer avant le 10</div><span class="lg-pill">' + LG_ICON.clock + 'J-2</span></div>'
      + '<div class="lg-fc lg-body fc-d"><div class="l">Équipe · remplissage</div><div class="v">72 %</div><div class="lg-bars"><i style="height:40%"></i><i style="height:62%"></i><i class="on" style="height:88%"></i><i class="hot" style="height:70%"></i><i class="hot" style="height:54%"></i></div></div>'
      + '</div>' : '') + '</section>'
      + '<section class="lg-side"><div class="lg-card lg-in" style="--d:2" id="lg-card">' + cardHtml + '</div>'
      + '</section></main>'
      + legalHtml().replace('class="legal"', 'class="legal lg-legal"') + '</div>';
  }
  function lgMsg(msg) { return msg ? '<div class="lg-msg ' + (msg.type || '') + '">' + esc(msg.text) + '</div>' : ''; }
  /* Effets : lumière, cartes et pastilles « physiques », bouton magnétique + pixels 3D */
  function lgFx() {
    if (lgCtl) lgCtl.abort();
    lgCtl = new AbortController();
    const sig = { signal: lgCtl.signal }, root = $('#lg'); if (!root) return;
    const card = $('#lg-card');
    const bodies = [...root.querySelectorAll('.lg-body')].map(el => ({ el, x: 0, y: 0, vx: 0, vy: 0, r: 0 }));
    const ptr = { x: -1e4, y: -1e4, vx: 0, vy: 0, t: 0 };
    let loopOn = false, tiltRaf = 0;
    addEventListener('pointermove', e => {
      root.style.setProperty('--mx', e.clientX + 'px'); root.style.setProperty('--my', e.clientY + 'px');
      const now = performance.now(), dt = Math.max(8, now - ptr.t);
      if (ptr.t) { ptr.vx = (e.clientX - ptr.x) / dt * 16; ptr.vy = (e.clientY - ptr.y) / dt * 16; }
      ptr.x = e.clientX; ptr.y = e.clientY; ptr.t = now;
      if (!loopOn) { loopOn = true; requestAnimationFrame(step); }
      if (!tiltRaf && card && innerWidth > 920) tiltRaf = requestAnimationFrame(() => { tiltRaf = 0; const px = e.clientX / innerWidth - .5, py = e.clientY / innerHeight - .5; card.style.transform = 'perspective(1200px) rotateY(' + (px * 3) + 'deg) rotateX(' + (-py * 3) + 'deg)'; });
    }, sig);
    function step() {
      if (!document.body.contains(root)) { loopOn = false; return; }
      let energy = 0;
      for (const b of bodies) {
        const r = b.el.getBoundingClientRect();
        const inside = ptr.x > r.left - 6 && ptr.x < r.right + 6 && ptr.y > r.top - 6 && ptr.y < r.bottom + 6;
        b.el.classList.toggle('hit', inside);
        if (inside) { const dx = r.left + r.width / 2 - ptr.x, dy = r.top + r.height / 2 - ptr.y, d = Math.hypot(dx, dy) || 1; b.vx += ptr.vx * .22 + dx / d * .9; b.vy += ptr.vy * .22 + dy / d * .9; }
        b.vx += -b.x * .045; b.vy += -b.y * .045; b.vx *= .86; b.vy *= .86; b.x += b.vx; b.y += b.vy;
        b.x = Math.max(-140, Math.min(140, b.x)); b.y = Math.max(-110, Math.min(110, b.y));
        b.r += (b.vx * .6 - b.r) * .2;
        b.el.style.transform = 'translate3d(' + b.x.toFixed(2) + 'px,' + b.y.toFixed(2) + 'px,0) rotate(' + Math.max(-9, Math.min(9, b.r)).toFixed(2) + 'deg)';
        energy += Math.abs(b.x) + Math.abs(b.y) + Math.abs(b.vx) + Math.abs(b.vy) + (inside ? 1 : 0);
      }
      ptr.vx *= .7; ptr.vy *= .7;
      if (energy > .05) requestAnimationFrame(step); else loopOn = false;
    }
    // Bouton magnétique
    const btn = $('#lg-go'); if (!btn) return;
    const mag = { x: 0, y: 0, tx: 0, ty: 0, s: 1, ts: 1, on: false };
    // Magnétisme : le bouton est attiré par la souris quand elle s'en approche
    addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      const r = btn.getBoundingClientRect(), cx = r.left + r.width / 2 - mag.x, cy = r.top + r.height / 2 - mag.y;
      const dx = e.clientX - cx, dy = e.clientY - cy, zone = Math.max(r.width, r.height) * .75;
      const inZone = Math.abs(dx) < r.width / 2 + 130 && Math.abs(dy) < r.height / 2 + 100;
      mag.tx = inZone ? Math.max(-30, Math.min(30, dx / zone * 26)) : 0; mag.ty = inZone ? Math.max(-18, Math.min(18, dy / zone * 16)) : 0; mag.ts = inZone ? 1.04 : 1;
      if (!mag.on) { mag.on = true; requestAnimationFrame(magStep); }
    }, sig);
    function magStep() {
      mag.x += (mag.tx - mag.x) * .16; mag.y += (mag.ty - mag.y) * .16; mag.s = (mag.s || 1) + ((mag.ts || 1) - (mag.s || 1)) * .16;
      btn.style.transform = 'translate3d(' + mag.x.toFixed(2) + 'px,' + mag.y.toFixed(2) + 'px,0) scale(' + mag.s.toFixed(3) + ')';
      btn.classList.toggle('lg-near', (mag.ts || 1) > 1);
      if (Math.abs(mag.tx - mag.x) + Math.abs(mag.ty - mag.y) + Math.abs((mag.ts || 1) - mag.s) > .05 && document.body.contains(btn)) requestAnimationFrame(magStep); else mag.on = false;
    }
  }
  /* Transition vers l'application : « Accueil personnalisé ».
     « Bonjour Prénom » s'écrit en dégradé pendant que l'anneau autour du logo se remplit (= chargement des données),
     puis l'écran d'accueil s'efface sur l'application. Uniquement opacité / transformations (fluide sur PC et iPhone).
     Animations « Réduites » : même écran, en simple fondu, sans mouvement. */
  function lgName(email) {
    try { const c = JSON.parse(lsGet('planif-last-name') || 'null'); if (c && c.email === email && c.name) return c.name; } catch (e) {}
    const u = S.store.mode === 'demo' ? S.store.demoUsers().find(x => x.email.toLowerCase() === email) : null;
    if (u) return u.name.split(' ')[0];
    const p = (email || '').split('@')[0].split(/[._-]/)[0];
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : '';
  }
  function lgExit(then, email) {
    const root = $('#lg');
    if (lgCtl) { lgCtl.abort(); lgCtl = null; }
    haptic();
    if (!root || !root.animate) return then();
    const soft = document.documentElement.dataset.motion === 'reduced';
    email = (email || '').toLowerCase();
    const name = lgName(email);
    const word = 'Bonjour' + (name ? ' ' + name : '');
    const dl = new Date(today() + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const n = word.length;
    const ov = document.createElement('div'); ov.className = 'lg-hello';
    ov.innerHTML = '<div class="in"><div class="ring"><svg viewBox="0 0 100 100"><defs><linearGradient id="lgh-g"><stop offset="0" stop-color="#3DDC84"/><stop offset="1" stop-color="#E4F25A"/></linearGradient></defs><circle cx="50" cy="50" r="45" class="tr"/><circle cx="50" cy="50" r="45" class="ar" stroke="url(#lgh-g)"/></svg><img src="logo-192.png" alt=""></div>'
      + '<h1>' + [...word].map((c, i) => '<span style="background-size:' + n * 100 + '% 100%;background-position:' + (n > 1 ? i * 100 / (n - 1) : 0) + '% 0">' + (c === ' ' ? '&nbsp;' : esc(c)) + '</span>').join('') + '</h1>'
      + '<p>' + esc(dl.charAt(0).toUpperCase() + dl.slice(1)) + ' · bonne production !</p></div>';
    document.body.appendChild(ov);
    const inner = ov.querySelector('.in'), arc = ov.querySelector('.ar'), C = 283;
    const EZ = 'cubic-bezier(.2,.8,.2,1)';
    // 1. L'écran d'accueil recouvre la connexion
    ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out', fill: 'backwards' });
    ov.querySelector('.ring').animate(soft ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 60, easing: EZ, fill: 'backwards' });
    // 2. « Bonjour Prénom » lettre par lettre
    [...ov.querySelectorAll('h1 span')].forEach((s, i) => s.animate(soft ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(.45em)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 100 + i * 18, easing: EZ, fill: 'backwards' }));
    const t0 = Date.now(), lettersEnd = 100 + n * 18 + 320, pause = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
    ov.querySelector('p').animate(soft ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 200 + n * 18, easing: EZ, fill: 'backwards' });
    // 3. L'anneau suit le chargement des données
    arc.animate([{ strokeDashoffset: C }, { strokeDashoffset: C * .2 }], { duration: 520, delay: 80, easing: EZ, fill: 'forwards' });
    const done = Promise.resolve().then(then).catch(() => {});
    Promise.all([Promise.race([done, new Promise(r => setTimeout(r, 2500))]), new Promise(r => setTimeout(r, 520))]).then(async () => {
      try { if (S.me && S.me.name && S.me.email) lsSet('planif-last-name', JSON.stringify({ email: String(S.me.email).toLowerCase(), name: S.me.name.split(' ')[0] })); } catch (e) {}
      arc.animate([{ strokeDashoffset: C * .2 }, { strokeDashoffset: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
      await pause(Math.max(220, lettersEnd - (Date.now() - t0)) + 180); // minuteries (et non .finished) : jamais bloqué, même onglet en arrière-plan
      // 4. L'accueil s'efface sur l'application
      inner.animate(soft ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-22px) scale(.97)' }], { duration: 260, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
      ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 60, easing: 'ease-in-out', fill: 'forwards' });
      await pause(380); ov.remove();
    });
  }
  /* Petite vibration de confirmation (Android : API Vibration ; iPhone iOS 18+ : interrupteur natif « switch ») */
  function haptic() {
    try {
      if (navigator.vibrate) { navigator.vibrate(14); return; }
      const l = document.createElement('label'), i = document.createElement('input');
      i.type = 'checkbox'; i.setAttribute('switch', ''); l.appendChild(i);
      l.style.cssText = 'position:fixed;left:-99px;top:0;opacity:0;pointer-events:none';
      document.body.appendChild(l); l.click(); l.remove();
    } catch (e) { /* sans vibration : aucun effet */ }
  }
  function renderLogin(msg) {
    const demo = S.store.mode === 'demo', users = demo ? S.store.demoUsers() : [];
    const card = '<span class="lg-badge"><i></i>' + (demo ? 'Mode démonstration' : 'Espace cabinet sécurisé') + '</span><h2 id="lg-title">Bienvenue !</h2><p class="lg-sub" id="lg-subt">Travaillez en toute sérénité.</p>' + lgMsg(msg)
      + '<form id="login-form" novalidate>'
      + '<div class="lg-field"><label for="lg-email">E-mail professionnel</label><div class="lg-inp">' + LG_ICON.mail + '<input id="lg-email" name="email" type="email" placeholder="prenom.nom@cabinet.fr" autocomplete="username" required></div></div>'
      + (demo ? '<div class="lg-demo">' + users.map(u => '<button type="button" class="lg-dchip" data-demo="' + esc(u.email) + '"><span class="lg-av">' + esc(initials(u.name)) + '</span>' + esc(u.name.split(' ')[0]) + (u.role === 'admin' ? ' · admin' : '') + '</button>').join('') + '</div>' : '')
      + '<div class="lg-field"><label for="lg-pw">Mot de passe</label><div class="lg-inp">' + LG_ICON.lock + '<input id="lg-pw" name="password" type="password" placeholder="' + (demo ? 'Libre en démonstration' : '8 caractères minimum') + '" autocomplete="current-password" required minlength="8"><button type="button" class="lg-eye" id="lg-eye" aria-label="Afficher le mot de passe">' + LG_ICON.eye + '</button></div></div>'
      + '<div class="lg-field" id="signup-extra" style="display:none"><label for="lg-pw2">Confirmer le mot de passe</label><div class="lg-inp">' + LG_ICON.lock + '<input id="lg-pw2" name="password2" type="password" autocomplete="new-password" minlength="8"></div></div>'
      + '<div class="lg-row"><label class="lg-tog"><input type="checkbox" id="lg-remember"' + (lsGet('planif-remember') === '0' ? '' : ' checked') + '><span class="t"></span>Rester connecté</label>' + (demo ? '' : '<a class="lg-link" href="#" id="to-reset">Mot de passe oublié ?</a>') + '</div>'
      + '<button class="lg-btn" id="lg-go" type="submit"><span id="lg-go-t">Se connecter</span>' + LG_ICON.arrow + '</button></form>'
      + (demo ? '<div class="lg-secure">' + LG_ICON.shield + 'Démonstration : choisissez un profil ci-dessus, le mot de passe est libre'
        : '<div class="lg-or">ou</div><button class="lg-ghost" type="button" id="to-signup">Première connexion : créer mon accès</button><div class="lg-secure">' + LG_ICON.shield + 'Connexion chiffrée · accès réservé aux membres du cabinet') + '</div>';
    $('#app').innerHTML = lgPage(card);
    lgFx();
    let mode = 'login';
    const form = $('#login-form'), pw = $('#lg-pw');
    // E-mail retenu sur cet appareil (navigateur) : rien n'est envoyé à un serveur
    const lastEmail = lsGet('planif-last-email');
    if (lastEmail) { form.email.value = lastEmail; document.querySelectorAll('.lg-dchip').forEach(x => x.classList.toggle('on', x.dataset.demo === lastEmail)); setTimeout(() => { try { pw.focus({ preventScroll: true }); } catch (e) {} }, 400); }
    $('#lg-eye').onclick = () => { pw.type = pw.type === 'password' ? 'text' : 'password'; };
    if (demo) {
      document.querySelectorAll('[data-demo]').forEach(b => (b.onclick = () => { form.email.value = b.dataset.demo; document.querySelectorAll('.lg-dchip').forEach(x => x.classList.toggle('on', x === b)); pw.focus(); }));
    } else {
      $('#to-signup').onclick = e => {
        e.preventDefault(); mode = mode === 'signup' ? 'login' : 'signup';
        $('#signup-extra').style.display = mode === 'signup' ? '' : 'none';
        $('#lg-go-t').textContent = mode === 'signup' ? 'Créer mon accès' : 'Se connecter';
        $('#lg-title').textContent = mode === 'signup' ? 'Créer mon accès' : 'Bienvenue !';
        $('#lg-subt').textContent = mode === 'signup' ? 'Utilisez l\'adresse e-mail enregistrée par votre administrateur.' : 'Travaillez en toute sérénité.';
        e.target.textContent = mode === 'signup' ? 'J\'ai déjà un accès : me connecter' : 'Première connexion : créer mon accès';
      };
      $('#to-reset').onclick = async e => { e.preventDefault(); const email = form.email.value.trim(); if (!email) { renderLogin({ type: 'warn', text: 'Saisissez d\'abord votre e-mail, puis cliquez sur « Mot de passe oublié ».' }); return; } try { await S.store.resetPassword(email); renderLogin({ type: 'ok', text: 'Si ce compte existe, un e-mail de réinitialisation vient d\'être envoyé.' }); } catch (er) { renderLogin({ type: 'bad', text: errMsg(er) }); } };
    }
    form.onsubmit = async e => {
      e.preventDefault();
      const email = form.email.value.trim().toLowerCase(), password = pw.value, go = $('#lg-go'), t = $('#lg-go-t'), label = t.textContent;
      if (demo) {
        if (!users.some(u => u.email.toLowerCase() === email)) { renderLogin({ type: 'warn', text: 'En démonstration, choisissez un des profils proposés (ex. ' + (users[0] ? users[0].email : '') + ').' }); return; }
      } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8) { renderLogin({ type: 'warn', text: 'Indiquez un e-mail valide et un mot de passe de 8 caractères minimum.' }); return; }
      lsSet('planif-remember', $('#lg-remember').checked ? '1' : '0');
      go.disabled = true; t.innerHTML = '<span class="lg-spin"></span>' + (mode === 'signup' ? 'Création…' : 'Connexion…');
      try {
        if (mode === 'signup') {
          if (password !== form.password2.value) throw new Error('Les mots de passe ne correspondent pas.');
          const r = await S.store.signUp(email, password);
          if (r && r.session) { sessionStorage.setItem('planif-alive', '1'); return lgExit(() => start(email), email); }
          return renderLogin({ type: 'ok', text: 'Compte créé. Un e-mail de confirmation vous a été envoyé : cliquez sur le lien, puis revenez vous connecter.' });
        }
        await S.store.signIn(email, password);
        sessionStorage.setItem('planif-alive', '1'); lsSet('planif-last-email', email);
        t.textContent = 'Bienvenue';
        lgExit(() => start(email), email);
      } catch (er) { go.disabled = false; t.textContent = label; renderLogin({ type: 'bad', text: /invalid login/i.test(errMsg(er)) ? 'E-mail ou mot de passe incorrect (ou e-mail non confirmé).' : errMsg(er) }); }
    };
  }
  function renderPwdReset() {
    $('#app').innerHTML = lgPage('<span class="lg-badge"><i></i>Espace cabinet sécurisé</span><h2>Nouveau mot de passe</h2><p class="lg-sub">Choisissez un mot de passe d\'au moins 8 caractères.</p><form id="pw-form"><div class="lg-field"><label for="lg-np">Nouveau mot de passe</label><div class="lg-inp">' + LG_ICON.lock + '<input id="lg-np" type="password" name="p" minlength="8" required autocomplete="new-password"></div></div><button class="lg-btn" id="lg-go"><span>Enregistrer</span>' + LG_ICON.arrow + '</button></form>');
    lgFx();
    $('#pw-form').onsubmit = async e => { e.preventDefault(); try { await S.store.updatePassword(e.target.p.value); location.hash = ''; location.reload(); } catch (er) { toast(errMsg(er), 'bad'); } };
  }
  function renderNoAccess(email) {
    $('#app').innerHTML = lgPage('<span class="lg-badge warn"><i></i>Accès non autorisé</span><h2>Accès en attente</h2><p class="lg-sub">Le compte <b>' + esc(email) + '</b> n\'est pas (ou plus) autorisé. Demandez à l\'administrateur de vous ajouter dans <i>Paramètres › Utilisateurs</i> avec cette adresse e-mail.</p><button class="lg-ghost" id="lo">Se déconnecter</button>');
    lgFx();
    $('#lo').onclick = async () => { await S.store.signOut(); location.reload(); };
  }
  function looksSecret(key) {
    if (/^sb_secret_/.test(key)) return true;
    try { const p = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.role === 'service_role'; } catch (e) { return false; }
  }

  /* ====================== Démarrage ====================== */
  /* ====================== V26.168 : début d'utilisation de JB Flow ======================
   * Au premier lancement, le manager (ou l'administrateur) indique la première période de TVA traitée dans l'outil :
   * rien n'apparaît avant (dossiers, réceptions, alertes, relances, historique). Modifiable dans Paramètres › Planification.
   * Chaque RC, collaborateur ou apprenti reçoit aussi son propre début, choisi à sa création (Paramètres › Utilisateurs). */
  function startOptions(cur, min, withCab) {
    const out = [], base = defaultMonth();
    for (let i = -12; i <= 6; i++) { const m = E.addMonths(base, i); if (!min || m >= min) out.push(m); }
    if (cur && !out.includes(cur)) { out.push(cur); out.sort(); }
    return (withCab ? '<option value=""' + (!cur ? ' selected' : '') + '>Comme le cabinet' + (cabStart() ? ' (' + esc(fMonth(cabStart())) + ')' : '') + '</option>' : '')
      + out.map(m => '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + esc(fMonth(m).replace(/^./, x => x.toUpperCase())) + ' — TVA ' + esc(deMonth(E.addMonths(m, -1))) + '</option>').join('');
  }
  async function savePlanning(patch, histText) {
    const value = Object.assign({}, cfg(), patch), h = { action: 'parametres', detail: { text: histText } };
    if (S.data.settings.get('planning')) return (await saveUpdate('settings', 'planning', { value }, { history: h })) === 'ok';
    try { await saveInsert('settings', [{ id: 'planning', value }]); hist(h.action, h); return true; } catch (e) { return false; }
  }
  async function saveStart(m) {
    const ok = await savePlanning({ start_month: m || '', start_confirmed: true }, m ? 'Début d\'utilisation de JB Flow : ' + fMonth(m) : 'Début d\'utilisation de JB Flow retiré : tous les mois affichés');
    // V26.169 : « Modifier » dans le message, si on s'est trompé de mois
    if (ok) { clampToStart(); S.recSel.clear(); render(); toast(m ? 'JB Flow démarre en ' + fMonth(m) + ' : les mois précédents ne sont plus affichés.' : 'Tous les mois enregistrés sont de nouveau affichés.', 'ok', { label: 'Modifier', fn: () => askStartMonth(true) }, 9000); }
    return ok;
  }
  // Début propre à un utilisateur (vide = comme le cabinet)
  async function setUserStart(email, m) {
    const k = String(email || '').toLowerCase(), us = Object.assign({}, cfg().user_start || {});
    if (m) us[k] = m; else delete us[k];
    return savePlanning({ user_start: us }, k + ' : début d\'utilisation ' + (m ? fMonth(m) : 'comme le cabinet'));
  }
  // edit : V26.169 — revenir sur le mois choisi (Annuler possible, « aucun mois de début » proposé)
  function askStartMonth(edit) {
    if (document.querySelector('.sheet-start')) return Promise.resolve(false);
    return new Promise(resolve => {
      const root = document.createElement('div'); root.className = 'overlay anim center';
      const cur = edit ? cabStart() : (cabStart() || defaultMonth());
      root.innerHTML = '<div class="sheet sheet-start" role="dialog" aria-modal="true" aria-labelledby="st-t"><div class="sheet-h"><div style="margin-right:auto"><h2 id="st-t">' + (edit ? 'Modifier le début d\'utilisation' : 'Début d\'utilisation de JB Flow') + '</h2><div class="small muted" style="margin-top:4px">' + (edit ? 'Pour tout le cabinet' : 'Une seule fois, pour tout le cabinet') + '</div></div></div>'
        + '<div class="sheet-b"><p style="margin:0">' + (edit ? 'Tu t\'es trompé de mois ? Choisis le bon mois de la <b>première déclaration de TVA</b> préparée avec JB Flow.' : 'À partir de quand le cabinet utilise-t-il réellement JB Flow ? Choisis le mois de la <b>première déclaration de TVA</b> préparée avec l\'outil.') + '</p>'
        + '<label class="f"><span>Premier mois (première période de TVA)</span><select id="st-m">' + (edit ? '<option value=""' + (!cur ? ' selected' : '') + '>Aucun mois de début (afficher tous les mois)</option>' : '') + startOptions(cur) + '</select></label>'
        + '<div class="notice small">' + (edit ? 'Rien n\'a été effacé : un mois plus ancien fait réapparaître ses dossiers, un mois plus récent masque les précédents.' : 'Les mois précédents n\'apparaîtront nulle part : ni dossiers, ni réceptions, ni alertes, ni relances, ni historique. Rien n\'est effacé, et tu pourras revenir sur ce choix dans Paramètres.') + '</div></div>'
        + '<div class="sheet-f">' + (edit ? '<button class="btn" data-x="cancel">Annuler</button>' : '') + '<button class="btn primary" data-x="ok">' + ic('check', 'sm') + (edit ? 'Enregistrer' : 'Valider') + '</button></div></div>';
      const close = v => { fxClose(root); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = e => { if (edit && e.key === 'Escape') { e.stopPropagation(); close(false); } };
      root.addEventListener('click', async e => {
        if (edit && (e.target === root || e.target.closest('[data-x="cancel"]'))) return close(false);
        const b = e.target.closest('[data-x="ok"]'); if (!b || b.disabled) return;
        const m = root.querySelector('#st-m').value;
        if (edit && m === cabStart()) return close(false); // rien ne change
        b.disabled = true;
        if (await saveStart(m)) close(true); else b.disabled = false;
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(root);
      setTimeout(() => { const sel = root.querySelector('#st-m'); if (sel) sel.focus(); }, 60);
    });
  }
  /* V26.169 : bloc « Début d'utilisation » des Paramètres — mois choisi en clair et bouton pour le modifier */
  function startBlock() {
    const sm = cabStart();
    return '<div class="start-row"><div class="start-v"><span class="small muted">Premier mois d\'utilisation de JB Flow (première période de TVA)</span><b>' + (sm ? esc(fMonth(sm).replace(/^./, x => x.toUpperCase())) + ' — TVA ' + esc(deMonth(E.addMonths(sm, -1))) : 'Aucun : tous les mois sont affichés') + '</b></div>'
      + (S.readonly ? '' : '<button class="btn" data-act="start-edit">' + ic('calendar', 'sm') + (sm ? 'Modifier le mois de début' : 'Choisir le mois de début') + '</button>') + '</div>'
      + '<p class="small muted" style="margin:8px 0 14px">Les mois précédents n\'apparaissent nulle part : dossiers, réceptions, retards, alertes, relances, historique, planning. Tu t\'es trompé ? « Modifier » : rien n\'a été effacé, un mois plus ancien fait réapparaître ses dossiers. Le début propre à chaque RC, collaborateur ou apprenti se change dans sa fiche (Paramètres › Utilisateurs).</p>';
  }
  // Question posée au manager / à l'administrateur tant que le début n'est pas confirmé (pas dans la démo publique, sauf ?debut=1)
  async function startMonthCheck() {
    if (S.readonly || !S.me || S.realMe || !isManager()) return;
    if (S.store.mode === 'demo' && !qs.get('debut')) return;
    if (cfg().start_confirmed) return; // déjà répondu (même « aucun mois de début »)
    await askStartMonth(false);
  }
  async function start(email) {
    $('#app').innerHTML = '<div class="boot">Chargement des données…</div>';
    try { await loadAll(); cacheSnapshot(); }
    catch (e) {
      noteLimit(e);
      let snap = null; try { snap = JSON.parse(lsGet(CACHE_KEY)); } catch (er) { snap = null; }
      if (snap && snap.email && snap.email.toLowerCase() === email.toLowerCase()) {
        P.TABLES.forEach(t => (S.data[t] = new Map((snap.data[t] || []).map(r => [r.id, r]))));
        S.readonly = true; S.cacheAt = snap.at;
      } else {
        $('#app').innerHTML = '<div class="login"><div class="card"><h1>Base de données inaccessible</h1><div class="notice bad">' + esc(errMsg(e)) + '</div><p>' + (isLimitError(e) ? 'La limite de l\'offre gratuite est peut-être atteinte ou le projet Supabase est en pause (inactivité &gt; 7 jours) : ouvrez le tableau de bord Supabase et cliquez sur « Restore project ».' : 'Vérifiez la connexion Internet.') + '</p><button class="btn primary" onclick="location.reload()">Réessayer</button></div></div>';
        return;
      }
    }
    S.me = list('app_users').find(u => u.email.toLowerCase() === email.toLowerCase() && u.active);
    if (!S.me) return renderNoAccess(email);
    // V26.144 : un administrateur peut regarder l'application « en tant que » une personne (onglet en cours uniquement)
    try { const vid = sessionStorage.getItem('planif-view-user'), tgt = vid && S.me.role === 'admin' && list('app_users').find(u => u.id === vid && u.active); if (tgt && tgt.id !== S.me.id) { S.realMe = S.me; S.me = Object.assign({}, tgt); } else if (vid) sessionStorage.removeItem('planif-view-user'); } catch (e) { /* navigation privée */ }
    const cc = cryptoCfg();
    if (cc && !(await loadDeviceKey(cc))) await unlockScreen();
    if (cc) await decryptAllClients();
    S.v8 = S.store.v8 !== false;
    const saved = lsGet('planif-collab');
    S.collabId = (saved && S.data.collaborators.has(saved) && canSeeCollab(saved) ? saved : null) || S.me.collaborator_id || (visibleCollabs()[0] || {}).id || null;
    S.cursor = weekday(today()); S.month = defaultMonth(); S.recDate = today(); clampToStart(); // V26.168 : jamais avant le début d'utilisation
    S.navPinned = lsGet('planif-nav-pin') === '1';
    S.teamView = lsGet('planif-teamview') === 'gantt' ? 'gantt' : 'table';
    if (S.teamView === 'gantt') S.teamRange = 'period';
    if (!S.readonly) {
      S.store.subscribe(onRemote, st => { S.sync = st; renderStatus(); });
      setInterval(() => poll(false), 30000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(true); carryOver().catch(() => { }); } }); // V26.165 : report automatique au premier retour du jour
      window.addEventListener('online', () => { S.offline = false; poll(true); renderStatus(); });
      window.addEventListener('offline', () => { S.offline = true; renderStatus(); });
    }
    window.addEventListener('beforeunload', e => { if (S.pending || S.failed.length) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('hashchange', onRoute);
    S.ready = true;
    onRoute();
    S.v7 = S.store.v7 !== false;
    setTimeout(async () => { try { await upgradeSettings(); await autoCreateMonths(); await dedupeInfoTasks(); await carryOver(); } catch (e) { /* sans conséquence */ } agentStartup().catch(e => console.warn('Agent', e)); }, 600);
    setTimeout(() => { firstUseInit().catch(() => { }); logDailyConnexion(); checkMigrations().catch(() => { }); synthWeeklyToast(); }, 900);
    setTimeout(() => startMonthCheck().catch(() => { }), 300); // V26.168 : début d'utilisation demandé au premier lancement
    const tp = () => document.querySelector('.sheet-start') ? setTimeout(tp, 1000) : themePicker();
    setTimeout(tp, 1700); // première connexion : choix de l'ambiance (après l'écran d'accueil et la question du début d'utilisation)
    firstDemoOffer(); // V26.125 : puis proposition de la démo (bac à sable fictif)
  }
  /* Tolère les erreurs de saisie courantes dans config.js : « https:xxx », sans https, lien du tableau de bord, /rest/v1 */
  function normalizeSupabaseUrl(u) {
    u = String(u || '').trim().replace(/^['"\s]+|['"\s]+$/g, '');
    let m = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{20})/i); if (m) return 'https://' + m[1] + '.supabase.co';
    if (/^[a-z0-9]{20}$/i.test(u)) return 'https://' + u + '.supabase.co';
    u = u.replace(/^https?:\/*/i, '');
    u = 'https://' + u.replace(/\/(rest|auth)\/v1.*$/i, '').replace(/\/+$/, '');
    try { return new URL(u).origin; } catch (e) { return null; }
  }
  function configError(title, html) {
    $('#app').innerHTML = '<div class="login"><div class="card" style="max-width:560px"><h1>' + title + '</h1>' + html + '<p class="small muted">Corrigez <b>app/config.js</b>, publiez à nouveau, puis rechargez la page (Ctrl + F5).</p><button class="btn primary" onclick="location.reload()">Réessayer</button></div></div>';
  }
  async function boot() {
    try {
      if (CFG.SUPABASE_URL || CFG.SUPABASE_ANON_KEY) {
        const url = normalizeSupabaseUrl(CFG.SUPABASE_URL), key = String(CFG.SUPABASE_ANON_KEY || '').trim();
        if (!url) return configError('Adresse Supabase invalide', '<div class="notice bad">SUPABASE_URL vaut « ' + esc(CFG.SUPABASE_URL || '(vide)') + ' ».</div><p>Elle doit ressembler à <code>https://abcdefghijklmnopqrst.supabase.co</code> (Supabase › Project Settings › API › Project URL).</p>');
        if (!key || /\.\.\.|…/.test(key) || key.length < 30) return configError('Clé Supabase incomplète', '<div class="notice bad">SUPABASE_ANON_KEY est vide ou incomplète (« ' + esc(key.slice(0, 24) || '(vide)') + ' »).</div><p>Copiez la clé <b>publishable</b> en entier (elle commence par <code>sb_publishable_</code>) ou la clé <b>anon public</b> (commence par <code>eyJ</code>) : Supabase › Project Settings › API Keys, bouton « Copy ».</p>');
        CFG.SUPABASE_URL = url; CFG.SUPABASE_ANON_KEY = key;
      }
      if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
        if (looksSecret(CFG.SUPABASE_ANON_KEY)) { $('#app').innerHTML = '<div class="login"><div class="card"><h1>Configuration dangereuse</h1><div class="notice bad">config.js contient une clé SECRÈTE (service_role / secret). Elle ne doit jamais être publiée. Remplacez-la par la clé publique « anon » / « publishable », puis régénérez la clé secrète dans Supabase.</div></div></div>'; return; }
        await loadScript(SUPABASE_JS);
        S.store = new P.SupabaseStore(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
        let recovering = /type=recovery/.test(location.hash);
        S.store.onAuthChange((ev, email) => { if (ev === 'PASSWORD_RECOVERY') { recovering = true; renderPwdReset(); } });
        let email = await S.store.getSessionEmail();
        if (email && lsGet('planif-remember') === '0' && !sessionStorage.getItem('planif-alive')) { await S.store.signOut(); email = null; }
        if (recovering) return renderPwdReset();
        if (!email) return renderLogin();
        return start(email);
      }
      S.store = new P.DemoStore();
      const email = await S.store.getSessionEmail();
      if (!email) return renderLogin();
      start(email);
    } catch (e) {
      $('#app').innerHTML = '<div class="login"><div class="card"><h1>Démarrage impossible</h1><div class="notice bad">' + esc(errMsg(e)) + '</div><button class="btn primary" onclick="location.reload()">Réessayer</button></div></div>';
    }
  }
  window.PlanApp = { S, E, runPlan, readImportFile, validateReceptions, generateMonth, renderLogin }; // accès console (diagnostic)
  boot();
})();
