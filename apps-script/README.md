# Matchday Business V13 — scripts du Sheet

Projet Apps Script **« Buvette »** du Google Sheet *Matchday Business Spacers*. 5 fichiers :
`Code.gs`, `Reorganisation.gs`, `Pilotage.gs`, `Achats.gs`, `Historique.gs`, `Fidelite.gs`.

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
