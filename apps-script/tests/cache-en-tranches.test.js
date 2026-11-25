const fs = require('fs');
let store = {}, refus = 0, appelsFn = 0, logs = [];
const LIMITE = 100000;
global.Logger = { log: m => logs.push(String(m)) };
global.CacheService = { getScriptCache: () => ({
  get: k => (k in store ? store[k] : null),
  getAll: ks => { const o = {}; ks.forEach(k => { if (k in store) o[k] = store[k]; }); return o; },
  putAll: (vals) => { Object.keys(vals).forEach(k => {
    if (Buffer.byteLength(vals[k], 'utf8') > LIMITE) { refus++; return; }
    store[k] = vals[k];
  }); },
  put: (k, v) => { store[k] = v; }, remove: k => { delete store[k]; }
}) };
// On extrait les deux fonctions du fichier de PRODUCTION : le test suit donc
// automatiquement le code livré, sans copie à maintenir.
const src = fs.readFileSync(require('path').join(__dirname, '..', 'Pilotage.gs'), 'utf8').replace(/\r\n/g, '\n');
const bout = (nom) => { const d = src.indexOf('function ' + nom); const f = src.indexOf('\n}\n', d) + 3; return src.slice(d, f); };
eval(bout('pilCacheGros_') + bout('pilCacheGrosPresent_'));

const ok = [], ko = [];
const t = (n, c) => (c ? ok : ko).push(n);

// 2200 billets, noms accentues + un emoji (paire de substituts) + un nom en japonais
const billets = [];
for (let i = 0; i < 2200; i++) billets.push(['BC' + i, 'id' + i, 'Tarif plein', 'Prénom Ééèà Nom-Composé ' + i, i % 7 ? '' : 'ABO']);
billets.push(['BCEMO', 'idemo', 'Plein', 'Zoé 🎉🏐 Martin', '']);
billets.push(['BCJP', 'idjp', 'Plein', '山田 太郎', 'ABO']);
const taille = Buffer.byteLength(JSON.stringify(billets), 'utf8');
const lire = (f) => pilCacheGros_('pil_liste_billets_X', 600, () => { appelsFn++; return billets; }, f);

let v1 = lire();
t('1. valeur exacte au premier appel', JSON.stringify(v1) === JSON.stringify(billets));
t('1. aucune tranche refusee par le plafond de 100 Ko', refus === 0);
const cles = Object.keys(store).filter(k => /_\d+$/.test(k));
t('1. valeur decoupee en plusieurs tranches', cles.length > 1);
t('1. manifeste present', !!store['pil_liste_billets_X_m']);
t('1. pilCacheGrosPresent_ voit la valeur', pilCacheGrosPresent_('pil_liste_billets_X') === true);

appelsFn = 0;
let v2 = lire();
t('2. servi par le cache, sans recalcul', appelsFn === 0 && JSON.stringify(v2) === JSON.stringify(billets));
t('2. emoji et japonais restitues a l identique',
  v2[2200][3] === 'Zoé 🎉🏐 Martin' && v2[2201][3] === '山田 太郎');

// forcer : recalcule meme si le cache est chaud
appelsFn = 0; lire(true);
t('3. forcer recalcule malgre le cache chaud', appelsFn === 1);

// tranche manquante — on cible la generation COURANTE, les anciennes tranches
// restent en cache jusqu a expiration et ne doivent justement plus servir
const gen = () => JSON.parse(store['pil_liste_billets_X_m']).g;
appelsFn = 0;
delete store['pil_liste_billets_X_' + gen() + '_1'];
let v3 = lire();
t('4. tranche manquante : valeur exacte et recalcul', appelsFn === 1 && JSON.stringify(v3) === JSON.stringify(billets));

// manifeste corrompu
store['pil_liste_billets_X_m'] = 'nawak';
appelsFn = 0;
t('5. manifeste corrompu : recalcul et valeur exacte',
  JSON.stringify(lire()) === JSON.stringify(billets) && appelsFn === 1);

// longueur qui ne tombe pas juste : une tranche tronquee
lire(true);
const k0 = 'pil_liste_billets_X_' + gen() + '_0';
store[k0] = store[k0].slice(0, -50);
appelsFn = 0;
t('6. longueur incoherente : detectee, recalcul', JSON.stringify(lire()) === JSON.stringify(billets) && appelsFn === 1);

// DEUX ecrivains concurrents, meme nombre de tranches : le melange doit etre impossible
store = {};
const listeA = billets.map(r => r.slice());
const listeB = billets.map(r => r.slice()); listeB[5][3] = 'AUTRE GENERATION';
pilCacheGros_('pil_conc', 600, () => listeA);
const manA = store['pil_conc_m'];
const clesA = Object.keys(store).filter(k => /^pil_conc_\d/.test(k));
pilCacheGros_('pil_conc', 600, () => listeB, true);     // seconde generation
// on remet le manifeste de A : ses tranches existent toujours
store['pil_conc_m'] = manA;
const vA = pilCacheGros_('pil_conc', 600, () => { throw new Error('ne doit pas recalculer'); });
t('7. generations isolees : on relit bien A, pas un melange', JSON.stringify(vA) === JSON.stringify(listeA));
// et si on supprime une tranche de A, on recalcule au lieu de panacher avec B
delete store[clesA[1]];
appelsFn = 0;
const vC = pilCacheGros_('pil_conc', 600, () => { appelsFn++; return listeB; });
t('7. tranche de A manquante : recalcul, jamais de panachage', appelsFn === 1 && JSON.stringify(vC) === JSON.stringify(listeB));

// liste vide
store = {}; appelsFn = 0;
t('8. liste vide : renvoyee et mise en cache', JSON.stringify(pilCacheGros_('pil_vide', 600, () => { appelsFn++; return []; })) === '[]');
t('8. liste vide : relue sans recalcul', JSON.stringify(pilCacheGros_('pil_vide', 600, () => { appelsFn++; return []; })) === '[]' && appelsFn === 1);

// valeur enorme : non mise en cache, mais renvoyee, et c est journalise
store = {}; logs = [];
const enorme = new Array(600000).fill('xxxxxxxxxxxxxxxxxxxx');
const e1 = pilCacheGros_('pil_enorme', 600, () => enorme);
t('9. valeur enorme : renvoyee intacte', e1.length === 600000);
t('9. valeur enorme : aucune tranche orpheline', Object.keys(store).length === 0);
t('9. valeur enorme : journalisee', logs.some(l => /non mis en cache/.test(l)));

// cache en panne a l ecriture
store = {}; logs = [];
const vrai = CacheService.getScriptCache;
global.CacheService.getScriptCache = () => ({ get: () => null, getAll: () => ({}), putAll: () => { throw new Error('cache plein'); }, put: () => {}, remove: () => {} });
const e2 = pilCacheGros_('pil_ko', 600, () => billets);
global.CacheService.getScriptCache = vrai;
t('10. echec d ecriture : valeur renvoyee quand meme', JSON.stringify(e2) === JSON.stringify(billets));
t('10. echec d ecriture : journalise', logs.some(l => /échec de mise en cache/.test(l)));
t('10. pilCacheGrosPresent_ renvoie faux sur une cle absente', pilCacheGrosPresent_('pil_inexistant') === false);

console.log(billets.length + ' billets, ' + Math.round(taille / 1024) + ' Ko JSON, ' + cles.length + ' tranches\n');
ok.forEach(n => console.log('  OK   ' + n));
ko.forEach(n => console.log('  ECHEC ' + n));
console.log('\n' + ok.length + ' reussis, ' + ko.length + ' echoues');
process.exit(ko.length ? 1 : 0);
