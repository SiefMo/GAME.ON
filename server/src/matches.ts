import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { GameState, RankingEntry } from '@game-on/shared';

export function createMatch(db: Database.Database, playerIds: string[]): string {
  const id = crypto.randomUUID();
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO matches (id,status) VALUES (?,?)').run(id, 'playing');
    const stmt = db.prepare('INSERT INTO match_players (match_id,user_id) VALUES (?,?)');
    for (const userId of playerIds) stmt.run(id, userId);
  });
  tx();
  return id;
}

export function finishMatch(db: Database.Database, matchId: string, state: GameState, ranking: RankingEntry[]): void {
  const finishedAt = new Date().toISOString();
  const winnerId = state.winnerIds[0] ?? null;
  const tx = db.transaction(() => {
    db.prepare('UPDATE matches SET status=?, finished_at=?, winner_user_id=? WHERE id=? AND status<>?')
      .run('finished', finishedAt, winnerId, matchId, 'finished');

    const updatePlayer = db.prepare(`UPDATE match_players SET rank=?, score_earned=?, cards_remaining=?, warnings=?, reds=?, number_sum=? WHERE match_id=? AND user_id=?`);
    const updateUser = db.prepare(`UPDATE users SET score=score+?, wins=wins+?, losses=losses+?, matches_played=matches_played+1 WHERE id=?`);
    const insertEvent = db.prepare(`INSERT INTO match_events (match_id,event_type,actor_user_id,payload_json,created_at) VALUES (?,?,?,?,?)`);

    const winners = new Set(state.winnerIds);
    for (const entry of ranking) {
      updatePlayer.run(entry.rank, entry.scoreEarned, entry.cardsRemaining, entry.warnings, entry.reds, entry.numberSum, matchId, entry.playerId);
      updateUser.run(entry.scoreEarned, winners.has(entry.playerId) ? 1 : 0, winners.has(entry.playerId) ? 0 : 1, entry.playerId);
    }
    const existing = new Set((db.prepare('SELECT event_type as type, actor_user_id as actorUserId, payload_json as payload, created_at as createdAt FROM match_events WHERE match_id=?').all(matchId) as any[]).map(e => `${e.type}|${e.actorUserId ?? ''}|${e.createdAt}`));
    for (const event of state.events) {
      const createdAt = new Date(event.timestamp).toISOString();
      const key = `${event.type}|${event.actorId ?? ''}|${createdAt}`;
      if (!existing.has(key)) insertEvent.run(matchId, event.type, event.actorId ?? null, JSON.stringify(event.data ?? {}), createdAt);
    }
  });
  tx();
}

export function getLeaderboard(db: Database.Database, page = 1, pageSize = 20) {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
  const offset = (safePage - 1) * safeSize;
  const total = (db.prepare('SELECT COUNT(*) as count FROM users').get() as {count:number}).count;
  const rows = db.prepare(`SELECT id, username, score, wins, matches_played as matchesPlayed,
    CASE WHEN matches_played=0 THEN 0 ELSE ROUND(wins*100.0/matches_played,1) END as winRate
    FROM users ORDER BY score DESC, wins DESC, matches_played DESC, username COLLATE NOCASE ASC LIMIT ? OFFSET ?`).all(safeSize, offset);
  return { page: safePage, pageSize: safeSize, total, totalPages: Math.max(1, Math.ceil(total / safeSize)), rows };
}

export function getMatchHistory(db: Database.Database, userId: string, page = 1, pageSize = 20) {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.min(50, Math.max(1, Math.floor(pageSize)));
  const offset = (safePage - 1) * safeSize;
  const total = (db.prepare('SELECT COUNT(*) as count FROM match_players WHERE user_id=?').get(userId) as {count:number}).count;
  const matches = db.prepare(`SELECT m.id, m.status, m.created_at as createdAt, m.finished_at as finishedAt,
      mp.rank, mp.score_earned as scoreEarned, mp.cards_remaining as cardsRemaining,
      mp.warnings, mp.reds, mp.number_sum as numberSum,
      GROUP_CONCAT(u.username, ', ') as players
    FROM match_players mp
    JOIN matches m ON m.id=mp.match_id
    JOIN match_players allp ON allp.match_id=m.id
    JOIN users u ON u.id=allp.user_id
    WHERE mp.user_id=?
    GROUP BY m.id, mp.rank, mp.score_earned, mp.cards_remaining, mp.warnings, mp.reds, mp.number_sum
    ORDER BY COALESCE(m.finished_at,m.created_at) DESC LIMIT ? OFFSET ?`).all(userId, safeSize, offset);
  return { page: safePage, pageSize: safeSize, total, totalPages: Math.max(1, Math.ceil(total / safeSize)), rows: matches };
}

export function getMatchDetails(db: Database.Database, matchId: string, userId: string) {
  const allowed = db.prepare('SELECT 1 FROM match_players WHERE match_id=? AND user_id=?').get(matchId, userId);
  if (!allowed) return null;
  const match = db.prepare(`SELECT id,status,created_at as createdAt,finished_at as finishedAt,winner_user_id as winnerUserId FROM matches WHERE id=?`).get(matchId);
  if (!match) return null;
  const players = db.prepare(`SELECT mp.user_id as userId,u.username,mp.rank,mp.score_earned as scoreEarned,mp.cards_remaining as cardsRemaining,mp.warnings,mp.reds,mp.number_sum as numberSum FROM match_players mp JOIN users u ON u.id=mp.user_id WHERE mp.match_id=? ORDER BY mp.rank ASC, u.username COLLATE NOCASE ASC`).all(matchId);
  const events = db.prepare(`SELECT id,event_type as type,actor_user_id as actorUserId,payload_json as payload,created_at as createdAt FROM match_events WHERE match_id=? ORDER BY id ASC`).all(matchId).map((e:any)=>({...e,payload:JSON.parse(e.payload)}));
  return { match, players, events };
}
