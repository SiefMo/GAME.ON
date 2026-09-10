import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';

const COOKIE = 'game_on_session';
const SESSION_DAYS = 30;

export interface AuthUser { id: string; username: string; score: number; wins: number; losses: number; matchesPlayed: number; role:'player'|'admin'; isSuspended:boolean; }

type UserRow = { id:string; username:string; password_hash:string; score:number; wins:number; losses:number; matches_played:number; role:'player'|'admin'; is_suspended:number };

export async function hashPassword(password: string) { return bcrypt.hash(password, 12); }
export async function verifyPassword(password: string, hash: string) { return bcrypt.compare(password, hash); }
function tokenHash(token:string) { return crypto.createHash('sha256').update(token).digest('hex'); }
function toUser(row: UserRow): AuthUser { return {id:row.id, username:row.username, score:row.score, wins:row.wins, losses:row.losses, matchesPlayed:row.matches_played, role:row.role, isSuspended:Boolean(row.is_suspended)}; }

export function createSession(db: Database.Database, userId:string, res:Response) {
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(new Date().toISOString());
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS*86400000).toISOString();
  db.prepare('DELETE FROM sessions WHERE user_id=? AND expires_at>? AND id NOT IN (SELECT id FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 5)').run(userId, new Date().toISOString(), userId);
  db.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').run(crypto.randomUUID(), userId, tokenHash(token), expires);
  res.cookie(COOKIE, token, {httpOnly:true, secure:process.env.NODE_ENV==='production', sameSite:'lax', path:'/', maxAge:SESSION_DAYS*86400000});
}

export function clearSession(db: Database.Database, req:Request, res:Response) {
  const token = req.cookies?.[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
  res.clearCookie(COOKIE, {httpOnly:true, secure:process.env.NODE_ENV==='production', sameSite:'lax', path:'/'});
}

export function authMiddleware(db: Database.Database) {
  return (req:Request,res:Response,next:NextFunction) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({error:'Authentication required'});
    const row = db.prepare(`SELECT u.*,COALESCE(a.role,'player') AS role,COALESCE(a.is_suspended,0) AS is_suspended FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN user_admin a ON a.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash(token), new Date().toISOString()) as UserRow|undefined;
    if (!row) return res.status(401).json({error:'Session expired'});
    if (row.is_suspended) return res.status(403).json({error:'Account suspended'});
    (req as Request & {user:AuthUser}).user = toUser(row);
    next();
  };
}

export function currentUser(req:Request) { return (req as Request & {user:AuthUser}).user; }

export function adminMiddleware(db: Database.Database) { return (req:Request,res:Response,next:NextFunction) => { const user=currentUser(req); if(user.role!=='admin') return res.status(403).json({error:'Admin access required'}); next(); }; }
