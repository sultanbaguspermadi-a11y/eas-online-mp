import { showFloat, gameInert } from './float.js';
// DOM rendering, toasts and dialogs. Reads state; never mutates game rules.
import { SIZE, DURATIONS, BINGO, TOAST_MS, LAYOUT, GLYPH, FACE, LABEL, NAMES } from './config.js';
import { TILE_MODES } from './modes.js';
import { $, S, app, fmt, inMove, cur, profile, playerName, bagCount } from './state.js';
import { syncDimRows } from './dims.js';

let cells = [], toastTimer = 0, dlgCb = null, dlgCancel = null;
const hs = {id: -1, v: -1};   // last rendered history (game id / version)

// ---------- Static DOM construction ----------
export function buildDom() {
  const board = $('#board');
  for (let i = 0; i < SIZE * SIZE; i++) {
    const d = document.createElement('div'); d.dataset.r = i / SIZE | 0; d.dataset.c = i % SIZE; d.tabIndex = 0; d.setAttribute('role', 'gridcell'); cells.push(d); board.append(d);
  }
  $('#players').innerHTML = [0, 1].map(i => `<div class="panel" id="pn${i}"><div class="phead"><span class="pname">${NAMES[i]}</span><span class="ptime" id="t${i}">25:00</span><span class="pscore" id="sc${i}">0</span></div><div class="rack" id="rk${i}" aria-label="رفّ ${NAMES[i]}"></div></div>`).join('');
  $('#mf').innerHTML = Object.values(TILE_MODES).map(m => `<button class="btn modeBtn" value="${m.id}"><span class="mAr">${m.labelAr}</span><span class="mEn">${m.labelEn}</span><span class="mDesc">${m.descAr}</span></button>`).join('');
}
// The blank picker only offers the letters of the active tile mode (rebuilt for every new game).
export function buildBlankPicker() {
  $('#bf').innerHTML = [...profile().alpha].map(l => `<button class="btn" value="${l}">${FACE[l] || l}</button>`).join('');
}

// ---------- Feedback & dialogs ----------
export function toast(msg, ok) {
  const el = $('#toast'); el.textContent = msg; el.className = ok === false ? 'ok' : 'bad';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.textContent = ''; el.className = ''; }, TOAST_MS);
}
export function fail(msg) {
  toast(msg, true);
  const b = $('#board'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
}
export function ask(title, msg, okLabel, fn, onCancel = null, okCls = 'btn danger') {
  $('#dT').textContent = title; $('#dM').textContent = msg;
  const f = $('#dF'); f.innerHTML = '';
  for (const [label, val, cls] of [[okLabel, 'ok', okCls], [onCancel ? 'رجوع' : 'إغلاق', '', 'btn']]) {
    const b = document.createElement('button'); b.className = cls; b.value = val; b.textContent = label; f.append(b);
  }
  S.paused = true; dlgCb = fn; dlgCancel = onCancel; $('#dlg').returnValue = ''; $('#dlg').showModal();
}
// Called by the dialog 'close' listener: returns and clears the pending callbacks.
export function takeDialogCallbacks() { const r = {ok: dlgCb, cancel: dlgCancel}; dlgCb = dlgCancel = null; return r; }

// Setup flow: chooseMode -> chooseDuration -> confirmation (input.js) -> newGame. The mode is only applied at the end.
export function chooseMode() {
  if (S.board) S.paused = true;
  $('#mCancel').hidden = app.firstRun;   // the very first prompt cannot be skipped
  $('#md').returnValue = ''; $('#md').showModal();
}
export function chooseDuration() {
  if (S.board) S.paused = true;
  $('#sf').innerHTML = DURATIONS.map(m => `<button class="btn" value="${m}">${m} دقيقة</button>`).join('');
  $('#sd').returnValue = ''; $('#sd').showModal();
}
export function openBlankPicker() { $('#bd').returnValue = ''; $('#bd').showModal(); }
export function openSettings() { S.paused = true; syncDimRows(); gameInert(true); $('#ad').show(); showFloat('settings'); $('#aT').focus(); }

// ---------- Rendering (DOM is only touched when a cell/rack/list actually changed) ----------
const sqHTML = k => {
  if (!LABEL[k]) return '';
  const [m, w] = LABEL[k].split(' ');
  return k === 5 ? '<span class="pl"><span>نجمة</span></span>' : `<span class="pl"><span class="m">${m}</span><span>${w}</span></span>`;
};
function tileHTML(t) {
  if (t.hidden) return '<div class="tile back" aria-hidden="true"></div>';   // the opponent's tiles online: only their number is known
  const L = t.blank ? (t.as || '') : t.l, v = t.blank ? 0 : t.v;
  const mine = cur().rack.includes(t), mv = inMove(t);
  const ok = !S.ended && (!app.net || app.net.canPlay()) && (S.swap ? mine : (mine || mv));
  const cls = ['tile', t.blank && 'blank', mv && 'cur', S.pick === t && 'pick', S.sel.has(t) && 'swp', S.land === t && 'land', !ok && 'dim'].filter(Boolean).join(' ');
  return `<div class="${cls}" data-id="${t.id}" draggable="${ok && !S.swap}" tabindex="0" role="button"${ok ? '' : ' aria-disabled="true"'} aria-label="${L || 'قطعة فارغة'} قيمة ${v}"><b${GLYPH[L] ? ` style="transform:translate(${GLYPH[L][0]}em,${GLYPH[L][1]}em)"` : ''}>${FACE[L] || L}</b><i>${v}</i></div>`;
}
function renderBoard() {
  cells.forEach((el, i) => {
    const r = i / SIZE | 0, c = i % SIZE, t = S.board[r][c], k = LAYOUT[r][c];
    const h = t ? tileHTML(t) : sqHTML(k);
    if (el._h === h) return;
    el._h = h; el.className = 'sq k' + k + (t ? ' has' : ''); el.innerHTML = h;
    el.setAttribute('aria-label', t ? (t.blank ? t.as : t.l) : (LABEL[k] ? (k === 5 ? 'مربع نجمة' : 'مربع ' + LABEL[k]) : 'مربع فارغ'));
  });
}
function renderPlayers() {
  S.players.forEach((p, i) => {
    const on = i === S.cur && !S.ended;
    if (app.net) app.net.paintName(i, $('#pn' + i).querySelector('.pname'));
    $('#pn' + i).className = 'panel' + (on ? ' on' : ''); $('#pn' + i).setAttribute('aria-current', on);
    const sc = $('#sc' + i); sc.textContent = p.score;
    if (S.pop === i) { sc.classList.remove('pop'); void sc.offsetWidth; sc.classList.add('pop'); }
    const rk = $('#rk' + i), h = p.rack.map((t, k) => `<div class="slot" data-p="${i}" data-i="${k}">${t ? tileHTML(t) : ''}</div>`).join('');
    if (rk._h !== h) { rk._h = h; rk.innerHTML = h; }
  });
  S.pop = null;
}
function renderControls() {
  const mv = S.move.length > 0, E = S.ended;
  $('#bSubmit .lbl').textContent = S.swap ? `تأكيد التبديل (${S.sel.size})` : 'احتساب';
  $('#bSubmit').disabled = E || (S.swap ? !S.sel.size : !mv);
  $('#bCancel .lbl').textContent = S.swap ? 'إلغاء التبديل' : 'إلغاء الحركة';
  $('#bCancel').disabled = E || (!S.swap && !mv);
  $('#bSwap').disabled = E || S.swap || mv;
  $('#bPass').disabled = E || S.swap || mv;
  $('#bUndo').disabled = E || S.swap || mv || !S.undo || !!app.net;
  $('#bJudge').disabled = E || S.swap || mv || !S.undo;
  if (app.net) app.net.paintControls();
  $('#bagInfo').textContent = `${profile().labelAr} · الكيس: ${bagCount()}`;
}
export function tickUI() {
  S.players.forEach((p, i) => {
    const el = $('#t' + i), tx = fmt(p.ms);
    if (el.textContent !== tx) el.textContent = tx;
    const cn = 'ptime' + (p.ms < 60000 ? ' low' : '') + (p.ms < 10000 ? ' crit' : '') + (p.ms === 0 ? ' out' : '') + (!S.started && !S.ended ? ' wait' : '');
    if (el.className !== cn) el.className = cn;
  });
}
// Word chips shared by the history list and the judge dialog.
export const chips = e => `<div class="jw">${e.words.map(w => `<span class="chip">${w.w}${w.unv ? ' ؟' : ''} <b>${w.pts}</b></span>`).join('')}${e.bingo ? '<span class="chip bingo">+' + BINGO + '</span>' : ''}</div>`;
function histItem(e) {
  const cls = 'hi p' + e.p + (e.st === 'void' ? ' void' : ''), who = playerName(e.p);
  if (e.type !== 'move')
    return `<li class="${cls}"><div class="hh"><span class="hn">${e.n}</span><span>${who} — ${e.type === 'pass' ? 'مرّر الدور' : `بدّل ${e.cnt} قطع`}</span></div></li>`;
  const j = e.st ? `<div class="hj ${e.st}">${e.st === 'ok' ? '✔ صحيح' : '✖ خطأ'}${e.pen ? ` · غرامة التحدي −${e.pen}` : ''}</div>` : '';
  return `<li class="${cls}"><div class="hh"><span class="hn">${e.n}</span><span>${who}</span><b class="hp">${e.st === 'void' ? 0 : '+' + e.total}</b></div>${chips(e)}${j}</li>`;
}
function renderHist() {
  if (hs.id === app.gameId && hs.v === S.hv) return;
  hs.id = app.gameId; hs.v = S.hv;
  const best = S.hist.filter(e => e.type === 'move' && e.st !== 'void')
    .flatMap(e => e.words.map(w => ({...w, p: e.p}))).reduce((b, w) => !b || w.pts > b.pts ? w : b, null);
  $('#hList').innerHTML = S.hist.length ? S.hist.map(histItem).reverse().join('') : '<li class="hempty">لم تُسجَّل أي حركة بعد.</li>';
  $('#hBest').textContent = best ? `أعلى كلمة: ${best.w} (${best.pts} نقطة — ${playerName(best.p)})` : '';
}
export function render() {
  if (S.pick && !(cur().rack.includes(S.pick) || inMove(S.pick))) S.pick = null;
  renderBoard(); renderPlayers(); renderControls(); renderHist(); tickUI(); S.land = null;
}
