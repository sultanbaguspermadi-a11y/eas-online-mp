// Word policy when the BANK is missing (dictionary rules loaded, word bank not): "not found" must be provisional, never a verdict.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import * as V from '../../supabase/functions/_shared/game/validator.js';
import { evaluateMove } from '../../supabase/functions/_shared/game/wordpolicy.js';
import { suite } from './lib.mjs';
const { ok, group, done } = suite('word policy: bank unavailable');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), file = n => path.join(ROOT, 'js/dictionary/data', n);
await V.loadDictionary({ fetchText: n => fs.readFileSync(file(n), 'utf8'), fetchBytes: n => fs.readFileSync(file(n)), bank: 'skip' });
group('rules loaded, no bank');
const g = evaluateMove(['قطبل'], { policy: 'auto', mode: 'expanded' });
ok(!g.reject && g.state === 'uncertain' && g.unverified.has('قطبل'), 'a word missing from the lexicon is provisional while the bank is absent: ' + g.state);
const k = evaluateMove(['كتاب'], { policy: 'auto', mode: 'expanded' });
ok(!k.reject && k.state === 'valid', 'a lexicon word is still verified');
const bad = evaluateMove(['abc'], { policy: 'auto', mode: 'expanded' });
ok(bad.reject, 'structurally impossible words stay rejected');
ok(evaluateMove(['قطبل'], { policy: 'off', mode: 'expanded' }).state === 'skipped', 'policy off skips');
done();
