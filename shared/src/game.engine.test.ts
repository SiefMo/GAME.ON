import { describe, expect, it } from 'vitest';
import { buildInitialState, cardMatches, createDeck, GameEngine, type Card, type GameState, type PlayerState } from './game.js';
import type { GameConfig, PlayerAsset } from './index.js';

const teams = ['brazil', 'argentina', 'france', 'portugal'];
const assets: PlayerAsset[] = teams.flatMap((teamId) => [
  { id: `${teamId}-0`, name: `${teamId} retired`, teamId, number: 0, image: 'placeholder', goalkeeper: false, retired: true },
  ...Array.from({ length: 9 }, (_, i) => ({ id: `${teamId}-${i + 1}`, name: `${teamId} player ${i + 1}`, teamId, number: i + 1, image: 'placeholder', goalkeeper: i === 0, retired: false })),
]);
const config: GameConfig = {
  startingHandSize: 7, maxPlayers: 4, penaltyGuessSeconds: 5, nonNumberCardScore: 0,
  scoreByRank: { 1: 100, 2: 60, 3: 30, 4: 10 }, reshuffle: true, afkTimeoutMs: 300000,
  penaltyTimeout: 'failed', teams, cardDistribution: {}, allowGoalkeeperRemoveDuringOwnTurn: true,
  allowGoalkeeperReplace: false, reverseTwoPlayersActsAsSkip: false,
};
let ids = 0;
const id = () => `t${++ids}`;
const opts = (now = 1_000) => ({ config, playerAssets: assets, idFactory: id, random: () => 0.25, now: () => now });
const c = (type: Card['type'], extra: Partial<Card> = {}): Card => ({ id: id(), type, ...extra });
function stateWith(players: Partial<PlayerState>[], drawPile: Card[] = [c('number', { number: 9, teamId: 'brazil' })]): GameState {
  return {
    status: 'playing', players: players.map((p, i) => ({ id: `p${i + 1}`, username: `P${i + 1}`, hand: [], warnings: 0, reds: 0, connected: true, abandoned: false, ...p })),
    drawPile, discardPile: [c('number', { number: 5, teamId: 'brazil' })], currentTeamId: 'brazil', currentNumber: 5,
    currentPlayerIndex: 0, direction: 1, skipNext: false, winnerIds: [], finishedRanking: [], events: [], version: 1,
  };
}

it('builds exactly 108 cards and starts with 7-card hands and a Number top card', () => {
  const deck = createDeck(teams, assets, id);
  expect(deck).toHaveLength(108);
  expect(deck.filter((x) => x.type === 'number')).toHaveLength(76);
  expect(deck.filter((x) => x.type === 'warning')).toHaveLength(8);
  const s = buildInitialState([{ id: 'a', username: 'A' }, { id: 'b', username: 'B' }], opts());
  expect(s.players.every((p) => p.hand.length === 7)).toBe(true);
  expect(s.discardPile[0].type).toBe('number');
});

describe('matching', () => {
  it('matches same number and same team, rejects invalid cards', () => {
    expect(cardMatches(c('number', { number: 5, teamId: 'argentina' }), 'brazil', 5)).toBe(true);
    expect(cardMatches(c('number', { number: 4, teamId: 'brazil' }), 'brazil', 5)).toBe(true);
    expect(cardMatches(c('number', { number: 4, teamId: 'argentina' }), 'brazil', 5)).toBe(false);
  });
  it('uses hidden Team for 0 without exposing it as public team', () => {
    const zero = c('number', { number: 0, hiddenTeamId: 'brazil' });
    expect(zero.teamId).toBeUndefined();
    expect(cardMatches(zero, 'brazil', 8)).toBe(true);
    expect(cardMatches(zero, 'argentina', 0)).toBe(true);
    expect(cardMatches(zero, 'argentina', 8)).toBe(false);
  });
});

describe('effects', () => {
  it('Warning draws 2 and increments Warning; second Warning converts to Red while still drawing 2', () => {
    const s = stateWith([{ hand: [c('warning', { teamId: 'brazil' })] }, { warnings: 0 }], [c('number', { number: 1, teamId: 'brazil' }), c('number', { number: 2, teamId: 'brazil' })]);
    const e = new GameEngine(s, opts());
    e.dispatch({ type: 'playCard', playerId: 'p1', cardId: s.players[0].hand[0].id });
    expect(s.players[1].warnings).toBe(1); expect(s.players[1].hand).toHaveLength(2); expect(s.currentPlayerIndex).toBe(1);
    s.players[1].warnings = 1; s.players[0].hand.push(c('warning', { teamId: 'brazil' })); s.currentPlayerIndex = 0;
    s.drawPile.push(c('number', { number: 3, teamId: 'brazil' }), c('number', { number: 4, teamId: 'brazil' }));
    e.dispatch({ type: 'playCard', playerId: 'p1', cardId: s.players[0].hand.at(-1)!.id });
    expect(s.players[1].warnings).toBe(0); expect(s.players[1].reds).toBe(1); expect(s.players[1].hand).toHaveLength(4);
  });
  it('Foul skips exactly the next player', () => {
    const s = stateWith([{ hand: [c('foul', { teamId: 'brazil' })] }, {}, {}]);
    new GameEngine(s, opts()).dispatch({ type: 'playCard', playerId: 'p1', cardId: s.players[0].hand[0].id });
    expect(s.currentPlayerIndex).toBe(2);
  });
  it('Reverse changes direction and handles two-player behavior by config', () => {
    const s = stateWith([{ hand: [c('reverse', { teamId: 'brazil' })] }, {}]);
    new GameEngine(s, opts()).dispatch({ type: 'playCard', playerId: 'p1', cardId: s.players[0].hand[0].id });
    expect(s.direction).toBe(-1); expect(s.currentPlayerIndex).toBe(1);
    const cfg = { ...config, reverseTwoPlayersActsAsSkip: true };
    const s2 = stateWith([{ hand: [c('reverse', { teamId: 'brazil' })] }, {}]);
    new GameEngine(s2, { ...opts(), config: cfg }).dispatch({ type: 'playCard', playerId: 'p1', cardId: s2.players[0].hand[0].id });
    expect(s2.currentPlayerIndex).toBe(0);
  });
  it('Switch exchanges exactly one card and the Switch owner decides', () => {
    const own = c('number', { number: 4, teamId: 'brazil' }); const theirs = c('number', { number: 7, teamId: 'argentina' });
    const sw = c('switch', { teamId: 'brazil' });
    const s = stateWith([{ hand: [sw, own] }, { hand: [theirs, c('number', { number: 8, teamId: 'argentina' })] }]);
    const e = new GameEngine(s, opts()); e.dispatch({ type: 'playCard', playerId: 'p1', cardId: sw.id });
    e.dispatch({ type: 'switchCards', playerId: 'p1', ownCardId: own.id, targetCardId: theirs.id });
    expect(s.players[0].hand.map(x => x.id)).toContain(theirs.id); expect(s.players[1].hand.map(x => x.id)).toContain(own.id);
    expect(s.players[0].hand).toHaveLength(2); expect(s.players[1].hand).toHaveLength(2);
  });
  it('Switch can be passed without an exchange', () => {
    const sw = c('switch', { teamId: 'brazil' }); const s = stateWith([{ hand: [sw] }, {}]);
    const e = new GameEngine(s, opts()); e.dispatch({ type: 'playCard', playerId: 'p1', cardId: sw.id }); e.dispatch({ type: 'passSwitch', playerId: 'p1' });
    expect(s.currentPlayerIndex).toBe(1); expect(s.players[0].hand).toHaveLength(0);
  });
  it('Red draws 4, is wild, and third accumulated Red resets counter and skips the target next turn', () => {
    const red = c('red'); const s = stateWith([{ hand: [red] }, { reds: 2 }], [c('number', { number: 1, teamId: 'brazil' }), c('number', { number: 2, teamId: 'brazil' }), c('number', { number: 3, teamId: 'brazil' }), c('number', { number: 4, teamId: 'brazil' })]);
    const e = new GameEngine(s, opts()); e.dispatch({ type: 'playCard', playerId: 'p1', cardId: red.id });
    expect(s.players[1].reds).toBe(0); expect(s.players[1].hand).toHaveLength(4); expect(s.skipNext).toBe(true); expect(s.currentPlayerIndex).toBe(0);
    e.dispatch({ type: 'chooseTeam', playerId: 'p1', teamId: 'argentina' });
    expect(s.skipNext).toBe(false); expect(s.currentPlayerIndex).toBe(0); expect(s.currentTeamId).toBe('argentina');
  });
});

describe('penalty and goalkeeper', () => {
  it('no goalkeeper: attacker chooses Team and no extra draw occurs', () => {
    const penalty = c('penalty'); const s = stateWith([{ hand: [penalty] }, { hand: [] }]);
    const e = new GameEngine(s, opts()); e.dispatch({ type: 'playCard', playerId: 'p1', cardId: penalty.id }); e.dispatch({ type: 'chooseTeam', playerId: 'p1', teamId: 'france' });
    expect(s.currentTeamId).toBe('france'); expect(s.players[1].hand).toHaveLength(0); expect(s.currentPlayerIndex).toBe(1);
  });
  it('goalkeeper Save: accept, hidden attacker choice, correct guess succeeds', () => {
    const penalty = c('penalty'); const gk = c('number', { number: 1, teamId: 'argentina', playerId: 'argentina-1' });
    const s = stateWith([{ hand: [penalty] }, { goalkeeperCard: gk }]);
    let now = 10_000; const e = new GameEngine(s, { ...opts(), now: () => now });
    e.dispatch({ type: 'playCard', playerId: 'p1', cardId: penalty.id });
    expect(s.penalty?.phase).toBe('defender-decision');
    e.dispatch({ type: 'attemptSave', playerId: 'p2', accept: true });
    e.dispatch({ type: 'chooseTeam', playerId: 'p1', teamId: 'portugal' });
    expect(s.penalty?.chosenTeamId).toBe('portugal'); expect(s.penalty?.deadlineAt).toBe(15_000);
    e.dispatch({ type: 'guessTeam', playerId: 'p2', teamId: 'portugal' });
    expect(s.penalty).toBeUndefined(); expect(s.currentTeamId).toBe('portugal');
  });
  it('wrong guess draws 1 and applies attacker Team', () => {
    const penalty = c('penalty'); const gk = c('number', { number: 1, teamId: 'argentina', playerId: 'argentina-1' });
    const s = stateWith([{ hand: [penalty] }, { goalkeeperCard: gk }], [c('number', { number: 9, teamId: 'france' })]);
    const e = new GameEngine(s, opts()); e.dispatch({ type: 'playCard', playerId: 'p1', cardId: penalty.id }); e.dispatch({ type: 'attemptSave', playerId: 'p2', accept: true }); e.dispatch({ type: 'chooseTeam', playerId: 'p1', teamId: 'portugal' }); e.dispatch({ type: 'guessTeam', playerId: 'p2', teamId: 'france' });
    expect(s.players[1].hand).toHaveLength(1); expect(s.currentTeamId).toBe('portugal');
  });
  it('timeout is a failed defense', () => {
    const penalty = c('penalty'); const gk = c('number', { number: 1, teamId: 'argentina', playerId: 'argentina-1' });
    const s = stateWith([{ hand: [penalty] }, { goalkeeperCard: gk }], [c('number', { number: 9, teamId: 'france' })]); let now = 1000;
    const e = new GameEngine(s, { ...opts(), now: () => now }); e.dispatch({ type: 'playCard', playerId: 'p1', cardId: penalty.id }); e.dispatch({ type: 'attemptSave', playerId: 'p2', accept: true }); e.dispatch({ type: 'chooseTeam', playerId: 'p1', teamId: 'portugal' });
    now = 7000; expect(e.resolvePenaltyTimeout()).toBe(true); expect(s.players[1].hand).toHaveLength(1); expect(s.currentTeamId).toBe('portugal');
  });
});

describe('last card and ranking', () => {
  it('applies last-card function effect before finishing', () => {
    const warning = c('warning', { teamId: 'brazil' }); const s = stateWith([{ hand: [warning] }, {}], [c('number', { number: 1, teamId: 'brazil' }), c('number', { number: 2, teamId: 'brazil' })]);
    new GameEngine(s, opts()).dispatch({ type: 'playCard', playerId: 'p1', cardId: warning.id });
    expect(s.status).toBe('finished'); expect(s.players[1].hand).toHaveLength(2); expect(s.winnerIds).toEqual(['p1']);
  });
  it('ranks by cards, warnings, reds, then number sum and preserves full ties', () => {
    const s = stateWith([{ hand: [] }, { warnings: 1, hand: [] }, { reds: 1, hand: [] }, { hand: [c('number', { number: 2, teamId: 'brazil' })] }]);
    const e = new GameEngine(s, opts()); const r = e.calculateRanking();
    expect(r.map(x => [x.rank, x.playerId])).toEqual([[1, 'p1'], [2, 'p2'], [3, 'p3'], [4, 'p4']]);
    const tie = stateWith([{ hand: [] }, { hand: [] }]); expect(new GameEngine(tie, opts()).calculateRanking().map(x => x.rank)).toEqual([1, 1]);
  });
});

describe('reshuffle', () => {
  it('reuses discard except top card without losing the top', () => {
    const draw = c('number', { number: 2, teamId: 'brazil' }); const old = c('number', { number: 3, teamId: 'brazil' }); const top = c('number', { number: 4, teamId: 'brazil' });
    const s = stateWith([{ hand: [] }, {}], [draw]); s.discardPile = [old, top];
    const e = new GameEngine(s, opts()); e.dispatch({ type: 'drawCard', playerId: 'p1' });
    expect(s.discardPile).toHaveLength(1); expect(s.discardPile[0].id).toBe(top.id); expect(s.players[0].hand).toHaveLength(1);
  });
});
