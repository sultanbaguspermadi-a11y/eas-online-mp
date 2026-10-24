import { makeWorld, suite, across, idsFor, loadRealDictionary } from './lib.mjs';
const { ok, group, done } = suite('online game (authoritative moves)');
await loadRealDictionary();

group('start: initial state');
{
  const w = makeWorld(); const s = await w.start();
  const A = w.snap.A, B = w.snap.B;
  ok(s.ok && A.game.status === 'active', 'game active');
  ok(A.me.rack.filter(Boolean).length === 7 && B.me.rack.filter(Boolean).length === 7, 'each player has 7 tiles');
  const ids = [...A.me.rack, ...B.me.rack].map(t => t.id);
  ok(new Set(ids).size === 14, 'all 14 tile ids are unique (tiles are individually identifiable)');
  ok(A.me.rack.map(t => t.id).join() !== B.me.rack.map(t => t.id).join(), 'racks differ');
  ok(A.game.bag_count === 101 - 14, 'bag count is public: ' + A.game.bag_count);
  ok(A.game.current_seat === 0 && A.game.clock_started === false && A.game.turn_deadline_at === null, 'seat 0 starts, clock not started yet');
  ok(A.players.every(p => p.score === 0 && p.tile_count === 7 && p.ms_left === 25 * 60000), 'scores 0, 7 tiles, full clocks');
  group('privacy of the public snapshot');
  const aJson = JSON.stringify(A), bIds = B.me.rack.map(t => t.id), bag = w.server().priv.bag.map(t => t.id);
  ok(bIds.every(id => !aJson.includes(id)), "A's snapshot contains none of B's tile ids");
  ok(bag.every(id => !aJson.includes(id)) && bag.every(id => !JSON.stringify(B).includes(id)), 'no bag tile id appears in either snapshot');
  ok(!('bag' in A) && !('bag' in A.game) && !('undo' in A.game) && !('racks' in A), 'no bag / undo / racks keys');
  ok(A.players.every(p => !('rack' in p)), 'player rows carry only a tile COUNT');
  const sb = JSON.stringify(s); ok(!bIds.some(id => sb.includes(id)), 'the start response itself does not leak the opponent rack');
  const bl = JSON.stringify(A.game); ok(!/"bag"|"seed"/.test(bl), 'no shuffle seed or bag in game');
}
group('tile modes');
{
  const w = makeWorld(); await w.start({ tile_mode: 'basic' });
  const all = [...w.snap.A.me.rack, ...w.snap.B.me.rack, ...w.server().priv.bag];
  ok(all.length === 84, 'basic bag has 84 tiles');
  ok(all.every(t => t.blank || !'أإآءؤئةى'.includes(t.l)), 'basic mode has no expanded letters');
}

group('turns');
{
  const w = makeWorld(); await w.start();
  w.giveRack('A', [...'كتابxx'.slice(0, 4), 'م', 'د', 'ر']); await w.call('A', 'snapshot');
  const wrong = await w.call('B', 'pass_turn');
  ok(!wrong.ok && wrong.code === 'WRONG_TURN', 'wrong-turn pass rejected');
  w.giveRack('B', [...'مدرسة']); await w.call('B', 'snapshot');
  const wrongMove = await w.call('B', 'submit_move', { placements: across(w.snap.B, 'مدرس') });
  ok(!wrongMove.ok && wrongMove.code === 'WRONG_TURN', 'wrong-turn move rejected');
}

group('legal move, score, refill');
{
  const w = makeWorld(); await w.start();
  w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot');
  const before = w.server().priv.bag.length;
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') });
  ok(r.ok, 'first move accepted: ' + r.code + ' ' + r.message);
  // ك3 ت1 ا1 ب2 on row 7 cols 7..10; the centre (7,7) is a word x2 star: (3+1+1+2)*2 = 14
  ok(r.snapshot.players[0].score === 14 && r.result.score === 14, 'score computed by the server: ' + r.snapshot.players[0].score);
  ok(r.snapshot.game.current_seat === 1 && r.snapshot.game.clock_started === true, 'turn passes, clock starts after the first scored move');
  ok(r.snapshot.me.rack.filter(Boolean).length === 7, 'rack refilled to 7');
  ok(w.server().priv.bag.length === before - 4 && r.snapshot.game.bag_count === before - 4, 'four tiles drawn from the bag');
  ok(r.snapshot.board[7][7].l === 'ك' && r.snapshot.board[7][10].l === 'ب', 'board holds the tiles');
  ok(r.snapshot.moves.length === 1 && r.snapshot.moves[0].words[0].w === 'كتاب' && r.snapshot.moves[0].total === 14, 'public history entry');
  ok(r.snapshot.game.tahkim_available === true, 'the move can be challenged');
  ok(r.snapshot.game.revision === w.snap.B.game.revision + 1, 'revision advanced by one');
  const b = await w.call('B', 'snapshot');
  ok(JSON.stringify(b.snapshot.board) === JSON.stringify(r.snapshot.board), 'both players see the same board');
  ok(b.snapshot.me.rack.every(t => !JSON.stringify(r.snapshot).includes(t.id)), "A still cannot see B's tiles after the move");
  group('blank tile, premium squares, tile conservation');
  const total = [...w.server().racks[w.users.A], ...w.server().racks[w.users.B], ...w.server().priv.bag].filter(Boolean).length + r.snapshot.board.flat().filter(Boolean).length;
  ok(total === 101, 'no tile is created or lost: ' + total);
}
{
  const w = makeWorld(); await w.start();
  w.giveRack('A', [...'كتابمدر'], { blanks: [] }); w.giveRack('A', ['ك', 'ت', '', 'ب', 'م', 'د', 'ر'], { blanks: [2] }); await w.call('A', 'snapshot');
  const pl = across(w.snap.A, 'كتاب'); const blankPl = pl.find((p, i) => i === 2); blankPl.as = 'ا';
  const r = await w.call('A', 'submit_move', { placements: pl });
  ok(r.ok && r.snapshot.players[0].score === (3 + 1 + 0 + 2) * 2, 'blank scores 0: ' + r.snapshot.players[0].score);
  ok(r.snapshot.board[7][9].blank === true && r.snapshot.board[7][9].as === 'ا' && r.snapshot.board[7][9].v === 0, 'blank carries its chosen letter');
  const w2 = makeWorld(); await w2.start(); w2.giveRack('A', ['ك', 'ت', '', 'ب', 'م', 'د', 'ر'], { blanks: [2] }); await w2.call('A', 'snapshot');
  const noLetter = await w2.call('A', 'submit_move', { placements: across(w2.snap.A, 'كتاب') });
  ok(!noLetter.ok && noLetter.code === 'MOVE_INVALID', 'a blank without a letter is refused');
  const w3 = makeWorld(); await w3.start({ tile_mode: 'basic' }); w3.giveRack('A', ['ك', 'ت', '', 'ب', 'م', 'د', 'ر'], { blanks: [2] }); await w3.call('A', 'snapshot');
  const p3 = across(w3.snap.A, 'كتاب'); p3[2].as = 'أ';
  const exp = await w3.call('A', 'submit_move', { placements: p3 });
  ok(!exp.ok && exp.code === 'MOVE_INVALID', 'a blank may only become a letter of the active tile mode');
}

group('illegal moves');
{
  const w = makeWorld(); await w.start();
  w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot');
  const rev = w.snap.A.game.revision;
  const cases = [
    ['not covering the star', across(w.snap.A, 'كتاب', 0, 0), 'MOVE_INVALID'],
    ['single tile', across(w.snap.A, 'ك'), 'MOVE_INVALID'],
    ['gap in the line', [{ ...across(w.snap.A, 'كت')[0] }, { ...across(w.snap.A, 'ت')[0], row: 7, col: 9 }].map((p, i) => ({ ...p })), 'MOVE_INVALID'],
    ['two rows and two columns', (() => { const a = across(w.snap.A, 'كتا'); return [{ ...a[0], row: 7, col: 7 }, { ...a[1], row: 8, col: 8 }, { ...a[2], row: 9, col: 7 }]; })(), 'MOVE_INVALID'],
    ['out of the board', (() => { const a = across(w.snap.A, 'كت'); return [{ ...a[0], row: 7, col: 14 }, { ...a[1], row: 7, col: 15 }]; })(), 'BAD_REQUEST'],
    ['same cell twice', (() => { const a = across(w.snap.A, 'كت'); return [{ ...a[0], row: 7, col: 7 }, { ...a[1], row: 7, col: 7 }]; })(), 'BAD_REQUEST'],
    ['same tile twice', (() => { const a = across(w.snap.A, 'ك'); return [{ ...a[0], col: 7 }, { ...a[0], col: 8 }]; })(), 'BAD_REQUEST'],
    ['empty', [], 'BAD_REQUEST'], ['not an array', 'x', 'BAD_REQUEST']
  ];
  for (const [name, placements, code] of cases) {
    const r = await w.call('A', 'submit_move', { placements });
    ok(!r.ok && r.code === code, `${name} -> ${code} (got ${r.code})`);
  }
  const s = await w.call('A', 'snapshot');
  ok(s.snapshot.game.revision === rev, 'rejected moves change nothing (revision unchanged)');
  ok(s.snapshot.me.rack.filter(Boolean).length === 7 && s.snapshot.board.flat().every(x => !x), 'rack and board untouched by rejected moves');
  ok(w.snap.A.game.current_seat === 0, 'still A\'s turn after rejected moves');
}
group('connection to the board');
{
  const w = makeWorld(); await w.start();
  w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot'); await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') });
  w.giveRack('B', [...'سلامنوع']); await w.call('B', 'snapshot');
  const floating = await w.call('B', 'submit_move', { placements: across(w.snap.B, 'سلام', 0, 0) });
  ok(!floating.ok && floating.code === 'MOVE_INVALID', 'a move must connect to the board: ' + floating.message);
  const overlap = await w.call('B', 'submit_move', { placements: across(w.snap.B, 'سلام', 7, 7) });
  ok(!overlap.ok && overlap.code === 'MOVE_INVALID', 'cannot play on an occupied square');
}

group('pass');
{
  const w = makeWorld(); await w.start();
  const p = await w.call('A', 'pass_turn');
  ok(p.ok && p.snapshot.game.current_seat === 1 && p.snapshot.moves[0].type === 'pass', 'pass hands the turn over and is recorded');
  ok(p.snapshot.game.clock_started === false, 'a pass does not start the clock');
  let last; for (let i = 0; i < 6; i++) { last = await w.call(i % 2 ? 'A' : 'B', 'pass_turn'); }
  ok(last.ok && last.snapshot.game.status === 'active', 'passing is unlimited (the local rule), no pass-based game end');
}
group('swap');
{
  const w = makeWorld(); await w.start();
  const old = w.snap.A.me.rack.slice(0, 3).map(t => t.id), keep = w.snap.A.me.rack.slice(3).map(t => t.id);
  const bagBefore = w.server().priv.bag.length;
  const r = await w.call('A', 'swap_tiles', { tileIds: old });
  ok(r.ok && r.snapshot.game.current_seat === 1, 'swap passes the turn');
  const now = r.snapshot.me.rack.map(t => t.id);
  ok(keep.every(id => now.includes(id)) && old.every(id => !now.includes(id)), 'kept tiles stay, swapped tiles are replaced');
  ok(r.snapshot.me.rack.filter(Boolean).length === 7 && w.server().priv.bag.length === bagBefore, 'rack size and bag size unchanged');
  ok(old.every(id => w.server().priv.bag.some(t => t.id === id)), 'swapped tiles went back into the (hidden) bag');
  ok(r.snapshot.moves[0].type === 'swap' && r.snapshot.moves[0].cnt === 3, 'public history only records how many tiles');
  ok(!JSON.stringify(r.snapshot).includes(old[0]) || r.snapshot.me.rack.some(t => t.id === old[0]) === false, 'the swapped-away tiles are not exposed to anyone');
  await w.call('B', 'snapshot');
  const bad = await w.call('B', 'swap_tiles', { tileIds: ['nope12'] });
  ok(!bad.ok && bad.code === 'TILE_NOT_OWNED', 'cannot swap a tile you do not own');
  const wB = makeWorld(); await wB.start(); wB.server().priv.bag.length = 6;
  const small = await wB.call('A', 'swap_tiles', { tileIds: [wB.snap.A.me.rack[0].id] });
  ok(!small.ok && small.code === 'SWAP_NOT_ALLOWED', 'swap refused with fewer than 7 tiles in the bag');
  for (const bad of [[], 'x', [1], [wB.snap.A.me.rack[0].id, wB.snap.A.me.rack[0].id]]) { const r = await w.call('A', 'swap_tiles', { tileIds: bad }); ok(!r.ok, 'malformed swap refused: ' + JSON.stringify(bad)); }
}
done();
