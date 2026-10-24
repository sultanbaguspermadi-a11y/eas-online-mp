// Pure validator tests: no DOM, no game. Run: node logic/validator.mjs
import { ROOT, loadDictionaryFromDisk } from './harness.mjs';
const N = await import(`${ROOT}/js/dictionary/normalize.js`);
const V = await import(`${ROOT}/js/validator.js`);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const group = n => console.log('\n# ' + n);
const words = s => s.split(/\s+/).filter(Boolean);

group('before the dictionary is loaded');
{
  const r = V.validateWord('كتاب');
  ok(r.status === 'unavailable' && r.reason === 'DICTIONARY_UNAVAILABLE' && !r.valid, 'unavailable, not silently "valid" or "invalid"');
  ok(V.validateWords(['كتاب', 'قلم']).status === 'unavailable', 'aggregate is unavailable too');
  ok(!V.isDictionaryReady(), 'not ready');
}
let loadMs = Date.now();
await loadDictionaryFromDisk();
loadMs = Date.now() - loadMs;
ok(V.isDictionaryReady(), 'ready after load');
ok((await V.loadDictionary()) !== null, 'loadDictionary is idempotent');

group('data health');
{
  const info = V.dictionaryInfo();
  ok(info.warnings.length === 0, 'no malformed lexicon lines: ' + info.warnings.join(' | '));
  ok(info.items.noun >= 1400 && info.items.verb >= 600 && info.items.fw >= 200 && info.bank === 'ready' && info.bankWords.mined, 'lexicon size ' + JSON.stringify(info.items));
}

group('normalisation');
{
  ok(N.strictForm('الْكِتَابُ') === 'الكتاب', 'harakat removed');
  ok(N.strictForm('كـتـاب') === 'كتاب', 'tatweel removed');
  ok(N.strictForm('كتا\u200Bب\u200F') === 'كتاب', 'zero-width / bidi marks removed');
  ok(N.strictForm('ﻻ') === 'لا', 'presentation form lam-alif folded (NFKC)');
  ok(N.strictForm('أإآ') === 'أإآ' && N.strictForm('ةى') === 'ةى', 'hamza forms / ة / ى are NOT folded in the strict form');
  ok(N.strictForm('ٱلله') === 'الله', 'alif wasla');
  const r = N.representations('مَدْرَسَة');
  ok(r.strict === 'مدرسة' && r.lookup === 'مدرسه' && r.basic === 'مدرسه', 'representations');
  ok(N.projectBasic('أكل') === 'اكل' && N.projectBasic('على') === 'علي' && N.projectBasic('سماء') === null, 'Basic projection; stand-alone hamza is unspellable');
  ok(N.foldLookup('أإآؤئةى', { alif: true }) === 'اااؤئةى', 'folds are individually switchable');
  ok(N.orthographyProblem('مدرسةا') && N.orthographyProblem('ءكل') && N.orthographyProblem('كتإ') && N.orthographyProblem('كككك') && !N.orthographyProblem('مدرسة') && !N.orthographyProblem('بدأ'), 'orthography rules');
}

group('evidence sources');
{
  const src = w => V.validateWord(w).source;
  ok(src('كتاب') === 'lexicon' && src('مدرسة') === 'lexicon' && src('في') === 'lexicon', 'listed forms -> lexicon');
  ok(src('يكتبون') === 'morphology' && src('كتابان') === 'morphology' && src('معلمون') === 'morphology', 'regular inflection -> morphology');
  ok(src('والكتاب') === 'clitic' && src('كتابها') === 'clitic' && src('سيكتبونه') === 'clitic', 'clitics -> clitic');
  const r = V.validateWord('وبمدرستها');
  ok(r.valid && r.lemma === 'مدرسة' && r.analysis.prefix === 'وب' && r.analysis.suffix === 'ها' && r.confidence < 1, 'analysis reports lemma, prefix and suffix: ' + JSON.stringify(r.analysis));
  ok(V.validateWord('كتاب').confidence === 1 && V.validateWord('كتاب').normalized === 'كتاب', 'confidence / normalized');
}

group('verb paradigms (accepted)');
{
  const must = {
    sound: 'كتب كتبت كتبا كتبتا كتبوا كتبن كتبتما كتبتم كتبتن كتبنا يكتب تكتب أكتب نكتب يكتبان تكتبان يكتبون تكتبون يكتبن تكتبين يكتبا يكتبوا تكتبي اكتب اكتبي اكتبا اكتبوا اكتبن كاتب كاتبة كاتبون مكتوب مكتوبة كتابة سيكتب ليكتب فليكتب كتبوه كتبتموه اكتبوه يكتبها',
    hollow: 'قال قالت قالوا قلن قلت قلنا يقول تقولين يقلن يقل قل قولي قولوا قائل مقول باع بعت يبيع بع بائع مبيع خاف خفت يخاف خائف كان كنا كنت يكون يكن كن',
    defective: 'دعا دعت دعوا دعون دعوت دعونا يدعو يدعون تدعين يدعوا ادع ادعي ادعوا داع داعية مدعو دعاه رمى رمت رميا رموا رمين رميت يرمي ترمين يرم ارم رماه نسي نسيت نسوا ينسى ينساه سعى يسعى',
    doubled: 'مد مدت مددت مددنا يمد يمددن يمدد مدي امدد ماد ممدود',
    assimilated: 'وصل وصلت يصل تصلين صل صلي واصل',
    hamza: 'أكل أكلت يأكل آكل كل كلوا مأكول أخذ خذ آخذ قرأ قرؤوا يقرأ اقرأ قارئ سأل يسألون اسأل مسؤول',
    'II-X': 'درس يدرس مدرس شارك يشارك مشاركة أكرم يكرم إكرام أقام يقيم أقمت إقامة أعطى يعطي أعطيت آمن يؤمن مؤمن إيمان أكد يؤكد تعلم يتعلم تمنى يتمنى تعاون يتعاون انكسر ينكسر انقاد ينقاد اجتمع يجتمع اجتماع اختار يختار اخترت اختيار اشترى يشتري اتصل يتصل اتصال ازدحم اصطدم اهتم يهتم اهتمام استخدم يستخدم استخدام استفاد يستفيد استفادة استمر يستمر استمرار استدعى استيقظ ترجم يترجم تدحرج',
    irregular: 'رأيت يرى رأوا جاء جاؤوا شئت ليس لست عسى اتخذ'
  };
  for (const [k, v] of Object.entries(must)) {
    const miss = words(v).filter(w => !V.validateWord(w).valid);
    ok(miss.length === 0, `${k}: rejected ${miss.join(' ')}`);
  }
}

group('nouns, adjectives, clitics, function words (accepted)');
{
  const must = 'كتاب الكتاب والكتاب بالكتاب للكتاب كتابه كتابها كتابهم كتابك كتابي كتابنا كتب الكتب كتابان كتابين مدرسة المدرسة مدرستان مدرستها بمدرسته للمدرسة مدارس معلم معلمون معلمين معلموه معلمات معلمة كبير كبيرة كبار الكبير مستشفى مستشفاه مستشفيات سماء ماء مياه أبوه أباه أبيه أخوه أخيه من منه منها منهم مني منا عن عني عنا في فيه علي عليه عليهم إلى إليه إلي إليك له لها لهم لك لي به بها بهم بك بي بنا معه معي معنا لديه إنه إنها إنهم إنني إني إنا إننا لكنه ليتني لعله لأنه وإن فإن ولكن والذي بالذي للذي والتي الذين اللذان وهذا بهذا لهذا لذلك بذلك كذلك وما بما لما بمن لمن لقد ولقد والآن للآن كلاهما سواه غيرها';
  const miss = words(must).filter(w => !V.validateWord(w).valid);
  ok(miss.length === 0, 'rejected: ' + miss.join(' '));
}

group('rejections and their reasons');
{
  const why = (w, o) => V.validateWord(w, o).reason;
  ok(why('الكتساب') === 'NOT_IN_LEXICON' && V.validateWord('الكتساب').status === 'invalid', 'made-up word -> NOT_IN_LEXICON');
  ok(why('غغغ') === 'NOT_IN_LEXICON' && why('قطتبل') === 'NOT_IN_LEXICON', 'gibberish');
  ok(why('كتب1') === 'NOT_ARABIC' && why('book') === 'NOT_ARABIC' && why('كت ب') === 'NOT_ARABIC', 'non-Arabic characters');
  ok(why('ك') === 'TOO_SHORT' && why('') === 'EMPTY' && why('   ') === 'EMPTY' && why(null) === 'EMPTY', 'too short / empty / null');
  ok(why('ا'.repeat(16)) === 'TOO_LONG', 'too long');
  ok(why('مدرسةا') === 'INVALID_ORTHOGRAPHY' && why('ءكل') === 'INVALID_ORTHOGRAPHY' && why('ككككتاب') === 'INVALID_ORTHOGRAPHY', 'impossible orthography');
  const bad = words('يكتبي سكتب ببب الكتابه المدرسه قالن يرمو سيكتبو وأل الم اكل ال يكتبنا? ضربب').filter(w => !w.endsWith('?'));
  const acc = bad.filter(w => V.validateWord(w).valid);
  ok(acc.length === 0, 'must be rejected in Expanded but accepted: ' + acc.join(' '));
  ok(V.validateWord('الكتاب').valid && !V.validateWord('الكتابه').valid, 'article + suffix never combine; ة is not ه');
}

group('Expanded vs Basic');
{
  const E = w => V.validateWord(w, { mode: 'expanded' }), B = w => V.validateWord(w, { mode: 'basic' });
  ok(E('حديقة').valid && !E('حديقه').valid && E('طاولة').valid && !E('طاولة'.slice(0, -1) + 'ه').valid, 'Expanded: ة and ه are different letters (حديقه is not a word)');
  ok(B('حديقه').valid && B('طاوله').valid, 'Basic: ة is spelled ه');
  ok(E('مدينه').valid, 'a ه spelling that is ANOTHER real word (مدين + ه) is valid: validity is about the word, not the spelling');
  ok(!E('اكل').valid && E('أكل').valid && B('اكل').valid, 'Expanded: أ ≠ ا; Basic: اكل is how أكل is spelled');
  ok(B('مقهي').valid && E('مقهى').valid && !E('مقهي').valid, 'Basic: ى is spelled ي (مقهى)');
  ok(B('مستشفي').valid && E('مستشفى').valid, 'Basic: مستشفي');
  ok(B('مدرسة').reason === 'MODE_LETTER_UNAVAILABLE' && B('أكل').reason === 'MODE_LETTER_UNAVAILABLE', 'Basic: an Expanded-only letter cannot be played');
  ok(!B('ماء').valid && B('ماء').reason === 'MODE_LETTER_UNAVAILABLE', 'Basic: stand-alone hamza unavailable');
  ok(B('الكتاب').valid && B('يكتبون').valid && B('وبكتابه').valid, 'Basic keeps the clitic grammar');
  ok(B('بمدرسته').valid, 'Basic: بمدرسته (ة→ت before the suffix) is spellable and valid');
  ok(E('للمستشفى').valid && B('للمستشفي').valid, 'article merges with ل in both modes');
  ok(V.validateWord('كتاب').normalized === 'كتاب', 'default mode is Expanded');
}

group('strictness tiers');
{
  const S = (w, s) => V.validateWord(w, { strictness: s }).valid;
  ok(S('كتاب', 'strict') && S('مدرسة', 'strict') && S('كتب', 'strict'), 'strict: listed forms');
  ok(!S('كتابه', 'strict') && !S('يكتبون', 'strict') && !S('معلموه', 'strict') && !S('كتابان', 'strict'), 'strict: no inflection or clitics from my rules (the bank, being a list of words, still counts)');
  ok(S('كتابه', 'hybrid') && S('يكتبون', 'hybrid') && S('والكتاب', 'hybrid'), 'hybrid: morphology + clitics');
  ok(!S('كتابا', 'hybrid') && S('كتابا', 'extended'), 'extended adds tanween alif');
  ok(!S('قلمات', 'hybrid') && S('قلمات', 'extended') && !S('شمسات', 'hybrid') && S('شمسات', 'extended'), 'extended adds sound plurals that no flag backs');
  for (const w of words('كتاب مدرسة يكتب والكتاب')) ok(S(w, 'extended') === true, 'extended ⊇ hybrid for ' + w);
}

group('unknown-word policy and aggregates');
{
  const rj = V.validateWord('الكتساب', { unknown: 'reject' }), tk = V.validateWord('الكتساب', { unknown: 'tahkim' });
  ok(rj.status === 'invalid' && !rj.valid && tk.status === 'uncertain' && !tk.valid && tk.reason === 'NOT_IN_LEXICON', 'reject vs tahkim');
  ok(V.validateWord('ك', { unknown: 'tahkim' }).status === 'invalid', 'policy only softens NOT_IN_LEXICON, never structural failures');
  const a = V.validateWords(['كتاب', 'الكتساب', 'المدرسة']);
  ok(a.status === 'invalid' && !a.valid && a.invalid.length === 1 && a.invalid[0].word === 'الكتساب' && a.accepted.length === 2, 'aggregate: invalid wins');
  const b = V.validateWords(['كتاب', 'الكتساب'], { unknown: 'tahkim' });
  ok(b.status === 'uncertain' && b.uncertain.length === 1 && b.invalid.length === 0, 'aggregate: uncertain');
  const c = V.validateWords(['كتاب', 'المدرسة']);
  ok(c.status === 'valid' && c.valid && c.results.length === 2, 'aggregate: valid');
  ok(V.validateWords([]).status === 'valid', 'no words -> nothing to reject');
}

group('stability');
{
  const w = words('كتاب يكتبون والكتاب الكتساب'), first = w.map(x => V.validateWord(x).status).join();
  ok(first === w.map(x => V.validateWord(x).status).join(), 'cached results equal fresh results');
  const t0 = performance.now(); let n = 0;
  for (let i = 0; i < 3000; i++) { V.validateWord('ق' + String.fromCharCode(0x0621 + (i % 40)) + String.fromCharCode(0x0621 + ((i * 7) % 40)) + 'ن'); n++; }
  ok(performance.now() - t0 < 1500, `3000 uncached lookups in ${(performance.now() - t0).toFixed(0)} ms`);
  ok(loadMs < 1500, `load + parse ${loadMs} ms`);
  const t1 = performance.now(); V.validateWord('كتاب', { mode: 'basic' }); const buildMs = performance.now() - t1;
  ok(buildMs < 1500, `first Basic lookup (builds the Basic index) ${buildMs.toFixed(0)} ms`);
  ok(JSON.stringify(V.validateWord('Z')) !== undefined, 'never throws on odd input');
  for (const odd of [undefined, null, 0, {}, [], '\u0000', '😀', 'كتاب\n', ' كتاب ']) { try { V.validateWord(odd); pass++; } catch (e) { ok(false, 'threw on ' + String(odd) + ': ' + e.message); } }
  ok(V.validateWord(' كتاب ').valid && V.validateWord('كتاب\n').valid, 'surrounding whitespace is trimmed');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
