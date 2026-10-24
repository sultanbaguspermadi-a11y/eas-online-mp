import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
export const BASE = process.env.BASE || 'http://localhost:8765';   // set by run-all.mjs
export const URL = BASE + '/index.html';
export const VIEWPORTS = {
  'portrait-phone 390x844':    { width: 390,  height: 844,  isMobile: true,  hasTouch: true,  deviceScaleFactor: 2 },
  'portrait-small 360x640':    { width: 360,  height: 640,  isMobile: true,  hasTouch: true,  deviceScaleFactor: 2 },
  'portrait-tablet 820x1180':  { width: 820,  height: 1180, isMobile: true,  hasTouch: true,  deviceScaleFactor: 2 },
  'landscape-phone 844x390':   { width: 844,  height: 390,  isMobile: true,  hasTouch: true,  deviceScaleFactor: 2 },
  'landscape-small 667x375':   { width: 667,  height: 375,  isMobile: true,  hasTouch: true,  deviceScaleFactor: 2 },
  'landscape-tablet 1024x768': { width: 1024, height: 768,  isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  'landscape-mid 900x700':     { width: 900,  height: 700,  isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  'desktop 1366x768':          { width: 1366, height: 768,  isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
};
// CHROME_PATH=/path/to/chrome uses your own Chrome/Chromium; otherwise the Linux build bundled in @sparticuz/chromium is used.
export async function launch() {
  if (process.env.CHROME_PATH) return puppeteer.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'], headless: true });
  return puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell' });
}
// Layout tests measure geometry, not word validity: they commit arbitrary moves (seedHistory) with the automatic word check off,
// and they assume the always-visible docked history log (the default is the on-demand drawer).
const TEST_DEFAULTS = { 'scrabble.wordcheck': 'off', 'scrabble.layout': JSON.stringify({ hist: 'docked' }) };
export async function openGame(browser, vp, { storage: given = {}, throwingStorage = false } = {}) {
  const storage = { ...TEST_DEFAULTS, ...given };
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.goto(BASE + '/__blank__', { waitUntil: 'load' }).catch(() => {});   // reach the origin, then wipe its storage (single-process Chromium has no extra contexts)
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.evaluateOnNewDocument((st, thr) => {
    if (thr) { Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } }); }
    else for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v);
  }, storage, throwingStorage);
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });  // deterministic measurements
  await page.click('#coverPlay');
  await page.waitForSelector('#md[open]');
  await page.click('#mf .modeBtn[value="expanded"]');
  await page.waitForSelector('#sd[open]');
  await page.click('#sf .btn[value="25"]');
  await page.waitForSelector('#dlg[open]');
  // deterministic deal: same racks in every run, so scores/text widths are comparable
  await page.evaluate(() => { let a = 12345; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
  await page.click('#dF .btn[value="ok"]');
  await page.waitForFunction(() => !document.querySelector('#dlg').open && document.querySelector('#cover').hidden, { timeout: 5000 });
  return { page, errors };
}
// Give the game some history: 3 passes, then a real word, so the log has several entry types.
export async function seedHistory(page) {
  for (let i = 0; i < 3; i++) await page.click('#bPass');
  await page.evaluate(async () => {
    const { S, cur } = await import('/js/state.js'); const G = await import('/js/game.js');
    const [a, b, c] = cur().rack.filter(t => t && !t.blank);
    G.place(a, 7, 6); G.place(b, 7, 7); G.place(c, 7, 8); G.submit();
  });
}
export const MEASURE = ['.app', '.boardWrap', '#board', '#bagInfo', '.side', '#toast', '.players', '.panel', '.phead', '.pname', '.pscore', '.ptime', '.rack', '.slot', '.ctrls', '.ctrls .btn', '.hist', '.hist h2', '.hl'];
export function geometry(page, viewportCoords = false) {
  return page.evaluate((sels, vc) => {
    const out = {};
    for (const s of sels) out[s] = [...document.querySelectorAll(s)].map(e => { const r = e.getBoundingClientRect(); return [r.x + (vc ? 0 : scrollX), r.y + (vc ? 0 : scrollY), r.width, r.height].map(v => Math.round(v * 100) / 100); });
    out.doc = [document.documentElement.scrollWidth, document.documentElement.scrollHeight];
    return out;
  }, MEASURE, viewportCoords);
}
export function diffGeometry(a, b, tol = 0.5, skip = []) {
  const bad = [];
  for (const k of Object.keys(a)) {
    if (skip.includes(k)) continue;
    if (a[k].length !== b[k].length) { bad.push(`${k}: count ${a[k].length} -> ${b[k].length}`); continue; }
    const rows = k === 'doc' ? [[a[k], b[k]]] : a[k].map((r, i) => [r, b[k][i]]);
    rows.forEach(([r, s], i) => r.forEach((v, j) => { if (Math.abs(v - s[j]) > tol) bad.push(`${k}[${i}] ${['x', 'y', 'w', 'h'][j] || j}: ${v} -> ${s[j]}`); }));
  }
  return bad;
}

export const closeGame = page => page.close();

import { PNG } from 'pngjs';
// Pixel residue check: screenshot the history panel with ONLY the toggle hidden, then with the whole panel hidden.
// Returns the largest per-channel difference and the number of differing pixels (>2/255 tolerates gradient dithering).
export async function residue(page) {
  const r = await page.$eval('#hist', e => { const x = e.getBoundingClientRect(); return { x: x.x + scrollX, y: x.y + scrollY, width: x.width, height: x.height }; });
  const clip = { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: r.width + 12, height: r.height + 12 };
  const s1 = await page.addStyleTag({ content: '#hToggle{visibility:hidden!important}' });
  const A = PNG.sync.read(await page.screenshot({ clip, captureBeyondViewport: true }));
  const s2 = await page.addStyleTag({ content: '#hist{visibility:hidden!important}' });
  const B = PNG.sync.read(await page.screenshot({ clip, captureBeyondViewport: true }));
  await s2.evaluate(e => e.remove()); await s1.evaluate(e => e.remove());
  let maxd = 0, n = 0;
  for (let i = 0; i < A.data.length; i += 4) { const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2])); if (d > 2) n++; if (d > maxd) maxd = d; }
  return { maxd, n };
}
