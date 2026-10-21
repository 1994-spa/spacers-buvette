// ═══════════════════════════════════════════════════════════════════════════
// 📈 GRAPHIQUES — les chiffres de la buvette en graphiques, dans le Sheet (pour le bureau / le Président)
// A coller comme NOUVEAU fichier Apps Script (Graphiques.gs), à côté de Pilotage.gs (dont il réutilise les calculs).
//
// - Onglet 📈 GRAPHIQUES : un menu déroulant « Match » ; les indicateurs, les graphiques et les tableaux suivent le
//   match choisi tout seuls (formules), sans relancer de script.
//   · La saison : CA boissons par match, recette par spectateur, ventes reliées à un billet par buvette.
//   · Le match : rythme des ventes par buvette, produits vendus, encaissements CB / espèces, écocups.
//   · En bas : les tableaux de chiffres qui alimentent les graphiques.
// - Onglet masqué ⚙️ graphiques données : recalculé à chaque passage du traitement auto (10 min) et par le menu.
// - Menu 📡 Pilotage live → 📄 PDF pour le bureau : enregistre l'onglet en PDF (A4 paysage) à côté du Sheet.
// Mêmes règles que le tableau de bord : CA boissons hors consignes, ventes annulées écartées, boissons bénévoles hors ventes.
// ═══════════════════════════════════════════════════════════════════════════

const GR_TAB = '📈 GRAPHIQUES';
const GR_DATA_TAB = '⚙️ graphiques données';
// Noms des buvettes dans les tableaux et légendes (B1 Porte 4, B2 Porte 6, B3 intérieure)
const GR_BUV = ['B1 · Porte 4', 'B2 · Porte 6', 'B3 · Intérieure'];
const GR_COUL = { navy: '#001E2D', day: '#91BEE6', b: ['#2a78d6', '#eb6834', '#1baf7a'], cb: '#6250d6', esp: '#eda100', gris: '#8a99a8', fond: '#f1f6fb' };
// Blocs de l'onglet de données (colonnes)
const GR_S_HDR = ['LIBELLÉ', 'ID_MATCH', 'SAISON', 'MATCH', 'DATE', 'AFFLUENCE', 'CA BOISSONS €', 'VENTES', 'PANIER MOYEN €', 'RECETTE / SPECTATEUR €',
  'BILLET B1', 'BILLET B2', 'BILLET B3', 'BILLET TOUTES', 'PART ALCOOL', 'ÉCOCUPS SORTIS', 'ÉCOCUPS REVENUS'];   // A:Q
const GR_Q_COL = 19, GR_Q_HDR = ['ID_MATCH', 'HEURE', 'Buvette 1', 'Buvette 2', 'Buvette 3', 'CB cumulée', 'Espèces cumulées', 'Écocups sortis', 'Écocups revenus'];   // S:AA
const GR_P_COL = 29, GR_P_HDR = ['ID_MATCH', 'PRODUIT', 'CA €', 'QUANTITÉ'];   // AC:AF
// Lignes de l'onglet visible
const GR_R = { saisonT: 66, matchT: 89, lignesSaison: 20, lignesMatch: 40 };

function graphiquesRecreer() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(GR_TAB);
  if (sh) ss.deleteSheet(sh);
  graphiquesMaj();
}

function graphiquesMaj(silencieux) {
  silencieux = silencieux === true;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ds = grDonnees_(ss);
  let sh = ss.getSheetByName(GR_TAB);
  if (!sh) {
    if (silencieux) return;               // l'onglet se crée par le menu, pas en tâche de fond
    sh = grConstruire_(ss);
  }
  // Match choisi : on garde le choix de l'utilisateur ; sinon le dernier match joué
  const libelles = ds.getLastRow() > 1 ? ds.getRange(2, 1, ds.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); }).filter(String) : [];   // colonne A seule (les autres blocs sont plus longs)
  const choix = String(sh.getRange('B4').getValue() || '');
  if (libelles.length && libelles.indexOf(choix) < 0) sh.getRange('B4').setValue(libelles[libelles.length - 1]);
  sh.getRange('A2').setValue('Mis à jour le ' + Utilities.formatDate(new Date(), pilTz_(), "dd/MM/yyyy 'à' HH:mm") +
    ' (automatique toutes les 10 min). Choisis le match en B4 : tout l\'onglet suit. CA boissons hors consignes ; ventes annulées et boissons bénévoles exclues.');
  if (!silencieux) { try { ss.setActiveSheet(sh); ss.toast('Graphiques à jour (' + libelles.length + ' match(s))', '📈 Graphiques'); } catch (e) {} }
}

// ── Données : un bloc saison (1 ligne par match), un bloc quart d'heure, un bloc produits ──
function grDonnees_(ss) {
  let ds = ss.getSheetByName(GR_DATA_TAB);
  if (!ds) { ds = ss.insertSheet(GR_DATA_TAB); ds.hideSheet(); }
  const sv = feuille_('VENTES');
  const data = sv && sv.getLastRow() > 1 ? sv.getRange(2, 1, sv.getLastRow() - 1, PIL_COL_PAIEMENT + 1).getValues() : [];
  const tout = pilGraphiques_(data, [], '');           // saisonCourante vide → tous les matchs
  const matchs = tout.saison.matchs;

  // Saison de chaque match (📅 MATCHS)
  const saisonDe = {};
  const sm = feuille_('MATCHS');
  if (sm && sm.getLastRow() > 1) {
    const d = sm.getDataRange().getValues(), h = d[0].map(String), cId = h.indexOf('ID_MATCH'), cS = h.indexOf('SAISON');
    if (cS >= 0) d.slice(1).forEach(function (r) { saisonDe[String(r[cId])] = String(r[cS] || ''); });
  }
  // CA et quantités par produit (⚙️ détail ventes : prix encaissés)
  const prod = {}, nomP = {};
  PIL.PRODUITS.forEach(function (p) { nomP[p[0]] = p[1]; });
  const vd = feuille_('DETAIL');
  if (vd && vd.getLastRow() > 1) vd.getRange(2, 1, vd.getLastRow() - 1, PIL_VD_HDR.length).getValues().forEach(function (r) {
    const m = String(r[0] || ''), ref = String(r[3] || '');
    if (!m || !(ref in nomP) || !/^(VENTE|ANNULATION)$/.test(String(r[10]))) return;
    prod[m] = prod[m] || {};
    const o = prod[m][ref] = prod[m][ref] || { ca: 0, q: 0 };
    o.ca += Number(r[8]) || 0; o.q += Number(r[5]) || 0;
  });

  const B = PIL.BUVETTES, sRows = [], qRows = [], pRows = [];
  const parMatch = {};
  data.forEach(function (r) { const m = String(r[PIL_I['ID_MATCH']] || ''); if (m) (parMatch[m] = parMatch[m] || []).push(r); });
  matchs.forEach(function (m) {
    const date = m.date ? new Date(m.date + 'T12:00:00') : '';
    const jm = m.date ? m.date.slice(8, 10) + '/' + m.date.slice(5, 7) : '';
    const adv = String(m.adversaire || m.id);
    const pc = prod[m.id] || {};
    let alc = 0, totP = 0;
    Object.keys(pc).forEach(function (ref) { totP += pc[ref].ca; if (/^P01/.test(ref)) alc += pc[ref].ca; });
    const pb = function (b) { const x = (m.parBuvette || {})[b]; return x && x.ventes ? x.reliees / x.ventes : ''; };
    sRows.push([adv + ' · ' + jm, m.id, saisonDe[m.id] || '', adv + ' ' + jm, date, m.affluence || '', m.ca, m.ventes,
      m.ventes ? Math.round(m.ca / m.ventes * 100) / 100 : '', m.affluence ? Math.round(m.ca / m.affluence * 100) / 100 : '',
      pb(B[0]), pb(B[1]), pb(B[2]), m.ventes ? m.reliees / m.ventes : '', totP ? alc / totP : '', m.sortis, m.revenus]);
    // Quarts d'heure continus, cumuls
    const serie = pilGraphiques_(data, parMatch[m.id] || [], m.id, true).serie;
    const ks = Object.keys(serie).sort();
    if (ks.length) {
      const mn = function (k) { return Number(k.slice(0, 2)) * 60 + Number(k.slice(3, 5)); };
      let cb = 0, es = 0, so = 0, re = 0;
      for (let t = mn(ks[0]); t <= mn(ks[ks.length - 1]); t += 15) {
        const k = ('0' + Math.floor(t / 60) % 24).slice(-2) + ':' + ('0' + t % 60).slice(-2), p = serie[k] || { ca: {}, cb: 0, esp: 0, sortis: 0, revenus: 0 };
        cb += p.cb; es += p.esp; so += p.sortis; re += p.revenus;
        qRows.push([m.id, k, Math.round((p.ca[B[0]] || 0) * 100) / 100, Math.round((p.ca[B[1]] || 0) * 100) / 100, Math.round((p.ca[B[2]] || 0) * 100) / 100,
          Math.round(cb * 100) / 100, Math.round(es * 100) / 100, so, re]);
      }
    }
    PIL.PRODUITS.forEach(function (p) { const x = pc[p[0]]; if (x && x.q) pRows.push([m.id, p[1], Math.round(x.ca * 100) / 100, x.q]); });
  });

  ds.clearContents();
  ds.getRange(1, 1, 1, GR_S_HDR.length).setValues([GR_S_HDR]).setFontWeight('bold');
  ds.getRange(1, GR_Q_COL, 1, GR_Q_HDR.length).setValues([GR_Q_HDR]).setFontWeight('bold');
  ds.getRange(1, GR_P_COL, 1, GR_P_HDR.length).setValues([GR_P_HDR]).setFontWeight('bold');
  ds.getRange(2, GR_Q_COL + 1, Math.max(1, qRows.length), 1).setNumberFormat('@');   // « 19:15 » reste du texte
  if (sRows.length) ds.getRange(2, 1, sRows.length, GR_S_HDR.length).setValues(sRows);
  if (qRows.length) ds.getRange(2, GR_Q_COL, qRows.length, GR_Q_HDR.length).setValues(qRows);
  if (pRows.length) ds.getRange(2, GR_P_COL, pRows.length, GR_P_HDR.length).setValues(pRows);
  ds.getRange(2, 5, Math.max(1, sRows.length), 1).setNumberFormat('dd/MM/yyyy');
  return ds;
}

// ── Mise en page de l'onglet visible (une seule fois ; les données suivent par formules) ──
function grConstruire_(ss) {
  const sh = ss.insertSheet(GR_TAB, 0);
  const D = "'" + GR_DATA_TAB + "'!", C = GR_COUL, nl = grLettre_;
  sh.setHiddenGridlines(true);
  sh.setTabColor(C.day);
  for (let c = 1; c <= 14; c++) sh.setColumnWidth(c, 108);
  sh.setColumnWidth(16, 60);

  // Titre
  sh.getRange('A1:N1').merge().setValue('📈 BUVETTE — LES CHIFFRES EN GRAPHIQUES').setBackground(C.navy).setFontColor(C.day)
    .setFontSize(18).setFontWeight('bold').setVerticalAlignment('middle');
  sh.setRowHeight(1, 46);
  sh.getRange('A2:N2').merge().setFontColor('#64778A').setFontStyle('italic').setFontSize(9);

  // Choix du match (+ aides cachées en colonne P : ID et saison du match choisi)
  sh.getRange('A4').setValue('Match').setFontWeight('bold').setHorizontalAlignment('right').setFontSize(12);
  sh.getRange('B4:D4').merge().setBackground(C.day).setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(ss.getSheetByName(GR_DATA_TAB).getRange('A2:A'), true).setAllowInvalid(false).build());
  sh.getRange('E4:N4').merge().setValue('← choisis un match : indicateurs, graphiques du match et tableaux se mettent à jour').setFontColor('#64778A').setFontStyle('italic');
  sh.getRange('P4').setFormula(grF_('=IFERROR(VLOOKUP($B$4,' + D + 'A2:B,2,FALSE),"")'));
  sh.getRange('P5').setFormula(grF_('=IFERROR(VLOOKUP($B$4,' + D + 'A2:C,3,FALSE),"")'));

  // Indicateurs du match + moyenne de la saison
  const kpis = [['CA BOISSONS', 'G', '#,##0 €'], ['VENTES', 'H', '#,##0'], ['PANIER MOYEN', 'I', '0.00 €'],
    ['RECETTE / SPECTATEUR', 'J', '0.00 €'], ['PART ALCOOL', 'O', '0%'], ['VENTES AVEC BILLET', 'N', '0%']];
  kpis.forEach(function (k, i) {
    const col = 1 + i * 2;
    sh.getRange(6, col, 1, 2).merge().setValue(k[0]).setFontSize(9).setFontWeight('bold').setFontColor('#33495a');
    sh.getRange(7, col, 1, 2).merge().setFormula(grF_('=IFERROR(INDEX(' + D + k[1] + '2:' + k[1] + ',MATCH($P$4,' + D + 'B2:B,0)),"")'))
      .setNumberFormat(k[2]).setFontSize(22).setFontWeight('bold').setFontColor(C.navy);
    sh.getRange(8, col, 1, 2).merge().setFormula(grF_('=IFERROR(AVERAGEIF(' + D + 'C2:C,$P$5,' + D + k[1] + '2:' + k[1] + '),"")'))
      .setNumberFormat('"moyenne saison : "' + k[2]).setFontSize(9).setFontColor('#64778A');
    sh.getRange(6, col, 3, 2).setBackground(C.fond).setBorder(true, true, true, true, false, false, '#c9d8e6', SpreadsheetApp.BorderStyle.SOLID);
  });
  sh.setRowHeight(7, 38);

  const section = function (r, txt, formule) {
    const g = sh.getRange(r, 1, 1, 14).merge().setBackground(C.navy).setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
    if (formule) g.setFormula(grF_(formule)); else g.setValue(txt);
    sh.setRowHeight(r, 28);
  };
  section(10, '', '="LA SAISON "&$P$5&" — un repère par match"');
  section(29, '', '="LE MATCH : "&$B$4');
  section(GR_R.saisonT - 1, 'LES CHIFFRES DE LA SAISON (alimentent les graphiques)');
  section(GR_R.matchT - 1, '', '="LES CHIFFRES DU MATCH : "&$B$4');

  // Tableau saison
  const rs = GR_R.saisonT, ns = GR_R.lignesSaison;
  const hs = ['Match', 'Date', 'Affluence', 'CA boissons', 'Ventes', 'Panier moyen', 'Recette / spectateur', GR_BUV[0], GR_BUV[1], GR_BUV[2], 'Billet : toutes', 'Part alcool', 'Écocups sortis', 'Écocups revenus'];
  sh.getRange(rs, 1, 1, hs.length).setValues([hs]).setBackground(C.day).setFontColor(C.navy).setFontWeight('bold').setWrap(true).setFontSize(9);
  sh.getRange(rs + 1, 1).setFormula(grF_('=IFERROR(FILTER(' + D + 'D2:Q,' + D + 'C2:C=$P$5,' + D + 'B2:B<>""),"Pas encore de vente cette saison")'));
  sh.getRange(rs + 1, 2, ns, 1).setNumberFormat('dd/MM/yyyy');
  sh.getRange(rs + 1, 3, ns, 1).setNumberFormat('#,##0');
  sh.getRange(rs + 1, 4, ns, 1).setNumberFormat('#,##0 €');
  sh.getRange(rs + 1, 5, ns, 1).setNumberFormat('#,##0');
  sh.getRange(rs + 1, 6, ns, 2).setNumberFormat('0.00 €');
  sh.getRange(rs + 1, 8, ns, 5).setNumberFormat('0%');
  sh.getRange(rs + 1, 13, ns, 2).setNumberFormat('#,##0');
  sh.getRange(rs, 8, 1, 3).setNote('Part des ventes de boissons reliées à un billet ou une carte abonné scannés.');

  // Tableaux du match : quarts d'heure (A:H) et produits (J:L)
  const rm = GR_R.matchT, nm = GR_R.lignesMatch;
  const hq = ['Heure', GR_BUV[0], GR_BUV[1], GR_BUV[2], 'CB cumulée', 'Espèces cumulées', 'Écocups sortis', 'Écocups revenus'];
  sh.getRange(rm, 1, 1, hq.length).setValues([hq]).setBackground(C.day).setFontColor(C.navy).setFontWeight('bold').setWrap(true).setFontSize(9);
  sh.getRange(rm + 1, 1).setFormula(grF_('=IFERROR(FILTER(' + D + nl(GR_Q_COL + 1) + '2:' + nl(GR_Q_COL + 8) + ',' + D + nl(GR_Q_COL) + '2:' + nl(GR_Q_COL) + '=$P$4),"")'));
  sh.getRange(rm + 1, 2, nm, 5).setNumberFormat('#,##0 €');
  sh.getRange(rm + 1, 7, nm, 2).setNumberFormat('#,##0');
  sh.getRange(rm, 10, 1, 3).setValues([['Produit', 'CA encaissé', 'Quantité']]).setBackground(C.day).setFontColor(C.navy).setFontWeight('bold').setFontSize(9);
  sh.getRange(rm + 1, 10).setFormula(grF_('=IFERROR(SORT(FILTER(' + D + nl(GR_P_COL + 1) + '2:' + nl(GR_P_COL + 3) + ',' + D + nl(GR_P_COL) + '2:' + nl(GR_P_COL) + '=$P$4),2,FALSE),"")'));
  sh.getRange(rm + 1, 11, 12, 1).setNumberFormat('#,##0 €');
  sh.getRange(rm, 1, 1, 14).setVerticalAlignment('middle');
  sh.setRowHeight(rs, 34); sh.setRowHeight(rm, 34);

  // Graphiques
  const base = function (b, titre, w, h) {
    return b.setOption('title', titre).setOption('titleTextStyle', { color: C.navy, fontSize: 13, bold: true })
      .setOption('legend', { position: 'bottom' }).setOption('width', w).setOption('height', h)
      // Plages séparées (catégories + valeurs) assemblées en colonnes : sans cela, Sheets peut afficher un graphique vide
      .setMergeStrategy(Charts.ChartMergeStrategy.MERGE_COLUMNS).setTransposeRowsAndColumns(false);
  };
  const R = function (r, c, n, k) { return sh.getRange(r, c, n, k || 1); };
  const S1 = rs, SN = ns + 1, M1 = rm, MN = nm + 1;
  const w3 = 426, h3 = 300, w2 = 650, h2 = 320;
  // Saison
  sh.insertChart(base(sh.newChart().asColumnChart().addRange(R(S1, 1, SN)).addRange(R(S1, 4, SN)).setNumHeaders(1), 'CA boissons par match', w3, h3)
    .setOption('series', grSeries_([C.navy])).setOption('legend', { position: 'none' }).setOption('vAxis', { format: '#,##0 €', minValue: 0 })
    .setPosition(11, 1, 4, 6).build());
  sh.insertChart(base(sh.newChart().asColumnChart().addRange(R(S1, 1, SN)).addRange(R(S1, 7, SN)).setNumHeaders(1), 'Recette par spectateur', w3, h3)
    .setOption('series', grSeries_([C.day])).setOption('legend', { position: 'none' }).setOption('vAxis', { format: '0.00 €', minValue: 0 })
    .setPosition(11, 5, 8, 6).build());
  sh.insertChart(base(sh.newChart().asColumnChart().addRange(R(S1, 1, SN)).addRange(R(S1, 8, SN, 3)).setNumHeaders(1), 'Ventes reliées à un billet, par buvette', w3, h3)
    .setOption('series', grSeries_(C.b)).setOption('vAxis', { format: '0%', minValue: 0 })
    .setPosition(11, 9, 12, 6).build());
  // Match
  sh.insertChart(base(sh.newChart().asColumnChart().addRange(R(M1, 1, MN)).addRange(R(M1, 2, MN, 3)).setNumHeaders(1).setStacked(), 'Rythme des ventes : CA boissons par quart d\'heure', w2, h2)
    .setOption('series', grSeries_(C.b)).setOption('vAxis', { format: '#,##0 €', minValue: 0 }).setOption('bar', { groupWidth: '75%' })
    .setPosition(30, 1, 4, 6).build());
  sh.insertChart(base(sh.newChart().asBarChart().addRange(R(M1, 10, 13)).addRange(R(M1, 11, 13)).setNumHeaders(1), 'Produits vendus (CA encaissé)', w2, h2)
    .setOption('series', grSeries_([C.navy])).setOption('legend', { position: 'none' }).setOption('hAxis', { format: '#,##0 €', minValue: 0 })
    .setPosition(30, 7, 20, 6).build());
  sh.insertChart(base(sh.newChart().asLineChart().addRange(R(M1, 1, MN)).addRange(R(M1, 5, MN, 2)).setNumHeaders(1), 'Encaissements cumulés : CB et espèces', w2, h2)
    .setOption('series', grSeries_([C.cb, C.esp])).setOption('lineWidth', 3).setOption('vAxis', { format: '#,##0 €' })
    .setPosition(47, 1, 4, 6).build());
  sh.insertChart(base(sh.newChart().asLineChart().addRange(R(M1, 1, MN)).addRange(R(M1, 7, MN, 2)).setNumHeaders(1), 'Écocups pendant le match (cumul)', w2, h2)
    .setOption('series', grSeries_([C.navy, C.gris])).setOption('lineWidth', 3).setOption('vAxis', { format: '#,##0', minValue: 0 })
    .setPosition(47, 7, 20, 6).build());

  sh.hideColumns(16);
  sh.setFrozenRows(4);
  return sh;
}

// Formules écrites à l'anglaise (virgules) : converties au format du Sheet. En français (et autres locales à virgule
// décimale), le séparateur d'arguments est « ; » — sinon Sheets affiche #ERROR!. Les virgules entre guillemets sont gardées.
function grF_(formule) {
  let loc = 'fr_FR';
  try { loc = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetLocale() || loc; } catch (e) {}
  if (/^(en|ja|ko|zh|th|he|iw|hi)(_|$)/i.test(loc)) return formule;
  let out = '', dansTexte = false;
  for (let i = 0; i < formule.length; i++) {
    const c = formule.charAt(i);
    if (c === '"') dansTexte = !dansTexte;
    out += (!dansTexte && c === ',') ? ';' : c;
  }
  return out;
}

// Couleur par série (ordre fixe : une buvette garde sa couleur dans tous les graphiques)
function grSeries_(couleurs) { const o = {}; couleurs.forEach(function (c, i) { o[i] = { color: c }; }); return o; }

function grLettre_(c) { let s = ''; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

// ── PDF de l'onglet (A4 paysage, une largeur de page) enregistré à côté du Sheet ──
function graphiquesPdf() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  graphiquesMaj();
  const sh = ss.getSheetByName(GR_TAB);
  SpreadsheetApp.flush();
  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&gid=' + sh.getSheetId() +
    '&size=A4&portrait=false&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenum=CENTER&fzr=false' +
    '&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4&r1=0&c1=0&r2=' + (GR_R.matchT + GR_R.lignesMatch) + '&c2=14';
  const rep = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (rep.getResponseCode() !== 200) throw new Error('Export PDF refusé (' + rep.getResponseCode() + ')');
  const nom = 'Buvette - ' + String(sh.getRange('B4').getValue() || 'graphiques').replace(/[\\/:*?"<>|]/g, '-') + '.pdf';
  const parents = DriveApp.getFileById(ss.getId()).getParents(), dossier = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const f = dossier.createFile(rep.getBlob().setName(nom));
  const html = '<div style="font-family:Arial;font-size:14px;line-height:1.5">PDF enregistré dans le dossier du Sheet :<br><a href="' + f.getUrl() + '" target="_blank"><b>' + nom +
    '</b></a><br><span style="color:#64778A;font-size:12px">Le lien ouvre le fichier dans Drive (partage privé : à transmettre ou partager depuis Drive).</span></div>';
  SpreadsheetApp.getUi().showModelessDialog(HtmlService.createHtmlOutput(html).setWidth(420).setHeight(140), '📄 Graphiques buvette');
}
