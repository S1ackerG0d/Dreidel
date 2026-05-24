'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const { buildTopology, randomizeBoard, RESOURCES } = require('./board');

const PORT = Number(process.env.PORT) || 3500;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const TOPO = buildTopology();

const COLORS = [
  { color: '#d64545', name: 'Red' },
  { color: '#e08a1e', name: 'Orange' },
  { color: '#e9e9ef', name: 'White' },
  { color: '#3b6fd4', name: 'Blue' },
];

const COST = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  dev: { sheep: 1, wheat: 1, ore: 1 },
};

const WIN_VP = 10;

// ---------------------------------------------------------------------------
// Game state (single shared room — one table per host)
// ---------------------------------------------------------------------------
let game = freshGame();

function freshGame() {
  return {
    phase: 'lobby', // 'lobby' | 'setup' | 'play' | 'gameover'
    players: [],
    hostId: null,
    board: null,
    bank: null,
    devDeck: [],
    log: [],
    turnIndex: 0,
    turnId: 0, // increments every turn; used to lock dev cards bought this turn
    turnPhase: null, // roll | main | discard | moveRobber | steal
    resumePhase: 'main', // where to return after a robber sequence
    robberReason: null, // 'dice' | 'knight'
    dice: null,
    setup: null, // { order:[playerIdx...], idx, expect:'settlement'|'road', lastVertex }
    freeRoads: 0,
    playedDevThisTurn: false,
    pendingDiscards: {}, // playerId -> count still owed
    stealTargets: [], // playerIds the current player may rob
    winnerId: null,
  };
}

const clients = new Map(); // playerId -> SSE response

function addLog(message) {
  game.log.push({ t: Date.now(), message });
  if (game.log.length > 80) game.log.shift();
}

function findPlayer(id) {
  return game.players.find((p) => p.id === id);
}

function currentPlayer() {
  return game.players[game.turnIndex] || null;
}

// ---------------------------------------------------------------------------
// Helpers: resources & bank
// ---------------------------------------------------------------------------
function emptyHand() {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

function handTotal(p) {
  return RESOURCES.reduce((n, r) => n + p.resources[r], 0);
}

function canAfford(p, cost) {
  return Object.entries(cost).every(([r, n]) => p.resources[r] >= n);
}

function pay(p, cost) {
  for (const [r, n] of Object.entries(cost)) {
    p.resources[r] -= n;
    game.bank[r] += n;
  }
}

// ---------------------------------------------------------------------------
// Ports & trade rates
// ---------------------------------------------------------------------------
function ownedPortTypes(p) {
  const types = new Set();
  for (const vid of p.vertices) {
    const port = game.board.vertices[vid].port;
    if (port) types.add(port);
  }
  return types;
}

function tradeRates(p) {
  const types = ownedPortTypes(p);
  const generic = types.has('any');
  const rates = {};
  for (const r of RESOURCES) rates[r] = types.has(r) ? 2 : generic ? 3 : 4;
  return rates;
}

// ---------------------------------------------------------------------------
// Board adjacency queries
// ---------------------------------------------------------------------------
function vertexHasNeighbourBuilding(vid) {
  return TOPO.vertexById[vid].adj.some((nv) => game.board.vertices[nv].building);
}

function vertexTouchesPlayerRoad(vid, playerId) {
  return TOPO.vertexById[vid].edges.some((eid) => game.board.edges[eid].owner === playerId);
}

// ---------------------------------------------------------------------------
// Longest road (longest trail in a player's road graph, broken by an opponent's
// settlement/city sitting on a junction).
// ---------------------------------------------------------------------------
function longestRoadFor(playerId) {
  const owned = new Set();
  for (const eid in game.board.edges) {
    if (game.board.edges[eid].owner === playerId) owned.add(eid);
  }
  if (owned.size === 0) return 0;

  const otherEnd = (eid, vid) => {
    const v = TOPO.edgeById[eid].v;
    return v[0] === vid ? v[1] : v[0];
  };
  const canPassThrough = (vid) => {
    const b = game.board.vertices[vid];
    return !(b.owner && b.owner !== playerId);
  };

  let best = 0;
  const dfs = (atVertex, visited) => {
    let local = visited.size;
    if (canPassThrough(atVertex)) {
      for (const ne of TOPO.vertexById[atVertex].edges) {
        if (!owned.has(ne) || visited.has(ne)) continue;
        visited.add(ne);
        local = Math.max(local, dfs(otherEnd(ne, atVertex), visited));
        visited.delete(ne);
      }
    }
    return local;
  };

  for (const eid of owned) {
    const [a, b] = TOPO.edgeById[eid].v;
    best = Math.max(best, dfs(a, new Set([eid])), dfs(b, new Set([eid])));
  }
  return best;
}

function updateLongestRoad() {
  for (const p of game.players) p.longestRoad = longestRoadFor(p.id);
  let bestN = 4;
  let leaders = [];
  for (const p of game.players) {
    if (p.longestRoad < 5) continue;
    if (p.longestRoad > bestN) { bestN = p.longestRoad; leaders = [p.id]; }
    else if (p.longestRoad === bestN) leaders.push(p.id);
  }
  const holder = game.longestRoadHolder;
  if (leaders.length === 0) { game.longestRoadHolder = null; return; }
  if (holder && leaders.includes(holder)) return; // holder keeps it on a tie
  game.longestRoadHolder = leaders.length === 1 ? leaders[0] : null;
}

function updateLargestArmy() {
  let bestN = 2;
  let best = null;
  for (const p of game.players) {
    if (p.knightsPlayed > bestN) { bestN = p.knightsPlayed; best = p.id; }
  }
  if (best === null) { game.largestArmyHolder = null; return; }
  const holder = game.largestArmyHolder;
  if (holder) {
    const h = findPlayer(holder);
    if (h && h.knightsPlayed === bestN) return; // holder keeps it on a tie
  }
  game.largestArmyHolder = best;
}

// ---------------------------------------------------------------------------
// Victory points
// ---------------------------------------------------------------------------
function buildingVP(p) {
  if (!p.vertices) return 0;
  let v = 0;
  for (const vid of p.vertices) v += game.board.vertices[vid].building === 'city' ? 2 : 1;
  return v;
}

function publicVP(p) {
  let v = buildingVP(p);
  if (game.longestRoadHolder === p.id) v += 2;
  if (game.largestArmyHolder === p.id) v += 2;
  return v;
}

function totalVP(p) {
  const vpCards = p.dev ? p.dev.filter((d) => d.type === 'vp').length : 0;
  return publicVP(p) + vpCards;
}

function maybeWin(p) {
  if (game.phase === 'play' && totalVP(p) >= WIN_VP) {
    game.phase = 'gameover';
    game.winnerId = p.id;
    addLog(`🏆 ${p.name} wins with ${totalVP(p)} victory points!`);
  }
}

// ---------------------------------------------------------------------------
// Dev card deck
// ---------------------------------------------------------------------------
function buildDevDeck() {
  const deck = [];
  for (let i = 0; i < 14; i++) deck.push('knight');
  for (let i = 0; i < 5; i++) deck.push('vp');
  for (let i = 0; i < 2; i++) deck.push('road');
  for (let i = 0; i < 2; i++) deck.push('plenty');
  for (let i = 0; i < 2; i++) deck.push('monopoly');
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const DEV_NAMES = {
  knight: 'Knight', vp: 'Victory Point', road: 'Road Building',
  plenty: 'Year of Plenty', monopoly: 'Monopoly',
};

// ---------------------------------------------------------------------------
// Setup phase
// ---------------------------------------------------------------------------
function startGame() {
  if (game.players.length < 2) return { error: 'Need at least 2 players to start.' };

  game.board = randomizeBoard(TOPO);
  game.bank = { wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 19 };
  game.devDeck = buildDevDeck();
  game.phase = 'setup';
  game.longestRoadHolder = null;
  game.largestArmyHolder = null;
  game.winnerId = null;
  game.log = [];

  game.players.forEach((p, i) => {
    p.resources = emptyHand();
    p.dev = [];
    p.knightsPlayed = 0;
    p.settlementsLeft = 5;
    p.citiesLeft = 4;
    p.roadsLeft = 15;
    p.vertices = [];
    p.longestRoad = 0;
  });

  // Snake draft: forward through the seating order, then back again.
  const n = game.players.length;
  const order = [];
  for (let i = 0; i < n; i++) order.push(i);
  for (let i = n - 1; i >= 0; i--) order.push(i);
  game.setup = { order, idx: 0, expect: 'settlement', lastVertex: null, round: 1 };
  game.turnIndex = order[0];
  addLog('Setup begins — place your first settlement and road.');
  return {};
}

function setupAdvance() {
  const s = game.setup;
  s.idx += 1;
  if (s.idx >= s.order.length) {
    // Setup complete — into the main game.
    game.setup = null;
    game.phase = 'play';
    game.turnIndex = 0;
    game.turnId = 1;
    game.turnPhase = 'roll';
    game.dice = null;
    game.playedDevThisTurn = false;
    addLog(`Setup complete. ${currentPlayer().name} to roll.`);
    return;
  }
  s.round = s.idx >= s.order.length / 2 ? 2 : 1;
  s.expect = 'settlement';
  s.lastVertex = null;
  game.turnIndex = s.order[s.idx];
}

// ---------------------------------------------------------------------------
// Dice & production
// ---------------------------------------------------------------------------
function produce(sum) {
  const gains = {}; // playerId -> { resource: count }
  for (const hex of TOPO.hexes) {
    const h = game.board.hexes[hex.id];
    if (h.number !== sum || game.board.robber === hex.id) continue;
    for (const vid of hex.corners) {
      const vb = game.board.vertices[vid];
      if (!vb.owner) continue;
      const amt = vb.building === 'city' ? 2 : 1;
      gains[vb.owner] = gains[vb.owner] || emptyHand();
      gains[vb.owner][h.resource] += amt;
    }
  }

  const summary = [];
  for (const res of RESOURCES) {
    const owed = [];
    let total = 0;
    for (const pid in gains) {
      if (gains[pid][res] > 0) { owed.push(pid); total += gains[pid][res]; }
    }
    if (total === 0) continue;
    if (total <= game.bank[res]) {
      for (const pid of owed) {
        findPlayer(pid).resources[res] += gains[pid][res];
        game.bank[res] -= gains[pid][res];
      }
    } else if (owed.length === 1) {
      const give = Math.min(gains[owed[0]][res], game.bank[res]);
      findPlayer(owed[0]).resources[res] += give;
      game.bank[res] -= give;
    }
    // else: bank can't satisfy multiple claimants — nobody gets this resource.
  }

  for (const pid in gains) {
    const parts = RESOURCES.filter((r) => gains[pid][r] > 0).map((r) => `${gains[pid][r]} ${r}`);
    if (parts.length) summary.push(`${findPlayer(pid).name}: ${parts.join(', ')}`);
  }
  if (summary.length) addLog('Produced — ' + summary.join(' · '));
  else addLog('No resources produced.');
}

function beginRobberSequence(reason) {
  game.robberReason = reason;
  const needers = game.players.filter((p) => handTotal(p) > 7);
  if (needers.length) {
    game.pendingDiscards = {};
    for (const p of needers) game.pendingDiscards[p.id] = Math.floor(handTotal(p) / 2);
    game.turnPhase = 'discard';
    addLog('A 7 was rolled — players holding more than 7 cards must discard half.');
  } else {
    game.turnPhase = 'moveRobber';
  }
}

function rollDice(playerId) {
  if (game.turnPhase !== 'roll') return { error: 'You cannot roll right now.' };
  if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
  const d1 = crypto.randomInt(1, 7);
  const d2 = crypto.randomInt(1, 7);
  game.dice = [d1, d2];
  const sum = d1 + d2;
  addLog(`${currentPlayer().name} rolled ${d1} + ${d2} = ${sum}.`);
  if (sum === 7) {
    game.resumePhase = 'main';
    beginRobberSequence('dice');
  } else {
    produce(sum);
    game.turnPhase = 'main';
  }
  return {};
}

// ---------------------------------------------------------------------------
// Robber: discard, move, steal
// ---------------------------------------------------------------------------
function doDiscard(playerId, discard) {
  if (game.turnPhase !== 'discard') return { error: 'No discards are required.' };
  const need = game.pendingDiscards[playerId];
  if (!need) return { error: 'You do not need to discard.' };
  const d = emptyHand();
  let total = 0;
  for (const r of RESOURCES) {
    const n = Math.max(0, Math.floor(Number(discard?.[r]) || 0));
    d[r] = n;
    total += n;
  }
  if (total !== need) return { error: `You must discard exactly ${need} cards.` };
  const p = findPlayer(playerId);
  for (const r of RESOURCES) if (d[r] > p.resources[r]) return { error: 'You do not have those cards.' };
  for (const r of RESOURCES) { p.resources[r] -= d[r]; game.bank[r] += d[r]; }
  delete game.pendingDiscards[playerId];
  addLog(`${p.name} discarded ${need} cards.`);
  if (Object.keys(game.pendingDiscards).length === 0) game.turnPhase = 'moveRobber';
  return {};
}

function moveRobber(playerId, hexId) {
  if (game.turnPhase !== 'moveRobber') return { error: 'You cannot move the robber now.' };
  if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
  if (!game.board.hexes[hexId]) return { error: 'Unknown hex.' };
  if (hexId === game.board.robber) return { error: 'The robber must move to a new hex.' };

  game.board.hexes[game.board.robber].robber = false;
  game.board.robber = hexId;
  game.board.hexes[hexId].robber = true;
  addLog(`${currentPlayer().name} moved the robber.`);

  const victims = new Set();
  for (const vid of TOPO.hexById[hexId].corners) {
    const vb = game.board.vertices[vid];
    if (vb.owner && vb.owner !== playerId && handTotal(findPlayer(vb.owner)) > 0) victims.add(vb.owner);
  }
  game.stealTargets = [...victims];
  if (game.stealTargets.length === 0) {
    game.turnPhase = game.resumePhase;
    game.stealTargets = [];
  } else {
    game.turnPhase = 'steal';
  }
  return {};
}

function doSteal(playerId, targetId) {
  if (game.turnPhase !== 'steal') return { error: 'There is nobody to rob.' };
  if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
  if (!game.stealTargets.includes(targetId)) return { error: 'You cannot rob that player.' };
  const target = findPlayer(targetId);
  const pool = [];
  for (const r of RESOURCES) for (let i = 0; i < target.resources[r]; i++) pool.push(r);
  if (pool.length === 0) return { error: 'That player has no cards.' };
  const res = pool[crypto.randomInt(0, pool.length)];
  target.resources[res] -= 1;
  findPlayer(playerId).resources[res] += 1;
  addLog(`${currentPlayer().name} stole a card from ${target.name}.`);
  game.stealTargets = [];
  game.turnPhase = game.resumePhase;
  return {};
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------
function legalRoad(eid, playerId) {
  if (game.board.edges[eid].owner) return false;
  const [a, b] = TOPO.edgeById[eid].v;
  return [a, b].some((v) => {
    const vb = game.board.vertices[v];
    if (vb.owner === playerId) return true; // own settlement/city
    if (vb.owner && vb.owner !== playerId) return false; // opponent blocks pass-through
    return vertexTouchesPlayerRoad(v, playerId);
  });
}

function buildRoad(playerId, eid) {
  const p = findPlayer(playerId);
  if (!TOPO.edgeById[eid]) return { error: 'Unknown edge.' };
  const free = game.freeRoads > 0;

  if (game.phase === 'setup') {
    if (game.setup.expect !== 'road') return { error: 'Place a settlement first.' };
    if (game.board.edges[eid].owner) return { error: 'That edge is taken.' };
    if (!TOPO.vertexById[game.setup.lastVertex].edges.includes(eid)) {
      return { error: 'Your road must connect to the settlement you just placed.' };
    }
  } else {
    if (game.turnPhase !== 'main') return { error: 'You can only build on your turn.' };
    if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
    if (p.roadsLeft <= 0) return { error: 'No roads left to place.' };
    if (!legalRoad(eid, playerId)) return { error: 'You cannot build a road there.' };
    if (!free && !canAfford(p, COST.road)) return { error: 'Not enough resources (need 1 wood, 1 brick).' };
  }

  if (!free && game.phase !== 'setup') pay(p, COST.road);
  game.board.edges[eid].owner = playerId;
  p.roadsLeft -= 1;
  if (free) game.freeRoads -= 1;

  if (game.phase === 'setup') {
    addLog(`${p.name} placed a road.`);
    setupAdvance();
  } else {
    addLog(`${p.name} built a road.`);
    updateLongestRoad();
    maybeWin(p);
  }
  return {};
}

function buildSettlement(playerId, vid) {
  const p = findPlayer(playerId);
  if (!TOPO.vertexById[vid]) return { error: 'Unknown spot.' };
  const vb = game.board.vertices[vid];

  if (game.phase === 'setup') {
    if (game.setup.expect !== 'settlement') return { error: 'Place your road first.' };
    if (vb.owner) return { error: 'That spot is taken.' };
    if (vertexHasNeighbourBuilding(vid)) return { error: 'Too close to another settlement.' };
  } else {
    if (game.turnPhase !== 'main') return { error: 'You can only build on your turn.' };
    if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
    if (p.settlementsLeft <= 0) return { error: 'No settlements left to place.' };
    if (vb.owner) return { error: 'That spot is taken.' };
    if (vertexHasNeighbourBuilding(vid)) return { error: 'Too close to another settlement.' };
    if (!vertexTouchesPlayerRoad(vid, playerId)) return { error: 'A settlement must connect to one of your roads.' };
    if (!canAfford(p, COST.settlement)) return { error: 'Not enough resources for a settlement.' };
  }

  if (game.phase !== 'setup') pay(p, COST.settlement);
  vb.owner = playerId;
  vb.building = 'settlement';
  p.settlementsLeft -= 1;
  p.vertices.push(vid);

  if (game.phase === 'setup') {
    addLog(`${p.name} placed a settlement.`);
    // The second settlement yields one resource from each adjacent terrain.
    if (game.setup.round === 2) {
      const got = [];
      for (const hid of TOPO.vertexById[vid].hexes) {
        const h = game.board.hexes[hid];
        if (h.resource !== 'desert' && game.bank[h.resource] > 0) {
          p.resources[h.resource] += 1;
          game.bank[h.resource] -= 1;
          got.push(h.resource);
        }
      }
      if (got.length) addLog(`${p.name} collected ${got.join(', ')}.`);
    }
    game.setup.expect = 'road';
    game.setup.lastVertex = vid;
  } else {
    addLog(`${p.name} built a settlement.`);
    updateLongestRoad(); // a new settlement can cut an opponent's road
    maybeWin(p);
  }
  return {};
}

function buildCity(playerId, vid) {
  if (game.turnPhase !== 'main') return { error: 'You can only build on your turn.' };
  const p = findPlayer(playerId);
  if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
  if (!TOPO.vertexById[vid]) return { error: 'Unknown spot.' };
  const vb = game.board.vertices[vid];
  if (vb.owner !== playerId || vb.building !== 'settlement') {
    return { error: 'You can only upgrade your own settlement.' };
  }
  if (p.citiesLeft <= 0) return { error: 'No cities left to place.' };
  if (!canAfford(p, COST.city)) return { error: 'Not enough resources (need 2 wheat, 3 ore).' };
  pay(p, COST.city);
  vb.building = 'city';
  p.citiesLeft -= 1;
  p.settlementsLeft += 1; // the settlement piece comes back
  addLog(`${p.name} upgraded a settlement to a city.`);
  maybeWin(p);
  return {};
}

// ---------------------------------------------------------------------------
// Dev cards
// ---------------------------------------------------------------------------
function buyDev(playerId) {
  if (game.turnPhase !== 'main') return { error: 'You can only buy on your turn.' };
  const p = findPlayer(playerId);
  if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
  if (game.devDeck.length === 0) return { error: 'The development deck is empty.' };
  if (!canAfford(p, COST.dev)) return { error: 'Not enough resources (need 1 sheep, 1 wheat, 1 ore).' };
  pay(p, COST.dev);
  const type = game.devDeck.pop();
  p.dev.push({ type, boughtTurn: game.turnId });
  addLog(`${p.name} bought a development card.`);
  if (type === 'vp') maybeWin(p);
  return {};
}

function playDev(playerId, body) {
  const p = findPlayer(playerId);
  if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
  if (game.playedDevThisTurn) return { error: 'You already played a development card this turn.' };
  const type = body.cardType;
  if (type === 'knight') {
    if (game.turnPhase !== 'roll' && game.turnPhase !== 'main') return { error: 'You cannot play that now.' };
  } else if (game.turnPhase !== 'main') {
    return { error: 'You can only play that during your build phase.' };
  }
  const card = p.dev.find((d) => d.type === type && d.boughtTurn !== game.turnId);
  if (!card) return { error: 'You do not have a playable card of that type.' };
  if (type === 'vp') return { error: 'Victory point cards are scored automatically.' };

  switch (type) {
    case 'knight': {
      p.knightsPlayed += 1;
      addLog(`${p.name} played a Knight.`);
      updateLargestArmy();
      game.resumePhase = game.turnPhase;
      removeCard(p, card);
      game.playedDevThisTurn = true;
      beginRobberSequence('knight');
      maybeWin(p);
      return {};
    }
    case 'road': {
      game.freeRoads = Math.min(2, p.roadsLeft);
      addLog(`${p.name} played Road Building.`);
      break;
    }
    case 'plenty': {
      const picks = [body.r1, body.r2].filter((r) => RESOURCES.includes(r));
      if (picks.length !== 2) return { error: 'Choose two resources.' };
      const taken = [];
      for (const r of picks) {
        if (game.bank[r] > 0) { p.resources[r] += 1; game.bank[r] -= 1; taken.push(r); }
      }
      addLog(`${p.name} played Year of Plenty${taken.length ? ` and took ${taken.join(', ')}` : ''}.`);
      break;
    }
    case 'monopoly': {
      const r = body.resource;
      if (!RESOURCES.includes(r)) return { error: 'Choose a resource to monopolise.' };
      let total = 0;
      for (const other of game.players) {
        if (other.id === playerId) continue;
        total += other.resources[r];
        other.resources[r] = 0;
      }
      p.resources[r] += total;
      addLog(`${p.name} played Monopoly on ${r} and collected ${total} cards.`);
      break;
    }
    default:
      return { error: 'Unknown card.' };
  }

  removeCard(p, card);
  game.playedDevThisTurn = true;
  return {};
}

function removeCard(p, card) {
  const i = p.dev.indexOf(card);
  if (i !== -1) p.dev.splice(i, 1);
}

// ---------------------------------------------------------------------------
// Trading with the bank / harbours
// ---------------------------------------------------------------------------
function bankTrade(playerId, give, receive) {
  if (game.turnPhase !== 'main') return { error: 'You can only trade on your turn.' };
  const p = findPlayer(playerId);
  if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
  if (!RESOURCES.includes(give) || !RESOURCES.includes(receive)) return { error: 'Invalid trade.' };
  if (give === receive) return { error: 'Choose two different resources.' };
  const rate = tradeRates(p)[give];
  if (p.resources[give] < rate) return { error: `You need ${rate} ${give} to trade.` };
  if (game.bank[receive] < 1) return { error: `The bank is out of ${receive}.` };
  p.resources[give] -= rate;
  game.bank[give] += rate;
  p.resources[receive] += 1;
  game.bank[receive] -= 1;
  addLog(`${p.name} traded ${rate} ${give} for 1 ${receive}.`);
  return {};
}

// ---------------------------------------------------------------------------
// End of turn
// ---------------------------------------------------------------------------
function endTurn(playerId) {
  if (game.turnPhase !== 'main') return { error: 'You cannot end your turn right now.' };
  if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
  if (game.freeRoads > 0) game.freeRoads = 0;
  game.turnIndex = (game.turnIndex + 1) % game.players.length;
  game.turnId += 1;
  game.turnPhase = 'roll';
  game.dice = null;
  game.playedDevThisTurn = false;
  addLog(`${currentPlayer().name}'s turn.`);
  return {};
}

// ---------------------------------------------------------------------------
// Legal-move hints for the current player (drives the client's highlights)
// ---------------------------------------------------------------------------
function legalFor(playerId) {
  const legal = { settlements: [], cities: [], roads: [], robberHexes: [], steal: [] };
  const p = findPlayer(playerId);
  if (!p) return legal;
  const yourTurn = currentPlayer() && currentPlayer().id === playerId;

  if (game.phase === 'setup' && yourTurn) {
    if (game.setup.expect === 'settlement') {
      for (const v of TOPO.vertices) {
        if (!game.board.vertices[v.id].owner && !vertexHasNeighbourBuilding(v.id)) legal.settlements.push(v.id);
      }
    } else {
      for (const eid of TOPO.vertexById[game.setup.lastVertex].edges) {
        if (!game.board.edges[eid].owner) legal.roads.push(eid);
      }
    }
    return legal;
  }

  if (game.phase !== 'play' || !yourTurn) return legal;

  if (game.turnPhase === 'moveRobber') {
    for (const h of TOPO.hexes) if (h.id !== game.board.robber) legal.robberHexes.push(h.id);
  }
  if (game.turnPhase === 'steal') legal.steal = game.stealTargets.slice();

  if (game.turnPhase === 'main') {
    const canRoad = game.freeRoads > 0 || canAfford(p, COST.road);
    if (canRoad && p.roadsLeft > 0) {
      for (const e of TOPO.edges) if (legalRoad(e.id, playerId)) legal.roads.push(e.id);
    }
    if (canAfford(p, COST.settlement) && p.settlementsLeft > 0) {
      for (const v of TOPO.vertices) {
        const vb = game.board.vertices[v.id];
        if (!vb.owner && !vertexHasNeighbourBuilding(v.id) && vertexTouchesPlayerRoad(v.id, playerId)) {
          legal.settlements.push(v.id);
        }
      }
    }
    if (canAfford(p, COST.city) && p.citiesLeft > 0) {
      for (const vid of p.vertices) if (game.board.vertices[vid].building === 'settlement') legal.cities.push(vid);
    }
  }
  return legal;
}

// ---------------------------------------------------------------------------
// State serialisation (personalised — your hand is private)
// ---------------------------------------------------------------------------
function publicBoard() {
  return {
    size: TOPO.size,
    viewBox: TOPO.viewBox,
    robber: game.board.robber,
    hexes: TOPO.hexes.map((h) => ({
      id: h.id, cx: h.cx, cy: h.cy, corners: h.corners,
      resource: game.board.hexes[h.id].resource,
      number: game.board.hexes[h.id].number,
      robber: game.board.robber === h.id,
    })),
    vertices: TOPO.vertices.map((v) => ({
      id: v.id, x: v.x, y: v.y,
      building: game.board.vertices[v.id].building,
      owner: game.board.vertices[v.id].owner,
      port: game.board.vertices[v.id].port || null,
    })),
    edges: TOPO.edges.map((e) => ({
      id: e.id, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2,
      owner: game.board.edges[e.id].owner,
    })),
    ports: game.board.ports,
  };
}

function colorOf(id) {
  const p = findPlayer(id);
  return p ? p.color : null;
}

function stateFor(playerId) {
  const base = {
    phase: game.phase,
    hostId: game.hostId,
    winnerId: game.winnerId,
    log: game.log.slice(-18),
    players: game.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, colorName: p.colorName,
      connected: p.connected,
      vp: game.phase === 'gameover' ? totalVP(p) : publicVP(p),
      resourceCount: p.resources ? handTotal(p) : 0,
      devCount: p.dev ? p.dev.length : 0,
      knightsPlayed: p.knightsPlayed || 0,
      longestRoad: p.longestRoad || 0,
      settlementsLeft: p.settlementsLeft,
      citiesLeft: p.citiesLeft,
      roadsLeft: p.roadsLeft,
      hasLongestRoad: game.longestRoadHolder === p.id,
      hasLargestArmy: game.largestArmyHolder === p.id,
    })),
  };

  if (game.phase === 'lobby') return base;

  const me = findPlayer(playerId);
  base.board = publicBoard();
  base.dice = game.dice;
  base.turnPhase = game.turnPhase;
  base.currentPlayerId = currentPlayer() ? currentPlayer().id : null;
  base.bank = game.bank;
  base.freeRoads = game.freeRoads;
  base.longestRoadHolder = game.longestRoadHolder || null;
  base.largestArmyHolder = game.largestArmyHolder || null;

  if (game.phase === 'setup') {
    base.setup = { expect: game.setup.expect, round: game.setup.round };
  }
  if (game.turnPhase === 'discard') {
    base.discardNeeded = game.pendingDiscards[playerId] || 0;
    base.waitingDiscards = Object.keys(game.pendingDiscards).map((id) => findPlayer(id).name);
  }
  if (game.turnPhase === 'steal') {
    base.stealTargets = game.stealTargets.map((id) => ({ id, name: findPlayer(id).name, color: colorOf(id) }));
  }

  if (me) {
    base.you = {
      id: me.id,
      resources: me.resources,
      tradeRates: tradeRates(me),
      ports: [...ownedPortTypes(me)],
      vp: totalVP(me),
      dev: me.dev.map((d) => ({
        type: d.type, name: DEV_NAMES[d.type],
        playable: d.type !== 'vp' && d.boughtTurn !== game.turnId &&
          !game.playedDevThisTurn && base.currentPlayerId === me.id &&
          (d.type === 'knight' ? ['roll', 'main'].includes(game.turnPhase) : game.turnPhase === 'main'),
      })),
      devDeckLeft: game.devDeck.length,
    };
    base.legal = legalFor(playerId);
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
function handleAction(body) {
  const { type, playerId } = body;

  if (type === 'join') {
    const name = String(body.name || '').trim().slice(0, 20);
    if (!name) return { status: 400, json: { error: 'Name is required.' } };
    if (game.phase !== 'lobby') return { status: 400, json: { error: 'Game already in progress.' } };
    if (game.players.length >= COLORS.length) return { status: 400, json: { error: 'Game is full (4 players max).' } };
    const id = crypto.randomUUID();
    const c = COLORS[game.players.length];
    game.players.push({ id, name, color: c.color, colorName: c.name, connected: false });
    if (!game.hostId) game.hostId = id;
    addLog(`${name} joined.`);
    broadcast();
    return { status: 200, json: { playerId: id, state: stateFor(id) } };
  }

  // Everything else needs a known player.
  if (!findPlayer(playerId)) {
    if (type === 'leave') return { status: 200, json: { ok: true } };
    return { status: 400, json: { error: 'Unknown player.' } };
  }

  const requireHost = () => playerId === game.hostId;
  let result = {};

  switch (type) {
    case 'start':
      if (!requireHost()) return { status: 403, json: { error: 'Only the host can start the game.' } };
      if (game.phase !== 'lobby') return { status: 400, json: { error: 'Already started.' } };
      result = startGame();
      break;
    case 'newGame':
      if (!requireHost()) return { status: 403, json: { error: 'Only the host can start a new game.' } };
      { const keep = game.players.map((p) => ({ id: p.id, name: p.name, color: p.color, colorName: p.colorName, connected: p.connected }));
        game = freshGame();
        game.players = keep;
        game.hostId = keep[0] ? keep[0].id : null;
        addLog('Returned to the lobby.'); }
      break;
    case 'placeSettlement': result = buildSettlement(playerId, body.vertexId); break;
    case 'placeRoad': result = buildRoad(playerId, body.edgeId); break;
    case 'buildSettlement': result = buildSettlement(playerId, body.vertexId); break;
    case 'buildRoad': result = buildRoad(playerId, body.edgeId); break;
    case 'buildCity': result = buildCity(playerId, body.vertexId); break;
    case 'roll': result = rollDice(playerId); break;
    case 'discard': result = doDiscard(playerId, body.discard); break;
    case 'moveRobber': result = moveRobber(playerId, body.hexId); break;
    case 'steal': result = doSteal(playerId, body.targetId); break;
    case 'buyDev': result = buyDev(playerId); break;
    case 'playDev': result = playDev(playerId, body); break;
    case 'bankTrade': result = bankTrade(playerId, body.give, body.receive); break;
    case 'endTurn': result = endTurn(playerId); break;
    case 'leave': {
      if (game.phase === 'lobby') {
        const idx = game.players.findIndex((p) => p.id === playerId);
        if (idx !== -1) {
          const [removed] = game.players.splice(idx, 1);
          // Re-assign colours so they stay contiguous.
          game.players.forEach((p, i) => { p.color = COLORS[i].color; p.colorName = COLORS[i].name; });
          clients.delete(playerId);
          if (game.hostId === removed.id) game.hostId = game.players[0] ? game.players[0].id : null;
          addLog(`${removed.name} left.`);
        }
      }
      broadcast();
      return { status: 200, json: { ok: true } };
    }
    default:
      return { status: 400, json: { error: 'Unknown action.' } };
  }

  if (result && result.error) return { status: 400, json: { error: result.error } };
  broadcast();
  return { status: 200, json: { state: stateFor(playerId) } };
}

// ---------------------------------------------------------------------------
// HTTP + SSE plumbing
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
      catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid JSON.' })); return; }
      let out;
      try { out = handleAction(parsed); }
      catch (err) { console.error(err); out = { status: 500, json: { error: 'Server error.' } }; }
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.json));
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

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('\n  🎲  Settlers — LAN edition server running!\n');
    console.log('  On this computer:   http://localhost:' + PORT);
    for (const addr of lanAddresses()) console.log('  On your LAN:         http://' + addr + ':' + PORT);
    console.log('\n  Share a LAN address with players on the same network.');
    console.log('  Press Ctrl+C to stop.\n');
  });
}

// Exposed for tests (no HTTP needed).
module.exports = { handleAction, getGame: () => game, TOPO };
