# Automatic word validation

Everything lives in `js/validator.js`, `js/wordcheck.js` and `js/dictionary/`. No build step, no external service, no dependency. The audit that led to the current design, with all measurements, is in [`validator-audit.md`](validator-audit.md).

## How a word is judged

`validateWord(word, { mode, strictness, unknown })` returns

```js
{ word, normalized, valid, status, source, confidence, reason, lemma, analysis }
// status: 'valid' | 'invalid' | 'uncertain' | 'unavailable'
// source: 'lexicon' | 'morphology' | 'clitic'
// reason: EMPTY NOT_ARABIC TOO_SHORT TOO_LONG MODE_LETTER_UNAVAILABLE INVALID_ORTHOGRAPHY NOT_IN_LEXICON DICTIONARY_UNAVAILABLE
```

`validateWords(words, options)` aggregates a move: `{ status, valid, results, accepted, invalid, uncertain, summary }` (`invalid` wins over `uncertain`).

1. **Normalise** (`normalize.js`): NFKC, harakat / tatweel / zero-width marks removed. Letters are *not* folded: `أ إ آ ء ؤ ئ ة ى` stay distinct.
2. **Structural checks**: Arabic letters only, length 2–15, no Expanded-only letter in Basic mode, no impossible orthography (`ة`/`ى` not final, `ء ئ ؤ` initial, `إ آ` final, four identical letters).
3. **Evidence**, taken from the lexicon index:
   - *lexicon*: the exact form is listed (my lexicon, or the word bank: `source: 'bank'`);
   - *morphology*: generated from a trusted stem by a named rule (`morphology.js`);
   - *clitic*: `[و|ف] [ب|ل|ك|س|ل-أمر] [ال] STEM [ضمير]`, where the stem's grammar class permits that exact combination (`affixes.json`; the article never combines with a suffix; `لل`, `ة→ت`, `ى→ا`, `وا→و`, `تم→تمو`… are modelled).
   - *mined stems*: stems the word bank proves exist, completed by the same grammar (`mined.bin.gz`);
   - *weak evidence*: words only the isolated tail of the bank vouches for, and bank-only words of ≤4 letters, are `uncertain` (`WEAK_EVIDENCE`);
4. Otherwise `NOT_IN_LEXICON`, which the `unknown` option turns into `invalid` (`'reject'`, default) or `uncertain` (`'tahkim'`).

### Modes

| | Expanded | Basic |
|---|---|---|
| Compared against | exact orthography | the 28-letter spelling the tiles can form |
| `مدينة` / `مدينه` | valid / invalid | invalid (needs `ة`) / valid |
| `أكل` / `اكل` | valid / invalid | invalid / valid |
| stand-alone `ء` (`ماء`) | valid | cannot be played |

`rules.json → basic.policy: "strict"` makes Basic mode require the exact orthography instead (words with hamza/`ة`/`ى` then become unplayable in Basic).

### Strictness (`rules.json → strictness`)

`strict` listed forms only · `hybrid` (default) + regular morphology and clitics · `extended` + tanween alif and sound plurals that no flag backs.

## Data (`js/dictionary/data/`)

| File | Content |
|---|---|
| `rules.json` | tiers, length limits, Basic projection, confidence, **list of data files** |
| `affixes.json` | clitic grammar: prefix groups, pronoun-suffix sets, per-class permissions |
| `core.json` | function words in sets, each with a grammar class |
| `nouns-*.txt` | `singular [plurals…] [@un @at @nd @adj @np]` |
| `verbs.txt` | Form I `perfect[:imperfect] [masdars…] [@i @np @ni @ih @nm]`; Forms II–X `root @2…@10`; `@q`/`@q2` quadriliteral |
| `verbs-irregular.txt` | explicit paradigms (`= lemma VP: … VI: … VJ: … VM: … N: …`) for hamza verbs, `رأى جاء شاء ليس` … |
| `extra.txt` | exact words (no inflection, no clitics): the import target |
| `bank.bin.gz`, `bank-weak.bin.gz` | the word bank compiled to word automata (`tools/build-bank.mjs`); `bank.meta.json` records source, SHA-256 and counts |
| `mined-verbs.txt`, `mined-nouns.txt`, `mined.bin.gz` | stems mined from the bank (`tools/mine-bank.mjs`) and their compiled expansion (`tools/build-mined.mjs`); the `.txt` files are reviewable and editable |

Flags: `@df` defective noun (قاض) · `@dw` dual with و (سماوان) · `@na` no active participle · `@pass` force a passive for an `@i` verb · `@un` sound masculine plural · `@at` sound feminine plural · `@nd` no dual · `@adj` regular feminine (`كبير → كبيرة`) · `@np` no pronoun suffix · `@i` intransitive (no Form I passive participle) · `@ni` no imperative · `@ih` hamza dropped in imperative (`كل خذ مر`) · `@nm` no regular masdar.

Forms II–X take a **root** (weak letters written as `و`/`ي`): `قوم @4` → `أقام يقيم أقمت إقامة مقيم`. Hollow, defective, doubled and assimilated Form I verbs are recognised from the `perfect:imperfect` pair (`قال:يقول`, `رمى:يرمي`, `نسي:ينسى`, `مد:يمد`, `وصل:يصل`).

### Passive voice

Generated for every transitive verb (not `@i`): hollow `قال → قيل / يقال`, defective `دعا → دعي / يدعى`, assimilated `وضع → يوضع`, hamza-initial `أكل → يؤكل`, final/medial hamza `قرأ → قرئ`, `سأل → سئل`, and the derived forms (`أقيم / يقام`, `اختير`, `استفيد / يستفاد`, `أعطي / يعطى`, `سمي / يسمى`). Passives spelled like the active (`كُتب`) need nothing. Passive forms take no object suffix.

### Rebuilding the bank data

```
node tools/build-bank.mjs Arabic.txt --source "bank name, licence"   # bank.bin.gz, bank-weak.bin.gz, bank.meta.json
node tools/mine-bank.mjs                                             # mined-verbs.txt, mined-nouns.txt
node tools/build-mined.mjs                                           # mined.bin.gz
node tools/validate-dictionary.mjs && (cd tests && node run-all.mjs)
```
Review `mined-verbs.txt` / `mined-nouns.txt` and delete any line you distrust before running `build-mined.mjs`. Thresholds: `--min-ratio` (verbs), `--noun-min`, `--min-iv` (Form IV), `--min-alive` (short words) on the respective tools; policy for weak and short bank words is in `rules.json → bank`.

### Adding words

1. Append a line to the right file (a new noun: `حاسوب حواسيب`; a new verb: `كتب كتابة`).
2. `node tools/validate-dictionary.mjs` (flags typos and unsupported patterns), then `npm test` in `tests/`.
3. Bulk import: `node tools/import-wordlist.mjs words.txt --source "list name, licence"`; words the lexicon already accepts are skipped, the rest go to `extra.txt` with the source in a header comment.

**Licensing.** The bundled lexicon was written for this project. Large public Arabic lexicons (Hunspell/Ayaspell, Arramooz, the Quranic corpus…) are typically GPL-licensed: check that you may redistribute a list with this repository before importing it.

## Known limits

- The starter lexicon is small compared with a real dictionary. Rare words, proper nouns, loanwords and colloquial forms are mostly absent: use *تلقائي + تحكيم* or import a list.
- Forms are generated from rules, so an occasional over-generation is possible for a rare stem (e.g. a passive participle of a verb not flagged `@i`). The data prefers omission over guessing.
- Hamza-final verbs (`قرأ بدأ ملأ نشأ هدأ`), medial-hamza `سأل` and a few irregular verbs are explicit paradigms; other weak/hamzated patterns need an explicit paradigm too.
- Active participles of derived defective verbs, `-ة` forms of defective participles other than Form I, and tanween on ء-final nouns are not modelled.
- Basic mode cannot spell a stand-alone `ء`, so those words are unplayable there by design.


## Unavailable / unverified (added with online play)
`js/wordpolicy.js` turns a validator result into a decision for a move and is shared by the local game and the online server. If the dictionary could not be loaded, **nothing was checked**: the move is not blocked, but every word is marked provisional (`؟`, message "تعذّر التحقق من الكلمات") and the stored state is `unavailable`; Tahkim settles it. If the dictionary is loaded but the word bank is not (still downloading or failed), a word that is merely "not in the lexicon" is provisional instead of invalid, because the bank might have vouched for it. Structurally impossible words stay invalid.

**TODO: Confirm external Arabic word-bank provenance and redistribution license before public/commercial distribution.**
