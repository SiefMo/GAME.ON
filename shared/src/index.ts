export type TeamId = string;
export type CardType = 'number' | 'warning' | 'foul' | 'reverse' | 'switch' | 'penalty' | 'red';

export interface Team { id: TeamId; name: string; color: string; logo: string; flag: string; }
export interface PlayerAsset { id: string; name: string; teamId: TeamId; number: number; image: string; goalkeeper: boolean; retired: boolean; }
export interface GameConfig {
  startingHandSize: number;
  maxPlayers: number;
  penaltyGuessSeconds: number;
  nonNumberCardScore: number;
  scoreByRank: Record<number, number>;
  reshuffle: boolean;
  afkTimeoutMs: number;
  penaltyTimeout: 'failed';
  teams: string[];
  cardDistribution: Record<string, number>;
  allowGoalkeeperRemoveDuringOwnTurn?: boolean;
  allowGoalkeeperReplace?: boolean;
  reverseTwoPlayersActsAsSkip?: boolean;
}
export interface Card { id: string; type: CardType; teamId?: TeamId; number?: number; playerId?: string; hiddenTeamId?: TeamId; }
export interface HealthResponse { ok: true; service: 'game-on-server'; timestamp: string; }
export * from './game.js';

export interface SocketRequest { requestId: string; }
export interface SocketAck { ok: boolean; version?: number; code?: string; message?: string; }
