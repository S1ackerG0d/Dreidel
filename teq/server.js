'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3600;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Question bank (drawn each round)
// ---------------------------------------------------------------------------
const QUESTIONS = [
  "You're skydiving. You pull the ripcord and something comes out of your backpack. What is it?",
  "You challenge a professional boxer to a fight. What's your strategy?",
  "You need to survive in the wilderness alone for a week. What's your shelter made of?",
  "You show up to a job interview. What do you bring with you?",
  "You enter a cooking competition. What is your signature dish?",
  "A bear is chasing you through a forest. What do you do?",
  "You need to cross a raging river with no bridge. How do you do it?",
  "You're hired as a celebrity's personal bodyguard. What are your qualifications?",
  "You accidentally start a fire at a dinner party. What do you do?",
  "You need to impress a blind date. What do you show up in?",
  "You discover a secret door inside your house. Where does it lead?",
  "You enter a hot dog eating contest. What's your training regimen?",
  "You're being chased by a swarm of bees. What do you do?",
  "You need to win an arm wrestling match against a gorilla. What's your technique?",
  "You build a pillow fort. What special features does it have?",
  "You're writing your own obituary. What does it say about you?",
  "You audition to play a superhero in a movie. What's your claimed superpower?",
  "You need to get through airport security with something unusual in your bag. How?",
  "You're late to your own wedding. What's your excuse?",
  "You need to babysit a lion cub for the day. What's your plan?",
  "You accidentally text your boss a message meant for your best friend. What did it say?",
  "You're stranded on a desert island with one item. What is it?",
  "You discover you can understand animals. What's the first thing you ask your pet?",
  "You enter a backyard barbecue competition. What's your secret weapon?",
  "Someone cuts you in line at the grocery store. What do you do?",
  "You need to send an urgent message but have no phone or internet. How?",
  "You challenge your neighbor to a lawn care competition. What do you do to your lawn?",
  "You need to break out of a locked room. What's your plan?",
  "You accidentally release a wild animal in a shopping mall. What do you do?",
  "You wake up in medieval times. How do you survive the first day?",
  "You need to cross a minefield. What guides you through?",
  "You have 24 hours to become internet famous. What do you do?",
  "You accidentally become the leader of a small village. What's your first decree?",
  "You get trapped in an escape room. What finally gets you out?",
  "You find a magic lamp. What's your first wish?",
  "You need to win a dance-off against a professional. What's your move?",
  "You become a self-help guru overnight. What's your book about?",
  "You need to defuse a bomb with 10 seconds left. What do you do?",
  "You stumble into a secret underground lair. What's inside?",
  "You need to survive a haunted house for one full hour. What do you bring?",
  "You invent a brand new sport. What are the rules?",
  "You challenge a robot to a quiz show. What's your chosen topic?",
  "You need to rob Fort Knox. What's your plan?",
  "You accidentally become the mayor of a city. What's your first act?",
  "You create a brand new holiday. What is it and how is it celebrated?",
  "You find out your neighbor is a secret agent. What do you do?",
  "You need to convince a dragon to move out of your house. What do you say?",
  "You accidentally win a marathon. How did it happen?",
  "You're trying to pick a lock with no tools. What do you use?",
  "You have to build a raft and cross the ocean. What's it made of?",
  "You discover your pet has been secretly running a business. What kind?",
  "You need to make a grand gesture to win someone back. What do you do?",
  "You challenge your reflection to a staring contest. Who wins and how?",
  "You need to stall 50 people for 20 minutes. What do you do?",
  "You accidentally walk into the wrong meeting at work. What do you say?",
  "You invent a new piece of gym equipment. What does it do?",
  "You wake up and discover you're now 3 inches tall. What's your morning routine?",
  "You discover a tunnel under your backyard. Where does it go?",
  "You have to convince a judge you're innocent of something ridiculous. What's your defense?",
  "You're hired to write a new national anthem. What's the theme?",
  "You need to escape from a deserted island with only what's on the beach. How?",
  "You open a restaurant. What's your most controversial menu item?",
  "You find $10,000 in a paper bag on the street. What do you do?",
  "You're given one hour to pack and leave the country forever. What do you grab?",
  "You accidentally become a viral meme. What's the meme?",
  "You challenge a toddler to an obstacle course race. What's your strategy?",
  "You need to impress an alien who just landed in your backyard. What do you show them first?",
  "You must survive a week in the arctic with one tool. What do you bring?",
  "You discover you can time travel but only 10 minutes into the past. What do you use it for?",
  "You are challenged to a duel at dawn. What weapon do you choose?",
  "You're hired to write the world's most boring book. What's it about?",
  "You need to smuggle something past a guard dog. What's your method?",
  "You accidentally start a cult. How did it begin?",
  "You're the last person on Earth and you find a phone with one battery bar. Who do you call?",
  "You need to win a staring contest against a statue. What's your strategy?",
  "You open a 24-hour bakery in the wilderness. What's your best seller?",
  "You have to negotiate a peace treaty between two warring squirrel factions. What's the deal?",
  "You discover your mailman has been reading all your mail for years. What do you do?",
  "You accidentally get elected to parliament. What's your first vote?",
  "You must write a one-star review for oxygen. What does it say?",
];

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const game = {
  phase: 'lobby',      // lobby | answering | ordering | roundover | gameover
  players: [],         // { id, name, connected, number, answer }
  hostId: null,
  organizerIndex: 0,
  answeredCount: 0,    // how many have answered so far this round
  question: null,
  usedQuestionIndices: [],
  goodCards: 0,
  badCards: 0,
  // Ordering phase
  orderedIds: [],      // player IDs in current active sequence (cleared on discard)
  allRevealedIds: [],  // every player ID that has been revealed (never re-picked)
  lastRevealedNum: null,
  mistakes: 0,
  allowedMistakes: 0,
  roundResult: null,   // 'good' | 'bad'
  log: [],
};

const clients = new Map();

function addLog(msg) {
  game.log.push({ t: Date.now(), message: msg });
  if (game.log.length > 60) game.log.shift();
}

function findPlayer(id) { return game.players.find((p) => p.id === id); }
function organizer() { return game.players[game.organizerIndex] ?? null; }

function allowedMistakesFor(n) {
  if (n === 3) return 1;
  if (n <= 5) return 0;
  return 1; // 6–10 players
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickQuestion() {
  const available = QUESTIONS.map((_, i) => i).filter((i) => !game.usedQuestionIndices.includes(i));
  if (available.length === 0) { game.usedQuestionIndices = []; }
  const pool = available.length > 0 ? available : QUESTIONS.map((_, i) => i);
  return pool[crypto.randomInt(0, pool.length)];
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------
function startRound() {
  // Deal unique numbers from 1–10 (subset for current player count)
  const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).slice(0, game.players.length);
  for (let i = 0; i < game.players.length; i++) {
    game.players[i].number = nums[i];
    game.players[i].answer = null;
  }

  const qi = pickQuestion();
  game.usedQuestionIndices.push(qi);
  game.question = QUESTIONS[qi];

  game.answeredCount = 0;
  game.orderedIds = [];
  game.allRevealedIds = [];
  game.lastRevealedNum = null;
  game.mistakes = 0;
  game.allowedMistakes = allowedMistakesFor(game.players.length);
  game.roundResult = null;
  game.phase = 'answering';

  const org = organizer();
  addLog(`Round started — ${org.name} is the Organizer. ${game.allowedMistakes} mistake(s) allowed.`);
}

function resetToLobby(reason) {
  game.phase = 'lobby';
  game.organizerIndex = 0;
  game.goodCards = 0;
  game.badCards = 0;
  game.question = null;
  game.usedQuestionIndices = [];
  game.orderedIds = [];
  game.allRevealedIds = [];
  game.lastRevealedNum = null;
  game.mistakes = 0;
  game.roundResult = null;
  for (const p of game.players) { p.number = null; p.answer = null; }
  if (reason) addLog(reason);
}

// ---------------------------------------------------------------------------
// Per-player state (numbers are kept secret until revealed by organizer)
// ---------------------------------------------------------------------------
function stateFor(viewerId) {
  const org = organizer();
  const s = {
    phase: game.phase,
    goodCards: game.goodCards,
    badCards: game.badCards,
    organizerId: org?.id ?? null,
    hostId: game.hostId,
    log: game.log.slice(-15),
    players: game.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
  };

  if (game.phase === 'answering') {
    const curIdx = (game.organizerIndex + game.answeredCount) % game.players.length;
    s.question = game.question;
    s.myNumber = game.players.find((p) => p.id === viewerId)?.number ?? null;
    s.currentAnswererId = game.players[curIdx]?.id ?? null;
    s.answeredCount = game.answeredCount;
    s.allowedMistakes = game.allowedMistakes;
    // Answers submitted so far, in turn order
    s.answers = [];
    for (let i = 0; i < game.answeredCount; i++) {
      const p = game.players[(game.organizerIndex + i) % game.players.length];
      s.answers.push({ playerId: p.id, playerName: p.name, answer: p.answer });
    }
  }

  if (game.phase === 'ordering') {
    s.question = game.question;
    s.orderedIds = game.orderedIds;
    s.allRevealedIds = game.allRevealedIds;
    s.mistakes = game.mistakes;
    s.allowedMistakes = game.allowedMistakes;
    // Numbers only visible once revealed by organizer
    s.players = game.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      answer: p.answer,
      number: game.allRevealedIds.includes(p.id) ? p.number : null,
    }));
  }

  if (game.phase === 'roundover' || game.phase === 'gameover') {
    s.question = game.question;
    s.orderedIds = game.orderedIds;
    s.allRevealedIds = game.allRevealedIds;
    s.roundResult = game.roundResult;
    s.mistakes = game.mistakes;
    s.allowedMistakes = game.allowedMistakes;
    // All numbers revealed
    s.players = game.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      answer: p.answer,
      number: p.number,
    }));
  }

  return s;
}

function broadcast() {
  for (const [pid, res] of clients.entries()) {
    res.write(`data: ${JSON.stringify(stateFor(pid))}\n\n`);
  }
}

// ---------------------------------------------------------------------------
// Action handling
// ---------------------------------------------------------------------------
function ok(json) { return { status: 200, json }; }
function err(status, error) { return { status, json: { error } }; }

function handleAction(body) {
  const { type } = body;

  switch (type) {
    case 'join': {
      const name = String(body.name || '').trim().slice(0, 20);
      if (!name) return err(400, 'Name is required.');
      if (game.phase !== 'lobby') return err(400, 'A game is already in progress.');
      if (game.players.length >= 10) return err(400, 'Room is full (10 players max).');
      const id = crypto.randomUUID();
      game.players.push({ id, name, connected: false, number: null, answer: null });
      if (!game.hostId) game.hostId = id;
      addLog(`${name} joined.`);
      broadcast();
      return ok({ playerId: id });
    }

    case 'start': {
      if (body.playerId !== game.hostId) return err(403, 'Only the host can start.');
      if (game.phase !== 'lobby') return err(400, 'Already in progress.');
      if (game.players.length < 3) return err(400, 'Need at least 3 players.');
      game.organizerIndex = 0;
      startRound();
      broadcast();
      return ok({});
    }

    case 'submitAnswer': {
      if (game.phase !== 'answering') return err(400, 'Not in answering phase.');
      const p = findPlayer(body.playerId);
      if (!p) return err(400, 'Unknown player.');
      const curIdx = (game.organizerIndex + game.answeredCount) % game.players.length;
      if (game.players[curIdx].id !== body.playerId) return err(400, 'Not your turn to answer.');
      const answer = String(body.answer || '').trim().slice(0, 200);
      if (!answer) return err(400, 'Answer cannot be empty.');
      p.answer = answer;
      game.answeredCount++;
      addLog(`${p.name} answered.`);
      if (game.answeredCount === game.players.length) {
        game.phase = 'ordering';
        addLog(`All answers in. ${organizer().name} is now ordering the cards.`);
      }
      broadcast();
      return ok({});
    }

    case 'revealNext': {
      if (game.phase !== 'ordering') return err(400, 'Not in ordering phase.');
      if (body.playerId !== organizer()?.id) return err(403, 'Only the Organizer can reveal cards.');
      const target = findPlayer(body.targetId);
      if (!target) return err(400, 'Unknown player.');
      if (game.allRevealedIds.includes(body.targetId)) return err(400, 'Already revealed.');

      game.orderedIds.push(body.targetId);
      game.allRevealedIds.push(body.targetId);
      const num = target.number;

      if (game.lastRevealedNum !== null && num < game.lastRevealedNum) {
        // Mistake
        game.mistakes++;
        addLog(`Mistake! ${target.name} has ${num}, but last revealed was ${game.lastRevealedNum}.`);

        if (game.mistakes > game.allowedMistakes) {
          game.roundResult = 'bad';
          game.badCards++;
          addLog(`Too many mistakes — Bad Card! (${game.badCards}/3)`);
          game.phase = game.badCards >= 3 ? 'gameover' : 'roundover';
        } else {
          // Allowed mistake: discard current sequence and continue
          game.orderedIds = [];
          game.lastRevealedNum = null;
          addLog(`Mistake allowed — discarding the current sequence. Continuing with remaining cards.`);
        }
      } else {
        game.lastRevealedNum = num;
      }

      // Check if all players have been placed
      if (game.phase === 'ordering' && game.allRevealedIds.length === game.players.length) {
        game.roundResult = 'good';
        game.goodCards++;
        addLog(`All cards revealed in order — Good Card! (${game.goodCards}/3)`);
        game.phase = game.goodCards >= 3 ? 'gameover' : 'roundover';
      }

      broadcast();
      return ok({});
    }

    case 'nextRound': {
      if (body.playerId !== game.hostId) return err(403, 'Only the host can advance.');
      if (game.phase !== 'roundover') return err(400, 'Not in roundover phase.');
      game.organizerIndex = (game.organizerIndex + 1) % game.players.length;
      startRound();
      broadcast();
      return ok({});
    }

    case 'newGame': {
      if (body.playerId !== game.hostId) return err(403, 'Only the host can reset.');
      if (game.phase !== 'gameover') return err(400, 'Not in gameover phase.');
      resetToLobby('Starting a new game.');
      broadcast();
      return ok({});
    }

    case 'leave': {
      const idx = game.players.findIndex((p) => p.id === body.playerId);
      if (idx !== -1) {
        const [removed] = game.players.splice(idx, 1);
        clients.delete(body.playerId);
        addLog(`${removed.name} left.`);
        if (game.hostId === removed.id) game.hostId = game.players[0]?.id ?? null;
        if (game.phase !== 'lobby') {
          resetToLobby('A player left mid-game — returning to the lobby.');
        }
        broadcast();
      }
      return ok({});
    }

    default:
      return err(400, 'Unknown action.');
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
  fs.readFile(filePath, (err2, data) => {
    if (err2) { res.writeHead(404).end('Not found'); return; }
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
