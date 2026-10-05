/* Configuration de l'application.
 *
 * Renseignez ici l'URL du projet Supabase et sa clé PUBLIQUE
 * (Supabase > Project Settings > API : "Project URL" et clé "anon public" ou "publishable").
 *
 * Ces deux valeurs sont publiques par conception : la sécurité repose sur la connexion
 * obligatoire et sur les règles d'accès (RLS) installées par supabase/schema.sql.
 *
 * ⛔ NE JAMAIS mettre ici la clé "service_role" ou "secret" (l'application refusera de démarrer).
 *
 * Laissez vide pour le MODE DÉMO (données dans le navigateur, pour essai uniquement).
 */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://dhswogpkfrzwanvxlpzr.supabase.co',        // ex. 'https://abcdefghijkl.supabase.co'
  SUPABASE_ANON_KEY: 'sb_publishable_ZTP2jNT4o2C40ObzQ2RU2w_mq233TdB',   // ex. 'sb_publishable_…' ou 'eyJhbGciOi…' (clé anon)
  APP_NAME: 'JB Flow',
  APP_VERSION: 'V26.207'          // version affichée en bas de page : +1 à chaque modification demandée (V26.40 = 40e version)
};
