#!/usr/bin/env node
// Mines the compiled word bank for STEMS that the bank itself proves exist, so the grammar can complete the forms the bank
// happens to be missing (the bank holds only a sample of each stem's forms: even كتبوا or يكتبون may be absent).
//   node tools/mine-bank.mjs [--bank js/dictionary/data/bank.bin.gz] [--min-ratio 0.45] [--noun-min 2] [--min-iv 3] [--out dir]
//
// Verbs — every sound root × forms I III V VI VII VIII X is expanded with the real morphology rules. A (root, form) is kept when
//   (a) enough of its DISTINCTIVE forms (those that do not coincide with the Form I paradigm of the same root) are in the bank:
//       count / size >= min-ratio, and (b) the evidence is consistent: perfect forms AND imperfect forms are both attested.
//   Real verbs show roughly half of their paradigm; stray strings show a few coincidental forms. Inspecting the boundary by hand
//   (see docs/validator-audit.md) put the clean cut at 0.45. Form IV is not mined: its perfect forms are spelled exactly like
//   'أ' + the Form I forms (the interrogative أ), so the bank cannot tell them apart; the grammar covers that spelling instead.
// Nouns — every word of the bank that is [و|ف][ب|ك]ال+X or [و|ف]لل+X proves that X is a noun/adjective form. X is kept when it
//   is seen at least noun-min times, or once if X itself is a bank word.
// Output: js/dictionary/data/mined-verbs.txt and mined-nouns.txt (plain, reviewable, editable), then run tools/build-mined.mjs.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { Dawg } from '../js/dictionary/dawg.js';
import { expandVerb } from '../js/dictionary/morphology.js';
import { orthographyProblem } from '../js/dictionary/normalize.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = path.resolve(opt('--out', path.join(root, 'js', 'dictionary', 'data')));
const bankPath = path.resolve(opt('--bank', path.join(dir, 'bank.bin.gz')));
const minRatio = +opt('--min-ratio', 0.45), nounMin = +opt('--noun-min', 2), minIV = +opt('--min-iv', 3);

const bank = Dawg.fromBuffer(zlib.gunzipSync(fs.readFileSync(bankPath)));
const LETTERS = [...'بتثجحخدذرزسشصضطظعغفقكلمنه'];           // no weak letters, no hamza: those verbs are listed by hand
const FORMS = [1, 3, 5, 6, 7, 8, 10];
const bare = (spec) => { const out = []; expandVerb({ lemma: spec.root, perf: spec.root, imp: 'ي' + spec.root, root: spec.root, form: spec.form, flags: new Set(spec.flags), masdars: [] }, out); const seen = new Map(); for (const e of out) if ('VP VI VJ VB VM'.includes(e.c) && !seen.has(e.f)) seen.set(e.f, e.c); return [...seen]; };   // [[form, class], ...]

const hist = {}, lines = [];
let tried = 0;
for (const a of LETTERS) for (const b of LETTERS) for (const c of LETTERS) {
  const r = a + b + c;
  if (a === b && b === c) continue;
  const first = bare({ root: r, form: 1, flags: ['i', 'na'] }), f1 = new Set(first.map(x => x[0]));
  for (const form of FORMS) {
    tried++;
    const all = form === 1 ? first : bare({ root: r, form, flags: ['np'] }).filter(x => !f1.has(x[0]));   // distinctive slots only
    if (all.length < 8) continue;
    const hit = all.filter(x => bank.has(x[0]));
    const n = hit.length, ratio = n / all.length;
    const perfect = hit.filter(x => x[1] === 'VP').length, imperfect = hit.filter(x => x[1] !== 'VP' && x[1] !== 'VM').length;
    const bucket = Math.min(9, Math.floor(ratio * 10));
    (hist[form] ||= Array(10).fill(0))[bucket]++;
    if (ratio >= minRatio && perfect >= 2 && imperfect >= 3) {
      let flags = form === 1 ? ['i'] : [];
      if (form === 1 && bank.has('م' + a + b + 'و' + c)) flags = [];                 // passive participle only when the bank attests it
      lines.push(form === 1 ? `${r}${flags.length ? ' @' + flags.join(' @') : ''}` : `${r} @${form}`);
    }
  }
}
// Form IV: its forms are spelled like 'أ' + Form I, so only the bank's doubled hamza tells them apart: أأ + root + a perfect suffix
// is the interrogative أ over a Form IV perfect (أأكرمت؟). Evidence = how many of these 8 distinctive spellings the bank holds.
const IV_SUFFIXES = ['ت', 'تا', 'وا', 'تما', 'تم', 'تن', 'ن', 'نا'];
const iv = {};
for (const a of LETTERS) for (const b of LETTERS) for (const c of LETTERS) {
  const r = a + b + c;
  const n = IV_SUFFIXES.filter(sfx => bank.has('أأ' + r + sfx)).length;
  iv[Math.min(n, 8)] = (iv[Math.min(n, 8)] || 0) + 1;
  if (n >= minIV) lines.push(`${r} @4`);
}
console.log('Form IV evidence histogram (distinctive أأ-forms present, of 8):', JSON.stringify(iv), '-> kept at >=', minIV);
console.log('(root, form) pairs tried:', tried);
console.log('ratio histogram per form (buckets 0-9%, 10-19% ... 90-100%):');
for (const f of FORMS) console.log('  form', String(f).padEnd(2), (hist[f] || []).map((x, i) => `${i * 10}:${x}`).join(' '));
const byForm = {}; for (const l of lines) { const f = /@(\d+)/.exec(l)?.[1] || '1'; byForm[f] = (byForm[f] || 0) + 1; }
console.log(`kept at ratio >= ${minRatio}:`, JSON.stringify(byForm), 'total', lines.length);

// ---- nouns ----
const m1 = /^[وف]?[بك]?ال(.{3,})$/, m2 = /^[وف]?لل(.{3,})$/;
const seen = new Map();
for (const w of bank.words()) { const m = m1.exec(w) || m2.exec(w); if (m) seen.set(m[1], (seen.get(m[1]) || 0) + 1); }
const nouns = [...seen].filter(([x, n]) => !orthographyProblem(x) && (n >= nounMin || bank.has(x))).map(([x]) => x).sort();
console.log(`noun stems evidenced after the article: ${seen.size}; kept: ${nouns.length}`);

fs.mkdirSync(dir, { recursive: true });
const head = (what, n) => `# ${what}: ${n} entries mined from ${path.basename(bankPath)} by tools/mine-bank.mjs (min-ratio ${minRatio}, noun-min ${nounMin}).\n# Reviewable and editable: delete a line to drop a stem, then run tools/build-mined.mjs.\n`;
fs.writeFileSync(path.join(dir, 'mined-verbs.txt'), head('Verb stems (Form I sound unless @N)', lines.length) + lines.join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'mined-nouns.txt'), head('Noun / adjective stem forms', nouns.length) + nouns.join('\n') + '\n');
console.log('wrote mined-verbs.txt, mined-nouns.txt');
