import type { Card as CardTypeDef, CardType, GameConfig, PlayerAsset, TeamId } from './index.js';
export type { Card as CardTypeDef } from './index.js';
export type Card = CardTypeDef;

export type Direction = 1 | -1;
export type GameStatus = 'waiting' | 'playing' | 'finished' | 'cancelled';

export interface PlayerState {
  id: string;
  username: string;
  hand: Card[];
  warnings: number;
  reds: number;
  goalkeeperCard?: Card;
  connected: boolean;
  abandoned: boolean;
}

export interface PenaltyState {
  attackerId: string;
  defenderId: string;
  attackerTeamId?: TeamId;
  phase: 'defender-decision' | 'attacker-choosing' | 'defender-guessing';
  deadlineAt?: number;
  chosenTeamId?: TeamId;
}

export interface SwitchState {
  playerId: string;
  targetPlayerId: string;
  phase: 'select-own' | 'select-target';
  ownCardId?: string;
}

export interface GameState {
  status: GameStatus;
  players: PlayerState[];
  drawPile: Card[];
  discardPile: Card[];
  currentTeamId: TeamId;
  currentNumber?: number;
  currentPlayerIndex: number;
  direction: Direction;
  skipNext: boolean;
  penalty?: PenaltyState;
  switchState?: SwitchState;
  redTeamChoicePlayerId?: string;
  winnerIds: string[];
  finishedRanking: RankingEntry[];
  events: GameEvent[];
  version: number;
}

export interface RankingEntry {
  playerId: string;
  rank: number;
  cardsRemaining: number;
  warnings: number;
  reds: number;
  numberSum: number;
  scoreEarned: number;
}

export type GameAction =
  | { type: 'playCard'; playerId: string; cardId: string }
  | { type: 'drawCard'; playerId: string }
  | { type: 'chooseTeam'; playerId: string; teamId: TeamId }
  | { type: 'attemptSave'; playerId: string; accept: boolean }
  | { type: 'guessTeam'; playerId: string; teamId: TeamId }
  | { type: 'switchCards'; playerId: string; ownCardId: string; targetCardId: string }
  | { type: 'passSwitch'; playerId: string }
  | { type: 'placeGoalkeeper'; playerId: string; cardId: string }
  | { type: 'removeGoalkeeper'; playerId: string };

export interface GameEvent {
  id: string;
  type: string;
  timestamp: number;
  actorId?: string;
  data?: Record<string, unknown>;
}

export interface EngineOptions {
  config: GameConfig & {
    teams: string[];
    allowGoalkeeperRemoveDuringOwnTurn?: boolean;
    allowGoalkeeperReplace?: boolean;
    reverseTwoPlayersActsAsSkip?: boolean;
    disconnectGraceMs?: number;
    reconnectTokenTtlMs?: number;
    disconnectBehavior?: 'cancel-match' | 'mark-abandoned' | 'bot-takeover';
    abandonedPlayerTurnBehavior?: 'skip-turn' | 'cancel-match' | 'bot-takeover';
    persistRuntimeState?: boolean;
    penaltyTimeoutBehavior?: 'failed';
    scoreByRank?: Record<number, number>;
  };
  playerAssets: PlayerAsset[];
  random?: () => number;
  now?: () => number;
  idFactory?: () => string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function defaultId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function createDeck(
  teams: string[],
  assets: PlayerAsset[],
  idFactory: () => string = defaultId,
): Card[] {
  const deck: Card[] = [];
  for (const teamId of teams) {
    const teamPlayers = assets.filter((p) => p.teamId === teamId);
    const zero = teamPlayers.find((p) => p.number === 0);
    assert(zero, `Missing number 0 asset for team ${teamId}`);
    deck.push({ id: idFactory(), type: 'number', number: 0, playerId: zero.id, hiddenTeamId: teamId });
    for (let n = 1; n <= 9; n++) {
      const player = teamPlayers.find((p) => p.number === n);
      assert(player, `Missing player asset ${teamId}-${n}`);
      for (let copy = 0; copy < 2; copy++) {
        deck.push({ id: idFactory(), type: 'number', number: n, playerId: player.id, teamId });
      }
    }
    for (let i = 0; i < 2; i++) deck.push({ id: idFactory(), type: 'warning', teamId });
    for (let i = 0; i < 2; i++) deck.push({ id: idFactory(), type: 'foul', teamId });
    deck.push({ id: idFactory(), type: 'reverse', teamId });
    deck.push({ id: idFactory(), type: 'switch', teamId });
    deck.push({ id: idFactory(), type: 'penalty' });
    deck.push({ id: idFactory(), type: 'red' });
  }
  assert(deck.length === 108, `Deck must contain 108 cards, got ${deck.length}`);
  return deck;
}

export function shuffle<T>(items: T[], random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function cardMatches(card: Card, currentTeamId: TeamId, currentNumber?: number): boolean {
  if (card.type === 'penalty' || card.type === 'red') return true;
  if (card.type !== 'number' && card.type !== 'warning' && card.type !== 'foul' && card.type !== 'reverse' && card.type !== 'switch') return false;
  if (card.type === 'number' && card.number === 0) {
    return card.hiddenTeamId === currentTeamId || currentNumber === 0;
  }
  return card.teamId === currentTeamId || (card.type === 'number' && card.number === currentNumber);
}

export function buildInitialState(
  playerIds: { id: string; username: string }[],
  options: EngineOptions,
): GameState {
  assert(playerIds.length >= 2 && playerIds.length <= options.config.maxPlayers, 'Player count must be 2-4');
  const deck = shuffle(createDeck(options.config.teams, options.playerAssets, options.idFactory), options.random);
  const players: PlayerState[] = playerIds.map((p) => ({ id: p.id, username: p.username, hand: [], warnings: 0, reds: 0, connected: true, abandoned: false }));
  for (let i = 0; i < options.config.startingHandSize; i++) for (const p of players) p.hand.push(deck.pop()!);
  let startingIndex = -1;
  for (let i = deck.length - 1; i >= 0; i--) { if (deck[i].type === 'number') { startingIndex = i; break; } }
  assert(startingIndex >= 0, 'Deck has no number card');
  const top = deck.splice(startingIndex, 1)[0];
  const discardPile = [top];
  return {
    status: 'playing', players, drawPile: deck, discardPile,
    currentTeamId: top.hiddenTeamId ?? top.teamId!, currentNumber: top.number,
    currentPlayerIndex: 0, direction: 1, skipNext: false,
    winnerIds: [], finishedRanking: [], events: [], version: 1,
  };
}

export class GameEngine {
  readonly state: GameState;
  private readonly config: EngineOptions['config'];
  private readonly assets: PlayerAsset[];
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(state: GameState, options: EngineOptions) {
    this.state = state;
    this.config = options.config;
    this.assets = options.playerAssets;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? defaultId;
  }

  dispatch(action: GameAction): GameEvent[] {
    assert(this.state.status === 'playing', 'Game is not active');
    const before = this.state.events.length;
    switch (action.type) {
      case 'playCard': return this.playCard(action.playerId, action.cardId);
      case 'drawCard': return this.drawCard(action.playerId);
      case 'chooseTeam': return this.chooseTeam(action.playerId, action.teamId);
      case 'attemptSave': return this.attemptSave(action.playerId, action.accept);
      case 'guessTeam': return this.guessTeam(action.playerId, action.teamId);
      case 'switchCards': return this.switchCards(action.playerId, action.ownCardId, action.targetCardId);
      case 'passSwitch': return this.passSwitch(action.playerId);
      case 'placeGoalkeeper': return this.placeGoalkeeper(action.playerId, action.cardId);
      case 'removeGoalkeeper': return this.removeGoalkeeper(action.playerId);
    }
    return this.state.events.slice(before);
  }

  private event(type: string, actorId?: string, data?: Record<string, unknown>): void {
    this.state.events.push({ id: this.idFactory(), type, timestamp: this.now(), actorId, data });
    this.state.version++;
  }

  private player(id: string): PlayerState {
    const p = this.state.players.find((x) => x.id === id);
    assert(p, 'Player not found');
    return p;
  }

  private currentPlayer(): PlayerState { const p = this.state.players[this.state.currentPlayerIndex]; assert(p, 'Current player not found'); return p; }

  private assertTurn(id: string): void { assert(this.currentPlayer().id === id, 'Not your turn'); }

  private nextIndex(from = this.state.currentPlayerIndex, steps = 1): number {
    const n = this.state.players.length;
    let idx = from;
    for (let i = 0; i < steps; i++) idx = (idx + this.state.direction + n) % n;
    return idx;
  }

  private advanceTurn(steps = 1): void {
    this.state.currentPlayerIndex = this.nextIndex(this.state.currentPlayerIndex, steps);
  }

  private reshuffleIfNeeded(): void {
    if (this.state.drawPile.length > 0 || !this.config.reshuffle) return;
    assert(this.state.discardPile.length > 1, 'No cards available to draw');
    const top = this.state.discardPile[this.state.discardPile.length - 1];
    const reusable = this.state.discardPile.slice(0, -1);
    this.state.discardPile = [top];
    this.state.drawPile = shuffle(reusable, this.random);
    this.event('drawPile:reshuffled');
  }

  private drawOne(p: PlayerState): Card {
    this.reshuffleIfNeeded();
    assert(this.state.drawPile.length > 0, 'No cards available to draw');
    const card = this.state.drawPile.pop()!;
    p.hand.push(card);
    return card;
  }

  private drawMany(p: PlayerState, count: number): void { for (let i = 0; i < count; i++) this.drawOne(p); }

  private takeFromHand(p: PlayerState, cardId: string): Card {
    const index = p.hand.findIndex((c) => c.id === cardId);
    assert(index >= 0, 'Card is not owned by player');
    return p.hand.splice(index, 1)[0];
  }

  private validateTeam(teamId: TeamId): void { assert(this.config.teams.includes(teamId), 'Invalid team'); }

  private playCard(playerId: string, cardId: string): GameEvent[] {
    this.assertTurn(playerId);
    const p = this.player(playerId);
    const card = p.hand.find((c) => c.id === cardId);
    assert(card, 'Card is not owned by player');
    assert(cardMatches(card, this.state.currentTeamId, this.state.currentNumber), 'Card cannot be played here');
    const eventsBefore = this.state.events.length;
    const played = this.takeFromHand(p, cardId);
    this.state.discardPile.push(played);
    this.state.currentNumber = played.number;
    if (played.type === 'number') this.state.currentTeamId = played.hiddenTeamId ?? played.teamId!;
    this.event('card:played', playerId, { cardId: played.id, cardType: played.type });

    switch (played.type) {
      case 'warning': this.applyWarning(playerId); break;
      case 'foul': this.applyFoul(playerId); break;
      case 'reverse': this.applyReverse(playerId); break;
      case 'switch': this.startSwitch(playerId); break;
      case 'penalty': this.startPenalty(playerId); break;
      case 'red': this.applyRed(playerId); break;
      case 'number': this.advanceTurn(); break;
    }
    this.maybeFinishAfterEffect(playerId);
    return this.state.events.slice(eventsBefore);
  }

  private applyWarning(actorId: string): void {
    const target = this.state.players[this.nextIndex()];
    if (target.warnings === 1) {
      target.warnings = 0;
      target.reds += 1;
      this.event('player:warningConvertedToRed', target.id, { redCounter: target.reds });
    } else target.warnings += 1;
    this.drawMany(target, 2);
    this.event('player:drew', target.id, { count: 2, reason: 'warning' });
    this.advanceTurn();
  }

  private applyRed(actorId: string): void {
    const target = this.state.players[this.nextIndex()];
    target.reds += 1;
    this.drawMany(target, 4);
    this.event('player:drew', target.id, { count: 4, reason: 'red' });
    if (target.reds >= 3) {
      target.reds = 0;
      this.state.skipNext = true;
      this.event('player:redThreshold', target.id, { skipNext: true });
    }
    this.state.redTeamChoicePlayerId = actorId;
    this.event('red:awaitingTeamChoice', actorId);
  }

  private applyFoul(actorId: string): void {
    const skipped = this.state.players[this.nextIndex()];
    this.advanceTurn(2);
    this.event('turn:foulSkip', actorId, { skippedPlayerId: skipped.id });
  }

  private applyReverse(actorId: string): void {
    this.state.direction = this.state.direction === 1 ? -1 : 1;
    const steps = this.state.players.length === 2 && this.config.reverseTwoPlayersActsAsSkip ? 2 : 1;
    this.advanceTurn(steps);
    this.event('turn:reversed', actorId, { direction: this.state.direction, twoPlayerSkip: steps === 2 });
  }

  private startSwitch(playerId: string): void {
    const target = this.state.players[this.nextIndex()];
    this.state.switchState = { playerId, targetPlayerId: target.id, phase: 'select-own' };
    this.event('switch:awaitingSelection', playerId, { targetPlayerId: target.id });
  }

  private switchCards(playerId: string, ownCardId: string, targetCardId: string): GameEvent[] {
    this.assertTurn(playerId);
    const s = this.state.switchState;
    assert(s?.playerId === playerId, 'No Switch action pending for player');
    assert(s.targetPlayerId !== playerId, 'Invalid Switch target');
    const owner = this.player(playerId); const target = this.player(s.targetPlayerId);
    const own = this.takeFromHand(owner, ownCardId);
    const other = this.takeFromHand(target, targetCardId);
    owner.hand.push(other); target.hand.push(own);
    this.state.switchState = undefined;
    this.event('switch:completed', playerId, { targetPlayerId: target.id, ownCardId, targetCardId });
    this.advanceTurn();
    this.maybeFinishAfterEffect(playerId);
    return this.state.events.slice(-2);
  }

  private passSwitch(playerId: string): GameEvent[] {
    this.assertTurn(playerId);
    assert(this.state.switchState?.playerId === playerId, 'No Switch action pending for player');
    const eventsBefore = this.state.events.length;
    this.state.switchState = undefined;
    this.event('switch:passed', playerId);
    this.advanceTurn();
    this.maybeFinishAfterEffect(playerId);
    return this.state.events.slice(eventsBefore);
  }

  private startPenalty(playerId: string): void {
    const defender = this.state.players[this.nextIndex()];
    const hasGoalkeeper = Boolean(defender.goalkeeperCard);
    this.state.penalty = {
      attackerId: playerId,
      defenderId: defender.id,
      phase: hasGoalkeeper ? 'defender-decision' : 'attacker-choosing',
    };
    this.event(hasGoalkeeper ? 'penalty:awaitingDefenseDecision' : 'penalty:awaitingAttackerChoice', playerId, { defenderId: defender.id });
  }

  private chooseTeam(playerId: string, teamId: TeamId): GameEvent[] {
    this.validateTeam(teamId);
    const eventsBefore = this.state.events.length;
    if (this.state.redTeamChoicePlayerId) {
      assert(this.state.redTeamChoicePlayerId === playerId, 'Only Red Card player can choose team');
      this.state.currentTeamId = teamId;
      this.state.currentNumber = undefined;
      this.state.redTeamChoicePlayerId = undefined;
      this.advanceTurn();
      if (this.state.skipNext) {
        const skipped = this.currentPlayer();
        this.advanceTurn();
        this.state.skipNext = false;
        this.event('turn:skipped', skipped.id, { reason: 'third-red' });
      }
      this.event('red:teamChosen', playerId, { teamId });
      this.maybeFinishAfterEffect(playerId);
      return this.state.events.slice(eventsBefore);
    }
    const penalty = this.state.penalty;
    assert(penalty, 'No team choice is pending');
    if (penalty.phase === 'attacker-choosing') {
      assert(penalty.attackerId === playerId, 'Only penalty attacker can choose');
      penalty.chosenTeamId = teamId;
      const defender = this.player(penalty.defenderId);
      if (defender.goalkeeperCard) {
        penalty.phase = 'defender-guessing';
        penalty.deadlineAt = this.now() + this.config.penaltyGuessSeconds * 1000;
        this.event('penalty:teamChosen', playerId, { hidden: true });
      } else {
        this.state.currentTeamId = teamId;
        this.state.currentNumber = undefined;
        this.state.penalty = undefined;
        this.event('penalty:noGoalkeeper', playerId, { teamId });
        this.advanceTurn();
        this.maybeFinishAfterEffect(playerId);
      }
    } else throw new Error('Team choice is not valid in this phase');
    return this.state.events.slice(eventsBefore);
  }

  private attemptSave(playerId: string, accept: boolean): GameEvent[] {
    const eventsBefore = this.state.events.length;
    const penalty = this.state.penalty;
    assert(penalty, 'No penalty pending');
    assert(penalty.defenderId === playerId, 'Only defender can respond');
    assert(penalty.phase === 'defender-decision', 'Save decision is no longer available');
    if (!accept) this.resolvePenaltyFailure('declined');
    else {
      this.event('penalty:saveAccepted', playerId);
      penalty.phase = 'attacker-choosing';
    }
    return this.state.events.slice(eventsBefore);
  }

  private guessTeam(playerId: string, teamId: TeamId): GameEvent[] {
    this.validateTeam(teamId);
    const eventsBefore = this.state.events.length;
    const penalty = this.state.penalty;
    assert(penalty?.phase === 'defender-guessing', 'No guess is pending');
    assert(penalty.defenderId === playerId, 'Only defender can guess');
    assert(penalty.deadlineAt !== undefined && this.now() <= penalty.deadlineAt, 'Penalty guess timed out');
    if (teamId === penalty.chosenTeamId) {
      this.event('penalty:saveSucceeded', playerId);
      this.state.currentTeamId = teamId;
      this.state.currentNumber = undefined;
      this.state.penalty = undefined;
      this.advanceTurn();
      this.maybeFinishAfterEffect(penalty.attackerId);
    } else this.resolvePenaltyFailure('wrong-guess');
    return this.state.events.slice(eventsBefore);
  }

  private resolvePenaltyFailure(reason: 'declined' | 'wrong-guess' | 'timeout'): void {
    const penalty = this.state.penalty!;
    const defender = this.player(penalty.defenderId);
    this.drawOne(defender);
    this.event('penalty:saveFailed', defender.id, { reason });
    this.state.currentTeamId = penalty.chosenTeamId!;
    this.state.currentNumber = undefined;
    this.state.penalty = undefined;
    this.advanceTurn();
    this.maybeFinishAfterEffect(penalty.attackerId);
  }

  public resolvePenaltyTimeout(now = this.now()): boolean {
    const p = this.state.penalty;
    if (!p || p.phase !== 'defender-guessing' || p.deadlineAt === undefined || now <= p.deadlineAt) return false;
    this.resolvePenaltyFailure('timeout');
    return true;
  }

  /** Operational recovery hook used when a disconnected player exceeds the configured grace period. */
  public abandonPlayer(playerId: string): GameEvent[] {
    const eventsBefore = this.state.events.length;
    const player = this.player(playerId);
    if (player.abandoned) return [];
    player.abandoned = true;
    player.connected = false;
    this.event('player:abandoned', playerId);

    const pendingPenalty = this.state.penalty;
    const pendingSwitch = this.state.switchState;
    if (pendingPenalty && (pendingPenalty.attackerId === playerId || pendingPenalty.defenderId === playerId)) {
      this.state.penalty = undefined;
      this.state.currentTeamId = this.state.currentTeamId;
      this.event('penalty:cancelledForAbandonment', playerId);
      this.advanceTurn();
    } else if (pendingSwitch && (pendingSwitch.playerId === playerId || pendingSwitch.targetPlayerId === playerId)) {
      this.state.switchState = undefined;
      this.event('switch:cancelledForAbandonment', playerId);
      this.advanceTurn();
    } else if (this.state.redTeamChoicePlayerId === playerId) {
      this.state.redTeamChoicePlayerId = undefined;
      this.state.skipNext = false;
      this.event('red:teamChoiceCancelledForAbandonment', playerId);
      this.advanceTurn();
    } else if (this.currentPlayer().id === playerId) {
      this.advanceTurn();
      this.event('turn:skipped', playerId, { reason: 'abandoned-player' });
    }
    return this.state.events.slice(eventsBefore);
  }

  private drawCard(playerId: string): GameEvent[] {
    this.assertTurn(playerId);
    const eventsBefore = this.state.events.length;
    const p = this.player(playerId);
    const card = this.drawOne(p);
    this.event('player:drew', playerId, { count: 1, cardId: card.id });
    this.advanceTurn();
    return this.state.events.slice(eventsBefore);
  }

  private placeGoalkeeper(playerId: string, cardId: string): GameEvent[] {
    const p = this.player(playerId);
    const card = p.hand.find((c) => c.id === cardId);
    assert(card, 'Card is not owned by player');
    assert(card.type === 'number' && card.playerId !== undefined, 'Only number cards can be goalkeeper cards');
    const asset = this.assets.find((a) => a.id === card.playerId);
    assert(asset?.goalkeeper, 'Card is not a goalkeeper');
    assert(!p.goalkeeperCard, 'Goalkeeper slot is occupied');
    p.hand = p.hand.filter((c) => c.id !== cardId);
    p.goalkeeperCard = card;
    this.event('goalkeeper:placed', playerId, { cardId });
    return this.state.events.slice(-1);
  }

  private removeGoalkeeper(playerId: string): GameEvent[] {
    const p = this.player(playerId);
    assert(this.config.allowGoalkeeperRemoveDuringOwnTurn !== false, 'Goalkeeper removal is disabled');
    this.assertTurn(playerId);
    assert(p.goalkeeperCard, 'No goalkeeper in slot');
    const card = p.goalkeeperCard;
    p.hand.push(card);
    p.goalkeeperCard = undefined;
    this.event('goalkeeper:removed', playerId, { cardId: card.id });
    return this.state.events.slice(-1);
  }


  private maybeFinishAfterEffect(lastActorId: string): void {
    if (this.state.penalty || this.state.switchState || this.state.redTeamChoicePlayerId) return;
    const actor = this.player(lastActorId);
    if (actor.hand.length !== 0) return;
    const ranking = this.calculateRanking();
    this.state.winnerIds = ranking.filter((r) => r.rank === 1).map((r) => r.playerId);
    this.state.finishedRanking = ranking;
    this.state.status = 'finished';
    this.event('match:finished', lastActorId, { winnerIds: this.state.winnerIds });
  }

  calculateRanking(): RankingEntry[] {
    const ranked = this.state.players.map((p) => ({
      playerId: p.id,
      rank: 0,
      cardsRemaining: p.hand.length,
      warnings: p.warnings,
      reds: p.reds,
      numberSum: p.hand.reduce((sum, c) => sum + (c.type === 'number' ? c.number ?? 0 : 0), 0),
      scoreEarned: 0,
    })).sort((a, b) => a.cardsRemaining - b.cardsRemaining || a.warnings - b.warnings || a.reds - b.reds || a.numberSum - b.numberSum);
    let rank = 1;
    for (let i = 0; i < ranked.length; i++) {
      if (i > 0) {
        const prev = ranked[i - 1]; const cur = ranked[i];
        if (prev.cardsRemaining !== cur.cardsRemaining || prev.warnings !== cur.warnings || prev.reds !== cur.reds || prev.numberSum !== cur.numberSum) rank = i + 1;
      }
      ranked[i].rank = rank;
      ranked[i].scoreEarned = this.config.scoreByRank?.[rank] ?? 0;
    }
    return ranked;
  }
}
