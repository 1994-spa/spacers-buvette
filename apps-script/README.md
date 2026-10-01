# Pilotage live — installation dans le Sheet Matchday Business

Le pilotage s'ajoute au projet Apps Script **« Buvette »** du Google Sheet *Matchday Business Spacers*.
Les tablettes et le tableau de bord utilisent la même URL de déploiement que les tablettes aujourd'hui.

## Installation (une fois)
1. Ouvrir le Sheet → **Extensions → Apps Script** (projet « Buvette »).
2. **Code.gs** : remplacer tout le contenu par `Code.gs` (V12). Les changements par rapport à la V11 sont limités et commentés en tête de fichier.
3. **Fichiers ➕ → Script**, nommer `Pilotage`, coller `Pilotage.gs`. Idem avec `Historique.gs` (nommé `Historique`). Ne pas toucher à `Fidelite.gs`.
4. **Paramètres du projet → Propriétés du script** : ajouter `VIVENU_API_KEY` = la clé API Tickie (la même que celle du relais tickie-proxy).
5. Enregistrer, recharger le Sheet → menu **🏐 Matchday → 📡 Pilotage live → ⚙️ Initialiser le pilotage**. Autoriser le script, noter le **jeton** affiché.
6. Menu **📡 Pilotage live → ⏱️ Activer le traitement auto (10 min)**.
7. **Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version → Déployer**. L'URL `…/exec` ne change pas.
8. Ouvrir `https://spacers-buvette.spacersytb.workers.dev/pilotage.html`, coller l'URL `…/exec` et le jeton.
9. En bas du tableau de bord : envoyer à chaque bénévole le lien de sa buvette (il configure la tablette d'un clic).

## Jour de match
1. **Tableau de bord** : choisir le match, saisir le stock par buvette (bière en fûts de 30 L), « Enregistrer le stock ».
   → le match est créé dans 10_MATCHS s'il n'existe pas (ex. `NAR-10-10`) et devient le match actif (PILOTAGE!B9).
2. **Chaque tablette, en wifi** : ⚙️ → « Charger le match ». Le tableau de bord affiche « ✓ tablette chargée ».
3. **En buvette** : la tablette fonctionne hors ligne. Ventes et billets scannés sont gardés sur la tablette.
4. **Retour du wifi** : tout repart seul. Les ventes arrivent dans `51_VENTES_LIVE` (détail) et `50_VENTES_DIRECTES` (lignes produits, lues par les KPI).
5. **Réassort pendant le match** : modifier le stock au tableau de bord, puis « Charger le match » sur la tablette concernée (les compteurs sont conservés).

Le mode buvette est maintenant **par match** (colonne MODE_BUVETTE de 10_MATCHS) : les matchs préparés au tableau de bord passent en DIRECT, les matchs 25-26 gardent LOCATION. PILOTAGE!B8 ne sert plus que de valeur par défaut.

## Historique 22-23 à 25-26
Menu **📡 Pilotage live → 📚 Importer l'historique 22-26** : 51 matchs (ID du type `NIC-08-10-22`, STATUT HISTORIQUE), leurs lignes produits dans 50_VENTES_DIRECTES et les KPI. Relançable sans doublon ; « Retirer l'historique » annule. Les reportings n'ont pas d'affluence : la saisir dans 10_MATCHS (AFFLUENCE) puis « Recalculer tous les KPI saison ».

## Onglets ajoutés
| Onglet | Contenu |
|---|---|
| 51_VENTES_LIVE | une ligne par vente : buvette, total, consignes, billet scanné (id, code, tarif), client Tickie, points fidélité |
| 52_STOCK_LIVE | stock restant remonté par chaque tablette |
| 53_PREPA | stock de départ par match et par buvette |
| 54_TABLETTES | dernier chargement et dernière remontée de chaque tablette |

Colonnes ajoutées à 10_MATCHS : `TICKIE_EVENT_ID`, `AFFLUENCE_TICKIE` (reprise par les KPI quand l'export OandB du match est vide).

## Données personnelles
- La tablette ne reçoit et n'envoie que : identifiant du billet, code-barres, tarif. Ni nom ni email.
- Le lien vers l'acheteur (id client Tickie, email pour la fidélité) est fait par le script, côté serveur.
- Le tableau de bord ne reçoit que des totaux.
- À afficher en buvette et dans la politique de confidentialité : le scan du billet sert à mesurer la consommation par profil de spectateur et à créditer les points du programme de fidélité.
