// The grammar engine on its own: rules only (no word bank, no mined stems), so a bug here cannot hide behind bank coverage.
// Passive voice (fi'l majhul), taṣrīf of every supported verb class, hamza orthography, defective nouns, Form IX, the interrogative أ.
import fs from 'fs';
import path from 'path';
import { ROOT } from './harness.mjs';
const V = await import(`${ROOT}/js/validator.js`);
const N = await import(`${ROOT}/js/dictionary/normalize.js`);
const file = n => path.join(ROOT, 'js', 'dictionary', 'data', n);
await V.loadDictionary({ fetchText: n => fs.readFileSync(file(n), 'utf8'), bank: 'skip' });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const group = n => console.log('\n# ' + n);
const words = s => s.split(/\s+/).filter(Boolean);
const accepts = (title, list) => { const miss = words(list).filter(w => !V.validateWord(w).valid); ok(miss.length === 0, `${title}: rejected ${miss.join(' ')}`); };
const rejects = (title, list) => { const acc = words(list).filter(w => V.validateWord(w).valid); ok(acc.length === 0, `${title}: wrongly accepted ${acc.join(' ')}`); };

group('passive voice: hollow verbs (قال → قيل / يقال)');
accepts('Form I perfect', 'قيل قيلت قيلا قيلتا قيلوا بيع بيعت بيعوا زيد زيدت سيق سيقت');
accepts('Form I imperfect', 'يقال تقال أقال نقال يقالان تقالان يقالون تقالين يقالوا يباع تباع يباعون يزاد يساق');
accepts('Form IV (أقام → أقيم / يقام)', 'أقيم أقيمت أقيموا يقام تقام يقامون أريد أريدت يراد تراد يجاب تجاب يعاد يضاف يفاد يدار');
accepts('Form VIII (اختار → اختير)', 'اختير اختيرت اختيروا احتيج احتيجت');
accepts('Form X (استفاد → استفيد / يستفاد)', 'استفيد استفيدت استفيدوا يستفاد تستفاد يستفادون');

group('passive voice: defective verbs (دعا → دعي / يدعى)');
accepts('Form I perfect', 'دعي دعيت دعيا دعيتا دعوا دعين دعيتم رمي رميت بني بنيت');
accepts('Form I imperfect', 'يدعى تدعى أدعى يدعيان يدعون تدعين يدعوا يرمى يبنى تبنى يبنيان');
accepts('hamza-initial defective (أتى → أتي / يؤتى)', 'أتي أتيت يؤتى تؤتى أؤتى نؤتى');
accepts('derived defective', 'أعطي أعطيت أعطيا يعطى تعطى أنهي ينهى أبقي يبقى أجري يجرى سمي سميت سميا يسمى تسمى ربي يربى اشتري اشتريت يشترى استدعي استدعيت يستدعى');

group('passive voice: assimilated and hamza-initial verbs');
accepts('assimilated (وضع → يوضع, the و returns)', 'يوضع توضع أوضع نوضع يوضعان يوضعون توضعين يوجد توجد يولد تولد يوعد يوهب يوزن');
accepts('hamza-initial (أكل → يؤكل)', 'يؤكل تؤكل أؤكل نؤكل يؤخذ تؤخذ يؤخذون يؤمر تؤمر أؤمر');

group('passive voice: hamza seats');
accepts('final hamza (قرأ → قرئ)', 'قرئ قرئت قرئا قرئتا قرئوا قرئن قرئتم بدئ بدئت ملئ ملئوا');
accepts('medial hamza (سأل → سئل)', 'سئل سئلت سئلا سئلوا سئلن سئلتم');
accepts('participles', 'مسؤول مسؤولة سائل سائلة مقروء مقروءة مقروءان مملوء قارئ قارئة قارئان قارئون قارئين قارئات بادئ');

group('passive voice: what must NOT be accepted');
rejects('wrong passive shapes', 'قيلن يقالن دعيوا يدعيون ائكل ائخذ أقيمن يؤكلن? قرئوه قيله'.replace('يؤكلن?', ''));
ok(!V.validateWord('قيله').valid && !V.validateWord('قرئوه').valid, 'passive verbs take no object suffix');
// intransitive verbs have no regular passive: خاف (@i) has no خيف
ok(!V.validateWord('خيف').valid, 'an intransitive hollow verb (خاف) has no regular passive');

group('verbal conjugations: the shapes that were missing');
accepts('hamza-initial imperatives', 'ائذن ائذني ائذنوا ائسر ائسري ائمن ائت ائتي ائتوا كل كلي كلوا خذ خذي خذوا مر');
accepts('final hamza paradigm', 'قرأ قرأت قرآ قرأتا قرؤوا قرأوا قرأن قرأتما قرأتم قرأتن قرأنا يقرأ تقرأ أقرأ نقرأ يقرآن تقرآن يقرؤون تقرؤون يقرأون تقرئين يقرأن اقرأ اقرئي اقرآ اقرؤوا اقرأوا اقرأن');
accepts('Form IX', 'احمر احمرت احمررت احمروا احمرا يحمر تحمر يحمررن احمرار محمر اخضر اخضرت يخضر اخضرار اصفر ازرق اشقر');
accepts('sound, all slots', 'كتب كتبت كتبا كتبتا كتبوا كتبن كتبتما كتبتم كتبتن كتبنا يكتب تكتب أكتب نكتب يكتبان تكتبان يكتبون تكتبون يكتبن تكتبين يكتبا يكتبوا تكتبي اكتب اكتبي اكتبا اكتبوا اكتبن');
accepts('ن and ت merge before a suffix (كنّا، سكنّا)', 'كنا كنت سكنا سكنت يسكن');
rejects('impossible slots', 'كتبتن? يكتبي سكتب يرمو سيكتبو يقولوا? قالن'.replace(/\S+\?/g, ''));

group('nouns: defective nouns, hamza seats, duals');
accepts('defective nouns (قاضٍ)', 'قاض قاضي القاضي قاضيان قاضيين قاضيه للقاضي قضاة محام المحامي محاميان محامون محاميه مغن المغني مغنون');
accepts('hamza seat follows the case vowel', 'ماؤه مائه ماءه ماؤها سمائه سماؤها سمائي جزؤه جزئه جزءه شيئه دعاءه دعائه دعاؤه');
accepts('duals of ء-final nouns', 'دعاءان جزءان سماوان صحراوان شتاءان');
rejects('no double hamza seat', 'ماءؤه مائؤه جزءئه');

group('the interrogative hamza (أ + word)');
accepts('with verbs, pronouns, particles', 'أكتبت أكتبوا أهذا أأنت أنحن أهو أهي أفكتب أولم أفلا أوما أتكتب أيكتب أمن أهل');
ok(!V.validateWord('أ').valid && !V.validateWord('أأ').valid, 'a lone أ is not a word');

group('the lam of emphasis / oath before verbs (لَـ)');
accepts('ل + perfect / imperfect / jussive spelling', 'لكتبت لقال لكتبوا لأكتب لنكتب ليكتبون لتكتبين ليكتبان فلأكتب ولنكتب ولقد لقد لأنت لهو');
rejects('ل never stands before something that is not a word', 'لقطبل لككتبك لأأ');

group('nouns ending in ي take the possessive ي (nisba): عربيي، كرسيي');
accepts('double ي', 'عربيي كرسيي عربيه عربيهم');
rejects('prepositions do not (فيّ is just في)', 'فيي عليي');
ok(V.validateWord('في').valid && V.validateWord('علي').valid, 'في and علي themselves are fine');

group('orthography rules');
ok(N.orthographyProblem('بدآ') === null && N.orthographyProblem('قرآ') === null, 'a final آ is the dual of a final-hamza verb: legal');
ok(N.orthographyProblem('كتإ') !== null, 'a final إ is not');

group('Basic mode keeps the new grammar');
{
  const B = w => V.validateWord(w, { mode: 'basic' });
  ok(B('يوجد').valid && B('يقال').valid && B('دعي').valid && B('يدعي').valid, 'passives in Basic spelling (ى → ي)');
  ok(B('ائذن').reason === 'MODE_LETTER_UNAVAILABLE', 'ئ is not a Basic letter');
  ok(B('مايه').valid && B('ماوه').valid, 'Basic spellings of the ء seats: ماؤه → ماوه, مائه → مايه');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
