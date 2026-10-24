import { makeWorld, suite, across, loadRealDictionary } from './lib.mjs';
import { settleEnd } from '../../supabase/functions/_shared/game/rules.js';
const { ok, group, done } = suite('online endgame, clock, resign, rematch');
await loadRealDictionary();

group('rack emptied: settlement identical to the local game');
{
  const w = makeWorld(); await w.start(); w.server().priv.bag.length = 0;   // empty bag: the rack cannot be refilled
  w.giveRack('A', [...'كتاب']); w.giveRack('B', [...'مدرسة']); await w.call('A', 'snapshot'); await w.call('B', 'snapshot');
  const rackB = w.server().racks[w.users.B].filter(Boolean);
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') });
  ok(r.ok && r.snapshot.game.status === 'finished' && r.snapshot.game.result.reason === 'rack', 'finished with reason "rack"');
  const exp = settleEnd([{ score: 14, rack: [], ms: 25 * 60000 }, { score: 0, rack: rackB, ms: 25 * 60000 }]);
  ok(r.snapshot.players[0].score === exp[0].score && r.snapshot.players[1].score === exp[1].score, `scores adjusted: ${r.snapshot.players.map(p => p.score)} == ${exp.map(e => e.score)}`);
  ok(r.snapshot.game.result.lines[1].ded === rackB.reduce((s, t) => s + t.v, 0) && r.snapshot.game.result.lines[0].bon === 25, 'deduction and time bonus are reported');
  ok(r.snapshot.game.winner_seat === (exp[0].score > exp[1].score ? 0 : 1), 'winner decided by the server');
  const b = (await w.call('B', 'snapshot')).snapshot;
  ok(JSON.stringify(b.game.result) === JSON.stringify(r.snapshot.game.result) && b.game.winner_seat === r.snapshot.game.winner_seat, 'both clients receive the identical result');
  ok(b.game.turn_deadline_at === null, 'no clock after the end');
  for (const act of ['pass_turn', 'submit_move', 'swap_tiles', 'request_tahkim', 'claim_timeout']) { const x = await w.call('B', act, { placements: [], tileIds: [] }); ok(!x.ok && x.code === 'WRONG_STATUS', `${act} is refused after the end (${x.code})`); }
}
group('tie');
{
  const w = makeWorld(); await w.start(); w.server().priv.bag.length = 0;
  w.giveRack('A', [...'كتاب']); w.giveRack('B', [...'مدرسة']); await w.call('A', 'snapshot'); await w.call('B', 'snapshot');
  const ded = w.server().racks[w.users.B].filter(Boolean).reduce((s, t) => s + t.v, 0);
  w.server().players[1].score = 14 + ded;                                    // B ends on exactly A's final score (equal clocks -> equal bonuses)
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') });
  ok(r.snapshot.players[0].score === r.snapshot.players[1].score && r.snapshot.game.winner_seat === null && r.snapshot.game.result.winner_seat === null, 'equal scores -> a tie, no winner');
}
group('time: the SERVER clock decides');
{
  const w = makeWorld(); await w.start({ minutes: 10 }); w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot');
  await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') }); const s0 = (await w.call('B', 'snapshot')).snapshot;
  ok(s0.game.clock_running && s0.game.turn_deadline_at === s0.game.turn_started_at + 10 * 60000, 'deadline = start + the player\'s remaining time (server timestamps)');
  const early = await w.call('A', 'claim_timeout'); ok(!early.ok && early.code === 'NOT_EXPIRED', 'claiming a timeout before it is due fails');
  w.clock.t += 9 * 60000; const still = await w.call('A', 'claim_timeout'); ok(!still.ok && still.code === 'NOT_EXPIRED', 'still not due at 9:00 of 10:00');
  w.clock.t += 61000;
  const late = await w.call('B', 'pass_turn');                              // B tries to act after their time ran out
  ok(!late.ok && late.code === 'TIME_UP' && late.snapshot.game.status === 'finished' && late.snapshot.game.result.reason === 'time', 'an action after the deadline ends the game by time instead of being accepted');
  const w2 = makeWorld(); await w2.start({ minutes: 10 }); w2.giveRack('A', [...'كتابمدر']); await w2.call('A', 'snapshot'); await w2.call('A', 'submit_move', { placements: across(w2.snap.A, 'كتاب') }); await w2.call('B', 'snapshot');
  w2.clock.t += 10 * 60000 + 1;
  const c = await w2.call('A', 'claim_timeout');                             // the idle opponent's page reports it
  ok(c.ok && c.snapshot.game.status === 'finished' && c.snapshot.game.result.reason === 'time', 'either player can report an expired clock; the server verifies it');
  ok(c.snapshot.players[1].ms_left === 0 && c.snapshot.game.result.lines[1].bon === 0, 'the player who ran out earns no time bonus');
  const dup = await w2.call('B', 'claim_timeout'); ok(!dup.ok && dup.code === 'WRONG_STATUS', 'a second claim is harmless');
  const w3 = makeWorld(); await w3.start({ minutes: 10 }); await w3.call('A', 'snapshot'); w3.clock.t += 3600e3;
  const noClock = await w3.call('B', 'claim_timeout'); ok(!noClock.ok && noClock.code === 'NOT_EXPIRED', 'the clock does not run before the first scored move');
}
group('time accounting across turns');
{
  const w = makeWorld(); await w.start({ minutes: 10 }); w.giveRack('A', [...'كتابمدر']); w.giveRack('B', [...'كنوزسلا']); await w.call('A', 'snapshot'); await w.call('B', 'snapshot');
  w.clock.t += 5 * 60000;                                                    // thinking time before the first move is free (clock not started)
  await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') });
  const s = (await w.call('B', 'snapshot')).snapshot; ok(s.players[0].ms_left === 10 * 60000, 'A was not charged before the clock started');
  w.clock.t += 90000; await w.call('B', 'pass_turn');
  const t = (await w.call('A', 'snapshot')).snapshot; ok(t.players[1].ms_left === 10 * 60000 - 90000, 'B was charged exactly the server-measured 90s: ' + t.players[1].ms_left);
  ok(t.players[0].ms_left === 10 * 60000, "A's time did not move while B was thinking");
  w.clock.t += 20000; const u = (await w.call('A', 'pass_turn')).snapshot; ok(u.players[0].ms_left === 10 * 60000 - 20000, 'and A is charged for A\'s turn');
}
group('resign');
{
  const w = makeWorld(); await w.start(); w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot'); await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') });
  const r = await w.call('A', 'resign_game');
  ok(r.ok && r.snapshot.game.status === 'finished' && r.snapshot.game.result.reason === 'resign' && r.snapshot.game.winner_seat === 1, 'resigning hands the win to the opponent');
  ok(r.snapshot.players[0].score === 14, 'a resignation does not alter scores');
  const again = await w.call('A', 'resign_game'); ok(!again.ok && again.code === 'WRONG_STATUS', 'cannot resign twice');
}
group('rematch');
{
  const w = makeWorld(); await w.start(); const first = (await w.call('A', 'snapshot')).snapshot;
  const early = await w.call('A', 'rematch'); ok(!early.ok && early.code === 'WRONG_STATUS', 'no rematch while the game is running');
  const oldIds = [...first.me.rack, ...w.snap.B.me.rack].map(t => t.id), oldBag = w.server().priv.bag.map(t => t.id);
  await w.call('A', 'resign_game'); await w.call('B', 'snapshot');
  const r1 = await w.call('B', 'rematch'); ok(r1.ok && r1.snapshot.game.status === 'finished' && r1.snapshot.game.rematch_seats.join() === '1', 'first request waits for the opponent');
  const dup = await w.call('B', 'rematch'); ok(dup.ok && dup.snapshot.game.rematch_seats.join() === '1', 'asking twice changes nothing');
  await w.call('A', 'snapshot');
  const r2 = await w.call('A', 'rematch');
  ok(r2.ok && r2.snapshot.game.status === 'active' && r2.snapshot.game.round === 2, 'both agreed: a new round starts');
  ok(r2.snapshot.players.every(p => p.score === 0 && p.tile_count === 7) && r2.snapshot.moves.length === 0 && r2.snapshot.board.flat().every(x => !x), 'fresh scores, board and history');
  const newIds = [...r2.snapshot.me.rack, ...(await w.call('B', 'snapshot')).snapshot.me.rack].map(t => t.id);
  ok(newIds.every(id => !oldIds.includes(id)) && w.server().priv.bag.every(t => !oldBag.includes(t.id)), 'no tile or bag state is reused from the previous round');
  ok(r2.snapshot.game.bag_count === 101 - 14 && r2.snapshot.game.current_seat === 1, 'full new bag; the starting player alternates');
  ok(r2.snapshot.game.result === null && r2.snapshot.game.winner_seat === null && r2.snapshot.game.rematch_seats.length === 0, 'old result cleared');
  ok(r2.snapshot.game.revision > r1.snapshot.game.revision, 'revision keeps increasing across rounds');
  ok(w.server().moves.length === 0 || w.server().moves.every(m => m.round >= 1), 'the move log keeps its round numbers');
}
done();
