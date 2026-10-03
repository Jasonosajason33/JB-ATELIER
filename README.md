# Planification TVA — guide d'installation et d'utilisation (V1)

Application web collaborative de planification de la production comptable (du 2 au 24 du mois),
pour 1 à 5 utilisateurs, à coût nul.

```
Navigateur (ordinateur / iPhone)
   │  app/  = fichiers statiques (HTML/CSS/JS, sans compilation)
   │  hébergés gratuitement : Cloudflare Pages (ou Netlify)
   ▼
Supabase (offre Free, sans carte bancaire)
   ├─ PostgreSQL : toutes les données (base partagée unique)
   ├─ Auth : connexion e-mail + mot de passe
   ├─ RLS : règles d'accès dans la base (seuls les utilisateurs autorisés lisent/écrivent)
   └─ Realtime : diffusion des modifications en direct
```

## Contenu

| Fichier | Rôle |
|---|---|
| `app/index.html`, `app/styles.css` | Interface (ordinateur + interface mobile dédiée) |
| `app/engine.js` | Moteur métier : capacités, jours fériés, génération du mois, planification 2 → 24, alertes, tableau de bord |
| `app/store.js` | Accès aux données (Supabase ; ou mode démo local pour essai) |
| `app/app.js` | Écrans, sauvegarde automatique, synchronisation, conflits, import/export |
| `app/config.js` | **À compléter** : URL + clé publique Supabase |
| `supabase/schema.sql` | Tables, règles d'accès RLS, temps réel, administrateur initial |
| `exemples/dossiers_exemple.csv` | 20 dossiers fictifs pour tester l'import |

Sans configuration, l'application démarre en **mode démo** (données dans le navigateur uniquement, bandeau orange) :
utile pour essayer, **pas** pour travailler à plusieurs.

---

## Installation (≈ 20 minutes, une seule fois)

### 1. Base de données Supabase (gratuite)
1. Allez sur https://supabase.com → *Start your project* → créez un compte (GitHub ou e-mail). **Aucune carte bancaire n'est demandée.**
2. *New project* : nom `planification-tva`, mot de passe de base (conservez-le), **région Europe** (ex. Paris ou Frankfurt, pour le RGPD), plan **Free**.
3. Ouvrez `supabase/schema.sql`, remplacez `VOTRE.EMAIL@cabinet.fr` (en bas du fichier) par **votre** e-mail.
4. Dans Supabase : *SQL Editor* → *New query* → collez tout le fichier → *Run*. Résultat attendu : « Success ».
5. *Project Settings* → *API* (ou *API Keys*) : copiez **Project URL** et la clé **anon / publishable**.
   ⛔ Ne copiez jamais la clé `service_role` / `secret`.

### 2. Configurer l'application
Ouvrez `app/config.js` et collez :
```js
SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
SUPABASE_ANON_KEY: 'sb_publishable_...',   // ou la clé anon "eyJ..."
```
Ces deux valeurs sont publiques par conception : la protection est assurée par la connexion obligatoire
et les règles RLS. L'application **refuse de démarrer** si on y met une clé secrète.

### 3. Héberger (gratuit) et obtenir le lien
**Cloudflare Pages** (recommandé, sans carte) : https://dash.cloudflare.com → créer un compte →
*Workers & Pages* → *Create* → *Pages* → *Upload assets* (glisser-déposer) → nom `mon-planning` →
déposez le **contenu du dossier `app`** → *Deploy*. Lien obtenu : `https://mon-planning.pages.dev`.

Alternative : **Netlify Drop** https://app.netlify.com/drop (glisser le dossier `app`).

### 4. Relier le lien à Supabase
Supabase → *Authentication* → *URL Configuration* :
- *Site URL* : `https://mon-planning.pages.dev`
- *Redirect URLs* : `https://mon-planning.pages.dev/**`

(indispensable pour les e-mails de confirmation et de mot de passe oublié). Laissez « Confirm email » activé.

### 5. Premier accès
Ouvrez le lien → *Première connexion : créer mon accès* avec l'e-mail mis dans le SQL → confirmez l'e-mail reçu → connectez-vous.
Vous êtes administrateur.

---

## Les 9 réponses

### 1. Où sont stockées les données ?
Dans **une seule base PostgreSQL hébergée par Supabase** (région choisie à la création). Tables :
`app_users`, `collaborators`, `absences`, `clients`, `productions` (dossier × mois), `tasks`, `settings`, `history`.
Le navigateur ne garde qu'une **copie de secours en lecture seule** (affichée si la base est injoignable) —
jamais la base principale. Le code de l'application (Cloudflare) ne contient aucune donnée.

### 2. Comment fonctionne la synchronisation ?
- Chaque modification est **enregistrée immédiatement** dans la base (pas de bouton « Sauvegarder »).
  Indicateur en haut : `⏳ Enregistrement…` → `✓ Tout est enregistré`, ou `⚠ n non enregistrée(s) — Réessayer`
  en cas d'échec réseau (la donnée n'est jamais présentée comme enregistrée tant que la base n'a pas confirmé).
- **Temps réel** (pastille verte) : les autres utilisateurs voient le changement en ~1 seconde.
  Si le temps réel est indisponible : actualisation automatique toutes les 30 s (pastille orange),
  plus à chaque retour sur l'onglet/l'application, plus le bouton ⟳.
- **Conflits** : chaque ligne porte un numéro de version incrémenté par la base. Si deux personnes modifient
  la même tâche, la seconde reçoit « Cette donnée vient d'être modifiée par un autre utilisateur… » :
  rien n'est écrasé silencieusement, l'écran est actualisé.

### 3. Comment ajouter un collaborateur ?
*Paramètres › Collaborateurs › + Collaborateur* : nom, heures par jour (ex. `7h`, `6h30`), jours travaillés, couleur.
Cliquez ensuite sur le collaborateur pour ajouter congés, absences, formations (journée entière ou nombre d'heures).
Pour qu'il se connecte : *Paramètres › Utilisateurs › + Utilisateur* (e-mail, rôle, collaborateur lié).

### 4. Comment partager le lien ?
Envoyez simplement `https://mon-planning.pages.dev`. La personne (préalablement ajoutée dans *Utilisateurs*)
clique « Créer mon accès » avec son e-mail, confirme, puis se connecte. Une personne non ajoutée ne voit **aucune** donnée.
Sur iPhone : Safari → Partager → *Sur l'écran d'accueil* pour l'utiliser comme une application.

### 5. Comment importer mon Excel ?
*Dossiers › 📥 Importer Excel* (ou *Paramètres*). Colonnes reconnues (ordre libre, accents/majuscules indifférents) :
Client, Collaborateur, Fréquence, Date réception habituelle, Temps tenue, Temps lettrage, Temps TVA, Échéance TVA, Priorité, Particularités.
Temps : `1h30`, `1:30`, `45 min`, `1,5`, ou cellule Excel au format heure (nombre seul : ≤ 12 = heures, > 12 = minutes).
Un **aperçu** affiche chaque ligne (nouveau / mise à jour / erreur) avant validation ; les collaborateurs inconnus peuvent être créés.
Un dossier existant (même nom) est mis à jour. Bouton « Modèle Excel » pour partir d'un fichier vierge.
Ensuite : *Planning › Générer le mois*.

### 6. Comment sauvegarder / exporter ?
*Export & sauvegarde* : Excel (planning, charge par jour, dossiers), CSV, PDF (impression → « Enregistrer au format PDF »),
et **Exporter toutes les données** (JSON complet + Excel de toutes les tables, historique compris) pour les récupérer
indépendamment de Supabase. Une sauvegarde JSON se réimporte via « Restaurer » (migration possible vers une autre base).
👉 L'offre gratuite Supabase **n'inclut pas de sauvegarde automatique** : faites un export JSON **chaque semaine**.

### 7. Limites de l'offre gratuite (vérifiées en septembre 2026)
| Service | Offre gratuite | Notre besoin estimé |
|---|---|---|
| Supabase – base | 500 Mo | < 10 Mo/an pour 100 dossiers (taille affichée dans *Export*) |
| Supabase – trafic sortant | 5 Go/mois | < 1 Go/mois pour 5 utilisateurs (chargement limité aux mois récents + mises à jour incrémentales) |
| Supabase – utilisateurs | 50 000 actifs/mois | 5 |
| Supabase – temps réel | 200 connexions, 2 M messages/mois | ≤ 10 connexions |
| Supabase – projets | 2 actifs | 1 |
| Supabase – **mise en pause** | après **7 jours sans activité** | ⚠ ex. congés d'août : réactiver via *Restore project* (données conservées) |
| Supabase – sauvegardes | non incluses | export JSON hebdomadaire |
| Supabase – e-mails d'authentification | quelques e-mails/heure (serveur intégré) | suffisant pour 5 comptes |
| Cloudflare Pages | 500 déploiements/mois, 20 000 fichiers | 6 fichiers |

Si une limite est atteinte ou si le projet est en pause, l'application l'indique par un bandeau rouge,
reste consultable (copie locale en lecture seule) et n'annonce aucune modification comme enregistrée.

### 8. Comment éviter toute facturation ?
- Supabase Free et Cloudflare Pages Free **ne demandent pas de carte bancaire** : sans moyen de paiement, aucune facturation n'est possible.
- **N'ajoutez pas** de carte, ne cliquez pas *Upgrade to Pro*, n'activez aucun *add-on* (compute, PITR, domaine personnalisé Supabase).
- Chez Cloudflare, ne souscrivez pas *Workers Paid* ; un nom de domaine personnalisé est facultatif (le `.pages.dev` est gratuit).
- L'application n'active aucune option payante et n'utilise aucune API facturée.

### 9. Passer à une architecture payante plus tard
- **Supabase Pro** (≈ 25 $/mois) : plus de pause, sauvegardes quotidiennes, 8 Go. Aucune modification de code : même URL, même clé.
- **Autre hébergeur PostgreSQL** : `schema.sql` est du PostgreSQL standard (hors authentification Supabase) ; export JSON → Restaurer.
- **Autre back-end** : seul `app/store.js` dépend de Supabase ; le moteur (`engine.js`) et l'interface sont indépendants.
- Évolutions prévues par l'architecture : `tasks.done_at` + historique permettent d'ajouter plus tard l'analyse des temps réels.

---

## JB Flow — V26.31
- Notifications lisibles dans tous les thèmes : texte blanc, liseré et bouton d'action vert kiwi.

## JB Flow — V26.30
- Détail des échéances (TVA au 21 et au 24) : centré sous le bandeau, au-dessus du reste de la page. Il ne recouvre plus ni le mois ni le bouton « Replanifier le mois ».

## JB Flow — V26.29
- Barre de défilement « capsule flottante », à la souris, dans toute l'application (page, panneaux, listes) :
  - la barre native est masquée ; une capsule de verre apparaît en défilant, avec la position (ex. 40 %), puis s'efface ;
  - elle apparaît aussi quand la souris approche du bord droit, et se saisit pour faire défiler ;
  - sur iPhone, la barre native est conservée.
- Vue Équipe (cartes collaborateurs) : cartes alignées et de même taille. En thème Signature, les barres de la semaine passent en vert (aujourd'hui en dégradé).

## JB Flow — V26.28
- Cartes repliables (vue d'ensemble) :
  - la carte et son contour se referment réellement, en une fine barre qui garde le titre et l'indicateur ;
  - sa voisine reprend toute la largeur, sans espace vide (4 indicateurs sur une seule ligne s'il le faut) ;
  - chaque carte glisse à sa nouvelle place (0,26 s) ;
  - l'état est mémorisé sur l'appareil.

## JB Flow — V26.27
- **Week-ends** :
  - la vue Jour saute le samedi et le dimanche (vendredi → lundi) ;
  - « Aujourd'hui » un week-end ouvre le lundi ;
  - plus aucun samedi ni dimanche dans l'outil.
- **Absences** :
  - types Congés, Absence, Formation, Réunion interne, Autre (motif à préciser) ;
  - champ « Précision » (ex. séminaire, formation TVA).
- **Listes déroulantes** aux couleurs de l'application, à la souris (verre en thème Signature). Au doigt, la liste native de l'iPhone est conservée.
- **Menu** :
  - nouvelle section « Révision » (bientôt disponible) avant Réglages ;
  - menu plus étroit ;
  - « Production 1 → 24 » retiré sous le logo ;
  - tout tient sur un seul écran.
- **Pied de page** en bas de l'écran, aligné sur la carte utilisateur quand la page est courte.
- **Cartes voisines alignées** : les cartes avec en-tête sont désormais de vraies cartes, de même hauteur.
- **Vue d'ensemble** (managers et administrateurs) : chaque carte et chaque section peut être repliée, en gardant son titre et ses indicateurs. Mémorisé sur l'appareil.
- **Détail des échéances** (TVA au 21 et au 24) : affiché à droite, il ne recouvre plus le sélecteur de mois.
- **Curseur goutte** : reste visible sur les listes déroulantes et les cases à cocher. Le curseur texte revient dans les champs de saisie et de date.
## JB Flow — V26.26 : nouveau design
Aucune migration Supabase. Nouveaux fichiers : `design-v2.css`, `design-signature.css`, `design-effects.css`, `ui-v2.js`.
- **Thème Clair** : design V2 sobre. Fond très clair, cartes blanches, bordures fines, un seul accent vert, verre discret sur la navigation.
- **Thème Signature** : univers de la page de connexion, en intensité discrète. Aurore vivante, verre dépoli, liseré lumineux et surbrillance des cartes qui suivent la souris.
- **Thème Nuit** : inchangé.
- **5 effets** (Clair et Signature) :
  - onde verte quand un dossier est terminé ;
  - onglets liquides ;
  - boutons principaux magnétiques (4 px maximum, jamais sur une voisine) ;
  - changement de mois en profondeur ;
  - dossier reçu qui monte à sa nouvelle place.
- **Curseur goutte** (Paramètres › Apparence, thème Signature, souris) : Désactivé (par défaut), Goutte + curseur, ou Goutte seule. 22 px, 30 px sur un élément cliquable, point central gris foncé.
- **Choix de l'ambiance** à la première connexion de chaque utilisateur.
- **Aussi** : squelette de chargement, notifications discrètes en bas au centre, filtres actifs mis en évidence, icônes à la place des emoji, carrousel à profondeur sur iPhone.
## JB Flow — V26.25
- iPhone : plus aucun défilement horizontal parasite. La suggestion d'étalement et « Proposer mon aide » de l'espace collaborateur s'affichent correctement (conflit de style corrigé).

## JB Flow — V26.24
- Les chiffres animés repartent de 0 à chaque arrivée sur un écran, à chaque changement de mois (aller-retour compris) et à chaque changement d'équipe dans le Pilotage.

## JB Flow — V26.23
- Pilotage :
  - Bandeau fin sur toute la largeur : « L'équipe tiendra les échéances ». Au survol, le détail s'affiche : TVA au 21 et au 24, nombre de dossiers et manques éventuels.
  - « Projection TVA » (réservée au manager) : capacité du 1er au 24, reste à faire TVA distingué des autres tâches (demandes d'infos et tableaux de bord), capacité restante en vert, dépassement en rouge.
  - La mention « Période du 1 au 24 » est retirée.

## JB Flow — V26.22
- Menu de gauche : tout tient dans la hauteur de l'écran sur ordinateur, sans défilement (espacements adaptés à la hauteur, textes secondaires masqués sur les petits écrans).
- La phrase du jour s'affiche en caractères droits (plus en italique).

## JB Flow — V26.21
- Espace collaborateur :
  - « Côté clients » devient « Mes clients », avec « À eux de jouer ! » en italique juste dessous.
  - Une phrase du jour s'écrit en direct sous « Bonjour », en italique vert : 20 phrases, une différente chaque jour.
- Menu : Recherche retirée du menu (déjà en haut), et Dossiers passe dans Pilotage / Suivi.

## JB Flow — V26.20
**Mise à jour Supabase** : exécuter une fois `supabase/migration_v1_9.sql`.
- **Fiche client**
  - « Production faite par » et « Tableau de bord fait par » : le collaborateur ou son RC.
  - Un changement réattribue les tâches à venir.
- **Congés et absences**
  - Chaque membre les saisit lui-même (Paramètres › Mes congés et absences), à titre informatif et sans validation.
  - Les dossiers prévus ces jours-là sont replacés automatiquement.
- **Pilotage** : filtre par équipe pour un manager de plusieurs équipes, ou « Tout le cabinet » pour l'administrateur.
- **Tableaux de bord clients**
  - Quand l'échéance tombe après le 24, ils sont placés en priorité après le 24.
  - S'il n'y a aucun jour ouvré avant l'échéance (week-end), ils sont placés le plus tard possible avant celle-ci.
- **Clôture d'un dossier** : une case « Tableau de bord fait en même temps » le note fait et le retire du planning.
## JB Flow — V26.19 : équipes, échéances 21/24, tableaux de bord clients, chiffrement
**Mise à jour Supabase obligatoire** : exécuter une fois `supabase/migration_v1_8.sql`.
- **Rôles**
  - Administrateur : tout le cabinet.
  - Manager : tout le planning de ses équipes, plus la partie Pilotage.
  - Membre : son espace et celui de son binôme.
- **Fiche collaborateur**
  - Fonction : collaborateur comptable ou responsable client (RC).
  - Équipe.
  - Binôme : le RC du collaborateur. Un RC sans collaborateur est un « RC hybride ».
- **Binôme** : le RC voit et agit sur le planning de son collaborateur, et inversement. Chacun peut reprendre un dossier à son nom, par exemple un RC qui produit lui-même.
- **Paramètres › Équipes** : nom de l'équipe, manager, membres.
- **Pilotage**
  - Le menu Pilotage passe avant Production pour les managers.
  - Grand bandeau « L'équipe tient le 21 et le 24 » : TVA au 21 et TVA au 24, capacité cumulée jusqu'à chaque échéance. Le jour 21 est réglable.
- **Week-ends et jours fériés**
  - Samedi et dimanche retirés de l'outil : semaine du lundi au vendredi, mois sur 5 colonnes, capacité nulle.
  - Une date prévue qui tombe un week-end ou un jour férié passe au jour ouvré suivant.
- **Tableaux de bord clients**
  - Dans la fiche client : mensuel ou trimestriel, jour convenu du mois M+1 (25 par défaut), temps.
  - Ils sont planifiés automatiquement.
  - Nouvel écran Production › Tableaux de bord clients : à faire, fait, publié.
- **Chiffrement**
  - Le nom et les particularités des clients sont chiffrés dans le navigateur (AES-256, phrase secrète du cabinet saisie une fois par appareil).
  - La base Supabase ne contient plus aucun nom de client lisible, et l'historique non plus.
## JB Flow — V26.18
- config.js : l'adresse Supabase est corrigée automatiquement (« https:xxx », sans https, lien du tableau de bord, /rest/v1). Une clé vide ou incomplète affiche un message clair au lieu d'une erreur technique.

## JB Flow — V26.17 : espace collaborateur
Un outil qui aide chaque collaborateur à organiser et étaler sa charge, et non un écran de contrôle. Aucune migration Supabase.

- **Accueil « Mon espace »**
  - Ma semaine : charge de chaque jour, avec la part prévisionnelle hachurée, et navigation vers la semaine suivante.
  - Ma journée.
  - « À venir » : dépôts dans les 7 jours, dossiers à reprendre, éléments attendus, mois prochain.
  - « Côté clients » : éléments en retard, avec les boutons Relancer, Reçu et Partiel.
- **Suggestion d'étalement** : quand un jour dépasse la capacité, l'app propose de déplacer un dossier vers un jour plus léger. Le collaborateur choisit « Déplacer » ou « Laisser ».
- **« Proposer mon aide »** : le collaborateur signale un jour où il a de la marge. Le manager le voit dans le tableau de bord, avec un dossier suggéré à confier en un clic.
- **Vocabulaire bienveillant**
  - « À reprendre » au lieu de « Retard ».
  - « Éléments attendus vers le… · rien à faire pour l'instant ».
  - Le rouge est réservé aux échéances fiscales à 3 jours ou moins.
- **Message à la clôture d'une tâche** : « Tes temps me servent à ajuster ton planning et harmoniser ta charge de travail. »
- **Réservé au manager** : tableau de bord, vue Équipe, export et sauvegarde. Le collaborateur ne voit que son propre planning.
- **Historique du collaborateur** : uniquement ses propres dossiers, sans le nom des autres personnes.
## JB Flow — V26.16 : planning prospectif et agent de planification
**Mise à jour Supabase obligatoire** : exécutez une fois `supabase/migration_v1_7.sql` (SQL Editor → New query → coller → Run). Tant que ce n'est pas fait, l'application fonctionne comme avant et un message l'indique à l'administrateur.

- **Période du 1er au 24.** Elle est appliquée automatiquement une seule fois et reste modifiable dans Paramètres.
- **Planning prospectif**
  - Le mois suivant est créé et planifié automatiquement à partir des dates de réception prévues.
  - Tant que les éléments d'un dossier ne sont pas reçus, il reste « Prévu ». Il n'est jamais placé avant demain.
  - Le tableau de bord affiche une section « Prévision du mois prochain » : charge prévue par collaborateur et dossiers à réception incertaine.
- **Dossier reçu prioritaire** : dès la réception, le dossier passe devant les dossiers seulement attendus, en respectant les échéances. Les dossiers non reçus sont décalés.
- **Zone figée**
  - Aujourd'hui et le jour ouvré suivant (réglable de 0 à 5 jours) ne sont pas bousculés pour les dossiers reçus.
  - Une replanification avec « Forcer » ignore la zone figée.
- **Réception partielle** (bouton « Partiel »)
  - On saisit le temps estimé de la partie reçue : elle est planifiée tout de suite.
  - Le reste est placé après la réception complète.
- **Agent de planification**
  - Il apprend des mois précédents : habitude de réception de chaque dossier (décalage en jours), régularité (régulier, variable, imprévisible) et temps réels.
  - **Dates de réception** : il les ajuste automatiquement pour les dossiers non reçus. Chaque ajustement est notifié et consigné dans le tableau de bord et dans l'historique.
  - **Temps de production** : il en propose, que l'administrateur valide ou ignore.
  - **Informations réservées à l'administrateur** : précision mesurée, rythme des collaborateurs et propositions de répartition. Les collaborateurs ne les voient pas.
- **Import de l'historique** (Paramètres › Historique pour l'agent) : le modèle Excel est pré-rempli avec vos dossiers sur les 12 derniers mois. Il suffit de compléter la date de réception réelle et le temps réel.
- Fichier `transitions.html` retiré.
## JB Flow — V26.15
- Transition de connexion « Accueil personnalisé » à la place du rideau.
  - « Bonjour Prénom » s'écrit en dégradé, avec la date du jour.
  - L'anneau autour du logo se remplit pendant le chargement des données.
  - L'écran s'efface ensuite sur l'application.
- Durée d'environ 1,4 s.
- Seules l'opacité et des déplacements simples sont animés, pour rester fluide sur PC et iPhone.
- Des minuteries garantissent que l'écran ne reste jamais bloqué, même si l'onglet passe en arrière-plan.
- Avec les animations « Réduites », c'est le même écran en simple fondu.

## JB Flow — V26.14
- Transition de connexion quand les animations sont sur « Réduites » : « Fondu lumineux », sans aucun mouvement. Le trait vert s'allume au centre, puis l'écran de connexion se fond dans l'application (environ 0,4 s).

## JB Flow — V26.13
- Transition de connexion « Rideau lumineux » : un trait vert coupe l'écran, les deux moitiés s'écartent et dévoilent l'application (environ 0,75 s). L'application se charge pendant ce temps. Elle est désactivée si Réglages › Apparence › Animations est sur « Réduites ».
- Petite vibration à la connexion : sur Android, et sur iPhone à partir d'iOS 18.
- Dernier e-mail utilisé retenu sur chaque appareil, dans le navigateur, sans rien envoyer à un serveur. Il est prérempli et le curseur va directement sur le mot de passe.
- `transitions.html` : page d'aperçu des 7 transitions proposées. Elle est facultative et peut être supprimée.

## JB Flow — V26.12
- Nouveau logo officiel JB Flow sur la page de connexion (64 px, apparition animée), dans le menu, en icône d'onglet et en icône iPhone (écran d'accueil).
- Effet pixels 3D supprimé du bouton « Se connecter » (l'effet magnétique est conservé).
- Interrupteur « Rester connecté » corrigé (le texte chevauchait le bouton) et passé en dégradé vert-jaune.

## JB Flow — V26.11
- Écran de connexion : le formulaire e-mail / mot de passe est utilisé partout, même en démonstration. Les profils de démo sont proposés en pastilles et le mot de passe y est libre. Les textes deviennent « Bienvenue ! » et « Travaillez en toute sérénité. ».
- La pastille « Prochaine période » est supprimée.
- Le nom « JB Flow » reçoit le même dégradé animé que « en flux continu. ».
- Bouton magnétique renforcé : attraction plus forte (jusqu'à 30 px), zone plus large, léger agrandissement et halo. Les pixels 3D sont plus nombreux, plus lumineux et durent plus longtemps.
- Liseré lumineux de la carte : plus épais, plus lumineux, et il tourne lentement autour de la carte.
- Les animations sont actives par défaut, même si Windows demande de les réduire. On peut revenir à « Selon l'appareil » ou « Réduites » dans Réglages › Apparence.
## JB Flow — V26.10
L'application s'appelle désormais **JB Flow**. Le numéro de version (bas de page, `config.js` › `APP_VERSION`)
augmente de 1 à chaque modification demandée : V26.08 (renommage), V26.09 (aperçu de l'accueil), V26.10 (accueil intégré).
Aucune migration de base n'est nécessaire depuis la V1.6 : remplacez simplement le dossier `app/`.

- **Nouvelle page de connexion** : fond vivant, verre dépoli, logo « JB » qui se dessine, accroche « Le pilotage de la
  production comptable, en flux continu. en équipe. sans retard. », pastilles et cartes flottantes que la souris peut pousser,
  bouton magnétique à pixels 3D, compte à rebours de la période (« J-6 avant le 24 »), transition fluide vers l'application.
  Écrans « Nouveau mot de passe » et « Accès non autorisé » au même design. « Rester connecté » décoché : la session
  s'arrête à la fermeture du navigateur.
- **Paramètres › Apparence** (tous les utilisateurs) : thème et **Animations** (selon l'appareil / toujours actives / réduites).

## Mise à jour vers la V1.6
1. **Base déjà installée** : exécutez, dans l'ordre et si ce n'est pas déjà fait, `migration_v1_2.sql`, `migration_v1_3.sql`,
   `migration_v1_4.sql` puis `migration_v1_6.sql` (régime de TVA, DEB/DES, suivi des dépôts, temps réel). Rien n'est effacé.
2. Remplacez le contenu du dossier `app/` sur l'hébergement.

Nouveautés :
- **Régime de TVA par dossier** : CA3 mensuelle (par défaut), CA3 trimestrielle, CA12 annuelle, pas de TVA ; cases **DEB** et **DES**.
  Échéances : CA3 au jour d'échéance du dossier ; CA12 en mai (2e jour ouvré après le 1er mai), acomptes en juillet et
  décembre ; DEB le 10e jour ouvré ; DES le 10. La production du mois est planifiée avant la plus proche.
  Colonnes Excel « Régime TVA », « DEB », « DES » (oui / non).
- **Alerte à J-3** (réglable) pour chaque déclaration non déposée, puis alerte d'échéance dépassée.
- **Suivi des dépôts** : « Validée sur jedeclare.com » ou « Faite sur impots.gouv », possible une fois la production terminée.
- **Temps réel** saisi à chaque « Terminer » ; synthèse administrateur (écarts par collaborateur, temps à ajuster par dossier).
- Mention discrète en bas de page (version réglable dans `config.js` : `APP_VERSION`).

## Mise à jour vers la V1.5
1. **Base déjà installée** : exécutez, dans l'ordre et si ce n'est pas déjà fait, `migration_v1_2.sql`, `migration_v1_3.sql`
   puis `migration_v1_4.sql` (nouvelle version : table des modèles de relance personnels). Rien n'est effacé.
2. Remplacez le contenu du dossier `app/` sur l'hébergement.

Changements :
- **Relance simplifiée** : icône lettre sur chaque réception en retard (écrans Réceptions, Aujourd'hui, fiche dossier).
  Elle ouvre le texte de relance à **copier-coller** dans sa messagerie ; l'application n'envoie rien.
  Le mois cité est le mois précédant le mois en cours. Interrupteur **Tutoyer le client** (mémorisé par client).
- **Modèles personnels** : « Enregistrer comme modèle » garde les deux versions (vous / tu) ; chaque utilisateur ne voit que ses modèles.
- L'e-mail client et l'ouverture de la messagerie ont été retirés (colonne Excel « E-mail » ignorée).
- **Bandeau de signature** en bas de chaque écran.

## Mise à jour vers la V1.4
1. **Base déjà installée** : exécutez, dans l'ordre et si ce n'est pas déjà fait, `migration_v1_2.sql`, `migration_v1_3.sql`
   puis `migration_v1_4.sql`. Rien n'est effacé.
2. Remplacez le contenu du dossier `app/` sur l'hébergement.

Nouveautés :
- **Création automatique du mois** : à la première ouverture d'un mois, les dossiers sont créés et planifiés tout seuls
  (désactivable dans Paramètres). Le bouton « Créer les dossiers du mois » reste pour les clients ajoutés en cours de mois.
- **Déclarer une réception depuis la carte du dossier** : bouton « Reçu » ou glissement vers la droite sur une carte prévisionnelle.
- **Vue Équipe en frise** (bouton « Frise ») : les dossiers étalés sur plusieurs jours apparaissent en barres continues.
- **Projection au 24** (tableau de bord) : reste à faire face à la capacité de chacun ; à partir du 15 (réglable), alerte si
  l'équipe ne tiendra pas le 24, avec des **propositions de transfert** de dossiers vers les collaborateurs qui ont de la marge.
- **Thème Nuit** (Signature en sombre), **filtres rapides** du planning (Mes retards, À recevoir, Demandes à faire) et
  **bandeau de progression** sur l'écran Aujourd'hui (J-x avant le 24, % réalisé).

## Mise à jour vers la V1.3
1. **Base déjà installée** : exécutez `supabase/migration_v1_2.sql` (si pas déjà fait) puis `supabase/migration_v1_3.sql`
   (temps unique par dossier repris automatiquement de tenue + lettrage + TVA, demandes d'informations planifiées,
   étalement sur plusieurs jours). Rien n'est effacé.
2. Remplacez le contenu du dossier `app/` sur l'hébergement.

Nouveautés : **un seul temps de production par dossier** (colonne Excel « Temps de production » ; un ancien fichier
avec Tenue / Lettrage / TVA reste accepté et est additionné) ; **demande d'informations « à faire » = 45 min planifiées**
(durée réglable dans Paramètres) ; **dossier plus long qu'une journée étalé sur les jours ouvrés suivants** ;
menu à deux états (rail / ouvert) ; bouton « Créer les dossiers du mois ». Les mois déjà créés avec l'ancien découpage
conservent leurs trois tâches.

## Mise à jour vers la V1.2
1. **Base déjà installée** : Supabase › SQL Editor › collez `supabase/migration_v1_2.sql` › Run (ajoute le suivi
   des demandes d'informations ; n'efface rien). Une nouvelle installation utilise directement `schema.sql`.
2. Remplacez le contenu du dossier `app/` sur l'hébergement (Cloudflare Pages › nouveau déploiement).

Nouveautés : menu en rail d'icônes qui se déplie au survol (bouton punaise pour l'épingler ouvert), thèmes
« Signature » / « Clair », option **Dossier réalisé en une fois** (Paramètres › Planification : Tenue + Lettrage + TVA
planifiées le même jour et affichées en une carte — replanifiez ensuite), **demande d'informations** au client
(déjà faite / à faire / non nécessaire) demandée avant de terminer et suivie dans le tableau de bord.

## Droits (V1)
| | Administrateur | Collaborateur |
|---|---|---|
| Collaborateurs, capacités, absences, dossiers, import, paramètres, utilisateurs | ✅ | lecture |
| Générer le mois, 🔄 Replanifier | ✅ | — |
| Voir son planning / les autres plannings | ✅ | ✅ (autres : si autorisé dans Paramètres) |
| Déclarer des éléments reçus | ✅ | ✅ |
| Déplacer / verrouiller / terminer / modifier la durée d'une tâche | toutes | les siennes |

Les règles de la base (RLS) garantissent : accès réservé aux utilisateurs actifs, données de référence modifiables
par les administrateurs seulement, suppression réservée aux administrateurs, historique non modifiable.
La restriction « un collaborateur ne modifie que ses propres tâches » est appliquée par l'interface (V1).

## Règles de planification
- Période : du 2 au 24 (paramétrable) ; jours travaillés, jours fériés français, absences déduits.
- Un dossier n'est jamais planifié avant la réception de ses éléments (réelle, sinon **prévisionnelle** 📅) ni avant aujourd'hui.
- Ordre Tenue → Lettrage → TVA ; dossiers reçus d'abord, puis échéance TVA la plus proche, priorité, date de réception.
- Une tâche n'est placée que si la capacité restante du jour suffit ; une tâche plus longue qu'une journée est placée seule (alerte 🔴).
- Déclarer une réception replace le dossier reçu et les dossiers prévisionnels, sans toucher aux dossiers déjà reçus.
- 🔄 Replanifier recalcule tout le mois **sauf** tâches 🔒 verrouillées, terminées et celles d'aujourd'hui ; aperçu (déplacées / verrouillées / échéances problématiques) puis *Annuler* ou *Appliquer*.
- Un collaborateur n'est jamais changé automatiquement.

## Tester avant la mise en service
Le mode démo accepte `?today=2026-10-06` dans l'adresse pour simuler une date. Après installation Supabase,
refaites le scénario de test (3 collaborateurs, import de `exemples/dossiers_exemple.csv`, génération, réceptions,
déplacement + verrouillage, replanification, tâches terminées, 2ᵉ utilisateur sur iPhone).

## V26.32
- Agent : explication de chaque prévision (« Prévu le X : … ») dans la fiche, en info-bulle et dans Réceptions.
- Saisonnalité (cabinet dès 5 réceptions d'un même mois, dossier dès 2) appliquée aux dates prévues.
- Effet des relances : chaque texte de relance copié est mémorisé ; délai relance → réception appris ; meilleur jour de relance suggéré.
- Pilotage : section « Dossiers à risque » (score élevé / moyen) et badge « Risque élevé ».
- Nouveaux dossiers (moins de 3 mois de temps réels) : temps de production majoré (Paramètres, 20 % par défaut).
- Import Excel ouvert aux collaborateurs (leurs dossiers uniquement) — exécuter supabase/migration_v1_10.sql.

## V26.34
- Dashboard Clients, bouton « Afficher tous les dossiers », états actifs visibles, curseur noir Signature, Aujourd'hui (tâches du jour en haut), « Ton manager », planning Semaine par défaut, fiche fermée après Terminer, colonnes semaine plus hautes, cartes Production cliquables (manager), Dépôts côté collaborateurs, filtre Terminés.


## V26.35
- Info-bulles sur les filtres, titre des fenêtres fixe et opaque, menu « TVA & autres » (RC / collaborateurs), curseur plus petit sans main + surbrillance colorée, filtres « Tenue terminées », « TVA à faire », « TVA envoyées ».


## V26.36
- Agent : une date de réception prévue n'est jamais avancée avant la date habituelle de dépôt du client.


## V26.37
- TVA & autres : cartes Dépôts cliquables (détail), sections « Dépôts TVA » et « Dépôts Acompte IS » (vide).


## V26.38
- Menu « TVA & autres impôts ». Case « Acomptes IS » sur la fiche dossier (migration_v1_11.sql). Section Dépôts Acompte IS : dossiers concernés, prochaine échéance, module de calcul des 4 acomptes (non enregistré).


## V26.39
- Acomptes IS : date de clôture (fiche dossier), calendrier officiel selon la clôture, acompte 1 = ¼ IS N-2, acompte 2 = 50 % IS N-1 − acompte 1, 3 et 4 = 25 % IS N-1 ; détail du calcul, montants modifiables, alerte rouge si total ≠ IS théorique, enregistrement (chiffré) — migration_v1_12.sql.


## V26.40
- Info-bulles « Verre » (option 1) dans toute l'appli, adaptées aux 3 thèmes.


## V26.41
- Aucune info-bulle sur le menu latéral.


## V26.42
- Propositions d'aide : badge et message au manager, filtrage par équipe, retour au collaborateur (dossier confié / aucun besoin).


## V26.43
- « Proposer mon aide » à partir du 3e mois après la 1re connexion du collaborateur / RC. Barre du bas mobile (Signature) en vert uni.


## V26.44 — suite de l'audit de l'IA apprenante
- M1 Saisonnalité corrigée : retard saisonnier retenu seulement s'il revient chaque année et dépasse la variabilité du dossier (plus de faux positifs).
- M2 Surcharges prévues (3 mois) : le planificateur est rejoué avec les dates et temps appris ; section « Surcharges prévues » (Pilotage), alerte sur la page Aujourd'hui du collaborateur, prise en compte dans le score de risque.
- M3 L'agent tourne à la connexion de chaque utilisateur (collaborateur : ses dossiers).
- M4 Précision de l'agent semaine par semaine, alerte de dégradation.
- M5 Page « Indicateurs » (Pilotage) : 9 KPI avec cibles et règles d'action.
- M6 Rappel de saisie du temps réel.
- M7 Tests automatiques : app/tests/moteur.html.
- M8 Suivi des migrations : migration_v1_13.sql + alerte administrateur.
- M9 Guide de mise en ligne automatique : DEPLOIEMENT.md.
- M10 Règles fiscales (acomptes IS) extraites dans fiscal.js.
- Correctif : le calcul IS n'est plus mis en cache local en clair quand le chiffrement est actif.

## V26.45
- Synthèse hebdomadaire du manager (Pilotage, sans IA générative) : avancement, réceptions en retard, échéances de la semaine, surcharges prévues avec suggestion de répartition, pièces attendues après l'échéance, marges, aide proposée, absences ; bouton Copier ; message à la première connexion de la semaine.
- M9 finalisé : build.js (assemblage + syntaxe + tests, mise en ligne bloquée en cas d'échec), GitHub Actions, guide DEPLOIEMENT.md.
- M10 finalisé : app.js découpé en 14 fichiers thématiques dans src/app (assemblage identique à l'octet près), tests partagés app/tests/suite.js.

## V26.46
- « TVA & autres impôts » visible aussi pour les managers (dossiers de leurs équipes ; administrateur : tout le cabinet).


## V26.47
- Thème Nuit « Aurora » : violet → cyan, verre dépoli, cartes fines, police Geist, logo cyan, phrase du jour, souris et info-bulles aux couleurs du thème (design-aurora.css).


## V26.48
- Ergonomie (tous thèmes) : palette de commandes Ctrl+K, raccourcis clavier (A, P, R, T, D, I, H, N, ?, /), anneau d'avancement du mois (collaborateur et manager), mini-courbes des cartes Production, actions secondaires au survol, chiffres alignés, contour de sélection au clavier.


## V26.49
- « Nouveau dossier » : case à cocher manuellement dans la fiche (jamais par import) ; marge de temps pendant 3 mois à partir de la coche (migration_v1_14.sql).
- Police Geist pour tous les thèmes ; thème « Nuit » renommé « Aurora ».


## V26.50
- Page de connexion : badge « Agent de planification intégré » et 3 cartes explicatives (agent, surcharges vues à l'avance, journée du collaborateur). Ancienne page visible avec ?accueil=ancien.


## V26.51
- Page de connexion : cartes et badge agent animés (flottent et réagissent à la souris comme les pastilles) ; texte « Sa journée, clairement » reformulé.


## V26.52
- Page de connexion : texte des chiffres clés (−25 %, ~3 sem.) en blanc, gras et plus grand.


## V26.53
- Récap TVA (bouton dans TVA & autres impôts) : fenêtre centrée, fond flouté ; dossier, clôture, date limite, statut automatique (Envoyé, Prêt à envoyer, En cours, Planifié, À recevoir), commentaire enregistré automatiquement (migration_v1_15.sql), filtres, export Excel.


## V26.54
- Fenêtre « Terminer » : champ « Commentaire du mois », repris automatiquement dans la colonne Commentaire du Récap TVA (et inversement).


## V26.55
- Aurora éclaircie : cartes, menu, tâches et fenêtres plus lumineuses (verre violet clair). Ancienne version : ?aurora=sombre.


## V26.56
- Aurora : retour à la version d'origine (éclaircissement retiré).
- Thème Clair : relief et effet verre liquide (cartes bombées, reflets, halos liquides animés, boutons brillants) ; couleur d'accent au choix dans Paramètres › Apparence (8 couleurs, design-clair.css).


## V26.57 – V26.58
- Bulles de survol : plus de double bulle ; bandeau du haut transparent (Clair) ; filtres et tri de la liste Dossiers ; Réceptions plus compactes ; bouton « Valider » ; messages lisibles sur téléphone.
- Vue manager sur un collaborateur : titre « Journée de Pierre » (plus « Bonjour, Manon ») avec son anneau d'avancement.
- Surbrillances, survols et ombres à la couleur choisie (plus de vert codé en dur) ; ligne survolée entièrement colorée.


## V26.59
- Titre des bulles, pourcentage de défilement et survol des boutons principaux à la couleur choisie ; page Indicateurs : cartes plus compactes (4 par ligne).


## V26.60
- Thème Clair : souris, logo JB Flow, phrase du jour et barres d'activité à la couleur choisie. Indicateurs : repliables, anneau pour les valeurs en %.


## V26.61
- Anneaux épurés et animés ; chiffres animés dans Indicateurs ; cartes de la vue d'ensemble moins hautes.
- Pilotage réparti en 3 pages : Vue d'ensemble (synthèse, production, surcharges, risques, aide, planification, alertes), Équipe & activité (niveau d'activité, avancement, temps réel, projection TVA, demandes d'infos, équipe), Prévisions & agent (mois suivant, agent de planification).


## V26.62
- Menu « Suivi » (Indicateurs, Historique, Export) séparé du Pilotage ; onglets en haut des pages du Pilotage ; anneaux des indicateurs agrandis.


## V26.63
- Espacements verticaux resserrés (titres de section ~-45 %, points du carrousel masqués sur ordinateur) ; correction de la barre de défilement parasite au milieu des pages.


## V26.64
- Barres de prévision du mois suivant à la couleur du thème ; menu latéral plus compact (Paramètres et Déconnexion visibles) ; filtres des Dossiers intégrés dans l'en-tête du tableau ; barre parasite du menu supprimée.


## V26.65
- Dossiers : un clic sur le libellé d'une colonne ouvre un menu Trier (↑/↓) + Filtrer ; filtre actif affiché dans l'en-tête.


## V26.66
- Dossiers à risque : cadre de survol arrondi, nom du collaborateur décalé du bord.


## V26.67
- Fluidité : liste des Dossiers ~40 % plus rapide avec beaucoup de dossiers (index productions/tâches calculé une fois par affichage). Audit : toutes les pages < 150 ms à 200 dossiers, aucune erreur, aucune tâche longue.


## V26.68
- Logo cliquable : carte « Mon compte » (nom, e-mail, rôle, équipe, raccourcis, déconnexion) avec animation ; menu latéral défilant et carte utilisateur (déconnexion) toujours visible en bas ; migration_v1_13.sql réparée.


## V26.69
- Carte utilisateur / déconnexion : reprend sa place sous Paramètres (menu défilant à la molette).


## V26.70
- Fiche utilisateur : le rôle Manager reste visible (grisé) avec un message si migration_v1_8/v1_9 n'a pas été exécutée.


## V26.73
- Administrateur : « Voir comme un manager » (carte Mon compte sur le logo) — aperçu de l'application avec les écrans et menus d'un manager, bandeau pour revenir à la vue administrateur.

