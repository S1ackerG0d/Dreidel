'use strict';

// ---------------------------------------------------------------------------
// Canonical-ish Carcassonne base-game tile spec.
//
// Each tile is described by a 3x3 grid of cell terrain plus optional cloister
// and pennant flags. The grid is laid out row-major:
//
//     0 (NW)  1 (N mid)  2 (NE)
//     3 (W)   4 (centre) 5 (E)
//     6 (SW)  7 (S mid)  8 (SE)
//
// Terrain letters:
//   C = city, R = road, F = field
//   J = "junction" — visually rendered as road but never connects to other
//       road cells. Used at the centre of T-junctions and crossroads so that
//       each road stub becomes its own feature.
//
// Connected components over orthogonal grid neighbours become features
// (cities, roads, fields). Cloister tiles add an extra centre feature.
//
// Distribution chosen to total 72 tiles (incl. 1 starter) approximating the
// Hans im Glück base game. Exact per-template counts are a best-effort
// reconstruction — sandboxed network access blocked authoritative refs.
// ---------------------------------------------------------------------------

const NW = 0, N_MID = 1, NE = 2, W_MID = 3, CENTRE = 4, E_MID = 5, SW = 6, S_MID = 7, SE = 8;

const ADJ = [
  [N_MID, W_MID],                  // NW
  [NW, NE, CENTRE],                // N mid
  [N_MID, E_MID],                  // NE
  [NW, CENTRE, SW],                // W mid
  [N_MID, W_MID, E_MID, S_MID],    // centre
  [NE, CENTRE, SE],                // E mid
  [W_MID, S_MID],                  // SW
  [CENTRE, SW, SE],                // S mid
  [E_MID, S_MID],                  // SE
];

// Side index → edge-midpoint cell.
const SIDE_MID = [N_MID, E_MID, S_MID, W_MID];

// Two corner cells per side, in [L, R] order where L/R is the side's left and
// right as you look at it from outside the tile.
const SIDE_CORNERS = {
  0: [NW, NE], 1: [NE, SE], 2: [SE, SW], 3: [SW, NW],
};

// At a shared side, A.sL and B.(s+2)R are the same physical corner; same for
// A.sR and B.(s+2)L. Returns [[aCornerCell, bCornerCell], ...] for one shared
// side.
function pairedCorners(s) {
  const [aL, aR] = SIDE_CORNERS[s];
  const [bL, bR] = SIDE_CORNERS[(s + 2) % 4];
  return [[aL, bR], [aR, bL]];
}

const TEMPLATES = [
  { id: 'cloister-road',                terrain: 'FFFFFFFRF', cloister: true,  count: 2 },
  { id: 'cloister',                     terrain: 'FFFFFFFFF', cloister: true,  count: 4 },
  { id: 'city-full',                    terrain: 'CCCCCCCCC', pennants: 1,     count: 1 },
  { id: 'city-road-straight',           terrain: 'FCFRRRFFF',                  count: 4, start: true },
  { id: 'city-edge',                    terrain: 'FCFFFFFFF',                  count: 5 },
  { id: 'city-opp-connected-pennant',   terrain: 'FCFFCFFCF', pennants: 1,     count: 2 },
  { id: 'city-opp-connected',           terrain: 'FCFFCFFCF',                  count: 1 },
  { id: 'city-opp-separate',            terrain: 'FCFFFFFCF',                  count: 4 },
  { id: 'city-adj-connected-pennant',   terrain: 'FCCFFCFFF', pennants: 1,     count: 2 },
  { id: 'city-adj-connected',           terrain: 'FCCFFCFFF',                  count: 3 },
  { id: 'city-adj-separate',            terrain: 'FCFFFCFFF',                  count: 2 },
  { id: 'city-three-connected',         terrain: 'CCCCCCFFF',                  count: 4 },
  { id: 'city-three-connected-pennant', terrain: 'CCCCCCFFF', pennants: 1,     count: 1 },
  { id: 'city-three-road',              terrain: 'CCCCCCFRF',                  count: 2 },
  { id: 'city-edge-road-end',           terrain: 'FCFFFFFRF',                  count: 3 },
  { id: 'city-edge-road-curveR',        terrain: 'FCFFRRFRF',                  count: 4 },
  { id: 'city-edge-road-curveL',        terrain: 'FCFRRFFRF',                  count: 3 },
  { id: 'city-edge-road-T',             terrain: 'FCFRJRFRF',                  count: 3 },
  { id: 'road-straight',                terrain: 'FFFRRRFFF',                  count: 8 },
  { id: 'road-curve',                   terrain: 'FFFRRFFRF',                  count: 9 },
  { id: 'road-T',                       terrain: 'FFFRJRFRF',                  count: 4 },
  { id: 'road-cross',                   terrain: 'FRFRJRFRF',                  count: 1 },
];

// Total = 72 (incl. 1 starter).

function templateById(id) {
  return TEMPLATES.find((t) => t.id === id);
}

function expandDeck() {
  const deck = [];
  for (const tpl of TEMPLATES) {
    // The starter template has `count` copies in the canonical set, but one of
    // those is placed face-up at the start; only the remaining copies go into
    // the draw deck.
    const inDeck = tpl.start ? tpl.count - 1 : tpl.count;
    for (let i = 0; i < inDeck; i++) deck.push(tpl.id);
  }
  return deck;
}

// Rotate a 9-char terrain string clockwise by `rot` quarter turns.
function rotateTerrain(terrain, rot) {
  let cur = terrain;
  const r = ((rot % 4) + 4) % 4;
  for (let n = 0; n < r; n++) {
    const out = new Array(9);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        out[i * 3 + j] = cur[(2 - j) * 3 + i];
      }
    }
    cur = out.join('');
  }
  return cur;
}

// Compute connected components of a rotated terrain.
//   - 'C' / 'R' / 'F' cells join with same-terrain orthogonal neighbours.
//   - 'J' cells are loners (never propagate, never join) so road stubs at a
//     junction become separate features.
// Returns { features, owner } where owner[cellIdx] = features index.
function deriveFeatures(terrain) {
  const owner = new Array(9).fill(-1);
  const features = [];
  for (let start = 0; start < 9; start++) {
    if (owner[start] !== -1) continue;
    const t = terrain[start];
    const stack = [start];
    const cells = [];
    while (stack.length) {
      const cur = stack.pop();
      if (owner[cur] !== -1) continue;
      owner[cur] = features.length;
      cells.push(cur);
      if (t === 'J') continue; // junctions don't propagate
      for (const n of ADJ[cur]) {
        if (owner[n] === -1 && terrain[n] === t) stack.push(n);
      }
    }
    let type;
    if (t === 'C') type = 'city';
    else if (t === 'R' || t === 'J') type = 'road';
    else type = 'field';
    const sides = [];
    for (let s = 0; s < 4; s++) if (cells.includes(SIDE_MID[s])) sides.push(s);
    const positions = [];
    if (type === 'field') {
      const cornerPos = {
        [NW]: ['0L', '3R'],
        [NE]: ['0R', '1L'],
        [SE]: ['1R', '2L'],
        [SW]: ['2R', '3L'],
      };
      for (const c of cells) if (cornerPos[c]) positions.push(...cornerPos[c]);
    }
    features.push({ type, cells, sides, positions, isJunction: t === 'J' });
  }
  return { features, owner };
}

function edgeTypeAt(terrain, side) {
  const ch = terrain[SIDE_MID[side]];
  return ch === 'J' ? 'R' : ch; // J is a road for matching purposes
}

module.exports = {
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
  NW, N_MID, NE, W_MID, CENTRE, E_MID, SW, S_MID, SE,
};
