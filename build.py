# Assemble l'app en un seul fichier (publication/speakup.html) pour la mise en ligne.
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
css = open('style.css', encoding='utf-8').read()
html = open('index.html', encoding='utf-8').read()
body = html[html.index('<header'):html.index('<script')]
data = open('data.js', encoding='utf-8').read()
app = open('app.js', encoding='utf-8').read()
assert '</script' not in data + app
out = ('<title>Speak Up</title>\n<style>\n:root{color-scheme:light}\n' + css + '\n</style>\n' + body +
       '<script>\n' + data + '\n</script>\n<script>\n' + app + '\n</script>\n')
os.makedirs('publication', exist_ok=True)
open('publication/speakup.html', 'w', encoding='utf-8').write(out)
print('publication/speakup.html', len(out), 'octets')
