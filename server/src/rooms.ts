import crypto from 'node:crypto';

export type RoomVisibility = 'public' | 'private';
export type PlayerStatus = 'connected' | 'disconnected';

export interface RoomPlayer {
  userId: string;
  username: string;
  isHost: boolean;
  ready: boolean;
  status: PlayerStatus;
  joinedAt: string;
}

export interface Room {
  code: string;
  hostUserId: string;
  visibility: RoomVisibility;
  maxPlayers: number;
  status: 'waiting' | 'starting';
  createdAt: string;
  players: RoomPlayer[];
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map<string, Room>();
const userRoom = new Map<string, string>();

function makeCode(length = 6) {
  for (;;) {
    let code = '';
    for (let i = 0; i < length; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
}

function publicRoom(room: Room): Room {
  return structuredClone(room);
}

export function listRooms() {
  return [...rooms.values()].filter(r => r.visibility === 'public' && r.status === 'waiting').map(publicRoom);
}

export function getRoom(code: string) {
  const room = rooms.get(code.toUpperCase());
  return room ? publicRoom(room) : null;
}

export function getUserRoom(userId: string) {
  const code = userRoom.get(userId);
  return code ? getRoom(code) : null;
}

export function createRoom(input: { userId: string; username: string; visibility: RoomVisibility; maxPlayers: number }) {
  if (userRoom.has(input.userId)) throw new Error('ALREADY_IN_ROOM');
  if (!Number.isInteger(input.maxPlayers) || input.maxPlayers < 2 || input.maxPlayers > 4) throw new Error('INVALID_PLAYER_LIMIT');
  const code = makeCode();
  const now = new Date().toISOString();
  const room: Room = {
    code,
    hostUserId: input.userId,
    visibility: input.visibility,
    maxPlayers: input.maxPlayers,
    status: 'waiting',
    createdAt: now,
    players: [{ userId: input.userId, username: input.username, isHost: true, ready: false, status: 'connected', joinedAt: now }],
  };
  rooms.set(code, room);
  userRoom.set(input.userId, code);
  return publicRoom(room);
}

export function joinRoom(input: { code: string; userId: string; username: string }) {
  if (userRoom.has(input.userId)) throw new Error('ALREADY_IN_ROOM');
  const room = rooms.get(input.code.toUpperCase());
  if (!room) throw new Error('ROOM_NOT_FOUND');
  if (room.status !== 'waiting') throw new Error('ROOM_NOT_JOINABLE');
  if (room.players.length >= room.maxPlayers) throw new Error('ROOM_FULL');
  const now = new Date().toISOString();
  room.players.push({ userId: input.userId, username: input.username, isHost: false, ready: false, status: 'connected', joinedAt: now });
  userRoom.set(input.userId, room.code);
  return publicRoom(room);
}

export function setReady(userId: string, ready: boolean) {
  const code = userRoom.get(userId);
  if (!code) throw new Error('NOT_IN_ROOM');
  const room = rooms.get(code)!;
  const player = room.players.find(p => p.userId === userId)!;
  player.ready = ready;
  return publicRoom(room);
}

export function leaveRoom(userId: string) {
  const code = userRoom.get(userId);
  if (!code) throw new Error('NOT_IN_ROOM');
  const room = rooms.get(code)!;
  const leavingIndex = room.players.findIndex(p => p.userId === userId);
  if (leavingIndex < 0) throw new Error('NOT_IN_ROOM');
  room.players.splice(leavingIndex, 1);
  userRoom.delete(userId);
  if (room.players.length === 0) {
    rooms.delete(code);
    return null;
  }
  if (room.hostUserId === userId) {
    room.hostUserId = room.players[0].userId;
    room.players.forEach(p => { p.isHost = p.userId === room.hostUserId; });
  }
  return publicRoom(room);
}

export function kickPlayer(hostUserId: string, targetUserId: string) {
  const code = userRoom.get(hostUserId);
  if (!code) throw new Error('NOT_IN_ROOM');
  const room = rooms.get(code)!;
  if (room.hostUserId !== hostUserId) throw new Error('HOST_ONLY');
  if (targetUserId === hostUserId) throw new Error('HOST_CANNOT_KICK_SELF');
  const index = room.players.findIndex(p => p.userId === targetUserId);
  if (index < 0) throw new Error('PLAYER_NOT_FOUND');
  room.players.splice(index, 1);
  userRoom.delete(targetUserId);
  return publicRoom(room);
}

export function startRoom(userId: string) {
  const code = userRoom.get(userId);
  if (!code) throw new Error('NOT_IN_ROOM');
  const room = rooms.get(code)!;
  if (room.hostUserId !== userId) throw new Error('HOST_ONLY');
  if (room.players.length < 2) throw new Error('MIN_PLAYERS_NOT_MET');
  if (room.players.some(p => !p.ready)) throw new Error('ALL_PLAYERS_MUST_BE_READY');
  room.status = 'starting';
  return publicRoom(room);
}

export function restoreRoom(input: { code: string; hostUserId: string; maxPlayers: number; players: Array<{ userId: string; username: string; isHost?: boolean; ready?: boolean; status?: PlayerStatus; joinedAt?: string }>; status?: 'waiting' | 'starting' }) {
  if (rooms.has(input.code)) return getRoom(input.code)!;
  const now = new Date().toISOString();
  const room: Room = {
    code: input.code.toUpperCase(),
    hostUserId: input.hostUserId,
    visibility: 'private',
    maxPlayers: input.maxPlayers,
    status: input.status ?? 'starting',
    createdAt: now,
    players: input.players.map(p => ({ userId: p.userId, username: p.username, isHost: p.userId === input.hostUserId || Boolean(p.isHost), ready: p.ready ?? true, status: p.status ?? 'disconnected', joinedAt: p.joinedAt ?? now })),
  };
  rooms.set(room.code, room);
  for (const p of room.players) userRoom.set(p.userId, room.code);
  return publicRoom(room);
}

export function resetRoomsForTests() {
  rooms.clear();
  userRoom.clear();
}
