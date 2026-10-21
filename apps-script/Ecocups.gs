// ═══════════════════════════════════════════════════════════════════════════
// 🥤 STOCK ÉCOCUPS — stock réel de gobelets 30 cl / 50 cl, match après match, et rachat à prévoir
//
// Saisie (une seule fois, puis à chaque achat) : onglet 🥤 ÉCOCUPS MOUVEMENTS
//   · Stock de départ    : gobelets comptés au départ (point de départ du calcul)
//   · Achat              : gobelets reçus du fournisseur
//   · Comptage           : stock réellement compté → recale le calcul (l'écart est affiché)
//   · Casse / perte      : gobelets abîmés jetés, perdus au lavage…
//   Paramètres (colonnes H-I du même onglet) : délai de livraison, marge de sécurité, commande par multiple de.
//
// Par match, à partir des tablettes :
//   vendus   = gobelets consignés (+ Gobelet)
//   revenus  = rendus et remboursés (♻️, y compris saisis à une buvette sans caisse : le gobelet est bien revenu)
//            + rapportés sans remboursement faute d'espèces (🚫) + récupérés sur le comptoir / ramassés (🫙)
//   partis   = vendus − revenus  → gobelets que les spectateurs ont gardés (perte de stock, consigne acquise au club)
//   stock après le match = stock avant − partis
//
// Rachat : besoin pour servir un match = plus gros match de la saison (gobelets vendus) + marge de sécurité ;
// pertes moyennes = moyenne des « partis » sur les 5 derniers matchs ; projection sur les matchs à domicile restants.
// Recalculé avec 🥤 DÉTAIL BUVETTE (clôtures, toutes les 10 min) et par le menu 📡 Pilotage live → 🥤 Stock écocups et rachat.
// ═══════════════════════════════════════════════════════════════════════════
const ECO_TAB = '🥤 STOCK ÉCOCUPS';
const ECO_MVT_TAB = '🥤 ÉCOCUPS MOUVEMENTS';
const ECO_MVT_HDR = ['DATE', 'TYPE', '30 cl', '50 cl', 'COMMENTAIRE'];
const ECO_TYPES = ['Stock de départ', 'Achat', 'Comptage', 'Casse / perte'];
const ECO_PARAMS = [['Délai de livraison (jours)', 21], ['Marge de sécurité', 0.2], ['Commande par multiple de', 50]];
const ECO_TAILLES = [['33', '30 cl'], ['50', '50 cl']];

function ecoMouvementsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ECO_MVT_TAB);
  if (sh) return sh;
  sh = ss.insertSheet(ECO_MVT_TAB);
  const navy = typeof NAVY !== 'undefined' ? NAVY : '#0b1f33', jaune = typeof YELLOW !== 'undefined' ? YELLOW : '#ffd400';
  sh.getRange(1, 1, 1, ECO_MVT_HDR.length).setValues([ECO_MVT_HDR]).setBackground(navy).setFontColor(jaune).setFontWeight('bold');
  sh.getRange(2, 1, 500, 1).setNumberFormat('dd/MM/yyyy')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  sh.getRange(2, 2, 500, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ECO_TYPES, true).setAllowInvalid(false).build());
  sh.getRange(2, 3, 500, 2).setNumberFormat('0')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).build());
  sh.getRange(1, 8, 1, 2).setValues([['PARAMÈTRE', 'VALEUR']]).setBackground(navy).setFontColor(jaune).setFontWeight('bold');
  sh.getRange(2, 8, ECO_PARAMS.length, 2).setValues(ECO_PARAMS);
  sh.getRange(3, 9).setNumberFormat('0%');
  sh.getRange(6, 8).setValue("Une ligne par mouvement. Commencer par « Stock de départ » (gobelets comptés). Ensuite : chaque achat reçu, chaque comptage (recale le stock), la casse. Le stock est recalculé dans 🥤 STOCK ÉCOCUPS.")
    .setFontStyle('italic').setFontColor('#666666').setWrap(true);
  sh.setColumnWidth(1, 100); sh.setColumnWidth(2, 140); sh.setColumnWidths(3, 2, 70); sh.setColumnWidth(5, 260); sh.setColumnWidth(8, 220); sh.setColumnWidth(9, 80);
  sh.setFrozenRows(1);
  return sh;
}

function pilotageStockEcocups(silencieux) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lire = function (sh) {
    if (!sh || sh.getLastRow() < 2) return { h: {}, rows: [] };
    const d = sh.getDataRange().getValues(), h = {};
    d[0].forEach(function (x, i) { if (x !== '' && !(String(x) in h)) h[String(x)] = i; });
    return { h: h, rows: d.slice(1) };
  };
  const jour = function (d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const auj = jour(new Date());

  // Paramètres et mouvements saisis
  const mvSh = ecoMouvementsSheet_();
  const par = {}; mvSh.getRange(2, 8, ECO_PARAMS.length, 2).getValues().forEach(function (r) { par[String(r[0])] = Number(r[1]); });
  const delai = par[ECO_PARAMS[0][0]] >= 0 ? par[ECO_PARAMS[0][0]] : 21;
  const marge = par[ECO_PARAMS[1][0]] >= 0 ? par[ECO_PARAMS[1][0]] : 0.2;
  const multiple = par[ECO_PARAMS[2][0]] > 0 ? par[ECO_PARAMS[2][0]] : 1;
  const mvts = [];
  if (mvSh.getLastRow() > 1) mvSh.getRange(2, 1, mvSh.getLastRow() - 1, 5).getValues().forEach(function (r) {
    if (!(r[0] instanceof Date) || ECO_TYPES.indexOf(String(r[1])) < 0) return;
    mvts.push({ t: jour(r[0]), date: r[0], type: String(r[1]), q: { '33': r[2] === '' ? null : Number(r[2]) || 0, '50': r[3] === '' ? null : Number(r[3]) || 0 }, com: String(r[4] || '') });
  });

  // Matchs (domicile, copiés de Tickie)
  const mt = lire(feuille_('MATCHS')), infos = {}, futurs = [];
  mt.rows.forEach(function (r) {
    const id = String(r[mt.h['ID_MATCH']] || ''), d = r[mt.h['DATE']];
    if (!(d instanceof Date)) return;
    const info = { id: id, date: d, t: jour(d), adv: String(r[mt.h['ADVERSAIRE']] || '') };
    if (id) infos[id] = info;
    if (info.t >= auj) futurs.push(info);
  });

  // Gobelets par match et par taille, depuis les tablettes
  const par0 = function () { return { v: { '33': 0, '50': 0 }, r: { '33': 0, '50': 0 } }; };
  const acc = {};
  const get = function (m) { return acc[m] = acc[m] || par0(); };
  const vd = lire(feuille_('DETAIL')), V = vd.h;
  vd.rows.forEach(function (r) {
    const m = String(r[V['MATCH']] || ''), type = String(r[V['TYPE']] || ''), ref = String(r[V['REF']] || '');
    if (!infos[m] || type === 'HISTORIQUE' || !/^E/.test(ref)) return;
    const q = Number(r[V['QTY']]) || 0, t = ref === 'E50' ? '50' : '33';
    if (type === 'REMBOURSEMENT_CONSIGNE') get(m).r[t] += q;
    else if (Number(r[V['CONSIGNE_UNIT']]) > 0) get(m).v[t] += q;
  });
  const nr = lire(ss.getSheetByName(PIL_NR_TAB)), N = nr.h;
  nr.rows.forEach(function (r) {
    const m = String(r[N['ID_MATCH']] || ''); if (!infos[m]) return;
    get(m).r['33'] += Number(r[N['Écocups 30cl']]) || 0;
    get(m).r['50'] += Number(r[N['Écocups 50cl']]) || 0;
  });

  // Matchs restants : à venir, ou du jour sans vente encore enregistrée
  const restants = futurs.filter(function (f) { const a = acc[f.id]; return !a || a.v['33'] + a.v['50'] === 0; })
    .sort(function (a, b) { return a.t - b.t; });
  futurs.length = 0; Array.prototype.push.apply(futurs, restants);

  // Chronologie : mouvements + matchs passés. Même jour : départ / achat avant le match, comptage / casse après.
  const ordre = { 'Stock de départ': 0, 'Achat': 1, 'match': 2, 'Comptage': 3, 'Casse / perte': 4 };
  const evts = mvts.map(function (x) { return { t: x.t, k: ordre[x.type], mv: x }; });
  Object.keys(acc).forEach(function (m) { if (acc[m].v['33'] + acc[m].v['50'] + acc[m].r['33'] + acc[m].r['50'] !== 0) evts.push({ t: infos[m].t, k: 2, m: m }); });
  evts.sort(function (a, b) { return a.t - b.t || a.k - b.k; });
  // Point de départ : dernier « Stock de départ », sinon premier comptage
  let iDepart = evts.map(function (e) { return e.mv && e.mv.type === 'Stock de départ'; }).lastIndexOf(true);
  if (iDepart < 0) iDepart = evts.findIndex(function (e) { return e.mv && e.mv.type === 'Comptage'; });

  const stock = { '33': null, '50': null }, lignes = [], matchsCalc = [];
  evts.forEach(function (e, i) {
    const l = { date: e.mv ? e.mv.date : infos[e.m].date, quoi: '', cols: {} };
    if (e.mv) {
      const mv = e.mv;
      l.quoi = mv.type + (mv.com ? ' — ' + mv.com : '');
      if (mv.type === 'Stock de départ' && i !== iDepart) { l.quoi += ' (remplacé par un stock de départ plus récent)'; }
      ECO_TAILLES.forEach(function (tt) {
        const t = tt[0], q = mv.q[t], c = l.cols[t] = { v: '', r: '', p: '', mv: '', s: '' };
        if (i < iDepart || q === null) { if (stock[t] !== null && i >= iDepart) c.s = stock[t]; return; }   // case vide : format non concerné
        if (mv.type === 'Stock de départ' || (mv.type === 'Comptage' && stock[t] === null)) { stock[t] = q; c.mv = mv.type === 'Comptage' ? 'compté ' + q : q; }
        else if (stock[t] === null) { c.mv = '⚠️ pas de stock de départ'; return; }
        else if (mv.type === 'Achat') { stock[t] += q; c.mv = q; }
        else if (mv.type === 'Casse / perte') { stock[t] -= q; c.mv = -q; }
        else if (mv.type === 'Comptage') { c.mv = 'écart ' + (q - stock[t] > 0 ? '+' : '') + (q - stock[t]); stock[t] = q; }
        c.s = stock[t];
      });
    } else {
      const a = acc[e.m], inf = infos[e.m];
      l.quoi = e.m + (inf.adv ? ' — ' + inf.adv : '');
      const calc = { m: e.m, partis: {}, vendus: {} };
      ECO_TAILLES.forEach(function (tt) {
        const t = tt[0], p = a.v[t] - a.r[t];
        l.cols[t] = { v: a.v[t], r: a.r[t], p: p, mv: '', s: '' };
        calc.partis[t] = p; calc.vendus[t] = a.v[t];
        if (i > iDepart && iDepart >= 0 && stock[t] !== null) { stock[t] -= p; l.cols[t].s = stock[t]; }
      });
      if (a.v['33'] + a.v['50'] > 0) matchsCalc.push(calc);
    }
    lignes.push(l);
  });

  // Projection et rachat, par taille
  const derniers = matchsCalc.slice(-5);
  const synth = ECO_TAILLES.map(function (tt) {
    const t = tt[0];
    const pertes = derniers.length ? derniers.reduce(function (s, c) { return s + Math.max(0, c.partis[t]); }, 0) / derniers.length : null;
    const pic = matchsCalc.reduce(function (s, c) { return Math.max(s, c.vendus[t]); }, 0);
    const besoin = Math.ceil(pic * (1 + marge));
    const st = stock[t];
    const o = { taille: tt[1], stock: st, pertes: pertes, besoin: besoin, restants: futurs.length, fin: '', rupture: '', avant: '', commande: '' };
    if (st === null || pertes === null) return o;
    o.fin = Math.round(st - pertes * futurs.length);
    for (let k = 0; k < futurs.length; k++) {
      const dispo = st - pertes * k;
      if (dispo < besoin) {
        o.rupture = Utilities.formatDate(futurs[k].date, Session.getScriptTimeZone() || 'Europe/Paris', 'dd/MM') + ' ' + (futurs[k].adv || futurs[k].id);
        o.avant = new Date(futurs[k].t - delai * 86400000);
        break;
      }
    }
    const manque = besoin + pertes * futurs.length - st;
    o.commande = manque > 0 ? Math.ceil(manque / multiple) * multiple : 0;
    return o;
  });

  // Écriture
  let sh = ss.getSheetByName(ECO_TAB);
  if (!sh) sh = ss.insertSheet(ECO_TAB);
  sh.clear();
  const navy = typeof NAVY !== 'undefined' ? NAVY : '#0b1f33', jaune = typeof YELLOW !== 'undefined' ? YELLOW : '#ffd400';
  sh.getRange(1, 1).setValue('🥤 STOCK ÉCOCUPS — stock réel et rachat à prévoir').setFontSize(16).setFontWeight('bold').setFontColor(navy);
  sh.getRange(2, 1).setValue('Mis à jour automatiquement (clôtures + toutes les 10 min). Achats, comptages et casse : onglet ' + ECO_MVT_TAB +
    '. Partis = vendus − revenus (rendus et remboursés + rapportés sans remboursement 🚫 + récupérés sur le comptoir 🫙) : gobelets gardés par les spectateurs. Besoin pour un match = plus gros match de la saison + ' +
    Math.round(marge * 100) + ' %. Pertes moyennes = 5 derniers matchs.').setFontStyle('italic').setFontColor('#666666').setWrap(false);

  const hs = ['FORMAT', 'STOCK ACTUEL', 'PERTES MOYENNES / MATCH', 'BESOIN POUR UN MATCH', 'MATCHS À DOMICILE RESTANTS', 'STOCK PROJETÉ EN FIN DE SAISON', 'PREMIER MATCH À RISQUE', 'COMMANDER AVANT LE', 'À COMMANDER'];
  sh.getRange(4, 1, 1, hs.length).setValues([hs]).setBackground(navy).setFontColor(jaune).setFontWeight('bold').setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
  sh.setRowHeight(4, 44);
  const sv = synth.map(function (o) {
    return [o.taille, o.stock === null ? '⚠️ saisir le stock de départ' : o.stock, o.pertes === null ? '—' : Math.round(o.pertes), o.besoin || '—', o.restants,
      o.fin === '' ? '—' : o.fin, o.rupture || (o.stock === null || o.pertes === null ? '—' : 'aucun cette saison ✅'), o.avant || '—', o.commande === '' ? '—' : o.commande];
  });
  sh.getRange(5, 1, sv.length, hs.length).setValues(sv).setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(5, 8, sv.length, 1).setNumberFormat('dd/MM/yyyy');
  synth.forEach(function (o, i) {
    if (o.rupture) sh.getRange(5 + i, 7, 1, 3).setBackground('#f4cccc');
    if (o.avant && o.avant.getTime() < auj) sh.getRange(5 + i, 8).setValue('⚠️ dès maintenant');
    else if (o.stock !== null && o.pertes !== null) sh.getRange(5 + i, 7, 1, 3).setBackground('#d9ead3');
  });

  const r0 = 8;
  sh.getRange(r0, 1).setValue('Historique (du plus récent au plus ancien)').setFontWeight('bold').setFontColor(navy);
  const h2 = ['DATE', 'MATCH / MOUVEMENT'];
  ECO_TAILLES.forEach(function (tt) { ['VENDUS', 'REVENUS', 'PARTIS', 'ACHAT / CORRECTION', 'STOCK APRÈS'].forEach(function (x) { h2.push(x + ' ' + tt[1]); }); });
  sh.getRange(r0 + 1, 1, 1, h2.length).setValues([h2]).setBackground(navy).setFontColor(jaune).setFontWeight('bold').setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
  sh.setRowHeight(r0 + 1, 44);
  const out = lignes.slice().reverse().map(function (l) {
    const row = [l.date, l.quoi];
    ECO_TAILLES.forEach(function (tt) { const c = l.cols[tt[0]] || {}; row.push(c.v, c.r, c.p, c.mv, c.s); });
    return row.map(function (x) { return x === undefined || x === null ? '' : x; });
  });
  if (out.length) {
    sh.getRange(r0 + 2, 1, out.length, h2.length).setValues(out);
    sh.getRange(r0 + 2, 1, out.length, 1).setNumberFormat('dd/MM/yyyy');
    [7, 12].forEach(function (c) { sh.getRange(r0 + 2, c, out.length, 1).setFontWeight('bold'); });
  } else sh.getRange(r0 + 2, 1).setValue('Aucun match ni mouvement pour le moment.');
  sh.setFrozenRows(0);
  sh.setColumnWidth(1, 95); sh.setColumnWidth(2, 260); sh.setColumnWidths(3, h2.length - 2, 95);
  if (!silencieux) { try { ss.toast('Stock écocups recalculé'); } catch (e) {} }
  return synth;
}
