// ═══════════════════════════════════════════════════════════════════════════
// PILOTAGE LIVE — module du Matchday Business (Code.gs V13 : onglets 📅 MATCHS, 🧾 VENTES, ⚙️ détail ventes…)
// A coller comme NOUVEAU fichier Apps Script (Pilotage.gs), à côté de Code.gs
// et Fidelite.gs. Réutilise les couleurs et onglets de Code.gs (📅 MATCHS, ⚙️ détail ventes,
// 🏠 ACCUEIL (match actif) et _fidCreditOne_ (Fidelite.gs) s'il est présent.
//
// Billetterie : Tickie (plateforme Vivenu, API https://vivenu.com/api).
//
// Flux jour de match :
//  1. Tableau de bord (pilotage.html) : choix du match Tickie + stock par buvette
//     → action=prepa → stock gardé dans le script, match actif dans 🏠 ACCUEIL.
//  0. Les matchs Spacer's de Tickie sont recopiés dans 📅 MATCHS (menu ou auto, 1 fois/h),
//     avec l'affluence (billets + abonnés, puis entrées scannées) dans AFFLUENCE.
//  2. Tablette en wifi : action=tablette → match, stock, billets valides
//     (code-barres + tarif, sans nom ni email) pour travailler hors ligne.
//  3. Tablette hors ligne : ventes stockées, renvoyées au retour du réseau
//     (action=ventes, idempotent) → 🧾 VENTES + ⚙️ détail ventes.
//  4. Déclencheur toutes les 10 min : billet scanné → client Tickie
//     → 🧾 VENTES (id client) + points fidélité (⭐ FIDÉLITÉ), puis 📅 MATCHS recalculé.
//
// Propriétés du script : VIVENU_API_KEY (clé API Tickie/Vivenu), PILOTAGE_TOKEN
// (créé par « Initialiser le pilotage »). Le tableau de bord ne reçoit que des totaux.
// ═══════════════════════════════════════════════════════════════════════════

const PIL = {
  VIVENU_BASE: 'https://vivenu.com/api',
  PORTIER_BASE: 'https://portier.vivenu.com/api',
  ABONNEMENT_EVENT_ID: '69fc9d2b69a5578199f9d5e9',   // « Abonnement 2026-2027 » dans Tickie
  // Remise buvette : −10 % pour les abonnés (tout billet de l'événement abonnement) et les clients Tickie listés
  // ci-dessous (lots partenaires) ; −5 % pour tout autre billet scanné. Taux appliqués par la tablette.
  CLIENTS_REMISE: {
    '6a300038606cb61d33ae0f79': 'CROUS',              // lot partenaire CROUS (billets attribués via « Gestion des partenaires »)
  },
  // Billets « place + boisson » (registre transverse du 09/11) : une boisson offerte à la buvette, une seule par billet
  // toutes buvettes confondues, consigne payée, −5 % sur le reste. Même liste que BILLETS_BOISSON dans la tablette.
  BILLETS_BOISSON: {
    AISC: { ticketTypes: ['6ada071ec4a71b3c0a3d34d4', '6af720c0c1465c450dbb4b4d', '6af720d3c1465c450dbb4b4e'],   // AISC – Place + boisson (plein, réduit, −8 ans), Tours 21/11
            clients: ['6afda97d6ce0eb5d78f1244c'] },   // client « AISC AISC » : 2 places émises en Plein Tarif (commande 448129)
  },
  // Onglets : feuille_('VENTES') = 🧾 VENTES, feuille_('DETAIL') = ⚙️ détail ventes, feuille_('MATCHS') = 📅 MATCHS
  // (anciens noms 51_VENTES_LIVE / 50_VENTES_DIRECTES / 10_MATCHS acceptés). Stock de départ, stock restant
  // et suivi des tablettes sont gardés dans les propriétés du script.
  FUT_LITRES: 30,
  BUVETTES: ['Buvette 1', 'Buvette 2', 'Buvette 3'],
  // Pas de caisse espèces : CB uniquement, aucun remboursement de gobelet (même réglage dans la tablette, LIEUX)
  BUVETTES_SANS_CAISSE: ['Buvette 3'],
  // Fond de caisse de départ, identique à chaque match de la saison (même réglage dans la tablette, LIEUX).
  // Le fond saisi à la clôture de caisse, s'il a été envoyé, prime pour ce match.
  // Fond de caisse : PLUS DE VALEUR PAR DÉFAUT. Décision de Clément du 07/11, inscrite au
  // registre transverse le 23/11 : « il n'est pas fixe, Clément le communique avant chaque
  // match, buvette par buvette ». Les 350 € et 450 € qui vivaient ici n'ont jamais été les
  // vraies valeurs — Tours a tourné à 400 € et 500 € — et un fond inventé fausse le
  // contrôle des espèces de 50 € par caisse en donnant l'air d'être juste.
  // Le fond du match se déclare dans PIL_FONDS_<ID_MATCH> (voir pilFondsMatch_).
  FONDS_CAISSE: {},
  // Réserves hors vente : stock de début et de fin saisis au tableau de bord, jamais sur une tablette
  RESERVES: ['Bénévoles'],
  // Catalogue 26-27 : réf, libellé, prix de référence (la tablette envoie ses prix)
  PRODUITS: [
    ['P01_25',   'Bière 30cl',        4],   // réf. historique : verre de 30 cl (26-27)
    ['P01_50',   'Bière 50cl',        6],
    ['P02_COCA', 'Coca-Cola',         2],   // softs vendus au verre de 30 cl
    ['P02_ORAN', 'Orangina',          2],
    ['P02_ICET', 'Ice Tea',           2],
    ['P02_SCHW', 'Schweppes Agrumes', 2],
    ['P03',      'Eau plate 50cl',    1],
    ['P04',      'Eau gazeuse 50cl',  1],
  ],
  // Volumes : bière au verre (litres tirés du fût) ; softs au verre de 30 cl tirés de bouteilles (stock en bouteilles)
  VERRE_BIERE_L: { P01_25: 0.3, P01_50: 0.5 },
  VERRE_SOFT_L: 0.3,
  BOUTEILLE_L: { P02_COCA: 1.25, P02_ICET: 1.25, P02_ORAN: 1.5, P02_SCHW: 1.5 },
  // Lignes de préparation HISTORIQUES, gardées comme filet de sécurité : la vraie liste vient de
  // 📦 PRODUITS (colonnes UNITÉ DE STOCK et SERVICES PAR UNITÉ), via pilLignesStock_().
  PREPA: [['FUT', 'Bière (fûts 30 L)'], ['P02_COCA', 'Coca-Cola (bout. 1,25 L)'], ['P02_ORAN', 'Orangina (bout. 1,5 L)'], ['P02_ICET', 'Ice Tea (bout. 1,25 L)'],
          ['P02_SCHW', 'Schweppes (bout. 1,5 L)'], ['P03', 'Eau plate 50cl'], ['P04', 'Eau gazeuse 50cl']],
};
// ═══════════════════════════════════════════════════════════════════════════
// 📦 PRODUITS pilote le stock : plus aucune liste de produits en dur
// ═══════════════════════════════════════════════════════════════════════════
// Colonnes lues : RÉF, PRODUIT, FAMILLE, PRIX VENTE €, PRIX ACHAT €, COLISAGE, SEUIL ALERTE,
// UNITÉ DE STOCK (fût / bouteille / unité / vide) et SERVICES PAR UNITÉ (verres ou doses par bouteille).
//   • UNITÉ DE STOCK vide = produit sans stock propre (bière au verre tirée du fût, consigne écocup) ;
//   • SERVICES PAR UNITÉ : 4 verres dans une bouteille de 1,25 L, 5 dans 1,5 L, 30 doses de 2 cl dans 60 cl.
// Ajouter un produit = ajouter sa ligne dans 📦 PRODUITS : formulaire 📥 Livraison reçue, 🔢 Recomptage,
// préparation par buvette, inventaire de fin, seuils d'alerte et commande conseillée le reprennent seuls.
// Les valeurs par défaut ci-dessous servent de filet tant que les deux colonnes ne sont pas remplies :
// cellule vide = valeur par défaut ; texte non reconnu (« non ») = produit retiré du suivi de stock.
const PIL_UNITE_DEFAUT = { FUT: 'fût', P02_COCA: 'bouteille', P02_COCZ: 'bouteille', P02_ORAN: 'bouteille',
  P02_ICET: 'bouteille', P02_SCHW: 'bouteille', P05_PECHE: 'bouteille', P03: 'unité', P04: 'unité' };
const PIL_SERVICES_DEFAUT = { P02_COCA: 4, P02_COCZ: 4, P02_ICET: 4, P02_ORAN: 5, P02_SCHW: 5, P05_PECHE: 30 };
function pilUnite_(v) {
  const t = pilNomNorm_(String(v == null ? '' : v)).toLowerCase().trim();
  if (/^fut/.test(t)) return 'fût';
  if (/^bout/.test(t)) return 'bouteille';
  if (/^unit|^piece|^pce/.test(t)) return 'unité';
  return '';
}
let PIL_CAT_MEMO = null;
function pilCatalogue_(forcer) {
  if (PIL_CAT_MEMO && !forcer) return PIL_CAT_MEMO;
  const cat = { refs: [], par: {}, stock: [], vente: [] };
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONG.PRODUITS);
  if (sh && sh.getLastRow() > 1) {
    const d = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues(), h = d[0].map(String);
    const c = function (n) { return h.indexOf(n); };
    const iRef = c('RÉF'), iNom = c('PRODUIT'), iFam = c('FAMILLE'), iPv = c('PRIX VENTE €'),
      iPa = c('PRIX ACHAT €'), iCol = c('COLISAGE'), iSe = c('SEUIL ALERTE'),
      iU = c('UNITÉ DE STOCK'), iSv = c('SERVICES PAR UNITÉ');
    for (let r = 1; r < d.length && iRef >= 0; r++) {
      const ref = String(d[r][iRef] || '').trim();
      if (!ref || cat.par[ref]) continue;
      const fam = String(iFam >= 0 ? d[r][iFam] : '').trim();
      const uSaisie = iU >= 0 ? pilUnite_(d[r][iU]) : '';
      const p = { ref: ref, nom: String((iNom >= 0 ? d[r][iNom] : '') || ref).trim(), famille: fam,
        prix: Number(iPv >= 0 ? d[r][iPv] : 0) || 0, achat: Number(iPa >= 0 ? d[r][iPa] : 0) || 0,
        colisage: Number(iCol >= 0 ? d[r][iCol] : 0) || 0, seuil: Number(iSe >= 0 ? d[r][iSe] : 0) || 0,
        unite: uSaisie || (iU >= 0 && String(d[r][iU] || '').trim() ? '' : (PIL_UNITE_DEFAUT[ref] || '')),
        services: Math.round(Number(iSv >= 0 ? d[r][iSv] : 0) || PIL_SERVICES_DEFAUT[ref] || 0),
        option: /option/i.test(fam) };
      cat.refs.push(ref); cat.par[ref] = p;
      if (p.unite) cat.stock.push(ref);
      if (p.prix > 0 && !/consigne/i.test(fam)) cat.vente.push(ref);
    }
  }
  if (!cat.stock.length) {   // onglet illisible : on retombe sur les lignes historiques
    [['FUT', 'Bière — fût 30 L', 'fût', 0], ['P02_COCA', 'Coca-Cola', 'bouteille', 4], ['P02_ORAN', 'Orangina', 'bouteille', 5],
     ['P02_ICET', 'Ice Tea', 'bouteille', 4], ['P02_SCHW', 'Schweppes Agrumes', 'bouteille', 5],
     ['P03', 'Eau plate 50cl', 'unité', 0], ['P04', 'Eau gazeuse 50cl', 'unité', 0]].forEach(function (x) {
      if (cat.par[x[0]]) { cat.par[x[0]].unite = x[2]; cat.par[x[0]].services = x[3]; }
      else { cat.par[x[0]] = { ref: x[0], nom: x[1], famille: '', prix: 0, achat: 0, colisage: 0, seuil: 0, unite: x[2], services: x[3], option: false }; cat.refs.push(x[0]); }
      cat.stock.push(x[0]);
    });
  }
  if (!cat.vente.length) PIL.PRODUITS.forEach(function (x) {
    if (!cat.par[x[0]]) { cat.par[x[0]] = { ref: x[0], nom: x[1], famille: '', prix: x[2], achat: 0, colisage: 0, seuil: 0, unite: '', services: 0, option: false }; cat.refs.push(x[0]); }
    cat.vente.push(x[0]);
  });
  PIL_CAT_MEMO = cat;
  return cat;
}
function pilProd_(ref) {
  const p = pilCatalogue_().par[ref];
  return p || { ref: ref, nom: ref, famille: '', prix: 0, achat: 0, colisage: 0, seuil: 0, unite: '', services: 0, option: false };
}
// Libellé des lignes de stock, tel qu'il s'affiche au tableau de bord et sur la tablette
function pilLibelleStock_(p) {
  if (p.unite === 'fût') return p.nom.replace(/\s*[—-].*$/, '').trim() + ' (fûts ' + PIL.FUT_LITRES + ' L)';
  if (p.unite === 'bouteille') return p.nom + (p.services ? ' (bout., ' + p.services + ' ' + (p.option ? 'doses' : 'verres') + ')' : ' (bouteilles)');
  return p.nom;
}
// Lignes de préparation / livraison / comptage : [réf, libellé, pas de saisie, unité, services]
function pilLignesStock_() {
  const cat = pilCatalogue_();
  return cat.stock.map(function (ref) {
    const p = cat.par[ref];
    return [ref, pilLibelleStock_(p), p.unite === 'fût' ? 0.25 : p.unite === 'bouteille' ? 0.5 : 1, p.unite, p.services];
  });
}
// Ordre des colonnes produit de 🧾 VENTES : mémorisé, jamais réordonné, allongé en fin de liste
// quand un produit vendable apparaît dans 📦 PRODUITS (les colonnes du Sheet suivent, voir pilMigrerColonnesVentes_).
function pilColsVentes_() {
  const p = PropertiesService.getScriptProperties();
  let cols = [];
  try { cols = JSON.parse(p.getProperty('PIL_COLS_VENTES') || 'null') || []; } catch (e) { cols = []; }
  if (!cols.length) cols = PIL.PRODUITS.map(function (x) { return x[0]; });   // les 8 colonnes historiques
  let change = false;
  pilCatalogue_().vente.forEach(function (ref) { if (cols.indexOf(ref) < 0) { cols.push(ref); change = true; } });
  if (change) p.setProperty('PIL_COLS_VENTES', JSON.stringify(cols));
  return cols;
}
function pilProduitsCols_() {
  return pilColsVentes_().map(function (ref) { const p = pilProd_(ref); return [ref, p.nom, p.prix]; });
}
function pilColPaiement_() { return PIL_NB + pilColsVentes_().length; }
// Ajoute dans 🧾 VENTES les colonnes produit qui manquent, juste avant « Paiement »,
// pour que les lignes déjà écrites gardent leur alignement. Renvoie le nombre de colonnes insérées.
function pilMigrerColonnesVentes_() {
  const sh = feuille_('VENTES');
  if (!sh || sh.getLastColumn() <= PIL_NB) return 0;
  const cols = pilColsVentes_();
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const iPay = h.indexOf('Paiement');
  if (iPay < PIL_NB) return 0;                       // en-tête inattendu : on ne touche à rien
  const manque = PIL_NB + cols.length - iPay;
  if (manque <= 0) return 0;
  sh.insertColumnsBefore(iPay + 1, manque);
  for (let k = 0; k < manque; k++) {
    const ref = cols[iPay - PIL_NB + k], p = pilProd_(ref);
    styleEntete_(sh.getRange(1, iPay + 1 + k).setValue(p.nom || ref));
  }
  Logger.log('🧾 VENTES : ' + manque + ' colonne(s) produit ajoutée(s) avant « Paiement ».');
  return manque;
}

const PIL_LIVE_COLS = ['Reçu le', 'Horodatage', 'ID vente', 'ID_MATCH', 'Buvette', 'Total €', 'Consignes +',
  'Consignes rendues', 'ID billet', 'Code-barres', 'Tarif billet', 'Client Tickie', 'Fidélité'];
const PIL_I = {}; PIL_LIVE_COLS.forEach(function (c, i) { PIL_I[c] = i; });
const PIL_NB = PIL_LIVE_COLS.length;
// Position historique de la colonne « Paiement » (13 colonnes + 8 produits). Depuis que 📦 PRODUITS
// pilote la liste, utiliser pilColPaiement_() : le nombre de colonnes produit peut grandir.
const PIL_COL_PAIEMENT = PIL_NB + PIL.PRODUITS.length;
const PIL_VD_HDR = ['MATCH', 'DATE', 'TABLETTE', 'REF', 'PRODUIT', 'QTY', 'PRIX_UNIT', 'CONSIGNE_UNIT', 'CA_HT', 'CA_CONSIGNE', 'TYPE'];
// Gobelets revenus sans remboursement : rapportés mais pas remboursés faute d'espèces (bouton 🚫 Plus d'espèces,
// motif PLUS_ESPECES) ou posés sur le comptoir / ramassés sans que personne demande l'euro (bouton 🫙 Récupéré, motif RECUPERE).
// Onglet technique à part : ni 🧾 VENTES ni ⚙️ détail ventes, pour ne pas fausser NB VENTES, panier et consignes de Code.gs.
const PIL_NR_TAB = '⚙️ écocups non remboursés';
const PIL_NR_HDR = ['Reçu le', 'Horodatage', 'ID vente', 'ID_MATCH', 'Buvette', 'Écocups 30cl', 'Écocups 50cl', 'Annulation de', 'Motif'];
const PIL_DETAIL_TAB = '🥤 DÉTAIL BUVETTE';
const PIL_DETAIL_ARCH_TAB = '⚙️ détail buvette archive';   // lignes figées, une fois le match terminé
const PIL_DETAIL_FIGE_JOURS = 2;

// ── Menu (ajouté à onOpen de Code.gs) ───────────────────────────────────
function pilotageMenu_(ui) {
  return ui.createMenu('📡 Pilotage live')
    .addItem('📊 Ouvrir le tableau de bord + liens tablettes', 'pilotageOuvrir')
    .addSeparator()
    .addItem('⚙️ Initialiser le pilotage', 'pilotageInitialiser')
    .addItem('🔑 Afficher le jeton', 'pilotageAfficherJeton')
    .addItem('🔄 Synchroniser les matchs Tickie', 'pilotageSyncMatchs')
    .addItem('🎫 Relier les billets scannés + fidélité', 'pilotageTraiterBillets')
    .addItem('⏱️ Activer le traitement auto (10 min)', 'pilotageInstallerDeclencheur')
    .addItem('🔥 Réchauffer la billetterie maintenant', 'pilotageRechauffer')
    .addItem('💶 Fond de caisse du match (par buvette)', 'pilotageFondsCaisse')
    .addItem('🥤 Mettre à jour le détail buvette (alcool, écocups, espèces)', 'pilotageDetailBuvette')
    .addItem('🔓 Détail buvette : recalculer un match figé', 'pilotageDetailRefiger')
    .addItem('🥤 Stock écocups et rachat', 'pilotageStockEcocups')
    .addItem('💳 Rapprochement CB (remises TPE Pennylane ↔ tablettes)', 'rapprochementCBMenu')
    .addSeparator()
    .addItem('📈 Graphiques buvette : mettre à jour', 'graphiquesMaj')
    .addItem('📄 Graphiques buvette : PDF pour le bureau', 'graphiquesPdf')
    .addItem("🧱 Graphiques buvette : recréer l'onglet", 'graphiquesRecreer')
    .addSeparator()
    .addItem("📚 Importer l'historique 22-26", 'importerHistoriqueBuvette')
    .addItem("🗑️ Retirer l'historique 22-26", 'retirerHistoriqueBuvette');
}

function pilotageInitialiser() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = feuille_('VENTES');
  if (!sh) {
    sh = ss.insertSheet(ss.getSheetByName(ONG.MATCHS) ? ONG.VENTES : ONG_ANCIEN.VENTES);
    const head = PIL_LIVE_COLS.concat(pilProduitsCols_().map(function (p) { return p[1]; })).concat(['Paiement']);
    styleEntete_(sh.getRange(1, 1, 1, head.length).setValues([head]));
    sh.setFrozenRows(1);
  }
  // Onglets d'une version précédente du pilotage : supprimés
  ['52_STOCK_LIVE', '53_PREPA', '54_TABLETTES'].forEach(function (n) { const s2 = ss.getSheetByName(n); if (s2) ss.deleteSheet(s2); });
  pilEnsureVdHeader_();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PILOTAGE_TOKEN')) props.setProperty('PILOTAGE_TOKEN', Utilities.getUuid().replace(/-/g, '').slice(0, 20));
  let sync = '';
  try { sync = '\n\n' + pilotageSyncMatchs(true) ; } catch (e) { sync = '\n\n⚠️ Matchs Tickie non synchronisés : ' + e.message; }
  pilotageAfficherJeton(sync);
}

function pilotageAfficherJeton(suite) {
  const p = PropertiesService.getScriptProperties();
  const msg = 'Jeton de pilotage : ' + (p.getProperty('PILOTAGE_TOKEN') || '(lancer Initialiser)') +
    '\nClé API Tickie (VIVENU_API_KEY) : ' + (p.getProperty('VIVENU_API_KEY') ? 'renseignée' : 'MANQUANTE (Paramètres du projet → Propriétés du script)') +
    (typeof suite === 'string' ? suite : '');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function pilotageInstallerDeclencheur() {
  ['pilotageTraiterBillets', 'pilotageRechauffer'].forEach(function (f) {
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === f) ScriptApp.deleteTrigger(t); });
  });
  ScriptApp.newTrigger('pilotageTraiterBillets').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('pilotageRechauffer').timeBased().everyMinutes(5).create();
  try { SpreadsheetApp.getUi().alert('✅ Toutes les 5 minutes : billetterie Tickie calculée à l\'avance, hors requête.\nToutes les 10 minutes : billets scannés reliés, fidélité créditée et 📅 MATCHS recalculé.\nToutes les heures : matchs et affluences Tickie mis à jour.'); } catch (e) {}
}

// ── Réchauffement : tout ce qui coûte un parcours Tickie se fait ICI ─────
// Les tablettes et le tableau de bord ne doivent jamais attendre Tickie.
//
// Trois bornes, chacune pour une panne précise :
//
// 1. UN BUDGET DE 150 s. On ne DÉMARRE pas un parcours au-delà, car un passage tué à
//    6 minutes n'écrit rien du tout — l'instantané comme le cache ne sont écrits qu'à
//    la toute fin de leur calcul. Sans budget, un passage trop chargé échouerait à
//    l'identique à chaque fois : une boucle d'échec stable, pas un incident passager.
// 2. UN ÂGE MINIMUM avant de recalculer : 4 minutes un jour de match, 6 heures sinon.
//    Toutes les 5 minutes, c'est 288 passages par jour et toute l'année ; recalculer
//    à chaque fois épuiserait le quota de temps d'exécution des déclencheurs du compte
//    (90 min par jour sur un compte gratuit, 6 h sur Workspace) — et quand ce quota
//    tombe, TOUS les déclencheurs s'arrêtent jusqu'au lendemain, la liaison des billets
//    comprise, un samedi de match. C'est le point de défaillance unique de cette
//    architecture : un compteur invisible qui désactive tout le reste.
// 3. RIEN POUR UN MATCH DÉJÀ JOUÉ. Tant que la préparation du match suivant n'est pas
//    enregistrée, le match actif est celui du week-end dernier : on repayait sans fin
//    le parcours des billets que plus aucune tablette ne lira.
//
// L'ordre compte : la liste des billets des tablettes passe AVANT le gel des taux de
// présence. Les tablettes en dépendent au comptoir ; les taux ne servent qu'à l'onglet
// Commande, consulté à J-3. Si le budget s'épuise, c'est le gel qui saute.
// Ce passage lit 📅 MATCHS (pilEventParMatch_) mais n'y écrit rien.
function pilotageRechauffer() {
  const debut = Date.now(), auj = pilDate_(new Date());
  const budget = function () { return Date.now() - debut < 150000; };
  const actif = pilActif_();
  let evActif = null;
  if (actif && actif.eventId) { try { evActif = pilEvent_(actif.eventId); } catch (e) {} }
  let suivant = null;
  try { suivant = pilMatchsTickie_().filter(function (e) { return /spacer/i.test(e.nom) && e.dateMatch >= auj; })[0] || null; } catch (e) {}

  const cibles = [];
  if (evActif && evActif.dateMatch >= auj) cibles.push(evActif);
  if (suivant && !cibles.some(function (x) { return x.id === suivant.id; })) cibles.push(suivant);
  const jourDeMatch = cibles.some(function (x) { return x.dateMatch === auj; });
  const AGE = jourDeMatch ? 240000 : 21600000;      // 4 min un jour de match, 6 h sinon

  const faits = [];
  cibles.forEach(function (ev) {
    if (!budget()) return;
    try {
      const snap = pilBilletterieSnap_(ev.id);
      if (snap && snap.fige) return;                // match passé : ses chiffres ne bougeront plus
      if (snap && snap.calcule && (Date.now() - new Date(snap.calcule).getTime()) < AGE) return;
      if (pilCalculerBilletterie_(ev.id, true)) faits.push(ev.id);
    } catch (e) { Logger.log('Réchauffement billetterie ' + ev.id + ' : ' + (e && e.message || e)); }
  });

  // Liste des billets des tablettes : le même parcours, fait une fois ici pour les trois.
  let liste = '';
  if (evActif && evActif.dateMatch >= auj && budget()) {
    try {
      pilCacheGros_('pil_liste_billets_' + evActif.id, 600, function () { return pilListerBillets_(evActif.id); }, true);
      liste = ' · liste billets';
      // Les abonnements bougent peu : on les refait toutes les 30 minutes, et EN FORÇANT.
      // Sans le forçage, ce passage relisait son propre cache et ne réchauffait jamais
      // rien : c'était la première tablette chargée après expiration qui payait le
      // parcours complet des abonnements dans sa propre requête, une fois par heure.
      const vuAbo = Number(pilProp_('PIL_WARM_ABO', 0)) || 0;
      if (budget() && Date.now() - vuAbo > 1800000) {
        pilCacheGros_('pil_liste_billets_abo', 3600, function () { return pilListerBillets_(PIL.ABONNEMENT_EVENT_ID); }, true);
        try { pilSetProp_('PIL_WARM_ABO', Date.now()); } catch (e) {}
        liste += ' + abonnés';
      }
    } catch (e) { Logger.log('Réchauffement liste billets : ' + (e && e.message || e)); }
  }

  // Taux de présence des matchs joués, deux par passage, et seulement s'il reste du
  // budget. Le point de départ TOURNE : un match dont le taux n'est pas calculable
  // (aucune entrée scannée, abonnés illisibles) resterait sinon éternellement en tête
  // de liste et empêcherait tous les suivants d'être gelés.
  let taux = '';
  if (budget()) {
    try {
      let abonnes = 0;
      try { abonnes = pilCompterBillets_(PIL.ABONNEMENT_EVENT_ID, 3600).total; } catch (e) {}
      if (abonnes > 0) {
        const evDe = pilEventParMatch_(), aGeler = [];
        Object.keys(evDe).forEach(function (m) {
          const ev = evDe[m];
          if (pilProp_('PIL_TAUX_EV_' + ev, null) != null) return;
          const e = pilEvent_(ev);
          if (e && e.dateMatch < auj) aGeler.push(ev);
        });
        if (aGeler.length) {
          const dep = (Number(pilProp_('PIL_TAUX_OFFSET', 0)) || 0) % aGeler.length;
          const lot = [aGeler[dep], aGeler[(dep + 1) % aGeler.length]]
            .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
          lot.forEach(function (ev) { if (budget()) pilTauxPresence_(ev, abonnes, true); });
          try { pilSetProp_('PIL_TAUX_OFFSET', (dep + lot.length) % aGeler.length); } catch (e) {}
          taux = ' · ' + lot.length + ' taux tenté(s) sur ' + aGeler.length + ' à geler';
        }
      }
    } catch (e) { Logger.log('Réchauffement taux de présence : ' + (e && e.message || e)); }
  }

  Logger.log('Réchauffement : ' + faits.length + ' instantané(s) sur ' + cibles.length + ' match(s)'
    + liste + taux + (jourDeMatch ? ' · jour de match' : '') + (budget() ? '' : ' · ⚠️ budget épuisé')
    + ' en ' + Math.round((Date.now() - debut) / 1000) + ' s');
  return faits;
}

// ── Matchs Tickie → 📅 MATCHS ────────────────────────────────────────────
function pilotageSyncMatchs(silencieux) {
  const evs = pilMatchsTickie_().filter(function (ev) { return /spacer/i.test(ev.nom); });
  let abonnes = 0;
  try { abonnes = pilCompterBillets_(PIL.ABONNEMENT_EVENT_ID, 3600).total; } catch (e) {}
  // Les soirées doubles mal découpées sont corrigées avant tout calcul (adversaire, puis ID_MATCH si libre)
  let corrections = [];
  try { corrections = pilCorrigerAdversaires_(evs); } catch (e) { corrections = ['⚠️ Contrôle des adversaires : ' + e.message]; }
  const lignes = evs.map(function (ev) {
    const idm = pilIdMatch_(ev, true);
    if (!idm) return '⚠️ « ' + ev.nom + ' » : adversaire des Spacer\'s illisible, match non créé';
    pilModeDirect_(idm);
    const b = pilCompterBillets_(ev.id, 600).total;
    const entrees = ev.dateMatch <= pilDate_(new Date()) ? pilCompterEntrees_(ev.id) : null;
    const aff = entrees > 0 ? entrees : b + abonnes;
    pilAffluence_(idm, aff);
    return idm + ' : ' + aff + (entrees > 0 ? ' entrées' : ' attendus (' + b + ' billets + ' + abonnes + ' abonnés)');
  });
  PropertiesService.getScriptProperties().setProperty('PIL_SYNC', String(Date.now()));
  const msg = '🔄 ' + evs.length + ' match(s) Tickie dans 📅 MATCHS\n' + lignes.join('\n') +
    (corrections.length ? '\n\n' + corrections.join('\n') : '');
  if (silencieux === true) return msg;
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return msg;
}

// ── Utilitaires ──────────────────────────────────────────────────────────
function pilJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function pilTokenOk_(t) { const ref = PropertiesService.getScriptProperties().getProperty('PILOTAGE_TOKEN'); return !!ref && t === ref; }
function pilTz_() { return Session.getScriptTimeZone() || 'Europe/Paris'; }
function pilDate_(d) { return Utilities.formatDate(new Date(d), pilTz_(), 'yyyy-MM-dd'); }
function pilSheet_(n) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n); }
function pilProduit_(ref) { const p = pilProd_(ref); return [p.ref, p.nom, p.prix]; }

function pilEnsureVdHeader_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = feuille_('DETAIL') || ss.insertSheet(ss.getSheetByName(ONG.MATCHS) ? ONG.DETAIL : ONG_ANCIEN.DETAIL);
  const h = sh.getLastRow() ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String) : [];
  if (h.indexOf('CA_HT') < 0) {
    if (sh.getLastRow() === 0) sh.appendRow(PIL_VD_HDR); else sh.getRange(1, 1, 1, PIL_VD_HDR.length).setValues([PIL_VD_HDR]);
    styleEntete_(sh.getRange(1, 1, 1, PIL_VD_HDR.length));
  }
  return sh;
}

// ── Points d'entrée (routés depuis doGet / doPost de Code.gs) ────────────
function pilotageGet_(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'ping') return pilJson_({ status: 'ok', app: 'buvette' });
  if (!pilTokenOk_(p.token)) return pilJson_({ status: 'error', message: 'Jeton refusé' });
  try {
    if (p.action === 'events') return pilJson_({ status: 'ok', events: pilMatchsTickie_() });
    if (p.action === 'dashboard') return pilJson_(Object.assign({ status: 'ok' }, pilDashboard_(p.eventId)));
    if (p.action === 'prepa') return pilJson_(Object.assign({ status: 'ok' }, pilLirePrepa_(p.eventId)));
    if (p.action === 'tablette') return pilJson_(Object.assign({ status: 'ok' }, pilChargerTablette_(p.buvette)));
    if (p.action === 'commande') return pilJson_(Object.assign({ status: 'ok' }, pilDonneesCommande_(p.eventId)));
    if (p.action === 'stockclub') return pilJson_(Object.assign({ status: 'ok' }, pilLireStockClub_(p.eventId)));
    return pilJson_({ status: 'error', message: 'Action inconnue' });
  } catch (err) { return pilJson_({ status: 'error', message: String(err && err.message || err) }); }
}

function pilotagePost_(body) {
  if (!pilTokenOk_(body.token)) return pilJson_({ status: 'error', message: 'Jeton refusé' });
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (body.action === 'ventes') {
      const recus = pilEnregistrerVentes_(body.ventes || []);
      if (body.stock && body.buvette) pilMajStock_(body.buvette, body.stock);
      if (body.buvette) pilJournal_(body.buvette, null, 4);
      return pilJson_({ status: 'ok', recus: recus });
    }
    if (body.action === 'inventaire') return pilJson_(Object.assign({ status: 'ok' }, pilEnregistrerInventaire_(body.eventId, body.inventaires || {})));
    if (body.action === 'cloture') return pilJson_(Object.assign({ status: 'ok' }, pilEnregistrerCloture_(body.cloture || {})));
    if (body.action === 'reassort') return pilJson_(Object.assign({ status: 'ok' }, pilEnregistrerReassort_(body.reassort || {})));
    if (body.action === 'prepa') return pilJson_(Object.assign({ status: 'ok' }, pilEnregistrerPrepa_(body.eventId, body.stocks || {})));
    if (body.action === 'livraison') return pilJson_(Object.assign({ status: 'ok' }, pilEnregistrerLivraison_(body.livraison || {})));
    if (body.action === 'livraisonSuppr') return pilJson_(Object.assign({ status: 'ok' }, pilSupprimerLivraison_(body.id)));
    if (body.action === 'stockcompte') return pilJson_(Object.assign({ status: 'ok' }, pilEnregistrerComptageClub_(body.comptage || {})));
    return pilJson_({ status: 'error', message: 'Action inconnue' });
  } catch (err) { return pilJson_({ status: 'error', message: String(err && err.message || err) });
  } finally { lock.releaseLock(); }
}

// ── API Tickie (Vivenu) ──────────────────────────────────────────────────
function pilApi_(base, path, query) {
  const key = PropertiesService.getScriptProperties().getProperty('VIVENU_API_KEY');
  if (!key) throw new Error('Clé API Tickie manquante (propriété VIVENU_API_KEY)');
  const qs = Object.keys(query || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&');
  const r = UrlFetchApp.fetch(base + path + (qs ? '?' + qs : ''), { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('Tickie ' + r.getResponseCode() + ' sur ' + path);
  return JSON.parse(r.getContentText());
}
// forcer = true : on ne LIT pas le cache, on recalcule et on réécrit. C'est ce dont le
// réchauffement a besoin : sans ça il relirait sa propre valeur et ne réchaufferait rien,
// la donnée vieillissant jusqu'à expiration avant qu'une tablette ne repaye le parcours.
function pilCache_(key, ttl, fn, forcer) {
  const c = CacheService.getScriptCache();
  if (!forcer) { const hit = c.get(key); if (hit) return JSON.parse(hit); }
  const v = fn();
  try { c.put(key, JSON.stringify(v), ttl); } catch (e) {}
  return v;
}
// Cache d'une valeur trop grosse pour une seule entrée : CacheService plafonne à 100 Ko
// par clé. La chaîne JSON est découpée en tranches, chacune sous sa propre clé, avec un
// manifeste qui porte le numéro de génération, le nombre de tranches et la longueur
// totale attendue.
//
// La GÉNÉRATION est indispensable : putAll n'est pas atomique et deux exécutions peuvent
// écrire la même liste en même temps. Sans elle, un lecteur pouvait assembler la tranche
// 0 de l'une et la tranche 1 de l'autre ; quand les deux découpages avaient le même
// nombre de tranches — deux listes qui ne diffèrent que d'un nom, le cas courant à
// 5 minutes d'intervalle — le JSON recollé restait VALIDE et la donnée mélangée passait
// pour vraie. Chaque écriture a maintenant ses propres clés et le manifeste désigne une
// génération entière ; la longueur reconstruite est vérifiée avant de parser.
//
// 24 000 caractères par tranche : 96 Ko au pire absolu (4 octets par caractère en UTF-8),
// donc sous le plafond même pour un nom écrit hors alphabet latin. La coupe ne tombe
// jamais entre les deux moitiés d'un caractère codé sur deux unités (un emoji dans un nom
// de titulaire) : CacheService ne restituerait pas la moitié à l'identique et le nom
// revenait abîmé sans que rien ne le signale.
//
// Toute tranche manquante, tout manifeste illisible, toute longueur qui ne tombe pas
// juste ⇒ on recalcule. Le cache n'est JAMAIS une vérité, seulement un raccourci.
// forcer = true : on ne LIT pas le cache, on recalcule et on réécrit. C'est ce dont le
// réchauffement a besoin : sans ça il relirait sa propre valeur et ne réchaufferait rien,
// la donnée vieillissant jusqu'à expiration avant qu'une tablette ne repaye le parcours.
function pilCacheGros_(key, ttl, fn, forcer) {
  const c = CacheService.getScriptCache(), TAILLE = 24000, MAX = 400;
  try {
    const brut = forcer ? null : c.get(key + '_m');
    if (brut) {
      const m = JSON.parse(brut);
      if (m && m.g && m.n > 0 && m.n <= MAX) {
        const cles = [];
        for (let i = 0; i < m.n; i++) cles.push(key + '_' + m.g + '_' + i);
        const parts = c.getAll(cles);
        let txt = '';
        for (let i = 0; i < m.n; i++) { const t = parts[cles[i]]; if (t == null) { txt = null; break; } txt += t; }
        if (txt != null && txt.length === m.l) return JSON.parse(txt);
      }
    }
  } catch (e) {}
  const v = fn();
  try {
    const txt = JSON.stringify(v);
    if (typeof txt !== 'string') return v;
    const bornes = [];
    let i = 0;
    while (i < txt.length) {
      let j = Math.min(txt.length, i + TAILLE);
      if (j < txt.length) {
        const cc = txt.charCodeAt(j - 1);
        if (cc >= 0xD800 && cc <= 0xDBFF) j--;      // ne pas couper une paire de substituts
      }
      if (j <= i) j = Math.min(txt.length, i + TAILLE);
      bornes.push([i, j]); i = j;
    }
    if (!bornes.length || bornes.length > MAX) {
      Logger.log('pilCacheGros_ : ' + key + ' non mis en cache (' + bornes.length + ' tranches pour ' + txt.length + ' caractères)');
      return v;
    }
    const g = String(Date.now()) + '-' + Math.floor(Math.random() * 1000);
    const lot = {};
    bornes.forEach(function (b, k) { lot[key + '_' + g + '_' + k] = txt.slice(b[0], b[1]); });
    lot[key + '_m'] = JSON.stringify({ g: g, n: bornes.length, l: txt.length });
    c.putAll(lot, ttl);
  } catch (e) {
    Logger.log('pilCacheGros_ : échec de mise en cache de ' + key + ' — ' + (e && e.message || e));
  }
  return v;
}
// Le cache porte-t-il une valeur pour cette clé ? Sert à décider s'il faut parcourir
// Tickie dans une requête de tablette, sans déclencher le parcours pour le savoir.
function pilCacheGrosPresent_(key) {
  try { return !!CacheService.getScriptCache().get(key + '_m'); } catch (e) { return false; }
}
// Liste des billets servie à une tablette, ou null si Tickie est déjà en cours de
// parcours ailleurs.
//
// Le cache vide, trois tablettes qui se rafraîchissent sur le même top de 5 minutes
// lançaient trois parcours Tickie en parallèle, chacun de 40 à 160 s — alors que la
// tablette abandonne au bout de 60 s et affiche « Chargement impossible. Vérifie le
// wifi. » au bénévole, dont le wifi va très bien. On rend donc la main tout de suite :
// la tablette garde sa liste précédente, et le réchauffement remplira le cache dans les
// 5 minutes. Un seul parcours à la fois, jamais trois.
function pilListeBilletsTablette_(eventId) {
  const c = CacheService.getScriptCache(), jeton = 'pil_liste_calcul';
  const chaud = pilCacheGrosPresent_('pil_liste_billets_' + eventId) && pilCacheGrosPresent_('pil_liste_billets_abo');
  if (!chaud) {
    if (c.get(jeton)) return null;
    try { c.put(jeton, '1', 240); } catch (e) {}
  }
  try {
    return pilCacheGros_('pil_liste_billets_' + eventId, 600, function () { return pilListerBillets_(eventId); })
      .concat(pilCacheGros_('pil_liste_billets_abo', 3600, function () { return pilListerBillets_(PIL.ABONNEMENT_EVENT_ID); }));
  } finally { if (!chaud) { try { c.remove(jeton); } catch (e) {} } }
}
function pilMatchsTickie_() {
  return pilCache_('pil_events', 600, function () {
    const res = pilApi_(PIL.VIVENU_BASE, '/events', { top: 100 });
    return (res.rows || res.docs || []).filter(function (ev) { return ev._id !== PIL.ABONNEMENT_EVENT_ID; })
      .map(function (ev) { return { id: ev._id, nom: ev.name, date: ev.start, dateMatch: pilDate_(ev.start), jauge: ev.maxAmount || null }; })
      .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  });
}
function pilEvent_(eventId) { return pilMatchsTickie_().filter(function (x) { return x.id === eventId; })[0] || null; }
function pilParcourirBillets_(eventId, fn, statut) {
  statut = statut || 'VALID';
  let skip = 0;
  while (true) {
    const res = pilApi_(PIL.VIVENU_BASE, '/tickets', { event: eventId, status: statut, top: 1000, skip: skip });
    const rows = res.rows || [];
    rows.forEach(function (t) { if (!t.status || t.status === statut) fn(t); });
    skip += rows.length;
    if (!rows.length || skip >= (res.total || 0)) break;
  }
}
function pilCompterBillets_(eventId, ttl, forcer) {
  return pilCache_('pil_billets_' + eventId, ttl, function () {
    const o = { total: 0, payants: 0, invitations: 0, parTarif: {} };
    pilParcourirBillets_(eventId, function (t) {
      o.total++;
      if ((t.realPrice || 0) > 0) o.payants++;
      if (/invitation/i.test(t.ticketName || '')) o.invitations++;
      o.parTarif[t.ticketName || 'Autre'] = (o.parTarif[t.ticketName || 'Autre'] || 0) + 1;
    });
    return o;
  }, forcer);
}
// Profil de remise d'un billet : 'ABO' (abonnement), nom du partenaire (lot CLIENTS_REMISE) ou '' (billet simple)
function pilProfilRemise_(t, eventId) {
  if ((eventId || t.eventId) === PIL.ABONNEMENT_EVENT_ID) return 'ABO';
  const kb = Object.keys(PIL.BILLETS_BOISSON).filter(function (k) { const b = PIL.BILLETS_BOISSON[k];
    return b.ticketTypes.indexOf(t.ticketTypeId) >= 0 || b.clients.indexOf(t.customerId) >= 0 || /AISC/i.test(t.ticketName || ''); })[0];
  if (kb) return kb;
  return PIL.CLIENTS_REMISE[t.customerId] || '';
}
function pilListerBillets_(eventId) {   // [code-barres, id billet, tarif, nom du titulaire, profil remise] — pas d'email ni d'adresse
  const out = [];
  const ajouter = function (t) {
    if (!t.barcode) return;
    const nom = String(t.name || [t.firstname, t.lastname].filter(Boolean).join(' ') || '').replace(/\s+/g, ' ').trim();
    out.push([t.barcode, t._id, t.ticketName || '', nom, pilProfilRemise_(t, eventId)]);
  };
  pilParcourirBillets_(eventId, ajouter);
  // Billets payés mais pas encore nominatifs (« détails à compléter ») : ils restent des billets du club
  try { pilParcourirBillets_(eventId, ajouter, 'DETAILSREQUIRED'); } catch (e) {}
  return out;
}
// Entrées scannées au contrôle d'accès. null si le contrôle d'accès n'est pas accessible.
//
// Le parcours est CHER : l'API Tickie ne sait pas compter, il faut dérouler TOUS les scans de
// l'événement par pages de 1000. Et pilDonneesCommande_ le refait pour CHAQUE match déjà joué
// (taux de présence appris). Avec un cache de 60 s et un tableau de bord qui se rafraîchit
// toutes les 30 s, un chargement sur deux repayait l'intégralité du parcours, pour tous les
// matchs : c'est l'origine des doGet à 70-110 s relevés le 25/11/2026.
//
// Les scans d'un match passé ne changent plus : on les gèle dans une propriété, comme le PMP.
// Propriété indexée par ID D'ÉVÉNEMENT TICKIE et non par ID_MATCH : elle n'entre donc PAS dans
// la liste de pilRenommerProps_ (renommer un ID_MATCH ne la concerne pas).
function pilCompterEntrees_(eventId, forcer) {
  const gele = pilProp_('PIL_ENTREES_EV_' + eventId, null);
  if (gele != null && isFinite(Number(gele))) return Number(gele);
  try {
    let passe = false;
    try { const ev = pilEvent_(eventId); passe = !!ev && ev.dateMatch < pilDate_(new Date()); } catch (e) {}
    const n = pilCache_('pil_entrees_' + eventId, passe ? 21600 : 300, function () {
      const vus = {}; let skip = 0;
      while (true) {
        const res = pilApi_(PIL.PORTIER_BASE, '/scans', { eventId: eventId, top: 1000, skip: skip });
        const rows = res.rows || res.docs || [];
        rows.forEach(function (s) {
          if (s.scanResult && s.scanResult !== 'approved') return;
          if (s.type === 'checkout') delete vus[s.ticketId || s.barcode]; else vus[s.ticketId || s.barcode] = 1;
        });
        skip += rows.length;
        if (!rows.length || skip >= (res.total || 0)) break;
      }
      return Object.keys(vus).length;
    }, forcer);
    // On ne gèle qu'un décompte NON NUL : un zéro peut venir d'une synchronisation Tickie en
    // retard ou d'un match sans contrôle d'accès, et une fois gelé il ne se corrigerait plus.
    // Un zéro reste simplement en cache 6 h (le maximum de CacheService).
    // Dégel d'un décompte erroné : supprimer la propriété PIL_ENTREES_EV_<id événement> dans
    // Paramètres du projet → Propriétés du script. Aucun autre calcul n'en dépend.
    if (passe && n > 0) { try { pilSetProp_('PIL_ENTREES_EV_' + eventId, n); } catch (e) {} }
    return n;
  } catch (e) { return null; }
}

// ── Billets : index interne et instantané de billetterie ────────────────
// Le client d'un billet, tel que la liaison des ventes en a besoin.
function pilClientBillet_(t) {
  return { customerId: t.customerId || '', email: String(t.email || '').toLowerCase().trim(),
    nom: [t.firstname, t.lastname].filter(Boolean).join(' '), tarif: t.ticketName || '', id: t._id };
}
// Index des billets d'un événement : code-barres ET id de billet → client.
// Il porte l'email, donc il ne sort JAMAIS vers une tablette (pilListerBillets_ est
// la version publique, sans email ni adresse) et il n'est pas mis en cache : il est
// construit une fois par passage du déclencheur, en mémoire, puis jeté.
// Même couverture de statuts que pilListerBillets_ : les billets payés mais pas
// encore nominatifs restent des billets du club.
function pilIndexBillets_(eventId) {
  const idx = {};
  const ajouter = function (t) {
    const o = pilClientBillet_(t);
    if (t.barcode) idx['bc:' + t.barcode] = o;
    if (t._id) idx[t._id] = o;
  };
  pilParcourirBillets_(eventId, ajouter);
  try { pilParcourirBillets_(eventId, ajouter, 'DETAILSREQUIRED'); } catch (e) {}
  return idx;
}
// ID_MATCH → id d'événement Tickie, lu dans 📅 MATCHS.
function pilEventParMatch_() {
  const out = {};
  try {
    const sh = feuille_('MATCHS');
    if (!sh || sh.getLastRow() < 2) return out;
    const d = sh.getDataRange().getValues(), h = d[0].map(String);
    const cId = h.indexOf('ID_MATCH'), cEv = h.indexOf('TICKIE_EVENT_ID');
    if (cId < 0 || cEv < 0) return out;
    d.slice(1).forEach(function (r) { if (r[cId] && r[cEv]) out[String(r[cId])] = String(r[cEv]); });
  } catch (e) {}
  return out;
}

// Instantané de billetterie d'un match : les chiffres Tickie, calculés HORS requête.
//
// doGet ne doit jamais parcourir Tickie. Mesure du 25/11/2026 : un parcours dure 40 à
// 160 s, le tableau de bord redemande toutes les 30 s, donc trois ou quatre parcours
// étaient en vol en permanence et le cache — écrit seulement à la FIN d'un parcours —
// n'avait jamais le temps de servir. Deux appels consécutifs : 110,8 s puis 87,2 s.
// Allonger une durée de cache ne corrige pas ça ; sortir le parcours de la requête, oui.
const PIL_SNAP_PRE = 'PIL_BILLET_SNAP_';
function pilBilletterieSnap_(eventId) { return pilProp_(PIL_SNAP_PRE + eventId, null); }

// Calcule et enregistre l'instantané. Appelé par pilotageRechauffer (toutes les 5 min),
// jamais par une requête de tablette. « figé » = match passé : ses chiffres ne bougeront
// plus, le réchauffement ne le recalcule pas.
function pilCalculerBilletterie_(eventId, forcer) {
  const ev = pilEvent_(eventId);
  if (!ev) return null;
  const b = pilCompterBillets_(eventId, 1800, forcer);
  let abonnes = null;
  // Les abonnements ne bougent pas d'un match à l'autre : une heure de cache, jamais forcée.
  try { abonnes = pilCompterBillets_(PIL.ABONNEMENT_EVENT_ID, 3600).total; } catch (e) {}
  const snap = { billets: b.total, payants: b.payants, invitations: b.invitations, parTarif: b.parTarif,
    abonnes: abonnes, entrees: pilCompterEntrees_(eventId, forcer), jauge: ev.jauge,
    calcule: new Date().toISOString(), fige: ev.dateMatch < pilDate_(new Date()) };
  // On ne garde une propriété que pour un événement du CLUB. Le sélecteur du tableau de
  // bord liste les cent événements Tickie du compte (France Avenir, FFVB…) : garder un
  // instantané pour chacun remplirait le magasin de propriétés, dont le quota de 500 Ko
  // est partagé avec PIL_STOCK, PIL_CLOTURE_ et PIL_PREPA_ — qui, eux, ne sont pas
  // enveloppés dans un try : à saturation, c'est la remontée des ventes des tablettes et
  // la clôture de caisse qui échouent. Un événement hors club est donc recalculé à
  // chaque consultation, ce qui reste exceptionnel.
  let duClub = false;
  try { const m = pilEventParMatch_(); duClub = Object.keys(m).some(function (k) { return m[k] === eventId; }); } catch (e) {}
  if (duClub) { try { pilSetProp_(PIL_SNAP_PRE + eventId, snap); } catch (e) {} }
  return snap;
}

// Taux de présence d'un match joué : entrées scannées / (billets + abonnés).
// Définitif une fois le match passé, donc gelé dans une propriété.
// calculer = false (les requêtes) : on renvoie le taux gelé ou rien, et on ne
// parcourt JAMAIS Tickie. calculer = true : réservé au réchauffement.
// On ne gèle que si le nombre d'abonnés a bien été lu : sans lui le taux serait
// surestimé, et une fois gelé il ne se corrigerait plus.
// Dégel : supprimer PIL_TAUX_EV_<id événement> dans les propriétés du script.
function pilTauxPresence_(eventId, abonnes, calculer) {
  const fige = pilProp_('PIL_TAUX_EV_' + eventId, null);
  if (fige != null) return Number(fige);
  if (!calculer) return null;
  try {
    const e = pilCompterEntrees_(eventId);
    if (!(e > 0)) return null;
    const bb = pilCompterBillets_(eventId, 3600).total;
    if (bb + abonnes <= 0) return null;
    const t = e / (bb + abonnes);
    let passe = false;
    try { const ev = pilEvent_(eventId); passe = !!ev && ev.dateMatch < pilDate_(new Date()); } catch (e2) {}
    if (passe && abonnes > 0) { try { pilSetProp_('PIL_TAUX_EV_' + eventId, t); } catch (e2) {} }
    return t;
  } catch (e) { return null; }
}

// Lu par les requêtes. Renvoie l'instantané et ne parcourt Tickie que s'il n'en existe
// AUCUN pour ce match — le cas d'un match qu'on ouvre pour la première fois. Un jeton de
// cache empêche alors deux calculs simultanés. Ce jeton n'est pas un verrou atomique
// (deux exécutions à la même seconde peuvent passer toutes les deux), mais il ramène un
// empilement de quatre parcours à un ou deux, et surtout il n'utilise PAS le verrou de
// script : celui-là est pris par les POST des tablettes, et le bloquer 100 s ferait
// attendre un bénévole au comptoir.
function pilBilletterieServie_(eventId) {
  const snap = pilBilletterieSnap_(eventId);
  if (snap) return snap;
  const c = CacheService.getScriptCache(), jeton = 'pil_snap_calcul_' + eventId;
  if (c.get(jeton)) return null;
  // Le jeton vaut 90 s : si l'exécution est tuée avant le finally, il reste posé et tous
  // les appels renvoient null le temps de son expiration. Mieux vaut un doublon de
  // parcours rare qu'un tableau de bord vide cinq minutes.
  try { c.put(jeton, '1', 90); } catch (e) {}
  let ok = false;
  try { const r = pilCalculerBilletterie_(eventId); ok = !!r; return r; }
  catch (e) { Logger.log('Billetterie ' + eventId + ' : ' + (e && e.message || e)); return null; }
  // En cas d'ÉCHEC on garde le jeton : Tickie en panne et un tableau de bord qui
  // redemande toutes les 30 s rempileraient les parcours comme le 25/11.
  finally { if (ok) { try { c.remove(jeton); } catch (e) {} } }
}

// ── Nom d'événement Tickie → adversaire des Spacer's ────────────────────
// Les soirées doubles portent DEUX « vs » (« France Avenir vs Nantes & Spacer's vs Nice ») :
// l'adversaire est celui du segment des Spacer's, jamais le premier « vs » de la chaîne.
// Apostrophe typographique (’ ‘ ʼ ` ´), espace insécable, casse et accents sont indifférents.
const PIL_NOM_REMPL = { '\u2019': "'", '\u2018': "'", '\u02BC': "'", '\u0060': "'", '\u00B4': "'",
  '\u00A0': ' ', '\u202F': ' ', '\u2007': ' ', '\u2009': ' ', '\u200B': ' ' };
const PIL_ACCENTS = 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ';
const PIL_SANS_ACCENT = 'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY';
// Normalisation caractère par caractère : la chaîne garde la MÊME longueur, donc les index
// trouvés sur la version normalisée restent valables sur le nom d'origine (accents conservés).
function pilNomNorm_(s) {
  const t = String(s == null ? '' : s);
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t.charAt(i);
    if (PIL_NOM_REMPL[c] != null) { out += PIL_NOM_REMPL[c]; continue; }
    const k = PIL_ACCENTS.indexOf(c);
    out += k < 0 ? c : PIL_SANS_ACCENT.charAt(k);
  }
  return out;
}
// Adversaire des Spacer's dans un nom d'événement Tickie, ou null si le nom ne contient pas de
// segment Spacer's : on ne devine JAMAIS (un faux adversaire casse 📅 MATCHS et tout ce qui s'y rattache).
function pilAdversaireTickie_(nom) {
  const brut = String(nom == null ? '' : nom), norm = pilNomNorm_(brut);
  const m = norm.match(/spacer'?s?\s*vs\.?\s+/i);
  if (!m) return null;
  const deb = m.index + m[0].length;
  const suite = norm.slice(deb);
  const fin = suite.search(/\s+[-–—]|\s*[&·]|$/);
  const adv = brut.slice(deb, fin < 0 ? brut.length : deb + fin).trim().replace(/[\s\-–—&·]+$/, '');
  return adv || null;
}
function pilIdm_(adv, dateMatch) {
  return String(adv).replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 3).toUpperCase() + '-' + dateMatch.slice(8, 10) + '-' + dateMatch.slice(5, 7);
}
// Combien de cellules AILLEURS que dans 📅 MATCHS portent cet ID_MATCH (ventes, détail, clôtures…).
// En cas de doute on renvoie 1 : on ne renomme pas un ID auquel des données peuvent être rattachées.
function pilCompterRefs_(idm) {
  if (!idm) return 0;
  const sh = feuille_('MATCHS'), nom = sh ? sh.getName() : '';
  try {
    return SpreadsheetApp.getActiveSpreadsheet().createTextFinder(String(idm)).matchEntireCell(true).matchCase(true)
      .findAll().filter(function (rg) { return rg.getSheet().getName() !== nom; }).length;
  } catch (e) { return 1; }
}
// Renomme les propriétés indexées par ID_MATCH. Renvoie la liste des conflits rencontrés,
// pour qu'ils apparaissent dans le rapport de synchronisation.
//
// Les familles indexées par match sont PIL_PREPA_, PIL_INVENTAIRE_, PIL_CLOTURE_,
// PIL_REASSORTS_ et PIL_PMP_ (le PMP figé du match). Un test vérifie cette liste en rescannant
// le code : toute nouvelle famille suffixée par un ID_MATCH doit être ajoutée ICI, sinon un
// renommage la laisse orpheline. PIL_BILLET_SNAP_ et les familles suffixées _EV_
// (PIL_ENTREES_EV_, PIL_TAUX_EV_,
// gelées après un match joué) sont indexées par ID D'ÉVÉNEMENT TICKIE et non par ID_MATCH :
// elles n'entrent donc PAS dans cette liste.
// PIL_REASSORTS_ manquait : un renommage déplaçait la préparation, l'inventaire
// et la clôture mais laissait le journal des réassorts orphelin sous l'ancien ID, donc
// introuvable. Depuis que le départ réel vaut « déclaré + journal », cet oubli efface
// directement du stock du coût matière.
//
// Et quand la destination existait déjà, le deleteProperty s'exécutait quand même : le
// contenu de la source était détruit sans trace, sans message et sans journal. On ne
// supprime plus rien dans ce cas. Une propriété laissée sous un ID absent de 📅 MATCHS est
// simplement ignorée par les calculs (pilStockClub_ saute les ID sans date), donc la garder
// ne fausse aucun chiffre et la rend récupérable à la main.
function pilRenommerProps_(a, b) {
  const p = PropertiesService.getScriptProperties();
  const conflits = [];
  // Porte de sortie : poser la propriété de script PIL_RENOMMAGE_OFF = 1 neutralise le SEUL
  // renommage d'ID_MATCH. Le reste de la synchronisation (adversaires, billets, affluences,
  // fidélité) continue normalement. Se règle dans Paramètres du projet → Propriétés du script,
  // sans coller de code. À retirer une fois le doute levé.
  if (String(p.getProperty('PIL_RENOMMAGE_OFF') || '') === '1') {
    return ['renommage neutralisé (PIL_RENOMMAGE_OFF = 1) : propriétés de ' + a + ' laissées en place'];
  }
  ['PIL_PREPA_', 'PIL_INVENTAIRE_', 'PIL_CLOTURE_', 'PIL_REASSORTS_', 'PIL_PMP_'].forEach(function (pre) {
    const v = p.getProperty(pre + a);
    if (v == null) return;
    const dest = p.getProperty(pre + b);
    if (dest == null) { p.setProperty(pre + b, v); p.deleteProperty(pre + a); return; }
    if (dest === v) { p.deleteProperty(pre + a); return; }        // contenu identique : rien à perdre
    conflits.push(pre + b + ' existe déjà avec un autre contenu : ' + pre + a + ' CONSERVÉ, à arbitrer à la main');
  });
  const act = pilActif_();
  if (act && act.idMatch === a) { act.idMatch = b; p.setProperty('PIL_MATCH_ACTIF', JSON.stringify(act)); }
  return conflits;
}
// Répare les lignes déjà écrites avec le mauvais adversaire (soirées doubles mal découpées).
// Lancé à chaque synchronisation : la correction est portée par le code, pas par une saisie à la main.
function pilCorrigerAdversaires_(evs) {
  const sh = feuille_('MATCHS');
  if (!sh) return [];
  const d = sh.getDataRange().getValues(), h = d[0].map(String);
  const cId = h.indexOf('ID_MATCH'), cAdv = h.indexOf('ADVERSAIRE'), cEv = h.indexOf('TICKIE_EVENT_ID');
  if (cId < 0 || cAdv < 0 || cEv < 0) return [];
  const rapport = [];
  evs.forEach(function (ev) {
    const adv = pilAdversaireTickie_(ev.nom);
    if (!adv) { rapport.push('⚠️ « ' + ev.nom + ' » : segment « Spacer\'s vs » introuvable, ligne laissée en l\'état (à vérifier dans Tickie)'); return; }
    for (let r = 1; r < d.length; r++) {
      if (String(d[r][cEv]) !== String(ev.id)) continue;
      const idAct = String(d[r][cId]), advAct = String(d[r][cAdv] || '');
      if (pilNomNorm_(advAct).toLowerCase().trim() === pilNomNorm_(adv).toLowerCase().trim()) return;   // déjà bon
      sh.getRange(r + 1, cAdv + 1).setValue(adv);
      let note = '🛠️ ' + (idAct || '(sans ID)') + ' : adversaire « ' + (advAct || 'vide') + ' » → « ' + adv + ' »';
      const idAttendu = pilIdm_(adv, ev.dateMatch);
      if (idAttendu !== idAct) {
        const n = pilCompterRefs_(idAct);
        if (n) note += ' · ID_MATCH gardé (' + n + ' ligne(s) déjà rattachée(s) à ' + idAct + ')';
        else {
          sh.getRange(r + 1, cId + 1).setValue(idAttendu);
          const conflits = pilRenommerProps_(idAct, idAttendu);
          note += ' · ID_MATCH → ' + idAttendu;
          // Un conflit de renommage ne doit pas passer inaperçu : il remonte dans le rapport
          // de synchronisation, au même endroit que la correction qui l'a provoqué.
          if (conflits.length) note += ' · ⚠️ ' + conflits.join(' · ');
        }
      }
      rapport.push(note);
      return;
    }
  });
  return rapport;
}

// ── 📅 MATCHS : retrouver / créer l'ID_MATCH d'un match Tickie ───────────
function pilIdMatch_(ev, creer) {
  const sh = feuille_('MATCHS');
  if (!sh) throw new Error('Onglet 📅 MATCHS introuvable');
  const d = sh.getDataRange().getValues(), h = d[0].map(String);
  const cId = h.indexOf('ID_MATCH'), cDate = h.indexOf('DATE');
  let cEv = h.indexOf('TICKIE_EVENT_ID');
  if (cEv >= 0) for (let r = 1; r < d.length; r++) if (String(d[r][cEv]) === ev.id) return String(d[r][cId]);
  for (let r = 1; r < d.length; r++) {
    const dv = d[r][cDate];
    if (dv && d[r][cId] && pilDate_(dv instanceof Date ? dv : new Date(dv)) === ev.dateMatch) {
      if (creer) { if (cEv < 0) cEv = pilAjouterColonne_(sh, 'TICKIE_EVENT_ID'); sh.getRange(r + 1, cEv + 1).setValue(ev.id); }
      return String(d[r][cId]);
    }
  }
  if (!creer) return '';
  // Adversaire = segment « Spacer's vs … » du nom Tickie. Introuvable : on n'invente pas de ligne.
  const adv = pilAdversaireTickie_(ev.nom);
  if (!adv) { Logger.log('Nom Tickie sans segment Spacer\'s, match non créé : ' + ev.nom); return ''; }
  const idm = pilIdm_(adv, ev.dateMatch);
  if (cEv < 0) cEv = pilAjouterColonne_(sh, 'TICKIE_EVENT_ID');
  const hh = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(ligneMatch_(hh, {
    'ID_MATCH': idm, 'DATE': new Date(ev.dateMatch + 'T12:00:00'), 'ADVERSAIRE': adv,
    'COMPÉTITION': /coupe|cdf/i.test(ev.nom) ? 'Coupe de France' : 'Championnat',
    'STATUT': ev.dateMatch > pilDate_(new Date()) ? 'À VENIR' : 'JOUÉ', 'SAISON': pilSaison_(ev.dateMatch),
    'TICKIE_EVENT_ID': ev.id, 'MODE BUVETTE': 'DIRECT' }));
  return idm;
}
function pilModeDirect_(idm) {
  const sh = feuille_('MATCHS');
  const d = sh.getDataRange().getValues(), h = d[0].map(String), cId = h.indexOf('ID_MATCH');
  let c = col_(h, 'MODE BUVETTE');
  for (let r = 1; r < d.length; r++) if (String(d[r][cId]) === idm) {
    if (c < 0) c = pilAjouterColonne_(sh, 'MODE_BUVETTE');
    sh.getRange(r + 1, c + 1).setValue('DIRECT');
    return;
  }
}
function pilAjouterColonne_(sh, nom) {
  const c = sh.getLastColumn();
  styleEntete_(sh.getRange(1, c + 1).setValue(nom));
  return c;
}
function pilSaison_(dateStr) {
  const sh = feuille_('SAISONS');
  if (!sh) return '';
  const d = sh.getDataRange().getValues();
  for (let r = 0; r < d.length; r++) {
    if (!(d[r][2] instanceof Date) || !(d[r][3] instanceof Date)) continue;   // ligne de titre ou d'en-tête
    const deb = pilDate_(d[r][2]), fin = pilDate_(d[r][3]);
    if (deb && fin && dateStr >= deb && dateStr <= fin) return String(d[r][0]);
  }
  return '';
}

// ── Données gardées dans les propriétés du script ─────────────────────────
function pilProp_(k, def) { try { const v = PropertiesService.getScriptProperties().getProperty(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
function pilSetProp_(k, v) { PropertiesService.getScriptProperties().setProperty(k, JSON.stringify(v)); }

// ── Préparation (stock de départ) ────────────────────────────────────────
function pilEnregistrerPrepa_(eventId, stocks) {
  const ev = pilEvent_(eventId);
  if (!ev) throw new Error('Match introuvable dans Tickie');
  const idm = pilIdMatch_(ev, true);
  pilModeDirect_(idm);                                    // la buvette 26-27 est exploitée en direct
  const now = new Date();
  const prepa = pilStocksPrepa_(idm);
  Object.keys(stocks).forEach(function (b) {
    if (!prepa[b]) return;
    Object.keys(stocks[b]).forEach(function (ref) { prepa[b][ref] = Math.max(0, Math.round((Number(stocks[b][ref]) || 0) * 100) / 100); });
  });
  pilSetProp_('PIL_PREPA_' + idm, prepa);
  // Enregistrer la préparation d'un match PASSÉ (correction d'après-match) ne doit pas
  // déplacer le match actif : une tablette qui se charge à cet instant encaisserait sur
  // le match d'avant. On ne bascule que vers un match du jour ou à venir.
  const aujourdhui = pilDate_(now);
  const futur = !ev.dateMatch || ev.dateMatch >= aujourdhui;
  const actifAvant = pilActif_();
  if (futur) {
    const actifCell = SpreadsheetApp.getActiveSpreadsheet().getRangeByName('MATCH_ACTIF');   // 🏠 ACCUEIL
    if (actifCell) actifCell.setValue(idm); else { const pilot = pilSheet_('PILOTAGE'); if (pilot) pilot.getRange('B9').setValue(idm); }
    PropertiesService.getScriptProperties().setProperty('PIL_MATCH_ACTIF', JSON.stringify({ eventId: eventId, idMatch: idm, saved: now.toISOString() }));
    return { idMatch: idm, saved: now.toISOString(), actif: true };
  }
  return { idMatch: idm, saved: now.toISOString(), actif: false,
    actifInchange: actifAvant ? actifAvant.idMatch : '',
    message: 'Stock enregistré pour ' + idm + ' (match déjà joué) : le match actif des tablettes n\'a pas été déplacé'
      + (actifAvant && actifAvant.idMatch ? ' (toujours ' + actifAvant.idMatch + ')' : '') + '.' };
}
// ── Réassorts : journalisés, et ajoutés AU MOMENT DE LA LECTURE ──────────
// PIL_PREPA_<idm> ne contient désormais QUE le départ déclaré au tableau de bord.
// Le stock reçu en cours de match vit dans PIL_REASSORTS_<idm> et s'ajoute à la lecture.
// Pourquoi : PIL_PREPA était un total mutable mélangeant les deux sources, et
// pilEnregistrerPrepa_ l'écrase ligne à ligne depuis le formulaire. Un formulaire chargé
// avant un réassort (la boucle d'auto-rafraîchissement ne recharge pas la préparation)
// reversait donc le total et effaçait définitivement le réassort, qu'aucun calcul ne
// relisait dans son journal. Désormais aucune sauvegarde ne peut plus l'effacer.
//
// Seules les entrées qui déclarent EXPLICITEMENT ne pas avoir été appliquées (applique === false)
// sont additionnées. Ce drapeau n'est écrit que par le code ci-dessous. Toute entrée sans drapeau
// vient de l'ancien code, qui l'additionnait lui-même dans PIL_PREPA : la compter ici la
// compterait deux fois. Le défaut est donc volontairement du côté sans risque — un réassort
// ancien reste tel qu'il a été enregistré, jamais doublé.
//
// Conséquence voulue : la correction tient même si migrerReassortsAppliques() n'est pas lancée.
// Cette migration ne fait plus que rendre l'état explicite pour l'audit. Et pendant la fenêtre où
// des tablettes anciennes parlent au serveur nouveau, rien ne change : la tablette n'écrit jamais
// PIL_PREPA (elle n'a pas accès aux propriétés du script), elle ne fait que poster son réassort.
// C'est le serveur qui décide, donc une seule version du calcul s'applique à la fois.
function pilReassortsTotaux_(idm) {
  const out = {};
  pilProp_('PIL_REASSORTS_' + idm, []).forEach(function (x) {
    if (!x || x.applique !== false) return;
    const b = String(x.buvette || ''); if (!b) return;
    out[b] = out[b] || {};
    Object.keys(x.ajout || {}).forEach(function (ref) {
      const q = Number(x.ajout[ref]) || 0;
      if (q > 0) out[b][ref] = Math.round(((out[b][ref] || 0) + q) * 100) / 100;
    });
  });
  return out;
}
// Départ RÉEL du match = départ déclaré + réassorts non encore intégrés.
// C'est la seule base à utiliser pour le coût matière, le mouvement du stock du club
// et le stock théorique des tablettes. pilStocksPrepa_ reste le départ déclaré seul,
// réservé au formulaire du tableau de bord et à son enregistrement.
function pilStocksDepart_(idm) {
  const out = pilStocksPrepa_(idm), rea = pilReassortsTotaux_(idm);
  Object.keys(rea).forEach(function (b) {
    if (!out[b]) return;
    Object.keys(rea[b]).forEach(function (ref) {
      if (out[b][ref] == null) return;
      out[b][ref] = Math.round((out[b][ref] + rea[b][ref]) * 100) / 100;
    });
  });
  return out;
}
// Stock reçu pendant le match, saisi sur la tablette : journalisé ici, jamais écrit dans PIL_PREPA
function pilEnregistrerReassort_(r) {
  if (!r.id || !r.matchId || PIL.BUVETTES.indexOf(r.buvette) < 0) throw new Error('Réassort incomplet');
  const deja = pilProp_('PIL_REASSORTS_' + r.matchId, []);
  const actif = pilActif_();
  if (deja.some(function (x) { return x.id === r.id; })) return { recu: r.id, prepa: actif && actif.idMatch === r.matchId ? actif.saved : null };
  const connues = pilStocksPrepa_(r.matchId), ajout = {}, refuses = [];
  Object.keys(r.ajout || {}).forEach(function (ref) {
    const q = Math.round((Number(r.ajout[ref]) || 0) * 100) / 100;
    if (q <= 0) return;
    // Référence inconnue de 📦 PRODUITS : on la refuse, mais on le DIT (avant, l'ajout
    // disparaissait en silence et le journal gardait un ajout vide, impossible à expliquer après coup).
    if ((connues[r.buvette] || {})[ref] == null) { refuses.push(ref); return; }
    ajout[ref] = q;
  });
  // On journalise TOUJOURS, même si tout a été refusé : faire échouer la requête ferait
  // réessayer la tablette sans fin (boucle de reprise). Les refus repartent dans la réponse
  // pour être affichés au comptoir — c'est le silence de l'ancien code qui a rendu
  // les écarts de Tours inexplicables, pas le refus lui-même.
  deja.push({ id: r.id, ts: r.ts, buvette: r.buvette, ajout: ajout, applique: false, recu: new Date().toISOString(), refuses: refuses });
  pilSetProp_('PIL_REASSORTS_' + r.matchId, deja);
  let saved = null;
  if (actif && actif.idMatch === r.matchId) {   // nouveau repère : le tableau de bord et les autres tablettes voient le changement
    saved = new Date().toISOString(); actif.saved = saved;
    PropertiesService.getScriptProperties().setProperty('PIL_MATCH_ACTIF', JSON.stringify(actif));
  }
  try { if (typeof majMatchs === 'function') majMatchs(true); } catch (e) {}
  return { recu: r.id, prepa: saved, refuses: refuses, ajout: ajout };
}
function pilStocksPrepa_(idm) {
  const out = {}, saved = pilProp_('PIL_PREPA_' + idm, {});
  PIL.BUVETTES.concat(PIL.RESERVES).forEach(function (b) { out[b] = {}; pilLignesStock_().forEach(function (p) { out[b][p[0]] = Number((saved[b] || {})[p[0]]) || 0; }); });
  return out;
}
// Fond de caisse déclaré pour un match, buvette par buvette : { 'Buvette 1': 400, … }.
// Règle du registre transverse (décision du 07/11) : le fond n'est pas fixe, il est
// communiqué avant chaque match. Il n'y a donc pas de valeur de saison, et une buvette
// dont le fond n'a pas été déclaré ne reçoit aucun chiffre plutôt qu'un chiffre faux.
function pilFondsMatch_(idm) {
  if (!idm) return {};
  const o = pilProp_('PIL_FONDS_' + idm, null);
  return o && typeof o === 'object' ? o : {};
}
// Déclare le fond de caisse d'un match. Appelée depuis le menu ou le tableau de bord.
function pilDeclarerFonds_(idm, fonds) {
  if (!idm) throw new Error('ID_MATCH manquant');
  const o = {};
  Object.keys(fonds || {}).forEach(function (b) {
    if (PIL.BUVETTES.indexOf(b) < 0) return;
    const v = Number(fonds[b]);
    if (v > 0) o[b] = v;
  });
  pilSetProp_('PIL_FONDS_' + idm, o);
  return o;
}
// Saisie du fond de caisse depuis le menu, pour le match actif.
function pilotageFondsCaisse() {
  const ui = SpreadsheetApp.getUi(), actif = pilActif_();
  if (!actif || !actif.idMatch) { ui.alert('Aucun match préparé : enregistre d\'abord le stock au tableau de bord.'); return; }
  const avecCaisse = PIL.BUVETTES.filter(function (b) { return PIL.BUVETTES_SANS_CAISSE.indexOf(b) < 0; });
  const actuel = pilFondsMatch_(actif.idMatch);
  const r = ui.prompt('Fond de caisse — ' + actif.idMatch,
    'Un montant en euros par buvette, dans l\'ordre ' + avecCaisse.join(', ') + ', séparés par des virgules.\n'
    + 'Exemple : 400, 500\n\nActuellement : '
    + (Object.keys(actuel).length ? avecCaisse.map(function (b) { return b + ' ' + (actuel[b] || '—') + ' €'; }).join(' · ') : 'rien de déclaré'),
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const vals = String(r.getResponseText()).split(/[,;]/).map(function (x) { return Number(String(x).replace(',', '.').trim()); });
  const fonds = {};
  avecCaisse.forEach(function (b, i) { if (vals[i] > 0) fonds[b] = vals[i]; });
  if (!Object.keys(fonds).length) { ui.alert('Aucun montant lisible, rien n\'a été enregistré.'); return; }
  const ecrit = pilDeclarerFonds_(actif.idMatch, fonds);
  ui.alert('✅ Fond de caisse de ' + actif.idMatch + ' : '
    + Object.keys(ecrit).map(function (b) { return b + ' ' + ecrit[b] + ' €'; }).join(' · ')
    + '\n\nLe fond saisi par le bénévole à la clôture reste prioritaire sur cette valeur.');
}

function pilActif_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('PIL_MATCH_ACTIF') || 'null'); } catch (e) { return null; } }
function pilLirePrepa_(eventId) {
  const actif = pilActif_();
  let idm = '';
  if (eventId) { const ev = pilEvent_(eventId); if (ev) idm = pilIdMatch_(ev, false); }
  else if (actif) { idm = actif.idMatch; eventId = actif.eventId; }
  return { eventId: eventId || '', idMatch: idm, actif: actif, lignes: pilLignesStock_(), buvettes: PIL.BUVETTES, reserves: PIL.RESERVES,
    // stocks = départ DÉCLARÉ (ce que le formulaire rééditera) ; depart = déclaré + réassorts
    // (affiché à titre indicatif). Les deux sont distincts pour qu'une sauvegarde du
    // tableau de bord ne puisse jamais réenregistrer un réassort comme du déclaré.
    stocks: idm ? pilStocksPrepa_(idm) : null, depart: idm ? pilStocksDepart_(idm) : null,
    reassortsTotaux: idm ? pilReassortsTotaux_(idm) : {}, tablettes: pilLireJournal_(),
    inventaire: idm ? pilProp_('PIL_INVENTAIRE_' + idm, {}) : {}, reassorts: idm ? pilProp_('PIL_REASSORTS_' + idm, []) : [],
    clotures: idm ? pilProp_('PIL_CLOTURE_' + idm, {}) : {}, futLitres: PIL.FUT_LITRES };
}

// Ce que la tablette emporte en buvette pour travailler hors ligne
function pilChargerTablette_(buvette) {
  if (PIL.BUVETTES.indexOf(buvette) < 0) throw new Error('Buvette inconnue');
  const actif = pilActif_();
  if (!actif) throw new Error('Aucun match préparé : saisis le stock dans le tableau de bord');
  const ev = pilEvent_(actif.eventId) || { id: actif.eventId, nom: actif.idMatch, date: '' };
  // La liste des billets est le gros du chargement : elle déroule TOUS les billets du match
  // et TOUS les abonnements, par pages de 1000. Elle est REMPLIE À L'AVANCE par
  // pilotageRechauffer : aucune tablette n'attend le parcours, et les trois se partagent le
  // même travail. Le mécanisme, et ce qui se passe quand le cache est vide, sont décrits
  // dans pilListeBilletsTablette_.
  //
  // billetsOk à faux veut dire « liste non rafraîchie », pas « liste vide » : la tablette
  // garde alors celle qu'elle a en mémoire (index.html) plutôt que de perdre ses remises.
  let billets = [], billetsOk = true;
  try {
    const l = pilListeBilletsTablette_(ev.id);
    if (l) billets = l; else billetsOk = false;
  } catch (e) { billetsOk = false; }
  pilJournal_(buvette, actif.idMatch, 3);
  return { match: { eventId: ev.id, idMatch: actif.idMatch, nom: ev.nom, date: ev.date, prepa: actif.saved },
    // départ réel (réassorts compris) : le stock théorique de la tablette les intègre
    buvette: buvette, stock: pilStocksDepart_(actif.idMatch)[buvette], futLitres: PIL.FUT_LITRES, produits: pilPrixTablette_(),
    // Structure de stock lue dans 📦 PRODUITS : { réf: { unite, services } }. La tablette s'en sert pour
    // convertir verres/doses ↔ bouteilles ; sans réseau elle garde ses valeurs par défaut.
    stockCat: (function () { const o = {}; pilLignesStock_().forEach(function (l) { o[l[0]] = { unite: l[3], services: l[4] }; }); return o; })(),
    billets: billets, billetsOk: billetsOk, offertes: pilBoissonsOffertes_(actif.idMatch), hh: pilHappyHourServies_(actif.idMatch), charge: new Date().toISOString() };
}
// Billets « place + boisson » dont la boisson a déjà été donnée pendant ce match (toutes buvettes), ventes annulées exclues
function pilBoissonsOffertes_(idm) {
  try {
    const sh = feuille_('VENTES');
    if (!sh || sh.getLastRow() < 2) return [];
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, PIL_NB).getValues(), annulees = {}, out = {};
    data.forEach(function (r) { const m = String(r[PIL_I['Fidélité']]).match(/^annulation de (.+?)(\s·|$)/); if (m) annulees[m[1]] = 1; });
    data.forEach(function (r) {
      if (String(r[PIL_I['ID_MATCH']]) !== String(idm) || annulees[String(r[PIL_I['ID vente']])]) return;
      const f = String(r[PIL_I['Fidélité']]), code = String(r[PIL_I['Code-barres']] || '').trim().toLowerCase();
      if (code && /boisson offerte/.test(f) && !/^annulation/.test(f)) out[code] = 1;
    });
    return Object.keys(out);
  } catch (e) { return []; }
}

// Boissons happy hour déjà servies pendant ce match (toutes buvettes) : [[id vente, code-barres, nb]], ventes annulées exclues.
// Lu dans la note de la colonne Fidélité (« happy hour 50 % : 2 boissons · … »).
function pilHappyHourServies_(idm) {
  try {
    const sh = feuille_('VENTES');
    if (!sh || sh.getLastRow() < 2) return [];
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, PIL_NB).getValues(), annulees = {}, out = [];
    data.forEach(function (r) { const m = String(r[PIL_I['Fidélité']]).match(/^annulation de (.+?)(\s·|$)/); if (m) annulees[m[1]] = 1; });
    data.forEach(function (r) {
      const id = String(r[PIL_I['ID vente']]);
      if (String(r[PIL_I['ID_MATCH']]) !== String(idm) || annulees[id]) return;
      const f = String(r[PIL_I['Fidélité']]), code = String(r[PIL_I['Code-barres']] || '').trim().toLowerCase();
      const m = f.match(/happy hour \d+ % : (\d+) boisson/);
      if (code && m && !/^annulation/.test(f)) out.push([id, code, Number(m[1])]);
    });
    return out;
  } catch (e) { return []; }
}

// Prix de vente et seuils de 📦 PRODUITS envoyés aux tablettes (réf → {prix, seuil})
function pilPrixTablette_() {
  const cat = produitsCatalogue_(), out = {};
  pilColsVentes_().forEach(function (ref) {
    const c = cat[ref], p = pilProd_(ref);
    const prix = c && c.prix > 0 ? c.prix : p.prix;
    if (prix > 0) out[ref] = { prix: prix, seuil: c && c.seuil != null ? c.seuil : p.seuil };
  });
  return out;
}

// Remise billet / abonné hors happy hour (la tablette envoie le total des deux dans « remise »)
function pilRemiseHorsHh_(v) {
  const r = Number(v.remise) || 0, h = v.hh ? Number(v.hh.montant) || 0 : 0;
  return Math.round((r - h) * 100) / 100;
}

// ── Réception des ventes ─────────────────────────────────────────────────
function pilEnregistrerVentes_(ventes) {
  const sh = feuille_('VENTES');
  if (!sh) throw new Error('Pilotage non initialisé (menu 📡 Pilotage live → Initialiser)');
  const vd = pilEnsureVdHeader_();
  try { pilMigrerColonnesVentes_(); } catch (e) { Logger.log('Colonnes 🧾 VENTES : ' + e.message); }
  const cPay = pilColPaiement_();
  if (sh.getMaxColumns() < cPay + 1) sh.insertColumnsAfter(sh.getMaxColumns(), cPay + 1 - sh.getMaxColumns());
  const hPay = sh.getRange(1, cPay + 1);
  if (!hPay.getValue()) hPay.setValue('Paiement').setBackground(NAVY).setFontColor(YELLOW).setFontWeight('bold');
  const last = sh.getLastRow(), deja = {};
  if (last > 1) sh.getRange(2, PIL_I['ID vente'] + 1, last - 1, 1).getValues().forEach(function (r) { deja[String(r[0])] = 1; });
  const nr = pilNrSheet_(), nrDeja = {}, nrRows = [];
  if (nr.getLastRow() > 1) nr.getRange(2, 3, nr.getLastRow() - 1, 1).getValues().forEach(function (r) { nrDeja[String(r[0])] = 1; });
  const rows = [], vdRows = [], recus = [], now = new Date();
  ventes.forEach(function (v) {
    if (!v || !v.id) return;
    recus.push(v.id);                       // déjà reçue : accusé quand même (idempotence)
    if (v.paiement === 'NON_REMB' || v.paiement === 'LAISSE') {   // gobelets revenus sans remboursement : 0 €, onglet à part
      if (nrDeja[String(v.id)]) return;
      nrDeja[String(v.id)] = 1;
      const gn = v.gob || {}, rec = v.paiement === 'LAISSE';
      nrRows.push([now, new Date(v.ts || Date.now()), v.id, v.matchId || '', v.buvette || '',
        Number(rec ? gn.l33 : gn.n33) || 0, Number(rec ? gn.l50 : gn.n50) || 0, v.annule || '', rec ? 'RECUPERE' : 'PLUS_ESPECES']);
      return;
    }
    if (deja[String(v.id)]) return;
    deja[String(v.id)] = 1;
    const t = v.ticket || {}, ts = new Date(v.ts || Date.now()), idm = v.matchId || '', b = v.buvette || '', day = pilDate_(ts);
    const row = [now, ts, v.id, idm, b, Number(v.total) || 0, Number(v.consigne) || 0, Number(v.rendue) || 0,
      t.ticket_id || '', t.barcode || '', t.tarif || '', '',
      [v.annule ? 'annulation de ' + v.annule : '',
       v.offerte && v.offerte.ref ? 'boisson offerte ' + v.offerte.ref + ' (' + (v.profilRemise || 'billet') + ') : ' + (Number(v.offerte.montant) || 0).toFixed(2).replace('.', ',') + ' €' : '',
       // Même famille que le défaut du prix ci-dessous : « Number(x) || défaut » écrase un zéro
       // légitime. Ici et à la ligne suivante, le zéro est aujourd'hui impossible — l'expression
       // n'est évaluée que si Number(v.hh.n) puis pilRemiseHorsHh_(v) sont vrais, donc un taux
       // existe. Ces deux replis ne touchent que le libellé de la colonne Fidélité, pas l'argent.
       // Ne pas retirer ces gardes sans remplacer les || par un test d'absence explicite.
       v.hh && Number(v.hh.n) ? 'happy hour ' + Math.round((Number(v.hh.taux) || 0.5) * 100) + ' % : ' + Number(v.hh.n) + ' boisson' + (Number(v.hh.n) > 1 ? 's' : '') + ' · ' + (Number(v.hh.montant) || 0).toFixed(2).replace('.', ',') + ' €' : '',
       pilRemiseHorsHh_(v) ? 'remise ' + (v.profilRemise === 'ABO' ? 'abonné' : v.profilRemise && !PIL.BILLETS_BOISSON[v.profilRemise] ? v.profilRemise : 'billet') + ' ' + Math.round((v.hh ? (v.profilRemise === 'ABO' || (v.profilRemise && !PIL.BILLETS_BOISSON[v.profilRemise]) ? 0.10 : 0.05) : (Number(v.tauxRemise) || 0.05)) * 100) + ' % : ' + pilRemiseHorsHh_(v).toFixed(2).replace('.', ',') + ' €' : '']
        .filter(Boolean).join(' · ')];
    pilColsVentes_().forEach(function (ref) { row.push(Number((v.lignes || {})[ref]) || 0); });
    row.push(v.paiement === 'CB' ? 'CB' : v.paiement === 'ESP' ? 'ESP' : v.paiement === 'BENEVOLE' ? 'BENEVOLE' : '');
    rows.push(row);
    Object.keys(v.lignes || {}).forEach(function (ref) {
      const q = Number(v.lignes[ref]) || 0, p = pilProduit_(ref);
      // Prix réellement encaissé par verre, envoyé par la tablette. Il vaut légitimement 0
      // quand la boisson offerte (billet « place + boisson ») est le seul avantage de la vente :
      // « Number(0) || p[2] » retombait alors sur le prix catalogue et écrivait la ligne plein
      // tarif, alors que le Total € encaissé était bien net. Il faut distinguer « absent »
      // (tablette ancienne, prix non transmis → prix catalogue) de « zéro » (gratuit, à garder).
      const px = (v.prix || {})[ref];
      const pu = (px === null || px === undefined || px === '' || isNaN(Number(px))) ? p[2] : Number(px);
      if (q) vdRows.push([idm, day, b, ref, p[1], q, pu, 0, q * pu, 0, v.paiement === 'BENEVOLE' ? (v.annule ? 'ANNULATION_BENEVOLE' : 'BENEVOLE') : v.annule ? 'ANNULATION' : 'VENTE']);
    });
    // Écocups par taille (E33 / E50) ; tablette ancienne version sans détail → E01
    const g = v.gob || null, typ = v.annule ? 'ANNULATION' : 'VENTE';
    if (g) {
      [33, 50].forEach(function (t) {
        const s = Number(g['s' + t]) || 0, r = Number(g['r' + t]) || 0;
        if (s) vdRows.push([idm, day, b, 'E' + t, 'Écocup ' + t + 'cl (consigne)', s, 0, 1, 0, s, typ]);
        if (r) vdRows.push([idm, day, b, 'E' + t, 'Écocup ' + t + 'cl rendu', r, 0, -1, 0, -r, 'REMBOURSEMENT_CONSIGNE']);
      });
    } else {
      if (v.consigne) vdRows.push([idm, day, b, 'E01', 'Écocup (consigne)', v.consigne, 0, 1, 0, v.consigne, 'VENTE']);
      if (v.rendue) vdRows.push([idm, day, b, 'E01', 'Remboursement consigne', v.rendue, 0, -1, 0, -v.rendue, 'REMBOURSEMENT_CONSIGNE']);
    }
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  if (vdRows.length) vd.getRange(vd.getLastRow() + 1, 1, vdRows.length, vdRows[0].length).setValues(vdRows);
  if (nrRows.length) nr.getRange(nr.getLastRow() + 1, 1, nrRows.length, PIL_NR_HDR.length).setValues(nrRows);
  return recus;
}

function pilDetailArchive_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PIL_DETAIL_ARCH_TAB);
  if (!sh) {
    sh = ss.insertSheet(PIL_DETAIL_ARCH_TAB);
    const h = ['SAISON'].concat(PIL_DETAIL_COLS.map(function (c) { return c[1]; })).concat(['FIGÉ LE']);
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

// Corriger un match déjà figé (ex. ventes arrivées très en retard) : ses lignes sont recalculées depuis les ventes
// puis figées à nouveau. Les autres matchs ne bougent pas.
function pilotageDetailRefiger() {
  const ui = SpreadsheetApp.getUi();
  const rep = ui.prompt('Recalculer un match figé', 'ID du match (ex. NAR-10-10) :', ui.ButtonSet.OK_CANCEL);
  if (rep.getSelectedButton() !== ui.Button.OK) return;
  const id = String(rep.getResponseText() || '').trim().toUpperCase();
  const sh = pilDetailArchive_(), d = sh.getDataRange().getValues();
  const garde = d.slice(1).filter(function (r) { return String(r[1]).toUpperCase() !== id; });
  if (garde.length === d.length - 1) { ui.alert('Aucune ligne figée pour ' + id + '.'); return; }
  if (d.length > 1) sh.getRange(2, 1, d.length - 1, d[0].length).clearContent();
  if (garde.length) sh.getRange(2, 1, garde.length, d[0].length).setValues(garde);
  pilotageDetailBuvette(true);
  ui.alert(id + ' recalculé depuis les ventes et figé à nouveau.');
}

function pilNrSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PIL_NR_TAB);
  if (!sh) {
    sh = ss.insertSheet(PIL_NR_TAB);
    const h = sh.getRange(1, 1, 1, PIL_NR_HDR.length).setValues([PIL_NR_HDR]).setFontWeight('bold');
    if (typeof NAVY !== 'undefined') h.setBackground(NAVY).setFontColor(typeof YELLOW !== 'undefined' ? YELLOW : '#ffffff');
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  if (sh.getMaxColumns() < PIL_NR_HDR.length) sh.insertColumnsAfter(sh.getMaxColumns(), PIL_NR_HDR.length - sh.getMaxColumns());
  const hm = sh.getRange(1, PIL_NR_HDR.length);
  if (!hm.getValue()) hm.setValue(PIL_NR_HDR[PIL_NR_HDR.length - 1]).setFontWeight('bold');   // onglet créé avant la colonne Motif
  return sh;
}

// ── Clôture de caisse envoyée par une tablette (rapport de fin de match) ──
function pilEnregistrerCloture_(c) {
  if (!c.buvette) throw new Error('Clôture incomplète');
  const idm = c.matchId || 'SANS_MATCH';
  const all = pilProp_('PIL_CLOTURE_' + idm, {});
  all[c.buvette] = { ts: c.ts, recu: new Date().toISOString(), ventes: c.ventes, ca: c.ca, cb: c.cb, nbCb: c.nbCb,
    esp: c.esp, nbEsp: c.nbEsp, fond: c.fond, attendu: c.attendu, compte: c.compte, ecart: c.ecart,
    gobeletsSortis: c.gobeletsSortis, gobeletsRendus: c.gobeletsRendus, gob: c.gob || null, stock: c.stock || {},
    tpe: c.tpe == null ? null : c.tpe, ecartCb: c.ecartCb == null ? null : c.ecartCb, tpeId: c.tpeId || '',
    // Contrat commerçant du terminal et conformité à la flotte buvette : un terminal d'un autre
    // contrat explique un écart CB, encore faut-il que l'information survive à la clôture.
    tpeContrat: c.tpeContrat || '', tpeAttendu: c.tpeAttendu || '', tpeConforme: c.tpeConforme !== false,
    nonCompte: !!c.nonCompte, benev: c.benev || {}, nbBenev: Number(c.nbBenev) || 0,
    mouvCaisse: Number(c.mouvCaisse) || 0,   // argent pris (−) / monnaie apportée (+) par le responsable en cours de match
    // Il y a DEUX clôtures : celle de la caisse (cet enregistrement) et celle de la marchandise
    // (PIL_INVENTAIRE_). Une tablette peut clôturer sa caisse sans envoyer d'inventaire : la
    // seconde n'existe alors pas, et comme le coût matière ne dépend que d'elle, la marge se
    // gonfle en silence. On inscrit donc l'état de la clôture marchandise ici aussi, pour qu'il
    // soit lisible même quand aucun inventaire n'est arrivé.
    marchandise: (c.inventaire && Object.keys(c.inventaire).length) ? (c.nonCompte ? 'théorique' : 'comptée') : 'absente' };
  pilSetProp_('PIL_CLOTURE_' + idm, all);
  if (c.inventaire && Object.keys(c.inventaire).length) {
    // Inventaire compté : il remplace le stock théorique (reste réel pour la commande suivante).
    // « Non compté » : la tablette envoie son stock théorique → pas de casse inventée pour cette buvette.
    const inv = pilProp_('PIL_INVENTAIRE_' + idm, {});
    inv[c.buvette] = pilNormInventaire_(c.inventaire); inv[c.buvette]._source = c.nonCompte ? 'théorique (non compté)' : 'tablette'; inv[c.buvette]._ts = c.ts;
    pilSetProp_('PIL_INVENTAIRE_' + idm, inv);
    pilMajStock_(c.buvette, pilStockDepuisInventaire_(inv[c.buvette]));
  } else if (c.stock && Object.keys(c.stock).length) pilMajStock_(c.buvette, c.stock);
  try { if (typeof majMatchs === 'function') majMatchs(true); } catch (e) {}
  try { pilotageDetailBuvette(true); } catch (e) {}
  return { recu: c.id };
}

// Inventaire normalisé : FUT_L en litres, autres réfs en unités (nombres)
function pilNormInventaire_(o) {
  const out = {};
  Object.keys(o || {}).forEach(function (k) { if (k.charAt(0) !== '_' && o[k] !== '' && o[k] !== null && !isNaN(Number(o[k]))) out[k] = Number(o[k]); });
  if (out.FUT_L == null && out.FUT != null) out.FUT_L = out.FUT * PIL.FUT_LITRES;
  delete out.FUT; delete out.FUT_PLEINS; delete out.FUT_ENTAME;
  return out;
}
function pilStockDepuisInventaire_(inv) {
  const o = {}; Object.keys(inv).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = inv[k]; });
  return o;
}
// Fin de match saisie au tableau de bord (réserve bénévoles, ou correction d'une buvette)
function pilEnregistrerInventaire_(eventId, inventaires) {
  const ev = pilEvent_(eventId);
  if (!ev) throw new Error('Match introuvable dans Tickie');
  const idm = pilIdMatch_(ev, true), inv = pilProp_('PIL_INVENTAIRE_' + idm, {});
  const clot = pilProp_('PIL_CLOTURE_' + idm, {});
  PIL.BUVETTES.concat(PIL.RESERVES).forEach(function (b) {
    if (!inventaires[b]) return;
    if (inventaires[b] === 'NON_COMPTE') {
      // Comptage raté (stock rangé, mélangé…) : on reprend le stock théorique de la clôture → pas de fausse casse
      let theo = (clot[b] || {}).stock;
      if (PIL.RESERVES.indexOf(b) >= 0) {   // réserve hors tablette : conso non mesurée → on garde le stock de départ
        const dep = pilStocksPrepa_(idm)[b] || {}; theo = {};
        Object.keys(dep).forEach(function (ref) { if (ref === 'FUT') theo.FUT_L = dep.FUT * PIL.FUT_LITRES; else theo[ref] = dep[ref]; });
      }
      if (!theo || !Object.keys(theo).length) throw new Error(b + ' : pas de stock théorique (clôture tablette absente)');
      inv[b] = pilNormInventaire_(theo); inv[b]._source = 'théorique (non compté)'; inv[b]._ts = new Date().toISOString();
      if (PIL.BUVETTES.indexOf(b) >= 0) pilMajStock_(b, pilStockDepuisInventaire_(inv[b]));
      return;
    }
    inv[b] = pilNormInventaire_(inventaires[b]); inv[b]._source = 'tableau de bord'; inv[b]._ts = new Date().toISOString();
    if (PIL.BUVETTES.indexOf(b) >= 0) pilMajStock_(b, pilStockDepuisInventaire_(inv[b]));
  });
  pilSetProp_('PIL_INVENTAIRE_' + idm, inv);
  try { if (typeof majMatchs === 'function') majMatchs(true); } catch (e) {}
  return { idMatch: idm, inventaire: inv };
}

function pilMajStock_(buvette, stock) {
  const all = pilProp_('PIL_STOCK', {}), now = new Date().toISOString();
  all[buvette] = {};
  Object.keys(stock).forEach(function (ref) { all[buvette][ref] = { restant: Number(stock[ref]) || 0, maj: now }; });
  pilSetProp_('PIL_STOCK', all);
}

function pilJournal_(buvette, idm, col) {
  const j = pilProp_('PIL_TABLETTES', {});
  const e = j[buvette] || { idMatch: '', chargement: null, remontee: null };
  if (idm) e.idMatch = idm;
  e[col === 3 ? 'chargement' : 'remontee'] = new Date().toISOString();
  j[buvette] = e;
  pilSetProp_('PIL_TABLETTES', j);
}
function pilLireJournal_() { return pilProp_('PIL_TABLETTES', {}); }

// ── Tableau de bord ──────────────────────────────────────────────────────
function pilFamilleTarif_(tarif, code) {
  if (!tarif) return code ? 'Billet à vérifier' : 'Sans billet';
  if (/abonn|commandant|pilote|spationaute/i.test(tarif)) return 'Abonné';
  if (/invitation|gratuit|licenci/i.test(tarif)) return 'Invité / gratuit';
  return 'Billet payant';
}

function pilDashboard_(eventId) {
  // Chronomètre de diagnostic. Depuis que la billetterie est hors requête, ce qui reste
  // est du tableur : mesuré le 25/11, 74 s par appel dont une dizaine seulement pour
  // Tickie. Ce relevé par bloc est écrit dans le journal d'exécution à chaque appel ;
  // il ne coûte rien et c'est lui qui dira quoi sortir de la requête ensuite.
  const tDeb = Date.now(); let tBil = 0, tVen = 0, tDet = 0, tGra = 0, nVen = 0, nCol = 0, nDet = 0;
  const ev = pilEvent_(eventId);
  const idm = ev ? pilIdMatch_(ev, false) : '';
  // Billetterie : instantané calculé par pilotageRechauffer, simplement lu ici.
  // Aucun parcours Tickie dans la requête (voir pilBilletterieServie_).
  let billetterie = null;
  if (ev) {
    const t0 = Date.now();
    billetterie = pilBilletterieServie_(ev.id);
    tBil = Date.now() - t0;
    if (idm && billetterie) {
      pilAffluence_(idm, billetterie.entrees > 0 ? billetterie.entrees
        : (Number(billetterie.billets) || 0) + (Number(billetterie.abonnes) || 0));
    }
  }
  const sh = feuille_('VENTES');
  const cPay = pilColPaiement_();
  const tV = Date.now();
  const data = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(cPay + 1, sh.getLastColumn())).getValues() : [];
  tVen = Date.now() - tV; nVen = data.length; nCol = data.length ? data[0].length : 0;
  const rows = data.filter(function (r) {
    return idm ? String(r[PIL_I['ID_MATCH']]) === idm : (ev && pilDate_(r[PIL_I['Horodatage']]) === ev.dateMatch);
  });
  const buv = { ca: 0, ventes: rows.length, consignes: 0, rendues: 0, parBuvette: {}, parProduit: {}, parQuartHeure: {},
    reliees: { ventes: 0, ca: 0 }, parFamilleTarif: {}, paiement: { CB: 0, ESP: 0, inconnu: 0 }, annulations: 0 };
  const nb0 = function () { return { ca: 0, ventes: 0, cb: 0, esp: 0, consignes: 0, rendues: 0, reliees: 0, produits: {} }; };
  PIL.BUVETTES.forEach(function (b) { buv.parBuvette[b] = nb0(); });
  pilProduitsCols_().forEach(function (p) { buv.parProduit[p[0]] = { nom: p[1], qte: 0 }; });
  rows.forEach(function (r) {
    const tot = Number(r[PIL_I['Total €']]) || 0, b = r[PIL_I['Buvette']] || '?';
    const annul = /^annulation/.test(String(r[PIL_I['Fidélité']]));
    const pay = String(r[cPay] || '');
    buv.paiement[pay === 'CB' || pay === 'ESP' ? pay : 'inconnu'] += tot;
    if (annul) { buv.annulations++; buv.ventes -= 2; }   // la ligne d'annulation et la vente annulée ne comptent plus
    buv.ca += tot;
    buv.consignes += Number(r[PIL_I['Consignes +']]) || 0;
    buv.rendues += Number(r[PIL_I['Consignes rendues']]) || 0;
    const pb = buv.parBuvette[b] = buv.parBuvette[b] || nb0();
    pb.ca += tot; pb.ventes += annul ? -1 : 1;
    if (pay === 'CB') pb.cb += tot; else if (pay === 'ESP') pb.esp += tot;
    pb.consignes += Number(r[PIL_I['Consignes +']]) || 0;
    pb.rendues += Number(r[PIL_I['Consignes rendues']]) || 0;
    if (r[PIL_I['ID billet']] || r[PIL_I['Code-barres']]) pb.reliees++;
    pilColsVentes_().forEach(function (ref, i) {
      const q = Number(r[PIL_NB + i]) || 0;
      if (buv.parProduit[ref]) buv.parProduit[ref].qte += q;
      if (q) pb.produits[ref] = (pb.produits[ref] || 0) + q;
    });
    const d = new Date(r[PIL_I['Horodatage']]);
    const q = Utilities.formatDate(new Date(Math.floor(d.getTime() / 900000) * 900000), pilTz_(), 'HH:mm');
    buv.parQuartHeure[q] = (buv.parQuartHeure[q] || 0) + tot;
    const fam = pilFamilleTarif_(r[PIL_I['Tarif billet']], r[PIL_I['Code-barres']]);
    buv.parFamilleTarif[fam] = buv.parFamilleTarif[fam] || { ventes: 0, ca: 0 };
    buv.parFamilleTarif[fam].ventes++; buv.parFamilleTarif[fam].ca += tot;
    if (r[PIL_I['ID billet']] || r[PIL_I['Code-barres']]) { buv.reliees.ventes++; buv.reliees.ca += tot; }
  });
  // Écocups par taille (⚙️ détail ventes : E33 / E50, E01 = ancien → 33)
  buv.gob = { s33: 0, r33: 0, s50: 0, r50: 0 };
  const vd = idm ? feuille_('DETAIL') : null;
  const tD = Date.now();
  if (vd && vd.getLastRow() > 1) {
    nDet = vd.getLastRow() - 1;
    vd.getRange(2, 1, vd.getLastRow() - 1, PIL_VD_HDR.length).getValues().forEach(function (r) {
      if (String(r[0]) !== idm) return;
      const pp = buv.parProduit[String(r[3])];   // CA encaissé par produit (prix de la tablette, remises comprises), pour le graphique
      if (pp && /^(VENTE|ANNULATION)$/.test(String(r[10]))) pp.ca = (pp.ca || 0) + (Number(r[8]) || 0);
      if (!/^E(01|33|50)$/.test(String(r[3]))) return;
      const k = (/REMBOURSEMENT/.test(String(r[10])) ? 'r' : 's') + (String(r[3]) === 'E50' ? '50' : '33'), q = Number(r[5]) || 0;
      buv.gob[k] += q;
      const pb = buv.parBuvette[r[2]]; if (pb) { pb.gob = pb.gob || { s33: 0, r33: 0, s50: 0, r50: 0 }; pb.gob[k] += q; }
    });
  }
  const stock = pilProp_('PIL_STOCK', {});
  const clotures = idm ? pilProp_('PIL_CLOTURE_' + idm, {}) : {};
  // Clôture marchandise : le tableau de bord en a besoin pour l'afficher à part de la caisse.
  // prepares = points de vente et réserves réellement préparés pour ce match (départ non nul) :
  // seuls ceux-là doivent être réclamés, la réserve bénévoles comprise si elle a été préparée.
  const inventaire = idm ? pilProp_('PIL_INVENTAIRE_' + idm, {}) : {};
  const prepares = [];
  if (idm) {
    const dep = pilStocksDepart_(idm);
    PIL.BUVETTES.concat(PIL.RESERVES).forEach(function (b) {
      if (Object.keys(dep[b] || {}).some(function (r) { return Number(dep[b][r]) > 0; })) prepares.push(b);
    });
  }
  tDet = Date.now() - tD;
  const tG = Date.now();
  const graph = pilGraphiques_(data, rows, idm);
  tGra = Date.now() - tG;
  Logger.log('Tableau de bord ' + (idm || '?') + ' : ' + Math.round((Date.now() - tDeb) / 1000) + ' s au total'
    + ' · billetterie ' + Math.round(tBil / 1000) + ' s'
    + ' · ventes ' + Math.round(tVen / 1000) + ' s (' + nVen + ' lignes x ' + nCol + ' colonnes)'
    + ' · détail ' + Math.round(tDet / 1000) + ' s (' + nDet + ' lignes)'
    + ' · graphiques ' + Math.round(tGra / 1000) + ' s');
  return { event: ev, idMatch: idm, billetterie: billetterie, buvette: buv, stock: stock, tablettes: pilLireJournal_(), clotures: clotures,
    inventaire: inventaire, prepares: prepares, reserves: PIL.RESERVES,
    produits: pilProduitsCols_().map(function (p) { return [p[0], p[1]]; }), maj: new Date().toISOString(),
    serie: graph.serie, saison: graph.saison, fonds: pilFondsMatch_(idm), sansCaisse: PIL.BUVETTES_SANS_CAISSE };
}

// ── Graphiques du tableau de bord ────────────────────────────────────────
// serie  : le match, par quart d'heure — CA boissons (hors consignes) par buvette, CB / espèces, espèces par buvette,
//          écocups sortis / revenus (rendus + plus d'espèces + récupérés).
// saison : un point par match de la saison (CA boissons, ventes, panier, € / spectateur, ventes reliées à un billet par buvette).
// Une vente annulée et sa ligne d'annulation sont écartées toutes les deux ; les boissons bénévoles (0 €) ne sont pas des ventes.
function pilGraphiques_(data, rows, idm, serieSeule) {   // serieSeule : pas de calcul de saison (onglet 📈 GRAPHIQUES)
  const tz = pilTz_();
  const quart = function (ts) { const d = new Date(ts); return isNaN(d) ? '' : Utilities.formatDate(new Date(Math.floor(d.getTime() / 900000) * 900000), tz, 'HH:mm'); };
  const annulees = {};
  data.forEach(function (r) { const m = String(r[PIL_I['Fidélité']]).match(/^annulation de (.+?)(\s·|$)/); if (m) annulees[m[1]] = 1; });
  const ecartee = function (r) { return annulees[String(r[PIL_I['ID vente']])] || /^annulation/.test(String(r[PIL_I['Fidélité']])); };
  const boissons = function (r) { return (Number(r[PIL_I['Total €']]) || 0) - (Number(r[PIL_I['Consignes +']]) || 0) + (Number(r[PIL_I['Consignes rendues']]) || 0); };
  const relie = function (r) { return !!(r[PIL_I['ID billet']] || r[PIL_I['Code-barres']]); };

  // Le match affiché
  const serie = {};
  const pt = function (q) { return serie[q] = serie[q] || { ca: {}, cb: 0, esp: 0, espB: {}, ventes: 0, sortis: 0, revenus: 0 }; };
  rows.forEach(function (r) {
    if (ecartee(r)) return;
    const q = quart(r[PIL_I['Horodatage']]); if (!q) return;
    const p = pt(q), b = String(r[PIL_I['Buvette']] || '?'), pay = String(r[pilColPaiement_()] || ''), tot = Number(r[PIL_I['Total €']]) || 0;
    p.sortis += Number(r[PIL_I['Consignes +']]) || 0;
    p.revenus += Number(r[PIL_I['Consignes rendues']]) || 0;
    if (pay === 'BENEVOLE') return;
    p.ca[b] = (p.ca[b] || 0) + boissons(r);
    if (pay === 'CB') p.cb += tot;
    else if (pay === 'ESP') { p.esp += tot; p.espB[b] = (p.espB[b] || 0) + tot; }
    if (boissons(r) > 0) p.ventes++;
  });

  // Écocups revenus sans remboursement (plus d'espèces, récupérés) : onglet technique à part
  const nrParMatch = {};
  const nr = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PIL_NR_TAB);
  if (nr && nr.getLastRow() > 1) nr.getRange(2, 1, nr.getLastRow() - 1, 7).getValues().forEach(function (r) {
    const n = (Number(r[5]) || 0) + (Number(r[6]) || 0), m = String(r[3] || '');
    nrParMatch[m] = (nrParMatch[m] || 0) + n;
    if (idm && m === idm) { const q = quart(r[1]); if (q) pt(q).revenus += n; }
  });

  if (serieSeule) return { serie: serie, saison: null };

  // La saison du match (📅 MATCHS : date, adversaire, affluence, saison)
  const infos = {};
  let saisonCourante = '';
  const sm = feuille_('MATCHS');
  if (sm && sm.getLastRow() > 1) {
    const d = sm.getDataRange().getValues(), h = d[0].map(String);
    const c = { id: h.indexOf('ID_MATCH'), date: h.indexOf('DATE'), adv: h.indexOf('ADVERSAIRE'), aff: h.indexOf('AFFLUENCE'), s: h.indexOf('SAISON') };
    d.slice(1).forEach(function (r) {
      const id = String(r[c.id] || ''); if (!id) return;
      const dv = c.date >= 0 ? r[c.date] : '';
      infos[id] = { date: dv ? pilDate_(dv instanceof Date ? dv : new Date(dv)) : '', adv: c.adv >= 0 ? String(r[c.adv] || '') : '',
        aff: c.aff >= 0 ? Number(r[c.aff]) || 0 : 0, saison: c.s >= 0 ? String(r[c.s] || '') : '' };
    });
    if (idm && infos[idm]) saisonCourante = infos[idm].saison;
  }
  const parMatch = {};
  data.forEach(function (r) {
    const m = String(r[PIL_I['ID_MATCH']] || ''); if (!m || ecartee(r)) return;
    if (saisonCourante && infos[m] && infos[m].saison && infos[m].saison !== saisonCourante) return;
    const o = parMatch[m] = parMatch[m] || { ca: 0, ventes: 0, reliees: 0, parBuvette: {}, sortis: 0, rendus: 0, premier: null };
    const b = String(r[PIL_I['Buvette']] || '?'), pay = String(r[pilColPaiement_()] || '');
    o.sortis += Number(r[PIL_I['Consignes +']]) || 0;
    o.rendus += Number(r[PIL_I['Consignes rendues']]) || 0;
    const t = new Date(r[PIL_I['Horodatage']]); if (!isNaN(t) && (!o.premier || t < o.premier)) o.premier = t;
    if (pay === 'BENEVOLE') return;
    const ca = boissons(r);
    o.ca += ca;
    if (ca <= 0) return;                     // remboursement de gobelets seul : pas une vente de boisson
    const pb = o.parBuvette[b] = o.parBuvette[b] || { ventes: 0, reliees: 0 };
    o.ventes++; pb.ventes++;
    if (relie(r)) { o.reliees++; pb.reliees++; }
  });
  const saison = Object.keys(parMatch).filter(function (m) { return parMatch[m].ventes > 0; }).map(function (m) {
    const o = parMatch[m], inf = infos[m] || {};
    return { id: m, date: inf.date || (o.premier ? pilDate_(o.premier) : ''), adversaire: inf.adv || m, affluence: inf.aff || 0,
      ca: Math.round(o.ca * 100) / 100, ventes: o.ventes, reliees: o.reliees, parBuvette: o.parBuvette,
      sortis: o.sortis, revenus: o.rendus + (nrParMatch[m] || 0) };
  }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  return { serie: serie, saison: { nom: saisonCourante, matchs: saison } };
}

// Affluence Tickie → colonne AFFLUENCE de 📅 MATCHS
function pilAffluence_(idm, n) {
  const sh = feuille_('MATCHS');
  if (!sh || !n) return;
  const d = sh.getDataRange().getValues(), h = d[0].map(String), cId = h.indexOf('ID_MATCH'), c = h.indexOf('AFFLUENCE');
  if (c < 0) return;
  for (let r = 1; r < d.length; r++) if (String(d[r][cId]) === idm) { if (Number(d[r][c]) !== n) sh.getRange(r + 1, c + 1).setValue(n); return; }
}
function pilAffluenceTickie_(idm) { return 0; }   // compatibilité Code.gs V12 : l'affluence est déjà dans AFFLUENCE

// ── Billets scannés → client Tickie + fidélité ───────────────────────────
// ── Liaison des billets scannés et fidélité (déclencheur, 10 min) ───────
// Réécrit le 25/11/2026. L'ancienne version faisait UN appel Tickie par vente à relier
// et UN crédit de fidélité par vente, chacun relisant toute la feuille ⭐ FIDÉLITÉ et
// écrivant ses cellules une par une : 6 dépassements du délai de 6 minutes et 1 échec
// sur 15 exécutions, relevés dans le journal. Quand le délai expire, ce sont les
// recalculs de FIN de fonction qui sautent — 📅 MATCHS, 🥤 DÉTAIL BUVETTE et
// 📈 GRAPHIQUES restent donc en arrière sans que rien ne le signale.
//
// Désormais : une seule liste de billets par événement concerné (pilIndexBillets_),
// un seul passage de fidélité (_fidCrediterLot_), et des gardes de temps qui laissent
// toujours de quoi finir les recalculs.
function pilotageTraiterBillets() {
  // L'horloge démarre AVANT tout le reste. pilotageSyncMatchs, déclenché une fois par
  // heure juste en dessous, parcourt lui-même les billets de tous les matchs de la
  // saison : s'il consomme 200 s et que l'horloge ne démarre qu'après, les gardes de
  // 150 et 180 s ne protègent plus rien et les recalculs de fin sautent — exactement
  // le défaut que cette réécriture corrige.
  const debut = Date.now();
  // Le déclencheur de réchauffement s'installe de lui-même s'il manque : sans lui, les
  // requêtes retombent sur un parcours Tickie et le tableau de bord revient à 100 s.
  try {
    if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'pilotageRechauffer'; })) {
      ScriptApp.newTrigger('pilotageRechauffer').timeBased().everyMinutes(5).create();
      Logger.log('Déclencheur de réchauffement installé automatiquement : il manquait.');
    }
  } catch (e) {}
  if (Date.now() - (Number(PropertiesService.getScriptProperties().getProperty('PIL_SYNC')) || 0) > 3600000) {
    try { pilotageSyncMatchs(true); } catch (e) {}
  }
  const sh = feuille_('VENTES');
  if (!sh || sh.getLastRow() < 2) { try { if (typeof pennylaneImportAuto_ === 'function') pennylaneImportAuto_(); if (typeof majMatchs === 'function') majMatchs(true); } catch (e) {} return; }
  const rg = sh.getRange(2, 1, sh.getLastRow() - 1, PIL_NB);
  const data = rg.getValues();
  let relies = 0, credites = 0;
  const annulees = {};                                      // ventes annulées depuis la tablette : pas de points
  data.forEach(function (r) { const m = String(r[PIL_I['Fidélité']]).match(/^annulation de (.+?)(\s·|$)/); if (m) annulees[m[1]] = 1; });
  // La colonne Fidélité porte aussi la note de la tablette (« remise billet 5 % : 0,30 € », « boisson offerte … ») :
  // une vente n'est traitée que si elle n'a pas encore de statut fidélité, et le statut s'ajoute à la note.
  const STATUT = /(^|· )(\d+ pts|relié|billet introuvable|vente annulée)$/;
  const noter = function (r, statut) { const n = String(r[PIL_I['Fidélité']] || ''); r[PIL_I['Fidélité']] = n ? n + ' · ' + statut : statut; };

  // Les lignes à relier sont isolées AVANT le premier appel réseau : on sait ainsi
  // quels événements charger, au lieu de le découvrir vente par vente.
  const aRelier = [];
  data.forEach(function (r) {
    const id = r[PIL_I['ID billet']], code = r[PIL_I['Code-barres']], note = String(r[PIL_I['Fidélité']] || '');
    if ((!id && !code) || STATUT.test(note) || /^annulation/.test(note)) return;
    if (annulees[String(r[PIL_I['ID vente']])]) { noter(r, 'vente annulée'); return; }
    aRelier.push(r);
  });

  const evDe = pilEventParMatch_();
  const idxDe = {};
  // Un index par événement, chargé à la demande. Passé 150 s on n'en charge plus :
  // les ventes restantes attendront le passage suivant, les recalculs de fin passent.
  const indexDe = function (ev) {
    if (!ev) return null;
    if (!(ev in idxDe)) {
      if (Date.now() - debut > 150000) return null;
      try { idxDe[ev] = pilIndexBillets_(ev); } catch (e) { idxDe[ev] = null; }
    }
    return idxDe[ev];
  };

  const memo = {}, credits = [], notesAvant = [];
  const fidLot = typeof _fidCrediterLot_ === 'function';
  const fidUn = typeof _fidCreditOne_ === 'function';
  let secours = 0, coupe = false;
  const PLAFOND_SECOURS = 25;        // appels unitaires de secours autorisés par passage
  // Charger un index coûte DEUX paginations complètes (billets du match, puis
  // abonnements). En dessous du plafond de secours, l'appel unitaire par vente coûte
  // moins cher : le passage courant d'un jour ordinaire, deux à cinq ventes, ne charge
  // donc aucun index. L'index ne sert que les gros lots — un soir de match.
  const parIndex = aRelier.length > PLAFOND_SECOURS;
  aRelier.forEach(function (r) {
    if (Date.now() - debut > 180000) { coupe = true; return; }
    const id = r[PIL_I['ID billet']], code = r[PIL_I['Code-barres']];
    const key = id || ('bc:' + code);
    if (!(key in memo)) {
      let trouve = null, indexLu = false;
      if (parIndex) {
        const ev = evDe[String(r[PIL_I['ID_MATCH']])];
        if (!ev) Logger.log('Liaison : ' + r[PIL_I['ID_MATCH']] + ' n\'a pas de TICKIE_EVENT_ID dans 📅 MATCHS, ses ventes passent par des appels unitaires.');
        const iM = indexDe(ev);
        if (iM) { indexLu = true; trouve = iM[key] || null; }
        if (!trouve) {   // les abonnés ne sont pas dans l'événement du match : second index, chargé seulement si besoin
          const iA = indexDe(PIL.ABONNEMENT_EVENT_ID);
          if (iA) { indexLu = true; trouve = iA[key] || null; }
        }
      }
      if (trouve) memo[key] = trouve;
      else if (parIndex && !indexLu) memo[key] = undefined;  // aucun index lisible : on réessaiera
      else if (secours >= PLAFOND_SECOURS) memo[key] = undefined;   // on ne sait pas : on réessaiera
      else {
        // Absent des index : soit le billet n'existe pas, soit il a été créé après leur
        // lecture, soit son statut l'en tient à l'écart (annulé, remboursé). On tranche
        // par un appel unitaire, comme avant, mais leur nombre est borné : sans ce
        // plafond on retomberait sur un appel par vente les jours de gros écart.
        secours++;
        try {
          let x = null;
          if (id) x = pilApi_(PIL.VIVENU_BASE, '/tickets/' + id, {});
          else { const res = pilApi_(PIL.VIVENU_BASE, '/tickets', { barcode: code, top: 5 }); x = (res.rows || []).filter(function (y) { return y.barcode === code; })[0] || null; }
          memo[key] = x ? pilClientBillet_(x) : null;
        } catch (e) { memo[key] = undefined; }
      }
    }
    const c = memo[key];
    if (c === undefined) return;                            // erreur réseau ou doute : on réessaiera
    if (c === null) { noter(r, 'billet introuvable'); return; }
    r[PIL_I['Client Tickie']] = c.customerId;
    if (!r[PIL_I['ID billet']]) r[PIL_I['ID billet']] = c.id;
    if (!r[PIL_I['Tarif billet']]) r[PIL_I['Tarif billet']] = c.tarif;
    relies++;
    // Points sur les consommations, hors consignes
    const montant = (Number(r[PIL_I['Total €']]) || 0) - (Number(r[PIL_I['Consignes +']]) || 0) + (Number(r[PIL_I['Consignes rendues']]) || 0);
    if ((fidLot || fidUn) && c.email && montant > 0) {
      credits.push({ carte: c.email, nom: c.nom, montant: montant,
        matchId: r[PIL_I['ID_MATCH']], tab: r[PIL_I['Buvette']], dateStr: pilDate_(r[PIL_I['Horodatage']]) });
      notesAvant.push([r, String(r[PIL_I['Fidélité']] || ''), c.email]);
      noter(r, Math.floor(montant) + ' pts'); credites++;
    } else noter(r, 'relié');
  });

  // Fidélité : un seul passage pour tout le lot. Si le crédit échoue, on RETIRE la
  // mention « n pts » des lignes concernées : sans ça elles resteraient marquées comme
  // créditées pour toujours alors qu'aucun point n'a été écrit, et le statut les
  // exclurait de tous les passages suivants.
  if (credits.length) {
    // _fidCrediterLot_ n'est pas atomique : il écrit une ligne par abonné. On ne remet
    // donc à retraiter que les ventes dont la carte n'a PAS été écrite — sinon un échec
    // au milieu du lot ferait recréditer au tour suivant tous ceux qui l'étaient déjà.
    let ecrites = null;
    try {
      if (fidLot) {
        const bilanFid = _fidCrediterLot_(credits, '', '', pilDate_(new Date())) || {};
        ecrites = {};
        (bilanFid.ecrites || []).forEach(function (c) { ecrites[c] = 1; });
        if ((bilanFid.echouees || []).length) Logger.log('Fidélité : ' + bilanFid.echouees.length + ' carte(s) non écrite(s), leurs ventes repasseront.');
      } else {
        ecrites = {};
        credits.forEach(function (e) {
          try { _fidCreditOne_(e, e.matchId, e.tab, e.dateStr); ecrites[String(e.carte).trim().toLowerCase()] = 1; } catch (e2) {}
        });
      }
    } catch (e) {
      ecrites = {};        // rien d'écrit : tout repasse
      Logger.log('Fidélité : crédit du lot impossible — ' + (e && e.message || e));
    }
    let rendues = 0;
    notesAvant.forEach(function (x) {
      const carte = String(x[2]).trim().toLowerCase();
      if (ecrites && ecrites[carte]) return;
      x[0][PIL_I['Fidélité']] = x[1]; rendues++;
    });
    if (rendues) { credites -= rendues; Logger.log('Fidélité : ' + rendues + ' vente(s) laissée(s) à retraiter au prochain passage.'); }
  }

  rg.setValues(data);
  try { if (typeof pennylaneImportAuto_ === 'function') pennylaneImportAuto_(); } catch (e) {}   // achats Pennylane (toutes les 6 h)
  try { if (typeof majMatchs === 'function') majMatchs(true); } catch (e) {}   // 📅 MATCHS à jour en continu
  try { pilotageDetailBuvette(true); } catch (e) {}                                // 🥤 DÉTAIL BUVETTE à jour en continu
  try { if (typeof graphiquesMaj === 'function') graphiquesMaj(true); } catch (e) {}  // 📈 GRAPHIQUES à jour en continu
  const bilan = relies + ' vente(s) reliée(s) · ' + credites + ' crédit(s) fidélité'
    + ' · ' + Object.keys(idxDe).length + ' événement(s) chargé(s)'
    + (secours ? ' · ' + secours + ' appel(s) unitaire(s)' : '')
    + (coupe ? ' · ⚠️ passage écourté, reste à traiter au prochain' : '');
  Logger.log(bilan + ' en ' + Math.round((Date.now() - debut) / 1000) + ' s');
  try { SpreadsheetApp.getActiveSpreadsheet().toast(bilan); } catch (e) {}
}

// ── Commande conseillée : données pour le tableau de bord ────────────────
// Le calcul (prévision, marge de sécurité, colisage) est fait dans pilotage.html ;
// le script fournit la billetterie, les consommations réelles par match 26-27 et le stock restant.
function pilDonneesCommande_(eventId) {
  const ev = pilEvent_(eventId);
  if (!ev) throw new Error('Match introuvable dans Tickie');
  // Même instantané que le tableau de bord : l'onglet Commande s'ouvre souvent pendant
  // qu'il se rafraîchit, et deux parcours Tickie simultanés se gênent l'un l'autre.
  // On LÈVE si l'instantané manque, au lieu de renvoyer des zéros : la commande
  // conseillée afficherait « 0 billets + 0 abonnés = 0 attendus » et zéro colis partout
  // comme si c'était la vérité. L'onglet affiche « Données indisponibles » et on
  // réessaie — c'est ce que faisait l'ancien code quand Tickie tombait.
  const snap = pilBilletterieServie_(ev.id);
  if (!snap) throw new Error('billetterie en cours de calcul, réessaie dans une minute');
  const b = { total: Number(snap.billets) || 0, payants: Number(snap.payants) || 0, invitations: Number(snap.invitations) || 0 };
  const abonnes = Number(snap.abonnes) || 0;
  const idm = pilIdMatch_(ev, false);

  // Matchs 26-27 déjà joués : quantités vendues et affluence (📅 MATCHS.AFFLUENCE = entrées si connues)
  const m10 = feuille_('MATCHS');
  const d10 = m10.getDataRange().getValues(), h10 = d10[0].map(String);
  const cId = h10.indexOf('ID_MATCH'), cAff = h10.indexOf('AFFLUENCE'), cEv = h10.indexOf('TICKIE_EVENT_ID');
  const aff = {}, evDe = {};
  d10.slice(1).forEach(function (r) { aff[String(r[cId])] = Number(r[cAff]) || 0; if (cEv >= 0 && r[cEv]) evDe[String(r[cId])] = String(r[cEv]); });
  const live = feuille_('VENTES');
  const parMatch = {};
  if (live && live.getLastRow() > 1) {
    live.getRange(2, 1, live.getLastRow() - 1, PIL_NB + pilColsVentes_().length).getValues().forEach(function (r) {
      const m = String(r[PIL_I['ID_MATCH']]); if (!m || m === idm) return;
      const o = parMatch[m] = parMatch[m] || { qte: {}, parBuvette: {} };
      pilColsVentes_().forEach(function (ref, i) { o.qte[ref] = (o.qte[ref] || 0) + (Number(r[PIL_NB + i]) || 0); });
      const bv = r[PIL_I['Buvette']]; o.parBuvette[bv] = (o.parBuvette[bv] || 0) + (Number(r[PIL_I['Total €']]) || 0);
    });
  }
  const observes = Object.keys(parMatch).filter(function (m) { return aff[m] > 0; })
    .map(function (m) { return { idMatch: m, presents: aff[m], qte: parMatch[m].qte, parBuvette: parMatch[m].parBuvette }; });

  // Taux de présence appris, uniquement depuis les taux DÉJÀ gelés : cet onglet s'ouvre
  // à la demande, souvent pendant que le tableau de bord se rafraîchit, et il parcourait
  // les billets ET les scans de TOUS les matchs joués de la saison — 10 paginations Tickie
  // pour 5 matchs. C'est le réchauffement qui les gèle maintenant, deux par passage.
  // Conséquence assumée : juste après une mise en service, « taux de présence » reste vide
  // le temps que le réchauffement ait couvert les matchs passés (un quart d'heure).
  const taux = [];
  Object.keys(evDe).forEach(function (m) {
    if (!parMatch[m]) return;
    const t = pilTauxPresence_(evDe[m], abonnes, false);
    if (t != null) taux.push(t);
  });

  // Stock du club disponible pour ce match (réserve + invendus des buvettes, hors stock déjà engagé pour ce match).
  // Sans comptage enregistré : ancien calcul, invendus remontés par les tablettes au dernier match.
  let reste = { FUT: 0 }, stockClub = null;
  // Ce qui est déjà physiquement dans chaque buvette (invendus du dernier match) : la répartition ne descend pas en dessous
  const enBuvette = {}, stB = pilProp_('PIL_STOCK', {});
  PIL.BUVETTES.forEach(function (bv) {
    enBuvette[bv] = {};
    Object.keys(stB[bv] || {}).forEach(function (ref) {
      const r = Number(stB[bv][ref].restant) || 0;
      if (ref === 'FUT_L') enBuvette[bv].FUT = Math.round(r / PIL.FUT_LITRES * 100) / 100;
      else if (ref !== 'P01_25' && ref !== 'P01_50') enBuvette[bv][ref] = r;
    });
  });
  if (pilReserve_().base) {
    stockClub = pilStockClub_(idm);
    reste = {}; Object.keys(stockClub.stock).forEach(function (ref) { reste[ref] = Math.max(0, stockClub.stock[ref]); });
    reste.FUT = Math.floor(reste.FUT + 1e-9);   // fûts entiers : un fût entamé sert de marge
  } else {
    const st = pilProp_('PIL_STOCK', {});
    Object.keys(st).forEach(function (bv) {
      Object.keys(st[bv]).forEach(function (ref) {
        const r = Number(st[bv][ref].restant) || 0;
        if (ref === 'FUT_L') reste.FUT += Math.floor(r / PIL.FUT_LITRES + 1e-9);   // seuls les fûts non entamés se gardent
        else if (ref !== 'P01_25' && ref !== 'P01_50') reste[ref] = (reste[ref] || 0) + r;
      });
    });
  }

  return { event: ev, idMatch: idm,
    billetterie: { billets: b.total, payants: b.payants, invitations: b.invitations, abonnes: abonnes, jauge: ev.jauge },
    presence: taux.length ? taux.reduce(function (a, x) { return a + x; }, 0) / taux.length : null, presenceN: taux.length,
    observes: observes, reste: reste, stockClub: !!stockClub, enBuvette: enBuvette, futLitres: PIL.FUT_LITRES, buvettes: PIL.BUVETTES,
    // Lignes de stock de 📦 PRODUITS : [réf, libellé, pas, unité, services]. La commande conseillée
    // s'y cale, donc un produit ajouté dans 📦 PRODUITS y apparaît sans toucher au tableau de bord.
    lignes: pilLignesStock_(),
    colisage: (function () { const c = {}, cat = produitsCatalogue_(); Object.keys(cat).forEach(function (r) { if (cat[r].colisage && r !== 'FUT') c[r] = cat[r].colisage; }); return c; })() };
}

// ── Stock du club : une seule réserve (local + buvettes) ─────────────────
// Unités de préparation : fûts (décimales = fût entamé), bouteilles de softs, eaux à l'unité.
// Stock = dernier comptage + livraisons reçues après − pour chaque match préparé après le comptage :
// (stock de départ du match, bénévoles compris) − (inventaire de fin, ou stock théorique de la clôture).
// Un match préparé mais pas encore joué compte comme sorti en entier.
function pilReserve_() {
  const r = pilProp_('PIL_RESERVE', null) || {};
  return { base: r.base || null, livraisons: Array.isArray(r.livraisons) ? r.livraisons : [] };
}
function pilRefsPrepa_() { return pilLignesStock_().map(function (p) { return p[0]; }); }
function pilQtesPrepa_(o) {
  const out = {};
  pilRefsPrepa_().forEach(function (ref) { out[ref] = Math.round((Number((o || {})[ref]) || 0) * 100) / 100; });
  return out;
}
function pilDatesMatchs_() {
  const sh = feuille_('MATCHS'), out = {};
  if (!sh) return out;
  const d = sh.getDataRange().getValues(), h = d[0].map(String), cId = h.indexOf('ID_MATCH'), cDate = h.indexOf('DATE');
  for (let r = 1; r < d.length; r++) if (d[r][cId] && d[r][cDate]) { try { out[String(d[r][cId])] = pilDate_(d[r][cDate]); } catch (e) {} }
  return out;
}
function pilStockClub_(idmExclu) {
  const R = pilReserve_(), refs = pilRefsPrepa_();
  const stock = pilQtesPrepa_(R.base ? R.base.stock : {});
  const baseDate = R.base ? R.base.date : '', baseTs = R.base ? R.base.ts : '';
  const apres = function (date, ts) { return !R.base || date > baseDate || (date === baseDate && String(ts || '') > baseTs); };
  const livraisons = R.livraisons.filter(function (l) { return apres(l.date, l.ts); });
  const livre = pilQtesPrepa_({});
  livraisons.forEach(function (l) { refs.forEach(function (ref) { livre[ref] += Number((l.qte || {})[ref]) || 0; }); });
  const dates = pilDatesMatchs_(), matchs = [];
  PropertiesService.getScriptProperties().getKeys().filter(function (k) { return k.indexOf('PIL_PREPA_') === 0; }).forEach(function (k) {
    const idm = k.slice('PIL_PREPA_'.length), date = dates[idm];
    if (!date || idm === idmExclu || (R.base && date <= baseDate)) return;
    // départ réel : un fût apporté en cours de match est bien sorti de la réserve du club
    const prepa = pilStocksDepart_(idm), inv = pilProp_('PIL_INVENTAIRE_' + idm, {}), clot = pilProp_('PIL_CLOTURE_' + idm, {});
    const sorti = pilQtesPrepa_({}), revenu = pilQtesPrepa_({});
    let fini = 0;
    PIL.BUVETTES.concat(PIL.RESERVES).forEach(function (b) {
      refs.forEach(function (ref) { sorti[ref] += Number((prepa[b] || {})[ref]) || 0; });
      const fin = inv[b] || ((clot[b] || {}).stock && Object.keys(clot[b].stock).length ? clot[b].stock : null);
      if (!fin) return;
      fini++;
      refs.forEach(function (ref) { revenu[ref] += ref === 'FUT' ? (Number(fin.FUT_L) || 0) / PIL.FUT_LITRES : Number(fin[ref]) || 0; });
    });
    if (!refs.some(function (ref) { return sorti[ref] > 0; })) return;
    matchs.push({ idMatch: idm, date: date, sorti: pilQtesPrepa_(sorti), revenu: pilQtesPrepa_(revenu), joue: fini > 0 });
  });
  matchs.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  refs.forEach(function (ref) {
    stock[ref] += livre[ref];
    matchs.forEach(function (m) { stock[ref] -= m.sorti[ref] - m.revenu[ref]; });
  });
  return { stock: pilQtesPrepa_(stock), base: R.base, livre: pilQtesPrepa_(livre), livraisons: livraisons, matchs: matchs };
}
function pilLireStockClub_(eventId) {
  let idm = '';
  if (eventId) { const ev = pilEvent_(eventId); if (ev) idm = pilIdMatch_(ev, false); }
  const R = pilReserve_();
  return { idMatch: idm, lignes: pilLignesStock_(), futLitres: PIL.FUT_LITRES, base: R.base,
    avant: R.base ? pilStockClub_(idm) : null,                // disponible pour ce match
    total: R.base ? pilStockClub_(null) : null,               // après tous les matchs préparés
    livraisons: R.livraisons.slice(-30).reverse() };
}
function pilEnregistrerLivraison_(l) {
  const date = String(l.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date de livraison invalide');
  const qte = {}; let n = 0;
  pilRefsPrepa_().forEach(function (ref) { const q = Math.round((Number((l.qte || {})[ref]) || 0) * 100) / 100; if (q) { qte[ref] = q; n++; } });
  if (!n) throw new Error('Aucune quantité saisie');
  const R = pilReserve_(), piece = String(l.piece || '').trim().slice(0, 60);
  if (piece && R.livraisons.some(function (x) { return x.piece === piece; })) throw new Error('Livraison ' + piece + ' déjà enregistrée');
  const liv = { id: Utilities.getUuid().slice(0, 8), ts: new Date().toISOString(), date: date,
    fournisseur: String(l.fournisseur || '').trim().slice(0, 40), piece: piece, qte: qte };
  R.livraisons.push(liv);
  pilSetProp_('PIL_RESERVE', R);
  return { livraison: liv };
}
function pilSupprimerLivraison_(id) {
  const R = pilReserve_(), avant = R.livraisons.length;
  R.livraisons = R.livraisons.filter(function (x) { return x.id !== id; });
  if (R.livraisons.length === avant) throw new Error('Livraison introuvable');
  pilSetProp_('PIL_RESERVE', R);
  return { supprime: id };
}
// Comptage de tout ce que le club a physiquement (local + buvettes), en dehors d'un jour de match.
// Les matchs datés après le comptage et déjà préparés en sont ensuite déduits.
function pilEnregistrerComptageClub_(c) {
  const date = String(c.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date de comptage invalide');
  const R = pilReserve_();
  R.base = { date: date, ts: new Date().toISOString(), stock: pilQtesPrepa_(c.stock), par: String(c.par || '').slice(0, 40), note: String(c.note || '').slice(0, 200) };
  pilSetProp_('PIL_RESERVE', R);
  return { base: R.base };
}

// ── Accès sans saisie : tableau de bord et tablettes configurés par lien / QR ──
const PIL_APP_URL = 'https://spacers-buvette.spacersytb.workers.dev/';
function pilLienConfig_(page, extra) {
  const p = PropertiesService.getScriptProperties();
  const url = pilUrlWebApp_();
  if (!url) throw new Error("URL de l'application web introuvable : colle-la en bas de 🏠 ACCUEIL ou dans la propriété PIL_WEBAPP_URL");
  const cfg = Object.assign({ url: url, token: p.getProperty('PILOTAGE_TOKEN') }, extra || {});
  return PIL_APP_URL + page + '?cfg=' + encodeURIComponent(Utilities.base64Encode(JSON.stringify(cfg), Utilities.Charset.UTF_8));
}
// Lien court d'une tablette (QR facile à lire) : ?b=<n°>&k=<jeton>, + &d=<déploiement> si ce n'est pas celui intégré à l'app
const PIL_DEPLOIEMENT_APP = 'AKfycbw_0wr_XORTuVxaZU9YSa63IZiFfRf9vzPczAlwECPC7BPRD22s9TriBtDn7jca1qBmvg';
function pilLienTablette_(buvette) {
  const tok = PropertiesService.getScriptProperties().getProperty('PILOTAGE_TOKEN');
  const m = String(pilUrlWebApp_() || '').match(/\/s\/([A-Za-z0-9_-]+)\/exec/);
  const d = m && m[1] !== PIL_DEPLOIEMENT_APP ? '&d=' + m[1] : '';
  return PIL_APP_URL + '?b=' + String(buvette).replace(/\D/g, '') + '&k=' + tok + d;
}
function pilotageOuvrir() {
  if (!PropertiesService.getScriptProperties().getProperty('PILOTAGE_TOKEN')) pilotageInitialiser();
  const dash = pilLienConfig_('pilotage.html');
  const tabs = PIL.BUVETTES.map(function (b) { return { nom: b, url: pilLienTablette_(b) }; });
  const esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); };
  const html = '<style>body{font-family:Arial,sans-serif;margin:0;padding:4px 8px;color:#001E2D}' +
    'a.big{display:block;text-align:center;background:#001E2D;color:#fff;padding:12px;border-radius:10px;font-weight:bold;text-decoration:none;font-size:15px}' +
    '.g{display:flex;gap:16px;margin-top:12px;justify-content:space-between}.c{flex:1;text-align:center;font-size:13px}.c b{display:block;margin-bottom:6px;font-size:15px}' +
    '.q{display:inline-block;padding:10px;background:#fff;border:1px solid #ccd;border-radius:10px}.q img,.q canvas{display:block}' +
    '.q{cursor:zoom-in}#ov{position:fixed;inset:0;background:#fff;display:none;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:zoom-out}#ov.on{display:flex}#ov b{font-size:20px}#zb img,#zb canvas{width:min(92vw,82vh)!important;height:auto!important;image-rendering:pixelated}' +
    '.l{font-size:10px;color:#64778A;word-break:break-all;margin-top:4px}p,li{font-size:12px;color:#33495a;line-height:1.45}ol{margin:6px 0 0 18px;padding:0}</style>' +
    '<a class="big" href="' + esc(dash) + '" target="_blank">📊 Ouvrir le tableau de bord</a>' +
    '<div class="g">' + tabs.map(function (t, i) {
      return '<div class="c"><b>' + esc(t.nom) + '</b><div class="q" id="q' + i + '" onclick="zoom(' + i + ')" title="Agrandir"></div><div class="l">' + esc(t.url) + '</div></div>';
    }).join('') + '</div>' +
    '<p style="text-align:center;margin:8px 0 0">🔍 <b>Touche un QR pour l\'agrandir</b> (plus facile à scanner).</p>' +
    '<div id="ov" onclick="this.classList.remove(\'on\')"><b id="zt"></b><div id="zb"></div><span style="font-size:12px">Touche pour fermer</span></div>' +
    '<p><b>Installer une tablette</b> (une fois) :</p><ol>' +
    '<li>Ouvre l\'appareil photo de la tablette et vise le QR de sa buvette, puis touche le lien : l\'app s\'ouvre déjà configurée.</li>' +
    '<li><b>Android</b> (Chrome) : menu ⋮ → <i>Installer l\'application</i>. <b>iPad</b> (Safari) : bouton Partager → <i>Sur l\'écran d\'accueil</i>.</li>' +
    '<li><b>iPad uniquement</b> : ouvre l\'icône installée, touche <i>📷 Scanner le QR de configuration</i> et vise à nouveau le QR (l\'icône ne partage pas la mémoire de Safari).</li></ol>' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script><script>' +
    'var U=' + JSON.stringify(tabs.map(function (t) { return t.url; })) + ',N=' + JSON.stringify(tabs.map(function (t) { return t.nom; })) + ';' +
    'U.forEach(function(u,i){new QRCode(document.getElementById("q"+i),{text:u,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});});' +
    'function zoom(i){var z=document.getElementById("zb");z.innerHTML="";new QRCode(z,{text:U[i],width:600,height:600,correctLevel:QRCode.CorrectLevel.M});document.getElementById("zt").textContent=N[i];document.getElementById("ov").classList.add("on");}</script>';
  SpreadsheetApp.getUi().showModelessDialog(HtmlService.createHtmlOutput(html).setWidth(820).setHeight(640), 'Pilotage buvette : tableau de bord et tablettes');
}

// URL publique (…/exec) du déploiement : ScriptApp.getService().getUrl() peut renvoyer l'URL /dev
// (réservée à l'éditeur), qui échoue depuis les tablettes. On prend donc d'abord l'URL /exec écrite dans le Sheet.
function pilUrlWebApp_() {
  const p = PropertiesService.getScriptProperties();
  const prop = p.getProperty('PIL_WEBAPP_URL');
  if (prop && /\/exec$/.test(prop)) return prop;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const re = /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/;
  for (const n of [ONG.ACCUEIL, 'PILOTAGE', '06_STOCKS']) {
    const sh = ss.getSheetByName(n); if (!sh) continue;
    const f = sh.createTextFinder('script.google.com/macros/s/').findNext();
    if (f) { const m = String(f.getValue()).match(re) || String(f.getFormula()).match(re); if (m) { p.setProperty('PIL_WEBAPP_URL', m[0]); return m[0]; } }
  }
  const u = ScriptApp.getService().getUrl();
  return u && /\/exec$/.test(u) ? u : '';
}

// ═══════════════════════════════════════════════════════════════════════════
// 🥤 DÉTAIL BUVETTE — une ligne par match (+ une par buvette), totaux par saison
//  · CA alcoolisé / non alcoolisé, TTC et HT (prix réellement encaissés, formules et remises incluses ;
//    famille et TVA lues dans 📦 PRODUITS : famille « Bière » = alcoolisé)
//  · Écocups : vendus (consigne payée), rendus et remboursés, non remboursés = gardés par le spectateur
//    + rapportés mais pas remboursés faute d'espèces (bouton 🚫 de la tablette)
//  · Argent des consignes : payées en CB / en espèces, remboursées en espèces / déduites d'un achat CB
//  · Espèces : solde du match et fond de caisse minimum (pire déficit du tiroir, monnaie à rendre non comprise)
// Recalculé à chaque clôture de caisse, toutes les 10 min (traitement auto) et par le menu 📡 Pilotage live.
// Chaque match est figé 2 jours après sa date (onglet masqué ⚙️ détail buvette archive) : ses chiffres sont conservés tels quels.
// ═══════════════════════════════════════════════════════════════════════════
const PIL_DETAIL_COLS = [
  ['match', 'MATCH'], ['date', 'DATE'], ['adv', 'ADVERSAIRE'], ['buv', 'BUVETTE'],
  ['alcTTC', 'CA ALCOOL TTC €', '€'], ['alcHT', 'CA ALCOOL HT €', '€'], ['saTTC', 'CA SANS ALCOOL TTC €', '€'], ['saHT', 'CA SANS ALCOOL HT €', '€'],
  ['partAlc', 'PART ALCOOL', '%'],
  ['vend', 'ÉCOCUPS VENDUS', 'n'], ['v30', 'dont 30cl', 'n'], ['v50', 'dont 50cl', 'n'],
  ['rend', 'RENDUS ET REMBOURSÉS', 'n'], ['taux', 'TAUX DE RETOUR', '%'],
  ['nonRemb', 'NON REMBOURSÉS (consigne gardée, €)', 'n'], ['garde', 'dont gardés par le spectateur', 'n'], ['ndEsp', "dont rapportés, plus d'espèces", 'n'], ['recup', 'dont récupérés sans remboursement', 'n'],
  ['consCB', 'CONSIGNES PAYÉES EN CB €', '€'], ['consESP', 'CONSIGNES PAYÉES EN ESPÈCES €', '€'],
  ['rembESP', 'REMBOURSÉES EN ESPÈCES €', '€'], ['rembCB', "DÉDUITES D'UN ACHAT CB €", '€'],
  ['soldeEsp', 'SOLDE ESPÈCES DU MATCH €', '€'], ['fond', 'FOND DE CAISSE MINIMUM €', '€'],
  ['anom', 'SAISIES IGNORÉES', 'n'],
];
// Colonnes calculées à l'affichage (jamais archivées) : valables aussi pour les matchs figés 🔒.
// Insérées juste après FOND DE CAISSE MINIMUM.
const PIL_DETAIL_FOND_COLS = [
  ['fondReel', 'FOND DE CAISSE DE DÉPART €', '€'],
  ['attendu', 'ESPÈCES ATTENDUES EN FIN DE MATCH €', '€'],
  ['marge', 'MARGE SUR LE MINIMUM €', '€'],
];

function pilotageDetailBuvette(silencieux) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lire = function (sh) {
    if (!sh || sh.getLastRow() < 2) return { h: {}, rows: [] };
    const d = sh.getDataRange().getValues(), h = {};
    d[0].forEach(function (x, i) { if (x !== '' && !(String(x) in h)) h[String(x)] = i; });
    return { h: h, rows: d.slice(1) };
  };

  // Catalogue : famille + TVA par référence
  const prod = lire(ss.getSheetByName('📦 PRODUITS')), alcool = {}, tva = {};
  const cRef = prod.h['RÉF'], cFam = prod.h['FAMILLE'], cTva = prod.h['TVA'];
  prod.rows.forEach(function (r) {
    if (cRef === undefined || !r[cRef]) return;
    const ref = String(r[cRef]);
    alcool[ref] = /bi[eè]re|alcool|vin|cidre/i.test(String(cFam === undefined ? '' : r[cFam]));
    const t = Number(cTva === undefined ? '' : r[cTva]);
    if (!isNaN(t) && r[cTva] !== '') tva[ref] = t > 1 ? t / 100 : t;
  });
  const estAlcool = function (ref) { return ref in alcool ? alcool[ref] : /^P01/.test(ref); };
  const tauxTva = function (ref) { return ref in tva ? tva[ref] : estAlcool(ref) ? 0.2 : 0.1; };

  // Matchs : date, adversaire, saison
  const mt = lire(feuille_('MATCHS')), infos = {};
  mt.rows.forEach(function (r) {
    const id = String(r[mt.h['ID_MATCH']] || ''); if (!id) return;
    infos[id] = { date: r[mt.h['DATE']], adv: r[mt.h['ADVERSAIRE']] || '', saison: String(r[mt.h['SAISON']] || '') };
  });

  const acc = {};   // acc[match][buvette] = compteurs
  const zero = function () { return { ignRend: 0, alcTTC: 0, alcHT: 0, saTTC: 0, saHT: 0, v30: 0, v50: 0, rend: 0, ndEsp: 0, recup: 0, consCB: 0, consESP: 0, rembESP: 0, rembCB: 0, soldeEsp: 0, fond: 0, mouv: [] }; };
  const get = function (m, b) { m = String(m || ''); b = String(b || '—'); acc[m] = acc[m] || {}; return acc[m][b] = acc[m][b] || zero(); };

  // ⚙️ détail ventes : CA par famille (prix encaissés) + écocups vendus / rendus
  const vd = lire(feuille_('DETAIL')), V = vd.h;
  vd.rows.forEach(function (r) {
    const m = String(r[V['MATCH']] || ''), type = String(r[V['TYPE']] || ''), ref = String(r[V['REF']] || '');
    if (!infos[m] || type === 'HISTORIQUE' || /BENEVOLE/.test(type)) return;
    const a = get(m, r[V['TABLETTE']]), q = Number(r[V['QTY']]) || 0;
    if (/^E/.test(ref)) {
      // Buvette sans caisse : un remboursement y est impossible (gobelets ramassés saisis par erreur) → ignoré
      if (type === 'REMBOURSEMENT_CONSIGNE' && PIL.BUVETTES_SANS_CAISSE.indexOf(String(r[V['TABLETTE']])) >= 0) a.ignRend += q;
      else if (type === 'REMBOURSEMENT_CONSIGNE') a.rend += q;
      else if (Number(r[V['CONSIGNE_UNIT']]) > 0) { if (ref === 'E50') a.v50 += q; else a.v30 += q; }
      return;
    }
    if (type !== 'VENTE' && type !== 'ANNULATION') return;
    const ttc = Number(r[V['CA_HT']]) || 0, ht = ttc / (1 + tauxTva(ref));   // colonne CA_HT = montant encaissé TTC
    if (estAlcool(ref)) { a.alcTTC += ttc; a.alcHT += ht; } else { a.saTTC += ttc; a.saHT += ht; }
  });

  // 🧾 VENTES : argent des consignes par moyen de paiement + mouvements d'espèces
  const ve = lire(feuille_('VENTES')), W = ve.h;
  ve.rows.forEach(function (r) {
    const m = String(r[W['ID_MATCH']] || ''); if (!infos[m]) return;
    const pay = String(r[W['Paiement']] || ''), a = get(m, r[W['Buvette']]);
    const sansCaisse = PIL.BUVETTES_SANS_CAISSE.indexOf(String(r[W['Buvette']])) >= 0;
    const cp = Number(r[W['Consignes +']]) || 0, cr = sansCaisse ? 0 : Number(r[W['Consignes rendues']]) || 0, tot = Number(r[W['Total €']]) || 0;
    if (pay === 'CB') { a.consCB += cp; a.rembCB += cr; }
    else if (pay === 'ESP' && !sansCaisse) { a.consESP += cp; a.rembESP += cr; a.soldeEsp += tot; a.mouv.push([new Date(r[W['Horodatage']]).getTime() || 0, tot]); }
  });

  // ⚙️ écocups non remboursés : plus d'espèces, ou récupérés sans que personne demande l'euro
  const nr = lire(ss.getSheetByName(PIL_NR_TAB)), N = nr.h;
  nr.rows.forEach(function (r) {
    const m = String(r[N['ID_MATCH']] || ''); if (!infos[m]) return;
    const n = (Number(r[N['Écocups 30cl']]) || 0) + (Number(r[N['Écocups 50cl']]) || 0);
    if ('Motif' in N && String(r[N['Motif']]) === 'RECUPERE') get(m, r[N['Buvette']]).recup += n;
    else get(m, r[N['Buvette']]).ndEsp += n;
  });

  // Fond de caisse minimum : pire déficit cumulé des espèces au fil du match, par buvette
  Object.keys(acc).forEach(function (m) { Object.keys(acc[m]).forEach(function (b) {
    const a = acc[m][b]; let cum = 0, mini = 0;
    if (PIL.BUVETTES_SANS_CAISSE.indexOf(b) >= 0) { a.fond = 0; a.sansCaisse = true; return; }
    a.mouv.sort(function (x, y) { return x[0] - y[0]; }).forEach(function (x) { cum += x[1]; if (cum < mini) mini = cum; });
    a.fond = Math.ceil(-mini);
  }); });

  const SOMMES = ['ignRend', 'alcTTC', 'alcHT', 'saTTC', 'saHT', 'v30', 'v50', 'rend', 'ndEsp', 'recup', 'consCB', 'consESP', 'rembESP', 'rembCB', 'soldeEsp'];
  const additionner = function (liste, fondMode) {
    const t = zero();
    liste.forEach(function (a) { SOMMES.forEach(function (k) { t[k] += a[k]; }); t.fond = fondMode === 'max' ? Math.max(t.fond, a.fond) : t.fond + a.fond; });
    return t;
  };
  const r2 = function (x) { return Math.round(x * 100) / 100; };
  const ligne = function (a, match, date, adv, buv) {
    const vend = a.v30 + a.v50, nonRemb = vend - a.rend, ca = a.alcTTC + a.saTTC;
    const o = { match: match, date: date, adv: adv, buv: buv, alcTTC: r2(a.alcTTC), alcHT: r2(a.alcHT), saTTC: r2(a.saTTC), saHT: r2(a.saHT),
      partAlc: ca ? a.alcTTC / ca : '', vend: vend, v30: a.v30, v50: a.v50, rend: a.rend, taux: vend > 0 ? a.rend / vend : '',
      nonRemb: nonRemb, garde: nonRemb - a.ndEsp - a.recup, ndEsp: a.ndEsp, recup: a.recup, consCB: r2(a.consCB), consESP: r2(a.consESP),
      rembESP: r2(a.rembESP), rembCB: r2(a.rembCB), soldeEsp: r2(a.soldeEsp), fond: a.sansCaisse ? 'sans caisse' : a.fond,
      anom: a.ignRend ? a.ignRend + ' gobelet' + (a.ignRend > 1 ? 's' : '') + ' « rendu' + (a.ignRend > 1 ? 's' : '') + ' » à une buvette sans caisse, non comptés' : '' };
    return PIL_DETAIL_COLS.map(function (c) { return o[c[0]]; });
  };

  // Chiffres figés : un match est figé PIL_DETAIL_FIGE_JOURS jours après sa date (le temps que les tablettes
  // envoient tout et que les corrections soient faites). Ses lignes sont alors gardées telles quelles dans
  // l'onglet masqué ⚙️ détail buvette archive et ne sont plus jamais recalculées (même si les ventes brutes changent).
  const arch = pilDetailArchive_(), archD = lire(arch), figes = {};
  // Lignes archivées avant la colonne « récupérés sans remboursement » : la date d'archivage tombe sur la dernière colonne
  const iRecup = PIL_DETAIL_COLS.findIndex(function (c) { return c[0] === 'recup'; });
  archD.rows.forEach(function (r) {
    const m = String(r[1] || ''); if (!m) return;
    const f = figes[m] = figes[m] || { saison: String(r[0]), date: r[2], rows: [] };
    let l = r.slice(1, 1 + PIL_DETAIL_COLS.length);
    if (r[PIL_DETAIL_COLS.length] instanceof Date) { l = r.slice(1, PIL_DETAIL_COLS.length); l.splice(iRecup, 0, 0); }
    f.rows.push(l);
  });
  const blocs = {}, aFiger = [], limite = Date.now() - PIL_DETAIL_FIGE_JOURS * 86400000;
  Object.keys(figes).forEach(function (m) { blocs[m] = figes[m]; });
  Object.keys(acc).forEach(function (m) {
    if (figes[m]) return;
    const tot = additionner(Object.keys(acc[m]).map(function (b) { return acc[m][b]; }));
    const rows = [ligne(tot, m, infos[m].date, infos[m].adv, 'Total match')]
      .concat(Object.keys(acc[m]).sort().map(function (b) { return ligne(acc[m][b], m, infos[m].date, infos[m].adv, b); }));
    blocs[m] = { saison: infos[m].saison, date: infos[m].date, rows: rows, live: true };
    if (infos[m].date && new Date(infos[m].date).getTime() < limite) aFiger.push(m);
  });
  if (aFiger.length) {
    const now = new Date(), add = [];
    aFiger.forEach(function (m) { blocs[m].rows.forEach(function (r) { add.push([blocs[m].saison].concat(r).concat([now])); }); blocs[m].live = false; });
    arch.getRange(arch.getLastRow() + 1, 1, add.length, add[0].length).setValues(add);
  }

  // Total saison recalculé à partir des lignes « Total match » (figées ou non)
  const K = {}; PIL_DETAIL_COLS.forEach(function (c, i) { K[c[0]] = i; });
  const totalSaison = function (lignes, s, n) {
    const t = {}; ['alcTTC', 'alcHT', 'saTTC', 'saHT', 'vend', 'v30', 'v50', 'rend', 'nonRemb', 'garde', 'ndEsp', 'recup', 'consCB', 'consESP', 'rembESP', 'rembCB', 'soldeEsp']
      .forEach(function (k) { t[k] = r2(lignes.reduce(function (a, l) { return a + (Number(l[K[k]]) || 0); }, 0)); });
    const ign = lignes.reduce(function (a, l) { const n = parseInt(l[K.anom], 10); return a + (isNaN(n) ? 0 : n); }, 0);
    t.anom = ign ? ign + ' gobelet' + (ign > 1 ? 's' : '') + ' « rendu' + (ign > 1 ? 's' : '') + ' » à une buvette sans caisse, non comptés' : '';
    t.fond = lignes.reduce(function (a, l) { return Math.max(a, Number(l[K.fond]) || 0); }, 0);
    t.partAlc = t.alcTTC + t.saTTC ? t.alcTTC / (t.alcTTC + t.saTTC) : ''; t.taux = t.vend > 0 ? t.rend / t.vend : '';
    t.match = 'SAISON ' + s; t.date = ''; t.adv = n + ' match' + (n > 1 ? 's' : ''); t.buv = 'Toutes';
    return PIL_DETAIL_COLS.map(function (c) { return t[c[0]]; });
  };

  // Fond de caisse de départ par match et par buvette : d'abord le fond saisi à la clôture
  // par le bénévole (s'il est > 0), sinon celui déclaré pour CE match, sinon rien — jamais
  // un chiffre inventé, qui rendrait le contrôle des espèces faussement juste.
  const fondDe = function (m, b) {
    if (PIL.BUVETTES_SANS_CAISSE.indexOf(b) >= 0) return null;
    const cl = (pilProp_('PIL_CLOTURE_' + m, {}) || {})[b] || {};
    const f = Number(cl.fond);
    if (f > 0) return f;
    const d = Number(pilFondsMatch_(m)[b]);
    return d > 0 ? d : '';
  };
  const iFond = PIL_DETAIL_COLS.findIndex(function (c) { return c[0] === 'fond'; }) + 1;
  const AFF_COLS = PIL_DETAIL_COLS.slice(0, iFond).concat(PIL_DETAIL_FOND_COLS).concat(PIL_DETAIL_COLS.slice(iFond));
  const avecFond = function (l, ext) { return l.slice(0, iFond).concat(ext).concat(l.slice(iFond)); };
  const extBuvette = function (m, l) {
    const b = String(l[K.buv]), f = fondDe(m, b);
    if (f === null) return ['sans caisse', '', ''];
    if (f === '') return ['', '', ''];
    const solde = Number(l[K.soldeEsp]) || 0, mini = Number(l[K.fond]) || 0;
    const mv = Number(((pilProp_('PIL_CLOTURE_' + m, {}) || {})[b] || {}).mouvCaisse) || 0;   // retraits / apports notés sur la tablette
    return [f, r2(f + solde + mv), r2(f - mini)];
  };

  // Lignes : saison (total) → match (total) → buvettes
  const matchs = Object.keys(blocs).sort(function (x, y) { return new Date(blocs[y].date) - new Date(blocs[x].date); });
  const saisons = [];
  matchs.forEach(function (m) { if (saisons.indexOf(blocs[m].saison) < 0) saisons.push(blocs[m].saison); });
  const out = [], styles = [];
  saisons.forEach(function (s) {
    const ms = matchs.filter(function (m) { return blocs[m].saison === s; });
    out.push(avecFond(totalSaison(ms.map(function (m) { return blocs[m].rows[0]; }), s, ms.length), ['', '', ''])); styles.push('saison');
    ms.forEach(function (m) {
      // Total match : fonds additionnés, espèces attendues additionnées, marge = la plus juste des buvettes avec caisse
      const exts = blocs[m].rows.slice(1).map(function (r) { return extBuvette(m, r); }).filter(function (e) { return typeof e[0] === 'number'; });
      const extTot = exts.length ? [exts.reduce(function (a, e) { return a + e[0]; }, 0), r2(exts.reduce(function (a, e) { return a + e[1]; }, 0)),
        exts.reduce(function (a, e) { return Math.min(a, e[2]); }, Infinity)] : ['', '', ''];
      blocs[m].rows.forEach(function (r, i) {
        const l = r.slice(); if (i === 0) l[K.buv] = blocs[m].live ? 'Total match (en cours)' : 'Total match 🔒';
        out.push(avecFond(l, i === 0 ? extTot : extBuvette(m, r))); styles.push(i === 0 ? 'match' : 'buv');
      });
    });
  });

  // Écriture
  let sh = ss.getSheetByName(PIL_DETAIL_TAB);
  if (!sh) { sh = ss.insertSheet(PIL_DETAIL_TAB); }
  sh.clear();
  const nc = AFF_COLS.length, navy = typeof NAVY !== 'undefined' ? NAVY : '#0b1f33', jaune = typeof YELLOW !== 'undefined' ? YELLOW : '#ffd400';
  sh.getRange(1, 1).setValue('🥤 DÉTAIL BUVETTE — alcool / sans alcool, écocups, espèces').setFontSize(16).setFontWeight('bold').setFontColor(navy);
  sh.getRange(2, 1).setValue("Mis à jour automatiquement (clôtures + toutes les 10 min). Chaque match est figé 🔒 deux jours après sa date : ses chiffres sont conservés et ne bougent plus (menu 🔓 pour en recalculer un). Non remboursés = vendus − rendus : gardés par le spectateur, rapportés mais pas remboursés faute d'espèces (bouton 🚫 de la tablette, à partir du match contre Sète), ou récupérés sur le comptoir / ramassés sans demande de remboursement (bouton 🫙, à partir du match contre Cannes). Stock et rachat : onglet 🥤 STOCK ÉCOCUPS. Par buvette, un gobelet vendu à une buvette et rendu à une autre fausse un peu le détail : se fier au total du match. Fond de caisse minimum = pire déficit d'espèces pendant le match (consignes payées en CB et remboursées en liquide), monnaie à rendre non comprise. Fond de départ = fond saisi à la clôture, sinon fond de la saison (B1 350 €, B2 450 €, B3 sans caisse) ; espèces attendues = fond + solde espèces ± argent pris / monnaie apportée en cours de match (notés sur la tablette, bouton 💶) ; marge négative = la caisse a dû manquer de liquide.")
    .setFontStyle('italic').setFontColor('#666666').setWrap(false);
  sh.getRange(3, 1, 1, nc).setValues([AFF_COLS.map(function (c) { return c[1]; })])
    .setBackground(navy).setFontColor(jaune).setFontWeight('bold').setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
  sh.setRowHeight(3, 48);
  if (out.length) {
    sh.getRange(4, 1, out.length, nc).setValues(out);
    AFF_COLS.forEach(function (c, i) {
      const rg = sh.getRange(4, i + 1, out.length, 1);
      if (c[2] === '€') rg.setNumberFormat('#,##0.00 €'); else if (c[2] === '%') rg.setNumberFormat('0%'); else if (c[2] === 'n') rg.setNumberFormat('0');
    });
    sh.getRange(4, 2, out.length, 1).setNumberFormat('dd/MM/yyyy');
    styles.forEach(function (st, i) {
      const rg = sh.getRange(4 + i, 1, 1, nc);
      if (st === 'saison') rg.setBackground('#c9daf8').setFontWeight('bold');
      else if (st === 'match') rg.setBackground('#e8eef7').setFontWeight('bold');
      else rg.setFontColor('#444444');
    });
  } else sh.getRange(4, 1).setValue('Aucune vente tablette pour le moment.');
  sh.setFrozenRows(3); sh.setFrozenColumns(4);
  sh.setColumnWidths(1, 4, 105); sh.setColumnWidths(5, nc - 4, 112);
  if (!silencieux) { try { ss.toast(out.length + ' ligne(s) dans ' + PIL_DETAIL_TAB); } catch (e) {} }
  try { pilotageStockEcocups(true); } catch (e) {}   // 🥤 STOCK ÉCOCUPS suit le détail buvette
  return out.length;
}

/**
 * migrerReassortsAppliques — À LANCER UNE SEULE FOIS, avec le déploiement du correctif réassorts.
 *
 * Marque applique:true sur toutes les entrées existantes de PIL_REASSORTS_*, pour rendre leur
 * état explicite dans les audits. Ces réassorts ont déjà été additionnés dans PIL_PREPA par
 * l'ancien code.
 *
 * ELLE N'EST PAS UN PRÉALABLE : pilReassortsTotaux_ n'additionne que les entrées portant
 * applique === false, drapeau que seul le nouveau code écrit. Une entrée ancienne, sans drapeau,
 * est donc déjà ignorée. Oublier cette migration ne double rien — elle ne sert qu'à la lisibilité.
 *
 * Idempotente : relancer ne fait rien de plus. N'écrit que dans les propriétés du script,
 * jamais dans le classeur.
 */
function migrerReassortsAppliques() {
  const p = PropertiesService.getScriptProperties();
  const cles = p.getKeys().filter(function (k) { return k.indexOf('PIL_REASSORTS_') === 0; });
  const L = ['MIGRATION DES RÉASSORTS — bornage aux matchs à venir', ''];
  let marquees = 0, deja = 0, actives = 0;
  cles.sort().forEach(function (k) {
    const j = pilProp_(k, []);
    if (!Array.isArray(j) || !j.length) return;
    let n = 0, a = 0;
    j.forEach(function (x) {
      if (!x) return;
      // On ne touche QUE les entrées sans drapeau : elles viennent de l'ancien code et sont
      // déjà dans PIL_PREPA. Une entrée applique:false est un réassort écrit par le NOUVEAU
      // code, légitimement additionné à la lecture : la marquer true le retirerait du départ.
      // C'est ce qui rend cette migration rejouable sans rien perdre.
      if (x.applique === undefined) { x.applique = true; n++; }
      else if (x.applique === false) a++;
      else deja++;
    });
    if (n) { pilSetProp_(k, j); marquees += n; }
    actives += a;
    L.push('  ' + k.slice('PIL_REASSORTS_'.length) + ' : ' + j.length + ' entrée(s), ' + n
      + ' ancienne(s) marquée(s) applique:true, ' + a + ' active(s) laissée(s) intacte(s)');
  });
  L.push('');
  L.push('Total : ' + marquees + ' ancienne(s) marquée(s), ' + deja + ' déjà marquée(s), '
    + actives + ' active(s) laissée(s) intacte(s) — celles-là restent additionnées au départ.');
  L.push('Effet rétroactif sur les matchs déjà joués : 0,00 € — avant comme après cette migration,');
  L.push('une entrée sans drapeau applique:false n\'est jamais additionnée.');
  L.push('Les réassorts de Tours (TOU-21-11) sont gelés eux aussi : leur réintégration');
  L.push('éventuelle est une décision à part, à prendre après diagnosticReassorts().');
  Logger.log(L.join('\n'));
  alerte_('Migration des réassorts\n\n' + marquees + ' entrée(s) marquée(s) « déjà appliquée ».\n'
    + 'Effet rétroactif : 0,00 €.\n\nDétail : Affichage → Journaux.');
  return { marquees: marquees };
}
