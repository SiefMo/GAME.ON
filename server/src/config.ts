import fs from 'node:fs';
import path from 'node:path';
import type { GameConfig, Team, PlayerAsset } from '@game-on/shared';
const root = process.cwd();
export const gameConfig = JSON.parse(fs.readFileSync(path.join(root,'config/game.json'),'utf8')) as GameConfig & { teams:string[]; cardDistribution:Record<string,number>; disconnectGraceMs:number; reconnectTokenTtlMs:number; disconnectBehavior:'cancel-match'|'mark-abandoned'|'bot-takeover'; abandonedPlayerTurnBehavior:'skip-turn'|'cancel-match'|'bot-takeover'; persistRuntimeState:boolean };
export const teams = JSON.parse(fs.readFileSync(path.join(root,'config/teams.json'),'utf8')) as Team[];
export const players = JSON.parse(fs.readFileSync(path.join(root,'config/players.json'),'utf8')) as PlayerAsset[];
