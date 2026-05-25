'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3600;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const WRITING_SECONDS = 90;
const VOTING_SECONDS = 45;
const RESULTS_SECONDS = 12;

const PROMPTS = [
  "You're at a quiet library and you accidentally knock over a single book…",
  "You're making small talk with your neighbor about the weather…",
  "You order a coffee and the barista spells your name slightly wrong…",
  "You're on a first date and you spill a small drop of water on the table…",
  "You're at a job interview and you mispronounce one word…",
  "You wave back at someone who wasn't waving at you…",
  "You accidentally text the wrong person something mildly embarrassing…",
  "You accidentally like a three-year-old photo while Instagram stalking…",
  "You're at a fancy restaurant and your card declines just once…",
  "You're playing a board game and get one rule slightly wrong…",
  "You arrive five minutes late to an important meeting…",
  "You accidentally send your boss a message meant for your friend…",
  "You slightly overcook the pasta at a dinner party…",
  "You yawn during a colleague's ten-minute presentation…",
  "You forget someone's name that you've met twice before…",
  "You're at the gym and trip slightly on the treadmill…",
  "You accidentally call your teacher 'Mom'…",
  "You honk your car horn a half-second too late…",
  "You sneeze loudly during a moment of silence…",
  "You say 'you too' when the waiter tells you to enjoy your meal…",
  "You use the wrong fork at a formal dinner…",
  "You accidentally wave back at a dog…",
  "You're first in line at the bank and suddenly forget your PIN…",
  "You mispronounce 'quinoa' at a trendy restaurant…",
  "You bring store-bought cookies to a bake sale and one person notices…",
  "You forget to mute yourself on a video call for about five seconds…",
  "You show up to a party one hour early by accident…",
  "You walk into a glass door in front of a crowd of people…",
  "You confidently wave hello to a stranger who looks exactly like your friend…",
  "You accidentally reply-all to a company email with something personal…",
];

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const game = {
  phase: 'lobby', // lobby | writing | voting | results | gameover
  players: [],    // { id, name, connected, score }
  hostId: null,
  totalRounds: 5,
  round: 0,
  currentPrompt: null,
  usedPromptIndices: [],
  responses: [],  // { playerId, text }
  votes: {},      // { voterId: responderId }
  roundResults: [],
  timerEnd: null,
  log: [],
};

let phaseTimer = null;
const clients = new Map();

function addLog(msg) {
  game.log.push({ t: Date.now(), message: msg });
  if (game.log.length > 60) game.log.shift();
}

function findPlayer(id) {
  return game.players.find((p) => p.id === id);
}

function connectedPlayers() {
  return game.players.filter((p) => p.connected);
}

// Per-player view: during voting, response authorship is hidden.
function stateFor(viewerId) {
  const s = {
    phase: game.phase,
    hostId: game.hostId,
    totalRounds: game.totalRounds,
    round: game.round,
    currentPrompt: game.currentPrompt,
    timerEnd: game.timerEnd,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      score: p.score,
    })),
    log: game.log.slice(-15),
  };

  if (game.phase === 'writing') {
    s.myResponseSubmitted = game.responses.some((r) => r.playerId === viewerId);
    s.submittedCount = game.responses.length;
    s.expectedCount = connectedPlayers().length;
  }

  if (game.phase === 'voting') {
    s.responses = game.responses.map((r, i) => ({
      idx: i,
      text: r.text,
      canVote: r.playerId !== viewerId,
    }));
    const myVotedId = game.votes[viewerId];
    s.myVoteIdx = myVotedId !== undefined
      ? game.responses.findIndex((r) => r.playerId === myVotedId)
      : null;
    s.votedCount = Object.keys(game.votes).length;
    s.expectedCount = connectedPlayers().length;
  }

  if (game.phase === 'results' || game.phase === 'gameover') {
    s.roundResults = game.roundResults;
  }

  return s;
}

function broadcast() {
  for (const [pid, res] of clients.entries()) {
    res.write(`data: ${JSON.stringify(stateFor(pid))}\n\n`);
  }
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------
function clearPhaseTimer() {
  if (phaseTimer) { clearTimeout(phaseTimer); phaseTimer = null; }
  game.timerEnd = null;
}

function pickPrompt() {
  const available = PROMPTS
    .map((_, i) => i)
    .filter((i) => !game.usedPromptIndices.includes(i));
  if (available.length === 0) {
    game.usedPromptIndices = [];
    return crypto.randomInt(0, PROMPTS.length);
  }
  return available[crypto.randomInt(0, available.length)];
}

function startWriting() {
  const idx = pickPrompt();
  game.usedPromptIndices.push(idx);
  game.currentPrompt = PROMPTS[idx];
  game.responses = [];
  game.votes = {};
  game.roundResults = [];
  game.phase = 'writing';
  game.timerEnd = Date.now() + WRITING_SECONDS * 1000;

  addLog(`Round ${game.round}: players are writing their escalations…`);
  broadcast();

  phaseTimer = setTimeout(() => {
    if (game.responses.length === 0) {
      addLog('Nobody submitted a response. Skipping round.');
      finishRound();
    } else {
      startVoting();
    }
  }, WRITING_SECONDS * 1000);
}

function startVoting() {
  clearPhaseTimer();

  if (game.responses.length < 2) {
    if (game.responses.length === 1) {
      const p = findPlayer(game.responses[0].playerId);
      if (p) { p.score += 3; addLog(`Only one response — ${p.name} gets a free win!`); }
    }
    finishRound();
    return;
  }

  game.phase = 'voting';
  game.timerEnd = Date.now() + VOTING_SECONDS * 1000;
  addLog('Voting is open — pick the best escalation!');
  broadcast();

  phaseTimer = setTimeout(() => {
    doRevealResults();
    broadcast();
    scheduleNextRound();
  }, VOTING_SECONDS * 1000);
}

function doRevealResults() {
  clearPhaseTimer();

  const tally = {};
  for (const r of game.responses) tally[r.playerId] = 0;
  for (const [, votedId] of Object.entries(game.votes)) {
    if (tally[votedId] !== undefined) tally[votedId]++;
  }

  const maxVotes = Math.max(...Object.values(tally), 0);
  const winnerIds = Object.entries(tally)
    .filter(([, v]) => v === maxVotes && maxVotes > 0)
    .map(([id]) => id);

  game.roundResults = game.responses.map((r, i) => {
    const votes = tally[r.playerId] || 0;
    const bonus = winnerIds.length === 1 && winnerIds[0] === r.playerId ? 2 : 0;
    const player = findPlayer(r.playerId);
    if (player) player.score += votes + bonus;
    return {
      idx: i,
      playerId: r.playerId,
      playerName: player?.name || '?',
      text: r.text,
      votes,
      bonus,
    };
  });

  game.phase = 'results';

  const summary = [...game.roundResults]
    .sort((a, b) => b.votes - a.votes)
    .map((r) => `${r.playerName} (${r.votes}v${r.bonus ? ' +🏆' : ''})`)
    .join(', ');
  addLog(`Round ${game.round}: ${summary}`);
}

function scheduleNextRound() {
  game.timerEnd = Date.now() + RESULTS_SECONDS * 1000;
  broadcast();
  phaseTimer = setTimeout(() => {
    finishRound();
    broadcast();
  }, RESULTS_SECONDS * 1000);
}

function finishRound() {
  clearPhaseTimer();
  if (game.round >= game.totalRounds) {
    endGame();
  } else {
    game.round += 1;
    startWriting();
  }
}

function endGame() {
  game.phase = 'gameover';
  const sorted = [...game.players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  addLog(`Game over! ${winner?.name ?? '?'} wins with ${winner?.score ?? 0} points!`);
  broadcast();
}

function resetToLobby() {
  clearPhaseTimer();
  game.phase = 'lobby';
  game.round = 0;
  game.currentPrompt = null;
  game.usedPromptIndices = [];
  game.responses = [];
  game.votes = {};
  game.roundResults = [];
  game.timerEnd = null;
  for (const p of game.players) p.score = 0;
  addLog('Returned to the lobby.');
}

function maybeAutoAdvance() {
  const conn = connectedPlayers();
  if (conn.length === 0) return;

  if (game.phase === 'writing') {
    if (game.responses.length >= conn.length) {
      clearPhaseTimer();
      startVoting();
    }
  } else if (game.phase === 'voting') {
    if (Object.keys(game.votes).length >= conn.length) {
      clearPhaseTimer();
      doRevealResults();
      broadcast();
      scheduleNextRound();
    }
  }
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
      if (game.phase !== 'lobby') return { status: 400, json: { error: 'A game is already in progress.' } };
      if (game.players.length >= 12) return { status: 400, json: { error: 'Room is full (12 players max).' } };
      const id = crypto.randomUUID();
      game.players.push({ id, name, connected: false, score: 0 });
      if (!game.hostId) game.hostId = id;
      addLog(`${name} joined.`);
      broadcast();
      return { status: 200, json: { playerId: id } };
    }

    case 'setRounds': {
      if (body.playerId !== game.hostId) return { status: 403, json: { error: 'Only the host can change settings.' } };
      if (game.phase !== 'lobby') return { status: 400, json: { error: 'Can only change in the lobby.' } };
      game.totalRounds = Math.max(1, Math.min(10, Number(body.value) || 5));
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'start': {
      if (body.playerId !== game.hostId) return { status: 403, json: { error: 'Only the host can start.' } };
      if (game.phase !== 'lobby') return { status: 400, json: { error: 'Game already started.' } };
      if (game.players.length < 2) return { status: 400, json: { error: 'Need at least 2 players.' } };
      game.round = 1;
      for (const p of game.players) p.score = 0;
      startWriting();
      return { status: 200, json: { ok: true } };
    }

    case 'submit': {
      if (game.phase !== 'writing') return { status: 400, json: { error: 'Not in writing phase.' } };
      const p = findPlayer(body.playerId);
      if (!p) return { status: 400, json: { error: 'Unknown player.' } };
      if (game.responses.some((r) => r.playerId === body.playerId)) {
        return { status: 400, json: { error: 'Already submitted.' } };
      }
      const text = String(body.text || '').trim().slice(0, 280);
      if (!text) return { status: 400, json: { error: 'Response cannot be empty.' } };
      game.responses.push({ playerId: body.playerId, text });
      addLog(`${p.name} submitted their escalation.`);
      maybeAutoAdvance();
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'vote': {
      if (game.phase !== 'voting') return { status: 400, json: { error: 'Not in voting phase.' } };
      const voter = findPlayer(body.playerId);
      if (!voter) return { status: 400, json: { error: 'Unknown player.' } };
      if (game.votes[body.playerId] !== undefined) return { status: 400, json: { error: 'Already voted.' } };
      const idx = Number(body.idx);
      if (!Number.isInteger(idx) || idx < 0 || idx >= game.responses.length) {
        return { status: 400, json: { error: 'Invalid response index.' } };
      }
      const response = game.responses[idx];
      if (response.playerId === body.playerId) {
        return { status: 400, json: { error: 'You cannot vote for your own response.' } };
      }
      game.votes[body.playerId] = response.playerId;
      addLog(`${voter.name} voted.`);
      maybeAutoAdvance();
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'nextRound': {
      if (body.playerId !== game.hostId) return { status: 403, json: { error: 'Only the host can advance.' } };
      if (game.phase !== 'results') return { status: 400, json: { error: 'Not in results phase.' } };
      clearPhaseTimer();
      finishRound();
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'toLobby': {
      if (body.playerId !== game.hostId) return { status: 403, json: { error: 'Only the host can reset.' } };
      resetToLobby();
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'leave': {
      const idx = game.players.findIndex((p) => p.id === body.playerId);
      if (idx !== -1) {
        const [removed] = game.players.splice(idx, 1);
        clients.delete(body.playerId);
        delete game.votes[body.playerId];
        const rIdx = game.responses.findIndex((r) => r.playerId === body.playerId);
        if (rIdx !== -1) game.responses.splice(rIdx, 1);
        addLog(`${removed.name} left.`);
        if (game.hostId === removed.id) game.hostId = game.players[0]?.id ?? null;
        if (game.players.length < 2 && game.phase !== 'lobby') {
          resetToLobby();
          addLog('Not enough players — back to the lobby.');
        } else {
          maybeAutoAdvance();
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
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
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
    maybeAutoAdvance();
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
      try { parsed = JSON.parse(body || '{}'); } catch {
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

  if (req.method === 'GET') { serveStatic(req, res); return; }
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
  console.log('\n  📈  That Escalated Quickly server running!\n');
  console.log('  On this computer:   http://localhost:' + PORT);
  for (const addr of lanAddresses()) {
    console.log('  On your LAN:         http://' + addr + ':' + PORT);
  }
  console.log('\n  Share a LAN address with players on the same network.');
  console.log('  Press Ctrl+C to stop.\n');
});
