const fs = require('fs');

// ── Fausse feuille Google Sheets, qui compte les allers-retours ─────────────
let appels = 0;
class Feuille {
  constructor(nom) { this.nom = nom; this.d = []; }
  appendRow(r) { appels++; this.d.push(r.slice()); }
  getLastRow() { return this.d.length; }
  getDataRange() { return this.getRange(1, 1, Math.max(this.d.length, 1), 9); }
  getRange(l, c, nl = 1, nc = 1) {
    const sh = this;
    return {
      getValues() {
        appels++;
        const out = [];
        for (let i = 0; i < nl; i++) { const r = sh.d[l - 1 + i] || []; out.push(Array.from({ length: nc }, (_, j) => r[c - 1 + j] ?? '')); }
        return out;
      },
      setValues(v) {
        appels++;
        v.forEach((row, i) => {
          const li = l - 1 + i;
          while (sh.d.length <= li) sh.d.push([]);
          row.forEach((x, j) => { sh.d[li][c - 1 + j] = x; });
        });
        return this;
      },
      setValue(x) { appels++; const li = l - 1; while (sh.d.length <= li) sh.d.push([]); sh.d[li][c - 1] = x; return this; },
      setBackground() { return this; }, setFontColor() { return this; }, setFontWeight() { return this; }
    };
  }
  setFrozenRows() {}
}
let feuilles = {};
global.SpreadsheetApp = { getActive: () => ({ insertSheet: n => (feuilles[n] = new Feuille(n)) }) };
global.feuille_ = n => feuilles[n === 'FIDELITE' ? '⭐ FIDÉLITÉ' : '⚙️ journal fidélité'] || null;
global.NAVY = '#001'; global.YELLOW = '#ff0';
let verrouDispo = true;
global.LockService = {
  getScriptLock: () => ({ tryLock: () => { throw new Error('le lot ne doit PAS prendre le verrou de script'); }, releaseLock: () => {} }),
  getDocumentLock: () => ({ tryLock: () => verrouDispo, releaseLock: () => {} }) };
global.CacheService = { getScriptCache: () => ({ get: () => { throw new Error('le lot ne doit plus utiliser le cache'); }, put: () => {}, remove: () => {} }) };
global.Utilities = { formatDate: () => '2026-11-28' };
global.Session = { getScriptTimeZone: () => 'Europe/Paris' };

// Fidelite.gs n'est PAS dans le depot (depot public, fichier volontairement exclu par
// .gitignore, comme Code.gs). On le cherche la ou il est pose pour le collage ; absent,
// le test le dit et sort sans echouer, plutot que de faire croire a une verification.
const path = require('path');
const candidats = [process.env.FIDELITE_GS, path.join(__dirname, '..', '..', '..', 'a_coller', 'Fidelite.gs'),
                   path.join(__dirname, '..', '..', '..', 'Fidelite.gs')].filter(Boolean);
const src = candidats.filter(f => fs.existsSync(f))[0];
if (!src) {
  console.log('Fidelite.gs introuvable : test non joue.');
  console.log('Indique son chemin : FIDELITE_GS=/chemin/vers/Fidelite.gs node ' + path.basename(__filename));
  process.exit(0);
}
console.log('Fidelite.gs lu dans ' + src + '\n');
eval(fs.readFileSync(src, 'utf8').replace(/^const FID_/gm, 'var FID_'));

// ── Jeu d'essai : 240 commandes, 90 abonnes, dont des habitues deja presents ──
const abonnes = Array.from({ length: 90 }, (_, i) => 'abo' + i + '@mail.fr');
const commandes = [];
let graine = 7;
const rnd = () => (graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = 0; i < 240; i++) {
  const c = abonnes[Math.floor(rnd() * abonnes.length)];
  commandes.push({ carte: c, nom: 'Nom ' + c.slice(3, 5), montant: Math.round(rnd() * 3000) / 100,
    recompenseUtilisee: rnd() < 0.05 });
}
// 3 commandes a 0 € et une sans carte : doivent etre ignorees identiquement
commandes.push({ carte: abonnes[0], nom: 'X', montant: 0 });
commandes.push({ carte: abonnes[1], nom: 'X', montant: 0.4 });
commandes.push({ carte: '', nom: 'X', montant: 12 });
commandes.push({ carte: '  ABO3@MAIL.FR  ', nom: 'Casse', montant: 9.5 });   // casse + espaces

const etatInitial = () => {
  feuilles = {};
  const f = new Feuille('⭐ FIDÉLITÉ'); feuilles['⭐ FIDÉLITÉ'] = f;
  f.d.push(['CARTE', 'NOM', 'POINTS', 'POINTS_TOTAL', 'VISITES', 'DEPENSE_EUR', 'NIVEAU', 'DERNIER_MATCH', 'MAJ']);
  for (let i = 0; i < 40; i++) f.d.push([abonnes[i], i % 3 ? 'Ancien ' + i : '', 50 + i, 150 + i, 3, 120.5, 'Bronze', 'TOU-21-11', new Date(0)]);
  const g = new Feuille('⚙️ journal fidélité'); feuilles['⚙️ journal fidélité'] = g;
  g.d.push(['DATE', 'MATCH', 'TABLETTE', 'CARTE', 'NOM', 'CA_EUR', 'POINTS', 'RECOMPENSE_UTILISEE']);
};
const fige = () => ({
  fid: feuilles['⭐ FIDÉLITÉ'].d.map(r => r.slice(0, 9).map(x => x instanceof Date ? 'DATE' : x)),
  log: feuilles['⚙️ journal fidélité'].d.map(r => r.slice(0, 8))
});

etatInitial(); appels = 0;
commandes.forEach(c => _fidCreditOne_(c, 'PAR-28-11', 'Buvette 1', '2026-11-28'));
const refUn = fige(), appelsUn = appels;

etatInitial(); appels = 0;
const bilan = _fidCrediterLot_(commandes, 'PAR-28-11', 'Buvette 1', '2026-11-28');
const refLot = fige(), appelsLot = appels;

const ok = [], ko = [];
const t = (n, c) => (c ? ok : ko).push(n);
t('feuille ⭐ FIDÉLITÉ identique a la boucle', JSON.stringify(refUn.fid) === JSON.stringify(refLot.fid));
t('journal identique a la boucle (memes lignes, meme ordre)', JSON.stringify(refUn.log) === JSON.stringify(refLot.log));
t('bilan renvoye coherent', bilan.commandes === refLot.log.length - 1 && bilan.abonnes + bilan.nouveaux > 0);
t('moins de 10 % des allers-retours de la boucle', appelsLot < appelsUn / 10);

// repli sans verrou : doit donner exactement le meme resultat
etatInitial(); verrouDispo = false; appels = 0;
_fidCrediterLot_(commandes, 'PAR-28-11', 'Buvette 1', '2026-11-28');
t('verrou de document indisponible (repli appendRow) : resultat identique', JSON.stringify(fige().fid) === JSON.stringify(refUn.fid)
  && JSON.stringify(fige().log) === JSON.stringify(refUn.log));
verrouDispo = true;

// lot vide et lot sans carte valable
etatInitial();
const v1 = _fidCrediterLot_([], 'M', 'B', 'd'), v2 = _fidCrediterLot_([{ carte: '', montant: 5 }], 'M', 'B', 'd');
t('lot vide : rien ecrit, pas de plantage', v1.commandes === 0 && v2.commandes === 0 && feuilles['⚙️ journal fidélité'].d.length === 1);

// un seul abonne, plusieurs commandes : une seule visite par commande, comme la boucle
etatInitial();
_fidCreditOne_({ carte: 'x@y.fr', nom: 'X', montant: 10 }, 'M', 'B', 'd');
_fidCreditOne_({ carte: 'x@y.fr', nom: 'X', montant: 20 }, 'M', 'B', 'd');
const a = fige().fid; etatInitial();
_fidCrediterLot_([{ carte: 'x@y.fr', nom: 'X', montant: 10 }, { carte: 'x@y.fr', nom: 'X', montant: 20 }], 'M', 'B', 'd');
t('nouvel abonne avec 2 commandes : identique a la boucle', JSON.stringify(a) === JSON.stringify(fige().fid));

// ── Liste des cartes ecrites, et echec partiel ────────────────────────────
etatInitial();
const bl = _fidCrediterLot_(commandes, 'PAR-28-11', 'Buvette 1', '2026-11-28');
t('les cartes ecrites sont listees', Array.isArray(bl.ecrites) && bl.ecrites.length === refLot.fid.length - 1 - 40 + 37
  || (Array.isArray(bl.ecrites) && bl.ecrites.length > 0 && bl.echouees.length === 0));
t('aucune carte en echec dans le cas normal', bl.echouees.length === 0);

// on casse l ecriture d une ligne sur trois : le lot doit continuer et rendre les deux listes
etatInitial();
const vraiGet = Feuille.prototype.getRange;
let nEcr = 0;
Feuille.prototype.getRange = function (l, c, nl, nc) {
  const r = vraiGet.call(this, l, c, nl, nc);
  if (this.nom === '\u2b50 FID\u00c9LIT\u00c9' && nl === 1 && nc === 9) {
    const sv = r.setValues;
    r.setValues = v => { if (++nEcr % 3 === 0) throw new Error('ecriture refusee'); return sv.call(r, v); };
  }
  return r;
};
const bp = _fidCrediterLot_(commandes, 'PAR-28-11', 'Buvette 1', '2026-11-28');
Feuille.prototype.getRange = vraiGet;
t('echec partiel : le lot continue au lieu de tout abandonner', bp.ecrites.length > 0 && bp.echouees.length > 0);
t('echec partiel : aucune carte dans les deux listes a la fois', !bp.ecrites.some(c => bp.echouees.includes(c)));
t('echec partiel : toutes les cartes sont dans l une ou l autre',
  new Set(bp.ecrites.concat(bp.echouees)).size === new Set(commandes.filter(c => String(c.carte).trim() && Math.floor((Number(c.montant)||0)) > 0).map(c => String(c.carte).trim().toLowerCase())).size);

console.log('Boucle : ' + appelsUn + ' allers-retours de feuille · Lot : ' + appelsLot
  + ' (division par ' + Math.round(appelsUn / appelsLot) + ')');
console.log('Lot : ' + bilan.commandes + ' commandes, ' + bilan.abonnes + ' abonnes mis a jour, ' + bilan.nouveaux + ' nouveaux\n');
ok.forEach(n => console.log('  OK   ' + n));
ko.forEach(n => console.log('  ECHEC ' + n));
console.log('\n' + ok.length + ' reussis, ' + ko.length + ' echoues');
process.exit(ko.length ? 1 : 0);
