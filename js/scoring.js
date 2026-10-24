// Move validation (geometry/connectivity), word detection and score calculation for the LOCAL game.
// The rules themselves live in rules.js (shared with the online server); this file only binds them to the local game state.
import { S } from './state.js';
import { analyzeMove } from './rules.js';

export { wordStr, scoreWords } from './rules.js';

// Validates the pending move. Returns {err} or {words, isNew}.
export const analyze = () => analyzeMove(S.board, S.move);
