// Browser-safe public settings for online play. Written at deploy time by tools/write-env.mjs from the SUPABASE_URL / SUPABASE_ANON_KEY
// environment variables (Vercel build). Empty values simply mean "online play is not configured": local play is unaffected.
// NEVER put the service-role key here: only the public project URL and the public anon/publishable key.
export const ONLINE_ENV = { url: '', anonKey: '' };
