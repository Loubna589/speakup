# Semaines publiées automatiquement

Chaque fichier `week-N.json` contient les 200 nouvelles cartes de la semaine N (100 expressions + 100 mots) :

```json
{ "week": 2, "items": [ { "k": "expr", "c": "general", "en": "...", "fr": "...", "t": "crutch" } ] }
```

`index.json` liste les semaines disponibles. `c` vaut general (35 %), meetings (30 %), persuade (15 %), marketing (10 %) ou access (10 %). `t` est facultatif : "crutch" (expression béquille) ou "check" (vérifier sa compréhension).

`k` vaut "expr" (expression) ou "word" (mot).
