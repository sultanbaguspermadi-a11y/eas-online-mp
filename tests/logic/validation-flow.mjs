// Game integration: automatic validation inside submit(), the three policies, the settings row, Tahkim on provisional words.
import { boot, choose, ROOT, loadDictionaryFromDisk } from './harness.mjs';
const w = boot();
const imp = f => import(`${ROOT}/js/${f}`);
const { initThemes } = await imp('themes.js');
const { initDims } = await imp('dims.js');
const { buildDom, chooseMode } = await imp('ui.js');
const { initInput } = await imp('input.js');
const G = await imp('game.js');
const { S, app, BY, cur } = await imp('state.js');
const { openJudge, onJudgeClick } = await imp('judge.js');
const WC = await imp('wordcheck.js');
await loadDictionaryFromDisk();

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const group = n => console.log('\n# ' + n);
const d = document, toastText = () => d.querySelector('#toast').textContent;

initThemes(); initDims(); buildDom(); initInput(); WC.initWordCheck(); G.newGame(); S.paused = true;
const allTiles = () => Object.values(BY);
const start = (mode) => { chooseMode(); choose('#md', mode); choose('#sd', '25'); choose('#dlg', 'ok'); S.paused = true; };

// Force the letters of `word` into the current rack (distinct tiles) and lay them on row 7 from column `c0`.
function lay(word, c0 = 7) {
  const used = new Set(), tiles = [...word].map(l => { const t = allTiles().find(x => !x.blank && x.l === l && !used.has(x)); used.add(t); return t; });
  tiles.forEach((t, i) => {
    const rk = cur().rack, old = rk[i];
    for (const arr of [S.bag, S.players[0].rack, S.players[1].rack]) { const j = arr.indexOf(t); if (j >= 0) arr[j] = old; }
    rk[i] = t;
  });
  tiles.forEach((t, i) => G.place(t, 7, c0 + i));
  return tiles;
}
const snap = () => JSON.stringify({ cur: S.cur, scores: S.players.map(p => p.score), hist: S.hist.length, rack: S.players.map(p => p.rack.map(t => t && t.id)), bag: S.bag.length, move: S.move.length });

group('default policy is auto');
ok(WC.wordCheckPolicy() === 'auto', 'default policy: auto');
ok(d.querySelectorAll('#wcB button').length === 3, 'settings row has three options');
ok(d.querySelector('#wcB [aria-pressed="true"]').dataset.v === 'auto', 'auto is pressed');

group('a rejected move changes nothing');
start('expanded');
{
  lay('قطبل');
  const placed = snap();
  G.submit();
  ok(/كلمة غير صحيحة: قطبل/.test(toastText()) && /غير موجودة في القاموس/.test(toastText()), 'toast names the word and the reason: ' + toastText());
  ok(S.hist.length === 0 && S.players.every(p => p.score === 0) && S.move.length === 4, 'no history entry, no score, tiles still on the board');
  ok(snap() === placed, 'state identical after a rejected submit (turn, scores, racks, bag, move)');
  G.cancelMove();
  ok(S.move.length === 0, 'player can take the tiles back');
}

group('a valid move is accepted and says so');
{
  lay('كتاب');
  G.submit();
  ok(S.hist.length === 1 && S.hist[0].words[0].w === 'كتاب' && S.hist[0].total > 0, 'valid word committed');
  ok(/✓ كلمات صحيحة/.test(toastText()) && /نقطة/.test(toastText()), 'toast confirms: ' + toastText());
  ok(!S.hist[0].words[0].unv, 'verified word is not marked provisional');
}

group('Expanded orthography is enforced; Basic spells with its 28 letters');
{
  start('expanded');
  lay('حديقه'); G.submit();
  ok(S.hist.length === 0 && /حديقه/.test(toastText()), 'Expanded: حديقه (ه) rejected');
  G.cancelMove();
  lay('حديقة'); G.submit();
  ok(S.hist.length === 1, 'Expanded: حديقة (ة) accepted');
  start('basic');
  lay('حديقه'); G.submit();
  ok(S.hist.length === 1 && S.hist[0].words[0].w === 'حديقه', 'Basic: حديقه accepted (no ة tile exists)');
  start('basic');
  lay('اكل'); G.submit();
  ok(S.hist.length === 1, 'Basic: اكل accepted as the spelling of أكل');
  start('expanded');
  lay('اكل'); G.submit();
  ok(S.hist.length === 0, 'Expanded: اكل (plain alif) rejected');
  G.cancelMove();
}

group('policy: tahkim (unknown words are provisional)');
{
  ok(WC.setWordCheckPolicy('tahkim') === true && w.localStorage.getItem('scrabble.wordcheck') === 'tahkim', 'policy saved on the device');
  start('expanded');
  lay('قطبل'); G.submit();
  const e = S.hist[S.hist.length - 1];
  ok(S.hist.length === 1 && e.words[0].unv === true, 'unknown word accepted but marked provisional');
  ok(/غير مؤكدة: قطبل/.test(toastText()), 'toast warns: ' + toastText());
  ok(d.querySelector('#hList').textContent.includes('قطبل ؟'), 'history chip carries ؟');
  const challenger = S.cur, mover = 1 - S.cur;
  openJudge();
  ok(d.querySelector('#jB').textContent.includes('قطبل ؟'), 'Tahkim dialog shows the provisional marker');
  onJudgeClick({ target: d.querySelector('[data-a="no"]') });
  ok(S.players[mover].score === 0 && S.hist[S.hist.length - 1].st === 'void' && S.cur === challenger, 'Tahkim still voids a provisional word');
  // a verified word in the same mode carries no marker
  lay('كتاب'); G.submit();
  ok(S.hist[S.hist.length - 1].words[0].unv === undefined && /✓/.test(toastText()), 'verified words are unaffected');
}

group('weak evidence from the word bank is provisional, not rejected');
{
  WC.setWordCheckPolicy('auto');
  const V = await imp('validator.js');
  const fs = await import('fs'), zlib = await import('zlib'), { Dawg } = await imp('dictionary/dawg.js');
  const weak = Dawg.fromBuffer(zlib.gunzipSync(fs.readFileSync(`${ROOT}/js/dictionary/data/bank-weak.bin.gz`)));
  const hasTiles = w => [...w].every(l => allTiles().some(t => !t.blank && t.l === l));
  let word = null; for (const x of weak.words()) if (x.length >= 5 && x.length <= 6 && hasTiles(x) && V.validateWord(x).reason === 'WEAK_EVIDENCE') { word = x; break; }
  ok(word !== null, 'found a weak-tier word that has tiles: ' + word);
  start('expanded');
  lay(word); G.submit();
  const e = S.hist[S.hist.length - 1];
  ok(S.hist.length === 1 && e.words[0].unv === true, 'accepted provisionally in the default (auto) policy');
  ok(/غير مؤكدة/.test(toastText()) && d.querySelector('#hList').textContent.includes(word + ' ؟'), 'the toast warns and the history chip carries ؟');
  const mover = 1 - S.cur;
  openJudge(); onJudgeClick({ target: d.querySelector('[data-a="no"]') });
  ok(S.players[mover].score === 0 && S.hist[S.hist.length - 1].st === 'void', 'Tahkim can still void it');
}

group('policy: off (original behaviour)');
{
  WC.setWordCheckPolicy('off');
  start('expanded');
  lay('قطبل'); G.submit();
  ok(S.hist.length === 1 && !S.hist[0].words[0].unv && !/✓|غير مؤكدة/.test(toastText()), 'no automatic check, no notes');
}

group('settings row');
{
  WC.setWordCheckPolicy('auto');
  d.querySelector('#bSettings').click?.();
  const btn = v => d.querySelector(`#wcB button[data-v="${v}"]`);
  btn('tahkim').click();
  ok(WC.wordCheckPolicy() === 'tahkim' && btn('tahkim').getAttribute('aria-pressed') === 'true' && btn('auto').getAttribute('aria-pressed') === 'false', 'clicking selects tahkim');
  btn('off').click();
  ok(WC.wordCheckPolicy() === 'off' && w.localStorage.getItem('scrabble.wordcheck') === 'off', 'clicking selects off and persists');
  w.localStorage.setItem('scrabble.wordcheck', 'tahkim'); WC.initWordCheck();
  ok(WC.wordCheckPolicy() === 'tahkim', 'stored choice is restored');
  w.localStorage.setItem('scrabble.wordcheck', 'bogus'); WC.initWordCheck();
  ok(WC.wordCheckPolicy() === 'tahkim', 'invalid stored value is ignored (keeps current)');
  ok(WC.setWordCheckPolicy('bogus') === false, 'invalid policy refused');
  btn('auto').click();
  ok(WC.wordCheckPolicy() === 'auto', 'back to auto');
}

group('rejection leaves the game fully playable');
{
  start('expanded');
  lay('قطبل'); G.submit();
  const turn = S.cur;
  G.cancelMove();
  ok(!S.pending && !S.ended && S.cur === turn, 'still the same player\'s turn');
  lay('بيت'); G.submit();
  ok(S.hist.length === 1 && S.cur !== turn, 'the same player then plays a real word and the turn passes');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
