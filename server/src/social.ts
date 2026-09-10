import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

export type FriendStatus = 'pending' | 'accepted';

function ensureSettings(db: Database.Database, userId: string) {
  db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(userId);
}

function notify(db: Database.Database, userId: string, type: string, title: string, body: string, data?: unknown) {
  db.prepare('INSERT INTO notifications (id,user_id,type,title,body,data_json) VALUES (?,?,?,?,?,?)')
    .run(crypto.randomUUID(), userId, type, title, body, data ? JSON.stringify(data) : null);
}

export function searchUsers(db: Database.Database, userId: string, query: string) {
  const q = query.trim();
  if (!q) return { rows: [] };
  const rows = db.prepare(`
    SELECT id, username, score, wins, losses, matches_played AS matchesPlayed
    FROM users
    WHERE id <> ? AND username LIKE ? COLLATE NOCASE
    ORDER BY username COLLATE NOCASE ASC LIMIT 20
  `).all(userId, `%${q}%`) as any[];
  const relation = db.prepare(`
    SELECT requester_id, addressee_id, status FROM friendships
    WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)
  `);
  return { rows: rows.map(u => {
    const r = relation.get(userId, u.id, u.id, userId) as any;
    let friendship: FriendStatus | 'outgoing' | 'incoming' | null = null;
    if (r?.status === 'accepted') friendship = 'accepted';
    else if (r?.requester_id === userId) friendship = 'outgoing';
    else if (r) friendship = 'incoming';
    return { ...u, friendship };
  }) };
}

export function listFriends(db: Database.Database, userId: string) {
  const accepted = db.prepare(`
    SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END AS userId
    FROM friendships WHERE status='accepted' AND (requester_id=? OR addressee_id=?)
    ORDER BY updated_at DESC
  `).all(userId, userId, userId) as any[];
  const users = accepted.map(r => db.prepare('SELECT id,username,score,wins,losses,matches_played AS matchesPlayed FROM users WHERE id=?').get(r.userId));
  const incoming = db.prepare(`
    SELECT f.id, f.requester_id AS userId, u.username, f.created_at AS createdAt
    FROM friendships f JOIN users u ON u.id=f.requester_id
    WHERE f.addressee_id=? AND f.status='pending' ORDER BY f.created_at DESC
  `).all(userId) as any[];
  const outgoing = db.prepare(`
    SELECT f.id, f.addressee_id AS userId, u.username, f.created_at AS createdAt
    FROM friendships f JOIN users u ON u.id=f.addressee_id
    WHERE f.requester_id=? AND f.status='pending' ORDER BY f.created_at DESC
  `).all(userId) as any[];
  return { friends: users, incoming, outgoing };
}

export function sendFriendRequest(db: Database.Database, requesterId: string, username: string) {
  const target = db.prepare('SELECT id,username FROM users WHERE username=? COLLATE NOCASE').get(username.trim()) as any;
  if (!target) throw new Error('USER_NOT_FOUND');
  if (target.id === requesterId) throw new Error('CANNOT_ADD_SELF');
  const existing = db.prepare(`SELECT * FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)`).get(requesterId,target.id,target.id,requesterId) as any;
  if (existing?.status === 'accepted') throw new Error('ALREADY_FRIENDS');
  if (existing?.requester_id === target.id && existing.status === 'pending') {
    db.prepare('UPDATE friendships SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run('accepted', existing.id);
    notify(db, target.id, 'friend_accepted', 'Friend request accepted', 'You are now friends.', { userId: requesterId });
    notify(db, requesterId, 'friend_accepted', 'Friend request accepted', `${target.username} accepted your request.`, { userId: target.id });
    return { status: 'accepted' as const };
  }
  if (existing) throw new Error('REQUEST_ALREADY_SENT');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO friendships (id,requester_id,addressee_id,status) VALUES (?,?,?,?)').run(id, requesterId, target.id, 'pending');
  const sender = db.prepare('SELECT username FROM users WHERE id=?').get(requesterId) as any;
  notify(db, target.id, 'friend_request', 'New friend request', `${sender?.username || 'A player'} wants to be your friend.`, { friendshipId: id, userId: requesterId });
  return { status: 'pending' as const };
}

export function respondFriendRequest(db: Database.Database, userId: string, friendshipId: string, accept: boolean) {
  const row = db.prepare('SELECT * FROM friendships WHERE id=? AND addressee_id=? AND status=\'pending\'').get(friendshipId,userId) as any;
  if (!row) throw new Error('REQUEST_NOT_FOUND');
  if (!accept) { db.prepare('DELETE FROM friendships WHERE id=?').run(friendshipId); return { status: 'declined' as const }; }
  db.prepare('UPDATE friendships SET status=\'accepted\', updated_at=CURRENT_TIMESTAMP WHERE id=?').run(friendshipId);
  const accepter = db.prepare('SELECT username FROM users WHERE id=?').get(userId) as any;
  notify(db, row.requester_id, 'friend_accepted', 'Friend request accepted', `${accepter.username} accepted your request.`, { userId });
  return { status: 'accepted' as const };
}

export function removeFriend(db: Database.Database, userId: string, friendId: string) {
  const result = db.prepare(`DELETE FROM friendships WHERE status='accepted' AND ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))`).run(userId,friendId,friendId,userId);
  if (!result.changes) throw new Error('FRIEND_NOT_FOUND');
  return { ok: true };
}

export function listNotifications(db: Database.Database, userId: string, limit = 30) {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
  return { rows: db.prepare(`SELECT id,type,title,body,data_json AS dataJson,read_at AS readAt,created_at AS createdAt FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ${safeLimit}`).all(userId) };
}

export function markNotificationRead(db: Database.Database, userId: string, id: string) {
  const result = db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE id=? AND user_id=?').run(id,userId);
  if (!result.changes) throw new Error('NOTIFICATION_NOT_FOUND');
  return { ok: true };
}

export function markAllNotificationsRead(db: Database.Database, userId: string) {
  db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE user_id=?').run(userId);
  return { ok: true };
}

export function getSettings(db: Database.Database, userId: string) {
  ensureSettings(db,userId);
  const r = db.prepare('SELECT audio_enabled AS audioEnabled,sfx_volume AS sfxVolume,animations_enabled AS animationsEnabled,notifications_enabled AS notificationsEnabled FROM user_settings WHERE user_id=?').get(userId) as any;
  return r;
}

export function updateSettings(db: Database.Database, userId: string, patch: {audioEnabled?:boolean;sfxVolume?:number;animationsEnabled?:boolean;notificationsEnabled?:boolean}) {
  ensureSettings(db,userId);
  const current = getSettings(db,userId);
  const next = {
    audioEnabled: patch.audioEnabled ?? Boolean(current.audioEnabled),
    sfxVolume: patch.sfxVolume ?? Number(current.sfxVolume),
    animationsEnabled: patch.animationsEnabled ?? Boolean(current.animationsEnabled),
    notificationsEnabled: patch.notificationsEnabled ?? Boolean(current.notificationsEnabled),
  };
  if (next.sfxVolume < 0 || next.sfxVolume > 1) throw new Error('INVALID_VOLUME');
  db.prepare(`UPDATE user_settings SET audio_enabled=?,sfx_volume=?,animations_enabled=?,notifications_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?`).run(next.audioEnabled?1:0,next.sfxVolume,next.animationsEnabled?1:0,next.notificationsEnabled?1:0,userId);
  return next;
}
