# JB Flow — fichier de reprise (état au 4 octobre 2026, version 26.185)

Coller ce fichier au début d'une nouvelle session Claude (cloud ou locale) pour reprendre le travail sans perte.
Les notes détaillées sont dans le dossier `notes-claude/` (règles de livraison, vocabulaire, module Révision, film).

## Le projet
- Application statique `app/` mise en ligne sur Cloudflare (https://jbflow.app-flow.workers.dev) depuis le dépôt GitHub « JB-FLOW-AUTOMATIC » (commande de build : `node build.js`). Base de données Supabase.
- Sources : `src/app/NN-*.js`, assemblées dans `app/app.js` par `build.ps1` (PC sans Node) ou `build.js`.
- Démo publiée (données fictives) : https://claude.ai/artifact/PaW1TkQGP4JfcWnmWqchyj — page `pub-demo/jbflow-demo.html`.
- Tests du moteur : `app/tests/moteur.html` (7 tests, tous verts en 26.185).
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

## Dernières versions (26.176 → 26.185)
- 26.176 : système d'animation commun aux 4 thèmes (`app/design-motion.css`, `src/app/021-mouvement.js` : FAST 140 / MEDIUM 200 / SLOW 280 ms, courbe cubic-bezier(.22, 1, .36, 1)).
- 26.177 → 26.180 : cartes affinées (TVA, alertes, IS / CFE / CVAE, réceptions ajustées, historique, Dashboard Clients, fenêtre du Suivi TVA) ; effet de clic « ripple » (380 ms) ; doublons de tableaux de bord corrigés.
- 26.181 : audit — plus aucune action ne gonfle un planning (temps d'un dossier scindé, demandes d'informations, réception partielle, génération du mois, création / import de dossiers).
- 26.182 : bulle « Non planifiés » sans heures supplémentaires, renvoi vers le manager.
- 26.183 : glisser une tâche contre le bord de l'écran pour changer de semaine.
- 26.184 : orange vif à la place du bronze dans les jauges.
- 26.185 : aucune alerte ni phrase de remplissage sous 108 % (seuil `ALERT_PCT` dans `src/app/02-rendu-composants.js`, toujours passer par `alertsOf`).

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
