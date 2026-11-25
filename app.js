'use strict';
// =====================================================================
//  Speak Up — app d'anglais oral pro (100 % local, aucune donnée envoyée
//  hors du navigateur à part la reconnaissance vocale du navigateur).
// =====================================================================

const BUILTIN_WEEKS = 1; // semaines fournies avec l'app (108 expressions) ; les suivantes sont générées
const SPEEDS = [
  { k: 'slow',   label: 'Lent',   rate: 0.75 },
  { k: 'normal', label: 'Normal', rate: 1.0 },
  { k: 'fast',   label: 'Rapide', rate: 1.25 },
];
// Nombre d'exercices de chaque type par séance (≥ 50 % d'oral à chaque fois)
const PLANS = {
  6:  { listen: 1, quick: 1, shadow: 1, speak: 1, mcq: 1, gap: 1 },
  10: { listen: 2, quick: 2, shadow: 2, speak: 1, mcq: 2, gap: 1 },
  14: { listen: 3, quick: 3, shadow: 2, speak: 2, mcq: 2, gap: 2 },
};
const TYPES = {
  listen: { label: '🎧 Écoute de réunion', oral: true },
  quick:  { label: '⚡ Réponse rapide',    oral: true },
  shadow: { label: '🔁 Écoute & répète',   oral: true },
  speak:  { label: '🎙 Dis-le en anglais', oral: true },
  mcq:    { label: '✍️ QCM',               oral: false },
  gap:    { label: '✍️ Texte à trous',     oral: false },
};

// ---------------------------------------------------------------- utils
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const stripMarks = s => s.replace(/\[\[|\]\]/g, '');
const markHtml = s => esc(s).replace(/\[\[(.+?)\]\]/g, '<mark>$1</mark>');
function norm(s) {
  return stripMarks(s).toLowerCase().replace(/[’‘]/g, "'").replace(/…|\.\.\./g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
}
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
function weightedPick(items, wfn) {
  const ws = items.map(wfn); const tot = ws.reduce((a, b) => a + b, 0);
  if (!tot) return pick(items);
  let r = Math.random() * tot;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600); }

// ---------------------------------------------------------------- state
const KEY = 'speakup-v1';
const DEFAULT = () => ({
  settings: { startDate: todayISO(), weekOverride: null, timer: 7, sitLang: 'mix', accentVoices: false, autoVoice: false, sessionLen: 10, recogLang: 'en-GB', cardDir: 'fr-en' },
  expr: {}, dlg: {}, sessions: [], gen: {}, updatedAt: 0,
});
let S;
try { S = Object.assign(DEFAULT(), JSON.parse(localStorage.getItem(KEY) || '{}')); S.settings = Object.assign(DEFAULT().settings, S.settings); }
catch { S = DEFAULT(); }
if (!S.settings.v2) { S.settings.accentVoices = false; S.settings.autoVoice = false; S.settings.v2 = true; }
if (!S.gen) S.gen = {};
if (!S.daily) S.daily = {};

// ---------------------------------------------------- objectif quotidien & série
// Chaque carte, question ou exercice compte pour 1 (un dialogue réussi compte pour 3).
const goal = () => S.settings.dailyGoal || 30;
const doneToday = () => S.daily[todayISO()] || 0;
function streak() {
  let k = todayISO(), n = 0;
  if ((S.daily[k] || 0) < goal()) k = addDays(k, -1); // aujourd'hui pas encore fini : la série reste en vie
  while ((S.daily[k] || 0) >= goal()) { n++; k = addDays(k, -1); }
  return n;
}
function bumpDaily(n = 1) {
  const k = todayISO(), before = S.daily[k] || 0;
  S.daily[k] = before + n;
  if (before < goal() && S.daily[k] >= goal()) setTimeout(() => toast(`🎯 Objectif du jour atteint ! Série : ${streak()} jour${streak() > 1 ? 's' : ''} 🔥`), 60);
  updateGoalChip();
}
function updateGoalChip() {
  const c = document.getElementById('goalChip'); if (!c) return;
  const d = doneToday(), g = goal(), st = streak();
  c.innerHTML = `<span class="flame ${st ? 'on' : ''}">🔥 ${st}</span><span class="gbar"><i style="width:${Math.min(100, d / g * 100)}%"></i></span><span>${Math.min(d, g)}/${g}</span>`;
  c.classList.toggle('done', d >= g);
  c.title = `Objectif du jour : ${d}/${g} · série de ${st} jour(s)`;
}
function weekChart() {
  const g = goal(), days = Array.from({ length: 7 }, (_, i) => addDays(todayISO(), i - 6));
  const max = Math.max(g, ...days.map(k => S.daily[k] || 0));
  const names = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  return `<div class="chart" style="--g:${(g / max).toFixed(3)}">${days.map(k => { const n = S.daily[k] || 0; return `<div class="col" title="${n} le ${k}"><span class="n">${n || ''}</span><div class="barbox"><i class="${n >= g ? 'ok' : ''}" style="height:${n / max * 100}%"></i></div><span class="d ${k === todayISO() ? 'today' : ''}">${names[new Date(k + 'T12:00:00').getDay()]}</span></div>`; }).join('')}<div class="goal-line"><span>objectif ${g}</span></div></div>`;
}
let dirty = false;
const save = () => { S.updatedAt = Date.now(); dirty = true; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} scheduleSync(); };

// Les semaines avancent toutes seules, sans fin : 1 semaine = 7 jours depuis la date de début.
function autoWeek() {
  const days = Math.floor((Date.now() - new Date(S.settings.startDate).getTime()) / 864e5);
  return Math.max(1, Math.floor(days / 7) + 1);
}
function currentWeek() { return S.settings.weekOverride ? Math.max(1, S.settings.weekOverride) : autoWeek(); }
const maxContentWeek = () => Math.max(BUILTIN_WEEKS, ...Object.keys(S.gen).map(Number));
const weekCount = () => Math.max(currentWeek(), maxContentWeek());
const hasWeek = w => w <= BUILTIN_WEEKS || !!(S.gen[w] && S.gen[w].length);

// ---------------------------------------------------------- content prep
// Semaines 1 à 3 : contenu intégré. Semaine 4 et suivantes : générées par Claude (version en ligne).
const BUILTIN = EXPRESSIONS.map(e => ({ ...e, id: norm(e.en) }));
for (const c of Object.keys(CATS)) {
  const list = BUILTIN.filter(e => e.c === c);
  const per = Math.ceil(list.length / BUILTIN_WEEKS);
  list.forEach((e, i) => (e.w = Math.floor(i / per) + 1));
}
let EXPR = [], EXPR_BY_ID = {};
function rebuildExpr() {
  const gen = Object.entries(S.gen).flatMap(([w, list]) => (list || []).map(e => ({ ...e, id: norm(e.en), w: Number(w), gen: true })));
  const seen = new Set(); EXPR = [];
  for (const e of [...BUILTIN, ...gen]) if (!seen.has(e.id)) { seen.add(e.id); EXPR.push(e); }
  EXPR_BY_ID = Object.fromEntries(EXPR.map(e => [e.id, e]));
}
rebuildExpr();
const SITS = SITUATIONS.map((s, i) => ({ ...s, id: 's' + i, expr: EXPR_BY_ID[norm(s.target)] || null }));
SITS.forEach(s => { s.w = s.expr ? s.expr.w : 1; if (!s.expr) console.warn('Situation sans expression correspondante :', s.target); });

// ---------------------------------------------------- révision espacée (Leitner)
// Boîte 1 → revoir le lendemain, 2 → 3 jours, 3 → 1 semaine, 4 → 2 semaines, 5 → 1 mois, 6 → 2 mois.
// « Je sais » fait monter d'une boîte ; « À revoir » renvoie en boîte 1.
const INTERVALS = [0, 1, 3, 7, 14, 30, 60];
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const exprStat = id => S.expr[id] || { ok: 0, ko: 0 };
function mastery(id) { const s = exprStat(id); if ((s.box || 0) >= 4 || (s.box === undefined && s.ok >= 2 && s.ok > s.ko)) return 2; if (s.ok + s.ko > 0) return 1; return 0; }
function rateExpr(id, ok) {
  if (!id) return;
  const s = { ...exprStat(id) };
  if (s.box === undefined) s.box = s.ok + s.ko > 0 ? (s.ok > s.ko ? 2 : 1) : 0;
  ok ? s.ok++ : s.ko++;
  bumpDaily(1);
  s.box = ok ? Math.min(INTERVALS.length - 1, s.box + 1) : 1;
  s.due = addDays(todayISO(), INTERVALS[s.box]);
  S.expr[id] = s; save();
}
// Une carte est « à réviser » si on l'a déjà vue et que sa date de révision est passée.
function isDue(e) { const s = S.expr[e.id]; if (!s || s.ok + s.ko === 0) return false; return !s.due || s.due <= todayISO(); }
const dueOld = () => EXPR.filter(e => e.w < currentWeek() && isDue(e)).sort((a, b) => (exprStat(a.id).due || '').localeCompare(exprStat(b.id).due || ''));
const dueAll = () => EXPR.filter(e => e.w <= currentWeek() && isDue(e)).sort((a, b) => (exprStat(a.id).due || '').localeCompare(exprStat(b.id).due || ''));
const dlgStat = id => S.dlg[id] || { level: 0, mastered: false, listens: 0 };
const unlocked = () => EXPR.filter(e => e.w <= currentWeek());

// Poids de tirage : semaine en cours ×3, expressions « à revoir » favorisées
function exprWeight(e) {
  const s = exprStat(e.id);
  let w = e.w === currentWeek() ? 3 : 1;
  w *= 1 + Math.max(0, s.ko - s.ok * 0.5);
  if (isDue(e)) w *= 2;
  if (mastery(e.id) === 2) w *= 0.4;
  return w;
}

// ------------------------------------------- synchronisation (version en ligne)
// Sur la page en ligne, la progression et les semaines générées sont enregistrées
// dans ton espace privé : téléphone et ordinateur partagent la même progression.
const CLOUD = { db: null, uid: null, ready: false, timer: null };
function mergeState(remote) {
  if (!remote) return false;
  let changed = false;
  for (const [id, r] of Object.entries(remote.expr || {})) {
    const l = S.expr[id];
    if (!l || (r.ok + r.ko) > (l.ok + l.ko) || ((r.ok + r.ko) === (l.ok + l.ko) && (r.due || '') > (l.due || ''))) { S.expr[id] = r; changed = true; }
  }
  for (const [id, r] of Object.entries(remote.dlg || {})) {
    const l = S.dlg[id];
    if (!l || (r.mastered && !l.mastered) || (r.level || 0) > (l.level || 0)) { S.dlg[id] = r; changed = true; }
  }
  for (const [k, n] of Object.entries(remote.daily || {})) if ((S.daily[k] || 0) < n) { S.daily[k] = n; changed = true; }
  const dates = new Set(S.sessions.map(s => s.date));
  for (const s of remote.sessions || []) if (!dates.has(s.date)) { S.sessions.push(s); changed = true; }
  S.sessions.sort((a, b) => a.date.localeCompare(b.date)); S.sessions = S.sessions.slice(-200);
  if ((remote.updatedAt || 0) > (S.updatedAt || 0) && remote.settings) { S.settings = Object.assign(S.settings, remote.settings); changed = true; }
  return changed;
}
function scheduleSync() {
  if (!CLOUD.ready) return;
  clearTimeout(CLOUD.timer);
  CLOUD.timer = setTimeout(pushState, 2500);
}
let pushing = false;
async function pushState() {
  if (!CLOUD.ready || pushing || !dirty) return;
  pushing = true; dirty = false;
  try {
    const { gen, ...rest } = S;
    await CLOUD.db.doc(`data/users/${CLOUD.uid}/progress`).set(JSON.parse(JSON.stringify(rest)));
  } catch (e) { dirty = true; console.warn('Synchronisation impossible', e && e.code); }
  pushing = false;
  if (dirty) scheduleSync();
}
async function pushWeek(w) {
  if (!CLOUD.ready) return;
  try { await CLOUD.db.doc(`data/users/${CLOUD.uid}/week-${w}`).set({ week: w, items: S.gen[w] }); } catch (e) { console.warn('Semaine non enregistrée en ligne', e && e.code); }
}
async function initCloud() {
  if (!window.claude || !window.claude.use) return;
  try {
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    if (!db || !user) return;
    const uid = await user.id();
    if (!uid) return;
    const snap = await db.collection(`data/users/${uid}`).get();
    let changed = false;
    for (const d of snap.docs) {
      const data = d.data(); if (!data) continue;
      if (d.id === 'progress') changed = mergeState(data) || changed;
      else if (d.id.startsWith('week-') && Array.isArray(data.items) && !(S.gen[data.week] && S.gen[data.week].length)) { S.gen[data.week] = data.items; changed = true; }
    }
    Object.assign(CLOUD, { db, uid, ready: true });
    if (changed) { rebuildExpr(); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} if (!deckBusy()) render(); }
    // envoie ce qui n'est pas encore en ligne (semaines générées avant la synchro, progression locale)
    const remoteWeeks = new Set(snap.docs.map(d => d.id));
    for (const w of Object.keys(S.gen)) if (!remoteWeeks.has('week-' + w)) await pushWeek(w);
    dirty = true; scheduleSync();
    $('#syncState').textContent = '☁️ synchronisé';
  } catch (e) { console.warn('Synchro indisponible', e && e.code); }
}

// ------------------------------------------- génération des nouvelles semaines
let sampleFn = null;
const sampleReady = (async () => { try { if (window.claude && window.claude.use) sampleFn = await claude.use('sample'); } catch {} return sampleFn; })();
const WEEK_SIZE = 100; // nouvelles expressions par semaine
const PART = 50;       // demandées à Claude par lots de 50 (réponses plus fiables)
function genPrompt(w, n, known) {
  const counts = allocate(n);
  return `Tu prépares la semaine ${w} d'une application de cartes (type Quizlet) pour une Française qui travaille dans le marketing pharmaceutique / medtech (ophtalmologie, lancements de produits, market access). Elle travaille en anglais avec les filiales du Royaume-Uni, d'Espagne et des Pays-Bas. Son objectif : comprendre et parler spontanément en réunion (niveau B1-B2), pas l'écrit.

Écris exactement ${n} NOUVELLES expressions anglaises utiles à l'oral, réparties ainsi :
- "general" (fluidité, expressions « béquilles » pour gagner du temps, small talk, visio) : ${counts.general}
- "meetings" (réunions, vérifier sa compréhension, organiser, répartir les tâches) : ${counts.meetings}
- "persuade" (argumenter, nuancer, négocier, défendre une idée face à quelqu'un de plus à l'aise) : ${counts.persuade}
- "marketing" (se présenter, parler de son travail, de campagnes, de cibles) : ${counts.marketing}
- "access" (market access, remboursement, prix, HTA, payeurs) : ${counts.access}

Règles :
- Anglais naturel et idiomatique, tel qu'on le dit vraiment en réunion ; une expression = une phrase courte ou un début de phrase (avec « … » si elle se complète).
- Le français est une traduction naturelle (tutoiement, au féminin si la locutrice parle d'elle).
- Progression : semaine ${w}, donc des expressions de plus en plus riches et variées.
- N'utilise AUCUNE des expressions déjà apprises ci-dessous, ni une quasi-répétition.
- "t" vaut "crutch" pour une expression béquille, "check" pour vérifier sa compréhension, sinon omets-le.

Réponds uniquement avec un tableau JSON d'objets {"c": "general|meetings|persuade|marketing|access", "en": "...", "fr": "...", "t": "crutch|check"}.

Expressions déjà apprises :
${known.slice(-700).join('\n')}`;
}
async function generateWeek(w, onCount) {
  if (!sampleFn) throw { code: 'unavailable' };
  const have = new Set(EXPR.map(e => e.id)), known = EXPR.map(e => e.en), out = [];
  for (let done = 0; done < WEEK_SIZE; done += PART) {
    const n = Math.min(PART, WEEK_SIZE - done), base = out.length;
    let data;
    try {
      data = await sampleFn.json(genPrompt(w, n, known), { cache: false, onText: ({ text }) => onCount && onCount(base + (text.match(/"en"\s*:/g) || []).length) });
    } catch (e) { if (out.length >= PART * 0.6) break; throw e; } // un lot déjà prêt : on garde ce qu'on a
    if (!Array.isArray(data)) { if (out.length) break; throw { code: 'invalid_json' }; }
    for (const x of data) {
      if (!x || typeof x.en !== 'string' || typeof x.fr !== 'string' || !CATS[x.c]) continue;
      const en = x.en.trim().slice(0, 160), fr = x.fr.trim().slice(0, 200), id = norm(en);
      if (!id || have.has(id)) continue;
      have.add(id); known.push(en);
      out.push({ c: x.c, en, fr, ...(x.t === 'crutch' || x.t === 'check' ? { t: x.t } : {}) });
    }
  }
  if (out.length < 30) throw { code: 'too_few' };
  S.gen[w] = out; rebuildExpr(); save(); pushWeek(w);
  return out;
}
// Carte « nouvelle semaine à préparer » (affichée quand la semaine n'a pas encore de contenu)
function weekGenCard(box, w, after) {
  box.innerHTML = `<div class="card gen"><h2>Semaine ${w} : de nouvelles expressions t'attendent</h2>
    <p>La semaine 1 est fournie avec l'app. À partir de la semaine ${BUILTIN_WEEKS + 1}, Claude prépare ${WEEK_SIZE} nouvelles expressions adaptées à ton travail, sans répéter celles que tu connais déjà.</p>
    <div class="row"><button class="btn primary big" id="genBtn">✨ Préparer la semaine ${w}</button></div>
    <p class="small muted" id="genMsg"></p>
    <p class="small muted">En attendant, l'onglet <b>🔁 Réviser</b> te fait retravailler toutes les semaines précédentes.</p></div>`;
  const btn = $('#genBtn', box), msg = $('#genMsg', box);
  sampleReady.then(fn => { if (!fn) { btn.hidden = true; msg.innerHTML = '📬 <b>Ta semaine ' + w + ' arrive automatiquement</b> : elle est publiée chaque mardi soir. Ouvre l’app avec internet pour la recevoir.'; } });
  btn.onclick = async () => {
    btn.disabled = true; msg.textContent = 'Claude prépare tes expressions… (1 à 2 minutes)';
    let n = 0;
    try {
      const out = await generateWeek(w, k => { if (k !== n) { n = k; msg.textContent = `Claude prépare tes expressions… ${Math.min(k, WEEK_SIZE)}/${WEEK_SIZE}`; } });
      toast(`Semaine ${w} prête : ${out.length} expressions`); after();
    } catch (e) {
      btn.disabled = false;
      msg.textContent = ({ not_granted: 'Tu as refusé l’accès à Claude pour cette page : recharge-la et accepte pour générer la semaine.', rate_limited: 'Limite d’utilisation atteinte. Réessaie un peu plus tard.', too_few: 'La réponse était incomplète. Clique pour réessayer.', invalid_json: 'La réponse était illisible. Clique pour réessayer.', unavailable: 'Fonction disponible uniquement sur la version en ligne.' })[e && e.code] || 'La préparation a échoué. Clique pour réessayer.';
    }
  };
}

// ---------------------------------------------------------- voices (TTS)
let VOICES = [];
const loadVoices = () => { VOICES = speechSynthesis.getVoices(); };
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = () => { loadVoices(); if (route.view === 'settings' || route.view === 'home') render(); }; }

const FEMALE = /\b(female|woman|zira|hazel|susan|libby|sonia|maisie|jenny|aria|ana|emily|natasha|neerja|leah|clara|elvira|ximena|dalia|paloma|fenna|colette|hanna|helena|laura|sabina|karen|moira|tessa|samantha|catherine|veena|heera|serena|fiona|kate|nicky|ava|allison|lekha|ellen|michelle|sara|monica|paulina|martha|zoe|victoria|stephanie|kathy|libby|isha|sonia|maisie|olivia|emma|amy|joanna|salli|kimberly|ivy|kendra)\b/i;
const MALE = /\b(male|man|ryan|guy|thomas|william|connor|prabhat|alvaro|álvaro|jorge|maarten|arnaud|david|mark|george|james|eric|christopher|roger|steffan|brian|liam|daniel|alex|fred|tom|ravi|rishi|oliver|pablo|raul|frank|luca|darren|duncan|elliot|noah|andrew)\b/i;
function guessGender(v) { const n = v.name; if (/female/i.test(n)) return 'f'; if (/\bmale\b/i.test(n)) return 'm'; if (FEMALE.test(n)) return 'f'; if (MALE.test(n)) return 'm'; return '?'; }
function voiceScore(v) { const n = v.name; return (/natural|neural|premium/i.test(n) ? 4 : 0) + (/enhanced|online/i.test(n) ? 2 : 0) + (/google/i.test(n) ? 1 : 0); }
// Voix « gadget » d'Apple (robot, chuchotement, cloches…) : jamais utilisées
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|wobble|good news|jester|organ|superstar|trinoids|whisper|zarvox|junior|ralph|fred|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley|deranged|hysterical|pipe organ)\b/i;
const byLang = l => VOICES.filter(v => v.lang.replace('_', '-').toLowerCase().startsWith(l.toLowerCase()) && !NOVELTY.test(v.name));

function resolveAccent(accent) {
  const a = ACCENTS[accent] || ACCENTS['en-GB'];
  if (a.nonNative && !S.settings.accentVoices) return { ...resolveAccent(a.fb), real: false, wanted: accent };
  for (const l of a.langs) { const vs = byLang(l); if (vs.length) return { voices: vs.sort((x, y) => voiceScore(y) - voiceScore(x)), real: true, wanted: accent }; }
  if (a.fb) return { ...resolveAccent(a.fb), real: false, wanted: accent };
  const en = byLang('en');
  return { voices: en.sort((x, y) => voiceScore(y) - voiceScore(x)), real: false, wanted: accent };
}
function pickVoice(accent, g, idx = 0) {
  const r = resolveAccent(accent);
  let pool = r.voices;
  const pref = S.settings.voiceGender || 'f';
  if (pref !== 'mix') g = pref;
  if (g) { const same = pool.filter(v => guessGender(v) === g); if (same.length) pool = same; }
  return { voice: pool.length ? pool[idx % pool.length] : null, real: r.real };
}

let playToken = 0;
// Voix de Claude (version en ligne) : bien plus naturelles que celles du navigateur.
let ttsCap = null;
const ttsReady = (async () => { try { if (window.claude && window.claude.use) ttsCap = await claude.use('tts'); } catch {} return ttsCap; })();
const TTS_VOICES = ['buttery', 'rounded', 'airy', 'glassy'];
function speak(text, { accent = 'en-GB', rate = 1, g, idx = 0, pitch = 1, voiceN = 0 } = {}) {
  const clean = stripMarks(text);
  if (ttsCap && S.settings.claudeVoice !== false) {
    return ttsCap.speak(clean, { language: 'en', voice: (S.settings.voiceGender || 'f') === 'mix' ? TTS_VOICES[voiceN % TTS_VOICES.length] : ['buttery', 'airy', 'glassy'][voiceN % 3], rate: Math.max(0.7, Math.min(1.5, rate)) }).catch(() => {});
  }
  return new Promise(res => {
    if (!('speechSynthesis' in window)) return res();
    const { voice } = pickVoice(accent, g, idx);
    const u = new SpeechSynthesisUtterance(clean);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB';
    u.rate = rate; u.pitch = pitch;
    let done = false;
    const fin = () => { if (!done) { done = true; clearTimeout(t); res(); } };
    u.onend = fin; u.onerror = fin;
    const t = setTimeout(fin, 3000 + clean.length * 110 / rate);
    speechSynthesis.speak(u);
  });
}
function stopSpeech() { playToken++; try { ttsCap && ttsCap.stop(); } catch {} if ('speechSynthesis' in window) speechSynthesis.cancel(); }
const randomAccent = () => pick(Object.keys(ACCENTS).filter(k => S.settings.accentVoices || !ACCENTS[k].nonNative));
// Lecture automatique seulement si activée dans les réglages
const autoSpeak = (text, opts) => { if (S.settings.autoVoice) speak(text, opts); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// ----------------------------------------------------- speech recognition
// Dans une page intégrée (lien claude.ai), le micro est bloqué : on désactive la reconnaissance
const IN_FRAME = (() => { try { return window.self !== window.top; } catch { return true; } })();
const SR = IN_FRAME ? null : (window.SpeechRecognition || window.webkitSpeechRecognition);
let activeRec = null;
function listen(maxMs = 9000, onUpdate) {
  if (!SR) return null;
  stopListening();
  const r = new SR();
  r.lang = S.settings.recogLang; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
  let text = '';
  const ctrl = { error: null, stop: () => { try { r.stop(); } catch {} } };
  ctrl.promise = new Promise(res => {
    r.onresult = e => { text = ''; for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript + ' '; text = text.trim(); onUpdate && onUpdate(text); };
    r.onerror = e => { ctrl.error = e.error; };
    r.onend = () => { if (activeRec === ctrl) activeRec = null; clearTimeout(ctrl.t); res(text); };
  });
  try { r.start(); } catch (e) { ctrl.error = 'start'; }
  ctrl.t = setTimeout(ctrl.stop, maxMs);
  activeRec = ctrl;
  return ctrl;
}
function stopListening() { if (activeRec) activeRec.stop(); }
function similarity(said, target) {
  const tw = norm(target).split(' ').filter(Boolean);
  const sw = new Set(norm(said).split(' '));
  if (!tw.length) return 0;
  return tw.filter(w => sw.has(w)).length / tw.length;
}
// Cherche, parmi les expressions débloquées, celles réellement prononcées
function detectExpressions(said) {
  return unlocked().map(e => ({ e, s: similarity(said, e.en) })).filter(x => x.s >= 0.8 && norm(x.e.en).split(' ').length >= 2).sort((a, b) => b.s - a.s).slice(0, 3).map(x => x.e);
}

// Widget micro réutilisable
function micWidget(el, { target, maxMs = 9000, label = '🎙 Parler', onResult } = {}) {
  if (!SR) {
    el.innerHTML = `<div class="feedback info small">Micro non disponible dans ce navigateur. Ouvre l'app dans <b>Microsoft Edge</b> ou <b>Chrome</b> pour la reconnaissance vocale. En attendant : dis-le à voix haute, puis auto-évalue-toi.</div>`;
    return;
  }
  el.innerHTML = `<div class="mic"><button class="btn primary">${label}</button><div class="live"></div><div class="res"></div></div>`;
  const btn = $('button', el), live = $('.live', el), res = $('.res', el);
  let ctrl = null;
  btn.onclick = async () => {
    if (ctrl) { ctrl.stop(); return; }
    stopSpeech();
    res.innerHTML = ''; live.textContent = '…';
    btn.classList.add('rec'); btn.textContent = '⏺ J’écoute… (clique pour arrêter)';
    ctrl = listen(maxMs, t => (live.textContent = '« ' + t + ' »'));
    const said = await ctrl.promise;
    const err = ctrl.error; ctrl = null;
    btn.classList.remove('rec'); btn.textContent = '🎙 Réessayer';
    if (!said) { live.textContent = err === 'not-allowed' ? 'Accès au micro refusé : autorise-le dans le navigateur.' : 'Je n’ai rien entendu. Réessaie en parlant plus près du micro.'; onResult && onResult('', 0); return; }
    live.textContent = 'Tu as dit : « ' + said + ' »';
    if (target) {
      const s = similarity(said, target);
      res.innerHTML = `<div class="meter"><i style="width:${Math.round(s * 100)}%"></i></div><div class="small muted">${Math.round(s * 100)} % des mots de l'expression reconnus${s >= 0.8 ? ' — bravo !' : s >= 0.5 ? ' — presque !' : ''}</div>`;
      onResult && onResult(said, s);
    } else onResult && onResult(said, null);
  };
}

// --------------------------------------------------------------- routing
const route = { view: 'cards' };
let cleanup = [];
function go(view, params = {}) { Object.assign(route, { view, ...params }); render(); window.scrollTo(0, 0); }
function teardown() { stopSpeech(); stopListening(); cleanup.forEach(f => f()); cleanup = []; }
function render() {
  teardown(); deckProgress = false; updateBadge();
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === route.view || (route.view === 'session' && b.dataset.view === 'home')));
  const v = $('#view');
  ({ cards: viewCards, review: viewReview, write: viewWrite, home: viewHome, listen: viewListen, dialogue: viewDialogue, quick: viewQuick, expr: viewExpr, settings: viewSettings, session: viewSession }[route.view] || viewHome)(v);
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.view); });

const catChip = c => `<span class="chip" style="background:${CATS[c].color}1a;color:${CATS[c].color}">${esc(CATS[c].short)}</span>`;
const accentTag = a => `${ACCENTS[a].flag} ${esc(ACCENTS[a].label)}`;
function exprRow(e, accent) {
  return `<div class="expr"><span class="dot l${mastery(e.id)}" title="maîtrise"></span><div class="txt"><div class="en">${esc(e.en)}</div><div class="fr">${esc(e.fr)}</div></div>${catChip(e.c)}<button class="icon" data-say="${esc(e.en)}" data-accent="${accent || ''}" title="Écouter">▶</button></div>`;
}
// Délégation : tout bouton data-say lit le texte
document.addEventListener('click', e => {
  const b = e.target.closest('[data-say]'); if (!b) return;
  stopSpeech(); speak(b.dataset.say, { accent: b.dataset.accent || 'en-GB', rate: Number(b.dataset.rate || 0.95) });
});

// ================================================================== HOME
function viewHome(v) {
  const w = currentWeek(), n = S.settings.sessionLen, plan = PLANS[n];
  const oral = Object.entries(plan).reduce((a, [t, k]) => a + (TYPES[t].oral ? k : 0), 0);
  const weekExpr = EXPR.filter(e => e.w === w);
  const mastered = EXPR.filter(e => mastery(e.id) === 2).length;
  const dlgDone = DIALOGUES.filter(d => dlgStat(d.id).mastered).length;
  const kit = EXPR.filter(e => e.t === 'crutch').slice(0, 8);
  const catsBar = Object.entries(CATS).map(([k, c]) => `<i style="width:${c.weight}%;background:${c.color}"></i>`).join('');
  const legend = Object.entries(CATS).map(([k, c]) => `<span><i style="background:${c.color}"></i>${esc(c.label)} ${c.weight} %</span>`).join('');
  const noEn = VOICES.length && !byLang('en').length;
  v.innerHTML = `
    ${noEn ? `<div class="feedback ko" style="margin-bottom:14px">Aucune voix anglaise n'est installée dans ce navigateur : les dialogues seront mal prononcés. Ouvre l'app dans <b>Microsoft Edge</b> (voix « Natural » incluses) ou ajoute une voix anglaise dans Paramètres Windows → Heure et langue → Voix.</div>` : ''}
    <div class="card hero">
      <div class="row between"><h1>Semaine ${w}</h1>
        <div class="row"><button class="btn small" id="wPrev">‹</button><span class="small">semaine ${w}</span><button class="btn small" id="wNext">›</button></div></div>
      <p class="sub">Objectif : comprendre à vitesse réelle et répondre spontanément en réunion.</p>
      <button class="btn primary big" id="start">▶ Démarrer la séance — ${n} exercices, dont ${oral} à l'oral</button>
      <div style="margin-top:14px"><div class="bar">${catsBar}</div><div class="legend" style="color:#c9ccd1">${legend}</div></div>
    </div>
    <div class="grid">
      <button class="tile" data-go="listen"><b>🎧 Dialogues de réunion</b><span class="muted small">${DIALOGUES.length} dialogues, 7 accents, vitesse progressive · ${dlgDone} maîtrisé(s)</span></button>
      <button class="tile" data-go="quick"><b>⚡ Réponse rapide</b><span class="muted small">Une situation, ${S.settings.timer} secondes pour répondre à voix haute</span></button>
      <button class="tile" data-go="expr"><b>📚 Expressions</b><span class="muted small">${EXPR.length} expressions · ${mastered} maîtrisées</span></button>
    </div>
    <div class="card"><h3>🛟 Kit de survie : si tu bloques, dis…</h3>${kit.map(e => exprRow(e)).join('')}</div>
    <div class="card"><div class="row between"><h3>Expressions de la semaine ${w} (${weekExpr.length})</h3><button class="btn small" id="playWeek">▶ Tout écouter</button></div>
      ${Object.keys(CATS).map(c => weekExpr.filter(e => e.c === c).map(e => exprRow(e)).join('')).join('')}</div>
    <p class="small muted">${S.sessions.length} séance(s) terminée(s)${S.sessions.length ? ' · dernière : ' + new Date(S.sessions[S.sessions.length - 1].date).toLocaleDateString('fr-FR') : ''}</p>`;
  $('#start').onclick = () => go('session', { session: buildSession() });
  $$('[data-go]', v).forEach(b => (b.onclick = () => go(b.dataset.go)));
  $('#wPrev').onclick = () => { S.settings.weekOverride = Math.max(1, w - 1); save(); render(); };
  $('#wNext').onclick = () => { S.settings.weekOverride = w + 1; save(); render(); };
  $('#playWeek').onclick = async () => {
    stopSpeech(); const tok = playToken;
    for (const e of weekExpr) { if (tok !== playToken) return; await speak(e.en, { accent: randomAccent(), rate: 0.95 }); await wait(700); }
  };
}

// ============================================================ DIALOGUES
function viewListen(v) {
  const accents = d => [...new Set(Object.values(d.speakers).map(s => s.accent))].map(a => ACCENTS[a].flag).join(' ');
  v.innerHTML = `<h1>🎧 Dialogues de réunion</h1>
    <p class="sub">Écoute d'abord <b>sans la transcription</b>. Réponds aux questions : si tout est juste, la vitesse monte (lent → normal → rapide). Objectif : tout comprendre en <b>rapide</b>.</p>
    ${DIALOGUES.map(d => { const st = dlgStat(d.id); return `
      <div class="card row between" style="cursor:pointer" data-d="${d.id}">
        <div><div class="row">${catChip(d.c)} <span class="small">${accents(d)}</span></div><h3 style="margin:6px 0 2px">${esc(d.title)}</h3><div class="small muted">${esc(d.context)}</div></div>
        <span class="chip ${st.mastered ? 'oral' : ''}">${st.mastered ? '✓ Maîtrisé' : 'Niveau : ' + SPEEDS[st.level].label}</span>
      </div>`; }).join('')}`;
  $$('[data-d]', v).forEach(c => (c.onclick = () => go('dialogue', { dlgId: c.dataset.d })));
}
function viewDialogue(v) {
  const d = DIALOGUES.find(x => x.id === route.dlgId) || DIALOGUES[0];
  v.innerHTML = `<button class="btn small" id="back">← Tous les dialogues</button><div id="dlg" style="margin-top:12px"></div>`;
  $('#back').onclick = () => go('listen');
  dialogueWidget($('#dlg'), d);
}

function dialogueWidget(el, d, { onDone } = {}) {
  const st = dlgStat(d.id);
  let speed = st.level, checked = false, answers = {};
  // voix : index par accent pour différencier deux personnes du même accent
  const counters = {}; const voiceOf = {};
  for (const [name, s] of Object.entries(d.speakers)) { const k = s.accent + s.g; counters[k] = (counters[k] || 0); voiceOf[name] = { accent: s.accent, g: s.g, idx: counters[k], pitch: counters[k] ? 0.92 : 1, voiceN: Object.keys(voiceOf).length }; counters[k]++; }
  const qs = d.questions.map(q => { const order = shuffle(q.opts.map((o, i) => i)); return { ...q, order }; });

  el.innerHTML = `
    <div class="card">
      <div class="row">${catChip(d.c)}<span class="chip oral">oral</span></div>
      <h2 style="margin:8px 0 4px">${esc(d.title)}</h2>
      <p class="muted small" style="margin:0">${esc(d.context)}</p>
      <div class="speakers">${Object.entries(d.speakers).map(([n, s]) => { const pv = pickVoice(s.accent, s.g); return `<div class="spk" data-spk="${esc(n)}">${esc(n)} — ${esc(s.role)}<small>${accentTag(s.accent)}${pv.real ? '' : ' (voix approchée)'}</small></div>`; }).join('')}</div>
      <div class="row between" style="margin-top:6px">
        <div class="seg" id="speeds">${SPEEDS.map((s, i) => `<button data-sp="${i}">${s.label}</button>`).join('')}</div>
        <span class="small muted">Mode progressif : <b>${st.mastered ? 'maîtrisé ✓' : SPEEDS[st.level].label}</b></span>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" id="play">▶ Écouter</button>
        <button class="btn" id="chain">⏩ Enchaîner lent → normal → rapide</button>
        <button class="btn" id="stop">⏹ Stop</button>
      </div>
      <div class="now" id="now" style="margin-top:8px"></div>
    </div>
    <div class="card"><h3>Questions de compréhension</h3>
      ${qs.map((q, qi) => `<div class="q" data-q="${qi}"><p>${esc(q.q)}</p>${q.order.map(oi => `<button class="opt" data-o="${oi}">${esc(q.opts[oi])}</button>`).join('')}</div>`).join('')}
      <button class="btn primary" id="check">Vérifier</button>
      <div id="qres"></div>
    </div>
    <div class="card"><h3>🎙 À toi : vérifie ta compréhension avant de donner ton avis</h3>
      <p style="margin:0 0 6px">${esc(d.reformulate.fr)}</p>
      <p class="small muted" style="margin:0">Commence par « Just to make sure I understand… », « So what you're saying is… » ou « If I understood correctly… »</p>
      <div id="mic"></div>
      <button class="btn small" id="model" style="margin-top:10px">Voir un exemple</button>
      <div id="modelBox"></div>
    </div>
    <div class="card"><div class="row between"><h3>Transcription</h3><button class="btn small" id="tr">${'Afficher'}</button></div>
      <div class="transcript" id="trBox" hidden>${d.lines.map(([n, t], i) => `<div class="line" data-l="${i}"><b>${esc(n)}</b>${markHtml(t)}</div>`).join('')}
      <p class="small muted">Clique sur une réplique pour la réécouter. Les expressions surlignées sont à réutiliser.</p></div>
    </div>
    ${onDone ? `<button class="btn primary big" id="next" disabled>Continuer →</button>` : ''}`;

  const setSpeed = i => { speed = i; $$('#speeds button', el).forEach(b => b.classList.toggle('on', Number(b.dataset.sp) === i)); };
  setSpeed(speed);
  $$('#speeds button', el).forEach(b => (b.onclick = () => setSpeed(Number(b.dataset.sp))));
  const now = $('#now', el);
  const highlight = name => $$('.spk', el).forEach(s => s.classList.toggle('talking', s.dataset.spk === name));

  async function playAll(rateIdx, tok, prefix = '') {
    for (const [name, text] of d.lines) {
      if (tok !== playToken) return false;
      highlight(name); now.textContent = `${prefix}🔊 ${name} parle… (${SPEEDS[rateIdx].label})`;
      await speak(text, { ...voiceOf[name], rate: SPEEDS[rateIdx].rate });
      await wait(rateIdx === 2 ? 150 : 350);
    }
    return true;
  }
  const finishPlay = ok => { highlight(null); if (ok) { now.textContent = 'Fin du dialogue. Réponds aux questions ↓'; const s = dlgStat(d.id); s.listens++; S.dlg[d.id] = s; save(); } };
  $('#play', el).onclick = async () => { stopSpeech(); const tok = playToken; finishPlay(await playAll(speed, tok)); };
  $('#chain', el).onclick = async () => {
    stopSpeech(); const tok = playToken; let ok = true;
    for (let i = 0; i < 3 && ok; i++) { setSpeed(i); ok = await playAll(i, tok, `Écoute ${i + 1}/3 · `); if (ok && i < 2) { now.textContent = 'Pause… vitesse suivante'; await wait(1500); } }
    finishPlay(ok);
  };
  $('#stop', el).onclick = () => { stopSpeech(); highlight(null); now.textContent = ''; };
  $$('.line', el).forEach(l => (l.onclick = () => { stopSpeech(); const [n, t] = d.lines[l.dataset.l]; highlight(n); speak(t, { ...voiceOf[n], rate: SPEEDS[speed].rate }).then(() => highlight(null)); }));
  $('#tr', el).onclick = () => { const b = $('#trBox', el); b.hidden = !b.hidden; $('#tr', el).textContent = b.hidden ? 'Afficher' : 'Masquer'; };

  $$('.q', el).forEach(qel => $$('.opt', qel).forEach(o => (o.onclick = () => {
    if (checked) return; answers[qel.dataset.q] = Number(o.dataset.o);
    $$('.opt', qel).forEach(x => x.classList.toggle('sel', x === o));
  })));
  $('#check', el).onclick = () => {
    if (checked) { // recommencer
      checked = false; answers = {}; $$('.opt', el).forEach(o => (o.className = 'opt')); $('#qres', el).innerHTML = ''; $('#check', el).textContent = 'Vérifier'; return;
    }
    if (Object.keys(answers).length < qs.length) { toast('Réponds aux 3 questions d’abord'); return; }
    checked = true;
    let good = 0;
    qs.forEach((q, qi) => { const qel = $(`[data-q="${qi}"]`, el); $$('.opt', qel).forEach(o => { const oi = Number(o.dataset.o); if (oi === q.a) o.classList.add('right'); else if (oi === answers[qi]) o.classList.add('wrong'); }); if (answers[qi] === q.a) good++; });
    const s = dlgStat(d.id); let msg;
    if (good === qs.length) {
      if (speed >= s.level) {
        if (speed === 2) { s.mastered = true; msg = '🎉 3/3 en vitesse rapide : dialogue maîtrisé à vitesse réelle !'; }
        else { s.level = speed + 1; msg = `3/3 ✓ Niveau suivant débloqué : prochaine écoute en vitesse <b>${SPEEDS[s.level].label}</b>.`; setSpeed(s.level); }
      } else msg = `3/3 ✓ Essaie maintenant en vitesse ${SPEEDS[s.level].label} pour progresser.`;
      $('#qres', el).innerHTML = `<div class="feedback ok">${msg}</div>`;
    } else {
      msg = `${good}/3. Réécoute à la même vitesse, puis réessaie. Astuce : ouvre la transcription seulement après une 2e écoute.`;
      $('#qres', el).innerHTML = `<div class="feedback ko">${msg}</div>`;
    }
    S.dlg[d.id] = s; bumpDaily(3); save();
    $('#check', el).textContent = 'Recommencer les questions';
    el._score = good / qs.length;
    const nx = $('#next', el); if (nx) nx.disabled = false;
  };

  micWidget($('#mic', el), { target: d.reformulate.model, maxMs: 15000, onResult: said => {
    if (!said) return;
    const found = detectExpressions(said).filter(e => e.t === 'check');
    if (found.length) $('#mic .res', el).insertAdjacentHTML('beforeend', `<div class="feedback ok small">Expression de vérification utilisée : « ${esc(found[0].en)} » ✓</div>`);
    else $('#mic .res', el).insertAdjacentHTML('beforeend', `<div class="feedback info small">Pense à commencer par une expression de vérification (« So what you're saying is… »).</div>`);
  } });
  $('#model', el).onclick = () => { $('#modelBox', el).innerHTML = `<div class="feedback info"><b>${esc(d.reformulate.model)}</b> <button class="icon" data-say="${esc(d.reformulate.model)}" data-accent="en-GB">▶</button></div>`; };
  const nx = $('#next', el); if (nx) nx.onclick = () => onDone(el._score ?? 0);
}

// ======================================================= QUICK RESPONSE
function sitText(s) { const l = S.settings.sitLang === 'mix' ? (Math.random() < 0.5 ? 'fr' : 'en') : S.settings.sitLang; return { lang: l, text: s[l] }; }
function pickSituations(n, { weekOnly = true, cat } = {}) {
  const w = currentWeek();
  let pool = SITS.filter(s => s.w <= w && (!cat || s.c === cat));
  if (!pool.length) pool = SITS.filter(s => !cat || s.c === cat);
  if (weekOnly) { const cur = pool.filter(s => s.w === w); if (cur.length >= Math.min(n, 3)) pool = [...cur, ...pool.filter(s => s.w !== w).slice(0, Math.max(0, n - cur.length))]; }
  return shuffle(pool).slice(0, n);
}

function quickWidget(el, sit, { onDone, autoStart = false } = {}) {
  const secs = S.settings.timer;
  const t = sitText(sit);
  el.innerHTML = `
    <div class="card">
      <div class="row">${catChip(sit.c)}<span class="chip oral">oral</span><span class="chip">${secs} s</span></div>
      <div id="pre"><p style="margin:14px 0">Une situation va s'afficher. Tu as <b>${secs} secondes</b> pour répondre <b>à voix haute</b>, si possible avec une expression de la semaine.${SR ? ' Le micro s’active automatiquement.' : ''}</p>
        <button class="btn primary big" id="go">Démarrer ⏱</button></div>
      <div id="live" hidden>
        <div class="situation">${esc(t.text)}</div>
        <div class="row small"><button class="btn small" id="swap">Voir en ${t.lang === 'fr' ? 'anglais' : 'français'}</button></div>
        <div class="timer" id="timer"><div class="num">${secs}</div><div class="track"><i style="width:100%"></i></div></div>
        <div class="mic"><div class="live" id="heard">${SR ? '🎙 Parle maintenant…' : 'Réponds à voix haute !'}</div></div>
        <button class="btn" id="doneBtn">J’ai répondu</button>
      </div>
      <div id="after" hidden></div>
    </div>`;
  let ctrl = null, timer = null, said = '', over = false, shownLang = t.lang;
  cleanup.push(() => clearInterval(timer));
  const start = () => {
    $('#pre', el).hidden = true; $('#live', el).hidden = false;
    const t0 = Date.now();
    timer = setInterval(() => {
      const left = Math.max(0, secs - (Date.now() - t0) / 1000);
      $('#timer .num', el).textContent = Math.ceil(left);
      $('#timer .track i', el).style.width = (left / secs * 100) + '%';
      $('#timer', el).classList.toggle('hot', left <= 2);
      if (left <= 0) finish();
    }, 100);
    if (SR) { ctrl = listen(secs * 1000 + 1500, txt => { said = txt; $('#heard', el).textContent = '« ' + txt + ' »'; }); }
  };
  $('#go', el).onclick = start;
  $('#swap', el).onclick = () => { shownLang = shownLang === 'fr' ? 'en' : 'fr'; $('.situation', el).textContent = sit[shownLang]; $('#swap', el).textContent = 'Voir en ' + (shownLang === 'fr' ? 'anglais' : 'français'); };
  $('#doneBtn', el).onclick = () => finish();
  async function finish() {
    if (over) return; over = true; clearInterval(timer);
    if (ctrl) { await wait(600); ctrl.stop(); said = (await ctrl.promise) || said; }
    $('#live', el).hidden = true;
    const target = sit.expr;
    let detect = '';
    if (said) {
      const s = target ? similarity(said, target.en) : 0;
      const found = detectExpressions(said);
      if (target && s >= 0.7) detect = `<div class="feedback ok">✓ Expression attendue détectée : « ${esc(target.en)} »</div>`;
      else if (found.length) detect = `<div class="feedback ok">✓ Tu as utilisé : « ${esc(found[0].en)} ». L’expression visée était « ${esc(target ? target.en : sit.model)} ».</div>`;
      else detect = `<div class="feedback ko">Pas d’expression de la semaine détectée. Garde une béquille sous le coude : « Let me think about that for a second… »</div>`;
    }
    $('#after', el).hidden = false;
    $('#after', el).innerHTML = `
      <p class="small muted" style="margin-top:14px">${esc(sit[t.lang])}</p>
      ${said ? `<p>Tu as dit : <i>« ${esc(said)} »</i></p>` : SR ? '<p class="muted">Rien entendu par le micro.</p>' : ''}
      ${detect}
      <p class="small muted" style="margin:14px 0 2px">Réponse possible :</p>
      <div class="row"><div class="answer">${esc(sit.model)}</div><button class="icon" data-say="${esc(sit.model)}" data-accent="en-GB">▶</button></div>
      ${target ? `<p class="small muted" style="margin:2px 0 0">${esc(target.fr)}</p>` : ''}
      <p style="margin:16px 0 6px"><b>Alors, réussi ?</b> <span class="small muted">(réponse fluide en moins de ${secs} s)</span></p>
      <div class="row"><button class="btn ok" id="yes">✓ Oui</button><button class="btn ko" id="no">✗ À revoir</button><button class="btn" id="redo">↻ Refaire la même</button></div>`;
    autoSpeak(sit.model, { accent: 'en-GB', rate: 1 });
    $('#yes', el).onclick = () => { rateExpr(target && target.id, true); onDone && onDone(1); };
    $('#no', el).onclick = () => { rateExpr(target && target.id, false); onDone && onDone(0); };
    $('#redo', el).onclick = () => quickWidget(el, sit, { onDone, autoStart: true });
  }
  if (autoStart) start();
}

function viewQuick(v) {
  const w = currentWeek();
  v.innerHTML = `<h1>⚡ Réponse rapide</h1>
    <p class="sub">Série de 8 situations. Réponds en ${S.settings.timer} s (réglable dans ⚙️). Situations en : <b>${{ fr: 'français', en: 'anglais', mix: 'français ou anglais (aléatoire)' }[S.settings.sitLang]}</b>.</p>
    <div class="row" style="margin-bottom:14px"><label class="small">Thème :</label>
      <select id="cat"><option value="">Tous (pondérés)</option>${Object.entries(CATS).map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('')}</select>
      <label class="small"><input type="checkbox" id="wk" checked> priorité aux expressions de la semaine ${w}</label>
      <button class="btn primary" id="startQ">Lancer la série</button></div>
    <div id="qa"></div>`;
  $('#startQ').onclick = () => {
    const cat = $('#cat').value || null;
    let list = cat ? pickSituations(8, { cat, weekOnly: $('#wk').checked }) : [];
    if (!cat) { const counts = allocate(8); for (const [c, k] of Object.entries(counts)) list.push(...pickSituations(k, { cat: c, weekOnly: $('#wk').checked })); list = shuffle(list); }
    let i = 0, score = 0;
    const box = $('#qa');
    const next = () => {
      if (i >= list.length) { box.innerHTML = `<div class="card"><h2>Série terminée : ${score}/${list.length}</h2><p class="muted">Les situations « à revoir » reviendront plus souvent dans tes séances.</p><button class="btn primary" id="again">Nouvelle série</button></div>`; $('#again').onclick = () => $('#startQ').click(); return; }
      box.innerHTML = `<div class="progress"><i style="width:${i / list.length * 100}%"></i></div><p class="small muted">Situation ${i + 1}/${list.length}</p><div id="one"></div>`;
      quickWidget($('#one'), list[i], { autoStart: i > 0, onDone: r => { score += r; i++; next(); } });
    };
    next();
  };
}

// ============================================================ SESSION
// Répartition des catégories selon les poids (méthode du plus fort reste)
function allocate(n) {
  const tot = Object.values(CATS).reduce((a, c) => a + c.weight, 0);
  const raw = Object.entries(CATS).map(([k, c]) => ({ k, x: n * c.weight / tot }));
  const out = Object.fromEntries(raw.map(r => [r.k, Math.floor(r.x)]));
  let left = n - Object.values(out).reduce((a, b) => a + b, 0);
  raw.sort((a, b) => (b.x % 1) - (a.x % 1)).forEach(r => { if (left > 0) { out[r.k]++; left--; } });
  return out;
}
function buildSession() {
  const plan = PLANS[S.settings.sessionLen] || PLANS[10];
  const items = [];
  // dialogues (pondérés par catégorie, non maîtrisés en priorité)
  const usedD = new Set();
  for (let i = 0; i < plan.listen; i++) {
    const pool = DIALOGUES.filter(d => !usedD.has(d.id)); if (!pool.length) break;
    const d = weightedPick(pool, d => CATS[d.c].weight * (dlgStat(d.id).mastered ? 0.3 : 1)); usedD.add(d.id);
    items.push({ type: 'listen', c: d.c, d });
  }
  // autres exercices : catégories selon 35/30/15/10/10
  const slots = [];
  for (const t of ['quick', 'shadow', 'speak', 'mcq', 'gap']) for (let i = 0; i < plan[t]; i++) slots.push(t);
  const counts = allocate(slots.length);
  const cats = shuffle(Object.entries(counts).flatMap(([c, k]) => Array(k).fill(c)));
  const usedE = new Set(), usedS = new Set();
  slots.forEach((t, i) => {
    const c = cats[i];
    if (t === 'quick') {
      const s = pickSituations(6, { cat: c }).find(x => !usedS.has(x.id)) || pickSituations(6).find(x => !usedS.has(x.id));
      usedS.add(s.id); if (s.expr) usedE.add(s.expr.id); items.push({ type: 'quick', c: s.c, s });
    } else {
      let pool = unlocked().filter(e => e.c === c && !usedE.has(e.id));
      if (!pool.length) pool = EXPR.filter(e => e.c === c && !usedE.has(e.id));
      const e = weightedPick(pool, exprWeight); usedE.add(e.id);
      items.push({ type: t, c, e });
    }
  });
  // ordre : on commence par répéter (échauffement), jamais deux écrits d'affilée
  const oral = shuffle(items.filter(x => TYPES[x.type].oral));
  const written = shuffle(items.filter(x => !TYPES[x.type].oral));
  const wi = oral.findIndex(x => x.type === 'shadow'); if (wi > 0) oral.unshift(oral.splice(wi, 1)[0]);
  const order = []; const step = oral.length / (written.length + 1);
  let o = 0;
  for (let k = 0; k < written.length; k++) { const until = Math.round(step * (k + 1)); while (o < until) order.push(oral[o++]); order.push(written[k]); }
  while (o < oral.length) order.push(oral[o++]);
  return { items: order, i: 0, results: [] };
}

function viewSession(v) {
  const ses = route.session;
  if (!ses) return go('home');
  if (ses.i >= ses.items.length) return sessionEnd(v, ses);
  const it = ses.items[ses.i];
  const oralDone = ses.items.slice(0, ses.i).filter(x => TYPES[x.type].oral).length;
  v.innerHTML = `
    <div class="row between"><span class="small muted">Exercice ${ses.i + 1}/${ses.items.length}</span><button class="btn small" id="quit">Quitter la séance</button></div>
    <div class="progress"><i style="width:${ses.i / ses.items.length * 100}%"></i></div>
    <div class="row" style="margin-bottom:10px"><b>${TYPES[it.type].label}</b>${catChip(it.c)}<span class="chip ${TYPES[it.type].oral ? 'oral' : 'written'}">${TYPES[it.type].oral ? 'oral' : 'écrit'}</span></div>
    <div id="ex"></div>`;
  $('#quit').onclick = e => { const b = e.currentTarget; if (b.dataset.sure) go('home'); else { b.dataset.sure = '1'; b.textContent = 'Sûre ? Clique encore pour quitter'; } };
  const done = r => { ses.results.push({ type: it.type, c: it.c, r }); ses.i++; render(); window.scrollTo(0, 0); };
  const ex = $('#ex');
  ({ listen: () => dialogueWidget(ex, it.d, { onDone: done }), quick: () => quickWidget(ex, it.s, { onDone: done }), shadow: () => exShadow(ex, it.e, done), speak: () => exSpeak(ex, it.e, done), mcq: () => exMcq(ex, it.e, done), gap: () => exGap(ex, it.e, done) })[it.type]();
}

function selfRate(el, e, done, hint = '') {
  el.insertAdjacentHTML('beforeend', `<p style="margin:16px 0 6px"><b>Auto-évaluation</b> ${hint}</p><div class="row"><button class="btn ok" data-r="1">✓ Réussi</button><button class="btn ko" data-r="0">✗ À revoir</button></div>`);
  $$('[data-r]', el).forEach(b => (b.onclick = () => { const r = Number(b.dataset.r); rateExpr(e.id, !!r); done(r); }));
}

function exShadow(el, e, done) {
  const acc = randomAccent();
  el.innerHTML = `<div class="card">
    <p class="muted" style="margin:0">Écoute (${accentTag(acc)}), puis répète <b>à voix haute</b> en imitant l'intonation. Répète 2-3 fois.</p>
    <div class="big-en">${esc(e.en)}</div><div class="muted">${esc(e.fr)}</div>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="p1">▶ Écouter</button><button class="btn" id="p2">🐢 Lentement</button><button class="btn" id="p3">🔀 Autre accent</button></div>
    <div id="mic"></div><div id="rate"></div></div>`;
  let a = acc;
  $('#p1', el).onclick = () => { stopSpeech(); speak(e.en, { accent: a, rate: 1 }); };
  $('#p2', el).onclick = () => { stopSpeech(); speak(e.en, { accent: a, rate: 0.7 }); };
  $('#p3', el).onclick = () => { a = randomAccent(); toast(ACCENTS[a].flag + ' ' + ACCENTS[a].label); stopSpeech(); speak(e.en, { accent: a, rate: 1 }); };
  setTimeout(() => autoSpeak(e.en, { accent: a, rate: 1 }), 300);
  micWidget($('#mic', el), { target: e.en, label: '🎙 Répéter au micro' });
  selfRate($('#rate', el), e, done);
}

function exSpeak(el, e, done) {
  el.innerHTML = `<div class="card">
    <p class="muted" style="margin:0">Comment dit-on, à l'oral :</p>
    <div class="big-en">« ${esc(e.fr)} »</div>
    <div id="mic"></div>
    <button class="btn" id="show" style="margin-top:10px">Voir la réponse</button>
    <div id="ans"></div><div id="rate"></div></div>`;
  micWidget($('#mic', el), { target: e.en, label: '🎙 Dis-le en anglais' });
  $('#show', el).onclick = () => {
    $('#show', el).hidden = true;
    $('#ans', el).innerHTML = `<div class="row" style="margin-top:10px"><div class="answer">${esc(e.en)}</div><button class="icon" data-say="${esc(e.en)}" data-accent="en-GB">▶</button></div>`;
    autoSpeak(e.en, { accent: 'en-GB' });
    selfRate($('#rate', el), e, done);
  };
}

function distractors(e, n, field) {
  let pool = EXPR.filter(x => x.c === e.c && x.id !== e.id);
  if (pool.length < n) pool = EXPR.filter(x => x.id !== e.id);
  return shuffle(pool).slice(0, n).map(x => x[field]);
}
function exMcq(el, e, done) {
  const opts = shuffle([e.en, ...distractors(e, 3, 'en')]);
  el.innerHTML = `<div class="card"><p class="muted" style="margin:0">Quelle expression correspond à :</p><div class="big-en">« ${esc(e.fr)} »</div>
    ${opts.map(o => `<button class="opt" data-v="${esc(o)}">${esc(o)}</button>`).join('')}<div id="fb"></div></div>`;
  answerOpts(el, e, e.en, done);
}
function exGap(el, e, done) {
  const STOP = new Set(['that', 'this', 'with', 'what', 'have', 'your', 'about', 'there', 'just', 'could', 'would']);
  const words = e.en.split(' ');
  const cand = words.map((w, i) => ({ i, w: w.replace(/[^A-Za-z'-]/g, '') })).filter(x => x.w.length >= 4 && !STOP.has(x.w.toLowerCase()));
  const target = cand.length ? cand.sort((a, b) => b.w.length - a.w.length)[Math.floor(Math.random() * Math.min(2, cand.length))] : { i: 0, w: words[0].replace(/[^A-Za-z'-]/g, '') };
  const shown = words.map((w, i) => i === target.i ? w.replace(target.w, '<span class="gap-blank">?</span>') : esc(w)).join(' ');
  const others = shuffle([...new Set(EXPR.flatMap(x => x.en.split(' ').map(w => w.replace(/[^A-Za-z'-]/g, ''))).filter(w => w.length >= 4 && w.toLowerCase() !== target.w.toLowerCase()))]).slice(0, 3);
  const opts = shuffle([target.w, ...others]);
  el.innerHTML = `<div class="card"><p class="muted" style="margin:0">Complète l'expression (${esc(e.fr)}) :</p><div class="big-en">${shown}</div>
    ${opts.map(o => `<button class="opt" data-v="${esc(o)}">${esc(o)}</button>`).join('')}<div id="fb"></div></div>`;
  answerOpts(el, e, target.w, done);
}
function answerOpts(el, e, right, done) {
  let answered = false;
  $$('.opt', el).forEach(b => (b.onclick = () => {
    if (answered) return; answered = true;
    const ok = b.dataset.v === right;
    $$('.opt', el).forEach(x => { if (x.dataset.v === right) x.classList.add('right'); else if (x === b) x.classList.add('wrong'); });
    rateExpr(e.id, ok);
    $('#fb', el).innerHTML = `<div class="feedback ${ok ? 'ok' : 'ko'}">${ok ? '✓ Bien vu.' : '✗ La bonne réponse est en vert.'} <b>${esc(e.en)}</b> <button class="icon" data-say="${esc(e.en)}" data-accent="en-GB">▶</button><br><span class="small">Dis-la une fois à voix haute avant de continuer 😉</span></div>
      <button class="btn primary" id="nx" style="margin-top:10px">Continuer →</button>`;
    autoSpeak(e.en, { accent: 'en-GB' });
    $('#nx', el).onclick = () => done(ok ? 1 : 0);
  }));
}

function sessionEnd(v, ses) {
  const n = ses.results.length;
  const oral = ses.results.filter(r => TYPES[r.type].oral).length;
  const score = ses.results.reduce((a, r) => a + (r.r || 0), 0);
  const byCat = Object.keys(CATS).map(c => ({ c, k: ses.results.filter(r => r.c === c).length }));
  if (!ses.saved) { S.sessions.push({ date: new Date().toISOString(), n, oral, score: Math.round(score * 10) / 10 }); save(); ses.saved = true; }
  v.innerHTML = `<div class="card hero"><h1>Séance terminée 🎉</h1><p class="sub">Score : ${Math.round(score * 10) / 10}/${n} · ${oral}/${n} exercices à l'oral (${Math.round(oral / n * 100)} %)</p>
    <button class="btn primary big" id="again">Nouvelle séance</button></div>
    <div class="card"><h3>Répartition de cette séance</h3>${byCat.map(x => `<div class="row between small" style="padding:3px 0"><span>${esc(CATS[x.c].label)} <span class="muted">(cible ${CATS[x.c].weight} %)</span></span><b>${x.k}</b></div>`).join('')}</div>
    <div class="card"><h3>Pour finir : ta phrase béquille du jour</h3>${exprRow(pick(EXPR.filter(e => e.t === 'crutch')))}</div>`;
  $('#again').onclick = () => go('session', { session: buildSession() });
}

// ========================================================== EXPRESSIONS
function viewExpr(v) {
  const f = route.exprFilter || (route.exprFilter = { c: '', w: '', q: '', accent: '' });
  v.innerHTML = `<h1>📚 Expressions</h1><p class="sub">${EXPR.length} expressions sur ${maxContentWeek()} semaines (une nouvelle semaine s'ajoute tous les 7 jours). Pastille : grise = jamais vue, jaune = en cours, verte = maîtrisée.</p>
    <div class="row" style="margin-bottom:12px">
      <select id="fc"><option value="">Toutes les catégories</option>${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${f.c === k ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}<option value="crutch" ${f.c === 'crutch' ? 'selected' : ''}>🛟 Béquilles uniquement</option><option value="check" ${f.c === 'check' ? 'selected' : ''}>🔎 Vérifier sa compréhension</option></select>
      <select id="fw"><option value="">Toutes les semaines</option>${Array.from({ length: weekCount() }, (_, i) => `<option value="${i + 1}" ${String(f.w) === String(i + 1) ? 'selected' : ''}>Semaine ${i + 1}</option>`).join('')}</select>
      <select id="fa"><option value="">Accent aléatoire</option>${Object.entries(ACCENTS).map(([k, a]) => `<option value="${k}" ${f.accent === k ? 'selected' : ''}>${a.flag} ${esc(a.label)}</option>`).join('')}</select>
      <input type="search" id="fq" placeholder="Rechercher…" value="${esc(f.q)}">
    </div><div class="card" id="list"></div>`;
  const draw = () => {
    const q = f.q.toLowerCase();
    const list = EXPR.filter(e => (!f.c || e.c === f.c || e.t === f.c) && (!f.w || e.w === Number(f.w)) && (!q || (e.en + ' ' + e.fr).toLowerCase().includes(q)));
    $('#list').innerHTML = list.length ? list.map(e => exprRow(e, f.accent).replace('<div class="fr">', `<div class="fr">S${e.w} · `)).join('') : '<p class="muted">Aucun résultat.</p>';
  };
  $('#fc').onchange = e => { f.c = e.target.value; draw(); };
  $('#fw').onchange = e => { f.w = e.target.value; draw(); };
  $('#fa').onchange = e => { f.accent = e.target.value; draw(); };
  $('#fq').oninput = e => { f.q = e.target.value; draw(); };
  draw();
}

// ============================================================= SETTINGS
function viewSettings(v) {
  const st = S.settings;
  const voiceRows = Object.entries(ACCENTS).map(([k, a]) => {
    const r = resolveAccent(k); const pv = r.voices[0];
    return `<tr><td>${a.flag} ${esc(a.label)}</td><td>${pv ? esc(pv.name) : '<span class="muted">aucune voix</span>'}${r.real ? '' : ` <span class="chip">approchée</span>`}<div class="small muted">${r.voices.length} voix trouvée(s)</div></td><td><button class="icon" data-say="Just to make sure I understand, you'd like to move the launch to March?" data-accent="${k}">▶</button></td></tr>`;
  }).join('');
  v.innerHTML = `<h1>⚙️ Réglages</h1>
    <div class="card"><h3>Progression</h3>
      <div class="row"><label>Date de début :</label><input type="date" id="sd" value="${st.startDate}">
      <label>Semaine :</label><select id="wo"><option value="">automatique (${currentWeek()})</option>${Array.from({ length: weekCount() }, (_, i) => `<option value="${i + 1}" ${st.weekOverride === i + 1 ? 'selected' : ''}>forcer semaine ${i + 1}</option>`).join('')}</select></div>
      <div class="row" style="margin-top:10px"><label>Objectif quotidien :</label><select id="dg">${[10, 20, 30, 40, 50, 80, 100].map(n => `<option value="${n}" ${goal() === n ? 'selected' : ''}>${n} cartes / exercices par jour</option>`).join('')}</select></div>
      <div class="row" style="margin-top:10px"><label>Longueur de séance :</label><select id="sl">${Object.keys(PLANS).map(n => { const p = PLANS[n]; const o = Object.entries(p).reduce((a, [t, k]) => a + (TYPES[t].oral ? k : 0), 0); return `<option value="${n}" ${Number(n) === st.sessionLen ? 'selected' : ''}>${n} exercices (${o} oraux)</option>`; }).join('')}</select></div>
    </div>
    <div class="card"><h3>Réponse rapide</h3>
      <div class="row"><label>Temps pour répondre : <b id="tv">${st.timer} s</b></label><input type="range" id="tm" min="5" max="10" value="${st.timer}"></div>
      <div class="row" style="margin-top:10px"><label>Langue des situations :</label><select id="lg"><option value="mix" ${st.sitLang === 'mix' ? 'selected' : ''}>Aléatoire FR / EN</option><option value="fr" ${st.sitLang === 'fr' ? 'selected' : ''}>Français</option><option value="en" ${st.sitLang === 'en' ? 'selected' : ''}>Anglais</option></select></div>
    </div>
    <div class="card"><h3>Voix et accents</h3>
      <p class="small muted">Les voix dépendent du navigateur et de Windows. <b>Microsoft Edge</b> propose le plus de voix « Natural » (dont irlandaise, australienne, indienne, espagnole et néerlandaise). Pour l'anglais parlé par des Espagnols ou des Néerlandais, l'app fait lire le texte anglais par une voix espagnole ou néerlandaise : c'est une approximation de l'accent.</p>
      <label class="small"><input type="checkbox" id="cv" ${st.claudeVoice !== false ? 'checked' : ''}> Voix de Claude (naturelle, sur la version en ligne : ${ttsCap ? 'disponible ✓' : 'non disponible ici'})</label><br>
      <div class="row" style="margin-bottom:8px"><label>Voix :</label><select id="vg"><option value="f" ${(st.voiceGender || 'f') === 'f' ? 'selected' : ''}>Voix de femmes uniquement</option><option value="mix" ${st.voiceGender === 'mix' ? 'selected' : ''}>Femmes et hommes (dialogues)</option><option value="m" ${st.voiceGender === 'm' ? 'selected' : ''}>Voix d'hommes uniquement</option></select>
        <button class="btn small" data-say="Hello! Just to make sure I understand, you'd like to move the launch to March?" data-accent="en-GB">▶ Tester</button></div>
      <p class="small muted" style="margin:0 0 8px">Sur iPhone, pour une voix plus naturelle : Réglages → Accessibilité → Contenu énoncé → Voix → Anglais, puis télécharge une voix « améliorée » (par ex. Serena ou Kate).</p>
      <label class="small"><input type="checkbox" id="auto" ${st.autoVoice ? 'checked' : ''}> Lecture automatique (sinon la voix ne parle que quand tu cliques sur 🔊)</label><br>
      <label class="small"><input type="checkbox" id="av" ${st.accentVoices ? 'checked' : ''}> Utiliser les voix espagnoles et néerlandaises pour l'anglais accentué (qualité souvent médiocre)</label>
      <table style="margin-top:10px"><tr><th>Accent</th><th>Voix utilisée</th><th></th></tr>${voiceRows}</table>
      <div class="row" style="margin-top:12px"><label>Reconnaissance vocale :</label><select id="rl"><option value="en-GB" ${st.recogLang === 'en-GB' ? 'selected' : ''}>anglais (UK)</option><option value="en-US" ${st.recogLang === 'en-US' ? 'selected' : ''}>anglais (US)</option></select>
      <span class="small ${SR ? '' : 'muted'}">${SR ? '✓ micro disponible' : '✗ non disponible dans ce navigateur'}</span></div>
    </div>
    <div class="card"><h3>Données</h3><p class="small muted">Ta progression est enregistrée uniquement dans ce navigateur.</p><button class="btn ko" id="reset">Réinitialiser ma progression</button></div>`;
  $('#sd').onchange = e => { st.startDate = e.target.value || todayISO(); save(); render(); };
  $('#wo').onchange = e => { st.weekOverride = e.target.value ? Number(e.target.value) : null; save(); render(); };
  $('#sl').onchange = e => { st.sessionLen = Number(e.target.value); save(); };
  $('#dg').onchange = e => { st.dailyGoal = Number(e.target.value); save(); updateGoalChip(); };
  $('#tm').oninput = e => { st.timer = Number(e.target.value); $('#tv').textContent = st.timer + ' s'; save(); };
  $('#lg').onchange = e => { st.sitLang = e.target.value; save(); };
  $('#cv').onchange = e => { st.claudeVoice = e.target.checked; save(); };
  $('#vg').onchange = e => { st.voiceGender = e.target.value; save(); render(); };
  $('#auto').onchange = e => { st.autoVoice = e.target.checked; save(); };
  $('#av').onchange =e => { st.accentVoices = e.target.checked; save(); render(); };
  $('#rl').onchange = e => { st.recogLang = e.target.value; save(); };
  $('#reset').onclick = e => { const b = e.currentTarget; if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Clique encore pour tout effacer (irréversible)'; return; } { const keep = S.settings; S = DEFAULT(); S.settings = keep; save(); toast('Progression réinitialisée'); render(); } };
}


// ============================================================ CARTES (type Quizlet)
function deckFilterHtml(f) {
  return `
    <select data-f="c"><option value="">Toutes les catégories</option>${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${f.c === k ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
      <option value="crutch" ${f.c === 'crutch' ? 'selected' : ''}>🛟 Béquilles</option><option value="check" ${f.c === 'check' ? 'selected' : ''}>🔎 Vérifier sa compréhension</option><option value="review" ${f.c === 'review' ? 'selected' : ''}>✗ Mes cartes à revoir</option></select>
    <select data-f="w"><option value="">Toutes les semaines</option>${Array.from({ length: weekCount() }, (_, i) => `<option value="${i + 1}" ${String(f.w) === String(i + 1) ? 'selected' : ''}>Semaine ${i + 1}${i + 1 === currentWeek() ? ' (en cours)' : ''}</option>`).join('')}</select>
    <div class="seg" data-f="dir">${[['fr-en', 'FR → EN'], ['en-fr', 'EN → FR'], ['mix', 'Mélangé']].map(([k, l]) => `<button data-v="${k}" class="${f.dir === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function bindDeckFilter(v, f, redraw) {
  $$('select[data-f]', v).forEach(s => (s.onchange = () => { f[s.dataset.f] = s.value; redraw(); }));
  $$('[data-f="dir"] button', v).forEach(b => (b.onclick = () => { f.dir = b.dataset.v; S.settings.cardDir = f.dir; save(); redraw(); }));
}
function deckList(f) {
  return EXPR.filter(e => (!f.w || e.w === Number(f.w)) && (!f.c || (f.c === 'review' ? (exprStat(e.id).ko > 0 && mastery(e.id) < 2) : (e.c === f.c || e.t === f.c))));
}
const cardFilter = () => route.cardFilter || (route.cardFilter = { c: '', w: String(currentWeek()), dir: S.settings.cardDir || 'fr-en' });

function viewCards(v) {
  const f = cardFilter();
  v.innerHTML = `<div class="row between"><h1>🃏 Cartes</h1><div class="seg"><button class="on">Cartes</button><button id="toWrite">✍️ Écrire</button></div></div>
    <p class="sub">Lis la carte, cherche la traduction, retourne-la (clic ou <b>Espace</b>), puis classe-la : <b>←</b> à revoir, <b>→</b> je sais.</p>
    <div class="row" style="margin-bottom:16px">${deckFilterHtml(f)}</div><div id="deck"></div>`;
  $('#toWrite').onclick = () => go('write');
  bindDeckFilter(v, f, () => render());
  const w = Number(f.w);
  if (w && !hasWeek(w)) return weekGenCard($('#deck'), w, () => render());
  let cards = shuffle(deckList(f));
  // De temps en temps, d'anciennes notions reviennent dans le paquet de la semaine
  if (w === currentWeek() && !f.c) cards = [...cards, ...shuffle(dueOld()).slice(0, 6)];
  startDeck($('#deck'), cards, f);
}

let deckProgress = false;
const deckBusy = () => route.view === 'session' || deckProgress;
function startDeck(box, cards, f) {
  if (!cards.length) { box.innerHTML = `<div class="card muted">Aucune carte avec ces filtres${f.c === 'review' ? ' : tu n’as rien à revoir 🎉' : ''}.</div>`; return; }
  let i = 0, flipped = false;
  const known = [], again = [], history = [];
  const dirs = cards.map(() => f.dir === 'mix' ? (Math.random() < 0.5 ? 'fr-en' : 'en-fr') : f.dir);
  function draw() {
    if (i >= cards.length) return end();
    const e = cards[i], d = dirs[i];
    const front = d === 'fr-en' ? e.fr : e.en, back = d === 'fr-en' ? e.en : e.fr;
    flipped = false;
    box.innerHTML = `
      <div class="deckbar"><span>${i + 1} / ${cards.length}</span><div class="progress" style="flex:1;margin:0"><i style="width:${i / cards.length * 100}%"></i></div>
        <span class="cnt ko">✗ ${again.length}</span><span class="cnt ok">✓ ${known.length}</span></div>
      <div class="fc-wrap"><div class="fc" id="fc">
        <div class="face front"><span class="lang">${d === 'fr-en' ? 'FR' : 'EN'}</span><div class="fc-text">${esc(front)}</div><span class="hint">Clique ou Espace pour retourner</span></div>
        <div class="face back"><span class="lang">${d === 'fr-en' ? 'EN' : 'FR'}</span><div class="fc-text">${esc(back)}</div><div class="fc-sub">${esc(front)}</div>
          <button class="icon say" title="Écouter en anglais">🔊</button></div>
      </div></div>
      <div class="row center" style="margin-top:16px">
        <button class="btn ko big" id="no">✗ À revoir</button>
        <button class="btn big" id="flip">↻ Retourner</button>
        <button class="btn ok big" id="yes">✓ Je sais</button>
      </div>
      <div class="row center small" style="margin-top:10px">${catChip(e.c)}${e.w < currentWeek() && isDue(e) ? '<span class="chip oral">🔁 Révision</span>' : ''}<span class="muted">Semaine ${e.w}</span>${history.length ? '<button class="btn small" id="undo">↶ Annuler</button>' : ''}</div>`;
    $('#fc', box).onclick = ev => { if (ev.target.closest('.say')) return; flip(); };
    $('.say', box).onclick = () => { stopSpeech(); speak(e.en, { accent: 'en-GB', rate: 0.95 }); };
    $('#flip', box).onclick = flip;
    $('#yes', box).onclick = () => answer(true);
    $('#no', box).onclick = () => answer(false);
    const u = $('#undo', box); if (u) u.onclick = undo;
  }
  function flip() { if (i >= cards.length) return; flipped = !flipped; $('#fc', box).classList.toggle('flipped', flipped); if (flipped && dirs[i] === 'fr-en') autoSpeak(cards[i].en, { accent: 'en-GB', rate: 0.95 }); }
  function answer(ok) {
    if (i >= cards.length) return;
    const e = cards[i]; history.push({ e, ok, prev: S.expr[e.id] ? { ...S.expr[e.id] } : null }); rateExpr(e.id, ok); (ok ? known : again).push(e); deckProgress = true; i++; draw();
  }
  function undo() {
    const h = history.pop(); if (!h) return;
    if (h.prev) S.expr[h.e.id] = h.prev; else delete S.expr[h.e.id]; save();
    (h.ok ? known : again).pop(); i--; draw();
  }
  function end() {
    box.innerHTML = `<div class="card" style="text-align:center"><h2>Paquet terminé</h2>
      <p><span class="cnt ok">✓ ${known.length} je sais</span> &nbsp; <span class="cnt ko">✗ ${again.length} à revoir</span></p>
      <div class="row center">${again.length ? '<button class="btn primary" id="rev">Revoir les ' + again.length + ' cartes à revoir</button>' : ''}<button class="btn" id="all">Recommencer tout le paquet</button></div>
      ${again.length ? `<div style="text-align:left;margin-top:16px">${again.map(e => exprRow(e, 'en-GB')).join('')}</div>` : ''}</div>`;
    const r = $('#rev', box); if (r) r.onclick = () => startDeck(box, shuffle(again), f);
    $('#all', box).onclick = () => startDeck(box, shuffle(cards), f);
  }
  const onKey = ev => {
    const tgt = ev.target.closest ? ev.target : document.body;
    if (!box.isConnected || tgt.closest('input,select,textarea')) return;
    if (ev.code === 'Space') { ev.preventDefault(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); flip(); }
    else if (ev.key === 'ArrowRight') answer(true);
    else if (ev.key === 'ArrowLeft') answer(false);
  };
  cleanup.forEach(fn => fn.deck && fn()); // un seul paquet actif à la fois
  const off = () => document.removeEventListener('keydown', onKey); off.deck = true;
  document.addEventListener('keydown', onKey);
  cleanup.push(off);
  draw();
}

// ============================================================ ÉCRIRE (type Quizlet « Écrire »)
function viewWrite(v) {
  const f = cardFilter();
  v.innerHTML = `<div class="row between"><h1>✍️ Écrire</h1><div class="seg"><button id="toCards">Cartes</button><button class="on">✍️ Écrire</button></div></div>
    <p class="sub">Tape la traduction puis <b>Entrée</b>. Les majuscules et la ponctuation ne comptent pas, une petite faute est tolérée.</p>
    <div class="row" style="margin-bottom:16px">${deckFilterHtml(f)}</div><div id="deck"></div>`;
  $('#toCards').onclick = () => go('cards');
  bindDeckFilter(v, f, () => render());
  const box = $('#deck');
  const run = cards => {
    if (!cards.length) { box.innerHTML = '<div class="card muted">Aucune carte avec ces filtres.</div>'; return; }
    let i = 0; const wrong = [];
    const dirs = cards.map(() => f.dir === 'mix' ? (Math.random() < 0.5 ? 'fr-en' : 'en-fr') : f.dir);
    const draw = () => {
      if (i >= cards.length) {
        box.innerHTML = `<div class="card" style="text-align:center"><h2>${cards.length - wrong.length} / ${cards.length} correctes</h2><div class="row center">${wrong.length ? '<button class="btn primary" id="rev">Refaire les ' + wrong.length + ' erreurs</button>' : ''}<button class="btn" id="all">Recommencer</button></div></div>`;
        const r = $('#rev', box); if (r) r.onclick = () => run(shuffle(wrong));
        $('#all', box).onclick = () => run(shuffle(cards));
        return;
      }
      const e = cards[i], d = dirs[i];
      const q = d === 'fr-en' ? e.fr : e.en, a = d === 'fr-en' ? e.en : e.fr;
      box.innerHTML = `<div class="deckbar"><span>${i + 1} / ${cards.length}</span><div class="progress" style="flex:1;margin:0"><i style="width:${i / cards.length * 100}%"></i></div><span class="cnt ko">✗ ${wrong.length}</span></div>
        <div class="card"><span class="chip">${d === 'fr-en' ? 'FR → EN' : 'EN → FR'}</span> ${catChip(e.c)}
          <div class="fc-text" style="margin:18px 0">${esc(q)}</div>
          <input class="answer-input" id="in" autocomplete="off" spellcheck="false" placeholder="${d === 'fr-en' ? 'Tape en anglais…' : 'Tape en français…'}">
          <div class="row" style="margin-top:10px"><button class="btn primary" id="ok">Vérifier</button><button class="btn" id="idk">Je ne sais pas</button></div>
          <div id="fb"></div></div>`;
      const inp = $('#in', box); inp.focus();
      let checked = false;
      const check = giveUp => {
        if (checked) { i++; draw(); return; }
        if (!giveUp && !inp.value.trim()) return;
        checked = true; inp.readOnly = true;
        const good = !giveUp && closeEnough(inp.value, a);
        rateExpr(e.id, good); if (!good) wrong.push(e);
        $('#fb', box).innerHTML = `<div class="feedback ${good ? 'ok' : 'ko'}">${good ? '✓ Correct' : '✗ Réponse attendue'} : <b>${esc(a)}</b> <button class="icon" data-say="${esc(e.en)}" data-accent="en-GB">🔊</button></div><p class="small muted">Entrée pour continuer</p>`;
        $('#ok', box).textContent = 'Continuer →'; $('#idk', box).hidden = true;
        if (good) autoSpeak(e.en, { accent: 'en-GB' });
      };
      $('#ok', box).onclick = () => check(false);
      $('#idk', box).onclick = () => check(true);
      inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); check(false); } };
    };
    draw();
  };
  run(shuffle(deckList(f)));
}
// Tolérance : on ignore accents, ponctuation, « … », et on accepte ~1 faute de frappe par 10 lettres
function closeEnough(typed, expected) {
  const n = s => norm(s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const alts = expected.split(' / ').map(n);
  const t = n(typed);
  return alts.some(x => x === t || lev(x, t) <= Math.max(1, Math.floor(x.length / 10)));
}
function lev(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}

// ------------------------------------------- semaines publiées sur GitHub
// Chaque semaine, une tâche automatique ajoute weeks/week-N.json au dépôt.
// L'app (version installée) les télécharge dès qu'elle a internet, puis les garde hors ligne.
async function loadPublishedWeeks() {
  if (IN_FRAME || !/^https?:$/.test(location.protocol)) return;
  try {
    const idx = await (await fetch('weeks/index.json', { cache: 'no-store' })).json();
    let added = 0;
    for (const w of (idx.weeks || []).map(Number)) {
      if (!w || (S.gen[w] && S.gen[w].length)) continue;
      const data = await (await fetch(`weeks/week-${w}.json`, { cache: 'no-store' })).json();
      const items = (data.items || []).filter(x => x && CATS[x.c] && typeof x.en === 'string' && typeof x.fr === 'string');
      if (items.length) { S.gen[w] = items; added++; }
    }
    if (added) { rebuildExpr(); save(); if (!deckBusy()) render(); toast(added > 1 ? `${added} nouvelles semaines reçues` : 'Nouvelle semaine reçue 📬'); }
  } catch {}
}

render();
loadPublishedWeeks();
updateGoalChip();
document.getElementById('goalChip').onclick = () => go('review');
initCloud();

// ---------------------------------------------------- hors ligne (version installée)
// Hors de claude.ai (GitHub Pages, ordinateur), l'app s'installe et marche sans réseau.
if ('serviceWorker' in navigator && !IN_FRAME && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ============================================================ RÉVISER (tout ce qui s'accumule)
function updateBadge() {
  const b = $('#revBadge'); if (!b) return;
  const n = dueAll().length; b.textContent = n; b.hidden = !n;
}
function viewReview(v) {
  const due = dueAll(), w = currentWeek();
  const seen = EXPR.filter(e => e.w <= w && exprStat(e.id).ok + exprStat(e.id).ko > 0);
  const weeks = Array.from({ length: Math.max(1, w) }, (_, i) => i + 1).filter(k => EXPR.some(e => e.w === k));
  const pct = k => { const l = EXPR.filter(e => e.w === k); return l.length ? Math.round(l.filter(e => mastery(e.id) === 2).length / l.length * 100) : 0; };
  v.innerHTML = `<h1>🔁 Réviser</h1>
    <div class="card goal-card"><div class="row between"><h3>Objectif du jour : ${Math.min(doneToday(), goal())}/${goal()} ${doneToday() >= goal() ? '✓' : ''}</h3><span class="streak">🔥 Série : <b>${streak()}</b> jour${streak() > 1 ? 's' : ''}</span></div>
      <div class="progress" style="height:10px"><i style="width:${Math.min(100, doneToday() / goal() * 100)}%"></i></div>
      ${weekChart()}<p class="small muted" style="margin:6px 0 0">Chaque carte ou exercice compte pour 1. Atteins ton objectif chaque jour pour faire grandir ta série. Objectif modifiable dans ⚙️ Réglages.</p></div>
    <p class="sub">Tout ce que tu as appris s'accumule ici. Chaque carte revient au bon moment : le lendemain si tu l'as ratée, puis après 3 jours, 1 semaine, 2 semaines, 1 mois, 2 mois… tant que tu la sais.</p>
    <div class="card review-hero">
      <div><div class="stat">${due.length}</div><div class="muted small">carte${due.length > 1 ? 's' : ''} à réviser aujourd'hui</div></div>
      <button class="btn primary big" id="revDue" ${due.length ? '' : 'disabled'}>${due.length ? 'Réviser maintenant' : 'Rien à réviser aujourd’hui 🎉'}</button>
    </div>
    <div class="card"><div class="row between"><h3>Tout réviser</h3><button class="btn" id="revAll" ${seen.length ? '' : 'disabled'}>Les ${seen.length} cartes déjà vues, mélangées</button></div>
      <p class="small muted" style="margin:4px 0 12px">Ou choisis une semaine :</p>
      <div class="weeks">${weeks.map(k => `<button class="wk" data-wk="${k}"><b>Semaine ${k}</b><span class="meter"><i style="width:${pct(k)}%"></i></span><span class="small muted">${pct(k)} % maîtrisé</span></button>`).join('')}</div>
    </div>
    <div id="deck"></div>`;
  const f = { c: '', w: '', dir: S.settings.cardDir || 'fr-en' };
  const run = cards => { $$('.card', v).forEach(c => (c.hidden = true)); $('.sub', v).hidden = true; startDeck($('#deck'), cards, f); };
  $('#revDue').onclick = () => run(due);
  $('#revAll').onclick = () => run(shuffle(seen));
  $$('[data-wk]', v).forEach(b => (b.onclick = () => run(shuffle(EXPR.filter(e => e.w === Number(b.dataset.wk))))));
}
