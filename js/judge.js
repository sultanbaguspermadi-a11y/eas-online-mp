// Tahkim (judging): the challenger (player now on turn) rules the last move صحيح (valid) or خطأ (wrong).
import { PENALTY, NAMES } from './config.js';
import { $, S, app, cur, restore, playerName } from './state.js';
import { toast, render, chips } from './ui.js';
import { tick, nextTurn } from './game.js';

export function openJudge() {
  if (app.net) return app.net.openTahkim();
  const e = S.hist[S.hist.length - 1];
  if (S.ended || S.swap || S.move.length || !S.undo || !e || e.type !== 'move' || e.st) return;
  app.judge = {e};
  S.paused = true; renderJudge(); $('#jd').showModal();
}
// Dialog closed without applying a verdict (Esc / cancel): drop the session and resume the clock.
export function abortJudge() {
  if (app.net) return app.net.onJudgeClosed();
  if (app.judge) { app.judge = null; S.paused = false; S.last = performance.now(); }
}
function renderJudge() {
  const e = app.judge.e;
  $('#jT').textContent = 'تحكيم الحركة';
  $('#jB').innerHTML = `<p>${playerName(e.p)} · الحركة ${e.n} · ${e.total} نقطة</p>${chips(e)}<p>ما حكم الكلمة؟</p>`
    + '<div class="vrow"><button class="btn yes" data-a="yes">✔ صحيح</button><button class="btn danger" data-a="no">✖ خطأ</button></div>'
    + '<button class="btn" data-a="close">إلغاء</button>';
}
export function onJudgeClick(ev) {
  if (app.net) return app.net.onJudgeClick(ev);
  if (!app.judge) return;
  const a = ev.target.closest('[data-a]')?.dataset.a;
  if (a === 'close') return $('#jd').close();
  if (a === 'yes' || a === 'no') applyVerdict(a === 'yes');
}
function applyVerdict(ok) {
  const e = app.judge.e, u = S.undo;
  e.st = ok ? 'ok' : 'void';
  app.judge = null; $('#jd').close(); S.paused = false; S.last = performance.now(); S.hv++;
  if (ok) {
    const ch = cur(); e.pen = Math.min(PENALTY, ch.score); ch.score -= e.pen; S.undo = null; S.pop = S.cur;
    toast(`✔ صحيح — غرامة ${e.pen} على ${playerName(S.cur)}`, false); return render();
  }
  tick(); if (S.ended) return;
  restore(u, true);
  toast(`✖ خطأ — يفقد ${playerName(e.p)} دوره`, false); nextTurn();
}
