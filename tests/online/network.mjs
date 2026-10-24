import { makeWorld, suite, across, uuidFrom, loadRealDictionary } from './lib.mjs';
const { ok, group, done } = suite('online network: refresh, reconnect, stale state, races');
await loadRealDictionary();
const tick = ms => new Promise(r => setTimeout(r, ms));

group('critical reconnect test: A creates, B joins, start, A moves, B moves, A refreshes');
{
  const w = makeWorld(); await w.start({ validator_mode: 'tahkim' });
  w.giveRack('A', [...'كتابمدر']); w.giveRack('B', [...'كنوزسلا']); await w.call('A', 'snapshot'); await w.call('B', 'snapshot');
  await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') }); await w.call('B', 'snapshot');
  const bm = await w.call('B', 'submit_move', { placements: across(w.snap.B, 'كن', 7, 7).map((p, i) => ({ ...p, row: 7 + i, col: 7 })).slice(1) });
  ok(bm.ok, 'B plays: ' + bm.message);
  const before = (await w.call('A', 'snapshot')).snapshot;
  w.clock.t += 3 * 60000;                                   // the page was closed for three minutes
  const r = await w.raw('A', { action: 'reconnect' });      // what the page does on load: no game id, only the session
  ok(r.ok && r.snapshot, 'the session finds its active game by itself');
  const s = r.snapshot;
  ok(JSON.stringify(s.board) === JSON.stringify(before.board), 'correct board');
  ok(s.players.map(p => p.score).join() === before.players.map(p => p.score).join(), 'correct scores');
  ok(JSON.stringify(s.me.rack) === JSON.stringify(before.me.rack), 'correct rack (same tiles, same slots)');
  ok(s.game.current_seat === before.game.current_seat && s.game.turn_deadline_at === before.game.turn_deadline_at, 'correct turn and timer deadline');
  ok(JSON.stringify(s.moves) === JSON.stringify(before.moves) && s.moves.length === 2, 'correct history');
  ok(s.game.revision === before.game.revision, 'correct revision');
  ok(s.server_now - before.server_now === 3 * 60000, 'the timer is reconstructed from server time: the countdown kept running while the page was gone');
  w.snap.A = s;
  const next = await w.call('A', 'pass_turn'); ok(next.ok, 'and play continues without any manual reconstruction');
  ok(JSON.stringify(s).includes(w.snap.B.me.rack[0].id) === false, 'the reconnect payload still hides the opponent rack');
}
group('reconnect edge cases');
{
  const w = makeWorld(); await w.start();
  const none = await w.raw('C', { action: 'reconnect' }); ok(none.ok && none.snapshot === null, 'a player with no game gets "nothing to resume"');
  w.clock.t += 6 * 3600e3;                                      // everybody went away for hours
  const back = await w.raw('B', { action: 'reconnect' }); ok(back.ok && back.snapshot.game.status === 'active', 'an interrupted match is never destroyed by a disconnect');
  ok(back.snapshot.game.clock_started === false, 'before the first move there is no running clock to burn');
  const resumedLobby = makeWorld(); await resumedLobby.room();
  const rl = await resumedLobby.raw('B', { action: 'reconnect' }); ok(rl.ok && rl.snapshot.game.status === 'lobby' && rl.snapshot.me.seat === 1, 'refreshing in the lobby returns to the lobby');
  const resign = makeWorld(); await resign.start(); await resign.call('A', 'resign_game');
  const fin = await resign.raw('A', { action: 'reconnect' }); ok(fin.ok && fin.snapshot.game.status === 'finished', 'a just-finished match can still be viewed after a refresh');
  const fresh = await resign.raw('A', { action: 'create_room', nickname: 'A' }); ok(fresh.ok && fresh.created, 'a finished match does not block creating a new room');
  const later = await resign.raw('A', { action: 'reconnect' }); ok(later.snapshot.game.status === 'lobby', 'reconnect prefers the open room over the old result');
}
group('missed realtime event: the revision gap is detected and repaired');
{
  const w = makeWorld(); await w.start(); w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot');
  const bSeen = w.snap.B.game.revision;                       // B's last known revision
  await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') });
  ok(w.store.events.at(-1).revision === bSeen + 1, 'the server emitted an event B "missed" (B never fetched it)');
  const stale = await w.call('B', 'pass_turn');               // B acts on a stale view
  ok(!stale.ok && stale.code === 'STALE_STATE' && stale.snapshot.game.revision === bSeen + 1, 'stale client is refused and handed the authoritative snapshot');
  ok(stale.snapshot.board[7][7].l === 'ك', 'the snapshot contains the move B missed');
  w.snap.B = stale.snapshot;
  const retry = await w.call('B', 'pass_turn'); ok(retry.ok, 'after resync the same action succeeds');
  ok(w.store.events.every((e, i, a) => i === 0 || e.revision > a[i - 1].revision), 'revisions are strictly monotonic');
}
group('two simultaneous submissions');
{
  const w = makeWorld(); await w.start(); w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot');
  w.store.delay = () => tick(5);                              // both requests load state before either commits
  const rev = w.snap.A.game.revision, pl = across(w.snap.A, 'كتاب');
  const mk = () => ({ action: 'submit_move', game_id: w.gameId, client_action_id: uuidFrom(w.rng), base_revision: rev, placements: pl });
  const [r1, r2] = await Promise.all([w.raw('A', mk()), w.raw('A', mk())]);
  const wins = [r1, r2].filter(r => r.ok).length;
  ok(wins === 1, 'exactly one of two racing submissions commits (got ' + wins + ')');
  const loser = [r1, r2].find(r => !r.ok); ok(loser && ['STALE_STATE', 'WRONG_TURN'].includes(loser.code), 'the other is refused cleanly: ' + loser?.code);
  w.store.delay = null; const s = (await w.call('A', 'snapshot')).snapshot;
  ok(s.moves.length === 1 && s.players[0].score === 14 && s.game.revision === rev + 1, 'one move, one score, one revision bump');
  ok(w.server().moves.length === 1, 'one row in the move log');
  // same action id twice, truly concurrent (a double click that reached the server twice)
  const w2 = makeWorld(); await w2.start(); w2.giveRack('A', [...'كتابمدر']); await w2.call('A', 'snapshot'); w2.store.delay = () => tick(5);
  const b = { action: 'submit_move', game_id: w2.gameId, client_action_id: uuidFrom(w2.rng), base_revision: w2.snap.A.game.revision, placements: across(w2.snap.A, 'كتاب') };
  const [d1, d2] = await Promise.all([w2.raw('A', b), w2.raw('A', b)]); w2.store.delay = null;
  ok(d1.ok && d2.ok && w2.server().moves.length === 1, 'a concurrent double-submit with the same action id is applied once and both calls succeed');
  // both players act at once on A's turn: B's action must lose
  const w3 = makeWorld(); await w3.start(); w3.giveRack('A', [...'كتابمدر']); await w3.call('A', 'snapshot'); await w3.call('B', 'snapshot'); w3.store.delay = () => tick(3);
  const [x, y] = await Promise.all([w3.call('A', 'pass_turn'), w3.call('B', 'pass_turn')]); w3.store.delay = null;
  ok([x, y].filter(r => r.ok).length === 1 && w3.server().moves.length === 1, 'A and B racing for the same turn: only the player on turn acts');
}
group('lobby races');
{
  const w = makeWorld(); const c = await w.raw('A', { action: 'create_room', nickname: 'A' }); w.store.delay = () => tick(5);
  const code = c.snapshot.game.room_code;
  const [j1, j2] = await Promise.all([w.raw('B', { action: 'join_room', code, nickname: 'B' }), w.raw('C', { action: 'join_room', code, nickname: 'C' })]);
  w.store.delay = null;
  ok([j1, j2].filter(r => r.ok).length === 1, 'two players racing for the last seat: exactly one gets it');
  ok(w.store.peek(c.snapshot.game.id).players.length === 2, 'the room never holds more than two players');
}
group('connection state does not change game state');
{
  const w = makeWorld(); await w.start(); const rev = w.snap.A.game.revision;
  await w.raw('B', { action: 'reconnect' }); await w.raw('B', { action: 'reconnect' });
  const s = await w.call('A', 'snapshot'); ok(s.snapshot.game.revision === rev, 'reconnecting does not bump the authoritative revision (it cannot make a pinned action stale)');
  ok(s.snapshot.players[1].connection_state === 'online', 'connection state is recorded');
}
done();
