# Matchday Business V13 — scripts du Sheet

Projet Apps Script **« Buvette »** du Google Sheet *Matchday Business Spacers*. 5 fichiers :
`Code.gs`, `Reorganisation.gs`, `Pilotage.gs`, `Achats.gs`, `Historique.gs`, `Fidelite.gs`, `Rapprochement.gs`.

## Passage en V13 (une fois)
1. Sheet → **Extensions → Apps Script**.
2. Remplacer tout le contenu de **Code.gs**, **Pilotage.gs**, **Historique.gs** et **Fidelite.gs** par les nouvelles versions.
3. **Fichiers ➕ → Script**, nommer `Reorganisation`, coller `Reorganisation.gs`.
4. Enregistrer, recharger le Sheet → menu **🏐 Matchday → 🧹 Réorganiser le fichier (V13)** → Oui.
   - copie de sauvegarde complète dans le même dossier ;
   - exports O&B 25-26 + Pennylane location déplacés dans un fichier d'archive privé (racine de Mon Drive) ;
   - nouvelle structure, onglets obsolètes supprimés, indicateurs recalculés.
5. **Déployer → Gérer les déploiements → ✏️ → Nouvelle version → Déployer** (l'URL `…/exec` ne change pas).
6. Compléter les prix d'achat manquants dans **📦 PRODUITS**, puis **🔎 Vérifier le fichier**.

## Onglets
| Onglet | Rôle | Rempli par |
|---|---|---|
| 🏠 ACCUEIL | Mode d'emploi, match actif, liens | auto |
| 📊 TABLEAU DE BORD | Saison au choix (B4), comparaison des saisons, matchs de la saison, graphique | formules |
| 📅 MATCHS | Une ligne par match : affluence, CA, €/spectateur, panier, familles, marge, foodtrucks | auto (affluence, notes modifiables) |
| 🧾 VENTES | Une ligne par vente des tablettes (paiement, billet, produits) | tablettes |
| 📦 PRODUITS | Prix de vente (envoyés aux tablettes), prix d'achat, colisage, seuils | à la main |
| 🛒 ACHATS | Factures fournisseurs par match | à la main |
| 🚚 FOODTRUCKS | Formule (gratuit / forfait / % du CA / forfait + %), montant dû calculé, payé | à la main |
| ⭐ FIDÉLITÉ | Points des spectateurs | auto |
| ⚙️ saisons, ⚙️ détail ventes, ⚙️ journal fidélité | Techniques, masqués | auto |

## Automatique
- Toutes les 10 min (menu 📡 Pilotage live → Activer le traitement auto) : billets scannés reliés aux clients Tickie, points fidélité, 📅 MATCHS recalculé ; toutes les heures : matchs et affluences Tickie.
- Les tablettes envoient ventes et clôtures de caisse dès qu'elles ont le wifi.

## Marge par match (V14)
- **Coût matière** = stock de départ (préparation du tableau de bord) − inventaire de fin, au prix d'achat HT de 📦 PRODUITS.
- **Inventaire de fin** : compté sur la tablette à la clôture de caisse (fûts pleins + fût entamé, bouteilles), corrigeable au tableau de bord.
- **Casse / écarts** = consommé − vendu. **Réserve 🙋 Bénévoles** : stock hors vente (départ et reste saisis au tableau de bord), coût à part.
- **Marge HT** = CA HT (TVA par produit) − coût matière − conso bénévoles + redevances foodtrucks.
- **Achats** : Pennylane est la seule source. 🛒 ACHATS recopie le compte 607100000 toutes les 6 h (propriété `PENNYLANE_API_KEY`,
  token avec « Lecture des écritures comptables » + « Lecture des comptes comptables »). Le tableau de bord rapproche
  achats + stock de début − consommé − bénévoles − stock restant = écart non expliqué.
- Clôture de caisse : écart espèces et écart CB (ticket TPE − CB enregistrée) par match dans 📅 MATCHS.

## Détail buvette (onglet 🥤 DÉTAIL BUVETTE)
- Une ligne par saison, par match et par buvette : CA alcoolisé / sans alcool (TTC et HT, famille et TVA de 📦 PRODUITS),
  écocups vendus / rendus et remboursés / non remboursés (gardés par le spectateur ou rapportés sans remboursement faute d'espèces),
  consignes payées en CB ou en espèces, remboursées en espèces ou déduites d'un achat CB, solde espèces et fond de caisse minimum.
- Fond de caisse : fond de départ de la saison B1 350 €, B2 450 €, B3 sans caisse (`PIL.FONDS_CAISSE`, `PIL.BUVETTES_SANS_CAISSE` ; même réglage dans la tablette, `LIEUX`).
  Le fond saisi à la clôture de caisse prime pour ce match. Colonnes calculées à l'affichage, donc aussi pour les matchs figés 🔒 :
  **fond de départ**, **espèces attendues en fin de match** (fond + solde espèces), **marge sur le minimum** (fond − fond minimum ; négative = caisse à court de liquide).
- Tablette : bouton 🚫 « Plus d'espèces : pas remboursé » sur un panier de gobelets rendus → onglet masqué ⚙️ écocups non remboursés
  (hors 🧾 VENTES et ⚙️ détail ventes : NB VENTES, panier et consignes de Code.gs inchangés).
- Recalculé à chaque clôture, toutes les 10 min, ou menu 📡 Pilotage live → 🥤 Mettre à jour le détail buvette.

## Rapprochement CB (onglet 💳 RAPPROCHEMENT CB)
- Une ligne « Total buvettes » par match, puis une ligne par buvette, puis boutique et billetterie du jour (pour info).
- Tablettes (🧾 VENTES) : CA boissons TTC, dont payé CB / espèces, consignes nettes payées CB, **CB enregistrée** (= ce que la banque doit créditer).
- Ticket TPE saisi à la clôture de caisse, s'il l'a été.
- Pennylane (lecture seule, même clé `PENNYLANE_API_KEY` que 🛒 ACHATS) : remises comptabilisées en 707100000 (libellé « B1 - Vs Narbonne - 10/10 »),
  707200000 boutique et 706120000 billetterie (HT comptabilisé). Écriture rattachée au match si datée du match à J+7 et libellé contenant jj/mm ou « Vs adversaire ».
- **Écart CB = remise Pennylane − CB enregistrée** : > 0 = paiements passés sur le TPE sans saisie tablette ; < 0 = CB tablette absente de la remise.
- Recalculé après chaque import Pennylane (toutes les 6 h) ou menu 📡 Pilotage live → 💳 Rapprochement CB. Aucune saisie.
- Ajout : Apps Script → Fichiers ➕ → Script `Rapprochement`, coller `Rapprochement.gs` ; remplacer `Pilotage.gs` et `Achats.gs` ; enregistrer.
