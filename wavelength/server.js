'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3900;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

// The wheel is a 180° semicircle. Scoring wedges are 9° wide, arranged
// 2-3-4-3-2 around the hidden target, like the physical wheel.
const WEDGE = 9;
function scoreFor(diff) {
  if (diff <= WEDGE / 2) return 4;
  if (diff <= WEDGE * 1.5) return 3;
  if (diff <= WEDGE * 2.5) return 2;
  return 0;
}
function randomTarget() {
  // Keep the whole 45° scoring band on the wheel: 22.5°..157.5°.
  return crypto.randomInt(225, 1576) / 10;
}

// ---------------------------------------------------------------------------
// Game state (single shared room)
// ---------------------------------------------------------------------------
const game = {
  phase: 'lobby', // 'lobby' | 'clue' | 'guessing' | 'reveal' | 'gameover'
  players: [], // { id, name, connected, score, guess, locked }
  hostId: null,
  cycles: 2, // how many times each player is the psychic
  round: 0,
  totalRounds: 0,
  psychicIndex: 0,
  target: null, // hidden dial position in degrees (0..180)
  spectrum: { left: '', right: '' },
  lastResult: null,
  winnerIds: [],
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
function psychic() {
  return game.players[game.psychicIndex] ?? null;
}

// ---------------------------------------------------------------------------
// Per-player view: the target is secret — only the psychic sees it before
// the reveal. Guesses are secret from each other until the reveal too.
// ---------------------------------------------------------------------------
function stateFor(viewerId) {
  const revealed = game.phase === 'reveal' || game.phase === 'gameover';
  const psy = psychic();
  const isPsychic = psy && psy.id === viewerId;
  const inRound = game.phase === 'clue' || game.phase === 'guessing';
  const viewer = findPlayer(viewerId);
  return {
    phase: game.phase,
    hostId: game.hostId,
    cycles: game.cycles,
    round: game.round,
    totalRounds: game.totalRounds,
    psychicId: inRound || revealed ? psy?.id ?? null : null,
    spectrum: game.spectrum,
    target: revealed || (isPsychic && inRound) ? game.target : null,
    yourGuess: viewer ? viewer.guess : null,
    lastResult: revealed ? game.lastResult : null,
    winnerIds: game.winnerIds,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      score: p.score,
      locked: game.phase === 'guessing' ? p.locked : undefined,
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
function clearGuesses() {
  for (const p of game.players) {
    p.guess = null;
    p.locked = false;
  }
}

function newRound() {
  game.target = randomTarget();
  game.spectrum = { left: '', right: '' };
  clearGuesses();
  game.phase = 'clue';
  const psy = psychic();
  addLog(`Round ${game.round}/${game.totalRounds} — ${psy.name} is the psychic.`);
}

function startGame() {
  if (game.players.length < 2) return { error: 'Need at least 2 players.' };
  for (const p of game.players) p.score = 0;
  game.winnerIds = [];
  game.lastResult = null;
  game.totalRounds = game.cycles * game.players.length;
  game.round = 1;
  game.psychicIndex = 0;
  addLog(`Game started — ${game.totalRounds} rounds, everyone is the psychic ${game.cycles}×.`);
  newRound();
  return {};
}

function guessers() {
  const psy = psychic();
  return game.players.filter((p) => p !== psy);
}

// Reveal once every connected guesser has locked in (and at least one did).
function maybeReveal() {
  if (game.phase !== 'guessing') return;
  const conn = guessers().filter((p) => p.connected);
  const locked = guessers().filter((p) => p.locked);
  if (locked.length >= 1 && conn.length > 0 && conn.every((p) => p.locked)) {
    doReveal();
  }
}

function doReveal() {
  const psy = psychic();
  const results = guessers().map((p) => {
    const points = p.guess == null ? 0 : scoreFor(Math.abs(p.guess - game.target));
    p.score += points;
    return { id: p.id, name: p.name, guess: p.guess, points };
  });
  // The psychic scores as well as their best-guided guesser — good clues pay.
  const psychicPoints = results.length ? Math.max(...results.map((r) => r.points)) : 0;
  psy.score += psychicPoints;

  game.lastResult = {
    target: game.target,
    spectrum: game.spectrum,
    psychicId: psy.id,
    psychicName: psy.name,
    psychicPoints,
    guesses: results,
  };
  game.phase = 'reveal';

  const summary = results
    .map((r) => `${r.name} ${r.guess == null ? 'no guess' : '+' + r.points}`)
    .join(', ');
  addLog(`Reveal! ${summary || 'No guesses.'} Psychic ${psy.name} +${psychicPoints}.`);
}

function finishGame() {
  game.phase = 'gameover';
  const max = Math.max(...game.players.map((p) => p.score));
  game.winnerIds = game.players.filter((p) => p.score === max).map((p) => p.id);
  const names = game.players
    .filter((p) => game.winnerIds.includes(p.id))
    .map((p) => p.name)
    .join(' & ');
  addLog(`Game over — ${names} win${game.winnerIds.length === 1 ? 's' : ''} with ${max} points!`);
}

function nextRound() {
  if (game.round >= game.totalRounds) {
    finishGame();
    return;
  }
  game.round += 1;
  game.psychicIndex = (game.psychicIndex + 1) % game.players.length;
  newRound();
}

function resetToLobby() {
  game.phase = 'lobby';
  game.round = 0;
  game.totalRounds = 0;
  game.psychicIndex = 0;
  game.target = null;
  game.spectrum = { left: '', right: '' };
  game.lastResult = null;
  game.winnerIds = [];
  clearGuesses();
  for (const p of game.players) p.score = 0;
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
        return { status: 400, json: { error: 'A game is in progress.' } };
      }
      if (game.players.length >= 12) {
        return { status: 400, json: { error: 'Room is full (12 players max).' } };
      }
      const id = crypto.randomUUID();
      game.players.push({ id, name, connected: false, score: 0, guess: null, locked: false });
      if (!game.hostId) game.hostId = id;
      addLog(`${name} joined.`);
      broadcast();
      return { status: 200, json: { playerId: id } };
    }

    case 'setCycles': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can change settings.' } };
      }
      if (game.phase !== 'lobby') {
        return { status: 400, json: { error: 'Can only change in the lobby.' } };
      }
      game.cycles = Math.max(1, Math.min(5, Number(body.value) || 2));
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'start': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can start.' } };
      }
      const result = startGame();
      if (result.error) return { status: 400, json: result };
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'setSpectrum': {
      const psy = psychic();
      if (!psy || body.playerId !== psy.id) {
        return { status: 403, json: { error: 'Only the psychic can set the spectrum.' } };
      }
      if (game.phase !== 'clue' && game.phase !== 'guessing') {
        return { status: 400, json: { error: 'Not during this phase.' } };
      }
      game.spectrum = {
        left: String(body.left || '').trim().slice(0, 30),
        right: String(body.right || '').trim().slice(0, 30),
      };
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'clueGiven': {
      const psy = psychic();
      if (!psy || body.playerId !== psy.id) {
        return { status: 403, json: { error: 'Only the psychic can open guessing.' } };
      }
      if (game.phase !== 'clue') {
        return { status: 400, json: { error: 'Not in the clue phase.' } };
      }
      game.phase = 'guessing';
      addLog(`${psy.name} gave their clue — dials up!`);
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'lockGuess': {
      const p = findPlayer(body.playerId);
      const psy = psychic();
      if (!p || game.phase !== 'guessing') {
        return { status: 400, json: { error: 'You cannot guess right now.' } };
      }
      if (psy && p.id === psy.id) {
        return { status: 400, json: { error: 'The psychic does not guess.' } };
      }
      if (p.locked) return { status: 400, json: { error: 'You already locked in.' } };
      const value = Number(body.value);
      if (!Number.isFinite(value) || value < 0 || value > 180) {
        return { status: 400, json: { error: 'Invalid dial position.' } };
      }
      p.guess = Math.round(value * 10) / 10;
      p.locked = true;
      addLog(`${p.name} locked in a guess.`);
      maybeReveal();
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'forceReveal': {
      const psy = psychic();
      const allowed = body.playerId === game.hostId || (psy && body.playerId === psy.id);
      if (!allowed) {
        return { status: 403, json: { error: 'Only the psychic or host can reveal.' } };
      }
      if (game.phase !== 'guessing') {
        return { status: 400, json: { error: 'Not in the guessing phase.' } };
      }
      doReveal();
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'nextRound': {
      const psy = psychic();
      const allowed = body.playerId === game.hostId || (psy && body.playerId === psy.id);
      if (!allowed) {
        return { status: 403, json: { error: 'Only the psychic or host can advance.' } };
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
      resetToLobby();
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'leave': {
      const idx = game.players.findIndex((p) => p.id === body.playerId);
      if (idx !== -1) {
        const wasPsychic = idx === game.psychicIndex;
        const [removed] = game.players.splice(idx, 1);
        clients.delete(body.playerId);
        addLog(`${removed.name} left.`);
        if (game.hostId === removed.id) game.hostId = game.players[0]?.id ?? null;
        if (idx < game.psychicIndex) game.psychicIndex -= 1;
        if (game.psychicIndex >= game.players.length) game.psychicIndex = 0;

        if (game.phase !== 'lobby' && game.phase !== 'gameover') {
          if (game.players.length < 2) {
            resetToLobby();
            addLog('Not enough players — back to the lobby.');
          } else if (wasPsychic && (game.phase === 'clue' || game.phase === 'guessing')) {
            addLog('The psychic left — restarting the round with a new psychic.');
            newRound();
          } else if (game.phase === 'guessing') {
            maybeReveal();
          }
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
  console.log('\n  🎯  Wavelength server running!\n');
  console.log('  On this computer:   http://localhost:' + PORT);
  for (const addr of lanAddresses()) {
    console.log('  On your LAN:         http://' + addr + ':' + PORT);
  }
  console.log('\n  Share a LAN address with players on the same network.');
  console.log('  Press Ctrl+C to stop.\n');
});
