'use strict';

// ---------------------------------------------------------------------------
// The 72 tiles of the original Carcassonne base game (types A–X, standard
// distribution). Each tile is described in its base (unrotated) orientation.
//
// Edges (sides), clockwise:        Half-edges (for farms), clockwise:
//   N = 0   E = 1   S = 2   W = 3      0 = N-west  1 = N-east
//                                      2 = E-north 3 = E-south
// Edge letters:                        4 = S-east  5 = S-west
//   C = city, R = road, F = field      6 = W-south 7 = W-north
//
// Rotating a tile 90° clockwise maps edge e -> (e+1)%4 and half h -> (h+2)%8.
//
// Features:
//   { type:'city',  edges:[...], pennant?:true, spot:[x,y] }
//   { type:'road',  edges:[...], spot:[x,y] }
//   { type:'cloister', spot:[x,y] }
//   { type:'farm',  halves:[...], cities:[featureIndexes], spot:[x,y] }
// `spot` is the meeple position in unit tile coordinates (base orientation).
// `cities` lists which city features of this same tile the farm touches
// (used for farmer scoring: 3 points per completed adjacent city).
// ---------------------------------------------------------------------------

const N = 0, E = 1, S = 2, W = 3;

const TILE_TYPES = {
  // Cloister with a road stub.
  A: {
    count: 2,
    edges: ['F', 'F', 'R', 'F'],
    features: [
      { type: 'cloister', spot: [0.5, 0.48] },
      { type: 'road', edges: [S], spot: [0.5, 0.86] },
      { type: 'farm', halves: [0, 1, 2, 3, 4, 5, 6, 7], cities: [], spot: [0.18, 0.2] },
    ],
  },
  // Cloister.
  B: {
    count: 4,
    edges: ['F', 'F', 'F', 'F'],
    features: [
      { type: 'cloister', spot: [0.5, 0.5] },
      { type: 'farm', halves: [0, 1, 2, 3, 4, 5, 6, 7], cities: [], spot: [0.18, 0.2] },
    ],
  },
  // City on all four sides, pennant.
  C: {
    count: 1,
    edges: ['C', 'C', 'C', 'C'],
    features: [
      { type: 'city', edges: [N, E, S, W], pennant: true, spot: [0.5, 0.5] },
    ],
  },
  // City cap east, straight road north-south. (Start tile.)
  D: {
    count: 4,
    edges: ['R', 'C', 'R', 'F'],
    features: [
      { type: 'city', edges: [E], spot: [0.86, 0.5] },
      { type: 'road', edges: [N, S], spot: [0.5, 0.5] },
      { type: 'farm', halves: [1, 4], cities: [0], spot: [0.63, 0.16] },
      { type: 'farm', halves: [0, 5, 6, 7], cities: [], spot: [0.26, 0.62] },
    ],
  },
  // City cap north.
  E: {
    count: 5,
    edges: ['C', 'F', 'F', 'F'],
    features: [
      { type: 'city', edges: [N], spot: [0.5, 0.14] },
      { type: 'farm', halves: [2, 3, 4, 5, 6, 7], cities: [0], spot: [0.5, 0.62] },
    ],
  },
  // City tube east-west, pennant.
  F: {
    count: 2,
    edges: ['F', 'C', 'F', 'C'],
    features: [
      { type: 'city', edges: [E, W], pennant: true, spot: [0.5, 0.5] },
      { type: 'farm', halves: [0, 1], cities: [0], spot: [0.5, 0.08] },
      { type: 'farm', halves: [4, 5], cities: [0], spot: [0.5, 0.92] },
    ],
  },
  // City tube east-west.
  G: {
    count: 1,
    edges: ['F', 'C', 'F', 'C'],
    features: [
      { type: 'city', edges: [E, W], spot: [0.5, 0.5] },
      { type: 'farm', halves: [0, 1], cities: [0], spot: [0.5, 0.08] },
      { type: 'farm', halves: [4, 5], cities: [0], spot: [0.5, 0.92] },
    ],
  },
  // Two separate city caps, east and west.
  H: {
    count: 3,
    edges: ['F', 'C', 'F', 'C'],
    features: [
      { type: 'city', edges: [E], spot: [0.87, 0.5] },
      { type: 'city', edges: [W], spot: [0.13, 0.5] },
      { type: 'farm', halves: [0, 1, 4, 5], cities: [0, 1], spot: [0.5, 0.5] },
    ],
  },
  // Two separate city caps, east and south.
  I: {
    count: 2,
    edges: ['F', 'C', 'C', 'F'],
    features: [
      { type: 'city', edges: [E], spot: [0.87, 0.5] },
      { type: 'city', edges: [S], spot: [0.5, 0.87] },
      { type: 'farm', halves: [0, 1, 6, 7], cities: [0, 1], spot: [0.28, 0.28] },
    ],
  },
  // City cap north, road curving east-south.
  J: {
    count: 3,
    edges: ['C', 'R', 'R', 'F'],
    features: [
      { type: 'city', edges: [N], spot: [0.5, 0.14] },
      { type: 'road', edges: [E, S], spot: [0.75, 0.75] },
      { type: 'farm', halves: [3, 4], cities: [], spot: [0.92, 0.92] },
      { type: 'farm', halves: [2, 5, 6, 7], cities: [0], spot: [0.3, 0.56] },
    ],
  },
  // City cap north, road curving south-west.
  K: {
    count: 3,
    edges: ['C', 'F', 'R', 'R'],
    features: [
      { type: 'city', edges: [N], spot: [0.5, 0.14] },
      { type: 'road', edges: [S, W], spot: [0.25, 0.75] },
      { type: 'farm', halves: [5, 6], cities: [], spot: [0.08, 0.92] },
      { type: 'farm', halves: [2, 3, 4, 7], cities: [0], spot: [0.7, 0.56] },
    ],
  },
  // City cap north, three-way road junction east/south/west.
  L: {
    count: 3,
    edges: ['C', 'R', 'R', 'R'],
    features: [
      { type: 'city', edges: [N], spot: [0.5, 0.14] },
      { type: 'road', edges: [E], spot: [0.82, 0.5] },
      { type: 'road', edges: [S], spot: [0.5, 0.82] },
      { type: 'road', edges: [W], spot: [0.18, 0.5] },
      { type: 'farm', halves: [3, 4], cities: [], spot: [0.85, 0.85] },
      { type: 'farm', halves: [5, 6], cities: [], spot: [0.15, 0.85] },
      { type: 'farm', halves: [2, 7], cities: [0], spot: [0.5, 0.36] },
    ],
  },
  // City corner north-west, pennant.
  M: {
    count: 2,
    edges: ['C', 'F', 'F', 'C'],
    features: [
      { type: 'city', edges: [N, W], pennant: true, spot: [0.28, 0.28] },
      { type: 'farm', halves: [2, 3, 4, 5], cities: [0], spot: [0.72, 0.72] },
    ],
  },
  // City corner north-west.
  N: {
    count: 3,
    edges: ['C', 'F', 'F', 'C'],
    features: [
      { type: 'city', edges: [N, W], spot: [0.28, 0.28] },
      { type: 'farm', halves: [2, 3, 4, 5], cities: [0], spot: [0.72, 0.72] },
    ],
  },
  // City corner north-west, road curving east-south, pennant.
  O: {
    count: 2,
    edges: ['C', 'R', 'R', 'C'],
    features: [
      { type: 'city', edges: [N, W], pennant: true, spot: [0.25, 0.25] },
      { type: 'road', edges: [E, S], spot: [0.75, 0.75] },
      { type: 'farm', halves: [2, 5], cities: [0], spot: [0.57, 0.57] },
      { type: 'farm', halves: [3, 4], cities: [], spot: [0.92, 0.92] },
    ],
  },
  // City corner north-west, road curving east-south.
  P: {
    count: 3,
    edges: ['C', 'R', 'R', 'C'],
    features: [
      { type: 'city', edges: [N, W], spot: [0.25, 0.25] },
      { type: 'road', edges: [E, S], spot: [0.75, 0.75] },
      { type: 'farm', halves: [2, 5], cities: [0], spot: [0.57, 0.57] },
      { type: 'farm', halves: [3, 4], cities: [], spot: [0.92, 0.92] },
    ],
  },
  // City on three sides (open south), pennant.
  Q: {
    count: 1,
    edges: ['C', 'C', 'F', 'C'],
    features: [
      { type: 'city', edges: [N, E, W], pennant: true, spot: [0.5, 0.4] },
      { type: 'farm', halves: [4, 5], cities: [0], spot: [0.5, 0.92] },
    ],
  },
  // City on three sides (open south).
  R: {
    count: 3,
    edges: ['C', 'C', 'F', 'C'],
    features: [
      { type: 'city', edges: [N, E, W], spot: [0.5, 0.4] },
      { type: 'farm', halves: [4, 5], cities: [0], spot: [0.5, 0.92] },
    ],
  },
  // City on three sides, road south, pennant.
  S: {
    count: 2,
    edges: ['C', 'C', 'R', 'C'],
    features: [
      { type: 'city', edges: [N, E, W], pennant: true, spot: [0.5, 0.38] },
      { type: 'road', edges: [S], spot: [0.5, 0.88] },
      { type: 'farm', halves: [4], cities: [0], spot: [0.84, 0.92] },
      { type: 'farm', halves: [5], cities: [0], spot: [0.16, 0.92] },
    ],
  },
  // City on three sides, road south.
  T: {
    count: 1,
    edges: ['C', 'C', 'R', 'C'],
    features: [
      { type: 'city', edges: [N, E, W], spot: [0.5, 0.38] },
      { type: 'road', edges: [S], spot: [0.5, 0.88] },
      { type: 'farm', halves: [4], cities: [0], spot: [0.84, 0.92] },
      { type: 'farm', halves: [5], cities: [0], spot: [0.16, 0.92] },
    ],
  },
  // Straight road north-south.
  U: {
    count: 8,
    edges: ['R', 'F', 'R', 'F'],
    features: [
      { type: 'road', edges: [N, S], spot: [0.5, 0.5] },
      { type: 'farm', halves: [1, 2, 3, 4], cities: [], spot: [0.76, 0.35] },
      { type: 'farm', halves: [0, 5, 6, 7], cities: [], spot: [0.24, 0.65] },
    ],
  },
  // Road curving south-west.
  V: {
    count: 9,
    edges: ['F', 'F', 'R', 'R'],
    features: [
      { type: 'road', edges: [S, W], spot: [0.25, 0.75] },
      { type: 'farm', halves: [5, 6], cities: [], spot: [0.08, 0.92] },
      { type: 'farm', halves: [0, 1, 2, 3, 4, 7], cities: [], spot: [0.62, 0.35] },
    ],
  },
  // Three-way road junction east/south/west.
  W: {
    count: 4,
    edges: ['F', 'R', 'R', 'R'],
    features: [
      { type: 'road', edges: [E], spot: [0.82, 0.5] },
      { type: 'road', edges: [S], spot: [0.5, 0.82] },
      { type: 'road', edges: [W], spot: [0.18, 0.5] },
      { type: 'farm', halves: [3, 4], cities: [], spot: [0.85, 0.85] },
      { type: 'farm', halves: [5, 6], cities: [], spot: [0.15, 0.85] },
      { type: 'farm', halves: [7, 0, 1, 2], cities: [], spot: [0.5, 0.2] },
    ],
  },
  // Four-way crossroads.
  X: {
    count: 1,
    edges: ['R', 'R', 'R', 'R'],
    features: [
      { type: 'road', edges: [N], spot: [0.5, 0.18] },
      { type: 'road', edges: [E], spot: [0.82, 0.5] },
      { type: 'road', edges: [S], spot: [0.5, 0.82] },
      { type: 'road', edges: [W], spot: [0.18, 0.5] },
      { type: 'farm', halves: [1, 2], cities: [], spot: [0.84, 0.16] },
      { type: 'farm', halves: [3, 4], cities: [], spot: [0.84, 0.84] },
      { type: 'farm', halves: [5, 6], cities: [], spot: [0.16, 0.84] },
      { type: 'farm', halves: [7, 0], cities: [], spot: [0.16, 0.16] },
    ],
  },
};

const START_TILE = 'D';

if (typeof module !== 'undefined') {
  module.exports = { TILE_TYPES, START_TILE };
}
