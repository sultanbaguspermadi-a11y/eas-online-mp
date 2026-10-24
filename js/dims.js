// User-adjustable interface sizes (board, racks, buttons, history log). Saved on this device, separately from the theme.
// Ranges, steps and defaults all come from DIM_LIMITS in config.js: the slider and the clamp share one table.
import { DIM_LIMITS, DIMENSIONS } from './config.js';
import { $ } from './state.js';

const KEY = 'scrabble.dims';
// Dimensions that get a slider: [key, Arabic label]
const FIELDS = [
  ['boardScale', 'حجم اللوح'],
  ['rackScale', 'حجم الأرفف'],
  ['buttonScale', 'حجم الأزرار'],
  ['historyScale', 'حجم نص السجل'],
  ['historyHeightScale', 'ارتفاع السجل'],
  ['historyWidthScale', 'عرض السجل']
];
const n = (k, v) => { const [lo, hi, , def] = DIM_LIMITS[k]; return Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : def; };

let dims = {...DIMENSIONS};

export function applyDimensions() {
  const r = document.documentElement.style, d = dims;
  r.setProperty('--board-scale', n('boardScale', d.boardScale));
  r.setProperty('--rack-scale', n('rackScale', d.rackScale));
  r.setProperty('--btn-scale', n('buttonScale', d.buttonScale));
  r.setProperty('--btn-gap', n('buttonGap', d.buttonGap) + 'px');
  r.setProperty('--ctrl-cols', Math.round(n('controlColumns', d.controlColumns)));
  r.setProperty('--hist-scale', n('historyScale', d.historyScale));
  r.setProperty('--hist-hs', n('historyHeightScale', d.historyHeightScale));
  r.setProperty('--hist-w', n('historyWidthScale', d.historyWidthScale));
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(dims)); } catch { /* storage unavailable */ } };
const show = v => Math.round(v * 100) + '%';

// (Re)build the slider rows from the current values; called whenever Settings opens or the dimensions are reset.
export function syncDimRows() {
  $('#dmB').innerHTML = FIELDS.map(([k, label]) => {
    const [lo, hi, st] = DIM_LIMITS[k], v = n(k, dims[k]);
    return `<div class="setRow"><div class="setRowHead"><label for="dm_${k}">${label}</label><output id="dmo_${k}" for="dm_${k}">${show(v)}</output></div>`
      + `<input class="setRange" id="dm_${k}" data-k="${k}" type="range" min="${lo}" max="${hi}" step="${st}" value="${v}"></div>`;
  }).join('');
}

export function initDims() {
  try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved && typeof saved === 'object') dims = {...DIMENSIONS, ...saved}; } catch { /* corrupted or unavailable: use defaults */ }
  applyDimensions();
  $('#dmB').addEventListener('input', e => {
    const k = e.target.dataset.k; if (!k) return;
    dims[k] = n(k, e.target.value); $('#dmo_' + k).textContent = show(dims[k]); applyDimensions(); save();
  });
  $('#dmReset').addEventListener('click', () => {
    dims = {...DIMENSIONS}; try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    applyDimensions(); syncDimRows();   // the theme is stored under a different key and is untouched
  });
}
