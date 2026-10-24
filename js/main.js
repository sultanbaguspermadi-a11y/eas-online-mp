// Application entry point.
import { TICK_MS } from './config.js';
import { S } from './state.js';
import { buildDom, chooseMode } from './ui.js';
import { tick, newGame } from './game.js';
import { initInput } from './input.js';
import { initThemes } from './themes.js';
import { initHistoryToggle } from './histview.js';
import { showCover } from './cover.js';
import { initDims } from './dims.js';
import { initLayout } from './layout.js';
import { initWordCheck } from './wordcheck.js';

function start() {
  initThemes();
  initDims();
  initHistoryToggle();
  initLayout();
  initWordCheck();
  buildDom();
  initInput();
  setInterval(tick, TICK_MS);
  newGame();
  S.paused = true;       // clock stays frozen until the setup flow finishes
  // Online code is imported lazily by the lobby; nothing online runs unless the player asks for it (or is resuming a match / opening a ?room= link).
  const room = new URLSearchParams(location.search).get('room');
  let resume = false; try { resume = localStorage.getItem('scrabble.online.resume') === '1'; } catch { /* storage unavailable */ }
  const openOnline = c => import('./online/lobby.js').then(m => m.openOnline(c)).catch(() => alert('تعذّر تحميل وضع اللعب عبر الإنترنت.'));
  showCover(chooseMode, () => openOnline());   // cover first; LOCAL GAME opens mode selection, ONLINE GAME opens the lobby
  if (room || resume) openOnline(room);
}

start();
