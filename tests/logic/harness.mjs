import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');   // project root
// Node's fetch cannot open file: URLs; serve them from disk so the real dictionary-loading code path runs in the tests.
const nodeFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith('file:')) return nodeFetch(url, init);
  try { const body = fs.readFileSync(new URL(u)); return new Response(body, { status: 200 }); }
  catch { return new Response('not found', { status: 404 }); }
};
export function boot(storage = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  // <dialog> polyfill: showModal sets `open`, close fires the 'close' event like a browser would
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.show = function () { this.setAttribute('open', ''); };   // non-modal dialogs (settings, history)
  w.HTMLDialogElement.prototype.close = function (rv) {
    if (rv !== undefined) this.returnValue = rv;
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open'); this.dispatchEvent(new w.Event('close'));
  };
  for (const k of ['window', 'document', 'localStorage', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'DragEvent', 'Node', 'MutationObserver'])
    Object.defineProperty(globalThis, k, { value: k === 'window' ? w : w[k] ?? class {}, configurable: true, writable: true });
  return w;
}
// Click a <button value=...> inside a method=dialog form: sets returnValue and closes, like the browser does.
export const choose = (sel, value) => { const d = document.querySelector(sel); d.close(value); };

// Load the real dictionary data straight from disk (the browser fetches the same files over HTTP).
export async function loadDictionaryFromDisk() {
  const V = await import(`${ROOT}/js/validator.js`);
  const file = n => path.join(ROOT, 'js', 'dictionary', 'data', n);
  await V.loadDictionary({ fetchText: n => fs.readFileSync(file(n), 'utf8'), fetchBytes: n => fs.readFileSync(file(n)), bank: 'wait' });
  return V;
}
