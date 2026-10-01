# Pilotage live — installation dans le Sheet Matchday Business

Le pilotage s'ajoute au projet Apps Script **« Buvette »** du Google Sheet *Matchday Business Spacers*.
Les tablettes et le tableau de bord utilisent la même URL de déploiement que les tablettes aujourd'hui.

## Installation (une fois)
1. Ouvrir le Sheet → **Extensions → Apps Script** (projet « Buvette »).
2. **Code.gs** : remplacer tout le contenu par `Code.gs` (V12). Les changements par rapport à la V11 sont limités et commentés en tête de fichier.
3. **Fichiers ➕ → Script**, nommer `Pilotage`, coller `Pilotage.gs`. Idem avec `Historique.gs` (nommé `Historique`). Ne pas toucher à `Fidelite.gs`.
4. **Paramètres du projet → Propriétés du script** : ajouter `VIVENU_API_KEY` = la clé API Tickie (la même que celle du relais tickie-proxy).
5. Enregistrer, recharger le Sheet → menu **🏐 Matchday → 📡 Pilotage live → ⚙️ Initialiser le pilotage**. Autoriser le script, noter le **jeton** affiché. Les matchs Spacer's de Tickie sont recopiés dans 10_MATCHS avec leur affluence.
6. Menu **📡 Pilotage live → ⏱️ Activer le traitement auto** (billets/fidélité toutes les 10 min, matchs et affluences Tickie toutes les heures).
7. **Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version → Déployer**. L'URL `…/exec` ne change pas.
8. Menu **📡 Pilotage live → 📊 Ouvrir le tableau de bord + liens tablettes** : le tableau de bord s'ouvre déjà connecté (aucune saisie), et chaque tablette se configure en scannant son QR code.

## Jour de match
1. **Tableau de bord** : la commande conseillée est calculée selon l'affluence Tickie et l'historique ; le stock des 3 buvettes est pré-rempli à partir d'elle. Vérifier puis « Enregistrer le stock ».
   → le match est créé dans 10_MATCHS s'il n'existe pas (ex. `NAR-10-10`) et devient le match actif (PILOTAGE!B9).
2. **Tablettes** : rien à faire. Dès qu'elles ont le wifi (ouverture de l'app, puis toutes les 5 min), elles chargent le match, leur stock et les billets. Le tableau de bord affiche « ✓ tablette chargée ».
3. **En buvette** : la tablette fonctionne hors ligne. Ventes et billets scannés sont gardés sur la tablette.
4. **Retour du wifi** : tout repart seul. Les ventes arrivent dans `51_VENTES_LIVE` (détail) et `50_VENTES_DIRECTES` (lignes produits, lues par les KPI).
5. **Réassort pendant le match** : modifier le stock au tableau de bord ; la tablette le prend en compte seule dans les 5 minutes si elle a du réseau (compteurs conservés).

Le mode buvette est maintenant **par match** (colonne MODE_BUVETTE de 10_MATCHS) : les matchs préparés au tableau de bord passent en DIRECT, les matchs 25-26 gardent LOCATION. PILOTAGE!B8 ne sert plus que de valeur par défaut.

## Historique 22-23 à 25-26
Menu **📡 Pilotage live → 📚 Importer l'historique 22-26** : 51 matchs (ID du type `NIC-08-10-22`, STATUT HISTORIQUE), leurs lignes produits dans 50_VENTES_DIRECTES et les KPI. Relançable sans doublon ; « Retirer l'historique » annule. Les reportings n'ont pas d'affluence : la saisir dans 10_MATCHS (AFFLUENCE) puis « Recalculer tous les KPI saison ».

## Onglet ajouté
Un seul : **51_VENTES_LIVE** (une ligne par vente : buvette, total, consignes, billet scanné, client Tickie, points fidélité).
Stock de départ, stock restant et suivi des tablettes sont gardés dans les propriétés du script.
Colonnes ajoutées à 10_MATCHS : `TICKIE_EVENT_ID`, `MODE_BUVETTE`. L'affluence Tickie est écrite dans la colonne AFFLUENCE existante.
