import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from './app.js';

function db() {
  const d=new Database(':memory:');
  d.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,score INTEGER NOT NULL DEFAULT 0,wins INTEGER NOT NULL DEFAULT 0,losses INTEGER NOT NULL DEFAULT 0,matches_played INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  return d;
}

describe('security middleware',()=>{
  it('rejects a cross-origin state-changing request',async()=>{
    const d=db(); const app=createApp(d);
    const server=app.listen(0); const port=(server.address() as any).port;
    const res=await fetch(`http://127.0.0.1:${port}/api/auth/logout`,{method:'POST',headers:{origin:'https://evil.example'}});
    expect(res.status).toBe(403); server.close(); d.close();
  });
  it('sets baseline security headers',async()=>{
    const d=db(); const app=createApp(d); const server=app.listen(0); const port=(server.address() as any).port;
    const res=await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY'); server.close(); d.close();
  });
});
