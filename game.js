import { randomUUID, randomInt } from 'node:crypto';

export const TURN_COUNT = 7;
export const DECISION_MS = Number(process.env.CYBER_HEIST_DECISION_MS || 15_000);
export const RESOLUTION_MS = Number(process.env.CYBER_HEIST_RESOLUTION_MS || 2_500);
export const ACTIONS = ['collect', 'steal', 'secure', 'decoy'];
export const MARKET_VALUES = Object.freeze({ credits: 1, data: 3, crypto: 5 });
export const STARTING_INVENTORY = Object.freeze({ credits: 2, data: 1, crypto: 1 });
export const RESOURCE_KEYS = Object.keys(MARKET_VALUES);
export const SECURITY_LEVELS = ['LOW', 'ELEVATED', 'CRITICAL'];
export const SECURITY_MIN = 0;
export const SECURITY_MAX = SECURITY_LEVELS.length - 1;
export const EVENT_IDS = ['crypto-lockdown', 'data-surge', 'firewall-sweep', 'market-shift'];
export const OBJECTIVE_BONUS = 4;
export const SECURITY_BONUS = 2;
export const AVATARS = [
  ['neon-ghost','Neon Ghost','#00f5d4'], ['byte-witch','Byte Witch','#ff4ecd'], ['null-fox','Null Fox','#8a7dff'],
  ['chrome-viper','Chrome Viper','#55d6ff'], ['glitch-monk','Glitch Monk','#ffd166'], ['data-wraith','Data Wraith','#7cf29a'],
  ['cipher-queen','Cipher Queen','#ff6b8a'], ['signal-rat','Signal Rat','#c0ff3e'], ['zero-day','Zero Day','#ff8c42'],
  ['dark-pulse','Dark Pulse','#a78bfa'], ['packet-reaper','Packet Reaper','#f43f5e'], ['quantum-jack','Quantum Jack','#22d3ee']
].map(([id, name, accent]) => ({ id, name, accent }));

const OBJECTIVE_TEMPLATES = Object.freeze([
  { id: 'ghost-hacker', label: 'Ghost Hacker', description: 'Successfully Hack 3 times.', type: 'hacks', target: 3, bonus: OBJECTIVE_BONUS },
  { id: 'data-runner', label: 'Data Runner', description: 'Finish with at least 4 Data.', type: 'final-resource', resource: 'data', target: 4, bonus: OBJECTIVE_BONUS },
  { id: 'crypto-keeper', label: 'Crypto Keeper', description: 'Finish with at least 2 Crypto.', type: 'final-resource', resource: 'crypto', target: 2, bonus: OBJECTIVE_BONUS },
  { id: 'countermeasure', label: 'Countermeasure', description: 'Successfully block 2 Steals with Secure.', type: 'defends', target: 2, bonus: OBJECTIVE_BONUS },
  { id: 'inside-job', label: 'Inside Job', description: 'Successfully execute 1 Steal.', type: 'steals', target: 1, bonus: OBJECTIVE_BONUS },
  { id: 'bait-master', label: 'Bait Master', description: 'Successfully fool 1 Steal with Decoy.', type: 'decoys', target: 1, bonus: OBJECTIVE_BONUS },
  { id: 'redline-survivor', label: 'Redline Survivor', description: 'Take an action while security is CRITICAL and finish the match.', type: 'critical', target: 1, bonus: OBJECTIVE_BONUS },
]);

const EVENT_DEFS = Object.freeze({
  'crypto-lockdown': { id: 'crypto-lockdown', name: 'Crypto Lockdown', description: 'Crypto is protected this turn: Steal cannot take Crypto and Hack cannot recover Crypto.', icon: '🔒' },
  'data-surge': { id: 'data-surge', name: 'Data Surge', description: 'The network is overflowing with Data: every successful Hack recovers +1 extra Data.', icon: '📡' },
  'firewall-sweep': { id: 'firewall-sweep', name: 'Firewall Sweep', description: 'The firewall is active: every Steal attempt fails unless the thief is Secure-proofed by a successful Decoy? No — Steals simply fail this turn.', icon: '🧱' },
  'market-shift': { id: 'market-shift', name: 'Market Shift', description: 'Crypto demand spikes: Crypto market value is 7 for this turn.', icon: '📈' },
});

function error(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function inventoryCopy() { return { ...STARTING_INVENTORY }; }
function clampNonNegative(value) { return Math.max(0, Number.isFinite(value) ? value : 0); }
function stableIndex(seed, length) {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return Math.abs(hash >>> 0) % length;
}
function chooseResource(playerId, turn, salt = '') { return RESOURCE_KEYS[stableIndex(`${salt}:${turn}:${playerId}`, RESOURCE_KEYS.length)]; }
function totalResources(inventory) { return RESOURCE_KEYS.reduce((sum, key) => sum + clampNonNegative(inventory[key]), 0); }
function inventoryCopyFrom(inventory) { return Object.fromEntries(RESOURCE_KEYS.map((key) => [key, clampNonNegative(inventory?.[key])])); }
function emptyDelta() { return { credits: 0, data: 0, crypto: 0 }; }
function applyDelta(target, delta) { for (const key of RESOURCE_KEYS) target[key] = clampNonNegative(target[key] + (delta[key] || 0)); }
function securityLevel(value) { return SECURITY_LEVELS[Math.max(SECURITY_MIN, Math.min(SECURITY_MAX, value))]; }
function securityText(value) { return securityLevel(value); }
function changeSecurity(game, delta) {
  game.security = Math.max(SECURITY_MIN, Math.min(SECURITY_MAX, game.security + delta));
}
function eventForTurn(schedule, turn) { return schedule[turn - 1] || null; }
function publicObjective(objective) {
  return { id: objective.id, label: objective.label, description: objective.description, progress: objective.progress, target: objective.target, completed: objective.completed, bonus: objective.bonus };
}
function objectiveTemplate(id) { return OBJECTIVE_TEMPLATES.find((item) => item.id === id); }
function makeObjective(template) { return { ...template, progress: 0, completed: false }; }
function shuffledObjectives(seed) {
  const pool = OBJECTIVE_TEMPLATES.map(item => item.id);
  let state = stableIndex(seed, 2147483646) + 1;
  for (let i = pool.length - 1; i > 0; i--) {
    state = (Math.imul(state, 48271) % 2147483647);
    const j = state % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
function assignObjectives(playerId, gameId, index) {
  const ids = shuffledObjectives(`${gameId}:${playerId}:${index}`);
  return ids.slice(0, 3).map(id => makeObjective(objectiveTemplate(id)));
}
function generateEventSchedule() {
  // Server chooses a random event schedule once per match. No client input participates.
  const pool = [...EVENT_IDS];
  const schedule = [];
  for (let turn = 1; turn <= TURN_COUNT; turn += 1) {
    if (turn === 1) { schedule.push(null); continue; }
    if (randomInt(0, 100) < 75) {
      if (pool.length === 0) pool.push(...EVENT_IDS);
      const index = randomInt(0, pool.length);
      schedule.push(pool.splice(index, 1)[0]);
    } else {
      schedule.push(null);
    }
  }
  return schedule;
}
function eventMarketValues(eventId) {
  return eventId === 'market-shift' ? { ...MARKET_VALUES, crypto: 7 } : { ...MARKET_VALUES };
}
function eventDefinition(eventId) { return eventId ? EVENT_DEFS[eventId] : null; }
function completedObjectiveBonus(state) { return state.objectives.filter(o => o.completed).reduce((sum, o) => sum + o.bonus, 0); }
function assetScore(inventory) { return RESOURCE_KEYS.reduce((sum, key) => sum + inventory[key] * MARKET_VALUES[key], 0); }
function securityBonus(state) { return state.criticalReached ? SECURITY_BONUS : 0; }
// Final-score ties: higher Crypto, then higher Data, then lexicographically lower immutable player id.
function scoreTieBreak(a, b) {
  const cryptoDiff = b.inventory.crypto - a.inventory.crypto;
  if (cryptoDiff) return cryptoDiff;
  const dataDiff = b.inventory.data - a.inventory.data;
  if (dataDiff) return dataDiff;
  return a.playerId.localeCompare(b.playerId);
}

export function createGameState(players, options = {}) {
  const gameId = randomUUID();
  const gamePlayers = new Map();
  players.forEach((player, index) => {
    gamePlayers.set(player.id, {
      connected: Boolean(player.connected), submitted: null, submittedAt: null, fallbackUsed: false,
      inventory: inventoryCopy(), objectives: assignObjectives(player.id, gameId, index),
      stats: { hacks: 0, defends: 0, steals: 0, decoys: 0 }, criticalReached: false,
    });
  });
  const eventSchedule = Array.isArray(options.eventSchedule) ? options.eventSchedule.slice(0, TURN_COUNT) : generateEventSchedule();
  while (eventSchedule.length < TURN_COUNT) eventSchedule.push(null);
  return {
    id: gameId, phase: 'decision', turn: 1, totalTurns: TURN_COUNT,
    decisionEndsAt: Date.now() + DECISION_MS, resolutionEndsAt: null,
    players: gamePlayers, marketValues: eventMarketValues(eventForTurn(eventSchedule, 1)),
    security: 0, eventSchedule, activeEvent: eventForTurn(eventSchedule, 1),
    lastResolution: null, results: null, timers: { decision: null, resolution: null }, resolving: false,
  };
}

function validateAction(raw, playerId, playerStates) {
  if (!raw || !ACTIONS.includes(raw.action)) error('INVALID_ACTION');
  if (raw.action === 'steal') {
    if (!raw.targetId || raw.targetId === playerId || !playerStates.has(raw.targetId) || !playerStates.get(raw.targetId)?.connected) error('INVALID_TARGET');
    return { action: 'steal', targetId: raw.targetId };
  }
  return { action: raw.action };
}
export function submitAction(game, playerId, rawAction) {
  if (game.phase !== 'decision') error('TURN_NOT_ACCEPTING_ACTIONS', 409);
  const state = game.players.get(playerId); if (!state) error('PLAYER_NOT_FOUND', 404);
  if (state.submitted) error('ACTION_ALREADY_SUBMITTED', 409);
  state.submitted = validateAction(rawAction, playerId, game.players); state.submittedAt = Date.now(); return state.submitted;
}
export function submitFallbacks(game) {
  for (const state of game.players.values()) if (!state.submitted) { state.submitted = { action: 'secure', fallback: true }; state.submittedAt = Date.now(); state.fallbackUsed = true; }
}
function snapshotInventories(game) { return new Map([...game.players.entries()].map(([id, state]) => [id, inventoryCopyFrom(state.inventory)])); }

function updateObjectiveProgress(state, outcome, securityBefore) {
  if (outcome.action === 'collect' && outcome.success) state.stats.hacks += 1;
  if (outcome.action === 'steal' && outcome.success) state.stats.steals += 1;
  if (outcome.action === 'secure' && outcome.blockedSteal) state.stats.defends += 1;
  if (outcome.action === 'decoy' && outcome.decoySuccess) state.stats.decoys += 1;
  if (securityBefore >= SECURITY_MAX) state.criticalReached = true;
  for (const objective of state.objectives) {
    if (objective.type === 'hacks') objective.progress = Math.min(objective.target, state.stats.hacks);
    if (objective.type === 'steals') objective.progress = Math.min(objective.target, state.stats.steals);
    if (objective.type === 'defends') objective.progress = Math.min(objective.target, state.stats.defends);
    if (objective.type === 'decoys') objective.progress = Math.min(objective.target, state.stats.decoys);
    if (objective.type === 'critical') objective.progress = Math.min(objective.target, state.criticalReached ? 1 : 0);
    if (objective.type === 'final-resource') objective.progress = Math.min(objective.target, state.inventory[objective.resource] || 0);
    objective.completed = objective.progress >= objective.target;
  }
}

export function resolveTurn(game, playerList) {
  if (game.resolving || game.phase !== 'decision') return game.lastResolution;
  game.resolving = true;
  const activeEvent = eventForTurn(game.eventSchedule, game.turn);
  game.activeEvent = activeEvent;
  game.marketValues = eventMarketValues(activeEvent);
  const event = eventDefinition(activeEvent);
  const actions = playerList.map(player => {
    const submitted = game.players.get(player.id)?.submitted || { action: 'secure', fallback: true };
    return { playerId: player.id, name: player.name, avatar: player.avatar, action: submitted.action, targetId: submitted.action === 'steal' ? submitted.targetId : undefined, fallback: Boolean(submitted.fallback) };
  });
  const before = snapshotInventories(game);
  const securityBefore = game.security;
  const deltas = new Map([...game.players.keys()].map(id => [id, emptyDelta()]));
  const defended = new Set(actions.filter(x => x.action === 'secure').map(x => x.playerId));
  const decoys = new Set(actions.filter(x => x.action === 'decoy').map(x => x.playerId));
  const stealClaims = [];
  const outcomes = [];
  let securityDelta = 0;

  for (const item of actions) {
    const state = game.players.get(item.playerId);
    if (item.action === 'collect') {
      const traced = stableIndex(`hack:${game.turn}:${item.playerId}`, 4) === 0 || securityBefore === SECURITY_MAX;
      if (traced) {
        securityDelta += 1;
        outcomes.push({ ...item, success: false, text: `${item.name}'s HACK was traced. No resources recovered. Security rises.` });
      } else {
        let resource = chooseResource(item.playerId, game.turn, 'hack');
        if (activeEvent === 'crypto-lockdown' && resource === 'crypto') resource = 'data';
        deltas.get(item.playerId)[resource] += 1;
        if (activeEvent === 'data-surge') deltas.get(item.playerId).data += 1;
        securityDelta += 1;
        outcomes.push({ ...item, success: true, resource, amount: activeEvent === 'data-surge' ? 2 : 1, text: `${item.name} hacked the network and recovered +${activeEvent === 'data-surge' ? 2 : 1} ${resource === 'data' && activeEvent === 'data-surge' ? 'DATA' : resource.toUpperCase()}.` });
      }
    } else if (item.action === 'secure') {
      securityDelta -= 1;
      outcomes.push({ ...item, success: true, text: `${item.name} secured their node. Steals against them are blocked this turn. Security cools.` });
    } else if (item.action === 'decoy') {
      securityDelta -= 1;
      outcomes.push({ ...item, success: true, text: `${item.name} deployed a decoy and is waiting for a thief to take the bait.` });
    } else if (item.action === 'steal') stealClaims.push(item);
  }

  const reserved = new Map([...game.players.keys()].map(id => [id, emptyDelta()]));
  for (const item of stealClaims.sort((a, b) => a.playerId.localeCompare(b.playerId))) {
    const target = before.get(item.targetId); const targetState = game.players.get(item.targetId); const targetName = actions.find(x => x.playerId === item.targetId)?.name || 'the target';
    if (!target || !targetState?.connected) { outcomes.push({ ...item, success: false, text: `${item.name}'s steal failed: target unavailable or disconnected.` }); continue; }
    if (activeEvent === 'firewall-sweep') { securityDelta += 1; outcomes.push({ ...item, success: false, firewall: true, text: `${item.name}'s steal was stopped by the Firewall Sweep.` }); continue; }
    if (defended.has(item.targetId)) { securityDelta -= 1; const targetOutcome = outcomes.find(x => x.playerId === item.targetId && x.action === 'secure'); if (targetOutcome) targetOutcome.blockedSteal = true; outcomes.push({ ...item, success: false, text: `${item.name}'s steal was blocked by ${targetName}'s defense.` }); continue; }
    if (decoys.has(item.targetId)) { const rewardResource = chooseResource(item.targetId, game.turn, 'decoy'); deltas.get(item.targetId)[rewardResource] += 1; securityDelta -= 1; const targetOutcome = outcomes.find(x => x.playerId === item.targetId && x.action === 'decoy'); if (targetOutcome) targetOutcome.decoySuccess = true; outcomes.push({ ...item, success: false, decoy: true, rewardResource, text: `${item.name} hit ${targetName}'s decoy. The steal failed; the decoy earned +1 ${rewardResource.toUpperCase()}.` }); continue; }
    if (totalResources(target) <= 0) { outcomes.push({ ...item, success: false, text: `${item.name}'s steal failed: the target has no resources.` }); continue; }
    const resource = chooseResource(item.targetId, game.turn, 'steal');
    if (activeEvent === 'crypto-lockdown' && resource === 'crypto') { outcomes.push({ ...item, success: false, lockdown: true, text: `${item.name}'s steal hit the Crypto Lockdown. Crypto is protected this turn.` }); continue; }
    const available = target[resource] - reserved.get(item.targetId)[resource];
    if (available <= 0) { outcomes.push({ ...item, success: false, text: `${item.name}'s steal failed: the selected resource was already claimed this turn.` }); continue; }
    reserved.get(item.targetId)[resource] += 1; deltas.get(item.targetId)[resource] -= 1; deltas.get(item.playerId)[resource] += 1; securityDelta += 1;
    const marketBonus = activeEvent === 'market-shift' && resource === 'crypto' ? 1 : 0;
    if (marketBonus) deltas.get(item.playerId).crypto += marketBonus;
    outcomes.push({ ...item, success: true, resource, amount: 1 + marketBonus, marketBonus: Boolean(marketBonus), text: `${item.name} stole +${1 + marketBonus} ${resource.toUpperCase()} from ${targetName}${marketBonus ? ' during the Market Shift.' : '.'}` });
  }

  changeSecurity(game, securityDelta);
  if (game.security === SECURITY_MAX) for (const state of game.players.values()) state.criticalReached = true;
  for (const [id, delta] of deltas) applyDelta(game.players.get(id).inventory, delta);
  for (const state of game.players.values()) for (const key of RESOURCE_KEYS) state.inventory[key] = clampNonNegative(state.inventory[key]);
  for (const outcome of outcomes) updateObjectiveProgress(game.players.get(outcome.playerId), outcome, securityBefore);
  for (const state of game.players.values()) for (const objective of state.objectives) if (objective.type === 'final-resource') { objective.progress = Math.min(objective.target, state.inventory[objective.resource] || 0); objective.completed = objective.progress >= objective.target; }

  const securityChanged = game.security !== securityBefore;
  game.lastResolution = {
    turn: game.turn, marketValues: { ...game.marketValues }, security: game.security, securityLevel: securityText(game.security),
    securityDelta, securityChanged, event: event ? { ...event } : null,
    outcomes: outcomes.map(({ playerId, action, targetId, success, text, fallback, resource, amount, decoy, rewardResource, firewall, blockedSteal, decoySuccess, marketBonus, lockdown }) => ({
      playerId, action, targetId: targetId || null, success, text, fallback: Boolean(fallback), ...(resource ? { resource } : {}), ...(amount ? { amount } : {}), ...(decoy ? { decoy: true } : {}), ...(rewardResource ? { rewardResource } : {}), ...(firewall ? { firewall: true } : {}), ...(blockedSteal ? { blockedSteal: true } : {}), ...(decoySuccess ? { decoySuccess: true } : {}), ...(marketBonus ? { marketBonus: true } : {}), ...(lockdown ? { lockdown: true } : {})
    })),
    inventoryChanges: Object.fromEntries([...deltas.entries()].map(([id, delta]) => [id, { ...delta }])),
  };
  game.phase = 'resolution'; game.resolutionEndsAt = Date.now() + RESOLUTION_MS; game.resolving = false;
  return game.lastResolution;
}

export function advanceTurn(game) {
  if (game.turn >= TURN_COUNT) { finalizeResults(game); return; }
  game.turn += 1; game.phase = 'decision'; game.decisionEndsAt = Date.now() + DECISION_MS; game.resolutionEndsAt = null; game.lastResolution = null; game.resolving = false;
  game.activeEvent = eventForTurn(game.eventSchedule, game.turn); game.marketValues = eventMarketValues(game.activeEvent);
  for (const state of game.players.values()) { state.submitted = null; state.submittedAt = null; state.fallbackUsed = false; }
}

export function finalizeResults(game, playerList = []) {
  const rows = playerList.length ? playerList : [...game.players.keys()].map(id => ({ id, name: id, avatar: '' }));
  const results = rows.map(player => {
    const state = game.players.get(player.id); const inventory = inventoryCopyFrom(state.inventory); const objectives = state.objectives.map(o => publicObjective(o));
    const asset = assetScore(inventory); const objectiveBonus = completedObjectiveBonus(state); const riskBonus = securityBonus(state);
    return { playerId: player.id, name: player.name, avatar: player.avatar, inventory, assetScore: asset, objectiveBonus, securityBonus: riskBonus, finalScore: asset + objectiveBonus + riskBonus, objectives, criticalReached: state.criticalReached };
  });
  results.sort((a, b) => b.finalScore - a.finalScore || scoreTieBreak(a, b));
  for (const row of results) row.winner = false;
  if (results[0]) results[0].winner = true;
  const topScore = results[0]?.finalScore;
  const scoreTie = results.filter(row => row.finalScore === topScore).length > 1;
  for (const row of results) row.tiedOnScore = scoreTie;
  game.results = results; game.phase = 'results'; game.resolutionEndsAt = null;
  return results;
}

export function finalResults(game, playerList) { if (!game.results) finalizeResults(game, playerList); return game.results.map(row => ({ ...row, inventory: { ...row.inventory }, objectives: row.objectives.map(o => ({ ...o })) })); }

export function publicGame(game, playerList, viewerId) {
  const players = playerList.map(player => { const state = game.players.get(player.id); return { id: player.id, name: player.name, avatar: player.avatar, connected: Boolean(player.connected), submitted: Boolean(state?.submitted) }; });
  const mine = game.players.get(viewerId);
  return {
    id: game.id, phase: game.phase, turn: game.turn, totalTurns: TURN_COUNT, decisionEndsAt: game.decisionEndsAt, resolutionEndsAt: game.resolutionEndsAt,
    marketValues: { ...game.marketValues }, myInventory: mine ? inventoryCopyFrom(mine.inventory) : null, security: game.security, securityLevel: securityText(game.security),
    activeEvent: eventDefinition(game.activeEvent), players, mySubmittedAction: mine?.submitted ? { ...mine.submitted } : null,
    myObjectives: mine ? mine.objectives.map(publicObjective) : [], lastResolution: game.lastResolution,
    results: game.phase === 'results' ? finalResults(game, playerList) : null,
  };
}

export const _test = { ACTIONS, chooseResource, totalResources, eventDefinition, generateEventSchedule, objectiveTemplate, assetScore, securityBonus, securityLevel };
