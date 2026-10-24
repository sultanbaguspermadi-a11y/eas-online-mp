// Authoritative game transitions for online play. PURE: no I/O, no clock, no randomness of its own. Everything comes in as
// arguments (state, userId, request, now, deps) and a PATCH comes out (see service.js / the commit_action SQL function).
//
// The server state is split exactly as the design requires:
//   PUBLIC   game row (board, turn, revision, clock, tahkim, result ...), players' score / tile_count / time, move history
//   PRIVATE  one rack per player (only its owner ever receives it)
//   SERVER   the tile bag, the undo snapshot Tahkim may need; neither ever leaves the server
//
// Rules are NOT re-implemented here: legality, words and scoring come from game/rules.js (shared with the local game),
// the word policy from game/wordpolicy.js, the validator from game/validator.js.
import { SIZE, RACK, MIN_BAG_SWAP, DURATIONS } from '../game/config.js';
import { TILE_MODES } from '../game/modes.js';
import { analyzeMove, scoreWords, wordStr, makeTileSet, settleEnd, challengePenalty } from '../game/rules.js';
import { evaluateMove, POLICIES } from '../game/wordpolicy.js';
import { fail } from './errors.js';

export const STATUS = Object.freeze({ LOBBY: 'lobby', STARTING: 'starting', ACTIVE: 'active', TAHKIM: 'tahkim_pending', FINISHED: 'finished', ABANDONED: 'abandoned' });
export const PLAYING = [STATUS.ACTIVE, STATUS.TAHKIM];
export const OPEN = [STATUS.LOBBY, STATUS.STARTING, STATUS.ACTIVE, STATUS.TAHKIM];

const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
export const emptyBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
export const pubTile = t => ({ id: t.id, l: t.blank ? '' : t.l, v: t.blank ? 0 : t.v, blank: !!t.blank, as: t.blank ? (t.as || null) : null });

// ---------- randomness (injected so tests are deterministic; production uses crypto) ----------
export function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export function idFactory(rng) {
  const seen = new Set();
  return () => { let id; do { id = Array.from({ length: 6 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(rng() * 32)]).join(''); } while (seen.has(id)); seen.add(id); return id; };
}

// ---------- helpers ----------
export const seatOf = (w, userId) => { const p = w.players.find(x => x.player_id === userId); return p ? p.seat : -1; };
export const playerBySeat = (w, seat) => w.players.find(p => p.seat === seat);
const other = seat => 1 - seat;
export const rackOf = (w, seat) => w.racks[playerBySeat(w, seat).player_id];
const turnNo = w => w.moves.length + 1;

function requireMember(w, userId) { const s = seatOf(w, userId); if (s < 0) fail('NOT_MEMBER'); return s; }
function requirePlaying(w) { if (w.game.status === STATUS.TAHKIM) fail('TAHKIM_PENDING'); if (w.game.status !== STATUS.ACTIVE) fail('WRONG_STATUS'); }
function requireTurn(w, userId) { const s = requireMember(w, userId); requirePlaying(w); if (w.game.current_seat !== s) fail('WRONG_TURN'); return s; }

// ---------- clock ----------
// players[].ms_left is the time left when the clock was last settled; while the clock runs, the player on turn is still spending
// (now - turn_started_at). All of it is computed from SERVER timestamps, never from a browser counter.
export const clockRunning = g => !!(g.clock_started && g.turn_started_at && g.status === STATUS.ACTIVE);
export function liveMs(w, seat, now) {
  const p = playerBySeat(w, seat), g = w.game;
  return (clockRunning(g) && g.current_seat === seat) ? Math.max(0, p.ms_left - (now - g.turn_started_at)) : p.ms_left;
}
function settle(w, now) {   // charge the elapsed time to the player on turn
  const g = w.game;
  if (!clockRunning(g)) return;
  const p = playerBySeat(w, g.current_seat);
  p.ms_left = Math.max(0, p.ms_left - Math.max(0, now - g.turn_started_at)); g.turn_started_at = now;
}
function restartClock(w, now) {
  const g = w.game;
  if (g.clock_started && g.status === STATUS.ACTIVE) { g.turn_started_at = now; g.turn_deadline_at = now + playerBySeat(w, g.current_seat).ms_left; }
  else { g.turn_started_at = null; g.turn_deadline_at = null; }
}
function nextTurn(w, now, scored) {
  settle(w, now);
  w.game.current_seat = other(w.game.current_seat);
  if (scored && !w.game.clock_started) w.game.clock_started = true;   // the clock starts after the first scored move, like the local game
  restartClock(w, now);
}

// ---------- patches ----------
// Only what changed is sent. players/racks are keyed by player_id.
function patchOf(w, ev, o = {}) {
  const g = w.game;
  const game = {
    status: g.status, current_seat: g.current_seat, current_player_id: g.current_seat == null ? null : playerBySeat(w, g.current_seat)?.player_id ?? null,
    board: g.board, turn_started_at: g.turn_started_at, turn_deadline_at: g.turn_deadline_at, clock_started: g.clock_started, tahkim: g.tahkim,
    tahkim_available: g.tahkim_available, bag_count: g.bag_count, tile_mode: g.tile_mode, validator_mode: g.validator_mode, minutes: g.minutes, round: g.round,
    started_at: g.started_at, finished_at: g.finished_at, winner_player_id: g.winner_player_id, winner_seat: g.winner_seat, result: g.result, rematch_seats: g.rematch_seats
  };
  return { event: ev, game, players: w.players.map(p => ({ player_id: p.player_id, score: p.score, tile_count: p.tile_count, ms_left: p.ms_left, ready: p.ready })),
    racks: o.racks === 'all' ? w.players.map(p => ({ player_id: p.player_id, tiles: w.racks[p.player_id] })) : (o.racks || []).map(pid => ({ player_id: pid, tiles: w.racks[pid] })),
    private: o.private ? { bag: w.priv.bag, undo: w.priv.undo ?? null } : undefined, move: o.move || null, move_update: o.move_update || null,
    add_player: o.add_player || null, remove_player: o.remove_player || null };
}
export const withBagCount = w => { w.game.bag_count = w.priv.bag.length; };
export const refill = (w, seat) => { const rack = rackOf(w, seat), bag = w.priv.bag; for (let i = 0; i < RACK && bag.length; i++) if (!rack[i]) rack[i] = bag.pop(); playerBySeat(w, seat).tile_count = rack.filter(Boolean).length; };

// ---------- lobby ----------
const sanitizeSettings = s => {
  const out = {};
  if (s?.tile_mode !== undefined) { if (!TILE_MODES[s.tile_mode]) fail('BAD_REQUEST'); out.tile_mode = s.tile_mode; }
  if (s?.minutes !== undefined) { if (!DURATIONS.includes(Number(s.minutes))) fail('BAD_REQUEST'); out.minutes = Number(s.minutes); }
  if (s?.validator_mode !== undefined) { if (!POLICIES.includes(s.validator_mode)) fail('BAD_REQUEST'); out.validator_mode = s.validator_mode; }
  return out;
};
export { sanitizeSettings };

export function updateSettings(w, userId, settings) {
  const seat = requireMember(w, userId);
  if (w.game.status !== STATUS.LOBBY) fail('WRONG_STATUS');
  if (seat !== 0) fail('NOT_HOST');
  Object.assign(w.game, sanitizeSettings(settings));
  w.players.forEach(p => { if (p.seat !== 0) p.ready = false; });   // a guest must re-confirm after the rules changed
  return patchOf(w, 'SETTINGS_UPDATED');
}
export function setReady(w, userId, ready) {
  const seat = requireMember(w, userId);
  if (w.game.status !== STATUS.LOBBY) fail('WRONG_STATUS');
  playerBySeat(w, seat).ready = !!ready;
  return patchOf(w, 'PLAYER_READY');
}
export function leaveLobby(w, userId, now) {
  const seat = requireMember(w, userId);
  if (w.game.status !== STATUS.LOBBY) fail('WRONG_STATUS');
  if (seat === 0) { w.game.status = STATUS.ABANDONED; w.game.finished_at = now; return patchOf(w, 'PLAYER_LEFT'); }   // the host closes the room
  const p = playerBySeat(w, seat); w.players = w.players.filter(x => x !== p);
  return patchOf(w, 'PLAYER_LEFT', { remove_player: p.player_id });
}

// Deals a fresh game for the current round: bag, racks, empty board, zero scores, clock not started.
function deal(w, now, deps) {
  const g = w.game, next = idFactory(deps.rng);
  const bag = shuffle(makeTileSet(g.tile_mode, next), deps.rng);
  w.priv = { bag, undo: null };
  w.racks = {};
  for (const p of [...w.players].sort((a, b) => a.seat - b.seat)) { w.racks[p.player_id] = Array(RACK).fill(null); refill(w, p.seat); }
  w.players.forEach(p => { p.score = 0; p.ms_left = g.minutes * 60000; });
  Object.assign(g, { board: emptyBoard(), status: STATUS.ACTIVE, current_seat: (g.round - 1) % 2, clock_started: false, turn_started_at: null, turn_deadline_at: null,
    tahkim: { state: 'none' }, tahkim_available: false, winner_player_id: null, winner_seat: null, result: null, finished_at: null, rematch_seats: [], started_at: now });
  withBagCount(w);
}
export function startGame(w, userId, now, deps) {
  const seat = requireMember(w, userId);
  if (w.game.status !== STATUS.LOBBY) fail('WRONG_STATUS');
  if (seat !== 0) fail('NOT_HOST');
  if (w.players.length !== 2) fail('NEED_OPPONENT');
  if (!w.players.every(p => p.seat === 0 || p.ready)) fail('NOT_READY');
  w.game.round = 1;
  deal(w, now, deps);
  return patchOf(w, 'GAME_STARTED', { racks: 'all', private: true });
}

// ---------- moves ----------
function parsePlacements(pl) {
  if (!Array.isArray(pl) || pl.length < 1 || pl.length > RACK) fail('BAD_REQUEST', 'عدد القطع غير صالح.');
  const ids = new Set(), cells = new Set();
  for (const x of pl) {
    if (!x || typeof x.tileId !== 'string' || !Number.isInteger(x.row) || !Number.isInteger(x.col) || x.row < 0 || x.row >= SIZE || x.col < 0 || x.col >= SIZE) fail('BAD_REQUEST');
    if (x.as !== undefined && x.as !== null && typeof x.as !== 'string') fail('BAD_REQUEST');
    if (ids.has(x.tileId) || cells.has(x.row * SIZE + x.col)) fail('BAD_REQUEST', 'قطعة أو مربع مكرر في الحركة.');
    ids.add(x.tileId); cells.add(x.row * SIZE + x.col);
  }
  return pl;
}
const snapshotForUndo = w => ({
  board: clone(w.game.board), racks: clone(w.racks), bag: clone(w.priv.bag), scores: Object.fromEntries(w.players.map(p => [p.player_id, p.score])),
  tile_counts: Object.fromEntries(w.players.map(p => [p.player_id, p.tile_count])), cur_seat: w.game.current_seat, started: w.game.clock_started
});

// Ends the game. reason: 'rack' | 'time' | 'resign'. loserSeat is only used by 'resign'.
export function finish(w, reason, now, loserSeat) {
  settle(w, now);
  const g = w.game, seats = [0, 1];
  let lines;
  if (reason === 'resign') lines = seats.map(s => ({ seat: s, score: playerBySeat(w, s).score, ded: 0, bon: 0 }));
  else {
    const res = settleEnd(seats.map(s => ({ score: playerBySeat(w, s).score, rack: rackOf(w, s), ms: playerBySeat(w, s).ms_left })));
    lines = res.map((r, s) => ({ seat: s, ...r }));
    seats.forEach(s => { playerBySeat(w, s).score = lines[s].score; });
  }
  let win = null;
  if (reason === 'resign') win = other(loserSeat);
  else if (lines[0].score !== lines[1].score) win = lines[0].score > lines[1].score ? 0 : 1;
  Object.assign(g, { status: STATUS.FINISHED, finished_at: now, winner_seat: win, winner_player_id: win == null ? null : playerBySeat(w, win).player_id,
    result: { reason, lines, winner_seat: win }, turn_started_at: null, turn_deadline_at: null, tahkim_available: false, rematch_seats: [] });
  w.priv.undo = null;
}

export async function submitMove(w, userId, req, now, deps) {
  const seat = requireTurn(w, userId), g = w.game;
  if (liveMs(w, seat, now) <= 0) { finish(w, 'time', now); return { patch: patchOf(w, 'GAME_ENDED', { private: true, racks: 'all' }), ended: 'time' }; }
  const placements = parsePlacements(req.placements), rack = rackOf(w, seat), alpha = TILE_MODES[g.tile_mode].alpha;
  const board = clone(g.board).map(r => r.map(t => t && { ...t }));
  const move = [];
  for (const x of placements) {
    const slot = rack.findIndex(t => t && t.id === x.tileId);
    if (slot < 0) fail('TILE_NOT_OWNED');
    if (board[x.row][x.col]) fail('MOVE_INVALID', 'هذا المربع مشغول.');
    const src = rack[slot], t = { id: src.id, l: src.l, v: src.v, blank: src.blank, as: null };
    if (src.blank) { if (typeof x.as !== 'string' || ![...alpha].includes(x.as)) fail('MOVE_INVALID', 'اختر حرفًا صالحًا للقطعة الفارغة.'); t.as = x.as; }
    else if (x.as) fail('BAD_REQUEST');
    board[x.row][x.col] = t; move.push({ t, r: x.row, c: x.col, slot });
  }
  const a = analyzeMove(board, move);
  if (a.err) fail('MOVE_INVALID', a.err);
  const words = a.words.map(wordStr);
  await deps.ensureDictionary?.();
  const chk = evaluateMove(words, { policy: g.validator_mode, mode: g.tile_mode, ensureLoaded: deps.ensureDictionary });
  if (chk.reject) fail('WORD_REJECTED', chk.message);
  const r = scoreWords(a.words, a.isNew, move.length);
  if (chk.unverified.size) r.list.forEach(x => { if (chk.unverified.has(x.w)) x.unv = true; });
  // ---- commit to the working copy ----
  const undo = snapshotForUndo(w), p = playerBySeat(w, seat);
  move.forEach(e => { rack[e.slot] = null; });
  g.board = board.map(row => row.map(t => t && pubTile(t)));
  p.score += r.total; refill(w, seat);
  w.priv.undo = undo; g.tahkim = { state: 'none' }; g.tahkim_available = true;
  const row = { player_id: userId, seat, turn_number: turnNo(w), action_type: 'move', placements: placements.map(x => ({ tileId: x.tileId, row: x.row, col: x.col, as: x.as || null })),
    formed_words: r.list, score_delta: r.total, validation_result: chk.state, bingo: r.bingo, swap_count: 0 };
  if (!rack.some(Boolean)) { finish(w, 'rack', now); withBagCount(w); return { patch: patchOf(w, 'GAME_ENDED', { racks: 'all', private: true, move: row }), result: { score: r.total, words: r.list, note: chk.note }, ended: 'rack' }; }
  nextTurn(w, now, true); withBagCount(w);
  return { patch: patchOf(w, 'MOVE_COMMITTED', { racks: [userId], private: true, move: row }), result: { score: r.total, words: r.list, note: chk.note, state: chk.state } };
}

export function passTurn(w, userId, now) {
  const seat = requireTurn(w, userId);
  if (liveMs(w, seat, now) <= 0) { finish(w, 'time', now); return { patch: patchOf(w, 'GAME_ENDED', { private: true }), ended: 'time' }; }
  w.priv.undo = null; w.game.tahkim = { state: 'none' }; w.game.tahkim_available = false;
  const row = { player_id: userId, seat, turn_number: turnNo(w), action_type: 'pass', placements: [], formed_words: [], score_delta: 0, validation_result: 'skipped', bingo: false, swap_count: 0 };
  nextTurn(w, now, false);   // passing is unlimited, exactly like the local game
  return { patch: patchOf(w, 'PASS_COMMITTED', { private: true, move: row }) };
}

export function swapTiles(w, userId, req, now, deps) {
  const seat = requireTurn(w, userId), g = w.game;
  if (liveMs(w, seat, now) <= 0) { finish(w, 'time', now); return { patch: patchOf(w, 'GAME_ENDED', { private: true }), ended: 'time' }; }
  const ids = req.tileIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > RACK || new Set(ids).size !== ids.length || ids.some(i => typeof i !== 'string')) fail('BAD_REQUEST');
  if (w.priv.bag.length < MIN_BAG_SWAP) fail('SWAP_NOT_ALLOWED', `لا يمكن التبديل: في الكيس ${w.priv.bag.length} قطع فقط (الحد الأدنى ${MIN_BAG_SWAP}).`);
  const rack = rackOf(w, seat);
  const idx = ids.map(id => { const i = rack.findIndex(t => t && t.id === id); if (i < 0) fail('TILE_NOT_OWNED'); return i; }).sort((a, b) => a - b);
  const drawn = w.priv.bag.splice(0, idx.length), old = idx.map(i => rack[i]);
  idx.forEach((i, k) => { rack[i] = drawn[k]; });
  w.priv.bag.push(...old.map(t => ({ ...t, as: null }))); shuffle(w.priv.bag, deps.rng);
  w.priv.undo = null; g.tahkim = { state: 'none' }; g.tahkim_available = false;
  const row = { player_id: userId, seat, turn_number: turnNo(w), action_type: 'swap', placements: [], formed_words: [], score_delta: 0, validation_result: 'skipped', bingo: false, swap_count: idx.length };
  nextTurn(w, now, false); withBagCount(w);
  return { patch: patchOf(w, 'SWAP_COMMITTED', { racks: [userId], private: true, move: row }) };
}

// ---------- Tahkim ----------
// State machine:  none -> pending -> resolved_valid | resolved_invalid  (-> none again on the next committed action)
// The challenger is the player now on turn (as in the local game). The resolver is recorded in the state, so a future referee role
// only has to change who is stored there.
export function requestTahkim(w, userId, now) {
  const seat = requireTurn(w, userId), g = w.game, last = w.moves[w.moves.length - 1];
  if (!w.priv.undo || !last || last.action_type !== 'move' || last.tahkim_status) fail('NO_TAHKIM');
  settle(w, now);
  g.status = STATUS.TAHKIM; g.turn_started_at = null; g.turn_deadline_at = null;   // the clock stops while the ruling is pending
  g.tahkim = { state: 'pending', move_number: last.turn_number, challenger_seat: seat, resolver_seat: seat, requested_at: now };
  return { patch: patchOf(w, 'TAHKIM_REQUESTED', { private: true }) };
}
export function cancelTahkim(w, userId, now) {
  requireMember(w, userId);
  const g = w.game;
  if (g.status !== STATUS.TAHKIM) fail('WRONG_STATUS');
  if (seatOf(w, userId) !== g.tahkim.challenger_seat) fail('NOT_RESOLVER');
  g.status = STATUS.ACTIVE; g.tahkim = { state: 'none' }; restartClock(w, now);
  return { patch: patchOf(w, 'TAHKIM_RESOLVED', { private: true }) };
}
export function resolveTahkim(w, userId, req, now) {
  const seat = requireMember(w, userId), g = w.game;
  if (g.status !== STATUS.TAHKIM || g.tahkim.state !== 'pending') fail('WRONG_STATUS');
  if (g.tahkim.resolver_seat !== seat) fail('NOT_RESOLVER');
  if (req.verdict !== 'valid' && req.verdict !== 'invalid') fail('BAD_REQUEST');
  const challenger = g.tahkim.challenger_seat, u = w.priv.undo, last = w.moves[w.moves.length - 1];
  if (!u || !last) fail('NO_TAHKIM');
  g.status = STATUS.ACTIVE;
  if (req.verdict === 'valid') {
    const ch = playerBySeat(w, challenger), pen = challengePenalty(ch.score); ch.score -= pen;
    w.priv.undo = null; g.tahkim_available = false; g.tahkim = { ...g.tahkim, state: 'resolved_valid' };
    restartClock(w, now);
    return { patch: patchOf(w, 'TAHKIM_RESOLVED', { private: true, move_update: { turn_number: last.turn_number, tahkim_status: 'ok', penalty: pen } }), verdict: 'valid', penalty: pen };
  }
  // invalid: the move is void. Board, racks, bag and scores go back to before the move (clocks are kept), and the mover loses the turn.
  g.board = clone(u.board);
  for (const p of w.players) { w.racks[p.player_id] = clone(u.racks[p.player_id]); p.score = u.scores[p.player_id]; p.tile_count = u.tile_counts[p.player_id]; }
  w.priv.bag = clone(u.bag);
  [...w.priv.bag, ...Object.values(w.racks).flat()].forEach(t => { if (t && t.blank) t.as = null; });
  g.clock_started = u.started; g.tahkim = { ...g.tahkim, state: 'resolved_invalid' };
  w.priv.undo = null; g.tahkim_available = false; withBagCount(w);
  g.current_seat = u.cur_seat; nextTurn(w, now, false);   // restores the mover, then the turn passes to the challenger
  return { patch: patchOf(w, 'TAHKIM_RESOLVED', { racks: 'all', private: true, move_update: { turn_number: last.turn_number, tahkim_status: 'void', penalty: 0 } }), verdict: 'invalid' };
}

// ---------- end / time / resign / rematch ----------
export function resign(w, userId, now) {
  const seat = requireMember(w, userId);
  if (!PLAYING.includes(w.game.status)) fail('WRONG_STATUS');
  finish(w, 'resign', now, seat);
  return { patch: patchOf(w, 'GAME_ENDED', { private: true }) };
}
// Anyone may ask; only the server's own clock decides.
export function claimTimeout(w, userId, now) {
  requireMember(w, userId);
  if (w.game.status !== STATUS.ACTIVE) fail('WRONG_STATUS');
  if (!clockRunning(w.game) || liveMs(w, w.game.current_seat, now) > 0) fail('NOT_EXPIRED');
  finish(w, 'time', now);
  return { patch: patchOf(w, 'GAME_ENDED', { private: true, racks: 'all' }) };
}
export function requestRematch(w, userId, now, deps) {
  const seat = requireMember(w, userId), g = w.game;
  if (g.status !== STATUS.FINISHED) fail('WRONG_STATUS');
  const set = new Set(g.rematch_seats || []); set.add(seat); g.rematch_seats = [...set].sort();
  if (set.size < 2) return { patch: patchOf(w, 'REMATCH_REQUESTED') };
  g.round += 1; deal(w, now, deps);   // a brand-new bag and racks; nothing of the previous round is reused
  return { patch: patchOf(w, 'GAME_STARTED', { racks: 'all', private: true }) };
}
