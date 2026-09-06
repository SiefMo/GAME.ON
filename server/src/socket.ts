import type { Server as HttpServer } from 'node:http';
import type Database from 'better-sqlite3';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import crypto from 'node:crypto';
import { GameEngine, buildInitialState, type GameAction, type GameState, type GameEvent } from '@game-on/shared';
import { gameConfig, players as playerAssets } from './config.js';
import { getUserRoom, getRoom, startRoom, createRoom, joinRoom, setReady, leaveRoom, kickPlayer, restoreRoom } from './rooms.js';
import { createMatch, finishMatch } from './matches.js';
import { deleteMatchRuntime, issueReconnectToken, loadActiveRuntimes, saveRuntime, validateReconnectToken } from './matchRuntimeStore.js';

const COOKIE = 'game_on_session';
const MAX_REQUEST_IDS = 100;
const SOCKET_EVENTS_PER_WINDOW = 120;
const SOCKET_RATE_WINDOW_MS = 10_000;
const roomCreateSchema = z.object({visibility:z.enum(['public','private']).default('private'),maxPlayers:z.number().int().min(2).max(4).default(4)});
const roomJoinSchema = z.object({code:z.string().trim().length(6).regex(/^[A-HJ-NP-Z2-9]{6}$/).transform(v=>v.toUpperCase())});
const requestIdSchema = z.string().min(1).max(80);
const cardIdSchema = z.string().min(1).max(200);
const teamIdSchema = z.string().min(1).max(40);
const gamePayloadSchema = z.object({requestId:requestIdSchema,action:z.object({type:z.string()}).passthrough()});

type SocketUser = { id: string; username: string };
type SocketWithUser = Socket & { data: { user?: SocketUser; roomCode?: string } };
type SessionRow = { user_id: string; username: string; is_suspended:number };

interface MatchRuntime {
  roomCode: string;
  engine: GameEngine;
  acceptedRequests: Map<string, Set<string>>;
  timer?: ReturnType<typeof setInterval>;
  matchId: string;
  persisted: boolean;
  disconnectedAt: Map<string, number>;
}

const runtimes = new Map<string, MatchRuntime>();
let ioRef: Server | undefined;
let dbRef: Database.Database | undefined;

function parseCookies(header = ''): Record<string, string> {
  return Object.fromEntries(header.split(';').map(v => v.trim()).filter(Boolean).map(pair => {
    const i = pair.indexOf('=');
    return i < 0 ? [pair, ''] : [pair.slice(0, i), decodeURIComponent(pair.slice(i + 1))];
  }));
}

function authenticateByHash(db: Database.Database, token: string): SocketUser | null {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`SELECT u.id as user_id, u.username,COALESCE(a.is_suspended,0) AS is_suspended FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN user_admin a ON a.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?`).get(hash, new Date().toISOString()) as SessionRow | undefined;
  return row && !row.is_suspended ? { id: row.user_id, username: row.username } : null;
}

function publicCard(card: any) { const copy = { ...card }; delete copy.hiddenTeamId; return copy; }

function projectState(state: GameState, viewerId: string) {
  return {
    status: state.status, currentTeamId: state.currentTeamId, currentNumber: state.currentNumber,
    currentPlayerId: state.players[state.currentPlayerIndex]?.id, direction: state.direction, skipNext: state.skipNext,
    version: state.version, discardTop: state.discardPile.at(-1) ? publicCard(state.discardPile.at(-1)) : undefined,
    drawCount: state.drawPile.length,
    penalty: state.penalty ? {
      attackerId: state.penalty.attackerId, defenderId: state.penalty.defenderId, phase: state.penalty.phase,
      deadlineAt: state.penalty.deadlineAt,
      chosenTeamId: state.penalty.phase === 'defender-guessing' && viewerId !== state.penalty.attackerId ? undefined : state.penalty.chosenTeamId,
    } : undefined,
    switchState: state.switchState ? { ...state.switchState, targetHand: state.switchState.playerId === viewerId ? state.players.find(p => p.id === state.switchState!.targetPlayerId)?.hand.map(publicCard) : undefined } : undefined,
    players: state.players.map(p => ({ id: p.id, username: p.username, cardCount: p.hand.length, warnings: p.warnings, reds: p.reds,
      connected: p.connected, abandoned: p.abandoned, goalkeeper: p.goalkeeperCard ? publicCard(p.goalkeeperCard) : undefined,
      hand: p.id === viewerId ? p.hand.map(publicCard) : undefined })),
    winnerIds: state.winnerIds, finishedRanking: state.finishedRanking,
  };
}

function broadcastState(io: Server, runtime: MatchRuntime) {
  for (const player of runtime.engine.state.players) io.to(`user:${player.id}`).emit('game:state', projectState(runtime.engine.state, player.id));
}

function sanitizeEvent(event: GameEvent, viewerId: string): GameEvent {
  if (event.type === 'player:drew' && event.actorId !== viewerId && event.data?.cardId) {
    const data = { ...(event.data as Record<string, unknown>) }; delete data.cardId; return { ...event, data };
  }
  if (event.type === 'switch:completed') {
    const data = { ...(event.data as Record<string, unknown> ?? {}) }; delete data.ownCardId; delete data.targetCardId; return { ...event, data };
  }
  return event;
}

function broadcastEvents(io: Server, runtime: MatchRuntime, events: GameEvent[]) {
  if (!events.length) return;
  for (const player of runtime.engine.state.players) io.to(`user:${player.id}`).emit('game:event', events.map(event => sanitizeEvent(event, player.id)));
}

function getRuntime(code: string) { return runtimes.get(code.toUpperCase()); }

function persist(runtime: MatchRuntime) {
  if (!dbRef || !gameConfig.persistRuntimeState) return;
  saveRuntime(dbRef, { matchId: runtime.matchId, roomCode: runtime.roomCode, state: runtime.engine.state,
    version: runtime.engine.state.version, lastActivityAt: new Date().toISOString(), reconnectDeadlineAt: null });
}

function finishRuntime(runtime: MatchRuntime) {
  if (!dbRef || runtime.persisted) return;
  finishMatch(dbRef, runtime.matchId, runtime.engine.state, runtime.engine.state.finishedRanking);
  deleteMatchRuntime(dbRef, runtime.matchId);
  runtime.persisted = true;
}

function buildRuntime(code: string, db: Database.Database) {
  const room = getRoom(code);
  if (!room || room.status !== 'starting') throw new Error('ROOM_NOT_STARTING');
  const state = buildInitialState(room.players.map(p => ({ id: p.userId, username: p.username })), { config: gameConfig, playerAssets });
  const matchId = createMatch(db, room.players.map(p => p.userId));
  const runtime: MatchRuntime = { roomCode: room.code, engine: new GameEngine(state, { config: gameConfig, playerAssets }),
    acceptedRequests: new Map(), matchId, persisted: false, disconnectedAt: new Map() };
  persist(runtime);
  for (const p of state.players) ioRef?.to(`user:${p.id}`).emit('game:reconnectToken', { matchId, token: issueReconnectToken(db, matchId, p.id, gameConfig.reconnectTokenTtlMs) });
  runtime.timer = setInterval(() => tickRuntime(runtime), 100);
  runtimes.set(room.code, runtime);
  return runtime;
}

function tickRuntime(runtime: MatchRuntime) {
  try {
    let changed = false;
    if (runtime.engine.resolvePenaltyTimeout()) changed = true;
    const now = Date.now();
    for (const [userId, disconnectedAt] of runtime.disconnectedAt) {
      if (now - disconnectedAt < gameConfig.disconnectGraceMs) continue;
      const player = runtime.engine.state.players.find(p => p.id === userId);
      if (!player || player.abandoned) { runtime.disconnectedAt.delete(userId); continue; }
      if (gameConfig.disconnectBehavior === 'cancel-match') {
        runtime.engine.state.status = 'cancelled' as GameState['status'];
        runtime.engine.state.version++;
        runtime.engine.state.events.push({ id: crypto.randomUUID(), type: 'match:cancelled', timestamp: Date.now(), actorId: userId, data: { reason: 'disconnect-timeout' } });
      } else if (gameConfig.disconnectBehavior === 'mark-abandoned') {
        const events = runtime.engine.abandonPlayer(userId);
        broadcastEvents(ioRef!, runtime, events);
        changed = true;
      }
      runtime.disconnectedAt.delete(userId);
      if (runtime.engine.state.status !== 'playing') break;
    }
    if (changed) persist(runtime);
    if (runtime.engine.state.status === 'finished' || runtime.engine.state.status === 'cancelled') {
      if (runtime.engine.state.status === 'finished') finishRuntime(runtime);
      else if (dbRef) { dbRef.prepare('UPDATE matches SET status=?, finished_at=? WHERE id=? AND status=?').run('cancelled', new Date().toISOString(), runtime.matchId, 'playing'); deleteMatchRuntime(dbRef, runtime.matchId); runtime.persisted = true; }
    }
    if (changed) broadcastState(ioRef!, runtime);
  } catch { /* operational timers must never crash the server */ }
}

function roomForSocket(socket: SocketWithUser) {
  const code = socket.data.roomCode || (socket.data.user ? getUserRoom(socket.data.user.id)?.code : undefined);
  if (!code) throw new Error('NOT_IN_ROOM');
  return code;
}

function createSocketRateGate() {
  let windowStarted = Date.now();
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStarted >= SOCKET_RATE_WINDOW_MS) { windowStarted = now; count = 0; }
    count++;
    if (count > SOCKET_EVENTS_PER_WINDOW) throw new Error('SOCKET_RATE_LIMITED');
  };
}

function rateGate(runtime: MatchRuntime, userId: string, requestId: string) {
  if (!requestId || requestId.length > 80) throw new Error('INVALID_REQUEST_ID');
  let set = runtime.acceptedRequests.get(userId); if (!set) { set = new Set(); runtime.acceptedRequests.set(userId, set); }
  if (set.has(requestId)) throw new Error('DUPLICATE_ACTION'); set.add(requestId);
  while (set.size > MAX_REQUEST_IDS) set.delete(set.values().next().value!);
}

function restorePersistedRuntimes(db: Database.Database) {
  for (const stored of loadActiveRuntimes(db)) {
    const players = stored.state.players.map(p => ({ userId: p.id, username: p.username, status: p.connected ? 'connected' as const : 'disconnected' as const, ready: true }));
    const host = players[0]?.userId;
    if (!host) continue;
    restoreRoom({ code: stored.roomCode, hostUserId: host, maxPlayers: players.length, players, status: 'starting' });
    const runtime: MatchRuntime = { roomCode: stored.roomCode, engine: new GameEngine(stored.state, { config: gameConfig, playerAssets }),
      acceptedRequests: new Map(), matchId: stored.matchId, persisted: false, disconnectedAt: new Map() };
    for (const p of stored.state.players) if (!p.connected) runtime.disconnectedAt.set(p.id, Date.now());
    runtime.timer = setInterval(() => tickRuntime(runtime), 100);
    runtimes.set(stored.roomCode, runtime);
  }
}

export function createSocketServer(httpServer: HttpServer, db: Database.Database) {
  dbRef = db;
  const socketOrigin = process.env.CLIENT_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
  const io = new Server(httpServer, { ...(socketOrigin ? { cors: { origin: socketOrigin, credentials: true } } : {}), transports: ['websocket', 'polling'] });
  ioRef = io;
  restorePersistedRuntimes(db);

  io.use((socket, next) => {
    const user = authenticateByHash(db, parseCookies(socket.handshake.headers.cookie || '')[COOKIE] || '');
    if (!user) return next(new Error('AUTHENTICATION_REQUIRED'));
    (socket as SocketWithUser).data.user = user; next();
  });

  const emitRoom = (code: string) => { const room = getRoom(code); if (room) io.to(`room:${code}`).emit('room:state', room); };

  io.on('connection', raw => {
    const socket = raw as SocketWithUser; const user = socket.data.user!;
    const socketRateGate = createSocketRateGate();
    socket.use((_packet, next) => { try { socketRateGate(); next(); } catch (e) { next(new Error(e instanceof Error ? e.message : 'SOCKET_RATE_LIMITED')); } });
    socket.join(`user:${user.id}`);
    const room = getUserRoom(user.id);
    if (room) {
      socket.data.roomCode = room.code; socket.join(`room:${room.code}`);
      const runtime = getRuntime(room.code);
      if (runtime) {
        const p = runtime.engine.state.players.find(x => x.id === user.id);
        if (p) p.connected = true;
        runtime.disconnectedAt.delete(user.id);
        const token = issueReconnectToken(db, runtime.matchId, user.id, gameConfig.reconnectTokenTtlMs);
        socket.emit('game:reconnectToken', { matchId: runtime.matchId, token });
        socket.emit('game:state', projectState(runtime.engine.state, user.id)); broadcastState(io, runtime); persist(runtime);
      } else socket.emit('room:state', room);
    }

    socket.on('room:subscribe', () => { try { const code = roomForSocket(socket); socket.join(`room:${code}`); socket.data.roomCode = code; socket.emit('room:state', getRoom(code)); const runtime = getRuntime(code); if (runtime) socket.emit('game:state', projectState(runtime.engine.state, user.id)); } catch { socket.emit('game:error', { code: 'NOT_IN_ROOM', message: 'You are not in a room.' }); } });

    socket.on('game:reconnect', (payload = {}, ack?: (r:any)=>void) => {
      const reconnectInput=z.object({matchId:z.string().uuid(),token:z.string().min(20).max(200)}).safeParse(payload);
      if(!reconnectInput.success){ ack?.({ok:false,code:'INVALID_RECONNECT_REQUEST'}); return; }
      const {matchId,token}=reconnectInput.data;
      try {
        const code = roomForSocket(socket); const runtime = getRuntime(code);
        if (!runtime || runtime.matchId !== matchId || !validateReconnectToken(db, token, matchId, user.id)) throw new Error('INVALID_RECONNECT_TOKEN');
        const p = runtime.engine.state.players.find(x => x.id === user.id); if (!p) throw new Error('PLAYER_NOT_IN_MATCH');
        p.connected = true; runtime.disconnectedAt.delete(user.id); socket.join(`room:${code}`); socket.data.roomCode = code;
        socket.emit('game:state', projectState(runtime.engine.state, user.id)); broadcastState(io, runtime); persist(runtime); ack?.({ ok: true, version: runtime.engine.state.version });
      } catch (e) { ack?.({ ok:false, code:e instanceof Error ? e.message : 'RECONNECT_FAILED' }); }
    });

    socket.on('room:ready', ({ ready } = {}, ack?: (r:any)=>void) => { const respond=ack||(()=>undefined); try { const room=setReady(user.id,Boolean(ready)); emitRoom(room.code); respond({ok:true,room}); } catch(e){respond({ok:false,code:e instanceof Error?e.message:'READY_FAILED'});} });
    socket.on('room:leave', (_:unknown, ack?: (r:any)=>void) => { const respond=ack||(()=>undefined); try { const previous=getUserRoom(user.id); const room=leaveRoom(user.id); if(previous) io.to(`room:${previous.code}`).emit('room:state',room); socket.data.roomCode=undefined; respond({ok:true,room}); } catch(e){respond({ok:false,code:e instanceof Error?e.message:'LEAVE_FAILED'});} });
    socket.on('room:kick', ({userId}={},ack?: (r:any)=>void)=>{const respond=ack||(()=>undefined);try{const room=kickPlayer(user.id,userId);emitRoom(room.code);io.to(`user:${userId}`).emit('room:kicked',{code:room.code});respond({ok:true,room});}catch(e){respond({ok:false,code:e instanceof Error?e.message:'KICK_FAILED'});}});
    socket.on('room:create', (payload={},ack?: (r:any)=>void)=>{const respond=ack||(()=>undefined);try{const parsed=roomCreateSchema.parse(payload);const room=createRoom({userId:user.id,username:user.username,...parsed});socket.data.roomCode=room.code;socket.join(`room:${room.code}`);respond({ok:true,room});}catch(e){respond({ok:false,code:e instanceof z.ZodError?'INVALID_ROOM_SETTINGS':e instanceof Error?e.message:'CREATE_FAILED'});}});
    socket.on('room:join', (payload={},ack?: (r:any)=>void)=>{const respond=ack||(()=>undefined);try{const {code}=roomJoinSchema.parse(payload);const room=joinRoom({code,userId:user.id,username:user.username});socket.data.roomCode=room.code;socket.join(`room:${room.code}`);emitRoom(room.code);respond({ok:true,room});}catch(e){respond({ok:false,code:e instanceof z.ZodError?'INVALID_ROOM_CODE':e instanceof Error?e.message:'JOIN_FAILED'});}});

    socket.on('game:start', ({requestId}={},ack?: (r:any)=>void)=>{const respond=ack||((x:any)=>socket.emit('game:error',x));try{const code=roomForSocket(socket);const room=getRoom(code);if(!room||room.hostUserId!==user.id)throw new Error('HOST_ONLY');startRoom(user.id);if(getRuntime(code))throw new Error('GAME_ALREADY_STARTED');const runtime=buildRuntime(code,db);rateGate(runtime,user.id,requestId||crypto.randomUUID());broadcastState(io,runtime);respond({ok:true});}catch(e){respond({ok:false,code:e instanceof Error?e.message:'START_FAILED',message:'Unable to start the game.'});}});

    const handleGameAction=(payload:{requestId:string;action:Omit<GameAction,'playerId'>},ack?: (r:any)=>void)=>{const respond=ack||((x:any)=>socket.emit('game:error',x));try{const parsed=gamePayloadSchema.parse(payload);const code=roomForSocket(socket);const runtime=getRuntime(code);if(!runtime)throw new Error('GAME_NOT_STARTED');if(runtime.engine.state.status!=='playing')throw new Error('GAME_FINISHED');const p=runtime.engine.state.players.find(x=>x.id===user.id);if(!p||p.abandoned)throw new Error('PLAYER_ABANDONED');rateGate(runtime,user.id,parsed.requestId);const action={...parsed.action,playerId:user.id} as GameAction;const events=runtime.engine.dispatch(action);persist(runtime);if(runtime.engine.state.status==='finished')finishRuntime(runtime);respond({ok:true,version:runtime.engine.state.version});broadcastEvents(io,runtime,events);broadcastState(io,runtime);}catch(e){respond({ok:false,code:e instanceof Error?e.message:'ACTION_FAILED',message:e instanceof Error?e.message:'Action rejected.'});}};
    socket.on('game:action',handleGameAction);
    socket.on('game:playCard',(p,ack)=>handleGameAction({requestId:p.requestId,action:{type:'playCard',cardId:p.cardId}},ack));
    socket.on('game:drawCard',(p,ack)=>handleGameAction({requestId:p.requestId,action:{type:'drawCard'}},ack));
    socket.on('game:chooseTeam',(p,ack)=>handleGameAction({requestId:p.requestId,action:{type:'chooseTeam',teamId:p.teamId}},ack));
    socket.on('game:save',(p,ack)=>handleGameAction({requestId:p.requestId,action:{type:'attemptSave',accept:p.accept}},ack));
    socket.on('game:guess',(p,ack)=>handleGameAction({requestId:p.requestId,action:{type:'guessTeam',teamId:p.teamId}},ack));
    socket.on('game:switch',(p,ack)=>handleGameAction({requestId:p.requestId,action:{type:'switchCards',ownCardId:p.ownCardId,targetCardId:p.targetCardId}},ack));
    socket.on('game:passSwitch',(p,ack)=>handleGameAction({requestId:p.requestId,action:{type:'passSwitch'}},ack));
    socket.on('game:placeGoalkeeper',(p,ack)=>handleGameAction({requestId:p.requestId,action:{type:'placeGoalkeeper',cardId:p.cardId}},ack));
    socket.on('game:removeGoalkeeper',(p,ack)=>handleGameAction({requestId:p.requestId,action:{type:'removeGoalkeeper'}},ack));

    socket.on('disconnect',()=>{const code=socket.data.roomCode;const runtime=code?getRuntime(code):undefined;if(!runtime)return;const p=runtime.engine.state.players.find(x=>x.id===user.id);if(p){p.connected=false;runtime.disconnectedAt.set(user.id,Date.now());persist(runtime);io.to(`room:${code}`).emit('room:playerDisconnected',{userId:user.id,graceMs:gameConfig.disconnectGraceMs});broadcastState(io,runtime);}});
  });
  return io;
}

export function getMatchRuntime(code:string){return getRuntime(code);}
export function resetSocketRuntimesForTests(){for(const runtime of runtimes.values())if(runtime.timer)clearInterval(runtime.timer);runtimes.clear();}
