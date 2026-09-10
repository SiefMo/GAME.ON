import { beforeEach, describe, expect, it } from 'vitest';
import { createRoom, getRoom, joinRoom, kickPlayer, leaveRoom, resetRoomsForTests, setReady, startRoom } from './rooms.js';

beforeEach(() => resetRoomsForTests());
const p = (id: string, username = id) => ({ userId: id, username, visibility: 'private' as const, maxPlayers: 4 });

describe('rooms', () => {
  it('creates a room with a host', () => {
    const room = createRoom(p('a', 'Alice'));
    expect(room.code).toHaveLength(6);
    expect(room.players).toHaveLength(1);
    expect(room.players[0].isHost).toBe(true);
  });
  it('joins and prevents a user from joining two rooms', () => {
    const room = createRoom(p('a'));
    joinRoom({ code: room.code, userId: 'b', username: 'B' });
    expect(() => joinRoom({ code: room.code, userId: 'b', username: 'B' })).toThrow('ALREADY_IN_ROOM');
  });
  it('requires at least two ready players and host to start', () => {
    const room = createRoom(p('a'));
    joinRoom({ code: room.code, userId: 'b', username: 'B' });
    expect(() => startRoom('a')).toThrow('ALL_PLAYERS_MUST_BE_READY');
    setReady('a', true); setReady('b', true);
    expect(startRoom('a').status).toBe('starting');
  });
  it('transfers host when host leaves', () => {
    const room = createRoom(p('a'));
    joinRoom({ code: room.code, userId: 'b', username: 'B' });
    const next = leaveRoom('a')!;
    expect(next.hostUserId).toBe('b');
    expect(next.players[0].isHost).toBe(true);
  });
  it('only host can kick', () => {
    const room = createRoom(p('a'));
    joinRoom({ code: room.code, userId: 'b', username: 'B' });
    expect(() => kickPlayer('b', 'a')).toThrow('HOST_ONLY');
    expect(kickPlayer('a', 'b').players).toHaveLength(1);
  });
  it('hides no sensitive user data because room projection contains only public player fields', () => {
    const room = createRoom(p('a', 'Alice'));
    expect(JSON.stringify(room)).not.toContain('password');
    expect(getRoom(room.code)?.players[0].username).toBe('Alice');
  });
});
