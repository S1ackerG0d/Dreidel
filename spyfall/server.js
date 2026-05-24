'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const LOCATIONS = require('./locations');

const PORT = Number(process.env.PORT) || 3200;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const LOCATION_NAMES = LOCATIONS.map((l) => l.name).sort();

// ---------------------------------------------------------------------------
// Game state (single shared room)
// ---------------------------------------------------------------------------
const game = {
  phase: 'lobby', // 'lobby' | 'playing' | 'reveal'
  players: [], // { id, name, connected, score, isSpy, role, voted }
  hostId: null,
  location: null, // secret: the round's location (never sent to the spy)
  durationSec: 480,
  roundEndsAt: null, // epoch ms
  firstPlayerId: null,
  accusation: null, // { accuserId, accusedId, votes: Map<playerId, bool> }
  result: null, // reveal info
  log: [],
};

const clients = new Map(); // playerId -> SSE response
let roundTimer = null;

function addLog(message) {
  game.log.push({ t: Date.now(), message });
  if (game.log.length > 60) game.log.shift();
}

function findPlayer(id) {
  return game.players.find((p) => p.id === id);
}
function spy() {
  return game.players.find((p) => p.isSpy);
}
function nonSpies() {
  return game.players.filter((p) => !p.isSpy);
}

// ---------------------------------------------------------------------------
// Per-player view: only you ever learn your own secret card.
// ---------------------------------------------------------------------------
function stateFor(viewerId) {
  const viewer = findPlayer(viewerId);

  let yourCard = null;
  if (game.phase === 'playing' && viewer) {
    yourCard = viewer.isSpy
      ? { isSpy: true }
      : { isSpy: false, location: game.location, role: viewer.role };
  }

  let accusation = null;
  if (game.accusation) {
    const a = game.accusation;
    const accuser = findPlayer(a.accuserId);
    const accused = findPlayer(a.accusedId);
    const eligible = game.players.filter((p) => p.id !== a.accusedId);
    accusation = {
      accuserName: accuser ? accuser.name : '?',
      accusedId: a.accusedId,
      accusedName: accused ? accused.name : '?',
      votesIn: a.votes.size,
      votesNeeded: eligible.length,
      youCanVote:
        viewer && viewer.id !== a.accusedId && !a.votes.has(viewer.id),
    };
  }

  return {
    phase: game.phase,
    hostId: game.hostId,
    durationSec: game.durationSec,
    roundEndsAt: game.roundEndsAt,
    serverNow: Date.now(),
    firstPlayerName: game.firstPlayerId
      ? findPlayer(game.firstPlayerId)?.name ?? null
      : null,
    locations: LOCATION_NAMES,
    youAreSpy: !!(viewer && viewer.isSpy && game.phase === 'playing'),
    yourCard,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      score: p.score,
      isSpy: game.phase === 'reveal' ? p.isSpy : undefined,
    })),
    accusation,
    result: game.result,
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
function clearRoundTimer() {
  if (roundTimer) {
    clearTimeout(roundTimer);
    roundTimer = null;
  }
}

function startRound() {
  if (game.players.length < 3) {
    return { error: 'Need at least 3 players to start.' };
  }
  clearRoundTimer();

  const loc = LOCATIONS[crypto.randomInt(0, LOCATIONS.length)];
  game.location = loc.name;

  const spyIndex = crypto.randomInt(0, game.players.length);

  // Deal unique roles to the non-spies.
  const roles = [...loc.roles];
  for (let i = roles.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  let r = 0;
  game.players.forEach((p, idx) => {
    p.voted = false;
    if (idx === spyIndex) {
      p.isSpy = true;
      p.role = null;
    } else {
      p.isSpy = false;
      p.role = roles[r % roles.length];
      r++;
    }
  });

  game.firstPlayerId = game.players[crypto.randomInt(0, game.players.length)].id;
  game.accusation = null;
  game.result = null;
  game.phase = 'playing';
  game.roundEndsAt = Date.now() + game.durationSec * 1000;

  roundTimer = setTimeout(endByTimeout, game.durationSec * 1000);

  addLog(`A new round began. ${findPlayer(game.firstPlayerId).name} asks first.`);
  return {};
}

function finishRound(outcome, message) {
  clearRoundTimer();
  const s = spy();
  game.result = {
    outcome,
    message,
    location: game.location,
    spyId: s ? s.id : null,
    spyName: s ? s.name : null,
  };
  game.phase = 'reveal';
  game.accusation = null;
  game.roundEndsAt = null;
  addLog(message);
}

function endByTimeout() {
  const s = spy();
  if (s) s.score += 2;
  finishRound(
    'spy_escaped',
    `Time ran out — the spy (${s ? s.name : '?'}) escaped and scores 2 points. The location was ${game.location}.`
  );
  broadcast();
}

function resolveAccusation() {
  const a = game.accusation;
  const accused = findPlayer(a.accusedId);
  const accuser = findPlayer(a.accuserId);
  if (!accused) {
    game.accusation = null;
    return;
  }

  if (accused.isSpy) {
    // Spy caught: accuser +2, every other non-spy +1.
    for (const p of nonSpies()) p.score += p.id === a.accuserId ? 2 : 1;
    finishRound(
      'spy_caught',
      `${accused.name} was the spy! The group wins. ${accuser ? accuser.name + ' earns 2 points' : ''}. The location was ${game.location}.`
    );
  } else {
    // Unanimous but wrong — the spy wins big.
    const s = spy();
    if (s) s.score += 4;
    finishRound(
      'wrong_accusation',
      `${accused.name} was not the spy! The spy (${s ? s.name : '?'}) scores 4 points. The location was ${game.location}.`
    );
  }
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
        return { status: 400, json: { error: 'A round is in progress — wait for the lobby.' } };
      }
      if (game.players.length >= 8) {
        return { status: 400, json: { error: 'Room is full (8 players max).' } };
      }
      const id = crypto.randomUUID();
      game.players.push({ id, name, connected: false, score: 0, isSpy: false, role: null, voted: false });
      if (!game.hostId) game.hostId = id;
      addLog(`${name} joined.`);
      broadcast();
      return { status: 200, json: { playerId: id } };
    }

    case 'setDuration': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can change settings.' } };
      }
      if (game.phase === 'playing') {
        return { status: 400, json: { error: 'Cannot change mid-round.' } };
      }
      const mins = Math.max(1, Math.min(15, Number(body.minutes) || 8));
      game.durationSec = mins * 60;
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'start': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can start a round.' } };
      }
      const result = startRound();
      if (result.error) return { status: 400, json: result };
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'accuse': {
      if (game.phase !== 'playing') {
        return { status: 400, json: { error: 'No round in progress.' } };
      }
      if (game.accusation) {
        return { status: 400, json: { error: 'A vote is already underway.' } };
      }
      const accuser = findPlayer(body.playerId);
      const accused = findPlayer(body.targetId);
      if (!accuser || !accused) {
        return { status: 400, json: { error: 'Unknown player.' } };
      }
      if (accuser.id === accused.id) {
        return { status: 400, json: { error: 'You cannot accuse yourself.' } };
      }
      // The accuser implicitly votes yes.
      game.accusation = { accuserId: accuser.id, accusedId: accused.id, votes: new Map([[accuser.id, true]]) };
      addLog(`${accuser.name} accuses ${accused.name}! Everyone else must vote.`);

      // If the accuser was the only eligible voter, resolve immediately.
      const eligible = game.players.filter((p) => p.id !== accused.id);
      if (game.accusation.votes.size >= eligible.length) {
        const allYes = [...game.accusation.votes.values()].every(Boolean);
        if (allYes) resolveAccusation();
        else game.accusation = null;
      }
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'vote': {
      if (!game.accusation) {
        return { status: 400, json: { error: 'No vote in progress.' } };
      }
      const a = game.accusation;
      const voter = findPlayer(body.playerId);
      if (!voter || voter.id === a.accusedId) {
        return { status: 400, json: { error: 'You cannot vote on this accusation.' } };
      }
      if (a.votes.has(voter.id)) {
        return { status: 400, json: { error: 'You already voted.' } };
      }
      a.votes.set(voter.id, body.value === true);

      const eligible = game.players.filter((p) => p.id !== a.accusedId);
      if (a.votes.size >= eligible.length) {
        const allYes = [...a.votes.values()].every(Boolean);
        if (allYes) {
          resolveAccusation();
        } else {
          addLog('The vote was not unanimous — play continues.');
          game.accusation = null;
        }
      }
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'spyGuess': {
      if (game.phase !== 'playing') {
        return { status: 400, json: { error: 'No round in progress.' } };
      }
      const p = findPlayer(body.playerId);
      if (!p || !p.isSpy) {
        return { status: 403, json: { error: 'Only the spy can guess.' } };
      }
      const guess = String(body.location || '');
      if (guess === game.location) {
        p.score += 4;
        finishRound('spy_guessed', `The spy (${p.name}) correctly guessed ${game.location} and scores 4 points!`);
      } else {
        for (const np of nonSpies()) np.score += 1;
        finishRound('spy_wrong_guess', `The spy (${p.name}) guessed ${guess} — wrong! It was ${game.location}. The group each scores 1 point.`);
      }
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'endRound': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can end the round.' } };
      }
      if (game.phase !== 'playing') {
        return { status: 400, json: { error: 'No round in progress.' } };
      }
      const s = spy();
      if (s) s.score += 2;
      finishRound('spy_escaped', `The host ended the round — the spy (${s ? s.name : '?'}) escapes with 2 points. The location was ${game.location}.`);
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'toLobby': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can return to the lobby.' } };
      }
      clearRoundTimer();
      game.phase = 'lobby';
      game.result = null;
      game.accusation = null;
      game.location = null;
      game.roundEndsAt = null;
      for (const p of game.players) { p.isSpy = false; p.role = null; }
      addLog('Returned to the lobby.');
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'resetScores': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the host can reset scores.' } };
      }
      for (const p of game.players) p.score = 0;
      addLog('Scores were reset.');
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
        // Clear an accusation that involved the departing player.
        if (game.accusation && (game.accusation.accuserId === removed.id || game.accusation.accusedId === removed.id)) {
          game.accusation = null;
        }
        if (game.players.length < 3 && game.phase === 'playing') {
          clearRoundTimer();
          game.phase = 'lobby';
          game.location = null;
          game.roundEndsAt = null;
          addLog('Too few players — round cancelled.');
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
  console.log('\n  🕵️  Spyfall server running!\n');
  console.log('  On this computer:   http://localhost:' + PORT);
  for (const addr of lanAddresses()) {
    console.log('  On your LAN:         http://' + addr + ':' + PORT);
  }
  console.log('\n  Share a LAN address with players on the same network.');
  console.log('  Press Ctrl+C to stop.\n');
});
