// Render stability of an online match (desktop). Records every DOM mutation on the idle player's page and the browser's layout/style counters,
// while the page receives everything that happens "harmlessly" in production: safety polls, visibility/online sync, repeated presence events.
// Expected: the countdown text is the ONLY thing that changes.
import { createRequire } from 'module';
import { startServer, factoryScript } from './browser-server.mjs';
import { suite, uuidFrom, mulberry32 } from './lib.mjs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(process.env.PLAYWRIGHT_MODULE || '/home/claude/.npm-global/lib/node_modules/playwright'); }
const { ok, group, done } = suite('online render stability (desktop)');
const rng = mulberry32(9), UA = uuidFrom(rng), UB = uuidFrom(rng), IDLE_MS = Number(process.env.IDLE_MS || 27000);
const S = await startServer(), browser = await pw.chromium.launch();
const open = async (uid, vp = { width: 1366, height: 768 }) => { const ctx = await browser.newContext({ viewport: vp }); await ctx.addInitScript(factoryScript(uid)); return { ctx, page: await ctx.newPage() }; };
const post = o => fetch(S.base + '/__test', { method: 'POST', body: JSON.stringify(o) }).then(r => r.json().catch(() => ({})));
const wait = (p, fn, a) => p.waitForFunction(fn, a, { timeout: 8000 });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Observer installed in the page: counts writes by region, separating timer text from everything else, and writes that changed nothing.
const OBSERVE = () => {
  if (!window.__animHook) { window.__animHook = 1; window.__pops = 0; document.addEventListener('animationstart', e => { if (e.animationName === 'pop') window.__pops++; }); }
  window.__pops = 0; window.__mo?.disconnect(); window.__m = { total: 0, noop: 0, regions: {}, pops: 0 };
  const region = n => { const e = n.nodeType === 1 ? n : n.parentElement; return e ? (e.closest('.ptime') ? 'timer' : (e.closest('#rk0,#rk1') ? 'rack' : e.closest('#board') ? 'board' : e.closest('#hList,#hBest') ? 'history' : e.closest('.panel') ? 'panel' : e.closest('#netBar') ? 'netBar' : e.closest('#od') ? 'lobby' : e.closest('#toast') ? 'toast' : e.closest('.controls,#ctl,button') ? 'controls' : (e.id || e.className || e.tagName))) : '?'; };
  window.__mo = new MutationObserver(list => list.forEach(r => {
    const reg = region(r.target); window.__m.total++; window.__m.regions[reg] = (window.__m.regions[reg] || 0) + 1;
    if (r.type === 'attributes' && r.oldValue === r.target.getAttribute(r.attributeName)) window.__m.noop++;
    if (r.type === 'characterData' && r.oldValue === r.target.data) window.__m.noop++;
  })).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true });
};

const A = await open(UA), B = await open(UB);
await A.page.goto(S.base); await B.page.goto(S.base);
await A.page.click('#coverOnline'); await A.page.fill('#oNick', 'Sultan'); await A.page.click('[data-a="nick"]'); await A.page.click('[data-a="create"]');
await A.page.waitForSelector('.oCodeBig'); const code = (await A.page.locator('.oCodeBig').innerText()).trim();
await B.page.click('#coverOnline'); await B.page.fill('#oNick', 'Ahmad'); await B.page.click('[data-a="nick"]'); await B.page.click('[data-a="joinview"]');
await B.page.fill('#oCode', code); await B.page.click('[data-a="join"]'); await B.page.waitForSelector('.oCodeBig');
await B.page.click('[data-a="ready"]'); await wait(A.page, () => !document.querySelector('[data-a="start"]').disabled); await A.page.click('[data-a="start"]');
await wait(A.page, () => !document.querySelector('#od').open && document.querySelectorAll('#rk1 .tile.back').length === 7);
await wait(B.page, () => !document.querySelector('#od').open && document.querySelectorAll('#rk0 .tile.back').length === 7);
const gid = [...S.store.games.keys()][0];
await post({ game: gid, uid: UA, rack: [...'كتابمدر'], vals: [3, 1, 1, 2, 2, 2, 1] }); await A.page.reload();
await wait(A.page, () => document.querySelector('#rk0 .tile:not(.back) b')?.textContent.includes('ك'));
const place = async (p, slot, c) => { await p.click(`#rk0 .slot[data-i="${slot}"]`); await p.click(`#board .sq[data-r="7"][data-c="${c}"]`); };
for (let i = 0; i < 4; i++) await place(A.page, i, 7 + i);
await A.page.click('#bSubmit'); await wait(A.page, () => document.querySelector('#sc0').textContent === '14'); await wait(B.page, () => document.querySelector('#sc0').textContent === '14');
await sleep(4600);   // let the move's own toast expire: the measured window starts from a settled screen

group(`idle opponent turn: A watches for ${IDLE_MS / 1000}s (polls, visibility/online syncs, repeated presence)`);
const cdp = await A.ctx.newCDPSession(A.page); await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
await A.page.evaluate(OBSERVE);
await A.page.evaluate(() => { const nodes = [...document.querySelectorAll('#rk0 .tile, #rk1 .tile, #board .tile')]; nodes.forEach((n, i) => { n.__keep = i; }); window.__nodes = nodes.length; });
const m0 = await metrics(), t0 = Date.now();
for (let t = 2000; t < IDLE_MS; t += 5000) {
  await sleep(Math.max(0, t0 + t - Date.now()));
  await A.page.evaluate(i => { if (i % 3 === 0) document.dispatchEvent(new Event('visibilitychange')); else if (i % 3 === 1) window.dispatchEvent(new Event('online')); }, (t - 2000) / 5000);
  await post({ pushPresence: gid });
}
await sleep(Math.max(0, t0 + IDLE_MS - Date.now()));
const m1 = await metrics(), r = await A.page.evaluate(() => ({ ...window.__m, pops: window.__pops, kept: [...document.querySelectorAll('#rk0 .tile, #rk1 .tile, #board .tile')].filter(n => n.__keep !== undefined).length, nodes: window.__nodes }));
const other = Object.entries(r.regions).filter(([k]) => k !== 'timer');
console.log('  mutations by region:', JSON.stringify(r.regions), ' no-op writes:', r.noop);
console.log(`  layouts: ${m1.LayoutCount - m0.LayoutCount}  style recalcs: ${m1.RecalcStyleCount - m0.RecalcStyleCount}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
ok(other.length === 0, 'nothing but the countdown changed: ' + JSON.stringify(Object.fromEntries(other)));
ok(r.noop === 0 || r.noop === (r.regions.timer || 0) * 0, 'no write replaced a value with the same value (no-op writes: ' + r.noop + ')');
ok(r.kept === r.nodes && r.nodes > 0, `rack and board tile DOM nodes survived (${r.kept}/${r.nodes} are the same nodes)`);
ok(r.pops === 0, 'score pop animation did not restart during idle syncs');

group('presence: repeated identical presence and a real change');
await A.page.evaluate(OBSERVE);
await post({ pushPresence: gid }); await post({ pushPresence: gid }); await sleep(700);
const noTimer = o => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'timer'));
let p1 = noTimer(await A.page.evaluate(() => window.__m.regions)); ok(Object.keys(p1).length === 0, 'identical presence events change nothing: ' + JSON.stringify(p1));
await B.ctx.close(); await wait(A.page, () => document.querySelector('#netState').textContent.includes('غير متصل')); await sleep(300);
const p2 = noTimer(await A.page.evaluate(() => window.__m.regions));
ok(Object.keys(p2).every(k => ['netBar', 'panel'].includes(k)), 'a real presence change touches only the status bar / presence mark: ' + JSON.stringify(p2));

group('busy action: a slow request does not rebuild the rack');
const C = await open(UB); await C.page.addInitScript(() => localStorage.setItem('scrabble.online.resume', '1'));
await C.page.goto(S.base); await wait(C.page, () => document.getElementById('cover').hidden && document.querySelectorAll('#rk1 .tile:not(.back)').length === 7);
await wait(A.page, () => document.querySelector('#netState').textContent.includes('متصل') && !document.querySelector('#netState').textContent.includes('غير'));
await C.page.evaluate(() => { document.querySelectorAll('#rk1 .tile').forEach((n, i) => { n.__keep = i; }); });
await C.page.evaluate(OBSERVE); await post({ delay: 900 });
await C.page.click('#bPass'); await sleep(350);
const during = await C.page.evaluate(() => ({ regions: Object.fromEntries(Object.entries(window.__m.regions).filter(([k]) => k !== 'timer')), same: [...document.querySelectorAll('#rk1 .tile')].filter(n => n.__keep !== undefined).length }));
ok(!('rack' in during.regions) && !('board' in during.regions) && during.same === 7, 'while the request is pending the rack/board are untouched: ' + JSON.stringify(during.regions));
await post({ delay: 0 }); await wait(C.page, () => document.querySelectorAll('#hList .hi').length === 2);

group('score pop fires once per real score, never for a pass or a repeated sync');
await A.page.evaluate(OBSERVE);
await A.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(500);
ok((await A.page.evaluate(() => window.__pops)) === 0, 'no pop on a repeated sync');
const D = await open(UB); await D.page.addInitScript(() => localStorage.setItem('scrabble.online.resume', '1'));
await D.page.goto(S.base); await wait(D.page, () => document.getElementById('cover').hidden && document.querySelectorAll('#rk1 .tile:not(.back)').length === 7);
await A.page.evaluate(OBSERVE);
await post({ game: gid, uid: UB, rack: [...'كنوزسلا'], vals: [3, 1, 1, 2, 2, 2, 1] }); await D.page.reload(); await wait(D.page, () => document.querySelector('#rk1 .tile:not(.back)'));
await wait(A.page, () => document.querySelector('#pn0.on'));   // after C's pass it is A's turn: pass back so D can score
await A.page.click('#bPass'); await wait(D.page, () => document.querySelector('#pn1.on'));
ok((await A.page.evaluate(() => window.__pops)) === 0, 'a pass by A or B did not pop any score');

await A.page.evaluate(OBSERVE);
await A.page.evaluate(OBSERVE);
await D.page.click('#rk1 .slot[data-i="1"]'); await D.page.click('#board .sq[data-r="8"][data-c="7"]'); await D.page.click('#bSubmit');
await wait(A.page, () => Number(document.querySelector('#sc1').textContent) > 0);
await A.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); }); await sleep(600);
ok((await A.page.evaluate(() => window.__pops)) === 1, 'exactly one pop for the one real score, none for the syncs after it: ' + await A.page.evaluate(() => window.__pops));
group('layout unchanged across viewports (online match, resumed)');
for (const [w, h, name] of [[1920, 1080, 'desktop 1920x1080'], [1366, 768, 'desktop 1366x768'], [390, 780, 'phone portrait'], [844, 390, 'phone landscape']]) {
  const E = await open(UA, { width: w, height: h }); await E.ctx.addInitScript(() => localStorage.setItem('scrabble.online.resume', '1'));
  await E.page.goto(S.base); await wait(E.page, () => document.getElementById('cover').hidden && document.querySelectorAll('#rk0 .tile:not(.back)').length === 7);
  await sleep(500);
  const g = await E.page.evaluate(() => { const r = document.querySelector('#rk0').getBoundingClientRect(); return { x: document.documentElement.scrollWidth > innerWidth + 1, rackW: Math.round(r.width), rackIn: r.left >= -1 && r.right <= innerWidth + 1 }; });
  const a = await E.page.evaluate(() => document.querySelector('#rk0').getBoundingClientRect().width), b = await (async () => { await sleep(1200); return E.page.evaluate(() => document.querySelector('#rk0').getBoundingClientRect().width); })();
  ok(!g.x && g.rackIn && a === b, `${name}: no horizontal overflow, rack inside the viewport and its width is stable (${g.rackW}px)`);
  await E.ctx.close();
}
await browser.close(); S.close(); done();
