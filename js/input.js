// All user input: click/tap selection, keyboard, native drag & drop, buttons and dialog listeners.
// (Touch devices use the tap-to-select flow through the delegated click handler.)
import { $, S, app, BY, inMove, cur, profile } from './state.js';
import { TILE_MODES } from './modes.js';
import { toast, fail, ask, render, chooseMode, chooseDuration, openSettings, takeDialogCallbacks } from './ui.js';
import { place, unplace, submit, doSwap, pass, undo, startSwap, cancelSwapOrMove, newGame } from './game.js';
import { openJudge, onJudgeClick, abortJudge } from './judge.js';

function onSquare(r, c) {
  if (S.ended || S.swap) return;
  if (app.net && !app.net.guard()) return;
  const t = S.board[r][c];
  if (t) {
    const e = inMove(t);
    if (!e) return fail('هذه القطعة مثبتة ولا يمكن تحريكها.');
    if (S.pick === t) { unplace(e); S.pick = null; } else S.pick = t;
    return render();
  }
  if (S.pick) place(S.pick, r, c); else toast('اختر قطعة من رفّك.', true);
}
function onSlot(p, i) {
  if (S.ended) return;
  if (app.net) { if (p !== app.net.seat) return fail('هذا رفّ الخصم.'); if (!app.net.guard()) return; }
  else if (p !== S.cur) return fail('هذا رفّ الخصم — ليس دورك الآن.');
  const t = cur().rack[i];
  if (S.swap) {
    if (!t) return;
    if (S.sel.has(t)) S.sel.delete(t); else S.sel.add(t);
    return render();
  }
  if (t) {
    S.pick = S.pick === t ? null : t;
  }
  else if (S.pick && inMove(S.pick)) { unplace(inMove(S.pick)); S.pick = null; }
  render();
}

let activeDropTarget = null;

function clearDropTargets() {
  if (activeDropTarget) {
    activeDropTarget.classList.remove('drop');
    activeDropTarget = null;
  }
}

function markDropTarget(el, valid) {
  if (!el) return;
  if (activeDropTarget && activeDropTarget !== el) activeDropTarget.classList.remove('drop');
  if (valid) {
    el.classList.add('drop');
    activeDropTarget = el;
  } else if (activeDropTarget === el) {
    el.classList.remove('drop');
    activeDropTarget = null;
  }
}

function canDropOnSquare(sq, t) {
  if (!sq || !t || S.ended || S.swap || !inMove(t) && !cur().rack.includes(t)) return false;
  const r = Number(sq.dataset.r), c = Number(sq.dataset.c);
  return !S.board[r][c];
}

function canDropOnSlot(slot, t) {
  if (!slot || !t || S.ended || S.swap || !inMove(t)) return false;
  return Number(slot.dataset.p) === S.cur;
}

function bindBoardInput() {
  document.addEventListener('click', e => {
    const sq = e.target.closest('.sq'), sl = e.target.closest('.slot');
    if (sq) onSquare(+sq.dataset.r, +sq.dataset.c); else if (sl) onSlot(+sl.dataset.p, +sl.dataset.i);
  });

  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.sq,.tile')) {
      e.preventDefault();
      (e.target.closest('.slot') || e.target.closest('.sq') || e.target).click();
    }
    if (e.key === 'Escape' && S.pick) {
      S.pick = null;
      render();
    }
  });

  // Native HTML5 drag-and-drop for desktop/fine-pointer devices.
  // Tap/click selection remains the fallback for touch devices.
  document.addEventListener('dragstart', e => {
    const el = e.target.closest?.('.tile');
    const t = el && BY[el.dataset.id];

    if (!t || el.classList.contains('dim') || S.ended || S.swap || !e.dataTransfer || (app.net && !app.net.canPlay())) {
      e.preventDefault();
      return;
    }

    S.drag = t;
    S.pick = null;
    clearDropTargets();

    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(t.id));
    } catch {
      // Some embedded browsers expose a restricted DataTransfer implementation.
      // The in-memory S.drag reference is still sufficient for the drop handler.
    }
  });

  document.addEventListener('dragover', e => {
    if (!S.drag) return;

    const sq = e.target.closest?.('.sq');
    const sl = e.target.closest?.('.slot');
    const validSq = canDropOnSquare(sq, S.drag);
    const validSlot = canDropOnSlot(sl, S.drag);
    const valid = validSq || validSlot;

    clearDropTargets();
    if (valid) {
      e.preventDefault();
      markDropTarget(validSq ? sq : sl, true);
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    }
  });

  document.addEventListener('drop', e => {
    if (!S.drag) return;

    const t = S.drag;
    S.drag = null;
    clearDropTargets();

    const sq = e.target.closest?.('.sq');
    const sl = e.target.closest?.('.slot');

    if (canDropOnSquare(sq, t)) {
      e.preventDefault();
      place(t, Number(sq.dataset.r), Number(sq.dataset.c));
      return;
    }

    if (canDropOnSlot(sl, t)) {
      e.preventDefault();
      unplace(inMove(t));
      render();
      return;
    }

    e.preventDefault();
    render();
  });

  document.addEventListener('dragend', () => {
    S.drag = null;
    clearDropTargets();
    render();
  });
}

function bindControls() {
  $('#bSubmit').onclick = () => S.swap ? doSwap() : submit();
  $('#bCancel').onclick = cancelSwapOrMove;
  $('#bSwap').onclick = startSwap;
  $('#bPass').onclick = pass;
  $('#bJudge').onclick = openJudge;
  $('#bUndo').onclick = () => { if (S.undo && !S.ended && !S.move.length && !S.swap) ask('تراجع', 'سيُستعاد اللوح والنقاط إلى ما قبل آخر حركة.', 'تراجع', undo); };
  // New game always goes back through mode selection, so the previous mode is never kept silently.
  $('#bNew').onclick = () => {
    if (app.net) return app.net.newButton();
    S.ended ? chooseMode() : ask('لعبة جديدة', 'سيُفقد التقدّم الحالي.', 'ابدأ', chooseMode);
  };
  $('#bSettings').onclick = openSettings;
}

function bindDialogs() {
  $('#jB').addEventListener('click', onJudgeClick);
  $('#jd').addEventListener('close', abortJudge);
  $('#dlg').addEventListener('close', () => {
    S.paused = false; S.last = performance.now();
    const {ok, cancel} = takeDialogCallbacks();
    if ($('#dlg').returnValue === 'ok') { if (ok) ok(); } else if (cancel) cancel();
  });
  $('#bd').addEventListener('close', () => {
    if (!$('#dlg').open && !$('#sd').open && !$('#md').open) resume();
    const e = S.pending; if (!e) return;
    S.pending = null;
    if (!S.move.includes(e)) return;
    const L = $('#bd').returnValue;
    if (L && [...profile().alpha].includes(L)) e.t.as = L; else unplace(e);   // a blank can only become a letter of the active mode
    render();
  });
  // The very first setup prompts cannot be dismissed with Esc.
  for (const id of ['#md', '#sd']) $(id).addEventListener('cancel', e => { if (app.firstRun) e.preventDefault(); });
  // Setup flow: mode -> duration -> confirmation. The mode is applied only when the game starts (newGame),
  // so cancelling anywhere keeps the running game, and its mode, untouched.
  $('#md').addEventListener('close', () => {
    const id = $('#md').returnValue;
    if (TILE_MODES[id]) { app.pendingMode = id; chooseDuration(); }
    else { app.pendingMode = null; resume(); }
  });
  $('#sd').addEventListener('close', () => {
    const rv = $('#sd').returnValue;
    if (rv === 'back') return chooseMode();
    const m = +rv;
    if (m) ask(
      'بدء اللعبة',
      `${TILE_MODES[app.pendingMode || app.mode].labelAr} · ${m} دقيقة لكل لاعب`,
      'ابدأ',
      () => { app.firstRun = false; const mode = app.pendingMode || app.mode; app.pendingMode = null; newGame(m, mode); },
      chooseDuration,
      'btn'
    );
    else { app.pendingMode = null; resume(); }
  });
  $('#ad').addEventListener('close', resume);
}
const resume = () => { S.paused = false; S.last = performance.now(); };

let initialized = false;

export function initInput() {
  if (initialized) return;
  initialized = true;
  bindBoardInput();
  bindControls();
  bindDialogs();
}
