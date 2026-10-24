#!/usr/bin/env node
// Compiles a big Arabic word bank into the compact automata the game loads (js/dictionary/data/bank.bin.gz, bank-weak.bin.gz).
//   node tools/build-bank.mjs Arabic.txt --source "name of the bank, licence" [--out dir] [--min-alive 6] [--raw]
//
// Input: words separated by commas / whitespace / newlines. Nothing is trusted blindly:
//   1. normalise (harakat, tatweel, zero-width marks); keep only Arabic-letter words of 2–15 letters
//   2. drop spellings that are impossible in Arabic orthography (ة/ى inside a word, ء ئ ؤ opening a word, final إ آ, 4× a letter)
//   3. CORROBORATION: a word is *corroborated* when other words of the bank are built on it with clitics (و ف ب ل ك س ال, pronoun
//      suffixes, verb/noun endings) or when it is itself built on another bank word. A generator that expanded a real stem leaves
//      such families behind; stray strings appended to a list do not. Words of ≤3 letters must additionally have ≥ min-alive variants.
//   4. corroborated words -> bank.bin ("strong evidence"); the isolated rest -> bank-weak.bin (the validator reports it as
//      uncertain / WEAK_EVIDENCE instead of accepting or rejecting it).
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { strictForm, isArabicWord, orthographyProblem } from '../js/dictionary/normalize.js';
import { buildDawg } from './lib/dawg-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const input = args.find((a, i) => !a.startsWith('--') && !['--source', '--out', '--min-alive'].includes(args[i - 1]));
const source = opt('--source');
const outDir = path.resolve(opt('--out', path.join(root, 'js', 'dictionary', 'data')));
const minAlive = +opt('--min-alive', 6);
if (!input || !source) { console.error('usage: node tools/build-bank.mjs words.txt --source "bank name, licence" [--out dir] [--min-alive 6]'); process.exit(2); }

const raw = fs.readFileSync(input);
const stat = { read: 0, notArabic: 0, badLength: 0, badOrthography: 0, duplicate: 0 };
const seen = new Set();
for (const tok of raw.toString('utf8').split(/[,\s]+/)) {
  if (!tok) continue;
  stat.read++;
  const w = strictForm(tok);
  if (!isArabicWord(w)) { stat.notArabic++; continue; }
  if (w.length < 2 || w.length > 15) { stat.badLength++; continue; }
  if (orthographyProblem(w)) { stat.badOrthography++; continue; }
  if (seen.has(w)) { stat.duplicate++; continue; }
  seen.add(w);
}
const words = [...seen];
console.log('kept', words.length, JSON.stringify(stat));

// ---- corroboration ----
const conj = ['', 'و', 'ف'];
const mid = ['', 'ب', 'ل', 'ك', 'س', 'لل', 'بال', 'كال', 'ال', 'ست', 'لي', 'لت', 'لن', 'لأ', 'أ', 'أل'];
const prefixes = [...new Set(conj.flatMap(a => mid.map(b => a + b)).concat(['أو', 'أف', 'أفل', 'أول']))];
const suffixes = ['', 'ه', 'ها', 'هم', 'هما', 'هن', 'ك', 'كما', 'كم', 'كن', 'ني', 'نا', 'ي', 'ون', 'ين', 'ان', 'ات', 'وا', 'ا', 'ت', 'تم', 'تما', 'تن', 'ن', 'ة', 'تان', 'تين', 'ية'];
const bases = new Set(), decorated = new Set();
for (const w of words) {
  for (const p of prefixes) {
    if (p && !w.startsWith(p)) continue;
    for (const s of suffixes) {
      if (s && !w.endsWith(s)) continue;
      if (!p && !s) continue;
      const b = w.slice(p.length, w.length - s.length);
      if (b.length >= 2 && seen.has(b)) { bases.add(b); decorated.add(w); }
    }
  }
}
const alive = w => { let n = 0; for (const p of ['', 'و', 'ف', 'ل', 'ب', 'ك', 'ال', 'وال', 'ي', 'ت', 'ن', 'أ', 'س']) for (const s of ['', 'ه', 'ها', 'هم', 'ك', 'ني', 'نا', 'ون', 'ين', 'ات', 'ة', 'وا', 'ت']) if ((p || s) && seen.has(p + w + s)) n++; return n; };
const strong = [], weak = [];
for (const w of words) {
  const corroborated = decorated.has(w) || bases.has(w);
  (corroborated && (w.length > 3 || alive(w) >= minAlive) ? strong : weak).push(w);
}
console.log(`corroborated ${strong.length} (${(100 * strong.length / words.length).toFixed(2)}%), weak ${weak.length}`);

// ---- compile ----
fs.mkdirSync(outDir, { recursive: true });
const meta = { source, input: path.basename(input), sha256: crypto.createHash('sha256').update(raw).digest('hex'), builtAt: new Date().toISOString().slice(0, 10), minAlive, counts: { ...stat, kept: words.length, corroborated: strong.length, weak: weak.length } };
for (const [name, list] of [['bank', strong], ['bank-weak', weak]]) {
  const r = buildDawg(list.sort());
  const buf = Buffer.from(r.edges.buffer, r.edges.byteOffset, r.edges.byteLength);
  const gz = zlib.gzipSync(buf, { level: 9 });
  fs.writeFileSync(path.join(outDir, name + '.bin.gz'), gz);          // only the gzip is shipped; add --raw to also write the plain .bin
  if (args.includes('--raw')) fs.writeFileSync(path.join(outDir, name + '.bin'), buf);
  meta[name] = { words: list.length, nodes: r.nodes, edges: r.edges.length, bytes: buf.length, gzBytes: gz.length };
  console.log(name, JSON.stringify(meta[name]));
}
fs.writeFileSync(path.join(outDir, 'bank.meta.json'), JSON.stringify(meta, null, 2) + '\n');
console.log('wrote bank.bin.gz, bank-weak.bin.gz, bank.meta.json to', path.relative(root, outDir) || '.');
