import { describe, expect, it } from 'vitest';
import { GameEngine, type Card, type GameConfig, type GameState, type PlayerAsset } from './game.js';

const config: GameConfig = {
  startingHandSize: 7, maxPlayers: 4, penaltyGuessSeconds: 5, nonNumberCardScore: 0,
  scoreByRank: { 1: 100, 2: 60, 3: 30, 4: 10 }, reshuffle: true, afkTimeoutMs: 300000,
  penaltyTimeout: 'failed', teams: ['brazil','argentina','france','portugal'], cardDistribution: {},
  allowGoalkeeperRemoveDuringOwnTurn: true, allowGoalkeeperReplace: false, reverseTwoPlayersActsAsSkip: false,
};
const assets: PlayerAsset[] = [];
let n=0; const id=()=>`edge-${++n}`;
const card=(type:Card['type'], extra:Partial<Card>={}):Card=>({id:id(),type,...extra});
const base=(players: Partial<GameState['players'][number]>[]):GameState=>({
  status:'playing', players:players.map((p,i)=>({id:`p${i+1}`,username:`P${i+1}`,hand:[],warnings:0,reds:0,connected:true,abandoned:false,...p})),
  drawPile:[card('number',{teamId:'brazil',number:8})], discardPile:[card('number',{teamId:'brazil',number:4})], currentTeamId:'brazil', currentNumber:4,
  currentPlayerIndex:0,direction:1,skipNext:false,winnerIds:[],finishedRanking:[],events:[],version:1,
});

describe('edge-case rules',()=>{
  it('does not finish before the last-card effect resolves',()=>{
    const foul=card('foul',{teamId:'brazil'}); const s=base([{hand:[foul]},{hand:[]}]);
    const e=new GameEngine(s,{config,playerAssets:assets,idFactory:id,random:()=>0.2,now:()=>1});
    e.dispatch({type:'playCard',playerId:'p1',cardId:foul.id});
    expect(s.status).toBe('finished'); expect(s.winnerIds).toEqual(['p1']); expect(s.players[1].hand).toHaveLength(0);
  });
  it('rejects playing a card when it does not match',()=>{
    const bad=card('number',{teamId:'argentina',number:9}); const s=base([{hand:[bad]}]);
    const e=new GameEngine(s,{config,playerAssets:assets,idFactory:id,random:()=>0.2,now:()=>1});
    expect(()=>e.dispatch({type:'playCard',playerId:'p1',cardId:bad.id})).toThrow();
  });
  it('does not let a non-turn player draw',()=>{
    const s=base([{hand:[]},{hand:[]}]); const e=new GameEngine(s,{config,playerAssets:assets,idFactory:id,random:()=>0.2,now:()=>1});
    expect(()=>e.dispatch({type:'drawCard',playerId:'p2'})).toThrow();
  });
});
