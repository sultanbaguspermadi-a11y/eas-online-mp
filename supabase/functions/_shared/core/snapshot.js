// What a player is allowed to see. This is the ONLY place server state becomes client-visible data, so the privacy rules are
// enforced here once: the board, scores, tile COUNTS, clock, Tahkim state and move history are public; the caller's own rack is
// included; the opponent's rack, the bag (only its size) and the undo snapshot are never included.
import { STATUS, clockRunning, seatOf, playerBySeat } from './engine.js';
import { fail } from './errors.js';

export function historyItem(m) {
  const it = { n: m.turn_number, p: m.seat, type: m.action_type, words: m.formed_words || [], total: m.score_delta, bingo: !!m.bingo };
  if (m.action_type === 'swap') it.cnt = m.swap_count;
  if (m.tahkim_status) it.st = m.tahkim_status;
  if (m.penalty) it.pen = m.penalty;
  return it;
}

export function buildSnapshot(w, userId, now) {
  const seat = seatOf(w, userId);
  if (seat < 0) fail('NOT_MEMBER');
  const g = w.game, me = playerBySeat(w, seat);
  return {
    server_now: now,
    game: {
      id: g.id, room_code: g.room_code, host_player_id: g.host_player_id, status: g.status, tile_mode: g.tile_mode, validator_mode: g.validator_mode, minutes: g.minutes,
      round: g.round, revision: g.revision, current_seat: g.current_seat, turn_started_at: g.turn_started_at, turn_deadline_at: g.turn_deadline_at, clock_running: clockRunning(g),
      clock_started: g.clock_started, tahkim: g.tahkim, tahkim_available: !!g.tahkim_available, bag_count: g.bag_count, result: g.result, winner_seat: g.winner_seat,
      rematch_seats: g.rematch_seats || [], started_at: g.started_at, finished_at: g.finished_at
    },
    players: [...w.players].sort((a, b) => a.seat - b.seat).map(p => ({ player_id: p.player_id, seat: p.seat, nickname: p.nickname, score: p.score, tile_count: p.tile_count,
      ms_left: p.ms_left, ready: p.ready, connection_state: p.connection_state })),
    board: g.board,
    moves: w.moves.map(historyItem),
    me: { player_id: userId, seat, rack: w.racks[me.player_id] || [] }
  };
}
