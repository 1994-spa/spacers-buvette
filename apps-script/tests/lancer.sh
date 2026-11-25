#!/bin/sh
# Rejoue les tests des parties de Pilotage.gs et Fidelite.gs qui peuvent l'être hors
# d'Apps Script : les services Google (feuilles, cache, verrous, propriétés, UrlFetch)
# sont remplacés par des doubles en mémoire, et le fichier de production est chargé tel
# quel. Les tests échouent donc si le code livré change de comportement.
#
#   sh apps-script/tests/lancer.sh
#
# Fidelite.gs n'est pas dans le depot : le test le cherche dans a_coller/ ou via FIDELITE_GS.
# celle qui a été testée. Si tu modifies celle du projet Apps Script, remplace-la ici.
cd "$(dirname "$0")" || exit 1
echo "=== Cache en tranches ==="      && node cache-en-tranches.test.js   || exit 1
echo && echo "=== Liaison des billets ===" && node liaison-billets.test.js    || exit 1
echo && echo "=== Fidélité par lot ==="     && node fidelite-par-lot.test.js  || exit 1
echo && echo "Tous les tests passent."
