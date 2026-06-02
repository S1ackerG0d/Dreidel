'use strict';

// ---------------------------------------------------------------------------
// Carcassonne tile templates.
//
// Each template describes one face of a tile:
//   edges:    [N, E, S, W]  using 'C' (city), 'R' (road), 'F' (field)
//   features: per-tile feature regions. Each feature is one of
//             { type: 'city',     sides: [0..3] }
//             { type: 'road',     sides: [0..3] }
//             { type: 'cloister' }
//             Sides are indices into `edges`. Any edge that is 'C' or 'R'
//             belongs to exactly one feature; 'F' edges are unclaimed
//             (farms are not scored in this implementation).
//   count:    how many copies of this template are in the draw pile.
//   start:    if true, this is the starting tile placed at (0,0).
// ---------------------------------------------------------------------------

const SIDE_NAMES = ['N', 'E', 'S', 'W'];

const TEMPLATES = [
  {
    id: 'start',
    edges: ['C', 'R', 'F', 'R'],
    features: [
      { type: 'city', sides: [0] },
      { type: 'road', sides: [1, 3] },
    ],
    count: 1,
    start: true,
  },
  {
    id: 'road-straight',
    edges: ['F', 'R', 'F', 'R'],
    features: [{ type: 'road', sides: [1, 3] }],
    count: 8,
  },
  {
    id: 'road-curve',
    edges: ['F', 'R', 'R', 'F'],
    features: [{ type: 'road', sides: [1, 2] }],
    count: 9,
  },
  {
    id: 'road-t',
    edges: ['F', 'R', 'R', 'R'],
    features: [
      { type: 'road', sides: [1] },
      { type: 'road', sides: [2] },
      { type: 'road', sides: [3] },
    ],
    count: 4,
  },
  {
    id: 'road-cross',
    edges: ['R', 'R', 'R', 'R'],
    features: [
      { type: 'road', sides: [0] },
      { type: 'road', sides: [1] },
      { type: 'road', sides: [2] },
      { type: 'road', sides: [3] },
    ],
    count: 1,
  },
  {
    id: 'cloister',
    edges: ['F', 'F', 'F', 'F'],
    features: [{ type: 'cloister' }],
    count: 4,
  },
  {
    id: 'cloister-road',
    edges: ['F', 'F', 'R', 'F'],
    features: [{ type: 'cloister' }, { type: 'road', sides: [2] }],
    count: 2,
  },
  {
    id: 'city-edge',
    edges: ['C', 'F', 'F', 'F'],
    features: [{ type: 'city', sides: [0] }],
    count: 5,
  },
  {
    id: 'city-edge-road-straight',
    edges: ['C', 'R', 'F', 'R'],
    features: [
      { type: 'city', sides: [0] },
      { type: 'road', sides: [1, 3] },
    ],
    count: 3,
  },
  {
    id: 'city-edge-road-t',
    edges: ['C', 'R', 'R', 'R'],
    features: [
      { type: 'city', sides: [0] },
      { type: 'road', sides: [1] },
      { type: 'road', sides: [2] },
      { type: 'road', sides: [3] },
    ],
    count: 3,
  },
  {
    id: 'city-edge-road-curveR',
    edges: ['C', 'R', 'R', 'F'],
    features: [
      { type: 'city', sides: [0] },
      { type: 'road', sides: [1, 2] },
    ],
    count: 3,
  },
  {
    id: 'city-edge-road-curveL',
    edges: ['C', 'F', 'R', 'R'],
    features: [
      { type: 'city', sides: [0] },
      { type: 'road', sides: [2, 3] },
    ],
    count: 3,
  },
  {
    id: 'city-adjacent',
    edges: ['C', 'C', 'F', 'F'],
    features: [{ type: 'city', sides: [0, 1] }],
    count: 3,
  },
  {
    id: 'city-opposite',
    edges: ['C', 'F', 'C', 'F'],
    features: [
      { type: 'city', sides: [0] },
      { type: 'city', sides: [2] },
    ],
    count: 3,
  },
  {
    id: 'city-three',
    edges: ['C', 'C', 'F', 'C'],
    features: [{ type: 'city', sides: [0, 1, 3] }],
    count: 3,
  },
  {
    id: 'city-full',
    edges: ['C', 'C', 'C', 'C'],
    features: [{ type: 'city', sides: [0, 1, 2, 3] }],
    count: 1,
  },
  {
    id: 'city-edge-road-end',
    edges: ['C', 'F', 'R', 'F'],
    features: [
      { type: 'city', sides: [0] },
      { type: 'road', sides: [2] },
    ],
    count: 3,
  },
];

// Total: 59 tiles (1 starter + 58 in the draw pile).

function expandDeck() {
  const deck = [];
  for (const tpl of TEMPLATES) {
    if (tpl.start) continue;
    for (let i = 0; i < tpl.count; i++) deck.push(tpl.id);
  }
  return deck;
}

function templateById(id) {
  return TEMPLATES.find((t) => t.id === id);
}

// Rotation: rotate `r` (0..3) quarter-turns clockwise.
//   rotated.edges[i] = template.edges[(i - r + 4) % 4]
//   rotated.features[*].sides[j] = (template.features[*].sides[j] + r) % 4
function rotatedEdges(edges, rot) {
  return [0, 1, 2, 3].map((i) => edges[(i - rot + 4) % 4]);
}

function rotatedFeatures(features, rot) {
  return features.map((f) => ({
    type: f.type,
    sides: f.sides ? f.sides.map((s) => (s + rot) % 4) : undefined,
  }));
}

module.exports = {
  TEMPLATES,
  SIDE_NAMES,
  expandDeck,
  templateById,
  rotatedEdges,
  rotatedFeatures,
};
