-- EAS online multiplayer: schema, constraints, indexes.
--
-- State is split the way the design requires:
--   PUBLIC     games, game_players, game_moves      (readable by the two players of a game, via RLS)
--   PRIVATE    player_racks                          (readable by the rack's owner only)
--   SERVER     game_private (bag, undo snapshot), game_actions (idempotency)   (no client access at all)
-- Every write goes through the `eas-game` Edge Function (service role) and the commit_action() function below.

create extension if not exists pgcrypto;

create table public.games (
  id                  uuid primary key default gen_random_uuid(),
  room_code           text not null,
  host_player_id      uuid not null references auth.users (id) on delete cascade,
  status              text not null default 'lobby'
                        check (status in ('lobby','starting','active','tahkim_pending','finished','abandoned')),
  tile_mode           text not null default 'expanded' check (tile_mode in ('expanded','basic')),
  validator_mode      text not null default 'auto'     check (validator_mode in ('auto','tahkim','off')),
  minutes             integer not null default 25      check (minutes between 1 and 180),   -- clock per player
  round               integer not null default 1       check (round >= 1),
  revision            bigint  not null default 1,                                            -- +1 on every committed action
  current_seat        smallint check (current_seat in (0,1)),
  current_player_id   uuid,
  board               jsonb   not null default '[]'::jsonb,                                  -- 15x15 of public tile objects or null
  clock_started       boolean not null default false,                                        -- the clock starts after the first scored move
  turn_started_at     timestamptz,                                                           -- null while the clock is not running
  turn_deadline_at    timestamptz,
  tahkim              jsonb   not null default '{"state":"none"}'::jsonb,                    -- none | pending | resolved_valid | resolved_invalid
  tahkim_available    boolean not null default false,
  bag_count           integer not null default 0,                                            -- the SIZE of the bag is public, its content never
  rematch_seats       smallint[] not null default '{}',
  winner_player_id    uuid,
  winner_seat         smallint,
  result              jsonb,                                                                 -- { reason, lines:[{seat,score,ded,bon}], winner_seat }
  last_event          text,
  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  finished_at         timestamptz,
  updated_at          timestamptz not null default now()
);
create unique index games_room_code_key on public.games (upper(room_code));
alter table public.games add constraint games_room_code_format check (room_code ~ '^[A-HJ-NP-Z2-9]{6}$');
create index games_host_idx on public.games (host_player_id);
create index games_status_updated_idx on public.games (status, updated_at);

create table public.game_players (
  id               uuid primary key default gen_random_uuid(),
  game_id          uuid not null references public.games (id) on delete cascade,
  player_id        uuid not null references auth.users (id) on delete cascade,
  seat             smallint not null check (seat in (0,1)),   -- a future referee would get a role column and a nullable seat
  nickname         text not null check (char_length(nickname) between 1 and 40),   -- display data only, never identity
  score            integer not null default 0,
  tile_count       smallint not null default 0 check (tile_count between 0 and 7),
  ms_left          bigint not null default 0,
  ready            boolean not null default false,
  connection_state text not null default 'online' check (connection_state in ('online','offline')),
  last_seen_at     timestamptz not null default now(),
  joined_at        timestamptz not null default now(),
  unique (game_id, seat),
  unique (game_id, player_id)
);
create index game_players_player_idx on public.game_players (player_id, game_id);

create table public.game_moves (
  id                bigint generated always as identity primary key,
  game_id           uuid not null references public.games (id) on delete cascade,
  round             integer not null default 1,
  player_id         uuid not null,
  seat              smallint not null,
  turn_number       integer not null,
  action_type       text not null check (action_type in ('move','pass','swap')),
  placements        jsonb not null default '[]'::jsonb,
  formed_words      jsonb not null default '[]'::jsonb,
  score_delta       integer not null default 0,
  validation_result text not null default 'skipped' check (validation_result in ('valid','uncertain','unavailable','skipped')),
  bingo             boolean not null default false,
  swap_count        smallint not null default 0,
  tahkim_status     text check (tahkim_status in ('ok','void')),
  penalty           integer not null default 0,
  revision          bigint not null,
  created_at        timestamptz not null default now(),
  unique (game_id, round, turn_number)
);
create index game_moves_game_idx on public.game_moves (game_id, round, turn_number);

-- PRIVATE: one rack per player. Array of 7 slots: a tile object or null.
create table public.player_racks (
  game_id    uuid not null references public.games (id) on delete cascade,
  player_id  uuid not null references auth.users (id) on delete cascade,
  tiles      jsonb not null default '[]'::jsonb,
  primary key (game_id, player_id)
);

-- SERVER ONLY: the bag (its order is the future of the game) and the pre-move snapshot Tahkim may need to restore.
create table public.game_private (
  game_id  uuid primary key references public.games (id) on delete cascade,
  bag      jsonb not null default '[]'::jsonb,
  undo     jsonb
);

-- SERVER ONLY: idempotency keys. A retried action finds its earlier result here and is not applied twice.
create table public.game_actions (
  game_id            uuid not null references public.games (id) on delete cascade,
  client_action_id   uuid not null,
  player_id          uuid not null,
  result             jsonb,
  created_at         timestamptz not null default now(),
  primary key (game_id, client_action_id)
);
