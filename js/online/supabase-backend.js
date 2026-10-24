// The ONLY file that talks to Supabase from the browser. supabase-js is loaded on demand (never for local play), pinned to an exact version.
// Backend contract used by session.js (tests substitute their own through window.EAS_BACKEND_FACTORY):
//   init()                    -> userId         (anonymous sign-in; the session is persisted by supabase-js, so a refresh keeps the identity)
//   call(body)                -> response json  (the eas-game Edge Function)
//   subscribe(gameId, h)      -> { close() }    h = { onEvent(payload), onStatus('SUBSCRIBED'|'ERROR'|'CLOSED'), onPresence(userIds[]) }
//   track(info)               -> announce presence on the current channel
import { ONLINE_ENV } from './env.js';

export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
export const isConfigured = () => !!(window.EAS_BACKEND_FACTORY || (ONLINE_ENV.url && ONLINE_ENV.anonKey));

export async function createBackend() {
  if (window.EAS_BACKEND_FACTORY) return window.EAS_BACKEND_FACTORY();
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(ONLINE_ENV.url, ONLINE_ENV.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'eas.online.auth' } });
  let userId = null, channel = null, info = null;
  return {
    async init() {
      let { data: { session } } = await sb.auth.getSession();
      if (!session) { const r = await sb.auth.signInAnonymously(); if (r.error) throw r.error; session = r.data.session; }
      userId = session.user.id; return userId;
    },
    async call(body) {
      const { data, error } = await sb.functions.invoke('eas-game', { body });
      if (error) { const e = new Error('network'); e.network = true; throw e; }
      return data;
    },
    async subscribe(gameId, h) {
      await sb.realtime.setAuth();
      const ch = sb.channel('game:' + gameId, { config: { private: true, presence: { key: userId }, broadcast: { self: false } } });
      ch.on('broadcast', { event: '*' }, m => h.onEvent?.(m.payload || {}))
        .on('presence', { event: 'sync' }, () => h.onPresence?.(Object.keys(ch.presenceState())))
        .subscribe(status => {
          if (status === 'SUBSCRIBED') { h.onStatus?.('SUBSCRIBED'); if (info) ch.track(info); }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') h.onStatus?.('ERROR');
          else if (status === 'CLOSED') h.onStatus?.('CLOSED');
        });
      channel = ch;
      return { close: () => { try { sb.removeChannel(ch); } catch { /* already gone */ } if (channel === ch) channel = null; } };
    },
    track(i) { info = i; if (channel) channel.track(i); }
  };
}
