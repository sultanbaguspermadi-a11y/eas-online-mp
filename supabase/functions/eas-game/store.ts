// Production Store: Supabase Postgres through the service-role client. It only maps rows <-> the plain objects the pure core uses
// (timestamps become epoch milliseconds there) and calls the transactional SQL functions. No game rule lives here.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const TS_GAME = ['turn_started_at', 'turn_deadline_at', 'started_at', 'finished_at', 'created_at'] as const;
const toMs = (v: any) => (v == null ? null : new Date(v).getTime());
const toIso = (v: any) => (v == null ? null : new Date(v).toISOString());
const OPEN = ['lobby', 'starting', 'active', 'tahkim_pending'];

function gameFromRow(r: any) { const g = { ...r }; for (const k of TS_GAME) g[k] = toMs(g[k]); delete g.updated_at; return g; }
function gameToDb(g: any) { const o = { ...g }; for (const k of TS_GAME) if (k in o) o[k] = toIso(o[k]); return o; }

export class SupabaseStore {
  constructor(private db: SupabaseClient) {}

  private async one<T = any>(q: PromiseLike<{ data: T | null; error: any }>): Promise<T | null> {
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }

  async findOpenGameId(userId: string, opts: { includeFinished?: boolean } = {}) {
    const { data, error } = await this.db.from('game_players').select('game_id, games!inner(id, status, created_at, finished_at)').eq('player_id', userId);
    if (error) throw new Error(error.message);
    const now = Date.now();
    const rows = (data || []).map((r: any) => r.games).filter((g: any) => OPEN.includes(g.status) || (opts.includeFinished && g.status === 'finished' && g.finished_at && now - new Date(g.finished_at).getTime() < 30 * 60000));
    rows.sort((a: any, b: any) => (Number(OPEN.includes(b.status)) - Number(OPEN.includes(a.status))) || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    return rows[0]?.id ?? null;
  }
  async getGameIdByCode(code: string) {
    const g = await this.one(this.db.from('games').select('id').eq('room_code', code).maybeSingle());
    return g?.id ?? null;
  }
  async load(gameId: string) {
    const g: any = await this.one(this.db.from('games').select('*').eq('id', gameId).maybeSingle());
    if (!g) return null;
    const [players, racks, priv, moves] = await Promise.all([
      this.one<any[]>(this.db.from('game_players').select('*').eq('game_id', gameId).order('seat')),
      this.one<any[]>(this.db.from('player_racks').select('player_id, tiles').eq('game_id', gameId)),
      this.one<any>(this.db.from('game_private').select('bag, undo').eq('game_id', gameId).maybeSingle()),
      this.one<any[]>(this.db.from('game_moves').select('*').eq('game_id', gameId).eq('round', g.round).order('turn_number'))
    ]);
    return {
      game: gameFromRow(g),
      players: (players || []).map((p: any) => ({ ...p, last_seen_at: toMs(p.last_seen_at), joined_at: toMs(p.joined_at) })),
      racks: Object.fromEntries((racks || []).map((r: any) => [r.player_id, r.tiles])),
      priv: { bag: priv?.bag ?? [], undo: priv?.undo ?? null },
      moves: moves || []
    };
  }
  async getAction(gameId: string, actionId: string) {
    return await this.one(this.db.from('game_actions').select('player_id, result').eq('game_id', gameId).eq('client_action_id', actionId).maybeSingle());
  }
  async createGame(game: any, player: any) {
    const { error } = await this.db.rpc('create_game_tx', { p_game: gameToDb(game), p_player: player });
    if (error) { if (/ROOM_CODE_TAKEN/.test(error.message)) throw Object.assign(new Error('taken'), { code: 'ROOM_CODE_TAKEN' }); throw new Error(error.message); }
  }
  async commit(gameId: string, expectedRevision: number, actionId: string | null, userId: string, patch: any, result: any) {
    const p = { ...patch, game: gameToDb(patch.game || {}) };
    const { data, error } = await this.db.rpc('commit_action', { p_game_id: gameId, p_expected_revision: expectedRevision, p_client_action_id: actionId, p_player_id: userId, p_patch: p, p_result: result });
    if (error) {
      const m = String(error.message);
      if (m.includes('STALE_REVISION')) throw Object.assign(new Error('stale'), { code: 'STALE_REVISION' });
      if (m.includes('SEAT_TAKEN')) throw Object.assign(new Error('seat'), { code: 'SEAT_TAKEN' });
      throw new Error(m);
    }
    return data;
  }
  async touch(gameId: string, userId: string, state: string, now: number) {
    await this.db.from('game_players').update({ connection_state: state, last_seen_at: toIso(now) }).eq('game_id', gameId).eq('player_id', userId);
  }
}
