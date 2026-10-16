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

// Lignes Pennylane d'un compte depuis une date : [{date, label, montant (crédit − débit)}]
function rapLignesPennylane_(numero, depuis) {
  const id = plCompteId_(numero);
  if (!id) return [];
  return plLignes_(id, depuis).map(function (l) {
    return {
      date: String(l.date || (l.ledger_entry && l.ledger_entry.date) || '').slice(0, 10),
      label: String(l.label || (l.ledger_entry && l.ledger_entry.label) || ''),
      montant: Math.round(((Number(l.credit) || 0) - (Number(l.debit) || 0)) * 100) / 100,
    };
  });
}

// Écriture Pennylane rattachée au match ?
function rapDuMatch_(l, m) {
  if (!l.date || !m.jour) return false;
  const j = Math.round((new Date(l.date + 'T12:00:00') - new Date(m.jour + 'T12:00:00')) / 86400000);
  if (j < 0 || j > RAP.JOURS_APRES) return false;
  const lab = rapNorm_(l.label);
  return lab.indexOf(m.jjmm) >= 0 || (m.adv && lab.indexOf('vs ' + rapNorm_(m.adv)) >= 0);
}

// Buvette d'une écriture du compte buvette : « B1 - … » → Buvette 1
function rapBuvette_(label) {
  const x = String(label).match(/^\s*B\s?([0-9])\b/i) || String(label).match(/buvette\s*([0-9])/i);
  return x ? 'Buvette ' + x[1] : null;
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
  let pl = { buv: [], bou: [], bil: [] }, erreurPl = '';
  try {
    pl.buv = rapLignesPennylane_(RAP.BUVETTE, depuis);
    pl.bou = rapLignesPennylane_(RAP.BOUTIQUE, depuis);
    pl.bil = rapLignesPennylane_(RAP.BILLETTERIE, depuis);
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
    ecr.forEach(function (l) { const b = rapBuvette_(l.label); if (b && buvs.indexOf(b) < 0) { buvs.push(b); get(m, b); } });
    const tot = { ca: 0, caCB: 0, consCB: 0, cbTab: 0, tpe: 0, nTpe: 0, remise: 0, nRem: 0 };
    const lignesBuv = buvs.sort().map(function (b) {
      const a = acc[m][b], mine = ecr.filter(function (l) { return rapBuvette_(l.label) === b; });
      const remise = mine.length ? r2(mine.reduce(function (s, l) { return s + l.montant; }, 0)) : '';
      const tpe = clo[b] && clo[b].tpe != null && clo[b].tpe !== '' ? r2(clo[b].tpe) : '';
      ['ca', 'caCB', 'consCB', 'cbTab'].forEach(function (k) { tot[k] += a[k]; });
      if (tpe !== '') { tot.tpe += tpe; tot.nTpe++; }
      if (remise !== '') { tot.remise += remise; tot.nRem++; }
      return ligne(Object.assign({}, base, { ligne: b, ca: r2(a.ca), caCB: r2(a.caCB), caESP: r2(a.ca - a.caCB), consCB: r2(a.consCB),
        cbTab: r2(a.cbTab), tpe: tpe, remise: remise, ecart: remise === '' ? '' : r2(remise - a.cbTab), statut: statut(remise, a.cbTab),
        compte: mine.length ? RAP.BUVETTE : '', libelle: mine.map(function (l) { return l.label + ' (' + l.date + ')'; }).join(' · ') }));
    });
    // Écritures buvette du match sans buvette lisible dans le libellé
    const sansBuv = ecr.filter(function (l) { return !rapBuvette_(l.label); });
    const remiseTot = tot.nRem || sansBuv.length ? r2(tot.remise + sansBuv.reduce(function (s, l) { return s + l.montant; }, 0)) : '';
    out.push(ligne(Object.assign({}, base, { ligne: 'Total buvettes', ca: r2(tot.ca), caCB: r2(tot.caCB), caESP: r2(tot.ca - tot.caCB),
      consCB: r2(tot.consCB), cbTab: r2(tot.cbTab), tpe: tot.nTpe ? r2(tot.tpe) : '', remise: remiseTot,
      ecart: remiseTot === '' ? '' : r2(remiseTot - tot.cbTab), statut: statut(remiseTot, tot.cbTab), compte: RAP.BUVETTE,
      libelle: sansBuv.length ? '⚠️ sans n° de buvette : ' + sansBuv.map(function (l) { return l.label; }).join(' · ') : '' })));
    styles.push('match');
    lignesBuv.forEach(function (l) { out.push(l); styles.push('buv'); });
    // Autres remises du jour de match (pour retrouver le total crédité en banque)
    [['Boutique (HT comptabilisé)', pl.bou, RAP.BOUTIQUE], ['Billetterie (HT comptabilisé)', pl.bil, RAP.BILLETTERIE]].forEach(function (x) {
      const mine = x[1].filter(function (l) { return rapDuMatch_(l, inf); });
      if (!mine.length) return;
      out.push(ligne(Object.assign({}, base, { ligne: x[0], remise: r2(mine.reduce(function (s, l) { return s + l.montant; }, 0)),
        statut: 'ℹ️ hors buvette', compte: x[2], libelle: mine.map(function (l) { return l.label + ' (' + l.date + ')'; }).join(' · ') })));
      styles.push('autre');
    });
  });

  // Écriture de l'onglet
  let sh = ss.getSheetByName(RAP.TAB);
  if (!sh) sh = ss.insertSheet(RAP.TAB);
  sh.clear();
  const nc = RAP_COLS.length, navy = typeof NAVY !== 'undefined' ? NAVY : '#0b1f33', jaune = typeof YELLOW !== 'undefined' ? YELLOW : '#ffd400';
  sh.getRange(1, 1).setValue('💳 RAPPROCHEMENT CB — remises TPE (Pennylane) ↔ ventes des tablettes').setFontSize(16).setFontWeight('bold').setFontColor(navy);
  sh.getRange(2, 1).setValue((erreurPl ? '⚠️ ' + erreurPl + ' — ' : '') +
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
  const msg = '💳 Rapprochement CB : ' + matchs.length + ' match(s)' + (erreurPl ? ' — ⚠️ ' + erreurPl : '') + '.';
  if (!silencieux) { try { ss.toast(msg); } catch (e) {} }
  return msg;
}

// Menu 📡 Pilotage live → 💳 Rapprochement CB
function rapprochementCBMenu() {
  try { rapprochementCB(false); } catch (e) { alerte_('❌ ' + e.message); }
}
