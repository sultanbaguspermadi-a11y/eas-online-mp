// Pure game rules shared by the browser (local play) and the online server (supabase/functions).
// No DOM, no game-state singleton, no I/O: every function takes the data it needs and returns a result.
// Keeping this one module the only implementation of "is this move legal and what is it worth" is what stops the
// local game and the authoritative online game from ever disagreeing about a rule.
import { SIZE, RACK, BINGO, CENTER, LAYOUT, PENALTY } from './config.js';
import { TILE_MODES } from './modes.js';

export const wordStr = w => w.map(x => x.t.blank ? x.t.as || '' : x.t.l).join('');

// Validates a pending move on board B (15x15, tile objects or null) where the move m is [{t, r, c}] and the tiles
// of m are ALREADY on B. Returns {err} or {words, isNew}.
export function analyzeMove(B, m) {
  if (!m.length) return {err: 'ضع قطعة واحدة على الأقل.'};
  const rows = new Set(m.map(e => e.r)), cols = new Set(m.map(e => e.c));
  if (rows.size > 1 && cols.size > 1) return {err: 'يجب أن تكون القطع في صف واحد أو عمود واحد.'};
  const horiz = rows.size === 1, line = horiz ? m.map(e => e.c) : m.map(e => e.r);
  for (let k = Math.min(...line); k <= Math.max(...line); k++)
    if (!(horiz ? B[m[0].r][k] : B[k][m[0].c])) return {err: 'لا يجوز ترك فجوات بين القطع الجديدة.'};
  const isNew = (r, c) => m.some(e => e.r === r && e.c === c);
  const first = B.flat().filter(Boolean).length === m.length;
  if (first && !isNew(CENTER, CENTER)) return {err: 'الحركة الأولى يجب أن تغطي مربع «نجمة».'};
  const words = [], seen = new Set();
  const run = (r, c, dr, dc) => {
    while (r - dr >= 0 && c - dc >= 0 && B[r - dr][c - dc]) { r -= dr; c -= dc; }
    const w = [];
    while (r < SIZE && c < SIZE && B[r][c]) { w.push({r, c, t: B[r][c]}); r += dr; c += dc; }
    return w;
  };
  for (const e of m) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const w = run(e.r, e.c, dr, dc);
    if (w.length < 2) continue;
    const key = w[0].r + ',' + w[0].c + ',' + dr;
    if (!seen.has(key)) { seen.add(key); words.push(w); }
  }
  if (!words.length) return {err: 'يجب تكوين كلمة من حرفين أو أكثر.'};
  if (!first && !words.some(w => w.some(x => !isNew(x.r, x.c)))) return {err: 'يجب أن تتصل الحركة بقطع موجودة على اللوح.'};
  return {words, isNew};
}

// Returns {list: [{w, pts}], bingo, total}
export function scoreWords(words, isNew, tilesPlaced) {
  const list = [];
  for (const w of words) {
    let sum = 0, mul = 1;
    for (const x of w) {
      let v = x.t.blank ? 0 : x.t.v;
      if (isNew(x.r, x.c)) {
        const k = LAYOUT[x.r][x.c];
        if (k === 1) v *= 2; else if (k === 2) v *= 3;
        if (k === 3 || k === 5) mul *= 2; else if (k === 4) mul *= 3;
      }
      sum += v;
    }
    list.push({w: wordStr(w), pts: sum * mul});
  }
  const bingo = tilesPlaced === RACK;
  return {list, bingo, total: list.reduce((s, x) => s + x.pts, 0) + (bingo ? BINGO : 0)};
}

// The physical tiles of a tile mode, in definition order (the caller shuffles). nextId() supplies each tile's unique id.
export function makeTileSet(modeId, nextId) {
  const tiles = [];
  for (const [l, v, n] of TILE_MODES[modeId].tiles)
    for (let i = 0; i < n; i++) tiles.push({id: nextId(), l, v, blank: !l, as: null});
  return tiles;
}

// End-of-game settlement, identical for both ways of playing: every player loses the value of the tiles left on their rack
// and gains a bonus of one point per full minute left on their clock. Scores never go below zero.
// players: [{score, rack: [tile|null], ms}]  ->  [{score, ded, bon}]
export function settleEnd(players) {
  return players.map(p => {
    const ded = p.rack.reduce((s, t) => s + (t ? t.v : 0), 0), bon = Math.floor(p.ms / 60000);
    return {score: Math.max(0, p.score - ded + bon), ded, bon};
  });
}

// Penalty a challenger pays when Tahkim confirms the challenged move was valid.
export const challengePenalty = score => Math.min(PENALTY, score);
