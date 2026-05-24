'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const SUITS = [
  { key: 'S', symbol: '♠', name: 'Spades', color: 'black' },
  { key: 'H', symbol: '♥', name: 'Hearts', color: 'red' },
  { key: 'D', symbol: '♦', name: 'Diamonds', color: 'red' },
  { key: 'C', symbol: '♣', name: 'Clubs', color: 'black' },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Lookup tables for sorting a hand: suit first, then rank.
const SUIT_ORDER = Object.fromEntries(SUITS.map((s, i) => [s.key, i]));
const RANK_ORDER = Object.fromEntries(RANKS.map((r, i) => [r, i]));

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: rank + suit.key, // e.g. "AS", "10H"
        rank,
        suit: suit.key,
        symbol: suit.symbol,
        color: suit.color,
      });
    }
  }
  return deck;
}

// Fisher–Yates using a CSPRNG so shuffles are genuinely unbiased.
function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
}

// ---------------------------------------------------------------------------
// Game state (single shared table — one deck)
// ---------------------------------------------------------------------------
const game = {
  phase: 'lobby', // 'lobby' | 'playing'
  players: [], // { id, name, hand: [card], connected }
  hostId: null,
  deck: [], // draw pile; the TOP card is the last element
  discard: [], // table pile, face up; the TOP card is the last element
  log: [],
};

const clients = new Map(); // playerId -> SSE response

function addLog(message) {
  game.log.push({ t: Date.now(), message });
  if (game.log.length > 60) game.log.shift();
}

function findPlayer(id) {
  return game.players.find((p) => p.id === id);
}

// State personalised per viewer: you see your own hand's cards, but only the
// COUNT of everyone else's hand (as in a real card game).
function stateFor(viewerId) {
  return {
    phase: game.phase,
    hostId: game.hostId,
    deckCount: game.deck.length,
    discardTop: game.discard[game.discard.length - 1] || null,
    discardCount: game.discard.length,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      connected: p.connected,
      hand: p.id === viewerId ? p.hand : undefined,
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
// Card operations
// ---------------------------------------------------------------------------
function newRound() {
  game.deck = buildDeck();
  shuffle(game.deck);
  game.discard = [];
  for (const p of game.players) p.hand = [];
  addLog('A fresh 52-card deck was shuffled.');
}

function recallAll() {
  // Gather every card back into the deck and reshuffle.
  for (const p of game.players) {
    game.deck.push(...p.hand);
    p.hand = [];
  }
  game.deck.push(...game.discard);
  game.discard = [];
  shuffle(game.deck);
  addLog('All cards were collected and the deck was reshuffled.');
}

function dealToEach(count) {
  // Deal round-robin so a short deck is shared fairly.
  let dealt = 0;
  for (let n = 0; n < count; n++) {
    for (const p of game.players) {
      const card = game.deck.pop();
      if (!card) {
        addLog(`Deck ran out after dealing ${dealt} card(s).`);
        return dealt;
      }
      p.hand.push(card);
      dealt++;
    }
  }
  addLog(`Dealt ${count} card(s) to each player.`);
  return dealt;
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
      if (game.players.length >= 10) {
        return { status: 400, json: { error: 'Table is full (10 players max).' } };
      }
      const id = crypto.randomUUID();
      game.players.push({ id, name, hand: [], connected: false });
      if (!game.hostId) game.hostId = id;
      addLog(`${name} joined the table.`);
      broadcast();
      return { status: 200, json: { playerId: id } };
    }

    case 'start': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the dealer can start.' } };
      }
      game.phase = 'playing';
      newRound();
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'shuffle': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the dealer can shuffle.' } };
      }
      shuffle(game.deck);
      addLog('The deck (draw pile) was shuffled.');
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'deal': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the dealer can deal.' } };
      }
      const count = Math.max(1, Math.min(13, Number(body.count) || 1));
      dealToEach(count);
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'draw': {
      const p = findPlayer(body.playerId);
      if (!p) return { status: 400, json: { error: 'Unknown player.' } };
      const card = game.deck.pop();
      if (!card) return { status: 400, json: { error: 'The deck is empty.' } };
      p.hand.push(card);
      addLog(`${p.name} drew a card.`);
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'play': {
      const p = findPlayer(body.playerId);
      if (!p) return { status: 400, json: { error: 'Unknown player.' } };
      const idx = p.hand.findIndex((c) => c.id === body.cardId);
      if (idx === -1) return { status: 400, json: { error: 'You do not hold that card.' } };
      const [card] = p.hand.splice(idx, 1);
      game.discard.push(card);
      addLog(`${p.name} played ${card.rank}${card.symbol}.`);
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'sortHand': {
      const p = findPlayer(body.playerId);
      if (!p) return { status: 400, json: { error: 'Unknown player.' } };
      p.hand.sort((a, b) =>
        SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'drawDiscard': {
      // Pick the top card off the table back into your hand.
      const p = findPlayer(body.playerId);
      if (!p) return { status: 400, json: { error: 'Unknown player.' } };
      const card = game.discard.pop();
      if (!card) return { status: 400, json: { error: 'The table pile is empty.' } };
      p.hand.push(card);
      addLog(`${p.name} took ${card.rank}${card.symbol} from the table.`);
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'recall': {
      if (body.playerId !== game.hostId) {
        return { status: 403, json: { error: 'Only the dealer can reset.' } };
      }
      recallAll();
      broadcast();
      return { status: 200, json: { ok: true } };
    }

    case 'leave': {
      const idx = game.players.findIndex((p) => p.id === body.playerId);
      if (idx !== -1) {
        const [removed] = game.players.splice(idx, 1);
        // Return their cards to the deck so the deck stays complete.
        game.deck.push(...removed.hand);
        clients.delete(body.playerId);
        addLog(`${removed.name} left the table.`);
        if (game.hostId === removed.id) game.hostId = game.players[0]?.id ?? null;
        if (game.players.length === 0) {
          game.phase = 'lobby';
          game.deck = [];
          game.discard = [];
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
// HTTP server (static client + SSE + action endpoint)
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
  console.log('\n  🃏  Card table server running!\n');
  console.log('  On this computer:   http://localhost:' + PORT);
  for (const addr of lanAddresses()) {
    console.log('  On your LAN:         http://' + addr + ':' + PORT);
  }
  console.log('\n  Share a LAN address with players on the same network.');
  console.log('  Press Ctrl+C to stop.\n');
});
