// In-memory Store with the same contract (and the same atomicity rules) as supabase/functions/eas-game/store.ts + the commit_action SQL function.
// It lets the REAL server code (service.js / engine.js / snapshot.js) run in Node tests without a database.
// Tests (and only tests) may use the `peek*`/`poke*` helpers to look at or arrange server-only state.
const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const OPEN = ['lobby', 'starting', 'active', 'tahkim_pending'];

export class MemoryStore {
  constructor(clock = () => Date.now()) {
    this.clock = clock; this.games = new Map(); this.players = new Map(); this.racks = new Map(); this.privs = new Map();
    this.moves = new Map(); this.actions = new Map(); this.events = []; this.seq = 0; this.delay = null;
  }
  async findOpenGameId(userId, { includeFinished = false } = {}) {
    const rows = [];
    for (const [gid, ps] of this.players) {
      if (!ps.some(p => p.player_id === userId)) continue;
      const g = this.games.get(gid), open = OPEN.includes(g.status);
      if (open || (includeFinished && g.status === 'finished' && this.clock() - g.finished_at < 30 * 60000)) rows.push({ g, open });
    }
    rows.sort((a, b) => (b.open - a.open) || (b.g.created_at - a.g.created_at) || (b.g.seq - a.g.seq));
    return rows[0]?.g.id ?? null;
  }
  async getGameIdByCode(code) { for (const g of this.games.values()) if (g.room_code === code) return g.id; return null; }
  async load(gameId) {
    const g = this.games.get(gameId); if (!g) return null;
    return clone({ game: g, players: [...this.players.get(gameId)].sort((a, b) => a.seat - b.seat), racks: this.racks.get(gameId), priv: this.privs.get(gameId),
      moves: this.moves.get(gameId).filter(m => m.round === g.round) });
  }
  async getAction(gameId, actionId) { return clone(this.actions.get(gameId + '|' + actionId)) || null; }
  async createGame(game, player) {
    for (const g of this.games.values()) if (g.room_code === game.room_code) throw Object.assign(new Error('dup'), { code: 'ROOM_CODE_TAKEN' });
    this.games.set(game.id, { ...clone(game), seq: ++this.seq });
    this.players.set(game.id, [{ ...clone(player), joined_at: this.clock(), last_seen_at: this.clock() }]);
    this.racks.set(game.id, { [player.player_id]: [] }); this.privs.set(game.id, { bag: [], undo: null }); this.moves.set(game.id, []);
  }
  async touch(gameId, userId, state, now) { const p = this.players.get(gameId)?.find(x => x.player_id === userId); if (p) { p.connection_state = state; p.last_seen_at = now; } }
  async commit(gameId, expected, actionId, userId, patch, result) {
    if (this.delay) await this.delay();                    // lets tests interleave two requests before either commits
    // ---- from here on, no awaits: this block is the "transaction" ----
    const g = this.games.get(gameId); if (!g) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
    const key = gameId + '|' + actionId;
    if (actionId && this.actions.has(key)) return { duplicate: true, result: this.actions.get(key).result };
    if (g.revision !== expected) throw Object.assign(new Error('stale'), { code: 'STALE_REVISION' });
    const ps = this.players.get(gameId);
    if (patch.add_player) {
      if (ps.some(p => p.seat === patch.add_player.seat || p.player_id === patch.add_player.player_id)) throw Object.assign(new Error('seat'), { code: 'SEAT_TAKEN' });
      ps.push({ ...clone(patch.add_player), joined_at: this.clock(), last_seen_at: this.clock() }); this.racks.get(gameId)[patch.add_player.player_id] = [];
    }
    if (patch.remove_player) { this.players.set(gameId, ps.filter(p => p.player_id !== patch.remove_player)); delete this.racks.get(gameId)[patch.remove_player]; }
    Object.assign(g, clone(patch.game || {}), { revision: g.revision + 1, last_event: patch.event, updated_at: this.clock() });
    for (const up of patch.players || []) { const p = this.players.get(gameId).find(x => x.player_id === up.player_id); if (p) for (const k of ['score', 'tile_count', 'ms_left', 'ready']) if (up[k] !== undefined) p[k] = up[k]; }
    for (const r of patch.racks || []) this.racks.get(gameId)[r.player_id] = clone(r.tiles);
    if (patch.private) { const pv = this.privs.get(gameId); if ('bag' in patch.private) pv.bag = clone(patch.private.bag); if ('undo' in patch.private) pv.undo = clone(patch.private.undo); }
    if (patch.move) this.moves.get(gameId).push({ ...clone(patch.move), round: g.round, id: ++this.seq, revision: g.revision, created_at: this.clock() });
    if (patch.move_update) { const m = [...this.moves.get(gameId)].reverse().find(x => x.round === g.round && x.turn_number === patch.move_update.turn_number); if (m) { m.tahkim_status = patch.move_update.tahkim_status; m.penalty = patch.move_update.penalty; } }
    if (actionId) this.actions.set(key, { player_id: userId, result: clone(result) });
    this.events.push({ game_id: gameId, event: patch.event, revision: g.revision, status: g.status });
    return { revision: g.revision };
  }
  // ---- test-only access to server-private state ----
  peek(gameId) { return { game: this.games.get(gameId), players: this.players.get(gameId), racks: this.racks.get(gameId), priv: this.privs.get(gameId), moves: this.moves.get(gameId) }; }
}
