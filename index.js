import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AVATARS,
  createRoom,
  disconnect,
  getRoom,
  joinRoom,
  removePlayer,
  setReady,
  startGame,
  submitGameAction,
  rematch,
  subscribe,
  updateIdentity,
  shutdownRooms
} from './rooms.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = join(__dirname, '../../public');
const clientRoot = join(__dirname, '.');
export const port = Number(process.env.PORT || 3000);
export const host = process.env.HOST || '0.0.0.0';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function safePath(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const relative = decoded === '/' ? '/index.html' : decoded;
  const normalized = normalize(relative).replace(/^([.][.][/\\])+/, '');
  return join(root, normalized);
}

async function sendFile(res, filePath) {
  const body = await readFile(filePath);
  const type = mimeTypes[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(payload));
}

const errors = {
  ROOM_NOT_FOUND: ['Room unavailable', 'That room code does not exist or has expired.'],
  ROOM_FULL: ['Room full', 'This room already has 8 players.'],
  AVATAR_TAKEN: ['Avatar unavailable', 'That hacker avatar is already being used in this room.'],
  AVATAR_INVALID: ['Invalid avatar', 'Choose one of the available hacker avatars.'],
  NAME_REQUIRED: ['Name required', 'Enter a hacker name before continuing.'],
  HOST_ONLY: ['Host only', 'Only the current host can perform that action.'],
  MIN_PLAYERS: ['Not enough players', 'At least 3 players are required to start.'],
  PLAYERS_NOT_READY: ['Players not ready', 'Every player must be ready before the host can start.'],
  GAME_ALREADY_STARTED: ['Game started', 'The lobby is locked because the game has started.'],
  IDENTITY_LOCKED: ['Identity locked', 'Your hacker identity is locked once the game starts.'],
  SESSION_INVALID: ['Session expired', 'Reconnect to the room from the lobby entry screen.'],
  PLAYER_NOT_FOUND: ['Player unavailable', 'That player is no longer in the lobby.'],
  CANNOT_REMOVE_HOST: ['Action unavailable', 'The host cannot remove themselves.'],
  INVALID_ACTION: ['Invalid action', 'Choose one of the four available actions.'],
  INVALID_TARGET: ['Invalid target', 'Choose another connected operator as your Steal target.'],
  TURN_NOT_ACCEPTING_ACTIONS: ['Turn locked', 'The decision window has closed.'],
  ACTION_ALREADY_SUBMITTED: ['Action locked', 'Your action has already been submitted for this turn.']
};

function handleError(res, error) {
  const status = error.status || 500;
  const [title, message] = errors[error.message] || ['Server error', 'Something went wrong. Please try again.'];
  json(res, status, { ok: false, error: error.message, title, message });
}

export function createAppServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const sessionId = req.headers['x-session-id'] || url.searchParams.get('session');

      if (url.pathname === '/api/health' && req.method === 'GET') {
        json(res, 200, { ok: true, service: 'cyber-heist', stage: '3C' });
        return;
      }

      if (url.pathname === '/api/avatars' && req.method === 'GET') {
        json(res, 200, { ok: true, avatars: AVATARS });
        return;
      }

      if (url.pathname === '/api/rooms' && req.method === 'POST') {
        const result = createRoom(await readJson(req));
        json(res, 201, { ok: true, ...result });
        return;
      }

      if (url.pathname === '/api/rooms/join' && req.method === 'POST') {
        const result = joinRoom(await readJson(req));
        json(res, 201, { ok: true, ...result });
        return;
      }

      if (url.pathname === '/api/rooms/me' && req.method === 'GET') {
        json(res, 200, { ok: true, room: getRoom(sessionId) });
        return;
      }

      if (url.pathname === '/api/rooms/identity' && req.method === 'PATCH') {
        json(res, 200, { ok: true, room: updateIdentity(sessionId, await readJson(req)) });
        return;
      }

      if (url.pathname === '/api/rooms/ready' && req.method === 'POST') {
        const body = await readJson(req);
        json(res, 200, { ok: true, room: setReady(sessionId, body.ready) });
        return;
      }

      if (url.pathname === '/api/rooms/start' && req.method === 'POST') {
        json(res, 200, { ok: true, room: startGame(sessionId) });
        return;
      }

      if (url.pathname === '/api/rooms/action' && req.method === 'POST') {
        const body = await readJson(req);
        json(res, 200, { ok: true, ...submitGameAction(sessionId, body) });
        return;
      }

      if (url.pathname === '/api/rooms/rematch' && req.method === 'POST') {
        json(res, 200, { ok: true, room: rematch(sessionId) });
        return;
      }

      if (url.pathname === '/api/rooms/remove' && req.method === 'POST') {
        const body = await readJson(req);
        json(res, 200, { ok: true, room: removePlayer(sessionId, body.playerId) });
        return;
      }

      if (url.pathname === '/api/rooms/events' && req.method === 'GET') {
        const cleanup = subscribe(sessionId, res);
        req.on('close', () => { cleanup(); disconnect(sessionId); });
        return;
      }

      const candidates = [safePath(publicRoot, url.pathname), safePath(clientRoot, url.pathname)];
      for (const filePath of candidates) {
        try {
          await sendFile(res, filePath);
          return;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      await sendFile(res, join(clientRoot, 'index.html'));
    } catch (error) {
      console.error(error);
      handleError(res, error);
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createAppServer();
  server.listen(port, host, () => console.log(`Cyber Heist Stage 3C listening on ${host}:${port}`));
  const shutdown = () => { shutdownRooms(); server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
