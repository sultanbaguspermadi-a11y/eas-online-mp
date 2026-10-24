import { makeWorld, suite } from './lib.mjs';
const { ok, group, done } = suite('online rooms');

group('create / join');
{
  const w = makeWorld();
  const c = await w.raw('A', { action: 'create_room', nickname: '  Sultan  ' });
  ok(c.ok && c.created, 'room created');
  const g = c.snapshot.game;
  ok(/^[A-HJ-NP-Z2-9]{6}$/.test(g.room_code), 'room code is 6 unambiguous characters: ' + g.room_code);
  ok(g.status === 'lobby' && c.snapshot.players.length === 1 && c.snapshot.players[0].nickname === 'Sultan', 'lobby with the host, nickname trimmed');
  ok(c.snapshot.me.seat === 0 && c.snapshot.game.host_player_id === w.users.A, 'creator is host in seat 0');
  const j = await w.raw('B', { action: 'join_room', code: g.room_code.toLowerCase(), nickname: 'Ahmad' });
  ok(j.ok && j.snapshot.me.seat === 1 && j.snapshot.players.length === 2, 'valid code joins (case-insensitive)');
  ok(j.snapshot.game.revision > g.revision, 'joining bumps the revision');
  const again = await w.raw('B', { action: 'join_room', code: g.room_code, nickname: 'Ahmad' });
  ok(again.ok && again.rejoined && again.snapshot.players.length === 2, 'duplicate join is a harmless rejoin, not a second seat');
}
group('invalid / full / started');
{
  const w = makeWorld();
  const c = await w.raw('A', { action: 'create_room', nickname: 'A' }), code = c.snapshot.game.room_code;
  const bad = await w.raw('B', { action: 'join_room', code: 'ZZZZZZ' });
  ok(!bad.ok && bad.code === 'ROOM_NOT_FOUND', 'unknown code -> ROOM_NOT_FOUND');
  for (const junk of ['', 'abc', null, 12345, 'K7Q4P!', 'IIIIII', { x: 1 }]) { const r = await w.raw('B', { action: 'join_room', code: junk }); ok(!r.ok && r.code === 'ROOM_NOT_FOUND', 'malformed code rejected: ' + JSON.stringify(junk)); }
  await w.raw('B', { action: 'join_room', code, nickname: 'B' });
  const third = await w.raw('C', { action: 'join_room', code, nickname: 'C' });
  ok(!third.ok && third.code === 'ROOM_FULL', 'third player -> ROOM_FULL');
  ok(!third.snapshot, 'the refusal leaks no game data');
  const w2 = makeWorld(); await w2.start();
  const late = await w2.raw('C', { action: 'join_room', code: w2.snap.A.game.room_code, nickname: 'C' });
  ok(!late.ok && (late.code === 'ROOM_FULL' || late.code === 'GAME_STARTED'), 'cannot join a started game: ' + late.code);
  const back = await w2.raw('B', { action: 'join_room', code: w2.snap.A.game.room_code, nickname: 'B' });
  ok(back.ok && back.rejoined, 'a member can come back into a started game (reconnection)');
}
group('one game at a time');
{
  const w = makeWorld(); await w.room();
  const again = await w.raw('A', { action: 'create_room', nickname: 'A' });
  ok(!again.ok && again.code === 'ALREADY_IN_GAME' && again.snapshot.game.id === w.gameId, 'a second room is refused and the existing one is offered for resuming');
}
group('lobby rules');
{
  const w = makeWorld(); await w.room({}, { A: 'A', B: 'B' });
  const s = await w.call('A', 'start_game');
  ok(!s.ok && s.code === 'NOT_READY' || s.ok, 'start requires a ready guest');
}
{
  const w = makeWorld(); const c = await w.raw('A', { action: 'create_room', nickname: 'A' }); w.snap.A = c.snapshot;
  const gid = c.snapshot.game.id;
  const early = await w.raw('A', { action: 'start_game', game_id: gid, client_action_id: '11111111-1111-4111-8111-111111111111' });
  ok(!early.ok && early.code === 'NEED_OPPONENT', 'cannot start alone');
  const j = await w.raw('B', { action: 'join_room', code: c.snapshot.game.room_code, nickname: 'B' }); w.snap.B = j.snapshot;
  const notReady = await w.raw('A', { action: 'start_game', game_id: gid, client_action_id: '22222222-2222-4222-8222-222222222222' });
  ok(!notReady.ok && notReady.code === 'NOT_READY', 'cannot start before the guest is ready');
  const guestStart = await w.raw('B', { action: 'start_game', game_id: gid, client_action_id: '33333333-3333-4333-8333-333333333333' });
  ok(!guestStart.ok && guestStart.code === 'NOT_HOST', 'unauthorized start: only the host may start');
  const outsider = await w.raw('C', { action: 'start_game', game_id: gid, client_action_id: '44444444-4444-4444-8444-444444444444' });
  ok(!outsider.ok && outsider.code === 'NOT_MEMBER', 'a non-member cannot act on the room');
  const snapOut = await w.raw('C', { action: 'snapshot', game_id: gid });
  ok(!snapOut.ok && snapOut.code === 'NOT_MEMBER' && !snapOut.snapshot, 'a non-member cannot read the room');
}
group('settings');
{
  const w = makeWorld(); await w.room();
  const g1 = await w.call('B', 'update_settings', { settings: { minutes: 10 } });
  ok(!g1.ok && g1.code === 'NOT_HOST', 'guest cannot change the rules');
  const g2 = await w.call('A', 'update_settings', { settings: { tile_mode: 'basic', minutes: 10, validator_mode: 'tahkim' } });
  ok(g2.ok && g2.snapshot.game.tile_mode === 'basic' && g2.snapshot.game.minutes === 10 && g2.snapshot.game.validator_mode === 'tahkim', 'host changes the rules');
  ok(g2.snapshot.players.find(p => p.seat === 1).ready === false, 'a rule change resets the guest\'s ready flag');
  for (const bad of [{ tile_mode: 'nope' }, { minutes: 7 }, { validator_mode: 'x' }]) { const r = await w.call('A', 'update_settings', { settings: bad }); ok(!r.ok && r.code === 'BAD_REQUEST', 'invalid setting rejected: ' + JSON.stringify(bad)); }
  await w.call('B', 'set_ready', { ready: true });
  const st = await w.call('A', 'start_game');
  ok(st.ok && st.snapshot.game.status === 'active' && st.snapshot.game.tile_mode === 'basic', 'game starts with the locked rules');
  const late = await w.call('A', 'update_settings', { settings: { minutes: 40 } });
  ok(!late.ok && late.code === 'WRONG_STATUS', 'rules are locked once the match started');
}
group('leaving');
{
  const w = makeWorld(); await w.room();
  const l = await w.call('B', 'leave_room');
  ok(l.ok, 'guest leaves the lobby');
  const a = await w.call('A', 'snapshot');
  ok(a.snapshot.players.length === 1, 'room is open again');
  const j = await w.raw('C', { action: 'join_room', code: a.snapshot.game.room_code, nickname: 'C' });
  ok(j.ok && j.snapshot.me.seat === 1, 'another player can take the seat');
  const h = await w.call('A', 'leave_room');
  ok(h.ok && h.snapshot.game.status === 'abandoned', 'host leaving closes the room');
  const k = await w.raw('B', { action: 'join_room', code: a.snapshot.game.room_code, nickname: 'B' });
  ok(!k.ok, 'a closed room cannot be joined');
}
done();
