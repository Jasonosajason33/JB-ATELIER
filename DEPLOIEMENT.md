# JB Flow — mise en ligne automatique (gratuite)

Objectif : chaque nouvelle version est publiée en envoyant les fichiers sur GitHub. Cloudflare assemble l'application,
**lance les tests et refuse la mise en ligne si un test échoue**. Retour arrière en un clic. Coût : 0 €.

Contenu du projet :
- `app/` : le site publié (Cloudflare Pages) ;
- `src/app/` : les sources de l'interface, découpées par thème (`app/app.js` est assemblé à partir d'elles) ;
- `build.js` : assemblage + contrôle de syntaxe + tests (exécuté par Cloudflare et par GitHub) ;
- `build.ps1` : assemblage sur un PC Windows sans Node ;
- `.github/workflows/tests.yml` : tests automatiques à chaque envoi sur GitHub ;
- `supabase/` : schéma et migrations de la base.

## 1. Une seule fois : créer le dépôt GitHub (10 minutes)

1. Créez un compte gratuit sur https://github.com.
2. **New repository** › nom `jb-flow` › **Private** › Create.
3. Sur la page du dépôt vide : **uploading an existing file** › glissez le **contenu** du zip
   (dossiers `app`, `src`, `supabase`, `.github` et les fichiers `build.js`, `build.ps1`, `README.md`, `DEPLOIEMENT.md`, `.gitignore`)
   › **Commit changes**.
   - Astuce : le dossier `.github` est parfois masqué par Windows. Sinon, installez **GitHub Desktop**
     (https://desktop.github.com, gratuit) : *File › Add local repository* sur le dossier décompressé, puis *Publish repository*.
4. Onglet **Actions** : le test « Tests JB Flow » doit apparaître en vert ✓.

## 2. Une seule fois : relier Cloudflare Pages au dépôt

1. Cloudflare › **Workers & Pages** › **Create** › **Pages** › **Connect to Git** › dépôt `jb-flow`, branche `main`.
   (Le projet actuel `jbflow-app` en dépôt manuel ne peut pas être converti : créez-en un nouveau, puis rattachez-y
   votre domaine dans *Custom domains* si vous en avez un, et supprimez l'ancien quand tout fonctionne.)
2. Réglages de construction :
   - Framework preset : **None**
   - Build command : **`node build.js`**
   - Build output directory : **`app`**
3. **Save and Deploy**. Le journal doit se terminer par « ✓ Build réussi ».
4. Dans Supabase › Authentication › URL Configuration, ajoutez la nouvelle adresse du site si elle change.

## 3. À chaque nouvelle version

1. Remplacez les fichiers modifiés sur GitHub (**Add file › Upload files**, ou GitHub Desktop › *Commit* puis *Push*).
2. Cloudflare assemble, teste et publie tout seul en 1 à 2 minutes.
   - Si un test échoue, **rien n'est publié** : l'ancienne version reste en ligne et le journal indique le test en cause.
3. Si la version apporte un fichier `supabase/migration_vX_Y.sql`, exécutez-le dans Supabase › SQL Editor.
   L'application signale à l'administrateur les migrations manquantes (Pilotage et Paramètres).

## Retour arrière

Cloudflare › projet › **Deployments** › version précédente › **Rollback to this deployment**.

## Modifier le code

Ne modifiez pas `app/app.js` directement : modifiez le fichier concerné dans `src/app/` (voir `src/app/LISEZMOI.md`).
Cloudflare réassemble `app/app.js` à chaque mise en ligne. Sur un PC sans Node : `build.ps1`, puis ouvrez
`app/tests/moteur.html` (le bandeau doit être vert).

## Apprentissage de l'IA

L'IA apprenante n'a besoin d'**aucune mise en ligne** pour progresser : elle se recalcule à partir des données
(réceptions déclarées, temps réels) à chaque connexion. Les mises en ligne ne concernent que les évolutions du code.
