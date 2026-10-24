#!/usr/bin/env node
// Lints js/dictionary/data/*: run this after editing any dictionary file.   node tools/validate-dictionary.mjs
// Errors (exit code 1): unreadable JSON, unknown flags, non-Arabic tokens, lines the generator cannot expand.
// Warnings: duplicate lemmas (harmless, but usually a copy-paste slip).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'js', 'dictionary', 'data');
const { strictForm, isArabicWord } = await import(path.join(root, 'js/dictionary/normalize.js'));
const { createLexicon } = await import(path.join(root, 'js/dictionary/lexicon.js'));

const errors = [], warnings = [];
const read = n => fs.readFileSync(path.join(dir, n), 'utf8');
const json = n => { try { return JSON.parse(read(n)); } catch (e) { errors.push(`${n}: ${e.message}`); return {}; } };
const rules = json('rules.json'), core = json('core.json'), affixes = json('affixes.json');

const NOUN_FLAGS = new Set(['un', 'at', 'nd', 'adj', 'np', 'df', 'dw']);
const VERB_FLAGS = new Set(['i', 'np', 'ni', 'ih', 'nm', 'na', 'pass', 'q', 'q2']);
const CLASSES = new Set(Object.keys(affixes.classes || {}));
const arabic = t => t.split(':').every(p => p === '' || isArabicWord(strictForm(p)));

function lintFile(name, kind) {
  const seen = new Map();
  read(name).split('\n').forEach((raw, i) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    const where = `${name}:${i + 1}`;
    const tks = line.split(/\s+/);
    if (kind === 'extra') { if (tks.length > 1 || !isArabicWord(strictForm(tks[0]))) errors.push(`${where}: one Arabic word per line expected: "${line}"`); return; }
    const explicit = kind === 'verbs' && tks[0] === '=';
    tks.forEach((t, k) => {
      if (t === '=' && explicit && k === 0) return;
      if (t.startsWith('@')) {
        const f = t.slice(1);
        if (kind === 'nouns' ? !NOUN_FLAGS.has(f) : !(VERB_FLAGS.has(f) || /^\d+$/.test(f))) errors.push(`${where}: unknown flag ${t}`);
      } else if (explicit && /^[A-Z]{1,2}:$/.test(t)) {
        if (!CLASSES.has(t.slice(0, -1))) errors.push(`${where}: unknown class ${t}`);
      } else if (!arabic(t)) errors.push(`${where}: not an Arabic word: "${t}"`);
    });
    const key = explicit ? `= ${tks[1]}` : tks[0];
    if (seen.has(key) && !/^\S+ @\d+$/.test(line)) { const prev = seen.get(key); if (prev === line) warnings.push(`${where}: duplicate line "${line}"`); }
    seen.set(key, line);
  });
}
for (const n of rules.files?.nouns || []) lintFile(n, 'nouns');
for (const n of rules.files?.verbs || []) lintFile(n, 'verbs');
for (const n of rules.files?.extra || []) lintFile(n, 'extra');
for (const s of core.sets || []) {
  if (!CLASSES.has(s.class)) errors.push(`core.json: set "${s.name}" uses unknown class ${s.class}`);
  for (const w of String(s.words).split(/\s+/).filter(Boolean)) if (!arabic(w)) errors.push(`core.json: "${w}" in set "${s.name}" is not an Arabic word`);
}

const files = k => (rules.files?.[k] || []).map(read);
const lex = createLexicon({ core, affixes, rules, nouns: files('nouns'), verbs: files('verbs'), extra: files('extra') });
for (const w of lex.warnings) errors.push(`generator: ${w}`);
const t0 = Date.now(); const idx = lex.index('expanded'); const ms = Date.now() - t0;

console.log(`entries   ${JSON.stringify(lex.stats().items)}`);
console.log(`forms     ${idx.size.toLocaleString()} generated surface forms (${ms} ms to build the Expanded index)`);
for (const w of warnings) console.log('warning  ', w);
for (const e of errors) console.log('ERROR    ', e);
console.log(errors.length ? `\n${errors.length} error(s)` : '\ndictionary OK');
process.exit(errors.length ? 1 : 0);
