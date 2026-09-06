import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

export type AdminUser = { id:string; username:string; role:'player'|'admin'; isSuspended:boolean; score:number; wins:number; losses:number; matchesPlayed:number; createdAt:string };

function mapUser(r:any): AdminUser { return {id:r.id,username:r.username,role:r.role,isSuspended:Boolean(r.is_suspended),score:r.score,wins:r.wins,losses:r.losses,matchesPlayed:r.matches_played,createdAt:r.created_at}; }

export function bootstrapAdmin(db: Database.Database) {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME?.trim();
  if (!username) return;
  db.prepare(`INSERT INTO user_admin(user_id,role) SELECT id,'admin' FROM users WHERE username=? COLLATE NOCASE ON CONFLICT(user_id) DO UPDATE SET role='admin',updated_at=CURRENT_TIMESTAMP`).run(username);
}

export function adminDashboard(db: Database.Database) {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get() as any;
  const admins = db.prepare("SELECT COUNT(*) AS n FROM user_admin WHERE role='admin'").get() as any;
  const suspended = db.prepare('SELECT COUNT(*) AS n FROM user_admin WHERE is_suspended=1').get() as any;
  const matches = db.prepare('SELECT COUNT(*) AS n FROM matches').get() as any;
  const activeMatches = db.prepare("SELECT COUNT(*) AS n FROM matches WHERE status='playing'").get() as any;
  const finished = db.prepare("SELECT COUNT(*) AS n FROM matches WHERE status='finished'").get() as any;
  const events = db.prepare('SELECT COUNT(*) AS n FROM match_events').get() as any;
  return {users:users.n,admins:admins.n,suspended:suspended.n,matches:matches.n,activeMatches:activeMatches.n,finishedMatches:finished.n,events:events.n};
}

export function adminUsers(db: Database.Database, page=1, pageSize=25, query='') {
  const p=Math.max(1,Math.floor(page)); const size=Math.min(100,Math.max(1,Math.floor(pageSize))); const offset=(p-1)*size; const q=query.trim();
  const where=q?'WHERE username LIKE ? COLLATE NOCASE':''; const args=q?[`%${q}%`]:[];
  const total=(db.prepare(`SELECT COUNT(*) AS n FROM users ${where}`).get(...args) as any).n;
  const rows=db.prepare(`SELECT u.id,u.username,COALESCE(a.role,'player') AS role,COALESCE(a.is_suspended,0) AS is_suspended,u.score,u.wins,u.losses,u.matches_played,u.created_at FROM users u LEFT JOIN user_admin a ON a.user_id=u.id ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args,size,offset).map(mapUser);
  return {rows,page:p,pageSize:size,total,totalPages:Math.ceil(total/size)};
}

export function setUserSuspended(db: Database.Database, adminId:string, userId:string, suspended:boolean) {
  if (adminId===userId && suspended) throw new Error('CANNOT_SUSPEND_SELF');
  const row=db.prepare(`SELECT u.id,u.username,COALESCE(a.role,'player') AS role FROM users u LEFT JOIN user_admin a ON a.user_id=u.id WHERE u.id=?`).get(userId) as any;
  if(!row) throw new Error('USER_NOT_FOUND');
  db.prepare(`INSERT INTO user_admin(user_id,is_suspended) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET is_suspended=excluded.is_suspended,updated_at=CURRENT_TIMESTAMP`).run(userId,suspended?1:0);
  db.prepare('INSERT INTO admin_audit_log (id,admin_user_id,action,target_user_id,payload_json) VALUES (?,?,?,?,?)').run(crypto.randomUUID(),adminId,suspended?'user.suspend':'user.unsuspend',userId,JSON.stringify({username:row.username}));
  return {ok:true,userId,suspended};
}

export function setUserRole(db: Database.Database, adminId:string, userId:string, role:'player'|'admin') {
  if (adminId===userId && role==='player') throw new Error('CANNOT_REMOVE_OWN_ADMIN');
  const row=db.prepare(`SELECT u.id,u.username,COALESCE(a.role,'player') AS role FROM users u LEFT JOIN user_admin a ON a.user_id=u.id WHERE u.id=?`).get(userId) as any;
  if(!row) throw new Error('USER_NOT_FOUND');
  if(row.role===role) return {ok:true,userId,role};
  db.prepare(`INSERT INTO user_admin(user_id,role) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,updated_at=CURRENT_TIMESTAMP`).run(userId,role);
  db.prepare('INSERT INTO admin_audit_log (id,admin_user_id,action,target_user_id,payload_json) VALUES (?,?,?,?,?)').run(crypto.randomUUID(),adminId,'user.role_change',userId,JSON.stringify({from:row.role,to:role,username:row.username}));
  return {ok:true,userId,role};
}

export function adminMatches(db: Database.Database, page=1, pageSize=25) {
  const p=Math.max(1,Math.floor(page)); const size=Math.min(100,Math.max(1,Math.floor(pageSize))); const offset=(p-1)*size;
  const total=(db.prepare('SELECT COUNT(*) AS n FROM matches').get() as any).n;
  const rows=db.prepare(`SELECT m.id,m.status,m.created_at AS createdAt,m.finished_at AS finishedAt,m.winner_user_id AS winnerUserId,
    (SELECT COUNT(*) FROM match_players mp WHERE mp.match_id=m.id) AS playerCount
    FROM matches m ORDER BY m.created_at DESC LIMIT ? OFFSET ?`).all(size,offset);
  return {rows,page:p,pageSize:size,total,totalPages:Math.ceil(total/size)};
}

export function adminMatchDetails(db: Database.Database, matchId:string) {
  const match=db.prepare('SELECT id,status,created_at AS createdAt,finished_at AS finishedAt,winner_user_id AS winnerUserId FROM matches WHERE id=?').get(matchId) as any;
  if(!match) return null;
  const players=db.prepare(`SELECT mp.user_id AS userId,u.username,mp.rank,mp.score_earned AS scoreEarned,mp.cards_remaining AS cardsRemaining,mp.warnings,mp.reds,mp.number_sum AS numberSum
    FROM match_players mp JOIN users u ON u.id=mp.user_id WHERE mp.match_id=? ORDER BY COALESCE(mp.rank,999),u.username`).all(matchId);
  const events=db.prepare(`SELECT id,event_type AS eventType,actor_user_id AS actorUserId,payload_json AS payloadJson,created_at AS createdAt FROM match_events WHERE match_id=? ORDER BY id DESC LIMIT 200`).all(matchId);
  return {match,players,events};
}

export function adminAuditLog(db: Database.Database, page=1, pageSize=50) {
  const p=Math.max(1,Math.floor(page)); const size=Math.min(100,Math.max(1,Math.floor(pageSize))); const offset=(p-1)*size;
  const total=(db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get() as any).n;
  const rows=db.prepare(`SELECT a.id,a.action,a.target_user_id AS targetUserId,u.username AS adminUsername,a.payload_json AS payloadJson,a.created_at AS createdAt
    FROM admin_audit_log a JOIN users u ON u.id=a.admin_user_id ORDER BY a.created_at DESC LIMIT ? OFFSET ?`).all(size,offset);
  return {rows,page:p,pageSize:size,total,totalPages:Math.ceil(total/size)};
}
