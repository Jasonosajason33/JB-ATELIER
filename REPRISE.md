# JB Flow — fichier de reprise (état au 3 octobre 2026, version 26.203)

Coller ce fichier au début d'une nouvelle session Claude (cloud ou locale) pour reprendre le travail sans perte.
Les notes détaillées sont dans le dossier `notes-claude/` (règles de livraison, vocabulaire, module Révision, film).

## Le projet
- Application statique `app/` mise en ligne sur Cloudflare (https://jbflow.app-flow.workers.dev) depuis le dépôt GitHub « JB-FLOW-AUTOMATIC » (commande de build : `node build.js`). Base de données Supabase.
- Sources : `src/app/NN-*.js`, assemblées dans `app/app.js` par `build.ps1` (PC sans Node) ou `build.js`.
- Démo publiée (données fictives) : https://claude.ai/artifact/PaW1TkQGP4JfcWnmWqchyj — page `pub-demo/jbflow-demo.html`.
- Tests du moteur : `app/tests/moteur.html` (7 tests, tous verts en 26.203).
- Dépôt de travail : GitHub « JB-ATELIER » (branche `claude/new-session-hylho7`) contient `app/`, `src/`, `supabase/`, `pub-demo/` et `sim/preview-cards.css`. Le dépôt « JB-FLOW-AUTOMATIC » (mis en ligne par Cloudflare) était resté en 26.45 au 3 octobre.
- Outils de test automatisés (Edge sans fenêtre) : `sim/build-steps.ps1` + `sim/cdp-steps.ps1` ; aides `sim/crypto-helpers.js`.

## Règles permanentes
- Réponses en français.
- Jamais de clé service_role / secrète dans le code (clé anon uniquement). Aucun service payant. Noms des clients chiffrés (phrase secrète jamais enregistrée ni envoyée).
- Pied de page exact, sans gras : « Outil pensé et développé par Jason BAHI, Expert-comptable inscrit à l'Ordre des Experts-Comptables. 2026 © JB FLOW – Version 26.xxx ».
- À chaque modification : version +1 dans `app/config.js` ET `pub-demo/config.js` ; lancer les 7 tests ; livrer `jb-flow-V26.xxx.zip` (app, src, supabase) ; dire de redéployer tout `app` (avec `app/tests`, `app/demo.html`) + `src` et signaler toute migration Supabase ; republier la démo (copier `app/app.js` et les CSS modifiées dans `pub-demo/`).
- Jamais les mots « surcharge » / « charge » pour les RC, collaborateurs et apprentis (le manager garde son vocabulaire).

## En attente
- Aperçu « cartes de tâches fines + coche minimaliste » : visible seulement dans la démo (`sim/preview-cards.css`, ajouté à `pub-demo/design-effects.css` à chaque copie) — à valider avant intégration.
- Après déploiement de la 26.181 et plus : ouvrir l'application avec le compte administrateur, dans sa propre vue, pour nettoyer automatiquement les doublons de tableaux de bord déjà enregistrés.

## Dernières versions (26.176 → 26.203)
- 26.176 : système d'animation commun aux 4 thèmes (`app/design-motion.css`, `src/app/021-mouvement.js` : FAST 140 / MEDIUM 200 / SLOW 280 ms, courbe cubic-bezier(.22, 1, .36, 1)).
- 26.177 → 26.180 : cartes affinées (TVA, alertes, IS / CFE / CVAE, réceptions ajustées, historique, Dashboard Clients, fenêtre du Suivi TVA) ; effet de clic « ripple » (380 ms) ; doublons de tableaux de bord corrigés.
- 26.181 : audit — plus aucune action ne gonfle un planning (temps d'un dossier scindé, demandes d'informations, réception partielle, génération du mois, création / import de dossiers).
- 26.182 : bulle « Non planifiés » sans heures supplémentaires, renvoi vers le manager.
- 26.183 : glisser une tâche contre le bord de l'écran pour changer de semaine.
- 26.184 : orange vif à la place du bronze dans les jauges.
- 26.185 : aucune alerte ni phrase de remplissage sous 108 % (seuil `ALERT_PCT` dans `src/app/02-rendu-composants.js`, toujours passer par `alertsOf`).
- 26.186 : onglet Planning en « cockpit » d'équipe (`src/app/071-planning-cockpit.js`, styles `app/design-planning.css`, lien ajouté dans `index.html`, `demo.html` et la démo publiée). 4 indicateurs cliquables (à traiter aujourd'hui, en retard, à recevoir, terminé), date + Jour / Semaine / Mois, filtres (équipe ou une personne, type, dossier, statut, recherche), frise horaire 08:00 → 18:00 de toute l'équipe (heures = enchaînement depuis `day_start`, comme avant), ligne de l'heure actuelle, tâche « en cours » = sous cette ligne (affichage seulement), ligne « À affecter » (non planifiées, à glisser sur une personne), semaine de l'équipe, mois = frise de l'onglet Équipe ; cartes Activité / Tâches à affecter / À surveiller / Synthèse ; barres de remplissage à 3 états (< 90 % vert, 90–100 % orange, > 100 % rouge) sans pourcentage ; « surcharge » seulement pour le manager et au-delà de 108 % ; « Replanifier le mois » devient « Optimiser le planning » dans le Planning (résumé, propositions, rien sans « Appliquer » ; Pilotage inchangé). Aucune migration Supabase.
- 26.187 : Planning plus compact (en-tête remonté, indicateurs et filtres moitié moins hauts, filtre « Tous les types » retiré, espace avant les cartes), demandes d'informations en rose ; Aujourd'hui : bandeau « J-n avant le … » 30 % moins haut (`app/styles.css`).
- 26.188 : Planning — chiffres des 4 indicateurs à la couleur de leur point ; carte Synthèse en tuiles colorées (tâches bleu, heures violet, collaborateurs turquoise, terminées vert).
- 26.189 : titre « Planning / Équipe » du plateau à la taille des titres de cartes ; libellés des indicateurs et zéros en noir.
- 26.190 : Aujourd'hui (toutes les vues) — en-tête resserré, noms des personnes sur la ligne du titre au centre, anneau du mois plus petit à droite à côté du premier bandeau (les cartes remontent) ; bouton « Équipe » pour le manager (`S.todayTeam`) qui additionne toute l'équipe visible dans les cartes (activité, reste à faire, réceptions, alertes, production avec le nom de chacun). `ringHtml` et `progressBanner` acceptent une liste de personnes.
- 26.191 : menu coloré — icône « Déclarer une réception » visible (pastille blanche, icône et compteur à la couleur du thème).
- 26.192 : Planning du collaborateur (et de l'apprenti) organisé comme celui du RC : semaine en grille d'équipe (une ligne), mois en frise (`pcSolo`).
- 26.193 : Planning, vue Mois du mois en cours — seuls les jours à partir d'aujourd'hui sont affichés (frise d'équipe et calendrier d'une personne), menu « Du n à la fin du mois / Tout le mois » (`S.pcMonthAll`) ; les totaux de période restent complets.
- 26.194 : Aujourd'hui — la carte « Reste à faire » est cliquable : elle ouvre le Planning, vue Jour d'aujourd'hui, de la personne affichée (ou de toute l'équipe en mode Équipe).
- 26.195 : Pilotage › Vue d'ensemble — fenêtres des cartes « Production » (Dossiers, Reçus, Planifiés, Terminés, En retard) : lignes environ 40 % moins hautes (`.sheet.st-prodDetail`, `app/styles.css`).
- 26.196 : toutes les fenêtres — barre de défilement fine, gardée à l'intérieur des coins arrondis (`.sheet::-webkit-scrollbar…`, `app/styles.css`).
- 26.197 : Aujourd'hui (manager, RC, collaborateur, apprenti) — bandeau discret « Demandes d'informations » (n à faire · faites · non nécessaires · non renseignées) ; un clic ouvre la liste (`irStrip`, `sheetIrList`, fenêtre `irList`) avec « Faite ». « À faire » = notée à faire ou tâche « Demande d'infos » non terminée.
- 26.198 : bandeau des demandes placé sous les 4 cartes d'Aujourd'hui et ajouté dans le Planning (sous les filtres, personnes affichées) ; fenêtre plus large (820 px), lignes 40 % moins hautes.
- 26.199 : bandeau des demandes retiré du Planning (reste sur Aujourd'hui).
- 26.200 : bandeau des demandes — plus de bulle au survol.
- 26.201 : bandeau CVAE sur Aujourd'hui limité à la saison (1er mai → 30 juin) et jamais pour une échéance antérieure au premier mois d'utilisation ; le suivi CVAE garde les retards.
- 26.202 : exception par utilisateur (Paramètres › Utilisateurs › fiche, case « Exception », administrateur seulement) : la personne peut modifier tous les paramètres des fiches de SES dossiers (`clientEditor()`, réglage `client_editors` = liste d'e-mails dans les paramètres de planification). À cocher pour Eva (eva.cadillon@inextenso.fr). La base (droits Supabase existants) n'autorise un membre qu'à modifier les dossiers de son binôme.
- 26.203 : Planning — listes ouvertes par les 4 indicateurs et « À surveiller » : lignes deux fois moins hautes, sur une seule ligne (`.pc-frame`, `app/design-planning.css`).

## Film de présentation (v3 du 1er octobre 2026 — à reprendre plus tard)
- But : présenter JB Flow aux supérieurs. Lien : https://claude.ai/artifact/J1CXu3csSo28ST8YGcrTpH (v3 publiée).
- Fichiers : `video/jbflow-film.html` (animation GSAP 3.12.5), captures `video/img/*.jpg` (thème Signature, 2948 × 1660) et `video/img/logo.png` (copie de `app/logo-512.png`). Pour republier : même lien, avec les images en fichiers joints (`img/*` → `video/img/*`).
- Contenu de la v3 : ouverture sur le vrai logo ; couleurs Signature (dégradé #4fe0a0 → #d9f26b, plus de bronze, plus de reflet) ; effet loupe (option `l:[x%,y%]`) puis zoom sur une zone `r:[x,y,w,h]` en % de la capture ; environ 8 s par capture ; 3 scènes « Le Manager anticipe / Le responsable client pilote / Le collaborateur produit en toute sérénité » ; cartons de rôle tenus 3,2 s ; durée 2 min 34.
- Les chiffres de la capture « agent » (14 mois, ± 1,8 j, ± 12 %, 3 clients) sont fictifs : à présenter comme une démo.
- Vérifier les images : `sim/cdp-look.ps1` avec des étapes `tl.pause();tl.time(X);0` (toujours finir l'étape par `;0`, sinon le script bloque).
- Attentes : style Apple / Samsung dynamique, phrases courtes, défilement continu, captures nettes.

## Module « Révision annuelle » (R1.0 du 2 octobre 2026 — développé à part, à intégrer plus tard)
- But : anticiper et piloter la production comptable annuelle (capacité, IA). Il sera intégré plus tard dans l'onglet « Révision » de JB Flow ; d'ici là, ne rien toucher dans `app/` ni dans Supabase pour lui.
- Dossier : `revision-annuelle/` (index.html, engine.js moteur pur, seed.js démo fictive, app.js, views1.js, views2.js, style.css Signature sombre, CONCEPTION.md). Pied de page : version JB Flow 26.161.
- Démo publiée : https://claude.ai/artifact/JCvCJnZtnbCCYtiTBVg6wx (page `revision-annuelle/jbflow-revision.html` + fichiers joints). Livrable : `jb-flow-revision-R1.0.zip`.
- Tests : `sim/rev-test.js` lancé par `sim/cdp.ps1` — 50 tests de clics de bout en bout, tous OK au 2 octobre. Captures : `sim/cdp-look.ps1` (ordinateur) et `sim/cdp-mob.ps1` (téléphone, 390 px).
- La démo garde ses données dans le navigateur (localStorage `jbflow-revision-v1`). L'intégration prévue est décrite dans `revision-annuelle/CONCEPTION.md` §9 (tables rev_*, droits par cabinet, heures du planning JB Flow déduites de la capacité).
- Pour toute évolution : travailler dans `revision-annuelle/`, relancer `rev-test.js`, republier sur le même lien.

## Points techniques utiles
- Droits Supabase : seul l'administrateur peut supprimer une tâche (les membres : seulement une demande d'informations).
- `build.ps1` trie les fichiers à la française (021 avant 02), `build.js` en ordre brut (02 avant 021) : un fichier source ne doit rien exécuter au chargement qui dépende d'un autre.
- Ne jamais nommer une classe CSS `main` ; la classe `up` est globale ; les cartes chiffres ont des règles `!important` (V26.156).
