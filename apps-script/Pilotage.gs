// ═══════════════════════════════════════════════════════════════════════════
// PILOTAGE LIVE — module additif au Matchday Business (Code.gs V12)
// A coller comme NOUVEAU fichier Apps Script (Pilotage.gs), à côté de Code.gs
// et Fidelite.gs. Réutilise NAVY / YELLOW, 10_MATCHS, 50_VENTES_DIRECTES,
// PILOTAGE!B9 et _fidCreditOne_ (Fidelite.gs) s'il est présent.
//
// Billetterie : Tickie (plateforme Vivenu, API https://vivenu.com/api).
//
// Flux jour de match :
//  1. Tableau de bord (pilotage.html) : choix du match Tickie + stock par buvette
//     → action=prepa → stock gardé dans le script, match actif dans PILOTAGE!B9.
//  0. Les matchs Spacer's de Tickie sont recopiés dans 10_MATCHS (menu ou auto, 1 fois/h),
//     avec l'affluence (billets + abonnés, puis entrées scannées) dans AFFLUENCE.
//  2. Tablette en wifi : action=tablette → match, stock, billets valides
//     (code-barres + tarif, sans nom ni email) pour travailler hors ligne.
//  3. Tablette hors ligne : ventes stockées, renvoyées au retour du réseau
//     (action=ventes, idempotent) → 51_VENTES_LIVE + 50_VENTES_DIRECTES.
//  4. Déclencheur toutes les 10 min : billet scanné → client Tickie
//     → 51_VENTES_LIVE (id client) + points fidélité (90_FIDELITE).
//
// Propriétés du script : VIVENU_API_KEY (clé API Tickie/Vivenu), PILOTAGE_TOKEN
// (créé par « Initialiser le pilotage »). Le tableau de bord ne reçoit que des totaux.
// ═══════════════════════════════════════════════════════════════════════════

const PIL = {
  VIVENU_BASE: 'https://vivenu.com/api',
  PORTIER_BASE: 'https://portier.vivenu.com/api',
  ABONNEMENT_EVENT_ID: '69fc9d2b69a5578199f9d5e9',   // « Abonnement 2026-2027 » dans Tickie
  SH_LIVE: '51_VENTES_LIVE',
  // Un seul onglet ajouté (51_VENTES_LIVE) ; stock de départ, stock restant et suivi des
  // tablettes sont gardés dans les propriétés du script.
  SH_VD: '50_VENTES_DIRECTES',
  FUT_LITRES: 30,
  BUVETTES: ['Buvette 1', 'Buvette 2', 'Buvette 3'],
  // Catalogue 26-27 : réf, libellé, prix de référence (la tablette envoie ses prix)
  PRODUITS: [
    ['P01_25',   'Bière 25cl',        3],
    ['P01_50',   'Bière 50cl',        6],
    ['P02_COCA', 'Coca-Cola',         3],
    ['P02_ORAN', 'Orangina',          3],
    ['P02_ICET', 'Ice Tea',           3],
    ['P02_SCHW', 'Schweppes Agrumes', 3],
    ['P03',      'Eau plate 50cl',    1],
    ['P04',      'Eau gazeuse 50cl',  1],
  ],
  // Lignes de préparation : FUT en fûts de 30 L (25cl et 50cl tirés du même fût), le reste en unités
  PREPA: [['FUT', 'Bière (fûts 30 L)'], ['P02_COCA', 'Coca-Cola'], ['P02_ORAN', 'Orangina'], ['P02_ICET', 'Ice Tea'],
          ['P02_SCHW', 'Schweppes Agrumes'], ['P03', 'Eau plate 50cl'], ['P04', 'Eau gazeuse 50cl']],
};
const PIL_LIVE_COLS = ['Reçu le', 'Horodatage', 'ID vente', 'ID_MATCH', 'Buvette', 'Total €', 'Consignes +',
  'Consignes rendues', 'ID billet', 'Code-barres', 'Tarif billet', 'Client Tickie', 'Fidélité'];
const PIL_I = {}; PIL_LIVE_COLS.forEach(function (c, i) { PIL_I[c] = i; });
const PIL_NB = PIL_LIVE_COLS.length;
const PIL_VD_HDR = ['MATCH', 'DATE', 'TABLETTE', 'REF', 'PRODUIT', 'QTY', 'PRIX_UNIT', 'CONSIGNE_UNIT', 'CA_HT', 'CA_CONSIGNE', 'TYPE'];

// ── Menu (ajouté à onOpen de Code.gs) ───────────────────────────────────
function pilotageMenu_(ui) {
  return ui.createMenu('📡 Pilotage live')
    .addItem('⚙️ Initialiser le pilotage', 'pilotageInitialiser')
    .addItem('🔑 Afficher le jeton', 'pilotageAfficherJeton')
    .addItem('🔄 Synchroniser les matchs Tickie', 'pilotageSyncMatchs')
    .addItem('🎫 Relier les billets scannés + fidélité', 'pilotageTraiterBillets')
    .addItem('⏱️ Activer le traitement auto (10 min)', 'pilotageInstallerDeclencheur')
    .addSeparator()
    .addItem("📚 Importer l'historique 22-26", 'importerHistoriqueBuvette')
    .addItem("🗑️ Retirer l'historique 22-26", 'retirerHistoriqueBuvette');
}

function pilotageInitialiser() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PIL.SH_LIVE);
  if (!sh) {
    sh = ss.insertSheet(PIL.SH_LIVE);
    const head = PIL_LIVE_COLS.concat(PIL.PRODUITS.map(function (p) { return p[1]; }));
    sh.getRange(1, 1, 1, head.length).setValues([head]).setBackground(NAVY).setFontColor(YELLOW).setFontWeight('bold');
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
  try { SpreadsheetApp.getUi().alert('✅ Toutes les 10 minutes : billets scannés reliés et fidélité créditée.\nToutes les heures : matchs et affluences Tickie mis à jour dans 10_MATCHS.'); } catch (e) {}
}

// ── Matchs Tickie → 10_MATCHS ────────────────────────────────────────────
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
  const msg = '🔄 ' + evs.length + ' match(s) Tickie dans 10_MATCHS\n' + lignes.join('\n');
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
  const sh = ss.getSheetByName(PIL.SH_VD) || ss.insertSheet(PIL.SH_VD);
  const h = sh.getLastRow() ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String) : [];
  if (h.indexOf('CA_HT') < 0) {
    if (sh.getLastRow() === 0) sh.appendRow(PIL_VD_HDR); else sh.getRange(1, 1, 1, PIL_VD_HDR.length).setValues([PIL_VD_HDR]);
    sh.getRange(1, 1, 1, PIL_VD_HDR.length).setBackground(NAVY).setFontColor(YELLOW).setFontWeight('bold');
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
function pilParcourirBillets_(eventId, fn) {
  let skip = 0;
  while (true) {
    const res = pilApi_(PIL.VIVENU_BASE, '/tickets', { event: eventId, status: 'VALID', top: 1000, skip: skip });
    const rows = res.rows || [];
    rows.forEach(function (t) { if (!t.status || t.status === 'VALID') fn(t); });
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
function pilListerBillets_(eventId) {   // [code-barres, id billet, tarif] — ni nom ni email
  const out = [];
  pilParcourirBillets_(eventId, function (t) { if (t.barcode) out.push([t.barcode, t._id, t.ticketName || '']); });
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

// ── 10_MATCHS : retrouver / créer l'ID_MATCH d'un match Tickie ───────────
function pilIdMatch_(ev, creer) {
  const sh = pilSheet_('10_MATCHS');
  if (!sh) throw new Error('10_MATCHS introuvable');
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
  sh.appendRow(hh.map(function (c) {
    switch (c) {
      case 'ID_MATCH': return idm;
      case 'DATE': return ev.dateMatch;
      case 'ADVERSAIRE': return adv;
      case 'TYPE_MATCH': return /coupe|cdf/i.test(ev.nom) ? 'Coupe de France' : 'Championnat';
      case 'STATUT': return 'OPEN';
      case 'ID_SAISON': return pilSaison_(ev.dateMatch);
      case 'TICKIE_EVENT_ID': return ev.id;
      case 'MODE_BUVETTE': return 'DIRECT';
      default: return '';
    }
  }));
  const k = pilSheet_('80_KPI_MATCH');
  if (k) { const kh = k.getRange(1, 1, 1, k.getLastColumn()).getValues()[0].map(String); k.appendRow(kh.map(function (c) { return c === 'MATCH' ? idm : ''; })); }
  return idm;
}
function pilModeDirect_(idm) {
  const sh = pilSheet_('10_MATCHS');
  const d = sh.getDataRange().getValues(), h = d[0].map(String), cId = h.indexOf('ID_MATCH');
  let c = h.indexOf('MODE_BUVETTE');
  for (let r = 1; r < d.length; r++) if (String(d[r][cId]) === idm) {
    if (c < 0) c = pilAjouterColonne_(sh, 'MODE_BUVETTE');
    sh.getRange(r + 1, c + 1).setValue('DIRECT');
    return;
  }
}
function pilAjouterColonne_(sh, nom) {
  const c = sh.getLastColumn();
  sh.getRange(1, c + 1).setValue(nom).setBackground(NAVY).setFontColor(YELLOW).setFontWeight('bold');
  return c;
}
function pilSaison_(dateStr) {
  const sh = pilSheet_('05_SAISONS');
  if (!sh) return '';
  const d = sh.getDataRange().getValues();
  for (let r = 1; r < d.length; r++) {
    const deb = d[r][2] ? pilDate_(d[r][2]) : '', fin = d[r][3] ? pilDate_(d[r][3]) : '';
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
  const pilot = pilSheet_('PILOTAGE');
  if (pilot) pilot.getRange('B9').setValue(idm);          // match actif du Matchday Business
  PropertiesService.getScriptProperties().setProperty('PIL_MATCH_ACTIF', JSON.stringify({ eventId: eventId, idMatch: idm, saved: now.toISOString() }));
  return { idMatch: idm, saved: now.toISOString() };
}
function pilStocksPrepa_(idm) {
  const out = {}, saved = pilProp_('PIL_PREPA_' + idm, {});
  PIL.BUVETTES.forEach(function (b) { out[b] = {}; PIL.PREPA.forEach(function (p) { out[b][p[0]] = Number((saved[b] || {})[p[0]]) || 0; }); });
  return out;
}
function pilActif_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('PIL_MATCH_ACTIF') || 'null'); } catch (e) { return null; } }
function pilLirePrepa_(eventId) {
  const actif = pilActif_();
  let idm = '';
  if (eventId) { const ev = pilEvent_(eventId); if (ev) idm = pilIdMatch_(ev, false); }
  else if (actif) { idm = actif.idMatch; eventId = actif.eventId; }
  return { eventId: eventId || '', idMatch: idm, actif: actif, lignes: PIL.PREPA, buvettes: PIL.BUVETTES,
    stocks: idm ? pilStocksPrepa_(idm) : null, tablettes: pilLireJournal_() };
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
    buvette: buvette, stock: pilStocksPrepa_(actif.idMatch)[buvette], futLitres: PIL.FUT_LITRES,
    billets: billets, billetsOk: billetsOk, charge: new Date().toISOString() };
}

// ── Réception des ventes ─────────────────────────────────────────────────
function pilEnregistrerVentes_(ventes) {
  const sh = pilSheet_(PIL.SH_LIVE);
  if (!sh) throw new Error('Pilotage non initialisé (menu 📡 Pilotage live → Initialiser)');
  const vd = pilEnsureVdHeader_();
  const last = sh.getLastRow(), deja = {};
  if (last > 1) sh.getRange(2, PIL_I['ID vente'] + 1, last - 1, 1).getValues().forEach(function (r) { deja[String(r[0])] = 1; });
  const rows = [], vdRows = [], recus = [], now = new Date();
  ventes.forEach(function (v) {
    if (!v || !v.id) return;
    recus.push(v.id);                       // déjà reçue : accusé quand même (idempotence)
    if (deja[String(v.id)]) return;
    deja[String(v.id)] = 1;
    const t = v.ticket || {}, ts = new Date(v.ts || Date.now()), idm = v.matchId || '', b = v.buvette || '', day = pilDate_(ts);
    const row = [now, ts, v.id, idm, b, Number(v.total) || 0, Number(v.consigne) || 0, Number(v.rendue) || 0,
      t.ticket_id || '', t.barcode || '', t.tarif || '', '', ''];
    PIL.PRODUITS.forEach(function (p) { row.push(Number((v.lignes || {})[p[0]]) || 0); });
    rows.push(row);
    Object.keys(v.lignes || {}).forEach(function (ref) {
      const q = Number(v.lignes[ref]) || 0, p = pilProduit_(ref), pu = Number((v.prix || {})[ref]) || p[2];
      if (q) vdRows.push([idm, day, b, ref, p[1], q, pu, 0, q * pu, 0, 'VENTE']);
    });
    if (v.consigne) vdRows.push([idm, day, b, 'E01', 'Écocup (consigne)', v.consigne, 0, 1, 0, v.consigne, 'VENTE']);
    if (v.rendue) vdRows.push([idm, day, b, 'E01', 'Remboursement consigne', v.rendue, 0, -1, 0, -v.rendue, 'REMBOURSEMENT_CONSIGNE']);
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  if (vdRows.length) vd.getRange(vd.getLastRow() + 1, 1, vdRows.length, vdRows[0].length).setValues(vdRows);
  return recus;
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
  const sh = pilSheet_(PIL.SH_LIVE);
  const data = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, PIL_NB + PIL.PRODUITS.length).getValues() : [];
  const rows = data.filter(function (r) {
    return idm ? String(r[PIL_I['ID_MATCH']]) === idm : (ev && pilDate_(r[PIL_I['Horodatage']]) === ev.dateMatch);
  });
  const buv = { ca: 0, ventes: rows.length, consignes: 0, rendues: 0, parBuvette: {}, parProduit: {}, parQuartHeure: {},
    reliees: { ventes: 0, ca: 0 }, parFamilleTarif: {} };
  PIL.BUVETTES.forEach(function (b) { buv.parBuvette[b] = { ca: 0, ventes: 0 }; });
  PIL.PRODUITS.forEach(function (p) { buv.parProduit[p[0]] = { nom: p[1], qte: 0 }; });
  rows.forEach(function (r) {
    const tot = Number(r[PIL_I['Total €']]) || 0, b = r[PIL_I['Buvette']] || '?';
    buv.ca += tot;
    buv.consignes += Number(r[PIL_I['Consignes +']]) || 0;
    buv.rendues += Number(r[PIL_I['Consignes rendues']]) || 0;
    buv.parBuvette[b] = buv.parBuvette[b] || { ca: 0, ventes: 0 };
    buv.parBuvette[b].ca += tot; buv.parBuvette[b].ventes++;
    PIL.PRODUITS.forEach(function (p, i) { buv.parProduit[p[0]].qte += Number(r[PIL_NB + i]) || 0; });
    const d = new Date(r[PIL_I['Horodatage']]);
    const q = Utilities.formatDate(new Date(Math.floor(d.getTime() / 900000) * 900000), pilTz_(), 'HH:mm');
    buv.parQuartHeure[q] = (buv.parQuartHeure[q] || 0) + tot;
    const fam = pilFamilleTarif_(r[PIL_I['Tarif billet']], r[PIL_I['Code-barres']]);
    buv.parFamilleTarif[fam] = buv.parFamilleTarif[fam] || { ventes: 0, ca: 0 };
    buv.parFamilleTarif[fam].ventes++; buv.parFamilleTarif[fam].ca += tot;
    if (r[PIL_I['ID billet']] || r[PIL_I['Code-barres']]) { buv.reliees.ventes++; buv.reliees.ca += tot; }
  });
  const stock = pilProp_('PIL_STOCK', {});
  return { event: ev, idMatch: idm, billetterie: billetterie, buvette: buv, stock: stock, tablettes: pilLireJournal_(),
    produits: PIL.PRODUITS.map(function (p) { return [p[0], p[1]]; }), maj: new Date().toISOString() };
}

// Affluence Tickie → colonne AFFLUENCE de 10_MATCHS (gardée par les KPI quand l'export OandB est vide)
function pilAffluence_(idm, n) {
  const sh = pilSheet_('10_MATCHS');
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
  const sh = pilSheet_(PIL.SH_LIVE);
  if (!sh || sh.getLastRow() < 2) return;
  const rg = sh.getRange(2, 1, sh.getLastRow() - 1, PIL_NB);
  const data = rg.getValues(), memo = {}, debut = Date.now();
  let relies = 0, credites = 0;
  data.forEach(function (r) {
    if (Date.now() - debut > 270000) return;               // marge sous la limite d'exécution
    const id = r[PIL_I['ID billet']], code = r[PIL_I['Code-barres']];
    if ((!id && !code) || r[PIL_I['Fidélité']]) return;
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
  try { SpreadsheetApp.getActiveSpreadsheet().toast(relies + ' vente(s) reliée(s) · ' + credites + ' crédit(s) fidélité'); } catch (e) {}
}
