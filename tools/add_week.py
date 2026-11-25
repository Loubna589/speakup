"""Ajoute une semaine d'expressions à l'app (utilisé par la tâche automatique hebdomadaire).

Usage :
    python tools/add_week.py next-week          -> affiche le numéro de la prochaine semaine
    python tools/add_week.py existing           -> affiche toutes les expressions anglaises déjà dans l'app
    python tools/add_week.py add brouillon.json -> vérifie le brouillon et l'ajoute comme semaine suivante

Le brouillon est un tableau JSON d'objets {"c", "en", "fr", "t"?}.
Le script refuse les doublons, les catégories inconnues et un total trop faible,
puis écrit weeks/week-N.json, met à jour weeks/index.json et la version du cache (sw.js).
"""
import json, os, re, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEEKS = os.path.join(ROOT, 'weeks')
CATS = {'general': 35, 'meetings': 30, 'persuade': 15, 'marketing': 10, 'access': 10}
BUILTIN_WEEKS = 1
MIN_ITEMS = 90


def norm(s):
    s = s.lower().replace('’', "'").replace('‘', "'").replace('…', ' ').replace('...', ' ')
    s = re.sub(r"[^a-z0-9' ]+", ' ', s).replace("'", '')
    return re.sub(r'\s+', ' ', s).strip()


def load_index():
    p = os.path.join(WEEKS, 'index.json')
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {'weeks': []}


def existing():
    data = open(os.path.join(ROOT, 'data.js'), encoding='utf-8').read()
    block = data[data.index('const EXPRESSIONS'):data.index('const ACCENTS')]
    out = re.findall(r'en: "(.*?)"', block)
    for w in load_index()['weeks']:
        out += [x['en'] for x in json.load(open(os.path.join(WEEKS, f'week-{w}.json'), encoding='utf-8'))['items']]
    return out


def next_week():
    weeks = load_index()['weeks']
    return max([BUILTIN_WEEKS] + weeks) + 1


def add(path):
    items = json.load(open(path, encoding='utf-8'))
    assert isinstance(items, list), 'Le brouillon doit être un tableau JSON.'
    seen = {norm(e) for e in existing()}
    keep, rejected = [], []
    for x in items:
        if not isinstance(x, dict) or x.get('c') not in CATS or not str(x.get('en', '')).strip() or not str(x.get('fr', '')).strip():
            rejected.append((x, 'format')); continue
        k = norm(x['en'])
        if not k or k in seen:
            rejected.append((x.get('en'), 'doublon')); continue
        seen.add(k)
        item = {'c': x['c'], 'en': x['en'].strip(), 'fr': x['fr'].strip()}
        if x.get('t') in ('crutch', 'check'):
            item['t'] = x['t']
        keep.append(item)
    for r in rejected:
        print('rejeté :', r)
    if len(keep) < MIN_ITEMS:
        sys.exit(f'ÉCHEC : seulement {len(keep)} expressions valides (minimum {MIN_ITEMS}). Complète le brouillon et relance.')
    w = next_week()
    os.makedirs(WEEKS, exist_ok=True)
    json.dump({'week': w, 'created': datetime.date.today().isoformat(), 'items': keep},
              open(os.path.join(WEEKS, f'week-{w}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    idx = load_index(); idx['weeks'] = sorted(set(idx['weeks'] + [w]))
    json.dump(idx, open(os.path.join(WEEKS, 'index.json'), 'w', encoding='utf-8'), indent=2)
    sw = os.path.join(ROOT, 'sw.js')
    txt = open(sw, encoding='utf-8').read()
    txt = re.sub(r"const VERSION = '[^']*';", f"const VERSION = 'speakup-week-{w}';", txt)
    open(sw, 'w', encoding='utf-8').write(txt)
    counts = {c: sum(1 for i in keep if i['c'] == c) for c in CATS}
    print(f'OK : semaine {w} ajoutée avec {len(keep)} expressions {counts}')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'next-week':
        print(next_week())
    elif cmd == 'existing':
        print('\n'.join(existing()))
    elif cmd == 'add' and len(sys.argv) > 2:
        add(sys.argv[2])
    else:
        print(__doc__)
