'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3400;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const CHOICES = ['rock', 'paper', 'scissors'];
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };

// ---------------------------------------------------------------------------
// Game state (single shared room)
// ---------------------------------------------------------------------------
const game = {
  phase: 'lobby', // 'lobby' | 'picking' | 'reveal' | 'gameover'
  players: [], // { id, name, connected, score, choice, locked, gained }
  hostId: null,
  targetScore: 5,
  round: 0,
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

// ---------------------------------------------------------------------------
// Per-player view: during 'picking', a throw is secret — others only see that
// you've locked in. Everything is revealed at 'reveal'/'gameover'.
// ---------------------------------------------------------------------------
function stateFor(viewerId) {
  const revealed = game.phase === 'reveal' || game.phase === 'gameover';
  return {
    phase: game.phase,
    hostId: game.hostId,
    targetScore: game.targetScore,
    round: game.round,
    winnerId: game.winnerId,
    yourChoice: (() => {
      const v = findPlayer(viewerId);
      return v ? v.choice : null;
    })(),
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      score: p.score,
      locked: game.phase === 'picking' ? p.locked : undefined,
      choice: revealed ? p.choice : undefined,
      gained: revealed ? p.gained : undefined,
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
function clearChoices() {
  for (const p of game.players) {
    p.choice = null;
    p.locked = false;
    p.gained = 0;
  }
}

function startMatch() {
  if (game.players.length < 2) return { error: 'Need at least 2 players.' };
  for (const p of game.players) p.score = 0;
  game.winnerId = null;
  game.round = 1;
  clearChoices();
  game.phase = 'picking';
  addLog(`Match started — first to ${game.targetScore} points wins. Round 1!`);
  return {};
}

function connectedPlayers() {
  return game.players.filter((p) => p.connected);
}

// Reveal once every connected player has locked in (and at least two threw).
function maybeReveal() {
  if (game.phase !== 'picking') return;
  const conn = connectedPlayers();
  const locked = game.players.filter((p) => p.locked);
  if (locked.length >= 2 && conn.length > 0 && conn.every((p) => p.locked)) {
    doReveal();
  }
}

function doReveal() {
  const parts = game.players.filter((p) => p.choice);
  for (const p of parts) {
    p.gained = parts.filter((q) => q !== p && BEATS[p.choice] === q.choice).length;
    p.score += p.gained;
  }
  game.phase = 'reveal';

  const summary = parts
    .map((p) => `${p.name} ${EMOJI[p.choice]}${p.gained ? ' +' + p.gained : ''}`)
    .join(', ');
  addLog(`Round ${game.round}: ${summary}`);

  const max = Math.max(...game.players.map((p) => p.score));
  if (max >= game.targetScore) {
    const leaders = game.players.filter((p) => p.score === max);
    if (leaders.length === 1) {
      game.winnerId = leaders[0].id;
      game.phase = 'gameover';
      addLog(`${leaders[0].name} wins the match with ${leaders[0].score} points!`);
    } else {
      addLog(`Tie at the top with ${max} — play continues to break it.`);
    }
  }
}

function nextRound() {
  clearChoices();
  game.round += 1;
  game.phase = 'picking';
  addLog(`Round ${game.round}!`);
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
        return { status: 400, json: { error: 'A match is in progress.' } };
      }
      if (game.players.length >= 12) {
        return { status: 400, json: { error: 'Room is full (12 players max).' } };
      }
      const id = crypto.randomUUID();
      game.players.push({ id, name, connected: false, score: 0, choice: null, locked: false, gained: 0 });
      if (!game.hostId) game.hostId = id;
      addLog(`${name} joined.`);
      broadcast();
      return { status: 200, json: { playerId: id } };
    }

    case 'setTarget': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can change the target.' } };
      }
      if (game.phase !== 'lobby') {
        return { status: 400, json: { error: 'Can only change in the lobby.' } };
      }
      game.targetScore = Math.max(1, Math.min(20, Number(body.value) || 5));
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'start': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can start.' } };
      }
      const result = startMatch();
      if (result.error) return { status: 400, json: result };
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'pick': {
      const p = findPlayer(body.playerId);
      if (!p || game.phase !== 'picking') {
        return { status: 400, json: { error: 'You cannot pick right now.' } };
      }
      if (p.locked) return { status: 400, json: { error: 'You already locked in.' } };
      if (!CHOICES.includes(body.choice)) {
        return { status: 400, json: { error: 'Invalid choice.' } };
      }
      p.choice = body.choice;
      p.locked = true;
      addLog(`${p.name} locked in.`);
      maybeReveal();
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'nextRound': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can advance.' } };
      }
      if (game.phase !== 'reveal') {
        return { status: 400, json: { error: 'Not between rounds.' } };
      }
      nextRound();
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'toLobby': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can reset.' } };
      }
      game.phase = 'lobby';
      game.round = 0;
      game.winnerId = null;
      clearChoices();
      for (const p of game.players) p.score = 0;
      addLog('Returned to the lobby.');
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
        if (game.phase === 'picking') maybeReveal();
        if (game.players.length < 2 && game.phase !== 'lobby') {
          game.phase = 'lobby';
          game.round = 0;
          clearChoices();
          addLog('Not enough players — back to the lobby.');
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
    // A disconnect may complete the round if everyone still here has locked.
    maybeReveal();
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
  console.log('\n  ✊✋✌️  Rock Paper Scissors server running!\n');
  console.log('  On this computer:   http://localhost:' + PORT);
  for (const addr of lanAddresses()) {
    console.log('  On your LAN:         http://' + addr + ':' + PORT);
  }
  console.log('\n  Share a LAN address with players on the same network.');
  console.log('  Press Ctrl+C to stop.\n');
});
