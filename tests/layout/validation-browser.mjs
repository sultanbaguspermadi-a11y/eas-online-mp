// Real Chromium: the dictionary loads over HTTP, a rejected move changes nothing, the settings row works.
import { launch, openGame, closeGame, VIEWPORTS } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const b = await launch();
try {
  console.log('\n# dictionary over HTTP, rejection, acceptance');
  const { page, errors } = await openGame(b, VIEWPORTS['desktop 1366x768'], { storage: { 'scrabble.wordcheck': 'auto' } });
  const ready = await page.evaluate(async () => {
    const V = await import('/js/validator.js');
    for (let i = 0; i < 200 && !(V.isDictionaryReady() && V.isBankReady()); i++) await new Promise(r => setTimeout(r, 50));
    const t = performance.now();
    const words = ['والكتاب', 'تعترض', 'تقليص', 'كتبوا', 'يكتبون', 'يوجد', 'قيل', 'يؤكل', 'أعطي', 'قرئ', 'سئل', 'أكتبت', 'احمر'];
    return { ready: V.isDictionaryReady(), bank: V.isBankReady(), bankErr: String(V.bankError() || ''), info: V.dictionaryInfo(), ok: words.filter(w => !V.validateWord(w).valid), bad: V.validateWord('الكتساب').reason, basic: V.validateWord('حديقه', { mode: 'basic' }).valid, ms: performance.now() - t };
  });
  ok(ready.ready && ready.bank && ready.bankErr === '', 'dictionary and word bank loaded over HTTP (gzip decoded in the browser): ' + ready.bankErr);
  ok(ready.ok.length === 0 && ready.bad === 'NOT_IN_LEXICON' && ready.basic, 'bank, mined, passive and clitic words validate in Chromium; gibberish is rejected: ' + ready.ok.join(' '));
  ok(ready.info.bankWords?.mined === true && ready.ms < 1500, `all three data sets present; first validations took ${Math.round(ready.ms)} ms`);
  ok(ready.info.warnings.length === 0, 'no lexicon warnings in the browser');

  const play = word => page.evaluate(async w => {
    const { S, cur, BY } = await import('/js/state.js'); const G = await import('/js/game.js');
    const used = new Set(), tiles = [...w].map(l => { const t = Object.values(BY).find(x => !x.blank && x.l === l && !used.has(x)); used.add(t); return t; });
    tiles.forEach((t, i) => { const rk = cur().rack, old = rk[i]; for (const arr of [S.bag, S.players[0].rack, S.players[1].rack]) { const j = arr.indexOf(t); if (j >= 0) arr[j] = old; } rk[i] = t; });
    tiles.forEach((t, i) => G.place(t, 7, 7 + i));
    const before = JSON.stringify([S.cur, S.players.map(p => p.score), S.hist.length]);
    G.submit();
    return { hist: S.hist.length, toast: document.querySelector('#toast').textContent, same: before === JSON.stringify([S.cur, S.players.map(p => p.score), S.hist.length]), moved: S.move.length };
  }, word);

  const bad = await play('قطبل');
  ok(bad.hist === 0 && bad.same && /كلمة غير صحيحة: قطبل/.test(bad.toast), 'gibberish rejected, state unchanged: ' + bad.toast);
  await page.screenshot({ path: '/tmp/shot-rejected.png' });
  await page.evaluate(async () => { (await import('/js/game.js')).cancelMove(); });
  const good = await play('كتاب');
  ok(good.hist === 1 && /✓/.test(good.toast), 'real word accepted: ' + good.toast);
  await page.screenshot({ path: '/tmp/shot-accepted.png' });

  console.log('\n# settings row');
  await page.click('#bSettings').catch(() => page.evaluate(() => document.querySelector('#bSettings')?.click()));
  const row = await page.evaluate(() => [...document.querySelectorAll('#wcB button')].map(x => [x.dataset.v, x.getAttribute('aria-pressed'), Math.round(x.getBoundingClientRect().width)]));
  ok(row.length === 3 && row.find(r => r[0] === 'auto')[1] === 'true' && row.every(r => r[2] > 40), 'three visible options, auto pressed: ' + JSON.stringify(row));
  await page.click('#wcB button[data-v="tahkim"]');
  const saved = await page.evaluate(() => localStorage.getItem('scrabble.wordcheck'));
  ok(saved === 'tahkim', 'choice persisted: ' + saved);
  await page.screenshot({ path: '/tmp/shot-settings.png' });
  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  await closeGame(page);

  console.log('\n# Basic mode');
  const r2 = await openGame(b, VIEWPORTS['desktop 1366x768'], { storage: { 'scrabble.wordcheck': 'auto' } });
  const basic = await r2.page.evaluate(async () => {
    const V = await import('/js/validator.js');
    for (let i = 0; i < 100 && !V.isDictionaryReady(); i++) await new Promise(r => setTimeout(r, 50));
    return [V.validateWord('حديقه', { mode: 'basic' }).valid, V.validateWord('حديقه', { mode: 'expanded' }).valid, V.validateWord('اكل', { mode: 'basic' }).valid];
  });
  ok(basic[0] && !basic[1] && basic[2], 'Basic spells with 28 letters, Expanded is exact: ' + basic);
  await closeGame(r2.page);
} finally { await b.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
