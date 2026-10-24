import { showFloat } from './float.js';
// Show/hide toggle for the word history (سجل الكلمات). A view preference only, like the theme: it never touches game state.
// Hiding adds the `history-hidden` class to the existing .hist element. The element is never removed, never display:none and
// its grid area is untouched, so its footprint (and therefore every other element's position) cannot change. Only its
// contents and surface become invisible (see css/style.css). History keeps being recorded and rendered while hidden.
import { $ } from './state.js';

const KEY = 'scrabble.historyVisible';
const LABEL = { hide: 'إخفاء السجل', show: 'إظهار السجل' };

// Default visible. Only an explicit saved 'false' hides it; a missing, invalid or unreadable value means visible.
export function loadHistoryVisible() {
  try { return localStorage.getItem(KEY) !== 'false'; } catch { return true; }
}
const save = v => { try { localStorage.setItem(KEY, String(v)); } catch { /* storage unavailable */ } };

export function isHistoryVisible() { return !$('#hist').classList.contains('history-hidden'); }

export function setHistoryVisible(visible, persist = true) {
  $('#hist').classList.toggle('history-hidden', !visible);
  const b = $('#hToggle');
  b.setAttribute('aria-expanded', String(visible));
  b.textContent = visible ? LABEL.hide : LABEL.show;
  if (persist) save(visible);
}

// Drawer mode (default): the log is out of the layout entirely (position:fixed) and opens on demand from #bLog.
// Docked mode: the original always-in-layout panel with the stable hide/show toggle above.
const drawerMode = () => document.documentElement.dataset.hist === 'drawer';
const drawerOpen = () => $('#hist').classList.contains('open');

export function setDrawerOpen(open, focus = true) {
  $('#hist').classList.toggle('open', open);
  if (open) showFloat('hist');
  $('#bLog').setAttribute('aria-expanded', String(open));
  $('#hToggle').setAttribute('aria-expanded', String(open));
  $('#hToggle').textContent = open ? 'إغلاق' : LABEL.show;
  if (focus) (open ? $('#hToggle') : $('#bLog')).focus();
}

export function applyHistMode(mode) {
  if (mode === 'drawer') { $('#hist').classList.remove('history-hidden'); setDrawerOpen(false, false); }
  else { $('#hist').classList.remove('open'); setHistoryVisible(loadHistoryVisible(), false); }
}

export function initHistoryToggle() {
  setHistoryVisible(loadHistoryVisible(), false);
  $('#hToggle').addEventListener('click', () => drawerMode() ? setDrawerOpen(!drawerOpen()) : setHistoryVisible(!isHistoryVisible()));
  $('#bLog').addEventListener('click', () => setDrawerOpen(!drawerOpen()));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawerMode() && drawerOpen()) setDrawerOpen(false); });
}
