// Request handling for online play: authenticate (done by the caller), load state, run ONE authoritative transition,
// commit it atomically, answer with the caller's snapshot.
//
// The Store is the only I/O boundary (supabase/functions/eas-game/store.ts in production, tests/online/memory-store.mjs in tests):
//   findOpenGameId(userId, {includeFinished}) -> id | null   the player's lobby/active game (optionally a match finished in the last 30 min); open ones win
//   getGameIdByCode(code)             -> id | null
//   load(gameId)                      -> { game, players, racks, priv, moves } | null     (times as epoch ms)
//   getAction(gameId, actionId)       -> result | null
//   createGame(game, player)          -> throws {code:'ROOM_CODE_TAKEN'} on a duplicate room code
//   commit(gameId, expectedRevision, actionId|null, userId, patch, result) -> {revision}  | {duplicate:true, result}
//                                       throws {code:'STALE_REVISION'} when the revision moved; applies everything atomically
//   touch(gameId, userId, state)      -> void         connection_state / last_seen_at only; never bumps the revision
import { GameError, fail, MSG } from './errors.js';
import * as E from './engine.js';
import { buildSnapshot } from './snapshot.js';
import { newRoomCode, normalizeRoomCode, cleanNickname } from './codes.js';
import { DURATIONS, DEFAULT_MINUTES, DEFAULT_MODE } from '../game/config.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = s => typeof s === 'string' && UUID.test(s);
const PINNED = new Set(['submit_move', 'pass_turn', 'swap_tiles', 'request_tahkim', 'resolve_tahkim', 'cancel_tahkim']);   // must name the revision they were based on

const rejected = (e, snapshot) => ({ ok: false, code: e.code, message: e.message || MSG[e.code] || MSG.SERVER_ERROR, ...(e.extra || {}), ...(snapshot ? { snapshot } : {}) });

export async function handleRequest(store, userId, body, deps) {
  const now = deps.now(), log = deps.log || (() => {});
  const action = body?.action;
  try {
    if (!isUuid(userId)) fail('NOT_MEMBER');
    switch (action) {
      case 'create_room': return await createRoom(store, userId, body, now, deps);
      case 'join_room': return await joinRoom(store, userId, body, now, deps);
      case 'reconnect': return await reconnect(store, userId, now, deps);
      case 'snapshot': return await readSnapshot(store, userId, body, now, deps);
      case 'set_ready': return await mutate(store, userId, body, now, deps, (w) => E.setReady(w, userId, body.ready));
      case 'update_settings': return await mutate(store, userId, body, now, deps, (w) => E.updateSettings(w, userId, body.settings));
      case 'leave_room': return await mutate(store, userId, body, now, deps, (w) => E.leaveLobby(w, userId, now));
      case 'start_game': return await mutate(store, userId, body, now, deps, (w) => E.startGame(w, userId, now, deps));
      case 'submit_move': return await mutate(store, userId, body, now, deps, (w) => E.submitMove(w, userId, body, now, deps));
      case 'pass_turn': return await mutate(store, userId, body, now, deps, (w) => E.passTurn(w, userId, now));
      case 'swap_tiles': return await mutate(store, userId, body, now, deps, (w) => E.swapTiles(w, userId, body, now, deps));
      case 'request_tahkim': return await mutate(store, userId, body, now, deps, (w) => E.requestTahkim(w, userId, now));
      case 'cancel_tahkim': return await mutate(store, userId, body, now, deps, (w) => E.cancelTahkim(w, userId, now));
      case 'resolve_tahkim': return await mutate(store, userId, body, now, deps, (w) => E.resolveTahkim(w, userId, body, now));
      case 'resign_game': return await mutate(store, userId, body, now, deps, (w) => E.resign(w, userId, now));
      case 'claim_timeout': return await mutate(store, userId, body, now, deps, (w) => E.claimTimeout(w, userId, now));
      case 'rematch': return await mutate(store, userId, body, now, deps, (w) => E.requestRematch(w, userId, now, deps));
      default: fail('BAD_REQUEST');
    }
  } catch (e) {
    if (e instanceof GameError) { log('action_rejected', { action, code: e.code, user: userId }); return rejected(e, e.extra?.snapshot); }
    log('action_error', { action, user: userId, error: String(e?.message || e).slice(0, 200) });   // never the stack, never state
    return rejected(new GameError('SERVER_ERROR', MSG.SERVER_ERROR));
  }
}

const loadFor = async (store, gameId) => {
  if (!isUuid(gameId)) fail('BAD_REQUEST');
  const w = await store.load(gameId);
  if (!w) fail('ROOM_NOT_FOUND');
  return w;
};

async function snapshotResponse(store, userId, gameId, now, extra = {}) {
  const w = await loadFor(store, gameId);
  return { ok: true, ...extra, snapshot: buildSnapshot(w, userId, now) };
}

async function readSnapshot(store, userId, body, now, deps) {
  const w = await loadFor(store, body.game_id);
  deps.log?.('snapshot', { game: w.game.id });
  return { ok: true, snapshot: buildSnapshot(w, userId, now) };
}

async function reconnect(store, userId, now, deps) {
  const id = await store.findOpenGameId(userId, { includeFinished: true });   // a match that just ended can still be viewed after a refresh
  if (!id) return { ok: true, snapshot: null };
  await store.touch(id, userId, 'online', now);
  deps.log?.('player_reconnected', { game: id });
  return snapshotResponse(store, userId, id, now);
}

async function createRoom(store, userId, body, now, deps) {
  const existing = await store.findOpenGameId(userId);
  if (existing) fail('ALREADY_IN_GAME', MSG.ALREADY_IN_GAME, { snapshot: (await snapshotResponse(store, userId, existing, now)).snapshot });
  const settings = { tile_mode: DEFAULT_MODE, minutes: DEFAULT_MINUTES, validator_mode: 'auto', ...E.sanitizeSettings(body.settings) };
  const nick = cleanNickname(body.nickname);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newRoomCode(deps.rng), id = deps.uuid();
    const game = { id, room_code: code, host_player_id: userId, status: E.STATUS.LOBBY, ...settings, round: 1, revision: 1, current_seat: null, current_player_id: null,
      board: E.emptyBoard(), turn_started_at: null, turn_deadline_at: null, clock_started: false, tahkim: { state: 'none' }, tahkim_available: false, bag_count: 0,
      winner_player_id: null, winner_seat: null, result: null, rematch_seats: [], started_at: null, finished_at: null, created_at: now };
    const player = { player_id: userId, seat: 0, nickname: nick, score: 0, tile_count: 0, ms_left: settings.minutes * 60000, ready: true, connection_state: 'online' };
    try { await store.createGame(game, player); }
    catch (e) { if (e?.code === 'ROOM_CODE_TAKEN') continue; throw e; }
    deps.log?.('room_created', { game: id, room: code });
    return snapshotResponse(store, userId, id, now, { created: true });
  }
  fail('SERVER_ERROR');
}

async function joinRoom(store, userId, body, now, deps) {
  const code = normalizeRoomCode(body.code);
  const id = code && await store.getGameIdByCode(code);
  if (!id) fail('ROOM_NOT_FOUND');
  const w = await store.load(id);
  if (!w) fail('ROOM_NOT_FOUND');
  if (E.seatOf(w, userId) >= 0) { await store.touch(id, userId, 'online', now); return snapshotResponse(store, userId, id, now, { rejoined: true }); }   // a returning member is never "joining again"
  const mine = await store.findOpenGameId(userId);
  if (mine) fail('ALREADY_IN_GAME', MSG.ALREADY_IN_GAME, { snapshot: (await snapshotResponse(store, userId, mine, now)).snapshot });
  if (w.game.status !== E.STATUS.LOBBY) fail(w.players.length >= 2 ? 'ROOM_FULL' : 'GAME_STARTED');
  if (w.players.length >= 2) fail('ROOM_FULL');
  let nick = cleanNickname(body.nickname);
  if (w.players.some(p => p.nickname === nick)) nick = cleanNickname(nick + ' 2');
  const add = { player_id: userId, seat: 1, nickname: nick, score: 0, tile_count: 0, ms_left: w.game.minutes * 60000, ready: false, connection_state: 'online' };
  w.players.push(add);
  const patch = { event: 'PLAYER_JOINED', game: {}, players: [], racks: [], add_player: add };
  await commitPatch(store, w, null, userId, patch, { action: 'join_room' }, now, deps, 'join_room');
  return snapshotResponse(store, userId, id, now);
}

async function commitPatch(store, w, actionId, userId, patch, result, now, deps, action) {
  let r;
  try { r = await store.commit(w.game.id, w.game.revision, actionId, userId, patch, result); }
  catch (e) {
    if (e?.code === 'STALE_REVISION') fail('CONFLICT');
    if (e?.code === 'SEAT_TAKEN') fail('ROOM_FULL');
    throw e;
  }
  deps.log?.('action_committed', { action, game: w.game.id, revision: r.revision, event: patch.event });
  return r;
}

// One authoritative gameplay/lobby mutation.
async function mutate(store, userId, body, now, deps, fn) {
  const action = body.action;
  if (!isUuid(body.game_id)) fail('BAD_REQUEST');
  const actionId = body.client_action_id;
  if (!isUuid(actionId)) fail('BAD_REQUEST', 'معرّف الإجراء مفقود.');
  // Idempotency: a retry of an action that already committed answers with the current state instead of acting twice.
  const done = await store.getAction(body.game_id, actionId);
  if (done) {
    if (done.player_id !== userId) fail('NOT_MEMBER');
    deps.log?.('action_duplicate', { action, game: body.game_id });
    return snapshotResponse(store, userId, body.game_id, now, { duplicate: true, ...(done.result || {}) });
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const w = await loadFor(store, body.game_id);
    if (E.seatOf(w, userId) < 0) fail('NOT_MEMBER');
    if (PINNED.has(action) && body.base_revision !== w.game.revision)
      fail('STALE_STATE', MSG.STALE_STATE, { snapshot: buildSnapshot(w, userId, now) });
    w.game = { ...w.game }; w.players = w.players.map(p => ({ ...p }));
    let out = await fn(w);
    if (!out.patch) out = { patch: out };
    const { patch, ended, ...extra } = out;
    let r;
    try { r = await store.commit(w.game.id, w.game.revision, actionId, userId, patch, { action, ...extra }); }
    catch (e) {
      if (e?.code === 'STALE_REVISION') {
        if (PINNED.has(action)) fail('STALE_STATE', MSG.STALE_STATE, { snapshot: buildSnapshot(await loadFor(store, body.game_id), userId, now) });
        continue;   // an unpinned lobby action raced with another one: re-read and try once more
      }
      if (e?.code === 'DUPLICATE_ACTION') return snapshotResponse(store, userId, body.game_id, now, { duplicate: true });
      throw e;
    }
    if (r.duplicate) return snapshotResponse(store, userId, body.game_id, now, { duplicate: true });
    deps.log?.('action_committed', { action, game: w.game.id, revision: r.revision, event: patch.event });
    const fresh = await loadFor(store, body.game_id);
    if (E.seatOf(fresh, userId) < 0) return { ok: true, left: true };   // the caller just left the room: nothing of it may be shown to them any more
    const snapshot = buildSnapshot(fresh, userId, now);
    if (ended === 'time') return { ok: false, code: 'TIME_UP', message: MSG.TIME_UP, snapshot };
    return { ok: true, ...extra, snapshot };
  }
  fail('CONFLICT');
}
