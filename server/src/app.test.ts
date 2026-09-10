import { describe,it,expect,afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from './app.js';
import { createServer } from 'node:http';

async function request(app:any, method:string, path:string, body?:any, cookie?:string) {
  const server=createServer(app); await new Promise<void>(r=>server.listen(0,r)); const {port}=server.address() as any;
  const res=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{'content-type':'application/json',...(cookie?{'cookie':cookie}:{})},body:body?JSON.stringify(body):undefined});
  const set=res.headers.get('set-cookie'); const json=res.status===204?null:await res.json(); await new Promise<void>(r=>server.close(()=>r())); return {status:res.status,json,setCookie:set};
}

describe('auth API',()=>{ let db:Database.Database; afterEach(()=>db?.close());
 it('registers, logs in, reads profile and rejects wrong password',async()=>{
  db=new Database(':memory:'); db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE,password_hash TEXT NOT NULL,score INTEGER NOT NULL DEFAULT 0,wins INTEGER NOT NULL DEFAULT 0,losses INTEGER NOT NULL DEFAULT 0,matches_played INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE user_admin(user_id TEXT PRIMARY KEY,role TEXT NOT NULL DEFAULT 'player',is_suspended INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  const app=createApp(db); const reg=await request(app,'POST','/api/auth/register',{username:'PlayerA',password:'correct horse battery staple',confirmPassword:'correct horse battery staple'}); expect(reg.status).toBe(201); expect(reg.setCookie).toBeTruthy();
  const bad=await request(app,'POST','/api/auth/login',{username:'PlayerA',password:'wrong'}); expect(bad.status).toBe(401);
  const login=await request(app,'POST','/api/auth/login',{username:'PlayerA',password:'correct horse battery staple'}); expect(login.status).toBe(200); const cookie=login.setCookie!.split(';')[0];
  const me=await request(app,'GET','/api/auth/me',undefined,cookie); expect(me.status).toBe(200); expect(me.json.user.username).toBe('PlayerA');
 });
});
