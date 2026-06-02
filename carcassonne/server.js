'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const {
  TEMPLATES,
  ADJ,
  SIDE_MID,
  SIDE_CORNERS,
  pairedCorners,
  templateById,
  expandDeck,
  rotateTerrain,
  deriveFeatures,
  edgeTypeAt,
  CENTRE,
} = require('./tiles');

const PORT = Number(process.env.PORT) || 3700;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const COLORS = [
  { color: '#d64545', name: 'Red' },
  { color: '#3b6fd4', name: 'Blue' },
  { color: '#e9e9ef', name: 'White' },
  { color: '#54d18c', name: 'Green' },
  { color: '#f5c542', name: 'Yellow' },
];

const STARTING_MEEPLES = 7;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const oppositeSide = (s) => (s + 2) % 4;
const tileKey = (x, y) => `${x},${y}`;

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let game = freshGame();
const clients = new Map();

function freshGame() {
  return {
    phase: 'lobby',
    subPhase: null,
    players: [],
    hostId: null,
    log: [],
    turnIndex: 0,

    deck: [],
    discards: 0,
    currentTile: null, // { templateId, rot }
    legalPlacements: [], // [{ x, y, rotations: [...] }]

    placed: new Map(), // tileKey -> placedTile
    features: new Map(), // root id -> feature
    featureParent: new Map(), // id -> parent
    nextFeatureId: 1,

    winnerIds: [],
    _lastPlacedKey: null,
  };
}

function addLog(message) {
  game.log.push({ t: Date.now(), message });
  if (game.log.length > 60) game.log.shift();
}

function findPlayer(id) { return game.players.find((p) => p.id === id); }
function currentPlayer() { return game.players[game.turnIndex] || null; }

// ---------------------------------------------------------------------------
// Union-find
// ---------------------------------------------------------------------------
function findRoot(id) {
  let cur = id;
  while (game.featureParent.get(cur) !== cur) {
    const next = game.featureParent.get(cur);
    game.featureParent.set(cur, game.featureParent.get(next));
    cur = next;
  }
  return cur;
}

function unionFeatures(idA, idB) {
  const a = findRoot(idA);
  const b = findRoot(idB);
  if (a === b) return a;
  const fa = game.features.get(a);
  const fb = game.features.get(b);
  for (const k of fb.tiles) fa.tiles.add(k);
  for (const m of fb.meeples) fa.meeples.push(m);
  fa.openEnds += fb.openEnds;
  if (fa.type === 'city') fa.pennants += fb.pennants;
  if (fa.type === 'field') {
    for (const c of fb.touchedCities) fa.touchedCities.add(c);
  }
  game.features.delete(b);
  game.featureParent.set(b, a);
  return a;
}

function newFeatureId() { return game.nextFeatureId++; }

// ---------------------------------------------------------------------------
// Tile derivation cache (template + rot → derived features)
// ---------------------------------------------------------------------------
const derivedCache = new Map();
function getDerived(templateId, rot) {
  const key = `${templateId}#${rot}`;
  if (!derivedCache.has(key)) {
    const tpl = templateById(templateId);
    const rotated = rotateTerrain(tpl.terrain, rot);
    const d = deriveFeatures(rotated);
    derivedCache.set(key, { terrain: rotated, ...d });
  }
  return derivedCache.get(key);
}

// ---------------------------------------------------------------------------
// Placement validity
// ---------------------------------------------------------------------------
function placedTerrain(pt) { return getDerived(pt.templateId, pt.rot).terrain; }

function canPlaceAt(x, y, templateId, rot) {
  if (game.placed.has(tileKey(x, y))) return false;
  const terrain = getDerived(templateId, rot).terrain;
  let touched = 0;
  for (let s = 0; s < 4; s++) {
    const [dx, dy] = DIRS[s];
    const neighbour = game.placed.get(tileKey(x + dx, y + dy));
    if (!neighbour) continue;
    touched += 1;
    const nTerrain = placedTerrain(neighbour);
    if (edgeTypeAt(nTerrain, oppositeSide(s)) !== edgeTypeAt(terrain, s)) return false;
  }
  return touched > 0;
}

function computeLegalPlacements(templateId) {
  const candidates = new Set();
  for (const k of game.placed.keys()) {
    const [x, y] = k.split(',').map(Number);
    for (const [dx, dy] of DIRS) {
      const nk = tileKey(x + dx, y + dy);
      if (!game.placed.has(nk)) candidates.add(nk);
    }
  }
  const list = [];
  for (const k of candidates) {
    const [x, y] = k.split(',').map(Number);
    const rotations = [];
    for (let r = 0; r < 4; r++) if (canPlaceAt(x, y, templateId, r)) rotations.push(r);
    if (rotations.length) list.push({ x, y, rotations });
  }
  return list;
}

// ---------------------------------------------------------------------------
// Tile placement
// ---------------------------------------------------------------------------
function placeTile(x, y, templateId, rot) {
  const tpl = templateById(templateId);
  const derived = getDerived(templateId, rot);
  const tile = {
    templateId, rot, x, y,
    placedBy: currentPlayer() ? currentPlayer().id : null,
    featureIds: [], // localFeatureIdx → global feature id
  };

  // Create global features for each local derived feature.
  for (let i = 0; i < derived.features.length; i++) {
    const f = derived.features[i];
    const id = newFeatureId();
    const obj = {
      type: f.type,
      tiles: new Set([tileKey(x, y)]),
      meeples: [],
      openEnds: f.sides.length, // junction features have sides=[], openEnds=0 immediately
      pennants: 0,
      surrounding: 0, // for cloister
      touchedCities: new Set(), // for fields
      complete: false,
      isJunction: !!f.isJunction,
    };
    if (f.type === 'city') obj.pennants = tpl.pennants || 0;
    // Field's initial city touches: same-tile cities adjacent in grid.
    if (f.type === 'field') {
      // (filled in after all local features are created so we can map cells → ids)
    }
    game.features.set(id, obj);
    game.featureParent.set(id, id);
    tile.featureIds.push(id);
  }

  // Cloister extra feature.
  if (tpl.cloister) {
    const id = newFeatureId();
    let surrounding = 0;
    for (let ddx = -1; ddx <= 1; ddx++) for (let ddy = -1; ddy <= 1; ddy++) {
      if (ddx === 0 && ddy === 0) continue;
      if (game.placed.has(tileKey(x + ddx, y + ddy))) surrounding += 1;
    }
    game.features.set(id, {
      type: 'cloister',
      tiles: new Set([tileKey(x, y)]),
      meeples: [],
      openEnds: 0,
      pennants: 0,
      surrounding,
      touchedCities: new Set(),
      complete: false,
      isJunction: false,
    });
    game.featureParent.set(id, id);
    tile.featureIds.push(id);
  }

  // Now populate touchedCities for fields using the local owner map.
  for (let i = 0; i < derived.features.length; i++) {
    const f = derived.features[i];
    if (f.type !== 'field') continue;
    for (const cell of f.cells) {
      for (const n of ADJ[cell]) {
        const nOwner = derived.owner[n];
        if (derived.features[nOwner].type === 'city') {
          game.features.get(tile.featureIds[i]).touchedCities.add(tile.featureIds[nOwner]);
        }
      }
    }
  }

  game.placed.set(tileKey(x, y), tile);

  // Merge with each existing neighbour.
  for (let s = 0; s < 4; s++) {
    const [dx, dy] = DIRS[s];
    const neighbour = game.placed.get(tileKey(x + dx, y + dy));
    if (!neighbour) continue;
    const neighbourDerived = getDerived(neighbour.templateId, neighbour.rot);

    // 1. Edge midpoint feature match (city/road).
    const myEdgeCell = SIDE_MID[s];
    const nbEdgeCell = SIDE_MID[oppositeSide(s)];
    const myLocal = derived.owner[myEdgeCell];
    const nbLocal = neighbourDerived.owner[nbEdgeCell];
    const myFeat = derived.features[myLocal];
    const nbFeat = neighbourDerived.features[nbLocal];
    if ((myFeat.type === 'city' && nbFeat.type === 'city') ||
        (myFeat.type === 'road' && nbFeat.type === 'road')) {
      const aRoot = findRoot(tile.featureIds[myLocal]);
      const bRoot = findRoot(neighbour.featureIds[nbLocal]);
      if (aRoot === bRoot) {
        game.features.get(aRoot).openEnds -= 2;
      } else {
        const merged = unionFeatures(aRoot, bRoot);
        game.features.get(merged).openEnds -= 2;
      }
    }

    // 2. Field corner merges.
    for (const [myCornerCell, nbCornerCell] of pairedCorners(s)) {
      const myCornerOwner = derived.owner[myCornerCell];
      const nbCornerOwner = neighbourDerived.owner[nbCornerCell];
      if (derived.features[myCornerOwner].type !== 'field') continue;
      if (neighbourDerived.features[nbCornerOwner].type !== 'field') continue;
      const aRoot = findRoot(tile.featureIds[myCornerOwner]);
      const bRoot = findRoot(neighbour.featureIds[nbCornerOwner]);
      if (aRoot !== bRoot) unionFeatures(aRoot, bRoot);
    }
  }

  // 3. Bump surrounding count on any nearby cloisters.
  for (let ddx = -1; ddx <= 1; ddx++) for (let ddy = -1; ddy <= 1; ddy++) {
    if (ddx === 0 && ddy === 0) continue;
    const n = game.placed.get(tileKey(x + ddx, y + ddy));
    if (!n) continue;
    const nTpl = templateById(n.templateId);
    if (!nTpl.cloister) continue;
    // The cloister is the *last* feature index on a cloister tile.
    const nDerived = getDerived(n.templateId, n.rot);
    const cloisterLocalIdx = nDerived.features.length; // appended after derived features
    const root = findRoot(n.featureIds[cloisterLocalIdx]);
    game.features.get(root).surrounding += 1;
  }

  return tile;
}

// ---------------------------------------------------------------------------
// Meeple legality & placement
// ---------------------------------------------------------------------------
function legalMeepleSpots(tile) {
  const derived = getDerived(tile.templateId, tile.rot);
  const spots = [];
  for (let i = 0; i < tile.featureIds.length; i++) {
    const root = findRoot(tile.featureIds[i]);
    const f = game.features.get(root);
    if (!f || f.complete) continue;
    if (f.isJunction) continue;
    if (f.meeples.length > 0) continue;
    spots.push(i);
  }
  return spots;
}

function localFeatureType(tile, localIdx) {
  const derived = getDerived(tile.templateId, tile.rot);
  if (localIdx < derived.features.length) return derived.features[localIdx].type;
  return 'cloister';
}

function placeMeeple(playerId, tile, localIdx) {
  const p = findPlayer(playerId);
  if (p.meeples <= 0) return { error: 'No meeples left.' };
  if (!legalMeepleSpots(tile).includes(localIdx)) {
    return { error: 'You cannot place a meeple on that feature.' };
  }
  const root = findRoot(tile.featureIds[localIdx]);
  const f = game.features.get(root);
  const t = f.type;
  f.meeples.push({ playerId, tileKey: tileKey(tile.x, tile.y), localIdx, kind: t === 'field' ? 'farmer' : 'meeple' });
  p.meeples -= 1;
  addLog(`${p.name} placed a ${t === 'field' ? 'farmer' : 'meeple'} on ${describeFeature(t)}.`);
  return {};
}

function describeFeature(t) {
  if (t === 'city') return 'a city';
  if (t === 'road') return 'a road';
  if (t === 'cloister') return 'a cloister';
  if (t === 'field') return 'a field';
  return t;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
function scoreFeature(root, partial) {
  const f = game.features.get(root);
  if (!f || f.complete) return;
  let points = 0;
  if (f.type === 'road') {
    points = f.tiles.size; // 1 per tile, complete or not
  } else if (f.type === 'city') {
    if (partial) points = f.tiles.size + f.pennants;
    else points = 2 * f.tiles.size + 2 * f.pennants;
  } else if (f.type === 'cloister') {
    points = 1 + f.surrounding;
  } else if (f.type === 'field') {
    const cityRoots = new Set();
    for (const cid of f.touchedCities) cityRoots.add(findRoot(cid));
    let completedCount = 0;
    for (const cr of cityRoots) {
      const cf = game.features.get(cr);
      if (cf && cf.complete) completedCount += 1;
    }
    points = 3 * completedCount;
  }

  const counts = {};
  for (const m of f.meeples) counts[m.playerId] = (counts[m.playerId] || 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  const winners = Object.keys(counts).filter((pid) => counts[pid] === max);

  if (winners.length && points > 0) {
    for (const pid of winners) {
      const pl = findPlayer(pid);
      if (!pl) continue;
      pl.score += points;
      const qualifier = f.type === 'field'
        ? 'a field'
        : `${partial ? 'an incomplete' : 'a completed'} ${f.type}`;
      addLog(`🏅 ${pl.name} scored ${points} for ${qualifier}.`);
    }
  }

  for (const m of f.meeples) {
    const pl = findPlayer(m.playerId);
    if (pl) pl.meeples += 1;
  }
  f.meeples = [];
  if (!partial) f.complete = true;
}

function settleCompletedFeatures(touchedRoots) {
  for (const root of touchedRoots) {
    const r = findRoot(root);
    const f = game.features.get(r);
    if (!f || f.complete) continue;
    if (f.isJunction) continue;
    if (f.type === 'cloister') {
      if (f.surrounding >= 8) scoreFeature(r, false);
    } else if (f.type === 'city' || f.type === 'road') {
      if (f.openEnds <= 0) scoreFeature(r, false);
    }
    // Fields only score at end of game.
  }
  // Any cloister could complete from a non-side placement.
  for (const [id, f] of game.features) {
    if (f.complete || f.type !== 'cloister') continue;
    if (f.surrounding >= 8) scoreFeature(id, false);
  }
}

function tileTouchedRoots(tile) {
  const roots = new Set();
  for (const fid of tile.featureIds) roots.add(findRoot(fid));
  return roots;
}

// ---------------------------------------------------------------------------
// Deck flow
// ---------------------------------------------------------------------------
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function drawNextTile() {
  while (game.deck.length > 0) {
    const id = game.deck.pop();
    const legal = computeLegalPlacements(id);
    if (legal.length > 0) {
      game.currentTile = { templateId: id, rot: 0 };
      game.legalPlacements = legal;
      return true;
    }
    game.discards += 1;
    addLog(`A ${id} tile had no legal placement and was discarded.`);
  }
  game.currentTile = null;
  game.legalPlacements = [];
  return false;
}

function startGame() {
  if (game.players.length < 2) return { error: 'Need at least 2 players to start.' };
  game.players.forEach((p) => { p.score = 0; p.meeples = STARTING_MEEPLES; });

  game.placed = new Map();
  game.features = new Map();
  game.featureParent = new Map();
  game.nextFeatureId = 1;
  placeStartingTile();

  game.deck = expandDeck();
  shuffle(game.deck);
  game.phase = 'play';
  game.subPhase = 'place';
  game.turnIndex = 0;
  game.log = [];
  game.winnerIds = [];
  drawNextTile();
  addLog(`Game started. ${currentPlayer().name}, place your tile.`);
  return {};
}

function placeStartingTile() {
  const start = TEMPLATES.find((t) => t.start);
  // Reuse placeTile but mark placedBy=null.
  const savedPlayer = currentPlayer();
  // Temporarily set turn to "no current player" by saving placedBy.
  // Simpler: call placeTile with current state and overwrite placedBy.
  // But placeTile uses currentPlayer().id — there are no players yet so guard:
  // we'll just inline a tiny version.
  const tpl = start;
  const derived = getDerived(tpl.id, 0);
  const tile = { templateId: tpl.id, rot: 0, x: 0, y: 0, placedBy: null, featureIds: [] };
  for (let i = 0; i < derived.features.length; i++) {
    const f = derived.features[i];
    const id = newFeatureId();
    game.features.set(id, {
      type: f.type,
      tiles: new Set([tileKey(0, 0)]),
      meeples: [],
      openEnds: f.sides.length,
      pennants: f.type === 'city' ? (tpl.pennants || 0) : 0,
      surrounding: 0,
      touchedCities: new Set(),
      complete: false,
      isJunction: !!f.isJunction,
    });
    game.featureParent.set(id, id);
    tile.featureIds.push(id);
  }
  // touchedCities for fields
  for (let i = 0; i < derived.features.length; i++) {
    const f = derived.features[i];
    if (f.type !== 'field') continue;
    for (const cell of f.cells) {
      for (const n of ADJ[cell]) {
        const nOwner = derived.owner[n];
        if (derived.features[nOwner].type === 'city') {
          game.features.get(tile.featureIds[i]).touchedCities.add(tile.featureIds[nOwner]);
        }
      }
    }
  }
  game.placed.set(tileKey(0, 0), tile);
}

function endTurnAdvance() {
  game.turnIndex = (game.turnIndex + 1) % game.players.length;
  if (!drawNextTile()) {
    finishGame();
    return;
  }
  game.subPhase = 'place';
  addLog(`${currentPlayer().name}'s turn.`);
}

function finishGame() {
  for (const [id, f] of game.features) {
    if (f.complete) continue;
    if (f.isJunction) continue;
    if (f.meeples.length > 0) scoreFeature(id, true);
  }
  game.phase = 'gameover';
  game.subPhase = null;
  const best = Math.max(...game.players.map((p) => p.score));
  game.winnerIds = game.players.filter((p) => p.score === best).map((p) => p.id);
  const names = game.winnerIds.map((id) => findPlayer(id).name).join(' & ');
  addLog(`🏆 ${names} ${game.winnerIds.length > 1 ? 'tie' : 'wins'} with ${best} points!`);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function actionRotate(playerId, dir) {
  if (game.phase !== 'play' || game.subPhase !== 'place') return { error: 'Not your move.' };
  if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
  if (!game.currentTile) return { error: 'No tile to rotate.' };
  const d = dir === 'ccw' ? -1 : 1;
  game.currentTile.rot = (game.currentTile.rot + d + 4) % 4;
  return {};
}

function actionPlaceTile(playerId, x, y, rot) {
  if (game.phase !== 'play' || game.subPhase !== 'place') return { error: 'Not your move.' };
  if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
  if (!game.currentTile) return { error: 'No tile drawn.' };
  const spot = game.legalPlacements.find((s) => s.x === x && s.y === y);
  if (!spot || !spot.rotations.includes(rot)) return { error: 'You cannot place the tile there.' };
  placeTile(x, y, game.currentTile.templateId, rot);
  addLog(`${currentPlayer().name} placed a tile at (${x}, ${y}).`);
  game.currentTile = null;
  game.legalPlacements = [];
  game.subPhase = 'meeple';
  game._lastPlacedKey = tileKey(x, y);
  return {};
}

function actionPlaceMeeple(playerId, localIdx) {
  if (game.phase !== 'play' || game.subPhase !== 'meeple') return { error: 'Not your move.' };
  if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
  const last = game.placed.get(game._lastPlacedKey);
  if (!last) return { error: 'No tile to place a meeple on.' };
  const r = placeMeeple(playerId, last, localIdx);
  if (r.error) return r;
  settleCompletedFeatures(tileTouchedRoots(last));
  endTurnAdvance();
  return {};
}

function actionSkipMeeple(playerId) {
  if (game.phase !== 'play' || game.subPhase !== 'meeple') return { error: 'Not your move.' };
  if (currentPlayer().id !== playerId) return { error: 'It is not your turn.' };
  const last = game.placed.get(game._lastPlacedKey);
  if (last) settleCompletedFeatures(tileTouchedRoots(last));
  endTurnAdvance();
  return {};
}

// ---------------------------------------------------------------------------
// State serialisation
// ---------------------------------------------------------------------------
function meeplesOnTile(t) {
  const out = [];
  for (let i = 0; i < t.featureIds.length; i++) {
    const root = findRoot(t.featureIds[i]);
    const f = game.features.get(root);
    if (!f) continue;
    for (const m of f.meeples) {
      if (m.tileKey === tileKey(t.x, t.y) && m.localIdx === i) {
        out.push({ playerId: m.playerId, localIdx: i, kind: m.kind });
      }
    }
  }
  return out;
}

function serializeTile(t) {
  const tpl = templateById(t.templateId);
  return {
    templateId: t.templateId,
    rot: t.rot,
    x: t.x, y: t.y,
    cloister: !!tpl.cloister,
    pennants: tpl.pennants || 0,
    meeples: meeplesOnTile(t),
  };
}

function publicPlayers() {
  return game.players.map((p) => ({
    id: p.id, name: p.name, color: p.color, colorName: p.colorName,
    connected: p.connected,
    score: p.score || 0,
    meeples: p.meeples != null ? p.meeples : STARTING_MEEPLES,
  }));
}

function templatesForClient() {
  // Only need fields the client renders/derives from.
  const out = {};
  for (const t of TEMPLATES) {
    out[t.id] = {
      terrain: t.terrain,
      cloister: !!t.cloister,
      pennants: t.pennants || 0,
      start: !!t.start,
    };
  }
  return out;
}

let templatesCache = null;
function stateFor(playerId) {
  const base = {
    phase: game.phase,
    subPhase: game.subPhase,
    hostId: game.hostId,
    players: publicPlayers(),
    log: game.log.slice(-18),
    deckLeft: game.deck.length,
    discards: game.discards,
    currentPlayerId: currentPlayer() ? currentPlayer().id : null,
    winnerIds: game.winnerIds,
  };
  if (game.phase === 'lobby') return base;
  if (!templatesCache) templatesCache = templatesForClient();
  base.templates = templatesCache;
  base.tiles = [];
  for (const t of game.placed.values()) base.tiles.push(serializeTile(t));
  base.currentTile = game.currentTile;
  base.legalPlacements = game.legalPlacements;
  base.lastPlacedKey = game._lastPlacedKey;
  if (game.subPhase === 'meeple') {
    const last = game.placed.get(game._lastPlacedKey);
    base.meepleSpots = last ? legalMeepleSpots(last) : [];
  } else {
    base.meepleSpots = [];
  }
  return base;
}

function broadcast() {
  for (const [pid, res] of clients) {
    res.write(`data: ${JSON.stringify(stateFor(pid))}\n\n`);
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
function handleAction(body) {
  const { type, playerId } = body;
  if (type === 'join') {
    const name = String(body.name || '').trim().slice(0, 20);
    if (!name) return { status: 400, json: { error: 'Name is required.' } };
    if (game.phase !== 'lobby') return { status: 400, json: { error: 'Game already in progress.' } };
    if (game.players.length >= COLORS.length) {
      return { status: 400, json: { error: `Game is full (${COLORS.length} players max).` } };
    }
    const id = crypto.randomUUID();
    const c = COLORS[game.players.length];
    game.players.push({
      id, name, color: c.color, colorName: c.name,
      connected: false, score: 0, meeples: STARTING_MEEPLES,
    });
    if (!game.hostId) game.hostId = id;
    addLog(`${name} joined.`);
    broadcast();
    return { status: 200, json: { playerId: id, state: stateFor(id) } };
  }

  if (!findPlayer(playerId)) {
    if (type === 'leave') return { status: 200, json: { ok: true } };
    return { status: 400, json: { error: 'Unknown player.' } };
  }
  const requireHost = () => playerId === game.hostId;
  let result = {};

  switch (type) {
    case 'start':
      if (!requireHost()) return { status: 403, json: { error: 'Only the host can start.' } };
      if (game.phase !== 'lobby') return { status: 400, json: { error: 'Already started.' } };
      result = startGame();
      break;
    case 'newGame': {
      if (!requireHost()) return { status: 403, json: { error: 'Only the host can start a new game.' } };
      const keep = game.players.map((p) => ({
        id: p.id, name: p.name, color: p.color, colorName: p.colorName, connected: p.connected,
      }));
      game = freshGame();
      game.players = keep;
      game.hostId = keep[0] ? keep[0].id : null;
      addLog('Returned to the lobby.');
      break;
    }
    case 'rotate':       result = actionRotate(playerId, body.dir); break;
    case 'placeTile':    result = actionPlaceTile(playerId, body.x, body.y, body.rot); break;
    case 'placeMeeple':  result = actionPlaceMeeple(playerId, body.localIdx); break;
    case 'skipMeeple':   result = actionSkipMeeple(playerId); break;
    case 'leave': {
      if (game.phase === 'lobby') {
        const idx = game.players.findIndex((p) => p.id === playerId);
        if (idx !== -1) {
          const [removed] = game.players.splice(idx, 1);
          game.players.forEach((p, i) => {
            p.color = COLORS[i].color; p.colorName = COLORS[i].name;
          });
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
// HTTP + SSE
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
    console.log('\n  🏰  Carcassonne — LAN edition server running!\n');
    console.log('  On this computer:   http://localhost:' + PORT);
    for (const addr of lanAddresses()) console.log('  On your LAN:         http://' + addr + ':' + PORT);
    console.log('\n  Share a LAN address with players on the same network.');
    console.log('  Press Ctrl+C to stop.\n');
  });
}

module.exports = { handleAction, getGame: () => game };
