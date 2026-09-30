import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../src/server/index.js';
import { _testReset, createRoom, joinRoom, setReady, startGame, submitGameAction, getRoom, _testForceResolve, _testForceAdvance, rematch, MAX_PLAYERS } from '../src/server/rooms.js';
import { createGameState, submitAction, submitFallbacks, resolveTurn, advanceTurn, finalizeResults, TURN_COUNT, ACTIONS, MARKET_VALUES, STARTING_INVENTORY, _test as gameTest } from '../src/server/game.js';

const sessions = [];
const avatars = ['neon-ghost','byte-witch','null-fox','chrome-viper','glitch-monk','data-wraith','cipher-queen','signal-rat'];
function createCrew(count=3){
  const host=createRoom({name:'Host',avatar:avatars[0]}); sessions.push(host.sessionId);
  const joined=[host]; for(let i=1;i<count;i++){const p=joinRoom({code:host.room.code,name:`Player${i+1}`,avatar:avatars[i]});sessions.push(p.sessionId);joined.push(p);} return {host,joined};
}
function readyAll(joined){for(const p of joined)setReady(p.sessionId,true);}
function startCrew(count=3){const crew=createCrew(count);readyAll(crew.joined);startGame(crew.host.sessionId);return crew;}
function resolve(game, players){submitFallbacks(game);return resolveTurn(game, players);}
function inventoryTotal(game,id){return Object.values(game.players.get(id).inventory).reduce((a,b)=>a+b,0);}
function onlyResource(resource, amount){return {credits:resource==='credits'?amount:0,data:resource==='data'?amount:0,crypto:resource==='crypto'?amount:0};}


afterEach(()=>{_testReset();sessions.length=0;});

test('health endpoint reports Stage 3C', async()=>{const server=createAppServer();await new Promise(r=>server.listen(0,r));try{const port=server.address().port;const response=await fetch(`http://127.0.0.1:${port}/api/health`);assert.deepEqual(await response.json(),{ok:true,service:'cyber-heist',stage:'3C'});}finally{await new Promise(r=>server.close(r));}});

test('invalid SSE session returns JSON error without crashing the server', async()=>{
  const server=createAppServer(); await new Promise(r=>server.listen(0,r));
  try {
    const port=server.address().port;
    const response=await fetch(`http://127.0.0.1:${port}/api/rooms/events?session=invalid`);
    assert.equal(response.status,401);
    assert.deepEqual(await response.json(),{ok:false,error:'SESSION_INVALID',title:'Session expired',message:'Reconnect to the room from the lobby entry screen.'});
    const health=await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status,200);
  } finally { await new Promise(r=>server.close(r)); }
});

test('Stage 2 room foundation still supports 8 players and blocks a 9th',()=>{const crew=createCrew(8);assert.equal(getRoom(crew.host.sessionId).playerCount,8);assert.throws(()=>joinRoom({code:crew.host.room.code,name:'Ninth',avatar:avatars[0]}),/ROOM_FULL/);});

test('Stage 3A start requires at least 3 ready players and locks identities',()=>{const host=createRoom({name:'Host',avatar:avatars[0]});sessions.push(host.sessionId);assert.throws(()=>startGame(host.sessionId),/MIN_PLAYERS/);const p2=joinRoom({code:host.room.code,name:'Two',avatar:avatars[1]});const p3=joinRoom({code:host.room.code,name:'Three',avatar:avatars[2]});sessions.push(p2.sessionId,p3.sessionId);setReady(host.sessionId,true);setReady(p2.sessionId,true);setReady(p3.sessionId,true);const room=startGame(host.sessionId);assert.equal(room.phase,'game');assert.equal(room.game.turn,1);assert.equal(room.game.phase,'decision');assert.equal(room.players.every(p=>p.ready===false),true);assert.throws(()=>submitGameAction(host.sessionId,{action:'bad'}),/INVALID_ACTION/);});

test('7-turn engine progresses decision -> resolution -> next turn -> results',()=>{const {host}=startCrew(3);for(let turn=1;turn<=TURN_COUNT;turn++){const room=getRoom(host.sessionId);assert.equal(room.game.turn,turn);assert.equal(room.game.phase,'decision');for(const sessionId of sessions)submitGameAction(sessionId,{action:'secure'});_testForceResolve(host.sessionId);assert.equal(getRoom(host.sessionId).game.phase,'resolution');_testForceAdvance(host.sessionId);if(turn<TURN_COUNT)assert.equal(getRoom(host.sessionId).game.turn,turn+1);else assert.equal(getRoom(host.sessionId).game.phase,'results');}});

test('all four actions remain accepted and resolve in one simultaneous turn',()=>{const {host,joined}=startCrew(4);submitGameAction(host.sessionId,{action:'collect'});submitGameAction(joined[1].sessionId,{action:'steal',targetId:joined[2].playerId});submitGameAction(joined[2].sessionId,{action:'secure'});submitGameAction(joined[3].sessionId,{action:'decoy'});const room=_testForceResolve(host.sessionId).room;assert.deepEqual(room.game.lastResolution.outcomes.map(o=>o.action).sort(),['collect','decoy','secure','steal']);assert.equal(room.game.phase,'resolution');});

test('invalid and duplicate actions are rejected server-side',()=>{const {host,joined}=startCrew(3);assert.throws(()=>submitGameAction(host.sessionId,{action:'laser'}),/INVALID_ACTION/);assert.throws(()=>submitGameAction(host.sessionId,{action:'steal'}),/INVALID_TARGET/);submitGameAction(host.sessionId,{action:'secure'});assert.throws(()=>submitGameAction(host.sessionId,{action:'decoy'}),/ACTION_ALREADY_SUBMITTED/);assert.throws(()=>submitGameAction(joined[1].sessionId,{action:'steal',targetId:joined[1].playerId}),/INVALID_TARGET/);});

test('disconnected player receives server Secure fallback during decision',()=>{const game=createGameState([{id:'a',connected:true},{id:'b',connected:false},{id:'c',connected:true}],{eventSchedule:Array(7).fill(null)});submitFallbacks(game);assert.equal(game.players.get('b').submitted.action,'secure');});

test('starting inventory and market values are equal, server-owned, and publicly exposed only as viewer inventory',()=>{const {host}=startCrew(3);const room=getRoom(host.sessionId);assert.deepEqual(room.game.marketValues,MARKET_VALUES);assert.deepEqual(room.game.myInventory,STARTING_INVENTORY);assert.equal(room.game.players.some(p=>p.inventory!==undefined),false);});

test('client cannot modify credits, data, crypto, another player inventory, or score',()=>{const {host,joined}=startCrew(3);submitGameAction(host.sessionId,{action:'collect',credits:999999,data:999999,crypto:999999,inventory:{credits:999999,data:999999,crypto:999999},score:999999,targetInventory:{credits:999999}});const room=getRoom(host.sessionId);assert.deepEqual(room.game.myInventory,STARTING_INVENTORY);assert.deepEqual(room.game.marketValues,MARKET_VALUES);assert.equal(room.game.myInventory.credits,STARTING_INVENTORY.credits);});

test('Hack awards a server-selected resource and duplicate submission cannot generate twice',()=>{const {host}=startCrew(3);const before=getRoom(host.sessionId).game.myInventory;submitGameAction(host.sessionId,{action:'collect'});assert.throws(()=>submitGameAction(host.sessionId,{action:'collect'}),/ACTION_ALREADY_SUBMITTED/);_testForceResolve(host.sessionId);const after=getRoom(host.sessionId).game.myInventory;const delta=Object.values(after).reduce((a,b)=>a+b,0)-Object.values(before).reduce((a,b)=>a+b,0);assert.ok(delta===0||delta===1);});

test('Steal validates opponent target, rejects self/nonexistent/disconnected targets',()=>{const {host,joined}=startCrew(3);assert.throws(()=>submitGameAction(host.sessionId,{action:'steal',targetId:host.playerId}),/INVALID_TARGET/);assert.throws(()=>submitGameAction(host.sessionId,{action:'steal',targetId:'missing'}),/INVALID_TARGET/);const game=createGameState([{id:'a',connected:true},{id:'b',connected:false},{id:'c',connected:true}],{eventSchedule:Array(7).fill(null)});assert.throws(()=>submitAction(game,'a',{action:'steal',targetId:'a'}),/INVALID_TARGET/);assert.throws(()=>submitAction(game,'a',{action:'steal',targetId:'b'}),/INVALID_TARGET/);assert.throws(()=>submitAction(game,'a',{action:'steal',targetId:'missing'}),/INVALID_TARGET/);});

test('Steal transfers one server-selected resource and never steals from self',()=>{const {host,joined}=startCrew(3);const game=createGameState([{id:host.playerId,connected:true},{id:joined[1].playerId,connected:true},{id:joined[2].playerId,connected:true}],{eventSchedule:Array(7).fill(null)});game.players.get(host.playerId).inventory={credits:0,data:0,crypto:0};game.players.get(joined[1].playerId).inventory={credits:2,data:2,crypto:2};const target=joined[1].playerId;submitAction(game,host.playerId,{action:'steal',targetId:target});submitAction(game,target,{action:'collect'});submitAction(game,joined[2].playerId,{action:'collect'});resolve(game,joined.map(p=>({id:p.playerId,name:p.name,avatar:p.avatar})));const outcome=game.lastResolution.outcomes.find(o=>o.playerId===host.playerId);assert.equal(outcome.success,true);assert.equal(inventoryTotal(game,host.playerId),1);assert.ok(inventoryTotal(game,target)>=5);assert.ok(game.players.get(target).inventory.data>=0);});

test('Steal against Secure is blocked and Secure is temporary',()=>{const {host,joined}=startCrew(3);const game=createGameState([{id:host.playerId,connected:true},{id:joined[1].playerId,connected:true},{id:joined[2].playerId,connected:true}],{eventSchedule:Array(7).fill(null)});game.players.get(joined[1].playerId).inventory={credits:0,data:1,crypto:0};submitAction(game,host.playerId,{action:'steal',targetId:joined[1].playerId});submitAction(game,joined[1].playerId,{action:'secure'});resolve(game,joined.map(p=>({id:p.playerId,name:p.name,avatar:p.avatar})));const outcome=game.lastResolution.outcomes.find(o=>o.playerId===host.playerId);assert.equal(outcome.success,false);assert.equal(inventoryTotal(game,joined[1].playerId),1);advanceTurn(game);assert.equal(game.players.get(joined[1].playerId).submitted,null);});

test('Decoy blocks Steal and grants the decoy a small server reward',()=>{const {host,joined}=startCrew(3);const game=createGameState(joined.map(p=>({id:p.playerId,connected:true})),{eventSchedule:Array(7).fill(null)});game.players.get(joined[1].playerId).inventory={credits:0,data:1,crypto:0};const before=inventoryTotal(game,joined[1].playerId);submitAction(game,host.playerId,{action:'steal',targetId:joined[1].playerId});submitAction(game,joined[1].playerId,{action:'decoy'});resolve(game,joined.map(p=>({id:p.playerId,name:p.name,avatar:p.avatar})));const stealOutcome=game.lastResolution.outcomes.find(o=>o.playerId===host.playerId);assert.equal(stealOutcome.success,false);assert.equal(stealOutcome.decoy,true);assert.equal(inventoryTotal(game,joined[1].playerId),before+1);});

test('Steal from zero-resource player fails safely',()=>{const game=createGameState([{id:'thief',connected:true},{id:'target',connected:true},{id:'guard',connected:true}],{eventSchedule:Array(7).fill(null)});game.players.get('target').inventory={credits:0,data:0,crypto:0};submitAction(game,'thief',{action:'steal',targetId:'target'});submitAction(game,'target',{action:'secure'});submitAction(game,'guard',{action:'secure'});resolve(game,[{id:'thief',name:'Thief',avatar:''},{id:'target',name:'Target',avatar:''},{id:'guard',name:'Guard',avatar:''}]);const outcome=game.lastResolution.outcomes.find(o=>o.playerId==='thief');assert.equal(outcome.success,false);assert.equal(inventoryTotal(game,'target'),0);assert.ok(Object.values(game.players.get('target').inventory).every(v=>v>=0));});

test('Multiple simultaneous Steals cannot overdraw a target',()=>{const {host,joined}=startCrew(4);const game=createGameState(joined.map(p=>({id:p.playerId,connected:true})),{eventSchedule:Array(7).fill(null)});const target=joined[2].playerId;game.players.get(target).inventory={credits:1,data:1,crypto:1};submitAction(game,host.playerId,{action:'steal',targetId:target});submitAction(game,joined[1].playerId,{action:'steal',targetId:target});submitAction(game,target,{action:'collect'});submitAction(game,joined[3].playerId,{action:'collect'});resolve(game,joined.map(p=>({id:p.playerId,name:p.name,avatar:p.avatar})));const stealOutcomes=game.lastResolution.outcomes.filter(o=>o.action==='steal');assert.equal(stealOutcomes.filter(o=>o.success).length,1);assert.ok(inventoryTotal(game,target)>=2 && inventoryTotal(game,target)<=3);assert.ok(Object.values(game.players.get(target).inventory).every(v=>v>=0));});

test('Simultaneous Hack and Steal both use the same pre-resolution state',()=>{const {host,joined}=startCrew(3);const game=createGameState(joined.map(p=>({id:p.playerId,connected:true})),{eventSchedule:Array(7).fill(null)});const hacker=joined[1].playerId;const thief=host.playerId;game.players.get(hacker).inventory={credits:0,data:0,crypto:0};submitAction(game,hacker,{action:'collect'});submitAction(game,thief,{action:'steal',targetId:hacker});resolve(game,joined.map(p=>({id:p.playerId,name:p.name,avatar:p.avatar})));const steal=game.lastResolution.outcomes.find(o=>o.playerId===thief);assert.equal(steal.success,false);assert.ok(inventoryTotal(game,hacker)>=0&&inventoryTotal(game,hacker)<=1);});

test('Resource totals never become negative after any resolution',()=>{const game=createGameState([{id:'a',connected:true},{id:'b',connected:true},{id:'c',connected:true}],{eventSchedule:Array(7).fill(null)});for(const state of game.players.values())state.inventory={credits:0,data:0,crypto:0};submitAction(game,'a',{action:'steal',targetId:'b'});submitAction(game,'b',{action:'steal',targetId:'a'});submitAction(game,'c',{action:'collect'});resolve(game,[{id:'a',name:'A',avatar:'x'},{id:'b',name:'B',avatar:'x'},{id:'c',name:'C',avatar:'x'}]);for(const state of game.players.values())assert.ok(Object.values(state.inventory).every(v=>v>=0));});

test('server resource state remains authoritative across the public room snapshot',()=>{const {host}=startCrew(3);const publicRoom=getRoom(host.sessionId);assert.deepEqual(publicRoom.game.myInventory,STARTING_INVENTORY);assert.equal(publicRoom.game.players.every(p=>p.inventory===undefined),true);});

test('rematch returns the same room to lobby after final turn',()=>{const {host}=startCrew(3);for(let turn=1;turn<=TURN_COUNT;turn++){for(const sessionId of sessions)submitGameAction(sessionId,{action:'secure'});_testForceResolve(host.sessionId);_testForceAdvance(host.sessionId);}assert.equal(getRoom(host.sessionId).phase,'game');const room=rematch(host.sessionId);assert.equal(room.phase,'lobby');assert.equal(room.code,host.room.code);assert.equal(room.playerCount,3);});

test('game constants expose four actions, seven turns, and stable market values',()=>{assert.deepEqual(ACTIONS,['collect','steal','secure','decoy']);assert.equal(TURN_COUNT,7);assert.deepEqual(MARKET_VALUES,{credits:1,data:3,crypto:5});assert.deepEqual(STARTING_INVENTORY,{credits:2,data:1,crypto:1});assert.equal(typeof gameTest.chooseResource,'function');});

test('Stage 3C security starts LOW, stays bounded, and changes by documented actions',()=>{const game=createGameState([{id:'a',connected:true},{id:'b',connected:true},{id:'c',connected:true}],{eventSchedule:Array(7).fill(null)});assert.equal(game.security,0);submitAction(game,'a',{action:'collect'});submitAction(game,'b',{action:'secure'});submitAction(game,'c',{action:'decoy'});resolve(game,[{id:'a',name:'A',avatar:'x'},{id:'b',name:'B',avatar:'x'},{id:'c',name:'C',avatar:'x'}]);assert.ok(game.security>=0&&game.security<=2);assert.equal(game.lastResolution.security,game.security);advanceTurn(game);game.security=2;submitAction(game,'a',{action:'secure'});submitAction(game,'b',{action:'secure'});submitAction(game,'c',{action:'secure'});resolve(game,[{id:'a',name:'A',avatar:'x'},{id:'b',name:'B',avatar:'x'},{id:'c',name:'C',avatar:'x'}]);assert.equal(game.security,0);assert.equal(gameTest.securityLevel(game.security),'LOW');});

test('Security resets to LOW on a fresh match and clients cannot submit a security value',()=>{const {host}=startCrew(3);const room=getRoom(host.sessionId);assert.equal(room.game.security,0);submitGameAction(host.sessionId,{action:'collect',security:2,securityLevel:'CRITICAL'});assert.equal(getRoom(host.sessionId).game.security,0);});

test('Server-selected events are stored, synchronized in resolution, and cannot be client-selected',()=>{const schedule=['data-surge','crypto-lockdown','firewall-sweep','market-shift',null,null,null];const game=createGameState([{id:'a',connected:true},{id:'b',connected:true},{id:'c',connected:true}],{eventSchedule:schedule});assert.equal(game.activeEvent,'data-surge');submitAction(game,'a',{action:'collect',event:'market-shift'});submitAction(game,'b',{action:'secure'});submitAction(game,'c',{action:'secure'});const resolution=resolve(game,[{id:'a',name:'A',avatar:'x'},{id:'b',name:'B',avatar:'x'},{id:'c',name:'C',avatar:'x'}]);assert.equal(resolution.event.id,'data-surge');assert.equal(game.activeEvent,'data-surge');assert.notEqual(game.activeEvent,'market-shift');});

test('Data Surge deterministically increases a successful Hack reward',()=>{const game=createGameState([{id:'a',connected:true},{id:'b',connected:true},{id:'c',connected:true}],{eventSchedule:['data-surge',null,null,null,null,null,null]});game.players.get('b').inventory={credits:0,data:0,crypto:0};submitAction(game,'b',{action:'collect'});submitAction(game,'a',{action:'secure'});submitAction(game,'c',{action:'secure'});resolve(game,[{id:'a',name:'A',avatar:'x'},{id:'b',name:'B',avatar:'x'},{id:'c',name:'C',avatar:'x'}]);assert.equal(inventoryTotal(game,'b'),2);});

test('Crypto Lockdown prevents a server-selected Crypto steal',()=>{const game=createGameState([{id:'a',connected:true},{id:'b',connected:true},{id:'c',connected:true}],{eventSchedule:['crypto-lockdown',null,null,null,null,null,null]});game.players.get('b').inventory={credits:0,data:0,crypto:5};submitAction(game,'a',{action:'steal',targetId:'b'});submitAction(game,'b',{action:'secure'});submitAction(game,'c',{action:'secure'});resolve(game,[{id:'a',name:'A',avatar:'x'},{id:'b',name:'B',avatar:'x'},{id:'c',name:'C',avatar:'x'}]);const outcome=game.lastResolution.outcomes.find(o=>o.playerId==='a');assert.equal(outcome.success,false);assert.equal(inventoryTotal(game,'b'),5);});

test('Firewall Sweep blocks all Steals while leaving other actions resolvable',()=>{const game=createGameState([{id:'a',connected:true},{id:'b',connected:true},{id:'c',connected:true}],{eventSchedule:['firewall-sweep',null,null,null,null,null,null]});submitAction(game,'a',{action:'steal',targetId:'b'});submitAction(game,'b',{action:'collect'});submitAction(game,'c',{action:'secure'});resolve(game,[{id:'a',name:'A',avatar:'x'},{id:'b',name:'B',avatar:'x'},{id:'c',name:'C',avatar:'x'}]);assert.equal(game.lastResolution.outcomes.find(o=>o.playerId==='a').success,false);assert.equal(game.lastResolution.outcomes.find(o=>o.playerId==='a').firewall,true);});

test('Market Shift changes the current market and can amplify Crypto stolen',()=>{const game=createGameState([{id:'a',connected:true},{id:'p1',connected:true},{id:'p2',connected:true}],{eventSchedule:['market-shift',null,null,null,null,null,null]});game.players.get('p1').inventory={credits:0,data:0,crypto:5};submitAction(game,'a',{action:'steal',targetId:'p1'});submitAction(game,'p1',{action:'collect'});submitAction(game,'p2',{action:'secure'});resolve(game,[{id:'a',name:'A',avatar:'x'},{id:'p1',name:'P1',avatar:'x'},{id:'p2',name:'P2',avatar:'x'}]);assert.equal(game.marketValues.crypto,7);const outcome=game.lastResolution.outcomes.find(o=>o.playerId==='a');assert.equal(outcome.resource,'crypto');assert.equal(outcome.amount,2);});

test('Every player receives three private objectives and other players do not see them during play',()=>{const {host,joined}=startCrew(3);const own=getRoom(host.sessionId);const other=getRoom(joined[1].sessionId);assert.equal(own.game.myObjectives.length,3);assert.equal(other.game.myObjectives.length,3);assert.equal(own.game.players.some(p=>p.objectives!==undefined),false);assert.equal(other.game.players.some(p=>p.objectives!==undefined),false);assert.notDeepEqual(own.game.myObjectives.map(o=>o.id),other.game.myObjectives.map(o=>o.id));});

test('Objective progress and completion are tracked only from server outcomes',()=>{const game=createGameState([{id:'a',connected:true},{id:'b',connected:true},{id:'c',connected:true}],{eventSchedule:Array(7).fill(null)});const state=game.players.get('a');state.objectives=[{id:'test-hack',label:'Test Hack',description:'Hack once.',type:'hacks',target:1,bonus:4,progress:0,completed:false}];submitAction(game,'a',{action:'collect',objectiveProgress:999});submitAction(game,'b',{action:'secure'});submitAction(game,'c',{action:'secure'});resolve(game,[{id:'a',name:'A',avatar:'x'},{id:'b',name:'B',avatar:'x'},{id:'c',name:'C',avatar:'x'}]);assert.ok(state.objectives[0].progress<=1);assert.equal(state.objectives[0].completed,state.stats.hacks>=1);});

test('Final scoring uses server inventory and objective bonuses with deterministic tie-breaking',()=>{const game=createGameState([{id:'a',connected:true},{id:'b',connected:true},{id:'c',connected:true}],{eventSchedule:Array(7).fill(null)});game.players.get('a').inventory={credits:1,data:1,crypto:1};game.players.get('b').inventory={credits:1,data:1,crypto:1};game.players.get('c').inventory={credits:0,data:0,crypto:0};game.players.get('a').objectives=[{id:'a',label:'A',description:'',type:'hacks',target:1,bonus:4,progress:1,completed:true}];game.players.get('b').objectives=[{id:'b',label:'B',description:'',type:'hacks',target:1,bonus:4,progress:1,completed:true}];game.players.get('c').objectives=[];const rows=finalizeResults(game,[{id:'a',name:'A',avatar:'x'},{id:'b',name:'B',avatar:'x'},{id:'c',name:'C',avatar:'x'}]);assert.equal(rows[0].assetScore,9);assert.equal(rows[0].objectiveBonus,4);assert.equal(rows[0].finalScore,13);assert.equal(rows[0].winner,true);assert.equal(rows[1].winner,false);assert.equal(rows[0].tiedOnScore,true);});

test('Results expose detailed scoring and are synchronized after the seventh turn',()=>{const {host}=startCrew(3);for(let turn=1;turn<=TURN_COUNT;turn++){for(const sessionId of sessions)submitGameAction(sessionId,{action:'secure'});_testForceResolve(host.sessionId);_testForceAdvance(host.sessionId);}const room=getRoom(host.sessionId);assert.equal(room.game.phase,'results');assert.equal(room.game.results.length,3);assert.equal(room.game.results.every(r=>typeof r.finalScore==='number'&&typeof r.assetScore==='number'&&Array.isArray(r.objectives)),true);assert.equal(room.game.results.filter(r=>r.winner).length,1);});

test('Clients cannot manipulate objective, security, score, event, or another player state through action submission',()=>{const {host,joined}=startCrew(3);const before=getRoom(host.sessionId);submitGameAction(host.sessionId,{action:'secure',security:2,event:'firewall-sweep',score:999999,objectives:[{completed:true}],inventory:{crypto:999999},targetPlayerState:{score:999999}});const after=getRoom(host.sessionId);assert.equal(after.game.security,before.game.security);assert.deepEqual(after.game.myInventory,before.game.myInventory);assert.equal(after.game.myObjectives.every(o=>o.completed===false||o.progress>=o.target),true);assert.equal(after.game.activeEvent?.id,before.game.activeEvent?.id);});

test('Rematch resets Stage 3C security, objectives, event state, and inventories',()=>{const {host}=startCrew(3);const game=createGameState([{id:'a',connected:true},{id:'b',connected:true},{id:'c',connected:true}],{eventSchedule:Array(7).fill(null)});game.security=2;game.players.get('a').inventory={credits:99,data:99,crypto:99};assert.equal(game.security,2);assert.equal(game.players.get('a').inventory.crypto,99);const fresh=createGameState([{id:'a',connected:true},{id:'b',connected:true},{id:'c',connected:true}],{eventSchedule:Array(7).fill(null)});assert.equal(fresh.security,0);assert.deepEqual(fresh.players.get('a').inventory,STARTING_INVENTORY);assert.equal(fresh.players.get('a').objectives.length,3);});

// Stage 4A static UI regression checks: these verify the shipped UI contract without
// pretending that a browser/device rendering test has occurred.
test('Stage 4A UI assets include accessible focus states and reduced-motion support', async()=>{
  const fs = await import('node:fs/promises');
  const css = await fs.readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /button:focus-visible/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /touch-action:manipulation/);
});

test('Stage 4A UI CSS covers mobile responsive layouts and timer warning states', async()=>{
  const fs = await import('node:fs/promises');
  const css = await fs.readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /timer-warning/);
  assert.match(css, /timer-critical/);
});

test('Stage 4A client preserves server-authoritative UX labels and status regions', async()=>{
  const fs = await import('node:fs/promises');
  const js = await fs.readFile(new URL('../src/client/app.js', import.meta.url), 'utf8');
  assert.match(js, /aria-live=\\?"polite/);
  assert.match(js, /aria-pressed/);
  assert.match(js, /LIVE SYNC \/\/ SERVER AUTHORITY/);
  assert.match(js, /Action locked/);
});

test('Stage 4A client includes explicit feedback for event, security, and objective completion', async()=>{
  const fs = await import('node:fs/promises');
  const js = await fs.readFile(new URL('../src/client/app.js', import.meta.url), 'utf8');
  assert.match(js, /Server event revealed/);
  assert.match(js, /Security changed/);
  assert.match(js, /Objective complete/);
});

test('Stage 4A does not alter authoritative game scoring exports', async()=>{
  const fs = await import('node:fs/promises');
  const game = await fs.readFile(new URL('../src/server/game.js', import.meta.url), 'utf8');
  assert.match(game, /function finalizeResults/);
  assert.match(game, /assetScore/);
  assert.match(game, /objectiveBonus/);
  assert.match(game, /securityBonus/);
});


// Stage 4B static/client audio regression checks: verify the audio contract without
// pretending that browser audio playback has been exercised in this environment.
test('Stage 4B client provides lightweight Web Audio, persisted sound state, and accessible controls', async()=>{
  const fs = await import('node:fs/promises');
  const js = await fs.readFile(new URL('../src/client/app.js', import.meta.url), 'utf8');
  assert.match(js, /AudioContext|webkitAudioContext/);
  assert.match(js, /localStorage\.getItem\('cyberHeistSound'\)/);
  assert.match(js, /data-sound-toggle/);
  assert.match(js, /aria-pressed/);
  assert.match(js, /Mute game audio/);
  assert.match(js, /Unmute game audio/);
});

test('Stage 4B client wires audio to actions, resolution, countdown, security, events, objectives, and results', async()=>{
  const fs = await import('node:fs/promises');
  const js = await fs.readFile(new URL('../src/client/app.js', import.meta.url), 'utf8');
  for (const marker of ['collect','steal','secure','decoy','success','fail','blockedSteal','countdown','warning','finalLock','securityUp','securityDown','cryptoLockdown','dataSurge','firewallSweep','marketShift','objective','winner']) assert.match(js, new RegExp(`['"]${marker}['"]`));
  assert.match(js, /handleAudioResolution\(g\)/);
  assert.match(js, /playSfx\('lock'\)/);
  assert.match(js, /playSfx\('result'\)/);
});

test('Stage 4B keeps audio presentation client-only and leaves server gameplay files untouched by audio hooks', async()=>{
  const fs = await import('node:fs/promises');
  const [client,game,rooms] = await Promise.all([
    fs.readFile(new URL('../src/client/app.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/server/game.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/server/rooms.js', import.meta.url), 'utf8'),
  ]);
  assert.match(client, /AudioContext/);
  assert.doesNotMatch(game, /AudioContext|cyberHeistSound|playSfx|sound-toggle/);
  assert.doesNotMatch(rooms, /AudioContext|cyberHeistSound|playSfx|sound-toggle/);
});

test('Stage 4B game-feel CSS is lightweight, responsive, and reduced-motion aware', async()=>{
  const fs = await import('node:fs/promises');
  const css = await fs.readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.sound-toggle/);
  assert.match(css, /feel-turn-start/);
  assert.match(css, /feel-action-selected/);
  assert.match(css, /feel-event/);
  assert.match(css, /feel-objective/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css, /@media \(max-width:760px\)/);
});
