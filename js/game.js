// Gameplay operations: clock, move transaction, turn flow, pass/swap/undo, end of game.
import { MIN_BAG_SWAP, NAMES, REASONS } from './config.js';
import { $, S, app, shuffle, inMove, cur, refill, pushHist, snapshot, restore, createState, profile, playerName } from './state.js';
import { analyze, scoreWords, wordStr } from './scoring.js';
import { toast, fail, ask, render, tickUI, chooseMode, openBlankPicker, buildBlankPicker } from './ui.js';
import { checkMove, warmForMode } from './wordcheck.js';

// ---------- Clock (timestamp based; driven by a single interval in main.js) ----------
export function tick() {
  if (app.net) return app.net.tick();   // online the clock is the server's: this only displays it
  if (S.ended) return;
  const now = performance.now(), p = cur();
  if (S.paused || !S.started) { S.last = now; return; }
  p.ms = Math.max(0, p.ms - (now - S.last)); S.last = now;
  if (p.ms === 0) { endGame('time'); return; }
  tickUI();
}
function setTurn(i) { tick(); if (S.ended) return false; S.cur = i; S.last = performance.now(); return true; }

export function newGame(min = app.minutes, mode = app.mode) {
  createState(min, mode);
  buildBlankPicker();
  warmForMode();
  toast(`لعبة جديدة · ${profile().labelAr} · ${app.minutes} دقيقة`, false);
  render();
}

// ---------- Move transaction ----------
export function place(t, r, c) {
  if (app.net && !app.net.canPlay()) return false;
  if (S.ended || S.swap || S.board[r][c]) return false;
  let e = inMove(t);
  if (e) { S.board[e.r][e.c] = null; e.r = r; e.c = c; }
  else {
    const slot = cur().rack.indexOf(t);
    if (slot < 0) return false;
    cur().rack[slot] = null; e = {t, r, c, slot}; S.move.push(e);
  }
  S.board[r][c] = t; S.land = t; S.pick = null;
  // A blank tile must be given a letter before the move can continue (clock paused meanwhile).
  if (t.blank && !t.as) { S.pending = e; S.paused = true; render(); openBlankPicker(); return true; }
  render(); return true;
}
export function unplace(e) {
  S.board[e.r][e.c] = null;
  if (e.t.blank) e.t.as = null;
  const rack = cur().rack;
  const i = rack[e.slot] ? rack.indexOf(null) : e.slot;
  rack[i] = e.t;
  S.move = S.move.filter(x => x !== e);
}
export function cancelMove() {
  [...S.move].forEach(unplace);
  S.pick = null;
}

// ---------- Actions ----------
export function submit() {
  if (S.ended || S.swap) return;
  const a = analyze();
  if (a.err) return fail(a.err);
  if (app.net) return app.net.submit();   // online: the server re-validates, scores and commits; this was only the preliminary check
  // Automatic word check: runs before anything is committed, so a rejected move leaves the board, rack and clock untouched.
  const chk = checkMove(a.words.map(wordStr));
  if (chk.reject) return fail(chk.message);
  const r = scoreWords(a.words, a.isNew, S.move.length), pts = r.total, p = cur();
  if (chk.unverified.size) r.list.forEach(w => { if (chk.unverified.has(w.w)) w.unv = true; });   // provisional: shown with ؟ and open to Tahkim
  S.undo = snapshot();
  pushHist({p: S.cur, type: 'move', words: r.list, total: pts, bingo: r.bingo});
  p.score += pts; S.move = []; S.pick = null; S.pop = S.cur;
  refill(p);
  toast(`${playerName(S.cur)}: +${pts} نقطة${chk.note ? ' · ' + chk.note : ''}`, false);
  if (!p.rack.some(Boolean)) return endGame('rack');
  nextTurn(true);
}
export function nextTurn(scored) {
  if (!setTurn(1 - S.cur)) return;
  if (scored && !S.started) { S.started = true; S.last = performance.now(); }
  S.sel.clear(); S.pick = null; render();
}
export function undo() {
  if (app.net) return;   // no undo online: Tahkim is the way to take back a move
  const u = S.undo;
  if (!u || S.ended || S.swap || S.move.length) return;
  tick(); if (S.ended) return;
  restore(u); S.hist.pop(); S.hv++;
  toast('تم التراجع عن الحركة الأخيرة', false); render();
}
export function pass() {
  if (S.ended || S.swap || S.move.length) return;
  if (app.net) return app.net.pass();
  S.undo = null; pushHist({p: S.cur, type: 'pass'});   // passing is unlimited
  toast(`${playerName(S.cur)} مرّر الدور`, false); nextTurn();
}
export function startSwap() {
  if (S.ended || S.move.length) return;
  if (app.net && !app.net.canPlay()) return;
  S.swap = true; S.sel.clear(); S.pick = null; toast('اختر القطع للتبديل.', false); render();
}
export function cancelSwapOrMove() {
  if (S.ended) return;
  if (S.swap) { S.swap = false; S.sel.clear(); } else cancelMove();
  render();
}
export function doSwap() {
  if (!S.sel.size) return fail('حدد قطعة واحدة على الأقل للتبديل.');
  if (app.net) return app.net.swap([...S.sel].map(t => t.id));
  if (S.bag.length < MIN_BAG_SWAP) return fail(`لا يمكن التبديل: في الكيس ${S.bag.length} قطع فقط (الحد الأدنى ${MIN_BAG_SWAP}).`);
  const rack = cur().rack, idx = rack.map((t, i) => t && S.sel.has(t) ? i : -1).filter(i => i >= 0);
  const drawn = S.bag.splice(0, idx.length), old = idx.map(i => rack[i]);
  idx.forEach((i, k) => { rack[i] = drawn[k]; });
  S.bag.push(...old); shuffle(S.bag);
  S.swap = false; S.sel.clear(); S.undo = null; pushHist({p: S.cur, type: 'swap', cnt: idx.length});   // swapping is unlimited too
  toast(`تم تبديل ${idx.length} قطع`, false); nextTurn();
}
export function endGame(reason) {
  if (S.ended) return;
  S.ended = true;
  if (S.pending) { S.pending = null; $('#bd').close(); }
  if (app.judge) { app.judge = null; $('#jd').close(); }
  cancelMove(); S.swap = false; S.sel.clear(); S.pick = null;
  const lines = S.players.map((p, i) => {
    const ded = p.rack.reduce((s, t) => s + (t ? t.v : 0), 0), bon = Math.floor(p.ms / 60000);
    p.score = Math.max(0, p.score - ded + bon);
    return `${playerName(i)}: ${p.score} نقطة (خصم ${ded} · مكافأة وقت +${bon})`;
  });
  const [a, b] = [S.players[0].score, S.players[1].score];
  const win = a === b ? 'تعادل!' : `الفائز: ${playerName(a > b ? 0 : 1)}`;
  render();
  ask('انتهت اللعبة', `${REASONS[reason]}\n\n${lines.join('\n')}\n\n${win}`, 'لعبة جديدة', chooseMode);
}
