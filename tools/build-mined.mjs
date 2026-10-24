#!/usr/bin/env node
// Compiles js/dictionary/data/mined-verbs.txt + mined-nouns.txt into mined.bin.gz.   node tools/build-mined.mjs [--out dir]
// Verbs are expanded with the real morphology (every conjugation, passive, participle, imperative); nouns become one form each,
// with the attach kind their ending needs. Entries are grouped by (class, attach kind) and every group becomes two automata:
// the forms, and the alternate stems a pronoun suffix attaches to (ة→ت, ى→ا, ...).
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { expandVerb, ATTACH, TIER } from '../js/dictionary/morphology.js';
import { strictForm } from '../js/dictionary/normalize.js';
import { buildDawg } from './lib/dawg-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dir = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(root, 'js', 'dictionary', 'data'));
const rows = f => fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8').split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean) : [];

const entries = [];
const warnings = [];
let verbs = 0;
for (const line of rows('mined-verbs.txt')) {
  const tk = line.split(/\s+/).map(strictForm === undefined ? x => x : x => (x.startsWith('@') ? x : strictForm(x)));
  const flags = new Set(); let form = 1;
  for (const t of tk.slice(1)) { if (/^@\d+$/.test(t)) form = +t.slice(1); else if (t.startsWith('@')) flags.add(t.slice(1)); }
  const rootLetters = tk[0];
  try { expandVerb({ lemma: rootLetters, perf: rootLetters, imp: 'ي' + rootLetters, root: rootLetters, form, flags, masdars: [] }, entries); verbs++; }
  catch (e) { warnings.push(`${line}: ${e.message}`); }
}
let nouns = 0;
for (const line of rows('mined-nouns.txt')) {
  const x = strictForm(line.split(/\s+/)[0]);
  const k = x.endsWith('ة') ? 'ta' : x.endsWith('ى') ? 'alif' : x.endsWith('ء') ? 'hamza' : undefined;
  entries.push({ f: x, t: TIER.REGULAR, c: 'N', k });
  if (/(ان|ين|ون)$/.test(x)) entries.push({ f: x, t: TIER.REGULAR, c: 'N', k: 'dropn' });   // could be a dual / sound plural: the ن drops before a suffix
  nouns++;
}

const groups = new Map();
for (const e of entries) {
  if (e.k === 'none') { /* takes no suffix, but is still a valid bare form */ }
  const key = `${e.c}|${e.k || ''}|${e.t}`;
  const g = groups.get(key) || { c: e.c, k: e.k || null, t: e.t, bare: new Set(), alt: new Set() };
  g.bare.add(e.f);
  if (e.k && ATTACH[e.k]) { const a = ATTACH[e.k](e.f); for (const x of Array.isArray(a) ? a : [a]) g.alt.add(x); }
  groups.set(key, g);
}
const blobs = [], header = { groups: [] };
let off = 0;
const pack = set => {
  const r = buildDawg([...set].sort());
  blobs.push(Buffer.from(r.edges.buffer, r.edges.byteOffset, r.edges.byteLength));
  const at = [off, r.edges.length]; off += r.edges.length; return at;
};
for (const g of groups.values()) header.groups.push({ c: g.c, k: g.k, t: g.t, bare: pack(g.bare), alt: g.alt.size ? pack(g.alt) : null });
const hbuf = Buffer.from(JSON.stringify(header)), pad = (4 - ((4 + hbuf.length) % 4)) % 4;
const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32LE(hbuf.length);
const container = Buffer.concat([lenBuf, hbuf, Buffer.alloc(pad), ...blobs]);
const gz = zlib.gzipSync(container, { level: 9 });
fs.writeFileSync(path.join(dir, 'mined.bin.gz'), gz);
const meta = { verbs, nouns, expandedEntries: entries.length, groups: header.groups.length, bytes: container.length, gzBytes: gz.length, warnings: warnings.length };
fs.writeFileSync(path.join(dir, 'mined.meta.json'), JSON.stringify(meta, null, 2) + '\n');
for (const w of warnings.slice(0, 10)) console.log('warning', w);
console.log(JSON.stringify(meta));
