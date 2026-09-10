import { describe, expect, it } from 'vitest';
import { adminDashboard, adminUsers, setUserRole, setUserSuspended } from './admin.js';
import Database from 'better-sqlite3';

describe('admin controls', () => {
  it('requires server-side role state for privileged mutations', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE,password_hash TEXT,score INTEGER DEFAULT 0,wins INTEGER DEFAULT 0,losses INTEGER DEFAULT 0,matches_played INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE user_admin(user_id TEXT PRIMARY KEY,role TEXT NOT NULL DEFAULT 'player',is_suspended INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE admin_audit_log(id TEXT PRIMARY KEY,admin_user_id TEXT,action TEXT,target_user_id TEXT,payload_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE matches(id TEXT PRIMARY KEY,status TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT,winner_user_id TEXT);
      CREATE TABLE match_players(match_id TEXT,user_id TEXT);
      CREATE TABLE match_events(id INTEGER PRIMARY KEY,match_id TEXT,event_type TEXT,actor_user_id TEXT,payload_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
    db.prepare('INSERT INTO users(id,username,password_hash) VALUES (?,?,?)').run('a','admin','x');
    db.prepare('INSERT INTO users(id,username,password_hash) VALUES (?,?,?)').run('b','bob','x');
    db.prepare("INSERT INTO user_admin(user_id,role) VALUES ('a','admin')").run();
    expect(adminDashboard(db).admins).toBe(1);
    expect(setUserRole(db,'a','b','admin').role).toBe('admin');
    expect(setUserSuspended(db,'a','b',true).suspended).toBe(true);
    expect(adminUsers(db).rows.find((u:any)=>u.id==='b').isSuspended).toBe(true);
    expect(()=>setUserRole(db,'a','a','player')).toThrow('CANNOT_REMOVE_OWN_ADMIN');
    db.close();
  });
});
