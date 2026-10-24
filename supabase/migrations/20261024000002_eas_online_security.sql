-- Row Level Security. Default is DENY: RLS is on for every table, and only the policies below open anything.
-- The service role (Edge Function only) bypasses RLS; it is never present in the browser.

alter table public.games        enable row level security;
alter table public.game_players enable row level security;
alter table public.game_moves   enable row level security;
alter table public.player_racks enable row level security;
alter table public.game_private enable row level security;
alter table public.game_actions enable row level security;

-- No client may ever write: all mutations are authoritative and go through the Edge Function.
revoke all on public.games, public.game_players, public.game_moves, public.player_racks, public.game_private, public.game_actions from anon, authenticated;
grant select on public.games, public.game_players, public.game_moves, public.player_racks to authenticated;

-- membership test that does not recurse into game_players' own policy
create or replace function public.eas_is_member(p_game_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.game_players gp where gp.game_id = p_game_id and gp.player_id = (select auth.uid()));
$$;
revoke all on function public.eas_is_member(uuid) from public, anon;
grant execute on function public.eas_is_member(uuid) to authenticated;

create policy "members read their game"    on public.games        for select to authenticated using (public.eas_is_member(id));
create policy "members read game players"  on public.game_players for select to authenticated using (public.eas_is_member(game_id));
create policy "members read game moves"    on public.game_moves   for select to authenticated using (public.eas_is_member(game_id));
-- A rack is readable by its OWNER only. The opponent's row is invisible to the anon/authenticated key.
create policy "owner reads own rack"       on public.player_racks for select to authenticated using (player_id = (select auth.uid()));
-- game_private and game_actions: RLS on, no policy, no grant -> unreachable for every client role.

-- Realtime (Broadcast + Presence on PRIVATE channels named  game:<game id>).
-- Only members of that game may join the channel or track presence; nobody can publish arbitrary broadcasts (the server does, via realtime.send).
create policy "members receive game channel" on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'game:%'
    and public.eas_is_member(((regexp_match((select realtime.topic()), '^game:([0-9a-f-]{36})$'))[1])::uuid)
  );
create policy "members track presence" on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and (select realtime.topic()) like 'game:%'
    and public.eas_is_member(((regexp_match((select realtime.topic()), '^game:([0-9a-f-]{36})$'))[1])::uuid)
  );
