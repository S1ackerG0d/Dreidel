'use strict';

// Carcassonne — LAN edition. The server owns the authoritative Game (the same
// rules engine the tests exercise); players join from their browsers, receive
// state over SSE, and send actions over POST. Zero dependencies.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// engine.js resolves TILE_TYPES/START_TILE through the global scope at call
// time (in the browser they come from the tiles.js <script>), so mirror the
// module exports onto Node's global before using the engine.
const { TILE_TYPES, START_TILE } = require('./public/tiles.js');
global.TILE_TYPES = TILE_TYPES;
global.START_TILE = START_TILE;
const { Game, MEEPLES_PER_PLAYER } = require('./public/engine.js');

const PORT = Number(process.env.PORT) || 3700;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
// Test hook: allows forcing the next drawn tile for deterministic UI tests.
const TEST_MODE = process.env.CARC_TEST === '1';

const COLORS = [
  { color: '#d23b3b', name: 'Red' },
  { color: '#3b6fd2', name: 'Blue' },
  { color: '#e0b62a', name: 'Yellow' },
  { color: '#3ba05a', name: 'Green' },
  { color: '#4a4a52', name: 'Black' },
];

// ---------------------------------------------------------------------------
// Room state (single shared room — one table per host)
// ---------------------------------------------------------------------------
let room = freshRoom();

function freshRoom() {
  return {
    phase: 'lobby', // 'lobby' | 'playing' | 'gameover'
    players: [],    // { id, name, color, colorName, connected }
    hostId: null,
    game: null,     // engine Game; its players array parallels room.players
  };
}

const clients = new Map(); // playerId -> SSE response

function findPlayer(id) {
  return room.players.find((p) => p.id === id);
}

function currentPlayerId() {
  if (!room.game || room.game.over) return null;
  const p = room.players[room.game.current];
  return p ? p.id : null;
}

// ---------------------------------------------------------------------------
// Per-viewer state. Carcassonne is a perfect-information game, so everyone
// sees the same board, drawn tile, and options — spectators watch live.
// ---------------------------------------------------------------------------
function stateFor(viewerId) {
  const g = room.game;
  const base = {
    phase: room.phase,
    hostId: room.hostId,
    youId: viewerId,
    players: room.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      colorName: p.colorName,
      connected: p.connected,
      score: g ? g.players[i].score : 0,
      meeples: g ? g.players[i].meeples : MEEPLES_PER_PLAYER,
    })),
  };
  if (!g) return base;
  base.currentPlayerId = currentPlayerId();
  base.board = [...g.board.values()].map((t) => ({
    x: t.x, y: t.y, type: t.type, rot: t.rot, meeples: t.meeples,
  }));
  base.drawn = g.drawn;
  base.placed = g.placed;
  base.deckLeft = g.deck.length;
  base.discards = g.discards.length;
  base.over = g.over;
  base.log = g.log.slice(-40);
  if (g.drawn && !g.placed) base.legalCells = g.legalCells(g.drawn.type, g.drawn.rot);
  if (g.placed) base.meepleOptions = g.meepleOptions();
  if (room.phase === 'gameover') {
    base.standings = g.standings().map((s) => ({
      id: room.players[s.idx].id, name: s.name, color: s.color, score: s.score,
    }));
  }
  return base;
}

function broadcast() {
  for (const [pid, res] of clients) {
    res.write(`data: ${JSON.stringify(stateFor(pid))}\n\n`);
  }
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------
const err = (status, error) => ({ status, json: { error } });

function handleAction(body) {
  const { type, playerId } = body;

  if (type === 'join') {
    const name = String(body.name || '').trim().slice(0, 16);
    if (!name) return err(400, 'Name is required.');
    if (room.phase !== 'lobby') return err(400, 'Game already in progress.');
    if (room.players.length >= COLORS.length) return err(400, 'Game is full (5 players max).');
    const id = crypto.randomUUID();
    const c = COLORS[room.players.length];
    room.players.push({ id, name, color: c.color, colorName: c.name, connected: false });
    if (!room.hostId) room.hostId = id;
    broadcast();
    return { status: 200, json: { playerId: id, state: stateFor(id) } };
  }

  const player = findPlayer(playerId);
  if (!player) {
    if (type === 'leave') return { status: 200, json: { ok: true } };
    return err(400, 'Unknown player.');
  }

  const g = room.game;
  const isHost = playerId === room.hostId;
  const isCurrent = room.phase === 'playing' && currentPlayerId() === playerId;
  const finishTurn = () => {
    g.endTurn();
    if (g.over) room.phase = 'gameover';
  };

  switch (type) {
    case 'start':
      if (!isHost) return err(403, 'Only the host can start the game.');
      if (room.phase !== 'lobby') return err(400, 'Already started.');
      if (room.players.length < 2) return err(400, 'Need at least 2 players.');
      room.game = new Game(room.players.map((p) => ({ name: p.name, color: p.color })));
      room.phase = 'playing';
      room.game.addLog('Game started — good luck!');
      break;

    case 'newGame':
      if (!isHost) return err(403, 'Only the host can return to the lobby.');
      room.phase = 'lobby';
      room.game = null;
      break;

    case 'rotate':
      if (!isCurrent) return err(400, 'Not your turn.');
      if (!g.drawn || g.placed) return err(400, 'Nothing to rotate.');
      g.rotateDrawn();
      break;

    case 'place': {
      if (!isCurrent) return err(400, 'Not your turn.');
      const x = Math.round(Number(body.x));
      const y = Math.round(Number(body.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return err(400, 'Bad coordinates.');
      if (!g.placeTile(x, y)) return err(400, "The tile doesn't fit there.");
      // Nothing to decide when no meeple can be placed — turn ends directly.
      if (g.meepleOptions().length === 0) finishTurn();
      break;
    }

    case 'meeple':
      if (!isCurrent) return err(400, 'Not your turn.');
      if (!g.placed) return err(400, 'Place a tile first.');
      if (!g.placeMeeple(Number(body.fi))) return err(400, 'You cannot place a meeple there.');
      finishTurn();
      break;

    case 'skip':
      if (!isCurrent) return err(400, 'Not your turn.');
      if (!g.placed) return err(400, 'Place a tile first.');
      finishTurn();
      break;

    case 'undo':
      if (!isCurrent) return err(400, 'Not your turn.');
      if (!g.placed) return err(400, 'Nothing to undo.');
      g.undoPlace();
      break;

    case 'leave': {
      if (room.phase === 'lobby') {
        const idx = room.players.findIndex((p) => p.id === playerId);
        if (idx !== -1) {
          const [removed] = room.players.splice(idx, 1);
          // Keep colours contiguous in join order.
          room.players.forEach((p, i) => { p.color = COLORS[i].color; p.colorName = COLORS[i].name; });
          clients.delete(playerId);
          if (room.hostId === removed.id) room.hostId = room.players[0] ? room.players[0].id : null;
        }
      }
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'forceDrawn':
      if (!TEST_MODE) return err(400, 'Unknown action.');
      if (!g) return err(400, 'No game.');
      g.drawn = { type: String(body.tile), rot: Number(body.rot) || 0 };
      break;

    default:
      return err(400, 'Unknown action.');
  }

  broadcast();
  return { status: 200, json: { state: stateFor(playerId) } };
}

// ---------------------------------------------------------------------------
// HTTP + SSE plumbing
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(filePath, (fsErr, data) => {
    if (fsErr) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function handleSSE(req, res, playerId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  const player = findPlayer(playerId);
  if (player) player.connected = true;
  clients.set(playerId, res);
  res.write(`data: ${JSON.stringify(stateFor(playerId))}\n\n`);
  broadcast();
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(keepAlive);
    if (clients.get(playerId) === res) clients.delete(playerId);
    const p = findPlayer(playerId);
    if (p) p.connected = false;
    broadcast();
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/events' && req.method === 'GET') {
    const playerId = url.searchParams.get('playerId');
    if (!playerId) { res.writeHead(400).end('playerId required'); return; }
    handleSSE(req, res, playerId);
    return;
  }
  if (url.pathname === '/api/action' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); }
      catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON.' }));
        return;
      }
      let out;
      try { out = handleAction(parsed); }
      catch (e) { console.error(e); out = err(500, 'Server error.'); }
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.json));
    });
    return;
  }
  if (req.method === 'GET') { serveStatic(req, res); return; }
  res.writeHead(405).end('Method not allowed');
});

function lanAddresses() {
  const addrs = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) addrs.push(iface.address);
    }
  }
  return addrs;
}

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('\n  🏰  Carcassonne — LAN edition server running!\n');
    console.log('  On this computer:   http://localhost:' + PORT);
    for (const addr of lanAddresses()) console.log('  On your LAN:         http://' + addr + ':' + PORT);
    console.log('\n  Share a LAN address with players on the same network.');
    console.log('  Press Ctrl+C to stop.\n');
  });
}

// Exposed for tests (no HTTP needed).
module.exports = {
  handleAction,
  getRoom: () => room,
  resetRoom: () => { room = freshRoom(); clients.clear(); },
};
