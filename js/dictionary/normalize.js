// Validator-only text normalisation. Pure functions, no DOM, no data.
// IMPORTANT: this never changes the tiles on the board. It only builds the representations the
// validator compares against the lexicon:
//   surface  what was passed in
//   strict   Unicode-normalised, without harakat / tatweel / invisible characters. Letters are untouched:
//            أ إ آ ء ؤ ئ ة ى stay distinct. This is the form the Expanded mode is checked against.
//   lookup   controlled equivalence (alif / hamza seats / ta marbuta / alif maqsura folded), configurable
//   basic    what a player can physically spell with the 28 Basic tiles (null when impossible)

// Harakat, Quranic marks, superscript alif and tatweel.
const MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]/g;
// Zero-width and bidi control characters that sneak in from copy/paste.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
// The 36 letters used by the game (hamza .. ghayn, fa .. ya).
const ARABIC_ONLY = /^[\u0621-\u063A\u0641-\u064A]+$/;

export const BASIC_LETTERS = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';
export const EXPANDED_ONLY = 'أإآءؤئةى';

export const BASIC_PROJECTION = Object.freeze({ 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و', 'ئ': 'ي', 'ة': 'ه', 'ى': 'ي' });

export const FOLD_ALL = Object.freeze({ alif: true, hamzaSeat: true, taMarbuta: true, maqsura: true });
const FOLDS = {
  alif: { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا' },
  hamzaSeat: { 'ؤ': 'و', 'ئ': 'ي' },
  taMarbuta: { 'ة': 'ه' },
  maqsura: { 'ى': 'ي' }
};

export function strictForm(surface) {
  return String(surface ?? '').normalize('NFKC').replace(INVISIBLE, '').replace(MARKS, '').replace(/\u0671/g, 'ا').trim();
}

export const isArabicWord = strict => ARABIC_ONLY.test(strict);

// Controlled equivalence: only the folds that are switched on are applied.
export function foldLookup(strict, folds = FOLD_ALL) {
  const maps = Object.keys(FOLDS).filter(k => folds[k]).map(k => FOLDS[k]);
  let out = '';
  for (const ch of strict) { let c = ch; for (const m of maps) if (m[c] !== undefined) { c = m[c]; break; } out += c; }
  return out;
}

// Spelling of `strict` using only the 28 Basic letters. `map` may contain '' to drop a letter;
// a letter with no mapping that is not a Basic letter (the stand-alone hamza by default) makes the word unspellable.
export function projectBasic(strict, map = BASIC_PROJECTION) {
  let out = '';
  for (const ch of strict) {
    if (map[ch] !== undefined) out += map[ch];
    else if (BASIC_LETTERS.includes(ch)) out += ch;
    else return null;
  }
  return out;
}

export function representations(surface, { folds = FOLD_ALL, basicMap = BASIC_PROJECTION } = {}) {
  const strict = strictForm(surface);
  return { surface: String(surface ?? ''), strict, lookup: foldLookup(strict, folds), basic: projectBasic(strict, basicMap) };
}

// Orthographic impossibilities in standard Arabic spelling (independent of any lexicon).
// ة and ى only close a word; ء ئ ؤ never open one; إ never closes one; four identical letters in a row do not occur.
export function orthographyProblem(strict) {
  const last = strict.length - 1;
  for (let i = 0; i <= last; i++) {
    const ch = strict[i];
    if ((ch === 'ة' || ch === 'ى') && i !== last) return 'MISPLACED_FINAL_LETTER';
    if (i === 0 && (ch === 'ء' || ch === 'ئ' || ch === 'ؤ')) return 'MISPLACED_HAMZA';
    if (i === last && ch === 'إ') return 'MISPLACED_HAMZA';            // final آ is real: the dual of a final-hamza verb (قرآ، بدآ)
  }
  return /(.)\1{3,}/.test(strict) ? 'REPEATED_LETTER' : null;
}
