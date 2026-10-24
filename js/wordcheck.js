// Glue between the game and the automatic word validator: the player-facing policy (stored on this device),
// its settings row, the loading of the dictionary, and the Arabic messages shown to the players.
//
//   auto    unknown words are rejected before the move is committed (default)
//   tahkim  unknown words are accepted provisionally (marked ؟) and can be challenged with Tahkim
//   off     no automatic check: Tahkim only, exactly like before the validator existed
//
// If the dictionary cannot be loaded (offline, blocked file ...) the game keeps working, but the move's words are marked as UNVERIFIED (؟) and stay open to Tahkim.
import { $, app } from './state.js';
import { loadDictionary, warmDictionary, isDictionaryReady } from './validator.js';
import { evaluateMove } from './wordpolicy.js';

const KEY = 'scrabble.wordcheck';
export const POLICIES = [['auto', 'تلقائي'], ['tahkim', 'تلقائي + تحكيم'], ['off', 'إيقاف']];
const LABEL = 'عند تأكيد الحركة';
let policy = 'auto';

export const wordCheckPolicy = () => policy;
export function setWordCheckPolicy(p) {
  if (!POLICIES.some(([v]) => v === p)) return false;
  policy = p;
  try { localStorage.setItem(KEY, p); } catch { /* private mode / storage disabled: the choice just lasts for this session */ }
  return true;
}

function ensureLoaded() {
  if (isDictionaryReady()) return Promise.resolve();
  return loadDictionary().then(() => warmDictionary(app.mode)).catch(() => { /* fall back to Tahkim-only; retried on the next move */ });
}
export function warmForMode() { if (policy !== 'off') ensureLoaded().then(() => warmDictionary(app.mode)); }

export function initWordCheck() {
  try { const p = localStorage.getItem(KEY); if (POLICIES.some(([v]) => v === p)) policy = p; } catch { /* keep default */ }
  const host = $('#wcB');
  if (host) {
    const draw = () => {
      host.innerHTML = `<div class="segRow"><div class="setRowHead">${LABEL}</div><div class="seg" role="group" aria-label="${LABEL}">`
        + POLICIES.map(([v, t]) => `<button type="button" class="btn" data-v="${v}" aria-pressed="${policy === v}">${t}</button>`).join('') + '</div></div>';
    };
    draw();
    host.addEventListener('click', e => {
      const b = e.target.closest('button[data-v]');
      if (b && setWordCheckPolicy(b.dataset.v)) { draw(); warmForMode(); }
    });
  }
  warmForMode();
}

// Result of checking the words of a move.  { reject, message?, unverified: Set<string>, note?, state }
// (The decision itself is the pure evaluateMove in wordpolicy.js, shared with the online server.)
export const checkMove = words => evaluateMove(words, { policy, mode: app.mode, ensureLoaded });
