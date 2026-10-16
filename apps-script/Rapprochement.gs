// ═══════════════════════════════════════════════════════════════════════════
// RAPPROCHEMENT CB — remises TPE (Pennylane) ↔ ventes des tablettes, par match et par buvette
// ═══════════════════════════════════════════════════════════════════════════
// Onglet 💳 RAPPROCHEMENT CB, entièrement automatique (aucune saisie) :
//  · Tablettes (🧾 VENTES) : CA boissons TTC, part payée en CB / en espèces, consignes nettes payées en CB,
//    CB enregistrée = ce que la banque doit créditer pour la buvette.
//  · Ticket TPE saisi à la clôture de caisse (tablette), s'il a été saisi.
//  · Pennylane (lecture seule) : remises comptabilisées pour le match
//      707100000 Vente buvette  → une ligne par buvette (libellé « B1 - Vs Narbonne - 10/10 »)
//      707200000 Vente boutique → ligne boutique (montant HT comptabilisé)
//      706120000 Billetterie GP → ligne billetterie (montant HT comptabilisé)
//    Une écriture est rattachée au match si elle est datée du match ou des 7 jours suivants et que son libellé
//    contient la date du match (jj/mm) ou « Vs <adversaire> ».
//  · Écart CB = remise Pennylane − CB enregistrée par les tablettes (> 0 : paiements CB passés sur le TPE sans saisie tablette).
// Même clé que 🛒 ACHATS : propriété PENNYLANE_API_KEY. Recalculé après chaque import Pennylane (toutes les 6 h)
// et par le menu 📡 Pilotage live → 💳 Rapprochement CB.
// ═══════════════════════════════════════════════════════════════════════════
const RAP = {
  TAB: '💳 RAPPROCHEMENT CB',
  BUVETTE: '707100000',
  BOUTIQUE: '707200000',
  BILLETTERIE: '706120000',
  JOURS_APRES: 7,
  TOLERANCE: 0.05,   // écart CB considéré comme nul en dessous de 5 centimes
};
const RAP_COLS = [
  ['match', 'MATCH'], ['date', 'DATE'], ['adv', 'ADVERSAIRE'], ['ligne', 'LIGNE'],
  ['ca', 'CA BOISSONS TTC €', '€'], ['caCB', 'dont payé CB €', '€'], ['caESP', 'dont payé espèces €', '€'],
  ['consCB', 'CONSIGNES NETTES PAYÉES CB €', '€'], ['cbTab', 'CB ENREGISTRÉE TABLETTES €', '€'],
  ['tpe', 'TICKET TPE (clôture) €', '€'], ['remise', 'REMISE CB PENNYLANE €', '€'], ['ecart', 'ÉCART CB € (Pennylane − tablettes)', '€'],
  ['statut', 'STATUT'], ['compte', 'COMPTE'], ['libelle', 'ÉCRITURE PENNYLANE'],
];

function rapNorm_(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

// Toutes les lignes d'écritures Pennylane datées entre deux jours (pagination par curseur), triées par compte.
// On ne passe pas par l'identifiant du compte : chaque ligne porte son numéro de compte (ledger_account.number).
function rapLignesFenetre_(depuis, jusqua) {
  const out = [], comptes = {}; let cursor = null, tour = 0;
  while (tour++ < 100) {
    const filtre = [{ field: 'date', operator: 'gteq', value: depuis }, { field: 'date', operator: 'lteq', value: jusqua }];
    const res = plApi_('/ledger_entry_lines', { filter: JSON.stringify(filtre), limit: 100, cursor: cursor, sort: 'date' });
    plItems_(res).forEach(function (l) {
      const num = String((l.ledger_account && l.ledger_account.number) || '');
      comptes[num] = (comptes[num] || 0) + 1;
      out.push({
        compte: num,
        date: String(l.date || '').slice(0, 10),
        label: String(l.label || ''),
        piece: String((l.ledger_entry && l.ledger_entry.label) || ''),
        entryId: l.ledger_entry && l.ledger_entry.id ? String(l.ledger_entry.id) : '',
        montant: Math.round(((Number(l.credit) || 0) - (Number(l.debit) || 0)) * 100) / 100,
      });
    });
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return { lignes: out, comptes: comptes };
}
function rapDuCompte_(lignes, numero) {
  const court = String(numero).replace(/0+$/, '');   // 707100000 ou 7071 selon le plan de comptes
  return lignes.filter(function (l) { return l.compte === numero || l.compte.replace(/0+$/, '') === court; });
}

// Le libellé « B1 - Vs Narbonne - 10/10 » est celui de l'écriture (libellé de pièce), pas toujours celui de la ligne :
// pour les lignes proches d'un match, on lit l'écriture (mémorisée dans le cache du script, 6 h).
function rapCompleterPieces_(lignes, matchs) {
  const cache = CacheService.getScriptCache();
  lignes.forEach(function (l) {
    if (l.piece || !l.entryId) return;
    const proche = matchs.some(function (m) { const j = rapJours_(l.date, m.jour); return j >= 0 && j <= RAP.JOURS_APRES; });
    if (!proche) return;
    const k = 'pl_ecr_' + l.entryId, memo = cache.get(k);
    if (memo !== null) { l.piece = memo; return; }
    try {
      const e = plApi_('/ledger_entries/' + l.entryId, {});
      l.piece = String((e && (e.label || (e.ledger_entry && e.ledger_entry.label))) || '');
      cache.put(k, l.piece, 21600);
    } catch (err) { Logger.log('Écriture ' + l.entryId + ' : ' + err.message); }
  });
  return lignes;
}

function rapJours_(d, jour) {
  if (!d || !jour) return -1;
  return Math.round((new Date(d + 'T12:00:00') - new Date(jour + 'T12:00:00')) / 86400000);
}
function rapTexte_(l) { return (l.piece + ' ' + l.label).trim(); }

// Écriture Pennylane rattachée au match ?
function rapDuMatch_(l, m) {
  const j = rapJours_(l.date, m.jour);
  if (j < 0 || j > RAP.JOURS_APRES) return false;
  const lab = rapNorm_(rapTexte_(l));
  return lab.indexOf(m.jjmm) >= 0 || (m.adv && lab.indexOf('vs ' + rapNorm_(m.adv)) >= 0);
}

// Buvette d'une écriture du compte buvette : « B1 - … » → Buvette 1 (libellé de l'écriture, sinon de la ligne)
function rapBuvette_(l) {
  const lire = function (s) { const x = String(s || '').match(/^\s*B\s?([0-9])\b/i) || String(s || '').match(/buvette\s*([0-9])/i); return x ? 'Buvette ' + x[1] : null; };
  return lire(l.piece) || lire(l.label);
}

function rapprochementCB(silencieux) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r2 = function (x) { return Math.round((Number(x) || 0) * 100) / 100; };
  const lire = function (sh) {
    if (!sh || sh.getLastRow() < 2) return { h: {}, rows: [] };
    const d = sh.getDataRange().getValues(), h = {};
    d[0].forEach(function (x, i) { if (x !== '' && !(String(x) in h)) h[String(x)] = i; });
    return { h: h, rows: d.slice(1) };
  };

  // Matchs
  const mt = lire(feuille_('MATCHS')), infos = {};
  mt.rows.forEach(function (r) {
    const id = String(r[mt.h['ID_MATCH']] || ''), d = r[mt.h['DATE']];
    if (!id || !(d instanceof Date)) return;
    infos[id] = { id: id, date: d, jour: pilDate_(d), jjmm: Utilities.formatDate(d, pilTz_(), 'dd/MM'), adv: String(r[mt.h['ADVERSAIRE']] || '') };
  });

  // Tablettes : 🧾 VENTES, par match et par buvette
  const acc = {};
  const get = function (m, b) { acc[m] = acc[m] || {}; return acc[m][b] = acc[m][b] || { ca: 0, caCB: 0, consCB: 0, cbTab: 0 }; };
  const ve = lire(feuille_('VENTES')), W = ve.h;
  ve.rows.forEach(function (r) {
    const m = String(r[W['ID_MATCH']] || ''); if (!infos[m]) return;
    const b = String(r[W['Buvette']] || '—'), a = get(m, b);
    const tot = Number(r[W['Total €']]) || 0, cp = Number(r[W['Consignes +']]) || 0, cr = Number(r[W['Consignes rendues']]) || 0;
    const ca = tot - cp + cr;           // total du ticket hors écocups
    a.ca += ca;
    if (String(r[W['Paiement']] || '') === 'CB') { a.cbTab += tot; a.consCB += cp - cr; a.caCB += ca; }
  });
  const matchs = Object.keys(acc);
  if (!matchs.length) { if (!silencieux) alerte_('Aucune vente tablette : rien à rapprocher.'); return 0; }

  // Pennylane : depuis la veille du plus ancien match
  const premier = matchs.map(function (m) { return infos[m].jour; }).sort()[0];
  const depuis = pilDate_(new Date(new Date(premier + 'T12:00:00').getTime() - 86400000));
  const dernier = matchs.map(function (m) { return infos[m].jour; }).sort().pop();
  const jusqua = pilDate_(new Date(new Date(dernier + 'T12:00:00').getTime() + RAP.JOURS_APRES * 86400000));
  let pl = { buv: [], bou: [], bil: [] }, erreurPl = '', lus = '';
  try {
    const f = rapLignesFenetre_(depuis, jusqua);
    pl.buv = rapDuCompte_(f.lignes, RAP.BUVETTE);
    pl.bou = rapDuCompte_(f.lignes, RAP.BOUTIQUE);
    pl.bil = rapDuCompte_(f.lignes, RAP.BILLETTERIE);
    const ms = matchs.map(function (m) { return infos[m]; });
    [pl.buv, pl.bou, pl.bil].forEach(function (x) { rapCompleterPieces_(x, ms); });
    lus = 'Pennylane du ' + depuis + ' au ' + jusqua + ' : ' + f.lignes.length + ' ligne(s) lue(s), dont ' + pl.buv.length + ' buvette, ' + pl.bou.length + ' boutique, ' + pl.bil.length + ' billetterie.' +
      (f.lignes.length && !pl.buv.length ? ' Comptes vus : ' + Object.keys(f.comptes).sort().slice(0, 25).join(', ') + '.' : '');
  } catch (e) { erreurPl = e.message; }

  const out = [], styles = [];
  const ligne = function (o) { return RAP_COLS.map(function (c) { return o[c[0]] === undefined ? '' : o[c[0]]; }); };
  const statut = function (remise, cb) {
    if (erreurPl) return '⚠️ Pennylane indisponible';
    if (remise === '') return '⏳ remise pas encore comptabilisée';
    const e = r2(remise - cb);
    if (Math.abs(e) < RAP.TOLERANCE) return '✅ rapproché';
    return e > 0 ? '⚠️ CB sur TPE sans saisie tablette' : '⚠️ CB tablette non retrouvée en banque';
  };

  matchs.sort(function (x, y) { return infos[y].date - infos[x].date; }).forEach(function (m) {
    const inf = infos[m], base = { match: m, date: inf.date, adv: inf.adv };
    const clo = pilProp_('PIL_CLOTURE_' + m, {});
    const ecr = pl.buv.filter(function (l) { return rapDuMatch_(l, inf); });
    const buvs = Object.keys(acc[m]);
    ecr.forEach(function (l) { const b = rapBuvette_(l); if (b && buvs.indexOf(b) < 0) { buvs.push(b); get(m, b); } });
    const tot = { ca: 0, caCB: 0, consCB: 0, cbTab: 0, tpe: 0, nTpe: 0, remise: 0, nRem: 0 };
    const lignesBuv = buvs.sort().map(function (b) {
      const a = acc[m][b], mine = ecr.filter(function (l) { return rapBuvette_(l) === b; });
      const remise = mine.length ? r2(mine.reduce(function (s, l) { return s + l.montant; }, 0)) : '';
      const tpe = clo[b] && clo[b].tpe != null && clo[b].tpe !== '' ? r2(clo[b].tpe) : '';
      ['ca', 'caCB', 'consCB', 'cbTab'].forEach(function (k) { tot[k] += a[k]; });
      if (tpe !== '') { tot.tpe += tpe; tot.nTpe++; }
      if (remise !== '') { tot.remise += remise; tot.nRem++; }
      return ligne(Object.assign({}, base, { ligne: b, ca: r2(a.ca), caCB: r2(a.caCB), caESP: r2(a.ca - a.caCB), consCB: r2(a.consCB),
        cbTab: r2(a.cbTab), tpe: tpe, remise: remise, ecart: remise === '' ? '' : r2(remise - a.cbTab), statut: statut(remise, a.cbTab),
        compte: mine.length ? RAP.BUVETTE : '', libelle: mine.map(function (l) { return rapTexte_(l) + ' (' + l.date + ')'; }).join(' · ') }));
    });
    // Écritures buvette du match sans buvette lisible dans le libellé
    const sansBuv = ecr.filter(function (l) { return !rapBuvette_(l); });
    const remiseTot = tot.nRem || sansBuv.length ? r2(tot.remise + sansBuv.reduce(function (s, l) { return s + l.montant; }, 0)) : '';
    out.push(ligne(Object.assign({}, base, { ligne: 'Total buvettes', ca: r2(tot.ca), caCB: r2(tot.caCB), caESP: r2(tot.ca - tot.caCB),
      consCB: r2(tot.consCB), cbTab: r2(tot.cbTab), tpe: tot.nTpe ? r2(tot.tpe) : '', remise: remiseTot,
      ecart: remiseTot === '' ? '' : r2(remiseTot - tot.cbTab), statut: statut(remiseTot, tot.cbTab), compte: RAP.BUVETTE,
      libelle: sansBuv.length ? '⚠️ sans n° de buvette : ' + sansBuv.map(function (l) { return rapTexte_(l); }).join(' · ') : '' })));
    styles.push('match');
    lignesBuv.forEach(function (l) { out.push(l); styles.push('buv'); });
    // Autres remises du jour de match (pour retrouver le total crédité en banque)
    [['Boutique (HT comptabilisé)', pl.bou, RAP.BOUTIQUE], ['Billetterie (HT comptabilisé)', pl.bil, RAP.BILLETTERIE]].forEach(function (x) {
      const mine = x[1].filter(function (l) { return rapDuMatch_(l, inf); });
      if (!mine.length) return;
      out.push(ligne(Object.assign({}, base, { ligne: x[0], remise: r2(mine.reduce(function (s, l) { return s + l.montant; }, 0)),
        statut: 'ℹ️ hors buvette', compte: x[2], libelle: mine.map(function (l) { return rapTexte_(l) + ' (' + l.date + ')'; }).join(' · ') })));
      styles.push('autre');
    });
  });

  // Écriture de l'onglet
  let sh = ss.getSheetByName(RAP.TAB);
  if (!sh) sh = ss.insertSheet(RAP.TAB);
  sh.clear();
  const nc = RAP_COLS.length, navy = typeof NAVY !== 'undefined' ? NAVY : '#0b1f33', jaune = typeof YELLOW !== 'undefined' ? YELLOW : '#ffd400';
  sh.getRange(1, 1).setValue('💳 RAPPROCHEMENT CB — remises TPE (Pennylane) ↔ ventes des tablettes').setFontSize(16).setFontWeight('bold').setFontColor(navy);
  sh.getRange(2, 1).setValue((erreurPl ? '⚠️ ' + erreurPl + ' — ' : lus + ' ') +
    'Automatique : recalculé après chaque import Pennylane (toutes les 6 h) ou menu 📡 Pilotage live → 💳 Rapprochement CB. ' +
    'CB enregistrée = CA boissons payé CB + consignes nettes payées CB. Écart CB > 0 : paiements passés sur le TPE sans saisie sur la tablette (vente non ventilée par produit). ' +
    'Boutique et billetterie : montants HT tels que comptabilisés, affichés pour retrouver le total crédité en banque ce jour-là.')
    .setFontStyle('italic').setFontColor('#666666').setWrap(false);
  sh.getRange(3, 1, 1, nc).setValues([RAP_COLS.map(function (c) { return c[1]; })])
    .setBackground(navy).setFontColor(jaune).setFontWeight('bold').setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
  sh.setRowHeight(3, 48);
  if (out.length) {
    sh.getRange(4, 1, out.length, nc).setValues(out);
    RAP_COLS.forEach(function (c, i) { if (c[2] === '€') sh.getRange(4, i + 1, out.length, 1).setNumberFormat('#,##0.00 €'); });
    sh.getRange(4, 2, out.length, 1).setNumberFormat('dd/MM/yyyy');
    styles.forEach(function (st, i) {
      const rg = sh.getRange(4 + i, 1, 1, nc);
      if (st === 'match') rg.setBackground('#e8eef7').setFontWeight('bold');
      else if (st === 'autre') rg.setFontColor('#888888').setFontStyle('italic');
      else rg.setFontColor('#444444');
    });
    const iSt = RAP_COLS.map(function (c) { return c[0]; }).indexOf('statut') + 1;
    const rgSt = sh.getRange(4, iSt, out.length, 1);
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('✅').setFontColor('#1e7b34').setRanges([rgSt]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('⚠️').setFontColor('#b45309').setBold(true).setRanges([rgSt]).build(),
    ]);
  }
  sh.setFrozenRows(3); sh.setFrozenColumns(4);
  sh.setColumnWidths(1, 4, 110); sh.setColumnWidths(5, 8, 115); sh.setColumnWidth(13, 230); sh.setColumnWidth(14, 90); sh.setColumnWidth(15, 380);
  const msg = '💳 Rapprochement CB : ' + matchs.length + ' match(s). ' + (erreurPl ? '⚠️ ' + erreurPl : lus);
  if (!silencieux) { try { ss.toast(msg); } catch (e) {} }
  return msg;
}

// Menu 📡 Pilotage live → 💳 Rapprochement CB
function rapprochementCBMenu() {
  try { rapprochementCB(false); } catch (e) { alerte_('❌ ' + e.message); }
}
