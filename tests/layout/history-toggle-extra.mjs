import { launch, openGame, seedHistory, geometry, diffGeometry, closeGame, residue, VIEWPORTS } from './lib.mjs';
const PART = process.argv[2];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const b = await launch();
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const tog = page => page.$eval('#hToggle', e => e.click());
const state = page => page.$eval('#hist', h => ({ hidden: h.classList.contains('history-hidden'), exp: document.querySelector('#hToggle').getAttribute('aria-expanded'), label: document.querySelector('#hToggle').textContent }));
const KEY = 'scrabble.historyVisible';

if (PART === 'a') {
console.log('# keyboard + accessibility');
{
  const { page, errors } = await openGame(b, VIEWPORTS['desktop 1366x768']); await seedHistory(page);
  await page.keyboard.press('Shift'); await page.focus('#hToggle');   // a key press first, so :focus-visible applies as for real keyboard users
  ok(await page.$eval('#hToggle', e => document.activeElement === e && e.matches(':focus-visible')) , 'toggle is keyboard-focusable and shows :focus-visible');
  ok(await page.$eval('#hToggle', e => { const c = getComputedStyle(e); return c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 3; }), 'visible focus ring');
  ok(await page.$eval('#hToggle', e => e.tagName === 'BUTTON' && e.type === 'button' && e.getAttribute('aria-controls') === 'hList'), 'native <button type=button> with aria-controls');
  await page.keyboard.press('Enter'); let s = await state(page);
  ok(s.hidden && s.exp === 'false' && s.label === 'إظهار السجل', 'Enter hides: ' + JSON.stringify(s));
  ok(await page.evaluate(() => document.activeElement.id === 'hToggle'), 'focus stays on the toggle after hiding');
  await page.keyboard.press('Space'); s = await state(page);
  ok(!s.hidden && s.exp === 'true' && s.label === 'إخفاء السجل', 'Space shows: ' + JSON.stringify(s));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab'); ok(await page.evaluate(() => !document.querySelector('#hist').contains(document.activeElement) || document.activeElement.id === 'hToggle'), 'Tab never lands inside hidden history content');
  const lab = await page.$eval('#hToggle', e => e.textContent.trim().length > 0 && !!e.textContent); ok(lab, 'has a text label while hidden');
  ok(errors.length === 0, 'no errors ' + errors.join(';')); await closeGame(page);
}

console.log('# persistence, invalid + unavailable storage');
{
  let { page, errors } = await openGame(b, VIEWPORTS['desktop 1366x768']);
  ok((await state(page)).hidden === false, 'default is visible when nothing is stored');
  await tog(page); ok(await page.evaluate(k => localStorage.getItem(k), KEY) === 'false', 'hiding stores scrabble.historyVisible=false');
  ok(await page.evaluate(() => localStorage.getItem('scrabble.theme') === null && localStorage.getItem('scrabble.dims') === null), 'theme and dims keys untouched');
  await page.reload({ waitUntil: 'networkidle0' });
  ok((await state(page)).hidden === true && (await state(page)).label === 'إظهار السجل', 'reload restores hidden state (before any game starts)');
  await page.evaluate(() => { document.querySelector('#hToggle').click(); });
  ok(await page.evaluate(k => localStorage.getItem(k), KEY) === 'true', 'showing stores true');
  await page.reload({ waitUntil: 'networkidle0' }); ok((await state(page)).hidden === false, 'reload restores visible');
  await closeGame(page);
  for (const v of ['maybe', '', 'FALSE', '0', 'null', '{"a":1}', 'undefined']) {
    const r = await openGame(b, VIEWPORTS['desktop 1366x768'], { storage: { [KEY]: v } });
    ok((await state(r.page)).hidden === false && r.errors.length === 0, `invalid stored value ${JSON.stringify(v)} -> visible, no errors`); await closeGame(r.page);
  }
  { const r = await openGame(b, VIEWPORTS['desktop 1366x768'], { storage: { [KEY]: 'false' } });
    ok((await state(r.page)).hidden === true, "stored 'false' -> hidden at startup"); await closeGame(r.page); }
  { const r = await openGame(b, VIEWPORTS['desktop 1366x768'], { throwingStorage: true });
    ok((await state(r.page)).hidden === false, 'unavailable localStorage -> visible by default');
    await tog(r.page); ok((await state(r.page)).hidden === true, 'toggle still works without storage'); await tog(r.page); ok((await state(r.page)).hidden === false, '...and back');
    ok(r.errors.length === 0, 'no page errors without storage: ' + r.errors.join(';')); await closeGame(r.page); }
}

console.log('# extreme dimension settings (hist scale, board scale, button scale) x 4 viewports');
for (const dims of [{ historyScale: 1.6, historyHeightScale: 1.6, historyWidthScale: 1.6, buttonScale: 1.6, boardScale: 1.5, rackScale: 0.5 }, { historyScale: 0.6, historyHeightScale: 0.4, historyWidthScale: 0.6, buttonScale: 0.6, boardScale: 0.5 }]) {
  for (const name of ['portrait-phone 390x844', 'landscape-phone 844x390', 'landscape-tablet 1024x768', 'desktop 1366x768']) {
    const { page } = await openGame(b, VIEWPORTS[name], { storage: { 'scrabble.dims': JSON.stringify(dims) } }); await seedHistory(page); await settle(page);
    const V0 = await geometry(page); await tog(page); await settle(page); const H = await geometry(page); await tog(page); await settle(page); const V1 = await geometry(page);
    const d1 = diffGeometry(V0, H), d2 = diffGeometry(V0, V1);
    ok(d1.length === 0 && d2.length === 0, `${name} dims h=${dims.historyScale}/b=${dims.boardScale}: boxes unchanged on hide+show ${d1.concat(d2).slice(0, 3).join('; ')}`);
    await closeGame(page);
  }
}

}
if (PART === 'b') {
console.log('# all themes: layout stable + nothing visible left behind');
for (const theme of ['classic', 'dark', 'emerald', 'desert']) for (const name of ['desktop 1366x768', 'landscape-phone 844x390', 'portrait-phone 390x844']) {
  const { page } = await openGame(b, VIEWPORTS[name], { storage: { 'scrabble.theme': theme } }); await seedHistory(page);
  ok(await page.evaluate(t => document.documentElement.dataset.theme === t, theme), 'theme applied ' + theme);
  await page.evaluate(() => document.activeElement?.blur()); await settle(page);
  const V0 = await geometry(page); await tog(page); await settle(page); const H = await geometry(page);
  ok(diffGeometry(V0, H).length === 0, `${theme} / ${name}: boxes unchanged`);
  const px = await residue(page);
  ok(px.n === 0, `${theme} / ${name}: hidden panel leaves no visible residue (max diff ${px.maxd}/255)`);
  await tog(page); const pc = await residue(page);
  ok(pc.maxd > 40 && pc.n > 500, `${theme} / ${name}: positive control - VISIBLE history is detected by the same check (max diff ${pc.maxd}, ${pc.n} px)`);
  await closeGame(page);
}
}
console.log(`\n${pass} passed, ${fail} failed`); await b.close(); process.exit(fail ? 1 : 0);
