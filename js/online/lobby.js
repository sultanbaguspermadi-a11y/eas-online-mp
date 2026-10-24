// Online lobby UI (one <dialog>): nickname -> create / join -> room (code, players, rules, ready, start).
// Presentation only: every rule (who may start, who may change settings, room limits) is enforced by the server.
import { $ } from '../state.js';
import { DURATIONS } from '../config.js';
import { TILE_MODES } from '../modes.js';
import { net, connect, resumeOpenGame, enter, configured } from './session.js';

const NICK = 'scrabble.online.nick';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const POLICY_AR = { auto: 'تلقائي', tahkim: 'تلقائي + تحكيم', off: 'إيقاف' };
let nick = '', err = '', pending = false, current = 'connecting', joinCode = '';
try { nick = localStorage.getItem(NICK) || ''; } catch { /* storage unavailable */ }

const dlg = () => $('#od'), body = () => $('#oB');
const MSG = { ROOM_NOT_FOUND: 'الغرفة غير موجودة. تحقق من الرمز.', ROOM_FULL: 'الغرفة ممتلئة.', GAME_STARTED: 'بدأت المباراة في هذه الغرفة بالفعل.' };

function view(name, snap) {
  current = name;
  const b = body();
  const errHtml = `<p class="oErr" id="oErr" role="alert">${esc(err)}</p>`; err = '';
  if (name === 'connecting') b.innerHTML = '<p>جارٍ الاتصال…</p><form method="dialog"><button class="btn" value="">إلغاء</button></form>';
  else if (name === 'unconfigured') b.innerHTML = '<p>اللعب عبر الإنترنت غير مُهيَّأ على هذا الخادم بعد. اللعب المحلي يعمل كالمعتاد.</p><form method="dialog"><button class="btn" value="">رجوع</button></form>';
  else if (name === 'error') b.innerHTML = `<p>تعذّر الاتصال بخدمة اللعب. تحقق من الإنترنت وحاول مرة أخرى.</p><div class="oRow"><button class="btn main" data-a="retry">إعادة المحاولة</button><button class="btn" data-a="back">رجوع</button></div>`;
  else if (name === 'nick') b.innerHTML = `<label class="oLbl" for="oNick">الاسم المستعار</label><input id="oNick" class="oIn" maxlength="16" autocomplete="nickname" value="${esc(nick)}" placeholder="مثال: سلطان">${errHtml}<div class="oRow"><button class="btn main" data-a="nick">متابعة</button><button class="btn" data-a="back">رجوع</button></div>`;
  else if (name === 'menu') b.innerHTML = `<p class="oWho">${esc(nick)}</p>${errHtml}<div class="oCol"><button class="btn main" data-a="create"${pending ? ' disabled' : ''}>إنشاء غرفة</button><button class="btn" data-a="joinview">الانضمام إلى غرفة</button><button class="btn" data-a="nickview">تغيير الاسم</button><button class="btn" data-a="back">رجوع</button></div>`;
  else if (name === 'join') b.innerHTML = `<label class="oLbl" for="oCode">رمز الغرفة</label><input id="oCode" class="oIn oCode" dir="ltr" maxlength="9" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(joinCode)}" placeholder="K7Q4P2">${errHtml}<div class="oRow"><button class="btn main" data-a="join"${pending ? ' disabled' : ''}>انضمام</button><button class="btn" data-a="menu">رجوع</button></div>`;
  else if (name === 'room') room(snap, errHtml);
  const first = b.querySelector('input'); if (first) first.focus({ preventScroll: true });
}

function room(snap, errHtml) {
  const g = snap.game, me = snap.me.seat, host = me === 0, two = snap.players.length === 2, guestReady = snap.players.find(p => p.seat === 1)?.ready;
  const link = `${location.origin}${location.pathname}?room=${g.room_code}`;
  const seg = (key, opts, val) => `<div class="segRow"><div class="setRowHead">${{ tile_mode: 'نمط الحروف', minutes: 'الوقت لكل لاعب', validator_mode: 'فحص الكلمات' }[key]}</div><div class="seg" role="group">${opts.map(([v, t]) => `<button type="button" class="btn" data-set="${key}" data-v="${v}" aria-pressed="${String(val) === String(v)}"${host ? '' : ' disabled'}>${t}</button>`).join('')}</div></div>`;
  const players = [0, 1].map(i => { const p = snap.players.find(x => x.seat === i); return p ? `<li><span class="pstat on">●</span> ${esc(p.nickname)}${i === 0 ? ' · المضيف' : ''}${i === me ? ' (أنت)' : ''}${p.ready ? ' · جاهز' : ' · غير جاهز'}</li>` : '<li class="oWait">بانتظار لاعب…</li>'; }).join('');
  $('#oT').textContent = 'غرفة اللعب';
  body().innerHTML = `<div class="oRoom"><span class="oLbl">رمز الغرفة</span><button class="oCodeBig" data-a="copy" dir="ltr" aria-label="نسخ الرمز ${g.room_code}">${g.room_code}</button>
<div class="oRow"><button class="btn" data-a="copy">نسخ الرمز</button><button class="btn" data-a="share" data-link="${esc(link)}">نسخ الرابط</button></div></div>
<ul class="oPlayers">${players}</ul>
${seg('tile_mode', Object.values(TILE_MODES).map(m => [m.id, m.labelAr]), g.tile_mode)}${seg('minutes', DURATIONS.map(m => [m, m + ' د']), g.minutes)}${seg('validator_mode', Object.entries(POLICY_AR), g.validator_mode)}
${errHtml}<p class="oHint" id="oHint">${host ? (two ? (guestReady ? 'الجميع جاهز.' : 'بانتظار جاهزية اللاعب الآخر…') : 'بانتظار انضمام لاعب آخر…') : 'بانتظار أن يبدأ المضيف المباراة…'}</p>
<div class="oRow">${host ? `<button class="btn main" data-a="start"${two && guestReady && !net.busy ? '' : ' disabled'}>ابدأ المباراة</button>` : `<button class="btn ${guestReady ? '' : 'main'}" data-a="ready">${guestReady ? 'إلغاء الجاهزية' : 'أنا جاهز'}</button>`}<button class="btn danger" data-a="leave">مغادرة</button></div>`;
}

export const lobby = {
  show(snap) { const d = dlg(); if (!d.open) d.showModal(); $('#oT').textContent = 'غرفة اللعب'; view('room', snap); },
  close() { const d = dlg(); if (d.open) { d.dataset.silent = '1'; d.close(); delete d.dataset.silent; } }
};

const setNick = v => { nick = v.replace(/\s+/g, ' ').trim().slice(0, 16); try { localStorage.setItem(NICK, nick); } catch { /* storage unavailable */ } };

async function create() {
  pending = true; view('menu');
  const r = await net.call({ action: 'create_room', nickname: nick });
  pending = false;
  if (r?.snapshot && (r.ok || r.code === 'ALREADY_IN_GAME')) return enter(r.snapshot);
  err = r?.message || 'تعذّر إنشاء الغرفة.'; view('menu');
}
async function join(code) {
  pending = true; joinCode = code; view('join');
  const r = await net.call({ action: 'join_room', code, nickname: nick });
  pending = false;
  if (r?.snapshot && (r.ok || r.code === 'ALREADY_IN_GAME')) return enter(r.snapshot);
  err = MSG[r?.code] || r?.message || 'تعذّر الانضمام.'; view('join');
}

async function onClick(e) {
  const set = e.target.closest('[data-set]');
  if (set && !set.disabled) { const v = set.dataset.set === 'minutes' ? Number(set.dataset.v) : set.dataset.v; return net.lobbyAction('update_settings', { settings: { [set.dataset.set]: v } }); }
  const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
  if (a === 'back') return dlg().close();
  if (a === 'retry') return openOnline();
  if (a === 'nickview') return view('nick');
  if (a === 'menu') return view('menu');
  if (a === 'joinview') { joinCode = ''; return view('join'); }
  if (a === 'nick') { const v = $('#oNick').value; if (![...v.trim()].length) { err = 'اكتب اسمًا مستعارًا.'; return view('nick'); } setNick(v); return view('menu'); }
  if (a === 'create') return create();
  if (a === 'join') { const c = $('#oCode').value; return join(c); }
  if (a === 'copy') return copy(net.snap.game.room_code, e.target);
  if (a === 'share') return copy(e.target.closest('[data-link]').dataset.link, e.target);
  if (a === 'ready') { const mine = net.snap.players.find(p => p.seat === net.seat); return net.lobbyAction('set_ready', { ready: !mine.ready }); }
  if (a === 'start') { const r = await net.lobbyAction('start_game'); if (r && !r.ok) { err = r.message; view('room', net.snap); } return; }
  if (a === 'leave') return net.leave();
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch { const t = Object.assign(document.createElement('textarea'), { value: text }); document.body.append(t); t.select(); try { document.execCommand('copy'); } catch { /* clipboard blocked */ } t.remove(); }
  const hint = $('#oHint'); if (hint) hint.textContent = 'تم النسخ ✓';
}

let wired = false;
export async function openOnline(code) {
  const d = dlg();
  if (!wired) { wired = true; d.addEventListener('click', onClick); d.addEventListener('cancel', e => { if (current === 'room') e.preventDefault(); }); }
  if (code) joinCode = String(code);
  if (!d.open) d.showModal();
  $('#oT').textContent = 'اللعب عبر الإنترنت';
  view('connecting');
  if (!configured()) return view('unconfigured');
  try { await connect(); } catch { return view('error'); }
  if (await resumeOpenGame()) return;
  if (!nick) return view('nick');
  view(joinCode ? 'join' : 'menu');
  if (joinCode) { const c = $('#oCode'); if (c) c.value = joinCode; }
}
