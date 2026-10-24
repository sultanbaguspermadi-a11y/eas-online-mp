// Single source of mutable game state plus small state-related helpers. No DOM rendering.
import { SIZE, RACK, DEFAULT_MINUTES, DEFAULT_MODE, NAMES } from './config.js';
import { TILE_MODES } from './modes.js';
import { makeTileSet } from './rules.js';

export const $ = s => document.querySelector(s);

// Tile id -> tile (identity registry; tiles are only created in createGame)
export const BY = {};

// The single game-state object. It is mutated in place (never reassigned) so every module
// that imported it always sees the current game.
export const S = {};

// Session-level (not per-game) state shared across modules.
// app.mode only changes inside createState, so the tile mode can never change while a game is active.
export const app = {
  minutes: DEFAULT_MINUTES,
  mode: DEFAULT_MODE,   // id of the active tile mode (see modes.js)
  pendingMode: null,    // mode picked in the setup flow, applied only when the game actually starts
  firstRun: true,
  judge: null,   // active judge session or null
  net: null,     // online session (js/online/session.js) while playing online, otherwise null: local play never touches it
  names: null,   // [seat0, seat1] display names while online
  gameId: 0      // bumps on every new game; lets the history renderer detect a fresh game
};

export const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const fmt = ms => { const s = Math.ceil(ms / 1000); return String(s / 60 | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
export const inMove = t => S.move.find(e => e.t === t);
export const cur = () => S.players[S.cur];
export const refill = p => { for (let i = 0; i < RACK && S.bag.length; i++) if (!p.rack[i]) p.rack[i] = S.bag.pop(); };
export const pushHist = h => { S.hist.push({n: S.hist.length + 1, ...h}); S.hv++; };

export const playerName = i => app.names?.[i] || NAMES[i];
export const bagCount = () => (app.net ? S.bagCount : S.bag.length);
export const profile = () => TILE_MODES[app.mode];

// Build a fresh game state in place for the given tile mode.
export function createState(min, mode = app.mode) {
  app.minutes = min;
  app.mode = TILE_MODES[mode] ? mode : DEFAULT_MODE;
  app.gameId++;
  let id = 0;
  for (const k in BY) delete BY[k];
  const bag = makeTileSet(app.mode, () => ++id);
  bag.forEach(t => { BY[t.id] = t; });
  shuffle(bag);
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, {
    board: Array.from({length: SIZE}, () => Array(SIZE).fill(null)), bag,
    players: [0, 1].map(() => ({rack: Array(RACK).fill(null), score: 0, ms: min * 60000})),
    cur: 0, move: [], undo: null, swap: false, sel: new Set(), pick: null, drag: null, pending: null,
    ended: false, hist: [], hv: 0, started: false, paused: false, last: performance.now(), land: null, pop: null
  });
  S.players.forEach(refill);
}

// Pre-move snapshot used by undo and judge rulings.
export function snapshot() {
  const mv = new Set(S.move.map(e => e.t));
  const racks = S.players.map(p => p.rack.map(t => t ? t.id : null));
  S.move.forEach(e => { racks[S.cur][e.slot] = e.t.id; });
  return {board: S.board.map(r => r.map(t => t && !mv.has(t) ? t.id : null)), racks, bag: S.bag.map(t => t.id),
    scores: S.players.map(p => p.score), cur: S.cur, started: S.started, times: S.players.map(p => p.ms)};
}

// Restore a pre-move snapshot; keepTime leaves the clocks as they are (used by judge rulings).
export function restore(u, keepTime) {
  S.board = u.board.map(r => r.map(id => id && BY[id]));
  S.players.forEach((p, i) => { p.rack = u.racks[i].map(id => id && BY[id]); p.score = u.scores[i]; if (!keepTime) p.ms = u.times[i]; });
  S.bag = u.bag.map(id => BY[id]);
  [...S.bag, ...S.players.flatMap(p => p.rack)].forEach(t => { if (t && t.blank) t.as = null; });
  S.cur = u.cur; S.started = u.started; S.undo = null; S.last = performance.now(); S.pick = null; S.sel.clear();
}
