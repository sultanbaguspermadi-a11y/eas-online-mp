// Visual themes. A theme is a device preference, not match state: it only sets <html data-theme="...">;
// every colour comes from the CSS variables in css/themes.css. Nothing here touches game state.
import { $ } from './state.js';

export const THEMES = {
  classic: { id: 'classic', labelAr: 'كلاسيكي', labelEn: 'Classic' },
  dark:    { id: 'dark',    labelAr: 'داكن',    labelEn: 'Dark' },
  emerald: { id: 'emerald', labelAr: 'زمردي',   labelEn: 'Emerald' },
  desert:  { id: 'desert',  labelAr: 'صحراوي',  labelEn: 'Desert' }
};
export const DEFAULT_THEME = 'classic';

// Same key as the tiny pre-paint script in index.html <head>.
const KEY = 'scrabble.theme';
const valid = id => typeof id === 'string' && Object.hasOwn(THEMES, id);

// Saved id if valid; empty / unavailable storage / corrupted / unknown id all fall back to classic.
export function loadTheme() {
  try { const id = localStorage.getItem(KEY); if (valid(id)) return id; } catch { /* storage unavailable */ }
  return DEFAULT_THEME;
}
const save = id => { try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ } };

export function applyTheme(id) { document.documentElement.dataset.theme = valid(id) ? id : DEFAULT_THEME; }

function syncRows() {
  const cur = document.documentElement.dataset.theme;
  document.querySelectorAll('#thB .thOpt').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === cur)));
}

export function setTheme(id) {
  if (!valid(id)) return;
  applyTheme(id); save(id); syncRows();
}

// Each option carries its own data-theme, so its swatches and colours preview that theme through the same CSS variables.
function buildRows() {
  $('#thB').innerHTML = Object.values(THEMES).map(t =>
    `<button type="button" class="thOpt" data-theme="${t.id}" aria-pressed="false">`
    + `<span class="thName">${t.labelAr}<small>${t.labelEn}</small></span>`
    + '<span class="thSw" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></button>').join('');
  syncRows();
}

export function initThemes() {
  applyTheme(loadTheme());
  buildRows();
  $('#thB').addEventListener('click', e => { const b = e.target.closest('.thOpt'); if (b) setTheme(b.dataset.theme); });
}
