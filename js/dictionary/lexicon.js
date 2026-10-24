// Lexicon: parses the static data files, expands them with the morphology rules into a lookup index, and hands the
// clitic analyser what it needs. Environment-agnostic (no fetch, no fs, no DOM): callers pass the raw file contents.
//
// Data layout (js/dictionary/data/):
//   core.json      function words (pronouns, particles, prepositions ...) grouped in sets with a grammar class
//   affixes.json   the clitic grammar (see clitics.js)
//   rules.json     strictness tiers, Basic-mode projection, file lists
//   *.txt          one lexicon entry per line (see "Line formats" below), '#' starts a comment
//
// Line formats
//   nouns   :  singular [explicit forms ...] [@un @at @nd @adj @np]
//   verbs   :  كتب | قال:يقول | root @2..@10 | root @q | root @q2     [masdar ...] [@i @np @ni @ih @nm]
//              = lemma VP: forms VI: forms VJ: forms VM: forms          (explicit paradigm for irregular verbs)
//   extra   :  one exact surface form per line (class X: no inflection, no clitics)

import { strictForm, projectBasic, BASIC_PROJECTION } from './normalize.js';
import { expandNoun, expandVerb, expandExplicit, TIER, VerbError } from './morphology.js';
import { compileGrammar, altStem, analyze } from './clitics.js';

const CHUNK = 250;   // items expanded per slice when the index is warmed up in the background

function tokenize(text) {
  const rows = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (line) rows.push(line.split(/\s+/));
  }
  return rows;
}
const clean = tk => (tk.startsWith('@') || tk.endsWith(':') || tk === '=' ? tk : tk.split(':').map(strictForm).join(':'));

function parseItems(raw, warnings) {
  const items = [];
  for (const set of raw.core?.sets || []) for (const w of String(set.words).split(/\s+/).filter(Boolean)) items.push({ type: 'fw', w: strictForm(w), cls: set.class, set: set.name });
  for (const text of raw.nouns || []) for (const row of tokenize(text)) {
    const tks = row.map(clean), flags = new Set(tks.filter(t => t.startsWith('@')).map(t => t.slice(1))), words = tks.filter(t => !t.startsWith('@'));
    items.push({ type: 'noun', spec: { lemma: words[0], sg: words[0], forms: words.slice(1), flags } });
  }
  for (const text of raw.verbs || []) for (const row of tokenize(text)) {
    const tks = row.map(clean);
    if (tks[0] === '=') { items.push({ type: 'explicit', lemma: tks[1], tokens: tks.slice(2) }); continue; }
    const flags = new Set(), words = [];
    let form = 1;
    for (const t of tks) { if (!t.startsWith('@')) words.push(t); else if (/^@\d+$/.test(t)) form = +t.slice(1); else flags.add(t.slice(1)); }
    const [head, ...masdars] = words;
    const [a, b] = head.split(':');
    const spec = { lemma: head, masdars, flags, form };
    if (form > 1 || flags.has('q2')) { spec.root = a; }
    else { spec.perf = a; spec.imp = b || 'ي' + a; }
    items.push({ type: 'verb', spec });
  }
  for (const text of raw.extra || []) for (const row of tokenize(text)) items.push({ type: 'fw', w: strictForm(row[0]), cls: 'X', set: 'extra' });
  return items;
}

function expandItem(item, out, warnings) {
  try {
    if (item.type === 'fw') {
      const k = (item.cls === 'FS' || item.cls === 'FT') && item.w.endsWith('ى') ? 'ya' : undefined;
      out.push({ f: item.w, l: item.w, t: TIER.LEMMA, c: item.cls, ...(k ? { k } : {}) });
    } else if (item.type === 'noun') expandNoun(item.spec, out);
    else if (item.type === 'verb') expandVerb(item.spec, out);
    else expandExplicit(item.lemma, item.tokens, out);
  } catch (err) {
    if (!(err instanceof VerbError)) throw err;
    warnings.push(err.message);          // a malformed line never takes the game down: it is skipped and reported
  }
}

function insert(map, key, e) {
  const cur = map.get(key);
  if (!cur) { map.set(key, e); return; }
  const arr = Array.isArray(cur) ? cur : [cur];
  for (const x of arr) if (x.c === e.c && x.k === e.k) { if (e.t < x.t) x.t = e.t; return; }   // same shape: keep the lowest tier
  if (Array.isArray(cur)) cur.push(e); else map.set(key, [cur, e]);
}

export function createLexicon(raw) {
  const warnings = [];
  const rules = raw.rules || {};
  const grammar = compileGrammar(raw.affixes);
  const projection = rules.basic?.projection || BASIC_PROJECTION;
  const items = parseItems(raw, warnings);
  const indexes = new Map();   // 'expanded' | 'basic' -> { bare, alt, size }
  let pending = new Map();
  let extra = null; const composed = new Map();   // optional second lexicon (the mined stems), consulted through the same grammar

  const keyFor = (mode, s) => (mode === 'basic' ? projectBasic(s, projection) : s);

  function addEntries(idx, mode, entries) {
    for (const e of entries) {
      const key = keyFor(mode, e.f);
      if (key !== null) { insert(idx.bare, key, e); idx.size++; }   // a form with a stand-alone ء is not spellable with the Basic tiles ...
      const a = altStem(e);
      if (a) for (const one of Array.isArray(a) ? a : [a]) { const ak = keyFor(mode, one); if (ak !== null) insert(idx.alt, ak, e); }
    }
  }
  const fresh = () => ({ bare: new Map(), alt: new Map(), size: 0 });

  function build(mode) {
    const idx = fresh(), out = [];
    for (const item of items) { expandItem(item, out, warnings); if (out.length > 20000) { addEntries(idx, mode, out); out.length = 0; } }
    addEntries(idx, mode, out);
    indexes.set(mode, idx);
    return idx;
  }

  return {
    rules, grammar, warnings, items,
    isBuilt: mode => indexes.has(mode),
    index: mode => indexes.get(mode) || build(mode),
    // Background build in small slices so the UI never freezes; resolves when the index is ready.
    warm(mode) {
      if (indexes.has(mode)) return Promise.resolve(indexes.get(mode));
      if (pending.has(mode)) return pending.get(mode);
      const idx = fresh(); let i = 0;
      const p = new Promise(resolve => {
        const step = () => {
          if (indexes.has(mode)) return resolve(indexes.get(mode));   // somebody needed it right now and built it synchronously
          const out = [], end = Math.min(items.length, i + CHUNK);
          for (; i < end; i++) expandItem(items[i], out, warnings);
          addEntries(idx, mode, out);
          if (i < items.length) setTimeout(step, 0); else { indexes.set(mode, idx); pending.delete(mode); resolve(idx); }
        };
        setTimeout(step, 0);
      });
      pending.set(mode, p);
      return p;
    },
    // `factory(mode)` returns { bare: {get}, alt: {get} } or null. The mined stems live in automata, not in these Maps.
    setExtra(factory) { extra = factory; composed.clear(); },
    analyze(key, mode, opts) {
      const idx = indexes.get(mode) || build(mode);
      let view = idx;
      if (extra) {
        view = composed.get(mode);
        if (!view) {
          const ex = extra(mode);
          const cat = (a, b) => (!b ? a : !a ? b : [a, b].flat());
          view = ex ? { bare: { get: k => cat(idx.bare.get(k), ex.bare.get(k)) }, alt: { get: k => cat(idx.alt.get(k), ex.alt.get(k)) } } : idx;
          composed.set(mode, view);
        }
      }
      return analyze(key, view, grammar, opts);
    },
    stats() { const o = {}; for (const it of items) o[it.type] = (o[it.type] || 0) + 1; return { items: o, forms: Object.fromEntries([...indexes].map(([m, i]) => [m, i.size])), warnings: warnings.length }; }
  };
}
