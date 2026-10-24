#!/usr/bin/env node
// Adds an Arabic word list to the lexicon as exact words (js/dictionary/data/extra.txt).
//   node tools/import-wordlist.mjs words.txt --source "Name of the list, licence" [--dry] [--out file]
// Input: one word per line (anything after the first whitespace is ignored). Words are normalised (harakat/tatweel removed),
// non-Arabic and too-short/long entries are skipped, and words the lexicon ALREADY accepts (listed or derived by
// morphology / clitics) are not added again, so extra.txt only grows by genuinely new words.
//
// LICENCE: only import a list you are allowed to redistribute with this repository. --source is mandatory and is written
// into the file header so the provenance of every bulk import is on record.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'js', 'dictionary', 'data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const input = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--source' && args[i - 1] !== '--out');
const source = opt('--source'), dry = args.includes('--dry'), out = path.resolve(opt('--out', path.join(dir, 'extra.txt')));
if (!input || !source) { console.error('usage: node tools/import-wordlist.mjs words.txt --source "list name, licence" [--dry] [--out file]'); process.exit(2); }

const { strictForm, isArabicWord } = await import(path.join(root, 'js/dictionary/normalize.js'));
const V = await import(path.join(root, 'js/validator.js'));
await V.loadDictionary({ fetchText: n => fs.readFileSync(path.join(dir, n), 'utf8') });

const existing = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean) : []);
const min = 2, max = 15;
const stat = { read: 0, notArabic: 0, badLength: 0, duplicate: 0, alreadyAccepted: 0, added: 0 };
const fresh = new Set();
for (const line of fs.readFileSync(input, 'utf8').split('\n')) {
  const tok = line.trim().split(/\s+/)[0];
  if (!tok) continue;
  stat.read++;
  const w = strictForm(tok);
  if (!isArabicWord(w)) { stat.notArabic++; continue; }
  if (w.length < min || w.length > max) { stat.badLength++; continue; }
  if (existing.has(w) || fresh.has(w)) { stat.duplicate++; continue; }
  if (V.validateWord(w, { mode: 'expanded' }).valid) { stat.alreadyAccepted++; continue; }
  fresh.add(w); stat.added++;
}
console.log(JSON.stringify(stat));
if (dry) { console.log('(dry run: nothing written)'); process.exit(0); }
if (!fresh.size) { console.log('nothing new to add'); process.exit(0); }
const header = `# Imported ${new Date().toISOString().slice(0, 10)} from ${path.basename(input)} — ${source} — ${fresh.size} words\n`;
fs.appendFileSync(out, header + [...fresh].sort().join('\n') + '\n');
console.log(`appended ${fresh.size} words to ${path.relative(root, out)}; run: node tools/validate-dictionary.mjs`);
