// Test harness for the browser suite: serves the project over HTTP and exposes the REAL server core (service.js on the in-memory store)
// through a tiny HTTP + Server-Sent-Events bridge that stands in for Supabase (Edge Function + Realtime Broadcast + Presence).
// Everything the browser sees about game state goes through service.js exactly as it would in production; only the transport differs.
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { MemoryStore } from './memory-store.mjs';
import { handleRequest } from '../../supabase/functions/_shared/core/service.js';
import { mulberry32, uuidFrom, loadRealDictionary } from './lib.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.txt': 'text/plain' };

export async function startServer() {
  await loadRealDictionary();
  const rng = Math.random, store = new MemoryStore();
  const deps = { rng: mulberry32(Date.now() & 0xffff), now: () => Date.now(), uuid: () => uuidFrom(rng), log: () => {}, ensureDictionary: async () => {} };
  const subs = new Map();   // gameId -> Set<{res, uid}>
  const presence = g => [...new Set([...(subs.get(g) || [])].map(s => s.uid))];
  const push = (g, event, data) => (subs.get(g) || new Set()).forEach(s => s.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  const origCommit = store.commit.bind(store);
  store.commit = async (...a) => { const r = await origCommit(...a); const ev = store.events.at(-1); if (!r.duplicate && ev) push(ev.game_id, 'game', { revision: ev.revision, status: ev.status, event: ev.event }); return r; };
  const state = { offline: new Set(), delay: 0 };   // user ids whose calls are failing (simulated network loss)
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__rpc') {
      let b = ''; for await (const c of req) b += c; const { uid, body } = JSON.parse(b);
      if (state.offline.has(uid)) { res.writeHead(503); return res.end('down'); }
      if (state.delay) await new Promise(r => setTimeout(r, state.delay));
      const out = await handleRequest(store, uid, body, deps);
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(out));
    }
    if (u.pathname === '/__sse') {
      const g = u.searchParams.get('game'), uid = u.searchParams.get('uid');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.write(': hi\n\n');
      const s = { res, uid }; if (!subs.has(g)) subs.set(g, new Set()); subs.get(g).add(s);
      const send = () => push(g, 'presence', presence(g)); send();
      req.on('close', () => { subs.get(g)?.delete(s); send(); }); return;
    }
    if (u.pathname === '/__test') {       // test-only arrangement of server-private state
      let b = ''; for await (const c of req) b += c; const o = JSON.parse(b || '{}');
      if ('delay' in o) state.delay = o.delay;
      if (o.pushPresence) push(o.pushPresence, 'presence', presence(o.pushPresence));
      if (o.offline) state.offline.add(o.offline); if (o.online) state.offline.delete(o.online);
      if (o.rack) { const p = store.peek(o.game), pid = o.uid; p.racks[pid] = Array.from({ length: 7 }, (_, i) => o.rack[i] === undefined ? null : { id: 'T' + i + Math.random().toString(36).slice(2, 5), l: o.rack[i], v: o.vals?.[i] ?? 1, blank: false, as: null }); p.players.find(x => x.player_id === pid).tile_count = o.rack.length; }
      if (o.peek) { res.writeHead(200, { 'content-type': 'application/json' }); const p = store.peek(o.game); return res.end(JSON.stringify({ racks: p.racks, bag: p.priv.bag })); }
      res.writeHead(200); return res.end('{}');
    }
    let f = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}`, store, close: () => { subs.forEach(s => s.forEach(x => x.res.end())); srv.closeAllConnections?.(); srv.close(); } };
}

// Injected into every page BEFORE the app loads: the test seam window.EAS_BACKEND_FACTORY (see js/online/supabase-backend.js).
export const factoryScript = uid => `
window.EAS_BACKEND_FACTORY = () => { let es = null, info = null;
  return {
    async init() { return ${JSON.stringify(uid)}; },
    async call(body) { const r = await fetch('/__rpc', { method: 'POST', body: JSON.stringify({ uid: ${JSON.stringify(uid)}, body }) }); if (!r.ok) { const e = new Error('network'); e.network = true; throw e; } return r.json(); },
    subscribe(gameId, h) {
      es = new EventSource('/__sse?game=' + gameId + '&uid=' + ${JSON.stringify(uid)});
      es.onopen = () => h.onStatus('SUBSCRIBED'); es.onerror = () => h.onStatus('ERROR');
      es.addEventListener('game', e => h.onEvent(JSON.parse(e.data))); es.addEventListener('presence', e => h.onPresence(JSON.parse(e.data)));
      return { close: () => es.close() };
    },
    track(i) { info = i; }
  }; };`;
