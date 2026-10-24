# Online architecture

```
  Browser A ──┐                                                   ┌── Browser B
   UI (existing)                                                  │   UI (existing)
   js/online/session.js  (adapter: renders snapshots, sends actions)
        │  action (JSON)                       ▲ snapshot (JSON, caller's view only)
        ▼                                      │
  ┌──────────────────────── Edge Function eas-game (service role, Deno) ────────────────────────┐
  │ service.js  load state → engine.js (pure rules) → patch → store.commit → snapshot.js        │
  │ shares js/rules.js · js/wordpolicy.js · js/validator.js · dictionary/*  with the local game │
  └───────────────────────────────┬─────────────────────────────────────────────────────────────┘
                                  ▼  commit_action() — one SQL transaction, row lock, revision compare-and-set
                         Postgres (RLS on)  ──trigger──▶  realtime.send('game:<id>', {revision,status,event})
                                                                   │ private Broadcast channel
                              Browser A ◀────────── notification ──┴────────▶ Browser B   (then: fetch snapshot)
```
`DATABASE = truth, REALTIME = notification.` A missed event never corrupts a client: the next action, the next event, a tab becoming visible, a reconnect or the 12 s safety poll all fetch an authoritative snapshot.

## State split
| Class | What | Stored in | Who can read |
|---|---|---|---|
| Public | board, scores, whose turn, tile **counts**, bag **size**, clock fields, Tahkim state, move history, rules, revision, result | `games`, `game_players`, `game_moves` | the two players (RLS + snapshot) |
| Private | each player's rack (7 slots, tile ids + letters) | `player_racks` | its owner only (RLS `player_id = auth.uid()`; snapshot includes only the caller's rack) |
| Server-only | tile bag (order = the future), pre-move undo snapshot for Tahkim, idempotency keys | `game_private`, `game_actions` | nobody except the Edge Function (RLS on, no policies, no grants) |

`snapshot.js` is the only function that turns server state into client data. Tests assert that a player's snapshot/responses contain none of the opponent's tile ids and none of the bag's.
Every physical tile has a random opaque id (`idFactory`), not a letter or a sequence number, and moves are submitted as tile ids: a client cannot invent a tile, play the opponent's tile, or draw from the bag.

## Authoritative actions (`engine.js`, all pure; `service.js` does the I/O)
`create_room, join_room, set_ready, update_settings, leave_room, start_game, submit_move, pass_turn, swap_tiles, request_tahkim, cancel_tahkim, resolve_tahkim, resign_game, claim_timeout, rematch, snapshot, reconnect`.
`submit_move` is the only way to score. The server: checks membership, status, turn and revision → maps tile ids to the caller's rack → checks cells and blank letters → `analyzeMove` (shared geometry/connection rules) → words → validator policy → `scoreWords` (shared) → removes tiles, refills from the bag, updates scores, history and clock → one atomic commit. Anything extra in the payload (score, rack, status…) is ignored.

## Revision and idempotency
* `games.revision` starts at 1 and is bumped exactly once per committed action (inside `commit_action`, which holds the game row lock).
* Gameplay actions carry `base_revision`; a mismatch → `STALE_STATE` + the fresh snapshot (client re-syncs, keeps its unsent tile preview if still valid).
* Every mutation carries `client_action_id` (UUID). `game_actions(game_id, client_action_id)` is checked first and again under the lock; a replay answers with the current state and changes nothing. The client reuses the same id when it retries after a network failure.
* Presence/reconnect never bump the revision (they are not game state), so they cannot make a pending action stale.

## Realtime
Private channel `game:<game id>`; policies on `realtime.messages` allow only members to receive and to track presence; clients cannot publish. Events (from `games.last_event`): `PLAYER_JOINED, PLAYER_LEFT, PLAYER_READY, SETTINGS_UPDATED, GAME_STARTED, MOVE_COMMITTED, PASS_COMMITTED, SWAP_COMMITTED, TAHKIM_REQUESTED, TAHKIM_RESOLVED, GAME_ENDED, REMATCH_REQUESTED`. All carry only `{revision,status,event}`. `MOVE_REJECTED` is the synchronous `ok:false` answer to the sender (a rejection is not public). Presence marks who is connected ("● متصل" / "○ غير متصل").
Client network states: `CONNECTING, CONNECTED, RECONNECTING, OFFLINE, SYNCING`.

## Timer
No browser counter is authoritative. `players.ms_left` is the time left when the clock was last settled; `games.turn_started_at` / `turn_deadline_at` are server timestamps. The page shows `ms_left − (serverNow − turn_started_at)` where `serverNow = Date.now() + (snapshot.server_now − Date.now() at fetch)` (clock-skew correction), so a reload reconstructs it exactly. Same rules as local play: the clock starts after the first scored move; thinking time is charged to the player on turn; the clock stops while Tahkim is pending. Time-out is decided by the server: any action after the deadline ends the game (`TIME_UP`), and either page may send `claim_timeout`, which the server only honours if its own clock agrees.

## Validator flow
```
submit_move → words → evaluateMove(policy = auto | tahkim | off, mode)   (js/wordpolicy.js, same code as local play)
   valid        → accepted, stored validation_result = valid
   invalid      → rejected (auto): nothing changes
   uncertain    → accepted provisionally, words marked ؟, stored = uncertain  → Tahkim can settle it
   unavailable  → dictionary unusable: accepted, words marked ؟ "تعذّر التحقق", stored = unavailable → Tahkim
   skipped      → policy off
```
The dictionary (2.9 MB gz + lexicon) is loaded once per warm function instance from `ASSET_BASE_URL`, in the background; a move waits at most 6 s for it, then reports *unavailable*, never *verified*. Without the word bank, "not in lexicon" is provisional rather than invalid (both online and local). Nothing large travels between players.

## Tahkim
`none → pending → resolved_valid | resolved_invalid → none` (next committed action). Status becomes `tahkim_pending`, which blocks every other action (`TAHKIM_PENDING`) and stops the clock. The challenger is the player on turn (as in the local game); the **resolver** is stored in `tahkim.resolver_seat`, today equal to the challenger. A referee/teacher role later means: a role column in `game_players`, a nullable seat, and `resolver_seat` pointing at that player; no state-machine change.
`valid` → challenger pays `min(5, score)`, the move stands. `invalid` → board, racks, bag and scores are restored from `game_private.undo` (clocks kept), the mover loses the turn.

## Reconnection and refresh
The anonymous Supabase session persists in the browser. On load the page calls `reconnect` (no game id needed): the server finds the player's open game and returns board, scores, own rack, turn, deadline, Tahkim state, history and revision; the page re-subscribes. Matches finished in the last 30 minutes can still be viewed; a finished match is not auto-resumed.

## Game end
Reasons: rack emptied, time, resignation. Settlement is `rules.settleEnd` (shared with local play): − tile values left on the rack, + 1 point per full minute left, floor 0; highest score wins, equal = tie. Passing is unlimited in this game, so (as locally) there is no pass-based ending. Rematch: both players ask → round + 1, brand-new bag/racks, fresh history, starting player alternates.

## Security model in one list
No service-role key in any browser file · RLS on every table, default deny · no client write grants · racks readable by owner only · bag/undo/idempotency unreachable · private realtime channels with membership policies · server computes legality, words, score, draws, turn, clock, winner · nickname is display text only (identity = Supabase user id) · error messages never carry SQL/stack · logs never carry racks, bag order, tokens.
Residual, accepted risks: no per-user rate limiting (use Supabase's built-in auth rate limits + CAPTCHA); a player can be disconnected indefinitely without forfeiting (their clock keeps running on their turn; the opponent can wait or resign); anonymous identity is lost if site data is cleared.
