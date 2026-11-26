# Tâche automatique : 100 expressions + 100 mots chaque semaine

À créer sur https://claude.ai/code/routines → « New routine ».

- **Nom** : Speak Up : 100 expressions + 100 mots chaque semaine
- **Dépôt** : Loubna589/speakup
- **Quand** : chaque mardi à 19 h (heure de Paris)
- **Modèle** : Claude Sonnet 5.5
- **Connecteurs** : aucun

## Instructions à copier-coller

Tu ajoutes la semaine suivante de cartes à « Speak Up », une app web (type Quizlet) d'anglais professionnel hébergée sur GitHub Pages depuis ce dépôt (branche main). La personne qui l'utilise est une Française qui travaille dans le marketing pharmaceutique / medtech (ophtalmologie, lancements de produits, market access). Elle travaille en anglais avec les filiales du Royaume-Uni, d'Espagne et des Pays-Bas. Son objectif : se débrouiller à l'oral en réunion, comprendre et répondre spontanément (niveau B1-B2). L'écrit n'est pas sa priorité.

Étapes :
1. Lis weeks/README.md et tools/add_week.py. Lance `python tools/add_week.py next-week` pour connaître le numéro N de la semaine à créer, et `python tools/add_week.py existing` pour voir TOUTES les cartes déjà présentes.
2. Écris dans /tmp/brouillon.json un tableau JSON de 200 NOUVELLES cartes {"k", "c", "en", "fr", "t"?} :
   - 100 EXPRESSIONS ("k": "expr") utiles à l'oral : phrase courte ou début de phrase avec « … ».
   - 100 MOTS ("k": "word") : mots ou termes clés (ex. "a stakeholder", "lead time", "a rebate", "to roll out" ; verbes précédés de "to", noms avec "a/an" quand c'est naturel).
   - Pour CHAQUE type, catégories "c" : general 35 (vie au travail, fluidité, béquilles, small talk, visio), meetings 30 (réunions, vérifier sa compréhension, organiser, répartir les tâches, relances), persuade 15 (argumenter, nuancer, négocier, défendre une idée face à quelqu'un de plus à l'aise), marketing 10 (marque, campagnes, cibles, lancement, KPI, se présenter), access 10 (market access, remboursement, prix, HTA, payeurs, NICE, HAS).
   - "t" facultatif, seulement pour les expressions : "crutch" pour une expression béquille, "check" pour vérifier sa compréhension.
   - Anglais naturel, tel qu'on le dit vraiment au travail (britannique de préférence). Français : traduction naturelle et utile dans son métier, tutoiement, au féminin si la locutrice parle d'elle.
   - Progression : semaine N, donc de plus en plus riche et varié, tout en restant directement utilisable en réunion.
   - Aucune carte déjà présente, ni quasi-répétition.
3. Lance `python tools/add_week.py add /tmp/brouillon.json`. S'il refuse des cartes (doublons, format) ou s'il en manque, corrige le brouillon et relance jusqu'à obtenir « OK : semaine N ajoutée ».
4. Ne modifie aucun autre fichier que ceux que le script écrit (weeks/week-N.json, weeks/index.json, sw.js).
5. Commit sur main avec le message « Semaine N : 100 expressions + 100 mots », puis `git push origin main`. Ne crée pas de branche ni de pull request : l'app est servie directement depuis main.

Si la semaine N existe déjà (le script la compte dans index.json), ne fais rien de plus.
