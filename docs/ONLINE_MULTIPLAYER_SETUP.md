# Online multiplayer: setup from zero

You need: a free [Supabase](https://supabase.com) account, your existing Vercel project, Node 20+ on your computer, and the repository checked out.
Nothing below is optional unless it says so. Local play keeps working before, during and after this setup.

> Not verified against a live Supabase project: this repository was developed and tested without access to one (see
> `ONLINE_IMPLEMENTATION_REPORT.md`, "Known limitations"). Follow step 11 in order the first time; section 12 lists what to check if something fails.

## 1. Create the Supabase project
1. supabase.com → **New project**. Pick a region near your players, set a database password (store it in a password manager; the game never needs it).
2. Wait until the project is ready.

## 2. Project URL
**Project Settings → API → Project URL**, e.g. `https://abcdefghijklmno.supabase.co`. This is `SUPABASE_URL`. The part before `.supabase.co` is the **project ref**.

## 3. Public key
Same page → **Project API keys** → the key labelled **anon / public** (or **publishable** in the newer UI). This is `SUPABASE_ANON_KEY`.
Do **not** use `service_role` / `secret`. (`tools/write-env.mjs` refuses to build if it recognises a service-role key.)

## 4. Anonymous sign-ins (players never register)
**Authentication → Sign In / Providers → Anonymous Sign-Ins → enable.**
Recommended: **Authentication → Attack Protection → enable CAPTCHA** so bots cannot mass-create anonymous users.

## 5. Install the CLI and link the project
```bash
npm install -g supabase            # or: npx supabase ...
supabase login
supabase link --project-ref YOUR_PROJECT_REF     # asks for the database password from step 1
```

## 6. Apply the migrations (tables, constraints, RLS, functions, realtime trigger)
```bash
supabase db push
```
This runs, in order, `supabase/migrations/20261024000001_eas_online_schema.sql`, `…02_eas_online_security.sql`, `…03_eas_online_functions.sql`.
Everything (tables, indexes, RLS policies, the commit/create functions, the realtime trigger, the cleanup function) is in those files; there is nothing to click in the dashboard.

## 7. Row Level Security
Already enabled by migration 02 on all six tables. Verify: **Table Editor → each table → "RLS enabled"** is shown, and **Authentication → Policies** lists:
`members read their game`, `members read game players`, `members read game moves`, `owner reads own rack` (public schema) and
`members receive game channel`, `members track presence` (realtime schema). `game_private` and `game_actions` must have **no** policies.

## 8. Realtime
1. **Realtime → Settings**: make sure **"Allow public access"** is **OFF** (so only authorised private channels work; the game uses private channels `game:<id>`).
2. Nothing else: the migration installs a trigger that calls `realtime.send(...)` after each committed revision, and the RLS policies above authorise members.

## 9. Deploy the Edge Function and set its secrets
Dictionary files are fetched by the function from your deployed site, so the site must already be live (it is: Vercel).
```bash
supabase secrets set ASSET_BASE_URL=https://YOUR-SITE.vercel.app ALLOWED_ORIGIN=https://YOUR-SITE.vercel.app
supabase functions deploy eas-game
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function by Supabase itself. You never copy the service-role key anywhere.
The function code imports `supabase/functions/_shared/game/*`, a generated mirror of `js/`. After changing anything in `js/rules.js`,
`js/wordpolicy.js`, `js/validator.js`, `js/config.js`, `js/modes.js` or `js/dictionary/*.js`, run `node tools/sync-edge-shared.mjs` and redeploy the function (the test-suite fails if the mirror is stale).

## 10. Vercel
1. Vercel → your project → **Settings → Environment Variables**: add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Production + Preview). Nothing else.
2. **Settings → Build & Development**: Framework Preset **Other**; Build Command `node tools/write-env.mjs`; Output Directory `.` (the repository's `vercel.json` already says this).
3. **Deployments → Redeploy** (env variables only apply to new builds).

## 11. Test with two devices
1. Device A (phone, mobile data): open the site → **ONLINE GAME** → nickname → **إنشاء غرفة**. Note the 6-character code.
2. Device B (laptop, home Wi-Fi: a different network is fine): open the site → **ONLINE GAME** → nickname → **الانضمام إلى غرفة** → type the code.
3. B presses **أنا جاهز**; A presses **ابدأ المباراة**. Each device shows only its own tiles.
4. Play a few moves, one pass, one swap. Refresh A's page mid-game: it returns to the same match. Switch B to airplane mode for ten seconds: A sees "غير متصل", B recovers by itself.
5. Share link variant: `https://YOUR-SITE.vercel.app/?room=K7Q4P2` opens the join screen with the code filled in.

Optional, recommended: **Database → Extensions → pg_cron → enable**, then run migration 03's last block once more (or `select cron.schedule('eas-cleanup-stale-games','17 * * * *','select public.eas_cleanup_stale_games()');`) to clean up stale rooms hourly.

## 12. Common problems
| Symptom | Cause / fix |
|---|---|
| "اللعب عبر الإنترنت غير مُهيَّأ" | Vercel env vars missing or you did not redeploy after adding them. Check `js/online/env.js` in the deployed site is non-empty. |
| "تعذّر الاتصال بخدمة اللعب" right away | Anonymous sign-ins disabled (step 4), wrong URL/key, or the function is not deployed (`supabase functions list`). Open the browser console → Network → look at the `auth/v1/signup` and `functions/v1/eas-game` calls. |
| CORS error on `eas-game` | `ALLOWED_ORIGIN` does not equal the exact site origin (no trailing slash). Re-run `supabase secrets set …` and redeploy. |
| Room created but the other player's join never appears live | Realtime private channel not authorised: re-apply migration 02; confirm the two `realtime.messages` policies exist; confirm "Allow public access" is OFF and the project's Realtime is enabled. The game still works through the 12-second safety poll, only slower. |
| Words show "؟ تعذّر التحقق" every time | The function cannot fetch the dictionary: `ASSET_BASE_URL` wrong, or site blocks it. `supabase functions logs eas-game` shows `dictionary_load_failed`. Play continues with Tahkim in the meantime. |
| `ROOM_CODE_TAKEN` / `STALE_REVISION` in logs | Normal and handled (retry / resync). |
| "الجلسة منتهية" | The browser's anonymous identity was lost (site data cleared). The old seat cannot be reclaimed; start a new room. |
| Everything works locally, nothing online after deploy | `supabase db push` not run, or run against the wrong project (`supabase link` again). |

## Stale rooms: what happens
Lobby idle > 2 h → abandoned. Active/Tahkim idle > 24 h → abandoned. Finished/abandoned > 7 days → deleted with all its rows. Runs hourly if pg_cron is enabled; otherwise call `select public.eas_cleanup_stale_games();` from the SQL editor now and then (or never: it only saves space).
Anonymous auth users are not deleted by this; Supabase documents periodic cleanup of old anonymous users.
