# Online multiplayer: implementation report

## What was changed
**New**
| Path | Purpose |
|---|---|
| `js/rules.js` | pure shared rules: `analyzeMove`, `scoreWords`, `makeTileSet`, `settleEnd`, `challengePenalty` (extracted unchanged from `scoring.js`/`game.js`/`state.js`) |
| `js/wordpolicy.js` | pure shared "what a validator result means" (`evaluateMove`), incl. the explicit *unavailable/unverified* state |
| `js/online/{session,lobby,supabase-backend,env}.js`, `css/online.css` | online adapter, lobby UI, the only Supabase-touching file, public config |
| `supabase/migrations/*.sql` | schema, RLS, realtime policies, `commit_action`, `create_game_tx`, announce trigger, cleanup |
| `supabase/functions/eas-game/{index,store}.ts` | Edge Function glue (auth, CORS, dictionary loading, Supabase store) |
| `supabase/functions/_shared/core/*.js` | pure server core: `engine` (transitions), `service` (request handling), `snapshot` (the privacy boundary), `codes`, `errors` |
| `supabase/functions/_shared/game/*` | generated mirror of `js/` modules (`tools/sync-edge-shared.mjs`) |
| `tools/write-env.mjs`, `vercel.json`, `.env.example` | Vercel build step writing public config |
| `tests/online/*` | 9 online suites (below) |
| `docs/ONLINE_*.md` | setup, architecture, this report |

**Changed (small hooks, local behaviour preserved):** `scoring.js` (now a thin wrapper over `rules.js`), `state.js` (`makeTileSet`, `playerName`, `bagCount`, `app.net`), `game.js` / `judge.js` / `input.js` / `ui.js` (an `if (app.net)` branch at the start of each action; hidden-rack rendering; names), `wordcheck.js` (uses `evaluateMove`), `cover.js` + `index.html` (LOCAL GAME / ONLINE GAME, lobby dialog, status bar), `main.js` (lazy online entry, resume), `config.js` (`resign` reason).

**Local behaviour that changed on purpose**
1. *Dictionary unavailable*: previously the move passed silently as if nothing was wrong; now its words are marked `؟` with "تعذّر التحقق" (issue #20). Test `validation-fallback.mjs` was updated to assert the new, honest behaviour.
2. *Dictionary loaded, bank not ready/failed*: "not in lexicon" is provisional instead of invalid (otherwise a legitimate bank word could be rejected). `validator.js` itself is unchanged; the decision is in `wordpolicy.js`.
3. Online only: no Undo (Tahkim replaces it); New game → Resign / Rematch; clock is the server's.

## Architecture / Security / Validator / Database
See `ONLINE_ARCHITECTURE.md` (state split, actions, revision, idempotency, realtime, timer, validator flow, Tahkim, reconnection, security list). Database: tables `games, game_players, game_moves, player_racks, game_private, game_actions`; functions `commit_action, create_game_tx, games_announce (trigger), eas_cleanup_stale_games, eas_is_member`; RLS default-deny with member/owner select policies and two `realtime.messages` policies.

## Testing: what was run, and the result
| Suite | What it covers | Result |
|---|---|---|
| `online/rooms.mjs` | create, join (case-insensitive), invalid/malformed codes, full, duplicate join, started, one-game-at-a-time, unauthorized start, settings, leaving | 39 / 39 |
| `online/game.mjs` | initial racks, hidden opponent rack & bag, modes, turns, legal/illegal moves, scoring, blanks, refill, tile conservation, pass, swap | 62 / 62 |
| `online/security.mjs` | fabricated / opponent / bag tile ids, fake score/status/turn payloads, stale/missing/future revision, duplicate action ids, strangers, injection, error hygiene, no rack in any response | 39 / 39 |
| `online/validator.mjs` | valid / invalid / uncertain → Tahkim (request, block, resolve valid/invalid, cancel, paused clock, restore exactness), policy off, basic mode — with the **real dictionary and bank** | 41 / 41 |
| `online/validator-unavailable.mjs`, `policy.mjs` | unavailable ⇒ "unverified", bank-missing policy | 13 / 13, 4 / 4 |
| `online/network.mjs` | refresh/reconnect test (§62), missed event → stale → resync, simultaneous submissions, same-id double submit, last-seat race, connection state vs revision | 33 / 33 |
| `online/endgame.mjs` | rack-out settlement, tie, server clock, late actions, accounting, resign, rematch (no state reuse) | 37 / 37 |
| `online/browser.mjs` | **two real Chromium browsers** against the real client + server core: lobby, live join, rules sync, hidden racks (DOM scan), move sync, refresh restore, turn discipline, network loss + idempotent retry, opponent-disconnect indicator, local game through the real UI, "not configured" path, 390 px phone, no console errors | 29 / 29 (repeated runs stable) |
| existing `logic/validator`, `grammar`, `bank`, `validate-dictionary` | validator regression | 81 / 39 / 42 passed, dictionary OK |

**Not run here, and why (be aware):**
* The existing jsdom suites (`engine`, `validation-flow`, `validation-fallback`, `startup`) and the puppeteer layout suites: `jsdom`/`puppeteer` could not be installed (no network). They exercise code I touched (`game.js`, `ui.js`, `input.js`, `state.js`, `wordcheck.js`). Run `cd tests && npm install && npm test` before merging and fix any regression there.
* **Nothing was executed against a real Supabase project or a real Deno runtime.** The SQL migrations were only reviewed by reading (no Postgres available); `store.ts`/`index.ts` were not run. The browser suite substitutes an HTTP + SSE bridge for Supabase (`tests/online/browser-server.mjs`), but the server logic it calls (`service.js`/`engine.js`) is the exact code the Edge Function runs, on an in-memory store that implements the same contract (revision compare-and-set, idempotency, unique seats). Expect to fix small integration slips on first deploy (see setup §12); the most likely spots: `jsonb_populate_record` with array/`null` JSON values in `commit_action`, `realtime.messages` policy syntax, supabase-js version pin (`2.49.4`) and private-channel behaviour.

## Known limitations
* Untested against live infrastructure (above).
* supabase-js is loaded from jsDelivr (pinned) on first use of online mode; vendor it under `js/online/vendor/` if you want zero third-party requests.
* Anonymous identity lives in browser storage: clearing site data forfeits the seat.
* No rate limiting beyond Supabase auth limits; enable CAPTCHA.
* A disconnected player is not forfeited automatically (by design, §32); their clock keeps running on their own turn.
* The Tahkim resolver is the challenger (the existing local concept); referee role is prepared in the data model only.
* The dictionary is fetched by the function over HTTP from `ASSET_BASE_URL` (cold start ≈ 1–3 s; moves in that window are "unverified").
* Passing is unlimited (existing rule), so a game can only end by emptied rack, time or resignation.
* Word-bank license still unconfirmed (TODO in README / docs).

## Deployment checklist (the owner must do)
1. Supabase: create project; enable **Anonymous sign-ins**; (recommended) CAPTCHA.
2. `supabase login && supabase link --project-ref REF && supabase db push`.
3. Realtime settings: **Allow public access OFF**.
4. `supabase secrets set ASSET_BASE_URL=https://easv4.vercel.app ALLOWED_ORIGIN=https://easv4.vercel.app && supabase functions deploy eas-game`.
5. Vercel: env `SUPABASE_URL`, `SUPABASE_ANON_KEY`; build command `node tools/write-env.mjs`; output `.`; redeploy.
6. Run `cd tests && npm install && npm test`; fix anything the jsdom/layout suites report.
7. Two-device test (setup §11).
