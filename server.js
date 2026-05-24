'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const LETTERS = [
  { key: 'nun', hebrew: 'נ', name: 'Nun', meaning: 'Nothing happens.' },
  { key: 'gimel', hebrew: 'ג', name: 'Gimel', meaning: 'Take the whole pot!' },
  { key: 'hey', hebrew: 'ה', name: 'Hey', meaning: 'Take half the pot.' },
  { key: 'shin', hebrew: 'ש', name: 'Shin', meaning: 'Put one in the pot.' },
];

// ---------------------------------------------------------------------------
// Game state (single room — plenty for a LAN party)
// ---------------------------------------------------------------------------
const game = {
  phase: 'lobby', // 'lobby' | 'playing' | 'gameover'
  players: [], // { id, name, tokens, out, connected }
  pot: 0,
  startingTokens: 10,
  turnIndex: 0,
  lastSpin: null, // { playerId, name, letter, hebrew, detail }
  winnerId: null,
  hostId: null,
  log: [],
};

const clients = new Map(); // playerId -> http response (SSE stream)

function addLog(message) {
  game.log.push({ t: Date.now(), message });
  if (game.log.length > 50) game.log.shift();
}

function activePlayers() {
  return game.players.filter((p) => !p.out);
}

function publicState() {
  return {
    phase: game.phase,
    pot: game.pot,
    startingTokens: game.startingTokens,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      tokens: p.tokens,
      out: p.out,
      connected: p.connected,
    })),
    currentPlayerId:
      game.phase === 'playing' ? game.players[game.turnIndex]?.id ?? null : null,
    lastSpin: game.lastSpin,
    winnerId: game.winnerId,
    hostId: game.hostId,
    log: game.log.slice(-15),
  };
}

function broadcast() {
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients.values()) {
    res.write(payload);
  }
}

// ---------------------------------------------------------------------------
// Game logic
// ---------------------------------------------------------------------------
function findPlayer(id) {
  return game.players.find((p) => p.id === id);
}

function ante() {
  // Every active player drops one token into an empty pot.
  for (const p of activePlayers()) {
    if (p.tokens > 0) {
      p.tokens -= 1;
      game.pot += 1;
    }
  }
  addLog('Everyone antes one — the pot is replenished.');
}

function eliminateBrokePlayers() {
  for (const p of activePlayers()) {
    if (p.tokens <= 0) {
      p.tokens = 0;
      p.out = true;
      addLog(`${p.name} is out of gelt and leaves the game.`);
    }
  }
}

function advanceTurn() {
  const players = game.players;
  if (players.length === 0) return;
  let next = game.turnIndex;
  for (let i = 0; i < players.length; i++) {
    next = (next + 1) % players.length;
    if (!players[next].out) {
      game.turnIndex = next;
      return;
    }
  }
}

function checkGameOver() {
  const active = activePlayers();
  if (game.phase === 'playing' && active.length <= 1) {
    game.phase = 'gameover';
    game.winnerId = active[0]?.id ?? null;
    if (game.winnerId) {
      addLog(`${active[0].name} wins with ${active[0].tokens} gelt!`);
    } else {
      addLog('Game over — no winner.');
    }
    return true;
  }
  return false;
}

function startGame() {
  if (game.players.length < 2) {
    return { error: 'Need at least 2 players to start.' };
  }
  game.phase = 'playing';
  game.pot = 0;
  game.winnerId = null;
  game.lastSpin = null;
  game.turnIndex = 0;
  for (const p of game.players) {
    p.tokens = game.startingTokens;
    p.out = false;
  }
  addLog(`Game started — each player gets ${game.startingTokens} gelt.`);
  ante();
  return {};
}

function rollLetter() {
  const idx = crypto.randomInt(0, LETTERS.length);
  return LETTERS[idx];
}

function spin(playerId) {
  if (game.phase !== 'playing') return { error: 'Game is not in progress.' };
  const current = game.players[game.turnIndex];
  if (!current || current.id !== playerId) {
    return { error: 'It is not your turn.' };
  }

  const letter = rollLetter();
  let detail = '';

  switch (letter.key) {
    case 'nun':
      detail = `${current.name} spun Nun — nothing happens.`;
      break;
    case 'gimel':
      current.tokens += game.pot;
      detail = `${current.name} spun Gimel and takes the whole pot (${game.pot})!`;
      game.pot = 0;
      break;
    case 'hey': {
      const take = Math.ceil(game.pot / 2);
      current.tokens += take;
      game.pot -= take;
      detail = `${current.name} spun Hey and takes half the pot (${take}).`;
      break;
    }
    case 'shin':
      current.tokens -= 1;
      game.pot += 1;
      detail = `${current.name} spun Shin and puts one in the pot.`;
      break;
  }

  game.lastSpin = {
    playerId: current.id,
    name: current.name,
    letter: letter.key,
    hebrew: letter.hebrew,
    letterName: letter.name,
    detail,
  };
  addLog(detail);

  eliminateBrokePlayers();

  if (checkGameOver()) {
    return {};
  }

  advanceTurn();

  // If the pot has been emptied, everyone antes before the next spin.
  if (game.pot === 0) {
    ante();
    eliminateBrokePlayers();
    checkGameOver();
  }

  return {};
}

function resetToLobby() {
  game.phase = 'lobby';
  game.pot = 0;
  game.winnerId = null;
  game.lastSpin = null;
  game.turnIndex = 0;
  for (const p of game.players) {
    p.tokens = game.startingTokens;
    p.out = false;
  }
  addLog('Returned to the lobby for a new game.');
}

// ---------------------------------------------------------------------------
// Action handling
// ---------------------------------------------------------------------------
function handleAction(body) {
  const { type } = body;

  switch (type) {
    case 'join': {
      const name = String(body.name || '').trim().slice(0, 20);
      if (!name) return { status: 400, json: { error: 'Name is required.' } };
      if (game.phase !== 'lobby') {
        return { status: 400, json: { error: 'Game already in progress.' } };
      }
      if (game.players.length >= 8) {
        return { status: 400, json: { error: 'Game is full (8 players max).' } };
      }
      const id = crypto.randomUUID();
      const player = { id, name, tokens: game.startingTokens, out: false, connected: false };
      game.players.push(player);
      if (!game.hostId) game.hostId = id;
      addLog(`${name} joined the game.`);
      broadcast();
      return { status: 200, json: { playerId: id, state: publicState() } };
    }

    case 'setStartingTokens': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can change settings.' } };
      }
      if (game.phase !== 'lobby') {
        return { status: 400, json: { error: 'Can only change in the lobby.' } };
      }
      const n = Math.max(2, Math.min(50, Number(body.value) || 10));
      game.startingTokens = n;
      for (const p of game.players) p.tokens = n;
      broadcast();
      return { status: 200, json: { state: publicState() } };
    }

    case 'start': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can start the game.' } };
      }
      const result = startGame();
      if (result.error) return { status: 400, json: result };
      broadcast();
      return { status: 200, json: { state: publicState() } };
    }

    case 'spin': {
      const result = spin(body.playerId);
      if (result.error) return { status: 400, json: result };
      broadcast();
      return { status: 200, json: { state: publicState() } };
    }

    case 'newGame': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can start a new game.' } };
      }
      resetToLobby();
      broadcast();
      return { status: 200, json: { state: publicState() } };
    }

    case 'leave': {
      const idx = game.players.findIndex((p) => p.id === body.playerId);
      if (idx !== -1) {
        const [removed] = game.players.splice(idx, 1);
        addLog(`${removed.name} left the game.`);
        clients.delete(body.playerId);
        if (game.hostId === removed.id) {
          game.hostId = game.players[0]?.id ?? null;
        }
        if (game.turnIndex >= game.players.length) game.turnIndex = 0;
        if (game.phase === 'playing') checkGameOver();
        broadcast();
      }
      return { status: 200, json: { ok: true } };
    }

    default:
      return { status: 400, json: { error: 'Unknown action.' } };
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  // Prevent path traversal outside the public directory.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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

  // Send current state immediately.
  res.write(`data: ${JSON.stringify(publicState())}\n\n`);
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
    if (!playerId) {
      res.writeHead(400).end('playerId required');
      return;
    }
    handleSSE(req, res, playerId);
    return;
  }

  if (url.pathname === '/api/action' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON.' }));
        return;
      }
      const { status, json } = handleAction(parsed);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    });
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405).end('Method not allowed');
});

function lanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}

server.listen(PORT, HOST, () => {
  console.log('\n  🕎  Dreidel game server running!\n');
  console.log('  On this computer:   http://localhost:' + PORT);
  for (const addr of lanAddresses()) {
    console.log('  On your LAN:         http://' + addr + ':' + PORT);
  }
  console.log('\n  Share a LAN address with players on the same network.');
  console.log('  Press Ctrl+C to stop.\n');
});
