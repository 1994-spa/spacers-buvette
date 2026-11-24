// ═══════════════════════════════════════════════════════════════════════════
// COÛTS — valorisation du stock au prix moyen pondéré (CUMP), calculé sur les factures
// ═══════════════════════════════════════════════════════════════════════════
// Arbitrage du 23/11/2026 (Clément) : « la marge est calculée par rapport aux factures ».
//
// AVANT : le coût matière d'un match valorisait les quantités consommées au PRIX ACHAT €
// de 📦 PRODUITS — un seul prix, le dernier saisi, appliqué à toute l'histoire. Corriger le
// prix du fût (114,81 € → 85,34 €) changeait donc la marge de quatre matchs déjà joués.
//
// MAINTENANT : prix moyen pondéré par référence de stock, recalculé à chaque entrée.
//   PMP = (valeur du stock avant + montant HT de la facture) / (quantité avant + quantité livrée)
// Un match est valorisé aux quantités réellement consommées × PMP en vigueur à sa date.
// Les fûts de deux livraisons se mélangent physiquement dans la réserve : c'est la méthode
// adaptée, et celle qu'attend l'expert-comptable (BGH).
//
// SOURCES
//   • 🛒 ACHATS      montants HT par facture (compte 607100000 ; les écocups 606300000 restent
//                    hors coût matière, et une ligne marquée « hors total » est ignorée) ;
//   • QUANTITÉ       colonne facultative de 🛒 ACHATS, saisie à la main quand la jointure échoue
//                    (« FUT 15 », « P02_ICET 240 ; P03 840 », ou un nombre seul si la livraison
//                    rattachée ne porte qu'une seule référence) ;
//   • livraisons     propriété PIL_RESERVE, clé « livraisons » (date, pièce, fournisseur, qte) ;
//   • jointure       sur la pièce normalisée (achatsClesPiece_) : la livraison du 02/11 porte
//                    « BL 117305 / Fact. 00-2026110015 » et la facture porte « 00-2026110015 ».
//   • STOCK_DEBUT    valeur HT du stock au comptage de base (PIL_RESERVE.base) : point de départ du PMP.
//
// REPLIS, TOUJOURS SIGNALÉS (jamais de coût silencieusement faux)
//   • référence sans aucune facture rattachable → PRIX ACHAT de 📦 PRODUITS (comportement d'avant),
//     signalé dans la colonne INVENTAIRE de 📅 MATCHS ;
//   • facture sans quantité (jointure impossible et QUANTITÉ vide) → elle ne change pas le PMP ;
//   • livraison sans facture → elle entre au PMP en vigueur (neutre), donc les quantités restent
//     justes et le PMP n'est pas dilué ;
//   • consommation supérieure au stock reconstitué → le dernier PMP connu est conservé.
// Menu 🏐 Matchday → « 💶 Contrôler la valorisation (CUMP) » affiche tout le détail.
// ═══════════════════════════════════════════════════════════════════════════
const CUMP = {
  COMPTE: '607100000',        // Achat buvette : seules ces factures valorisent les boissons
  ECOCUPS: '606300000',       // parc réutilisable : jamais dans le coût matière
  HORS_TOTAL: 'hors total',   // marquage du rapprochement Drive ↔ Pennylane (Achats.gs)
  JOURS_SANS_PIECE: 7,        // jointure par la date, seulement pour une livraison sans n° de pièce
};

// ── Lecture de 🛒 ACHATS ───────────────────────────────────────────────────
// Garde les factures de boissons (607100000) hors doublons marqués. Un montant ≤ 0 (avoir)
// est gardé : il corrige la valeur du stock sans ajouter de quantité.
function cumpFactures_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONG.ACHATS);
  if (!sh) return [];
  const h = entete_(sh), d = donnees_(sh), i = function (n) { return h.indexOf(n); };
  const iD = i('DATE'), iL = i('LIBELLÉ'), iC = i('COMPTE'), iM = i('MONTANT HT €'),
    iP = i('PIÈCE'), iK = i('CONTRÔLE'), iQ = i('QUANTITÉ');
  const out = [];
  d.forEach(function (r, k) {
    const compte = String(r[iC] == null ? '' : r[iC]).trim().replace(/\.0+$/, '');
    if (compte && compte !== CUMP.COMPTE) return;                       // écocups et autres comptes
    const ctrl = String(r[iK] == null ? '' : r[iK]).trim();
    const garde = new RegExp('^' + ACHATS_RAP.GARDER, 'i').test(ctrl);
    if (!garde && new RegExp(CUMP.HORS_TOTAL, 'i').test(ctrl)) return;  // doublon Pennylane
    const date = cumpJour_(r[iD]);
    const montant = Math.round((Number(r[iM]) || 0) * 100) / 100;
    if (!date || !montant) return;
    const piece = String(r[iP] == null ? '' : r[iP]), lib = String(r[iL] == null ? '' : r[iL]);
    out.push({ ligne: k + 2, date: date, montant: montant, piece: piece, libelle: lib,
      cles: achatsClesPiece_(piece + ' ' + lib),
      saisie: iQ >= 0 ? cumpParserQte_(r[iQ]) : null });
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.ligne - b.ligne; });
  return out;
}
function cumpJour_(v) { try { return jour_(v) || ''; } catch (e) { return ''; } }
function cumpArr_(x) { return Math.round(x * 100) / 100; }

// Colonne QUANTITÉ : « FUT 15 », « P02_ICET 240 ; P03 840 », « 15 » (référence déduite de la livraison).
// Aucune quantité n'est devinée depuis le libellé de la facture.
function cumpParserQte_(v) {
  if (v === '' || v === null || v === undefined) return null;
  const t = String(v).replace(/,/g, '.').toUpperCase();
  const out = {}; let n = 0, m;
  const re = /\b([A-Z][A-Z0-9_]{1,19})\s*[:=x×]?\s*(-?\d+(?:\.\d+)?)/g;
  while ((m = re.exec(t)) !== null) { out[m[1]] = (out[m[1]] || 0) + Number(m[2]); n++; }
  if (n) return out;
  const seul = Number(t.trim());
  return isNaN(seul) || !seul ? null : { '*': seul };   // « * » : référence prise sur la livraison
}

// ── Livraisons enregistrées (PIL_RESERVE) ─────────────────────────────────
function cumpLivraisons_() {
  return pilReserve_().livraisons.map(function (l, k) {
    const piece = String(l.piece || '');
    return { rang: k, id: String(l.id || ''), date: String(l.date || '').slice(0, 10), piece: piece,
      fournisseur: String(l.fournisseur || ''), qte: l.qte || {}, cles: achatsClesPiece_(piece) };
  }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.rang - b.rang; });
}

// Jointure facture ↔ livraison sur la pièce normalisée. Une livraison ne sert qu'une fois.
function cumpJoindre_(factures, livraisons) {
  const parCle = {};
  livraisons.forEach(function (l) { l.cles.forEach(function (c) { (parCle[c] = parCle[c] || []).push(l); }); });
  factures.forEach(function (f) {
    let liv = null;
    f.cles.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (c) {
      if (liv) return;
      (parCle[c] || []).forEach(function (cand) { if (!liv && !cand.facture) liv = cand; });
    });
    // Livraison saisie sans n° de pièce : rattachement par la date, et seulement si elle est unique
    if (!liv) {
      const proches = livraisons.filter(function (l) {
        return !l.facture && !l.piece && cumpEcartJours_(l.date, f.date) <= CUMP.JOURS_SANS_PIECE;
      });
      if (proches.length === 1) liv = proches[0];
    }
    if (liv) { liv.facture = f; f.livraison = liv; }
  });
}
function cumpEcartJours_(a, b) {
  if (!a || !b) return 9999;
  return Math.abs(Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000));
}

// Quantités d'une facture : colonne QUANTITÉ d'abord, puis la livraison rattachée.
// HORS : mot-clé de la colonne QUANTITÉ de 🛒 ACHATS réservé au MONTANT HT, en euros, de ce qui
// n'est pas du stock buvette sur cette facture.
//
// Exemple réel, facture Crouzil du 19/11 (1 592,40 € HT) :
//     bière                1 125,00
//     accise 0,34 €/L        152,10   →  part fûts 1 277,10  →  85,14 € le fût
//     gaz CO2 3 × 10 kg      312,31
//     frais de gestion         2,99   →  HORS        315,30
//                          ---------
//     base taxable         1 592,40
//   soit, dans la colonne QUANTITÉ :  FUT 15 ; HORS 315,30
//
// Recoupement : 85,14 € le fût ici, contre 85,34 € sur la facture mono-référence du 02/11 qui ne
// portait que de la bière. Deux factures indépendantes à dix-sept jours d'écart, vingt centimes
// d'écart : un fût de 30 L revient à 85-90 € HT. Un prix reconstitué hors de cette fourchette
// signale un montant HORS mal saisi (180,60 € déclaré → 94,12 € le fût ; rien déclaré → 106,16 €).
//
// Sans ce mot-clé, une référence inconnue était écartée en silence et tout le montant retombait
// sur les références restantes, gonflant leur prix unitaire.
var CUMP_HORS = 'HORS';
function cumpQtesFacture_(f, refs) {
  const inconnues = {};
  const propre = function (o) {
    const q = {}; let n = 0;
    Object.keys(o || {}).forEach(function (ref) {
      if (ref === CUMP_HORS || ref === 'HORS_STOCK') return;
      if (refs.indexOf(ref) < 0) {
        const x = Number(o[ref]) || 0;
        if (x) inconnues[ref] = (inconnues[ref] || 0) + x;   // gardée pour pouvoir le DIRE
        return;
      }
      const x = Number(o[ref]) || 0; if (x) { q[ref] = (q[ref] || 0) + x; n++; }
    });
    return n ? q : null;
  };
  const s = f.saisie;
  const horsMontant = s ? (Number(s[CUMP_HORS]) || Number(s['HORS_STOCK']) || 0) : 0;
  if (s && s['*'] != null) {   // nombre seul : valable si la livraison rattachée ne porte qu'une référence
    const lq = f.livraison ? propre(f.livraison.qte) : null;
    const seuls = lq ? Object.keys(lq) : [];
    if (seuls.length === 1) { const q = {}; q[seuls[0]] = Number(s['*']); return { qte: q, source: 'QUANTITÉ (réf. de la livraison)', hors: inconnues, horsMontant: horsMontant }; }
    return { qte: null, source: '', ambigu: true, hors: inconnues, horsMontant: horsMontant };
  }
  const saisi = propre(s);
  if (saisi) return { qte: saisi, source: 'QUANTITÉ', hors: inconnues, horsMontant: horsMontant };
  const liv = f.livraison ? propre(f.livraison.qte) : null;
  if (liv) return { qte: liv, source: 'livraison ' + (f.livraison.piece || f.livraison.date), hors: inconnues, horsMontant: horsMontant };
  return { qte: null, source: '', hors: inconnues, horsMontant: horsMontant };
}

// Répartition du montant HT d'une facture entre ses références, au prorata de la valeur
// catalogue (quantité × PRIX ACHAT de 📦 PRODUITS). Facture mono-référence : prix exact.
function cumpRepartir_(montant, qte, cat) {
  const refs = Object.keys(qte), out = {};
  if (refs.length === 1) { out[refs[0]] = montant; return { valeur: out, prorata: false }; }
  let tot = 0; const poids = {};
  refs.forEach(function (ref) {
    const u = cumpPrixCatalogue_(cat, ref);
    poids[ref] = Math.abs(Number(qte[ref]) || 0) * (u == null ? 0 : u);
    tot += poids[ref];
  });
  if (!tot) {   // aucun prix catalogue : au prorata des quantités, faute de mieux
    refs.forEach(function (ref) { poids[ref] = Math.abs(Number(qte[ref]) || 0); tot += poids[ref]; });
  }
  if (!tot) { refs.forEach(function (ref) { out[ref] = 0; }); return { valeur: out, prorata: true }; }
  let reste = montant;
  refs.forEach(function (ref, k) {
    const v = k === refs.length - 1 ? cumpArr_(reste) : cumpArr_(montant * poids[ref] / tot);
    out[ref] = v; reste = cumpArr_(reste - v);
  });
  return { valeur: out, prorata: true };
}
// PRIX ACHAT de 📦 PRODUITS, par unité de stock (cat.cout.FUT est un prix au litre)
function cumpPrixCatalogue_(cat, ref) {
  if (ref === 'FUT') return cat.cout.FUT == null ? null : cat.cout.FUT * (PIL.FUT_LITRES || 30);
  return cat.cout[ref] == null ? null : cat.cout[ref];
}

// ═══════════════════════════════════════════════════════════════════════════
// Grand livre : entrées (factures, livraisons) et sorties (consommation des matchs)
// ═══════════════════════════════════════════════════════════════════════════
// matchs : [{ id, date, vendu, benev }] — les matchs valorisables, dans n'importe quel ordre.
// Renvoie { pour(date|idMatch) → fonction prix(ref, qte), final, repli, alertes, lignes, resume }.
function cumpConstruire_(matchs, cat) {
  cat = cat || catalogueCouts_();
  const refs = pilRefsPrepa_();
  const factures = cumpFactures_(), livraisons = cumpLivraisons_();
  cumpJoindre_(factures, livraisons);
  const alertes = [], detail = [];

  // ── 1. Entrées valorisées par les factures ───────────────────────────────
  const entrees = [];                      // { date, qte:{}, valeur:{}, libelle, auPmp }
  const premierPrix = {};                  // ref → prix unitaire de la 1re facture connue
  // Garde-fou : le montant HORS est tapé à la main, de nuit, après un match. Un prix unitaire
  // reconstitué très loin du dernier prix connu pour la même référence est presque toujours une
  // erreur de saisie — c'est ce qui sépare 85,14 € le fût (gaz et frais correctement déduits) de
  // 94,12 € (hors-stock sous-évalué) ou 106,16 € (hors-stock non déduit). Les factures sont
  // parcourues par date, donc dernierPu porte bien le prix précédent de la saison.
  const dernierPu = {};                    // ref → dernier prix unitaire reconstitué
  // Seuil à 10 % et non 20 % : à 20 %, l'erreur réellement commise sur la facture du 19/11
  // (HORS sous-évalué à 180,60 € → 94,12 € le fût, soit +10,3 % et 134,70 € de trop sur 15 fûts)
  // passait sans un mot. Les prix d'achat de la buvette bougent de quelques dixièmes de pour cent
  // d'une facture à l'autre (85,34 € le 02/11, 85,14 € le 19/11), donc 10 % reste très au-dessus
  // du bruit réel ; et une hausse fournisseur supérieure à 10 % mérite de toute façon un regard.
  // C'est une alerte, jamais un blocage.
  const CUMP_ECART_MAX = 0.10;
  factures.forEach(function (f) {
    const q = cumpQtesFacture_(f, refs);
    if (!q.qte) {
      if (f.montant > 0) alertes.push('Facture sans quantité : ' + f.date + ' · ' + (f.piece || f.libelle).slice(0, 60) +
        ' · ' + cumpEuro_(f.montant) + (q.ambigu ? ' (QUANTITÉ = un nombre seul, mais la livraison porte plusieurs références)'
        : ' — aucune livraison rattachable, remplir la colonne QUANTITÉ de 🛒 ACHATS'));
      entrees.push({ date: f.date, qte: {}, valeur: {}, libelle: (f.piece || f.libelle).slice(0, 40), montantSeul: f.montant });
      return;
    }
    // Facture mixte : des articles hors stock figurent sur la facture. Leur montant doit être
    // retiré avant toute répartition, sinon il gonfle le prix unitaire des références suivies.
    const horsRefs = Object.keys(q.hors || {});
    let montant = f.montant;
    if (q.horsMontant > 0) {
      montant = cumpArr_(f.montant - q.horsMontant);
      alertes.push('Facture mixte : ' + f.date + ' · ' + (f.piece || f.libelle).slice(0, 60) +
        ' · ' + cumpEuro_(q.horsMontant) + ' déclaré hors stock (HORS) et retiré avant répartition' +
        (horsRefs.length ? ' — articles hors stock : ' + horsRefs.join(', ') : '') +
        '. Reste réparti : ' + cumpEuro_(montant) + '.');
    } else if (horsRefs.length) {
      // On REFUSE de valoriser : attribuer tout le montant aux références suivies fausserait leur
      // prix (facture Crouzil du 19/11 : 15 fûts + 3 CO2, 1 592,40 € → 106,16 € le fût au lieu de
      // 85-90 €). La facture passe en montant non affecté, et on dit exactement quoi faire.
      alertes.push('⚠️ Facture NON valorisée (articles hors stock) : ' + f.date + ' · ' +
        (f.piece || f.libelle).slice(0, 60) + ' · ' + cumpEuro_(f.montant) +
        ' — elle porte ' + horsRefs.join(', ') + ', inconnu(s) de 📦 PRODUITS. Deux solutions : ' +
        'ajouter « ; HORS <montant HT des articles hors stock> » dans la colonne QUANTITÉ de 🛒 ACHATS, ' +
        'ou scinder la facture en deux lignes. Tant que ce n\'est pas fait, elle n\'entre pas dans le PMP. ' +
        'Repère pour vérifier le montant déclaré : un fût de 30 L revient à 85-90 € HT ' +
        '(85,34 € sur la facture du 02/11 sans gaz, 85,14 € sur celle du 19/11 gaz et frais déduits). ' +
        'Si le fût sort loin de cette fourchette, le montant HORS est faux.');
      entrees.push({ date: f.date, qte: {}, valeur: {}, libelle: (f.piece || f.libelle).slice(0, 40), montantSeul: f.montant });
      return;
    }
    const rep = cumpRepartir_(montant, q.qte, cat);
    Object.keys(q.qte).forEach(function (ref) {
      const qt = Number(q.qte[ref]) || 0;
      if (qt <= 0) return;
      const pu = rep.valeur[ref] / qt;
      // Référence de comparaison : le dernier prix reconstitué pour cette référence, à défaut le
      // PRIX ACHAT de 📦 PRODUITS. Les deux sont « le dernier prix connu » au sens de l'utilisateur.
      const connu = dernierPu[ref] != null ? dernierPu[ref] : cumpPrixCatalogue_(cat, ref);
      const origine = dernierPu[ref] != null ? 'dernier prix reconstitué' : 'PRIX ACHAT de 📦 PRODUITS';
      if (connu != null && connu > 0 && Math.abs(pu - connu) / connu > CUMP_ECART_MAX) {
        const ecart = Math.round((pu - connu) / connu * 100);
        alertes.push('⚠️ Prix unitaire inhabituel : ' + ref + ' à ' + cumpEuro_(pu) + ' sur la facture du ' +
          f.date + ' · ' + (f.piece || f.libelle).slice(0, 40) + ' — ' + (ecart > 0 ? '+' : '') + ecart +
          ' % par rapport au ' + origine + ' (' + cumpEuro_(connu) + '). ' +
          (q.horsMontant > 0
            ? 'Vérifie le montant HORS déclaré (' + cumpEuro_(q.horsMontant) + ') : c\'est lui qui fixe ce prix.'
            : 'Vérifie la quantité de la colonne QUANTITÉ, et qu\'aucun article hors stock ne reste sur la facture (mot-clé HORS).'));
      }
      dernierPu[ref] = pu;
      if (premierPrix[ref] == null) premierPrix[ref] = pu;
    });
    if (rep.prorata) alertes.push('Facture à plusieurs références répartie au prorata du prix catalogue : ' +
      f.date + ' · ' + (f.piece || f.libelle).slice(0, 60) + ' · ' + cumpEuro_(montant));
    entrees.push({ date: f.date, qte: q.qte, valeur: rep.valeur, libelle: (f.piece || f.libelle).slice(0, 40), source: q.source });
    detail.push({ type: 'facture', date: f.date, nom: (f.piece || f.libelle).slice(0, 40), montant: montant,
      qte: q.qte, valeur: rep.valeur, source: q.source, hors: q.horsMontant || 0 });
  });
  // ── 2. Livraisons sans facture : entrées au PMP en vigueur (quantités justes, PMP non dilué) ──
  livraisons.forEach(function (l) {
    if (l.facture) return;
    const q = {}; let n = 0;
    refs.forEach(function (ref) { const x = Number(l.qte[ref]) || 0; if (x) { q[ref] = x; n++; } });
    if (!n) return;
    alertes.push('Livraison sans facture rattachable : ' + l.date + ' · ' + (l.piece || l.fournisseur || 'sans pièce') +
      ' · ' + cumpLibQte_(q) + ' — entrée au PMP en vigueur, à corriger dès que la facture est saisie dans 🛒 ACHATS');
    entrees.push({ date: l.date, qte: q, valeur: null, auPmp: true, libelle: (l.piece || l.fournisseur || l.date).slice(0, 40) });
    detail.push({ type: 'livraison sans facture', date: l.date, nom: (l.piece || l.fournisseur || l.date).slice(0, 40), qte: q });
  });

  // ── 3. Sorties : quantités réellement consommées par match (valorisation neutre) ──
  const sorties = [];
  const neutre = function () { return 0; };
  (matchs || []).forEach(function (m) {
    if (!m || !m.id || !m.date) return;
    const q = {};
    try {
      coutMatiereMatch_(m.id, m.vendu, cat, m.benev, neutre, function (ref, qte) {
        const x = ref === 'FUT' ? qte / (PIL.FUT_LITRES || 30) : qte;   // le collecteur reçoit les fûts en litres
        if (x) q[ref] = (q[ref] || 0) + x;
      });
    } catch (e) { alertes.push('Quantités illisibles pour ' + m.id + ' : ' + e.message); return; }
    sorties.push({ date: m.date, idMatch: m.id, qte: q });
  });

  // ── 4. Déroulé chronologique : à date égale, les entrées avant les sorties ──
  const etat = {}, dernier = {}, reelle = {}, pmpAu = {};
  refs.forEach(function (ref) { etat[ref] = { qte: 0, valeur: 0 }; });

  // Stock de départ : STOCK_DEBUT si saisi, sinon prix de la 1re facture, sinon catalogue
  const base = pilReserve_().base;
  const ouverture = cumpOuverture_(base, refs, premierPrix, cat, alertes);
  Object.keys(ouverture.prix).forEach(function (ref) {
    const q = Number(ouverture.qte[ref]) || 0;
    if (!q) return;
    etat[ref] = { qte: q, valeur: cumpArr_(q * ouverture.prix[ref]) };
    dernier[ref] = ouverture.prix[ref];
    if (ouverture.reelle[ref]) reelle[ref] = true;
  });
  if (ouverture.detail) detail.unshift(ouverture.detail);

  const evts = [];
  entrees.forEach(function (e) { evts.push({ date: e.date, ordre: 0, e: e }); });
  sorties.forEach(function (s) { evts.push({ date: s.date, ordre: 1, s: s }); });
  evts.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.ordre - b.ordre; });

  const unitaire = function (ref) {
    const st = etat[ref];
    if (st && st.qte > 0.0001) return st.valeur / st.qte;
    if (dernier[ref] != null) return dernier[ref];
    return null;
  };
  const negatifs = {};
  evts.forEach(function (ev) {
    if (ev.e) {
      const e = ev.e;
      Object.keys(e.qte).forEach(function (ref) {
        const q = Number(e.qte[ref]) || 0;
        const v = e.auPmp ? q * (unitaire(ref) == null ? (cumpPrixCatalogue_(cat, ref) || 0) : unitaire(ref))
          : Number((e.valeur || {})[ref]) || 0;
        etat[ref].qte = cumpArr_(etat[ref].qte + q);
        etat[ref].valeur = cumpArr_(etat[ref].valeur + v);
        if (!e.auPmp) reelle[ref] = true;
        const u = unitaire(ref); if (u != null) dernier[ref] = u;
      });
      // Avoir sans quantité : il réduit la valeur du stock au prorata, sans toucher aux quantités,
      // pour que le rapprochement de saison boucle. Signalé, car il déplace le PMP.
      if (e.montantSeul && e.montantSeul < 0) {
        const cible = refs.filter(function (ref) { return etat[ref].qte > 0.0001; });
        let poids = 0; cible.forEach(function (ref) { poids += etat[ref].valeur; });
        if (poids > 0) {
          cible.forEach(function (ref) {
            etat[ref].valeur = cumpArr_(etat[ref].valeur + e.montantSeul * etat[ref].valeur / poids);
            const u = unitaire(ref); if (u != null) dernier[ref] = u;
          });
          alertes.push('Avoir sans quantité imputé au prorata de la valeur du stock : ' + e.date + ' · ' +
            e.libelle + ' · ' + cumpEuro_(e.montantSeul) + ' (' + cible.join(', ') + ') — il abaisse le PMP de ces références.');
        }
      }
    } else {
      const s = ev.s, snap = {};
      refs.forEach(function (ref) { const u = unitaire(ref); if (u != null) snap[ref] = u; });
      pmpAu[s.idMatch] = snap;
      Object.keys(s.qte).forEach(function (ref) {
        if (etat[ref] == null) return;
        const q = Number(s.qte[ref]) || 0, u = snap[ref];
        if (q > etat[ref].qte + 0.0001) negatifs[ref] = cumpArr_((negatifs[ref] || 0) + (q - Math.max(0, etat[ref].qte)));
        etat[ref].qte = cumpArr_(etat[ref].qte - q);
        etat[ref].valeur = cumpArr_(etat[ref].valeur - q * (u == null ? 0 : u));
        if (etat[ref].qte <= 0.0001) { etat[ref].qte = Math.max(0, etat[ref].qte); etat[ref].valeur = Math.max(0, cumpArr_(etat[ref].qte * (u == null ? 0 : u))); }
      });
      detail.push({ type: 'match', date: s.date, nom: s.idMatch, qte: s.qte, pmp: snap });
    }
  });
  Object.keys(negatifs).forEach(function (ref) {
    alertes.push('Consommé plus que le stock reconstitué pour ' + ref + ' (' + cumpNb_(negatifs[ref]) +
      ' en trop) : facture ou livraison manquante. Le dernier PMP connu a été conservé.');
  });

  // ── 5. Prix finaux et replis ─────────────────────────────────────────────
  const final = {}, repli = {};
  refs.forEach(function (ref) {
    const u = unitaire(ref);
    if (reelle[ref] && u != null) final[ref] = u;
    else { repli[ref] = true; const c = cumpPrixCatalogue_(cat, ref); if (c != null) final[ref] = c; }
  });
  // Signalé seulement pour les références en jeu : consommées cette saison, ou présentes en stock
  const enJeu = {};
  sorties.forEach(function (s) { Object.keys(s.qte).forEach(function (ref) { if (s.qte[ref]) enJeu[ref] = true; }); });
  refs.forEach(function (ref) { if (etat[ref] && etat[ref].qte > 0.0001) enJeu[ref] = true; });
  const replis = Object.keys(repli).filter(function (ref) { return enJeu[ref]; });
  if (replis.length) alertes.push('Aucune facture rattachable pour ' + replis.join(', ') +
    ' : valorisé au PRIX ACHAT de 📦 PRODUITS (comportement d\'avant).');

  // prix(ref, qte) par unité servie : FUT au litre, comme catalogueCouts_()
  const prixPour = function (snap) {
    const f = function (ref, qte) {
      let u = snap[ref];
      if (u == null || repli[ref]) { u = cumpPrixCatalogue_(cat, ref); if (u != null && qte) f.replis[ref] = true; }
      if (u == null) return null;
      return ref === 'FUT' ? u / (PIL.FUT_LITRES || 30) : u;
    };
    f.replis = {};
    return f;
  };
  return {
    refs: refs, alertes: alertes, detail: detail, pmpAu: pmpAu, final: final, repli: repli,
    stock: etat, ouverture: ouverture,
    pour: function (idOuDate) { return prixPour(pmpAu[idOuDate] || final); },
    finalPour: function () { return prixPour(final); },
    resume: function () { return cumpResume_(final, repli, refs); },
  };
}

// ── PMP figé par match ───────────────────────────────────────────────────
// Le PMP est recalculé à chaque passage de majMatchs sur TOUS les matchs : une facture saisie
// aujourd'hui réécrivait donc la marge de tous les matchs antérieurs. (C'est ce qui a produit
// un écart de −690,58 € là où +167 € était annoncé, le 23/11.) Une fois l'inventaire de fin
// d'un match complet, son PMP est figé dans PIL_PMP_<idm> et ne bouge plus.
// Même sémantique que cump.pour() : prix par unité servie, FUT au litre, repli sur le
// PRIX ACHAT de 📦 PRODUITS si la référence manque à l'instantané.
function cumpPrixFige_(snap, cat) {
  const f = function (ref, qte) {
    let u = (snap || {})[ref];
    if (u == null) { u = cumpPrixCatalogue_(cat, ref); if (u != null && qte) f.replis[ref] = true; }
    if (u == null) return null;
    return ref === 'FUT' ? u / (PIL.FUT_LITRES || 30) : u;
  };
  f.replis = {};
  return f;
}
// Liste des matchs dont le PMP est figé, pour le rapport de valorisation
function cumpMatchsFiges_() {
  return PropertiesService.getScriptProperties().getKeys()
    .filter(function (k) { return k.indexOf('PIL_PMP_') === 0; })
    .map(function (k) { return k.slice('PIL_PMP_'.length); }).sort();
}
/**
 * Dégeler le PMP d'un match (ou de tous) : son coût matière sera recalculé au PMP courant
 * au prochain « Mettre à jour les matchs ». Même esprit que 🔓 Détail buvette.
 */
function pilotagePmpDegeler() {
  const ui = SpreadsheetApp.getUi();
  const figes = cumpMatchsFiges_();
  if (!figes.length) { ui.alert('Aucun match n\'a son PMP figé.'); return; }
  const rep = ui.prompt('Dégeler le PMP d\'un match',
    'Figés : ' + figes.join(', ') + '\n\nID du match à dégeler (ou TOUS) :', ui.ButtonSet.OK_CANCEL);
  if (rep.getSelectedButton() !== ui.Button.OK) return;
  const id = String(rep.getResponseText() || '').trim().toUpperCase();
  const p = PropertiesService.getScriptProperties();
  if (id === 'TOUS') {
    figes.forEach(function (m) { p.deleteProperty('PIL_PMP_' + m); });
    ui.alert(figes.length + ' match(s) dégelé(s). Lance « 🔄 Mettre à jour les matchs » pour recalculer.');
    return;
  }
  if (figes.indexOf(id) < 0) { ui.alert(id + ' n\'a pas son PMP figé.'); return; }
  p.deleteProperty('PIL_PMP_' + id);
  ui.alert(id + ' dégelé. Lance « 🔄 Mettre à jour les matchs » pour recalculer son coût matière.');
}

// Valeur du stock au comptage de base : STOCK_DEBUT (prioritaire, réparti au prorata),
// sinon prix de la 1re facture connue par référence, sinon PRIX ACHAT de 📦 PRODUITS.
function cumpOuverture_(base, refs, premierPrix, cat, alertes) {
  const qte = {}, prix = {}, reelle = {};
  if (base && base.stock) refs.forEach(function (ref) { const q = Number(base.stock[ref]) || 0; if (q) qte[ref] = q; });
  const presents = Object.keys(qte);
  if (!presents.length) return { qte: qte, prix: prix, reelle: reelle, valeur: 0, source: 'aucun stock de départ' };
  let brut = 0;
  presents.forEach(function (ref) {
    if (premierPrix[ref] != null) { prix[ref] = premierPrix[ref]; reelle[ref] = true; }
    else { const c = cumpPrixCatalogue_(cat, ref); prix[ref] = c == null ? 0 : c; }
    brut += qte[ref] * prix[ref];
  });
  const sd = (function () {
    try { const r = SpreadsheetApp.getActiveSpreadsheet().getRangeByName('STOCK_DEBUT'); return r ? Number(r.getValue()) || 0 : 0; }
    catch (e) { return 0; }
  })();
  let source;
  if (sd > 0 && brut > 0) {
    const k = sd / brut;
    presents.forEach(function (ref) { prix[ref] = prix[ref] * k; reelle[ref] = true; });
    source = 'STOCK_DEBUT (' + cumpEuro_(sd) + ' réparti au prorata)';
  } else {
    source = 'estimé au prix de la 1re facture connue (STOCK_DEBUT non saisi)';
    if (alertes) alertes.push('STOCK_DEBUT n\'est pas saisi au 📊 TABLEAU DE BORD : le stock du comptage de base du ' +
      (base.date || '?') + ' (' + cumpLibQte_(qte) + ') est valorisé au prix de la 1re facture connue, ' +
      'sinon au prix catalogue. Saisir la valeur HT de ce stock fige la valorisation.');
  }
  const valeur = presents.reduce(function (a, ref) { return a + qte[ref] * prix[ref]; }, 0);
  return { qte: qte, prix: prix, reelle: reelle, valeur: cumpArr_(valeur), source: source,
    detail: { type: 'stock de départ', date: base.date || '', nom: source, qte: qte, valeur: (function () {
      const v = {}; presents.forEach(function (ref) { v[ref] = cumpArr_(qte[ref] * prix[ref]); }); return v; })() } };
}

// ── Libellés ──────────────────────────────────────────────────────────────
function cumpEuro_(x) { return (Math.round((Number(x) || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' €'; }
function cumpNb_(x) { return String(Math.round((Number(x) || 0) * 100) / 100).replace('.', ','); }
function cumpLibQte_(q) {
  return Object.keys(q || {}).map(function (ref) { return cumpNb_(q[ref]) + ' ' + ref; }).join(', ');
}
function cumpResumeFiges_() {
  const f = cumpMatchsFiges_();
  return f.length ? 'PMP figé (inventaire complet) : ' + f.join(', ') + ' — menu 🔓 Dégeler le PMP d\'un match pour recalculer.' : '';
}
function cumpResume_(final, repli, refs) {
  return (refs || Object.keys(final)).filter(function (ref) { return final[ref] != null; }).map(function (ref) {
    return ref + ' : ' + cumpEuro_(final[ref]) + (repli[ref] ? ' (prix catalogue, aucune facture)' : ' (PMP)');
  }).join('\n');
}

// ── Menu 🏐 Matchday → 💶 Contrôler la valorisation (CUMP) ─────────────────
function controlerValorisation() {
  const cat = catalogueCouts_();
  const cump = cumpConstruire_(cumpMatchsValorisables_(cat), cat);
  const l = [];
  l.push('💶 VALORISATION AU PRIX MOYEN PONDÉRÉ (CUMP), calculée sur les factures de 🛒 ACHATS.');
  l.push('');
  l.push('Stock de départ : ' + (cump.ouverture.source || '—') +
    (cump.ouverture.valeur ? ' · ' + cumpEuro_(cump.ouverture.valeur) : ''));
  l.push('');
  l.push('PMP actuel par référence :');
  l.push(cump.resume() || '(aucune référence)');
  l.push('');
  l.push('PMP appliqué à chaque match :');
  const parM = cump.detail.filter(function (x) { return x.type === 'match'; });
  if (!parM.length) l.push('(aucun match valorisé)');
  parM.forEach(function (m) {
    const bits = Object.keys(m.qte).map(function (ref) {
      const u = (m.pmp || {})[ref];
      return ref + ' ' + cumpNb_(m.qte[ref]) + ' × ' + (u == null ? '—' : cumpEuro_(u));
    });
    l.push('• ' + m.date + ' ' + m.nom + ' : ' + (bits.join(' · ') || '—'));
  });
  l.push('');
  l.push('Entrées retenues :');
  cump.detail.filter(function (x) { return x.type !== 'match'; }).forEach(function (e) {
    l.push('• ' + (e.date || '?') + ' ' + e.nom + ' : ' + cumpLibQte_(e.qte) +
      (e.montant != null ? ' · ' + cumpEuro_(e.montant) : '') + (e.source ? ' · ' + e.source : ''));
  });
  l.push('');
  l.push(cump.alertes.length ? '⚠️ À régler (' + cump.alertes.length + ') :\n• ' + cump.alertes.join('\n• ')
    : '✅ Aucune alerte : toutes les quantités consommées sont couvertes par une facture.');
  alerte_(l.join('\n'));
}
// Matchs que majMatchs valorise, avec les mêmes totaux (agregerMatchs_ et matchsAValoriser_ de Code.gs)
function cumpMatchsValorisables_(cat) {
  const sh = feuille_('MATCHS');
  if (!sh) return [];
  const h = entete_(sh), c = {};
  MCOL.forEach(function (n) { c[n] = col_(h, n); });
  return matchsAValoriser_(donnees_(sh), c, agregerMatchs_(cat));
}
