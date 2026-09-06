import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { HealthResponse } from '@game-on/shared';
import { createSession, clearSession, authMiddleware, adminMiddleware, currentUser, hashPassword, verifyPassword } from './auth.js';
import { createRoom, getRoom, getUserRoom, joinRoom, kickPlayer, leaveRoom, listRooms, setReady, startRoom } from './rooms.js';
import { getLeaderboard, getMatchHistory, getMatchDetails } from './matches.js';
import { adminDashboard, adminUsers, adminMatches, adminMatchDetails, adminAuditLog, setUserSuspended, setUserRole } from './admin.js';
import { searchUsers, listFriends, sendFriendRequest, respondFriendRequest, removeFriend, listNotifications, markNotificationRead, markAllNotificationsRead, getSettings, updateSettings } from './social.js';

const registerSchema = z.object({username:z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9_]+$/), password:z.string().min(8).max(128), confirmPassword:z.string().min(8).max(128)}).refine(x=>x.password===x.confirmPassword,{path:['confirmPassword'],message:'Passwords do not match'});
const loginSchema = z.object({username:z.string().trim().min(3).max(24),password:z.string().min(1).max(128)});

export function createApp(db: Database.Database) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req,res,next) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    next();
  });
  const clientOrigin = process.env.CLIENT_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
  if (clientOrigin) app.use(cors({origin: clientOrigin, credentials:true}));
  app.use(express.json({limit:'32kb'}));
  app.use(cookieParser());
  const allowedOrigin = process.env.CLIENT_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
  app.use((req,res,next) => {
    if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && allowedOrigin && origin !== allowedOrigin) return res.status(403).json({error:'Origin not allowed'});
    next();
  });
  const authLimiter = rateLimit({windowMs:15*60*1000,max:20,standardHeaders:true,legacyHeaders:false,message:{error:'Too many authentication attempts. Try again later.'}});

  app.get('/health', (_req,res) => res.json({ok:true,service:'game-on-server',timestamp:new Date().toISOString()} satisfies HealthResponse));
  app.get('/ready', (_req,res) => { try { db.prepare('SELECT 1').get(); return res.json({ok:true,ready:true}); } catch { return res.status(503).json({ok:false,ready:false}); } });

  const clientDist = path.resolve(process.cwd(), 'client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
  }

  app.get('/api/admin/dashboard', authMiddleware(db), adminMiddleware(db), (_req,res) => res.json(adminDashboard(db)));
  app.get('/api/admin/users', authMiddleware(db), adminMiddleware(db), (req,res) => {
    const page=Number(req.query.page||1), pageSize=Number(req.query.pageSize||25), q=String(req.query.q||'');
    if(!Number.isFinite(page)||!Number.isFinite(pageSize)) return res.status(400).json({error:'Invalid pagination'});
    res.json(adminUsers(db,page,pageSize,q));
  });
  app.patch('/api/admin/users/:id/suspension', authMiddleware(db), adminMiddleware(db), (req,res) => {
    const parsed=z.object({suspended:z.boolean()}).safeParse(req.body); if(!parsed.success) return res.status(400).json({error:'Invalid suspension state'});
    try{return res.json(setUserSuspended(db,currentUser(req).id,req.params.id,parsed.data.suspended));}catch(e){const code=e instanceof Error?e.message:'USER_UPDATE_FAILED';return res.status(code==='USER_NOT_FOUND'?404:409).json({error:code});}
  });
  app.patch('/api/admin/users/:id/role', authMiddleware(db), adminMiddleware(db), (req,res) => {
    const parsed=z.object({role:z.enum(['player','admin'])}).safeParse(req.body); if(!parsed.success) return res.status(400).json({error:'Invalid role'});
    try{return res.json(setUserRole(db,currentUser(req).id,req.params.id,parsed.data.role));}catch(e){const code=e instanceof Error?e.message:'USER_UPDATE_FAILED';return res.status(code==='USER_NOT_FOUND'?404:409).json({error:code});}
  });
  app.get('/api/admin/matches', authMiddleware(db), adminMiddleware(db), (req,res) => {
    const page=Number(req.query.page||1), pageSize=Number(req.query.pageSize||25); if(!Number.isFinite(page)||!Number.isFinite(pageSize)) return res.status(400).json({error:'Invalid pagination'}); res.json(adminMatches(db,page,pageSize));
  });
  app.get('/api/admin/matches/:id', authMiddleware(db), adminMiddleware(db), (req,res) => { const details=adminMatchDetails(db,req.params.id); if(!details) return res.status(404).json({error:'Match not found'}); res.json(details); });
  app.get('/api/admin/audit', authMiddleware(db), adminMiddleware(db), (req,res) => { const page=Number(req.query.page||1), pageSize=Number(req.query.pageSize||50); if(!Number.isFinite(page)||!Number.isFinite(pageSize)) return res.status(400).json({error:'Invalid pagination'}); res.json(adminAuditLog(db,page,pageSize)); });

  app.get('/api/config', (_req,res) => res.json({game:'GAME ON',subtitle:'FOOTBALL CARD BATTLE'}));

  app.post('/api/auth/register', authLimiter, async (req,res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({error:'Invalid registration data',fields:parsed.error.flatten().fieldErrors});
    const {username,password} = parsed.data;
    const exists = db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username);
    if (exists) return res.status(409).json({error:'Username already exists'});
    const passwordHash = await hashPassword(password);
    const userId = crypto.randomUUID();
    db.prepare('INSERT INTO users (id,username,password_hash) VALUES (?,?,?)').run(userId, username, passwordHash);
    createSession(db, userId, res);
    const row = db.prepare(`SELECT u.id,u.username,u.score,u.wins,u.losses,u.matches_played,COALESCE(a.role,'player') AS role,COALESCE(a.is_suspended,0) AS is_suspended FROM users u LEFT JOIN user_admin a ON a.user_id=u.id WHERE u.id=?`).get(userId);
    res.status(201).json({user:row});
  });

  app.post('/api/auth/login', authLimiter, async (req,res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({error:'Invalid login data'});
    const row = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(parsed.data.username) as any;
    if (!row || !(await verifyPassword(parsed.data.password,row.password_hash))) return res.status(401).json({error:'Invalid username or password'});
    createSession(db,row.id,res);
    res.json({user:{id:row.id,username:row.username,score:row.score,wins:row.wins,losses:row.losses,matchesPlayed:row.matches_played,role:row.role,isSuspended:Boolean(row.is_suspended)}});
  });

  app.post('/api/auth/logout', authLimiter, (req,res) => { clearSession(db,req,res); res.status(204).end(); });
  app.get('/api/auth/me', authMiddleware(db), (req,res) => res.json({user:currentUser(req)}));
  app.get('/api/rooms', authMiddleware(db), (_req,res) => res.json({rooms:listRooms()}));

  app.get('/api/rooms/me', authMiddleware(db), (req,res) => res.json({room:getUserRoom(currentUser(req).id)}));

  app.post('/api/rooms', authMiddleware(db), (req,res) => {
    const parsed = z.object({visibility:z.enum(['public','private']).default('private'),maxPlayers:z.number().int().min(2).max(4).default(4)}).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({error:'Invalid room settings'});
    try { return res.status(201).json({room:createRoom({userId:currentUser(req).id,username:currentUser(req).username,...parsed.data})}); }
    catch (e) { return res.status(409).json({error:e instanceof Error ? e.message : 'Unable to create room'}); }
  });

  app.post('/api/rooms/join', authMiddleware(db), (req,res) => {
    const parsed=z.object({code:z.string().trim().length(6).transform(v=>v.toUpperCase())}).safeParse(req.body);
    if(!parsed.success) return res.status(400).json({error:'Invalid room code'});
    try { return res.json({room:joinRoom({code:parsed.data.code,userId:currentUser(req).id,username:currentUser(req).username})}); }
    catch(e){ return res.status(e instanceof Error && e.message==='ROOM_NOT_FOUND' ? 404 : 409).json({error:e instanceof Error?e.message:'Unable to join room'}); }
  });

  app.post('/api/rooms/ready', authMiddleware(db), (req,res) => {
    const parsed=z.object({ready:z.boolean()}).safeParse(req.body); if(!parsed.success) return res.status(400).json({error:'Invalid ready state'});
    try{return res.json({room:setReady(currentUser(req).id,parsed.data.ready)});}catch(e){return res.status(409).json({error:e instanceof Error?e.message:'Unable to update ready state'});}
  });

  app.post('/api/rooms/start', authMiddleware(db), (req,res) => {
    try{return res.json({room:startRoom(currentUser(req).id)});}catch(e){return res.status(409).json({error:e instanceof Error?e.message:'Unable to start room'});}
  });

  app.post('/api/rooms/leave', authMiddleware(db), (req,res) => {
    try{return res.json({room:leaveRoom(currentUser(req).id)});}catch(e){return res.status(409).json({error:e instanceof Error?e.message:'Unable to leave room'});}
  });

  app.post('/api/rooms/kick', authMiddleware(db), (req,res) => {
    const parsed=z.object({userId:z.string().min(1)}).safeParse(req.body); if(!parsed.success) return res.status(400).json({error:'Invalid player'});
    try{return res.json({room:kickPlayer(currentUser(req).id,parsed.data.userId)});}catch(e){return res.status(403).json({error:e instanceof Error?e.message:'Unable to kick player'});}
  });

  app.get('/api/rooms/:code', authMiddleware(db), (req,res) => { const room=getRoom(req.params.code); if(!room) return res.status(404).json({error:'Room not found'}); return res.json({room}); });

  app.get('/api/leaderboard', (req,res) => {
    const page = Number(req.query.page || 1); const pageSize = Number(req.query.pageSize || 20);
    if (!Number.isFinite(page) || !Number.isFinite(pageSize)) return res.status(400).json({error:'Invalid pagination'});
    res.json(getLeaderboard(db, page, pageSize));
  });

  app.get('/api/matches', authMiddleware(db), (req,res) => {
    const page = Number(req.query.page || 1); const pageSize = Number(req.query.pageSize || 20);
    if (!Number.isFinite(page) || !Number.isFinite(pageSize)) return res.status(400).json({error:'Invalid pagination'});
    res.json(getMatchHistory(db, currentUser(req).id, page, pageSize));
  });

  app.get('/api/matches/:id', authMiddleware(db), (req,res) => {
    const details = getMatchDetails(db, req.params.id, currentUser(req).id);
    if (!details) return res.status(404).json({error:'Match not found'});
    res.json(details);
  });

  app.get('/api/profile', authMiddleware(db), (req,res) => {
    const user=currentUser(req); const matches=user.matchesPlayed; const winRate=matches?Math.round(user.wins/matches*1000)/10:0;
    res.json({user:{...user,winRate}});
  });
  app.get('/api/users/search', authMiddleware(db), (req,res) => {
    const q = String(req.query.q || '');
    if (q.length > 24) return res.status(400).json({error:'Search is too long'});
    res.json(searchUsers(db, currentUser(req).id, q));
  });
  app.get('/api/friends', authMiddleware(db), (req,res) => res.json(listFriends(db, currentUser(req).id)));
  app.post('/api/friends/request', authMiddleware(db), (req,res) => {
    const parsed=z.object({username:z.string().trim().min(3).max(24)}).safeParse(req.body);
    if(!parsed.success) return res.status(400).json({error:'Invalid username'});
    try { return res.status(201).json(sendFriendRequest(db,currentUser(req).id,parsed.data.username)); }
    catch(e){ const code=e instanceof Error?e.message:'FRIEND_REQUEST_FAILED'; const status=['USER_NOT_FOUND'].includes(code)?404:['CANNOT_ADD_SELF','ALREADY_FRIENDS','REQUEST_ALREADY_SENT'].includes(code)?409:400; return res.status(status).json({error:code}); }
  });
  app.post('/api/friends/respond', authMiddleware(db), (req,res) => {
    const parsed=z.object({friendshipId:z.string().min(1),accept:z.boolean()}).safeParse(req.body);
    if(!parsed.success) return res.status(400).json({error:'Invalid friend request'});
    try{return res.json(respondFriendRequest(db,currentUser(req).id,parsed.data.friendshipId,parsed.data.accept));}catch(e){return res.status(404).json({error:e instanceof Error?e.message:'REQUEST_NOT_FOUND'});}
  });
  app.delete('/api/friends/:userId', authMiddleware(db), (req,res) => {
    try{return res.json(removeFriend(db,currentUser(req).id,req.params.userId));}catch(e){return res.status(404).json({error:e instanceof Error?e.message:'FRIEND_NOT_FOUND'});}
  });
  app.get('/api/notifications', authMiddleware(db), (req,res) => res.json(listNotifications(db,currentUser(req).id,Number(req.query.limit||30))));
  app.post('/api/notifications/:id/read', authMiddleware(db), (req,res) => { try{return res.json(markNotificationRead(db,currentUser(req).id,req.params.id));}catch(e){return res.status(404).json({error:e instanceof Error?e.message:'NOTIFICATION_NOT_FOUND'});} });
  app.post('/api/notifications/read-all', authMiddleware(db), (req,res) => res.json(markAllNotificationsRead(db,currentUser(req).id)));
  app.get('/api/settings', authMiddleware(db), (req,res) => res.json({settings:getSettings(db,currentUser(req).id)}));
  app.patch('/api/settings', authMiddleware(db), (req,res) => {
    const parsed=z.object({audioEnabled:z.boolean().optional(),sfxVolume:z.number().min(0).max(1).optional(),animationsEnabled:z.boolean().optional(),notificationsEnabled:z.boolean().optional()}).safeParse(req.body);
    if(!parsed.success) return res.status(400).json({error:'Invalid settings'});
    res.json({settings:updateSettings(db,currentUser(req).id,parsed.data)});
  });

  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.get('*', (req,res,next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/') || req.path === '/health' || req.path === '/ready') return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}
