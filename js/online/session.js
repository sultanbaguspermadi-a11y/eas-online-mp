// Online session: the ONLINE ADAPTER of the game engine. The local game mutates S itself; online, S is only a rendering of the server's
// snapshot, and every action is a request to the server (supabase/functions/eas-game). Nothing here decides a rule, a score, a draw or a clock.
//
//   DATABASE = truth, REALTIME = notification:  an event only says "revision N exists"; when N is newer than ours we fetch a snapshot.
//   Network state machine:  CONNECTING -> CONNECTED <-> RECONNECTING / OFFLINE, SYNCING while a snapshot is being fetched.
import { RACK } from '../config.js';
import { $, S, BY, app, playerName } from '../state.js';
import { toast, fail, ask, render, tickUI, chips, buildBlankPicker } from '../ui.js';
import { REASONS } from '../config.js';
import { createBackend, isConfigured } from './supabase-backend.js';
import { lobby } from './lobby.js';
import { hideCover } from '../cover.js';

const RESUME = 'scrabble.online.resume';
const POLL_MS = 12000;
const ERR_AR = { network: 'تعذّر الاتصال بالخادم. تحقق من الإنترنت.' };
const id6 = () => crypto.randomUUID();

export const net = {
  backend: null, userId: null, snap: null, seat: 0, state: 'CONNECTING', opp: false, busy: false, key: '', clock: null,
  sub: null, lastEvent: 0, fetching: false, again: false, shownResult: '', lastMoves: 0, closingJudge: false, lastClaim: 0, timers: []
};
export const configured = isConfigured;

// ---------- start / resume ----------
export async function connect() {
  net.state = 'CONNECTING';
  net.backend ||= await createBackend();
  net.userId = await net.backend.init();
  net.state = 'CONNECTED';
  return net;
}
export async function resumeOpenGame({ includeFinished = false } = {}) {
  const r = await call({ action: 'reconnect' }, { quiet: true });
  if (r?.ok && r.snapshot && (includeFinished || r.snapshot.game.status !== 'finished')) { await enter(r.snapshot); return true; }
  try { localStorage.removeItem(RESUME); } catch { /* storage unavailable */ }
  return false;
}

// Raw request with retries on NETWORK failures only (the same client_action_id is reused, so a retry can never act twice).
async function call(body, { quiet = false, retries = 3 } = {}) {
  for (let i = 0; ; i++) {
    try { const r = await net.backend.call(body); if (net.state === 'OFFLINE' || net.state === 'RECONNECTING') setState('CONNECTED'); return r; }
    catch (e) {
      if (i >= retries) { setState('OFFLINE'); if (!quiet) toast(ERR_AR.network, true); return null; }
      setState('RECONNECTING'); await new Promise(r => setTimeout(r, 500 * 2 ** i));
    }
  }
}

// ---------- entering a game (lobby or match) ----------
export async function enter(snap) {
  app.net = net; net.snap = null; net.key = '';
  try { localStorage.setItem(RESUME, '1'); } catch { /* storage unavailable */ }
  net.seat = snap.me.seat;
  subscribe(snap.game.id);
  apply(snap);
  clearInterval(net.poll); net.poll = setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  addEventListener('online', () => sync()); addEventListener('offline', () => setState('OFFLINE'));
  $('#netLeave').onclick = () => net.leave();
}

function subscribe(gameId) {
  net.sub?.close?.();
  Promise.resolve(net.backend.subscribe(gameId, {
    onEvent: p => { net.lastEvent = Date.now(); if (!net.snap || p.revision > net.snap.game.revision) sync(); },
    onPresence: ids => { net.opp = ids.some(u => u !== net.userId); paintStatus(); },
    onStatus: s => {
      if (s === 'SUBSCRIBED') { setState('SYNCING'); net.backend.track?.({ seat: net.seat }); sync(); }
      else { setState('RECONNECTING'); net.opp = false; clearTimeout(net.resub); net.resub = setTimeout(() => subscribe(gameId), 2000); }
    }
  })).then(sub => { net.sub = sub; });
  net.backend.track?.({ seat: net.seat });
}

// ---------- synchronisation ----------
export async function sync() {
  if (!net.snap || net.fetching) { net.again = net.fetching; return; }
  net.fetching = true; if (net.state !== 'OFFLINE') setState('SYNCING');
  try {
    const r = await call({ action: 'snapshot', game_id: net.snap.game.id }, { quiet: true, retries: 1 });
    if (r?.ok) { apply(r.snapshot); setState('CONNECTED'); }
    else if (r && r.code === 'NOT_MEMBER') { toast('انتهت جلستك في هذه المباراة.', true); net.leave(true); }
  } finally { net.fetching = false; if (net.again) { net.again = false; sync(); } }
}
const poll = () => { if (!document.hidden && Date.now() - net.lastEvent > POLL_MS - 500) sync(); };   // safety net for a missed event

function setState(s) { if (net.state !== s) { net.state = s; paintStatus(); } }

// ---------- snapshot -> game state ----------
export function apply(snap) {
  const old = net.snap;
  if (old && snap.game.id === old.game.id && snap.game.revision < old.game.revision) return;   // an older snapshot never replaces a newer one
  net.snap = snap; net.seat = snap.me.seat;
  const g = snap.game;
  app.names = [0, 1].map(i => snap.players.find(p => p.seat === i)?.nickname || (i ? 'اللاعب الثاني' : 'اللاعب الأول'));
  if (g.status === 'lobby' || g.status === 'starting') { lobby.show(snap); return; }
  if (g.status === 'abandoned') { lobby.close(); toast('أُغلقت الغرفة.', true); return net.leave(true); }
  lobby.close();
  hideCover();
  hydrate(snap, old);
  net.backend.track?.({ seat: net.seat });
}

const reg = o => { const t = BY[o.id]; if (t) { Object.assign(t, { l: o.l, v: o.v, blank: o.blank, as: o.as }); return t; } return (BY[o.id] = { id: o.id, l: o.l, v: o.v, blank: o.blank, as: o.as }); };

function hydrate(snap, old) {
  const g = snap.game, me = snap.me.seat, key = g.id + ':' + g.round, fresh = net.key !== key;
  const keep = !fresh && S.move ? S.move.map(e => ({ id: e.t.id, r: e.r, c: e.c, as: e.t.as })) : [];
  if (fresh) {
    net.key = key; app.gameId++; app.mode = g.tile_mode; net.shownResult = ''; net.lastMoves = snap.moves.length;
    for (const k in BY) delete BY[k];
    for (const k of Object.keys(S)) delete S[k];
    Object.assign(S, { swap: false, sel: new Set(), pick: null, drag: null, pending: null, hist: [], hv: 0, paused: false, last: performance.now(), land: null, pop: null, move: [] });
    buildBlankPicker();
    const t = $('#toast'); t.textContent = ''; t.className = '';   // drop the local game's "new game" message
  }
  S.board = snap.board.map(row => row.map(c => c && reg(c)));
  S.players = [0, 1].map(i => {
    const p = snap.players.find(x => x.seat === i) || { score: 0, tile_count: 0, ms_left: g.minutes * 60000 };
    const rack = i === me ? snap.me.rack.map(t => t && reg({ ...t, as: null })) : Array.from({ length: RACK }, (_, k) => k < p.tile_count ? { id: `h${i}-${k}`, hidden: true } : null);
    return { rack, score: p.score, ms: p.ms_left };
  });
  S.cur = g.current_seat ?? 0; S.ended = g.status === 'finished' || g.status === 'abandoned'; S.started = !!g.clock_started;
  S.undo = g.tahkim_available ? true : null; S.bagCount = g.bag_count; S.bag = [];
  S.hist = snap.moves; S.hv++;
  S.move = []; S.sel.clear(); if (S.cur !== me || g.status !== 'active') { S.swap = false; S.pick = null; }
  // keep an unsent preview if it is still valid against the new state (e.g. after a resync that did not change my turn)
  if (S.cur === me && g.status === 'active') for (const k of keep) {
    const t = BY[k.id], slot = t ? S.players[me].rack.indexOf(t) : -1;
    if (slot >= 0 && !S.board[k.r][k.c]) { S.players[me].rack[slot] = null; if (t.blank) t.as = k.as; S.move.push({ t, r: k.r, c: k.c, slot }); S.board[k.r][k.c] = t; }
  }
  net.clock = { offset: snap.server_now - Date.now(), startedAt: g.turn_started_at, running: g.clock_running, base: snap.players.map(p => p.ms_left) };
  if (old && !fresh && snap.moves.length > net.lastMoves) { const m = snap.moves[snap.moves.length - 1]; if (m.p !== me) announce(m); S.pop = m.p; }
  net.lastMoves = snap.moves.length;
  render(); tickUI(); paintStatus();
  tahkimUI(snap); if (S.ended) showResult(snap);
}

const announce = m => toast(m.type === 'move' ? `${playerName(m.p)}: +${m.total} نقطة` : m.type === 'pass' ? `${playerName(m.p)} مرّر الدور` : `${playerName(m.p)} بدّل ${m.cnt} قطع`, false);

// ---------- clock (display only; the server decides) ----------
net.tick = function () {
  if (!net.clock || !net.snap) return;
  const c = net.clock, now = Date.now() + c.offset;
  S.players.forEach((p, i) => { p.ms = (c.running && S.cur === i && c.startedAt) ? Math.max(0, c.base[i] - (now - c.startedAt)) : c.base[i]; });
  tickUI();
  if (c.running && S.players[S.cur].ms === 0 && Date.now() - net.lastClaim > 2000) { net.lastClaim = Date.now(); act('claim_timeout', {}, { quiet: true }); }
};

// ---------- actions ----------
net.canPlay = () => !!net.snap && !net.busy && net.snap.game.status === 'active' && S.cur === net.seat && !S.ended;
net.guard = () => {
  if (net.snap?.game.status === 'tahkim_pending') { fail('التحكيم قيد الانتظار.'); return false; }
  if (S.ended) return false;
  if (S.cur !== net.seat) { fail('ليس دورك الآن.'); return false; }
  if (net.busy) return false;
  return true;
};

async function act(action, extra = {}, { quiet = false } = {}) {
  if (net.busy && action !== 'claim_timeout') return null;
  const snap = net.snap; if (!snap) return null;
  net.busy = true; render();
  try {
    const r = await call({ action, game_id: snap.game.id, client_action_id: id6(), base_revision: snap.game.revision, ...extra }, { quiet });
    if (!r) return null;
    if (r.snapshot) apply(r.snapshot);
    if (!r.ok) { if (!quiet && r.code !== 'NOT_EXPIRED') fail(r.message || 'تعذّر تنفيذ الإجراء.'); return r; }
    return r;
  } finally { net.busy = false; render(); }
}

net.submit = async function () {
  const placements = S.move.map(e => ({ tileId: e.t.id, row: e.r, col: e.c, ...(e.t.blank ? { as: e.t.as } : {}) }));
  const r = await act('submit_move', { placements });
  if (r?.ok && r.result) toast(`${playerName(net.seat)}: +${r.result.score} نقطة${r.result.note ? ' · ' + r.result.note : ''}`, false);
};
net.pass = async () => { const r = await act('pass_turn'); if (r?.ok) toast(`${playerName(net.seat)} مرّر الدور`, false); };
net.swap = async ids => { const r = await act('swap_tiles', { tileIds: ids }); if (r?.ok) toast(`تم تبديل ${ids.length} قطع`, false); };

// ---------- Tahkim ----------
net.openTahkim = async function () {
  const g = net.snap?.game;
  if (!g) return;
  if (g.status === 'tahkim_pending') return tahkimUI(net.snap, true);
  const last = S.hist[S.hist.length - 1];
  if (!net.canPlay() || S.move.length || S.swap || !S.undo || !last || last.type !== 'move' || last.st) return;
  await act('request_tahkim');
};
function tahkimUI(snap, force = false) {
  const g = snap.game, jd = $('#jd');
  if (g.status === 'tahkim_pending' && g.tahkim.resolver_seat === snap.me.seat) {
    if (!jd.open || force) {
      const e = S.hist.find(x => x.n === g.tahkim.move_number) || S.hist[S.hist.length - 1];
      app.judge = { e, online: true };
      $('#jT').textContent = 'تحكيم الحركة';
      $('#jB').innerHTML = `<p>${playerName(e.p)} · الحركة ${e.n} · ${e.total} نقطة</p>${chips(e)}<p>ما حكم الكلمة؟</p><div class="vrow"><button class="btn yes" data-a="yes">✔ صحيح</button><button class="btn danger" data-a="no">✖ خطأ</button></div><button class="btn" data-a="close">إلغاء</button>`;
      if (!jd.open) jd.showModal();
    }
  } else if (jd.open && app.judge?.online) { net.closingJudge = true; jd.close(); net.closingJudge = false; app.judge = null; }
}
net.onJudgeClick = function (ev) {
  if (!app.judge?.online) return;
  const a = ev.target.closest('[data-a]')?.dataset.a;
  if (a === 'yes' || a === 'no') { net.closingJudge = true; $('#jd').close(); net.closingJudge = false; app.judge = null; act('resolve_tahkim', { verdict: a === 'yes' ? 'valid' : 'invalid' }); }
  else if (a === 'close') $('#jd').close();   // closing = withdrawing the challenge (see onJudgeClosed)
};
net.onJudgeClosed = function () {
  if (net.closingJudge || !app.judge?.online) return;
  app.judge = null;
  if (net.snap?.game.status === 'tahkim_pending' && net.snap.game.tahkim.challenger_seat === net.seat) act('cancel_tahkim');
};

// ---------- end of game / rematch / leaving ----------
function showResult(snap) {
  const g = snap.game, key = net.key + ':' + g.revision;
  if (net.shownResult === net.key || !g.result) return;
  net.shownResult = net.key;
  try { localStorage.removeItem(RESUME); } catch { /* storage unavailable */ }
  const r = g.result, lines = r.lines.map(l => `${playerName(l.seat)}: ${l.score} نقطة${r.reason === 'resign' ? '' : ` (خصم ${l.ded} · مكافأة وقت +${l.bon})`}`);
  const win = r.winner_seat == null ? 'تعادل!' : `الفائز: ${playerName(r.winner_seat)}`;
  ask('انتهت اللعبة', `${REASONS[r.reason] || ''}\n\n${lines.join('\n')}\n\n${win}`, 'إعادة المباراة', () => act('rematch'), null, 'btn yes');
}
net.newButton = function () {
  if (!net.snap) return;
  if (S.ended) return ask('انتهت اللعبة', 'هل تريد مباراة جديدة بنفس الخصم؟', 'إعادة المباراة', () => act('rematch'), null, 'btn yes');
  ask('استسلام', 'سيُحسب الفوز لخصمك.', 'استسلام', () => act('resign_game'));
};
net.leave = async function (silent = false) {
  const g = net.snap?.game;
  const go = () => { try { localStorage.removeItem(RESUME); } catch { /* storage unavailable */ } location.href = location.pathname; };
  if (silent || !g) return go();
  const doLeave = async () => { if (g.status === 'lobby') await call({ action: 'leave_room', game_id: g.id, client_action_id: id6() }, { quiet: true, retries: 1 }); else if (g.status === 'active' || g.status === 'tahkim_pending') await call({ action: 'resign_game', game_id: g.id, client_action_id: id6() }, { quiet: true, retries: 1 }); go(); };
  if (g.status === 'active' || g.status === 'tahkim_pending') return ask('مغادرة المباراة', 'مغادرة المباراة تعني الاستسلام.', 'غادر', doLeave);
  return doLeave();
};
net.rematch = () => act('rematch');
net.lobbyAction = (action, extra = {}) => act(action, extra);
net.call = call;

// ---------- status / names / controls ----------
const NET_AR = { CONNECTING: 'جارٍ الاتصال…', CONNECTED: 'متصل', RECONNECTING: 'جارٍ إعادة الاتصال…', OFFLINE: 'لا يوجد اتصال', SYNCING: 'جارٍ المزامنة…' };
function paintStatus() {
  const bar = $('#netBar'), st = $('#netState'); if (!bar) return;
  bar.hidden = false;
  const g = net.snap?.game, opp = 1 - net.seat;
  let t = net.state === 'CONNECTED' ? '' : NET_AR[net.state];
  if (!t && g && g.status === 'tahkim_pending') t = g.tahkim.resolver_seat === net.seat ? 'التحكيم: بانتظار حكمك' : `بانتظار حكم ${playerName(g.tahkim.resolver_seat)}…`;
  if (!t && g && (g.status === 'active') && !net.opp) t = `${playerName(opp)} غير متصل — بانتظار عودته…`;
  if (!t && g && g.status === 'finished' && (g.rematch_seats || []).includes(opp)) t = `${playerName(opp)} يطلب إعادة المباراة`;
  st.textContent = t || `● متصل · الغرفة ${g?.room_code || ''}`;
  bar.classList.toggle('warn', net.state !== 'CONNECTED' || (!!g && g.status === 'active' && !net.opp));
  for (const i of [0, 1]) { const el = document.querySelector(`#pn${i} .pstat`); if (el) paintStat(i, el); }
}
function paintStat(i, el) {
  const on = i === net.seat ? net.state !== 'OFFLINE' && net.state !== 'RECONNECTING' : net.opp;
  el.textContent = on ? '● متصل' : '○ غير متصل'; el.className = 'pstat ' + (on ? 'on' : 'off');
}
net.paintName = function (i, el) {
  if (!el) return;
  if (!el.firstChild || el.dataset.net !== '1') { el.dataset.net = '1'; el.textContent = ''; el.append(document.createTextNode(''), Object.assign(document.createElement('small'), { className: 'pstat' })); }
  const txt = playerName(i) + (i === net.seat ? ' (أنت)' : ''); if (el.firstChild.textContent !== txt) el.firstChild.textContent = txt;
  paintStat(i, el.querySelector('.pstat'));
};
net.paintControls = function () {
  const E = S.ended, mine = net.canPlay(), g = net.snap?.game;
  const dis = (id, v) => { const b = $(id); b.disabled = b.disabled || v; };
  dis('#bSubmit', !mine); dis('#bCancel', !mine); dis('#bSwap', !mine); dis('#bPass', !mine);
  $('#bJudge').disabled = $('#bJudge').disabled || !mine && !(g?.status === 'tahkim_pending' && g.tahkim.resolver_seat === net.seat);
  $('#bNew .lbl').textContent = E ? 'إعادة المباراة' : 'استسلام';
  $('#bUndo').title = 'لا يوجد تراجع في اللعب عبر الإنترنت — استخدم التحكيم';
};
