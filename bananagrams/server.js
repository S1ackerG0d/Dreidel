'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3300;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const GRID = 63; // max grid bound; each player's board can grow outward up to this size

// Official Bananagrams letter distribution — 144 tiles total.
const DISTRIBUTION = {
  A: 13, B: 3, C: 3, D: 6, E: 18, F: 3, G: 4, H: 3, I: 12, J: 2, K: 2,
  L: 5, M: 3, N: 8, O: 11, P: 3, Q: 2, R: 9, S: 6, T: 9, U: 6, V: 3,
  W: 3, X: 2, Y: 3, Z: 2,
};

function buildBunch() {
  const tiles = [];
  let n = 0;
  for (const [letter, count] of Object.entries(DISTRIBUTION)) {
    for (let i = 0; i < count; i++) tiles.push({ id: 't' + n++, letter });
  }
  return tiles;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function startingCount(playerCount) {
  if (playerCount <= 4) return 21;
  if (playerCount <= 6) return 15;
  return 11;
}

// ---------------------------------------------------------------------------
// Game state (single shared table)
// ---------------------------------------------------------------------------
const game = {
  phase: 'lobby', // 'lobby' | 'playing' | 'verify' | 'gameover'
  players: [], // { id, name, connected, rack:[tile], board:{ "r,c": tile }, out }
  hostId: null,
  bunch: [],
  bananaClaimId: null, // player whose grid is being verified
  winnerId: null,
  log: [],
};

const clients = new Map();

function addLog(message) {
  game.log.push({ t: Date.now(), message });
  if (game.log.length > 60) game.log.shift();
}

function findPlayer(id) {
  return game.players.find((p) => p.id === id);
}
function activePlayers() {
  return game.players.filter((p) => !p.out);
}

// A grid is "connected" if every placed tile is reachable from any other by
// horizontal/vertical steps — i.e. it forms a single crossword, no islands.
function isConnected(board) {
  const keys = Object.keys(board);
  if (keys.length <= 1) return true;
  const set = new Set(keys);
  const seen = new Set([keys[0]]);
  const stack = [keys[0]];
  while (stack.length) {
    const [r, c] = stack.pop().split(',').map(Number);
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${r + dr},${c + dc}`;
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push(k);
      }
    }
  }
  return seen.size === set.size;
}

// ---------------------------------------------------------------------------
// Per-player view: you only ever see your own rack and board (during play).
// ---------------------------------------------------------------------------
function stateFor(viewerId) {
  const viewer = findPlayer(viewerId);

  let reveal = null;
  if ((game.phase === 'verify' || game.phase === 'gameover')) {
    const shownId = game.phase === 'verify' ? game.bananaClaimId : game.winnerId;
    const shown = findPlayer(shownId);
    if (shown) reveal = { playerId: shown.id, name: shown.name, board: shown.board };
  }

  return {
    phase: game.phase,
    hostId: game.hostId,
    gridSize: GRID,
    bunchCount: game.bunch.length,
    bananaClaimId: game.bananaClaimId,
    winnerId: game.winnerId,
    yourRack: viewer && game.phase !== 'lobby' ? viewer.rack : [],
    yourBoard: viewer && game.phase !== 'lobby' ? viewer.board : {},
    youAreOut: !!(viewer && viewer.out),
    reveal,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      out: p.out,
      tileCount: p.rack.length + Object.keys(p.board).length,
      rackCount: p.rack.length,
    })),
    log: game.log.slice(-18),
  };
}

function broadcast() {
  for (const [pid, res] of clients.entries()) {
    res.write(`data: ${JSON.stringify(stateFor(pid))}\n\n`);
  }
}

// ---------------------------------------------------------------------------
// Round flow
// ---------------------------------------------------------------------------
function startGame() {
  if (game.players.length < 1) return { error: 'Need at least one player.' };
  game.bunch = buildBunch();
  shuffle(game.bunch);
  game.bananaClaimId = null;
  game.winnerId = null;

  const per = startingCount(game.players.length);
  if (game.bunch.length < per * game.players.length) {
    return { error: 'Too many players for the bunch.' };
  }
  for (const p of game.players) {
    p.out = false;
    p.board = {};
    p.rack = game.bunch.splice(0, per);
  }
  game.phase = 'playing';
  addLog(`Split! Each player drew ${per} tiles. ${game.bunch.length} left in the bunch.`);
  return {};
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function handleAction(body) {
  const { type } = body;

  switch (type) {
    case 'join': {
      const name = String(body.name || '').trim().slice(0, 20);
      if (!name) return { status: 400, json: { error: 'Name is required.' } };
      if (game.phase !== 'lobby') {
        return { status: 400, json: { error: 'A game is in progress.' } };
      }
      if (game.players.length >= 8) {
        return { status: 400, json: { error: 'Table is full (8 players max).' } };
      }
      const id = crypto.randomUUID();
      game.players.push({ id, name, connected: false, rack: [], board: {}, out: false });
      if (!game.hostId) game.hostId = id;
      addLog(`${name} joined.`);
      broadcast();
      return { status: 200, json: { playerId: id } };
    }

    case 'start': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can start.' } };
      }
      if (game.phase === 'playing') {
        return { status: 400, json: { error: 'Already playing.' } };
      }
      const result = startGame();
      if (result.error) return { status: 400, json: result };
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'place': {
      const p = findPlayer(body.playerId);
      if (!p || game.phase !== 'playing' || p.out) {
        return { status: 400, json: { error: 'You cannot place a tile right now.' } };
      }
      const r = Number(body.r);
      const c = Number(body.c);
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= GRID || c >= GRID) {
        return { status: 400, json: { error: 'Off the grid.' } };
      }
      const key = `${r},${c}`;
      if (p.board[key]) return { status: 400, json: { error: 'That cell is taken.' } };
      const idx = p.rack.findIndex((t) => t.id === body.tileId);
      if (idx === -1) return { status: 400, json: { error: 'That tile is not in your rack.' } };
      const [tile] = p.rack.splice(idx, 1);
      p.board[key] = tile;
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'recall': {
      const p = findPlayer(body.playerId);
      if (!p || game.phase !== 'playing' || p.out) {
        return { status: 400, json: { error: 'You cannot move a tile right now.' } };
      }
      const key = `${Number(body.r)},${Number(body.c)}`;
      const tile = p.board[key];
      if (!tile) return { status: 400, json: { error: 'No tile there.' } };
      delete p.board[key];
      p.rack.push(tile);
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'move': {
      const p = findPlayer(body.playerId);
      if (!p || game.phase !== 'playing' || p.out) {
        return { status: 400, json: { error: 'You cannot move a tile right now.' } };
      }
      const from = `${Number(body.fromR)},${Number(body.fromC)}`;
      const tr = Number(body.toR), tc = Number(body.toC);
      const to = `${tr},${tc}`;
      if (tr < 0 || tc < 0 || tr >= GRID || tc >= GRID) {
        return { status: 400, json: { error: 'Off the grid.' } };
      }
      if (!p.board[from]) return { status: 400, json: { error: 'No tile there.' } };
      if (p.board[to]) return { status: 400, json: { error: 'That cell is taken.' } };
      p.board[to] = p.board[from];
      delete p.board[from];
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'dump': {
      const p = findPlayer(body.playerId);
      if (!p || game.phase !== 'playing' || p.out) {
        return { status: 400, json: { error: 'You cannot dump right now.' } };
      }
      if (game.bunch.length < 3) {
        return { status: 400, json: { error: 'Not enough tiles in the bunch to dump.' } };
      }
      const idx = p.rack.findIndex((t) => t.id === body.tileId);
      if (idx === -1) return { status: 400, json: { error: 'That tile is not in your rack.' } };
      const [tile] = p.rack.splice(idx, 1);
      const drawn = game.bunch.splice(0, 3);
      p.rack.push(...drawn);
      game.bunch.push(tile);
      shuffle(game.bunch);
      addLog(`${p.name} dumped a tile and drew 3.`);
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'peel': {
      const p = findPlayer(body.playerId);
      if (!p || game.phase !== 'playing' || p.out) {
        return { status: 400, json: { error: 'You cannot peel right now.' } };
      }
      if (p.rack.length > 0) {
        return { status: 400, json: { error: 'Use all your tiles first.' } };
      }
      if (Object.keys(p.board).length === 0) {
        return { status: 400, json: { error: 'Build a grid first.' } };
      }
      if (!isConnected(p.board)) {
        return { status: 400, json: { error: 'Your tiles must all connect into one grid.' } };
      }
      const active = activePlayers();
      if (game.bunch.length >= active.length) {
        // Peel: every active player draws one tile.
        for (const ap of active) ap.rack.push(game.bunch.shift());
        addLog(`${p.name} peeled! Everyone draws a tile. ${game.bunch.length} left.`);
        broadcast();
        return { status: 200, json: { ok: true } };
      }
      // Not enough tiles to peel — this is a BANANAS claim.
      game.phase = 'verify';
      game.bananaClaimId = p.id;
      addLog(`${p.name} called BANANAS! Verify their grid.`);
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'confirmWin': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can confirm.' } };
      }
      if (game.phase !== 'verify') return { status: 400, json: { error: 'Nothing to confirm.' } };
      game.winnerId = game.bananaClaimId;
      game.phase = 'gameover';
      const w = findPlayer(game.winnerId);
      addLog(`${w ? w.name : 'A player'} wins — BANANAS confirmed!`);
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'rotten': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can call rotten.' } };
      }
      if (game.phase !== 'verify') return { status: 400, json: { error: 'Nothing to reject.' } };
      const claimant = findPlayer(game.bananaClaimId);
      if (claimant) {
        // Rotten banana: return all the caller's tiles to the bunch; they're out.
        game.bunch.push(...claimant.rack, ...Object.values(claimant.board));
        claimant.rack = [];
        claimant.board = {};
        claimant.out = true;
        shuffle(game.bunch);
        addLog(`${claimant.name}'s grid was rotten — they're out. Play continues.`);
      }
      game.bananaClaimId = null;
      game.phase = activePlayers().length > 0 ? 'playing' : 'gameover';
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'toLobby': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can reset.' } };
      }
      game.phase = 'lobby';
      game.bunch = [];
      game.bananaClaimId = null;
      game.winnerId = null;
      for (const p of game.players) { p.rack = []; p.board = {}; p.out = false; }
      addLog('Returned to the lobby.');
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'leave': {
      const idx = game.players.findIndex((p) => p.id === body.playerId);
      if (idx !== -1) {
        const [removed] = game.players.splice(idx, 1);
        clients.delete(body.playerId);
        // Return their tiles so the bunch stays whole.
        if (game.phase !== 'lobby') {
          game.bunch.push(...removed.rack, ...Object.values(removed.board));
          shuffle(game.bunch);
        }
        addLog(`${removed.name} left.`);
        if (game.hostId === removed.id) game.hostId = game.players[0]?.id ?? null;
        if (game.bananaClaimId === removed.id) {
          game.bananaClaimId = null;
          if (game.phase === 'verify') game.phase = 'playing';
        }
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
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
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
  console.log('\n  🍌  Bananagrams server running!\n');
  console.log('  On this computer:   http://localhost:' + PORT);
  for (const addr of lanAddresses()) {
    console.log('  On your LAN:         http://' + addr + ':' + PORT);
  }
  console.log('\n  Share a LAN address with players on the same network.');
  console.log('  Press Ctrl+C to stop.\n');
});
