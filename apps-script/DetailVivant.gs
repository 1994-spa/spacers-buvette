// ═══════════════════════════════════════════════════════════════════════════
// 🥤 DÉTAIL BUVETTE vivant : un match figé trop tôt se répare tout seul
// ───────────────────────────────────────────────────────────────────────────
// L'onglet 🥤 DÉTAIL BUVETTE fige chaque match 2 jours après sa date (onglet masqué
// ⚙️ détail buvette archive). Si une tablette est restée hors ligne et envoie ses
// ventes APRÈS ce figeage (B3 et B2 à Cannes le 26/10, B1 à Plessis le 09/11),
// ses ventes manquaient pour toujours.
//
// Ce fichier, autonome (il ne modifie pas Pilotage.gs), vérifie toutes les 10 min :
// pour chaque match figé, une ligne de 🧾 VENTES ou de ⚙️ écocups non remboursés
// a-t-elle été reçue (« Reçu le ») après la date de figeage ? Si oui, les lignes
// figées du match sont retirées de l'archive et pilotageDetailBuvette() recalcule
// le match avec toutes les buvettes, puis le fige à nouveau.
//
// Installation (une seule fois) : coller ce fichier dans le projet Apps Script
// (Fichiers ➕ → Script « DetailVivant »), enregistrer, choisir la fonction
// detailBuvetteVivantInstaller dans la barre du haut et cliquer ▶ Exécuter.
// Elle répare tout de suite les matchs concernés et programme la vérification.
// ═══════════════════════════════════════════════════════════════════════════

const DV_ARCHIVE = '⚙️ détail buvette archive';
const DV_SOURCES = ['🧾 VENTES', '⚙️ écocups non remboursés'];

function detailBuvetteVivantInstaller() {
  const deja = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'detailBuvetteVivant'; });
  if (!deja) ScriptApp.newTrigger('detailBuvetteVivant').timeBased().everyMinutes(10).create();
  const n = detailBuvetteVivant();
  const msg = (n.length ? 'Matchs recalculés : ' + n.join(', ') + '.' : 'Aucun match à recalculer.') +
    (deja ? '' : ' Vérification automatique programmée toutes les 10 min.');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

// Renvoie la liste des matchs dégelés (vide si rien à faire)
function detailBuvetteVivant() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const arch = ss.getSheetByName(DV_ARCHIVE);
  if (!arch || arch.getLastRow() < 2) return [];
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return [];
  try {
    const d = arch.getDataRange().getValues(), rows = d.slice(1);

    // Date de figeage par match : dernière date de la ligne (colonne FIGÉ LE, quel que soit le format de l'archive)
    const figeLe = {};
    rows.forEach(function (r) {
      const m = String(r[1] || ''); if (!m) return;
      let t = 0;
      for (let j = r.length - 1; j > 2; j--) if (r[j] instanceof Date) { t = r[j].getTime(); break; }
      figeLe[m] = Math.max(figeLe[m] || 0, t);
    });

    // Dernière réception par match dans les onglets bruts
    const recu = {};
    DV_SOURCES.forEach(function (nom) {
      const sh = ss.getSheetByName(nom);
      if (!sh || sh.getLastRow() < 2) return;
      const v = sh.getDataRange().getValues(), h = v[0].map(String);
      const cR = h.indexOf('Reçu le'), cM = h.indexOf('ID_MATCH');
      if (cR < 0 || cM < 0) return;
      v.slice(1).forEach(function (r) {
        const m = String(r[cM] || ''); if (!(m in figeLe)) return;
        const t = r[cR] instanceof Date ? r[cR].getTime() : new Date(r[cR]).getTime();
        if (t && !(recu[m] >= t)) recu[m] = t;
      });
    });

    const degeles = Object.keys(figeLe).filter(function (m) { return recu[m] && recu[m] > figeLe[m]; });
    if (!degeles.length) return [];

    // Retirer les lignes figées de ces matchs, puis recalculer (pilotageDetailBuvette les refige aussitôt)
    const garde = rows.filter(function (r) { return degeles.indexOf(String(r[1] || '')) < 0; });
    arch.getRange(2, 1, rows.length, d[0].length).clearContent();
    if (garde.length) arch.getRange(2, 1, garde.length, d[0].length).setValues(garde);
    SpreadsheetApp.flush();
    pilotageDetailBuvette(true);
    console.log('Détail buvette : recalculé (ventes reçues après le figeage) → ' + degeles.join(', '));
    return degeles;
  } finally {
    lock.releaseLock();
  }
}
