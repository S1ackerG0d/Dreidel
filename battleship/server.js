'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3800;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const SIZE = 10; // 10 x 10 grid
const SHIPS = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
];

// ---------------------------------------------------------------------------
// Game state (single shared room, exactly two players)
// ---------------------------------------------------------------------------
const game = {
  phase: 'lobby', // 'lobby' | 'placing' | 'playing' | 'gameover'
  players: [], // see makePlayer()
  hostId: null,
  turnId: null, // whose turn it is to fire (during 'playing')
  winnerId: null,
  log: [],
};

const clients = new Map();

function makePlayer(id, name) {
  return {
    id,
    name,
    connected: false,
    ready: false,
    // ships placed by this player: { name, size, cells: [{r,c}], hits, sunk }
    fleet: [],
    // shots this player has RECEIVED from the opponent: 0 = none, 1 = miss, 2 = hit
    incoming: emptyGrid(),
  };
}

function emptyGrid() {
  return Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
}

function addLog(message) {
  game.log.push({ t: Date.now(), message });
  if (game.log.length > 80) game.log.shift();
}
function findPlayer(id) {
  return game.players.find((p) => p.id === id);
}
function opponentOf(id) {
  return game.players.find((p) => p.id !== id) || null;
}

// ---------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------
function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

// All cells currently occupied by a player's fleet (optionally excluding one ship).
function occupied(player, exceptName) {
  const set = new Set();
  for (const ship of player.fleet) {
    if (ship.name === exceptName) continue;
    for (const cell of ship.cells) set.add(cell.r * SIZE + cell.c);
  }
  return set;
}

function shipCells(r, c, size, horizontal) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    cells.push(horizontal ? { r, c: c + i } : { r: r + i, c });
  }
  return cells;
}

// Try to place one ship; returns true on success, false if it doesn't fit.
function placeShip(player, name, r, c, horizontal) {
  const spec = SHIPS.find((s) => s.name === name);
  if (!spec) return false;
  const cells = shipCells(r, c, spec.size, horizontal);
  if (cells.some((cell) => !inBounds(cell.r, cell.c))) return false;
  const taken = occupied(player, name);
  if (cells.some((cell) => taken.has(cell.r * SIZE + cell.c))) return false;
  // Remove any existing placement of this ship, then add the new one.
  player.fleet = player.fleet.filter((s) => s.name !== name);
  player.fleet.push({ name, size: spec.size, cells, hits: 0, sunk: false });
  return true;
}

function autoPlace(player) {
  player.fleet = [];
  for (const spec of SHIPS) {
    let placed = false;
    for (let attempts = 0; attempts < 500 && !placed; attempts++) {
      const horizontal = Math.random() < 0.5;
      const r = Math.floor(Math.random() * SIZE);
      const c = Math.floor(Math.random() * SIZE);
      placed = placeShip(player, spec.name, r, c, horizontal);
    }
  }
}

function fleetComplete(player) {
  return SHIPS.every((s) => player.fleet.some((f) => f.name === s.name));
}

// ---------------------------------------------------------------------------
// Per-player view. Crucial: a player must NEVER see the opponent's un-hit
// ships. Each side gets their own full board plus a "fog of war" view of the
// enemy board built only from shots they have fired.
// ---------------------------------------------------------------------------
function yourBoard(player) {
  // Codes: 'water' | 'ship' | 'miss' (enemy shot in water) | 'hit' (your ship hit)
  const grid = Array.from({ length: SIZE }, () => new Array(SIZE).fill('water'));
  for (const ship of player.fleet) {
    for (const cell of ship.cells) grid[cell.r][cell.c] = 'ship';
  }
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (player.incoming[r][c] === 1) grid[r][c] = 'miss';
      else if (player.incoming[r][c] === 2) grid[r][c] = 'hit';
    }
  }
  return grid;
}

function enemyBoard(opp) {
  // What the viewer has learned by firing at `opp`.
  // Codes: 'unknown' | 'miss' | 'hit' | 'sunk' (cell of a fully sunk ship)
  const grid = Array.from({ length: SIZE }, () => new Array(SIZE).fill('unknown'));
  if (!opp) return grid;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (opp.incoming[r][c] === 1) grid[r][c] = 'miss';
      else if (opp.incoming[r][c] === 2) grid[r][c] = 'hit';
    }
  }
  // Reveal the outline of ships that are completely sunk.
  for (const ship of opp.fleet) {
    if (ship.sunk) for (const cell of ship.cells) grid[cell.r][cell.c] = 'sunk';
  }
  return grid;
}

function fleetStatus(player, hideLayout) {
  // For your own fleet hideLayout=false (show everything). For the enemy fleet
  // hideLayout=true: only reveal a ship's hit count when it is fully sunk.
  return player.fleet
    .map((s) => ({
      name: s.name,
      size: s.size,
      sunk: s.sunk,
      hits: hideLayout ? (s.sunk ? s.size : null) : s.hits,
    }))
    // Keep a stable, canonical order regardless of placement order.
    .sort((a, b) => SHIPS.findIndex((s) => s.name === a.name) - SHIPS.findIndex((s) => s.name === b.name));
}

function stateFor(viewerId) {
  const you = findPlayer(viewerId);
  const opp = opponentOf(viewerId);
  return {
    phase: game.phase,
    hostId: game.hostId,
    turnId: game.turnId,
    winnerId: game.winnerId,
    size: SIZE,
    you: you
      ? {
          id: you.id,
          name: you.name,
          ready: you.ready,
          placedShips: you.fleet.map((s) => s.name),
          board: yourBoard(you),
          fleet: fleetStatus(you, false),
        }
      : null,
    opponent: opp
      ? {
          id: opp.id,
          name: opp.name,
          connected: opp.connected,
          ready: opp.ready,
          placedCount: opp.fleet.length,
          board: enemyBoard(opp),
          fleet: fleetStatus(opp, true),
        }
      : null,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      ready: p.ready,
    })),
    log: game.log.slice(-20),
  };
}

function broadcast() {
  for (const [pid, res] of clients.entries()) {
    res.write(`data: ${JSON.stringify(stateFor(pid))}\n\n`);
  }
}

// ---------------------------------------------------------------------------
// Flow control
// ---------------------------------------------------------------------------
function startPlacing() {
  if (game.players.length < 2) return { error: 'Need 2 players to start.' };
  game.phase = 'placing';
  game.winnerId = null;
  game.turnId = null;
  for (const p of game.players) {
    p.ready = false;
    p.fleet = [];
    p.incoming = emptyGrid();
  }
  addLog('Both admirals report for duty — place your fleets!');
  return {};
}

function maybeBeginBattle() {
  if (game.phase !== 'placing') return;
  if (game.players.length === 2 && game.players.every((p) => p.ready && fleetComplete(p))) {
    game.phase = 'playing';
    // The host fires the opening salvo.
    game.turnId = game.hostId && findPlayer(game.hostId) ? game.hostId : game.players[0].id;
    const starter = findPlayer(game.turnId);
    addLog(`All ships placed. Battle stations! ${starter.name} fires first.`);
  }
}

function resetToLobby() {
  game.phase = 'lobby';
  game.turnId = null;
  game.winnerId = null;
  for (const p of game.players) {
    p.ready = false;
    p.fleet = [];
    p.incoming = emptyGrid();
  }
  addLog('Returned to the lobby.');
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
        return { status: 400, json: { error: 'A battle is already in progress.' } };
      }
      if (game.players.length >= 2) {
        return { status: 400, json: { error: 'Room is full — Battleship is for 2 players.' } };
      }
      const id = crypto.randomUUID();
      game.players.push(makePlayer(id, name));
      if (!game.hostId) game.hostId = id;
      addLog(`${name} joined.`);
      broadcast();
      return { status: 200, json: { playerId: id } };
    }

    case 'start': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can start.' } };
      }
      const result = startPlacing();
      if (result.error) return { status: 400, json: result };
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'placeShip': {
      const p = findPlayer(body.playerId);
      if (!p || game.phase !== 'placing') {
        return { status: 400, json: { error: 'You cannot place ships right now.' } };
      }
      if (p.ready) return { status: 400, json: { error: 'Unready first to rearrange.' } };
      const r = Number(body.r);
      const c = Number(body.c);
      const ok = placeShip(p, body.shipName, r, c, !!body.horizontal);
      if (!ok) return { status: 400, json: { error: "That ship won't fit there." } };
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'autoPlace': {
      const p = findPlayer(body.playerId);
      if (!p || game.phase !== 'placing' || p.ready) {
        return { status: 400, json: { error: 'You cannot place ships right now.' } };
      }
      autoPlace(p);
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'clearBoard': {
      const p = findPlayer(body.playerId);
      if (!p || game.phase !== 'placing' || p.ready) {
        return { status: 400, json: { error: 'You cannot clear right now.' } };
      }
      p.fleet = [];
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'ready': {
      const p = findPlayer(body.playerId);
      if (!p || game.phase !== 'placing') {
        return { status: 400, json: { error: 'Nothing to ready up for.' } };
      }
      if (!fleetComplete(p)) {
        return { status: 400, json: { error: 'Place all 5 ships first.' } };
      }
      p.ready = true;
      addLog(`${p.name} is ready.`);
      maybeBeginBattle();
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'unready': {
      const p = findPlayer(body.playerId);
      if (!p || game.phase !== 'placing') {
        return { status: 400, json: { error: 'Nothing to change.' } };
      }
      p.ready = false;
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'fire': {
      const me = findPlayer(body.playerId);
      if (!me || game.phase !== 'playing') {
        return { status: 400, json: { error: 'You cannot fire right now.' } };
      }
      if (game.turnId !== me.id) {
        return { status: 400, json: { error: "It's not your turn." } };
      }
      const opp = opponentOf(me.id);
      if (!opp) return { status: 400, json: { error: 'No opponent.' } };
      const r = Number(body.r);
      const c = Number(body.c);
      if (!inBounds(r, c)) return { status: 400, json: { error: 'Off the map.' } };
      if (opp.incoming[r][c] !== 0) {
        return { status: 400, json: { error: 'You already fired there.' } };
      }

      const hitShip = opp.fleet.find((s) => s.cells.some((cell) => cell.r === r && cell.c === c));
      if (hitShip) {
        opp.incoming[r][c] = 2;
        hitShip.hits += 1;
        if (hitShip.hits >= hitShip.size) {
          hitShip.sunk = true;
          addLog(`💥 ${me.name} sank ${opp.name}'s ${hitShip.name}!`);
        } else {
          addLog(`${me.name} fired at ${coord(r, c)} — a hit!`);
        }
      } else {
        opp.incoming[r][c] = 1;
        addLog(`${me.name} fired at ${coord(r, c)} — a miss.`);
      }

      if (opp.fleet.every((s) => s.sunk)) {
        game.phase = 'gameover';
        game.winnerId = me.id;
        game.turnId = null;
        addLog(`🏆 ${me.name} wins — ${opp.name}'s fleet is destroyed!`);
      } else {
        // Classic rules: one shot per turn, then control passes.
        game.turnId = opp.id;
      }
      broadcast();
      return { status: 200, json: { ok: true, hit: !!hitShip } };
    }

    case 'rematch': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can start a rematch.' } };
      }
      if (game.phase !== 'gameover') {
        return { status: 400, json: { error: 'No finished battle to rematch.' } };
      }
      const result = startPlacing();
      if (result.error) return { status: 400, json: result };
      addLog('Rematch! Place your fleets again.');
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'toLobby': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can reset.' } };
      }
      resetToLobby();
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'leave': {
      const idx = game.players.findIndex((p) => p.id === body.playerId);
      if (idx !== -1) {
        const [removed] = game.players.splice(idx, 1);
        clients.delete(body.playerId);
        addLog(`${removed.name} left.`);
        if (game.hostId === removed.id) game.hostId = game.players[0]?.id ?? null;
        // Losing a player mid-battle ends it.
        if (game.phase !== 'lobby') resetToLobby();
        broadcast();
      }
      return { status: 200, json: { ok: true } };
    }

    default:
      return { status: 400, json: { error: 'Unknown action.' } };
  }
}

function coord(r, c) {
  return String.fromCharCode(65 + c) + (r + 1); // column letter + row number
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
  console.log('\n  🚢  Battleship server running!\n');
  console.log('  On this computer:   http://localhost:' + PORT);
  for (const addr of lanAddresses()) {
    console.log('  On your LAN:         http://' + addr + ':' + PORT);
  }
  console.log('\n  Share a LAN address with the other admiral on your network.');
  console.log('  Press Ctrl+C to stop.\n');
});
