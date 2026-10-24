import { makeWorld, suite, across, uuidFrom } from './lib.mjs';
const { ok, group, done } = suite('online security');

const fresh = async () => { const w = makeWorld(); await w.start(); w.giveRack('A', [...'كتابمدر']); w.giveRack('B', [...'سلامنوع']); await w.call('A', 'snapshot'); await w.call('B', 'snapshot'); return w; };

group('fabricated tiles');
{
  const w = await fresh(); const rev = w.snap.A.game.revision;
  const fake = across(w.snap.A, 'كتاب').map((p, i) => ({ ...p, tileId: 'fake0' + i }));
  const r = await w.call('A', 'submit_move', { placements: fake });
  ok(!r.ok && r.code === 'TILE_NOT_OWNED', 'invented tile ids are rejected');
  const bTiles = w.snap.B.me.rack.slice(0, 4).map((t, i) => ({ tileId: t.id, row: 7, col: 7 + i }));
  const steal = await w.call('A', 'submit_move', { placements: bTiles });
  ok(!steal.ok && steal.code === 'TILE_NOT_OWNED', "cannot play the opponent's tile ids");
  const inBag = w.server().priv.bag.slice(0, 4).map((t, i) => ({ tileId: t.id, row: 7, col: 7 + i }));
  const draw = await w.call('A', 'submit_move', { placements: inBag });
  ok(!draw.ok && draw.code === 'TILE_NOT_OWNED', 'cannot play a tile that is still in the bag (no arbitrary draws)');
  const s = await w.call('A', 'snapshot'); ok(s.snapshot.game.revision === rev, 'none of these changed the game');
  const letter = across(w.snap.A, 'كتاب').map(p => ({ ...p, letter: 'ق', as: 'ق' }));
  const asOnReal = await w.call('A', 'submit_move', { placements: letter });
  ok(!asOnReal.ok && asOnReal.code === 'BAD_REQUEST', 'a real (non-blank) tile cannot be re-lettered');
}
group('client-supplied results are ignored');
{
  const w = await fresh();
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب'), score: 9999, total: 9999, words: [{ w: 'كتاب', pts: 9999 }], current_seat: 1, rack: [], bag: [], status: 'finished', winner: 'A', revision: 99 });
  ok(r.ok && r.snapshot.players[0].score === 14, 'score is computed by the server, not taken from the payload: ' + r.snapshot.players[0].score);
  ok(r.snapshot.game.status === 'active' && r.snapshot.game.winner_seat === null, 'client cannot set status or winner');
  const p = await w.call('A', 'update_settings', { settings: { minutes: 10 } });
  ok(!p.ok, 'settings are locked after the start (cannot be altered mid-game)');
}
group('wrong turn / fake turn');
{
  const w = await fresh();
  for (const act of ['pass_turn', 'request_tahkim']) { const r = await w.call('B', act); ok(!r.ok && ['WRONG_TURN'].includes(r.code), `B cannot ${act} on A's turn (${r.code})`); }
  const sw = await w.call('B', 'swap_tiles', { tileIds: [w.snap.B.me.rack[0].id] }); ok(!sw.ok && sw.code === 'WRONG_TURN', 'B cannot swap on A\'s turn');
  const r = await w.call('B', 'submit_move', { placements: across(w.snap.B, 'سلام'), current_seat: 1 });
  ok(!r.ok && r.code === 'WRONG_TURN', 'a payload claiming current_seat does not make it B\'s turn');
}
group('stale revision');
{
  const w = await fresh();
  const staleRev = w.snap.A.game.revision - 1;
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب'), base_revision: staleRev });
  ok(!r.ok && r.code === 'STALE_STATE' && r.snapshot && r.snapshot.game.revision === w.snap.A.game.revision, 'stale revision rejected, fresh snapshot returned');
  const missing = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب'), base_revision: undefined });
  ok(!missing.ok && missing.code === 'STALE_STATE', 'a missing revision is treated as stale');
  const future = await w.call('A', 'pass_turn', { base_revision: 9999 });
  ok(!future.ok && future.code === 'STALE_STATE', 'a revision from the future is rejected too');
}
group('duplicate action (idempotency)');
{
  const w = await fresh(); const id = uuidFrom(w.rng), body = { action: 'submit_move', game_id: w.gameId, client_action_id: id, base_revision: w.snap.A.game.revision, placements: across(w.snap.A, 'كتاب') };
  const r1 = await w.raw('A', body), r2 = await w.raw('A', body);
  ok(r1.ok && r2.ok && r2.duplicate === true, 'the retry is recognised');
  ok(r2.snapshot.moves.length === 1 && r2.snapshot.players[0].score === 14 && r2.snapshot.game.revision === r1.snapshot.game.revision, 'one move, one score, one revision bump');
  const pid = uuidFrom(w.rng);
  const p1 = await w.raw('B', { action: 'pass_turn', game_id: w.gameId, client_action_id: pid, base_revision: r1.snapshot.game.revision });
  const p2 = await w.raw('B', { action: 'pass_turn', game_id: w.gameId, client_action_id: pid, base_revision: r1.snapshot.game.revision });
  ok(p1.ok && p2.ok && p2.snapshot.moves.length === 2, 'a retried pass does not pass twice');
  const hijack = await w.raw('B', { ...body, client_action_id: id });
  ok(!hijack.ok && hijack.code === 'NOT_MEMBER' || (hijack.ok && hijack.duplicate && hijack.snapshot.me.seat === 1), "someone else's action id cannot be replayed to act for them");
  const noId = await w.raw('A', { ...body, client_action_id: undefined });
  ok(!noId.ok && noId.code === 'BAD_REQUEST', 'a mutation without an action id is refused');
}
group('unauthorized access');
{
  const w = await fresh();
  const read = await w.raw('C', { action: 'snapshot', game_id: w.gameId });
  ok(!read.ok && read.code === 'NOT_MEMBER' && !JSON.stringify(read).includes(w.snap.A.me.rack[0].id), 'a stranger gets nothing, not even a tile id');
  for (const act of ['pass_turn', 'submit_move', 'swap_tiles', 'resign_game', 'request_tahkim', 'claim_timeout', 'rematch', 'set_ready', 'leave_room']) {
    const r = await w.raw('C', { action: act, game_id: w.gameId, client_action_id: uuidFrom(w.rng), base_revision: w.snap.A.game.revision, placements: [], tileIds: [] });
    ok(!r.ok && r.code === 'NOT_MEMBER', `stranger cannot ${act}`);
  }
  const bad = await w.raw('A', { action: 'drop_database', game_id: w.gameId });
  ok(!bad.ok && bad.code === 'BAD_REQUEST', 'unknown actions are refused');
  const noUser = await (await import('../../supabase/functions/_shared/core/service.js')).handleRequest(w.store, 'not-a-uuid', { action: 'snapshot', game_id: w.gameId }, w.deps);
  ok(!noUser.ok, 'an invalid identity is refused');
  const inject = await w.raw('A', { action: 'snapshot', game_id: "x'; drop table games;--" });
  ok(!inject.ok && inject.code === 'BAD_REQUEST', 'a non-uuid game id is refused before any lookup');
}
group('errors do not leak internals');
{
  const w = await fresh(); w.store.load = async () => { throw new Error('connection to server at "10.0.0.5" failed: password authentication failed for user "postgres"'); };
  const r = await w.raw('A', { action: 'snapshot', game_id: w.gameId });
  ok(!r.ok && r.code === 'SERVER_ERROR' && !/postgres|10\.0|password/.test(JSON.stringify(r)), 'database errors are replaced by a human message');
  ok(w.logs.every(([, f]) => !/rack|bag/.test(Object.keys(f).join())), 'logs carry no rack or bag fields');
}
group('rack never travels to the other player: every response, every action');
{
  const w = makeWorld(); const resp = [];
  const orig = w.call; 
  await w.start();
  w.giveRack('A', [...'كتابمدر']); w.giveRack('B', [...'سلامنوع']); await w.call('A', 'snapshot'); await w.call('B', 'snapshot');
  const aIds = () => w.server().racks[w.users.A].filter(Boolean).map(t => t.id), bIds = () => w.server().racks[w.users.B].filter(Boolean).map(t => t.id);
  const sees = (r, ids) => ids.filter(id => JSON.stringify(r).includes(id)).length;
  const a1 = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') });
  const bBefore = bIds();
  ok(sees(a1, bBefore) === 0, 'A\'s move response contains no tile of B');
  const b1 = await w.call('B', 'snapshot'); ok(sees(b1, aIds().filter(id => !b1.snapshot.board.flat().some(t => t && t.id === id))) === 0, 'B\'s snapshot contains none of A\'s remaining tiles');
  const b2 = await w.call('B', 'pass_turn'); const stillA = aIds(); ok(sees(b2, stillA) === 0, 'B\'s pass response contains no tile of A');
  const b3 = await w.call('B', 'request_tahkim'); ok(!b3.ok, 'B cannot challenge on A\'s turn');
}
done();
