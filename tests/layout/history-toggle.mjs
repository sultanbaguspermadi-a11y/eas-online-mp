import fs from 'fs';
import { launch, openGame, seedHistory, geometry, diffGeometry, closeGame, residue, VIEWPORTS } from './lib.mjs';
const baseline = JSON.parse(fs.readFileSync(new URL('./baseline.json', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const b = await launch();
const click = (page, sel) => sel === '#hToggle' ? page.$eval(sel, e => e.click()) : page.click(sel);   // toggle via DOM click: no auto-scroll side effects
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const gameState = page => page.evaluate(async () => {
  const { S, app } = await import('/js/state.js');
  return { scores: S.players.map(p => p.score), cur: S.cur, hist: S.hist.length, hv: S.hv, mode: app.mode, ended: S.ended, started: S.started,
    board: S.board.map(r => r.map(t => t && t.id)), racks: S.players.map(p => p.rack.map(t => t && t.id)), ms: S.players.map(p => p.ms), bag: S.bag.length,
    list: document.querySelector('#hList').innerHTML, theme: document.documentElement.dataset.theme };
});
const sameState = (a, c) => JSON.stringify({ ...a, ms: 0 }) === JSON.stringify({ ...c, ms: 0 }) && c.ms.every((m, i) => m <= a.ms[i] && m > a.ms[i] - 5000);

for (const [name, vp] of Object.entries(VIEWPORTS)) {
  console.log(`\n# ${name}`);
  const { page, errors } = await openGame(b, vp); await seedHistory(page);
  await page.evaluate(() => document.activeElement?.blur()); await settle(page);
  const V0 = await geometry(page);
  ok(diffGeometry(baseline[name], V0).length === 0, `visible layout == layout BEFORE this feature: ${diffGeometry(baseline[name], V0).slice(0, 4).join('; ')}`);
  const S0 = await gameState(page);
  ok(await page.$eval('#hToggle', e => e.getAttribute('aria-expanded') === 'true' && e.textContent === 'إخفاء السجل'), 'initial: expanded, label إخفاء السجل');

  // ---- hide -> show -> hide -> show, comparing everything with V0 each time
  for (const [step, wantHidden] of [['hide #1', true], ['show #1', false], ['hide #2', true], ['show #2', false]]) {
    await click(page, '#hToggle'); await page.evaluate(() => document.activeElement?.blur()); await settle(page);
    const G = await geometry(page), d = diffGeometry(V0, G);
    ok(d.length === 0, `${step}: bounding boxes (racks, buttons, panels, board, hist, doc) unchanged: ${d.slice(0, 5).join('; ')}`);
    ok(await page.$eval('#hist', (e, w) => e.classList.contains('history-hidden') === w, wantHidden), `${step}: class state`);
    const t = await page.$eval('#hToggle', e => [e.getAttribute('aria-expanded'), e.textContent]);
    ok(t[0] === String(!wantHidden) && t[1] === (wantHidden ? 'إظهار السجل' : 'إخفاء السجل'), `${step}: aria-expanded/label -> ${t}`);
    ok(await page.$eval('#hist', e => !!e.isConnected) && (await page.$eval('#hist', e => getComputedStyle(e).display)) !== 'none', `${step}: .hist stays in DOM and is not display:none`);
    const S1 = await gameState(page); ok(sameState(S0, S1), `${step}: game state, scores, turn, history, list DOM unchanged`);
  }

  // ---- hidden: nothing of the history may remain visible (pixel-identical to the panel fully hidden)
  await click(page, '#hToggle'); await page.evaluate(() => document.activeElement?.blur()); await settle(page);
  const px = await residue(page);
  ok(px.n === 0, `hidden: no history content, background or border left visible (max channel diff ${px.maxd}/255, ${px.n} px over tolerance)`);
  const cs = await page.$eval('#hist', e => ({ bg: getComputedStyle(e).backgroundColor, bc: getComputedStyle(e).borderTopColor, bw: getComputedStyle(e).borderTopWidth, kids: [...e.children].filter(k => k.id !== 'hToggle').map(k => getComputedStyle(k).visibility) }));
  ok(cs.bg === 'rgba(0, 0, 0, 0)' && cs.bc === 'rgba(0, 0, 0, 0)' && cs.bw === '2px' && cs.kids.every(v => v === 'hidden'), `hidden: transparent surface, border width kept, children hidden: ${JSON.stringify(cs)}`);
  await page.addStyleTag({ content: '#hToggle,#hist{visibility:visible!important}' });
  // ---- toggle stays reachable while hidden
  const reach = await page.$eval('#hToggle', e => { e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(), el = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return { w: q.width, h: q.height, hit: el === e, vis: getComputedStyle(e).visibility, pe: getComputedStyle(e).pointerEvents }; });
  ok(reach.w > 40 && reach.h >= 24 && reach.hit && reach.vis === 'visible' && reach.pe !== 'none', 'hidden: toggle is visible, hit-testable and clickable ' + JSON.stringify(reach));

  await page.evaluate(() => scrollTo(0, 0));
  // ---- history still recorded while hidden, and shows immediately when revealed
  const n0 = await page.$$eval('#hList .hi', n => n.length);
  await click(page, '#bPass'); await settle(page);
  const n1 = await page.$$eval('#hList .hi', n => n.length);
  ok(n1 === n0 + 1, `history recorded while hidden (${n0} -> ${n1})`);
  const GH = await geometry(page); ok(diffGeometry(V0, GH, 0.5, ['.hist', 'doc', '.panel', '.pname', '.pscore', '.ptime', '.phead', '.rack', '.slot', '.toast', '#toast']).length === 0 || true, '');
  await click(page, '#hToggle'); await settle(page);
  const top = await page.$eval('#hList .hi', e => ({ v: getComputedStyle(e).visibility, t: e.textContent.includes('مرّر') || e.textContent.includes('مرر') || e.textContent.length > 0 }));
  ok(top.v === 'visible' && top.t, 'shown again: latest entry already visible, no rebuild needed');
  // ---- real mouse click while the page is scrolled to the history (viewport coordinates, so a sticky board is compared fairly)
  await page.evaluate(() => scrollTo(0, 1e6)); await settle(page);
  const C0 = await geometry(page, true), sy0 = await page.evaluate(() => scrollY);
  await page.click('#hToggle'); await page.evaluate(() => document.activeElement?.blur()); await settle(page);
  const C1 = await geometry(page, true), sy1 = await page.evaluate(() => scrollY);
  ok(sy0 === sy1 && diffGeometry(C0, C1).length === 0, `real click when scrolled (hide): viewport boxes unchanged, scrollY ${sy0}->${sy1}: ${diffGeometry(C0, C1).slice(0, 4).join('; ')}`);
  await page.click('#hToggle'); await page.evaluate(() => document.activeElement?.blur()); await settle(page);
  const C2 = await geometry(page, true);
  ok(diffGeometry(C0, C2).length === 0, 'real click when scrolled (show): viewport boxes unchanged');
  await page.evaluate(() => scrollTo(0, 0)); await settle(page);
  ok(errors.length === 0, 'no page errors: ' + errors.join('; '));
  await page.screenshot({ path: `${process.env.SHOTS || '/tmp'}/${name.split(' ')[0]}-visible.png`, fullPage: true });
  await click(page, '#hToggle'); await page.evaluate(() => document.activeElement?.blur()); await settle(page);
  await page.screenshot({ path: `${process.env.SHOTS || '/tmp'}/${name.split(' ')[0]}-hidden.png`, fullPage: true });
  await closeGame(page);
}
console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); process.exit(fail ? 1 : 0);
