# Sources de l'interface JB Flow (V26.45)

`app/app.js` est **assemblé** à partir des fichiers ci-dessous, dans l'ordre de leur numéro.
Ils forment un seul module (ils partagent les mêmes variables) : le premier ouvre le module, le dernier le ferme.

| Fichier | Contenu |
|---|---|
| 01-etat-utilitaires.js | état de l'application, utilitaires, messages, sauvegarde automatique, synchronisation |
| 021-mouvement.js | système de mouvement commun (V26.176) : constantes FAST / MEDIUM / SLOW / EASING, animation des seules données qui changent, fermetures, glisser-déposer, curseur de démonstration — styles dans `app/design-motion.css` |
| 02-rendu-composants.js | rendu général, menu, cartes de tâches |
| 03-infos-relances-depots.js | demandes d'informations, bandeau de période, filtres rapides, frise d'équipe, projection, relances, clôture d'une tâche, dépôts TVA et acomptes IS |
| 04-agent-planification.js | création automatique des mois, agent de planification (apprentissage, explications, précision hebdomadaire) |
| 05-equipes-chiffrement-dashboards.js | équipes et rôles, chiffrement, Dashboard Clients, choix de l'ambiance |
| 06-espace-collaborateur.js | page Aujourd'hui du collaborateur, aide proposée |
| 07-vues-production.js | vues Aujourd'hui, Planning, Équipe, Réceptions, Dossiers, Recherche |
| 071-planning-cockpit.js | V26.186 : onglet Planning « cockpit » — 4 indicateurs, frise horaire de l'équipe (Jour), semaine de l'équipe, filtres, tâches à affecter, cartes de pilotage, « Optimiser le planning » — styles dans `app/design-planning.css` |
| 08-pilotage-synthese.js | Pilotage, surcharges prévues, dossiers à risque, synthèse hebdomadaire, vue Historique |
| 09-indicateurs-historique-parametres.js | Indicateurs (KPI), liste de l'historique, suivi des migrations, Export, Paramètres |
| 10-feuilles.js | fenêtres de détail et formulaires |
| 11-actions-metier.js | actions (réception, déplacement, fin de tâche, génération…) |
| 12-imports-exports.js | import Excel, import de l'historique, exports |
| 13-evenements.js | clics et saisies |
| 14-connexion-demarrage.js | page de connexion, démarrage |

## Assembler

- **Cloudflare Pages** (mise en ligne automatique) : commande de build `node build.js` — assemble, vérifie la syntaxe,
  lance les tests du moteur et **bloque la mise en ligne** si un test échoue.
- **Sur un PC Windows sans Node** : `powershell -ExecutionPolicy Bypass -File build.ps1`, puis ouvrir `app/tests/moteur.html`.
