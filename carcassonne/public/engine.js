'use strict';

// ---------------------------------------------------------------------------
// Carcassonne rules engine. No DOM dependencies — also runs under Node for
// the tests in ../test.
//
// Board coordinates: x grows east, y grows south. The start tile sits at 0,0.
// Connected features (roads, cities, farms) are computed on demand with a
// flood fill over tile-local feature segments; boards are small enough that
// recomputing is cheap and keeps the state model simple.
// ---------------------------------------------------------------------------

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, E, S, W
const OPPOSITE = [2, 3, 0, 1];
// World half-edge h on one tile touches HALF_MATCH[h] on the adjacent tile.
const HALF_MATCH = [5, 4, 7, 6, 1, 0, 3, 2];
const HALF_SIDE = [0, 0, 1, 1, 2, 2, 3, 3];
const MEEPLES_PER_PLAYER = 7;

function cellKey(x, y) { return x + ',' + y; }

function makeRng(seed) {
  // mulberry32 — deterministic games for tests.
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDeck(rng) {
  const deck = [];
  for (const type of Object.keys(TILE_TYPES)) {
    let n = TILE_TYPES[type].count;
    if (type === START_TILE) n--; // one copy starts on the board
    for (let i = 0; i < n; i++) deck.push(type);
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

class Game {
  constructor(players, rng) {
    this.players = players.map((p) => ({
      name: p.name, color: p.color, score: 0, meeples: MEEPLES_PER_PLAYER,
    }));
    this.rng = rng || Math.random;
    this.board = new Map(); // "x,y" -> { x, y, type, rot, meeples: {featureIdx: playerIdx} }
    this.deck = buildDeck(this.rng);
    this.discards = [];
    this.current = 0;
    this.drawn = null;  // { type, rot } tile in hand
    this.placed = null; // { x, y } tile placed this turn, awaiting meeple decision
    this.over = false;
    this.log = [];
    this.setTile(0, 0, START_TILE, 0);
    this.drawNext();
  }

  addLog(message) { this.log.push(message); }
  tileAt(x, y) { return this.board.get(cellKey(x, y)); }
  setTile(x, y, type, rot) {
    this.board.set(cellKey(x, y), { x, y, type, rot, meeples: {} });
  }
  featureDef(tile, fi) { return TILE_TYPES[tile.type].features[fi]; }
  edgeAt(tile, worldDir) {
    return TILE_TYPES[tile.type].edges[(worldDir - tile.rot + 4) % 4];
  }

  // ---- placement ----------------------------------------------------------

  canPlaceAt(type, rot, x, y) {
    if (this.board.has(cellKey(x, y))) return false;
    let touches = false;
    for (let d = 0; d < 4; d++) {
      const n = this.tileAt(x + DIRS[d][0], y + DIRS[d][1]);
      if (!n) continue;
      touches = true;
      const myEdge = TILE_TYPES[type].edges[(d - rot + 4) % 4];
      if (myEdge !== this.edgeAt(n, OPPOSITE[d])) return false;
    }
    return touches;
  }

  frontier() {
    const cells = new Set();
    for (const t of this.board.values()) {
      for (const [dx, dy] of DIRS) {
        const k = cellKey(t.x + dx, t.y + dy);
        if (!this.board.has(k)) cells.add(k);
      }
    }
    return [...cells].map((s) => s.split(',').map(Number));
  }

  legalCells(type, rot) {
    return this.frontier().filter(([x, y]) => this.canPlaceAt(type, rot, x, y));
  }

  isPlaceable(type) {
    for (let r = 0; r < 4; r++) if (this.legalCells(type, r).length) return true;
    return false;
  }

  drawNext() {
    this.drawn = null;
    while (this.deck.length) {
      const type = this.deck.pop();
      if (this.isPlaceable(type)) { this.drawn = { type, rot: 0 }; return; }
      this.discards.push(type);
      this.addLog(`Tile ${type} could not be placed anywhere and was discarded.`);
    }
  }

  rotateDrawn() { if (this.drawn && !this.placed) this.drawn.rot = (this.drawn.rot + 1) % 4; }

  placeTile(x, y) {
    if (!this.drawn || this.placed) return false;
    if (!this.canPlaceAt(this.drawn.type, this.drawn.rot, x, y)) return false;
    this.setTile(x, y, this.drawn.type, this.drawn.rot);
    this.placed = { x, y };
    return true;
  }

  undoPlace() {
    if (!this.placed) return;
    this.board.delete(cellKey(this.placed.x, this.placed.y));
    this.placed = null;
  }

  // ---- connected features -------------------------------------------------

  // Find the feature index of `kind` ('road'/'city') on `tile` that touches
  // the given world edge.
  featureAtEdge(tile, kind, worldEdge) {
    const defs = TILE_TYPES[tile.type].features;
    for (let i = 0; i < defs.length; i++) {
      const f = defs[i];
      if (f.type !== kind) continue;
      if (f.edges.some((e) => (e + tile.rot) % 4 === worldEdge)) return i;
    }
    return -1;
  }

  farmAtHalf(tile, worldHalf) {
    const defs = TILE_TYPES[tile.type].features;
    for (let i = 0; i < defs.length; i++) {
      const f = defs[i];
      if (f.type !== 'farm') continue;
      if (f.halves.some((h) => (h + 2 * tile.rot) % 8 === worldHalf)) return i;
    }
    return -1;
  }

  // Flood-fill the connected feature containing segment fi of the tile at x,y.
  flood(x, y, fi) {
    const kind = this.featureDef(this.tileAt(x, y), fi).type;
    const nodes = new Map(); // "x,y,fi" -> { tile, fi }
    const seen = new Set([x + ',' + y + ',' + fi]);
    const queue = [[x, y, fi]];
    const tiles = new Set();
    const meeples = [];
    let openEdges = 0;
    let pennants = 0;
    while (queue.length) {
      const [cx, cy, cfi] = queue.pop();
      const tile = this.tileAt(cx, cy);
      const f = this.featureDef(tile, cfi);
      nodes.set(cx + ',' + cy + ',' + cfi, { tile, fi: cfi });
      tiles.add(cellKey(cx, cy));
      if (f.pennant) pennants++;
      if (tile.meeples[cfi] !== undefined) {
        meeples.push({ player: tile.meeples[cfi], x: cx, y: cy, fi: cfi });
      }
      if (kind === 'cloister') continue;
      if (kind === 'farm') {
        for (const h of f.halves) {
          const wh = (h + 2 * tile.rot) % 8;
          const side = HALF_SIDE[wh];
          const nx = cx + DIRS[side][0], ny = cy + DIRS[side][1];
          const n = this.tileAt(nx, ny);
          if (!n) continue;
          const nfi = this.farmAtHalf(n, HALF_MATCH[wh]);
          if (nfi < 0) continue;
          const k = nx + ',' + ny + ',' + nfi;
          if (!seen.has(k)) { seen.add(k); queue.push([nx, ny, nfi]); }
        }
      } else {
        for (const e of f.edges) {
          const we = (e + tile.rot) % 4;
          const nx = cx + DIRS[we][0], ny = cy + DIRS[we][1];
          const n = this.tileAt(nx, ny);
          if (!n) { openEdges++; continue; }
          const nfi = this.featureAtEdge(n, kind, OPPOSITE[we]);
          if (nfi < 0) continue;
          const k = nx + ',' + ny + ',' + nfi;
          if (!seen.has(k)) { seen.add(k); queue.push([nx, ny, nfi]); }
        }
      }
    }
    const canon = [...nodes.keys()].sort()[0];
    return { kind, nodes, tiles, meeples, openEdges, pennants, canon };
  }

  // ---- meeples --------------------------------------------------------------

  // Feature indexes of the just-placed tile where the current player may put
  // a meeple (the connected feature must be unclaimed).
  meepleOptions() {
    if (!this.placed || this.players[this.current].meeples <= 0) return [];
    const { x, y } = this.placed;
    const defs = TILE_TYPES[this.tileAt(x, y).type].features;
    const options = [];
    for (let i = 0; i < defs.length; i++) {
      if (this.flood(x, y, i).meeples.length === 0) options.push(i);
    }
    return options;
  }

  placeMeeple(fi) {
    if (!this.placed) return false;
    if (!this.meepleOptions().includes(fi)) return false;
    this.tileAt(this.placed.x, this.placed.y).meeples[fi] = this.current;
    this.players[this.current].meeples--;
    return true;
  }

  // ---- scoring --------------------------------------------------------------

  majority(meeples) {
    const counts = {};
    for (const m of meeples) counts[m.player] = (counts[m.player] || 0) + 1;
    const max = Math.max(...Object.values(counts));
    return Object.keys(counts).filter((p) => counts[p] === max).map(Number);
  }

  award(playerIdx, points, reason) {
    this.players[playerIdx].score += points;
    this.addLog(`${this.players[playerIdx].name} +${points} (${reason})`);
  }

  returnMeeples(feature) {
    for (const m of feature.meeples) {
      delete this.tileAt(m.x, m.y).meeples[m.fi];
      this.players[m.player].meeples++;
    }
  }

  cloisterNeighbors(x, y) {
    let c = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if ((dx || dy) && this.tileAt(x + dx, y + dy)) c++;
      }
    }
    return c;
  }

  // Score roads/cities/cloisters completed by the tile placed this turn.
  resolveCompletions() {
    const { x, y } = this.placed;
    const tile = this.tileAt(x, y);
    const done = new Set();
    const defs = TILE_TYPES[tile.type].features;
    for (let i = 0; i < defs.length; i++) {
      const f = defs[i];
      if (f.type !== 'road' && f.type !== 'city') continue;
      const feat = this.flood(x, y, i);
      if (done.has(feat.canon)) continue;
      done.add(feat.canon);
      if (feat.openEdges > 0) continue;
      if (feat.meeples.length) {
        const pts = feat.kind === 'city'
          ? feat.tiles.size * 2 + feat.pennants * 2
          : feat.tiles.size;
        const label = feat.kind === 'city' ? 'completed city' : 'completed road';
        for (const w of this.majority(feat.meeples)) this.award(w, pts, label);
      }
      this.returnMeeples(feat);
    }
    // A new tile can complete the cloister on itself or on any of its 8 neighbors.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const t = this.tileAt(x + dx, y + dy);
        if (!t) continue;
        const cfi = TILE_TYPES[t.type].features.findIndex((f) => f.type === 'cloister');
        if (cfi < 0 || t.meeples[cfi] === undefined) continue;
        if (this.cloisterNeighbors(t.x, t.y) === 8) {
          const p = t.meeples[cfi];
          this.award(p, 9, 'completed cloister');
          delete t.meeples[cfi];
          this.players[p].meeples++;
        }
      }
    }
  }

  endTurn() {
    if (!this.placed) return;
    this.resolveCompletions();
    this.placed = null;
    this.drawn = null;
    this.current = (this.current + 1) % this.players.length;
    this.drawNext();
    if (!this.drawn) this.finishGame();
  }

  finishGame() {
    this.over = true;
    this.addLog('— Final scoring —');
    const done = new Set();
    // Incomplete roads, cities and cloisters that still hold meeples.
    for (const tile of this.board.values()) {
      for (const fiStr of Object.keys(tile.meeples)) {
        const fi = +fiStr;
        const f = this.featureDef(tile, fi);
        if (f.type === 'farm') continue;
        if (f.type === 'cloister') {
          this.award(tile.meeples[fi], 1 + this.cloisterNeighbors(tile.x, tile.y),
            'incomplete cloister');
          continue;
        }
        const feat = this.flood(tile.x, tile.y, fi);
        if (done.has(feat.canon)) continue;
        done.add(feat.canon);
        const pts = feat.kind === 'city'
          ? feat.tiles.size + feat.pennants
          : feat.tiles.size;
        const label = 'incomplete ' + feat.kind;
        for (const w of this.majority(feat.meeples)) this.award(w, pts, label);
      }
    }
    // Farms: 3 points per completed city adjacent to the field.
    const doneFarms = new Set();
    const cityCache = new Map(); // any city node key -> flooded city feature
    for (const tile of this.board.values()) {
      for (const fiStr of Object.keys(tile.meeples)) {
        const fi = +fiStr;
        if (this.featureDef(tile, fi).type !== 'farm') continue;
        const farm = this.flood(tile.x, tile.y, fi);
        if (doneFarms.has(farm.canon)) continue;
        doneFarms.add(farm.canon);
        const completedCities = new Set();
        for (const node of farm.nodes.values()) {
          const def = this.featureDef(node.tile, node.fi);
          for (const ci of def.cities) {
            const ck = node.tile.x + ',' + node.tile.y + ',' + ci;
            let city = cityCache.get(ck);
            if (!city) {
              city = this.flood(node.tile.x, node.tile.y, ci);
              for (const k of city.nodes.keys()) cityCache.set(k, city);
            }
            if (city.openEdges === 0) completedCities.add(city.canon);
          }
        }
        if (completedCities.size > 0) {
          const pts = completedCities.size * 3;
          const label = `farm supplying ${completedCities.size} ` +
            (completedCities.size === 1 ? 'city' : 'cities');
          for (const w of this.majority(farm.meeples)) this.award(w, pts, label);
        }
      }
    }
    this.addLog('Game over!');
  }

  standings() {
    return this.players
      .map((p, idx) => ({ ...p, idx }))
      .sort((a, b) => b.score - a.score);
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    Game, buildDeck, makeRng, cellKey,
    DIRS, OPPOSITE, HALF_MATCH, HALF_SIDE, MEEPLES_PER_PLAYER,
  };
}
