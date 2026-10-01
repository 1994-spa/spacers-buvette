# Pilotage buvette — mise en place (une fois par saison)

1. **Créer le Google Sheet de pilotage** (nouveau fichier, ex. « Pilotage buvette 26-27 »).
2. **Extensions → Apps Script**, coller `Pilotage.gs` à la place du code par défaut, enregistrer.
3. **Paramètres du projet → Propriétés du script** : ajouter `VIVENU_API_KEY` = la clé API Vivenu (la même que le relais tickie-proxy).
   Vérifier que le fuseau horaire du projet est `Europe/Paris` (Paramètres du projet).
4. Recharger le Sheet → menu **Pilotage buvette → Initialiser les onglets** (crée VENTES, STOCK_LIVE et le jeton, affiché à l'écran).
5. **Déployer → Nouveau déploiement → Application Web** : exécuter en tant que *moi*, accès *Tout le monde*. Copier l'URL `…/exec`.
6. Ouvrir `https://spacers-buvette.spacersytb.workers.dev/pilotage.html`, coller l'URL et le jeton.
   En bas du tableau de bord : un lien de configuration par buvette, à envoyer aux bénévoles (il règle la tablette d'un clic).

## Après chaque match
- Menu **Pilotage buvette → Relier les ventes aux acheteurs** : complète la colonne « Client CRM (id) » à partir des billets scannés.
- Sur chaque tablette : Rapport de caisse → Envoyer au Sheet, puis ⚙️ → **Nouveau match** pour remettre les compteurs à zéro.

## Données
- La tablette n'envoie que : identifiant du billet, code-barres, tarif. Ni nom ni email.
- Le tableau de bord ne reçoit que des totaux.
- Mettre à jour la mention d'information RGPD (affichage buvette / politique de confidentialité) : le scan du billet à la buvette sert à mesurer la consommation par profil de spectateur et alimente le programme de fidélité.
