/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PILOTAGE BUVETTE — Spacer's Toulouse Volley
 *  Projet Apps Script lié à un Google Sheet dédié (distinct du Sheet stocks).
 *
 *  - doPost  : reçoit les ventes validées des tablettes (envoi au fil de l'eau,
 *              idempotent par identifiant de vente) + le stock restant.
 *  - doGet   : ?action=events     → matchs billetterie (sélecteur du tableau de bord)
 *              ?action=dashboard  → agrégats du match (billetterie + buvette)
 *              ?action=ping       → test de connexion
 *  - Menu    : Initialiser · Relier les ventes aux acheteurs · Afficher le jeton
 *
 *  Propriétés du script (Paramètres du projet → Propriétés du script) :
 *    VIVENU_API_KEY   clé API Vivenu (jamais côté tablette)
 *    PILOTAGE_TOKEN   jeton partagé tablettes / tableau de bord (créé par initialiser())
 *
 *  Données personnelles : les tablettes n'envoient que l'identifiant du billet,
 *  son code-barres et son tarif. Le lien vers le client CRM (customerId Vivenu)
 *  est fait ici, côté serveur, par relierAcheteurs(). Le tableau de bord ne
 *  reçoit que des agrégats.
 * ═══════════════════════════════════════════════════════════════════════
 */

const PILOTAGE = {
  VIVENU_BASE: 'https://vivenu.com/api',
  PORTIER_BASE: 'https://portier.vivenu.com/api',
  ABONNEMENT_EVENT_ID: '69fc9d2b69a5578199f9d5e9',   // événement « Abonnement 2026-2027 »
  TZ: 'Europe/Paris',
  SHEET_VENTES: 'VENTES',
  SHEET_STOCK: 'STOCK_LIVE',
  PRODUITS: [
    ['P01_25',   'Bière 25cl'],
    ['P01_50',   'Bière 50cl'],
    ['P02_COCA', 'Coca-Cola'],
    ['P02_ORAN', 'Orangina'],
    ['P02_ICET', 'Ice Tea'],
    ['P02_SCHW', 'Schweppes Agrumes'],
    ['P03',      'Eau plate 50cl'],
    ['P04',      'Eau gazeuse 50cl'],
  ],
  BUVETTES: ['Buvette 1', 'Buvette 2', 'Buvette 3'],
};

// Colonnes fixes de VENTES (les colonnes produits suivent)
const COLS_FIXES = ['Horodatage', 'ID vente', 'Date match', 'Match', 'Buvette', 'Total €',
  'Consignes +', 'Consignes rendues', 'ID billet', 'Code-barres', 'Tarif billet', 'Client CRM (id)'];
const IDX = {}; COLS_FIXES.forEach((c, i) => IDX[c] = i);
const NB_FIXES = COLS_FIXES.length;

// ── Menu ────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Pilotage buvette')
    .addItem('Initialiser les onglets', 'initialiser')
    .addItem('Relier les ventes aux acheteurs', 'relierAcheteurs')
    .addItem('Afficher le jeton', 'afficherJeton')
    .addToUi();
}

function initialiser() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PILOTAGE.SHEET_VENTES) || ss.insertSheet(PILOTAGE.SHEET_VENTES);
  const head = COLS_FIXES.concat(PILOTAGE.PRODUITS.map(p => p[1]));
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  sh.setFrozenRows(1);
  let st = ss.getSheetByName(PILOTAGE.SHEET_STOCK) || ss.insertSheet(PILOTAGE.SHEET_STOCK);
  st.getRange(1, 1, 1, 5).setValues([['Buvette', 'Réf.', 'Produit', 'Restant', 'Mis à jour']]).setFontWeight('bold');
  st.setFrozenRows(1);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PILOTAGE_TOKEN')) props.setProperty('PILOTAGE_TOKEN', Utilities.getUuid().replace(/-/g, '').slice(0, 20));
  afficherJeton();
}

function afficherJeton() {
  const t = PropertiesService.getScriptProperties().getProperty('PILOTAGE_TOKEN') || '(lancer Initialiser)';
  const k = PropertiesService.getScriptProperties().getProperty('VIVENU_API_KEY') ? 'renseignée' : 'MANQUANTE';
  try { SpreadsheetApp.getUi().alert('Jeton de pilotage : ' + t + '\nClé API Vivenu : ' + k); } catch (e) { Logger.log(t); }
}

// ── Utilitaires ─────────────────────────────────────────────────────────
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function tokenOk_(t) {
  const ref = PropertiesService.getScriptProperties().getProperty('PILOTAGE_TOKEN');
  return !!ref && t === ref;
}
function dateParis_(d) { return Utilities.formatDate(new Date(d), PILOTAGE.TZ, 'yyyy-MM-dd'); }

// ── Réception des ventes ────────────────────────────────────────────────
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ status: 'error', message: 'JSON invalide' }); }
  if (!tokenOk_(body.token)) return json_({ status: 'error', message: 'Jeton refusé' });
  if (body.action !== 'ventes') return json_({ status: 'error', message: 'Action inconnue' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const recus = enregistrerVentes_(body.ventes || []);
    if (body.stock && body.buvette) majStock_(body.buvette, body.stock);
    return json_({ status: 'ok', recus: recus });
  } finally { lock.releaseLock(); }
}

function enregistrerVentes_(ventes) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PILOTAGE.SHEET_VENTES);
  const last = sh.getLastRow();
  const deja = new Set(last > 1 ? sh.getRange(2, IDX['ID vente'] + 1, last - 1, 1).getValues().map(r => String(r[0])) : []);
  const rows = [], recus = [];
  ventes.forEach(v => {
    if (!v || !v.id) return;
    recus.push(v.id);                 // déjà reçue = accusé quand même (idempotence)
    if (deja.has(String(v.id))) return;
    deja.add(String(v.id));
    const t = v.ticket || {};
    const row = [new Date(v.ts || Date.now()), v.id, "'" + dateParis_(v.ts || Date.now()), v.matchId || '', v.buvette || '',
      Number(v.total) || 0, Number(v.consigne) || 0, Number(v.rendue) || 0,
      t.ticket_id || '', t.barcode || '', t.tarif || '', ''];
    PILOTAGE.PRODUITS.forEach(p => row.push(Number((v.lignes || {})[p[0]]) || 0));
    rows.push(row);
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return recus;
}

function majStock_(buvette, stock) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PILOTAGE.SHEET_STOCK);
  const data = sh.getDataRange().getValues();
  const now = new Date();
  const noms = {}; PILOTAGE.PRODUITS.forEach(p => noms[p[0]] = p[1]);
  Object.keys(stock).forEach(ref => {
    let r = data.findIndex((row, i) => i > 0 && row[0] === buvette && row[1] === ref);
    const vals = [[buvette, ref, noms[ref] || ref, Number(stock[ref]) || 0, now]];
    if (r > 0) sh.getRange(r + 1, 1, 1, 5).setValues(vals);
    else { sh.appendRow(vals[0]); data.push(vals[0]); }
  });
}

// ── Lecture ─────────────────────────────────────────────────────────────
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'ping') return json_({ status: 'ok', app: 'pilotage-buvette' });
  if (!tokenOk_(p.token)) return json_({ status: 'error', message: 'Jeton refusé' });
  try {
    if (p.action === 'events') return json_({ status: 'ok', events: listerMatchs_() });
    if (p.action === 'dashboard') return json_(Object.assign({ status: 'ok' }, dashboard_(p.eventId, p.date)));
    return json_({ status: 'error', message: 'Action inconnue' });
  } catch (err) {
    return json_({ status: 'error', message: String(err && err.message || err) });
  }
}

function vivenu_(base, path, query) {
  const key = PropertiesService.getScriptProperties().getProperty('VIVENU_API_KEY');
  if (!key) throw new Error('VIVENU_API_KEY manquante dans les propriétés du script');
  const qs = Object.keys(query || {}).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(query[k])).join('&');
  const r = UrlFetchApp.fetch(base + path + (qs ? '?' + qs : ''), {
    headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('Vivenu ' + r.getResponseCode() + ' sur ' + path);
  return JSON.parse(r.getContentText());
}

function cache_(key, ttl, fn) {
  const c = CacheService.getScriptCache();
  const hit = c.get(key);
  if (hit) return JSON.parse(hit);
  const v = fn();
  try { c.put(key, JSON.stringify(v), ttl); } catch (e) {}
  return v;
}

function listerMatchs_() {
  return cache_('events', 600, () => {
    const res = vivenu_(PILOTAGE.VIVENU_BASE, '/events', { top: 100 });
    const rows = res.rows || res.docs || res || [];
    return rows.filter(ev => ev._id !== PILOTAGE.ABONNEMENT_EVENT_ID)
      .map(ev => ({ id: ev._id, nom: ev.name, date: ev.start, dateMatch: dateParis_(ev.start), jauge: ev.maxAmount || null }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  });
}

// Billets VALID d'un événement, comptés par tarif (sans données personnelles)
function compterBillets_(eventId, ttl) {
  return cache_('billets_' + eventId, ttl, () => {
    let skip = 0, total = 0, payants = 0, invitations = 0;
    const parTarif = {};
    while (true) {
      const res = vivenu_(PILOTAGE.VIVENU_BASE, '/tickets', { event: eventId, status: 'VALID', top: 1000, skip: skip });
      const rows = res.rows || [];
      rows.forEach(t => {
        if (t.status && t.status !== 'VALID') return;
        total++;
        if ((t.realPrice || 0) > 0) payants++;
        if (/invitation/i.test(t.ticketName || '')) invitations++;
        parTarif[t.ticketName || 'Autre'] = (parTarif[t.ticketName || 'Autre'] || 0) + 1;
      });
      skip += rows.length;
      if (!rows.length || skip >= (res.total || 0)) break;
    }
    return { total: total, payants: payants, invitations: invitations, parTarif: parTarif };
  });
}

// Entrées scannées (contrôle d'accès Vivenu). null si l'API n'est pas accessible.
function compterEntrees_(eventId) {
  try {
    return cache_('entrees_' + eventId, 60, () => {
      const vus = {}; let skip = 0;
      while (true) {
        const res = vivenu_(PILOTAGE.PORTIER_BASE, '/scans', { eventId: eventId, top: 1000, skip: skip });
        const rows = res.rows || res.docs || [];
        rows.forEach(s => {
          if (s.scanResult && s.scanResult !== 'approved') return;
          if (s.type === 'checkout') delete vus[s.ticketId || s.barcode];
          else vus[s.ticketId || s.barcode] = 1;
        });
        skip += rows.length;
        if (!rows.length || skip >= (res.total || 0)) break;
      }
      return Object.keys(vus).length;
    });
  } catch (e) { return null; }
}

function familleTarif_(tarif) {
  if (!tarif) return 'Sans billet';
  if (/abonn/i.test(tarif)) return 'Abonné';
  if (/invitation|gratuit|licenci/i.test(tarif)) return 'Invité / gratuit';
  return 'Billet payant';
}

function dashboard_(eventId, dateParam) {
  let ev = null;
  if (eventId) ev = listerMatchs_().find(x => x.id === eventId) || null;
  const dateMatch = dateParam || (ev ? ev.dateMatch : dateParis_(new Date()));

  // Billetterie
  let billetterie = null;
  if (ev) {
    const b = compterBillets_(ev.id, 120);
    let abonnes = null;
    try { abonnes = compterBillets_(PILOTAGE.ABONNEMENT_EVENT_ID, 3600).total; } catch (e) {}
    billetterie = { billets: b.total, payants: b.payants, invitations: b.invitations, parTarif: b.parTarif,
      abonnes: abonnes, entrees: compterEntrees_(ev.id), jauge: ev.jauge };
  }

  // Buvette
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PILOTAGE.SHEET_VENTES);
  const data = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, NB_FIXES + PILOTAGE.PRODUITS.length).getValues() : [];
  const rows = data.filter(r => String(r[IDX['Date match']] instanceof Date ? dateParis_(r[IDX['Date match']]) : r[IDX['Date match']]) === dateMatch);
  const buv = { ca: 0, ventes: rows.length, consignes: 0, rendues: 0, parBuvette: {}, parProduit: {}, parQuartHeure: {},
    reliees: { ventes: 0, ca: 0 }, parFamilleTarif: {} };
  PILOTAGE.BUVETTES.forEach(b => buv.parBuvette[b] = { ca: 0, ventes: 0 });
  PILOTAGE.PRODUITS.forEach(p => buv.parProduit[p[0]] = { nom: p[1], qte: 0 });
  rows.forEach(r => {
    const tot = Number(r[IDX['Total €']]) || 0, b = r[IDX['Buvette']] || '?';
    buv.ca += tot;
    buv.consignes += Number(r[IDX['Consignes +']]) || 0;
    buv.rendues += Number(r[IDX['Consignes rendues']]) || 0;
    (buv.parBuvette[b] = buv.parBuvette[b] || { ca: 0, ventes: 0 });
    buv.parBuvette[b].ca += tot; buv.parBuvette[b].ventes++;
    PILOTAGE.PRODUITS.forEach((p, i) => buv.parProduit[p[0]].qte += Number(r[NB_FIXES + i]) || 0);
    const d = new Date(r[IDX['Horodatage']]);
    const q = Utilities.formatDate(new Date(Math.floor(d.getTime() / 900000) * 900000), PILOTAGE.TZ, 'HH:mm');
    buv.parQuartHeure[q] = (buv.parQuartHeure[q] || 0) + tot;
    const fam = familleTarif_(r[IDX['Tarif billet']]);
    (buv.parFamilleTarif[fam] = buv.parFamilleTarif[fam] || { ventes: 0, ca: 0 });
    buv.parFamilleTarif[fam].ventes++; buv.parFamilleTarif[fam].ca += tot;
    if (r[IDX['ID billet']]) { buv.reliees.ventes++; buv.reliees.ca += tot; }
  });

  // Stock restant
  const st = ss.getSheetByName(PILOTAGE.SHEET_STOCK);
  const stock = {};
  if (st && st.getLastRow() > 1) st.getRange(2, 1, st.getLastRow() - 1, 5).getValues().forEach(r => {
    (stock[r[0]] = stock[r[0]] || {})[r[1]] = { restant: r[3], maj: r[4] };
  });

  return { event: ev, dateMatch: dateMatch, billetterie: billetterie, buvette: buv, stock: stock,
    produits: PILOTAGE.PRODUITS, maj: new Date().toISOString() };
}

// ── Lien vente → acheteur (côté serveur uniquement) ─────────────────────
// Complète « Client CRM (id) » avec le customerId Vivenu du billet scanné.
function relierAcheteurs() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PILOTAGE.SHEET_VENTES);
  const n = sh.getLastRow() - 1;
  if (n < 1) return;
  const rg = sh.getRange(2, 1, n, NB_FIXES);
  const data = rg.getValues();
  const memo = {};
  let faits = 0;
  data.forEach(r => {
    const id = r[IDX['ID billet']];
    if (!id || r[IDX['Client CRM (id)']]) return;
    try {
      if (!(id in memo)) memo[id] = (vivenu_(PILOTAGE.VIVENU_BASE, '/tickets/' + id, {}) || {}).customerId || '';
      r[IDX['Client CRM (id)']] = memo[id]; faits++;
    } catch (e) { /* billet introuvable : on laisse vide */ }
  });
  rg.setValues(data);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(faits + ' vente(s) reliée(s) à un client CRM'); } catch (e) {}
}
