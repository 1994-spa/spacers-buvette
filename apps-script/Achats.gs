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

// ── Menu + automatique : importe les achats buvette depuis le début de la saison précédente ──
function pennylaneImporterAchats(silencieux) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONG.ACHATS);
  if (!sh) throw new Error('Onglet 🛒 ACHATS introuvable (lancer la réorganisation)');
  assurerStructure_();
  const sa = donnees_(feuille_('SAISONS')).filter(function (r) { return r[2] instanceof Date; }).sort(function (a, b) { return a[2] - b[2]; });
  const enCours = sa.filter(function (r) { return String(r[7]) === 'EN COURS'; })[0];
  const i = enCours ? sa.indexOf(enCours) : sa.length - 1;
  const depuis = sa.length ? jour_(sa[Math.max(0, i - 1)][2]) : '2025-08-01';

  const h = entete_(sh), d = donnees_(sh), iId = h.indexOf('ID PENNYLANE'), iCtrl = h.indexOf('CONTRÔLE');
  const parId = {}; d.forEach(function (r, k) { if (r[iId]) parId[String(r[iId])] = k; });
  let ajout = 0, maj = 0; const vus = {}, absents = [];
  PENNYLANE.COMPTES.forEach(function (num) {
    const idCompte = plCompteId_(num);
    if (!idCompte) { absents.push(num); return; }
    plLignes_(idCompte, depuis).forEach(function (l) {
      const id = String(l.id), date = String(l.date || (l.ledger_entry && l.ledger_entry.date) || '').slice(0, 10);
      const montant = Math.round(((Number(l.debit) || 0) - (Number(l.credit) || 0)) * 100) / 100;
      const piece = l.ledger_entry ? (l.ledger_entry.url || ('écriture ' + l.ledger_entry.id)) : '';
      const ligne = [date ? new Date(date + 'T12:00:00') : '', 'Pennylane', String(l.label || (l.ledger_entry && l.ledger_entry.label) || ''), num, montant,
        saisonDe_(date), date.slice(0, 7), piece, id];
      // Colonne CONTRÔLE : on garde ce qui y est déjà (le rapprochement le recalcule juste après,
      // et un « garder » écrit à la main ne doit jamais être effacé par un import).
      if (iCtrl >= 0) ligne[iCtrl] = parId[id] != null ? (d[parId[id]][iCtrl] || '') : '';
      // Références de pièce : gardées en mémoire pour le rapprochement (pas écrites dans l'onglet)
      vus[id] = plRefsPiece_(l) || ' ';   // jamais vide : la valeur sert aussi de « vue dans Pennylane »
      if (parId[id] != null) { d[parId[id]] = ligne; maj++; } else { d.push(ligne); ajout++; }
    });
  });
  if (absents.length === PENNYLANE.COMPTES.length) {
    const m = '⏳ Pennylane connecté, mais le compte ' + absents.join(', ') + ' n\'existe pas encore. Rien à importer : l\'import démarrera tout seul dès qu\'il sera créé et utilisé.';
    if (silencieux !== true) alerte_(m);
    return m;
  }
  // Lignes supprimées dans Pennylane depuis la date d'import : retirées ici aussi
  const avant = d.length;
  const garde = d.filter(function (r) { return r[1] !== 'Pennylane' || vus[String(r[iId])] || jour_(r[0]) < depuis; });
  garde.sort(function (a, b) { return String(jour_(b[0])).localeCompare(String(jour_(a[0]))); });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, h.length).clearContent();
  if (garde.length) sh.getRange(2, 1, garde.length, h.length).setValues(garde);
  PropertiesService.getScriptProperties().setProperty('PL_SYNC', String(Date.now()));
  // Rapprochement Drive ↔ Pennylane : relancé à chaque import, donc idempotent
  let rap = '';
  try { rap = '\n' + achatsRapprocher_(vus).resume; } catch (e) { rap = '\n⚠️ Rapprochement Drive ↔ Pennylane : ' + e.message; }
  try { if (typeof rapprochementCB === 'function') rapprochementCB(true); } catch (e) { Logger.log('Rapprochement CB : ' + e.message); }
  const msg = '🧾 Achats Pennylane (compte ' + PENNYLANE.COMPTES.join(', ') + ' depuis le ' + depuis + ') : ' + ajout + ' ajoutée(s), ' + maj + ' mise(s) à jour' + (avant - garde.length ? ', ' + (avant - garde.length) + ' retirée(s)' : '') + '.' + rap;
  if (silencieux !== true) alerte_(msg);
  return msg;
}

// Appelé par le traitement automatique (toutes les 10 min) : import au plus toutes les 6 h,
// rapprochement au plus toutes les 30 min (il répare le marquage si un autre import l'a effacé).
function pennylaneImportAuto_() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('PENNYLANE_API_KEY')) return;
  if (Date.now() - (Number(p.getProperty('PL_SYNC')) || 0) >= PENNYLANE.INTERVALLE_H * 3600000) {
    try { pennylaneImporterAchats(true); return; } catch (e) { Logger.log(e.message); }
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
  const r = achatsRapprocher_(null);
  const bloc = function (t, l) { return l.length ? '\n\n' + t + '\n• ' + l.slice(0, 15).join('\n• ') + (l.length > 15 ? '\n• … et ' + (l.length - 15) + ' autre(s)' : '') : ''; };
  alerte_(r.resume +
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
    const l = plLignes_(id, '2025-01-01').slice(-3);
    alerte_('✅ Pennylane connecté. Compte ' + PENNYLANE.COMPTES[0] + ' (id ' + id + ').\n\nDernières lignes :\n' +
      (l.length ? l.map(function (x) { return String(x.date).slice(0, 10) + ' · ' + (x.label || '') + ' · ' + ((Number(x.debit) || 0) - (Number(x.credit) || 0)) + ' €'; }).join('\n') : '(aucune)'));
  } catch (e) { alerte_('❌ ' + e.message); }
}