/* =====================================================================
   JB Flow — règles fiscales (V26.44, extrait d'app.js)
   Acomptes d'impôt sur les sociétés : calendrier selon la date de clôture et montants.
   Module pur (aucun accès aux données ni à l'écran) : testé par tests/moteur.html.
   ===================================================================== */
(function (global) {
  'use strict';
  const fmtEur = n => Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' €';
  const addMonths = (ym, k) => { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + k; const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12 + 1; return yy + '-' + String(mm).padStart(2, '0'); };

  /* Dates des 4 acomptes de l'exercice clos le « close » (AAAA-MM-JJ).
   * Tableau officiel : clôture du 20/02 au 19/05, du 20/05 au 19/08, du 20/08 au 19/11, du 20/11 au 19/02. */
  function isSched(close) {
    const md = close.slice(5), Y = Number(close.slice(0, 4)), d = (y, m) => y + '-' + m + '-15';
    if (md >= '02-20' && md <= '05-19') return [d(Y - 1, '06'), d(Y - 1, '09'), d(Y - 1, '12'), d(Y, '03')];
    if (md >= '05-20' && md <= '08-19') return [d(Y - 1, '09'), d(Y - 1, '12'), d(Y, '03'), d(Y, '06')];
    if (md >= '08-20' && md <= '11-19') return [d(Y - 1, '12'), d(Y, '03'), d(Y, '06'), d(Y, '09')];
    const N = md >= '11-20' ? Y : Y - 1;
    return [d(N, '03'), d(N, '06'), d(N, '09'), d(N, '12')];
  }
  /* Solde : 15 du 4e mois suivant la clôture ; 15 mai pour une clôture au 31 décembre */
  const isSolde = close => close.slice(5) === '12-31' ? (Number(close.slice(0, 4)) + 1) + '-05-15' : addMonths(close.slice(0, 7), 4) + '-15';

  /* Acompte 1 = ¼ IS N-2 ; acompte 2 = 50 % IS N-1 − acompte 1 ; acomptes 3 et 4 = 25 % IS N-1 (IS ramenés à 12 mois).
   * Aucun acompte pour un premier exercice ou si l'IS N-1 est inférieur à 3 000 €. */
  function isCalc(v) {
    if (v.first) return { none: 'Premier exercice : aucun acompte d\'IS n\'est dû. L\'impôt est payé en une fois au solde.', theo: 0 };
    if (v.is1 === '' || v.is1 === undefined || v.is1 === null) return { none: 'Saisissez l\'IS des exercices N-2 et N-1 pour calculer les acomptes.', theo: null };
    const is1 = Math.round((Number(v.is1) || 0) * 12 / (Number(v.m1) || 12)), is2 = Math.round((Number(v.is2) || 0) * 12 / (Number(v.m2) || 12));
    if (is1 < 3000) return { none: 'IS N-1 de ' + fmtEur(is1) + ' (ramené à 12 mois), inférieur à 3 000 € : aucun acompte n\'est dû. L\'impôt est payé au solde.', theo: 0 };
    const half = Math.round(is1 / 2), a1 = Math.round(is2 / 4), a2raw = half - a1, a2 = Math.max(0, a2raw), a3 = Math.round(is1 / 4), a4 = is1 - half - a3;
    return { is1, is2, theo: is1, a2neg: a2raw < 0, rows: [
      [a1, '¼ × IS N-2 : ' + fmtEur(is2) + ' ÷ 4'],
      [a2, '50 % × IS N-1 − acompte n°1 : ' + fmtEur(half) + ' − ' + fmtEur(a1) + (a2raw < 0 ? ' (négatif : ramené à 0)' : '')],
      [a3, '25 % × IS N-1 : ' + fmtEur(is1) + ' ÷ 4'],
      [a4, '25 % × IS N-1 : ' + fmtEur(is1) + ' ÷ 4']] };
  }

  global.JBFiscal = { fmtEur, isSched, isSolde, isCalc };
})(typeof window !== 'undefined' ? window : globalThis);
