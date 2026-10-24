// What a word-validation result means for a move, as a pure function of (words, policy, mode).
// Shared by the local game (wordcheck.js) and the online server so both apply the same policy:
//
//   auto    unknown words are rejected before the move is committed
//   tahkim  unknown words are accepted provisionally (marked ؟) and can be challenged with Tahkim
//   off     no automatic check: Tahkim only
//
// validation state reported back:  'valid' | 'uncertain' | 'unavailable' | 'skipped'
//   unavailable = the dictionary could not be used, so NOTHING was verified: every word is provisional (؟) and open to
//   Tahkim. It is never reported or displayed as "automatically verified".
import { loadDictionary, isDictionaryReady, isBankReady, validateWords } from './validator.js';

export const POLICIES = ['auto', 'tahkim', 'off'];

export const REASON_AR = {
  NOT_IN_LEXICON: 'غير موجودة في القاموس', WEAK_EVIDENCE: 'دليلها ضعيف في القاموس', INVALID_ORTHOGRAPHY: 'رسمها غير صحيح', MODE_LETTER_UNAVAILABLE: 'تحتاج حرفًا غير متاح في هذا النمط',
  NOT_ARABIC: 'ليست كلمة عربية', TOO_SHORT: 'قصيرة جدًا', TOO_LONG: 'طويلة جدًا', EMPTY: 'فارغة'
};
const shown = ws => ws.slice(0, 2).map(r => r.word).join('، ') + (ws.length > 2 ? '…' : '');

// Result: { reject, message?, unverified: Set<string>, note?, state }
export function evaluateMove(words, { policy, mode, ensureLoaded } = {}) {
  const none = { reject: false, unverified: new Set(), state: 'skipped' };
  if (policy === 'off') return none;
  if (!isDictionaryReady()) {
    // Explicit "unverified": the move is not blocked (fast, offline-friendly), but it is honest about not having been checked.
    if (ensureLoaded) ensureLoaded();
    return { reject: false, unverified: new Set(words), state: 'unavailable', note: '⚠ تعذّر التحقق من الكلمات — يمكن التحكيم' };
  }
  let v = validateWords(words, { mode, unknown: policy === 'tahkim' ? 'tahkim' : 'reject' });
  // Without the word bank (still downloading, or failed to load) "not in the lexicon" is not a verdict: a word the bank would have vouched for
  // would be wrongly rejected. Those words become provisional instead; structurally impossible words stay rejected.
  if (!isBankReady() && v.status === 'invalid') {
    const redo = v.results.map(r => (r.status === 'invalid' && r.reason === 'NOT_IN_LEXICON') ? { ...r, status: 'uncertain', partial: true } : r);
    const invalid = redo.filter(r => r.status === 'invalid'), uncertain = redo.filter(r => r.status === 'uncertain');
    v = { ...v, results: redo, invalid, uncertain, status: invalid.length ? 'invalid' : uncertain.length ? 'uncertain' : 'valid' };
  }
  if (v.status === 'invalid') {
    const one = v.invalid.length === 1 ? v.invalid[0] : null;
    return { ...none, reject: true, state: 'invalid', message: one ? `كلمة غير صحيحة: ${one.word} — ${REASON_AR[one.reason] || 'غير مقبولة'}` : `كلمات غير صحيحة: ${shown(v.invalid)}` };
  }
  if (v.status === 'uncertain') return { ...none, state: 'uncertain', unverified: new Set(v.uncertain.map(r => r.word)), note: `⚠ غير مؤكدة: ${shown(v.uncertain)} — يمكن التحكيم` };
  return { ...none, state: 'valid', note: '✓ كلمات صحيحة' };
}

export { loadDictionary };
