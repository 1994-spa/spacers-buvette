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
  // Onglets : feuille_('VENTES') = 🧾 VENTES, feuille_('DETAIL') = ⚙️ détail ventes, feuille_('MATCHS') = 📅 MATCHS
  // (anciens noms 51_VENTES_LIVE / 50_VENTES_DIRECTES / 10_MATCHS acceptés). Stock de départ, stock restant
  // et suivi des tablettes sont gardés dans les propriétés du script.
  FUT_LITRES: 30,
  BUVETTES: ['Buvette 1', 'Buvette 2', 'Buvette 3'],
  // Pas de caisse espèces : CB uniquement, aucun remboursement de gobelet (même réglage dans la tablette, LIEUX)
  BUVETTES_SANS_CAISSE: ['Buvette 3'],
  // Fond de caisse de départ, identique à chaque match de la saison (même réglage dans la tablette, LIEUX).
  // Le fond saisi à la clôture de caisse, s'il a été envoyé, prime pour ce match.
  FONDS_CAISSE: { 'Buvette 1': 350, 'Buvette 2': 450 },
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
  // Lignes de préparation : FUT en fûts de 30 L (30cl et 50cl tirés du même fût), softs en bouteilles, eaux en unités
  PREPA: [['FUT', 'Bière (fûts 30 L)'], ['P02_COCA', 'Coca-Cola (bout. 1,25 L)'], ['P02_ORAN', 'Orangina (bout. 1,5 L)'], ['P02_ICET', 'Ice Tea (bout. 1,25 L)'],
          ['P02_SCHW', 'Schweppes (bout. 1,5 L)'], ['P03', 'Eau plate 50cl'], ['P04', 'Eau gazeuse 50cl']],
};
const PIL_LIVE_COLS = ['Reçu le', 'Horodatage', 'ID vente', 'ID_MATCH', 'Buvette', 'Total €', 'Consignes +',
  'Consignes rendues', 'ID billet', 'Code-barres', 'Tarif billet', 'Client Tickie', 'Fidélité'];
const PIL_I = {}; PIL_LIVE_COLS.forEach(function (c, i) { PIL_I[c] = i; });
const PIL_NB = PIL_LIVE_COLS.length;
const PIL_COL_PAIEMENT = PIL_NB + PIL.PRODUITS.length;   // index 0 de la colonne « Paiement » (CB / ESP), après les produits
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
    const head = PIL_LIVE_COLS.concat(PIL.PRODUITS.map(function (p) { return p[1]; })).concat(['Paiement']);
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
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'pilotageTraiterBillets') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pilotageTraiterBillets').timeBased().everyMinutes(10).create();
  try { SpreadsheetApp.getUi().alert('✅ Toutes les 10 minutes : billets scannés reliés, fidélité créditée et 📅 MATCHS recalculé.\nToutes les heures : matchs et affluences Tickie mis à jour.'); } catch (e) {}
}

// ── Matchs Tickie → 📅 MATCHS ────────────────────────────────────────────
function pilotageSyncMatchs(silencieux) {
  const evs = pilMatchsTickie_().filter(function (ev) { return /spacer/i.test(ev.nom); });
  let abonnes = 0;
  try { abonnes = pilCompterBillets_(PIL.ABONNEMENT_EVENT_ID, 3600).total; } catch (e) {}
  const lignes = evs.map(function (ev) {
    const idm = pilIdMatch_(ev, true);
    pilModeDirect_(idm);
    const b = pilCompterBillets_(ev.id, 600).total;
    const entrees = ev.dateMatch <= pilDate_(new Date()) ? pilCompterEntrees_(ev.id) : null;
    const aff = entrees > 0 ? entrees : b + abonnes;
    pilAffluence_(idm, aff);
    return idm + ' : ' + aff + (entrees > 0 ? ' entrées' : ' attendus (' + b + ' billets + ' + abonnes + ' abonnés)');
  });
  PropertiesService.getScriptProperties().setProperty('PIL_SYNC', String(Date.now()));
  const msg = '🔄 ' + evs.length + ' match(s) Tickie dans 📅 MATCHS\n' + lignes.join('\n');
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
function pilProduit_(ref) { return PIL.PRODUITS.filter(function (x) { return x[0] === ref; })[0] || [ref, ref, 0]; }

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
function pilCache_(key, ttl, fn) {
  const c = CacheService.getScriptCache(), hit = c.get(key);
  if (hit) return JSON.parse(hit);
  const v = fn();
  try { c.put(key, JSON.stringify(v), ttl); } catch (e) {}
  return v;
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
function pilCompterBillets_(eventId, ttl) {
  return pilCache_('pil_billets_' + eventId, ttl, function () {
    const o = { total: 0, payants: 0, invitations: 0, parTarif: {} };
    pilParcourirBillets_(eventId, function (t) {
      o.total++;
      if ((t.realPrice || 0) > 0) o.payants++;
      if (/invitation/i.test(t.ticketName || '')) o.invitations++;
      o.parTarif[t.ticketName || 'Autre'] = (o.parTarif[t.ticketName || 'Autre'] || 0) + 1;
    });
    return o;
  });
}
// Profil de remise d'un billet : 'ABO' (abonnement), nom du partenaire (lot CLIENTS_REMISE) ou '' (billet simple)
function pilProfilRemise_(t, eventId) {
  if ((eventId || t.eventId) === PIL.ABONNEMENT_EVENT_ID) return 'ABO';
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
function pilCompterEntrees_(eventId) {   // null si le contrôle d'accès n'est pas accessible
  try {
    return pilCache_('pil_entrees_' + eventId, 60, function () {
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
    });
  } catch (e) { return null; }
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
  // Adversaire = texte après « Vs » dans le nom Tickie (« Spacer's Vs Narbonne - Samedi… »)
  const m = String(ev.nom).match(/spacer'?s\s+vs\.?\s+([^-&·]+?)(\s+-|\s*&|$)/i) || String(ev.nom).match(/vs\.?\s+([^-&·]+?)(\s+-|\s*&|$)/i);
  const adv = m ? m[1].trim() : String(ev.nom);
  const idm = adv.replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 3).toUpperCase() + '-' + ev.dateMatch.slice(8, 10) + '-' + ev.dateMatch.slice(5, 7);
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
  const actifCell = SpreadsheetApp.getActiveSpreadsheet().getRangeByName('MATCH_ACTIF');   // 🏠 ACCUEIL
  if (actifCell) actifCell.setValue(idm); else { const pilot = pilSheet_('PILOTAGE'); if (pilot) pilot.getRange('B9').setValue(idm); }
  PropertiesService.getScriptProperties().setProperty('PIL_MATCH_ACTIF', JSON.stringify({ eventId: eventId, idMatch: idm, saved: now.toISOString() }));
  return { idMatch: idm, saved: now.toISOString() };
}
// Stock reçu pendant le match, saisi sur la tablette : ajouté au stock de départ de la buvette (coût matière juste)
function pilEnregistrerReassort_(r) {
  if (!r.id || !r.matchId || PIL.BUVETTES.indexOf(r.buvette) < 0) throw new Error('Réassort incomplet');
  const deja = pilProp_('PIL_REASSORTS_' + r.matchId, []);
  const actif = pilActif_();
  if (deja.some(function (x) { return x.id === r.id; })) return { recu: r.id, prepa: actif && actif.idMatch === r.matchId ? actif.saved : null };
  const prepa = pilStocksPrepa_(r.matchId), ajout = {};
  Object.keys(r.ajout || {}).forEach(function (ref) {
    const q = Math.round((Number(r.ajout[ref]) || 0) * 100) / 100;
    if (q <= 0 || prepa[r.buvette][ref] == null) return;
    prepa[r.buvette][ref] = Math.round((prepa[r.buvette][ref] + q) * 100) / 100; ajout[ref] = q;
  });
  pilSetProp_('PIL_PREPA_' + r.matchId, prepa);
  deja.push({ id: r.id, ts: r.ts, buvette: r.buvette, ajout: ajout, recu: new Date().toISOString() });
  pilSetProp_('PIL_REASSORTS_' + r.matchId, deja);
  let saved = null;
  if (actif && actif.idMatch === r.matchId) {   // nouveau repère : le tableau de bord et les autres tablettes voient le changement
    saved = new Date().toISOString(); actif.saved = saved;
    PropertiesService.getScriptProperties().setProperty('PIL_MATCH_ACTIF', JSON.stringify(actif));
  }
  try { if (typeof majMatchs === 'function') majMatchs(true); } catch (e) {}
  return { recu: r.id, prepa: saved };
}
function pilStocksPrepa_(idm) {
  const out = {}, saved = pilProp_('PIL_PREPA_' + idm, {});
  PIL.BUVETTES.concat(PIL.RESERVES).forEach(function (b) { out[b] = {}; PIL.PREPA.forEach(function (p) { out[b][p[0]] = Number((saved[b] || {})[p[0]]) || 0; }); });
  return out;
}
function pilActif_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('PIL_MATCH_ACTIF') || 'null'); } catch (e) { return null; } }
function pilLirePrepa_(eventId) {
  const actif = pilActif_();
  let idm = '';
  if (eventId) { const ev = pilEvent_(eventId); if (ev) idm = pilIdMatch_(ev, false); }
  else if (actif) { idm = actif.idMatch; eventId = actif.eventId; }
  return { eventId: eventId || '', idMatch: idm, actif: actif, lignes: PIL.PREPA, buvettes: PIL.BUVETTES, reserves: PIL.RESERVES,
    stocks: idm ? pilStocksPrepa_(idm) : null, tablettes: pilLireJournal_(),
    inventaire: idm ? pilProp_('PIL_INVENTAIRE_' + idm, {}) : {}, reassorts: idm ? pilProp_('PIL_REASSORTS_' + idm, []) : [],
    clotures: idm ? pilProp_('PIL_CLOTURE_' + idm, {}) : {}, futLitres: PIL.FUT_LITRES };
}

// Ce que la tablette emporte en buvette pour travailler hors ligne
function pilChargerTablette_(buvette) {
  if (PIL.BUVETTES.indexOf(buvette) < 0) throw new Error('Buvette inconnue');
  const actif = pilActif_();
  if (!actif) throw new Error('Aucun match préparé : saisis le stock dans le tableau de bord');
  const ev = pilEvent_(actif.eventId) || { id: actif.eventId, nom: actif.idMatch, date: '' };
  let billets = [], billetsOk = true;
  try { billets = pilListerBillets_(ev.id).concat(pilListerBillets_(PIL.ABONNEMENT_EVENT_ID)); } catch (e) { billetsOk = false; }
  pilJournal_(buvette, actif.idMatch, 3);
  return { match: { eventId: ev.id, idMatch: actif.idMatch, nom: ev.nom, date: ev.date, prepa: actif.saved },
    buvette: buvette, stock: pilStocksPrepa_(actif.idMatch)[buvette], futLitres: PIL.FUT_LITRES, produits: pilPrixTablette_(),
    billets: billets, billetsOk: billetsOk, charge: new Date().toISOString() };
}

// Prix de vente et seuils de 📦 PRODUITS envoyés aux tablettes (réf → {prix, seuil})
function pilPrixTablette_() {
  const cat = produitsCatalogue_(), out = {};
  PIL.PRODUITS.forEach(function (p) { const c = cat[p[0]]; if (c && c.prix > 0) out[p[0]] = { prix: c.prix, seuil: c.seuil }; });
  return out;
}

// ── Réception des ventes ─────────────────────────────────────────────────
function pilEnregistrerVentes_(ventes) {
  const sh = feuille_('VENTES');
  if (!sh) throw new Error('Pilotage non initialisé (menu 📡 Pilotage live → Initialiser)');
  const vd = pilEnsureVdHeader_();
  if (sh.getMaxColumns() < PIL_COL_PAIEMENT + 1) sh.insertColumnsAfter(sh.getMaxColumns(), PIL_COL_PAIEMENT + 1 - sh.getMaxColumns());
  const hPay = sh.getRange(1, PIL_COL_PAIEMENT + 1);
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
      (v.annule ? 'annulation de ' + v.annule : '') + (Number(v.remise) ? (v.annule ? ' · ' : '') + 'remise ' + (v.profilRemise === 'ABO' ? 'abonné' : v.profilRemise ? v.profilRemise : 'billet') + ' ' + Math.round((Number(v.tauxRemise) || 0.05) * 100) + ' % : ' + Number(v.remise).toFixed(2).replace('.', ',') + ' €' : '')];
    PIL.PRODUITS.forEach(function (p) { row.push(Number((v.lignes || {})[p[0]]) || 0); });
    row.push(v.paiement === 'CB' ? 'CB' : v.paiement === 'ESP' ? 'ESP' : v.paiement === 'BENEVOLE' ? 'BENEVOLE' : '');
    rows.push(row);
    Object.keys(v.lignes || {}).forEach(function (ref) {
      const q = Number(v.lignes[ref]) || 0, p = pilProduit_(ref), pu = Number((v.prix || {})[ref]) || p[2];
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
    nonCompte: !!c.nonCompte, benev: c.benev || {}, nbBenev: Number(c.nbBenev) || 0,
    mouvCaisse: Number(c.mouvCaisse) || 0 };   // argent pris (−) / monnaie apportée (+) par le responsable en cours de match
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
  const ev = pilEvent_(eventId);
  const idm = ev ? pilIdMatch_(ev, false) : '';
  let billetterie = null;
  if (ev) {
    const b = pilCompterBillets_(ev.id, 120);
    let abonnes = null;
    try { abonnes = pilCompterBillets_(PIL.ABONNEMENT_EVENT_ID, 3600).total; } catch (e) {}
    billetterie = { billets: b.total, payants: b.payants, invitations: b.invitations, parTarif: b.parTarif,
      abonnes: abonnes, entrees: pilCompterEntrees_(ev.id), jauge: ev.jauge };
    if (idm) pilAffluence_(idm, billetterie.entrees > 0 ? billetterie.entrees : b.total + (abonnes || 0));
  }
  const sh = feuille_('VENTES');
  const data = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, PIL_COL_PAIEMENT + 1).getValues() : [];
  const rows = data.filter(function (r) {
    return idm ? String(r[PIL_I['ID_MATCH']]) === idm : (ev && pilDate_(r[PIL_I['Horodatage']]) === ev.dateMatch);
  });
  const buv = { ca: 0, ventes: rows.length, consignes: 0, rendues: 0, parBuvette: {}, parProduit: {}, parQuartHeure: {},
    reliees: { ventes: 0, ca: 0 }, parFamilleTarif: {}, paiement: { CB: 0, ESP: 0, inconnu: 0 }, annulations: 0 };
  const nb0 = function () { return { ca: 0, ventes: 0, cb: 0, esp: 0, consignes: 0, rendues: 0, reliees: 0, produits: {} }; };
  PIL.BUVETTES.forEach(function (b) { buv.parBuvette[b] = nb0(); });
  PIL.PRODUITS.forEach(function (p) { buv.parProduit[p[0]] = { nom: p[1], qte: 0 }; });
  rows.forEach(function (r) {
    const tot = Number(r[PIL_I['Total €']]) || 0, b = r[PIL_I['Buvette']] || '?';
    const annul = /^annulation/.test(String(r[PIL_I['Fidélité']]));
    const pay = String(r[PIL_COL_PAIEMENT] || '');
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
    PIL.PRODUITS.forEach(function (p, i) {
      const q = Number(r[PIL_NB + i]) || 0;
      buv.parProduit[p[0]].qte += q;
      if (q) pb.produits[p[0]] = (pb.produits[p[0]] || 0) + q;
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
  if (vd && vd.getLastRow() > 1) {
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
  const graph = pilGraphiques_(data, rows, idm);
  return { event: ev, idMatch: idm, billetterie: billetterie, buvette: buv, stock: stock, tablettes: pilLireJournal_(), clotures: clotures,
    produits: PIL.PRODUITS.map(function (p) { return [p[0], p[1]]; }), maj: new Date().toISOString(),
    serie: graph.serie, saison: graph.saison, fonds: PIL.FONDS_CAISSE, sansCaisse: PIL.BUVETTES_SANS_CAISSE };
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
    const p = pt(q), b = String(r[PIL_I['Buvette']] || '?'), pay = String(r[PIL_COL_PAIEMENT] || ''), tot = Number(r[PIL_I['Total €']]) || 0;
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
    const b = String(r[PIL_I['Buvette']] || '?'), pay = String(r[PIL_COL_PAIEMENT] || '');
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
function pilotageTraiterBillets() {
  if (Date.now() - (Number(PropertiesService.getScriptProperties().getProperty('PIL_SYNC')) || 0) > 3600000) {
    try { pilotageSyncMatchs(true); } catch (e) {}
  }
  const sh = feuille_('VENTES');
  if (!sh || sh.getLastRow() < 2) { try { if (typeof pennylaneImportAuto_ === 'function') pennylaneImportAuto_(); if (typeof majMatchs === 'function') majMatchs(true); } catch (e) {} return; }
  const rg = sh.getRange(2, 1, sh.getLastRow() - 1, PIL_NB);
  const data = rg.getValues(), memo = {}, debut = Date.now();
  let relies = 0, credites = 0;
  const annulees = {};                                      // ventes annulées depuis la tablette : pas de points
  data.forEach(function (r) { const m = String(r[PIL_I['Fidélité']]).match(/^annulation de (.+)$/); if (m) annulees[m[1]] = 1; });
  data.forEach(function (r) {
    if (Date.now() - debut > 270000) return;               // marge sous la limite d'exécution
    const id = r[PIL_I['ID billet']], code = r[PIL_I['Code-barres']];
    if ((!id && !code) || r[PIL_I['Fidélité']]) return;
    if (annulees[String(r[PIL_I['ID vente']])]) { r[PIL_I['Fidélité']] = 'vente annulée'; return; }
    const key = id || ('bc:' + code);
    if (!(key in memo)) {
      try {
        let t = null;
        if (id) t = pilApi_(PIL.VIVENU_BASE, '/tickets/' + id, {});
        else { const res = pilApi_(PIL.VIVENU_BASE, '/tickets', { barcode: code, top: 5 }); t = (res.rows || []).filter(function (x) { return x.barcode === code; })[0] || null; }
        memo[key] = t ? { customerId: t.customerId || '', email: String(t.email || '').toLowerCase().trim(),
          nom: [t.firstname, t.lastname].filter(Boolean).join(' '), tarif: t.ticketName || '', id: t._id } : null;
      } catch (e) { memo[key] = undefined; }
    }
    const c = memo[key];
    if (c === undefined) return;                            // erreur réseau : on réessaiera
    if (c === null) { r[PIL_I['Fidélité']] = 'billet introuvable'; return; }
    r[PIL_I['Client Tickie']] = c.customerId;
    if (!r[PIL_I['ID billet']]) r[PIL_I['ID billet']] = c.id;
    if (!r[PIL_I['Tarif billet']]) r[PIL_I['Tarif billet']] = c.tarif;
    relies++;
    // Points sur les consommations, hors consignes
    const montant = (Number(r[PIL_I['Total €']]) || 0) - (Number(r[PIL_I['Consignes +']]) || 0) + (Number(r[PIL_I['Consignes rendues']]) || 0);
    if (typeof _fidCreditOne_ === 'function' && c.email && montant > 0) {
      _fidCreditOne_({ carte: c.email, nom: c.nom, montant: montant }, r[PIL_I['ID_MATCH']], r[PIL_I['Buvette']], pilDate_(r[PIL_I['Horodatage']]));
      r[PIL_I['Fidélité']] = Math.floor(montant) + ' pts'; credites++;
    } else r[PIL_I['Fidélité']] = 'relié';
  });
  rg.setValues(data);
  try { if (typeof pennylaneImportAuto_ === 'function') pennylaneImportAuto_(); } catch (e) {}   // achats Pennylane (toutes les 6 h)
  try { if (typeof majMatchs === 'function') majMatchs(true); } catch (e) {}   // 📅 MATCHS à jour en continu
  try { pilotageDetailBuvette(true); } catch (e) {}                                // 🥤 DÉTAIL BUVETTE à jour en continu
  try { if (typeof graphiquesMaj === 'function') graphiquesMaj(true); } catch (e) {}  // 📈 GRAPHIQUES à jour en continu
  try { SpreadsheetApp.getActiveSpreadsheet().toast(relies + ' vente(s) reliée(s) · ' + credites + ' crédit(s) fidélité'); } catch (e) {}
}

// ── Commande conseillée : données pour le tableau de bord ────────────────
// Le calcul (prévision, marge de sécurité, colisage) est fait dans pilotage.html ;
// le script fournit la billetterie, les consommations réelles par match 26-27 et le stock restant.
function pilDonneesCommande_(eventId) {
  const ev = pilEvent_(eventId);
  if (!ev) throw new Error('Match introuvable dans Tickie');
  const b = pilCompterBillets_(ev.id, 300);
  let abonnes = 0;
  try { abonnes = pilCompterBillets_(PIL.ABONNEMENT_EVENT_ID, 3600).total; } catch (e) {}
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
    live.getRange(2, 1, live.getLastRow() - 1, PIL_NB + PIL.PRODUITS.length).getValues().forEach(function (r) {
      const m = String(r[PIL_I['ID_MATCH']]); if (!m || m === idm) return;
      const o = parMatch[m] = parMatch[m] || { qte: {}, parBuvette: {} };
      PIL.PRODUITS.forEach(function (p, i) { o.qte[p[0]] = (o.qte[p[0]] || 0) + (Number(r[PIL_NB + i]) || 0); });
      const bv = r[PIL_I['Buvette']]; o.parBuvette[bv] = (o.parBuvette[bv] || 0) + (Number(r[PIL_I['Total €']]) || 0);
    });
  }
  const observes = Object.keys(parMatch).filter(function (m) { return aff[m] > 0; })
    .map(function (m) { return { idMatch: m, presents: aff[m], qte: parMatch[m].qte, parBuvette: parMatch[m].parBuvette }; });

  // Taux de présence appris : entrées scannées / (billets + abonnés) sur les matchs passés
  const taux = [];
  Object.keys(evDe).forEach(function (m) {
    if (!parMatch[m]) return;
    try {
      const e = pilCompterEntrees_(evDe[m]);
      if (e > 0) { const bb = pilCompterBillets_(evDe[m], 3600).total; if (bb + abonnes > 0) taux.push(e / (bb + abonnes)); }
    } catch (err) {}
  });

  // Stock restant en fin de dernier match (remonté par les tablettes)
  const st = pilProp_('PIL_STOCK', {}), reste = { FUT: 0 };
  Object.keys(st).forEach(function (bv) {
    Object.keys(st[bv]).forEach(function (ref) {
      const r = Number(st[bv][ref].restant) || 0;
      if (ref === 'FUT_L') reste.FUT += Math.floor(r / PIL.FUT_LITRES + 1e-9);   // seuls les fûts non entamés se gardent
      else if (ref !== 'P01_25' && ref !== 'P01_50') reste[ref] = (reste[ref] || 0) + r;
    });
  });

  return { event: ev, idMatch: idm,
    billetterie: { billets: b.total, payants: b.payants, invitations: b.invitations, abonnes: abonnes, jauge: ev.jauge },
    presence: taux.length ? taux.reduce(function (a, x) { return a + x; }, 0) / taux.length : null, presenceN: taux.length,
    observes: observes, reste: reste, futLitres: PIL.FUT_LITRES, buvettes: PIL.BUVETTES,
    colisage: (function () { const c = {}, cat = produitsCatalogue_(); Object.keys(cat).forEach(function (r) { if (cat[r].colisage && r !== 'FUT') c[r] = cat[r].colisage; }); return c; })() };
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

  // Fond de caisse de départ par match et par buvette : fond saisi à la clôture (s'il est > 0), sinon PIL.FONDS_CAISSE
  const fondDe = function (m, b) {
    if (PIL.BUVETTES_SANS_CAISSE.indexOf(b) >= 0) return null;
    const cl = (pilProp_('PIL_CLOTURE_' + m, {}) || {})[b] || {};
    const f = Number(cl.fond);
    if (f > 0) return f;
    return b in PIL.FONDS_CAISSE ? PIL.FONDS_CAISSE[b] : '';
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
