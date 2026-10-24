# Validator audit: word bank, grammar gaps, and what was done

Everything below was measured on the delivered data, not estimated. The commands that reproduce each number are in `tools/` and `tests/`.

## 1. What the word bank is (and is not)

`Arabic.txt`: 5,691,498 comma-separated entries, no diacritics, one stray non-letter (`د.`).

- **It is machine-generated, not a list of attested words.** The same stems appear with every prefix/suffix combination (69% of entries start with و ف ل). A stem set that includes obscure roots was expanded by a grammar-aware generator, then (it appears) **about half of every paradigm was dropped**: the bank holds only ~58% of the forms of any verb I tested, and even `كتبوا`, `يكتبون`, `تكتب` are absent. Its absence is therefore *not* evidence of invalidity.
- **It contains noise.** About 400 three-letter entries have no variants at all (`آتن أؤذ أثد أصع`), ~1,000 entries were wrongly spelled `…آ`, and the 2-letter list covers 56% of all letter pairs. Bank-only words of ≤4 letters are mostly junk (`فغنه فثلن ببزك`).
- **It is not a superset of ordinary vocabulary.** It lacks `رجال`, `مدرسة`, `جامعة`, `مفتاح` and many plurals.

Consequence: the bank can only be used as **evidence combined with the grammar**, never as the sole authority.

## 2. Issues found in the previous validator, and the fixes

| # | Issue | Evidence | Fix |
|---|---|---|---|
| 1 | Coverage: ~2,500 hand-written entries | rejected **84%** of the bank's core forms | bank integrated (below) + 3,230 mined verb stems + 68,186 mined noun stems |
| 2 | **No passive voice** (`فعل ما لم يسم فاعله`) | `قيل يقال دعي يدعى يوجد يؤكل أقيم يراد اختير استفيد يستفاد سئل قرئ` all rejected | `emitPassive`: hollow, defective, assimilated, hamza-initial, derived IV/VIII/X/II, medial and final hamza; passive forms take no object suffix (`PP/PI/PJ/PB` classes) |
| 3 | Hamza-initial imperatives | `ائذن ائسر ائمن ائت` rejected | `ائ`+stem rule, `@ih` keeps `كل خذ مر` |
| 4 | Final-hamza verbs only as explicit lists, no passive | `قرئ قرئت يقرأون قرآ مقروءة` | one generator for the family (`قرأ بدأ ملأ برأ خبأ …`) incl. seats ؤ ئ أ آ |
| 5 | Medial hamza | `سئل سئلت مسؤول سائل` | derived in the sound class |
| 6 | Form IX missing | `احمر احمرار اخضر` | Form IX + masdar |
| 7 | **Hamza seats before suffixes** | `ماؤه مائه سمائها شيئه` rejected (ء-final nouns took no suffix at all) | attach kind `hamza`: ؤ/ئ/ء by case; duals `سماوان دعاءان` |
| 8 | Defective nouns | `قاضي القاضي قاضيان محاميان` | flag `@df` |
| 9 | **Interrogative أ** | the bank is full of `أيحرسانك`-type forms | prefix group in the clitic grammar |
| 10 | **Lam of emphasis/oath before verbs** | 4,668 of the bank's words become valid after dropping a leading `ل` (`لأبدلت لأباري`) | `lamEmph` group for VP/VI/VB/VJ/F |
| 11 | Nouns ending in ي refused the possessive ي | `آدميي إرهابيي` | exclusion limited to prepositions (`فيي`) |
| 12 | `ن`/`ت` merge before a suffix | `كنا سكنا` generated as `كننا` | `join()` |
| 13 | Orthography rule rejected a **final `آ`** | silently dropped ~1,030 valid bank words (`بدآ قرآ`) | rule corrected, bank rebuilt |
| 14 | **Hang on a damaged/empty bank file** | `Dawg.has` looped forever on `undefined & 128` | bounds checks in every scan loop; test with an empty array |
| 15 | Basic-mode alternates skipped for unspellable forms | `ماؤه → ماوه` failed | alternate stems are indexed even when the form itself has a stand-alone ء |
| 16 | Startup test had never run (silent `MutationObserver` crash) | 0 assertions executed | harness fixed (also `dialog.show`, window size) |

## 3. How the bank is integrated

1. **`tools/build-bank.mjs`** normalises, drops impossible spellings, and classifies by **corroboration**: a word is *corroborated* if other words are built on it with clitics or if it is itself built on another bank word. Result: **5,558,230 corroborated (97.7%)**, **133,226 weak**. Words of ≤3 letters also need ≥6 attested variants.
2. A **minimal word automaton** stores them: 5.56M words → 214,582 nodes → **4.3 MB (2.3 MB gzipped)**, built in ~5 s, queried in microseconds, **exact** (no false positives, unlike a Bloom filter). Basic-mode lookups walk the same automaton with letter alternatives (ا→أ إ آ, ه→ة, ي→ئ ى, و→ؤ), so no second copy is needed.
3. **`tools/mine-bank.mjs`** finds stems the bank *proves* exist and lets the grammar complete the paradigms the bank dropped:
   - verbs: every sound root × forms I III V VI VII VIII X, kept when ≥45% of the form's **distinctive** slots are in the bank *and* both perfect and imperfect forms are attested (the ratio histogram is bimodal: strays give a few hits, real verbs ~half; the boundary was inspected by hand);
   - Form IV via the doubled-hamza evidence (`أأ`+root+suffix), a **clean bimodal split with an empty gap at 3** → 411 roots;
   - nouns: every `[و|ف][ب|ك]ال+X` / `لل+X` proves X is a noun form.
   Result: 3,230 verbs + 68,186 noun stems → 236,924 expanded entries → **0.3 MB**.
4. **`validateWord` order:** my lexicon and rules → mined stems → bank (strong) → bank (weak). Statuses: `valid`, `invalid`, `uncertain` (reason `WEAK_EVIDENCE`), `unavailable`.

### Why some bank words are only "uncertain"

- **Weak tier** (isolated words): `uncertain`, accepted provisionally by the game with ؟, challengeable by Tahkim. 57% of sampled weak words are rescued by the grammar/mined stems and become `valid`.
- **Bank-only words of ≤4 letters** (`rules.json → bank.shortWords`): `uncertain` unless a rule or mined stem also vouches for them. Short strings are where generator noise is densest and a wrong acceptance matters most in a competition. Both are overridable per call (`weak`, `short`: `accept | uncertain | reject`) or globally in `rules.json`.
- While the bank is still downloading, "not found" is reported `uncertain` (`partial: true`), never `invalid`.

## 4. Measured results

| | before | after |
|---|---|---|
| lexicon entries | ~2.5k entries, ~50k forms | + 5.56M bank words, 3.2k mined verbs, 68k mined nouns |
| bank words the **grammar + mined stems alone** derive | n/a (rejected 84% of core forms) | **81.1%** (36% at 2 letters → 91% at 13) |
| random-string acceptance, Expanded, lengths 2/3/4/5/6/7/8 | 20 / 10 / 2.5 / 0.4 / 0 / – / – % (rules only) | valid 20.0 / 24.5 / 8.7 / 2.1 / 0.3 / 0.0 / 0.0 %, plus uncertain 34 / 14 / 2 % at 2–4 letters |
| shipped data | 90 KB | +2.9 MB gzipped (bank 2.33, weak 0.26, mined 0.31) |
| 20,000 uncached lookups | – | 69 ms |

**The honest trade-off:** a larger lexicon raises the share of short random strings that happen to be words. Random 5-letter strings are still accepted only ~2% of the time, and 6+ letters essentially never; at 2–3 letters the rate is high because short words are dense in Arabic *and* in the bank. Use `short: 'reject'` for the strictest competition setting.

## 5. Tests

`tests/logic/`: `validator` 81, `grammar` 39 (rules only, so engine bugs cannot hide behind the bank), `bank` 42, `validation-flow` 35, `validation-fallback` 9, `engine` 136, `startup` 16. `tests/layout/validation-browser` 10 (real Chromium: gzip decoding, loading over HTTP). A mutation check (deliberately broken validator) is caught.
The layout suites `history-toggle*` have 10 failing assertions that are **identical on your untouched original**: `baseline.json` predates the icon-only button default.

## 6. Known limits

- Stems the bank neither lists nor evidences (rare roots, many weak/hamzated roots, proper nouns) are not derived. The bank + mined stems cover far more than the hand lexicon, but are not a dictionary.
- Mined Form I verbs have no hand-assigned transitivity: passive *participles* are generated only when the bank attests them.
- Form II shares Form I's conjugation spellings, so only Form I is mined; Form VII is mined but yields few roots (7).
- The bank's provenance and licence are unknown to me; `bank.meta.json` records its SHA-256 for traceability. Confirm you may redistribute it.
- The first moves of a session (before the 2.9 MB download finishes) treat unknown words as provisional.
