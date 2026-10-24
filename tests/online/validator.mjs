// Online validator flow + Tahkim state machine, with the REAL dictionary and bank.
import { makeWorld, suite, across, loadRealDictionary } from './lib.mjs';
const { ok, group, done } = suite('online validator + Tahkim');
await loadRealDictionary();
const setup = async (policy, mode = 'expanded') => { const w = makeWorld(); await w.start({ validator_mode: policy, tile_mode: mode }); return w; };

group('valid word (auto)');
{
  const w = await setup('auto'); w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot');
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') });
  ok(r.ok && r.result.state === 'valid' && /✓/.test(r.result.note), 'a real word is verified: ' + JSON.stringify(r.result?.note));
  ok(!r.snapshot.moves[0].words[0].unv, 'verified words are not marked provisional');
  ok(w.server().moves[0].validation_result === 'valid', 'validation result stored with the move');
}
group('invalid word (auto) is rejected before anything changes');
{
  const w = await setup('auto'); w.giveRack('A', [...'قطبلمدر']); await w.call('A', 'snapshot'); const rev = w.snap.A.game.revision;
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'قطبل') });
  ok(!r.ok && r.code === 'WORD_REJECTED' && /قطبل/.test(r.message), 'gibberish rejected with the word named: ' + r.message);
  const s = await w.call('A', 'snapshot');
  ok(s.snapshot.game.revision === rev && s.snapshot.me.rack.filter(Boolean).length === 7 && s.snapshot.players[0].score === 0, 'rejected move changed nothing');
}
group('uncertain word (tahkim policy) -> provisional -> Tahkim');
{
  const w = await setup('tahkim'); w.giveRack('A', [...'قطبلمدر']); await w.call('A', 'snapshot');
  const original = w.snap.A.me.rack.map(t => t && t.id), bagBefore = w.server().priv.bag.map(t => t.id);
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'قطبل') });
  ok(r.ok && r.result.state === 'uncertain' && /غير مؤكدة/.test(r.result.note), 'accepted provisionally: ' + r.result?.note);
  ok(r.snapshot.moves[0].words[0].unv === true, 'the word is marked ؟ for both players');
  ok(w.server().moves[0].validation_result === 'uncertain', 'stored as uncertain, never as valid');
  const scoreA = r.snapshot.players[0].score; ok(scoreA > 0, 'provisional score applied: ' + scoreA);
  await w.call('B', 'snapshot');
  group('Tahkim: request');
  const bad = await w.call('A', 'request_tahkim'); ok(!bad.ok && bad.code === 'WRONG_TURN', 'the mover cannot challenge their own move');
  const rq = await w.call('B', 'request_tahkim');
  ok(rq.ok && rq.snapshot.game.status === 'tahkim_pending' && rq.snapshot.game.tahkim.state === 'pending', 'pending: status and state machine agree');
  ok(rq.snapshot.game.turn_deadline_at === null && rq.snapshot.game.clock_running === false, 'the clock stops while the ruling is pending');
  const a = await w.call('A', 'snapshot'); ok(JSON.stringify(a.snapshot.game.tahkim) === JSON.stringify(rq.snapshot.game.tahkim) && a.snapshot.game.status === 'tahkim_pending', 'both clients see the same Tahkim state');
  group('Tahkim: conflicting actions are blocked');
  for (const act of ['pass_turn', 'submit_move', 'swap_tiles', 'request_tahkim']) { const x = await w.call('B', act, { placements: [], tileIds: [] }); ok(!x.ok && x.code === 'TAHKIM_PENDING', `${act} blocked while pending (${x.code})`); }
  const nr = await w.call('A', 'resolve_tahkim', { verdict: 'invalid' }); ok(!nr.ok && nr.code === 'NOT_RESOLVER', 'only the resolver may rule: ' + nr.code);
  const bv = await w.call('B', 'resolve_tahkim', { verdict: 'maybe' }); ok(!bv.ok && bv.code === 'BAD_REQUEST', 'verdict must be valid|invalid');
  group('Tahkim: paused clock');
  w.clock.t += 20 * 60000;
  const msB = rq.snapshot.players[1].ms_left;
  group('Tahkim: invalid verdict voids the move');
  const v = await w.call('B', 'resolve_tahkim', { verdict: 'invalid' });
  ok(v.ok && v.snapshot.game.tahkim.state === 'resolved_invalid' && v.snapshot.game.status === 'active', 'resolved_invalid, game continues');
  ok(v.snapshot.board.flat().every(x => !x), 'board restored to before the move');
  ok(v.snapshot.players[0].score === 0 && v.snapshot.players[0].tile_count === 7, 'A\'s score and tile count restored');
  ok(v.snapshot.game.current_seat === 1, 'the mover loses the turn: B is on turn');
  ok(v.snapshot.players[1].ms_left === msB, 'no time was charged while the ruling was pending');
  ok(v.snapshot.moves[0].st === 'void', 'history shows the void ruling');
  ok(w.server().priv.bag.map(t => t.id).join() === bagBefore.join(), 'the bag is exactly as it was');
  const aNow = (await w.call('A', 'snapshot')).snapshot; ok(aNow.me.rack.map(t => t && t.id).join() === original.join(), "A's rack is exactly as it was (same tiles, same slots)");
  ok(v.snapshot.game.tahkim_available === false, 'a ruled move cannot be challenged again');
  const total = [...Object.values(w.server().racks).flat(), ...w.server().priv.bag].filter(Boolean).length + v.snapshot.board.flat().filter(Boolean).length; ok(total === 101, 'tile conservation after the ruling');
}
group('Tahkim: valid verdict penalises the challenger');
{
  const w = await setup('auto'); w.giveRack('A', [...'كتابمدر']); w.giveRack('B', [...'سلامنوع']); await w.call('A', 'snapshot'); await w.call('B', 'snapshot');
  await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') });
  await w.call('B', 'snapshot');
  const rq = await w.call('B', 'request_tahkim'); ok(rq.ok, 'request (B has 0 points)');
  const v = await w.call('B', 'resolve_tahkim', { verdict: 'valid' });
  ok(v.ok && v.snapshot.game.tahkim.state === 'resolved_valid' && v.snapshot.moves[0].st === 'ok', 'resolved_valid');
  ok(v.snapshot.players[1].score === 0 && v.snapshot.moves[0].pen === undefined, 'penalty is min(5, score): nothing to take from 0 points');
  ok(v.snapshot.players[0].score === 14 && v.snapshot.board[7][7].l === 'ك', 'the move stands');
  ok(v.snapshot.game.current_seat === 1 && v.snapshot.game.clock_running === true, 'the challenger plays on, clock running again');
  // a penalty that bites
  const w2 = await setup('auto'); w2.giveRack('A', [...'كتابمدر']); w2.giveRack('B', [...'سلامنوع']); await w2.call('A', 'snapshot'); await w2.call('B', 'snapshot');
  await w2.call('A', 'submit_move', { placements: across(w2.snap.A, 'كتاب') });
  await w2.call('B', 'snapshot');
  const bw = across(w2.snap.B, 'كتاب'.slice(0, 0) + 'ن', 8, 7); // 'كن' down from the K: K at (7,7), ن at (8,7)
  const rr = await w2.call('B', 'submit_move', { placements: bw });
  ok(rr.ok, 'B plays a word under the K: ' + rr.message);
  await w2.call('A', 'snapshot');
  await w2.call('A', 'request_tahkim'); const vv = await w2.call('A', 'resolve_tahkim', { verdict: 'valid' });
  const pen = vv.snapshot.moves[1].pen; ok(vv.ok && pen === Math.min(5, 14) && vv.snapshot.players[0].score === 14 - 5, 'challenger A pays 5: ' + vv.snapshot.players[0].score);
}
group('Tahkim: only right after a move; cancel');
{
  const w = await setup('auto'); w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot');
  await w.call('A', 'pass_turn'); await w.call('B', 'snapshot');
  const none = await w.call('B', 'request_tahkim'); ok(!none.ok && none.code === 'NO_TAHKIM', 'nothing to challenge after a pass');
  await w.call('B', 'pass_turn'); await w.call('A', 'snapshot');
  const w2 = await setup('auto'); w2.giveRack('A', [...'كتابمدر']); await w2.call('A', 'snapshot'); await w2.call('A', 'submit_move', { placements: across(w2.snap.A, 'كتاب') }); await w2.call('B', 'snapshot');
  await w2.call('B', 'request_tahkim');
  const c = await w2.call('B', 'cancel_tahkim'); ok(c.ok && c.snapshot.game.status === 'active' && c.snapshot.game.tahkim.state === 'none', 'the challenger may withdraw the challenge');
  const again = await w2.call('B', 'request_tahkim'); ok(again.ok, 'and challenge again');
}
group('policy off: no automatic check');
{
  const w = await setup('off'); w.giveRack('A', [...'قطبلمدر']); await w.call('A', 'snapshot');
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'قطبل') });
  ok(r.ok && r.result.state === 'skipped' && !r.snapshot.moves[0].words[0].unv, 'tahkim-only play: no claim of verification');
}
group('Basic mode comparison');
{
  const w = await setup('auto', 'basic'); w.giveRack('A', [...'مدينهر']); await w.call('A', 'snapshot');
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'مدينه') });
  ok(r.ok, 'basic mode compares by what the 28 tiles can spell (مدينه is valid): ' + r.message);
}
done();
