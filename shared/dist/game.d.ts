import type { Card, GameConfig, PlayerAsset, TeamId } from './index.js';
export type Direction = 1 | -1;
export type GameStatus = 'waiting' | 'playing' | 'finished';
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
export type GameAction = {
    type: 'playCard';
    playerId: string;
    cardId: string;
} | {
    type: 'drawCard';
    playerId: string;
} | {
    type: 'chooseTeam';
    playerId: string;
    teamId: TeamId;
} | {
    type: 'attemptSave';
    playerId: string;
    accept: boolean;
} | {
    type: 'guessTeam';
    playerId: string;
    teamId: TeamId;
} | {
    type: 'switchCards';
    playerId: string;
    ownCardId: string;
    targetCardId: string;
} | {
    type: 'passSwitch';
    playerId: string;
} | {
    type: 'placeGoalkeeper';
    playerId: string;
    cardId: string;
} | {
    type: 'removeGoalkeeper';
    playerId: string;
};
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
        penaltyTimeoutBehavior?: 'failed';
        scoreByRank?: Record<number, number>;
    };
    playerAssets: PlayerAsset[];
    random?: () => number;
    now?: () => number;
    idFactory?: () => string;
}
export declare function createDeck(teams: string[], assets: PlayerAsset[], idFactory?: () => string): Card[];
export declare function shuffle<T>(items: T[], random?: () => number): T[];
export declare function cardMatches(card: Card, currentTeamId: TeamId, currentNumber?: number): boolean;
export declare function buildInitialState(playerIds: {
    id: string;
    username: string;
}[], options: EngineOptions): GameState;
export declare class GameEngine {
    readonly state: GameState;
    private readonly config;
    private readonly assets;
    private readonly random;
    private readonly now;
    private readonly idFactory;
    constructor(state: GameState, options: EngineOptions);
    dispatch(action: GameAction): GameEvent[];
    private event;
    private player;
    private currentPlayer;
    private assertTurn;
    private nextIndex;
    private advanceTurn;
    private reshuffleIfNeeded;
    private drawOne;
    private drawMany;
    private takeFromHand;
    private validateTeam;
    private playCard;
    private applyWarning;
    private applyRed;
    private applyFoul;
    private applyReverse;
    private startSwitch;
    private switchCards;
    private passSwitch;
    private startPenalty;
    private chooseTeam;
    private attemptSave;
    private guessTeam;
    private resolvePenaltyFailure;
    resolvePenaltyTimeout(now?: number): boolean;
    private drawCard;
    private placeGoalkeeper;
    private removeGoalkeeper;
    private maybeFinishAfterEffect;
    calculateRanking(): RankingEntry[];
}
