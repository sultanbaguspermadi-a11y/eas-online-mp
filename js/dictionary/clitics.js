// Clitic / affix grammar. Data-driven: js/dictionary/data/affixes.json says which prefix groups and which pronoun-suffix
// set each entry class accepts. Nothing is accepted just because it parses: the remaining stem must be a lexicon entry
// whose class permits exactly that combination.
//
//   [interrogative] [conjunction] [preposition | future | lam of command] [article]  STEM  [pronoun suffix]
//   أ               و/ف           ب ل ك            س          ل             ال       (article and suffix never together)

import { ATTACH } from './morphology.js';

export function compileGrammar(a) {
  const groupOf = {};
  for (const grp of ['prep', 'future', 'lamCommand', 'lamEmph']) for (const ch of a.groups[grp]) (groupOf[ch] ||= []).push(grp);
  const suffixes = [...new Set(Object.values(a.suffixSets).flat())];
  return { interrog: a.groups.interrog || [], conj: a.groups.conj, mids: Object.keys(groupOf), groupOf, article: a.groups.article[0], suffixSets: a.suffixSets,
    suffixes, classes: a.classes, kindRules: a.kindRules || {} };
}

// The stem(s) a suffix attaches to when it differs from the form itself: a string, an array (ء has three seats) or null.
export const altStem = e => (e.k && ATTACH[e.k] ? ATTACH[e.k](e.f) : null);

const each = (v, fn) => { if (!v) return null; if (!Array.isArray(v)) return fn(v); for (const e of v) { const r = fn(e); if (r) return r; } return null; };

function permitted(g, e, interrog, conj, mid, art, suffix) {
  const cls = g.classes[e.c];
  if (!cls) return false;
  if (interrog && (!cls.prefix.includes('interrog') || art)) return false;
  if (conj && !cls.prefix.includes('conj')) return false;
  if (mid && !g.groupOf[mid].some(x => cls.prefix.includes(x))) return false;
  if (art === 'FA') { if (!cls.inherentArticle) return false; }
  else if (art) { if (!cls.prefix.includes('article') || suffix) return false; }
  if (suffix) {
    const set = g.suffixSets[cls.suffix];
    if (!set || !set.includes(suffix)) return false;
    if (e.k && g.kindRules[e.k]?.exclude?.includes(suffix)) return false;
    if (suffix === 'ي' && !e.k && e.f.endsWith('ي') && e.c !== 'N') return false;   // فيّ is just في; nouns do take it (كرسيي، آدميي)
  }
  return true;
}

// Returns { entry, prefix, suffix, source } or null. `key` is already in the index's spelling (strict or Basic).
export function analyze(key, index, g, { maxTier, clitics }) {
  const { bare, alt } = index;
  let best = null;
  each(bare.get(key), e => { if (e.t <= maxTier && (!best || e.t < best.t)) best = e; return false; });
  if (best) return { entry: best, prefix: '', suffix: '', source: best.t === 0 ? 'lexicon' : 'morphology' };
  if (!clitics) return null;

  for (const q of ['', ...g.interrog]) {
  if (!key.startsWith(q)) continue;
  const k0 = key.slice(q.length);
  for (const conj of ['', ...g.conj]) {
    if (!k0.startsWith(conj)) continue;
    const r1 = k0.slice(conj.length);
    for (const mid of ['', ...g.mids]) {
      if (mid && !r1.startsWith(mid)) continue;
      const r2 = r1.slice(mid.length);
      if (!r2) continue;
      const options = [['', r2]];
      if (mid !== 'ل' && r2.startsWith(g.article)) options.push([g.article, r2.slice(g.article.length)]);
      if (mid === 'ل' && r2.startsWith('ل')) { options.push(['ل', r2.slice(1)]); options.push(['FA', 'ا' + r2]); }   // للكتاب, للذي
      for (const [art, r] of options) {
        if (!r) continue;
        for (const suffix of ['', ...g.suffixes]) {
          if (suffix && !r.endsWith(suffix)) continue;
          if (!q && !conj && !mid && !art && !suffix) continue;      // that is the direct lookup above
          const stem = suffix ? r.slice(0, r.length - suffix.length) : r;
          if (!stem) continue;
          const hit = each(bare.get(stem), e => (e.t <= maxTier && (!suffix || !e.k) && permitted(g, e, q, conj, mid, art, suffix) ? e : null))
            || (suffix && each(alt.get(stem), e => (e.t <= maxTier && permitted(g, e, q, conj, mid, art, suffix) ? e : null)));
          if (hit) return { entry: hit, prefix: q + conj + mid + (art === 'FA' ? '' : art), suffix, source: 'clitic' };
        }
      }
    }
  }
  }
  return null;
}
