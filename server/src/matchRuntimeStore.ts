import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { GameState } from '@game-on/shared';

export type StoredRuntime = {
  matchId: string;
  roomCode: string;
  state: GameState;
  version: number;
  lastActivityAt: string;
  reconnectDeadlineAt?: string | null;
};

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function saveRuntime(db: Database.Database, input: StoredRuntime) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO match_runtime(match_id,room_code,state_json,version,last_activity_at,updated_at,reconnect_deadline_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(match_id) DO UPDATE SET room_code=excluded.room_code,state_json=excluded.state_json,version=excluded.version,
      last_activity_at=excluded.last_activity_at,updated_at=excluded.updated_at,reconnect_deadline_at=excluded.reconnect_deadline_at`)
    .run(input.matchId, input.roomCode, JSON.stringify(input.state), input.version, input.lastActivityAt, now, input.reconnectDeadlineAt ?? null);
}

export function loadActiveRuntimes(db: Database.Database, now = new Date()) {
  const rows = db.prepare(`SELECT mr.match_id as matchId,mr.room_code as roomCode,mr.state_json as stateJson,mr.version,
      mr.last_activity_at as lastActivityAt,mr.reconnect_deadline_at as reconnectDeadlineAt
    FROM match_runtime mr JOIN matches m ON m.id=mr.match_id WHERE m.status='playing'`).all() as any[];
  return rows.map(row => ({
    matchId: row.matchId,
    roomCode: row.roomCode,
    state: JSON.parse(row.stateJson) as GameState,
    version: row.version,
    lastActivityAt: row.lastActivityAt,
    reconnectDeadlineAt: row.reconnectDeadlineAt,
  })).filter(runtime => !runtime.reconnectDeadlineAt || new Date(runtime.reconnectDeadlineAt).getTime() > now.getTime()) as StoredRuntime[];
}

export function issueReconnectToken(db: Database.Database, matchId: string, userId: string, ttlMs: number) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + Math.max(1000, ttlMs));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM reconnect_tokens WHERE match_id=? AND user_id=?').run(matchId, userId);
    db.prepare(`INSERT INTO reconnect_tokens(id,match_id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)`)
      .run(id, matchId, userId, hashToken(raw), expires.toISOString(), now.toISOString());
  });
  tx();
  return raw;
}

export function validateReconnectToken(db: Database.Database, token: string, matchId: string, userId: string) {
  if (!token || token.length > 200) return false;
  const row = db.prepare(`SELECT id FROM reconnect_tokens WHERE token_hash=? AND match_id=? AND user_id=? AND expires_at>?`)
    .get(hashToken(token), matchId, userId, new Date().toISOString());
  return Boolean(row);
}

export function deleteMatchRuntime(db: Database.Database, matchId: string) {
  db.prepare('DELETE FROM match_runtime WHERE match_id=?').run(matchId);
  db.prepare('DELETE FROM reconnect_tokens WHERE match_id=?').run(matchId);
}
