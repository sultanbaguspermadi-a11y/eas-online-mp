// Supabase Edge Function `eas-game`: the single authoritative entry point for online Arabic Scrabble.
//   POST { action, ...payload }   Authorization: Bearer <user JWT (anonymous sign-in is fine)>
// It authenticates the caller, then hands everything to the PURE core in ../_shared/core (unit-tested in Node), which uses the SAME
// rules, scoring and word validator as the local game (mirrored from /js by tools/sync-edge-shared.mjs).
// The service-role key lives only here (it is injected by Supabase); it never reaches a browser.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest } from '../_shared/core/service.js';
import { loadDictionary } from '../_shared/game/validator.js';
import { SupabaseStore } from './store.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Where the dictionary files are served from (the deployed site). They are public static assets, the same ones browsers download.
const ASSET_BASE_URL = (Deno.env.get('ASSET_BASE_URL') || '').replace(/\/+$/, '');
const ALLOW_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '*';

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const store = new SupabaseStore(db);

const cors = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---- dictionary: loaded once per warm isolate, in the background, never blocking game start ----
let dictionary: Promise<void> | null = null;
function fetchData(name: string) {
  if (!ASSET_BASE_URL) return Promise.reject(new Error('ASSET_BASE_URL is not set'));
  return fetch(`${ASSET_BASE_URL}/js/dictionary/data/${name}`).then((r) => { if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`); return r; });
}
function startDictionary() {
  dictionary ||= loadDictionary({
    fetchText: (n: string) => fetchData(n).then((r) => r.text()),
    fetchBytes: (n: string) => fetchData(n).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
    bank: 'wait'
  }).then(() => undefined).catch((e: unknown) => { dictionary = null; console.log(JSON.stringify({ evt: 'dictionary_load_failed', error: String((e as Error)?.message || e).slice(0, 160) })); });
  return dictionary;
}
startDictionary();   // begin warming at cold start
// A move waits at most this long for the dictionary; after that the words are reported "unverified" (Tahkim), never "verified".
const ensureDictionary = () => Promise.race([startDictionary(), new Promise<void>((r) => setTimeout(r, 6000))]);

const deps = {
  now: () => Date.now(),
  rng: () => { const a = new Uint32Array(2); crypto.getRandomValues(a); return (a[0] * 2 ** 21 + (a[1] >>> 11)) / 2 ** 53; },   // 53 random bits, uniform in [0,1)
  uuid: () => crypto.randomUUID(),
  ensureDictionary,
  // Structured logs. Never rack contents, bag order, tokens or keys.
  log: (evt: string, fields: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), evt, ...fields }))
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, code: 'BAD_REQUEST', message: 'POST only.' }, 405);
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ ok: false, code: 'NOT_MEMBER', message: 'الجلسة منتهية. أعد تحميل الصفحة.' }, 401);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return json({ ok: false, code: 'NOT_MEMBER', message: 'الجلسة منتهية. أعد تحميل الصفحة.' }, 401);
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, code: 'BAD_REQUEST', message: 'طلب غير صالح.' }, 400); }
  // Domain errors are normal answers (HTTP 200 + ok:false): the browser never has to parse a platform error page.
  return json(await handleRequest(store, data.user.id, body, deps));
});
