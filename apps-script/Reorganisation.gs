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

// Catalogue 26-27 : réf, produit, famille, prix vente TTC, prix achat HT (unité ; FUT = fût 30 L), TVA, colisage, seuil
const PRODUITS_ENTETE = ['RÉF', 'PRODUIT', 'FAMILLE', 'PRIX VENTE €', 'PRIX ACHAT €', 'TVA', 'COLISAGE', 'SEUIL ALERTE', 'NOTES'];
const PRODUITS_26_27 = [
  ['FUT',      'Bière — fût 30 L',      'Bière', '',  '',   0.2, 1,  ''],
  ['P01_25',   'Bière 25cl',            'Bière', 3,   '',   0.2, '', 15],
  ['P01_50',   'Bière 50cl',            'Bière', 6,   '',   0.2, '', 10],
  ['P02_COCA', 'Coca-Cola',             'Soft',  3,   0.72, 0.1, 24, 5],
  ['P02_ORAN', 'Orangina',              'Soft',  3,   '',   0.1, 24, 5],
  ['P02_ICET', 'Ice Tea',               'Soft',  3,   '',   0.1, 24, 5],
  ['P02_SCHW', 'Schweppes Agrumes',     'Soft',  3,   0.61, 0.1, 24, 5],
  ['P03',      'Eau plate 50cl',        'Eau',   1,   0.21, 0.1, 24, 5],
  ['P04',      'Eau gazeuse 50cl',      'Eau',   1,   0.23, 0.1, 24, 5],
  ['E01',      'Écocup (consigne)',     'Consigne', 1, 0.40, 0, '', ''],
];
const ACHATS_ENTETE = ['DATE', 'SOURCE', 'LIBELLÉ', 'COMPTE', 'MONTANT HT €', 'SAISON', 'MOIS', 'PIÈCE', 'ID PENNYLANE'];

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
  migrerColonnesMatchs_(m);
  formaterMatchs_(m);
  const idsMatchs = {}; donnees_(m).forEach(function (r) { idsMatchs[String(r[0])] = 1; });
  const regleMatch = SpreadsheetApp.newDataValidation().requireValueInRange(m.getRange('A2:A'), true).setAllowInvalid(false).build();
  const plage = function (n) { return m.getRange(lettre_(n) + '2:' + lettre_(n)); };
  plage('SAISON').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(sa.getRange('A2:A'), true).build());
  plage('STATUT').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['À VENIR', 'JOUÉ', 'HISTORIQUE'], true).build());
  plage('MODE BUVETTE').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['DIRECT', 'LOCATION'], true).build());

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
    p.getRange(1, 1, 1, PRODUITS_ENTETE.length).setValues([PRODUITS_ENTETE]);
    p.getRange(2, 1, PRODUITS_26_27.length, 8).setValues(PRODUITS_26_27);
    p.getRange(2, 9).setValue('Prix d\'achat HT d\'un fût de 30 L. Rendement : 120 × 25cl ou 60 × 50cl.');
    p.getRange(4, 9).setValue('Même fût que la 25cl.');
    journal.push('📦 PRODUITS créé : complète les prix d\'achat manquants (fût, Orangina, Ice Tea)');
  }

  // ── 8. ACHATS (miroir de Pennylane, compte 607100000) ───────────────────
  if (!get(ONG.ACHATS)) {
    const a = ss.insertSheet(ONG.ACHATS);
    a.getRange(1, 1, 1, ACHATS_ENTETE.length).setValues([ACHATS_ENTETE]);
    const old = get('60_ACHATS_DIRECTS');
    if (old) {
      const oh = entete_(old), rows = donnees_(old).filter(function (r) { return Number(r[col_(oh, 'MONTANT HT €')]) && !/renseigner/i.test(String(r[oh.indexOf('FOURNISSEUR')])); })
        .map(function (r) { const d = r[oh.indexOf('DATE')]; return [d, 'Saisie', r[oh.indexOf('FOURNISSEUR')] + ' — ' + r[oh.indexOf('PRODUIT')], '', r[col_(oh, 'MONTANT HT €')], saisonDe_(d), d ? Utilities.formatDate(new Date(d), tz_(), 'yyyy-MM') : '', '', '']; });
      if (rows.length) a.getRange(2, 1, rows.length, ACHATS_ENTETE.length).setValues(rows);
    }
  }
  assurerStructure_(true);

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
  assurerStructure_(true);
  const m = feuille_('MATCHS'); if (m) { migrerColonnesMatchs_(m); formaterMatchs_(m); }
  construireTableauDeBord_();
  construireAccueil_(actif);
  formulesProduits_();
  try { majMatchs(true); } catch (e) {}
  const t = ss.getSheetByName(ONG.TDB); if (t) { ss.setActiveSheet(t); ss.moveActiveSheet(2); }
  const a = ss.getSheetByName(ONG.ACCUEIL); if (a) { ss.setActiveSheet(a); ss.moveActiveSheet(1); }
  masquerOngletsTechniques();
  alerte_('✅ Formules reconstruites (langue du fichier : ' + ss.getSpreadsheetLocale() + ').');
}

// Structure V14 : colonne TVA dans 📦 PRODUITS, 🛒 ACHATS au format Pennylane (appelé aussi par majMatchs)
function assurerStructure_(forcer) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const p = ss.getSheetByName(ONG.PRODUITS);
  if (p) {
    let h = entete_(p), ajout = false;
    if (h.indexOf('TVA') < 0) {
      ajout = true;
      const iA = h.indexOf('PRIX ACHAT €') + 1;
      p.insertColumnAfter(iA);
      p.getRange(1, iA + 1).setValue('TVA');
      const d = donnees_(p), iF = h.indexOf('FAMILLE');
      if (d.length) p.getRange(2, iA + 1, d.length, 1).setValues(d.map(function (r) { return [/bi[eè]re/i.test(String(r[iF])) ? 0.2 : /consigne/i.test(String(r[iF])) ? 0 : 0.1]; }));
      h = entete_(p);
    }
    const ix = function (n) { return h.indexOf(n) + 1; };
    if (ajout || forcer) {
    mettreEnForme_(p, { euros: [ix('PRIX VENTE €'), ix('PRIX ACHAT €')], pourcents: [ix('TVA')], entiers: [ix('COLISAGE'), ix('SEUIL ALERTE')], largeurs: (function () { const o = {}; o[ix('PRODUIT')] = 190; o[ix('NOTES')] = 380; return o; })() });
    p.getRange('A2:A').setFontColor('#64778A');
    p.getRange(1, ix('RÉF')).setNote('Ne pas modifier les références : l\'app et le tableau de bord s\'en servent.');
    p.getRange(1, ix('PRIX VENTE €')).setNote('Prix TTC affichés sur les tablettes (pris en compte au prochain chargement du match).');
    p.getRange(1, ix('PRIX ACHAT €')).setNote('Prix d\'achat HT à l\'unité (FUT : le fût de 30 L). Sert au coût matière et à la marge.');
    p.getRange(1, ix('TVA')).setNote('Taux de TVA à la vente : 20 % alcool, 10 % softs et eaux consommés sur place.');
    p.getRange(1, ix('COLISAGE')).setNote('Nombre d\'unités par colis : sert à la commande conseillée du tableau de bord.');
    }
  }
  const a = ss.getSheetByName(ONG.ACHATS);
  if (a) {
    const h = entete_(a);
    if (h.join('|') !== ACHATS_ENTETE.join('|')) {
      // ancien format (DATE, MATCH, FOURNISSEUR, DÉTAIL, MONTANT HT €, N° FACTURE, NOTES) → format Pennylane
      const rows = donnees_(a).filter(function (r) { return r.some(function (v) { return v !== '' && v !== null; }); }).map(function (r) {
        const g = function (n) { const i = col_(h, n); return i >= 0 ? r[i] : ''; };
        const d = g('DATE');
        return [d, g('SOURCE') || 'Saisie', g('LIBELLÉ') || [g('FOURNISSEUR'), g('DÉTAIL')].filter(String).join(' — '), g('COMPTE'), g('MONTANT HT €'),
          g('SAISON') || saisonDe_(d), g('MOIS') || (d ? Utilities.formatDate(new Date(d), tz_(), 'yyyy-MM') : ''), g('PIÈCE') || g('N° FACTURE'), g('ID PENNYLANE')];
      });
      if (a.getFilter()) a.getFilter().remove();
      a.getRange(1, 1, Math.max(a.getLastRow(), 1), Math.max(a.getLastColumn(), ACHATS_ENTETE.length)).clearContent().clearDataValidations();
      a.getRange(1, 1, 1, ACHATS_ENTETE.length).setValues([ACHATS_ENTETE]);
      if (rows.length) a.getRange(2, 1, rows.length, ACHATS_ENTETE.length).setValues(rows);
      mettreEnForme_(a, { dates: [1], euros: [5], largeurs: { 3: 340, 8: 200 } });
      a.getRange('A1').setNote('Alimenté automatiquement par Pennylane (compte 607100000, achats buvette). Ne pas saisir ici : Pennylane reste la seule source des factures.');
    }
  }
}
function saisonDe_(d) {
  if (!d) return '';
  const j = jour_(d), sa = feuille_('SAISONS'); if (!sa) return '';
  const r = donnees_(sa).filter(function (x) { return x[2] instanceof Date && x[3] instanceof Date && j >= jour_(x[2]) && j <= jour_(x[3]); })[0];
  return r ? String(r[0]) : '';
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
    [lien('MATCHS', '📅 MATCHS'), 'Une ligne par match (22-23 → aujourd\'hui) : affluence, CA TTC/HT, coût matière, casse, conso bénévoles, marge HT, écarts de caisse… Filtre pour chercher', 'Automatique (affluence et notes modifiables)'],
    [lien('VENTES', '🧾 VENTES'), 'Chaque vente des tablettes : heure, buvette, paiement CB/espèces, billet scanné, produits', 'Automatique (tablettes)'],
    [lien('PRODUITS', '📦 PRODUITS'), 'Prix de vente TTC (affichés sur les tablettes), prix d\'achat HT, TVA, colisage, seuils d\'alerte', 'Toi, en début de saison et à chaque changement de tarif'],
    [lien('ACHATS', '🛒 ACHATS'), 'Achats buvette de Pennylane (compte 607100000), rapprochés de la consommation dans le tableau de bord', 'Automatique (Pennylane, toutes les 6 h)'],
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
  const stockDebut = ss.getRangeByName('STOCK_DEBUT') ? ss.getRangeByName('STOCK_DEBUT').getValue() : '';
  if (!sh) sh = ss.insertSheet(ONG.TDB); else { sh.getCharts().forEach(function (c) { sh.removeChart(c); }); sh.clear(); sh.getRange('A:Z').clearDataValidations(); }
  sh.setHiddenGridlines(true);
  const sa = feuille_('SAISONS');
  const liste = donnees_(sa).map(function (r) { return String(r[0]); }).filter(Boolean).sort();
  const enCours = (donnees_(sa).filter(function (r) { return String(r[7]) === 'EN COURS'; })[0] || [liste[liste.length - 1]])[0];
  const saison = saisonForcee || ancienne || enCours;
  const M = "'" + ONG.MATCHS + "'!", AC = "'" + ONG.ACHATS + "'!";
  const S = function (nom) { const l = lettre_(nom); return M + l + '2:' + l; };
  const cond = S('SAISON') + ',$B$4';
  const titre = function (r, t) { sh.getRange(r, 1).setValue(t).setFontWeight('bold').setFontColor(NIGHT).setFontSize(12); };

  sh.getRange('A1').setValue('TABLEAU DE BORD BUVETTE');
  sh.getRange('A2').setValue('Choisis la saison en B4 : tout se recalcule. Marges disponibles à partir de 26-27 (tablettes + inventaires).');
  sh.getRange('A4').setValue('SAISON');
  sh.getRange('B4').setValue(saison).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(liste, true).build());

  const bloc = function (ligne, kpis) {
    kpis.forEach(function (k, i) {
      sh.getRange(ligne, i + 1).setValue(k[0]);
      sh.getRange(ligne + 1, i + 1).setFormula(f_(k[1])).setNumberFormat(k[2]);
    });
    styleEntete_(sh.getRange(ligne, 1, 1, kpis.length)).setFontSize(9).setHorizontalAlignment('center').setWrap(true);
    sh.getRange(ligne + 1, 1, 1, kpis.length).setFontSize(18).setFontWeight('bold').setHorizontalAlignment('center').setBackground(DAY_SOFT).setFontColor(NIGHT);
    sh.setRowHeight(ligne + 1, 46);
  };
  const avecMarge = S('MARGE HT €') + ',"<>"';
  bloc(6, [
    ['MATCHS JOUÉS', '=COUNTIFS(' + cond + ',' + S('CA BUVETTE €') + ',">0")', '0'],
    ['AFFLUENCE MOYENNE', '=IFERROR(AVERAGEIFS(' + S('AFFLUENCE') + ',' + cond + ',' + S('AFFLUENCE') + ',">0",' + S('CA BUVETTE €') + ',">0"),"—")', '#,##0'],
    ['CA TTC', '=SUMIFS(' + S('CA BUVETTE €') + ',' + cond + ')', '#,##0 €'],
    ['CA HT', '=SUMIFS(' + S('CA HT €') + ',' + cond + ')', '#,##0 €'],
    ['MARGE HT', '=IF(COUNTIFS(' + cond + ',' + avecMarge + ')=0,"—",SUMIFS(' + S('MARGE HT €') + ',' + cond + '))', '#,##0 €'],
    ['TAUX DE MARGE', '=IFERROR(SUMIFS(' + S('MARGE HT €') + ',' + cond + ')/SUMIFS(' + S('CA HT €') + ',' + cond + ',' + avecMarge + '),"—")', '0%'],
    ['MARGE / SPECTATEUR', '=IFERROR(SUMIFS(' + S('MARGE HT €') + ',' + cond + ',' + S('AFFLUENCE') + ',">0")/SUMIFS(' + S('AFFLUENCE') + ',' + cond + ',' + avecMarge + '),"—")', '0.00 €'],
    ['CASSE & ÉCARTS', '=SUMIFS(' + S('CASSE / ÉCARTS €') + ',' + cond + ')', '#,##0 €'],
  ]);
  bloc(9, [
    ['€ / SPECTATEUR (CA)', '=IFERROR(SUMIFS(' + S('CA BUVETTE €') + ',' + cond + ',' + S('AFFLUENCE') + ',">0")/SUMIFS(' + S('AFFLUENCE') + ',' + cond + ',' + S('CA BUVETTE €') + ',">0"),"—")', '0.00 €'],
    ['PANIER MOYEN', '=IFERROR(SUMIFS(' + S('CA BUVETTE €') + ',' + cond + ',' + S('NB VENTES') + ',">0")/SUMIFS(' + S('NB VENTES') + ',' + cond + '),"—")', '0.00 €'],
    ['COÛT MATIÈRE', '=SUMIFS(' + S('COÛT MATIÈRE €') + ',' + cond + ')', '#,##0 €'],
    ['CONSO BÉNÉVOLES', '=SUMIFS(' + S('CONSO BÉNÉVOLES €') + ',' + cond + ')', '#,##0 €'],
    ['FOODTRUCKS', '=SUMIFS(' + S('FOODTRUCKS €') + ',' + cond + ')', '#,##0 €'],
    ['ÉCARTS CAISSE', '=SUMIFS(' + S('ÉCART CAISSE €') + ',' + cond + ')', '#,##0.00 €'],
    ['ÉCARTS CB / TPE', '=SUMIFS(' + S('ÉCART CB €') + ',' + cond + ')', '#,##0.00 €'],
    ['VENTES AVEC BILLET', '=IFERROR(SUMPRODUCT((' + S('SAISON') + '=$B$4)*' + S('VENTES AVEC BILLET') + '*' + S('NB VENTES') + ')/SUMIFS(' + S('NB VENTES') + ',' + cond + '),"—")', '0%'],
  ]);

  // Comparaison des saisons
  const r0 = 12;
  titre(r0, 'COMPARAISON DES SAISONS');
  const ent = ['SAISON', 'MATCHS', 'AFFLUENCE MOY.', 'CA TTC', 'CA / MATCH', '€ / SPECTATEUR', 'PANIER MOYEN', 'MARGE HT', 'TAUX DE MARGE', 'ÉVOL. CA / MATCH'];
  sh.getRange(r0 + 1, 1, 1, ent.length).setValues([ent]);
  styleEntete_(sh.getRange(r0 + 1, 1, 1, ent.length)).setFontSize(9).setHorizontalAlignment('center').setWrap(true);
  liste.forEach(function (s, i) {
    const r = r0 + 2 + i, c = S('SAISON') + ',$A' + r;
    sh.getRange(r, 1).setValue(s);
    sh.getRange(r, 2, 1, 9).setFormulas([[
      '=COUNTIFS(' + c + ',' + S('CA BUVETTE €') + ',">0")',
      '=IFERROR(AVERAGEIFS(' + S('AFFLUENCE') + ',' + c + ',' + S('AFFLUENCE') + ',">0",' + S('CA BUVETTE €') + ',">0"),"—")',
      '=SUMIFS(' + S('CA BUVETTE €') + ',' + c + ')',
      '=IFERROR(D' + r + '/B' + r + ',"—")',
      '=IFERROR(SUMIFS(' + S('CA BUVETTE €') + ',' + c + ',' + S('AFFLUENCE') + ',">0")/SUMIFS(' + S('AFFLUENCE') + ',' + c + ',' + S('CA BUVETTE €') + ',">0"),"—")',
      '=IFERROR(SUMIFS(' + S('CA BUVETTE €') + ',' + c + ',' + S('NB VENTES') + ',">0")/SUMIFS(' + S('NB VENTES') + ',' + c + '),"—")',
      '=IF(COUNTIFS(' + c + ',' + avecMarge + ')=0,"—",SUMIFS(' + S('MARGE HT €') + ',' + c + '))',
      '=IFERROR(SUMIFS(' + S('MARGE HT €') + ',' + c + ')/SUMIFS(' + S('CA HT €') + ',' + c + ',' + avecMarge + '),"—")',
      i === 0 ? '="—"' : '=IFERROR(E' + r + '/E' + (r - 1) + '-1,"—")',
    ].map(f_)]);
    sh.getRange(r, 1, 1, 10).setBackground(i % 2 ? DAY_SOFT : WHITE);
  });
  const r1 = r0 + 2, n = liste.length;
  sh.getRange(r1, 3, n, 1).setNumberFormat('#,##0');
  sh.getRange(r1, 4, n, 2).setNumberFormat('#,##0 €');
  sh.getRange(r1, 6, n, 2).setNumberFormat('0.00 €');
  sh.getRange(r1, 8, n, 1).setNumberFormat('#,##0 €');
  sh.getRange(r1, 9, n, 1).setNumberFormat('0%');
  sh.getRange(r1, 10, n, 1).setNumberFormat('+0%;-0%;0%');
  sh.getRange(r1, 1, n, 1).setFontWeight('bold');

  // Rapprochement avec Pennylane (saison choisie)
  const r3 = r1 + n + 1;
  titre(r3, 'RAPPROCHEMENT AVEC PENNYLANE — achats buvette (compte 607100000)');
  const lignes = [
    ['Achats boissons facturés (Pennylane)', '=SUMIFS(' + AC + 'E2:E,' + AC + 'F2:F,$B$4)', '+'],
    ['Stock au début de la saison (valeur HT, à saisir une fois)', '', '+'],
    ['Coût matière consommé aux matchs', '=SUMIFS(' + S('COÛT MATIÈRE €') + ',' + cond + ')', '−'],
    ['Conso bénévoles', '=SUMIFS(' + S('CONSO BÉNÉVOLES €') + ',' + cond + ')', '−'],
    ['Stock restant valorisé (dernier inventaire)', '', '−'],
    ['ÉCART NON EXPLIQUÉ', '=B' + (r3 + 1) + '+B' + (r3 + 2) + '-B' + (r3 + 3) + '-B' + (r3 + 4) + '-B' + (r3 + 5), '→'],
  ];
  lignes.forEach(function (l, i) {
    const r = r3 + 1 + i;
    sh.getRange(r, 1).setValue(l[0]);
    if (l[1]) sh.getRange(r, 2).setFormula(f_(l[1]));
    sh.getRange(r, 3).setValue(l[2]).setHorizontalAlignment('center').setFontColor('#64778A');
    sh.getRange(r, 2).setNumberFormat('#,##0.00 €').setHorizontalAlignment('right');
    sh.getRange(r, 1, 1, 3).setBackground(i % 2 ? DAY_SOFT : WHITE);
  });
  sh.getRange(r3 + 2, 2).setValue(stockDebut === '' ? 0 : stockDebut).setBackground('#FFF8D6').setNote('À saisir une fois par saison : valeur HT du stock de boissons au 1er match.');
  ss.setNamedRange('STOCK_DEBUT', sh.getRange(r3 + 2, 2));
  ss.setNamedRange('STOCK_VALORISE', sh.getRange(r3 + 5, 2));
  sh.getRange(r3 + 5, 2).setNote('Calculé par le script (inventaires comptés, sinon théorique) à chaque mise à jour des matchs.');
  sh.getRange(r3 + 6, 1, 1, 3).setFontWeight('bold').setFontSize(12);
  sh.getRange(r3 + 7, 1).setValue('Écart > 0 : achats sans consommation constatée (facture d\'un autre usage, inventaire manquant…). Écart < 0 : consommation sans facture (facture oubliée dans Pennylane, prix d\'achat trop haut…).')
    .setFontColor('#64778A').setFontStyle('italic').setFontSize(9);
  const regles = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$A' + r1 + '=$B$4').setBackground(DAY).setBold(true).setRanges([sh.getRange(r1, 1, n, 10)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor('#157A2E').setRanges([sh.getRange(r1, 10, n, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor('#C0262D').setRanges([sh.getRange(r1, 10, n, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(-50, 50).setBackground(OK_BG).setRanges([sh.getRange(r3 + 6, 2)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberNotBetween(-50, 50).setBackground(ERR_BG).setRanges([sh.getRange(r3 + 6, 2)]).build(),
  ];
  sh.setConditionalFormatRules(regles);

  // Matchs de la saison
  const r2 = r3 + 9;
  titre(r2, 'MATCHS DE LA SAISON');
  const cols = ['DATE', 'ADVERSAIRE', 'AFFLUENCE', 'CA BUVETTE €', 'CA HT €', 'MARGE HT €', 'TAUX DE MARGE', '€ / SPECTATEUR', 'PANIER MOYEN €', 'CASSE / ÉCARTS €', 'INVENTAIRE'];
  const derniere = lettre_(MCOL[MCOL.length - 1]);
  sh.getRange(r2 + 1, 1).setFormula(f_('=IFERROR(QUERY(' + M + 'A1:' + derniere + ',"select ' + cols.map(lettre_).join(', ') + ' where ' + lettre_('SAISON') + ' = \'"&$B$4&"\' order by ' + lettre_('DATE') + '",1),"Aucun match pour cette saison")'));
  styleEntete_(sh.getRange(r2 + 1, 1, 1, cols.length)).setFontSize(9).setWrap(true);
  sh.getRange(r2 + 2, 1, 60, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(r2 + 2, 3, 60, 1).setNumberFormat('#,##0');
  sh.getRange(r2 + 2, 4, 60, 3).setNumberFormat('#,##0 €');
  sh.getRange(r2 + 2, 7, 60, 1).setNumberFormat('0%');
  sh.getRange(r2 + 2, 8, 60, 2).setNumberFormat('0.00 €');
  sh.getRange(r2 + 2, 10, 60, 1).setNumberFormat('#,##0 €');

  sh.getRange('A1:J1').setBackground(NIGHT); sh.getRange('A1').setFontColor(DAY).setFontWeight('bold').setFontSize(18);
  sh.setRowHeight(1, 44);
  sh.getRange('A2').setFontColor('#64778A').setFontStyle('italic');
  sh.getRange('A4').setFontWeight('bold');
  sh.getRange('B4').setBackground(DAY).setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  for (let c = 1; c <= 11; c++) sh.setColumnWidth(c, c === 1 ? 300 : c === 2 ? 150 : 120);

  // Graphique : CA et marge par match (saison choisie)
  const ch = sh.newChart().asColumnChart()
    .addRange(sh.getRange(r2 + 1, 2, 41, 1)).addRange(sh.getRange(r2 + 1, 4, 41, 1)).addRange(sh.getRange(r2 + 1, 6, 41, 1))
    .setNumHeaders(1).setPosition(r0, 12, 0, 0)
    .setOption('title', 'CA TTC et marge HT par match').setOption('legend', { position: 'bottom' })
    .setOption('colors', [DAY, NIGHT]).setOption('width', 640).setOption('height', 320)
    .build();
  sh.insertChart(ch);
  try { sh.getRange(r3 + 5, 2).setValue(Math.round(stockValorise_(catalogueCouts_()) * 100) / 100); } catch (e) {}
  return sh;
}
