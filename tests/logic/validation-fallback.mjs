// When the dictionary cannot be loaded the game must keep working (Tahkim only), must say honestly that nothing was verified, and recover later.
import { boot, choose, ROOT } from './harness.mjs';
const w = boot();
const realFetch = globalThis.fetch; let broken = true, fetches = 0;
globalThis.fetch = (u, i) => { fetches++; return broken ? Promise.resolve(new Response('boom', { status: 500 })) : realFetch(u, i); };
const imp = f => import(`${ROOT}/js/${f}`);
const { initThemes } = await imp('themes.js');
const { initDims } = await imp('dims.js');
const { buildDom, chooseMode } = await imp('ui.js');
const { initInput } = await imp('input.js');
const G = await imp('game.js');
const { S, BY, cur } = await imp('state.js');
const WC = await imp('wordcheck.js');
const V = await imp('validator.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const group = n => console.log('\n# ' + n);
const d = document, toastText = () => d.querySelector('#toast').textContent, tick = ms => new Promise(r => setTimeout(r, ms));
const allTiles = () => Object.values(BY);
function lay(word, c0 = 7) {
  const used = new Set(), tiles = [...word].map(l => { const t = allTiles().find(x => !x.blank && x.l === l && !used.has(x)); used.add(t); return t; });
  tiles.forEach((t, i) => { const rk = cur().rack, old = rk[i]; for (const arr of [S.bag, S.players[0].rack, S.players[1].rack]) { const j = arr.indexOf(t); if (j >= 0) arr[j] = old; } rk[i] = t; });
  tiles.forEach((t, i) => G.place(t, 7, c0 + i));
}

initThemes(); initDims(); buildDom(); initInput(); WC.initWordCheck(); G.newGame(); S.paused = true;
const fresh = () => { chooseMode(); choose('#md', 'expanded'); choose('#sd', '25'); choose('#dlg', 'ok'); S.paused = true; };
fresh();

group('dictionary unavailable');
await tick(50);
ok(!V.isDictionaryReady() && V.dictionaryError() !== null, 'load failed and the error is recorded');
lay('قطبل'); G.submit();
ok(S.hist.length === 1, 'move accepted (Tahkim-only fallback) instead of blocking the game');
ok(!/✓|غير صحيحة/.test(toastText()), 'never claims the words were verified: ' + toastText());
ok(/تعذّر التحقق/.test(toastText()), 'says explicitly that the words could not be verified: ' + toastText());
ok(S.hist[0].words[0].unv === true, 'marked unverified (؟) so it stays open to Tahkim');

group('recovery');
broken = false;
await tick(50);                       // let the failed attempt that was still in flight settle (a retry never piggybacks on a dead one)
fresh(); lay('كتاب'); G.submit();     // this submit is still unchecked, but it starts a fresh load in the background
ok(S.hist.length === 1, 'the move that triggers the retry is not blocked');
await tick(300);
ok(V.isDictionaryReady(), 'dictionary loaded on retry');
{ const t0 = Date.now(); while (V.bankState() !== 'ready' && Date.now() - t0 < 8000) await tick(25); }   // the word bank downloads after the rules; until then unknown words are only provisional
ok(V.bankState() === 'ready', 'word bank loaded too');
fresh(); lay('قطبل'); G.submit();
ok(S.hist.length === 0, 'after recovery gibberish is rejected again');
ok(/كلمة غير صحيحة/.test(toastText()), 'with the normal message');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
