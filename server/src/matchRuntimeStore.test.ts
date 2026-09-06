import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { issueReconnectToken, validateReconnectToken, saveRuntime, loadActiveRuntimes, deleteMatchRuntime } from './matchRuntimeStore.js';

function makeDb(){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,password_hash TEXT,score INTEGER DEFAULT 0,wins INTEGER DEFAULT 0,losses INTEGER DEFAULT 0,matches_played INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE matches(id TEXT PRIMARY KEY,status TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT,winner_user_id TEXT);
  CREATE TABLE match_runtime(match_id TEXT PRIMARY KEY,room_code TEXT UNIQUE,state_json TEXT NOT NULL,version INTEGER NOT NULL,last_activity_at TEXT NOT NULL,updated_at TEXT NOT NULL,reconnect_deadline_at TEXT);
  CREATE TABLE reconnect_tokens(id TEXT PRIMARY KEY,match_id TEXT,user_id TEXT,token_hash TEXT UNIQUE,expires_at TEXT,created_at TEXT,UNIQUE(match_id,user_id));`);
  db.prepare('INSERT INTO users(id,username,password_hash) VALUES (?,?,?)').run('u1','A','x');
  db.prepare('INSERT INTO users(id,username,password_hash) VALUES (?,?,?)').run('u2','B','x');
  db.prepare("INSERT INTO matches(id,status) VALUES ('m1','playing')").run();
  return db;
}
const state:any={status:'playing',players:[{id:'u1',username:'A',hand:[],warnings:0,reds:0,connected:false,abandoned:false}],drawPile:[],discardPile:[],currentTeamId:'brazil',currentNumber:1,currentPlayerIndex:0,direction:1,skipNext:false,winnerIds:[],finishedRanking:[],events:[],version:7};

describe('match runtime persistence',()=>{
  let db:Database.Database|undefined; afterEach(()=>db?.close());
  it('round-trips state and rejects wrong user/token',()=>{
    db=makeDb(); const token=issueReconnectToken(db,'m1','u1',60_000);
    expect(validateReconnectToken(db,token,'m1','u1')).toBe(true);
    expect(validateReconnectToken(db,token,'m1','u2')).toBe(false);
    saveRuntime(db,{matchId:'m1',roomCode:'ROOM1',state,version:7,lastActivityAt:new Date().toISOString()});
    const loaded=loadActiveRuntimes(db); expect(loaded).toHaveLength(1); expect(loaded[0].state.players[0].id).toBe('u1'); expect(loaded[0].version).toBe(7);
  });
  it('deletes runtime and reconnect credentials after match cleanup',()=>{
    db=makeDb(); issueReconnectToken(db,'m1','u1',60_000); saveRuntime(db,{matchId:'m1',roomCode:'ROOM1',state,version:7,lastActivityAt:new Date().toISOString()});
    deleteMatchRuntime(db,'m1');
    expect(loadActiveRuntimes(db)).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) c FROM reconnect_tokens').get()).toEqual({c:0});
  });
});
