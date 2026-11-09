// ═══════════════════════════════════════════════════════════════════════════
// RAPPROCHEMENTS PENNYLANE AUTOMATIQUES — achats ET ventes, toutes les 6 h
// ───────────────────────────────────────────────────────────────────────────
// Avant : le rapprochement des ventes (💳 RAPPROCHEMENT CB) ne partait qu'à la fin d'un
// import d'achats réussi. Cet import s'arrête tant que le compte 607100000 n'a pas d'écriture
// dans Pennylane → aucun rapprochement depuis Narbonne (16/10).
//
// Ce fichier, autonome (ne modifie ni Achats.gs ni Rapprochement.gs), lance toutes les 6 h,
// chacun de son côté (l'échec de l'un n'empêche pas l'autre) :
//   1. 🛒 import des achats Pennylane        → pennylaneImporterAchats
//   2. 💳 rapprochement des ventes (remises TPE ↔ tablettes) → rapprochementCB
// Le résultat ou l'erreur de chaque étape est écrit en note (coin A1) de 🛒 ACHATS
// et de 💳 RAPPROCHEMENT CB : survoler la cellule A1 pour voir le dernier passage.
//
// Installation (une seule fois) : Fichiers ➕ → Script « RapprochementAuto », coller,
// enregistrer, choisir rapprochementsAutoInstaller → ▶ Exécuter.
// ═══════════════════════════════════════════════════════════════════════════

const RA_ACHATS = '🛒 ACHATS';
const RA_VENTES = '💳 RAPPROCHEMENT CB';

function rapprochementsAutoInstaller() {
  const deja = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'rapprochementsAuto'; });
  if (!deja) ScriptApp.newTrigger('rapprochementsAuto').timeBased().everyHours(6).create();
  const res = rapprochementsAuto();
  const msg = res.join('\n') + (deja ? '' : '\n\nLancement automatique programmé toutes les 6 h.');
  try { SpreadsheetApp.getUi().alert('Rapprochements Pennylane\n\n' + msg); } catch (e) { console.log(msg); }
}

function rapprochementsAuto() {
  const quand = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'dd/MM/yyyy HH:mm');
  const etape = function (nom, fn) {
    if (typeof fn !== 'function') return '— ' + nom + ' : fonction absente du projet';
    try { const r = fn(true); return '✅ ' + nom + (typeof r === 'string' && r ? ' : ' + r : (typeof r === 'number' ? ' : ' + r + ' ligne(s)' : '')); }
    catch (e) { return '❌ ' + nom + ' : ' + (e && e.message || e); }
  };
  const res = [
    etape('Import des achats', typeof pennylaneImporterAchats === 'function' ? pennylaneImporterAchats : null),
    etape('Rapprochement des ventes CB', typeof rapprochementCB === 'function' ? rapprochementCB : null),
  ];
  try { PropertiesService.getScriptProperties().setProperty('PL_SYNC', String(Date.now())); } catch (e) {}
  const note = 'Dernier passage automatique : ' + quand + '\n' + res.join('\n');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [RA_ACHATS, RA_VENTES].forEach(function (n) { const sh = ss.getSheetByName(n); if (sh) try { sh.getRange(1, 1).setNote(note); } catch (e) {} });
  console.log(note);
  return res;
}
