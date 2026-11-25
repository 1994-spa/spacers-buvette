const fs = require('fs');

// ── Stubs des services Google ──────────────────────────────────────────────
let props = {}, cache = {}, logs = [], apiCalls = [];
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in props ? props[k] : null),
  setProperty: (k, v) => { props[k] = String(v); },
  deleteProperty: k => { delete props[k]; },
  getProperties: () => Object.assign({}, props) }) };
global.CacheService = { getScriptCache: () => ({
  get: k => (k in cache ? cache[k] : null),
  getAll: ks => { const o = {}; ks.forEach(k => { if (k in cache) o[k] = cache[k]; }); return o; },
  put: (k, v) => { cache[k] = v; }, putAll: v => Object.assign(cache, v), remove: k => { delete cache[k]; } }) };
global.LockService = { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) };
global.Logger = { log: m => logs.push(String(m)) };
global.Utilities = { formatDate: (d, tz, f) => {
  const x = new Date(d);
  if (f === 'yyyy-MM-dd') return x.toISOString().slice(0, 10);
  return x.toISOString().slice(11, 16); }, sleep: () => {} };
global.Session = { getScriptTimeZone: () => 'Europe/Paris' };
global.ScriptApp = { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }), everyHours: () => ({ create: () => {} }) }) }) };
global.ContentService = { createTextOutput: t => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } };
global.UrlFetchApp = { fetch: () => { throw new Error('aucun appel reseau direct attendu'); } };

// ── Fausse feuille ─────────────────────────────────────────────────────────
class Feuille {
  constructor(d) { this.d = d; }
  getLastRow() { return this.d.length; }
  getLastColumn() { return Math.max(...this.d.map(r => r.length)); }
  getDataRange() { return this.getRange(1, 1, this.d.length, this.getLastColumn()); }
  getRange(l, c, nl = 1, nc = 1) {
    const sh = this;
    return {
      getValues() { const o = []; for (let i = 0; i < nl; i++) { const r = sh.d[l - 1 + i] || []; o.push(Array.from({ length: nc }, (_, j) => r[c - 1 + j] ?? '')); } return o; },
      setValues(v) { v.forEach((row, i) => { const li = l - 1 + i; while (sh.d.length <= li) sh.d.push([]); row.forEach((x, j) => { sh.d[li][c - 1 + j] = x; }); }); return this; },
      setValue(x) { return this.setValues([[x]]); },
      clearContent() { for (let i = 0; i < nl; i++) { const r = sh.d[l - 1 + i]; if (r) for (let j = 0; j < nc; j++) r[c - 1 + j] = ''; } return this; },
      setBackground() { return this; }, setFontColor() { return this; }, setFontWeight() { return this; }, setNumberFormat() { return this; }
    };
  }
  setFrozenRows() {} appendRow(r) { this.d.push(r.slice()); }
}
let feuilles = {};
global.feuille_ = c => feuilles[c] || null;
global.SpreadsheetApp = { getActive: () => FAUX_SS, getActiveSpreadsheet: () => FAUX_SS, getUi: () => { throw new Error('pas d UI'); } };
const FAUX_SS = { toast: () => {}, getSheetByName: n => feuilles[n] || null, insertSheet: n => (feuilles[n] = new Feuille([])),
  getRangeByName: () => null, createTextFinder: () => ({ matchEntireCell: () => ({ matchCase: () => ({ findAll: () => [] }) }) }) };

// ── Les recalculs de fin : on note juste qu'ils ont ete appeles ────────────
let finAppelee = [];
global.majMatchs = () => finAppelee.push('majMatchs');
global.pilotageDetailBuvette = () => finAppelee.push('detail');
global.graphiquesMaj = () => finAppelee.push('graphiques');
global.pennylaneImportAuto_ = () => finAppelee.push('pennylane');
let fidLot = null;
global._fidCrediterLot_ = (...a) => fidLot(...a);

// ── Chargement de Pilotage.gs ──────────────────────────────────────────────
const code = fs.readFileSync(require('path').join(__dirname, '..', 'Pilotage.gs'), 'utf8');
const M = eval(code + `
; ({ traiter: pilotageTraiterBillets, index: pilIndexBillets_, evParMatch: pilEventParMatch_,
     I: PIL_I, NB: PIL_NB, PIL: PIL, cols: PIL_LIVE_COLS,
     brancherApi: function (f) { pilApi_ = f; },
     brancherJournal: function () { pilJournal_ = function () {}; } })`);
M.brancherJournal();

const I = M.I, NB = M.NB;
const EV_MATCH = 'ev-par', EV_ABO = M.PIL.ABONNEMENT_EVENT_ID;

// Billets Tickie du match : 3 nominatifs + 1 abonne
const billetsDe = {};
billetsDe[EV_MATCH] = [
  { _id: 'T1', barcode: 'BC1', customerId: 'C1', email: 'A@Mail.FR', firstname: 'Ana', lastname: 'Roux', ticketName: 'Plein' },
  { _id: 'T2', barcode: 'BC2', customerId: 'C2', email: '', firstname: 'Bob', lastname: 'Dupe', ticketName: 'Réduit' },
  { _id: 'T3', barcode: 'BC3', customerId: 'C3', email: 'c@mail.fr', firstname: 'Cle', lastname: 'Sud', ticketName: 'Plein' }
];
billetsDe[EV_ABO] = [{ _id: 'A1', barcode: 'ABO9', customerId: 'CA', email: 'abo@mail.fr', firstname: 'Abo', lastname: 'Nne', ticketName: 'Abonnement' }];

let evKo = {};          // evenements dont la pagination echoue
function brancher(unitaire) {
  apiCalls = [];
  M.brancherApi(function (base, path, q) {
    apiCalls.push(path + ' ' + JSON.stringify(q));
    if (path === '/events') return { rows: [{ _id: EV_MATCH, name: "Spacer's vs Paris", start: '2026-11-28T18:00:00Z', maxAmount: 3000 }] };
    if (path === '/tickets') {
      if (q.barcode) { const t = (billetsDe[EV_MATCH] || []).concat(billetsDe[EV_ABO]).filter(x => x.barcode === q.barcode); return { rows: unitaire ? t : [], total: t.length }; }
      if (evKo[q.event]) throw new Error('Tickie 500 sur /tickets');
      if (q.status !== 'VALID') return { rows: [], total: 0 };
      const l = billetsDe[q.event] || []; return { rows: l, total: l.length };
    }
    if (/^\/tickets\//.test(path)) { const id = path.split('/')[2];
      const t = (billetsDe[EV_MATCH] || []).concat(billetsDe[EV_ABO]).filter(x => x._id === id)[0];
      if (!unitaire) throw new Error('appel unitaire non autorise dans ce scenario');
      return t || null; }
    if (path === '/scans') return { rows: [], total: 0 };
    throw new Error('chemin inattendu ' + path);
  });
}

function ligne(o) {
  const r = new Array(NB).fill('');
  r[I['Horodatage']] = '2026-11-28T19:30:00Z'; r[I['ID vente']] = o.vente || 'V1';
  r[I['ID_MATCH']] = o.idm || 'PAR-28-11'; r[I['Buvette']] = o.bv || 'Buvette 1';
  r[I['Total €']] = o.total || 0; r[I['Code-barres']] = o.code || ''; r[I['ID billet']] = o.id || '';
  r[I['Fidélité']] = o.note || '';
  return r;
}
function monter(lignes) {
  feuilles = {};
  feuilles['VENTES'] = new Feuille([M.cols.slice()].concat(lignes));
  feuilles['MATCHS'] = new Feuille([['ID_MATCH', 'DATE', 'TICKIE_EVENT_ID'], ['PAR-28-11', '2026-11-28', EV_MATCH]]);
  props = {}; cache = {}; logs = []; finAppelee = []; evKo = {};
  props['PIL_SYNC'] = String(Date.now());        // pas de resynchronisation pendant le test
}
const notes = () => feuilles['VENTES'].d.slice(1).map(r => String(r[I['Fidélité']]));
const ok = [], ko = [];
const t = (n, c) => (c ? ok : ko).push(n);

// ══ 1. GROS lot : liaison par index, aucun appel unitaire ════════════════
// Au-dessus du plafond de secours, charger un index coute moins cher que d appeler
// Tickie vente par vente : c est le regime d un soir de match.
const gros = [ligne({ vente: 'V1', code: 'BC1', total: 12 }), ligne({ vente: 'V2', code: 'BC2', total: 8 }),
              ligne({ vente: 'V3', code: 'ABO9', total: 5.5 }), ligne({ vente: 'V4', id: 'T3', total: 3 })];
for (let i = 0; i < 30; i++) gros.push(ligne({ vente: 'G' + i, code: 'BC1', total: 2 }));
monter(gros);
brancher(false); fidLot = e => { fidLot.recu = e; return { commandes: e.length, ecrites: e.map(x => x.carte), echouees: [] }; };
M.traiter();
const unitaires = apiCalls.filter(c => /^\/tickets\/|barcode/.test(c)).length;
t('1. gros lot : aucun appel Tickie par vente', unitaires === 0);
t('1. gros lot : deux evenements chargés seulement', apiCalls.filter(c => c.startsWith('/tickets ')).length <= 4);
t('1. gros lot : le nombre d appels ne suit pas le nombre de ventes', apiCalls.length <= 6);
t('1. toutes les ventes sont reliées', notes().every(n => /pts$|relié$/.test(n)));
t('1. sans email : « relié » et pas de points', notes()[1] === 'relié');
t('1. avec email : points plancher du montant', notes()[0] === '12 pts' && notes()[2] === '5 pts');
t('1. un seul passage de fidélité', fidLot.recu && fidLot.recu.length === 33);

// ══ 1 bis. PETIT lot : appels unitaires, aucun index ═════════════════════
monter([ligne({ vente: 'V1', code: 'BC1', total: 12 }), ligne({ vente: 'V2', id: 'T3', total: 3 })]);
brancher(true); fidLot = e => ({ commandes: e.length, ecrites: e.map(x => x.carte), echouees: [] });
M.traiter();
t('1bis. petit lot : aucun index chargé', apiCalls.filter(c => /^\/tickets \{"event"/.test(c)).length === 0);
t('1bis. petit lot : un appel unitaire par billet distinct', apiCalls.filter(c => /^\/tickets\/|barcode/.test(c)).length === 2);
t('1bis. petit lot : les ventes sont reliées', notes().every(n => /pts$|relié$/.test(n)));
// pilotageDetailBuvette est la VRAIE fonction du fichier (pas un stub) : elle est bien
// appelee, mais echoue sur nos feuilles d essai, a l interieur de son propre try. Le
// bilan en journal prouve qu on est arrive au bout de la fonction.
t('1. les recalculs de fin ont tourné', finAppelee.includes('majMatchs') && finAppelee.includes('graphiques')
  && logs.some(l => /vente\(s\) reliée\(s\)/.test(l)));
t('1. le client Tickie est écrit', String(feuilles['VENTES'].d[1][I['Client Tickie']]) === 'C1');

// ══ 2. Tickie en panne : surtout ne PAS marquer « billet introuvable » ════
// Un marquage de ce genre est definitif : la vente ne repasserait jamais.
monter(Array.from({ length: 30 }, (_, i) => ligne({ vente: 'V' + i, code: 'BC1', total: 12 })));
brancher(false); evKo[EV_MATCH] = evKo[EV_ABO] = true; fidLot = e => ({ ecrites: e.map(x => x.carte), echouees: [] });
M.traiter();
t('2. panne Tickie : les lignes restent à retraiter, aucun statut posé', notes().every(n => n === ''));

// ══ 3. Billet absent des index : appel unitaire de secours, borné ═════════
monter(Array.from({ length: 40 }, (_, i) => ligne({ vente: 'V' + i, code: 'INCONNU' + i, total: 7 })));
brancher(true); fidLot = e => ({ ecrites: e.map(x => x.carte), echouees: [] });
M.traiter();
const sec = apiCalls.filter(c => /barcode/.test(c)).length;
t('3. le nombre d appels unitaires est plafonné à 25', sec === 25);
t('3. les 25 tranchés sont marqués introuvables', notes().filter(n => n === 'billet introuvable').length === 25);
t('3. les autres restent vierges pour le passage suivant', notes().filter(n => n === '').length === 15);

// ══ 4. Statuts déjà posés : on n y retouche pas ═══════════════════════════
monter([ligne({ vente: 'V1', code: 'BC1', total: 12, note: '12 pts' }),
        ligne({ vente: 'V2', code: 'BC2', total: 8, note: 'relié' }),
        ligne({ vente: 'V3', code: 'BC3', total: 8, note: 'remise billet 5 % : 0,30 € · 8 pts' }),
        ligne({ vente: 'V4', code: 'BC1', total: 9, note: 'billet introuvable' })]);
brancher(false); fidLot = () => { throw new Error('ne doit pas etre appele'); };
M.traiter();
t('4. aucune ligne déjà traitée n est retouchée', JSON.stringify(notes()) === JSON.stringify(['12 pts', 'relié', 'remise billet 5 % : 0,30 € · 8 pts', 'billet introuvable']));
t('4. aucun appel Tickie quand il n y a rien à relier', apiCalls.filter(c => c.startsWith('/tickets')).length === 0);

// ══ 5. Vente annulée ══════════════════════════════════════════════════════
monter([ligne({ vente: 'V1', code: 'BC1', total: 12 }),
        ligne({ vente: 'V2', code: 'BC1', total: -12, note: 'annulation de V1' })]);
brancher(false); fidLot = e => ({ ecrites: e.map(x => x.carte), echouees: [] });
M.traiter();
t('5. la vente annulée est marquée, pas créditée', notes()[0] === 'vente annulée');

// ══ 6. Échec du crédit : les mentions « pts » sont retirées ═══════════════
monter([ligne({ vente: 'V1', code: 'BC1', total: 12 }), ligne({ vente: 'V2', code: 'BC3', total: 4 })]);
brancher(true); fidLot = () => { throw new Error('feuille fidélité verrouillée'); };
M.traiter();
t('6. crédit impossible : aucune ligne ne prétend avoir des points', notes().every(n => !/pts/.test(n)));
t('6. crédit impossible : les lignes restent à retraiter', notes().every(n => n === ''));
t('6. l échec est écrit dans le journal d exécution', logs.some(l => /crédit du lot impossible/.test(l)) && logs.some(l => /laissée\(s\) à retraiter/.test(l)));

// ══ 7. Échec PARTIEL du crédit : seules les cartes non écrites repassent ═
monter([ligne({ vente: 'V1', code: 'BC1', total: 12 }), ligne({ vente: 'V2', code: 'BC3', total: 4 })]);
brancher(true); fidLot = e => ({ commandes: e.length, ecrites: [e[0].carte], echouees: [e[1].carte] });
M.traiter();
t('7. échec partiel : la carte écrite garde ses points', /12 pts$/.test(notes()[0]));
t('7. échec partiel : la carte non écrite repasse au prochain tour', notes()[1] === '');
t('7. échec partiel : journalisé', logs.some(l => /laissée\(s\) à retraiter/.test(l)));

// ══ 8. L'ancien Fidelite.gs seul (pas de lot) : repli ligne par ligne ════
monter([ligne({ vente: 'V1', code: 'BC1', total: 12 })]);
brancher(true);
const sauve = global._fidCrediterLot_; delete global._fidCrediterLot_;
let unAppele = 0; global._fidCreditOne_ = () => { unAppele++; };
M.traiter();
global._fidCrediterLot_ = sauve; delete global._fidCreditOne_;
t('8. sans _fidCrediterLot_ : repli sur _fidCreditOne_, points crédités quand même', unAppele === 1 && /12 pts$/.test(notes()[0]));

console.log('Scénario 1 : ' + apiCalls.length + ' appels Tickie au total pour 4 ventes\n');
ok.forEach(n => console.log('  OK   ' + n));
ko.forEach(n => console.log('  ECHEC ' + n));
console.log('\n' + ok.length + ' reussis, ' + ko.length + ' echoues');
process.exit(ko.length ? 1 : 0);
