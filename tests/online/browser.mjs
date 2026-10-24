// Two real browsers (Chromium via Playwright) play through the real client code against the real server core.
// Transport is the test bridge in browser-server.mjs (see its header); everything else is production code.
import { createRequire } from 'module';
import { startServer, factoryScript } from './browser-server.mjs';
import { suite, uuidFrom, mulberry32 } from './lib.mjs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(process.env.PLAYWRIGHT_MODULE || '/home/claude/.npm-global/lib/node_modules/playwright'); }
const { chromium } = pw;
const { ok, group, done } = suite('online browser: two clients');
const rng = mulberry32(42), UA = uuidFrom(rng), UB = uuidFrom(rng);

const S = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const errors = [];
const open = async (uid, viewport = { width: 1280, height: 900 }) => {
  const ctx = await browser.newContext({ viewport, locale: 'ar' });
  if (uid) await ctx.addInitScript(factoryScript(uid));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/503|Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  return { ctx, page };
};
const post = (path, o) => fetch(S.base + path, { method: 'POST', body: JSON.stringify(o) }).then(r => r.json().catch(() => ({})));
const text = (p, sel) => p.locator(sel).first().innerText();
const place = async (p, slot, r, c) => { await p.click(`#rk${await seatOf(p)} .slot[data-i="${slot}"]`); await p.click(`#board .sq[data-r="${r}"][data-c="${c}"]`); };
const seatOf = p => p.evaluate(() => document.querySelector('#pn0 .pname').textContent.includes('(أنت)') ? 0 : 1);
const wait = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 8000 });

group('lobby: create and join from two browsers');
const A = await open(UA), B = await open(UB);
await A.page.goto(S.base); await B.page.goto(S.base);
await A.page.click('#coverOnline'); await A.page.fill('#oNick', 'Sultan'); await A.page.click('[data-a="nick"]'); await A.page.click('[data-a="create"]');
await A.page.waitForSelector('.oCodeBig'); const code = (await text(A.page, '.oCodeBig')).trim();
ok(/^[A-HJ-NP-Z2-9]{6}$/.test(code), 'room code shown: ' + code);
await B.page.click('#coverOnline'); await B.page.fill('#oNick', 'Ahmad'); await B.page.click('[data-a="nick"]'); await B.page.click('[data-a="joinview"]');
await B.page.fill('#oCode', code.toLowerCase()); await B.page.click('[data-a="join"]');
await B.page.waitForSelector('.oCodeBig');
ok((await text(B.page, '.oPlayers')).includes('Sultan'), 'B sees the host in the lobby');
await wait(A.page, () => document.querySelector('.oPlayers').innerText.includes('Ahmad'));
ok(true, 'A sees B join in real time (broadcast)');
ok(await B.page.locator('[data-set]').first().isDisabled(), 'the guest cannot edit the rules');
await A.page.click('[data-set="minutes"][data-v="10"]');
await wait(B.page, () => document.querySelector('[data-set="minutes"][data-v="10"]')?.getAttribute('aria-pressed') === 'true');
ok(true, 'rule changes reach the guest');
ok(await A.page.locator('[data-a="start"]').isDisabled(), 'host cannot start before the guest is ready');
await B.page.click('[data-a="ready"]');
await wait(A.page, () => !document.querySelector('[data-a="start"]').disabled);
await A.page.click('[data-a="start"]');

group('match: each sees only their own rack');
// (the page already shows a local-game rack behind the lobby, so wait for the lobby to close, not just for tiles)
await wait(A.page, () => !document.querySelector('#od').open && document.querySelectorAll('#rk1 .tile.back').length === 7);
await wait(B.page, () => !document.querySelector('#od').open && document.querySelectorAll('#rk0 .tile.back').length === 7);
const nb = [await A.page.locator('#rk1 .tile.back').count(), await B.page.locator('#rk0 .tile.back').count()]; console.log('  back tiles', nb);
ok(nb[0] === 7 && nb[1] === 7, "the opponent's rack is 7 face-down tiles on both screens");
const gid = [...S.store.games.keys()][0], peek = await post('/__test', { peek: 1, game: gid });
const htmlA = await A.page.content(), htmlB = await B.page.content();
const idsOf = uid => peek.racks[uid].filter(Boolean).map(t => t.id);
ok(idsOf(UB).every(id => !htmlA.includes(`data-id="${id}"`)) && idsOf(UA).every(id => !htmlB.includes(`data-id="${id}"`)), "neither page's DOM contains the other's tile ids");
ok(peek.bag.every(t => !htmlA.includes(`"${t.id}"`) && !htmlB.includes(`"${t.id}"`)), 'no bag tile id in either page');
const nameA = await text(A.page, '#pn0 .pname'); ok(nameA.includes('Sultan') && nameA.includes('أنت'), 'names come from nicknames: ' + nameA.replace(/\n/g, ' '));

group('a move, synchronised, and refresh restores the match');
await post('/__test', { game: gid, uid: UA, rack: [...'كتابمدر'], vals: [3, 1, 1, 2, 2, 2, 1] });
await A.page.reload();                                                    // also proves resume-on-refresh: no cover, straight back to the match
await wait(A.page, () => document.querySelector('#rk0 .tile:not(.back) b')?.textContent.includes('ك'));
ok(await A.page.locator('#cover:not([hidden])').count() === 0 || await A.page.evaluate(() => document.getElementById('cover').classList.contains('out') || document.getElementById('cover').hidden), 'after a refresh the player lands in the match, not on the cover');
for (let i = 0; i < 4; i++) await place(A.page, i, 7, 7 + i);
await A.page.click('#bSubmit');
await wait(A.page, () => document.querySelector('#sc0').textContent === '14');
ok((await text(A.page, '#toast')).includes('+14'), 'toast shows the server-computed score');
await wait(B.page, () => document.querySelector('#sc0').textContent === '14');
ok((await text(B.page, '#board .sq[data-r="7"][data-c="7"] .tile b')).includes('ك'), 'B sees the tile on the board');
ok(await B.page.locator('#pn1.on').count() === 1 && await A.page.locator('#pn1.on').count() === 1, 'both screens show it is now B\'s turn');
ok(await A.page.locator('#rk0 .tile:not(.back)').count() === 7, 'A\'s rack was refilled by the server');
await A.page.reload();
await wait(A.page, () => document.querySelector('#sc0').textContent === '14' && document.querySelector('#board .sq[data-r="7"][data-c="10"] .tile'));
ok(await A.page.locator('#rk0 .tile:not(.back)').count() === 7 && await A.page.locator('#hList .hi').count() === 1 && await A.page.locator('#pn1.on').count() === 1, 'refresh restored board, score, rack, history and turn');

group('turn discipline');
await A.page.click('#rk0 .slot[data-i="0"]'); 
ok((await text(A.page, '#toast')).includes('ليس دورك'), 'A cannot pick tiles on B\'s turn');
await B.page.click('#rk0 .slot[data-i="0"]'); ok((await text(B.page, '#toast')).includes('رفّ الخصم'), 'B cannot touch A\'s rack');
await B.page.click('#bPass');
await wait(A.page, () => document.querySelectorAll('#hList .hi').length === 2);
ok(true, 'B\'s pass reached A');

group('network loss and recovery');
await post('/__test', { offline: UA });
await A.page.click('#bPass');
await wait(A.page, () => /إعادة الاتصال|لا يوجد اتصال/.test(document.querySelector('#netState').textContent));
ok(true, 'status bar reports the connection problem');
await new Promise(r => setTimeout(r, 900)); await post('/__test', { online: UA });
await wait(A.page, () => document.querySelectorAll('#hList .hi').length === 3, null);
await wait(B.page, () => document.querySelectorAll('#hList .hi').length === 3);
await new Promise(r => setTimeout(r, 400));
ok(await B.page.locator('#hList .hi').count() === 3 && S.store.peek(gid).moves.length === 3, 'the retried pass was applied exactly once (idempotent retry)');

group('opponent disconnect is shown quietly');
await B.ctx.close();
await wait(A.page, () => document.querySelector('#netState').textContent.includes('غير متصل'));
ok(true, 'A is told the opponent disconnected'); ok(await A.page.locator('#pn1 .pstat.off').count() === 1, 'presence mark is text, not only colour');

group('local game is unaffected and works without any online configuration');
const L = await open(null);
await L.page.goto(S.base); await L.page.click('#coverPlay');
await L.page.waitForSelector('#md[open]');
ok(true, 'LOCAL GAME opens the mode dialog with no backend at all');
await L.page.click('#md .modeBtn >> nth=0'); await L.page.waitForSelector('#sd[open]'); await L.page.click('#sf .btn >> nth=2');
await L.page.waitForSelector('#dlg[open]'); await L.page.click('#dF .btn >> nth=0');
await L.page.click('#bPass'); await L.page.waitForFunction(() => document.querySelectorAll('#hList .hi').length === 1);
ok(await L.page.evaluate(() => document.querySelector('#pn1.on') !== null && document.querySelector('#netBar').hidden), 'a local game plays through the real UI (pass hands the turn over), with no online bar');
const L2 = await open(null); await L2.page.goto(S.base); await L2.page.click('#coverOnline');
await L2.page.waitForSelector('#oB');
ok((await text(L2.page, '#oB')).includes('غير مُهيَّأ'), 'ONLINE GAME without configuration says so and does not break');
ok(await L2.page.evaluate(() => !document.getElementById('cover').hidden), 'cover (and local play) remain available');

group('mobile viewport');
const M = await open(UA, { width: 390, height: 780 });
await M.ctx.addInitScript(() => localStorage.setItem('scrabble.online.resume', '1'));   // a phone that already had the match open
await M.page.goto(S.base);
await M.page.waitForFunction(() => document.getElementById('cover').hidden && !document.querySelector('#od').open && document.querySelectorAll('#rk0 .tile:not(.back)').length === 7, null, { timeout: 8000 });
const overflow = await M.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
ok(!overflow, 'no horizontal overflow on a 390px phone');
await M.page.screenshot({ path: '/tmp/online-mobile.png' });
await A.page.screenshot({ path: '/tmp/online-desktop.png' });

group('console');
ok(errors.length === 0, 'no console / page errors: ' + errors.slice(0, 3).join(' | '));
await browser.close(); S.close(); done();
