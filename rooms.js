import { randomInt, randomUUID } from 'node:crypto';
import {
  AVATARS as GAME_AVATARS,
  DECISION_MS,
  RESOLUTION_MS,
  createGameState,
  publicGame,
  resolveTurn,
  submitAction,
  submitFallbacks,
  advanceTurn,
  finalizeResults
} from './game.js';

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const ROOM_CODE_LENGTH = 5;
const DISCONNECT_GRACE_MS = Number(process.env.CYBER_HEIST_DISCONNECT_GRACE_MS || 15_000);
const RESULTS_ROOM_TTL_MS = Number(process.env.CYBER_HEIST_RESULTS_ROOM_TTL_MS || 30 * 60_000);
const NAME_MAX = 18;
export const AVATARS = GAME_AVATARS;
const rooms = new Map();
const sessions = new Map();

function normalizeCode(value) { return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function sanitizeName(value) { const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX); return name || null; }
function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do code = Array.from({ length: ROOM_CODE_LENGTH }, () => alphabet[randomInt(alphabet.length)]).join('');
  while (rooms.has(code));
  return code;
}
function error(message, status) { throw Object.assign(new Error(message), { status }); }
function publicPlayer(player, room) { return { id: player.id, name: player.name, avatar: player.avatar, ready: player.ready, host: player.id === room.hostId, connected: player.connected }; }
function publicRoom(room, viewerId = null) {
  const base = {
    code: room.code, phase: room.phase, hostId: room.hostId, minPlayers: 3, maxPlayers: MAX_PLAYERS,
    playerCount: room.players.size, avatars: AVATARS,
    players: [...room.players.values()].map((player) => publicPlayer(player, room)),
    canStart: room.phase === 'lobby' && room.players.size >= 3 && [...room.players.values()].every((player) => player.ready)
  };
  if (room.game) base.game = publicGame(room.game, [...room.players.values()], viewerId);
  return base;
}
function emit(room, event = 'room:update') {
  for (const subscriber of room.subscribers) {
    subscriber.write(`event: ${event}\ndata: ${JSON.stringify(publicRoom(room, subscriber.viewerId))}\n\n`);
  }
}
function clearGameTimers(game) { clearTimeout(game?.timers?.decision); clearTimeout(game?.timers?.resolution); }
function closeRoom(code) {
  const room = rooms.get(code); if (!room) return;
  clearGameTimers(room.game);
  clearTimeout(room.cleanupTimer);
  for (const player of room.players.values()) { clearTimeout(player.disconnectTimer); sessions.delete(player.sessionId); }
  for (const subscriber of room.subscribers) subscriber.end();
  rooms.delete(code);
}
function transferHost(room) {
  const next = [...room.players.values()].find((p) => p.connected) || [...room.players.values()][0];
  room.hostId = next?.id || null;
  if (next) next.ready = false;
}
function scheduleRemoval(room, playerId) {
  const player = room.players.get(playerId); if (!player) return;
  clearTimeout(player.disconnectTimer);
  player.disconnectTimer = setTimeout(() => {
    const current = room.players.get(playerId); if (!current || current.connected) return;
    room.players.delete(playerId); sessions.delete(current.sessionId);
    if (room.players.size === 0) {
      closeRoom(room.code);
      return;
    }
    if (room.phase === 'game' && room.game) {
      const state = room.game.players.get(playerId);
      if (state) {
        state.connected = false;
        if (room.game.phase === 'decision') {
          state.submitted = { action: 'secure', fallback: true };
          state.submittedAt = Date.now();
          state.fallbackUsed = true;
        }
      }
      if (room.hostId === playerId) transferHost(room);
      // During a round the player remains in game state so the server can safely
      // submit Defend at turn resolution. After the grace window their session is
      // retired, preventing a late reconnect from changing an abandoned round.
      sessions.delete(player.sessionId);
      emit(room, 'player:left');
    } else if (room.hostId === playerId) {
      transferHost(room); emit(room, 'host:transferred');
    } else emit(room, 'player:left');
  }, DISCONNECT_GRACE_MS);
}
function assertRoom(code) { const room = rooms.get(normalizeCode(code)); if (!room) error('ROOM_NOT_FOUND', 404); return room; }
function sessionContext(sessionId) {
  const session = sessions.get(sessionId); if (!session) error('SESSION_INVALID', 401);
  const room = assertRoom(session.roomCode); const player = room.players.get(session.playerId); if (!player) error('SESSION_INVALID', 401);
  return { room, player };
}
function scheduleDecision(room) {
  clearTimeout(room.game.timers.decision);
  room.game.timers.decision = setTimeout(() => {
    if (room.phase !== 'game' || room.game.phase !== 'decision') return;
    submitFallbacks(room.game);
    resolveTurn(room.game, [...room.players.values()]);
    emit(room, 'turn:resolved');
    room.game.timers.resolution = setTimeout(() => {
      if (room.game.phase !== 'resolution') return;
      if (room.game.turn >= 7) { finalizeResults(room.game, [...room.players.values()]); emit(room, 'game:results'); scheduleResultsCleanup(room); return; }
      advanceTurn(room.game); emit(room, 'turn:started'); scheduleDecision(room);
    }, RESOLUTION_MS);
  }, DECISION_MS + 20);
}
function scheduleResultsCleanup(room) {
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    if (room.phase === 'game' && room.game?.phase === 'results') closeRoom(room.code);
  }, RESULTS_ROOM_TTL_MS);
}
function startRound(room) {
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = null;
  room.phase = 'game';
  room.game = createGameState([...room.players.values()]);
  for (const player of room.players.values()) { player.ready = false; player.locked = true; }
  emit(room, 'game:starting');
  scheduleDecision(room);
}

export function createRoom({ name, avatar }) {
  const cleanName = sanitizeName(name); if (!cleanName) error('NAME_REQUIRED', 400);
  if (!AVATARS.some((item) => item.id === avatar)) error('AVATAR_INVALID', 400);
  const code = makeRoomCode(), playerId = randomUUID(), sessionId = randomUUID();
  const room = { code, phase: 'lobby', hostId: playerId, players: new Map(), subscribers: new Set(), game: null, cleanupTimer: null };
  room.players.set(playerId, { id: playerId, sessionId, name: cleanName, avatar, ready: false, connected: true, disconnectTimer: null });
  rooms.set(code, room); sessions.set(sessionId, { roomCode: code, playerId });
  return { sessionId, playerId, room: publicRoom(room, playerId) };
}
export function joinRoom({ code, name, avatar }) {
  const room = assertRoom(code); if (room.phase !== 'lobby') error('GAME_ALREADY_STARTED', 409); if (room.players.size >= MAX_PLAYERS) error('ROOM_FULL', 409);
  const cleanName = sanitizeName(name); if (!cleanName) error('NAME_REQUIRED', 400);
  if (!AVATARS.some((item) => item.id === avatar)) error('AVATAR_INVALID', 400);
  if ([...room.players.values()].some((player) => player.avatar === avatar)) error('AVATAR_TAKEN', 409);
  const playerId = randomUUID(), sessionId = randomUUID();
  room.players.set(playerId, { id: playerId, sessionId, name: cleanName, avatar, ready: false, connected: true, disconnectTimer: null });
  sessions.set(sessionId, { roomCode: room.code, playerId }); emit(room);
  return { sessionId, playerId, room: publicRoom(room, playerId) };
}
export function getRoom(sessionId) { const { room, player } = sessionContext(sessionId); return publicRoom(room, player.id); }
export function updateIdentity(sessionId, { name, avatar }) {
  const { room, player } = sessionContext(sessionId); if (room.phase !== 'lobby') error('IDENTITY_LOCKED', 409);
  const cleanName = sanitizeName(name); if (!cleanName) error('NAME_REQUIRED', 400);
  if (!AVATARS.some((item) => item.id === avatar)) error('AVATAR_INVALID', 400);
  if ([...room.players.values()].some((other) => other.id !== player.id && other.avatar === avatar)) error('AVATAR_TAKEN', 409);
  player.name = cleanName; player.avatar = avatar; player.ready = false; emit(room); return publicRoom(room, player.id);
}
export function setReady(sessionId, ready) {
  const { room, player } = sessionContext(sessionId); if (room.phase !== 'lobby') error('GAME_ALREADY_STARTED', 409);
  player.ready = Boolean(ready); emit(room); return publicRoom(room, player.id);
}
export function startGame(sessionId) {
  const { room, player } = sessionContext(sessionId); if (player.id !== room.hostId) error('HOST_ONLY', 403);
  if (room.players.size < 3) error('MIN_PLAYERS', 409);
  if (![...room.players.values()].every((item) => item.ready)) error('PLAYERS_NOT_READY', 409);
  startRound(room); return publicRoom(room, player.id);
}
export function removePlayer(sessionId, targetPlayerId) {
  const { room, player } = sessionContext(sessionId); if (player.id !== room.hostId) error('HOST_ONLY', 403); if (room.phase !== 'lobby') error('GAME_ALREADY_STARTED', 409);
  if (targetPlayerId === room.hostId) error('CANNOT_REMOVE_HOST', 400); const target = room.players.get(targetPlayerId); if (!target) error('PLAYER_NOT_FOUND', 404);
  room.players.delete(targetPlayerId); sessions.delete(target.sessionId); clearTimeout(target.disconnectTimer); emit(room, 'player:removed'); return publicRoom(room, player.id);
}
export function subscribe(sessionId, res) {
  const { room, player } = sessionContext(sessionId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  player.connected = true; clearTimeout(player.disconnectTimer);
  if (room.game?.players.get(player.id)) {
    const state = room.game.players.get(player.id);
    state.connected = true;
    if (room.game.phase === 'decision' && state.submitted?.fallback) {
      state.submitted = null;
      state.submittedAt = null;
      state.fallbackUsed = false;
    }
  }
  res.viewerId = player.id; room.subscribers.add(res); res.write(`event: room:update\ndata: ${JSON.stringify(publicRoom(room, player.id))}\n\n`);
  return () => room.subscribers.delete(res);
}
export function disconnect(sessionId) {
  const session = sessions.get(sessionId); if (!session) return; const room = rooms.get(session.roomCode); const player = room?.players.get(session.playerId); if (!player) return;
  player.connected = false; scheduleRemoval(room, player.id); emit(room, 'player:disconnected');
}
export function submitGameAction(sessionId, action) {
  const { room, player } = sessionContext(sessionId); if (room.phase !== 'game') error('GAME_NOT_ACTIVE', 409);
  const accepted = submitAction(room.game, player.id, action); emit(room, 'action:submitted'); return { accepted, room: publicRoom(room, player.id) };
}
export function rematch(sessionId) {
  const { room, player } = sessionContext(sessionId); if (room.phase !== 'game' || !room.game || room.game.phase !== 'results') error('GAME_NOT_FINISHED', 409);
  clearTimeout(room.cleanupTimer); room.cleanupTimer = null;
  room.phase = 'lobby'; room.game = null; for (const p of room.players.values()) { p.ready = false; p.locked = false; }
  emit(room, 'room:rematch'); return publicRoom(room, player.id);
}

export function _testForceResolve(sessionId) {
  const { room, player } = sessionContext(sessionId);
  if (room.phase !== 'game' || !room.game) error('GAME_NOT_ACTIVE', 409);
  submitFallbacks(room.game);
  resolveTurn(room.game, [...room.players.values()]);
  emit(room, 'turn:resolved');
  return { room: publicRoom(room, player.id) };
}

export function _testForceAdvance(sessionId) {
  const { room, player } = sessionContext(sessionId);
  if (room.phase !== 'game' || !room.game || room.game.phase !== 'resolution') error('GAME_NOT_ACTIVE', 409);
  if (room.game.turn >= 7) { finalizeResults(room.game, [...room.players.values()]); emit(room, 'game:results'); scheduleResultsCleanup(room); }
  else { advanceTurn(room.game); emit(room, 'turn:started'); scheduleDecision(room); }
  return { room: publicRoom(room, player.id) };
}

export function shutdownRooms() { for (const room of [...rooms.values()]) closeRoom(room.code); rooms.clear(); sessions.clear(); }
export function _testReset() { shutdownRooms(); }
export { DISCONNECT_GRACE_MS, MAX_PLAYERS, RESULTS_ROOM_TTL_MS };
