// ═══════════════════════════════════════════════════════════════════════════
// ACHATS — miroir des factures Pennylane (compte 607100000 « Achat buvette »)
// ═══════════════════════════════════════════════════════════════════════════
// Pennylane reste la SEULE source des factures fournisseurs : aucun PDF dupliqué dans le Drive.
// Ce module recopie les lignes d'écritures du compte d'achats buvette dans 🛒 ACHATS
// (date, libellé, montant HT, lien vers la pièce), sans rien écrire dans Pennylane.
// Propriété du script : PENNYLANE_API_KEY (token Pennylane, droit « Lecture des écritures
// comptables » + « Lecture des comptes comptables »). Import automatique toutes les 6 h.
// ═══════════════════════════════════════════════════════════════════════════
const PENNYLANE = {
  BASE: 'https://app.pennylane.com/api/external/v2',
  COMPTES: ['607100000'],          // Achat buvette (le compte 607200000 Achat boutique n'est pas repris)
  INTERVALLE_H: 6,
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
  const res = plApi_('/ledger_accounts', { filter: JSON.stringify([{ field: 'number', operator: 'eq', value: numero }]), limit: 20 });
  const a = plItems_(res).filter(function (x) { return String(x.number) === numero; })[0];
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

// Menu + automatique : importe les achats buvette depuis le début de la saison précédente
function pennylaneImporterAchats(silencieux) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONG.ACHATS);
  if (!sh) throw new Error('Onglet 🛒 ACHATS introuvable (lancer la réorganisation)');
  assurerStructure_();
  const sa = donnees_(feuille_('SAISONS')).filter(function (r) { return r[2] instanceof Date; }).sort(function (a, b) { return a[2] - b[2]; });
  const enCours = sa.filter(function (r) { return String(r[7]) === 'EN COURS'; })[0];
  const i = enCours ? sa.indexOf(enCours) : sa.length - 1;
  const depuis = sa.length ? jour_(sa[Math.max(0, i - 1)][2]) : '2025-08-01';

  const h = entete_(sh), d = donnees_(sh), iId = h.indexOf('ID PENNYLANE');
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
      vus[id] = 1;
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
  const msg = '🧾 Achats Pennylane (compte ' + PENNYLANE.COMPTES.join(', ') + ' depuis le ' + depuis + ') : ' + ajout + ' ajoutée(s), ' + maj + ' mise(s) à jour' + (avant - garde.length ? ', ' + (avant - garde.length) + ' retirée(s)' : '') + '.';
  if (silencieux !== true) alerte_(msg);
  return msg;
}

// Appelé par le traitement automatique (toutes les 10 min) : import au plus toutes les 6 h
function pennylaneImportAuto_() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('PENNYLANE_API_KEY')) return;
  if (Date.now() - (Number(p.getProperty('PL_SYNC')) || 0) < PENNYLANE.INTERVALLE_H * 3600000) return;
  try { pennylaneImporterAchats(true); } catch (e) { Logger.log(e.message); }
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
