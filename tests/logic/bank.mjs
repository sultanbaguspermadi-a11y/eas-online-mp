// The word bank, the mined stems and the automaton that stores them.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { ROOT } from './harness.mjs';
const V = await import(`${ROOT}/js/validator.js`);
const { Dawg, projectionAlternatives } = await import(`${ROOT}/js/dictionary/dawg.js`);
const { buildDawg } = await import(`${ROOT}/tools/lib/dawg-build.mjs`);
const N = await import(`${ROOT}/js/dictionary/normalize.js`);
const file = n => path.join(ROOT, 'js', 'dictionary', 'data', n);
const fetchText = n => fs.readFileSync(file(n), 'utf8'), fetchBytes = n => fs.readFileSync(file(n));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const group = n => console.log('\n# ' + n);

group('the automaton (DAWG)');
{
  const words = ['أكل', 'على', 'كتاب', 'كتابة', 'ماء', 'مدرسة', 'يكتب', 'يكتبون'].sort();
  const d = new Dawg(buildDawg(words).edges);
  ok(JSON.stringify([...d.words()].sort()) === JSON.stringify(words), 'every word comes back, nothing else');
  ok(words.every(w => d.has(w)) && !d.has('كتا') && !d.has('كتابا') && !d.has('') && !d.has('x') && !d.has('مدرسه'), 'exact lookup: prefixes and near-misses are not words');
  const alts = projectionAlternatives({ 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و', 'ئ': 'ي', 'ة': 'ه', 'ى': 'ي' });
  ok(d.hasProjected('مدرسه', alts) && d.hasProjected('اكل', alts) && d.hasProjected('علي', alts) && !d.hasProjected('مدرسا', alts) && !d.hasProjected('ما', alts), 'Basic-letter lookup walks the same automaton (ة→ه, أ→ا, ى→ي)');
  ok(!d.hasProjected('', alts) && new Dawg(new Uint32Array(0)).has('كتاب') === false, 'empty inputs are safe');
  // round trip a larger pseudo-random set
  let seed = 5; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const L = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهويةى'];
  const set = new Set(); while (set.size < 20000) set.add(Array.from({ length: 2 + Math.floor(rnd() * 8) }, () => L[Math.floor(rnd() * L.length)]).join(''));
  const big = new Dawg(buildDawg([...set].sort()).edges);
  let wrong = 0; for (const w of set) if (!big.has(w)) wrong++;
  for (let i = 0; i < 20000; i++) { const w = Array.from({ length: 2 + Math.floor(rnd() * 8) }, () => L[Math.floor(rnd() * L.length)]).join(''); if (big.has(w) !== set.has(w)) wrong++; }
  ok(wrong === 0, `20,000 words + 20,000 probes: ${wrong} disagreements with a Set`);
}

group('before the bank is loaded');
await V.loadDictionary({ fetchText, fetchBytes, bank: 'skip' });
ok(V.bankState() === 'idle' && !V.isBankReady(), 'bank idle');
ok(V.validateWord('الكتساب').status === 'invalid' && V.validateWord('تعترض').status === 'invalid', 'rules alone: unknown words are invalid (nothing is guessed)');

group('while the bank is loading, "not found" is not a verdict');
{
  let release; const gate = new Promise(r => { release = r; });
  const p = V.loadBank({ fetchBytes: async n => { await gate; return fs.readFileSync(file(n)); } });
  ok(V.bankState() === 'loading', 'state: loading');
  const w = V.validateWord('تعترض'), g = V.validateWord('الكتساب');
  ok(w.status === 'uncertain' && w.partial === true && g.status === 'uncertain' && g.partial === true, 'unknown words are provisional while evidence is incomplete');
  ok(V.validateWord('كتاب').valid && V.validateWord('ك').status === 'invalid', 'known words and structural errors are unaffected');
  release(); await p;
  ok(V.bankState() === 'ready' && V.isBankReady(), 'state: ready');
  ok(V.validateWord('الكتساب').status === 'invalid' && !V.validateWord('الكتساب').partial, 'after loading, gibberish is rejected again');
  ok(V.loadBank() instanceof Promise && (await V.loadBank()) === true, 'loadBank is idempotent');
}

group('a failing bank download degrades gracefully (separate module state)');
{
  const code = `
    import fs from 'fs'; import path from 'path';
    const V = await import('${ROOT}/js/validator.js');
    const f = n => path.join('${ROOT}', 'js/dictionary/data', n);
    await V.loadDictionary({ fetchText: n => fs.readFileSync(f(n), 'utf8'), fetchBytes: async () => { throw new Error('offline'); }, bank: 'wait' });
    const r = V.validateWord('كتاب'), g = V.validateWord('الكتساب');
    console.log(JSON.stringify([V.bankState(), V.bankError()?.message, r.valid, g.status]));`;
  const out = (await import('child_process')).execFileSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim();
  ok(out === JSON.stringify(['failed', 'offline', true, 'invalid']), 'bank failed: rules still work, state is "failed": ' + out);
}

group('strong tier: every corroborated bank word is accepted');
const strongDawg = Dawg.fromBuffer(zlib.gunzipSync(fs.readFileSync(file('bank.bin.gz'))));
const weakDawg = Dawg.fromBuffer(zlib.gunzipSync(fs.readFileSync(file('bank-weak.bin.gz'))));
{
  const sample = []; let i = 0; for (const w of strongDawg.words()) if (i++ % 1000 === 0) sample.push(w);
  const res = sample.map(w => [w, V.validateWord(w)]);
  const invalid = res.filter(([, r]) => r.status === 'invalid');
  ok(invalid.length === 0, `${sample.length} sampled strong words, invalid: ${invalid.slice(0, 8).map(x => x[0]).join(' ')}`);
  const long = res.filter(([w]) => w.length >= 5), shortRes = res.filter(([w]) => w.length <= 4);
  ok(long.every(([, r]) => r.valid), 'every sampled word of 5+ letters is valid: ' + long.filter(([, r]) => !r.valid).map(x => x[0]).slice(0, 6).join(' '));
  ok(shortRes.every(([, r]) => r.valid || (r.status === 'uncertain' && r.reason === 'WEAK_EVIDENCE')), 'sampled words of ≤4 letters are valid or provisional (never invalid)');
  ok(res.some(([, r]) => r.source === 'bank') || res.some(([, r]) => r.source), 'sources are reported');
}

group('weak tier: provisional, never silently rejected');
{
  const sample = []; let i = 0; for (const w of weakDawg.words()) if (i++ % 200 === 0) sample.push(w);
  const st = sample.map(w => V.validateWord(w).status);
  ok(st.every(s => s !== 'invalid'), `${sample.length} sampled weak words: none invalid`);
  const unc = st.filter(s => s === 'uncertain').length;
  ok(unc / st.length > 0.25 && unc < st.length, `a real share of the weak tier stays uncertain; the rest is rescued by a rule or a mined stem (${unc}/${st.length} uncertain)`);
  const w = sample.find(x => V.validateWord(x).status === 'uncertain');
  ok(V.validateWord(w).reason === 'WEAK_EVIDENCE', 'reason is WEAK_EVIDENCE');
  ok(V.validateWord(w, { weak: 'accept' }).valid && V.validateWord(w, { weak: 'reject' }).status === 'invalid' && V.validateWord(w, { weak: 'uncertain' }).status === 'uncertain', 'the weak override: accept / reject / uncertain');
  ok(V.validateWords([w, 'كتاب']).status === 'uncertain' && V.validateWords([w, 'الكتساب']).status === 'invalid', 'aggregate: uncertain, but invalid still wins');
}

group('short words that only the bank vouches for');
{
  let w = null; for (const x of strongDawg.words()) if (x.length === 3 && V.validateWord(x, { short: 'reject' }).status === 'invalid') { w = x; break; }
  ok(w !== null, 'found a bank-only 3-letter word: ' + w);
  ok(V.validateWord(w).status === 'uncertain' && V.validateWord(w).reason === 'WEAK_EVIDENCE', 'default: provisional');
  ok(V.validateWord(w, { short: 'accept' }).valid && V.validateWord(w, { short: 'reject' }).status === 'invalid', 'short override: accept / reject');
  ok(V.validateWord('من').valid && V.validateWord('في').valid && V.validateWord('عظ').valid && V.validateWord('ثب').valid && V.validateWord('تم').valid && V.validateWord('قل').valid, 'short words backed by a rule or a mined stem stay valid (عظ ثب are imperatives of وعظ وثب)');
  let five = null; for (const x of strongDawg.words()) if (x.length === 5 && V.validateWord(x, { short: 'reject' }).valid) { five = x; break; }
  ok(five !== null, 'words of 5+ letters are not subject to the short-word rule');
}

group('Basic mode over the bank');
{
  const alts = null; void alts;
  const sample = []; let i = 0; for (const w of strongDawg.words()) if (w.length >= 5 && N.projectBasic(w) !== null && i++ % 700 === 0) sample.push(w);
  const bad = sample.filter(w => V.validateWord(N.projectBasic(w), { mode: 'basic' }).status === 'invalid');
  ok(bad.length === 0, `${sample.length} bank words, spelled with the 28 Basic letters, none invalid: ${bad.slice(0, 5).map(w => N.projectBasic(w)).join(' ')}`);
  const withHamza = []; let j = 0; for (const w of strongDawg.words()) if (w.includes('ء') && j++ % 3000 === 0) withHamza.push(w);
  ok(withHamza.length > 3 && withHamza.every(w => V.validateWord(w, { mode: 'basic' }).reason === 'MODE_LETTER_UNAVAILABLE'), 'a word with a stand-alone ء cannot be played in Basic mode');
}

group('mined stems complete the paradigms the bank dropped');
{
  const lines = fs.readFileSync(file('mined-verbs.txt'), 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
  const roots = lines.filter(l => !/@\d/.test(l)).map(l => l.split(/\s+/)[0]);
  ok(roots.length > 1000, `${roots.length} mined Form I roots`);
  const pick = roots.filter((_, i) => i % 11 === 0);
  const missing = [];
  for (const r of pick) for (const f of [r + 'وا', 'ي' + r + 'ون', 'ت' + r, 'ا' + r + 'وا', r + 'تم', 'ي' + r + 'ان', 'ن' + r, r + 'نا', 'ي' + r + 'ونه', 'سي' + r, 'فلي' + r]) if (!V.validateWord(f).valid) missing.push(f);
  ok(missing.length === 0, `${pick.length} mined roots × 11 forms: missing ${missing.slice(0, 8).join(' ')}`);
  const iv = lines.filter(l => /@4$/.test(l)).map(l => l.split(/\s+/)[0]);
  ok(iv.length > 200, `${iv.length} mined Form IV roots (found by the doubled-hamza evidence)`);
  const missIV = [];
  for (const r of iv.filter((x, i) => i % 7 === 0 && x[1] !== x[2])) for (const f of ['أ' + r + 'ت', 'أ' + r + 'وا', 'ي' + r + 'ون', 'م' + r, 'أ' + r + 'وه']) if (!V.validateWord(f).valid) missIV.push(f);   // doubled roots contract (أحبّوا), so they are skipped here
  ok(missIV.length === 0, 'Form IV mined roots complete: ' + missIV.slice(0, 6).join(' '));
  const nouns = fs.readFileSync(file('mined-nouns.txt'), 'utf8').split('\n').filter(l => l && !l.startsWith('#')).filter((_, i) => i % 97 === 0);
  const badN = nouns.filter(x => !(V.validateWord(x).valid && V.validateWord('ال' + x).valid && V.validateWord('و' + x).valid));
  ok(badN.length / nouns.length < 0.05, `mined nouns accept bare / article / conjunction forms (${nouns.length - badN.length}/${nouns.length})`);
  ok(V.validateWord('كتبوا').valid && V.validateWord('يكتبون').valid && V.validateWord('تكتب').valid && V.validateWord('اكتبوا').valid, 'كتبوا يكتبون تكتب اكتبوا: absent from the bank, valid by the grammar');
  ok(JSON.stringify(V.dictionaryInfo().bankWords) === JSON.stringify({ strong: true, weak: true, mined: true }), 'all three data sets are loaded');
}

group('false acceptance of random strings (the cost of a large lexicon, measured)');
{
  const L28 = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'];
  let seed = 12345; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const rate = (len, mode, N_ = 6000) => { let v = 0; for (let i = 0; i < N_; i++) if (V.validateWord(Array.from({ length: len }, () => L28[Math.floor(rnd() * 28)]).join(''), { mode }).valid) v++; return v / N_; };
  for (const mode of ['expanded', 'basic']) {
    const r = [2, 3, 4, 5, 6, 7, 8].map(l => rate(l, mode));
    console.log(`  ${mode}: valid share of random strings by length 2..8: ${r.map(x => (100 * x).toFixed(1) + '%').join(' ')}`);
    ok(r[0] < 0.30 && r[1] < 0.30 && r[2] < 0.14 && r[3] < 0.035 && r[4] < 0.008 && r[5] < 0.003 && r[6] < 0.002, `${mode}: ceilings hold`);
  }
}

group('performance');
{
  let seed = 7; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const L = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'];
  const ws = Array.from({ length: 60000 }, () => Array.from({ length: 5 + Math.floor(rnd() * 4) }, () => L[Math.floor(rnd() * 28)]).join(''));
  let t = performance.now(); for (const w of ws) V.validateWord(w); const e = performance.now() - t;
  ok(e < 4000, `60,000 uncached Expanded lookups: ${e.toFixed(0)} ms`);
  t = performance.now(); for (const w of ws.slice(0, 20000)) V.validateWord(w, { mode: 'basic' }); const b = performance.now() - t;
  ok(b < 4000, `20,000 uncached Basic lookups (projected search): ${b.toFixed(0)} ms`);
  const sizes = ['bank.bin.gz', 'bank-weak.bin.gz', 'mined.bin.gz'].map(n => fs.statSync(file(n)).size);
  ok(sizes.reduce((a, c) => a + c, 0) < 3.2e6, `shipped bank + weak + mined: ${(sizes.reduce((a, c) => a + c, 0) / 1e6).toFixed(2)} MB gzipped`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
