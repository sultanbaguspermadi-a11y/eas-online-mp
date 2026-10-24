// The dictionary never loaded (this process does not load it): the server must say "unverified", never "verified".
import { makeWorld, suite, across } from './lib.mjs';
const { ok, group, done } = suite('online validator: dictionary unavailable');
for (const policy of ['auto', 'tahkim']) {
  group('policy ' + policy);
  const w = makeWorld(); await w.start({ validator_mode: policy });
  w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot');
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') });
  ok(r.ok, 'the move is not blocked (fast, no hard dependency on the large word bank)');
  ok(r.result.state === 'unavailable', 'state is explicitly "unavailable", not "valid": ' + r.result.state);
  ok(!/✓/.test(r.result.note) && /تعذّر التحقق/.test(r.result.note), 'message says it could not be verified: ' + r.result.note);
  ok(r.snapshot.moves[0].words.every(x => x.unv === true), 'every word is marked ؟ for both players');
  ok(w.server().moves[0].validation_result === 'unavailable', 'stored as unavailable');
  await w.call('B', 'snapshot');
  const t = await w.call('B', 'request_tahkim'); ok(t.ok && t.snapshot.game.tahkim.state === 'pending', 'Tahkim is the fallback for unverified words');
}
{
  const w = makeWorld(); await w.start({ validator_mode: 'off' }); w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot');
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') });
  ok(r.ok && r.result.state === 'skipped', 'policy off never pretends to verify either');
}
done();
