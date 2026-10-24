// Test world: the REAL server code on an in-memory store, with seeded randomness and a movable clock.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { MemoryStore } from './memory-store.mjs';
import { handleRequest } from '../../supabase/functions/_shared/core/service.js';
import * as V from '../../supabase/functions/_shared/game/validator.js';
import { EXPANDED_TILES } from '../../supabase/functions/_shared/game/modes.js';
const VALUE = Object.fromEntries(EXPANDED_TILES.map(([l, v]) => [l, v]));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hex = (rng, n) => Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join('');
export const uuidFrom = rng => `${hex(rng, 8)}-${hex(rng, 4)}-4${hex(rng, 3)}-a${hex(rng, 3)}-${hex(rng, 12)}`;

let dictLoaded = null;
export function loadRealDictionary() {   // the real data files, read from disk exactly as the Edge Function reads them over HTTP
  const file = n => path.join(ROOT, 'js', 'dictionary', 'data', n);
  return dictLoaded ||= V.loadDictionary({ fetchText: n => fs.readFileSync(file(n), 'utf8'), fetchBytes: n => fs.readFileSync(file(n)), bank: 'wait' }).then(() => V.warmDictionary('expanded'));
}

export function makeWorld({ seed = 7, who = ['A', 'B', 'C'] } = {}) {
  const rng = mulberry32(seed), clock = { t: 1_700_000_000_000 }, logs = [];
  const store = new MemoryStore(() => clock.t);
  const deps = { rng, now: () => clock.t, uuid: () => uuidFrom(rng), log: (e, f) => logs.push([e, f]), ensureDictionary: async () => {} };
  const users = Object.fromEntries(who.map(k => [k, uuidFrom(rng)]));
  const snap = {};           // the latest snapshot each player has seen
  let gameId = null;
  const raw = (k, body) => handleRequest(store, users[k], body, deps);
  const call = async (k, action, extra = {}) => {      // like the real client: fills game id, revision and a fresh action id
    const body = { action, game_id: gameId, client_action_id: uuidFrom(rng), base_revision: snap[k]?.game.revision, ...extra };
    const r = await raw(k, body); if (r.snapshot) snap[k] = r.snapshot; return r;
  };
  const w = {
    store, deps, clock, logs, users, snap, raw, call, rng,
    get gameId() { return gameId; },
    async room(settings = {}, nick = { A: 'Sultan', B: 'Ahmad' }) {
      const c = await raw('A', { action: 'create_room', nickname: nick.A, settings }); snap.A = c.snapshot; gameId = c.snapshot.game.id;
      const j = await raw('B', { action: 'join_room', code: c.snapshot.game.room_code, nickname: nick.B }); snap.B = j.snapshot;
      await call('B', 'set_ready', { ready: true }); await call('A', 'snapshot'); return c.snapshot.game.room_code;
    },
    async start(settings = {}) { await w.room(settings); const r = await call('A', 'start_game'); await call('B', 'snapshot'); return r; },
    seatOfUser: k => snap[k].me.seat,
    turn: () => snap.A.game.current_seat,
    who: seat => ['A', 'B'].find(k => snap[k].me.seat === seat),
    // --- test-only arrangement of server-private state ---
    server() { return store.peek(gameId); },
    giveRack(k, letters, { blanks = [] } = {}) {          // put exact letters on a player's rack (ids are fresh); the bag is left alone
      const { racks } = store.peek(gameId), pid = users[k];
      racks[pid] = Array.from({ length: 7 }, (_, i) => letters[i] === undefined ? null : { id: 'T' + k + i + hex(rng, 3), l: blanks.includes(i) ? '' : letters[i], v: blanks.includes(i) ? 0 : (VALUE[letters[i]] ?? 1), blank: blanks.includes(i), as: null });
      store.peek(gameId).players.find(p => p.player_id === pid).tile_count = racks[pid].filter(Boolean).length;
    }
  };
  return w;
}
export const tilesOf = (snap) => snap.me.rack.filter(Boolean);
export const idsFor = (snap, letters) => { const used = new Set(); return [...letters].map(l => { const t = snap.me.rack.find(x => x && !used.has(x.id) && !x.blank && x.l === l) || snap.me.rack.find(x => x && !used.has(x.id) && x.blank); used.add(t.id); return t.id; }); };
export const across = (snap, word, row = 7, col = 7) => idsFor(snap, word).map((tileId, i) => ({ tileId, row, col: col + i }));

export function suite(name) {
  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
  const group = n => console.log('\n# ' + n);
  console.log(`\n=== ${name}`);
  const done = () => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); };
  return { ok, group, done };
}
