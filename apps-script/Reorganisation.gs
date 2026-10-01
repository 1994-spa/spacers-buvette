// ═══════════════════════════════════════════════════════════════════════════
// RÉORGANISATION DU FICHIER (V13) — à lancer une fois : menu 🏐 Matchday → 🧹 Réorganiser
// ═══════════════════════════════════════════════════════════════════════════
// 1. Copie de sauvegarde complète du fichier (même dossier Drive)
// 2. Archive à part, accès restreint : exports O&B 25-26 (données personnelles) + Pennylane location
// 3. Nouveaux onglets : ACCUEIL, TABLEAU DE BORD, MATCHS (fusion 10_MATCHS + 80_KPI_MATCH),
//    PRODUITS (remplace 06_STOCKS), ACHATS, FOODTRUCKS ; renommage VENTES / FIDÉLITÉ / techniques
// 4. Suppression des onglets devenus inutiles, purge des lignes de test, mise en forme charte 26-27
// Relançable : ce qui est déjà fait est sauté.
// ═══════════════════════════════════════════════════════════════════════════

const REORG_SUPPRIMER = ['PILOTAGE', 'DASHBOARD', 'DASHBOARD_SAISON', '10_MATCHS', '80_KPI_MATCH', '06_STOCKS',
  '20_OANDB_COMMANDES', '30_OANDB_TICKETS', '40_PENNYLANE_LOCATION', '99_DIAGNOSTIC', 'ANALYSE_SEGMENTS',
  '52_STOCK_LIVE', '53_PREPA', '54_TABLETTES', '60_ACHATS_DIRECTS', '70_FOODTRUCKS'];
const REORG_ARCHIVER = ['20_OANDB_COMMANDES', '30_OANDB_TICKETS', '40_PENNYLANE_LOCATION', 'ANALYSE_SEGMENTS'];

// Catalogue 26-27 : réf, produit, famille, prix vente, prix achat (unité ; FUT = fût 30 L), colisage, seuil
const PRODUITS_26_27 = [
  ['FUT',      'Bière — fût 30 L',      'Bière', '',  '',   1,  ''],
  ['P01_25',   'Bière 25cl',            'Bière', 3,   '',   '', 15],
  ['P01_50',   'Bière 50cl',            'Bière', 6,   '',   '', 10],
  ['P02_COCA', 'Coca-Cola',             'Soft',  3,   0.72, 24, 5],
  ['P02_ORAN', 'Orangina',              'Soft',  3,   '',   24, 5],
  ['P02_ICET', 'Ice Tea',               'Soft',  3,   '',   24, 5],
  ['P02_SCHW', 'Schweppes Agrumes',     'Soft',  3,   0.61, 24, 5],
  ['P03',      'Eau plate 50cl',        'Eau',   1,   0.21, 24, 5],
  ['P04',      'Eau gazeuse 50cl',      'Eau',   1,   0.23, 24, 5],
  ['E01',      'Écocup (consigne)',     'Consigne', 1, 0.40, '', ''],
];

function reorganiserFichier() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('🧹 Réorganiser le fichier',
    'Le script va :\n' +
    '1. faire une COPIE DE SAUVEGARDE complète du fichier (même dossier) ;\n' +
    '2. déplacer les exports O&B 25-26 (noms, e-mails, téléphones) et Pennylane location dans un fichier d\'archive privé ;\n' +
    '3. créer la nouvelle structure (8 onglets) et supprimer les onglets obsolètes.\n\n' +
    'Durée : 1 à 2 minutes. Continuer ?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { const r = reorganiser_(); ui.alert('✅ Fichier réorganisé\n\n' + r.join('\n')); }
  finally { lock.releaseLock(); }
}

function reorganiser_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), journal = [], get = function (n) { return ss.getSheetByName(n); };
  const fichier = DriveApp.getFileById(ss.getId());
  const date = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm');

  // ── 1. Sauvegarde ───────────────────────────────────────────────────────
  const parents = fichier.getParents(), dossier = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const copie = fichier.makeCopy('SAUVEGARDE ' + ss.getName() + ' — avant réorganisation ' + date, dossier);
  journal.push('💾 Sauvegarde : ' + copie.getUrl());

  // ── 2. Archive privée (créée à la racine de Mon Drive pour ne pas hériter d'un partage de dossier) ──
  const aArchiver = REORG_ARCHIVER.filter(function (n) { const s = get(n); return s && s.getLastRow() > 0; });
  if (aArchiver.length) {
    const arch = SpreadsheetApp.create('ARCHIVE Matchday 25-26 — O&B + Pennylane (données personnelles, ne pas partager)');
    aArchiver.forEach(function (n) { get(n).copyTo(arch).setName(n); });
    const vide = arch.getSheets().filter(function (s) { return aArchiver.indexOf(s.getName()) < 0; });
    vide.forEach(function (s) { arch.deleteSheet(s); });
    try { DriveApp.getFileById(arch.getId()).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) {}
    journal.push('🔒 Archive privée (' + aArchiver.join(', ') + ') : ' + arch.getUrl());
  }

  // ── 3. Saisons ──────────────────────────────────────────────────────────
  let sa = get(ONG.SAISONS) || get('05_SAISONS');
  if (!sa) { sa = ss.insertSheet(ONG.SAISONS); sa.appendRow(['ID_SAISON', 'LIBELLÉ', 'DATE_DEBUT', 'DATE_FIN', 'EQUIPE', 'COMPÉTITION', 'COMMENTAIRE', 'STATUT']); }
  sa.setName(ONG.SAISONS);
  // l'ancien onglet a 2 lignes de titre au-dessus de l'en-tête : on les retire
  while (sa.getLastRow() > 1 && String(sa.getRange(1, 1).getValue()) !== 'ID_SAISON') sa.deleteRow(1);
  const saisons = {}; donnees_(sa).forEach(function (r) { saisons[String(r[0])] = 1; });
  ['2022-2023', '2023-2024', '2024-2025', '2025-2026', '2026-2027'].forEach(function (s) {
    if (saisons[s]) return;
    const a = s.slice(0, 4), b = s.slice(5);
    sa.appendRow([s, 'Saison ' + a + '/' + b, new Date(a + '-08-01'), new Date(b + '-07-31'), "Spacer's Toulouse Volley", 'Ligue A', '', '']);
  });
  const sd = sa.getDataRange().getValues();
  for (let r = 1; r < sd.length; r++) sa.getRange(r + 1, 8).setValue(String(sd[r][0]) === '2026-2027' ? 'EN COURS' : (String(sd[r][0]) > '2026-2027' ? 'À VENIR' : 'HISTORIQUE'));
  sa.getRange(2, 1, sa.getLastRow() - 1, 8).sort(1);
  mettreEnForme_(sa, { dates: [3, 4] });

  // ── 4. MATCHS (fusion 10_MATCHS + 80_KPI_MATCH) ──────────────────────────
  if (!get(ONG.MATCHS)) {
    const m10 = get('10_MATCHS'), k80 = get('80_KPI_MATCH');
    const kpi = {};
    if (k80) { const kh = entete_(k80); donnees_(k80).forEach(function (r) { const o = {}; kh.forEach(function (x, i) { o[x] = r[i]; }); kpi[String(r[kh.indexOf('MATCH')])] = o; }); }
    const lignes = [], parDate = {};
    if (m10) {
      const h = entete_(m10);
      donnees_(m10).forEach(function (r) {
        const g = function (n) { const i = col_(h, n); return i >= 0 ? r[i] : ''; };
        const id = String(g('ID_MATCH') || '').trim();
        if (!id || /^HISTO-/.test(id)) return;
        const k = kpi[id] || {};
        const o = {
          'ID_MATCH': id, 'SAISON': g('SAISON'), 'DATE': g('DATE') ? new Date(g('DATE')) : '', 'ADVERSAIRE': g('ADVERSAIRE'),
          'COMPÉTITION': g('COMPÉTITION') || 'Championnat', 'STATUT': String(g('STATUT') || ''), 'MODE BUVETTE': g('MODE BUVETTE') || 'DIRECT',
          'AFFLUENCE': Number(g('AFFLUENCE')) || Number(k.AFFLUENCE) || '',
          'CA BUVETTE €': Number(k.CA_BUVETTE_OU_LOCATION) || Number(g('CA BUVETTE €')) || '',
          'ACHATS FACTURÉS €': Number(k.ACHATS) || Number(g('ACHATS FACTURÉS €')) || '',
          'CA BILLETTERIE €': Number(k.CA_BILLETTERIE) || '', 'TICKIE_EVENT_ID': g('TICKIE_EVENT_ID'),
        };
        if (o.STATUT === 'OPEN') o.STATUT = '';
        // Même date déjà présente (saisie manuelle + import) : on fusionne
        const dk = jour_(o.DATE);
        if (dk && parDate[dk]) { const p = parDate[dk]; Object.keys(o).forEach(function (x) { if (!p[x] && o[x]) p[x] = o[x]; }); return; }
        if (dk) parDate[dk] = o;
        lignes.push(o);
      });
    }
    const m = ss.insertSheet(ONG.MATCHS);
    m.getRange(1, 1, 1, MCOL.length).setValues([MCOL]);
    if (lignes.length) m.getRange(2, 1, lignes.length, MCOL.length).setValues(lignes.map(function (o) { return ligneMatch_(MCOL, o); }));
    journal.push('📅 MATCHS : ' + lignes.length + ' match(s) repris');
  }
  const m = get(ONG.MATCHS);
  mettreEnForme_(m, { dates: [3], euros: [9, 10, 12, 13, 19, 20, 21, 22], pourcents: [18], entiers: [8, 11, 14, 15, 16, 17], largeurs: { 1: 110, 4: 150, 24: 220 } });
  const idsMatchs = {}; donnees_(m).forEach(function (r) { idsMatchs[String(r[0])] = 1; });
  const regleMatch = SpreadsheetApp.newDataValidation().requireValueInRange(m.getRange('A2:A'), true).setAllowInvalid(false).build();
  m.getRange('B2:B').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(sa.getRange('A2:A'), true).build());
  m.getRange('F2:F').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['À VENIR', 'JOUÉ', 'HISTORIQUE'], true).build());
  m.getRange('G2:G').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['DIRECT', 'LOCATION'], true).build());
  m.getRange(1, 1, 1, MCOL.length).setNote(null);
  m.getRange('H1').setNote('Affluence : remplie par Tickie (entrées scannées, sinon billets + abonnés). Modifiable à la main.');
  m.getRange('I1').setNote('Boissons (et food pour les reportings 22-26), hors consignes. Calculé automatiquement.');
  m.getRange('T1').setNote('CA − coût d\'achat théorique (prix d\'achat de 📦 PRODUITS). Vide si un prix d\'achat manque.');

  // ── 5. Détail des ventes (technique) : purge des lignes de test ─────────
  let vd = get(ONG.DETAIL) || get('50_VENTES_DIRECTES');
  if (vd) {
    vd.setName(ONG.DETAIL);
    pilEnsureVdHeader_();
    const d = vd.getDataRange().getValues(); let purge = 0;
    for (let r = d.length - 1; r >= 1; r--) if (!idsMatchs[String(d[r][0])] || !d[r][3] || String(d[r][3]) === '0') { vd.deleteRow(r + 1); purge++; }
    if (purge) journal.push('🧽 ' + purge + ' ligne(s) de test retirée(s) du détail des ventes');
    mettreEnForme_(vd, { dates: [2], euros: [7, 8, 9, 10] });
  }

  // ── 6. VENTES (tablettes) ───────────────────────────────────────────────
  let lv = get(ONG.VENTES) || get('51_VENTES_LIVE');
  if (!lv) { pilotageInitialiser_sansAlerte_(); lv = get(ONG.VENTES); }
  lv.setName(ONG.VENTES);
  mettreEnForme_(lv, { datesHeures: [1, 2], euros: [6] });

  // ── 7. PRODUITS (remplace 06_STOCKS) ────────────────────────────────────
  if (!get(ONG.PRODUITS)) {
    const p = ss.insertSheet(ONG.PRODUITS);
    p.getRange(1, 1, 1, 8).setValues([['RÉF', 'PRODUIT', 'FAMILLE', 'PRIX VENTE €', 'PRIX ACHAT €', 'COLISAGE', 'SEUIL ALERTE', 'NOTES']]);
    p.getRange(2, 1, PRODUITS_26_27.length, 7).setValues(PRODUITS_26_27);
    p.getRange(2, 8).setValue('Prix d\'achat d\'un fût de 30 L. Rendement : 120 × 25cl ou 60 × 50cl.');
    p.getRange(4, 8).setValue('Même fût que la 25cl.');
    p.getRange('E3:E4').setFontColor('#64778A').setFontStyle('italic');
    mettreEnForme_(p, { euros: [4, 5], entiers: [6, 7], largeurs: { 2: 190, 8: 380 } });
    p.getRange('A2:A').setFontColor('#64778A');
    p.getRange('A1').setNote('Ne pas modifier les références : l\'app et le tableau de bord s\'en servent.');
    p.getRange('D1').setNote('Prix affichés sur les tablettes (pris en compte au prochain chargement du match).');
    p.getRange('F1').setNote('Nombre d\'unités par colis : sert à la commande conseillée du tableau de bord.');
    journal.push('📦 PRODUITS créé : complète les prix d\'achat manquants (fût, Orangina, Ice Tea)');
  }

  // ── 8. ACHATS ───────────────────────────────────────────────────────────
  if (!get(ONG.ACHATS)) {
    const a = ss.insertSheet(ONG.ACHATS), H = ['DATE', 'MATCH', 'FOURNISSEUR', 'DÉTAIL', 'MONTANT HT €', 'N° FACTURE', 'NOTES'];
    a.getRange(1, 1, 1, H.length).setValues([H]);
    const old = get('60_ACHATS_DIRECTS');
    if (old) {
      const oh = entete_(old), rows = donnees_(old).filter(function (r) { return Number(r[col_(oh, 'MONTANT HT €')]) && !/renseigner/i.test(String(r[oh.indexOf('FOURNISSEUR')])); })
        .map(function (r) { return [r[oh.indexOf('DATE')], r[col_(oh, 'MATCH')], r[oh.indexOf('FOURNISSEUR')], r[oh.indexOf('PRODUIT')], r[col_(oh, 'MONTANT HT €')], '', '']; });
      if (rows.length) a.getRange(2, 1, rows.length, H.length).setValues(rows);
    }
  }
  const ach = get(ONG.ACHATS);
  mettreEnForme_(ach, { dates: [1], euros: [5], largeurs: { 3: 160, 4: 240, 7: 240 } });
  ach.getRange('B2:B').setDataValidation(regleMatch);

  // ── 9. FOODTRUCKS ───────────────────────────────────────────────────────
  if (!get(ONG.FOODTRUCKS)) {
    const f = ss.insertSheet(ONG.FOODTRUCKS), H = ['MATCH', 'FOODTRUCK', 'FORMULE', 'FORFAIT €', '% DU CA', 'CA DÉCLARÉ €', 'MONTANT DÛ €', 'PAYÉ', 'CONTACT', 'NOTES'];
    f.getRange(1, 1, 1, H.length).setValues([H]);
    const old = get('70_FOODTRUCKS');
    if (old) {
      const oh = entete_(old);
      const rows = donnees_(old).filter(function (r) { return r[oh.indexOf('FOODTRUCK')] && !/exemple/i.test(String(r[oh.indexOf('FOODTRUCK')])); })
        .map(function (r) {
          const fix = Number(r[oh.indexOf('LOYER_FIXE')]) || 0, pc = Number(r[oh.indexOf('POURCENT_CA')]) || 0;
          return [r[oh.indexOf('MATCH')], r[oh.indexOf('FOODTRUCK')], fix && pc ? 'Forfait + %' : fix ? 'Forfait' : pc ? '% du CA' : 'Gratuit', fix || '', pc > 1 ? pc / 100 : pc || '', '', '', false, '', ''];
        });
      if (rows.length) f.getRange(2, 1, rows.length, H.length).setValues(rows);
    }
  }
  const ft = get(ONG.FOODTRUCKS);
  mettreEnForme_(ft, { euros: [4, 6, 7], pourcents: [5], largeurs: { 2: 170, 3: 120, 9: 180, 10: 240 } });
  ft.getRange('A2:A').setDataValidation(regleMatch);
  ft.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Gratuit', 'Forfait', '% du CA', 'Forfait + %'], true).build());
  ft.getRange('H2:H300').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  // Montant dû calculé : gratuit = 0 ; forfait ; % du CA déclaré ; ou les deux
  ft.getRange('G2').setFormula(f_('=ARRAYFORMULA(IF(B2:B="","",IF(C2:C="Gratuit",0,IF(REGEXMATCH(C2:C&"","Forfait"),D2:D,0)+IF(REGEXMATCH(C2:C&"","%"),E2:E*F2:F,0))))'));
  ft.getRange('G2:G').setBackground(DAY_SOFT);
  ft.getRange('G1').setNote('Calculé automatiquement selon la formule : ne pas saisir.');
  ft.getRange('F1').setNote('À remplir après le match pour les foodtrucks au pourcentage.');

  // ── 10. FIDÉLITÉ ────────────────────────────────────────────────────────
  const fi = get(ONG.FIDELITE) || get('90_FIDELITE');
  if (fi) {
    fi.setName(ONG.FIDELITE);
    fi.getRange(1, 1, 1, 9).setValues([['E-MAIL (identifiant)', 'NOM', 'POINTS DISPONIBLES', 'POINTS CUMULÉS', 'VISITES', 'DÉPENSE €', 'NIVEAU', 'DERNIER MATCH', 'MIS À JOUR']]);
    mettreEnForme_(fi, { euros: [6], datesHeures: [9], largeurs: { 1: 230, 2: 170 } });
  }
  const fl = get(ONG.FID_LOG) || get('91_FIDELITE_LOG');
  if (fl) { fl.setName(ONG.FID_LOG); mettreEnForme_(fl, { euros: [6] }); }

  // ── 11. ACCUEIL + TABLEAU DE BORD ───────────────────────────────────────
  const ancienPilot = get('PILOTAGE');
  let actif = '';
  if (ancienPilot) {
    actif = String(ancienPilot.getRange('B9').getValue() || '').trim();
    try { pilUrlWebApp_(); } catch (e) {}          // mémorise l'URL /exec avant suppression
  }
  construireTableauDeBord_();
  construireAccueil_(actif);
  formulesProduits_();

  // ── 12. Suppression des onglets obsolètes ───────────────────────────────
  const supprimes = [];
  REORG_SUPPRIMER.forEach(function (n) { const s = get(n); if (s) { ss.deleteSheet(s); supprimes.push(n); } });
  if (supprimes.length) journal.push('🗑️ Onglets retirés : ' + supprimes.join(', '));

  // ── 13. Ordre, couleurs, onglets techniques masqués ─────────────────────
  ONG_ORDRE.forEach(function (k, i) {
    const s = get(ONG[k]); if (!s) return;
    ss.setActiveSheet(s); ss.moveActiveSheet(i + 1);
    s.setTabColor(ONG_TECHNIQUES.indexOf(k) >= 0 ? '#9AA7B5' : (k === 'ACCUEIL' || k === 'TDB' ? NIGHT : DAY));
  });
  // Onglets inconnus (créés à la main) : laissés en fin de liste, signalés
  const autres = ss.getSheets().map(function (s) { return s.getName(); }).filter(function (n) { return ONG_ORDRE.every(function (k) { return ONG[k] !== n; }); });
  if (autres.length) journal.push('ℹ️ Onglets non reconnus laissés en place : ' + autres.join(', '));
  masquerOngletsTechniques();
  ss.setActiveSheet(get(ONG.ACCUEIL));

  majMatchs(true);
  journal.push('🔄 Indicateurs des matchs recalculés');
  return journal;
}

// Initialisation de 🧾 VENTES si le pilotage n'a jamais été lancé
function pilotageInitialiser_sansAlerte_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.insertSheet(ONG.VENTES);
  const head = PIL_LIVE_COLS.concat(PIL.PRODUITS.map(function (p) { return p[1]; })).concat(['Paiement']);
  sh.getRange(1, 1, 1, head.length).setValues([head]);
}

// Formules de 📦 PRODUITS (coût d'un verre depuis le prix du fût, 5 % de perte) et de 🚚 FOODTRUCKS
function formulesProduits_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), p = ss.getSheetByName(ONG.PRODUITS);
  if (p) {
    const refs = p.getRange('A1:A20').getValues().map(function (r) { return String(r[0]); });
    const lf = refs.indexOf('FUT') + 1;
    [['P01_25', 0.25], ['P01_50', 0.5]].forEach(function (x) {
      const l = refs.indexOf(x[0]) + 1;
      if (lf && l) p.getRange(l, 5).setFormula(f_('=IF($E$' + lf + '="","",ROUND($E$' + lf + '/30/0.95*' + x[1] + ',2))'));
    });
  }
  const ft = ss.getSheetByName(ONG.FOODTRUCKS);
  if (ft) ft.getRange('G2').setFormula(f_('=ARRAYFORMULA(IF(B2:B="","",IF(C2:C="Gratuit",0,IF(REGEXMATCH(C2:C&"","Forfait"),D2:D,0)+IF(REGEXMATCH(C2:C&"","%"),E2:E*F2:F,0))))'));
}

// Menu 🛠️ : reconstruit les formules (tableau de bord, accueil, produits, foodtrucks) sans toucher aux données
function reparerFormules() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const actif = ss.getRangeByName('MATCH_ACTIF') ? String(ss.getRangeByName('MATCH_ACTIF').getValue() || '') : '';
  construireTableauDeBord_();
  construireAccueil_(actif);
  formulesProduits_();
  const t = ss.getSheetByName(ONG.TDB); if (t) { ss.setActiveSheet(t); ss.moveActiveSheet(2); }
  const a = ss.getSheetByName(ONG.ACCUEIL); if (a) { ss.setActiveSheet(a); ss.moveActiveSheet(1); }
  alerte_('✅ Formules reconstruites (langue du fichier : ' + ss.getSpreadsheetLocale() + ').');
}

// ── Mise en forme commune : en-tête charte, figé, filtre, formats ─────────
function mettreEnForme_(sh, o) {
  o = o || {};
  const nc = Math.max(sh.getLastColumn(), 1), nr = Math.max(sh.getMaxRows() - 1, 1);
  styleEntete_(sh.getRange(1, 1, 1, nc)).setWrap(true);
  sh.setRowHeight(1, 36);
  sh.setFrozenRows(1);
  if (sh.getMaxColumns() >= 2 && (o.figerCol !== false)) sh.setFrozenColumns(1);
  const fmt = function (cols, f) { (cols || []).forEach(function (c) { if (c <= nc) sh.getRange(2, c, nr, 1).setNumberFormat(f); }); };
  fmt(o.dates, 'dd/mm/yyyy'); fmt(o.datesHeures, 'dd/mm/yyyy HH:mm'); fmt(o.euros, '#,##0.00 €'); fmt(o.pourcents, '0%'); fmt(o.entiers, '#,##0');
  if (!sh.getFilter() && sh.getLastRow() >= 1) sh.getRange(1, 1, Math.max(sh.getLastRow(), 2), nc).createFilter();
  sh.autoResizeColumns(1, nc);
  Object.keys(o.largeurs || {}).forEach(function (c) { if (Number(c) <= nc) sh.setColumnWidth(Number(c), o.largeurs[c]); });
  for (let c = 1; c <= nc; c++) if (sh.getColumnWidth(c) < 90) sh.setColumnWidth(c, 90);
}

// ═══════════════════════════════════════════════════════════════════════════
// 🏠 ACCUEIL
// ═══════════════════════════════════════════════════════════════════════════
function construireAccueil_(matchActif) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ONG.ACCUEIL);
  const garde = sh && ss.getRangeByName('MATCH_ACTIF') ? String(ss.getRangeByName('MATCH_ACTIF').getValue() || '') : '';
  if (!sh) sh = ss.insertSheet(ONG.ACCUEIL); else sh.clear();
  sh.setHiddenGridlines(true);
  const url = PropertiesService.getScriptProperties().getProperty('PIL_WEBAPP_URL') || '';
  const lien = function (cle, txt) { const s = ss.getSheetByName(ONG[cle]); return s ? '=HYPERLINK("#gid=' + s.getSheetId() + '","' + txt + '")' : txt; };
  const L = [
    ["SPACER'S TOULOUSE VOLLEY — MATCHDAY BUSINESS", '', ''],
    ['Buvette, billetterie Tickie et fidélité · tout se remplit automatiquement depuis les tablettes et Tickie', '', ''],
    ['', '', ''],
    ['Match actif (préparé au tableau de bord)', matchActif || garde, ''],
    ['Indicateurs des matchs mis à jour le', '', ''],
    ['', '', ''],
    ['OÙ TROUVER QUOI', 'À QUOI ÇA SERT', 'QUI LE REMPLIT'],
    [lien('TDB', '📊 TABLEAU DE BORD'), 'Choisir une saison : chiffres clés, comparaison avec les saisons passées, liste des matchs', 'Automatique'],
    [lien('MATCHS', '📅 MATCHS'), 'Une ligne par match (22-23 → aujourd\'hui) : affluence, CA, €/spectateur, panier, marge… Utiliser le filtre pour chercher', 'Automatique (affluence et notes modifiables)'],
    [lien('VENTES', '🧾 VENTES'), 'Chaque vente des tablettes : heure, buvette, paiement CB/espèces, billet scanné, produits', 'Automatique (tablettes)'],
    [lien('PRODUITS', '📦 PRODUITS'), 'Prix de vente (affichés sur les tablettes), prix d\'achat, colisage, seuils d\'alerte', 'Toi, en début de saison'],
    [lien('ACHATS', '🛒 ACHATS'), 'Factures fournisseurs, rattachées à un match : alimentent la marge', 'Toi, à réception des factures'],
    [lien('FOODTRUCKS', '🚚 FOODTRUCKS'), 'Foodtrucks présents par match, formule (gratuit / forfait / % du CA) et montant dû', 'Toi, selon le calendrier'],
    [lien('FIDELITE', '⭐ FIDÉLITÉ'), 'Points fidélité des spectateurs qui ont scanné leur billet à la buvette', 'Automatique (toutes les 10 min)'],
    ['', '', ''],
    ['MENU 🏐 MATCHDAY', '', ''],
    ['📡 Pilotage live → Ouvrir le tableau de bord', 'Tableau de bord en direct, préparation du stock, QR codes des tablettes', ''],
    ['🔄 Mettre à jour les matchs', 'Recalcule 📅 MATCHS (fait aussi automatiquement toutes les 10 min)', ''],
    ['🔎 Vérifier le fichier', 'Signale ce qui manque : affluences, prix d\'achat, clé Tickie…', ''],
    ['🗓️ Créer une nouvelle saison', 'En juillet, pour préparer la saison suivante', ''],
    ['', '', ''],
    ['Onglets techniques masqués (⚙️) : saisons, détail des ventes ligne par ligne, journal fidélité. Menu → ⚙️ Onglets techniques → Afficher.', '', ''],
    ['URL de l\'application web (ne pas modifier)', url, ''],
  ];
  sh.getRange(1, 1, L.length, 3).setValues(L.map(function (r) { return r.map(function (v) { return String(v).indexOf('=') === 0 ? '' : v; }); }));
  // Liens (formules)
  L.forEach(function (r, i) { if (String(r[0]).indexOf('=HYPERLINK') === 0) sh.getRange(i + 1, 1).setFormula(f_(r[0])); });
  sh.setColumnWidth(1, 330); sh.setColumnWidth(2, 640); sh.setColumnWidth(3, 260);
  sh.getRange('A1:C1').merge().setBackground(NIGHT).setFontColor(DAY).setFontSize(18).setFontWeight('bold');
  sh.setRowHeight(1, 46);
  sh.getRange('A2:C2').merge().setBackground(NIGHT).setFontColor(WHITE).setFontSize(10);
  sh.getRange('A4:A5').setFontWeight('bold');
  sh.getRange('B4').setBackground(DAY_SOFT).setFontWeight('bold').setFontSize(12);
  sh.getRange('B5').setNumberFormat('dd/mm/yyyy HH:mm').setFontColor('#33495A');
  ss.setNamedRange('MATCH_ACTIF', sh.getRange('B4'));
  ss.setNamedRange('MAJ_MATCHS', sh.getRange('B5'));
  styleEntete_(sh.getRange('A7:C7'));
  sh.getRange('A8:C14').setWrap(true).setVerticalAlignment('middle');
  sh.getRange('A8:A14').setFontWeight('bold').setFontSize(11);
  for (let r = 8; r <= 14; r++) sh.getRange(r, 1, 1, 3).setBackground(r % 2 ? WHITE : DAY_SOFT);
  styleEntete_(sh.getRange('A16:C16'));
  sh.getRange('A17:A20').setFontWeight('bold');
  sh.getRange('A22:C22').merge().setFontColor('#64778A').setFontStyle('italic');
  sh.getRange('A23:C23').setFontColor('#9AA7B5').setFontSize(8);
  return sh;
}

// ═══════════════════════════════════════════════════════════════════════════
// 📊 TABLEAU DE BORD (formules : se met à jour tout seul, saison au choix en B4)
// ═══════════════════════════════════════════════════════════════════════════
function construireTableauDeBord_(saisonForcee) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ONG.TDB);
  const ancienne = sh ? String(sh.getRange('B4').getValue() || '') : '';
  if (!sh) sh = ss.insertSheet(ONG.TDB); else { sh.getCharts().forEach(function (c) { sh.removeChart(c); }); sh.clear(); sh.getRange('A:Z').clearDataValidations(); }
  sh.setHiddenGridlines(true);
  const sa = feuille_('SAISONS');
  const liste = donnees_(sa).map(function (r) { return String(r[0]); }).filter(Boolean).sort();
  const enCours = (donnees_(sa).filter(function (r) { return String(r[7]) === 'EN COURS'; })[0] || [liste[liste.length - 1]])[0];
  const saison = saisonForcee || ancienne || enCours;
  const M = "'" + ONG.MATCHS + "'!";
  const S = function (lettre) { return M + lettre + '2:' + lettre; };
  const cond = S('B') + ',$B$4';

  sh.getRange('A1').setValue('TABLEAU DE BORD BUVETTE');
  sh.getRange('A2').setValue('Choisis la saison en B4 : tout se recalcule. Données issues de 📅 MATCHS.');
  sh.getRange('A4').setValue('SAISON');
  sh.getRange('B4').setValue(saison).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(liste, true).build());

  const kpis = [
    ['MATCHS JOUÉS', '=COUNTIFS(' + cond + ',' + S('I') + ',">0")', '0'],
    ['AFFLUENCE MOYENNE', '=IFERROR(AVERAGEIFS(' + S('H') + ',' + cond + ',' + S('H') + ',">0"),"—")', '#,##0'],
    ['CA BUVETTE', '=SUMIFS(' + S('I') + ',' + cond + ')', '#,##0 €'],
    ['CA MOYEN / MATCH', '=IFERROR(C7/A7,"—")', '#,##0 €'],
    ['€ / SPECTATEUR', '=IFERROR(SUMIFS(' + S('I') + ',' + cond + ',' + S('H') + ',">0")/SUMIFS(' + S('H') + ',' + cond + ',' + S('I') + ',">0"),"—")', '0.00 €'],
    ['PANIER MOYEN', '=IFERROR(SUMIFS(' + S('I') + ',' + cond + ',' + S('K') + ',">0")/SUMIFS(' + S('K') + ',' + cond + '),"—")', '0.00 €'],
    ['MARGE ESTIMÉE', '=IF(SUMIFS(' + S('T') + ',' + cond + ')=0,"—",SUMIFS(' + S('T') + ',' + cond + '))', '#,##0 €'],
    ['FOODTRUCKS', '=SUMIFS(' + S('U') + ',' + cond + ')', '#,##0 €'],
  ];
  kpis.forEach(function (k, i) {
    sh.getRange(6, i + 1).setValue(k[0]);
    sh.getRange(7, i + 1).setFormula(f_(k[1])).setNumberFormat(k[2]);
  });
  styleEntete_(sh.getRange(6, 1, 1, 8)).setFontSize(9).setHorizontalAlignment('center').setWrap(true);
  sh.getRange(7, 1, 1, 8).setFontSize(20).setFontWeight('bold').setHorizontalAlignment('center').setBackground(DAY_SOFT).setFontColor(NIGHT);
  sh.setRowHeight(7, 52);

  // Comparaison des saisons
  const r0 = 9;
  sh.getRange(r0, 1).setValue('COMPARAISON DES SAISONS');
  const ent = ['SAISON', 'MATCHS', 'AFFLUENCE MOY.', 'CA BUVETTE', 'CA / MATCH', '€ / SPECTATEUR', 'PANIER MOYEN', 'ÉVOLUTION CA / MATCH'];
  sh.getRange(r0 + 1, 1, 1, ent.length).setValues([ent]);
  styleEntete_(sh.getRange(r0 + 1, 1, 1, ent.length)).setFontSize(9).setHorizontalAlignment('center');
  liste.forEach(function (s, i) {
    const r = r0 + 2 + i, c = S('B') + ',$A' + r;
    sh.getRange(r, 1).setValue(s);
    sh.getRange(r, 2, 1, 7).setFormulas([[
      '=COUNTIFS(' + c + ',' + S('I') + ',">0")',
      '=IFERROR(AVERAGEIFS(' + S('H') + ',' + c + ',' + S('H') + ',">0"),"—")',
      '=SUMIFS(' + S('I') + ',' + c + ')',
      '=IFERROR(D' + r + '/B' + r + ',"—")',
      '=IFERROR(SUMIFS(' + S('I') + ',' + c + ',' + S('H') + ',">0")/SUMIFS(' + S('H') + ',' + c + ',' + S('I') + ',">0"),"—")',
      '=IFERROR(SUMIFS(' + S('I') + ',' + c + ',' + S('K') + ',">0")/SUMIFS(' + S('K') + ',' + c + '),"—")',
      i === 0 ? '="—"' : '=IFERROR(E' + r + '/E' + (r - 1) + '-1,"—")',
    ].map(f_)]);
    sh.getRange(r, 1, 1, 8).setBackground(i % 2 ? DAY_SOFT : WHITE);
  });
  const r1 = r0 + 2, n = liste.length;
  sh.getRange(r1, 3, n, 1).setNumberFormat('#,##0');
  sh.getRange(r1, 4, n, 2).setNumberFormat('#,##0 €');
  sh.getRange(r1, 6, n, 2).setNumberFormat('0.00 €');
  sh.getRange(r1, 8, n, 1).setNumberFormat('+0%;-0%;0%');
  sh.getRange(r1, 1, n, 1).setFontWeight('bold');
  // Saison sélectionnée surlignée
  const regle = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$A' + r1 + '=$B$4')
    .setBackground(DAY).setBold(true).setRanges([sh.getRange(r1, 1, n, 8)]).build();
  const vert = SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor('#157A2E').setRanges([sh.getRange(r1, 8, n, 1)]).build();
  const rouge = SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor('#C0262D').setRanges([sh.getRange(r1, 8, n, 1)]).build();
  sh.setConditionalFormatRules([regle, vert, rouge]);

  // Matchs de la saison
  const r2 = r1 + n + 2;
  sh.getRange(r2, 1).setValue('MATCHS DE LA SAISON');
  sh.getRange(r2 + 1, 1).setFormula(f_('=IFERROR(QUERY(' + M + 'A1:V,"select C, D, E, H, I, M, L, K, R, U where B = \'"&$B$4&"\' order by C",1),"Aucun match pour cette saison")'));
  styleEntete_(sh.getRange(r2 + 1, 1, 1, 10)).setFontSize(9).setWrap(true);
  sh.getRange(r2 + 2, 1, 60, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(r2 + 2, 4, 60, 1).setNumberFormat('#,##0');
  sh.getRange(r2 + 2, 5, 60, 1).setNumberFormat('#,##0 €');
  sh.getRange(r2 + 2, 6, 60, 2).setNumberFormat('0.00 €');
  sh.getRange(r2 + 2, 9, 60, 1).setNumberFormat('0%');
  sh.getRange(r2 + 2, 10, 60, 1).setNumberFormat('#,##0 €');

  [1, r0, r2].forEach(function (r) { sh.getRange(r, 1).setFontWeight('bold').setFontColor(NIGHT).setFontSize(r === 1 ? 18 : 12); });
  sh.getRange('A1:H1').setBackground(NIGHT); sh.getRange('A1').setFontColor(DAY);
  sh.setRowHeight(1, 44);
  sh.getRange('A2').setFontColor('#64778A').setFontStyle('italic');
  sh.getRange('A4').setFontWeight('bold');
  sh.getRange('B4').setBackground(DAY).setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  for (let c = 1; c <= 10; c++) sh.setColumnWidth(c, c === 2 ? 150 : 125);

  // Graphique : CA buvette par match (saison choisie)
  const ch = sh.newChart().asColumnChart()
    .addRange(sh.getRange(r2 + 1, 2, 41, 1)).addRange(sh.getRange(r2 + 1, 5, 41, 1))
    .setNumHeaders(1).setPosition(r0, 10, 0, 0)
    .setOption('title', 'CA buvette par match').setOption('legend', { position: 'none' })
    .setOption('colors', [NIGHT]).setOption('width', 620).setOption('height', 300)
    .build();
  sh.insertChart(ch);
  return sh;
}
