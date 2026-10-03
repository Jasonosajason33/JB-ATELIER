/* =====================================================================
   JB Flow — assemblage et contrôle avant mise en ligne (V26.45)
   Commande de build Cloudflare Pages : node build.js   (dossier publié : app)
   1. assemble app/app.js à partir de src/app/*.js (ordre des numéros) ;
   2. vérifie la syntaxe de chaque fichier JavaScript publié ;
   3. lance les tests du moteur (app/tests/suite.js) ;
   → si une étape échoue, le build s'arrête et Cloudflare NE met PAS la version en ligne.
   ===================================================================== */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = __dirname, rel = f => path.join(root, f);
const fail = msg => { console.error('\n✗ ' + msg + '\nMise en ligne bloquée.'); process.exit(1); };

// 1. Assemblage
const dir = rel('src/app');
const parts = fs.readdirSync(dir).filter(f => /^\d+-.+\.js$/.test(f)).sort();
if (!parts.length) fail('Aucun fichier source dans src/app.');
const app = parts.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
fs.writeFileSync(rel('app/app.js'), app);
console.log('Assemblage : ' + parts.length + ' fichiers → app/app.js (' + app.split('\n').length + ' lignes)');

// 2. Syntaxe
for (const f of ['app/app.js', 'app/engine.js', 'app/fiscal.js', 'app/store.js', 'app/ui-v2.js', 'app/config.js']) {
  try { new vm.Script(fs.readFileSync(rel(f), 'utf8'), { filename: f }); } catch (e) { fail('Erreur de syntaxe dans ' + f + ' : ' + e.message); }
}
console.log('Syntaxe : OK');

// 3. Tests du moteur
for (const f of ['app/engine.js', 'app/fiscal.js', 'app/tests/suite.js']) vm.runInThisContext(fs.readFileSync(rel(f), 'utf8'), { filename: f });
const results = globalThis.JBTestSuite(globalThis.PlanEngine, globalThis.JBFiscal);
let failed = 0;
for (const t of results) {
  const ok = t.checks.every(c => c.ok); if (!ok) failed++;
  console.log((ok ? 'OK     ' : 'ÉCHEC  ') + t.name);
  for (const c of t.checks) console.log('         ' + (c.ok ? '✓ ' : '✗ ') + c.label);
}
if (failed) fail(failed + ' test(s) en échec sur ' + results.length + '.');
console.log('\n✓ Build réussi : ' + results.length + ' tests passés. La version peut être mise en ligne.');
