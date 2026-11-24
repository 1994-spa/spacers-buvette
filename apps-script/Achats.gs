// ═══════════════════════════════════════════════════════════════════════════
// ACHATS — factures fournisseurs : miroir Pennylane + rapprochement Drive ↔ Pennylane
// ═══════════════════════════════════════════════════════════════════════════
// Ce module recopie les lignes d'écritures du compte d'achats buvette dans 🛒 ACHATS
// (date, libellé, montant HT, lien vers la pièce), sans rien écrire dans Pennylane.
// Propriété du script : PENNYLANE_API_KEY (token Pennylane, droit « Lecture des écritures
// comptables » + « Lecture des comptes comptables »). Import automatique toutes les 6 h.
//
// Double comptage (constat du 23/11/2026) : la même facture arrive deux fois dans 🛒 ACHATS,
// une fois par la source « Facture Drive » (une ligne par compte comptable) et une fois par la
// source « Pennylane » (une ligne pour tout le compte 607100000). Exemple Crouzil FA 00-2026100488 :
// Pennylane 3 169,04 € = Drive 1 725,14 € de bière (607100000) + 1 443,90 € d'écocups (606300000).
// Règles appliquées ici :
//   • la ligne « Facture Drive » est la ligne de référence, la ligne « Pennylane » est marquée ;
//   • AUCUNE ligne comptable n'est supprimée : la ligne doublon reste visible, marquée dans la
//     colonne CONTRÔLE, et le marquage est recalculé (donc réversible) à chaque import ;
//   • les écocups (compte 606300000) sont un parc réutilisable : jamais dans le total boissons ;
//   • une ligne dont la colonne CONTRÔLE contient « hors total » est exclue du total du
//     📊 TABLEAU DE BORD. Pour forcer le maintien d'une ligne, écrire « garder » dans CONTRÔLE :
//     le script ne la marquera plus jamais.
//
// ───────────────────────────────────────────────────────────────────────────
// 24/11/2026 — CORRECTIF APRÈS LA PERTE DE LIGNES DE LA NUIT DU 23 AU 24/11
// ───────────────────────────────────────────────────────────────────────────
// CE QUI EST ÉTABLI. 🛒 ACHATS portait 10 lignes ; 5 ont disparu en silence. Le partage est
// net : les 5 lignes dont la colonne ID PENNYLANE était VIDE ont survécu, les 5 dont elle
// était REMPLIE ont été supprimées — 3 factures « Facture Drive » qui portaient par erreur
// la mention « ⚠️ absente de Pennylane » dans cette colonne, et les 2 écritures Pennylane.
// Le critère de suppression était donc le CONTENU DE LA COLONNE ID PENNYLANE, pas la source.
//
// ATTENTION, BASE DE CE FICHIER. Il est rebasé sur la copie deploye/Achats.gs du dossier de
// travail, dont le filtre porte sur la SOURCE (« r[1] !== 'Pennylane' || … ») et qui aurait
// donc conservé les 3 factures Drive. Cette copie n'est pas la version qui a tourné cette
// nuit-là. Avant de coller ce fichier, lancer achatsEmpreinte() (DiagAchats.gs) et vérifier
// que la version en ligne est bien celle-là ; sinon, appliquer BLOC-correctif-Achats.gs.txt,
// qui ne remplace que les trois fonctions concernées et ne touche à rien d'autre.
//
// Quatre défauts sont corrigés ici. Les deux premiers suppriment des lignes.
//
// 1) LA CONDITION DE SUPPRESSION NE REGARDAIT PAS LA BONNE CHOSE. Décider du sort d'une
//    ligne comptable sur « sa colonne d'identifiant est-elle remplie ? », ou même sur « sa
//    source est-elle Pennylane ? », met à portée du script des lignes qu'il n'a pas écrites.
//    → Une suppression exige maintenant QUATRE conditions à la fois : SOURCE exactement
//      « Pennylane », ET un identifiant Pennylane (chiffres) dans ID PENNYLANE, ET cet
//      identifiant absent de la réponse de l'API, ET l'API a répondu sans erreur avec au
//      moins une écriture. Une ligne « Facture Drive » est donc hors de portée du script
//      QUOI QU'IL Y AIT dans sa colonne d'identifiant — y compris une suite de chiffres.
//
// 2) SUPPRESSION SUR IMPORT VIDE OU EN ÉCHEC. « L'API n'a rien renvoyé » n'était pas
//    distingué de « ces écritures n'existent plus ». Une réponse 200 sans aucune ligne
//    (jeton restreint, ou identifiant de compte mémorisé devenu périmé) suffisait à vider
//    les écritures Pennylane de la période. Les 403 de la soirée du 23/11 rendaient ce
//    chemin très actif.
//    → L'import ne supprime plus RIEN tant qu'il n'a pas obtenu, sans erreur, au moins une
//      ligne. Dans le cas contraire il le dit dans son message et journalise le refus.
//
// 3) RÉÉCRITURE EN BLOC DE L'ONGLET. clearContent() sur toutes les lignes, puis setValues()
//    du bloc reconstruit. Or la ligne fabriquée pour Pennylane avait 10 colonnes alors que
//    🛒 ACHATS en compte 11 depuis le prix moyen pondéré (colonne QUANTITÉ) : setValues()
//    refuse une matrice plus étroite que la plage, et il lève l'erreur APRÈS le
//    clearContent(). Ce défaut n'est pas la cause du 24/11 (il aurait vidé l'onglet entier,
//    les 5 survivantes comprises), mais il est réel et il vidait l'onglet au premier import
//    qui aurait réussi.
//    → Plus aucune réécriture en bloc : modifications des lignes Pennylane une par une,
//      ajouts à la suite, suppressions par deleteRows, tri par Range.sort. Chaque ligne est
//      construite À LA LARGEUR DE L'EN-TÊTE LU, et part d'une copie de la ligne existante :
//      CONTRÔLE, QUANTITÉ et toute colonne future sont conservées telles quelles.
//
// 4) SUPPRESSION SILENCIEUSE. Rien ne tracait ce qui partait.
//    → Toute suppression est journalisée dans l'onglet technique « ⚙️ journal achats »
//      (combien, lesquelles, pourquoi) et rappelée dans le message de retour. Une
//      suppression refusée et un déplacement de mention le sont aussi.
//
// 5) MENTION « absente de Pennylane » DANS LA MAUVAISE COLONNE. achatsCorrigerMention_()
//    la déplace de ID PENNYLANE vers CONTRÔLE au début de chaque import et vide la cellule
//    d'identifiant. La mention ne contient ni « hors total » ni « garder » : aucun total
//    n'en est changé. C'est la colonne ID PENNYLANE qui redevient ce qu'elle doit être,
//    l'index du script et rien d'autre.
//
// 6) FILET DE SÉCURITÉ. Avant toute modification, l'état des lignes est photographié dans la
//    propriété de script ACHATS_SNAP. « achatsRestaurerInstantane() » rend les lignes
//    manquantes sans jamais écraser ni dupliquer une ligne présente.
//
// ═══════════════════════════════════════════════════════════════════════════
const PENNYLANE = {
  BASE: 'https://app.pennylane.com/api/external/v2',
  COMPTES: ['607100000'],          // Achat buvette (le compte 607200000 Achat boutique n'est pas repris)
  INTERVALLE_H: 6,
};
// Rapprochement Drive ↔ Pennylane
const ACHATS_RAP = {
  TOLERANCE: 0.05,                 // écart de montant HT accepté entre les deux sources (quelques centimes)
  JOURS: 31,                       // écart de date accepté quand le n° de pièce ne peut pas être rapproché
  MARQUE: 'hors total',            // mot-clé lu par la formule du 📊 TABLEAU DE BORD
  GARDER: 'garder',                // écrit à la main dans CONTRÔLE : ligne jamais marquée par le script
  ECOCUPS: '606300000',            // parc réutilisable : hors coût matière et hors CA
};
// Garde-fous de l'import (24/11/2026)
const ACHATS_IMPORT = {
  SOURCE_PL: 'Pennylane',          // seule valeur de SOURCE que le script s'autorise à supprimer
  JOURNAL: '⚙️ journal achats',    // onglet technique : trace de toutes les suppressions
  JOURNAL_ENTETE: ['HORODATAGE', 'ACTION', 'NB LIGNES', 'MOTIF', 'DÉTAIL'],
  JOURNAL_MAX: 2000,               // lignes conservées dans le journal
  SNAP: 'ACHATS_SNAP',             // propriété de script : instantané d'avant modification
  SNAP_MAX: 8500,                  // une propriété de script est plafonnée à 9 ko
  ECHEC: 'PL_ECHEC',               // horodatage du dernier échec d'import (repos d'une heure)
  REPOS_MS: 3600000,
};

function plApi_(path, query) {
  const key = PropertiesService.getScriptProperties().getProperty('PENNYLANE_API_KEY');
  if (!key) throw new Error('Clé Pennylane manquante (propriété du script PENNYLANE_API_KEY)');
  const qs = Object.keys(query || {}).filter(function (k) { return query[k] !== undefined && query[k] !== null; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&');
  const r = UrlFetchApp.fetch(PENNYLANE.BASE + path + (qs ? '?' + qs : ''), {
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }, muteHttpExceptions: true });
  const code = r.getResponseCode();
  if (code === 401) throw new Error('Pennylane : clé refusée (401). Régénérer le token et le recopier dans PENNYLANE_API_KEY.');
  if (code === 403) throw new Error('Pennylane : droit manquant (403). Le token doit avoir « Lecture des écritures comptables » et « Lecture des comptes comptables ».');
  if (code >= 300) throw new Error('Pennylane ' + code + ' sur ' + path + ' : ' + String(r.getContentText()).slice(0, 200));
  return JSON.parse(r.getContentText());
}
function plItems_(res) { return res.items || res.data || res.ledger_entry_lines || res.ledger_accounts || []; }

// Identifiant Pennylane d'un compte (ex. 607100000), mémorisé. null si le compte n'existe pas (encore).
function plCompteId_(numero) {
  const p = PropertiesService.getScriptProperties(), k = 'PL_COMPTE_' + numero, memo = p.getProperty(k);
  if (memo) return memo;
  // 09/11/2026 — le filtre exact « number = 607100000 » ne trouvait rien alors que le compte existe :
  // Pennylane peut stocker le numéro court (6071) ou le filtre peut être ignoré. On compare donc les numéros
  // sans les zéros de fin, d'abord via le filtre, puis en parcourant tout le plan de comptes.
  const court = String(numero).replace(/0+$/, '');
  const memeCompte = function (x) { const n = String(x.number || ''); return n === numero || n.replace(/0+$/, '') === court; };
  let a = null;
  try { a = plItems_(plApi_('/ledger_accounts', { filter: JSON.stringify([{ field: 'number', operator: 'eq', value: numero }]), limit: 20 })).filter(memeCompte)[0]; }
  catch (e) { if (!/400/.test(e.message)) throw e; }
  if (!a) try { a = plItems_(plApi_('/ledger_accounts', { filter: JSON.stringify([{ field: 'number', operator: 'eq', value: court }]), limit: 20 })).filter(memeCompte)[0]; }
  catch (e) { if (!/400/.test(e.message)) throw e; }
  let cursor = null, tour = 0;
  while (!a && tour++ < 60) {                       // plan de comptes complet (pagination par curseur)
    const res = plApi_('/ledger_accounts', { limit: 100, cursor: cursor });
    a = plItems_(res).filter(memeCompte)[0] || null;
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  if (!a) return null;
  p.setProperty(k, String(a.id));
  return String(a.id);
}

// Toutes les lignes d'un compte depuis une date (pagination par curseur)
function plLignes_(compteId, depuis) {
  const out = []; let cursor = null, tour = 0, avecDate = true;
  while (tour++ < 50) {
    const filtre = [{ field: 'ledger_account_id', operator: 'eq', value: compteId }];
    if (avecDate) filtre.push({ field: 'date', operator: 'gteq', value: depuis });
    let res;
    try { res = plApi_('/ledger_entry_lines', { filter: JSON.stringify(filtre), limit: 100, cursor: cursor, sort: 'date' }); }
    catch (e) {
      if (avecDate && /400/.test(e.message)) { avecDate = false; cursor = null; out.length = 0; continue; }   // combinaison de filtres refusée : filtre sur la date côté script
      throw e;
    }
    plItems_(res).forEach(function (l) { out.push(l); });
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return avecDate ? out : out.filter(function (l) { return String(l.date || '').slice(0, 10) >= depuis; });
}

// Références de pièce citées par une écriture Pennylane (n° de facture, référence, n° de pièce…)
function plRefsPiece_(l) {
  const e = l.ledger_entry || {};
  return [l.label, l.reference, l.piece_reference, l.invoice_number, l.document_number,
    e.label, e.reference, e.piece_reference, e.invoice_number, e.document_number, e.number]
    .filter(function (x) { return x != null && x !== ''; }).map(String).join(' ');
}

// ═══════════════════════════════════════════════════════════════════════════
// GARDE-FOUS : identifiants, colonnes, journal, instantané
// ═══════════════════════════════════════════════════════════════════════════
// Colonne ID PENNYLANE : le texte de la cellule, les grands identifiants étant stockés en nombre.
function achatsIdTxt_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return '';
  if (typeof v === 'number') return isFinite(v) ? String(Math.round(v)) : '';
  return String(v).trim();
}
// Un identifiant Pennylane n'est QUE des chiffres. Tout autre contenu de la colonne ID PENNYLANE
// (« ⚠️ absente de Pennylane », une note, un n° de pièce) est une saisie humaine : le script ne
// s'en sert ni pour indexer une ligne ni pour la supprimer.
function achatsEstIdPL_(txt) { return /^[0-9]{4,}$/.test(String(txt)); }

// Index des colonnes de 🛒 ACHATS, par nom d'en-tête (position par défaut si l'en-tête a changé)
function achatsIdx_(h) {
  const g = function (n, defaut) { const i = col_(h, n); return i >= 0 ? i : defaut; };
  return {
    date: g('DATE', 0), src: g('SOURCE', 1), lib: g('LIBELLÉ', 2), cpt: g('COMPTE', 3),
    mt: g('MONTANT HT €', 4), sai: g('SAISON', 5), mois: g('MOIS', 6), pc: g('PIÈCE', 7),
    id: g('ID PENNYLANE', 8), ctrl: col_(h, 'CONTRÔLE'), qte: col_(h, 'QUANTITÉ'),
  };
}
// Description courte d'une ligne, pour le journal et les messages
function achatsDecrire_(r, X) {
  return (achatsJour_(r[X.date]) || 'sans date') + ' · ' + String(r[X.src] == null ? '' : r[X.src]) +
    ' · ' + (String(r[X.pc] == null ? '' : r[X.pc]).trim() || String(r[X.lib] == null ? '' : r[X.lib]).trim() || '(sans pièce)').slice(0, 60) +
    ' · ' + achatsNum_(r[X.mt]).toFixed(2).replace('.', ',') + ' €' +
    (achatsIdTxt_(r[X.id]) ? ' · id ' + achatsIdTxt_(r[X.id]) : '');
}

// ── Journal des suppressions (onglet technique masqué) ────────────────────
function achatsJournalFeuille_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ACHATS_IMPORT.JOURNAL);
  if (sh) return sh;
  sh = ss.insertSheet(ACHATS_IMPORT.JOURNAL);
  sh.getRange(1, 1, 1, ACHATS_IMPORT.JOURNAL_ENTETE.length).setValues([ACHATS_IMPORT.JOURNAL_ENTETE]);
  try { styleEntete_(sh.getRange(1, 1, 1, ACHATS_IMPORT.JOURNAL_ENTETE.length)); sh.setFrozenRows(1); } catch (e) {}
  try { sh.setColumnWidth(1, 150); sh.setColumnWidth(4, 380); sh.setColumnWidth(5, 700); } catch (e) {}
  try { sh.hideSheet(); } catch (e) {}
  return sh;
}
// Une suppression silencieuse dans un registre comptable est inacceptable, même quand elle est juste.
function achatsJournaliser_(action, motif, details) {
  const lignes = (details || []).map(String);
  const txt = '🧾 ' + ACHATS_IMPORT.JOURNAL + ' · ' + action + ' · ' + lignes.length + ' ligne(s) · ' + motif +
    (lignes.length ? '\n   • ' + lignes.join('\n   • ') : '');
  Logger.log(txt);
  try {
    const sh = achatsJournalFeuille_();
    sh.appendRow([new Date(), String(action), lignes.length, String(motif), lignes.join(' | ').slice(0, 45000)]);
    const trop = sh.getLastRow() - 1 - ACHATS_IMPORT.JOURNAL_MAX;
    if (trop > 0) sh.deleteRows(2, trop);
  } catch (e) { Logger.log('Journal achats indisponible : ' + e.message); }
  return lignes.length;
}

// ── Instantané avant modification + restauration ──────────────────────────
function achatsCell_(v) { return v instanceof Date ? { __d: jour_(v) } : (v === null || v === undefined ? '' : v); }
function achatsDecell_(v) { return (v && typeof v === 'object' && v.__d) ? new Date(String(v.__d) + 'T12:00:00') : v; }

function achatsInstantanePrendre_(h, d, X) {
  const emballe = function (rows) { return rows.map(function (r) { return r.map(achatsCell_); }); };
  const nonVide = d.filter(function (r) { return r.some(function (v) { return v !== '' && v !== null && v !== undefined; }); });
  let o = { t: new Date().toISOString(), h: h, rows: emballe(nonVide), partiel: false };
  let json = JSON.stringify(o);
  if (json.length > ACHATS_IMPORT.SNAP_MAX) {       // on garde d'abord ce qui n'est pas réimportable : les saisies
    const saisies = nonVide.filter(function (r) { return String(r[X.src] == null ? '' : r[X.src]).trim() !== ACHATS_IMPORT.SOURCE_PL; });
    o = { t: o.t, h: h, rows: emballe(saisies), partiel: true };
    json = JSON.stringify(o);
    while (json.length > ACHATS_IMPORT.SNAP_MAX && o.rows.length > 1) { o.rows.shift(); json = JSON.stringify(o); }
  }
  try { PropertiesService.getScriptProperties().setProperty(ACHATS_IMPORT.SNAP, json); }
  catch (e) { Logger.log('Instantané 🛒 ACHATS non enregistré : ' + e.message); }
  return o;
}
function achatsSignature_(r, X) {
  return [achatsJour_(r[X.date]), String(r[X.src] == null ? '' : r[X.src]).trim(),
    String(r[X.pc] == null ? '' : r[X.pc]).trim(), achatsNum_(r[X.mt]).toFixed(2),
    String(r[X.cpt] == null ? '' : r[X.cpt]).trim().replace(/\.0+$/, ''),
    String(r[X.lib] == null ? '' : r[X.lib]).trim().slice(0, 40)].join('¤');
}
// Menu / éditeur : remet les lignes de l'instantané qui ne sont plus dans l'onglet. N'écrase rien.
function achatsRestaurerInstantane() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONG.ACHATS);
  if (!sh) throw new Error('Onglet 🛒 ACHATS introuvable');
  const json = PropertiesService.getScriptProperties().getProperty(ACHATS_IMPORT.SNAP);
  if (!json) { alerte_('Aucun instantané de 🛒 ACHATS en mémoire : rien à restaurer.'); return 'aucun instantané'; }
  const snap = JSON.parse(json);
  const h = entete_(sh), X = achatsIdx_(h), d = donnees_(sh);
  const presentes = {};
  d.forEach(function (r) { presentes[achatsSignature_(r, X)] = 1; });
  const manquantes = [];
  snap.rows.forEach(function (row) {
    const r = h.map(function (nom, i) {
      const j = snap.h.indexOf(nom);
      return achatsDecell_(j >= 0 ? row[j] : (row[i] === undefined ? '' : row[i]));
    });
    if (!presentes[achatsSignature_(r, X)]) manquantes.push(r);
  });
  if (!manquantes.length) {
    alerte_('✅ Rien à restaurer : les ' + snap.rows.length + ' ligne(s) de l\'instantané du ' + String(snap.t).slice(0, 16).replace('T', ' à ') + ' sont toutes présentes dans 🛒 ACHATS.');
    return 'rien à restaurer';
  }
  sh.getRange(sh.getLastRow() + 1, 1, manquantes.length, h.length).setValues(manquantes);
  achatsJournaliser_('restauration', 'instantané du ' + snap.t + (snap.partiel ? ' (partiel : saisies seules)' : ''),
    manquantes.map(function (r) { return achatsDecrire_(r, X); }));
  achatsTrier_(sh, h, X);
  alerte_('♻️ ' + manquantes.length + ' ligne(s) remise(s) dans 🛒 ACHATS depuis l\'instantané du ' +
    String(snap.t).slice(0, 16).replace('T', ' à ') + ' :\n• ' + manquantes.map(function (r) { return achatsDecrire_(r, X); }).join('\n• ') +
    '\n\nAucune ligne présente n\'a été modifiée. Détail dans l\'onglet ' + ACHATS_IMPORT.JOURNAL + '.');
  return manquantes.length + ' ligne(s) restaurée(s)';
}

// ── Mention saisie dans la mauvaise colonne : ID PENNYLANE → CONTRÔLE ─────
// La colonne ID PENNYLANE est l'index du script. Un texte y privait la ligne de son identifiant
// et la faisait entrer dans l'index du script avec une clé qui n'est pas un identifiant.
function achatsCorrigerMention_(sh) {
  const h = entete_(sh), X = achatsIdx_(h), d = donnees_(sh);
  if (X.ctrl < 0 || X.id < 0) return [];
  const faits = [];
  d.forEach(function (r, k) {
    if (String(r[X.src] == null ? '' : r[X.src]).trim() === ACHATS_IMPORT.SOURCE_PL) return;   // ligne du script : laissée telle quelle
    const txt = achatsIdTxt_(r[X.id]);
    if (!txt || achatsEstIdPL_(txt)) return;
    const ctrl = String(r[X.ctrl] == null ? '' : r[X.ctrl]).trim();
    const fusion = !ctrl ? txt : (ctrl.indexOf(txt) >= 0 ? ctrl : ctrl + ' · ' + txt);
    sh.getRange(k + 2, X.ctrl + 1).setValue(fusion);
    sh.getRange(k + 2, X.id + 1).clearContent();
    faits.push('ligne ' + (k + 2) + ' · ' + achatsDecrire_(r, X) + ' → « ' + txt + ' » déplacé dans CONTRÔLE');
  });
  if (faits.length) achatsJournaliser_('mention déplacée', 'texte saisi dans ID PENNYLANE (colonne réservée au script) remis dans CONTRÔLE', faits);
  return faits;
}
// Menu / éditeur : la correction seule, sans import
function achatsCorrigerMentions() {
  assurerStructure_();
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONG.ACHATS);
  if (!sh) throw new Error('Onglet 🛒 ACHATS introuvable');
  const faits = achatsCorrigerMention_(sh);
  alerte_(faits.length
    ? '✅ ' + faits.length + ' mention(s) déplacée(s) de la colonne ID PENNYLANE vers CONTRÔLE :\n• ' + faits.join('\n• ')
    : '✅ Rien à corriger : la colonne ID PENNYLANE ne contient que des identifiants Pennylane.');
  return faits.length;
}

// ── Tri de l'onglet (du plus récent au plus ancien), sans réécrire les lignes ──
function achatsTrier_(sh, h, X) {
  const n = sh.getLastRow() - 1;
  if (n < 2) return;
  try { sh.getRange(2, 1, n, h.length).sort({ column: X.date + 1, ascending: false }); }
  catch (e) { Logger.log('Tri de 🛒 ACHATS : ' + e.message); }
}

// ── Menu + automatique : importe les achats buvette depuis le début de la saison précédente ──
function pennylaneImporterAchats(silencieux) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONG.ACHATS);
  if (!sh) throw new Error('Onglet 🛒 ACHATS introuvable (lancer la réorganisation)');
  assurerStructure_();
  const sa = donnees_(feuille_('SAISONS')).filter(function (r) { return r[2] instanceof Date; }).sort(function (a, b) { return a[2] - b[2]; });
  const enCours = sa.filter(function (r) { return String(r[7]) === 'EN COURS'; })[0];
  const i = enCours ? sa.indexOf(enCours) : sa.length - 1;
  const depuis = sa.length ? jour_(sa[Math.max(0, i - 1)][2]) : '2025-08-01';

  // 1. mention saisie dans la colonne d'identifiant : remise dans CONTRÔLE avant toute lecture
  const mentions = achatsCorrigerMention_(sh);

  const h = entete_(sh), X = achatsIdx_(h), d = donnees_(sh);
  if (X.id < 0) throw new Error('Colonne ID PENNYLANE absente de 🛒 ACHATS : lancer 🏐 Matchday → 🔎 Vérifier le fichier');
  // 2. filet : instantané des lignes avant toute modification
  achatsInstantanePrendre_(h, d, X);

  // Index du script : SEULS les identifiants Pennylane y entrent. Un texte saisi dans la colonne
  // ID PENNYLANE ne peut donc plus faire pointer l'index sur une ligne saisie à la main.
  const parId = {};
  d.forEach(function (r, k) { const t = achatsIdTxt_(r[X.id]); if (achatsEstIdPL_(t)) parId[t] = k; });

  const vus = {}, absents = [], echecs = [];
  const majs = [], ajouts = [];
  let nbApi = 0;
  PENNYLANE.COMPTES.forEach(function (num) {
    let idCompte = null;
    try { idCompte = plCompteId_(num); }
    catch (e) { echecs.push('compte ' + num + ' : ' + e.message); return; }
    if (!idCompte) { absents.push(num); return; }
    let lignes = null;
    try { lignes = plLignes_(idCompte, depuis); }
    catch (e) { echecs.push('écritures du compte ' + num + ' : ' + e.message); return; }
    nbApi += lignes.length;
    lignes.forEach(function (l) {
      const id = achatsIdTxt_(l.id), date = String(l.date || (l.ledger_entry && l.ledger_entry.date) || '').slice(0, 10);
      if (!id) return;                               // une écriture sans identifiant n'est pas indexable : ignorée
      const montant = Math.round(((Number(l.debit) || 0) - (Number(l.credit) || 0)) * 100) / 100;
      const piece = l.ledger_entry ? (l.ledger_entry.url || ('écriture ' + l.ledger_entry.id)) : '';
      const k = parId[id] != null ? parId[id] : -1;
      // Ligne construite à la LARGEUR DE L'EN-TÊTE, sur la base de la ligne existante : les colonnes
      // que l'import ne possède pas (CONTRÔLE, QUANTITÉ, toute colonne ajoutée) sont conservées
      // telles quelles. C'est ce qui rendait la réécriture en bloc impossible le 23/11.
      const base = k >= 0 ? d[k] : null;
      const ligne = [];
      for (let c = 0; c < h.length; c++) ligne.push(base && base[c] !== undefined && base[c] !== null ? base[c] : '');
      ligne[X.date] = date ? new Date(date + 'T12:00:00') : '';
      ligne[X.src] = ACHATS_IMPORT.SOURCE_PL;
      ligne[X.lib] = String(l.label || (l.ledger_entry && l.ledger_entry.label) || '');
      ligne[X.cpt] = num;
      ligne[X.mt] = montant;
      ligne[X.sai] = saisonDe_(date);
      ligne[X.mois] = date.slice(0, 7);
      ligne[X.pc] = piece;
      ligne[X.id] = id;
      // Références de pièce : gardées en mémoire pour le rapprochement (pas écrites dans l'onglet)
      vus[id] = plRefsPiece_(l) || ' ';   // jamais vide : la valeur sert aussi de « vue dans Pennylane »
      if (k >= 0) majs.push({ k: k, ligne: ligne }); else ajouts.push(ligne);
    });
  });

  // 3. l'API a-t-elle VRAIMENT répondu ? « rien renvoyé » n'est pas « plus rien dans Pennylane ».
  const aRepondu = !echecs.length && nbApi > 0;

  if (absents.length === PENNYLANE.COMPTES.length && !echecs.length) {
    const m = '⏳ Pennylane connecté, mais le compte ' + absents.join(', ') + ' n\'existe pas encore. Rien à importer, rien supprimé : l\'import démarrera tout seul dès qu\'il sera créé et utilisé.';
    if (silencieux !== true) alerte_(m);
    return m;
  }

  // 4. candidats à la suppression : UNIQUEMENT des lignes écrites par le script.
  //    Une ligne « Facture Drive » ou une saisie libre n'est jamais candidate.
  const aRetirer = [];
  d.forEach(function (r, k) {
    if (String(r[X.src] == null ? '' : r[X.src]).trim() !== ACHATS_IMPORT.SOURCE_PL) return;   // saisie à la main
    const t = achatsIdTxt_(r[X.id]);
    if (!achatsEstIdPL_(t)) return;                              // ligne « Pennylane » sans identifiant : saisie, pas du script
    if (vus[t]) return;                                          // toujours dans Pennylane
    const j = achatsJour_(r[X.date]);
    if (j && j < depuis) return;                                 // hors période interrogée
    if (X.ctrl >= 0 && new RegExp('^' + ACHATS_RAP.GARDER, 'i').test(String(r[X.ctrl] == null ? '' : r[X.ctrl]).trim())) return;  // « garder » forcé à la main
    aRetirer.push({ k: k, txt: achatsDecrire_(r, X) });
  });

  // 5. écritures : modifications sur place, ajouts à la suite, suppressions seulement si l'API a répondu
  majs.forEach(function (m) { sh.getRange(m.k + 2, 1, 1, h.length).setValues([m.ligne]); });
  if (ajouts.length) sh.getRange(sh.getLastRow() + 1, 1, ajouts.length, h.length).setValues(ajouts);

  let retires = 0, bloque = '';
  if (aRetirer.length && !aRepondu) {
    bloque = '\n⛔ ' + aRetirer.length + ' ligne(s) Pennylane non renvoyée(s) par l\'API : AUCUNE suppression. ' +
      (echecs.length ? 'L\'API a échoué (' + echecs.join(' ; ') + ').' : 'L\'API a répondu sans aucune écriture : on ne peut pas en conclure que ces écritures ont disparu de Pennylane.') +
      '\n   Lignes conservées :\n   • ' + aRetirer.map(function (x) { return x.txt; }).join('\n   • ');
    achatsJournaliser_('suppression refusée', echecs.length ? 'import en échec : ' + echecs.join(' ; ') : 'import vide (aucune écriture renvoyée par l\'API)',
      aRetirer.map(function (x) { return x.txt; }));
  } else if (aRetirer.length) {
    achatsJournaliser_('suppression', 'écriture(s) absente(s) de la réponse Pennylane du compte ' + PENNYLANE.COMPTES.join(', ') +
      ' depuis le ' + depuis + ' (' + nbApi + ' écriture(s) renvoyée(s)) : supprimée(s) dans Pennylane',
      aRetirer.map(function (x) { return x.txt; }));
    const rows = aRetirer.map(function (x) { return x.k + 2; }).sort(function (a, b) { return b - a; });
    let bloc = [rows[0]];
    for (let n = 1; n <= rows.length; n++) {
      if (n < rows.length && rows[n] === bloc[bloc.length - 1] - 1) { bloc.push(rows[n]); continue; }
      sh.deleteRows(bloc[bloc.length - 1], bloc.length);
      retires += bloc.length;
      if (n < rows.length) bloc = [rows[n]];
    }
  }

  achatsTrier_(sh, h, X);
  PropertiesService.getScriptProperties().setProperty('PL_SYNC', String(Date.now()));
  // Rapprochement Drive ↔ Pennylane : relancé à chaque import, donc idempotent
  let rap = '';
  try { rap = '\n' + achatsRapprocher_(vus).resume; } catch (e) { rap = '\n⚠️ Rapprochement Drive ↔ Pennylane : ' + e.message; }
  try { if (typeof rapprochementCB === 'function') rapprochementCB(true); } catch (e) { Logger.log('Rapprochement CB : ' + e.message); }

  const msg = '🧾 Achats Pennylane (compte ' + PENNYLANE.COMPTES.join(', ') + ' depuis le ' + depuis + ') : ' +
    ajouts.length + ' ajoutée(s), ' + majs.length + ' mise(s) à jour' + (retires ? ', ' + retires + ' retirée(s) (journalisée(s) dans ' + ACHATS_IMPORT.JOURNAL + ')' : ', 0 retirée') + '.' +
    (mentions.length ? '\n✏️ ' + mentions.length + ' mention(s) déplacée(s) de ID PENNYLANE vers CONTRÔLE.' : '') +
    (echecs.length ? '\n⚠️ Pennylane : ' + echecs.join(' ; ') : '') +
    (!echecs.length && !nbApi ? '\n⚠️ Pennylane a répondu sans aucune écriture : rien supprimé.' : '') +
    (absents.length ? '\n⏳ Compte(s) absent(s) de Pennylane : ' + absents.join(', ') + '.' : '') +
    bloque + rap;
  if (silencieux !== true) alerte_(msg);
  // Appel automatique : on remonte l'échec pour que pennylaneImportAuto_ l'enregistre et laisse
  // souffler l'API une heure. Appel depuis le menu : le message suffit, pas de boîte d'erreur.
  if (echecs.length && silencieux === true) throw new Error(msg);
  return msg;
}

// Appelé par le traitement automatique (toutes les 10 min) : import au plus toutes les 6 h,
// rapprochement au plus toutes les 30 min (il répare le marquage si un autre import l'a effacé).
// Un import en échec ne doit pas être réessayé toutes les 10 min : une heure de repos.
function pennylaneImportAuto_() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('PENNYLANE_API_KEY')) return;
  const repos = Date.now() - (Number(p.getProperty(ACHATS_IMPORT.ECHEC)) || 0) < ACHATS_IMPORT.REPOS_MS;
  if (!repos && Date.now() - (Number(p.getProperty('PL_SYNC')) || 0) >= PENNYLANE.INTERVALLE_H * 3600000) {
    try { pennylaneImporterAchats(true); p.deleteProperty(ACHATS_IMPORT.ECHEC); return; }
    catch (e) { p.setProperty(ACHATS_IMPORT.ECHEC, String(Date.now())); Logger.log(e.message); }
  }
  if (Date.now() - (Number(p.getProperty('PL_RAP')) || 0) < 1800000) return;
  try { achatsRapprocher_(null); } catch (e) { Logger.log('Rapprochement achats : ' + e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════
// RAPPROCHEMENT DRIVE ↔ PENNYLANE
// ═══════════════════════════════════════════════════════════════════════════
// Clés de pièce d'un texte : « FA 00-2026100488 » → FA002026100488 et 002026100488 ;
// « FC26018124 » → FC26018124 et 26018124. Les suites de moins de 6 chiffres sont ignorées
// (un numéro de match ou un jour/mois ne doit jamais servir de clé).
function achatsClesPiece_(txt) {
  const t = String(txt == null ? '' : txt).toUpperCase().replace(/[’‘´`]/g, "'");
  const out = {}, re = /([A-Z]{0,3})[\s\-_\/.:]*((?:\d[\s\-_\/.:]*){6,})/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const chiffres = m[2].replace(/\D/g, '');
    if (chiffres.length < 6) continue;
    if (m[1]) out[m[1] + chiffres] = 1;
    out[chiffres] = 1;                       // même facture citée sans son préfixe de journal
  }
  return Object.keys(out);
}
function achatsNum_(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function achatsJour_(v) { try { return jour_(v) || ''; } catch (e) { return ''; } }
function achatsEcartJours_(a, b) {
  if (!a || !b) return 9999;
  const da = new Date(a + 'T12:00:00'), db = new Date(b + 'T12:00:00');
  return Math.abs(Math.round((da - db) / 86400000));
}

// Marque les lignes « Pennylane » qui redoublent une facture déjà présente en « Facture Drive ».
// refsPL : { id Pennylane → texte des références de pièce } remonté par l'import (facultatif).
// Aucune suppression, aucune saisie : seule la colonne CONTRÔLE des lignes Pennylane est écrite.
function achatsRapprocher_(refsPL) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONG.ACHATS);
  if (!sh) throw new Error('Onglet 🛒 ACHATS introuvable');
  const h = entete_(sh), d = donnees_(sh);
  const iDate = h.indexOf('DATE'), iSrc = h.indexOf('SOURCE'), iLib = h.indexOf('LIBELLÉ'),
    iCpt = h.indexOf('COMPTE'), iMt = h.indexOf('MONTANT HT €'), iPc = h.indexOf('PIÈCE'),
    iId = h.indexOf('ID PENNYLANE'), iCtrl = h.indexOf('CONTRÔLE');
  if (iCtrl < 0) throw new Error('Colonne CONTRÔLE absente de 🛒 ACHATS : lancer 🏐 Matchday → 🔎 Vérifier le fichier');

  // Lignes de référence : tout ce qui ne vient pas de Pennylane (« Facture Drive », saisies).
  // Regroupées par clé de pièce : une facture = une ou plusieurs lignes (une par compte comptable).
  const groupes = {};
  d.forEach(function (r, k) {
    if (String(r[iSrc] || '') === 'Pennylane') return;
    const mt = achatsNum_(r[iMt]);
    if (!mt) return;
    const cles = achatsClesPiece_(String(r[iPc] || '') + ' ' + String(r[iLib] || ''));
    const nom = String(r[iPc] || '').trim() || String(r[iLib] || '').trim() || 'facture du ' + achatsJour_(r[iDate]);
    const cle = cles.length ? cles.sort(function (a, b) { return b.length - a.length; })[0] : 'SANSCLE#' + k;
    const g = groupes[cle] = groupes[cle] || { cle: cle, nom: nom, cles: {}, total: 0, dates: [], comptes: {}, lignes: 0 };
    cles.forEach(function (c) { g.cles[c] = 1; });
    g.total = achatsNum_(g.total + mt);
    g.dates.push(achatsJour_(r[iDate]));
    g.comptes[String(r[iCpt] || '').trim()] = achatsNum_((g.comptes[String(r[iCpt] || '').trim()] || 0) + mt);
    g.lignes++;
    if (!g.nom && nom) g.nom = nom;
  });
  const parCle = {};
  Object.keys(groupes).forEach(function (k) { Object.keys(groupes[k].cles).forEach(function (c) { (parCle[c] = parCle[c] || []).push(groupes[k]); }); });

  // Lignes Pennylane : marquage recalculé de zéro à chaque passage
  const ecrits = [], marques = [], leves = [];
  d.forEach(function (r, k) {
    if (String(r[iSrc] || '') === 'Pennylane') {
      const ancien = String(r[iCtrl] || '').trim();
      if (ancien && new RegExp('^' + ACHATS_RAP.GARDER, 'i').test(ancien)) return;   // forcé à la main : on n'y touche pas
      const mt = achatsNum_(r[iMt]), date = achatsJour_(r[iDate]), lib = String(r[iLib] || '');
      const refs = String(r[iPc] || '') + ' ' + lib + ' ' + String((refsPL || {})[String(r[iId])] || '');
      const cles = achatsClesPiece_(refs);
      let g = null, motif = '';
      // 1. même pièce (une ou plusieurs lignes Drive de la même facture) et même montant HT
      const vus = {};
      cles.forEach(function (c) {
        (parCle[c] || []).forEach(function (cand) {
          if (g || vus[cand.cle] || cand.utilise) return;
          vus[cand.cle] = 1;
          if (Math.abs(cand.total - mt) <= ACHATS_RAP.TOLERANCE) { g = cand; motif = 'pièce et montant'; }
        });
      });
      // 2. pièce non rapprochable (Pennylane ne renvoie que le libellé) : montant HT identique
      //    au total d'une facture Drive, à moins d'un mois d'écart
      if (!g) {
        Object.keys(groupes).forEach(function (c) {
          const cand = groupes[c];
          if (g || cand.utilise || Math.abs(cand.total - mt) > ACHATS_RAP.TOLERANCE) return;
          const proche = cand.dates.some(function (x) { return achatsEcartJours_(x, date) <= ACHATS_RAP.JOURS; });
          if (proche) { g = cand; motif = 'montant et date'; }
        });
      }
      let txt = '';
      if (g) {
        g.utilise = 1;              // une facture Drive ne couvre qu'une seule ligne Pennylane
        const eco = g.comptes[ACHATS_RAP.ECOCUPS] ? ' dont ' + g.comptes[ACHATS_RAP.ECOCUPS].toFixed(2).replace('.', ',') + ' € d\'écocups (606300000, parc réutilisable)' : '';
        txt = 'doublon — rapproché avec ' + g.nom + ' (' + motif + eco + ') · ' + ACHATS_RAP.MARQUE;
      } else if (/[ée]cocup|gobelet/i.test(lib)) {
        // Écocups imputées par erreur en 607100000 : parc réutilisable, jamais dans le total boissons
        txt = 'écocups — parc réutilisable, hors coût matière · ' + ACHATS_RAP.MARQUE;
      }
      if (txt !== ancien) {
        ecrits.push({ k: k, txt: txt });
        if (txt) marques.push(achatsJour_(r[iDate]) + ' · ' + lib + ' · ' + mt.toFixed(2).replace('.', ',') + ' € → ' + txt.replace(' · ' + ACHATS_RAP.MARQUE, ''));
        else leves.push(achatsJour_(r[iDate]) + ' · ' + lib + ' · ' + mt.toFixed(2).replace('.', ',') + ' €');
      }
    }
  });
  ecrits.forEach(function (e) { sh.getRange(e.k + 2, iCtrl + 1).setValue(e.txt); });
  PropertiesService.getScriptProperties().setProperty('PL_RAP', String(Date.now()));
  const total = d.filter(function (r) { return String(r[iSrc] || '') === 'Pennylane' && new RegExp(ACHATS_RAP.MARQUE).test(String(r[iCtrl] || '')); }).length;
  const resume = '🔎 Rapprochement Drive ↔ Pennylane : ' + marques.length + ' ligne(s) marquée(s), ' + leves.length + ' levée(s).';
  return { resume: resume, marques: marques, leves: leves, dejaMarquees: total, ecrits: ecrits.length };
}

// Menu 🏐 Matchday → « 🧾 Contrôler les achats (Drive ↔ Pennylane) »
function pennylaneRapprocherAchats() {
  assurerStructure_();
  const shA = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONG.ACHATS);
  const mentions = shA ? achatsCorrigerMention_(shA) : [];
  const r = achatsRapprocher_(null);
  const bloc = function (t, l) { return l.length ? '\n\n' + t + '\n• ' + l.slice(0, 15).join('\n• ') + (l.length > 15 ? '\n• … et ' + (l.length - 15) + ' autre(s)' : '') : ''; };
  alerte_(r.resume +
    (mentions.length ? '\n✏️ ' + mentions.length + ' mention(s) déplacée(s) de la colonne ID PENNYLANE vers CONTRÔLE.' : '') +
    bloc('Marquées « hors total » (exclues du total boissons du 📊 TABLEAU DE BORD) :', r.marques) +
    bloc('Marquage levé (de nouveau comptées) :', r.leves) +
    '\n\nAucune ligne n\'est supprimée : le marquage est recalculé à chaque import (donc réversible).' +
    '\nPour forcer une ligne à rester comptée, écrire « garder » dans sa colonne CONTRÔLE.');
}

// Menu : test de connexion (affiche le compte trouvé et les 3 dernières lignes)
function pennylaneTester() {
  try {
    const id = plCompteId_(PENNYLANE.COMPTES[0]);
    if (!id) { alerte_('✅ Pennylane connecté (la clé est acceptée).\n\n⏳ Le compte ' + PENNYLANE.COMPTES[0] + ' (Achat buvette) n\'existe pas encore dans Pennylane. Dès qu\'il sera créé et que des factures y seront imputées, l\'import se fera tout seul (toutes les 6 h).'); return; }
    const l = plLignes_(id, '2025-01-01');
    alerte_('✅ Pennylane connecté. Compte ' + PENNYLANE.COMPTES[0] + ' (id ' + id + ').\n' +
      l.length + ' écriture(s) lue(s) depuis le 2025-01-01.\n\nDernières lignes :\n' +
      (l.length ? l.slice(-3).map(function (x) { return String(x.date).slice(0, 10) + ' · ' + (x.label || '') + ' · ' + ((Number(x.debit) || 0) - (Number(x.credit) || 0)) + ' €'; }).join('\n')
        : '(aucune — dans cet état l\'import ne supprime rien)'));
  } catch (e) { alerte_('❌ ' + e.message); }
}
