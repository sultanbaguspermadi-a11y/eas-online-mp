// Floating windows (settings, word log): one shared behaviour so they feel identical.
// Drag the title (mouse/touch/pen), or focus it and use the arrow keys (Shift = bigger steps); double-click / the reset button restores the default spot.
// Positions are clamped to the viewport (also on resize/rotation) and remembered per device. Pure UI: no game state is touched.
const KEY = 'scrabble.float', M = 8, reg = {};
let z = 40, saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* defaults */ }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* storage unavailable */ } };

function put(el, x, y) {
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(Math.max(M, x), Math.max(M, innerWidth - r.width - M)) + 'px';
  el.style.top = Math.min(Math.max(M, y), Math.max(M, innerHeight - r.height - M)) + 'px';
}

export function makeFloating(el, id, handle, defPos) {
  handle.classList.add('floatHandle'); handle.tabIndex = 0;
  handle.title = 'اسحب لتحريك النافذة · مزدوج النقر لإعادة الموضع';
  const canDrag = () => getComputedStyle(el).position === 'fixed';   // e.g. the docked word log is part of the page
  const place = () => { const p = saved[id] || defPos(el); put(el, p[0], p[1]); };
  const keep = () => { const r = el.getBoundingClientRect(); saved[id] = [r.left, r.top]; persist(); };
  const raise = () => { el.style.zIndex = ++z; };
  let drag = null;
  el.addEventListener('pointerdown', raise, true);
  handle.addEventListener('pointerdown', e => {
    if (e.button || !canDrag()) return;
    const r = el.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    handle.setPointerCapture(e.pointerId); e.preventDefault();
  });
  handle.addEventListener('pointermove', e => { if (drag) put(el, e.clientX - drag.dx, e.clientY - drag.dy); });
  const end = () => { if (drag) { drag = null; keep(); } };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => { if (canDrag()) { delete saved[id]; persist(); place(); } });
  handle.addEventListener('keydown', e => {
    const s = e.shiftKey ? 64 : 16, d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key];
    if (!d || !canDrag()) return;
    e.preventDefault(); const r = el.getBoundingClientRect(); put(el, r.left + d[0], r.top + d[1]); keep();
  });
  addEventListener('resize', () => { if (canDrag() && el.matches('[open],.open')) { const r = el.getBoundingClientRect(); put(el, r.left, r.top); } });
  reg[id] = { place, raise };
}

export function showFloat(id) { reg[id]?.place(); reg[id]?.raise(); }
export function resetFloats() { saved = {}; persist(); for (const f of Object.values(reg)) f.place(); }
// While the settings window floats (non-modal) the game behind it stays frozen, exactly as the old modal did.
export const gameInert = on => document.querySelectorAll('.boardWrap,.side').forEach(n => { n.inert = on; });
